/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Reading and driving the canvas, for the steps of every suite that use it.

import path from 'path';
import process from 'process';
import { waitForViewTransitions } from '../app.mts';
import { root, workspacePath } from '../context.mts';

export function readCanvasCardGeometry(raw, cardPath) {
	const lines = raw.split(/\r?\n/);
	const marker = `- path: ${JSON.stringify(cardPath)}`;
	const start = lines.findIndex(line => line.trim() === marker);
	if (start < 0) {
		return undefined;
	}
	const geometry = {};
	for (let index = start + 1; index < lines.length; index++) {
		const trimmed = lines[index].trim();
		if (trimmed.startsWith('- path:') || trimmed === 'edges:') {
			break;
		}
		const match = /^(x|y|width|height):\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
		if (match) {
			geometry[match[1]] = Number(match[2]);
		}
	}
	return Number.isFinite(geometry.x) && Number.isFinite(geometry.y)
		? geometry
		: undefined;
}

export async function openRootCanvas(page) {
	if (await page.locator('.basehalf-command-center-breadcrumb-segment.current.root').isVisible().catch(() => false)) {
		return;
	}
	const root = page.locator('button.basehalf-command-center-breadcrumb-segment.root').first();
	await root.waitFor({ state: 'visible', timeout: 15_000 });
	await root.click();
	await assertCanvasFolder(page, '');
}

// The canvas places of the given cards, as the scene draws them.
export async function readCanvasCardPlaces(page, cardPaths) {
	return page.evaluate(paths => {
		const places = {};
		for (const cardPath of paths) {
			const card = [...document.querySelectorAll('.basehalf-canvas-card[data-basehalf-card-path]')].find(element => element.getAttribute('data-basehalf-card-path') === cardPath);
			const node = card?.closest('.react-flow__node');
			const match = node ? /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(node.style.transform) : undefined;
			places[cardPath] = match ? { x: Number(match[1]), y: Number(match[2]) } : { x: NaN, y: NaN };
		}
		return places;
	}, cardPaths);
}

function canvasZoomController(page) {
	const trigger = page.locator('.basehalf-canvas-zoom-value:visible');
	const menu = page.locator('.basehalf-canvas-zoom-menu:visible');
	return {
		trigger,
		menu,
		input: menu.locator('.basehalf-canvas-zoom-input'),
		action: action => menu.locator(`[data-zoom-action="${action}"]`)
	};
}

export async function openCanvasZoomMenu(page) {
	const controller = canvasZoomController(page);
	await controller.trigger.waitFor({ state: 'visible', timeout: 10_000 });
	if (!await controller.menu.isVisible().catch(() => false)) {
		await controller.trigger.click();
	}
	await controller.menu.waitFor({ state: 'visible', timeout: 10_000 });
	if (await controller.menu.getAttribute('role') !== 'dialog'
		|| await controller.trigger.getAttribute('aria-expanded') !== 'true') {
		throw new Error('Canvas zoom trigger did not open its dialog');
	}
	return controller;
}

/** Sets the zoom of the canvas with the zoom menu's field, as the user types it; it takes two decimals, and the canvas keeps four. */
export async function setCanvasZoomPercent(page, percent) {
	const controller = await openCanvasZoomMenu(page);
	await controller.input.fill(`${percent}%`);
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(expected => Math.abs(Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) - expected) < 0.00005, percent / 100, { timeout: 10_000 });
}

