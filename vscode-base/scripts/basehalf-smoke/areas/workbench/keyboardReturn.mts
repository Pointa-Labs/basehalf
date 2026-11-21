/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The keyboard is always somewhere that answers (docs/specs/keyboard-return.md): after Settings closes over
// a selected card, after Escape ends the editing of a note on its card, and after the card that had the
// keyboard is deleted, the keyboard is on the card or on the canvas, and the zoom key zooms the canvas.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { workspacePath } from '../../context.mts';
import { canvasCardGrip, openRootCanvas, waitForCanvasCardSelection, waitForCanvasNoteInlineEditor } from '../../lib/canvas.mts';
import { runCommand } from '../../lib/quickInput.mts';
import { waitForReading } from '../../lib/steps.mts';

const NOTE = 'keyboard-return.md';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** What has the keyboard: the card it is, the canvas itself, or the element in words. */
const keyboardOn = page => page.evaluate(() => {
	const active = document.activeElement;
	if (!active || active === document.body) {
		return { where: 'the page itself' };
	}
	if (active instanceof HTMLElement && active.classList.contains('basehalf-canvas-card')) {
		return { where: 'card', card: active.dataset.basehalfCardPath, selected: active.closest('.react-flow__node')?.classList.contains('selected') === true };
	}
	if (active.classList.contains('basehalf-canvas-cards')) {
		return { where: 'canvas' };
	}
	return { where: `${active.tagName.toLowerCase()}.${[...active.classList].join('.')}` };
});

const zooms = page => page.evaluate(() => ({
	canvas: Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')),
	window: window.innerWidth
}));

/** The zoom key zooms the canvas and not the window, and the key that zooms out takes it back. */
async function assertZoomKeyZoomsTheCanvas(page, after) {
	const before = await zooms(page);
	await page.keyboard.press(`${mod}+Equal`);
	const zoomed = await waitForReading(() => zooms(page), now => now.canvas !== before.canvas || now.window !== before.window, `the zoom key to zoom something ${after}`, 10_000);
	if (zoomed.canvas <= before.canvas || zoomed.window !== before.window) {
		throw new Error(`The zoom key must zoom the canvas ${after}, and not the window: ${JSON.stringify({ before, zoomed })}`);
	}
	await page.keyboard.press(`${mod}+Minus`);
	await waitForReading(() => zooms(page), now => now.canvas === before.canvas, `the canvas to have its zoom again ${after}`, 10_000);
}

export async function assertKeyboardReturnsToCanvas(page) {
	await openRootCanvas(page);
	fs.writeFileSync(path.join(workspacePath, NOTE), '# Keyboard return\n\nA note of this step.\n', 'utf8');
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${NOTE}"]`).first();
	await card.waitFor({ state: 'visible', timeout: 20_000 });
	// Every card in view, the note of this step among them.
	await runCommand(page, 'BaseHalf: Fit Canvas to Screen');
	await page.waitForTimeout(600);
	const grip = await canvasCardGrip(page, NOTE);
	const onTop = await page.evaluate(({ x, y, wanted }) => document.elementFromPoint(x, y)?.closest('.basehalf-canvas-card')?.getAttribute('data-basehalf-card-path') === wanted, { ...grip, wanted: NOTE });
	if (!onTop) {
		throw new Error(`The card of ${NOTE} must be in view and uncovered to be pressed: ${JSON.stringify(grip)}`);
	}
	await page.mouse.click(grip.x, grip.y);
	await waitForCanvasCardSelection(page, NOTE);
	const onTheCard = at => at.where === 'card' && at.card === NOTE;

	// Settings closes over the selected card: the card has the keyboard again, and stays selected.
	await page.keyboard.press(`${mod}+Comma`);
	const settings = page.locator('.basehalf-settings').first();
	await settings.waitFor({ state: 'visible', timeout: 20_000 });
	await page.keyboard.press('Escape');
	await settings.waitFor({ state: 'hidden', timeout: 15_000 });
	const afterSettings = await waitForReading(() => keyboardOn(page), onTheCard, 'the card to have the keyboard after Settings closes', 10_000);
	if (!afterSettings.selected) {
		throw new Error(`The card must stay selected after Settings closes over it: ${JSON.stringify(afterSettings)}`);
	}
	await assertZoomKeyZoomsTheCanvas(page, 'after Settings closes');

	// Escape ends the editing of the note on its card: the card has the keyboard, not the page itself.
	await page.keyboard.press('Enter');
	await waitForCanvasNoteInlineEditor(page, NOTE);
	await page.keyboard.press('Escape');
	await waitForReading(() => keyboardOn(page), onTheCard, 'the card to have the keyboard after Escape ends the editing of its note', 10_000);
	await assertZoomKeyZoomsTheCanvas(page, 'after the editing of a note ends');

	// The card that has the keyboard is deleted: the canvas itself takes the keyboard.
	await waitForCanvasCardSelection(page, NOTE);
	await page.keyboard.press('Delete');
	await card.waitFor({ state: 'detached', timeout: 15_000 });
	await waitForReading(() => keyboardOn(page), at => at.where === 'canvas', 'the canvas to have the keyboard after the card that had it is deleted', 10_000);
	await assertZoomKeyZoomsTheCanvas(page, 'after a card is deleted');
}
