/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The background of the canvas (workbench appearance, "The background of the
 * canvas"): how far apart its lines are, and where its dots stand at a zoom.
 */

/** The lines of the background are this many flow pixels apart, and so are the dots at a zoom of 100%. */
export const BASEHALF_CANVAS_BACKGROUND_GAP = 40;

/** A dot is this many screen pixels across at every zoom. */
export const BASEHALF_CANVAS_DOT_SCREEN_SIZE = 2;

/** How much of the ink a dot has: the text color of the window, of which a line has 4.5%. */
export const BASEHALF_CANVAS_DOT_STRENGTH = 0.22;

/** The dots of the background at a zoom. */
export interface IBaseHalfCanvasDotGrid {
	/** How far apart the dots that always show are, in flow pixels: between 40 and 80 screen pixels. */
	readonly gap: number;
	/**
	 * How much the dots halfway between them show, from 0 to 1: they are gone
	 * where the dots are 40 screen pixels apart and whole where they are 80
	 * apart, which is where they become dots that always show.
	 */
	readonly between: number;
}

/**
 * The dots at a zoom. They stand on a grid of 40 flow pixels times a power of
 * two, chosen so that two neighbors are never nearer than 40 screen pixels
 * and never farther than 80. As the canvas zooms, the dots halfway between
 * fade in or out, so that no dot appears or goes at once: at the zoom where
 * the grid changes its step, both steps draw the same dots.
 */
export function baseHalfCanvasDotGrid(zoom: number): IBaseHalfCanvasDotGrid {
	const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
	// The smallest power of two that puts the step at 40 screen pixels or more. A
	// hair of tolerance keeps a zoom of exactly a power of two on its own step.
	const power = Math.ceil(Math.log2(1 / scale) - 1e-9);
	const gap = BASEHALF_CANVAS_BACKGROUND_GAP * Math.pow(2, power);
	const between = (gap * scale - BASEHALF_CANVAS_BACKGROUND_GAP) / BASEHALF_CANVAS_BACKGROUND_GAP;
	return { gap, between: Math.min(1, Math.max(0, between)) };
}

/** A dot of the background, in pixels of the screen's own grid. */
export interface IBaseHalfCanvasDot {
	/** The left and the top edge of the dot, whole pixels. */
	readonly x: number;
	readonly y: number;
	/** It always shows; one that does not shows as much as the grid's `between` says. */
	readonly whole: boolean;
}

/**
 * The dots that show in a view of `width` by `height` screen pixels whose
 * viewport stands at `x`, `y`, `zoom`, each on whole pixels of a screen with
 * `ratio` pixels to a screen pixel: a dot is at most half a pixel from its
 * place on the canvas, and every dot looks the same. `size` is how many of
 * those pixels a dot is across.
 */
export function baseHalfCanvasDots(viewport: { readonly x: number; readonly y: number; readonly zoom: number }, width: number, height: number, ratio: number, size: number): readonly IBaseHalfCanvasDot[] {
	const grid = baseHalfCanvasDotGrid(viewport.zoom);
	const scale = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
	// The dots between stand on half the step; where none shows, the whole step is the grid.
	const steps = grid.between > 0 ? 2 : 1;
	const step = grid.gap / steps * scale;
	const dots: IBaseHalfCanvasDot[] = [];
	const firstColumn = Math.ceil((-size / ratio - viewport.x) / step);
	const firstRow = Math.ceil((-size / ratio - viewport.y) / step);
	for (let row = firstRow; row * step + viewport.y < height + size / ratio; row++) {
		const y = Math.round((row * step + viewport.y) * ratio - size / 2);
		for (let column = firstColumn; column * step + viewport.x < width + size / ratio; column++) {
			dots.push({
				x: Math.round((column * step + viewport.x) * ratio - size / 2),
				y,
				whole: row % steps === 0 && column % steps === 0
			});
		}
	}
	return dots;
}
