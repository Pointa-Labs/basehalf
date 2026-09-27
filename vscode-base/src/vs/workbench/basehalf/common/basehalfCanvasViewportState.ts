/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceTimeout, TimeoutTimer } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';

export const IBaseHalfCanvasViewportStateService = createDecorator<IBaseHalfCanvasViewportStateService>('baseHalfCanvasViewportStateService');

/** Per-workspace, per-machine storage key of the folder viewport map. */
export const BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY = 'basehalf.canvas.folderViewports.v1';
/** Least-recently-used capacity of the folder viewport map. */
export const BASEHALF_CANVAS_VIEWPORTS_MAX_ENTRIES = 256;
/** Upper bound a canvas restore waits for the legacy viewport import. */
export const BASEHALF_CANVAS_VIEWPORT_IMPORT_WAIT_MS = 500;

const MAX_STORED_BYTES = 1024 * 1024;
const MAX_COORDINATE = 1e7;

/**
 * Who settled a stored viewport:
 *  - `user`: pan, zoom, fit, zoom menu, or a fit after the user created cards;
 *  - `auto`: the automatic first fit of a folder with no stored viewport;
 *  - `import`: the one-time import of a legacy folder viewport by cleanup.
 */
export type BaseHalfCanvasViewportSource = 'user' | 'auto' | 'import';

export interface IBaseHalfCanvasViewport {
	/** Canvas-space center of the visible area (independent of window size). */
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
	readonly source: BaseHalfCanvasViewportSource;
}

export interface IBaseHalfLegacyCanvasViewport {
	readonly folder: URI;
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

/**
 * Per-folder canvas viewports as per-machine UI state (VS Code workspace
 * storage), never as workspace files. Keys are folder resources made canonical
 * through {@link IUriIdentityService}.
 */
export interface IBaseHalfCanvasViewportStateService {
	readonly _serviceBrand: undefined;

	/** Fires with the folders whose stored viewport a legacy import replaced. */
	readonly onDidImport: Event<readonly URI[]>;

	/** The stored viewport of `folder`, marking it most recently used. */
	get(folder: URI): IBaseHalfCanvasViewport | undefined;
	/**
	 * Store a settled viewport. Invalid values are ignored. An `auto` viewport
	 * only fills a gap or replaces another `auto` one: it never replaces a
	 * `user` or `import` viewport, so a legacy viewport imported while an
	 * automatic first fit was still settling wins over that fit.
	 */
	set(folder: URI, viewport: IBaseHalfCanvasViewport): void;
	/**
	 * Import legacy folder viewports with source `import`. An entry replaces a
	 * stored viewport only when that viewport is missing or has source `auto`.
	 * Returns the folders whose viewport was replaced.
	 */
	importLegacy(viewports: readonly IBaseHalfLegacyCanvasViewport[]): readonly URI[];
	/** Forget the viewport of `folder` and of every folder below it. */
	forgetSubtree(folder: URI): void;

	/**
	 * Resolves once the legacy import of `workspaceFolder` settled in this
	 * session, or after {@link BASEHALF_CANVAS_VIEWPORT_IMPORT_WAIT_MS} at most.
	 * After one wait timed out, later waits for that workspace folder resolve
	 * immediately: navigation never pays the wait twice.
	 */
	whenLegacyImportSettled(workspaceFolder: URI): Promise<void>;
	/** Called by legacy cleanup when the import for `workspaceFolder` settled
	 *  (imported, nothing to import, skipped, or failed). */
	settleLegacyImport(workspaceFolder: URI): void;

	/** Persist in-memory recency changes now. */
	flush(): void;
}

/** Validate one stored viewport value. Invalid values are ignored. */
export function parseBaseHalfCanvasViewport(value: unknown): IBaseHalfCanvasViewport | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as { readonly x?: unknown; readonly y?: unknown; readonly zoom?: unknown; readonly source?: unknown };
	if (!isCoordinate(record.x) || !isCoordinate(record.y) || !isPositiveFinite(record.zoom)) {
		return undefined;
	}
	if (record.source !== 'user' && record.source !== 'auto' && record.source !== 'import') {
		return undefined;
	}
	return { x: record.x, y: record.y, zoom: record.zoom, source: record.source };
}

interface ILegacyImportBarrier {
	settled: boolean;
	readonly deferred: DeferredPromise<void>;
}

