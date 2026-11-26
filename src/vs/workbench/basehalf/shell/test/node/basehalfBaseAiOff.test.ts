/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { FileAccess } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('BaseHalf with the base\'s AI off (D141)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the product configuration keeps the base\'s chat agent and names no address that takes an account\'s token', () => {
		const product = JSON.parse(readFileSync(joinPath(FileAccess.asFileUri(''), '..', 'product.json').fsPath, 'utf8'));
		const agent = product.defaultChatAgent ?? {};

		assert.deepStrictEqual({
			// Modules of the base read the block without asking whether it is there.
			hasAgent: typeof product.defaultChatAgent === 'object',
			hasExtensionIds: [typeof agent.extensionId, typeof agent.chatExtensionId, typeof agent.provider?.default?.id],
			// With no address, the base's account service asks nothing of a GitHub session.
			addresses: [agent.entitlementUrl, agent.entitlementSignupLimitedUrl, agent.tokenEntitlementUrl, agent.mcpRegistryDataUrl, agent.managedSettingsUrl],
			hasVoiceAddress: Object.keys(product).includes('voiceWsUrl')
		}, {
			hasAgent: true,
			hasExtensionIds: ['string', 'string', 'string'],
			addresses: ['', '', '', '', ''],
			hasVoiceAddress: false
		});
	});
});
