/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BaseHalfCanvasKeyboardPlace } from './basehalfCanvasKeys.js';

// Where the keyboard returns when what had it goes away (docs/specs/keyboard-return.md): the keyboard is
// always somewhere that answers. This module holds the rules and names no element: the canvas view reads
// where the keyboard is from the page and hands it over as facts.

/**
 * Where the keyboard is when the rule is asked:
 * - `page`: on the page itself, where the browser puts it when the element that had it is taken away;
 * - `emptyGroup`: on the empty editor group that lies under the canvas, where the base puts it when it
 *   gives the keyboard to its editor area;
 * - `elsewhere`: on anything else, which keeps it.
 */
export type BaseHalfKeyboardNowhere = 'page' | 'emptyGroup' | 'elsewhere';

/** What the canvas view reads when the keyboard has nowhere to be. */
export interface IBaseHalfKeyboardReturnFacts {
	readonly keyboardOn: BaseHalfKeyboardNowhere;
	/** A dialog is open: nothing under it takes the keyboard. */
	readonly dialogOpen: boolean;
	/** An overlay is open over the window: BaseHalf's Settings, the advanced list, Keyboard Shortcuts, a document. */
	readonly overlayOpen: boolean;
	/** The keyboard left a part of the window that keeps it while it has something to take it, as the Agent Area does. */
	readonly leftPart: boolean;
	/** An editor of the base is shown over the canvas, such as the multi-file diff. */
	readonly editorOverCanvas: boolean;
	readonly cardDetailOpen: boolean;
	/** The canvas remembers a card, and the canvas that is shown holds that card. */
	readonly homeCardShown: boolean;
}

/**
 * What takes the keyboard:
 * - `nothing`: what has it keeps it;
 * - `overlay`: the content of the overlay that is open;
 * - `part`: the part of the window the keyboard left;
 * - `editor`: the editor of the base that is shown over the canvas;
 * - `cardDetail`: what Card Detail shows;
 * - `card`: the card that last had the keyboard on this canvas;
 * - `canvas`: the canvas itself.
 */
export type BaseHalfKeyboardTaker = 'nothing' | 'overlay' | 'part' | 'editor' | 'cardDetail' | 'card' | 'canvas';

/** What takes the keyboard that is on the page itself or on the empty editor group: the first that is there. */
export function baseHalfKeyboardReturnsTo(facts: IBaseHalfKeyboardReturnFacts): BaseHalfKeyboardTaker {
	if (facts.keyboardOn === 'elsewhere' || facts.dialogOpen) {
		return 'nothing';
	}
	// The base gives the keyboard to its editor area as an overlay closes, a moment before the overlay is
	// gone: on the empty group, the overlay is not what takes it.
	if (facts.overlayOpen && facts.keyboardOn === 'page') {
		return 'overlay';
	}
	if (facts.leftPart && facts.keyboardOn === 'page') {
		return 'part';
	}
	if (facts.editorOverCanvas) {
		// On the empty group there is no editor to take it; the group keeps what the base gave it.
		return facts.keyboardOn === 'page' ? 'editor' : 'nothing';
	}
	if (facts.cardDetailOpen) {
		return 'cardDetail';
	}
	return facts.homeCardShown ? 'card' : 'canvas';
}

/**
 * The place the canvas remembers once the keyboard is at `keyboardOn`: the card `card` when the keyboard
 * is on that card, in anything of it, or on the frame the canvas library draws around it; the canvas
 * itself (`undefined`) on the blank canvas; and what it was, `home`, anywhere else: in a toolbar, a menu,
 * a button or a field of the canvas, on a connection, under Card Detail, and outside the canvas.
 * `card` names the card the keyboard is on or in, however the caller names cards.
 */
export function baseHalfCanvasKeyboardPlaceAfter(home: string | undefined, keyboardOn: BaseHalfCanvasKeyboardPlace | '', card: string | undefined): string | undefined {
	if (keyboardOn === 'canvas') {
		return undefined;
	}
	if (keyboardOn === '' || keyboardOn === 'frame' || keyboardOn === 'toolbar' || keyboardOn === 'connection') {
		return home;
	}
	return card ?? home;
}

const KEYS_THAT_MOVE_THE_KEYBOARD: ReadonlySet<string> = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/**
 * Whether a key press does nothing on the canvas because the key is held from before the keyboard came to
 * this element: a repeat of a key that went down on another element, or that this window never saw go
 * down. Enter held to accept a name does not open the card, and Escape held to close an overlay does not
 * end the selection. Tab and the arrow keys move the keyboard themselves and are never held back.
 */
export function baseHalfCanvasHoldsBackRepeat(press: { readonly repeat: boolean; readonly key: string; readonly wentDownHere: boolean }): boolean {
	return press.repeat && !press.wentDownHere && !KEYS_THAT_MOVE_THE_KEYBOARD.has(press.key);
}
