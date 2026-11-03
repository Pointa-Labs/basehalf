/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { blockToNode, nodeToBlock } from '@blocknote/core';
import { NodeRange, type Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Selection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { AddMarkStep, AttrStep, RemoveMarkStep } from '@tiptap/pm/transform';
import { ySyncPluginKey } from 'y-prosemirror';
import { baseHalfNoteColumnAlignments } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteBlocks.js';
import { baseHalfNoteMediaKind } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteMediaKind.js';
import { baseHalfNotePaletteAlias, isBaseHalfNotePaletteColor, type BaseHalfNotePaletteRole } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNotePalette.js';
import { baseHalfNoteMayHold, shapeBaseHalfNoteTable } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteStructure.js';

// What Rich adjusts after a change (note formats, rules 28, 29, 58 to 60, 66,
// and 78): when a key, a drag, a paste, a drop, a change of a block's kind,
// or a call of the editor leaves the note in a shape its file cannot store,
// the least that gives it that shape follows, in the same step of undo. The
// rules are those the reader gives what it reads (basehalfNoteStructure.ts).

type Range = readonly [from: number, to: number];

const colorRoles: Readonly<Record<string, BaseHalfNotePaletteRole>> = { textColor: 'text', backgroundColor: 'background' };
const mediaTypes: ReadonlySet<string> = new Set(['image', 'video', 'audio']);

/** A change that came from the shared document: an undo, a redo, or a load into it. */
export function isBaseHalfNoteSharedChange(transaction: Transaction): boolean {
	return (transaction.getMeta(ySyncPluginKey) as { readonly isChangeOrigin?: boolean } | undefined)?.isChangeOrigin === true;
}

/**
 * The transaction that gives what `transactions` changed the shape a note
 * can store, or `null` when it has that shape. A change from the shared
 * document is not adjusted: undo and redo bring back what was adjusted
 * before.
 */
export function normalizeBaseHalfNote(transactions: readonly Transaction[], state: EditorState): Transaction | null {
	if (!transactions.some(transaction => transaction.docChanged) || transactions.some(isBaseHalfNoteSharedChange)) {
		return null;
	}
	const ranges = mergedRanges(baseHalfNoteChangedRanges(transactions), state.doc.content.size);
	if (ranges.length === 0) {
		return null;
	}
	const found = findShapes(state.doc, ranges);
	if (found.parents.length === 0 && found.colors.length === 0 && found.tables.length === 0 && found.media.length === 0) {
		return null;
	}
	const transaction = state.tr;
	for (const position of found.parents) {
		liftChildren(transaction, transaction.mapping.map(position));
	}
	for (const { from, to, mark } of found.colors) {
		paletteColor(transaction, transaction.mapping.map(from, 1), transaction.mapping.map(to, -1), mark);
	}
	for (const position of found.tables) {
		shapeTable(transaction, transaction.mapping.map(position));
	}
	for (const position of found.media) {
		shapeMedia(transaction, transaction.mapping.map(position));
	}
	if (!transaction.docChanged) {
		return null;
	}
	if (transactions.some(each => each.getMeta('addToHistory') === false)) {
		transaction.setMeta('addToHistory', false);
	}
	return transaction;
}

/** What the steps of `transactions` changed, after `earlier` ranges of the document before them, in the positions of the last document. */
export function baseHalfNoteChangedRanges(transactions: readonly Transaction[], earlier: readonly (readonly [number, number])[] = []): [number, number][] {
	let ranges: [number, number][] = earlier.map(([from, to]) => [from, to]);
	for (const transaction of transactions) {
		transaction.steps.forEach((step, index) => {
			const map = transaction.mapping.maps[index];
			ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
			// A change of marks or of an attribute moves no position.
			if (step instanceof AttrStep) {
				ranges.push([step.pos, step.pos + 1]);
			} else if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
				ranges.push([step.from, step.to]);
			}
			map.forEach((_oldStart, _oldEnd, newStart, newEnd) => ranges.push([newStart, newEnd]));
		});
	}
	return ranges;
}

