/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { FileAccess } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { AllowedExtensionsConfigKey, ILocalExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ExtensionType, IExtensionManifest } from '../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { toExtension, toExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { BaseHalfAllowedExtensionsService, getBaseHalfAllowedExtensionsServiceId } from '../../common/basehalfAllowedExtensionsService.js';
import { BaseHalfPluginAdmissionService, hashBaseHalfPluginInstall } from '../../common/basehalfPluginAdmissionService.js';
import { BASEHALF_CURATED_PLUGINS } from '../../common/basehalfPluginCatalog.js';

const CODEX_GALLERY_UUID = '90b52117-6fd1-4f1c-9e14-256bd6e21d79';
const CLAUDE_GALLERY_UUID = '3c13ae49-babe-45fe-8c48-5e45077a62bf';

suite('BaseHalfAllowedExtensionsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let configurationService: TestConfigurationService;
	let pluginAdmissionService: BaseHalfPluginAdmissionService;
	let pluginFiles: IFileService;

	setup(() => {
		configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(AllowedExtensionsConfigKey, '*');
		pluginFiles = fileService();
		pluginAdmissionService = disposables.add(new BaseHalfPluginAdmissionService(disposables.add(new InMemoryStorageService()), environment(), pluginFiles));
	});

	test('allows only BaseHalf curated product extension ids by default', () => {
		const testObject = createService();

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
		const official = BASEHALF_CURATED_PLUGINS[0];
		assert.ok(official.bundledPath);
		assert.strictEqual(testObject.isAllowed(aLocalExtension(
			official.extensionId,
			ExtensionType.User,
			'0.1.0',
			joinPath(FileAccess.asFileUri(''), '..', ...official.bundledPath.split('/'))
		)), true);
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

	test('admits only exact signed versions, including versions withdrawn from new installation', async () => {
		const testObject = createService();
		const extensionId = 'qa-lab.workflow-smoke';
		const sha256 = 'a'.repeat(64);
		const installedLocation = URI.file(extensionId);
		const installedContentSha256 = await hashBaseHalfPluginInstall(pluginFiles, installedLocation);

		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.1')), true);
		pluginAdmissionService.replaceVerifiedPlugins([{ extensionId, versions: [
			{ version: '0.1.0', sha256: 'b'.repeat(64), installedContentSha256 },
			{ version: '0.1.1', sha256, installedContentSha256 }
		] }]);

		assert.strictEqual(testObject.isAllowed({ id: extensionId, publisherDisplayName: 'QA Lab' }), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.1')), true);
		assert.ok(await pluginAdmissionService.verifyAndRecordInstall({ extensionId, version: '0.1.1', sha256, extensionLocation: installedLocation, expectedInstalledContentSha256: installedContentSha256 }));
		assert.strictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.1')), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.0')), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.0.9')), true);

		pluginAdmissionService.replaceVerifiedPlugins([]);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension(extensionId, ExtensionType.User, '0.1.1')), true);
	});

	test('recomputes extension enablement when verified catalog admission changes', async () => {
		const testObject = createService();
		const promise = Event.toPromise(testObject.onDidChangeAllowedExtensionsConfigValue);

		pluginAdmissionService.replaceVerifiedPlugins([{ extensionId: 'qa-lab.workflow-smoke', versions: [{ version: '0.1.1', sha256: 'a'.repeat(64), installedContentSha256: 'b'.repeat(64) }] }]);

		await promise;
	});

	test('allows an unpublished plugin only at the exact development-host location', () => {
		const developmentLocation = URI.file('/workspace/reviewed-workflow');
		pluginAdmissionService = disposables.add(new BaseHalfPluginAdmissionService(
			disposables.add(new InMemoryStorageService()),
			environment(true, [developmentLocation]),
			fileService()
		));
		const testObject = createService();

		assert.strictEqual(testObject.isAllowed(aLocalExtension('reviewed.workflow', ExtensionType.User, '0.0.1', developmentLocation)), true);
		assert.notStrictEqual(testObject.isAllowed(aLocalExtension('reviewed.workflow', ExtensionType.User, '0.0.1', URI.file('/workspace/reviewed-workflow-copy'))), true);
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

	function fileService(): IFileService {
		return {
			onDidFilesChange: Event.None,
			stat: async (resource: URI) => ({ resource, name: resource.path.split('/').at(-1) ?? '', isDirectory: true, isFile: false, isSymbolicLink: false }),
			resolve: async (resource: URI) => ({
				resource,
				name: resource.path.split('/').at(-1) ?? '',
				isDirectory: true,
				isFile: false,
				isSymbolicLink: false,
				children: [{ resource: joinPath(resource, 'package.json'), name: 'package.json', isDirectory: false, isFile: true, isSymbolicLink: false }]
			}),
			readFile: async (resource: URI) => ({ resource, value: VSBuffer.fromString('{"name":"test"}\n') })
		} as unknown as IFileService;
	}
});
