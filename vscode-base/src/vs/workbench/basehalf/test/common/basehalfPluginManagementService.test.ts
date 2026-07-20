/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { FileAccess } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { consumeStream, newWriteableStream } from '../../../../base/common/stream.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IChecksumService } from '../../../../platform/checksum/common/checksumService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { ExtensionRuntimeActionType, IExtensionsWorkbenchService } from '../../../contrib/extensions/common/extensions.js';
import { EnablementState, IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { BaseHalfPluginManagementService, getBaseHalfPluginVersionChange, isVerifiedPluginInstallEvent, limitBaseHalfPluginDownloadStream, requiresPluginRuntimeRestart } from '../../common/basehalfPluginManagementService.js';
import { BASEHALF_CURATED_PLUGINS, IBaseHalfResolvedPlugin } from '../../common/basehalfPluginCatalog.js';
import { IBaseHalfPluginCatalogService } from '../../common/basehalfPluginCatalogService.js';
import { IBaseHalfVerifiedPluginInstall } from '../../common/basehalfPluginAdmissionService.js';
import { sha256HexToChecksumBase64 } from '../../common/basehalfPluginCatalogSecurity.js';

suite('BaseHalfPluginManagementService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('owns install, enable, disable, command, and uninstall lifecycle', async () => {
		const fixture = createFixture();
		const service = store.add(fixture.service);

		assert.strictEqual((await service.getPlugins())[0].state, 'available');
		await service.install('pointa.basehalf-ai-video');
		assert.deepStrictEqual(fixture.locationInstallCalls, [joinPath(FileAccess.asFileUri(''), '..', 'extensions', 'basehalf-ai-video').toString()]);
		assert.strictEqual((await service.getPlugins())[0].state, 'enabled');
		assert.strictEqual((await service.getPlugins())[0].hasConfiguration, true);
		await service.disable('pointa.basehalf-ai-video');
		assert.strictEqual((await service.getPlugins())[0].state, 'disabled');
		await service.enable('pointa.basehalf-ai-video');
		await service.executePrimary('pointa.basehalf-ai-video');
		assert.deepStrictEqual(fixture.commands, ['pointa.basehalf-ai-video.createWorkflow']);
		await service.uninstall('pointa.basehalf-ai-video');
		assert.strictEqual((await service.getPlugins())[0].state, 'available');
	});

	test('uninstalls through the native lifecycle and preserves its post-uninstall runtime action', async () => {
		const fixture = createFixture({
			initiallyInstalled: true,
			runtimeAction: ExtensionRuntimeActionType.RestartExtensions
		});
		const service = store.add(fixture.service);

		const result = await service.uninstall('pointa.basehalf-ai-video');

		assert.deepStrictEqual(fixture.nativeUninstallCalls, [fixture.workbenchExtension]);
		assert.strictEqual(result.restartRequired, true);
		assert.strictEqual(fixture.workbenchExtension.runtimeState.action, ExtensionRuntimeActionType.RestartExtensions);
		assert.strictEqual((await fixture.extensionsWorkbench.queryLocal()).length, 0);
		assert.deepStrictEqual(fixture.forgottenInstalls, ['pointa.basehalf-ai-video']);
	});

	test('reconciles an install event without relying on cross-window context', async () => {
		const fixture = createFixture();
		store.add(fixture.service);
		const reconciled = fixture.waitForReceiptReconciliation();

		fixture.fireInstallResult();
		await reconciled;

		assert.deepStrictEqual(fixture.forgottenInstalls, []);
		assert.deepStrictEqual(fixture.receiptReconciliations, [{
			extensionId: 'pointa.basehalf-ai-video',
			installed: [{ version: '0.1.0', extensionLocation: fixture.extension.location }]
		}]);
	});

	test('recognizes a verified install event initiated by another window', () => {
		const fixture = createFixture();
		store.add(fixture.service);

		fixture.fireInstallResult({ basehalfVerifiedInstall: 'verified-in-another-window' });

		assert.deepStrictEqual(fixture.forgottenInstalls, []);
		assert.deepStrictEqual(fixture.receiptReconciliations, []);
		assert.strictEqual(isVerifiedPluginInstallEvent({ basehalfVerifiedInstall: '' }), false);
		assert.strictEqual(isVerifiedPluginInstallEvent({ basehalfVerifiedInstall: 1 }), false);
	});

	test('reconciles a delayed uninstall event against the installation that now exists', async () => {
		const fixture = createFixture({ initiallyInstalled: true, previousReceipt: true });
		store.add(fixture.service);
		const reconciled = fixture.waitForReceiptReconciliation();

		fixture.fireUninstallResult();
		await reconciled;

		assert.deepStrictEqual(fixture.forgottenInstalls, []);
		assert.deepStrictEqual(fixture.receiptReconciliations, [{
			extensionId: 'pointa.basehalf-ai-video',
			installed: [{ version: '0.1.0', extensionLocation: fixture.extension.location }]
		}]);
	});

	test('serializes concurrent operations for one plugin and recovers after failure', async () => {
		const fixture = createFixture();
		const service = store.add(fixture.service);
		let active = 0;
		let maximum = 0;
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>(resolve => releaseFirst = resolve);
		let calls = 0;
		fixture.management.installFromLocation = async () => {
			active++;
			maximum = Math.max(maximum, active);
			calls++;
			if (calls === 1) {
				await firstGate;
			}
			active--;
			if (calls === 2) {
				throw new Error('fixture failure');
			}
			return fixture.extension as never;
		};
		const first = service.install('pointa.basehalf-ai-video');
		const second = service.install('pointa.basehalf-ai-video');
		releaseFirst();
		await first;
		await assert.rejects(second, /fixture failure/);
		assert.strictEqual(maximum, 1);

		fixture.management.installFromLocation = async () => fixture.extension as never;
		await service.install('pointa.basehalf-ai-video');
		assert.strictEqual((await service.getPlugins())[0].state, 'available');
	});

	test('does not advertise cancellation for an operation without a cancellation token', async () => {
		const fixture = createFixture();
		const service = store.add(fixture.service);
		let releaseInstall!: () => void;
		let markEntered!: () => void;
		const entered = new Promise<void>(resolve => markEntered = resolve);
		const gate = new Promise<void>(resolve => releaseInstall = resolve);
		fixture.management.installFromLocation = async () => {
			markEntered();
			await gate;
			return fixture.extension as never;
		};

		const install = service.install('pointa.basehalf-ai-video');
		await entered;
		const [plugin] = await service.getPlugins();
		assert.strictEqual(plugin.busy, true);
		assert.strictEqual(plugin.cancellable, false);
		releaseInstall();
		await install;
	});

	test('shows withdrawn state, blocks new installs, and retains management of an existing installation', async () => {
		const curated = BASEHALF_CURATED_PLUGINS[0];
		const withdrawn: IBaseHalfResolvedPlugin = {
			...curated,
			remote: {
				extensionId: curated.extensionId,
				label: curated.label,
				description: curated.description,
				category: 'Domain',
				versions: [{
					version: '0.1.0',
					basehalfRange: '*',
					vscodeRange: '*',
					targetPlatform: 'universal',
					assetPath: `${curated.extensionId}/0.1.0/${'a'.repeat(64)}.vsix`,
					sha256: 'a'.repeat(64),
					installedContentSha256: 'b'.repeat(64),
					size: 1024,
					publishedAt: '2026-07-13T00:00:00.000Z',
					status: 'withdrawn'
				}]
			}
		};
		const freshFixture = createFixture({ plugins: [withdrawn] });
		const freshService = store.add(freshFixture.service);
		assert.strictEqual((await freshService.getPlugins())[0].state, 'withdrawn');
		await assert.rejects(freshService.install(curated.extensionId), /withdrawn/);

		const installedFixture = createFixture({ plugins: [withdrawn], initiallyInstalled: true });
		const installedService = store.add(installedFixture.service);
		assert.strictEqual((await installedService.getPlugins())[0].state, 'withdrawn');
	});

	test('updates through a verified package and reports the native extension restart action', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({
			plugins: [plugin],
			initiallyInstalled: true,
			installedVersion: '0.1.0',
			runtimeAction: ExtensionRuntimeActionType.RestartExtensions
		});
		const service = store.add(fixture.service);

		assert.strictEqual((await service.getPlugins())[0].state, 'updateAvailable');
		const result = await service.update(plugin.extensionId);
		assert.strictEqual(result.restartRequired, true);
		assert.strictEqual(fixture.extension.manifest.version, '0.2.0');
		assert.deepStrictEqual(fixture.verifiedInstalls.map(install => [install.version, install.sha256]), [['0.2.0', 'a'.repeat(64)]]);
		assert.strictEqual((await service.getPlugins())[0].state, 'enabled');
	});

	test('rejects a remote package whose manifest identity does not match the signed catalog', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({ plugins: [plugin], initiallyInstalled: true, installedVersion: '0.1.0' });
		const service = store.add(fixture.service);
		fixture.management.getManifest = async () => ({ publisher: 'attacker', name: 'other-plugin', version: '0.2.0' });

		await assert.rejects(service.update(plugin.extensionId), /manifest mismatch/);
		assert.strictEqual(fixture.extension.manifest.version, '0.1.0');
		assert.deepStrictEqual(fixture.verifiedInstalls, []);
	});

	test('rejects remote package bytes that do not match the signed hash', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({
			plugins: [plugin],
			initiallyInstalled: true,
			installedVersion: '0.1.0',
			checksum: sha256HexToChecksumBase64('b'.repeat(64))
		});
		const service = store.add(fixture.service);

		await assert.rejects(service.update(plugin.extensionId), /SHA-256 verification/);
		assert.strictEqual(fixture.extension.manifest.version, '0.1.0');
		assert.deepStrictEqual(fixture.verifiedInstalls, []);
	});

	test('restores the previous plugin and its receipt when the new installation grant is rejected', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({
			plugins: [plugin],
			initiallyInstalled: true,
			installedVersion: '0.1.0',
			previousReceipt: true,
			rejectNewReceipt: true
		});
		const service = store.add(fixture.service);

		await assert.rejects(service.update(plugin.extensionId), /signed plugin grant changed/);
		assert.strictEqual(fixture.extension.manifest.version, '0.1.0');
		assert.strictEqual((await fixture.management.getInstalled())[0]?.manifest.version, '0.1.0');
		assert.ok(fixture.verifiedInstalls.some(install => install.version === '0.1.0'));
		assert.ok(!fixture.verifiedInstalls.some(install => install.version === '0.2.0'));
	});

	test('restores workspace-scoped enablement when an update is rolled back', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({
			plugins: [plugin],
			initiallyInstalled: true,
			installedVersion: '0.1.0',
			previousEnablementState: EnablementState.DisabledWorkspace,
			rejectNewReceipt: true
		});
		const service = store.add(fixture.service);

		await assert.rejects(service.update(plugin.extensionId), /signed plugin grant changed/);
		assert.ok(fixture.enablementCalls.includes(EnablementState.DisabledWorkspace));
	});

	test('restores the previous plugin when installed content hashing fails', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({
			plugins: [plugin],
			initiallyInstalled: true,
			installedVersion: '0.1.0',
			failInstalledContentVerification: true
		});
		const service = store.add(fixture.service);

		await assert.rejects(service.update(plugin.extensionId), /content could not be verified/);
		assert.strictEqual(fixture.extension.manifest.version, '0.1.0');
		assert.strictEqual((await fixture.management.getInstalled())[0]?.manifest.version, '0.1.0');
	});

	test('restores the previous plugin when native installation fails after activation', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({
			plugins: [plugin],
			initiallyInstalled: true,
			installedVersion: '0.1.0',
			previousReceipt: true
		});
		const service = store.add(fixture.service);
		const nativeInstall = fixture.extensionsWorkbench.install;
		fixture.extensionsWorkbench.install = async (...args: unknown[]) => {
			await nativeInstall(...args);
			throw new Error('native activation failure');
		};

		await assert.rejects(service.update(plugin.extensionId), /native activation failure/);
		assert.strictEqual(fixture.extension.manifest.version, '0.1.0');
		assert.strictEqual((await fixture.management.getInstalled())[0]?.manifest.version, '0.1.0');
		assert.ok(fixture.verifiedInstalls.some(install => install.version === '0.1.0'));
		assert.ok(!fixture.verifiedInstalls.some(install => install.version === '0.2.0'));
	});

	test('reports recovery failure and retains the previous installation copy', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({ plugins: [plugin], initiallyInstalled: true, installedVersion: '0.1.0' });
		const service = store.add(fixture.service);
		const nativeInstall = fixture.extensionsWorkbench.install;
		fixture.extensionsWorkbench.install = async (...args: unknown[]) => {
			await nativeInstall(...args);
			throw new Error('native activation failure');
		};
		fixture.management.installFromLocation = async () => {
			throw new Error('recovery installation failure');
		};

		await assert.rejects(
			service.update(plugin.extensionId),
			(error: unknown) => error instanceof AggregateError && /recovery copy remains/.test(error.message)
		);
		assert.strictEqual(fixture.deletedPaths.some(path => path.startsWith('/tmp/basehalf-plugin-')), false);
	});

	test('stops advertising cancellation before native installation begins', async () => {
		const plugin = remotePlugin('0.2.0', 'a'.repeat(64));
		const fixture = createFixture({ plugins: [plugin], initiallyInstalled: true, installedVersion: '0.1.0' });
		const service = store.add(fixture.service);
		const nativeInstall = fixture.extensionsWorkbench.install;
		let markEntered!: () => void;
		let releaseInstall!: () => void;
		const entered = new Promise<void>(resolve => markEntered = resolve);
		const gate = new Promise<void>(resolve => releaseInstall = resolve);
		fixture.extensionsWorkbench.install = async (...args: unknown[]) => {
			markEntered();
			await gate;
			return nativeInstall(...args);
		};

		const update = service.update(plugin.extensionId);
		await entered;
		const [managed] = await service.getPlugins();
		assert.strictEqual(managed.state, 'updating');
		assert.strictEqual(managed.busy, true);
		assert.strictEqual(managed.cancellable, false);
		service.cancel(plugin.extensionId);
		releaseInstall();
		await update;
	});

	test('offers and executes an explicit signed restore when the catalog points to an earlier version', async () => {
		const curated = BASEHALF_CURATED_PLUGINS[0];
		const sha256 = 'a'.repeat(64);
		const restoreVersion = {
			version: '1.0.0',
			basehalfRange: '*',
			vscodeRange: '*',
			targetPlatform: 'universal',
			assetPath: `${curated.extensionId}/1.0.0/${sha256}.vsix`,
			sha256,
			installedContentSha256: 'b'.repeat(64),
			size: 4,
			publishedAt: '2026-07-18T00:00:00.000Z',
			status: 'active' as const
		};
		const plugin: IBaseHalfResolvedPlugin = {
			...curated,
			remote: {
				extensionId: curated.extensionId,
				label: curated.label,
				description: curated.description,
				category: curated.category,
				versions: [restoreVersion]
			},
			remoteVersion: restoreVersion
		};
		const fixture = createFixture({ plugins: [plugin], initiallyInstalled: true, installedVersion: '2.0.0' });
		const service = store.add(fixture.service);

		assert.strictEqual((await service.getPlugins())[0].state, 'restoreAvailable');
		assert.strictEqual(getBaseHalfPluginVersionChange('2.0.0', '1.0.0'), 'restore');
		await service.restore(curated.extensionId);
		assert.strictEqual(fixture.extension.manifest.version, '1.0.0');
		assert.strictEqual(fixture.verifiedInstalls.length, 1);
		assert.strictEqual(fixture.verifiedInstalls[0].sha256, sha256);
		assert.strictEqual((await service.getPlugins())[0].state, 'enabled');
	});

	test('cancels a chunked download as soon as it exceeds the signed size', async () => {
		const source = newWriteableStream<VSBuffer>(chunks => VSBuffer.concat(chunks));
		const cancellation = store.add(new CancellationTokenSource());
		const limited = limitBaseHalfPluginDownloadStream(source, 5, cancellation);
		const consumed = consumeStream(limited, chunks => VSBuffer.concat(chunks));

		source.write(VSBuffer.fromString('123'));
		source.write(VSBuffer.fromString('456'));

		await assert.rejects(consumed, /exceeds the signed size/);
		assert.strictEqual(cancellation.token.isCancellationRequested, true);
	});

	test('requests only the native runtime actions required by extension changes', () => {
		assert.strictEqual(requiresPluginRuntimeRestart(ExtensionRuntimeActionType.RestartExtensions), true);
		assert.strictEqual(requiresPluginRuntimeRestart(ExtensionRuntimeActionType.ReloadWindow), true);
		assert.strictEqual(requiresPluginRuntimeRestart(ExtensionRuntimeActionType.QuitAndInstall), false);
		assert.strictEqual(requiresPluginRuntimeRestart(ExtensionRuntimeActionType.ApplyUpdate), false);
		assert.strictEqual(requiresPluginRuntimeRestart(undefined), false);
	});
});

