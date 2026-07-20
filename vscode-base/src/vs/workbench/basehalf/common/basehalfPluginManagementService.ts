/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../base/common/async.js';
import { CancellationError, getErrorMessage } from '../../../base/common/errors.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { compare } from '../../../base/common/semver/semver.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { listenStream, newWriteableStream, ReadableStream } from '../../../base/common/stream.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IChecksumService } from '../../../platform/checksum/common/checksumService.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { INativeEnvironmentService } from '../../../platform/environment/common/environment.js';
import { ILocalExtension } from '../../../platform/extensionManagement/common/extensionManagement.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IRequestService, isSuccess, readHeader } from '../../../platform/request/common/request.js';
import { ExtensionRuntimeActionType, IExtension, IExtensionsWorkbenchService } from '../../contrib/extensions/common/extensions.js';
import { EnablementState, IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService } from '../../services/extensionManagement/common/extensionManagement.js';
import { baseHalfPluginPayloadLocation, IBaseHalfResolvedPlugin, resolveBaseHalfPluginAsset } from './basehalfPluginCatalog.js';
import { IBaseHalfPluginCatalogService } from './basehalfPluginCatalogService.js';
import { sha256HexToChecksumBase64 } from './basehalfPluginCatalogSecurity.js';
import { authorizeBaseHalfLocationInstall, authorizeBaseHalfVerifiedVSIXInstall, BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT } from './basehalfExtensionInstallPolicy.js';
import { IBaseHalfManagedPlugin, IBaseHalfPluginCatalogStatus, IBaseHalfPluginManagementService, IBaseHalfPluginOperationResult } from './basehalfPluginManagement.js';
import { hashBaseHalfPluginInstall, IBaseHalfPluginAdmissionService, IBaseHalfVerifiedPluginInstall } from './basehalfPluginAdmissionService.js';

type Operation = 'installing' | 'updating' | 'restoring';

interface IBaseHalfPreviousPluginInstallation {
	readonly extensionId: string;
	readonly version: string;
	readonly location: URI;
	readonly backupLocation: URI;
	readonly installedContentSha256: string;
	readonly verifiedInstall: IBaseHalfVerifiedPluginInstall | undefined;
	readonly enablementState: EnablementState;
}

