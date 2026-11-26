/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The zoom controls and snapping.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { readCanvasCardNumber } from './creation.mts';
import { logsPath, opts, root, userDataDir, workspacePath } from '../../context.mts';
import { canvasCardGrip, emptyCanvasPoint, openCanvasZoomMenu, readCanvasView, setCanvasZoomPercent, zoomCanvas } from '../../lib/canvas.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

// Moves the pointer that holds a card down from a point until no folder
// would take the card where it is let go (dropping into a folder).
async function movePointerOffFolders(page, x, y) {
	const takenByFolder = () => page.evaluate(() => document.querySelector('[data-basehalf-drop-target]') !== null);
	for (let offset = 24; await takenByFolder(); offset += 24) {
		if (offset > 480) {
			throw new Error('The card found no place off the folders to be let go.');
		}
		await page.mouse.move(x, y + offset, { steps: 2 });
		await page.waitForTimeout(32);
	}
}

/** Runs `run` with `values` added to the settings of the workspace, and puts the settings back. */
async function withWorkspaceSettings(page, values, run) {
	const settings = path.join(workspacePath, '.vscode', 'settings.json');
	const before = fs.readFileSync(settings, 'utf8');
	fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(before), ...values }, null, '\t'), 'utf8');
	try {
		// The window reads a changed settings file within about a second.
		await page.waitForTimeout(1_500);
		await run();
	} finally {
		fs.writeFileSync(settings, before, 'utf8');
		await page.waitForTimeout(1_500);
	}
}

/** One event of the wheel at a point, with the zoom key held or not; then the view once it has settled. */
async function wheelOnCanvas(page, point, deltaX, deltaY, zoomKey = false) {
	const key = process.platform === 'darwin' ? 'Meta' : 'Control';
	await page.mouse.move(point.x, point.y);
	if (zoomKey) {
		await page.keyboard.down(key);
	}
	try {
		await page.mouse.wheel(deltaX, deltaY);
		// The view moves in the frame of the event.
		await page.waitForTimeout(100);
	} finally {
		if (zoomKey) {
			await page.keyboard.up(key);
		}
	}
	// A gesture of the wheel ends 150 ms after its last event: the next event of these steps is a new one.
	await page.waitForTimeout(300);
	return readCanvasView(page);
}

/** How a view differs from the one before it: how far it moved, by what factor it zoomed, and how far the place under `point` moved. */
function viewChange(before, after, point) {
	const place = view => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom });
	return {
		dx: Math.round((after.x - before.x) * 10) / 10,
		dy: Math.round((after.y - before.y) * 10) / 10,
		factor: Math.round(after.zoom / before.zoom * 10_000) / 10_000,
		placeUnderThePointer: Math.round(Math.hypot(place(after).x - place(before).x, place(after).y - place(before).y) * after.zoom * 10) / 10
	};
}

// Canvas wheel gestures, criteria 18 to 20 (D144): a gesture of the wheel on
// empty canvas moves the canvas or zooms it about the pointer as the setting
// says, the zoom key makes it the other, and a drag with the middle button
// moves the canvas with either value.
export async function assertCanvasWheelFollowsItsSetting(page) {
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value').blur();
	const point = await emptyCanvasPoint(page);
	// 100 pixels down make the canvas 2^-0.2 as large.
	const smaller = 0.8706;
	const read = async (wheelZooms) => {
		const seen = {};
		let before = await readCanvasView(page);
		for (const [name, zoomKey] of [['wheel', false], ['wheelWithTheZoomKey', true]]) {
			const after = await wheelOnCanvas(page, point, 0, 100, zoomKey);
			seen[name] = viewChange(before, after, point);
			// Back, so that each reading starts from the same view.
			before = await wheelOnCanvas(page, point, 0, -100, zoomKey);
		}
		// A sideways event, as the wheel with Shift sends, moves the canvas sideways.
		const sideways = await wheelOnCanvas(page, point, 100, 0);
		seen.sideways = viewChange(before, sideways, point);
		before = await wheelOnCanvas(page, point, -100, 0);
		// A drag with the middle button moves the canvas.
		await page.mouse.move(point.x, point.y);
		await page.mouse.down({ button: 'middle' });
		await page.mouse.move(point.x + 40, point.y + 30, { steps: 5 });
		await page.mouse.up({ button: 'middle' });
		await page.waitForTimeout(300);
		const dragged = await readCanvasView(page);
		seen.middleButton = viewChange(before, dragged, point);
		await page.mouse.move(point.x + 40, point.y + 30);
		await page.mouse.down({ button: 'middle' });
		await page.mouse.move(point.x, point.y, { steps: 5 });
		await page.mouse.up({ button: 'middle' });
		await page.waitForTimeout(300);
		const moves = change => change.factor === 1 && change.dx === 0 && change.dy === -100;
		const zooms = change => Math.abs(change.factor - smaller) < 0.0005 && change.placeUnderThePointer <= 1;
		const expected = wheelZooms ? zooms(seen.wheel) && moves(seen.wheelWithTheZoomKey) : moves(seen.wheel) && zooms(seen.wheelWithTheZoomKey);
		if (!expected || seen.sideways.factor !== 1 || seen.sideways.dx !== -100 || seen.sideways.dy !== 0
			|| seen.middleButton.factor !== 1 || seen.middleButton.dx !== 40 || seen.middleButton.dy !== 30) {
			throw new Error(`With the wheel that ${wheelZooms ? 'zooms' : 'moves the canvas'}, a gesture of the wheel did not do what the setting says: ${JSON.stringify(seen)}`);
		}
	};
	await read(false);
	await withWorkspaceSettings(page, { 'basehalf.canvas.wheel': 'zoom' }, () => read(true));
	// Without a reload, the canvas follows the setting put back.
	await read(false);
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
}

