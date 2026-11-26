/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Where the highlights and comments of a PDF stand on its pages (comments,
// "Finding the passage"): each passage found by its quote in the text of its
// page, or of the pages around it, as ranges of characters of a page.

import { findBaseHalfCommentQuote } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentAnchor.js';
import { BASEHALF_COMMENT_DEFAULT_COLOR, BaseHalfCommentColor, IBaseHalfComment, isBaseHalfHighlight } from '../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';

/** A run of characters of one page, from `start` to `end`, both included, as the engine counts them. */
export interface IPdfCharRange {
	readonly pageIndex: number;
	readonly start: number;
	readonly end: number;
}

export type PdfCommentPlace =
	| { readonly kind: 'text'; readonly ranges: readonly IPdfCharRange[] }
	| { readonly kind: 'place'; readonly pageIndex: number; readonly x: number; readonly y: number }
	| { readonly kind: 'missing' };

/** The text of a page, one character of the string for each character the engine counts. */
export type PdfPageTextReader = (pageIndex: number) => Promise<string | undefined>;

/** How far from its `page` a quote is looked for, either way (comments, rule 1). */
const NEARBY_PAGES = 5;

/** How long the comments are looked for before the page may draw again. */
const FIND_SLICE_MS = 8;

/**
 * The comments of the PDF, those of its file and those just made by Comment
 * and not saved yet, with where each stands once it was found.
 */
export class PdfCommentStore {
	private comments: IBaseHalfComment[] = [];
	private readonly drafts = new Map<string, IBaseHalfComment>();
	/** Passages that the page found itself, by a selection: no quote has to be looked for. */
	private readonly known = new Map<string, PdfCommentPlace>();
	private readonly places = new Map<string, PdfCommentPlace>();
	private readonly listeners = new Set<() => void>();
	private run = 0;
	unreadable = false;
	color: BaseHalfCommentColor = BASEHALF_COMMENT_DEFAULT_COLOR;
	version = 0;

	constructor(private readonly pageText: PdfPageTextReader, private readonly pageCount: () => number) { }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Every comment shown, saved ones in the order of the file, then the one being made. */
	all(): IBaseHalfComment[] {
		return [...this.comments.filter(comment => !this.drafts.has(comment.id)), ...this.drafts.values()];
	}

	get(id: string): IBaseHalfComment | undefined {
		return this.drafts.get(id) ?? this.comments.find(comment => comment.id === id);
	}

	place(id: string): PdfCommentPlace | undefined {
		return this.places.get(id);
	}

	isDraft(id: string): boolean {
		return this.drafts.has(id);
	}

	/** The comments of the file, as the window sent them. */
	setComments(comments: readonly IBaseHalfComment[], unreadable: boolean, color: BaseHalfCommentColor): void {
		this.comments = [...comments];
		this.unreadable = unreadable;
		this.color = color;
		for (const comment of comments) {
			this.drafts.delete(comment.id);
		}
		void this.findAll();
	}

	/** A comment changed by this page, shown at once, before the window has kept it. */
	put(comment: IBaseHalfComment, place?: PdfCommentPlace, options: { readonly draft?: boolean } = {}): void {
		if (place) {
			this.known.set(comment.id, place);
			this.places.set(comment.id, place);
		}
		if (options.draft) {
			this.drafts.set(comment.id, comment);
		} else {
			this.drafts.delete(comment.id);
			const index = this.comments.findIndex(existing => existing.id === comment.id);
			if (index === -1) {
				this.comments.push(comment);
			} else {
				this.comments[index] = comment;
			}
		}
		this.changed();
		if (!place) {
			void this.findAll();
		}
	}

	remove(id: string): void {
		this.drafts.delete(id);
		this.comments = this.comments.filter(comment => comment.id !== id);
		this.places.delete(id);
		this.changed();
	}

	/** The tints of a page: each comment's rectangles there are made by the page from these ranges. */
	rangesOn(pageIndex: number): { readonly comment: IBaseHalfComment; readonly start: number; readonly end: number; readonly first: boolean }[] {
		const result: { comment: IBaseHalfComment; start: number; end: number; first: boolean }[] = [];
		for (const comment of this.all()) {
			const place = this.places.get(comment.id);
			if (place?.kind !== 'text') {
				continue;
			}
			place.ranges.forEach((range, index) => {
				if (range.pageIndex === pageIndex) {
					result.push({ comment, start: range.start, end: range.end, first: index === 0 });
				}
			});
		}
		return result;
	}

	/** The page comments of a page. */
	pinsOn(pageIndex: number): { readonly comment: IBaseHalfComment; readonly x: number; readonly y: number }[] {
		const result: { comment: IBaseHalfComment; x: number; y: number }[] = [];
		for (const comment of this.all()) {
			const place = this.places.get(comment.id);
			if (place?.kind === 'place' && place.pageIndex === pageIndex) {
				result.push({ comment, x: place.x, y: place.y });
			}
		}
		return result;
	}

	/** Whether an entry is drawn as a comment, with its wavy line and its mark: one with words or replies, and one just made by Comment (comments, rules 6 and 7). */
	isComment(comment: IBaseHalfComment): boolean {
		return this.drafts.has(comment.id) || !isBaseHalfHighlight(comment);
	}

	/** A comment whose passage shares text with the passage of `id`, a highlight's (comments, rule 10). */
	commentOver(id: string): IBaseHalfComment | undefined {
		const place = this.places.get(id);
		if (place?.kind !== 'text') {
			return undefined;
		}
		return this.all().find(other => {
			const otherPlace = this.places.get(other.id);
			return other.id !== id && this.isComment(other) && otherPlace?.kind === 'text'
				&& otherPlace.ranges.some(range => place.ranges.some(mine => mine.pageIndex === range.pageIndex && mine.start <= range.end && range.start <= mine.end));
		});
	}

	/** The page a comment stands on, from 0, once it was found. */
	pageOf(id: string): number | undefined {
		const place = this.places.get(id);
		return place?.kind === 'text' ? place.ranges[0]?.pageIndex : place?.kind === 'place' ? place.pageIndex : undefined;
	}

	private changed(): void {
		this.version++;
		for (const listener of this.listeners) {
			listener();
		}
	}

	/** Finds every comment's passage again, as the comments or the text it is found in may have changed. */
	private async findAll(): Promise<void> {
		const run = ++this.run;
		this.changed();
		let slice = performance.now();
		for (const comment of this.all()) {
			const place = await this.find(comment);
			if (run !== this.run) {
				return;
			}
			this.places.set(comment.id, place);
			// Many comments are found a slice at a time, and the page draws between slices (comments, "Limits").
			if (performance.now() - slice > FIND_SLICE_MS) {
				await new Promise(resolve => setTimeout(resolve, 0));
				if (run !== this.run) {
					return;
				}
				slice = performance.now();
			}
		}
		this.changed();
	}

	private async find(comment: IBaseHalfComment): Promise<PdfCommentPlace> {
		const pages = this.pageCount();
		const pageIndex = comment.page !== undefined ? Math.min(Math.max(0, comment.page - 1), Math.max(0, pages - 1)) : 0;
		if (comment.place) {
			return { kind: 'place', pageIndex, x: comment.place[0], y: comment.place[1] };
		}
		if (!comment.quote) {
			// An agent's comment with a page and no quote stands at the top right of its page (comments, rule 4).
			return comment.page !== undefined ? { kind: 'place', pageIndex, x: 0.96, y: 0.04 } : { kind: 'missing' };
		}
		const known = this.known.get(comment.id);
		if (known) {
			return known;
		}
		for (const candidate of nearbyPages(pageIndex, pages)) {
			const found = await this.findOn(candidate, comment);
			if (found) {
				return found;
			}
		}
		return { kind: 'missing' };
	}

	/** The passage on a page, or running from it onto the next one. */
	private async findOn(pageIndex: number, comment: IBaseHalfComment): Promise<PdfCommentPlace | undefined> {
		const text = await this.pageText(pageIndex);
		if (text === undefined) {
			return undefined;
		}
		const match = findBaseHalfCommentQuote(text, comment.quote!, comment.before, comment.after);
		if (match) {
			return { kind: 'text', ranges: [{ pageIndex, start: match.start, end: match.end - 1 }] };
		}
		if (pageIndex + 1 >= this.pageCount()) {
			return undefined;
		}
		const next = await this.pageText(pageIndex + 1);
		if (next === undefined) {
			return undefined;
		}
		const joined = `${text}\n${next}`;
		const across = findBaseHalfCommentQuote(joined, comment.quote!, comment.before, comment.after);
		if (!across || across.start >= text.length || across.end <= text.length + 1) {
			return undefined;
		}
		return {
			kind: 'text',
			ranges: [
				{ pageIndex, start: across.start, end: text.length - 1 },
				{ pageIndex: pageIndex + 1, start: 0, end: across.end - text.length - 2 }
			]
		};
	}
}

/** The page, then the pages around it, nearest first. */
function* nearbyPages(pageIndex: number, pages: number): Iterable<number> {
	yield pageIndex;
	for (let distance = 1; distance <= NEARBY_PAGES; distance++) {
		if (pageIndex + distance < pages) {
			yield pageIndex + distance;
		}
		if (pageIndex - distance >= 0) {
			yield pageIndex - distance;
		}
	}
}
