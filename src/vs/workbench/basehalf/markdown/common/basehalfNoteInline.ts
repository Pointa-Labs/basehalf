/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Lexer, type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import {
	baseHalfMarkdownDestination,
	decodeBaseHalfSmallCharacterReferences,
	escapeBaseHalfHtmlAttribute,
	escapeBaseHalfHtmlText,
	escapeBaseHalfMarkdownText,
	IBaseHalfMarkdownTextContext
} from './basehalfNoteMarkdownText.js';
import { baseHalfNoteMediaKind } from './basehalfNoteMediaKind.js';
import { BaseHalfNotePaletteColor, baseHalfNoteSpanStyle, isBaseHalfNotePaletteColor, parseBaseHalfNoteSpanStyle } from './basehalfNotePalette.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports only its siblings, the Markdown
// parser, and, through the media kind, the one list of media files, none of
// which import anything else.
//
// The inline text of a block as a note stores it (note formats, rules 12 to
// 18). Rich's marks nest by their length; bold, italic, and strikethrough are
// written as Markdown where `marked`, the card's reader, reads them back so,
// and as tags where it would not; and each output is read with that reader
// before it is kept. The reading is shared with the guard of which blocks
// Rich edits (`basehalfNoteShown.ts`).

// --- Content as the rich editor holds it

/** The styles of a run of text, as the rich editor's block JSON holds them. */
export interface IBaseHalfNoteTextStyles {
	readonly bold?: boolean;
	readonly italic?: boolean;
	readonly underline?: boolean;
	readonly strike?: boolean;
	readonly code?: boolean;
	readonly textColor?: string;
	readonly backgroundColor?: string;
}

/** A run of text with its styles. A line break is `\n` in its text. */
export interface IBaseHalfNoteStyledText {
	readonly type: 'text';
	readonly text: string;
	readonly styles?: IBaseHalfNoteTextStyles;
}

export interface IBaseHalfNoteLink {
	readonly type: 'link';
	readonly href: string;
	readonly content: string | readonly IBaseHalfNoteStyledText[];
}

/** The inline content of a block: runs of text and links, or plain text. */
export type BaseHalfNoteInlineContent = string | readonly (IBaseHalfNoteStyledText | IBaseHalfNoteLink)[];

/**
 * Where inline content is written: the text of a paragraph, of a quote, or of
 * a list item, where a line break is a backslash at the end of the line; a
 * heading or a table cell, where it is `<br>`; or HTML, the title of a toggle
 * and a caption, where every format is a tag (note formats, rules 14 and 16).
 */
export type BaseHalfNoteInlinePlace = 'paragraph' | 'quote' | 'listItem' | 'heading' | 'tableCell' | 'html';

/** A definition of a reference link, as `marked` keeps it. */
export interface IBaseHalfNoteLinkDefinition {
	readonly href: string;
	readonly title?: string | null;
}

export interface IBaseHalfNoteInlineContext {
	/** Where the content is written. Default: a paragraph. */
	readonly place?: BaseHalfNoteInlinePlace;
	/**
	 * The labels of the note's reference definitions, as `marked` keys them:
	 * in lower case, each run of white space as one space. Text in brackets
	 * that would read as a reference to one of them is escaped.
	 */
	readonly referenceLabels?: ReadonlySet<string>;
	/** For reading: the note's reference definitions, by label. Default: a definition for each of `referenceLabels`. */
	readonly definitions?: Readonly<Record<string, IBaseHalfNoteLinkDefinition>>;
	/**
	 * For reading: decodes character references once, as a page does. The
	 * rich editor's webview passes the page's own decoding. Default: every
	 * numeric reference and the few named ones the writer writes, which is
	 * also how the writer reads back what it writes.
	 */
	readonly decodeCharacterReferences?: (text: string) => string;
	/**
	 * Called when no form of the content reads back as the content. The most
	 * escaped form is written then, and the caller logs it (note formats,
	 * "Failure and recovery").
	 */
	readonly onUnreadable?: (written: string) => void;
}

// --- What the card shows of inline content

/** The formats of one character as the card shows them. */
export interface IBaseHalfInlineMarks {
	readonly bold?: boolean;
	readonly italic?: boolean;
	readonly strike?: boolean;
	readonly underline?: boolean;
	readonly code?: boolean;
	readonly textColor?: BaseHalfNotePaletteColor;
	readonly backgroundColor?: BaseHalfNotePaletteColor;
	/** The address of the link, decoded once and written by the destination rule (rule 17), so that its spellings compare equal. */
	readonly link?: string;
	readonly linkTitle?: string;
}

/** A picture, a video, or a sound the card shows. */
export interface IBaseHalfInlineMedia {
	readonly kind: 'image' | 'video' | 'audio';
	/** The address, decoded once and written by the destination rule. */
	readonly src: string;
	/** A picture's name; an empty name is none. */
	readonly alt?: string;
	/** The width as written. */
	readonly width?: string;
	readonly title?: string;
	/** Whether a video or a sound shows its controls. */
	readonly controls?: boolean;
	/** Its other attributes as written, names in lower case, in the order of their names. */
	readonly attributes?: string;
}

/**
 * One character of inline content with its formats, or something the card
 * shows that is not text: an HTML element or comment that Rich has no form
 * for, kept as written, or a picture, a video, or a sound.
 */
export interface IBaseHalfInlineAtom {
	/** One character, or `\n` for a line break; empty for what is not text. */
	readonly text: string;
	readonly marks: IBaseHalfInlineMarks;
	/** An HTML tag, comment, or other markup that Rich cannot write, as written (tag names in lower case). */
	readonly other?: string;
	readonly media?: IBaseHalfInlineMedia;
}

interface IMarksKey {
	/** The formats in a fixed order: bold, italic, strikethrough, underline, and code as letters; the colors; the link and its title. */
	readonly fields: readonly (string | null)[];
	/** The fields as one text, to compare. */
	readonly key: string;
}

const keysOfMarks = new WeakMap<IBaseHalfInlineMarks, IMarksKey>();

function marksKey(marks: IBaseHalfInlineMarks): IMarksKey {
	let key = keysOfMarks.get(marks);
	if (key === undefined) {
		const flags = (marks.bold ? 'b' : '') + (marks.italic ? 'i' : '') + (marks.strike ? 's' : '') + (marks.underline ? 'u' : '') + (marks.code ? 'c' : '');
		const fields = [flags, marks.textColor ?? '', marks.backgroundColor ?? '', marks.link ?? null, marks.linkTitle ?? ''];
		key = { fields, key: JSON.stringify(fields) };
		keysOfMarks.set(marks, key);
	}
	return key;
}

/**
 * A key that is equal for two lists of atoms exactly when they show the same
 * characters with the same formats: each run of characters with the same
 * formats, and each atom that is no text on its own.
 */
export function baseHalfInlineAtomsKey(atoms: readonly IBaseHalfInlineAtom[]): string {
	const runs: (string | null)[][] = [];
	let textMarks: string | undefined;
	let lastMarks: IBaseHalfInlineMarks | undefined;
	let lastKey: IMarksKey | undefined;
	for (const atom of atoms) {
		// Atoms of a run share their marks.
		if (atom.marks !== lastMarks || !lastKey) {
			lastMarks = atom.marks;
			lastKey = marksKey(atom.marks);
		}
		if (atom.other === undefined && !atom.media) {
			if (lastKey.key === textMarks) {
				runs[runs.length - 1][0] += atom.text;
			} else {
				runs.push([atom.text, ...lastKey.fields]);
				textMarks = lastKey.key;
			}
			continue;
		}
		runs.push([atom.text, ...lastKey.fields, atom.other ?? '', atom.media ? baseHalfInlineMediaKey(atom.media) : '']);
		textMarks = undefined;
	}
	return JSON.stringify(runs);
}

