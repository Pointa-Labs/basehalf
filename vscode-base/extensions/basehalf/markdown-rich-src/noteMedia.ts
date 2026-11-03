/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension, type BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../src/vs/platform/protocol/common/basehalfMediaFiles.js';
import { baseHalfNoteMediaKind } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteMediaKind.js';
import { baseHalfEditorLabel } from './noteSchema.js';
import { BASEHALF_NOTE_OWN_STEP } from './noteUndoFence.js';

// Pictures, videos, sounds, and files put into a note from the slash menu
// and the add button (note formats, rule 49), pasted, or dropped: each file
// is kept in the note's own folder (files in notes, rule 12), and its block,
// a picture, a video, or a sound by the one list of media files and any other
// file a file block, is added with its address once the file is copied, in
// one step of undo. Until then a placeholder that is no part of the note
// shows the file's name. Rich never shows a block the file would not keep.

type NoteEditor = BlockNoteEditor<any, any, any>;

export type BaseHalfNoteMediaChoice = 'image' | 'video' | 'audio' | 'file';

const accepted: Readonly<Record<BaseHalfNoteMediaChoice, string>> = {
	image: BASEHALF_MEDIA_FILE_EXTENSIONS.image.join(','),
	video: BASEHALF_MEDIA_FILE_EXTENSIONS.video.join(','),
	audio: BASEHALF_MEDIA_FILE_EXTENSIONS.audio.join(','),
	file: '',
};

/** How long a placeholder says that a file could not be added. */
const FAILURE_SHOWN_MS = 3000;

/** What the host answers for a file put into the note: its address and the stored file's name, which its block shows. */
export interface IBaseHalfNoteStoredFile {
	readonly props: { readonly url: string; readonly name: string };
}

/**
 * The kinds of data the editor reads a paste or a drop as, first to last.
 * Files are read only when nothing before them is there, as the editor reads
 * them.
 */
const editorReadOrder = ['vscode-editor-data', 'blocknote/html', 'text/markdown', 'text/html', 'text/plain', 'Files'];

/**
 * The files a paste or a drop puts into the note (note formats, rule 72):
 * files copied or dragged alone, and the picture that a page or an app
 * copies beside the HTML of that one picture. Nothing for any other paste.
 */
export function baseHalfNoteTransferFiles(data: DataTransfer): File[] {
	const files = Array.from(data.files);
	if (files.length === 0) {
		return [];
	}
	const first = editorReadOrder.find(type => data.types.includes(type));
	if (first === 'Files') {
		return files;
	}
	return first === 'text/html' && isOnePicture(data.getData('text/html')) ? files.filter(file => file.type.startsWith('image/')) : [];
}

/** Whether HTML holds one picture and no text: what a page or an app copies for a picture. */
function isOnePicture(html: string): boolean {
	const template = document.createElement('template');
	template.innerHTML = html;
	return template.content.querySelectorAll('img').length === 1 && (template.content.textContent ?? '').trim() === '';
}

interface IPlaceholderChange {
	readonly add?: Decoration;
	readonly remove?: HTMLElement;
}

const placeholderKey = new PluginKey<DecorationSet>('baseHalfNoteMediaPlaceholders');

/** The placeholders of files being added, which follow the text around them. */
export function makeBaseHalfNoteMediaPlaceholders(): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: placeholderKey,
		state: {
			init: () => DecorationSet.empty,
			apply: (transaction, set) => {
				let next = set.map(transaction.mapping, transaction.doc);
				const change = transaction.getMeta(placeholderKey) as IPlaceholderChange | undefined;
				if (change?.add) {
					next = next.add(transaction.doc, [change.add]);
				}
				if (change?.remove) {
					next = next.remove(next.find(undefined, undefined, spec => spec.element === change.remove));
				}
				return next;
			},
		},
		props: { decorations: state => placeholderKey.getState(state) },
	});
}

function placeholderPosition(state: EditorState, element: HTMLElement): number | undefined {
	return placeholderKey.getState(state)?.find(undefined, undefined, spec => spec.element === element)[0]?.from;
}

/**
 * Files dropped on the note go in where they were let go (files in notes,
 * rule 12), ahead of the editor's own reading of a drop, which would leave a
 * file that cannot be kept as an empty block.
 */
