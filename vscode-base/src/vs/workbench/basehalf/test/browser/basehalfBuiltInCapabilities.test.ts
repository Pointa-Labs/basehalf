/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ILocalExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { ExtensionType, IExtension } from '../../../../platform/extensions/common/extensions.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { EnablementState, IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { BaseHalfBuiltInCapabilityEnablement } from '../../browser/basehalfBuiltInCapabilities.contribution.js';
import { BASEHALF_BUILT_IN_CAPABILITIES, baseHalfBuiltInCapabilityLocation, findBaseHalfBuiltInCapability } from '../../common/basehalfBuiltInCapabilities.js';

suite('BaseHalfBuiltInCapabilities', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const AI_VIDEO = 'pointa.basehalf-ai-video';

	test('lists AI Video as the built-in capability in the application extensions folder', () => {
		assert.deepStrictEqual(BASEHALF_BUILT_IN_CAPABILITIES.map(capability => ({
			extensionId: capability.extensionId,
			builtInPath: capability.builtInPath,
			locationEndsWithPath: baseHalfBuiltInCapabilityLocation(capability).path.endsWith(`/${capability.builtInPath}`)
		})), [{
			extensionId: AI_VIDEO,
			builtInPath: 'extensions/basehalf-ai-video',
			locationEndsWithPath: true
		}]);
		assert.strictEqual(findBaseHalfBuiltInCapability(' Pointa.BaseHalf-AI-Video ')?.extensionId, AI_VIDEO);
		assert.strictEqual(findBaseHalfBuiltInCapability('vscode.git'), undefined);
	});

	test('enables a built-in capability that an earlier build left disabled and nothing else', async () => {
		for (const leftover of [EnablementState.DisabledGlobally, EnablementState.DisabledWorkspace]) {
			const harness = createHarness(new Map([[AI_VIDEO, leftover], ['vscode.emmet', EnablementState.DisabledGlobally]]));
			await harness.contribution.whenChecked;
			assert.deepStrictEqual(harness.enabled, [{ ids: [AI_VIDEO], state: EnablementState.EnabledGlobally }], `leftover state ${leftover}`);
		}
	});

	test('changes nothing when the built-in capability is enabled or is held back by the product', async () => {
		for (const state of [EnablementState.EnabledGlobally, EnablementState.EnabledWorkspace, EnablementState.DisabledByAllowlist]) {
			const harness = createHarness(new Map([[AI_VIDEO, state]]));
			await harness.contribution.whenChecked;
			assert.deepStrictEqual(harness.enabled, [], `state ${state}`);
		}
	});

	test('starts normally when the check itself fails', async () => {
		const harness = createHarness(new Map([[AI_VIDEO, EnablementState.DisabledGlobally]]), new Error('scan failed'));
		await harness.contribution.whenChecked;
		assert.deepStrictEqual(harness.enabled, []);
	});

	function createHarness(states: ReadonlyMap<string, EnablementState>, scanError?: Error) {
		const enabled: { readonly ids: readonly string[]; readonly state: EnablementState }[] = [];
		const installed = [...states.keys()].map(id => ({
			identifier: { id },
			type: ExtensionType.System,
			isBuiltin: true,
			location: URI.file(`/application/extensions/${id}`)
		} as ILocalExtension));
		const extensionManagementService = {
			getInstalled: async (type?: ExtensionType): Promise<ILocalExtension[]> => {
				if (scanError) {
					throw scanError;
				}
				assert.strictEqual(type, ExtensionType.System);
				return installed;
			}
		} as Partial<IWorkbenchExtensionManagementService> as IWorkbenchExtensionManagementService;
		const extensionEnablementService = {
			getEnablementState: (extension: IExtension): EnablementState => states.get(extension.identifier.id) ?? EnablementState.EnabledGlobally,
			setEnablement: async (extensions: IExtension[], state: EnablementState): Promise<boolean[]> => {
				enabled.push({ ids: extensions.map(extension => extension.identifier.id), state });
				return extensions.map(() => true);
			}
		} as Partial<IWorkbenchExtensionEnablementService> as IWorkbenchExtensionEnablementService;
		const contribution = new BaseHalfBuiltInCapabilityEnablement(extensionManagementService, extensionEnablementService, new NullLogService());
		return { contribution, enabled };
	}
});
