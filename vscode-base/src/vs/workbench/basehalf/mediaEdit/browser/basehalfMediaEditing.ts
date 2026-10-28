/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfMediaEditing.css';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCanvasCardVideoPlayer } from '../../canvas/browser/basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfEditSummary, IBaseHalfMediaChoices, normalizeBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import { BaseHalfImageCropView } from './basehalfImageCropView.js';
import { BaseHalfMediaChange, BaseHalfPlayheadMove, IBaseHalfMediaEditor } from './basehalfMediaEditor.js';
import { baseHalfMediaFileByteSource, IBaseHalfEditVideo, IBaseHalfMediaEditService, IBaseHalfMediaEditState } from './basehalfMediaEditService.js';
import { BaseHalfSoundWaveform } from './basehalfSoundWaveform.js';
import { BaseHalfVideoFrameViewer } from './basehalfVideoFrameViewer.js';

/**
 * The editing of a media file in Card Detail (editing media, "Editing in Card
 * Detail"): reads what its editor starts from and makes the copy of it that
 * the editor reads; draws the editor where Card Detail gives it room, with the
 * line under it; gives each change to the service, as one step of the canvas
 * undo that the file follows; and shows in the editor the choices that an
 * undo, a redo, or Revert to Original set. The editor starts by viewing the
 * file, and Edit and Done of Card Detail's header go to editing and back
 * ("Viewing and editing").
 */

/** What an editor of the file starts from, read for Card Detail. */
export interface IBaseHalfMediaEditingSession {
	readonly state: IBaseHalfMediaEditState;
	/** The copy of the state's source that the editor reads, and the player of a video plays. */
	readonly source: URI;
	/** A video's index, with its bytes read from the copy. */
	readonly video?: IBaseHalfEditVideo;
	/** The time of the source where the file's time 0 is, as the file is now: the start of the part its edit keeps. */
	readonly offset: number;
}

/** Where Card Detail gives the editor room: a stage, with the player of a video. */
export interface IBaseHalfMediaEditingView {
	readonly stage: HTMLElement;
	readonly player?: IBaseHalfCanvasCardVideoPlayer;
	/**
	 * Where the editor and the line under it stand when not in the stage
	 * itself: the room under the player of a video, which opens while it is
	 * edited (editing media, "What Card Detail shows", D102).
	 */
	readonly room?: HTMLElement;
}

/** How often the copy is made anew when the file changed while it was made. */
const COPY_ATTEMPTS = 2;

/** How long a write runs before the line under the editor says "Saving…" (editing media, "What Card Detail shows"). */
const SAVING_TOLD_AFTER_MS = 1000;

export class BaseHalfMediaEditing extends Disposable {

	private session: IBaseHalfMediaEditingSession | undefined;
	private readonly sessionStore = this._register(new MutableDisposable<DisposableStore>());
	private readonly editorStore = this._register(new MutableDisposable<DisposableStore>());
	private editor: IBaseHalfMediaEditor | undefined;
	/** Where Card Detail gave the editor room. */
	private stage: HTMLElement | undefined;
	private line: IEditLine | undefined;
	/** Shows "Saving…" once a write has run long enough to be told. */
	private readonly savingTimer = this._register(new MutableDisposable());
	/** The editor edits the file; otherwise it views it. */
	private editing = false;
	private disposed = false;

	private readonly onDidChangeEditingEmitter = this._register(new Emitter<boolean>());
	/** The editor went to editing or back to viewing. */
	readonly onDidChangeEditing = this.onDidChangeEditingEmitter.event;

	constructor(
		private readonly file: IBaseHalfWorkspaceResource,
		@IBaseHalfMediaEditService private readonly mediaEditService: IBaseHalfMediaEditService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		// A failure of a write of the file is said under its editor, not in a notification.
		this._register(this.mediaEditService.showFile(file.resource));
		this._register(this.mediaEditService.onDidChangeChoices(resource => {
			if (isEqual(resource, file.resource)) {
				this.followChoices();
			}
		}));
		this._register(this.mediaEditService.onDidChangeWriting(resource => {
			if (isEqual(resource, file.resource)) {
				this.renderLine();
			}
		}));
		this._register(toDisposable(() => {
			this.disposed = true;
			// The file follows at once what waits for its rest: Card Detail closes, or shows another file.
			void this.mediaEditService.flush(file.resource);
		}));
	}

	/**
	 * Reads anew what the editor starts from, and makes the copy that it reads;
	 * nothing when BaseHalf can't edit the file, which Card Detail then shows
	 * as a plain view.
	 */
	async load(): Promise<IBaseHalfMediaEditingSession | undefined> {
		this.editorStore.clear();
		this.editor = undefined;
		this.session = undefined;
		for (let attempt = 0; attempt < COPY_ATTEMPTS; attempt++) {
			const state = await this.mediaEditService.readEditState(this.file);
			if (this.disposed || state.unavailable) {
				return undefined;
			}
			let copy;
			try {
				copy = await this.mediaEditService.copySource(this.file, state);
			} catch {
				// The file changed while the copy was made: what it starts from is read anew.
				continue;
			}
			const store = new DisposableStore();
			store.add(copy);
			if (this.disposed) {
				store.dispose();
				return undefined;
			}
			this.sessionStore.value = store;
			const written = state.record?.keep?.[0];
			this.session = {
				state,
				source: copy.resource,
				...(state.video ? { video: { file: state.video.file, source: baseHalfMediaFileByteSource(this.fileService, copy.resource, state.video.source.size) } } : {}),
				offset: state.kind === 'video' && written ? written.start : 0
			};
			return this.session;
		}
		return undefined;
	}

