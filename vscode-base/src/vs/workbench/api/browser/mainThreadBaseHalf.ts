/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import { dirname, extUri } from '../../../base/common/resources.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { IFileService, IFileStatWithPartialMetadata } from '../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../contrib/webview/browser/webview.js';
import { IBaseHalfExtensionCardProjectionRuntimeService, IBaseHalfExtensionCardProjectionSession } from '../../basehalf/cardDetail/browser/basehalfExtensionCardProjection.js';
import { IBaseHalfCardDetailState } from '../../basehalf/navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfCardProjectionRegistryService } from '../../basehalf/cardDetail/common/basehalfCardDetail.js';
import { baseHalfGenerationKindOfPath } from '../../basehalf/video/common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardSnapshot, IBaseHalfGenerationCardStore } from '../../basehalf/video/common/basehalfVideoGeneration.js';
import { IBaseHalfPluginAdmissionService, IBaseHalfPluginContributorIdentity } from '../../basehalf/plugins/common/basehalfPluginAdmissionService.js';
import { IBaseHalfPluginStructuralCleanupService } from '../../basehalf/plugins/common/basehalfPluginStructuralCleanup.js';
import { IBaseHalfProjectFileTransitionService } from '../../basehalf/plugins/common/basehalfProjectFileTransitions.js';
import { IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import * as extHostProtocol from '../common/extHost.protocol.js';
import { MainThreadWebviews, reviveWebviewExtension } from './mainThreadWebviews.js';

interface IBaseHalfRegisteredProjection {
	readonly extension: extHostProtocol.WebviewExtensionDescription;
	readonly options: { readonly retainContextWhenHidden?: boolean };
	readonly serializeBuffersForPostMessage: boolean;
}

class MainThreadBaseHalfCardProjectionSession extends Disposable implements IBaseHalfExtensionCardProjectionSession {
	private readonly cancellation = this._register(new CancellationTokenSource());
	readonly handle = generateUuid();
	private webview: IWebviewElement | undefined;
	private visible = false;
	private dirty = false;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly state: IBaseHalfCardDetailState,
		private readonly projectionId: string,
		private readonly registration: IBaseHalfRegisteredProjection,
		private readonly proxy: extHostProtocol.ExtHostBaseHalfShape,
		private readonly mainThreadWebviews: MainThreadWebviews,
		private readonly webviewService: IWebviewService,
		private readonly onDisposeSession: () => void
	) {
		super();
	}

	async open(): Promise<void> {
		const contentOptions: extHostProtocol.IWebviewContentOptions = {};
		const webview = this.webviewService.createWebviewElement({
			providedViewType: this.projectionId,
			title: this.state.relativePath || this.state.resource.path,
			options: {
				purpose: WebviewContentPurpose.CustomEditor,
				retainContextWhenHidden: this.registration.options.retainContextWhenHidden ?? true,
				tryRestoreScrollPosition: true
			},
			contentOptions: {
				forwardUntrustedKeypressEvents: true
			},
			extension: reviveWebviewExtension(this.registration.extension)
		});
		this.webview = this._register(webview);
		webview.mountTo(this.container, mainWindow);
		this.mainThreadWebviews.addWebview(this.handle, webview, {
			serializeBuffersForPostMessage: this.registration.serializeBuffersForPostMessage
		});
		await this.proxy.$resolveCardProjection(
			this.state.resource,
			this.handle,
			this.projectionId,
			contentOptions,
			this.visible,
			this.cancellation.token
		);
	}

	flush(): Promise<boolean> {
		return Promise.resolve(!this.dirty);
	}

	setDirty(dirty: boolean): void {
		this.dirty = dirty;
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancellation.cancel();
		this.proxy.$disposeCardProjection(this.handle);
		this.onDisposeSession();
		super.dispose();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (this.webview) {
			this.proxy.$setCardProjectionVisible(this.handle, visible);
		}
	}

	focus(): void {
		this.webview?.focus();
	}
}

export class MainThreadBaseHalf extends Disposable implements extHostProtocol.MainThreadBaseHalfShape {
	private readonly proxy: extHostProtocol.ExtHostBaseHalfShape;
	private readonly registrations = this._register(new DisposableMap<string>());
	private readonly structuralCleanupRegistrations = this._register(new DisposableMap<string>());
	private readonly sessions = new Map<extHostProtocol.WebviewHandle, MainThreadBaseHalfCardProjectionSession>();

