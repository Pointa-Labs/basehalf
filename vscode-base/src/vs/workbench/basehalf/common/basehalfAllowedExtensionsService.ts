/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString, MarkdownString } from '../../../base/common/htmlContent.js';
import * as nls from '../../../nls.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { AllowedExtensionsService } from '../../../platform/extensionManagement/common/allowedExtensionsService.js';
import { IGalleryExtension, IAllowedExtensionsService } from '../../../platform/extensionManagement/common/extensionManagement.js';
import { ExtensionType, IExtension, TargetPlatform } from '../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { BASEHALF_PRODUCT_PROFILE_ID, isBaseHalfAllowedProductExtension } from './basehalfWorkbenchProfile.js';

type BaseHalfAllowedExtensionTarget =
	| IGalleryExtension
	| IExtension
	| { id: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform };

export class BaseHalfAllowedExtensionsService extends AllowedExtensionsService implements IAllowedExtensionsService {

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(productService, configurationService);
	}

	override isAllowed(extension: IGalleryExtension | IExtension): true | IMarkdownString;
	override isAllowed(extension: { id: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform }): true | IMarkdownString;
	override isAllowed(extension: BaseHalfAllowedExtensionTarget): true | IMarkdownString {
		if (!isBaseHalfAllowedProductExtension(getExtensionId(extension))) {
			return new MarkdownString(nls.localize(
				'basehalf.extensionNotAllowed',
				"This extension is outside the BaseHalf product profile. BaseHalf currently allows only curated Git, GitHub, GitHub Authentication, Codex, and Claude agent extension slots."
			));
		}

		return super.isAllowed(extension);
	}
}

function getExtensionId(extension: BaseHalfAllowedExtensionTarget): string {
	if (hasExtensionIdentifier(extension)) {
		return extension.identifier.id;
	}

	return extension.id;
}

function hasExtensionIdentifier(extension: BaseHalfAllowedExtensionTarget): extension is IGalleryExtension | IExtension {
	return 'identifier' in extension
		&& !!extension.identifier
		&& typeof extension.identifier.id === 'string'
		&& (!('type' in extension) || extension.type === 'gallery' || extension.type === ExtensionType.User || extension.type === ExtensionType.System);
}

export function getBaseHalfAllowedExtensionsServiceId(): string {
	return `${BASEHALF_PRODUCT_PROFILE_ID}.allowedExtensions`;
}
