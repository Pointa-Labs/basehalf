/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { baseHalfCanvasCardLod } from '../../common/basehalfCanvasCardLod.js';

suite('BaseHalfCanvasCardLod', () => {
	test('keeps full previews only at readable size and zoom', () => {
		assert.strictEqual(baseHalfCanvasCardLod(220, 1), 'full');
		assert.strictEqual(baseHalfCanvasCardLod(150, 0.85), 'full');
		assert.strictEqual(baseHalfCanvasCardLod(149, 1), 'summary');
		assert.strictEqual(baseHalfCanvasCardLod(220, 0.84), 'summary');
	});

	test('uses summary at ordinary fitted zoom and mini only when pulled far back', () => {
		assert.strictEqual(baseHalfCanvasCardLod(220, 0.75), 'summary');
		assert.strictEqual(baseHalfCanvasCardLod(96, 1), 'summary');
		assert.strictEqual(baseHalfCanvasCardLod(95, 1), 'mini');
		assert.strictEqual(baseHalfCanvasCardLod(220, 0.54), 'mini');
	});
});