	constructor(
		context: IExtHostContext,
		private readonly mainThreadWebviews: MainThreadWebviews,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IBaseHalfCardProjectionRegistryService private readonly projectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfExtensionCardProjectionRuntimeService private readonly runtimeService: IBaseHalfExtensionCardProjectionRuntimeService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IBaseHalfGenerationCardStore private readonly generationCardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfProjectFileTransitionService private readonly projectFileTransitionService: IBaseHalfProjectFileTransitionService,
		@IBaseHalfPluginStructuralCleanupService private readonly pluginStructuralCleanupService: IBaseHalfPluginStructuralCleanupService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this.proxy = context.getProxy(extHostProtocol.ExtHostContext.ExtHostBaseHalf);
	}

	$registerCardProjectionProvider(
		extension: extHostProtocol.WebviewExtensionDescription,
		projectionId: string,
		options: { readonly retainContextWhenHidden?: boolean },
		serializeBuffersForPostMessage: boolean
	): void {
		const extensionId = extension.id.value.toLowerCase();
		if (!projectionId.toLowerCase().startsWith(`${extensionId}.`)) {
			throw new Error(`BaseHalf projection '${projectionId}' must start with '${extensionId}.'.`);
		}
		if (!this.projectionRegistryService.getProjection(projectionId)) {
			throw new Error(`BaseHalf projection '${projectionId}' is not declared in contributes.basehalfCardProjections.`);
		}
		const registration: IBaseHalfRegisteredProjection = { extension, options, serializeBuffersForPostMessage };
		const disposable = this.runtimeService.registerProvider(projectionId, {
			extensionId,
			create: (container, state) => {
				const session = new MainThreadBaseHalfCardProjectionSession(
					container,
					state,
					projectionId,
					registration,
					this.proxy,
					this.mainThreadWebviews,
					this.webviewService,
					() => this.sessions.delete(session.handle)
				);
				this.sessions.set(session.handle, session);
				return session;
			}
		});
		this.registrations.set(projectionId, disposable);
	}

	$unregisterCardProjectionProvider(projectionId: string): void {
		this.registrations.deleteAndDispose(projectionId);
	}

	$setCardProjectionDirty(handle: extHostProtocol.WebviewHandle, dirty: boolean): void {
		this.sessions.get(handle)?.setDirty(dirty);
	}

	/**
	 * What an admitted extension learns of a generation card (D63, generation
	 * cards, "Implementation boundaries"): its kind, whether it has its file,
	 * and the `id` of its `made.yaml`, read through the card store. Every
	 * resource that is not a generation card of an open local workspace folder
	 * answers nothing, and so does one that is a symbolic link or resolves
	 * outside its workspace folder. Nothing is written.
	 */
	async $inspectGenerationCard(
		extension: extHostProtocol.IBaseHalfExtensionIdentityDto,
		resource: UriComponents
	): Promise<extHostProtocol.IBaseHalfGenerationCardStateDto | undefined> {
		const contributor = reviveBaseHalfExtensionIdentity(extension);
		if (!this.pluginAdmissionService.isAllowedContributor(contributor)) {
			throw new Error(`Extension '${contributor.extensionId}' is not admitted to inspect BaseHalf generation cards.`);
		}
		const card = URI.revive(resource);
		if (card.scheme !== Schemas.file || card.query || card.fragment) {
			return undefined;
		}
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(card)?.uri;
		const relativePath = workspaceFolder ? extUri.relativePath(workspaceFolder, card) : undefined;
		if (!workspaceFolder || !relativePath || relativePath === '..' || relativePath.startsWith('../')
			|| relativePath.split('/').some(segment => segment.toLowerCase() === '.bh')
			|| !baseHalfGenerationKindOfPath(relativePath)
			|| !await this.resolvesInside(workspaceFolder, card)
			|| !await this.generationCardStore.isGenerationCard(card)) {
			return undefined;
		}
		let snapshot: IBaseHalfGenerationCardSnapshot;
		try {
			snapshot = await this.generationCardStore.read(card);
		} catch {
			return undefined;
		}
		return {
			kind: snapshot.kind,
			hasFile: snapshot.hasFile,
			...(snapshot.made ? { generationId: snapshot.made.id } : {})
		};
	}

