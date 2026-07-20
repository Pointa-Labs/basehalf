/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { disposableTimeout, raceCancellationError } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { basename, dirname, extUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid, isUUID } from '../../../base/common/uuid.js';
import { FileOperation, FileOperationError, FileOperationResult, FileType, IFileContent, IFileService } from '../../../platform/files/common/files.js';
import { IChecksumService } from '../../../platform/checksum/common/checksumService.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IProgress } from '../../../platform/progress/common/progress.js';
import { ActivationKind, IExtensionService } from '../../services/extensions/common/extensions.js';
import { IBaseHalfBadgeGraphService } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfBadgeNode } from '../common/basehalfBadgeMirror.js';
import {
	baseHalfCanvasContentKindForPath,
	IBaseHalfCanvasNodeSnapshot,
	IBaseHalfCanvasRecipeDescriptor,
	IBaseHalfCanvasRecipeExecutionResult,
	IBaseHalfCanvasRecipeInput,
	IBaseHalfCanvasRecipeProgress,
	IBaseHalfCanvasRecipeRegistryService,
	IBaseHalfCanvasRecipeRuntimeService,
	baseHalfCanvasRecipeMatchesNodeKind,
	resolveBaseHalfCanvasRecipeParameters,
	validateBaseHalfCanvasRecipeInputs
} from '../common/basehalfCanvasRecipes.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { createKeyedMutex } from '../common/basehalfKeyedMutex.js';
import { baseHalfStructuralOperationAffectsResource } from '../common/basehalfMirrorCascadeOperation.js';
import { IBaseHalfModelServiceDescriptor, IBaseHalfModelServiceRunSnapshot, IBaseHalfModelServiceService } from '../common/basehalfModelServices.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	baseHalfIsReservedOutputTreePath,
	BaseHalfNodeArtifactKind,
	beginBaseHalfNodeRun,
	cancelBaseHalfNodeRun,
	completeBaseHalfNodeRun,
	createBaseHalfNodeDocument,
	failBaseHalfNodeRun,
	freezeBaseHalfNodeRunInputs,
	freezeBaseHalfNodeRunModel,
	IBaseHalfNodeDocument,
	IBaseHalfNodeImportedRevision,
	IBaseHalfNodeInputBinding,
	IBaseHalfNodeRecipe,
	IBaseHalfNodeRunArtifact,
	BaseHalfNodeRunModel,
	IBaseHalfNodeRunCost,
	IBaseHalfNodeRunInput,
	IBaseHalfNodeRunUsage,
	getBaseHalfNodeCurrentArtifacts,
	getBaseHalfNodeCurrentPrimaryArtifact,
	interruptBaseHalfNodeRun,
	parseBaseHalfNodeDocumentBytes,
	parseBaseHalfNodeDocumentBytesForActiveHost,
	baseHalfProjectPathProblem,
	selectBaseHalfNodeCurrent,
	serializeBaseHalfNodeDocument
} from '../common/basehalfNodeDocument.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import { SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { BaseHalfNodeRunLeaseStore, IBaseHalfNodeRunLeaseHandle } from './basehalfNodeRunLease.js';
import { assertBaseHalfWorkspaceFile, ensureBaseHalfWorkspaceDirectory } from './basehalfWorkspacePathSafety.js';

const NODE_WRITE_MAX_ATTEMPTS = 3;
const NODE_WRITE_TEMP_POSTFIX = '.basehalf-node-tmp';
const OUTPUT_DIRECTORY_NAME = 'outputs';
const INPUT_SNAPSHOT_DIRECTORY_NAME = 'inputs';
const ARTIFACT_DIRECTORY_NAME = 'artifacts';
const RUN_GUARD_FILE_NAME = '.basehalf-run-guard';
const MAX_INPUT_SNAPSHOT_ENTRIES = 2048;
const MAX_INPUT_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_EXECUTION_ERROR_LENGTH = 1024;
const MAX_EXECUTION_ERROR_INPUT_LENGTH = 16 * 1024;
const MAX_ARTIFACT_INTEGRITY_CACHE_ENTRIES = 512;
const MAX_INPUT_FINGERPRINT_CACHE_ENTRIES = 256;
const MAX_STRUCTURAL_SCAN_ENTRIES = 100_000;
const MAX_STRUCTURAL_SCAN_DEPTH = 512;
export const BASEHALF_NODE_IDENTITY_SCAN_MAX_ENTRIES = 100_000;
export const BASEHALF_NODE_IDENTITY_SCAN_MAX_DEPTH = 512;
const RUN_LEASE_STALE_AFTER_MS = 30_000;
const RUN_LEASE_HEARTBEAT_INTERVAL_MS = 5_000;

/** Returns the project-owned folder that keeps immutable imports for one stable node identity. */
export function baseHalfNodeImportedAssetDirectory(workspaceFolder: URI, nodeId: string): URI {
	const directPath = `assets/${nodeId}`;
	const segment = baseHalfProjectPathProblem(directPath)
		? `node-${encodeBase64(VSBuffer.fromString(nodeId), false, true)}`
		: nodeId;
	return URI.joinPath(workspaceFolder, 'assets', segment);
}

export interface IBaseHalfNodeExecutionState {
	readonly resource: URI;
	readonly runId: string;
	readonly phase: 'preparing' | 'running' | 'cancelling';
	readonly message?: string;
	readonly progress?: number;
}

export interface IBaseHalfNodeExecutionEvent {
	readonly resource: URI;
	readonly state?: IBaseHalfNodeExecutionState;
}

export type BaseHalfNodeArtifactIntegrity = 'available' | 'missing' | 'changed';

export interface IBaseHalfNodeVerificationOptions {
	/** Bypass cached digests at a trust boundary. */
	readonly fresh?: boolean;
}

export interface IBaseHalfNodeCurrentSelectionTransition {
	readonly document: IBaseHalfNodeDocument;
	/** Canonical document bytes before the Current pointer changed. */
	readonly before: VSBuffer;
	/** Exact document bytes committed by the selection. */
	readonly after: VSBuffer;
}

export const IBaseHalfNodeExecutionService = createDecorator<IBaseHalfNodeExecutionService>('baseHalfNodeExecutionService');

