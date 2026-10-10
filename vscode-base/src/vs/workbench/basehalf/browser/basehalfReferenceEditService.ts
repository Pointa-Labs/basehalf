/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, IReference } from '../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IBulkEditService, ResourceTextEdit } from '../../../editor/browser/services/bulkEditService.js';
import { Range } from '../../../editor/common/core/range.js';
import { ITextModel } from '../../../editor/common/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../editor/common/services/resolverService.js';
import { localize } from '../../../nls.js';
import { FileOperationError, FileOperationResult, IFileService, toFileOperationResult } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService, IPromptChoice, Severity } from '../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoGroup } from '../../../platform/undoRedo/common/undoRedo.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { SaveReason } from '../../common/editor.js';
import { AutoSaveMode, IFilesConfigurationService } from '../../services/filesConfiguration/common/filesConfigurationService.js';
import { ITextFileEditorModel, ITextFileService, TextFileEditorModelState, TextFileOperationError, TextFileOperationResult } from '../../services/textfile/common/textfiles.js';
import { IBaseHalfAdhdMirrorService } from '../common/basehalfAdhdMirror.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfUpstreamStoreCanRebuild } from '../common/basehalfCanvasUpstream.js';
import { IBaseHalfEditorFlushService } from '../common/basehalfEditorFlush.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import { baseHalfMarkdownFrontmatterLineCount } from '../common/basehalfMarkdownProjection.js';
import { baseHalfMarkdownRichDocumentKey } from '../common/basehalfMarkdownRichLiveDocument.js';
import { baseHalfCommitMirrorFile } from '../common/basehalfMirrorFileCommit.js';
import { baseHalfPreserveMirrorBytes } from '../common/basehalfMirrorRecovery.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, BaseHalfMirrorSymbolicLinkError } from '../common/basehalfMirrorTree.js';
import { baseHalfPlainFailureReason, baseHalfUserFacingErrorMessage } from '../common/basehalfPlainFailureReason.js';
import {
	addBaseHalfNodeUpstreamEntry,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BaseHalfNodeJsonValue,
	baseHalfNodeUpstreamItemValues,
	BaseHalfNodeUpstreamEditError,
	IBaseHalfNodeDocument,
	IBaseHalfNodeInputBinding,
	IBaseHalfNodeUpstreamBindingRequest,
	isBaseHalfNodeDraft,
	parseBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes,
	removeBaseHalfNodeUpstreamEntry,
	replaceBaseHalfNodeUpstreamEntry,
	serializeBaseHalfNodeDocument,
	setBaseHalfNodeUpstream
} from '../common/basehalfNodeDocument.js';
import {
	BASEHALF_REFERENCE_FLUSH_TIMEOUT_MS,
	BASEHALF_REFERENCE_INDEX_WAIT_MS,
	BASEHALF_REFERENCES_FIRST_FRONTMATTER_NOTICE_STORAGE_KEY,
	BaseHalfReferenceEditFailure,
	BaseHalfReferenceEditOperation,
	BaseHalfReferenceEditRefusal,
	BaseHalfReferenceRefusalReason,
	BaseHalfReferenceStoreOutcome,
	BaseHalfReferenceUndoElement,
	baseHalfUpstreamSnapshotsEqual,
	IBaseHalfReferenceBlockingStore,
	IBaseHalfReferenceEditOptions,
	IBaseHalfReferenceEditResult,
	IBaseHalfReferenceEditService,
	IBaseHalfReferenceStoreEdit,
	IBaseHalfReferenceStoreResult,
	IBaseHalfReferenceUndoElementOptions,
	IBaseHalfUpstreamEntryReplacement,
	IBaseHalfUpstreamStoreSnapshot
} from '../common/basehalfReferenceEdit.js';
import {
	BASEHALF_UPSTREAM_MAX_NODE_ENTRIES,
	baseHalfNormalizeUpstreamEntry,
	baseHalfUpstreamEntryProblem,
	baseHalfUpstreamIdentity,
	IBaseHalfUpstreamIdentity,
	IBaseHalfUpstreamItemValue
} from '../common/basehalfReferenceEntries.js';
import { IBaseHalfReferenceIndexService } from '../common/basehalfReferenceIndex.js';
import {
	BaseHalfUpstreamListOperation,
	BaseHalfUpstreamPlanRefusal,
	BaseHalfUpstreamStoreKind,
	BaseHalfUpstreamTextPlan,
	baseHalfReadableSidecarUpstreamEntries,
	baseHalfUpstreamSidecarResource,
	baseHalfUpstreamStoreKind,
	IBaseHalfUpstreamStoreRead,
	isBaseHalfUpstreamReservedOutput,
	planBaseHalfMarkdownUpstreamEdit,
	planBaseHalfSidecarUpstreamEdit,
	readBaseHalfMarkdownUpstream,
	readBaseHalfSidecarUpstream
} from '../common/basehalfReferenceStore.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease, IBaseHalfWorkspaceResourceMutationStamp } from '../common/basehalfWorkspaceMutation.js';
import { BaseHalfNodeRunLeaseStore } from './basehalfNodeRunLease.js';

const SIDECAR_MAX_BYTES = 64 * 1024;
const RUN_LEASE_STALE_AFTER_MS = 30_000;
const NODE_WRITE_TEMP_POSTFIX = '.basehalf-node-upstream-tmp';
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** Operations the service performs internally besides the public ones. */
type InternalOperation =
	| BaseHalfReferenceEditOperation
	/** Move into File: remove the misplaced `upstream.yaml` when it still has
	 * the bytes `expected`, the bytes the appended entries were read from. */
	/** `preserve`: the file holds content the move leaves behind, so its bytes
	 * are kept as a recovery copy before it is removed. */
	| { readonly kind: 'deleteSidecar'; readonly expected: VSBuffer; readonly preserve?: boolean };

interface IInternalEdit {
	readonly node: IBaseHalfWorkspaceResource;
	readonly operation: InternalOperation;
}

interface IStoreTarget {
	readonly edit: IInternalEdit;
	readonly node: IBaseHalfWorkspaceResource;
	readonly exists: boolean;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	readonly storeResource: URI;
	readonly identity: IBaseHalfUpstreamIdentity;
}

type TransitionState = 'from' | 'to' | 'other';

/** The workspace mutation lease of every folder an operation writes, by folder URI string. */
type FolderLeases = ReadonlyMap<string, IBaseHalfWorkspaceMutationLease>;

interface IPreparedStore extends IStoreTarget {
	readonly expected: IBaseHalfUpstreamStoreSnapshot;
	next: IBaseHalfUpstreamStoreSnapshot;
	readonly transition?: TransitionState;
	changed: boolean;
	createdFrontmatter: boolean;
	outcome: BaseHalfReferenceStoreOutcome;
	error?: string;
	/** Markdown */
	model?: ITextFileEditorModel & { readonly textEditorModel: ITextModel };
	reference?: IReference<IResolvedTextEditorModel>;
	listOperation?: BaseHalfUpstreamListOperation | readonly BaseHalfUpstreamListOperation[];
	plannedText?: string;
	versionId?: number;
	dirtyBeforeEdit?: boolean;
	/** Node documents and sidecars */
	expectedBytes?: VSBuffer | null;
	nextBytes?: VSBuffer | 'delete';
	savedText?: string;
}

/** A preflight refusal of one store. */
class StoreRefusal extends Error {
	constructor(readonly reason: BaseHalfReferenceRefusalReason, message: string) {
		super(message);
	}
}

/**
 * Performs every reference operation (D37). Markdown stores are edited
 * through the document's text model with a minimal edit (own undo stack, no
 * canvas undo source) and saved; `.bhnode` documents through the node
 * document writer; sidecars with an expected-bytes compare and swap. Every
 * write runs under the workspace mutation lease of its folder. It never
 * changes the store of an upstream-only node (reserved outputs, sealed or
 * imported Result artifacts) and never writes a Markdown or `.bhnode` store
 * through a symbolic link.
 */