function createFixture(options: {
	readonly plugins?: readonly IBaseHalfResolvedPlugin[];
	readonly initiallyInstalled?: boolean;
	readonly installedVersion?: string;
	readonly runtimeAction?: ExtensionRuntimeActionType;
	readonly checksum?: string;
	readonly previousReceipt?: boolean;
	readonly rejectNewReceipt?: boolean;
	readonly failInstalledContentVerification?: boolean;
	readonly previousEnablementState?: EnablementState;
} = {}): {
	service: BaseHalfPluginManagementService;
	management: any;
	extensionsWorkbench: any;
	extension: any;
	workbenchExtension: any;
	commands: string[];
	verifiedInstalls: IBaseHalfVerifiedPluginInstall[];
	forgottenInstalls: string[];
	enablementCalls: EnablementState[];
	deletedPaths: string[];
	nativeUninstallCalls: any[];
	locationInstallCalls: string[];
	receiptReconciliations: { extensionId: string; installed: { version: string; extensionLocation: URI }[] }[];
	fireInstallResult(context?: Record<string, unknown>): void;
	fireUninstallResult(): void;
	waitForReceiptReconciliation(): Promise<void>;
} {
	const extension = {
		identifier: { id: 'pointa.basehalf-ai-video' },
		manifest: { publisher: 'pointa', name: 'basehalf-ai-video', version: options.installedVersion ?? '0.1.0', contributes: { configuration: { title: 'AI Video' } } },
		location: URI.file(`/extensions/pointa.basehalf-ai-video-${options.installedVersion ?? '0.1.0'}`)
	};
	const workbenchExtension: any = {
		identifier: extension.identifier,
		local: extension,
		runtimeState: undefined
	};
	const installed: any[] = options.initiallyInstalled ? [extension] : [];
	const enabled = new Set<any>(installed);
	const extensionDirectories = new Map<string, string>([[extension.location.path, extension.manifest.version]]);
	const locationInstallCalls: string[] = [];
	let installListener: ((results: readonly any[]) => void) | undefined;
	let uninstallListener: ((event: any) => void) | undefined;
	const management: any = {
		onDidInstallExtensions: (listener: (results: readonly any[]) => void) => {
			installListener = listener;
			return { dispose: () => { installListener = undefined; } };
		},
		onDidUninstallExtension: (listener: (event: any) => void) => {
			uninstallListener = listener;
			return { dispose: () => { uninstallListener = undefined; } };
		},
		getInstalled: async () => installed,
		installFromLocation: async (location: URI) => {
			locationInstallCalls.push(location.toString());
			const version = extensionDirectories.get(location.path);
			if (version) {
				extension.manifest.version = version;
				extension.location = location;
			}
			if (!installed.includes(extension)) {
				installed.push(extension);
				enabled.add(extension);
			}
			return extension;
		},
		getManifest: async () => ({ publisher: 'pointa', name: 'basehalf-ai-video', version: options.plugins?.[0].remoteVersion?.version ?? '0.1.0' }),
		uninstall: async (candidate: any) => {
			installed.splice(installed.indexOf(candidate), 1);
			enabled.delete(candidate);
		}
	};
	const enablementCalls: EnablementState[] = [];
	const enablement: any = {
		onEnablementChanged: Event.None,
		isEnabled: (candidate: any) => enabled.has(candidate),
		getEnablementState: (candidate: any) => options.previousEnablementState
			?? (enabled.has(candidate) ? EnablementState.EnabledGlobally : EnablementState.DisabledGlobally),
		setEnablement: async (candidates: any[], state: EnablementState) => {
			enablementCalls.push(state);
			for (const candidate of candidates) {
				if (state === EnablementState.EnabledGlobally || state === EnablementState.EnabledWorkspace) {
					enabled.add(candidate);
				} else {
					enabled.delete(candidate);
				}
			}
			return candidates.map(() => false);
		}
	};
	const catalog: IBaseHalfPluginCatalogService = {
		_serviceBrand: undefined,
		onDidChange: Event.None,
		getSnapshot: async () => ({ plugins: options.plugins ?? BASEHALF_CURATED_PLUGINS, source: 'bundled' }),
		refresh: async () => ({ plugins: options.plugins ?? BASEHALF_CURATED_PLUGINS, source: 'bundled' })
	};
	const remoteVersion = options.plugins?.[0].remoteVersion;
	const commands: string[] = [];
	const verifiedInstalls: IBaseHalfVerifiedPluginInstall[] = [];
	if (options.previousReceipt) {
		verifiedInstalls.push({
			extensionId: extension.identifier.id,
			version: extension.manifest.version,
			sha256: 'f'.repeat(64),
			extensionLocation: extension.location,
			installedContentSha256: 'e'.repeat(64)
		});
	}
	const forgottenInstalls: string[] = [];
	const receiptReconciliations: { extensionId: string; installed: { version: string; extensionLocation: URI }[] }[] = [];
	const reconciliationWaiters: DeferredPromise<void>[] = [];
	const admission: any = {
		onDidChange: Event.None,
		replaceVerifiedPlugins() { },
		async reverifyVerifiedInstalls() { },
		async reconcileVerifiedInstalls(extensionId: string, current: { version: string; extensionLocation: URI }[]) {
			receiptReconciliations.push({ extensionId, installed: current });
			reconciliationWaiters.shift()?.complete(undefined);
		},
		isAllowed() { return true; },
		isAllowedContributor() { return true; },
		getVerifiedInstall(extensionId: string, version: string, location: URI) {
			return verifiedInstalls.find(install =>
				install.extensionId === extensionId
				&& install.version === version
				&& install.extensionLocation.toString() === location.toString()
			);
		},
		async verifyAndRecordInstall(verification: {
			readonly extensionId: string;
			readonly version: string;
			readonly sha256: string;
			readonly extensionLocation: URI;
			readonly expectedInstalledContentSha256: string;
		}) {
			if ((options.rejectNewReceipt || options.failInstalledContentVerification) && verification.version === remoteVersion?.version) {
				return undefined;
			}
			const install: IBaseHalfVerifiedPluginInstall = {
				extensionId: verification.extensionId,
				version: verification.version,
				sha256: verification.sha256,
				extensionLocation: verification.extensionLocation,
				installedContentSha256: verification.expectedInstalledContentSha256
			};
			verifiedInstalls.push(install);
			return install;
		},
		forgetVerifiedInstalls(extensionId: string) { forgottenInstalls.push(extensionId.toLowerCase()); }
	};
	const requestService: any = {
		request: async () => {
			const stream = newWriteableStream<VSBuffer>(chunks => VSBuffer.concat(chunks));
			stream.end(VSBuffer.fromString('test'));
			return { res: { statusCode: 200, headers: {} }, stream };
		}
	};
	const deletedPaths: string[] = [];
	const fileService: any = {
		exists: async () => true,
		createFolder: async () => undefined,
		writeFile: async (_resource: URI, stream: ReturnType<typeof newWriteableStream<VSBuffer>>) => { await consumeStream(stream, chunks => VSBuffer.concat(chunks)); },
		stat: async (resource: URI) => {
			if (extensionDirectories.has(resource.path)) {
				return { resource, name: resource.path.split('/').at(-1), isDirectory: true, isFile: false, isSymbolicLink: false };
			}
			return { resource, name: resource.path.split('/').at(-1), size: remoteVersion?.size ?? 0, isDirectory: false, isFile: true, isSymbolicLink: false };
		},
		resolve: async (resource: URI) => extensionDirectories.has(resource.path)
			? {
				resource,
				name: resource.path.split('/').at(-1),
				isDirectory: true,
				isFile: false,
				isSymbolicLink: false,
				children: [{ resource: URI.joinPath(resource, 'package.json'), name: 'package.json', isDirectory: false, isFile: true, isSymbolicLink: false }]
			}
			: { resource, name: resource.path.split('/').at(-1), size: remoteVersion?.size ?? 0, isDirectory: false, isFile: true, isSymbolicLink: false },
		readFile: async (resource: URI) => {
			const parent = resource.path.slice(0, resource.path.lastIndexOf('/'));
			const version = extensionDirectories.get(parent) ?? extension.manifest.version;
			if (options.failInstalledContentVerification && version === remoteVersion?.version) {
				throw new Error('fixture installed content failure');
			}
			return { value: VSBuffer.fromString(JSON.stringify({ publisher: 'pointa', name: 'basehalf-ai-video', version })) };
		},
		copy: async (source: URI, target: URI) => {
			const version = extensionDirectories.get(source.path);
			if (!version) {
				throw new Error(`Missing fixture extension directory ${source.path}`);
			}
			extensionDirectories.set(target.path, version);
			return { resource: target, name: target.path.split('/').at(-1), isDirectory: true, isFile: false, isSymbolicLink: false };
		},
		move: async () => undefined,
		del: async (resource: URI) => {
			deletedPaths.push(resource.path);
			for (const path of [...extensionDirectories.keys()]) {
				if (path === resource.path || path.startsWith(`${resource.path}/`)) {
					extensionDirectories.delete(path);
				}
			}
		}
	};
	const nativeUninstallCalls: any[] = [];
	const extensionsWorkbench: any = {
		queryLocal: async () => installed.includes(extension) ? [workbenchExtension] : [],
		install: async (_vsix: URI, installOptions: { context?: Record<string, unknown> }) => {
			if (!remoteVersion) {
				return workbenchExtension;
			}
			extensionDirectories.delete(extension.location.path);
			extension.manifest.version = remoteVersion.version;
			extension.location = URI.file(`/extensions/pointa.basehalf-ai-video-${remoteVersion.version}`);
			extensionDirectories.set(extension.location.path, remoteVersion.version);
			if (!installed.includes(extension)) {
				installed.push(extension);
				enabled.add(extension);
			}
			assert.strictEqual(typeof installOptions.context?.basehalfVerifiedInstall, 'string');
			workbenchExtension.runtimeState = options.runtimeAction === undefined ? undefined : { action: options.runtimeAction };
			return workbenchExtension;
		},
		uninstall: async (candidate: any) => {
			nativeUninstallCalls.push(candidate);
			await management.uninstall(candidate.local);
			candidate.runtimeState = options.runtimeAction === undefined ? undefined : { action: options.runtimeAction };
		}
	};
	const service = new BaseHalfPluginManagementService(
		catalog,
		management as IWorkbenchExtensionManagementService,
		enablement as IWorkbenchExtensionEnablementService,
		extensionsWorkbench as IExtensionsWorkbenchService,
		fileService as IFileService,
		requestService as IRequestService,
		{ checksum: async () => options.checksum ?? sha256HexToChecksumBase64(remoteVersion?.sha256 ?? 'a'.repeat(64)) } as unknown as IChecksumService,
		{ tmpDir: URI.file('/tmp') } as INativeEnvironmentService,
		{ basehalfPlugins: { assetBaseUrl: 'http://127.0.0.1:8123/assets/' } } as IProductService,
		{ executeCommand: async (id: string) => { commands.push(id); } } as unknown as ICommandService,
		{ error() { }, warn() { } } as unknown as ILogService,
		admission
	);
	return {
		service,
		management,
		extensionsWorkbench,
		extension,
		workbenchExtension,
		commands,
		verifiedInstalls,
		forgottenInstalls,
		enablementCalls,
		deletedPaths,
		nativeUninstallCalls,
		locationInstallCalls,
		receiptReconciliations,
		fireInstallResult: context => {
			if (!installed.includes(extension)) {
				installed.push(extension);
			}
			installListener?.([{
				identifier: extension.identifier,
				local: extension,
				context
			}]);
		},
		fireUninstallResult: () => uninstallListener?.({ identifier: extension.identifier }),
		waitForReceiptReconciliation: () => {
			const waiter = new DeferredPromise<void>();
			reconciliationWaiters.push(waiter);
			return waiter.p;
		}
	};
}

function remotePlugin(version: string, sha256: string): IBaseHalfResolvedPlugin {
	const curated = BASEHALF_CURATED_PLUGINS[0];
	const remoteVersion = {
		version,
		basehalfRange: '*',
		vscodeRange: '*',
		targetPlatform: 'universal',
		assetPath: `${curated.extensionId}/${version}/${sha256}.vsix`,
		sha256,
		installedContentSha256: 'd'.repeat(64),
		size: 4,
		publishedAt: '2026-07-18T00:00:00.000Z',
		status: 'active' as const
	};
	return {
		...curated,
		remote: {
			extensionId: curated.extensionId,
			label: curated.label,
			description: curated.description,
			category: curated.category,
			versions: [remoteVersion]
		},
		remoteVersion
	};
}
