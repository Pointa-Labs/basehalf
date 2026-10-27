/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports nothing.

/** The narrowest left margin that shows the outline: its strip, 2 to 26 pixels from the edge (zoom and outline of a note, rule 11). */
export const BASEHALF_NOTE_OUTLINE_MIN_MARGIN = 26;
/**
 * The room the Rich projection keeps left of its text, so that the outline's
 * strip of 28 pixels and the editor's handles of a block, in the 57 pixels
 * next to the text, never lie on each other (rule 21).
 */
export const BASEHALF_NOTE_OUTLINE_MIN_MARGIN_WITH_HANDLES = 85;
/** Where the right ends of the ticks stand, from the left edge of the view (rule 12). */
export const BASEHALF_NOTE_OUTLINE_TICK_END = 22;
/** Where the column of ticks, which the pointer finds them by, begins, from the left edge of the view. */
export const BASEHALF_NOTE_OUTLINE_COLUMN_LEFT = 2;
export const BASEHALF_NOTE_OUTLINE_TICK_HEIGHT = 2;
const TICK_PITCH = 14;
const TICK_MIN_PITCH = 4;
/** The room the column of ticks leaves above and below it (rule 12). */
const COLUMN_INSET = 16;

export const BASEHALF_NOTE_OUTLINE_PANEL_LEFT = 8;
/** How long the pointer rests on the ticks before the panel opens, so that one passing to the text opens nothing (rule 14). */
export const BASEHALF_NOTE_OUTLINE_OPEN_DELAY_MS = 150;
export const BASEHALF_NOTE_OUTLINE_PANEL_WIDTH = 240;
/** How far the panel's top stands above the first tick (rule 15). */
const PANEL_ABOVE = 10;
/** The room the panel keeps from the top and the bottom of the view. */
const PANEL_INSET = 8;
export const BASEHALF_NOTE_OUTLINE_ROW_HEIGHT = 25;
export const BASEHALF_NOTE_OUTLINE_INDENT = 12;
/** The panel's padding and border, above and below its rows together. */
const PANEL_FRAME = 14;
const PANEL_HEIGHT_SHARE = 0.7;
/** Where a click on a name puts its heading, from the top of the view (rule 17). */
export const BASEHALF_NOTE_OUTLINE_SCROLL_GAP = 24;

/** The length of the tick of a heading of `level` in a note whose highest level is `highest` (rule 12). */
export function baseHalfNoteOutlineTickLength(level: number, highest: number): number {
	const depth = level - highest;
	return depth <= 0 ? 16 : depth === 1 ? 12 : 8;
}

/** How far the name of a heading of `level` is indented in the panel (rule 15). */
export function baseHalfNoteOutlineIndent(level: number, highest: number): number {
	return Math.max(0, level - highest) * BASEHALF_NOTE_OUTLINE_INDENT;
}

export interface IBaseHalfNoteOutlineColumn {
	/** The distance between the tops of two ticks. */
	readonly pitch: number;
	/** The top of the first tick shown, from the top of the view. */
	readonly top: number;
	/** The first and the last heading whose ticks are shown. */
	readonly first: number;
	readonly last: number;
}

/**
 * Where the ticks of `count` headings stand in a view of `height`: 14 pixels
 * apart in the middle of the view, closer when they do not fit, down to 4
 * pixels apart, and beyond that the ticks around the current heading
 * (rule 12).
 */
export function baseHalfNoteOutlineColumn(count: number, height: number, current: number): IBaseHalfNoteOutlineColumn {
	if (count <= 0) {
		return { pitch: TICK_PITCH, top: 0, first: 0, last: -1 };
	}
	const room = Math.max(BASEHALF_NOTE_OUTLINE_TICK_HEIGHT, height - 2 * COLUMN_INSET);
	const span = (shown: number, pitch: number) => (shown - 1) * pitch + BASEHALF_NOTE_OUTLINE_TICK_HEIGHT;
	const middle = (shown: number, pitch: number) => Math.round((height - span(shown, pitch)) / 2);
	if (count === 1 || span(count, TICK_PITCH) <= room) {
		return { pitch: TICK_PITCH, top: middle(count, TICK_PITCH), first: 0, last: count - 1 };
	}
	const pitch = (room - BASEHALF_NOTE_OUTLINE_TICK_HEIGHT) / (count - 1);
	if (pitch >= TICK_MIN_PITCH) {
		return { pitch, top: middle(count, pitch), first: 0, last: count - 1 };
	}
	const shown = Math.max(1, Math.floor((room - BASEHALF_NOTE_OUTLINE_TICK_HEIGHT) / TICK_MIN_PITCH) + 1);
	const first = Math.min(Math.max(0, (current < 0 ? 0 : current) - Math.floor(shown / 2)), count - shown);
	return { pitch: TICK_MIN_PITCH, top: middle(shown, TICK_MIN_PITCH), first, last: first + shown - 1 };
}

/** The line a heading passes to become the current one: where a click on its name puts it, and a line more (rule 16). */
const CURRENT_LINE = BASEHALF_NOTE_OUTLINE_SCROLL_GAP + 40;

/**
 * The current heading, from the tops of the headings measured from the top of
 * a view of `height`: the last one above the line 64 pixels below the top of
 * the view; before the first one reaches it, the first one if it is in view;
 * and at the end of the note the last one in view (rule 16). -1 for none.
 */
export function baseHalfNoteOutlineCurrent(tops: readonly number[], height: number, atEnd: boolean): number {
	if (tops.length === 0) {
		return -1;
	}
	if (atEnd) {
		let last = -1;
		for (let index = 0; index < tops.length; index++) {
			if (tops[index] >= 0 && tops[index] < height) {
				last = index;
			}
		}
		if (last >= 0) {
			return last;
		}
	}
	const line = Math.min(CURRENT_LINE, height / 3);
	let current = -1;
	for (let index = 0; index < tops.length && tops[index] <= line; index++) {
		current = index;
	}
	if (current >= 0) {
		return current;
	}
	return tops[0] < height ? 0 : -1;
}

/** The height of the panel of `rows` names in a view of `height`: all of them, at most 70% of the view (rule 15). */
export function baseHalfNoteOutlinePanelHeight(rows: number, height: number): number {
	return Math.min(rows * BASEHALF_NOTE_OUTLINE_ROW_HEIGHT + PANEL_FRAME, Math.floor(height * PANEL_HEIGHT_SHARE));
}

/** The top of the panel: 10 pixels above the first tick, and inside the view (rule 15). */
export function baseHalfNoteOutlinePanelTop(firstTickTop: number, panelHeight: number, height: number): number {
	const top = firstTickTop - PANEL_ABOVE;
	return Math.max(PANEL_INSET, Math.min(top, height - PANEL_INSET - panelHeight));
}