export async function zoomCanvas(page, action, options = {}) {
	if (options.preserveFocus) {
		const acted = await page.evaluate(({ actionName, useMetaKey }) => {
			const activeElement = document.activeElement;
			const root = activeElement?.closest('.basehalf-canvas-workbench');
			if (!(activeElement instanceof HTMLElement) || !(root instanceof HTMLElement)) {
				throw new Error('Canvas zoom shortcut requires focus inside the visible canvas');
			}
			const zoom = Number(root.dataset.zoom);
			if (actionName === 'out' && zoom <= 0.2 || actionName === 'in' && zoom >= 4) {
				return false;
			}
			const key = actionName === 'reset' ? '0' : actionName === 'out' ? '-' : actionName === 'in' ? '=' : undefined;
			if (!key) {
				throw new Error(`Canvas zoom action cannot preserve focus through a shortcut: ${actionName}`);
			}
			const event = new KeyboardEvent('keydown', {
				key,
				metaKey: useMetaKey,
				ctrlKey: !useMetaKey,
				bubbles: true,
				cancelable: true
			});
			activeElement.dispatchEvent(event);
			if (!event.defaultPrevented) {
				throw new Error(`Canvas zoom shortcut was not handled: ${actionName}`);
			}
			return true;
		}, { actionName: action, useMetaKey: process.platform === 'darwin' });
		await page.locator('.basehalf-canvas-zoom-menu').waitFor({ state: 'hidden', timeout: 10_000 });
		return acted;
	}

	const controller = await openCanvasZoomMenu(page);
	const actionButton = controller.action(action);
	await actionButton.waitFor({ state: 'visible', timeout: 10_000 });
	if (!await actionButton.isEnabled()) {
		await page.keyboard.press('Escape');
		await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
		return false;
	}
	await actionButton.click();
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	return true;
}

export async function assertCanvasFolder(page, folderPath) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	await waitForViewTransitions(page);
	await page.locator('.basehalf-canvas-react-island').waitFor({ state: 'visible', timeout: 20_000 });
	const currentFolder = page.locator(folderPath
		? '.basehalf-command-center-breadcrumb-segment.current'
		: '.basehalf-command-center-breadcrumb-segment.current.root').last();
	const expectedPath = [path.basename(workspacePath), ...folderPath.split('/').filter(Boolean)].join(' / ');
	const deadline = Date.now() + 20_000;
	let actualPath;
	do {
		if (await currentFolder.isVisible().catch(() => false)) {
			// The breadcrumb's names, as the title bar shows them; it shows no tooltip (D65).
			actualPath = await page.locator('.basehalf-command-center-breadcrumbs .basehalf-command-center-breadcrumb-segment').evaluateAll(segments => segments.map(segment => segment.textContent?.trim()).join(' / '));
			if (actualPath === expectedPath) {
				return;
			}
		}
		await page.waitForTimeout(100);
	} while (Date.now() < deadline);
	throw new Error(`Expected the ${folderPath || '<root>'} canvas, got ${actualPath || '<empty>'}`);
}

export function canvasNoteInlineEditor(page, relativePath) {
	const host = page.getByTestId(`canvas-note-editor-${relativePath}`);
	return {
		host,
		surface: host.locator('.basehalf-canvas-markdown-inline').first(),
		editable: host.locator('.basehalf-canvas-markdown-inline > .ProseMirror').first()
	};
}

export async function waitForCanvasCardSelection(page, relativePath, timeout = 10_000) {
	await page.waitForFunction(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card'))
			.find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === path);
		return card?.closest('.react-flow__node')?.classList.contains('selected') === true;
	}, relativePath, { timeout });
}

