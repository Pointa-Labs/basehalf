/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfNotePictureEditing.css';
import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS, baseHalfCanvasMediaVersion } from '../../canvas/browser/basehalfCanvasCardMedia.js';
import { resolveBaseHalfNoteLink } from '../../markdown/common/basehalfNoteLinks.js';
import { BaseHalfMediaEditing } from '../../mediaEdit/browser/basehalfMediaEditing.js';
import { IBaseHalfMediaEditService } from '../../mediaEdit/browser/basehalfMediaEditService.js';
import { baseHalfNotePictureEditorBox, type IBaseHalfNotePictureBox } from '../../mediaEdit/common/basehalfNotePictureEdit.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';

/** A picture of a note that its Edit opened (D113). */
export interface IBaseHalfNotePictureEditingTarget {
	/** The note the picture is in. */
	readonly note: URI;
	readonly blockId: string;
	/** The picture's address in the note. */
	readonly href: string;
	/** Where the picture stands in the frame of Rich's page. */
	readonly box: IBaseHalfNotePictureBox;
}

/** What the editing of a picture needs of Card Detail's rich projection. */
export interface IBaseHalfNotePictureEditingHost {
	/** The layer over Rich's page in which the editor is drawn: it has the place and the size of the page's frame. */
	readonly layer: HTMLElement;
	/** The editing ended: Rich shows the picture's file at `version`, hidden under the editor, and closes the room it made under the picture. */
	ended(blockId: string, version: string | undefined): void;
	/** The editor stands where Rich shows the picture now: Rich shows it again, and then the editing goes. */
	show(blockId: string): void;
}

/** How long the editor glides to where the note shows the picture once its editing ended, in milliseconds. */
const END_GLIDE_MILLISECONDS = 200;

/**
 * A picture edited in its note (D113): the editor of the picture's card,
 * drawn by the window over the picture where Rich shows it, as the picture's
 * card would draw it, with the same tools, the same line, and the same writes
 * of the file. It shows once the picture is drawn in it, so that nothing of
 * the note flashes, and Done, Escape, and a press in the note go back to the
 * note, which shows the file as it is then.
 */
export class BaseHalfNotePictureEditing extends Disposable {

	private editing: BaseHalfMediaEditing | undefined;
	private file: IBaseHalfWorkspaceResource | undefined;
	private stage: HTMLElement | undefined;
	private ending: Promise<void> | undefined;
	private shown = false;

	constructor(
		readonly target: IBaseHalfNotePictureEditingTarget,
		private readonly host: IBaseHalfNotePictureEditingHost,
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
		const stage = this.stage = append(this.host.layer, $('.basehalf-note-picture-stage'));
		this._register({ dispose: () => stage.remove() });
		placeStage(stage, this.target.box);
		// Hidden until the picture is drawn in it: the note's own picture shows meanwhile.
		stage.classList.add('drawing');
		const shown = editing.show({ stage });
		await raceTimeout(shown?.drawn ?? Promise.resolve(), BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS);
		if (this._store.isDisposed) {
			return false;
		}
		stage.classList.remove('drawing');
		editing.setEditing(true);
		const done = append(stage, $<HTMLButtonElement>('button.basehalf-note-picture-done'));
		done.type = 'button';
		done.textContent = localize('basehalf.notePictureEdit.done', "Done");
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
			const resource = this.file?.resource;
			if (resource) {
				await this.mediaEditService.flush(resource);
			}
			const stat = resource ? await this.fileService.stat(resource).catch(() => undefined) : undefined;
			this.host.ended(this.target.blockId, stat ? baseHalfCanvasMediaVersion(stat) : undefined);
		})();
		return this.ending;
	}

	/**
	 * Rich laid out the picture at its new version at `box`, hidden under
	 * the editor, and closed the room under it: the editor glides there, as
	 * the crop it kept fits that box, and then Rich shows its own picture.
	 */
	laidOut(box: IBaseHalfNotePictureBox | undefined): void {
		const stage = this.stage;
		if (!stage || !box || this.shown) {
			this.showPicture();
			return;
		}
		const window = getWindow(stage);
		if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			stage.style.transition = ['left', 'top', 'width', 'height'].map(property => `${property} ${END_GLIDE_MILLISECONDS}ms cubic-bezier(0.25, 1, 0.5, 1)`).join(', ');
		}
		const moved = placeStage(stage, box);
		const timer = window.setTimeout(() => this.showPicture(), moved && stage.style.transition ? END_GLIDE_MILLISECONDS : 0);
		this._register(toDisposable(() => window.clearTimeout(timer)));
	}

	private showPicture(): void {
		if (!this.shown && !this._store.isDisposed) {
			this.shown = true;
			this.host.show(this.target.blockId);
		}
	}

	/** The workspace file of the picture's address, read from the note's folder; none for an address outside the workspace. */
	private pictureFile(): IBaseHalfWorkspaceResource | undefined {
		const folders = this.workspaceContextService.getWorkspace().folders.map(folder => folder.uri);
		const target = resolveBaseHalfNoteLink(this.target.note, folders, this.target.href);
		if (target.kind !== 'file') {
			return undefined;
		}
		for (const folder of folders) {
			const path = relativePath(folder, target.uri);
			if (path !== undefined) {
				return { resource: target.uri, workspaceFolder: folder, relativePath: path };
			}
		}
		return undefined;
	}
}

/** Puts the editor where it draws the picture at the picture's box; says whether it moved. */
function placeStage(stage: HTMLElement, picture: IBaseHalfNotePictureBox): boolean {
	const box = baseHalfNotePictureEditorBox(picture);
	const before = [stage.style.left, stage.style.top, stage.style.width, stage.style.height].join();
	stage.style.left = `${box.left}px`;
	stage.style.top = `${box.top}px`;
	stage.style.width = `${box.width}px`;
	stage.style.height = `${box.height}px`;
	return [stage.style.left, stage.style.top, stage.style.width, stage.style.height].join() !== before;
}