export class BaseHalfReferenceEditService extends Disposable implements IBaseHalfReferenceEditService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidCreateFrontmatter = this._register(new Emitter<IBaseHalfWorkspaceResource>());
	readonly onDidCreateFrontmatter = this._onDidCreateFrontmatter.event;

	private readonly runLeases: BaseHalfNodeRunLeaseStore;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBulkEditService private readonly bulkEditService: IBulkEditService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IBaseHalfAdhdMirrorService private readonly adhdMirrorService: IBaseHalfAdhdMirrorService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.runLeases = new BaseHalfNodeRunLeaseStore(this.fileService, RUN_LEASE_STALE_AFTER_MS);
	}

	//#region Public API

	add(node: IBaseHalfWorkspaceResource, entry: string, options: IBaseHalfReferenceEditOptions, binding?: IBaseHalfNodeUpstreamBindingRequest): Promise<IBaseHalfReferenceEditResult> {
		return this.apply([{ node, operation: { kind: 'add', entry, ...(binding ? { binding } : {}) } }], options);
	}

	remove(node: IBaseHalfWorkspaceResource, entry: string, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult> {
		return this.apply([{ node, operation: { kind: 'remove', entry } }], options);
	}

	replace(node: IBaseHalfWorkspaceResource, from: string, to: string, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult> {
		return this.apply([{ node, operation: { kind: 'replace', from, to } }], options);
	}

	move(entry: string, from: IBaseHalfWorkspaceResource, to: IBaseHalfWorkspaceResource, options: IBaseHalfReferenceEditOptions, binding?: IBaseHalfNodeUpstreamBindingRequest): Promise<IBaseHalfReferenceEditResult> {
		return this.apply([
			{ node: to, operation: { kind: 'add', entry, ...(binding ? { binding } : {}) } },
			{ node: from, operation: { kind: 'remove', entry } }
		], options);
	}

	apply(edits: readonly IBaseHalfReferenceStoreEdit[], options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult> {
		return this.run(edits, options);
	}

	async check(edits: readonly IBaseHalfReferenceStoreEdit[]): Promise<readonly IBaseHalfReferenceBlockingStore[]> {
		const targets = await Promise.all(edits.map(edit => this.describe(edit)));
		const blocking: IBaseHalfReferenceBlockingStore[] = [];
		for (const target of targets) {
			const stamp = this.workspaceMutationCoordinator.captureResource(target.node.workspaceFolder, target.node.relativePath);
			if (!this.workspaceMutationCoordinator.isResourceStampCurrent(target.node.workspaceFolder, stamp)) {
				blocking.push({ node: target.node, storeResource: target.storeResource, reason: 'beingMoved', message: this.message('beingMoved', target.node.resource) });
				continue;
			}
			if (target.storeKind === 'markdown' && this.referenceIndexService.getState(target.node.workspaceFolder) === 'building') {
				blocking.push({ node: target.node, storeResource: target.storeResource, reason: 'indexLoading', message: this.message('indexLoading', target.node.resource) });
				continue;
			}
			try {
				const prepared = await this.prepare(target, 'check');
				prepared.reference?.dispose();
			} catch (error) {
				blocking.push(error instanceof StoreRefusal
					? { node: target.node, storeResource: target.storeResource, reason: error.reason, message: error.message }
					: { node: target.node, storeResource: target.storeResource, reason: 'error', message: baseHalfUserFacingErrorMessage(error) });
			}
		}
		return blocking;
	}

	async moveIntoFile(node: IBaseHalfWorkspaceResource, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult> {
		const identity = this.identity(node.workspaceFolder);
		const sidecar = baseHalfUpstreamSidecarResource(node.workspaceFolder, node.relativePath);
		const bytes = await this.readOptional(sidecar, SIDECAR_MAX_BYTES, node.workspaceFolder);
		if (bytes === null) {
			return { stores: [], changed: false };
		}
		const text = utf8Decoder.decode(bytes.buffer);
		const readOptions = { nodePath: node.relativePath, identity };
		const read = readBaseHalfSidecarUpstream(text, readOptions);
		// Every entry BaseHalf can read moves, a repeated one once. Anything
		// else in the file (an invalid entry, or content that could not be read)
		// has nowhere to go, so the file is kept as a recovery copy before it is
		// removed.
		const entries = read.readable
			? read.items.flatMap(item => item.path === undefined ? [] : [item.path])
			: baseHalfReadableSidecarUpstreamEntries(text, readOptions);
		const leavesContent = !read.readable || read.items.some(item => item.path === undefined && item.problem !== 'duplicate');
		// The entries and the removal come from this one read: the removal is
		// refused if the file no longer has these bytes.
		const result = await this.run([
			{ node, operation: { kind: 'append', entries } },
			{ node, operation: { kind: 'deleteSidecar', expected: bytes, ...(leavesContent ? { preserve: true } : {}) } }
		], options);
		if (leavesContent) {
			this.notificationService.info(localize('basehalf.references.moveIntoFilePartial', "BaseHalf moved the upstream entries it could read into {0}. The rest could not be used and was removed.", basename(node.resource)));
		}
		return result;
	}

	rebuild(node: IBaseHalfWorkspaceResource, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult> {
		return this.run([{ node, operation: { kind: 'rebuild' } }], options);
	}

	async readSnapshot(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamStoreSnapshot | undefined> {
		const identity = this.identity(node.workspaceFolder);
		const stat = await this.statOptional(node.resource);
		const storeKind = baseHalfUpstreamStoreKind(node.relativePath, stat?.isDirectory ?? false);
		if (storeKind === 'markdown') {
			const model = this.textFileService.files.get(node.resource);
			const text = model?.isResolved() ? model.textEditorModel.getValue() : await this.readText(node.resource, undefined, node.workspaceFolder);
			return text === undefined ? undefined : readSnapshot(readBaseHalfMarkdownUpstream(text, { nodePath: node.relativePath, identity }));
		}
		if (storeKind === 'node') {
			const bytes = await this.readOptional(node.resource, BASEHALF_NODE_DOCUMENT_MAX_BYTES, undefined);
			if (bytes === null) {
				return undefined;
			}
			try {
				return nodeSnapshot(parseBaseHalfNodeDocumentBytes(bytes.buffer));
			} catch {
				return undefined;
			}
		}
		const sidecar = baseHalfUpstreamSidecarResource(node.workspaceFolder, node.relativePath);
		const text = await this.readText(sidecar, SIDECAR_MAX_BYTES, node.workspaceFolder);
		return readSnapshot(readBaseHalfSidecarUpstream(text, { nodePath: node.relativePath, identity }));
	}

	pushUndoElement(result: IBaseHalfReferenceEditResult, options: Omit<IBaseHalfReferenceUndoElementOptions, 'stores'>): IWorkspaceUndoRedoElement | undefined {
		const stores = result.stores
			.filter(store => store.outcome === 'changed')
			.map(store => ({ node: store.node, storeKind: store.storeKind, expected: store.expected, next: store.next }));
		if (stores.length === 0) {
			return undefined;
		}
		// Canvas geometry steps also join the undo stacks of the cards they
		// move, and canvas redo takes the oldest redo step of the canvas source
		// in any stack. A node document or sidecar store is written without a
		// text edit, so nothing else clears the redo history of its node: join
		// that node's stack too, so an older undone step of the card is dropped
		// there instead of being redone ahead of this one. A Markdown document
		// never joins, even for its misplaced sidecar: its own undo stack owns
		// its text edits.
		const resources = new Map<string, URI>();
		const nodeResources = stores
			.filter(store => store.storeKind !== 'markdown' && baseHalfUpstreamStoreKind(store.node.relativePath, false) !== 'markdown')
			.map(store => store.node.resource);
		for (const resource of [...options.resources, ...nodeResources]) {
			resources.set(this.uriIdentityService.extUri.getComparisonKey(resource), resource);
		}
		const element = new BaseHalfReferenceUndoElement({ ...options, resources: [...resources.values()], stores }, this, this.undoRedoService, this.notificationService);
		this.undoRedoService.pushElement(element, UndoRedoGroup.None, options.source);
		return element;
	}

	//#endregion

	//#region Orchestration

	private async run(edits: readonly IInternalEdit[], options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult> {
		if (edits.length === 0) {
			return { stores: [], changed: false };
		}
		const targets = await Promise.all(edits.map(edit => this.describe(edit)));
		const seen = new Set<string>();
		for (const target of targets) {
			const key = this.uriIdentityService.extUri.getComparisonKey(target.storeResource);
			if (seen.has(key)) {
				throw new Error(`One reference operation can change ${target.storeResource.toString()} only once.`);
			}
			seen.add(key);
		}
		await this.waitForIndex(targets, options);

		// Step 1: capture a resource stamp for every store and run the rest under
		// the workspace mutation lease of every folder involved.
		const folders = new Map<string, { readonly folder: URI; readonly stamps: IBaseHalfWorkspaceResourceMutationStamp[] }>();
		const stale: IBaseHalfReferenceBlockingStore[] = [];
		for (const target of targets) {
			const key = target.node.workspaceFolder.toString();
			let entry = folders.get(key);
			if (!entry) {
				entry = { folder: target.node.workspaceFolder, stamps: [] };
				folders.set(key, entry);
			}
			const stamp = this.workspaceMutationCoordinator.captureResource(target.node.workspaceFolder, target.node.relativePath);
			entry.stamps.push(stamp);
			if (!this.workspaceMutationCoordinator.isResourceStampCurrent(target.node.workspaceFolder, stamp)) {
				stale.push({ node: target.node, storeResource: target.storeResource, reason: 'beingMoved', message: this.message('beingMoved', target.node.resource) });
			}
		}
		if (stale.length > 0) {
			throw this.refusal(stale);
		}
		// The folder structure the caller planned against must not have changed
		// before the lease is reserved: `runResourceMutation` reserves its place
		// in the folder's queue synchronously, so a structural change reserved
		// later is ordered after this write.
		const assertPlannedStructure = (folder: URI) => {
			const key = folder.toString();
			if ((options.plannedStructure ?? []).some(planned => planned.workspaceFolder.toString() === key && !this.workspaceMutationCoordinator.isStampCurrent(planned.workspaceFolder, planned.stamp))) {
				throw new BaseHalfReferenceEditRefusal('beingMoved', this.message('beingMoved', folder), []);
			}
		};
		const ordered = [...folders.values()].sort((left, right) => left.folder.toString().localeCompare(right.folder.toString()));
		const leases = new Map<string, IBaseHalfWorkspaceMutationLease>();
		const runLocked = async (index: number): Promise<IBaseHalfReferenceEditResult> => {
			if (index === ordered.length) {
				return this.runLocked(targets, options, leases);
			}
			try {
				assertPlannedStructure(ordered[index].folder);
				return await this.workspaceMutationCoordinator.runResourceMutation(ordered[index].folder, ordered[index].stamps, lease => {
					leases.set(ordered[index].folder.toString(), lease);
					return runLocked(index + 1);
				});
			} catch (error) {
				if (error instanceof BaseHalfReferenceEditRefusal || error instanceof BaseHalfReferenceEditFailure) {
					throw error;
				}
				if (error instanceof Error && /resource identity changed/.test(error.message)) {
					const target = targets[0];
					throw this.refusal([{ node: target.node, storeResource: target.storeResource, reason: 'beingMoved', message: this.message('beingMoved', target.node.resource) }]);
				}
				throw error;
			}
		};
		return runLocked(0);
	}

	private async describe(edit: IInternalEdit): Promise<IStoreTarget> {
		const node = edit.node;
		const operation = edit.operation;
		const stat = await this.statOptional(node.resource);
		// Undo and redo transition exactly the store the operation changed, which
		// for Move into File includes the node's misplaced sidecar.
		const storeKind: BaseHalfUpstreamStoreKind = operation.kind === 'deleteSidecar'
			? 'sidecar'
			: operation.kind === 'transition' && operation.store !== undefined
				? operation.store
				: baseHalfUpstreamStoreKind(node.relativePath, stat?.isDirectory ?? false);
		const storeResource = storeKind === 'sidecar' ? baseHalfUpstreamSidecarResource(node.workspaceFolder, node.relativePath) : node.resource;
		return { edit, node, exists: !!stat, storeKind, storeResource, identity: this.identity(node.workspaceFolder) };
	}

	/**
	 * A change to a Markdown store waits up to 10 s, because the
	 * sealed-artifact check (which refuses every change to a sealed or
	 * imported Result artifact) needs the index.
	 */
	private async waitForIndex(targets: readonly IStoreTarget[], options: IBaseHalfReferenceEditOptions): Promise<void> {
		for (const target of targets) {
			if (target.storeKind !== 'markdown') {
				continue;
			}
			const state = await this.referenceIndexService.whenReady(target.node.workspaceFolder, options.indexWaitMs ?? BASEHALF_REFERENCE_INDEX_WAIT_MS);
			if (state === 'building') {
				throw this.refusal([{ node: target.node, storeResource: target.storeResource, reason: 'indexLoading', message: this.message('indexLoading', target.node.resource) }]);
			}
		}
	}

	private async runLocked(targets: readonly IStoreTarget[], options: IBaseHalfReferenceEditOptions, leases: FolderLeases): Promise<IBaseHalfReferenceEditResult> {
		const prepared: IPreparedStore[] = [];
		const blocking: IBaseHalfReferenceBlockingStore[] = [];
		try {
			for (const target of targets) {
				try {
					prepared.push(await this.prepare(target));
				} catch (error) {
					if (!(error instanceof StoreRefusal)) {
						throw error;
					}
					blocking.push({ node: target.node, storeResource: target.storeResource, reason: error.reason, message: error.message });
				}
			}
			const transitions = prepared.filter(store => store.transition !== undefined);
			if (blocking.length === 0 && transitions.length > 0) {
				if (transitions.every(store => store.transition === 'to')) {
					for (const store of transitions) {
						store.changed = false;
					}
				} else if (!transitions.every(store => store.transition === 'from')) {
					const changed = transitions.find(store => store.transition === 'other') ?? transitions.find(store => store.transition === 'to')!;
					blocking.push({ node: changed.node, storeResource: changed.storeResource, reason: 'changedSinceEdit', message: this.message('changedSinceEdit', changed.storeResource) });
				}
			}
			if (blocking.length > 0) {
				throw this.refusal(blocking);
			}
			return await this.write(prepared, options, leases);
		} finally {
			for (const store of prepared) {
				store.reference?.dispose();
			}
		}
	}

	//#endregion

	//#region Preflight

	/**
	 * Resolves and validates one store. In `check` mode nothing is flushed and
	 * no text model is created: a loaded model's state is checked, otherwise
	 * the saved text is planned.
	 */
	private async prepare(target: IStoreTarget, mode: 'write' | 'check' = 'write'): Promise<IPreparedStore> {
		const operation = target.edit.operation;
		for (const entry of entriesToWrite(operation)) {
			if (baseHalfUpstreamEntryProblem(entry, target.node.relativePath, target.identity)) {
				throw new StoreRefusal('invalidEntry', localize('basehalf.references.invalidEntry', "'{0}' can't be listed as upstream of {1}.", entry, target.node.relativePath));
			}
		}
		if (addsEntries(operation) && !target.exists) {
			throw new StoreRefusal('missingNode', this.message('missingNode', target.node.resource));
		}
		// Upstream-only nodes (the reserved outputs tree, sealed or imported
		// Result artifacts): BaseHalf never changes their store, removals
		// included, so a sealed artifact keeps the bytes its `.bhnode` pins.
		// Undo and redo are refused only when they would change the store.
		const upstreamOnly = operation.kind !== 'deleteSidecar'
			&& (isBaseHalfUpstreamReservedOutput(target.node.relativePath) || !!this.referenceIndexService.getUpstreamOnlyReason(target.node));
		if (upstreamOnly && operation.kind !== 'transition') {
			throw this.upstreamOnlyRefusal(target);
		}
		if (operation.kind === 'nodeDocument' && target.storeKind !== 'node') {
			throw new StoreRefusal('notWritable', this.message('notWritable', target.node.resource));
		}
		if (target.storeKind !== 'sidecar') {
			await this.assertNotSymbolicLink(target);
		}
		if (mode === 'write' && operation.kind === 'replaceEntries' && operation.onlyDangling) {
			// Under the lease: an old path that names a node again keeps its entries.
			await this.assertReplacedPathsDangling(target, operation.replacements);
		}
		let prepared: IPreparedStore;
		switch (target.storeKind) {
			case 'markdown':
				prepared = mode === 'check' ? await this.checkMarkdown(target) : await this.prepareMarkdown(target);
				break;
			case 'node':
				prepared = await this.prepareNode(target);
				break;
			case 'sidecar':
				prepared = await this.prepareSidecar(target);
				break;
		}
		if (upstreamOnly && prepared.changed) {
			prepared.reference?.dispose();
			throw this.upstreamOnlyRefusal(target);
		}
		return prepared;
	}

	private async assertReplacedPathsDangling(target: IStoreTarget, replacements: readonly IBaseHalfUpstreamEntryReplacement[]): Promise<void> {
		for (const replacement of replacements) {
			// A spelling-only replacement's old path names the renamed node itself.
			if (target.identity.key(replacement.from) === target.identity.key(replacement.to)) {
				continue;
			}
			const resource = URI.joinPath(target.node.workspaceFolder, ...replacement.from.split('/'));
			if (await this.fileService.exists(resource).catch(() => false)) {
				throw new StoreRefusal('entryResolves', this.message('entryResolves', target.node.resource));
			}
		}
	}

	private upstreamOnlyRefusal(target: IStoreTarget): StoreRefusal {
		return new StoreRefusal('upstreamOnly', addsEntries(target.edit.operation)
			? this.message('upstreamOnly', target.node.resource)
			: localize('basehalf.references.upstreamOnlyUnchanged', "{0} is a result or output file. BaseHalf doesn't change its upstream list.", this.label(target.node.resource)));
	}

	/**
	 * A Markdown or `.bhnode` store is never written through a symbolic link:
	 * no path component from the workspace folder down to the store may be a
	 * link, and the store's real path must stay inside the workspace folder.
	 */
	private async assertNotSymbolicLink(target: IStoreTarget): Promise<void> {
		if (!target.exists) {
			return;
		}
		const folder = target.node.workspaceFolder;
		let current = folder;
		for (const segment of target.node.relativePath.split('/')) {
			current = URI.joinPath(current, segment);
			let isSymbolicLink: boolean;
			try {
				isSymbolicLink = !!(await this.fileService.stat(current)).isSymbolicLink;
			} catch {
				// A missing component is a missing node; the store handles it.
				return;
			}
			if (isSymbolicLink) {
				throw new StoreRefusal('symbolicLink', this.message('symbolicLink', target.storeResource));
			}
		}
		const [folderRealpath, storeRealpath] = await Promise.all([
			this.fileService.realpath(folder).catch(() => undefined),
			this.fileService.realpath(target.storeResource).catch(() => undefined)
		]);
		if (folderRealpath && storeRealpath && !this.uriIdentityService.extUri.isEqualOrParent(storeRealpath, folderRealpath)) {
			throw new StoreRefusal('symbolicLink', this.message('symbolicLink', target.storeResource));
		}
	}

	/** The `check` mode of a Markdown store: model state and plan, with no flush and no new model. */
	private async checkMarkdown(target: IStoreTarget): Promise<IPreparedStore> {
		const resource = target.storeResource;
		if (!target.exists) {
			return missingStore(target);
		}
		const model = this.textFileService.files.get(resource);
		let text: string | undefined;
		let eol = '\n';
		if (model?.isResolved()) {
			this.assertModelWritable(model, resource);
			if (model.isDirty() && this.filesConfigurationService.getAutoSaveMode(resource).mode === AutoSaveMode.OFF) {
				throw new StoreRefusal('unsaved', this.message('unsaved', resource));
			}
			text = model.textEditorModel.getValue();
			eol = model.textEditorModel.getEOL();
		} else {
			let stat;
			try {
				stat = await this.fileService.stat(resource);
			} catch {
				return missingStore(target);
			}
			if (stat.readonly || stat.locked) {
				throw new StoreRefusal('readonly', this.message('readonly', resource));
			}
			text = await this.readText(resource, undefined, target.node.workspaceFolder);
			if (text === undefined) {
				return missingStore(target);
			}
			eol = /\r\n/.test(text) ? '\r\n' : '\n';
		}
		return this.planMarkdownText(unchangedStore(target), text, eol);
	}

	private async prepareMarkdown(target: IStoreTarget): Promise<IPreparedStore> {
		const resource = target.storeResource;
		if (!target.exists) {
			return missingStore(target);
		}
		// Step 2: resolve the text file model and refuse unsafe states.
		let reference: IReference<IResolvedTextEditorModel>;
		try {
			reference = await this.textModelService.createModelReference(resource);
		} catch (error) {
			if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
				throw new StoreRefusal('binary', this.message('binary', resource));
			}
			if (isFileNotFound(error)) {
				return missingStore(target);
			}
			throw new StoreRefusal('error', this.message('error', resource));
		}
		const prepared: IPreparedStore = { ...unchangedStore(target), reference };
		try {
			const model = this.textFileService.files.get(resource);
			if (!model?.isResolved()) {
				throw new StoreRefusal('error', this.message('error', resource));
			}
			this.assertModelWritable(model, resource);
			// Step 4 (checked first so a flusher never saves text the user chose
			// not to save): unsaved changes with auto-save off.
			if (model.isDirty() && this.filesConfigurationService.getAutoSaveMode(resource).mode === AutoSaveMode.OFF) {
				throw new StoreRefusal('unsaved', this.message('unsaved', resource));
			}
			// Step 3: flush every open projection.
			if (!await this.flush(target.node)) {
				throw new StoreRefusal('flushFailed', this.message('flushFailed', resource));
			}
			this.assertModelWritable(model, resource);
			prepared.model = model;
			return this.planMarkdown(prepared);
		} catch (error) {
			reference.dispose();
			throw error;
		}
	}

	private assertModelWritable(model: ITextFileEditorModel, resource: URI): void {
		if (model.isReadonly()) {
			throw new StoreRefusal('readonly', this.message('readonly', resource));
		}
		if (model.hasState(TextFileEditorModelState.ORPHAN)) {
			throw new StoreRefusal('orphaned', this.message('orphaned', resource));
		}
		if (model.hasState(TextFileEditorModelState.CONFLICT)) {
			throw new StoreRefusal('conflict', this.message('conflict', resource));
		}
		if (model.hasState(TextFileEditorModelState.ERROR)) {
			throw new StoreRefusal('error', this.message('error', resource));
		}
	}

	/** Step 5: plan the minimal edit from the model's current text. */
	private planMarkdown(store: IPreparedStore): IPreparedStore {
		const model = store.model!;
		return {
			...this.planMarkdownText(store, model.textEditorModel.getValue(), model.textEditorModel.getEOL()),
			versionId: model.textEditorModel.getVersionId(),
			dirtyBeforeEdit: model.isDirty()
		};
	}

	private planMarkdownText(store: IPreparedStore, text: string, defaultEol: string): IPreparedStore {
		const options = { nodePath: store.node.relativePath, identity: store.identity, defaultEol };
		const read = readBaseHalfMarkdownUpstream(text, options);
		const expected = readSnapshot(read);
		const listOperations = this.listOperations(store);
		let transition: TransitionState | undefined;
		if (store.edit.operation.kind === 'transition') {
			transition = read.readable ? transitionState(expected, store.edit.operation) : 'other';
			if (transition !== 'from') {
				return { ...store, expected, next: expected, transition };
			}
		}
		const plan = chainPlans(text, listOperations, (current, operation) => planBaseHalfMarkdownUpstreamEdit(current ?? '', operation, options));
		if (plan.kind === 'refused') {
			throw this.planRefusal(plan.reason, store.storeResource, 'markdown');
		}
		const planned = plan.kind === 'edit' ? plan.text : text;
		return {
			...store,
			expected,
			next: plan.kind === 'edit' ? readSnapshot(readBaseHalfMarkdownUpstream(planned, options)) : expected,
			...(transition ? { transition } : {}),
			changed: plan.kind === 'edit',
			createdFrontmatter: plan.kind === 'edit' && plan.createdFrontmatter,
			listOperation: listOperations,
			plannedText: planned
		};
	}

	private listOperations(store: IStoreTarget): BaseHalfUpstreamListOperation[] {
		const operation = store.edit.operation;
		switch (operation.kind) {
			case 'add':
				return [{ kind: 'add', entry: baseHalfNormalizeUpstreamEntry(operation.entry) }];
			case 'remove':
				return [{ kind: 'remove', entry: operation.entry }];
			case 'replace':
				return [{ kind: 'replace', from: operation.from, to: baseHalfNormalizeUpstreamEntry(operation.to) }];
			case 'replaceEntries':
				return operation.replacements.map(replacement => ({ kind: 'replace', from: replacement.from, to: baseHalfNormalizeUpstreamEntry(replacement.to) }));
			case 'removeAt':
				return [{ kind: 'removeAt', index: operation.index, expected: operation.expected }];
			case 'replaceAt':
				return [{ kind: 'replaceAt', index: operation.index, expected: operation.expected, to: baseHalfNormalizeUpstreamEntry(operation.to) }];
			case 'transition':
				return [{ kind: 'set', items: operation.to.items }];
			case 'append':
				return operation.entries.map(entry => ({ kind: 'add', entry: baseHalfNormalizeUpstreamEntry(entry) }));
			case 'rebuild':
				return [{ kind: 'rebuild' }];
			case 'nodeDocument':
			case 'deleteSidecar':
				return [];
		}
	}

	private async prepareNode(target: IStoreTarget): Promise<IPreparedStore> {
		const resource = target.storeResource;
		const bytes = target.exists ? await this.readOptional(resource, BASEHALF_NODE_DOCUMENT_MAX_BYTES, undefined) : null;
		if (bytes === null) {
			return missingStore(target);
		}
		let document: IBaseHalfNodeDocument;
		try {
			document = parseBaseHalfNodeDocumentBytes(bytes.buffer);
		} catch (error) {
			this.logService.warn(`[BaseHalf] ${target.node.relativePath} can't be read`, error);
			throw new StoreRefusal('unreadable', localize('basehalf.references.nodeUnreadable', "{0} can't be read.", basename(resource)));
		}
		// Every write is refused while a run lease is active.
		const lease = await this.runLeases.inspect(target.node.workspaceFolder, document.id).catch(() => undefined);
		if (lease && lease.state !== 'released' && !this.runLeases.isStale(lease)) {
			throw new StoreRefusal('running', this.message('running', resource));
		}
		const operation = target.edit.operation;
		if (operation.kind === 'rebuild') {
			// A node document is one JSON value BaseHalf writes whole: there is
			// no list inside it to write again.
			throw new StoreRefusal('notWritable', localize('basehalf.references.rebuildUnavailable', "The upstream list of {0} can't be rebuilt.", basename(resource)));
		}
		// A Composer or node-surface save, and its undo, compare and restore the
		// whole document, not only the list and bindings.
		const withDocument = operation.kind === 'nodeDocument'
			|| (operation.kind === 'transition' && (operation.from.document !== undefined || operation.to.document !== undefined));
		const expected = nodeSnapshot(document, withDocument);
		let transition: TransitionState | undefined;
		if (operation.kind === 'transition') {
			transition = transitionState(expected, operation);
			if (transition !== 'from') {
				return { ...unchangedStore(target), expected, next: expected, transition, expectedBytes: bytes };
			}
		}
		if (operation.kind === 'nodeDocument' && !bytes.equals(operation.expected)) {
			throw new StoreRefusal('changedSinceEdit', this.message('changedSinceEdit', resource));
		}
		let next: IBaseHalfNodeDocument;
		try {
			next = this.nextNodeDocument(document, operation, target.identity);
		} catch (error) {
			if (error instanceof BaseHalfNodeUpstreamEditError) {
				const reason: BaseHalfReferenceRefusalReason = error.refusal === 'limit' ? 'limit'
					: error.refusal === 'boundOutsideDraft' ? 'boundOutsideDraft'
						: error.refusal === 'recipeFrozen' ? 'recipeFrozen'
							: error.refusal === 'entryMissing' ? 'entryMissing'
								: 'binding';
				throw new StoreRefusal(reason, reason === 'binding' ? error.message : this.message(reason, resource));
			}
			this.logService.warn(`[BaseHalf] the upstream change to ${target.node.relativePath} was not planned`, error);
			throw new StoreRefusal('notWritable', localize('basehalf.references.nodeNotWritable', "This change can't be saved to {0}.", basename(resource)));
		}
		const nextBytes = next === document ? undefined : VSBuffer.fromString(serializeBaseHalfNodeDocument(next));
		const changed = nextBytes !== undefined && !nextBytes.equals(bytes);
		return {
			...unchangedStore(target),
			expected,
			next: changed ? nodeSnapshot(next, withDocument) : expected,
			...(transition ? { transition } : {}),
			changed,
			expectedBytes: bytes,
			...(changed ? { nextBytes } : {})
		};
	}

	private nextNodeDocument(document: IBaseHalfNodeDocument, operation: InternalOperation, identity: IBaseHalfUpstreamIdentity): IBaseHalfNodeDocument {
		switch (operation.kind) {
			case 'add':
				return addBaseHalfNodeUpstreamEntry(document, operation.entry, operation.binding, identity);
			case 'remove':
				return removeBaseHalfNodeUpstreamEntry(document, operation.entry, identity);
			case 'replace':
				return replaceBaseHalfNodeUpstreamEntry(document, operation.from, operation.to, identity);
			case 'replaceEntries': {
				// Each replacement also rewrites a Draft binding that names it.
				let next = document;
				for (const replacement of operation.replacements) {
					next = replaceBaseHalfNodeUpstreamEntry(next, replacement.from, replacement.to, identity);
				}
				return next;
			}
			case 'append': {
				let next = document;
				for (const entry of operation.entries) {
					next = addBaseHalfNodeUpstreamEntry(next, entry, undefined, identity);
				}
				return next;
			}
			case 'removeAt':
			case 'replaceAt': {
				const item = document.upstream[operation.index];
				const text = baseHalfNodeUpstreamItemValues(document.upstream)[operation.index]?.text;
				if (item === undefined || text !== operation.expected) {
					throw new BaseHalfNodeUpstreamEditError('entryMissing', `'${operation.expected}' is no longer listed as upstream.`);
				}
				if (typeof item === 'string') {
					const key = identity.key(baseHalfNormalizeUpstreamEntry(item));
					const first = document.upstream.findIndex(candidate => typeof candidate === 'string' && identity.key(baseHalfNormalizeUpstreamEntry(candidate)) === key);
					if (first === operation.index) {
						// The first occurrence owns the binding: the named helpers keep bindings consistent.
						return operation.kind === 'removeAt'
							? removeFirstOccurrence(document, operation.index, identity)
							: replaceBaseHalfNodeUpstreamEntry(document, item, operation.to, identity);
					}
				}
				const upstream: BaseHalfNodeJsonValue[] = [...document.upstream];
				if (operation.kind === 'removeAt') {
					upstream.splice(operation.index, 1);
				} else {
					const toKey = identity.key(baseHalfNormalizeUpstreamEntry(operation.to));
					const listed = document.upstream.some((candidate, index) => index !== operation.index && typeof candidate === 'string' && identity.key(baseHalfNormalizeUpstreamEntry(candidate)) === toKey);
					if (listed) {
						upstream.splice(operation.index, 1);
					} else {
						upstream[operation.index] = baseHalfNormalizeUpstreamEntry(operation.to);
					}
				}
				return setBaseHalfNodeUpstream(document, upstream);
			}
			case 'transition':
				if (operation.to.document !== undefined) {
					return parseBaseHalfNodeDocument(operation.to.document);
				}
				return setBaseHalfNodeUpstream(document, operation.to.items.map(itemToJson), operation.to.bindings ?? document.recipe?.inputBindings ?? []);
			case 'nodeDocument':
				return nextNodeDocumentSave(document, operation.next, identity);
			case 'deleteSidecar':
			case 'rebuild':
				return document;
		}
	}

	private async prepareSidecar(target: IStoreTarget): Promise<IPreparedStore> {
		const resource = target.storeResource;
		let bytes: VSBuffer | null;
		try {
			bytes = await this.readOptional(resource, SIDECAR_MAX_BYTES, target.node.workspaceFolder);
		} catch (error) {
			if (error instanceof BaseHalfMirrorSymbolicLinkError) {
				this.logService.warn(`[BaseHalf] the upstream list of ${target.node.relativePath} is behind a symbolic link`, error);
				throw new StoreRefusal('symbolicLink', localize('basehalf.references.sidecarSymbolicLink', "BaseHalf keeps the upstream list of {0} behind a symbolic link. BaseHalf doesn't change files through links.", this.label(target.node.resource)));
			}
			this.logService.warn(`[BaseHalf] the upstream list of ${target.node.relativePath} could not be read`, error);
			throw new StoreRefusal('unreadable', localize('basehalf.references.sidecarUnreadable', "The upstream list of {0} could not be read: {1}", this.label(target.node.resource), baseHalfPlainFailureReason(error)));
		}
		const text = bytes === null ? undefined : utf8Decoder.decode(bytes.buffer);
		const options = { nodePath: target.node.relativePath, identity: target.identity };
		const read = readBaseHalfSidecarUpstream(text, options);
		const operation = target.edit.operation;
		// Move into File takes the entries it can read out of a file that
		// cannot be read as a whole: undo puts those entries back.
		const expected = operation.kind === 'deleteSidecar' && text !== undefined && !read.readable
			? { items: baseHalfReadableSidecarUpstreamEntries(text, options).map(entry => ({ text: entry, scalar: true })) }
			: readSnapshot(read);
		let transition: TransitionState | undefined;
		let plan: BaseHalfUpstreamTextPlan;
		if (operation.kind === 'deleteSidecar') {
			// Move into File appends the entries read from `operation.expected`:
			// the file is removed only while it still has exactly those bytes.
			if (bytes !== null && !bytes.equals(operation.expected)) {
				throw new StoreRefusal('changedSinceEdit', localize('basehalf.references.sidecarChangedSinceEdit', "The upstream list of {0} changed since this edit.", this.label(target.node.resource)));
			}
			plan = bytes === null ? { kind: 'noop' } : { kind: 'delete' };
		} else if (operation.kind === 'nodeDocument') {
			throw new StoreRefusal('notWritable', this.message('notWritable', target.node.resource));
		} else {
			if (operation.kind === 'transition') {
				transition = read.readable ? transitionState(expected, operation) : 'other';
				if (transition !== 'from') {
					return { ...unchangedStore(target), expected, next: expected, transition, expectedBytes: bytes };
				}
			}
			const listOperations = this.listOperations(target);
			plan = chainPlans(text, listOperations, (current, next) => planBaseHalfSidecarUpstreamEdit(current, next, options));
		}
		if (plan.kind === 'refused') {
			throw this.planRefusal(plan.reason, target.node.resource, 'sidecar');
		}
		const changed = plan.kind === 'edit' || plan.kind === 'delete';
		if (changed && await baseHalfIsWorkspaceFolderMarked(this.fileService, target.node.workspaceFolder)) {
			throw new StoreRefusal('markedFolder', this.message('markedFolder', target.node.resource));
		}
		const nextText = plan.kind === 'edit' ? plan.text : undefined;
		return {
			...unchangedStore(target),
			expected,
			next: plan.kind === 'edit'
				? readSnapshot(readBaseHalfSidecarUpstream(plan.text, options))
				: plan.kind === 'delete' ? { items: [] } : expected,
			...(transition ? { transition } : {}),
			changed,
			expectedBytes: bytes,
			...(plan.kind === 'delete' ? { nextBytes: 'delete' as const } : nextText !== undefined ? { nextBytes: VSBuffer.fromString(nextText), savedText: nextText } : {})
		};
	}

	/** The refusal for a list a planner would not edit. `resource` is the node the message names. */
	private planRefusal(reason: BaseHalfUpstreamPlanRefusal, resource: URI, storeKind: 'markdown' | 'sidecar'): StoreRefusal {
		switch (reason) {
			case 'entryMissing':
				return new StoreRefusal('entryMissing', this.message('entryMissing', resource));
			case 'foreignValue':
				return new StoreRefusal('foreign', this.message('foreign', resource));
			case 'frontmatterBeyondWindow':
				return new StoreRefusal('frontmatterTooLarge', this.message('frontmatterTooLarge', resource));
			case 'mappingValue':
			case 'duplicateKey':
			case 'anchorAliasTag':
			case 'blockScalar':
			case 'invalidDocument':
				// The message names Rebuild List only where the badge offers it.
				return new StoreRefusal('unreadable', baseHalfUpstreamStoreCanRebuild(storeKind, reason)
					? this.message('unreadable', resource)
					: localize('basehalf.references.unreadableNoRepair', "BaseHalf can't read the upstream list of {0}.", this.label(resource)));
			default:
				return new StoreRefusal('notWritable', baseHalfUpstreamStoreCanRebuild(storeKind, reason)
					? this.message('unreadable', resource)
					: this.message('notWritable', resource));
		}
	}

	/** Step 3: flush both flusher keys of the document, with a 2 s limit. */
	private async flush(node: IBaseHalfWorkspaceResource): Promise<boolean> {
		const keys = [...new Set([baseHalfMarkdownRichDocumentKey(node.workspaceFolder, node.relativePath), node.resource.toString()])];
		const flushed = Promise.all(keys.map(key => this.editorFlushService.flushDocument(key, { rejectOnError: true }))).then(results => results.every(Boolean), () => false);
		const timer = timeout(BASEHALF_REFERENCE_FLUSH_TIMEOUT_MS);
		try {
			return await Promise.race([flushed, timer.then(() => false, () => false)]);
		} finally {
			timer.cancel();
		}
	}

	//#endregion

	//#region Writes

	private async write(prepared: IPreparedStore[], options: IBaseHalfReferenceEditOptions, leases: FolderLeases): Promise<IBaseHalfReferenceEditResult> {
		const changed = prepared.filter(store => store.changed);
		// A move adds the entry to the new downstream before removing it from
		// the old one. When an operation both adds and removes, every adding
		// store is written and saved first; the removals are not even applied
		// to their models (where auto-save could persist them) until then. If
		// an add fails, the removals are not attempted and both entries remain.
		const adding = changed.filter(store => addsEntries(store.edit.operation));
		const phases = adding.length > 0 && adding.length < changed.length
			? [adding, changed.filter(store => !adding.includes(store))]
			: [changed];
		try {
			for (const phase of phases) {
				await this.writePhase(phase, options, leases);
			}
		} catch (error) {
			const result = toResult(prepared);
			this.reportFailure(result, error);
			throw error instanceof BaseHalfReferenceEditFailure ? new BaseHalfReferenceEditFailure(error.message, result) : new BaseHalfReferenceEditFailure(error instanceof Error ? error.message : String(error), result);
		}
		return toResult(prepared);
	}

	/**
	 * Writes one phase: non-Markdown stores listed before the first Markdown
	 * store, then every Markdown edit in one bulk edit and its saves, then the
	 * remaining node documents and sidecars.
	 */
	private async writePhase(stores: readonly IPreparedStore[], options: IBaseHalfReferenceEditOptions, leases: FolderLeases): Promise<void> {
		const firstMarkdown = stores.findIndex(store => store.storeKind === 'markdown');
		const before = firstMarkdown < 0 ? stores : stores.slice(0, firstMarkdown).filter(store => store.storeKind !== 'markdown');
		const markdown = stores.filter(store => store.storeKind === 'markdown');
		const after = firstMarkdown < 0 ? [] : stores.slice(firstMarkdown).filter(store => store.storeKind !== 'markdown');
		for (const store of before) {
			await this.writeFileStore(store);
		}
		if (markdown.length > 0) {
			await this.writeMarkdown(markdown, options, leases);
		}
		for (const store of after) {
			await this.writeFileStore(store);
		}
	}

	/** Rebuild List, and a Move into File that leaves content behind, replace
	 * or remove a sidecar holding something BaseHalf could not use: its bytes
	 * are kept as a recovery copy first. If the copy cannot be saved, the write
	 * fails and the sidecar is left unchanged. */
	private async preserveReplacedSidecar(store: IPreparedStore): Promise<void> {
		const operation = store.edit.operation;
		const preserves = operation.kind === 'rebuild' || (operation.kind === 'deleteSidecar' && !!operation.preserve);
		if (!preserves || !store.expectedBytes) {
			return;
		}
		const recoveryCopy = await baseHalfPreserveMirrorBytes(this.fileService, store.node.workspaceFolder, store.storeResource, store.expectedBytes);
		this.logService.warn(`[BaseHalf] replaced the upstream.yaml of ${store.node.relativePath}, which held content BaseHalf could not use; its bytes are kept at ${recoveryCopy.toString()}`);
	}

	/** Node documents (node-document writer) and sidecars (expected-bytes compare and swap). */
	private async writeFileStore(store: IPreparedStore, retried = false): Promise<void> {
		try {
			if (store.storeKind === 'node') {
				await this.fileService.writeFileWithExpectedContents(store.storeResource, store.nextBytes as VSBuffer, store.expectedBytes ?? null, { atomic: { postfix: NODE_WRITE_TEMP_POSTFIX } });
				this.referenceIndexService.acceptSavedContent(store.node, 'node', (store.nextBytes as VSBuffer).toString());
			} else if (store.nextBytes === 'delete') {
				await this.preserveReplacedSidecar(store);
				await this.deleteSidecar(store);
				this.referenceIndexService.acceptSavedContent(store.node, 'sidecar', undefined);
			} else {
				const workspaceFolder = store.node.workspaceFolder;
				await this.preserveReplacedSidecar(store);
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, store.storeResource);
				await this.fileService.createFolder(dirname(store.storeResource));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, store.storeResource);
				await baseHalfCommitMirrorFile(this.fileService, store.storeResource, store.nextBytes as VSBuffer, store.expectedBytes ?? null);
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, store.storeResource);
				this.referenceIndexService.acceptSavedContent(store.node, 'sidecar', store.savedText);
			}
			store.outcome = 'changed';
		} catch (error) {
			if (!retried && isCompareAndSwapConflict(error)) {
				// The store changed between planning and writing: re-plan once.
				let replanned: IPreparedStore;
				try {
					replanned = store.storeKind === 'node' ? await this.prepareNode(store) : await this.prepareSidecar(store);
				} catch (replanError) {
					store.outcome = 'failed';
					store.error = replanError instanceof Error ? replanError.message : String(replanError);
					throw replanError;
				}
				if (store.transition !== undefined && replanned.transition !== 'from') {
					store.outcome = 'failed';
					store.error = this.message('changedSinceEdit', store.storeResource);
					throw new BaseHalfReferenceEditFailure(store.error, toResult([store]));
				}
				Object.assign(store, { next: replanned.next, changed: replanned.changed, expectedBytes: replanned.expectedBytes, nextBytes: replanned.nextBytes, savedText: replanned.savedText });
				if (!replanned.changed) {
					store.outcome = 'unchanged';
					return;
				}
				return this.writeFileStore(store, true);
			}
			store.outcome = 'failed';
			store.error = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	private async deleteSidecar(store: IPreparedStore): Promise<void> {
		const workspaceFolder = store.node.workspaceFolder;
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, store.storeResource);
		const current = await this.readOptional(store.storeResource, SIDECAR_MAX_BYTES, workspaceFolder);
		if (current === null) {
			return;
		}
		if (!store.expectedBytes || !current.equals(store.expectedBytes)) {
			throw new FileOperationError(`${store.storeResource.toString()} changed before it could be removed`, FileOperationResult.FILE_MODIFIED_SINCE);
		}
		await this.fileService.del(store.storeResource, { useTrash: false, recursive: false });
	}

	/** Steps 6 and 7: one bulk edit for every Markdown document, then each save. */
	private async writeMarkdown(stores: readonly IPreparedStore[], options: IBaseHalfReferenceEditOptions, leases: FolderLeases): Promise<void> {
		await this.persistAdhdLineBase(stores, leases);
		try {
			await this.applyBulk(stores, options.label);
		} catch (error) {
			// A model changed between planning and applying: re-plan once, then refuse.
			for (const store of stores) {
				this.replan(store);
			}
			const remaining = stores.filter(store => store.changed);
			try {
				await this.applyBulk(remaining, options.label);
			} catch {
				for (const store of remaining) {
					store.outcome = 'failed';
					store.error = this.message('changedSinceEdit', store.storeResource);
				}
				throw new BaseHalfReferenceEditFailure(localize('basehalf.references.modelChanged', "{0} changed while the connection was being saved.", this.label(remaining[0].storeResource)), toResult(stores));
			}
		}
		// Every edited document is saved, even after one save fails: a failed
		// document keeps its notice (Retry, Revert Change) and the
		// operation then reports exactly which documents changed.
		let failure: unknown;
		for (const store of stores) {
			if (!store.changed) {
				continue;
			}
			try {
				await this.saveMarkdown(store, options);
			} catch (error) {
				failure ??= error;
			}
		}
		if (failure !== undefined) {
			throw failure;
		}
	}

	/**
	 * ADHD read ranges count body lines. An `adhd.yaml` from an earlier release
	 * holds absolute lines instead: before this operation changes the
	 * frontmatter line count of such a document, persist its conversion
	 * against the count the document has now. This is a one-time `.bh/` write
	 * that is part of the operation, and none is made in a folder marked with
	 * the source-tree marker.
	 */
	private async persistAdhdLineBase(stores: readonly IPreparedStore[], leases: FolderLeases): Promise<void> {
		for (const store of stores) {
			if (!store.changed || !store.model || store.plannedText === undefined) {
				continue;
			}
			const lease = leases.get(store.node.workspaceFolder.toString());
			const before = baseHalfMarkdownFrontmatterLineCount(store.model.textEditorModel.getValue());
			if (!lease || before === baseHalfMarkdownFrontmatterLineCount(store.plannedText)) {
				continue;
			}
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, store.node.workspaceFolder)) {
				continue;
			}
			try {
				await this.adhdMirrorService.persistBodyLineBase(store.node, before, lease);
			} catch (error) {
				// Reading aids never block the upstream change the user asked for.
				// A file that cannot be read has no ranges to keep aligned and
				// does not get here; a failure of the file system (a linked
				// mirror path, an I/O error) leaves the file as it was.
				this.logService.warn(`[BaseHalf] could not convert the ADHD reading aids of ${store.node.relativePath} to body lines: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	private replan(store: IPreparedStore): void {
		const replanned = this.planMarkdown({ ...store, changed: false });
		if (store.transition !== undefined && replanned.transition !== 'from') {
			throw new BaseHalfReferenceEditFailure(this.message('changedSinceEdit', store.storeResource), toResult([store]));
		}
		Object.assign(store, {
			expected: replanned.expected,
			next: replanned.next,
			changed: replanned.changed,
			createdFrontmatter: replanned.createdFrontmatter,
			plannedText: replanned.plannedText,
			versionId: replanned.versionId,
			dirtyBeforeEdit: replanned.dirtyBeforeEdit
		});
		if (!store.changed) {
			store.outcome = 'unchanged';
		}
	}

	private async applyBulk(stores: readonly IPreparedStore[], label: string): Promise<void> {
		if (stores.length === 0) {
			return;
		}
		const edits = stores.map(store => {
			const textModel = store.model!.textEditorModel;
			const current = textModel.getValue();
			const planned = store.plannedText!;
			const edit = minimalTextEdit(current, planned);
			const start = textModel.getPositionAt(edit.offset);
			const end = textModel.getPositionAt(edit.offset + edit.length);
			return new ResourceTextEdit(store.storeResource, { range: Range.fromPositions(start, end), text: edit.text }, store.versionId);
		});
		// This edit carries no canvas undo source: it belongs to each document's own undo stack.
		const result = await this.bulkEditService.apply(edits, { label, code: 'basehalf.references.edit', quotableLabel: label, respectAutoSaveConfig: false });
		if (!result.isApplied) {
			throw new Error('The upstream edit was not applied.');
		}
		for (const store of stores) {
			if (store.model!.textEditorModel.getValue() !== store.plannedText) {
				throw new Error(`${store.storeResource.toString()} has changed in the meantime`);
			}
		}
	}

	private async saveMarkdown(store: IPreparedStore, options: IBaseHalfReferenceEditOptions, retried = false): Promise<void> {
		const model = store.model!;
		const producedVersion = model.textEditorModel.getVersionId();
		let failure: unknown;
		try {
			if (await model.save({ ignoreErrorHandler: true, reason: SaveReason.EXPLICIT })) {
				this.accepted(store);
				return;
			}
			failure = new Error(localize('basehalf.references.notSaved', "The upstream change to {0} is not saved.", this.label(store.node.resource)));
		} catch (error) {
			failure = error;
		}
		if (!retried && isModifiedSince(failure) && model.textEditorModel.getVersionId() === producedVersion && !store.dirtyBeforeEdit) {
			// The file changed on disk while the model is still at the version
			// BaseHalf produced: revert to disk, re-plan once, apply and save again.
			await model.revert();
			this.replan(store);
			if (!store.changed) {
				store.outcome = 'unchanged';
				return;
			}
			await this.applyBulk([store], options.label);
			return this.saveMarkdown(store, options, true);
		}
		store.outcome = 'failed';
		store.error = failure instanceof Error ? failure.message : String(failure);
		this.showNotSaved(store, options, producedVersion);
		throw new BaseHalfReferenceEditFailure(localize('basehalf.references.notSaved', "The upstream change to {0} is not saved.", this.label(store.node.resource)), toResult([store]));
	}

	private accepted(store: IPreparedStore): void {
		store.outcome = 'changed';
		// While the model is clean its value is the saved text; otherwise the
		// planned text is the best known saved state until the watcher reports.
		const saved = this.textFileService.isDirty(store.storeResource) ? store.plannedText! : store.model!.textEditorModel.getValue();
		this.referenceIndexService.acceptSavedContent(store.node, 'markdown', saved);
		if (store.createdFrontmatter) {
			this._onDidCreateFrontmatter.fire(store.node);
			this.showFirstFrontmatterNotice(store.node);
		}
	}

	//#endregion

	//#region Notices

	private showNotSaved(store: IPreparedStore, options: IBaseHalfReferenceEditOptions, producedVersion: number): void {
		const model = store.model!;
		const textModel = model.textEditorModel;
		const expected = store.expected;
		const choices: IPromptChoice[] = [
			{
				label: localize('basehalf.references.retry', "Retry"),
				run: async () => {
					try {
						const saved = await model.save({ ignoreErrorHandler: true, reason: SaveReason.EXPLICIT });
						if (saved && !this.textFileService.isDirty(store.storeResource)) {
							store.outcome = 'changed';
							this.referenceIndexService.acceptSavedContent(store.node, 'markdown', textModel.getValue());
							return;
						}
					} catch (error) {
						this.logService.warn('[BaseHalf] upstream save retry failed', error);
					}
					this.showNotSaved(store, options, producedVersion);
				}
			},
			{
				label: localize('basehalf.references.revertChange', "Revert Change"),
				run: async () => {
					if (textModel.isDisposed()) {
						return;
					}
					if (!store.dirtyBeforeEdit && textModel.getVersionId() === producedVersion) {
						// Only BaseHalf's change is unsaved: go back to the text on disk.
						await model.revert();
						return;
					}
					const text = textModel.getValue();
					const plan = planBaseHalfMarkdownUpstreamEdit(text, { kind: 'set', items: expected.items }, { nodePath: store.node.relativePath, identity: store.identity, defaultEol: textModel.getEOL() });
					if (plan.kind !== 'edit') {
						return;
					}
					const edit = minimalTextEdit(text, plan.text);
					await this.bulkEditService.apply([new ResourceTextEdit(store.storeResource, {
						range: Range.fromPositions(textModel.getPositionAt(edit.offset), textModel.getPositionAt(edit.offset + edit.length)),
						text: edit.text
					}, textModel.getVersionId())], { label: options.label, code: 'basehalf.references.revert', respectAutoSaveConfig: false });
				}
			}
		];
		this.notificationService.prompt(Severity.Error, localize('basehalf.references.notSaved', "The upstream change to {0} is not saved.", this.label(store.node.resource)), choices, { sticky: true });
	}

	private showFirstFrontmatterNotice(node: IBaseHalfWorkspaceResource): void {
		if (this.storageService.getBoolean(BASEHALF_REFERENCES_FIRST_FRONTMATTER_NOTICE_STORAGE_KEY, StorageScope.APPLICATION, false)) {
			return;
		}
		this.storageService.store(BASEHALF_REFERENCES_FIRST_FRONTMATTER_NOTICE_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.notificationService.prompt(Severity.Info, localize(
			'basehalf.references.firstFrontmatter',
			"Saved this connection inside {0}. Agents and other tools that read the note see it there.",
			basename(node.resource)
		), [
			{ label: localize('basehalf.references.ok', "OK"), run: () => { } }
		]);
	}

	private reportFailure(result: IBaseHalfReferenceEditResult, error: unknown): void {
		const changed = result.stores.filter(store => store.outcome === 'changed').map(store => this.label(store.node.resource));
		const unchanged = result.stores.filter(store => store.outcome !== 'changed').map(store => this.label(store.node.resource));
		this.logService.error(`[BaseHalf] upstream operation failed. Changed: ${changed.join(', ') || '(none)'}. Not changed: ${unchanged.join(', ') || '(none)'}.`, error);
		if (result.stores.length > 1) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'basehalf.references.partialFailure',
					"The connection change was not completed. Changed: {0}. Not changed: {1}.",
					changed.join(', ') || localize('basehalf.references.none', "none"),
					unchanged.join(', ') || localize('basehalf.references.none', "none")
				)
			});
		} else if (!(error instanceof BaseHalfReferenceEditFailure) && result.stores[0]?.storeKind !== 'markdown') {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('basehalf.references.writeFailed', "The upstream change to {0} is not saved: {1}", unchanged[0] ?? '', baseHalfPlainFailureReason(error))
			});
		}
	}

	//#endregion

	//#region Helpers

	private refusal(blocking: readonly IBaseHalfReferenceBlockingStore[]): BaseHalfReferenceEditRefusal {
		return new BaseHalfReferenceEditRefusal(blocking[0].reason, blocking.map(store => store.message).join('\n'), blocking);
	}

	private message(reason: BaseHalfReferenceRefusalReason, resource: URI): string {
		const file = this.label(resource);
		switch (reason) {
			case 'beingMoved': return localize('basehalf.references.beingMoved', "This item is being moved.");
			case 'readonly': return localize('basehalf.references.readonly', "{0} is read-only.", file);
			case 'orphaned': return localize('basehalf.references.orphaned', "{0} was deleted from disk.", file);
			case 'conflict': return localize('basehalf.references.conflict', "{0} has a save conflict. Resolve it first.", file);
			case 'error': return localize('basehalf.references.modelError', "{0} could not be saved earlier. Resolve the error first.", file);
			case 'binary': return localize('basehalf.references.binary', "{0} is not a text file.", file);
			case 'frontmatterTooLarge': return localize('basehalf.references.frontmatterTooLarge', "BaseHalf can't save connections into {0}: the top of the file is too large to change.", file);
			case 'flushFailed': return localize('basehalf.references.flushFailed', "Finish or resolve the unsaved edit in {0} first.", file);
			case 'unsaved': return localize('basehalf.references.unsaved', "Save or revert {0} first.", file);
			case 'unreadable': return localize('basehalf.references.unreadable', "BaseHalf can't read the upstream list of {0}. Use Rebuild List in its badge first.", file);
			case 'notWritable': return localize('basehalf.references.notWritable', "BaseHalf can't save connections into {0} because of how the file begins.", file);
			case 'foreign': return localize('basehalf.references.foreign', "Another tool keeps something else where the upstream list of {0} goes. To connect anyway, use Rebuild List in its badge.", file);
			case 'upstreamOnly': return localize('basehalf.references.upstreamOnly', "{0} can't receive upstream context.", file);
			case 'symbolicLink': return localize('basehalf.references.symbolicLink', "{0} is a symbolic link or inside one. BaseHalf doesn't change files through links.", file);
			case 'indexLoading': return localize('basehalf.references.indexLoading', "Still loading connections. Try again in a moment.");
			case 'running': return localize('basehalf.references.running', "This node is running.");
			case 'limit': return localize('basehalf.references.limit', "This node already has 64 upstream entries.");
			case 'boundOutsideDraft': return localize('basehalf.references.boundOutsideDraft', "This input is part of a result. Copy the settings into a new Draft to change it.");
			case 'recipeFrozen': return localize('basehalf.references.recipeFrozen', "{0} already has an attempt or sealed Result. Copy its settings to a new Draft before changing recipe inputs.", file);
			case 'binding': return localize('basehalf.references.binding', "This input can't be assigned in {0}.", file);
			case 'markedFolder': return localize('basehalf.references.markedFolder', "{0} is in a folder BaseHalf is set to leave alone.", file);
			case 'missingNode': return localize('basehalf.references.missingNode', "{0} no longer exists.", file);
			case 'invalidEntry': return localize('basehalf.references.invalidEntryGeneric', "This path can't be listed as upstream of {0}.", file);
			case 'entryMissing': return localize('basehalf.references.entryMissing', "{0} changed; the entry is no longer listed.", file);
			case 'entryResolves': return localize('basehalf.references.entryResolves', "An upstream entry of {0} names an existing item again.", file);
			case 'changedSinceEdit': return localize('basehalf.references.changedSinceEdit', "{0} changed since this edit.", file);
		}
	}

	private label(resource: URI): string {
		return basename(resource);
	}

	private identity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	private async statOptional(resource: URI): Promise<{ readonly isDirectory: boolean } | undefined> {
		try {
			const stat = await this.fileService.stat(resource);
			return { isDirectory: stat.isDirectory };
		} catch {
			return undefined;
		}
	}

	/** Reads bytes, or `null` when the file does not exist. Mirror paths are symlink-guarded. */
	private async readOptional(resource: URI, maxBytes: number, mirrorWorkspace: URI | undefined): Promise<VSBuffer | null> {
		if (mirrorWorkspace) {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, mirrorWorkspace, resource);
		}
		try {
			return (await this.fileService.readFile(resource, { atomic: true, limits: { size: maxBytes } })).value;
		} catch (error) {
			if (isFileNotFound(error)) {
				return null;
			}
			throw error;
		}
	}

	private async readText(resource: URI, maxBytes: number | undefined, workspaceFolder: URI): Promise<string | undefined> {
		const isMirror = maxBytes !== undefined;
		const bytes = await this.readOptional(resource, maxBytes ?? Number.MAX_SAFE_INTEGER, isMirror ? workspaceFolder : undefined);
		return bytes === null ? undefined : utf8Decoder.decode(bytes.buffer);
	}

	//#endregion
}

function addsEntries(operation: InternalOperation): boolean {
	switch (operation.kind) {
		case 'add':
		case 'replace':
		case 'replaceAt':
			return true;
		case 'replaceEntries':
			return operation.replacements.length > 0;
		case 'append':
			return operation.entries.length > 0;
		case 'transition': {
			const before = new Set(operation.from.items.map(item => item.text));
			return operation.to.items.some(item => !before.has(item.text));
		}
		case 'nodeDocument':
			// Composer saves are single-store writes that may add entries.
			return operation.next.upstream.length > 0;
		default:
			return false;
	}
}

function entriesToWrite(operation: InternalOperation): readonly string[] {
	switch (operation.kind) {
		case 'add':
			return [operation.entry];
		case 'replace':
		case 'replaceAt':
			return [operation.to];
		case 'replaceEntries':
			return operation.replacements.map(replacement => replacement.to);
		case 'append':
			return operation.entries;
		default:
			return [];
	}
}

/**
 * Validates a Composer or node-surface save of a `.bhnode` document: the same
 * node, no more than 64 entries when the list grows, and a binding change
 * only in a Draft.
 */
function nextNodeDocumentSave(document: IBaseHalfNodeDocument, next: IBaseHalfNodeDocument, identity: IBaseHalfUpstreamIdentity): IBaseHalfNodeDocument {
	if (next.id !== document.id) {
		throw new BaseHalfNodeUpstreamEditError('bindingConflict', 'The saved node document belongs to another node.');
	}
	const listed = new Set(document.upstream.flatMap(item => typeof item === 'string' ? [identity.key(baseHalfNormalizeUpstreamEntry(item))] : []));
	const grows = next.upstream.some(item => typeof item === 'string' && !listed.has(identity.key(baseHalfNormalizeUpstreamEntry(item))));
	if (grows && next.upstream.length > BASEHALF_UPSTREAM_MAX_NODE_ENTRIES) {
		throw new BaseHalfNodeUpstreamEditError('limit', `This node already has ${BASEHALF_UPSTREAM_MAX_NODE_ENTRIES} upstream entries.`);
	}
	const bindingsChanged = JSON.stringify(document.recipe?.inputBindings ?? []) !== JSON.stringify(next.recipe?.inputBindings ?? []);
	if (bindingsChanged && !isBaseHalfNodeDraft(document)) {
		throw new BaseHalfNodeUpstreamEditError('boundOutsideDraft', 'A binding can change only while this node is a Draft.');
	}
	return next;
}

function unchangedStore(target: IStoreTarget): IPreparedStore {
	return { ...target, expected: { items: [] }, next: { items: [] }, changed: false, createdFrontmatter: false, outcome: 'unchanged' };
}

/** A Markdown or `.bhnode` store whose file does not exist holds no entries. */
function missingStore(target: IStoreTarget): IPreparedStore {
	const store = unchangedStore(target);
	const operation = target.edit.operation;
	return operation.kind === 'transition' ? { ...store, transition: transitionState(store.expected, operation) } : store;
}

function readSnapshot(read: IBaseHalfUpstreamStoreRead): IBaseHalfUpstreamStoreSnapshot {
	return { items: read.items.map(item => ({ text: item.text, scalar: item.scalar })) };
}

function nodeSnapshot(document: IBaseHalfNodeDocument, withDocument = false): IBaseHalfUpstreamStoreSnapshot {
	return {
		items: baseHalfNodeUpstreamItemValues(document.upstream),
		bindings: [...(document.recipe?.inputBindings ?? [])],
		...(withDocument ? { document: serializeBaseHalfNodeDocument(document) } : {})
	};
}

function transitionState(current: IBaseHalfUpstreamStoreSnapshot, operation: { readonly from: IBaseHalfUpstreamStoreSnapshot; readonly to: IBaseHalfUpstreamStoreSnapshot }): TransitionState {
	// A Markdown or sidecar store has only items. A `.bhnode` store also has
	// bindings, and it carries the whole document exactly when the transition
	// does (a Composer or node-surface save).
	const comparable = (snapshot: IBaseHalfUpstreamStoreSnapshot): IBaseHalfUpstreamStoreSnapshot => current.bindings === undefined ? { items: snapshot.items } : snapshot;
	if (baseHalfUpstreamSnapshotsEqual(current, comparable(operation.from))) {
		return 'from';
	}
	return baseHalfUpstreamSnapshotsEqual(current, comparable(operation.to)) ? 'to' : 'other';
}

function itemToJson(item: IBaseHalfUpstreamItemValue): BaseHalfNodeJsonValue {
	if (item.scalar) {
		return item.text;
	}
	try {
		return JSON.parse(item.text) as BaseHalfNodeJsonValue;
	} catch {
		return item.text;
	}
}

/** Removes the first occurrence of a string entry and, in a Draft, its binding. */
function removeFirstOccurrence(document: IBaseHalfNodeDocument, index: number, identity: IBaseHalfUpstreamIdentity): IBaseHalfNodeDocument {
	const item = document.upstream[index] as string;
	const key = identity.key(baseHalfNormalizeUpstreamEntry(item));
	const upstream = document.upstream.filter((_, candidate) => candidate !== index);
	const stillListed = upstream.some(candidate => typeof candidate === 'string' && identity.key(baseHalfNormalizeUpstreamEntry(candidate)) === key);
	const bindings: readonly IBaseHalfNodeInputBinding[] = document.recipe?.inputBindings ?? [];
	const bound = bindings.some(binding => identity.key(binding.sourcePath) === key);
	if (!bound || stillListed) {
		return setBaseHalfNodeUpstream(document, upstream);
	}
	if (!isBaseHalfNodeDraft(document)) {
		throw new BaseHalfNodeUpstreamEditError('boundOutsideDraft', 'A bound input can be disconnected only while this node is a Draft.');
	}
	return setBaseHalfNodeUpstream(document, upstream, bindings.filter(binding => identity.key(binding.sourcePath) !== key).map((binding, order) => ({ ...binding, order })));
}

/** Plans several list operations in sequence and folds them into one text plan.
 * `initial` is `undefined` for a sidecar that does not exist yet. */
function chainPlans(
	initial: string | undefined,
	operations: readonly BaseHalfUpstreamListOperation[],
	plan: (text: string | undefined, operation: BaseHalfUpstreamListOperation) => BaseHalfUpstreamTextPlan
): BaseHalfUpstreamTextPlan {
	let current = initial;
	let createdFrontmatter = false;
	for (const operation of operations) {
		const step = plan(current, operation);
		if (step.kind === 'refused') {
			return step;
		}
		if (step.kind === 'delete') {
			current = undefined;
		} else if (step.kind === 'edit') {
			createdFrontmatter = createdFrontmatter || step.createdFrontmatter;
			current = step.text;
		}
	}
	if (current === initial) {
		return { kind: 'noop' };
	}
	if (current === undefined) {
		return { kind: 'delete' };
	}
	return { kind: 'edit', text: current, edit: minimalTextEdit(initial ?? '', current), createdFrontmatter };
}

function minimalTextEdit(before: string, after: string): { readonly offset: number; readonly length: number; readonly text: string } {
	let prefix = 0;
	const limit = Math.min(before.length, after.length);
	while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
		prefix++;
	}
	let suffix = 0;
	while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) {
		suffix++;
	}
	return { offset: prefix, length: before.length - prefix - suffix, text: after.slice(prefix, after.length - suffix) };
}

function toResult(prepared: readonly IPreparedStore[]): IBaseHalfReferenceEditResult {
	const stores: IBaseHalfReferenceStoreResult[] = prepared.map(store => ({
		node: store.node,
		storeKind: store.storeKind,
		storeResource: store.storeResource,
		outcome: store.changed && store.outcome === 'unchanged' ? 'notAttempted' : store.outcome,
		expected: store.expected,
		next: store.next,
		...(store.createdFrontmatter ? { createdFrontmatter: true } : {}),
		...(store.error ? { error: store.error } : {})
	}));
	return { stores, changed: stores.some(store => store.outcome === 'changed') };
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
}

function isModifiedSince(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_MODIFIED_SINCE;
}

function isCompareAndSwapConflict(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const result = toFileOperationResult(error);
	return result === FileOperationResult.FILE_MODIFIED_SINCE || result === FileOperationResult.FILE_MOVE_CONFLICT;
}

registerSingleton(IBaseHalfReferenceEditService, BaseHalfReferenceEditService, InstantiationType.Delayed);
