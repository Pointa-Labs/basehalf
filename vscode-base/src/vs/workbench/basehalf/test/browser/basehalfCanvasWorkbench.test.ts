/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasRetainedCardChromeIsStale } from '../../browser/basehalfCanvasWorkbench.contribution.js';

suite('BaseHalfCanvasWorkbench', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('invalidates retained Note chrome only when its visual key changed', () => {
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'updated'), true);
		assert.strictEqual(baseHalfCanvasRetainedCardChromeIsStale('original', 'original'), false);
	});
});