	/** Draws the editor of the loaded file where Card Detail gives it room, with the line under it. */
	show(view: IBaseHalfMediaEditingView): { readonly drawn: Promise<void> } | undefined {
		const session = this.session;
		if (!session) {
			return undefined;
		}
		const store = new DisposableStore();
		this.editorStore.value = store;
		const { state } = session;
		const choices = this.mediaEditService.choicesOf(this.file.resource, state);
		const host = view.room ?? view.stage;
		let editor: IBaseHalfMediaEditor;
		let drawn = Promise.resolve();
		if (session.video && view.player) {
			editor = store.add(new BaseHalfVideoFrameViewer(host, { video: session.video, player: view.player, stage: view.stage, choices }));
		} else if (state.image) {
			const crop = store.add(this.instantiationService.createInstance(BaseHalfImageCropView, host, { source: session.source, size: { width: state.image.width, height: state.image.height }, choices }));
			drawn = crop.drawn;
			editor = crop;
		} else if (state.sound) {
			editor = store.add(this.instantiationService.createInstance(BaseHalfSoundWaveform, host, { source: session.source, info: state.sound, choices }));
		} else {
			return undefined;
		}
		this.editor = editor;
		this.stage = view.stage;
		editor.setEditing(this.editing);
		view.stage.classList.add('basehalf-media-editing');
		// The stage says whether the editor edits: a video's makes room for it then (D102).
		view.stage.classList.toggle('basehalf-media-edit-active', this.editing);
		store.add(toDisposable(() => {
			view.stage.classList.remove('basehalf-media-editing', 'basehalf-media-edit-active');
			if (this.editor === editor) {
				this.editor = undefined;
				this.stage = undefined;
				this.line = undefined;
			}
		}));
		store.add(editor.onDidChange(change => this.mediaEditService.change(this.file, state, editor.choices, this.stepLabel(change))));
		this.line = this.createLine(host, store);
		this.renderLine();
		return { drawn };
	}

	/** Whether the editor shows. */
	get hasEditor(): boolean {
		return !!this.editor;
	}

	/** Whether the editor edits the file, rather than views it. */
	get isEditing(): boolean {
		return this.editing && !!this.editor;
	}

	/** Goes to editing, as Edit does, or back to viewing, as Done and Escape do; nothing of the file changes. */
	setEditing(editing: boolean): void {
		const editor = this.editor;
		if (!editor || editing === this.editing) {
			return;
		}
		// A control of editing that goes with the editing would drop the keyboard to the window's body,
		// where Escape and Command+Z reach nothing: it goes to what viewing has instead.
		const targetDocument = this.stage?.ownerDocument;
		const keyboardInEditor = !!targetDocument?.activeElement && !!this.stage?.contains(targetDocument.activeElement);
		this.editing = editing;
		editor.setEditing(editing);
		this.stage?.classList.toggle('basehalf-media-edit-active', editing);
		this.renderLine();
		if (!editing && keyboardInEditor) {
			editor.focus();
		}
		this.onDidChangeEditingEmitter.fire(editing);
	}

	/** Moves the playhead of the editor's video or sound by the keyboard; says whether there is one (editing media, "The keyboard"). */
	movePlayhead(move: BaseHalfPlayheadMove): boolean {
		const editor = this.editor;
		if (!editor?.movePlayhead) {
			return false;
		}
		editor.movePlayhead(move);
		return true;
	}

	/** Plays or pauses the editor's video or sound, as Space does; says whether there is one (editing media, "The keyboard"). */
	togglePlay(): boolean {
		const editor = this.editor;
		if (!editor?.togglePlay) {
			return false;
		}
		editor.togglePlay();
		return true;
	}

	/** Puts the keyboard on the media (D100). */
	focus(): void {
		this.editor?.focus();
	}

	/** An undo, a redo, or Revert to Original set other choices: the editor shows them. */
	private followChoices(): void {
		const session = this.session;
		const editor = this.editor;
		if (session && editor) {
			const choices = this.mediaEditService.choicesOf(this.file.resource, session.state);
			if (!sameChoices(choices, editor.choices)) {
				editor.setChoices(choices);
			}
		}
		this.renderLine();
	}

