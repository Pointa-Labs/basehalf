/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_BOOK_SELECTION_TEXT_LIMIT,
	baseHalfBookReaderMessage,
	normalizeBaseHalfBookReaderPreferences,
	normalizeBaseHalfBookViewState
} from '../../common/basehalfBookReaderProtocol.js';

suite('BaseHalfBookReaderProtocol', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps a place in a book only as a CFI, and how far into the book it is', () => {
		assert.deepStrictEqual([
			normalizeBaseHalfBookViewState({ location: 'epubcfi(/6/8!/4/2/1:0)', fraction: 0.39 }),
			normalizeBaseHalfBookViewState({ location: 'javascript:alert(1)', fraction: 7 }),
			normalizeBaseHalfBookViewState({ location: `epubcfi(${'x'.repeat(3000)})` }),
			normalizeBaseHalfBookViewState(undefined)
		], [
			{ location: 'epubcfi(/6/8!/4/2/1:0)', fraction: 0.39 },
			{ fraction: 1 },
			{},
			{}
		]);
	});

	test('keeps only the sizes of text and the two flows that the reader offers', () => {
		assert.deepStrictEqual([
			normalizeBaseHalfBookReaderPreferences({ textSize: 135, flow: 'scrolled' }),
			normalizeBaseHalfBookReaderPreferences({ textSize: 133, flow: 'sideways' }),
			normalizeBaseHalfBookReaderPreferences(undefined)
		], [
			{ textSize: 135, flow: 'scrolled' },
			{ textSize: 100, flow: 'paginated' },
			{ textSize: 100, flow: 'paginated' }
		]);
	});

	test('reads what the page of a book says as untrusted', () => {
		assert.deepStrictEqual([
			baseHalfBookReaderMessage({ type: 'basehalf.book.createBranch', selection: { text: '  Curiouser!  ', chapter: '  Chapter\nII  ' } }),
			baseHalfBookReaderMessage({ type: 'basehalf.book.createBranch', selection: { text: '   ' } }),
			baseHalfBookReaderMessage({ type: 'basehalf.book.selectionChanged', selection: { text: 'x'.repeat(20_000) } }),
			baseHalfBookReaderMessage({ type: 'basehalf.book.selectionChanged' }),
			baseHalfBookReaderMessage({ type: 'basehalf.book.openLink', href: 'https://example.com' }),
			baseHalfBookReaderMessage({ type: 'basehalf.book.openLink', href: 42 }),
			baseHalfBookReaderMessage({ type: 'basehalf.book.failed', message: 42 }),
			baseHalfBookReaderMessage({ type: 'basehalf.media.escape', extra: true }),
			baseHalfBookReaderMessage({ type: 'basehalf.pdf.createBranch' }),
			baseHalfBookReaderMessage('basehalf.book.userInteraction')
		].map(message => message?.type === 'basehalf.book.selectionChanged' && message.selection ? { ...message, selection: { ...message.selection, text: message.selection.text.length } } : message), [
			{ type: 'basehalf.book.createBranch', selection: { text: 'Curiouser!', chapter: 'Chapter II' } },
			undefined,
			{ type: 'basehalf.book.selectionChanged', selection: { text: BASEHALF_BOOK_SELECTION_TEXT_LIMIT } },
			{ type: 'basehalf.book.selectionChanged' },
			{ type: 'basehalf.book.openLink', href: 'https://example.com' },
			undefined,
			{ type: 'basehalf.book.failed', message: '' },
			{ type: 'basehalf.media.escape' },
			undefined,
			undefined
		]);
	});
});
