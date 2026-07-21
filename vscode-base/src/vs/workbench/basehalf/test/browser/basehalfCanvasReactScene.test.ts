/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfCanvasPendingConnectionState,
	baseHalfCanvasInteractionOwnsEscape,
	baseHalfCanvasShouldOpenCreateMenu,
	baseHalfCanvasSceneSelectionRenameLabel,
	baseHalfCanvasTargetBlocksGraphShortcuts,
	baseHalfCanvasTargetOwnsSelectedEdgeShortcuts,
	captureBaseHalfCanvasNodeDragOrigins,
	captureBaseHalfCanvasCardFocusPath,
	filterBaseHalfCanvasCancelledNodeDragChanges,
	resolveBaseHalfCanvasSelectionToolbarPlacement,
	resolveBaseHalfCanvasCardFocusPath,
	restoreBaseHalfCanvasNodeDragOrigins
} from '../../browser/basehalfCanvasReactScene.js';

suite('BaseHalfCanvasReactScene', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('restores the same card control after a preview element replacement', () => {
		const oldTree = focusTree([focusTree(), focusTree([focusTree(), focusTree()])]);
		const newTree = focusTree([focusTree(), focusTree([focusTree(), focusTree()])]);
		const focusedControl = oldTree.children[1].children[0];

		const path = captureBaseHalfCanvasCardFocusPath(
			oldTree as unknown as Element,
			focusedControl as unknown as Element
		);
		assert.deepStrictEqual(path, [1, 0]);
		assert.strictEqual(
			resolveBaseHalfCanvasCardFocusPath(newTree as unknown as Element, path!),
			newTree.children[1].children[0] as unknown as Element
		);
	});

	test('keeps root focus and rejects unrelated or missing controls', () => {
		const root = focusTree([focusTree()]);
		const unrelated = focusTree();

		assert.deepStrictEqual(
			captureBaseHalfCanvasCardFocusPath(root as unknown as Element, root as unknown as Element),
			[]
		);
		assert.strictEqual(
			captureBaseHalfCanvasCardFocusPath(root as unknown as Element, unrelated as unknown as Element),
			undefined
		);
		assert.strictEqual(
			resolveBaseHalfCanvasCardFocusPath(root as unknown as Element, [1]),
			undefined
		);
	});

	test('keeps selection actions inside the viewport and flips below a top card', () => {
		const top = resolveBaseHalfCanvasSelectionToolbarPlacement({
			left: -100,
			top: 4,
			right: 100,
			bottom: 204,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 600,
			toolbarWidth: 116
		});
		assert.strictEqual(top.side, 'below');
		assert.ok(top.left >= 66);

		const bottom = resolveBaseHalfCanvasSelectionToolbarPlacement({
			left: 740,
			top: 520,
			right: 940,
			bottom: 720,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 600,
			toolbarWidth: 116
		});
		assert.strictEqual(bottom.side, 'above');
		assert.ok(bottom.left <= 734);
	});

	test('distinguishes a structural file rename from a visible node title edit', () => {
		assert.strictEqual(baseHalfCanvasSceneSelectionRenameLabel(false), 'Rename');
		assert.strictEqual(baseHalfCanvasSceneSelectionRenameLabel(true), 'Rename file');
	});

	test('keeps composition and nested controls ahead of graph shortcuts', () => {
		assert.strictEqual(baseHalfCanvasInteractionOwnsEscape({ key: 'Escape', isComposing: false, keyCode: 27 }), true);
		assert.strictEqual(baseHalfCanvasInteractionOwnsEscape({ key: 'Escape', isComposing: true, keyCode: 229 }), false);
		assert.strictEqual(baseHalfCanvasInteractionOwnsEscape({ key: 'Enter', isComposing: false, keyCode: 13 }), false);

		const card = document.createElement('div');
		const editor = document.createElement('div');
		editor.setAttribute('contenteditable', 'plaintext-only');
		const customInput = document.createElement('div');
		customInput.setAttribute('role', 'textbox');
		const restingContent = document.createElement('div');
		const flowNode = document.createElement('div');
		flowNode.classList.add('react-flow__node', 'nopan');
		const flowNodeContent = document.createElement('div');
		const flowNodeButton = document.createElement('button');
		flowNode.append(flowNodeContent, flowNodeButton);
		const selectedEdge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		selectedEdge.classList.add('react-flow__edge', 'selected', 'nopan');
		card.append(editor, customInput, restingContent);

		assert.strictEqual(baseHalfCanvasTargetBlocksGraphShortcuts(editor), true);
		assert.strictEqual(baseHalfCanvasTargetBlocksGraphShortcuts(customInput), true);
		assert.strictEqual(baseHalfCanvasTargetBlocksGraphShortcuts(restingContent), false);
		assert.strictEqual(baseHalfCanvasTargetBlocksGraphShortcuts(flowNodeContent), false);
		assert.strictEqual(baseHalfCanvasTargetBlocksGraphShortcuts(flowNodeButton), true);
		assert.strictEqual(baseHalfCanvasTargetBlocksGraphShortcuts(selectedEdge), true);
		assert.strictEqual(baseHalfCanvasTargetOwnsSelectedEdgeShortcuts(selectedEdge), true);
		assert.strictEqual(baseHalfCanvasTargetOwnsSelectedEdgeShortcuts(restingContent), false);
	});

	test('opens the create menu only for an unmodified primary-button pane double click', () => {
		const event = {
			altKey: false,
			button: 0,
			ctrlKey: false,
			detail: 2,
			metaKey: false,
			shiftKey: false
		};
		assert.strictEqual(baseHalfCanvasShouldOpenCreateMenu(event, false), true);
		assert.strictEqual(baseHalfCanvasShouldOpenCreateMenu({ ...event, detail: 1 }, false), false);
		assert.strictEqual(baseHalfCanvasShouldOpenCreateMenu({ ...event, button: 1 }, false), false);
		assert.strictEqual(baseHalfCanvasShouldOpenCreateMenu({ ...event, shiftKey: true }, false), false);
		assert.strictEqual(baseHalfCanvasShouldOpenCreateMenu(event, true), false);
	});

	test('clears one connection owner synchronously and rejects trailing completion', () => {
		const state = new BaseHalfCanvasPendingConnectionState();
		assert.deepStrictEqual(state.begin('folder', 4, 'pointer'), { kind: 'owned', previous: undefined });
		const pointer = state.peek();
		assert.strictEqual(pointer?.gesture, 'pointer');

		assert.strictEqual(state.cancel(), pointer);
		assert.strictEqual(state.peek(), undefined);
		assert.strictEqual(state.take('pointer'), undefined);

		state.begin('folder', 4, 'pointer');
		state.cancel(true);
		assert.deepStrictEqual(
			state.begin('folder', 4, 'click', { rejectableTrailingClick: true }),
			{ kind: 'rejected-trailing-click' }
		);
		assert.strictEqual(state.peek(), undefined);

		assert.strictEqual(state.begin('folder', 4, 'click').kind, 'owned');
		assert.strictEqual(state.take('pointer'), undefined);
		assert.strictEqual(state.peek()?.gesture, 'click');
		assert.strictEqual(state.take('click')?.gesture, 'click');
		assert.strictEqual(state.peek(), undefined);
	});

	test('keeps click connection ownership through the destination pointer sequence', () => {
		const state = new BaseHalfCanvasPendingConnectionState();
		assert.strictEqual(state.begin('folder', 7, 'click').kind, 'owned');
		const clickOwner = state.peek();

		assert.deepStrictEqual(state.begin('folder', 7, 'pointer'), { kind: 'deferred-to-click' });
		assert.strictEqual(state.peek(), clickOwner);
		assert.strictEqual(state.peekMutationOwner(), undefined);
		assert.deepStrictEqual(state.finishPointer(), { kind: 'deferred-to-click' });
		assert.strictEqual(state.peekMutationOwner(), clickOwner);
		assert.strictEqual(state.take('click'), clickOwner);
	});

	test('restores every dragged selection origin and suppresses its trailing geometry', () => {
		const original = [
			{ id: 'a', position: { x: 10, y: 20 }, marker: 'first' },
			{ id: 'b', position: { x: 30, y: 40 }, marker: 'second' },
			{ id: 'c', position: { x: 50, y: 60 }, marker: 'untouched' }
		];
		const origins = captureBaseHalfCanvasNodeDragOrigins(original, new Set(['a', 'b']));
		const moved = [
			{ ...original[0], position: { x: 110, y: 120 } },
			{ ...original[1], position: { x: 130, y: 140 } },
			original[2]
		];
		const restored = restoreBaseHalfCanvasNodeDragOrigins(moved, origins);

		assert.deepStrictEqual(restored.map(node => node.position), original.map(node => node.position));
		assert.strictEqual(restored[2], original[2]);
		assert.deepStrictEqual(filterBaseHalfCanvasCancelledNodeDragChanges([
			{ id: 'a', type: 'position' },
			{ id: 'b', type: 'dimensions' },
			{ id: 'a', type: 'select' },
			{ id: 'c', type: 'position' }
		], origins), [
			{ id: 'a', type: 'select' },
			{ id: 'c', type: 'position' }
		]);
	});
});

interface IFocusTree {
	parentElement: IFocusTree | null;
	children: IFocusTree[];
}

function focusTree(children: IFocusTree[] = []): IFocusTree {
	const node: IFocusTree = { parentElement: null, children };
	for (const child of children) {
		child.parentElement = node;
	}
	return node;
}
