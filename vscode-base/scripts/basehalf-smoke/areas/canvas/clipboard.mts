/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Copy, paste, and drop (D104): the keys of the clipboard on the canvas.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { app, workspacePath } from '../../context.mts';
import { waitForCanvasCardSelection } from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';

/**
 * Criteria 1, 3, 6, and 14 of copy, paste, and drop: Command-C on a selected
 * card writes its file, its path as text, and BaseHalf's record in one write;
 * Command-V on the canvas makes a copy, and one undo takes it away; text
 * pasted on the canvas becomes a note; Command-C in a field copies text, not
 * the card. The step writes the system clipboard, so it runs only while the
 * clipboard holds text alone, which it puts back, or where the clipboard is
 * the run's own (CI, or BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE=1).
 */
export async function assertCanvasCopyPasteKeys(page) {
	const allowOverwrite = process.env.CI === 'true' || process.env.CI === '1' || process.env.BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE === '1';
	const state = await app.evaluate(({ clipboard }, allowOverwrite) => {
		const textOnly = clipboard.availableFormats().every(format => format.toLowerCase().startsWith('text/plain'));
		return textOnly || allowOverwrite ? { exercised: true, previousText: clipboard.readText() } : { exercised: false, previousText: '' };
	}, allowOverwrite);
	if (!state.exercised || process.platform !== 'darwin') {
		console.error('[basehalf-smoke] skip canvas copy and paste keys: preserving non-text clipboard formats');
		return;
	}
	const undo = 'Meta+Z';
	const exists = (name: string) => fs.existsSync(path.join(workspacePath, name));
	const readClipboard = () => app.evaluate(({ clipboard }) => ({
		record: clipboard.readBuffer('com.pointalabs.basehalf.items').toString(),
		file: clipboard.read('public.file-url'),
		text: clipboard.readText()
	}));
	try {
		const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		await page.keyboard.press('Escape');
		await readme.click();
		await waitForCanvasCardSelection(page, 'README.md');
		await page.keyboard.press('Meta+C');
		let copied = await readClipboard();
		await waitUntil(async () => (copied = await readClipboard()).record.includes('README.md'), 'Command-C on the README card to write the clipboard', 10_000);
		if (!copied.file.endsWith('/README.md') || copied.text !== 'README.md') {
			throw new Error(`Command-C must write the card's file and its path as text with BaseHalf's record: ${JSON.stringify(copied)}`);
		}

		await page.keyboard.press('Meta+V');
		await waitUntil(() => exists('README copy.md'), 'Command-V on the canvas to copy README.md', 15_000);
		await waitForCanvasCardSelection(page, 'README copy.md');
		await page.keyboard.press(undo);
		await waitUntil(() => !exists('README copy.md'), 'one undo to take the pasted copy away', 15_000);

		const words = `Pasted by the smoke ${Date.now()}`;
		await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), words);
		await readme.click();
		await page.keyboard.press('Meta+V');
		await waitUntil(() => exists('untitled.md') && fs.readFileSync(path.join(workspacePath, 'untitled.md'), 'utf8') === words, 'text pasted on the canvas to become untitled.md', 15_000);
		await waitForCanvasCardSelection(page, 'untitled.md');
		await page.keyboard.press(undo);
		await waitUntil(() => !exists('untitled.md'), 'one undo to take the pasted note away', 15_000);

		// In a field the window's own copy runs: the rename editor copies its text.
		await readme.focus();
		await page.keyboard.press('F2');
		const field = readme.locator('.basehalf-canvas-inline-name-input input');
		await field.waitFor({ state: 'visible', timeout: 10_000 });
		await page.keyboard.press('Meta+A');
		await page.keyboard.press('Meta+C');
		await waitUntil(async () => (await readClipboard()).text === 'README', 'Command-C in the rename editor to copy its text', 10_000);
		if ((await readClipboard()).record) {
			throw new Error('Command-C in a field must copy its text, not the card');
		}
		await page.keyboard.press('Escape');
	} finally {
		await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), state.previousText);
	}
}
