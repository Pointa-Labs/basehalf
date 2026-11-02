/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BASEHALF_NOTE_FIXED_BLOCK_TYPE,
	baseHalfNoteBlockChildren,
	baseHalfNoteBlockId,
	baseHalfNoteBlockProps,
	baseHalfNoteBlockType,
	baseHalfNoteCellContent,
	baseHalfNoteColumnAlignments,
	baseHalfNoteKindOf,
	baseHalfNoteStringProp,
	baseHalfNoteTableRows,
	IBaseHalfNoteBlock,
	IBaseHalfNoteBlockKind,
	IBaseHalfNoteListHint,
	isBaseHalfNoteListItemType,
	isBaseHalfNoteRecord,
	isBaseHalfNoteToggle,
	sameBaseHalfNoteBlockKind
} from './basehalfNoteBlocks.js';
import { BaseHalfNoteInlineContent, BaseHalfNoteInlinePlace, writeBaseHalfNoteInline } from './basehalfNoteInline.js';
import { baseHalfMarkdownDestination, escapeBaseHalfHtmlAttribute, escapeBaseHalfHtmlText, escapeBaseHalfMarkdownText } from './basehalfNoteMarkdownText.js';
import { baseHalfNoteMayHold } from './basehalfNoteStructure.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports only its siblings, the Markdown
// parser, and, through the media kind, the one list of media files.
//
// The blocks of a note as the note stores them (note formats, rules 10 to
// 24 and 38 to 39; design 3.1). Rich writes every block it writes in one
// canonical form; what the file wrote of a list item, its marker, its number,
// the indentation of its children, and the line breaks between them, comes
// back through hints, so that an edited item keeps the shape the file gave
// it. The writer is pure and throws on no block JSON.

/** The list item written before a block in its container. */
export interface IBaseHalfNotePreviousListItem {
	/** Its marker as written: `-`, `*`, `+`, or a number with `.` or `)`. */
	readonly marker: string;
	/**
	 * The last numbers of the run of numbered items it ends, in order, its own
	 * last; a new item reads the last two. Empty for a bullet or a check item.
	 */
	readonly numbers: readonly number[];
}

export interface IBaseHalfNoteWriteHints {
	/** The note's line ending: CRLF when the file's first line break is CRLF (rule 24). Default: `\n`. */
	readonly eol?: '\n' | '\r\n';
	/**
	 * Whether a toggle is stored open (rule 40). Default: the block's
	 * `basehalfOpen`, from the reader's block pass; a new toggle has none and
	 * is stored closed.
	 */
	readonly isOpen?: (block: IBaseHalfNoteBlock) => boolean;
	/** What the file wrote of a list item, by its id. Default, and where this has none: the block's `basehalfHints`. */
	readonly listHint?: (blockId: string) => IBaseHalfNoteListHint | undefined;
	/**
	 * The list item written right before the block in its container, if any:
	 * a new item takes its marker, and a new numbered item the number after
	 * its number (rule 19). Blocks that write nothing do not count. The writer
	 * finds it for the blocks a block holds and for the blocks after the first
	 * of those it writes together.
	 */
	readonly previousListItem?: IBaseHalfNotePreviousListItem;
	/**
	 * The marker the file wrote of the list item right after the block in its
	 * container, if any: a new numbered item between two items of one number
	 * takes that number, as in a list that repeats it (rule 19). The writer
	 * finds it for the blocks it writes together.
	 */
	readonly nextListItem?: { readonly marker: string };
	/** The labels of the note's reference definitions, as `marked` keys them. Text that would read as a reference to one is escaped. */
	readonly referenceLabels?: ReadonlySet<string>;
	/** Told when no form of a block's inline content reads back as the content; its most escaped form is written. */
	readonly onUnreadable?: (written: string) => void;
}

/** A block as written, for the line breaks it needs before and after it. */
export interface IBaseHalfNoteWrittenBlock {
	readonly kind: IBaseHalfNoteBlockKind;
	/** What the writer wrote of it, or the bytes a fixed block keeps. */
	readonly text: string;
}

interface IWriting {
	readonly eol: string;
	readonly isOpen: (block: IBaseHalfNoteBlock) => boolean;
	readonly listHint: (block: unknown) => IBaseHalfNoteListHint | undefined;
	readonly referenceLabels: ReadonlySet<string> | undefined;
	readonly onUnreadable: ((written: string) => void) | undefined;
}