export const makeBaseHalfNoteFileDropExtension = createExtension(({ editor }: { readonly editor: NoteEditor }) => ({
	key: 'baseHalfNoteFileDrop',
	prosemirrorPlugins: [new Plugin({
		key: new PluginKey('baseHalfNoteFileDrop'),
		view: view => {
			const onDrop = (event: DragEvent): void => {
				const files = editor.isEditable && event.dataTransfer ? baseHalfNoteTransferFiles(event.dataTransfer) : [];
				if (files.length === 0) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				void addBaseHalfNoteFiles(editor, files, { x: event.clientX, y: event.clientY });
			};
			// In the capture phase: ahead of the editor's own reading of a drop.
			view.dom.addEventListener('drop', onDrop, true);
			return { destroy: () => view.dom.removeEventListener('drop', onDrop, true) };
		},
	})],
}));

/**
 * Adds `files` one after another where the caret is, or where they were
 * dropped (files in notes, rule 14): each is put in as `addBaseHalfNoteFile`
 * puts one, and a caret that follows each goes on after the last.
 */
export async function addBaseHalfNoteFiles(editor: NoteEditor, files: readonly File[], dropped?: { readonly x: number; readonly y: number }): Promise<void> {
	const view = editor.prosemirrorView;
	const at = dropped && view?.posAtCoords({ left: dropped.x, top: dropped.y });
	if (view && at) {
		view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
	}
	let after: string | undefined;
	for (const file of files) {
		after = await addBaseHalfNoteFile(editor, file, after) ?? after;
	}
}

/** The place at the end of the block `id`, after its content and before its children. */
function blockEnd(state: EditorState, id: string): number | undefined {
	let end: number | undefined;
	state.doc.descendants((node, position) => {
		if (end !== undefined) {
			return false;
		}
		if (node.type.name === 'blockContainer' && node.attrs.id === id && node.firstChild) {
			end = position + 1 + node.firstChild.nodeSize;
		}
		return end === undefined;
	});
	return end;
}

/**
 * Adds `file` where the caret is, or after the block `after`: a placeholder
 * shows it while it is copied, then the block takes the place of the empty
 * block the caret was in, or follows the block it was in, in one step of
 * undo, and its id is given back. A file that
 * cannot be copied leaves nothing but the placeholder's words for 3 s, which
 * say why.
 */
export async function addBaseHalfNoteFile(editor: NoteEditor, file: File, after?: string): Promise<string | undefined> {
	const view = editor.prosemirrorView;
	if (!view || !editor.uploadFile) {
		return undefined;
	}
	const element = document.createElement('span');
	element.className = 'basehalf-note-media-placeholder';
	element.contentEditable = 'false';
	element.textContent = baseHalfEditorLabel(`Adding ${file.name}…`, `正在添加 ${file.name}…`, `正在新增 ${file.name}…`);
	const add: IPlaceholderChange = { add: Decoration.widget((after ? blockEnd(view.state, after) : undefined) ?? view.state.selection.from, element, { element, side: 1, ignoreSelection: true }) };
	view.dispatch(view.state.tr.setMeta(placeholderKey, add).setMeta('addToHistory', false));
	const remove = (): void => {
		const current = editor.prosemirrorView;
		if (current && placeholderPosition(current.state, element) !== undefined) {
			current.dispatch(current.state.tr.setMeta(placeholderKey, { remove: element } satisfies IPlaceholderChange).setMeta('addToHistory', false));
		}
	};
	let stored: IBaseHalfNoteStoredFile['props'];
	try {
		const uploaded = await editor.uploadFile(file) as IBaseHalfNoteStoredFile | string;
		stored = typeof uploaded === 'string' ? { url: uploaded, name: file.name } : uploaded.props;
		if (!stored.url) {
			throw new Error(`Could not add ${file.name}.`);
		}
	} catch (error) {
		// The placeholder tells the user why, in plain words (files in notes, rule 49).
		console.warn('[basehalf] A file could not be added to the note.', error);
		const reason = error instanceof Error && error.message.startsWith('Could not add ') ? error.message : `Could not add ${file.name}.`;
		element.textContent = baseHalfEditorLabel(reason, `无法添加 ${file.name}。`, `無法新增 ${file.name}。`);
		element.classList.add('failed');
		setTimeout(remove, FAILURE_SHOWN_MS);
		return undefined;
	}
	const current = editor.prosemirrorView;
	const at = current ? placeholderPosition(current.state, element) : undefined;
	if (!current || at === undefined) {
		return undefined;
	}
	const $at = current.state.doc.resolve(at);
	let id: string | undefined;
	for (let depth = $at.depth; depth > 0 && id === undefined; depth--) {
		const node = $at.node(depth);
		id = node.type.name === 'blockContainer' ? String(node.attrs.id) : undefined;
	}
	const block = id ? editor.getBlock(id) : undefined;
	// The caret still in the block the menu was in follows the added block; one put elsewhere meanwhile stays.
	const caretFollows = !!block && editor.getTextCursorPosition().block.id === block.id;
	// A file kept for the note is its block whatever its name (note formats, rule 49).
	const added: PartialBlock<any, any, any> = { type: baseHalfNoteMediaKind(stored.url) ?? 'file', props: { url: stored.url, name: stored.name } };
	return editor.transact(transaction => {
		const [inserted] = !block
			? editor.insertBlocks([added], editor.document[editor.document.length - 1], 'after')
			: block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0
				? editor.replaceBlocks([block], [added]).insertedBlocks
				: editor.insertBlocks([added], block, 'after');
		if (caretFollows && inserted) {
			if (Array.isArray(inserted.content)) {
				editor.setTextCursorPosition(inserted, 'end');
			} else {
				// After a picture, a video, a sound, or a file, the caret goes on in the line below it, as after the editor's own.
				const next = editor.getNextBlock(inserted);
				const line = next && Array.isArray(next.content) ? next : editor.insertBlocks([{ type: 'paragraph' }], inserted, 'after')[0];
				editor.setTextCursorPosition(line, 'start');
			}
		}
		transaction.setMeta(placeholderKey, { remove: element } satisfies IPlaceholderChange);
		transaction.setMeta(BASEHALF_NOTE_OWN_STEP, true);
		return inserted?.id;
	});
}

