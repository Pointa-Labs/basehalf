/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString, MarkdownString } from '../../../../base/common/htmlContent.js';
import { FileAccess } from '../../../../base/common/network.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import * as nls from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { AllowedExtensionsService } from '../../../../platform/extensionManagement/common/allowedExtensionsService.js';
import { IGalleryExtension, IAllowedExtensionsService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { ExtensionType, IExtension, TargetPlatform } from '../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { isBaseHalfAllowedBuiltInExtension, isBaseHalfRequiredBuiltInExtension, isBaseHalfTrustedExternalGalleryIdentity } from './basehalfWorkbenchProfile.js';

type BaseHalfAllowedExtensionTarget =
	| IGalleryExtension
	| IExtension
	| { id: string; uuid?: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform };

/**
 * The extensions that run in BaseHalf (D76; built-in AI Video and no plugins,
 * rule 10): its built-in extensions, the agent extensions installed from the
 * gallery with their exact identity, and the extension that an Extension
 * Development Host was started with, at the location it was started with.
 * Every other extension does not run, and BaseHalf says why where VS Code
 * would show it.
 */
export class BaseHalfAllowedExtensionsService extends AllowedExtensionsService implements IAllowedExtensionsService {

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super(productService, configurationService);
	}

	override isAllowed(extension: IGalleryExtension | IExtension): true | IMarkdownString;
	override isAllowed(extension: { id: string; uuid?: string; publisherDisplayName: string | undefined; version?: string; prerelease?: boolean; targetPlatform?: TargetPlatform }): true | IMarkdownString;
	override isAllowed(extension: BaseHalfAllowedExtensionTarget): true | IMarkdownString {
		const extensionId = getExtensionId(extension);
		const builtIn = isBaseHalfAllowedBuiltInExtension(extensionId);
		const agentExtension = isBaseHalfTrustedExternalGalleryIdentity(extensionId, getExtensionUuid(extension));
		const allowed = isLocalExtension(extension)
			? builtIn
				? extension.type === ExtensionType.System && extension.isBuiltin
				: (agentExtension && extension.source === 'gallery') || this.isDevelopedExtension(extension.location)
			: builtIn || agentExtension;

		if (!allowed) {
			return new MarkdownString(nls.localize(
				'basehalf.extensionNotAllowed',
				"BaseHalf does not run this extension. It runs only its built-in extensions and the agent extensions it supports."
			));
		}

		if (isBaseHalfRequiredBuiltInExtension(extensionId)) {
			return true;
		}

		return super.isAllowed(extension);
	}

	private isDevelopedExtension(location: URI): boolean {
		return !!this.environmentService.isExtensionDevelopment
			&& !!this.environmentService.extensionDevelopmentLocationURI?.some(developed => locationKey(developed) === locationKey(location));
	}
}

function locationKey(location: URI): string {
	return extUri.getComparisonKey(FileAccess.uriToFileUri(location));
}

function getExtensionUuid(extension: BaseHalfAllowedExtensionTarget): string | undefined {
	return hasExtensionIdentifier(extension) ? extension.identifier.uuid : extension.uuid;
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
