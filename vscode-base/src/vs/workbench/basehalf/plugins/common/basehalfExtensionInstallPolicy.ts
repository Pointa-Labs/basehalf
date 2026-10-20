/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IGalleryExtension, InstallOptions } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { baseHalfPluginLocationComparisonKey } from './basehalfPluginCatalog.js';
import { isBaseHalfTrustedExternalGalleryIdentity } from '../../shell/common/basehalfWorkbenchProfile.js';

export const BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT = 'basehalfVerifiedInstall';

interface IBaseHalfVSIXInstallAuthorization {
	readonly extensionId: string;
	readonly version: string;
}

const pendingVSIXInstalls = new Map<string, IBaseHalfVSIXInstallAuthorization>();
const pendingLocationInstalls = new Map<string, number>();

export function assertBaseHalfReviewedPluginInstallSurface(productService: Pick<IProductService, 'basehalfVersion'>): void {
	if (productService.basehalfVersion) {
		throw new Error(localize('basehalfExtensionInstallNotSupported', "BaseHalf cannot install this extension. It runs only its built-in extensions and the agent extensions it supports."));
	}
}

export function authorizeBaseHalfVerifiedVSIXInstall(extensionId: string, version: string): { readonly token: string; readonly disposable: IDisposable } {
	const token = generateUuid();
	const authorization = { extensionId: extensionId.toLowerCase(), version };
	pendingVSIXInstalls.set(token, authorization);
	return {
		token,
		disposable: toDisposable(() => {
			if (pendingVSIXInstalls.get(token) === authorization) {
				pendingVSIXInstalls.delete(token);
			}
		})
	};
}

export function authorizeBaseHalfLocationInstall(location: URI): IDisposable {
	const key = baseHalfPluginLocationComparisonKey(location);
	pendingLocationInstalls.set(key, (pendingLocationInstalls.get(key) ?? 0) + 1);
	return toDisposable(() => {
		const count = pendingLocationInstalls.get(key);
		if (count === undefined) {
			return;
		}
		if (count <= 1) {
			pendingLocationInstalls.delete(key);
		} else {
			pendingLocationInstalls.set(key, count - 1);
		}
	});
}

export function assertBaseHalfVSIXInstallAllowed(
	productService: Pick<IProductService, 'basehalfVersion'>,
	extensionId: string,
	version: string,
	options: InstallOptions | undefined
): void {
	if (!productService.basehalfVersion) {
		return;
	}
	const token = options?.context?.[BASEHALF_VERIFIED_PLUGIN_INSTALL_CONTEXT];
	if (typeof token === 'string') {
		const authorization = pendingVSIXInstalls.get(token);
		if (authorization?.extensionId === extensionId.toLowerCase() && authorization.version === version) {
			pendingVSIXInstalls.delete(token);
			return;
		}
	}
	assertBaseHalfReviewedPluginInstallSurface(productService);
}

export function assertBaseHalfLocationInstallAllowed(productService: Pick<IProductService, 'basehalfVersion'>, location: URI): void {
	if (!productService.basehalfVersion) {
		return;
	}
	const key = baseHalfPluginLocationComparisonKey(location);
	const count = pendingLocationInstalls.get(key);
	if (count !== undefined) {
		if (count <= 1) {
			pendingLocationInstalls.delete(key);
		} else {
			pendingLocationInstalls.set(key, count - 1);
		}
		return;
	}
	// No location is installable by itself. An install from a location passes
	// only inside a transaction that authorized exactly that location.
	assertBaseHalfReviewedPluginInstallSurface(productService);
}

export function assertBaseHalfGalleryInstallAllowed(productService: Pick<IProductService, 'basehalfVersion'>, extension: IGalleryExtension): void {
	if (!productService.basehalfVersion || isBaseHalfTrustedExternalGalleryIdentity(extension.identifier.id, extension.identifier.uuid)) {
		return;
	}
	assertBaseHalfReviewedPluginInstallSurface(productService);
}

export function getBaseHalfPluginLibraryTargetFromExtensionURI(productService: Pick<IProductService, 'basehalfVersion'>, uri: URI): string | undefined {
	if (!productService.basehalfVersion) {
		return undefined;
	}
	return /^extension\/([^/]+)$/.exec(uri.path)?.[1];
}
