/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_NOTE_ZOOM_MAX,
	BASEHALF_NOTE_ZOOM_MIN,
	baseHalfNoteZoomFactor,
	clampBaseHalfNoteZoom,
	baseHalfPagePinchFromMessage,
	BASEHALF_PAGE_PINCH_MESSAGE,
	isBaseHalfNoteZoomWheel,
	normalizeBaseHalfNoteZoom,
	settleBaseHalfNoteZoom
} from '../../common/basehalfNoteZoom.js';

suite('BaseHalfNoteZoom', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const keys = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

	test('a pinch, and the wheel with the zoom key or Ctrl held, zoom the note', () => {
		assert.strictEqual(isBaseHalfNoteZoomWheel({ ...keys, ctrlKey: true }, true), true);
		assert.strictEqual(isBaseHalfNoteZoomWheel({ ...keys, metaKey: true }, true), true);
		assert.strictEqual(isBaseHalfNoteZoomWheel({ ...keys, ctrlKey: true }, false), true);
		assert.strictEqual(isBaseHalfNoteZoomWheel({ ...keys, metaKey: true }, false), false);
		assert.strictEqual(isBaseHalfNoteZoomWheel(keys, true), false);
		assert.strictEqual(isBaseHalfNoteZoomWheel({ ...keys, ctrlKey: true, shiftKey: true }, true), false);
		assert.strictEqual(isBaseHalfNoteZoomWheel({ ...keys, metaKey: true, altKey: true }, true), false);
	});

	test('the level follows the fingers, and a notch of a wheel is at most a step of 10%', () => {
		// Fingers that spread to 1.5 times their distance: the browser's events add up to −100 ln 1.5.
		const steps = 20;
		const deltaY = -100 * Math.log(1.5) / steps;
		let level = 1;
		for (let index = 0; index < steps; index++) {
			level *= baseHalfNoteZoomFactor({ deltaY, deltaMode: 0 });
		}
		assert.ok(Math.abs(level - 1.5) < 1e-9, String(level));

		assert.ok(Math.abs(baseHalfNoteZoomFactor({ deltaY: -100, deltaMode: 0 }) - Math.exp(0.1)) < 1e-12);
		assert.ok(Math.abs(baseHalfNoteZoomFactor({ deltaY: 3, deltaMode: 1 }) - Math.exp(-0.1)) < 1e-12);
		assert.ok(Math.abs(baseHalfNoteZoomFactor({ deltaY: -1, deltaMode: 2 }) - Math.exp(0.1)) < 1e-12);
		assert.strictEqual(baseHalfNoteZoomFactor({ deltaY: Number.NaN, deltaMode: 0 }), 1);
	});

	test('the level stays between 50% and 300%, and a gesture that ends near 100% ends there', () => {
		assert.strictEqual(clampBaseHalfNoteZoom(0.1), BASEHALF_NOTE_ZOOM_MIN);
		assert.strictEqual(clampBaseHalfNoteZoom(9), BASEHALF_NOTE_ZOOM_MAX);
		assert.strictEqual(clampBaseHalfNoteZoom(Number.NaN), 1);
		assert.strictEqual(settleBaseHalfNoteZoom(1.03), 1);
		assert.strictEqual(settleBaseHalfNoteZoom(0.95), 1);
		assert.strictEqual(settleBaseHalfNoteZoom(1.07), 1.07);
		assert.strictEqual(settleBaseHalfNoteZoom(0.2), 0.5);
	});

	test('a pinch handed to a page of Card Detail carries its event and its point, and nothing else', () => {
		assert.deepStrictEqual(baseHalfPagePinchFromMessage({ type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: -2.4, deltaMode: 0, x: 10, y: 20, extra: true }), { type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: -2.4, deltaMode: 0, x: 10, y: 20 });
		assert.strictEqual(baseHalfPagePinchFromMessage({ type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: Number.NaN, deltaMode: 0, x: 0, y: 0 }), undefined);
		assert.strictEqual(baseHalfPagePinchFromMessage({ type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: 1, deltaMode: 4, x: 0, y: 0 }), undefined);
		assert.strictEqual(baseHalfPagePinchFromMessage({ type: 'basehalf.pdf.viewState', deltaY: 1, deltaMode: 0, x: 0, y: 0 }), undefined);
		assert.strictEqual(baseHalfPagePinchFromMessage(undefined), undefined);
	});

	test('a level read from storage that is no level is 100%', () => {
		assert.strictEqual(normalizeBaseHalfNoteZoom(1.5), 1.5);
		// The storage keeps text: a number is read back from it.
		assert.strictEqual(normalizeBaseHalfNoteZoom('1.5'), 1.5);
		assert.strictEqual(normalizeBaseHalfNoteZoom(undefined), 1);
		assert.strictEqual(normalizeBaseHalfNoteZoom(''), 1);
		assert.strictEqual(normalizeBaseHalfNoteZoom('large'), 1);
		assert.strictEqual(normalizeBaseHalfNoteZoom(4), 1);
		assert.strictEqual(normalizeBaseHalfNoteZoom(0.2), 1);
	});
});
