/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasSceneSelectionActions, baseHalfCanvasSceneSelectionSurface, resolveBaseHalfCanvasSceneConnectionDrop } from '../../common/basehalfCanvasScene.js';

suite('BaseHalfCanvasScene', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('emits a create intent only when a source connection ends on empty canvas', () => {
		const source = { from: 'brief.md', fromKind: 'file' as const, fromAnchor: 'east' as const };

		assert.strictEqual(resolveBaseHalfCanvasSceneConnectionDrop(undefined, false, { x: 10, y: 20 }), undefined);
		assert.strictEqual(resolveBaseHalfCanvasSceneConnectionDrop(source, true, { x: 10, y: 20 }), undefined);
		assert.deepStrictEqual(resolveBaseHalfCanvasSceneConnectionDrop(source, false, { x: 10, y: 20 }), {
			...source,
			position: { x: 10, y: 20 }
		});
	});

	test('keeps selection actions structural and never exposes bulk execution', () => {
		assert.deepStrictEqual(baseHalfCanvasSceneSelectionActions(0), []);
		assert.deepStrictEqual(baseHalfCanvasSceneSelectionActions(1), ['rename', 'duplicate', 'delete']);
		assert.deepStrictEqual(baseHalfCanvasSceneSelectionActions(3), ['duplicate', 'copyReferences', 'delete']);
	});

	test('shows Note controls only for one explicitly typed Note card', () => {
		const note = { controls: { kind: 'note' as const } };
		const file = { controls: undefined };

		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([]), 'none');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([note]), 'note');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([file]), 'structural');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([note, file]), 'structural');
		assert.strictEqual(baseHalfCanvasSceneSelectionSurface([note, note]), 'structural');
	});
});