export interface IBaseHalfNodeExecutionService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<IBaseHalfNodeExecutionEvent>;
	getActiveRun(resource: URI): IBaseHalfNodeExecutionState | undefined;
	acquireStructuralOperation(operation: FileOperation, files: readonly SourceTargetPair[], cancellationToken?: CancellationToken): Promise<IDisposable>;
	run(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfNodeDocument>;
	cancel(resource: URI, expectedRunId: string): boolean;
	recoverInterrupted(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfNodeDocument>;
	selectCurrent(node: IBaseHalfWorkspaceResource, versionId: string): Promise<IBaseHalfNodeDocument>;
	selectCurrentWithTransition(node: IBaseHalfWorkspaceResource, versionId: string): Promise<IBaseHalfNodeCurrentSelectionTransition>;
	transitionCurrent(node: IBaseHalfWorkspaceResource, expected: VSBuffer, next: VSBuffer): Promise<IBaseHalfNodeDocument>;
	getArtifactIntegrity(workspaceFolder: URI, artifact: IBaseHalfNodeRunArtifact, options?: IBaseHalfNodeVerificationOptions): Promise<BaseHalfNodeArtifactIntegrity>;
	getInputRevision(workspaceFolder: URI, relativePath: string, options?: IBaseHalfNodeVerificationOptions): Promise<string>;
	copyImportedRevision(workspaceFolder: URI, source: URI, target: URI, kind: BaseHalfNodeArtifactKind): Promise<IBaseHalfNodeImportedRevision>;
}

interface IActiveRun {
	readonly runId: string;
	readonly cancellation: CancellationTokenSource;
	state: IBaseHalfNodeExecutionState;
	userCancelled: boolean;
	lease?: IBaseHalfNodeRunLeaseHandle;
	leaseHeartbeat?: IDisposable;
	leaseMutation: Promise<void>;
	leaseClosing: boolean;
	leaseLost: boolean;
}

interface INodeMutationLease {
	readonly handle: IBaseHalfNodeRunLeaseHandle;
	readonly document: IReadNodeDocumentResult;
	readonly heartbeat: IDisposable;
}

interface IResolvedInput {
	readonly execution: IBaseHalfCanvasRecipeInput;
	readonly history: IBaseHalfNodeRunInput;
}

interface IAcceptedArtifacts {
	readonly artifacts: readonly IBaseHalfNodeRunArtifact[];
	readonly primaryArtifactId: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeRunUsage;
	readonly cost?: IBaseHalfNodeRunCost;
}

interface IResolvedRunModel {
	readonly history: BaseHalfNodeRunModel;
	readonly execution?: IBaseHalfModelServiceRunSnapshot;
	readonly preparationError?: string;
}

interface IReadNodeDocumentResult {
	readonly content: IFileContent;
	readonly document: IBaseHalfNodeDocument;
}

interface IArtifactIntegrityCacheEntry {
	readonly resource: URI;
	readonly etag: string;
	readonly size: number;
	readonly integrity: BaseHalfNodeArtifactIntegrity;
}

interface IInputFingerprintCacheEntry {
	readonly resource: URI;
	readonly etag: string;
	readonly size: number;
	readonly isDirectory: boolean;
	readonly digest: string;
}

export interface IBaseHalfNodeIdentityScanLimits {
	readonly maxEntries: number;
	readonly maxDepth: number;
}

interface IBaseHalfWorkspaceNodeIdentity {
	readonly resource: URI;
	readonly relativePath: string;
	readonly document: IBaseHalfNodeDocument;
}

export class BaseHalfNodeExecutionService extends Disposable implements IBaseHalfNodeExecutionService {
	declare readonly _serviceBrand: undefined;

	private readonly mutex = createKeyedMutex();
	private readonly ownerId = generateUuid();
	private readonly runLeaseStore: BaseHalfNodeRunLeaseStore;
	private readonly activeRuns = new Map<string, IActiveRun>();
	private readonly artifactIntegrityCache = new Map<string, IArtifactIntegrityCacheEntry>();
	private readonly inputFingerprintCache = new Map<string, IInputFingerprintCacheEntry>();
	private readonly structuralOperationBlocks = new Map<number, { readonly operation: FileOperation; readonly files: readonly SourceTargetPair[] }>();
	private readonly pendingStructuralLeaseReleases = new Set<Promise<void>>();
	private nextStructuralOperationBlock = 0;
	private readonly _onDidChange = this._register(new Emitter<IBaseHalfNodeExecutionEvent>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfBadgeGraphService private readonly badgeGraphService: IBaseHalfBadgeGraphService,
		@IBaseHalfCanvasRecipeRegistryService private readonly recipeRegistryService: IBaseHalfCanvasRecipeRegistryService,
		@IBaseHalfCanvasRecipeRuntimeService private readonly recipeRuntimeService: IBaseHalfCanvasRecipeRuntimeService,
		@IBaseHalfModelServiceService private readonly modelServiceService: IBaseHalfModelServiceService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IChecksumService private readonly checksumService: IChecksumService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
	) {
		super();
		this.runLeaseStore = new BaseHalfNodeRunLeaseStore(this.fileService, RUN_LEASE_STALE_AFTER_MS);
		this._register(this.fileService.onDidFilesChange(event => {
			for (const [key, entry] of this.artifactIntegrityCache) {
				if (event.affects(entry.resource)) {
					this.artifactIntegrityCache.delete(key);
				}
			}
			for (const [key, entry] of this.inputFingerprintCache) {
				if (event.affects(entry.resource)) {
					this.inputFingerprintCache.delete(key);
				}
			}
		}));
		this._register(this.fileService.onDidRunOperation(event => {
			this.invalidateDigestCachesForResource(event.resource);
			if (event.isOperation(FileOperation.CREATE) || event.isOperation(FileOperation.COPY) || event.isOperation(FileOperation.MOVE)) {
				this.invalidateDigestCachesForResource(event.target.resource);
			}
		}));
	}

	private invalidateDigestCachesForResource(resource: URI): void {
		for (const [key, entry] of this.artifactIntegrityCache) {
			if (extUri.isEqualOrParent(resource, entry.resource) || extUri.isEqualOrParent(entry.resource, resource)) {
				this.artifactIntegrityCache.delete(key);
			}
		}
		for (const [key, entry] of this.inputFingerprintCache) {
			if (extUri.isEqualOrParent(resource, entry.resource) || extUri.isEqualOrParent(entry.resource, resource)) {
				this.inputFingerprintCache.delete(key);
			}
		}
	}

	getActiveRun(resource: URI): IBaseHalfNodeExecutionState | undefined {
		return this.activeRuns.get(resource.toString())?.state;
	}

	async acquireStructuralOperation(operation: FileOperation, files: readonly SourceTargetPair[], cancellationToken: CancellationToken = CancellationToken.None): Promise<IDisposable> {
		if (operation !== FileOperation.MOVE && operation !== FileOperation.DELETE) {
			return toDisposable(() => undefined);
		}
		await this.awaitPendingStructuralLeaseReleases();
		const snapshot = files.map(file => Object.freeze({ ...(file.source ? { source: file.source } : {}), target: file.target }));
		const active = [...this.activeRuns.values()].find(run => baseHalfStructuralOperationAffectsResource(operation, snapshot, run.state.resource));
		if (active) {
			throw new Error('Wait for the active node run before moving or deleting this item.');
		}

		const id = ++this.nextStructuralOperationBlock;
		this.structuralOperationBlocks.set(id, Object.freeze({ operation, files: Object.freeze(snapshot) }));
		const leases: INodeMutationLease[] = [];
		try {
			for (const node of await this.collectAffectedNodeResources(operation, snapshot, cancellationToken)) {
				throwIfNodeOperationCancelled(cancellationToken);
				const lease = await this.acquireNodeMutationLease(node, generateUuid());
				leases.push(lease);
			}
		} catch (error) {
			this.structuralOperationBlocks.delete(id);
			for (const lease of leases) {
				lease.heartbeat.dispose();
			}
			await Promise.allSettled(leases.map(lease => this.runLeaseStore.release(lease.handle)));
			throw error;
		}
		return toDisposable(() => {
			this.structuralOperationBlocks.delete(id);
			for (const lease of leases) {
				lease.heartbeat.dispose();
			}
			this.releaseStructuralLeases(leases);
		});
	}

	run(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfNodeDocument> {
		const key = node.resource.toString();
		if ([...this.structuralOperationBlocks.values()].some(block => baseHalfStructuralOperationAffectsResource(block.operation, block.files, node.resource))) {
			return Promise.reject(new Error('Wait for the current file operation before running this node.'));
		}
		if (this.workingCopyService.isDirty(node.resource)) {
			return Promise.reject(new Error('Save this node before running it.'));
		}
		if (this.activeRuns.has(key)) {
			return Promise.reject(new Error('This node already has an active run.'));
		}

		const active: IActiveRun = {
			runId: generateUuid(),
			cancellation: new CancellationTokenSource(),
			state: { resource: node.resource, runId: '', phase: 'preparing' },
			userCancelled: false,
			leaseMutation: Promise.resolve(),
			leaseClosing: false,
			leaseLost: false
		};
		active.state = { ...active.state, runId: active.runId };
		this.activeRuns.set(key, active);
		this._onDidChange.fire({ resource: node.resource, state: active.state });

		return this.mutex.runExclusive(key, () => this.execute(node, active)).finally(async () => {
			await this.closeRunLease(active);
			if (this.activeRuns.get(key) === active) {
				this.activeRuns.delete(key);
				active.cancellation.dispose();
				this._onDidChange.fire({ resource: node.resource });
			}
		});
	}

	cancel(resource: URI, expectedRunId: string): boolean {
		const active = this.activeRuns.get(resource.toString());
		if (!active || active.runId !== expectedRunId) {
			return false;
		}
		if (active.userCancelled) {
			return true;
		}
		active.userCancelled = true;
		active.state = {
			resource,
			runId: active.runId,
			phase: 'cancelling',
			message: 'Cancellation requested. Late results will not be accepted.'
		};
		this._onDidChange.fire({ resource, state: active.state });
		active.cancellation.cancel();
		return true;
	}

	recoverInterrupted(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfNodeDocument> {
		const key = node.resource.toString();
		if (this.activeRuns.has(key)) {
			return Promise.reject(new Error('This run is still active in this window.'));
		}
		return this.mutex.runExclusive(key, async () => {
			await this.awaitPendingStructuralLeaseReleases();
			await this.assertSafeNodeResource(node);
			const current = await this.readNode(node.resource, false);
			const running = current.document.runs.find(run => run.status === 'running');
			if (!running) {
				return current.document;
			}
			await baseHalfAssertUniqueNodeIdentity(this.fileService, node, current.document.id);
			const acquired = await this.runLeaseStore.acquire(
				node.workspaceFolder,
				current.document.id,
				node.relativePath,
				this.ownerId,
				running.id,
				running.id
			);
			if (acquired.kind === 'busy') {
				throw new Error('This run is still active in another BaseHalf window.');
			}
			if (acquired.kind !== 'recovery') {
				throw new Error('The saved run status changed before it could be checked.');
			}
			try {
				return (await this.persistInterruptedRun(node, acquired.abandonedRunId)).document;
			} finally {
				await this.runLeaseStore.release(acquired.handle);
			}
		});
	}

	selectCurrent(node: IBaseHalfWorkspaceResource, versionId: string): Promise<IBaseHalfNodeDocument> {
		return this.selectCurrentWithTransition(node, versionId).then(transition => transition.document);
	}

	selectCurrentWithTransition(node: IBaseHalfWorkspaceResource, versionId: string): Promise<IBaseHalfNodeCurrentSelectionTransition> {
		const key = node.resource.toString();
		if (this.activeRuns.has(key)) {
			return Promise.reject(new Error('Wait for the active run before selecting a historical result.'));
		}
		return this.mutex.runExclusive(key, async () => {
			await this.awaitPendingStructuralLeaseReleases();
			const lease = await this.acquireNodeMutationLease(node, generateUuid(), true);
			try {
				return await this.selectCurrentVerified(node, versionId, lease.document, lease.handle);
			} finally {
				lease.heartbeat.dispose();
				await this.runLeaseStore.release(lease.handle);
			}
		});
	}

	transitionCurrent(node: IBaseHalfWorkspaceResource, expected: VSBuffer, next: VSBuffer): Promise<IBaseHalfNodeDocument> {
		const key = node.resource.toString();
		if (this.activeRuns.has(key)) {
			return Promise.reject(new Error('Wait for the active run before changing Current.'));
		}
		return this.mutex.runExclusive(key, async () => {
			await this.awaitPendingStructuralLeaseReleases();
			const lease = await this.acquireNodeMutationLease(node, generateUuid(), true);
			try {
				if (this.workingCopyService.isDirty(node.resource)) {
					throw new Error('Save this node before changing Current.');
				}
				if (lease.document.document.runs.some(run => run.status === 'running')) {
					throw new Error('Wait for the active run before changing Current.');
				}
				if (!lease.document.content.value.equals(expected)) {
					throw new Error('Current changed before this history action could be applied.');
				}
				const expectedDocument = parseBaseHalfNodeDocumentBytesForActiveHost(expected.buffer);
				const nextDocument = parseBaseHalfNodeDocumentBytesForActiveHost(next.buffer);
				const currentOnly = serializeBaseHalfNodeDocument({ ...expectedDocument, current: nextDocument.current });
				if (currentOnly !== serializeBaseHalfNodeDocument(nextDocument)) {
					throw new Error('A history action may change only the Current selection.');
				}
				for (const artifact of getBaseHalfNodeCurrentArtifacts(nextDocument)) {
					const integrity = await this.getArtifactIntegrity(node.workspaceFolder, artifact, { fresh: true });
					if (integrity !== 'available') {
						throw new Error(integrity === 'missing'
							? `Output missing: '${artifact.path}'. The historical record is unchanged.`
							: `Output changed: '${artifact.path}'. The historical record is unchanged.`);
					}
				}
				if (!await this.runLeaseStore.heartbeat(lease.handle)) {
					throw new Error('The node changed ownership before Current could be changed.');
				}
				return this.commitExact(node, lease.document.content.value, nextDocument);
			} finally {
				lease.heartbeat.dispose();
				await this.runLeaseStore.release(lease.handle);
			}
		});
	}

	async getArtifactIntegrity(
		workspaceFolder: URI,
		artifact: IBaseHalfNodeRunArtifact,
		options: IBaseHalfNodeVerificationOptions = {}
	): Promise<BaseHalfNodeArtifactIntegrity> {
		const resource = joinProjectPath(workspaceFolder, artifact.path);
		try {
			if (!(await this.fileService.exists(resource))) {
				return 'missing';
			}
			await this.assertNoSymbolicLinkComponents(workspaceFolder, resource);
			const [workspaceRealpath, resourceRealpath] = await Promise.all([
				this.fileService.realpath(workspaceFolder),
				this.fileService.realpath(resource)
			]);
			if (!workspaceRealpath || !resourceRealpath || !extUri.isEqualOrParent(resourceRealpath, workspaceRealpath)) {
				return 'changed';
			}
			return await this.resourceArtifactIntegrity(resource, artifact, options.fresh === true);
		} catch (error) {
			return isFileNotFound(error) ? 'missing' : 'changed';
		}
	}

	async getInputRevision(
		workspaceFolder: URI,
		relativePath: string,
		options: IBaseHalfNodeVerificationOptions = {}
	): Promise<string> {
		const resource = joinProjectPath(workspaceFolder, relativePath);
		if (this.hasDirtyWorkingCopyAtOrBelow(resource)) {
			throw new Error(`Save direct input '${relativePath}' before checking or running this node.`);
		}
		await this.assertNoSymbolicLinkComponents(workspaceFolder, resource);
		const stat = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (!stat.isDirectory && relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			const node = await this.readDirectInputNode(workspaceFolder, relativePath, resource);
			if (node.document.current.source === 'empty') {
				throw new Error(directResultNoCurrentMessage(relativePath));
			}
			const primary = getBaseHalfNodeCurrentPrimaryArtifact(node.document);
			if (!primary) {
				throw new Error(directResultNoPrimaryMessage(relativePath));
			}
			if (this.workingCopyService.isDirty(joinProjectPath(workspaceFolder, primary.path))) {
				throw new Error(`Save Current output '${primary.path}' from direct input '${relativePath}' before checking or running this node.`);
			}
			const integrity = await this.getArtifactIntegrity(workspaceFolder, primary, options);
			if (integrity !== 'available') {
				throw new Error(directResultIntegrityMessage(relativePath, primary.path, integrity));
			}
			const digest = primary.sha256;
			assertDirectResultCurrentIdentity(node.document, relativePath, primary.id);

			if (node.document.current.source === 'run' && node.document.current.runId) {
				return runInputRevision(node.document.current.runId, primary.id, digest);
			}
			if (node.document.current.source === 'imported' && node.document.current.revisionId && primary) {
				return revisionInputRevision(node.document.current.revisionId, primary.id, digest);
			}
			throw new Error(directResultNoIdentityMessage(relativePath));
		}

		return sourceInputRevision(relativePath, await this.fingerprintResource(workspaceFolder, resource, options.fresh === true, stat));
	}

	async copyImportedRevision(workspaceFolder: URI, source: URI, target: URI, kind: BaseHalfNodeArtifactKind): Promise<IBaseHalfNodeImportedRevision> {
		if (!extUri.isEqualOrParent(target, workspaceFolder) || extUri.isEqual(target, workspaceFolder)) {
			throw new Error('The imported file must remain inside this project.');
		}
		const targetPath = extUri.relativePath(workspaceFolder, target);
		if (!targetPath || baseHalfProjectPathProblem(targetPath)) {
			throw new Error('The imported file must use a portable project-relative path.');
		}
		if (await this.fileService.exists(target)) {
			throw new Error('The import target already exists.');
		}
		await baseHalfAssertUniqueImportTargetIdentity(this.fileService, workspaceFolder, target);
		const sourceBefore = await this.stableRegularFileDigest(source, 'import source');
		try {
			await this.ensureContainedProjectDirectory(workspaceFolder, dirname(target));
			await this.fileService.copy(source, target, false);
			await this.assertNoSymbolicLinkComponents(workspaceFolder, target);
			const [workspaceRealpath, targetRealpath] = await Promise.all([
				this.fileService.realpath(workspaceFolder),
				this.fileService.realpath(target)
			]);
			if (!workspaceRealpath || !targetRealpath || !extUri.isEqualOrParent(targetRealpath, workspaceRealpath) || extUri.isEqual(targetRealpath, workspaceRealpath)) {
				throw new Error('The imported file resolves outside this project.');
			}
			// Verify in order. Besides making the accepted snapshot easier to
			// reason about, this prevents the target checksum from racing the
			// source's post-copy stability check.
			const sourceAfter = await this.stableRegularFileDigest(source, 'import source');
			const targetAccepted = await this.stableRegularFileDigest(target, 'imported file');
			if (!extUri.isEqual(sourceAfter.realpath, sourceBefore.realpath)
				|| sourceAfter.etag !== sourceBefore.etag
				|| sourceAfter.size !== sourceBefore.size
				|| sourceAfter.sha256 !== sourceBefore.sha256
				|| targetAccepted.size !== sourceBefore.size
				|| targetAccepted.sha256 !== sourceBefore.sha256) {
				throw new Error('The selected file changed while it was being imported. Try again.');
			}
			const revisionId = generateUuid();
			const artifactId = generateUuid();
			return Object.freeze({
				id: revisionId,
				source: 'imported',
				createdAt: new Date().toISOString(),
				artifacts: Object.freeze([Object.freeze({
					id: artifactId,
					outputId: 'imported',
					kind,
					path: targetPath,
					sha256: targetAccepted.sha256,
					size: targetAccepted.size,
					label: basename(target)
				})]),
				primaryArtifactId: artifactId
			});
		} catch (error) {
			if (await this.fileService.exists(target)) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`${message} The copied file '${targetPath}' was kept as ordinary project data.`, { cause: error });
			}
			throw error;
		}
	}

	private async ensureContainedProjectDirectory(workspaceFolder: URI, directory: URI): Promise<void> {
		return this.ensureContainedDirectory(workspaceFolder, directory, 'import directory');
	}

	private async ensureContainedRunDirectory(workspaceFolder: URI, directory: URI): Promise<void> {
		return this.ensureContainedDirectory(workspaceFolder, directory, 'run directory');
	}

	private async ensureContainedDirectory(allowedRoot: URI, directory: URI, label: string): Promise<void> {
		await ensureBaseHalfWorkspaceDirectory(this.fileService, allowedRoot, directory, label);
	}

	private releaseStructuralLeases(leases: readonly INodeMutationLease[]): void {
		if (leases.length === 0) {
			return;
		}
		const pending = Promise.allSettled(leases.map(lease => this.runLeaseStore.release(lease.handle))).then(() => undefined);
		this.pendingStructuralLeaseReleases.add(pending);
		void pending.then(() => this.pendingStructuralLeaseReleases.delete(pending));
	}

	private async awaitPendingStructuralLeaseReleases(): Promise<void> {
		while (this.pendingStructuralLeaseReleases.size > 0) {
			await Promise.all([...this.pendingStructuralLeaseReleases]);
		}
	}

	override dispose(): void {
		for (const active of this.activeRuns.values()) {
			active.leaseClosing = true;
			active.leaseHeartbeat?.dispose();
			active.cancellation.dispose(true);
		}
		this.activeRuns.clear();
		this.structuralOperationBlocks.clear();
		this.pendingStructuralLeaseReleases.clear();
		this.artifactIntegrityCache.clear();
		this.inputFingerprintCache.clear();
		super.dispose();
	}

	private async execute(node: IBaseHalfWorkspaceResource, active: IActiveRun): Promise<IBaseHalfNodeDocument> {
		if (!node.relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			throw new Error(`Only ${BASEHALF_NODE_DOCUMENT_EXTENSION} nodes can run recipes.`);
		}
		await this.assertSafeNodeResource(node);
		if (this.workingCopyService.isDirty(node.resource)) {
			throw new Error('Save this node before running it.');
		}

		await this.awaitPendingStructuralLeaseReleases();
		let initial = await this.readNode(node.resource, false);
		await baseHalfAssertUniqueNodeIdentity(this.fileService, node, initial.document.id, undefined, active.cancellation.token);
		initial = await this.acquireRunLease(node, active, initial);
		const recipeState = initial.document.recipe;
		if (!recipeState) {
			throw new Error('Add a recipe before running this node.');
		}
		const recipe = this.recipeRegistryService.getRecipe(recipeState.recipeId);
		if (!recipe) {
			throw new Error(`Recipe '${recipeState.recipeId}' is not installed.`);
		}
		if (!baseHalfCanvasRecipeMatchesNodeKind(recipe, initial.document.kind)) {
			throw new Error(`Recipe '${recipe.label}' cannot run on a ${initial.document.kind} node.`);
		}

		const parameters = resolveBaseHalfCanvasRecipeParameters(recipe, recipeState.parameters);
		const normalizedRecipe: IBaseHalfNodeRecipe = {
			recipeId: recipe.id,
			...(recipe.modelCapability === undefined || recipeState.modelServiceId === undefined ? {} : { modelServiceId: recipeState.modelServiceId }),
			...(recipe.modelCapability === undefined || recipeState.modelId === undefined ? {} : { modelId: recipeState.modelId }),
			parameters,
			inputBindings: recipeState.inputBindings
		};
		const preparedDocument: IBaseHalfNodeDocument = { ...initial.document, recipe: normalizedRecipe };
		const requestedModel = this.requestedRunModel(recipe, recipeState.modelServiceId, recipeState.modelId);
		const runDirectory = URI.joinPath(node.workspaceFolder, OUTPUT_DIRECTORY_NAME, initial.document.id, active.runId);
		const inputDirectory = URI.joinPath(runDirectory, INPUT_SNAPSHOT_DIRECTORY_NAME);
		const outputDirectory = URI.joinPath(runDirectory, ARTIFACT_DIRECTORY_NAME);
		const guardResource = URI.joinPath(runDirectory, RUN_GUARD_FILE_NAME);
		const guardValue = generateUuid();
		let persistedRun = false;
		let expectedRunRealpath: URI | undefined;
		let expectedOutputRealpath: URI | undefined;
		let providerResult: IBaseHalfCanvasRecipeExecutionResult | undefined;
		let accepted: IAcceptedArtifacts | undefined;
		try {
			const now = new Date().toISOString();
			const running = beginBaseHalfNodeRun(preparedDocument, {
				id: active.runId,
				createdAt: now,
				startedAt: now,
				model: requestedModel,
				inputs: []
			});
			await this.assertRunLease(active);
			await this.commitExact(node, initial.content.value, running);
			persistedRun = true;
			this.throwIfCancelled(active);
			const runModel = await raceCancellationError(
				this.resolveRunModel(recipe, recipeState.modelServiceId, recipeState.modelId),
				active.cancellation.token
			);
			this.throwIfCancelled(active);
			await this.assertRunLease(active);
			await this.patchNode(node, true, document => freezeBaseHalfNodeRunModel(document, active.runId, runModel.history));
			this.throwIfCancelled(active);
			if (runModel.preparationError) {
				throw new Error(runModel.preparationError);
			}
			await raceCancellationError(
				this.assertDirectInputsSaved(node.workspaceFolder, normalizedRecipe.inputBindings),
				active.cancellation.token
			);
			this.throwIfCancelled(active);
			await raceCancellationError(
				this.extensionService.activateByEvent(`onBaseHalfCanvasRecipe:${recipe.id}`, ActivationKind.Normal),
				active.cancellation.token
			);
			this.throwIfCancelled(active);
			if (!this.recipeRuntimeService.hasExecutor(recipe.id)) {
				throw new Error(`Recipe '${recipe.label}' is installed but its executor is unavailable.`);
			}
			await raceCancellationError(
				this.preflightInputs(node, recipe, normalizedRecipe.inputBindings, active),
				active.cancellation.token
			);
			this.throwIfCancelled(active);
			// Walk and verify every existing ancestor before creating the next
			// directory. A pre-existing symbolic link must never receive run data.
			await this.ensureContainedRunDirectory(node.workspaceFolder, runDirectory);
			await this.ensureContainedRunDirectory(node.workspaceFolder, inputDirectory);
			await this.ensureContainedRunDirectory(node.workspaceFolder, outputDirectory);
			await this.assertNoSymbolicLinkComponents(node.workspaceFolder, runDirectory);
			expectedRunRealpath = await this.requireVerifiedDirectory(node.workspaceFolder, runDirectory, 'run directory');
			expectedOutputRealpath = await this.requireVerifiedDirectory(runDirectory, outputDirectory, 'artifact directory');
			await this.fileService.createFile(guardResource, VSBuffer.fromString(guardValue), { overwrite: false });
			await this.assertRunGuard(runDirectory, outputDirectory, guardResource, guardValue, expectedRunRealpath, expectedOutputRealpath);
			const inputs = await this.resolveInputs(node, recipe, normalizedRecipe.inputBindings, inputDirectory, active);
			this.throwIfCancelled(active);
			const frozenNodeResource = URI.joinPath(inputDirectory, 'node.bhnode');
			const frozenDeclaration = createBaseHalfNodeDocument({
				id: preparedDocument.id,
				kind: preparedDocument.kind,
				title: preparedDocument.title,
				role: preparedDocument.role,
				recipe: normalizedRecipe
			});
			await this.fileService.createFile(
				frozenNodeResource,
				VSBuffer.fromString(serializeBaseHalfNodeDocument(frozenDeclaration)),
				{ overwrite: false }
			);
			if (inputs.length > 0) {
				await this.assertRunLease(active);
				await this.patchNode(node, true, document => freezeBaseHalfNodeRunInputs(
					document,
					active.runId,
					inputs.map(input => input.history)
				));
			}
			this.throwIfCancelled(active);
			await this.assertRunLease(active);
			this.updateActive(node.resource, active, { phase: 'running' });

			const request = {
				runId: active.runId,
				workspaceFolder: node.workspaceFolder,
				node: this.toNodeSnapshot(node, running, frozenNodeResource),
				recipeId: recipe.id,
				parameters,
				...(normalizedRecipe.modelServiceId === undefined ? {} : { modelServiceId: normalizedRecipe.modelServiceId }),
				...(runModel.execution === undefined ? {} : { modelService: runModel.execution }),
				inputs: inputs.map(input => input.execution),
				outputDirectory
			};
			const progress: IProgress<IBaseHalfCanvasRecipeProgress> = {
				report: value => this.reportProgress(node.resource, active, value)
			};
			providerResult = await raceCancellationError(
				this.recipeRuntimeService.executeRecipe(recipe.id, request, progress, active.cancellation.token),
				active.cancellation.token
			);
			await this.assertRunLease(active);
			const acceptedResult = await this.validateArtifacts(node.workspaceFolder, outputDirectory, runDirectory, guardResource, guardValue, expectedRunRealpath, expectedOutputRealpath, providerResult);
			this.throwIfCancelled(active);
			accepted = acceptedResult;
			await this.assertRunLease(active);
			return await this.patchNode(node, true, document => active.cancellation.token.isCancellationRequested
				? cancelBaseHalfNodeRun(document, active.runId, { completedAt: new Date().toISOString() })
				: completeBaseHalfNodeRun(document, active.runId, {
					completedAt: new Date().toISOString(),
					...acceptedResult
				}));
		} catch (error) {
			if (active.leaseLost) {
				throw new Error('This run lost its execution ownership before it completed. Its result was not accepted.', { cause: error });
			}
			if (!persistedRun) {
				throw error;
			}
			await this.assertRunLease(active);
			if (accepted && !active.cancellation.token.isCancellationRequested) {
				const acceptedResult = accepted;
				return await this.patchNode(node, true, document => completeBaseHalfNodeRun(document, active.runId, {
					completedAt: new Date().toISOString(),
					...acceptedResult,
					selectCurrent: false
				}));
			}
			const providerDisclosure = providerResult && !active.userCancelled ? {
				...(providerResult.providerRequestId === undefined ? {} : { providerRequestId: providerResult.providerRequestId }),
				...(providerResult.usage === undefined ? {} : { usage: providerResult.usage }),
				...(providerResult.cost === undefined ? {} : { cost: providerResult.cost })
			} : {};
			if (isCancellationError(error) || active.cancellation.token.isCancellationRequested) {
				return await this.patchNode(node, true, document => active.userCancelled
					? cancelBaseHalfNodeRun(document, active.runId, { completedAt: new Date().toISOString(), ...providerDisclosure })
					: interruptBaseHalfNodeRun(document, active.runId, { completedAt: new Date().toISOString(), error: executionErrorMessage(error) }));
			}
			return await this.patchNode(node, true, document => failBaseHalfNodeRun(document, active.runId, {
				completedAt: new Date().toISOString(),
				error: executionErrorMessage(error),
				...providerDisclosure
			}));
		}
	}

	private async acquireRunLease(
		node: IBaseHalfWorkspaceResource,
		active: IActiveRun,
		initial: IReadNodeDocumentResult
	): Promise<IReadNodeDocumentResult> {
		const persistedRunningRunId = initial.document.runs.find(run => run.status === 'running')?.id;
		const acquired = await this.runLeaseStore.acquire(
			node.workspaceFolder,
			initial.document.id,
			node.relativePath,
			this.ownerId,
			active.runId,
			persistedRunningRunId
		);
		if (acquired.kind === 'busy') {
			throw new Error('This node already has an active run in another window.');
		}

		let document = initial;
		let handle = acquired.handle;
		if (acquired.kind === 'recovery') {
			document = await this.persistInterruptedRun(node, acquired.abandonedRunId);
			const activated = await this.runLeaseStore.activateRecovered(handle, active.runId);
			if (!activated) {
				throw new Error('Another window took ownership while the interrupted run was being recovered.');
			}
			handle = activated;
		}

		active.lease = handle;
		this.scheduleRunLeaseHeartbeat(node.resource, active);
		return document;
	}

	private async acquireNodeMutationLease(node: IBaseHalfWorkspaceResource, operationId: string, requireUniqueIdentity = false): Promise<INodeMutationLease> {
		await this.assertSafeNodeResource(node);
		let document = await this.readNode(node.resource, false);
		if (requireUniqueIdentity) {
			await baseHalfAssertUniqueNodeIdentity(this.fileService, node, document.document.id);
		}
		const persistedRunningRunId = document.document.runs.find(run => run.status === 'running')?.id;
		const acquired = await this.runLeaseStore.acquire(
			node.workspaceFolder,
			document.document.id,
			node.relativePath,
			this.ownerId,
			operationId,
			persistedRunningRunId
		);
		if (acquired.kind === 'busy') {
			throw new Error('Wait for the active node run in the other window before changing this node.');
		}

		let handle = acquired.handle;
		if (acquired.kind === 'recovery') {
			document = await this.persistInterruptedRun(node, acquired.abandonedRunId);
			const activated = await this.runLeaseStore.activateRecovered(handle, operationId);
			if (!activated) {
				throw new Error('Another window took ownership while the interrupted run was being recovered.');
			}
			handle = activated;
		}
		return Object.freeze({
			handle,
			document,
			heartbeat: this.startStandaloneLeaseHeartbeat(handle)
		});
	}

	private async persistInterruptedRun(node: IBaseHalfWorkspaceResource, runId: string): Promise<IReadNodeDocumentResult> {
		for (let attempt = 0; attempt < NODE_WRITE_MAX_ATTEMPTS; attempt++) {
			await this.assertSafeNodeResource(node);
			const current = await this.readNode(node.resource, false);
			const run = current.document.runs.find(candidate => candidate.id === runId);
			if (!run || run.status !== 'running') {
				const otherRunning = current.document.runs.find(candidate => candidate.status === 'running');
				if (otherRunning) {
					throw new Error('The active node run changed while its execution owner was being recovered.');
				}
				return current;
			}
			const next = interruptBaseHalfNodeRun(current.document, runId, {
				completedAt: new Date().toISOString(),
				error: 'The previous execution host stopped before this run completed.'
			});
			try {
				await this.commitExact(node, current.content.value, next);
				return await this.readNode(node.resource, false);
			} catch (error) {
				if (!isModifiedSince(error) || attempt === NODE_WRITE_MAX_ATTEMPTS - 1) {
					throw error;
				}
			}
		}
		throw new Error('The node changed repeatedly while recovering its interrupted run.');
	}

	private scheduleRunLeaseHeartbeat(resource: URI, active: IActiveRun): void {
		active.leaseHeartbeat?.dispose();
		if (active.leaseClosing || active.leaseLost || !active.lease) {
			return;
		}
		active.leaseHeartbeat = disposableTimeout(() => {
			void this.renewRunLease(resource, active).then(renewed => {
				if (renewed) {
					this.scheduleRunLeaseHeartbeat(resource, active);
				}
			});
		}, RUN_LEASE_HEARTBEAT_INTERVAL_MS);
	}

	private startStandaloneLeaseHeartbeat(handle: IBaseHalfNodeRunLeaseHandle): IDisposable {
		let disposed = false;
		let timer: IDisposable | undefined;
		const schedule = () => {
			timer = disposableTimeout(() => {
				void this.runLeaseStore.heartbeat(handle).then(renewed => {
					if (!disposed && renewed) {
						schedule();
					}
				});
			}, RUN_LEASE_HEARTBEAT_INTERVAL_MS);
		};
		schedule();
		return toDisposable(() => {
			disposed = true;
			timer?.dispose();
		});
	}

	private async renewRunLease(resource: URI, active: IActiveRun): Promise<boolean> {
		let renewed = false;
		const operation = active.leaseMutation.then(async () => {
			if (active.leaseClosing || active.leaseLost || !active.lease) {
				return;
			}
			try {
				const next = await this.runLeaseStore.heartbeat(active.lease);
				if (!next) {
					this.markRunLeaseLost(resource, active);
					return;
				}
				active.lease = next;
				renewed = true;
			} catch {
				this.markRunLeaseLost(resource, active);
			}
		});
		active.leaseMutation = operation.catch(() => undefined);
		await operation;
		return renewed;
	}

	private async assertRunLease(active: IActiveRun): Promise<void> {
		if (!await this.renewRunLease(active.state.resource, active)) {
			throw new Error('This run no longer owns its execution lease.');
		}
	}

	private markRunLeaseLost(resource: URI, active: IActiveRun): void {
		if (active.leaseLost) {
			return;
		}
		active.leaseLost = true;
		active.leaseHeartbeat?.dispose();
		active.state = {
			resource,
			runId: active.runId,
			phase: 'cancelling',
			message: 'Execution ownership was lost. The result will not be accepted.'
		};
		this._onDidChange.fire({ resource, state: active.state });
		active.cancellation.cancel();
	}

	private async closeRunLease(active: IActiveRun): Promise<void> {
		active.leaseClosing = true;
		active.leaseHeartbeat?.dispose();
		await active.leaseMutation;
		if (active.lease && !active.leaseLost) {
			try {
				await this.runLeaseStore.release(active.lease);
			} catch {
				// A retained active lease fails closed and becomes recoverable only
				// after its heartbeat expires.
			}
		}
	}

	private async collectAffectedNodeResources(
		operation: FileOperation,
		files: readonly SourceTargetPair[],
		cancellationToken: CancellationToken
	): Promise<readonly IBaseHalfWorkspaceResource[]> {
		const resources = new Map<string, IBaseHalfWorkspaceResource>();
		const visited = new Set<string>();
		const scan = { entries: 0 };
		for (const file of files) {
			for (const root of [file.source, file.target]) {
				throwIfNodeOperationCancelled(cancellationToken);
				if (!root || !await this.fileService.exists(root)) {
					continue;
				}
				const workspaceFolder = await this.findWorkspaceFolderForResource(root, cancellationToken);
				if (!workspaceFolder) {
					continue;
				}
				await this.collectNodeResourcesBelow(root, workspaceFolder, visited, scan, cancellationToken, async (resource, nodeWorkspaceFolder) => {
					if (!baseHalfStructuralOperationAffectsResource(operation, files, resource)) {
						return;
					}
					const relativePath = extUri.relativePath(nodeWorkspaceFolder, resource);
					if (!relativePath || baseHalfProjectPathProblem(relativePath)) {
						return;
					}
					resources.set(resource.toString(), { resource, workspaceFolder: nodeWorkspaceFolder, relativePath });
				});
			}
		}
		return Object.freeze([...resources.values()]);
	}

	private async collectNodeResourcesBelow(
		resource: URI,
		workspaceFolder: URI,
		visited: Set<string>,
		scan: { entries: number },
		cancellationToken: CancellationToken,
		accept: (resource: URI, workspaceFolder: URI) => Promise<void>
	): Promise<void> {
		const pending: { readonly resource: URI; readonly workspaceFolder: URI; readonly depth: number }[] = [{ resource, workspaceFolder, depth: 0 }];
		while (pending.length > 0) {
			throwIfNodeOperationCancelled(cancellationToken);
			const current = pending.pop()!;
			const relativePath = extUri.relativePath(current.workspaceFolder, current.resource);
			if (relativePath !== undefined && baseHalfIsReservedOutputTreePath(relativePath)) {
				continue;
			}
			const key = current.resource.toString();
			if (visited.has(key)) {
				continue;
			}
			visited.add(key);
			if (++scan.entries > MAX_STRUCTURAL_SCAN_ENTRIES) {
				throw new Error(`This file operation contains more than ${MAX_STRUCTURAL_SCAN_ENTRIES.toLocaleString()} entries. Move or delete a smaller folder at a time.`);
			}
			const stat = await this.fileService.resolve(current.resource);
			throwIfNodeOperationCancelled(cancellationToken);
			if (stat.isSymbolicLink) {
				continue;
			}
			if (!stat.isDirectory) {
				if (current.resource.path.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
					await accept(current.resource, current.workspaceFolder);
				}
				continue;
			}
			const children = stat.children ?? [];
			const nestedWorkspace = children.some(child => child.isDirectory && !child.isSymbolicLink && basename(child.resource) === '.bh')
				? current.resource
				: current.workspaceFolder;
			const visibleChildren = children.filter(child => basename(child.resource) !== '.bh');
			if (visibleChildren.length > 0 && current.depth >= MAX_STRUCTURAL_SCAN_DEPTH) {
				throw new Error(`This file operation is nested more than ${MAX_STRUCTURAL_SCAN_DEPTH} folders deep. Move or delete a shallower folder at a time.`);
			}
			for (let index = visibleChildren.length - 1; index >= 0; index--) {
				pending.push({ resource: visibleChildren[index].resource, workspaceFolder: nestedWorkspace, depth: current.depth + 1 });
			}
		}
	}

	private async findWorkspaceFolderForResource(resource: URI, cancellationToken: CancellationToken): Promise<URI | undefined> {
		const stat = await this.fileService.stat(resource);
		let current = stat.isDirectory ? resource : dirname(resource);
		for (let depth = 0; depth <= MAX_STRUCTURAL_SCAN_DEPTH; depth++) {
			throwIfNodeOperationCancelled(cancellationToken);
			if (await this.fileService.exists(URI.joinPath(current, '.bh'))) {
				return current;
			}
			const parent = dirname(current);
			if (extUri.isEqual(parent, current)) {
				return undefined;
			}
			current = parent;
		}
		throw new Error(`The workspace path is nested more than ${MAX_STRUCTURAL_SCAN_DEPTH} folders deep.`);
	}

	private async selectCurrentVerified(
		node: IBaseHalfWorkspaceResource,
		versionId: string,
		current: IReadNodeDocumentResult,
		lease: IBaseHalfNodeRunLeaseHandle
	): Promise<IBaseHalfNodeCurrentSelectionTransition> {
		if (this.workingCopyService.isDirty(node.resource)) {
			throw new Error('Save this node before choosing a historical result.');
		}
		if (current.document.runs.some(run => run.status === 'running')) {
			throw new Error('Wait for the active run before selecting a historical result.');
		}
		const next = selectBaseHalfNodeCurrent(current.document, versionId);
		for (const artifact of getBaseHalfNodeCurrentArtifacts(next)) {
			const integrity = await this.getArtifactIntegrity(node.workspaceFolder, artifact, { fresh: true });
			if (integrity !== 'available') {
				throw new Error(integrity === 'missing'
					? `Output missing: '${artifact.path}'. The historical record is unchanged.`
					: `Output changed: '${artifact.path}'. The historical record is unchanged.`);
			}
		}
		if (!await this.runLeaseStore.heartbeat(lease)) {
			throw new Error('The node changed ownership before its historical result could be selected.');
		}
		const before = VSBuffer.fromString(serializeBaseHalfNodeDocument(current.document));
		const after = VSBuffer.fromString(serializeBaseHalfNodeDocument(next));
		const document = await this.commitExact(node, current.content.value, next);
		return { document, before, after };
	}

	private async stableRegularFileDigest(resource: URI, label: string): Promise<{ readonly realpath: URI; readonly etag: string; readonly size: number; readonly sha256: string }> {
		const before = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (!before.isFile || before.isSymbolicLink) {
			throw new Error(`The ${label} must be a regular local file.`);
		}
		const realpathBefore = await this.fileService.realpath(resource);
		if (!realpathBefore) {
			throw new Error(`The ${label} cannot be verified.`);
		}
		const firstSha256 = toUrlSafeChecksum(await this.checksumService.checksum(resource));
		const middle = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (!middle.isFile || middle.isSymbolicLink || middle.etag !== before.etag || middle.size !== before.size) {
			throw new Error(`The ${label} changed while it was being verified.`);
		}
		const secondSha256 = toUrlSafeChecksum(await this.checksumService.checksum(resource));
		const [after, realpathAfter] = await Promise.all([
			this.fileService.resolve(resource, { resolveMetadata: true }),
			this.fileService.realpath(resource)
		]);
		if (!after.isFile || after.isSymbolicLink
			|| after.etag !== middle.etag || after.size !== middle.size
			|| !realpathAfter || !extUri.isEqual(realpathAfter, realpathBefore)
			|| secondSha256 !== firstSha256) {
			throw new Error(`The ${label} changed while it was being verified.`);
		}
		return Object.freeze({ realpath: realpathAfter, etag: after.etag, size: after.size, sha256: secondSha256 });
	}

	private async resourceArtifactIntegrity(
		resource: URI,
		artifact: IBaseHalfNodeRunArtifact,
		fresh: boolean
	): Promise<BaseHalfNodeArtifactIntegrity> {
		try {
			const before = await this.fileService.resolve(resource, { resolveMetadata: true });
			if (!before.isFile || before.isSymbolicLink || before.size !== artifact.size) {
				return 'changed';
			}
			const cacheKey = artifactIntegrityCacheKey(resource, artifact);
			const cached = this.artifactIntegrityCache.get(cacheKey);
			if (!fresh && cached && cached.etag === before.etag && cached.size === before.size) {
				refreshBoundedCacheEntry(this.artifactIntegrityCache, cacheKey, cached, MAX_ARTIFACT_INTEGRITY_CACHE_ENTRIES);
				return cached.integrity;
			}
			const sha256 = toUrlSafeChecksum(await this.checksumService.checksum(resource));
			const after = await this.fileService.resolve(resource, { resolveMetadata: true });
			const integrity = !after.isFile
				|| after.isSymbolicLink
				|| after.size !== before.size
				|| after.etag !== before.etag
				|| sha256 !== artifact.sha256
				? 'changed'
				: 'available';
			if (after.isFile && !after.isSymbolicLink && after.size === before.size && after.etag === before.etag) {
				refreshBoundedCacheEntry(this.artifactIntegrityCache, cacheKey, Object.freeze({
					resource,
					etag: after.etag,
					size: after.size,
					integrity
				}), MAX_ARTIFACT_INTEGRITY_CACHE_ENTRIES);
			}
			return integrity;
		} catch (error) {
			return isFileNotFound(error) ? 'missing' : 'changed';
		}
	}

	private async resolveRunModel(recipe: IBaseHalfCanvasRecipeDescriptor, modelServiceId: string | undefined, modelId: string | undefined): Promise<IResolvedRunModel> {
		if (!recipe.modelCapability) {
			if (modelServiceId !== undefined || modelId !== undefined) {
				return Object.freeze({
					history: Object.freeze({ source: 'local' }),
					preparationError: `Recipe '${recipe.label}' does not use a model service.`
				});
			}
			return Object.freeze({ history: Object.freeze({ source: 'local' }) });
		}
		if (!modelServiceId) {
			return Object.freeze({
				history: Object.freeze({ source: 'service', connection: 'unavailable', capability: recipe.modelCapability }),
				preparationError: `Choose a ${recipe.modelCapability} model service before running '${recipe.label}'.`
			});
		}
		let services: readonly IBaseHalfModelServiceDescriptor[];
		try {
			services = await this.modelServiceService.getServices(undefined, recipe.modelCapability);
		} catch {
			return Object.freeze({
				history: Object.freeze({ source: 'service', connection: 'unavailable', serviceId: modelServiceId, capability: recipe.modelCapability, ...(modelId === undefined ? {} : { modelId }) }),
				preparationError: `Model service '${modelServiceId}' could not be checked.`
			});
		}
		const service = services.find(candidate => candidate.id === modelServiceId.toLowerCase());
		if (!service) {
			return Object.freeze({
				history: Object.freeze({ source: 'service', connection: 'unavailable', serviceId: modelServiceId, capability: recipe.modelCapability, ...(modelId === undefined ? {} : { modelId }) }),
				preparationError: `Model service '${modelServiceId}' is unavailable.`
			});
		}
		const snapshot: IBaseHalfModelServiceRunSnapshot = Object.freeze({
			serviceId: service.id,
			serviceLabel: service.label,
			connectionIdentity: service.connectionIdentity,
			capability: recipe.modelCapability,
			...(modelId === undefined ? {} : { modelId })
		});
		const history: BaseHalfNodeRunModel = Object.freeze({ source: 'service', connection: 'resolved', ...snapshot });
		if (!service.configured) {
			return Object.freeze({
				history,
				preparationError: `Model service '${modelServiceId}' needs an API key.`
			});
		}
		return Object.freeze({
			history,
			execution: snapshot
		});
	}

	private requestedRunModel(recipe: IBaseHalfCanvasRecipeDescriptor, modelServiceId: string | undefined, modelId: string | undefined): BaseHalfNodeRunModel {
		if (!recipe.modelCapability) {
			return Object.freeze({ source: 'local' });
		}
		return Object.freeze({
			source: 'service',
			connection: 'unavailable',
			...(modelServiceId === undefined ? {} : { serviceId: modelServiceId }),
			capability: recipe.modelCapability,
			...(modelId === undefined ? {} : { modelId })
		});
	}

	private async assertDirectInputsSaved(workspaceFolder: URI, bindings: readonly IBaseHalfNodeInputBinding[]): Promise<void> {
		const dirty = new Set<string>();
		for (const binding of bindings) {
			const source = joinProjectPath(workspaceFolder, binding.sourcePath);
			if (this.hasDirtyWorkingCopyAtOrBelow(source)) {
				dirty.add(binding.sourcePath);
			}
			if (!binding.sourcePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
				continue;
			}
			const sourceNode = await this.readDirectInputNode(workspaceFolder, binding.sourcePath, source);
			const primary = getBaseHalfNodeCurrentPrimaryArtifact(sourceNode.document);
			if (primary && this.workingCopyService.isDirty(joinProjectPath(workspaceFolder, primary.path))) {
				dirty.add(`${binding.sourcePath} Current (${primary.path})`);
			}
		}
		if (dirty.size === 0) {
			return;
		}
		const dirtyPaths = [...dirty];
		throw new Error(dirty.size === 1
			? `Save direct input '${dirtyPaths[0]}' before running this node.`
			: `Save these direct inputs before running this node: ${dirtyPaths.join(', ')}.`);
	}

	private async preflightInputs(
		target: IBaseHalfWorkspaceResource,
		recipe: IBaseHalfCanvasRecipeDescriptor,
		bindings: readonly IBaseHalfNodeInputBinding[],
		active: IActiveRun
	): Promise<void> {
		const targetNode: IBaseHalfBadgeNode = { ...target, kind: 'file' };
		const neighborhood = await this.badgeGraphService.readBadgeNeighborhood(targetNode);
		if (neighborhood.problems.length) {
			throw new Error('One or more direct context references cannot be read. Repair them before running this node.');
		}
		const targetBadge = neighborhood.badges.get(target.relativePath);
		const boundPaths = new Set(bindings.map(binding => binding.sourcePath));
		const unassigned = (targetBadge?.referenced_by ?? []).filter(path => !boundPaths.has(path));
		if (unassigned.length > 0) {
			throw new Error(`Assign every direct context connection to this recipe before running. Unassigned: ${unassigned.join(', ')}.`);
		}

		const inputs: IBaseHalfCanvasRecipeInput[] = [];
		for (const binding of bindings) {
			this.throwIfCancelled(active);
			const sourceBadge = neighborhood.badges.get(binding.sourcePath);
			if (!targetBadge?.referenced_by.includes(binding.sourcePath) || !sourceBadge?.references.includes(target.relativePath)) {
				throw new Error(`'${binding.sourcePath}' is not a complete direct context reference into this node.`);
			}
			inputs.push({
				edgeId: `${binding.sourcePath}->${target.relativePath}`,
				slotId: binding.slot,
				order: binding.order,
				source: await this.preflightSource(target.workspaceFolder, binding.sourcePath)
			});
		}
		validateBaseHalfCanvasRecipeInputs(recipe, inputs);
	}

	private async preflightSource(workspaceFolder: URI, relativePath: string): Promise<IBaseHalfCanvasNodeSnapshot> {
		const resource = joinProjectPath(workspaceFolder, relativePath);
		if (this.hasDirtyWorkingCopyAtOrBelow(resource)) {
			throw new Error(`Save direct input '${relativePath}' before running this node.`);
		}
		const stat = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (!stat.isDirectory && relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			const node = await this.readDirectInputNode(workspaceFolder, relativePath, resource);
			if (node.document.current.source === 'empty') {
				throw new Error(directResultNoCurrentMessage(relativePath));
			}
			const primary = getBaseHalfNodeCurrentPrimaryArtifact(node.document);
			if (!primary) {
				throw new Error(directResultNoPrimaryMessage(relativePath));
			}
			const primaryResource = joinProjectPath(workspaceFolder, primary.path);
			if (this.workingCopyService.isDirty(primaryResource)) {
				throw new Error(`Save Current output '${primary.path}' from direct input '${relativePath}' before running this node.`);
			}
			const integrity = await this.getArtifactIntegrity(workspaceFolder, primary, { fresh: true });
			if (integrity !== 'available') {
				throw new Error(directResultIntegrityMessage(relativePath, primary.path, integrity));
			}
			assertDirectResultCurrentIdentity(node.document, relativePath, primary.id);
			return {
				id: node.document.id,
				path: relativePath,
				kind: primary.kind,
				resource,
				current: {
					id: `${node.document.id}:current`,
					kind: primary.kind,
					resource: primaryResource,
					...(node.document.current.runId === undefined ? {} : { runId: node.document.current.runId })
				}
			};
		}

		const kind = baseHalfCanvasContentKindForPath(relativePath, stat.isDirectory);
		return {
			id: relativePath,
			path: relativePath,
			kind,
			resource,
			current: { id: relativePath, kind, resource }
		};
	}

	private hasDirtyWorkingCopyAtOrBelow(resource: URI): boolean {
		return this.workingCopyService.dirtyWorkingCopies.some(workingCopy => extUri.isEqualOrParent(workingCopy.resource, resource));
	}

	private async resolveInputs(
		target: IBaseHalfWorkspaceResource,
		recipe: IBaseHalfCanvasRecipeDescriptor,
		bindings: readonly IBaseHalfNodeInputBinding[],
		inputDirectory: URI,
		active: IActiveRun
	): Promise<readonly IResolvedInput[]> {
		const targetNode: IBaseHalfBadgeNode = { ...target, kind: 'file' };
		const neighborhood = await this.badgeGraphService.readBadgeNeighborhood(targetNode);
		if (neighborhood.problems.length) {
			throw new Error('One or more direct context references cannot be read. Repair them before running this node.');
		}
		const targetBadge = neighborhood.badges.get(target.relativePath);
		const boundPaths = new Set(bindings.map(binding => binding.sourcePath));
		const unassigned = (targetBadge?.referenced_by ?? []).filter(path => !boundPaths.has(path));
		if (unassigned.length > 0) {
			throw new Error(`Assign every direct context connection to this recipe before running. Unassigned: ${unassigned.join(', ')}.`);
		}
		const resolved: IResolvedInput[] = [];
		for (const binding of bindings) {
			this.throwIfCancelled(active);
			const sourceBadge = neighborhood.badges.get(binding.sourcePath);
			if (!targetBadge?.referenced_by.includes(binding.sourcePath) || !sourceBadge?.references.includes(target.relativePath)) {
				throw new Error(`'${binding.sourcePath}' is not a complete direct context reference into this node.`);
			}
			const source = await this.resolveSourceSnapshot(target.workspaceFolder, binding, inputDirectory, active);
			resolved.push({
				execution: {
					edgeId: `${binding.sourcePath}->${target.relativePath}`,
					slotId: binding.slot,
					order: binding.order,
					source: source.snapshot
				},
				history: { ...binding, revision: source.revision }
			});
		}
		validateBaseHalfCanvasRecipeInputs(recipe, resolved.map(input => input.execution));
		return resolved;
	}

	private async resolveSourceSnapshot(
		workspaceFolder: URI,
		binding: IBaseHalfNodeInputBinding,
		inputDirectory: URI,
		active: IActiveRun
	): Promise<{ snapshot: IBaseHalfCanvasNodeSnapshot; revision: string }> {
		const relativePath = binding.sourcePath;
		const resource = joinProjectPath(workspaceFolder, relativePath);
		if (this.hasDirtyWorkingCopyAtOrBelow(resource)) {
			throw new Error(`Save direct input '${relativePath}' before running this node.`);
		}
		const stat = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			const node = await this.readDirectInputNode(workspaceFolder, relativePath, resource);
			if (node.document.current.source === 'empty') {
				throw new Error(directResultNoCurrentMessage(relativePath));
			}
			const primary = getBaseHalfNodeCurrentPrimaryArtifact(node.document);
			if (!primary) {
				throw new Error(directResultNoPrimaryMessage(relativePath));
			}
			const currentPath = primary.path;
			const currentKind = primary.kind;
			if (this.workingCopyService.isDirty(joinProjectPath(workspaceFolder, currentPath))) {
				throw new Error(`Save Current output '${currentPath}' from direct input '${relativePath}' before running this node.`);
			}
			const snapshotName = inputSnapshotName(binding.order, basename(URI.file(currentPath)));
			const frozen = await this.snapshotResource(workspaceFolder, joinProjectPath(workspaceFolder, currentPath), URI.joinPath(inputDirectory, snapshotName), active, primary);
			const frozenResource = frozen.resource;
			let revision: string;
			if (node.document.current.source === 'run' && node.document.current.runId) {
				assertDirectResultCurrentIdentity(node.document, relativePath, primary.id);
				revision = await runInputRevision(node.document.current.runId, primary.id, frozen.digest);
			} else if (node.document.current.source === 'imported' && node.document.current.revisionId) {
				assertDirectResultCurrentIdentity(node.document, relativePath, primary.id);
				revision = await revisionInputRevision(node.document.current.revisionId, primary.id, frozen.digest);
			} else {
				throw new Error(directResultNoIdentityMessage(relativePath));
			}
			return {
				snapshot: {
					id: node.document.id,
					path: relativePath,
					kind: currentKind,
					resource: frozenResource,
					current: {
						id: `${node.document.id}:current`,
						kind: currentKind,
						resource: frozenResource,
						...(node.document.current.runId === undefined ? {} : { runId: node.document.current.runId })
					}
				},
				revision
			};
		}
		const frozen = await this.snapshotResource(workspaceFolder, resource, URI.joinPath(inputDirectory, inputSnapshotName(binding.order, basename(resource))), active);
		const kind = baseHalfCanvasContentKindForPath(relativePath, stat.isDirectory);
		return {
			snapshot: {
				id: relativePath,
				path: relativePath,
				kind,
				resource: frozen.resource,
				current: { id: relativePath, kind, resource: frozen.resource }
			},
			revision: await sourceInputRevision(relativePath, frozen.digest)
		};
	}

	private toNodeSnapshot(node: IBaseHalfWorkspaceResource, document: IBaseHalfNodeDocument, frozenResource: URI): IBaseHalfCanvasNodeSnapshot {
		return {
			id: document.id,
			path: node.relativePath,
			kind: document.kind,
			resource: frozenResource
		};
	}

	private async validateArtifacts(
		workspaceFolder: URI,
		outputDirectory: URI,
		runDirectory: URI,
		guardResource: URI,
		guardValue: string,
		expectedRunRealpath: URI,
		expectedOutputRealpath: URI,
		result: IBaseHalfCanvasRecipeExecutionResult
	): Promise<IAcceptedArtifacts> {
		await this.assertRunGuard(runDirectory, outputDirectory, guardResource, guardValue, expectedRunRealpath, expectedOutputRealpath);
		if (!result.primaryArtifactId) {
			throw new Error('Recipe result did not identify one primary artifact.');
		}
		const primary = result.artifacts.find(artifact => artifact.id === result.primaryArtifactId);
		if (!primary) {
			throw new Error('Recipe result primary artifact is missing.');
		}
		const ordered = [primary, ...result.artifacts.filter(artifact => artifact !== primary)];
		const artifacts: IBaseHalfNodeRunArtifact[] = [];
		for (const artifact of ordered) {
			await this.assertNoSymbolicLinkComponents(outputDirectory, artifact.resource);
			const stat = await this.fileService.resolve(artifact.resource, { resolveMetadata: true });
			if (!stat.isFile || stat.isSymbolicLink) {
				throw new Error(`Recipe output '${artifact.id}' must be a regular local file.`);
			}
			const realpath = await this.fileService.realpath(artifact.resource);
			if (!realpath || !extUri.isEqualOrParent(realpath, expectedOutputRealpath) || extUri.isEqual(realpath, expectedOutputRealpath)) {
				throw new Error(`Recipe output '${artifact.id}' resolves outside its verified run directory.`);
			}
			const relativePath = extUri.relativePath(workspaceFolder, artifact.resource);
			if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) {
				throw new Error(`Recipe output '${artifact.id}' is outside the project.`);
			}
			const sha256 = toUrlSafeChecksum(await this.checksumService.checksum(artifact.resource));
			const verifiedStat = await this.fileService.resolve(artifact.resource, { resolveMetadata: true });
			if (!verifiedStat.isFile || verifiedStat.isSymbolicLink || verifiedStat.etag !== stat.etag || verifiedStat.size !== stat.size) {
				throw new Error(`Recipe output '${artifact.id}' changed while it was being accepted.`);
			}
			artifacts.push(Object.freeze({
				id: artifact.id,
				outputId: artifact.outputId,
				kind: artifact.kind as BaseHalfNodeArtifactKind,
				path: relativePath,
				sha256,
				size: stat.size,
				...(artifact.label === undefined ? {} : { label: artifact.label })
			}));
		}
		return Object.freeze({
			artifacts: Object.freeze(artifacts),
			primaryArtifactId: result.primaryArtifactId,
			...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId }),
			...(result.usage === undefined ? {} : { usage: result.usage }),
			...(result.cost === undefined ? {} : { cost: result.cost })
		});
	}

	private async snapshotResource(
		workspaceFolder: URI,
		source: URI,
		target: URI,
		active: IActiveRun,
		expectedArtifact?: IBaseHalfNodeRunArtifact
	): Promise<{ readonly resource: URI; readonly digest: string }> {
		if (extUri.isEqualOrParent(target, source) || extUri.isEqualOrParent(source, target)) {
			throw new Error('A direct input cannot contain its own immutable snapshot directory.');
		}
		await this.assertNoSymbolicLinkComponents(workspaceFolder, source);
		if (expectedArtifact) {
			const integrity = await this.resourceArtifactIntegrity(source, expectedArtifact, true);
			if (integrity !== 'available') {
				throw new Error(integrity === 'missing'
					? `Output missing: '${expectedArtifact.path}'. Choose another result or run the source again.`
					: `Output changed: '${expectedArtifact.path}'. Choose another result or run the source again.`);
			}
		}
		const sourceRoot = await this.fileService.realpath(workspaceFolder);
		if (!sourceRoot) {
			throw new Error('This workspace file system cannot verify immutable input snapshots.');
		}
		const before = { entries: 0, bytes: 0 };
		const beforeManifest = await this.snapshotTreeDigest(sourceRoot, source, source, before, active, true);
		this.throwIfCancelled(active);
		await this.fileService.copy(source, target, false);
		this.throwIfCancelled(active);
		if (expectedArtifact) {
			const [sourceIntegrity, targetIntegrity] = await Promise.all([
				this.resourceArtifactIntegrity(source, expectedArtifact, true),
				this.resourceArtifactIntegrity(target, expectedArtifact, true)
			]);
			if (sourceIntegrity !== 'available' || targetIntegrity !== 'available') {
				throw new Error(`Output changed: '${expectedArtifact.path}'. Choose another result or run the source again.`);
			}
		}
		const targetRoot = await this.fileService.realpath(dirname(target));
		if (!targetRoot) {
			throw new Error('The input snapshot directory cannot be verified.');
		}
		const after = { entries: 0, bytes: 0 };
		const targetManifest = await this.snapshotTreeDigest(targetRoot, target, target, after, active, true);
		const sourceAfter = { entries: 0, bytes: 0 };
		const sourceAfterManifest = await this.snapshotTreeDigest(sourceRoot, source, source, sourceAfter, active, true);
		if (beforeManifest !== sourceAfterManifest || beforeManifest !== targetManifest) {
			throw new Error(`Direct input '${source.toString()}' changed while it was being frozen. Run again to retry.`);
		}
		const digest = expectedArtifact?.sha256 ?? await sha256Text(targetManifest);
		return Object.freeze({ resource: target, digest });
	}

	private async fingerprintResource(
		workspaceFolder: URI,
		resource: URI,
		fresh: boolean,
		knownStat?: { readonly etag: string; readonly size: number; readonly isDirectory: boolean }
	): Promise<string> {
		const before = knownStat ?? await this.fileService.resolve(resource, { resolveMetadata: true });
		const cacheKey = resource.toString();
		const cached = this.inputFingerprintCache.get(cacheKey);
		if (!fresh
			&& cached
			&& cached.etag === before.etag
			&& cached.size === before.size
			&& cached.isDirectory === before.isDirectory) {
			refreshBoundedCacheEntry(this.inputFingerprintCache, cacheKey, cached, MAX_INPUT_FINGERPRINT_CACHE_ENTRIES);
			return cached.digest;
		}
		const workspaceRealpath = await this.fileService.realpath(workspaceFolder);
		if (!workspaceRealpath) {
			throw new Error('This workspace file system cannot verify direct inputs.');
		}
		const budget = { entries: 0, bytes: 0 };
		const manifest = await this.snapshotTreeDigest(workspaceRealpath, resource, resource, budget, undefined, true);
		const after = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (after.etag !== before.etag || after.size !== before.size || after.isDirectory !== before.isDirectory) {
			throw new Error(`Direct input '${resource.toString()}' changed while its status was being checked.`);
		}
		const digest = await sha256Text(manifest);
		refreshBoundedCacheEntry(this.inputFingerprintCache, cacheKey, Object.freeze({
			resource,
			etag: after.etag,
			size: after.size,
			isDirectory: after.isDirectory,
			digest
		}), MAX_INPUT_FINGERPRINT_CACHE_ENTRIES);
		return digest;
	}

	private async snapshotTreeDigest(
		allowedRootRealpath: URI,
		root: URI,
		resource: URI,
		budget: { entries: number; bytes: number },
		active: IActiveRun | undefined,
		includeDigest: boolean
	): Promise<string> {
		if (active) {
			this.throwIfCancelled(active);
		}
		const stat = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (stat.isSymbolicLink || (!stat.isFile && !stat.isDirectory)) {
			throw new Error(`Input '${resource.toString()}' contains an unsupported or symbolic-link entry.`);
		}
		const realpath = await this.fileService.realpath(resource);
		if (!realpath || !extUri.isEqualOrParent(realpath, allowedRootRealpath)) {
			throw new Error(`Input '${resource.toString()}' resolves outside the project.`);
		}
		budget.entries++;
		budget.bytes += stat.isFile ? stat.size : 0;
		if (budget.entries > MAX_INPUT_SNAPSHOT_ENTRIES || budget.bytes > MAX_INPUT_SNAPSHOT_BYTES) {
			throw new Error('A direct input is too large to freeze safely for one run.');
		}
		if (stat.isFile) {
			const relative = extUri.relativePath(root, resource) ?? '';
			const checksum = includeDigest ? toUrlSafeChecksum(await this.checksumService.checksum(resource)) : '';
			return `${relative}\u0000file\u0000${stat.size}\u0000${checksum}`;
		}
		const children = [...(stat.children ?? [])].sort((left, right) => basename(left.resource).localeCompare(basename(right.resource)));
		const entries: string[] = [];
		for (const child of children) {
			entries.push(await this.snapshotTreeDigest(allowedRootRealpath, root, child.resource, budget, active, includeDigest));
		}
		const relative = extUri.relativePath(root, resource) ?? '';
		return includeDigest ? `${relative}\u0000directory\n${entries.join('\n')}` : '';
	}

	private async requireVerifiedDirectory(allowedRoot: URI, resource: URI, label: string): Promise<URI> {
		const stat = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (!stat.isDirectory || stat.isSymbolicLink) {
			throw new Error(`The ${label} is not a regular local directory.`);
		}
		const [allowedRootRealpath, realpath] = await Promise.all([
			this.fileService.realpath(allowedRoot),
			this.fileService.realpath(resource)
		]);
		if (!allowedRootRealpath || !realpath || !extUri.isEqualOrParent(realpath, allowedRootRealpath) || extUri.isEqual(realpath, allowedRootRealpath)) {
			throw new Error(`The ${label} resolves outside its allowed parent.`);
		}
		return realpath;
	}

	private async assertRunGuard(
		runDirectory: URI,
		outputDirectory: URI,
		guardResource: URI,
		guardValue: string,
		expectedRunRealpath: URI,
		expectedOutputRealpath: URI
	): Promise<void> {
		const [actualRunRealpath, actualOutputRealpath, guard] = await Promise.all([
			this.fileService.realpath(runDirectory),
			this.fileService.realpath(outputDirectory),
			this.fileService.readFile(guardResource, { limits: { size: 256 } })
		]);
		if (!actualRunRealpath || !actualOutputRealpath
			|| !extUri.isEqual(actualRunRealpath, expectedRunRealpath)
			|| !extUri.isEqual(actualOutputRealpath, expectedOutputRealpath)
			|| guard.value.toString() !== guardValue) {
			throw new Error('The verified run directory changed during execution.');
		}
		await this.assertNoSymbolicLinkComponents(runDirectory, outputDirectory);
	}

	private async assertNoSymbolicLinkComponents(root: URI, resource: URI): Promise<void> {
		const relative = extUri.relativePath(root, resource);
		if (relative === undefined || relative === '..' || relative.startsWith('../')) {
			throw new Error('A recipe path resolves outside its verified directory.');
		}
		let current = root;
		for (const segment of relative.split('/').filter(Boolean)) {
			current = URI.joinPath(current, segment);
			if ((await this.fileService.stat(current)).isSymbolicLink) {
				throw new Error('A recipe path contains a symbolic-link component.');
			}
		}
	}

	private reportProgress(resource: URI, active: IActiveRun, progress: IBaseHalfCanvasRecipeProgress): void {
		if (this.activeRuns.get(resource.toString()) !== active || active.userCancelled) {
			return;
		}
		const nextProgress = progress.increment === undefined
			? active.state.progress
			: Math.max(0, Math.min(100, (active.state.progress ?? 0) + progress.increment));
		this.updateActive(resource, active, {
			phase: 'running',
			...(progress.message === undefined ? {} : { message: progress.message }),
			...(nextProgress === undefined ? {} : { progress: nextProgress })
		});
	}

	private updateActive(resource: URI, active: IActiveRun, patch: Pick<IBaseHalfNodeExecutionState, 'phase'> & Partial<Pick<IBaseHalfNodeExecutionState, 'message' | 'progress'>>): void {
		active.state = { resource, runId: active.runId, ...patch };
		this._onDidChange.fire({ resource, state: active.state });
	}

	private throwIfCancelled(active: IActiveRun): void {
		if (active.cancellation.token.isCancellationRequested) {
			throw new CancellationError();
		}
	}

	private async readNode(resource: URI, activeHost: boolean): Promise<IReadNodeDocumentResult> {
		const content = await this.fileService.readFile(resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		return {
			content,
			document: activeHost
				? parseBaseHalfNodeDocumentBytesForActiveHost(content.value.buffer)
					: parseBaseHalfNodeDocumentBytes(content.value.buffer)
		};
	}

	private async readDirectInputNode(workspaceFolder: URI, relativePath: string, resource: URI): Promise<IReadNodeDocumentResult> {
		if (baseHalfProjectPathProblem(relativePath)
			|| !relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)
			|| extUri.relativePath(workspaceFolder, resource) !== relativePath) {
			throw new Error(`A direct result input must use a portable ${BASEHALF_NODE_DOCUMENT_EXTENSION} project path.`);
		}
		await assertBaseHalfWorkspaceFile(this.fileService, workspaceFolder, resource, 'direct input node document');
		const result = await this.readNode(resource, false);
		await assertBaseHalfWorkspaceFile(this.fileService, workspaceFolder, resource, 'direct input node document');
		return result;
	}

	private async assertSafeNodeResource(node: IBaseHalfWorkspaceResource): Promise<void> {
		if (baseHalfProjectPathProblem(node.relativePath)
			|| !node.relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			throw new Error(`The node path must be a portable ${BASEHALF_NODE_DOCUMENT_EXTENSION} project path.`);
		}
		const relativePath = extUri.relativePath(node.workspaceFolder, node.resource);
		if (relativePath !== node.relativePath) {
			throw new Error('The node resource does not match its project-relative path.');
		}
		await assertBaseHalfWorkspaceFile(this.fileService, node.workspaceFolder, node.resource, 'node document');
	}

	private async commitExact(node: IBaseHalfWorkspaceResource, expected: VSBuffer, document: IBaseHalfNodeDocument): Promise<IBaseHalfNodeDocument> {
		await this.assertSafeNodeResource(node);
		const contents = VSBuffer.fromString(serializeBaseHalfNodeDocument(document));
		await this.fileService.writeFileWithExpectedContents(node.resource, contents, expected, {
			atomic: { postfix: NODE_WRITE_TEMP_POSTFIX }
		});
		this._onDidChange.fire({ resource: node.resource, state: this.getActiveRun(node.resource) });
		return document;
	}

	private async patchNode(
		node: IBaseHalfWorkspaceResource,
		activeHost: boolean,
		update: (document: IBaseHalfNodeDocument) => IBaseHalfNodeDocument
	): Promise<IBaseHalfNodeDocument> {
		for (let attempt = 0; attempt < NODE_WRITE_MAX_ATTEMPTS; attempt++) {
			await this.assertSafeNodeResource(node);
			const current = await this.readNode(node.resource, activeHost);
			const next = update(current.document);
			try {
				return await this.commitExact(node, current.content.value, next);
			} catch (error) {
				if (!isModifiedSince(error) || attempt === NODE_WRITE_MAX_ATTEMPTS - 1) {
					throw error;
				}
			}
		}
		throw new Error('Node changed repeatedly while saving its run state.');
	}
}

