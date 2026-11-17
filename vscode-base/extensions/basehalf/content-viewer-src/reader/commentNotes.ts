/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The comment note and the tools of a highlight, which every page that shows
// comments draws alike (comments, "How comments show").

import './comments.css';
import type { BaseHalfCommentStep } from '../../../../src/vs/workbench/basehalf/comments/common/basehalfCommentProtocol.js';
import { BASEHALF_COMMENT_COLORS, baseHalfCommentCut, BaseHalfCommentColor, baseHalfCommentTime, IBaseHalfComment, IBaseHalfCommentReply, isBaseHalfHighlight } from '../../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';
import type { IBaseHalfReaderLabels } from '../../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { besideAnchor, element, iconButton } from './readerDom.js';

/** A note is saved this long after the typing stops (comments, rule 14). */
const SAVE_DELAY_MS = 1_000;
const HOVER_SHOW_MS = 300;
const HOVER_HIDE_MS = 200;
const NOTE_WIDTH = 240;

export interface ICommentNotesOptions {
	readonly root: HTMLElement;
	readonly labels: IBaseHalfReaderLabels;
	/** Keeps a change of a comment, or takes one away by its id. */
	readonly change: (step: BaseHalfCommentStep, comment: IBaseHalfComment | undefined, remove?: string) => void;
	/** The comment whose note is open, or the highlight whose tools are, or none: what the record of the selection names. */
	readonly focus: (id: string | undefined) => void;
	/** Grow branch of a comment; without it, a note offers none. */
	readonly grow?: (comment: IBaseHalfComment) => void;
	/** A comment that was made and closed without words: the page takes its wavy line away. */
	readonly discard: (comment: IBaseHalfComment) => void;
	/** The note or the tools closed: the page shows what it shows at rest. */
	readonly closed?: () => void;
	/**
	 * Comment in the tools of a highlight: the page opens the note of a comment
	 * on its passage, or makes one there (comments, rule 10). Without it, the
	 * tools offer no Comment.
	 */
	readonly commentOn?: (highlight: IBaseHalfComment, anchor: DOMRect) => void;
}

interface IOpenNote {
	readonly element: HTMLElement;
	comment: IBaseHalfComment;
	readonly pinned: boolean;
	/** Made by Comment and not saved yet: closing it without words leaves nothing. */
	unsaved: boolean;
	readonly text?: HTMLElement;
	saveTimer?: number;
}

export function colorLabel(labels: IBaseHalfReaderLabels, color: BaseHalfCommentColor): string {
	return labels[color];
}

/** The size of a comment's mark (comments.css), and the room between two marks one under the other. */
const MARK_SIZE = 14;
const MARK_GAP = 3;

/**
 * Marks that would cover one another stand one under the other, in the order
 * of their places: each keeps its place unless the mark above reaches into it
 * (comments, rule 7).
 */
export function stackCommentMarks<T extends { readonly top: number }>(marks: readonly T[]): T[] {
	let next = -Infinity;
	return [...marks].sort((a, b) => a.top - b.top).map(mark => {
		const top = Math.max(mark.top, next);
		next = top + MARK_SIZE + MARK_GAP;
		return top === mark.top ? mark : { ...mark, top };
	});
}

/** The comment note and the tools of a highlight. Only one is open at a time (comments, rule 11). */
export class CommentNotes {
	private note: IOpenNote | undefined;
	private hoverTimer: number | undefined;
	private hoverComment: string | undefined;

	constructor(private readonly options: ICommentNotesOptions) {
		window.addEventListener('pointerdown', event => {
			const note = this.note;
			if (note?.pinned && event.target instanceof Node && !note.element.contains(event.target)) {
				this.close();
			}
		}, true);
	}

	/** A press in a document of the page that holds no note, such as a section of a book: an open note closes. */
	pressedOutside(): void {
		if (this.note?.pinned) {
			this.close();
		}
	}

	/** The comment whose note or tools are open. */
	get openId(): string | undefined {
		return this.note?.pinned ? this.note.comment.id : undefined;
	}

	get isOpen(): boolean {
		return !!this.note?.pinned;
	}

