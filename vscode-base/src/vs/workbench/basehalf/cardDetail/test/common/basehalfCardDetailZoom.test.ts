/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfPagePinchFromMessage, BASEHALF_PAGE_PINCH_MESSAGE, baseHalfZoomFactor, isBaseHalfZoomWheel } from '../../common/basehalfCardDetailZoom.js';

suite('BaseHalfCardDetailZoom', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const keys = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

	test('a pinch, and the wheel with the zoom key or Ctrl held, zoom', () => {
		assert.deepStrictEqual([
			isBaseHalfZoomWheel({ ...keys, ctrlKey: true }, true),
			isBaseHalfZoomWheel({ ...keys, metaKey: true }, true),
			isBaseHalfZoomWheel({ ...keys, ctrlKey: true }, false),
			isBaseHalfZoomWheel({ ...keys, metaKey: true }, false),
			isBaseHalfZoomWheel(keys, true),
			isBaseHalfZoomWheel({ ...keys, ctrlKey: true, shiftKey: true }, true),
			isBaseHalfZoomWheel({ ...keys, metaKey: true, altKey: true }, true),
		], [true, true, true, false, false, false, false]);
	});

	test('a zoom follows the fingers, and a notch of a wheel is at most a step of 10%', () => {
		// Fingers that spread to 1.5 times their distance: the browser's events add up to −100 ln 1.5.
		const steps = 20;
		const deltaY = -100 * Math.log(1.5) / steps;
		let level = 1;
		for (let index = 0; index < steps; index++) {
			level *= baseHalfZoomFactor({ deltaY, deltaMode: 0 });
		}
		assert.ok(Math.abs(level - 1.5) < 1e-9, String(level));

		assert.ok(Math.abs(baseHalfZoomFactor({ deltaY: -100, deltaMode: 0 }) - Math.exp(0.1)) < 1e-12);
		assert.ok(Math.abs(baseHalfZoomFactor({ deltaY: 3, deltaMode: 1 }) - Math.exp(-0.1)) < 1e-12);
		assert.ok(Math.abs(baseHalfZoomFactor({ deltaY: -1, deltaMode: 2 }) - Math.exp(0.1)) < 1e-12);
		assert.strictEqual(baseHalfZoomFactor({ deltaY: Number.NaN, deltaMode: 0 }), 1);
	});

	test('a pinch handed to a page of Card Detail carries its event and its point, and nothing else', () => {
		assert.deepStrictEqual(baseHalfPagePinchFromMessage({ type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: -2.4, deltaMode: 0, x: 10, y: 20, extra: true }), { type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: -2.4, deltaMode: 0, x: 10, y: 20 });
		assert.strictEqual(baseHalfPagePinchFromMessage({ type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: Number.NaN, deltaMode: 0, x: 0, y: 0 }), undefined);
		assert.strictEqual(baseHalfPagePinchFromMessage({ type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: 1, deltaMode: 4, x: 0, y: 0 }), undefined);
		assert.strictEqual(baseHalfPagePinchFromMessage({ type: 'basehalf.pdf.viewState', deltaY: 1, deltaMode: 0, x: 0, y: 0 }), undefined);
		assert.strictEqual(baseHalfPagePinchFromMessage(undefined), undefined);
	});
});
