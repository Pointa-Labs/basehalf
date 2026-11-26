/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BlockNoteEditor } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { SelectionBookmark } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { UndoManager } from 'yjs';
import { isBaseHalfNoteToggle } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteBlocks.js';
import { baseHalfNoteToggleIsOpen } from './noteToggleState.js';
import { BASEHALF_NOTE_OWN_STEP } from './noteUndoFence.js';

// The line the add button makes (the menu of blocks in a note, rules 20 to 33).
// The menu filters in a real line of the note, as `/` does, so that letters and
// an input method go where the user writes. But the note should not change until
// the user chooses: a line that goes as it came leaves the note, and the lists of
// undo and redo, as they were; and a block chosen from the menu is one step of
// undo with its line, however long the menu stayed open and whatever was typed.

type NoteEditor = BlockNoteEditor<any, any, any>;

/** Where a line goes: before or after a block, by its id. */
export interface IBaseHalfNoteLinePlace {
	readonly reference: string;
	readonly side: 'before' | 'after';
}

export interface IBaseHalfNoteAddedLine {
	/** What the add button beside the block `blockId` does. */
	add(blockId: string): void;
	/** Runs what a chosen row does, which makes its block of the caret's line, as one step of undo with a line that waits. */
	choose(run: () => void): void;
	/** Lets a line that waits stay under a file chooser; what it gives ends that, once the chooser has given all it will. */
	holdForChooser(): () => void;
	/** The menu has closed: a line that still holds nothing goes (rules 25 to 29). */
	settle(): void;
	/** Takes the line that waits away, as if it had not been there, when it is the block `blockId` and holds nothing, and gives where it stood. */
	take(blockId: string): IBaseHalfNoteLinePlace | undefined;
	dispose(): void;
}

interface IWaitingLine {
	readonly id: string;
	readonly place: IBaseHalfNoteLinePlace;
	/** The note, the caret, and the lists of undo and redo before the button was clicked. */
	readonly doc: ProseMirrorNode;
	readonly selection: SelectionBookmark;
	readonly undoStack: UndoManager['undoStack'];
	readonly redoStack: UndoManager['redoStack'];
	underChooser: boolean;
}

/** Each editor's line, for what puts blocks into the note from elsewhere than the menu. */
const addedLines = new WeakMap<NoteEditor, IBaseHalfNoteAddedLine>();

/** The added line of `editor`, when it has one. */
export function baseHalfNoteAddedLineOf(editor: NoteEditor): IBaseHalfNoteAddedLine | undefined {
	return addedLines.get(editor);
}

/** A block the menu can act in, which the button therefore adds no line for: `/` and its menu do not work in code. */
function isEmptyForTheMenu(block: { readonly type: string; readonly content?: unknown }): boolean {
	return block.type !== 'codeBlock' && Array.isArray(block.content) && block.content.length === 0;
}

function holdsNothing(block: { readonly type: string; readonly content?: unknown; readonly children: readonly unknown[] }): boolean {
	return block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0 && block.children.length === 0;
}

/** Directly under the block `block`: the first of the children it shows, or else after it and what it hides (rule 21). */
function placeUnder(block: { readonly id: string; readonly type: string; readonly props?: unknown; readonly children: readonly { readonly id: string }[] }): IBaseHalfNoteLinePlace {
	const showsChildren = block.children.length > 0 && (!isBaseHalfNoteToggle(block) || baseHalfNoteToggleIsOpen(block.id));
	return showsChildren ? { reference: block.children[0].id, side: 'before' } : { reference: block.id, side: 'after' };
}

/** The id of the block the caret is in. */
function caretBlockId(view: EditorView): string | undefined {
	const { $from } = view.state.selection;
	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth);
		if (node.type.name === 'blockContainer') {
			return String(node.attrs.id);
		}
	}
	return undefined;
}

