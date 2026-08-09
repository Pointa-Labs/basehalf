/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parseBaseHalfCanvasAppearance } from '../../common/basehalfCanvasAppearance.js';

suite('BaseHalfCanvasAppearance', () => {
	test('accepts the complete background preset contract', () => {
		for (const background of ['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const) {
			assert.strictEqual(parseBaseHalfCanvasAppearance(`background: ${background}\n`), background);
		}
	});

	test('accepts comments but rejects unknown or ambiguous metadata', () => {
		assert.strictEqual(parseBaseHalfCanvasAppearance('# card appearance\nbackground: blue\n'), 'blue');
		assert.throws(() => parseBaseHalfCanvasAppearance('background: pink\n'));
		assert.throws(() => parseBaseHalfCanvasAppearance('background: blue\nbackground: red\n'));
		assert.throws(() => parseBaseHalfCanvasAppearance('color: blue\n'));
	});
});
