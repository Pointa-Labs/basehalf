/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey, Selection, TextSelection, type Command, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// The title line of a note in the card's editor (docs/specs/note-title.md,
// "The title line and the text under it"): the first line of the editor,
// where the note's title is written, and the text under it, which a press,
// Enter, or Backspace never makes part of the title.
//
// The editor's document is units of the note: a unit it edits holds blocks,
// and a unit kept as it is holds none. The title line is the first block of
// the first unit when that block is a heading. An empty title line writes
// nothing, as every heading without a character does.

export interface ICanvasTitleLineSchema {
	/** A unit of the note that the editor edits. */
	readonly unit: NodeType;
	/** A unit of the note kept as it is. */
	readonly fixed: NodeType;
	readonly heading: NodeType;
	readonly paragraph: NodeType;
}

export interface ICanvasTitleLineOptions {
	readonly schema: ICanvasTitleLineSchema;
	/** The pale text of an empty title line. */
	readonly placeholder: string;
	/** Whether a unit kept as it is is a heading, which is the note's title when it stands first. */
	readonly isHeadingUnit: (unit: ProseMirrorNode) => boolean;
	/** The id of a unit that the editor adds, which the note's file does not hold yet. */
	readonly newUnitId: () => string;
}

/** The content of the title line in a document: its positions, inside the heading. */
export interface ICanvasTitleLineRange {
	readonly from: number;
	readonly to: number;
}

interface ITitleLineState {
	/** Where the empty title line that the editor added stands, while it is there. */
	readonly added: number | undefined;
	readonly decorations: DecorationSet;
}

/** The position of the title line's heading: the first block of the first unit. */
const TITLE_POSITION = 1;

const titleLineKey = new PluginKey<ITitleLineState>('basehalfCanvasTitleLine');

/** The title line of `document`, when its first unit begins with a heading. */
export function canvasTitleLine(document: ProseMirrorNode, schema: ICanvasTitleLineSchema): ProseMirrorNode | undefined {
	const unit = document.firstChild;
	const first = unit?.type === schema.unit ? unit.firstChild : undefined;
	return first?.type === schema.heading ? first : undefined;
}

/** Where the text of the title line of `document` stands, if it has one. */
export function canvasTitleLineRange(document: ProseMirrorNode, schema: ICanvasTitleLineSchema): ICanvasTitleLineRange | undefined {
	const title = canvasTitleLine(document, schema);
	return title ? { from: TITLE_POSITION + 1, to: TITLE_POSITION + 1 + title.content.size } : undefined;
}

/** Whether the note of `document` has a title line: a heading first, or a heading kept as it is first. */
function hasTitleLine(document: ProseMirrorNode, options: ICanvasTitleLineOptions): boolean {
	const first = document.firstChild;
	return !!first && (canvasTitleLine(document, options.schema) !== undefined || (first.type === options.schema.fixed && options.isHeadingUnit(first)));
}

/** The block right under the title line: the next block of the first unit, or the next unit. */
function blockUnderTitle(document: ProseMirrorNode, schema: ICanvasTitleLineSchema): ProseMirrorNode | undefined {
	const unit = document.firstChild;
	if (!unit) {
		return undefined;
	}
	if (unit.type === schema.unit && unit.childCount > 1) {
		return unit.child(1);
	}
	const next = document.childCount > 1 ? document.child(1) : undefined;
	return next?.type === schema.unit ? next.firstChild ?? undefined : next;
}

/**
 * Whether the text under the title line holds a line to type in. It looks
 * from the top and stops at the first: in most notes the block right under
 * the title. A block that stands outside the units counts as well, as the
 * empty line that Enter lifts out of a unit.
 */
function hasLineUnderTitle(document: ProseMirrorNode, schema: ICanvasTitleLineSchema): boolean {
	for (let index = 0; index < document.childCount; index++) {
		const node = document.child(index);
		if (node.type === schema.fixed) {
			continue;
		}
		if (node.type !== schema.unit) {
			if (index > 0 && (node.isTextblock || containsTextblock(node))) {
				return true;
			}
			continue;
		}
		for (let blockIndex = index === 0 ? 1 : 0; blockIndex < node.childCount; blockIndex++) {
			const block = node.child(blockIndex);
			if (block.isTextblock || containsTextblock(block)) {
				return true;
			}
		}
	}
	return false;
}

function containsTextblock(node: ProseMirrorNode): boolean {
	let found = false;
	node.descendants(child => {
		found ||= child.isTextblock;
		return !found;
	});
	return found;
}

