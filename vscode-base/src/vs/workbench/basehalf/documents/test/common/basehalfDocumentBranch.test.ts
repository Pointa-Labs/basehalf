/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfDocumentBranchBaseName, baseHalfDocumentBranchMarkdown, baseHalfDocumentBranchTitle } from '../../common/basehalfDocumentBranch.js';
import { readBaseHalfMarkdownUpstream } from '../../../references/common/basehalfReferenceStore.js';

suite('BaseHalfDocumentBranch', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives a safe, recognizable note filename', () => {
		assert.deepStrictEqual([
			baseHalfDocumentBranchBaseName('Learning Systems.pdf'),
			baseHalfDocumentBranchBaseName('a/b:c?.PDF'),
			baseHalfDocumentBranchBaseName(`${'😀'.repeat(80)}.pdf`),
			baseHalfDocumentBranchBaseName('Structure and Interpretation.epub'),
			baseHalfDocumentBranchBaseName('西游记.AZW3'),
			baseHalfDocumentBranchBaseName('.epub')
		], [
			'Learning Systems-note',
			'a-b-c--note',
			`${'😀'.repeat(72)}-note`,
			'Structure and Interpretation-note',
			'西游记-note',
			'document-note'
		]);
	});

	test('keeps selected PDF context in ordinary user-owned Markdown', () => {
		assert.strictEqual(baseHalfDocumentBranchMarkdown('Learning Systems.pdf', {
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

	test('names the chapter of a passage from a book, and nothing without one', () => {
		assert.deepStrictEqual([
			baseHalfDocumentBranchMarkdown('alice.epub', { text: 'Curiouser and curiouser!', chapter: 'Chapter II. The Pool of *Tears*' }),
			baseHalfDocumentBranchMarkdown('alice.epub', { text: 'Curiouser and curiouser!' })
		], [
			'# Curiouser and curiouser!\n\n> Curiouser and curiouser!\n\nSource: [alice.epub](./alice.epub), Chapter II. The Pool of \\*Tears\\*\n',
			'# Curiouser and curiouser!\n\n> Curiouser and curiouser!\n\nSource: [alice.epub](./alice.epub)\n'
		]);
	});

	test('lists the document as upstream in the note\'s first bytes', () => {
		const markdown = baseHalfDocumentBranchMarkdown('2024.pdf', { text: 'Passage', pages: [1] }, {
			sourcePath: 'sources/2024.pdf',
			notePath: 'sources/2024-note.md'
		});
		assert.strictEqual(markdown, [
			'---',
			'upstream:',
			'  - sources/2024.pdf',
			'---',
			'# Passage',
			'',
			'> Passage',
			'',
			'Source: [2024.pdf](./2024.pdf), page 1',
			''
		].join('\n'));
		const read = readBaseHalfMarkdownUpstream(markdown, { nodePath: 'sources/2024-note.md' });
		assert.deepStrictEqual(read.items.map(item => item.path), ['sources/2024.pdf']);
		const book = baseHalfDocumentBranchMarkdown('alice.epub', { text: 'Passage', chapter: 'Chapter I' }, {
			sourcePath: 'books/alice.epub',
			notePath: 'books/alice-note.md'
		});
		assert.deepStrictEqual(readBaseHalfMarkdownUpstream(book, { nodePath: 'books/alice-note.md' }).items.map(item => item.path), ['books/alice.epub']);
	});

	test('uses the selected idea as a concise, canvas-scannable title', () => {
		assert.strictEqual(baseHalfDocumentBranchTitle('  A useful first idea. A second idea follows.  '), 'A useful first idea.');
		assert.strictEqual(baseHalfDocumentBranchTitle('学习不是收藏资料，而是建立能够继续生长的问题地图。后面的内容不会进入标题。'), '学习不是收藏资料，而是建立能够继续生长的问题地图。');
		assert.strictEqual(baseHalfDocumentBranchTitle('x'.repeat(80)), `${'x'.repeat(69)}…`);
	});

	test('escapes inline Markdown syntax in the generated heading', () => {
		assert.ok(baseHalfDocumentBranchMarkdown('Course.pdf', {
			text: 'Use *retrieval* with [evidence].',
			pages: [1]
		}).startsWith('# Use \\*retrieval\\* with \\[evidence\\].\n'));
	});

	test('escapes filenames that would otherwise break Markdown links', () => {
		assert.ok(baseHalfDocumentBranchMarkdown('Course (draft) [v2].pdf', {
			text: 'Passage',
			pages: [1]
		}).includes('Source: [Course (draft) \\[v2\\].pdf](./Course%20%28draft%29%20%5Bv2%5D.pdf), page 1'));
	});
});
