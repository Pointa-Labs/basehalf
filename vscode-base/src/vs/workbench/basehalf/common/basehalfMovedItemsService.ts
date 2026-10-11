/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, Limiter, RunOnceScheduler, timeout } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { Disposable } from '../../../base/common/lifecycle.js';
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
import { baseHalfComputeFileFingerprint, baseHalfRecognizeMovedItems, IBaseHalfFileFingerprint, IBaseHalfFollowedItem, IBaseHalfMovedItem } from './basehalfMovedItems.js';
import { BASEHALF_SEARCH_EXCLUDED_DIRECTORY_NAMES, IBaseHalfReferenceIndexService } from './basehalfReferenceIndex.js';
import { isBaseHalfUpstreamReservedOutput } from './basehalfReferenceStore.js';

export const IBaseHalfMovedItemsService = createDecorator<IBaseHalfMovedItemsService>('baseHalfMovedItemsService');

/** A folder with more items than this gets no snapshot. */
export const BASEHALF_MOVED_ITEMS_ITEM_LIMIT = 200_000;
/** How many files below a followed folder get a fingerprint for its sake. */
export const BASEHALF_MOVED_ITEMS_FOLDER_FILE_LIMIT = 200;
/** File events for more paths than this at once are answered by listing the folder. */
export const BASEHALF_MOVED_ITEMS_RESCAN_THRESHOLD = 1000;

const CANVAS_FILE_NAME = 'canvas.yaml';
const READ_CONCURRENCY = 8;
const SNAPSHOT_VERSION = 1;

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
	/** Lists the folder and compares it with the snapshot, as at open. */
	compare(workspaceFolder: URI): Promise<void>;

	/** The recognized moves whose relocation has not finished. */
	getPendingMoves(workspaceFolder: URI): readonly IBaseHalfMovedItem[];
	/**
	 * Relocation reports the outcome of a move: `done` when the card
	 * information is at the new path, `gone` when the new path names nothing
	 * any more, so that the item can be paired again.
	 */
	acceptRelocated(workspaceFolder: URI, move: IBaseHalfMovedItem, outcome: 'done' | 'gone'): void;
	/** A move through the workbench: the snapshot takes the new paths. */
	acceptWorkbenchMove(workspaceFolder: URI, from: string, to: string): void;
	/** A delete through the workbench: the snapshot forgets the item. */
	acceptWorkbenchDelete(workspaceFolder: URI, path: string): void;
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
}

interface IDisappeared {
	readonly at: number;
	readonly fingerprint?: IStoredFingerprint;
	/** Set when the item was followed. */
	readonly followedKind?: BaseHalfCanvasItemKind;
	/** Where the file went, once it is paired. */
	pairedTo?: string;
}

class FolderSnapshot {
	/** Every file the canvas could show, by comparison key. */
	readonly paths = new Map<string, string>();
	readonly fingerprints = new Map<string, IStoredFingerprint>();
	readonly followed = new Map<string, BaseHalfCanvasItemKind>();
	pending: IBaseHalfMovedItem[] = [];

	/** While running: what file events removed and added in the last window. */
	readonly disappeared = new Map<string, IDisappeared>();
	readonly appeared = new Map<string, number>();
	readonly appearedFolders = new Map<string, number>();
	/** Files that changed and need a new fingerprint. */
	readonly changed = new Set<string>();

	readonly compared = new DeferredPromise<void>();
	loaded = false;
	disposed = false;
	comparing = 0;
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

	compare(workspaceFolder: URI): Promise<void> {
		const state = this.folders.get(workspaceFolder.toString());
		return state ? this.enqueue(state, () => this.compareWithDisk(state)) : Promise.resolve();
	}

	getPendingMoves(workspaceFolder: URI): readonly IBaseHalfMovedItem[] {
		return this.folders.get(workspaceFolder.toString())?.pending ?? [];
	}

	acceptRelocated(workspaceFolder: URI, move: IBaseHalfMovedItem, outcome: 'done' | 'gone'): void {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state) {
			return;
		}
		state.pending = state.pending.filter(pending => pending.from !== move.from || pending.to !== move.to);
		if (outcome === 'gone') {
			// The new path is gone again: the item is where it was before it was
			// paired, so that it can be paired with its final name.
			const fingerprint = state.fingerprints.get(move.to);
			state.fingerprints.delete(move.to);
			state.followed.delete(move.to);
			state.disappeared.set(move.from, { at: Date.now(), fingerprint, followedKind: move.kind });
			this.schedule(state);
		}
		this.scheduleSave(state);
	}

	acceptWorkbenchMove(workspaceFolder: URI, from: string, to: string): void {
		const state = this.folders.get(workspaceFolder.toString());
		if (!state?.loaded) {
			return;
		}
		this.remap(state, from, to);
		for (const path of [...state.disappeared.keys()]) {
			if (baseHalfIsMirrorSubtree(path, from)) {
				state.disappeared.delete(path);
			}
		}
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
		this.scheduleSave(state);
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
			if (disappeared.length > 0 || disappearedFingerprints.size > 0) {
				const appeared = listing.filter(path => !state.has(path));
				const nowFolders = new Set<string>();
				for (const path of listing) {
					addAncestors(nowFolders, path);
				}
				moves.push(...await this.recognize(state, {
					disappeared,
					disappearedFingerprints,
					appeared,
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
		for (const [path, added] of [...state.appeared]) {
			if (now - added > this.timing.windowMs) {
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
			return;
		}
		const moves = await this.recognize(state, {
			disappeared,
			disappearedFingerprints,
			appeared: [...state.appeared.keys()],
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
	}

	private async recognize(state: FolderSnapshot, input: {
		readonly disappeared: readonly IBaseHalfFollowedItem[];
		readonly disappearedFingerprints: ReadonlyMap<string, IBaseHalfFileFingerprint>;
		readonly appeared: readonly string[];
		readonly appearedFolders: ReadonlySet<string>;
		readonly earlierPairs: ReadonlyMap<string, string> | undefined;
	}): Promise<IBaseHalfMovedItem[]> {
		const appearedFiles: { path: string; size: number }[] = [];
		await Promise.all(input.appeared.map(path => this.limiter.queue(async () => {
			try {
				const stat = await this.fileService.stat(this.resource(state, path));
				if (stat.isFile && !stat.isSymbolicLink) {
					appearedFiles.push({ path, size: stat.size });
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
			fingerprint: (path, withPieces) => this.fingerprint(state, path, withPieces),
			exists: (path, kind) => this.exists(state, path, kind)
		});
	}

	private report(state: FolderSnapshot, moves: readonly IBaseHalfMovedItem[]): void {
		if (moves.length === 0) {
			return;
		}
		this.logService.info(`[BaseHalf] items moved outside BaseHalf: ${moves.map(move => `${move.from} -> ${move.to} (${move.rule})`).join(', ')}`);
		state.pending = [...state.pending.filter(pending => !moves.some(move => move.from === pending.from)), ...moves];
		this.scheduleSave(state);
		this._onDidRecognize.fire({ workspaceFolder: state.folder, moves });
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
				state.appeared.set(file, at);
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
		// An item that is on its way to a new path stays followed until it is paired or its window ends.
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
			pending: state.pending
		};
		try {
			await this.fileService.writeFile(this.storageResource(state), VSBuffer.fromString(JSON.stringify(stored)));
		} catch (error) {
			this.logService.warn('[BaseHalf] could not save what was last seen in the workspace folder', error);
		}
	}

	//#endregion
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