function validHint(value: unknown): IBaseHalfNoteListHint | undefined {
	return isBaseHalfNoteRecord(value) && typeof value.marker === 'string' ? value as unknown as IBaseHalfNoteListHint : undefined;
}

function writingOf(hints: IBaseHalfNoteWriteHints): IWriting {
	return {
		eol: hints.eol === '\r\n' ? '\r\n' : '\n',
		isOpen: block => hints.isOpen ? hints.isOpen(block) : block.basehalfOpen === true,
		listHint: block => {
			const id = baseHalfNoteBlockId(block);
			const given = id !== undefined && hints.listHint ? validHint(hints.listHint(id)) : undefined;
			return given ?? (isBaseHalfNoteRecord(block) ? validHint(block.basehalfHints) : undefined);
		},
		referenceLabels: hints.referenceLabels,
		onUnreadable: hints.onUnreadable
	};
}

function inline(content: unknown, place: BaseHalfNoteInlinePlace, writing: IWriting): string {
	return writeBaseHalfNoteInline(content as BaseHalfNoteInlineContent | undefined, { place, referenceLabels: writing.referenceLabels, onUnreadable: writing.onUnreadable });
}

function contentOf(block: unknown): unknown {
	return isBaseHalfNoteRecord(block) ? block.content : undefined;
}

/** The lines of text the inline writer wrote, each written after `prefix` but the first, ended by the note's line ending. */
function joinLines(text: string, writing: IWriting, prefix = ''): string {
	return text.split('\n').join(writing.eol + prefix);
}

/** `text` indented by `indent`: each line that holds anything, the first one too. */
function indentLines(text: string, indent: string): string {
	return indent === '' ? text : indent + text.replace(/(\r\n|\r|\n)(?=[^\r\n])/g, `$1${indent}`);
}

function firstLine(text: string): string {
	return /^[^\r\n]*/.exec(text)?.[0] ?? '';
}

// --- List items (rule 19)

const bulletMarker = /^[-*+]$/;
const numberedMarker = /^(\d{1,9})([.)])$/;
const largestNumber = 999999999;

/** The number an item that starts a run of numbered items shows: its start, else 1, as the editor numbers it. */
function runStart(props: Readonly<Record<string, unknown>>): number {
	const start = props.start;
	return typeof start === 'number' && Number.isInteger(start) && start >= 1 && start <= largestNumber ? start : 1;
}

function listItemMarker(type: string, props: Readonly<Record<string, unknown>>, hint: IBaseHalfNoteListHint | undefined, previous: IBaseHalfNotePreviousListItem | undefined, next: string | undefined): string {
	if (type === 'numberedListItem') {
		const own = hint ? numberedMarker.exec(hint.marker) : null;
		const before = previous ? numberedMarker.exec(previous.marker) : null;
		const delimiter = own?.[2] ?? before?.[2] ?? '.';
		if (!before) {
			// The first item of a run shows the number the list starts at, the
			// digits of the file while they are that number.
			const start = runStart(props);
			return (own && Number(own[1]) === start ? own[1] : String(start)) + delimiter;
		}
		if (own) {
			// Any other item keeps the number the file gave it: every renderer numbers by place (L15).
			return own[1] + delimiter;
		}
		// A new item repeats the number of a list that repeats it: the two
		// items before it, or the one before it and the one after it, have the
		// same number.
		const numbers = previous!.numbers.length > 0 ? previous!.numbers : [Number(before[1])];
		const last = numbers[numbers.length - 1];
		const after = next !== undefined ? numberedMarker.exec(next) : null;
		const repeated = numbers.length >= 2 ? numbers[numbers.length - 2] === last : after !== null && after[2] === delimiter && Number(after[1]) === last;
		return String(Math.min(largestNumber, repeated ? last : last + 1)) + delimiter;
	}
	if (hint && bulletMarker.test(hint.marker)) {
		return hint.marker;
	}
	return previous && bulletMarker.test(previous.marker) ? previous.marker : '-';
}

/** The marker of a list item; `next` is the marker the file wrote of the list item after it, if any. */
function markerOf(block: unknown, writing: IWriting, previous: IBaseHalfNotePreviousListItem | undefined, next?: string): string | undefined {
	const type = baseHalfNoteBlockType(block);
	return isBaseHalfNoteListItemType(type) ? listItemMarker(type, baseHalfNoteBlockProps(block), writing.listHint(block), previous, next) : undefined;
}

