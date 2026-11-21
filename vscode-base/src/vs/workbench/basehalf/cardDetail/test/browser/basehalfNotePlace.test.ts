/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfNotePlace, baseHalfNotePlaceScroll, IBaseHalfNotePlaceBox } from '../../browser/basehalfNotePlace.js';

suite('BaseHalfNotePlace', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	/** Blocks one under the other from `top`, each as high as its number says. */
	const stack = (top: number, heights: readonly number[]): IBaseHalfNotePlaceBox[] => {
		const boxes: IBaseHalfNotePlaceBox[] = [];
		for (const height of heights) {
			boxes.push({ top, height });
			top += height;
		}
		return boxes;
	};

	test('the place of a view is the first block that reaches below its top', () => {
		// The view's top is at 100. A note at its start has its first block 56 px below it.
		assert.deepStrictEqual([
			baseHalfNotePlace(100, stack(156, [90, 100, 60])),
			// Scrolled 200 px: the second block began 54 px above the top of the view.
			baseHalfNotePlace(100, stack(-44, [90, 100, 60])),
			// A block that ends at the top of the view is not in it.
			baseHalfNotePlace(100, stack(10, [90, 100, 60])),
			// A block that is not drawn has no height and holds no place.
			baseHalfNotePlace(100, [{ top: 0, height: 0 }, { top: 120, height: 40 }]),
			baseHalfNotePlace(100, stack(-400, [90, 100, 60])),
			baseHalfNotePlace(100, [])
		], [
			{ block: 0, distance: 56 },
			{ block: 1, through: 0.54 },
			{ block: 1, distance: 0 },
			{ block: 1, distance: 20 },
			undefined,
			undefined
		]);
	});

	test('a block that begins in the view keeps its distance from the top when the note is laid out anew', () => {
		const place = baseHalfNotePlace(100, stack(156, [90, 100, 60]))!;
		assert.deepStrictEqual([
			// Nothing above it changed: the view stays.
			baseHalfNotePlaceScroll(place, 100, { top: 156, height: 150 }),
			// What is above it grew by 30 px: the view scrolls 30 px down.
			baseHalfNotePlaceScroll(place, 100, { top: 186, height: 150 }),
			baseHalfNotePlaceScroll(place, 100, { top: 141, height: 50 })
		], [0, 30, -15]);
	});

	test('a block that began above the view keeps the same part of itself above the top', () => {
		// A paragraph of 100 px, 54 of them above the top of the view.
		const place = baseHalfNotePlace(100, stack(-44, [90, 100, 60]))!;
		assert.deepStrictEqual([
			baseHalfNotePlaceScroll(place, 100, { top: 46, height: 100 }),
			// A larger text: the paragraph is 200 px and begins 80 px lower. The line at the top of the view is 108 px into it.
			baseHalfNotePlaceScroll(place, 100, { top: 126, height: 200 }),
			// A smaller text: 50 px high, 20 px higher up.
			baseHalfNotePlaceScroll(place, 100, { top: 26, height: 50 })
		], [0, 134, -47]);
	});
});
