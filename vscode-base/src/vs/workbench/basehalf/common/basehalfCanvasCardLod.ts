/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type BaseHalfCanvasCardLod = 'full' | 'summary' | 'mini';

export const BASEHALF_CANVAS_CARD_FULL_MIN_HEIGHT = 150;
export const BASEHALF_CANVAS_CARD_MINI_MAX_HEIGHT = 96;
export const BASEHALF_CANVAS_CARD_FULL_MIN_ZOOM = 0.85;
export const BASEHALF_CANVAS_CARD_SUMMARY_MIN_ZOOM = 0.55;

/**
 * Keep canvas cards legible as the viewport pulls back. Full previews are useful
 * only while their smallest text remains readable; the summary tier preserves
 * identity and one meaningful line before the card collapses to a name chip.
 */
export function baseHalfCanvasCardLod(height: number, zoom: number): BaseHalfCanvasCardLod {
	if (height < BASEHALF_CANVAS_CARD_MINI_MAX_HEIGHT || zoom < BASEHALF_CANVAS_CARD_SUMMARY_MIN_ZOOM) {
		return 'mini';
	}
	if (height < BASEHALF_CANVAS_CARD_FULL_MIN_HEIGHT || zoom < BASEHALF_CANVAS_CARD_FULL_MIN_ZOOM) {
		return 'summary';
	}
	return 'full';
}
