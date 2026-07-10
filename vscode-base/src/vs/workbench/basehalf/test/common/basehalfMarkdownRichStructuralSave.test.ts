/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { baseHalfCaptureStableMarkdownRichSnapshot } from '../../common/basehalfMarkdownRichStructuralSave.js';

suite('BaseHalfMarkdownRichStructuralSave', () => {
	test('waits for composition and retries a revision that changes during serialization', async () => {
		let composing = true;
		let revision = 1;
		let releaseComposition!: () => void;
		const composition = new Promise<void>(resolve => releaseComposition = resolve);
		let serializations = 0;
		const snapshotPromise = baseHalfCaptureStableMarkdownRichSnapshot({
			waitForCompositionSettled: async () => {
				if (composing) {
					await composition;
				}
			},
			waitForPendingSaveSettled: async () => undefined,
			isComposing: () => composing,
			isFrozen: () => true,
			revision: () => revision,
			serialize: async () => {
				serializations++;
				if (serializations === 1) {
					revision++;
				}
				return `content-${revision}`;
			}
		});
		await Promise.resolve();
		assert.strictEqual(serializations, 0);

		composing = false;
		releaseComposition();
		assert.deepStrictEqual(await snapshotPromise, { value: 'content-2', revision: 2 });
		assert.strictEqual(serializations, 2);
	});

	test('does not publish when the structural fence releases while waiting', async () => {
		let frozen = true;
		let releasePending!: () => void;
		const pending = new Promise<void>(resolve => releasePending = resolve);
		let serialized = false;
		const snapshotPromise = baseHalfCaptureStableMarkdownRichSnapshot({
			waitForCompositionSettled: async () => undefined,
			waitForPendingSaveSettled: () => pending,
			isComposing: () => false,
			isFrozen: () => frozen,
			revision: () => 1,
			serialize: async () => { serialized = true; return 'content'; }
		});
		frozen = false;
		releasePending();

		assert.strictEqual(await snapshotPromise, undefined);
		assert.strictEqual(serialized, false);
	});
});
