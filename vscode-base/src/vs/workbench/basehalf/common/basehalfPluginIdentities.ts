/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Product-owned plugin identities. The desktop admission layer and release
 * tooling both consume this list so reviewed publishers cannot claim an
 * identity or Publisher namespace reserved by the product.
 */
export const BASEHALF_OFFICIAL_PLUGIN_IDENTITIES = [{
	extensionId: 'pointa.basehalf-ai-video',
	publisher: 'pointa'
}] as const;

export const BASEHALF_RESERVED_OFFICIAL_PLUGIN_PUBLISHERS = [...new Set(
	BASEHALF_OFFICIAL_PLUGIN_IDENTITIES.map(identity => identity.publisher)
)] as readonly string[];
