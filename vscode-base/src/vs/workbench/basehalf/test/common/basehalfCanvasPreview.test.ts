/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasMarkdownPreviewSource } from '../../common/basehalfCanvasPreview.js';

suite('BaseHalfCanvasPreview', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses one fixed block budget for the static preview', () => {
		const source = Array.from({ length: 18 }, (_, index) => `paragraph ${index + 1}`).join('\n\n');
		const preview = baseHalfCanvasMarkdownPreviewSource(source);

		assert.strictEqual(preview, `${Array.from({ length: 15 }, (_, index) => `paragraph ${index + 1}`).join('\n\n')}\n\n...`);
	});

	test('bounds preview work by block and character count', () => {
		const blocks = Array.from({ length: 205 }, (_, index) => `line ${index + 1}`).join('\n');
		const longLine = 'a'.repeat(5000);
		const blockPreview = baseHalfCanvasMarkdownPreviewSource(blocks).split('\n');
		const characterPreview = baseHalfCanvasMarkdownPreviewSource(longLine);

		assert.deepStrictEqual({
			contentBlockCount: blockPreview.filter(line => line.length > 0).length,
			lastContentBlock: blockPreview.at(-3),
			blockSuffix: blockPreview.at(-1),
			characterCount: characterPreview.length,
			characterSuffix: characterPreview.slice(-3)
		}, {
			contentBlockCount: 16,
			lastContentBlock: 'line 15',
			blockSuffix: '...',
			characterCount: 4096,
			characterSuffix: '...'
		});
	});
});
