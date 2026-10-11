/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { baseHalfApplicationRoot } from './basehalfPluginCatalog.js';
import { BASEHALF_OFFICIAL_PLUGIN_IDENTITIES } from './basehalfPluginIdentities.js';

/**
 * A domain capability that ships inside the application as a built-in
 * extension. It is admitted only as that copy and has no install, update, or
 * removal of its own.
 */
export interface IBaseHalfBuiltInCapability {
	readonly extensionId: string;
	readonly label: string;
	/** Application-root-relative folder of the built-in copy. */
	readonly builtInPath: string;
}

export const BASEHALF_BUILT_IN_CAPABILITIES: readonly IBaseHalfBuiltInCapability[] = [{
	extensionId: BASEHALF_OFFICIAL_PLUGIN_IDENTITIES[0].extensionId,
	label: 'AI Video',
	builtInPath: 'extensions/basehalf-ai-video'
}];

export function findBaseHalfBuiltInCapability(extensionId: string): IBaseHalfBuiltInCapability | undefined {
	const normalizedId = extensionId.trim().toLowerCase();
	return BASEHALF_BUILT_IN_CAPABILITIES.find(capability => capability.extensionId.toLowerCase() === normalizedId);
}

export function baseHalfBuiltInCapabilityLocation(capability: Pick<IBaseHalfBuiltInCapability, 'builtInPath'>): URI {
	return joinPath(baseHalfApplicationRoot(), ...capability.builtInPath.split('/'));
}
