/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { compareFileNames } from '../../../../base/common/comparers.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { baseHalfVideoInputKindOfPath, BaseHalfVideoInputKind } from '../common/basehalfVideoCatalog.js';
import { baseHalfVideoPanelInputFileName } from '../common/basehalfVideoNodePanelPresentation.js';
import { baseHalfPromptMention } from '../common/basehalfGenerationMentions.js';
import { BaseHalfReferenceMenuKind, IBaseHalfReferenceMenuItem, IBaseHalfReferenceMenuKindList, IBaseHalfReferenceMenuModel } from '../common/basehalfGenerationReferenceMenu.js';
import { BaseHalfGenerationReferenceMenu } from './basehalfGenerationReferenceMenu.js';
import { baseHalfMediaUrlAt, baseHalfMediaVersion } from '../../playback/browser/basehalfMediaElements.js';
import { PROMPT_LINE_HEIGHT } from './basehalfGenerationPanelShared.js';
import type { BaseHalfVideoNodePanel } from './basehalfVideoNodePanel.js';

/** The canvas's cards before the reference menu read them. */
const EMPTY_CANVAS_CARDS: readonly IBaseHalfReferenceMenuKindList[] = Object.freeze([
	Object.freeze({ kind: 'image' as const, items: [] }),
	Object.freeze({ kind: 'video' as const, items: [] }),
	Object.freeze({ kind: 'audio' as const, items: [] })
]);

/** The picture of an image the window can show, at its file's version; a video and audio have their glyph. */
function pictureOf(kind: BaseHalfReferenceMenuKind, file: URI | undefined, version: string | undefined): { readonly picture?: string } {
	return kind === 'image' && file ? { picture: baseHalfMediaUrlAt(file, version) } : {};
}

/** The kinds of input the reference menu lists: images, videos, sounds, and notes. */
function isReferenceMenuKind(kind: BaseHalfVideoInputKind): kind is BaseHalfReferenceMenuKind {
	return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'text';
}

/**
 * The `@` reference menu of the prompt: opening it at the caret, the cards and inputs it lists, and the mention
 * that choosing one writes into the prompt.
 *
 * A part of the panel under a generation card (`basehalfVideoNodePanel.ts`): it keeps its own state, and reaches
 * the panel's as `panel`.
 */
export class BaseHalfGenerationPanelReferences {
	private mentionAt: number | undefined;
	/** The cards of the canvas of the card's folder, as the reference menu last read them. */
	private canvasCards: readonly IBaseHalfReferenceMenuKindList[] | undefined;

	constructor(private readonly panel: BaseHalfVideoNodePanel) { }

	//#endregion

	//#region Names and the reference menu

	/**
	 * Opens the reference menu when the user typed `@` at the caret (generation
	 * cards, "The panel", D68): after the start of the prompt, a space, or
	 * anything that is not a Latin letter or digit, so that an e-mail address
	 * does not; a full-width `＠` too.
	 */
	openReferenceMenuAtCaret(): void {
		if (this.panel.isLocked() || this.panel.referenceMenu.value || !this.panel.editor.hasFocus()) {
			return;
		}
		const selection = this.panel.editor.selection();
		if (!selection || selection.start !== selection.end || selection.start === 0) {
			return;
		}
		const text = this.panel.editor.value;
		const at = selection.start - 1;
		const mark = text.charAt(at);
		if (mark !== '@' && mark !== '\uff20') {
			return;
		}
		if (at > 0 && /[A-Za-z0-9._%+-]/.test(text.charAt(at - 1))) {
			return;
		}
		this.openReferenceMenu(at);
	}

