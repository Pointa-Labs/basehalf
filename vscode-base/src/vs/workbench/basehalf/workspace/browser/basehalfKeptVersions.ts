/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IntervalTimer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname, isEqualOrParent, joinPath, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfFileTimesService } from '../../../../platform/basehalfFiles/common/basehalfFileTimes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileOperation, FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { BaseHalfCanvasStateConflict, IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasEdge } from '../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_UPSTREAM_SIDECAR_FILE_NAME } from '../../references/common/basehalfReferenceStore.js';
import { BASEHALF_GENERATION_INFO_FILE, BASEHALF_GENERATION_MADE_FILE } from '../../video/common/basehalfGenerationInfo.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../common/basehalfMirrorIgnore.js';
import { baseHalfMirrorPathSegments, baseHalfMirrorRoot } from '../common/basehalfMirrorTree.js';
import { IBaseHalfMovedItemsService } from '../common/basehalfMovedItemsService.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../common/basehalfWorkspaceMutation.js';

/** How often a window renews the mark of what it keeps (exact undo, "When the kept versions go to the Trash"). */
const KEPT_MARK_RENEWAL_MS = 60_000;
/** How old a mark is that no window renews any more: the window is gone. */
const KEPT_MARK_STALE_MS = 5 * 60_000;
const KEPT_MARK_FILE = 'owner.json';
/** What a keep holds: the item under `item/`, its card information under `mirror/`, and where it was in `place.json`. */
const KEPT_ITEM_FOLDER = 'item';
const KEPT_MIRROR_FOLDER = 'mirror';
const KEPT_PLACE_FILE = 'place.json';
/**
 * The card information that a delete to the Trash leaves in `.bh/mirror/`,
 * so that a restore from the Trash brings the card back whole (mirror file
 * resilience). `generation.yaml` stays only beside a `made.yaml`: without
 * one it would be a draft.
 */
const KEPT_ON_TRASH = new Set([BASEHALF_UPSTREAM_SIDECAR_FILE_NAME, BASEHALF_GENERATION_INFO_FILE, BASEHALF_GENERATION_MADE_FILE, 'appearance.yaml']);

export const IBaseHalfKeptVersionsService = createDecorator<IBaseHalfKeptVersionsService>('baseHalfKeptVersionsService');

/** What one step changes in one file: its new bytes, or a file on the same disk that is moved into its place. */
export interface IBaseHalfFileReplacement {
	readonly resource: URI;
	readonly contents: VSBuffer | URI;
}

export interface IBaseHalfKeptStepOptions {
	/** The name of the step, as Undo in the menu bar shows it. */
	readonly label: string;
	/** Steps that one undo takes back together, such as the drafts of the same delete. */
	readonly undoRedoGroup?: UndoRedoGroup;
}

/**
 * The kept versions (exact undo): what a step of the canvas takes away from
 * the user's files is kept whole, with its card information, in
 * `.bh/cache/kept/` of its workspace folder, and undo moves it back. What a
 * window kept goes to the Trash when the window closes.
 */
export interface IBaseHalfKeptVersionsService {
	readonly _serviceBrand: undefined;
	/** Deletes items as one step of the canvas undo: undo brings each back whole, its card at its place. */
	deleteItems(items: readonly URI[], options: IBaseHalfKeptStepOptions): Promise<void>;
	/** Records items the canvas has just made as one step: undo keeps them with what was put into them since, and redo brings them back. */
	recordMade(items: readonly URI[], options: IBaseHalfKeptStepOptions): void;
	/** Changes the bytes of files as one step: the version of each before goes into the kept versions, and undo swaps it back. */
	replaceFiles(changes: readonly IBaseHalfFileReplacement[], options: IBaseHalfKeptStepOptions): Promise<void>;
	/** Sends to the Trash what windows that are gone kept. */
	sweep(): Promise<void>;
}

/** A step that cannot be undone or redone as it was, with the reason in plain words. Nothing was changed. */
export class BaseHalfKeptRefusal extends Error {
	override readonly name = 'BaseHalfKeptRefusal';
}