/** The ranges with a position of room on each side, so that the blocks beside a deletion are in them, joined where they meet. */
function mergedRanges(ranges: readonly (readonly [number, number])[], size: number): Range[] {
	const sorted = ranges.map(([from, to]): [number, number] => [Math.max(0, Math.min(from, to) - 1), Math.min(size, Math.max(from, to) + 1)]).sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push(range);
		}
	}
	return merged;
}

interface IShapes {
	/** Blocks that hold blocks they may not hold (rule 66), by position, first to last. */
	readonly parents: readonly number[];
	/** Colors of text that are no palette color (rule 29). */
	readonly colors: readonly { readonly from: number; readonly to: number; readonly mark: Mark }[];
	/** Tables (rules 58 to 60). */
	readonly tables: readonly number[];
	/** Pictures, videos, and sounds (rules 26 to 28). */
	readonly media: readonly number[];
}

function findShapes(doc: ProseMirrorNode, ranges: readonly Range[]): IShapes {
	const parents = new Set<number>();
	const tables = new Set<number>();
	const media = new Set<number>();
	const texts = new Set<number>();
	const colors: { from: number; to: number; mark: Mark }[] = [];
	for (const [from, to] of ranges) {
		doc.nodesBetween(from, to, (node, position) => {
			if (node.type.name === 'blockContainer') {
				if (holdsWhatItMayNot(node)) {
					parents.add(position);
				}
			} else if (node.type.name === 'table') {
				tables.add(position);
			} else if (mediaTypes.has(node.type.name)) {
				media.add(position);
			} else if (node.isText && !texts.has(position)) {
				texts.add(position);
				for (const mark of node.marks) {
					if (colorRoles[mark.type.name] && !isBaseHalfNotePaletteColor(mark.attrs.stringValue)) {
						colors.push({ from: position, to: position + node.nodeSize, mark });
					}
				}
			}
			return true;
		});
	}
	return { parents: [...parents].sort((a, b) => a - b), colors, tables: [...tables], media: [...media] };
}

// --- Nesting (rule 66)

function holdsWhatItMayNot(container: ProseMirrorNode): boolean {
	const content = container.firstChild;
	const group = container.childCount > 1 ? container.lastChild : null;
	return !!content && !!group && group.childCount > 0 && !baseHalfNoteMayHold({ type: content.type.name, props: content.attrs });
}

/** The blocks under the block at `position` move out after it, in their order; a caret in them stays where it is in the text. */
function liftChildren(transaction: Transaction, position: number): void {
	const container = transaction.doc.nodeAt(position);
	if (!container || container.type.name !== 'blockContainer' || !holdsWhatItMayNot(container) || !container.firstChild || !container.lastChild) {
		return;
	}
	const group = position + 1 + container.firstChild.nodeSize;
	const $from = transaction.doc.resolve(group + 1);
	const $to = transaction.doc.resolve(group + container.lastChild.nodeSize - 1);
	transaction.lift(new NodeRange($from, $to, $from.depth), $from.depth - 2);
}

// --- Colors (rule 29)

/** A color of text that is no palette color becomes the palette color it stands for, or goes. */
function paletteColor(transaction: Transaction, from: number, to: number, mark: Mark): void {
	if (from >= to) {
		return;
	}
	transaction.removeMark(from, to, mark);
	const value = mark.attrs.stringValue;
	const color = typeof value === 'string' ? baseHalfNotePaletteAlias(colorRoles[mark.type.name], value) : undefined;
	if (color) {
		transaction.addMark(from, to, mark.type.create({ ...mark.attrs, stringValue: color }));
	}
}

// --- Tables (rules 58 to 60)