/** The marker the file wrote of a block that is a list item, from its hint. */
function writtenMarker(block: unknown, writing: IWriting): string | undefined {
	return isBaseHalfNoteListItemType(baseHalfNoteBlockType(block)) ? writing.listHint(block)?.marker : undefined;
}

function followingListItem(marker: string | undefined, previous: IBaseHalfNotePreviousListItem | undefined): IBaseHalfNotePreviousListItem | undefined {
	if (marker === undefined) {
		return undefined;
	}
	const own = numberedMarker.exec(marker);
	if (!own) {
		return { marker, numbers: [] };
	}
	const number = Number(own[1]);
	const before = previous ? numberedMarker.exec(previous.marker) : null;
	if (!before || before[2] !== own[2]) {
		return { marker, numbers: [number] };
	}
	const numbers = previous!.numbers;
	return { marker, numbers: [numbers.length > 0 ? numbers[numbers.length - 1] : Number(before[1]), number] };
}

/**
 * The columns a list item's children are indented by: the file's, while
 * they stay within the item and do not make code of them, else the width of
 * the item's marker and its space (2 for `- `, 3 for `1. `).
 */
function childIndentOf(hint: IBaseHalfNoteListHint | undefined, width: number): number {
	const indent = hint?.childIndent;
	return typeof indent === 'number' && Number.isInteger(indent) && indent >= width && indent <= width + 3 ? indent : width;
}

/** The line breaks the file had before `child`, when it and the member before it are the same neighbours, of the same kinds, as when the note was read. */
function originalLineBreaks(hint: IBaseHalfNoteListHint | undefined, before: IWrittenChild | undefined, child: IWrittenChild): number | undefined {
	const ids = hint?.children;
	const separators = hint?.separators;
	const kinds = hint?.kinds;
	if (!ids || !separators || !kinds || ids.length !== separators.length || kinds.length !== ids.length || child.id === undefined) {
		return undefined;
	}
	const at = ids.indexOf(child.id);
	if (at === -1 || !sameBaseHalfNoteBlockKind(kinds[at], child.kind)) {
		return undefined;
	}
	if (before === undefined ? at !== 0 : at === 0 || before.id === undefined || ids[at - 1] !== before.id || !sameBaseHalfNoteBlockKind(kinds[at - 1], before.kind)) {
		return undefined;
	}
	const breaks = typeof separators[at] === 'string' ? lineBreakCount(separators[at]) : 0;
	return breaks > 0 ? breaks : undefined;
}

function lineBreakCount(text: string): number {
	return text.split('\n').length - 1;
}

interface IWrittenChild extends IBaseHalfNoteWrittenBlock {
	readonly id: string | undefined;
}

// The blocks that the reader takes for a child of an item without text when
// they stand on the line after its marker: what starts a block of its own
// there. A paragraph or a link there would be the item's own text, and a
// rule, or an empty bullet's lone `-`, would make a heading of the marker and
// the text above it.
const childTypesUnderAMarker: ReadonlySet<string> = new Set([
	'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'heading', 'quote', 'codeBlock', 'table', 'image', 'video', 'audio'
]);
const loneDash = /^-[ \t]*$/;

// The text of an item that shows nothing but keeps the item a line of its
// own: a space, as a reference, which neither the reader nor a tool that
// trims the ends of lines takes away.
const emptyItemText = '&#32;';

/** The blocks a list item holds, as written, each with its id, its kind, and the marker it was written with. */
function writeChildren(block: unknown, writing: IWriting): IWrittenChild[] {
	const children: IWrittenChild[] = [];
	const list = [...expanded(baseHalfNoteBlockChildren(block))];
	let previousItem: IBaseHalfNotePreviousListItem | undefined;
	list.forEach((child, index) => {
		const childMarker = markerOf(child, writing, previousItem, writtenMarker(list[index + 1], writing));
		const childText = writeOne(child, writing, previousItem, childMarker);
		if (childText === '') {
			return;
		}
		previousItem = followingListItem(childMarker, previousItem);
		children.push({ id: baseHalfNoteBlockId(child), kind: baseHalfNoteKindOf(child, childMarker), text: childText });
	});
	return children;
}

