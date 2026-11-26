/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getWindow, isHTMLButtonElement, isHTMLElement, isHTMLInputElement } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IBaseHalfVideoPanelRect, resolveBaseHalfVideoPanelMenuPlacement } from '../common/basehalfVideoNodePanelPlacement.js';
import { HOVER_GROUP, renderCodicon, BaseHalfVideoPanelMenuKind, MENU_WIDTHS, IOpenMenu } from './basehalfGenerationPanelShared.js';
import type { BaseHalfVideoNodePanel } from './basehalfVideoNodePanel.js';

/**
 * The menu that opens from a button of the panel: opening and closing it, where it stands beside its button
 * within the canvas, its rows, and its keys.
 *
 * A part of the panel under a generation card (`basehalfVideoNodePanel.ts`): it keeps its own state, and reaches
 * the panel's as `panel`.
 */
export class BaseHalfGenerationPanelMenus {
	constructor(private readonly panel: BaseHalfVideoNodePanel) { }

	//#endregion

	//#region Menus

	toggleMenu(kind: BaseHalfVideoPanelMenuKind, trigger: HTMLElement, byPointer: boolean): void {
		if (this.panel.openMenu?.kind === kind && this.panel.openMenu.trigger === trigger) {
			this.closeMenu(true);
			return;
		}
		// While the draft generates, the model and the settings show their values and open nothing (D67).
		if (this.panel.isLocked()) {
			return;
		}
		this.panel.references.closeReferenceMenu(false);
		this.showMenu(kind, trigger, byPointer);
	}

	private showMenu(kind: BaseHalfVideoPanelMenuKind, trigger: HTMLElement, byPointer = false): void {
		this.closeMenu(false);
		if (!this.panel.presentation) {
			return;
		}
		const store = new DisposableStore();
		const element = append(this.panel.layer, $(`.bh-video-panel-menu.${kind}`));
		element.style.width = `${MENU_WIDTHS[kind]}px`;
		store.add(toDisposable(() => element.remove()));
		const menu: IOpenMenu = {
			kind,
			element,
			trigger,
			store,
			content: store.add(new DisposableStore()),
			anchor: () => this.menuAnchor(kind, trigger),
			// The settings, the voice, and the model end the footer: their menus end where the button ends,
			// over the panel; an empty frame's menu begins where the frame begins (D106).
			align: kind === 'add' ? 'start' : 'end',
			byPointer
		};
		this.panel.openMenu = menu;
		this.panel.menu.value = store;
		trigger.setAttribute('aria-expanded', 'true');
		store.add(toDisposable(() => trigger.setAttribute('aria-expanded', 'false')));
		store.add(addDisposableListener(element, 'focusout', event => {
			const next = event.relatedTarget;
			if (isHTMLElement(next) && !element.contains(next) && next !== trigger) {
				this.closeMenu(false);
			}
		}));
		store.add(addDisposableListener(getWindow(this.panel.element), 'pointerdown', event => {
			// A type check of this element's own window: the panel can live in an auxiliary window.
			const target = event.target;
			if (isHTMLElement(target) && (element.contains(target) || trigger.contains(target))) {
				return;
			}
			this.closeMenu(false);
		}, true));
		store.add(addDisposableListener(element, 'keydown', event => this.onMenuKeyDown(event, menu)));
		this.fillMenu(menu);
		this.placeMenu(menu);
		this.focusFirstMenuItem(menu);
	}

	closeMenu(restoreFocus: boolean): void {
		const menu = this.panel.openMenu;
		if (!menu) {
			return;
		}
		this.panel.openMenu = undefined;
		if (menu.kind === 'settings') {
			this.panel.choices.saveTextParam();
		}
		this.panel.menu.clear();
		if (restoreFocus) {
			menu.trigger.focus({ preventScroll: true });
		}
	}