export async function waitForCanvasNoteInlineEditor(page, relativePath) {
	const editor = canvasNoteInlineEditor(page, relativePath);
	await editor.host.waitFor({ state: 'visible', timeout: 10_000 });
	await editor.surface.waitFor({ state: 'visible', timeout: 10_000 });
	await editor.editable.waitFor({ state: 'visible', timeout: 10_000 });
	try {
		await page.waitForFunction(testId => {
			const host = document.querySelector(`[data-testid="${testId}"]`);
			const editable = host?.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror');
			return editable instanceof HTMLElement
				&& editable.getAttribute('contenteditable') === 'true'
				&& (document.activeElement === editable || editable.contains(document.activeElement));
		}, `canvas-note-editor-${relativePath}`, { timeout: 10_000 });
	} catch (error) {
		const focus = await page.evaluate(() => {
			const active = document.activeElement;
			return {
				tag: active?.tagName,
				className: active instanceof HTMLElement ? active.className : undefined,
				role: active?.getAttribute('role'),
				ariaLabel: active?.getAttribute('aria-label'),
				cardPath: active instanceof HTMLElement
					? active.closest<HTMLElement>('.basehalf-canvas-card')?.dataset.basehalfCardPath
					: undefined,
				insideCardDetail: active instanceof HTMLElement && active.closest('.basehalf-card-detail') !== null,
				insideCanvas: active instanceof HTMLElement && active.closest('.basehalf-canvas-workbench') !== null
			};
		});
		throw new Error(`Canvas Note ${relativePath} mounted but did not receive focus: ${JSON.stringify(focus)} (${error instanceof Error ? error.message : String(error)})`);
	}
	const liveEditors = await page.locator('[data-testid^="canvas-note-editor-"]').count();
	if (liveEditors !== 1) {
		throw new Error(`Expected exactly one Canvas Note inline editor, got ${liveEditors}`);
	}
	return editor;
}

// Starts a connection drag from the east handle of `sourcePath`'s card and
// returns the pointer position once React Flow draws the draft path.
export async function startCanvasConnectionDrag(page, sourcePath) {
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${sourcePath}"]`);
	const handleSelector = `.react-flow__node[data-id="${sourcePath}"] > .basehalf-canvas-card-connect-handle.east`;
	await card.hover();
	await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).pointerEvents !== 'none', handleSelector, { timeout: 10_000 });
	const sourceBox = await page.locator(handleSelector).boundingBox();
	if (!sourceBox) {
		throw new Error('Missing React Flow connection geometry');
	}
	// Inside the outline the card keeps the pointer; press the handle's outside half.
	const sourcePoint = { x: sourceBox.x + sourceBox.width / 2 + 3, y: sourceBox.y + sourceBox.height / 2 };
	let connectionStartState;
	for (let attempt = 0; attempt < 3; attempt++) {
		await card.hover();
		await page.mouse.move(sourcePoint.x, sourcePoint.y);
		await page.mouse.down();
		// The connection gesture intentionally waits until the pointer crosses its
		// drag threshold; pointer-down alone does not create a draft path.
		await page.mouse.move(sourcePoint.x + 8 + attempt * 4, sourcePoint.y, { steps: 3 });
		if (await page.locator('.react-flow__connection-path').waitFor({ state: 'attached', timeout: 2_500 }).then(() => true, () => false)) {
			return sourcePoint;
		}
		connectionStartState = await page.evaluate(({ x, y, selector }) => {
			const target = document.elementFromPoint(x, y);
			const handle = document.querySelector(selector);
			return {
				targetClass: target?.getAttribute('class'),
				handleClass: handle?.getAttribute('class'),
				handlePointerEvents: handle ? getComputedStyle(handle).pointerEvents : undefined,
				handleOpacity: handle ? getComputedStyle(handle).opacity : undefined
			};
		}, { ...sourcePoint, selector: handleSelector });
		await page.mouse.up();
		await page.keyboard.press('Escape');
		await page.waitForTimeout(100);
	}
	throw new Error(`Connection gesture did not start from the visible handle: ${JSON.stringify(connectionStartState)}`);
}

// Where canvas coordinates are on screen, and the box of the canvas.
export async function readCanvasView(page) {
	return page.evaluate(() => {
		const viewport = document.querySelector('.react-flow__viewport');
		const flow = document.querySelector('.react-flow');
		const canvas = document.querySelector('.basehalf-canvas-cards');
		if (!viewport || !flow || !canvas) {
			throw new Error('Missing canvas view');
		}
		const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
		const origin = flow.getBoundingClientRect();
		const box = canvas.getBoundingClientRect();
		return { x: origin.left + matrix.e, y: origin.top + matrix.f, zoom: matrix.a, canvas: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } };
	});
}

