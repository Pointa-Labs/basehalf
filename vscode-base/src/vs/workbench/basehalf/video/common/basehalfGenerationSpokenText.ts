/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { lexer, type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import { BASEHALF_NOTE_HTML_TAGS } from '../../markdown/common/basehalfNoteMarkdownHtml.js';

/**
 * A note in a prompt that is spoken or sung (D78; generation cards,
 * "Inputs"): the text of a Markdown note as a reader of its card says it.
 * The note is read with the parser its card renders it with, so that the
 * voice does not say its marks and the song does not sing them.
 */

/** The elements a note shows, whose tags a reader does not say. */
const NOTE_TAGS: ReadonlySet<string> = new Set(BASEHALF_NOTE_HTML_TAGS);

/** The elements of a note whose tags end a line, as `<br>` and the blocks do. */
const LINE_TAGS: ReadonlySet<string> = new Set([
	'blockquote', 'br', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'hr', 'li', 'ol', 'p', 'pre', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul'
]);

/** The named character references that the text of a note holds as its parser leaves it, and that the note shows as characters. */
const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', '\''], ['nbsp', ' ']]);

/** Whether a path is that of a Markdown note (`.md` or `.markdown`), whose text has marks. */
export function isBaseHalfMarkdownNotePath(path: string): boolean {
	return /\.(?:md|markdown)$/i.test(path);
}

/**
 * The text of a Markdown note as a voice says it or a song sings it
 * (generation cards, "Inputs"), its front matter already left out:
 *
 * - headings, paragraphs, quotes, and the items of lists are their text,
 *   without the marks of headings, quotes, and list items, and without the
 *   marks of emphasis, strikethrough, and code around their words;
 * - a link is its text, and an image, a rule, and a link definition are left
 *   out;
 * - a code block is its code as written, without its fences;
 * - a table is its rows, one a line, each the text of its cells;
 * - the tags of the HTML elements a note shows are left out, `<br>` and the
 *   tags of blocks ending a line, and so are HTML comments; HTML a note shows
 *   as written, such as `<break time="1s" />`, stays as written;
 * - text in square brackets, such as a song's `[Verse]`, stays as written,
 *   as do the lines the author ended; blocks are a blank line apart.
 */
export function baseHalfSpokenNoteText(markdown: string): string {
	const text = blocksText(lexer(markdown, { gfm: true, breaks: true }), '\n\n');
	return text.split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function blocksText(tokens: readonly Token[], separator: string): string {
	return tokens.map(blockText).filter(text => text.trim().length > 0).join(separator);
}

function blockText(token: Token): string {
	switch (token.type) {
		case 'heading':
		case 'paragraph':
			return inlineText((token as Tokens.Heading | Tokens.Paragraph).tokens);
		case 'text': {
			const text = token as Tokens.Text;
			return text.tokens ? inlineText(text.tokens) : withCharacters(text.text);
		}
		case 'code':
			return (token as Tokens.Code).text;
		case 'blockquote':
			return blocksText((token as Tokens.Blockquote).tokens, '\n\n');
		case 'list':
			return (token as Tokens.List).items.map(item => blocksText(item.tokens, '\n')).filter(text => text.trim().length > 0).join('\n');
		case 'table': {
			const table = token as Tokens.Table;
			return [table.header, ...table.rows]
				.map(row => row.map(cell => inlineText(cell.tokens).trim()).filter(text => text.length > 0).join(' '))
				.filter(text => text.length > 0)
				.join('\n');
		}
		case 'html':
			return htmlText(token.raw);
		case 'space':
		case 'hr':
		case 'def':
			return '';
		default:
			return token.raw;
	}
}

function inlineText(tokens: readonly Token[] | undefined): string {
	let text = '';
	for (const token of tokens ?? []) {
		switch (token.type) {
			case 'text': {
				const part = token as Tokens.Text;
				text += part.tokens ? inlineText(part.tokens) : withCharacters(part.text);
				break;
			}
			case 'escape':
			case 'codespan':
				text += withCharacters((token as Tokens.Escape | Tokens.Codespan).text);
				break;
			case 'strong':
			case 'em':
			case 'del':
			case 'link':
				text += inlineText((token as Tokens.Strong | Tokens.Em | Tokens.Del | Tokens.Link).tokens);
				break;
			case 'br':
				text += '\n';
				break;
			case 'html':
				text += htmlText(token.raw);
				break;
			case 'image':
			case 'checkbox':
				break;
			default:
				text += token.raw;
		}
	}
	return text;
}

/**
 * HTML of a note as a reader says it: a comment is left out, and so are the
 * tags of the elements a note shows, `<br>` and the tags of blocks ending a
 * line, while the text between them stays. HTML that a note shows as
 * written, because it holds an element the note does not show, stays as
 * written, as the card shows it.
 */
function htmlText(raw: string): string {
	const withoutComments = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
	const names = [...withoutComments.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)/g)].map(match => match[1].toLowerCase());
	if (names.some(name => !NOTE_TAGS.has(name))) {
		return raw;
	}
	return withCharacters(withoutComments.replace(/<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g, (_tag, name: string) => LINE_TAGS.has(name.toLowerCase()) ? '\n' : ''));
}

/**
 * Text with the character references a note shows as characters: those the
 * parser writes for `&`, `<`, `>`, and quotes, `&nbsp;`, and numeric ones.
 * Any other stays as written.
 */
function withCharacters(text: string): string {
	return text.replace(/&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (reference, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
		if (name !== undefined) {
			return NAMED_REFERENCES.get(name) ?? reference;
		}
		const code = decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16);
		return code > 0 && code <= 0x10FFFF && (code < 0xD800 || code > 0xDFFF) ? String.fromCodePoint(code) : reference;
	});
}
