/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { isEqual, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IBulkEditService, ResourceTextEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkingCopyFileService, SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfMovedItemsService } from '../../workspace/common/basehalfMovedItemsService.js';
import { baseHalfNoteHome } from '../common/basehalfMarkdownAttachment.js';
import { baseHalfCopyNoteFiles, baseHalfNoteFileCloneEdits } from '../common/basehalfNoteFileCopies.js';
import { baseHalfApplyNoteRouteEdits, baseHalfNoteFileRouteEdits, baseHalfNoteStoresBelow, IBaseHalfNoteFileRouteServices, IBaseHalfNoteRouteEdit } from '../common/basehalfNoteFileRoutes.js';

/** How long the file events of a folder are quiet before the notes that appeared are read (files in notes, rule 30). */
const QUIET_MS = 300;
/** The most notes of one moved folder that are read. */
const MAX_NOTES = 2000;
/** The most notes of one move that are read in its step; the others are corrected once their folder is quiet. */
const MAX_NOTES_IN_STEP = 200;
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['.bh', '.git', 'node_modules']);

/** A note's text as an editor holds it, or as the disk does for a note no editor holds. */
interface INoteText {
	readonly value: string;
	/** The version of the open note's text; none for a note no editor holds. */
	readonly versionId?: number;
	readonly dirty: boolean;
}

/**
 * A note moved to another depth, in BaseHalf or outside it, gets the route
 * of each of its links into the store that leads nowhere corrected, and
 * nothing else; a note moved into another home gets clones of its files in
 * that home's store (files in notes, rules 29 to 32). A move in BaseHalf is
 * corrected once it is done, in its own step of undo, with its undo source:
 * one undo where the move was made takes both back, and an editor of the
 * note leaves the edit to that place. A note that BaseHalf sees after a move
 * outside it is corrected on its own: an open note in a step of a BaseHalf
 * service, a closed note on the disk. At each open, once the comparison of
 * moved items is done, every note of the folder is read, so that a move made
 * while BaseHalf was closed is corrected also when the comparison did not
 * recognize it.
 */
export class BaseHalfNoteFileRoutesContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfNoteFileRoutes';

	private readonly pending = new ResourceSet();
	private readonly scheduler = this._register(new RunOnceScheduler(() => void this.flush(), QUIET_MS));

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfMovedItemsService movedItemsService: IBaseHalfMovedItemsService,
		@IBaseHalfFileClonesService private readonly fileClonesService: IBaseHalfFileClonesService,
		@IBulkEditService private readonly bulkEditService: IBulkEditService
	) {
		super();
		// A move in BaseHalf: once it is done and every editor holds its notes at their new places, the step of the move takes the corrections (rules 29 and 31).
		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: async (files, operation, undoInfo) => {
				if (operation !== FileOperation.MOVE) {
					return undefined;
				}
				return {
					dispose: () => { },
					afterPublicEvents: async succeeded => {
						// The undo or redo of a move takes the step's own edit back or again with it.
						if (succeeded && !undoInfo?.isUndoing) {
							await this.correctMoved(files, undoInfo?.undoRedoGroupId).catch(error => this.logService.warn('[BaseHalf] could not give a moved note its files', error));
						}
					}
				};
			}
		}));
		// A move made while BaseHalf was closed, recognized or not (rule 30).
		void Promise.all(this.contextService.getWorkspace().folders.map(async folder => {
			await movedItemsService.whenCompared(folder.uri);
			this.pending.add(folder.uri);
			this.scheduler.schedule();
		}));
		// A move outside BaseHalf: the notes that appeared (rule 30).
		this._register(this.fileService.onDidFilesChange(event => {
			for (const resource of event.rawAdded) {
				this.add(resource);
			}
		}));
		// A move made while BaseHalf was closed, recognized when the folder opens (rule 30).
		this._register(movedItemsService.onDidRecognize(({ workspaceFolder, moves }) => {
			for (const move of moves) {
				this.add(URI.joinPath(workspaceFolder, ...move.to.split('/')));
			}
		}));
	}

	/**
	 * The notes a move in BaseHalf moved, each given what its links need
	 * from its new place: clones in the new home's store when its home
	 * changed (rule 31), a folder that is a home carrying its store along
	 * (rule 32), else the routes (rule 29), all in one edit that joins the
	 * move's step. The edit is planned while the move waits and made once the
	 * move's own step is in place, so that an undo takes the edit back first,
	 * while its notes are still where the move put them, and a redo makes it
	 * again after the move. A note whose edit could not be planned is
	 * corrected once its folder is quiet.
	 */
	private async correctMoved(files: readonly SourceTargetPair[], undoRedoGroupId: number | undefined): Promise<void> {
		const services = this.routeServices();
		const edits: ResourceTextEdit[] = [];
		const toSave = new ResourceSet();
		for (const { source, target } of files) {
			const workspaceFolder = this.workspaceFolderOf(target);
			if (!source || !workspaceFolder) {
				continue;
			}
			const [from, to] = await Promise.all([
				baseHalfNoteHome(this.fileService, source, this.contextService.getWorkspaceFolder(source)?.uri ?? workspaceFolder),
				baseHalfNoteHome(this.fileService, target, workspaceFolder)
			]);
			const copies = { ...services, fileClonesService: this.fileClonesService, workspaceFolderOf: (resource: URI) => this.contextService.getWorkspaceFolder(resource)?.uri };
			// The move waits for what is read in its step; a folder of more notes is given its clones and corrections outside it, as BaseHalf writes notes no editor holds.
			const notes = await this.notesAt(target, MAX_NOTES_IN_STEP + 1);
			if (notes.length > MAX_NOTES_IN_STEP) {
				void (isEqual(from, to) ? Promise.resolve([]) : baseHalfCopyNoteFiles(copies, [{ source, target }]))
					.catch(error => this.logService.warn('[BaseHalf] could not give the notes of a moved folder their files', error))
					.finally(() => this.add(target));
				continue;
			}
			for (const note of notes) {
				const text = await this.textOf(note);
				if (!text) {
					continue;
				}
				const path = relativePath(target, note);
				const planned = isEqual(from, to)
					? await baseHalfNoteFileRouteEdits(services, workspaceFolder, note, text.value)
					: (await baseHalfNoteFileCloneEdits(copies, path ? joinPath(source, ...path.split('/')) : source, note, target, text.value))?.edits ?? [];
				if (planned.length > 0) {
					edits.push(...textEdits(note, text, planned));
					toSave.add(note);
				}
			}
		}
		// Not waited for: it is made once the move that waits for this is done.
		void this.apply(edits, toSave, undoRedoGroupId).catch(error => this.logService.warn('[BaseHalf] could not give a moved note its files', error));
	}

	/**
	 * Makes `edits` in one step of undo, with the canvas's undo source unless
	 * it joins a running step, once that step is done; saves each note that
	 * had no unsaved changes. Its undo and redo open a note again whose model
	 * is gone.
	 */
	private async apply(edits: readonly ResourceTextEdit[], notes: ResourceSet, undoRedoGroupId?: number): Promise<void> {
		if (edits.length === 0) {
			return;
		}
		const unsaved = [...notes].filter(note => !this.textFileService.isDirty(note));
		await this.bulkEditService.apply([...edits], {
			undoRedoGroupId,
			undoRedoAfterRunningEdit: true,
			undoRedoAcrossFiles: true,
			undoRedoSource: BASEHALF_CANVAS_UNDO_REDO_SOURCE,
			label: localize('basehalf.noteFiles.routes', "Correct Links to Notes' Files"),
			code: 'undoredo.basehalfNoteFileRoutes'
		});
		// Written as BaseHalf writes a note no editor holds; a note with changes of the user's keeps them unsaved.
		void Promise.all(unsaved.map(note => this.textFileService.save(note).catch(error => this.logService.warn('[BaseHalf] could not save a note whose links to its files were corrected', error))));
	}

	private routeServices(): IBaseHalfNoteFileRouteServices {
		let known: Promise<readonly URI[]> | undefined;
		return {
			fileService: this.fileService,
			fileClonesService: this.fileClonesService,
			// Looked for once a note needs them, once for all the notes of a pass.
			knownStores: () => known ??= Promise.all(this.contextService.getWorkspace().folders.map(folder => baseHalfNoteStoresBelow(this.fileService, folder.uri))).then(stores => stores.flat())
		};
	}

	/** The workspace folder of a resource that is not under a folder BaseHalf leaves alone. */
	private workspaceFolderOf(resource: URI): URI | undefined {
		const folder = this.contextService.getWorkspaceFolder(resource)?.uri;
		const path = folder ? relativePath(folder, resource) : undefined;
		return path === undefined || path.split('/').some(segment => SKIPPED_FOLDERS.has(segment)) ? undefined : folder;
	}

	private add(resource: URI): void {
		if (this.workspaceFolderOf(resource)) {
			this.pending.add(resource);
			this.scheduler.schedule();
		}
	}

	private async flush(): Promise<void> {
		const resources = [...this.pending];
		this.pending.clear();
		const services = this.routeServices();
		for (const resource of resources) {
			const workspaceFolder = this.contextService.getWorkspaceFolder(resource)?.uri;
			if (!workspaceFolder) {
				continue;
			}
			for (const note of await this.notesAt(resource)) {
				await this.correct(services, workspaceFolder, note).catch(error => this.logService.warn('[BaseHalf] could not correct the links of a moved note to its files', error));
			}
		}
	}

	/** The note at `resource`, or the notes in the folder at `resource`, at most `limit`. */
	private async notesAt(resource: URI, limit = MAX_NOTES): Promise<URI[]> {
		const notes: URI[] = [];
		const queue = [resource];
		while (queue.length > 0 && notes.length < limit) {
			const current = queue.shift()!;
			if (isNote(current.path)) {
				notes.push(current);
				continue;
			}
			const stat = await this.fileService.resolve(current).catch(() => undefined);
			for (const child of stat?.isDirectory ? stat.children ?? [] : []) {
				if (child.isDirectory ? !SKIPPED_FOLDERS.has(child.name) && !child.isSymbolicLink : isNote(child.name)) {
					queue.push(child.resource);
				}
			}
		}
		return notes;
	}

	private async textOf(note: URI): Promise<INoteText | undefined> {
		const model = this.textFileService.files.get(note);
		if (model?.isResolved()) {
			return { value: model.textEditorModel.getValue(), versionId: model.textEditorModel.getVersionId(), dirty: model.isDirty() };
		}
		const content = await this.textFileService.read(note).catch(() => undefined);
		return content && { value: content.value, dirty: false };
	}

	/** A note seen after a move outside BaseHalf (rule 30): an open note in a step of a BaseHalf service, a closed note on the disk. */
	private async correct(services: IBaseHalfNoteFileRouteServices, workspaceFolder: URI, note: URI): Promise<void> {
		// A note that moved on meanwhile, as by an undo right after a redo, is corrected where it went, never written back here.
		if (!await this.fileService.exists(note)) {
			return;
		}
		const model = this.textFileService.files.get(note);
		if (model?.isResolved()) {
			const text = { value: model.textEditorModel.getValue(), versionId: model.textEditorModel.getVersionId(), dirty: model.isDirty() };
			const edits = await baseHalfNoteFileRouteEdits(services, workspaceFolder, note, text.value);
			if (edits.length > 0 && !model.textEditorModel.isDisposed() && model.textEditorModel.getVersionId() === text.versionId) {
				await this.apply(textEdits(note, text, edits), new ResourceSet([note]));
			}
			return;
		}
		const content = await this.fileService.readFile(note).catch(() => undefined);
		if (!content) {
			return;
		}
		const text = content.value.toString();
		const edits = await baseHalfNoteFileRouteEdits(services, workspaceFolder, note, text);
		if (edits.length > 0) {
			// Written only over the bytes that were read.
			await this.fileService.writeFile(note, VSBuffer.fromString(baseHalfApplyNoteRouteEdits(text, edits)), { etag: content.etag, mtime: content.mtime });
		}
	}
}

/** The edits of a note's text as edits of the workspace, at the version they were planned on. */
function textEdits(note: URI, text: INoteText, edits: readonly IBaseHalfNoteRouteEdit[]): ResourceTextEdit[] {
	const lineStarts = [0];
	for (let index = text.value.indexOf('\n'); index >= 0; index = text.value.indexOf('\n', index + 1)) {
		lineStarts.push(index + 1);
	}
	const positionAt = (offset: number): Position => {
		let line = 0;
		for (let low = 0, high = lineStarts.length - 1; low <= high;) {
			const middle = (low + high) >> 1;
			if (lineStarts[middle] <= offset) {
				line = middle;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}
		return new Position(line + 1, offset - lineStarts[line] + 1);
	};
	return edits.map(edit => new ResourceTextEdit(note, { range: Range.fromPositions(positionAt(edit.at), positionAt(edit.at + edit.length)), text: edit.text }, text.versionId));
}

function isNote(name: string): boolean {
	return /\.(?:md|markdown)$/i.test(name);
}

registerWorkbenchContribution2(BaseHalfNoteFileRoutesContribution.ID, BaseHalfNoteFileRoutesContribution, WorkbenchPhase.AfterRestored);
