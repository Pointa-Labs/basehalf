/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';

/**
 * A wheel gesture ends when no wheel event has arrived for this long (canvas
 * wheel gestures). The canvas treats a wheel pan as ended after the same time.
 */
export const BASEHALF_CANVAS_WHEEL_GESTURE_QUIET_MS = 150;

/**
 * A timer that fires later than this was held up by a busy window, and wheel
 * events that arrived in that time have not been handled yet.
 */
export const BASEHALF_CANVAS_WHEEL_BUSY_TOLERANCE_MS = 16;

/**
 * How long the wheel events that waited for a busy window are given to come
 * in. They are handled at the start of a later frame, 8 to 18 ms after the
 * window is free again (measured), and a timer that ran out meanwhile fires
 * before them.
 */
export const BASEHALF_CANVAS_WHEEL_BUSY_GRACE_MS = 50;

/**
 * A gesture on scrollable content shows its direction once it has asked for
 * this much movement, in screen pixels. One event of a trackpad can ask for a
 * single pixel either way.
 */
export const BASEHALF_CANVAS_WHEEL_DIRECTION_DISTANCE = 4;

/**
 * The class of a sideways box: an element inside the scrollable content of a
 * card that holds more than it shows from left to right, and that the canvas
 * scrolls sideways for the user.
 */
export const BASEHALF_CANVAS_SIDEWAYS_BOX_CLASS = 'basehalf-canvas-scroll-sideways';

/** The pixels one wheel event asks for. */
export interface IBaseHalfCanvasWheelDelta {
	readonly deltaX: number;
	readonly deltaY: number;
}

/** What the first event of a gesture is delivered to. */
export interface IBaseHalfCanvasWheelStart {
	/** It is on a surface that handles the wheel by itself. */
	readonly ownScroll: boolean;
	/** The card whose content it is on. */
	readonly card: string | undefined;
	readonly buttonHeld: boolean;
}

/** Where scrollable content is: `position` runs from 0 to `max`. */
export interface IBaseHalfCanvasWheelExtent {
	readonly position: number;
	readonly max: number;
}

/**
 * What to do with one wheel event.
 * - `leave`: it is not a scroll of the canvas or of a card. Leave it alone.
 * - `hold`: take it and move nothing.
 * - `scroll`: take it and scroll the content of `card` by `deltaY`.
 * - `scrollSideways`: take it and scroll the sideways box that the gesture
 *   began on, in the content of `card`, by `deltaX`.
 * - `pan`: the canvas moves by the deltas. With `held`, earlier events of the
 *   gesture were taken and their movement is in the deltas, so this event is
 *   taken too and the canvas is given the sum.
 */
export type BaseHalfCanvasWheelStep =
	| { readonly kind: 'leave' }
	| { readonly kind: 'hold' }
	| { readonly kind: 'scroll'; readonly card: string; readonly deltaY: number }
	| { readonly kind: 'scrollSideways'; readonly card: string; readonly deltaX: number }
	| { readonly kind: 'pan'; readonly deltaX: number; readonly deltaY: number; readonly held: boolean };

type BaseHalfCanvasWheelGesture =
	| { readonly owner: 'canvas' }
	| { readonly owner: 'surface' }
	| { readonly owner: 'content'; readonly card: string }
	| { readonly owner: 'sidewaysBox'; readonly card: string }
	// The direction is not known yet. `events` of it were taken so far.
	| { readonly owner: 'undecided'; readonly card: string; deltaX: number; deltaY: number; events: number };

/**
 * Whether content can move the way a wheel gesture asks: the movement is more
 * vertical than horizontal, and the content is not already at that end.
 * Positions are compared with one pixel of tolerance, because a scroll
 * position is rounded.
 */
export function baseHalfCanvasWheelMovesContent(delta: IBaseHalfCanvasWheelDelta, extent: IBaseHalfCanvasWheelExtent): boolean {
	if (Math.abs(delta.deltaY) <= Math.abs(delta.deltaX)) {
		return false;
	}
	return delta.deltaY > 0
		? extent.max - extent.position >= 1
		: extent.position >= 1;
}

/**
 * Whether a sideways box can move the way a wheel gesture asks: the movement
 * is more horizontal than vertical, and the box is not already at that end.
 */
export function baseHalfCanvasWheelMovesSidewaysBox(delta: IBaseHalfCanvasWheelDelta, extent: IBaseHalfCanvasWheelExtent): boolean {
	if (Math.abs(delta.deltaX) <= Math.abs(delta.deltaY)) {
		return false;
	}
	return delta.deltaX > 0
		? extent.max - extent.position >= 1
		: extent.position >= 1;
}

/** The position of content after a wheel event moved it by `distance`. */
export function baseHalfCanvasWheelContentPosition(extent: IBaseHalfCanvasWheelExtent, distance: number): number {
	return Math.min(Math.max(0, extent.max), Math.max(0, extent.position + distance));
}

/** The clock and the timers of a window. */
export interface IBaseHalfCanvasWheelClock<TTimer> {
	now(): number;
	setTimeout(handler: () => void, ms: number): TTimer;
	clearTimeout(timer: TTimer): void;
}

