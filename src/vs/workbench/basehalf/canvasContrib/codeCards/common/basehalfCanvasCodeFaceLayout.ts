/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IChange } from '../../../../../editor/common/diff/legacyLinesDiffComputer.js';

/** A line of a face: the same in the card's editor, so that nothing moves when it comes. */
export const BASEHALF_CODE_FACE_LINE_HEIGHT = 18;
export const BASEHALF_CODE_FACE_FONT_SIZE = 12;
export const BASEHALF_CODE_FACE_TOP_PADDING = 8;
export const BASEHALF_CODE_FACE_BOTTOM_PADDING = 12;
/** The room between the edge of the card and the numbers, which the editor has not of itself. */
export const BASEHALF_CODE_FACE_GUTTER_START = 6;
/** The lane of the marks between the numbers and the text. */
export const BASEHALF_CODE_FACE_MARK_LANE = 12;
/** A line that long is a minified file: what is past it is far beyond any card's edge. */
export const BASEHALF_CODE_FACE_LINE_LENGTH_LIMIT = 400;
/** Above this the whole file is not read for a card: its head is what it shows (code cards, rule 5). */
export const BASEHALF_CODE_CARD_LARGEST_FILE_BYTES = 5 * 1024 * 1024;
/** Below this zoom a line can no longer be read, and a gesture on a face moves the canvas (code cards, rule 7). */
export const BASEHALF_CODE_FACE_LOWEST_SCROLLING_ZOOM = 0.5;

/** Lines drawn beyond each edge of the view of a face that is scrolling, so that a fast scroll finds them drawn. */
export const BASEHALF_CODE_FACE_LINES_AROUND_A_SCROLL = 6;

export interface IBaseHalfCodeFaceLines {
	readonly first: number;
	readonly last: number;
}

/** The lines to draw, from 1, for a view of `height` at `scrollTop` and `around` lines beyond it; none in a file without lines. */
export function baseHalfCodeFaceLinesInView(scrollTop: number, height: number, lineCount: number, around = 0): IBaseHalfCodeFaceLines {
	const first = Math.floor((scrollTop - BASEHALF_CODE_FACE_TOP_PADDING) / BASEHALF_CODE_FACE_LINE_HEIGHT) + 1 - around;
	const last = Math.ceil((scrollTop + height - BASEHALF_CODE_FACE_TOP_PADDING) / BASEHALF_CODE_FACE_LINE_HEIGHT) + around;
	return { first: Math.max(1, first), last: Math.min(lineCount, last) };
}

/** Where a line's box begins in the scrolled content. */
export function baseHalfCodeFaceTopOfLine(line: number): number {
	return BASEHALF_CODE_FACE_TOP_PADDING + (line - 1) * BASEHALF_CODE_FACE_LINE_HEIGHT;
}

/** What the content scrolls to for a line at the top of the view. The first line keeps the room above it. */
export function baseHalfCodeFaceScrollTopOfLine(line: number): number {
	return line <= 1 ? 0 : baseHalfCodeFaceTopOfLine(line);
}

/** The line at the top of the view at `scrollTop`. */
export function baseHalfCodeFaceLineAt(scrollTop: number): number {
	return scrollTop <= BASEHALF_CODE_FACE_TOP_PADDING ? 1 : Math.floor((scrollTop - BASEHALF_CODE_FACE_TOP_PADDING) / BASEHALF_CODE_FACE_LINE_HEIGHT) + 1;
}

export function baseHalfCodeFaceContentHeight(lineCount: number): number {
	return BASEHALF_CODE_FACE_TOP_PADDING + lineCount * BASEHALF_CODE_FACE_LINE_HEIGHT + BASEHALF_CODE_FACE_BOTTOM_PADDING;
}

/** The digits of a gutter, as the editor counts them with at least 3 (code cards, rule 2). */
export function baseHalfCodeFaceDigits(lineCount: number): number {
	return Math.max(3, String(Math.max(1, lineCount)).length);
}

/**
 * How many lines a file has, from the head that was read of it: exact for a whole file,
 * near enough for the width of a gutter otherwise, and right once its model is there.
 */
export function baseHalfCodeFaceEstimatedLines(headLines: number, headLength: number, wholeFile: boolean, size: number | undefined): number {
	if (wholeFile || !size || headLength <= 0) {
		return headLines;
	}
	return Math.max(headLines, Math.round(size / (headLength / Math.max(1, headLines))));
}

export type BaseHalfCodeFaceMarkKind = 'added' | 'modified' | 'deleted';

/** A change in the ruler: its lines of the file, the last included. */
export interface IBaseHalfCodeFaceTick {
	readonly kind: BaseHalfCodeFaceMarkKind;
	readonly first: number;
	readonly last: number;
}

/** What a face marks of a file's changes (code cards, rules 10 and 11). */
export interface IBaseHalfCodeFaceMarks {
	/** Added and modified lines. */
	readonly lines: ReadonlyMap<number, 'added' | 'modified'>;
	/** The lines after which lines were taken out; 0 before the first line. */
	readonly deletedAfter: ReadonlySet<number>;
	readonly ticks: readonly IBaseHalfCodeFaceTick[];
}

export const BASEHALF_CODE_FACE_NO_MARKS: IBaseHalfCodeFaceMarks = { lines: new Map(), deletedAfter: new Set(), ticks: [] };

/** Reads VS Code's quick diff as its gutter does: no lines on the original side are added, none on the file's side are deleted. */
export function baseHalfCodeFaceMarks(changes: readonly IChange[]): IBaseHalfCodeFaceMarks {
	const lines = new Map<number, 'added' | 'modified'>();
	const deletedAfter = new Set<number>();
	const ticks: IBaseHalfCodeFaceTick[] = [];
	for (const change of changes) {
		if (change.modifiedEndLineNumber === 0) {
			deletedAfter.add(change.modifiedStartLineNumber);
			const line = Math.max(1, change.modifiedStartLineNumber);
			ticks.push({ kind: 'deleted', first: line, last: line });
			continue;
		}
		const kind = change.originalEndLineNumber === 0 ? 'added' : 'modified';
		for (let line = change.modifiedStartLineNumber; line <= change.modifiedEndLineNumber; line++) {
			lines.set(line, kind);
		}
		ticks.push({ kind, first: change.modifiedStartLineNumber, last: change.modifiedEndLineNumber });
	}
	return { lines, deletedAfter, ticks };
}

/** Where a change stands in a ruler, in shares of its height. A short change keeps a height that can be seen. */
export function baseHalfCodeFaceTickBox(tick: IBaseHalfCodeFaceTick, lineCount: number): { readonly top: number; readonly height: number } {
	const lines = Math.max(1, lineCount);
	return { top: (tick.first - 1) / lines, height: (tick.last - tick.first + 1) / lines };
}
