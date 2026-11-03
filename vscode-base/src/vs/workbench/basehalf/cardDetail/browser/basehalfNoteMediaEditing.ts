/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfNoteMediaEditing.css';
import { $, addDisposableListener, append, getWindow, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, isEqualOrParent, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { RedoCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS, baseHalfCanvasMediaVersion } from '../../canvas/browser/basehalfCanvasCardMedia.js';
import { baseHalfNoteStoresAbove } from '../../markdown/common/basehalfMarkdownAttachment.js';
import { resolveBaseHalfNoteLink } from '../../markdown/common/basehalfNoteLinks.js';
import { IBaseHalfMediaChoices, normalizeBaseHalfMediaChoices } from '../../mediaEdit/common/basehalfEditRecord.js';
import { BaseHalfMediaEditing } from '../../mediaEdit/browser/basehalfMediaEditing.js';
import { IBaseHalfMediaEditService } from '../../mediaEdit/browser/basehalfMediaEditService.js';
import { baseHalfNotePictureEditorBox, baseHalfNoteMediaEditorFit, type IBaseHalfNoteMediaBox } from '../../mediaEdit/common/basehalfNoteMediaEdit.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';

/** A picture of a note that its Edit opened (D113). */
export interface IBaseHalfNoteMediaEditingTarget {
	/** The note the picture is in. */
	readonly note: URI;
	readonly blockId: string;
	/** The picture's address in the note. */
	readonly href: string;
	/** Where the picture stands in the frame of Rich's page. */
	readonly box: IBaseHalfNoteMediaBox;
}

/** What the editing of a picture needs of Card Detail's rich projection. */
export interface IBaseHalfNoteMediaEditingHost {
	/** The layer over Rich's page in which the editor is drawn: it has the place and the size of the page's frame. */
	readonly layer: HTMLElement;
	/**
	 * The editing ended: Rich shows the picture's file at `version`, hidden
	 * under the editor, and closes the room it made under the picture; a
	 * `step` when the edit changed the file, which Rich keeps as one step of
	 * the note's undo.
	 */
	ended(blockId: string, version: string | undefined, step: IBaseHalfNoteMediaEditStep | undefined): void;
	/** The editor shows over the picture: Rich hides its own under it, where the editor may draw the picture smaller. */
	hide(blockId: string): void;
	/** The editor stands where Rich shows the picture now: Rich shows it again, and then the editing goes. */
	show(blockId: string): void;
}

/** The edit of a picture from Edit to Done, one step of the note's undo: the choices before and after it. */
export interface IBaseHalfNoteMediaEditStep {
	readonly before: IBaseHalfMediaChoices;
	readonly after: IBaseHalfMediaChoices;
}

/** How long the editor glides to where the note shows the picture once its editing ended, and into the view at Edit, in milliseconds. */
const END_GLIDE_MILLISECONDS = 200;

/** Above the canvas's undo and Rich's: while the editor of a picture has the keyboard, Command+Z undoes its changes. */
const NOTE_MEDIA_UNDO_REDO_PRIORITY = 120;

/**
 * A picture edited in its note (D113): the editor of the picture's card,
 * drawn by the window over the picture where Rich shows it, as the picture's
 * card would draw it, with the same tools, the same line, and the same writes
 * of the file. It shows once the picture is drawn in it, so that nothing of
 * the note flashes, and Done, Escape, and a press in the note go back to the
 * note, which shows the file as it is then.
 */
export class BaseHalfNoteMediaEditing extends Disposable {

	private editing: BaseHalfMediaEditing | undefined;
	private file: IBaseHalfWorkspaceResource | undefined;
	private stage: HTMLElement | undefined;
	private ending: Promise<void> | undefined;
	private shown = false;
	/** The choices when Edit was pressed, and the steps of the editor's own undo since. */
	private initial: IBaseHalfMediaChoices = {};
	private readonly undoSteps: IBaseHalfNoteMediaEditStep[] = [];
	private readonly redoSteps: IBaseHalfNoteMediaEditStep[] = [];

	constructor(
		readonly target: IBaseHalfNoteMediaEditingTarget,
		private readonly host: IBaseHalfNoteMediaEditingHost,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBaseHalfMediaEditService private readonly mediaEditService: IBaseHalfMediaEditService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	/** Draws the editor over the picture, editing; false when the picture's file cannot be edited, as a picture on the web. */
	async start(): Promise<boolean> {
		const file = this.file = this.pictureFile();
		if (!file) {
			return false;
		}
		const editing = this.editing = this._register(this.instantiationService.createInstance(BaseHalfMediaEditing, file));
		const session = await editing.load();
		if (!session?.state.image || this._store.isDisposed) {
			return false;
		}
		this.initial = editing.choices ?? {};
		// The changes are steps of the editor's own, and the whole edit one step of the note's at Done.
		editing.ownSteps = (before, after) => {
			this.undoSteps.push({ before, after });
			this.redoSteps.length = 0;
		};
		this._register(UndoCommand.addImplementation(NOTE_MEDIA_UNDO_REDO_PRIORITY, 'basehalfNoteMediaEdit', () => this.hasKeyboard() && this.undo()));
		this._register(RedoCommand.addImplementation(NOTE_MEDIA_UNDO_REDO_PRIORITY, 'basehalfNoteMediaEdit', () => this.hasKeyboard() && this.redo()));
		const stage = this.stage = append(this.host.layer, $('.basehalf-note-media-stage'));
		this._register({ dispose: () => stage.remove() });
		placeStage(stage, this.target.box);
		// Hidden until the picture is drawn in it: the note's own picture shows meanwhile.
		stage.classList.add('drawing');
		// Drawn editing from the start, so that what shows first is laid out as it stays.
		const shown = editing.show({ stage, editing: true });
		await raceTimeout(shown?.drawn ?? Promise.resolve(), BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS);
		// One frame more, hidden: the editor lays out its picture again once the line under it is there.
		await new Promise<void>(resolve => this._register(scheduleAtNextAnimationFrame(getWindow(stage), resolve)));
		if (this._store.isDisposed) {
			return false;
		}
		stage.classList.remove('drawing');
		this.host.hide(this.target.blockId);
		// The first frame that shows the editor shows it where the note's picture is; it moves from the next.
		this._register(scheduleAtNextAnimationFrame(getWindow(stage), () => {
			if (!this.ending) {
				this.comeIntoView(stage, editing);
			}
		}));
		const done = append(stage, $<HTMLButtonElement>('button.basehalf-note-media-done'));
		done.type = 'button';
		done.textContent = localize('basehalf.noteMediaEdit.done', "Done");
		this._register(addDisposableListener(done, 'mousedown', event => event.preventDefault()));
		this._register(addDisposableListener(done, 'click', () => void this.end()));
		// Escape goes back to the note once the editor has used it, as for a drag it puts back.
		this._register(addDisposableListener(stage, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented) {
				event.preventDefault();
				event.stopPropagation();
				void this.end();
			}
		}));
		editing.focus();
		return true;
	}

	/** Goes back to the note: the editor views the file, the file follows at once, and Rich shows it at its new version. */
	end(): Promise<void> {
		this.ending ??= (async () => {
			this.editing?.setEditing(false);
			this.stage?.classList.add('ending');
			const final = this.editing?.choices;
			const step = final && !sameChoices(this.initial, final) ? { before: this.initial, after: final } : undefined;
			const resource = this.file?.resource;
			if (resource) {
				await this.mediaEditService.flush(resource);
			}
			const stat = resource ? await this.fileService.stat(resource).catch(() => undefined) : undefined;
			this.host.ended(this.target.blockId, stat ? baseHalfCanvasMediaVersion(stat) : undefined, step);
		})();
		return this.ending;
	}

	/**
	 * Rich laid out the picture at its new version at `box`, hidden under
	 * the editor, and closed the room under it: the editor glides there, as
	 * the crop it kept fits that box, and then Rich shows its own picture.
	 */
	laidOut(box: IBaseHalfNoteMediaBox | undefined): void {
		const stage = this.stage;
		if (!stage || !box || this.shown) {
			this.showMedia();
			return;
		}
		const window = getWindow(stage);
		if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			stage.style.transition = ['left', 'top', 'width', 'height'].map(property => `${property} ${END_GLIDE_MILLISECONDS}ms cubic-bezier(0.25, 1, 0.5, 1)`).join(', ');
		}
		const moved = placeStage(stage, box);
		const timer = window.setTimeout(() => this.showMedia(), moved && stage.style.transition ? END_GLIDE_MILLISECONDS : 0);
		this._register(toDisposable(() => window.clearTimeout(timer)));
	}

	/**
	 * Once the editor shows: one whose tools would fall below the view glides
	 * into it, as large as fits above them, and then the whole original glides
	 * out around the part kept (D113).
	 */
	private comeIntoView(stage: HTMLElement, editing: BaseHalfMediaEditing): void {
		const fitted = baseHalfNoteMediaEditorFit(this.target.box, this.host.layer.clientHeight);
		if (fitted === this.target.box) {
			editing.showWhole();
			return;
		}
		const window = getWindow(stage);
		const glide = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		if (glide) {
			stage.style.transition = ['left', 'top', 'width', 'height'].map(property => `${property} ${END_GLIDE_MILLISECONDS}ms cubic-bezier(0.25, 1, 0.5, 1)`).join(', ');
		}
		placeStage(stage, fitted);
		// The whole original glides out once the editor has its last size: a new size lays the picture out at rest again.
		let shown = false;
		const showWhole = () => {
			if (!shown && !this.ending && !this._store.isDisposed) {
				shown = true;
				this._register(scheduleAtNextAnimationFrame(window, () => this._register(scheduleAtNextAnimationFrame(window, () => {
					if (!this.ending) {
						editing.showWhole();
					}
				}))));
			}
		};
		if (glide) {
			this._register(addDisposableListener(stage, 'transitionend', (event: TransitionEvent) => {
				if (event.target === stage && event.propertyName === 'height') {
					showWhole();
				}
			}));
		}
		const timer = window.setTimeout(showWhole, glide ? END_GLIDE_MILLISECONDS + 100 : 0);
		this._register(toDisposable(() => window.clearTimeout(timer)));
	}

	/** Whether the keyboard is in the editor while it edits. */
	private hasKeyboard(): boolean {
		const stage = this.stage;
		return !this.ending && !!stage && stage.contains(stage.ownerDocument.activeElement);
	}

	/** Command+Z while editing: the editor's last change goes, and nothing else changes, also when there is none. */
	private undo(): boolean {
		const step = this.undoSteps.pop();
		if (step) {
			this.redoSteps.push(step);
			this.editing?.setChoices(step.before);
		}
		return true;
	}

	private redo(): boolean {
		const step = this.redoSteps.pop();
		if (step) {
			this.undoSteps.push(step);
			this.editing?.setChoices(step.after);
		}
		return true;
	}

	private showMedia(): void {
		if (!this.shown && !this._store.isDisposed) {
			this.shown = true;
			this.host.show(this.target.blockId);
		}
	}

	private pictureFile(): IBaseHalfWorkspaceResource | undefined {
		return baseHalfNoteMediaFile(this.workspaceContextService.getWorkspace().folders.map(folder => folder.uri), this.target.note, this.target.href);
	}
}

