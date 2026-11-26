/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The colors a terminal draws with at a moment, each as `0xRRGGBB`: its
 * default background and foreground, which a program can change (OSC 11 and
 * OSC 10), and its palette entries, which a program can change (OSC 4).
 */
export interface IBaseHalfTerminalColors {
	readonly background: number;
	readonly foreground: number;
	paletteColor(index: number): number | undefined;
}

/** What the edges read of a cell: the part of xterm.js's `IBufferCell` that decides its background. */
export interface IBaseHalfTerminalCell {
	isInverse(): number;
	isBgRGB(): boolean;
	isBgPalette(): boolean;
	getBgColor(): number;
	isFgRGB(): boolean;
	isFgPalette(): boolean;
	getFgColor(): number;
}

function resolveColor(rgb: boolean, palette: boolean, value: number, fallback: number, colors: IBaseHalfTerminalColors): number {
	if (rgb) {
		return value & 0xFFFFFF;
	}
	if (palette) {
		return colors.paletteColor(value) ?? fallback;
	}
	return fallback;
}

/**
 * The background the terminal draws behind a cell, as `0xRRGGBB`: its palette
 * entry or its RGB color, its foreground when the cell is drawn inverse, and
 * the default background otherwise (D86).
 */
export function baseHalfCellBackground(cell: IBaseHalfTerminalCell, colors: IBaseHalfTerminalColors): number {
	if (cell.isInverse()) {
		return resolveColor(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor(), colors.foreground, colors);
	}
	return resolveColor(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor(), colors.background, colors);
}

/** A powerline glyph, drawn to fit its cell exactly, which looks wrong drawn wider. */
export function baseHalfIsPowerlineGlyph(code: number): boolean {
	return (code >= 0xE0B0 && code <= 0xE0C8)
		|| code === 0xE0CA
		|| (code >= 0xE0CC && code <= 0xE0D2)
		|| code === 0xE0D4;
}

/**
 * Whether the first or the last row of the grid colors the edge above or
 * under the grid, given the backgrounds and the glyphs of its cells: none of
 * them has the default background and none is a powerline glyph. These are
 * the reference terminal's rules when its padding color is set to extend,
 * without the one for prompt rows (D86).
 */
export function baseHalfRowColorsItsEdge(backgrounds: ArrayLike<number>, codes: ArrayLike<number>, defaultBackground: number): boolean {
	if (backgrounds.length === 0) {
		return false;
	}
	for (let index = 0; index < backgrounds.length; index++) {
		if (backgrounds[index] === defaultBackground || baseHalfIsPowerlineGlyph(codes[index])) {
			return false;
		}
	}
	return true;
}
