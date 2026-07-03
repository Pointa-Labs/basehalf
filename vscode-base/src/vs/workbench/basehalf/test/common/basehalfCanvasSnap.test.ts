/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	IBaseHalfCanvasSnapRect,
	snapBaseHalfCanvasResizeRect,
	snapBaseHalfCanvasTranslateRect
} from '../../common/basehalfCanvasSnap.js';

const limits = { minWidth: 40, minHeight: 40, maxWidth: 400, maxHeight: 400 };
const openEndedLimits = { minWidth: 40, minHeight: 40 };

suite('BaseHalfCanvasSnap', () => {
	test('snaps dragged bounds to nearby card edges and emits guide lines', () => {
		const moving: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 117, y: 22, width: 80, height: 60 };
		const target: IBaseHalfCanvasSnapRect = { id: 'b.md', x: 200, y: 20, width: 90, height: 60 };
		const result = snapBaseHalfCanvasTranslateRect(moving, [target], 8);

		assert.strictEqual(result.rect.x, 120);
		assert.strictEqual(result.rect.y, 20);
		assert.deepStrictEqual(result.guides, [
			{
				orientation: 'vertical',
				x: 200,
				y1: 20,
				y2: 80
			},
			{
				orientation: 'horizontal',
				y: 20,
				x1: 120,
				x2: 290
			}
		]);
	});

	test('snaps against center lines as well as outer edges', () => {
		const moving: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 216, y: 36, width: 80, height: 60 };
		const target: IBaseHalfCanvasSnapRect = { id: 'b.md', x: 200, y: 20, width: 120, height: 92 };
		const result = snapBaseHalfCanvasTranslateRect(moving, [target], 8);

		assert.strictEqual(result.rect.x + result.rect.width / 2, 260);
	});

	test('emits only one guide per axis for the chosen snap', () => {
		const moving: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 100, y: 97, width: 100, height: 80 };
		const target: IBaseHalfCanvasSnapRect = { id: 'b.md', x: 250, y: 100, width: 100, height: 80 };
		const result = snapBaseHalfCanvasTranslateRect(moving, [target], 8);

		assert.strictEqual(result.rect.y, 100);
		assert.strictEqual(result.guides.filter(guide => guide.orientation === 'horizontal').length, 1);
	});

	test('snaps a resizing right edge without moving the left edge', () => {
		const before: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 100, height: 80 };
		const draft: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 156, height: 80 };
		const target: IBaseHalfCanvasSnapRect = { id: 'b.md', x: 200, y: 36, width: 100, height: 80 };
		const result = snapBaseHalfCanvasResizeRect(before, draft, [target], 8, limits);

		assert.strictEqual(result.rect.x, 40);
		assert.strictEqual(result.rect.width, 160);
		assert.deepStrictEqual(result.guides, [{
			orientation: 'vertical',
			x: 200,
			y1: 36,
			y2: 120
		}]);
	});

	test('snaps a resizing left edge while preserving the opposite edge', () => {
		const before: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 100, y: 40, width: 100, height: 80 };
		const draft: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 43, y: 40, width: 157, height: 80 };
		const target: IBaseHalfCanvasSnapRect = { id: 'b.md', x: 40, y: 36, width: 80, height: 80 };
		const result = snapBaseHalfCanvasResizeRect(before, draft, [target], 8, limits);

		assert.strictEqual(result.rect.x, 40);
		assert.strictEqual(result.rect.width, 160);
		assert.strictEqual(result.rect.x + result.rect.width, 200);
	});

	test('does not impose an arbitrary maximum card size during resize snapping', () => {
		const before: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 500, height: 360 };
		const draft: IBaseHalfCanvasSnapRect = { id: 'a.md', x: 40, y: 40, width: 755, height: 360 };
		const target: IBaseHalfCanvasSnapRect = { id: 'b.md', x: 800, y: 40, width: 100, height: 80 };
		const result = snapBaseHalfCanvasResizeRect(before, draft, [target], 8, openEndedLimits);

		assert.strictEqual(result.rect.x, 40);
		assert.strictEqual(result.rect.width, 760);
		assert.deepStrictEqual(result.guides, [{
			orientation: 'vertical',
			x: 800,
			y1: 40,
			y2: 400
		}]);
	});
});