	refreshMenu(): void {
		const menu = this.panel.openMenu;
		if (!menu) {
			return;
		}
		if (!menu.trigger.isConnected) {
			// The control it opened from was drawn again: open from the new one.
			const key = menu.trigger.dataset.key;
			const replacement = key ? this.panel.findByKey(this.panel.inputRow.element, key) : undefined;
			if (!replacement) {
				this.closeMenu(false);
				return;
			}
			this.showMenu(menu.kind, replacement, menu.byPointer);
			return;
		}
		if (menu.kind === 'voice') {
			// The voice menu keeps its search and draws its own rows: it learns the card's voice and model.
			const target = this.panel.choices.voiceTarget();
			if (target) {
				menu.voice?.update(target);
			} else {
				this.closeMenu(false);
			}
			return;
		}
		if (this.menuContentKey(menu.kind) === menu.contentKey) {
			return;
		}
		const focusedKey = this.panel.focusedKey(menu.element);
		this.fillMenu(menu);
		this.placeMenu(menu);
		this.panel.restoreFocus(menu.element, focusedKey);
	}

	private menuContentKey(kind: BaseHalfVideoPanelMenuKind): string {
		const presentation = this.panel.presentation;
		switch (kind) {
			case 'model': return JSON.stringify(presentation?.modelMenu);
			case 'settings': return JSON.stringify([presentation?.ref?.provider.id, presentation?.ref?.model.id, presentation?.settingsView, this.panel.moreOpen]);
			default: return kind;
		}
	}

	private fillMenu(menu: IOpenMenu): void {
		menu.contentKey = this.menuContentKey(menu.kind);
		menu.content.clear();
		clearNode(menu.element);
		switch (menu.kind) {
			case 'add': return this.panel.choices.fillAddMenu(menu.element);
			case 'model': return this.panel.choices.fillModelMenu(menu.element);
			case 'voice': return this.panel.choices.fillVoiceMenu(menu);
			case 'settings': return this.panel.choices.fillSettings(menu.element);
		}
	}

	placeMenu(menu: IOpenMenu): void {
		const anchor = menu.anchor();
		if (!anchor) {
			return;
		}
		const panel = this.panel.element.getBoundingClientRect();
		const canvas = this.canvasRect(panel);
		const trigger: IBaseHalfVideoPanelRect = {
			left: anchor.left - canvas.left,
			top: anchor.top - canvas.top,
			right: anchor.right - canvas.left,
			bottom: anchor.bottom - canvas.top
		};
		menu.element.style.maxHeight = '';
		const wanted = menu.element.scrollHeight;
		const placement = resolveBaseHalfVideoPanelMenuPlacement(trigger, canvas, { width: MENU_WIDTHS[menu.kind], height: wanted }, { align: menu.align });
		menu.element.dataset.side = placement.side;
		menu.element.style.width = `${placement.width}px`;
		menu.element.style.maxHeight = `${placement.maxHeight}px`;
		// The layer that holds the menu lies inside the panel's border.
		menu.element.style.left = `${placement.left - (panel.left + this.panel.element.clientLeft - canvas.left)}px`;
		menu.element.style.top = `${placement.top - (panel.top + this.panel.element.clientTop - canvas.top)}px`;
	}

	/**
	 * Where a menu opens from: its control. A menu of the footer that opens
	 * below opens below the panel, so it never covers the panel's edge; one that
	 * opens upward opens from the control, over the prompt.
	 */
	private menuAnchor(kind: BaseHalfVideoPanelMenuKind, trigger: HTMLElement): DOMRect | undefined {
		if (!trigger.isConnected) {
			return undefined;
		}
		const rect = trigger.getBoundingClientRect();
		if (kind !== 'model' && kind !== 'voice' && kind !== 'settings') {
			return rect;
		}
		const panel = this.panel.element.getBoundingClientRect();
		const DOMRectConstructor = getWindow(this.panel.element).DOMRect;
		return new DOMRectConstructor(rect.left, rect.top, rect.width, Math.max(rect.height, panel.bottom - rect.top));
	}

