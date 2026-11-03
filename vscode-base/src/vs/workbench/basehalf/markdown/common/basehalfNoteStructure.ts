/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import {
	baseHalfNoteBlockChildren,
	baseHalfNoteBlockProps,
	baseHalfNoteBlockType,
	baseHalfNoteColumnAlignments,
	baseHalfNoteKindOf,
	baseHalfNoteStringProp,
	baseHalfNoteTableRows,
	IBaseHalfNoteBlock,
	IBaseHalfNoteListHint,
	isBaseHalfNoteListItemType,
	isBaseHalfNoteRecord,
	isBaseHalfNoteToggle
} from './basehalfNoteBlocks.js';
import { baseHalfNoteMediaKind } from './basehalfNoteMediaKind.js';
import { baseHalfNotePaletteAlias, BaseHalfNotePaletteColor, BaseHalfNotePaletteRole, isBaseHalfNotePaletteColor } from './basehalfNotePalette.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports only its siblings, the Markdown
// parser, and, through the media kind, the one list of media files.
//
// The shape of a note's blocks (note formats, rules 58 to 66): which block
// may hold which, the shape of a table, and the reader's block pass, which
// gives the blocks read from a file what the file says of them beyond the
// editor's schema: whether a toggle is stored open, how each list item was
// written, and the tabs of code.

// --- Nesting (rule 62)

const holdingTypes: ReadonlySet<string> = new Set(['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']);

/**
 * Whether a block may hold other blocks (note formats, rule 62): a bullet, a
 * numbered, and a check item and a toggle hold blocks of any kind, and no
 * other block holds children. Markdown indents a list item's children under
 * it and writes a toggle's between its tags; it has no form for children of
 * any other block.
 */
export function baseHalfNoteMayHold(parent: unknown): boolean {
	return holdingTypes.has(baseHalfNoteBlockType(parent)) || isBaseHalfNoteToggle(parent);
}

/**
 * Children under a block that may not hold them move out after it, in their
 * order (note formats, rule 66). The order of all blocks, read from the
 * first to the last, stays as it was.
 */
function liftChildren(blocks: readonly unknown[]): Readonly<Record<string, unknown>>[] {
	const lifted: Readonly<Record<string, unknown>>[] = [];
	for (const block of blocks) {
		if (!isBaseHalfNoteRecord(block) || typeof block.type !== 'string') {
			continue;
		}
		const children = baseHalfNoteBlockChildren(block);
		if (children.length === 0) {
			lifted.push(block);
		} else if (baseHalfNoteMayHold(block)) {
			lifted.push({ ...block, children: liftChildren(children) });
		} else {
			lifted.push({ ...block, children: [] });
			lifted.push(...liftChildren(children));
		}
	}
	return lifted;
}

// --- Props a note does not keep (design C1)

const formatProps = Object.freeze(['textColor', 'backgroundColor', 'textAlignment']);

/**
 * The props of the editor's blocks that a note has no form for, which Rich's
 * schema leaves out (note formats, rules 2, 3, and 60): colors and alignment
 * of text blocks, the background and alignment of a picture and a video, the
 * background of a sound, and the background and caption of a file.
 */
export const BASEHALF_NOTE_REMOVED_PROPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	paragraph: formatProps,
	heading: formatProps,
	quote: formatProps,
	bulletListItem: formatProps,
	numberedListItem: formatProps,
	checkListItem: formatProps,
	toggleListItem: formatProps,
	image: Object.freeze(['backgroundColor', 'textAlignment']),
	video: Object.freeze(['backgroundColor', 'textAlignment']),
	audio: Object.freeze(['backgroundColor']),
	file: Object.freeze(['backgroundColor', 'caption'])
});

// --- Colors of text (rules 29 and 72)

const colorStyles: readonly (readonly [string, BaseHalfNotePaletteRole])[] = [['textColor', 'text'], ['backgroundColor', 'background']];

function paletteColor(role: BaseHalfNotePaletteRole, value: unknown): BaseHalfNotePaletteColor | undefined {
	if (isBaseHalfNotePaletteColor(value)) {
		return value;
	}
	return typeof value === 'string' ? baseHalfNotePaletteAlias(role, value) : undefined;
}