/** A point of the empty canvas, where a wheel or a click meets no card. */
export async function emptyCanvasPoint(page) {
	await waitForViewTransitions(page);
	const point = await page.evaluate(() => {
		const pane = document.querySelector('.basehalf-canvas-cards .react-flow__pane');
		if (!(pane instanceof HTMLElement)) {
			return undefined;
		}
		const box = pane.getBoundingClientRect();
		for (const y of [box.top + 28, box.bottom - 28, box.top + box.height / 2]) {
			for (const x of [box.left + 28, box.right - 28]) {
				if (document.elementFromPoint(x, y) === pane) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!point) {
		throw new Error('The canvas has no empty place at its edges');
	}
	return point;
}

// Runs an action of the canvas's Create menu, the plus at its corner: New
// Note, New Image, New Video, New Audio, New File..., or New Folder....
export async function clickCanvasCreateAction(page, label) {
	const createButton = page.locator('.basehalf-canvas-create-button');
	await createButton.focus();
	await page.keyboard.press('Enter');
	// A command keybinding is part of the menuitem's accessible name (for
	// example, "New Note ⌘N"). Match the visible action label so the helper
	// exercises both keybound and unbound create commands.
	const action = page.locator('.context-view.monaco-menu-container .action-label')
		.filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
		.filter({ visible: true })
		.last();
	await action.waitFor({ state: 'visible', timeout: 10_000 });
	// VS Code intentionally attaches menu mouse-up listeners after a 100 ms
	// guard against the pointer event that opened the menu. Let the real widget
	// settle, then use a normal Playwright click through its public interaction.
	await page.waitForTimeout(150);
	await action.click();
}

// The actions of the Create menu, in order, with a separator as `|`.
export async function readCanvasCreateMenu(page) {
	const createButton = page.locator('.basehalf-canvas-create-button');
	await createButton.focus();
	await page.keyboard.press('Enter');
	const menu = page.locator('.context-view.monaco-menu-container').filter({ visible: true }).last();
	await menu.locator('.action-label').first().waitFor({ state: 'visible', timeout: 10_000 });
	const items = await menu.evaluate(element => Array.from(element.querySelectorAll('.action-item')).map(item => {
		const label = (item.querySelector('.action-label')?.textContent ?? '').trim();
		return item.querySelector('.separator') || item.classList.contains('separator') || !label ? '|' : label;
	}));
	await page.keyboard.press('Escape');
	await menu.waitFor({ state: 'hidden', timeout: 10_000 });
	return items;
}

/**
 * Pans the canvas until `card` is at the screen position `expected`, so a
 * step that had to pan can hand the viewport back as it found it.
 */
export async function panCanvasCardTo(page, card, expected) {
	const canvas = page.locator('.basehalf-canvas-cards');
	for (let attempt = 0; attempt < 12; attempt++) {
		const canvasBox = await canvas.boundingBox();
		const box = await card.boundingBox();
		if (!canvasBox || !box) {
			await page.waitForTimeout(100);
			continue;
		}
		const deltaX = expected.x - box.x;
		const deltaY = expected.y - box.y;
		if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) {
			return;
		}

		await panCanvasToward(page, canvasBox, deltaX, deltaY);
	}

	throw new Error('Canvas viewport did not return to where the step found it');
}

/** One middle-button pan toward the delta, as far as the canvas bounds allow. */
export async function panCanvasToward(page, canvasBox, deltaX, deltaY) {
	const panStart = await page.evaluate(({ bounds, horizontal, vertical }) => {
		const xFractions = horizontal >= 0 ? [0.15, 0.3, 0.5, 0.7, 0.85] : [0.85, 0.7, 0.5, 0.3, 0.15];
		const yFractions = vertical >= 0 ? [0.15, 0.3, 0.5, 0.7, 0.85] : [0.85, 0.7, 0.5, 0.3, 0.15];
		const points = yFractions.flatMap(yFraction => xFractions.map(xFraction => ({ x: bounds.x + bounds.width * xFraction, y: bounds.y + bounds.height * yFraction })));
		// Empty canvas first. A card can hold a control that keeps the pointer
		// and shows only under it: the control bar of a video card appears on
		// hover and takes the press.
		const blank = points.find(point => document.elementFromPoint(point.x, point.y)?.classList.contains('react-flow__pane'));
		if (blank) {
			return blank;
		}
		// A drag by the middle button moves the canvas from a card and from a
		// connection too. It does not from a control of a card, a toolbar, or
		// another surface that keeps the pointer, and such a surface can lie on
		// the first point: the toolbar of a set is as wide as its names.
		return points.find(point => {
			const hit = document.elementFromPoint(point.x, point.y);
			const keeps = hit?.closest('.nopan');
			return !!hit?.closest('.react-flow__pane') && (!keeps || keeps === hit.closest('.react-flow__node, .react-flow__edge'));
		});
	}, { bounds: canvasBox, horizontal: deltaX, vertical: deltaY });
	if (!panStart) {
		await page.waitForTimeout(100);
		return;
	}

	const startX = panStart.x;
	const startY = panStart.y;
	const maxDeltaX = Math.max(1, deltaX >= 0
		? canvasBox.x + canvasBox.width - startX - 12
		: startX - canvasBox.x - 12);
	const maxDeltaY = Math.max(1, deltaY >= 0
		? canvasBox.y + canvasBox.height - startY - 12
		: startY - canvasBox.y - 12);
	await page.mouse.move(startX, startY);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.move(
		startX + Math.max(-maxDeltaX, Math.min(maxDeltaX, deltaX)),
		startY + Math.max(-maxDeltaY, Math.min(maxDeltaY, deltaY)),
		{ steps: 8 }
	);
	await page.mouse.up({ button: 'middle' });
	await page.waitForTimeout(50);
}

// A derived edge (from the reference graph) is drawn on the current canvas.
export async function assertCanvasEdgeVisible(page, from, to) {
	await page.waitForFunction(([f, t]) => {
		return Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.some(p => p instanceof SVGPathElement && p.dataset.edgeId === `${f}${String.fromCharCode(0)}${t}`);
	}, [from, to], { timeout: 15_000 });
}

export async function assertCanvasEdgeGone(page, from, to) {
	await page.waitForFunction(([f, t]) => {
		return !Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.some(p => p instanceof SVGPathElement && p.dataset.edgeId === `${f}${String.fromCharCode(0)}${t}`);
	}, [from, to], { timeout: 15_000 });
}

// What has the keyboard focus, and the ring it shows, if any. On the canvas a
// focus ring is for the keyboard: a click leaves none, and a text field shows
// its focus by its caret (architecture invariants, Product shell).
export function readCanvasFocus(page) {
	return page.evaluate(() => {
		const active = document.activeElement;
		if (!active || active === document.body) {
			return { element: null, role: null, ring: null };
		}
		const style = getComputedStyle(active);
		return {
			element: `${active.tagName.toLowerCase()}.${[...active.classList].join('.')}`,
			role: active.getAttribute('role'),
			ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 ? `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}` : null
		};
	});
}

export async function assertNoCanvasFocusRing(page, what) {
	const focus = await readCanvasFocus(page);
	if (focus.ring !== null) {
		throw new Error(`${what} must show no focus ring: ${JSON.stringify(focus)}`);
	}
	return focus;
}

// A menu that a click opened holds the focus itself, with no current item
// until an arrow key chooses one, and shows no ring.
export async function assertCanvasMenuOpenedByClick(page, menuSelector, what) {
	await page.waitForFunction(selector => document.activeElement?.matches(selector) ?? false, menuSelector, { timeout: 10_000 }).catch(async () => {
		throw new Error(`${what}, opened by a click, must hold the focus itself with no current item: ${JSON.stringify(await readCanvasFocus(page))}`);
	});
	await assertNoCanvasFocusRing(page, what);
}
