/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What Find in a PDF matches (PDFs and books, rule 19): the text of a page
// in the form a person means when they type, and the words typed made into a
// pattern of that form. The PDF reader imports this module into its page, so
// it imports only a module that imports nothing of the workbench.

import { baseHalfPlainCharacter } from '../../comments/common/basehalfCommentAnchor.js';

/** A text as Find matches in it, and for each of its UTF-16 units the place in the original text where the character it came from starts. */
export interface IBaseHalfFindText {
	readonly text: string;
	readonly origins: Uint32Array;
}

/** A match in the original text: from `start` to before `end`, in UTF-16 units. */
export interface IBaseHalfFindMatch {
	readonly start: number;
	readonly end: number;
}

/** PDFium's mark for a hyphen at the end of a line that broke a word, in place of the hyphen and the line break. */
const HYPHENATION_MARK = 0xfffe;
const SOFT_HYPHEN = 0xad;
const SPACE = 0x20;
const HYPHEN = 0x2d;

function isSpace(code: number): boolean {
	return code === SPACE || (code >= 0x09 && code <= 0x0d) || code === 0x85 || code === 0xa0 || code === 0x1680
		|| (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
}

function isLineBreak(code: number): boolean {
	return code === 0x0a || code === 0x0d || code === 0x85 || code === 0x2028 || code === 0x2029;
}

/** Characters that count as nothing: those of no width, and accents that a PDF holds apart from their letters. */
function isIgnored(code: number): boolean {
	return (code >= 0x200b && code <= 0x200d) || code === 0x2060 || code === 0xfeff || (code >= 0x300 && code <= 0x36f);
}

/**
 * Chinese and Japanese, which set no space between words: white space next
 * to them, as at the end of one of their lines, counts as nothing.
 */
export function isBaseHalfUnspacedScript(code: number): boolean {
	return (code >= 0x2e80 && code <= 0x2fdf)
		|| (code >= 0x3001 && code <= 0x30ff)
		|| (code >= 0x3100 && code <= 0x312f)
		|| (code >= 0x31f0 && code <= 0x31ff)
		|| (code >= 0x3400 && code <= 0x4dbf)
		|| (code >= 0x4e00 && code <= 0x9fff)
		|| (code >= 0xf900 && code <= 0xfaff)
		|| (code >= 0xff00 && code <= 0xffef)
		|| (code >= 0x20000 && code <= 0x3134f);
}

/** Ideographs, kana, and Hangul syllables, which have no case, no accents, and are their own compatibility form. */
function isPlainScript(code: number): boolean {
	return (code >= 0x3041 && code <= 0x3096) || (code >= 0x30a1 && code <= 0x30fa) || (code >= 0x3400 && code <= 0x4dbf)
		|| (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0x20000 && code <= 0x2a6df);
}

/** Latin and Greek letters with accents, which Find matches without them. Cyrillic keeps them: a short i is another letter than an i. */
const ACCENTED = /[\u00C0-\u024F\u1E00-\u1EFF\u0370-\u03FF\u1F00-\u1FFF]/u;
const ACCENTS = /[\u0300-\u036F]/gu;
const LETTER = /\p{L}/u;

/** A character as Find matches it: plain, in its compatibility form, in lower case, and without accents. */
function findForm(character: string): string {
	const form = baseHalfPlainCharacter(character).toLowerCase();
	return ACCENTED.test(form) ? form.normalize('NFD').replace(ACCENTS, '') : form;
}

/** Whether a hyphen at `index` ends a line, and the word goes on in a letter at the start of the next. */
function hyphenEndsLine(original: string, index: number): boolean {
	let at = index + 1;
	while (at < original.length && (original.charCodeAt(at) === SPACE || original.charCodeAt(at) === 0x09)) {
		at++;
	}
	if (at >= original.length || !isLineBreak(original.charCodeAt(at))) {
		return false;
	}
	while (at < original.length && isSpace(original.charCodeAt(at))) {
		at++;
	}
	return at < original.length && LETTER.test(String.fromCodePoint(original.codePointAt(at)!));
}

/**
 * The text as Find matches in it: in lower case, without accents, in the
 * compatibility form of its characters, with plain quotation marks and
 * dashes, and with runs of white space as one space. A hyphen at the end of a
 * line that broke a word is nothing, and so is white space next to Chinese
 * or Japanese text.
 */
export function baseHalfFindText(original: string): IBaseHalfFindText {
	let codes = new Uint16Array(original.length + 16);
	let origins = new Uint32Array(original.length + 16);
	let length = 0;
	const push = (code: number, origin: number) => {
		if (length === codes.length) {
			const grownCodes = new Uint16Array(codes.length * 2);
			grownCodes.set(codes);
			codes = grownCodes;
			const grownOrigins = new Uint32Array(origins.length * 2);
			grownOrigins.set(origins);
			origins = grownOrigins;
		}
		codes[length] = code;
		origins[length] = origin;
		length++;
	};
	// After a hyphen that ended a line, the white space that follows is nothing: the word goes on.
	let joinNext = false;
	// The last character of the original that gave the text something.
	let previous = -1;
	for (let index = 0; index < original.length;) {
		const code = original.codePointAt(index)!;
		const width = code > 0xffff ? 2 : 1;
		if (isSpace(code)) {
			let end = index + 1;
			while (end < original.length && isSpace(original.charCodeAt(end))) {
				end++;
			}
			const next = end < original.length ? original.codePointAt(end)! : -1;
			const nothing = joinNext || length === 0 || next === -1 || codes[length - 1] === SPACE
				|| isBaseHalfUnspacedScript(previous) || isBaseHalfUnspacedScript(next);
			if (!nothing) {
				push(SPACE, index);
			}
			joinNext = false;
			index = end;
			continue;
		}
		if (code === HYPHENATION_MARK || code === SOFT_HYPHEN) {
			// A hyphen that the text kept before the mark goes with the mark.
			if (length > 0 && codes[length - 1] === HYPHEN) {
				length--;
			}
			joinNext = true;
			index += width;
			continue;
		}
		if (isIgnored(code)) {
			index += width;
			continue;
		}
		if ((code === HYPHEN || code === 0x2010) && length > 0 && LETTER.test(String.fromCharCode(codes[length - 1])) && hyphenEndsLine(original, index)) {
			joinNext = true;
			index += width;
			continue;
		}
		joinNext = false;
		previous = code;
		if (code < 0x80) {
			push(code >= 0x41 && code <= 0x5a ? code + 0x20 : code, index);
		} else if (isPlainScript(code)) {
			push(original.charCodeAt(index), index);
			if (width === 2) {
				push(original.charCodeAt(index + 1), index);
			}
		} else {
			const form = findForm(String.fromCodePoint(code));
			for (let unit = 0; unit < form.length; unit++) {
				push(form.charCodeAt(unit), index);
			}
		}
		index += width;
	}
	let text = '';
	for (let at = 0; at < length; at += 8192) {
		text += String.fromCharCode(...codes.subarray(at, Math.min(length, at + 8192)));
	}
	return { text, origins: origins.slice(0, length) };
}

/**
 * The words typed into Find as a pattern of the form of `baseHalfFindText`,
 * or undefined when they hold nothing to find. A hyphen in them may be
 * missing in the text, where a line broke the words at it.
 */
export function baseHalfFindPattern(query: string): RegExp | undefined {
	const form = baseHalfFindText(query).text;
	if (!form || form === ' ') {
		return undefined;
	}
	const hyphensOptional = /[^\s-]/u.test(form);
	let source = '';
	for (const character of form) {
		source += character === '-' && hyphensOptional ? '-?' : character.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
	}
	return new RegExp(source, 'gu');
}

/** The matches of a pattern of `baseHalfFindPattern` in a text, as places in the original text. */
export function findBaseHalfMatches(original: string, text: IBaseHalfFindText, pattern: RegExp): IBaseHalfFindMatch[] {
	const matches: IBaseHalfFindMatch[] = [];
	pattern.lastIndex = 0;
	for (let found = pattern.exec(text.text); found; found = pattern.exec(text.text)) {
		if (!found[0].length) {
			pattern.lastIndex++;
			continue;
		}
		const last = text.origins[found.index + found[0].length - 1];
		let end = last + (original.codePointAt(last)! > 0xffff ? 2 : 1);
		// An accent that the text holds apart from its letter belongs to the match.
		while (end < original.length && original.charCodeAt(end) >= 0x300 && original.charCodeAt(end) <= 0x36f) {
			end++;
		}
		matches.push({ start: text.origins[found.index], end });
	}
	return matches;
}
