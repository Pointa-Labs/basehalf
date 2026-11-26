/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isNodeBlock, nodeToBlock, type BlockNoteEditor } from '@blocknote/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// A block of a long note found by its id (note formats, criterion 22): each
// toggle of the editor looks itself up by its id after every change, and the
// editor finds a block by walking the document to it. A note of many toggles
// was walked once for each toggle on every key.

type NoteEditor = BlockNoteEditor<any, any, any>;

const installed = new WeakSet<object>();

/**
 * Makes `editor.getBlock` find a block in an index of the blocks of each
 * document, made once for that document, instead of a walk through it: the
 * same block, the first with the id in the document's order, or none.
 */
export function installBaseHalfNoteBlockIndex(editor: NoteEditor): void {
	if (installed.has(editor)) {
		return;
	}
	installed.add(editor);
	const indexes = new WeakMap<ProseMirrorNode, Map<string, number>>();
	const positions = (doc: ProseMirrorNode): Map<string, number> => {
		let index = indexes.get(doc);
		if (!index) {
			const found = new Map<string, number>();
			doc.descendants((node, position) => {
				const id = node.attrs.id;
				if (isNodeBlock(node) && typeof id === 'string' && !found.has(id)) {
					found.set(id, position);
				}
				return true;
			});
			indexes.set(doc, found);
			index = found;
		}
		return index;
	};
	editor.getBlock = ((identifier: string | { readonly id: string }) => {
		const id = typeof identifier === 'string' ? identifier : identifier.id;
		// The document of the change being made, as the editor's own lookup reads it.
		return editor.transact(transaction => {
			const position = positions(transaction.doc).get(id);
			const node = position === undefined ? undefined : transaction.doc.nodeAt(position);
			return node && node.attrs.id === id ? nodeToBlock(node, editor.pmSchema) : undefined;
		});
	}) as NoteEditor['getBlock'];
}
