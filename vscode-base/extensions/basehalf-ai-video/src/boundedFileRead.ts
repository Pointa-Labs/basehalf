/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export interface BoundedFileReader<Resource> {
	readonly stat: (resource: Resource) => PromiseLike<{ readonly size: number }>;
	readonly readFile: (resource: Resource) => PromiseLike<Uint8Array>;
}

export class FileReadLimitError extends Error {
	constructor(
		readonly label: string,
		readonly maximumBytes: number,
		readonly observedBytes: number
	) {
		super(`${label} exceeds the ${maximumBytes}-byte read limit.`);
		this.name = 'FileReadLimitError';
	}
}

/** Bounds allocation before reading and checks again in case the file grows after stat. */
export async function readFileWithinLimit<Resource>(
	resource: Resource,
	maximumBytes: number,
	reader: BoundedFileReader<Resource>,
	label: string
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
		throw new TypeError('maximumBytes must be a non-negative safe integer.');
	}
	const stat = await reader.stat(resource);
	assertWithinLimit(stat.size, maximumBytes, label);
	const bytes = await reader.readFile(resource);
	assertWithinLimit(bytes.byteLength, maximumBytes, label);
	return bytes;
}

function assertWithinLimit(observedBytes: number, maximumBytes: number, label: string): void {
	if (!Number.isSafeInteger(observedBytes) || observedBytes < 0) {
		throw new Error(`${label} reported an invalid byte size.`);
	}
	if (observedBytes > maximumBytes) {
		throw new FileReadLimitError(label, maximumBytes, observedBytes);
	}
}
