/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfReaderLabels } from '../../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { element, iconButton } from './readerDom.js';

export interface IReaderSelectionActions {
	readonly highlight: () => void;
	readonly comment: () => void;
	readonly grow: () => void;
	readonly copy: () => void;
}

/**
 * The menu of a text selection (PDFs and books, "The selection menu"):
 * Highlight, Comment, Grow branch, and Copy, just above the selection's first
 * line, or below its last line when there is no room above.
 */
export class ReaderSelectionMenu {
	private readonly element: HTMLElement;

	constructor(private readonly root: HTMLElement, labels: IBaseHalfReaderLabels, actions: IReaderSelectionActions) {
		this.element = element('div', 'reader-selection-menu', root);
		this.element.setAttribute('role', 'toolbar');
		this.element.hidden = true;
		for (const [icon, label, run] of [
			['highlight', labels.highlight, actions.highlight],
			['comment', labels.comment, actions.comment],
			['branch', labels.growBranch, actions.grow],
			['copy', labels.copy, actions.copy]
		] as const) {
			const button = iconButton(icon, label, { text: true, parent: this.element });
			// The selection stays in the document while a button is pressed.
			button.addEventListener('pointerdown', event => event.preventDefault());
			button.addEventListener('click', () => run());
		}
	}

	get isShown(): boolean {
		return !this.element.hidden;
	}

	/** Shows the menu over `first`, the box of the selection's first line, or under `last`; both in the page's coordinates. */
	show(first: DOMRect, last: DOMRect): void {
		this.element.hidden = false;
		const bounds = this.root.getBoundingClientRect();
		const width = this.element.offsetWidth;
		const height = this.element.offsetHeight;
		const above = first.top - height - 8;
		const top = above >= bounds.top + 4 ? above : Math.min(last.bottom + 8, bounds.bottom - height - 4);
		const center = (first.left + first.right) / 2;
		const left = Math.min(Math.max(bounds.left + 8, center - width / 2), bounds.right - width - 8);
		this.element.style.left = `${left - bounds.left}px`;
		this.element.style.top = `${top - bounds.top}px`;
	}

	hide(): void {
		this.element.hidden = true;
	}
}
