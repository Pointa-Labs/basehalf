/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports nothing.

/** A box as a page measures it, from the top of its window. */
export interface IBaseHalfNotePlaceBox {
	readonly top: number;
	readonly height: number;
}

/**
 * The place of a view of a note: the block at the top of the view, and where
 * in the view it stands.
 */
export interface IBaseHalfNotePlace {
	/** The index of the block among the note's blocks. */
	readonly block: number;
	/**
	 * A block that begins in the view is as far below the top of the view as
	 * `distance` says, in pixels. A block that began above it has the part
	 * `through` of its height above the top of the view, from 0 to 1.
	 */
	readonly distance?: number;
	readonly through?: number;
}

/**
 * The place of a view whose top is at `viewTop`, among the boxes of the
 * note's blocks in their order: the first block that reaches below the top
 * of the view. None when the note has no block there.
 */
export function baseHalfNotePlace(viewTop: number, blocks: readonly IBaseHalfNotePlaceBox[]): IBaseHalfNotePlace | undefined {
	for (let index = 0; index < blocks.length; index++) {
		const box = blocks[index];
		if (box.height <= 0 || box.top + box.height <= viewTop + 1) {
			continue;
		}
		return box.top >= viewTop
			? { block: index, distance: box.top - viewTop }
			: { block: index, through: (viewTop - box.top) / box.height };
	}
	return undefined;
}

/**
 * How far the view has to scroll down, in pixels, for its block to stand at
 * its place again, now that the block has the box `box`: a block that begins
 * in the view keeps its distance from the top, and one that began above it
 * keeps the same part of itself above the top, so the line that was read at
 * the top of the view is still there when the size of the text changed.
 */
export function baseHalfNotePlaceScroll(place: IBaseHalfNotePlace, viewTop: number, box: IBaseHalfNotePlaceBox): number {
	return place.through !== undefined
		? box.top + place.through * box.height - viewTop
		: box.top - (place.distance ?? 0) - viewTop;
}

/**
 * Notes the place of a view of a note before the note is laid out anew, as
 * for another size of its text, and returns what puts the view back at that
 * place (note rendering, rule 40). `view` scrolls the note, and `blocks` are
 * the note's blocks in their order. Nothing is noted for a view that is not
 * drawn.
 */
export function keepBaseHalfNotePlace(view: HTMLElement, blocks: () => ArrayLike<Element>): () => void {
	if (view.clientHeight <= 0) {
		return () => undefined;
	}
	const viewTop = (): number => view.getBoundingClientRect().top + view.clientTop;
	const before = blocks();
	const place = baseHalfNotePlace(viewTop(), Array.from(before, block => block.getBoundingClientRect()));
	const block = place && before[place.block];
	return () => {
		if (!place || !block?.isConnected) {
			return;
		}
		const scroll = baseHalfNotePlaceScroll(place, viewTop(), block.getBoundingClientRect());
		if (Math.abs(scroll) >= 0.5) {
			view.scrollTop += scroll;
		}
	};
}
