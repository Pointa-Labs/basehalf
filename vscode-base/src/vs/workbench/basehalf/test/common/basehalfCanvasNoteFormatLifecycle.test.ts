/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfCanvasNoteFormatOwnerKey,
	baseHalfCanvasNoteFormatOwnersEqual,
	BaseHalfCanvasNoteFormatNavigationOwnership,
	BaseHalfCanvasNoteFormatSelectionBarrier
} from '../../common/basehalfCanvasNoteFormatLifecycle.js';

suite('BaseHalfCanvasNoteFormatSelectionBarrier', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps a programmatic selection behind a pre-mount formatting intent', async () => {
		const barrier = new BaseHalfCanvasNoteFormatSelectionBarrier();
		const format = new DeferredPromise<boolean>();
		const selectionSettled = new DeferredPromise<void>();
		let selectedPath = 'note.md';

		barrier.defer('scene\0note.md', () => format.p, applied => {
			if (applied) {
				selectedPath = 'created.md';
			}
			void selectionSettled.complete(undefined);
		});

		assert.strictEqual(selectedPath, 'note.md');
		assert.strictEqual(selectionSettled.isSettled, false);
		await format.complete(true);
		await selectionSettled.p;
		assert.strictEqual(selectedPath, 'created.md');
	});

	test('deduplicates render waiters and blocks selection when formatting fails', async () => {
		const barrier = new BaseHalfCanvasNoteFormatSelectionBarrier();
		const format = new DeferredPromise<boolean>();
		const selectionSettled = new DeferredPromise<void>();
		let settleCalls = 0;
		let selectedPath = 'note.md';
		const onSettled = (applied: boolean) => {
			settleCalls++;
			if (applied) {
				selectedPath = 'created.md';
			}
			void selectionSettled.complete(undefined);
		};

		barrier.defer('scene\0note.md', () => format.p, onSettled);
		barrier.defer('scene\0note.md', () => Promise.resolve(true), onSettled);
		await format.complete(false);
		await selectionSettled.p;

		assert.strictEqual(settleCalls, 1);
		assert.strictEqual(selectedPath, 'note.md');
	});

	test('does not replay an obsolete selection after its owner is replaced', async () => {
		const barrier = new BaseHalfCanvasNoteFormatSelectionBarrier();
		const obsolete = new DeferredPromise<boolean>();
		const current = new DeferredPromise<boolean>();
		const currentSettled = new DeferredPromise<void>();
		const applied: string[] = [];

		barrier.defer('old-scene', () => obsolete.p, value => {
			if (value) {
				applied.push('old');
			}
		});
		barrier.defer('current-scene', () => current.p, value => {
			if (value) {
				applied.push('current');
			}
			void currentSettled.complete(undefined);
		});

		await obsolete.complete(true);
		await current.complete(true);
		await currentSettled.p;
		assert.deepStrictEqual(applied, ['current']);
	});

	test('does not replay a selection after lifecycle reset', async () => {
		const barrier = new BaseHalfCanvasNoteFormatSelectionBarrier();
		const format = new DeferredPromise<boolean>();
		let applied = false;

		barrier.defer('scene\0note.md', () => format.p, value => applied = value);
		barrier.reset();
		await format.complete(true);
		await Promise.resolve();

		assert.strictEqual(applied, false);
	});
});

suite('BaseHalfCanvasNoteFormatNavigationOwnership', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps accepted intent ownership stable across structural renders', () => {
		const acceptedOwner = { sceneKey: 'scene', path: 'note.md', resourceKey: 'file:///note.md' };
		const laterRenderOwner = { sceneKey: 'scene', path: 'note.md', resourceKey: 'file:///note.md' };

		assert.strictEqual(baseHalfCanvasNoteFormatOwnersEqual(acceptedOwner, laterRenderOwner), true);
		assert.strictEqual(baseHalfCanvasNoteFormatOwnerKey(acceptedOwner), baseHalfCanvasNoteFormatOwnerKey(laterRenderOwner));
	});

	test('rejects intents owned by another Note or scene', () => {
		const owner = { sceneKey: 'scene', path: 'note.md', resourceKey: 'file:///note.md' };
		const ownership = new BaseHalfCanvasNoteFormatNavigationOwnership<string>(owner);

		assert.strictEqual(ownership.accept(owner, 'owned', Promise.resolve(true)), true);
		assert.strictEqual(ownership.accept({ ...owner, path: 'other.md' }, 'other-note', Promise.resolve(true)), false);
		assert.strictEqual(ownership.accept({ ...owner, sceneKey: 'other-scene' }, 'other-scene', Promise.resolve(true)), false);
		assert.strictEqual(ownership.accept({ ...owner, resourceKey: 'file:///replacement.md' }, 'replacement', Promise.resolve(true)), false);
	});

	test('tracks release state from its own pending intents only', () => {
		const firstOwner = { sceneKey: 'scene', path: 'first.md', resourceKey: 'file:///first.md' };
		const secondOwner = { sceneKey: 'scene', path: 'second.md', resourceKey: 'file:///second.md' };
		const first = new BaseHalfCanvasNoteFormatNavigationOwnership<string>(firstOwner);
		const second = new BaseHalfCanvasNoteFormatNavigationOwnership<string>(secondOwner);

		first.accept(firstOwner, 'first', Promise.resolve(true));
		second.accept(secondOwner, 'second', Promise.resolve(true));
		first.settle('first');

		assert.strictEqual(first.hasPending, false);
		assert.strictEqual(second.hasPending, true);
	});

	test('waits for dynamically accepted owned intents and keeps failed outcome', async () => {
		const owner = { sceneKey: 'scene', path: 'note.md', resourceKey: 'file:///note.md' };
		const ownership = new BaseHalfCanvasNoteFormatNavigationOwnership<string>(owner);
		const first = new DeferredPromise<boolean>();
		const second = new DeferredPromise<boolean>();
		ownership.accept(owner, 'first', first.p);
		const settled = ownership.wait();
		ownership.accept(owner, 'second', second.p);

		await first.complete(true);
		await second.complete(false);
		assert.strictEqual(await settled, false);
	});
});
