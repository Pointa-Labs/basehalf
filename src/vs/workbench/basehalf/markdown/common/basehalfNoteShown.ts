/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import {
	BaseHalfInlineAtomReader,
	baseHalfCardLexer,
	baseHalfInlineAtomsKey,
	baseHalfInlineMediaKey,
	baseHalfNoteAddress,
	IBaseHalfHtmlTag,
	IBaseHalfInlineAtom,
	IBaseHalfInlineMedia,
	IBaseHalfNoteLinkDefinition,
	normalizeBaseHalfInlineLineBreaks,
	splitBaseHalfHtml
} from './basehalfNoteInline.js';
import { decodeBaseHalfSmallCharacterReferences } from './basehalfNoteMarkdownText.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports only its siblings and the
// Markdown parser.
//
// The guard of which blocks Rich edits (note formats, rule 34): a block is
// edited in place when, read by Rich and written back, it shows the same on
// the card and keeps every HTML element, attribute, and comment and every
// title of a link or a picture that the file has in it. Both texts are read
// with the card's own reader into a signature of what the card shows, in
// which every spelling of a format is the same and whatever Rich cannot
// write stays as written.

export interface IBaseHalfShownContext {
	/** The note's reference definitions, as `marked` keys them. */
	readonly definitions?: Readonly<Record<string, IBaseHalfNoteLinkDefinition>>;
	/**
	 * Decodes character references once, as a page does. The rich editor's
	 * webview passes the page's own decoding; by default every numeric
	 * reference and `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, and `&nbsp;`
	 * are decoded, and other named references stay as written.
	 */
	readonly decodeCharacterReferences?: (text: string) => string;
}

// The elements that start a block of HTML (the list `marked` reads blocks of
// HTML by, with `pre`). Any other element stands inside text.
const blockElements: ReadonlySet<string> = new Set([
	'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog',
	'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'meta', 'nav', 'noframes', 'ol', 'optgroup',
	'option', 'p', 'param', 'pre', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul'
]);