/** A run of text whose colors are palette names: an alias of one is its name, and any other color goes. */
function withPaletteColors(run: unknown): unknown {
	if (!isBaseHalfNoteRecord(run) || !isBaseHalfNoteRecord(run.styles)) {
		return run;
	}
	let styles: Record<string, unknown> | undefined;
	for (const [style, role] of colorStyles) {
		if (run.styles[style] === undefined) {
			continue;
		}
		const color = paletteColor(role, run.styles[style]);
		if (color !== run.styles[style]) {
			styles ??= { ...run.styles };
			if (color === undefined) {
				delete styles[style];
			} else {
				styles[style] = color;
			}
		}
	}
	return styles ? { ...run, styles } : run;
}

function inlineWithPaletteColors(content: unknown): unknown {
	if (!Array.isArray(content)) {
		return content;
	}
	return content.map(item => isBaseHalfNoteRecord(item) && item.type === 'link' && Array.isArray(item.content)
		? { ...item, content: item.content.map(withPaletteColors) }
		: withPaletteColors(item));
}

// --- Tables (rules 58 to 60)

const coveredCell = Object.freeze({ covered: true });

function span(cell: unknown, name: 'colspan' | 'rowspan'): number {
	const value = isBaseHalfNoteRecord(cell) && isBaseHalfNoteRecord(cell.props) ? cell.props[name] : undefined;
	// A span past this many cells is no table a note holds.
	return typeof value === 'number' && Number.isInteger(value) && value > 1 ? Math.min(value, 1000) : 1;
}

/**
 * A table in the shape a note keeps (note formats, rules 58 to 60): its first
 * row is its one header row; a merged cell is split, its content kept in its
 * first cell; a header column is an ordinary column; widths of columns and
 * colors of cells go; and every cell of a column has the column's alignment,
 * that of the column's first cell that is not left.
 */
export function shapeBaseHalfNoteTable(content: unknown): unknown {
	if (!isBaseHalfNoteRecord(content) || !Array.isArray(content.rows)) {
		return content;
	}
	const rows = baseHalfNoteTableRows(content);
	const grid: unknown[][] = rows.map(() => []);
	rows.forEach((cells, row) => {
		let column = 0;
		for (const cell of cells) {
			while (grid[row][column] !== undefined) {
				column++;
			}
			const columns = span(cell, 'colspan');
			const rowsSpanned = span(cell, 'rowspan');
			for (let down = 0; down < rowsSpanned && row + down < grid.length; down++) {
				for (let across = 0; across < columns; across++) {
					grid[row + down][column + across] ??= coveredCell;
				}
			}
			grid[row][column] = cell;
			column += columns;
		}
	});
	let columns = 0;
	for (const cells of grid) {
		columns = Math.max(columns, cells.length);
	}
	const placed = grid.map(cells => Array.from({ length: columns }, (_, column) => cells[column] === coveredCell ? undefined : cells[column]));
	const alignments = baseHalfNoteColumnAlignments(placed);
	const shapedRows = placed.map(cells => ({
		cells: cells.map((cell, column) => {
			const props = isBaseHalfNoteRecord(cell) && isBaseHalfNoteRecord(cell.props) ? cell.props : {};
			return {
				type: 'tableCell',
				props: { ...props, backgroundColor: 'default', textColor: 'default', textAlignment: alignments[column], colspan: 1, rowspan: 1 },
				content: inlineWithPaletteColors(isBaseHalfNoteRecord(cell) ? cell.content ?? [] : Array.isArray(cell) ? cell : [])
			};
		})
	}));
	const shaped: Record<string, unknown> = {
		...content,
		type: 'tableContent',
		columnWidths: Array.from({ length: columns }, () => undefined),
		headerRows: 1,
		rows: shapedRows
	};
	delete shaped.headerCols;
	return shaped;
}

// --- The reader's block pass (design B1, step 5)