/** Opens the system's file chooser for `kind` at once, and adds what the user chooses; Cancel adds nothing. */
export function chooseBaseHalfNoteMedia(editor: NoteEditor, kind: BaseHalfNoteMediaChoice): void {
	const input = document.createElement('input');
	input.type = 'file';
	if (accepted[kind]) {
		input.accept = accepted[kind];
	}
	input.addEventListener('change', () => {
		const file = input.files?.[0];
		if (file) {
			void addBaseHalfNoteFile(editor, file);
		}
	}, { once: true });
	input.click();
}

/**
 * The edge of a picture or a video that the pointer drags stays under the
 * pointer while the note is magnified (note formats, rule 8): the editor
 * gives the block the pointer's movement on the screen as its width at
 * 100%, so on a page drawn `scale()` times larger each movement is divided
 * by that before the editor sees it. Returns what removes it.
 */
export function installBaseHalfNoteResizeUnderZoom(page: Window, scale: () => number): () => void {
	let start: number | undefined;
	const onDown = (event: MouseEvent): void => {
		start = event.target instanceof Element && event.target.closest('.bn-resize-handle') ? event.clientX : undefined;
	};
	const onMove = (event: MouseEvent): void => {
		const level = scale();
		if (start === undefined || !event.isTrusted || level === 1 || !event.target) {
			return;
		}
		// The editor's own listener on the page takes the movement in the page's measure instead.
		event.stopImmediatePropagation();
		// A pointer's event keeps the fraction of a pixel that a mouse's event cuts off, which at 400% is up to 4
		// pixels on the screen: the edge stays under the pointer, and the width is stored whole once the drag ends.
		event.target.dispatchEvent(new PointerEvent('mousemove', {
			bubbles: true,
			cancelable: true,
			clientX: start + (event.clientX - start) / level,
			clientY: event.clientY,
			screenX: event.screenX,
			screenY: event.screenY,
			button: event.button,
			buttons: event.buttons,
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			shiftKey: event.shiftKey,
		}));
	};
	const onUp = (): void => {
		start = undefined;
	};
	page.addEventListener('mousedown', onDown, true);
	page.addEventListener('mousemove', onMove, true);
	page.addEventListener('mouseup', onUp, true);
	return () => {
		page.removeEventListener('mousedown', onDown, true);
		page.removeEventListener('mousemove', onMove, true);
		page.removeEventListener('mouseup', onUp, true);
	};
}
