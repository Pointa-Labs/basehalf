/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { SequenceDiscoveryCache } from '../src/sequenceDiscoveryCache.ts';

test('shares workspace discovery until an event invalidates that workspace', async () => {
	const cache = new SequenceDiscoveryCache<string>();
	let discoveries = 0;
	const discover = async () => [`sequence-${++discoveries}`];

	const [first, concurrent] = await Promise.all([cache.get('workspace', discover), cache.get('workspace', discover)]);
	assert.deepEqual(first, ['sequence-1']);
	assert.equal(concurrent, first);
	assert.equal(await cache.get('workspace', discover), first);
	assert.equal(discoveries, 1);

	cache.invalidate('workspace');
	assert.deepEqual(await cache.get('workspace', discover), ['sequence-2']);
	assert.equal(discoveries, 2);
});

test('retries a discovery invalidated while its scan is still running', async () => {
	const cache = new SequenceDiscoveryCache<string>();
	let finishFirst!: (items: readonly string[]) => void;
	let discoveries = 0;
	const pending = cache.get('workspace', async () => {
		discoveries++;
		if (discoveries === 1) {
			return new Promise<readonly string[]>(resolve => finishFirst = resolve);
		}
		return ['fresh'];
	});
	await new Promise<void>(resolve => setImmediate(resolve));
	cache.invalidate('workspace');
	finishFirst(['stale']);

	assert.deepEqual(await pending, ['fresh']);
	assert.equal(discoveries, 2);
});
