/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { MessageType } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { basename, dirname, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ResourceFileEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { localize } from '../../../../../nls.js';
import { baseHalfNoteTitle, baseHalfNoteTitleName, baseHalfNoteTitleNameNumbered } from '../../../markdown/common/basehalfNoteTitle.js';
import { baseHalfNoteFileName, baseHalfNoteNameExtension, isBaseHalfMarkdownResource } from '../../../workspace/common/basehalfItems.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';

/** A note that an editor of BaseHalf took up, and the title it had then. */
interface IBaseHalfNoteTitleEdit {
	readonly resource: URI;
	/** `undefined` for a note that had no title. */
	readonly titleBefore: string | undefined;
}

/** How long a note has to be let go before its file takes the title's name. */
const SETTLE_DELAY = 180;
/** How many numbers are tried for a name that is taken. */
const TAKEN_NAME_TRIES = 99;

/**
 * A note's title names its file (docs/specs/note-title.md): when an edit of
 * a note has ended and the edit changed the note's title, the file takes the
 * name of the title.
 *
 * An edit is the time an editor of BaseHalf holds the note: the editor on its
 * card, or Card Detail. The file is renamed once no editor holds the note,
 * no name is being typed for it, and no pointer is down, so that the rename
 * never takes a file from under what the user does next with its card.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasNoteTitles {
	private readonly edits = new Map<string, IBaseHalfNoteTitleEdit>();
	private readonly settle = this.view.register(new RunOnceScheduler(() => void this.followSettledEdits(), SETTLE_DELAY));
	/** The note Card Detail shows, by its comparison key. */
	private detailKey: string | undefined;
	private following = false;
	private pointerDown = false;
	private listening = false;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	/** An editor took the note up, with `text` as the note's text at that moment. */
	noteTakenUp(resource: URI, text: string): void {
		if (!isBaseHalfMarkdownResource(resource)) {
			return;
		}
		this.listen();
		const key = this.key(resource);
		// An edit that goes on in another editor, as from the card into Card
		// Detail, began with the title the first editor found.
		if (!this.edits.has(key)) {
			this.edits.set(key, { resource, titleBefore: baseHalfNoteTitle(text) });
		}
	}

	/** An editor let a note go. */
	noteLetGo(): void {
		if (this.edits.size > 0) {
			this.settle.schedule();
		}
	}

	/** Card Detail opened, closed, or shows another item. */
	cardDetailChanged(): void {
		const detail = this.view.canvasNavigationService.state.cardDetail;
		const resource = detail && isBaseHalfMarkdownResource(detail.resource) ? detail.resource : undefined;
		const key = resource ? this.key(resource) : undefined;
		if (key === this.detailKey) {
			return;
		}
		const left = this.detailKey !== undefined;
		this.detailKey = key;
		if (left) {
			this.noteLetGo();
		}
		if (resource && key && !this.edits.has(key)) {
			void this.readNote(resource).then(text => {
				if (text !== undefined && this.detailKey === key) {
					this.noteTakenUp(resource, text);
				}
			});
		}
	}

	private key(resource: URI): string {
		return this.view.uriIdentityService.extUri.getComparisonKey(resource);
	}

	private async readNote(resource: URI): Promise<string | undefined> {
		try {
			return (await this.view.fileService.readFile(resource)).value.toString();
		} catch {
			// Moved or removed.
			return undefined;
		}
	}

	private listen(): void {
		if (this.listening) {
			return;
		}
		this.listening = true;
		this.view.register(this.view.addDisposableListener(mainWindow, 'pointerdown', () => { this.pointerDown = true; }, true));
		for (const type of ['pointerup', 'pointercancel'] as const) {
			this.view.register(this.view.addDisposableListener(mainWindow, type, () => {
				this.pointerDown = false;
				this.noteLetGo();
			}, true));
		}
	}

	private isHeld(key: string): boolean {
		return key === this.detailKey || this.view.activeCanvasNoteEditor?.resourceKey === key;
	}

	private async followSettledEdits(): Promise<void> {
		// A press that began on a card may become a drag of it: its file keeps its name until the press ends.
		if (this.following || this.pointerDown) {
			this.settle.schedule();
			return;
		}
		this.following = true;
		try {
			for (const [key, edit] of [...this.edits]) {
				if (this.isHeld(key)) {
					continue;
				}
				this.edits.delete(key);
				try {
					await this.follow(edit);
				} catch (error) {
					this.view.reportCanvasMutationError(error);
				}
			}
		} finally {
			this.following = false;
		}
	}

	/** Gives the note's file the name of its title, when the edit changed the title. */
	private async follow(edit: IBaseHalfNoteTitleEdit): Promise<void> {
		const resource = edit.resource;
		const extUri = this.view.uriIdentityService.extUri;
		// A name that the user is typing for the note is the name it gets.
		const renaming = this.view.inlineEdit;
		if (renaming?.kind === 'rename' && extUri.isEqual(renaming.resource, resource)) {
			return;
		}
		const text = await this.readNote(resource);
		if (text === undefined) {
			return;
		}
		const title = baseHalfNoteTitle(text);
		if (title === undefined || title === edit.titleBefore) {
			return;
		}
		const fileName = basename(resource);
		const extension = baseHalfNoteNameExtension(fileName);
		const titleName = baseHalfNoteTitleName(title);
		if (!extension || !titleName) {
			return;
		}
		const parent = dirname(resource);
		let name: string | undefined;
		for (let count = 1; count <= TAKEN_NAME_TRIES && name === undefined; count++) {
			const candidate = baseHalfNoteFileName(count === 1 ? titleName : baseHalfNoteTitleNameNumbered(titleName, count), extension);
			if (candidate === fileName) {
				return;
			}
			if (!await this.view.pathService.hasValidBasename(parent, candidate)) {
				// A name the file system does not take: the note keeps its name.
				return;
			}
			const problem = await this.view.creation.validateCanvasEntryName(parent, candidate, resource);
			if (problem?.type !== MessageType.ERROR) {
				name = candidate;
			}
		}
		if (name === undefined || this.isHeld(this.key(resource)) || this.view.inlineEdit?.kind === 'rename') {
			return;
		}
		// A rename as the user's own in the rename editor: a step of the canvas's undo.
		await this.view.explorerService.applyBulkEdit([new ResourceFileEdit(resource, joinPath(parent, name))], {
			undoLabel: localize('basehalf.canvas.noteTitle.undo', "Rename {0} to {1}", fileName, name),
			progressLabel: localize('basehalf.canvas.noteTitle.progress', "Renaming {0}", fileName),
			confirmBeforeUndo: this.view.creation.confirmExplorerUndo(),
			undoRedoSource: this.view.canvasUndoRedoSource
		});
		this.view.requestRender();
	}
}
