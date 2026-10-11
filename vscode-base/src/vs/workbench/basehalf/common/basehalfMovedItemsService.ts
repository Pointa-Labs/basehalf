/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, Limiter, RunOnceScheduler, timeout } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { joinPath, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import { FileChangesEvent, FileSystemProviderCapabilities, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IFileQuery, ISearchService, QueryType } from '../../services/search/common/search.js';
import { IBaseHalfCanvasMirrorService } from './basehalfCanvasMirror.js';
import { BaseHalfCanvasItemKind, baseHalfIsCanvasEligiblePath } from './basehalfCanvasModel.js';
import { baseHalfIsWorkspaceFolderMarked } from './basehalfLegacyCleanup.js';
import { baseHalfIsMirrorSubtree, baseHalfMirrorRoot, baseHalfRemapSubtreeRel } from './basehalfMirrorTree.js';
import { baseHalfComputeFileFingerprint, baseHalfMovedItemPath, baseHalfRecognizeMovedItems, IBaseHalfFileFingerprint, IBaseHalfFollowedItem, IBaseHalfMovedItem } from './basehalfMovedItems.js';
import { BASEHALF_SEARCH_EXCLUDED_DIRECTORY_NAMES, IBaseHalfReferenceIndexService } from './basehalfReferenceIndex.js';
import { isBaseHalfUpstreamReservedOutput } from './basehalfReferenceStore.js';

export const IBaseHalfMovedItemsService = createDecorator<IBaseHalfMovedItemsService>('baseHalfMovedItemsService');

/** A folder with more items than this gets no snapshot. */
export const BASEHALF_MOVED_ITEMS_ITEM_LIMIT = 200_000;
/** How many files below a followed folder get a fingerprint for its sake. */
export const BASEHALF_MOVED_ITEMS_FOLDER_FILE_LIMIT = 200;
/** File events for more paths than this at once are answered by listing the folder. */
export const BASEHALF_MOVED_ITEMS_RESCAN_THRESHOLD = 1000;
/** With more files than this that just appeared, what they hold is not noted when they appear. */
const ARRIVAL_NOTE_LIMIT = 200;

/** How many moves whose entries are still owed are remembered. */
export const BASEHALF_MOVED_ITEMS_OWED_LIMIT = 1000;

const CANVAS_FILE_NAME = 'canvas.yaml';
const READ_CONCURRENCY = 8;
/** 2: the pieces of a fingerprint are words. A snapshot of another version is taken again. */
const SNAPSHOT_VERSION = 2;

/** The waits of a comparison while BaseHalf runs (following moved items, "When BaseHalf compares"). */
export interface IBaseHalfMovedItemsTiming {
	/** File events have to be quiet for this long before a comparison runs. */
	readonly quietMs: number;
	/** A comparison runs at the latest this long after the first event. */
	readonly maxWaitMs: number;
	/** How long an item that disappeared or appeared can still be paired. */
	readonly windowMs: number;
	/** The snapshot is written this long after it last changed. */
	readonly saveMs: number;
}

export const BASEHALF_MOVED_ITEMS_TIMING: IBaseHalfMovedItemsTiming = { quietMs: 1000, maxWaitMs: 10_000, windowMs: 60_000, saveMs: 2000 };

export interface IBaseHalfRecognizedMoves {
	readonly workspaceFolder: URI;
	/** In the order to relocate them. */
	readonly moves: readonly IBaseHalfMovedItem[];
}

/** A move whose entries may still name the old path. */
export interface IBaseHalfOwedEntryMove {
	readonly from: string;
	readonly to: string;
}

/**
 * Recognizes items that were renamed or moved outside BaseHalf (following
 * moved items). It keeps a snapshot of what it last saw in each workspace
 * folder, compares it with what is there now, and reports the followed items
 * that it found at a new path. It moves nothing itself.
 */
export interface IBaseHalfMovedItemsService {
	readonly _serviceBrand: undefined;

	/** The followed items a comparison found at a new path. */
	readonly onDidRecognize: Event<IBaseHalfRecognizedMoves>;
	/** Fires when {@link isComparing} changes for a workspace folder. */
	readonly onDidChangeComparing: Event<URI>;
	/**
	 * True from the removal of an item BaseHalf could recognize until the
	 * comparison for it has finished, and during the comparison at open.
	 */
	isComparing(workspaceFolder: URI): boolean;
	/** Resolves when the comparison at open has finished, or after `timeoutMs`. */
	whenCompared(workspaceFolder: URI, timeoutMs?: number): Promise<void>;
	/**
	 * Whether nothing is in flight: no comparison is deciding, no recognized
	 * move waits for its relocation, and no entries of a relocated item are
	 * being written. With `shownFolder`, only what concerns that folder counts:
	 * the items directly in it, the folder itself, and the folders above it.
	 * The canvas does not redraw a folder before that,
	 * so that a moved item's card changes once. A move that is held back by
	 * unsaved changes or a running node does not count: it waits for the user.
	 */
	isSettled(workspaceFolder: URI, shownFolder?: string): boolean;
	/** Resolves when the folder {@link isSettled}, or after `timeoutMs`. */
	whenSettled(workspaceFolder: URI, timeoutMs: number, shownFolder?: string): Promise<void>;
	/**
	 * Whether the item at `path` is on its way: file events removed it and the
	 * comparison has not decided, or it was recognized at a new path and its
	 * card information is not there yet.
	 */
	isMoving(workspaceFolder: URI, path: string): boolean;
	/**
	 * Where an item is now that BaseHalf found at a new path in the last
	 * minute, or whose relocation is pending. `undefined` when it did not move.
	 */
	resolveMovedPath(workspaceFolder: URI, path: string): string | undefined;
	/**
	 * Keeps the folder from being settled until the result is disposed: the
	 * entries that name an item that was just relocated are being rewritten,
	 * and the canvas draws the item with its connections once that is done.
	 */
	holdSettled(workspaceFolder: URI): IDisposable;
	/** Lists the folder and compares it with the snapshot, as at open. */
	compare(workspaceFolder: URI): Promise<void>;

	/** The recognized moves whose relocation has not finished. */
	getPendingMoves(workspaceFolder: URI): readonly IBaseHalfMovedItem[];
	/**
	 * Relocation reports the outcome of a move: `done` when the card
	 * information is at the new path, `kept` when the old path names an item
	 * again and nothing moved, `gone` when the new path names nothing any
	 * more, so that the item can be paired again, and `held` when unsaved
	 * changes or a running node hold it back, which leaves it pending.
	 */
	acceptRelocated(workspaceFolder: URI, move: IBaseHalfMovedItem, outcome: 'done' | 'kept' | 'gone' | 'held'): void;
	/** The card information of these items is at their new paths now. */
	readonly onDidRelocate: Event<IBaseHalfRecognizedMoves>;
	/**
	 * The moves whose entries are still owed: a store could not be written
	 * yet, or the index had not seen every store. They are kept across
	 * restarts (following moved items, "Entries are always updated").
	 */
	getOwedEntryMoves(workspaceFolder: URI): readonly IBaseHalfOwedEntryMove[];
	setOwedEntryMoves(workspaceFolder: URI, moves: readonly IBaseHalfOwedEntryMove[]): void;
	/** A move through the workbench: the snapshot takes the new paths. */
	acceptWorkbenchMove(workspaceFolder: URI, from: string, to: string): void;
	/** A delete through the workbench: the snapshot forgets the item. */
	acceptWorkbenchDelete(workspaceFolder: URI, path: string): void;
}

/**
 * The moves that are owed after `moves` happened. Moves compose: after `a` to
 * `b` and `b` to `c`, entries that name `a` get `c`. With `owe`, the entries
 * of `moves` themselves are owed too; without it they are written, and what
 * was owed for the same old paths is not owed any more.
 */
export function baseHalfComposeOwedEntryMoves(owed: readonly IBaseHalfOwedEntryMove[], moves: readonly IBaseHalfOwedEntryMove[], owe: boolean): IBaseHalfOwedEntryMove[] {
	const next: IBaseHalfOwedEntryMove[] = [];
	for (const known of owed) {
		if (moves.some(move => move.from === known.from)) {
			continue;
		}
		// An item below what `known` moved has moved on by itself: the entries
		// that name its first path lead to its last, and go before the folder's.
		for (const move of moves) {
			if (move.from !== known.to && baseHalfIsMirrorSubtree(move.from, known.to) && !owed.some(other => other.to === move.from)) {
				const from = baseHalfRemapSubtreeRel(move.from, known.to, known.from);
				if (from !== move.to && !next.some(other => other.from === from)) {
					next.push({ from, to: move.to });
				}
			}
		}
		const later = moves.find(move => baseHalfIsMirrorSubtree(known.to, move.from));
		const composed = later ? { from: known.from, to: baseHalfRemapSubtreeRel(known.to, later.from, later.to) } : known;
		// An item that is back where it was owes nothing.
		if (composed.from !== composed.to) {
			next.push(composed);
		}
	}
	if (owe) {
		next.push(...moves.map(move => ({ from: move.from, to: move.to })));
	}
	return next.slice(-BASEHALF_MOVED_ITEMS_OWED_LIMIT);
}

interface IStoredFingerprint extends IBaseHalfFileFingerprint {
	/** The modification time the fingerprint was computed at. */
	readonly mtime: number;
}

interface IStoredSnapshot {
	readonly version: number;
	readonly paths: readonly string[];
	readonly fingerprints: Record<string, IStoredFingerprint>;
	readonly followed: Record<string, BaseHalfCanvasItemKind>;
	readonly pending: readonly IBaseHalfMovedItem[];
	readonly owed?: readonly IBaseHalfOwedEntryMove[];
}

interface IDisappeared {
	readonly at: number;
	readonly fingerprint?: IStoredFingerprint;
	/** Set when the item was followed. */
	readonly followedKind?: BaseHalfCanvasItemKind;
	/** Where the file went, once it is paired. */
	pairedTo?: string;
}

interface IAppeared {
	readonly at: number;
	/**
	 * What the file held when it appeared, noted when that was the content of
	 * a file that had just been removed. An agent often rewrites a file right
	 * after renaming it, and by the time the folder is quiet nothing of the old
	 * content may be left.
	 */
	held?: { readonly size: number; readonly hash: string };
}

class FolderSnapshot {
	/** Every file the canvas could show, by comparison key. */
	readonly paths = new Map<string, string>();
	readonly fingerprints = new Map<string, IStoredFingerprint>();
	readonly followed = new Map<string, BaseHalfCanvasItemKind>();
	pending: IBaseHalfMovedItem[] = [];
	/** The pending moves that unsaved changes or a running node hold back. */
	readonly held = new Set<string>();
	/** The moves that were relocated in the last window. */
	recent: { readonly move: IBaseHalfMovedItem; readonly at: number }[] = [];
	owed: IBaseHalfOwedEntryMove[] = [];

	/** While running: what file events removed and added in the last window. */
	readonly disappeared = new Map<string, IDisappeared>();
	readonly appeared = new Map<string, IAppeared>();
	readonly appearedFolders = new Map<string, number>();
	/**
	 * When the last comparison of these lists began. What appeared before it
	 * was seen next to what was still there then, as an item of its own.
	 */
	comparedAt = 0;
	/** A pair whose new path was just removed waits for the comparison that decides where it went. */
	goneDeferred = false;
	/** Files that changed and need a new fingerprint. */
	readonly changed = new Set<string>();
	/** Card information changed on disk: the followed set has to be collected again. */
	followedChanged = false;

	readonly compared = new DeferredPromise<void>();
	loaded = false;
	disposed = false;
	comparing = 0;
	/** Entry updates in progress that keep the folder from being settled. */
	holds = 0;
	firstEventAt: number | undefined;
	scheduler: RunOnceScheduler | undefined;
	saver: RunOnceScheduler | undefined;
	queue: Promise<void> = Promise.resolve();

	constructor(readonly folder: URI, readonly caseSensitive: boolean) { }

	key(path: string): string {
		return this.caseSensitive ? path : path.normalize('NFC').toLowerCase();
	}

	has(path: string): boolean {
		return this.paths.has(this.key(path));
	}

	/** The folders that hold a file of the snapshot. */
	folders(): Set<string> {
		const folders = new Set<string>();
		for (const path of this.paths.values()) {
			addAncestors(folders, path);
		}
		return folders;
	}
}

function addAncestors(folders: Set<string>, path: string): void {
	let end = path.lastIndexOf('/');
	while (end > 0) {
		const folder = path.slice(0, end);
		if (folders.has(folder)) {
			return;
		}
		folders.add(folder);
		end = folder.lastIndexOf('/');
	}
}

export class BaseHalfMovedItemsService extends Disposable implements IBaseHalfMovedItemsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidRecognize = this._register(new Emitter<IBaseHalfRecognizedMoves>());
	readonly onDidRecognize = this._onDidRecognize.event;
	private readonly _onDidChangeComparing = this._register(new Emitter<URI>());
	readonly onDidChangeComparing = this._onDidChangeComparing.event;
	private readonly _onDidRelocate = this._register(new Emitter<IBaseHalfRecognizedMoves>());
	readonly onDidRelocate = this._onDidRelocate.event;
	/** Fires when {@link isSettled} may have changed for a workspace folder. */
	private readonly _onDidChangeSettled = this._register(new Emitter<void>());

	private readonly folders = new Map<string, FolderSnapshot>();
	private readonly limiter = this._register(new Limiter<void>(READ_CONCURRENCY));

	constructor(
		private readonly timing: IBaseHalfMovedItemsTiming,
		@IFileService private readonly fileService: IFileService,
		@ISearchService private readonly searchService: Pick<ISearchService, 'fileSearch'>,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: Pick<IEnvironmentService, 'workspaceStorageHome'>,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: Pick<IBaseHalfCanvasMirrorService, 'readCanvas'>,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: Pick<IBaseHalfReferenceIndexService, 'getState' | 'getStores' | 'onDidChange'>,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(this.contextService.onDidChangeWorkspaceFolders(event => {
			for (const removed of event.removed) {
				this.close(removed.uri);
			}
			for (const added of event.added) {
				this.open(added.uri);
			}
		}));
		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
		this._register(this.fileService.onDidWatchError(() => {
			for (const state of this.folders.values()) {
				void this.compare(state.folder);
			}
		}));
		// An item that only an entry names is followed once the index knows the entries.
		this._register(this.referenceIndexService.onDidChange(event => {
			const state = this.folders.get(event.workspaceFolder.toString());
			if (state?.loaded && (event.state === 'ready' || event.state === 'partial')) {
				this.enqueue(state, () => this.refreshFollowed(state));
			}
		}));
		for (const folder of this.contextService.getWorkspace().folders) {
			this.open(folder.uri);
		}
	}

	override dispose(): void {
		for (const state of this.folders.values()) {
			this.disposeState(state);
		}
		this.folders.clear();
		super.dispose();
	}

	//#region Interface

	isComparing(workspaceFolder: URI): boolean {
		return (this.folders.get(workspaceFolder.toString())?.comparing ?? 0) > 0;
	}

	async whenCompared(workspaceFolder: URI, timeoutMs?: number): Promise<void> {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state) {
			return;
		}
		await (timeoutMs === undefined ? state.compared.p : Promise.race([state.compared.p, timeout(timeoutMs)]));
	}

	isSettled(workspaceFolder: URI, shownFolder?: string): boolean {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state) {
			return true;
		}
		if (!state.compared.isSettled || state.holds > 0) {
			return false;
		}
		// A card in the folder, or the folder that is shown: itself, or below what moved.
		const shown = (path: string) => shownFolder === undefined || parentOf(path) === shownFolder || baseHalfIsMirrorSubtree(shownFolder, path);
		if (state.pending.some(move => !state.held.has(moveKey(move)) && (shown(move.from) || shown(move.to)))) {
			return false;
		}
		// A comparison while BaseHalf runs is deciding about what file events removed,
		// from the first of them until it has reported.
		return state.comparing === 0 || ![...state.disappeared].some(([path, item]) => item.pairedTo === undefined && shown(path));
	}

	async whenSettled(workspaceFolder: URI, timeoutMs: number, shownFolder?: string): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!this.isSettled(workspaceFolder, shownFolder)) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return;
			}
			const timer = timeout(remaining);
			const changed = Event.toPromise(this._onDidChangeSettled.event);
			try {
				await Promise.race([changed, timer]);
			} finally {
				timer.cancel();
				changed.cancel();
			}
		}
	}

	isMoving(workspaceFolder: URI, path: string): boolean {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state) {
			return false;
		}
		const covers = (root: string) => baseHalfIsMirrorSubtree(path, root);
		return state.pending.some(move => !state.held.has(moveKey(move)) && (covers(move.from) || covers(move.to)))
			|| (state.comparing > 0 && [...state.disappeared].some(([gone, item]) => item.pairedTo === undefined && covers(gone)));
	}

	resolveMovedPath(workspaceFolder: URI, path: string): string | undefined {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state) {
			return undefined;
		}
		const now = Date.now();
		state.recent = state.recent.filter(recent => now - recent.at <= this.timing.windowMs);
		const moves = [...state.recent.map(recent => recent.move), ...state.pending];
		// A path that names an item, again or still, is that item's path.
		if (moves.length === 0 || state.has(path) || [...state.paths.values()].some(known => known.startsWith(`${path}/`))) {
			return undefined;
		}
		// An item that moved more than once is where its last move took it.
		let current = path;
		for (let step = 0; step < moves.length; step++) {
			const next = baseHalfMovedItemPath(moves, current);
			if (next === undefined || next === path) {
				break;
			}
			current = next;
		}
		return current === path ? undefined : current;
	}

	holdSettled(workspaceFolder: URI): IDisposable {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state) {
			return Disposable.None;
		}
		state.holds++;
		return toDisposable(() => {
			state.holds = Math.max(0, state.holds - 1);
			this._onDidChangeSettled.fire();
		});
	}

	compare(workspaceFolder: URI): Promise<void> {
		const state = this.folders.get(workspaceFolder.toString());
		return state ? this.enqueue(state, () => this.compareWithDisk(state)) : Promise.resolve();
	}

	getPendingMoves(workspaceFolder: URI): readonly IBaseHalfMovedItem[] {
		return this.folders.get(workspaceFolder.toString())?.pending ?? [];
	}

	getOwedEntryMoves(workspaceFolder: URI): readonly IBaseHalfOwedEntryMove[] {
		return this.folders.get(workspaceFolder.toString())?.owed ?? [];
	}

	setOwedEntryMoves(workspaceFolder: URI, moves: readonly IBaseHalfOwedEntryMove[]): void {
		const state = this.folders.get(workspaceFolder.toString());
		if (state?.loaded) {
			state.owed = moves.slice(-BASEHALF_MOVED_ITEMS_OWED_LIMIT);
			this.scheduleSave(state);
		}
	}

	acceptRelocated(workspaceFolder: URI, move: IBaseHalfMovedItem, outcome: 'done' | 'kept' | 'gone' | 'held'): void {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state) {
			return;
		}
		if (outcome === 'held') {
			state.held.add(moveKey(move));
			this._onDidChangeSettled.fire();
			return;
		}
		const below = (path: string) => baseHalfIsMirrorSubtree(path, move.to);
		if (outcome === 'gone' && [...state.disappeared].some(([path, item]) => item.pairedTo === undefined && item.at >= state.comparedAt && below(path))) {
			// File events have just removed the new path, and the comparison that
			// decides where it went has not run. The pair waits for it: when the
			// item is found again, the pair leads there.
			state.goneDeferred = true;
			this.schedule(state);
			return;
		}
		state.held.delete(moveKey(move));
		state.pending = state.pending.filter(pending => pending.from !== move.from || pending.to !== move.to);
		if (outcome === 'done') {
			// A pair that was recognized while this one was on its way starts where
			// the card information is now.
			const before = state.pending;
			state.pending = state.pending.flatMap(pending => {
				if (!baseHalfIsMirrorSubtree(pending.from, move.from)) {
					return [pending];
				}
				state.held.delete(moveKey(pending));
				const from = baseHalfRemapSubtreeRel(pending.from, move.from, move.to);
				return from === pending.to ? [] : [{ ...pending, from }];
			});
			const restarted = state.pending.some((pending, index) => pending !== before[index]);
			// The entries that name the old path are owed until they are written.
			// They are kept with the snapshot, so that they outlive the window. A
			// window that closes before the snapshot is saved finds the move again
			// at the next open.
			state.owed = baseHalfComposeOwedEntryMoves(state.owed, [move], true);
			state.recent.push({ move, at: Date.now() });
			this._onDidRelocate.fire({ workspaceFolder, moves: [move] });
			if (restarted) {
				this._onDidRecognize.fire({ workspaceFolder, moves: state.pending });
			}
		} else if (outcome === 'kept') {
			// The old path names an item again: what is followed is collected again.
			state.followedChanged = true;
			this.schedule(state);
		} else {
			// The new path is gone again: the item, and what is below it, is where
			// it was before it was paired, so that it can be paired with its final name.
			const now = Date.now();
			const back = (path: string) => baseHalfRemapSubtreeRel(path, move.to, move.from);
			// What file events already took from the new path goes back with it.
			for (const [path, item] of [...state.disappeared]) {
				if (item.pairedTo === undefined && below(path)) {
					state.disappeared.delete(path);
					state.disappeared.set(back(path), { at: now, fingerprint: item.fingerprint, followedKind: item.followedKind });
				}
			}
			for (const [path, fingerprint] of [...state.fingerprints]) {
				if (below(path)) {
					state.fingerprints.delete(path);
					state.disappeared.set(back(path), { at: now, fingerprint, followedKind: state.followed.get(path) });
				}
			}
			for (const [path, kind] of [...state.followed]) {
				if (below(path)) {
					state.followed.delete(path);
					const known = state.disappeared.get(back(path));
					if (!known || known.pairedTo !== undefined) {
						state.disappeared.set(back(path), { at: now, fingerprint: known?.fingerprint, followedKind: kind });
					}
				}
			}
			// The entry that said where the item went is no longer true.
			const own = state.disappeared.get(move.from);
			if (!own || own.pairedTo !== undefined) {
				state.disappeared.set(move.from, { at: now, fingerprint: own?.fingerprint, followedKind: move.kind });
			}
			for (const [key, path] of [...state.paths]) {
				if (below(path)) {
					state.paths.delete(key);
				}
			}
			this.schedule(state);
		}
		this._onDidChangeSettled.fire();
		this.scheduleSave(state);
	}

	acceptWorkbenchMove(workspaceFolder: URI, from: string, to: string): void {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state?.loaded) {
			return;
		}
		const kind = state.followed.get(from) ?? 'file';
		this.remap(state, from, to);
		for (const path of [...state.disappeared.keys()]) {
			if (baseHalfIsMirrorSubtree(path, from)) {
				state.disappeared.delete(path);
			}
		}
		// An item whose relocation is still pending was moved on through the workbench.
		const pending = state.pending;
		this.composePending(state, { from, to, kind, rule: 'sameContent' }, false);
		if (state.pending !== pending && state.pending.length > 0) {
			this._onDidRecognize.fire({ workspaceFolder, moves: state.pending });
		}
		this.endComparisonWithNothingLeft(state);
		this._onDidChangeSettled.fire();
		this.scheduleSave(state);
	}

	acceptWorkbenchDelete(workspaceFolder: URI, path: string): void {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state?.loaded) {
			return;
		}
		this.forget(state, path);
		for (const known of [...state.disappeared.keys()]) {
			if (baseHalfIsMirrorSubtree(known, path)) {
				state.disappeared.delete(known);
			}
		}
		this.endComparisonWithNothingLeft(state);
		this.scheduleSave(state);
	}

	/**
	 * The file events of a workbench move or delete can arrive before the
	 * operation reports here. What they removed then waited for a comparison;
	 * with nothing left to pair, that wait ends now, so the canvas is not held.
	 */
	private endComparisonWithNothingLeft(state: FolderSnapshot): void {
		if (state.firstEventAt === undefined || [...state.disappeared.values()].some(item => item.pairedTo === undefined)) {
			return;
		}
		state.firstEventAt = undefined;
		this.setComparing(state, -1);
	}

	//#endregion

	//#region Folders

	private open(folder: URI): void {
		const key = folder.toString();
		if (this.folders.has(key)) {
			return;
		}
		const state = new FolderSnapshot(folder, this.fileService.hasCapability(folder, FileSystemProviderCapabilities.PathCaseSensitive));
		this.folders.set(key, state);
		this.setComparing(state, 1);
		void this.enqueue(state, () => this.compareAtOpen(state)).finally(() => {
			state.compared.complete();
			this.setComparing(state, -1);
		});
	}

	private close(folder: URI): void {
		const state = this.folders.get(folder.toString());
		if (state) {
			this.folders.delete(folder.toString());
			this.disposeState(state);
		}
	}

	private disposeState(state: FolderSnapshot): void {
		state.disposed = true;
		state.scheduler?.dispose();
		state.saver?.dispose();
		state.compared.complete();
	}

	/** Runs `task` after the tasks already queued for the folder. It never rejects. */
	private enqueue(state: FolderSnapshot, task: () => Promise<void>): Promise<void> {
		const run = state.queue.then(async () => {
			if (state.disposed) {
				return;
			}
			try {
				await task();
			} catch (error) {
				this.logService.warn('[BaseHalf] could not compare the workspace folder with what was last seen', error);
			}
		});
		state.queue = run;
		return run;
	}

	private setComparing(state: FolderSnapshot, change: 1 | -1): void {
		const before = state.comparing > 0;
		state.comparing = Math.max(0, state.comparing + change);
		if (before !== state.comparing > 0) {
			this._onDidChangeComparing.fire(state.folder);
			this._onDidChangeSettled.fire();
		}
	}

	//#endregion

	//#region Comparing

	private async compareAtOpen(state: FolderSnapshot): Promise<void> {
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, state.folder)) {
			return;
		}
		const stored = await this.load(state);
		if (stored) {
			for (const path of stored.paths) {
				state.paths.set(state.key(path), path);
			}
			for (const [path, fingerprint] of Object.entries(stored.fingerprints)) {
				state.fingerprints.set(path, fingerprint);
			}
			for (const [path, kind] of Object.entries(stored.followed)) {
				state.followed.set(path, kind);
			}
			state.pending = [...stored.pending];
			state.owed = [...stored.owed ?? []];
		}
		state.loaded = true;
		if (state.pending.length > 0) {
			// Relocation that did not finish is tried again before anything else.
			this._onDidRecognize.fire({ workspaceFolder: state.folder, moves: state.pending });
		}
		await this.compareWithDisk(state, stored === undefined);
	}

	/**
	 * Lists the folder and compares it with the snapshot: everything that
	 * changed since is one comparison. `first` is the taking of a snapshot
	 * where there was none, which recognizes nothing.
	 */
	private async compareWithDisk(state: FolderSnapshot, first = false): Promise<void> {
		if (!state.loaded) {
			return;
		}
		const listing = await this.list(state);
		if (!listing) {
			this.logService.info(`[BaseHalf] ${state.folder.toString()} has more than ${BASEHALF_MOVED_ITEMS_ITEM_LIMIT} items; moved items are not recognized there`);
			state.paths.clear();
			state.fingerprints.clear();
			state.followed.clear();
			return;
		}
		const now = new Map<string, string>();
		for (const path of listing) {
			now.set(state.key(path), path);
		}

		const moves: IBaseHalfMovedItem[] = [];
		if (!first) {
			const beforeFolders = state.folders();
			// The same path under another spelling is the same path.
			for (const [key, path] of [...state.paths]) {
				const current = now.get(key);
				if (current !== undefined && current !== path) {
					this.remap(state, path, current);
				}
			}
			const disappeared: IBaseHalfFollowedItem[] = [];
			for (const [path, kind] of state.followed) {
				if (kind === 'file' ? !now.has(state.key(path)) : !(await this.exists(state, path, 'folder'))) {
					disappeared.push({ path, kind });
				}
			}
			const disappearedFingerprints = new Map<string, IBaseHalfFileFingerprint>();
			for (const [path, fingerprint] of state.fingerprints) {
				if (!now.has(state.key(path))) {
					disappearedFingerprints.set(path, fingerprint);
				}
			}
			// What file events removed and added since is part of this comparison too:
			// the listing replaces the lists, and nothing on them may be dropped unpaired.
			this.prune(state, Date.now());
			for (const [path, item] of state.disappeared) {
				if (item.pairedTo !== undefined || now.has(state.key(path))) {
					continue;
				}
				if (item.fingerprint) {
					disappearedFingerprints.set(path, item.fingerprint);
				}
				if (item.followedKind && !disappeared.some(known => known.path === path)) {
					disappeared.push({ path, kind: item.followedKind });
				}
			}
			if (disappeared.length > 0 || disappearedFingerprints.size > 0) {
				const appeared = listing.filter(path => !state.has(path) || state.appeared.has(path));
				const nowFolders = new Set<string>();
				for (const path of listing) {
					addAncestors(nowFolders, path);
				}
				moves.push(...await this.recognize(state, {
					disappeared,
					disappearedFingerprints,
					appeared,
					earlier: this.seenEarlier(state),
					appearedFolders: new Set([...nowFolders].filter(folder => !beforeFolders.has(folder))),
					earlierPairs: undefined
				}));
			}
			// What was not paired is deleted, as far as BaseHalf is concerned.
			for (const item of disappeared) {
				if (!moves.some(move => move.from === item.path || (move.kind === 'folder' && baseHalfIsMirrorSubtree(item.path, move.from)))) {
					this.forget(state, item.path);
				}
			}
		}
		for (const move of moves) {
			this.remap(state, move.from, move.to);
		}
		for (const path of [...state.fingerprints.keys()]) {
			if (!now.has(state.key(path))) {
				state.fingerprints.delete(path);
			}
		}
		state.paths.clear();
		for (const [key, path] of now) {
			state.paths.set(key, path);
		}
		state.disappeared.clear();
		state.appeared.clear();
		state.appearedFolders.clear();
		this.report(state, moves);
		await this.refreshFollowed(state);
	}

	/** The comparison while BaseHalf runs: what file events removed against what they added. */
	private async compareLists(state: FolderSnapshot): Promise<void> {
		const now = Date.now();
		const earlier = this.seenEarlier(state);
		state.comparedAt = now;
		this.prune(state, now);

		const disappeared: IBaseHalfFollowedItem[] = [];
		const disappearedFingerprints = new Map<string, IBaseHalfFileFingerprint>();
		const earlierPairs = new Map<string, string>();
		for (const [path, item] of state.disappeared) {
			if (item.fingerprint) {
				disappearedFingerprints.set(path, item.fingerprint);
			}
			if (item.pairedTo !== undefined) {
				earlierPairs.set(path, item.pairedTo);
			} else if (item.followedKind) {
				disappeared.push({ path, kind: item.followedKind });
			}
		}
		if (disappeared.length === 0 && [...disappearedFingerprints.keys()].every(path => earlierPairs.has(path))) {
			this.retryDeferred(state);
			return;
		}
		const moves = await this.recognize(state, {
			disappeared,
			disappearedFingerprints,
			appeared: [...state.appeared.keys()],
			earlier,
			appearedFolders: new Set(state.appearedFolders.keys()),
			earlierPairs
		});
		for (const move of moves) {
			this.remap(state, move.from, move.to, true);
			if (move.kind === 'file') {
				// It stays on the list as paired, and still counts for its folder.
				const item = state.disappeared.get(move.from);
				if (item) {
					item.pairedTo = move.to;
				}
				state.appeared.delete(move.to);
				continue;
			}
			// What is below a paired folder moved along with it.
			state.disappeared.delete(move.from);
			for (const [path, item] of state.disappeared) {
				if (baseHalfIsMirrorSubtree(path, move.from)) {
					item.pairedTo ??= baseHalfRemapSubtreeRel(path, move.from, move.to);
				}
			}
			for (const path of [...state.appeared.keys()]) {
				if (baseHalfIsMirrorSubtree(path, move.to)) {
					state.appeared.delete(path);
				}
			}
			state.appearedFolders.delete(move.to);
		}
		this.report(state, moves);
		this.retryDeferred(state);
	}

	/** A pair that waited for this comparison because its new path was gone is tried again. */
	private retryDeferred(state: FolderSnapshot): void {
		if (state.goneDeferred) {
			state.goneDeferred = false;
			if (state.pending.length > 0) {
				this._onDidRecognize.fire({ workspaceFolder: state.folder, moves: state.pending });
			}
		}
	}

	/** Takes what has been on the lists for longer than the window off them. */
	private prune(state: FolderSnapshot, now: number): void {
		for (const [path, appeared] of [...state.appeared]) {
			if (now - appeared.at > this.timing.windowMs) {
				state.appeared.delete(path);
			}
		}
		for (const [path, added] of [...state.appearedFolders]) {
			if (now - added > this.timing.windowMs) {
				state.appearedFolders.delete(path);
			}
		}
		for (const [path, item] of [...state.disappeared]) {
			if (now - item.at > this.timing.windowMs) {
				// Not paired in its window: deleted, as far as BaseHalf is concerned.
				state.disappeared.delete(path);
				if (item.pairedTo === undefined) {
					state.followed.delete(path);
				}
			}
		}
	}

	/** The files on the list of what appeared that an earlier comparison already saw. */
	private seenEarlier(state: FolderSnapshot): Set<string> {
		const earlier = new Set<string>();
		for (const [path, appeared] of state.appeared) {
			if (appeared.at < state.comparedAt) {
				earlier.add(path);
			}
		}
		return earlier;
	}

	private async recognize(state: FolderSnapshot, input: {
		readonly disappeared: readonly IBaseHalfFollowedItem[];
		readonly disappearedFingerprints: ReadonlyMap<string, IBaseHalfFileFingerprint>;
		readonly appeared: readonly string[];
		readonly earlier: ReadonlySet<string>;
		readonly appearedFolders: ReadonlySet<string>;
		readonly earlierPairs: ReadonlyMap<string, string> | undefined;
	}): Promise<IBaseHalfMovedItem[]> {
		const appearedFiles: { path: string; size: number; earlier: boolean }[] = [];
		await Promise.all(input.appeared.map(path => this.limiter.queue(async () => {
			try {
				const stat = await this.fileService.stat(this.resource(state, path));
				if (stat.isFile && !stat.isSymbolicLink) {
					// Rule 1 goes by what the file held when it appeared, if that was noted.
					appearedFiles.push({ path, size: state.appeared.get(path)?.held?.size ?? stat.size, earlier: input.earlier.has(path) });
				}
			} catch {
				// Gone again: not a candidate.
			}
		})));
		appearedFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
		const present: IBaseHalfFileFingerprint[] = [];
		for (const [path, fingerprint] of state.fingerprints) {
			if (!input.disappearedFingerprints.has(path)) {
				present.push(fingerprint);
			}
		}
		return baseHalfRecognizeMovedItems({
			disappeared: input.disappeared,
			disappearedFingerprints: input.disappearedFingerprints,
			appearedFiles,
			appearedFolders: input.appearedFolders,
			earlierPairs: input.earlierPairs,
			presentFingerprints: present,
			fingerprint: async (path, withPieces) => {
				const held = withPieces ? undefined : state.appeared.get(path)?.held;
				return held ?? this.fingerprint(state, path, withPieces);
			}
		});
	}

	private report(state: FolderSnapshot, moves: readonly IBaseHalfMovedItem[]): void {
		if (moves.length === 0) {
			return;
		}
		this.logService.info(`[BaseHalf] items moved outside BaseHalf: ${moves.map(move => `${move.from} -> ${move.to} (${move.rule})`).join(', ')}`);
		for (const move of moves) {
			this.composePending(state, move, true);
		}
		this.scheduleSave(state);
		this._onDidChangeSettled.fire();
		if (state.pending.length > 0) {
			this._onDidRecognize.fire({ workspaceFolder: state.folder, moves: state.pending });
		}
	}

	/**
	 * Takes a move into the pending pairs. An item whose relocation is still
	 * pending and that moved again is one pair, from where its card information
	 * is to where the item is now. With `own`, a move that no pending pair
	 * covers becomes a pair itself.
	 */
	private composePending(state: FolderSnapshot, move: IBaseHalfMovedItem, own: boolean): void {
		let covered = false;
		let changed = false;
		const next: IBaseHalfMovedItem[] = [];
		for (const pending of state.pending) {
			if (baseHalfIsMirrorSubtree(pending.to, move.from)) {
				// The item of a pending pair, or a folder above it, moved on.
				covered ||= pending.to === move.from;
				changed = true;
				state.held.delete(moveKey(pending));
				const to = baseHalfRemapSubtreeRel(pending.to, move.from, move.to);
				// Back where it was: its card information never left, and nothing is left to do.
				if (to !== pending.from) {
					next.push({ ...pending, to });
				}
				continue;
			}
			if (baseHalfIsMirrorSubtree(move.from, pending.to)) {
				// An item below a folder whose relocation is pending moved by itself. Its
				// card information is still below the folder's old path, and goes first.
				covered = true;
				const from = baseHalfRemapSubtreeRel(move.from, pending.to, pending.from);
				if (from !== move.to && !next.some(known => known.from === from)) {
					next.push({ ...move, from });
					changed = true;
				}
			}
			next.push(pending);
		}
		if (own && !covered) {
			const known = next.findIndex(pending => pending.from === move.from);
			if (known !== -1) {
				next.splice(known, 1);
			}
			next.push(move);
			changed = true;
		}
		if (changed) {
			state.pending = next;
		}
	}

	//#endregion

	//#region File events

	private onDidFilesChange(event: FileChangesEvent): void {
		for (const state of this.folders.values()) {
			if (!state.loaded || state.disposed) {
				continue;
			}
			const owned = (resources: readonly URI[]) => resources.filter(resource => this.contextService.getWorkspaceFolder(resource)?.uri.toString() === state.folder.toString());
			const added = owned(event.rawAdded);
			const deleted = owned(event.rawDeleted);
			const updated = owned(event.rawUpdated);
			if (added.length + deleted.length + updated.length === 0) {
				continue;
			}
			if (added.length + deleted.length + updated.length > BASEHALF_MOVED_ITEMS_RESCAN_THRESHOLD) {
				void this.compare(state.folder);
				continue;
			}
			let relevant = false;
			const now = Date.now();
			// An item becomes followed when card information is written for it.
			if ([...added, ...updated, ...deleted].some(resource => getRelativePath(state.folder, resource)?.startsWith('.bh/mirror/'))) {
				state.followedChanged = true;
				relevant = true;
			}
			for (const resource of deleted) {
				const path = getRelativePath(state.folder, resource);
				if (path) {
					relevant = this.removed(state, path, now) || relevant;
				}
			}
			for (const resource of updated) {
				const path = getRelativePath(state.folder, resource);
				if (path && state.fingerprints.has(path)) {
					state.changed.add(path);
					relevant = true;
				}
			}
			if (added.length > 0) {
				// An added folder is listed: its files may have no events of their own.
				relevant = true;
				void this.enqueue(state, async () => {
					for (const resource of added) {
						const path = getRelativePath(state.folder, resource);
						if (path) {
							await this.added(state, path, now);
						}
					}
				});
			}
			if (relevant) {
				this.schedule(state);
			}
			if (added.length + deleted.length > 0) {
				void this.enqueue(state, () => this.noteArrivals(state));
			}
		}
	}

	/**
	 * Notes what the files that just appeared hold, for those with the content
	 * of a file that was just removed: an agent often rewrites a file right
	 * after renaming it, and by the time the folder is quiet nothing of the old
	 * content may be left. The comparison pairs by what was noted, under rule 1
	 * as for any files with the same content.
	 */
	private async noteArrivals(state: FolderSnapshot): Promise<void> {
		const open = [...state.disappeared.values()].filter(item => item.fingerprint && item.pairedTo === undefined);
		if (open.length === 0 || state.appeared.size === 0 || state.appeared.size > ARRIVAL_NOTE_LIMIT) {
			return;
		}
		for (const [path, appeared] of [...state.appeared]) {
			if (appeared.held) {
				continue;
			}
			let size: number;
			try {
				const stat = await this.fileService.stat(this.resource(state, path));
				if (!stat.isFile || stat.isSymbolicLink) {
					continue;
				}
				size = stat.size;
			} catch {
				continue;
			}
			if (!open.some(item => item.fingerprint!.size === size)) {
				continue;
			}
			const hash = (await this.fingerprint(state, path, false))?.hash;
			// The entry may have left the list while the file was read.
			if (hash !== undefined && state.appeared.get(path) === appeared && open.some(item => item.fingerprint!.size === size && item.fingerprint!.hash === hash)) {
				appeared.held = { size, hash };
			}
		}
	}

	/** A path was removed, with everything below it. Returns whether BaseHalf could recognize any of it. */
	private removed(state: FolderSnapshot, path: string, at: number): boolean {
		let recognizable = false;
		for (const [key, known] of [...state.paths]) {
			if (baseHalfIsMirrorSubtree(known, path)) {
				state.paths.delete(key);
				state.appeared.delete(known);
				const fingerprint = state.fingerprints.get(known);
				const followedKind = state.followed.get(known);
				if (fingerprint || followedKind) {
					state.disappeared.set(known, { at, fingerprint, followedKind });
					recognizable = true;
				}
				state.fingerprints.delete(known);
			}
		}
		for (const [known, kind] of state.followed) {
			if (kind === 'folder' && baseHalfIsMirrorSubtree(known, path) && !state.disappeared.has(known)) {
				state.disappeared.set(known, { at, followedKind: 'folder' });
				recognizable = true;
			}
		}
		for (const folder of [...state.appearedFolders.keys()]) {
			if (baseHalfIsMirrorSubtree(folder, path)) {
				state.appearedFolders.delete(folder);
			}
		}
		if (recognizable && state.firstEventAt === undefined) {
			state.firstEventAt = at;
			this.setComparing(state, 1);
		}
		return recognizable;
	}

	private async added(state: FolderSnapshot, path: string, at: number): Promise<void> {
		if (!this.isEligible(state, path, false) && !this.isEligible(state, path, true)) {
			return;
		}
		const files: string[] = [];
		const stack = [path];
		while (stack.length > 0 && files.length <= BASEHALF_MOVED_ITEMS_RESCAN_THRESHOLD) {
			const current = stack.pop()!;
			try {
				const stat = await this.fileService.resolve(this.resource(state, current));
				if (stat.isSymbolicLink) {
					continue;
				}
				if (stat.isFile) {
					files.push(current);
				}
				for (const child of stat.children ?? []) {
					if (!child.isSymbolicLink) {
						stack.push(`${current}/${child.name}`);
					}
				}
			} catch {
				// Gone again.
			}
		}
		const folders = state.folders();
		for (const file of files) {
			if (!this.isEligible(state, file, false)) {
				continue;
			}
			// A path that is there again did not disappear: a file that was
			// renamed to a backup name and written again has not moved.
			const back = state.disappeared.get(file);
			if (back && back.pairedTo === undefined) {
				state.disappeared.delete(file);
				if (back.followedKind) {
					state.followed.set(file, back.followedKind);
				}
				state.changed.add(file);
			} else if (!state.has(file)) {
				state.appeared.set(file, { at });
				const before = new Set(folders);
				addAncestors(folders, file);
				for (const folder of folders) {
					if (!before.has(folder)) {
						state.appearedFolders.set(folder, at);
					}
				}
			}
			state.paths.set(state.key(file), file);
		}
	}

	private schedule(state: FolderSnapshot): void {
		if (!state.scheduler) {
			state.scheduler = new RunOnceScheduler(() => {
				const waited = state.firstEventAt !== undefined;
				state.firstEventAt = undefined;
				void this.enqueue(state, async () => {
					await this.compareLists(state);
					await this.refreshChanged(state);
					if (state.followedChanged) {
						state.followedChanged = false;
						await this.refreshFollowed(state);
					}
				}).finally(() => {
					if (waited) {
						this.setComparing(state, -1);
					}
				});
			}, this.timing.quietMs);
		}
		const waited = state.firstEventAt === undefined ? 0 : Date.now() - state.firstEventAt;
		state.scheduler.schedule(Math.max(0, Math.min(this.timing.quietMs, this.timing.maxWaitMs - waited)));
	}

	//#endregion

	//#region The followed set and its fingerprints

	/**
	 * Collects the followed items and brings their fingerprints up to date:
	 * every followed file, and the first files below each followed folder.
	 */
	private async refreshFollowed(state: FolderSnapshot): Promise<void> {
		const candidates = await this.collectFollowed(state);
		const followed = new Map<string, BaseHalfCanvasItemKind>();
		for (const path of candidates) {
			if (state.has(path)) {
				followed.set(state.paths.get(state.key(path))!, 'file');
			} else if (await this.exists(state, path, 'folder')) {
				followed.set(path, 'folder');
			}
		}
		// The card information of an item that was just recognized is still at
		// its old path: the item stays followed until relocation reports back.
		for (const move of state.pending) {
			for (const [path, kind] of state.followed) {
				if (baseHalfIsMirrorSubtree(path, move.to) && !followed.has(path)) {
					followed.set(path, kind);
				}
			}
		}
		state.followed.clear();
		for (const [path, kind] of followed) {
			state.followed.set(path, kind);
		}

		const targets = new Set<string>();
		const sorted = [...state.paths.values()].sort();
		for (const [path, kind] of followed) {
			if (kind === 'file') {
				targets.add(path);
				continue;
			}
			let count = 0;
			for (const file of sorted) {
				if (count >= BASEHALF_MOVED_ITEMS_FOLDER_FILE_LIMIT) {
					break;
				}
				if (file !== path && baseHalfIsMirrorSubtree(file, path)) {
					targets.add(file);
					count++;
				}
			}
		}
		for (const path of [...state.fingerprints.keys()]) {
			if (!targets.has(path)) {
				state.fingerprints.delete(path);
			}
		}
		await Promise.all([...targets].map(path => this.limiter.queue(() => this.refreshFingerprint(state, path))));
		this.scheduleSave(state);
	}

	private async refreshChanged(state: FolderSnapshot): Promise<void> {
		const changed = [...state.changed];
		state.changed.clear();
		await Promise.all(changed.filter(path => state.fingerprints.has(path) || state.followed.get(path) === 'file').map(path => this.limiter.queue(() => this.refreshFingerprint(state, path))));
		if (changed.length > 0) {
			this.scheduleSave(state);
		}
	}

	/** Computes the fingerprint again when the file's size or modification time differs. */
	private async refreshFingerprint(state: FolderSnapshot, path: string): Promise<void> {
		try {
			const stat = await this.fileService.stat(this.resource(state, path));
			const stored = state.fingerprints.get(path);
			if (stored && stored.size === stat.size && stored.mtime === stat.mtime) {
				return;
			}
			const fingerprint = await this.fingerprint(state, path, true);
			if (fingerprint) {
				state.fingerprints.set(path, { ...fingerprint, mtime: stat.mtime });
			} else {
				state.fingerprints.delete(path);
			}
		} catch {
			state.fingerprints.delete(path);
		}
	}

	private async fingerprint(state: FolderSnapshot, path: string, withPieces: boolean): Promise<IBaseHalfFileFingerprint | undefined> {
		const resource = this.resource(state, path);
		try {
			const stat = await this.fileService.stat(resource);
			if (!stat.isFile || stat.isSymbolicLink) {
				return undefined;
			}
			return await baseHalfComputeFileFingerprint({
				size: stat.size,
				read: async (position, length) => (await this.fileService.readFile(resource, { position, length })).value
			}, withPieces);
		} catch {
			return undefined;
		}
	}

	/**
	 * The paths that have card information: a file under `.bh/mirror/<path>/`,
	 * a card row or an edge end in a `canvas.yaml`, or an entry that names them.
	 */
	private async collectFollowed(state: FolderSnapshot): Promise<Set<string>> {
		const candidates = new Set<string>();
		const stack: { resource: URI; relativePath: string }[] = [{ resource: baseHalfMirrorRoot(state.folder), relativePath: '' }];
		while (stack.length > 0) {
			const current = stack.pop()!;
			let children;
			try {
				children = (await this.fileService.resolve(current.resource)).children ?? [];
			} catch {
				continue;
			}
			for (const child of children) {
				if (child.isSymbolicLink) {
					continue;
				}
				if (child.isDirectory) {
					stack.push({ resource: child.resource, relativePath: current.relativePath ? `${current.relativePath}/${child.name}` : child.name });
					continue;
				}
				if (current.relativePath) {
					candidates.add(current.relativePath);
				}
				if (child.name === CANVAS_FILE_NAME) {
					try {
						const canvas = await this.canvasMirrorService.readCanvas({ workspaceFolder: state.folder, relativePath: current.relativePath, resource: this.resource(state, current.relativePath), source: 'api' });
						for (const card of canvas?.cards ?? []) {
							candidates.add(card.path);
						}
						for (const edge of canvas?.edges ?? []) {
							candidates.add(edge.from);
							candidates.add(edge.to);
						}
					} catch {
						// A layout that cannot be read names no cards.
					}
				}
			}
		}
		const indexState = this.referenceIndexService.getState(state.folder);
		if (indexState === 'ready' || indexState === 'partial') {
			for (const store of this.referenceIndexService.getStores(state.folder)) {
				for (const item of store.read.items) {
					if (item.path !== undefined) {
						candidates.add(item.path);
					}
				}
			}
		} else {
			// Until the index knows the entries, what was followed stays followed.
			for (const path of state.followed.keys()) {
				candidates.add(path);
			}
		}
		// An entry that is still owed names the old path: the item it will name is followed.
		for (const owed of state.owed) {
			for (const path of [...candidates]) {
				if (baseHalfIsMirrorSubtree(path, owed.from)) {
					candidates.add(baseHalfRemapSubtreeRel(path, owed.from, owed.to));
				}
			}
		}
		candidates.delete('');
		return candidates;
	}

	//#endregion

	//#region Snapshot paths

	/** Lists every file the canvas could show, or nothing when there are too many. */
	private async list(state: FolderSnapshot): Promise<string[] | undefined> {
		const query: IFileQuery = {
			type: QueryType.File,
			_reason: 'basehalfMovedItems',
			folderQueries: [{
				folder: state.folder,
				disregardIgnoreFiles: true,
				disregardGlobalIgnoreFiles: true,
				disregardParentIgnoreFiles: true,
				ignoreSymlinks: true
			}],
			excludePattern: Object.fromEntries(BASEHALF_SEARCH_EXCLUDED_DIRECTORY_NAMES.map(name => [`**/${name}`, true])),
			maxResults: BASEHALF_MOVED_ITEMS_ITEM_LIMIT + 1
		};
		const complete = await this.searchService.fileSearch(query, CancellationToken.None);
		if (complete.limitHit || complete.results.length > BASEHALF_MOVED_ITEMS_ITEM_LIMIT) {
			return undefined;
		}
		const paths: string[] = [];
		for (const match of complete.results) {
			const path = getRelativePath(state.folder, match.resource);
			if (path && this.isEligible(state, path, false) && this.contextService.getWorkspaceFolder(match.resource)?.uri.toString() === state.folder.toString()) {
				paths.push(path);
			}
		}
		return paths;
	}

	private isEligible(state: FolderSnapshot, path: string, isDirectory: boolean): boolean {
		return path !== '.bh' && !path.startsWith('.bh/') && !isBaseHalfUpstreamReservedOutput(path) && baseHalfIsCanvasEligiblePath(state.folder, path, isDirectory);
	}

	private resource(state: FolderSnapshot, path: string): URI {
		return path ? joinPath(state.folder, ...path.split('/')) : state.folder;
	}

	private async exists(state: FolderSnapshot, path: string, kind: BaseHalfCanvasItemKind): Promise<boolean> {
		try {
			const stat = await this.fileService.stat(this.resource(state, path));
			return !stat.isSymbolicLink && (kind === 'folder' ? stat.isDirectory : stat.isFile);
		} catch {
			return false;
		}
	}

	/** The snapshot takes the new path for an item and everything below it. */
	private remap(state: FolderSnapshot, from: string, to: string, keepDisappeared = false): void {
		for (const [key, path] of [...state.paths]) {
			if (baseHalfIsMirrorSubtree(path, from)) {
				state.paths.delete(key);
				const next = baseHalfRemapSubtreeRel(path, from, to);
				state.paths.set(state.key(next), next);
			}
		}
		for (const [path, fingerprint] of [...state.fingerprints]) {
			if (baseHalfIsMirrorSubtree(path, from)) {
				state.fingerprints.delete(path);
				state.fingerprints.set(baseHalfRemapSubtreeRel(path, from, to), fingerprint);
			}
		}
		for (const [path, kind] of [...state.followed]) {
			if (baseHalfIsMirrorSubtree(path, from)) {
				state.followed.delete(path);
				state.followed.set(baseHalfRemapSubtreeRel(path, from, to), kind);
			}
		}
		if (keepDisappeared) {
			// A file that was removed lost its fingerprint to the list; the new path takes it.
			for (const [path, item] of state.disappeared) {
				if (item.fingerprint && baseHalfIsMirrorSubtree(path, from)) {
					state.fingerprints.set(baseHalfRemapSubtreeRel(path, from, to), item.fingerprint);
				}
				if (item.followedKind && baseHalfIsMirrorSubtree(path, from)) {
					state.followed.set(baseHalfRemapSubtreeRel(path, from, to), item.followedKind);
				}
			}
		}
	}

	private forget(state: FolderSnapshot, path: string): void {
		for (const [key, known] of [...state.paths]) {
			if (baseHalfIsMirrorSubtree(known, path)) {
				state.paths.delete(key);
			}
		}
		for (const known of [...state.fingerprints.keys()]) {
			if (baseHalfIsMirrorSubtree(known, path)) {
				state.fingerprints.delete(known);
			}
		}
		for (const known of [...state.followed.keys()]) {
			if (baseHalfIsMirrorSubtree(known, path)) {
				state.followed.delete(known);
			}
		}
	}

	//#endregion

	//#region Storage

	/** The snapshot's own file in application storage, outside the workspace folder. */
	private storageResource(state: FolderSnapshot): URI {
		return joinPath(this.environmentService.workspaceStorageHome, this.contextService.getWorkspace().id, 'basehalf', `moved-items-${(hash(state.folder.toString()) >>> 0).toString(16)}.json`);
	}

	private async load(state: FolderSnapshot): Promise<IStoredSnapshot | undefined> {
		try {
			const stored = JSON.parse((await this.fileService.readFile(this.storageResource(state))).value.toString()) as IStoredSnapshot;
			return stored.version === SNAPSHOT_VERSION && Array.isArray(stored.paths) ? stored : undefined;
		} catch {
			// No snapshot yet, or one that cannot be read: it is taken again.
			return undefined;
		}
	}

	private scheduleSave(state: FolderSnapshot): void {
		if (!state.saver) {
			state.saver = new RunOnceScheduler(() => void this.save(state), this.timing.saveMs);
		}
		state.saver.schedule();
	}

	private async save(state: FolderSnapshot): Promise<void> {
		if (state.disposed || !state.loaded) {
			return;
		}
		const stored: IStoredSnapshot = {
			version: SNAPSHOT_VERSION,
			paths: [...state.paths.values()],
			fingerprints: Object.fromEntries(state.fingerprints),
			followed: Object.fromEntries(state.followed),
			pending: state.pending,
			owed: state.owed
		};
		try {
			await this.fileService.writeFile(this.storageResource(state), VSBuffer.fromString(JSON.stringify(stored)));
		} catch (error) {
			this.logService.warn('[BaseHalf] could not save what was last seen in the workspace folder', error);
		}
	}

	//#endregion
}

function moveKey(move: { readonly from: string; readonly to: string }): string {
	return `${move.from}\n${move.to}`;
}

function parentOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}

class DefaultBaseHalfMovedItemsService extends BaseHalfMovedItemsService {
	constructor(
		@IFileService fileService: IFileService,
		@ISearchService searchService: ISearchService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IBaseHalfCanvasMirrorService canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfReferenceIndexService referenceIndexService: IBaseHalfReferenceIndexService,
		@ILogService logService: ILogService
	) {
		super(BASEHALF_MOVED_ITEMS_TIMING, fileService, searchService, contextService, environmentService, canvasMirrorService, referenceIndexService, logService);
	}
}

registerSingleton(IBaseHalfMovedItemsService, DefaultBaseHalfMovedItemsService, InstantiationType.Delayed);
