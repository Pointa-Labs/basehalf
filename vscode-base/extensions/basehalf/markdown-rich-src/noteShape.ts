/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension, type BlockNoteEditor } from '@blocknote/core';
import { FilePanelExtension, FormattingToolbarExtension } from '@blocknote/core/extensions';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { addRowAfter, columnResizingPluginKey, goToNextCell, isInTable } from 'prosemirror-tables';
import { BASEHALF_RAW_PASSTHROUGH_BLOCK } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import { isBaseHalfNoteToggle } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteBlocks.js';
import { baseHalfNoteMayHold } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteStructure.js';
import { baseHalfNoteToggleState } from './noteToggleState.js';

// The shape of a note in Rich (note formats, rules 6, 45, 60 to 64, 70, and
// 71): what the note cannot store, Rich does not let the user make, and its
// keys keep the keyboard in the note.

type NoteEditor = BlockNoteEditor<any, any, any>;

const macintosh = /Mac/.test(globalThis.navigator?.platform ?? '');

export function makeBaseHalfNoteShapeExtension() {
	return createExtension({
		key: 'baseHalfNoteShape',
		// Ahead of the editor's own keys for a selected block (rule 71).
		runsBefore: ['nodeSelectionKeyboard'],
		keyboardShortcuts: {
			'Tab': ({ editor }) => tab(editor, 1),
			'Shift-Tab': ({ editor }) => tab(editor, -1),
			'Enter': ({ editor }) => enterInToggleTitle(editor),
			'Mod-Enter': ({ editor }) => actOnCaret(editor),
		},
		prosemirrorPlugins: [
			new Plugin({
				key: new PluginKey('baseHalfNoteColumnWidths'),
				// A column of a table keeps the width its cells need: Markdown
				// stores no widths of columns, so dragging a column's border
				// does nothing. The editor's resizing starts only when the
				// pointer is on a border, which it marks with a meta that this
				// filter turns away.
				filterTransaction: transaction => {
					const resizing = transaction.getMeta(columnResizingPluginKey) as { readonly setHandle?: number } | undefined;
					return resizing?.setHandle === undefined || resizing.setHandle === -1;
				},
			}),
			new Plugin({
				key: new PluginKey('baseHalfNoteTypedLetters'),
				props: { handleKeyDown: keepTypedLetters },
			}),
		],
	});
}

/** A toolbar or the file panel is open: Tab goes into it, as in the editor. */
function toolbarOpen(editor: NoteEditor): boolean {
	return !!editor.getExtension(FormattingToolbarExtension)?.store.state || editor.getExtension(FilePanelExtension)?.store.state !== undefined;
}

/**
 * Tab nests a block under the block before it when that block may hold it
 * (rule 63), Shift-Tab takes it out when the blocks after it may become its
 * children, and otherwise neither does anything; the keyboard stays in the
 * note. In a table, they move from cell to cell, and Tab in the last cell
 * adds a row (rule 61). In code, they are the code's.
 */
function tab(editor: NoteEditor, direction: 1 | -1): boolean {
	const view = editor.prosemirrorView;
	if (!view) {
		return false;
	}
	if (isInTable(view.state)) {
		if (direction === 1 && !goToNextCell(1)(view.state)) {
			addRowAfter(view.state, view.dispatch);
		}
		goToNextCell(direction)(view.state, view.dispatch);
		return true;
	}
	if (toolbarOpen(editor)) {
		return false;
	}
	const { block, prevBlock } = editor.getTextCursorPosition();
	if (block.type === 'codeBlock') {
		return false;
	}
	if (direction === 1) {
		if (prevBlock && baseHalfNoteMayHold(prevBlock) && editor.canNestBlock()) {
			editor.nestBlock();
		}
		return true;
	}
	const parent = editor.getParentBlock(block);
	if (parent && editor.canUnnestBlock()) {
		const after = parent.children.slice(parent.children.findIndex(child => child.id === block.id) + 1);
		if (after.length === 0 || baseHalfNoteMayHold(block)) {
			editor.unnestBlock();
		}
	}
	return true;
}

function toggleIsOpen(id: string): boolean {
	return baseHalfNoteToggleState.folds.get(id) ?? baseHalfNoteToggleState.initiallyOpen.has(id);
}

/**
 * Enter in a toggle's title (rule 45): at its end, an empty first block in
 * it when it is open or holds nothing, else a block after it; inside it, the
 * title cut in two, the blocks it holds staying with the first part.
 */
