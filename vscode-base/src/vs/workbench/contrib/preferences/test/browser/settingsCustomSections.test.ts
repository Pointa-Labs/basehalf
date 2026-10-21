/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { settingsCustomSectionRegistry } from '../../browser/settingsCustomSections.js';

suite('SettingsCustomSections', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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
});
