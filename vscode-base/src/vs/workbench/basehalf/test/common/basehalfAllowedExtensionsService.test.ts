/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { AllowedExtensionsConfigKey, ILocalExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { ExtensionType, IExtensionManifest } from '../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { BaseHalfAllowedExtensionsService, getBaseHalfAllowedExtensionsServiceId } from '../../common/basehalfAllowedExtensionsService.js';
import { BaseHalfPluginAdmissionService } from '../../common/basehalfPluginAdmissionService.js';

suite('BaseHalfAllowedExtensionsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let configurationService: TestConfigurationService;
	let pluginAdmissionService: BaseHalfPluginAdmissionService;

	setup(() => {
		configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, '*');
		pluginAdmissionService = disposables.add(new BaseHalfPluginAdmissionService());
	});

	test('allows only BaseHalf curated product extension ids by default', () => {
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed({ id: 'vscode.git', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github-authentication', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'openai.chatgpt', publisherDisplayName: 'OpenAI' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'anthropic.claude-code', publisherDisplayName: 'Anthropic' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'pointa.basehalf-ai-video', publisherDisplayName: 'Pointa Labs' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'github.copilot', publisherDisplayName: 'GitHub' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'ms-python.python', publisherDisplayName: 'Microsoft' }), true);
	});

	test('keeps required Git/GitHub built-in extensions available even when VS Code allowed extensions configuration is narrower', () => {
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, { 'vscode.git': false, 'vscode.github': true });
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed({ id: 'vscode.git', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.git-base', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github-authentication', publisherDisplayName: 'vscode' }), true);
	});

	test('keeps VS Code allowed extensions configuration as an additional restriction for optional agent extensions', () => {
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, { 'openai.chatgpt': false, 'anthropic.claude-code': true });
		const testObject = createService();

		assert.notStrictEqual(testObject.isAllowed({ id: 'openai.chatgpt', publisherDisplayName: 'OpenAI' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'anthropic.claude-code', publisherDisplayName: 'Anthropic' }), true);
	});

	test('applies product allowlist to local extension objects too', () => {
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed(aLocalExtension('vscode.git', ExtensionType.System)), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User)), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension('anthropic.claude-code', ExtensionType.User)), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension('pointa.basehalf-ai-video', ExtensionType.System)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('github.copilot', ExtensionType.User)), true);
	});

	test('admits only exact signed versions, including versions withdrawn from new installation', () => {
		const testObject = createService();
		const extensionId = 'qa-lab.workflow-smoke';

		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.1')), true);
		pluginAdmissionService.replaceVerifiedPlugins([{ extensionId, versions: ['0.1.0', '0.1.1'] }]);

		assert.strictEqual(testObject.isAllowed({ id: extensionId, publisherDisplayName: 'QA Lab' }), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.1')), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.0')), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.0.9')), true);

		pluginAdmissionService.replaceVerifiedPlugins([]);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.1')), true);
	});

	test('recomputes extension enablement when verified catalog admission changes', async () => {
		const testObject = createService();
		const promise = Event.toPromise(testObject.onDidChangeAllowedExtensionsConfigValue);

		pluginAdmissionService.replaceVerifiedPlugins([{ extensionId: 'qa-lab.workflow-smoke', versions: ['0.1.1'] }]);

		await promise;
	});

	test('keeps change events wired through VS Code configuration service', async () => {
		const testObject = createService();
		const promise = Event.toPromise(testObject.onDidChangeAllowedExtensionsConfigValue);

		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, { 'vscode.git': true });
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: key => key === AllowedExtensionsConfigKey,
			affectedKeys: new Set([AllowedExtensionsConfigKey]),
			change: { keys: [], overrides: [] },
			source: 1
		});

		await promise;
	});

	test('exposes a stable service id for logging and diagnostics', () => {
		assert.strictEqual(getBaseHalfAllowedExtensionsServiceId(), 'basehalf.canvasWorkbench.allowedExtensions');
	});

	function createService(): BaseHalfAllowedExtensionsService {
		return disposables.add(new BaseHalfAllowedExtensionsService(aProductService(), configurationService as IConfigurationService, pluginAdmissionService));
	}

	function aProductService(): IProductService {
		return {
			_serviceBrand: undefined,
			extensionPublisherOrgs: []
		} as unknown as IProductService;
	}

	function aLocalExtension(id: string, type: ExtensionType, version = '1.0.0'): ILocalExtension {
		const [publisher, name] = id.split('.');
		const manifest: Partial<IExtensionManifest> = { name, publisher, version };

		return {
			type,
			identifier: { id },
			location: URI.file(id),
			manifest,
			isBuiltin: type === ExtensionType.System,
			isValid: true
		} as ILocalExtension;
	}
});