export class BaseHalfPluginManagementService extends Disposable implements IBaseHalfPluginManagementService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;
	private readonly operations = new Map<string, Operation>();
	private readonly cancellations = new Map<string, CancellationTokenSource>();
	private readonly errors = new Map<string, string>();
	private readonly queues = new Map<string, Promise<unknown>>();
	private readonly receiptReconciliations = new Map<string, Promise<void>>();

	constructor(
		@IBaseHalfPluginCatalogService private readonly catalogService: IBaseHalfPluginCatalogService,
		@IWorkbenchExtensionManagementService private readonly extensionManagementService: IWorkbenchExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly enablementService: IWorkbenchExtensionEnablementService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IFileService private readonly fileService: IFileService,
		@IRequestService private readonly requestService: IRequestService,
		@IChecksumService private readonly checksumService: IChecksumService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IProductService private readonly productService: IProductService,
		@ICommandService private readonly commandService: ICommandService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this._register(this.catalogService.onDidChange(() => this._onDidChange.fire()));
		this._register(this.extensionManagementService.onDidInstallExtensions(results => {
			for (const result of results) {
				const extensionId = result.identifier.id.toLowerCase();
				if (!result.error && result.local && !isVerifiedPluginInstallEvent(result.context)) {
					this.queueReceiptReconciliation(extensionId);
				}
			}
			this._onDidChange.fire();
		}));
		this._register(this.extensionManagementService.onDidUninstallExtension(event => {
			if (!event.error) {
				this.queueReceiptReconciliation(event.identifier.id);
			}
			this._onDidChange.fire();
		}));
		this._register(this.enablementService.onEnablementChanged(() => this._onDidChange.fire()));
	}

	private queueReceiptReconciliation(extensionId: string): void {
		const id = extensionId.trim().toLowerCase();
		const previous = this.receiptReconciliations.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(async () => {
			const installed = (await this.extensionManagementService.getInstalled())
				.filter(candidate => candidate.identifier.id.toLowerCase() === id)
				.map(candidate => ({ version: candidate.manifest.version, extensionLocation: candidate.location }));
			await this.pluginAdmissionService.reconcileVerifiedInstalls(id, installed);
		}).catch(async error => {
			this.logService.error(`BaseHalf plugin receipt reconciliation failed for ${id}: ${getErrorMessage(error)}`);
			try {
				await this.pluginAdmissionService.reverifyVerifiedInstalls();
			} catch (reverifyError) {
				this.logService.error(`BaseHalf plugin receipt re-verification failed for ${id}: ${getErrorMessage(reverifyError)}`);
			}
		}).finally(() => {
			if (this.receiptReconciliations.get(id) === next) {
				this.receiptReconciliations.delete(id);
			}
			this._onDidChange.fire();
		});
		this.receiptReconciliations.set(id, next);
	}

	async getPlugins(): Promise<readonly IBaseHalfManagedPlugin[]> {
		const [snapshot, installed] = await Promise.all([
			this.catalogService.getSnapshot(),
			this.extensionManagementService.getInstalled()
		]);
		const plugins = await Promise.all(snapshot.plugins.map(async plugin => {
			const extension = installed.find(candidate => candidate.identifier.id.toLowerCase() === plugin.extensionId.toLowerCase());
			const payloadLocation = baseHalfPluginPayloadLocation(plugin, this.environmentService.isBuilt);
			const bundledAvailable = payloadLocation ? await this.fileService.exists(payloadLocation) : false;
			const installedVersion = extension?.manifest.version;
			const installedVersionWithdrawn = !!installedVersion && plugin.remote?.versions.some(version =>
				version.version === installedVersion && version.status === 'withdrawn'
			);
			const enabled = !!extension && this.enablementService.isEnabled(extension);
			const operation = this.operations.get(plugin.extensionId);
			const allRemoteVersionsWithdrawn = isPluginWithdrawn(plugin);
			let state: IBaseHalfManagedPlugin['state'];
			if (operation) {
				state = operation;
			} else if (this.errors.has(plugin.extensionId)) {
				state = 'error';
			} else if (!extension && allRemoteVersionsWithdrawn) {
				state = 'withdrawn';
			} else if (extension && getBaseHalfPluginVersionChange(installedVersion, plugin.remoteVersion?.version) === 'update') {
				state = 'updateAvailable';
			} else if (extension && getBaseHalfPluginVersionChange(installedVersion, plugin.remoteVersion?.version) === 'restore') {
				state = 'restoreAvailable';
			} else if (extension && installedVersionWithdrawn) {
				state = 'withdrawn';
			} else if (extension) {
				state = enabled ? 'enabled' : 'disabled';
			} else if (plugin.remote && !plugin.remoteVersion && !bundledAvailable) {
				state = 'incompatible';
			} else {
				state = 'available';
			}
			return {
				...plugin,
				state,
				installedVersion,
				availableVersion: plugin.remoteVersion?.version,
				bundledAvailable,
				enabled,
				busy: !!operation,
				cancellable: this.cancellations.has(plugin.extensionId),
				hasConfiguration: !!extension?.manifest.contributes?.configuration,
				error: this.errors.get(plugin.extensionId)
			};
		}));
		// A withdrawn package remains visible as a lifecycle state. New installs
		// are blocked, while an existing installation can still be disabled or
		// removed and can be explicitly restored when the catalog names an
		// earlier reviewed version.
		return plugins;
	}

	async refreshCatalog(): Promise<void> {
		await this.catalogService.refresh();
	}

	async getCatalogStatus(): Promise<IBaseHalfPluginCatalogStatus> {
		const { source, sequence, generatedAt, error } = await this.catalogService.getSnapshot();
		return { source, sequence, generatedAt, error };
	}

	install(extensionId: string): Promise<IBaseHalfPluginOperationResult> {
		return this.runExclusive(extensionId, 'installing', async plugin => {
			if (isPluginWithdrawn(plugin)) {
				throw new Error('This plugin has been withdrawn and cannot be newly installed.');
			}
			if (plugin.remoteVersion) {
				return this.installRemote(plugin);
			} else {
				if (!plugin.bundledPath) {
					throw new Error('No compatible reviewed package is available for this plugin.');
				}
				const location = baseHalfPluginPayloadLocation(plugin, this.environmentService.isBuilt);
				if (!location) {
					throw new Error(`Plugin '${plugin.extensionId}' does not have a bundled payload.`);
				}
				if (!await this.fileService.exists(location)) {
					throw new Error('This official plugin is not included in the current build and no compatible remote version is available.');
				}
				const locationAuthorization = authorizeBaseHalfLocationInstall(location);
				try {
					await this.extensionManagementService.installFromLocation(location);
				} finally {
					locationAuthorization.dispose();
				}
			}
			return { restartRequired: false };
		});
	}

	update(extensionId: string): Promise<IBaseHalfPluginOperationResult> {
		return this.runExclusive(extensionId, 'updating', async plugin => {
			if (!plugin.remoteVersion) {
				throw new Error('No compatible remote update is available.');
			}
			const installedVersion = await this.installedVersion(plugin.extensionId);
			if (compare(plugin.remoteVersion.version, installedVersion) <= 0) {
				throw new Error('No newer compatible plugin version is available.');
			}
			return this.installRemote(plugin);
		});
	}

	restore(extensionId: string): Promise<IBaseHalfPluginOperationResult> {
		return this.runExclusive(extensionId, 'restoring', async plugin => {
			if (!plugin.remoteVersion) {
				throw new Error('No compatible signed restore version is available.');
			}
			const installedVersion = await this.installedVersion(plugin.extensionId);
			if (compare(plugin.remoteVersion.version, installedVersion) >= 0) {
				throw new Error('No earlier compatible plugin version is available to restore.');
			}
			return this.installRemote(plugin);
		});
	}

	enable(extensionId: string): Promise<IBaseHalfPluginOperationResult> {
		return this.withInstalled(extensionId, async extension => ({
			restartRequired: (await this.enablementService.setEnablement([extension], EnablementState.EnabledGlobally)).some(Boolean)
		}));
	}

	disable(extensionId: string): Promise<IBaseHalfPluginOperationResult> {
		return this.withInstalled(extensionId, async extension => ({
			restartRequired: (await this.enablementService.setEnablement([extension], EnablementState.DisabledGlobally)).some(Boolean)
		}));
	}

	uninstall(extensionId: string): Promise<IBaseHalfPluginOperationResult> {
		const id = extensionId.toLowerCase();
		return this.runExclusive(id, 'updating', async () => {
			const extension = (await this.extensionsWorkbenchService.queryLocal())
				.find(candidate => candidate.identifier.id.toLowerCase() === id && !!candidate.local);
			if (!extension) {
				throw new Error(`Plugin '${id}' is not installed.`);
			}
			await this.extensionsWorkbenchService.uninstall(extension);
			this.pluginAdmissionService.forgetVerifiedInstalls(extensionId);
			return pluginRuntimeOperationResult(extension);
		});
	}

	async executePrimary(extensionId: string): Promise<void> {
		const snapshot = await this.catalogService.getSnapshot();
		const plugin = snapshot.plugins.find(candidate => candidate.extensionId === extensionId.toLowerCase());
		if (!plugin?.primaryCommand) {
			throw new Error('This plugin does not expose a primary action.');
		}
		await this.commandService.executeCommand(plugin.primaryCommand);
	}

	cancel(extensionId: string): void {
		this.cancellations.get(extensionId.toLowerCase())?.cancel();
	}

	private runExclusive(
		extensionId: string,
		operation: Operation,
		run: (plugin: IBaseHalfResolvedPlugin) => Promise<IBaseHalfPluginOperationResult>
	): Promise<IBaseHalfPluginOperationResult> {
		const id = extensionId.toLowerCase();
		const previous = this.queues.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(async () => {
			this.operations.set(id, operation);
			this.errors.delete(id);
			this._onDidChange.fire();
			try {
				const snapshot = await this.catalogService.getSnapshot();
				const plugin = snapshot.plugins.find(candidate => candidate.extensionId === id);
				if (!plugin) {
					throw new Error(`Plugin '${id}' is not admitted by this BaseHalf build.`);
				}
				return await run(plugin);
			} catch (error) {
				if (error instanceof CancellationError) {
					throw error;
				}
				const message = getErrorMessage(error);
				this.errors.set(id, message);
				this.logService.error(`BaseHalf plugin operation failed for ${id}: ${message}`);
				throw error;
			} finally {
				this.operations.delete(id);
				this.cancellations.get(id)?.dispose();
				this.cancellations.delete(id);
				this._onDidChange.fire();
			}
		});
		this.queues.set(id, next);
		void next.then(() => {
			if (this.queues.get(id) === next) {
				this.queues.delete(id);
			}
		}, () => {
			if (this.queues.get(id) === next) {
				this.queues.delete(id);
			}
		});
		return next;
	}

	private async withInstalled(
		extensionId: string,
		run: (extension: Awaited<ReturnType<IWorkbenchExtensionManagementService['getInstalled']>>[number]) => Promise<IBaseHalfPluginOperationResult>
	): Promise<IBaseHalfPluginOperationResult> {
		const id = extensionId.toLowerCase();
		return this.runExclusive(id, 'updating', async () => {
			const extension = (await this.extensionManagementService.getInstalled()).find(candidate => candidate.identifier.id.toLowerCase() === id);
			if (!extension) {
				throw new Error(`Plugin '${id}' is not installed.`);
			}
			return run(extension);
		});
	}

	private async installedVersion(extensionId: string): Promise<string> {
		const extension = (await this.extensionManagementService.getInstalled())
			.find(candidate => candidate.identifier.id.toLowerCase() === extensionId.toLowerCase());
		if (!extension) {
			throw new Error(`Plugin '${extensionId}' is not installed.`);
		}
		return extension.manifest.version;
	}

	private async installRemote(plugin: IBaseHalfResolvedPlugin): Promise<IBaseHalfPluginOperationResult> {
		const config = this.productService.basehalfPlugins;
		const version = plugin.remoteVersion;
		if (!config || !version) {
			throw new Error('Remote plugin distribution is not configured.');
		}
		const asset = resolveBaseHalfPluginAsset(config.assetBaseUrl, version.assetPath);
		const cancellation = new CancellationTokenSource();
		const requestTimeout = disposableTimeout(() => cancellation.cancel(), 120_000);
		this.cancellations.set(plugin.extensionId, cancellation);
		this._onDidChange.fire();
		const directory = joinPath(this.environmentService.tmpDir, `basehalf-plugin-${generateUuid()}`);
		const partial = joinPath(directory, 'download.partial');
		const vsix = joinPath(directory, 'plugin.vsix');
		let preserveRecoveryCopy = false;
		try {
			await this.fileService.createFolder(directory);
			const context = await this.requestService.request({ type: 'GET', url: asset.href, callSite: 'basehalfPluginManagementService.download' }, cancellation.token);
			if (!isSuccess(context)) {
				throw new Error(`Plugin download returned ${context.res.statusCode}.`);
			}
			const contentLength = readHeader(context.res.headers, 'content-length');
			if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) !== version.size)) {
				throw new Error(`Plugin download Content-Length mismatch: expected ${version.size}, received ${contentLength}.`);
			}
			await this.fileService.writeFile(partial, limitBaseHalfPluginDownloadStream(context.stream, version.size, cancellation));
			if (cancellation.token.isCancellationRequested) {
				throw new CancellationError();
			}
			const stat = await this.fileService.resolve(partial);
			if (stat.size !== version.size) {
				throw new Error(`Plugin download size mismatch: expected ${version.size}, received ${stat.size}.`);
			}
			const checksum = await this.checksumService.checksum(partial);
			if (checksum !== sha256HexToChecksumBase64(version.sha256)) {
				throw new Error('Plugin download failed SHA-256 verification.');
			}
			if (cancellation.token.isCancellationRequested) {
				throw new CancellationError();
			}
			await this.fileService.move(partial, vsix, true);
			const manifest = await this.extensionManagementService.getManifest(vsix);
			const manifestId = `${manifest.publisher}.${manifest.name}`.toLowerCase();
			if (manifestId !== plugin.extensionId || manifest.version !== version.version) {
				throw new Error(`Plugin package manifest mismatch: expected ${plugin.extensionId}@${version.version}, received ${manifestId}@${manifest.version}.`);
			}
			if (cancellation.token.isCancellationRequested) {
				throw new CancellationError();
			}
			this.finishRemoteCancellablePhase(plugin.extensionId, cancellation, requestTimeout);
			const previousInstallation = await this.backupPreviousInstallation(plugin.extensionId, joinPath(directory, 'previous-extension'));
				const installAuthorization = authorizeBaseHalfVerifiedVSIXInstall(plugin.extensionId, version.version);
				const installToken = installAuthorization.token;
				let local: ILocalExtension | undefined;
			try {
				try {
					const installed = await this.extensionsWorkbenchService.install(vsix, {
						installGivenVersion: true,
						context: { [BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT]: installToken }
					});
					local = installed.local ?? (await this.extensionManagementService.getInstalled()).find(candidate =>
						candidate.identifier.id.toLowerCase() === plugin.extensionId
						&& candidate.manifest.version === version.version
					);
					const recorded = !!local && await this.pluginAdmissionService.verifyAndRecordInstall({
						extensionId: plugin.extensionId,
						version: version.version,
						sha256: version.sha256,
						extensionLocation: local.location,
						expectedInstalledContentSha256: version.installedContentSha256
					});
					if (!recorded) {
						throw new Error('The signed plugin grant changed or installed plugin content could not be verified. Refresh the catalog and try again.');
					}
						return pluginRuntimeOperationResult(installed);
				} catch (installationError) {
					const recoveryErrors: unknown[] = [];
					if (!local) {
						try {
							local = (await this.extensionManagementService.getInstalled()).find(candidate =>
								candidate.identifier.id.toLowerCase() === plugin.extensionId
							);
						} catch (error) {
							recoveryErrors.push(error);
						}
					}
					try {
						await this.rollbackRemoteInstallation(local, previousInstallation);
					} catch (error) {
						recoveryErrors.push(error);
					}
					if (recoveryErrors.length) {
						preserveRecoveryCopy = !!previousInstallation;
						const recoveryMessage = previousInstallation
							? `Plugin installation failed and the previous installation could not be fully restored. Its recovery copy remains at '${directory.toString(true)}'.`
							: 'Plugin installation failed and the incomplete installation could not be fully removed.';
						throw new AggregateError([installationError, ...recoveryErrors], recoveryMessage);
					}
					throw installationError;
				}
				} finally {
					installAuthorization.disposable.dispose();
				}
		} finally {
			requestTimeout.dispose();
			if (!preserveRecoveryCopy) {
				try {
					await this.fileService.del(directory, { recursive: true });
				} catch (error) {
					this.logService.warn(`Could not remove BaseHalf plugin download directory: ${getErrorMessage(error)}`);
				}
			}
		}
	}

	private finishRemoteCancellablePhase(extensionId: string, cancellation: CancellationTokenSource, requestTimeout: { dispose(): void }): void {
		requestTimeout.dispose();
		if (this.cancellations.get(extensionId) === cancellation) {
			this.cancellations.delete(extensionId);
			cancellation.dispose();
			this._onDidChange.fire();
		}
	}

	private async backupPreviousInstallation(extensionId: string, backupLocation: URI): Promise<IBaseHalfPreviousPluginInstallation | undefined> {
		const previous = (await this.extensionManagementService.getInstalled()).find(candidate =>
			candidate.identifier.id.toLowerCase() === extensionId
		);
		if (!previous) {
			return undefined;
		}
		const installedContentSha256 = await hashBaseHalfPluginInstall(this.fileService, previous.location);
		await this.fileService.copy(previous.location, backupLocation, false);
		const backupContentSha256 = await hashBaseHalfPluginInstall(this.fileService, backupLocation);
		if (backupContentSha256 !== installedContentSha256) {
			throw new Error('The installed plugin changed while its recovery copy was being created.');
		}
		return {
			extensionId,
			version: previous.manifest.version,
			location: previous.location,
			backupLocation,
			installedContentSha256,
			verifiedInstall: this.pluginAdmissionService.getVerifiedInstall(extensionId, previous.manifest.version, previous.location),
			enablementState: this.enablementService.getEnablementState(previous)
		};
	}

	private async rollbackRemoteInstallation(
		installed: ILocalExtension | undefined,
		previous: IBaseHalfPreviousPluginInstallation | undefined
	): Promise<void> {
		const failures: unknown[] = [];
		if (installed) {
			try {
				await this.extensionManagementService.uninstall(installed);
			} catch (error) {
				failures.push(error);
			}
		}
		if (!previous) {
			if (failures.length) {
				throw new AggregateError(failures, 'The unverified plugin could not be removed.');
			}
			return;
		}

		try {
			let currentContentSha256: string | undefined;
			try {
				currentContentSha256 = await hashBaseHalfPluginInstall(this.fileService, previous.location);
			} catch {
				// The verified recovery copy below is authoritative for this transaction.
			}
			if (currentContentSha256 !== previous.installedContentSha256) {
				await this.fileService.copy(previous.backupLocation, previous.location, true);
			}
			if (await hashBaseHalfPluginInstall(this.fileService, previous.location) !== previous.installedContentSha256) {
				throw new Error('The previous plugin content could not be restored exactly.');
			}
			const locationAuthorization = authorizeBaseHalfLocationInstall(previous.location);
			let restored: ILocalExtension;
			try {
				restored = await this.extensionManagementService.installFromLocation(previous.location);
			} finally {
				locationAuthorization.dispose();
			}
			const restoredId = `${restored.manifest.publisher}.${restored.manifest.name}`.toLowerCase();
			if (restoredId !== previous.extensionId || restored.manifest.version !== previous.version) {
				throw new Error(`The recovery copy restored ${restoredId}@${restored.manifest.version} instead of ${previous.extensionId}@${previous.version}.`);
			}
			if (previous.enablementState === EnablementState.EnabledGlobally
				|| previous.enablementState === EnablementState.DisabledGlobally
				|| previous.enablementState === EnablementState.EnabledWorkspace
				|| previous.enablementState === EnablementState.DisabledWorkspace) {
				await this.enablementService.setEnablement([restored], previous.enablementState);
			}
			if (previous.verifiedInstall && !await this.pluginAdmissionService.verifyAndRecordInstall({
				extensionId: previous.verifiedInstall.extensionId,
				version: previous.verifiedInstall.version,
				sha256: previous.verifiedInstall.sha256,
				extensionLocation: previous.verifiedInstall.extensionLocation,
				expectedInstalledContentSha256: previous.verifiedInstall.installedContentSha256
			})) {
				throw new Error('The previous plugin installation receipt could not be restored.');
			}
		} catch (error) {
			failures.push(error);
		}
		if (failures.length) {
			throw new AggregateError(failures, 'The previous plugin installation could not be fully restored.');
		}
	}
}