/**
 * Performs a fresh, bounded workspace scan before an operation uses a node's
 * stable identity as a mutation namespace. The execution lease remains the
 * concurrency authority; this check rejects identities that are already
 * duplicated on disk.
 */
export async function baseHalfAssertUniqueNodeIdentity(
	fileService: IFileService,
	node: IBaseHalfWorkspaceResource,
	expectedNodeId: string,
	limits?: Partial<IBaseHalfNodeIdentityScanLimits>,
	cancellationToken: CancellationToken = CancellationToken.None
): Promise<void> {
	const identities = await baseHalfScanWorkspaceNodeIdentities(fileService, node.workspaceFolder, limits, cancellationToken);
	const target = identities.find(identity => extUri.isEqual(identity.resource, node.resource));
	if (!target || target.document.id !== expectedNodeId) {
		throw new Error(`Node '${node.relativePath}' changed while its stable identity was being checked. Save or reopen it, then try again.`);
	}
	baseHalfAssertIdentityEntryUnique(target, identities);
}

async function baseHalfAssertUniqueImportTargetIdentity(
	fileService: IFileService,
	workspaceFolder: URI,
	target: URI
): Promise<void> {
	const identities = await baseHalfScanWorkspaceNodeIdentities(fileService, workspaceFolder);
	const owners = identities.filter(identity => {
		const assetDirectory = baseHalfNodeImportedAssetDirectory(workspaceFolder, identity.document.id);
		return !extUri.isEqual(target, assetDirectory) && extUri.isEqualOrParent(target, assetDirectory);
	});
	if (owners.length === 0) {
		throw new Error('The import target is not inside the verified asset folder of a node. Reopen the node and choose the file again.');
	}
	const owner = owners[0];
	if (owners.some(candidate => candidate.document.id !== owner.document.id)) {
		throw new Error('The import target matches more than one node asset folder. Choose the file again after resolving the node paths.');
	}
	baseHalfAssertIdentityEntryUnique(owner, identities);
}

