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
import { IBaseHalfPluginAdmissionService } from './basehalfPluginAdmissionService.js';
import { BASEHALF_PRODUCT_PROFILE_ID, isBaseHalfAllowedBuiltInExtension, isBaseHalfRequiredBuiltInExtension, isBaseHalfTrustedExternalGalleryIdentity } from './basehalfWorkbenchProfile.js';

type BaseHalfAllowedExtensionTarget =
	| IGalleryExtension
	| IExtension
	| { id: string; uuid?: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform };

export class BaseHalfAllowedExtensionsService extends AllowedExtensionsService implements IAllowedExtensionsService {

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super(productService, configurationService);
		this._register(this.pluginAdmissionService.onDidChange(() => this.fireDidChangeAllowedExtensions()));
	}

	override isAllowed(extension: IGalleryExtension | IExtension): true | IMarkdownString;
	override isAllowed(extension: { id: string; uuid?: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform }): true | IMarkdownString;
	override isAllowed(extension: BaseHalfAllowedExtensionTarget): true | IMarkdownString {
		const extensionId = getExtensionId(extension);
		const productBuiltIn = isBaseHalfAllowedBuiltInExtension(extensionId);
		const trustedExternalGalleryIdentity = isBaseHalfTrustedExternalGalleryIdentity(extensionId, getExtensionUuid(extension));
		const trustedExternalGalleryInstall = trustedExternalGalleryIdentity && isGalleryInstalledExtension(extension);
		const admitted = isLocalExtension(extension)
			? productBuiltIn
				? extension.type === ExtensionType.System && extension.isBuiltin
				: trustedExternalGalleryInstall || this.pluginAdmissionService.isAllowedContributor({
				extensionId,
				version: extension.manifest.version,
				extensionLocation: extension.location,
				isBuiltin: extension.isBuiltin,
				isUnderDevelopment: true
				})
			: productBuiltIn || trustedExternalGalleryIdentity || this.pluginAdmissionService.isAllowed(extensionId, getExtensionVersion(extension));

		if (!admitted) {
			return new MarkdownString(nls.localize(
				'basehalf.extensionNotAllowed',
				"This extension is outside the BaseHalf product profile. BaseHalf currently allows only curated source-control, Agent Area, and signed reviewed plugin extensions."
			));
		}

		if (isBaseHalfRequiredBuiltInExtension(extensionId)) {
			return true;
		}

		return super.isAllowed(extension);
	}
}

function getExtensionUuid(extension: BaseHalfAllowedExtensionTarget): string | undefined {
	return hasExtensionIdentifier(extension) ? extension.identifier.uuid : extension.uuid;
}

function getExtensionVersion(extension: BaseHalfAllowedExtensionTarget): string | undefined {
	if (hasExtensionIdentifier(extension)) {
		return extension.type === 'gallery' ? extension.version : extension.manifest.version;
	}
	return extension.version;
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

function isLocalExtension(extension: BaseHalfAllowedExtensionTarget): extension is IExtension {
	return hasExtensionIdentifier(extension) && extension.type !== 'gallery';
}

function isGalleryInstalledExtension(extension: BaseHalfAllowedExtensionTarget): boolean {
	return isLocalExtension(extension) && extension.source === 'gallery';
}

export function getBaseHalfAllowedExtensionsServiceId(): string {
	return `${BASEHALF_PRODUCT_PROFILE_ID}.allowedExtensions`;
}
