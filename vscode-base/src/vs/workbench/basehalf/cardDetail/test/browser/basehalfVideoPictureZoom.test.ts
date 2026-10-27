/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfVideoPictureZoom } from '../../browser/basehalfVideoPictureZoom.js';

/** A resize observer that tells its callback when the test says. */
class TestResizeObserver implements ResizeObserver {
	static last: TestResizeObserver | undefined;
	constructor(private readonly callback: ResizeObserverCallback) {
		TestResizeObserver.last = this;
	}
	observe(): void { }
	unobserve(): void { }
	disconnect(): void { }
	fire(): void {
		this.callback([], this);
	}
}

const round = (value: number) => Math.round(value * 100) / 100;

suite('BaseHalfVideoPictureZoom', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * A media area of 1400 × 900 pixels at the top left of the window, with a
	 * player of 1000 × 562 at 200, 100 in it, its video of `width` × `height`
	 * pixels, and a control of Card Detail under the player.
	 */
	function setUp(width = 854, height = 480) {
		const disposables = store.add(new DisposableStore());
		const area = mainWindow.document.createElement('div');
		area.style.cssText = 'position: fixed; left: 0; top: 0; width: 1400px; height: 900px; overflow: hidden;';
		const player = mainWindow.document.createElement('div');
		player.style.cssText = 'position: absolute; left: 200px; top: 100px; width: 1000px; height: 562px;';
		const video = mainWindow.document.createElement('video');
		video.style.cssText = 'display: block; width: 100%; height: 100%; object-fit: contain;';
		Object.defineProperty(video, 'videoWidth', { value: width });
		Object.defineProperty(video, 'videoHeight', { value: height });
		player.appendChild(video);
		const control = mainWindow.document.createElement('div');
		control.style.cssText = 'position: absolute; left: 200px; top: 700px; width: 1000px; height: 48px;';
		area.append(player, control);
		mainWindow.document.body.appendChild(area);
		disposables.add(toDisposable(() => area.remove()));
		const zoom = disposables.add(new BaseHalfVideoPictureZoom(player, video, area, target => target === control, TestResizeObserver));
		const clicks: number[] = [];
		disposables.add({ dispose: () => video.removeEventListener('click', onClick) });
		function onClick() {
			clicks.push(Date.now());
		}
		video.addEventListener('click', onClick);
		return { area, player, video, control, zoom, clicks, observer: TestResizeObserver.last! };
	}

	function pinch(target: HTMLElement, x: number, y: number, scale: number, steps = 25): void {
		for (let index = 0; index < steps; index++) {
			target.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 * Math.log(scale) / steps, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
		}
	}

	function swipe(target: HTMLElement, deltaX: number, deltaY: number): WheelEvent {
		const event = new WheelEvent('wheel', { deltaX, deltaY, clientX: 600, clientY: 300, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	function pointer(target: HTMLElement, type: string, x: number, y: number): void {
		target.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true }));
	}

	function rectOf(element: HTMLElement) {
		const rect = element.getBoundingClientRect();
		return { left: round(rect.left), top: round(rect.top), width: round(rect.width), height: round(rect.height) };
	}

	test('a pinch zooms the place under the pointer past the player\'s box, as a browser zooms its page, up to 5 times as it fits', () => {
		const { video, player, zoom } = setUp();
		const at = { x: 500, y: 300 };
		// Where the pointer is on the picture at rest, from its left and its top.
		const before = { x: (at.x - 200) / 1000, y: (at.y - 100) / 562 };
		pinch(video, at.x, at.y, 1.6);
		const level = round(zoom.state.zoom);
		const rect = video.getBoundingClientRect();
		const under = { x: round((at.x - rect.left) / rect.width), y: round((at.y - rect.top) / rect.height) };
		const grown = rectOf(video);
		pinch(video, at.x, at.y, 10);
		assert.deepStrictEqual({
			level,
			under,
			grown,
			player: rectOf(player),
			largest: round(zoom.state.zoom)
		}, {
			level: 1.6,
			under: { x: round(before.x), y: round(before.y) },
			// Past the player's box on every side.
			grown: { left: 20, top: -20, width: 1600, height: 899.2 },
			player: { left: 200, top: 100, width: 1000, height: 562 },
			// The video of 854 pixels fits at 1,000: 5 times that is more than twice its pixels.
			largest: 5
		});
	});

	test('a two-finger swipe moves the zoomed picture and zooms nothing; as it fits it moves nothing', () => {
		const { video, zoom } = setUp();
		const atRest = swipe(video, 0, 120);
		const rest = { prevented: atRest.defaultPrevented, state: zoom.state, transform: video.style.transform };
		pinch(video, 700, 400, 2);
		const zoomed = zoom.state;
		const moving = swipe(video, 50, 30);
		assert.deepStrictEqual({
			rest,
			moved: { prevented: moving.defaultPrevented, zoom: round(zoom.state.zoom), by: { x: round(zoom.state.origin.x - zoomed.origin.x), y: round(zoom.state.origin.y - zoomed.origin.y) } }
		}, {
			rest: { prevented: false, state: { zoom: 1, origin: { x: 0, y: 0 } }, transform: '' },
			// The picture follows the fingers: a swipe to the right and down moves it to the left and up.
			moved: { prevented: true, zoom: 2, by: { x: -50, y: -30 } }
		});
	});

	test('a pinch over the room around the picture zooms it too; one over a control of Card Detail is the control\'s', () => {
		const { area, control, zoom } = setUp();
		pinch(control, 600, 720, 2);
		const overControl = round(zoom.state.zoom);
		pinch(area, 100, 50, 2);
		const origin = { x: round(zoom.state.origin.x), y: round(zoom.state.origin.y) };
		assert.deepStrictEqual({ overControl, overRoom: round(zoom.state.zoom), origin }, { overControl: 1, overRoom: 2, origin: { x: -100, y: -50 } });
	});

	test('the zoomed area is never moved off itself', () => {
		const { video, zoom } = setUp();
		pinch(video, 700, 450, 2);
		for (let index = 0; index < 20; index++) {
			swipe(video, -200, -200);
		}
		const topLeft = zoom.state.origin;
		for (let index = 0; index < 40; index++) {
			swipe(video, 200, 200);
		}
		const bottomRight = { x: round(zoom.state.origin.x), y: round(zoom.state.origin.y) };
		assert.deepStrictEqual({ topLeft, bottomRight }, { topLeft: { x: 0, y: 0 }, bottomRight: { x: -1400, y: -900 } });
	});

	test('a drag moves the zoomed picture, and its click reaches no control', () => {
		const { video, zoom, clicks } = setUp();
		pinch(video, 700, 381, 1.6);
		const before = zoom.state.origin;
		pointer(video, 'pointerdown', 700, 381);
		pointer(video, 'pointermove', 750, 400);
		pointer(video, 'pointermove', 800, 420);
		pointer(video, 'pointerup', 800, 420);
		video.dispatchEvent(new MouseEvent('click', { clientX: 800, clientY: 420, bubbles: true, cancelable: true }));
		const dragged = { by: { x: round(zoom.state.origin.x - before.x), y: round(zoom.state.origin.y - before.y) }, clicks: clicks.length };
		// A press that does not move is a click, which plays and pauses the video.
		pointer(video, 'pointerdown', 700, 381);
		pointer(video, 'pointermove', 701, 382);
		pointer(video, 'pointerup', 701, 382);
		video.dispatchEvent(new MouseEvent('click', { clientX: 701, clientY: 382, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ dragged, clicks: clicks.length }, { dragged: { by: { x: 100, y: 39 }, clicks: 0 }, clicks: 1 });
	});

	test('Escape during a drag puts the picture back where it was', () => {
		const { video, zoom } = setUp();
		pinch(video, 700, 381, 1.6);
		const before = zoom.state;
		pointer(video, 'pointerdown', 700, 381);
		pointer(video, 'pointermove', 600, 350);
		const moved = zoom.state.origin;
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		mainWindow.dispatchEvent(escape);
		pointer(video, 'pointermove', 500, 300);
		assert.deepStrictEqual({ moved: moved.x !== before.origin.x, after: zoom.state, prevented: escape.defaultPrevented }, { moved: true, after: before, prevented: true });
	});

	test('a smaller area keeps the zoom as far as it allows, and a small video zooms as far as a page', () => {
		const { video, zoom, area, observer } = setUp();
		pinch(video, 1000, 500, 1.5);
		const before = zoom.state;
		area.style.width = '700px';
		area.style.height = '450px';
		observer.fire();
		const after = zoom.state;
		zoom.dispose();
		const small = setUp(320, 180);
		pinch(small.video, 500, 281, 20);
		assert.deepStrictEqual({
			level: [round(before.zoom), round(after.zoom)],
			// The area's top left moves half as far in an area half as wide.
			origin: round(after.origin.x / before.origin.x),
			small: round(small.zoom.state.zoom)
		}, { level: [1.5, 1.5], origin: 0.5, small: 5 });
	});
});
