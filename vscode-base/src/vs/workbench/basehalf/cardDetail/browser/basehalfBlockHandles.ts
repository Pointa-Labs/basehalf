/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports nothing.

/** The room between the handles of a block and the text column (zoom and outline of a note, rule 22). */
export const BASEHALF_BLOCK_HANDLES_GAP = 8;

/** What the handles of a block stand by, on the page as it is drawn now. */
export interface IBaseHalfBlockHandlesAnchor {
	/** The block's box from the left edge of the text column: the handles stand left of it, at its top. */
	readonly box: DOMRect;
	/** How much larger the page is drawn than laid out: the level, or the scale of a frame that only draws the page. */
	readonly scale: number;
}

/**
 * Measures what the handles of a block stand by in this frame: the left edge
 * of the text column and the top of the block, on the page as it is drawn,
 * laid out at a level or only drawn at it (rules 22 and 23).
 */
export function measureBaseHalfBlockHandles(column: HTMLElement, block: HTMLElement): IBaseHalfBlockHandlesAnchor {
	const columnBox = column.getBoundingClientRect();
	const blockBox = block.getBoundingClientRect();
	return {
		box: new DOMRect(columnBox.left, blockBox.top, blockBox.width, blockBox.height),
		scale: column.offsetWidth > 0 ? columnBox.width / column.offsetWidth : 1,
	};
}

/**
 * How far below the block's top the handles stand, so that their middle is
 * the middle of the block's first line as the page draws it: the editor makes
 * them as high as that line is at 100% (rule 22).
 */
export function baseHalfBlockHandlesDrop(handlesHeight: number, scale: number): number {
	return handlesHeight * (scale - 1) / 2;
}

/**
 * Where the pointer stands that the handles of a block pass with when the page
 * moves under it, after a move, a press, or a release of a button: nowhere
 * while a button is held, since the page then moves under a drag (rule 24).
 */
export function baseHalfBlockHandlesPointer(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'buttons'>): { readonly x: number; readonly y: number } | undefined {
	return event.buttons === 0 ? { x: event.clientX, y: event.clientY } : undefined;
}