/**
 * The file of a picture's address in a note, read from the note's folder: a
 * file of the workspace, or of a store above a workspace folder, which a
 * window of a subfolder shows its notes' files from (files in notes, rule
 * 48), with its card information in the mirror of that store's home. None
 * for an address elsewhere.
 */
export function baseHalfNoteMediaFile(folders: readonly URI[], note: URI, href: string): IBaseHalfWorkspaceResource | undefined {
	const stores = folders.flatMap(folder => baseHalfNoteStoresAbove(folder));
	const target = resolveBaseHalfNoteLink(note, [...folders, ...stores], href);
	if (target.kind !== 'file') {
		return undefined;
	}
	for (const folder of folders) {
		const path = isEqualOrParent(target.uri, folder) ? relativePath(folder, target.uri) : undefined;
		if (path !== undefined) {
			return { resource: target.uri, workspaceFolder: folder, relativePath: path };
		}
	}
	for (const store of stores) {
		// The store's home is the folder that holds its `.bh`.
		const home = dirname(dirname(store));
		const path = isEqualOrParent(target.uri, store) ? relativePath(home, target.uri) : undefined;
		if (path) {
			return { resource: target.uri, workspaceFolder: home, relativePath: path };
		}
	}
	return undefined;
}

/**
 * The undo or the redo of the edit of a picture of a note, as the note's undo
 * keeps it (D113): the picture's file gets `choices`, at once, and the version
 * it has then is what the note shows; none when it did not change, which the
 * service says.
 */