	private openReferenceMenu(at: number): void {
		this.panel.menus.closeMenu(false);
		// Where the menu opens, kept relative to the panel, so that it follows the panel when the canvas moves.
		const caret = this.panel.editor.caretRect();
		const panel = this.panel.element.getBoundingClientRect();
		const offset = caret ? { left: caret.left - panel.left, top: caret.top - panel.top, width: caret.width, height: caret.height } : undefined;
		const anchor = (): DOMRect | undefined => {
			if (!offset) {
				return undefined;
			}
			const now = this.panel.element.getBoundingClientRect();
			const DOMRectConstructor = getWindow(this.panel.element).DOMRect;
			return new DOMRectConstructor(now.left + offset.left, now.top + offset.top, Math.max(1, offset.width), offset.height || PROMPT_LINE_HEIGHT);
		};
		this.mentionAt = at;
		const menu = new BaseHalfGenerationReferenceMenu(this.referenceMenuModel(), {
			choose: item => { void this.chooseReference(item); },
			dismiss: () => this.closeReferenceMenu(true),
			canvasBounds: () => this.panel.menus.canvasRect(this.panel.element.getBoundingClientRect())
		}, this.panel.layer, anchor);
		this.panel.referenceMenu.value = menu;
		menu.focus();
		void this.readCanvasCards().then(cards => {
			if (cards && this.panel.referenceMenu.value === menu) {
				this.canvasCards = cards;
				menu.update(this.referenceMenuModel());
			}
		});
	}

	/** Closes the reference menu; with `restoreFocus`, the caret goes back after the `@`, which stays as typed. */
	closeReferenceMenu(restoreFocus: boolean): void {
		if (!this.panel.referenceMenu.value) {
			return;
		}
		const at = this.mentionAt;
		this.panel.referenceMenu.clear();
		this.mentionAt = undefined;
		if (restoreFocus && !this.panel.disposed) {
			this.panel.editor.focus(at !== undefined ? at + 1 : undefined);
		}
	}

	/** The card's images, videos, sounds, and notes, in the order of the input row, then the canvas's cards by kind, as the menu lists them. */
	private referenceMenuModel(): IBaseHalfReferenceMenuModel {
		const row = this.panel.presentation?.inputRow;
		const connected: IBaseHalfReferenceMenuItem[] = [];
		for (const item of row ? [...row.slots.flatMap(slot => slot.item ? [slot.item] : []), ...row.items] : []) {
			if (isReferenceMenuKind(item.kind)) {
				const input = this.panel.inputs[item.index];
				connected.push(Object.freeze<IBaseHalfReferenceMenuItem>({
					path: item.path,
					kind: item.kind,
					title: item.fileName,
					connected: true,
					...pictureOf(item.kind, input?.available ? input.file : undefined, input?.fileVersion)
				}));
			}
		}
		const upstream = new Set(this.panel.snapshot?.upstream ?? []);
		const canvas = (this.canvasCards ?? EMPTY_CANVAS_CARDS).map(list => Object.freeze({
			...list,
			items: list.items.map(item => upstream.has(item.path) ? Object.freeze({ ...item, connected: true }) : item)
		}));
		return Object.freeze({ connected, canvas });
	}