function writeListItem(block: unknown, writing: IWriting, marker: string): string {
	const type = baseHalfNoteBlockType(block);
	const props = baseHalfNoteBlockProps(block);
	const hint = writing.listHint(block);
	const width = marker.length + 1;
	const indent = ' '.repeat(childIndentOf(hint, width));
	const children = writeChildren(block, writing);
	let text = inline(contentOf(block), 'listItem', writing);
	if (text === '') {
		// An item without text holds a child that starts a block of its own on
		// the line under its marker (rule 31), and a blank line after the
		// marker would end the item. Any other child would be read as the
		// item's text there, so the item keeps a line of its own, as a check
		// item always does: its box is a box only with a space after it, which
		// the reader, and tools, drop at the end of a line (rule 23).
		const first = children[0];
		const lineUnder = first !== undefined && childTypesUnderAMarker.has(first.kind.type) && !loneDash.test(firstLine(first.text)) && (originalLineBreaks(hint, undefined, first) ?? 1) === 1;
		if (type === 'checkListItem' || (first !== undefined && !lineUnder)) {
			text = emptyItemText;
		}
	}
	let start = text ? `${marker} ` : marker;
	if (type === 'checkListItem') {
		start = `${marker} ${props.checked === true ? '[x]' : '[ ]'} `;
	}
	let written = joinLines(start + text, writing, indent);
	const itemText: IBaseHalfNoteWrittenBlock = { kind: { type: 'paragraph' }, text };
	let before: IWrittenChild | undefined;
	for (const current of children) {
		const original = originalLineBreaks(hint, before, current);
		let breaks: number;
		if (before) {
			breaks = Math.max(original ?? baseHalfNoteRequiredLineBreaks(before, current), baseHalfNoteFewestLineBreaks(before, current));
		} else if (text === '') {
			// What starts a block right under the marker of an item without text is its child.
			breaks = 1;
		} else if (isBaseHalfNoteListItemType(current.kind.type)) {
			// A list starts right under the item's text, where the reader starts
			// one at any marker, but a lone `-` there would make the text a
			// heading.
			breaks = Math.max(original ?? 1, loneDash.test(firstLine(current.text)) ? 2 : 1);
		} else {
			breaks = Math.max(original ?? 2, baseHalfNoteFewestLineBreaks(itemText, current));
		}
		written += writing.eol.repeat(breaks) + indentLines(current.text, indent);
		before = current;
	}
	return written;
}

// --- Toggles (rules 38 to 40)

function toggleHeader(block: unknown, writing: IWriting): string {
	const summary = inline(contentOf(block), 'html', writing);
	const level = headingLevel(baseHalfNoteBlockProps(block));
	const title = baseHalfNoteBlockType(block) === 'heading' ? `<h${level}>${summary}</h${level}>` : summary;
	return `<details${writing.isOpen(block as IBaseHalfNoteBlock) ? ' open' : ''}>${writing.eol}<summary>${title}</summary>`;
}

function writeToggle(block: unknown, writing: IWriting): string {
	const children = writeSequence(baseHalfNoteBlockChildren(block), writing, undefined);
	const { eol } = writing;
	return children === ''
		? `${toggleHeader(block, writing)}${eol}</details>`
		: `${toggleHeader(block, writing)}${eol}${eol}${children}${eol}${eol}</details>`;
}

// --- Other blocks

function headingLevel(props: Readonly<Record<string, unknown>>): number {
	const level = Number(props.level);
	return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1;
}

function writeHeading(block: unknown, writing: IWriting): string {
	const text = inline(contentOf(block), 'heading', writing);
	const hashes = '#'.repeat(headingLevel(baseHalfNoteBlockProps(block)));
	return text ? `${hashes} ${text}` : hashes;
}

function writeQuote(block: unknown, writing: IWriting): string {
	const text = inline(contentOf(block), 'quote', writing);
	return text === '' ? '>' : text.split('\n').map(line => line ? `> ${line}` : '>').join(writing.eol);
}

function codeText(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	return Array.isArray(content) ? content.map(run => isBaseHalfNoteRecord(run) && typeof run.text === 'string' ? run.text : '').join('') : '';
}

/**
 * A code block (rule 20): fenced with three backticks, or with one more than
 * the longest run of backticks that starts a line of the code after up to
 * three spaces, which would close a shorter fence. The language `text` is
 * not written, and the code is written as Rich holds it, tabs included.
 */
