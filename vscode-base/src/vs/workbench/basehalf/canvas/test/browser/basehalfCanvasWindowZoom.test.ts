/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfCanvasDrawnZoom,
	baseHalfCanvasDrawnZoomRange,
	baseHalfCanvasShownZoom,
	normalizeBaseHalfCanvasDrawnZoom
} from '../../browser/basehalfCanvasWindowZoom.js';

// Each part zooms by itself, rules 5 and 6: the canvas's zoom is the size of its cards on the screen, and the canvas
// library draws in the window's pixels.
suite('BaseHalf canvas zoom at a zoom of the window', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('at a window of 100% the canvas draws at its own zoom', () => {
		assert.deepStrictEqual([baseHalfCanvasShownZoom(0.5, 1), baseHalfCanvasDrawnZoom(0.5, 1), baseHalfCanvasDrawnZoomRange(1)], [0.5, 0.5, { min: 0.2, max: 4 }]);
	});

	test('a larger window draws the canvas at a smaller zoom, and the zoom shown stays the size on the screen', () => {
		assert.deepStrictEqual(
			[baseHalfCanvasDrawnZoom(1, 1.2), baseHalfCanvasShownZoom(baseHalfCanvasDrawnZoom(1, 1.2), 1.2), baseHalfCanvasDrawnZoom(0.8, 1.44), baseHalfCanvasShownZoom(baseHalfCanvasDrawnZoom(0.8, 1.44), 1.44)],
			[0.833333, 1, 0.555556, 0.8]
		);
	});

	test('the range of the canvas is 20% to 400% on the screen at every zoom of the window', () => {
		const range = baseHalfCanvasDrawnZoomRange(3);
		assert.deepStrictEqual(
			[baseHalfCanvasShownZoom(range.min, 3), baseHalfCanvasShownZoom(range.max, 3), baseHalfCanvasDrawnZoom(5, 3), baseHalfCanvasDrawnZoom(0.1, 1.2), normalizeBaseHalfCanvasDrawnZoom(0.1, 1.2)],
			[0.2, 4, 1.333333, 0.166667, 0.166667]
		);
	});

	test('a zoom of the window that no window has counts as 100%', () => {
		assert.deepStrictEqual([baseHalfCanvasDrawnZoom(1, 0), baseHalfCanvasShownZoom(0.5, Number.NaN), baseHalfCanvasShownZoom(Number.NaN, 1)], [1, 0.5, 1]);
	});

	test('a zoom the library drew at stays one the canvas reaches by its own steps', () => {
		// The library zooms by a pinch to any value: it comes back as the canvas's zoom with four decimals.
		assert.deepStrictEqual([normalizeBaseHalfCanvasDrawnZoom(0.7777777, 1.2), baseHalfCanvasShownZoom(normalizeBaseHalfCanvasDrawnZoom(0.7777777, 1.2), 1.2)], [0.77775, 0.9333]);
	});
});
