/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports nothing.

/**
 * What a note is set in (note rendering, "The typography of a note"): the
 * values that the user chooses. Every other measure of a note, such as its
 * line height and the sizes of its headings, is a multiple of the text size
 * and is written once, in the stylesheets of the surfaces.
 */
export interface IBaseHalfNoteTypography {
	/** The fonts of a note's text as a stylesheet lists them: the user's list, then the font of the window. */
	readonly fontFamily: string;
	/** The size of a note's text in Card Detail, in pixels at a zoom of 100%. */
	readonly fontSize: number;
	/** The fonts of code in a note, as a stylesheet lists them. */
	readonly codeFontFamily: string;
}

/** The values of the settings a note's typography follows, as the configuration gives them. */
export interface IBaseHalfNoteTypographySettings {
	/** `basehalf.notes.fontFamily` */
	readonly fontFamily: unknown;
	/** `basehalf.notes.fontSize` */
	readonly fontSize: unknown;
	/** `editor.fontFamily` */
	readonly codeFontFamily: unknown;
}

/** The text sizes a note takes, and the one it has without a value. */
export interface IBaseHalfNoteTextSizes {
	readonly initial: number;
	readonly minimum: number;
	readonly maximum: number;
}

/** The property of a surface that holds the fonts of a note's text. */
export const BASEHALF_NOTE_FONT_FAMILY_PROPERTY = '--basehalf-note-font-family';
/** The property that holds the size of a note's text in Card Detail, as a length. */
export const BASEHALF_NOTE_FONT_SIZE_PROPERTY = '--basehalf-note-font-size';
/** The property that holds the fonts of code in a note. */
export const BASEHALF_NOTE_CODE_FONT_FAMILY_PROPERTY = '--basehalf-note-code-font-family';

/** The fixed-width font a note's code falls back to. */
const FIXED_WIDTH_FONT = 'monospace';

/**
 * A list of fonts that a stylesheet can hold as the value of one property:
 * names, in quotes or not, with commas between them. A value with a quote
 * left open, or with a character outside its quotes that would end the value
 * or open a block or a function in it, is no list of fonts: a stylesheet
 * would drop it, and the surfaces would keep the list they had.
 */
function fontList(value: unknown): string | undefined {
	if (typeof value !== 'string' || /[\n\r\\]/.test(value)) {
		return undefined;
	}
	const list = value.trim().replace(/[,\s]+$/, '');
	const outsideQuotes = list.replace(/"[^"]*"|'[^']*'/g, '');
	return list.length > 0 && !/["';{}()<>!]/.test(outsideQuotes) ? list : undefined;
}

/**
 * The typography of a note from the values of its settings (note rendering,
 * rules 35 to 37). The font of the window follows the user's list, so a list
 * none of whose fonts the computer has shows the font of the window; without
 * a list a note is in the font of the window. A text size outside what a note
 * takes is the nearest it takes, and one that is no number the initial one.
 */
export function baseHalfNoteTypography(settings: IBaseHalfNoteTypographySettings, windowFontFamily: string, sizes: IBaseHalfNoteTextSizes): IBaseHalfNoteTypography {
	const own = fontList(settings.fontFamily);
	const code = fontList(settings.codeFontFamily);
	const size = typeof settings.fontSize === 'number' && Number.isFinite(settings.fontSize) ? settings.fontSize : sizes.initial;
	return {
		fontFamily: own ? `${own}, ${windowFontFamily}` : windowFontFamily,
		fontSize: Math.min(sizes.maximum, Math.max(sizes.minimum, size)),
		codeFontFamily: !code ? FIXED_WIDTH_FONT : /(^|,)\s*monospace$/.test(code) ? code : `${code}, ${FIXED_WIDTH_FONT}`
	};
}

export function baseHalfNoteTypographiesEqual(a: IBaseHalfNoteTypography, b: IBaseHalfNoteTypography): boolean {
	return a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.codeFontFamily === b.codeFontFamily;
}

/** Whether a value that came from another page is a typography of a note. */
export function isBaseHalfNoteTypography(value: unknown): value is IBaseHalfNoteTypography {
	const candidate = value as Partial<IBaseHalfNoteTypography> | undefined | null;
	return !!candidate
		&& typeof candidate.fontFamily === 'string' && candidate.fontFamily.length > 0
		&& typeof candidate.fontSize === 'number' && Number.isFinite(candidate.fontSize) && candidate.fontSize > 0
		&& typeof candidate.codeFontFamily === 'string' && candidate.codeFontFamily.length > 0;
}

/** The properties that carry a typography to the stylesheets of a surface, each with its value. */
export function baseHalfNoteTypographyProperties(typography: IBaseHalfNoteTypography): readonly (readonly [name: string, value: string])[] {
	return [
		[BASEHALF_NOTE_FONT_FAMILY_PROPERTY, typography.fontFamily],
		[BASEHALF_NOTE_FONT_SIZE_PROPERTY, `${typography.fontSize}px`],
		[BASEHALF_NOTE_CODE_FONT_FAMILY_PROPERTY, typography.codeFontFamily]
	];
}

/** The inline style of an element, as far as a typography is written to it. */
export interface IBaseHalfNoteTypographyTarget {
	setProperty(name: string, value: string): void;
}

/**
 * Writes a typography to the inline style of the element whose descendants
 * are set in it. The write is one task of the page, so no frame shows a note
 * partly in the old values (note rendering, rule 40).
 */
export function applyBaseHalfNoteTypography(target: IBaseHalfNoteTypographyTarget, typography: IBaseHalfNoteTypography): void {
	for (const [name, value] of baseHalfNoteTypographyProperties(typography)) {
		target.setProperty(name, value);
	}
}
