/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfClampPicturePan,
	baseHalfContainedSize,
	baseHalfEdgeSeconds,
	baseHalfFitStretch,
	baseHalfIsWholeStretch,
	baseHalfMoveStretch,
	baseHalfPictureMaxZoom,
	baseHalfSpreadStretch,
	baseHalfStretchShowing,
	baseHalfStretchWheelSeconds,
	baseHalfZoomFactor,
	baseHalfZoomPanAround,
	IBaseHalfTimeStretch
} from '../../common/basehalfMediaZoom.js';

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundStretch = (stretch: IBaseHalfTimeStretch) => ({ from: round(stretch.from), to: round(stretch.to) });

suite('BaseHalfMediaZoom', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a pinch follows the fingers, and the wheel zooms by e^(−Δy / 500)', () => {
		// Fingers that spread to 1.6 times their distance: the browser's 25 events add up to −100 ln 1.6.
		let zoom = 1;
		for (let index = 0; index < 25; index++) {
			zoom *= baseHalfZoomFactor({ deltaY: -100 * Math.log(1.6) / 25, deltaMode: 0, ctrlKey: true });
		}
		assert.deepStrictEqual({
			pinch: round(zoom),
			notch: round(baseHalfZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })),
			lines: round(baseHalfZoomFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })),
			nothing: baseHalfZoomFactor({ deltaY: Number.NaN, deltaMode: 0, ctrlKey: true })
		}, { pinch: 1.6, notch: round(Math.exp(0.2)), lines: round(Math.exp(48 / 500)), nothing: 1 });
	});

	test('a picture zooms up to twice its pixels, and not at all when it fits larger', () => {
		assert.deepStrictEqual([0.5, 1, 1.27, 2, 3.4, 0, Number.NaN].map(scale => round(baseHalfPictureMaxZoom(scale))), [4, 2, 1.575, 1, 1, 1, 1]);
	});

	test('the point of the picture under the pointer stays under it', () => {
		// A picture point under the pointer: (at − pan) / zoom, before and after.
		const pan = { x: 40, y: -10 };
		const at = { x: 200, y: 100 };
		const zoom = 1.5;
		const next = baseHalfZoomPanAround(pan, at, 2);
		const before = { x: (at.x - pan.x) / zoom, y: (at.y - pan.y) / zoom };
		const after = { x: (at.x - next.x) / (zoom * 2), y: (at.y - next.y) / (zoom * 2) };
		assert.deepStrictEqual({ before: { x: round(before.x), y: round(before.y) }, after: { x: round(after.x), y: round(after.y) } }, { before: { x: round(before.x), y: round(before.y) }, after: { x: round(before.x), y: round(before.y) } });
	});

	test('a zoomed picture covers the view, and stays in its middle where it is smaller', () => {
		const view = { width: 1000, height: 560 };
		assert.deepStrictEqual([
			baseHalfClampPicturePan({ x: 900, y: -900 }, { width: 1600, height: 900 }, view),
			baseHalfClampPicturePan({ x: -120, y: 50 }, { width: 1600, height: 900 }, view),
			// Letterboxed: wider than the view, not taller.
			baseHalfClampPicturePan({ x: 80, y: 80 }, { width: 1200, height: 400 }, view)
		], [{ x: 300, y: -170 }, { x: -120, y: 50 }, { x: 80, y: 0 }]);
	});

	test('a picture is drawn as large as fits, its shape kept', () => {
		assert.deepStrictEqual([
			baseHalfContainedSize({ width: 854, height: 480 }, { width: 1082, height: 608 }),
			baseHalfContainedSize({ width: 854, height: 480 }, { width: 1440, height: 900 }),
			baseHalfContainedSize({ width: 0, height: 0 }, { width: 300, height: 200 })
		].map(size => ({ width: round(size.width), height: round(size.height) })), [{ width: 1081.733, height: 608 }, { width: 1440, height: 809.368 }, { width: 300, height: 200 }]);
	});

	test('a stretch spreads out around the pointer, no shorter than the shortest, inside the length', () => {
		const whole = { from: 0, to: 6 };
		const spread = baseHalfSpreadStretch(whole, 6, 0.5, 4, 0.5);
		const again = baseHalfSpreadStretch(spread, 6, 0.25, 100, 0.5);
		assert.deepStrictEqual({
			spread: roundStretch(spread),
			// The time under the pointer, a quarter in, stays a quarter in.
			again: roundStretch(again),
			timeKept: [round(spread.from + 0.25 * (spread.to - spread.from)), round(again.from + 0.25 * (again.to - again.from))],
			atTheEnd: roundStretch(baseHalfSpreadStretch(whole, 6, 1, 3, 0.5)),
			back: roundStretch(baseHalfSpreadStretch(spread, 6, 0.5, 0.2, 0.5)),
			shortLength: roundStretch(baseHalfSpreadStretch({ from: 0, to: 0.3 }, 0.3, 0.5, 4, 0.5))
		}, {
			spread: { from: 2.25, to: 3.75 },
			again: { from: 2.5, to: 3 },
			timeKept: [2.625, 2.625],
			atTheEnd: { from: 4, to: 6 },
			back: { from: 0, to: 6 },
			shortLength: { from: 0, to: 0.3 }
		});
	});

	test('a stretch moves along as far as the start and the end, and follows the playhead', () => {
		const stretch = { from: 2, to: 3 };
		assert.deepStrictEqual({
			moved: roundStretch(baseHalfMoveStretch(stretch, 6, 0.4)),
			past: roundStretch(baseHalfMoveStretch(stretch, 6, -5)),
			shown: roundStretch(baseHalfStretchShowing(stretch, 6, 2.5)),
			next: roundStretch(baseHalfStretchShowing(stretch, 6, 3.02)),
			atTheEnd: roundStretch(baseHalfStretchShowing(stretch, 6, 5.8)),
			back: roundStretch(baseHalfStretchShowing(stretch, 6, 0.5)),
			whole: [baseHalfIsWholeStretch({ from: 0, to: 6 }, 6), baseHalfIsWholeStretch(stretch, 6)]
		}, {
			moved: { from: 2.4, to: 3.4 },
			past: { from: 0, to: 1 },
			shown: { from: 2, to: 3 },
			next: { from: 3.02, to: 4.02 },
			atTheEnd: { from: 5, to: 6 },
			back: { from: 0.5, to: 1.5 },
			whole: [true, false]
		});
	});

	test('a stretch keeps its length through a cut, as far as the new length allows', () => {
		assert.deepStrictEqual([
			baseHalfFitStretch({ from: 4, to: 5 }, 4.5),
			baseHalfFitStretch({ from: 1, to: 2 }, 4.5),
			baseHalfFitStretch({ from: 0, to: 6 }, 4.5),
			baseHalfFitStretch({ from: 1, to: 4 }, 2)
		].map(roundStretch), [{ from: 3.5, to: 4.5 }, { from: 1, to: 2 }, { from: 0, to: 4.5 }, { from: 0, to: 2 }]);
	});

	test('the wheel moves a stretch by its larger delta, and an edge faster the farther past it', () => {
		assert.deepStrictEqual({
			sideways: round(baseHalfStretchWheelSeconds({ deltaX: 50, deltaY: 4, deltaMode: 0, ctrlKey: false }, 2, 1000)),
			upDown: round(baseHalfStretchWheelSeconds({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false }, 2, 1000)),
			noWidth: baseHalfStretchWheelSeconds({ deltaX: 50, deltaY: 0, deltaMode: 0, ctrlKey: false }, 2, 0),
			edge: round(baseHalfEdgeSeconds(50, 2, 16)),
			start: round(baseHalfEdgeSeconds(-50, 2, 16)),
			fastest: round(baseHalfEdgeSeconds(5000, 2, 1000))
		}, { sideways: 0.1, upDown: -0.2, noWidth: 0, edge: 0.016, start: -0.016, fastest: 8 });
	});
});
