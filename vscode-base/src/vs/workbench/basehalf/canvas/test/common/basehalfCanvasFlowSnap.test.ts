/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import type { Node, NodeChange } from '@xyflow/react';
import {
	IBaseHalfCanvasFlowSnapOptions,
	sameBaseHalfCanvasSnapGuides,
	snapBaseHalfCanvasFlowNodeChanges
} from '../../common/basehalfCanvasFlowSnap.js';

type TestNode = Node<Record<string, unknown>>;

const options: IBaseHalfCanvasFlowSnapOptions = {
	threshold: 5,
	defaultWidth: 100,
	defaultHeight: 80,
	minWidth: 40,
	minHeight: 40
};

suite('BaseHalfCanvasFlowSnap', () => {
	test('snaps one dragged node and its absolute position', () => {
		const nodes = [
			node('moving', 0, 20, 100, 80),
			node('target', 200, 300, 100, 80)
		];
		const result = snapBaseHalfCanvasFlowNodeChanges(nodes, [{
			id: 'moving',
			type: 'position',
			position: { x: 97, y: 20 },
			positionAbsolute: { x: 107, y: 30 },
			dragging: true
		}], options);

		assert.deepStrictEqual(result.changes, [{
			id: 'moving',
			type: 'position',
			position: { x: 100, y: 20 },
			positionAbsolute: { x: 110, y: 30 },
			dragging: true
		}]);
		assert.deepStrictEqual(result.guides, [{
			orientation: 'vertical',
			x: 200,
			y1: 20,
			y2: 380
		}]);
	});

	test('snaps a multi-node drag as one stable selection', () => {
		const nodes = [
			node('first', 0, 20, 50, 80),
			node('second', 100, 20, 50, 80),
			node('target', 200, 300, 100, 80)
		];
		const result = snapBaseHalfCanvasFlowNodeChanges(nodes, [
			{ id: 'first', type: 'position', position: { x: 47, y: 20 }, dragging: true },
			{ id: 'second', type: 'position', position: { x: 147, y: 20 }, dragging: true }
		], options);

		assert.deepStrictEqual(result.changes, [
			{ id: 'first', type: 'position', position: { x: 50, y: 20 }, dragging: true },
			{ id: 'second', type: 'position', position: { x: 150, y: 20 }, dragging: true }
		]);
		assert.strictEqual(
			(result.changes[1] as Extract<NodeChange<TestNode>, { type: 'position' }>).position!.x
				- (result.changes[0] as Extract<NodeChange<TestNode>, { type: 'position' }>).position!.x,
			100
		);
	});

	test('snaps resize dimensions and a moved resize edge', () => {
		const nodes = [
			node('right-edge', 0, 20, 100, 80),
			node('left-edge', 300, 20, 100, 80),
			node('target', 200, 300, 100, 80)
		];
		const rightResult = snapBaseHalfCanvasFlowNodeChanges(nodes, [{
			id: 'right-edge',
			type: 'dimensions',
			dimensions: { width: 197, height: 80 },
			resizing: true
		}], options);
		const leftResult = snapBaseHalfCanvasFlowNodeChanges(nodes, [
			{
				id: 'left-edge',
				type: 'position',
				position: { x: 203, y: 20 }
			},
			{
				id: 'left-edge',
				type: 'dimensions',
				dimensions: { width: 197, height: 80 },
				resizing: true
			}
		], options);

		assert.deepStrictEqual(rightResult.changes, [{
			id: 'right-edge',
			type: 'dimensions',
			dimensions: { width: 200, height: 80 },
			resizing: true
		}]);
		assert.deepStrictEqual(leftResult.changes, [
			{ id: 'left-edge', type: 'position', position: { x: 200, y: 20 } },
			{
				id: 'left-edge',
				type: 'dimensions',
				dimensions: { width: 200, height: 80 },
				resizing: true
			}
		]);
		assert.strictEqual(rightResult.guides[0]?.orientation, 'vertical');
		assert.strictEqual(leftResult.guides[0]?.orientation, 'vertical');
	});

	test('commits the last controlled rectangle when resize-end repeats raw dimensions', () => {
		const nodes = [
			node('moving', 200, 20, 200, 80),
			node('target', 100, 300, 100, 80)
		];
		const result = snapBaseHalfCanvasFlowNodeChanges(nodes, [{
			id: 'moving',
			type: 'dimensions',
			dimensions: { width: 197, height: 80 },
			resizing: false
		}], options);

		assert.deepStrictEqual(result.changes, [{
			id: 'moving',
			type: 'dimensions',
			dimensions: { width: 200, height: 80 },
			resizing: false
		}]);
		assert.deepStrictEqual(result.guides, []);
	});

	test('shows guides only for moved axes and compares guide geometry with tolerance', () => {
		const nodes = [
			node('moving', 0, 20, 100, 80),
			node('target', 200, 20, 100, 80)
		];
		const result = snapBaseHalfCanvasFlowNodeChanges(nodes, [{
			id: 'moving',
			type: 'position',
			position: { x: 97, y: 20 },
			dragging: true
		}], options);

		assert.deepStrictEqual(result.guides, [{
			orientation: 'vertical',
			x: 200,
			y1: 20,
			y2: 100
		}]);
		assert.strictEqual(sameBaseHalfCanvasSnapGuides(result.guides, [{
			orientation: 'vertical',
			x: 200.05,
			y1: 20.05,
			y2: 100.05
		}]), true);
		assert.strictEqual(sameBaseHalfCanvasSnapGuides(result.guides, [{
			orientation: 'vertical',
			x: 200.2,
			y1: 20,
			y2: 100
		}]), false);
	});

	test('bypasses snapping and guides when disabled', () => {
		const nodes = [
			node('moving', 0, 20, 100, 80),
			node('target', 200, 20, 100, 80)
		];
		const changes: NodeChange<TestNode>[] = [{
			id: 'moving',
			type: 'position',
			position: { x: 97, y: 20 },
			dragging: true
		}];
		const result = snapBaseHalfCanvasFlowNodeChanges(nodes, changes, { ...options, disabled: true });

		assert.deepStrictEqual(result.changes, changes);
		assert.notStrictEqual(result.changes, changes);
		assert.deepStrictEqual(result.guides, []);
	});
});

function node(id: string, x: number, y: number, width: number, height: number): TestNode {
	return {
		id,
		position: { x, y },
		data: {},
		width,
		height
	};
}