function baseHalfAssertIdentityEntryUnique(
	target: IBaseHalfWorkspaceNodeIdentity,
	identities: readonly IBaseHalfWorkspaceNodeIdentity[]
): void {
	const conflicts = identities
		.filter(identity => identity.document.id === target.document.id)
		.map(identity => identity.relativePath)
		.sort((left, right) => left.localeCompare(right));
	if (conflicts.length <= 1) {
		return;
	}
	const visiblePaths = conflicts.slice(0, 3).map(path => `'${path}'`).join(', ');
	const remaining = conflicts.length - 3;
	throw new Error(`Node identity conflict: ${visiblePaths}${remaining > 0 ? ` and ${remaining} more` : ''} share one stable identity. Remove the accidental copy or recreate it with Duplicate before running, importing, or changing History.`);
}

async function baseHalfScanWorkspaceNodeIdentities(
	fileService: IFileService,
	workspaceFolder: URI,
	requestedLimits?: Partial<IBaseHalfNodeIdentityScanLimits>,
	cancellationToken: CancellationToken = CancellationToken.None
): Promise<readonly IBaseHalfWorkspaceNodeIdentity[]> {
	throwIfNodeOperationCancelled(cancellationToken);
	const limits = baseHalfNodeIdentityScanLimits(requestedLimits);
	const provider = fileService.getProvider(workspaceFolder.scheme);
	if (!provider) {
		throw new Error('This project file system is unavailable while node identities are being checked.');
	}
	const workspaceStat = await provider.stat(workspaceFolder);
	if (!baseHalfProviderStatIsDirectory(workspaceStat.type) || baseHalfProviderStatIsSymbolicLink(workspaceStat.type)) {
		throw new Error('This project must be a regular local folder before node identities can be checked.');
	}
	const workspaceRealpath = await fileService.realpath(workspaceFolder);
	if (!workspaceRealpath) {
		throw new Error('This project file system cannot verify node identities.');
	}

	const pending: { readonly resource: URI; readonly depth: number }[] = [{ resource: workspaceFolder, depth: 0 }];
	const identities: IBaseHalfWorkspaceNodeIdentity[] = [];
	let entries = 0;
	while (pending.length > 0) {
		throwIfNodeOperationCancelled(cancellationToken);
		const current = pending.pop()!;
		const before = await provider.stat(current.resource);
		if (baseHalfProviderStatIsSymbolicLink(before.type)) {
			continue;
		}
		if (baseHalfProviderStatIsDirectory(before.type)) {
			const directoryRealpath = await fileService.realpath(current.resource);
			if (!directoryRealpath || !extUri.isEqualOrParent(directoryRealpath, workspaceRealpath)) {
				throw new Error(`Project folder '${extUri.relativePath(workspaceFolder, current.resource) ?? '.'}' cannot be verified while node identities are being checked.`);
			}
			const directoryEntries = await provider.readdir(current.resource);
			const names = new Set<string>();
			const children: URI[] = [];
			for (const [name] of directoryEntries) {
				throwIfNodeOperationCancelled(cancellationToken);
				if (!baseHalfValidDirectoryEntryName(name) || names.has(name)) {
					throw new Error('A project folder returned an invalid or duplicate entry while node identities were being checked.');
				}
				names.add(name);
				if (name.toLowerCase() === '.bh') {
					continue;
				}
				if (++entries > limits.maxEntries) {
					throw new Error(`This project contains more than ${limits.maxEntries.toLocaleString()} entries. Reduce its size before running, importing, or changing node History.`);
				}
				if (current.depth >= limits.maxDepth) {
					throw new Error(`This project is nested more than ${limits.maxDepth} folders deep. Reduce its nesting before running, importing, or changing node History.`);
				}
				children.push(URI.joinPath(current.resource, name));
			}
			const [after, directoryRealpathAfter] = await Promise.all([
				provider.stat(current.resource),
				fileService.realpath(current.resource)
			]);
			if (!baseHalfProviderStatIsDirectory(after.type)
				|| baseHalfProviderStatIsSymbolicLink(after.type)
				|| !directoryRealpathAfter
				|| !extUri.isEqual(directoryRealpathAfter, directoryRealpath)) {
				throw new Error('A project folder changed while node identities were being checked. Try again.');
			}
			children.sort((left, right) => left.path.localeCompare(right.path));
			for (let index = children.length - 1; index >= 0; index--) {
				pending.push({ resource: children[index], depth: current.depth + 1 });
			}
			continue;
		}
		if (!baseHalfProviderStatIsFile(before.type)
			|| !current.resource.path.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)
			|| before.size > BASEHALF_NODE_DOCUMENT_MAX_BYTES) {
			continue;
		}

		const relativePath = extUri.relativePath(workspaceFolder, current.resource);
		if (!relativePath || baseHalfProjectPathProblem(relativePath)) {
			continue;
		}
		const verifiedBefore = await assertBaseHalfWorkspaceFile(fileService, workspaceFolder, current.resource, 'node identity candidate');
		const content = await fileService.readFile(current.resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		const verifiedAfter = await assertBaseHalfWorkspaceFile(fileService, workspaceFolder, current.resource, 'node identity candidate');
		if (!extUri.isEqual(verifiedAfter.workspaceRealpath, verifiedBefore.workspaceRealpath)
			|| !extUri.isEqual(verifiedAfter.resourceRealpath, verifiedBefore.resourceRealpath)) {
			throw new Error(`Node '${relativePath}' changed while its stable identity was being checked. Try again.`);
		}
		let document: IBaseHalfNodeDocument;
		try {
			document = parseBaseHalfNodeDocumentBytes(content.value.buffer);
		} catch {
			continue;
		}
		if (await baseHalfIsFrozenNodeDeclaration(fileService, workspaceFolder, relativePath, document)) {
			continue;
		}
		identities.push(Object.freeze({ resource: current.resource, relativePath, document }));
	}
	return Object.freeze(identities);
}

