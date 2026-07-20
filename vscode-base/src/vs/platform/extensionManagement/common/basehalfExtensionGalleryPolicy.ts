/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString, MarkdownString } from '../../../base/common/htmlContent.js';
import * as nls from '../../../nls.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IExtension, TargetPlatform } from '../../extensions/common/extensions.js';
import { IProductService } from '../../product/common/productService.js';
import { AllowedExtensionsService } from './allowedExtensionsService.js';
import { IAllowedExtensionsService, IGalleryExtension } from './extensionManagement.js';

export const BASEHALF_TRUSTED_EXTERNAL_GALLERY_IDENTITIES = [
	{ extensionId: 'openai.chatgpt', galleryUuid: '90b52117-6fd1-4f1c-9e14-256bd6e21d79' },
	{ extensionId: 'anthropic.claude-code', galleryUuid: '3c13ae49-babe-45fe-8c48-5e45077a62bf' }
] as const;

export function isBaseHalfTrustedExternalGalleryIdentity(extensionId: string, galleryUuid: string | undefined): boolean {
	if (!galleryUuid) {
		return false;
	}
	const normalizedId = extensionId.trim().toLowerCase();
	const normalizedUuid = galleryUuid.trim().toLowerCase();
	return BASEHALF_TRUSTED_EXTERNAL_GALLERY_IDENTITIES.some(identity =>
		identity.extensionId === normalizedId && identity.galleryUuid === normalizedUuid
	);
}

type AllowedExtensionTarget =
	| IGalleryExtension
	| IExtension
	| { id: string; uuid?: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform };

/**
 * The native extension server runs outside the workbench process. It therefore
 * enforces the product's gallery boundary independently so background services
 * cannot bypass the reviewed installation surface.
 */
export class BaseHalfServerAllowedExtensionsService extends AllowedExtensionsService implements IAllowedExtensionsService {

	constructor(
		@IProductService private readonly productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(productService, configurationService);
	}

	override isAllowed(extension: IGalleryExtension | IExtension): true | IMarkdownString;
	override isAllowed(extension: { id: string; uuid?: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform }): true | IMarkdownString;
	override isAllowed(extension: AllowedExtensionTarget): true | IMarkdownString {
		if (this.productService.basehalfVersion && isGalleryExtension(extension)
			&& !isBaseHalfTrustedExternalGalleryIdentity(extension.identifier.id, extension.identifier.uuid)) {
			return new MarkdownString(nls.localize(
				'basehalf.serverGalleryExtensionNotAllowed',
				"This extension can be installed only through BaseHalf's reviewed Plugins library."
			));
		}
		return super.isAllowed(extension);
	}
}

function isGalleryExtension(extension: AllowedExtensionTarget): extension is IGalleryExtension {
	return (extension as IGalleryExtension).type === 'gallery';
}