export function applyBaseHalfNoteMediaChoices(accessor: ServicesAccessor, note: URI, href: string, choices: IBaseHalfMediaChoices): Promise<string | undefined> {
	const file = baseHalfNoteMediaFile(accessor.get(IWorkspaceContextService).getWorkspace().folders.map(folder => folder.uri), note, href);
	const mediaEditService = accessor.get(IBaseHalfMediaEditService);
	const fileService = accessor.get(IFileService);
	return (async () => {
		if (!file || !await mediaEditService.applyChoices(file.resource, choices).catch(() => false)) {
			return undefined;
		}
		await mediaEditService.flush(file.resource);
		const stat = await fileService.stat(file.resource).catch(() => undefined);
		return stat ? baseHalfCanvasMediaVersion(stat) : undefined;
	})();
}

function sameChoices(a: IBaseHalfMediaChoices, b: IBaseHalfMediaChoices): boolean {
	return JSON.stringify(normalizeBaseHalfMediaChoices(a)) === JSON.stringify(normalizeBaseHalfMediaChoices(b));
}

/** Puts the editor where it draws the picture at the picture's box; says whether it moved. */
function placeStage(stage: HTMLElement, picture: IBaseHalfNoteMediaBox): boolean {
	const box = baseHalfNotePictureEditorBox(picture);
	const before = [stage.style.left, stage.style.top, stage.style.width, stage.style.height].join();
	stage.style.left = `${box.left}px`;
	stage.style.top = `${box.top}px`;
	stage.style.width = `${box.width}px`;
	stage.style.height = `${box.height}px`;
	return [stage.style.left, stage.style.top, stage.style.width, stage.style.height].join() !== before;
}
