/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
	BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_GAP,
	BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_HEIGHT
} from '../../common/basehalfCanvasScene.js';
import {
	BaseHalfCanvasPendingConnectionState,
	BaseHalfCanvasSelectionIntentCoordinator,
	baseHalfCanvasInteractionOwnsEscape,
	baseHalfCanvasResizeStartSize,
	baseHalfCanvasSceneCardIsNoteEditing,
	baseHalfCanvasSceneGeometryForCommit,
	baseHalfCanvasSceneNodeSize,
	baseHalfCanvasSceneProjectsSelection,
	baseHalfCanvasSceneShowsResizeControls,
	baseHalfCanvasShouldOpenCreateMenu,
	baseHalfCanvasSceneSelectionRenameLabel,
	baseHalfCanvasTargetBlocksGraphShortcuts,
	baseHalfCanvasTargetOwnsSelectionShortcuts,
	baseHalfCanvasTargetOwnsSelectedEdgeShortcuts,
	baseHalfCanvasVideoToolbarWidth,
	captureBaseHalfCanvasNodeDragOrigins,
	captureBaseHalfCanvasCardFocusPath,
	filterBaseHalfCanvasCancelledNodeDragChanges,
	resolveBaseHalfCanvasNoteSelectionPlacement,
	resolveBaseHalfCanvasVideoComposerPlacement,
	resolveBaseHalfCanvasVideoSelectionPlacement,
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

	test('clamps invalid final geometry before it reaches the canvas mirror', () => {
		assert.deepStrictEqual(baseHalfCanvasSceneGeometryForCommit({
			path: 'note.md',
			kind: 'file',
			x: Number.NaN,
			y: 42,
			width: -8,
			height: Number.POSITIVE_INFINITY
		}, {
			x: 12,
			y: 24,
			width: 300,
			height: 220
		}), {
			path: 'note.md',
			kind: 'file',
			x: 12,
			y: 42,
			width: 140,
			height: 220
		});
	});

	test('recovers the painted card size for a repeated resize start', () => {
		assert.deepStrictEqual(baseHalfCanvasResizeStartSize(
			{ width: 148, height: 112 },
			0.5,
			{ width: 248, height: 188 }
		), { width: 296, height: 224 });
		assert.deepStrictEqual(baseHalfCanvasResizeStartSize(
			{ width: Number.NaN, height: 0 },
			1,
			{ width: 248, height: 188 }
		), { width: 248, height: 188 });
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

	test('keeps the Note toolbar above or below the card and inside viewport edges', () => {
		const centered = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: 300,
			top: 180,
			right: 500,
			bottom: 380,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 600
		});
		assert.strictEqual(centered.visible, true);
		assert.strictEqual(centered.side, 'above');
		assert.strictEqual(centered.width, 392);
		assert.strictEqual(centered.height, 36);
		assert.strictEqual(
			(180 - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT)
				- (centered.top + centered.height),
			10
		);

		const highZoom = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: 200,
			top: 60,
			right: 400,
			bottom: 280,
			viewport: { x: 0, y: 0, zoom: 2 },
			viewportWidth: 800,
			viewportHeight: 680
		});
		assert.strictEqual(highZoom.side, 'above');
		assert.strictEqual(highZoom.width, 392);
		assert.strictEqual(highZoom.height, 36);
		assert.strictEqual(
			((60 - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * 2)
				- (highZoom.top * 2 + highZoom.height),
			10
		);

		const bottomEdge = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: 740,
			top: 520,
			right: 940,
			bottom: 720,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 600
		});
		assert.strictEqual(bottomEdge.side, 'above');
		assert.ok(bottomEdge.left >= 8);
		assert.ok(bottomEdge.left + bottomEdge.width <= 792);
		assert.ok(bottomEdge.top >= 8);
		assert.ok(bottomEdge.top + bottomEdge.height <= 520);

		const topEdge = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: -120,
			top: -40,
			right: 80,
			bottom: 160,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 300,
			viewportHeight: 600
		});
		assert.strictEqual(topEdge.side, 'below');
		assert.ok(topEdge.left >= 8);
		assert.ok(topEdge.top >= 8);
		assert.ok(topEdge.left + topEdge.width <= 292);
		assert.ok(topEdge.top + topEdge.height <= 592);

		const narrow = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: 20,
			top: 180,
			right: 160,
			bottom: 300,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 180,
			viewportHeight: 600
		});
		assert.strictEqual(narrow.width, 164);
		assert.strictEqual(narrow.height, 36);
		assert.ok(narrow.left >= 8);
		assert.ok(narrow.left + narrow.width <= 172);

		const offscreen = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: 900,
			top: 700,
			right: 1100,
			bottom: 900,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 600
		});
		assert.strictEqual(offscreen.visible, false);
	});

	test('keeps the compact Video Result toolbar above the card in stable screen-space geometry', () => {
		assert.strictEqual(baseHalfCanvasVideoToolbarWidth(['importResult']), 112);
		assert.strictEqual(baseHalfCanvasVideoToolbarWidth(['copySettings', 'showDetails', 'more', 'openFullPreview']), 131);
		assert.strictEqual(baseHalfCanvasVideoToolbarWidth(['importResult', 'showDetails']), 112);

		const centered = resolveBaseHalfCanvasVideoSelectionPlacement({
			left: 160,
			top: 180,
			right: 880,
			bottom: 629,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 1100,
			viewportHeight: 860,
			toolbarWidth: 131
		});
		assert.strictEqual(centered.visible, true);
		assert.strictEqual(centered.side, 'above');
		assert.strictEqual(centered.width, 131);
		assert.strictEqual(centered.height, 36);
		assert.strictEqual(
			(180 - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT)
				- (centered.top + centered.height),
			10
		);

		const zoomed = resolveBaseHalfCanvasVideoSelectionPlacement({
			left: 160,
			top: 180,
			right: 880,
			bottom: 629,
			viewport: { x: -160, y: -180, zoom: 2 },
			viewportWidth: 1100,
			viewportHeight: 860,
			toolbarWidth: 131
		});
		assert.strictEqual(zoomed.visible, true);
		assert.strictEqual(zoomed.side, 'above');
		assert.strictEqual(zoomed.width, centered.width);
		assert.strictEqual(zoomed.height, centered.height);
		assert.strictEqual(
			((180 - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * 2 - 180)
				- (zoomed.top * 2 - 180 + zoomed.height),
			10
		);

		const zoomedOut = resolveBaseHalfCanvasVideoSelectionPlacement({
			left: 160,
			top: 600,
			right: 880,
			bottom: 1049,
			viewport: { x: 0, y: 0, zoom: 0.2 },
			viewportWidth: 1100,
			viewportHeight: 860,
			toolbarWidth: 131
		});
		assert.strictEqual(zoomedOut.visible, true);
		assert.ok(Math.abs(
			(600 - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * 0.2
				- (zoomedOut.top * 0.2 + zoomedOut.height)
				- 10
		) < 1e-9);

		const narrow = resolveBaseHalfCanvasVideoSelectionPlacement({
			left: -100,
			top: 4,
			right: 620,
			bottom: 453,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 120,
			viewportHeight: 680,
			toolbarWidth: 131
		});
		assert.strictEqual(narrow.side, 'above');
		assert.strictEqual(narrow.visible, false);
		assert.strictEqual(narrow.width, 104);
		assert.ok(narrow.left >= 8);
		assert.ok(narrow.left + narrow.width <= 112);
	});

	test('keeps the Video Composer at the shared compact gap and fixed screen size', () => {
		const centered = resolveBaseHalfCanvasVideoComposerPlacement({
			left: 100,
			top: 80,
			right: 500,
			bottom: 300,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 700,
			screenWidth: 280,
			screenHeight: BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_HEIGHT
		});
		assert.deepStrictEqual(centered, {
			placement: 'below',
			visible: true,
			left: 160,
			top: 316,
			flowLeft: 160,
			flowTop: 316,
			screenWidth: 280,
			screenHeight: BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_HEIGHT
		});

		const zoomedAndPanned = resolveBaseHalfCanvasVideoComposerPlacement({
			left: 100,
			top: 80,
			right: 500,
			bottom: 300,
			viewport: { x: -100, y: -80, zoom: 2 },
			viewportWidth: 1000,
			viewportHeight: 900,
			screenWidth: 280,
			screenHeight: BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_HEIGHT
		});
		assert.strictEqual(zoomedAndPanned.visible, true);
		assert.strictEqual(zoomedAndPanned.placement, 'below');
		assert.strictEqual(zoomedAndPanned.left, 360);
		assert.strictEqual(zoomedAndPanned.top, 536);
		assert.strictEqual(zoomedAndPanned.flowLeft, 230);
		assert.strictEqual(zoomedAndPanned.flowTop, 308);
		assert.strictEqual(zoomedAndPanned.screenWidth, centered.screenWidth);
		assert.strictEqual(zoomedAndPanned.screenHeight, centered.screenHeight);

		const narrow = resolveBaseHalfCanvasVideoComposerPlacement({
			left: 0,
			top: 40,
			right: 240,
			bottom: 200,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 220,
			viewportHeight: 520,
			screenWidth: 640,
			screenHeight: BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_HEIGHT
		});
		assert.strictEqual(narrow.visible, true);
		assert.strictEqual(narrow.left, 8);
		assert.strictEqual(narrow.top, 216);
		assert.strictEqual(narrow.screenWidth, 204);

		const partiallyClipped = resolveBaseHalfCanvasVideoComposerPlacement({
			left: 100,
			top: 400,
			right: 500,
			bottom: 620,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 700,
			screenWidth: 280,
			screenHeight: BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_HEIGHT
		});
		assert.strictEqual(partiallyClipped.visible, true);
		assert.strictEqual(partiallyClipped.placement, 'below');
		assert.strictEqual(partiallyClipped.top, 636);

		const fullyBelowViewport = resolveBaseHalfCanvasVideoComposerPlacement({
			left: 100,
			top: 650,
			right: 500,
			bottom: 720,
			viewport: { x: 0, y: 0, zoom: 1 },
			viewportWidth: 800,
			viewportHeight: 700,
			screenWidth: 280,
			screenHeight: BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_HEIGHT
		});
		assert.strictEqual(fullyBelowViewport.visible, false);
		assert.strictEqual(fullyBelowViewport.top, 736);
		assert.strictEqual(centered.top - 300, BASEHALF_CANVAS_VIDEO_COMPOSER_SCREEN_GAP);
	});

	test('commits an allowed selection intent after preparation', async () => {
		const coordinator = new BaseHalfCanvasSelectionIntentCoordinator();
		const order: string[] = [];

		const committed = await coordinator.request(
			async () => { order.push('prepare'); return true; },
			() => order.push('commit')
		);

		assert.strictEqual(committed, true);
		assert.deepStrictEqual(order, ['prepare', 'commit']);
	});

	test('does not commit a vetoed selection intent', async () => {
		const coordinator = new BaseHalfCanvasSelectionIntentCoordinator();
		let commitCalls = 0;

		const committed = await coordinator.request(async () => false, () => commitCalls++);

		assert.strictEqual(committed, false);
		assert.strictEqual(commitCalls, 0);
	});

	test('coalesces rapid selection intents so only the newest one commits', async () => {
		const coordinator = new BaseHalfCanvasSelectionIntentCoordinator();
		const order: string[] = [];
		const request = (id: string) => coordinator.request(
			async () => { order.push(`prepare-${id}`); return true; },
			() => order.push(`commit-${id}`)
		);

		const results = await Promise.all([request('A'), request('B'), request('C')]);

		assert.deepStrictEqual(results, [false, false, true]);
		assert.deepStrictEqual(order, ['prepare-A', 'prepare-B', 'prepare-C', 'commit-C']);
	});

	test('invalidates an in-flight selection when the controlled selection is chosen again', async () => {
		const coordinator = new BaseHalfCanvasSelectionIntentCoordinator();
		let release!: () => void;
		const preparing = new Promise<void>(resolve => release = resolve);
		let committed = false;
		const pending = coordinator.request(async () => {
			await preparing;
			return true;
		}, () => committed = true);

		coordinator.invalidate();
		release();

		assert.strictEqual(await pending, false);
		assert.strictEqual(committed, false);
	});

	test('propagates preparation errors and recovers the selection intent queue', async () => {
		const coordinator = new BaseHalfCanvasSelectionIntentCoordinator();
		const failure = new Error('save failed');
		const commits: string[] = [];
		const rejected = coordinator.request(async () => { throw failure; }, () => commits.push('failed'));
		const recovered = coordinator.request(async () => true, () => commits.push('recovered'));

		await assert.rejects(rejected, error => error === failure);
		assert.strictEqual(await recovered, true);
		assert.deepStrictEqual(commits, ['recovered']);
	});

	test('distinguishes a structural file rename from a visible node title edit', () => {
		assert.strictEqual(baseHalfCanvasSceneSelectionRenameLabel(false), 'Rename');
		assert.strictEqual(baseHalfCanvasSceneSelectionRenameLabel(true), 'Rename file');
	});

	test('does not confuse an interactive Badge face with Note editing', () => {
		const controls = { kind: 'note' as const };
		assert.strictEqual(baseHalfCanvasSceneCardIsNoteEditing({ controls }), false);
		assert.strictEqual(baseHalfCanvasSceneCardIsNoteEditing({ controls, noteEditing: true }), true);
		assert.strictEqual(baseHalfCanvasSceneCardIsNoteEditing({ noteEditing: true }), false);
	});

	test('projects selection separately from single-card resize controls', () => {
		assert.strictEqual(baseHalfCanvasSceneProjectsSelection(false, false), false);
		assert.strictEqual(baseHalfCanvasSceneProjectsSelection(false, true), false);
		assert.strictEqual(baseHalfCanvasSceneProjectsSelection(true, false), true);
		assert.strictEqual(baseHalfCanvasSceneProjectsSelection(true, true), false);

		assert.strictEqual(baseHalfCanvasSceneShowsResizeControls(true, false, 1), true);
		assert.strictEqual(baseHalfCanvasSceneShowsResizeControls(true, false, 2), false);
		assert.strictEqual(baseHalfCanvasSceneShowsResizeControls(true, true, 1), false);
		assert.strictEqual(baseHalfCanvasSceneShowsResizeControls(false, false, 1), false);
	});

	test('seeds the resizer measured box from persisted card geometry', () => {
		assert.deepStrictEqual(baseHalfCanvasSceneNodeSize({ width: 640, height: 360 }), {
			initialWidth: 640,
			initialHeight: 360,
			measured: { width: 640, height: 360 },
			style: { width: 640, height: 360 }
		});
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
		const noteToolbar = document.createElement('div');
		noteToolbar.classList.add('basehalf-canvas-note-toolbar');
		const noteToolbarButton = document.createElement('button');
		noteToolbar.append(noteToolbarButton);
		const videoToolbar = document.createElement('div');
		videoToolbar.classList.add('basehalf-video-context-toolbar', 'basehalf-video-result-toolbar');
		const videoToolbarButton = document.createElement('button');
		videoToolbar.append(videoToolbarButton);
		const videoDraftToolbar = document.createElement('div');
		videoDraftToolbar.classList.add('basehalf-video-context-toolbar', 'basehalf-video-draft-toolbar');
		const videoDraftToolbarButton = document.createElement('button');
		videoDraftToolbar.append(videoDraftToolbarButton);
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
		assert.strictEqual(baseHalfCanvasTargetOwnsSelectionShortcuts(noteToolbarButton), true);
		assert.strictEqual(baseHalfCanvasTargetOwnsSelectionShortcuts(videoToolbarButton), true);
		assert.strictEqual(baseHalfCanvasTargetOwnsSelectionShortcuts(videoDraftToolbarButton), true);
		assert.strictEqual(baseHalfCanvasTargetOwnsSelectionShortcuts(restingContent), false);
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
