/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../base/common/color.js';
import { localize } from '../../../../nls.js';
import { ColorDefaults, ColorValue, isColorDefaults, registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { contrastBorder, editorBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { ColorScheme, isDark, isHighContrast } from '../../../../platform/theme/common/theme.js';

// The colors of everything BaseHalf draws, and the one place a literal color is written (light and dark, D148).
// Each is a color of the base's registry with a default for each kind of theme, so the window has it as
// `--vscode-basehalf-<name>`, every page in a frame has it under the same name, and both follow the theme. The
// dark defaults are the values the stylesheets held before D148: a dark theme draws what it drew. An identifier
// has one dot: the window turns every dot of an identifier into a dash and a page only the first.

/** A color with a share of transparency. A share in whole hundredths is written to a stylesheet as it is given here. */
function ink(red: number, green: number, blue: number, alpha: number): Color {
	return new Color(new RGBA(red, green, blue, alpha));
}

interface IBaseHalfHighContrast {
	readonly dark?: ColorValue;
	readonly light?: ColorValue;
}

/** Registers `basehalf.<name>`. High contrast takes the value of its kind unless it is given one of its own. */
function register(name: string, dark: ColorValue, light: ColorValue, description: string, highContrast?: IBaseHalfHighContrast): string {
	return registerColor(`basehalf.${name}`, { dark, light, hcDark: highContrast?.dark ?? dark, hcLight: highContrast?.light ?? light }, description);
}

//#region The canvas and its cards

export const BASEHALF_CANVAS_BACKGROUND = register('canvasBackground', '#0b0c0d', '#f3f3f1', localize('basehalf.color.canvasBackground', "The background of the canvas."), { light: '#ffffff' });
export const BASEHALF_CARD_BACKGROUND = register('cardBackground', '#222426', '#ffffff', localize('basehalf.color.cardBackground', "The surface of a card on the canvas."));
export const BASEHALF_CARD_MUTED_BACKGROUND = register('cardMutedBackground', '#191a1b', '#f6f6f4', localize('basehalf.color.cardMutedBackground', "The quieter surface inside a card."));
export const BASEHALF_CARD_FOREGROUND = register('cardForeground', '#e1e2e3', '#1d1e20', localize('basehalf.color.cardForeground', "The text of a card."));
export const BASEHALF_CARD_SECONDARY_FOREGROUND = register('cardSecondaryForeground', '#b0b3b5', '#45484b', localize('basehalf.color.cardSecondaryForeground', "The second text of a card."));
export const BASEHALF_CARD_TERTIARY_FOREGROUND = register('cardTertiaryForeground', '#898d90', '#5b5e62', localize('basehalf.color.cardTertiaryForeground', "The third text of a card."));
export const BASEHALF_CARD_FAINT_FOREGROUND = register('cardFaintForeground', '#666a6d', '#65686c', localize('basehalf.color.cardFaintForeground', "The faintest text of a card."));
export const BASEHALF_CARD_BORDER = register('cardBorder', '#3a3c3f', '#dbdbd7', localize('basehalf.color.cardBorder', "The border of a card."), { light: contrastBorder });
export const BASEHALF_CARD_STRONG_BORDER = register('cardStrongBorder', '#565a5e', '#b9bab6', localize('basehalf.color.cardStrongBorder', "The stronger border of a card and of a control on the canvas."), { light: contrastBorder });
export const BASEHALF_CARD_WARNING = register('cardWarning', '#cca700', '#8a6d00', localize('basehalf.color.cardWarning', "A warning on a card."));
export const BASEHALF_CARD_DANGER = register('cardDanger', '#f14c4c', '#c62828', localize('basehalf.color.cardDanger', "A failure on a card, and an action that deletes."));
export const BASEHALF_CARD_DANGER_BACKGROUND = register('cardDangerBackground', '#5a1d1d', '#fde7e7', localize('basehalf.color.cardDangerBackground', "The ground under a failure on a card."));
export const BASEHALF_FOLDER_BACKGROUND = register('folderBackground', '#252524', '#fbf8ee', localize('basehalf.color.folderBackground', "The surface of a folder's card."));
export const BASEHALF_FOLDER_BORDER = register('folderBorder', '#494437', '#e2d8b9', localize('basehalf.color.folderBorder', "The border of a folder's card."), { light: contrastBorder });
export const BASEHALF_FOLDER_GLYPH = register('folderGlyph', '#c5ad69', '#8a6a18', localize('basehalf.color.folderGlyph', "The glyph of a folder's card."));
export const BASEHALF_FOLDER_DROP_BORDER = register('folderDropBorder', '#f0c54c', '#d9a514', localize('basehalf.color.folderDropBorder', "A folder's card that would take what is dragged."));
export const BASEHALF_CONNECTION_LINE = register('connectionLine', '#666a6d', '#818386', localize('basehalf.color.connectionLine', "The line of a connection on the canvas."), { light: '#292929' });
export const BASEHALF_CONNECTION_ARROW = register('connectionArrow', '#b1b1b7', '#6a6c70', localize('basehalf.color.connectionArrow', "The arrowhead of a connection on the canvas."), { light: '#292929' });

export const BASEHALF_MARQUEE_INK = register('marqueeInk', '#898d90', '#b4b7ba', localize('basehalf.color.marqueeInk', "The veil over a marquee and over several selected cards, of which a tenth shows."));
export const BASEHALF_NOTE_QUOTE_FOREGROUND = register('noteQuoteForeground', '#7d797a', '#5b5e62', localize('basehalf.color.noteQuoteForeground', "A quote in a note, and the line beside it."));
export const BASEHALF_NOTE_CODE_BACKGROUND = register('noteCodeBackground', '#161616', '#f1f1ef', localize('basehalf.color.noteCodeBackground', "The ground of a block of code in a note."));
export const BASEHALF_NOTE_CODE_FOREGROUND = register('noteCodeForeground', '#ffffff', '#1d1e20', localize('basehalf.color.noteCodeForeground', "The text of a block of code in a note."));

/** The seven backgrounds a note can have, by the names its record keeps. */
export const BASEHALF_NOTE_BACKGROUNDS = {
	red: register('noteRedBackground', '#392626', '#fce6e4', localize('basehalf.color.noteRedBackground', "The red background of a note.")),
	orange: register('noteOrangeBackground', '#3b2c22', '#fcead6', localize('basehalf.color.noteOrangeBackground', "The orange background of a note.")),
	yellow: register('noteYellowBackground', '#373320', '#fbf1c8', localize('basehalf.color.noteYellowBackground', "The yellow background of a note.")),
	green: register('noteGreenBackground', '#22332a', '#e0f2e4', localize('basehalf.color.noteGreenBackground', "The green background of a note.")),
	cyan: register('noteCyanBackground', '#203238', '#dbf0f4', localize('basehalf.color.noteCyanBackground', "The cyan background of a note.")),
	blue: register('noteBlueBackground', '#222f3d', '#dfeafb', localize('basehalf.color.noteBlueBackground', "The blue background of a note.")),
	purple: register('notePurpleBackground', '#30273c', '#ece4f9', localize('basehalf.color.notePurpleBackground', "The purple background of a note."))
} as const;
export const BASEHALF_NOTE_SWATCH_BORDER = register('noteSwatchBorder', ink(0, 0, 0, 0), ink(0, 0, 0, 0.14), localize('basehalf.color.noteSwatchBorder', "The edge of a background's swatch in the menu of a note's backgrounds."));

//#endregion

//#region The colors of words in a note

// A note stores a color of Rich's palette as one fixed value, the dark one (formats of a note, rules 46 and 47).
// These are the colors a surface draws for each stored value: under a dark theme the stored value itself, under a
// light one the light form of the same color. `basehalfNotePalette.ts` holds the stored values; the dark defaults
// here repeat them, and a test keeps the two in step.

/** The color of words, by the palette's names. */
export const BASEHALF_NOTE_TEXT_COLORS = {
	gray: register('noteGrayText', '#9b9a97', '#6f6e69', localize('basehalf.color.noteGrayText', "Gray words in a note.")),
	brown: register('noteBrownText', '#ba8e78', '#8a5a44', localize('basehalf.color.noteBrownText', "Brown words in a note.")),
	red: register('noteRedText', '#e8706b', '#c4322e', localize('basehalf.color.noteRedText', "Red words in a note.")),
	orange: register('noteOrangeText', '#dc8434', '#a85206', localize('basehalf.color.noteOrangeText', "Orange words in a note.")),
	yellow: register('noteYellowText', '#d5ae38', '#866700', localize('basehalf.color.noteYellowText', "Yellow words in a note.")),
	green: register('noteGreenText', '#5cad83', '#2c7a55', localize('basehalf.color.noteGreenText', "Green words in a note.")),
	blue: register('noteBlueText', '#4ba3dc', '#1a6fb0', localize('basehalf.color.noteBlueText', "Blue words in a note.")),
	purple: register('notePurpleText', '#a882e4', '#7046c4', localize('basehalf.color.notePurpleText', "Purple words in a note.")),
	pink: register('notePinkText', '#e36aaf', '#b8347f', localize('basehalf.color.notePinkText', "Pink words in a note."))
} as const;

/** The color behind words, by the palette's names. */
export const BASEHALF_NOTE_HIGHLIGHT_COLORS = {
	gray: register('noteGrayHighlight', '#3f3e3b', '#e9e8e6', localize('basehalf.color.noteGrayHighlight', "The gray behind words in a note.")),
	brown: register('noteBrownHighlight', '#4f3a30', '#efe2da', localize('basehalf.color.noteBrownHighlight', "The brown behind words in a note.")),
	red: register('noteRedHighlight', '#692b2b', '#fbdcda', localize('basehalf.color.noteRedHighlight', "The red behind words in a note.")),
	orange: register('noteOrangeHighlight', '#583b1f', '#fbe3c8', localize('basehalf.color.noteOrangeHighlight', "The orange behind words in a note.")),
	yellow: register('noteYellowHighlight', '#4a401d', '#f8eeb0', localize('basehalf.color.noteYellowHighlight', "The yellow behind words in a note.")),
	green: register('noteGreenHighlight', '#24443a', '#d5ecdf', localize('basehalf.color.noteGreenHighlight', "The green behind words in a note.")),
	blue: register('noteBlueHighlight', '#1f4157', '#d3e7f7', localize('basehalf.color.noteBlueHighlight', "The blue behind words in a note.")),
	purple: register('notePurpleHighlight', '#45306a', '#e5dbf7', localize('basehalf.color.notePurpleHighlight', "The purple behind words in a note.")),
	pink: register('notePinkHighlight', '#62294b', '#f8dbea', localize('basehalf.color.notePinkHighlight', "The pink behind words in a note."))
} as const;

//#endregion

//#region Shadows and what is mixed into a surface

// A color with a share of transparency is a color of its own for each share, named by the share in percent:
// `basehalf.shadow32` is the ink of a shadow at 32%. A share written here reaches a stylesheet as the same
// number, so what a dark theme draws is to the pixel what the literal values drew; a share mixed in the
// stylesheet (`color-mix` with `transparent`) is rounded another way and is off by one step here and there.

/** Registers a color for each share of an ink: `basehalf.<name><share>`. */
function registerShares(name: string, shares: readonly number[], values: (share: number) => { readonly dark: Color; readonly light: Color; readonly highContrast?: IBaseHalfHighContrast }, describe: (share: number) => string): void {
	for (const share of shares) {
		const value = values(share / 100);
		register(`${name}${share}`, value.dark, value.light, describe(share), value.highContrast);
	}
}

// Under a dark theme the ink of a shadow is black and its share is the shadow's whole strength. Under a light
// one the ink is a dark blue-gray at three tenths of that share: the same rule lifts a menu, a toolbar, or a card
// from paper without a dark edge. High contrast light draws no shadow, as the base's own widgets there.
const LIGHT_SHADOW_SHARE = 0.3;
registerShares('shadow', [16, 18, 22, 25, 28, 32, 35, 36, 38, 60],
	share => ({ dark: ink(0, 0, 0, share), light: ink(20, 24, 31, share * LIGHT_SHADOW_SHARE), highContrast: { light: ink(20, 24, 31, 0) } }),
	share => localize('basehalf.color.shadow', "The shadow under a menu, a toolbar, and a panel BaseHalf draws, at {0} percent.", share));
registerShares('cardShadow', [12, 34, 46],
	share => ({ dark: ink(7, 8, 9, share), light: ink(20, 24, 31, share * LIGHT_SHADOW_SHARE), highContrast: { light: ink(20, 24, 31, 0) } }),
	share => localize('basehalf.color.cardShadow', "The shadow under a card on the canvas, at {0} percent.", share));
registerShares('panelShadow', [34],
	share => ({ dark: ink(5, 6, 7, share), light: ink(20, 24, 31, share * LIGHT_SHADOW_SHARE), highContrast: { light: ink(20, 24, 31, 0) } }),
	share => localize('basehalf.color.panelShadow', "The shadow under the panel of a generation card, at {0} percent.", share));
export const BASEHALF_PANEL_HIGHLIGHT = register('panelHighlight', ink(255, 255, 255, 0.06), ink(255, 255, 255, 0), localize('basehalf.color.panelHighlight', "The line of light along the top edge of the panel of a generation card."));

// What a surface is mixed with to set a part of it back, and what lies over a surface to bring a part forward.
export const BASEHALF_SHADE = register('shade', '#000000', '#b0b0ac', localize('basehalf.color.shade', "What a surface is mixed with to set a part of it back."));
registerShares('shade', [16],
	share => ({ dark: ink(0, 0, 0, share), light: ink(176, 176, 172, share) }),
	share => localize('basehalf.color.shadeShare', "What lies over a surface to set a part of it back, at {0} percent.", share));
registerShares('tint', [6, 12],
	share => ({ dark: ink(255, 255, 255, share), light: ink(0, 0, 0, share) }),
	share => localize('basehalf.color.tint', "What lies over a surface to bring a part of it forward, at {0} percent.", share));

//#endregion

//#region Over the user's material

// What BaseHalf draws over a picture or a video lies on the material, not on the theme: it is the same under
// every kind (light and dark, rule 12).
export const BASEHALF_OVERLAY_FOREGROUND = register('overlayForeground', '#ffffff', '#ffffff', localize('basehalf.color.overlayForeground', "Text and marks that BaseHalf draws over a picture or a video."));
registerShares('overlayForeground', [14, 18, 24, 28, 45, 85],
	share => ({ dark: ink(255, 255, 255, share), light: ink(255, 255, 255, share) }),
	share => localize('basehalf.color.overlayForegroundShare', "Marks that BaseHalf draws over a picture or a video, at {0} percent.", share));
export const BASEHALF_OVERLAY_BACKGROUND = register('overlayBackground', '#000000', '#000000', localize('basehalf.color.overlayBackground', "The ground of a player."));
registerShares('overlayBackground', [18, 25, 30, 35, 42, 45, 55, 60, 62, 66, 72, 78, 82, 86],
	share => ({ dark: ink(0, 0, 0, share), light: ink(0, 0, 0, share) }),
	share => localize('basehalf.color.overlayBackgroundShare', "The scrim under what BaseHalf draws over a picture or a video, at {0} percent.", share));
// The part of a picture that a crop leaves out recedes into what stands behind it: into the dark under a dark
// theme, into the paper under a light one.
registerShares('cropVeil', [45, 62],
	share => ({ dark: ink(0, 0, 0, share), light: ink(243, 243, 241, share + 0.1) }),
	share => localize('basehalf.color.cropVeil', "The veil over the part of a picture that a crop leaves out, at {0} percent.", share));
export const BASEHALF_MEDIA_CONTROL_FOREGROUND = register('mediaControlForeground', '#f5f5f5', '#f5f5f5', localize('basehalf.color.mediaControlForeground', "The controls of a player."));
registerShares('mediaControlForeground', [55, 90],
	share => ({ dark: ink(245, 245, 245, share), light: ink(245, 245, 245, share) }),
	share => localize('basehalf.color.mediaControlForegroundShare', "The quieter words of a player's controls, at {0} percent.", share));
registerShares('mediaControlBackground', [62, 78],
	share => ({ dark: ink(24, 24, 26, share), light: ink(24, 24, 26, share) }),
	share => localize('basehalf.color.mediaControlBackground', "The backing of a player's controls, at {0} percent.", share));
export const BASEHALF_DOCUMENT_PAGE = register('documentPage', '#ffffff', '#ffffff', localize('basehalf.color.documentPage', "The page of a PDF or a book before its picture is drawn."));
export const BASEHALF_MEDIA_STAGE_BACKGROUND = register('mediaStageBackground', editorBackground, '#f3f3f1', localize('basehalf.color.mediaStageBackground', "What stands behind a picture, a video, and a PDF in Card Detail."), { light: editorBackground });

// The button that ends an edit of a picture, a video, or a sound.
export const BASEHALF_EDIT_MODE_BACKGROUND = register('editModeBackground', '#ffd60a', '#f5c400', localize('basehalf.color.editModeBackground', "The button that ends an edit of a picture, a video, or a sound, and the frame of what is kept."));
export const BASEHALF_EDIT_MODE_FOREGROUND = register('editModeForeground', '#1c1c1e', '#1c1c1e', localize('basehalf.color.editModeForeground', "The words on the button that ends an edit."));

//#endregion

//#region The terminal

// The terminal's colors are the base's own; these are their defaults under a dark and a light theme (light and
// dark, "The terminal"). `terminalColorRegistry.ts` asks for them where it registers each color. High contrast
// keeps the base's.
const terminalColors: Readonly<Record<string, { readonly dark: ColorValue | null; readonly light: ColorValue | null }>> = {
	'terminal.background': { dark: '#1f1f1f', light: '#fdfdfc' },
	'terminal.foreground': { dark: '#cccccc', light: '#1f2328' },
	'terminalCursor.foreground': { dark: '#ffffff', light: '#1f2328' },
	'terminalCursor.background': { dark: '#000000', light: '#fdfdfc' },
	'terminal.selectionBackground': { dark: '#3a3d41', light: '#b9d7f5' },
	'terminal.selectionForeground': { dark: '#e0e0e0', light: null },
	'terminal.inactiveSelectionBackground': { dark: '#3a3d4180', light: '#b9d7f580' },
	'terminal.ansiBlack': { dark: '#272727', light: '#1f2328' },
	'terminal.ansiRed': { dark: '#f74949', light: '#c4322e' },
	'terminal.ansiGreen': { dark: '#2ea043', light: '#1a7f37' },
	'terminal.ansiYellow': { dark: '#9e6a03', light: '#7d5e00' },
	'terminal.ansiBlue': { dark: '#0078d4', light: '#0b63ce' },
	'terminal.ansiMagenta': { dark: '#d01273', light: '#7a3fd6' },
	'terminal.ansiCyan': { dark: '#1db4d6', light: '#0a7c86' },
	'terminal.ansiWhite': { dark: '#cccccc', light: '#656d76' },
	'terminal.ansiBrightBlack': { dark: '#5d5d5d', light: '#7c848c' },
	'terminal.ansiBrightRed': { dark: '#dc5452', light: '#d1242f' },
	'terminal.ansiBrightGreen': { dark: '#23d18b', light: '#18803a' },
	'terminal.ansiBrightYellow': { dark: '#f5f543', light: '#8f6a00' },
	'terminal.ansiBrightBlue': { dark: '#3b8eea', light: '#1f6feb' },
	'terminal.ansiBrightMagenta': { dark: '#d670d6', light: '#8f52e8' },
	'terminal.ansiBrightCyan': { dark: '#29b8db', light: '#0b7f89' },
	'terminal.ansiBrightWhite': { dark: '#e5e5e5', light: '#1b1f23' },
	'terminalCommandDecoration.defaultBackground': { dark: '#cccccc40', light: '#1f232840' },
	'terminalCommandDecoration.errorBackground': { dark: '#f74949', light: '#c4322e' },
	'terminalCommandDecoration.successBackground': { dark: '#2ea043', light: '#1a7f37' },
	'terminalOverviewRuler.border': { dark: '#00000000', light: '#00000000' }
};

/** The terminal colors BaseHalf gives a default under a dark and a light theme. */
export const BASEHALF_TERMINAL_COLOR_IDS: readonly string[] = Object.keys(terminalColors);

/** The value of a terminal color under a dark or a light theme, as BaseHalf sets it. */
export function baseHalfTerminalColor(id: string, kind: 'dark' | 'light'): ColorValue | null | undefined {
	return terminalColors[id]?.[kind];
}

/**
 * The defaults of a terminal color of the base: BaseHalf's under a dark and a light theme, the base's own under
 * high contrast. A color BaseHalf sets no default for keeps the base's.
 */
export function baseHalfTerminalColorDefaults(id: string, base: ColorDefaults | ColorValue | null): ColorDefaults | ColorValue | null {
	const own = terminalColors[id];
	if (!own) {
		return base;
	}
	return { dark: own.dark, light: own.light, hcDark: isColorDefaults(base) ? base.hcDark : base, hcLight: isColorDefaults(base) ? base.hcLight : base };
}

/**
 * The contrast a character of the terminal keeps against the ground of its cell (light and dark, "The terminal").
 * BaseHalf's default for `terminal.integrated.minimumContrastRatio` is 1, the palette as it is: the dark palette
 * is made for that, and a higher ratio lifts its colors. On a light ground a program that writes white on a
 * color, or its default text on black, cannot be read at 1, and the light palette already has the ratio for its
 * own colors. So under a light theme the base's own default holds until the user sets a ratio; once set, the
 * setting holds under every theme.
 */
export function baseHalfTerminalContrastRatio(configured: number, userSet: boolean, kind: ColorScheme): number {
	if (userSet || isDark(kind) || isHighContrast(kind)) {
		return configured;
	}
	return Math.max(configured, BASEHALF_LIGHT_TERMINAL_CONTRAST_RATIO);
}

/** The base's own default of `terminal.integrated.minimumContrastRatio`. */
export const BASEHALF_LIGHT_TERMINAL_CONTRAST_RATIO = 4.5;

//#endregion
