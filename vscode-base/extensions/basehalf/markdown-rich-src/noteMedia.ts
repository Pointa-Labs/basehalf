/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../src/vs/platform/protocol/common/basehalfMediaFiles.js';
import { baseHalfEditorLabel } from './noteSchema.js';
import { BASEHALF_NOTE_OWN_STEP } from './noteUndoFence.js';

// Pictures, videos, sounds, and files added from the slash menu and the add
// button (note formats, rule 49): the system's file chooser opens at once,
// and the block is added with its address once the file is copied, in one
// step of undo. Until then a placeholder that is no part of the note shows
// the file's name. Rich never shows a block the file would not keep.

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

/** Whether a file chosen for File is added as a link: a note, and a file whose name has no extension. */
function addedAsLink(name: string): boolean {
	const dot = name.lastIndexOf('.');
	const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
	return extension === '' || extension === '.md' || extension === '.markdown';
}

/**
 * Adds `file`, chosen for `kind`, where the caret is: a placeholder shows it
 * while it is copied, then the block takes the place of the empty block the
 * menu was in, or follows the block it was in, in one step of undo. A file
 * that cannot be copied leaves nothing but the placeholder's word for 3 s.
 */
export async function addBaseHalfNoteMediaFile(editor: NoteEditor, kind: BaseHalfNoteMediaChoice, file: File): Promise<void> {
	const view = editor.prosemirrorView;
	if (!view || !editor.uploadFile) {
		return;
	}
	const element = document.createElement('span');
	element.className = 'basehalf-note-media-placeholder';
	element.contentEditable = 'false';
	element.textContent = baseHalfEditorLabel(`Adding ${file.name}…`, `正在添加 ${file.name}…`, `正在新增 ${file.name}…`);
	const add: IPlaceholderChange = { add: Decoration.widget(view.state.selection.from, element, { element, side: 1, ignoreSelection: true }) };
	view.dispatch(view.state.tr.setMeta(placeholderKey, add).setMeta('addToHistory', false));
	const remove = (): void => {
		const current = editor.prosemirrorView;
		if (current && placeholderPosition(current.state, element) !== undefined) {
			current.dispatch(current.state.tr.setMeta(placeholderKey, { remove: element } satisfies IPlaceholderChange).setMeta('addToHistory', false));
		}
	};
	let url: string;
	try {
		const uploaded = await editor.uploadFile(file);
		if (typeof uploaded !== 'string' || uploaded === '') {
			throw new Error('The copy of the file has no address.');
		}
		url = uploaded;
	} catch (error) {
		// The placeholder tells the user; the reason is for the log.
		console.warn('[basehalf] A chosen file could not be added to the note.', error);
		element.textContent = baseHalfEditorLabel(`Could not add ${file.name}.`, `无法添加 ${file.name}。`, `無法新增 ${file.name}。`);
		element.classList.add('failed');
		setTimeout(remove, FAILURE_SHOWN_MS);
		return;
	}
	const current = editor.prosemirrorView;
	const at = current ? placeholderPosition(current.state, element) : undefined;
	if (!current || at === undefined) {
		return;
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
	const added: PartialBlock<any, any, any> = kind === 'file' && addedAsLink(file.name)
		? { type: 'paragraph', content: [{ type: 'link', href: url, content: file.name }] }
		: { type: kind, props: { url, name: file.name } };
	editor.transact(transaction => {
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
			void addBaseHalfNoteMediaFile(editor, kind, file);
		}
	}, { once: true });
	input.click();
}

/**
 * The edge of a picture or a video that the pointer drags stays under the
 * pointer while the note is magnified (note formats, rule 28): the editor
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
		event.target.dispatchEvent(new MouseEvent('mousemove', {
			bubbles: true,
			cancelable: true,
			// Whole pixels: the event keeps a whole number, and cutting a level's last fraction off would lose a pixel.
			clientX: Math.round(start + (event.clientX - start) / level),
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
