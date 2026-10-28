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

	/** A pinch settles within the picture's edges 150 ms after it rests, in a glide of 200 ms (D101): the test waits for it. */
	function settled(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 420));
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

	test('a pinch zooms the place under the pointer past the player\'s box over the area, up to 5 times as it fits, and settles within the picture\'s edges (D96, D101)', async () => {
		const { video, player, zoom } = setUp();
		pinch(video, 700, 450, 2);
		const level = round(zoom.state.zoom);
		await settled();
		const grown = video.getBoundingClientRect();
		// Larger than the area both ways, a pinch keeps what is under the pointer under it.
		const at = { x: 800, y: 500 };
		const under = () => {
			const rect = video.getBoundingClientRect();
			return { x: round((at.x - rect.left) / rect.width), y: round((at.y - rect.top) / rect.height) };
		};
		const before = under();
		pinch(video, at.x, at.y, 1.5);
		const after = under();
		pinch(video, at.x, at.y, 10);
		assert.deepStrictEqual({
			level,
			size: { width: round(grown.width), height: round(grown.height) },
			// It covers the area: none of its edges stands inside it.
			covers: grown.left <= 0 && grown.top <= 0 && grown.right >= 1400 && grown.bottom >= 900,
			stays: after.x === before.x && after.y === before.y,
			player: rectOf(player),
			largest: round(zoom.state.zoom)
		}, {
			level: 2,
			size: { width: 2000, height: 1124 },
			covers: true,
			stays: true,
			player: { left: 200, top: 100, width: 1000, height: 562 },
			// The video of 854 pixels fits at 1,000: 5 times that is more than twice its pixels.
			largest: 5
		});
	});

	test('a two-finger swipe moves the zoomed picture and zooms nothing; as it fits it moves nothing', async () => {
		const { video, zoom } = setUp();
		const atRest = swipe(video, 0, 120);
		const rest = { prevented: atRest.defaultPrevented, state: zoom.state, transform: video.style.transform };
		pinch(video, 700, 400, 2);
		await settled();
		const zoomed = zoom.state;
		const moving = swipe(video, 50, -20);
		assert.deepStrictEqual({
			rest,
			moved: { prevented: moving.defaultPrevented, zoom: round(zoom.state.zoom), by: { x: round(zoom.state.origin.x - zoomed.origin.x), y: round(zoom.state.origin.y - zoomed.origin.y) } }
		}, {
			rest: { prevented: false, state: { zoom: 1, origin: { x: 0, y: 0 } }, transform: '' },
			// The picture follows the fingers: a swipe to the right and up moves it to the left and down.
			moved: { prevented: true, zoom: 2, by: { x: -50, y: 20 } }
		});
	});

	test('a pinch over the room around the picture zooms it too; one over a control of Card Detail is the control\'s', async () => {
		const { area, video, control, zoom } = setUp();
		pinch(control, 600, 720, 2);
		const overControl = round(zoom.state.zoom);
		pinch(area, 100, 50, 2);
		await settled();
		const rect = video.getBoundingClientRect();
		// Near the area's top left, the picture's top left corner stops at it, and no room around it shows (D101).
		assert.deepStrictEqual({ overControl, overRoom: round(zoom.state.zoom), covers: rect.left <= 0 && rect.top <= 0 && rect.right >= 1400 && rect.bottom >= 900 }, { overControl: 1, overRoom: 2, covers: true });
	});

	test('a zoomed picture moves only as far as its own edges, so that no room around it shows (D101)', () => {
		const { video } = setUp();
		pinch(video, 700, 450, 2);
		for (let index = 0; index < 20; index++) {
			swipe(video, -200, -200);
		}
		const topLeft = video.getBoundingClientRect();
		for (let index = 0; index < 40; index++) {
			swipe(video, 200, 200);
		}
		const bottomRight = video.getBoundingClientRect();
		assert.deepStrictEqual({
			topLeft: { left: round(topLeft.left), top: round(topLeft.top) },
			bottomRight: { right: round(bottomRight.right), bottom: round(bottomRight.bottom) }
		}, { topLeft: { left: 0, top: 0 }, bottomRight: { right: 1400, bottom: 900 } });
	});

	test('Edit glides a zoomed picture back to as it fits (D97, D101)', async () => {
		const { video, zoom, area } = setUp();
		pinch(video, 700, 450, 3);
		zoom.fit();
		await new Promise(resolve => setTimeout(resolve, 320));
		assert.deepStrictEqual({ state: zoom.state, transform: video.style.transform, zoomedArea: area.classList.contains('basehalf-picture-zoomed-area') }, {
			state: { zoom: 1, origin: { x: 0, y: 0 } }, transform: '', zoomedArea: false
		});
	});

	test('a drag moves the zoomed picture, and its click reaches no control', async () => {
		const { video, zoom, clicks } = setUp();
		pinch(video, 700, 381, 1.6);
		await settled();
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
		// 1.6 times as large, it is wider than the area and as high as it: it moves sideways only (D101).
		assert.deepStrictEqual({ dragged, clicks: clicks.length }, { dragged: { by: { x: 100, y: 0 }, clicks: 0 }, clicks: 1 });
	});

	test('Escape during a drag puts the picture back where it was', async () => {
		const { video, zoom } = setUp();
		pinch(video, 700, 381, 1.6);
		await settled();
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
		const rect = video.getBoundingClientRect();
		zoom.dispose();
		const small = setUp(320, 180);
		pinch(small.video, 500, 281, 20);
		assert.deepStrictEqual({
			level: [round(before.zoom), round(after.zoom)],
			// The picture still covers the smaller area, its edges outside it (D101).
			covers: rect.left <= 0 && rect.top <= 0 && rect.right >= 700 && rect.bottom >= 450,
			small: round(small.zoom.state.zoom)
		}, { level: [1.5, 1.5], covers: true, small: 5 });
	});
});
