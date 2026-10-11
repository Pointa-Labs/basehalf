/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { existsSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { streamToBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { hash } from '../../../base/common/hash.js';
import { dirname, join } from '../../../base/common/path.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { compareBaseHalfVersions, IBaseHalfUpdateManifest, parseBaseHalfVersion, sanitizeBaseHalfUpdateManifest, verifyBaseHalfArchiveSignature, verifyBaseHalfManifestSignature, bundlePathFromExec } from '../node/basehalfUpdateProtocol.js';
import { baseHalfPrepareUpdate, baseHalfRemove, baseHalfSwapIn, baseHalfUpdateLeftovers } from '../node/basehalfUpdateStore.js';
import { AbstractUpdateService, IUpdateURLOptions, UpdateErrorClassification } from './abstractUpdateService.js';
import { baseHalfAnotherRunUsesBundle, baseHalfFindStagedCopy } from './basehalfStagedCopy.js';

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * BaseHalf's macOS update service. The app ships without a platform signing
 * identity, so Electron's Squirrel-based auto updater (which requires a signed
 * bundle) is unavailable; this service keeps VS Code's update state machine,
 * scheduling, IPC and UI surfaces, and replaces only the transport + install:
 *
 * - Feed: a static, Ed25519-authenticated JSON manifest published as a GitHub
 *   release asset (`releases/latest/download/update-manifest-<arch>.json` —
 *   the same feed previously shipped BaseHalf releases poll).
 * - Verify: manifest metadata AND archive bytes must verify against the baked
 *   in public key (see basehalfUpdateProtocol.ts) before anything installs.
 * - Install: the verified archive is extracted and pre-placed next to the
 *   running bundle while the app runs; the actual swap is two atomic renames
 *   performed on quit, and files the app downloads itself carry no quarantine
 *   flag — so the swapped-in version launches cleanly without Gatekeeper
 *   re-evaluation.
 * - Kept by version (app update): the archive and the staged copy are named
 *   after the version and not after this run. An interrupted download
 *   continues, a complete one is not fetched again, and a staged copy that a
 *   run left behind takes the bundle's place at the next start, before the
 *   application is created (see basehalfStagedCopy.ts).
 */
export class BaseHalfDarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	/** Verified manifest of the update we last offered (survives the
	 *  AvailableForDownload detour on metered connections). */
	private pendingManifest: IBaseHalfUpdateManifest | undefined;
	/** `.bh-staged-<version>.app` sitting next to the running bundle, fully
	 *  verified and ready to be renamed into place on quit. */
	private stagedAppPath: string | undefined;
	private didInstall = false;
	/** Where an archive is kept while it is downloaded and unpacked. It outlives a run. */
	private readonly updateStorePath: string;

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, false);

		this.updateStorePath = join(environmentMainService.userDataPath, 'updates');
		lifecycleMainService.setRelaunchHandler(this);

		// A plain quit applies a ready update too (parity with platform
		// auto-updaters): the swap is two renames, safe during shutdown, and
		// idempotent with the quitAndInstall/relaunch paths.
		lifecycleMainService.onWillShutdown(() => {
			if (this.state.type === StateType.Ready) {
				this.installStagedUpdate();
			}
		});
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready) {
			return false; // no pending update: default relaunch behavior
		}

		// Swap the staged bundle into place now (the app is quitting), then let
		// the DEFAULT relaunch proceed — the bundle path is unchanged, so the
		// standard app.relaunch() starts the freshly installed version.
		this.logService.trace('update#handleRelaunch(): installing staged update before relaunch');
		this.installStagedUpdate();

		return false;
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string | undefined {
		// Test/staging hook: an https URL is used as-is, an absolute path is
		// read from disk at check time (lets an end-to-end test run the whole
		// verify→extract→swap chain without a server).
		const override = process.env['BASEHALF_UPDATE_FEED_URL'];
		if (override) {
			return override;
		}

		if (!this.productService.basehalfVersion || parseBaseHalfVersion(this.productService.basehalfVersion) === null) {
			this.logService.error('update#buildUpdateFeedUrl - missing or malformed basehalfVersion in product.json');
			return undefined;
		}

		const assetID = process.arch === 'x64' ? 'darwin-x64' : 'darwin-arm64';
		return `${this.productService.updateUrl}/update-manifest-${assetID}.json`;
	}

	protected doCheckForUpdates(explicit: boolean): void {
		if (!this.quality) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));
		this.doCheckForUpdatesAsync(explicit).catch(err => this.onUpdateError(explicit, err));
	}

	private async doCheckForUpdatesAsync(explicit: boolean): Promise<void> {
		const feedUrl = this.buildUpdateFeedUrl(this.quality!, this.productService.commit!);
		if (!feedUrl) {
			this.setState(State.Idle(UpdateType.Archive));
			return;
		}

		const feed = await this.fetchFeedBody(feedUrl);
		const manifest = sanitizeBaseHalfUpdateManifest(feed.body, { allowLocalUrl: feed.isLocal });
		if (!manifest) {
			throw new Error('Update feed is malformed.');
		}

		// Authenticate the metadata BEFORE trusting any field (esp. version): a
		// forged feed could otherwise relabel an old, validly-signed archive as
		// a newer release and downgrade the user. Fail closed.
		if (!verifyBaseHalfManifestSignature(manifest)) {
			throw new Error('Update feed failed verification.');
		}

		const currentVersion = this.productService.basehalfVersion ?? '0.0.0';
		const cmp = compareBaseHalfVersions(manifest.version, currentVersion);
		if (cmp === null || cmp <= 0) {
			this.logService.trace('update#doCheckForUpdatesAsync - up to date', { currentVersion, feedVersion: manifest.version });
			const notAvailable = this.state.type === StateType.CheckingForUpdates && this.state.explicit;
			this.setState(State.Idle(UpdateType.Archive, undefined, notAvailable || undefined));
			return;
		}

		const update: IUpdate = {
			version: manifest.version,
			productVersion: manifest.version,
			timestamp: Date.parse(manifest.pubDate) || undefined,
			url: manifest.url,
		};
		this.pendingManifest = manifest;

		// On a metered connection a background check only surfaces the update;
		// the download starts when the user asks for it (abstract downloadUpdate).
		if (!explicit && this.meteredConnectionService.isConnectionMetered) {
			this.logService.info('update#doCheckForUpdatesAsync - update available, deferring download on metered connection');
			this.setState(State.AvailableForDownload(update, true));
			return;
		}

		await this.downloadAndStage(manifest, update, explicit);
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		const manifest = this.pendingManifest;
		if (!manifest || manifest.version !== state.update.version) {
			// The manifest we offered is gone/stale — restart the machinery.
			this.doCheckForUpdates(true);
			return;
		}

		try {
			await this.downloadAndStage(manifest, state.update, true);
		} catch (err) {
			this.onUpdateError(true, err);
		}
	}

	private async fetchFeedBody(feedUrl: string): Promise<{ body: unknown; isLocal: boolean }> {
		if (feedUrl.startsWith('/')) {
			return { body: JSON.parse(await fs.readFile(feedUrl, 'utf8')), isLocal: true };
		}

		const context = await this.requestService.request({ url: feedUrl, callSite: 'updateService.basehalfDarwin.checkForUpdates' }, CancellationToken.None);
		const statusCode = context.res.statusCode;
		if (!statusCode || statusCode < 200 || statusCode >= 300) {
			throw new Error(statusCode === 404 ? 'No update feed published yet.' : `Could not reach the update feed (HTTP ${statusCode}).`);
		}

		const buffer = await streamToBuffer(context.stream);
		return { body: JSON.parse(buffer.toString()), isLocal: false };
	}

	/**
	 * Makes the update ready: the archive is downloaded unless it is there,
	 * its length and signature are checked, it is unpacked, and the unpacked
	 * app is placed next to the running bundle for the quit-time rename swap.
	 * Each step uses what an earlier run left complete. Errors propagate to
	 * the caller.
	 */
	private async downloadAndStage(manifest: IBaseHalfUpdateManifest, update: IUpdate, explicit: boolean): Promise<void> {
		this.setState(State.Downloading(update, explicit, false, 0, manifest.length, Date.now()));

		let lastPushed = 0;
		this.stagedAppPath = await baseHalfPrepareUpdate({
			version: manifest.version,
			length: manifest.length,
			verify: bytes => verifyBaseHalfArchiveSignature(bytes, manifest.signature),
			// A local archive is only reachable via the test feed override
			// (sanitize gates it); the signature still decides whether it
			// installs.
			localArchive: manifest.url.startsWith('/') ? manifest.url : undefined,
			request: async from => {
				const context = await this.requestService.request({
					url: manifest.url,
					headers: from > 0 ? { 'Range': `bytes=${from}-` } : undefined,
					callSite: 'updateService.basehalfDarwin.download'
				}, CancellationToken.None);
				const header = (name: string) => {
					const value = context.res.headers[name];
					return Array.isArray(value) ? value[0] : value;
				};
				const contentLength = Number(header('content-length'));
				return {
					statusCode: context.res.statusCode,
					stream: context.stream,
					contentLength: header('content-length') !== undefined && Number.isInteger(contentLength) ? contentLength : undefined,
					contentRange: header('content-range')
				};
			},
			// Resolved before anything else: failing early (dev layout,
			// translocated run) beats failing after a full download.
			bundle: this.runningBundlePath(),
			storePath: this.updateStorePath,
			pid: process.pid,
			onProgress: received => {
				// Progress pushes throttled so the state channel (and the
				// info-level state log) isn't spammed per-chunk.
				if (received - lastPushed > 5 * 1024 * 1024) {
					lastPushed = received;
					this.setState(State.Downloading(update, explicit, false, received, manifest.length));
				}
			},
			onUnpacking: () => this.setState(State.Updating(update, explicit))
		});

		this.setState(State.Ready(update, explicit, false));
	}

	override async isLatestVersion(): Promise<boolean | undefined> {
		// Deprecated API, only consulted by startup-timing telemetry. The
		// inherited implementation expects an update-server that answers 204;
		// our static feed can't express that — report "unknown" instead of
		// logging a failed request on every startup.
		return undefined;
	}

	private runningBundlePath(): string {
		const bundle = bundlePathFromExec(process.execPath);
		if (!bundle) {
			throw new Error('Not running from an app bundle — self-update needs the packaged app.');
		}
		if (process.execPath.includes('/AppTranslocation/')) {
			throw new Error('macOS is running this copy from a temporary location. Move BaseHalf to Applications and launch it from there, then try again.');
		}
		return bundle;
	}

	private onUpdateError(explicit: boolean, err: unknown): void {
		const message = toErrorMessage(err);
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(message)) });
		this.logService.error('update#basehalfDarwin error:', message);

		// only surface the message when the user explicitly checked
		this.setState(State.Idle(UpdateType.Archive, explicit ? message : undefined));
	}

	/** Swap the running bundle for the staged one. Both renames happen inside
	 *  the bundle's parent dir (same volume → atomic), with a rollback if the
	 *  second one fails. Synchronous on purpose: it runs while the app is
	 *  quitting, where async work may never get to finish. The old bundle
	 *  (which this process is still executing from — fine on macOS, the mapped
	 *  pages stay valid) is swept by the NEW version's startup sweep. */
	private installStagedUpdate(): boolean {
		if (this.didInstall) {
			return true;
		}
		const staged = this.stagedAppPath;
		if (!staged || !existsSync(staged)) {
			// Nothing is staged, or another run from this bundle swapped it in already.
			return false;
		}
		try {
			baseHalfSwapIn(this.runningBundlePath(), staged, process.pid);
			this.didInstall = true;
			return true;
		} catch (err) {
			this.logService.error('update#installStagedUpdate - swap failed', err);
			return false;
		}
	}

	protected override doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): installing staged update');
		this.installStagedUpdate();
		// The lifecycle quit is already in flight; registering the relaunch
		// now makes macOS start the bundle again after exit. Also when
		// nothing was swapped, because another run did it already or the
		// swap failed: the user asked for a restart, and the next start tries
		// again.
		electron.app.relaunch();
	}

	protected override async postInitialize(): Promise<void> {
		// A staged copy that is still there is a ready update: the title bar
		// shows it without a check and without a download. The start did not
		// swap it in (see baseHalfSwapStagedCopyAtStart): another BaseHalf
		// runs from the bundle, or the swap failed.
		const staged = baseHalfFindStagedCopy(this.productService.basehalfVersion);
		if (staged) {
			this.stagedAppPath = staged.path;
			this.setState(State.Ready({ version: staged.version, productVersion: staged.version }, false, false));
		}

		// Best-effort sweep of swap debris from previous updates: the
		// renamed-aside old bundle, an orphaned staging copy (crash
		// mid-install), and stale temp download dirs. Delayed + retried
		// defensively: right after an update-relaunch the OLD instance can
		// still be mid-teardown, and a sweep racing it gains nothing.
		setTimeout(() => {
			this.sweepUpdateLeftovers().then(clean => {
				if (!clean) {
					setTimeout(() => this.sweepUpdateLeftovers(), 30_000);
				}
			});
		}, 5_000);
	}

	/** One sweep attempt; resolves false if anything failed to delete. */
	private async sweepUpdateLeftovers(): Promise<boolean> {
		const list = async (path: string | undefined): Promise<string[]> => {
			try {
				return path ? await fs.readdir(path) : [];
			} catch {
				return []; // Unreadable or missing: nothing to sweep there.
			}
		};
		const bundle = bundlePathFromExec(process.execPath);
		const parent = bundle ? dirname(bundle) : undefined;
		const besideBundle = await list(parent);
		// Another run may still execute from a bundle that was renamed aside.
		const anotherRun = !!bundle && besideBundle.some(entry => entry.startsWith('.bh-previous-')) && baseHalfAnotherRunUsesBundle(bundle);
		const leftovers = baseHalfUpdateLeftovers({
			besideBundle,
			inStore: await list(this.updateStorePath),
			inTemporaryFolder: await list(tmpdir())
		}, this.productService.basehalfVersion ?? '0.0.0', process.pid, isPidAlive, anotherRun);
		const sweeps = [
			...leftovers.besideBundle.map(entry => join(parent!, entry)),
			...leftovers.inStore.map(entry => join(this.updateStorePath, entry)),
			...leftovers.inTemporaryFolder.map(entry => join(tmpdir(), entry))
		].map(path => baseHalfRemove(path));
		const results = await Promise.allSettled(sweeps);
		const failed = results.filter(r => r.status === 'rejected');
		for (const f of failed) {
			this.logService.warn('update#sweepUpdateLeftovers - failed:', (f as PromiseRejectedResult).reason);
		}
		// What was kept because of another run is looked at once more.
		return failed.length === 0 && !anotherRun;
	}
}
