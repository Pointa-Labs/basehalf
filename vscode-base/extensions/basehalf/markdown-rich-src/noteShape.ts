/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension, getBlockInfoFromSelection, type BlockNoteEditor } from '@blocknote/core';
import { FilePanelExtension, FormattingToolbarExtension } from '@blocknote/core/extensions';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { addRowAfter, columnResizingPluginKey, goToNextCell, isInTable } from 'prosemirror-tables';
import { openBaseHalfNoteTogglesAround } from '../../../src/vs/workbench/basehalf/cardDetail/browser/basehalfNoteOutline.js';
import { BASEHALF_RAW_PASSTHROUGH_BLOCK } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import { isBaseHalfNoteToggle } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteBlocks.js';
import { baseHalfNoteMayHold } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteStructure.js';
import { makeBaseHalfNoteMediaPlaceholders } from './noteMedia.js';
import { baseHalfNoteChangedRanges, normalizeBaseHalfNote } from './noteNormalizer.js';
import { repairBaseHalfNoteDroppedHtml } from './notePaste.js';
import { baseHalfNoteToggleState } from './noteToggleState.js';
import { createBaseHalfNoteUndoFence } from './noteUndoFence.js';

// The shape of a note in Rich (note formats, rules 6, 45, 60 to 66, 70, 71,
// and 78): what the note cannot store, Rich does not let the user make, and
// its keys keep the keyboard in the note.

type NoteEditor = BlockNoteEditor<any, any, any>;

const macintosh = /Mac/.test(globalThis.navigator?.platform ?? '');

export interface IBaseHalfNoteShapeOptions {
	/** Opens the address of a link, as Command-click on it does (rule 54). */
	readonly openLink?: (href: string) => void;
	/** Rich's undo manager, whose steps follow the kind of each change (rule 78). */
	readonly undoManager?: () => { stopCapturing(): void } | undefined;
	/** Whether Rich is reading a note or a change made outside it: what it reads is adjusted by the reader and opens no toggle (rule 80). */
	readonly reading?: () => boolean;
}

/** The blocks whose formats the last save could not write (design A5), outlined until a save writes them all. */
export const baseHalfNoteUnwrittenKey = new PluginKey<ReadonlySet<string>>('baseHalfNoteUnwritten');

