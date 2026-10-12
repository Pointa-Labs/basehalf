/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BASEHALF_CANVAS_WHEEL_BUSY_GRACE_MS,
	BASEHALF_CANVAS_WHEEL_GESTURE_QUIET_MS,
	BaseHalfCanvasWheelGestures,
	IBaseHalfCanvasWheelExtent,
	baseHalfCanvasWheelAfterQuietTime,
	baseHalfCanvasWheelContentPosition,
	baseHalfCanvasWheelMovesContent
} from '../../common/basehalfCanvasWheelGesture.js';

suite('BaseHalfCanvasWheelGesture', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	/** A note in the middle of its text. */
	const middle: IBaseHalfCanvasWheelExtent = { position: 500, max: 1000 };

	interface ITestWheel {
		/** The quiet time has passed since the event before this one. */
		readonly afterQuietTime?: boolean;
		/** What is under the pointer: a card's path, `editor` for a surface that takes the wheel, or the empty canvas. */
		readonly on?: string;
		readonly deltaX?: number;
		readonly deltaY?: number;
		readonly buttonHeld?: boolean;
	}

	/** Runs wheel events over cards whose notes are at `notes`, and says what each one moved. */
	function run(notes: Record<string, IBaseHalfCanvasWheelExtent | undefined>, events: readonly ITestWheel[]): string[] {
		const gestures = new BaseHalfCanvasWheelGestures();
		return events.map(event => {
			if (event.afterQuietTime) {
				gestures.end();
			}
			const step = gestures.step(
				{ deltaX: event.deltaX ?? 0, deltaY: event.deltaY ?? 0 },
				() => ({ ownScroll: event.on === 'editor', card: event.on === 'editor' ? undefined : event.on, buttonHeld: event.buttonHeld === true }),
				card => notes[card]
			);
			switch (step.kind) {
				case 'scroll': return `${step.card} ${step.deltaY}`;
				case 'pan': return `canvas ${step.deltaX},${step.deltaY}${step.held ? ' held' : ''}`;
				default: return step.kind;
			}
		});
	}

	test('a gesture belongs to what the pointer was on when it began, until the quiet time has passed', () => {
		assert.deepStrictEqual({
			noteGestureLeavesTheNote: run({ 'a.md': middle }, [{ on: 'a.md', deltaY: 30 }, { deltaY: 30 }, { on: 'editor', deltaY: 30 }]),
			canvasGestureReachesANote: run({ 'a.md': middle }, [{ deltaY: 30 }, { on: 'a.md', deltaY: 30 }, { on: 'editor', deltaY: 30 }]),
			surfaceGestureLeavesTheSurface: run({ 'a.md': middle }, [{ on: 'editor', deltaY: 30 }, { on: 'a.md', deltaY: 30 }]),
			// The pan ended with the note under the pointer: the next scroll begins on the note.
			aNewGestureOnTheNote: run({ 'a.md': middle }, [{ deltaY: 30 }, { on: 'a.md', deltaY: 30 }, { afterQuietTime: true, on: 'a.md', deltaY: 30 }]),
			aNewGestureOnTheCanvas: run({ 'a.md': middle }, [{ on: 'a.md', deltaY: 30 }, { afterQuietTime: true, deltaY: 30 }])
		}, {
			noteGestureLeavesTheNote: ['a.md 30', 'a.md 30', 'a.md 30'],
			canvasGestureReachesANote: ['canvas 0,30', 'canvas 0,30', 'canvas 0,30'],
			surfaceGestureLeavesTheSurface: ['leave', 'leave'],
			aNewGestureOnTheNote: ['canvas 0,30', 'canvas 0,30', 'a.md 30'],
			aNewGestureOnTheCanvas: ['a.md 30', 'canvas 0,30']
		});
	});

	test('a gesture on a note is held until it shows its direction', () => {
		assert.deepStrictEqual({
			// The first events of a trackpad ask for a pixel or two, sometimes sideways.
			downAfterASidewaysPixel: run({ 'a.md': middle }, [{ on: 'a.md', deltaX: 1 }, { deltaY: 1 }, { deltaY: 3 }, { deltaY: 8 }]),
			sidewaysAfterAPixelDown: run({ 'a.md': middle }, [{ on: 'a.md', deltaY: 1 }, { deltaX: 2 }, { deltaX: 6 }, { deltaX: 9, deltaY: 1 }]),
			tooSmallToTell: run({ 'a.md': middle }, [{ on: 'a.md', deltaY: 1 }, { deltaY: 1 }, { afterQuietTime: true, on: 'a.md', deltaY: 30 }]),
			oneNotchOfAMouseWheel: run({ 'a.md': middle }, [{ on: 'a.md', deltaY: -100 }]),
			evenly: run({ 'a.md': middle }, [{ on: 'a.md', deltaX: 30, deltaY: 30 }])
		}, {
			downAfterASidewaysPixel: ['hold', 'hold', 'a.md 4', 'a.md 8'],
			sidewaysAfterAPixelDown: ['hold', 'hold', 'canvas 8,1 held', 'canvas 9,1'],
			tooSmallToTell: ['hold', 'hold', 'a.md 30'],
			oneNotchOfAMouseWheel: ['a.md -100'],
			evenly: ['canvas 30,30']
		});
	});

	test('the canvas pans when the note under the pointer cannot move that way', () => {
		assert.deepStrictEqual({
			upAtTheTop: run({ 'a.md': { position: 0, max: 1000 } }, [{ on: 'a.md', deltaY: -30 }]),
			downAtTheBottom: run({ 'a.md': { position: 999.5, max: 1000 } }, [{ on: 'a.md', deltaY: 30 }]),
			// The note at its end handed the gesture to the canvas. It takes the next one that it can follow.
			backFromTheBottom: run({ 'a.md': { position: 1000, max: 1000 } }, [{ on: 'a.md', deltaY: 30 }, { afterQuietTime: true, on: 'a.md', deltaY: -30 }]),
			aNoteThatFits: run({ 'a.md': { position: 0, max: 0 } }, [{ on: 'a.md', deltaY: 30 }]),
			aCardWithoutANote: run({}, [{ on: 'folder', deltaY: 30 }]),
			aButtonIsHeld: run({ 'a.md': middle }, [{ on: 'a.md', deltaY: 30, buttonHeld: true }])
		}, {
			upAtTheTop: ['canvas 0,-30'],
			downAtTheBottom: ['canvas 0,30'],
			backFromTheBottom: ['canvas 0,30', 'a.md -30'],
			aNoteThatFits: ['canvas 0,30'],
			aCardWithoutANote: ['canvas 0,30'],
			aButtonIsHeld: ['canvas 0,30']
		});
	});

	test('an event without movement goes on with a gesture and never starts one', () => {
		assert.deepStrictEqual({
			first: run({ 'a.md': middle }, [{}, { on: 'a.md', deltaY: 30 }]),
			inside: run({ 'a.md': middle }, [{ on: 'a.md', deltaY: 30 }, {}, { deltaY: 30 }])
		}, {
			first: ['leave', 'a.md 30'],
			inside: ['a.md 30', 'a.md 0', 'a.md 30']
		});
	});

	test('a gesture moves nothing once its card shows no note', () => {
		const notes: Record<string, IBaseHalfCanvasWheelExtent | undefined> = { 'a.md': middle };
		const gestures = new BaseHalfCanvasWheelGestures();
		const step = () => gestures.step({ deltaX: 0, deltaY: 30 }, () => ({ ownScroll: false, card: 'a.md', buttonHeld: false }), card => notes[card]).kind;

		const shown = step();
		notes['a.md'] = undefined;

		assert.deepStrictEqual([shown, step(), step()], ['scroll', 'hold', 'hold']);
	});

	test('a gesture ends by a timer that fires on time, and not by one that a busy window held up', () => {
		const quiet = BASEHALF_CANVAS_WHEEL_GESTURE_QUIET_MS;
		const grace = BASEHALF_CANVAS_WHEEL_BUSY_GRACE_MS;
		/** Says when the gesture ended, with timers that fire at `fireTimes`, and which waits were set. */
		function run(fireTimes: readonly number[], disposeAt?: number): { readonly ended: number | undefined; readonly waits: number[] } {
			let now = 0;
			let pending: (() => void) | undefined;
			let ended: number | undefined;
			const waits: number[] = [];
			const store = baseHalfCanvasWheelAfterQuietTime({
				now: () => now,
				setTimeout: (handler, ms) => {
					waits.push(ms);
					pending = handler;
					return handler;
				},
				clearTimeout: handler => {
					if (pending === handler) {
						pending = undefined;
					}
				}
			}, () => ended = now);
			for (const time of fireTimes) {
				now = time;
				if (time === disposeAt) {
					store.dispose();
				}
				const handler = pending;
				pending = undefined;
				handler?.();
			}
			store.dispose();
			return { ended, waits };
		}

		assert.deepStrictEqual({
			onTime: run([quiet]),
			aLittleLate: run([quiet + 10]),
			// The window was busy for 400 ms. The grace time passes without a wheel event.
			heldUp: run([quiet + 400, quiet + 400 + grace]),
			// It was busy again when the grace time ran out.
			heldUpTwice: run([quiet + 400, quiet + 900, quiet + 900 + grace]),
			// A wheel event came in during the grace time and took the timer away.
			wheelEventInTheGraceTime: run([quiet + 400, quiet + 400 + grace], quiet + 400 + grace)
		}, {
			onTime: { ended: quiet, waits: [quiet] },
			aLittleLate: { ended: quiet + 10, waits: [quiet] },
			heldUp: { ended: quiet + 400 + grace, waits: [quiet, grace] },
			heldUpTwice: { ended: quiet + 900 + grace, waits: [quiet, grace, grace] },
			wheelEventInTheGraceTime: { ended: undefined, waits: [quiet, grace] }
		});
	});

	test('content moves for a vertical scroll that does not point beyond its end', () => {
		const top = { position: 0, max: 100 };
		const bottom = { position: 99.5, max: 100 };
		assert.deepStrictEqual({
			mostlyVertical: baseHalfCanvasWheelMovesContent({ deltaX: 3, deltaY: -4 }, { position: 50, max: 100 }),
			sideways: baseHalfCanvasWheelMovesContent({ deltaX: 4, deltaY: 0 }, { position: 50, max: 100 }),
			upAtTop: baseHalfCanvasWheelMovesContent({ deltaX: 0, deltaY: -4 }, top),
			downAtTop: baseHalfCanvasWheelMovesContent({ deltaX: 0, deltaY: 4 }, top),
			downAtBottom: baseHalfCanvasWheelMovesContent({ deltaX: 0, deltaY: 4 }, bottom),
			upAtBottom: baseHalfCanvasWheelMovesContent({ deltaX: 0, deltaY: -4 }, bottom)
		}, {
			mostlyVertical: true,
			sideways: false,
			upAtTop: false,
			downAtTop: true,
			downAtBottom: false,
			upAtBottom: true
		});
	});

	test('content stops at its ends', () => {
		assert.deepStrictEqual([
			baseHalfCanvasWheelContentPosition({ position: 50, max: 100 }, 12.5),
			baseHalfCanvasWheelContentPosition({ position: 50, max: 100 }, 80),
			baseHalfCanvasWheelContentPosition({ position: 50, max: 100 }, -80),
			baseHalfCanvasWheelContentPosition({ position: 50, max: -4 }, 10)
		], [62.5, 100, 0, 0]);
	});
});
