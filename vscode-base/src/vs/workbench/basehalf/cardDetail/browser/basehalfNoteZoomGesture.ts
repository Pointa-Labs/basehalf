/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports only its sibling in common/.

import {
	BASEHALF_NOTE_ZOOM_FRAME_BUDGET_MS,
	BASEHALF_NOTE_ZOOM_LIVE_ELEMENTS,
	BASEHALF_NOTE_ZOOM_REST_MS,
	baseHalfNoteZoomFactor,
	clampBaseHalfNoteZoom,
	settleBaseHalfNoteZoom,
	type IBaseHalfNoteZoomWheel,
} from '../common/basehalfNoteZoom.js';

/** The CSS variable that holds the level a page is laid out at, on the view. */
export const BASEHALF_NOTE_ZOOM_VARIABLE = '--basehalf-note-zoom';

/**
 * Draws a page at a level: its column is laid out `1 / level` as wide as the
 * view allows, at most its own width, and drawn `level` times larger from its
 * top middle. That looks as a page laid out at the level would, its text drawn
 * at the larger size, and positions in it stay those of the window, which the
 * editor's caret and menus need. The browser's `zoom` property does not keep
 * them: it reports the rectangles inside a zoomed element at the page's own
 * size (measured on 2026-10-27).
 */
export function drawBaseHalfNoteZoom(view: HTMLElement, page: HTMLElement, level: number, layOut: boolean): void {
	if (layOut) {
		view.style.setProperty(BASEHALF_NOTE_ZOOM_VARIABLE, String(level));
	}
	page.style.transform = level === 1 && layOut ? '' : `scale(${level})`;
}

/** A note's page in Card Detail, as the zoom sees it (zoom and outline of a note). */
export interface IBaseHalfNoteZoomPage {
	/** The element that scrolls. */
	readonly view: HTMLElement;
	/** The page that the level lays out and draws. */
	readonly page: HTMLElement;
	/** The text column, in which the line under the pointer is looked for. The page when there is none. */
	readonly text?: () => HTMLElement | null | undefined;
	/** Called after each change of the level, laid out or only drawn. */
	readonly onDidDraw?: () => void;
}

export interface IBaseHalfNoteZoomEvent extends IBaseHalfNoteZoomWheel {
	/** Where the pointer is, in the coordinates of the view's window. */
	readonly clientX: number;
	readonly clientY: number;
}

/** The clock of a gesture: tests replace it. */
export interface IBaseHalfNoteZoomClock {
	readonly frame: (callback: () => void) => { dispose(): void };
	readonly timeout: (callback: () => void, ms: number) => { dispose(): void };
	readonly now: () => number;
}

/** What stands under the pointer, so that it can be put back there at another level (rule 4). */
interface IAnchor {
	/** Its top in the window's coordinates when it was taken, at `level`. */
	readonly top: number;
	readonly pointerY: number;
	readonly level: number;
	/** Its top now. */
	readonly measure: () => number | undefined;
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
		now: () => target.performance.now(),
	};
}

/**
 * Zooms a note's page with the wheel events of a pinch or of the wheel with
 * the zoom key held. Each frame lays the page out at the level of its events
 * and keeps the line under the pointer at the pointer's height, as long as a
 * layout fits in a frame. Once one does not, the other frames of the gesture
 * only draw the page larger or smaller, its lines as they were last laid out,
 * and the page is laid out at the level the gesture ends at once it rests
 * (zoom and outline of a note, rules 2 to 6).
 */
export class BaseHalfNoteZoomGesture {
	/** The level the page is laid out at. */
	private laidOut: number;
	/** The level the events of the gesture so far ask for. */
	private wanted: number;
	private pointer: { readonly x: number; readonly y: number } | undefined;
	private pendingFrame: { dispose(): void } | undefined;
	private restTimer: { dispose(): void } | undefined;
	/** Set once a layout of this gesture took longer than a frame: the rest of it is only drawn. */
	private drawOnly = false;
	/**
	 * Whether a layout of this page takes longer than a frame: measured by the
	 * last one, and before the first one guessed from the page's elements.
	 */
	private slow: boolean | undefined;
	private readonly clock: IBaseHalfNoteZoomClock;
	private disposed = false;

	constructor(
		private readonly target: IBaseHalfNoteZoomPage,
		level: number,
		private readonly onDidSettle: (level: number) => void,
		clock?: IBaseHalfNoteZoomClock
	) {
		this.clock = clock ?? windowClock(target.view.ownerDocument.defaultView as Window);
		this.laidOut = this.wanted = clampBaseHalfNoteZoom(level);
		drawBaseHalfNoteZoom(target.view, target.page, this.laidOut, true);
	}

	/** The level the page is laid out at. */
	get level(): number {
		return this.laidOut;
	}

	/** Whether a gesture is going on: it began and has not rested yet. */
	get active(): boolean {
		return this.restTimer !== undefined;
	}

	/** Takes one wheel event of a zoom. */
	zoomBy(event: IBaseHalfNoteZoomEvent): void {
		if (this.disposed) {
			return;
		}
		this.wanted = clampBaseHalfNoteZoom(this.wanted * baseHalfNoteZoomFactor(event));
		this.pointer = { x: event.clientX, y: event.clientY };
		if (!this.pendingFrame) {
			this.pendingFrame = this.clock.frame(() => this.onFrame());
		}
		this.restTimer?.dispose();
		this.restTimer = this.clock.timeout(() => this.rest(), BASEHALF_NOTE_ZOOM_REST_MS);
	}