/** The added line of `editor`, over the undo manager that `manager` gives, which may change while the note is open. */
export function createBaseHalfNoteAddedLine(editor: NoteEditor, manager: () => UndoManager | undefined): IBaseHalfNoteAddedLine {
	let waiting: IWaitingLine | undefined;
	// A press that closes the menu is still going when the menu closes.
	let pressed = false;
	let settleOnRelease = false;
	// The block a press began on. The caret cannot say: the browser tells the editor of a click's caret some time after the click.
	let pressedBlock: string | undefined;

	const openMenu = (): void => {
		editor.getExtension(SuggestionMenu)?.openSuggestionMenu('/');
	};

	/** Takes the line away. When the note is then as it was before the click, so are the lists of undo and redo, and with `caretBack` the caret. */
	const withdraw = (line: IWaitingLine, caretBack: boolean): void => {
		waiting = undefined;
		if (editor.getBlock(line.id)) {
			editor.transact(transaction => {
				transaction.setMeta('addToHistory', false);
				editor.removeBlocks([line.id]);
			});
		}
		const view = editor.prosemirrorView;
		if (!view || !view.state.doc.eq(line.doc)) {
			return;
		}
		const undo = manager();
		if (undo) {
			undo.undoStack = line.undoStack;
			undo.redoStack = line.redoStack;
			undo.stopCapturing();
		}
		if (caretBack) {
			view.dispatch(view.state.tr.setSelection(line.selection.resolve(view.state.doc)).setMeta('addToHistory', false));
		}
	};

	const finish = (byPointer: boolean): void => {
		const line = waiting;
		if (!line || line.underChooser || editor.getExtension(SuggestionMenu)?.shown()) {
			return;
		}
		const block = editor.getBlock(line.id);
		if (block && !holdsNothing(block)) {
			waiting = undefined;
			return;
		}
		if (byPointer && pressedBlock === line.id) {
			// A click into the line keeps it (rule 27).
			waiting = undefined;
			return;
		}
		const view = editor.prosemirrorView;
		withdraw(line, !byPointer && !!block && !!view && caretBlockId(view) === block.id);
	};

	const onPress = (event: PointerEvent): void => {
		pressed = true;
		pressedBlock = event.target instanceof Element ? event.target.closest('[data-node-type="blockContainer"]')?.getAttribute('data-id') ?? undefined : undefined;
	};
	const onRelease = (): void => {
		pressed = false;
		if (settleOnRelease) {
			settleOnRelease = false;
			// After the press's own handlers, which read the page where the user aimed (rule 26).
			setTimeout(() => finish(true));
		}
	};
	// A line that goes by an undo, or by a write from outside, takes the menu that stands on it along (rule 29).
	const offChange = editor.onChange(() => {
		if (waiting && !editor.getBlock(waiting.id)) {
			queueMicrotask(() => editor.getExtension(SuggestionMenu)?.closeMenu());
		}
	});
	document.addEventListener('pointerdown', onPress, true);
	// On the window, after the editor's own listener on the document.
	window.addEventListener('mouseup', onRelease);
	window.addEventListener('pointercancel', onRelease);
	window.addEventListener('blur', onRelease);

	const line: IBaseHalfNoteAddedLine = {
		add: blockId => {
			const block = editor.getBlock(blockId);
			const view = editor.prosemirrorView;
			if (!block || !view) {
				return;
			}
			if (isEmptyForTheMenu(block)) {
				editor.setTextCursorPosition(block);
				openMenu();
				return;
			}
			const undo = manager();
			const place = placeUnder(block);
			const before = {
				place,
				doc: view.state.doc,
				selection: view.state.selection.getBookmark(),
				undoStack: [...undo?.undoStack ?? []],
				redoStack: [...undo?.redoStack ?? []],
				underChooser: false,
			};
			const id = editor.transact(transaction => {
				transaction.setMeta(BASEHALF_NOTE_OWN_STEP, true);
				const [made] = editor.insertBlocks([{ type: 'paragraph' }], place.reference, place.side);
				editor.setTextCursorPosition(made);
				return made.id;
			});
			waiting = { id, ...before };
			openMenu();
		},
		choose: run => {
			const held = waiting;
			if (!held) {
				run();
				return;
			}
			// The line and what the row makes of it become one step: the line goes as it came, and comes again in that step.
			withdraw(held, false);
			editor.transact(transaction => {
				transaction.setMeta(BASEHALF_NOTE_OWN_STEP, true);
				const [made] = editor.insertBlocks([{ type: 'paragraph' }], held.place.reference, held.place.side);
				editor.setTextCursorPosition(made);
				run();
			});
		},
		holdForChooser: () => {
			const held = waiting;
			if (held) {
				held.underChooser = true;
			}
			return () => {
				if (held && waiting === held) {
					held.underChooser = false;
					finish(false);
				}
			};
		},
		settle: () => {
			if (pressed) {
				settleOnRelease = true;
			} else {
				finish(false);
			}
		},
		take: blockId => {
			const held = waiting;
			if (!held || held.id !== blockId) {
				return undefined;
			}
			const block = editor.getBlock(blockId);
			if (!block || !holdsNothing(block)) {
				waiting = undefined;
				return undefined;
			}
			withdraw(held, false);
			return held.place;
		},
		dispose: () => {
			addedLines.delete(editor);
			offChange();
			document.removeEventListener('pointerdown', onPress, true);
			window.removeEventListener('mouseup', onRelease);
			window.removeEventListener('pointercancel', onRelease);
			window.removeEventListener('blur', onRelease);
		},
	};
	addedLines.set(editor, line);
	return line;
}