function baseHalfNodeIdentityScanLimits(requested?: Partial<IBaseHalfNodeIdentityScanLimits>): IBaseHalfNodeIdentityScanLimits {
	const maxEntries = requested?.maxEntries ?? BASEHALF_NODE_IDENTITY_SCAN_MAX_ENTRIES;
	const maxDepth = requested?.maxDepth ?? BASEHALF_NODE_IDENTITY_SCAN_MAX_DEPTH;
	if (!Number.isInteger(maxEntries) || maxEntries <= 0 || !Number.isInteger(maxDepth) || maxDepth <= 0) {
		throw new Error('Node identity scan limits must be positive integers.');
	}
	return Object.freeze({
		maxEntries: Math.min(maxEntries, BASEHALF_NODE_IDENTITY_SCAN_MAX_ENTRIES),
		maxDepth: Math.min(maxDepth, BASEHALF_NODE_IDENTITY_SCAN_MAX_DEPTH)
	});
}

function baseHalfProviderStatIsFile(type: FileType): boolean {
	return (type & FileType.File) !== 0;
}

function baseHalfProviderStatIsDirectory(type: FileType): boolean {
	return (type & FileType.Directory) !== 0;
}

function baseHalfProviderStatIsSymbolicLink(type: FileType): boolean {
	return (type & FileType.SymbolicLink) !== 0;
}

