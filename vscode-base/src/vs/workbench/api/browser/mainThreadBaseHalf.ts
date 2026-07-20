/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { Limiter } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { extUri } from '../../../base/common/resources.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { IFileContent, IFileService, IFileStatWithPartialMetadata } from '../../../platform/files/common/files.js';
import { IProgress } from '../../../platform/progress/common/progress.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../contrib/webview/browser/webview.js';
import { IBaseHalfExtensionCardProjectionRuntimeService, IBaseHalfExtensionCardProjectionSession } from '../../basehalf/browser/cardDetail/basehalfExtensionCardProjection.js';
import { IBaseHalfNodeExecutionService } from '../../basehalf/browser/basehalfNodeExecutionService.js';
import { IBaseHalfCardDetailState } from '../../basehalf/common/basehalfCanvasNavigation.js';
import { IBaseHalfCardProjectionRegistryService } from '../../basehalf/common/basehalfCardDetail.js';
import {
	IBaseHalfCanvasNodeSnapshot,
	IBaseHalfCanvasRecipeExecutionRequest,
	IBaseHalfCanvasRecipeExecutionResult,
	IBaseHalfCanvasRecipeProgress,
	IBaseHalfCanvasRecipeRegistryService,
	IBaseHalfCanvasRecipeRuntimeService
} from '../../basehalf/common/basehalfCanvasRecipes.js';
import { BaseHalfModelCapability, IBaseHalfModelServiceService } from '../../basehalf/common/basehalfModelServices.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BASEHALF_NODE_MAX_ID_LENGTH,
	IBaseHalfNodeDocument,
	IBaseHalfNodeRunArtifact,
	parseBaseHalfNodeDocumentBytes,
	parseBaseHalfNodeDocumentBytesForActiveHost
} from '../../basehalf/common/basehalfNodeDocument.js';
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

const BASEHALF_CANVAS_NODE_INSPECT_MAX_VERSION_IDS = 256;
const BASEHALF_CANVAS_NODE_INSPECT_DEFAULT_VERSION_LIMIT = 256;
const BASEHALF_CANVAS_NODE_INSPECT_MAX_CONCURRENT_INTEGRITY_CHECKS = 8;

interface IBaseHalfNormalizedCanvasNodeInspectOptions {
	readonly versionIds: readonly string[];
	readonly includeCurrent: boolean;
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
	private readonly recipeRegistrations = this._register(new DisposableMap<string>());
	private readonly structuralCleanupRegistrations = this._register(new DisposableMap<string>());
	private readonly canvasNodeVersionLimiter = this._register(new Limiter<extHostProtocol.IBaseHalfCanvasNodeVersionDto>(
		BASEHALF_CANVAS_NODE_INSPECT_MAX_CONCURRENT_INTEGRITY_CHECKS
	));
	private readonly sessions = new Map<extHostProtocol.WebviewHandle, MainThreadBaseHalfCardProjectionSession>();
	private readonly recipeRuns = new Map<string, {
		readonly progress: IProgress<IBaseHalfCanvasRecipeProgress>;
		readonly cancellation: CancellationTokenSource;
		readonly extensionId: string;
		readonly modelService?: extHostProtocol.IBaseHalfModelServiceRunSnapshotDto;
	}>();

