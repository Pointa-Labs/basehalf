/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { tocData } from '../../../../contrib/preferences/browser/settingsLayout.js';
import { createSettingMatchRegExp } from '../../../../contrib/preferences/browser/settingsTree.js';
import { startEntries } from '../../../../contrib/welcomeGettingStarted/common/gettingStartedContent.js';
import { BASEHALF_CONFIGURATION_NODE, BASEHALF_SETTINGS_TAG } from '../../common/basehalfConfiguration.js';

/**
 * Where BaseHalf's settings show in Settings (settings pages, "The BaseHalf
 * group"): a setting under no entry shows only in a search, and an entry that
 * matches no setting is never drawn.
 */
suite('BaseHalf settings in Settings', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const keys = Object.keys(BASEHALF_CONFIGURATION_NODE.properties ?? {});
	const basehalf = tocData.children?.find(child => child.id === 'basehalf');
	const areas = basehalf?.children?.filter(child => !child.custom) ?? [];

	test('the BaseHalf group lists each area that has settings, then the pages Providers and About', () => {
		assert.strictEqual(basehalf?.label, 'BaseHalf');
		assert.deepStrictEqual(basehalf?.children?.map(child => ({ id: child.id, label: child.label, settings: child.settings, page: child.custom === true })), [
			{ id: 'basehalf/editor', label: 'Editor', settings: ['basehalf.editor.*'], page: false },
			{ id: 'basehalf/canvas', label: 'Canvas', settings: ['basehalf.canvas.*'], page: false },
			{ id: 'basehalf/agentArea', label: 'Agent Area', settings: ['basehalf.agent.*', 'basehalf.agents.*'], page: false },
			{ id: 'basehalf/models', label: 'Providers', settings: undefined, page: true },
			{ id: 'basehalf/about', label: 'About', settings: undefined, page: true }
		]);
	});

	test('every BaseHalf setting is under exactly one area of the BaseHalf group, and every area has settings', () => {
		const placed = keys.map(key => ({
			key,
			areas: areas.filter(area => area.settings?.some(pattern => createSettingMatchRegExp(pattern).test(key))).map(area => area.id)
		}));
		assert.deepStrictEqual(placed.filter(setting => setting.areas.length !== 1), []);
		assert.deepStrictEqual(areas.filter(area => !keys.some(key => area.settings?.some(pattern => createSettingMatchRegExp(pattern).test(key)))).map(area => area.id), []);
	});

	test('the welcome page\'s Open BaseHalf Settings lists every BaseHalf setting', () => {
		const entry = startEntries.find(candidate => candidate.id === 'basehalfOpenSettings');
		const command = entry?.content.type === 'startEntry' ? entry.content.command : undefined;
		assert.strictEqual(command, `command:workbench.action.openSettings?%22@tag:${BASEHALF_SETTINGS_TAG}%22`);
		assert.deepStrictEqual(keys.filter(key => !BASEHALF_CONFIGURATION_NODE.properties?.[key].tags?.includes(BASEHALF_SETTINGS_TAG)), []);
	});
});
