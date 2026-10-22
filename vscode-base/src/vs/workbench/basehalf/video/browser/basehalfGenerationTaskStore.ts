/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfCommitMirrorFile } from '../../workspace/common/basehalfMirrorFileCommit.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink, baseHalfMirrorResource } from '../../workspace/common/basehalfMirrorTree.js';
import {
	BASEHALF_GENERATION_INFO_FILE,
	BASEHALF_GENERATION_MADE_FILE,
	BASEHALF_GENERATION_STALE_MS,
	BASEHALF_GENERATION_TASK_FOLDER,
	baseHalfGenerationClaimWinner,
	BaseHalfGenerationPathKey,
	baseHalfGenerationTaskNamesCard,
	IBaseHalfGenerationTask,
	isBaseHalfGenerationTaskEnded,
	parseBaseHalfGenerationTask,
	retargetBaseHalfGenerationTask,
	serializeBaseHalfGenerationTask
} from '../common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationTaskStore } from '../common/basehalfVideoGeneration.js';

/** A record is at most this large: the whole prompt as sent is at most 256 KiB. */
const RECORD_MAX_BYTES = 2 * 1024 * 1024;
/** How often a change is planned again when the record changed under it. */
const MAX_UPDATE_ATTEMPTS = 8;
/** Events of the watcher that come together are read together. */
const RESCAN_DELAY = 50;
const RECORD_SUFFIX = '.json';
const PART_SUFFIX = '.part';
const TAKEOVER_SUFFIX = '.takeover';
/** How many claims, one after another that nothing came of, a takeover looks through. */
const MAX_TAKEOVER_ROUNDS = 16;

interface IStoredRecord {
	readonly task: IBaseHalfGenerationTask;
	/** The bytes the record was read from or written as. */
	readonly text: string;
}

interface IFolderRecords {
	readonly folder: URI;
	readonly records: Map<string, IStoredRecord>;
	readonly scheduler: RunOnceScheduler;
	readonly store: DisposableStore;
	/** Counts this window's own writes and removals. */
	version: number;
	/**
	 * The version at which this window last wrote or removed each record, so
	 * that a reading that began before keeps what this window knows of that
	 * record and takes the others.
	 */
	readonly touched: Map<string, number>;
	/** How many readings of the folder are running. */
	scanning: number;
	ready: Promise<void>;
	disposed: boolean;
}

/** The folder of the task records of a workspace folder: `.bh/cache/generation/`. */
export function baseHalfGenerationTaskFolder(workspaceFolder: URI): URI {
	return URI.joinPath(workspaceFolder, '.bh', 'cache', BASEHALF_GENERATION_TASK_FOLDER);
}

/**
 * The task records of this computer (generation cards, "The task record"):
 * `.bh/cache/generation/<task id>.json` of each open workspace folder, read
 * when the folder opens and again when a watcher of that folder alone reports
 * a change. Git does not share them. Every write is a compare and swap
 * against the bytes that were read, and a new record is created only where
 * none is. When a folder opens, the partial downloads that no unfinished
 * record names and the ended records whose cards are gone are removed.
 */
