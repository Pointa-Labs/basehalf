/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow, isHTMLElement, isSVGElement } from '../../../base/browser/dom.js';
import { combinedDisposable, IDisposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import {
	BASEHALF_CANVAS_SIDEWAYS_BOX_CLASS,
	BaseHalfCanvasWheelGestures,
	IBaseHalfCanvasWheelDelta,
	IBaseHalfCanvasWheelExtent,
	baseHalfCanvasWheelAfterQuietTime,
	baseHalfCanvasWheelContentPosition
} from '../common/basehalfCanvasWheelGesture.js';
import { buildBaseHalfCanvasNotePartsTo } from './basehalfCanvasNoteParts.js';

const CARD_SELECTOR = '.basehalf-canvas-card';
const CARD_CONTENT_SELECTOR = '.basehalf-canvas-card-content';
const OWN_SCROLL_SELECTOR = '.nowheel';
const SIDEWAYS_BOX_SELECTOR = `.${BASEHALF_CANVAS_SIDEWAYS_BOX_CLASS}`;

export interface IBaseHalfCanvasWheelGestureOptions {
	/** The canvas zoom: screen pixels per flow pixel. */
	readonly zoom: () => number;
	/** The newest element of the card at `path`. It may not be in the document yet. */
	readonly card: (path: string) => HTMLElement | undefined;
	/** The scrollable content that a card element holds, if it holds any. */
	readonly scrollableContent: (card: HTMLElement) => HTMLElement | undefined;
	/**
	 * Calls back once the quiet time has passed, unless it is disposed first.
	 * Tests replace it.
	 */
	readonly afterQuietTime?: (callback: () => void) => IDisposable;
}

function wheelTarget(event: WheelEvent): Element | undefined {
	return isHTMLElement(event.target) || isSVGElement(event.target) ? event.target : undefined;
}

/** The nearest element around `target` that is not inside a surface that takes the wheel. */
function outsideOwnScrollSurfaces(target: Element): Element | undefined {
	let outside: Element | null = target;
	for (let surface = target.closest(OWN_SCROLL_SELECTOR); surface; surface = outside?.closest(OWN_SCROLL_SELECTOR) ?? null) {
		outside = surface.parentElement;
	}
	return outside ?? undefined;
}

/**
 * Applies the canvas wheel gestures to the canvas scene: it scrolls the
 * content of a card for the gestures that the content owns, and it keeps a
 * gesture of the canvas with the canvas over surfaces that would take the
 * wheel. The canvas itself pans on the events that this leaves alone.
 */
export function installBaseHalfCanvasWheelGestures(host: HTMLElement, options: IBaseHalfCanvasWheelGestureOptions): IDisposable {
	const gestures = new BaseHalfCanvasWheelGestures();
	const targetWindow = getWindow(host);
	const afterQuietTime = options.afterQuietTime ?? (callback => baseHalfCanvasWheelAfterQuietTime({
		now: () => targetWindow.performance.now(),
		setTimeout: (handler, ms) => targetWindow.setTimeout(handler, ms),
		clearTimeout: timer => targetWindow.clearTimeout(timer)
	}, callback));
	const quietTime = new MutableDisposable();
	// The card element of the running gesture: the one that was on screen when
	// the gesture began, or the one that has replaced it since.
	let gestureCard: { readonly path: string; element: HTMLElement } | undefined;
	// The sideways box that the running gesture began on.
	let gestureSidewaysBox: HTMLElement | undefined;
	// Kept apart from `scrollTop` and `scrollLeft`, which are rounded: fractions of a pixel add up here.
	let scrolled: { readonly element: HTMLElement; position: number } | undefined;
	let redirecting = false;

	const shownContent = (path: string): HTMLElement | undefined => {
		if (gestureCard?.path !== path) {
			return undefined;
		}
		if (!gestureCard.element.isConnected) {
			const redrawn = options.card(path);
			if (!redrawn?.isConnected) {
				return undefined;
			}
			gestureCard.element = redrawn;
		}
		const content = options.scrollableContent(gestureCard.element);
		// A Note's resting projection is inert while its editor covers it.
		return content?.isConnected && !content.hasAttribute('inert') ? content : undefined;
	};

	const extent = (path: string): IBaseHalfCanvasWheelExtent | undefined => {
		const content = shownContent(path);
		if (!content) {
			return undefined;
		}
		// A note built in parts has the parts ahead of its place built, so its
		// end is the end of the note and not the end of what is built so far.
		buildBaseHalfCanvasNotePartsTo(content, content.scrollTop);
		return { position: content.scrollTop, max: content.scrollHeight - content.clientHeight };
	};

	// A box that was redrawn is not the box the gesture began on.
	const shownSidewaysBox = (path: string): HTMLElement | undefined => {
		const content = shownContent(path);
		return content && gestureSidewaysBox && content.contains(gestureSidewaysBox) ? gestureSidewaysBox : undefined;
	};

	const sidewaysExtent = (path: string): IBaseHalfCanvasWheelExtent | undefined => {
		const box = shownSidewaysBox(path);
		return box ? { position: box.scrollLeft, max: box.scrollWidth - box.clientWidth } : undefined;
	};

	// Moves `element` along one of its scroll directions by `delta` screen pixels.
	const scrollBy = (element: HTMLElement, direction: 'scrollTop' | 'scrollLeft', max: number, delta: number): void => {
		// A redrawn card has a new element, and something else may have scrolled this one.
		if (scrolled?.element !== element || Math.abs(element[direction] - scrolled.position) >= 1) {
			scrolled = { element, position: element[direction] };
		}
		const zoom = options.zoom();
		scrolled.position = baseHalfCanvasWheelContentPosition({ position: scrolled.position, max }, delta / (zoom > 0 ? zoom : 1));
		element[direction] = scrolled.position;
	};

	const scroll = (path: string, deltaY: number): void => {
		const content = shownContent(path);
		if (content) {
			const zoom = options.zoom();
			buildBaseHalfCanvasNotePartsTo(content, content.scrollTop + deltaY / (zoom > 0 ? zoom : 1));
			scrollBy(content, 'scrollTop', content.scrollHeight - content.clientHeight, deltaY);
		}
	};

	const scrollSideways = (path: string, deltaX: number): void => {
		const box = shownSidewaysBox(path);
		if (box) {
			scrollBy(box, 'scrollLeft', box.scrollWidth - box.clientWidth, deltaX);
		}
	};

	const take = (event: WheelEvent): void => {
		if (event.cancelable) {
			event.preventDefault();
		}
		event.stopPropagation();
	};

	// The canvas pans on the wheel events that reach it, and it leaves alone
	// those on a surface that takes the wheel. Hand it a copy from just outside
	// such a surface, in pixels, so that it moves by exactly these deltas.
	const panCanvas = (event: WheelEvent, target: Element, deltaX: number, deltaY: number): void => {
		const outside = outsideOwnScrollSurfaces(target);
		if (!outside || !host.contains(outside) || !event.cancelable) {
			return;
		}
		take(event);
		redirecting = true;
		try {
			outside.dispatchEvent(new targetWindow.WheelEvent('wheel', {
				deltaX,
				deltaY,
				deltaMode: event.DOM_DELTA_PIXEL,
				clientX: event.clientX,
				clientY: event.clientY,
				screenX: event.screenX,
				screenY: event.screenY,
				altKey: event.altKey,
				bubbles: true,
				cancelable: true,
				view: targetWindow
			}));
		} finally {
			redirecting = false;
		}
	};

	const listener = addDisposableListener(host, 'wheel', (event: WheelEvent) => {
		// Pinch and wheel zoom are not scrolls. They stay with the canvas.
		if (redirecting || event.ctrlKey || (isMacintosh && event.metaKey)) {
			return;
		}
		const target = wheelTarget(event);
		// The canvas pans by the same pixels: a line is 20 of them, and where Shift
		// turns the wheel sideways, the vertical movement becomes horizontal.
		const scale = event.deltaMode === event.DOM_DELTA_LINE ? 20 : 1;
		const sideways = !isMacintosh && event.shiftKey;
		const delta: IBaseHalfCanvasWheelDelta = {
			deltaX: (sideways ? event.deltaY : event.deltaX) * scale,
			deltaY: sideways ? 0 : event.deltaY * scale
		};
		const step = gestures.step(delta, () => {
			const element = target?.closest(CARD_CONTENT_SELECTOR)?.closest<HTMLElement>(CARD_SELECTOR);
			const path = element?.dataset.basehalfCardPath;
			gestureCard = element && path !== undefined ? { path, element } : undefined;
			gestureSidewaysBox = target?.closest<HTMLElement>(SIDEWAYS_BOX_SELECTOR) ?? undefined;
			return { ownScroll: !!target?.closest(OWN_SCROLL_SELECTOR), card: path, buttonHeld: event.buttons !== 0 };
		}, extent, sidewaysExtent);
		quietTime.value = afterQuietTime(() => gestures.end());
		switch (step.kind) {
			case 'hold':
				take(event);
				break;
			case 'scroll':
				take(event);
				scroll(step.card, step.deltaY);
				break;
			case 'scrollSideways':
				take(event);
				scrollSideways(step.card, step.deltaX);
				break;
			case 'pan':
				if (target && (step.held || target.closest(OWN_SCROLL_SELECTOR))) {
					panCanvas(event, target, step.deltaX, step.deltaY);
				}
				break;
		}
	}, { capture: true, passive: false });
	return combinedDisposable(listener, quietTime);
}
