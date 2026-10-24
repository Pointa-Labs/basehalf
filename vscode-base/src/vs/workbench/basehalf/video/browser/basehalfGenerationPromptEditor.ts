/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfGenerationPromptEditor.css';
import { $, addDisposableListener, append, clearNode, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { RedoCommand, SelectAllCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { findBaseHalfVideoLabelTokens, IBaseHalfVideoLabelToken } from '../common/basehalfVideoCatalog.js';

/** What the chip of a name shows. */
export interface IBaseHalfPromptChip {
	readonly kind: 'image' | 'video' | 'audio';
	/** The picture of an image, as a URL the window can load; a video and audio show their glyph. */
	readonly picture?: string;
}

export interface IBaseHalfPromptEditorOptions {
	readonly ariaLabel: string;
	readonly placeholder: string;
	/** The longest prompt, in characters. */
	readonly maxLength: number;
	/** The chip of a name in the prompt, or `undefined` for a name that means no input. */
	readonly chipOf: (name: IBaseHalfVideoLabelToken) => IBaseHalfPromptChip | undefined;
	/** How long typing joins one step of undo, in milliseconds. */
	readonly undoRunTime?: number;
	/** The time now, for joining typing into steps of undo. */
	readonly now?: () => number;
}

/** A place in the prompt's text: the start and the end of the selection, equal for a caret. */
export interface IBaseHalfPromptSelection {
	readonly start: number;
	readonly end: number;
}

interface IPromptState extends IBaseHalfPromptSelection {
	readonly text: string;
}

/** What an edit did, for joining typing and deleting into steps of undo. */
type EditKind = 'type' | 'delete' | 'other';

/** Ahead of the canvas's own undo (115) and of VS Code's handlers, which know only `input` and `textarea` as text fields. */
const COMMAND_PRIORITY = 10_100;
/** Stands in after a chip at the end of a line, so that the caret can be put there. It is never part of the text. */
const CARET_HOLDER = '​';
const UNDO_LIMIT = 200;
const DEFAULT_UNDO_RUN_TIME = 1000;

/**
 * The prompt of a generation card's panel (generation cards, "The panel",
 * D68): an editable text in which each name of an input (图片1, Image 1)
 * shows as a chip with the input's picture. The text is the truth: a chip is
 * its name, which is what is stored and sent. A name typed by hand turns into
 * a chip once it is complete, never while an input method composes.
 *
 * The browser does the typing, the deleting, the moving, and the input
 * method; after each edit the editor reads the text back, and draws it again
 * when its names no longer match its chips. It handles Enter, paste, copy,
 * and cut as text, and keeps its own undo and Select All: VS Code takes only
 * `input` and `textarea` for text fields, so its Undo would otherwise undo a
 * step of the canvas while the prompt has the keyboard, and its Select All
 * would select nothing.
 */
export class BaseHalfGenerationPromptEditor extends Disposable {

	readonly element: HTMLElement;

	private readonly _onDidChange = this._register(new Emitter<void>());
	/** Fires after the user changed the text: by typing, deleting, pasting, cutting, undo, or redo. */
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidEndComposition = this._register(new Emitter<void>());
	readonly onDidEndComposition: Event<void> = this._onDidEndComposition.event;

	private text = '';
	private composingNow = false;
	private readOnlyNow = false;
	/** The state before the edit that the browser is about to make. */
	private pending: { readonly before: IPromptState; readonly kind: EditKind } | undefined;
	private readonly undoStack: IPromptState[] = [];
	private readonly redoStack: IPromptState[] = [];
	private lastEdit: { readonly kind: EditKind; readonly time: number } | undefined;
	private readonly now: () => number;

	constructor(private readonly options: IBaseHalfPromptEditorOptions) {
		super();
		this.now = options.now ?? Date.now;
		this.element = $('.bh-prompt-editor');
		this.element.contentEditable = 'true';
		this.element.spellcheck = false;
		this.element.setAttribute('role', 'textbox');
		this.element.setAttribute('aria-multiline', 'true');
		this.element.setAttribute('aria-label', options.ariaLabel);
		this.element.setAttribute('autocorrect', 'off');
		this.element.setAttribute('autocapitalize', 'off');
		this.element.dataset.placeholder = options.placeholder;

		this._register(addDisposableListener(this.element, 'beforeinput', event => this.onBeforeInput(event)));
		this._register(addDisposableListener(this.element, 'input', event => {
			if (!(event as InputEvent).isComposing && !this.composingNow) {
				this.didEdit();
			}
		}));
		this._register(addDisposableListener(this.element, 'compositionstart', () => {
			this.composingNow = true;
			this.pending = { before: this.pending?.before ?? this.state(), kind: 'type' };
		}));
		this._register(addDisposableListener(this.element, 'compositionend', () => {
			this.composingNow = false;
			this.didEdit();
			this._onDidEndComposition.fire();
		}));
		this._register(addDisposableListener(this.element, 'paste', event => {
			event.preventDefault();
			if (!this.readOnlyNow) {
				this.replaceSelection(normalizeText(event.clipboardData?.getData('text/plain') ?? ''), 'other');
			}
		}));
		this._register(addDisposableListener(this.element, 'copy', event => this.copySelection(event, false)));
		this._register(addDisposableListener(this.element, 'cut', event => this.copySelection(event, !this.readOnlyNow)));
		this._register(addDisposableListener(this.element, 'drop', event => event.preventDefault()));
		this._register(addDisposableListener(this.element, 'dragover', event => event.preventDefault()));

		this._register(UndoCommand.addImplementation(COMMAND_PRIORITY, 'basehalfPromptEditor', () => {
			if (!this.hasFocus()) {
				return false;
			}
			this.undo();
			return true;
		}));
		this._register(RedoCommand.addImplementation(COMMAND_PRIORITY, 'basehalfPromptEditor', () => {
			if (!this.hasFocus()) {
				return false;
			}
			this.redo();
			return true;
		}));
		this._register(SelectAllCommand.addImplementation(COMMAND_PRIORITY, 'basehalfPromptEditor', () => {
			if (!this.hasFocus()) {
				return false;
			}
			this.setSelection({ start: 0, end: this.text.length });
			return true;
		}));
	}

	/** The text, chips as their names. While an input method composes, the text from before the composition. */
	get value(): string {
		return this.text;
	}

	get composing(): boolean {
		return this.composingNow;
	}

	get readOnly(): boolean {
		return this.readOnlyNow;
	}

	/** A prompt that is read only can be selected and copied, and opens nothing. */
	set readOnly(value: boolean) {
		if (value === this.readOnlyNow) {
			return;
		}
		this.readOnlyNow = value;
		this.element.contentEditable = value ? 'false' : 'true';
		this.element.setAttribute('aria-readonly', String(value));
	}

	/**
	 * Shows `text`, as when the file changed. The caret keeps its place in the
	 * text while the field has the focus. Undo starts again from here.
	 */
	setValue(text: string): void {
		const selection = this.hasFocus() ? this.selection() : undefined;
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.lastEdit = undefined;
		this.pending = undefined;
		this.render(clampLength(normalizeText(text), this.options.maxLength), selection);
	}

	/** Draws the chips again, as when the inputs changed, keeping the text and the caret. */
	refreshChips(): void {
		if (this.composingNow) {
			return;
		}
		this.render(this.text, this.hasFocus() ? this.selection() : undefined);
	}

	hasFocus(): boolean {
		const active = getWindow(this.element).document.activeElement;
		return !!active && (active === this.element || this.element.contains(active));
	}

	/** Moves the keyboard into the prompt, with the caret at `offset`, or at the end. */
	focus(offset?: number): void {
		this.element.focus({ preventScroll: true });
		const at = Math.max(0, Math.min(offset ?? this.text.length, this.text.length));
		this.setSelection({ start: at, end: at });
	}

	/** The selection in the text, when the prompt has it. */
	selection(): IBaseHalfPromptSelection | undefined {
		const selection = getWindow(this.element).getSelection();
		if (!selection || selection.rangeCount === 0) {
			return undefined;
		}
		const range = selection.getRangeAt(0);
		if (!this.element.contains(range.startContainer) || !this.element.contains(range.endContainer)) {
			return undefined;
		}
		const start = this.offsetOf(range.startContainer, range.startOffset);
		const end = this.offsetOf(range.endContainer, range.endOffset);
		return { start: Math.min(start, end), end: Math.max(start, end) };
	}

	setSelection(selection: IBaseHalfPromptSelection): void {
		const targetWindow = getWindow(this.element);
		const range = targetWindow.document.createRange();
		const start = this.positionAt(selection.start);
		const end = selection.end === selection.start ? start : this.positionAt(selection.end);
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
		const current = targetWindow.getSelection();
		current?.removeAllRanges();
		current?.addRange(range);
	}

	/**
	 * Replaces the text from `start` to `end` with `text` as one step of undo,
	 * and puts the caret after it, as choosing a name of the reference menu
	 * does. Nothing is replaced while the prompt is read only.
	 */
	replace(start: number, end: number, text: string): void {
		if (this.readOnlyNow) {
			return;
		}
		const from = Math.max(0, Math.min(start, this.text.length));
		const to = Math.max(from, Math.min(end, this.text.length));
		const room = this.options.maxLength - (this.text.length - (to - from));
		const inserted = normalizeText(text).slice(0, Math.max(0, room));
		const before = this.state();
		this.record(before, 'other');
		const caret = from + inserted.length;
		this.render(this.text.slice(0, from) + inserted + this.text.slice(to), this.hasFocus() ? { start: caret, end: caret } : undefined);
		this._onDidChange.fire();
	}

	/** Puts `text` in place of the selection, or at the end when the prompt has no caret. */
	insert(text: string): void {
		const selection = this.selection() ?? { start: this.text.length, end: this.text.length };
		this.replace(selection.start, selection.end, text);
	}

	/** The caret's place in the window, for the reference menu. */
	caretRect(): DOMRect | undefined {
		const targetWindow = getWindow(this.element);
		const selection = targetWindow.getSelection();
		if (!selection || selection.rangeCount === 0 || !this.element.contains(selection.anchorNode)) {
			return undefined;
		}
		const range = selection.getRangeAt(0).cloneRange();
		range.collapse(false);
		const rect = range.getClientRects()[0];
		if (rect && (rect.width > 0 || rect.height > 0)) {
			return rect;
		}
		// A caret between elements, or at the start of an empty line, has no
		// box of its own: measure a mark put there for the moment.
		const mark = targetWindow.document.createElement('span');
		mark.textContent = CARET_HOLDER;
		range.insertNode(mark);
		const measured = mark.getBoundingClientRect();
		const parent = mark.parentNode;
		mark.remove();
		parent?.normalize();
		return measured;
	}

	/** The height of the text, for the panel to grow to it. */
	contentHeight(): number {
		return this.element.scrollHeight;
	}

	undo(): boolean {
		const state = this.undoStack.pop();
		if (!state) {
			return false;
		}
		this.redoStack.push(this.state());
		this.lastEdit = undefined;
		this.render(state.text, state);
		this._onDidChange.fire();
		return true;
	}

	redo(): boolean {
		const state = this.redoStack.pop();
		if (!state) {
			return false;
		}
		this.undoStack.push(this.state());
		this.lastEdit = undefined;
		this.render(state.text, state);
		this._onDidChange.fire();
		return true;
	}

	//#region Editing

	private onBeforeInput(event: InputEvent): void {
		if (this.readOnlyNow) {
			event.preventDefault();
			return;
		}
		switch (event.inputType) {
			case 'historyUndo':
				event.preventDefault();
				this.undo();
				return;
			case 'historyRedo':
				event.preventDefault();
				this.redo();
				return;
			case 'insertParagraph':
			case 'insertLineBreak':
				event.preventDefault();
				this.replaceSelection('\n', 'other');
				return;
			case 'insertFromPaste':
			case 'insertFromPasteAsQuotation':
			case 'insertFromDrop':
				// Paste is taken as text in its own event; nothing is dropped into the prompt.
				event.preventDefault();
				return;
		}
		if (event.inputType.startsWith('format')) {
			event.preventDefault();
			return;
		}
		if (this.composingNow || event.inputType === 'insertCompositionText') {
			return;
		}
		if (event.inputType.startsWith('delete')) {
			// A chip is deleted whole, by the text: the browser deletes an element that
			// cannot be edited badly, as at the end of the text, where it leaves a line break.
			const range = this.deletion(event);
			if (range) {
				event.preventDefault();
				this.deleteRange(range.start, range.end);
				return;
			}
		}
		const kind: EditKind = event.inputType === 'insertText'
			? 'type'
			: event.inputType.startsWith('delete') ? 'delete' : 'other';
		const data = event.inputType === 'insertText' ? event.data ?? '' : '';
		if (data && this.text.length + data.length - selectionLength(this.selection()) > this.options.maxLength) {
			event.preventDefault();
			return;
		}
		this.pending = { before: this.state(), kind };
	}

	/** Reads the text back after the browser changed it, and draws it again when its names no longer match its chips. */
	private didEdit(): void {
		const pending = this.pending;
		this.pending = undefined;
		const before = pending?.before ?? this.state();
		const read = this.read();
		const text = clampLength(read, this.options.maxLength);
		if (text === this.text) {
			if (!this.matchesRendering(text)) {
				// The browser changed only how the text is drawn, as when it took out a caret holder.
				this.render(text, this.selection());
			}
			return;
		}
		const selection = this.selection();
		this.record(before, pending?.kind ?? 'other');
		if (text !== read || !this.matchesRendering(text)) {
			this.render(text, selection && { start: Math.min(selection.start, text.length), end: Math.min(selection.end, text.length) });
		} else {
			this.text = text;
		}
		this._onDidChange.fire();
	}

	/**
	 * What a delete takes out when it touches a chip, or a selection: the
	 * whole chips it touches; and before a caret holder, the line break after
	 * it. `undefined` when the browser can do it alone.
	 */
	private deletion(event: InputEvent): IBaseHalfPromptSelection | undefined {
		const selection = this.selection();
		if (!selection) {
			return undefined;
		}
		if (selection.start !== selection.end) {
			return this.overChips(selection);
		}
		const caret = selection.start;
		const chips = this.chipRanges();
		if (event.inputType === 'deleteContentBackward') {
			return chips.find(chip => chip.end === caret || (chip.start < caret && caret < chip.end));
		}
		if (event.inputType === 'deleteContentForward') {
			const chip = chips.find(candidate => candidate.start === caret || (candidate.start < caret && caret < candidate.end));
			if (chip) {
				return chip;
			}
			// The browser would take out only the holder, which is drawn again: the press would do nothing.
			return this.targetsNoText(event) && this.text.charAt(caret) === '\n' ? { start: caret, end: caret + 1 } : undefined;
		}
		const target = event.getTargetRanges()[0];
		if (!target || !this.element.contains(target.startContainer) || !this.element.contains(target.endContainer)) {
			return undefined;
		}
		const start = this.offsetOf(target.startContainer, target.startOffset);
		const end = this.offsetOf(target.endContainer, target.endOffset);
		const range = { start: Math.min(start, end), end: Math.max(start, end) };
		return chips.some(chip => chip.start < range.end && chip.end > range.start) ? this.overChips(range) : undefined;
	}

	/** Whether the browser's delete would take out only what is no part of the text, as a caret holder. */
	private targetsNoText(event: InputEvent): boolean {
		const target = event.getTargetRanges()[0];
		if (!target || target.collapsed || !this.element.contains(target.startContainer) || !this.element.contains(target.endContainer)) {
			return false;
		}
		return this.offsetOf(target.startContainer, target.startOffset) === this.offsetOf(target.endContainer, target.endOffset);
	}

	/** The range grown over every chip it touches. */
	private overChips(range: IBaseHalfPromptSelection): IBaseHalfPromptSelection {
		let { start, end } = range;
		for (const chip of this.chipRanges()) {
			if (chip.start < end && chip.end > start) {
				start = Math.min(start, chip.start);
				end = Math.max(end, chip.end);
			}
		}
		return { start, end };
	}

	/** Where the names drawn as chips are in the text. */
	private chipRanges(): IBaseHalfPromptSelection[] {
		return findBaseHalfVideoLabelTokens(this.text)
			.filter(token => this.options.chipOf(token))
			.map(token => ({ start: token.start, end: token.end }));
	}

	private deleteRange(start: number, end: number): void {
		if (end <= start) {
			return;
		}
		this.record(this.state(), 'delete');
		this.render(this.text.slice(0, start) + this.text.slice(end), { start, end: start });
		this._onDidChange.fire();
	}

	private replaceSelection(text: string, kind: EditKind): void {
		const selection = this.selection() ?? { start: this.text.length, end: this.text.length };
		const room = this.options.maxLength - (this.text.length - (selection.end - selection.start));
		const inserted = text.slice(0, Math.max(0, room));
		if (!inserted && selection.start === selection.end) {
			return;
		}
		this.record(this.state(), kind);
		const caret = selection.start + inserted.length;
		this.render(this.text.slice(0, selection.start) + inserted + this.text.slice(selection.end), { start: caret, end: caret });
		this._onDidChange.fire();
	}

	private copySelection(event: ClipboardEvent, cut: boolean): void {
		const selection = this.selection();
		if (!selection || selection.start === selection.end || !event.clipboardData) {
			return;
		}
		event.preventDefault();
		event.clipboardData.setData('text/plain', this.text.slice(selection.start, selection.end));
		if (cut) {
			this.replaceSelection('', 'other');
		}
	}

	/** Remembers the state before an edit as a step of undo; typing and deleting in a run join one step. */
	private record(before: IPromptState, kind: EditKind): void {
		const now = this.now();
		const last = this.lastEdit;
		const joins = kind !== 'other' && last?.kind === kind && now - last.time < (this.options.undoRunTime ?? DEFAULT_UNDO_RUN_TIME) && this.undoStack.length > 0;
		if (!joins) {
			this.undoStack.push(before);
			if (this.undoStack.length > UNDO_LIMIT) {
				this.undoStack.shift();
			}
		}
		this.redoStack.length = 0;
		this.lastEdit = { kind, time: now };
	}

	private state(): IPromptState {
		const selection = this.selection() ?? { start: this.text.length, end: this.text.length };
		return { text: this.text, start: selection.start, end: selection.end };
	}

	//#endregion

	//#region Text and elements

	private render(text: string, selection: IBaseHalfPromptSelection | undefined): void {
		this.text = text;
		const document = this.element.ownerDocument;
		// A chip drawn again shows what it showed: its picture stays loaded, and nothing blinks.
		const kept = new Map<string, HTMLElement[]>();
		for (const child of this.element.childNodes) {
			if (isHTMLElement(child) && child.dataset.chipKey) {
				let chips = kept.get(child.dataset.chipKey);
				if (!chips) {
					chips = [];
					kept.set(child.dataset.chipKey, chips);
				}
				chips.push(child);
			}
		}
		clearNode(this.element);
		let offset = 0;
		for (const token of findBaseHalfVideoLabelTokens(text)) {
			if (token.start > offset) {
				this.element.append(document.createTextNode(text.slice(offset, token.start)));
			}
			const name = text.slice(token.start, token.end);
			const chip = this.options.chipOf(token);
			if (chip) {
				this.element.append(kept.get(chipKey(name, chip))?.shift() ?? renderChip(name, chip));
				const next = text.charAt(token.end);
				if (next === '' || next === '\n') {
					this.element.append(document.createTextNode(CARET_HOLDER));
				}
			} else {
				const unknown = append(this.element, $('span.bh-prompt-name.unknown'));
				unknown.textContent = name;
			}
			offset = token.end;
		}
		if (offset < text.length) {
			this.element.append(document.createTextNode(text.slice(offset)));
		}
		if (text.endsWith('\n')) {
			// The last empty line has a height only with something on it.
			const holder = append(this.element, $('br'));
			holder.dataset.holder = 'true';
		}
		if (selection) {
			this.setSelection({ start: Math.min(selection.start, text.length), end: Math.min(selection.end, text.length) });
		}
	}

	/** Whether the elements are what `render(text)` draws: the same names as chips or unknown names, text between them, and the caret holders. */
	private matchesRendering(text: string): boolean {
		const expected: string[] = [];
		let offset = 0;
		for (const token of findBaseHalfVideoLabelTokens(text)) {
			if (token.start > offset) {
				expected.push(`t${text.slice(offset, token.start)}`);
			}
			const name = text.slice(token.start, token.end);
			if (this.options.chipOf(token)) {
				expected.push(`c${name}`);
				const next = text.charAt(token.end);
				if (next === '' || next === '\n') {
					expected.push('h');
				}
			} else {
				expected.push(`u${name}`);
			}
			offset = token.end;
		}
		if (offset < text.length) {
			expected.push(`t${text.slice(offset)}`);
		}
		const actual: string[] = [];
		let run = '';
		const flush = () => {
			if (run) {
				actual.push(`t${run}`);
				run = '';
			}
		};
		for (const child of this.element.childNodes) {
			if (child.nodeType === child.TEXT_NODE) {
				const data = child.textContent ?? '';
				if (data === CARET_HOLDER) {
					flush();
					actual.push('h');
				} else if (data.includes(CARET_HOLDER)) {
					// Typed into a caret holder: drawn again as text alone.
					return false;
				} else {
					run += data;
				}
			} else if (isHTMLElement(child) && child.classList.contains('bh-prompt-chip')) {
				flush();
				actual.push(`c${child.dataset.name ?? ''}`);
			} else if (isHTMLElement(child) && child.classList.contains('bh-prompt-name')) {
				flush();
				actual.push(`u${child.textContent ?? ''}`);
			} else if (isHTMLElement(child) && child.tagName === 'BR' && child.dataset.holder === 'true' && child === this.element.lastChild) {
				continue;
			} else {
				return false;
			}
		}
		flush();
		const holder = this.element.lastChild;
		const hasHolder = isHTMLElement(holder) && holder.tagName === 'BR' && holder.dataset.holder === 'true';
		return hasHolder === text.endsWith('\n') && expected.length === actual.length && expected.every((part, index) => part === actual[index]);
	}

	/** The text the elements hold: text, chips as their names, a line break of the browser's as a new line. */
	private read(): string {
		return normalizeText(readNode(this.element));
	}

	/**
	 * The length of the text before a place of the elements. It is read from
	 * the elements, which hold the new text while an edit is read back.
	 */
	private offsetOf(container: Node, offset: number): number {
		const range = this.element.ownerDocument.createRange();
		range.setStart(this.element, 0);
		try {
			range.setEnd(container, offset);
		} catch {
			return this.text.length;
		}
		const holder = this.element.ownerDocument.createElement('div');
		holder.append(range.cloneContents());
		return normalizeText(readNode(holder)).length;
	}

	/** The place of the elements at an offset of the text; never inside a chip, and after a caret holder, which is no part of the text. */
	private positionAt(offset: number): { readonly node: Node; readonly offset: number } {
		let remaining = Math.max(0, offset);
		const children = [...this.element.childNodes];
		for (let index = 0; index < children.length; index++) {
			const child = children[index];
			if (child.nodeType === child.TEXT_NODE) {
				const data = child.textContent ?? '';
				const length = data.replaceAll(CARET_HOLDER, '').length;
				if (remaining <= length) {
					return { node: child, offset: dataOffset(data, remaining) };
				}
				remaining -= length;
				continue;
			}
			if (!isHTMLElement(child)) {
				continue;
			}
			if (child.tagName === 'BR') {
				if (child.dataset.holder === 'true' || remaining === 0) {
					return { node: this.element, offset: index };
				}
				continue;
			}
			const length = child.classList.contains('bh-prompt-chip') ? (child.dataset.name ?? '').length : (child.textContent ?? '').length;
			if (remaining === 0) {
				return { node: this.element, offset: index };
			}
			if (remaining < length) {
				if (child.classList.contains('bh-prompt-chip')) {
					// Inside a chip: after it.
					return { node: this.element, offset: index + 1 };
				}
				return { node: child.firstChild ?? child, offset: remaining };
			}
			remaining -= length;
		}
		const last = this.element.lastChild;
		const holderAtEnd = isHTMLElement(last) && last.tagName === 'BR' && last.dataset.holder === 'true';
		return { node: this.element, offset: children.length - (holderAtEnd ? 1 : 0) };
	}

	//#endregion
}

/** What a chip shows: two chips with the same key look the same. */
function chipKey(name: string, chip: IBaseHalfPromptChip): string {
	return `${name}\0${chip.kind}\0${chip.picture ?? ''}`;
}

function renderChip(name: string, chip: IBaseHalfPromptChip): HTMLElement {
	const element = $('span.bh-prompt-chip');
	element.contentEditable = 'false';
	element.dataset.chipKey = chipKey(name, chip);
	element.dataset.name = name;
	element.dataset.kind = chip.kind;
	if (chip.picture) {
		const picture = append(element, $<HTMLImageElement>('img.bh-prompt-chip-picture'));
		picture.alt = '';
		picture.draggable = false;
		picture.decoding = 'async';
		picture.src = chip.picture;
		picture.addEventListener('error', () => picture.replaceWith(chipGlyph(chip.kind)), { once: true });
	} else {
		element.append(chipGlyph(chip.kind));
	}
	append(element, $('span.bh-prompt-chip-name')).textContent = name;
	return element;
}

function chipGlyph(kind: IBaseHalfPromptChip['kind']): HTMLElement {
	const glyph = renderIcon(kind === 'audio' ? Codicon.unmute : kind === 'video' ? Codicon.play : Codicon.fileMedia);
	glyph.classList.add('bh-prompt-chip-glyph');
	glyph.setAttribute('aria-hidden', 'true');
	return glyph;
}

/**
 * The text that elements hold, as the prompt reads itself: text, a chip as
 * its name, and a line of the browser's as a new line. The prompt writes its
 * new lines as text, so a line break element is only ever the browser's
 * placeholder for an empty line, and holds no text.
 */
function readNode(node: Node): string {
	let text = '';
	const visit = (parent: Node) => {
		for (const child of parent.childNodes) {
			if (child.nodeType === child.TEXT_NODE) {
				text += (child.textContent ?? '').replaceAll(CARET_HOLDER, '');
			} else if (isHTMLElement(child)) {
				if (child.classList.contains('bh-prompt-chip')) {
					text += child.dataset.name ?? '';
				} else if (child.tagName === 'BR') {
					continue;
				} else if (child.tagName === 'DIV' || child.tagName === 'P') {
					if (text && !text.endsWith('\n')) {
						text += '\n';
					}
					visit(child);
				} else {
					visit(child);
				}
			}
		}
	};
	visit(node);
	return text;
}

/** The place in a text node's data after `offset` characters of the text, after any caret holder there. */
function dataOffset(data: string, offset: number): number {
	let seen = 0;
	for (let index = 0; index < data.length; index++) {
		if (data.charAt(index) !== CARET_HOLDER) {
			if (seen === offset) {
				return index;
			}
			seen++;
		}
	}
	return data.length;
}

function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, '\n').replaceAll(CARET_HOLDER, '').replaceAll(' ', ' ');
}

function clampLength(text: string, maxLength: number): string {
	return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function selectionLength(selection: IBaseHalfPromptSelection | undefined): number {
	return selection ? selection.end - selection.start : 0;
}