function baseHalfValidDirectoryEntryName(name: string): boolean {
	return name.length > 0
		&& name !== '.'
		&& name !== '..'
		&& !name.includes('/')
		&& !name.includes('\\')
		&& !name.includes('\0');
}

async function baseHalfIsFrozenNodeDeclaration(
	fileService: IFileService,
	workspaceFolder: URI,
	relativePath: string,
	document: IBaseHalfNodeDocument
): Promise<boolean> {
	const segments = relativePath.split('/');
	if (!(segments.length === 5
		&& segments[0] === OUTPUT_DIRECTORY_NAME
		&& segments[3] === INPUT_SNAPSHOT_DIRECTORY_NAME
		&& segments[4] === `node${BASEHALF_NODE_DOCUMENT_EXTENSION}`
		&& isUUID(segments[1])
		&& isUUID(segments[2])
		&& document.id === segments[1]
		&& document.recipe !== undefined
		&& document.current.source === 'empty'
		&& document.current.outputPaths.length === 0
		&& document.revisions.length === 0
		&& document.runs.length === 0)) {
		return false;
	}
	const guardResource = URI.joinPath(workspaceFolder, segments[0], segments[1], segments[2], RUN_GUARD_FILE_NAME);
	try {
		await assertBaseHalfWorkspaceFile(fileService, workspaceFolder, guardResource, 'run guard');
		const guard = await fileService.readFile(guardResource, { atomic: true, limits: { size: 256 } });
		await assertBaseHalfWorkspaceFile(fileService, workspaceFolder, guardResource, 'run guard');
		return isUUID(guard.value.toString());
	} catch {
		return false;
	}
}

