/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_NOTE_PALETTE,
	BASEHALF_NOTE_PALETTE_COLORS,
	BaseHalfNotePaletteColor,
	baseHalfNotePaletteAlias,
	baseHalfNoteSpanStyle,
	isBaseHalfNotePaletteColor,
	parseBaseHalfNoteSpanStyle
} from '../../common/basehalfNotePalette.js';

// The relative luminance and contrast ratio of WCAG 2.1.
function luminance(hex: string): number {
	const channel = (offset: number) => {
		const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

function rgb(hex: string): string {
	return `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
}

// The rule by which the card's renderer keeps a span's style (the base
// Markdown renderer's allowed attributes), which a common test cannot import.
const keptSpanStyle = /^(color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(border-radius:[0-9]+px;)?$/;

// The rich editor's light and dark palettes, as its core package 0.51.3 ships them: text, then background.
const editorLight: Record<BaseHalfNotePaletteColor, [string, string]> = {
	gray: ['#9b9a97', '#ebeced'], brown: ['#64473a', '#e9e5e3'], red: ['#e03e3e', '#fbe4e4'], orange: ['#d9730d', '#f6e9d9'], yellow: ['#dfab01', '#fbf3db'],
	green: ['#4d6461', '#ddedea'], blue: ['#0b6e99', '#ddebf1'], purple: ['#6940a5', '#eae4f2'], pink: ['#ad1a72', '#f4dfeb']
};
const editorDark: Record<BaseHalfNotePaletteColor, [string, string]> = {
	gray: ['#bebdb8', '#9b9a97'], brown: ['#8e6552', '#64473a'], red: ['#ec4040', '#be3434'], orange: ['#e3790d', '#b7600a'], yellow: ['#dfab01', '#b58b00'],
	green: ['#6b8b87', '#4d6461'], blue: ['#0e87bc', '#0b6e99'], purple: ['#8552d7', '#6940a5'], pink: ['#da208f', '#ad1a72']
};

suite('BaseHalfNotePalette', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stores the nine pairs of the specification, in the menu\'s order and lower-case hex', () => {
		assert.deepStrictEqual(BASEHALF_NOTE_PALETTE_COLORS.map(color => [color, BASEHALF_NOTE_PALETTE[color].text, BASEHALF_NOTE_PALETTE[color].background]), [
			['gray', '#9b9a97', '#3f3e3b'],
			['brown', '#ba8e78', '#4f3a30'],
			['red', '#e8706b', '#692b2b'],
			['orange', '#dc8434', '#583b1f'],
			['yellow', '#d5ae38', '#4a401d'],
			['green', '#5cad83', '#24443a'],
			['blue', '#4ba3dc', '#1f4157'],
			['purple', '#a882e4', '#45306a'],
			['pink', '#e36aaf', '#62294b']
		]);
		assert.deepStrictEqual(Object.keys(BASEHALF_NOTE_PALETTE), [...BASEHALF_NOTE_PALETTE_COLORS]);
		assert.deepStrictEqual(BASEHALF_NOTE_PALETTE_COLORS.map(isBaseHalfNotePaletteColor), BASEHALF_NOTE_PALETTE_COLORS.map(() => true));
		assert.deepStrictEqual(['default', 'Red', '', undefined, 3].map(isBaseHalfNotePaletteColor), [false, false, false, false, false]);
	});

	test('reads on the card\'s surface and on Rich\'s page with the contrast the specification states', () => {
		const range = (values: number[]) => [Math.min(...values), Math.max(...values)].map(value => value.toFixed(2));
		const texts = BASEHALF_NOTE_PALETTE_COLORS.map(color => BASEHALF_NOTE_PALETTE[color].text);
		const backgrounds = BASEHALF_NOTE_PALETTE_COLORS.map(color => BASEHALF_NOTE_PALETTE[color].background);
		// Each text color on the card's surface and on Rich's page; the card's and Rich's text on each background.
		assert.deepStrictEqual(range(texts.map(text => contrast(text, '#222426'))), ['5.15', '7.37']);
		assert.deepStrictEqual(range(texts.map(text => contrast(text, '#121314'))), ['6.15', '8.81']);
		assert.deepStrictEqual(range(backgrounds.map(background => contrast('#b0b3b5', background))), ['4.83', '5.29']);
		assert.deepStrictEqual(range(backgrounds.map(background => contrast('#bbbebf', background))), ['5.45', '5.96']);
		// Any palette text on any palette background stays readable.
		assert.ok(Math.min(...texts.flatMap(text => backgrounds.map(background => contrast(text, background)))) >= 3.3);
	});

	test('writes a span in the one spelling that the card\'s renderer keeps', () => {
		assert.deepStrictEqual([
			baseHalfNoteSpanStyle('red', undefined),
			baseHalfNoteSpanStyle(undefined, 'yellow'),
			baseHalfNoteSpanStyle('red', 'yellow'),
			baseHalfNoteSpanStyle('default', 'default'),
			baseHalfNoteSpanStyle('rgb(224, 62, 62)', 'notacolor'),
			baseHalfNoteSpanStyle(undefined, undefined)
		], [
			'color:#e8706b;',
			'background-color:#4a401d;',
			'color:#e8706b;background-color:#4a401d;',
			'',
			'',
			''
		]);
		for (const text of [undefined, ...BASEHALF_NOTE_PALETTE_COLORS]) {
			for (const background of [undefined, ...BASEHALF_NOTE_PALETTE_COLORS]) {
				const style = baseHalfNoteSpanStyle(text, background);
				assert.ok(keptSpanStyle.test(style), style);
				assert.strictEqual(style, style.toLowerCase());
				assert.ok(!/\s/.test(style), style);
				assert.deepStrictEqual(parseBaseHalfNoteSpanStyle(style), style ? { ...(text ? { textColor: text } : {}), ...(background ? { backgroundColor: background } : {}) } : undefined);
			}
		}
	});

	test('reads a span as palette colors only in the stored spelling, its hex digits in either case', () => {
		assert.deepStrictEqual([
			parseBaseHalfNoteSpanStyle('color:#e8706b;'),
			parseBaseHalfNoteSpanStyle('background-color:#4a401d;'),
			parseBaseHalfNoteSpanStyle('color:#E8706B;background-color:#4A401D;'),
			parseBaseHalfNoteSpanStyle('color:#E8706b;')
		], [
			{ textColor: 'red' },
			{ backgroundColor: 'yellow' },
			{ textColor: 'red', backgroundColor: 'yellow' },
			{ textColor: 'red' }
		]);
		for (const style of [
			'', 'color:#123456;', 'color: #e8706b;', 'color:#e8706b', 'color:#e8706b; ', ' color:#e8706b;', 'color:#e8706b;;', 'COLOR:#e8706b;', 'color:red;',
			'background-color:#4a401d;color:#e8706b;', 'color:#692b2b;', 'background-color:#e8706b;', 'color:#e8706b;border-radius:3px;', 'color:#e8706bff;',
			'color:#e03e3e;', 'color:var(--vscode-foreground);', 'color:#e8706b;background-color:#123456;'
		]) {
			assert.strictEqual(parseBaseHalfNoteSpanStyle(style), undefined, style);
		}
	});

	test('maps a pasted color to the palette color it stands for: the palette\'s values, the editor\'s light and dark values, their rgb(), and the CSS names', () => {
		for (const color of BASEHALF_NOTE_PALETTE_COLORS) {
			const values = { text: [BASEHALF_NOTE_PALETTE[color].text, editorLight[color][0], editorDark[color][0]], background: [BASEHALF_NOTE_PALETTE[color].background, editorLight[color][1], editorDark[color][1]] };
			for (const role of ['text', 'background'] as const) {
				for (const hex of values[role]) {
					const [red, green, blue] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
					for (const css of [hex, hex.toUpperCase(), ` ${hex} `, rgb(hex), `rgb(${red},${green},${blue})`, `RGB(${red} ${green} ${blue})`, `rgba(${red}, ${green}, ${blue}, 1)`, `rgb(${red} ${green} ${blue} / 100%)`, `rgba(${red},${green},${blue},1.0)`]) {
						assert.strictEqual(baseHalfNotePaletteAlias(role, css), color, `${role} ${css}`);
					}
				}
				assert.strictEqual(baseHalfNotePaletteAlias(role, color), color);
				assert.strictEqual(baseHalfNotePaletteAlias(role, color.toUpperCase()), color);
			}
		}
		assert.strictEqual(baseHalfNotePaletteAlias('text', 'grey'), 'gray');
		assert.strictEqual(baseHalfNotePaletteAlias('background', 'Grey'), 'gray');
	});

	test('drops any other pasted color', () => {
		for (const css of [
			'#123456', 'rgb(18, 52, 86)', 'rgba(224, 62, 62, 0.5)', 'rgb(224 62 62 / 50%)', 'rgba(224, 62, 62, 0)', 'rgb(300, 0, 0)', 'rgb(224, 62)', 'rgb(224.5, 62, 62)',
			'#e03e3e80', '#f00', 'red !important', 'darkred', 'transparent', 'currentcolor', 'inherit', 'default', '', 'hsl(0, 70%, 56%)', 'var(--red)'
		]) {
			assert.strictEqual(baseHalfNotePaletteAlias('text', css), undefined, css);
			assert.strictEqual(baseHalfNotePaletteAlias('background', css), undefined, css);
		}
		// A value is an alias only in its own role: the editor's yellow text is no background, a palette background no text.
		assert.deepStrictEqual([
			baseHalfNotePaletteAlias('background', '#dfab01'),
			baseHalfNotePaletteAlias('background', '#e8706b'),
			baseHalfNotePaletteAlias('text', '#692b2b'),
			baseHalfNotePaletteAlias('text', '#fbe4e4'),
			baseHalfNotePaletteAlias('text', rgb('#4a401d'))
		], [undefined, undefined, undefined, undefined, undefined]);
	});
});