	/**
	 * Reads the images, videos, audio, and notes of the card's folder, drafts
	 * too, apart from the card itself, and asks for each kind whether the
	 * draft's model takes one more. `undefined` when the folder cannot be read.
	 */
	private async readCanvasCards(): Promise<readonly IBaseHalfReferenceMenuKindList[] | undefined> {
		const snapshot = this.panel.snapshot;
		if (!snapshot) {
			return undefined;
		}
		const folder = dirname(this.panel.resource);
		const slash = snapshot.path.lastIndexOf('/');
		const folderPath = slash < 0 ? '' : snapshot.path.slice(0, slash);
		const items: IBaseHalfReferenceMenuItem[] = [];
		try {
			const [stat, drafts] = await Promise.all([this.panel.fileService.resolve(folder), this.panel.store.listDrafts(folder)]);
			const entries = [
				...(stat.children ?? []).filter(child => !child.isDirectory).map(child => ({ name: child.name, file: child.resource as URI | undefined, version: baseHalfMediaVersion(child) as string | undefined })),
				...drafts.map(draft => ({ name: draft.name, file: undefined, version: undefined }))
			];
			for (const entry of entries) {
				const path = folderPath ? `${folderPath}/${entry.name}` : entry.name;
				const kind = baseHalfVideoInputKindOfPath(path);
				if (path === snapshot.path || entry.name.startsWith('.') || !isReferenceMenuKind(kind)) {
					continue;
				}
				items.push(Object.freeze({ path, kind, title: baseHalfVideoPanelInputFileName(path), ...pictureOf(kind, entry.file, entry.version) }));
			}
		} catch (error) {
			this.panel.logService.warn('[BaseHalf] the reference menu could not read the cards of the canvas', error);
			return undefined;
		}
		// In the order of Files.
		items.sort((left, right) => compareFileNames(left.title, right.title));
		const connected = new Set(snapshot.upstream);
		const lists: IBaseHalfReferenceMenuKindList[] = [];
		// A kind that no model of the card's kind takes is not listed: an image card lists images and notes (D90).
		for (const kind of this.panel.presentation?.inputKinds ?? (['image', 'video', 'audio', 'text'] as const)) {
			const ofKind = items.filter(item => item.kind === kind);
			// The model takes one more of a kind or none, whichever card it is: asked once, for the first that is not connected.
			const candidate = ofKind.find(item => !connected.has(item.path));
			let disabled: string | undefined;
			try {
				disabled = candidate ? await this.panel.cardActions.inputRefusal(this.panel.resource, { add: candidate.path }) : undefined;
			} catch (error) {
				this.panel.logService.warn('[BaseHalf] the reference menu could not ask whether the model takes an input', error);
			}
			lists.push(Object.freeze({ kind, items: ofKind, ...(disabled ? { disabled } : {}) }));
		}
		return lists;
	}

	/**
	 * Puts the chosen input's mention in place of the `@` (D74). A card that is
	 * not connected is connected first, as a connection on the canvas is, or
	 * the reason it cannot be is shown and the `@` stays.
	 */
	private async chooseReference(item: IBaseHalfReferenceMenuItem): Promise<void> {
		const at = this.mentionAt;
		this.panel.referenceMenu.clear();
		this.mentionAt = undefined;
		if (!this.panel.snapshot?.upstream.includes(item.path)) {
			const connected = await this.panel.inputChanges.acceptInput(item.path) && await this.panel.inputChanges.connect(item.path);
			if (this.panel.disposed) {
				return;
			}
			if (!connected) {
				this.panel.editor.focus(at !== undefined ? at + 1 : undefined);
				return;
			}
			// The chip is drawn with the new input once the panel has read it.
			await this.panel.refresh();
		}
		this.replaceMention(at, item.path);
	}

	/** Puts the mention of `path` and a space in place of the `@` at `at`, or at the caret when it is not there any more. */
	private replaceMention(at: number | undefined, path: string): void {
		const text = this.panel.editor.value;
		if (at !== undefined && (text.charAt(at) === '@' || text.charAt(at) === '\uff20')) {
			this.panel.editor.focus(at + 1);
			this.panel.editor.replace(at, at + 1, `${baseHalfPromptMention(path)} `);
			return;
		}
		this.insertMention(path);
	}

	/** Puts the mention of an input into the prompt at its caret, or at the end, with a space after it, and gives the prompt the keyboard. */
	insertMention(path: string): void {
		if (this.panel.isLocked()) {
			return;
		}
		const selection = this.panel.editor.hasFocus() ? this.panel.editor.selection() : undefined;
		const end = this.panel.editor.value.length;
		const start = selection?.start ?? end;
		this.panel.editor.focus(start);
		this.panel.editor.replace(start, selection?.end ?? end, `${baseHalfPromptMention(path)} `);
	}
}