/**
 * Each part zooms by itself, criteria 2 and 3 (D153): at a window's zoom of 120% a card is as large on the screen as
 * at 100%, the zoom control says what it said, and the canvas draws at its zoom divided by the window's.
 */
export async function assertCanvasKeepsItsSizeAtAWindowZoom(page) {
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	const read = () => page.evaluate(() => {
		const card = document.querySelector('.basehalf-canvas-workbench .react-flow__node')?.getBoundingClientRect();
		return {
			ratio: window.devicePixelRatio,
			card: card ? card.width * window.devicePixelRatio : -1,
			control: document.querySelector('.basehalf-canvas-zoom-value')?.textContent?.trim(),
			drawn: Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom'))
		};
	});
	const before = await read();
	if (before.card <= 0 || before.control !== '100%') {
		throw new Error(`Expected a card on the canvas at 100%: ${JSON.stringify(before)}`);
	}
	await withWorkspaceSettings(page, { 'window.zoomLevel': 1 }, async () => {
		const zoomed = await waitForReading(read, reading => Math.abs(reading.ratio / before.ratio - 1.2) < 0.01 && Math.abs(reading.drawn - 0.833333) < 0.000001, 'the window at 120% and the canvas drawn at 100% / 1.2');
		if (Math.abs(zoomed.card - before.card) > 1 || zoomed.control !== before.control) {
			throw new Error(`At a window's zoom of 120% the card should keep its size on the screen and the zoom control its percentage: ${JSON.stringify({ before, zoomed })}`);
		}
	});
	const back = await waitForReading(read, reading => Math.abs(reading.ratio - before.ratio) < 0.01 && reading.drawn === 1, 'the window back at 100% and the canvas drawn at 100%');
	if (Math.abs(back.card - before.card) > 1 || back.control !== before.control) {
		throw new Error(`Back at a window's zoom of 100% the card should have its size: ${JSON.stringify({ before, back })}`);
	}
}

