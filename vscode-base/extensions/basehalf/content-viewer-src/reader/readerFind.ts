/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './readerFind.css';
import type { IBaseHalfReaderLabels } from '../../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { element, iconButton } from './readerDom.js';

/** How long after the last key the words of the field are searched for (PDFs and books, rule 19). */
const SEARCH_DELAY_MS = 250;

export interface IReaderFindOptions {
	readonly labels: IBaseHalfReaderLabels;
	/** Searches the whole document for `query` and goes to the first match at or after what the reader shows; an empty query takes the marks away. A new search ends the one before. */
	readonly search: (query: string) => void;
	readonly next: () => void;
	readonly previous: () => void;
	/** The bar was hidden: the marks go. */
	readonly closed: () => void;
}

/**
 * The find bar at the top right of the document (PDFs and books, rule 19):
 * the field, the count, Previous Match, Next Match, and Close.
 */
export class ReaderFindBar {
	readonly element: HTMLElement;
	private readonly field: HTMLInputElement;
	private readonly count: HTMLElement;
	private timer: number | undefined;

	constructor(root: HTMLElement, private readonly options: IReaderFindOptions) {
		const labels = options.labels;
		this.element = element('div', 'reader-find', root);
		this.element.setAttribute('role', 'search');
		this.element.hidden = true;
		this.field = element('input', 'reader-find-field', this.element);
		this.field.type = 'text';
		this.field.spellcheck = false;
		this.field.placeholder = labels.find;
		this.field.setAttribute('aria-label', labels.find);
		this.count = element('span', 'reader-find-count', this.element);
		this.count.setAttribute('role', 'status');
		this.count.setAttribute('aria-live', 'polite');
		const previous = iconButton('arrowUp', labels.previousMatch, { parent: this.element });
		const next = iconButton('arrowDown', labels.nextMatch, { parent: this.element });
		const close = iconButton('close', labels.close, { parent: this.element });
		for (const button of [previous, next, close]) {
			// The keyboard stays in the field, where Enter goes on.
			button.addEventListener('mousedown', event => event.preventDefault());
		}
		previous.addEventListener('click', () => this.go(-1));
		next.addEventListener('click', () => this.go(1));
		close.addEventListener('click', () => this.close());
		this.field.addEventListener('input', () => {
			window.clearTimeout(this.timer);
			this.timer = undefined;
			if (!this.query) {
				this.setCount(undefined, 0, false);
				this.options.search('');
				return;
			}
			this.timer = window.setTimeout(() => this.flush(), SEARCH_DELAY_MS);
		});
		this.field.addEventListener('keydown', event => {
			if (event.isComposing) {
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				this.go(event.shiftKey ? -1 : 1);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.close();
			}
		});
	}

	get isOpen(): boolean {
		return !this.element.hidden;
	}

	get hasFocus(): boolean {
		return this.element.contains(document.activeElement);
	}

	private get query(): string {
		return this.field.value.trim();
	}

	/** Shows the bar with the cursor in its field, all of it selected; the words it held are searched again. */
	open(): void {
		const wasOpen = this.isOpen;
		this.element.hidden = false;
		this.field.focus();
		this.field.select();
		if (!wasOpen && this.query) {
			this.flush();
		}
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		window.clearTimeout(this.timer);
		this.timer = undefined;
		const hadFocus = this.hasFocus;
		this.element.hidden = true;
		this.setCount(undefined, 0, false);
		this.options.closed();
		if (hadFocus) {
			window.focus();
		}
	}

	/** The match shown, from 1, and how many there are; `done` once the whole document was searched. */
	setCount(current: number | undefined, total: number, done: boolean): void {
		this.count.textContent = total > 0 ? this.options.labels.matchOf.replace('{0}', current === undefined ? '?' : String(current)).replace('{1}', String(total))
			: done && this.query ? this.options.labels.noResults : '';
		this.element.classList.toggle('no-results', done && total === 0 && !!this.query);
	}

	private flush(): void {
		window.clearTimeout(this.timer);
		this.timer = undefined;
		this.options.search(this.query);
	}

	/** Enter and the arrows: the next or the previous match, or the search first when its words were not searched yet. */
	private go(direction: 1 | -1): void {
		if (this.timer !== undefined) {
			this.flush();
			return;
		}
		if (direction === 1) {
			this.options.next();
		} else {
			this.options.previous();
		}
	}
}
