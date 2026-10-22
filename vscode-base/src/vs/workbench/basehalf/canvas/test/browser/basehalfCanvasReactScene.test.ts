/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
	BASEHALF_CANVAS_CARD_CORNER_RADIUS
} from '../../common/basehalfCanvasScene.js';
import {
	BaseHalfCanvasResizeCorner,
	baseHalfCanvasResizeStartSize,
	baseHalfCanvasSceneProjectsSelection,
	baseHalfCanvasSceneShowsResizeControls,
	captureBaseHalfCanvasCardFocusPath,
	resolveBaseHalfCanvasCardFocusPath,
	resolveBaseHalfCanvasResizeCornerGeometry
} from '../../browser/scene/basehalfCanvasCardNode.js';
import { BaseHalfCanvasPendingConnectionState } from '../../browser/scene/basehalfCanvasSceneConnections.js';
import { baseHalfCanvasSceneGeometryForCommit, baseHalfCanvasSceneNodeSize } from '../../browser/scene/basehalfCanvasSceneGeometry.js';
import { baseHalfCanvasTargetBlocksGraphShortcuts, baseHalfCanvasTargetOwnsSelectionShortcuts, baseHalfCanvasTargetOwnsSelectedEdgeShortcuts } from '../../browser/scene/basehalfCanvasSceneKeyboard.js';
import { baseHalfCanvasCardDoubleClickAction, baseHalfCanvasShouldOpenCreateMenu } from '../../browser/scene/basehalfCanvasSceneMouse.js';
import { captureBaseHalfCanvasNodeDragOrigins, filterBaseHalfCanvasCancelledNodeDragChanges, restoreBaseHalfCanvasNodeDragOrigins } from '../../browser/scene/basehalfCanvasSceneNodeDrag.js';
import { baseHalfCanvasAutoPanStep, baseHalfCanvasScenePressGesture } from '../../browser/scene/basehalfCanvasScenePressGesture.js';
import { BaseHalfCanvasSelectionIntentCoordinator } from '../../browser/scene/basehalfCanvasSceneSelection.js';
import { baseHalfCanvasInteractionOwnsEscape, baseHalfCanvasSceneCardIsNoteEditing, baseHalfCanvasSceneVideoInputPickGesturePolicy } from '../../browser/scene/basehalfCanvasSceneShared.js';
import {
	baseHalfCanvasVideoToolbarWidth,
	resolveBaseHalfCanvasNoteSelectionPlacement,
	resolveBaseHalfCanvasVideoPanelPlacement,
	resolveBaseHalfCanvasVideoSelectionPlacement,
	resolveBaseHalfCanvasSelectionToolbarPlacement
} from '../../browser/scene/basehalfCanvasSelectionControlsPlacement.js';
import { baseHalfCanvasSceneSelectionRenameLabel } from '../../browser/scene/basehalfCanvasSelectionToolbar.js';

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

	test('a cancelled drag leaves no card marked as being dragged', () => {
		const untouched = { id: 'c', position: { x: 5, y: 5 }, dragging: true };
		const nodes = [
			{ id: 'a', position: { x: 40, y: 50 }, dragging: true },
			{ id: 'b', position: { x: 10, y: 20 }, dragging: true },
			untouched
		];
		const restored = restoreBaseHalfCanvasNodeDragOrigins(nodes, [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 10, y: 20 }]);
		assert.deepStrictEqual(
			{ restored, sameUntouched: restored[2] === untouched },
			{
				restored: [
					{ id: 'a', position: { x: 1, y: 2 }, dragging: false },
					{ id: 'b', position: { x: 10, y: 20 }, dragging: false },
					{ id: 'c', position: { x: 5, y: 5 }, dragging: true }
				],
				sameUntouched: true
			}
		);
	});

	test('commits a geometry with the four decimal places that the layout stores', () => {
		assert.deepStrictEqual(baseHalfCanvasSceneGeometryForCommit({
			path: 'note.md',
			kind: 'file',
			x: 1271.8663878,
			y: 845.59921,
			width: 300.00004,
			height: 220
		}, {
			x: 0,
			y: 0,
			width: 300,
			height: 220
		}), {
			path: 'note.md',
			kind: 'file',
			x: 1271.8664,
			y: 845.5992,
			width: 300,
			height: 220
		});
	});

	test('a press becomes a marquee on empty canvas, a move on the set box, and a marquee anywhere on the scene with Shift', () => {
		const flow = document.createElement('div');
		flow.className = 'react-flow';
		const pane = flow.appendChild(document.createElement('div'));
		pane.className = 'react-flow__pane';
		const card = pane.appendChild(document.createElement('div'));
		card.className = 'basehalf-canvas-card';
		const cardText = card.appendChild(document.createElement('p'));
		const cardButton = card.appendChild(document.createElement('button'));
		const handle = pane.appendChild(document.createElement('div'));
		handle.className = 'basehalf-canvas-card-connect-handle';
		const editingCard = pane.appendChild(document.createElement('div'));
		editingCard.className = 'basehalf-canvas-card';
		editingCard.dataset.noteEditing = 'true';
		const editingText = editingCard.appendChild(document.createElement('p'));
		const box = pane.appendChild(document.createElement('div'));
		box.className = 'basehalf-canvas-set-box';
		const toolbar = pane.appendChild(document.createElement('div'));
		toolbar.className = 'basehalf-canvas-adjacent-chrome';
		const outside = document.createElement('div');

		const gestures = (shiftKey: boolean) => ({
			pane: baseHalfCanvasScenePressGesture(pane, shiftKey),
			card: baseHalfCanvasScenePressGesture(cardText, shiftKey),
			cardButton: baseHalfCanvasScenePressGesture(cardButton, shiftKey),
			handle: baseHalfCanvasScenePressGesture(handle, shiftKey),
			editingNote: baseHalfCanvasScenePressGesture(editingText, shiftKey),
			box: baseHalfCanvasScenePressGesture(box, shiftKey),
			toolbar: baseHalfCanvasScenePressGesture(toolbar, shiftKey),
			outside: baseHalfCanvasScenePressGesture(outside, shiftKey)
		});
		assert.deepStrictEqual({ plain: gestures(false), shift: gestures(true) }, {
			plain: { pane: 'marquee', card: undefined, cardButton: undefined, handle: undefined, editingNote: undefined, box: 'move', toolbar: undefined, outside: undefined },
			shift: { pane: 'marquee', card: 'marquee', cardButton: undefined, handle: undefined, editingNote: undefined, box: 'marquee', toolbar: undefined, outside: undefined }
		});
	});

	test('the canvas moves towards the edge that the pointer is near, and faster the nearer it is', () => {
		assert.deepStrictEqual(
			[-10, 0, 20, 40, 500, 960, 980, 1000, 1010].map(position => baseHalfCanvasAutoPanStep(position, 1000)),
			[15, 15, 7.5, 0, 0, 0, -7.5, -15, -15]
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

	test('keeps the compact Video toolbar above the card in stable screen-space geometry', () => {
		assert.deepStrictEqual([
			baseHalfCanvasVideoToolbarWidth(['importResult']),
			// Padding, Capture Frame with its chevron, Reveal, Open, and two gaps.
			baseHalfCanvasVideoToolbarWidth(['captureFrame', 'revealVideo', 'openFullPreview']),
			baseHalfCanvasVideoToolbarWidth(['importResult', 'revealVideo']),
			baseHalfCanvasVideoToolbarWidth([])
		], [112, 3 + 42 + 2 + 28 + 2 + 28 + 3, 112, 0]);

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

	test('places the Video panel in screen space below, above, or clamped, never moves the canvas, and adds its flow position', () => {
		const place = (
			card: { left: number; top: number; right: number; bottom: number },
			viewport: { x: number; y: number; zoom: number },
			canvas: { width: number; height: number },
			options: { height?: number; keepSide?: 'below' | 'above' } = {}
		) => {
			const placement = resolveBaseHalfCanvasVideoPanelPlacement({
				...card,
				viewport,
				viewportWidth: canvas.width,
				viewportHeight: canvas.height,
				height: options.height ?? 180,
				...(options.keepSide ? { keepSide: options.keepSide } : {})
			});
			return {
				placement: placement.placement,
				side: placement.side,
				visible: placement.visible,
				left: placement.left,
				top: placement.top,
				flowLeft: placement.flowLeft,
				flowTop: placement.flowTop,
				width: placement.width,
				height: placement.height
			};
		};
		const identity = { x: 0, y: 0, zoom: 1 };
		const card = { left: 100, top: 80, right: 500, bottom: 300 };
		assert.deepStrictEqual({
			below: place(card, identity, { width: 800, height: 700 }),
			// The panel keeps its screen size at any zoom; its flow position is
			// that screen position mapped back through the viewport.
			zoomedAndPanned: place(card, { x: -100, y: -80, zoom: 2 }, { width: 1000, height: 900 }),
			// No room below: above the card, its name, and its toolbar.
			aboveTheToolbar: place({ left: 100, top: 400, right: 500, bottom: 650 }, identity, { width: 800, height: 700 }),
			// Room for neither: inside the canvas, on the side with more room, and
			// 52 px above its bottom, clear of the zoom controls.
			clamped: place({ left: 100, top: 150, right: 500, bottom: 260 }, identity, { width: 800, height: 420 }),
			// A new image card at the middle of a laptop's canvas: the room above
			// counts the toolbar's place, which is empty while the card generates,
			// so Generate does not send the panel to the other side.
			clampedLaptop: place({ left: 100, top: 305, right: 400, bottom: 525 }, identity, { width: 1130, height: 831 }),
			// While the card moves, the panel keeps its side and follows it.
			following: place({ left: 100, top: 400, right: 500, bottom: 650 }, identity, { width: 800, height: 700 }, { keepSide: 'below' }),
			narrow: place({ left: 0, top: 40, right: 240, bottom: 200 }, identity, { width: 300, height: 560 }),
			offCanvas: place({ left: 100, top: 720, right: 500, bottom: 800 }, identity, { width: 800, height: 700 }).visible
		}, {
			below: { placement: 'below', side: 'below', visible: true, left: 44, top: 310, flowLeft: 44, flowTop: 310, width: 512, height: 180 },
			zoomedAndPanned: { placement: 'below', side: 'below', visible: true, left: 244, top: 530, flowLeft: 172, flowTop: 305, width: 512, height: 180 },
			aboveTheToolbar: { placement: 'above', side: 'above', visible: true, left: 44, top: 400 - 32 - 46 - 10 - 180, flowLeft: 44, flowTop: 400 - 32 - 46 - 10 - 180, width: 512, height: 180 },
			clamped: { placement: 'clamped', side: 'below', visible: true, left: 44, top: 420 - 52 - 180, flowLeft: 44, flowTop: 420 - 52 - 180, width: 512, height: 180 },
			clampedLaptop: { placement: 'clamped', side: 'below', visible: true, left: 12, top: 535, flowLeft: 12, flowTop: 535, width: 512, height: 180 },
			following: { placement: 'below', side: 'below', visible: true, left: 44, top: 660, flowLeft: 44, flowTop: 660, width: 512, height: 180 },
			narrow: { placement: 'below', side: 'below', visible: true, left: 12, top: 210, flowLeft: 12, flowTop: 210, width: 276, height: 180 },
			offCanvas: false
		});
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
		assert.strictEqual(baseHalfCanvasSceneShowsResizeControls(true, false, 1, true), false);
		assert.deepStrictEqual(baseHalfCanvasSceneVideoInputPickGesturePolicy(true), {
			nodesDraggable: false,
			nodesResizable: false,
			viewportNavigationAllowed: true
		});
		assert.deepStrictEqual(baseHalfCanvasSceneVideoInputPickGesturePolicy(false), {
			nodesDraggable: true,
			nodesResizable: true,
			viewportNavigationAllowed: true
		});
	});

	test('seeds the resizer measured box from persisted card geometry', () => {
		assert.deepStrictEqual(baseHalfCanvasSceneNodeSize({ width: 640, height: 360 }), {
			initialWidth: 640,
			initialHeight: 360,
			measured: { width: 640, height: 360 },
			style: { width: 640, height: 360 }
		});
	});

	test('anchors each corner resize target on its rounded corner arc', () => {
		const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
		assert.deepStrictEqual(Object.fromEntries(corners.map(corner => [corner, resolveBaseHalfCanvasResizeCornerGeometry(corner, 1)])), {
			'top-left': {
				style: { left: -12, top: -12, width: 34, height: 34, translate: 'none' },
				viewBox: '-34 -34 34 34',
				outerBandPath: 'M -28 0 A 28 28 0 0 1 0 -28',
				outerBandWidth: 12,
				innerBandPath: 'M -18.5 0 A 18.5 18.5 0 0 1 0 -18.5',
				innerBandWidth: 9,
				indicatorPath: 'M -26.231 -11.144 A 28.5 28.5 0 0 1 -11.144 -26.231',
				indicatorWidth: 3
			},
			'top-right': {
				style: { left: 'calc(100% - 22px)', top: -12, width: 34, height: 34, translate: 'none' },
				viewBox: '0 -34 34 34',
				outerBandPath: 'M 28 0 A 28 28 0 0 0 0 -28',
				outerBandWidth: 12,
				innerBandPath: 'M 18.5 0 A 18.5 18.5 0 0 0 0 -18.5',
				innerBandWidth: 9,
				indicatorPath: 'M 26.231 -11.144 A 28.5 28.5 0 0 0 11.144 -26.231',
				indicatorWidth: 3
			},
			'bottom-left': {
				style: { left: -12, top: 'calc(100% - 22px)', width: 34, height: 34, translate: 'none' },
				viewBox: '-34 0 34 34',
				outerBandPath: 'M -28 0 A 28 28 0 0 0 0 28',
				outerBandWidth: 12,
				innerBandPath: 'M -18.5 0 A 18.5 18.5 0 0 0 0 18.5',
				innerBandWidth: 9,
				indicatorPath: 'M -26.231 11.144 A 28.5 28.5 0 0 0 -11.144 26.231',
				indicatorWidth: 3
			},
			'bottom-right': {
				style: { left: 'calc(100% - 22px)', top: 'calc(100% - 22px)', width: 34, height: 34, translate: 'none' },
				viewBox: '0 0 34 34',
				outerBandPath: 'M 28 0 A 28 28 0 0 1 0 28',
				outerBandWidth: 12,
				innerBandPath: 'M 18.5 0 A 18.5 18.5 0 0 1 0 18.5',
				innerBandWidth: 9,
				indicatorPath: 'M 26.231 11.144 A 28.5 28.5 0 0 1 11.144 26.231',
				indicatorWidth: 3
			}
		});
		assert.deepStrictEqual(
			resolveBaseHalfCanvasResizeCornerGeometry('bottom-right', Number.NaN),
			resolveBaseHalfCanvasResizeCornerGeometry('bottom-right', 1)
		);
	});

	test('keeps corner resize bands and indicators at constant screen sizes across zoom', () => {
		const zooms = [0.2, 0.5, 1, 2, 4];
		const parseArc = (path: string) => {
			const [, startX, startY, , radius, , , , , endX, endY] = path.split(' ').map(Number);
			return { startX, startY, radius, endX, endY };
		};
		const summarize = (corner: BaseHalfCanvasResizeCorner, zoom: number) => {
			const geometry = resolveBaseHalfCanvasResizeCornerGeometry(corner, zoom);
			const screen = (value: number) => Math.round(value * zoom * 100) / 100;
			const degrees = (radians: number) => Math.round(radians * 1800 / Math.PI) / 10;
			const outer = parseArc(geometry.outerBandPath);
			const inner = parseArc(geometry.innerBandPath);
			const indicator = parseArc(geometry.indicatorPath);
			const spansSector = (arc: ReturnType<typeof parseArc>) => arc.startY === 0
				&& arc.endX === 0
				&& Math.abs(arc.startX) === arc.radius
				&& Math.abs(arc.endY) === arc.radius;
			const capReach = Math.asin(geometry.indicatorWidth / 2 / indicator.radius);
			// Band edges are measured from the card edge: negative inside, positive outside.
			return {
				outerBand: [
					screen(outer.radius - geometry.outerBandWidth / 2 - BASEHALF_CANVAS_CARD_CORNER_RADIUS),
					screen(outer.radius + geometry.outerBandWidth / 2 - BASEHALF_CANVAS_CARD_CORNER_RADIUS)
				],
				innerBand: [
					screen(inner.radius - geometry.innerBandWidth / 2 - BASEHALF_CANVAS_CARD_CORNER_RADIUS),
					screen(inner.radius + geometry.innerBandWidth / 2 - BASEHALF_CANVAS_CARD_CORNER_RADIUS)
				],
				bandsSpanSector: spansSector(outer) && spansSector(inner),
				indicatorGap: screen(indicator.radius - geometry.indicatorWidth / 2 - BASEHALF_CANVAS_CARD_CORNER_RADIUS),
				indicatorStroke: screen(geometry.indicatorWidth),
				indicatorSpan: [
					degrees(Math.atan2(Math.abs(indicator.startY), Math.abs(indicator.startX)) - capReach),
					degrees(Math.atan2(Math.abs(indicator.endY), Math.abs(indicator.endX)) + capReach)
				]
			};
		};
		const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
		assert.deepStrictEqual(
			zooms.flatMap(zoom => corners.map(corner => ({ zoom, corner, ...summarize(corner, zoom) }))),
			zooms.flatMap(zoom => corners.map(corner => ({
				zoom,
				corner,
				outerBand: [0, 12],
				// Below a screen radius of 8 the strip stops at the arc's center.
				innerBand: [-Math.min(8, Math.round(BASEHALF_CANVAS_CARD_CORNER_RADIUS * zoom * 100) / 100), 1],
				bandsSpanSector: true,
				indicatorGap: 5,
				indicatorStroke: 3,
				indicatorSpan: [20, 70]
			})))
		);
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

	test('a double click renames from a name that can be changed in place, and otherwise edits or opens', () => {
		const onName = { onRenamableName: true, modifier: false, note: true, onNoteBody: false };
		const offName = { ...onName, onRenamableName: false };
		assert.deepStrictEqual({
			noteName: baseHalfCanvasCardDoubleClickAction(onName),
			folderName: baseHalfCanvasCardDoubleClickAction({ ...onName, note: false }),
			noteNameWithModifier: baseHalfCanvasCardDoubleClickAction({ ...onName, modifier: true }),
			folderNameWithModifier: baseHalfCanvasCardDoubleClickAction({ ...onName, note: false, modifier: true }),
			noteCaption: baseHalfCanvasCardDoubleClickAction(offName),
			noteBody: baseHalfCanvasCardDoubleClickAction({ ...offName, onNoteBody: true }),
			folderCaption: baseHalfCanvasCardDoubleClickAction({ ...offName, note: false }),
			folderBody: baseHalfCanvasCardDoubleClickAction({ ...offName, note: false, onNoteBody: true })
		}, {
			noteName: 'rename',
			folderName: 'rename',
			noteNameWithModifier: undefined,
			folderNameWithModifier: 'open',
			noteCaption: undefined,
			noteBody: 'editNote',
			folderCaption: 'open',
			folderBody: 'open'
		});
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
