/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	clampWorkflowCanvasOverlay,
	snapWorkflowCanvasNodeChanges,
	workflowCanvasConnectionPath,
	workflowCanvasOverlayPlacement,
	type WorkflowCanvasNodeFrame
} from '../webview-src/workflowCanvasInteraction.ts';

const root = { x: 0, y: 0 };

function frame(id: string, x: number, y: number, parentId?: string, parentOffset = root): WorkflowCanvasNodeFrame {
	return { id, parentId, position: { x, y }, parentOffset, width: 100, height: 80 };
}

test('keeps drag motion continuous until a card is near a sibling alignment', () => {
	const result = snapWorkflowCanvasNodeChanges([
		frame('moving', 100, 100),
		frame('target', 300, 104)
	], [{ id: 'moving', position: { x: 198, y: 160 }, dragging: true }], 5);

	assert.deepStrictEqual(result.changes[0].position, { x: 200, y: 160 });
	assert.deepStrictEqual(result.guides, [{ orientation: 'vertical', x: 300, y1: 104, y2: 240 }]);
});

test('snaps a multi-selection as one rigid group', () => {
	const result = snapWorkflowCanvasNodeChanges([
		frame('one', 0, 40),
		frame('two', 120, 40),
		frame('target', 400, 40)
	], [
		{ id: 'one', position: { x: 178, y: 120 }, dragging: true },
		{ id: 'two', position: { x: 298, y: 120 }, dragging: true }
	], 5);

	assert.deepStrictEqual(result.changes.map(change => change.position), [{ x: 180, y: 120 }, { x: 300, y: 120 }]);
	assert.equal(result.guides.some(guide => guide.orientation === 'vertical' && guide.x === 400), true);
});

test('only compares nodes that share the same Shot Group coordinate space', () => {
	const result = snapWorkflowCanvasNodeChanges([
		frame('moving', 20, 20, 'shot-a', { x: 500, y: 300 }),
		frame('other-group', 122, 20, 'shot-b', { x: 900, y: 300 }),
		frame('sibling', 220, 24, 'shot-a', { x: 500, y: 300 })
	], [{ id: 'moving', position: { x: 118, y: 80 }, dragging: true }], 5);

	assert.deepStrictEqual(result.changes[0].position, { x: 120, y: 80 });
	assert.deepStrictEqual(result.guides, [{ orientation: 'vertical', x: 720, y1: 324, y2: 460 }]);
});

test('retains final alignment on pointer-up but removes transient guides', () => {
	const result = snapWorkflowCanvasNodeChanges([
		frame('moving', 100, 100),
		frame('target', 300, 104)
	], [{ id: 'moving', position: { x: 198, y: 160 }, dragging: false }], 5);

	assert.deepStrictEqual(result.changes[0].position, { x: 200, y: 160 });
	assert.deepStrictEqual(result.guides, []);
});

test('keeps pointer menus inside the visible canvas', () => {
	assert.deepStrictEqual(clampWorkflowCanvasOverlay({ x: 790, y: 590 }, { width: 240, height: 300 }, { width: 800, height: 600 }), { x: 552, y: 292 });
	assert.deepStrictEqual(clampWorkflowCanvasOverlay({ x: -20, y: -40 }, { width: 240, height: 300 }, { width: 800, height: 600 }), { x: 8, y: 8 });
});

test('places contextual editors on a visible side of the node', () => {
	const overlay = { width: 320, height: 470 };
	const canvas = { width: 1200, height: 800 };
	assert.equal(workflowCanvasOverlayPlacement({ x: 100, y: 200, width: 224, height: 160 }, canvas, overlay), 'right');
	assert.equal(workflowCanvasOverlayPlacement({ x: 900, y: 200, width: 224, height: 160 }, canvas, overlay), 'left');
	assert.equal(workflowCanvasOverlayPlacement({ x: 250, y: 80, width: 224, height: 160 }, { width: 700, height: 800 }, overlay), 'bottom');
	assert.equal(workflowCanvasOverlayPlacement({ x: 250, y: 580, width: 224, height: 160 }, { width: 700, height: 800 }, overlay), 'top');
});

test('routes connections away from the chosen sides before curving to the target', () => {
	assert.equal(
		workflowCanvasConnectionPath({ x: 100, y: 80 }, 'north', { x: 340, y: 280 }, 'south'),
		'M 100 80 C 100 -140 340 500 340 280'
	);
	assert.equal(
		workflowCanvasConnectionPath({ x: 100, y: 80 }, 'east', { x: 340, y: 280 }, 'west'),
		'M 100 80 C 320 80 120 280 340 280'
	);
});
