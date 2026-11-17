/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The comments of a note in its Rich view of Card Detail (comments): each
// comment finds its passage by its quote in the note's text, follows it while
// the note is edited, and shows a yellow wavy line under it and a mark in the
// margin to the right of the text. A note shows no highlights. The note's
// Markdown holds no trace of them.

import { createExtension } from '@blocknote/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';
import type { Doc as YDoc, XmlFragment } from 'yjs';
import { baseHalfCommentContext, findBaseHalfCommentQuote, normalizeBaseHalfCommentQuote } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentAnchor.js';
import { isBaseHalfHighlight, type IBaseHalfComment } from '../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';
import { stackCommentMarks } from '../content-viewer-src/reader/commentNotes.js';

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

/**
 * Each comment's passage: kept where the edits since left it while the
 * comment's quote is the one the note had for it, or is the passage's text
 * now, and otherwise found by its quote. A passage the user is editing keeps
 * its comment when the comments come again before the follow-up wrote its new
 * words, as they do after a change of another comment.
 */
function anchorAll(doc: PmNode, comments: readonly IBaseHalfComment[], previous: ReadonlyMap<string, INoteCommentAnchor>, quotes: ReadonlyMap<string, string | undefined>): Map<string, INoteCommentAnchor> {
	const anchors = new Map<string, INoteCommentAnchor>();
	for (const comment of comments) {
		const kept = comment.quote ? previous.get(comment.id) : undefined;
		if (kept && kept.from < kept.to && kept.to <= doc.content.size && (quotes.get(comment.id) === comment.quote
			|| normalizeBaseHalfCommentQuote(doc.textBetween(kept.from, kept.to, '\n', ' ')) === normalizeBaseHalfCommentQuote(comment.quote!))) {
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

/** The binding of the note to its shared document (y-prosemirror). */
interface IYBinding {
	readonly doc: YDoc;
	readonly type: XmlFragment;
	readonly mapping: Parameters<typeof absolutePositionToRelativePosition>[2];
}

function yBinding(state: EditorState): IYBinding | undefined {
	return (ySyncPluginKey.getState(state) as { binding?: IYBinding | null } | undefined)?.binding ?? undefined;
}

/** Where the passages are in the shared document: before their first character, and after their last. */
type MarkedAnchors = ReadonlyMap<string, { readonly from: unknown; readonly to: unknown }>;

/**
 * The binding writes each change that comes from the shared document, an
 * undo, a redo, or a merge among them, as one replacement of the whole
 * document, through which no position can follow. So the passages are marked
 * in the shared document before each of its transactions, as the binding marks
 * the selection, and found from those marks after it: a mark follows its
 * character, and a character that an undo puts back.
 */
function markAnchors(anchors: ReadonlyMap<string, INoteCommentAnchor>, binding: IYBinding): MarkedAnchors | undefined {
	try {
		const marked = new Map<string, { readonly from: unknown; readonly to: unknown }>();
		for (const [id, anchor] of anchors) {
			// After the passage's last character: text put back at its end stays out of it, as typed text does.
			const to = absolutePositionToRelativePosition(anchor.to - 1, binding.type, binding.mapping) as { assoc: number };
			to.assoc = -1;
			marked.set(id, { from: absolutePositionToRelativePosition(anchor.from, binding.type, binding.mapping), to });
		}
		return marked;
	} catch {
		// A transaction of the editor's own, before the binding wrote it: no change of the shared document follows it.
		return undefined;
	}
}

function unmarkAnchors(marked: MarkedAnchors, binding: IYBinding, doc: PmNode): Map<string, INoteCommentAnchor> {
	const anchors = new Map<string, INoteCommentAnchor>();
	for (const [id, mark] of marked) {
		const from = relativePositionToAbsolutePosition(binding.doc, binding.type, mark.from, binding.mapping);
		const to = relativePositionToAbsolutePosition(binding.doc, binding.type, mark.to, binding.mapping);
		if (from !== null && to !== null && from < to && to <= doc.content.size) {
			anchors.set(id, { from, to });
		}
	}
	return anchors;
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
			decorations.push(Decoration.inline(anchor.from, anchor.to, { class: 'note-comment-wave', 'data-comment': comment.id }));
		}
		// Each comment has a mark in the margin to the right of the text, on the
		// line its passage begins on, the way to its note, since a click in the
		// text places the caret; a comment whose passage is gone has its mark at
		// the top of the margin (comments, rules 7 and 23).
		const at = anchor ? anchor.from : Math.min(1, doc.content.size);
		const offset = anchor ? 0 : missing++;
		decorations.push(Decoration.widget(at, () => markElement(comment, handlers, offset, anchor ? labels.comment : labels.passageNotFound, !anchor), {
			side: -1,
			ignoreSelection: true,
			key: `${comment.id}:${anchor ? 'found' : `missing${offset}`}`,
			stopEvent: () => true
		}));
	}
	return DecorationSet.create(doc, decorations);
}

/** Marks of comments that begin on the same line stand one under the other, as in a PDF (comments, rule 7). */
function stackNoteMarks(dom: HTMLElement): void {
	const marks = [...dom.querySelectorAll<HTMLElement>('.note-comment-mark:not(.missing)')];
	if (marks.length < 2) {
		return;
	}
	for (const mark of marks) {
		mark.style.translate = '';
	}
	const placed = marks.map(mark => {
		const top = mark.getBoundingClientRect().top;
		return { mark, at: top, top };
	});
	for (const { mark, at, top } of stackCommentMarks(placed)) {
		if (top !== at) {
			mark.style.translate = `0 ${top - at}px`;
		}
	}
}

function markElement(comment: IBaseHalfComment, handlers: INoteCommentMarkHandlers, offset: number, label: string, missing: boolean): HTMLElement {
	const mark = document.createElement('button');
	mark.type = 'button';
	mark.className = `note-comment-mark${missing ? ' missing' : ''}`;
	mark.dataset.comment = comment.id;
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
	// The passages as marked in the shared document before its last transaction.
	let marked: MarkedAnchors | undefined;
	return createExtension({
		key: 'baseHalfNoteComments',
		prosemirrorPlugins: [
			new Plugin<INoteCommentsState>({
				key,
				state: {
					init: () => ({ comments: [], anchors: new Map(), decorations: DecorationSet.empty }),
					apply(transaction, value, oldState, newState) {
						const meta = transaction.getMeta(key) as INoteCommentsMeta | undefined;
						if (meta) {
							const previous = mapAnchors(value.anchors, transaction);
							for (const [id, anchor] of meta.known ?? []) {
								previous.set(id, anchor);
							}
							const anchors = anchorAll(newState.doc, meta.comments, previous, new Map(value.comments.map(comment => [comment.id, comment.quote])));
							for (const [id, anchor] of meta.known ?? []) {
								anchors.set(id, anchor);
							}
							return { comments: meta.comments, anchors, decorations: buildDecorations(newState.doc, meta.comments, anchors, handlers, labels) };
						}
						if (!transaction.docChanged || value.comments.length === 0) {
							return value;
						}
						const binding = (transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin ? yBinding(oldState) : undefined;
						const moved = binding && marked ? unmarkAnchors(marked, binding, newState.doc) : mapAnchors(value.anchors, transaction);
						const anchors = findLost(newState.doc, value.comments, moved);
						return { comments: value.comments, anchors, decorations: buildDecorations(newState.doc, value.comments, anchors, handlers, labels) };
					}
				},
				props: {
					decorations(state) {
						return key.getState(state)?.decorations ?? DecorationSet.empty;
					}
				},
				view: view => {
					let doc: YDoc | undefined;
					const mark = () => {
						const binding = yBinding(view.state);
						const anchors = key.getState(view.state)?.anchors;
						marked = binding && anchors?.size ? markAnchors(anchors, binding) : undefined;
					};
					// The binding comes with the view of the shared document's plugin, which may follow this one.
					const attach = () => {
						const next = yBinding(view.state)?.doc;
						if (next !== doc) {
							doc?.off('beforeAllTransactions', mark);
							doc = next;
							doc?.on('beforeAllTransactions', mark);
						}
					};
					attach();
					// The lines of the text move when the note's width changes: the marks stand anew.
					const resize = new ResizeObserver(() => stackNoteMarks(view.dom));
					resize.observe(view.dom);
					return {
						update(view, previous) {
							attach();
							const shown = key.getState(view.state);
							if (shown !== key.getState(previous)) {
								stackNoteMarks(view.dom);
							}
							if (!view.state.doc.eq(previous.doc) && (shown?.comments.length ?? 0) > 0) {
								handlers.changed();
							}
						},
						destroy() {
							resize.disconnect();
							doc?.off('beforeAllTransactions', mark);
							marked = undefined;
						}
					};
				}
			})
		]
	});
}

/**
 * Shows the comments of the note: a highlight is kept in the file and not
 * shown (comments, "Reading"), except a comment just made, in `drafts`,
 * which has no words yet. `known` gives the passage of a comment just made.
 */
export function setBaseHalfNoteComments(view: EditorView, comments: readonly IBaseHalfComment[], known?: ReadonlyMap<string, INoteCommentAnchor>, drafts?: ReadonlySet<string>): void {
	try {
		const meta: INoteCommentsMeta = { comments: comments.filter(comment => !isBaseHalfHighlight(comment) || drafts?.has(comment.id)), ...(known ? { known } : {}) };
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
