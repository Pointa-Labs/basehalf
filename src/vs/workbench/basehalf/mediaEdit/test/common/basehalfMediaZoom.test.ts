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
	baseHalfPageZoomToward,
	baseHalfPictureMaxZoom,
	baseHalfSpreadStretch,
	baseHalfStretchShowing,
	baseHalfStretchWheelSeconds,
	baseHalfWheelMove,
	baseHalfZoomPageAround,
	baseHalfZoomPageFollowing,
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
		const picture = { x: 100, y: 50, width: 1200, height: 675 };
		const at = { x: 500, y: 300 };
		const once = baseHalfZoomPageAround(BASEHALF_PAGE_AT_REST, at, 1.6, 5, area, picture);
		const twice = baseHalfZoomPageAround(once, at, 2, 5, area, picture);
		// The point of the area at rest that is under the pointer: (at − origin) / zoom.
		const under = (page: typeof once) => ({ x: round((at.x - page.origin.x) / page.zoom), y: round((at.y - page.origin.y) / page.zoom) });
		assert.deepStrictEqual({ once: under(once), twice: under(twice), zoom: [round(once.zoom), round(twice.zoom)], capped: baseHalfZoomPageAround(twice, at, 4, 5, area, picture).zoom }, {
			once: { x: 500, y: 300 }, twice: { x: 500, y: 300 }, zoom: [1.6, 3.2], capped: 5
		});
	});

	test('a zoomed picture moves within its own edges, not along a side where it is no larger than the area, and as it fits not at all (D101)', () => {
		const area = { width: 1000, height: 600 };
		// A 16:9 picture with room around it, and a portrait one as tall as the area.
		const wide = { x: 100, y: 50, width: 800, height: 450 };
		const tall = { x: 300, y: 0, width: 400, height: 600 };
		const zoomed = { zoom: 2, origin: { x: -500, y: -300 } };
		const origin = (page: { readonly origin: { readonly x: number; readonly y: number } }) => ({ x: round(page.origin.x), y: round(page.origin.y) });
		assert.deepStrictEqual({
			// Its left edge stops at the area's left edge, its right edge at the right one.
			towardBottomRight: origin(baseHalfMovePage(zoomed, { x: 800, y: 50 }, area, wide)),
			towardTopLeft: origin(baseHalfMovePage(zoomed, { x: -800, y: -400 }, area, wide)),
			// No larger than the area: a drag moves it neither way.
			smaller: origin(baseHalfMovePage({ zoom: 1.1, origin: { x: 0, y: 0 } }, { x: 300, y: 300 }, area, wide)),
			// As wide as half the area, it does not move sideways; as tall as twice the area, it moves up and down.
			portrait: origin(baseHalfMovePage(zoomed, { x: 500, y: -100 }, area, tall)),
			atRest: baseHalfClampPageZoom({ zoom: 1, origin: { x: 40, y: -40 } }, area, wide),
			below: baseHalfClampPageZoom({ zoom: 0.5, origin: { x: 0, y: 0 } }, area, wide).zoom
		}, {
			towardBottomRight: { x: -200, y: -250 },
			towardTopLeft: { x: -800, y: -400 },
			smaller: { x: 0, y: 0 },
			portrait: { x: -500, y: -400 },
			atRest: { zoom: 1, origin: { x: 0, y: 0 } },
			below: 1
		});
	});

	test('a pinch follows the fingers past the picture\'s edges and settles within them; a zoom at once keeps within them; as it fits the picture rests (D96, D101)', () => {
		const area = { width: 1000, height: 600 };
		const wide = { x: 100, y: 50, width: 800, height: 450 };
		const corner = { x: 900, y: 100 };
		const origin = (page: { readonly origin: { readonly x: number; readonly y: number } }) => ({ x: round(page.origin.x), y: round(page.origin.y) });
		const following = baseHalfZoomPageFollowing(BASEHALF_PAGE_AT_REST, corner, 1.2, 5);
		const atOnce = baseHalfZoomPageAround(BASEHALF_PAGE_AT_REST, corner, 1.2, 5, area, wide);
		assert.deepStrictEqual({
			// What is under the fingers stays under them, though the picture's left edge goes past the area's.
			following: origin(following),
			settled: origin(baseHalfClampPageZoom(following, area, wide)),
			atOnce: origin(atOnce),
			fits: baseHalfZoomPageAround(atOnce, corner, 1 / 1.2, 5, area, wide)
		}, {
			following: { x: -180, y: -20 },
			settled: { x: -120, y: -20 },
			atOnce: { x: -120, y: -20 },
			fits: BASEHALF_PAGE_AT_REST
		});
	});

	test('Edit glides a zoom back to as it fits, every step between the two', () => {
		const from = { zoom: 3, origin: { x: -600, y: -200 } };
		assert.deepStrictEqual([0, 0.5, 1, 2].map(progress => baseHalfPageZoomToward(from, BASEHALF_PAGE_AT_REST, progress)), [
			from,
			{ zoom: 2, origin: { x: -300, y: -100 } },
			{ zoom: 1, origin: { x: 0, y: 0 } },
			{ zoom: 1, origin: { x: 0, y: 0 } }
		]);
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
