/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfBlockHandlesDrop, baseHalfBlockHandlesPointer, measureBaseHalfBlockHandles } from '../../browser/basehalfBlockHandles.js';

suite('BaseHalf block handles', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let view: HTMLElement;
	let page: HTMLElement;
	let column: HTMLElement;
	let block: HTMLElement;

	setup(() => {
		// A view of 600 pixels with a page of 400 in its middle, its column
		// 85 pixels in from each side and a block 54 pixels high 100 pixels down.
		view = mainWindow.document.createElement('div');
		view.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px; overflow: hidden;';
		page = mainWindow.document.createElement('div');
		page.style.cssText = 'width: 400px; margin: 0 auto; transform-origin: top center;';
		column = mainWindow.document.createElement('div');
		column.style.cssText = 'margin: 0 85px; padding-top: 100px;';
		block = mainWindow.document.createElement('div');
		block.style.cssText = 'height: 54px;';
		column.append(block);
		page.append(column);
		view.append(page);
		mainWindow.document.body.append(view);
	});

	teardown(() => view.remove());

	function anchorAt(scale: number) {
		page.style.transform = scale === 1 ? '' : `scale(${scale})`;
		const anchor = measureBaseHalfBlockHandles(column, block);
		const round = (value: number) => Math.round(value * 100) / 100;
		return { left: round(anchor.box.left), top: round(anchor.box.top), height: round(anchor.box.height), scale: round(anchor.scale) };
	}

	test('stand by the text column and the block as the page is drawn at each level', () => {
		// Drawn 1.8 times larger from its top middle, the column's left edge is
		// 300 - (200 - 85) * 1.8 and the block's top 100 * 1.8 down.
		assert.deepStrictEqual([anchorAt(1), anchorAt(1.8), anchorAt(0.5)], [
			{ left: 185, top: 100, height: 54, scale: 1 },
			{ left: 93, top: 180, height: 97.2, scale: 1.8 },
			{ left: 242.5, top: 50, height: 27, scale: 0.5 },
		]);
	});

	test('stand in the middle of the first line as it is drawn', () => {
		// Handles 30 pixels high, as the first line of a paragraph is at 100%.
		assert.deepStrictEqual(
			[baseHalfBlockHandlesDrop(30, 1), baseHalfBlockHandlesDrop(30, 1.8), baseHalfBlockHandlesDrop(30, 0.5)],
			[0, 12, -7.5]
		);
	});

	test('pass with a pointer that holds no button', () => {
		assert.deepStrictEqual(
			[
				baseHalfBlockHandlesPointer({ clientX: 120, clientY: 300, buttons: 0 }),
				baseHalfBlockHandlesPointer({ clientX: 120, clientY: 300, buttons: 1 }),
				baseHalfBlockHandlesPointer({ clientX: 120, clientY: 300, buttons: 2 }),
			],
			[{ x: 120, y: 300 }, undefined, undefined]
		);
	});
});