/** A key that is equal for two pictures, videos, or sounds exactly when the card shows them the same and they keep the same attributes. */
export function baseHalfInlineMediaKey(media: IBaseHalfInlineMedia): string {
	return JSON.stringify([media.kind, media.src, media.alt ?? '', media.width ?? '', media.title ?? '', media.controls === true, media.attributes ?? '']);
}

/**
 * An address as a note compares it: decoded once, as a page reads an
 * attribute, and written by the destination rule, so that `my note.md`,
 * `<my note.md>`, and `my%20note.md` are the same address.
 */
export function baseHalfNoteAddress(href: string, decode: (text: string) => string = decodeBaseHalfSmallCharacterReferences): string {
	return baseHalfMarkdownDestination(decode(href));
}

// --- HTML as a note holds it

/** One tag of HTML. */
export interface IBaseHalfHtmlTag {
	readonly kind: 'start' | 'end';
	/** In lower case. */
	readonly name: string;
	/** Names in lower case; a value as written, without its quotes and not decoded; `undefined` for an attribute without a value. */
	readonly attributes: readonly (readonly [string, string | undefined])[];
	readonly selfClosing: boolean;
	readonly raw: string;
}

/** A piece of HTML: text as written (not decoded), a tag, or a comment, a declaration, a processing instruction, or CDATA. */
export type BaseHalfHtmlPiece =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'tag'; readonly tag: IBaseHalfHtmlTag }
	| { readonly kind: 'other'; readonly raw: string };