	/** The pointer came onto a mark or the passage of a comment: its note shows after a moment, with `status` under its words. */
	hoverEnter(comment: IBaseHalfComment, anchor: () => DOMRect | undefined, status?: string): void {
		if (this.note?.pinned || isBaseHalfHighlight(comment)) {
			return;
		}
		window.clearTimeout(this.hoverTimer);
		if (this.note && this.note.comment.id === comment.id) {
			return;
		}
		this.hoverComment = comment.id;
		this.hoverTimer = window.setTimeout(() => {
			const rect = anchor();
			if (rect && this.hoverComment === comment.id && !this.note?.pinned) {
				this.show(comment, rect, false, false, status);
			}
		}, HOVER_SHOW_MS);
	}

	/** The pointer left a mark or a passage; the note goes a moment later unless the pointer is on it. */
	hoverLeave(): void {
		this.hoverComment = undefined;
		window.clearTimeout(this.hoverTimer);
		if (this.note && !this.note.pinned) {
			this.hoverTimer = window.setTimeout(() => this.removePreview(), HOVER_HIDE_MS);
		}
	}

	/** Opens a comment's note to be read and changed; with `unsaved`, a comment just made by Comment. */
	open(comment: IBaseHalfComment, anchor: DOMRect, options: { readonly unsaved?: boolean; readonly status?: string } = {}): void {
		window.clearTimeout(this.hoverTimer);
		this.close();
		this.show(comment, anchor, true, !!options.unsaved, options.status);
		this.options.focus(comment.id);
		this.takeKeyboard();
	}

	/** Shows the tools of a highlight beside it: the colors, Comment, and Delete (comments, rule 10). */
	tools(highlight: IBaseHalfComment, anchor: DOMRect, options: { readonly status?: string } = {}): void {
		window.clearTimeout(this.hoverTimer);
		this.close();
		const tools = element('div', 'comment-tools floating', this.options.root);
		tools.setAttribute('role', 'toolbar');
		this.colorDots(tools, highlight, color => this.change('color', { ...this.note!.comment, color }));
		const commentOn = this.options.commentOn;
		if (commentOn) {
			const commentButton = iconButton('comment', this.options.labels.comment, { parent: tools });
			commentButton.addEventListener('click', () => {
				const current = this.note!.comment;
				this.close();
				commentOn(current, anchor);
			});
		}
		const remove = iconButton('delete', this.options.labels.delete, { parent: tools });
		remove.addEventListener('click', () => {
			const current = this.note!.comment;
			this.note = undefined;
			tools.remove();
			this.options.change('delete', undefined, current.id);
			this.options.focus(undefined);
			this.options.closed?.();
		});
		if (options.status) {
			element('span', 'comment-tools-status', tools).textContent = options.status;
		}
		this.place(tools, anchor);
		this.note = { element: tools, comment: highlight, pinned: true, unsaved: false };
		this.options.focus(highlight.id);
		this.takeKeyboard();
	}

	/**
	 * A note or tools opened by a click that left the keyboard where it was,
	 * such as on a mark in a note, whose press does not move the caret: the
	 * page takes the keyboard, so that Escape closes them here and not Card
	 * Detail.
	 */
	private takeKeyboard(): void {
		if (!document.hasFocus()) {
			window.focus();
		}
	}

	/**
	 * Closes the open note or tools. A note's words are saved first; a note
	 * that closes without words deletes its comment, when it has no replies
	 * (comments, rule 14).
	 */
	close(): void {
		const note = this.note;
		if (!note) {
			return;
		}
		this.note = undefined;
		window.clearTimeout(note.saveTimer);
		if (note.pinned && note.text) {
			if (note.unsaved) {
				this.saveText(note);
				if (note.unsaved) {
					this.options.discard(note.comment);
				}
			} else if (!this.words(note).trim()) {
				if (note.comment.replies.length === 0) {
					this.options.change('delete', undefined, note.comment.id);
				} else if (note.comment.text) {
					this.options.change('edit', { ...note.comment, text: '' });
				}
			} else {
				this.saveText(note);
			}
		}
		note.element.remove();
		if (note.pinned) {
			this.options.focus(undefined);
		}
		this.options.closed?.();
	}