	constructor(
		context: IExtHostContext,
		private readonly mainThreadWebviews: MainThreadWebviews,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IBaseHalfCardProjectionRegistryService private readonly projectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfExtensionCardProjectionRuntimeService private readonly runtimeService: IBaseHalfExtensionCardProjectionRuntimeService,
		@IBaseHalfCanvasRecipeRegistryService private readonly recipeRegistryService: IBaseHalfCanvasRecipeRegistryService,
		@IBaseHalfCanvasRecipeRuntimeService private readonly recipeRuntimeService: IBaseHalfCanvasRecipeRuntimeService,
		@IBaseHalfModelServiceService private readonly modelServiceService: IBaseHalfModelServiceService,
		@IBaseHalfNodeExecutionService private readonly nodeExecutionService: IBaseHalfNodeExecutionService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IBaseHalfProjectFileTransitionService private readonly projectFileTransitionService: IBaseHalfProjectFileTransitionService,
		@IBaseHalfPluginStructuralCleanupService private readonly pluginStructuralCleanupService: IBaseHalfPluginStructuralCleanupService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super();
		this.proxy = context.getProxy(extHostProtocol.ExtHostContext.ExtHostBaseHalf);
		this._register(this.modelServiceService.onDidChange(() => this.proxy.$onDidChangeModelServices()));
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

	$registerCanvasRecipeExecutor(extension: extHostProtocol.WebviewExtensionDescription, recipeId: string): void {
		const extensionId = extension.id.value.toLowerCase();
		const id = recipeId.toLowerCase();
		if (!id.startsWith(`${extensionId}.`)) {
			throw new Error(`BaseHalf canvas recipe '${recipeId}' must start with '${extensionId}.'.`);
		}
		const recipe = this.recipeRegistryService.getRecipe(id);
		if (!recipe || recipe.extensionId !== extensionId) {
			throw new Error(`BaseHalf canvas recipe '${recipeId}' is not declared by extension '${extensionId}'.`);
		}
		const registration = this.recipeRuntimeService.registerExecutor(id, {
			extensionId,
			execute: (request, progress, token) => this.executeCanvasRecipe(extensionId, id, request, progress, token)
		});
		this.recipeRegistrations.set(id, registration);
	}

	$unregisterCanvasRecipeExecutor(recipeId: string): void {
		this.recipeRegistrations.deleteAndDispose(recipeId.toLowerCase());
	}

	$reportCanvasRecipeProgress(runHandle: string, progress: extHostProtocol.IBaseHalfCanvasRecipeProgressDto): void {
		const run = this.recipeRuns.get(runHandle);
		if (!run || !progress || typeof progress !== 'object') {
			return;
		}
		const message = typeof progress.message === 'string' ? progress.message.slice(0, 500) : undefined;
		const increment = typeof progress.increment === 'number' && Number.isFinite(progress.increment)
			? Math.max(0, Math.min(100, progress.increment))
			: undefined;
		if (message !== undefined || increment !== undefined) {
			run.progress.report({ ...(message === undefined ? {} : { message }), ...(increment === undefined ? {} : { increment }) });
		}
	}

	async $inspectCanvasNode(
		extension: extHostProtocol.IBaseHalfExtensionIdentityDto,
		resource: UriComponents,
		options?: extHostProtocol.IBaseHalfCanvasNodeInspectOptionsDto
	): Promise<extHostProtocol.IBaseHalfCanvasNodeStateDto | undefined> {
		const contributor = reviveBaseHalfExtensionIdentity(extension);
		if (!this.pluginAdmissionService.isAllowedContributor(contributor)) {
			throw new Error(`Extension '${contributor.extensionId}' is not admitted to inspect BaseHalf canvas nodes.`);
		}
		const selection = normalizeCanvasNodeInspectOptions(options);
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
			throw new Error('Save this node before inspecting its versions.');
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
			document = this.nodeExecutionService.getActiveRun(nodeResource)
				? parseBaseHalfNodeDocumentBytesForActiveHost(verifiedSource.value.buffer)
				: parseBaseHalfNodeDocumentBytes(verifiedSource.value.buffer);
		} catch {
			return undefined;
		}
		const currentVersionId = document.current.runId ?? document.current.revisionId;
		const allVersions = [
			...document.runs.map(run => ({ id: run.id, status: run.status, createdAt: run.completedAt ?? run.startedAt ?? run.createdAt })),
			...document.revisions.map(revision => ({ id: revision.id, status: 'imported' as const, createdAt: revision.createdAt }))
		];
		const selectedVersions = selection === undefined
			? selectDefaultCanvasNodeVersions(allVersions, currentVersionId)
			: selectCanvasNodeVersions(allVersions, selection, currentVersionId);
		const versions = await Promise.all(selectedVersions.map(version => this.canvasNodeVersionLimiter.queue(() => this.toCanvasNodeVersionDto(
			workspaceFolder.uri,
			document,
			version.id,
			version.status,
			version.createdAt,
			selection !== undefined
		))));
		return {
			id: document.id,
			kind: document.kind,
			...(currentVersionId ? { currentVersionId } : {}),
			versions
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

	$getModelServices(extension: extHostProtocol.IBaseHalfExtensionIdentityDto, capability?: BaseHalfModelCapability): Promise<readonly extHostProtocol.IBaseHalfModelServiceDto[]> {
		return this.modelServiceService.getServices(reviveBaseHalfExtensionIdentity(extension), capability);
	}

	$getModelServiceAccess(extension: extHostProtocol.IBaseHalfExtensionIdentityDto, snapshot: extHostProtocol.IBaseHalfModelServiceRunSnapshotDto): Promise<extHostProtocol.IBaseHalfModelServiceAccessDto | undefined> {
		const contributor = reviveBaseHalfExtensionIdentity(extension);
		const grant = [...this.recipeRuns.values()].find(run => run.extensionId === contributor.extensionId.toLowerCase()
			&& run.modelService?.accessToken !== undefined
			&& run.modelService.accessToken === snapshot.accessToken
			&& sameModelServiceRunSnapshot(run.modelService, snapshot));
		if (!grant?.modelService) {
			return Promise.resolve(undefined);
		}
		const { accessToken: _accessToken, ...frozenSnapshot } = grant.modelService;
		return this.modelServiceService.getAccess(contributor, frozenSnapshot);
	}

	override dispose(): void {
		// An Extension Host restart tears down the customer before constructing a
		// replacement. Dispose every live webview session so card detail can show
		// its reconnecting state instead of retaining a dead proxy/webview pair.
		for (const session of [...this.sessions.values()]) {
			session.dispose();
		}
		this.sessions.clear();
		for (const run of this.recipeRuns.values()) {
			run.cancellation.dispose(true);
		}
		this.recipeRuns.clear();
		super.dispose();
	}

	private async executeCanvasRecipe(
		extensionId: string,
		recipeId: string,
		request: IBaseHalfCanvasRecipeExecutionRequest,
		progress: IProgress<IBaseHalfCanvasRecipeProgress>,
		token: CancellationToken
	): Promise<IBaseHalfCanvasRecipeExecutionResult> {
		const runHandle = generateUuid();
		const cancellation = new CancellationTokenSource(token);
		const modelService = request.modelService
			? { ...request.modelService, accessToken: generateUuid() }
			: undefined;
		this.recipeRuns.set(runHandle, {
			progress,
			cancellation,
			extensionId,
			...(modelService === undefined ? {} : { modelService })
		});
		try {
			const result = await this.proxy.$executeCanvasRecipe(
				runHandle,
				recipeId,
				toRecipeExecutionRequestDto(request, modelService),
				cancellation.token
			);
			return {
				artifacts: result.artifacts.map(artifact => ({
					id: artifact.id,
					outputId: artifact.outputId,
					kind: artifact.kind,
					resource: URI.revive(artifact.resource),
					...(artifact.label === undefined ? {} : { label: artifact.label })
				})),
					...(result.primaryArtifactId === undefined ? {} : { primaryArtifactId: result.primaryArtifactId }),
					...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId }),
					...(result.usage === undefined ? {} : { usage: result.usage }),
					...(result.cost === undefined ? {} : { cost: result.cost })
				};
		} finally {
			this.recipeRuns.delete(runHandle);
			cancellation.dispose();
		}
	}

