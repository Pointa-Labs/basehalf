/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BaseHalfNoteInlineContent } from './basehalfNoteInline.js';

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports only a sibling's types.
//
// The blocks of a note as the rich editor holds them, its block JSON, as the
// note's writer (`basehalfNoteWriter.ts`) and the reader's block pass
// (`basehalfNoteStructure.ts`) read them. The JSON comes from the editor and
// from pastes, so every field is read as if it could hold anything.

/**
 * The type of a fixed block: a block Rich shows rendered and saves byte for
 * byte (note rendering, rule 15). The projection's
 * `BASEHALF_RAW_PASSTHROUGH_BLOCK` names the same type.
 */
export const BASEHALF_NOTE_FIXED_BLOCK_TYPE = 'rawPassthrough';

/** A cell of a table as the rich editor holds it. */
export interface IBaseHalfNoteTableCell {
	readonly type: 'tableCell';
	readonly props?: Readonly<Record<string, unknown>>;
	readonly content?: BaseHalfNoteInlineContent;
}

/** The rows of a table. A cell may also be its inline content alone, as the editor accepts it. */
export interface IBaseHalfNoteTableContent {
	readonly type: 'tableContent';
	readonly columnWidths?: readonly (number | null | undefined)[];
	readonly headerRows?: number;
	readonly headerCols?: number;
	readonly rows: readonly { readonly cells: readonly (IBaseHalfNoteTableCell | BaseHalfNoteInlineContent)[] }[];
}

/**
 * What the reader learned of a list item from the file (design 4.2), so that
 * an edited item keeps the shape the file gave it (note formats, rule 19).
 */
export interface IBaseHalfNoteListHint {
	/** The item's marker as the file wrote it: `-`, `*`, `+`, or a number with `.` or `)`, such as `3.` or `1)`. */
	readonly marker: string;
	/** The columns the item's children were indented by, counted from the column of its marker. */
	readonly childIndent?: number;
	/** The line breaks before each child when the note was read: `\n`, `\n\n`, or more. */
	readonly separators?: readonly string[];
	/** The ids of the children when the note was read, in order. */
	readonly children?: readonly string[];
	/**
	 * The kinds of those children when the note was read. Two children that
	 * are still neighbours keep the line breaks between them only while both
	 * keep their kinds (rule 67).
	 */
	readonly kinds?: readonly IBaseHalfNoteBlockKind[];
}

/**
 * A block of a note as the rich editor holds it. `basehalfOpen` and
 * `basehalfHints` are not props of the editor's schema: the reader's block
 * pass sets them from the file, and they are taken off before the blocks go
 * into the editor.
 */
export interface IBaseHalfNoteBlock {
	readonly id?: string;
	readonly type: string;
	readonly props?: Readonly<Record<string, unknown>>;
	readonly content?: BaseHalfNoteInlineContent | IBaseHalfNoteTableContent;
	readonly children?: readonly IBaseHalfNoteBlock[];
	/** Whether the file stores the toggle open (`<details open>`). */
	readonly basehalfOpen?: boolean;
	/** What the file wrote of the list item. */
	readonly basehalfHints?: IBaseHalfNoteListHint;
}

/**
 * The kind of a block (note formats, "Terms"): its type, whether it folds,
 * and for a list item its bullet character or the delimiter of its number
 * and whether it is a check item. Two items of one list in Markdown have the
 * same marker character or delimiter.
 */
export interface IBaseHalfNoteBlockKind {
	readonly type: string;
	readonly toggle?: boolean;
	readonly marker?: string;
	readonly task?: boolean;
}

export function isBaseHalfNoteRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The type of a block, or `''` for what is no block. */
export function baseHalfNoteBlockType(block: unknown): string {
	return isBaseHalfNoteRecord(block) && typeof block.type === 'string' ? block.type : '';
}

export function baseHalfNoteBlockId(block: unknown): string | undefined {
	return isBaseHalfNoteRecord(block) && typeof block.id === 'string' ? block.id : undefined;
}

const noProps: Readonly<Record<string, unknown>> = Object.freeze({});

