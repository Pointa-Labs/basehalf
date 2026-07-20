/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FileAccess } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfBundledPluginLocation, baseHalfPluginLocationsEqual, baseHalfPluginPayloadLocation, BASEHALF_CURATED_PLUGINS, BASEHALF_MANAGE_PLUGINS_COMMAND_ID, BASEHALF_PLUGINS_VIEW_CONTAINER_ID, BASEHALF_PLUGINS_VIEW_ID, parseBaseHalfPluginCatalogIndex, parseBaseHalfPluginDeepLink, parseBaseHalfRemotePluginCatalog, resolveBaseHalfPluginAsset, resolveBaseHalfPluginCatalog, resolveBaseHalfPluginCatalogIndexResource } from '../../common/basehalfPluginCatalog.js';
import { baseHalfVerifiedPluginAdmissions } from '../../common/basehalfPluginCatalogService.js';

suite('BaseHalfPluginCatalog', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('is a product-owned curated catalog rather than a marketplace query', () => {
		assert.strictEqual(BASEHALF_MANAGE_PLUGINS_COMMAND_ID, 'basehalf.managePlugins');
		assert.strictEqual(BASEHALF_PLUGINS_VIEW_CONTAINER_ID, 'basehalf.view.plugins');
		assert.strictEqual(BASEHALF_PLUGINS_VIEW_ID, 'basehalf.plugins');
		assert.deepStrictEqual(BASEHALF_CURATED_PLUGINS.map(plugin => plugin.extensionId), ['pointa.basehalf-ai-video']);
		assert.strictEqual(BASEHALF_CURATED_PLUGINS[0].galleryUuid, 'a7e47f42-807f-4ac0-93e7-65d03c42c7df');
		assert.strictEqual(BASEHALF_CURATED_PLUGINS[0].category, 'Domain');
		assert.strictEqual(BASEHALF_CURATED_PLUGINS[0].bundledPath, 'plugins/basehalf-ai-video');
		assert.strictEqual(BASEHALF_CURATED_PLUGINS[0].developmentPath, 'extensions/basehalf-ai-video');
		assert.strictEqual(BASEHALF_CURATED_PLUGINS[0].primaryCommand, 'pointa.basehalf-ai-video.createWorkflow');
		const applicationRoot = joinPath(FileAccess.asFileUri(''), '..');
		const bundledLocation = joinPath(applicationRoot, 'plugins', 'basehalf-ai-video');
		const developmentLocation = joinPath(applicationRoot, 'extensions', 'basehalf-ai-video');
		assert.strictEqual(baseHalfBundledPluginLocation(BASEHALF_CURATED_PLUGINS[0])?.toString(), bundledLocation.toString());
		assert.strictEqual(baseHalfPluginPayloadLocation(BASEHALF_CURATED_PLUGINS[0], false)?.toString(), developmentLocation.toString());
		assert.strictEqual(baseHalfPluginPayloadLocation(BASEHALF_CURATED_PLUGINS[0], true)?.toString(), bundledLocation.toString());
		const fileLocation = URI.file('/application/extensions/basehalf-ai-video');
		assert.strictEqual(baseHalfPluginLocationsEqual(fileLocation, fileLocation.with({ scheme: 'vscode-file', authority: 'vscode-app' })), true);
		assert.strictEqual(baseHalfPluginLocationsEqual(developmentLocation, joinPath(developmentLocation, '..')), false);
	});

	test('parses website plugin links without granting installation authority', () => {
		assert.strictEqual(
			parseBaseHalfPluginDeepLink(URI.parse('basehalf://plugins/pointa.basehalf-ai-video'), 'basehalf'),
			'pointa.basehalf-ai-video'
		);
		assert.strictEqual(
			parseBaseHalfPluginDeepLink(URI.parse('basehalf://plugins/COMMUNITY.STORYBOARD'), 'basehalf'),
			'community.storyboard'
		);
		assert.strictEqual(parseBaseHalfPluginDeepLink(URI.parse('https://plugins/pointa.basehalf-ai-video'), 'basehalf'), undefined);
		assert.strictEqual(parseBaseHalfPluginDeepLink(URI.parse('basehalf://plugins/pointa.basehalf-ai-video/extra'), 'basehalf'), undefined);
		assert.strictEqual(parseBaseHalfPluginDeepLink(URI.parse('basehalf://plugins/not-an-extension-id'), 'basehalf'), undefined);
	});

	test('admits reviewed signed-catalog plugins and selects compatible versions', () => {
		const catalog = parseBaseHalfRemotePluginCatalog({
			schemaVersion: 1,
			sequence: 7,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'pointa.basehalf-ai-video',
				label: 'AI Video',
				description: 'Remote metadata',
				category: 'Domain',
				versions: [
					version('0.2.0', { basehalfRange: '^0.5.0' }),
					version('0.1.1')
				]
			}, {
				extensionId: 'community.storyboard',
				label: 'Storyboard',
				description: 'Reviewed community workflow',
				category: 'Domain',
				publisher: { slug: 'community', displayName: 'Community Studio', trust: 'reviewed' },
				primaryCommand: 'community.storyboard.createProject',
				primaryCommandLabel: 'Create Storyboard Project…',
				versions: [version('1.0.0', { extensionId: 'community.storyboard' })]
			}]
		}, ['pointa.basehalf-ai-video']);

		assert.strictEqual(catalog.plugins.length, 2);
		const resolved = resolveBaseHalfPluginCatalog(BASEHALF_CURATED_PLUGINS, catalog, {
			basehalf: '0.4.1',
			vscode: '1.128.0',
			targetPlatform: 'darwin-arm64'
		});
		assert.strictEqual(resolved[0].remoteVersion?.version, '0.1.1');
		assert.strictEqual(resolved[1].extensionId, 'community.storyboard');
		assert.strictEqual(resolved[1].publisher.displayName, 'Community Studio');
		assert.strictEqual(resolved[1].remoteVersion?.version, '1.0.0');
		assert.strictEqual(resolved[1].primaryCommand, 'community.storyboard.createProject');
	});

	test('requires reviewed Publisher provenance for non-official catalog entries', () => {
		const root = {
			schemaVersion: 1,
			sequence: 8,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'community.storyboard',
				label: 'Storyboard',
				description: 'Community workflow',
				category: 'Domain',
				versions: [version('1.0.0', { extensionId: 'community.storyboard' })]
			}]
		};
		assert.throws(() => parseBaseHalfRemotePluginCatalog(root, ['pointa.basehalf-ai-video']), /must declare its Publisher/);
		assert.throws(() => parseBaseHalfRemotePluginCatalog({
			...root,
			plugins: [{ ...root.plugins[0], publisher: { slug: 'community', displayName: 'Community', trust: 'official' } }]
		}, ['pointa.basehalf-ai-video']), /cannot claim official trust/);
		assert.throws(() => parseBaseHalfRemotePluginCatalog({
			...root,
			plugins: [{ ...root.plugins[0], publisher: { slug: 'community', displayName: 'Community', trust: 'reviewed' } }]
		}, ['pointa.basehalf-ai-video']), /must declare its primary action/);
		assert.throws(() => parseBaseHalfRemotePluginCatalog({
			...root,
			plugins: [{
				...root.plugins[0],
				extensionId: 'pointa.community-tool',
				publisher: { slug: 'pointa', displayName: 'Impersonator', trust: 'reviewed' },
				primaryCommand: 'pointa.community-tool.create',
				primaryCommandLabel: 'Create',
				versions: [version('1.0.0', { extensionId: 'pointa.community-tool' })]
			}]
		}, ['pointa.basehalf-ai-video']), /reserved Publisher namespace 'pointa'/);
	});

	test('admits exact compatible package identities from a signature-verified catalog', () => {
		const catalog = parseBaseHalfRemotePluginCatalog({
			schemaVersion: 1,
			sequence: 9,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'pointa.basehalf-ai-video',
				label: 'AI Video',
				description: 'Official plugin',
				category: 'Domain',
				versions: [
					version('0.3.0', { basehalfRange: '^9.0.0' }),
					version('0.2.0'),
					version('0.1.0', { status: 'withdrawn' })
				]
			}, {
				extensionId: 'community.workflow',
				label: 'Workflow',
				description: 'Reviewed plugin',
				category: 'Domain',
				publisher: { slug: 'community', displayName: 'Community', trust: 'reviewed' },
				primaryCommand: 'community.workflow.create',
				primaryCommandLabel: 'Create Workflow',
				versions: [version('1.0.0', { extensionId: 'community.workflow' })]
			}]
		}, ['pointa.basehalf-ai-video']);

		assert.deepStrictEqual(baseHalfVerifiedPluginAdmissions(catalog, {
			basehalf: '0.4.1',
			vscode: '1.128.0',
			targetPlatform: 'darwin-arm64'
		}), [{
			extensionId: 'pointa.basehalf-ai-video',
			versions: [
				{ version: '0.2.0', sha256: 'a'.repeat(64), installedContentSha256: 'b'.repeat(64) },
				{ version: '0.1.0', sha256: 'a'.repeat(64), installedContentSha256: 'b'.repeat(64) }
			]
		}, {
			extensionId: 'community.workflow',
			versions: [{ version: '1.0.0', sha256: 'a'.repeat(64), installedContentSha256: 'b'.repeat(64) }]
		}]);
	});

	test('retains signed admission grants beyond the former rolling window', () => {
		const versions = Array.from({ length: 51 }, (_, index) => version(`0.0.${51 - index}`));
		const catalog = parseBaseHalfRemotePluginCatalog({
			schemaVersion: 1,
			sequence: 10,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'pointa.basehalf-ai-video',
				label: 'AI Video',
				description: 'Official plugin',
				category: 'Domain',
				versions
			}]
		}, ['pointa.basehalf-ai-video']);
		const grants = baseHalfVerifiedPluginAdmissions(catalog, {
			basehalf: '0.4.1',
			vscode: '1.128.0',
			targetPlatform: 'darwin-arm64'
		});
		assert.strictEqual(catalog.plugins[0].versions.length, 51);
		assert.strictEqual(grants[0].versions.length, 51);
		assert.strictEqual(grants[0].versions.some(grant => grant.version === '0.0.1'), true);
	});

	test('rejects unsafe catalog asset paths and digests', () => {
		const versionWithoutInstalledContent = version('0.1.0');
		delete versionWithoutInstalledContent.installedContentSha256;
		assert.throws(() => parseBaseHalfRemotePluginCatalog({
			schemaVersion: 1,
			sequence: 1,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'pointa.basehalf-ai-video',
				label: 'AI Video',
				description: 'Missing installed digest',
				category: 'Domain',
				versions: [versionWithoutInstalledContent]
			}]
		}, ['pointa.basehalf-ai-video']), /installed-content SHA-256/);
		assert.throws(() => parseBaseHalfRemotePluginCatalog({
			schemaVersion: 1,
			sequence: 1,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'pointa.basehalf-ai-video',
				label: 'AI Video',
				description: 'Non-canonical archive digest',
				category: 'Domain',
				versions: [version('0.1.0', { sha256: 'A'.repeat(64) })]
			}]
		}, ['pointa.basehalf-ai-video']), /Plugin catalog SHA-256/);
		assert.throws(() => parseBaseHalfRemotePluginCatalog({
			schemaVersion: 1,
			sequence: 1,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'pointa.basehalf-ai-video',
				label: 'AI Video',
				description: 'Non-canonical digest',
				category: 'Domain',
				versions: [version('0.1.0', { installedContentSha256: 'B'.repeat(64) })]
			}]
		}, ['pointa.basehalf-ai-video']), /installed-content SHA-256/);
		assert.throws(() => parseBaseHalfRemotePluginCatalog({
			schemaVersion: 1,
			sequence: 1,
			generatedAt: '2026-07-13T00:00:00.000Z',
			plugins: [{
				extensionId: 'pointa.basehalf-ai-video',
				label: 'AI Video',
				description: 'Unsafe',
				category: 'Domain',
				versions: [version('0.1.0', { assetPath: '../escape.vsix' })]
			}]
		}, ['pointa.basehalf-ai-video']), /invalid path segment/);
		assert.throws(() => resolveBaseHalfPluginAsset('http://plugins.example.com', 'plugin.vsix'), /HTTPS/);
		assert.strictEqual(resolveBaseHalfPluginAsset('https://plugins.basehalf.com/assets', 'pointa/video.vsix').href, 'https://plugins.basehalf.com/assets/pointa/video.vsix');
		assert.strictEqual(resolveBaseHalfPluginAsset('http://127.0.0.1:8123/assets/', 'pointa/video.vsix').href, 'http://127.0.0.1:8123/assets/pointa/video.vsix');
	});

	test('rejects non-canonical catalog version identities', () => {
		for (const versionValue of ['v1.0.0', ' 1.0.0 ', '1.0.0+build.1']) {
			assert.throws(() => parseBaseHalfRemotePluginCatalog({
				schemaVersion: 1,
				sequence: 1,
				generatedAt: '2026-07-13T00:00:00.000Z',
				plugins: [{
					extensionId: 'pointa.basehalf-ai-video',
					label: 'AI Video',
					description: 'Official plugin',
					category: 'Domain',
					versions: [version(versionValue)]
				}]
			}, ['pointa.basehalf-ai-video']), /canonical SemVer without build metadata/);
		}
	});

	test('resolves one atomic index to an immutable catalog/signature pair', () => {
		const index = parseBaseHalfPluginCatalogIndex({
			schemaVersion: 1,
			sequence: 42,
			catalogPath: 'catalogs/42/catalog.json',
			signaturePath: 'catalogs/42/catalog.sig.json'
		});
		assert.strictEqual(index.sequence, 42);
		assert.strictEqual(resolveBaseHalfPluginCatalogIndexResource('https://plugins.basehalf.com/v1/catalog-index.json', index.catalogPath).href, 'https://plugins.basehalf.com/catalogs/42/catalog.json');
		assert.throws(() => parseBaseHalfPluginCatalogIndex({ ...index, signaturePath: 'catalogs/41/catalog.sig.json' }), /must be 'catalogs\/42\/catalog.sig.json'/);
		assert.throws(() => resolveBaseHalfPluginCatalogIndexResource('https://plugins.basehalf.com/v1/catalog-index.json', '../catalog.json'), /invalid path segment/);
	});
});


function version(versionValue: string, overrides: Partial<Record<'extensionId' | 'basehalfRange' | 'vscodeRange' | 'targetPlatform' | 'assetPath' | 'sha256' | 'installedContentSha256' | 'size' | 'publishedAt' | 'status' | 'releaseNotes', string | number>> = {}): Record<string, unknown> {
	const extensionId = typeof overrides.extensionId === 'string' ? overrides.extensionId : 'pointa.basehalf-ai-video';
	const releaseOverrides = { ...overrides };
	delete releaseOverrides.extensionId;
	return {
		version: versionValue,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		assetPath: `${extensionId}/${versionValue}/${'a'.repeat(64)}.vsix`,
		sha256: 'a'.repeat(64),
		installedContentSha256: 'b'.repeat(64),
		size: 1024,
		publishedAt: '2026-07-13T00:00:00.000Z',
		status: 'active',
		...releaseOverrides
	};
}
