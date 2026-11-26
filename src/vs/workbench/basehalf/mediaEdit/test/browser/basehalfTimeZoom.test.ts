/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfTimeZoom, IBaseHalfTimeZoomClock } from '../../browser/basehalfTimeZoom.js';

/** A clock whose frames and timers run when the test says. */
class TestClock implements IBaseHalfTimeZoomClock {
	private frames: (() => void)[] = [];
	private timers: { readonly callback: () => void; readonly at: number }[] = [];
	time = 0;

	frame(callback: () => void): IDisposable {
		this.frames.push(callback);
		return toDisposable(() => { this.frames = this.frames.filter(frame => frame !== callback); });
	}

	timeout(callback: () => void, milliseconds: number): IDisposable {
		const timer = { callback, at: this.time + milliseconds };
		this.timers.push(timer);
		return toDisposable(() => { this.timers = this.timers.filter(other => other !== timer); });
	}

	now(): number {
		return this.time;
	}

	/** Moves the time on, and runs the frames that wait and the timers that are due. */
	advance(milliseconds: number): void {
		this.time += milliseconds;
		const frames = this.frames;
		this.frames = [];
		for (const frame of frames) {
			frame();
		}
		for (const timer of this.timers.filter(other => other.at <= this.time)) {
			this.timers = this.timers.filter(other => other !== timer);
			timer.callback();
		}
	}

	get waiting(): number {
		return this.frames.length;
	}
}

const round = (value: number) => Math.round(value * 1000) / 1000;

