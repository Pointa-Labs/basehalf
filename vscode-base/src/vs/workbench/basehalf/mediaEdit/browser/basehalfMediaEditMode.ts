/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfMediaEditMode.css';
import { $, addDisposableListener, append, clearNode, getActiveElement } from '../../../../base/browser/dom.js';
import { toAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { RedoCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IBaseHalfCanvasCardVideoPlayer } from '../../canvas/browser/basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { setBaseHalfHover } from '../../shell/browser/basehalfHover.js';
import { IBaseHalfMediaChoices, normalizeBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import { baseHalfMediaChoicesAreNoEdit } from '../common/basehalfMediaEditFormats.js';
import { IBaseHalfMediaEditor } from './basehalfMediaEditor.js';
import { IBaseHalfMediaEditService, IBaseHalfMediaEditState, IBaseHalfMediaSaved } from './basehalfMediaEditService.js';
import { BaseHalfImageCropView } from './basehalfImageCropView.js';
import { BaseHalfVideoFrameViewer } from './basehalfVideoFrameViewer.js';

/**
 * Card Detail's edit mode for a media file (editing media, "Edit mode in
 * Card Detail"): Edit in the header, which shows the file's editor in place
 * of its view, with the original of an edited file and the choices of its
 * edit; then Revert, Cancel, and Done with its menu for Save as New; Escape,
 * which cancels; Enter on a control of the editor, which saves; and the
 * undo of the editor's own changes. Out of edit mode, a line under the view
 * says what the last step did.
 */

/** Card Detail, as edit mode uses it. */
export interface IBaseHalfMediaEditHost {
	/** The file Card Detail shows. */
	readonly file: IBaseHalfWorkspaceResource;
	/** The group of Card Detail's header where Edit, or Revert, Cancel, and Done, stand, before Close. */
	readonly header: HTMLElement;
	/** Card Detail: Escape and the undo of the editor reach edit mode from anywhere in it. */
	readonly detail: HTMLElement;
	/** Shows `source` anew in place of the view, from its start: the original in edit mode, the file out of it. */
	show(source: URI): void;
}

/**
 * What Card Detail drew: the stage that the editor, or out of edit mode the
 * line of the last step, goes into, and the player of a video in it.
 */
export interface IBaseHalfMediaEditView {
	readonly stage: HTMLElement;
	readonly player?: IBaseHalfCanvasCardVideoPlayer;
}

/** Above the undo of the canvas and of the editors of text, which have no keyboard while edit mode has it. */
const UNDO_REDO_PRIORITY = 10_100;

type HeaderAction = 'edit' | 'revert' | 'cancel' | 'done' | 'more';

interface IHeaderButton {
	readonly name: HeaderAction;
	readonly label: string;
	/** Why the button cannot act now, in the words of its hover. */
	readonly disabled?: string;
	readonly hover?: string;
}

interface IEditing {
	readonly state: IBaseHalfMediaEditState;
	/** The choices when Edit was pressed: Done stays disabled while the editor holds them. */
	readonly initial: IBaseHalfMediaChoices;
	editor?: IBaseHalfMediaEditor;
	/** The choices of an editor that Card Detail drew anew, as when the window changed its size. */
	choices?: IBaseHalfMediaChoices;
	busy: boolean;
	failure?: string;
}

export class BaseHalfMediaEditMode extends Disposable {

	private state: IBaseHalfMediaEditState | undefined;
	private editing: IEditing | undefined;
	private readonly editorStore = this._register(new MutableDisposable<DisposableStore>());
	private readonly headerStore = this._register(new DisposableStore());
	private readonly buttons = new Map<HeaderAction, HTMLButtonElement>();
	private stateVersion = 0;
	/** The keyboard goes to the editor once it shows. */
	private focusEditor = false;
	/** The keyboard goes to Edit once Card Detail shows the file again. */
	private focusEdit = false;
	private disposed = false;

	constructor(
		private readonly host: IBaseHalfMediaEditHost,
		@IBaseHalfMediaEditService private readonly mediaEditService: IBaseHalfMediaEditService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super();
		this._register(this.mediaEditService.showFile(host.file.resource));
		this._register(this.mediaEditService.onDidChangeSave(resource => {
			if (isEqual(resource, host.file.resource)) {
				this.renderHeader();
				this.renderStatus();
			}
		}));
		this._register(addDisposableListener(host.detail, 'keydown', event => this.onKeyDown(event)));
		this._register(UndoCommand.addImplementation(UNDO_REDO_PRIORITY, 'basehalfMediaEdit', () => this.undoRedo('undo')));
		this._register(RedoCommand.addImplementation(UNDO_REDO_PRIORITY, 'basehalfMediaEdit', () => this.undoRedo('redo')));
		this._register(toDisposable(() => {
			this.disposed = true;
			clearNode(host.header);
		}));
		this.renderHeader();
		void this.refresh();
	}

	get isEditing(): boolean {
		return !!this.editing;
	}

	/** Reads anew what Edit starts from, as after the file changed. */
	async refresh(): Promise<void> {
		const version = ++this.stateVersion;
		const state = await this.mediaEditService.readEditState(this.host.file);
		if (!this.disposed && version === this.stateVersion) {
			this.state = state;
			this.renderHeader();
		}
	}

	/** Card Detail drew the view: in edit mode the editor stands under the player, out of it the line of the last step. */
	didShow(view: IBaseHalfMediaEditView): void {
		const store = new DisposableStore();
		this.editorStore.value = store;
		view.stage.classList.toggle('basehalf-media-editing', !!this.editing);
		const editing = this.editing;
		if (!editing) {
			this.renderNote(view.stage, store);
			if (this.focusEdit) {
				this.focusEdit = false;
				this.headerButton('edit')?.focus({ preventScroll: true });
			}
			return;
		}
		const choices = editing.choices ?? editing.initial;
		let editor: IBaseHalfMediaEditor;
		if (editing.state.video && view.player) {
			editor = store.add(this.instantiationService.createInstance(BaseHalfVideoFrameViewer, view.stage, { video: editing.state.video, player: view.player, stage: view.stage, choices }));
		} else if (editing.state.image) {
			const { width, height } = editing.state.image;
			editor = store.add(this.instantiationService.createInstance(BaseHalfImageCropView, view.stage, { source: editing.state.source, size: { width, height }, choices }));
		} else {
			return;
		}
		editing.editor = editor;
		store.add(toDisposable(() => {
			if (editing.editor === editor) {
				// What the editor held when Card Detail draws it anew.
				editing.choices = editor.choices;
				editing.editor = undefined;
			}
		}));
		store.add(editor.onDidChange(() => {
			editing.failure = undefined;
			this.renderHeader();
			this.renderStatus();
		}));
		store.add(editor.onDidRequestSave(() => this.done()));
		editor.setBusy(editing.busy);
		this.renderHeader();
		this.renderStatus();
		if (this.focusEditor) {
			this.focusEditor = false;
			editor.focus();
		}
	}

	// #region The steps

	private async edit(): Promise<void> {
		if (this.editing || this.editDisabledReason()) {
			return;
		}
		// What Edit starts from is read anew: the file may have changed since Card Detail showed it.
		const version = ++this.stateVersion;
		const state = await this.mediaEditService.readEditState(this.host.file);
		if (this.disposed || version !== this.stateVersion || this.editing) {
			return;
		}
		this.state = state;
		if (state.unavailable) {
			this.renderHeader();
			return;
		}
		const initial = state.record ? normalizeBaseHalfMediaChoices(state.record) : {};
		this.editing = { state, initial, busy: false };
		this.focusEditor = true;
		this.renderHeader();
		this.host.show(state.source);
	}

	private cancel(): void {
		if (!this.editing || this.editing.busy) {
			return;
		}
		this.leave();
	}

	/** Leaves edit mode: Card Detail shows the file anew, and the keyboard that was in it goes to Edit. */
	private leave(): void {
		const active = getActiveElement();
		this.focusEdit = !!active && this.host.detail.contains(active);
		this.editing = undefined;
		this.renderHeader();
		this.host.show(this.host.file.resource);
	}

	private done(): void {
		const editing = this.editing;
		if (!editing?.editor || this.doneDisabledReason()) {
			return;
		}
		void this.runStep(editing, this.mediaEditService.save(this.host.file, editing.state, editing.editor.choices));
	}

	private saveAsNew(): void {
		const editing = this.editing;
		if (!editing?.editor || this.saveAsNewDisabledReason()) {
			return;
		}
		void this.runStep(editing, this.mediaEditService.saveAsNew(this.host.file, editing.state, editing.editor.choices));
	}

	private revert(): void {
		const editing = this.editing;
		if (!editing?.state.record || editing.busy) {
			return;
		}
		void this.runStep(editing, this.mediaEditService.revert(this.host.file, editing.state));
	}

	/** While a step runs, the editor changes nothing; when it ends, edit mode ends, and a failure is said in the status line. */
	private async runStep(editing: IEditing, step: Promise<IBaseHalfMediaSaved>): Promise<void> {
		editing.busy = true;
		editing.failure = undefined;
		editing.editor?.setBusy(true);
		this.renderHeader();
		this.renderStatus();
		try {
			await step;
			if (this.editing === editing && !this.disposed) {
				this.leave();
			}
		} catch (error) {
			if (this.editing !== editing || this.disposed) {
				return;
			}
			editing.busy = false;
			editing.failure = localize('basehalf.mediaEdit.mode.failed', "BaseHalf could not save the edit: {0}", error instanceof Error ? error.message : String(error));
			editing.editor?.setBusy(false);
			this.renderHeader();
			this.renderStatus();
		}
	}

	// #endregion

	// #region The keyboard

	private onKeyDown(event: KeyboardEvent): void {
		// Escape cancels the edit and leaves Card Detail open; the next Escape closes it (editing media, "The keyboard").
		if (event.key === 'Escape' && this.editing && !this.editing.busy && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229
			&& !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
			// Full screen takes Escape first, as when Card Detail closes.
			&& !this.host.detail.ownerDocument.fullscreenElement) {
			event.preventDefault();
			this.cancel();
		}
	}

	/** Command+Z in edit mode undoes the editor's last change, and never reaches the steps of the canvas. */
	private undoRedo(direction: 'undo' | 'redo'): boolean {
		const editor = this.editing?.editor;
		if (!editor) {
			return false;
		}
		const active = getActiveElement();
		if (active && active !== active.ownerDocument.body && !this.host.detail.contains(active)) {
			return false;
		}
		if (direction === 'undo') {
			editor.undo();
		} else {
			editor.redo();
		}
		return true;
	}

	// #endregion

	// #region The header

	private editDisabledReason(): string | undefined {
		if (this.mediaEditService.runningSave(this.host.file.resource)) {
			return localize('basehalf.mediaEdit.mode.saving', "The edit is being saved");
		}
		if (!this.state) {
			return localize('basehalf.mediaEdit.mode.reading', "Reading the file…");
		}
		return this.state.unavailable;
	}

	private doneDisabledReason(): string | undefined {
		const editing = this.editing;
		if (!editing?.editor || editing.busy) {
			return localize('basehalf.mediaEdit.mode.saving', "The edit is being saved");
		}
		if (sameChoices(editing.editor.choices, editing.initial)) {
			return localize('basehalf.mediaEdit.mode.noChange', "Make an edit first");
		}
		return undefined;
	}

	private saveAsNewDisabledReason(): string | undefined {
		const editing = this.editing;
		if (!editing?.editor || editing.busy) {
			return localize('basehalf.mediaEdit.mode.saving', "The edit is being saved");
		}
		if (baseHalfMediaChoicesAreNoEdit(normalizeBaseHalfMediaChoices(editing.editor.choices))) {
			return localize('basehalf.mediaEdit.mode.noEdit', "Make an edit first: the whole original is kept");
		}
		return undefined;
	}

	private headerButton(name: HeaderAction): HTMLButtonElement | undefined {
		return this.buttons.get(name);
	}

	/** The buttons the header holds now, in order, with why each cannot act. */
	private headerButtons(): readonly IHeaderButton[] {
		const editing = this.editing;
		if (!editing) {
			return [{ name: 'edit', label: localize('basehalf.mediaEdit.mode.edit', "Edit"), disabled: this.editDisabledReason() }];
		}
		const busy = editing.busy ? localize('basehalf.mediaEdit.mode.saving', "The edit is being saved") : undefined;
		return [
			...(editing.state.record ? [{ name: 'revert' as const, label: localize('basehalf.mediaEdit.mode.revert', "Revert"), disabled: busy, hover: localize('basehalf.mediaEdit.mode.revertHover', "Put back the original") }] : []),
			{ name: 'cancel', label: localize('basehalf.mediaEdit.mode.cancel', "Cancel"), disabled: busy, hover: localize('basehalf.mediaEdit.mode.cancelHover', "Cancel (Escape)") },
			{ name: 'done', label: localize('basehalf.mediaEdit.mode.done', "Done"), disabled: this.doneDisabledReason(), hover: localize('basehalf.mediaEdit.mode.doneHover', "Save the edit") },
			{ name: 'more', label: '', disabled: this.saveAsNewDisabledReason(), hover: localize('basehalf.mediaEdit.mode.more', "More Ways to Save") }
		];
	}

	/**
	 * Draws the header's buttons. Buttons that stay are changed in place, as a
	 * save's progress changes them several times a second: a button drawn anew
	 * under the pointer would lose a click, and the keyboard on it.
	 */
	private renderHeader(): void {
		if (this.disposed) {
			return;
		}
		const wanted = this.headerButtons();
		if ([...this.buttons.keys()].join() !== wanted.map(button => button.name).join()) {
			// The keyboard stays on a button that is there again.
			const active = getActiveElement();
			const focused = active && this.host.header.contains(active) ? (active as HTMLElement).dataset.editAction as HeaderAction | undefined : undefined;
			this.headerStore.clear();
			this.buttons.clear();
			clearNode(this.host.header);
			const group = wanted.some(button => button.name === 'done') ? $('.basehalf-media-edit-done-group') : undefined;
			for (const { name, label } of wanted) {
				const container = name === 'done' || name === 'more' ? group! : this.host.header;
				if (container === group && !group.parentElement) {
					append(this.host.header, group);
				}
				this.buttons.set(name, this.createButton(name, label, container));
			}
			if (focused) {
				this.buttons.get(focused)?.focus({ preventScroll: true });
			}
		}
		for (const { name, disabled, hover } of wanted) {
			const button = this.buttons.get(name)!;
			button.setAttribute('aria-disabled', String(!!disabled));
			button.classList.toggle('disabled', !!disabled);
			setBaseHalfHover(button, disabled ?? hover);
		}
	}

	/** A button of the header; one that cannot act stays focusable, as a disabled button would drop the keyboard out of Card Detail. */
	private createButton(name: HeaderAction, label: string, container: HTMLElement): HTMLButtonElement {
		const button = append(container, $<HTMLButtonElement>(`button.basehalf-media-edit-button.${name}`));
		button.type = 'button';
		button.dataset.editAction = name;
		button.textContent = label;
		if (name === 'more') {
			// The glyph stands in a span of its own: the button's font is the header's.
			append(button, $(`span${ThemeIcon.asCSSSelector(Codicon.chevronDown)}`)).setAttribute('aria-hidden', 'true');
			button.setAttribute('aria-haspopup', 'menu');
			button.setAttribute('aria-label', localize('basehalf.mediaEdit.mode.more', "More Ways to Save"));
		}
		this.headerStore.add(addDisposableListener(button, 'click', () => {
			if (button.classList.contains('disabled')) {
				return;
			}
			switch (name) {
				case 'edit': void this.edit(); break;
				case 'revert': this.revert(); break;
				case 'cancel': this.cancel(); break;
				case 'done': this.done(); break;
				case 'more': this.showDoneMenu(button); break;
			}
		}));
		return button;
	}

	private showDoneMenu(anchor: HTMLElement): void {
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => [
				toAction({ id: 'basehalf.mediaEdit.done', label: localize('basehalf.mediaEdit.mode.doneMenu', "Done"), enabled: !this.doneDisabledReason(), run: () => this.done() }),
				toAction({ id: 'basehalf.mediaEdit.saveAsNew', label: this.saveAsNewLabel(), enabled: !this.saveAsNewDisabledReason(), run: () => this.saveAsNew() })
			]
		});
	}

	private saveAsNewLabel(): string {
		switch (this.editing?.state.kind) {
			case 'video': return localize('basehalf.mediaEdit.mode.saveAsNewVideo', "Save as New Video");
			case 'image': return localize('basehalf.mediaEdit.mode.saveAsNewImage', "Save as New Image");
			default: return localize('basehalf.mediaEdit.mode.saveAsNewSound', "Save as New Sound");
		}
	}

	// #endregion

	// #region The status

	private renderStatus(): void {
		const editing = this.editing;
		if (!editing?.editor) {
			return;
		}
		const running = this.mediaEditService.runningSave(this.host.file.resource);
		if (running) {
			const percent = Math.round(running.done * 100);
			editing.editor.setStatus({
				text: running.kind === 'revert'
					? localize('basehalf.mediaEdit.mode.reverting', "Putting back the original…")
					: running.kind === 'new'
						? localize('basehalf.mediaEdit.mode.savingNew', "Saving a new file… {0}%", percent)
						: localize('basehalf.mediaEdit.mode.savingEdit', "Saving the edit… {0}%", percent)
			});
			return;
		}
		editing.editor.setStatus(editing.failure ? { text: editing.failure, error: true } : undefined);
	}

	/** Under the view out of edit mode: what the last step did to this version of the file, until Card Detail closes. */
	private renderNote(stage: HTMLElement, store: DisposableStore): void {
		const note = append(stage, $('.basehalf-media-edit-note'));
		note.setAttribute('aria-live', 'polite');
		store.add(toDisposable(() => note.remove()));
		const update = () => {
			const running = this.mediaEditService.runningSave(this.host.file.resource);
			if (running) {
				note.textContent = localize('basehalf.mediaEdit.mode.beingSaved', "The edit of this file is being saved… {0}%", Math.round(running.done * 100));
				return;
			}
			const version = this.state?.version;
			const saved = version ? this.mediaEditService.lastSave(this.host.file.resource, version) : undefined;
			note.textContent = saved ? savedNote(saved, this.undoLabel()) : '';
		};
		store.add(this.mediaEditService.onDidChangeSave(resource => {
			if (isEqual(resource, this.host.file.resource)) {
				update();
			}
		}));
		update();
		// What Edit starts from, and the version of the file that the line is of, are read after Card Detail drew it.
		let live = true;
		store.add(toDisposable(() => live = false));
		void this.refresh().then(() => {
			if (live) {
				update();
			}
		});
	}

	private undoLabel(): string {
		return this.keybindingService.lookupKeybinding('undo')?.getLabel() ?? (isMacintosh ? '⌘Z' : 'Ctrl+Z');
	}

	// #endregion
}

/** Whether two sets of choices are the same, as a record holds them. */
function sameChoices(a: IBaseHalfMediaChoices, b: IBaseHalfMediaChoices): boolean {
	return JSON.stringify(normalizeBaseHalfMediaChoices(a)) === JSON.stringify(normalizeBaseHalfMediaChoices(b));
}

function savedNote(saved: IBaseHalfMediaSaved, undo: string): string {
	switch (saved.kind) {
		case 'edit': return saved.soundDropped
			? localize('basehalf.mediaEdit.note.editedNoSound', "Edited, without sound: BaseHalf can't read or write this video's sound here. {0} puts it back.", undo)
			: localize('basehalf.mediaEdit.note.edited', "Edited. {0} puts it back.", undo);
		case 'new': return localize('basehalf.mediaEdit.note.savedAsNew', "Saved {0}. {1} takes it away.", basename(saved.resource), undo);
		case 'revert': return localize('basehalf.mediaEdit.note.reverted', "The original is back. {0} puts the edit back.", undo);
	}
}
