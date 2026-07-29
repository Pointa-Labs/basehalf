/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasMarkdownPreviewSource } from '../../common/basehalfCanvasPreview.js';

suite('BaseHalfCanvasPreview', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('preserves content beyond the old fixed visual line limit', () => {
		const source = Array.from({ length: 18 }, (_, index) => `paragraph ${index + 1}`).join('\n\n');

		assert.deepStrictEqual(baseHalfCanvasMarkdownPreviewSource(source).split('\n'), Array.from(
			{ length: 18 },
			(_, index) => `paragraph ${index + 1}`
		));
	});

	test('bounds preview work without using the guard as a visual line clamp', () => {
		const blocks = Array.from({ length: 205 }, (_, index) => `line ${index + 1}`).join('\n');
		const longLine = 'a'.repeat(5000);
		const blockPreview = baseHalfCanvasMarkdownPreviewSource(blocks).split('\n');
		const characterPreview = baseHalfCanvasMarkdownPreviewSource(longLine);

		assert.deepStrictEqual({
			blockCount: blockPreview.length,
			lastContentBlock: blockPreview.at(-2),
			blockSuffix: blockPreview.at(-1),
			characterCount: characterPreview.length,
			characterSuffix: characterPreview.slice(-3)
		}, {
			blockCount: 201,
			lastContentBlock: 'line 200',
			blockSuffix: '...',
			characterCount: 4096,
			characterSuffix: '...'
		});
	});
});
