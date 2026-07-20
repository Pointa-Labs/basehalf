/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FileAccess } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IGalleryExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { BASEHALF_CURATED_PLUGINS } from '../../common/basehalfPluginCatalog.js';
import { assertBaseHalfGalleryInstallAllowed, assertBaseHalfLocationInstallAllowed, assertBaseHalfVSIXInstallAllowed, authorizeBaseHalfLocationInstall, authorizeBaseHalfVerifiedVSIXInstall, BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT, getBaseHalfPluginLibraryTargetFromExtensionURI } from '../../common/basehalfExtensionInstallPolicy.js';
import { BASEHALF_TRUSTED_EXTERNAL_GALLERY_IDENTITIES } from '../../common/basehalfWorkbenchProfile.js';

suite('BaseHalf extension install policy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const baseHalfProduct = { basehalfVersion: 'test' } as IProductService;
	const upstreamProduct = {} as IProductService;

	test('verified VSIX authorization is exact, one-use, and revocable', () => {
		const first = authorizeBaseHalfVerifiedVSIXInstall('publisher.plugin', '1.2.3');
		const options = { context: { [BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT]: first.token } };
		assert.throws(() => assertBaseHalfVSIXInstallAllowed(baseHalfProduct, 'publisher.other', '1.2.3', options), /reviewed Plugins library/);
		assert.throws(() => assertBaseHalfVSIXInstallAllowed(baseHalfProduct, 'publisher.plugin', '2.0.0', options), /reviewed Plugins library/);
		assert.doesNotThrow(() => assertBaseHalfVSIXInstallAllowed(baseHalfProduct, 'PUBLISHER.PLUGIN', '1.2.3', options));
		assert.throws(() => assertBaseHalfVSIXInstallAllowed(baseHalfProduct, 'publisher.plugin', '1.2.3', options), /reviewed Plugins library/);
		first.disposable.dispose();

		const revoked = authorizeBaseHalfVerifiedVSIXInstall('publisher.plugin', '1.2.3');
		revoked.disposable.dispose();
		assert.throws(() => assertBaseHalfVSIXInstallAllowed(baseHalfProduct, 'publisher.plugin', '1.2.3', {
			context: { [BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT]: revoked.token }
		}), /reviewed Plugins library/);
	});

	test('location authorization is exact and one-use', () => {
		const location = URI.file('/tmp/reviewed-plugin');
		const authorization = authorizeBaseHalfLocationInstall(location);
		assert.throws(() => assertBaseHalfLocationInstallAllowed(baseHalfProduct, URI.file('/tmp/other-plugin')), /reviewed Plugins library/);
		assert.doesNotThrow(() => assertBaseHalfLocationInstallAllowed(baseHalfProduct, location));
		assert.throws(() => assertBaseHalfLocationInstallAllowed(baseHalfProduct, location), /reviewed Plugins library/);
		authorization.dispose();

		const revoked = authorizeBaseHalfLocationInstall(location);
		revoked.dispose();
		assert.throws(() => assertBaseHalfLocationInstallAllowed(baseHalfProduct, location), /reviewed Plugins library/);
	});

	test('only exact bundled locations bypass a transaction authorization', () => {
		const bundledPath = BASEHALF_CURATED_PLUGINS.find(plugin => plugin.bundledPath)?.bundledPath;
		assert.ok(bundledPath);
		const bundledLocation = joinPath(FileAccess.asFileUri(''), '..', ...bundledPath.split('/'));
		assert.doesNotThrow(() => assertBaseHalfLocationInstallAllowed(baseHalfProduct, bundledLocation));
		assert.throws(() => assertBaseHalfLocationInstallAllowed(baseHalfProduct, joinPath(FileAccess.asFileUri(''), ...bundledPath.split('/'))), /reviewed Plugins library/);
		assert.throws(() => assertBaseHalfLocationInstallAllowed(baseHalfProduct, joinPath(bundledLocation, '..')), /reviewed Plugins library/);
	});

	test('gallery installation requires an exact trusted product identity', () => {
		const trustedIdentity = BASEHALF_TRUSTED_EXTERNAL_GALLERY_IDENTITIES[0];
		const extension = (id: string, uuid: string): IGalleryExtension => ({
			type: 'gallery',
			identifier: { id, uuid }
		} as IGalleryExtension);
		assert.doesNotThrow(() => assertBaseHalfGalleryInstallAllowed(baseHalfProduct, extension(trustedIdentity.extensionId, trustedIdentity.galleryUuid)));
		assert.throws(() => assertBaseHalfGalleryInstallAllowed(baseHalfProduct, extension(trustedIdentity.extensionId, '00000000-0000-0000-0000-000000000000')), /reviewed Plugins library/);
		assert.throws(() => assertBaseHalfGalleryInstallAllowed(baseHalfProduct, extension('publisher.plugin', trustedIdentity.galleryUuid)), /reviewed Plugins library/);
	});

	test('upstream products retain their extension installation behavior', () => {
		assert.doesNotThrow(() => assertBaseHalfVSIXInstallAllowed(upstreamProduct, 'publisher.plugin', '1.2.3', undefined));
		assert.doesNotThrow(() => assertBaseHalfLocationInstallAllowed(upstreamProduct, URI.file('/tmp/plugin')));
		assert.doesNotThrow(() => assertBaseHalfGalleryInstallAllowed(upstreamProduct, { type: 'gallery', identifier: { id: 'publisher.plugin' } } as IGalleryExtension));
	});

	test('stock extension links target the Plugins library only in BaseHalf', () => {
		assert.strictEqual(getBaseHalfPluginLibraryTargetFromExtensionURI(baseHalfProduct, URI.parse('basehalf:extension/publisher.plugin')), 'publisher.plugin');
		assert.strictEqual(getBaseHalfPluginLibraryTargetFromExtensionURI(baseHalfProduct, URI.parse('basehalf:extension/publisher.plugin/readme')), undefined);
		assert.strictEqual(getBaseHalfPluginLibraryTargetFromExtensionURI(upstreamProduct, URI.parse('vscode:extension/publisher.plugin')), undefined);
	});
});
