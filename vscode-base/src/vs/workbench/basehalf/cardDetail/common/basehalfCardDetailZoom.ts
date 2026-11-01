/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the webviews of the rich editor and of the
// content viewer, whose type checks follow every import. It imports nothing.

/*
 * What every zoom of Card Detail shares (zoom and outline of a note, rule 1
 * and L5): which wheel events zoom, how much each one zooms, how far a page
 * is magnified, and when the fingers of a pinch have rested. Each page draws
 * the zoom on its own surface: a note, a picture, the time of a video or a
 * sound, a PDF, and a book.
 */

/** A page of Card Detail is magnified up to this many times as it shows at rest, as a browser magnifies its page (D96, D109). */
export const BASEHALF_ZOOM_MAX = 5;

/** The fingers of a pinch have rested once no event of it came for this long, in milliseconds (rule 6). */
export const BASEHALF_ZOOM_REST_MS = 150;

/** The largest change one wheel event makes: a notch of a mouse wheel is a step of 10% (rule 3). */
const LARGEST_EVENT_DELTA = 10;

/** How far one wheel event of a zoom goes. */
export interface IBaseHalfZoomDelta {
	readonly deltaY: number;
	/** 0 pixels, 1 lines, 2 pages, as `WheelEvent.deltaMode`. */
	readonly deltaMode: number;
}

/**
 * Whether a wheel event zooms: a pinch of the trackpad, which the browser
 * sends with Ctrl held, or the wheel with the zoom key held (rule 1).
 */
export function isBaseHalfZoomWheel(event: { readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean; readonly shiftKey: boolean }, macintosh: boolean): boolean {
	if (event.altKey || event.shiftKey) {
		return false;
	}
	return event.ctrlKey || (macintosh && event.metaKey);
}

/**
 * How much one wheel event zooms: e^(−Δy / 100), the measure the browser
 * gives a pinch, so that what is zoomed follows the fingers; a notch of a
 * mouse wheel zooms by at most 10% (rule 3).
 */
export function baseHalfZoomFactor(event: IBaseHalfZoomDelta): number {
	const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
	if (!Number.isFinite(pixels)) {
		return 1;
	}
	const delta = Math.max(-LARGEST_EVENT_DELTA, Math.min(LARGEST_EVENT_DELTA, pixels));
	return Math.exp(-delta / 100);
}

/**
 * A pinch that the window took over a page of Card Detail, a PDF or a book,
 * and hands on to that page: the browser gives a pinch of the trackpad to the
 * window, aimed at the element of the page, never to the page itself (zoom and
 * outline of a note, L5). The point is in the page's coordinates.
 */
export const BASEHALF_PAGE_PINCH_MESSAGE = 'basehalf.page.pinch';

export interface IBaseHalfPagePinchMessage extends IBaseHalfZoomDelta {
	readonly type: typeof BASEHALF_PAGE_PINCH_MESSAGE;
	readonly x: number;
	readonly y: number;
}

export function baseHalfPagePinchFromMessage(value: unknown): IBaseHalfPagePinchMessage | undefined {
	const candidate = value as Partial<IBaseHalfPagePinchMessage> | null | undefined;
	if (!candidate || typeof candidate !== 'object' || candidate.type !== BASEHALF_PAGE_PINCH_MESSAGE) {
		return undefined;
	}
	const finite = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number);
	return finite(candidate.deltaY) && finite(candidate.x) && finite(candidate.y) && (candidate.deltaMode === 0 || candidate.deltaMode === 1 || candidate.deltaMode === 2)
		? { type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: candidate.deltaY, deltaMode: candidate.deltaMode, x: candidate.x, y: candidate.y }
		: undefined;
}