// The elements of the forms Rich writes around blocks: a toggle, its title, a
// heading in a toggle's title, and the figure of a caption.
const writtenElements: ReadonlySet<string> = new Set(['details', 'summary', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** One part of a signature: a block, the start or end of an element, or a run of text. */
type ShownPart =
	| { readonly kind: 'entry'; readonly text: string }
	| { readonly kind: 'run'; readonly atoms: readonly IBaseHalfInlineAtom[] };

// White space a page collapses into one space, and does not show at the
// start or end of a line. A line ending in HTML text is read as a space, so
// `\n` in atoms is always a line break.
const collapsibleSpace = /^[ \t\r\f]$/;
const whiteSpace = /^\s$/u;

/**
 * Atoms as a page shows them: runs of white space outside code collapse into
 * one space, and white space at the start and end of the text and beside a
 * line break does not show, nor does a line break that ends the text after
 * something on its line, where the line ends anyway. White space shows no
 * bold, italic, or strikethrough, which Rich keeps outside their edges, and
 * a line break no format but the link it stands in.
 */
function shownAtoms(atoms: readonly IBaseHalfInlineAtom[]): IBaseHalfInlineAtom[] {
	const shown: IBaseHalfInlineAtom[] = [];
	const isSpace = (atom: IBaseHalfInlineAtom | undefined) => atom !== undefined && !atom.marks.code && atom.other === undefined && !atom.media && collapsibleSpace.test(atom.text);
	const dropTrailingSpace = () => {
		while (isSpace(shown[shown.length - 1])) {
			shown.pop();
		}
	};
	for (const atom of atoms) {
		if (atom.text === '\n' && atom.other === undefined && !atom.media) {
			dropTrailingSpace();
			shown.push(atom);
		} else if (isSpace(atom)) {
			const last = shown[shown.length - 1];
			if (last && last.text !== '\n' && !isSpace(last)) {
				shown.push({ text: ' ', marks: atom.marks });
			}
		} else {
			shown.push(atom);
		}
	}
	dropTrailingSpace();
	const isLineBreak = (atom: IBaseHalfInlineAtom | undefined) => atom !== undefined && atom.text === '\n' && atom.other === undefined && !atom.media;
	if (isLineBreak(shown[shown.length - 1]) && shown.length >= 2 && !isLineBreak(shown[shown.length - 2])) {
		shown.pop();
	}
	return normalizeBaseHalfInlineLineBreaks(shown).map(atom => {
		if (!whiteSpace.test(atom.text) || atom.text === '\n' || (!atom.marks.bold && !atom.marks.italic && !atom.marks.strike)) {
			return atom;
		}
		const { bold, italic, strike, ...marks } = atom.marks;
		return { ...atom, marks };
	});
}

/** The picture, video, or sound that atoms show alone, with nothing around it. */
function aloneMedia(atoms: readonly IBaseHalfInlineAtom[]): IBaseHalfInlineMedia | undefined {
	const only = atoms.length === 1 ? atoms[0] : undefined;
	return only?.media && Object.keys(only.marks).length === 0 ? only.media : undefined;
}

/** A media block by what it shows: a caption shows above the picture, the video, or the sound it comes before, and Rich writes it below. */
function mediaEntry(media: IBaseHalfInlineMedia, caption: readonly IBaseHalfInlineAtom[] | undefined, captionFirst = false): string {
	// An empty caption is none.
	return `media ${baseHalfInlineMediaKey(media)}${caption && caption.length > 0 ? ` caption${captionFirst ? ' before' : ''} ${baseHalfInlineAtomsKey(caption)}` : ''}`;
}

/** The text of a tag as written, its name in lower case; for an element of the forms Rich writes, the element alone. */
function tagEntry(tag: IBaseHalfHtmlTag): string {
	const { name, attributes } = tag;
	if (writtenElements.has(name)) {
		if (tag.kind === 'end') {
			return `</${name}>`;
		}
		// `open` on a toggle is whether it shows open, whatever its value.
		if (name === 'details' && attributes.every(([attribute]) => attribute === 'open')) {
			return attributes.length > 0 ? '<details open>' : '<details>';
		}
		if (attributes.length === 0 && !tag.selfClosing) {
			return `<${name}>`;
		}
	}
	const prefix = tag.kind === 'end' ? '</' : '<';
	return `html ${JSON.stringify(prefix + name + tag.raw.slice(prefix.length + name.length))}`;
}

class ShownSignature {

	readonly parts: ShownPart[] = [];
	private readonly decode: (text: string) => string;

	constructor(decode: (text: string) => string) {
		this.decode = decode;
	}

	private entry(text: string): void {
		this.parts.push({ kind: 'entry', text });
	}

	private run(atoms: readonly IBaseHalfInlineAtom[]): void {
		if (atoms.length > 0) {
			this.parts.push({ kind: 'run', atoms });
		}
	}

	private inline(tokens: readonly Token[]): IBaseHalfInlineAtom[] {
		const reader = new BaseHalfInlineAtomReader(this.decode);
		reader.readTokens(tokens);
		return shownAtoms(reader.finish());
	}

	blocks(tokens: readonly Token[]): void {
		for (const token of tokens) {
			this.block(token);
		}
	}

	private block(token: Token): void {
		switch (token.type) {
			case 'space':
				return;
			case 'paragraph':
			case 'text': {
				// A list item's text is a text token holding its inline tokens.
				const atoms = this.inline((token as Tokens.Paragraph).tokens ?? []);
				const media = aloneMedia(atoms);
				if (media) {
					this.entry(mediaEntry(media, undefined));
				} else {
					this.entry('paragraph');
					this.run(atoms);
				}
				return;
			}
			case 'heading': {
				const heading = token as Tokens.Heading;
				this.entry(`heading ${heading.depth}`);
				this.run(this.inline(heading.tokens));
				return;
			}
			case 'blockquote':
				this.entry('quote {');
				this.blocks((token as Tokens.Blockquote).tokens);
				this.entry('}');
				return;
			case 'list': {
				const list = token as Tokens.List;
				// The number of a list's first item and its spacing show; its markers do not.
				this.entry(`list ${list.ordered ? `ordered ${list.start}` : 'bullets'}${list.loose ? ' loose' : ''} {`);
				for (const item of list.items) {
					this.entry(item.task ? `item ${item.checked ? 'checked' : 'unchecked'} {` : 'item {');
					// An item's own text that shows nothing, such as the `&#32;` that
					// keeps an empty item a line of its own, is no text, as an item
					// that has none.
					const [own, ...rest] = item.tokens;
					const ownTokens = own?.type === 'text' || own?.type === 'paragraph' ? (own as Tokens.Text).tokens : undefined;
					const ownShowsNothing = Array.isArray(ownTokens) && this.inline(ownTokens).length === 0;
					this.blocks(ownShowsNothing ? rest : item.tokens);
					this.entry('}');
				}
				this.entry('}');
				return;
			}
			case 'code': {
				const code = token as Tokens.Code;
				// A fence's info string is kept whole, so that what other tools read in it is kept too; `text` is no language.
				const info = (code.lang ?? '').trim();
				this.entry(`code ${JSON.stringify(info === 'text' ? '' : info)} ${JSON.stringify(code.text)}`);
				return;
			}
			case 'hr':
				this.entry('divider');
				return;
			case 'table': {
				const table = token as Tokens.Table;
				// A column without an alignment shows left-aligned.
				this.entry(`table ${table.align.map(align => align === 'center' || align === 'right' ? align : 'left').join(' ')} {`);
				for (const row of [table.header, ...table.rows]) {
					this.entry('row');
					const cells = row.map(cell => this.inline(cell.tokens));
					// A cell of a line break alone is as tall as a line of text, which a
					// row holding text has anyway.
					const holdsText = cells.some(atoms => atoms.some(atom => atom.text !== '\n'));
					for (const atoms of cells) {
						this.entry('cell');
						this.run(holdsText && atoms.length === 1 && atoms[0].text === '\n' && atoms[0].other === undefined && !atoms[0].media ? [] : atoms);
					}
				}
				this.entry('}');
				return;
			}
			case 'html':
				this.html(token as Tokens.HTML);
				return;
		}
		this.entry(`other ${JSON.stringify(token.raw)}`);
	}

	/**
	 * A block of HTML. The elements Rich writes around blocks stand as
	 * elements; a picture, a video, or a sound alone, or in a figure with a
	 * caption, is one media block; every other element stands as written.
	 */
	private html(token: Tokens.HTML): void {
		if (token.pre) {
			// `pre`, `script`, `style`, and `textarea` hold text that is not read as HTML.
			this.entry(`html ${JSON.stringify(token.raw)}`);
			return;
		}
		const parts: ShownPart[] = [];
		let reader = new BaseHalfInlineAtomReader(this.decode);
		const flush = () => {
			const atoms = shownAtoms(reader.finish());
			if (atoms.length > 0) {
				parts.push({ kind: 'run', atoms });
			}
			reader = new BaseHalfInlineAtomReader(this.decode);
		};
		for (const piece of splitBaseHalfHtml(token.raw)) {
			if (piece.kind === 'tag' && blockElements.has(piece.tag.name)) {
				flush();
				parts.push({ kind: 'entry', text: tagEntry(piece.tag) });
			} else if (piece.kind === 'tag') {
				reader.readTag(piece.tag);
			} else if (piece.kind === 'text') {
				reader.readHtml(piece.text);
			} else {
				reader.pushOther(piece.raw, {});
			}
		}
		flush();
		const media = htmlMediaBlock(parts);
		if (media !== undefined) {
			this.entry(media);
		} else {
			this.parts.push(...parts);
		}
	}
}

function partEntry(part: ShownPart | undefined): string | undefined {
	return part?.kind === 'entry' ? part.text : undefined;
}

function partMedia(part: ShownPart | undefined): IBaseHalfInlineMedia | undefined {
	return part?.kind === 'run' ? aloneMedia(part.atoms) : undefined;
}

/** The caption that parts are, `<figcaption>`, its text, and `</figcaption>`; an empty caption is none. */
function captionOf(parts: readonly ShownPart[]): readonly IBaseHalfInlineAtom[] | undefined {
	if (partEntry(parts[0]) !== '<figcaption>' || partEntry(parts[parts.length - 1]) !== '</figcaption>') {
		return undefined;
	}
	if (parts.length === 2) {
		return [];
	}
	const text = parts[1];
	return parts.length === 3 && text.kind === 'run' ? text.atoms : undefined;
}

/**
 * The media block that the parts of a block of HTML are, if they are one: a
 * picture, a video, or a sound alone, or in a figure with or without a
 * caption before or after it.
 */
function htmlMediaBlock(parts: readonly ShownPart[]): string | undefined {
	if (parts.length === 1) {
		const media = partMedia(parts[0]);
		return media ? mediaEntry(media, undefined) : undefined;
	}
	if (partEntry(parts[0]) !== '<figure>' || partEntry(parts[parts.length - 1]) !== '</figure>') {
		return undefined;
	}
	const inner = parts.slice(1, -1);
	const first = partMedia(inner[0]);
	if (first) {
		const caption = inner.length === 1 ? [] : captionOf(inner.slice(1));
		return caption ? mediaEntry(first, caption) : undefined;
	}
	const last = partMedia(inner[inner.length - 1]);
	const caption = last ? captionOf(inner.slice(0, -1)) : undefined;
	return last && caption ? mediaEntry(last, caption, true) : undefined;
}

function serialize(parts: readonly ShownPart[]): string {
	return parts.map(part => part.kind === 'entry' ? part.text : `text ${baseHalfInlineAtomsKey(part.atoms)}`).join('\n');
}

/**
 * The reference definitions that a text holds itself. They show nothing, but
 * the file keeps them, so a block of them is no block Rich writes.
 */
function ownDefinitions(markdown: string): [string, IBaseHalfNoteLinkDefinition][] {
	if (!markdown.includes(']:')) {
		return [];
	}
	const lexer = baseHalfCardLexer();
	lexer.lex(markdown);
	return Object.entries(lexer.tokens.links).map(([label, definition]) => [label, { href: definition.href, title: definition.title }]);
}

/**
 * What the card shows of Markdown, as a text that is equal for two texts
 * exactly when they show the same (note formats, rule 34): the same blocks
 * with their kinds and levels; lists with the number of their first item and
 * their spacing, and check items with their state; code with its language,
 * `text` being none; tables with the alignment of each column, none being
 * left; the same characters, each with the same formats however they are
 * written, links with their addresses decoded once and written by the
 * destination rule, and line breaks, a single line break and a backslash one
 * alike; pictures, videos, and sounds by their kind, address, width, name,
 * and caption, with or without `<figure>`, in Markdown or HTML alike; the
 * toggles with whether they show open. Runs of white space collapse except
 * in code, and white space between tags does not count.
 *
 * What Rich cannot write stays in it as written, so that a block holding it
 * never shows the same as what Rich writes: every HTML element, attribute,
 * and comment of no form Rich writes, every title of a link or a picture,
 * and every reference definition.
 */
export function baseHalfMarkdownShownSignature(markdown: string, context: IBaseHalfShownContext = {}): string {
	const decode = context.decodeCharacterReferences ?? decodeBaseHalfSmallCharacterReferences;
	const own = ownDefinitions(markdown);
	const definitions = own.length > 0 ? { ...Object.fromEntries(own), ...context.definitions } : context.definitions;
	const signature = new ShownSignature(decode);
	signature.blocks(baseHalfCardLexer(definitions).lex(markdown));
	for (const [label, definition] of own) {
		signature.parts.push({ kind: 'entry', text: `definition ${JSON.stringify([label, baseHalfNoteAddress(definition.href, decode), definition.title ?? ''])}` });
	}
	return serialize(signature.parts);
}

/**
 * Whether `written`, what Rich writes for the blocks it read of `source`,
 * shows the same on the card as `source` and keeps everything of it that
 * the card's signature holds as written (note formats, rule 34; design A3).
 * Equal texts, line endings aside, are the same without reading them.
 */
export function baseHalfMarkdownShowsSame(source: string, written: string, context: IBaseHalfShownContext = {}): boolean {
	const lineEndings = /\r\n?/g;
	if (source.replace(lineEndings, '\n') === written.replace(lineEndings, '\n')) {
		return true;
	}
	return baseHalfMarkdownShownSignature(source, context) === baseHalfMarkdownShownSignature(written, context);
}
