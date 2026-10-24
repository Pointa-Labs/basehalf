/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfGenerationReferenceMenu.css';
import { $, addDisposableListener, append, clearNode, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import {
	baseHalfReferenceMenuKindRows,
	BaseHalfReferenceMenuKind,
	baseHalfReferenceMenuRows,
	BaseHalfReferenceMenuRow,
	IBaseHalfReferenceMenuItem,
	IBaseHalfReferenceMenuModel,
	isBaseHalfReferenceMenuChoice
} from '../common/basehalfGenerationReferenceMenu.js';
import { resolveBaseHalfVideoPanelMenuPlacement } from '../common/basehalfVideoNodePanelPlacement.js';

export interface IBaseHalfReferenceMenuDelegate {
	/** An input or a card was chosen. */
	choose(item: IBaseHalfReferenceMenuItem): void;
	/** The menu closed without a choice: Escape, Tab, or a click outside it. */
	dismiss(): void;
	/** The canvas in window coordinates, for keeping the menu inside it. */
	canvasBounds(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

/** The menu's width, and its list of a kind's beside it, in screen pixels. */
export const BASEHALF_REFERENCE_MENU_WIDTH = 240;
const FLYOUT_GAP = 4;

type ChoiceRow = Extract<BaseHalfReferenceMenuRow, { readonly key: string }>;

/**
 * The reference menu of a draft's prompt (generation cards, "The panel",
 * D68): it opens at the caret where `@` was typed and takes the keyboard
 * into its search field. It lists the card's named inputs and, by kind, the
 * cards of its canvas; a kind opens its list beside the menu. Up and Down
 * move the current item, Right and Left go into and out of a kind's list,
 * Enter chooses, and Escape, Tab, or a click outside close it.
 */
export class BaseHalfGenerationReferenceMenu extends Disposable {

	readonly element: HTMLElement;

	private readonly search: HTMLInputElement;
	private readonly list: HTMLElement;
	private readonly listStore = this._register(new DisposableStore());
	private readonly flyoutStore = this._register(new DisposableStore());
	private readonly id = `bh-reference-menu-${generateUuid()}`;
	private flyout: HTMLElement | undefined;
	private flyoutKind: BaseHalfReferenceMenuKind | undefined;
	/** The options drawn, by key, in the menu and in the list of a kind. */
	private readonly menuOptions = new Map<string, HTMLElement>();
	private readonly flyoutOptions = new Map<string, HTMLElement>();
	private rows: readonly BaseHalfReferenceMenuRow[] = [];
	private flyoutRows: readonly BaseHalfReferenceMenuRow[] = [];
	/** The current item of the menu, by key. */
	private activeKey: string | undefined;
	/** The current item of the list of a kind, while the keyboard is in it. */
	private flyoutActiveKey: string | undefined;
	private query = '';
	private composing = false;

	constructor(
		private model: IBaseHalfReferenceMenuModel,
		private readonly delegate: IBaseHalfReferenceMenuDelegate,
		private readonly layer: HTMLElement,
		private readonly anchor: () => DOMRect | undefined
	) {
		super();
		this.element = append(layer, $('.bh-reference-menu'));
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-label', localize('basehalf.generation.references.menu', "Name an Input"));
		this._register(toDisposable(() => this.element.remove()));
		const field = append(this.element, $('.bh-reference-menu-search'));
		field.append(renderGlyph(Codicon.search));
		this.search = append(field, $<HTMLInputElement>('input'));
		this.search.type = 'text';
		this.search.spellcheck = false;
		this.search.placeholder = localize('basehalf.generation.references.search', "Search");
		this.search.setAttribute('role', 'combobox');
		this.search.setAttribute('aria-autocomplete', 'list');
		this.search.setAttribute('aria-expanded', 'true');
		this.search.setAttribute('aria-controls', `${this.id}-list`);
		this.list = append(this.element, $('.bh-reference-menu-list'));
		this.list.id = `${this.id}-list`;
		this.list.setAttribute('role', 'listbox');

		this._register(addDisposableListener(this.search, 'input', event => {
			if ((event as InputEvent).isComposing || this.composing) {
				return;
			}
			this.setQuery(this.search.value);
		}));
		this._register(addDisposableListener(this.search, 'compositionstart', () => { this.composing = true; }));
		this._register(addDisposableListener(this.search, 'compositionend', () => {
			this.composing = false;
			this.setQuery(this.search.value);
		}));
		this._register(addDisposableListener(this.search, 'keydown', event => this.onKeyDown(event)));
		this._register(addDisposableListener(this.element, 'pointerdown', event => {
			// The search field keeps the keyboard while the pointer chooses.
			if (event.target !== this.search) {
				event.preventDefault();
			}
		}));
		const targetWindow = getWindow(layer);
		this._register(addDisposableListener(targetWindow.document, 'pointerdown', event => {
			const target = event.target;
			if (isHTMLElement(target) && (this.element.contains(target) || this.flyout?.contains(target))) {
				return;
			}
			this.delegate.dismiss();
		}, true));
		this.render();
	}

	/** Moves the keyboard into the search field. */
	focus(): void {
		this.search.focus({ preventScroll: true });
	}

	/** Lists what the card has now, keeping the search and the current item. */
	update(model: IBaseHalfReferenceMenuModel): void {
		this.model = model;
		this.render();
	}

	/** Places the menu at its anchor again, as when the panel moved. */
	layout(): void {
		this.place();
		if (this.flyoutKind) {
			this.placeFlyout();
		}
	}

	override dispose(): void {
		this.closeFlyout();
		super.dispose();
	}

	private setQuery(query: string): void {
		if (query === this.query) {
			return;
		}
		this.query = query;
		this.activeKey = undefined;
		this.closeFlyout();
		this.render();
	}

	//#region Drawing

	private render(): void {
		this.rows = baseHalfReferenceMenuRows(this.model, this.query);
		const choices = this.rows.filter(isBaseHalfReferenceMenuChoice);
		if (!choices.some(row => row.key === this.activeKey)) {
			this.activeKey = choices[0]?.key;
		}
		this.listStore.clear();
		this.menuOptions.clear();
		clearNode(this.list);
		for (const row of this.rows) {
			this.renderRow(this.list, row, 'menu');
		}
		this.updateActive();
		if (this.flyoutKind) {
			this.renderFlyout();
		}
		this.place();
	}

	private renderRow(parent: HTMLElement, row: BaseHalfReferenceMenuRow, where: 'menu' | 'flyout'): void {
		const store = where === 'menu' ? this.listStore : this.flyoutStore;
		if (row.type === 'header') {
			append(parent, $('.bh-reference-menu-header')).textContent = row.text;
			return;
		}
		if (row.type === 'empty') {
			append(parent, $('.bh-reference-menu-empty')).textContent = row.text;
			return;
		}
		const option = append(parent, $('.bh-reference-menu-option'));
		(where === 'menu' ? this.menuOptions : this.flyoutOptions).set(row.key, option);
		option.id = this.optionId(row.key, where);
		option.dataset.key = row.key;
		option.setAttribute('role', 'option');
		const disabled = row.type === 'item' ? row.item.disabled : row.disabled;
		option.classList.toggle('disabled', !!disabled);
		option.setAttribute('aria-disabled', String(!!disabled));
		const glyphOrPicture = append(option, $('.bh-reference-menu-picture'));
		if (row.type === 'item' && row.item.picture) {
			const image = append(glyphOrPicture, $<HTMLImageElement>('img'));
			image.alt = '';
			image.draggable = false;
			image.decoding = 'async';
			image.addEventListener('error', () => image.replaceWith(renderGlyph(glyphOf(row.item.kind))), { once: true });
			image.src = row.item.picture;
		} else {
			glyphOrPicture.append(renderGlyph(glyphOf(row.type === 'kind' ? row.kind : row.item.kind)));
		}
		const text = append(option, $('.bh-reference-menu-text'));
		append(text, $('span.bh-reference-menu-title')).textContent = row.type === 'item' ? row.item.title : row.text;
		if (disabled) {
			append(text, $('span.bh-reference-menu-reason')).textContent = disabled;
		}
		if (row.type === 'item' && row.mark) {
			append(option, $('span.bh-reference-menu-label')).textContent = row.mark;
		}
		if (row.type === 'kind') {
			option.setAttribute('aria-haspopup', 'listbox');
			append(option, $('span.bh-reference-menu-count')).textContent = String(row.count);
			option.append(renderGlyph(Codicon.chevronRight));
		}
		store.add(addDisposableListener(option, 'pointermove', () => {
			if (where === 'menu') {
				if (this.activeKey !== row.key) {
					this.activeKey = row.key;
					this.updateActive(false);
				}
				if (row.type === 'kind' && !row.disabled && this.flyoutKind !== row.kind) {
					this.openFlyout(row.kind, false);
				} else if (row.type !== 'kind' && this.flyoutKind) {
					this.closeFlyout();
				}
			} else if (this.flyoutActiveKey !== row.key) {
				this.flyoutActiveKey = row.key;
				this.updateActive(false);
			}
		}));
		store.add(addDisposableListener(option, 'click', () => this.choose(row)));
	}

	private openFlyout(kind: BaseHalfReferenceMenuKind, byKeyboard: boolean): void {
		this.flyoutKind = kind;
		this.renderFlyout();
		const first = this.flyoutRows.find(isBaseHalfReferenceMenuChoice);
		this.flyoutActiveKey = byKeyboard ? first?.key : undefined;
		this.updateActive();
	}

	private renderFlyout(): void {
		const kind = this.flyoutKind;
		if (!kind) {
			return;
		}
		this.flyoutStore.clear();
		let flyout = this.flyout;
		if (!flyout?.isConnected) {
			flyout = append(this.layer, $('.bh-reference-menu.flyout'));
			flyout.id = `${this.id}-flyout`;
			flyout.setAttribute('role', 'listbox');
			this.flyout = flyout;
		}
		this.flyoutStore.add(addDisposableListener(flyout, 'pointerdown', event => event.preventDefault()));
		this.flyoutOptions.clear();
		clearNode(flyout);
		this.flyoutRows = baseHalfReferenceMenuKindRows(this.model, kind);
		const list = append(flyout, $('.bh-reference-menu-list'));
		for (const row of this.flyoutRows) {
			this.renderRow(list, row, 'flyout');
		}
		if (!this.flyoutRows.some(row => isBaseHalfReferenceMenuChoice(row) && row.key === this.flyoutActiveKey)) {
			this.flyoutActiveKey = undefined;
		}
		this.placeFlyout();
	}

	private closeFlyout(): void {
		this.flyoutKind = undefined;
		this.flyoutActiveKey = undefined;
		this.flyoutRows = [];
		this.flyoutStore.clear();
		this.flyoutOptions.clear();
		this.flyout?.remove();
		this.flyout = undefined;
		this.updateActive();
	}

	/** Marks the current items, and tells assistive technology which one is current. */
	private updateActive(scroll = true): void {
		for (const [options, key] of [[this.menuOptions, this.activeKey], [this.flyoutOptions, this.flyoutActiveKey]] as const) {
			for (const [optionKey, option] of options) {
				const current = optionKey === key;
				option.classList.toggle('active', current);
				option.setAttribute('aria-selected', String(current));
				if (current && scroll) {
					option.scrollIntoView({ block: 'nearest' });
				}
			}
		}
		const inFlyout = this.flyoutActiveKey !== undefined;
		const key = inFlyout ? this.flyoutActiveKey : this.activeKey;
		if (key) {
			this.search.setAttribute('aria-activedescendant', this.optionId(key, inFlyout ? 'flyout' : 'menu'));
		} else {
			this.search.removeAttribute('aria-activedescendant');
		}
	}

	private place(): void {
		const anchor = this.anchor();
		if (!anchor) {
			return;
		}
		const canvas = this.delegate.canvasBounds();
		const origin = this.layer.getBoundingClientRect();
		this.element.style.maxHeight = '';
		const placement = resolveBaseHalfVideoPanelMenuPlacement(
			{ left: anchor.left - canvas.left, top: anchor.top - canvas.top, right: anchor.right - canvas.left, bottom: anchor.bottom - canvas.top },
			{ width: canvas.width, height: canvas.height },
			{ width: BASEHALF_REFERENCE_MENU_WIDTH, height: this.element.scrollHeight }
		);
		this.element.dataset.side = placement.side;
		this.element.style.width = `${placement.width}px`;
		this.element.style.maxHeight = `${placement.maxHeight}px`;
		this.element.style.left = `${Math.round(placement.left + canvas.left - origin.left)}px`;
		this.element.style.top = `${Math.round(placement.top + canvas.top - origin.top)}px`;
	}

	/** Beside the menu, at the height of its kind, on the side with room; inside the canvas. */
	private placeFlyout(): void {
		const flyout = this.flyout;
		const kind = this.flyoutKind;
		if (!flyout || !kind) {
			return;
		}
		const canvas = this.delegate.canvasBounds();
		const origin = this.layer.getBoundingClientRect();
		const menu = this.element.getBoundingClientRect();
		const row = this.menuOptions.get(`kind:${kind}`)?.getBoundingClientRect() ?? menu;
		const width = BASEHALF_REFERENCE_MENU_WIDTH;
		const right = menu.right + FLYOUT_GAP;
		const left = right + width <= canvas.left + canvas.width - 12 ? right : Math.max(canvas.left + 12, menu.left - FLYOUT_GAP - width);
		flyout.style.width = `${width}px`;
		flyout.style.maxHeight = '';
		const height = Math.min(flyout.scrollHeight, canvas.height - 64);
		const top = Math.max(canvas.top + 12, Math.min(row.top - 6, canvas.top + canvas.height - 52 - height));
		flyout.style.maxHeight = `${Math.max(0, height)}px`;
		flyout.style.left = `${Math.round(left - origin.left)}px`;
		flyout.style.top = `${Math.round(top - origin.top)}px`;
	}

	//#endregion

	//#region Keys and choosing

	private onKeyDown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229) {
			return;
		}
		const inFlyout = this.flyoutActiveKey !== undefined;
		const rows = (inFlyout ? this.flyoutRows : this.rows).filter(isBaseHalfReferenceMenuChoice);
		const key = inFlyout ? this.flyoutActiveKey : this.activeKey;
		const index = rows.findIndex(row => row.key === key);
		const handled = () => {
			event.preventDefault();
			event.stopPropagation();
		};
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				handled();
				if (!rows.length) {
					return;
				}
				const step = event.key === 'ArrowDown' ? 1 : -1;
				const next = rows[(index < 0 ? (step > 0 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length)];
				this.setActive(next, inFlyout);
				return;
			}
			case 'Home':
			case 'End':
				if (rows.length && !this.search.value) {
					handled();
					this.setActive(rows[event.key === 'Home' ? 0 : rows.length - 1], inFlyout);
				}
				return;
			case 'ArrowRight': {
				const row = rows[index];
				if (!inFlyout && row?.type === 'kind' && !row.disabled) {
					handled();
					this.openFlyout(row.kind, true);
				}
				return;
			}
			case 'ArrowLeft':
				if (inFlyout) {
					handled();
					this.flyoutActiveKey = undefined;
					this.closeFlyout();
				}
				return;
			case 'Enter': {
				handled();
				const row = rows[index];
				if (row) {
					this.choose(row);
				}
				return;
			}
			case 'Escape':
				handled();
				if (this.flyoutKind) {
					this.closeFlyout();
				} else {
					this.delegate.dismiss();
				}
				return;
			case 'Tab':
				handled();
				this.delegate.dismiss();
				return;
		}
	}

	private setActive(row: ChoiceRow, inFlyout: boolean): void {
		if (inFlyout) {
			this.flyoutActiveKey = row.key;
		} else {
			this.activeKey = row.key;
			if (this.flyoutKind && (row.type !== 'kind' || row.kind !== this.flyoutKind)) {
				this.closeFlyout();
			}
		}
		this.updateActive();
	}

	private choose(row: BaseHalfReferenceMenuRow): void {
		if (row.type === 'kind') {
			if (!row.disabled) {
				this.openFlyout(row.kind, true);
			}
			return;
		}
		if (row.type === 'item' && !row.item.disabled) {
			this.delegate.choose(row.item);
		}
	}

	//#endregion

	private optionId(key: string, where: 'menu' | 'flyout'): string {
		return `${this.id}-${where}-${encodeURIComponent(key).replace(/%/g, '_')}`;
	}
}

function glyphOf(kind: BaseHalfReferenceMenuKind): ThemeIcon {
	switch (kind) {
		case 'image': return Codicon.fileMedia;
		case 'video': return Codicon.play;
		case 'audio': return Codicon.unmute;
		case 'text': return Codicon.fileText;
	}
}

function renderGlyph(icon: ThemeIcon): HTMLElement {
	const element = renderIcon(icon);
	element.setAttribute('aria-hidden', 'true');
	return element;
}
