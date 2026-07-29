/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BaseHalfCanvasPreviewHydrationQueue, BaseHalfCanvasPreviewVerificationQueue } from '../../common/basehalfCanvasPreviewHydration.js';

suite('BaseHalfCanvasPreviewHydrationQueue', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('invalidates a running batch when the scene changes', () => {
		const queue = new BaseHalfCanvasPreviewHydrationQueue();
		queue.resetScene('one');
		queue.enqueue('old.md', 1);
		const oldBatch = queue.take(4)!;

		queue.resetScene('two');
		queue.enqueue('new.md', 1);
		const newBatch = queue.take(4)!;

		assert.strictEqual(queue.isCurrent(oldBatch), false);
		assert.strictEqual(queue.isCurrent(newBatch), true);
		assert.deepStrictEqual(newBatch.paths, ['new.md']);
	});

	test('drops stale viewport work while retaining interactive work', () => {
		const queue = new BaseHalfCanvasPreviewHydrationQueue();
		queue.resetScene('one');
		queue.enqueue('old-visible.md', 1);
		queue.enqueue('selected.md', 2);

		queue.resetViewport();
		queue.enqueue('new-visible.md', 1);

		assert.deepStrictEqual(queue.take(4)?.paths, ['selected.md', 'new-visible.md']);
	});

	test('downgrades and removes work as card presentation changes', () => {
		const queue = new BaseHalfCanvasPreviewHydrationQueue();
		queue.resetScene('one');
		queue.setPresentation('card.md', 'interactive');
		queue.setPresentation('card.md', 'preview');
		queue.resetViewport();
		assert.strictEqual(queue.size, 0);

		queue.setPresentation('card.md', 'interactive');
		queue.setPresentation('card.md', 'shell');
		assert.strictEqual(queue.size, 0);
	});

	test('starts a new verification generation without waiting for the old tail', async () => {
		const queue = new BaseHalfCanvasPreviewVerificationQueue();
		let releaseOld!: () => void;
		const oldGate = new Promise<void>(resolve => releaseOld = resolve);
		const events: string[] = [];
		const old = queue.enqueue(async isCurrent => {
			events.push('old:start');
			await oldGate;
			if (isCurrent()) {
				events.push('old:commit');
			}
		}, error => assert.fail(error instanceof Error ? error : String(error)));
		await Promise.resolve();

		queue.reset();
		const current = queue.enqueue(async isCurrent => {
			events.push('new:start');
			if (isCurrent()) {
				events.push('new:commit');
			}
		}, error => assert.fail(error instanceof Error ? error : String(error)));
		await current;

		assert.deepStrictEqual(events, ['old:start', 'new:start', 'new:commit']);
		releaseOld();
		await old;
		assert.deepStrictEqual(events, ['old:start', 'new:start', 'new:commit']);
	});
});
