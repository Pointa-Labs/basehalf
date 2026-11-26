/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';

/**
 * What a click on a card does while a generation card picks its inputs
 * (generation cards, "Pick on Canvas"; D69): connect it, remove its
 * connection, nothing because it cannot be an input, or nothing because it
 * is the card that picks.
 */
export type BaseHalfCanvasCardPickAction = 'connect' | 'remove' | 'refused' | 'self';

export interface IBaseHalfCanvasCardPickCard {
	readonly action: BaseHalfCanvasCardPickAction;
	/** What the label beside the pointer says over the card; none for the card that picks. */
	readonly label?: string;
}

/** A pick that a generation card's panel runs on the canvas. */
export interface IBaseHalfCanvasCardPick {
	/** What the bar at the top of the canvas says. */
	readonly title: string;
	/** What a click on the card at `path` does; `folder` says that it is a folder. */
	cardOf(path: string, folder: boolean): IBaseHalfCanvasCardPickCard;
	/** A click on a card that a click connects or removes. */
	pick(path: string): void;
	/** Escape or Done ended picking. */
	ended(): void;
	/** Fires when what a click does changed for some card, as after a card was connected. */
	readonly onDidChange: Event<void>;
}
