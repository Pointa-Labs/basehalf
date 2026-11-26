/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Extensions as ThemeingExtensions, IColorRegistry, ColorIdentifier } from '../../../../../platform/theme/common/colorRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { ansiColorIdentifiers, registerColors } from '../../common/terminalColorRegistry.js';
import { IColorTheme } from '../../../../../platform/theme/common/themeService.js';
import { Color } from '../../../../../base/common/color.js';
import { ColorScheme } from '../../../../../platform/theme/common/theme.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

registerColors();

const themingRegistry = Registry.as<IColorRegistry>(ThemeingExtensions.ColorContribution);
function getMockTheme(type: ColorScheme): IColorTheme {
	const theme = {
		selector: '',
		label: '',
		type: type,
		getColor: (colorId: ColorIdentifier): Color | undefined => themingRegistry.resolveDefaultColor(colorId, theme),
		defines: () => true,
		getTokenStyleMetadata: () => undefined,
		tokenColorMap: [],
		tokenFontMap: [],
		semanticHighlighting: false
	};
	return theme;
}

suite('Workbench - TerminalColorRegistry', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('hc colors', function () {
		const theme = getMockTheme(ColorScheme.HIGH_CONTRAST_DARK);
		const colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId)!, true));

		assert.deepStrictEqual(colors, [
			'#000000',
			'#cd0000',
			'#00cd00',
			'#cdcd00',
			'#0000ee',
			'#cd00cd',
			'#00cdcd',
			'#e5e5e5',
			'#7f7f7f',
			'#ff0000',
			'#00ff00',
			'#ffff00',
			'#5c5cff',
			'#ff00ff',
			'#00ffff',
			'#ffffff'
		], 'The high contrast terminal colors should be used when the hc theme is active');

	});

	test('light colors', function () {
		const theme = getMockTheme(ColorScheme.LIGHT);
		const colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId)!, true));

		// BaseHalf: the 16 colors under a light theme are BaseHalf's (docs/specs/light-and-dark.md, "The terminal").
		assert.deepStrictEqual(colors, [
			'#1f2328',
			'#c4322e',
			'#1a7f37',
			'#7d5e00',
			'#0b63ce',
			'#7a3fd6',
			'#0a7c86',
			'#656d76',
			'#7c848c',
			'#d1242f',
			'#18803a',
			'#8f6a00',
			'#1f6feb',
			'#8f52e8',
			'#0b7f89',
			'#1b1f23'
		], 'The light terminal colors should be used when the light theme is active');

	});

	test('dark colors', function () {
		const theme = getMockTheme(ColorScheme.DARK);
		const colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId)!, true));

		// BaseHalf: the 16 colors under a dark theme are BaseHalf's (docs/specs/light-and-dark.md, "The terminal").
		assert.deepStrictEqual(colors, [
			'#272727',
			'#f74949',
			'#2ea043',
			'#9e6a03',
			'#0078d4',
			'#d01273',
			'#1db4d6',
			'#cccccc',
			'#5d5d5d',
			'#dc5452',
			'#23d18b',
			'#f5f543',
			'#3b8eea',
			'#d670d6',
			'#29b8db',
			'#e5e5e5'
		], 'The dark terminal colors should be used when a dark theme is active');
	});
});
