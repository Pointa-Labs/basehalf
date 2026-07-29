/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';

suite('BaseHalfCanvasCardPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses one preview presentation throughout ordinary zoom', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 1, false), 'preview');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.5, false), 'preview');
	});

	test('uses hysteresis around the unreadable far-view boundary', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.34, false, 'preview'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.4, false, 'shell'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.46, false, 'shell'), 'preview');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.4, false, 'preview'), 'preview');
	});

	test('keeps intrinsically short cards cheap and interactive cards available', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(70, 1, false, 'preview'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(90, 1, false, 'shell'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.2, true, 'shell'), 'interactive');
	});
});
