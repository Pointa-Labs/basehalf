/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSequenceForStructuralCleanup } from '../src/sequenceCleanupLoad.ts';

test('structural cleanup fails closed when a candidate Sequence cannot be verified', async () => {
	const cause = new Error('temporarily unavailable');
	await assert.rejects(
		loadSequenceForStructuralCleanup('shots/video-sequence.json', async () => { throw cause; }),
		error => error instanceof Error
			&& error.cause === cause
			&& /Cannot safely delete/.test(error.message)
			&& /shots\/video-sequence\.json/.test(error.message)
	);
});

test('structural cleanup returns a verified candidate unchanged', async () => {
	const loaded = Object.freeze({ version: 1 });
	assert.strictEqual(await loadSequenceForStructuralCleanup('video-sequence.json', async () => loaded), loaded);
});
