/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { canPlayEntireSequence, reloadSequencePreview, resolveSequencePlaybackRestore, sequenceProjectionWindow, SequenceProjectionArtifactPaths, SequenceProjectionNodePaths, SequenceProjectionRefreshState, SequenceProjectionRenderQueue } from '../src/sequenceProjectionRefresh.ts';

test('bounds the projection to a deterministic prefix without changing the portable Sequence', () => {
	const items = Object.freeze([
		Object.freeze({ id: 'opening' }),
		Object.freeze({ id: 'middle' }),
		Object.freeze({ id: 'close' })
	]);
	const bounded = sequenceProjectionWindow(items, 2);

	assert.deepEqual(bounded.items.map(item => item.id), ['opening', 'middle']);
	assert.equal(bounded.totalItems, 3);
	assert.equal(bounded.truncated, true);
	assert.deepEqual(items.map(item => item.id), ['opening', 'middle', 'close']);
	assert.equal(Object.isFrozen(bounded), true);
	assert.equal(Object.isFrozen(bounded.items), true);

	const complete = sequenceProjectionWindow(items, 3);
	assert.deepEqual(complete.items, items);
	assert.equal(complete.totalItems, 3);
	assert.equal(complete.truncated, false);
	assert.throws(() => sequenceProjectionWindow(items, 0), /positive integer/);
	assert.throws(() => sequenceProjectionWindow(items, 1.5), /positive integer/);
});

test('tracks only exact node resources belonging to the current Sequence', () => {
	const paths = new SequenceProjectionNodePaths(3);
	paths.reconcile([
		'file:///project/shots/opening.bhnode',
		'file:///project/shots/close.bhnode'
	]);

	assert.equal(paths.hasResource('file:///project/shots/opening.bhnode'), true);
	assert.equal(paths.hasResource('file:///project/shots/opening.bhnode?changed=1'), false);
	assert.equal(paths.hasResource('file:///project/shots/other.bhnode'), false);

	paths.reconcile(['file:///project/shots/close.bhnode']);
	assert.equal(paths.hasResource('file:///project/shots/opening.bhnode'), false);
	assert.equal(paths.hasResource('file:///project/shots/close.bhnode'), true);

	paths.clear();
	assert.equal(paths.hasResource('file:///project/shots/close.bhnode'), false);
	assert.throws(() => paths.reconcile(['one', 'two', 'three', 'four']), /more than 3/);
	assert.throws(() => new SequenceProjectionNodePaths(0), /positive integer/);
});

test('plays the saved order only when every exact clip is available', () => {
	assert.equal(canPlayEntireSequence(0, 0), false);
	assert.equal(canPlayEntireSequence(3, 2), false);
	assert.equal(canPlayEntireSequence(3, 3), true);
});

