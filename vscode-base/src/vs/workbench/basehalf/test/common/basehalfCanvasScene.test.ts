/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasConnectHandleReachLimit, baseHalfCanvasConnectionTargetOrigin, baseHalfCanvasSceneConnectionRefusal, baseHalfCanvasSceneSelectionActions, baseHalfCanvasSceneSelectionSurface, baseHalfCanvasSceneVideoSelectionActions, resolveBaseHalfCanvasSceneConnectionDrop } from '../../common/basehalfCanvasScene.js';

suite('BaseHalfCanvasScene', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('refuses connections into cards that cannot receive upstream, except a reconnect that keeps its target', () => {
		const sealed = { path: 'result.mp4', upstreamRefusal: 'result.mp4 cannot receive upstream context.' };
		assert.deepStrictEqual([
			baseHalfCanvasSceneConnectionRefusal(sealed),
			baseHalfCanvasSceneConnectionRefusal(sealed, 'other.md'),
			baseHalfCanvasSceneConnectionRefusal(sealed, 'result.mp4'),
			baseHalfCanvasSceneConnectionRefusal({ path: 'note.md' })
		], [sealed.upstreamRefusal, sealed.upstreamRefusal, undefined, undefined]);
	});

	test('emits a create intent only when a source connection ends on empty canvas', () => {
		const source = { from: 'brief.md', fromKind: 'file' as const, fromAnchor: 'east' as const };

		assert.strictEqual(resolveBaseHalfCanvasSceneConnectionDrop(undefined, false, { x: 10, y: 20 }, { x: 110, y: 220 }), undefined);
		assert.strictEqual(resolveBaseHalfCanvasSceneConnectionDrop(source, true, { x: 10, y: 20 }, { x: 110, y: 220 }), undefined);
		assert.deepStrictEqual(resolveBaseHalfCanvasSceneConnectionDrop(source, false, { x: 10, y: 20 }, { x: 110, y: 220 }), {
			...source,
			position: { x: 10, y: 20 },
			anchor: { x: 110, y: 220 }
		});
	});

	test('keeps each connection handle capture circle on the straight part of its side', () => {
		assert.deepStrictEqual((['north', 'east', 'south', 'west'] as const).map(anchor => [
			baseHalfCanvasConnectHandleReachLimit(anchor, { width: 280, height: 180 }),
			baseHalfCanvasConnectHandleReachLimit(anchor, { width: 140, height: 48 }),
			baseHalfCanvasConnectHandleReachLimit(anchor, { width: 40, height: 40 })
		]), [
			[118, 48, 0],
			[68, 2, 0],
			[118, 48, 0],
			[68, 2, 0]
		]);
	});

	test('centers the entered side of a card created from a connection on the release point', () => {
		const size = { width: 200, height: 100 };
		assert.deepStrictEqual((['west', 'east', 'north', 'south'] as const).map(anchor => baseHalfCanvasConnectionTargetOrigin({ x: 0, y: 0 }, anchor, size)), [
			{ x: 0, y: -50 },
			{ x: -200, y: -50 },
			{ x: -100, y: 0 },
			{ x: -100, y: -100 }
		]);
	});

	test('keeps selection actions structural and never exposes bulk execution', () => {
		assert.deepStrictEqual(baseHalfCanvasSceneSelectionActions(0), []);
		assert.deepStrictEqual(baseHalfCanvasSceneSelectionActions(1), ['rename', 'duplicate', 'delete']);
		assert.deepStrictEqual(baseHalfCanvasSceneSelectionActions(3), ['duplicate', 'copyReferences', 'delete']);
	});

	test('shows contextual controls only for one explicitly typed card', () => {
		const note = { controls: { kind: 'note' as const } };
		const video = { controls: { kind: 'video' as const, actions: ['openFullPreview' as const] } };
		const emptyVideoDraft = { controls: { kind: 'video' as const, actions: ['importResult' as const] } };
		const pendingNode = { controls: { kind: 'pending' as const } };
		const file = { controls: undefined };

		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([]), 'none');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([note]), 'note');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([video]), 'video');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([emptyVideoDraft]), 'video');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([pendingNode]), 'pending');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([file]), 'structural');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([note, file]), 'structural');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([note, note]), 'structural');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([video, file]), 'structural');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([video, video]), 'structural');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([note, video]), 'structural');
	});

	test('isolates empty Draft import from sealed Result actions', () => {
		assert.deepStrictEqual(baseHalfCanvasSceneVideoSelectionActions([]), []);
		assert.deepStrictEqual(
			baseHalfCanvasSceneVideoSelectionActions(['more', 'copySettings', 'openFullPreview']),
			['copySettings', 'more', 'openFullPreview']
		);
		assert.deepStrictEqual(
			baseHalfCanvasSceneVideoSelectionActions(['showDetails', 'importResult', 'openFullPreview']),
			['importResult']
		);
	});
});
