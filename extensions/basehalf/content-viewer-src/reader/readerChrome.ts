/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { element } from './readerDom.js';

/**
 * The two controls at the bottom left of the reader (PDFs and books, "At the
 * bottom left"): where the reader is, and how large it shows the document.
 */
export class ReaderChrome {
	readonly element: HTMLElement;
	readonly location: HTMLButtonElement;
	readonly size: HTMLButtonElement;
	private editing: HTMLElement | undefined;

	constructor(root: HTMLElement, labels: { readonly location: string; readonly size: string }) {
		this.element = element('div', 'reader-chrome', root);
		this.location = element('button', 'reader-chrome-button location', this.element);
		this.location.type = 'button';
		this.location.dataset.hover = labels.location;
		this.location.setAttribute('aria-label', labels.location);
		this.size = element('button', 'reader-chrome-button size', this.element);
		this.size.type = 'button';
		this.size.dataset.hover = labels.size;
		this.size.setAttribute('aria-label', labels.size);
		this.size.setAttribute('aria-haspopup', 'menu');
	}

	setLocation(text: string): void {
		if (!this.editing) {
			this.location.textContent = text;
		}
	}

	setSize(text: string): void {
		this.size.textContent = text;
	}

	/**
	 * Makes the page number editable where it stands, all of it selected
	 * (PDFs and books, rule 21). Enter commits; Escape and a press outside
	 * leave it as it was.
	 */
	editPage(current: number, total: number, commit: (page: number) => void): void {
		if (this.editing) {
			return;
		}
		this.location.textContent = '';
		const field = element('span', 'page-field', this.location);
		field.contentEditable = 'plaintext-only';
		field.spellcheck = false;
		field.textContent = String(current);
		element('span', 'page-total', this.location).textContent = ` / ${total}`;
		this.editing = field;
		const finish = (accept: boolean) => {
			if (this.editing !== field) {
				return;
			}
			this.editing = undefined;
			const typed = Number.parseInt(field.textContent ?? '', 10);
			field.remove();
			this.location.textContent = `${current} / ${total}`;
			if (accept && Number.isFinite(typed)) {
				commit(Math.min(total, Math.max(1, typed)));
			}
		};
		field.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.isComposing) {
				event.preventDefault();
				event.stopPropagation();
				finish(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				finish(false);
			} else if (event.key.length === 1 && !/[0-9]/.test(event.key) && !event.metaKey && !event.ctrlKey) {
				event.preventDefault();
			}
		});
		field.addEventListener('blur', () => finish(false));
		field.addEventListener('click', event => event.stopPropagation());
		field.focus();
		const range = document.createRange();
		range.selectNodeContents(field);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}
}
