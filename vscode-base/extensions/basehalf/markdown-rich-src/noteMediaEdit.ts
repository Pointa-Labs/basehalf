/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension } from '@blocknote/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * A picture of the note edited where it is (D113): the window draws the
 * editor of the picture over it, and the note makes room under the picture
 * for the editor's tools, and hides its own picture under the editor while the
 * editor glides back to it once the editing ended.
 */
export interface IBaseHalfNoteMediaEditMark {
	readonly blockId: string;
	/** The room under the picture, in pixels of the page. */
	readonly room: number;
	/** The note's own picture is hidden under the editor. */
	readonly hidden: boolean;
}

const EDITING_CLASS = 'basehalf-note-media-editing';
const HIDDEN_CLASS = 'basehalf-note-media-hidden';

interface INoteMediaEditState {
	readonly mark: IBaseHalfNoteMediaEditMark | undefined;
	readonly decorations: DecorationSet;
}

const noteMediaEditKey = new PluginKey<INoteMediaEditState>('baseHalfNoteMediaEdit');

/** The mark is a decoration of the picture's block: ProseMirror owns the block's element and would drop a class set on it by hand. */
function buildDecorations(doc: PmNode, mark: IBaseHalfNoteMediaEditMark | undefined): DecorationSet {
	if (!mark) {
		return DecorationSet.empty;
	}
	const decorations: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (decorations.length > 0) {
			return false;
		}
		if (node.type.name !== 'blockContainer' || node.attrs.id !== mark.blockId) {
			return true;
		}
		const content = node.firstChild;
		if (content?.type.name === 'image') {
			decorations.push(Decoration.node(pos + 1, pos + 1 + content.nodeSize, {
				class: mark.hidden ? `${EDITING_CLASS} ${HIDDEN_CLASS}` : EDITING_CLASS,
				style: `--basehalf-note-media-edit-room: ${mark.room}px`,
			}));
		}
		return false;
	});
	return DecorationSet.create(doc, decorations);
}

export function makeBaseHalfNoteMediaEditExtension() {
	return createExtension({
		key: 'baseHalfNoteMediaEdit',
		prosemirrorPlugins: [
			new Plugin<INoteMediaEditState>({
				key: noteMediaEditKey,
				state: {
					init: () => ({ mark: undefined, decorations: DecorationSet.empty }),
					apply(transaction, value, _oldState, newState) {
						const meta = transaction.getMeta(noteMediaEditKey) as { readonly mark: IBaseHalfNoteMediaEditMark | undefined } | undefined;
						if (meta) {
							return { mark: meta.mark, decorations: buildDecorations(newState.doc, meta.mark) };
						}
						if (transaction.docChanged && value.mark) {
							return { mark: value.mark, decorations: buildDecorations(newState.doc, value.mark) };
						}
						return value;
					}
				},
				props: {
					decorations(state) {
						return noteMediaEditKey.getState(state)?.decorations ?? DecorationSet.empty;
					}
				}
			})
		]
	});
}

/** Marks the picture whose editor stands over it, or none. */
export function setBaseHalfNoteMediaEditMark(view: EditorView | undefined, mark: IBaseHalfNoteMediaEditMark | undefined): void {
	if (!view) {
		return;
	}
	try {
		view.dispatch(view.state.tr.setMeta(noteMediaEditKey, { mark }));
	} catch {
		// The webview can dispose the ProseMirror view while the editing ends.
	}
}

/** The element of a picture block's picture, not of a block nested in it. */
export function baseHalfNoteMediaElement(root: HTMLElement | undefined, blockId: string): HTMLImageElement | undefined {
	const block = root?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(blockId)}"]`);
	for (const picture of block?.querySelectorAll('.bn-block-content[data-content-type="image"] img.bn-visual-media') ?? []) {
		if (picture instanceof HTMLImageElement && picture.closest('[data-node-type="blockContainer"]') === block) {
			return picture;
		}
	}
	return undefined;
}

/** The address of a version of a file of the note: the page keeps what it loaded by its address. */
export function baseHalfNoteFileAddressAt(address: string, version: string): string {
	try {
		const url = new URL(address);
		url.searchParams.set('basehalfVersion', version);
		return url.toString();
	} catch {
		return address;
	}
}