	/**
	 * Lays the page out at a level that came from elsewhere, another projection
	 * or window, keeping the line at the top of the view where it is. A gesture
	 * going on keeps its own level.
	 */
	setLevel(level: number): void {
		const next = clampBaseHalfNoteZoom(level);
		if (this.disposed || this.active || Math.abs(next - this.laidOut) < 1e-4) {
			return;
		}
		const viewTop = this.target.view.getBoundingClientRect().top;
		this.draw(next, true, this.takeAnchor(undefined, viewTop));
		this.wanted = next;
	}

	dispose(): void {
		this.disposed = true;
		this.pendingFrame?.dispose();
		this.pendingFrame = undefined;
		this.restTimer?.dispose();
		this.restTimer = undefined;
	}

	private onFrame(): void {
		this.pendingFrame = undefined;
		if (this.disposed) {
			return;
		}
		const anchor = this.takeAnchor(this.pointer?.x, this.pointer?.y);
		// The page is drawn by the note's renderer; only its size is counted here.
		// eslint-disable-next-line no-restricted-syntax
		this.slow ??= this.target.page.getElementsByTagName('*').length > BASEHALF_NOTE_ZOOM_LIVE_ELEMENTS;
		if (this.slow && this.active) {
			this.drawOnly = true;
		}
		if (this.drawOnly) {
			this.draw(this.wanted, false, anchor);
			return;
		}
		if (Math.abs(this.wanted - this.laidOut) < 1e-4) {
			return;
		}
		const started = this.clock.now();
		this.draw(this.wanted, true, anchor);
		this.slow = this.clock.now() - started > BASEHALF_NOTE_ZOOM_FRAME_BUDGET_MS;
		if (this.slow && this.active) {
			this.drawOnly = true;
		}
	}

	/** The gesture has rested: the page is laid out at the level it ends at (rules 5 and 6). */
	private rest(): void {
		this.restTimer = undefined;
		this.pendingFrame?.dispose();
		this.pendingFrame = undefined;
		if (this.disposed) {
			return;
		}
		const level = settleBaseHalfNoteZoom(this.wanted);
		if (this.drawOnly || Math.abs(level - this.laidOut) >= 1e-4) {
			const started = this.clock.now();
			this.draw(level, true, this.takeAnchor(this.pointer?.x, this.pointer?.y));
			this.slow = this.clock.now() - started > BASEHALF_NOTE_ZOOM_FRAME_BUDGET_MS;
		}
		this.drawOnly = false;
		this.wanted = level;
		this.pointer = undefined;
		this.onDidSettle(level);
	}

	/**
	 * Draws the page at a level, laid out anew or not, and puts the anchor's
	 * line back, grown or shrunk with the page, around the pointer.
	 */
	private draw(level: number, layOut: boolean, anchor: IAnchor): void {
		drawBaseHalfNoteZoom(this.target.view, this.target.page, level, layOut);
		if (layOut) {
			this.laidOut = level;
		}
		const view = this.target.view;
		const top = anchor.measure();
		if (top !== undefined && view.clientHeight > 0) {
			const wanted = anchor.pointerY - (anchor.pointerY - anchor.top) * (level / anchor.level);
			view.scrollTop += top - wanted;
		}
		this.target.onDidDraw?.();
	}

	/**
	 * The line under the pointer: the place in the text at the pointer's
	 * height in the text column, or the element there, or else the point of
	 * the page itself.
	 */
	private takeAnchor(clientX: number | undefined, clientY: number | undefined): IAnchor {
		const view = this.target.view;
		const page = this.target.page;
		const level = this.currentScale();
		const viewBox = view.getBoundingClientRect();
		const text = (this.target.text?.() ?? page).getBoundingClientRect();
		const y = Math.min(Math.max(clientY ?? viewBox.top, viewBox.top + 1), Math.max(viewBox.top + 1, viewBox.bottom - 1));
		const x = Math.min(Math.max(clientX ?? (text.left + text.right) / 2, text.left + 2), Math.max(text.left + 2, text.right - 2));
		const ownerDocument = view.ownerDocument;
		const range = ownerDocument.caretRangeFromPoint?.(x, y);
		if (range && page.contains(range.startContainer)) {
			const measure = () => {
				const box = range.getBoundingClientRect();
				if (box.top !== 0 || box.bottom !== 0 || box.height !== 0) {
					return box.top;
				}
				const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
				return parent?.getBoundingClientRect().top;
			};
			const top = measure();
			if (top !== undefined) {
				return { top, pointerY: y, level, measure };
			}
		}
		const element = ownerDocument.elementFromPoint(x, y);
		if (element && element !== page && page.contains(element)) {
			const measure = () => element.isConnected ? element.getBoundingClientRect().top : undefined;
			return { top: element.getBoundingClientRect().top, pointerY: y, level, measure };
		}
		// The point of the page itself, which moves with the level from the page's top.
		const pageTop = page.getBoundingClientRect().top;
		return {
			top: y,
			pointerY: y,
			level,
			measure: () => page.getBoundingClientRect().top + (y - pageTop) * (this.currentScale() / level),
		};
	}

	/** The scale the page is drawn at now, laid out or not. */
	private currentScale(): number {
		const match = /scale\(([\d.]+)\)/.exec(this.target.page.style.transform);
		return match ? Number(match[1]) : 1;
	}
}
