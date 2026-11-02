/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Lexer, Marked, type MarkedExtension, type RendererObject, type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import type { IBaseHalfNoteLinkDefinition } from './basehalfNoteInline.js';
import { baseHalfMarkdownDestination, decodeBaseHalfSmallCharacterReferences } from './basehalfNoteMarkdownText.js';
import { baseHalfNoteMediaKind } from './basehalfNoteMediaKind.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. Beside the Markdown parser it imports only
// plain siblings and, through the media kind, the one list of media files,
// which imports nothing: `strings.js` would bring the workbench's events,
// timers, and observables into that check, where they do not compile.

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

// A note shows a sound as the element (note formats, rule 81). The surfaces
// that render a note take `audio` into their lists with the note's marked
// extension; until then the element is in the extension's list alone, so
// that Rich reads a sound as the note will show it.
const noteHtmlTagsWithSound: ReadonlySet<string> = new Set([...BASEHALF_NOTE_HTML_TAGS, 'audio']);

/**
 * HTML that a note may show as elements stays HTML. Any other HTML becomes
 * text before it is rendered, so that it is shown as the author wrote it. A
 * sanitizer would rebuild it from parsed elements instead, in lower case and
 * with end tags the note does not have.
 */
export function baseHalfNoteShowsOtherHtmlAsWritten(token: Token): void {
	showOtherHtmlAsWritten(token, noteHtmlTags);
}

