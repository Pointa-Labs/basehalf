/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The comments of a note in its Rich view of Card Detail (comments): each
// comment finds its passage by its quote in the note's text, follows it while
// the note is edited, and shows a tint under it and a mark in the margin to
// the right of the text. The note's Markdown holds no trace of them.

import { createExtension } from '@blocknote/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { baseHalfCommentContext, findBaseHalfCommentQuote, normalizeBaseHalfCommentQuote } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentAnchor.js';
import type { IBaseHalfComment } from '../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';

/** Where a comment's passage is in the document, from `from` to before `to`. */
export interface INoteCommentAnchor {
	readonly from: number;
	readonly to: number;
}

interface INoteCommentsState {
	readonly comments: readonly IBaseHalfComment[];
	readonly anchors: ReadonlyMap<string, INoteCommentAnchor>;
	readonly decorations: DecorationSet;
}

interface INoteCommentsMeta {
	readonly comments: readonly IBaseHalfComment[];
	/** Where a comment just made stands, which no quote has to be looked for. */
	readonly known?: ReadonlyMap<string, INoteCommentAnchor>;
}

/** What the marks of the margin do when the pointer is on one or clicks it. */
export interface INoteCommentMarkHandlers {
	readonly hover: (id: string, mark: HTMLElement) => void;
	readonly leave: () => void;
	readonly open: (id: string, mark: HTMLElement) => void;
	/** The note changed while it has comments: their passages may have to be quoted anew. */
	readonly changed: () => void;
}

const key = new PluginKey<INoteCommentsState>('baseHalfNoteComments');

/** The text of the document as a quote reads it, a line break between blocks, and the position before each of its characters. */
export function noteText(doc: PmNode): { readonly text: string; readonly positions: readonly number[] } {
	let text = '';
	const positions: number[] = [];
	doc.descendants((node, position) => {
		if (!node.isTextblock) {
			return true;
		}
		if (text) {
			text += '\n';
			positions.push(position);
		}
		node.forEach((child, offset) => {
			const start = position + 1 + offset;
			if (child.isText) {
				const value = child.text ?? '';
				for (let index = 0; index < value.length; index++) {
					text += value[index];
					positions.push(start + index);
				}
			} else {
				// A break or another inline node reads as a space.
				text += ' ';
				positions.push(start);
			}
		});
		return false;
	});
	positions.push(doc.content.size);
	return { text, positions };
}

/** The index in `positions` of a position, or of the first after it. */
function indexOf(positions: readonly number[], position: number): number {
	let low = 0;
	let high = positions.length - 1;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (positions[middle] < position) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

/** The passage that a range of the document quotes, and the text around it, as a comment keeps them. */
export function notePassage(doc: PmNode, from: number, to: number): { readonly quote: string; readonly before?: string; readonly after?: string } {
	const { text, positions } = noteText(doc);
	const start = indexOf(positions, from);
	const end = indexOf(positions, to);
	return { quote: normalizeBaseHalfCommentQuote(text.slice(start, end)), ...baseHalfCommentContext(text, start, end) };
}

/** Each comment's passage, kept where an edit left it while its text is still its quote, and otherwise found by its quote. */
function anchorAll(doc: PmNode, comments: readonly IBaseHalfComment[], previous: ReadonlyMap<string, INoteCommentAnchor>): Map<string, INoteCommentAnchor> {
	const anchors = new Map<string, INoteCommentAnchor>();
	for (const comment of comments) {
		const kept = comment.quote ? previous.get(comment.id) : undefined;
		if (kept && kept.from < kept.to && kept.to <= doc.content.size
			&& normalizeBaseHalfCommentQuote(doc.textBetween(kept.from, kept.to, '\n', ' ')) === normalizeBaseHalfCommentQuote(comment.quote!)) {
			anchors.set(comment.id, kept);
		}
	}
	return findLost(doc, comments, anchors);
}

/**
 * The comments without a passage in `anchors` look for their quote in the
 * document: when they are shown, and after an edit, such as an undo that gave
 * a deleted passage back (comments, rules 1 and 5).
 */
function findLost(doc: PmNode, comments: readonly IBaseHalfComment[], anchors: Map<string, INoteCommentAnchor>): Map<string, INoteCommentAnchor> {
	let text: ReturnType<typeof noteText> | undefined;
	for (const comment of comments) {
		if (!comment.quote || anchors.has(comment.id)) {
			continue;
		}
		text ??= noteText(doc);
		const match = findBaseHalfCommentQuote(text.text, comment.quote, comment.before, comment.after);
		if (match) {
			anchors.set(comment.id, { from: text.positions[match.start], to: text.positions[match.end - 1] + 1 });
		}
	}
	return anchors;
}

/** The passages follow an edit: text typed inside a passage joins it, and text typed at its ends does not (comments, rule 5). */
function mapAnchors(anchors: ReadonlyMap<string, INoteCommentAnchor>, transaction: Transaction): Map<string, INoteCommentAnchor> {
	const mapped = new Map<string, INoteCommentAnchor>();
	for (const [id, anchor] of anchors) {
		const from = transaction.mapping.map(anchor.from, 1);
		const to = transaction.mapping.map(anchor.to, -1);
		if (from < to) {
			mapped.set(id, { from, to });
		}
	}
	return mapped;
}

/** The names of a mark: a comment's, and one's whose passage is not found. */
export interface INoteCommentLabels {
	readonly comment: string;
	readonly passageNotFound: string;
}

function buildDecorations(doc: PmNode, comments: readonly IBaseHalfComment[], anchors: ReadonlyMap<string, INoteCommentAnchor>, handlers: INoteCommentMarkHandlers, labels: INoteCommentLabels): DecorationSet {
	const decorations: Decoration[] = [];
	let missing = 0;
	for (const comment of comments) {
		const anchor = anchors.get(comment.id);
		if (anchor) {
			decorations.push(Decoration.inline(anchor.from, anchor.to, { class: 'note-comment-tint', 'data-color': comment.color, 'data-comment': comment.id }));
		}
		// Each comment has a mark in the margin to the right of the text, on the
		// line its passage begins on, a highlight too, since a click in the text
		// places the caret; a comment whose passage is gone has its mark at the
		// top of the margin (comments, rules 7 and 23).
		const at = anchor ? anchor.from : Math.min(1, doc.content.size);
		const offset = anchor ? 0 : missing++;
		decorations.push(Decoration.widget(at, () => markElement(comment, handlers, offset, anchor ? labels.comment : labels.passageNotFound, !anchor), {
			side: -1,
			ignoreSelection: true,
			key: `${comment.id}:${comment.color}:${anchor ? 'found' : `missing${offset}`}`,
			stopEvent: () => true
		}));
	}
	return DecorationSet.create(doc, decorations);
}

function markElement(comment: IBaseHalfComment, handlers: INoteCommentMarkHandlers, offset: number, label: string, missing: boolean): HTMLElement {
	const mark = document.createElement('button');
	mark.type = 'button';
	mark.className = `note-comment-mark${missing ? ' missing' : ''}`;
	mark.dataset.comment = comment.id;
	mark.dataset.color = comment.color;
	mark.contentEditable = 'false';
	mark.tabIndex = -1;
	mark.setAttribute('aria-label', label);
	if (missing) {
		mark.style.marginTop = `${offset * 20}px`;
	}
	mark.addEventListener('mousedown', event => {
		event.preventDefault();
		event.stopPropagation();
	});
	mark.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		handlers.open(comment.id, mark);
	});
	mark.addEventListener('mouseenter', () => handlers.hover(comment.id, mark));
	mark.addEventListener('mouseleave', () => handlers.leave());
	return mark;
}

