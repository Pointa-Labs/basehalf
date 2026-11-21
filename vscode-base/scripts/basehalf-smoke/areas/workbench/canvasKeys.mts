/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The keys of the canvas are commands (docs/specs/canvas-keys.md): Keyboard Shortcuts lists them and no
// command of what BaseHalf does not have, and a key given to one in the key bindings file acts at once.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { userDataDir } from '../../context.mts';
import { emptyCanvasPoint, openRootCanvas, setCanvasZoomPercent } from '../../lib/canvas.mts';
import { waitForReading } from '../../lib/steps.mts';

const canvasZoom = page => page.evaluate(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')));

export async function assertCanvasKeysAreCommands(page) {
	// By its keys: the Command Palette ranks the default key bindings' file before Keyboard Shortcuts for these words.
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
	const shortcuts = page.locator('.keybindings-editor').first();
	await shortcuts.waitFor({ state: 'visible', timeout: 20_000 });
	const search = shortcuts.locator('.keybindings-header .monaco-inputbox input').first();
	const rowsFor = async query => {
		await search.fill(query);
		return waitForReading(
			async () => ({
				query: await search.inputValue(),
				rows: await shortcuts.locator('.monaco-list-row').evaluateAll(rows => rows.map(row => row.getAttribute('aria-label') ?? row.textContent ?? ''))
			}),
			read => read.query === query, `Keyboard Shortcuts to search for ${query}`, 15_000
		).then(async () => {
			// The list follows the search after a delay of its own.
			await page.waitForTimeout(800);
			return shortcuts.locator('.monaco-list-row').evaluateAll(rows => rows.map(row => row.getAttribute('aria-label') ?? row.textContent ?? ''));
		});
	};
	for (const name of ['Zoom Canvas In', 'Tidy Canvas', 'Move Card Left', 'Duplicate Selected Cards', 'Delete Selected Cards or Connections', 'Rename Card', 'Open Card', 'Select Card', 'Focus Card Toolbar']) {
		const rows = await rowsFor(`BaseHalf: ${name}`);
		if (!rows.some(row => row.includes(`BaseHalf: ${name}`))) {
			throw new Error(`Keyboard Shortcuts must list the command of the canvas ${name}: ${JSON.stringify(rows.slice(0, 5))}`);
		}
	}
	for (const [query, name] of [['Accept Inline', /Accept Inline (Completion|Suggestion)/], ['inlineSuggest', /inlineSuggest/], ['workbench.extensions.action.installExtensions', /installExtensions/], ['variables.collapse', /variables\.collapse/]]) {
		const rows = await rowsFor(query);
		if (rows.some(row => name.test(row))) {
			throw new Error(`Keyboard Shortcuts must list no command of what BaseHalf does not have, but lists for ${query}: ${JSON.stringify(rows.filter(row => name.test(row)).slice(0, 3))}`);
		}
	}
	// A user has Keyboard Shortcuts in the overlay, where Escape closes it. The base keeps it out of the overlay
	// while its smoke driver runs, as it does its Settings editor: there it is closed as an editor is.
	await search.fill('');
	if (await shortcuts.evaluate(element => !!element.closest('.modal-editor-part'))) {
		await page.keyboard.press('Escape');
	} else {
		await shortcuts.locator('.monaco-list').first().click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
	}
	await shortcuts.waitFor({ state: 'hidden', timeout: 15_000 });

	// A key given to a command of the canvas acts at once, where the command's key acts, and is free again when it is taken away.
	const file = path.join(userDataDir, 'User', 'keybindings.json');
	const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
	await openRootCanvas(page);
	const pressOnCanvas = async () => {
		await setCanvasZoomPercent(page, 100);
		const point = await emptyCanvasPoint(page);
		await page.mouse.click(point.x, point.y);
		await page.keyboard.press('Alt+KeyZ');
		await page.waitForTimeout(600);
		return canvasZoom(page);
	};
	try {
		if (await pressOnCanvas() !== 1) {
			throw new Error('Alt+Z must do nothing on the canvas before a command has it');
		}
		fs.writeFileSync(file, JSON.stringify([{ key: 'alt+z', command: 'basehalf.canvas.zoomIn', when: 'basehalfCanvasFocus' }], null, '\t'));
		await waitForReading(pressOnCanvas, zoom => zoom > 1, 'the key given to Zoom Canvas In to zoom the canvas', 20_000);
	} finally {
		if (before === undefined) {
			fs.rmSync(file, { force: true });
		} else {
			fs.writeFileSync(file, before);
		}
	}
	await waitForReading(pressOnCanvas, zoom => zoom === 1, 'the key taken from Zoom Canvas In to be free again', 20_000);
}
