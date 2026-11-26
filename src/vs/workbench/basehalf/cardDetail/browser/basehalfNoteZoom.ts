/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports only its sibling in common/.

import { BASEHALF_ZOOM_MAX, BASEHALF_ZOOM_REST_MS, baseHalfZoomFactor, type IBaseHalfZoomDelta } from '../common/basehalfCardDetailZoom.js';

/** A note's page in Card Detail, as the zoom sees it (zoom and outline of a note). */
export interface IBaseHalfNoteZoomPage {
	/** The element that scrolls. */
	readonly view: HTMLElement;
	/** The page in it, as wide as the view, with the room around the text: what the zoom magnifies. */
	readonly page: HTMLElement;
	/** Called after each frame that changes the level. */
	readonly onDidDraw?: () => void;
}

export interface IBaseHalfNoteZoomEvent extends IBaseHalfZoomDelta {
	/** Where the pointer is, in the coordinates of the view's window. */
	readonly clientX: number;
	readonly clientY: number;
}

/** The clock of a gesture: tests replace it. */
export interface IBaseHalfNoteZoomClock {
	readonly frame: (callback: () => void) => { dispose(): void };
	readonly timeout: (callback: () => void, ms: number) => { dispose(): void };
}

function windowClock(target: Window): IBaseHalfNoteZoomClock {
	return {
		frame: callback => {
			const handle = target.requestAnimationFrame(callback);
			return { dispose: () => target.cancelAnimationFrame(handle) };
		},
		timeout: (callback, ms) => {
			const handle = target.setTimeout(callback, ms);
			return { dispose: () => target.clearTimeout(handle) };
		},
	};
}

/**
 * Magnifies a note's page with the wheel events of a pinch or of the wheel
 * with the zoom key held, as a browser magnifies its page (zoom and outline of
 * a note, rules 2 to 6): the page is drawn larger around the pointer, from
 * 100% to 500%, and nothing of it is laid out anew. It grows from its top left
 * corner, and the view scrolls the point under the pointer back under it; the
 * view scrolls the magnified page up and down and sideways, as far as its
 * edges. While the events come, the page is a layer of its own, which the
 * window scales without drawing it anew; once they rest, it is drawn sharp
 * where it is.
 */
export class BaseHalfNoteZoom {
	/** The level the page is drawn at. */
	private drawn = 1;
	/** The level the events of the gesture so far ask for, drawn in the next frame. */
	private wanted = 1;
	private pointer: { readonly x: number; readonly y: number } | undefined;
	/**
	 * The scroll of the view that the gesture asks for. The view keeps its
	 * scroll to a fraction of a pixel of the screen; counting on from what it
	 * kept, the place under the pointer would drift by that fraction in every
	 * frame (9 pixels over a pinch to 250%, measured on 2026-11-01).
	 */
	private scroll: { readonly x: number; readonly y: number } | undefined;
	private pendingFrame: { dispose(): void } | undefined;
	private restTimer: { dispose(): void } | undefined;
	private readonly clock: IBaseHalfNoteZoomClock;
	private disposed = false;

	constructor(private readonly target: IBaseHalfNoteZoomPage, clock?: IBaseHalfNoteZoomClock) {
		this.clock = clock ?? windowClock(target.view.ownerDocument.defaultView as Window);
	}

	/** How much larger than at 100% the page is drawn. */
	get level(): number {
		return this.drawn;
	}

	/** Takes one wheel event of a zoom. */
	zoomBy(event: IBaseHalfNoteZoomEvent): void {
		if (this.disposed) {
			return;
		}
		this.wanted = Math.min(BASEHALF_ZOOM_MAX, Math.max(1, this.wanted * baseHalfZoomFactor(event)));
		this.pointer = { x: event.clientX, y: event.clientY };
		this.pendingFrame ??= this.clock.frame(() => this.onFrame());
		this.restTimer?.dispose();
		this.restTimer = this.clock.timeout(() => this.rest(), BASEHALF_ZOOM_REST_MS);
	}

	/** Shows the page at 100% at once, as Card Detail shows a note it opens (rule 8). */
	reset(): void {
		this.endGesture();
		this.wanted = 1;
		this.draw(1);
	}

	dispose(): void {
		this.reset();
		this.disposed = true;
	}

	/**
	 * A frame of a gesture: the page grows or shrinks from its top left corner,
	 * and the view scrolls by as much as the point under the pointer moved, so
	 * that it stays under the pointer, as far as the edges of the magnified
	 * page allow (rules 2 and 5).
	 */
	private onFrame(): void {
		this.pendingFrame = undefined;
		const pointer = this.pointer;
		if (this.disposed || !pointer || this.wanted === this.drawn) {
			return;
		}
		const { view, page } = this.target;
		const viewBox = view.getBoundingClientRect();
		const pageBox = page.getBoundingClientRect();
		// The pointer, and the page's top left corner in what the view scrolls, which the zoom keeps where it is.
		const x = pointer.x - viewBox.left - view.clientLeft;
		const y = pointer.y - viewBox.top - view.clientTop;
		const left = pageBox.left - viewBox.left - view.clientLeft + view.scrollLeft;
		const top = pageBox.top - viewBox.top - view.clientTop + view.scrollTop;
		// A scroll of the view between the frames of a gesture counts from where the view is.
		const kept = this.scroll && Math.abs(this.scroll.x - view.scrollLeft) < 1 && Math.abs(this.scroll.y - view.scrollTop) < 1 ? this.scroll : { x: view.scrollLeft, y: view.scrollTop };
		const grow = this.wanted / this.drawn;
		page.style.willChange = 'transform';
		this.draw(this.wanted);
		// The scroll range grew or shrank with the page.
		const scroll = {
			x: Math.min(Math.max(0, left + (kept.x + x - left) * grow - x), view.scrollWidth - view.clientWidth),
			y: Math.min(Math.max(0, top + (kept.y + y - top) * grow - y), view.scrollHeight - view.clientHeight),
		};
		view.scrollLeft = scroll.x;
		view.scrollTop = scroll.y;
		this.scroll = scroll;
		this.target.onDidDraw?.();
	}

	/** The fingers have rested: the page is drawn sharp at its level, where it is (rule 6). */
	private rest(): void {
		this.restTimer = undefined;
		if (this.pendingFrame) {
			this.pendingFrame.dispose();
			this.onFrame();
		}
		this.scroll = undefined;
		this.target.page.style.willChange = '';
	}

	private endGesture(): void {
		this.pendingFrame?.dispose();
		this.pendingFrame = undefined;
		this.restTimer?.dispose();
		this.restTimer = undefined;
		this.pointer = undefined;
		this.scroll = undefined;
		this.target.page.style.willChange = '';
	}

	private draw(level: number): void {
		this.drawn = level;
		const page = this.target.page;
		page.style.transformOrigin = level === 1 ? '' : '0 0';
		page.style.transform = level === 1 ? '' : `scale(${level})`;
	}
}
