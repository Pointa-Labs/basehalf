/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { tocData } from '../../../../contrib/preferences/browser/settingsLayout.js';
import { createSettingMatchRegExp } from '../../../../contrib/preferences/browser/settingsTree.js';
import { startEntries } from '../../../../contrib/welcomeGettingStarted/common/gettingStartedContent.js';
import { BASEHALF_CONFIGURATION_NODE } from '../../common/basehalfConfiguration.js';
import { BASEHALF_OPEN_SETTINGS_COMMAND_ID } from '../../common/basehalfSettings.js';

/**
 * Where BaseHalf's settings show in the advanced list, and how the welcome page reaches BaseHalf's
 * Settings (BaseHalf's Settings, "The advanced list").
 */
suite('BaseHalf settings in the advanced list', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the advanced list has one group for every BaseHalf setting, and no entry for a page', () => {
		const basehalf = tocData.children?.find(child => child.id === 'basehalf');
		const keys = Object.keys(BASEHALF_CONFIGURATION_NODE.properties ?? {});
		assert.deepStrictEqual({
			label: basehalf?.label,
			children: basehalf?.children,
			unlisted: keys.filter(key => !basehalf?.settings?.some(pattern => createSettingMatchRegExp(pattern).test(key)))
		}, { label: 'BaseHalf', children: undefined, unlisted: [] });
	});

	test('the welcome page\'s Open BaseHalf Settings opens BaseHalf\'s Settings', () => {
		const entry = startEntries.find(candidate => candidate.id === 'basehalfOpenSettings');
		assert.strictEqual(entry?.content.type === 'startEntry' ? entry.content.command : undefined, `command:${BASEHALF_OPEN_SETTINGS_COMMAND_ID}`);
	});
});
