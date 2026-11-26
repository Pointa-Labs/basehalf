/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IGalleryExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { isBaseHalfTrustedExternalGalleryIdentity } from './basehalfWorkbenchProfile.js';

/**
 * Refuses an install in BaseHalf, which installs nothing but the agent
 * extensions, from the gallery by their exact identity (D76; built-in AI
 * Video and no plugins, rule 11). VS Code's ways to install a file, a folder,
 * or another extension call it; outside BaseHalf they work as in VS Code.
 */
export function refuseBaseHalfExtensionInstall(productService: Pick<IProductService, 'basehalfVersion'>): void {
	if (productService.basehalfVersion) {
		throw new Error(localize('basehalfExtensionInstallNotSupported', "BaseHalf cannot install this extension. It runs only its built-in extensions and the agent extensions it supports."));
	}
}

/** Refuses a gallery install in BaseHalf unless it is an agent extension with its exact gallery identity. */
export function assertBaseHalfGalleryInstallAllowed(productService: Pick<IProductService, 'basehalfVersion'>, extension: IGalleryExtension): void {
	if (!isBaseHalfTrustedExternalGalleryIdentity(extension.identifier.id, extension.identifier.uuid)) {
		refuseBaseHalfExtensionInstall(productService);
	}
}
