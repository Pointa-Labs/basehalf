/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM } from '../../shell/common/basehalfConfiguration.js';

// The canvas's zoom and the window's (each part zooms by itself, rules 2 and 5). The canvas's zoom is the size of its
// cards on the screen, which the zoom control shows, the keys step, and a folder keeps. The canvas library draws in
// the window's pixels, which the window's zoom makes larger: it draws at the canvas's zoom divided by the window's.

/**
 * The canvas keeps its zoom with four decimals, so that a zoom compares equal to the one it was set to. The zoom the
 * library draws at keeps six: one of a division by the window's zoom gives the canvas's zoom back to four.
 */
function rounded(zoom: number, decimals: 4 | 6): number {
	return Number(zoom.toFixed(decimals));
}

/** The window's zoom factor, or 1 for a value no window has. */
function factorOf(windowZoomFactor: number): number {
	return Number.isFinite(windowZoomFactor) && windowZoomFactor > 0 ? windowZoomFactor : 1;
}

/** The canvas's zoom of a zoom the library draws at, within the canvas's range. */
export function baseHalfCanvasShownZoom(drawnZoom: number, windowZoomFactor: number): number {
	const shown = Number.isFinite(drawnZoom) && drawnZoom > 0 ? drawnZoom * factorOf(windowZoomFactor) : 1;
	return rounded(Math.min(BASEHALF_CANVAS_MAX_ZOOM, Math.max(BASEHALF_CANVAS_MIN_ZOOM, shown)), 4);
}

/** The zoom the library draws at for a zoom of the canvas, which is first brought into the canvas's range. */
export function baseHalfCanvasDrawnZoom(shownZoom: number, windowZoomFactor: number): number {
	const shown = Number.isFinite(shownZoom) ? Math.min(BASEHALF_CANVAS_MAX_ZOOM, Math.max(BASEHALF_CANVAS_MIN_ZOOM, shownZoom)) : 1;
	return rounded(shown / factorOf(windowZoomFactor), 6);
}

/** A zoom the library drew at, brought into the canvas's range at this zoom of the window. */
export function normalizeBaseHalfCanvasDrawnZoom(drawnZoom: number, windowZoomFactor: number): number {
	return baseHalfCanvasDrawnZoom(baseHalfCanvasShownZoom(drawnZoom, windowZoomFactor), windowZoomFactor);
}

/** The range of the library's zoom that is the canvas's range at this zoom of the window. */
export function baseHalfCanvasDrawnZoomRange(windowZoomFactor: number): { readonly min: number; readonly max: number } {
	const factor = factorOf(windowZoomFactor);
	return { min: BASEHALF_CANVAS_MIN_ZOOM / factor, max: BASEHALF_CANVAS_MAX_ZOOM / factor };
}
