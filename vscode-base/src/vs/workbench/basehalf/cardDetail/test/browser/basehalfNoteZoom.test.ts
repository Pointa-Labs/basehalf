/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfNoteZoom, IBaseHalfNoteZoomClock } from '../../browser/basehalfNoteZoom.js';

/** A clock whose frames and timers run when the test says. */
class TestClock implements IBaseHalfNoteZoomClock {
	private frames: (() => void)[] = [];
	private timers: { readonly callback: () => void; readonly at: number }[] = [];
	private time = 0;

	readonly frame = (callback: () => void) => {
		this.frames.push(callback);
		return { dispose: () => { this.frames = this.frames.filter(frame => frame !== callback); } };
	};
	readonly timeout = (callback: () => void, ms: number) => {
		const timer = { callback, at: this.time + ms };
		this.timers.push(timer);
		return { dispose: () => { this.timers = this.timers.filter(other => other !== timer); } };
	};

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

suite('BaseHalfNoteZoom', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let view: HTMLElement;
	let page: HTMLElement;

	setup(() => {
		view = mainWindow.document.createElement('div');
		view.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px; overflow: auto; scrollbar-width: none;';
		// The page is as wide as the view, its text in a column in the middle (rule 21).
		page = mainWindow.document.createElement('div');
		page.style.cssText = 'padding: 40px 100px; font: 16px/20px sans-serif;';
		for (let index = 0; index < 40; index++) {
			const paragraph = mainWindow.document.createElement('p');
			paragraph.style.margin = '0 0 10px';
			paragraph.textContent = `Paragraph ${index} of a note, long enough to wrap in the column of the page.`;
			page.append(paragraph);
		}
		view.append(page);
		mainWindow.document.body.append(view);
	});

	teardown(() => view.remove());

	/** A pinch of ten events a frame apart, its fingers moving for 80 ms; `each` runs after each frame. */
	function pinch(zoom: BaseHalfNoteZoom, clock: TestClock, scale: number, x: number, y: number, each?: () => void): void {
		const steps = 10;
		for (let index = 0; index < steps; index++) {
			zoom.zoomBy({ deltaY: -100 * Math.log(scale) / steps, deltaMode: 0, clientX: x, clientY: y });
			clock.advance(8);
			clock.runFrame();
			each?.();
		}
	}

	function paragraph(index: number): DOMRect {
		return page.children[index].getBoundingClientRect();
	}

	/** Where each paragraph's lines are, as its height at 100%: the same in every frame when no line breaks anew. */
	function lineCounts(level: number): number[] {
		return [...page.children].map(element => Math.round(element.getBoundingClientRect().height / level / 20));
	}

	test('the page grows around the pointer, keeps its lines, and nothing moves once the fingers rest', () => {
		const clock = new TestClock();
		const zoom = new BaseHalfNoteZoom({ view, page }, clock);
		view.scrollTop = 200;
		const pointer = { x: 250, y: paragraph(12).top + 4 };
		const before = paragraph(12);
		const lines = lineCounts(1);
		const drift: number[] = [];
		const broken: number[] = [];
		const check = () => {
			// The point of the page under the pointer stays under it, across and up and down (rule 2).
			const now = paragraph(12);
			drift.push(Math.abs(now.left - (pointer.x - (pointer.x - before.left) * zoom.level)), Math.abs(now.top - (pointer.y - (pointer.y - before.top) * zoom.level)));
			if (lineCounts(zoom.level).some((count, index) => count !== lines[index])) {
				broken.push(zoom.level);
			}
		};

		pinch(zoom, clock, 1.8, pointer.x, pointer.y, check);
		assert.ok(Math.abs(zoom.level - 1.8) < 1e-9, String(zoom.level));
		assert.strictEqual(page.style.willChange, 'transform', 'a layer of its own while the fingers move');
		const atLastEvent = { box: paragraph(12), left: view.scrollLeft, top: view.scrollTop };

		clock.advance(150);
		clock.runFrame();
		check();
		assert.deepStrictEqual({
			// A scroll position is kept to a fraction of a pixel of the screen.
			maxDrift: Math.max(...drift) <= 1,
			broken,
			// Once the fingers rest, the page is drawn sharp where it is (rule 6).
			willChange: page.style.willChange,
			moved: [paragraph(12).left - atLastEvent.box.left, paragraph(12).top - atLastEvent.box.top, view.scrollLeft - atLastEvent.left, view.scrollTop - atLastEvent.top],
		}, { maxDrift: true, broken: [], willChange: '', moved: [0, 0, 0, 0] });
		zoom.dispose();
	});

	test('a long pinch keeps the place under the pointer to a pixel, however the view rounds its scroll', () => {
		const clock = new TestClock();
		const zoom = new BaseHalfNoteZoom({ view, page }, clock);
		view.scrollTop = 200;
		const pointer = { x: 520, y: paragraph(14).top + 7 };
		const before = paragraph(14);
		for (let index = 0; index < 60; index++) {
			zoom.zoomBy({ deltaY: -100 * Math.log(2.5) / 60, deltaMode: 0, clientX: pointer.x, clientY: pointer.y });
			clock.advance(8);
			clock.runFrame();
		}
		clock.advance(150);
		const after = paragraph(14);
		const off = [after.left - (pointer.x - (pointer.x - before.left) * zoom.level), after.top - (pointer.y - (pointer.y - before.top) * zoom.level)];
		assert.ok(Math.abs(zoom.level - 2.5) < 1e-9 && off.every(value => Math.abs(value) <= 1), JSON.stringify({ level: zoom.level, off }));
		zoom.dispose();
	});

	test('a magnified page moves sideways and up and down as far as its edges', () => {
		const clock = new TestClock();
		const zoom = new BaseHalfNoteZoom({ view, page }, clock);
		pinch(zoom, clock, 2, 300, 200);
		clock.advance(150);
		const pageHeight = page.offsetHeight;
		view.scrollLeft = 10_000;
		view.scrollTop = 1_000_000;
		const end = page.getBoundingClientRect();
		view.scrollLeft = -10;
		view.scrollTop = -10;
		const start = page.getBoundingClientRect();
		assert.deepStrictEqual({
			// The edges of the magnified page stop at the view's edges (rule 5).
			sideways: view.scrollWidth - view.clientWidth,
			upAndDown: view.scrollHeight - view.clientHeight,
			endRight: end.right,
			endBottom: end.bottom,
			startLeft: start.left,
			startTop: start.top,
		}, {
			sideways: 600,
			upAndDown: 2 * pageHeight - 400,
			endRight: 600,
			endBottom: 400,
			startLeft: 0,
			startTop: 0,
		});
		zoom.dispose();
	});

	test('the level stays between 100% and 500%, and a pinch that closes at 100% changes nothing', () => {
		const clock = new TestClock();
		const zoom = new BaseHalfNoteZoom({ view, page }, clock);
		view.scrollTop = 120;
		pinch(zoom, clock, 0.5, 300, 200);
		clock.advance(150);
		const closed = { level: zoom.level, transform: page.style.transform, scrollTop: view.scrollTop, willChange: page.style.willChange };
		// Thirty notches of a wheel, each 10%, would make the page 20 times larger.
		for (let notch = 0; notch < 30; notch++) {
			zoom.zoomBy({ deltaY: -100, deltaMode: 0, clientX: 300, clientY: 200 });
			clock.advance(8);
			clock.runFrame();
		}
		clock.advance(150);
		assert.deepStrictEqual({ closed, far: zoom.level, transform: page.style.transform }, {
			closed: { level: 1, transform: '', scrollTop: 120, willChange: '' },
			far: 5,
			transform: 'scale(5)',
		});
		zoom.dispose();
	});

	test('zooming out at the start of the note keeps its top at the top of the view', () => {
		const clock = new TestClock();
		const zoom = new BaseHalfNoteZoom({ view, page }, clock);
		pinch(zoom, clock, 2, 300, 100);
		clock.advance(150);
		view.scrollTop = 30;
		// The top of the page is 30 pixels above the view; zooming out around the bottom of the view brings it down.
		const tops: number[] = [];
		pinch(zoom, clock, 0.5, 300, 390, () => tops.push(page.getBoundingClientRect().top));
		clock.advance(150);
		assert.deepStrictEqual({ level: zoom.level, transform: page.style.transform, scrollTop: view.scrollTop, belowTheTop: tops.filter(top => top > 0) }, { level: 1, transform: '', scrollTop: 0, belowTheTop: [] });
		zoom.dispose();
	});

	test('a page shown anew is at 100% at once, and a gesture under way ends there', () => {
		const clock = new TestClock();
		const zoom = new BaseHalfNoteZoom({ view, page }, clock);
		pinch(zoom, clock, 2, 300, 200);
		zoom.zoomBy({ deltaY: -10, deltaMode: 0, clientX: 300, clientY: 200 });
		zoom.reset();
		clock.runFrame();
		clock.advance(150);
		assert.deepStrictEqual({ level: zoom.level, transform: page.style.transform, origin: page.style.transformOrigin, willChange: page.style.willChange }, { level: 1, transform: '', origin: '', willChange: '' });
		zoom.dispose();
	});
});
