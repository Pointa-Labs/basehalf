/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension, type BlockNoteEditor } from '@blocknote/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { BASEHALF_RAW_PASSTHROUGH_BLOCK } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import { isBaseHalfNoteSharedChange, isBaseHalfNoteUndoOrRedo } from './noteNormalizer.js';

// The title line of a note in Rich (docs/specs/note-title.md, "The title line
// and the text under it"): every note starts with its title line, the note's
// first heading or an empty heading that writes nothing, and has a line to
// type in under it; a press below the title line, Enter in it, and Backspace
// at its start never make the text under it the title, or the title text.
//
// The document is BlockNote's: a group of blocks, each a container of its
// content and its children. The title line is the content of the group's
// first block when that is a heading that is no toggle.

type NoteEditor = BlockNoteEditor<any, any, any>;

/** Where the first block of the note stands: the group opens at 0. */
const FIRST_BLOCK = 1;
/** Where the first block's content stands. */
const FIRST_CONTENT = FIRST_BLOCK + 1;
/** Where the text of the title line starts. */
const TITLE_TEXT = FIRST_CONTENT + 1;

const titleLineKey = new PluginKey<ITitleLineState>('baseHalfNoteTitleLine');

interface ITitleLineState {
	/**
	 * The ids of the blocks of the empty title lines that Rich added. An id
	 * outlives the collaboration plugin's drawing of the whole document anew,
	 * where a position would not, and an undo or a redo that brings a block back
	 * brings its id: an id is kept after its block goes.
	 */
	readonly added: ReadonlySet<string>;
	readonly decorations: DecorationSet;
}

