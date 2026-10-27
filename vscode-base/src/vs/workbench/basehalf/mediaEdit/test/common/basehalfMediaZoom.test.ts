/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_PAGE_AT_REST,
	baseHalfClampPageZoom,
	baseHalfContainedSize,
	baseHalfEdgeSeconds,
	baseHalfFitStretch,
	baseHalfIsWholeStretch,
	baseHalfMovePage,
	baseHalfMoveStretch,
	baseHalfPagePoint,
	baseHalfPictureMaxZoom,
	baseHalfSpreadStretch,
	baseHalfStretchShowing,
	baseHalfStretchWheelSeconds,
	baseHalfWheelMove,
	baseHalfZoomPageAround,
	IBaseHalfTimeStretch
} from '../../common/basehalfMediaZoom.js';

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundStretch = (stretch: IBaseHalfTimeStretch) => ({ from: round(stretch.from), to: round(stretch.to) });

suite('BaseHalfMediaZoom', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a picture zooms up to 5 times as it fits, as a page does, or to twice its pixels when that is more', () => {
		assert.deepStrictEqual([0.1, 0.25, 0.5, 1, 1.27, 2, 3.4, 0, Number.NaN].map(scale => round(baseHalfPictureMaxZoom(scale))), [20, 8, 5, 5, 5, 5, 5, 5, 5]);
	});

	test('a media area zooms around a point as a browser zooms its page: what is under the point stays under it', () => {
		const area = { width: 1400, height: 900 };
		const at = { x: 500, y: 300 };
		const once = baseHalfZoomPageAround(BASEHALF_PAGE_AT_REST, at, 1.6, 5, area);
		const twice = baseHalfZoomPageAround(once, at, 2, 5, area);
		// The point of the area at rest that is under the pointer: (at − origin) / zoom.
		const under = (page: typeof once) => ({ x: round((at.x - page.origin.x) / page.zoom), y: round((at.y - page.origin.y) / page.zoom) });
		assert.deepStrictEqual({ once: under(once), twice: under(twice), zoom: [round(once.zoom), round(twice.zoom)], capped: baseHalfZoomPageAround(twice, at, 4, 5, area).zoom }, {
			once: { x: 500, y: 300 }, twice: { x: 500, y: 300 }, zoom: [1.6, 3.2], capped: 5
		});
	});

	test('the zoomed area is never moved off itself, and as it fits it does not move at all', () => {
		const area = { width: 1000, height: 600 };
		const zoomed = { zoom: 2, origin: { x: -500, y: -300 } };
		assert.deepStrictEqual([
			baseHalfMovePage(zoomed, { x: 800, y: 50 }, area).origin,
			baseHalfMovePage(zoomed, { x: -800, y: -400 }, area).origin,
			baseHalfClampPageZoom({ zoom: 1, origin: { x: 40, y: -40 } }, area),
			baseHalfClampPageZoom({ zoom: 0.5, origin: { x: 0, y: 0 } }, area).zoom
		], [{ x: 0, y: -250 }, { x: -1000, y: -600 }, { zoom: 1, origin: { x: 0, y: 0 } }, 1]);
	});

	test('a swipe moves what is zoomed with the fingers, in pixels, lines, or pages', () => {
		assert.deepStrictEqual([
			baseHalfWheelMove({ deltaX: 30, deltaY: -12, deltaMode: 0, ctrlKey: false }),
			baseHalfWheelMove({ deltaY: 3, deltaMode: 1, ctrlKey: false }),
			baseHalfPagePoint({ zoom: 2, origin: { x: -100, y: -40 } }, { x: 300, y: 200 })
		], [{ x: -30, y: 12 }, { x: -0, y: -48 }, { x: 500, y: 360 }]);
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
