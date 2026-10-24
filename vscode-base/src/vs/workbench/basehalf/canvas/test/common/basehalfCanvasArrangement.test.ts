/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	IBaseHalfCanvasArrangeCard,
	IBaseHalfCanvasArrangePlace,
	baseHalfCanvasArrange,
	baseHalfCanvasArrangeOrder,
	baseHalfCanvasBoundingRect,
	baseHalfCanvasCardsInMarquee,
	baseHalfCanvasLinesInMarquee,
	baseHalfCanvasSelectionState,
	baseHalfCanvasTidy
} from '../../common/basehalfCanvasArrangement.js';

function card(path: string, x: number, y: number, width = 300, height = 220): IBaseHalfCanvasArrangeCard {
	return { path, x, y, width, height };
}

function byPath(places: readonly IBaseHalfCanvasArrangePlace[]): Record<string, [number, number]> {
	return Object.fromEntries(places.map(place => [place.path, [place.x, place.y]]));
}

function moved(cards: readonly IBaseHalfCanvasArrangeCard[], places: readonly IBaseHalfCanvasArrangePlace[]): IBaseHalfCanvasArrangeCard[] {
	const placeOf = new Map(places.map(place => [place.path, place]));
	return cards.map(item => ({ ...item, x: placeOf.get(item.path)!.x, y: placeOf.get(item.path)!.y }));
}