export class BaseHalfGenerationTaskStore extends Disposable implements IBaseHalfGenerationTaskStore {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly folders = new ResourceMap<IFolderRecords>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		for (const folder of this.workspaceContextService.getWorkspace().folders) {
			this.addFolder(folder.uri);
		}
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(event => {
			for (const folder of event.removed) {
				this.removeFolder(folder.uri);
			}
			for (const folder of event.added) {
				this.addFolder(folder.uri);
			}
		}));
	}

	override dispose(): void {
		for (const state of this.folders.values()) {
			state.disposed = true;
			state.store.dispose();
		}
		this.folders.clear();
		super.dispose();
	}

	async whenReady(): Promise<void> {
		await Promise.all([...this.folders.values()].map(state => state.ready));
	}

	/** Reads the records again now; a record this window wrote meanwhile keeps what this window wrote. */
	async refresh(folder?: URI): Promise<void> {
		const states = folder ? [this.folders.get(folder)].filter((state): state is IFolderRecords => !!state) : [...this.folders.values()];
		await Promise.all(states.map(state => this.scan(state)));
	}

	list(): readonly IBaseHalfGenerationTask[] {
		return [...this.folders.values()].flatMap(state => [...state.records.values()].map(record => record.task));
	}

	get(taskId: string): IBaseHalfGenerationTask | undefined {
		return this.stateOf(taskId)?.records.get(taskId)?.task;
	}

	folderOf(taskId: string): URI | undefined {
		return this.stateOf(taskId)?.folder;
	}

	forCard(resource: URI): IBaseHalfGenerationTask | undefined {
		const located = this.locate(resource);
		if (!located) {
			return undefined;
		}
		const key = this.pathKey(located.state.folder);
		const naming = [...located.state.records.values()].map(record => record.task).filter(task => baseHalfGenerationTaskNamesCard(task, located.path, key));
		const active = baseHalfGenerationClaimWinner(naming);
		if (active) {
			return active;
		}
		return naming.sort((a, b) => (Date.parse(b.endedAt ?? b.startedAt) || 0) - (Date.parse(a.endedAt ?? a.startedAt) || 0))[0];
	}

	async create(folder: URI, task: IBaseHalfGenerationTask): Promise<void> {
		const state = this.folders.get(folder);
		if (!state) {
			throw new Error(localize('basehalf.generation.tasks.notOpen', "{0} is not an open folder.", folder.toString(true)));
		}
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder)) {
			throw new Error(localize('basehalf.generation.tasks.marked', "BaseHalf is set to leave this folder alone, so it does not generate here."));
		}
		const resource = this.recordResource(folder, task.id);
		const text = serializeBaseHalfGenerationTask(task);
		// A record is a working file of this computer: git must not show it.
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, folder);
		await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, folder, resource);
		await baseHalfCommitMirrorFile(this.fileService, resource, VSBuffer.fromString(text), null);
		await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, folder, resource);
		this.accept(state, task.id, text);
	}

	async update(taskId: string, mutate: (task: IBaseHalfGenerationTask) => IBaseHalfGenerationTask): Promise<IBaseHalfGenerationTask | undefined> {
		const state = this.stateOf(taskId) ?? await this.findState(taskId);
		if (!state) {
			return undefined;
		}
		const resource = this.recordResource(state.folder, taskId);
		for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
			let bytes: VSBuffer;
			try {
				await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, state.folder, resource);
				bytes = (await this.fileService.readFile(resource, { atomic: true, limits: { size: RECORD_MAX_BYTES } })).value;
			} catch (error) {
				if (toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND) {
					this.forget(state, taskId);
					return undefined;
				}
				throw error;
			}
			const current = parseBaseHalfGenerationTask(bytes.toString());
			if (!current || current.id !== taskId) {
				this.logService.warn(`[BaseHalf generation] The task record ${taskId} cannot be read; it is left as it is.`);
				return undefined;
			}
			const next = mutate(current);
			if (next === current) {
				this.accept(state, taskId, bytes.toString());
				return current;
			}
			const text = serializeBaseHalfGenerationTask(next);
			try {
				await baseHalfCommitMirrorFile(this.fileService, resource, VSBuffer.fromString(text), bytes);
			} catch (error) {
				if (isConcurrentChange(error)) {
					continue;
				}
				throw error;
			}
			return this.accept(state, taskId, text);
		}
		throw new Error(localize('basehalf.generation.tasks.busy', "The record of the generation kept changing while BaseHalf wrote it."));
	}

	async write(task: IBaseHalfGenerationTask): Promise<void> {
		const folder = this.folderOf(task.id) ?? (this.folders.size === 1 ? [...this.folders.values()][0].folder : undefined);
		if (!folder) {
			throw new Error(`No workspace folder holds the task record ${task.id}.`);
		}
		if (this.get(task.id) || await this.findState(task.id)) {
			await this.update(task.id, () => task);
			return;
		}
		await this.create(folder, task);
	}

	async remove(taskId: string, onlyIf?: (task: IBaseHalfGenerationTask) => boolean): Promise<void> {
		const state = this.stateOf(taskId) ?? await this.findState(taskId);
		if (!state) {
			return;
		}
		const resource = this.recordResource(state.folder, taskId);
		if (onlyIf) {
			// Decided on the bytes on disk, read last, not on what this window saw before.
			let current: IBaseHalfGenerationTask | undefined;
			try {
				await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, state.folder, resource);
				current = parseBaseHalfGenerationTask((await this.fileService.readFile(resource, { atomic: true, limits: { size: RECORD_MAX_BYTES } })).value.toString());
			} catch (error) {
				if (toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND) {
					this.forget(state, taskId);
					return;
				}
				throw error;
			}
			if (!current || !onlyIf(current)) {
				return;
			}
		}
		await this.deleteQuietly(state.folder, resource);
		for (const file of await this.taskFiles(state.folder)) {
			if (file.taskId === taskId) {
				await this.deleteQuietly(state.folder, file.resource);
			}
		}
		this.forget(state, taskId);
	}

	async claimTakeover(taskId: string, aliveAt: string): Promise<boolean> {
		const state = this.stateOf(taskId) ?? await this.findState(taskId);
		const alive = Date.parse(aliveAt);
		if (!state || !Number.isFinite(alive)) {
			return false;
		}
		let resource = this.takeoverResource(state.folder, taskId, [alive]);
		const claimed: number[] = [alive];
		for (let round = 0; round < MAX_TAKEOVER_ROUNDS; round++) {
			try {
				await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, state.folder, resource);
				// Created only where none is, by the file system itself: of the windows that try, one does.
				await baseHalfCommitMirrorFile(this.fileService, resource, VSBuffer.fromString(`${taskId}\n`), null);
				return true;
			} catch (error) {
				if (!isConcurrentChange(error)) {
					this.logService.warn(`[BaseHalf generation] Could not claim the takeover of ${taskId}: ${getErrorMessage(error)}`);
					return false;
				}
			}
			// Claimed already. A window that claimed it and is gone before it said
			// the record alive leaves its claim; 90 seconds later the next claim,
			// named after that one, can be made, again by one window.
			let made: number;
			try {
				made = (await this.fileService.stat(resource)).mtime;
			} catch {
				return false;
			}
			if (Date.now() - made < BASEHALF_GENERATION_STALE_MS) {
				return false;
			}
			claimed.push(made);
			resource = this.takeoverResource(state.folder, taskId, claimed);
		}
		return false;
	}

	partFile(task: IBaseHalfGenerationTask, index: number): URI {
		const folder = this.folderOf(task.id);
		if (!folder) {
			throw new Error(`No workspace folder holds the task record ${task.id}.`);
		}
		return URI.joinPath(baseHalfGenerationTaskFolder(folder), `${task.id}-${index + 1}${PART_SUFFIX}`);
	}

	async retarget(from: URI, to: URI): Promise<void> {
		const source = this.locate(from);
		const target = this.locate(to);
		if (!source || !target || source.state !== target.state) {
			// A card moved into another workspace folder lands where its record is.
			return;
		}
		await this.scan(source.state);
		const key = this.pathKey(source.state.folder);
		for (const record of [...source.state.records.values()]) {
			if (retargetBaseHalfGenerationTask(record.task, source.path, target.path, key) !== record.task) {
				await this.update(record.task.id, task => retargetBaseHalfGenerationTask(task, source.path, target.path, key));
			}
		}
	}

	// --- folders ---------------------------------------------------------------------------------

	private addFolder(folder: URI): void {
		if (this.folders.has(folder)) {
			return;
		}
		const store = new DisposableStore();
		const state: IFolderRecords = {
			folder,
			records: new Map(),
			scheduler: store.add(new RunOnceScheduler(() => { void this.scan(state); }, RESCAN_DELAY)),
			store,
			version: 0,
			touched: new Map(),
			scanning: 0,
			ready: Promise.resolve(),
			disposed: false
		};
		this.folders.set(folder, state);
		// `.bh/cache/` is not watched with the workspace; this folder alone is, and its events come to this store only.
		const watcher = store.add(this.fileService.createWatcher(baseHalfGenerationTaskFolder(folder), { recursive: false, excludes: [] }));
		store.add(watcher.onDidChange(() => state.scheduler.schedule()));
		state.ready = this.scan(state)
			.then(() => this.cleanUp(state))
			.catch(error => this.logService.warn(`[BaseHalf generation] The task records of ${folder.toString()} could not be read: ${getErrorMessage(error)}`));
	}

	private removeFolder(folder: URI): void {
		const state = this.folders.get(folder);
		if (!state) {
			return;
		}
		state.disposed = true;
		state.store.dispose();
		this.folders.delete(folder);
		if (state.records.size) {
			this._onDidChange.fire();
		}
	}

	/**
	 * Reads every record of a folder again; what changed fires once. A record
	 * that this window wrote or removed while the reading ran keeps what this
	 * window wrote, which is newer than what the reading saw; every other
	 * record is taken as read, so a reading always counts.
	 */
	private async scan(state: IFolderRecords): Promise<void> {
		const version = state.version;
		state.scanning++;
		const read = new Map<string, IStoredRecord>();
		try {
			for (const child of await this.children(state.folder)) {
				if (!child.isFile || !child.name.endsWith(RECORD_SUFFIX)) {
					continue;
				}
				const taskId = child.name.slice(0, -RECORD_SUFFIX.length);
				try {
					const text = (await this.fileService.readFile(child.resource, { atomic: true, limits: { size: RECORD_MAX_BYTES } })).value.toString();
					const task = parseBaseHalfGenerationTask(text);
					if (task?.id === taskId) {
						read.set(taskId, { task, text });
					}
				} catch (error) {
					if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND) {
						this.logService.warn(`[BaseHalf generation] The task record ${child.name} could not be read: ${getErrorMessage(error)}`);
					}
				}
			}
		} finally {
			state.scanning--;
		}
		if (state.disposed) {
			return;
		}
		const touchedMeanwhile = (taskId: string) => (state.touched.get(taskId) ?? 0) > version;
		let changed = false;
		for (const taskId of [...state.records.keys()]) {
			if (!read.has(taskId) && !touchedMeanwhile(taskId)) {
				state.records.delete(taskId);
				changed = true;
			}
		}
		for (const [taskId, record] of read) {
			if (!touchedMeanwhile(taskId) && state.records.get(taskId)?.text !== record.text) {
				state.records.set(taskId, record);
				changed = true;
			}
		}
		if (state.scanning === 0) {
			// No reading that began earlier needs to know what this window wrote before now.
			state.touched.clear();
		}
		if (changed) {
			this._onDidChange.fire();
		}
	}

	/**
	 * When a folder opens (generation cards, "The task record"): removes the
	 * partial downloads and takeover claims of records that are gone, the
	 * partial downloads of records a user stopped, the takeover claims of
	 * records said alive since, and the records that ended and whose cards
	 * that got no file are all gone, with no file and no draft. The partial
	 * downloads of a record that failed stay with it: a window that got the
	 * provider's answer after another window failed the record lands them.
	 */
	private async cleanUp(state: IFolderRecords): Promise<void> {
		for (const file of await this.taskFiles(state.folder)) {
			const record = state.records.get(file.taskId);
			const obsolete = !record
				|| (file.kind === 'part' && record.task.state === 'stopped')
				|| (file.kind === 'takeover' && file.aliveAt !== Date.parse(record.task.aliveAt));
			if (obsolete) {
				await this.deleteQuietly(state.folder, file.resource);
			}
		}
		for (const record of [...state.records.values()]) {
			if (!isBaseHalfGenerationTaskEnded(record.task)) {
				continue;
			}
			let gone = true;
			for (const card of record.task.cards) {
				if (card.state !== 'landed' && await this.cardExists(state.folder, card.path)) {
					gone = false;
					break;
				}
			}
			if (gone && !state.disposed) {
				await this.remove(record.task.id);
			}
		}
	}

	/** Whether a card has its file or is a draft. */
	private async cardExists(folder: URI, path: string): Promise<boolean> {
		const resource = URI.joinPath(folder, ...path.split('/'));
		if (await this.fileService.exists(resource).catch(() => true)) {
			return true;
		}
		try {
			const info = await this.fileService.exists(baseHalfMirrorResource(folder, path, BASEHALF_GENERATION_INFO_FILE));
			const made = await this.fileService.exists(baseHalfMirrorResource(folder, path, BASEHALF_GENERATION_MADE_FILE));
			return info && !made;
		} catch {
			// A path that cannot name a mirror directory names no draft.
			return false;
		}
	}

	// --- helpers ---------------------------------------------------------------------------------

	private accept(state: IFolderRecords, taskId: string, text: string): IBaseHalfGenerationTask | undefined {
		const task = parseBaseHalfGenerationTask(text);
		if (!task) {
			return undefined;
		}
		state.touched.set(taskId, ++state.version);
		if (state.records.get(taskId)?.text !== text) {
			state.records.set(taskId, { task, text });
			this._onDidChange.fire();
		}
		return task;
	}

	private forget(state: IFolderRecords, taskId: string): void {
		state.touched.set(taskId, ++state.version);
		if (state.records.delete(taskId)) {
			this._onDidChange.fire();
		}
	}

	private stateOf(taskId: string): IFolderRecords | undefined {
		for (const state of this.folders.values()) {
			if (state.records.has(taskId)) {
				return state;
			}
		}
		return undefined;
	}

	/** Looks on disk for a record this window has not read yet. */
	private async findState(taskId: string): Promise<IFolderRecords | undefined> {
		for (const state of this.folders.values()) {
			if (await this.fileService.exists(this.recordResource(state.folder, taskId)).catch(() => false)) {
				return state;
			}
		}
		return undefined;
	}

	private locate(resource: URI): { readonly state: IFolderRecords; readonly path: string } | undefined {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		const state = folder ? this.folders.get(folder) : undefined;
		const path = folder ? this.uriIdentityService.extUri.relativePath(folder, resource) : undefined;
		return state && path ? { state, path } : undefined;
	}

	private recordResource(folder: URI, taskId: string): URI {
		assertTaskIdNamesFile(taskId);
		return URI.joinPath(baseHalfGenerationTaskFolder(folder), `${taskId}${RECORD_SUFFIX}`);
	}

	/**
	 * `<task id>.<aliveAt in ms>.takeover`: the claim of the window that takes
	 * the record over from that heartbeat; a claim that came after one nothing
	 * came of also names when that one was made.
	 */
	private takeoverResource(folder: URI, taskId: string, moments: readonly number[]): URI {
		assertTaskIdNamesFile(taskId);
		return URI.joinPath(baseHalfGenerationTaskFolder(folder), `${taskId}.${moments.join('.')}${TAKEOVER_SUFFIX}`);
	}

	/** How the paths of cards are compared in a workspace folder: without letter case where its volume ignores it. */
	private pathKey(folder: URI): BaseHalfGenerationPathKey {
		return this.uriIdentityService.extUri.ignorePathCasing(folder) ? path => path.toLowerCase() : path => path;
	}

	private async children(folder: URI): Promise<readonly { readonly name: string; readonly resource: URI; readonly isFile: boolean }[]> {
		const resource = baseHalfGenerationTaskFolder(folder);
		try {
			await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, folder, resource);
			const stat = await this.fileService.resolve(resource);
			return (stat.children ?? []).filter(child => !child.isSymbolicLink);
		} catch (error) {
			if (toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND) {
				return [];
			}
			throw error;
		}
	}

	/** The partial downloads (`<task id>-<n>.part`) and takeover claims (`<task id>.<ms>.takeover`) of the folder. */
	private async taskFiles(folder: URI): Promise<readonly ITaskFile[]> {
		const files: ITaskFile[] = [];
		for (const child of await this.children(folder).catch(() => [])) {
			if (!child.isFile) {
				continue;
			}
			const part = /^(.+)-\d+\.part$/.exec(child.name);
			if (part) {
				files.push({ kind: 'part', taskId: part[1], resource: child.resource });
				continue;
			}
			const takeover = /^(.+?)\.(\d+)(?:\.\d+)*\.takeover$/.exec(child.name);
			if (takeover) {
				files.push({ kind: 'takeover', taskId: takeover[1], aliveAt: Number(takeover[2]), resource: child.resource });
			}
		}
		return files;
	}

	private async deleteQuietly(folder: URI, resource: URI): Promise<void> {
		try {
			await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, folder, resource);
			await this.fileService.del(resource, { useTrash: false });
		} catch (error) {
			if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND) {
				this.logService.warn(`[BaseHalf generation] ${resource.toString()} could not be removed: ${getErrorMessage(error)}`);
			}
		}
	}
}

/** A file of the task folder that belongs to a record. */
type ITaskFile =
	| { readonly kind: 'part'; readonly taskId: string; readonly resource: URI }
	| { readonly kind: 'takeover'; readonly taskId: string; readonly aliveAt: number; readonly resource: URI };

function assertTaskIdNamesFile(taskId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(taskId) || taskId.includes('..')) {
		throw new Error(`The task id '${taskId}' cannot name a file.`);
	}
}

function isConcurrentChange(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const result = toFileOperationResult(error);
	return result === FileOperationResult.FILE_MODIFIED_SINCE || result === FileOperationResult.FILE_MOVE_CONFLICT || result === FileOperationResult.FILE_NOT_FOUND;
}

registerSingleton(IBaseHalfGenerationTaskStore, BaseHalfGenerationTaskStore, InstantiationType.Delayed);
