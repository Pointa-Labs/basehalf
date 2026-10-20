/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfCanvasCardPreviewCanRetainElement, baseHalfCanvasCardPreviewRenderKey } from '../../common/basehalfCanvasCardPreview.js';

suite('BaseHalfCanvasCardPreview', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('compares refreshed result-node previews by rendered Map content', () => {
		const first = {
			kind: 'node',
			document: { id: 'video' },
			inputKinds: new Map([['prompt.md', 'text'], ['image.png', 'image']]),
			directSourceProblems: new Map([['missing.md', 'missing']])
		};
		const equivalent = {
			...first,
			inputKinds: new Map([['image.png', 'image'], ['prompt.md', 'text']]),
			directSourceProblems: new Map([['missing.md', 'missing']])
		};
		const changed = {
			...equivalent,
			directSourceProblems: new Map([['missing.md', 'changed']])
		};

		assert.strictEqual(baseHalfCanvasCardPreviewRenderKey(first as never), baseHalfCanvasCardPreviewRenderKey(equivalent as never));
		assert.notStrictEqual(baseHalfCanvasCardPreviewRenderKey(first as never), baseHalfCanvasCardPreviewRenderKey(changed as never));
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(true, first as never, equivalent as never), true);
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(true, first as never, changed as never), false);
		assert.strictEqual(baseHalfCanvasCardPreviewCanRetainElement(false, first as never, equivalent as never), false);
	});
});