suite('BaseHalfCanvasArrangement', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the state of a selection follows from what is selected', () => {
		assert.deepStrictEqual(
			[
				baseHalfCanvasSelectionState(0, 0),
				baseHalfCanvasSelectionState(0, 1),
				baseHalfCanvasSelectionState(0, 3),
				baseHalfCanvasSelectionState(1, 0),
				baseHalfCanvasSelectionState(2, 0),
				baseHalfCanvasSelectionState(7, 0)
			],
			['nothing', 'connections', 'connections', 'card', 'set', 'set']
		);
	});

	test('a marquee crosses a line when a point of the drawn curve lies in it', () => {
		const left = { x: 0, y: 0, width: 200, height: 100 };
		const right = { x: 500, y: 0, width: 200, height: 100 };
		// East to west is a straight line at y 50 from x 200 to x 500. South to
		// south dips below the cards, to y 265 halfway.
		const lines = [
			{ id: 'straight', from: left, fromAnchor: 'east' as const, to: right, toAnchor: 'west' as const },
			{ id: 'below', from: left, fromAnchor: 'south' as const, to: right, toAnchor: 'south' as const }
		];
		const crossed = (x: number, y: number, width: number, height: number) => baseHalfCanvasLinesInMarquee(lines, { x, y, width, height });
		assert.deepStrictEqual(
			{
				through: crossed(320, 20, 40, 60),
				onlyAnEnd: crossed(490, 40, 20, 20),
				onItsBorder: crossed(320, 50, 40, 20),
				besideIt: crossed(320, 53, 40, 20),
				aboveIt: crossed(320, 0, 40, 40),
				aroundWhichItCurves: crossed(300, 110, 100, 100),
				throughBoth: crossed(340, 0, 20, 300),
				farAway: crossed(2000, 2000, 50, 50)
			},
			{
				through: ['straight'],
				onlyAnEnd: ['straight'],
				onItsBorder: ['straight'],
				besideIt: [],
				aboveIt: [],
				aroundWhichItCurves: [],
				throughBoth: ['straight', 'below'],
				farAway: []
			}
		);
	});

	test('a marquee selects every card it shares area with and no card it only touches', () => {
		const cards = [
			card('inside.md', 100, 100),
			card('corner.md', 380, 300),
			card('touching.md', 400, 100),
			card('away.md', 900, 900)
		];
		assert.deepStrictEqual(
			baseHalfCanvasCardsInMarquee(cards, { x: 50, y: 50, width: 350, height: 300 }),
			['inside.md', 'corner.md']
		);
	});

	test('the box of a set is the smallest rectangle that holds its cards', () => {
		assert.deepStrictEqual(
			[
				baseHalfCanvasBoundingRect([]),
				baseHalfCanvasBoundingRect([card('a.md', 100, 50), card('b.md', 500, 60, 200, 100), card('c.md', 120, 400)])
			],
			[undefined, { x: 100, y: 50, width: 600, height: 570 }]
		);
	});

	test('cards that stand roughly in a line are read from left to right', () => {
		const cards = [
			card('q.md', 200, 0),
			card('r.md', 400, 20),
			card('p.md', 0, 10),
			card('below-right.md', 300, 300),
			card('below-left.md', 0, 310)
		];
		assert.deepStrictEqual(
			baseHalfCanvasArrangeOrder(cards).map(item => item.path),
			['p.md', 'q.md', 'r.md', 'below-left.md', 'below-right.md']
		);
	});

	test('a row, a column, and a grid start at the corner of the box and keep every size', () => {
		const cards = [
			card('a.md', 100, 50),
			card('b.md', 500, 60, 200, 100),
			card('c.md', 120, 400)
		];
		assert.deepStrictEqual(
			{
				row: byPath(baseHalfCanvasArrange('row', cards)),
				column: byPath(baseHalfCanvasArrange('column', cards)),
				grid: byPath(baseHalfCanvasArrange('grid', cards))
			},
			{
				row: { 'a.md': [100, 50], 'b.md': [440, 50], 'c.md': [680, 50] },
				column: { 'a.md': [100, 50], 'b.md': [100, 330], 'c.md': [100, 490] },
				grid: { 'a.md': [100, 50], 'b.md': [440, 50], 'c.md': [100, 330] }
			}
		);
	});

	test('a grid has as many columns as the square root of the number of cards, rounded up', () => {
		const cards = Array.from({ length: 8 }, (_unused, index) => card(`${index}.md`, index * 10, 0, 100, 100));
		const places = baseHalfCanvasArrange('grid', cards);
		assert.deepStrictEqual(
			places.map(place => [place.x, place.y]),
			[[0, 0], [140, 0], [280, 0], [0, 160], [140, 160], [280, 160], [0, 320], [140, 320]]
		);
	});

	test('a tidied canvas has its groups from left to right and its singles in a grid after them', () => {
		const cards = [
			card('s1.md', 900, 700),
			card('a.md', 10, 500),
			card('b.md', 400, 20),
			card('c.md', 50, 30),
			card('s2.md', 600, 600)
		];
		const connections = [{ from: 'a.md', to: 'b.md' }, { from: 'a.md', to: 'c.md' }];
		const places = baseHalfCanvasTidy(cards, connections);
		assert.deepStrictEqual(
			{ places: byPath(places), again: byPath(baseHalfCanvasTidy(moved(cards, places), connections)) },
			{
				places: {
					'a.md': [10, 160],
					'b.md': [430, 20],
					'c.md': [430, 300],
					's1.md': [850, 20],
					's2.md': [1190, 20]
				},
				again: byPath(places)
			}
		);
	});

	test('a connection that closes a circle is left out of the layout', () => {
		const places = baseHalfCanvasTidy(
			[card('a.md', 0, 0), card('b.md', 50, 400)],
			[{ from: 'a.md', to: 'b.md' }, { from: 'b.md', to: 'a.md' }]
		);
		assert.deepStrictEqual(byPath(places), { 'a.md': [0, 0], 'b.md': [420, 0] });
	});

	test('a card is one column to the right of the rightmost card that leads to it', () => {
		const places = baseHalfCanvasTidy(
			[card('a.md', 0, 0), card('b.md', 0, 0), card('c.md', 0, 0)],
			[{ from: 'a.md', to: 'b.md' }, { from: 'b.md', to: 'c.md' }, { from: 'a.md', to: 'c.md' }]
		);
		assert.deepStrictEqual(byPath(places), { 'a.md': [0, 0], 'b.md': [420, 0], 'c.md': [840, 0] });
	});

	test('in a column a card stands beside the card that leads to it', () => {
		const places = baseHalfCanvasTidy(
			[card('a.md', 0, 0), card('b.md', 0, 0), card('c.md', 0, 0), card('d.md', 0, 0)],
			[{ from: 'a.md', to: 'd.md' }, { from: 'b.md', to: 'c.md' }, { from: 'a.md', to: 'b.md' }]
		);
		// a leads to b and d, and b leads to c: a | b, d | c.
		assert.deepStrictEqual(byPath(places), {
			'a.md': [0, 140],
			'b.md': [420, 0],
			'd.md': [420, 280],
			'c.md': [840, 140]
		});
	});

	test('a block begins a new row when the row would become too wide with it', () => {
		const places = baseHalfCanvasTidy(
			[card('a.md', 5, 5, 1000), card('b.md', 5, 5, 1000), card('c.md', 5, 5, 1000), card('d.md', 5, 5, 1000)],
			[{ from: 'a.md', to: 'b.md' }, { from: 'c.md', to: 'd.md' }]
		);
		assert.deepStrictEqual(byPath(places), {
			'a.md': [5, 5],
			'b.md': [1125, 5],
			'c.md': [5, 345],
			'd.md': [1125, 345]
		});
	});

	test('cards without a connection are tidied into the columns of the plain grid', () => {
		const cards = Array.from({ length: 6 }, (_unused, index) => card(`${index}.md`, 40 + index, 80 + index));
		assert.deepStrictEqual(
			baseHalfCanvasTidy(cards, []).map(place => [place.x, place.y]),
			[[40, 80], [380, 80], [720, 80], [1060, 80], [1400, 80], [40, 360]]
		);
	});
});
