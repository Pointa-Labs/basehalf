/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension, type BlockNoteEditor, type DropCursorOptions, type ExtensionOptions, type PartialBlock } from '@blocknote/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../src/vs/platform/protocol/common/basehalfMediaFiles.js';
import { baseHalfNoteMediaKind } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteMediaKind.js';
import type { IBaseHalfMarkdownRichNoteItem, IBaseHalfMarkdownRichNoteItemFailure } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownRichWebviewProtocol.js';
import { baseHalfEditorLabel } from './noteSchema.js';
import { BASEHALF_NOTE_OWN_STEP } from './noteUndoFence.js';

// Pictures, videos, sounds, and files put into a note from the slash menu
// and the add button (note formats, rule 49), pasted, or dropped: each file
// is kept in the note's own folder (files in notes, rule 12), and its block,
// a picture, a video, or a sound by the one list of media files and any other
// file a file block, is added with its address once the file is copied, in
// one step of undo. Until then a placeholder that is no part of the note
// shows the file's name. Rich never shows a block the file would not keep.
//
// Files and folders that come with their paths (files that BaseHalf or a file
// manager copied, cards copied on the canvas, items dragged from Files or from
// another app) are put in by the host, which the page asks for them: an item
// of the workspace is linked where it is, and a file from elsewhere is cloned
// into the note's folder (files in notes, rules 12, 14, and 15).

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

/** How long a paste or a drop of items waits for the host before its place says that they are being added. */
const ITEMS_SHOWN_AFTER_MS = 200;

/** What the host answers for a file put into the note: its address and the stored file's name, which its block shows. */
export interface IBaseHalfNoteStoredFile {
	readonly props: { readonly url: string; readonly name: string };
}

/** What the host made of the items a paste or a drop brought: each item's block, and the words of each that failed. */
export interface IBaseHalfNoteItems {
	readonly items: readonly IBaseHalfMarkdownRichNoteItem[];
	readonly failures: readonly IBaseHalfMarkdownRichNoteItemFailure[];
}

/**
 * Asks the host to put into the note the items of the clipboard, or those
 * of a drop: dragged from Files, at their addresses, or files dragged from
 * another app, by their paths. Undefined when there are none, or when a file
 * of the drop has no path.
 */
export type BaseHalfNoteItemsRequest = (source: 'paste' | 'drop' | 'rebase', dropped?: { readonly uris: readonly string[] } | { readonly files: readonly File[] }) => Promise<IBaseHalfNoteItems | undefined>;

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

/** How each editor asks its host for items, as its drop extension was made with. */
const itemRequests = new WeakMap<NoteEditor, BaseHalfNoteItemsRequest>();

/** A list of strings that a drag holds as JSON, or none. */
function draggedList(data: DataTransfer, type: string): string[] {
	try {
		const parsed: unknown = JSON.parse(data.getData(type) || '[]');
		return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
	} catch {
		return [];
	}
}

/**
 * The addresses of the items dragged from Files, which the editor would put
 * in as the text of their paths: by their addresses, or by their paths on
 * the disk. None for a drag of anything else.
 */