export function makeBaseHalfNoteCommentsExtension(handlers: INoteCommentMarkHandlers, labels: INoteCommentLabels) {
	return createExtension({
		key: 'baseHalfNoteComments',
		prosemirrorPlugins: [
			new Plugin<INoteCommentsState>({
				key,
				state: {
					init: () => ({ comments: [], anchors: new Map(), decorations: DecorationSet.empty }),
					apply(transaction, value, _oldState, newState) {
						const meta = transaction.getMeta(key) as INoteCommentsMeta | undefined;
						if (meta) {
							const previous = mapAnchors(value.anchors, transaction);
							for (const [id, anchor] of meta.known ?? []) {
								previous.set(id, anchor);
							}
							const anchors = anchorAll(newState.doc, meta.comments, previous);
							for (const [id, anchor] of meta.known ?? []) {
								anchors.set(id, anchor);
							}
							return { comments: meta.comments, anchors, decorations: buildDecorations(newState.doc, meta.comments, anchors, handlers, labels) };
						}
						if (!transaction.docChanged || value.comments.length === 0) {
							return value;
						}
						const anchors = findLost(newState.doc, value.comments, mapAnchors(value.anchors, transaction));
						return { comments: value.comments, anchors, decorations: buildDecorations(newState.doc, value.comments, anchors, handlers, labels) };
					}
				},
				props: {
					decorations(state) {
						return key.getState(state)?.decorations ?? DecorationSet.empty;
					}
				},
				view: () => ({
					update(view, previous) {
						if (!view.state.doc.eq(previous.doc) && (key.getState(view.state)?.comments.length ?? 0) > 0) {
							handlers.changed();
						}
					}
				})
			})
		]
	});
}

/** Shows these comments in the note; `known` gives the passage of a comment just made. */
export function setBaseHalfNoteComments(view: EditorView, comments: readonly IBaseHalfComment[], known?: ReadonlyMap<string, INoteCommentAnchor>): void {
	try {
		const meta: INoteCommentsMeta = { comments, ...(known ? { known } : {}) };
		view.dispatch(view.state.tr.setMeta(key, meta).setMeta('addToHistory', false));
	} catch {
		// The webview can dispose the ProseMirror view while comments arrive.
	}
}

/** The comments the note shows, and where each stands. */
export function baseHalfNoteComments(state: EditorState): { readonly comments: readonly IBaseHalfComment[]; readonly anchors: ReadonlyMap<string, INoteCommentAnchor> } {
	const value = key.getState(state);
	return { comments: value?.comments ?? [], anchors: value?.anchors ?? new Map() };
}

/** The comments whose passage was edited, quoted anew: what the file is to hold of them (comments, rule 5). */
export function baseHalfNoteCommentFollowUps(state: EditorState): IBaseHalfComment[] {
	const { comments, anchors } = baseHalfNoteComments(state);
	const changed: IBaseHalfComment[] = [];
	for (const comment of comments) {
		const anchor = anchors.get(comment.id);
		if (!anchor || !comment.quote) {
			continue;
		}
		const passage = notePassage(state.doc, anchor.from, anchor.to);
		if (passage.quote && passage.quote !== normalizeBaseHalfCommentQuote(comment.quote)) {
			const { before: _before, after: _after, ...rest } = comment;
			changed.push({ ...rest, quote: passage.quote, ...(passage.before ? { before: passage.before } : {}), ...(passage.after ? { after: passage.after } : {}) });
		}
	}
	return changed;
}
