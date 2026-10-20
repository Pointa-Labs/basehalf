/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/** Returns a readable deterministic canonical UUID for node-document tests. */
export function baseHalfNodeTestId(index: number): string {
	if (!Number.isInteger(index) || index < 0 || index > 0xffffffffffff) {
		throw new Error('Node test id index is outside the supported range.');
	}
	return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}