test('restores the active clip by stable item identity across unrelated refreshes', () => {
	const playable = [
		{ index: 0, itemId: 'inserted', src: 'webview://saved/inserted.mp4' },
		{ index: 1, itemId: 'opening', src: 'webview://saved/opening.mp4' },
		{ index: 2, itemId: 'close', src: 'webview://saved/close.mp4' }
	];
	assert.deepEqual(resolveSequencePlaybackRestore(playable, {
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
	assert.deepEqual(resolveSequencePlaybackRestore(playable, {
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
	assert.deepEqual(resolveSequencePlaybackRestore(playable, {
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
	assert.equal(resolveSequencePlaybackRestore(playable, undefined).playableIndex, 0);
	assert.equal(resolveSequencePlaybackRestore([], undefined).playableIndex, -1);
});

test('reloads only the exact already-verified preview source', () => {
	const operations: string[] = [];
	let source: string | undefined = 'webview://saved/clip-run-2.mp4';
	const media = {
		removeAttribute(name: string) {
			assert.equal(name, 'src');
			source = undefined;
			operations.push('remove');
		},
		setAttribute(name: string, value: string) {
			assert.equal(name, 'src');
			source = value;
			operations.push(`set:${value}`);
		},
		load() {
			operations.push(`load:${source ?? 'empty'}`);
		}
	};

	assert.equal(reloadSequencePreview(media, 'webview://saved/clip-run-2.mp4'), true);
	assert.deepEqual(operations, [
		'remove',
		'load:empty',
		'set:webview://saved/clip-run-2.mp4',
		'load:webview://saved/clip-run-2.mp4'
	]);
	assert.equal(source, 'webview://saved/clip-run-2.mp4');

	operations.length = 0;
	assert.equal(reloadSequencePreview(media, undefined), false);
	assert.deepEqual(operations, []);
});

test('refreshes visible changes and defers hidden changes until the projection returns', () => {
	const state = new SequenceProjectionRefreshState(true);
	assert.equal(state.markChanged(), true);
	assert.equal(state.setVisible(false), false);
	assert.equal(state.markChanged(), false);
	assert.equal(state.markChanged(), false);
	assert.equal(state.setVisible(true), true);
	assert.equal(state.setVisible(true), false);
	assert.equal(state.markChanged(), true);
});

test('coalesces overlapping projection refreshes into one in-flight inspection', async () => {
	let calls = 0;
	let active = 0;
	let maximumActive = 0;
	let secondStarted!: () => void;
	const second = new Promise<void>(resolve => { secondStarted = resolve; });
	const releases: (() => void)[] = [];
	const queue = new SequenceProjectionRenderQueue(async () => {
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
	assert.equal(calls, 1);
	releases.shift()!();
	await second;
	assert.equal(calls, 2);
	assert.equal(maximumActive, 1);
	releases.shift()!();
	await pending;
	assert.equal(calls, 2);

	queue.dispose();
	await queue.request();
	assert.equal(calls, 2);
});

test('tracks only referenced Sequence results while retaining a temporarily unavailable artifact path', () => {
	const paths = new SequenceProjectionArtifactPaths(3);
	paths.reconcile([
		{ resultKey: 'opening:node-1', verifiedResourceKey: 'file:///project/opening.mp4' },
		{ resultKey: 'close:node-2', verifiedResourceKey: 'file:///project/close.mp4' }
	]);
	assert.equal(paths.size, 2);
	assert.equal(paths.hasResource('file:///project/opening.mp4'), true);

	paths.reconcile([
		{ resultKey: 'opening:node-1' },
		{ resultKey: 'close:node-2', verifiedResourceKey: 'file:///project/close-replaced.mp4' }
	]);
	assert.equal(paths.hasResource('file:///project/opening.mp4'), true);
	assert.equal(paths.hasResource('file:///project/close.mp4'), false);
	assert.equal(paths.hasResource('file:///project/close-replaced.mp4'), true);

	paths.reconcile([{ resultKey: 'close:node-3', verifiedResourceKey: 'file:///project/close-result.mp4' }]);
	assert.equal(paths.size, 1);
	assert.equal(paths.hasResource('file:///project/opening.mp4'), false);
	assert.equal(paths.hasResource('file:///project/close-replaced.mp4'), false);
	assert.equal(paths.hasResource('file:///project/close-result.mp4'), true);

	paths.clear();
	assert.equal(paths.size, 0);
});

test('bounds and validates the Sequence artifact path set', () => {
	const paths = new SequenceProjectionArtifactPaths(1);
	assert.throws(() => paths.reconcile([
		{ resultKey: 'one', verifiedResourceKey: 'file:///one.mp4' },
		{ resultKey: 'two', verifiedResourceKey: 'file:///two.mp4' }
	]), /more than 1/);
	assert.throws(() => paths.reconcile([{ resultKey: '' }]), /missing its result identity/);
	const duplicatePaths = new SequenceProjectionArtifactPaths(2);
	assert.throws(() => duplicatePaths.reconcile([{ resultKey: 'same' }, { resultKey: 'same' }]), /duplicated/);
});
