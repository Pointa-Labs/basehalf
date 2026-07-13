/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfPdfBranchBaseName, baseHalfPdfBranchMarkdown, baseHalfPdfBranchTitle } from '../../common/basehalfPdfBranch.js';

suite('BaseHalfPdfBranch', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives a safe, recognizable note filename', () => {
		assert.strictEqual(baseHalfPdfBranchBaseName('Learning Systems.pdf'), 'Learning Systems-note');
		assert.strictEqual(baseHalfPdfBranchBaseName('a/b:c?.PDF'), 'a-b-c--note');
		assert.strictEqual(baseHalfPdfBranchBaseName(`${'😀'.repeat(80)}.pdf`), `${'😀'.repeat(72)}-note`);
	});

	test('keeps selected PDF context in ordinary user-owned Markdown', () => {
		assert.strictEqual(baseHalfPdfBranchMarkdown('Learning Systems.pdf', {
			text: 'First line\n\nSecond line',
			pages: [2, 3]
		}), [
			'# First line Second line',
			'',
			'> First line',
			'>',
			'> Second line',
			'',
			'Source: [Learning Systems.pdf](./Learning%20Systems.pdf), pages 2, 3',
			''
		].join('\n'));
	});

	test('uses the selected idea as a concise, canvas-scannable title', () => {
		assert.strictEqual(baseHalfPdfBranchTitle('  A useful first idea. A second idea follows.  '), 'A useful first idea.');
		assert.strictEqual(baseHalfPdfBranchTitle('学习不是收藏资料，而是建立能够继续生长的问题地图。后面的内容不会进入标题。'), '学习不是收藏资料，而是建立能够继续生长的问题地图。');
		assert.strictEqual(baseHalfPdfBranchTitle('x'.repeat(80)), `${'x'.repeat(69)}…`);
	});

	test('escapes inline Markdown syntax in the generated heading', () => {
		assert.ok(baseHalfPdfBranchMarkdown('Course.pdf', {
			text: 'Use *retrieval* with [evidence].',
			pages: [1]
		}).startsWith('# Use \\*retrieval\\* with \\[evidence\\].\n'));
	});

	test('escapes filenames that would otherwise break Markdown links', () => {
		assert.ok(baseHalfPdfBranchMarkdown('Course (draft) [v2].pdf', {
			text: 'Passage',
			pages: [1]
		}).includes('Source: [Course (draft) \\[v2\\].pdf](./Course%20%28draft%29%20%5Bv2%5D.pdf), page 1'));
	});
});
