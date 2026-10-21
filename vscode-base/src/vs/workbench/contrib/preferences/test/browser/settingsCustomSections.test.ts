/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { TreeVisibility } from '../../../../../base/browser/ui/tree/tree.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestEnvironmentService } from '../../../../test/browser/workbenchTestServices.js';
import { settingsCustomSectionRegistry } from '../../browser/settingsCustomSections.js';
import { SettingsTreeFilter } from '../../browser/settingsTree.js';
import { ISettingsEditorViewState, SettingsTreeGroupElement } from '../../browser/settingsTreeModels.js';

suite('SettingsCustomSections', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('registers each page once, until its registration is disposed', () => {
		const id = 'test.settings.customSection';
		const registration = settingsCustomSectionRegistry.register({
			id,
			create: () => { throw new Error('The registry test does not instantiate a view.'); }
		});
		try {
			assert.ok(settingsCustomSectionRegistry.get(id));
			assert.throws(() => settingsCustomSectionRegistry.register({ id, create: () => { throw new Error(); } }));
		} finally {
			registration.dispose();
		}
		assert.strictEqual(settingsCustomSectionRegistry.get(id), undefined);
	});

	// BaseHalf: a page is an entry of the table of contents with no settings (docs/specs/settings-pages.md).
	test('a page is an entry of the table of contents, never a heading in the settings list or a search result', () => {
		const page = store.add(new SettingsTreeGroupElement('test/page', undefined, 'Page', 1, false, true));
		const shown = (isSettingsList: boolean, query?: string) => {
			const viewState: ISettingsEditorViewState = { settingsTarget: ConfigurationTarget.USER_LOCAL, query, categoryFilter: page };
			return new SettingsTreeFilter(viewState, isSettingsList, TestEnvironmentService).filter(page, TreeVisibility.Visible);
		};
		assert.deepStrictEqual({
			tableOfContents: shown(false),
			tableOfContentsWhileSearching: shown(false, 'zoom'),
			settingsList: shown(true),
			settingsListWhileSearching: shown(true, 'zoom')
		}, {
			tableOfContents: true,
			tableOfContentsWhileSearching: false,
			settingsList: false,
			settingsListWhileSearching: false
		});
	});
});