function enterInToggleTitle(editor: NoteEditor): boolean {
	const view = editor.prosemirrorView;
	const selection = view?.state.selection;
	if (!view || !selection || !selection.empty || !(selection instanceof TextSelection)) {
		return false;
	}
	const { block } = editor.getTextCursorPosition();
	if (!isBaseHalfNoteToggle(block)) {
		return false;
	}
	const { $head } = selection;
	const title = $head.parent;
	if ($head.parentOffset === 0) {
		// At the start, the editor's own Enter: an empty title becomes a block of its own.
		return false;
	}
	if ($head.parentOffset === title.content.size) {
		editor.transact(() => {
			if (toggleIsOpen(block.id) || block.children.length === 0) {
				const [first] = block.children.length > 0
					? editor.insertBlocks([{ type: 'paragraph' }], block.children[0], 'before')
					: editor.updateBlock(block, { children: [{ type: 'paragraph' }] }).children;
				editor.setTextCursorPosition(first, 'start');
			} else {
				const [next] = editor.insertBlocks([{ type: block.type === 'toggleListItem' ? 'toggleListItem' : 'paragraph' }], block, 'after');
				editor.setTextCursorPosition(next, 'start');
			}
		});
		return true;
	}
	splitTitle(view, $head.pos);
	return true;
}

/** Cuts the title at `position` in two; the second part is a block of the same kind after the toggle, holding nothing. */
function splitTitle(view: EditorView, position: number): void {
	const { state } = view;
	const $position = state.doc.resolve(position);
	const content = $position.parent;
	const rest = content.content.cut($position.parentOffset);
	const containerEnd = $position.after($position.depth - 1);
	const second = state.schema.nodes.blockContainer.create(null, [content.type.create(content.attrs, rest)]);
	const transaction = state.tr.delete(position, $position.end());
	const insertAt = transaction.mapping.map(containerEnd);
	transaction.insert(insertAt, second);
	transaction.setSelection(TextSelection.create(transaction.doc, insertAt + 2));
	view.dispatch(transaction.scrollIntoView());
}

/**
 * Mod-Enter acts on what is at the caret (rule 70): it opens or closes the
 * toggle whose title holds it, as a click on its arrow does, checks or
 * unchecks a check item, and opens Source at the lines of a selected fixed
 * block.
 */
function actOnCaret(editor: NoteEditor): boolean {
	const view = editor.prosemirrorView;
	if (!view) {
		return false;
	}
	const selection = view.state.selection;
	if (selection instanceof NodeSelection && selection.node.type.name === BASEHALF_RAW_PASSTHROUGH_BLOCK) {
		const element = view.nodeDOM(selection.from);
		(element instanceof HTMLElement ? element.querySelector<HTMLButtonElement>('button.basehalf-raw-passthrough-edit') : null)?.click();
		return true;
	}
	const { block } = editor.getTextCursorPosition();
	if (isBaseHalfNoteToggle(block)) {
		const element = view.dom.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"]`);
		element?.querySelector<HTMLButtonElement>('.bn-toggle-button')?.click();
		return true;
	}
	if (block.type === 'checkListItem') {
		editor.updateBlock(block, { props: { checked: !block.props.checked } });
		return true;
	}
	return false;
}

/**
 * Letters typed beside a fixed block go into the note (rule 71).
 * Command-→ at the end of a line, and Command-← at its start, keep the caret
 * there instead of selecting the fixed block after or before it; and a
 * letter typed while a fixed block is selected starts a paragraph after it.
 */
function keepTypedLetters(view: EditorView, event: KeyboardEvent): boolean {
	const { selection } = view.state;
	if (macintosh && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
		&& selection instanceof TextSelection && selection.empty) {
		const { $head } = selection;
		return event.key === 'ArrowRight' ? $head.parentOffset === $head.parent.content.size : $head.parentOffset === 0;
	}
	if (selection instanceof NodeSelection && selection.node.type.name === BASEHALF_RAW_PASSTHROUGH_BLOCK
		&& event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
		view.dispatch(paragraphAfter(view.state, selection, event.key));
		event.preventDefault();
		return true;
	}
	return false;
}

/** A transaction that adds a paragraph holding `text` after the selected block, with the caret after the text. */
function paragraphAfter(state: EditorState, selection: NodeSelection, text: string) {
	const containerEnd = selection.$from.after(selection.$from.depth);
	const paragraph = state.schema.nodes.blockContainer.create(null, [state.schema.nodes.paragraph.create(null, state.schema.text(text))]);
	const transaction = state.tr.insert(containerEnd, paragraph);
	return transaction.setSelection(TextSelection.create(transaction.doc, containerEnd + 2 + text.length)).scrollIntoView();
}
