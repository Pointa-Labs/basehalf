/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfCanvasMarkdownEditTarget,
	baseHalfCanvasMarkdownPreviewSource,
	baseHalfCanvasMarkdownSourceFitsInline,
	BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES
} from '../../common/basehalfCanvasPreview.js';

suite('BaseHalfCanvasPreview', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('preserves Markdown whitespace and line endings exactly', () => {
		const source = '# heading\r\n\r\nline with tab\tand hard break  \r\n\r\n';
		assert.strictEqual(baseHalfCanvasMarkdownPreviewSource(source), source);
	});

	test('does not summarize long Markdown documents', () => {
		const blocks = Array.from({ length: 205 }, (_, index) => `line ${index + 1}`).join('\n');
		const longLine = 'a'.repeat(5000);

		assert.strictEqual(baseHalfCanvasMarkdownPreviewSource(blocks), blocks);
		assert.strictEqual(baseHalfCanvasMarkdownPreviewSource(longLine), longLine);
	});

	test('admits inline editing only for a complete projection within the byte gate', () => {
		assert.strictEqual(BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES, 8192);
		assert.strictEqual(baseHalfCanvasMarkdownEditTarget(8192, true), 'inline');
		assert.strictEqual(baseHalfCanvasMarkdownEditTarget(8193, true), 'richDetail');
		assert.strictEqual(baseHalfCanvasMarkdownEditTarget(8192, false), 'richDetail');
		assert.strictEqual(baseHalfCanvasMarkdownEditTarget(undefined, true), 'inline');
	});

	test('measures a live Markdown source with the same UTF-8 byte boundary', () => {
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('a'.repeat(8192)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('a'.repeat(8193)), false);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('春'.repeat(2730)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('春'.repeat(2731)), false);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('😀'.repeat(2048)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline(`${'😀'.repeat(2048)}a`), false);
	});
});
