/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The zoom controls and snapping.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { readCanvasCardNumber } from './creation.mts';
import { logsPath, opts, root, workspacePath } from '../../context.mts';
import { emptyCanvasPoint, openCanvasZoomMenu, zoomCanvas } from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';

export async function assertCanvasZoomControls(page) {
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	const beforeGesture = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const controls = document.querySelector('.basehalf-canvas-zoom-controls');
		const chrome = controls?.closest('.basehalf-canvas-chrome');
		const snapToggle = controls?.querySelector('.basehalf-canvas-snap-toggle');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement)
			|| !(controls instanceof HTMLElement)
			|| !(chrome instanceof HTMLElement)
			|| !(snapToggle instanceof HTMLButtonElement)
			|| !(viewport instanceof HTMLElement)) {
			throw new Error('Missing React Flow zoom geometry');
		}
		const rootRect = root.getBoundingClientRect();
		const controlsRect = controls.getBoundingClientRect();
		const framePaint = element => {
			const style = getComputedStyle(element);
			return {
				backgroundColor: style.backgroundColor,
				borderTopWidth: style.borderTopWidth,
				borderRightWidth: style.borderRightWidth,
				borderBottomWidth: style.borderBottomWidth,
				borderLeftWidth: style.borderLeftWidth,
				boxShadow: style.boxShadow
			};
		};
		return {
			controls: { left: controlsRect.left, top: controlsRect.top, right: controlsRect.right, bottom: controlsRect.bottom },
			viewport: getComputedStyle(viewport).transform,
			leftGap: controlsRect.left - rootRect.left,
			bottomGap: rootRect.bottom - controlsRect.bottom,
			snapPressed: snapToggle.getAttribute('aria-pressed'),
			railChrome: { container: framePaint(chrome), controls: framePaint(controls) },
			center: { x: rootRect.left + rootRect.width / 2, y: rootRect.top + rootRect.height / 2 }
		};
	});
	if (beforeGesture.snapPressed !== 'true') {
		throw new Error(`Expected Canvas snap to be enabled by default: ${JSON.stringify(beforeGesture)}`);
	}
	if (Object.values(beforeGesture.railChrome).some(chrome =>
		!['transparent', 'rgba(0, 0, 0, 0)'].includes(chrome.backgroundColor)
		|| chrome.borderTopWidth !== '0px'
		|| chrome.borderRightWidth !== '0px'
		|| chrome.borderBottomWidth !== '0px'
		|| chrome.borderLeftWidth !== '0px'
		|| chrome.boxShadow !== 'none')) {
		throw new Error(`Expected unframed Canvas view controls: ${JSON.stringify(beforeGesture.railChrome)}`);
	}
	if (beforeGesture.leftGap < 8 || beforeGesture.leftGap > 20 || beforeGesture.bottomGap < 12 || beforeGesture.bottomGap > 24) {
		throw new Error(`Expected Canvas view controls in the lower-left of the canvas viewport: ${JSON.stringify(beforeGesture)}`);
	}
	await page.locator('.basehalf-canvas-zoom-value').blur();
	await page.mouse.move(beforeGesture.center.x, beforeGesture.center.y);
	if (opts.output) {
		await page.screenshot({ path: path.join(logsPath, 'canvas-zoom-rail.png'), fullPage: true });
	}
	const snapToggle = page.locator('.basehalf-canvas-snap-toggle:visible');
	await snapToggle.click();
	if (await snapToggle.getAttribute('aria-pressed') !== 'false') {
		throw new Error('Canvas snap toggle did not expose its disabled state');
	}
	await snapToggle.click();
	if (await snapToggle.getAttribute('aria-pressed') !== 'true') {
		throw new Error('Canvas snap toggle did not restore its enabled state');
	}
	// The scroll starts on empty canvas. In the middle the pointer would be
	// moved onto a card, and a long note at rest takes such a scroll.
	const emptyCanvas = await emptyCanvasPoint(page);
	await page.mouse.move(emptyCanvas.x, emptyCanvas.y);
	await page.mouse.wheel(80, 120);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		return viewport instanceof HTMLElement && getComputedStyle(viewport).transform !== previous;
	}, beforeGesture.viewport, { timeout: 10_000 });
	// React Flow reports the final viewport on moveEnd. Let that report settle
	// before starting a separate imperative zoom command. Chromium may surface
	// this pixel wheel input as a trackpad pinch on macOS, so use the settled
	// runtime zoom instead of assuming the gesture was a pure pan.
	await page.waitForTimeout(250);
	const zoomAfterGesture = Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom'));
	if (!Number.isFinite(zoomAfterGesture) || zoomAfterGesture <= 0) {
		throw new Error(`Expected a valid runtime zoom after the viewport gesture; got ${zoomAfterGesture}`);
	}
	const afterGesture = await page.locator('.basehalf-canvas-zoom-controls').boundingBox();
	if (!afterGesture || Math.abs(afterGesture.x - beforeGesture.controls.left) > 1 || Math.abs(afterGesture.y - beforeGesture.controls.top) > 1) {
		throw new Error(`Expected zoom chrome to stay fixed while the canvas viewport changes: ${JSON.stringify({ beforeGesture, afterGesture })}`);
	}

	let controller = await openCanvasZoomMenu(page);
	await controller.input.waitFor({ state: 'visible', timeout: 10_000 });
	const [menuBox, controlsBox] = await Promise.all([controller.menu.boundingBox(), page.locator('.basehalf-canvas-zoom-controls').boundingBox()]);
	if (!menuBox || !controlsBox || menuBox.y + menuBox.height > controlsBox.y - 1) {
		throw new Error(`Expected the Canvas zoom dialog above its lower-left controls: ${JSON.stringify({ menuBox, controlsBox })}`);
	}
	if (!await controller.input.evaluate(input => document.activeElement === input)) {
		throw new Error('Opening Canvas zoom options did not focus the percentage input');
	}
	if (opts.output) {
		await page.screenshot({ path: path.join(logsPath, 'canvas-zoom-menu.png'), fullPage: true });
	}
	await controller.trigger.click();
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	if (await controller.trigger.getAttribute('aria-expanded') !== 'false') {
		throw new Error('Clicking the open Canvas zoom trigger did not close its dialog');
	}
	controller = await openCanvasZoomMenu(page);
	await page.keyboard.press('Escape');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	if (await controller.trigger.getAttribute('aria-expanded') !== 'false'
		|| !await controller.trigger.evaluate(trigger => document.activeElement === trigger)) {
		throw new Error('Escape did not close Canvas zoom options and restore trigger focus');
	}

	controller = await openCanvasZoomMenu(page);
	await controller.input.fill('37.5%');
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.375', null, { timeout: 10_000 });

	controller = await openCanvasZoomMenu(page);
	if (await controller.input.inputValue() !== '37.5') {
		throw new Error(`Canvas zoom percentage did not round-trip exactly: ${await controller.input.inputValue()}`);
	}
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.375', null, { timeout: 10_000 });

	controller = await openCanvasZoomMenu(page);
	await controller.input.press('ArrowDown');
	if (await page.locator('.basehalf-canvas-zoom-menu-action:focus').getAttribute('data-zoom-action') !== 'in') {
		throw new Error('Canvas zoom dialog did not move keyboard focus from its input to the first enabled action');
	}
	await page.keyboard.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.475', null, { timeout: 10_000 });
	if (!await controller.trigger.evaluate(trigger => document.activeElement === trigger)) {
		throw new Error('Keyboard activation of a Canvas zoom action did not restore trigger focus');
	}

	controller = await openCanvasZoomMenu(page);
	await controller.input.fill('50');
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.5', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '50%' }).waitFor({ state: 'visible', timeout: 10_000 });
	if (await controller.trigger.getAttribute('aria-expanded') !== 'false'
		|| !await controller.trigger.evaluate(trigger => document.activeElement === trigger)) {
		throw new Error('Committing a Canvas zoom percentage did not close the dialog and restore trigger focus');
	}

	const nextZoom = 0.6;
	await zoomCanvas(page, 'in');
	await page.waitForFunction(expected => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) === expected, nextZoom, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: `${Math.round(nextZoom * 100)}%` }).waitFor({ state: 'visible', timeout: 10_000 });
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '100%' }).waitFor({ state: 'visible', timeout: 10_000 });

	controller = await openCanvasZoomMenu(page);
	const workbenchZoomBefore = await page.evaluate(() => ({
		devicePixelRatio: window.devicePixelRatio,
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight
	}));
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+=' : 'Control+=');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1.1', null, { timeout: 10_000 });
	const workbenchZoomAfter = await page.evaluate(() => ({
		devicePixelRatio: window.devicePixelRatio,
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight
	}));
	if (JSON.stringify(workbenchZoomAfter) !== JSON.stringify(workbenchZoomBefore)) {
		throw new Error(`Canvas zoom shortcut also changed the workbench zoom: ${JSON.stringify({ workbenchZoomBefore, workbenchZoomAfter })}`);
	}
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });

	await zoomCanvas(page, 'preset-400');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '4', null, { timeout: 10_000 });
	controller = await openCanvasZoomMenu(page);
	await controller.input.press('ArrowDown');
	if (await page.locator('.basehalf-canvas-zoom-menu-action:focus').getAttribute('data-zoom-action') !== 'out') {
		throw new Error('Canvas zoom keyboard navigation did not skip the disabled Zoom In action at 400%');
	}
	await page.keyboard.press('Escape');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });

	const beforeFitTransform = await page.locator('.basehalf-canvas-cards .react-flow__viewport').evaluate(viewport => getComputedStyle(viewport).transform);
	await zoomCanvas(page, 'fit');
	await page.waitForFunction(previousTransform => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
			return false;
		}
		const transform = getComputedStyle(viewport).transform;
		const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
		return transform !== previousTransform
			&& Math.abs(matrix.a - Number(root.dataset.zoom)) < 0.01
			&& document.querySelector('.basehalf-canvas-zoom-value')?.textContent?.trim() === `${Math.round(Number(root.dataset.zoom) * 100)}%`;
	}, beforeFitTransform, { timeout: 10_000 });

	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '100%' }).waitFor({ state: 'visible', timeout: 10_000 });
}

