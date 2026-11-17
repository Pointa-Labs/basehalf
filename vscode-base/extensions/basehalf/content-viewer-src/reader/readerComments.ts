/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './readerComments.css';
import { isBaseHalfHighlight, type IBaseHalfComment } from '../../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';
import type { IBaseHalfReaderLabels } from '../../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { element } from './readerDom.js';

/** A highlight or a comment as the Comments panel lists it. */
export interface ICommentsPanelItem {
	readonly comment: IBaseHalfComment;
	/** Where it is: "Page 3", or the chapter; the items are listed under it. */
	readonly location?: string;
	readonly found: boolean;
}

export interface IReaderCommentsPanelOptions {
	readonly labels: IBaseHalfReaderLabels;
	readonly open: boolean;
	/** The highlights and comments in the order of the document, and whether the file could not be read. */
	readonly items: () => { readonly items: readonly ICommentsPanelItem[]; readonly unreadable: boolean };
	/** The panel opened or closed. */
	readonly onOpen: (open: boolean) => void;
	/** A click on an item: the reader goes to it and opens its note or tools, beside `anchor`, the item, when its passage is not found. */
	readonly go: (comment: IBaseHalfComment, anchor: DOMRect, found: boolean) => void;
}

/**
 * The Comments panel at the right of the reader (comments, rule 22; PDFs and
 * books, "The panels"): the highlights and the comments of the document,
 * under their page or chapter, and last those whose passage is not found.
 */
export class ReaderCommentsPanel {
	readonly element: HTMLElement;
	private readonly list: HTMLElement;
	private open: boolean;
	private frame: number | undefined;

	constructor(private readonly root: HTMLElement, private readonly options: IReaderCommentsPanelOptions) {
		this.open = options.open;
		this.element = element('aside', 'reader-comments', root);
		this.element.setAttribute('aria-label', options.labels.comments);
		this.list = element('div', 'reader-comments-list', this.element);
		this.show();
	}

	get isOpen(): boolean {
		return this.open;
	}

	/** The panel stands over the document, in a reader too narrow for it to stand beside. */
	get isOver(): boolean {
		return this.open && !this.root.classList.contains('wide');
	}

	toggle(): void {
		this.setOpen(!this.open);
	}

	close(): void {
		this.setOpen(false);
	}

	closeWhenOver(): void {
		if (this.isOver) {
			this.close();
		}
	}

	/** The highlights or comments changed: an open panel lists them again, once a frame. */
	refresh(): void {
		if (!this.open || this.frame !== undefined) {
			return;
		}
		this.frame = window.requestAnimationFrame(() => {
			this.frame = undefined;
			this.render();
		});
	}

	private setOpen(open: boolean): void {
		if (open === this.open) {
			return;
		}
		this.open = open;
		this.show();
		this.options.onOpen(open);
	}

	private show(): void {
		this.element.hidden = !this.open;
		this.root.classList.toggle('comments-open', this.open);
		if (this.open) {
			this.render();
		}
	}

	private render(): void {
		const labels = this.options.labels;
		const { items, unreadable } = this.options.items();
		const scrollTop = this.list.scrollTop;
		this.list.replaceChildren();
		if (unreadable || items.length === 0) {
			element('div', 'reader-comments-empty', this.list).textContent = unreadable ? labels.commentsUnreadable : labels.noComments;
			return;
		}
		const groups: { readonly label: string; readonly items: ICommentsPanelItem[] }[] = [];
		for (const item of [...items.filter(item => item.found), ...items.filter(item => !item.found)]) {
			const label = item.found ? item.location ?? '' : labels.passageNotFound;
			const last = groups[groups.length - 1];
			if (last && last.label === label) {
				last.items.push(item);
			} else {
				groups.push({ label, items: [item] });
			}
		}
		for (const group of groups) {
			const section = element('section', 'reader-comments-group', this.list);
			if (group.label) {
				element('div', 'reader-comments-location', section).textContent = group.label;
			}
			const list = element('ol', '', section);
			for (const item of group.items) {
				this.renderItem(element('li', '', list), item);
			}
		}
		this.list.scrollTop = scrollTop;
	}

	private renderItem(parent: HTMLElement, item: ICommentsPanelItem): void {
		const { comment } = item;
		const highlight = isBaseHalfHighlight(comment);
		const button = element('button', `reader-comments-item ${highlight ? 'highlight' : 'comment'}`, parent);
		button.type = 'button';
		button.dataset.comment = comment.id;
		if (comment.quote) {
			const quote = element('div', 'reader-comments-quote', button);
			const passage = element('span', 'passage', quote);
			passage.textContent = comment.quote;
			if (highlight) {
				passage.dataset.color = comment.color;
			}
		}
		if (!highlight) {
			if (comment.by) {
				element('div', 'reader-comments-author', button).textContent = comment.by;
			}
			if (comment.text) {
				element('div', 'reader-comments-text', button).textContent = comment.text;
			}
			if (comment.replies.length) {
				element('div', 'reader-comments-replies', button).textContent = comment.replies.map(reply => reply.by ? `${reply.by}: ${reply.text}` : reply.text).join('  ·  ');
			}
		}
		button.addEventListener('click', () => {
			// One whose passage is not found opens beside the panel, which stays.
			if (item.found) {
				this.closeWhenOver();
			}
			this.options.go(comment, button.getBoundingClientRect(), item.found);
		});
	}
}
