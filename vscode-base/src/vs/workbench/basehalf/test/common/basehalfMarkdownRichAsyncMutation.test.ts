/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BaseHalfMarkdownRichAsyncMutationBarrier } from '../../common/basehalfMarkdownRichAsyncMutation.js';

suite('BaseHalfMarkdownRichAsyncMutationBarrier', () => {
	test('freeze can await a delayed clipboard command before acknowledging idle', async () => {
		const barrier = new BaseHalfMarkdownRichAsyncMutationBarrier();
		let releaseClipboard!: () => void;
		const clipboard = new Promise<void>(resolve => releaseClipboard = resolve);
		let dispatched = false;
		void barrier.run(async () => {
			await clipboard;
			dispatched = true;
		});
		let idle = false;
		const waiting = barrier.waitForIdle().then(() => idle = true);
		await Promise.resolve();
		assert.strictEqual(idle, false);

		releaseClipboard();
		await waiting;
		assert.strictEqual(dispatched, true);
		assert.strictEqual(idle, true);
	});

	test('a delayed clipboard callback can recheck freeze before dispatch', async () => {
		const barrier = new BaseHalfMarkdownRichAsyncMutationBarrier();
		let releaseClipboard!: () => void;
		const clipboard = new Promise<void>(resolve => releaseClipboard = resolve);
		let frozen = false;
		let dispatched = false;
		void barrier.run(async () => {
			await clipboard;
			if (!frozen) {
				dispatched = true;
			}
		});

		frozen = true;
		const idle = barrier.waitForIdle();
		releaseClipboard();
		await idle;
		assert.strictEqual(dispatched, false);
	});
});
