/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfFindPattern, baseHalfFindText, findBaseHalfMatches } from '../../common/basehalfReaderFind.js';

/** The passages of `text` that Find finds for `query`. */
function find(text: string, query: string): string[] {
	const pattern = baseHalfFindPattern(query);
	return pattern ? findBaseHalfMatches(text, baseHalfFindText(text), pattern).map(match => text.slice(match.start, match.end)) : [];
}

suite('BaseHalfReaderFind', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('matches whatever the case, the accents, the widths, the quotation marks, and the glyphs of two letters (PDFs and books, rule 19)', () => {
		assert.deepStrictEqual([
			find('Dynamic languages such as JavaScript', 'javascript'),
			find('Nous avons discuté au café.', 'cafe'),
			find('Une vue naïve', 'NAIVE'),
			find('在２０２６年，研究者们', '2026'),
			find('在2026年', '２０２６'),
			find('“don’t trust a model”', 'don\'t'),
			find('the ﬁrst and the ﬃne', 'first'),
			find('pages 3–5', '3-5'),
			find('A café apart', 'café')
		], [
			['JavaScript'],
			['café'],
			['naïve'],
			['２０２６'],
			['2026'],
			['don’t'],
			['ﬁrst'],
			['3–5'],
			['café']
		]);
	});

	test('keeps the letters of Cyrillic apart: й is not и', () => {
		assert.deepStrictEqual([find('Йод и вода', 'йод'), find('Йод и вода', 'иод')], [['Йод'], []]);
	});

	test('finds a word that a hyphen broke at the end of a line, whole, and on both of its lines', () => {
		// PDFium puts U+FFFE in place of the hyphen and the line break.
		assert.deepStrictEqual(find('more difficult to com￾pile than statically typed ones', 'compile'), ['com￾pile']);
		assert.deepStrictEqual(find('We present an al￾ternative compilation technique', 'alternative compilation'), ['al￾ternative compilation']);
		// A text that kept the hyphen and the line break.
		assert.deepStrictEqual(find('an al-\r\nternative way', 'alternative'), ['al-\r\nternative']);
		// A hyphen in the words may be the one a line broke the text at.
		assert.deepStrictEqual(find('a mixed￾mode execution and a mixed-mode one', 'mixed-mode'), ['mixed￾mode', 'mixed-mode']);
		// A dash at the end of a line before a number stays a dash.
		assert.deepStrictEqual(find('pages 3-\r\n5 of it', '3- 5'), ['3-\r\n5']);
	});

	test('matches a phrase across a line break, and white space next to Chinese text as nothing', () => {
		assert.deepStrictEqual([
			find('generates machine\r\ncode on the fly', 'machine code'),
			find('generates machine   code', 'machine code'),
			find('让模型自己发现数据中的规\r\n律。每一层', '规律'),
			find('Transformer 模型完全抛弃了循环结构', 'transformer模型'),
			find('Transformer模型完全抛弃了循环结构', 'Transformer 模型'),
			find('梯度 消失', '梯度消失')
		], [
			['machine\r\ncode'],
			['machine   code'],
			['规\r\n律'],
			['Transformer 模型'],
			['Transformer模型'],
			['梯度 消失']
		]);
	});

	test('gives the places of the original text, also for characters of two units', () => {
		const text = '𝐀bc 𝐀bc';
		const pattern = baseHalfFindPattern('abc')!;
		assert.deepStrictEqual(findBaseHalfMatches(text, baseHalfFindText(text), pattern), [{ start: 0, end: 4 }, { start: 5, end: 9 }]);
		assert.deepStrictEqual(baseHalfFindText(' Two  words\r\n').text, 'two words');
	});

	test('looks for nothing in white space, and takes the signs of a pattern as text', () => {
		assert.deepStrictEqual([baseHalfFindPattern(''), baseHalfFindPattern('   \r\n')], [undefined, undefined]);
		assert.deepStrictEqual([
			find('a.b and axb', 'a.b'),
			find('see (1) and [2]', '(1)'),
			find('a - b', '-'),
			find('e-mail or email', 'e-mail')
		], [
			['a.b'],
			['(1)'],
			['-'],
			['e-mail', 'email']
		]);
	});
});
