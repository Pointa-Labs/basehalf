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
import { showExplorer } from '../../lib/workspace.mts';

const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
const NOTE = 'undo-note.md';
const BIG = 'undo-big.bin';
const BOX = 'undo-box';
const DRAFT = 'undo-draft.png';
const CARDS = [NOTE, BIG, BOX, DRAFT];
const FOLLOWED = 'files-follow.md';

const at = name => path.join(workspacePath, ...name.split('/'));
const mirror = (name, file) => path.join(workspacePath, '.bh', 'mirror', ...name.split('/'), file);
const layout = () => fs.readFileSync(path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml'), 'utf8');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const text = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
const orders = names => names.length <= 1 ? [names] : names.flatMap((first, index) => orders([...names.slice(0, index), ...names.slice(index + 1)]).map(rest => [first, ...rest]));

/** Gives the keyboard to the canvas, so that Undo and Redo are the canvas's. */
async function keyboardOnCanvas(page) {
	await page.locator('.basehalf-canvas-cards').focus();
	await page.waitForFunction(() => document.activeElement?.closest('.basehalf-canvas-cards') !== null, null, { timeout: 10_000 });
}

/**
 * Selects the cards of `names` with a click on the first and a click with
 * Shift on each next one. Each card is brought to the middle of the view
 * first, as cards far apart do not fit into it, and is clicked at a point
 * that nothing lies over, such as the set box of the cards selected before
 * it. The orders that select the last name last come first: a draft selected
 * alone shows its panel, which can lie over other cards.
 */
async function selectCanvasCards(page, names) {
	const tried = orders(names).sort((a, b) => Number(a.at(-1) !== names.at(-1)) - Number(b.at(-1) !== names.at(-1)));
	for (const order of tried) {
		let selected = 0;
		for (const name of order) {
			await centerCanvasCards(page, [page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`)]);
			const point = await page.evaluate(cardPath => {
				const element = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
				const rect = element?.getBoundingClientRect();
				for (let fy = 0.2; rect && fy < 0.85; fy += 0.15) {
					for (let fx = 0.2; fx < 0.85; fx += 0.15) {
						const x = rect.left + rect.width * fx;
						const y = rect.top + rect.height * fy;
						if (document.elementFromPoint(x, y)?.closest('.basehalf-canvas-card') === element) {
							return { x, y };
						}
					}
				}
				return undefined;
			}, name);
			if (!point) {
				break;
			}
			if (selected > 0) {
				await page.keyboard.down('Shift');
			}
			await page.mouse.click(point.x, point.y);
			if (selected > 0) {
				await page.keyboard.up('Shift');
			}
			await waitForCanvasCardSelection(page, name);
			await page.waitForTimeout(150);
			selected++;
		}
		if (selected === order.length) {
			return;
		}
	}
	throw new Error(`No order selects ${names.join(', ')} with clicks: a card lies under others in each`);
}

/**
 * Exact undo, criteria 1 to 6: Delete in a card's menu, the selection
 * toolbar's Delete, and the Delete key delete at once, with no dialog in any
 * frame. One undo brings back a note with its description, its color, and its
 * place, and a set of a file of 6 MB byte for byte, a folder with the two
 * notes it holds, and a draft with its prompt, deleted in one step; redo
 * deletes the set again, and undo brings it back again. Undo of a New Note
 * into which text was typed takes it away, and redo brings it back with the
 * text at its place.
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
	fs.mkdirSync(path.dirname(mirror(DRAFT, 'generation.yaml')), { recursive: true });
	fs.writeFileSync(mirror(DRAFT, 'generation.yaml'), 'prompt: "Kept with the set"\n', 'utf8');
	for (const name of CARDS) {
		await card(name).waitFor({ state: 'visible', timeout: 15_000 });
	}
	await waitUntil(() => CARDS.every(name => readCanvasCardGeometry(layout(), name) !== undefined), 'the four cards to get their places');
	const now = () => ({
		note: text(at(NOTE)),
		badge: text(mirror(NOTE, 'badge.yaml')),
		appearance: text(mirror(NOTE, 'appearance.yaml')),
		big: fs.existsSync(at(BIG)) ? hash(at(BIG)) : null,
		box: fs.existsSync(at(BOX)) ? fs.readdirSync(at(BOX)).sort() : null,
		draft: text(mirror(DRAFT, 'generation.yaml')),
		rows: Object.fromEntries(CARDS.map(name => [name, readCanvasCardGeometry(layout(), name)]))
	});
	const before = now();
	const setGone = () => !fs.existsSync(at(BIG)) && !fs.existsSync(at(BOX)) && !fs.existsSync(mirror(DRAFT, 'generation.yaml'));
	const assertBack = async what => {
		await waitUntil(() => JSON.stringify(now()) === JSON.stringify(before), what, 15_000).catch(() => {
			throw new Error(`${what}: ${JSON.stringify({ before, now: now() })}`);
		});
		for (const name of CARDS) {
			await card(name).waitFor({ state: 'visible', timeout: 15_000 });
		}
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
	await keyboardOnCanvas(page);
	await page.keyboard.press(UNDO);
	await assertBack('one undo to bring the note back with its description, its color, and its place');

	// The Delete key, on a set: the large file, the folder, and the draft, one step.
	await selectCanvasCards(page, [BIG, BOX, DRAFT]);
	await page.keyboard.press('Delete');
	await waitUntil(setGone, 'the Delete key to delete the set at once');
	await keyboardOnCanvas(page);
	await page.keyboard.press(UNDO);
	await assertBack('one undo to bring back the file of 6 MB byte for byte, the folder with its notes, and the draft with its prompt');
	await page.keyboard.press(REDO);
	await waitUntil(setGone, 'redo to delete the set again');
	await page.keyboard.press(UNDO);
	await assertBack('undo after redo to bring the set back again');

	// The selection toolbar's Delete, on the card of a file.
	await centerCanvasCards(page, [card(BIG)]);
	await page.keyboard.press('Escape');
	await card(BIG).click();
	await waitForCanvasCardSelection(page, BIG);
	await page.locator('.basehalf-canvas-selection-action.danger').filter({ visible: true }).first().click();
	await waitUntil(() => !fs.existsSync(at(BIG)), 'the toolbar\'s Delete to delete the file at once');
	await keyboardOnCanvas(page);
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
	await keyboardOnCanvas(page);
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

	for (const name of ['untitled.md', ...CARDS]) {
		await centerCanvasCards(page, [card(name)]);
		await deleteCanvasCardFromItsMenu(page, name);
	}
}

/**
 * Exact undo, criterion 15: Files in the sidebar shows a delete on the
 * canvas, its undo, and its redo together with the canvas. A sampler notes in
 * every frame whether the note's card and its row in Files are there; each
 * time, the row goes or comes back no more than 300 ms from its card. Before,
 * Files waited for the file watcher and then half a second more.
 */
export async function assertFilesFollowCanvasDeletes(page) {
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${FOLLOWED}"]`);
	const label = FOLLOWED.replace(/\.md$/, '');
	fs.writeFileSync(at(FOLLOWED), '# Files follow\n\nA note that Files shows as the canvas does.\n', 'utf8');
	if (!(await page.locator('.explorer-viewlet').isVisible().catch(() => false))) {
		await showExplorer(page);
	}
	await card.waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('.explorer-viewlet .monaco-list-row', { hasText: label }).first().waitFor({ state: 'visible', timeout: 15_000 });
	await page.evaluate(({ cardPath, rowText }) => {
		const watch = { running: true, card: [], row: [] };
		let cardThere;
		let rowThere;
		const tick = () => {
			if (!watch.running) {
				return;
			}
			const time = performance.now();
			const cardNow = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`) !== null;
			const rowNow = Array.from(document.querySelectorAll('.explorer-viewlet .monaco-list-row')).some(row => row.textContent?.includes(rowText));
			if (cardNow !== cardThere) {
				watch.card.push({ time, there: cardNow });
				cardThere = cardNow;
			}
			if (rowNow !== rowThere) {
				watch.row.push({ time, there: rowNow });
				rowThere = rowNow;
			}
			requestAnimationFrame(tick);
		};
		globalThis.basehalfFilesFollow = watch;
		requestAnimationFrame(tick);
	}, { cardPath: FOLLOWED, rowText: label });

	// How long after its card the row in Files went (there: false) or came back (there: true).
	const lagOf = async (what, there, act) => {
		const since = await page.evaluate(() => performance.now());
		await act();
		const seen = await page.waitForFunction(({ since, there }) => {
			const watch = globalThis.basehalfFilesFollow;
			const card = watch.card.find(change => change.time > since && change.there === there);
			const row = watch.row.find(change => change.time > since && change.there === there);
			return card && row ? { card: card.time, row: row.time } : undefined;
		}, { since, there }, { timeout: 15_000 }).catch(async () => {
			throw new Error(`${what}: the card and its row in Files did not both ${there ? 'come back' : 'go'}: ${JSON.stringify(await page.evaluate(() => globalThis.basehalfFilesFollow))}`);
		});
		const { card: cardAt, row: rowAt } = await seen.jsonValue();
		return Math.round(rowAt - cardAt);
	};

	await centerCanvasCards(page, [card]);
	const deleted = await lagOf('A delete on the canvas', false, () => deleteCanvasCardFromItsMenu(page, FOLLOWED));
	await keyboardOnCanvas(page);
	const undone = await lagOf('Undo of the delete', true, () => page.keyboard.press(UNDO));
	const redone = await lagOf('Redo of the delete', false, () => page.keyboard.press(REDO));
	await page.evaluate(() => {
		globalThis.basehalfFilesFollow.running = false;
	});
	const lags = { deleted, undone, redone };
	if (Object.values(lags).some(ms => Math.abs(ms) > 300)) {
		throw new Error(`Files must show a delete on the canvas, its undo, and its redo with the canvas, its row no more than 300 ms from the card (ms the row came after the card): ${JSON.stringify(lags)}`);
	}
	console.log(`[basehalf-smoke] Files followed the canvas within ${JSON.stringify(lags)} ms`);
}