function sameValue(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A table in the shape a note stores: its first row the header, a merged
 * cell split, no widths of columns and no colors of cells, and each cell
 * its column's alignment.
 */
function shapeTable(transaction: Transaction, position: number): void {
	const table = transaction.doc.nodeAt(position);
	if (!table || table.type.name !== 'table') {
		return;
	}
	const rows: ProseMirrorNode[][] = [];
	table.forEach(row => {
		const cells: ProseMirrorNode[] = [];
		row.forEach(cell => cells.push(cell));
		rows.push(cells);
	});
	if (rows.some(cells => cells.some(cell => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1))) {
		rebuildTable(transaction, position);
		return;
	}
	if (table.attrs.textColor !== undefined && table.attrs.textColor !== 'default') {
		transaction.setNodeAttribute(position, 'textColor', 'default');
	}
	const { tableHeader, tableCell } = transaction.doc.type.schema.nodes;
	const alignments = baseHalfNoteColumnAlignments(rows.map(cells => cells.map(cell => ({ props: cell.attrs }))));
	let rowPosition = position + 1;
	rows.forEach((cells, row) => {
		let cellPosition = rowPosition + 1;
		cells.forEach((cell, column) => {
			const type = row === 0 ? tableHeader : tableCell;
			const wanted: Record<string, unknown> = { colwidth: null, backgroundColor: 'default', textColor: 'default', textAlignment: alignments[column] ?? 'left' };
			if (type && cell.type !== type) {
				transaction.setNodeMarkup(cellPosition, type, { ...cell.attrs, ...wanted });
			} else {
				for (const [name, value] of Object.entries(wanted)) {
					if (Object.hasOwn(cell.attrs, name) && !sameValue(cell.attrs[name], value)) {
						transaction.setNodeAttribute(cellPosition, name, value);
					}
				}
			}
			cellPosition += cell.nodeSize;
		});
		rowPosition += table.child(row).nodeSize;
	});
}

/** A table with merged cells is made anew in the shape a note stores; a caret in it goes to its start. */
function rebuildTable(transaction: Transaction, position: number): void {
	const containerPosition = transaction.doc.resolve(position).before();
	const container = transaction.doc.nodeAt(containerPosition);
	if (!container) {
		return;
	}
	const { schema } = transaction.doc.type;
	const block = nodeToBlock(container, schema);
	const end = containerPosition + container.nodeSize;
	const caretInside = transaction.selection.from >= containerPosition && transaction.selection.to <= end;
	const content = shapeBaseHalfNoteTable(block.content) as typeof block.content;
	transaction.replaceWith(containerPosition, end, blockToNode({ ...block, content }, schema));
	if (caretInside) {
		transaction.setSelection(Selection.near(transaction.doc.resolve(containerPosition + 1)));
	}
}

// --- Pictures, videos, and sounds (rules 26 to 28)

/** A whole number of pixels from 1 to 99,999, or none. */
function wholeWidth(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}
	const width = Math.round(value);
	return width >= 1 && width <= 99999 ? width : undefined;
}

/** A picture whose address is a video is a video, and one of a sound a sound; each shows itself, at a whole width. */
function shapeMedia(transaction: Transaction, position: number): void {
	const node = transaction.doc.nodeAt(position);
	if (!node || !mediaTypes.has(node.type.name)) {
		return;
	}
	const kind = baseHalfNoteMediaKind(typeof node.attrs.url === 'string' ? node.attrs.url : '');
	const typeName = kind === 'audio' || (kind === 'video' && node.type.name === 'image') ? kind : node.type.name;
	const type = transaction.doc.type.schema.nodes[typeName] ?? node.type;
	const names = new Set(Object.keys(type.spec.attrs ?? {}));
	const wanted: Record<string, unknown> = {};
	if (names.has('showPreview')) {
		wanted.showPreview = true;
	}
	if (names.has('previewWidth')) {
		wanted.previewWidth = wholeWidth(node.attrs.previewWidth);
	}
	if (type !== node.type) {
		const selected = transaction.selection instanceof NodeSelection && transaction.selection.from === position;
		transaction.setNodeMarkup(position, type, { ...node.attrs, ...wanted });
		if (selected) {
			transaction.setSelection(NodeSelection.create(transaction.doc, position));
		}
		return;
	}
	for (const [name, value] of Object.entries(wanted)) {
		if (node.attrs[name] !== value) {
			transaction.setNodeAttribute(position, name, value);
		}
	}
}
