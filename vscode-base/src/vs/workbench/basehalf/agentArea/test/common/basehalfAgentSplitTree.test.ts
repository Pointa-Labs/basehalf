/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	BaseHalfPaneNode,
	closeLeaf,
	directionalNeighbor,
	dropEdge,
	equalize,
	findLeaf,
	findSplit,
	firstLeaf,
	insertBeside,
	leafRects,
	orderedLeafIds,
	paneLeaf,
	resizeTarget,
	ringNeighbor,
	setFraction,
	splitBounds,
	splitDividers,
	splitLeaf
} from '../../common/basehalfAgentSplitTree.js';

suite('BaseHalfAgentSplitTree', () => {
	/** p1 | (p2 / p3): p1 left, right side stacked p2 over p3. */
	function sampleTree(): BaseHalfPaneNode {
		let tree: BaseHalfPaneNode = paneLeaf('p1');
		tree = splitLeaf(tree, 'p1', 'right', 'p2', 's1');
		tree = splitLeaf(tree, 'p2', 'down', 'p3', 's2');
		return tree;
	}

	test('splits keep the existing pane on side a and the new pane on side b', () => {
		assert.deepStrictEqual(sampleTree(), {
			type: 'split',
			id: 's1',
			dir: 'row',
			a: { type: 'leaf', id: 'p1' },
			b: {
				type: 'split',
				id: 's2',
				dir: 'column',
				a: { type: 'leaf', id: 'p2' },
				b: { type: 'leaf', id: 'p3' },
				fraction: 0.5
			},
			fraction: 0.5
		});
	});

	test('closeLeaf collapses the parent split and picks the previous-unless-leftmost focus', () => {
		const tree = sampleTree();
		assert.deepStrictEqual(closeLeaf(tree, 'p3'), {
			root: {
				type: 'split',
				id: 's1',
				dir: 'row',
				a: { type: 'leaf', id: 'p1' },
				b: { type: 'leaf', id: 'p2' },
				fraction: 0.5
			},
			focusId: 'p2'
		});
		assert.strictEqual(closeLeaf(tree, 'p1').focusId, 'p2');
		assert.deepStrictEqual(closeLeaf(paneLeaf('only'), 'only'), { root: null, focusId: null });
		const missing = closeLeaf(tree, 'nope');
		assert.strictEqual(missing.root, tree);
	});

	test('ordered leaf ids and the ring wrap in in-order sequence', () => {
		const tree = sampleTree();
		assert.deepStrictEqual(orderedLeafIds(tree), ['p1', 'p2', 'p3']);
		assert.strictEqual(ringNeighbor(tree, 'p3', 1), 'p1');
		assert.strictEqual(ringNeighbor(tree, 'p1', -1), 'p3');
	});

	test('leafRects derives normalized geometry from split fractions', () => {
		const rects = leafRects(setFraction(sampleTree(), 's1', 0.25));
		assert.deepStrictEqual(rects.get('p1'), { x: 0, y: 0, w: 0.25, h: 1 });
		assert.deepStrictEqual(rects.get('p2'), { x: 0.25, y: 0, w: 0.75, h: 0.5 });
		assert.deepStrictEqual(rects.get('p3'), { x: 0.25, y: 0.5, w: 0.75, h: 0.5 });
	});

	test('setFraction clamps into [0.1, 0.9]', () => {
		const tree = setFraction(sampleTree(), 's1', 0.01);
		assert.strictEqual(findSplit(tree, 's1')?.fraction, 0.1);
		assert.strictEqual(findSplit(setFraction(tree, 's1', 2), 's1')?.fraction, 0.9);
	});

	test('splitBounds and dividers scale nested splits by their own sub-rectangle', () => {
		const tree = sampleTree();
		assert.deepStrictEqual(splitBounds(tree, 's2'), { x: 0.5, y: 0, w: 0.5, h: 1 });
		assert.deepStrictEqual(splitDividers(tree), [
			{ splitId: 's1', dir: 'row', rect: { x: 0.5, y: 0, w: 0, h: 1 }, bounds: { x: 0, y: 0, w: 1, h: 1 } },
			{ splitId: 's2', dir: 'column', rect: { x: 0.5, y: 0.5, w: 0.5, h: 0 }, bounds: { x: 0.5, y: 0, w: 0.5, h: 1 } }
		]);
	});

	test('directionalNeighbor uses a half-plane filter with nearest top-left corner', () => {
		const tree = sampleTree();
		assert.strictEqual(directionalNeighbor(tree, 'p1', 'right'), 'p2');
		assert.strictEqual(directionalNeighbor(tree, 'p3', 'left'), 'p1');
		assert.strictEqual(directionalNeighbor(tree, 'p2', 'down'), 'p3');
		assert.strictEqual(directionalNeighbor(tree, 'p3', 'up'), 'p2');
		assert.strictEqual(directionalNeighbor(tree, 'p1', 'left'), null);
	});

	test('resizeTarget finds the nearest ancestor split on the matching axis', () => {
		const tree = sampleTree();
		assert.deepStrictEqual(resizeTarget(tree, 'p3', 'down'), { splitId: 's2', onSideA: false });
		assert.deepStrictEqual(resizeTarget(tree, 'p3', 'right'), { splitId: 's1', onSideA: false });
		assert.strictEqual(resizeTarget(paneLeaf('p1'), 'p1', 'right'), null);
	});

	test('equalize distributes by direction-aware leaf weight', () => {
		// (p1 | p2) | p3 with skewed fractions → equalized thirds.
		let tree: BaseHalfPaneNode = paneLeaf('p1');
		tree = splitLeaf(tree, 'p1', 'right', 'p3', 'outer');
		tree = splitLeaf(tree, 'p1', 'right', 'p2', 'inner');
		tree = setFraction(setFraction(tree, 'outer', 0.9), 'inner', 0.2);
		const even = equalize(tree);
		assert.strictEqual(findSplit(even, 'outer')?.fraction.toFixed(4), (2 / 3).toFixed(4));
		assert.strictEqual(findSplit(even, 'inner')?.fraction, 0.5);
	});

	test('insertBeside places the new leaf on the near or far side', () => {
		const near = insertBeside(paneLeaf('p1'), 'p1', 'up', 'p2', 's1');
		assert.deepStrictEqual(orderedLeafIds(near), ['p2', 'p1']);
		const far = insertBeside(paneLeaf('p1'), 'p1', 'right', 'p2', 's1');
		assert.deepStrictEqual(orderedLeafIds(far), ['p1', 'p2']);
		assert.strictEqual(findSplit(near, 's1')?.dir, 'column');
		assert.strictEqual(findSplit(far, 's1')?.dir, 'row');
	});

	test('dropEdge partitions the pane into four edge triangles', () => {
		assert.strictEqual(dropEdge(0.1, 0.5), 'left');
		assert.strictEqual(dropEdge(0.9, 0.5), 'right');
		assert.strictEqual(dropEdge(0.5, 0.1), 'up');
		assert.strictEqual(dropEdge(0.5, 0.9), 'down');
	});

	test('firstLeaf and findLeaf walk the tree', () => {
		const tree = sampleTree();
		assert.strictEqual(firstLeaf(tree).id, 'p1');
		assert.strictEqual(findLeaf(tree, 'p3')?.id, 'p3');
		assert.strictEqual(findLeaf(tree, 'nope'), null);
	});
});