export function isVerifiedPluginInstallEvent(context: Record<string, unknown> | undefined): boolean {
	const token = context?.[BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT];
	return typeof token === 'string' && token.length > 0 && token.length <= 256;
}

export function requiresPluginRuntimeRestart(action: ExtensionRuntimeActionType | undefined): boolean {
	return action === ExtensionRuntimeActionType.RestartExtensions
		|| action === ExtensionRuntimeActionType.ReloadWindow;
}

function pluginRuntimeOperationResult(extension: IExtension): IBaseHalfPluginOperationResult {
	return { restartRequired: requiresPluginRuntimeRestart(extension.runtimeState?.action) };
}

export function getBaseHalfPluginVersionChange(installedVersion: string | undefined, availableVersion: string | undefined): 'update' | 'restore' | undefined {
	if (!installedVersion || !availableVersion || installedVersion === availableVersion) {
		return undefined;
	}
	return compare(availableVersion, installedVersion) > 0 ? 'update' : 'restore';
}

export function limitBaseHalfPluginDownloadStream(
	stream: ReadableStream<VSBuffer>,
	maximumBytes: number,
	cancellation: CancellationTokenSource
): ReadableStream<VSBuffer> {
	const target = newWriteableStream<VSBuffer>(chunks => VSBuffer.concat(chunks));
	let size = 0;
	let settled = false;
	listenStream(stream, {
		onData: chunk => {
			if (settled) {
				return;
			}
			size += chunk.byteLength;
			if (size > maximumBytes) {
				settled = true;
				cancellation.cancel();
				target.error(new Error(`Plugin download exceeds the signed size of ${maximumBytes} bytes.`));
				return;
			}
			target.write(chunk);
		},
		onError: error => {
			if (!settled) {
				settled = true;
				target.error(error);
			}
		},
		onEnd: () => {
			if (!settled) {
				settled = true;
				target.end();
			}
		}
	});
	return target;
}

function isPluginWithdrawn(plugin: IBaseHalfResolvedPlugin): boolean {
	return !!plugin.remote?.versions.length && plugin.remote.versions.every(version => version.status === 'withdrawn');
}

registerSingleton(IBaseHalfPluginManagementService, BaseHalfPluginManagementService, InstantiationType.Delayed);
