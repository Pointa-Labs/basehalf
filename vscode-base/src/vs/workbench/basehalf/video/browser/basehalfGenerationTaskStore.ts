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
	BASEHALF_GENERATION_TASK_FOLDER,
	baseHalfGenerationClaimWinner,
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
	/** Counts this window's own writes, so that a reading that began before one is not taken. */
	version: number;
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
		const naming = [...located.state.records.values()].map(record => record.task).filter(task => baseHalfGenerationTaskNamesCard(task, located.path));
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

	async remove(taskId: string): Promise<void> {
		const state = this.stateOf(taskId) ?? await this.findState(taskId);
		if (!state) {
			return;
		}
		await this.deleteQuietly(state.folder, this.recordResource(state.folder, taskId));
		for (const part of await this.partFiles(state.folder)) {
			if (part.taskId === taskId) {
				await this.deleteQuietly(state.folder, part.resource);
			}
		}
		this.forget(state, taskId);
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
		for (const record of [...source.state.records.values()]) {
			if (retargetBaseHalfGenerationTask(record.task, source.path, target.path) !== record.task) {
				await this.update(record.task.id, task => retargetBaseHalfGenerationTask(task, source.path, target.path));
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

	/** Reads every record of a folder again; what changed fires once. */
	private async scan(state: IFolderRecords): Promise<void> {
		const version = state.version;
		const read = new Map<string, IStoredRecord>();
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
		if (state.disposed) {
			return;
		}
		if (version !== state.version) {
			// This window wrote meanwhile: read again rather than take older bytes.
			state.scheduler.schedule();
			return;
		}
		const changed = read.size !== state.records.size || [...read].some(([id, record]) => state.records.get(id)?.text !== record.text);
		if (changed) {
			state.records.clear();
			for (const [id, record] of read) {
				state.records.set(id, record);
			}
			this._onDidChange.fire();
		}
	}

	/**
	 * When a folder opens (generation cards, "The task record"): removes the
	 * partial downloads that no record that has not ended names, and the
	 * records that ended and whose cards are all gone, with no file and no
	 * draft.
	 */
	private async cleanUp(state: IFolderRecords): Promise<void> {
		for (const part of await this.partFiles(state.folder)) {
			const record = state.records.get(part.taskId);
			if (!record || isBaseHalfGenerationTaskEnded(record.task)) {
				await this.deleteQuietly(state.folder, part.resource);
			}
		}
		for (const record of [...state.records.values()]) {
			if (!isBaseHalfGenerationTaskEnded(record.task)) {
				continue;
			}
			let gone = true;
			for (const card of record.task.cards) {
				if (await this.cardExists(state.folder, card.path)) {
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
		state.version++;
		if (state.records.get(taskId)?.text !== text) {
			state.records.set(taskId, { task, text });
			this._onDidChange.fire();
		}
		return task;
	}

	private forget(state: IFolderRecords, taskId: string): void {
		state.version++;
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
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(taskId) || taskId.includes('..')) {
			throw new Error(`The task id '${taskId}' cannot name a file.`);
		}
		return URI.joinPath(baseHalfGenerationTaskFolder(folder), `${taskId}${RECORD_SUFFIX}`);
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

	private async partFiles(folder: URI): Promise<readonly { readonly taskId: string; readonly resource: URI }[]> {
		const parts: { readonly taskId: string; readonly resource: URI }[] = [];
		for (const child of await this.children(folder).catch(() => [])) {
			const match = child.isFile ? /^(.+)-\d+\.part$/.exec(child.name) : null;
			if (match) {
				parts.push({ taskId: match[1], resource: child.resource });
			}
		}
		return parts;
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

function isConcurrentChange(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const result = toFileOperationResult(error);
	return result === FileOperationResult.FILE_MODIFIED_SINCE || result === FileOperationResult.FILE_MOVE_CONFLICT || result === FileOperationResult.FILE_NOT_FOUND;
}

registerSingleton(IBaseHalfGenerationTaskStore, BaseHalfGenerationTaskStore, InstantiationType.Delayed);
