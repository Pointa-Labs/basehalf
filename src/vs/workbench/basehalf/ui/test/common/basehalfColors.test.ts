/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Color } from '../../../../../base/common/color.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ColorIdentifier, getColorRegistry } from '../../../../../platform/theme/common/colorRegistry.js';
import { ColorScheme } from '../../../../../platform/theme/common/theme.js';
import { IColorTheme } from '../../../../../platform/theme/common/themeService.js';
import { ansiColorIdentifiers, registerColors } from '../../../../contrib/terminal/common/terminalColorRegistry.js';
import { BASEHALF_NOTE_PALETTE, BASEHALF_NOTE_PALETTE_COLORS } from '../../../markdown/common/basehalfNotePalette.js';
import { BASEHALF_NOTE_BACKGROUNDS, BASEHALF_NOTE_HIGHLIGHT_COLORS, BASEHALF_NOTE_TEXT_COLORS, BASEHALF_TERMINAL_COLOR_IDS, baseHalfTerminalContrastRatio } from '../../common/basehalfColors.js';

registerColors();

const kinds = [ColorScheme.DARK, ColorScheme.LIGHT, ColorScheme.HIGH_CONTRAST_DARK, ColorScheme.HIGH_CONTRAST_LIGHT];

/** A theme that sets no color of its own: each color has the registry's default for the kind. */
function themeOf(kind: ColorScheme): IColorTheme {
	const theme: IColorTheme = {
		label: '',
		type: kind,
		getColor: (id: ColorIdentifier): Color | undefined => getColorRegistry().resolveDefaultColor(id, theme),
		defines: () => false,
		getTokenStyleMetadata: () => undefined,
		tokenColorMap: [],
		tokenFontMap: [],
		semanticHighlighting: false
	};
	return theme;
}

const hex = (id: string, kind: ColorScheme) => Color.Format.CSS.formatHexA(themeOf(kind).getColor(id)!, true);

/** The contrast of a color against a ground, to one decimal: what a reader's eye has between the two. */
function contrast(text: string, ground: string, kind: ColorScheme): number {
	const theme = themeOf(kind);
	return Math.floor(theme.getColor(ground)!.getContrastRatio(theme.getColor(text)!) * 10) / 10;
}