/** Whether `block` is a heading of the note: one the editor edits, or one kept as it is. */
function isHeadingBlock(block: ProseMirrorNode | undefined, options: ICanvasTitleLineOptions): boolean {
	return !!block && (block.type === options.schema.heading || (block.type === options.schema.fixed && options.isHeadingUnit(block)));
}

/**
 * Whether a heading has come to stand right under the empty title line of
 * `document` since `before`, where the title line was empty and had no
 * heading under it. A title emptied above a heading, in the same change or
 * after it, is no such case. Without `before`, any heading under it.
 */
function headingCameUnderEmptyTitle(document: ProseMirrorNode, options: ICanvasTitleLineOptions, before: ProseMirrorNode | undefined): boolean {
	const { schema } = options;
	return isHeadingBlock(blockUnderTitle(document, schema), options)
		&& (!before || (canvasTitleLine(before, schema)?.content.size === 0 && !isHeadingBlock(blockUnderTitle(before, schema), options)));
}

/**
 * Gives `transaction`'s document a title line and a line under it, and takes
 * away an empty title line that the editor added where the note has come to
 * begin with a heading: when the line stands first no more, or a heading has
 * come to stand right under it since `before`. A title line emptied above a
 * heading stays. Returns where the added title line stands.
 */
function keepTitleLine(transaction: Transaction, added: number | undefined, options: ICanvasTitleLineOptions, before?: ProseMirrorNode): number | undefined {
	const { schema } = options;
	// An empty title line that the editor added stands only where the note has no title.
	if (added !== undefined) {
		const line = transaction.doc.nodeAt(added);
		if (line?.type === schema.heading && line.content.size === 0) {
			const first = added === TITLE_POSITION && transaction.doc.firstChild?.type === schema.unit;
			if (!first || headingCameUnderEmptyTitle(transaction.doc, options, before)) {
				const unit = transaction.doc.resolve(added).parent;
				// A unit holds blocks: a unit of the title line alone goes with it.
				if (unit.type === schema.unit && unit.childCount === 1) {
					const unitAt = transaction.doc.resolve(added).before();
					transaction.delete(unitAt, unitAt + unit.nodeSize);
				} else {
					transaction.delete(added, added + line.nodeSize);
				}
				added = undefined;
			}
		} else if (line?.type !== schema.heading) {
			added = undefined;
		}
	}
	// The title line stays first.
	if (!hasTitleLine(transaction.doc, options)) {
		const line = schema.heading.create({ level: 1 });
		if (transaction.doc.firstChild?.type === schema.unit) {
			transaction.insert(TITLE_POSITION, line);
		} else {
			transaction.insert(0, schema.unit.create({ unitId: options.newUnitId() }, line));
		}
		added = TITLE_POSITION;
	}
	// There is always a line to type in under the title.
	if (!hasLineUnderTitle(transaction.doc, schema)) {
		transaction.insert(transaction.doc.content.size, schema.unit.create({ unitId: options.newUnitId() }, schema.paragraph.create()));
	}
	return added;
}

/**
 * The document `document` with a title line and a line under it, for an
 * editor that starts there, and where the title line that it added stands.
 * Used for the editor's first document, whose units the file holds as they
 * are: the empty title line goes into the first unit, which still writes
 * what it wrote.
 */
export function withCanvasTitleLine(document: ProseMirrorNode, options: ICanvasTitleLineOptions): { readonly document: ProseMirrorNode; readonly added: number | undefined } {
	const state = EditorState.create({ doc: document });
	const transaction = state.tr;
	const added = keepTitleLine(transaction, undefined, options);
	return { document: transaction.doc, added };
}

function decorationsOf(document: ProseMirrorNode, options: ICanvasTitleLineOptions): DecorationSet {
	const title = canvasTitleLine(document, options.schema);
	return title && title.content.size === 0
		? DecorationSet.create(document, [Decoration.node(TITLE_POSITION, TITLE_POSITION + title.nodeSize, { class: 'basehalf-canvas-markdown-inline-title-line', 'data-placeholder': options.placeholder })])
		: DecorationSet.empty;
}

/**
 * The title line of an editor that starts with one: the pale `Title` of an
 * empty title line, and after every change a title line first, a line to
 * type in under it, and no empty title line that the editor added above a
 * heading. `added` is where the empty title line that the editor added to
 * its first document stands.
 */