/**
 * What the block pass reads: a note's Markdown (at load, at a change made
 * outside Rich, and in a paste of Markdown), or HTML pasted or dropped from
 * another application.
 */
export type BaseHalfNoteReadMode = 'markdown' | 'paste' | 'drop';

export interface IBaseHalfNoteBlockPassOptions {
	/** Default: Markdown. */
	readonly mode?: BaseHalfNoteReadMode;
	/**
	 * Whether each `<details>` of what was read is open, in the order of the
	 * document, as the reader's HTML repair finds them. They go to the
	 * toggles, read first to last, when there are as many of each; else no
	 * toggle gets one, and whatever flags the blocks had go.
	 */
	readonly openFlags?: readonly boolean[];
	/**
	 * The hints of the list items of what was read, in the order of the
	 * document, from `baseHalfNoteListHints`. They go to the list items in the
	 * same way.
	 */
	readonly listHints?: readonly IBaseHalfNoteListHint[];
	/** The Markdown that was read, so that its code keeps its tabs (`restoreBaseHalfCodeTabs`). */
	readonly source?: string;
}

interface IBlockPass {
	readonly mode: BaseHalfNoteReadMode;
	readonly openFlags: readonly boolean[] | undefined | null;
	readonly listHints: readonly IBaseHalfNoteListHint[] | undefined | null;
	toggles: number;
	listItems: number;
}

function countInOrder(blocks: readonly Readonly<Record<string, unknown>>[], counts: { toggles: number; listItems: number }): void {
	for (const block of blocks) {
		if (isBaseHalfNoteToggle(block)) {
			counts.toggles++;
		}
		if (isBaseHalfNoteListItemType(baseHalfNoteBlockType(block))) {
			counts.listItems++;
		}
		countInOrder(baseHalfNoteBlockChildren(block) as Readonly<Record<string, unknown>>[], counts);
	}
}

/** A whole number of pixels from 1 to 99,999 (rule 28), or none. */
function wholeWidth(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}
	const width = Math.round(value);
	return width >= 1 && width <= 99999 ? width : undefined;
}

function mediaType(type: string, props: Readonly<Record<string, unknown>>, mode: BaseHalfNoteReadMode): string {
	// A note's Markdown already shows a picture of a video or a sound as that
	// video or sound; a hand-written `<img>` of one stays a picture, as the
	// card shows it. Pasted HTML takes the kind of its address.
	if (mode === 'markdown' || (type !== 'image' && type !== 'video')) {
		return type;
	}
	const kind = baseHalfNoteMediaKind(baseHalfNoteStringProp(props, 'url'));
	return kind === 'audio' || (kind === 'video' && type === 'image') ? kind : type;
}

function listHintOf(hint: IBaseHalfNoteListHint, children: readonly IBaseHalfNoteBlock[]): IBaseHalfNoteListHint {
	const own: IBaseHalfNoteListHint = { marker: hint.marker, ...(hint.childIndent !== undefined ? { childIndent: hint.childIndent } : {}) };
	const ids = children.map(child => child.id);
	if (!hint.separators || hint.separators.length !== children.length || children.length === 0 || ids.some(id => id === undefined)) {
		return own;
	}
	return {
		...own,
		separators: hint.separators,
		children: ids as string[],
		kinds: children.map(child => baseHalfNoteKindOf(child, child.basehalfHints?.marker))
	};
}

// --- Files (rules 12 and 72)

/**
 * Whether a link's address is a file that a file block stands for: a path
 * from the note's folder to a file with an extension that is no note's.
 */