	/**
	 * Whether a card is a regular file that resolves inside its workspace
	 * folder, or a draft whose folder does: never a symbolic link.
	 */
	private async resolvesInside(workspaceFolder: URI, card: URI): Promise<boolean> {
		const [workspaceRealpath, stat] = await Promise.all([this.realpathQuietly(workspaceFolder), this.statQuietly(card)]);
		if (!workspaceRealpath) {
			return false;
		}
		if (stat && (stat.isSymbolicLink || !stat.isFile)) {
			return false;
		}
		const realpath = await this.realpathQuietly(stat ? card : dirname(card));
		return !!realpath && extUri.isEqualOrParent(realpath, workspaceRealpath) && (!stat || !extUri.isEqual(realpath, workspaceRealpath));
	}

	private async statQuietly(resource: URI): Promise<IFileStatWithPartialMetadata | undefined> {
		try {
			return await this.fileService.stat(resource);
		} catch {
			return undefined;
		}
	}

	private async realpathQuietly(resource: URI): Promise<URI | undefined> {
		try {
			return await this.fileService.realpath(resource);
		} catch {
			return undefined;
		}
	}

	async $applyProjectFileTransition(
		extension: extHostProtocol.IBaseHalfExtensionIdentityDto,
		resource: UriComponents,
		expected: VSBuffer,
		next: VSBuffer,
		label: string
	): Promise<void> {
		const contributor = reviveBaseHalfExtensionIdentity(extension);
		if (!this.pluginAdmissionService.isAllowedContributor(contributor)) {
			throw new Error(`Extension '${contributor.extensionId}' is not admitted to change BaseHalf project files.`);
		}
		// A plugin-originated transition never carries the host `origin`, so the
		// transition service rejects any change of an upstream value (D37).
		await this.projectFileTransitionService.apply({
			resource: URI.revive(resource),
			expected,
			next,
			label
		});
	}

	$registerCanvasStructuralCleanupProvider(extension: extHostProtocol.IBaseHalfExtensionIdentityDto): void {
		const contributor = reviveBaseHalfExtensionIdentity(extension);
		const extensionId = contributor.extensionId.toLowerCase();
		if (!this.pluginAdmissionService.isAllowedContributor(contributor)) {
			throw new Error(`Extension '${contributor.extensionId}' is not admitted to register BaseHalf structural cleanup.`);
		}
		this.structuralCleanupRegistrations.set(extensionId, this.pluginStructuralCleanupService.registerProvider(extensionId, {
			prepareDelete: async (resource, token) => {
				if (!this.pluginAdmissionService.isAllowedContributor(contributor)) {
					throw new Error(`Extension '${contributor.extensionId}' is no longer admitted to change BaseHalf project structure.`);
				}
				const transitions = await this.proxy.$prepareCanvasStructuralCleanup(extensionId, resource, token);
				// Plugin-originated: staged through the upstream guard (D37).
				return transitions.map(transition => ({
					resource: URI.revive(transition.resource),
					expected: transition.expected,
					next: transition.next,
					label: transition.label
				}));
			}
		}));
	}

	$unregisterCanvasStructuralCleanupProvider(extensionId: string): void {
		this.structuralCleanupRegistrations.deleteAndDispose(extensionId.toLowerCase());
	}

	override dispose(): void {
		// An Extension Host restart tears down the customer before constructing a
		// replacement. Dispose every live webview session so card detail can show
		// its reconnecting state instead of retaining a dead proxy/webview pair.
		for (const session of [...this.sessions.values()]) {
			session.dispose();
		}
		this.sessions.clear();
		super.dispose();
	}
}

function reviveBaseHalfExtensionIdentity(extension: extHostProtocol.IBaseHalfExtensionIdentityDto): IBaseHalfPluginContributorIdentity {
	return {
		extensionId: extension.id.value,
		version: extension.version,
		extensionLocation: URI.revive(extension.location),
		isBuiltin: extension.isBuiltin,
		isUnderDevelopment: extension.isUnderDevelopment
	};
}