/** An item in the kept versions: where it was, the keep that holds it, and its row and anchor rows. */
interface IBaseHalfKeptItem {
	readonly workspaceFolder: URI;
	readonly path: string;
	readonly resource: URI;
	readonly slot: URI;
	readonly row?: IBaseHalfCanvasCard;
	readonly edges: readonly IBaseHalfCanvasEdge[];
}

/** The other version of a file that a step changed in place, and where the step keeps it. */
interface IBaseHalfKeptFile {
	readonly workspaceFolder: URI;
	readonly resource: URI;
	readonly kept: URI;
}

interface IBaseHalfItemLocation {
	readonly resource: URI;
	readonly workspaceFolder: URI;
	readonly path: string;
}

export class BaseHalfKeptVersionsService extends Disposable implements IBaseHalfKeptVersionsService {
	declare readonly _serviceBrand: undefined;

	/** This window's part of the kept versions of every workspace folder. */
	private readonly windowKey = generateUuid();
	/** The workspace folders in which this window keeps something, by key. */
	private readonly keeping = new Map<string, URI>();
	private readonly renewal = this._register(new IntervalTimer());

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfFileTimesService private readonly fileTimesService: IBaseHalfFileTimesService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfMovedItemsService private readonly movedItemsService: IBaseHalfMovedItemsService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.renewal.cancelAndSet(() => void this.renewMarks().then(() => this.sweep()).catch(error => this.logService.warn('[BaseHalf] could not renew the kept versions', error)), KEPT_MARK_RENEWAL_MS);
		// Closing or reloading the window ends its undo history: what it kept goes to the Trash.
		this._register(lifecycleService.onWillShutdown(event => event.join(this.flushOwn(), {
			id: 'basehalf.keptVersions',
			label: localize('basehalf.kept.shutdown', "Moving deleted items to the Trash")
		})));
	}

	async deleteItems(items: readonly URI[], options: IBaseHalfKeptStepOptions): Promise<void> {
		const top = topmost(items);
		if (top.length === 0) {
			return;
		}
		const kept = await this.keep(top);
		this.push(new BaseHalfKeptStep(options.label, top, 'delete', kept, this), options.undoRedoGroup);
	}

	recordMade(items: readonly URI[], options: IBaseHalfKeptStepOptions): void {
		const top = topmost(items);
		if (top.length > 0) {
			this.push(new BaseHalfKeptStep(options.label, top, 'make', [], this), options.undoRedoGroup);
		}
	}

	async replaceFiles(changes: readonly IBaseHalfFileReplacement[], options: IBaseHalfKeptStepOptions): Promise<void> {
		if (changes.length === 0) {
			return;
		}
		const files: IBaseHalfKeptFile[] = [];
		for (const change of changes) {
			const workspaceFolder = this.contextService.getWorkspaceFolder(change.resource)?.uri;
			if (!workspaceFolder || !(await this.fileService.stat(change.resource).catch(() => undefined))?.isFile) {
				throw new BaseHalfKeptRefusal(localize('basehalf.kept.notAFile', "'{0}' is no file of this workspace.", basename(change.resource)));
			}
			if (this.workingCopyService.isDirty(change.resource)) {
				throw new BaseHalfKeptRefusal(localize('basehalf.kept.replaceUnsaved', "Save '{0}' before it is changed.", basename(change.resource)));
			}
			files.push({ workspaceFolder, resource: change.resource, kept: joinPath(await this.newSlot(workspaceFolder), basename(change.resource)) });
		}
		const done: IBaseHalfKeptFile[] = [];
		try {
			for (const [index, file] of files.entries()) {
				await this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, async () => {
					// The version before goes first, so that a failure leaves the file as it was.
					// The window is told one write of the file, and nothing of the moves that carry it out.
					await this.fileService.move(file.resource, file.kept, false, 'nothing');
					const contents = changes[index].contents;
					// New bytes are written beside the version before and moved into place, as a new version from elsewhere is.
					const next = URI.isUri(contents) ? contents : joinPath(dirname(file.kept), `${generateUuid()}-${basename(file.resource)}`);
					try {
						if (!URI.isUri(contents)) {
							await this.fileService.writeFile(next, contents);
						}
						await this.fileService.move(next, file.resource, false, FileOperation.WRITE);
						await this.touch(file.resource);
					} catch (error) {
						if (!URI.isUri(contents)) {
							await this.fileService.del(next).catch(() => undefined);
						}
						await this.fileService.move(file.kept, file.resource, true, FileOperation.WRITE);
						throw error;
					}
				});
				done.push(file);
			}
		} catch (error) {
			for (const file of done.reverse()) {
				await this.swap(file).catch(rollbackError => this.logService.error(`[BaseHalf] could not put ${file.resource.toString()} back as it was`, rollbackError));
			}
			throw error;
		}
		this.push(new BaseHalfReplaceStep(options.label, files, this), options.undoRedoGroup);
	}

	async sweep(): Promise<void> {
		for (const folder of this.contextService.getWorkspace().folders) {
			const root = joinPath(folder.uri, '.bh', 'cache', 'kept');
			const windows = await this.fileService.resolve(root).catch(() => undefined);
			for (const window of windows?.children ?? []) {
				if (!window.isDirectory || window.name === this.windowKey || !await this.isStale(window.resource, window.mtime)) {
					continue;
				}
				this.logService.info(`[BaseHalf] sending what a window that is gone kept to the Trash: ${window.resource.toString()}`);
				await this.flush(folder.uri, window.resource);
			}
		}
	}

	/** Moves items, whole and with their card information, into the kept versions. */
	async keep(items: readonly URI[]): Promise<IBaseHalfKeptItem[]> {
		const located = items.map(resource => {
			const location = this.location(resource);
			if (!location) {
				throw new BaseHalfKeptRefusal(localize('basehalf.kept.outside', "'{0}' is not in a folder of this workspace.", basename(resource)));
			}
			return location;
		});
		await this.saveChangesBelow(located.map(item => item.resource));
		const kept: IBaseHalfKeptItem[] = [];
		for (const group of byWorkspaceFolder(located)) {
			const workspaceFolder = group[0].workspaceFolder;
			const reservation = this.workspaceMutationCoordinator.reserveStructural(workspaceFolder, group.map(item => ({ workspace: workspaceFolder, relativePath: item.path })));
			let done: IBaseHalfKeptItem[];
			try {
				done = await reservation.runPrepared(lease => this.keepAll(group, lease));
			} catch (error) {
				await reservation.abort();
				throw error;
			}
			await reservation.finish(async () => { }, done.map(item => ({ operation: FileOperation.DELETE, target: item.resource })));
			kept.push(...done);
		}
		return kept;
	}

	/** Moves kept items back to their paths, with their card information and their rows. */
	async restore(items: readonly IBaseHalfKeptItem[]): Promise<void> {
		for (const item of items) {
			await this.assertRestorable(item);
		}
		for (const group of byWorkspaceFolder(items)) {
			const workspaceFolder = group[0].workspaceFolder;
			const reservation = this.workspaceMutationCoordinator.reserveStructural(workspaceFolder, group.map(item => ({ workspace: workspaceFolder, relativePath: item.path })));
			try {
				await reservation.runPrepared(async lease => {
					for (const item of group) {
						await this.restoreOne(item, lease);
					}
				});
			} catch (error) {
				await reservation.abort();
				throw error;
			}
			await reservation.finish(async () => { });
		}
	}

	/** Swaps a file that a step changed in place with its other version. */
	async swap(file: IBaseHalfKeptFile): Promise<void> {
		if (!await this.fileService.exists(file.kept)) {
			throw new BaseHalfKeptRefusal(localize('basehalf.kept.gone', "'{0}' is in the Trash now. Restore it from there.", basename(file.resource)));
		}
		if (this.workingCopyService.isDirty(file.resource)) {
			throw new BaseHalfKeptRefusal(localize('basehalf.kept.replaceUnsaved', "Save '{0}' before it is changed.", basename(file.resource)));
		}
		await this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, async () => {
			const aside = joinPath(dirname(file.kept), `${generateUuid()}-${basename(file.resource)}`);
			const present = await this.fileService.exists(file.resource);
			// The window is told one write of the file, or its creation when it was not there.
			if (present) {
				await this.fileService.move(file.resource, aside, false, 'nothing');
			}
			await this.fileService.move(file.kept, file.resource, false, present ? FileOperation.WRITE : FileOperation.CREATE);
			await this.touch(file.resource);
			if (present) {
				await this.fileService.move(aside, file.kept, false, 'nothing');
			}
		});
	}

	/**
	 * Gives a version that was moved into the place of a file the time of
	 * now. A move keeps the time a version had, and the file watcher of macOS
	 * tells a change by that time: a version that comes back with a time the
	 * watcher saw at that path before is no change to it, and no view of the
	 * file would hear of it. Its bytes stay as they are.
	 */
	private async touch(resource: URI): Promise<void> {
		try {
			await this.fileTimesService.touch([resource]);
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not give ${resource.toString()} the time of now: a view of it may still show the version before`, error);
		}
	}

	notify(message: string): void {
		this.notificationService.info(message);
	}

	private push(element: IWorkspaceUndoRedoElement, group: UndoRedoGroup | undefined): void {
		this.undoRedoService.pushElement(element, group ?? UndoRedoGroup.None, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
	}

	private async keepAll(group: readonly IBaseHalfItemLocation[], lease: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfKeptItem[]> {
		const done: IBaseHalfKeptItem[] = [];
		try {
			for (const item of group) {
				done.push(await this.keepOne(item, lease));
			}
		} catch (error) {
			// What was kept before the failure goes back, so that the step changes nothing.
			for (const item of done.reverse()) {
				await this.restoreOne(item, lease).catch(rollbackError => this.logService.error(`[BaseHalf] could not put ${item.resource.toString()} back`, rollbackError));
			}
			throw error;
		}
		return done;
	}

	private async keepOne(item: IBaseHalfItemLocation, lease: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfKeptItem> {
		const { resource, workspaceFolder, path } = item;
		if (!await this.fileService.exists(resource)) {
			throw new BaseHalfKeptRefusal(localize('basehalf.kept.notThere', "'{0}' is not there any more.", basename(resource)));
		}
		const layout = await this.layoutOf(workspaceFolder, path);
		const slot = await this.newSlot(workspaceFolder);
		const keptItem = joinPath(slot, KEPT_ITEM_FOLDER, basename(resource));
		const keptMirror = joinPath(slot, KEPT_MIRROR_FOLDER);
		const mirror = this.mirrorDirectory(workspaceFolder, path);
		await this.fileService.writeFile(joinPath(slot, KEPT_PLACE_FILE), VSBuffer.fromString(JSON.stringify({ path })));
		await this.fileService.createFolder(dirname(keptItem));
		// Following moved items is told first: what disappears is no move to recognize.
		this.movedItemsService.acceptWorkbenchDelete(workspaceFolder, path);
		// The window is told the delete of the item and of its card information, not moves into the kept versions.
		await this.fileService.move(resource, keptItem, false, FileOperation.DELETE);
		let mirrorKept = false;
		try {
			if (await this.fileService.exists(mirror)) {
				await this.fileService.move(mirror, keptMirror, false, FileOperation.DELETE);
				mirrorKept = true;
			}
			// The row and the anchor rows that name the item; its own layouts went with its card information.
			await this.canvasMirrorService.purgeNode(workspaceFolder, path, lease);
		} catch (error) {
			if (mirrorKept) {
				await this.fileService.move(keptMirror, mirror, false, FileOperation.CREATE).catch(rollbackError => this.logService.error(`[BaseHalf] could not put the card information of ${path} back`, rollbackError));
			}
			await this.fileService.move(keptItem, resource, false, FileOperation.CREATE).catch(rollbackError => this.logService.error(`[BaseHalf] could not put ${path} back`, rollbackError));
			throw error;
		}
		this.logService.info(`[BaseHalf] kept ${path} for undo`);
		return { workspaceFolder, path, resource, slot, ...(layout.row ? { row: layout.row } : {}), edges: layout.edges };
	}

	private async assertRestorable(item: IBaseHalfKeptItem): Promise<void> {
		const name = basename(item.resource);
		if (!await this.fileService.exists(joinPath(item.slot, KEPT_ITEM_FOLDER, name))) {
			throw new BaseHalfKeptRefusal(localize('basehalf.kept.gone', "'{0}' is in the Trash now. Restore it from there.", name));
		}
		if (await this.fileService.exists(item.resource)) {
			throw new BaseHalfKeptRefusal(localize('basehalf.kept.taken', "'{0}' is there again. Undo did not replace it.", name));
		}
		if (!await this.fileService.exists(dirname(item.resource))) {
			throw new BaseHalfKeptRefusal(localize('basehalf.kept.folderGone', "The folder of '{0}' is not there any more.", name));
		}
	}

	private async restoreOne(item: IBaseHalfKeptItem, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		const keptItem = joinPath(item.slot, KEPT_ITEM_FOLDER, basename(item.resource));
		const keptMirror = joinPath(item.slot, KEPT_MIRROR_FOLDER);
		const mirror = this.mirrorDirectory(item.workspaceFolder, item.path);
		// The row first: the item is drawn at its place when it appears.
		await this.restoreLayout(item, lease);
		if (await this.fileService.exists(keptMirror)) {
			if (await this.fileService.exists(mirror)) {
				// Card information of another item took the path meanwhile: it stays, and this one is given up.
				this.logService.warn(`[BaseHalf] the card information of ${item.path} could not come back: ${mirror.toString()} is taken`);
			} else {
				await this.fileService.createFolder(dirname(mirror));
				await this.fileService.move(keptMirror, mirror, false, FileOperation.CREATE);
			}
		}
		// The window is told the creation of the item, not a move out of the kept versions.
		await this.fileService.move(keptItem, item.resource, false, FileOperation.CREATE);
		await this.fileService.del(item.slot, { recursive: true }).catch(error => this.logService.warn(`[BaseHalf] could not clear ${item.slot.toString()}`, error));
		this.logService.info(`[BaseHalf] brought ${item.path} back`);
	}

	/** Puts the row and the anchor rows back, where nothing else took their place. */
	private async restoreLayout(item: IBaseHalfKeptItem, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		if (!item.row && item.edges.length === 0) {
			return;
		}
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, item.workspaceFolder)) {
			return;
		}
		const folder = this.folderState(item.workspaceFolder, item.path);
		const cards = item.row ? [{ path: item.path, expected: null, next: { ...item.row, path: item.path } }] : [];
		const edges = item.edges.map(edge => ({ from: edge.from, to: edge.to, expected: null, next: edge }));
		for (const transition of [{ cards, edges }, { cards }]) {
			try {
				await this.canvasMirrorService.transitionCanvasState(folder, transition, lease);
				return;
			} catch (error) {
				if (!(error instanceof BaseHalfCanvasStateConflict)) {
					// A layout that cannot be read keeps the item from no undo: it gets a new place.
					this.logService.warn(`[BaseHalf] could not give ${item.path} its place back`, error);
					return;
				}
			}
		}
		// Another row took the place: the card is placed again when its canvas is drawn.
		this.logService.info(`[BaseHalf] the place of ${item.path} was taken; it gets a new one`);
	}

	private async layoutOf(workspaceFolder: URI, path: string): Promise<{ readonly row?: IBaseHalfCanvasCard; readonly edges: readonly IBaseHalfCanvasEdge[] }> {
		try {
			const canvas = await this.canvasMirrorService.readCanvas(this.folderState(workspaceFolder, path));
			return {
				row: canvas?.cards.find(card => card.path === path),
				edges: canvas?.edges.filter(edge => edge.from === path || edge.to === path) ?? []
			};
		} catch (error) {
			// A layout that cannot be read keeps no place to give back.
			this.logService.warn(`[BaseHalf] could not read the place of ${path}`, error);
			return { edges: [] };
		}
	}

	/** Saves the changes below the items that are not saved yet, so that what is kept is what the user sees. */
	private async saveChangesBelow(resources: readonly URI[]): Promise<void> {
		for (const workingCopy of this.workingCopyService.dirtyWorkingCopies) {
			if (!resources.some(resource => isEqualOrParent(workingCopy.resource, resource))) {
				continue;
			}
			await workingCopy.save();
			if (workingCopy.isDirty()) {
				throw new BaseHalfKeptRefusal(localize('basehalf.kept.unsaved', "'{0}' has changes that could not be saved. Nothing was deleted.", basename(workingCopy.resource)));
			}
		}
	}

	/** A new keep in this window's part of the kept versions of the folder. */
	private async newSlot(workspaceFolder: URI): Promise<URI> {
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, workspaceFolder);
		const slot = joinPath(this.windowFolder(workspaceFolder), generateUuid());
		await this.fileService.createFolder(slot);
		if (!this.keeping.has(workspaceFolder.toString())) {
			this.keeping.set(workspaceFolder.toString(), workspaceFolder);
			await this.renewMark(workspaceFolder);
		}
		return slot;
	}

	private async renewMarks(): Promise<void> {
		for (const workspaceFolder of this.keeping.values()) {
			await this.renewMark(workspaceFolder);
		}
	}

	private async renewMark(workspaceFolder: URI): Promise<void> {
		await this.fileService.writeFile(joinPath(this.windowFolder(workspaceFolder), KEPT_MARK_FILE), VSBuffer.fromString(JSON.stringify({ renewed: Date.now() })));
	}

	/** Whether no window has renewed the mark of a window's kept versions for a while. */
	private async isStale(windowFolder: URI, mtime: number | undefined): Promise<boolean> {
		let renewed = mtime ?? 0;
		try {
			const mark = JSON.parse((await this.fileService.readFile(joinPath(windowFolder, KEPT_MARK_FILE))).value.toString()) as { readonly renewed?: unknown };
			if (typeof mark.renewed === 'number') {
				renewed = mark.renewed;
			}
		} catch {
			// No mark: the folder's own time tells.
		}
		return Date.now() - renewed > KEPT_MARK_STALE_MS;
	}

	private async flushOwn(): Promise<void> {
		for (const workspaceFolder of this.keeping.values()) {
			await this.flush(workspaceFolder, this.windowFolder(workspaceFolder)).catch(error => this.logService.error(`[BaseHalf] could not move the kept versions of ${workspaceFolder.toString()} to the Trash`, error));
		}
		this.keeping.clear();
	}

	/**
	 * Sends every keep of a window's part of the kept versions to the Trash, or
	 * deletes it for good when the Trash is off. A keep that the Trash refuses
	 * stays, and the next sweep tries again.
	 */
	private async flush(workspaceFolder: URI, windowFolder: URI): Promise<void> {
		const window = await this.fileService.resolve(windowFolder).catch(() => undefined);
		let left = false;
		for (const slot of window?.children ?? []) {
			if (!slot.isDirectory) {
				continue;
			}
			try {
				await this.flushSlot(workspaceFolder, slot.resource);
			} catch (error) {
				left = true;
				this.logService.warn(`[BaseHalf] ${slot.resource.toString()} stays kept: it could not go to the Trash`, error);
			}
		}
		if (!left) {
			await this.fileService.del(windowFolder, { recursive: true }).catch(error => this.logService.warn(`[BaseHalf] could not clear ${windowFolder.toString()}`, error));
		}
	}

	private async flushSlot(workspaceFolder: URI, slot: URI): Promise<void> {
		const items = await this.fileService.resolve(joinPath(slot, KEPT_ITEM_FOLDER)).catch(() => undefined);
		let path: string | undefined;
		try {
			const place = JSON.parse((await this.fileService.readFile(joinPath(slot, KEPT_PLACE_FILE))).value.toString()) as { readonly path?: unknown };
			path = typeof place.path === 'string' ? place.path : undefined;
		} catch {
			// A keep of a file changed in place has no place: it is its other version.
		}
		const trash = this.configurationService.getValue<boolean>('files.enableTrash') && this.fileService.hasCapability(slot, FileSystemProviderCapabilities.Trash);
		for (const item of items?.children ?? []) {
			await this.discard(workspaceFolder, path, item.resource, trash);
		}
		if (trash && path !== undefined) {
			await this.leaveCardInformationForTheTrash(workspaceFolder, path, joinPath(slot, KEPT_MIRROR_FOLDER));
		}
		// The other version of a file that a step changed in place lies in the keep itself.
		const rest = await this.fileService.resolve(slot).catch(() => undefined);
		for (const entry of rest?.children ?? []) {
			if (entry.isFile && entry.name !== KEPT_PLACE_FILE) {
				await this.fileService.del(entry.resource, { useTrash: trash });
			}
		}
		await this.fileService.del(slot, { recursive: true });
	}

	/**
	 * Sends a kept item to the Trash from its path, so that Put Back in Finder
	 * returns it there: the Trash keeps the place an item had when it went in.
	 * An item whose path another item took, or whose folder is gone, goes from
	 * the kept versions. Without the Trash, it is deleted for good where it is.
	 * The window was told the item's delete when it was kept, and is told
	 * nothing of its way back to its path.
	 */
	private async discard(workspaceFolder: URI, path: string | undefined, kept: URI, trash: boolean): Promise<void> {
		const home = trash && path !== undefined ? joinPath(workspaceFolder, ...path.split('/')) : undefined;
		const atHome = home !== undefined && await this.fileService.exists(dirname(home))
			&& await this.fileService.move(kept, home, false, 'nothing').then(() => true, () => false);
		if (!home || !atHome) {
			await this.fileService.del(kept, { recursive: true, useTrash: trash });
			return;
		}
		try {
			// What disappears is no move to recognize.
			this.movedItemsService.acceptWorkbenchDelete(workspaceFolder, path!);
			await this.fileService.del(home, { recursive: true, useTrash: true });
		} catch (error) {
			// What the Trash refused stays kept, and the next window tries again.
			await this.fileService.move(home, kept, false, 'nothing');
			throw error;
		}
	}

	/** Puts the card information that a delete to the Trash keeps back into `.bh/mirror/`, where nothing took its place. */
	private async leaveCardInformationForTheTrash(workspaceFolder: URI, path: string, keptMirror: URI): Promise<void> {
		const walk = async (folder: URI, below: string[]): Promise<void> => {
			const stat = await this.fileService.resolve(folder).catch(() => undefined);
			const names = new Set((stat?.children ?? []).filter(child => child.isFile).map(child => child.name));
			for (const child of stat?.children ?? []) {
				if (child.isDirectory) {
					await walk(child.resource, [...below, child.name]);
				} else if (KEPT_ON_TRASH.has(child.name) && (child.name !== BASEHALF_GENERATION_INFO_FILE || names.has(BASEHALF_GENERATION_MADE_FILE))) {
					const target = joinPath(this.mirrorDirectory(workspaceFolder, path), ...below, child.name);
					if (!await this.fileService.exists(target)) {
						await this.fileService.createFolder(dirname(target));
						await this.fileService.move(child.resource, target, false, FileOperation.CREATE);
					}
				}
			}
		};
		await walk(keptMirror, []);
	}

	private windowFolder(workspaceFolder: URI): URI {
		return joinPath(workspaceFolder, '.bh', 'cache', 'kept', this.windowKey);
	}

	private mirrorDirectory(workspaceFolder: URI, path: string): URI {
		return joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(path));
	}

	private location(resource: URI): IBaseHalfItemLocation | undefined {
		const folder = this.contextService.getWorkspaceFolder(resource);
		const path = folder ? getRelativePath(folder.uri, resource) : undefined;
		if (!folder || !path || path === '.bh' || path.startsWith('.bh/')) {
			return undefined;
		}
		return { resource, workspaceFolder: folder.uri, path };
	}

	/** The folder of the item at `path`, as the canvas mirror addresses its layout. */
	private folderState(workspaceFolder: URI, path: string): IBaseHalfCanvasFolderState {
		const slash = path.lastIndexOf('/');
		const relativePath = slash < 0 ? '' : path.slice(0, slash);
		return { resource: relativePath ? joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder, workspaceFolder, relativePath, source: 'api' };
	}
}

/**
 * One step of the canvas undo over items (exact undo): a delete, whose undo
 * brings the items back, or what the canvas made, whose undo keeps it. A
 * step that cannot be undone or redone as it was says why, changes nothing,
 * and is done with; the next undo goes to the step before.
 */
class BaseHalfKeptStep implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly code = 'basehalf.keptVersions';
	/** A resource of the step's own: the items' own undo stacks, such as a note's text, stay apart from it. */
	readonly resources: readonly URI[] = [URI.from({ scheme: 'basehalf-kept', path: `/${generateUuid()}` })];
	private state: 'done' | 'undone' | 'over' = 'done';

	constructor(
		readonly label: string,
		private readonly items: readonly URI[],
		/** What the step did: deleted the items, or made them. */
		private readonly did: 'delete' | 'make',
		private kept: readonly IBaseHalfKeptItem[],
		private readonly service: BaseHalfKeptVersionsService
	) { }

	async undo(): Promise<void> {
		if (this.state === 'done') {
			await this.run(this.did === 'delete' ? 'restore' : 'keep', 'undone');
		}
	}

	async redo(): Promise<void> {
		if (this.state === 'undone') {
			await this.run(this.did === 'delete' ? 'keep' : 'restore', 'done');
		}
	}

	private async run(action: 'keep' | 'restore', next: 'done' | 'undone'): Promise<void> {
		try {
			if (action === 'keep') {
				this.kept = await this.service.keep(this.items);
			} else {
				await this.service.restore(this.kept);
				this.kept = [];
			}
			this.state = next;
		} catch (error) {
			if (!(error instanceof BaseHalfKeptRefusal)) {
				throw error;
			}
			this.service.notify(error.message);
			this.state = 'over';
		}
	}
}

/** One step of the canvas undo that changed files in place: undo and redo swap each with its other version. */
class BaseHalfReplaceStep implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly code = 'basehalf.keptVersions.replace';
	readonly resources: readonly URI[] = [URI.from({ scheme: 'basehalf-kept', path: `/${generateUuid()}` })];
	private state: 'done' | 'undone' | 'over' = 'done';

	constructor(
		readonly label: string,
		private readonly files: readonly IBaseHalfKeptFile[],
		private readonly service: BaseHalfKeptVersionsService
	) { }

	async undo(): Promise<void> {
		if (this.state === 'done') {
			await this.run('undone');
		}
	}

	async redo(): Promise<void> {
		if (this.state === 'undone') {
			await this.run('done');
		}
	}

	private async run(next: 'done' | 'undone'): Promise<void> {
		const done: IBaseHalfKeptFile[] = [];
		try {
			for (const file of this.files) {
				await this.service.swap(file);
				done.push(file);
			}
			this.state = next;
		} catch (error) {
			for (const file of done.reverse()) {
				await this.service.swap(file).catch(() => undefined);
			}
			if (!(error instanceof BaseHalfKeptRefusal)) {
				throw error;
			}
			this.service.notify(error.message);
			this.state = 'over';
		}
	}
}

/** The items that are not inside another of them, each once. */
function topmost(items: readonly URI[]): URI[] {
	const unique = [...new Map(items.map(item => [item.toString(), item])).values()];
	return unique.filter(item => !unique.some(other => other !== item && isEqualOrParent(item, other)));
}

function byWorkspaceFolder<T extends { readonly workspaceFolder: URI }>(items: readonly T[]): T[][] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = item.workspaceFolder.toString();
		groups.set(key, [...groups.get(key) ?? [], item]);
	}
	return [...groups.values()];
}

registerSingleton(IBaseHalfKeptVersionsService, BaseHalfKeptVersionsService, InstantiationType.Delayed);