export function isBaseHalfNoteFileAddress(href: string): boolean {
	if (!href || href.startsWith('/') || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
		return false;
	}
	const path = href.split(/[?#]/, 1)[0];
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
	return extension !== '' && extension !== '.md' && extension !== '.markdown';
}

function hasFormat(run: unknown): boolean {
	if (!isBaseHalfNoteRecord(run) || !isBaseHalfNoteRecord(run.styles)) {
		return false;
	}
	return Object.entries(run.styles).some(([style, value]) => style === 'textColor' || style === 'backgroundColor' ? typeof value === 'string' && value !== 'default' : value === true);
}

function decodedLastSegment(href: string): string {
	const path = href.split(/[?#]/, 1)[0];
	const segment = path.slice(path.lastIndexOf('/') + 1);
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/**
 * A paragraph that is one link to a file, with nothing but white space
 * around it and no format in it, is the file block that a note stores so
 * (rule 12), at any depth: named by the link's text as the editor read it,
 * else by the last part of its address. A link with formats stays a link,
 * and so does a link to a note or a web address.
 */
function fileOfParagraph(block: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
	if (block.type !== 'paragraph' || !Array.isArray(block.content) || baseHalfNoteBlockChildren(block).length > 0) {
		return undefined;
	}
	const shown = block.content.filter(item => !(isBaseHalfNoteRecord(item) && item.type === 'text' && typeof item.text === 'string' && item.text.trim() === ''));
	const link = shown.length === 1 ? shown[0] : undefined;
	if (!isBaseHalfNoteRecord(link) || link.type !== 'link' || typeof link.href !== 'string' || !isBaseHalfNoteFileAddress(link.href)) {
		return undefined;
	}
	const runs: readonly unknown[] = Array.isArray(link.content) ? link.content : [link.content];
	if (runs.some(hasFormat)) {
		return undefined;
	}
	const name = runs.map(run => typeof run === 'string' ? run : isBaseHalfNoteRecord(run) && typeof run.text === 'string' ? run.text : '').join('');
	const file: Record<string, unknown> = { ...block, type: 'file', props: { name: name || decodedLastSegment(link.href), url: link.href }, children: [] };
	delete file.content;
	return file;
}

function passBlock(read: Readonly<Record<string, unknown>>, pass: IBlockPass): IBaseHalfNoteBlock {
	// What another application drops keeps its links: a file block comes of a note's Markdown and of a paste.
	const block = pass.mode === 'drop' ? read : fileOfParagraph(read) ?? read;
	const toggle = isBaseHalfNoteToggle(block) ? pass.toggles++ : -1;
	const listItem = isBaseHalfNoteListItemType(baseHalfNoteBlockType(block)) ? pass.listItems++ : -1;
	const oldProps = baseHalfNoteBlockProps(block);
	const type = mediaType(block.type as string, oldProps, pass.mode);
	const props: Record<string, unknown> = { ...oldProps };
	for (const name of BASEHALF_NOTE_REMOVED_PROPS[type] ?? []) {
		delete props[name];
	}
	if (type === 'image' || type === 'video' || type === 'audio') {
		// A picture, a video, and a sound always show themselves (rule 3).
		props.showPreview = true;
		const width = type === 'audio' ? undefined : wholeWidth(props.previewWidth);
		if (width === undefined) {
			delete props.previewWidth;
		} else {
			props.previewWidth = width;
		}
		if (type === 'audio') {
			delete props.textAlignment;
		}
	}
	if (type === 'table' && props.textColor !== undefined) {
		props.textColor = 'default';
	}
	const children = passBlocks(baseHalfNoteBlockChildren(block) as Readonly<Record<string, unknown>>[], pass);
	const passed: Record<string, unknown> = { ...block, type, props, children };
	if (type === 'table') {
		passed.content = shapeBaseHalfNoteTable(block.content);
	} else if (Array.isArray(block.content)) {
		passed.content = inlineWithPaletteColors(block.content);
	}
	if (toggle !== -1 && pass.openFlags !== undefined) {
		if (pass.openFlags) {
			passed.basehalfOpen = pass.openFlags[toggle];
		} else {
			delete passed.basehalfOpen;
		}
	}
	if (listItem !== -1 && pass.listHints !== undefined) {
		if (pass.listHints) {
			passed.basehalfHints = listHintOf(pass.listHints[listItem], children);
		} else {
			delete passed.basehalfHints;
		}
	}
	return passed as unknown as IBaseHalfNoteBlock;
}

const numberedHintMarker = /^(\d{1,9})[.)]$/;

/**
 * Blocks of one container through the pass. A numbered item that starts a
 * run shows the number the file starts its list at: the editor reads no
 * start for an item whose text a list follows right under it, as in
 * `4. four` with a line `   - sub` after it.
 */
function passBlocks(blocks: readonly Readonly<Record<string, unknown>>[], pass: IBlockPass): IBaseHalfNoteBlock[] {
	const passed = blocks.map(block => passBlock(block, pass));
	passed.forEach((block, index) => {
		const number = block.type === 'numberedListItem' ? numberedHintMarker.exec(block.basehalfHints?.marker ?? '') : null;
		if (!number || passed[index - 1]?.type === 'numberedListItem') {
			return;
		}
		// The props are the pass's own copy.
		const props = block.props as Record<string, unknown>;
		const start = Number(number[1]);
		if (start > 1) {
			props.start = start;
		} else if (start === 1) {
			delete props.start;
		}
	});
	return passed;
}

/**
 * The reader's pass over the blocks it read (design B1, step 5), pure:
 *
 * - children under a block that may not hold them move out after it, in
 *   their order (rule 66);
 * - pasted and dropped pictures and videos take the kind of their address by
 *   the one list of media files (rule 26), a picture, a video, and a sound
 *   always show themselves, and a width is a whole number of pixels from 1
 *   to 99,999 or none (rule 28);
 * - a color of text is a palette name: an alias of a palette color is its
 *   name, and any other color goes (rules 29 and 72);
 * - props a note does not keep go (`BASEHALF_NOTE_REMOVED_PROPS`), and a
 *   table takes the shape of `shapeBaseHalfNoteTable`;
 * - (`markdown`, `paste`) a paragraph that is one link to a file, without
 *   formats, is a file block, at any depth (rule 12);
 * - each toggle gets whether the file stores it open (`basehalfOpen`), and
 *   each list item how the file wrote it (`basehalfHints`), with the ids and
 *   kinds of its children, when the file's toggles and list items, read
 *   first to last, are as many as the blocks';
 * - code gets back the tabs of `options.source` (rule 32).
 *
 * `basehalfOpen` and `basehalfHints` are no props of the editor's schema;
 * `stripBaseHalfNoteReadHints` takes them off.
 */
export function postProcessBaseHalfNoteBlocks(blocks: readonly unknown[], options: IBaseHalfNoteBlockPassOptions = {}): IBaseHalfNoteBlock[] {
	const lifted = liftChildren(blocks);
	const counts = { toggles: 0, listItems: 0 };
	countInOrder(lifted, counts);
	const pass: IBlockPass = {
		mode: options.mode ?? 'markdown',
		// `null`: given, but not as many as the blocks, so none is used.
		openFlags: options.openFlags === undefined ? undefined : options.openFlags.length === counts.toggles ? options.openFlags : null,
		listHints: options.listHints === undefined ? undefined : options.listHints.length === counts.listItems ? options.listHints : null,
		toggles: 0,
		listItems: 0
	};
	const passed = passBlocks(lifted, pass);
	return options.source === undefined ? passed : restoreBaseHalfCodeTabs(passed, options.source);
}

/** The blocks without what the block pass learned of the file, which the editor's schema does not hold. */
export function stripBaseHalfNoteReadHints<T>(blocks: readonly T[]): T[] {
	return blocks.map(block => {
		if (!isBaseHalfNoteRecord(block)) {
			return block;
		}
		const { basehalfOpen, basehalfHints, ...rest } = block;
		const children = baseHalfNoteBlockChildren(block);
		if (basehalfOpen === undefined && basehalfHints === undefined && children.length === 0) {
			return block;
		}
		return (children.length > 0 ? { ...rest, children: stripBaseHalfNoteReadHints(children) } : rest) as T;
	});
}

// --- Hints from the file's lists (design 4.2)

const markerAtStart = /^ *([*+-]|\d{1,9}[.)])/;

function lineBreaks(text: string): number {
	let count = 0;
	for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
		count++;
	}
	return count;
}

function trailingLineBreaks(text: string): number {
	return lineBreaks(/\s*$/.exec(text)?.[0] ?? '');
}

function leadingSpaces(line: string): number {
	return /^ */.exec(line)?.[0].length ?? 0;
}

/** How many more `<details>` the HTML opens than it closes. */
function detailsDepth(html: string): number {
	const withoutComments = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
	return (withoutComments.match(/<details(?=[\s>/])/gi)?.length ?? 0) - (withoutComments.match(/<\/details\s*>/gi)?.length ?? 0);
}

function listItemHint(item: Tokens.ListItem): IBaseHalfNoteListHint {
	const marker = markerAtStart.exec(item.raw)?.[1] ?? '-';
	const tokens = item.tokens;
	// The item's own text is its first paragraph; what follows it are its children.
	let next = 0;
	let ownLines = 0;
	let breaks = 0;
	const first = tokens[0];
	if (first && (first.type === 'text' || first.type === 'paragraph')) {
		ownLines = (first as Tokens.Text).text.split('\n').length;
		breaks = trailingLineBreaks(first.raw);
		next = 1;
	}
	const separators: number[] = [];
	let firstChildLine: number | undefined;
	for (let index = next; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.type === 'space') {
			breaks += lineBreaks(token.raw);
			continue;
		}
		firstChildLine ??= Math.max(0, ownLines - 1) + breaks;
		if (token.type === 'list') {
			// Each item of a list is a child of its own; a list's items are a line or a blank line apart.
			const items = (token as Tokens.List).items;
			items.forEach((_, at) => separators.push(at === 0 ? breaks : trailingLineBreaks(items[at - 1].raw)));
			breaks = trailingLineBreaks(token.raw);
			continue;
		}
		separators.push(breaks);
		// A toggle is one child, from its `<details>` to the `</details>` that closes it.
		let last = token;
		let depth = token.type === 'html' ? detailsDepth(token.raw) : 0;
		while (depth > 0 && index + 1 < tokens.length) {
			last = tokens[++index];
			if (last.type === 'html') {
				depth += detailsDepth(last.raw);
			}
		}
		breaks = trailingLineBreaks(last.raw);
	}
	const lines = item.raw.split('\n');
	const childIndent = firstChildLine !== undefined && firstChildLine < lines.length ? leadingSpaces(lines[firstChildLine]) - leadingSpaces(lines[0]) : 0;
	return {
		marker,
		...(childIndent > 0 ? { childIndent } : {}),
		...(separators.length > 0 ? { separators: separators.map(count => '\n'.repeat(Math.max(1, count))) } : {})
	};
}

/**
 * What the file wrote of each list item in `tokens`, `marked`'s block tokens
 * of a segment, in the order of the document, each item before the items it
 * holds (design 4.2): its marker as written, the indentation of its children,
 * and the line breaks before each child. A list in a quote is not counted:
 * the rich editor reads no list item out of a quote.
 */
export function baseHalfNoteListHints(tokens: readonly Token[]): IBaseHalfNoteListHint[] {
	const hints: IBaseHalfNoteListHint[] = [];
	const visit = (blockTokens: readonly Token[]) => {
		for (const token of blockTokens) {
			if (token.type === 'list') {
				for (const item of (token as Tokens.List).items) {
					hints.push(listItemHint(item));
					visit(item.tokens);
				}
			}
		}
	};
	visit(tokens);
	return hints;
}

// --- Tabs in code (rule 32)

/** A line as `marked` reads it: the tabs that follow its leading spaces are four spaces each. */
function expandLeadingTabs(line: string): string {
	return line.replace(/^( *)(\t+)/, (_, spaces: string, tabs: string) => spaces + '    '.repeat(tabs.length));
}

/**
 * The line of the file a code line was read from, less the `removed`
 * columns of indentation that the code's container took: with its tabs, or
 * as the code line where those columns end inside a tab (note formats, L19).
 */
function restoredLine(original: string, expanded: string, removed: number, code: string): string {
	if (original === expanded) {
		return code;
	}
	const spaces = leadingSpaces(original);
	const tabs = /^\t*/.exec(original.slice(spaces))?.[0].length ?? 0;
	let restored: string;
	if (removed <= spaces) {
		restored = original.slice(removed);
	} else if ((removed - spaces) % 4 === 0 && removed - spaces <= 4 * tabs) {
		restored = '\t'.repeat(tabs - (removed - spaces) / 4) + original.slice(spaces + tabs);
	} else {
		return code;
	}
	return expandLeadingTabs(restored) === code ? restored : code;
}

// The markers of quotes and list items that a line may start with.
const containerMarkers = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$))*[ \t]*/;

