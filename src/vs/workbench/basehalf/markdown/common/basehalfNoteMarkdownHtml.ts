/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Lexer, Marked, type MarkedExtension, type RendererObject, type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import { parseBaseHalfHtmlTag, type IBaseHalfNoteLinkDefinition } from './basehalfNoteInline.js';
import { baseHalfMarkdownDestination, decodeBaseHalfSmallCharacterReferences } from './basehalfNoteMarkdownText.js';
import { baseHalfNoteMediaKind } from './basehalfNoteMediaKind.js';
import { isBaseHalfNoteFileAddress } from './basehalfNoteStructure.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. Beside the Markdown parser it imports only
// plain siblings and, through the media kind, the one list of media files,
// which imports nothing: `strings.js` would bring the workbench's events,
// timers, and observables into that check, where they do not compile.

/**
 * The HTML elements a note may show as elements (note rendering). Markdown
 * renders to some of them, and the author may write the others. It is the
 * list of the base Markdown renderer (`allowedMarkdownHtmlTags`), which this
 * layer cannot import, and the sound a note stores as `<audio>` (note
 * formats, rule 11); a test keeps the list so.
 */
export const BASEHALF_NOTE_HTML_TAGS: readonly string[] = Object.freeze([
	'a', 'abbr', 'b', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details',
	'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input',
	'ins', 'kbd', 'label', 'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'source', 'span',
	'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u',
	'ul', 'var', 'video', 'wbr', 'audio'
]);

/** The attributes those elements keep where a note is rendered without the base Markdown renderer. */
export const BASEHALF_NOTE_HTML_ATTRIBUTES: readonly string[] = Object.freeze([
	'align', 'alt', 'checked', 'colspan', 'controls', 'disabled', 'height', 'href', 'loop', 'muted', 'open', 'playsinline',
	'poster', 'rowspan', 'src', 'start', 'title', 'type', 'width'
]);

/**
 * The one spelling of a span's style a note shows (note formats, rule 48),
 * as the base Markdown renderer keeps it: a color, a background color, or
 * both, each a hex color followed by `;`.
 */
