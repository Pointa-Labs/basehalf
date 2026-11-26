/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The size of the Agent Area's text is the terminal's font size, `terminal.integrated.fontSize`, in the base's range
// (each part zooms by itself, rules 9 and 10).

export const BASEHALF_AGENT_AREA_TEXT_SIZE_MIN = 6;
export const BASEHALF_AGENT_AREA_TEXT_SIZE_MAX = 100;

/** A size of the text within the range: a value that is no number is the default. */
export function baseHalfAgentAreaTextSize(value: unknown, defaultSize: number): number {
	const size = typeof value === 'number' && Number.isFinite(value) ? value : defaultSize;
	return Math.min(BASEHALF_AGENT_AREA_TEXT_SIZE_MAX, Math.max(BASEHALF_AGENT_AREA_TEXT_SIZE_MIN, size));
}

/** The size one press of Larger or Smaller Agent Area Text gives: one pixel from the size in effect, within the range. */
export function baseHalfAgentAreaTextSizeStep(value: unknown, defaultSize: number, direction: 1 | -1): number {
	return baseHalfAgentAreaTextSize(baseHalfAgentAreaTextSize(value, defaultSize) + direction, defaultSize);
}