	private stepLabel(change: BaseHalfMediaChange): string {
		const name = basename(this.file.resource);
		switch (change) {
			case 'trim': return localize('basehalf.mediaEdit.step.trim', "Trim {0}", name);
			case 'cut': return localize('basehalf.mediaEdit.step.cut', "Cut {0}", name);
			case 'crop': return localize('basehalf.mediaEdit.step.crop', "Crop {0}", name);
			case 'turn': return localize('basehalf.mediaEdit.step.turn', "Turn {0}", name);
			case 'flip': return localize('basehalf.mediaEdit.step.flip', "Flip {0}", name);
			case 'straighten': return localize('basehalf.mediaEdit.step.straighten', "Straighten {0}", name);
		}
	}

	// #region The line under the editor

	/**
	 * The line under the editor: what the edit is and Revert to Original, then
	 * "Saving…" while the file is written; the failure of a write with Try
	 * Again; nothing for a file that was never edited. Its parts stay while
	 * their text changes, so that the keyboard stays on its buttons.
	 */
	private createLine(stage: HTMLElement, store: DisposableStore): IEditLine {
		const element = append(stage, $('.basehalf-media-edit-line'));
		element.setAttribute('aria-live', 'polite');
		store.add(toDisposable(() => element.remove()));
		// Each part stands in a span of its own, which the dot between parts goes into.
		const part = (child: string) => append(append(element, $('span.basehalf-media-edit-line-part')), $(child));
		const summary = part('span.basehalf-media-edit-line-summary');
		const revert = part('button.basehalf-media-edit-line-action.revert') as HTMLButtonElement;
		revert.type = 'button';
		revert.textContent = localize('basehalf.mediaEdit.line.revert', "Revert to Original");
		const saving = part('span.basehalf-media-edit-line-saving');
		const failure = part('span.basehalf-media-edit-line-failure');
		const retry = part('button.basehalf-media-edit-line-action.retry') as HTMLButtonElement;
		retry.type = 'button';
		retry.textContent = localize('basehalf.mediaEdit.line.tryAgain', "Try Again");
		// A press on the line is the line's: it reaches neither the editor nor the canvas.
		for (const type of ['mousedown', 'pointerdown', 'click', 'dblclick'] as const) {
			store.add(addDisposableListener(element, type, event => event.stopPropagation()));
		}
		// The button goes once it is used: the keyboard goes to the editor, where Command+Z undoes what it did.
		const keepKeyboard = (button: HTMLElement, action: () => void) => store.add(addDisposableListener(button, 'click', () => {
			const focused = button.ownerDocument.activeElement === button;
			action();
			if (focused && button.parentElement?.hidden) {
				this.editor?.focus();
			}
		}));
		keepKeyboard(revert, () => {
			if (this.session) {
				this.mediaEditService.revertToOriginal(this.file, this.session.state);
			}
		});
		keepKeyboard(retry, () => this.mediaEditService.retry(this.file.resource));
		return { element, summary, revert, saving, failure, retry };
	}

	private renderLine(): void {
		const line = this.line;
		const session = this.session;
		if (!line || !session || this.disposed) {
			return;
		}
		const choices = this.mediaEditService.choicesOf(this.file.resource, session.state);
		const writing = this.mediaEditService.writing(this.file.resource);
		const failed = writing?.state === 'failed';
		// What the edit is, and Revert to Original, show while editing; a write and its failure concern the file, and show while viewing too.
		let summary = this.editing ? baseHalfEditSummary(choices) : undefined;
		if (summary && this.mediaEditService.soundDropped(this.file.resource)) {
			summary = localize('basehalf.mediaEdit.line.withoutSound', "{0} · Without sound: BaseHalf can't write this video's sound here", summary);
		}
		const show = (element: HTMLElement, shown: boolean) => element.parentElement!.hidden = !shown;
		line.summary.textContent = !failed ? summary ?? '' : '';
		show(line.summary, !failed && !!summary);
		show(line.revert, !failed && !!summary);
		// A write that ends within a second shows nothing: most do (D99).
		const running = writing?.state === 'writing' ? Date.now() - (writing.since ?? 0) : undefined;
		const saving = running !== undefined && running >= SAVING_TOLD_AFTER_MS;
		this.savingTimer.value = running !== undefined && !saving ? disposableTimeout(() => this.renderLine(), SAVING_TOLD_AFTER_MS - running) : undefined;
		show(line.saving, saving);
		line.saving.textContent = saving
			? localize('basehalf.mediaEdit.line.saving', "Saving… {0}%", Math.round((writing?.done ?? 0) * 100))
			: '';
		show(line.failure, failed);
		line.failure.textContent = failed ? localize('basehalf.mediaEdit.line.failed', "BaseHalf could not save the edit: {0}", writing.failure ?? '') : '';
		show(line.retry, failed);
	}

	// #endregion
}

interface IEditLine {
	readonly element: HTMLElement;
	readonly summary: HTMLElement;
	readonly revert: HTMLButtonElement;
	readonly saving: HTMLElement;
	readonly failure: HTMLElement;
	readonly retry: HTMLButtonElement;
}

function sameChoices(a: IBaseHalfMediaChoices, b: IBaseHalfMediaChoices): boolean {
	return JSON.stringify(normalizeBaseHalfMediaChoices(a)) === JSON.stringify(normalizeBaseHalfMediaChoices(b));
}
