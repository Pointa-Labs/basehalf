/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension } from '@blocknote/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/** The class of a block that a navigation reveal highlights. */
const BASEHALF_SELECTION_REVEAL_CLASS = 'basehalf-markdown-rich-selection-reveal';

export interface IBaseHalfSelectionRevealEditorApi {
	readonly prosemirrorView?: EditorView;
}

interface IBaseHalfSelectionRevealState {
	readonly blockIds: readonly string[];
	readonly decorations: DecorationSet;
}

const baseHalfSelectionRevealKey = new PluginKey<IBaseHalfSelectionRevealState>('baseHalfSelectionReveal');

function buildDecorations(doc: PmNode, blockIds: readonly string[]): DecorationSet {
	if (blockIds.length === 0) {
		return DecorationSet.empty;
	}
	const ids = new Set(blockIds);
	const decorations: Decoration[] = [];
	doc.descendants((node, pos) => {
		const id = (node.attrs as { readonly id?: string } | undefined)?.id;
		if (id && ids.has(id)) {
			decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: BASEHALF_SELECTION_REVEAL_CLASS }));
		}
		return true;
	});
	return DecorationSet.create(doc, decorations);
}

/**
 * Highlights the blocks a navigation reveal points at. The highlight is a
 * ProseMirror node decoration rather than a class set on the block element:
 * ProseMirror owns that element, redraws a node whose DOM it did not write,
 * and replaces block elements when the document syncs, so a hand-set class
 * would vanish within a frame.
 */
export function makeBaseHalfSelectionRevealExtension() {
	return createExtension({
		key: 'baseHalfSelectionReveal',
		prosemirrorPlugins: [
			new Plugin<IBaseHalfSelectionRevealState>({
				key: baseHalfSelectionRevealKey,
				state: {
					init: () => ({ blockIds: [], decorations: DecorationSet.empty }),
					apply(transaction, value, _oldState, newState) {
						const blockIds = transaction.getMeta(baseHalfSelectionRevealKey) as readonly string[] | undefined;
						if (blockIds) {
							return { blockIds, decorations: buildDecorations(newState.doc, blockIds) };
						}
						if (transaction.docChanged && value.blockIds.length > 0) {
							return { blockIds: value.blockIds, decorations: buildDecorations(newState.doc, value.blockIds) };
						}
						return value;
					}
				},
				props: {
					decorations(state) {
						return baseHalfSelectionRevealKey.getState(state)?.decorations ?? DecorationSet.empty;
					}
				}
			})
		]
	});
}

/** Highlights the blocks with these ids; an empty list removes the highlight. */
export function setBaseHalfSelectionReveal(editor: IBaseHalfSelectionRevealEditorApi, blockIds: readonly string[]): void {
	const view = editor.prosemirrorView;
	if (!view) {
		return;
	}
	try {
		view.dispatch(view.state.tr.setMeta(baseHalfSelectionRevealKey, blockIds));
	} catch {
		// The webview can dispose the ProseMirror view while a reveal is pending.
	}
}