export const BASEHALF_NOTE_SPAN_STYLE = /^(color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(border-radius:[0-9]+px;)?$/;

const noteHtmlTags: ReadonlySet<string> = new Set(BASEHALF_NOTE_HTML_TAGS);

// A note shows a sound as the element (note formats, rule 81). The surfaces
// that render a note take `audio` into their lists with the note's marked
// extension; until then the element is in the extension's list alone, so
// that Rich reads a sound as the note will show it.

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
		showOtherHtmlAsWritten(token, noteHtmlTags);
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

/**
 * The title the note's extension gives a link that Rich shows as a file
 * block, for the place that draws the note to draw the block (note formats,
 * rule 81). It never shows: where a note is drawn, every title of a link is
 * dropped (rule 57).
 */
export const BASEHALF_NOTE_FILE_LINK_TITLE = 'basehalf-file-block';

/** The icon of Rich's file block, from the icons of its editor, at 24 by 24: the card, Preview, and a fixed block draw it too. */
export const BASEHALF_NOTE_FILE_ICON_PATH = 'M3 8L9.00319 2H19.9978C20.5513 2 21 2.45531 21 2.9918V21.0082C21 21.556 20.5551 22 20.0066 22H3.9934C3.44476 22 3 21.5501 3 20.9932V8ZM10 4V9H5V20H19V4H10Z';

/** A paragraph that Rich shows as a file block: the name the block shows and the address of its file as the note has it. */
export interface IBaseHalfNoteFileLink {
	readonly name: string;
	readonly href: string;
}

interface IBaseHalfNoteFileParagraph extends IBaseHalfNoteFileLink {
	/** Gives the paragraph's link the title {@link BASEHALF_NOTE_FILE_LINK_TITLE}. */
	mark(): void;
}

/**
 * Finds, as `marked` walks a note's tokens, a parent before its children,
 * each paragraph that Rich shows as a file block (note formats, rules 12 and
 * 81): a paragraph at any depth that is one link to a file of the note's
 * folder, a Markdown link or `<a>` with an address alone (rule 37), with a
 * name, without a title and without a format, and nothing but white space
 * around it. The first lines of a list item are the item's own text, and
 * the paragraphs of a quote are the quote's: neither is a paragraph of its
 * own.
 */
function fileParagraphFinder(decode: (text: string) => string): (token: Token) => IBaseHalfNoteFileParagraph | undefined {
	const notParagraphs = new WeakSet<Token>();
	const addAll = (tokens: readonly Token[] | undefined): void => {
		for (const token of tokens ?? []) {
			notParagraphs.add(token);
			addAll(token.type === 'list' ? (token as Tokens.List).items : (token as Tokens.Generic).tokens);
		}
	};
	const isSpace = (token: Token) => token.type === 'br' || (token.type === 'text' && decode((token as Tokens.Text).text).trim() === '');
	// A name without a format: text, and characters written with a backslash.
	const nameOf = (tokens: readonly Token[]) => tokens.length > 0 && tokens.every(token => token.type === 'text' || token.type === 'escape')
		? tokens.map(token => token.type === 'text' ? decode((token as Tokens.Text).text) : (token as Tokens.Escape).text).join('')
		: undefined;
	return token => {
		if (token.type === 'list_item') {
			const first = (token as Tokens.ListItem).tokens[0];
			if (first) {
				notParagraphs.add(first);
			}
			return undefined;
		}
		if (token.type === 'blockquote') {
			addAll((token as Tokens.Blockquote).tokens);
			return undefined;
		}
		// A paragraph, or the text of a list item after its first lines: `marked` reads a list item's paragraphs as text that holds its inline tokens.
		const inline = (token.type === 'paragraph' || token.type === 'text') && !notParagraphs.has(token) ? (token as Tokens.Paragraph).tokens : undefined;
		if (!Array.isArray(inline)) {
			return undefined;
		}
		let first = 0;
		let last = inline.length - 1;
		while (first <= last && isSpace(inline[first])) {
			first++;
		}
		while (last >= first && isSpace(inline[last])) {
			last--;
		}
		const shown = inline.slice(first, last + 1);
		if (shown.length === 1 && shown[0].type === 'link') {
			const link = shown[0] as Tokens.Link;
			const name = link.title ? undefined : nameOf(link.tokens);
			const href = decode(link.href);
			return name !== undefined && isBaseHalfNoteFileAddress(href) ? { name, href, mark: () => { link.title = BASEHALF_NOTE_FILE_LINK_TITLE; } } : undefined;
		}
		const open = shown.length > 2 && shown[0].type === 'html' ? parseBaseHalfHtmlTag(shown[0].raw) : undefined;
		const close = open && shown[shown.length - 1].type === 'html' ? parseBaseHalfHtmlTag(shown[shown.length - 1].raw) : undefined;
		if (open?.kind !== 'start' || open.name !== 'a' || open.selfClosing || open.attributes.length !== 1 || open.attributes[0][0] !== 'href' || close?.kind !== 'end' || close.name !== 'a') {
			return undefined;
		}
		const name = nameOf(shown.slice(1, -1));
		const href = decode(open.attributes[0][1] ?? '');
		const html = shown[0] as Tokens.HTML;
		return name !== undefined && isBaseHalfNoteFileAddress(href) ? { name, href, mark: () => { html.text = html.text.replace(/^<a\b/i, `<a title="${BASEHALF_NOTE_FILE_LINK_TITLE}"`); } } : undefined;
	};
}

export interface IBaseHalfNoteMarkedExtensionOptions {
	/** Decodes character references once, as a page does: the page's own decoding where there is one. Default: every numeric reference and a few named ones. */
	readonly decodeCharacterReferences?: (text: string) => string;
	/** The address a link is drawn with, from its address as Rich reads it: the place that draws the note gives the absolute address of what a path names. */
	readonly resolveLink?: (href: string) => string;
}

/**
 * The note's one extension of `marked` (note formats, rules 26 and 81), for
 * every place a note is rendered: a Markdown picture of a sound or a video
 * becomes the `<audio>` or `<video>` element, HTML that a note does not show
 * as elements becomes text, shown as the author wrote it, a Markdown link
 * goes to its address as Rich reads it, and the link of a paragraph that
 * Rich shows as a file block has {@link BASEHALF_NOTE_FILE_LINK_TITLE} as
 * its title. It works on tokens only: a renderer of an extension would lose
 * to the base renderer's own `link` and `image`.
 */
export function baseHalfNoteMarkedExtension(options: IBaseHalfNoteMarkedExtensionOptions = {}): MarkedExtension {
	const decode = options.decodeCharacterReferences ?? decodeBaseHalfSmallCharacterReferences;
	const resolve = options.resolveLink;
	const findFileParagraph = fileParagraphFinder(decode);
	return {
		walkTokens: token => {
			findFileParagraph(token)?.mark();
			walkNoteTokens(token);
			linkToAddressAsRead(token, decode);
			if (resolve) {
				resolveLinkAddresses(token, resolve, decode);
			}
		}
	};
}

/**
 * Each link of a token, Markdown or HTML, drawn with the address `resolve`
 * gives it.
 */
function resolveLinkAddresses(token: Token, resolve: (href: string) => string, decode: (text: string) => string): void {
	if (token.type === 'link') {
		const link = token as Tokens.Link;
		link.href = resolve(link.href);
	} else if (token.type === 'html' && /<a\s/i.test(token.raw)) {
		const html = token as Tokens.HTML;
		html.text = html.text.replace(/(<a\s[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi, (_, start: string, quote: string, href: string) =>
			`${start}${quote}${quoteAttribute(resolve(baseHalfMarkdownDestination(decode(href))))}${quote}`);
	}
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
	/** For showing: decodes character references once, as a page does. Default: every numeric reference and a few named ones. */
	readonly decodeCharacterReferences?: (text: string) => string;
}

/**
 * The HTML of a note's Markdown where the base Markdown renderer is not at
 * hand: with tables, strikethrough, and bare addresses, and a single line
 * break as a line break, as the card reads a note, and the note's extension
 * as the card has it. It is not sanitized: the
 * caller keeps only {@link BASEHALF_NOTE_HTML_TAGS} and
 * {@link BASEHALF_NOTE_HTML_ATTRIBUTES} of it before it reaches a document,
 * or reads it in a document that runs nothing.
 */
export function baseHalfNoteMarkdownToHtml(source: string, options: IBaseHalfNoteMarkdownToHtmlOptions = {}): string {
	if (!options.forReading && !options.definitions) {
		return new Marked(baseHalfNoteMarkedExtension({ decodeCharacterReferences: options.decodeCharacterReferences })).parse(source, { gfm: true, breaks: true, async: false });
	}
	// A lexer keeps its options object and adds its tokenizer to it, so each
	// lexer gets an object of its own.
	const lexer = new Lexer({ gfm: true, breaks: true });
	for (const [label, definition] of Object.entries(options.definitions ?? {})) {
		lexer.tokens.links[label] = { href: definition.href, title: definition.title ?? null };
	}
	const tokens = lexer.lex(source);
	const marked = options.forReading ? readingMarked : shownMarked;
	const decode = options.decodeCharacterReferences ?? decodeBaseHalfSmallCharacterReferences;
	marked.walkTokens(tokens, options.forReading ? walkNoteTokens : token => {
		walkNoteTokens(token);
		linkToAddressAsRead(token, decode);
	});
	return marked.parser(tokens);
}

/**
 * The paragraphs of a note's Markdown that Rich shows as file blocks (note
 * formats, rules 12 and 81), in the order of the note.
 */
export function baseHalfNoteFileLinks(markdown: string, decode: (text: string) => string = decodeBaseHalfSmallCharacterReferences): IBaseHalfNoteFileLink[] {
	const find = fileParagraphFinder(decode);
	const links: IBaseHalfNoteFileLink[] = [];
	shownMarked.walkTokens(new Lexer({ gfm: true, breaks: true }).lex(markdown), token => {
		const paragraph = find(token);
		if (paragraph) {
			links.push({ name: paragraph.name, href: paragraph.href });
		}
	});
	return links;
}