	/** The canvas in window coordinates: what the scene reported, or the window itself before the scene places the panel. */
	canvasRect(panel: DOMRect): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } {
		const layout = this.panel.layout;
		if (layout && layout.canvasWidth > 0 && layout.canvasHeight > 0) {
			return { left: panel.left - layout.left, top: panel.top - layout.top, width: layout.canvasWidth, height: layout.canvasHeight };
		}
		const targetWindow = getWindow(this.panel.element);
		return { left: 0, top: 0, width: targetWindow.innerWidth, height: targetWindow.innerHeight };
	}

	private onMenuKeyDown(event: KeyboardEvent, menu: IOpenMenu): void {
		// The settings follow their controls, and the voice menu its search field.
		if (menu.kind === 'settings' || menu.kind === 'voice') {
			return;
		}
		const items = this.menuItems(menu.element);
		const index = items.findIndex(item => item === getWindow(this.panel.element).document.activeElement);
		let next: number | undefined;
		// Without a current item (index -1), Down goes to the first item and Up to the last.
		if (event.key === 'ArrowDown') {
			next = (index + 1) % items.length;
		} else if (event.key === 'ArrowUp') {
			next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
		} else if (event.key === 'Home') {
			next = 0;
		} else if (event.key === 'End') {
			next = items.length - 1;
		} else if (event.key === 'Tab') {
			this.closeMenu(true);
			return;
		}
		if (next === undefined || items.length === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		items[next].focus({ preventScroll: true });
	}

	private menuItems(container: HTMLElement): HTMLElement[] {
		const items: HTMLElement[] = [];
		const visit = (element: Element) => {
			for (const child of element.children) {
				if (isHTMLElement(child) && child.dataset.menuItem === 'true' && !child.hasAttribute('disabled')) {
					items.push(child);
				}
				visit(child);
			}
		};
		visit(container);
		return items;
	}

	/**
	 * A menu focuses its checked item. Without one, a menu opened from the
	 * keyboard focuses its first item, and a menu that a click opened holds the
	 * focus itself, with no current item, as the workbench's menus do: an item
	 * focused there would show no ring, and Enter would choose it unseen. The
	 * settings focus their first control.
	 */
	private focusFirstMenuItem(menu: IOpenMenu): void {
		if (menu.voice) {
			// The search field has the keyboard, with the card's voice current.
			menu.voice.focus();
			return;
		}
		const items = this.menuItems(menu.element);
		const checked = items.find(item => item.getAttribute('aria-checked') === 'true');
		if (!checked && menu.byPointer && items.length > 0) {
			menu.element.tabIndex = -1;
			menu.element.focus({ preventScroll: true });
			return;
		}
		(checked ?? items[0] ?? this.firstControl(menu.element))?.focus({ preventScroll: true });
	}

	private firstControl(container: HTMLElement): HTMLElement | undefined {
		for (const child of container.children) {
			if (!isHTMLElement(child)) {
				continue;
			}
			const control = (isHTMLButtonElement(child) || isHTMLInputElement(child)) && !child.disabled && child.tabIndex >= 0
				? child
				: this.firstControl(child);
			if (control) {
				return control;
			}
		}
		return undefined;
	}

	menuItem(parent: HTMLElement, label: string, run: () => void, options?: { readonly role?: string; readonly checked?: boolean; readonly key?: string; readonly title?: string; readonly icon?: ThemeIcon; readonly detail?: string }): HTMLButtonElement {
		const item = append(parent, $<HTMLButtonElement>('button.bh-video-panel-menu-item'));
		item.type = 'button';
		item.tabIndex = -1;
		item.dataset.menuItem = 'true';
		item.dataset.key = options?.key ?? label;
		item.setAttribute('role', options?.role ?? 'menuitem');
		if (options?.checked !== undefined) {
			item.setAttribute('aria-checked', String(options.checked));
		}
		if (options?.icon) {
			item.append(renderCodicon(options.icon, 'bh-video-panel-menu-icon'));
		}
		if (options?.detail) {
			// A second line under the name; the item is named by its label alone.
			const text = append(item, $('span.bh-video-panel-menu-text'));
			append(text, $('span.bh-video-panel-menu-label')).textContent = label;
			append(text, $('span.bh-video-panel-menu-detail')).textContent = options.detail;
			item.classList.add('detailed');
			item.setAttribute('aria-label', label);
			item.setAttribute('aria-description', options.detail);
		} else {
			append(item, $('span.bh-video-panel-menu-label')).textContent = label;
		}
		if (options?.checked) {
			item.append(renderCodicon(Codicon.check, 'bh-video-panel-menu-check'));
		}
		if (options?.title) {
			const title = options.title;
			this.panel.openMenu?.content.add(this.panel.hoverService.setupDelayedHover(item, () => ({ content: title }), { groupId: HOVER_GROUP }));
		}
		item.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			run();
		});
		return item;
	}
}