	/** The comments of the file changed: an open note shows what it holds now, and keeps what the user is typing. */
	update(comments: readonly IBaseHalfComment[]): void {
		const note = this.note;
		if (!note || note.unsaved) {
			return;
		}
		const current = comments.find(comment => comment.id === note.comment.id);
		if (!current) {
			// Deleted elsewhere, or by undo.
			this.note = undefined;
			window.clearTimeout(note.saveTimer);
			note.element.remove();
			if (note.pinned) {
				this.options.focus(undefined);
			}
			this.options.closed?.();
			return;
		}
		if (JSON.stringify(current) === JSON.stringify(note.comment)) {
			return;
		}
		const typing = !!note.text && note.text.contains(document.activeElement);
		note.comment = typing ? { ...current, text: note.comment.text } : current;
		if (note.text && !typing) {
			note.text.textContent = current.text;
		}
		this.showColor(note);
		this.renderReplies(note);
	}

	/** Escape closes the open note or tools first (PDFs and books, rule 26). */
	escape(): boolean {
		if (this.note) {
			this.close();
			return true;
		}
		return false;
	}

	private removePreview(): void {
		if (this.note && !this.note.pinned) {
			this.note.element.remove();
			this.note = undefined;
		}
	}

	private show(comment: IBaseHalfComment, anchor: DOMRect, pinned: boolean, unsaved = false, status?: string): void {
		this.removePreview();
		const labels = this.options.labels;
		const note = element('div', `comment-note${pinned ? ' open' : ''}`, this.options.root);
		note.dataset.comment = comment.id;
		note.setAttribute('role', pinned ? 'dialog' : 'tooltip');
		if (pinned) {
			const tools = element('div', 'comment-tools', note);
			element('span', 'spacer', tools);
			const growBranch = this.options.grow;
			if (comment.quote && growBranch) {
				const grow = iconButton('branch', labels.growBranch, { parent: tools });
				grow.addEventListener('click', () => {
					const current = this.note?.comment ?? comment;
					this.close();
					growBranch(current);
				});
			}
			const remove = iconButton('delete', labels.delete, { parent: tools });
			remove.addEventListener('click', () => {
				const current = this.note!;
				this.note = undefined;
				window.clearTimeout(current.saveTimer);
				note.remove();
				if (!current.unsaved) {
					this.options.change('delete', undefined, current.comment.id);
				} else {
					this.options.discard(current.comment);
				}
				this.options.focus(undefined);
				this.options.closed?.();
			});
		}
		if (status) {
			element('div', 'comment-status', note).textContent = status;
		}
		if (comment.by) {
			element('div', 'comment-author', note).textContent = comment.by;
		}
		const text = element('div', 'comment-text', note);
		text.textContent = comment.text;
		text.dataset.placeholder = labels.commentPlaceholder;
		const open: IOpenNote = { element: note, comment, pinned, unsaved, text };
		this.note = open;
		element('div', 'comment-replies', note);
		this.renderReplies(open);
		if (pinned) {
			text.contentEditable = 'plaintext-only';
			text.spellcheck = true;
			text.setAttribute('role', 'textbox');
			text.setAttribute('aria-multiline', 'true');
			text.setAttribute('aria-label', labels.commentPlaceholder);
			text.addEventListener('input', () => {
				window.clearTimeout(open.saveTimer);
				open.saveTimer = window.setTimeout(() => this.saveText(open), SAVE_DELAY_MS);
				this.renderReplies(open);
			});
			note.addEventListener('keydown', event => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					this.close();
				}
			});
		} else {
			note.addEventListener('pointerenter', () => window.clearTimeout(this.hoverTimer));
			note.addEventListener('pointerleave', () => this.hoverLeave());
			note.addEventListener('click', () => this.open(this.note?.comment ?? comment, anchor));
		}
		this.place(note, anchor);
		if (pinned && (unsaved || !comment.text)) {
			text.focus();
		}
	}

	/** The replies, and the Reply line while the note is open and the comment has words. */
	private renderReplies(note: IOpenNote): void {
		const container = note.element.querySelector<HTMLElement>('.comment-replies');
		if (!container) {
			return;
		}
		const focused = container.contains(document.activeElement) ? document.activeElement : undefined;
		if (focused) {
			return;
		}
		container.replaceChildren();
		note.comment.replies.forEach((reply, index) => {
			const item = element('div', 'comment-reply', container);
			if (reply.by) {
				element('div', 'comment-author', item).textContent = reply.by;
			}
			const text = element('div', 'comment-reply-text', item);
			text.textContent = reply.text;
			if (note.pinned && !reply.by) {
				text.contentEditable = 'plaintext-only';
				text.addEventListener('blur', () => {
					const words = baseHalfCommentCut((text.textContent ?? '').trim());
					if (words === reply.text) {
						return;
					}
					const replies = [...note.comment.replies];
					if (words) {
						replies[index] = { ...reply, text: words };
					} else {
						replies.splice(index, 1);
					}
					this.change('edit', { ...note.comment, replies });
				});
			}
		});
		const hasWords = !!(note.text?.textContent ?? note.comment.text).trim();
		if (note.pinned && !note.unsaved && hasWords) {
			const field = element('div', 'comment-reply-field', container);
			field.contentEditable = 'plaintext-only';
			field.dataset.placeholder = this.options.labels.reply;
			field.setAttribute('role', 'textbox');
			field.setAttribute('aria-label', this.options.labels.reply);
			field.addEventListener('keydown', event => {
				if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
					event.preventDefault();
					const words = baseHalfCommentCut((field.textContent ?? '').trim());
					if (!words) {
						return;
					}
					const reply: IBaseHalfCommentReply = { text: words, at: baseHalfCommentTime() };
					field.textContent = '';
					field.blur();
					this.change('reply', { ...note.comment, replies: [...note.comment.replies, reply] });
					this.renderReplies(note);
				}
			});
		}
	}

	/** The words of an open note, as they are to be kept. */
	private words(note: IOpenNote): string {
		return baseHalfCommentCut((note.text?.innerText ?? '').replace(/\n+$/, ''));
	}

	/**
	 * Saves a note's words when they changed; the first words of a comment just
	 * made make it. While the note holds no words, nothing is saved: closing it
	 * so deletes the comment (comments, rule 14).
	 */
	private saveText(note: IOpenNote): void {
		window.clearTimeout(note.saveTimer);
		if (!note.text || !note.pinned) {
			return;
		}
		const words = this.words(note);
		if (!words.trim()) {
			return;
		}
		if (note.unsaved) {
			note.unsaved = false;
			note.comment = { ...note.comment, text: words, at: baseHalfCommentTime() };
			this.options.change('comment', note.comment);
			this.renderReplies(note);
			return;
		}
		if (words === note.comment.text) {
			return;
		}
		this.change('edit', { ...note.comment, text: words });
	}

	private change(step: BaseHalfCommentStep, comment: IBaseHalfComment): void {
		const note = this.note;
		if (note) {
			note.comment = comment;
			this.showColor(note);
			if (note.unsaved) {
				// A comment just made is kept with its first words.
				return;
			}
		}
		this.options.change(step, comment);
	}

	/** The tools of a highlight show its color as chosen. */
	private showColor(note: IOpenNote): void {
		note.element.querySelectorAll<HTMLElement>('.comment-color').forEach(dot => dot.classList.toggle('selected', dot.dataset.color === note.comment.color));
	}

	private colorDots(parent: HTMLElement, comment: IBaseHalfComment, pick: (color: BaseHalfCommentColor) => void): void {
		for (const color of BASEHALF_COMMENT_COLORS) {
			const dot = element('button', `comment-color${color === comment.color ? ' selected' : ''}`, parent);
			dot.type = 'button';
			dot.dataset.color = color;
			dot.dataset.hover = colorLabel(this.options.labels, color);
			dot.setAttribute('aria-label', colorLabel(this.options.labels, color));
			dot.addEventListener('click', () => pick(color));
		}
	}

	private place(box: HTMLElement, anchor: DOMRect): void {
		const bounds = this.options.root.getBoundingClientRect();
		const width = box.classList.contains('floating') ? box.offsetWidth : NOTE_WIDTH;
		const { left, top } = besideAnchor(anchor, width, box.offsetHeight, bounds);
		box.style.left = `${left - bounds.left}px`;
		box.style.top = `${top - bounds.top}px`;
	}
}
