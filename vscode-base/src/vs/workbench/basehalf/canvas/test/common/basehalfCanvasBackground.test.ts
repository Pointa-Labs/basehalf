/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfCanvasDotGrid, baseHalfCanvasDots } from '../../common/basehalfCanvasBackground.js';

suite('BaseHalfCanvasBackground', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	/** The dots at a zoom: how far apart on screen the ones that always show are, and how much the ones between show. */
	function grid(zoom: number): string {
		const dots = baseHalfCanvasDotGrid(zoom);
		return `${dots.gap} flow, ${Number((dots.gap * zoom).toFixed(2))} screen, between ${Number(dots.between.toFixed(3))}`;
	}

	test('the dots are 40 flow pixels apart at 100%, and between 40 and 80 screen pixels apart at every zoom', () => {
		assert.deepStrictEqual({
			lowest: grid(0.2),
			fit: grid(0.37),
			half: grid(0.5),
			whole: grid(1),
			between: grid(1.5),
			double: grid(2),
			highest: grid(4),
			// A zoom that is no zoom is 100%.
			none: [grid(0), grid(Number.NaN)]
		}, {
			lowest: '320 flow, 64 screen, between 0.6',
			fit: '160 flow, 59.2 screen, between 0.48',
			half: '80 flow, 40 screen, between 0',
			whole: '40 flow, 40 screen, between 0',
			between: '40 flow, 60 screen, between 0.5',
			double: '20 flow, 40 screen, between 0',
			highest: '10 flow, 40 screen, between 0',
			none: ['40 flow, 0 screen, between 0', '40 flow, NaN screen, between 0']
		});
	});

	test('no dot appears or goes at once: where the grid changes its step, both steps draw the same dots', () => {
		// Just under 50% the dots are 160 flow pixels apart with whole dots between: the dots of the 80 pixel step just above.
		const under = baseHalfCanvasDotGrid(0.4999);
		const over = baseHalfCanvasDotGrid(0.5001);
		// From 20% to 400% in steps of a thousandth of the zoom, the dots between never change by more than a hundredth,
		// but where they become dots that always show.
		let largestStep = 0;
		for (let zoom = 0.2; zoom < 4; zoom *= 1.001) {
			const before = baseHalfCanvasDotGrid(zoom);
			const after = baseHalfCanvasDotGrid(zoom * 1.001);
			if (before.gap === after.gap) {
				largestStep = Math.max(largestStep, Math.abs(after.between - before.between));
			}
		}
		assert.deepStrictEqual({
			under: [under.gap, Number(under.between.toFixed(2))],
			over: [over.gap, Number(over.between.toFixed(2))],
			smallSteps: largestStep < 0.01
		}, {
			under: [160, 1],
			over: [80, 0],
			smallSteps: true
		});
	});

	test('each dot is drawn on whole pixels, at most half a pixel from its place on the canvas, and the canvas moved by a part of a pixel moves no dot between pixels', () => {
		const at = (x: number, y: number, zoom: number, ratio = 1, size = 2) => baseHalfCanvasDots({ x, y, zoom }, 100, 60, ratio, size).map(dot => `${dot.x},${dot.y}${dot.whole ? '' : ' between'}`);
		assert.deepStrictEqual({
			// At 100% the dots stand where the canvas has multiples of 40: a dot of 2 pixels around each.
			whole: at(0, 0, 1),
			moved: at(10.4, -7.6, 1),
			// At 150% the step is 60 screen pixels, with dots between at 30.
			between: at(0, 0, 1.5),
			// Two pixels of the screen to a screen pixel: a dot of 4 around each place.
			sharp: at(0.25, 0.25, 1, 2, 4)
		}, {
			whole: ['-1,-1', '39,-1', '79,-1', '-1,39', '39,39', '79,39'],
			moved: ['9,31', '49,31', '89,31'],
			between: ['-1,-1', '29,-1 between', '59,-1', '89,-1 between', '-1,29 between', '29,29 between', '59,29 between', '89,29 between', '-1,59', '29,59 between', '59,59', '89,59 between'],
			sharp: ['-1,-1', '79,-1', '159,-1', '-1,79', '79,79', '159,79']
		});
	});
});
