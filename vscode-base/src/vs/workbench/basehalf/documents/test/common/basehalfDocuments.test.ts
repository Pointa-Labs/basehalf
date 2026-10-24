/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfItemIcon } from '../../../agentArea/common/basehalfAgentSelection.js';
import { baseHalfDocumentFaceLabel, baseHalfDocumentKind, baseHalfDocumentVersion } from '../../common/basehalfDocuments.js';

suite('BaseHalfDocuments', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const names = ['paper.pdf', 'sicp.EPUB', 'alice.mobi', 'alice.azw3', 'old.azw', 'tale.fb2', 'tale.fbz', 'comic.cbz', 'cover.png', 'notes.md'];

	test('tells a PDF and a book by the name of the file, and draws their glyphs in captions', () => {
		assert.deepStrictEqual(names.map(name => [baseHalfDocumentKind(URI.file(`/workspace/${name}`)), baseHalfItemIcon(name, false)]), [
			['pdf', 'pdf'],
			['book', 'book'],
			['book', 'book'],
			['book', 'book'],
			['book', 'book'],
			['book', 'book'],
			['book', 'book'],
			['book', 'book'],
			[undefined, 'image'],
			[undefined, 'text']
		]);
	});

	test('names the kind of a document on the grey face of its card', () => {
		assert.deepStrictEqual(names.slice(0, 8).map(name => baseHalfDocumentFaceLabel(URI.file(`/workspace/${name}`))), [
			'PDF document',
			'EPUB book',
			'Kindle book',
			'Kindle book',
			'Kindle book',
			'FictionBook',
			'FictionBook',
			'Comic book'
		]);
	});

	test('a version of a file is its time and its size', () => {
		assert.deepStrictEqual([
			baseHalfDocumentVersion({ mtime: 1729800000000, size: 729642 }),
			baseHalfDocumentVersion({})
		], ['1729800000000-729642', '0-0']);
	});
});
