/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Connections that are drawn: following a dragged card, reconnecting either half, and deleting.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { AGENT_CREATED_CARD_CONTENT, AGENT_CREATED_CARD_PATH } from './agents.mts';
import { agentNoteWithUpstream } from './badges.mts';
import {
	assertCanvasCardHasRoundedCornerResizeTargets,
	assertCanvasCardPaintEqual,
	assertCanvasCardResizeChromeIsNeutral,
	canvasCardCornerBandPoint,
	captureCanvasCardComputedChrome,
	waitForCanvasCardCornerIndicators
} from './cardChrome.mts';
import { frameCanvasCardsForConnection } from './connections.mts';
import { assertAdjacentChromeMotionContract, assertAdjacentChromeSurfaceState, captureAdjacentChromeSurface, waitForAdjacentChromeAnimations } from './selectionChrome.mts';
import { workspacePath } from '../../context.mts';
import { assertCanvasEdgeGone, assertCanvasEdgeVisible } from '../../lib/canvas.mts';
import { visibleQuickInput } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { readWorkspaceFile } from '../../lib/workspace.mts';

// The original regression: while the pointer is still down, React Flow's
// controlled node and custom edge must consume the same live geometry. Disk
// persistence intentionally happens only after pointer-up.
export async function assertCanvasEdgeFollowsCardDragLive(page) {
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const docsNode = page.locator('.react-flow__node', { has: docs });
	await docs.click();
	const docsToolbar = page.locator('.basehalf-canvas-selection-toolbar.basehalf-canvas-adjacent-chrome');
	await docsToolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => {
		const toolbar = document.querySelector('.basehalf-canvas-selection-toolbar.basehalf-canvas-adjacent-chrome');
		return toolbar instanceof HTMLElement
			&& toolbar.dataset.chromeState === 'present'
			&& getComputedStyle(toolbar).visibility === 'visible'
			&& Math.abs(Number.parseFloat(getComputedStyle(toolbar).opacity || '1') - 1) <= 0.001;
	}, null, { timeout: 10_000 });
	await waitForAdjacentChromeAnimations(page);
	const docsToolbarIdentity = `docs-toolbar-${Date.now()}-${Math.random()}`;
	await docsToolbar.evaluate((toolbar, identity) => toolbar.dataset.smokeAdjacentChromeIdentity = identity, docsToolbarIdentity);
	const docsToolbarBefore = await captureAdjacentChromeSurface(docsToolbar);
	assertAdjacentChromeSurfaceState(docsToolbarBefore, 'present', 'for the selected docs card before drag');
	if (docsToolbarBefore.identity !== docsToolbarIdentity) {
		throw new Error(`Selected docs toolbar identity was not established before drag: ${JSON.stringify(docsToolbarBefore)}`);
	}
	await assertAdjacentChromeMotionContract(page, docsToolbar, 'for generic selected-card actions');
	await docsNode.locator(':scope > .basehalf-canvas-node-resizer-handle.bottom.right').waitFor({ state: 'visible', timeout: 10_000 });
	const activeBeforeDrag = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(activeBeforeDrag, 'selected docs card before drag');
	assertCanvasCardHasRoundedCornerResizeTargets(activeBeforeDrag, 'selected docs card before drag');
	if (!activeBeforeDrag.cardSelected
		|| !activeBeforeDrag.nodeSelected
		|| activeBeforeDrag.visibleResizeHandles !== 4
		|| activeBeforeDrag.interactiveResizeHandles !== 4) {
		throw new Error(`Selected docs card did not expose four corner resize hit targets before drag: ${JSON.stringify(activeBeforeDrag)}`);
	}
	const canvasBefore = fs.readFileSync(canvasPath, 'utf8');
	// The docs → note connection made by the connect step.
	const connectedEdgeId = `docs${String.fromCharCode(0)}${AGENT_CREATED_CARD_PATH}`;
	const before = await page.evaluate(edgeId => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		if (!(card instanceof HTMLElement) || !(node instanceof HTMLElement) || !(edge instanceof SVGPathElement)) {
			return undefined;
		}
		const rect = card.getBoundingClientRect();
		return {
			startX: rect.left + rect.width / 2,
			startY: rect.top + rect.height / 2,
			edgePath: edge.getAttribute('d'),
			nodeTransform: getComputedStyle(node).transform
		};
	}, connectedEdgeId);
	if (!before?.edgePath) {
		throw new Error('Missing docs→note live edge geometry');
	}
	await page.evaluate(() => {
		const cards = document.querySelector('.basehalf-canvas-cards');
		if (!(cards instanceof HTMLElement)) {
			throw new Error('Missing canvas cards host before drag preview stability check');
		}
		cards.dataset.smokeLoadingPreviewObserved = String(cards.textContent?.includes('Loading preview…') === true);
		cards.dataset.smokeCardElementReplaced = 'false';
		cards.dataset.smokeReplacedCardPaths = '';
		const originalCards = new Map(Array.from(cards.querySelectorAll('.basehalf-canvas-card')).flatMap(card => {
			const path = card instanceof HTMLElement ? card.dataset.basehalfCardPath : undefined;
			return path ? [[path, card] as const] : [];
		}));
		const observer = new MutationObserver(() => {
			if (cards.textContent?.includes('Loading preview…')) {
				cards.dataset.smokeLoadingPreviewObserved = 'true';
			}
			for (const [path, original] of originalCards) {
				if (cards.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`) !== original) {
					cards.dataset.smokeCardElementReplaced = 'true';
					const replaced = new Set(cards.dataset.smokeReplacedCardPaths?.split('\n').filter(Boolean));
					replaced.add(path);
					cards.dataset.smokeReplacedCardPaths = [...replaced].join('\n');
				}
			}
		});
		observer.observe(cards, { childList: true, characterData: true, subtree: true });
	});

	await page.mouse.move(before.startX, before.startY);
	await page.mouse.down();
	await page.mouse.move(before.startX + 64, before.startY + 37, { steps: 10 });
	await page.waitForFunction(({ edgeId, edgePath, nodeTransform }) => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return node instanceof HTMLElement
			&& edge instanceof SVGPathElement
			&& getComputedStyle(node).transform !== nodeTransform
			&& edge.getAttribute('d') !== edgePath;
	}, { edgeId: connectedEdgeId, edgePath: before.edgePath, nodeTransform: before.nodeTransform }, { timeout: 10_000 });

	const endpointDistance = await page.evaluate(edgeId => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const handle = node?.querySelector(':scope > .basehalf-canvas-card-connect-handle.east');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		if (!(handle instanceof HTMLElement) || !(edge instanceof SVGPathElement)) {
			return Number.POSITIVE_INFINITY;
		}
		const point = edge.getPointAtLength(0);
		const ctm = edge.getScreenCTM();
		if (!ctm) {
			return Number.POSITIVE_INFINITY;
		}
		const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
		const handleRect = handle.getBoundingClientRect();
		return Math.hypot(screen.x - (handleRect.left + handleRect.width / 2), screen.y - (handleRect.top + handleRect.height / 2));
	}, connectedEdgeId);
	if (endpointDistance > 3) {
		throw new Error(`Live edge endpoint drifted ${endpointDistance}px from the dragged card handle`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBefore) {
		throw new Error('Canvas geometry persisted before the drag gesture completed');
	}
	// Let the selection transition that starts on pointer-down finish. The
	// release regression is a different transition: the old drag-only shadow
	// changed its target abruptly when React Flow removed `.dragging`.
	await page.waitForTimeout(180);
	await waitForAdjacentChromeAnimations(page);
	const dragChrome = await captureCanvasCardComputedChrome(docs);
	const dragToolbarChrome = await captureAdjacentChromeSurface(docsToolbar);
	assertCanvasCardResizeChromeIsNeutral(dragChrome, 'active docs card drag');
	assertCanvasCardPaintEqual(activeBeforeDrag.cardPaint, dragChrome.cardPaint, 'selected-to-drag transition');
	assertAdjacentChromeSurfaceState(dragToolbarChrome, 'suppressed', 'for the selected docs card during pointer-held drag');
	const dragPhase = await page.locator('.basehalf-canvas-cards').getAttribute('data-node-drag-chrome');
	if (!dragChrome.nodeDragging
		|| dragToolbarChrome.identity !== docsToolbarIdentity
		|| dragPhase !== 'dragging') {
		throw new Error(`Selected docs drag did not suppress the same generic toolbar: ${JSON.stringify({ dragChrome, dragToolbarChrome, dragPhase })}`);
	}

	await page.mouse.up();
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8') !== canvasBefore, 'dragged docs geometry to persist after pointer-up');
	await page.waitForTimeout(350);
	await waitForAdjacentChromeAnimations(page);
	const settledDragChrome = await captureCanvasCardComputedChrome(docs);
	const settledToolbarChrome = await captureAdjacentChromeSurface(docsToolbar);
	assertCanvasCardResizeChromeIsNeutral(settledDragChrome, 'selected docs card after drag');
	assertCanvasCardPaintEqual(activeBeforeDrag.cardPaint, settledDragChrome.cardPaint, 'drag pointer-up transition');
	assertAdjacentChromeSurfaceState(settledToolbarChrome, 'present', 'for the selected docs card after drag');
	const settledPhase = await page.locator('.basehalf-canvas-cards').getAttribute('data-node-drag-chrome');
	if (settledDragChrome.nodeDragging
		|| !settledDragChrome.cardSelected
		|| !settledDragChrome.nodeSelected
		|| settledToolbarChrome.identity !== docsToolbarIdentity
		|| settledPhase !== null) {
		throw new Error(`Docs card did not restore the same selected toolbar after drag: ${JSON.stringify({ settledDragChrome, settledToolbarChrome, settledPhase })}`);
	}
	if (await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-loading-preview-observed') === 'true') {
		throw new Error('Dragging a card replaced hydrated content with the Loading preview placeholder');
	}
	if (await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-card-element-replaced') === 'true') {
		const paths = await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-replaced-card-paths');
		throw new Error(`Dragging a card rebuilt card DOM instead of reconciling layout in place: ${paths}`);
	}

	const resizeBeforeBox = await docs.boundingBox();
	if (!resizeBeforeBox) {
		throw new Error('Could not measure the selected docs card before resize');
	}
	const resizeCanvasBefore = fs.readFileSync(canvasPath, 'utf8');
	const resizeBeforeChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(resizeBeforeChrome, 'selected docs card before resize');
	assertCanvasCardPaintEqual(activeBeforeDrag.cardPaint, resizeBeforeChrome.cardPaint, 'drag-to-resize resting transition');
	const resizeStart = await canvasCardCornerBandPoint(docs, 'bottom-right');
	await page.mouse.move(1, 1);
	await waitForCanvasCardCornerIndicators(page, 'docs', [], 'with the pointer away from the selected docs card');
	await page.mouse.move(resizeStart.x, resizeStart.y);
	await waitForCanvasCardCornerIndicators(page, 'docs', ['bottom-right'], 'while hovering the docs card bottom-right band');
	await docs.evaluate(card => {
		const scope = window as typeof window & { __basehalfSmokeNoMoveResizeObserver?: MutationObserver };
		scope.__basehalfSmokeNoMoveResizeObserver?.disconnect();
		card.dataset.smokeNoMoveResizeObserved = String(card.dataset.cardResizing === 'true');
		const observer = new MutationObserver(records => {
			if (card.dataset.cardResizing === 'true' || records.some(record => record.oldValue === 'true')) {
				card.dataset.smokeNoMoveResizeObserved = 'true';
			}
		});
		observer.observe(card, { attributes: true, attributeFilter: ['data-card-resizing'], attributeOldValue: true });
		scope.__basehalfSmokeNoMoveResizeObserver = observer;
	});
	await page.mouse.move(resizeStart.x, resizeStart.y);
	await page.mouse.down();
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const noMovePointerDownState = await docs.evaluate(card => ({
		cardResizing: card.dataset.cardResizing === 'true',
		observedResizeSession: card.dataset.smokeNoMoveResizeObserved === 'true'
	}));
	await page.mouse.up();
	await page.mouse.move(1, 1);
	await page.waitForTimeout(150);
	const noMoveFinalState = await docs.evaluate(card => {
		const scope = window as typeof window & { __basehalfSmokeNoMoveResizeObserver?: MutationObserver };
		const state = {
			cardResizing: card.dataset.cardResizing === 'true',
			observedResizeSession: card.dataset.smokeNoMoveResizeObserved === 'true'
		};
		scope.__basehalfSmokeNoMoveResizeObserver?.disconnect();
		delete scope.__basehalfSmokeNoMoveResizeObserver;
		delete card.dataset.smokeNoMoveResizeObserved;
		return state;
	});
	const noMoveAfterChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(noMoveAfterChrome, 'selected docs card after resize-handle click');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, noMoveAfterChrome.cardPaint, 'resize-handle click transition');
	const lingeringConnectionHandles = noMoveAfterChrome.connectionHandles.filter(handle => /(?:^|\s)(?:connectingfrom|connectingto|clickconnecting|connection-target)(?:\s|$)/.test(handle.className ?? ''));
	if (noMovePointerDownState.cardResizing
		|| noMovePointerDownState.observedResizeSession
		|| noMoveFinalState.cardResizing
		|| noMoveFinalState.observedResizeSession
		|| noMoveAfterChrome.cardResizing
		|| noMoveAfterChrome.nodeResizing
		|| noMoveAfterChrome.liveConnectionHandles !== 0
		|| lingeringConnectionHandles.length !== 0) {
		throw new Error(`A no-move resize-handle click left active resize or connection chrome: ${JSON.stringify({ noMovePointerDownState, noMoveFinalState, lingeringConnectionHandles, noMoveAfterChrome })}`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== resizeCanvasBefore) {
		throw new Error('A no-move resize-handle click changed Canvas geometry on disk');
	}
	await page.mouse.move(resizeStart.x, resizeStart.y);
	await page.mouse.down();
	await page.mouse.move(resizeStart.x + 48, resizeStart.y + 36, { steps: 10 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') === 'true', null, { timeout: 10_000 });
	await waitForCanvasCardCornerIndicators(page, 'docs', ['bottom-right'], 'while resizing the docs card from its bottom-right band');
	const resizeDuringChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(resizeDuringChrome, 'active docs card resize');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, resizeDuringChrome.cardPaint, 'resize pointer-down transition');
	if (!resizeDuringChrome.nodeResizing) {
		throw new Error(`Missing actively resized docs card before pointer-up chrome check: ${JSON.stringify(resizeDuringChrome)}`);
	}
	const resizeDuringBox = await docs.boundingBox();
	if (!resizeDuringBox
		|| resizeDuringBox.width < resizeBeforeBox.width + 24
		|| resizeDuringBox.height < resizeBeforeBox.height + 18) {
		throw new Error(`Dragging the resize handle did not change card dimensions live: ${JSON.stringify({ resizeBeforeBox, resizeDuringBox })}`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== resizeCanvasBefore) {
		throw new Error('Canvas geometry persisted before the resize gesture completed');
	}
	await page.mouse.up();
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8') !== resizeCanvasBefore, 'resized docs geometry to persist after pointer-up');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') !== 'true', null, { timeout: 10_000 });
	await page.waitForTimeout(350);
	const resizeAfterChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(resizeAfterChrome, 'selected docs card after resize hover');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, resizeAfterChrome.cardPaint, 'resize pointer-up transition');
	const resizeAfterBox = await docs.boundingBox();
	if (!resizeAfterBox
		|| resizeAfterBox.width < resizeBeforeBox.width + 24
		|| resizeAfterBox.height < resizeBeforeBox.height + 18) {
		throw new Error(`Resized docs card did not retain its new dimensions: ${JSON.stringify({ resizeBeforeBox, resizeAfterBox })}`);
	}
	await page.mouse.move(1, 1);
	await waitForCanvasCardCornerIndicators(page, 'docs', [], 'after the docs card resize settled and the pointer left its band');

	const restoreCanvasBefore = fs.readFileSync(canvasPath, 'utf8');
	const restoreStart = await canvasCardCornerBandPoint(docs, 'bottom-right');
	const restoreTarget = {
		x: restoreStart.x + resizeBeforeBox.width - resizeAfterBox.width,
		y: restoreStart.y + resizeBeforeBox.height - resizeAfterBox.height
	};
	// A selected card usually holds keyboard focus. The press moves focus off
	// it, and that element blur must not settle the resize session.
	const docsFocused = await docs.evaluate(card => {
		card.focus({ preventScroll: true });
		return card.ownerDocument.activeElement === card;
	});
	if (!docsFocused) {
		throw new Error('Could not focus the docs card before its fixture-size restore');
	}
	await page.mouse.move(restoreStart.x, restoreStart.y);
	await page.mouse.down();
	await page.mouse.move(restoreTarget.x, restoreTarget.y, { steps: 10 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') === 'true', null, { timeout: 10_000 });
	const restoreDuringChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(restoreDuringChrome, 'active docs card fixture-size restore');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, restoreDuringChrome.cardPaint, 'fixture-size restore pointer-down transition');
	const restoreDuringBox = await docs.boundingBox();
	if (!restoreDuringBox
		|| Math.abs(restoreDuringBox.width - resizeBeforeBox.width) > 2
		|| Math.abs(restoreDuringBox.height - resizeBeforeBox.height) > 2) {
		throw new Error(`Reverse resize did not restore the docs card fixture size live: ${JSON.stringify({ resizeBeforeBox, restoreDuringBox })}`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== restoreCanvasBefore) {
		throw new Error('Restored Canvas geometry persisted before the resize gesture completed');
	}
	// Past the minimum size the card stops following the pointer, so the pointer
	// leaves the corner band. The corner the gesture started from keeps its
	// indicator until the gesture settles. Returning restores the fixture size,
	// because the resizer measures from the gesture's start.
	const excursion = { x: restoreTarget.x - restoreDuringBox.width, y: restoreTarget.y - restoreDuringBox.height };
	await page.mouse.move(excursion.x, excursion.y, { steps: 8 });
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		return card instanceof HTMLElement && card.offsetWidth <= 141 && card.offsetHeight <= 49;
	}, null, { timeout: 10_000 });
	const excursionInBand = await docs.evaluate((element, pointer) => {
		const rect = element.getBoundingClientRect();
		const zoom = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
		const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) * zoom;
		const centerX = rect.right - radius;
		const centerY = rect.bottom - radius;
		return pointer.x >= centerX && pointer.y >= centerY && Math.hypot(pointer.x - centerX, pointer.y - centerY) <= radius + 12;
	}, excursion);
	if (excursionInBand) {
		throw new Error(`The minimum-size excursion left the pointer on the bottom-right band: ${JSON.stringify(excursion)}`);
	}
	await waitForCanvasCardCornerIndicators(page, 'docs', ['bottom-right'], 'after the pointer left the band mid-resize');
	await page.mouse.move(restoreTarget.x, restoreTarget.y, { steps: 8 });
	await page.waitForFunction(({ width, height }) => {
		const rect = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getBoundingClientRect();
		return !!rect && Math.abs(rect.width - width) <= 2 && Math.abs(rect.height - height) <= 2;
	}, { width: resizeBeforeBox.width, height: resizeBeforeBox.height }, { timeout: 10_000 });
	await page.mouse.up();
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8') !== restoreCanvasBefore, 'restored docs geometry to persist after pointer-up');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') !== 'true', null, { timeout: 10_000 });
	await page.waitForTimeout(350);
	const restoreAfterChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(restoreAfterChrome, 'selected docs card after fixture-size restore hover');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, restoreAfterChrome.cardPaint, 'fixture-size restore pointer-up transition');
	const restoredBox = await docs.boundingBox();
	if (!restoredBox
		|| Math.abs(restoredBox.width - resizeBeforeBox.width) > 2
		|| Math.abs(restoredBox.height - resizeBeforeBox.height) > 2) {
		throw new Error(`Docs card did not retain its restored fixture size: ${JSON.stringify({ resizeBeforeBox, restoredBox })}`);
	}
}

// A reference line is itself the reconnect affordance: its first directed
// half owns the source endpoint and its second half owns the target endpoint.
// Each preview must keep the opposite endpoint pinned. The target reconnect is
// then committed through the real semantic graph and canvas style mirrors.
// Both ends of a connection reconnect by dragging one half of its edge. The
// source end replaces the entry in the note's `upstream` list in place; the
// target end moves the entry to another card's store, here the src folder's
// .bh/mirror/src/upstream.yaml. Escape, a blank release, and a release on the
// excluded opposite card cancel without writing.
export async function assertCanvasEdgeHalfReconnect(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const connected = agentNoteWithUpstream(['docs']);
	const connectedEdgeId = `docs${String.fromCharCode(0)}${note}`;
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const src = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	await frameCanvasCardsForConnection(page, [docs, src, readme, noteCard]);
	if (readWorkspaceFile(note) !== connected) {
		throw new Error(`${note} must hold the docs connection before reconnecting`);
	}
	const handle = (card, side) => page.locator('.react-flow__node', { has: card }).locator(`:scope > .basehalf-canvas-card-connect-handle.${side}`);
	const srcUpstreamPath = path.join(workspacePath, '.bh', 'mirror', 'src', 'upstream.yaml');

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const canvasBeforeEscape = fs.readFileSync(canvasPath, 'utf8');
	const beforeSource = await canvasEdgeGestureGeometry(page, 'docs', note);
	const sourceBlank = await canvasReconnectBlankPoint(page, beforeSource.firstHalf);
	await page.mouse.move(beforeSource.firstHalf.x, beforeSource.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(sourceBlank.x, sourceBlank.y, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, connectedEdgeId, { timeout: 10_000 });
	const sourcePreview = await canvasEdgeGestureGeometry(page, 'docs', note, { exposed: false });
	if (pointDistance(sourcePreview.source, beforeSource.source) < 8) {
		throw new Error('First-half drag did not move the source endpoint preview');
	}
	if (pointDistance(sourcePreview.target, beforeSource.target) > 3) {
		throw new Error('First-half drag moved the opposite target endpoint');
	}
	const stableGrabbingCursor = await page.evaluate(() => document.body.classList.contains('basehalf-canvas-edge-reconnecting'));
	if (!stableGrabbingCursor) {
		throw new Error('Edge reconnect lost its document-level grabbing cursor');
	}

	// Escape is a pure cancellation: the gesture lock and preview disappear,
	// and the subsequent physical pointer-up has no semantic effect.
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await assertCanvasEdgeVisible(page, 'docs', note);
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === undefined;
	}, connectedEdgeId, { timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeEscape || readWorkspaceFile(note) !== connected) {
		throw new Error('Escape committed an edge reconnect instead of cancelling it');
	}

	// A no-drag click selects only. Reference edges have no relationship-label
	// DOM at all, and their sole keyboard/screen-reader affordance is React
	// Flow's focusable edge wrapper.
	const clickGeometry = await canvasEdgeGestureGeometry(page, 'docs', note);
	await page.mouse.click(clickGeometry.firstHalf.x, clickGeometry.firstHalf.y);
	await page.waitForFunction(edgeId => Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit.selected'))
		.some(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId), connectedEdgeId, { timeout: 10_000 });
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('A single reference-edge click opened Quick Input');
	}
	const edgeAccessibility = await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		return wrapper instanceof SVGElement ? {
			labelElementCount: document.querySelectorAll('.basehalf-canvas-flow-edge-label').length,
			tabIndex: wrapper.tabIndex,
			role: wrapper.getAttribute('role'),
			roleDescription: wrapper.getAttribute('aria-roledescription'),
			ariaLabel: wrapper.getAttribute('aria-label')
		} : undefined;
	}, connectedEdgeId);
	if (!edgeAccessibility || edgeAccessibility.labelElementCount !== 0) {
		throw new Error('A reference edge rendered a relationship-label element');
	}
	if (edgeAccessibility.tabIndex !== 0 || edgeAccessibility.role !== 'group' || edgeAccessibility.roleDescription !== 'edge') {
		throw new Error('The reference edge wrapper is not the sole keyboard-accessible edge target');
	}
	if (!edgeAccessibility.ariaLabel
		|| !/^Context flows from /i.test(edgeAccessibility.ariaLabel)
		|| !edgeAccessibility.ariaLabel.includes('docs')
		|| !edgeAccessibility.ariaLabel.includes(note)
		|| /label|note|why/i.test(edgeAccessibility.ariaLabel)) {
		throw new Error(`Reference edge has the wrong accessible name: ${edgeAccessibility.ariaLabel ?? '<missing>'}`);
	}

	// Double-click is deliberately inert after the clean break: it must neither
	// revive Reference note Quick Input nor mutate the endpoint-and-anchor canvas row.
	const canvasBeforeDoubleClick = fs.readFileSync(canvasPath, 'utf8');
	await page.mouse.dblclick(clickGeometry.firstHalf.x, clickGeometry.firstHalf.y, { delay: 40 });
	await page.waitForTimeout(250);
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('Double-clicking a reference edge opened Quick Input');
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeDoubleClick) {
		throw new Error('Double-clicking a reference edge changed canvas.yaml');
	}

	// The wrapper supports the stock React Flow keyboard selection contract.
	// First clear the mouse selection with Escape, then select it with Enter;
	// neither action has a label-editing side effect.
	await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement) || wrapper.tabIndex !== 0) {
			throw new Error('Missing keyboard-focusable reference edge wrapper');
		}
		wrapper.focus();
	}, connectedEdgeId);
	await page.keyboard.press('Escape');
	await page.waitForFunction(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return hit?.closest('.react-flow__edge')?.classList.contains('selected') === false;
	}, connectedEdgeId, { timeout: 10_000 });
	await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement)) {
			throw new Error('Missing reference edge wrapper for keyboard selection');
		}
		wrapper.focus();
	}, connectedEdgeId);
	await page.keyboard.press('Enter');
	await page.waitForFunction(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		return wrapper instanceof SVGElement
			&& document.activeElement === wrapper
			&& wrapper.classList.contains('selected');
	}, connectedEdgeId, { timeout: 10_000 });
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('Keyboard-selecting a reference edge opened Quick Input');
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeDoubleClick) {
		throw new Error('Keyboard-selecting a reference edge changed canvas.yaml');
	}

	// Releasing the source endpoint on its excluded opposite card is invalid,
	// not blank. It cancels and preserves the semantic edge.
	const invalidGeometry = await canvasEdgeGestureGeometry(page, 'docs', note);
	const oppositeBounds = await noteCard.boundingBox();
	if (!oppositeBounds) {
		throw new Error('Missing note card bounds for invalid reconnect smoke');
	}
	const canvasBeforeInvalidCard = fs.readFileSync(canvasPath, 'utf8');
	await page.mouse.move(invalidGeometry.firstHalf.x, invalidGeometry.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(oppositeBounds.x + oppositeBounds.width / 2, oppositeBounds.y + oppositeBounds.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, connectedEdgeId, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeVisible(page, 'docs', note);
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === undefined;
	}, connectedEdgeId, { timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeInvalidCard || readWorkspaceFile(note) !== connected) {
		throw new Error('Releasing on the excluded opposite card deleted or reconnected the edge');
	}

	// Source end: dropping it on README replaces the note's entry in place. Only
	// the note is written; README keeps its bytes.
	const readmeBefore = readWorkspaceFile('README.md');
	const sourceReconnectTarget = await handle(readme, 'east').boundingBox();
	if (!sourceReconnectTarget) {
		throw new Error('Missing README east handle for the source-end reconnect');
	}
	const beforeSourceReconnect = await canvasEdgeGestureGeometry(page, 'docs', note);
	await page.mouse.move(beforeSourceReconnect.firstHalf.x, beforeSourceReconnect.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(sourceReconnectTarget.x + sourceReconnectTarget.width / 2, sourceReconnectTarget.y + sourceReconnectTarget.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, connectedEdgeId, { timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.classList.contains('connection-target') === true, null, { timeout: 10_000 });
	await page.mouse.up();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['README.md']), 'the source-end reconnect to replace the note\'s upstream entry in place');
	await assertCanvasEdgeGone(page, 'docs', note);
	await assertCanvasEdgeVisible(page, 'README.md', note);
	if (readWorkspaceFile('README.md') !== readmeBefore) {
		throw new Error('A source-end reconnect changed the new upstream card instead of only the note');
	}

	// Restore the docs source with the same real first-half gesture.
	const restoreSourceTarget = await handle(docs, 'east').boundingBox();
	if (!restoreSourceTarget) {
		throw new Error('Missing docs east handle while restoring the source-end reconnect');
	}
	const beforeSourceRestore = await canvasEdgeGestureGeometry(page, 'README.md', note);
	await page.mouse.move(beforeSourceRestore.firstHalf.x, beforeSourceRestore.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(restoreSourceTarget.x + restoreSourceTarget.width / 2, restoreSourceTarget.y + restoreSourceTarget.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, `README.md${String.fromCharCode(0)}${note}`, { timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.classList.contains('connection-target') === true, null, { timeout: 10_000 });
	await page.mouse.up();
	await waitUntil(() => readWorkspaceFile(note) === connected, 'the restored source-end reconnect to name docs again');
	await assertCanvasEdgeGone(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);

	// Target end: the preview moves only the target endpoint, and dropping it on
	// the src folder moves the entry into src's sidecar store.
	const reconnectTarget = await handle(src, 'west').boundingBox();
	if (!reconnectTarget) {
		throw new Error('Missing src west handle for the target-end reconnect');
	}
	const beforeTarget = await canvasEdgeGestureGeometry(page, 'docs', note);
	const targetBlank = await canvasReconnectBlankPoint(page, beforeTarget.secondHalf);
	await page.mouse.move(beforeTarget.secondHalf.x, beforeTarget.secondHalf.y);
	await page.mouse.down();
	await page.mouse.move(targetBlank.x, targetBlank.y, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'target';
	}, connectedEdgeId, { timeout: 10_000 });
	const targetPreview = await canvasEdgeGestureGeometry(page, 'docs', note, { exposed: false });
	if (pointDistance(targetPreview.source, beforeTarget.source) > 3) {
		throw new Error('Second-half drag moved the opposite source endpoint');
	}
	if (pointDistance(targetPreview.target, beforeTarget.target) < 8) {
		throw new Error('Second-half drag did not move the target endpoint preview');
	}
	if (sourcePreview.path === targetPreview.path) {
		throw new Error('The two directed edge halves produced indistinguishable previews');
	}

	await page.mouse.move(reconnectTarget.x + reconnectTarget.width / 2, reconnectTarget.y + reconnectTarget.height / 2, { steps: 8 });
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="src"]');
		const node = card?.closest('.react-flow__node');
		return card?.classList.contains('connection-target')
			&& card.classList.contains('west')
			&& node?.querySelector(':scope > .basehalf-canvas-card-connect-handle.west')?.classList.contains('connection-target');
	}, null, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeGone(page, 'docs', note);
	await assertCanvasEdgeVisible(page, 'docs', 'src');
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"')
			&& canvas.includes('to: "src"')
			&& canvas.includes('to_anchor: west');
	}, 'target-half reconnect anchors to persist in canvas.yaml');
	await waitUntil(() => fs.existsSync(srcUpstreamPath) && fs.readFileSync(srcUpstreamPath, 'utf8') === 'upstream:\n  - docs\n', 'the target-end reconnect to add docs to the src folder\'s upstream.yaml');
	await waitUntil(() => readWorkspaceFile(note) === AGENT_CREATED_CARD_CONTENT, 'the target-end reconnect to remove the entry, and its emptied frontmatter, from the note');

	// Restore the note as the target with the same real second-half gesture.
	const restoreTarget = await handle(noteCard, 'west').boundingBox();
	if (!restoreTarget) {
		throw new Error('Missing note west handle while restoring the reconnect fixture');
	}
	const beforeRestore = await canvasEdgeGestureGeometry(page, 'docs', 'src');
	await page.mouse.move(beforeRestore.secondHalf.x, beforeRestore.secondHalf.y);
	await page.mouse.down();
	await page.mouse.move(restoreTarget.x + restoreTarget.width / 2, restoreTarget.y + restoreTarget.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'target';
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeGone(page, 'docs', 'src');
	await assertCanvasEdgeVisible(page, 'docs', note);
	await waitUntil(() => readWorkspaceFile(note) === connected, 'the restored target-end reconnect to write the note\'s upstream list again');
	await waitUntil(() => !fs.existsSync(srcUpstreamPath), 'the emptied src upstream.yaml to be removed');
}

// Canvas connection handles, dragging an end of a connection: either half let
// go on empty canvas removes the connection at once and opens no menu, and one
// undo brings the entry back.
export async function assertCanvasEdgeLetGoOnEmptyCanvas(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const connected = agentNoteWithUpstream(['docs']);
	const connectedEdgeId = `docs${String.fromCharCode(0)}${note}`;
	const card = cardPath => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
	await frameCanvasCardsForConnection(page, [card('docs'), card('src'), card('README.md'), card(note)]);
	if (readWorkspaceFile(note) !== connected) {
		throw new Error(`${note} must hold the docs connection before its line is let go on empty canvas`);
	}
	const undoKey = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
	for (const [half, end] of [['secondHalf', 'target'], ['firstHalf', 'source']]) {
		const geometry = await canvasEdgeGestureGeometry(page, 'docs', note);
		const blank = await canvasReconnectBlankPoint(page, geometry[half]);
		const atBlank = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane') ?? false, blank);
		if (!atBlank) {
			throw new Error(`The point where the ${end} end is let go must be empty canvas: ${JSON.stringify(blank)}`);
		}
		await page.mouse.move(geometry[half].x, geometry[half].y);
		await page.mouse.down();
		await page.mouse.move(blank.x, blank.y, { steps: 8 });
		await page.waitForFunction(([edgeId, expected]) => {
			const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
				.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
			return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === expected;
		}, [connectedEdgeId, end], { timeout: 10_000 });
		await page.mouse.up();
		await assertCanvasEdgeGone(page, 'docs', note);
		await waitUntil(() => readWorkspaceFile(note) === AGENT_CREATED_CARD_CONTENT, `the ${end} end let go on empty canvas to remove docs from the note's list`);
		if (await page.locator('.context-view.monaco-menu-container').isVisible().catch(() => false)) {
			throw new Error(`Letting go of the ${end} end on empty canvas opened a menu`);
		}
		await page.keyboard.press(undoKey);
		await waitUntil(() => readWorkspaceFile(note) === connected, `one undo to bring back the connection whose ${end} end was let go`);
		await assertCanvasEdgeVisible(page, 'docs', note);
	}
}

// The screen geometry of the `from`→`to` edge. `firstHalf` and `secondHalf`
// are where a gesture grabs the source or the target end. Edges render beneath
// cards, so an edge between two cards that are not neighbours can pass under a
// third card; each half point is therefore the exposed point of that half
// nearest its quarter mark, where the edge's own hit path is the topmost
// element. Pass `exposed: false` to read only the path and its endpoints, for
// example during a drag preview.
async function canvasEdgeGestureGeometry(page, from, to, { exposed = true } = {}) {
	const geometry = await page.evaluate(([source, target]) => {
		const edgeId = `${source}${String.fromCharCode(0)}${target}`;
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		if (!(edge instanceof SVGPathElement)) {
			return undefined;
		}
		const ctm = edge.getScreenCTM();
		const total = edge.getTotalLength();
		if (!ctm || total <= 0) {
			return undefined;
		}
		const screenPoint = ratio => {
			const point = edge.getPointAtLength(total * ratio);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
			return { x: screen.x, y: screen.y };
		};
		const exposedPoint = (preferred, low, high) => {
			for (let offset = 0; offset <= 0.25; offset += 0.01) {
				for (const ratio of offset === 0 ? [preferred] : [preferred - offset, preferred + offset]) {
					if (ratio < low || ratio > high) {
						continue;
					}
					const point = screenPoint(ratio);
					if (hit && document.elementFromPoint(point.x, point.y) === hit) {
						return point;
					}
				}
			}
			return undefined;
		};
		return {
			path: edge.getAttribute('d'),
			source: screenPoint(0),
			target: screenPoint(1),
			firstHalf: screenPoint(0.25),
			secondHalf: screenPoint(0.75),
			exposedFirstHalf: exposedPoint(0.25, 0.02, 0.45),
			exposedSecondHalf: exposedPoint(0.75, 0.55, 0.98)
		};
	}, [from, to]);
	if (!geometry?.path) {
		throw new Error(`Could not inspect ${from}→${to} edge geometry`);
	}
	const { exposedFirstHalf, exposedSecondHalf, ...result } = geometry;
	if (!exposed) {
		return result;
	}
	if (!exposedFirstHalf || !exposedSecondHalf) {
		throw new Error(`Cards cover the ${exposedFirstHalf ? 'target' : 'source'} half of the ${from}→${to} edge, so no gesture can grab it`);
	}
	return { ...result, firstHalf: exposedFirstHalf, secondHalf: exposedSecondHalf };
}

export async function canvasReconnectBlankPoint(page, origin) {
	return page.evaluate(point => {
		const canvas = document.querySelector('.basehalf-canvas-cards')?.getBoundingClientRect();
		if (!canvas) {
			throw new Error('Missing canvas bounds for reconnect preview');
		}
		const cards = Array.from(document.querySelectorAll('.react-flow__node')).map(node => node.getBoundingClientRect());
		const candidates = [];
		for (const xRatio of [0.08, 0.25, 0.5, 0.75, 0.92]) {
			for (const yRatio of [0.08, 0.25, 0.5, 0.75, 0.92]) {
				candidates.push({ x: canvas.left + canvas.width * xRatio, y: canvas.top + canvas.height * yRatio });
			}
		}
		const distanceToRect = (candidate, rect) => Math.hypot(
			Math.max(rect.left - candidate.x, 0, candidate.x - rect.right),
			Math.max(rect.top - candidate.y, 0, candidate.y - rect.bottom)
		);
		return candidates.reduce((best, candidate) => {
			const cardDistance = cards.length > 0
				? Math.min(...cards.map(rect => distanceToRect(candidate, rect)))
				: Number.POSITIVE_INFINITY;
			const originDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
			const score = Math.min(cardDistance, originDistance);
			return !best || score > best.score ? { ...candidate, score } : best;
		}, undefined);
	}, origin).then(({ x, y }) => ({ x, y }));
}

export function pointDistance(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

// Select the agent-drawn edge with the mouse and press Delete while focus is
// outside the canvas: nothing changes.
export async function assertEdgeDeleteScopedToCanvas(page, target) {
	const point = await edgeScreenMidpoint(page, 'README.md', target);
	await page.mouse.click(point.x, point.y);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-edge-hit.selected') !== null, null, { timeout: 10_000 });
	await page.evaluate(() => {
		const outside = document.querySelector('.part.sidebar');
		if (!(outside instanceof HTMLElement)) {
			throw new Error('Missing focus target outside the canvas');
		}
		outside.tabIndex = -1;
		outside.focus();
		if (document.activeElement !== outside || document.querySelector('.basehalf-canvas-cards')?.contains(document.activeElement)) {
			throw new Error('Could not move focus outside the canvas before testing scoped Delete');
		}
	});
	await page.keyboard.press('Delete');
	await page.waitForTimeout(200);
	if (readWorkspaceFile(target) !== agentNoteWithUpstream(['docs', 'README.md'])) {
		throw new Error('Delete outside the canvas removed the selected connection');
	}
	await assertCanvasEdgeVisible(page, 'README.md', target);
}

// Disconnect: Delete on the focused edge removes README.md from the target's
// own upstream list and nothing else; the line disappears.
export async function assertEdgeDeleteRemovesReference(page, target) {
	const point = await edgeScreenMidpoint(page, 'README.md', target);

	await page.mouse.click(point.x, point.y);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-edge-hit.selected') !== null, null, { timeout: 10_000 });
	await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement) || wrapper.tabIndex !== 0) {
			throw new Error('Missing focusable selected edge wrapper for keyboard deletion');
		}
		const ariaLabel = wrapper.getAttribute('aria-label');
		if (!ariaLabel || /label|note|why/i.test(ariaLabel)) {
			throw new Error(`Selected reference edge has the wrong accessible name: ${ariaLabel ?? '<missing>'}`);
		}
		wrapper.focus();
		if (document.activeElement !== wrapper) {
			throw new Error('Selected edge wrapper did not accept keyboard focus');
		}
	}, `README.md${String.fromCharCode(0)}${target}`);
	const readmeBefore = readWorkspaceFile('README.md');
	await page.keyboard.press('Delete');

	await waitUntil(() => readWorkspaceFile(target) === agentNoteWithUpstream(['docs']), `disconnect to remove README.md from the upstream list of ${target}`);
	await assertCanvasEdgeGone(page, 'README.md', target);
	await assertCanvasEdgeVisible(page, 'docs', target);
	if (readWorkspaceFile('README.md') !== readmeBefore) {
		throw new Error('Disconnecting changed the upstream card instead of only the downstream note');
	}
	if (target === AGENT_CREATED_CARD_PATH) {
		fs.rmSync(path.join(workspacePath, target));
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${target}"]`)
			.waitFor({ state: 'detached', timeout: 10_000 });
	}
}

// The exposed point of the `from`→`to` edge nearest its middle: edges render
// beneath cards, so the middle itself can lie under a card between the ends.
async function edgeScreenMidpoint(page, from, to) {
	const point = await page.evaluate(([source, target]) => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === `${source}${String.fromCharCode(0)}${target}`);
		if (!(hit instanceof SVGPathElement)) {
			return undefined;
		}
		const ctm = hit.getScreenCTM();
		const total = hit.getTotalLength();
		if (!ctm || total <= 0) {
			return undefined;
		}
		for (let offset = 0; offset <= 0.45; offset += 0.01) {
			for (const ratio of offset === 0 ? [0.5] : [0.5 - offset, 0.5 + offset]) {
				const along = hit.getPointAtLength(total * ratio);
				const screen = new DOMPoint(along.x, along.y).matrixTransform(ctm);
				if (document.elementFromPoint(screen.x, screen.y) === hit) {
					return { x: screen.x, y: screen.y };
				}
			}
		}
		return undefined;
	}, [from, to]);
	if (!point) {
		throw new Error(`Could not locate an exposed point on the ${from}→${to} edge hit path`);
	}
	return point;
}
