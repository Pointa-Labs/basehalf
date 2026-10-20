/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfVideoPanelCardInView,
	resolveBaseHalfVideoPanelMenuPlacement,
	resolveBaseHalfVideoPanelPlacement
} from '../../common/basehalfVideoNodePanelPlacement.js';

suite('BaseHalfVideoNodePanelPlacement', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const canvas = { width: 1000, height: 800 };

	test('the panel is 512 wide, 10 below the card and centered; above it when there is no room below; clamped when there is room for neither', () => {
		const place = (card: { left: number; top: number; right: number; bottom: number }, height: number, size = canvas, aboveClearance = 0) => {
			const layout = resolveBaseHalfVideoPanelPlacement(card, size, { height, aboveClearance });
			return `${layout.placement}/${layout.side} ${layout.left},${layout.top} ${layout.width}x${layout.height}${layout.visible ? '' : ' hidden'}`;
		};
		assert.deepStrictEqual({
			below: place({ left: 350, top: 100, right: 650, bottom: 300 }, 132),
			// Room is measured for the tallest panel: 260 does not fit below a card that ends at 600.
			aboveWhenTheTallestPanelDoesNotFitBelow: place({ left: 350, top: 300, right: 650, bottom: 600 }, 132),
			aboveClearOfTheName: place({ left: 350, top: 450, right: 650, bottom: 700 }, 180, canvas, 78),
			clampedBelow: place({ left: 350, top: 100, right: 650, bottom: 300 }, 180, { width: 1000, height: 420 }),
			clampedAbove: place({ left: 350, top: 230, right: 650, bottom: 400 }, 180, { width: 1000, height: 420 }),
			atTheLeftEdge: place({ left: -200, top: 100, right: 100, bottom: 300 }, 132),
			narrowCanvas: place({ left: 40, top: 100, right: 200, bottom: 300 }, 132, { width: 320, height: 800 }),
			offCanvas: place({ left: 350, top: 900, right: 650, bottom: 1100 }, 132)
		}, {
			below: 'below/below 244,310 512x132',
			aboveWhenTheTallestPanelDoesNotFitBelow: 'above/above 244,158 512x132',
			aboveClearOfTheName: 'above/above 244,182 512x180',
			clampedBelow: 'clamped/below 244,228 512x180',
			clampedAbove: 'clamped/above 244,40 512x180',
			atTheLeftEdge: 'below/below 12,310 512x132',
			narrowCanvas: 'below/below 12,310 296x132',
			offCanvas: 'clamped/above 244,656 512x132 hidden'
		});
	});

	test('while the card moves, the panel keeps its side and follows the card', () => {
		const card = { left: 350, top: 500, right: 650, bottom: 700 };
		const kept = resolveBaseHalfVideoPanelPlacement(card, canvas, { height: 180, keepSide: 'below' });
		const keptAbove = resolveBaseHalfVideoPanelPlacement({ left: 350, top: 20, right: 650, bottom: 300 }, canvas, { height: 180, keepSide: 'above', aboveClearance: 32 });
		assert.deepStrictEqual([
			{ placement: kept.placement, top: kept.top, visible: kept.visible },
			{ placement: keptAbove.placement, top: keptAbove.top, visible: keptAbove.visible }
		], [
			{ placement: 'below', top: 710, visible: true },
			{ placement: 'above', top: 20 - 32 - 10 - 180, visible: true }
		]);
	});

	test('a card is on the canvas while at least 24 by 24 pixels of it are in view', () => {
		assert.deepStrictEqual([
			baseHalfVideoPanelCardInView({ left: -76, top: 100, right: 24, bottom: 200 }, canvas),
			baseHalfVideoPanelCardInView({ left: -77, top: 100, right: 23, bottom: 200 }, canvas),
			baseHalfVideoPanelCardInView({ left: 100, top: 776, right: 300, bottom: 900 }, canvas),
			baseHalfVideoPanelCardInView({ left: 100, top: 777, right: 300, bottom: 900 }, canvas)
		], [true, false, true, false]);
	});

	test('a menu opens below its control, upward when there is no room below, inside the canvas, and scrolls inside itself', () => {
		const menu = (trigger: { left: number; top: number; right: number; bottom: number }, height: number, align?: 'start' | 'end') => {
			const layout = resolveBaseHalfVideoPanelMenuPlacement(trigger, canvas, { width: 300, height }, { align });
			return `${layout.side} ${layout.left},${layout.top} max ${layout.maxHeight}`;
		};
		assert.deepStrictEqual({
			below: menu({ left: 400, top: 300, right: 460, bottom: 328 }, 200),
			upward: menu({ left: 400, top: 650, right: 460, bottom: 678 }, 200),
			endAligned: menu({ left: 400, top: 300, right: 460, bottom: 328 }, 200, 'end'),
			clampedRight: menu({ left: 900, top: 300, right: 960, bottom: 328 }, 200),
			// Taller than either side: the side with more room, scrolling.
			scrolls: menu({ left: 400, top: 420, right: 460, bottom: 448 }, 900)
		}, {
			below: 'below 400,334 max 454',
			upward: 'above 400,444 max 632',
			endAligned: 'below 160,334 max 454',
			clampedRight: 'below 688,334 max 454',
			scrolls: 'above 400,12 max 402'
		});
	});
});
