/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, timeout } from '../../../base/common/async.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { isEqual, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { FileOperation, IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IWorkingCopyFileOperationPreconditionGuard, IWorkingCopyFileService, SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfIsMirrorSubtree, baseHalfRemapSubtreeRel } from '../common/basehalfMirrorTree.js';
import { IBaseHalfMovedItemsService, IBaseHalfOwedEntryMove } from '../common/basehalfMovedItemsService.js';
import { BaseHalfReferenceRefusalReason } from '../common/basehalfReferenceEdit.js';
import { baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from '../common/basehalfReferenceEntries.js';
import { IBaseHalfReferenceIndexService } from '../common/basehalfReferenceIndex.js';
import { BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES, baseHalfUpstreamSidecarResource, baseHalfUpstreamStoreKind, readBaseHalfMarkdownUpstream, readBaseHalfSidecarUpstream } from '../common/basehalfReferenceStore.js';
import {
	baseHalfComposeRenamePlan,
	baseHalfEffectiveMoves,
	baseHalfPrimaryMoves,
	baseHalfRelocateRenameStores,
	IBaseHalfPathMove,
	IBaseHalfRenamePlanState,
	IBaseHalfRenameStore
} from '../common/basehalfRenameRefactor.js';
import { IBaseHalfNodeExecutionService } from './basehalfNodeExecutionService.js';
import { IBaseHalfReferenceRefactorInput, IBaseHalfReferenceRefactorOutcome, IBaseHalfReferenceRefactorService } from './basehalfReferenceRefactorService.js';

const SIDECAR_MAX_BYTES = 64 * 1024;
/** How long an update that a move interrupted waits for moves in progress to finish. */
const MOVE_SETTLE_TIMEOUT_MS = 10_000;
/** How long after a trigger the entries that are still owed are tried again. */
const OWED_RETRY_DELAY_MS = 500;
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * Why a store was not written that will not hold for good: the entry is
 * owed, and is written when the reason has gone.
 */
const TEMPORARY_REFUSALS: ReadonlySet<BaseHalfReferenceRefusalReason | 'historical'> = new Set<BaseHalfReferenceRefusalReason>(['beingMoved', 'flushFailed', 'unsaved', 'conflict', 'error', 'indexLoading', 'running']);

/** One workspace folder's part of a prepared move. */
interface IPreparedRename {
	readonly workspaceFolder: URI;
	readonly pairs: readonly { readonly source: URI; readonly target: URI; readonly move: IBaseHalfPathMove }[];
	/** The index snapshot, or `undefined` while the index was still building. */
	readonly snapshot: readonly IBaseHalfRenameStore[] | undefined;
	/** The old paths of the plans that were not written when the move was prepared: they own those entries. */
	readonly exclude: readonly string[];
}

/** A node whose store kind changed to its own file, with the entries its moved `upstream.yaml` holds. */
interface IStoreKindChange {
	readonly node: IBaseHalfWorkspaceResource;
	readonly entries: number;
}

/**
 * The entries of one move, or of several that composed, in one workspace
 * folder. It stays pending, and keeps composing with later moves, until its
 * update is written.
 */
interface IPendingRename {
	readonly workspaceFolder: URI;
	state: IBaseHalfRenamePlanState;
	/** The stores were not snapshotted before the move: they are found once the index is ready. */
	deferred: boolean;
	/** The plan was written or dropped. */
	answered: boolean;
}

/**
 * Keeps the upstream entries that name a moved item pointing at it (following
 * moved items, "Entries are always updated"; reference graph, "Rename
 * refactor"). After every move it rewrites them without asking and shows
 * nothing:
 *
 * - **A move through the workbench** (any `IWorkingCopyFileService` move:
 *   Explorer, canvas rename, drag-move, paste-move, and undo or redo of a
 *   move). The prepare step snapshots, from the index, every store whose
 *   entries name a moved path or a path inside a moved folder. After the move
 *   and its mirror cascade the stores are mapped to their current paths.
 * - **A move outside the workbench** that BaseHalf recognized. Its plan
 *   starts when the card information is at the new path, and finds the
 *   stores in the index, where the entries still name the old path.
 * - Plans compose with later moves until their update is written. A plan
 *   never rewrites entries that name the old paths of an earlier plan that
 *   is not written yet: that plan owns them and maps them through both moves.
 * - The update adds no undo step. Undoing a workbench move is a move back,
 *   which updates the entries back.
 * - **What is owed is remembered.** When a store could not be written for a
 *   reason that passes (unsaved changes, a node that is running), or the
 *   index had not seen every store, the move is kept with what BaseHalf last
 *   saw and tried again: when the index finished a scan, when a document is
 *   saved or reverted, when a run ends, and at open.
 * - A folder marked with the source-tree marker is never rewritten by itself.
 */
export class BaseHalfRenameRefactorContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.renameRefactor';

	private readonly pending = new Set<IPendingRename>();
	/** Workbench moves prepared but not yet composed, by workspace folder. */
	private readonly movesInFlight = new Map<string, number>();
	private settleWaiters: (() => void)[] = [];
	private readonly owedRetries = this._register(new DisposableMap<string, RunOnceScheduler>());
	private disposed = false;

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IBaseHalfReferenceRefactorService private readonly refactorService: IBaseHalfReferenceRefactorService,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfMovedItemsService private readonly movedItemsService: IBaseHalfMovedItemsService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@IBaseHalfNodeExecutionService nodeExecutionService: IBaseHalfNodeExecutionService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: async (files, operation) => this.prepare(files, operation)
		}));
		// An item that was moved outside BaseHalf: its entries follow once its card information did.
		this._register(this.movedItemsService.onDidRelocate(event => {
			// The canvas draws the item with its connections once its entries are written.
			const hold = this.movedItemsService.holdSettled(event.workspaceFolder);
			void this.register(event.workspaceFolder, event.moves.map(move => ({ from: move.from, to: move.to })), undefined, this.pendingOldPaths(event.workspaceFolder)).finally(() => hold.dispose());
		}));

		// What is owed is tried again when the reason it was owed for may have gone.
		this._register(this.referenceIndexService.onDidChange(event => {
			if (event.full && (event.state === 'ready' || event.state === 'partial')) {
				this.retryOwed(event.workspaceFolder);
			}
		}));
		this._register(workingCopyService.onDidChangeDirty(workingCopy => {
			const folder = this.contextService.getWorkspaceFolder(workingCopy.resource);
			if (folder && !workingCopy.isDirty()) {
				this.retryOwed(folder.uri);
			}
		}));
		this._register(nodeExecutionService.onDidChange(() => this.retryOwedEverywhere()));
		this._register(this.contextService.onDidChangeWorkspaceFolders(event => {
			for (const added of event.added) {
				void this.movedItemsService.whenCompared(added.uri).then(() => this.retryOwed(added.uri));
			}
		}));
		for (const folder of this.contextService.getWorkspace().folders) {
			void this.movedItemsService.whenCompared(folder.uri).then(() => this.retryOwed(folder.uri));
		}
	}

	override dispose(): void {
		this.disposed = true;
		for (const plan of this.pending) {
			plan.answered = true;
		}
		this.pending.clear();
		this.releaseSettleWaiters();
		super.dispose();
	}

	//#region Planning

	/**
	 * Snapshots the stores that name a moved path, before anything moves. It
	 * never awaits, so it adds no await boundary ahead of the structural
	 * commit barrier of the mirror cascade.
	 */
	private prepare(files: readonly SourceTargetPair[], operation: FileOperation): IWorkingCopyFileOperationPreconditionGuard | undefined {
		if (operation !== FileOperation.MOVE) {
			return undefined;
		}
		const groups = new Map<string, { readonly workspaceFolder: URI; readonly pairs: { readonly source: URI; readonly target: URI; readonly move: IBaseHalfPathMove }[] }>();
		for (const pair of files) {
			if (!pair.source) {
				continue;
			}
			const from = this.location(pair.source);
			const to = this.location(pair.target);
			// Moves between workspace folders are refused by the mirror cascade.
			if (!from || !to || !isEqual(from.workspaceFolder, to.workspaceFolder) || from.relativePath === to.relativePath) {
				continue;
			}
			const key = from.workspaceFolder.toString();
			let group = groups.get(key);
			if (!group) {
				group = { workspaceFolder: from.workspaceFolder, pairs: [] };
				groups.set(key, group);
			}
			group.pairs.push({ source: pair.source, target: pair.target, move: { from: from.relativePath, to: to.relativePath } });
		}
		if (groups.size === 0) {
			return undefined;
		}
		const prepared: IPreparedRename[] = [...groups.values()].map(group => {
			const state = this.referenceIndexService.getState(group.workspaceFolder);
			const exclude = this.pendingOldPaths(group.workspaceFolder);
			return {
				...group,
				exclude,
				snapshot: state === 'ready' || state === 'partial' ? this.refactorService.snapshot(group.workspaceFolder, group.pairs.map(pair => pair.move), exclude) : undefined
			};
		});
		for (const group of prepared) {
			const key = group.workspaceFolder.toString();
			this.movesInFlight.set(key, (this.movesInFlight.get(key) ?? 0) + 1);
		}
		let completed: readonly SourceTargetPair[] = [];
		let disposed = false;
		return {
			didRun: async files => { completed = files; },
			didFail: async files => { completed = files; },
			// Guards are disposed after every guard of the operation finished, so
			// the mirror cascade has released its fences by the time a plan runs.
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				try {
					if (completed.length > 0 && !this.disposed) {
						this.didMove(prepared, completed);
					}
				} finally {
					for (const group of prepared) {
						const key = group.workspaceFolder.toString();
						const count = (this.movesInFlight.get(key) ?? 1) - 1;
						if (count > 0) {
							this.movesInFlight.set(key, count);
						} else {
							this.movesInFlight.delete(key);
						}
					}
					this.releaseSettleWaiters();
				}
			}
		};
	}

	/** The old paths of every pending plan in the folder, including plans being updated. */
	private pendingOldPaths(workspaceFolder: URI): string[] {
		const paths = new Set<string>();
		for (const plan of this.pending) {
			if (isEqual(plan.workspaceFolder, workspaceFolder)) {
				for (const move of plan.state.moves) {
					paths.add(move.from);
				}
			}
		}
		return [...paths];
	}

	/** Resolves once no workbench move in the folder is between prepare and composition, or after a time limit. */
	private async whenMovesSettled(workspaceFolder: URI): Promise<void> {
		const key = workspaceFolder.toString();
		const deadline = Date.now() + MOVE_SETTLE_TIMEOUT_MS;
		while (!this.disposed && (this.movesInFlight.get(key) ?? 0) > 0) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return;
			}
			const timer = timeout(remaining);
			try {
				await Promise.race([new Promise<void>(resolve => this.settleWaiters.push(resolve)), timer.then(undefined, () => undefined)]);
			} finally {
				timer.cancel();
			}
		}
	}

	private releaseSettleWaiters(): void {
		const waiters = this.settleWaiters;
		this.settleWaiters = [];
		for (const resolve of waiters) {
			resolve();
		}
	}

	/** Registers the plans of a completed workbench move, synchronously, so later moves compose in order. */
	private didMove(prepared: readonly IPreparedRename[], completed: readonly SourceTargetPair[]): void {
		for (const group of prepared) {
			const moves = group.pairs
				.filter(pair => completed.some(file => file.source && isEqual(file.source, pair.source) && isEqual(file.target, pair.target)))
				.map(pair => pair.move);
			if (moves.length > 0) {
				void this.register(group.workspaceFolder, moves, group.snapshot, group.exclude);
			}
		}
	}

	/**
	 * Registers the plan of moves that have happened. Without a `snapshot` of
	 * the stores from before the moves, the plan finds them in the index.
	 */
	private register(workspaceFolder: URI, moves: readonly IBaseHalfPathMove[], snapshot: readonly IBaseHalfRenameStore[] | undefined, exclude: readonly string[]): Promise<void> {
		if (this.disposed || moves.length === 0) {
			return Promise.resolve();
		}
		const identity = this.identity(workspaceFolder);
		// Pending moves compose: the entries of a plan whose update has not
		// written yet map through this move too.
		for (const plan of [...this.pending]) {
			if (!isEqual(plan.workspaceFolder, workspaceFolder)) {
				continue;
			}
			plan.state = baseHalfComposeRenamePlan(plan.state, moves, identity);
			if (baseHalfEffectiveMoves(plan.state.moves).length === 0) {
				this.settle(plan);
			}
		}
		const plan: IPendingRename = {
			workspaceFolder,
			state: {
				moves,
				stores: snapshot ? baseHalfRelocateRenameStores(snapshot, moves, identity) : [],
				storeKindChanges: moves.map(move => move.to),
				...(exclude.length > 0 ? { exclude } : {})
			},
			deferred: !snapshot,
			answered: false
		};
		this.pending.add(plan);
		return timeout(0)
			.then(() => this.process(plan))
			.catch(error => this.logService.error('[BaseHalf] updating the upstream entries after a move failed', error));
	}

	/** Writes a plan, and remembers its moves when an entry is still owed afterwards. */
	private async process(plan: IPendingRename): Promise<void> {
		if (plan.answered || this.disposed) {
			return;
		}
		const folder = plan.workspaceFolder;
		const indexState = await this.refactorService.whenIndexReady(folder);
		if (plan.answered || this.disposed) {
			return;
		}
		this.snapshotDeferred(plan);
		const storeKindChanges = await this.storeKindChanges(plan);
		if (plan.answered || this.disposed) {
			return;
		}
		// A folder marked with the source-tree marker is never rewritten by itself.
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder)) {
			this.settle(plan);
			return;
		}
		if (plan.answered || this.disposed) {
			return;
		}
		let blocked = false;
		if (plan.state.stores.length === 0 && storeKindChanges.length === 0) {
			this.settle(plan);
		} else {
			const outcome = await this.update(plan, storeKindChanges);
			blocked = outcome !== undefined && (outcome.errors.length > 0 || outcome.plan.skipped.some(skip => TEMPORARY_REFUSALS.has(skip.reason)));
		}
		// A partial index may not have seen every store that names the old paths.
		this.owe(folder, baseHalfEffectiveMoves(plan.state.moves), blocked || indexState === 'partial');
	}

	private snapshotDeferred(plan: IPendingRename): void {
		if (!plan.deferred) {
			return;
		}
		// The index was building when the move was prepared. Entries still
		// name the old paths, so the index finds the same stores now; a store
		// it still lists at its old path is mapped like a snapshot's.
		const folder = plan.workspaceFolder;
		plan.deferred = false;
		plan.state = { ...plan.state, stores: baseHalfRelocateRenameStores(this.refactorService.snapshot(folder, plan.state.moves, plan.state.exclude), plan.state.moves, this.identity(folder)) };
	}

	/**
	 * Nodes whose store kind changed from BaseHalf metadata to their own file
	 * (`notes.txt` → `notes.md`) and whose moved `upstream.yaml` holds entries.
	 */
	private async storeKindChanges(plan: IPendingRename): Promise<IStoreKindChange[]> {
		const folder = plan.workspaceFolder;
		const out: IStoreKindChange[] = [];
		for (const path of plan.state.storeKindChanges) {
			const move = plan.state.moves.find(candidate => candidate.to === path);
			const node = this.node(folder, path);
			try {
				const stat = await this.fileService.stat(node.resource);
				if (!move || stat.isDirectory || baseHalfUpstreamStoreKind(path, false) === 'sidecar' || baseHalfUpstreamStoreKind(move.from, false) !== 'sidecar') {
					continue;
				}
				const sidecar = baseHalfUpstreamSidecarResource(folder, path);
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, folder, sidecar);
				const text = utf8Decoder.decode((await this.fileService.readFile(sidecar, { limits: { size: SIDECAR_MAX_BYTES } })).value.buffer);
				const read = readBaseHalfSidecarUpstream(text, { nodePath: path, identity: this.identity(folder) });
				const entries = read.items.filter(item => item.path !== undefined).length;
				// The list stays in use where it is. Moving it is offered only
				// into a note that can hold it.
				const noteText = stat.isFile && baseHalfUpstreamStoreKind(path, false) === 'markdown'
					? utf8Decoder.decode((await this.fileService.readFile(node.resource, { length: BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES })).value.buffer)
					: undefined;
				if (entries > 0 && (noteText === undefined || readBaseHalfMarkdownUpstream(noteText).writable)) {
					out.push({ node, entries });
				}
			} catch {
				// No node, no moved upstream.yaml, or one that can't be read: nothing to offer.
			}
		}
		return out;
	}

	private async update(plan: IPendingRename, storeKindChanges: readonly IStoreKindChange[]): Promise<IBaseHalfReferenceRefactorOutcome | undefined> {
		if (plan.answered || this.disposed) {
			return undefined;
		}
		plan.answered = true;
		const folder = plan.workspaceFolder;
		try {
			const moves = baseHalfPrimaryMoves(plan.state.moves, this.identity(folder));
			if (!this.input(plan) || moves.length === 0) {
				return undefined;
			}
			const outcome = await this.refactorService.update(folder, () => this.input(plan), {
				label: localize('basehalf.renameRefactor.undoLabel', "Update upstream paths"),
				undoResources: [this.parentCanvasResource(folder, moves[0].to)],
				moveIntoFile: storeKindChanges.map(change => change.node),
				whenMovesSettled: () => this.whenMovesSettled(folder),
				noUndo: true
			});
			for (const error of outcome?.errors ?? []) {
				this.logService.warn('[BaseHalf] an upstream entry could not be updated after a move', error);
			}
			return outcome;
		} finally {
			this.pending.delete(plan);
		}
	}

	/** What the plan updates now, or `undefined` once later moves undid it (or it was dropped). */
	private input(plan: IPendingRename): IBaseHalfReferenceRefactorInput | undefined {
		if (this.disposed || !this.pending.has(plan) || baseHalfEffectiveMoves(plan.state.moves).length === 0) {
			return undefined;
		}
		return { moves: plan.state.moves, stores: plan.state.stores, ...(plan.state.exclude ? { exclude: plan.state.exclude } : {}) };
	}

	private settle(plan: IPendingRename): void {
		plan.answered = true;
		this.pending.delete(plan);
	}

	//#endregion

	//#region Entries that are still owed

	/** Remembers, or forgets, that entries may still name the old paths of `moves`. */
	private owe(workspaceFolder: URI, moves: readonly IBaseHalfPathMove[], owed: boolean): void {
		const before = this.movedItemsService.getOwedEntryMoves(workspaceFolder);
		let next = before.filter(known => !moves.some(move => move.from === known.from));
		if (owed) {
			// Moves compose: after `a` to `b` and `b` to `c`, entries that name `a` get `c`.
			next = next.map(known => {
				const later = moves.find(move => baseHalfIsMirrorSubtree(known.to, move.from));
				return later ? { from: known.from, to: baseHalfRemapSubtreeRel(known.to, later.from, later.to) } : known;
			});
			next.push(...moves.map(move => ({ from: move.from, to: move.to })));
		}
		if (next.length !== before.length || next.some((move, index) => move.from !== before[index].from || move.to !== before[index].to)) {
			this.movedItemsService.setOwedEntryMoves(workspaceFolder, next);
		}
	}

	private retryOwedEverywhere(): void {
		for (const folder of this.contextService.getWorkspace().folders) {
			this.retryOwed(folder.uri);
		}
	}

	private retryOwed(workspaceFolder: URI): void {
		if (this.disposed || this.movedItemsService.getOwedEntryMoves(workspaceFolder).length === 0) {
			return;
		}
		const key = workspaceFolder.toString();
		let retry = this.owedRetries.get(key);
		if (!retry) {
			retry = new RunOnceScheduler(() => void this.writeOwed(workspaceFolder).catch(error => this.logService.error('[BaseHalf] updating the upstream entries that were still owed failed', error)), OWED_RETRY_DELAY_MS);
			this.owedRetries.set(key, retry);
		}
		retry.schedule();
	}

	private async writeOwed(workspaceFolder: URI): Promise<void> {
		if (this.disposed || [...this.pending].some(plan => isEqual(plan.workspaceFolder, workspaceFolder))) {
			// A plan that is being written decides about what is owed when it is done.
			return;
		}
		const owed: IBaseHalfOwedEntryMove[] = [];
		for (const move of this.movedItemsService.getOwedEntryMoves(workspaceFolder)) {
			// An old path that names an item again is that item's path now.
			if (!(await this.fileService.exists(this.node(workspaceFolder, move.from).resource))) {
				owed.push(move);
			}
		}
		this.movedItemsService.setOwedEntryMoves(workspaceFolder, owed);
		await this.register(workspaceFolder, owed, undefined, []);
	}

	//#endregion

	//#region Helpers

	private location(resource: URI): { readonly workspaceFolder: URI; readonly relativePath: string } | undefined {
		const folder = this.contextService.getWorkspaceFolder(resource);
		if (!folder) {
			return undefined;
		}
		const relativePath = getRelativePath(folder.uri, resource);
		if (!relativePath || relativePath === '.bh' || relativePath.startsWith('.bh/')) {
			return undefined;
		}
		return { workspaceFolder: folder.uri, relativePath };
	}

	private parentCanvasResource(workspaceFolder: URI, relativePath: string): URI {
		const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
		return this.canvasMirrorService.canvasResource({
			resource: parent ? URI.joinPath(workspaceFolder, ...parent.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath: parent,
			source: 'api'
		});
	}

	private node(workspaceFolder: URI, relativePath: string): IBaseHalfWorkspaceResource {
		return { resource: URI.joinPath(workspaceFolder, ...relativePath.split('/')), workspaceFolder, relativePath };
	}

	private identity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	//#endregion
}

registerWorkbenchContribution2(BaseHalfRenameRefactorContribution.ID, BaseHalfRenameRefactorContribution, WorkbenchPhase.AfterRestored);