export class BaseHalfCanvasViewportStateService extends Disposable implements IBaseHalfCanvasViewportStateService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidImport = this._register(new Emitter<readonly URI[]>());
	readonly onDidImport = this._onDidImport.event;

	/** Oldest first; insertion order is the LRU order. */
	private entries: Map<string, IBaseHalfCanvasViewport> | undefined;
	private dirty = false;
	private storing = false;
	private readonly legacyImports = new Map<string, ILegacyImportBarrier>();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		const storageListeners = this._register(new DisposableStore());
		this._register(this.storageService.onDidChangeValue(StorageScope.WORKSPACE, BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, storageListeners)(() => {
			if (!this.storing) {
				// Workspace storage switched or another writer replaced the value.
				this.entries = undefined;
				this.dirty = false;
			}
		}));
		this._register(this.storageService.onWillSaveState(() => this.flush()));
	}

	get(folder: URI): IBaseHalfCanvasViewport | undefined {
		const entries = this.load();
		const key = this.key(folder);
		const viewport = entries.get(key);
		if (!viewport) {
			return undefined;
		}
		if (this.lastKey(entries) !== key) {
			entries.delete(key);
			entries.set(key, viewport);
			this.dirty = true;
		}
		return viewport;
	}

	set(folder: URI, viewport: IBaseHalfCanvasViewport): void {
		const valid = parseBaseHalfCanvasViewport(viewport);
		if (!valid) {
			return;
		}
		const entries = this.load();
		const key = this.key(folder);
		const current = entries.get(key);
		if (valid.source === 'auto' && current && current.source !== 'auto') {
			return;
		}
		if (current && sameViewport(current, valid) && this.lastKey(entries) === key && !this.dirty) {
			return;
		}
		entries.delete(key);
		entries.set(key, valid);
		this.evict(entries);
		this.store(entries);
	}

	importLegacy(viewports: readonly IBaseHalfLegacyCanvasViewport[]): readonly URI[] {
		const entries = this.load();
		const imported: URI[] = [];
		for (const legacy of viewports) {
			const valid = parseBaseHalfCanvasViewport({ x: legacy.x, y: legacy.y, zoom: legacy.zoom, source: 'import' });
			if (!valid) {
				continue;
			}
			const key = this.key(legacy.folder);
			const current = entries.get(key);
			if (current && current.source !== 'auto') {
				continue;
			}
			entries.delete(key);
			entries.set(key, valid);
			imported.push(legacy.folder);
		}
		if (imported.length > 0) {
			this.evict(entries);
			this.store(entries);
			this._onDidImport.fire(imported);
		}
		return imported;
	}

	forgetSubtree(folder: URI): void {
		const entries = this.load();
		const root = this.uriIdentityService.asCanonicalUri(folder);
		let removed = false;
		for (const key of [...entries.keys()]) {
			const resource = parseKey(key);
			if (resource && this.uriIdentityService.extUri.isEqualOrParent(resource, root)) {
				entries.delete(key);
				removed = true;
			}
		}
		if (removed) {
			this.store(entries);
		}
	}

	whenLegacyImportSettled(workspaceFolder: URI): Promise<void> {
		const barrier = this.legacyImportBarrier(workspaceFolder);
		if (barrier.settled) {
			return Promise.resolve();
		}
		return raceTimeout(barrier.deferred.p, BASEHALF_CANVAS_VIEWPORT_IMPORT_WAIT_MS, () => {
			barrier.settled = true;
		}).then(() => undefined);
	}

	settleLegacyImport(workspaceFolder: URI): void {
		const barrier = this.legacyImportBarrier(workspaceFolder);
		barrier.settled = true;
		if (!barrier.deferred.isSettled) {
			barrier.deferred.complete();
		}
	}

	flush(): void {
		if (this.dirty && this.entries) {
			this.store(this.entries);
		}
	}

	override dispose(): void {
		this.flush();
		for (const barrier of this.legacyImports.values()) {
			if (!barrier.deferred.isSettled) {
				barrier.deferred.complete();
			}
		}
		super.dispose();
	}

	private legacyImportBarrier(workspaceFolder: URI): ILegacyImportBarrier {
		const key = this.key(workspaceFolder);
		let barrier = this.legacyImports.get(key);
		if (!barrier) {
			barrier = { settled: false, deferred: new DeferredPromise<void>() };
			this.legacyImports.set(key, barrier);
		}
		return barrier;
	}

	private key(folder: URI): string {
		return this.uriIdentityService.asCanonicalUri(folder).toString();
	}

	private lastKey(entries: Map<string, IBaseHalfCanvasViewport>): string | undefined {
		let last: string | undefined;
		for (const key of entries.keys()) {
			last = key;
		}
		return last;
	}

	private evict(entries: Map<string, IBaseHalfCanvasViewport>): void {
		while (entries.size > BASEHALF_CANVAS_VIEWPORTS_MAX_ENTRIES) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) {
				return;
			}
			entries.delete(oldest);
		}
	}

	private load(): Map<string, IBaseHalfCanvasViewport> {
		if (this.entries) {
			return this.entries;
		}
		const entries = new Map<string, IBaseHalfCanvasViewport>();
		const raw = this.storageService.get(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, StorageScope.WORKSPACE);
		if (raw !== undefined && raw.length <= MAX_STORED_BYTES) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				parsed = undefined;
			}
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				for (const [key, value] of Object.entries(parsed)) {
					const viewport = parseBaseHalfCanvasViewport(value);
					if (viewport && parseKey(key)) {
						entries.set(key, viewport);
					}
				}
			}
		}
		this.evict(entries);
		this.entries = entries;
		this.dirty = false;
		return entries;
	}

	private store(entries: Map<string, IBaseHalfCanvasViewport>): void {
		this.dirty = false;
		this.storing = true;
		try {
			if (entries.size === 0) {
				this.storageService.remove(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, StorageScope.WORKSPACE);
				return;
			}
			const value: Record<string, IBaseHalfCanvasViewport> = {};
			for (const [key, viewport] of entries) {
				value[key] = { x: viewport.x, y: viewport.y, zoom: viewport.zoom, source: viewport.source };
			}
			this.storageService.store(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, JSON.stringify(value), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} finally {
			this.storing = false;
		}
	}
}

