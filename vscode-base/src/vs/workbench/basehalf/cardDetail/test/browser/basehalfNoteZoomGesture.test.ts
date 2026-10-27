/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_NOTE_ZOOM_VARIABLE, BaseHalfNoteZoomGesture, IBaseHalfNoteZoomClock } from '../../browser/basehalfNoteZoomGesture.js';
import { baseHalfNoteOutlineHeadings } from '../../browser/basehalfNoteOutline.js';

/** A clock whose frames and timers run when the test says. */
class TestClock implements IBaseHalfNoteZoomClock {
	private frames: (() => void)[] = [];
	private timers: { readonly callback: () => void; readonly at: number }[] = [];
	time = 0;
	/** How long the next layouts take, by the clock. */
	layoutTime = 0;

	readonly frame = (callback: () => void) => {
		this.frames.push(callback);
		return { dispose: () => { this.frames = this.frames.filter(frame => frame !== callback); } };
	};
	readonly timeout = (callback: () => void, ms: number) => {
		const timer = { callback, at: this.time + ms };
		this.timers.push(timer);
		return { dispose: () => { this.timers = this.timers.filter(other => other !== timer); } };
	};
	readonly now = () => this.time;

	runFrame(): void {
		const frames = this.frames;
		this.frames = [];
		for (const frame of frames) {
			frame();
		}
	}

	advance(ms: number): void {
		this.time += ms;
		for (const timer of this.timers.filter(other => other.at <= this.time)) {
			this.timers = this.timers.filter(other => other !== timer);
			timer.callback();
		}
	}
}

/** The scale a page is drawn at; the browser keeps six digits of it. */
function scaleOf(page: HTMLElement): number {
	const match = /scale\(([\d.]+)\)/.exec(page.style.transform);
	return match ? Number(match[1]) : 1;
}

suite('BaseHalfNoteZoomGesture', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let view: HTMLElement;
	let page: HTMLElement;

	setup(() => {
		view = mainWindow.document.createElement('div');
		view.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px; overflow: auto;';
		page = mainWindow.document.createElement('div');
		page.style.cssText = 'max-width: min(400px, calc(100% / var(--basehalf-note-zoom, 1))); margin: 0 auto; transform-origin: top center;';
		for (let index = 0; index < 40; index++) {
			const paragraph = mainWindow.document.createElement('p');
			paragraph.textContent = `Line ${index} of a note that is long enough to scroll.`;
			page.append(paragraph);
		}
		view.append(page);
		mainWindow.document.body.append(view);
	});

	teardown(() => view.remove());

	function pinch(gesture: BaseHalfNoteZoomGesture, clock: TestClock, scale: number, y: number): void {
		const steps = 10;
		for (let index = 0; index < steps; index++) {
			gesture.zoomBy({ deltaY: -100 * Math.log(scale) / steps, deltaMode: 0, clientX: 300, clientY: y });
			clock.advance(8);
			clock.runFrame();
		}
	}

	test('a pinch lays the page out at the level in each frame and keeps the line under the pointer', () => {
		const clock = new TestClock();
		const settled: number[] = [];
		const gesture = new BaseHalfNoteZoomGesture({ view, page }, 1, level => settled.push(level), clock);
		view.scrollTop = 200;
		const line = page.children[12] as HTMLElement;
		const pointerY = line.getBoundingClientRect().top + 4;
		const before = line.getBoundingClientRect().top;

		pinch(gesture, clock, 1.5, pointerY);
		assert.ok(Math.abs(scaleOf(page) - gesture.level) < 1e-4, page.style.transform);
		assert.ok(Math.abs(gesture.level - 1.5) < 1e-9, String(gesture.level));
		assert.strictEqual(view.style.getPropertyValue(BASEHALF_NOTE_ZOOM_VARIABLE), String(gesture.level));
		const after = line.getBoundingClientRect().top;
		assert.ok(Math.abs(after - (pointerY - (pointerY - before) * 1.5)) < 2, `${after}`);
		assert.deepStrictEqual(settled, []);

		clock.advance(150);
		assert.deepStrictEqual(settled, [gesture.level]);
		gesture.dispose();
	});

	test('a slow layout makes the rest of the gesture drawn only, and the page is laid out once it rests', () => {
		const clock = new TestClock();
		const gesture = new BaseHalfNoteZoomGesture({ view, page }, 1, () => { }, clock);
		const originalNow = clock.now;
		let calls = 0;
		// Every layout takes 40 ms by this clock.
		(clock as { now: () => number }).now = () => originalNow() + (calls++ % 2 === 1 ? 40 : 0);

		gesture.zoomBy({ deltaY: -10, deltaMode: 0, clientX: 300, clientY: 100 });
		clock.runFrame();
		const laidOut = gesture.level;
		gesture.zoomBy({ deltaY: -10, deltaMode: 0, clientX: 300, clientY: 100 });
		clock.runFrame();
		assert.strictEqual(gesture.level, laidOut, 'drawn, not laid out');
		assert.ok(scaleOf(page) > laidOut + 1e-3, page.style.transform);

		clock.advance(150);
		assert.ok(gesture.level > laidOut, String(gesture.level));
		assert.ok(Math.abs(scaleOf(page) - gesture.level) < 1e-4, page.style.transform);
		gesture.dispose();
	});

	test('a gesture that ends near 100% ends there, and a level from elsewhere waits for the gesture', () => {
		const clock = new TestClock();
		const settled: number[] = [];
		const gesture = new BaseHalfNoteZoomGesture({ view, page }, 1, level => settled.push(level), clock);
		pinch(gesture, clock, 1.03, 100);
		gesture.setLevel(2);
		assert.ok(Math.abs(gesture.level - 1.03) < 1e-9, 'the gesture keeps its own level');
		clock.advance(150);
		assert.deepStrictEqual(settled, [1]);
		assert.strictEqual(page.style.transform, '');

		gesture.setLevel(2);
		assert.strictEqual(gesture.level, 2);
		assert.strictEqual(page.style.transform, 'scale(2)');
		gesture.dispose();
	});

	test('the headings of a page are its heading elements with text, in order', () => {
		const root = mainWindow.document.createElement('div');
		root.innerHTML = '<h1>Top</h1><p># not a heading</p><pre><code># a comment</code></pre><h3> Deep  part </h3><h2></h2><div><h2>In HTML</h2></div>';
		assert.deepStrictEqual(baseHalfNoteOutlineHeadings(root).map(heading => [heading.level, heading.name]), [[1, 'Top'], [3, 'Deep part'], [2, 'In HTML']]);
		assert.deepStrictEqual(baseHalfNoteOutlineHeadings(undefined), []);
	});
});