function joinProjectPath(workspaceFolder: URI, relativePath: string): URI {
	return URI.joinPath(workspaceFolder, ...relativePath.split('/'));
}

function directResultNoCurrentMessage(relativePath: string): string {
	return `Direct input '${relativePath}' has no Current. Open it and import or create a result.`;
}

function directResultNoPrimaryMessage(relativePath: string): string {
	return `Direct input '${relativePath}' has no usable Current. Open it and choose a verified version in History or create a result.`;
}

function directResultNoIdentityMessage(relativePath: string): string {
	return `Current content for '${relativePath}' has no immutable version identity. Open it and choose a verified version in History.`;
}

function directResultIntegrityMessage(
	relativePath: string,
	artifactPath: string,
	integrity: Exclude<BaseHalfNodeArtifactIntegrity, 'available'>
): string {
	return integrity === 'missing'
		? `Current output for direct input '${relativePath}' is missing: '${artifactPath}'. Open the source and choose a verified version in History or create a result.`
		: `Current output for direct input '${relativePath}' changed on disk: '${artifactPath}'. Open the source and choose a verified version in History or create a result.`;
}

function assertDirectResultCurrentIdentity(
	document: IBaseHalfNodeDocument,
	relativePath: string,
	primaryArtifactId: string
): void {
	if (document.current.source === 'run' && document.current.runId) {
		const run = document.runs.find(candidate => candidate.id === document.current.runId);
		if (run?.status === 'succeeded' && run.primaryArtifactId === primaryArtifactId) {
			return;
		}
	}
	if (document.current.source === 'imported' && document.current.revisionId) {
		const revision = document.revisions.find(candidate => candidate.id === document.current.revisionId);
		if (revision?.primaryArtifactId === primaryArtifactId) {
			return;
		}
	}
	throw new Error(directResultNoIdentityMessage(relativePath));
}