function writeCode(block: unknown, writing: IWriting): string {
	const code = codeText(contentOf(block)).replace(/\r\n?/g, '\n');
	const lines = code === '' ? [] : code.split('\n');
	// The renderers read the first word of a fence's info string as its language.
	let language = baseHalfNoteStringProp(baseHalfNoteBlockProps(block), 'language').trim().split(/\s/)[0];
	if (language === 'text') {
		language = '';
	}
	// A backtick fence takes no backtick in its info string; a tilde fence does.
	const character = language.includes('`') ? '~' : '`';
	const lineStartRun = character === '`' ? /^ {0,3}(`+)/ : /^ {0,3}(~+)/;
	let longest = 0;
	for (const line of lines) {
		longest = Math.max(longest, lineStartRun.exec(line)?.[1].length ?? 0);
	}
	const fence = character.repeat(Math.max(3, longest + 1));
	return [fence + language, ...lines, fence].join(writing.eol);
}

// Wide and full-width characters, which a monospaced font draws two columns wide.
const wideRanges: readonly (readonly [number, number])[] = [
	[0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
	[0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
	[0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
	[0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
	[0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
	[0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
	[0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x17000, 0x18cff],
	[0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f251],
	[0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x2fffd], [0x30000, 0x3fffd]
];
// Marks drawn over the character before them, variation selectors among them,
// and joiners, which take no column.
const zeroWidth = /^[\p{Mn}\p{Me}\u200b-\u200f\u2060]$/u;

function isWide(codePoint: number): boolean {
	let low = 0;
	let high = wideRanges.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const [first, last] = wideRanges[middle];
		if (codePoint < first) {
			high = middle - 1;
		} else if (codePoint > last) {
			low = middle + 1;
		} else {
			return true;
		}
	}
	return false;
}

/** The columns text takes in a monospaced font, a wide character counting two (rule 21). */
export function baseHalfNoteDisplayWidth(text: string): number {
	let width = 0;
	for (const character of text) {
		if (!zeroWidth.test(character)) {
			width += isWide(character.codePointAt(0) ?? 0) ? 2 : 1;
		}
	}
	return width;
}

/**
 * A pipe table (rule 21) whose first row is its header row: each column
 * padded to its widest cell, at least three columns, and its alignment in
 * the separator row. A line break in a cell is `<br>` and `|` is `\|`.
 */
function writeTable(block: unknown, writing: IWriting): string {
	const rows = baseHalfNoteTableRows(contentOf(block));
	let columns = 0;
	for (const row of rows) {
		columns = Math.max(columns, row.length);
	}
	if (columns === 0) {
		return '';
	}
	const alignments = baseHalfNoteColumnAlignments(rows);
	const texts = rows.map(row => Array.from({ length: columns }, (_, column) => column < row.length ? inline(baseHalfNoteCellContent(row[column]), 'tableCell', writing) : ''));
	const widths = Array.from({ length: columns }, (_, column) => {
		let width = 3;
		for (const cells of texts) {
			width = Math.max(width, baseHalfNoteDisplayWidth(cells[column]));
		}
		return width;
	});
	const row = (cells: readonly string[]) => `| ${cells.map((cell, column) => cell + ' '.repeat(widths[column] - baseHalfNoteDisplayWidth(cell))).join(' | ')} |`;
	const separator = `| ${widths.map((width, column) => {
		switch (alignments[column]) {
			case 'center': return `:${'-'.repeat(width - 2)}:`;
			case 'right': return `${'-'.repeat(width - 1)}:`;
			default: return '-'.repeat(width);
		}
	}).join(' | ')} |`;
	return [row(texts[0]), separator, ...texts.slice(1).map(row)].join(writing.eol);
}

/** A width of a picture or a video: a whole number of pixels from 1 to 99,999 (rule 28). */
function wholeWidth(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}
	const width = Math.round(value);
	return width >= 1 && width <= 99999 ? width : undefined;
}

function attribute(name: string, value: string): string {
	return ` ${name}="${escapeBaseHalfHtmlAttribute(value)}"`;
}

/** An element in `<figure>` with its caption, which is one line: the rich editor reads and shows a line break in a caption as a space (rule 16). */
function withCaption(element: string, caption: string): string {
	return caption ? `<figure>${element}<figcaption>${escapeBaseHalfHtmlText(caption.replace(/\r\n?|\n/g, ' '))}</figcaption></figure>` : element;
}

// A name that ends the text of a Markdown picture, escapes, or breaks its
// line is written in `<img>`: `marked` reads `\[` and `\]` in it as brackets
// and a backtick as the start of code, and keeps other backslashes in it.
const nameNeedsTag = /[[\]\\`\r\n\u2028\u2029]/;

/**
 * A picture (rule 22): `![name](address)`; `<img>` with a width, or with a
 * name Markdown cannot hold, or with an address that holds `|`, which the
 * card's renderer of a Markdown picture takes for the start of its width and
 * height; in `<figure>` with a caption. `alt` comes before `src`, as Rich
 * wrote figures before.
 */
function writeImage(props: Readonly<Record<string, unknown>>): string {
	const url = baseHalfNoteStringProp(props, 'url');
	if (!url) {
		return '';
	}
	const destination = baseHalfMarkdownDestination(url);
	const name = baseHalfNoteStringProp(props, 'name');
	const caption = baseHalfNoteStringProp(props, 'caption');
	const width = wholeWidth(props.previewWidth);
	if (!caption && width === undefined && !nameNeedsTag.test(name) && !destination.includes('|')) {
		// The reader decodes a character reference in the name once, as a page does.
		return `![${name.replace(/&(?=#?\w+;)/g, '&amp;')}](${destination})`;
	}
	const element = `<img${name ? attribute('alt', name) : ''}${attribute('src', destination)}${width !== undefined ? ` width="${width}"` : ''}>`;
	return withCaption(element, caption);
}

/** A video or a sound, in the element's own controls; a video with its width. Their names are not stored. */
function writePlayer(tag: 'video' | 'audio', props: Readonly<Record<string, unknown>>): string {
	const url = baseHalfNoteStringProp(props, 'url');
	if (!url) {
		return '';
	}
	const width = tag === 'video' ? wholeWidth(props.previewWidth) : undefined;
	const element = `<${tag}${attribute('src', baseHalfMarkdownDestination(url))}${width !== undefined ? ` width="${width}"` : ''} controls></${tag}>`;
	return withCaption(element, baseHalfNoteStringProp(props, 'caption'));
}

function lastSegment(url: string): string {
	const path = url.split(/[?#]/, 1)[0];
	const segment = path.slice(path.lastIndexOf('/') + 1);
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** A file: a link on a line of its own, named by the file's name or the last part of its address, and never a bare address (rule 12). */
function writeFile(props: Readonly<Record<string, unknown>>, writing: IWriting): string {
	const url = baseHalfNoteStringProp(props, 'url');
	if (!url) {
		return '';
	}
	const label = baseHalfNoteStringProp(props, 'name') || lastSegment(url) || url;
	const written = inline([{ type: 'link', href: url, content: [{ type: 'text', text: label }] }], 'paragraph', writing);
	if (written.startsWith('[')) {
		return joinLines(written, writing);
	}
	// A web address named as itself would be written bare.
	return `[${escapeBaseHalfMarkdownText(label, { inLink: true, lineStart: false, before: '[', after: ']' })}](${baseHalfMarkdownDestination(url)})`;
}

/** A fixed block keeps its bytes (rule 35). Without a place of its own in the file, as when it was pasted, it is its text without what stood around it. */
function fixedText(props: Readonly<Record<string, unknown>>): string {
	if (typeof props.source === 'string') {
		return props.source;
	}
	return typeof props.raw === 'string' ? props.raw.replace(/^(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+$/g, '') : '';
}

// --- Blocks

/** The blocks, each followed by the blocks it holds when it may hold none (rule 66), so that nothing it holds is lost. */
function* expanded(blocks: readonly unknown[]): Iterable<unknown> {
	for (const block of blocks) {
		yield block;
		if (!baseHalfNoteMayHold(block)) {
			const children = baseHalfNoteBlockChildren(block);
			if (children.length > 0) {
				yield* expanded(children);
			}
		}
	}
}

/** One block with what it may hold, or `''` when it stores nothing. `marker` is the marker of a list item. */
function writeOne(block: unknown, writing: IWriting, previous: IBaseHalfNotePreviousListItem | undefined, marker = markerOf(block, writing, previous)): string {
	const type = baseHalfNoteBlockType(block);
	const props = baseHalfNoteBlockProps(block);
	switch (type) {
		case 'paragraph':
			return joinLines(inline(contentOf(block), 'paragraph', writing), writing);
		case 'heading':
			return isBaseHalfNoteToggle(block) ? writeToggle(block, writing) : writeHeading(block, writing);
		case 'quote':
			return writeQuote(block, writing);
		case 'bulletListItem':
		case 'numberedListItem':
		case 'checkListItem':
			return writeListItem(block, writing, marker ?? '-');
		case 'toggleListItem':
			return writeToggle(block, writing);
		case 'codeBlock':
			return writeCode(block, writing);
		case 'divider':
			return '---';
		case 'table':
			return writeTable(block, writing);
		case 'image':
			return writeImage(props);
		case 'video':
			return writePlayer('video', props);
		case 'audio':
			return writePlayer('audio', props);
		case 'file':
			return writeFile(props, writing);
		case BASEHALF_NOTE_FIXED_BLOCK_TYPE:
			return fixedText(props);
	}
	// A block of another type keeps its text.
	const content = contentOf(block);
	return Array.isArray(content) || typeof content === 'string' ? joinLines(inline(content, 'paragraph', writing), writing) : '';
}

/** Blocks of one container, a line break or a blank line apart (rule 67). */
function writeSequence(blocks: readonly unknown[], writing: IWriting, previous: IBaseHalfNotePreviousListItem | undefined, next?: string): string {
	let written = '';
	let before: IBaseHalfNoteWrittenBlock | undefined;
	let previousItem = previous;
	const list = [...expanded(blocks)];
	list.forEach((block, index) => {
		const marker = markerOf(block, writing, previousItem, index + 1 < list.length ? writtenMarker(list[index + 1], writing) : next);
		const text = writeOne(block, writing, previousItem, marker);
		if (text === '') {
			return;
		}
		previousItem = followingListItem(marker, previousItem);
		const current: IBaseHalfNoteWrittenBlock = { kind: baseHalfNoteKindOf(block, marker), text };
		if (before) {
			written += writing.eol.repeat(baseHalfNoteRequiredLineBreaks(before, current));
		}
		written += text;
		before = current;
	});
	return written;
}

/**
 * A block as the note stores it (note formats, rules 10 to 24 and 38 to 39),
 * with the blocks it holds, its lines ended by `hints.eol` and without a
 * line break at its end; `''` for a block that stores nothing: a picture, a
 * video, a sound, or a file without an address, and an empty paragraph
 * (rule 23). A block that may hold no blocks (rule 62) is followed by those
 * it holds. A fixed block is its bytes.
 */
export function writeBaseHalfNoteBlock(block: unknown, hints: IBaseHalfNoteWriteHints = {}): string {
	const writing = writingOf(hints);
	if (!baseHalfNoteMayHold(block) && baseHalfNoteBlockChildren(block).length > 0) {
		return writeSequence([block], writing, hints.previousListItem, hints.nextListItem?.marker);
	}
	return writeOne(block, writing, hints.previousListItem, markerOf(block, writing, hints.previousListItem, hints.nextListItem?.marker));
}

/**
 * Blocks of one container as the note stores them, each pair with the line
 * breaks Markdown needs between them (rule 67): one between two items of
 * the same list, else a blank line. Blocks that store nothing are left out.
 */
export function writeBaseHalfNoteBlocks(blocks: readonly unknown[], hints: IBaseHalfNoteWriteHints = {}): string {
	return writeSequence(blocks, writingOf(hints), hints.previousListItem, hints.nextListItem?.marker);
}

/**
 * The first lines of a toggle (rule 38): `<details>`, or `<details open>`
 * for one stored open, and its title in `<summary>`, a toggle heading's in
 * its heading element. `''` for a block that is no toggle.
 */
export function writeBaseHalfToggleHeader(block: unknown, hints: IBaseHalfNoteWriteHints = {}): string {
	return isBaseHalfNoteToggle(block) ? toggleHeader(block, writingOf(hints)) : '';
}

/** The marker the writer gives a list item with `hints` (rule 19), or none for a block that is no list item. */
export function baseHalfNoteListItemMarker(block: unknown, hints: IBaseHalfNoteWriteHints = {}): string | undefined {
	return markerOf(block, writingOf(hints), hints.previousListItem, hints.nextListItem?.marker);
}

/** The kind of a block as the writer writes it with `hints`, its marker included. */
export function baseHalfNoteBlockKind(block: unknown, hints: IBaseHalfNoteWriteHints = {}): IBaseHalfNoteBlockKind {
	return baseHalfNoteKindOf(block, baseHalfNoteListItemMarker(block, hints));
}

/**
 * What the block after `block` in its container gets as `previousListItem`
 * when `block`, written with `hints`, stores anything: `block` itself when it
 * is a list item, else none.
 */
export function baseHalfNoteFollowingListItem(block: unknown, hints: IBaseHalfNoteWriteHints = {}): IBaseHalfNotePreviousListItem | undefined {
	return followingListItem(baseHalfNoteListItemMarker(block, hints), hints.previousListItem);
}

// --- Line breaks between blocks (rule 67)

// What the last line of a block lets follow on the next line.
type BlockEnd = 'closed' | 'html' | 'paragraph' | 'quote' | 'list' | 'table';

function endOf(block: IBaseHalfNoteWrittenBlock): BlockEnd {
	const { kind, text } = block;
	if (kind.toggle) {
		return 'html';
	}
	switch (kind.type) {
		case 'heading':
		case 'codeBlock':
		case 'divider':
			return 'closed';
		case 'paragraph':
		case 'file':
			return 'paragraph';
		case 'image':
		case 'video':
		case 'audio':
			// `<img>` alone and `<figure>` are blocks of HTML, which go on to a
			// blank line; a Markdown picture and a player are text.
			return /^<(?:img|figure)\b/i.test(text) ? 'html' : 'paragraph';
		case 'quote':
			return 'quote';
		case 'table':
			return 'table';
	}
	if (!isBaseHalfNoteListItemType(kind.type)) {
		// A fixed block may end in anything.
		return 'html';
	}
	// An item that is its marker alone holds no text that a line could go on.
	return /^(?:[-*+]|\d{1,9}[.)])$/.test(text) ? 'closed' : 'list';
}

const headingOrFence = /^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,})/;
const blockOfHtml = /^<(?:details|figure)[\s>]/i;
// A list item that can cut a paragraph short: one that holds text, and a numbered one from 1.
const itemAfterText = /^(?:[-*+]|1[.)])[ \t]+\S/;

/**
 * The fewest line breaks after `previous` that keep `next` a block of its
 * own, for blocks as Rich writes them: one where the first line of `next`
 * ends what `previous` would go on with, as a heading, a fence, or a list
 * item does after text, else two. A setext underline, a lazy line of a
 * paragraph or a quote, and a line in a block of HTML are what one line
 * break would make of `next`.
 */
export function baseHalfNoteFewestLineBreaks(previous: IBaseHalfNoteWrittenBlock, next: IBaseHalfNoteWrittenBlock): number {
	const end = endOf(previous);
	if (end === 'closed') {
		return 1;
	}
	if (end === 'html') {
		return 2;
	}
	const line = firstLine(next.text);
	const type = next.kind.type;
	const item = isBaseHalfNoteListItemType(type);
	if (headingOrFence.test(line)) {
		return 1;
	}
	switch (end) {
		case 'list':
			return item || type === 'divider' ? 1 : 2;
		case 'paragraph':
			return line.startsWith('>') || blockOfHtml.test(line) || type === 'table' || (item && itemAfterText.test(line)) ? 1 : 2;
		case 'quote':
			return type === 'divider' || blockOfHtml.test(line) || (item && itemAfterText.test(line)) ? 1 : 2;
		default:
			return line.startsWith('>') || type === 'divider' || blockOfHtml.test(line) || (item && itemAfterText.test(line)) ? 1 : 2;
	}
}

/**
 * The line breaks Markdown needs between two blocks that were not
 * neighbours of the same kinds in the file (rule 67): one between two items
 * of the same list, the same marker character or delimiter, else a blank
 * line.
 */
export function baseHalfNoteRequiredLineBreaks(previous: IBaseHalfNoteWrittenBlock, next: IBaseHalfNoteWrittenBlock): number {
	const sameList = isBaseHalfNoteListItemType(previous.kind.type) && isBaseHalfNoteListItemType(next.kind.type) && previous.kind.marker === next.kind.marker;
	return Math.max(sameList ? 1 : 2, baseHalfNoteFewestLineBreaks(previous, next));
}
