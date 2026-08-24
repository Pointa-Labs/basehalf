/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { settingsCustomSectionRegistry } from '../../browser/settingsCustomSections.js';

suite('SettingsCustomSections', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('registers exact sections and transfers one pending request', () => {
		const id = 'test.settings.customSection';
		const registration = settingsCustomSectionRegistry.register({
			id,
			create: () => { throw new Error('The registry test does not instantiate a view.'); }
		});
		try {
			assert.ok(settingsCustomSectionRegistry.get(id));
			assert.throws(() => settingsCustomSectionRegistry.register({ id, create: () => { throw new Error(); } }));

			const request = settingsCustomSectionRegistry.request(id, 'provider.scope');
			assert.strictEqual(settingsCustomSectionRegistry.peekPendingRequest(), request);
			assert.strictEqual(request.input, 'provider.scope');
			assert.strictEqual(settingsCustomSectionRegistry.consumePendingRequest({ id }), false);
			assert.strictEqual(settingsCustomSectionRegistry.consumePendingRequest(request), true);
			assert.strictEqual(settingsCustomSectionRegistry.peekPendingRequest(), undefined);
		} finally {
			registration.dispose();
		}
		assert.strictEqual(settingsCustomSectionRegistry.get(id), undefined);
		assert.throws(() => settingsCustomSectionRegistry.request(id));
	});
});
