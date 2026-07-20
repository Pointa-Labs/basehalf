/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Canonical bytes used by both release-time archive inspection and installed
 * tree verification. The host rewrites package.json to attach installation
 * metadata, while all publisher-owned bytes remain integrity protected.
 */
export function baseHalfCanonicalInstalledFileBytes(relativePath: string, bytes: Uint8Array): Uint8Array {
	if (relativePath !== 'package.json') {
		return bytes;
	}
	let manifest: unknown;
	try {
		manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new Error('Plugin package.json must be strict UTF-8 JSON.');
	}
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new Error('Plugin package.json must contain a JSON object.');
	}
	delete (manifest as Record<string, unknown>).__metadata;
	return new TextEncoder().encode(JSON.stringify(manifest));
}