export function makeBaseHalfNoteShapeExtension(options: IBaseHalfNoteShapeOptions = {}) {
	const fence = createBaseHalfNoteUndoFence(() => options.undoManager?.());
	// What the changes since the view was last drawn changed, for the toggles that open.
	let changed: [number, number][] = [];
	let dropping = false;
	return createExtension({
		key: 'baseHalfNoteShape',
		// Ahead of the editor's own keys for a selected block (rule 71).
		runsBefore: ['nodeSelectionKeyboard'],
		keyboardShortcuts: {
			'Tab': ({ editor }) => tab(editor, 1),
			'Shift-Tab': ({ editor }) => tab(editor, -1),
			'Enter': ({ editor }) => enterInToggleTitle(editor),
			'Mod-Enter': ({ editor }) => actOnCaret(editor, options),
			'Backspace': ({ editor }) => backspaceAtNestedStart(editor),
			// A move of blocks is a step of undo of its own (rule 78).
			'Shift-Mod-ArrowUp': ({ editor }) => {
				fence.ownStep(() => editor.moveBlocksUp());
				return true;
			},
			'Shift-Mod-ArrowDown': ({ editor }) => {
				fence.ownStep(() => editor.moveBlocksDown());
				return true;
			},
		},
		prosemirrorPlugins: [
			makeBaseHalfNoteMediaPlaceholders(),
			new Plugin<ReadonlySet<string>>({
				key: baseHalfNoteUnwrittenKey,
				state: {
					init: () => new Set<string>(),
					apply: (transaction, ids) => (transaction.getMeta(baseHalfNoteUnwrittenKey) as ReadonlySet<string> | undefined) ?? ids,
				},
				props: {
					decorations: state => {
						const ids = baseHalfNoteUnwrittenKey.getState(state);
						if (!ids || ids.size === 0) {
							return null;
						}
						const outlined: Decoration[] = [];
						state.doc.descendants((node, position) => {
							if (node.type.name === 'blockContainer' && ids.has(String(node.attrs.id))) {
								outlined.push(Decoration.node(position, position + node.nodeSize, { class: 'basehalf-note-unwritten' }));
							}
							return true;
						});
						return DecorationSet.create(state.doc, outlined);
					},
				},
			}),
			new Plugin({
				key: new PluginKey('baseHalfNoteNormalizer'),
				appendTransaction: (transactions, _old, state) => {
					if (options.reading?.()) {
						return null;
					}
					try {
						return normalizeBaseHalfNote(transactions, state);
					} catch (error) {
						// The change stands as it was made; the writer keeps what it cannot write (rule 9).
						console.error('[basehalf] A change of the note could not be given a shape the note stores.', error);
						return null;
					}
				},
			}),
			new Plugin({
				key: new PluginKey('baseHalfNoteUndoFence'),
				// After the transactions are applied and before the shared document takes them.
				appendTransaction: transactions => {
					for (const transaction of transactions) {
						fence.before(transaction);
					}
					return null;
				},
			}),
			new Plugin({
				key: new PluginKey('baseHalfNoteOpenToggles'),
				appendTransaction: transactions => {
					changed = options.reading?.() ? [] : baseHalfNoteChangedRanges(transactions, changed);
					return null;
				},
				view: () => ({
					update: (view, previous) => {
						const ranges = changed;
						changed = [];
						if (!options.reading?.() && (view.state.selection !== previous.selection || view.state.doc !== previous.doc)) {
							openTogglesAt(view, [view.state.selection.head, ...ranges.flat()]);
						}
					},
				}),
			}),
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
				key: new PluginKey('baseHalfNoteDrop'),
				props: {
					handleDOMEvents: {
						drop: () => {
							// The editor reads a drop's HTML right after this, in the same event.
							dropping = true;
							queueMicrotask(() => dropping = false);
							return false;
						},
					},
					// HTML dropped from another application is read as a paste is (rule 73).
					transformPastedHTML: html => dropping ? repairBaseHalfNoteDroppedHtml(html) : html,
				},
			}),
			new Plugin({
				key: new PluginKey('baseHalfNoteTypedLetters'),
				props: { handleKeyDown: keepTypedLetters },
			}),
			new Plugin({
				key: new PluginKey('baseHalfNoteCaretBeforeKeys'),
				view: view => {
					// In the capture phase: ahead of the editor's own key and clipboard handling.
					const listener = (event: KeyboardEvent) => readCaretBeforeKey(view, event);
					// The editor deletes what a cut took without saying it was a cut (rule 78).
					const cut = () => fence.ownStepNow();
					view.dom.addEventListener('keydown', listener, true);
					view.dom.addEventListener('cut', cut, true);
					return {
						destroy: () => {
							view.dom.removeEventListener('keydown', listener, true);
							view.dom.removeEventListener('cut', cut, true);
						},
					};
				},
			}),
		],
	});
}

interface IDomObserver {
	forceFlush(): void;
	flush(): void;
}

/**
 * A key acts at the caret the note shows (rule 71). A click moves the page's
 * caret at once, but the editor learns of it only when the page reports that
 * the selection changed, and a busy page can hand it keys typed after the
 * click before that report: → beside a fixed block then moved from where the
 * caret was before the click, and the letter after it went elsewhere. Before
 * each key, the editor reads the page's caret, as that report would.
 */