// Attribute names as `marked` reads them, so that a tag never runs on into
// the next one. Markup that is never closed runs to the end, as in a page.
const startTagAhead = /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[A-Za-z:_][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const endTagAhead = /<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/y;
const otherMarkupAhead = /<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?(?:\?>|$)|<![A-Za-z][^>]*(?:>|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/y;
const attributePattern = /\s+([A-Za-z:_][\w.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function htmlPieceAt(html: string, index: number): { readonly piece: BaseHalfHtmlPiece; readonly length: number } | undefined {
	startTagAhead.lastIndex = index;
	const start = startTagAhead.exec(html);
	if (start) {
		const attributes: [string, string | undefined][] = [];
		for (const attribute of start[2].matchAll(attributePattern)) {
			attributes.push([attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4]]);
		}
		const tag: IBaseHalfHtmlTag = { kind: 'start', name: start[1].toLowerCase(), attributes, selfClosing: start[3] === '/', raw: start[0] };
		return { piece: { kind: 'tag', tag }, length: start[0].length };
	}
	endTagAhead.lastIndex = index;
	const end = endTagAhead.exec(html);
	if (end) {
		const tag: IBaseHalfHtmlTag = { kind: 'end', name: end[1].toLowerCase(), attributes: [], selfClosing: false, raw: end[0] };
		return { piece: { kind: 'tag', tag }, length: end[0].length };
	}
	otherMarkupAhead.lastIndex = index;
	const other = otherMarkupAhead.exec(html);
	return other ? { piece: { kind: 'other', raw: other[0] }, length: other[0].length } : undefined;
}

/** Splits HTML into text, tags, and other markup. A `<` that starts none of them is text. */
export function splitBaseHalfHtml(html: string): BaseHalfHtmlPiece[] {
	const pieces: BaseHalfHtmlPiece[] = [];
	let text = '';
	let index = 0;
	while (index < html.length) {
		const open = html.indexOf('<', index);
		if (open === -1) {
			text += html.slice(index);
			break;
		}
		text += html.slice(index, open);
		const found = htmlPieceAt(html, open);
		if (!found) {
			text += '<';
			index = open + 1;
			continue;
		}
		if (text) {
			pieces.push({ kind: 'text', text });
			text = '';
		}
		pieces.push(found.piece);
		index = open + found.length;
	}
	if (text) {
		pieces.push({ kind: 'text', text });
	}
	return pieces;
}

/** The tag that `raw` is as a whole, or `undefined` for a comment or other markup. */
export function parseBaseHalfHtmlTag(raw: string): IBaseHalfHtmlTag | undefined {
	const found = htmlPieceAt(raw, 0);
	return found?.piece.kind === 'tag' && found.length === raw.length ? found.piece.tag : undefined;
}

// --- Reading inline content as the card shows it

// The tags that are a mark on characters when they carry no attribute.
const markOfTag: ReadonlyMap<string, keyof IBaseHalfInlineMarks> = new Map([
	['b', 'bold'], ['strong', 'bold'], ['i', 'italic'], ['em', 'italic'], ['s', 'strike'], ['del', 'strike'], ['strike', 'strike'], ['u', 'underline'], ['code', 'code']
]);

interface IOpenHtmlTag {
	readonly name: string;
	readonly marks?: IBaseHalfInlineMarks;
	/** A tag Rich cannot write: its end tag is kept as written too. */
	readonly other: boolean;
}

/**
 * Builds the atoms of inline content from what `marked` reads and from HTML,
 * as the card shows them. A tag of a mark adds the mark to the characters up
 * to its end tag; any other tag, comment, or markup, and an end tag that
 * closes nothing, stays as written in an atom of its own, and so does a tag
 * of a mark that is still open at the end. A tag that crosses the edge of an
 * element that Markdown writes, such as an `<em>` of `*` that closes between
 * a `<span>` and its end tag, stays as written too: a page builds other
 * elements of it than the marks it names, and moves text out of a span.
 */
export class BaseHalfInlineAtomReader {

	private readonly atoms: IBaseHalfInlineAtom[] = [];
	private readonly openTags: IOpenHtmlTag[] = [];
	private readonly decode: (text: string) => string;
	/** How many tags were open where the element of Markdown being read opened: its tags are those above. */
	private floor = 0;

	constructor(decode: (text: string) => string = decodeBaseHalfSmallCharacterReferences) {
		this.decode = decode;
	}

	/** Reads inline tokens of `marked`, inside the marks of the Markdown around them. */
	readTokens(tokens: readonly Token[], marks: IBaseHalfInlineMarks = {}): void {
		for (const token of tokens) {
			this.readToken(token, marks);
		}
	}

	/** Reads what an element of Markdown holds; a tag opened in it and still open at its end crosses its edge. */
	private readElement(tokens: readonly Token[], marks: IBaseHalfInlineMarks): void {
		const floor = this.floor;
		this.floor = this.openTags.length;
		this.readTokens(tokens, marks);
		for (const open of this.openTags.splice(this.floor)) {
			this.pushOther(`<${open.name}> across a format`, marks);
		}
		this.floor = floor;
	}

	private readToken(token: Token, marks: IBaseHalfInlineMarks): void {
		switch (token.type) {
			case 'text': {
				// A list item's text holds its inline tokens in a text token.
				const nested = (token as Tokens.Text).tokens;
				if (nested && nested.length > 0) {
					this.readTokens(nested, marks);
				} else {
					this.pushText(this.decode((token as Tokens.Text).text), marks);
				}
				return;
			}
			case 'escape':
				this.pushText(this.decode((token as Tokens.Escape).text), marks);
				return;
			case 'strong':
				this.readElement((token as Tokens.Strong).tokens, { ...marks, bold: true });
				return;
			case 'em':
				this.readElement((token as Tokens.Em).tokens, { ...marks, italic: true });
				return;
			case 'del':
				this.readElement((token as Tokens.Del).tokens, { ...marks, strike: true });
				return;
			case 'codespan':
				this.pushText(this.decode((token as Tokens.Codespan).text), { ...marks, code: true });
				return;
			case 'br':
				this.pushLineBreak(marks);
				return;
			case 'link': {
				const link = token as Tokens.Link;
				const title = link.title ? this.decode(link.title) : undefined;
				this.readElement(link.tokens, { ...marks, link: baseHalfNoteAddress(link.href, this.decode), ...(title ? { linkTitle: title } : {}) });
				return;
			}
			case 'image': {
				const media = this.markdownImage(token as Tokens.Image);
				if (media) {
					this.pushMedia(media, marks);
					return;
				}
				break;
			}
			case 'html':
				this.readHtml(token.raw, marks);
				return;
			case 'checkbox':
				// A check item's box, which the item holds as its state.
				return;
		}
		this.pushOther(token.raw, marks);
	}

	/**
	 * A Markdown picture; the note shows one whose address is a video or a
	 * sound as that video or sound, with its controls. The card shows a
	 * picture whose address holds `|` at the address before it, with the
	 * width or height written after it, which Rich cannot write: none, and
	 * the picture stays as written.
	 */
	private markdownImage(image: Tokens.Image): IBaseHalfInlineMedia | undefined {
		const src = baseHalfNoteAddress(image.href, this.decode);
		const title = image.title ? this.decode(image.title) : undefined;
		const kind = baseHalfNoteMediaKind(this.decode(image.href));
		if (kind === 'video' || kind === 'audio') {
			return { kind, src, controls: true, ...(title ? { title } : {}) };
		}
		if (image.href.includes('|')) {
			return undefined;
		}
		const alt = this.decode(image.text);
		return { kind: 'image', src, ...(alt ? { alt } : {}), ...(title ? { title } : {}) };
	}

	/**
	 * Reads HTML text, as a toggle's title or a caption holds it, or one tag
	 * of inline HTML that `marked` read. A line ending in HTML text is white
	 * space; a line break is `<br>`.
	 */
	readHtml(html: string, marks: IBaseHalfInlineMarks = {}): void {
		for (const piece of splitBaseHalfHtml(html)) {
			if (piece.kind === 'text') {
				this.pushText(this.decode(piece.text.replace(/\r\n?|\n/g, ' ')), marks);
			} else if (piece.kind === 'tag') {
				this.readTag(piece.tag, marks);
			} else {
				this.pushOther(piece.raw, marks);
			}
		}
	}

	/** Reads one tag of inline HTML. */
	readTag(tag: IBaseHalfHtmlTag, marks: IBaseHalfInlineMarks = {}): void {
		if (tag.kind === 'end') {
			this.closeTag(tag, marks);
			return;
		}
		const { name, attributes } = tag;
		if (name === 'br' && attributes.length === 0) {
			this.pushLineBreak(marks);
			return;
		}
		if (name === 'img' || name === 'video' || name === 'audio') {
			this.pushMedia(this.htmlMedia(tag), marks);
			if (name !== 'img' && !tag.selfClosing) {
				// What a video or a sound holds shows only where it cannot play.
				this.openTags.push({ name, other: false });
			}
			return;
		}
		const tagMarks = tag.selfClosing ? undefined : this.marksOfTag(tag);
		if (tagMarks) {
			this.openTags.push({ name, marks: tagMarks, other: false });
			return;
		}
		if (!tag.selfClosing && (markOfTag.has(name) || name === 'a' || name === 'span')) {
			this.openTags.push({ name, other: true });
		}
		this.pushOther(tagText(tag), marks);
	}

	private marksOfTag(tag: IBaseHalfHtmlTag): IBaseHalfInlineMarks | undefined {
		const { name, attributes } = tag;
		const mark = markOfTag.get(name);
		if (mark) {
			return attributes.length === 0 ? { [mark]: true } : undefined;
		}
		if (name === 'a' && attributes.length === 1 && attributes[0][0] === 'href') {
			return { link: baseHalfNoteAddress(attributes[0][1] ?? '', this.decode) };
		}
		if (name === 'span' && attributes.length === 1 && attributes[0][0] === 'style') {
			const colors = parseBaseHalfNoteSpanStyle(this.decode(attributes[0][1] ?? ''));
			return colors ? { ...colors } : undefined;
		}
		return undefined;
	}

	private closeTag(tag: IBaseHalfHtmlTag, marks: IBaseHalfInlineMarks): void {
		for (let index = this.openTags.length - 1; index >= 0; index--) {
			const open = this.openTags[index];
			if (open.name === tag.name) {
				this.openTags.splice(index, 1);
				if (open.other || index < this.floor) {
					// A tag that Rich cannot write, or one opened outside the element of Markdown it closes in.
					this.pushOther(index < this.floor ? `${tagText(tag)} across a format` : tagText(tag), marks);
					if (index < this.floor) {
						this.floor--;
					}
				}
				return;
			}
		}
		// An end tag that closes nothing.
		this.pushOther(tagText(tag), marks);
	}

	private htmlMedia(tag: IBaseHalfHtmlTag): IBaseHalfInlineMedia {
		const kind = tag.name === 'img' ? 'image' : tag.name === 'video' ? 'video' : 'audio';
		let src = '';
		let alt: string | undefined;
		let width: string | undefined;
		let title: string | undefined;
		let controls = false;
		const others: string[] = [];
		for (const [name, value] of tag.attributes) {
			const decoded = this.decode(value ?? '');
			if (name === 'src') {
				src = baseHalfNoteAddress(value ?? '', this.decode);
			} else if (name === 'alt' && kind === 'image') {
				alt = decoded || undefined;
			} else if (name === 'width' && kind !== 'audio') {
				width = decoded;
			} else if (name === 'title') {
				title = decoded;
			} else if (name === 'controls' && kind !== 'image') {
				controls = true;
			} else {
				others.push(value === undefined ? name : `${name}=${JSON.stringify(value)}`);
			}
		}
		return {
			kind,
			src,
			...(alt !== undefined ? { alt } : {}),
			...(width !== undefined ? { width } : {}),
			...(title !== undefined ? { title } : {}),
			...(controls ? { controls } : {}),
			...(others.length > 0 ? { attributes: others.sort().join(' ') } : {})
		};
	}

	/** The marks of the Markdown around a character, with the marks of the tags still open. */
	private marksWithTags(marks: IBaseHalfInlineMarks): IBaseHalfInlineMarks {
		let merged = marks;
		for (const open of this.openTags) {
			if (open.marks) {
				merged = { ...merged, ...open.marks };
			}
		}
		return merged;
	}

	/** Adds decoded text, one atom per character. */
	pushText(text: string, marks: IBaseHalfInlineMarks): void {
		const merged = this.marksWithTags(marks);
		for (const character of text) {
			this.atoms.push({ text: character, marks: merged });
		}
	}

	pushLineBreak(marks: IBaseHalfInlineMarks): void {
		this.atoms.push({ text: '\n', marks: this.marksWithTags(marks) });
	}

	pushOther(raw: string, marks: IBaseHalfInlineMarks): void {
		this.atoms.push({ text: '', marks: this.marksWithTags(marks), other: raw });
	}

	pushMedia(media: IBaseHalfInlineMedia, marks: IBaseHalfInlineMarks): void {
		this.atoms.push({ text: '', marks: this.marksWithTags(marks), media });
	}

	/** The atoms read. A tag that is still open stays as written. */
	finish(): IBaseHalfInlineAtom[] {
		for (const open of this.openTags.splice(0)) {
			this.atoms.push({ text: '', marks: {}, other: `<${open.name}> not closed` });
		}
		return this.atoms;
	}
}

/** A tag as written, with its name in lower case. */
function tagText(tag: IBaseHalfHtmlTag): string {
	const prefix = tag.kind === 'end' ? '</' : '<';
	return prefix + tag.name + tag.raw.slice(prefix.length + tag.name.length);
}

/**
 * A lexer that reads Markdown as the card reads a note: with tables,
 * strikethrough, and bare addresses, every single line break a break, and the
 * note's reference definitions. A lexer keeps its options object and adds
 * its tokenizer to it, so each lexer gets an object of its own.
 */
export function baseHalfCardLexer(definitions?: Readonly<Record<string, IBaseHalfNoteLinkDefinition>>): Lexer {
	const lexer = new Lexer({ gfm: true, breaks: true });
	if (definitions) {
		for (const [label, definition] of Object.entries(definitions)) {
			lexer.tokens.links[label] = { href: definition.href, title: definition.title ?? null };
		}
	}
	return lexer;
}

/** The blocks `marked` reads of `markdown`, without the white space between them. */
export function baseHalfMarkdownBlocks(markdown: string, definitions?: Readonly<Record<string, IBaseHalfNoteLinkDefinition>>): Token[] {
	return baseHalfCardLexer(definitions).lex(markdown).filter(token => token.type !== 'space');
}

const definitionsOfLabels = new WeakMap<ReadonlySet<string>, Readonly<Record<string, IBaseHalfNoteLinkDefinition>>>();

function definitionsOf(context: IBaseHalfNoteInlineContext): Readonly<Record<string, IBaseHalfNoteLinkDefinition>> | undefined {
	if (context.definitions) {
		return context.definitions;
	}
	const labels = context.referenceLabels;
	if (!labels || labels.size === 0) {
		return undefined;
	}
	let definitions = definitionsOfLabels.get(labels);
	if (!definitions) {
		definitions = Object.fromEntries([...labels].map(label => [label, { href: '' }]));
		definitionsOfLabels.set(labels, definitions);
	}
	return definitions;
}

const cellBoundary = /(?:^|[^\\])(?:\\\\)*\|/;

/** The inline tokens of `markdown` written in `place`, or `undefined` when it does not read as one such place. */
function inlineTokensOf(markdown: string, place: Exclude<BaseHalfNoteInlinePlace, 'html'>, context: IBaseHalfNoteInlineContext): readonly Token[] | undefined {
	const definitions = definitionsOf(context);
	switch (place) {
		case 'heading': {
			const blocks = baseHalfMarkdownBlocks(`# ${markdown}`, definitions);
			return blocks.length === 1 && blocks[0].type === 'heading' ? (blocks[0] as Tokens.Heading).tokens : undefined;
		}
		case 'tableCell': {
			// A pipe after an even number of backslashes ends the cell, and the reader drops cells past the header's.
			if (cellBoundary.test(markdown)) {
				return undefined;
			}
			const blocks = baseHalfMarkdownBlocks(`| h |\n| --- |\n| ${markdown} |`, definitions);
			const table = blocks[0] as Tokens.Table | undefined;
			return blocks.length === 1 && table?.type === 'table' && table.header.length === 1 && table.rows.length === 1 && table.rows[0].length === 1 ? table.rows[0][0].tokens : undefined;
		}
		case 'quote': {
			const blocks = baseHalfMarkdownBlocks(markdown.split('\n').map(line => `> ${line}`).join('\n'), definitions);
			const quote = blocks[0] as Tokens.Blockquote | undefined;
			return blocks.length === 1 && quote?.type === 'blockquote' ? onlyParagraph(quote.tokens.filter(token => token.type !== 'space')) : undefined;
		}
		case 'listItem': {
			const blocks = baseHalfMarkdownBlocks(`- ${markdown.split('\n').join('\n  ')}`, definitions);
			const list = blocks[0] as Tokens.List | undefined;
			const item = list?.type === 'list' && list.items.length === 1 && !list.items[0].task ? list.items[0] : undefined;
			return blocks.length === 1 && item ? onlyParagraph(item.tokens.filter(token => token.type !== 'space')) : undefined;
		}
		default:
			return onlyParagraph(baseHalfMarkdownBlocks(markdown, definitions));
	}
}

/** The inline tokens of blocks that are one paragraph or none. */
function onlyParagraph(blocks: readonly Token[]): readonly Token[] | undefined {
	if (blocks.length === 0) {
		return [];
	}
	const block = blocks[0];
	return blocks.length === 1 && (block.type === 'paragraph' || block.type === 'text') ? (block as Tokens.Paragraph).tokens ?? [] : undefined;
}

/**
 * What the card shows of `markdown` written as the inline content of
 * `context.place`: its characters with their formats, a line break as `\n`,
 * and anything else the card shows as an atom of its own. `undefined` when
 * the text does not read as one block of that place, such as a paragraph
 * that reads as a heading, or as two paragraphs.
 */
export function baseHalfMarkdownInlineAtoms(markdown: string, context: IBaseHalfNoteInlineContext = {}): IBaseHalfInlineAtom[] | undefined {
	const place = context.place ?? 'paragraph';
	if (markdown === '') {
		return [];
	}
	const reader = new BaseHalfInlineAtomReader(context.decodeCharacterReferences);
	if (place === 'html') {
		reader.readHtml(markdown);
	} else {
		const tokens = inlineTokensOf(markdown, place, context);
		if (!tokens) {
			return undefined;
		}
		reader.readTokens(tokens);
	}
	return normalizeBaseHalfInlineLineBreaks(reader.finish());
}

/**
 * A line break carries no format but the link it stands in (note formats,
 * design 3.2.1): the breaks of a run keep the link when the characters
 * before and after the run are in it.
 */
function forEachLineBreakRun<T extends { readonly text: string }>(atoms: readonly T[], visit: (from: number, to: number) => void): void {
	let index = 0;
	while (index < atoms.length) {
		if (atoms[index].text !== '\n') {
			index++;
			continue;
		}
		let end = index;
		while (end < atoms.length && atoms[end].text === '\n') {
			end++;
		}
		visit(index, end);
		index = end;
	}
}

/** Gives each line break of atoms the formats a line break shows: none, but the link it stands in. */
export function normalizeBaseHalfInlineLineBreaks(atoms: IBaseHalfInlineAtom[]): IBaseHalfInlineAtom[] {
	forEachLineBreakRun(atoms, (from, to) => {
		const link = atoms[from].marks.link;
		const inLink = link !== undefined && atoms[from - 1]?.marks.link === link && atoms[to]?.marks.link === link;
		for (let index = from; index < to; index++) {
			const { marks } = atoms[index];
			atoms[index] = { text: '\n', marks: inLink && marks.link === link ? { link, ...(marks.linkTitle !== undefined ? { linkTitle: marks.linkTitle } : {}) } : {} };
		}
	});
	return atoms;
}

// --- The model: what a note can store of inline content (design 3.2.1)

interface IModelMarks {
	/** The link the character is in: its node, and its address written by the destination rule. */
	link?: { readonly id: number; readonly href: string };
	textColor?: BaseHalfNotePaletteColor;
	backgroundColor?: BaseHalfNotePaletteColor;
	underline?: boolean;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	code?: boolean;
}

interface IModelAtom {
	readonly text: string;
	readonly marks: IModelMarks;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null;
}

const styleMarks = [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strike'], ['code', 'code']] as const;

function modelMarks(styles: unknown): IModelMarks {
	const marks: IModelMarks = {};
	if (!isRecord(styles)) {
		return marks;
	}
	for (const [style, mark] of styleMarks) {
		if (styles[style] === true) {
			marks[mark] = true;
		}
	}
	// A color outside the palette, the editor's default among them, is none.
	if (isBaseHalfNotePaletteColor(styles.textColor)) {
		marks.textColor = styles.textColor;
	}
	if (isBaseHalfNotePaletteColor(styles.backgroundColor)) {
		marks.backgroundColor = styles.backgroundColor;
	}
	return marks;
}

// White space that Markdown does not keep: a line's leading spaces, tabs,
// and form feeds, which do not show and four spaces of which would make
// code, and at the edges of a block what its reader trims. A heading and a
// cell lose all white space at both ends, and a list item at its end, but
// the characters the writer writes as references. The rich editor's reader
// also drops the white space that ends a cell, in code too, and a block's
// text of such white space alone, in code too.
const leadingSpace = /^[ \t\f]$/;
const trimmedByMarked = /^[\t\v\f \u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}\u{feff}]$/u;
const collapsedInHtml = /^[ \t\f]$/;
const edgeSpaceOfPlace: Readonly<Record<BaseHalfNoteInlinePlace, { readonly start: RegExp; readonly end: RegExp; readonly endOfCode?: RegExp }>> = {
	paragraph: { start: leadingSpace, end: leadingSpace },
	quote: { start: leadingSpace, end: leadingSpace },
	listItem: { start: leadingSpace, end: trimmedByMarked },
	heading: { start: trimmedByMarked, end: trimmedByMarked },
	tableCell: { start: trimmedByMarked, end: trimmedByMarked, endOfCode: collapsedInHtml },
	html: { start: collapsedInHtml, end: collapsedInHtml }
};
const whiteSpace = /^\s$/u;

function modelOf(content: BaseHalfNoteInlineContent | undefined, place: BaseHalfNoteInlinePlace): IModelAtom[] {
	const atoms: IModelAtom[] = [];
	let links = 0;
	const push = (run: unknown, link: IModelMarks['link']) => {
		const text = typeof run === 'string' ? run : isRecord(run) && typeof run.text === 'string' ? run.text : '';
		const marks = modelMarks(isRecord(run) ? run.styles : undefined);
		if (link) {
			marks.link = link;
		}
		// The atoms of a run share their marks; normalizing copies the marks it
		// changes. A carriage return shows as a space, on the card and in the
		// rich editor, and is one.
		for (const character of text) {
			atoms.push({ text: character === '\r' ? ' ' : character, marks });
		}
	};
	const items: readonly unknown[] = typeof content === 'string' ? [content] : Array.isArray(content) ? content : [];
	for (const item of items) {
		if (isRecord(item) && item.type === 'link') {
			const link = { id: ++links, href: baseHalfMarkdownDestination(typeof item.href === 'string' ? item.href : '') };
			const runs: readonly unknown[] = typeof item.content === 'string' ? [item.content] : Array.isArray(item.content) ? item.content : [];
			for (const run of runs) {
				push(run, link);
			}
		} else if (typeof item === 'string' || (isRecord(item) && typeof item.text === 'string')) {
			push(item, undefined);
		} else if (isRecord(item) && typeof item.content === 'string') {
			// Inline content of another kind keeps its text.
			push(item.content, undefined);
		}
	}
	return normalizeModel(atoms, place);
}

function normalizeModel(atoms: readonly IModelAtom[], place: BaseHalfNoteInlinePlace): IModelAtom[] {
	const kept: IModelAtom[] = [];
	let lineStart = true;
	for (const atom of atoms) {
		if (atom.text === '\n') {
			lineStart = true;
		} else if (lineStart && !atom.marks.code && leadingSpace.test(atom.text)) {
			continue;
		} else {
			lineStart = false;
		}
		kept.push(atom);
	}
	const edgeSpace = edgeSpaceOfPlace[place];
	const trimmed = (atom: IModelAtom, space: RegExp, spaceOfCode?: RegExp) => atom.text === '\n' || (atom.marks.code ? !!spaceOfCode?.test(atom.text) : space.test(atom.text));
	let start = 0;
	let end = kept.length;
	while (start < end && trimmed(kept[start], edgeSpace.start)) {
		start++;
	}
	while (end > start && trimmed(kept[end - 1], edgeSpace.end, edgeSpace.endOfCode)) {
		end--;
	}
	if (place !== 'html' && kept.slice(start, end).every(atom => collapsedInHtml.test(atom.text))) {
		// Text of white space alone, as in code of spaces alone, is no text to the rich editor's reader.
		return [];
	}
	const model = kept.slice(start, end);
	// A line break carries no format but the link it stands in.
	forEachLineBreakRun(model, (from, to) => {
		const link = model[from].marks.link;
		const inLink = link !== undefined && model[from - 1]?.marks.link === link && model[to]?.marks.link === link;
		for (let index = from; index < to; index++) {
			model[index] = { text: '\n', marks: inLink && model[index].marks.link === link ? { link } : {} };
		}
	});
	// White space at the edges of bold, italic, and strikethrough stands outside them (rule 13).
	for (const mark of ['bold', 'italic', 'strike'] as const) {
		let index = 0;
		while (index < model.length) {
			if (!model[index].marks[mark]) {
				index++;
				continue;
			}
			let runEnd = index;
			while (runEnd < model.length && model[runEnd].marks[mark]) {
				runEnd++;
			}
			const outside = (at: number) => {
				const marks = { ...model[at].marks };
				delete marks[mark];
				model[at] = { text: model[at].text, marks };
			};
			let first = index;
			while (first < runEnd && whiteSpace.test(model[first].text)) {
				outside(first++);
			}
			let last = runEnd - 1;
			while (last >= first && whiteSpace.test(model[last].text)) {
				outside(last--);
			}
			index = runEnd;
		}
	}
	return model;
}

function publicMarks(marks: IModelMarks): IBaseHalfInlineMarks {
	return {
		...(marks.bold ? { bold: true } : {}),
		...(marks.italic ? { italic: true } : {}),
		...(marks.strike ? { strike: true } : {}),
		...(marks.underline ? { underline: true } : {}),
		...(marks.code ? { code: true } : {}),
		...(marks.textColor ? { textColor: marks.textColor } : {}),
		...(marks.backgroundColor ? { backgroundColor: marks.backgroundColor } : {}),
		...(marks.link ? { link: marks.link.href } : {})
	};
}

/** The model as atoms, each distinct marks object copied once. */
function publicAtoms(model: readonly IModelAtom[]): IBaseHalfInlineAtom[] {
	const copies = new Map<IModelMarks, IBaseHalfInlineMarks>();
	return model.map(atom => {
		let marks = copies.get(atom.marks);
		if (!marks) {
			marks = publicMarks(atom.marks);
			copies.set(atom.marks, marks);
		}
		return { text: atom.text, marks };
	});
}

/**
 * What a note stores of inline content written in `context.place`: its
 * characters with their formats, without what Markdown cannot hold (white
 * space at the start of a line and at the edges of the block, line breaks at
 * its edges, formats on a line break), a carriage return as the space it
 * shows, and with the white space at the edges of bold, italic, and
 * strikethrough outside them. What the writer writes reads back as exactly
 * this.
 */
export function baseHalfNoteInlineModel(content: BaseHalfNoteInlineContent | undefined, context: IBaseHalfNoteInlineContext = {}): IBaseHalfInlineAtom[] {
	return publicAtoms(modelOf(content, context.place ?? 'paragraph'));
}

// --- Nesting (design 3.2.2, steps 1 to 3)

// Marks nest by their length, and marks of equal length in this order (rule 13).
const nestingOrder = ['link', 'span', 'underline', 'bold', 'italic', 'strike', 'code'] as const;
type NestingKey = typeof nestingOrder[number];

interface IOpenToken {
	readonly kind: 'open';
	readonly key: NestingKey;
	/** Shared with the token that closes it. */
	readonly id: number;
	/** The atom it opens at. */
	readonly at: number;
}

interface ICloseToken {
	readonly kind: 'close';
	readonly key: NestingKey;
	readonly id: number;
	/** The atom after the last one it holds. */
	readonly at: number;
}

interface ITextToken {
	readonly kind: 'text';
	readonly from: number;
	to: number;
}

type NestingToken = IOpenToken | ICloseToken | ITextToken;

/**
 * The value of a mark at an atom, for nesting: a link by its node, a span by
 * its pair of colors. In pieces, bold, italic, and strikethrough also end
 * wherever the underline, the colors, or the link change.
 */
function nestingValue(marks: IModelMarks, key: NestingKey, pieces: boolean): string | undefined {
	switch (key) {
		case 'link':
			return marks.link ? String(marks.link.id) : undefined;
		case 'span':
			return marks.textColor || marks.backgroundColor ? `${marks.textColor ?? ''}|${marks.backgroundColor ?? ''}` : undefined;
		case 'underline':
		case 'code':
			return marks[key] ? '' : undefined;
		default:
			if (!marks[key]) {
				return undefined;
			}
			return pieces ? `${marks.underline ? 'u' : ''}|${marks.textColor ?? ''}|${marks.backgroundColor ?? ''}|${marks.link?.id ?? ''}` : '';
	}
}

/**
 * Opens and closes the marks around the text (design 3.2.2, steps 1 and 2):
 * at each character, the marks still to open open so that the one that lasts
 * longer is outside, ties in the order of `nestingOrder`; a mark that is open
 * stays open while it goes on; a mark that ends inside a link that starts
 * closes before the link and opens again inside it, and a mark opened inside
 * a link closes at its end. Code holds no other mark, so it is always inside.
 */
function nestingTokens(model: readonly IModelAtom[], pieces: boolean): NestingToken[] {
	const values = nestingOrder.map(key => model.map(atom => nestingValue(atom.marks, key, pieces)));
	// Where the run of the value a mark has at an atom ends.
	const ends = values.map(column => {
		const end = new Array<number>(column.length);
		for (let index = column.length - 1; index >= 0; index--) {
			end[index] = index + 1 < column.length && column[index] !== undefined && column[index + 1] === column[index] ? end[index + 1] : index + 1;
		}
		return end;
	});
	const linkColumn = nestingOrder.indexOf('link');
	const codeColumn = nestingOrder.indexOf('code');
	const tokens: NestingToken[] = [];
	const stack: { readonly column: number; readonly value: string; readonly id: number; readonly end: number }[] = [];
	const kept = new Array<boolean>(nestingOrder.length);
	let ids = 0;
	const closeTo = (depth: number, at: number) => {
		while (stack.length > depth) {
			const top = stack.pop()!;
			tokens.push({ kind: 'close', key: nestingOrder[top.column], id: top.id, at });
		}
	};
	for (let at = 0; at < model.length; at++) {
		// An atom with the marks of the one before it only lengthens the text.
		if (at > 0 && values.every(column => column[at] === column[at - 1])) {
			(tokens[tokens.length - 1] as ITextToken).to = at + 1;
			continue;
		}
		let keep = 0;
		while (keep < stack.length && values[stack[keep].column][at] === stack[keep].value) {
			keep++;
		}
		const link = values[linkColumn][at];
		if (link !== undefined && (at === 0 || values[linkColumn][at - 1] !== link)) {
			const linkEnd = ends[linkColumn][at];
			let outside = 0;
			while (outside < keep && stack[outside].end >= linkEnd) {
				outside++;
			}
			keep = outside;
		}
		const wanted: number[] = [];
		values.forEach((column, index) => {
			if (column[at] !== undefined) {
				wanted.push(index);
			}
		});
		kept.fill(false);
		for (let depth = 0; depth < keep; depth++) {
			kept[stack[depth].column] = true;
		}
		if (keep > 0 && stack[keep - 1].column === codeColumn && wanted.some(column => column !== codeColumn && !kept[column])) {
			kept[codeColumn] = false;
			keep--;
		}
		closeTo(keep, at);
		const opening = wanted.filter(column => !kept[column]);
		opening.sort((a, b) => a === codeColumn ? 1 : b === codeColumn ? -1 : (ends[b][at] - ends[a][at]) || (a - b));
		for (const column of opening) {
			const id = ++ids;
			stack.push({ column, value: values[column][at]!, id, end: ends[column][at] });
			tokens.push({ kind: 'open', key: nestingOrder[column], id, at });
		}
		const last = tokens[tokens.length - 1];
		if (last?.kind === 'text') {
			last.to = at + 1;
		} else {
			tokens.push({ kind: 'text', from: at, to: at + 1 });
		}
	}
	closeTo(0, model.length);
	return tokens;
}

// --- Spelling (design 3.2.2, step 4)

/**
 * A form to write content in. They are tried in this order (design 3.2.2,
 * step 7): bold, italic, and strikethrough as Markdown delimiters where they
 * read back; the same, closed and opened again wherever the underline, the
 * colors, or the link change; every one of them as a tag; and that with
 * every Markdown character of the text escaped and code as `<code>`.
 */
interface IForm {
	readonly pieces: boolean;
	readonly delimiters: boolean;
	readonly escapeAll: boolean;
}

const markdownForms: readonly IForm[] = [
	{ pieces: false, delimiters: true, escapeAll: false },
	{ pieces: true, delimiters: true, escapeAll: false },
	{ pieces: false, delimiters: false, escapeAll: false },
	{ pieces: false, delimiters: false, escapeAll: true }
];
const htmlForms: readonly IForm[] = [{ pieces: false, delimiters: false, escapeAll: false }];

type DelimiterKey = 'bold' | 'italic' | 'strike';

function isDelimiterKey(key: NestingKey): key is DelimiterKey {
	return key === 'bold' || key === 'italic' || key === 'strike';
}

const delimiterOf: Readonly<Record<DelimiterKey, string>> = { bold: '**', italic: '*', strike: '~~' };
const tagOf: Readonly<Record<DelimiterKey | 'underline', string>> = { underline: 'u', bold: 'strong', italic: 'em', strike: 'del' };

const punctuationOrSymbol = /^[\p{P}\p{S}]$/u;
const isWhiteSpaceOrEdge = (character: string | undefined) => character === undefined || whiteSpace.test(character);
const isPunctuation = (character: string | undefined) => character !== undefined && punctuationOrSymbol.test(character);
// Where a delimiter run may open and close, as CommonMark judges it.
const leftFlanking = (before: string | undefined, after: string | undefined) => !isWhiteSpaceOrEdge(after) && (!isPunctuation(after) || isWhiteSpaceOrEdge(before) || isPunctuation(before));
const rightFlanking = (before: string | undefined, after: string | undefined) => !isWhiteSpaceOrEdge(before) && (!isPunctuation(before) || isWhiteSpaceOrEdge(after) || isPunctuation(after));

interface IWriting {
	readonly model: readonly IModelAtom[];
	readonly tokens: readonly NestingToken[];
	readonly place: BaseHalfNoteInlinePlace;
	readonly form: IForm;
	readonly referenceLabels: ReadonlySet<string> | undefined;
	/** The links written as their bare address, by node. */
	readonly bare: ReadonlySet<number>;
	/** Whether a bold, italic, or strikethrough is written with Markdown delimiters, by the id of its tokens. */
	readonly delimited: Map<number, boolean>;
}

function atomsText(model: readonly IModelAtom[], from: number, to: number): string {
	let text = '';
	for (let index = from; index < to; index++) {
		text += model[index].text;
	}
	return text;
}

function linkOfToken(writing: IWriting, token: IOpenToken | ICloseToken): IModelMarks['link'] {
	return writing.model[token.kind === 'open' ? token.at : token.at - 1]?.marks.link;
}

/**
 * Writes bold, italic, and strikethrough as `**`, `*`, and `~~` only where
 * the run is left-flanking where it opens and right-flanking where it closes,
 * judged on the characters written beside it, a tag counting as punctuation;
 * and where no other delimiter or typed character of its family touches it,
 * but in `***x***` and `***x* y**`. Elsewhere they are tags.
 */
function spellDelimiters(writing: IWriting): void {
	const { tokens, model } = writing;
	const openIndex = new Map<number, number>();
	const closeIndex = new Map<number, number>();
	tokens.forEach((token, index) => {
		if (token.kind === 'text') {
			return;
		}
		(token.kind === 'open' ? openIndex : closeIndex).set(token.id, index);
		if (token.kind === 'open' && isDelimiterKey(token.key)) {
			writing.delimited.set(token.id, writing.form.delimiters && writing.place !== 'html');
		}
	});
	const isDelimiter = (token: NestingToken | undefined): token is IOpenToken | ICloseToken => token !== undefined && token.kind !== 'text' && isDelimiterKey(token.key) && writing.delimited.get(token.id) === true;
	const family = (token: IOpenToken | ICloseToken) => token.key === 'strike' ? '~' : '*';
	// The character a token writes at its start or its end; undefined when it writes nothing.
	const edge = (token: NestingToken, end: boolean): string | undefined => {
		if (token.kind === 'text') {
			return model[end ? token.to - 1 : token.from].text;
		}
		switch (token.key) {
			case 'link': {
				const link = linkOfToken(writing, token);
				if (link && writing.bare.has(link.id)) {
					return undefined;
				}
				return token.kind === 'open' ? '[' : (end ? ')' : ']');
			}
			case 'code':
				return '`';
		}
		return isDelimiter(token) ? family(token) : (end ? '>' : '<');
	};
	// The character written next to the token at `index`, before it or after it.
	const beside = (index: number, step: -1 | 1): string | undefined => {
		for (let at = index; at >= 0 && at < tokens.length; at += step) {
			const character = edge(tokens[at], step === -1);
			if (character !== undefined) {
				return character;
			}
		}
		return undefined;
	};
	const combined = (first: NestingToken, second: NestingToken): boolean => {
		if (first.kind === 'open' && second.kind === 'open' && first.key === 'bold' && second.key === 'italic') {
			const italicClose = closeIndex.get(second.id)!;
			return italicClose === closeIndex.get(first.id)! - 1 || tokens[italicClose + 1]?.kind === 'text';
		}
		if (first.kind === 'close' && second.kind === 'close' && first.key === 'italic' && second.key === 'bold') {
			return openIndex.get(second.id)! + 1 === openIndex.get(first.id)!;
		}
		return false;
	};
	for (let pass = 0; pass < 16; pass++) {
		let changed = false;
		const toTag = (token: IOpenToken | ICloseToken) => {
			writing.delimited.set(token.id, false);
			changed = true;
		};
		// Two delimiters of a family side by side would read as one run.
		for (let index = 0; index + 1 < tokens.length; index++) {
			const first = tokens[index];
			const second = tokens[index + 1];
			if (isDelimiter(first) && isDelimiter(second) && family(first) === family(second) && !combined(first, second)) {
				toTag(first.kind === 'close' && second.kind === 'close' ? first : second);
			}
		}
		// A typed character of the family beside a delimiter would join its run.
		tokens.forEach((token, index) => {
			if (!isDelimiter(token)) {
				return;
			}
			const before = tokens[index - 1];
			const after = tokens[index + 1];
			if ((before?.kind === 'text' && model[before.to - 1].text === family(token)) || (after?.kind === 'text' && model[after.from].text === family(token))) {
				toTag(token);
			}
		});
		tokens.forEach((token, index) => {
			if (token.kind !== 'open' || !isDelimiter(token)) {
				return;
			}
			const close = closeIndex.get(token.id)!;
			const sameFamily = (other: NestingToken | undefined, kind: 'open' | 'close' | undefined) => isDelimiter(other) && family(other) === family(token) && (kind === undefined || other.kind === kind);
			// Judged on the characters outside a combined run such as `***`.
			const outsideOpen = sameFamily(tokens[index - 1], undefined) ? index - 2 : index - 1;
			const insideOpen = sameFamily(tokens[index + 1], 'open') ? index + 2 : index + 1;
			const insideClose = sameFamily(tokens[close - 1], 'close') ? close - 2 : close - 1;
			const outsideClose = sameFamily(tokens[close + 1], undefined) ? close + 2 : close + 1;
			if (!leftFlanking(beside(outsideOpen, -1), beside(insideOpen, 1)) || !rightFlanking(beside(insideClose, -1), beside(outsideClose, 1))) {
				toTag(token);
			}
		});
		if (!changed) {
			break;
		}
	}
}

/** The links whose text is their address, with no format opened inside them: written bare, the reader may link them the same. */
function bareLinks(model: readonly IModelAtom[], tokens: readonly NestingToken[]): Set<number> {
	const bare = new Set<number>();
	tokens.forEach((token, index) => {
		const text = tokens[index + 1];
		const close = tokens[index + 2];
		if (token.kind !== 'open' || token.key !== 'link' || text?.kind !== 'text' || close?.kind !== 'close' || close.id !== token.id) {
			return;
		}
		const address = atomsText(model, text.from, text.to);
		const link = model[token.at].marks.link!;
		if (/\s/u.test(address)) {
			return;
		}
		const web = /^(?:https?|ftp):\/\//i.test(address) && baseHalfMarkdownDestination(address) === link.href;
		const www = /^www\./i.test(address) && baseHalfMarkdownDestination(`http://${address}`) === link.href;
		const email = address.includes('@') && !address.includes(':') && baseHalfMarkdownDestination(`mailto:${address}`) === link.href;
		if (web || www || email) {
			bare.add(link.id);
		}
	});
	return bare;
}

// --- Writing (design 3.2.2, steps 5 to 7)

interface IPiece {
	/** Markup as written; for text and a bare address, its characters as typed. */
	readonly text: string;
	readonly kind: 'markup' | 'text' | 'address';
	/** Text in a link's label. */
	readonly inLink?: boolean;
	/**
	 * The characters of code or of a link's address that the markup writes.
	 * The reader pairs a `~` of strikethrough with one in code or in an
	 * address, a backtick with one in an address, and, where it cannot mask
	 * a link, a `*` or `_` with one in its address.
	 */
	readonly holds?: string;
}

/** Writes the content in one form. */
function writeForm(writing: IWriting): string {
	const { model, tokens, place } = writing;
	const html = place === 'html';
	const cell = place === 'tableCell';
	const pieces: IPiece[] = [];
	const links: number[] = [];
	let codeFrom: number | undefined;
	let codeTo = 0;
	tokens.forEach(token => {
		if (token.kind === 'text') {
			if (codeFrom !== undefined) {
				codeTo = token.to;
			} else if (links.length > 0 && writing.bare.has(links[links.length - 1])) {
				pieces.push({ text: atomsText(model, token.from, token.to), kind: 'address' });
			} else {
				pieces.push({ text: atomsText(model, token.from, token.to), kind: 'text', inLink: !html && links.length > 0 });
			}
			return;
		}
		switch (token.key) {
			case 'code':
				if (token.kind === 'open') {
					codeFrom = token.at;
				} else {
					const code = atomsText(model, codeFrom!, codeTo);
					codeFrom = undefined;
					pieces.push({ text: html ? `<code>${escapeBaseHalfHtmlText(code)}</code>` : codeForm(code, writing, atLineStart(pieces), links.length > 0), kind: 'markup', holds: code });
				}
				return;
			case 'link': {
				const link = linkOfToken(writing, token)!;
				if (token.kind === 'open') {
					links.push(link.id);
				} else {
					links.pop();
				}
				if (!writing.bare.has(link.id)) {
					const href = cell ? link.href.replace(/\|/g, '\\|') : link.href;
					pieces.push({ text: token.kind === 'open' ? (html ? `<a href="${escapeBaseHalfHtmlAttribute(link.href)}">` : '[') : (html ? '</a>' : `](${href})`), kind: 'markup', holds: token.kind === 'close' ? link.href : undefined });
				}
				return;
			}
			case 'span': {
				const marks = model[token.kind === 'open' ? token.at : token.at - 1].marks;
				pieces.push({ text: token.kind === 'open' ? `<span style="${baseHalfNoteSpanStyle(marks.textColor, marks.backgroundColor)}">` : '</span>', kind: 'markup' });
				return;
			}
		}
		if (isDelimiterKey(token.key) && writing.delimited.get(token.id)) {
			pieces.push({ text: delimiterOf[token.key], kind: 'markup' });
		} else {
			const tag = tagOf[token.key];
			pieces.push({ text: token.kind === 'open' ? `<${tag}>` : `</${tag}>`, kind: 'markup' });
		}
	});
	if (html) {
		return pieces.map(piece => piece.kind === 'text' ? escapeBaseHalfHtmlText(piece.text) : piece.text).join('');
	}
	return escapePieces(pieces, writing);
}

/** Whether what is written next starts a line: at the start of the block, or after a line break of the text. */
function atLineStart(pieces: readonly IPiece[]): boolean {
	const last = pieces[pieces.length - 1];
	return !last || (last.kind === 'text' && !last.inLink && last.text.endsWith('\n'));
}

/** Escapes each run of text, knowing what the block writes and what stands beside the run on its line. */
function escapePieces(pieces: readonly IPiece[], writing: IWriting): string {
	const { place, tokens } = writing;
	const blockText = pieces.map(piece => piece.kind === 'markup' ? piece.holds ?? '' : piece.text).join('');
	let blockDelimiters = '';
	for (const token of tokens) {
		if (token.kind === 'open' && isDelimiterKey(token.key) && writing.delimited.get(token.id)) {
			blockDelimiters += token.key === 'strike' ? '~' : '*';
		}
	}
	if (pieces.some(piece => piece.kind === 'markup' && piece.text.startsWith('`'))) {
		blockDelimiters += '`';
	}
	const block = place === 'heading' ? 'heading' : place === 'tableCell' ? 'tableCell' : 'paragraph';
	let written = '';
	pieces.forEach((piece, index) => {
		if (piece.kind !== 'text') {
			written += piece.kind === 'address' && place === 'tableCell' ? piece.text.replace(/\|/g, '\\|') : piece.text;
			return;
		}
		const lineStart = written === '' || written.endsWith('\n');
		const next = pieces[index + 1]?.text;
		const context: IBaseHalfMarkdownTextContext = {
			block,
			lineStart,
			listItemStart: place === 'listItem' && written === '',
			inLink: piece.inLink,
			referenceLabels: writing.referenceLabels,
			before: lineStart ? undefined : Array.from(written.slice(-2)).pop(),
			after: next ? String.fromCodePoint(next.codePointAt(0)!) : undefined,
			blockText,
			blockDelimiters,
			escapeAll: writing.form.escapeAll
		};
		written += escapeBaseHalfMarkdownText(piece.text, context);
	});
	return written;
}

// Characters the reader takes for line endings, which a code span would turn
// into spaces. The model holds no carriage return: it is a space there.
const lineEndingInCode = /[\u{2028}\u{2029}]/u;

/**
 * Code as a code span, in a run of backticks one longer than the longest
 * inside it (design 3.2.2, step 5); or as `<code>` with every Markdown
 * character of it escaped where backticks would not read back: three or more
 * at the start of a line open a fenced code block, a backtick in code in a
 * link's text can end the text, in a cell a backslash before a pipe would
 * end the cell, and a line or paragraph separator would end a line. The last
 * form writes all code so.
 */
function codeForm(code: string, writing: IWriting, lineStart: boolean, inLink: boolean): string {
	let longest = 0;
	for (const run of code.match(/`+/g) ?? []) {
		longest = Math.max(longest, run.length);
	}
	const fence = '`'.repeat(longest + 1);
	const cell = writing.place === 'tableCell';
	if (writing.form.escapeAll || (lineStart && fence.length >= 3) || (inLink && longest > 0) || (cell && code.includes('\\|')) || lineEndingInCode.test(code)) {
		return `<code>${escapeBaseHalfMarkdownText(code, {
			block: writing.place === 'heading' ? 'heading' : cell ? 'tableCell' : 'paragraph',
			lineStart: false,
			inLink,
			referenceLabels: writing.referenceLabels,
			before: '>',
			after: '<',
			escapeAll: true
		})}</code>`;
	}
	// The reader strips one space from each end of code that starts and ends with one, and a backtick at an end would join the run.
	const padded = code.startsWith('`') || code.endsWith('`') || (code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code));
	const pad = padded ? ' ' : '';
	return fence + pad + (cell ? code.replace(/\|/g, '\\|') : code) + pad + fence;
}

// --- The check against the card's reader (design 3.2.2, step 7)

// The key of what the card's reader read of a form, by place, labels, and
// form, or null where it read no single block of the place: a form is read
// once, however many blocks write it.
const readKeys = new Map<string, string | null>();
const readKeysLimit = 4000;
let formsRead = 0;

/** For tests of the cache: how many forms the card's reader has read since the cache was cleared. */
export function baseHalfNoteInlineFormsReadForTesting(): number {
	return formsRead;
}

/** For tests of the cache: forgets every form read. */
export function clearBaseHalfNoteInlineCacheForTesting(): void {
	readKeys.clear();
	formsRead = 0;
}
const keysOfLabels = new WeakMap<ReadonlySet<string>, string>();

function labelsKey(labels: ReadonlySet<string> | undefined): string {
	if (!labels || labels.size === 0) {
		return '';
	}
	let key = keysOfLabels.get(labels);
	if (key === undefined) {
		key = JSON.stringify([...labels].sort());
		keysOfLabels.set(labels, key);
	}
	return key;
}

// A form without these holds no markup and no escape: the reader reads its
// characters as they are.
const mayReadAsMarkup = /[*_~`[\]<&\\!@]|:\/\/|www\./i;

function readsBackAs(written: string, place: BaseHalfNoteInlinePlace, labels: ReadonlySet<string> | undefined, expected: string): boolean {
	if (place !== 'html' && !mayReadAsMarkup.test(written)) {
		return true;
	}
	// The labels of the note matter only to brackets.
	const key = `${place}\u{0}${written.includes('[') ? labelsKey(labels) : ''}\u{0}${written}`;
	let read = readKeys.get(key);
	if (read === undefined) {
		formsRead++;
		const atoms = baseHalfMarkdownInlineAtoms(written, { place, referenceLabels: labels });
		read = atoms ? baseHalfInlineAtomsKey(atoms) : null;
		if (readKeys.size >= readKeysLimit) {
			readKeys.clear();
		}
		readKeys.set(key, read);
	}
	return read === expected;
}

const labelsOfDefinitions = new WeakMap<object, ReadonlySet<string>>();

function referenceLabelsOf(context: IBaseHalfNoteInlineContext): ReadonlySet<string> | undefined {
	if (context.referenceLabels || !context.definitions) {
		return context.referenceLabels;
	}
	let labels = labelsOfDefinitions.get(context.definitions);
	if (!labels) {
		labels = new Set(Object.keys(context.definitions));
		labelsOfDefinitions.set(context.definitions, labels);
	}
	return labels;
}

/**
 * Writes inline content as a note stores it in `context.place` (note
 * formats, rules 12 to 18). Marks nest by their length, and those of equal
 * length in the order link, color, underline, bold, italic, strikethrough,
 * code; a link is never cut in two; white space at the edges of bold,
 * italic, and strikethrough stands outside them. Bold, italic, and
 * strikethrough are `**`, `*`, and `~~` where the card's reader reads them
 * back so, else `<strong>`, `<em>`, and `<del>`, and always tags in HTML;
 * underline is `<u>`, and palette colors a span in the stored spelling.
 * Typed text is escaped where it would act as markup. A link is
 * `[text](address)`, or its bare address when its text is that address and
 * the reader links it the same. A line break is a backslash at the end of
 * the line in a paragraph, a quote, and a list item, and `<br>` in a
 * heading, a table cell, a link's text, and HTML.
 *
 * Each form is read with the card's reader before it is kept, and the next
 * form is tried while it reads back as anything else. When none reads back,
 * the most escaped form is written and `context.onUnreadable` is told.
 *
 * The lines of the result are the lines of the text; the caller adds a
 * quote's `> `, a list item's indentation, and the body's line ending.
 */
export function writeBaseHalfNoteInline(content: BaseHalfNoteInlineContent | undefined, context: IBaseHalfNoteInlineContext = {}): string {
	const place = context.place ?? 'paragraph';
	const model = modelOf(content, place);
	if (model.length === 0) {
		return '';
	}
	const referenceLabels = referenceLabelsOf(context);
	const expected = baseHalfInlineAtomsKey(publicAtoms(model));
	let written = '';
	for (const form of place === 'html' ? htmlForms : markdownForms) {
		const tokens = nestingTokens(model, form.pieces);
		const bare = place === 'html' || form.escapeAll ? new Set<number>() : bareLinks(model, tokens);
		for (const bareOfForm of bare.size > 0 ? [bare, new Set<number>()] : [bare]) {
			const writing: IWriting = { model, tokens, place, form, referenceLabels, bare: bareOfForm, delimited: new Map() };
			spellDelimiters(writing);
			written = writeForm(writing);
			if (readsBackAs(written, place, referenceLabels, expected)) {
				return written;
			}
		}
	}
	context.onUnreadable?.(written);
	return written;
}