// Canvas selection and arrangement, criteria 39, 40, and 42 (D144): the magnet
// and the setting Snap to Cards are one value, and the magnet on and off
// differ to the eye.
export async function assertCanvasMagnetIsItsSetting(page) {
	const magnet = page.locator('.basehalf-canvas-snap-toggle:visible');
	const userSettings = path.join(userDataDir, 'User', 'settings.json');
	const inUserSettings = () => JSON.parse(fs.readFileSync(userSettings, 'utf8'))['basehalf.canvas.snap'];
	const look = () => magnet.evaluate(button => {
		const style = getComputedStyle(button);
		return { pressed: button.getAttribute('aria-pressed'), name: button.getAttribute('aria-label'), color: style.color, background: style.backgroundColor };
	});
	// The pointer away from it: its ground under the pointer is the ground of every button there.
	const away = await emptyCanvasPoint(page);
	await page.mouse.move(away.x, away.y);
	// A color of the button changes over 100 ms.
	await page.waitForTimeout(250);
	const on = await look();
	if (on.pressed !== 'true' || on.name !== 'Snap to Cards' || inUserSettings() !== undefined) {
		throw new Error(`The magnet starts on, as its setting, and is named Snap to Cards: ${JSON.stringify({ on, setting: inUserSettings() })}`);
	}
	// A click turns it off in the same task, and the setting is in the user's settings file within a second.
	const atTheClick = await magnet.evaluate(button => {
		button.click();
		return button.getAttribute('aria-pressed');
	});
	await waitUntil(() => inUserSettings() === false, 'the click on the magnet to write basehalf.canvas.snap into the user\'s settings', 5_000);
	await page.mouse.move(away.x, away.y);
	await page.waitForTimeout(250);
	const off = await look();
	if (atTheClick !== 'false' || off.pressed !== 'false' || (off.color === on.color && off.background === on.background)) {
		throw new Error(`The magnet off must show at once and look other than on: ${JSON.stringify({ atTheClick, on, off })}`);
	}
	// The setting changed in a settings file changes the magnet: the workspace's wins over the user's.
	await withWorkspaceSettings(page, { 'basehalf.canvas.snap': true }, async () => {
		await waitForReading(look, seen => seen.pressed === 'true', 'the magnet to follow the setting that a settings file turned on');
	});
	await waitForReading(look, seen => seen.pressed === 'false', 'the magnet to follow the setting put back');
	// A second click turns it on, and a value equal to the default is written as no value.
	await magnet.click();
	await waitUntil(() => inUserSettings() === undefined, 'the second click on the magnet to take basehalf.canvas.snap out of the user\'s settings', 5_000);
	if ((await look()).pressed !== 'true') {
		throw new Error('The magnet did not turn on again');
	}
	await page.mouse.move(away.x, away.y);
}

