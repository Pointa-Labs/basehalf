/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { FileReadLimitError, readFileWithinLimit } from '../out/boundedFileRead.js';

test('rejects an oversized file from stat without allocating its contents', async () => {
	let reads = 0;
	await assert.rejects(
		readFileWithinLimit('large.txt', 4, {
			stat: async () => ({ size: 5 }),
			readFile: async () => {
				reads += 1;
				return new Uint8Array(5);
			}
		}, 'Test input'),
		(error: unknown) => error instanceof FileReadLimitError && error.observedBytes === 5
	);
	assert.equal(reads, 0);
});

test('checks the bytes again when a file grows after stat', async () => {
	const calls: string[] = [];
	await assert.rejects(
		readFileWithinLimit('growing.txt', 4, {
			stat: async () => {
				calls.push('stat');
				return { size: 4 };
			},
			readFile: async () => {
				calls.push('read');
				return new Uint8Array(5);
			}
		}, 'Test input'),
		(error: unknown) => error instanceof FileReadLimitError && error.observedBytes === 5
	);
	assert.deepEqual(calls, ['stat', 'read']);
});

test('returns content only after both size checks pass', async () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	assert.equal(await readFileWithinLimit('small.txt', 4, {
		stat: async () => ({ size: bytes.byteLength }),
		readFile: async () => bytes
	}, 'Test input'), bytes);
});