export function canvasTitleLinePlugin(options: ICanvasTitleLineOptions, added: number | undefined): Plugin<ITitleLineState> {
	return new Plugin<ITitleLineState>({
		key: titleLineKey,
		state: {
			init: (_config, state) => ({ added, decorations: decorationsOf(state.doc, options) }),
			apply: (transaction, value, _old, state) => {
				if (!transaction.docChanged) {
					return value;
				}
				const kept = transaction.getMeta(titleLineKey) as { readonly added: number | undefined } | undefined;
				// The added title line goes with the node it was: a position whose node was deleted stands for no title line.
				const mapped = value.added === undefined ? undefined : transaction.mapping.mapResult(value.added, 1);
				return { added: kept ? kept.added : mapped && !mapped.deleted ? mapped.pos : undefined, decorations: decorationsOf(state.doc, options) };
			},
		},
		appendTransaction: (transactions, old, state) => {
			if (!transactions.some(transaction => transaction.docChanged)) {
				return null;
			}
			const transaction = state.tr;
			const added = keepTitleLine(transaction, titleLineKey.getState(state)?.added, options, old.doc);
			return transaction.docChanged ? transaction.setMeta(titleLineKey, { added }) : null;
		},
		props: {
			decorations: state => titleLineKey.getState(state)?.decorations ?? null,
		},
	});
}

/**
 * Enter in the title line ends the title: the text after the caret goes to
 * the line under the title line, a paragraph, with the caret at its start:
 * into the line under it when that line is empty, and otherwise into a new
 * line before it. The title line stays, empty or not.
 */
export function canvasTitleLineEnter(schema: ICanvasTitleLineSchema): Command {
	return (state, dispatch) => {
		const range = canvasTitleLineRange(state.doc, schema);
		const { from, to } = state.selection;
		if (!range || !(state.selection instanceof TextSelection) || from < range.from || to > range.to) {
			return false;
		}
		if (!dispatch) {
			return true;
		}
		const transaction = state.tr;
		if (!state.selection.empty) {
			transaction.deleteSelection();
		}
		const caret = transaction.selection.from;
		const title = transaction.doc.nodeAt(TITLE_POSITION)!;
		const tail = title.content.cut(caret - (TITLE_POSITION + 1));
		transaction.delete(caret, TITLE_POSITION + 1 + title.content.size);
		const after = TITLE_POSITION + transaction.doc.nodeAt(TITLE_POSITION)!.nodeSize;
		const under = blockUnderTitle(transaction.doc, schema);
		const line = under?.type === schema.paragraph && under.content.size === 0
			? Selection.findFrom(transaction.doc.resolve(after), 1, true)
			: null;
		if (line) {
			transaction.insert(line.from, tail);
			transaction.setSelection(TextSelection.create(transaction.doc, line.from));
		} else {
			transaction.insert(after, schema.paragraph.create(null, tail));
			transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
		}
		dispatch(transaction.scrollIntoView());
		return true;
	};
}

/**
 * Where the caret goes when the editor opens without a place asked for: in
 * the title line of a note without text, and at the end of the title of a
 * note of only a title, whose end it is (the empty line under it is the
 * editor's). `undefined` for any other note, which opens at its end.
 */
export function canvasTitleLineOpening(document: ProseMirrorNode, schema: ICanvasTitleLineSchema): Selection | undefined {
	const range = canvasTitleLineRange(document, schema);
	let fixed = false;
	document.forEach(unit => {
		fixed ||= unit.type === schema.fixed;
	});
	if (!range || fixed) {
		return undefined;
	}
	const title = document.nodeAt(TITLE_POSITION)!;
	return document.textContent === title.textContent ? TextSelection.create(document, title.content.size === 0 ? range.from : range.to) : undefined;
}

/** Backspace at the start of the title line does nothing: nothing stands before it, and it stays a title line. */
export function canvasTitleLineBackspace(schema: ICanvasTitleLineSchema): Command {
	return state => {
		const range = canvasTitleLineRange(state.doc, schema);
		return !!range && state.selection.empty && state.selection.from === range.from;
	};
}

/**
 * Where a press that ProseMirror placed at `selection` puts the caret: a
 * press below the title line, which lands in it only when nothing under it
 * is nearer, goes to the text under the title.
 */
export function canvasTitleLinePress(state: EditorState, selection: Selection, belowTitle: boolean, schema: ICanvasTitleLineSchema): Selection {
	const range = canvasTitleLineRange(state.doc, schema);
	if (!range || !belowTitle || selection.from < range.from || selection.to > range.to) {
		return selection;
	}
	return Selection.findFrom(state.doc.resolve(range.to + 1), 1, true) ?? selection;
}
