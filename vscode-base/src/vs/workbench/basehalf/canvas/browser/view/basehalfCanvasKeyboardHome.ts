/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { baseHalfCanvasKeyboardPlaceAfter, BaseHalfKeyboardNowhere, baseHalfKeyboardReturnsTo } from '../../common/basehalfCanvasKeyboardHome.js';
import { IBaseHalfKeyboardPart } from '../basehalfKeyboardParts.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';

/**
 * Where the keyboard returns (docs/specs/keyboard-return.md): the keyboard is always somewhere that
 * answers. This part remembers the card that last had the keyboard on the canvas, and gives the keyboard
 * to what the rule names when it would be on the page itself, where the browser puts it once the element
 * that had it is gone, or on the empty editor group under the canvas, where the base puts it when it
 * gives the keyboard to its editor area. The closings of the canvas ask it instead of naming an element.
 */
/**
 * How long after the keyboard was lost to nothing the rule looks, in milliseconds (where the keyboard returns,
 * "When the rule looks"): past the next frame, by when a control that takes the place of the one that went has
 * taken the keyboard, and under what a user notices.
 */
const LOOK_DELAY = 50;

export class BaseHalfCanvasKeyboardHome {

	/** The card that last had the keyboard on the canvas, by its file; none: the canvas itself. */
	private home: URI | undefined;
	/** What this part gave the keyboard to by itself, while the keyboard has not moved since. */
	private given: Element | undefined;
	/** The part of the window the keyboard left for nothing, until the keyboard is somewhere again. */
	private leftPart: IBaseHalfKeyboardPart | undefined;
	private openDialogs = 0;
	private lookTimer: number | undefined;
	private giving = false;
	/** The Tab key is down, and whether with Shift: the keyboard that arrives somewhere now was sent by it. */
	private tabbing: { readonly backward: boolean } | undefined;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	/** Starts following the keyboard. The view calls it once its elements are made. */
	start(): IDisposable {
		const store = new DisposableStore();
		const root = this.view.root;
		const ownerDocument = root.ownerDocument;
		const targetWindow = DOM.getWindow(root);
		store.add(DOM.addDisposableListener(ownerDocument, DOM.EventType.FOCUS_IN, event => this.onFocusIn(event.target), true));
		// The browser tells the element that loses the keyboard to nothing, also when the element is taken
		// away, hidden, or disabled. Whoever removed it may give the keyboard to something in the same
		// turn: this part looks once that turn is over.
		store.add(DOM.addDisposableListener(ownerDocument, DOM.EventType.FOCUS_OUT, event => {
			if (event.relatedTarget === null) {
				this.leftPart = this.view.keyboardPartsService.partOf(event.composedPath());
				this.lookSoon();
			}
		}, true));
		store.add(DOM.addDisposableListener(ownerDocument, DOM.EventType.KEY_DOWN, event => {
			// A key shows a card's ring again, should a press of the pointer have ended it.
			if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Alt' && event.key !== 'Meta') {
				root.removeAttribute('data-pointer-input');
			}
			this.tabbing = event.key === 'Tab' ? { backward: event.shiftKey } : undefined;
			// The user works where the keyboard is: it stands in for nothing any more.
			this.given = undefined;
			// A key on the page itself, should the keyboard still be there: the rule sends the keyboard
			// before the base looks the key up, so the key acts where the keyboard belongs.
			if (event.target === ownerDocument.body) {
				this.giveIfNowhere();
			}
		}, true));
		store.add(DOM.addDisposableListener(ownerDocument, DOM.EventType.KEY_UP, () => { this.tabbing = undefined; }, true));
		store.add(DOM.addDisposableListener(ownerDocument, DOM.EventType.POINTER_DOWN, event => {
			// A ring is for the keyboard: a press of the pointer ends the ring of a card that a key gave one,
			// which the browser alone keeps until the keyboard moves to another element.
			root.setAttribute('data-pointer-input', '');
			this.tabbing = undefined;
			this.given = undefined;
			// A press on the blank canvas makes the canvas itself the place, also while it has the keyboard already.
			const target = event.target;
			if ((DOM.isHTMLElement(target) || DOM.isSVGElement(target)) && this.view.cards.contains(target) && !target.closest('.react-flow__node')) {
				const { keyboardOn } = this.view.keys.placeOf(target);
				if (keyboardOn === 'canvas' || keyboardOn === 'scene') {
					this.home = undefined;
				}
			}
		}, true));
		store.add(this.view.dialogService.onWillShowDialog(() => { this.openDialogs++; }));
		store.add(this.view.dialogService.onDidShowDialog(() => { this.openDialogs = Math.max(0, this.openDialogs - 1); }));
		store.add(toDisposable(() => {
			if (this.lookTimer !== undefined) {
				targetWindow.clearTimeout(this.lookTimer);
			}
		}));
		// A window that opens: the base gave the keyboard to its editor area before the canvas was there.
		this.giveIfNowhere();
		void this.view.layoutService.whenRestored.then(() => {
			if (!this.view.disposed) {
				this.giveIfNowhere();
			}
		});
		return store;
	}

	/** Gives the keyboard to its place on the canvas: the card that last had it, or the canvas itself; Card Detail while that is open. */
	give(): void {
		this.giveBy('page');
	}

	/** Gives the keyboard to the card of `resource` when the canvas shows it, and to the canvas itself otherwise. */
	giveToCardOf(resource: URI): void {
		this.setHome(resource);
		this.give();
	}

	/**
	 * The card of `resource` is the place from now on. What has the keyboard now is about to go: the
	 * editor of the card's name, or the card itself, which is drawn anew under its new name. The card of
	 * `resource` takes the keyboard then, once it is drawn.
	 */
	setHome(resource: URI): void {
		this.home = resource;
	}

	/** Whether `element` has the keyboard because this part put it there, with nothing having moved it since: it stands where the page itself stood. */
	gave(element: Element | null): boolean {
		return !!element && element === this.given;
	}

	/** Files were moved: a card that is the place stays the place under its new name. */
	followMoves(files: readonly { readonly source?: URI; readonly target: URI }[]): void {
		const extUri = this.view.uriIdentityService.extUri;
		for (const { source, target } of files) {
			if (this.home && source && extUri.isEqual(this.home, source)) {
				this.home = target;
			}
		}
	}

	/**
	 * The scene has put a card's element into the page. When this part gave the canvas the keyboard only
	 * because the card it belongs to was not drawn yet, as after a rename, the card takes it now.
	 */
	cardMounted(element: HTMLElement): void {
		const ownerDocument = this.view.root.ownerDocument;
		if (this.given === this.view.cards && ownerDocument.activeElement === this.view.cards && this.homeCard() === element) {
			this.giveBy('page');
		}
	}

	private onFocusIn(target: EventTarget | null): void {
		if (!DOM.isHTMLElement(target) && !DOM.isSVGElement(target)) {
			return;
		}
		// What this part gives the keyboard to is no new place: the canvas itself may only stand in for a card that is not drawn yet.
		if (this.giving) {
			return;
		}
		if (target !== this.given) {
			this.given = undefined;
		}
		this.leftPart = undefined;
		if (this.isEmptyGroup(target)) {
			const tabbing = this.tabbing;
			if (tabbing && this.passTabOn(target, tabbing.backward)) {
				return;
			}
			this.giveBy('emptyGroup');
			return;
		}
		if (!this.view.root.contains(target)) {
			return;
		}
		const { keyboardOn, cardPath } = this.view.keys.placeOf(target);
		// The frame the canvas library draws around a card stands for the card.
		const path = cardPath ?? (keyboardOn === 'scene' ? this.cardInFrame(target) : undefined);
		const resource = path !== undefined ? this.view.renderedItemsByPath.get(path)?.stat.resource : undefined;
		const next = baseHalfCanvasKeyboardPlaceAfter(this.home?.toString(), keyboardOn, resource?.toString());
		this.home = next === undefined ? undefined : next === resource?.toString() ? resource : this.home;
	}

	private lookSoon(): void {
		if (this.lookTimer !== undefined) {
			return;
		}
		this.lookTimer = DOM.getWindow(this.view.root).setTimeout(() => {
			this.lookTimer = undefined;
			if (!this.view.disposed) {
				this.giveIfNowhere();
			}
		}, LOOK_DELAY);
	}

	/** Gives the keyboard by the rule when it is on the page itself or on the empty editor group. */
	private giveIfNowhere(): void {
		const where = this.keyboardOn();
		if (where !== 'elsewhere') {
			this.giveBy(where);
		}
	}

	private keyboardOn(): BaseHalfKeyboardNowhere {
		const ownerDocument = this.view.root.ownerDocument;
		const active = ownerDocument.activeElement;
		if (!active || active === ownerDocument.body || active === ownerDocument.documentElement) {
			return 'page';
		}
		return this.isEmptyGroup(active) ? 'emptyGroup' : 'elsewhere';
	}

	/** Whether `element` is the empty editor group that lies under the canvas. */
	private isEmptyGroup(element: Element): boolean {
		return element.classList.contains('editor-group-container') && element.classList.contains('empty') && this.view.editorContainer.contains(element);
	}

	private giveBy(keyboardOn: BaseHalfKeyboardNowhere): void {
		if (this.giving) {
			return;
		}
		const homeCard = this.homeCard();
		const part = this.leftPart;
		const taker = baseHalfKeyboardReturnsTo({
			keyboardOn,
			leftPart: !!part,
			dialogOpen: this.openDialogs > 0,
			overlayOpen: !!this.view.editorGroupsService.activeModalEditorPart,
			editorOverCanvas: !this.view.canvasNavigationService.isSurfaceActive,
			cardDetailOpen: !!this.view.canvasNavigationService.state.cardDetail,
			homeCardShown: !!homeCard
		});
		this.giving = true;
		this.given = undefined;
		try {
			switch (taker) {
				case 'nothing':
					return;
				case 'overlay':
					this.view.editorGroupsService.activeModalEditorPart?.activeGroup.focus();
					return;
				case 'part':
					// The part gives the keyboard to what it has; with nothing to take it, the rule goes on.
					this.leftPart = undefined;
					void part?.take().then(took => {
						if (!took && !this.view.disposed) {
							this.giveIfNowhere();
						}
					}, () => undefined);
					return;
				case 'editor':
					this.view.editorGroupsService.mainPart.activeGroup.focus();
					return;
				case 'cardDetail':
					this.view.cardDetailHost.takeKeyboard();
					return;
				case 'card':
				case 'canvas': {
					// Nothing moves: neither the canvas nor anything that scrolls.
					const element = taker === 'card' && homeCard ? homeCard : this.view.cards;
					element.focus({ preventScroll: true });
					if (element.ownerDocument.activeElement === element) {
						this.given = element;
					}
				}
			}
		} finally {
			this.giving = false;
		}
	}

	/** The path of the card whose frame, which the canvas library draws around it, `element` is. */
	private cardInFrame(element: Element): string | undefined {
		if (!element.classList.contains('react-flow__node')) {
			return undefined;
		}
		for (const [path, card] of this.view.renderedCardElementsByPath) {
			if (element.contains(card)) {
				return path;
			}
		}
		return undefined;
	}

	/** The element of the card that is the place, when the canvas that is shown holds it. */
	private homeCard(): HTMLElement | undefined {
		if (!this.home) {
			return undefined;
		}
		const extUri = this.view.uriIdentityService.extUri;
		for (const [path, item] of this.view.renderedItemsByPath) {
			if (extUri.isEqual(item.stat.resource, this.home)) {
				const element = this.view.renderedCardElementsByPath.get(path);
				return element?.isConnected && this.view.cards.contains(element) ? element : undefined;
			}
		}
		return undefined;
	}

	/**
	 * The Tab key brought the keyboard to the empty editor group, which the user cannot see: the keyboard
	 * goes on to the stop after it, or before it with Shift. Without one, the rule takes over.
	 */
	private passTabOn(group: Element, backward: boolean): boolean {
		const ownerDocument = group.ownerDocument;
		const targetWindow = DOM.getWindow(group);
		// What the Tab key stops at: what takes the keyboard in its turn, is shown, and is not switched off.
		const walker = ownerDocument.createTreeWalker(ownerDocument.body, NodeFilter.SHOW_ELEMENT, {
			acceptNode: node => DOM.isHTMLElement(node) && node.tabIndex >= 0 && !group.contains(node)
				&& !(node as HTMLButtonElement).disabled
				&& node.getClientRects().length > 0
				&& targetWindow.getComputedStyle(node).visibility !== 'hidden'
				&& !node.closest('[inert]')
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP
		});
		walker.currentNode = group;
		const stop = backward ? walker.previousNode() : walker.nextNode();
		if (!DOM.isHTMLElement(stop)) {
			return false;
		}
		this.giving = true;
		try {
			stop.focus();
		} finally {
			this.giving = false;
		}
		return ownerDocument.activeElement === stop;
	}
}
