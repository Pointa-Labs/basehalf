/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_NOTE_ZOOM_VARIABLE, BaseHalfNoteZoomGesture, IBaseHalfNoteZoomClock, IBaseHalfNoteZoomPage } from '../../browser/basehalfNoteZoomGesture.js';
import { baseHalfNoteOutlineHeadings } from '../../browser/basehalfNoteOutline.js';

/** A clock whose frames and timers run when the test says. */
class TestClock implements IBaseHalfNoteZoomClock {
	private frames: (() => void)[] = [];
	private timers: { readonly callback: () => void; readonly at: number }[] = [];
	time = 0;

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

	/** A pinch of ten events a frame apart, its fingers moving for 80 ms; `each` runs after each frame. */
	function pinch(gesture: BaseHalfNoteZoomGesture, clock: TestClock, scale: number, x: number, y: number, each?: () => void): void {
		const steps = 10;
		for (let index = 0; index < steps; index++) {
			gesture.zoomBy({ deltaY: -100 * Math.log(scale) / steps, deltaMode: 0, clientX: x, clientY: y });
			clock.advance(8);
			clock.runFrame();
			each?.();
		}
	}

	function line(index: number): DOMRect {
		return page.children[index].getBoundingClientRect();
	}

	function target(options?: Partial<IBaseHalfNoteZoomPage>): IBaseHalfNoteZoomPage {
		return { view, page, ...options };
	}

	/** The page is drawn as it is laid out: no picture, and nothing left of the one there was. */
	function assertLaidOut(gesture: BaseHalfNoteZoomGesture): void {
		assert.deepStrictEqual({
			picture: page.style.transform.includes('translate'),
			scale: Math.abs(scaleOf(page) - gesture.level) < 1e-4,
			origin: page.style.transformOrigin,
			room: view.children.length,
			sideways: view.style.overflowX,
		}, { picture: false, scale: true, origin: 'center top', room: 1, sideways: '' });
	}

	test('while the fingers move, the page is drawn as a picture around the pointer and nothing of it is laid out', () => {
		const clock = new TestClock();
		const settled: number[] = [];
		const gesture = new BaseHalfNoteZoomGesture(target(), 1, level => settled.push(level), clock);
		view.scrollTop = 200;
		const pointer = { x: 250, y: line(12).top + 4 };
		const before = line(12);
		const drift: number[] = [];

		pinch(gesture, clock, 1.5, pointer.x, pointer.y, () => {
			// The point of the page under the pointer stays under it, across and up and down (rule 4).
			const grown = scaleOf(page);
			const now = line(12);
			drift.push(Math.abs(now.left - (pointer.x - (pointer.x - before.left) * grown)), Math.abs(now.top - (pointer.y - (pointer.y - before.top) * grown)));
			assert.strictEqual(view.style.getPropertyValue(BASEHALF_NOTE_ZOOM_VARIABLE), '1', 'not laid out while the fingers move');
		});
		assert.ok(Math.max(...drift) < 0.5, `the point under the pointer moved by ${Math.max(...drift)} pixels`);
		assert.ok(Math.abs(scaleOf(page) - 1.5) < 1e-4, page.style.transform);
		assert.strictEqual(gesture.level, 1);
		assert.strictEqual(view.scrollTop, 200);
		assert.deepStrictEqual(settled, []);
		gesture.dispose();
	});

	test('once the fingers rest, the page is laid out once, keeps the line under the pointer, and glides to the middle', () => {
		const clock = new TestClock();
		const settled: number[] = [];
		const gesture = new BaseHalfNoteZoomGesture(target(), 1, level => settled.push(level), clock);
		view.scrollTop = 200;
		const pointer = { x: 180, y: line(12).top + 4 };
		pinch(gesture, clock, 1.5, pointer.x, pointer.y);
		const picture = line(12);
		const pictureLeft = page.getBoundingClientRect().left;

		clock.advance(150);
		assert.ok(Math.abs(gesture.level - 1.5) < 1e-9, String(gesture.level));
		assert.deepStrictEqual(settled, [gesture.level]);
		assert.strictEqual(view.style.getPropertyValue(BASEHALF_NOTE_ZOOM_VARIABLE), String(gesture.level));
		// The lines stay as they were, so the page glides from where the picture was.
		assert.ok(Math.abs(line(12).top - picture.top) < 2, `${line(12).top} against ${picture.top}`);
		assert.ok(Math.abs(page.getBoundingClientRect().left - pictureLeft) < 0.5, 'the glide starts at the picture');

		clock.advance(100);
		clock.runFrame();
		// Pinched left of the middle, the picture stood right of its place: laid out 600 pixels wide, the page's place is 0.
		const halfway = page.getBoundingClientRect().left;
		assert.ok(pictureLeft > 1 && halfway > 0.5 && halfway < pictureLeft - 0.5, `the page glides from ${pictureLeft} to 0: ${halfway}`);

		clock.advance(100);
		clock.runFrame();
		const placed = page.getBoundingClientRect();
		assert.ok(Math.abs(placed.left + placed.width / 2 - 300) < 0.5, `the column is in the middle: ${placed.left}`);
		assert.ok(Math.abs(line(12).top - picture.top) < 2, 'the line under the pointer kept its height');
		assertLaidOut(gesture);
		gesture.dispose();
	});

