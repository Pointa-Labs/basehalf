/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfCanvasBounds, IBaseHalfCanvasPosition } from './basehalfCanvasModel.js';

/**
 * Names, on an element outside the canvas, the folder that cards dropped on
 * it go into, by its resource: a folder of the path in the title bar.
 */
export const BASEHALF_CANVAS_DROP_FOLDER_ATTRIBUTE = 'data-basehalf-drop-folder';
/** Marks the element of the folder that would take dragged cards or items now. */
export const BASEHALF_CANVAS_DROP_TARGET_ATTRIBUTE = 'data-basehalf-drop-target';
/** Marks the cards being dragged while a folder would take them. */
export const BASEHALF_CANVAS_DROPPING_ATTRIBUTE = 'data-basehalf-dropping';

/**
 * The folder that cards let go on go into (dropping into a folder): a
 * folder's card of the canvas, by its path, or a folder of the path in the
 * title bar, by its resource.
 */
export type BaseHalfCanvasDropFolder =
	| { readonly kind: 'card'; readonly path: string }
	| { readonly kind: 'path'; readonly resource: string };

/** A card of the scene as a drop sees it. */
export interface IBaseHalfCanvasDropCard extends IBaseHalfCanvasBounds {
	readonly path: string;
	readonly folder: boolean;
	/** A selected card is drawn over the others. */
	readonly selected: boolean;
}

/**
 * The path of the folder's card that takes dragged cards let go at `point`,
 * in canvas coordinates (dropping into a folder, "Which folder takes them"):
 * the card drawn on top there, leaving the dragged cards out, when it is a
 * folder's card. `cards` are in the order they are drawn: a later card is
 * drawn over an earlier one, and a selected card over the others.
 */
export function baseHalfCanvasFolderDropTarget(
	cards: readonly IBaseHalfCanvasDropCard[],
	dragged: ReadonlySet<string>,
	point: IBaseHalfCanvasPosition
): string | undefined {
	let top: IBaseHalfCanvasDropCard | undefined;
	for (const card of cards) {
		if (dragged.has(card.path)
			|| point.x < card.x || point.x > card.x + card.width
			|| point.y < card.y || point.y > card.y + card.height) {
			continue;
		}
		if (!top || !top.selected || card.selected) {
			top = card;
		}
	}
	return top?.folder ? top.path : undefined;
}

/**
 * The name an item takes when the folder it moves into holds its name, at
 * the `attempt`-th try from 0 (dropping into a folder, "A name the folder
 * holds"): it keeps both, with a number after its name, before the
 * extension. `plan.md` takes `plan 2.md`, then `plan 3.md`; the folder
 * `notes` takes `notes 2`. A name that ends in a number counts on from it:
 * `plan 2.md` takes `plan 3.md`.
 */
export function baseHalfCanvasKeptName(name: string, isFolder: boolean, attempt: number): string {
	const dot = isFolder ? -1 : name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : '';
	const numbered = /^(?<base>.*\S) (?<number>\d+)$/.exec(stem);
	const base = numbered?.groups ? numbered.groups.base : stem;
	const first = numbered?.groups ? Number(numbered.groups.number) + 1 : 2;
	return `${base} ${first + attempt}${extension}`;
}