export function baseHalfNoteDraggedItems(data: DataTransfer): string[] {
	const addresses = draggedList(data, 'ResourceURLs');
	return addresses.length > 0 ? addresses : draggedList(data, 'CodeFiles').map(path => {
		const address = new URL('file:///');
		address.pathname = path;
		return address.href;
	});
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
 * file that cannot be kept as an empty block. Items dragged from Files go in
 * as the host puts them in (rule 15), not as the text of their paths. Files
 * from another app come with their paths, which only the host can read: it
 * clones them into the note's folder, their bytes never through the page.
 * Files without paths, as the picture a page gives, are copied by the page.
 */
export const makeBaseHalfNoteFileDropExtension = createExtension(({ editor, options }: ExtensionOptions<{ readonly requestItems: BaseHalfNoteItemsRequest }>) => (itemRequests.set(editor, options.requestItems), {
	key: 'baseHalfNoteFileDrop',
	prosemirrorPlugins: [new Plugin({
		key: new PluginKey('baseHalfNoteFileDrop'),
		view: view => {
			const onDrop = (event: DragEvent): void => {
				const data = editor.isEditable ? event.dataTransfer : null;
				const uris = data ? baseHalfNoteDraggedItems(data) : [];
				const files = data && uris.length === 0 ? baseHalfNoteTransferFiles(data) : [];
				if (uris.length === 0 && files.length === 0) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				const dropped = { x: event.clientX, y: event.clientY };
				if (uris.length > 0) {
					void addBaseHalfNoteItems(editor, () => options.requestItems('drop', { uris }), dropped);
					return;
				}
				void addBaseHalfNoteFilesWithPaths(editor, files, dropped);
			};
			// In the capture phase: ahead of the editor's own reading of a drop.
			view.dom.addEventListener('drop', onDrop, true);
			return { destroy: () => view.dom.removeEventListener('drop', onDrop, true) };
		},
	})],
}));

/**
 * Shows where a drag that the window holds, as one from Files, would put its
 * items, with the editor's own mark of a drop, and takes the mark away for
 * none. The editor's menu of blocks leaves the event alone, as one it made.
 */
export function showBaseHalfNoteDropPoint(editor: NoteEditor, point: { readonly x: number; readonly y: number } | undefined): void {
	const view = editor.prosemirrorView;
	if (!view || !editor.isEditable) {
		return;
	}
	const event = point
		? new DragEvent('dragover', { clientX: point.x, clientY: point.y, bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
		: new DragEvent('dragleave', { bubbles: true });
	view.dom.dispatchEvent(Object.assign(event, { synthetic: true }));
}

/**
 * The mark of a drop of files, and of a drag the window holds: a line under
 * the block they would follow, as they go in as blocks of their own after
 * it (rule 14). Text and blocks dragged in the note keep the editor's mark.
 */
export const baseHalfNoteDropCursor: DropCursorOptions = {
	hooks: {
		computeDropPosition: ({ event, view, defaultPosition }) => {
			const holdsFiles = !!event.dataTransfer?.types.includes('Files') || (event as DragEvent & { readonly synthetic?: boolean }).synthetic === true;
			if (!defaultPosition || !holdsFiles) {
				return defaultPosition;
			}
			const $position = view.state.doc.resolve(defaultPosition.pos);
			for (let depth = $position.depth; depth > 0; depth--) {
				if ($position.node(depth).type.name === 'blockContainer') {
					return { pos: $position.after(depth), orientation: 'block-horizontal' };
				}
			}
			return defaultPosition;
		},
	},
};

/** Puts the caret where something was dropped. */
function caretToDrop(view: EditorView | undefined, dropped: { readonly x: number; readonly y: number } | undefined): void {
	const at = dropped && view?.posAtCoords({ left: dropped.x, top: dropped.y });
	if (view && at) {
		view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
	}
}

/**
 * Adds `files` one after another where the caret is, or where they were
 * dropped (files in notes, rule 14): each is put in as `addBaseHalfNoteFile`
 * puts one, and a caret that follows each goes on after the last.
 */
export async function addBaseHalfNoteFiles(editor: NoteEditor, files: readonly File[], dropped?: { readonly x: number; readonly y: number }): Promise<void> {
	caretToDrop(editor.prosemirrorView, dropped);
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
	const element = addPlaceholder(view, (after ? blockEnd(view.state, after) : undefined) ?? view.state.selection.from, baseHalfEditorLabel(`Adding ${file.name}…`, `正在添加 ${file.name}…`, `正在新增 ${file.name}…`));
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
		showFailures(editor, element, [{ name: file.name, message: reason }]);
		return undefined;
	}
	return putInAtPlaceholder(editor, element, [fileBlock(stored)]);
}

/** A file kept for the note is its block whatever its name (note formats, rule 49). */
function fileBlock(stored: { readonly url: string; readonly name: string }): PartialBlock<any, any, any> {
	return { type: baseHalfNoteMediaKind(stored.url) ?? 'file', props: { url: stored.url, name: stored.name } };
}

/**
 * Puts `blocks` in where the placeholder `element` is, in one step of undo
 * that takes the placeholder away: they take the place of the empty block it
 * is in, or follow the block it is in. A caret still in that block follows
 * the last of them. Gives the id of the last.
 */
function putInAtPlaceholder(editor: NoteEditor, element: HTMLElement, blocks: PartialBlock<any, any, any>[]): string | undefined {
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
	return editor.transact(transaction => {
		const inserted = !block
			? editor.insertBlocks(blocks, editor.document[editor.document.length - 1], 'after')
			: block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0
				? editor.replaceBlocks([block], blocks).insertedBlocks
				: editor.insertBlocks(blocks, block, 'after');
		const last = inserted[inserted.length - 1];
		if (caretFollows && last) {
			if (Array.isArray(last.content)) {
				editor.setTextCursorPosition(last, 'end');
			} else {
				// After a picture, a video, a sound, or a file, the caret goes on in the line below it, as after the editor's own.
				const next = editor.getNextBlock(last);
				const line = next && Array.isArray(next.content) ? next : editor.insertBlocks([{ type: 'paragraph' }], last, 'after')[0];
				editor.setTextCursorPosition(line, 'start');
			}
		}
		transaction.setMeta(placeholderKey, { remove: element } satisfies IPlaceholderChange);
		transaction.setMeta(BASEHALF_NOTE_OWN_STEP, true);
		return last?.id;
	});
}

/** A placeholder at `position` that is no part of the note. */
function addPlaceholder(view: EditorView, position: number, text: string): HTMLElement {
	const element = document.createElement('span');
	element.className = 'basehalf-note-media-placeholder';
	element.contentEditable = 'false';
	element.textContent = text;
	view.dispatch(view.state.tr.setMeta(placeholderKey, { add: Decoration.widget(position, element, { element, side: 1, ignoreSelection: true }) } satisfies IPlaceholderChange).setMeta('addToHistory', false));
	return element;
}

function removePlaceholder(editor: NoteEditor, element: HTMLElement): void {
	const current = editor.prosemirrorView;
	if (current && placeholderPosition(current.state, element) !== undefined) {
		current.dispatch(current.state.tr.setMeta(placeholderKey, { remove: element } satisfies IPlaceholderChange).setMeta('addToHistory', false));
	}
}

/** Shows where the caret is, for 3 s, why each of `failures` could not be added. */
export function showBaseHalfNoteFailures(editor: NoteEditor, failures: readonly IBaseHalfMarkdownRichNoteItemFailure[]): void {
	const view = editor.prosemirrorView;
	if (view && failures.length > 0) {
		showFailures(editor, addPlaceholder(view, view.state.selection.from, ''), failures);
	}
}

/** Shows in `element`, failed, why each of `failures` could not be added, and takes it away after 3 s. */
function showFailures(editor: NoteEditor, element: HTMLElement, failures: readonly IBaseHalfMarkdownRichNoteItemFailure[]): void {
	element.hidden = false;
	element.textContent = failures.map(failure => failure.name
		? baseHalfEditorLabel(failure.message, `无法添加 ${failure.name}。`, `無法新增 ${failure.name}。`)
		: baseHalfEditorLabel(failure.message, '无法添加文件。', '無法新增檔案。')).join(' ');
	element.classList.add('failed');
	setTimeout(() => removePlaceholder(editor, element), FAILURE_SHOWN_MS);
}

/**
 * Puts the items a paste or a drop brought into the note where the caret
 * is, or where they were dropped (files in notes, rules 14 to 17): `request`
 * asks the host for them. Each file is its block, a picture, a video, or a
 * sound by the one list of media files and any other file a file block, and
 * each note or folder a line with its link, one after another in the order
 * they came, in one step of undo. When the host takes longer than a moment,
 * their place says that they are being added; what failed is left out, and
 * its words show there for 3 s. Gives false, and puts nothing in, when the
 * host has no items.
 */
export async function addBaseHalfNoteItems(editor: NoteEditor, request: () => Promise<IBaseHalfNoteItems | undefined>, dropped?: { readonly x: number; readonly y: number }): Promise<boolean> {
	const view = editor.prosemirrorView;
	if (!view) {
		return false;
	}
	caretToDrop(view, dropped);
	const element = addPlaceholder(view, view.state.selection.from, baseHalfEditorLabel('Adding…', '正在添加…', '正在新增…'));
	element.hidden = true;
	const shown = setTimeout(() => element.hidden = false, ITEMS_SHOWN_AFTER_MS);
	let result: IBaseHalfNoteItems | undefined;
	try {
		result = await request();
	} catch (error) {
		console.warn('[basehalf] The items could not be added to the note.', error);
	} finally {
		clearTimeout(shown);
	}
	if (!result || (result.items.length === 0 && result.failures.length === 0)) {
		removePlaceholder(editor, element);
		return !!result;
	}
	if (result.items.length === 0) {
		showFailures(editor, element, result.failures);
		return true;
	}
	const blocks = result.items.map(item => item.kind === 'link'
		? { type: 'paragraph', content: [{ type: 'link', href: item.url, content: item.name }] } satisfies PartialBlock<any, any, any>
		: fileBlock(item));
	const last = putInAtPlaceholder(editor, element, blocks);
	const current = editor.prosemirrorView;
	const end = last && current ? blockEnd(current.state, last) : undefined;
	if (result.failures.length > 0 && current && end !== undefined) {
		showFailures(editor, addPlaceholder(current, end, ''), result.failures);
	}
	return true;
}

/**
 * Adds files that the page was given, dropped from another app or chosen:
 * the host clones them into the note's folder by their paths, their bytes
 * never through the page; files that have no path are copied by the page.
 */
async function addBaseHalfNoteFilesWithPaths(editor: NoteEditor, files: readonly File[], dropped?: { readonly x: number; readonly y: number }): Promise<void> {
	const request = itemRequests.get(editor);
	if (!request || !await addBaseHalfNoteItems(editor, () => request('drop', { files }), dropped)) {
		await addBaseHalfNoteFiles(editor, files, dropped);
	}
}

/** Opens the system's file chooser for `kind` at once, and adds the files the user chooses, one block each; Cancel adds nothing. */
export function chooseBaseHalfNoteMedia(editor: NoteEditor, kind: BaseHalfNoteMediaChoice): void {
	const input = document.createElement('input');
	input.type = 'file';
	input.multiple = true;
	if (accepted[kind]) {
		input.accept = accepted[kind];
	}
	input.addEventListener('change', () => {
		const files = Array.from(input.files ?? []);
		if (files.length > 0) {
			void addBaseHalfNoteFilesWithPaths(editor, files);
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
