/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Find in a PDF (PDFs and books, rule 19): the reader searches the text of
// the pages itself, as the comments find their quotes, from the page it shows
// to the end and round to it, and keeps the matches of each page.

import { baseHalfFindPattern, baseHalfFindText, findBaseHalfMatches, type IBaseHalfFindText } from '../../../src/vs/workbench/basehalf/documents/common/basehalfReaderFind.js';

/** A match of Find: characters of a page from `start` to before `end`, as the engine counts them. */
export interface IPdfFindMatch {
	readonly pageIndex: number;
	readonly start: number;
	readonly end: number;
}

/** Where a search starts: the top of what the reader shows, a page and a height on it in the units of the page, or the selected text that Find took. */
export interface IPdfFindPlace {
	readonly pageIndex: number;
	readonly top: number;
	/** The character of the page that the selected text starts at, when Find took it: the match marked first is the one selected. */
	readonly char?: number;
}

export interface IPdfFindOptions {
	readonly pageCount: () => number;
	/** The text of a page, one character of the string for each character the engine counts. */
	readonly pageText: (pageIndex: number) => Promise<string | undefined>;
	/** The top of a match on its page, in the units of the page, when the boxes of its page are known. */
	readonly matchTop: (match: IPdfFindMatch) => number | undefined;
	/** A match is marked more strongly: the first at or after the place the search started from, or round to the first of the document, or the next or the one before. */
	readonly onShow: (match: IPdfFindMatch) => void;
	/** The matches, the match shown, or how much was searched changed; called once a frame at most. */
	readonly onChange: () => void;
}

/** How many texts of pages are asked for ahead of the one searched, so that the engine always has the next to read. */
const TEXTS_AHEAD = 6;
/** How long the search goes on before the page may draw. */
const SLICE_MS = 8;

const NO_MATCHES: readonly IPdfFindMatch[] = [];

export class PdfFind {
	/** The text of each page as Find matches in it, kept while the find bar shows. */
	private readonly forms = new Map<number, IBaseHalfFindText>();
	private byPage = new Map<number, readonly IPdfFindMatch[]>();
	private ordered: IPdfFindMatch[] | undefined;
	private run = 0;
	private pages = 0;
	private searchedPages = 0;
	private frame: number | undefined;
	private shown: IPdfFindMatch | undefined;
	private finished = true;
	/** Grows with every change, for the pages that draw the marks. */
	version = 0;

	constructor(private readonly options: IPdfFindOptions) { }

	/** The match marked more strongly, the one the reader went to. */
	get active(): IPdfFindMatch | undefined {
		return this.shown;
	}

	/** Whether every page was searched. */
	get done(): boolean {
		return this.finished;
	}

	/** The share of the pages searched, from 0 to 1. */
	get progress(): number {
		return this.pages ? this.searchedPages / this.pages : 1;
	}

	/** Every match, in the order of the document. */
	get all(): readonly IPdfFindMatch[] {
		if (!this.ordered) {
			this.ordered = [...this.byPage.keys()].sort((a, b) => a - b).flatMap(pageIndex => this.byPage.get(pageIndex)!);
		}
		return this.ordered;
	}

	/** The place of the match shown among all of them, from 1, once every page was searched. */
	get activeIndex(): number | undefined {
		const active = this.shown;
		return active && this.finished ? this.all.indexOf(active) + 1 : undefined;
	}

	matchesOn(pageIndex: number): readonly IPdfFindMatch[] {
		return this.byPage.get(pageIndex) ?? NO_MATCHES;
	}

	/**
	 * Searches every page for `query`, from the page of `from` to the end and
	 * round to it, and shows the first match at or after `from`. A new search
	 * ends the one before.
	 */
	async search(query: string, from: IPdfFindPlace): Promise<void> {
		const run = ++this.run;
		this.byPage = new Map();
		this.ordered = undefined;
		this.shown = undefined;
		this.searchedPages = 0;
		this.pages = this.options.pageCount();
		const pattern = baseHalfFindPattern(query);
		this.finished = !pattern || this.pages === 0;
		this.changed();
		if (!pattern || this.finished) {
			return;
		}
		const start = Math.min(Math.max(0, from.pageIndex), this.pages - 1);
		const order = [...Array.from({ length: this.pages - start }, (_, index) => start + index), ...Array.from({ length: start }, (_, index) => index)];
		const asked = new Map<number, Promise<string | undefined>>();
		const ask = (position: number) => {
			const pageIndex = order[position];
			if (pageIndex !== undefined && !asked.has(pageIndex)) {
				asked.set(pageIndex, this.options.pageText(pageIndex));
			}
		};
		for (let position = 0; position < TEXTS_AHEAD; position++) {
			ask(position);
		}
		let sliceStart = performance.now();
		for (let position = 0; position < order.length; position++) {
			const pageIndex = order[position];
			ask(position + TEXTS_AHEAD);
			const original = await asked.get(pageIndex);
			asked.delete(pageIndex);
			if (run !== this.run) {
				return;
			}
			const matches = original ? this.matchPage(pageIndex, original, pattern) : NO_MATCHES;
			if (matches.length) {
				this.byPage.set(pageIndex, matches);
				this.ordered = undefined;
			}
			this.searchedPages++;
			if (!this.shown) {
				// On the page the search started from, the first match at or under the top of what the reader shows, or at the selected text.
				const first = pageIndex !== start ? matches[0]
					: from.char !== undefined ? matches.find(match => match.end > from.char!)
						: matches.find(match => (this.options.matchTop(match) ?? Infinity) >= from.top - 2);
				if (first) {
					this.show(first);
				}
			}
			this.changed();
			if (performance.now() - sliceStart > SLICE_MS) {
				await new Promise(resolve => window.setTimeout(resolve, 0));
				if (run !== this.run) {
					return;
				}
				sliceStart = performance.now();
			}
		}
		this.finished = true;
		// None at or after the place: round to the first of the document, which may be above it on its page.
		if (!this.shown && this.all.length) {
			this.show(this.all[0]);
		}
		this.changed();
	}

	/** The next match or the one before, round from the last to the first. */
	step(direction: 1 | -1): IPdfFindMatch | undefined {
		const all = this.all;
		if (!all.length) {
			return undefined;
		}
		const at = this.shown ? all.indexOf(this.shown) : -1;
		const next = all[at === -1 ? (direction === 1 ? 0 : all.length - 1) : (at + direction + all.length) % all.length];
		this.show(next);
		this.changed();
		return next;
	}

	/** The search ends and its marks go; the texts made for it go once the bar is hidden. */
	clear(releaseTexts: boolean): void {
		this.run++;
		this.byPage = new Map();
		this.ordered = undefined;
		this.shown = undefined;
		this.searchedPages = 0;
		this.pages = 0;
		this.finished = true;
		if (releaseTexts) {
			this.forms.clear();
		}
		this.changed();
	}

	private show(match: IPdfFindMatch): void {
		this.shown = match;
		this.options.onShow(match);
	}

	private matchPage(pageIndex: number, original: string, pattern: RegExp): readonly IPdfFindMatch[] {
		let form = this.forms.get(pageIndex);
		if (!form) {
			form = baseHalfFindText(original);
			this.forms.set(pageIndex, form);
		}
		return findBaseHalfMatches(original, form, pattern).map(match => ({ pageIndex, start: match.start, end: match.end }));
	}

	private changed(): void {
		this.version++;
		if (this.frame === undefined) {
			this.frame = window.requestAnimationFrame(() => {
				this.frame = undefined;
				this.options.onChange();
			});
		}
	}
}