// Workbench appearance, criteria B1, B4, and B5 (D144): the canvas draws
// lines, dots, or nothing behind its cards as the setting says, without a
// reload, and the dots are 2 screen pixels across and 40 to 80 apart.
export async function assertCanvasBackgroundFollowsItsSetting(page) {
	const drawn = () => page.evaluate(() => {
		const dots = document.querySelector('[data-testid="canvas-background-dots"]');
		return {
			lines: document.querySelector('.basehalf-canvas-cards .react-flow__background') !== null,
			dots: dots instanceof HTMLCanvasElement ? { gap: Number(dots.dataset.basehalfDotGap), between: Number(dots.dataset.basehalfDotsBetween) } : null
		};
	});
	// The pixels of the dots as they are drawn: the boxes of the lit pixels that touch, and how strong each is.
	const dotShapes = () => page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="canvas-background-dots"]');
		if (!(canvas instanceof HTMLCanvasElement)) {
			return null;
		}
		const { width, height } = canvas;
		const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
		const lit = (x, y) => data[(y * width + x) * 4 + 3];
		const seen = new Uint8Array(width * height);
		const shapes = new Set();
		let dots = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (lit(x, y) === 0 || seen[y * width + x]) {
					continue;
				}
				// One dot: the lit pixels that touch, its box, and its strongest pixel.
				let left = x, right = x, top = y, bottom = y, strongest = 0;
				const next = [[x, y]];
				seen[y * width + x] = 1;
				while (next.length) {
					const [atX, atY] = next.pop();
					strongest = Math.max(strongest, lit(atX, atY));
					left = Math.min(left, atX);
					right = Math.max(right, atX);
					top = Math.min(top, atY);
					bottom = Math.max(bottom, atY);
					for (const [besideX, besideY] of [[atX + 1, atY], [atX - 1, atY], [atX, atY + 1], [atX, atY - 1]]) {
						if (besideX >= 0 && besideY >= 0 && besideX < width && besideY < height && !seen[besideY * width + besideX] && lit(besideX, besideY) !== 0) {
							seen[besideY * width + besideX] = 1;
							next.push([besideX, besideY]);
						}
					}
				}
				// A dot that the edge of the drawing cuts is not whole.
				if (left === 0 || top === 0 || right === width - 1 || bottom === height - 1) {
					continue;
				}
				dots++;
				shapes.add(`${(right - left + 1) / devicePixelRatio}x${(bottom - top + 1) / devicePixelRatio} at ${strongest}`);
			}
		}
		return { dots, shapes: [...shapes].sort() };
	});
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	const lines = await drawn();
	if (!lines.lines || lines.dots) {
		throw new Error(`The canvas draws lines behind its cards unless the setting says otherwise: ${JSON.stringify(lines)}`);
	}
	await withWorkspaceSettings(page, { 'basehalf.canvas.background': 'dots' }, async () => {
		const whole = await waitForReading(drawn, seen => !seen.lines && seen.dots !== null, 'the canvas to draw dots as the setting says');
		const shapes = await dotShapes();
		// At 100% the dots are 40 flow pixels apart with none between, each 2 screen pixels across and alike.
		if (whole.dots.gap !== 40 || whole.dots.between !== 0 || !shapes || shapes.dots < 4 || shapes.shapes.length !== 1 || !shapes.shapes[0].startsWith('2x2 ')) {
			throw new Error(`At 100% the dots are 40 pixels apart, 2 pixels across, and alike: ${JSON.stringify({ whole, shapes })}`);
		}
		// At 150% they are 60 screen pixels apart, with a fainter dot halfway.
		await setCanvasZoomPercent(page, 150);
		const between = await waitForReading(drawn, seen => seen.dots?.gap === 40 && Math.abs(seen.dots.between - 0.5) < 0.001, 'the dots between to show half at 150%');
		const betweenShapes = await dotShapes();
		if (!betweenShapes || betweenShapes.shapes.length !== 2 || betweenShapes.shapes.some(shape => !shape.startsWith('2x2 '))) {
			throw new Error(`At 150% whole dots and fainter dots between them are drawn, each 2 pixels across: ${JSON.stringify({ between, betweenShapes })}`);
		}
		await zoomCanvas(page, 'reset');
		await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	});
	await withWorkspaceSettings(page, { 'basehalf.canvas.background': 'plain' }, async () => {
		await waitForReading(drawn, seen => !seen.lines && seen.dots === null, 'the canvas to draw nothing behind its cards as the setting says');
	});
	await waitForReading(drawn, seen => seen.lines && seen.dots === null, 'the canvas to draw lines again once the setting is put back');
}

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
		// The card of a note shows no caption (note title): README is taken by
		// its face, at the middle of its upper edge (`canvasCardGrip`).
		const readmeRect = readmeCard.getBoundingClientRect();
		const rootRect = root.getBoundingClientRect();
		const zoom = Number(root.getAttribute('data-zoom')) || 1;
		const targetDraftX = docsMatrix.m41 + 3;
		const startX = readmeRect.left + readmeRect.width / 2;
		const startY = readmeRect.top + Math.min(14, readmeRect.height / 2);
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
	// A card taken by its face starts to move once the press has gone a few
	// pixels, so it stands that far behind the pointer: the pointer goes on
	// until the card's left edge is where the drag was aimed.
	const behind = await page.evaluate(draftX => {
		const node = document.querySelector('.react-flow__node[data-id="README.md"]');
		return node ? draftX - new DOMMatrixReadOnly(getComputedStyle(node).transform).m41 : 0;
	}, geometry.draftX);
	const heldX = geometry.endX + behind * geometry.zoom;
	await page.mouse.move(heldX, geometry.endY, { steps: 2 });
	// docs is a folder, and README let go on its card would go into it
	// (dropping into a folder): README goes down along docs' axis, off it.
	await movePointerOffFolders(page, heldX, geometry.endY);
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
	// By its face, as above. Nothing snaps a card that a folder takes
	// (dropping into a folder, D92), and README was let go off the folders:
	// should a folder lie under the pointer all the same, README goes down
	// along the axis, off it.
	const toggleDrag = await canvasCardGrip(page, 'README.md');
	const toggleDragStartX = toggleDrag.x;
	const toggleDragStartY = toggleDrag.y;
	await page.mouse.move(toggleDragStartX, toggleDragStartY);
	await page.mouse.down();
	await page.mouse.move(toggleDragStartX + 30, toggleDragStartY, { steps: 8 });
	await page.mouse.move(toggleDragStartX + 3 * geometry.zoom, toggleDragStartY, { steps: 8 });
	await movePointerOffFolders(page, toggleDragStartX + 3 * geometry.zoom, toggleDragStartY);
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length > 0, null, { timeout: 10_000 });
	// A programmatic click lets the fixed viewport control change state while
	// React Flow still owns the pointer gesture.
	await snapToggle.evaluate(button => button.click());
	if (await snapToggle.getAttribute('aria-pressed') !== 'false') {
		throw new Error('Canvas snap toggle did not disable snapping during an active drag');
	}
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length === 0, null, { timeout: 10_000 });
	await movePointerOffFolders(page, toggleDragStartX + 3 * geometry.zoom, toggleDragStartY);
	await page.mouse.up();
	await snapToggle.click();
	if (await snapToggle.getAttribute('aria-pressed') !== 'true') {
		throw new Error('Canvas snap toggle did not restore snapping after clearing the active guide');
	}
}