	private async toCanvasNodeVersionDto(
		workspaceFolder: URI,
		document: IBaseHalfNodeDocument,
		id: string,
		status: extHostProtocol.BaseHalfCanvasNodeVersionStatusDto,
		createdAt: string,
		freshIntegrity = false
	): Promise<extHostProtocol.IBaseHalfCanvasNodeVersionDto> {
		const revision = status === 'imported' ? document.revisions.find(candidate => candidate.id === id) : undefined;
		const run = status === 'imported' ? undefined : document.runs.find(candidate => candidate.id === id);
		const version = revision ?? run;
		const primaryArtifact = version?.artifacts.find(artifact => artifact.id === version.primaryArtifactId);
		return {
			id,
			status,
			createdAt,
			...(primaryArtifact ? { primaryArtifact: await this.toCanvasNodeVersionArtifactDto(workspaceFolder, primaryArtifact, freshIntegrity) } : {}),
			...(run ? { model: run.model } : {}),
			...(run?.providerRequestId === undefined ? {} : { providerRequestId: run.providerRequestId }),
			...(run?.usage === undefined ? {} : { usage: run.usage }),
			...(run?.cost === undefined ? {} : { cost: run.cost })
		};
	}

	private async toCanvasNodeVersionArtifactDto(
		workspaceFolder: URI,
		artifact: IBaseHalfNodeRunArtifact,
		freshIntegrity: boolean
	): Promise<extHostProtocol.IBaseHalfCanvasNodeVersionArtifactDto> {
		return {
			id: artifact.id,
			kind: artifact.kind,
			resource: URI.joinPath(workspaceFolder, ...artifact.path.split('/')),
			integrity: await this.nodeExecutionService.getArtifactIntegrity(workspaceFolder, artifact, freshIntegrity ? { fresh: true } : undefined)
		};
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

function normalizeCanvasNodeInspectOptions(
	options: extHostProtocol.IBaseHalfCanvasNodeInspectOptionsDto | undefined
): IBaseHalfNormalizedCanvasNodeInspectOptions | undefined {
	if (options === undefined) {
		return undefined;
	}
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new Error('Canvas node inspect options must be an object.');
	}
	for (const key of Object.keys(options)) {
		if (key !== 'versionIds' && key !== 'includeCurrent') {
			throw new Error(`Canvas node inspect option '${key}' is not supported.`);
		}
	}
	if (options.includeCurrent !== undefined && typeof options.includeCurrent !== 'boolean') {
		throw new Error('Canvas node inspect option \'includeCurrent\' must be a boolean.');
	}
	if (options.versionIds !== undefined && !Array.isArray(options.versionIds)) {
		throw new Error('Canvas node inspect option \'versionIds\' must be an array.');
	}
	const values = options.versionIds ?? [];
	if (values.length > BASEHALF_CANVAS_NODE_INSPECT_MAX_VERSION_IDS) {
		throw new Error(`Canvas node inspect option 'versionIds' supports at most ${BASEHALF_CANVAS_NODE_INSPECT_MAX_VERSION_IDS} ids.`);
	}
	const versionIds: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string' || value.length === 0 || value.length > BASEHALF_NODE_MAX_ID_LENGTH
			|| value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
			throw new Error(`Canvas node inspect version ids must be non-empty text of at most ${BASEHALF_NODE_MAX_ID_LENGTH} characters.`);
		}
		if (seen.has(value)) {
			throw new Error(`Canvas node inspect version id '${value}' is duplicated.`);
		}
		seen.add(value);
		versionIds.push(value);
	}
	return Object.freeze({
		versionIds: Object.freeze(versionIds),
		includeCurrent: options.includeCurrent ?? false
	});
}