/** A new block's id, as the editor's own: the editor keeps an id that a block has. */
function newBlockId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `title-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface IBaseHalfNoteTitleLineOptions {
	/** The pale text of an empty title line. */
	readonly placeholder: string;
}

/** A heading that is no toggle: what the title line is. */
function isTitleHeading(content: ProseMirrorNode | null | undefined): boolean {
	return content?.type.name === 'heading' && !content.attrs.isToggleable;
}

/** A block kept as it is whose source is a heading, which is the title when it stands first. */
function isFixedHeading(content: ProseMirrorNode | null | undefined): boolean {
	return content?.type.name === BASEHALF_RAW_PASSTHROUGH_BLOCK
		&& /^ {0,3}#{1,6}(?:[ \t]|$)|^[^\r\n]+\r?\n {0,3}(?:=+|-+)[ \t]*$/.test(String(content.attrs.source ?? ''));
}

/** The content of the block at `index` of the note's top level. */
function contentAt(document: ProseMirrorNode, index: number): ProseMirrorNode | undefined {
	return document.firstChild?.maybeChild(index)?.firstChild ?? undefined;
}

/** The title line of `document`, when its first block is a heading that is no toggle. */
export function baseHalfNoteTitleLine(document: ProseMirrorNode): ProseMirrorNode | undefined {
	const content = contentAt(document, 0);
	return content && isTitleHeading(content) ? content : undefined;
}

/** Where the text of the title line stands, if the note has one. */
export function baseHalfNoteTitleLineRange(document: ProseMirrorNode): { readonly from: number; readonly to: number } | undefined {
	const title = baseHalfNoteTitleLine(document);
	return title ? { from: TITLE_TEXT, to: TITLE_TEXT + title.content.size } : undefined;
}

/** Whether `blockId` is the note's first block, the title line, which shows no handles (note title). */
export function isBaseHalfNoteTitleLineBlock(state: EditorState, blockId: string): boolean {
	const first = state.doc.firstChild?.firstChild;
	return first !== undefined && first !== null && first.attrs.id === blockId && isTitleHeading(first.firstChild);
}

/** Whether a block under the title line takes text. */
function hasLineUnderTitle(document: ProseMirrorNode): boolean {
	const group = document.firstChild;
	for (let index = 1; index < (group?.childCount ?? 0); index++) {
		const content = group!.child(index).firstChild;
		if (content && (content.isTextblock || content.type.name === 'table')) {
			return true;
		}
	}
	return false;
}

/** A heading of the note that is no toggle: one that Rich edits, or one kept as it is. */
function isHeadingBlock(content: ProseMirrorNode | null | undefined): boolean {
	return isTitleHeading(content) || isFixedHeading(content);
}

/**
 * Whether a heading has come to stand right under the note's empty title line
 * since `before`, where the title line was empty and had no heading under it.
 * A title emptied above a heading, in the same change or after it, is no such
 * case.
 */
function headingCameUnderEmptyTitle(document: ProseMirrorNode, before: ProseMirrorNode): boolean {
	const titleThen = contentAt(before, 0);
	return isHeadingBlock(contentAt(document, 1))
		&& isTitleHeading(titleThen) && titleThen!.content.size === 0 && !isHeadingBlock(contentAt(before, 1));
}

/** What a change of the note was: the document before it, and whether it was an undo or a redo, which brings back what was. */
interface ITitleLineChange {
	readonly before: ProseMirrorNode;
	readonly restores: boolean;
}

/**
 * Gives `transaction`'s document a title line first and a line to type in
 * under it, and takes away an empty title line that Rich added where the note
 * has come to begin with a heading: when the line stands first no more, or a
 * heading has come to stand right under it. A title line emptied above a
 * heading stays, and so does what an undo or a redo brings back. Returns the
 * ids of the title lines that Rich added.
 */
function keepTitleLine(transaction: Transaction, added: ReadonlySet<string>, change: ITitleLineChange): ReadonlySet<string> {
	const { schema } = transaction.doc.type;
	const group = transaction.doc.firstChild;
	const { before } = change;
	if (group && added.size > 0 && !change.restores) {
		// A title line that Rich added stands first but for a change of the note's blocks: the others are looked at only then.
		const moved = before.firstChild?.childCount !== group.childCount || before.firstChild?.firstChild?.attrs.id !== group.firstChild?.attrs.id;
		const goes: { readonly from: number; readonly to: number }[] = [];
		let position = FIRST_BLOCK;
		for (let index = 0; index < (moved ? group.childCount : Math.min(1, group.childCount)); index++) {
			const block = group.child(index);
			const content = block.firstChild;
			if (added.has(block.attrs.id) && block.childCount === 1 && isTitleHeading(content) && content!.content.size === 0
				&& (index > 0 || headingCameUnderEmptyTitle(transaction.doc, before))) {
				goes.push({ from: position, to: position + block.nodeSize });
			}
			position += block.nodeSize;
		}
		for (const range of goes.reverse()) {
			transaction.delete(range.from, range.to);
		}
	}
	if (!isHeadingBlock(contentAt(transaction.doc, 0))) {
		const id = newBlockId();
		transaction.insert(FIRST_BLOCK, schema.nodes.blockContainer.create({ id }, schema.nodes.heading.create({ level: 1 })));
		added = new Set([...added, id]);
	}
	if (!hasLineUnderTitle(transaction.doc)) {
		transaction.insert(transaction.doc.firstChild!.nodeSize - 1, schema.nodes.blockContainer.create(null, schema.nodes.paragraph.create()));
	}
	return added;
}

function decorationsOf(document: ProseMirrorNode, placeholder: string): DecorationSet {
	const title = baseHalfNoteTitleLine(document);
	return title && title.content.size === 0
		? DecorationSet.create(document, [Decoration.node(FIRST_CONTENT, FIRST_CONTENT + title.nodeSize, { 'data-basehalf-title-line': '', 'data-placeholder': placeholder })])
		: DecorationSet.empty;
}

/** Enter in the title line ends the title: the text after the caret goes to the line under it, with the caret at its start. */
function enterInTitleLine(editor: NoteEditor): boolean {
	const view = editor.prosemirrorView;
	const state = view?.state;
	const range = state ? baseHalfNoteTitleLineRange(state.doc) : undefined;
	if (!view || !state || !range || !(state.selection instanceof TextSelection) || state.selection.from < range.from || state.selection.to > range.to) {
		return false;
	}
	const { schema } = state;
	const transaction = state.tr;
	if (!state.selection.empty) {
		transaction.deleteSelection();
	}
	const caret = transaction.selection.from;
	const title = transaction.doc.nodeAt(FIRST_CONTENT)!;
	const tail = title.content.cut(caret - TITLE_TEXT);
	transaction.delete(caret, TITLE_TEXT + title.content.size);
	const after = FIRST_BLOCK + transaction.doc.nodeAt(FIRST_BLOCK)!.nodeSize;
	const under = transaction.doc.firstChild!.maybeChild(1);
	if (under && under.childCount === 1 && under.firstChild?.type.name === 'paragraph' && under.firstChild.content.size === 0) {
		// Into the empty line under the title: its text starts inside its block and its paragraph.
		transaction.insert(after + 2, tail);
		transaction.setSelection(TextSelection.create(transaction.doc, after + 2));
	} else {
		transaction.insert(after, schema.nodes.blockContainer.create(null, schema.nodes.paragraph.create(null, tail)));
		transaction.setSelection(TextSelection.create(transaction.doc, after + 2));
	}
	view.dispatch(transaction.scrollIntoView());
	return true;
}

/** Backspace at the start of the title line does nothing: nothing stands before it, and it stays a title line. */
function backspaceAtTitleStart(editor: NoteEditor): boolean {
	const state = editor.prosemirrorView?.state;
	const range = state ? baseHalfNoteTitleLineRange(state.doc) : undefined;
	return !!state && !!range && state.selection.empty && state.selection.from === range.from;
}

/**
 * Where a press at the height `clientY` that ProseMirror placed at
 * `selection` puts the caret: a press below the title line, which lands in
 * it only when nothing under it is nearer, goes to the text under the title
 * (note title).
 */
export function baseHalfNoteTitleLinePress(view: EditorView, selection: Selection, clientY: number): Selection {
	const { state } = view;
	const range = baseHalfNoteTitleLineRange(state.doc);
	if (!range || selection.from < range.from || selection.to > range.to) {
		return selection;
	}
	const title = view.nodeDOM(FIRST_CONTENT);
	if (!(title instanceof HTMLElement) || clientY <= title.getBoundingClientRect().bottom) {
		return selection;
	}
	return Selection.findFrom(state.doc.resolve(FIRST_BLOCK + state.doc.firstChild!.child(0).nodeSize), 1, true) ?? selection;
}

/** Where the caret goes in a note without text when Rich opens it: the start of its title line. */
export function baseHalfNoteTitleLineStart(document: ProseMirrorNode): Selection | undefined {
	return baseHalfNoteTitleLine(document) ? TextSelection.create(document, TITLE_TEXT) : undefined;
}

/**
 * Where the caret goes in a note of only a title when Rich opens it at its
 * end: the end of the title, so that a title begun on the card goes on there;
 * the empty line under it is the editor's, not the note's end.
 */
export function baseHalfNoteTitleOnlyEnd(document: ProseMirrorNode): Selection | undefined {
	const title = baseHalfNoteTitleLine(document);
	const group = document.firstChild;
	const under = group?.maybeChild(1)?.firstChild;
	return title && title.content.size > 0 && group?.childCount === 2 && under?.type.name === 'paragraph' && under.content.size === 0
		? TextSelection.create(document, TITLE_TEXT + title.content.size)
		: undefined;
}

/** The title line of every note in Rich (note title, "The title line and the text under it"). */
export function makeBaseHalfNoteTitleLineExtension(options: IBaseHalfNoteTitleLineOptions) {
	// A change that came from the shared document (an undo, a redo, the host's copy) has its own pass of the collaboration
	// plugin, which writes nothing of what is appended to it into the shared document: the title line it needs follows it
	// as a change of its own, outside the note's undo.
	let afterSharedChange: ITitleLineChange | undefined;
	return createExtension({
		key: 'baseHalfNoteTitleLine',
		// Ahead of the note's own keys and of the editor's, which would make the title a paragraph or the text under it.
		runsBefore: ['baseHalfNoteShape', 'nodeSelectionKeyboard'],
		keyboardShortcuts: {
			'Enter': ({ editor }) => enterInTitleLine(editor),
			'Backspace': ({ editor }) => backspaceAtTitleStart(editor),
		},
		prosemirrorPlugins: [
			new Plugin<ITitleLineState>({
				key: titleLineKey,
				state: {
					init: (_config, state) => ({ added: new Set(), decorations: decorationsOf(state.doc, options.placeholder) }),
					apply: (transaction, value, _old, state) => {
						if (!transaction.docChanged) {
							return value;
						}
						const kept = transaction.getMeta(titleLineKey) as { readonly added: ReadonlySet<string> } | undefined;
						return { added: kept ? kept.added : value.added, decorations: decorationsOf(state.doc, options.placeholder) };
					},
				},
				appendTransaction: (transactions, old, state) => {
					if (!transactions.some(transaction => transaction.docChanged)) {
						return null;
					}
					if (transactions.some(isBaseHalfNoteSharedChange)) {
						afterSharedChange = { before: old.doc, restores: transactions.some(isBaseHalfNoteUndoOrRedo) };
						return null;
					}
					const transaction = state.tr;
					const added = keepTitleLine(transaction, titleLineKey.getState(state)?.added ?? new Set(), { before: old.doc, restores: false });
					if (!transaction.docChanged) {
						return null;
					}
					transaction.setMeta(titleLineKey, { added });
					// What follows a load stays out of the note's undo (exact undo).
					if (transactions.some(each => each.getMeta('addToHistory') === false)) {
						transaction.setMeta('addToHistory', false);
					}
					return transaction;
				},
				view: () => ({
					update: view => {
						const change = afterSharedChange;
						if (!change) {
							return;
						}
						afterSharedChange = undefined;
						// Once the collaboration plugin's pass is over, the change goes into the shared document as its own.
						queueMicrotask(() => {
							if (view.isDestroyed) {
								return;
							}
							const transaction = view.state.tr;
							const added = keepTitleLine(transaction, titleLineKey.getState(view.state)?.added ?? new Set(), change);
							if (transaction.docChanged) {
								view.dispatch(transaction.setMeta(titleLineKey, { added }).setMeta('addToHistory', false));
							}
						});
					},
				}),
				props: {
					decorations: state => titleLineKey.getState(state)?.decorations ?? null,
				},
			}),
		],
	});
}
