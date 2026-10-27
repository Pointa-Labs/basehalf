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

	/** A player of 1000 × 562 pixels at the top left of the window, its video of `width` × `height` pixels. */
	function setUp(width = 854, height = 480) {
		const disposables = store.add(new DisposableStore());
		const player = mainWindow.document.createElement('div');
		player.style.cssText = 'position: fixed; left: 0; top: 0; width: 1000px; height: 562px; overflow: hidden;';
		const video = mainWindow.document.createElement('video');
		video.style.cssText = 'display: block; width: 100%; height: 100%; object-fit: contain;';
		Object.defineProperty(video, 'videoWidth', { value: width });
		Object.defineProperty(video, 'videoHeight', { value: height });
		player.appendChild(video);
		mainWindow.document.body.appendChild(player);
		disposables.add(toDisposable(() => player.remove()));
		const zoom = disposables.add(new BaseHalfVideoPictureZoom(player, video, TestResizeObserver));
		const clicks: number[] = [];
		disposables.add({ dispose: () => video.removeEventListener('click', onClick) });
		function onClick() {
			clicks.push(Date.now());
		}
		video.addEventListener('click', onClick);
		return { player, video, zoom, clicks, observer: TestResizeObserver.last! };
	}

	function pinch(target: HTMLElement, x: number, y: number, scale: number, steps = 25): void {
		for (let index = 0; index < steps; index++) {
			target.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 * Math.log(scale) / steps, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
		}
	}

	function pointer(target: HTMLElement, type: string, x: number, y: number): void {
		target.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true }));
	}

	test('a pinch zooms the picture around the pointer, up to twice its pixels', () => {
		const { video, zoom } = setUp();
		// The point of the picture under the pointer, off the middle of the player: (pointer − middle − pan) / zoom.
		const at = { x: 300, y: 200 };
		pinch(video, at.x, at.y, 1.6);
		const { zoom: level, pan } = zoom.state;
		const under = { x: round((at.x - 500 - pan.x) / level), y: round((at.y - 281 - pan.y) / level) };
		pinch(video, at.x, at.y, 3);
		assert.deepStrictEqual({
			level: round(level),
			under,
			transform: video.style.transform !== '',
			// The picture fits at 1000 / 854 screen pixels for each of its pixels: it zooms to twice its pixels.
			largest: round(zoom.state.zoom)
		}, { level: 1.6, under: { x: -200, y: -81 }, transform: true, largest: round(2 * 854 / 1000) });
	});

	test('the wheel zooms by a fifth a notch, and zooming out to the fit ends the zoom', () => {
		const { video, zoom, player } = setUp();
		video.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 500, clientY: 281, bubbles: true, cancelable: true }));
		const zoomed = { level: round(zoom.state.zoom), cursor: player.classList.contains('basehalf-picture-zoomed') };
		video.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, clientX: 200, clientY: 100, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ zoomed, after: { ...zoom.state, transform: video.style.transform, cursor: player.classList.contains('basehalf-picture-zoomed') } }, {
			zoomed: { level: round(Math.exp(0.2)), cursor: true },
			after: { zoom: 1, pan: { x: 0, y: 0 }, transform: '', cursor: false }
		});
	});

	test('a drag moves the zoomed picture as far as its edges, and its click reaches no control', () => {
		const { video, zoom, clicks } = setUp();
		pinch(video, 500, 281, 1.6);
		pointer(video, 'pointerdown', 500, 281);
		pointer(video, 'pointermove', 700, 300);
		pointer(video, 'pointermove', 900, 300);
		pointer(video, 'pointerup', 900, 300);
		video.dispatchEvent(new MouseEvent('click', { clientX: 900, clientY: 300, bubbles: true, cancelable: true }));
		const dragged = { pan: { x: round(zoom.state.pan.x), y: round(zoom.state.pan.y) }, clicks: clicks.length };
		// A press that does not move is a click, which plays and pauses the video.
		pointer(video, 'pointerdown', 500, 281);
		pointer(video, 'pointermove', 501, 282);
		pointer(video, 'pointerup', 501, 282);
		video.dispatchEvent(new MouseEvent('click', { clientX: 501, clientY: 282, bubbles: true, cancelable: true }));
		// The picture, 999.89 × 562 as it fits and 1.6 times that, covers the player: its middle moves at most 299.91 to the side, 168.6 up or down.
		assert.deepStrictEqual({ dragged, clicks: clicks.length, pan: { x: round(zoom.state.pan.x), y: round(zoom.state.pan.y) } }, {
			dragged: { pan: { x: 299.91, y: 19 }, clicks: 0 },
			clicks: 1,
			pan: { x: 299.91, y: 19 }
		});
	});

	test('Escape during a drag puts the picture back where it was', () => {
		const { video, zoom } = setUp();
		pinch(video, 500, 281, 1.6);
		const before = zoom.state.pan;
		pointer(video, 'pointerdown', 500, 281);
		pointer(video, 'pointermove', 400, 250);
		const moved = zoom.state.pan;
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		mainWindow.dispatchEvent(escape);
		pointer(video, 'pointermove', 300, 200);
		assert.deepStrictEqual({ moved: moved.x !== before.x, after: zoom.state.pan, prevented: escape.defaultPrevented }, { moved: true, after: before, prevented: true });
	});

	test('a smaller player keeps the zoom as far as it allows, and a small video does not zoom', () => {
		const { video, zoom, player, observer } = setUp();
		pinch(video, 800, 400, 1.5);
		const before = zoom.state;
		player.style.width = '500px';
		player.style.height = '281px';
		observer.fire();
		const after = zoom.state;
		zoom.dispose();
		const small = setUp(320, 180);
		pinch(small.video, 500, 281, 1.6);
		assert.deepStrictEqual({
			level: [round(before.zoom), round(after.zoom)],
			// The picture's middle moves half as far in a player half as wide.
			pan: round(after.pan.x / before.pan.x),
			small: small.zoom.state.zoom
		}, { level: [1.5, 1.5], pan: 0.5, small: 1 });
	});
});