export function baseHalfNoteBlockProps(block: unknown): Readonly<Record<string, unknown>> {
	return isBaseHalfNoteRecord(block) && isBaseHalfNoteRecord(block.props) ? block.props : noProps;
}

const noChildren: readonly unknown[] = Object.freeze([]);

export function baseHalfNoteBlockChildren(block: unknown): readonly unknown[] {
	return isBaseHalfNoteRecord(block) && Array.isArray(block.children) ? block.children : noChildren;
}

/** A string prop, or `''`. */
export function baseHalfNoteStringProp(props: Readonly<Record<string, unknown>>, name: string): string {
	const value = props[name];
	return typeof value === 'string' ? value : '';
}

const listItemTypes: ReadonlySet<string> = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);

/** A bullet, a numbered, or a check item. A toggle list item folds and is written as a toggle. */
export function isBaseHalfNoteListItemType(type: string): boolean {
	return listItemTypes.has(type);
}

/** A toggle list item, or a heading that folds. */
export function isBaseHalfNoteToggle(block: unknown): boolean {
	const type = baseHalfNoteBlockType(block);
	return type === 'toggleListItem' || (type === 'heading' && baseHalfNoteBlockProps(block).isToggleable === true);
}

const numberedMarker = /^\d{1,9}([.)])$/;

/**
 * The kind of a block, a list item with `marker`, the marker the file or the
 * writer gives it: its bullet character, or the delimiter of its number,
 * stands for it.
 */
export function baseHalfNoteKindOf(block: unknown, marker: string | undefined): IBaseHalfNoteBlockKind {
	const type = baseHalfNoteBlockType(block);
	if (isBaseHalfNoteListItemType(type)) {
		const numbered = marker === undefined ? undefined : numberedMarker.exec(marker);
		return { type, marker: numbered ? numbered[1] : marker, task: type === 'checkListItem' };
	}
	return isBaseHalfNoteToggle(block) ? { type, toggle: true } : { type };
}

export function sameBaseHalfNoteBlockKind(a: IBaseHalfNoteBlockKind | undefined, b: IBaseHalfNoteBlockKind | undefined): boolean {
	return !!a && !!b && a.type === b.type && !!a.toggle === !!b.toggle && a.marker === b.marker && !!a.task === !!b.task;
}

/** The alignment of a column of a table, as its separator row holds it. */
export type BaseHalfNoteColumnAlignment = 'left' | 'center' | 'right';

/** The cells of each row of a table, or none when `content` is no table. */
export function baseHalfNoteTableRows(content: unknown): readonly (readonly unknown[])[] {
	if (!isBaseHalfNoteRecord(content) || !Array.isArray(content.rows)) {
		return [];
	}
	return content.rows.map(row => isBaseHalfNoteRecord(row) && Array.isArray(row.cells) ? row.cells : []);
}

/** The inline content of a cell, which the editor holds as a cell or as its content alone. */
export function baseHalfNoteCellContent(cell: unknown): unknown {
	return isBaseHalfNoteRecord(cell) ? cell.content : cell;
}

function cellAlignment(cell: unknown): BaseHalfNoteColumnAlignment {
	const alignment = isBaseHalfNoteRecord(cell) && isBaseHalfNoteRecord(cell.props) ? cell.props.textAlignment : undefined;
	return alignment === 'center' || alignment === 'right' ? alignment : 'left';
}

/**
 * The alignment of each column: that of its first cell that is not left,
 * else left (note formats, rule 59). Rich keeps every cell of a column at the
 * column's alignment, and a new cell, such as one of a row added above, is
 * left until then, so the first cell that is not left holds the column's.
 */
export function baseHalfNoteColumnAlignments(rows: readonly (readonly unknown[])[]): BaseHalfNoteColumnAlignment[] {
	let columns = 0;
	for (const row of rows) {
		columns = Math.max(columns, row.length);
	}
	const alignments: BaseHalfNoteColumnAlignment[] = [];
	for (let column = 0; column < columns; column++) {
		let alignment: BaseHalfNoteColumnAlignment = 'left';
		for (const row of rows) {
			alignment = column < row.length ? cellAlignment(row[column]) : 'left';
			if (alignment !== 'left') {
				break;
			}
		}
		alignments.push(alignment);
	}
	return alignments;
}
