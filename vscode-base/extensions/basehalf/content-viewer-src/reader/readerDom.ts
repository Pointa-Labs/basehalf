/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Small helpers of the reader's page: elements, icons, and the place of a box
// beside another inside the reader.

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
	const created = document.createElement(tag);
	if (className) {
		created.className = className;
	}
	parent?.append(created);
	return created;
}

/** A button that shows an icon, or an icon and its name, and says its name on hover. */
export function iconButton(icon: ReaderIcon, label: string, options: { readonly text?: boolean; readonly className?: string; readonly parent?: HTMLElement } = {}): HTMLButtonElement {
	const button = element('button', `reader-button${options.text ? ' with-text' : ''}${options.className ? ` ${options.className}` : ''}`, options.parent);
	button.type = 'button';
	button.append(readerIcon(icon));
	if (options.text) {
		element('span', 'label', button).textContent = label;
	} else {
		button.dataset.hover = label;
	}
	button.setAttribute('aria-label', label);
	return button;
}

export type ReaderIcon = 'search' | 'contents' | 'highlight' | 'comment' | 'branch' | 'copy' | 'delete' | 'check' | 'chevronLeft' | 'chevronRight';

const ICON_PATHS: Record<ReaderIcon, string> = {
	search: 'M7 2.75a4.25 4.25 0 1 1 0 8.5a4.25 4.25 0 0 1 0-8.5zM10.2 10.2l3.3 3.3',
	contents: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
	highlight: 'M3 13.5h10M5.2 10.8l1.6-1.6M6.3 11.9l-2.6-.3.3-2.6 6.4-6.4 2.3 2.3z',
	comment: 'M3 3.5h10a.5.5 0 0 1 .5.5v6.5a.5.5 0 0 1-.5.5H7l-3 2.5V11H3a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z',
	branch: 'M4.5 2.5v11M4.5 9.5c0-3 7-2 7-5.5M11.5 2.5v2M8.5 12.5h6M11.5 9.5v6',
	copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
	delete: 'M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.6 9h5.8l.6-9M7 7v4.5M9 7v4.5',
	check: 'M3.5 8.5l3 3 6-7',
	chevronLeft: 'M10 3.5L5.5 8l4.5 4.5',
	chevronRight: 'M6 3.5L10.5 8 6 12.5'
};

export function readerIcon(icon: ReaderIcon): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('reader-icon');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', ICON_PATHS[icon]);
	svg.append(path);
	return svg;
}

/** A text with `{0}` put in. */
export function format(text: string, value: string | number): string {
	return text.replace('{0}', String(value));
}

/**
 * Where a box of `width` and `height` stands beside `anchor`, inside `bounds`:
 * to its right when there is room, and otherwise to its left; its top at the
 * anchor's top, kept inside. Both in the coordinates of the page.
 */
export function besideAnchor(anchor: DOMRect, width: number, height: number, bounds: DOMRect, gap = 8): { readonly left: number; readonly top: number } {
	const right = anchor.right + gap;
	const left = right + width <= bounds.right - gap ? right : Math.max(bounds.left + gap, anchor.left - gap - width);
	const top = Math.min(Math.max(bounds.top + gap, anchor.top), Math.max(bounds.top + gap, bounds.bottom - gap - height));
	return { left, top };
}

/** Whether a key press is in a field of text, which takes its own keys. */
export function isTextField(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}
