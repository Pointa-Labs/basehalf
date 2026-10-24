/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { AllowedExtensionsConfigKey, ILocalExtension } from '../../../../../platform/extensionManagement/common/extensionManagement.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ExtensionType, IExtensionManifest } from '../../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { toExtension, toExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { BaseHalfAllowedExtensionsService } from '../../common/basehalfAllowedExtensionsService.js';

const CODEX_GALLERY_UUID = '90b52117-6fd1-4f1c-9e14-256bd6e21d79';
const CLAUDE_GALLERY_UUID = '3c13ae49-babe-45fe-8c48-5e45077a62bf';

suite('BaseHalfAllowedExtensionsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let configurationService: TestConfigurationService;

	setup(() => {
		configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, '*');
	});

	test('allows only BaseHalf curated product extension ids by default', () => {
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed({ id: 'vscode.theme-defaults', publisherDisplayName: 'vscode' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'vscode.theme-monokai', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.git', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github-authentication', publisherDisplayName: 'vscode' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'openai.chatgpt', publisherDisplayName: 'OpenAI' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'anthropic.claude-code', publisherDisplayName: 'Anthropic' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'openai.chatgpt', uuid: CODEX_GALLERY_UUID, publisherDisplayName: 'OpenAI' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'anthropic.claude-code', uuid: CLAUDE_GALLERY_UUID, publisherDisplayName: 'Anthropic' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'openai.chatgpt', uuid: CLAUDE_GALLERY_UUID, publisherDisplayName: 'OpenAI' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'pointa.basehalf-ai-video', publisherDisplayName: 'Pointa Labs' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'github.copilot', publisherDisplayName: 'GitHub' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'ms-python.python', publisherDisplayName: 'Microsoft' }), true);
	});

	test('keeps required theme and Git/GitHub built-in extensions available even when VS Code allowed extensions configuration is narrower', () => {
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, { 'vscode.git': false, 'vscode.github': true });
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed({ id: 'vscode.theme-defaults', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.git', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.git-base', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github', publisherDisplayName: 'vscode' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'vscode.github-authentication', publisherDisplayName: 'vscode' }), true);
	});

	test('keeps VS Code allowed extensions configuration as an additional restriction for optional agent extensions', () => {
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, { 'openai.chatgpt': false, 'anthropic.claude-code': true });
		const testObject = createService();

		assert.notStrictEqual(testObject.isAllowed({ id: 'openai.chatgpt', uuid: CODEX_GALLERY_UUID, publisherDisplayName: 'OpenAI' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'anthropic.claude-code', uuid: CLAUDE_GALLERY_UUID, publisherDisplayName: 'Anthropic' }), true);
	});

	test('applies product allowlist to local extension objects too', () => {
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed(aLocalExtension('vscode.git', ExtensionType.System)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('vscode.git', ExtensionType.User)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('anthropic.claude-code', ExtensionType.User)), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('openai.chatgpt'), CODEX_GALLERY_UUID, 'gallery')), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension('anthropic.claude-code', ExtensionType.User, '1.0.0', URI.file('anthropic.claude-code'), CLAUDE_GALLERY_UUID, 'gallery')), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('spoofed-openai'), CLAUDE_GALLERY_UUID)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('pointa.basehalf-ai-video', ExtensionType.System)), true);
		// AI Video is BaseHalf's own code (D75): no copy of it runs, also one where an earlier build kept it.
		const builtInLocation = joinPath(FileAccess.asFileUri(''), '..', 'extensions', 'basehalf-ai-video');
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('pointa.basehalf-ai-video', ExtensionType.System, '0.6.0', builtInLocation)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('pointa.basehalf-ai-video', ExtensionType.User, '0.6.0', builtInLocation)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('pointa.basehalf-ai-video', ExtensionType.User, '0.5.0', URI.file('/profile/extensions/pointa.basehalf-ai-video-0.5.0'), undefined, 'gallery')), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('github.copilot', ExtensionType.User)), true);
	});

	test('requires exact gallery identity for external extensions and rejects local id spoofing', () => {
		const testObject = createService();

		assert.notStrictEqual(testObject.isAllowed({ id: 'openai.chatgpt', publisherDisplayName: 'OpenAI' }), true);
		assert.notStrictEqual(testObject.isAllowed({ id: 'openai.chatgpt', uuid: CLAUDE_GALLERY_UUID, publisherDisplayName: 'OpenAI' }), true);
		assert.strictEqual(testObject.isAllowed({ id: 'openai.chatgpt', uuid: CODEX_GALLERY_UUID, publisherDisplayName: 'OpenAI' }), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('wrong-gallery'), CLAUDE_GALLERY_UUID)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('spoofed-vsix'), CODEX_GALLERY_UUID, 'vsix')), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('spoofed-resource'), CODEX_GALLERY_UUID, 'resource')), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('official-gallery'), CODEX_GALLERY_UUID, 'gallery')), true);
		assert.notStrictEqual(testObject.isAllowed(toExtension(toExtensionDescription(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('runtime-vsix'), CODEX_GALLERY_UUID, 'vsix')))), true);
		assert.strictEqual(testObject.isAllowed(toExtension(toExtensionDescription(aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('runtime-gallery'), CODEX_GALLERY_UUID, 'gallery')))), true);
		const manifestSpoof = aLocalExtension('openai.chatgpt', ExtensionType.User, '1.0.0', URI.file('manifest-spoof'), CODEX_GALLERY_UUID, 'vsix');
		Object.assign(manifestSpoof.manifest, { source: 'gallery' });
		assert.notStrictEqual(testObject.isAllowed(toExtension(toExtensionDescription(manifestSpoof))), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('vscode.git', ExtensionType.User)), true);
		assert.strictEqual(testObject.isAllowed(aLocalExtension('vscode.git', ExtensionType.System)), true);
	});

	test('runs the extension of an Extension Development Host only at the location it was started with (D76)', () => {
		const developmentLocation = URI.file('/workspace/workflow');
		const testObject = createService(environment(true, [developmentLocation]));

		assert.strictEqual(testObject.isAllowed(aLocalExtension('studio.workflow', ExtensionType.User, '0.0.1', developmentLocation)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('studio.workflow', ExtensionType.User, '0.0.1', URI.file('/workspace/workflow-copy'))), true);
		assert.notStrictEqual(createService(environment(false, [developmentLocation])).isAllowed(aLocalExtension('studio.workflow', ExtensionType.User, '0.0.1', developmentLocation)), true);
		assert.notStrictEqual(createService().isAllowed(aLocalExtension('studio.workflow', ExtensionType.User, '0.0.1', developmentLocation)), true);
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

	function createService(environmentService = environment()): BaseHalfAllowedExtensionsService {
		return disposables.add(new BaseHalfAllowedExtensionsService(aProductService(), configurationService as IConfigurationService, environmentService));
	}

	function aProductService(): IProductService {
		return {
			_serviceBrand: undefined,
			extensionPublisherOrgs: []
		} as unknown as IProductService;
	}

	function aLocalExtension(id: string, type: ExtensionType, version = '1.0.0', location = URI.file(id), uuid?: string, source: ILocalExtension['source'] = 'vsix'): ILocalExtension {
		const [publisher, name] = id.split('.');
		const manifest: Partial<IExtensionManifest> = { name, publisher, version };

		return {
			type,
			identifier: { id, uuid },
			location,
			manifest,
			isBuiltin: type === ExtensionType.System,
			isValid: true,
			source
		} as ILocalExtension;
	}

	function environment(isExtensionDevelopment = false, extensionDevelopmentLocationURI?: URI[]): IEnvironmentService {
		return { isExtensionDevelopment, extensionDevelopmentLocationURI } as unknown as IEnvironmentService;
	}
});