suite('BaseHalfTimeZoom', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** A strip of 1000 × 48 pixels at the top left of the window, over a sound of `length` seconds. */
	function setUp(length = 6) {
		const disposables = store.add(new DisposableStore());
		const strip = mainWindow.document.createElement('div');
		strip.style.cssText = 'position: fixed; left: 0; top: 0; width: 1000px; height: 48px;';
		mainWindow.document.body.appendChild(strip);
		disposables.add(toDisposable(() => strip.remove()));
		const clock = new TestClock();
		const changes: boolean[] = [];
		const moves: number[] = [];
		let total = length;
		const zoom = disposables.add(new BaseHalfTimeZoom({
			strip,
			length: () => total,
			shortest: () => 0.5,
			onDidChange: rested => changes.push(rested),
			onDidMoveUnderDrag: clientX => moves.push(clientX),
			clock
		}));
		const bar = strip.querySelector('.basehalf-time-zoom-bar') as HTMLElement;
		return { strip, clock, changes, moves, zoom, bar, setLength: (value: number) => { total = value; } };
	}

	function pinch(strip: HTMLElement, x: number, scale: number, steps = 25): void {
		for (let index = 0; index < steps; index++) {
			strip.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 * Math.log(scale) / steps, ctrlKey: true, clientX: x, clientY: 24, bubbles: true, cancelable: true }));
		}
	}

	const stretchOf = (zoom: BaseHalfTimeZoom) => ({ from: round(zoom.stretch.from), to: round(zoom.stretch.to) });

	test('a pinch spreads the strip out around the pointer, rests once, and shows where it lies for a second', () => {
		const { strip, clock, changes, zoom, bar } = setUp();
		pinch(strip, 500, 4);
		const during = { stretch: stretchOf(zoom), changes: changes.length, rested: changes.includes(true), bar: [bar.classList.contains('visible'), bar.style.left, bar.style.width] };
		clock.advance(150);
		const rested = changes.filter(change => change).length;
		clock.advance(1000);
		assert.deepStrictEqual({ during, rested, spread: zoom.spread, barAfter: bar.classList.contains('visible') }, {
			during: { stretch: { from: 2.25, to: 3.75 }, changes: 25, rested: false, bar: [true, '37.5%', '25%'] },
			rested: 1,
			spread: true,
			barAfter: false
		});
	});

	test('a notch of the wheel with the zoom key spreads it by 10%, and pinching in shows the whole length', () => {
		const { strip, zoom, bar } = setUp();
		const notch = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 0, clientY: 24, bubbles: true, cancelable: true });
		strip.dispatchEvent(notch);
		const spread = stretchOf(zoom);
		pinch(strip, 300, 0.2);
		assert.deepStrictEqual({ spread, prevented: notch.defaultPrevented, back: stretchOf(zoom), whole: !zoom.spread, bar: bar.classList.contains('visible') }, {
			spread: { from: 0, to: round(6 / Math.exp(0.1)) },
			prevented: true,
			back: { from: 0, to: 6 },
			whole: true,
			bar: false
		});
	});

	test('the wheel moves a spread-out stretch along, and does nothing at the whole length', () => {
		const { strip, zoom } = setUp();
		const atRest = new WheelEvent('wheel', { deltaX: 100, deltaY: 0, clientX: 500, clientY: 24, bubbles: true, cancelable: true });
		strip.dispatchEvent(atRest);
		pinch(strip, 500, 4);
		const sideways = new WheelEvent('wheel', { deltaX: 100, deltaY: 3, clientX: 500, clientY: 24, bubbles: true, cancelable: true });
		strip.dispatchEvent(sideways);
		const moved = stretchOf(zoom);
		strip.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: 100000, clientX: 500, clientY: 24, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ atRest: atRest.defaultPrevented, moved, prevented: sideways.defaultPrevented, atTheEnd: stretchOf(zoom) }, {
			atRest: false,
			// 100 of 1000 pixels of a stretch of 1.5 s.
			moved: { from: 2.4, to: 3.9 },
			prevented: true,
			atTheEnd: { from: 4.5, to: 6 }
		});
	});

	test('a drag past an edge carries the stretch along, faster the farther, until it comes back', () => {
		const { strip, clock, moves, zoom } = setUp();
		pinch(strip, 500, 4);
		zoom.dragAt(1100);
		clock.advance(16);
		const first = stretchOf(zoom);
		zoom.dragAt(1300);
		clock.advance(16);
		const second = stretchOf(zoom);
		zoom.dragAt(900);
		clock.advance(16);
		const inside = { stretch: stretchOf(zoom), waiting: clock.waiting };
		zoom.dragAt(-50);
		clock.advance(16);
		zoom.dragAt(undefined);
		clock.advance(16);
		assert.deepStrictEqual({ first, second, inside, back: stretchOf(zoom), moves, waiting: clock.waiting }, {
			// The depth counts from the 24 px margin's inner side (D98): 100 pixels past the end is 124, which moves a
			// stretch of 1.5 s 1.24 stretches each second; 300 pixels past, 3.24; 50 pixels before the start, 0.74.
			first: { from: 2.28, to: 3.78 },
			second: { from: 2.358, to: 3.858 },
			inside: { stretch: { from: 2.358, to: 3.858 }, waiting: 0 },
			back: { from: 2.34, to: 3.84 },
			// What the drag holds goes to the margin's inner side, 24 px inside the edge, never under it.
			moves: [976, 976, 24],
			waiting: 0
		});
	});

	test('a drag held inside the 24 px margin at an edge carries the stretch along from a crawl, holds what it drags at the margin\'s inner side, and stops when it comes out of the margin or the end is in view (D98)', () => {
		const { strip, clock, moves, zoom } = setUp();
		pinch(strip, 500, 4);
		// 12 pixels inside the end: a depth of 12, 0.12 of a stretch each second.
		zoom.dragAt(988);
		clock.advance(1000);
		const inMargin = { stretch: stretchOf(zoom), place: zoom.place(988) };
		zoom.dragAt(960);
		clock.advance(1000);
		const outOfIt = { stretch: stretchOf(zoom), waiting: clock.waiting, place: zoom.place(960) };
		zoom.dragAt(12);
		clock.advance(1000);
		const atTheStart = stretchOf(zoom);
		// Past the end, until the end is in view: then nothing follows, and the drag reaches the edge.
		zoom.dragAt(1100);
		for (let frame = 0; frame < 300; frame++) {
			clock.advance(16);
		}
		const toTheEnd = { stretch: stretchOf(zoom), waiting: clock.waiting, place: zoom.place(988) };
		zoom.dragAt(undefined);
		assert.deepStrictEqual({ inMargin, outOfIt, atTheStart, toTheEnd, moves: moves.slice(0, 2) }, {
			inMargin: { stretch: { from: 2.43, to: 3.93 }, place: 976 },
			outOfIt: { stretch: { from: 2.43, to: 3.93 }, waiting: 0, place: 960 },
			atTheStart: { from: 2.25, to: 3.75 },
			toTheEnd: { stretch: { from: 4.5, to: 6 }, waiting: 0, place: 988 },
			moves: [976, 24]
		});
	});

	test('while it plays the stretch follows the playhead, and a cut keeps it inside the length', () => {
		const { strip, changes, zoom, setLength } = setUp();
		pinch(strip, 500, 4);
		changes.length = 0;
		zoom.follow(3);
		const kept = { stretch: stretchOf(zoom), changes: changes.length };
		zoom.follow(3.8);
		const next = { stretch: stretchOf(zoom), changes: [...changes] };
		setLength(4.5);
		zoom.fit();
		assert.deepStrictEqual({ kept, next, cut: stretchOf(zoom) }, {
			kept: { stretch: { from: 2.25, to: 3.75 }, changes: 0 },
			next: { stretch: { from: 3.8, to: 5.3 }, changes: [true] },
			cut: { from: 3, to: 4.5 }
		});
	});
});
