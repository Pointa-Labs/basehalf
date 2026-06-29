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

suite('BaseHalfAllowedExtensionsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let configurationService: TestConfigurationService;

	setup(() => {
		configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, '*');
	});

	test('allows only BaseHalf curated product extension ids by default', () => {
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed({ id: 'vscode.git', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github-authentication', publisherDisplayName: 'vscode' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'github.copilot', publisherDisplayName: 'GitHub' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'ms-python.python', publisherDisplayName: 'Microsoft' }), true);
	});

	test('keeps VS Code allowed extensions configuration as an additional restriction', () => {
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, { 'vscode.git': false, 'vscode.github': true });
		const testObject = createService();

		assert.notStrictEqual(testObject.isAllowed({ id: 'vscode.git', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github', publisherDisplayName: 'vscode' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'vscode.github-authentication', publisherDisplayName: 'vscode' }), true);
	});

	test('applies product allowlist to local extension objects too', () => {
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed(aLocalExtension('vscode.git', ExtensionType.System)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('github.copilot', ExtensionType.User)), true);
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
		return disposables.add(new BaseHalfAllowedExtensionsService(aProductService(), configurationService as IConfigurationService));
	}

	function aProductService(): IProductService {
		return {
			_serviceBrand: undefined,
			extensionPublisherOrgs: []
		} as unknown as IProductService;
	}

	function aLocalExtension(id: string, type: ExtensionType): ILocalExtension {
		const [publisher, name] = id.split('.');
		const manifest: Partial<IExtensionManifest> = { name, publisher, version: '1.0.0' };

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
