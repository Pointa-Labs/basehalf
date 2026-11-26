/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_NOTES_MONOSPACE_FONT, BASEHALF_NOTES_SERIF_FONT } from '../../../shell/common/basehalfConfiguration.js';
import { applyBaseHalfNoteTypography, baseHalfNoteTypographiesEqual, baseHalfNoteTypography, baseHalfNoteTypographyProperties, IBaseHalfNoteTextSizes, isBaseHalfNoteTypography } from '../../common/basehalfNoteTypography.js';

suite('BaseHalfNoteTypography', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const windowFont = '-apple-system, "system-ui", sans-serif';
	const sizes: IBaseHalfNoteTextSizes = { initial: 16, minimum: 12, maximum: 28 };
	const code = 'Menlo, Monaco, \'Courier New\', monospace';
	const typography = (fontFamily: unknown, fontSize: unknown, codeFontFamily: unknown = code) => baseHalfNoteTypography({ fontFamily, fontSize, codeFontFamily }, windowFont, sizes);

	test('a note without a font is in the font of the window, and the font of the window follows every list', () => {
		assert.deepStrictEqual([
			typography('', 16).fontFamily,
			typography(undefined, 16).fontFamily,
			typography('   ', 16).fontFamily,
			typography(BASEHALF_NOTES_SERIF_FONT, 16).fontFamily,
			typography(BASEHALF_NOTES_MONOSPACE_FONT, 16).fontFamily,
			typography('  "Songti SC", Georgia , ', 16).fontFamily,
			typography('No Such Font', 16).fontFamily
		], [
			windowFont,
			windowFont,
			windowFont,
			`Charter, 'Iowan Old Style', Georgia, serif, ${windowFont}`,
			`Menlo, Monaco, Consolas, monospace, ${windowFont}`,
			`"Songti SC", Georgia, ${windowFont}`,
			`No Such Font, ${windowFont}`
		]);
	});

	test('a value that is no list of fonts leaves a note in the font of the window', () => {
		assert.deepStrictEqual([
			'Georgia; color: red',
			'Georgia } body { display: none',
			'url(x)',
			'"Georgia',
			'Georgia\nserif',
			'Georgia !important',
			12,
			null
		].map(value => typography(value, 16).fontFamily), new Array(8).fill(windowFont));
		// A name in quotes holds any character but its quote.
		assert.strictEqual(typography('"Noto Sans (TC); x", serif', 16).fontFamily, `"Noto Sans (TC); x", serif, ${windowFont}`);
	});

	test('the text size is the setting within what a note takes, and 16 px without a number', () => {
		assert.deepStrictEqual(
			[16, 12, 28, 20, 13.5, 4, 11.9, 40, 0, -3, '18', undefined, null, Number.NaN, Number.POSITIVE_INFINITY].map(value => typography('', value).fontSize),
			[16, 12, 28, 20, 13.5, 12, 12, 28, 12, 12, 16, 16, 16, 16, 16]
		);
	});

	test('code is in the font of code, with a fixed-width font after it', () => {
		assert.deepStrictEqual([
			typography(BASEHALF_NOTES_SERIF_FONT, 16).codeFontFamily,
			typography('', 16, 'Fira Code').codeFontFamily,
			typography('', 16, '').codeFontFamily,
			typography('', 16, null).codeFontFamily,
			typography('', 16, 'Fira Code; x').codeFontFamily
		], [
			// A list that ends in the fixed-width font is whole.
			code,
			'Fira Code, monospace',
			'monospace',
			'monospace',
			'monospace'
		]);
	});

	test('a surface gets the three values as properties of one element', () => {
		const serif = typography(BASEHALF_NOTES_SERIF_FONT, 20);
		assert.deepStrictEqual(baseHalfNoteTypographyProperties(serif), [
			['--basehalf-note-font-family', `Charter, 'Iowan Old Style', Georgia, serif, ${windowFont}`],
			['--basehalf-note-font-size', '20px'],
			['--basehalf-note-code-font-family', code]
		]);
		const written: string[] = [];
		applyBaseHalfNoteTypography({ setProperty: (name, value) => written.push(`${name}: ${value}`) }, typography('', 12.5));
		assert.deepStrictEqual(written, [
			`--basehalf-note-font-family: ${windowFont}`,
			'--basehalf-note-font-size: 12.5px',
			`--basehalf-note-code-font-family: ${code}`
		]);
	});

	test('two typographies are the same when their three values are', () => {
		assert.deepStrictEqual([
			baseHalfNoteTypographiesEqual(typography('', 16), typography('  ', 16)),
			baseHalfNoteTypographiesEqual(typography('', 16), typography('', 17)),
			baseHalfNoteTypographiesEqual(typography('', 16), typography('Georgia', 16)),
			baseHalfNoteTypographiesEqual(typography('', 16), typography('', 16, 'Fira Code')),
			// A size outside what a note takes is the nearest it takes: nothing changed.
			baseHalfNoteTypographiesEqual(typography('', 28), typography('', 40))
		], [true, false, false, false, true]);
	});

	test('a typography from another page has a font, a size above nothing, and a font of code', () => {
		const valid = typography('', 16);
		assert.deepStrictEqual([
			isBaseHalfNoteTypography(valid),
			isBaseHalfNoteTypography(undefined),
			isBaseHalfNoteTypography(null),
			isBaseHalfNoteTypography({}),
			isBaseHalfNoteTypography({ ...valid, fontSize: -1 }),
			isBaseHalfNoteTypography({ ...valid, fontFamily: 5 })
		], [true, false, false, false, false, false]);
	});
});