export async function assertCanvasSnapGuides(page) {
	// Snap against the same flow geometry regardless of the viewport left by
	// earlier canvas tests. Without this fit, the target can sit inside React
	// Flow's drag auto-pan zone; holding the pointer there while we inspect the
	// guide keeps panning the viewport and moves the node away from the axis.
	await zoomCanvas(page, 'fit');
	for (let i = 0; i < 10; i++) {
		const zoom = await page.locator('.basehalf-canvas-workbench').evaluate(root => Number(root.getAttribute('data-zoom')) || 1);
		if (zoom <= 0.5 || !(await zoomCanvas(page, 'out'))) {
			break;
		}
		await page.waitForFunction(previous => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) < previous, zoom, { timeout: 10_000 });
	}

	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await docs.waitFor({ state: 'visible', timeout: 20_000 });
	// The zoom change re-renders the cards, so the element the locator found
	// can be replaced before the scroll runs. Look it up again when that happens.
	for (let attempt = 0; ; attempt++) {
		try {
			await readme.scrollIntoViewIfNeeded();
			break;
		} catch (error) {
			if (attempt >= 4 || !/not attached/.test(String(error))) {
				throw error;
			}
		}
	}
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

	const geometry = await page.evaluate(() => {
		const readmeCard = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const docsCard = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const root = document.querySelector('.basehalf-canvas-workbench');
		if (!(readmeCard instanceof HTMLElement) || !(docsCard instanceof HTMLElement) || !(root instanceof HTMLElement)) {
			return undefined;
		}
		const readmeNode = readmeCard.closest('.react-flow__node');
		const docsNode = docsCard.closest('.react-flow__node');
		if (!(readmeNode instanceof HTMLElement) || !(docsNode instanceof HTMLElement)) {
			return undefined;
		}

		const matrixFor = (element) => {
			const transform = getComputedStyle(element).transform;
			return transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
		};
		const readmeMatrix = matrixFor(readmeNode);
		const docsMatrix = matrixFor(docsNode);
		// Card identity now lives in the stable caption outside the painted frame.
		// Start the drag there so the smoke exercises the same shared drag surface
		// that users see, instead of the Note body (which owns text interaction).
		const dragSurface = readmeCard.querySelector('.basehalf-canvas-card-caption-identity');
		const readmeRect = readmeCard.getBoundingClientRect();
		const dragRect = dragSurface instanceof HTMLElement ? dragSurface.getBoundingClientRect() : readmeRect;
		const rootRect = root.getBoundingClientRect();
		const zoom = Number(root.getAttribute('data-zoom')) || 1;
		const targetDraftX = docsMatrix.m41 + 3;
		const startX = dragRect.left + dragRect.width / 2;
		const startY = dragRect.top + dragRect.height / 2;
		const endX = startX + (targetDraftX - readmeMatrix.m41) * zoom;
		const endY = startY;
		if (startX < rootRect.left || startX > rootRect.right || startY < rootRect.top || startY > rootRect.bottom) {
			return undefined;
		}

		return {
			startX,
			startY,
			endX,
			endY,
			targetAxesX: [docsMatrix.m41, docsMatrix.m41 + docsNode.offsetWidth / 2, docsMatrix.m41 + docsNode.offsetWidth],
			draggedWidth: readmeNode.offsetWidth,
			draftX: targetDraftX,
			initialX: readmeMatrix.m41,
			zoom
		};
	});
	if (!geometry) {
		throw new Error('Missing visible canvas geometry for snap smoke');
	}

	await page.mouse.move(geometry.startX, geometry.startY);
	await page.mouse.down();
	await page.mouse.move(geometry.endX, geometry.endY, { steps: 14 });
	await page.waitForFunction(targetAxesX => Array.from(document.querySelectorAll('[data-testid="canvas-snap-guide"]')).some(line => {
		const x1 = Number(line.getAttribute('x1'));
		const x2 = Number(line.getAttribute('x2'));
		const y1 = Number(line.getAttribute('y1'));
		const y2 = Number(line.getAttribute('y2'));
		return Math.abs(x1 - x2) <= 0.1
			&& targetAxesX.some(axis => Math.abs(x1 - axis) <= 0.1)
			&& y2 > y1;
	}), geometry.targetAxesX, { timeout: 10_000 });

	const guides = await page.locator('[data-testid="canvas-snap-guide"]').evaluateAll(lines => lines.map(line => ({
		x1: Number(line.getAttribute('x1')),
		x2: Number(line.getAttribute('x2')),
		y1: Number(line.getAttribute('y1')),
		y2: Number(line.getAttribute('y2'))
	})));
	const verticalGuide = guides.find(guide => Math.abs(guide.x1 - guide.x2) <= 0.1
		&& geometry.targetAxesX.some(axis => Math.abs(guide.x1 - axis) <= 0.1)
		&& guide.y2 > guide.y1);
	if (!verticalGuide) {
		throw new Error(`Expected a vertical snap guide on a docs alignment axis ${JSON.stringify(geometry.targetAxesX)}, got ${JSON.stringify(guides)}`);
	}

	await page.mouse.up();
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length === 0, null, { timeout: 10_000 });

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		const savedX = readCanvasCardNumber(canvas, 'README.md', 'x');
		return savedX !== undefined && [savedX, savedX + geometry.draggedWidth / 2, savedX + geometry.draggedWidth]
			.some(axis => Math.abs(axis - verticalGuide.x1) <= 0.1);
	}, 'README.md card to persist on the displayed docs snap axis');

	const snapToggle = page.locator('.basehalf-canvas-snap-toggle:visible');
	const pane = page.locator('.basehalf-canvas-cards .react-flow__pane');
	await pane.click({ position: { x: 20, y: 20 } });
	const toggleDrag = await readme.boundingBox();
	if (!toggleDrag) {
		throw new Error('README.md card disappeared before exercising the snap toggle');
	}
	const toggleDragStartX = toggleDrag.x + toggleDrag.width / 2;
	const toggleDragStartY = toggleDrag.y + toggleDrag.height / 2;
	await page.mouse.move(toggleDragStartX, toggleDragStartY);
	await page.mouse.down();
	await page.mouse.move(toggleDragStartX + 30, toggleDragStartY, { steps: 8 });
	await page.mouse.move(toggleDragStartX + 3 * geometry.zoom, toggleDragStartY, { steps: 8 });
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length > 0, null, { timeout: 10_000 });
	// A programmatic click lets the fixed viewport control change state while
	// React Flow still owns the pointer gesture.
	await snapToggle.evaluate(button => button.click());
	if (await snapToggle.getAttribute('aria-pressed') !== 'false') {
		throw new Error('Canvas snap toggle did not disable snapping during an active drag');
	}
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length === 0, null, { timeout: 10_000 });
	await page.mouse.up();
	await snapToggle.click();
	if (await snapToggle.getAttribute('aria-pressed') !== 'true') {
		throw new Error('Canvas snap toggle did not restore snapping after clearing the active guide');
	}
}
