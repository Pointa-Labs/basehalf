/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfSettingsWithoutClass } from '../../common/basehalfSettingsCatalogCheck.js';

/** The settings BaseHalf offers, criterion 1: a setting of the base or of a shipped extension has a class. */
suite('BaseHalf settings without a class', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('names the settings of the base and of shipped extensions that no rule names', () => {
		assert.deepStrictEqual(baseHalfSettingsWithoutClass({
			// Named by a rule.
			'editor.fontSize': {},
			'window.commandCenter': {},
			'git.autofetch': { source: { id: 'vscode.git' } },
			// The base brings a setting the catalog does not know.
			'aNewFeature.enabled': {},
			// So does an extension that ships.
			'gitNew.something': { source: { id: 'vscode.git' } },
			// An extension the user installed needs no rule, and a section of a language is no setting.
			'claudeCode.useTerminal': { source: { id: 'Anthropic.claude-code' } },
			'[markdown]': {}
		}), ['aNewFeature.enabled', 'gitNew.something']);
	});
});
