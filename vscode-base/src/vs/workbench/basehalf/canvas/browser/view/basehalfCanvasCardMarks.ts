/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../media/basehalfCanvasCardMarks.css';
import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { setBaseHalfHover } from '../../../shell/browser/basehalfHover.js';
import { IBaseHalfCanvasCardMark, IBaseHalfCanvasMark } from '../basehalfCanvasExtensions.js';

/** A press and a release further apart than this are a drag of the card, not a click on its mark. */
const CLICK_SLOP_PX = 4;

interface ICardParts {
	readonly path: string;
	/** What holds the card's name; its color is the mark's. */
	readonly identity: HTMLElement;
	/** What the bar stands in, whose rounded corners cut it. */
	readonly content: HTMLElement;
	readonly rows: Map<string, { readonly row: HTMLElement; readonly isFolder: boolean }>;
	/** What ends with the card. */
	readonly cardListeners: DisposableStore;
	shown?: {
		mark: IBaseHalfCanvasCardMark;
		readonly letter: HTMLElement;
		readonly bar: HTMLElement;
		readonly listeners: DisposableStore;
	};
}

interface IMarkableView {
	readonly renderedCardElementsByPath: Map<string, HTMLElement>;
}

function applyMarkClasses(element: HTMLElement, mark: IBaseHalfCanvasMark): void {
	element.classList.add(mark.labelClassName);
}

/**
 * Draws what a feature says of a card's file (the changes of a file, rules 2 to
 * 4): on its name, as a bar on its face, and on the rows of a folder's list.
 * What the card shows of its file stays as it is.
 */
export class BaseHalfCanvasCardMarks {
	private readonly parts = new WeakMap<HTMLElement, ICardParts>();
	private marks: ReadonlyMap<string, IBaseHalfCanvasCardMark> = new Map();

	constructor(private readonly view: IMarkableView) { }

	/** Replaces the marks of the canvas. */
	set(marks: ReadonlyMap<string, IBaseHalfCanvasCardMark>): void {
		const before = this.marks;
		this.marks = marks;
		for (const path of new Set([...before.keys(), ...marks.keys()])) {
			const card = this.view.renderedCardElementsByPath.get(path);
			if (card) {
				this.apply(card);
			}
		}
	}

	/** A card was drawn: its mark goes on it. */
	attachCard(card: HTMLElement, path: string, identity: HTMLElement, content: HTMLElement, cardListeners: DisposableStore): void {
		this.parts.set(card, { path, identity, content, rows: new Map(), cardListeners });
		this.apply(card);
	}

	/** A card's face was drawn anew, which took the bar and the list's marks away. */
	faceDrawn(card: HTMLElement): void {
		const parts = this.parts.get(card);
		if (!parts?.shown) {
			return;
		}
		if (parts.shown.bar.parentElement !== parts.content) {
			parts.content.append(parts.shown.bar);
		}
		this.applyRows(parts);
	}

	/** The list of a folder's card was drawn. */
	attachFolderRows(card: HTMLElement, rows: ReadonlyMap<string, { readonly row: HTMLElement; readonly isFolder: boolean }>): void {
		const parts = this.parts.get(card);
		if (parts) {
			parts.rows.clear();
			for (const [name, row] of rows) {
				parts.rows.set(name, row);
			}
			this.applyRows(parts);
		}
	}

	private apply(card: HTMLElement): void {
		const parts = this.parts.get(card);
		if (!parts) {
			return;
		}
		const mark = this.marks.get(parts.path);
		if (parts.shown?.mark === mark) {
			return;
		}
		// Marks come anew at each status: what looks the same stays, so that a press that spans it keeps its click.
		if (parts.shown && mark && mark.labelClassName === parts.shown.mark.labelClassName && mark.badgeClassName === parts.shown.mark.badgeClassName && !mark.open === !parts.shown.mark.open) {
			parts.shown.mark = mark;
			this.applyRows(parts);
			return;
		}
		if (parts.shown) {
			parts.identity.classList.remove('basehalf-canvas-card-changed', parts.shown.mark.labelClassName);
			parts.shown.letter.remove();
			parts.shown.bar.remove();
			parts.cardListeners.delete(parts.shown.listeners);
			parts.shown = undefined;
		}
		if (mark) {
			const listeners = parts.cardListeners.add(new DisposableStore());
			parts.identity.classList.add('basehalf-canvas-card-changed');
			applyMarkClasses(parts.identity, mark);
			const letter = append(parts.identity, $('span.basehalf-canvas-card-change'));
			letter.classList.add(mark.badgeClassName);
			this.listenToLetter(letter, mark, parts, listeners);
			const bar = append(parts.content, $('.basehalf-canvas-card-change-bar'));
			applyMarkClasses(bar, mark);
			parts.shown = { mark, letter, bar, listeners };
		}
		this.applyRows(parts);
	}

	private listenToLetter(letter: HTMLElement, mark: IBaseHalfCanvasCardMark, parts: ICardParts, listeners: DisposableStore): void {
		if (!mark.open) {
			// The dot of a folder does nothing: a press on it is a press on the card.
			letter.classList.add('passive');
			return;
		}
		setBaseHalfHover(letter, mark.title);
		let pressed: { readonly x: number; readonly y: number } | undefined;
		listeners.add(addDisposableListener(letter, 'pointerdown', event => {
			pressed = { x: event.clientX, y: event.clientY };
		}));
		// A click selects no card, as a click on the name does not. A drag from it moves the card.
		listeners.add(addDisposableListener(letter, 'click', event => {
			event.stopPropagation();
			const start = pressed;
			pressed = undefined;
			if (start && Math.abs(event.clientX - start.x) <= CLICK_SLOP_PX && Math.abs(event.clientY - start.y) <= CLICK_SLOP_PX) {
				parts.shown?.mark.open?.();
			}
		}));
	}

	private applyRows(parts: ICardParts): void {
		const mark = this.marks.get(parts.path);
		for (const [name, { row, isFolder }] of parts.rows) {
			for (const element of [...row.children]) {
				if (element.classList.contains('basehalf-canvas-card-change')) {
					element.remove();
				}
			}
			for (const className of [...row.classList]) {
				if (className.startsWith('monaco-decoration-') || className === 'basehalf-canvas-card-changed') {
					row.classList.remove(className);
				}
			}
			const rowMark = mark?.rowMark?.(name, isFolder);
			if (rowMark) {
				row.classList.add('basehalf-canvas-card-changed');
				applyMarkClasses(row, rowMark);
				const letter = append(row, $('span.basehalf-canvas-card-change.passive'));
				letter.classList.add(rowMark.badgeClassName);
			}
		}
	}
}
