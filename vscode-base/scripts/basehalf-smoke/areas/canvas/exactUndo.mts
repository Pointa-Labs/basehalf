/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Deleting on the canvas, and undo that brings back exactly what a step took.

import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { centerCanvasCards, deleteCanvasCardFromItsMenu } from './creation.mts';
import { workspacePath } from '../../context.mts';
import { clickCanvasCreateAction, readCanvasCardGeometry, waitForCanvasCardSelection, waitForCanvasNoteInlineEditor } from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';

const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
const NOTE = 'undo-note.md';
const BIG = 'undo-big.bin';
const BOX = 'undo-box';

const at = name => path.join(workspacePath, ...name.split('/'));
const mirror = (name, file) => path.join(workspacePath, '.bh', 'mirror', ...name.split('/'), file);
const layout = () => fs.readFileSync(path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml'), 'utf8');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Exact undo, criteria 1 to 6: Delete in a card's menu, the selection
 * toolbar's Delete, and the Delete key delete at once, with no dialog in any
 * frame. One undo brings back a note with its description, its color, and its
 * place, a file of 6 MB byte for byte, and a folder with the two notes it
 * holds; redo deletes them again, and undo brings them back again. Undo of a
 * New Note into which text was typed takes it away, and redo brings it back
 * with the text at its place.
 */
export async function assertCanvasExactUndo(page) {
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	fs.writeFileSync(at(NOTE), '# Undo\n\nA note that is deleted and comes back.\n', 'utf8');
	fs.mkdirSync(path.dirname(mirror(NOTE, 'badge.yaml')), { recursive: true });
	fs.writeFileSync(mirror(NOTE, 'badge.yaml'), `path: "${NOTE}"\nkind: file\ndescription: "Comes back"\n`, 'utf8');
	fs.writeFileSync(mirror(NOTE, 'appearance.yaml'), 'background: cyan\n', 'utf8');
	fs.writeFileSync(at(BIG), randomBytes(6_000_000));
	fs.mkdirSync(at(BOX), { recursive: true });
	fs.writeFileSync(at(`${BOX}/a.md`), '# A\n', 'utf8');
	fs.writeFileSync(at(`${BOX}/b.md`), '# B\n', 'utf8');
	for (const name of [NOTE, BIG, BOX]) {
		await card(name).waitFor({ state: 'visible', timeout: 15_000 });
	}
	await waitUntil(() => [NOTE, BIG, BOX].every(name => readCanvasCardGeometry(layout(), name) !== undefined), 'the three cards to get their places');
	const before = {
		note: fs.readFileSync(at(NOTE), 'utf8'),
		badge: fs.readFileSync(mirror(NOTE, 'badge.yaml'), 'utf8'),
		appearance: fs.readFileSync(mirror(NOTE, 'appearance.yaml'), 'utf8'),
		big: hash(at(BIG)),
		box: fs.readdirSync(at(BOX)).sort(),
		rows: Object.fromEntries([NOTE, BIG, BOX].map(name => [name, readCanvasCardGeometry(layout(), name)]))
	};
	const now = () => ({
		note: fs.existsSync(at(NOTE)) ? fs.readFileSync(at(NOTE), 'utf8') : null,
		badge: fs.existsSync(mirror(NOTE, 'badge.yaml')) ? fs.readFileSync(mirror(NOTE, 'badge.yaml'), 'utf8') : null,
		appearance: fs.existsSync(mirror(NOTE, 'appearance.yaml')) ? fs.readFileSync(mirror(NOTE, 'appearance.yaml'), 'utf8') : null,
		big: fs.existsSync(at(BIG)) ? hash(at(BIG)) : null,
		box: fs.existsSync(at(BOX)) ? fs.readdirSync(at(BOX)).sort() : null,
		rows: Object.fromEntries([NOTE, BIG, BOX].map(name => [name, readCanvasCardGeometry(layout(), name)]))
	});
	const assertBack = async what => {
		await waitUntil(() => JSON.stringify(now()) === JSON.stringify(before), what, 15_000).catch(() => {
			throw new Error(`${what}: ${JSON.stringify({ before, now: now() })}`);
		});
		for (const name of [NOTE, BIG, BOX]) {
			await card(name).waitFor({ state: 'visible', timeout: 15_000 });
		}
	};
	const keyboardOnCanvas = async () => {
		await page.locator('.basehalf-canvas-cards').focus();
		await page.waitForFunction(() => document.activeElement?.closest('.basehalf-canvas-cards') !== null, null, { timeout: 10_000 });
	};

	// Every frame from here on: a dialog.
	await page.evaluate(() => {
		const watch = { running: true, frames: 0, dialogs: 0 };
		globalThis.basehalfDialogWatch = watch;
		const tick = () => {
			if (!watch.running) {
				return;
			}
			watch.frames++;
			if (document.querySelector('.monaco-dialog-box')) {
				watch.dialogs++;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	// The card's menu.
	await centerCanvasCards(page, [card(NOTE)]);
	await deleteCanvasCardFromItsMenu(page, NOTE);
	if (fs.existsSync(path.dirname(mirror(NOTE, 'badge.yaml'))) || readCanvasCardGeometry(layout(), NOTE) !== undefined) {
		throw new Error('A delete must take the card information and the row of the note with it');
	}
	await keyboardOnCanvas();
	await page.keyboard.press(UNDO);
	await assertBack('one undo to bring the note back with its description, its color, and its place');

	// The Delete key, on a set: the large file and the folder, one step.
	await centerCanvasCards(page, [card(BIG), card(BOX)]);
	await card(BIG).click();
	await card(BOX).click({ modifiers: ['Shift'] });
	await waitForCanvasCardSelection(page, BIG);
	await waitForCanvasCardSelection(page, BOX);
	await page.keyboard.press('Delete');
	await waitUntil(() => !fs.existsSync(at(BIG)) && !fs.existsSync(at(BOX)), 'the Delete key to delete the set at once');
	await keyboardOnCanvas();
	await page.keyboard.press(UNDO);
	await assertBack('one undo to bring back the file of 6 MB byte for byte and the folder with its notes');
	await page.keyboard.press(REDO);
	await waitUntil(() => !fs.existsSync(at(BIG)) && !fs.existsSync(at(BOX)), 'redo to delete the set again');
	await page.keyboard.press(UNDO);
	await assertBack('undo after redo to bring the set back again');

	// The selection toolbar's Delete, on the card of a file.
	await centerCanvasCards(page, [card(BIG)]);
	await page.keyboard.press('Escape');
	await card(BIG).click();
	await waitForCanvasCardSelection(page, BIG);
	await page.locator('.basehalf-canvas-selection-action.danger').filter({ visible: true }).first().click();
	await waitUntil(() => !fs.existsSync(at(BIG)), 'the toolbar\'s Delete to delete the file at once');
	await keyboardOnCanvas();
	await page.keyboard.press(UNDO);
	await assertBack('one undo after the toolbar\'s Delete');

	// New Note with text typed into it: undo takes it away, and redo brings it back with the text.
	await clickCanvasCreateAction(page, 'New Note');
	await waitUntil(() => fs.existsSync(at('untitled.md')), 'New Note to make untitled.md');
	await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await page.keyboard.type('Words typed into a new note');
	// Escape closes the note's editor, which saves what was typed.
	await page.keyboard.press('Escape');
	await waitUntil(() => fs.readFileSync(at('untitled.md'), 'utf8').includes('Words typed into a new note'), 'the typed words to be saved');
	await waitUntil(() => readCanvasCardGeometry(layout(), 'untitled.md') !== undefined, 'the new note to have its place');
	const madeRow = readCanvasCardGeometry(layout(), 'untitled.md');
	const madeText = fs.readFileSync(at('untitled.md'), 'utf8');
	await keyboardOnCanvas();
	await page.keyboard.press(UNDO);
	await waitUntil(() => !fs.existsSync(at('untitled.md')), 'undo to take the new note away with its text');
	await card('untitled.md').waitFor({ state: 'detached', timeout: 10_000 });
	await page.keyboard.press(REDO);
	await waitUntil(() => fs.existsSync(at('untitled.md')) && fs.readFileSync(at('untitled.md'), 'utf8') === madeText, 'redo to bring the new note back with its text');
	await card('untitled.md').waitFor({ state: 'visible', timeout: 10_000 });
	const backRow = readCanvasCardGeometry(layout(), 'untitled.md');
	if (backRow?.x !== madeRow?.x || backRow?.y !== madeRow?.y) {
		throw new Error(`Redo must bring the new note back at its place: ${JSON.stringify({ madeRow, backRow })}`);
	}

	const watch = await page.evaluate(() => {
		const state = globalThis.basehalfDialogWatch;
		state.running = false;
		return { frames: state.frames, dialogs: state.dialogs };
	});
	if (watch.frames < 10 || watch.dialogs !== 0) {
		throw new Error(`No delete and no undo may open a dialog: ${JSON.stringify(watch)}`);
	}

	for (const name of ['untitled.md', NOTE, BIG, BOX]) {
		await centerCanvasCards(page, [card(name)]);
		await deleteCanvasCardFromItsMenu(page, name);
	}
}
