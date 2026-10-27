/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import type { Node, NodeChange } from '@xyflow/react';
import {
	BASEHALF_CANVAS_HELD_SNAP_NONE,
	IBaseHalfCanvasFlowSnapOptions,
	IBaseHalfCanvasHeldSnap,
	sameBaseHalfCanvasSnapGuides,
	snapBaseHalfCanvasFlowNodeChanges,
	snapBaseHalfCanvasHeldCards
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
	test('a held card is not snapped while a folder takes it, never jumps, and is snapped again from where it is', () => {
		// A neighbour whose top is at y 20; the held card moves along that line,
		// into a folder (taken) and out again.
		const nodes = [node('moving', 0, 300, 100, 80), node('neighbour', 200, 20, 100, 80)];
		let held: IBaseHalfCanvasHeldSnap = BASEHALF_CANVAS_HELD_SNAP_NONE;
		const move = (x: number, y: number, taken: boolean, dragging = true) => {
			const result = snapBaseHalfCanvasHeldCards(nodes, [{ id: 'moving', type: 'position', position: { x, y }, dragging }], options, held, taken);
			held = result.held;
			const change = result.changes[0];
			return { at: change.type === 'position' ? change.position : undefined, guides: result.guides.length > 0 };
		};
		assert.deepStrictEqual([
			// Snapped to the neighbour's top, 3 below it.
			move(500, 23, false),
			// Taken: no guide, and the card moves by exactly what the pointer
			// does (7, 1) from where it was drawn, with what snapping gave it.
			move(507, 24, true),
			move(510, 26, true),
			// Let go: snapped again from where it is, 1 below the line.
			move(512, 24, false),
			// Away from the line: nothing pulls it.
			move(530, 40, false),
			// The place it is let go is the place it was drawn.
			move(530, 40, false, false)
		], [
			{ at: { x: 500, y: 20 }, guides: true },
			{ at: { x: 507, y: 21 }, guides: false },
			{ at: { x: 510, y: 23 }, guides: false },
			{ at: { x: 512, y: 20 }, guides: true },
			{ at: { x: 530, y: 37 }, guides: false },
			{ at: { x: 530, y: 37 }, guides: false }
		]);
	});

	test('a change that is not of a held card passes as it would without a drag', () => {
		const nodes = [node('resized', 0, 0, 100, 80), node('neighbour', 200, 20, 100, 80)];
		const held: IBaseHalfCanvasHeldSnap = { kept: { x: 4, y: -3 }, last: { x: 0, y: 2 } };
		const changes: NodeChange<TestNode>[] = [{ id: 'resized', type: 'dimensions', dimensions: { width: 197, height: 80 }, resizing: true }];
		const result = snapBaseHalfCanvasHeldCards(nodes, changes, options, held, true);
		assert.deepStrictEqual(result.changes, snapBaseHalfCanvasFlowNodeChanges(nodes, changes, options).changes);
		assert.strictEqual(result.held, held);
	});

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
