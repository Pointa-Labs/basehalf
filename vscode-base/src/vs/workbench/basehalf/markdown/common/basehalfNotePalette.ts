/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import, so it imports nothing.

/**
 * The nine colors of Rich's color menu, in the menu's order, by the names
 * the rich editor gives them (note formats, rule 46).
 */
export const BASEHALF_NOTE_PALETTE_COLORS = Object.freeze(['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const);

export type BaseHalfNotePaletteColor = typeof BASEHALF_NOTE_PALETTE_COLORS[number];

/** Whether a color is drawn on the characters or behind them. */
export type BaseHalfNotePaletteRole = 'text' | 'background';

export interface IBaseHalfNotePaletteEntry {
	readonly text: string;
	readonly background: string;
}

/**
 * The values a note stores for each palette color, in lower-case hex (note
 * formats, rules 46 and 47). They are chosen for BaseHalf's dark surfaces,
 * and Rich, the card, Preview, and a fixed block draw them whatever the
 * system's appearance, so a color looks the same wherever the note is read.
 */
export const BASEHALF_NOTE_PALETTE: Readonly<Record<BaseHalfNotePaletteColor, IBaseHalfNotePaletteEntry>> = Object.freeze({
	gray: Object.freeze({ text: '#9b9a97', background: '#3f3e3b' }),
	brown: Object.freeze({ text: '#ba8e78', background: '#4f3a30' }),
	red: Object.freeze({ text: '#e8706b', background: '#692b2b' }),
	orange: Object.freeze({ text: '#dc8434', background: '#583b1f' }),
	yellow: Object.freeze({ text: '#d5ae38', background: '#4a401d' }),
	green: Object.freeze({ text: '#5cad83', background: '#24443a' }),
	blue: Object.freeze({ text: '#4ba3dc', background: '#1f4157' }),
	purple: Object.freeze({ text: '#a882e4', background: '#45306a' }),
	pink: Object.freeze({ text: '#e36aaf', background: '#62294b' })
});

const paletteColors: ReadonlySet<string> = new Set(BASEHALF_NOTE_PALETTE_COLORS);

export function isBaseHalfNotePaletteColor(value: unknown): value is BaseHalfNotePaletteColor {
	return typeof value === 'string' && paletteColors.has(value);
}

/**
 * The style of a span of palette colors, in the one spelling that the card's
 * renderer keeps (note formats, rule 48): `color:` before `background-color:`,
 * each ended by `;`, no spaces, lower-case hex. A name outside the palette,
 * the editor's `default` among them, adds nothing, so the result is empty
 * when neither color is a palette color.
 */
export function baseHalfNoteSpanStyle(textColor: string | undefined, backgroundColor: string | undefined): string {
	const text = isBaseHalfNotePaletteColor(textColor) ? `color:${BASEHALF_NOTE_PALETTE[textColor].text};` : '';
	const background = isBaseHalfNotePaletteColor(backgroundColor) ? `background-color:${BASEHALF_NOTE_PALETTE[backgroundColor].background};` : '';
	return text + background;
}

export interface IBaseHalfNoteSpanColors {
	readonly textColor?: BaseHalfNotePaletteColor;
	readonly backgroundColor?: BaseHalfNotePaletteColor;
}

const colorByValue = (role: BaseHalfNotePaletteRole): ReadonlyMap<string, BaseHalfNotePaletteColor> =>
	new Map(BASEHALF_NOTE_PALETTE_COLORS.map(color => [BASEHALF_NOTE_PALETTE[color][role], color]));
const storedTextColors = colorByValue('text');
const storedBackgroundColors = colorByValue('background');
const storedSpanStyle = /^(?:color:(?<text>#[0-9A-Fa-f]{6});)?(?:background-color:(?<background>#[0-9A-Fa-f]{6});)?$/;

/**
 * The palette colors of a span's `style`, or `undefined` when the style is
 * not a palette color in the stored spelling (note formats, rule 29). Only
 * the case of the hex digits may differ from what Rich writes: a span of any
 * other spelling or color is not one Rich can write back, and keeps its
 * block fixed.
 */
export function parseBaseHalfNoteSpanStyle(style: string): IBaseHalfNoteSpanColors | undefined {
	const groups = storedSpanStyle.exec(style)?.groups;
	if (!groups || (!groups.text && !groups.background)) {
		return undefined;
	}
	const textColor = groups.text ? storedTextColors.get(groups.text.toLowerCase()) : undefined;
	const backgroundColor = groups.background ? storedBackgroundColors.get(groups.background.toLowerCase()) : undefined;
	if ((groups.text && !textColor) || (groups.background && !backgroundColor)) {
		return undefined;
	}
	return {
		...(textColor ? { textColor } : {}),
		...(backgroundColor ? { backgroundColor } : {})
	};
}

// The rich editor's own light and dark palettes, as its core package ships
// them (`COLORS_DEFAULT` and `COLORS_DARK_MODE_DEFAULT` in
// `editor/defaultColors.ts`, version 0.51.3). Its copied HTML, and a page
// drawn with it, carry these values. Each row is text, then background, in
// the order of BASEHALF_NOTE_PALETTE_COLORS.
const editorLightPalette: readonly (readonly [string, string])[] = [
	['#9b9a97', '#ebeced'], ['#64473a', '#e9e5e3'], ['#e03e3e', '#fbe4e4'], ['#d9730d', '#f6e9d9'], ['#dfab01', '#fbf3db'],
	['#4d6461', '#ddedea'], ['#0b6e99', '#ddebf1'], ['#6940a5', '#eae4f2'], ['#ad1a72', '#f4dfeb']
];
const editorDarkPalette: readonly (readonly [string, string])[] = [
	['#bebdb8', '#9b9a97'], ['#8e6552', '#64473a'], ['#ec4040', '#be3434'], ['#e3790d', '#b7600a'], ['#dfab01', '#b58b00'],
	['#6b8b87', '#4d6461'], ['#0e87bc', '#0b6e99'], ['#8552d7', '#6940a5'], ['#da208f', '#ad1a72']
];

const aliasesByRole = (role: BaseHalfNotePaletteRole): ReadonlyMap<string, BaseHalfNotePaletteColor> => {
	const aliases = new Map<string, BaseHalfNotePaletteColor>();
	BASEHALF_NOTE_PALETTE_COLORS.forEach((color, index) => {
		const column = role === 'text' ? 0 : 1;
		aliases.set(BASEHALF_NOTE_PALETTE[color][role], color);
		aliases.set(editorLightPalette[index][column], color);
		aliases.set(editorDarkPalette[index][column], color);
	});
	return aliases;
};
const textAliases = aliasesByRole('text');
const backgroundAliases = aliasesByRole('background');

// The named CSS colors of the same names stand for the palette colors.
// `grey` is the other spelling of `gray`, the same CSS color.
const cssColorNames: ReadonlyMap<string, BaseHalfNotePaletteColor> = new Map([
	...BASEHALF_NOTE_PALETTE_COLORS.map(color => [color, color] as const),
	['grey', 'gray']
]);

const hexColor = /^#[0-9a-f]{6}$/;
const commaRgb = /^rgba?\(\s*(?<red>\d{1,3})\s*,\s*(?<green>\d{1,3})\s*,\s*(?<blue>\d{1,3})\s*(?:,\s*(?<alpha>\d*\.?\d+%?)\s*)?\)$/;
const spaceRgb = /^rgba?\(\s*(?<red>\d{1,3})\s+(?<green>\d{1,3})\s+(?<blue>\d{1,3})\s*(?:\/\s*(?<alpha>\d*\.?\d+%?)\s*)?\)$/;

/** `#rrggbb` of an opaque `rgb()` or `rgba()` value, or `undefined`. */
function hexOfRgb(value: string): string | undefined {
	const groups = (commaRgb.exec(value) ?? spaceRgb.exec(value))?.groups;
	if (!groups) {
		return undefined;
	}
	if (groups.alpha !== undefined && parseFloat(groups.alpha) !== (groups.alpha.endsWith('%') ? 100 : 1)) {
		return undefined;
	}
	const channels = [groups.red, groups.green, groups.blue].map(channel => Number(channel));
	if (channels.some(channel => channel > 255)) {
		return undefined;
	}
	return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The palette color that a pasted CSS color stands for, or `undefined` (note
 * formats, rule 72). A paste keeps a color when it is exactly one of the
 * palette's own values, of the editor's light or dark palette, an opaque
 * `rgb()` of one of them, or the CSS color of the same name; any other color
 * is dropped, since the note can store only the nine. `role` says whether the
 * value was the text's color or its background's: the editor's palettes use
 * some values for both, for different colors.
 */
export function baseHalfNotePaletteAlias(role: BaseHalfNotePaletteRole, css: string): BaseHalfNotePaletteColor | undefined {
	const value = css.trim().toLowerCase();
	const named = cssColorNames.get(value);
	if (named) {
		return named;
	}
	const hex = hexColor.test(value) ? value : hexOfRgb(value);
	return hex === undefined ? undefined : (role === 'text' ? textAliases : backgroundAliases).get(hex);
}
