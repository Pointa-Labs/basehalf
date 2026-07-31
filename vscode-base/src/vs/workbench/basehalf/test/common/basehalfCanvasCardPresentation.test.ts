/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfCanvasCardPresentation, IBaseHalfCanvasCardPresentationContext } from '../../common/basehalfCanvasCardPresentation.js';

suite('BaseHalfCanvasCardPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const passive: IBaseHalfCanvasCardPresentationContext = {
		forceInteractive: false,
		nearViewport: true,
		selected: false,
		selectionSize: 0
	};

	test('uses one presentation for every visible passive card', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(passive), 'preview');
	});

	test('keeps offscreen cards unhydrated unless interaction is explicit', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation({
			...passive,
			nearViewport: false
		}), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation({
			...passive,
			nearViewport: false,
			selected: true,
			selectionSize: 1
		}), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation({
			...passive,
			nearViewport: false,
			forceInteractive: true
		}), 'interactive');
	});

	test('promotes only one selected visible card to interactive', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation({
			...passive,
			selected: true,
			selectionSize: 1
		}), 'interactive');
		assert.strictEqual(baseHalfCanvasCardPresentation({
			...passive,
			selected: true,
			selectionSize: 2
		}), 'preview');
	});
});
