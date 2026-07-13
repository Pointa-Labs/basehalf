/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BASEHALF_CURATED_PLUGINS, BASEHALF_MANAGE_PLUGINS_COMMAND_ID, BASEHALF_PLUGINS_VIEW_CONTAINER_ID, BASEHALF_PLUGINS_VIEW_ID, parseBaseHalfPluginCatalogIndex, parseBaseHalfRemotePluginCatalog, resolveBaseHalfPluginAsset, resolveBaseHalfPluginCatalog, resolveBaseHalfPluginCatalogIndexResource } from '../../common/basehalfPluginCatalog.js';

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
		assert.strictEqual(BASEHALF_CURATED_PLUGINS[0].primaryCommand, 'basehalf.aiVideo.createProject');
	});

	test('accepts only admitted remote plugins and selects the latest compatible version', () => {
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
				extensionId: 'unknown.not-admitted',
				label: 'Unknown',
				description: 'Ignored by this client',
				category: 'Domain',
				versions: [version('1.0.0')]
			}]
		}, ['pointa.basehalf-ai-video']);

		assert.strictEqual(catalog.plugins.length, 1);
		const [resolved] = resolveBaseHalfPluginCatalog(BASEHALF_CURATED_PLUGINS, catalog, {
			basehalf: '0.4.1',
			vscode: '1.128.0',
			targetPlatform: 'darwin-arm64'
		});
		assert.strictEqual(resolved.remoteVersion?.version, '0.1.1');
	});

	test('rejects unsafe catalog asset paths and digests', () => {
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

function version(versionValue: string, overrides: Partial<Record<'basehalfRange' | 'vscodeRange' | 'targetPlatform' | 'assetPath' | 'sha256' | 'size' | 'publishedAt' | 'status', string | number>> = {}): Record<string, unknown> {
	return {
		version: versionValue,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		assetPath: `pointa.basehalf-ai-video/${versionValue}/${'a'.repeat(64)}.vsix`,
		sha256: 'a'.repeat(64),
		size: 1024,
		publishedAt: '2026-07-13T00:00:00.000Z',
		status: 'active',
		...overrides
	};
}