function parseKey(key: string): URI | undefined {
	try {
		const resource = URI.parse(key, true);
		return resource.scheme ? resource : undefined;
	} catch {
		return undefined;
	}
}

function sameViewport(a: IBaseHalfCanvasViewport, b: IBaseHalfCanvasViewport): boolean {
	return a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.source === b.source;
}

function isCoordinate(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function isPositiveFinite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** The canvas surface side of {@link baseHalfOpenCanvasViewport}. */
export interface IBaseHalfCanvasViewportOpenScene {
	/** False once the scene that opened is no longer the one to position:
	 *  replaced, disposed, covered by Card Detail, or moved by the user. */
	isCurrent(): boolean;
	/** Show a stored viewport. */
	restore(viewport: IBaseHalfCanvasViewport): Promise<void>;
	/** Fit the folder's content: the automatic first fit. */
	fit(): Promise<void>;
	/** Record the settled automatic first fit with source `auto`. */
	persistFit(): void;
}

/**
 * - `stale`: the scene stopped being current before anything was shown;
 * - `restored`: the stored viewport was shown;
 * - `fitted`: the content was fitted. The fit is recorded only when the
 *   scene was still current after it.
 */
export type BaseHalfCanvasViewportOpenOutcome = 'stale' | 'restored' | 'fitted';

/**
 * Position a folder's canvas when it opens: restore the viewport stored on
 * this machine, or fit the content and record that fit as `auto`. It first
 * waits, for a bounded time, for the legacy import of the folder's workspace
 * folder, so a viewport the import brings in is not missed. Viewports live in
 * VS Code storage: opening a canvas reads and writes no workspace file.
 */
export async function baseHalfOpenCanvasViewport(
	viewportStateService: IBaseHalfCanvasViewportStateService,
	folder: URI,
	workspaceFolder: URI,
	scene: IBaseHalfCanvasViewportOpenScene
): Promise<BaseHalfCanvasViewportOpenOutcome> {
	await viewportStateService.whenLegacyImportSettled(workspaceFolder);
	if (!scene.isCurrent()) {
		return 'stale';
	}

	const stored = viewportStateService.get(folder);
	if (stored) {
		await scene.restore(stored);
		return 'restored';
	}

	await scene.fit();
	if (scene.isCurrent()) {
		scene.persistFit();
	}
	return 'fitted';
}

/** A settled canvas viewport waiting for its debounce. */
export interface IBaseHalfPendingCanvasViewport {
	readonly folder: URI;
	readonly viewport: IBaseHalfCanvasViewport;
	/** Checked when the write lands. False drops it: the scene is no longer
	 *  current, for example because its folder moved. */
	isCurrent(): boolean;
}

/**
 * Debounces one canvas surface's settled viewport into
 * {@link IBaseHalfCanvasViewportStateService}. A pending write is flushed, not
 * dropped, when the surface is disposed and when storage saves state (window
 * close, shutdown), so the last gesture before quitting survives.
 */
export class BaseHalfCanvasViewportPersister extends Disposable {
	private pending: IBaseHalfPendingCanvasViewport | undefined;
	private readonly timer = this._register(new TimeoutTimer());

	constructor(
		@IBaseHalfCanvasViewportStateService private readonly viewportStateService: IBaseHalfCanvasViewportStateService,
		@IStorageService storageService: IStorageService
	) {
		super();
		this._register(storageService.onWillSaveState(() => this.flush()));
	}

	get pendingViewport(): IBaseHalfPendingCanvasViewport | undefined {
		return this.pending;
	}

	schedule(delay: number, pending: IBaseHalfPendingCanvasViewport): void {
		this.pending = pending;
		this.timer.cancelAndSet(() => this.flush(), delay);
	}

	flush(): void {
		this.timer.cancel();
		const pending = this.pending;
		this.pending = undefined;
		if (pending && pending.isCurrent()) {
			this.viewportStateService.set(pending.folder, pending.viewport);
		}
	}

	override dispose(): void {
		this.flush();
		super.dispose();
	}
}

registerSingleton(IBaseHalfCanvasViewportStateService, BaseHalfCanvasViewportStateService, InstantiationType.Delayed);