	test('a pinch out at the start of the note follows the fingers past it, and the page glides back to its top', () => {
		const clock = new TestClock();
		const gesture = new BaseHalfNoteZoomGesture(target(), 1, () => { }, clock);
		const pointer = { x: 250, y: 200 };
		const before = line(10);
		const start = page.getBoundingClientRect().top;
		pinch(gesture, clock, 0.6, pointer.x, pointer.y);
		const now = line(10);
		assert.ok(Math.abs(now.top - (pointer.y - (pointer.y - before.top) * scaleOf(page))) < 0.5, 'the line under the pointer stays with it');
		const pictureTop = page.getBoundingClientRect().top;
		assert.ok(pictureTop > start + 50, `the picture left the start of the note: ${pictureTop}`);

		clock.advance(150);
		clock.advance(200);
		clock.runFrame();
		assert.ok(Math.abs(page.getBoundingClientRect().top - start) < 0.5, `back at its top: ${page.getBoundingClientRect().top}`);
		assert.strictEqual(view.scrollTop, 0);
		assertLaidOut(gesture);
		gesture.dispose();
	});

	test('with reduced motion, the page is in its place at once', () => {
		const clock = new TestClock();
		const gesture = new BaseHalfNoteZoomGesture(target({ reducedMotion: () => true }), 1, () => { }, clock);
		const start = page.getBoundingClientRect().top;
		pinch(gesture, clock, 0.6, 250, 200);
		clock.advance(150);
		assert.ok(Math.abs(page.getBoundingClientRect().top - start) < 0.5, String(page.getBoundingClientRect().top));
		assertLaidOut(gesture);
		gesture.dispose();
	});

	test('when the layout breaks the lines anew, the page is in its place in the frame of the layout', () => {
		const clock = new TestClock();
		const gesture = new BaseHalfNoteZoomGesture(target(), 1, () => { }, clock);
		view.scrollTop = 200;
		const pointerY = line(12).top + 4;
		pinch(gesture, clock, 2, 250, pointerY);
		const picture = line(12);
		clock.advance(150);
		// At 200% the column is laid out 300 pixels wide instead of 400.
		assertLaidOut(gesture);
		const placed = page.getBoundingClientRect();
		assert.ok(Math.abs(placed.left + placed.width / 2 - 300) < 0.5, 'the column is in the middle');
		assert.ok(Math.abs(line(12).top - picture.top) < 2, 'the line under the pointer kept its height');
		gesture.dispose();
	});

	test('a pinch out at the end of the note keeps the view where it is while the fingers move', () => {
		const clock = new TestClock();
		const gesture = new BaseHalfNoteZoomGesture(target(), 1.5, () => { }, clock);
		view.scrollTop = view.scrollHeight;
		const end = view.scrollTop;
		assert.ok(end > 0);
		const scrolls: number[] = [];
		pinch(gesture, clock, 1 / 1.5, 300, 300, () => scrolls.push(view.scrollTop));
		assert.deepStrictEqual(scrolls.filter(scroll => scroll !== end), [], 'the browser did not move the view to the end of a shorter range');
		clock.advance(150);
		clock.advance(200);
		clock.runFrame();
		assert.ok(Math.abs(gesture.level - 1) < 1e-9);
		assert.strictEqual(view.scrollTop, view.scrollHeight - view.clientHeight, 'at the end of the note once laid out');
		gesture.dispose();
	});

	test('a gesture that ends near 100% ends there, and a level from elsewhere waits for the gesture', () => {
		const clock = new TestClock();
		const settled: number[] = [];
		const gesture = new BaseHalfNoteZoomGesture(target(), 1, level => settled.push(level), clock);
		pinch(gesture, clock, 1.03, 300, 100);
		gesture.setLevel(2);
		assert.strictEqual(gesture.level, 1, 'the gesture keeps its own level');
		clock.advance(150);
		clock.advance(200);
		clock.runFrame();
		assert.deepStrictEqual(settled, [1]);
		assert.strictEqual(page.style.transform, '');

		gesture.setLevel(2);
		assert.strictEqual(gesture.level, 2);
		assert.strictEqual(page.style.transform, 'scale(2)');
		gesture.dispose();
	});

	test('a pinch while the page glides goes on from where the page is drawn', () => {
		const clock = new TestClock();
		const gesture = new BaseHalfNoteZoomGesture(target(), 1, () => { }, clock);
		pinch(gesture, clock, 1.03, 300, 100);
		clock.advance(150);
		clock.advance(50);
		clock.runFrame();
		const gliding = scaleOf(page);
		assert.ok(gliding > 1 && gliding < 1.03, `gliding back to 100%: ${gliding}`);
		gesture.zoomBy({ deltaY: -1, deltaMode: 0, clientX: 300, clientY: 100 });
		clock.runFrame();
		assert.ok(Math.abs(scaleOf(page) - gliding * Math.exp(0.01)) < 1e-4, `${scaleOf(page)} after ${gliding}`);
		gesture.dispose();
	});

	test('the headings of a page are its heading elements with text, in order', () => {
		const root = mainWindow.document.createElement('div');
		root.innerHTML = '<h1>Top</h1><p># not a heading</p><pre><code># a comment</code></pre><h3> Deep  part </h3><h2></h2><div><h2>In HTML</h2></div>';
		assert.deepStrictEqual(baseHalfNoteOutlineHeadings(root).map(heading => [heading.level, heading.name]), [[1, 'Top'], [3, 'Deep part'], [2, 'In HTML']]);
		assert.deepStrictEqual(baseHalfNoteOutlineHeadings(undefined), []);
	});
});