function selectCanvasNodeVersions<TVersion extends { readonly id: string }>(
	allVersions: readonly TVersion[],
	selection: IBaseHalfNormalizedCanvasNodeInspectOptions,
	currentVersionId: string | undefined
): readonly TVersion[] {
	const byId = new Map(allVersions.map(version => [version.id, version]));
	const selected: TVersion[] = [];
	const ids = [...selection.versionIds];
	if (selection.includeCurrent && currentVersionId && !ids.includes(currentVersionId)) {
		ids.push(currentVersionId);
	}
	for (const id of ids) {
		const version = byId.get(id);
		if (version) {
			selected.push(version);
		}
	}
	return selected;
}

function selectDefaultCanvasNodeVersions<TVersion extends { readonly id: string; readonly createdAt: string }>(
	allVersions: readonly TVersion[],
	currentVersionId: string | undefined
): readonly TVersion[] {
	if (allVersions.length <= BASEHALF_CANVAS_NODE_INSPECT_DEFAULT_VERSION_LIMIT) {
		return allVersions;
	}
	const ranked = allVersions.map((version, index) => ({
		index,
		createdAt: Date.parse(version.createdAt)
	})).sort((left, right) => right.createdAt - left.createdAt || right.index - left.index);
	const selectedIndexes = new Set(ranked.slice(0, BASEHALF_CANVAS_NODE_INSPECT_DEFAULT_VERSION_LIMIT).map(entry => entry.index));
	const currentIndex = currentVersionId === undefined
		? -1
		: allVersions.findIndex(version => version.id === currentVersionId);
	if (currentIndex >= 0 && !selectedIndexes.has(currentIndex)) {
		selectedIndexes.delete(ranked[BASEHALF_CANVAS_NODE_INSPECT_DEFAULT_VERSION_LIMIT - 1].index);
		selectedIndexes.add(currentIndex);
	}
	return allVersions.filter((_version, index) => selectedIndexes.has(index));
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

function toRecipeExecutionRequestDto(
	request: IBaseHalfCanvasRecipeExecutionRequest,
	modelService?: extHostProtocol.IBaseHalfModelServiceRunSnapshotDto
): extHostProtocol.IBaseHalfCanvasRecipeExecutionRequestDto {
	return {
		runId: request.runId,
		workspaceFolder: request.workspaceFolder,
		node: toNodeSnapshotDto(request.node),
		recipeId: request.recipeId,
		parameters: request.parameters,
		...(request.modelServiceId === undefined ? {} : { modelServiceId: request.modelServiceId }),
		...(modelService === undefined ? {} : { modelService }),
		inputs: request.inputs.map(input => ({
			edgeId: input.edgeId,
			slotId: input.slotId,
			order: input.order,
			source: toNodeSnapshotDto(input.source)
		})),
		outputDirectory: request.outputDirectory
	};
}

function sameModelServiceRunSnapshot(
	left: extHostProtocol.IBaseHalfModelServiceRunSnapshotDto,
	right: extHostProtocol.IBaseHalfModelServiceRunSnapshotDto
): boolean {
	return left.serviceId === right.serviceId
		&& left.serviceLabel === right.serviceLabel
		&& left.connectionIdentity === right.connectionIdentity
		&& left.capability === right.capability
		&& left.modelId === right.modelId;
}

function toNodeSnapshotDto(node: IBaseHalfCanvasNodeSnapshot): extHostProtocol.IBaseHalfCanvasNodeSnapshotDto {
	return {
		id: node.id,
		path: node.path,
		kind: node.kind,
		...(node.resource === undefined ? {} : { resource: node.resource }),
		...(node.current === undefined ? {} : {
			current: {
				id: node.current.id,
				kind: node.current.kind,
				resource: node.current.resource,
				...(node.current.runId === undefined ? {} : { runId: node.current.runId })
			}
		})
	};
}
