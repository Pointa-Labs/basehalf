/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Marked, type Token, type Tokens } from '../../../../base/common/marked/marked.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. Beside the Markdown parser it imports nothing:
// `strings.js` would bring the workbench's events, timers, and observables
// into that check, where they do not compile.

/**
 * The HTML elements a note may show as elements (note rendering). Markdown
 * renders to some of them, and the author may write the others. It is the
 * list of the base Markdown renderer (`allowedMarkdownHtmlTags`), which this
 * layer cannot import; a test keeps the two the same.
 */
export const BASEHALF_NOTE_HTML_TAGS: readonly string[] = Object.freeze([
	'a', 'abbr', 'b', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details',
	'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input',
	'ins', 'kbd', 'label', 'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'source', 'span',
	'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u',
	'ul', 'var', 'video', 'wbr'
]);

/** The attributes those elements keep where a note is rendered without the base Markdown renderer. */
export const BASEHALF_NOTE_HTML_ATTRIBUTES: readonly string[] = Object.freeze([
	'align', 'alt', 'checked', 'colspan', 'controls', 'disabled', 'height', 'href', 'loop', 'muted', 'playsinline',
	'poster', 'rowspan', 'src', 'start', 'title', 'type', 'width'
]);

const noteHtmlTags: ReadonlySet<string> = new Set(BASEHALF_NOTE_HTML_TAGS);

/**
 * HTML that a note may show as elements stays HTML. Any other HTML becomes
 * text before it is rendered, so that it is shown as the author wrote it. A
 * sanitizer would rebuild it from parsed elements instead, in lower case and
 * with end tags the note does not have.
 */
export function baseHalfNoteShowsOtherHtmlAsWritten(token: Token): void {
	if (token.type !== 'html') {
		return;
	}
	const names = [...token.raw.matchAll(/<\/?(?<name>[A-Za-z][A-Za-z0-9-]*)/g)].map(match => match.groups?.name.toLowerCase() ?? '');
	if (names.length > 0 && names.every(name => noteHtmlTags.has(name))) {
		return;
	}
	// The renderer prints the text of a text token as it is, so the token
	// carries its text already escaped.
	const text = token as Tokens.Generic;
	text.type = 'text';
	text.text = escapeHtmlText(token.raw);
	text.escaped = true;
}

/** Escapes the three characters that would make text into HTML, as `escape` of the base strings does. */
function escapeHtmlText(text: string): string {
	return text.replace(/[<>&]/g, match => match === '<' ? '&lt;' : match === '>' ? '&gt;' : '&amp;');
}

/**
 * The HTML of a note's Markdown where the base Markdown renderer is not at
 * hand. It is not sanitized: the caller keeps only
 * {@link BASEHALF_NOTE_HTML_TAGS} and {@link BASEHALF_NOTE_HTML_ATTRIBUTES}
 * of it before it reaches a document.
 */
export function baseHalfNoteMarkdownToHtml(source: string): string {
	return new Marked({ walkTokens: baseHalfNoteShowsOtherHtmlAsWritten }).parse(source, { gfm: true, breaks: true, async: false });
}
