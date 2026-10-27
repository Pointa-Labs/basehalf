/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfCellBackground, baseHalfIsPowerlineGlyph, baseHalfRowColorsItsEdge, IBaseHalfTerminalCell, IBaseHalfTerminalColors } from '../../common/basehalfTerminalEdges.js';

/** A color of a cell: an RGB color, a palette entry, or the default (undefined). */
type CellColor = number | { readonly palette: number } | undefined;

function cell(background: CellColor, foreground?: CellColor, inverse = false): IBaseHalfTerminalCell {
	const value = (color: CellColor) => typeof color === 'number' ? color : color?.palette ?? -1;
	return {
		isInverse: () => inverse ? 1 : 0,
		isBgRGB: () => typeof background === 'number',
		isBgPalette: () => typeof background === 'object',
		getBgColor: () => value(background),
		isFgRGB: () => typeof foreground === 'number',
		isFgPalette: () => typeof foreground === 'object',
		getFgColor: () => value(foreground)
	};
}

const palette = new Map([[1, 0xf74949], [4, 0x0078d4], [75, 0x5fafff]]);
const colors: IBaseHalfTerminalColors = {
	background: 0x1f1f1f,
	foreground: 0xcccccc,
	paletteColor: index => palette.get(index)
};

suite('BaseHalfTerminalEdgeRules', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('draws a cell in the default background, its palette entry of the 16 and of the 256 colors, or its RGB color', () => {
		assert.deepStrictEqual(
			[cell(undefined), cell({ palette: 1 }), cell({ palette: 75 }), cell(0x0a0a0a), cell({ palette: 200 })].map(each => baseHalfCellBackground(each, colors)),
			// A palette entry the terminal does not have falls back to the default background.
			[0x1f1f1f, 0xf74949, 0x5fafff, 0x0a0a0a, 0x1f1f1f]
		);
	});

	test('draws an inverse cell in its foreground, and in the default foreground when it has none', () => {
		assert.deepStrictEqual(
			[cell(0x0a0a0a, 0x112233, true), cell(0x0a0a0a, { palette: 4 }, true), cell(undefined, undefined, true)].map(each => baseHalfCellBackground(each, colors)),
			[0x112233, 0x0078d4, 0xcccccc]
		);
	});

	test('knows the powerline glyphs that fit their cell exactly', () => {
		assert.deepStrictEqual(
			[0xE0AF, 0xE0B0, 0xE0C8, 0xE0C9, 0xE0CA, 0xE0CB, 0xE0CC, 0xE0D2, 0xE0D3, 0xE0D4, 0xE0D5, 0x41].map(baseHalfIsPowerlineGlyph),
			[false, true, true, false, true, false, true, true, false, true, false, false]
		);
	});

	test('lets a row color the edge above or under the grid only when no cell has the default background and none holds a powerline glyph', () => {
		const space = 0x20;
		assert.deepStrictEqual({
			colored: baseHalfRowColorsItsEdge([0x0a0a0a, 0x0a0a0a, 0x303030], [space, 0x41, space], 0x1f1f1f),
			aDefaultCell: baseHalfRowColorsItsEdge([0x0a0a0a, 0x1f1f1f, 0x0a0a0a], [space, space, space], 0x1f1f1f),
			anRgbEqualToTheDefault: baseHalfRowColorsItsEdge([0x1f1f1f, 0x1f1f1f], [space, space], 0x1f1f1f),
			aPowerlineGlyph: baseHalfRowColorsItsEdge([0x0a0a0a, 0x0a0a0a], [space, 0xE0B0], 0x1f1f1f),
			anotherPrivateGlyph: baseHalfRowColorsItsEdge([0x0a0a0a, 0x0a0a0a], [space, 0xE0C9], 0x1f1f1f),
			noCells: baseHalfRowColorsItsEdge([], [], 0x1f1f1f)
		}, {
			colored: true,
			aDefaultCell: false,
			anRgbEqualToTheDefault: false,
			aPowerlineGlyph: false,
			anotherPrivateGlyph: true,
			noCells: false
		});
	});
});