/**
 * Calls back when the quiet time of a wheel gesture has passed, unless it is
 * disposed first. A busy window must not end a gesture: a timer that fires
 * late says that the window was busy, so the wheel events that waited get the
 * grace time to come in. Only a timer that fires on time ends the gesture.
 */
export function baseHalfCanvasWheelAfterQuietTime<TTimer>(clock: IBaseHalfCanvasWheelClock<TTimer>, callback: () => void): IDisposable {
	let timer: TTimer;
	const wait = (ms: number): void => {
		const due = clock.now() + ms;
		timer = clock.setTimeout(() => {
			if (clock.now() - due > BASEHALF_CANVAS_WHEEL_BUSY_TOLERANCE_MS) {
				wait(BASEHALF_CANVAS_WHEEL_BUSY_GRACE_MS);
			} else {
				callback();
			}
		}, ms);
	};
	wait(BASEHALF_CANVAS_WHEEL_GESTURE_QUIET_MS);
	return toDisposable(() => clock.clearTimeout(timer));
}

/**
 * Decides what every wheel event over the canvas moves (canvas wheel
 * gestures). A gesture belongs to what the pointer was on when it began, and
 * it keeps that owner until `end` reports that the quiet time has passed.
 */
export class BaseHalfCanvasWheelGestures {

	private gesture: BaseHalfCanvasWheelGesture | undefined;

	/**
	 * `start` is asked only at the first event of a gesture. `extent` gives
	 * the scrollable content that a card shows now, if it shows any, from top
	 * to bottom. `sidewaysExtent` gives, from left to right, the sideways box
	 * of that content that the gesture began on, if it began on one.
	 */
	step(
		event: IBaseHalfCanvasWheelDelta,
		start: () => IBaseHalfCanvasWheelStart,
		extent: (card: string) => IBaseHalfCanvasWheelExtent | undefined,
		sidewaysExtent: (card: string) => IBaseHalfCanvasWheelExtent | undefined
	): BaseHalfCanvasWheelStep {
		if (!this.gesture) {
			// An event that asks for no movement never starts a gesture.
			if (event.deltaX === 0 && event.deltaY === 0) {
				return { kind: 'leave' };
			}
			this.gesture = this.begin(start(), extent, sidewaysExtent);
		}
		const gesture = this.gesture;
		if (gesture.owner === 'surface') {
			return { kind: 'leave' };
		}
		if (gesture.owner === 'canvas') {
			return { kind: 'pan', deltaX: event.deltaX, deltaY: event.deltaY, held: false };
		}
		if (gesture.owner === 'content') {
			return extent(gesture.card) ? { kind: 'scroll', card: gesture.card, deltaY: event.deltaY } : { kind: 'hold' };
		}
		if (gesture.owner === 'sidewaysBox') {
			return sidewaysExtent(gesture.card) ? { kind: 'scrollSideways', card: gesture.card, deltaX: event.deltaX } : { kind: 'hold' };
		}

		gesture.deltaX += event.deltaX;
		gesture.deltaY += event.deltaY;
		if (Math.abs(gesture.deltaX) + Math.abs(gesture.deltaY) < BASEHALF_CANVAS_WHEEL_DIRECTION_DISTANCE) {
			gesture.events++;
			return { kind: 'hold' };
		}
		const content = extent(gesture.card);
		if (content && baseHalfCanvasWheelMovesContent(gesture, content)) {
			this.gesture = { owner: 'content', card: gesture.card };
			return { kind: 'scroll', card: gesture.card, deltaY: gesture.deltaY };
		}
		const box = sidewaysExtent(gesture.card);
		if (box && baseHalfCanvasWheelMovesSidewaysBox(gesture, box)) {
			this.gesture = { owner: 'sidewaysBox', card: gesture.card };
			return { kind: 'scrollSideways', card: gesture.card, deltaX: gesture.deltaX };
		}
		this.gesture = { owner: 'canvas' };
		return { kind: 'pan', deltaX: gesture.deltaX, deltaY: gesture.deltaY, held: gesture.events > 0 };
	}

	/** The quiet time has passed: the next event that asks for movement starts a gesture. */
	end(): void {
		this.gesture = undefined;
	}

	private begin(
		start: IBaseHalfCanvasWheelStart,
		extent: (card: string) => IBaseHalfCanvasWheelExtent | undefined,
		sidewaysExtent: (card: string) => IBaseHalfCanvasWheelExtent | undefined
	): BaseHalfCanvasWheelGesture {
		if (start.ownScroll) {
			return { owner: 'surface' };
		}
		if (start.card === undefined || start.buttonHeld) {
			return { owner: 'canvas' };
		}
		// Content that fits its box has nothing to scroll, and neither has a
		// sideways box that shows all it holds.
		const content = extent(start.card);
		const box = content ? sidewaysExtent(start.card) : undefined;
		if (!content || (content.max < 1 && !(box && box.max >= 1))) {
			return { owner: 'canvas' };
		}
		return { owner: 'undecided', card: start.card, deltaX: 0, deltaY: 0, events: 0 };
	}
}
