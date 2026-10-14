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
	baseHalfCanvasMarkdownSourceFitsShown,
	BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES,
	BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES,
	planBaseHalfCanvasNoteParts
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

	test('admits inline editing only for a shown note within the editor\'s byte gate', () => {
		const note = '# Note\n';
		assert.deepStrictEqual({
			limit: BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES,
			atLimit: baseHalfCanvasMarkdownEditTarget(65_536, note),
			aboveLimit: baseHalfCanvasMarkdownEditTarget(65_537, note),
			notShown: baseHalfCanvasMarkdownEditTarget(65_536, undefined),
			unknownSize: baseHalfCanvasMarkdownEditTarget(undefined, note),
			unknownSizeOfALongNote: baseHalfCanvasMarkdownEditTarget(undefined, 'a'.repeat(65_537))
		}, {
			limit: 65_536,
			atLimit: 'inline',
			aboveLimit: 'richDetail',
			notShown: 'richDetail',
			unknownSize: 'inline',
			unknownSizeOfALongNote: 'richDetail'
		});
	});

	test('measures a live Markdown source with the same UTF-8 byte boundaries', () => {
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('a'.repeat(65_536)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('a'.repeat(65_537)), false);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('春'.repeat(21_845)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('春'.repeat(21_846)), false);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline('😀'.repeat(16_384)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsInline(`${'😀'.repeat(16_384)}a`), false);
		assert.strictEqual(BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES, 1_048_576);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsShown('a'.repeat(1_048_576)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsShown('a'.repeat(1_048_577)), false);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsShown('春'.repeat(349_525)), true);
		assert.strictEqual(baseHalfCanvasMarkdownSourceFitsShown('春'.repeat(349_526)), false);
	});

	suite('parts of a note', () => {
		test('are runs of whole blocks that join to the note', () => {
			const body = '# A\n\none two\n\nthree four\n\n- x\n- y\n';
			assert.deepStrictEqual(planBaseHalfCanvasNoteParts(body, 10), {
				parts: ['# A\n\none two\n\n', 'three four\n\n', '- x\n- y\n'],
				definitions: ''
			});
		});

		test('never end inside an HTML element that a block opens and a later block closes', () => {
			const details = '<details>\n<summary>More</summary>\n\nHidden **text**.\n\nMore hidden.\n\n</details>\n\n';
			assert.deepStrictEqual(planBaseHalfCanvasNoteParts(`${details}After.\n`, 1)?.parts, [details, 'After.\n']);
			// A block whose elements close within it, and a void element, hold nothing open.
			assert.deepStrictEqual(planBaseHalfCanvasNoteParts('<div>a</div>\n\n<br>\n\npara\n', 1)?.parts, ['<div>a</div>\n\n', '<br>\n\n', 'para\n']);
		});

		test('end an element that stays open for 50,000 characters anyway', () => {
			const paragraph = `${'word '.repeat(199)}word\n\n`;
			const body = `<div>\n\n${paragraph.repeat(60)}</div>\n`;
			const plan = planBaseHalfCanvasNoteParts(body, 1)!;
			assert.deepStrictEqual({
				joined: plan.parts.join('') === body,
				firstLength: plan.parts[0].length >= 50_000 && plan.parts[0].length < 50_000 + paragraph.length
			}, { joined: true, firstLength: true });
		});

		test('stay within what the renderer of the base shows, with the definitions of the note', () => {
			const body = `[a][x]\n\n${'A short paragraph of a long note.\n\n'.repeat(6000)}[x]: https://example.com\n`;
			const plan = planBaseHalfCanvasNoteParts(body, 1_000_000)!;
			assert.deepStrictEqual({
				joined: plan.parts.join('') === body,
				definitions: plan.definitions,
				fit: plan.parts.every(part => part.length + plan.definitions.length + 2 <= 100_000),
				several: plan.parts.length > 1
			}, { joined: true, definitions: '[x]: https://example.com', fit: true, several: true });
		});

		test('cannot hold a single block that the renderer would cut', () => {
			assert.strictEqual(planBaseHalfCanvasNoteParts('a'.repeat(90_001)), undefined);
			assert.deepStrictEqual(planBaseHalfCanvasNoteParts('a'.repeat(90_000))?.parts.length, 1);
		});
	});
});