function inputSnapshotName(order: number, value: string): string {
	const normalized = value.normalize('NFC').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-120) || 'input';
	return `${String(order).padStart(3, '0')}-${normalized}`;
}

function toUrlSafeChecksum(value: string): string {
	return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Text(value: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true);
}

async function sourceInputRevision(identity: string, digest: string): Promise<string> {
	return `v1;source=${await sha256Text(identity)};sha256=${digest}`;
}

async function runInputRevision(runId: string, primaryArtifactId: string, digest: string): Promise<string> {
	return `v1;run=${await sha256Text(runId)};artifact=${await sha256Text(primaryArtifactId)};sha256=${digest}`;
}

async function revisionInputRevision(revisionId: string, primaryArtifactId: string, digest: string): Promise<string> {
	return `v1;revision=${await sha256Text(revisionId)};artifact=${await sha256Text(primaryArtifactId)};sha256=${digest}`;
}

function artifactIntegrityCacheKey(resource: URI, artifact: IBaseHalfNodeRunArtifact): string {
	return `${resource.toString()}\u0000${artifact.size}\u0000${artifact.sha256}`;
}

function refreshBoundedCacheEntry<TKey, TValue>(cache: Map<TKey, TValue>, key: TKey, value: TValue, maximum: number): void {
	cache.delete(key);
	cache.set(key, value);
	while (cache.size > maximum) {
		const oldest = cache.keys().next();
		if (oldest.done) {
			break;
		}
		cache.delete(oldest.value);
	}
}

function throwIfNodeOperationCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
}

export function baseHalfSafeExecutionErrorMessage(error: unknown): string {
	const raw = (error instanceof Error ? error.message : String(error)).slice(0, MAX_EXECUTION_ERROR_INPUT_LENGTH);
	const message = raw
		.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
		.replace(/\b(?:https?|wss?|ftp):\/\/[^\s<>()\[\]{}"']+/gi, '[redacted URL]')
		.replace(/(?:\/[^\s?]*)?\?[^\s<>()\[\]{}"']+/g, '[redacted query]')
		.replace(/\b(authorization|proxy-authorization|x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|passwd)\b\s*(?::|=|\s)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{4,}/gi, '$1 [redacted]')
		.replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted token]')
		.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted key]')
		.replace(/\bAKIA[A-Z0-9]{16}\b/g, '[redacted key]')
		.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[redacted key]')
		.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, '[redacted value]')
		.replace(/\s+/g, ' ')
		.trim();
	return (message || 'The recipe did not complete.').slice(0, MAX_EXECUTION_ERROR_LENGTH);
}

function executionErrorMessage(error: unknown): string {
	return baseHalfSafeExecutionErrorMessage(error);
}

function isModifiedSince(error: unknown): boolean {
	return error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE;
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND;
}

registerSingleton(IBaseHalfNodeExecutionService, BaseHalfNodeExecutionService, InstantiationType.Delayed);