/**
 * Whether code can start on the line after `line`: after the fence that
 * opens it, or, for indented code, which cannot go on from a paragraph, after
 * a blank line, a heading, or a rule. A line of text before it is a
 * paragraph's, whose lines are no code even where they look like it.
 */
function opensCode(line: string): boolean {
	const rest = line.replace(containerMarkers, '');
	return rest === '' || /^(?:`{3,}|~{3,})/.test(rest) || /^#{1,6}(?:[ \t]|$)/.test(rest) || /^(?:(?:[-*_])[ \t]*){3,}$/.test(rest) || /^=+[ \t]*$/.test(rest);
}

/** The code with the tabs of the lines of the file it was read from, found from line `from` on. */
function findCodeLines(code: string, original: readonly string[], expanded: readonly string[], from: number): { readonly text: string; readonly end: number } | undefined {
	const lines = code.split('\n');
	const anchor = lines.findIndex(line => line.trim() !== '');
	if (anchor === -1) {
		return undefined;
	}
	for (let start = from; start + lines.length <= original.length; start++) {
		if (start > 0 && !opensCode(expanded[start - 1])) {
			continue;
		}
		const anchorLine = expanded[start + anchor];
		const indent = anchorLine.length - lines[anchor].length;
		if (indent < 0 || !anchorLine.endsWith(lines[anchor]) || leadingSpaces(anchorLine) < indent) {
			continue;
		}
		const restored: string[] = [];
		for (let index = 0; index < lines.length; index++) {
			const line = expanded[start + index];
			const removed = line.length - lines[index].length;
			if (removed < 0 || removed > indent || !line.endsWith(lines[index]) || leadingSpaces(line) < removed) {
				break;
			}
			restored.push(restoredLine(original[start + index], line, removed, lines[index]));
		}
		if (restored.length === lines.length) {
			return { text: restored.join('\n'), end: start + lines.length };
		}
	}
	return undefined;
}

function codeText(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	return Array.isArray(content) ? content.map(run => isBaseHalfNoteRecord(run) && typeof run.text === 'string' ? run.text : '').join('') : '';
}

/**
 * Code with the tabs of the file it was read from (note formats, rule 32):
 * `marked` reads each tab that starts a line as four spaces, so each code
 * block, in the order of the document, takes its lines back from the run of
 * lines of `source` that `marked` read it from. Where the indentation of a
 * list item ends inside a tab, the line keeps its spaces (L19).
 */
export function restoreBaseHalfCodeTabs<T>(blocks: readonly T[], source: string): T[] {
	if (!source.includes('\t')) {
		return [...blocks];
	}
	const original = source.split(/\r\n|\r|\n/);
	const expanded = original.map(expandLeadingTabs);
	let from = 0;
	const visit = (list: readonly unknown[]): unknown[] => list.map(block => {
		if (!isBaseHalfNoteRecord(block)) {
			return block;
		}
		let restored: Record<string, unknown> | undefined;
		if (block.type === 'codeBlock') {
			const code = codeText(block.content);
			const found = findCodeLines(code, original, expanded, from);
			if (found) {
				from = found.end;
				if (found.text !== code) {
					restored = { ...block, content: [{ type: 'text', text: found.text, styles: {} }] };
				}
			}
		}
		const children = baseHalfNoteBlockChildren(block);
		if (children.length > 0) {
			const visited = visit(children);
			if (visited.some((child, index) => child !== children[index])) {
				restored = { ...(restored ?? block), children: visited };
			}
		}
		return restored ?? block;
	});
	return visit(blocks) as T[];
}

