/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// How a comment finds its passage by quoting it (comments, "Finding the
// passage"). The readers and the Rich editor import this module into their
// pages, so it imports only its sibling.

import { BASEHALF_COMMENT_CONTEXT_LENGTH } from './basehalfComments.js';

/** Where a passage is in a text: from `start` to before `end`, in UTF-16 units of the text. */
export interface IBaseHalfCommentMatch {
	readonly start: number;
	readonly end: number;
}

/**
 * A text made ready for finding a quote, with the place in the original text
 * of each of its UTF-16 units: where the character it came from starts, and
 * where it ends.
 */
interface ISearchText {
	readonly text: string;
	readonly starts: readonly number[];
	readonly ends: readonly number[];
}

const SPACE = /\s/u;

/**
 * A character as a quote counts it: letters made into one glyph are their
 * letters, and curly quotation marks and dashes are the plain ones, which is
 * what an agent that copied the text with a tool of its own may have.
 */
function plainCharacter(character: string): string {
	switch (character) {
		case '‘': case '’': case '‚': case '‛': case '′':
			return '\'';
		case '“': case '”': case '„': case '‟': case '″':
			return '"';
		case '‐': case '‑': case '‒': case '–': case '—': case '−':
			return '-';
	}
	return character.normalize('NFKC');
}

/**
 * The text as quotes are found in it. Runs of white space are one space, or,
 * when `compact`, nothing, and then a hyphen at the end of a line is nothing
 * too: the two forms of a word that a PDF broke over two lines.
 */
function searchText(original: string, compact: boolean): ISearchText {
	let text = '';
	const starts: number[] = [];
	const ends: number[] = [];
	let afterSpace = true;
	for (let index = 0; index < original.length;) {
		const codePoint = original.codePointAt(index)!;
		// Most of a page is ASCII, which is its own plain form: no normalization, and white space by its codes.
		if (codePoint < 0x80) {
			if (codePoint === 0x20 || (codePoint >= 0x09 && codePoint <= 0x0d)) {
				if (!compact && !afterSpace) {
					text += ' ';
					starts.push(index);
					ends.push(index + 1);
					afterSpace = true;
				}
			} else if (!(compact && codePoint === 0x2d && /^[ \t]*\r?\n/.test(original.slice(index + 1, index + 8)))) {
				text += original[index];
				starts.push(index);
				ends.push(index + 1);
				afterSpace = false;
			}
			index++;
			continue;
		}
		const width = codePoint > 0xffff ? 2 : 1;
		const character = String.fromCodePoint(codePoint);
		if (character === '­') {
			index += width;
			continue;
		}
		if (SPACE.test(character)) {
			if (!compact && !afterSpace) {
				text += ' ';
				starts.push(index);
				ends.push(index + width);
				afterSpace = true;
			}
			index += width;
			continue;
		}
		if (compact && character === '-' && /^[ \t]*\r?\n/.test(original.slice(index + 1, index + 8))) {
			index += width;
			continue;
		}
		const normalized = plainCharacter(character);
		const plain = SPACE.test(normalized) ? ' ' : normalized;
		for (let unit = 0; unit < plain.length; unit++) {
			starts.push(index);
			ends.push(index + width);
		}
		text += plain;
		afterSpace = plain === ' ';
		index += width;
	}
	if (text.endsWith(' ')) {
		text = text.slice(0, -1);
		starts.pop();
		ends.pop();
	}
	return { text, starts, ends };
}

/** The search texts of the texts searched last, by form: a reader looks for many quotes in the same page. */
const searchTexts = [new Map<string, ISearchText>(), new Map<string, ISearchText>()];
const SEARCH_TEXTS_KEPT = 8;

function cachedSearchText(original: string, compact: boolean): ISearchText {
	const cache = searchTexts[compact ? 1 : 0];
	let value = cache.get(original);
	if (!value) {
		value = searchText(original, compact);
		if (cache.size >= SEARCH_TEXTS_KEPT) {
			cache.delete(cache.keys().next().value!);
		}
		cache.set(original, value);
	}
	return value;
}

/** A quote as a comment keeps it: runs of white space as one space, without white space at either end. */
export function normalizeBaseHalfCommentQuote(text: string): string {
	return text.replace(/\s+/gu, ' ').trim();
}

/**
 * The passage that `quote` names in `text`, or undefined. Where the quote is
 * found more than once, the place whose text before and after it matches
 * `before` and `after` best; when none is better, the first.
 */
export function findBaseHalfCommentQuote(text: string, quote: string, before?: string, after?: string): IBaseHalfCommentMatch | undefined {
	for (const compact of [false, true]) {
		const haystack = cachedSearchText(text, compact);
		const needle = searchText(quote, compact).text;
		if (!needle) {
			return undefined;
		}
		const found: number[] = [];
		for (let at = haystack.text.indexOf(needle); at !== -1; at = haystack.text.indexOf(needle, at + 1)) {
			found.push(at);
		}
		if (found.length === 0) {
			continue;
		}
		let best = found[0];
		if (found.length > 1 && (before || after)) {
			const prior = before ? searchText(before, compact).text : '';
			const next = after ? searchText(after, compact).text : '';
			let bestScore = -1;
			for (const at of found) {
				const textBefore = haystack.text.slice(Math.max(0, at - prior.length - 2), at).trimEnd();
				const textAfter = haystack.text.slice(at + needle.length, at + needle.length + next.length + 2).trimStart();
				const score = commonSuffix(textBefore, prior) + commonPrefix(textAfter, next);
				if (score > bestScore) {
					best = at;
					bestScore = score;
				}
			}
		}
		return { start: haystack.starts[best], end: haystack.ends[best + needle.length - 1] };
	}
	return undefined;
}

/** The text just before and after a passage, as a new comment keeps it to tell apart a quote found more than once. */
export function baseHalfCommentContext(text: string, start: number, end: number): { readonly before?: string; readonly after?: string } {
	const before = normalizeBaseHalfCommentQuote(text.slice(Math.max(0, start - BASEHALF_COMMENT_CONTEXT_LENGTH * 2), start)).slice(-BASEHALF_COMMENT_CONTEXT_LENGTH).trimStart();
	const after = normalizeBaseHalfCommentQuote(text.slice(end, end + BASEHALF_COMMENT_CONTEXT_LENGTH * 2)).slice(0, BASEHALF_COMMENT_CONTEXT_LENGTH).trimEnd();
	return {
		...(before ? { before: /\s$/u.test(text.slice(Math.max(0, start - 1), start)) ? `${before} ` : before } : {}),
		...(after ? { after: /^\s/u.test(text.slice(end, end + 1)) ? ` ${after}` : after } : {})
	};
}

function commonSuffix(left: string, right: string): number {
	let count = 0;
	while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) {
		count++;
	}
	return count;
}

function commonPrefix(left: string, right: string): number {
	let count = 0;
	while (count < left.length && count < right.length && left[count] === right[count]) {
		count++;
	}
	return count;
}