suite('BaseHalf: the colors of what BaseHalf draws', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const own = getColorRegistry().getColors().filter(color => color.id.startsWith('basehalf.')).map(color => color.id);

	test('every color has one dot in its name and a value under each kind of theme', () => {
		// The window turns every dot of an identifier into a dash and a page only the first: with one dot both
		// spell the variable alike (light and dark, rule 1).
		assert.ok(own.length > 80, `${own.length} colors`);
		assert.deepStrictEqual(own.filter(id => !/^basehalf\.[a-z][A-Za-z0-9]*$/.test(id)), []);
		assert.deepStrictEqual(own.filter(id => kinds.some(kind => !themeOf(kind).getColor(id))), []);
	});

	test('under a dark theme the colors are the values the stylesheets held', () => {
		assert.deepStrictEqual({
			canvas: hex('basehalf.canvasBackground', ColorScheme.DARK),
			card: ['basehalf.cardBackground', 'basehalf.cardMutedBackground', 'basehalf.cardBorder', 'basehalf.cardStrongBorder'].map(id => hex(id, ColorScheme.DARK)),
			text: ['basehalf.cardForeground', 'basehalf.cardSecondaryForeground', 'basehalf.cardTertiaryForeground', 'basehalf.cardFaintForeground'].map(id => hex(id, ColorScheme.DARK)),
			folder: ['basehalf.folderBackground', 'basehalf.folderBorder', 'basehalf.folderGlyph', 'basehalf.folderDropBorder'].map(id => hex(id, ColorScheme.DARK)),
			connection: ['basehalf.connectionLine', 'basehalf.connectionArrow'].map(id => hex(id, ColorScheme.DARK)),
			notes: Object.values(BASEHALF_NOTE_BACKGROUNDS).map(id => hex(id, ColorScheme.DARK)),
			shadows: ['basehalf.shadow32', 'basehalf.cardShadow46', 'basehalf.cardShadow12', 'basehalf.panelShadow34'].map(id => themeOf(ColorScheme.DARK).getColor(id)!.toString()),
			highContrast: hex('basehalf.canvasBackground', ColorScheme.HIGH_CONTRAST_DARK)
		}, {
			canvas: '#0b0c0d',
			card: ['#222426', '#191a1b', '#3a3c3f', '#565a5e'],
			text: ['#e1e2e3', '#b0b3b5', '#898d90', '#666a6d'],
			folder: ['#252524', '#494437', '#c5ad69', '#f0c54c'],
			connection: ['#666a6d', '#b1b1b7'],
			notes: ['#392626', '#3b2c22', '#373320', '#22332a', '#203238', '#222f3d', '#30273c'],
			shadows: ['rgba(0, 0, 0, 0.32)', 'rgba(7, 8, 9, 0.46)', 'rgba(7, 8, 9, 0.12)', 'rgba(5, 6, 7, 0.34)'],
			highContrast: '#0b0c0d'
		});
	});

	test('under a dark theme a color of a note is the value the note stores', () => {
		// The file holds one value for each palette color (formats of a note, rules 46 and 47): a dark theme draws
		// that value, a light one its light form (light and dark, rule 17).
		assert.deepStrictEqual(
			BASEHALF_NOTE_PALETTE_COLORS.map(name => ({ name, text: hex(BASEHALF_NOTE_TEXT_COLORS[name], ColorScheme.DARK), background: hex(BASEHALF_NOTE_HIGHLIGHT_COLORS[name], ColorScheme.DARK) })),
			BASEHALF_NOTE_PALETTE_COLORS.map(name => ({ name, ...BASEHALF_NOTE_PALETTE[name] }))
		);
	});

	test('under a light theme every text color has 4.5:1 against the ground it is drawn on', () => {
		const light = ColorScheme.LIGHT;
		const pairs: [string, string][] = [];
		for (const ground of ['basehalf.cardBackground', 'basehalf.cardMutedBackground', 'basehalf.canvasBackground', ...Object.values(BASEHALF_NOTE_BACKGROUNDS)]) {
			for (const text of ['basehalf.cardForeground', 'basehalf.cardSecondaryForeground', 'basehalf.cardTertiaryForeground', 'basehalf.cardFaintForeground']) {
				pairs.push([text, ground]);
			}
		}
		for (const name of BASEHALF_NOTE_PALETTE_COLORS) {
			pairs.push([BASEHALF_NOTE_TEXT_COLORS[name], 'basehalf.cardBackground']);
			pairs.push(['basehalf.cardForeground', BASEHALF_NOTE_HIGHLIGHT_COLORS[name]]);
		}
		pairs.push(
			['basehalf.cardForeground', 'basehalf.folderBackground'],
			['basehalf.folderGlyph', 'basehalf.folderBackground'],
			['basehalf.cardWarning', 'basehalf.cardBackground'],
			['basehalf.cardDanger', 'basehalf.cardBackground'],
			['basehalf.cardDanger', 'basehalf.cardDangerBackground'],
			['basehalf.noteCodeForeground', 'basehalf.noteCodeBackground'],
			['basehalf.noteQuoteForeground', 'basehalf.cardBackground'],
			['basehalf.editModeForeground', 'basehalf.editModeBackground']
		);
		assert.deepStrictEqual(pairs.map(([text, ground]) => ({ text, ground, ratio: contrast(text, ground, light) })).filter(pair => pair.ratio < 4.5), []);
	});

	test('under a dark theme the text colors that had 4.5:1 keep it', () => {
		// The faintest text of a card had 2.8:1 on a card before the light palette and has it still: a dark theme
		// draws what it drew (light and dark, rule 7).
		const dark = ColorScheme.DARK;
		assert.deepStrictEqual(
			['basehalf.cardForeground', 'basehalf.cardSecondaryForeground', 'basehalf.cardTertiaryForeground', 'basehalf.cardFaintForeground'].map(text => contrast(text, 'basehalf.cardBackground', dark)),
			[12, 7.3, 4.6, 2.8]
		);
	});

	test('a connection is as quiet under a light theme as under a dark one', () => {
		// About 3.5:1 for the line, and the arrowhead the stronger of the two (light and dark, rule 11).
		assert.deepStrictEqual(
			[ColorScheme.DARK, ColorScheme.LIGHT].map(kind => ['basehalf.connectionLine', 'basehalf.connectionArrow'].map(color => contrast(color, 'basehalf.canvasBackground', kind))),
			[[3.5, 9.1], [3.4, 4.7]]
		);
	});

	test('the terminal has the palette the profile held under a dark theme, and a readable one under a light theme', () => {
		const dark = themeOf(ColorScheme.DARK);
		assert.deepStrictEqual(Object.fromEntries(BASEHALF_TERMINAL_COLOR_IDS.map(id => [id, Color.Format.CSS.formatHexA(dark.getColor(id)!, true)])), {
			'terminal.background': '#1f1f1f',
			'terminal.foreground': '#cccccc',
			'terminalCursor.foreground': '#ffffff',
			'terminalCursor.background': '#000000',
			'terminal.selectionBackground': '#3a3d41',
			'terminal.selectionForeground': '#e0e0e0',
			'terminal.inactiveSelectionBackground': '#3a3d4180',
			'terminal.ansiBlack': '#272727',
			'terminal.ansiRed': '#f74949',
			'terminal.ansiGreen': '#2ea043',
			'terminal.ansiYellow': '#9e6a03',
			'terminal.ansiBlue': '#0078d4',
			'terminal.ansiMagenta': '#d01273',
			'terminal.ansiCyan': '#1db4d6',
			'terminal.ansiWhite': '#cccccc',
			'terminal.ansiBrightBlack': '#5d5d5d',
			'terminal.ansiBrightRed': '#dc5452',
			'terminal.ansiBrightGreen': '#23d18b',
			'terminal.ansiBrightYellow': '#f5f543',
			'terminal.ansiBrightBlue': '#3b8eea',
			'terminal.ansiBrightMagenta': '#d670d6',
			'terminal.ansiBrightCyan': '#29b8db',
			'terminal.ansiBrightWhite': '#e5e5e5',
			'terminalCommandDecoration.defaultBackground': '#cccccc40',
			'terminalCommandDecoration.errorBackground': '#f74949',
			'terminalCommandDecoration.successBackground': '#2ea043',
			'terminalOverviewRuler.border': '#00000000'
		});
		// Each of the 16 has 4.5:1 against the light ground, apart from bright black, the dim one, which has 3:1.
		const ratios = ['terminal.foreground', ...ansiColorIdentifiers].map(id => ({ id, ratio: contrast(id, 'terminal.background', ColorScheme.LIGHT) }));
		assert.deepStrictEqual(ratios.filter(color => color.ratio < (color.id === 'terminal.ansiBrightBlack' ? 3 : 4.5)), []);
		// High contrast keeps the base's own colors.
		assert.deepStrictEqual(
			[ColorScheme.HIGH_CONTRAST_DARK, ColorScheme.HIGH_CONTRAST_LIGHT].map(kind => Color.Format.CSS.formatHexA(themeOf(kind).getColor(ansiColorIdentifiers[1])!, true)),
			['#cd0000', '#cd3131']
		);
	});

	test('a character of the terminal keeps the base\'s contrast under a light theme until the user sets a ratio', () => {
		assert.deepStrictEqual({
			dark: baseHalfTerminalContrastRatio(1, false, ColorScheme.DARK),
			light: baseHalfTerminalContrastRatio(1, false, ColorScheme.LIGHT),
			lightSetByUser: baseHalfTerminalContrastRatio(1, true, ColorScheme.LIGHT),
			lightHigherDefault: baseHalfTerminalContrastRatio(7, false, ColorScheme.LIGHT),
			highContrast: [ColorScheme.HIGH_CONTRAST_DARK, ColorScheme.HIGH_CONTRAST_LIGHT].map(kind => baseHalfTerminalContrastRatio(1, false, kind)),
			highContrastSetByUser: baseHalfTerminalContrastRatio(1, true, ColorScheme.HIGH_CONTRAST_DARK)
		}, { dark: 1, light: 4.5, lightSetByUser: 1, lightHigherDefault: 7, highContrast: [7, 7], highContrastSetByUser: 1 });
	});
});
