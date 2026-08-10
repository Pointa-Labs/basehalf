/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	collectBaseHalfCanvasMarkdownReferenceDefinitions,
	computeBaseHalfCanvasMarkdownTextEdit,
	renderBaseHalfCanvasStoredMarkdown,
	renderBaseHalfCanvasStoredMarkdownBody,
	transformBaseHalfCanvasMarkdownOffset
} from '../../browser/cardDetail/basehalfCanvasMarkdownInlineEditor.js';

suite('BaseHalfCanvasMarkdownInlineEditor', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('relocates the live Markdown body across external changes with boundary affinity', () => {
		const replaceBefore = [{ rangeOffset: 1, rangeLength: 2, text: 'LONG' }];
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(3, replaceBefore, 'before'), 5);
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(6, replaceBefore, 'after'), 8);

		const insertAtBoundary = [{ rangeOffset: 3, rangeLength: 0, text: 'X' }];
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(3, insertAtBoundary, 'before'), 3);
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(3, insertAtBoundary, 'after'), 4);
	});

	test('reduces a document update to its smallest TextModel edit', () => {
		assert.deepStrictEqual(
			computeBaseHalfCanvasMarkdownTextEdit('first\n\nsecond\n', 'first changed\n\nsecond\n'),
			{ offset: 5, length: 0, text: ' changed' }
		);
		assert.deepStrictEqual(
			computeBaseHalfCanvasMarkdownTextEdit('first\r\n\r\nsecond', 'first\r\nsecond'),
			{ offset: 7, length: 2, text: '' }
		);
		assert.deepStrictEqual(
			computeBaseHalfCanvasMarkdownTextEdit('重复重复', '重复新重复'),
			{ offset: 2, length: 0, text: '新' }
		);
		assert.strictEqual(computeBaseHalfCanvasMarkdownTextEdit('same', 'same'), undefined);
	});

	test('collects reference definitions without escaping a real code fence', () => {
		assert.strictEqual(
			collectBaseHalfCanvasMarkdownReferenceDefinitions('[guide]: docs/guide.md\n  "Guide"\n\n[text][guide]'),
			'[guide]: docs/guide.md\n  "Guide"'
		);
		assert.strictEqual(collectBaseHalfCanvasMarkdownReferenceDefinitions([
			'```ts',
			'```not-a-close',
			'[fake]: inside-code',
			'```',
			'',
			'[text][fake]'
		].join('\n')), '');
	});

	test('stored Markdown rendering never completes malformed emphasis', () => {
		const source = '春风吹过，城中的草木却长得异常茂盛**，';
		const unit = document.createElement('div');
		const rendering = renderBaseHalfCanvasStoredMarkdown(unit, URI.file('/notes/test.md'), source);
		try {
			assert.strictEqual(unit.textContent, source);
			assert.strictEqual(unit.textContent?.endsWith('**，******'), false);
		} finally {
			rendering.dispose();
		}
	});

	test('resting Markdown renders the same frontmatter-free body as inline editing', () => {
		const source = '---\r\ntitle: Hidden metadata\r\ntags:\r\n  - test\r\n---\r\n# Visible body\r\n\r\nBody text  \r\n';
		const before = source;
		const unit = document.createElement('div');
		const rendering = renderBaseHalfCanvasStoredMarkdownBody(unit, URI.file('/notes/frontmatter.md'), source);
		try {
			assert.strictEqual(unit.textContent?.includes('Hidden metadata'), false);
			assert.strictEqual(unit.textContent?.includes('Visible body'), true);
			assert.strictEqual(unit.textContent?.includes('Body text'), true);
			assert.strictEqual(source, before);
		} finally {
			rendering.dispose();
		}
	});

	test('frontmatter-only Markdown has an empty shared body projection', () => {
		const unit = document.createElement('div');
		const rendering = renderBaseHalfCanvasStoredMarkdownBody(
			unit,
			URI.file('/notes/metadata-only.md'),
			'---\ntitle: Hidden metadata\n---\n'
		);
		try {
			assert.strictEqual(unit.textContent, '');
		} finally {
			rendering.dispose();
		}
	});
});