function showOtherHtmlAsWritten(token: Token, tags: ReadonlySet<string>): void {
	if (token.type !== 'html') {
		return;
	}
	const names = [...token.raw.matchAll(/<\/?(?<name>[A-Za-z][A-Za-z0-9-]*)/g)].map(match => match.groups?.name.toLowerCase() ?? '');
	if (names.length > 0 && names.every(name => tags.has(name))) {
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
 * An address in a double-quoted attribute, as the reader of Markdown left
 * it: its backslash escapes removed and its character references kept, for
 * the page to read once, as it reads the card's.
 */
function quoteAttribute(value: string): string {
	return value.replace(/"/g, '&quot;');
}

/**
 * A Markdown picture of a sound or a video is that sound or that video, in
 * the element's own controls (note formats, rule 26). The address's kind is
 * read as a page reads the address: its character references decoded once.
 * The picture's name and title go: a note stores no name of a video or a
 * sound (rule 22).
 */
function showsMediaOfItsKind(token: Token): boolean {
	if (token.type !== 'image') {
		return false;
	}
	const href = (token as Tokens.Image).href;
	const kind = baseHalfNoteMediaKind(decodeBaseHalfSmallCharacterReferences(href));
	if (kind !== 'video' && kind !== 'audio') {
		return false;
	}
	const html = token as Tokens.Generic;
	html.type = 'html';
	html.text = `<${kind} src="${quoteAttribute(href)}" controls></${kind}>`;
	html.block = false;
	html.pre = false;
	return true;
}

function walkNoteTokens(token: Token): void {
	if (!showsMediaOfItsKind(token)) {
		showOtherHtmlAsWritten(token, noteHtmlTagsWithSound);
	}
}

/**
 * A Markdown link goes to its address read once, as Rich and the guard of
 * which blocks Rich edits read it (note formats, rules 17, 25, and 34): its
 * character references decoded once and the address written by the
 * destination rule. The base renderer writes a link's address with every `&`
 * as `&amp;`, so that a page decodes no reference in it, and takes its
 * backslash escapes off a second time, from the link's text too where that
 * is the address. An address so written holds no reference and no
 * backslash, and the base renderer leaves it as it is.
 */
function linkToAddressAsRead(token: Token, decode: (text: string) => string): void {
	if (token.type === 'link') {
		const link = token as Tokens.Link;
		link.href = baseHalfMarkdownDestination(decode(link.href));
	}
}

export interface IBaseHalfNoteMarkedExtensionOptions {
	/** Decodes character references once, as a page does: the page's own decoding where there is one. Default: every numeric reference and a few named ones. */
	readonly decodeCharacterReferences?: (text: string) => string;
}

/**
 * The note's one extension of `marked` (note formats, rules 26 and 81), for
 * every place a note is rendered: a Markdown picture of a sound or a video
 * becomes the `<audio>` or `<video>` element, HTML that a note does not show
 * as elements becomes text, shown as the author wrote it, and a Markdown
 * link goes to its address as Rich reads it. It works on tokens only: a
 * renderer of an extension would lose to the base renderer's own `link` and
 * `image`.
 */
export function baseHalfNoteMarkedExtension(options: IBaseHalfNoteMarkedExtensionOptions = {}): MarkedExtension {
	const decode = options.decodeCharacterReferences ?? decodeBaseHalfSmallCharacterReferences;
	return {
		walkTokens: token => {
			walkNoteTokens(token);
			linkToAddressAsRead(token, decode);
		}
	};
}

/** Whether the base renderer writes an address as a link or a picture: `marked` writes the text alone for one that `encodeURI` cannot encode. */
function isWritableAddress(href: string): boolean {
	try {
		encodeURI(href);
		return true;
	} catch {
		return false;
	}
}

// Rich's reader writes each address as `marked` read it, so that a block
// keeps the address the file has: the base renderer would encode it, a
// Chinese path into `%E7%AC%94%E8%AE%B0`, which the writer would then
// store. Titles go: Rich keeps a block with a title fixed (rule 34), and the
// card shows none (rule 57).
const readingRenderer: RendererObject = {
	link({ href, tokens }) {
		const text = this.parser.parseInline(tokens);
		return isWritableAddress(href) ? `<a href="${quoteAttribute(href)}">${text}</a>` : text;
	},
	image({ href, text }) {
		// The lexer gives the name with `<`, `>`, `"`, `'`, and a lone `&` already escaped.
		return isWritableAddress(href) ? `<img src="${quoteAttribute(href)}" alt="${text}">` : text;
	}
};

const readingMarked = new Marked({ renderer: readingRenderer });
const shownMarked = new Marked();

export interface IBaseHalfNoteMarkdownToHtmlOptions {
	/**
	 * The note's reference definitions, by label as `marked` keys them, so that
	 * a part of a note reads its references as the whole note does.
	 */
	readonly definitions?: Readonly<Record<string, IBaseHalfNoteLinkDefinition>>;
	/**
	 * Rich's reader (note formats, rule 25): the note's extension, with
	 * pictures of sounds and videos as those elements and a sound as an
	 * element, and links and pictures with their addresses as the file has
	 * them, without titles.
	 */
	readonly forReading?: boolean;
}

/**
 * The HTML of a note's Markdown where the base Markdown renderer is not at
 * hand: with tables, strikethrough, and bare addresses, and a single line
 * break as a line break, as the card reads a note. It is not sanitized: the
 * caller keeps only {@link BASEHALF_NOTE_HTML_TAGS} and
 * {@link BASEHALF_NOTE_HTML_ATTRIBUTES} of it before it reaches a document,
 * or reads it in a document that runs nothing.
 */
export function baseHalfNoteMarkdownToHtml(source: string, options: IBaseHalfNoteMarkdownToHtmlOptions = {}): string {
	if (!options.forReading && !options.definitions) {
		return new Marked({ walkTokens: baseHalfNoteShowsOtherHtmlAsWritten }).parse(source, { gfm: true, breaks: true, async: false });
	}
	// A lexer keeps its options object and adds its tokenizer to it, so each
	// lexer gets an object of its own.
	const lexer = new Lexer({ gfm: true, breaks: true });
	for (const [label, definition] of Object.entries(options.definitions ?? {})) {
		lexer.tokens.links[label] = { href: definition.href, title: definition.title ?? null };
	}
	const tokens = lexer.lex(source);
	const marked = options.forReading ? readingMarked : shownMarked;
	marked.walkTokens(tokens, options.forReading ? walkNoteTokens : baseHalfNoteShowsOtherHtmlAsWritten);
	return marked.parser(tokens);
}
