/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension } from '@blocknote/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { baseHalfAdhdKeywordHits } from '../../../src/vs/workbench/basehalf/common/basehalfAdhd.js';

export interface IBaseHalfAdhdDecorationPayload {
	readonly enabled: boolean;
	readonly readBlockIds: readonly string[];
	readonly keywords: readonly string[];
}

export interface IBaseHalfAdhdEditorApi {
	readonly prosemirrorView?: EditorView;
}

interface IBaseHalfAdhdDecorationState {
	readonly payload: IBaseHalfAdhdDecorationPayload;
	readonly decorations: DecorationSet;
}

const EMPTY_PAYLOAD: IBaseHalfAdhdDecorationPayload = {
	enabled: false,
	readBlockIds: [],
	keywords: []
};

const baseHalfAdhdDecorationKey = new PluginKey<IBaseHalfAdhdDecorationState>('baseHalfAdhdDecorations');

function renderCheckbox(id: string, read: boolean): HTMLElement {
	const el = document.createElement('span');
	el.className = read ? 'basehalf-adhd-check basehalf-adhd-check-checked' : 'basehalf-adhd-check';
	el.setAttribute('data-basehalf-adhd-block-id', id);
	el.setAttribute('contenteditable', 'false');
	el.setAttribute('role', 'checkbox');
	el.setAttribute('aria-checked', read ? 'true' : 'false');
	el.title = read ? 'Mark unread' : 'Mark read';
	return el;
}

function buildDecorations(doc: PmNode, payload: IBaseHalfAdhdDecorationPayload): DecorationSet {
	if (!payload.enabled) {
		return DecorationSet.empty;
	}

	const readSet = new Set(payload.readBlockIds);
	const decorations: Decoration[] = [];
	const rootGroup = doc.firstChild;
	doc.descendants((node, pos, parent) => {
		const id = (node.attrs as { readonly id?: string } | undefined)?.id;
		if (id && node.firstChild && parent === rootGroup) {
			const read = readSet.has(id);
			decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'basehalf-adhd-block' }));
			const innerStart = pos + 1;
			decorations.push(Decoration.node(innerStart, innerStart + node.firstChild.nodeSize, {
				class: read ? 'basehalf-adhd-read' : 'basehalf-adhd-unread'
			}));
			decorations.push(Decoration.widget(pos + 1, () => renderCheckbox(id, read), {
				side: -1,
				key: `basehalf-adhd-check-${id}-${read ? 1 : 0}`,
				ignoreSelection: true
			}));
		}

		if (node.isText && node.text && payload.keywords.length > 0) {
			for (const [start, end] of baseHalfAdhdKeywordHits(node.text, payload.keywords)) {
				decorations.push(Decoration.inline(pos + start, pos + end, { class: 'basehalf-adhd-keyword' }));
			}
		}

		return true;
	});

	return DecorationSet.create(doc, decorations);
}

export function makeBaseHalfAdhdDecorationExtension() {
	return createExtension({
		key: 'baseHalfAdhdDecorations',
		prosemirrorPlugins: [
			new Plugin<IBaseHalfAdhdDecorationState>({
				key: baseHalfAdhdDecorationKey,
				state: {
					init: () => ({ payload: EMPTY_PAYLOAD, decorations: DecorationSet.empty }),
					apply(transaction, value, _oldState, newState) {
						const meta = transaction.getMeta(baseHalfAdhdDecorationKey) as IBaseHalfAdhdDecorationPayload | undefined;
						if (meta) {
							return { payload: meta, decorations: buildDecorations(newState.doc, meta) };
						}
						if (transaction.docChanged) {
							return {
								payload: value.payload,
								decorations: buildDecorations(newState.doc, value.payload)
							};
						}
						return value;
					}
				},
				props: {
					decorations(state) {
						return baseHalfAdhdDecorationKey.getState(state)?.decorations ?? DecorationSet.empty;
					}
				}
			})
		]
	});
}

export function pushBaseHalfAdhdDecorations(editor: IBaseHalfAdhdEditorApi, payload: IBaseHalfAdhdDecorationPayload): void {
	const view = editor.prosemirrorView;
	if (!view) {
		return;
	}
	try {
		view.dispatch(view.state.tr.setMeta(baseHalfAdhdDecorationKey, payload));
	} catch {
		// The webview can dispose the ProseMirror view while a host update is in flight.
	}
}
