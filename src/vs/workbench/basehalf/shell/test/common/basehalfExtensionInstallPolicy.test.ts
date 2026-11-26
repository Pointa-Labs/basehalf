/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IGalleryExtension } from '../../../../../platform/extensionManagement/common/extensionManagement.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { assertBaseHalfGalleryInstallAllowed, refuseBaseHalfExtensionInstall } from '../../common/basehalfExtensionInstallPolicy.js';
import { BASEHALF_TRUSTED_EXTERNAL_GALLERY_IDENTITIES } from '../../common/basehalfWorkbenchProfile.js';

suite('BaseHalf extension install policy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const baseHalfProduct = { basehalfVersion: 'test' } as IProductService;
	const upstreamProduct = {} as IProductService;
	const galleryExtension = (id: string, uuid?: string): IGalleryExtension => ({ type: 'gallery', identifier: { id, uuid } } as IGalleryExtension);

	test('installs an agent extension from the gallery only with its exact identity (D76)', () => {
		const agent = BASEHALF_TRUSTED_EXTERNAL_GALLERY_IDENTITIES[0];
		assert.doesNotThrow(() => assertBaseHalfGalleryInstallAllowed(baseHalfProduct, galleryExtension(agent.extensionId, agent.galleryUuid)));
		assert.throws(() => assertBaseHalfGalleryInstallAllowed(baseHalfProduct, galleryExtension(agent.extensionId, '00000000-0000-0000-0000-000000000000')), /cannot install this extension/);
		assert.throws(() => assertBaseHalfGalleryInstallAllowed(baseHalfProduct, galleryExtension('publisher.other', agent.galleryUuid)), /cannot install this extension/);
	});

	test('refuses every other install with one message, and leaves VS Code its own behavior', () => {
		assert.throws(() => refuseBaseHalfExtensionInstall(baseHalfProduct), (error: Error) => error.message === 'BaseHalf cannot install this extension. It runs only its built-in extensions and the agent extensions it supports.');
		assert.doesNotThrow(() => refuseBaseHalfExtensionInstall(upstreamProduct));
		assert.doesNotThrow(() => assertBaseHalfGalleryInstallAllowed(upstreamProduct, galleryExtension('publisher.other')));
	});
});
