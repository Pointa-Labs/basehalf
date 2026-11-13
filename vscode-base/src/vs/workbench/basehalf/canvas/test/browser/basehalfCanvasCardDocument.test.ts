/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfCanvasCoverFillsCard } from '../../browser/basehalfCanvasCardDocument.js';

suite('BaseHalfCanvasCardDocument', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a cover near 3:4 is the card, cut to its shape, and a cover of another shape is shown whole', () => {
		const covers = { '3:4': [600, 800], 'A4': [595, 842], 'Letter': [612, 792], '2:3 book': [600, 900], 'Legal': [612, 1008], 'square': [800, 800], 'slides': [1600, 900], 'none': [0, 0] } as const;
		assert.deepStrictEqual(Object.fromEntries(Object.entries(covers).map(([name, [width, height]]) => [name, baseHalfCanvasCoverFillsCard(width, height)])), {
			'3:4': true,
			'A4': true,
			'Letter': true,
			'2:3 book': true,
			'Legal': false,
			'square': false,
			'slides': false,
			'none': false
		});
	});
});
