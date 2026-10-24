/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfSequenceArtifactPaths, BaseHalfSequenceRefreshState, BaseHalfSequenceRenderQueue, BaseHalfSequenceVideoPaths, baseHalfSequenceWindow, canPlayEntireBaseHalfSequence, reloadBaseHalfSequencePreview, resolveBaseHalfSequencePlaybackRestore } from '../../common/basehalfSequenceRefresh.js';

suite('BaseHalfSequenceRefresh', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('bounds the projection to a deterministic prefix without changing the portable Sequence', () => {
		const items = Object.freeze([
			Object.freeze({ id: 'opening' }),
			Object.freeze({ id: 'middle' }),
			Object.freeze({ id: 'close' })
		]);
		const bounded = baseHalfSequenceWindow(items, 2);

		assert.deepStrictEqual(bounded.items.map(item => item.id), ['opening', 'middle']);
		assert.strictEqual(bounded.totalItems, 3);
		assert.strictEqual(bounded.truncated, true);
		assert.deepStrictEqual(items.map(item => item.id), ['opening', 'middle', 'close']);
		assert.strictEqual(Object.isFrozen(bounded), true);
		assert.strictEqual(Object.isFrozen(bounded.items), true);

		const complete = baseHalfSequenceWindow(items, 3);
		assert.deepStrictEqual(complete.items, items);
		assert.strictEqual(complete.totalItems, 3);
		assert.strictEqual(complete.truncated, false);
		assert.throws(() => baseHalfSequenceWindow(items, 0), /positive integer/);
		assert.throws(() => baseHalfSequenceWindow(items, 1.5), /positive integer/);
	});

	test('tracks only the exact video files of the clips of the current Sequence', () => {
		const paths = new BaseHalfSequenceVideoPaths(3);
		paths.reconcile([
			'file:///project/shots/opening.mp4',
			'file:///project/shots/close.mp4'
		]);

		assert.strictEqual(paths.hasResource('file:///project/shots/opening.mp4'), true);
		assert.strictEqual(paths.hasResource('file:///project/shots/opening.mp4?changed=1'), false);
		assert.strictEqual(paths.hasResource('file:///project/shots/other.mp4'), false);

		paths.reconcile(['file:///project/shots/close.mp4']);
		assert.strictEqual(paths.hasResource('file:///project/shots/opening.mp4'), false);
		assert.strictEqual(paths.hasResource('file:///project/shots/close.mp4'), true);

		paths.clear();
		assert.strictEqual(paths.hasResource('file:///project/shots/close.mp4'), false);
		assert.throws(() => paths.reconcile(['one', 'two', 'three', 'four']), /more than 3/);
		assert.throws(() => new BaseHalfSequenceVideoPaths(0), /positive integer/);
	});

	test('plays the saved order only when every exact clip is available', () => {
		assert.strictEqual(canPlayEntireBaseHalfSequence(0, 0), false);
		assert.strictEqual(canPlayEntireBaseHalfSequence(3, 2), false);
		assert.strictEqual(canPlayEntireBaseHalfSequence(3, 3), true);
	});

	test('restores the active clip by stable item identity across unrelated refreshes', () => {
		const playable = [
			{ index: 0, itemId: 'inserted', src: 'webview://saved/inserted.mp4' },
			{ index: 1, itemId: 'opening', src: 'webview://saved/opening.mp4' },
			{ index: 2, itemId: 'close', src: 'webview://saved/close.mp4' }
		];
		assert.deepStrictEqual(resolveBaseHalfSequencePlaybackRestore(playable, {
			activeItemId: 'close',
			activeSource: 'webview://saved/close.mp4',
			sequenceIndex: 1,
			currentTime: 4.25,
			wasPlaying: true,
			playAll: true
		}), {
			playableIndex: 2,
			currentTime: 4.25,
			shouldPlay: true,
			playAll: true
		});
	});

	test('keeps selection but does not resume when the exact clip source changes', () => {
		const playable = [{ index: 3, itemId: 'close', src: 'webview://saved/close-v2.mp4' }];
		assert.deepStrictEqual(resolveBaseHalfSequencePlaybackRestore(playable, {
			activeItemId: 'close',
			activeSource: 'webview://saved/close-v1.mp4',
			sequenceIndex: 3,
			currentTime: 8,
			wasPlaying: true,
			playAll: true
		}), {
			playableIndex: 0,
			currentTime: 0,
			shouldPlay: false,
			playAll: false
		});
	});

	test('chooses the nearest remaining position when the active item is removed', () => {
		const playable = [
			{ index: 0, itemId: 'opening', src: 'webview://saved/opening.mp4' },
			{ index: 2, itemId: 'close', src: 'webview://saved/close.mp4' }
		];
		assert.deepStrictEqual(resolveBaseHalfSequencePlaybackRestore(playable, {
			activeItemId: 'removed',
			activeSource: 'webview://saved/removed.mp4',
			sequenceIndex: 1,
			wasPlaying: true
		}), {
			playableIndex: 1,
			currentTime: 0,
			shouldPlay: false,
			playAll: false
		});
		assert.strictEqual(resolveBaseHalfSequencePlaybackRestore(playable, undefined).playableIndex, 0);
		assert.strictEqual(resolveBaseHalfSequencePlaybackRestore([], undefined).playableIndex, -1);
	});

	test('reloads only the exact already-verified preview source', () => {
		const operations: string[] = [];
		let source: string | undefined = 'webview://saved/clip-run-2.mp4';
		const media = {
			removeAttribute(name: string) {
				assert.strictEqual(name, 'src');
				source = undefined;
				operations.push('remove');
			},
			setAttribute(name: string, value: string) {
				assert.strictEqual(name, 'src');
				source = value;
				operations.push(`set:${value}`);
			},
			load() {
				operations.push(`load:${source ?? 'empty'}`);
			}
		};

		assert.strictEqual(reloadBaseHalfSequencePreview(media, 'webview://saved/clip-run-2.mp4'), true);
		assert.deepStrictEqual(operations, [
			'remove',
			'load:empty',
			'set:webview://saved/clip-run-2.mp4',
			'load:webview://saved/clip-run-2.mp4'
		]);
		assert.strictEqual(source, 'webview://saved/clip-run-2.mp4');

		operations.length = 0;
		assert.strictEqual(reloadBaseHalfSequencePreview(media, undefined), false);
		assert.deepStrictEqual(operations, []);
	});

	test('refreshes visible changes and defers hidden changes until the projection returns', () => {
		const state = new BaseHalfSequenceRefreshState(true);
		assert.strictEqual(state.markChanged(), true);
		assert.strictEqual(state.setVisible(false), false);
		assert.strictEqual(state.markChanged(), false);
		assert.strictEqual(state.markChanged(), false);
		assert.strictEqual(state.setVisible(true), true);
		assert.strictEqual(state.setVisible(true), false);
		assert.strictEqual(state.markChanged(), true);
	});

	test('coalesces overlapping projection refreshes into one in-flight inspection', async () => {
		let calls = 0;
		let active = 0;
		let maximumActive = 0;
		let secondStarted!: () => void;
		const second = new Promise<void>(resolve => { secondStarted = resolve; });
		const releases: (() => void)[] = [];
		const queue = new BaseHalfSequenceRenderQueue(async () => {
			calls++;
			active++;
			maximumActive = Math.max(maximumActive, active);
			if (calls === 2) {
				secondStarted();
			}
			await new Promise<void>(resolve => releases.push(resolve));
			active--;
		});

		const pending = queue.request();
		void queue.request();
		void queue.request();
		assert.strictEqual(calls, 1);
		releases.shift()!();
		await second;
		assert.strictEqual(calls, 2);
		assert.strictEqual(maximumActive, 1);
		releases.shift()!();
		await pending;
		assert.strictEqual(calls, 2);

		queue.dispose();
		await queue.request();
		assert.strictEqual(calls, 2);
	});

	test('tracks only referenced Sequence results while retaining a temporarily unavailable artifact path', () => {
		const paths = new BaseHalfSequenceArtifactPaths(3);
		paths.reconcile([
			{ resultKey: 'opening:task-1', verifiedResourceKey: 'file:///project/opening.mp4' },
			{ resultKey: 'close:task-2', verifiedResourceKey: 'file:///project/close.mp4' }
		]);
		assert.strictEqual(paths.size, 2);
		assert.strictEqual(paths.hasResource('file:///project/opening.mp4'), true);

		paths.reconcile([
			{ resultKey: 'opening:task-1' },
			{ resultKey: 'close:task-2', verifiedResourceKey: 'file:///project/close-replaced.mp4' }
		]);
		assert.strictEqual(paths.hasResource('file:///project/opening.mp4'), true);
		assert.strictEqual(paths.hasResource('file:///project/close.mp4'), false);
		assert.strictEqual(paths.hasResource('file:///project/close-replaced.mp4'), true);

		paths.reconcile([{ resultKey: 'close:task-3', verifiedResourceKey: 'file:///project/close-result.mp4' }]);
		assert.strictEqual(paths.size, 1);
		assert.strictEqual(paths.hasResource('file:///project/opening.mp4'), false);
		assert.strictEqual(paths.hasResource('file:///project/close-replaced.mp4'), false);
		assert.strictEqual(paths.hasResource('file:///project/close-result.mp4'), true);

		paths.clear();
		assert.strictEqual(paths.size, 0);
	});

	test('bounds and validates the Sequence artifact path set', () => {
		const paths = new BaseHalfSequenceArtifactPaths(1);
		assert.throws(() => paths.reconcile([
			{ resultKey: 'one', verifiedResourceKey: 'file:///one.mp4' },
			{ resultKey: 'two', verifiedResourceKey: 'file:///two.mp4' }
		]), /more than 1/);
		assert.throws(() => paths.reconcile([{ resultKey: '' }]), /missing its result identity/);
		const duplicatePaths = new BaseHalfSequenceArtifactPaths(2);
		assert.throws(() => duplicatePaths.reconcile([{ resultKey: 'same' }, { resultKey: 'same' }]), /duplicated/);
	});
});
