/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfMoveStripWithWheel, baseHalfRevealInStrip } from '../../browser/basehalfSidewaysStrip.js';

suite('BaseHalfSidewaysStrip', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let strip: HTMLElement;

	/** A strip of 100 pixels with `count` elements of 60 pixels each. */
	function createStrip(count: number): HTMLElement[] {
		strip = mainWindow.document.createElement('div');
		strip.style.cssText = 'position: fixed; left: 0; top: 0; width: 100px; height: 20px; display: flex; overflow-x: auto; overflow-y: hidden; scrollbar-width: none;';
		const elements: HTMLElement[] = [];
		for (let index = 0; index < count; index++) {
			const element = mainWindow.document.createElement('div');
			element.style.cssText = 'flex: 0 0 60px; height: 20px;';
			elements.push(strip.appendChild(element));
		}
		mainWindow.document.body.appendChild(strip);
		return elements;
	}

	/** Turns the wheel over the strip, and says where the strip is then and whether it took the event. */
	function wheel(delta: { readonly deltaX?: number; readonly deltaY?: number }): { readonly scrollLeft: number; readonly taken: boolean } {
		const event = new mainWindow.WheelEvent('wheel', { ...delta, bubbles: true, cancelable: true });
		strip.dispatchEvent(event);
		return { scrollLeft: strip.scrollLeft, taken: event.defaultPrevented };
	}

	teardown(() => strip.remove());

	test('a wheel turned up and down moves a strip with more than it shows sideways, and no other wheel or strip', () => {
		createStrip(3);
		store.add(baseHalfMoveStripWithWheel(strip, () => strip));
		const down = wheel({ deltaY: 30 });
		const sideways = wheel({ deltaX: 10, deltaY: 2 });
		const up = wheel({ deltaY: -100 });
		strip.remove();
		createStrip(1);
		store.add(baseHalfMoveStripWithWheel(strip, () => strip));
		assert.deepStrictEqual({ down, sideways, up, nothingCutOff: wheel({ deltaY: 30 }) }, {
			down: { scrollLeft: 30, taken: true },
			sideways: { scrollLeft: 30, taken: false },
			up: { scrollLeft: 0, taken: true },
			nothingCutOff: { scrollLeft: 0, taken: false },
		});
	});

	test('an element comes into view by as little as shows the whole of it, and by its start in a strip narrower than it', () => {
		const [first, second, third, fourth] = createStrip(4);
		const places: number[] = [];
		for (const element of [second, fourth, third, first, first]) {
			baseHalfRevealInStrip(strip, element);
			places.push(strip.scrollLeft);
		}
		strip.style.width = '50px';
		baseHalfRevealInStrip(strip, second);
		// Each comes in from the side it is cut off at, and one that is in view moves nothing.
		assert.deepStrictEqual({ places, inNarrowStrip: strip.scrollLeft }, { places: [20, 140, 120, 0, 0], inNarrowStrip: 60 });
	});
});
