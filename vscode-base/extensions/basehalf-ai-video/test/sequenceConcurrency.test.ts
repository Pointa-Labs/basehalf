/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { SequenceConcurrencyLimiter } from '../src/sequenceConcurrency.ts';

test('shares one strict concurrency ceiling across mixed Sequence inspection work', async () => {
	const limiter = new SequenceConcurrencyLimiter(8);
	let active = 0;
	let maximumActive = 0;
	const completed = await Promise.all(Array.from({ length: 32 }, (_, index) => limiter.run(async () => {
		active++;
		maximumActive = Math.max(maximumActive, active);
		await new Promise<void>(resolve => setImmediate(resolve));
		active--;
		return index;
	})));

	assert.equal(maximumActive, 8);
	assert.deepEqual(completed, Array.from({ length: 32 }, (_, index) => index));
});

test('releases a Sequence inspection slot after failure', async () => {
	const limiter = new SequenceConcurrencyLimiter(1);
	await assert.rejects(limiter.run(async () => {
		throw new Error('inspection failed');
	}), /inspection failed/);
	assert.equal(await limiter.run(async () => 'next'), 'next');
});
