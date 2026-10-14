/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { basename, extUri } from '../../../base/common/resources.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { IFileContent, IFileService, IFileStatWithPartialMetadata } from '../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../contrib/webview/browser/webview.js';
import { IBaseHalfExtensionCardProjectionRuntimeService, IBaseHalfExtensionCardProjectionSession } from '../../basehalf/browser/cardDetail/basehalfExtensionCardProjection.js';
import { IBaseHalfCardDetailState } from '../../basehalf/common/basehalfCanvasNavigation.js';
import { IBaseHalfCardProjectionRegistryService } from '../../basehalf/common/basehalfCardDetail.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	IBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes
} from '../../basehalf/common/basehalfNodeDocument.js';
import { IBaseHalfNodeResult } from '../../basehalf/common/basehalfVideoNode.js';
import { IBaseHalfPluginAdmissionService, IBaseHalfPluginContributorIdentity } from '../../basehalf/common/basehalfPluginAdmissionService.js';
import { IBaseHalfPluginStructuralCleanupService } from '../../basehalf/common/basehalfPluginStructuralCleanup.js';
import { IBaseHalfProjectFileTransitionService } from '../../basehalf/common/basehalfProjectFileTransitions.js';
import { IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import * as extHostProtocol from '../common/extHost.protocol.js';
import { MainThreadWebviews, reviveWebviewExtension } from './mainThreadWebviews.js';

interface IBaseHalfRegisteredProjection {
	readonly extension: extHostProtocol.WebviewExtensionDescription;
	readonly options: { readonly retainContextWhenHidden?: boolean };
	readonly serializeBuffersForPostMessage: boolean;
}

interface IBaseHalfCanvasNodeReadState {
	readonly workspaceRealpath: URI;
	readonly nodeRealpath: URI;
	readonly nodeStat: IFileStatWithPartialMetadata;
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
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
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

	async $inspectCanvasNode(
		extension: extHostProtocol.IBaseHalfExtensionIdentityDto,
		resource: UriComponents
	): Promise<extHostProtocol.IBaseHalfCanvasNodeStateDto | undefined> {
		const contributor = reviveBaseHalfExtensionIdentity(extension);
		if (!this.pluginAdmissionService.isAllowedContributor(contributor)) {
			throw new Error(`Extension '${contributor.extensionId}' is not admitted to inspect BaseHalf canvas nodes.`);
		}
		const nodeResource = URI.revive(resource);
		if (nodeResource.query || nodeResource.fragment || !nodeResource.path.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			return undefined;
		}
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(nodeResource);
		if (!workspaceFolder || !await this.fileService.exists(nodeResource)) {
			return undefined;
		}
		const beforeRead = await this.resolveCanvasNodeReadState(workspaceFolder.uri, nodeResource);
		if (!beforeRead) {
			return undefined;
		}
		if (this.workingCopyService.isDirty(nodeResource)) {
			throw new Error('Save this node before inspecting its lifecycle.');
		}
		const source = await this.fileService.readFile(beforeRead.nodeRealpath, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		const afterRead = await this.resolveCanvasNodeReadState(workspaceFolder.uri, nodeResource);
		if (!afterRead || !sameCanvasNodeReadState(beforeRead, source, afterRead)) {
			return undefined;
		}
		const verifiedSource = await this.fileService.readFile(afterRead.nodeRealpath, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		const finalRead = await this.resolveCanvasNodeReadState(workspaceFolder.uri, nodeResource);
		if (!finalRead || !sameCanvasNodeReadState(afterRead, verifiedSource, finalRead) || !source.value.equals(verifiedSource.value)) {
			return undefined;
		}
		let document: IBaseHalfNodeDocument;
		try {
			document = parseBaseHalfNodeDocumentBytes(verifiedSource.value.buffer);
		} catch {
			return undefined;
		}
		// The shape stays the one Sequence reads (D58): a node with a video is a
		// `result`, a task maps to its phase, and version 5 nodes keep no attempts.
		const lifecycle: extHostProtocol.BaseHalfCanvasNodeLifecycleDto = document.result
			? 'result'
			: document.task?.state === 'submitting' || document.task?.state === 'running'
				? 'running'
				: document.task?.state === 'failed'
					? 'failed'
					: document.task?.state === 'stopped'
						? 'cancelled'
						: 'draft';
		const result = document.result === undefined
			? undefined
			: await this.toCanvasNodeResultDto(workspaceFolder.uri, document, document.result);
		return {
			id: document.id,
			kind: document.kind,
			lifecycle,
			...(result === undefined ? {} : { result }),
			attempts: []
		};
	}

	private async resolveCanvasNodeReadState(workspaceFolder: URI, nodeResource: URI): Promise<IBaseHalfCanvasNodeReadState | undefined> {
		const [workspaceRealpath, nodeRealpath, nodeStat] = await Promise.all([
			this.fileService.realpath(workspaceFolder),
			this.fileService.realpath(nodeResource),
			this.fileService.stat(nodeResource)
		]);
		if (!workspaceRealpath || !nodeRealpath || !nodeStat.isFile || nodeStat.isSymbolicLink
			|| !extUri.isEqualOrParent(nodeRealpath, workspaceRealpath) || extUri.isEqual(nodeRealpath, workspaceRealpath)) {
			return undefined;
		}
		return { workspaceRealpath, nodeRealpath, nodeStat };
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

	/**
	 * A generated video is reported as the result of an attempt whose id is its
	 * task id; an imported file keeps its own source. The artifact is available
	 * while its file exists.
	 */
	private async toCanvasNodeResultDto(
		workspaceFolder: URI,
		document: IBaseHalfNodeDocument,
		result: IBaseHalfNodeResult
	): Promise<extHostProtocol.IBaseHalfCanvasNodeResultDto> {
		const resource = URI.joinPath(workspaceFolder, ...result.artifact.path.split('/'));
		let integrity: extHostProtocol.BaseHalfCanvasArtifactIntegrityDto;
		try {
			integrity = (await this.fileService.stat(resource)).isFile ? 'available' : 'missing';
		} catch {
			integrity = 'missing';
		}
		const artifact: extHostProtocol.IBaseHalfCanvasNodeResultArtifactDto = {
			id: result.source === 'generated' ? result.generation.taskId : document.id,
			outputId: result.source,
			kind: document.kind,
			resource,
			integrity,
			label: basename(resource)
		};
		return result.source === 'generated'
			? { source: 'attempt', attemptId: result.generation.taskId, artifact }
			: { source: 'imported', artifact };
	}
}

function sameCanvasNodeReadState(
	beforeRead: IBaseHalfCanvasNodeReadState,
	source: IFileContent,
	afterRead: IBaseHalfCanvasNodeReadState
): boolean {
	return extUri.isEqual(beforeRead.workspaceRealpath, afterRead.workspaceRealpath)
		&& extUri.isEqual(beforeRead.nodeRealpath, afterRead.nodeRealpath)
		&& extUri.isEqual(source.resource, beforeRead.nodeRealpath)
		&& sameCanvasNodeFileIdentity(beforeRead.nodeStat, source)
		&& sameCanvasNodeFileIdentity(source, afterRead.nodeStat);
}

function sameCanvasNodeFileIdentity(
	left: Pick<IFileStatWithPartialMetadata, 'ctime' | 'mtime' | 'etag' | 'size'>,
	right: Pick<IFileStatWithPartialMetadata, 'ctime' | 'mtime' | 'etag' | 'size'>
): boolean {
	return left.ctime === right.ctime
		&& left.mtime === right.mtime
		&& left.etag === right.etag
		&& left.size === right.size;
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
