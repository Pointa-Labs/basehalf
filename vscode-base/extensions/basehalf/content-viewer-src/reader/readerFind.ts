/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './readerFind.css';
import type { IBaseHalfReaderLabels } from '../../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { element, iconButton } from './readerDom.js';

/** How long after the last key the words of the field are searched for (PDFs and books, rule 19). */
const SEARCH_DELAY_MS = 250;
/** The longest selected text that Find takes into its field. */
const SEED_LIMIT = 200;

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
 * the field, the count, Previous Match, Next Match, and Close, and a thin
 * line at its foot while a long document is searched.
 */
export class ReaderFindBar {
	readonly element: HTMLElement;
	private readonly field: HTMLInputElement;
	private readonly count: HTMLElement;
	private readonly progress: HTMLElement;
	private timer: number | undefined;
	/** An input method composes in the field: what it holds is not the words yet. */
	private composing = false;
	/** The words last searched, so that Find on the same selection does not search again. */
	private lastSearched: string | undefined;

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
		this.progress = element('div', 'reader-find-progress', this.element);
		this.progress.hidden = true;
		for (const button of [previous, next, close]) {
			// The keyboard stays in the field, where Enter goes on.
			button.addEventListener('mousedown', event => event.preventDefault());
		}
		previous.addEventListener('click', () => this.go(-1));
		next.addEventListener('click', () => this.go(1));
		close.addEventListener('click', () => this.close());
		this.field.addEventListener('compositionstart', () => {
			this.composing = true;
			this.cancelTimer();
		});
		this.field.addEventListener('compositionend', () => {
			this.composing = false;
			this.schedule();
		});
		this.field.addEventListener('input', event => {
			// While an input method composes, its letters are not searched; the words it commits are.
			if (!this.composing && !(event as InputEvent).isComposing) {
				this.schedule();
			}
		});
		this.field.addEventListener('keydown', event => {
			if (event.isComposing || this.composing) {
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

	/** Whether the bar shows with words to find, for Cmd+G in the document. */
	get hasQuery(): boolean {
		return this.isOpen && !!this.query;
	}

	private get query(): string {
		return this.field.value.trim();
	}

	/**
	 * Shows the bar with the cursor in its field, all of it selected. Text
	 * selected in the document, on one line and not too long, becomes its
	 * words and is searched at once; otherwise the words it held are searched
	 * again when it was hidden.
	 */
	open(selected?: string): void {
		const wasOpen = this.isOpen;
		this.element.hidden = false;
		const seed = selected?.trim();
		const takes = !!seed && seed.length <= SEED_LIMIT && !/[\r\n]/.test(seed);
		if (takes && seed !== this.query) {
			this.field.value = seed;
		}
		this.field.focus();
		this.field.select();
		if ((takes && (seed !== this.lastSearched || !wasOpen)) || (!wasOpen && this.query)) {
			this.flush();
		}
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		this.cancelTimer();
		const hadFocus = this.hasFocus;
		this.element.hidden = true;
		this.lastSearched = undefined;
		this.setCount(undefined, 0, false);
		this.setProgress(undefined);
		this.options.closed();
		if (hadFocus) {
			window.focus();
		}
	}

	/** The match shown, from 1, once its place is known, and how many there are; `done` once the whole document was searched. */
	setCount(current: number | undefined, total: number, done: boolean): void {
		const empty = done && total === 0 && !!this.query;
		this.count.textContent = empty ? this.options.labels.noResults
			: current !== undefined && total > 0 ? this.options.labels.matchOf.replace('{0}', String(current)).replace('{1}', String(total))
				: '';
		this.element.classList.toggle('no-results', empty);
	}

	/** How much of a long document was searched, from 0 to 1, or undefined when no search runs. */
	setProgress(searched: number | undefined): void {
		this.progress.hidden = searched === undefined;
		if (searched !== undefined) {
			this.progress.style.transform = `scaleX(${Math.max(0.02, Math.min(1, searched))})`;
		}
	}

	/** Enter, the arrows, and Cmd+G: the next or the previous match, or the search first when its words were not searched yet. */
	go(direction: 1 | -1): void {
		if (this.composing) {
			return;
		}
		if (this.timer !== undefined || this.lastSearched !== this.query) {
			this.flush();
			return;
		}
		if (direction === 1) {
			this.options.next();
		} else {
			this.options.previous();
		}
	}

	private schedule(): void {
		this.cancelTimer();
		if (!this.query) {
			this.lastSearched = '';
			this.setCount(undefined, 0, false);
			this.setProgress(undefined);
			this.options.search('');
			return;
		}
		this.timer = window.setTimeout(() => this.flush(), SEARCH_DELAY_MS);
	}

	private cancelTimer(): void {
		window.clearTimeout(this.timer);
		this.timer = undefined;
	}

	private flush(): void {
		this.cancelTimer();
		this.lastSearched = this.query;
		this.options.search(this.query);
	}
}