function readCaretBeforeKey(view: EditorView, event: KeyboardEvent): void {
	if (event.isComposing || event.keyCode === 229 || view.composing || !view.hasFocus()) {
		return;
	}
	const observer = (view as unknown as { readonly domObserver?: IDomObserver }).domObserver;
	observer?.forceFlush();
	observer?.flush();
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

/** The last block shown under the block `container` at `position`: itself, or the last block under its last child, and so on. */
function bottomBlock(container: ProseMirrorNode, position: number): { readonly node: ProseMirrorNode; readonly position: number } {
	let node = container;
	let at = position;
	for (let last = node.childCount > 1 ? node.lastChild?.lastChild : null; last; last = node.childCount > 1 ? node.lastChild?.lastChild : null) {
		// The children end where the block's group ends, two positions before the block's end.
		at += node.nodeSize - 2 - last.nodeSize;
		node = last;
	}
	return { node, position: at };
}

/**
 * Backspace at the start of a paragraph inside another block (rule 63): the
 * editor would take the paragraph out and give it the blocks after it as its
 * own, which a paragraph may not hold. Instead an empty paragraph goes, and
 * the text of another joins the line above it, the text of the block above
 * or, for the first block, of the block that holds it; the blocks after it
 * stay where they are. The last block of a block is taken out, as the
 * editor does.
 */
function backspaceAtNestedStart(editor: NoteEditor): boolean {
	const view = editor.prosemirrorView;
	const selection = view?.state.selection;
	if (!view || !(selection instanceof TextSelection) || !selection.empty) {
		return false;
	}
	const { state } = view;
	const info = getBlockInfoFromSelection(state);
	// Another kind of block first becomes a paragraph, as the editor makes it.
	if (!info.isBlockContainer || selection.from !== info.blockContent.beforePos + 1 || info.blockContent.node.type.name !== 'paragraph') {
		return false;
	}
	const $block = state.doc.resolve(info.bnBlock.beforePos);
	const index = $block.index();
	if ($block.depth < 3 || index === $block.parent.childCount - 1 || info.childContainer) {
		return false;
	}
	const above = index > 0
		? bottomBlock($block.parent.child(index - 1), $block.start() + childOffset($block.parent, index - 1))
		: { node: $block.node($block.depth - 1), position: $block.before($block.depth - 1) };
	const aboveContent = above.node.firstChild;
	if (!aboveContent) {
		return true;
	}
	const aboveContentEnd = above.position + 1 + aboveContent.nodeSize - 1;
	const transaction = state.tr;
	if (aboveContent.inlineContent) {
		// The paragraph goes, and its text, if any, goes to the end of the line above.
		transaction.delete(info.bnBlock.beforePos, info.bnBlock.afterPos);
		transaction.insert(aboveContentEnd, info.blockContent.node.content);
		transaction.setSelection(TextSelection.create(transaction.doc, aboveContentEnd));
	} else if (info.blockContent.node.childCount === 0) {
		transaction.delete(info.bnBlock.beforePos, info.bnBlock.afterPos);
		transaction.setSelection(NodeSelection.create(transaction.doc, above.position + 1));
	} else if (NodeSelection.isSelectable(aboveContent)) {
		// Above is a picture, a table, or a fixed block: it is selected, as a second Backspace deletes it.
		transaction.setSelection(NodeSelection.create(state.doc, above.position + 1));
	} else {
		return true;
	}
	view.dispatch(transaction.scrollIntoView());
	return true;
}

/** Where the child at `index` of `node` starts, from the start of `node`'s content. */
function childOffset(node: ProseMirrorNode, index: number): number {
	let offset = 0;
	for (let child = 0; child < index; child++) {
		offset += node.child(child).nodeSize;
	}
	return offset;
}

/**
 * A closed toggle opens, with the closed toggles around it, when its hidden
 * blocks hold one of `positions`: the caret, and the places a change of the
 * user's, also an undo or a redo, changed (rule 44). So a fold of code
 * unfolds when an edit or a jump goes into it: what the user types is never
 * hidden.
 */
function openTogglesAt(view: EditorView, positions: readonly number[]): void {
	const { doc } = view.state;
	for (const position of new Set(positions)) {
		if (position < 0 || position > doc.content.size) {
			continue;
		}
		const $position = doc.resolve(position);
		let hidden = false;
		for (let depth = $position.depth; depth > 1 && !hidden; depth--) {
			const container = $position.node(depth - 1);
			const content = container.firstChild;
			hidden = $position.node(depth).type.name === 'blockGroup' && container.type.name === 'blockContainer' && !!content
				&& isBaseHalfNoteToggle({ type: content.type.name, props: content.attrs }) && !toggleIsOpen(String(container.attrs.id));
		}
		if (hidden) {
			const { node } = view.domAtPos(position);
			const element = node instanceof Element ? node : node.parentElement;
			if (element) {
				openBaseHalfNoteTogglesAround(element);
			}
		}
	}
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
 * Mod-Enter acts on what is at the caret (rule 70): it opens the link that
 * holds it, opens or closes the toggle whose title holds it, as a click on
 * its arrow does, checks or unchecks a check item, and opens Source at the
 * lines of a selected fixed block.
 */
function actOnCaret(editor: NoteEditor, options: IBaseHalfNoteShapeOptions): boolean {
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
	const href = options.openLink ? linkAtCaret(view.state) : undefined;
	if (href) {
		options.openLink?.(href);
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

/** The address of the link that holds the caret: the text after it, or, at a link's end, the text before it. */
function linkAtCaret(state: EditorState): string | undefined {
	const { selection } = state;
	if (!(selection instanceof TextSelection)) {
		return undefined;
	}
	const { $from } = selection;
	for (const node of selection.empty ? [$from.nodeAfter, $from.nodeBefore] : [$from.nodeAfter]) {
		const href = node?.marks.find(mark => mark.type.name === 'link')?.attrs.href;
		if (typeof href === 'string' && href !== '') {
			return href;
		}
	}
	return undefined;
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
