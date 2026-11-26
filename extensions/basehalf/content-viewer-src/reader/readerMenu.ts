/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { element } from './readerDom.js';

export interface IReaderMenuItem {
	readonly label: string;
	readonly shortcut?: string;
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly run: () => void;
}

export type ReaderMenuEntry = IReaderMenuItem | 'separator';

export interface IReaderMenuOptions {
	readonly entries: readonly ReaderMenuEntry[];
	/** A field at the top of the menu, such as the zoom's percentage. */
	readonly field?: {
		readonly value: string;
		readonly suffix?: string;
		readonly label: string;
		/** Takes what was typed; false when it was not a value, which keeps the menu open and marks the field. */
		readonly commit: (value: string) => boolean;
	};
	/** Something of its own, such as the slider of a book's place. */
	readonly content?: HTMLElement;
	readonly onClose?: () => void;
}

let openMenu: { readonly close: () => void } | undefined;

/** Whether a menu of the reader is open, which Escape closes first. */
export function isReaderMenuOpen(): boolean {
	return !!openMenu;
}

export function closeReaderMenu(): void {
	openMenu?.close();
}

/**
 * Opens a menu just above `anchor`, aligned with its left edge, as the zoom
 * menu of the canvas opens (PDFs and books, "At the bottom left"). It closes
 * after an item runs, on Escape, and on a press outside it.
 */
export function openReaderMenu(root: HTMLElement, anchor: HTMLElement, options: IReaderMenuOptions): void {
	openMenu?.close();
	const menu = element('div', 'reader-menu', root);
	menu.setAttribute('role', 'menu');
	const store: (() => void)[] = [];
	const close = () => {
		if (openMenu?.close !== close) {
			return;
		}
		openMenu = undefined;
		menu.remove();
		anchor.classList.remove('open');
		anchor.setAttribute('aria-expanded', 'false');
		store.forEach(dispose => dispose());
		options.onClose?.();
	};
	openMenu = { close };
	anchor.classList.add('open');
	anchor.setAttribute('aria-expanded', 'true');

	let input: HTMLInputElement | undefined;
	if (options.field) {
		const field = options.field;
		const shell = element('div', 'reader-menu-field', menu);
		input = element('input', '', shell);
		input.type = 'text';
		input.inputMode = 'decimal';
		input.spellcheck = false;
		input.autocomplete = 'off';
		input.value = field.value;
		input.setAttribute('aria-label', field.label);
		if (field.suffix) {
			element('span', 'suffix', shell).textContent = field.suffix;
		}
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.isComposing) {
				event.preventDefault();
				if (field.commit(input!.value)) {
					close();
				} else {
					shell.classList.add('invalid');
					input!.select();
				}
			}
		});
		input.addEventListener('input', () => shell.classList.remove('invalid'));
	}
	if (options.content) {
		menu.append(options.content);
	}
	const buttons: HTMLButtonElement[] = [];
	for (const entry of options.entries) {
		if (entry === 'separator') {
			element('div', 'reader-menu-separator', menu).setAttribute('role', 'separator');
			continue;
		}
		const button = element('button', 'reader-menu-item', menu);
		button.type = 'button';
		button.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemradio');
		if (entry.checked !== undefined) {
			button.setAttribute('aria-checked', String(entry.checked));
		}
		button.disabled = !!entry.disabled;
		element('span', 'check', button).textContent = entry.checked ? '✓' : '';
		element('span', 'label', button).textContent = entry.label;
		if (entry.shortcut) {
			element('span', 'shortcut', button).textContent = entry.shortcut;
		}
		button.addEventListener('click', event => {
			event.preventDefault();
			close();
			entry.run();
		});
		buttons.push(button);
	}

	// Above the anchor, its left edge on the anchor's; inside the page.
	const box = anchor.getBoundingClientRect();
	const rootBox = root.getBoundingClientRect();
	menu.style.left = `${Math.max(8, Math.min(box.left - rootBox.left, rootBox.width - menu.offsetWidth - 8))}px`;
	menu.style.bottom = `${rootBox.bottom - box.top + 6}px`;

	const onKey = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			anchor.focus({ preventScroll: true });
			return;
		}
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && buttons.length) {
			event.preventDefault();
			const enabled = buttons.filter(button => !button.disabled);
			const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === 'ArrowDown' ? (index + 1) % enabled.length : (index <= 0 ? enabled.length - 1 : index - 1);
			enabled[next]?.focus();
		}
	};
	const onPress = (event: PointerEvent) => {
		const target = event.target as Node | null;
		if (target && !menu.contains(target) && !anchor.contains(target)) {
			close();
		}
	};
	window.addEventListener('keydown', onKey, true);
	window.addEventListener('pointerdown', onPress, true);
	store.push(() => window.removeEventListener('keydown', onKey, true), () => window.removeEventListener('pointerdown', onPress, true));
	if (input) {
		input.focus();
		input.select();
	} else {
		buttons.find(button => !button.disabled)?.focus();
	}
}
