/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { baseHalfApplyNoteRouteEdits, baseHalfNoteFileRouteEdits } from '../common/basehalfNoteFileRoutes.js';

/** How long the file events of a folder are quiet before the notes that appeared are read (files in notes, rule 30). */
const QUIET_MS = 300;
/** The most notes of one moved folder that are read. */
const MAX_NOTES = 2000;
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['.bh', '.git', 'node_modules']);

/**
 * A note moved to another depth, in BaseHalf or outside it, gets the route
 * of each of its links into the store that leads nowhere corrected, and
 * nothing else (files in notes, rules 29, 30, and 32). An open note takes the
 * correction as one edit of its text, which its editor's undo stops at.
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
		@ILogService private readonly logService: ILogService
	) {
		super();
		// A move in BaseHalf: the moved notes, once the move is done (rule 29).
		this._register(workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.MOVE) {
				for (const { target } of event.files) {
					this.add(target);
				}
			}
		}));
		// A move outside BaseHalf: the notes that appeared (rule 30).
		this._register(this.fileService.onDidFilesChange(event => {
			for (const resource of event.rawAdded) {
				this.add(resource);
			}
		}));
	}

	private add(resource: URI): void {
		const folder = this.contextService.getWorkspaceFolder(resource)?.uri;
		const path = folder ? relativePath(folder, resource) : undefined;
		if (!path || path.split('/').some(segment => SKIPPED_FOLDERS.has(segment))) {
			return;
		}
		this.pending.add(resource);
		this.scheduler.schedule();
	}

	private async flush(): Promise<void> {
		const resources = [...this.pending];
		this.pending.clear();
		for (const resource of resources) {
			const workspaceFolder = this.contextService.getWorkspaceFolder(resource)?.uri;
			if (!workspaceFolder) {
				continue;
			}
			for (const note of await this.notesAt(resource)) {
				await this.correct(workspaceFolder, note).catch(error => this.logService.warn('[BaseHalf] could not correct the links of a moved note to its files', error));
			}
		}
	}

	/** The note at `resource`, or the notes in the folder at `resource`. */
	private async notesAt(resource: URI): Promise<URI[]> {
		const notes: URI[] = [];
		const queue = [resource];
		while (queue.length > 0 && notes.length < MAX_NOTES) {
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

	private async correct(workspaceFolder: URI, note: URI): Promise<void> {
		const model = this.textFileService.files.get(note);
		const textModel = model?.isResolved() ? model.textEditorModel : undefined;
		if (textModel) {
			const text = textModel.getValue();
			const edits = await baseHalfNoteFileRouteEdits(this.fileService, workspaceFolder, note, text);
			if (edits.length === 0 || textModel.isDisposed() || textModel.getValue() !== text) {
				return;
			}
			// One edit of the text, which the editor's undo stops at; the note is saved as any edit is.
			textModel.pushStackElement();
			textModel.pushEditOperations([], edits.map(edit => ({ range: Range.fromPositions(textModel.getPositionAt(edit.at), textModel.getPositionAt(edit.at + edit.length)), text: edit.text })), () => null);
			textModel.pushStackElement();
			return;
		}
		const content = await this.fileService.readFile(note).catch(() => undefined);
		if (!content) {
			return;
		}
		const text = content.value.toString();
		const edits = await baseHalfNoteFileRouteEdits(this.fileService, workspaceFolder, note, text);
		if (edits.length > 0) {
			// Written only over the bytes that were read.
			await this.fileService.writeFile(note, VSBuffer.fromString(baseHalfApplyNoteRouteEdits(text, edits)), { etag: content.etag, mtime: content.mtime });
		}
	}
}

function isNote(name: string): boolean {
	return /\.(?:md|markdown)$/i.test(name);
}

registerWorkbenchContribution2(BaseHalfNoteFileRoutesContribution.ID, BaseHalfNoteFileRoutesContribution, WorkbenchPhase.Eventually);
