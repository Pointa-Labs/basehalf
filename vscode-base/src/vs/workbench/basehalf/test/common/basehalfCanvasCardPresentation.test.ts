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
		selected: false,
		selectionSize: 0
	};

	test('uses one preview presentation throughout ordinary zoom', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 1, passive), 'preview');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.5, passive), 'preview');
	});

	test('uses hysteresis around the unreadable far-view boundary', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.34, passive, 'preview'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.4, passive, 'shell'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.46, passive, 'shell'), 'preview');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.4, passive, 'preview'), 'preview');
	});

	test('keeps intrinsically short cards cheap and explicit editors available', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(70, 1, passive, 'preview'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(90, 1, passive, 'shell'), 'shell');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.2, {
			...passive,
			forceInteractive: true
		}, 'shell'), 'interactive');
	});

	test('promotes only one selected readable card to interactive', () => {
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 1, {
			forceInteractive: false,
			selected: true,
			selectionSize: 1
		}), 'interactive');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 1, {
			forceInteractive: false,
			selected: true,
			selectionSize: 2
		}), 'preview');
		assert.strictEqual(baseHalfCanvasCardPresentation(220, 0.2, {
			forceInteractive: false,
			selected: true,
			selectionSize: 1
		}, 'preview'), 'shell');
	});
});
