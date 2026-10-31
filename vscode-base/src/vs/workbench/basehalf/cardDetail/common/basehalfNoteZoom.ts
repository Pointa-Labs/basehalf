/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports nothing.

/** The level of a note in Card Detail, one for every note, in the profile's storage (zoom and outline of a note, rule 8). */
export const BASEHALF_NOTE_ZOOM_STORAGE_KEY = 'basehalf.noteZoom';

export const BASEHALF_NOTE_ZOOM_MIN = 0.5;
export const BASEHALF_NOTE_ZOOM_MAX = 3;

/** A gesture that ends this close to 100% ends at 100% (rule 5). */
const SETTLE_AT_ONE = 0.06;

/** The largest change one wheel event makes: a notch of a mouse wheel is a step of 10% (rule 3). */
const LARGEST_EVENT_DELTA = 10;

/** How long after its last event a gesture has ended, in milliseconds (rule 6). */
export const BASEHALF_NOTE_ZOOM_REST_MS = 150;

/** How long a page that keeps its lines glides to its place once the fingers rest, in milliseconds (rule 6). */
export const BASEHALF_NOTE_ZOOM_GLIDE_MS = 200;

export interface IBaseHalfNoteZoomWheel {
	readonly deltaY: number;
	/** 0 pixels, 1 lines, 2 pages, as `WheelEvent.deltaMode`. */
	readonly deltaMode: number;
}

/**
 * Whether a wheel event zooms the note: a pinch of the trackpad, which the
 * browser sends with Ctrl held, or the wheel with the zoom key held (rule 1).
 */
export function isBaseHalfNoteZoomWheel(event: { readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean; readonly shiftKey: boolean }, macintosh: boolean): boolean {
	if (event.altKey || event.shiftKey) {
		return false;
	}
	return event.ctrlKey || (macintosh && event.metaKey);
}

/**
 * How much one wheel event changes the level: e^(−Δy / 100), the measure the
 * browser gives a pinch, so that the page follows the fingers; a notch of a
 * mouse wheel changes it by at most 10% (rule 3).
 */
export function baseHalfNoteZoomFactor(event: IBaseHalfNoteZoomWheel): number {
	const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
	if (!Number.isFinite(pixels)) {
		return 1;
	}
	const delta = Math.max(-LARGEST_EVENT_DELTA, Math.min(LARGEST_EVENT_DELTA, pixels));
	return Math.exp(-delta / 100);
}

export function clampBaseHalfNoteZoom(level: number): number {
	if (!Number.isFinite(level)) {
		return 1;
	}
	return Math.max(BASEHALF_NOTE_ZOOM_MIN, Math.min(BASEHALF_NOTE_ZOOM_MAX, level));
}

/** The level a gesture ends at: in the range, and 100% when it is close (rule 5). */
export function settleBaseHalfNoteZoom(level: number): number {
	const clamped = clampBaseHalfNoteZoom(level);
	return Math.abs(clamped - 1) < SETTLE_AT_ONE ? 1 : clamped;
}

/** The level kept in storage, or 100% when it is no level (failure and recovery). */
export function normalizeBaseHalfNoteZoom(value: unknown): number {
	const level = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
	if (!Number.isFinite(level) || level < BASEHALF_NOTE_ZOOM_MIN || level > BASEHALF_NOTE_ZOOM_MAX) {
		return 1;
	}
	return level;
}

/**
 * A pinch that the window took over a page of Card Detail, a PDF or a book,
 * and hands on to that page: the browser gives a pinch of the trackpad to the
 * window, aimed at the element of the page, never to the page itself (zoom and
 * outline of a note, L5). The point is in the page's coordinates.
 */
export const BASEHALF_PAGE_PINCH_MESSAGE = 'basehalf.page.pinch';

export interface IBaseHalfPagePinchMessage extends IBaseHalfNoteZoomWheel {
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
