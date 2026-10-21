/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Selecting cards: the marquee, and the set with its box, moving it, arranging it, and undo.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, openRootCanvas, readCanvasCardGeometry } from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';

// Canvas card placement: every card has a saved place. A folder that was never
// shown is drawn as the plain grid, and that drawing saves a row for each card.
// A file that is added afterwards goes to the end, no card that was there moves
// in any frame, a card the user drags is saved where it was dropped, and git
// shows none of the places.
// Canvas selection and arrangement (docs/specs/canvas-selection-and-arrangement.md):
// a marquee, the set of two cards and its box, moving and arranging the set,
// and Tidy Canvas with its question. Every pointer action is a real one.
export async function assertCanvasSelectionAndArrangement(page) {
	const folderName = 'arranged';
	const names = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];
	const mirror = (...segments) => path.join(workspacePath, '.bh', 'mirror', ...segments);
	const layoutPath = mirror(folderName, 'canvas.yaml');
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}/${name}"]`);
	const rowsOf = () => {
		const raw = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : '';
		return Object.fromEntries(names.map(name => {
			const row = readCanvasCardGeometry(raw, `${folderName}/${name}`);
			return [name, row ? [row.x, row.y] : undefined];
		}));
	};
	const chosenRows = () => {
		const raw = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : '';
		return names.filter(name => new RegExp(`- path: "${folderName}/${name.replace(/[.]/g, '\\.')}"\\n(?: {4}.*\\n)*? {4}auto: true`).test(raw));
	};
	const same = (first, second) => JSON.stringify(first) === JSON.stringify(second);
	const rectOf = async name => {
		const box = await card(name).boundingBox();
		if (!box) {
			throw new Error(`The card of ${name} is not drawn.`);
		}
		return box;
	};
	const centreOf = async name => {
		const box = await rectOf(name);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	const readState = () => page.evaluate(prefix => {
		const box = document.querySelector('.basehalf-canvas-set-box')?.getBoundingClientRect();
		return {
			cards: Array.from(document.querySelectorAll('.basehalf-canvas-card.selected'))
				.map(element => element instanceof HTMLElement ? (element.dataset.basehalfCardPath ?? '').slice(prefix.length) : '')
				.sort(),
			connections: document.querySelectorAll('.react-flow__edge.selected').length,
			box: box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null,
			count: document.querySelector('.basehalf-canvas-selection-toolbar.for-set')?.getAttribute('data-selected-count') ?? null,
			names: Array.from(document.querySelectorAll('.basehalf-canvas-selection-toolbar.for-set .basehalf-canvas-selection-action-label')).map(element => element.textContent),
			outlines: document.querySelectorAll('.basehalf-canvas-card.marquee-selected').length,
			question: document.querySelectorAll('[data-testid="canvas-tidy-question"]').length
		};
	}, `${folderName}/`);
	const elementAt = point => page.evaluate(({ x, y }) => {
		const element = document.elementFromPoint(x, y);
		return element ? String(element.getAttribute('class') ?? '').split(' ')[0] : '';
	}, point);
	const drag = async (from, to, beforeRelease) => {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let index = 1; index <= 10; index++) {
			await page.mouse.move(from.x + (to.x - from.x) * index / 10, from.y + (to.y - from.y) * index / 10);
			await page.waitForTimeout(16);
		}
		const during = beforeRelease ? await beforeRelease() : undefined;
		await page.mouse.up();
		await page.waitForTimeout(350);
		return during;
	};
	// A marquee from empty canvas below the cards up into the named ones.
	const marquee = async (boxed, beforeRelease) => {
		const rects = await Promise.all(boxed.map(rectOf));
		const all = await Promise.all(names.map(rectOf));
		const bottom = Math.max(...all.map(rect => rect.y + rect.height));
		const from = { x: Math.min(...rects.map(rect => rect.x)) + 24, y: bottom + 40 };
		const to = { x: Math.max(...rects.map(rect => rect.x + rect.width)) - 24, y: Math.min(...rects.map(rect => rect.y + rect.height)) - 30 };
		if (await elementAt(from) !== 'react-flow__pane') {
			throw new Error(`A marquee must begin on empty canvas, but ${JSON.stringify(from)} is on ${await elementAt(from)}.`);
		}
		return drag(from, to, beforeRelease);
	};
	const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
	const expectState = async (expected, what) => {
		const state = await readState();
		const actual = { cards: state.cards, connections: state.connections, box: !!state.box, count: state.count };
		if (!same(actual, expected)) {
			throw new Error(`${what}: ${JSON.stringify({ actual, expected })}`);
		}
		return state;
	};

	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'a.md'), '# A\n\nThe note that the two after it build on.\n', 'utf8');
	for (const name of ['b.md', 'c.md']) {
		fs.writeFileSync(path.join(workspacePath, folderName, name), `---\nupstream:\n  - ${folderName}/a.md\n---\n# ${name}\n\nA note that builds on a.md.\n`, 'utf8');
	}
	for (const name of ['d.md', 'e.md']) {
		fs.writeFileSync(path.join(workspacePath, folderName, name), `# ${name}\n\nA note without a connection.\n`, 'utf8');
	}
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	for (const name of names) {
		await card(name).waitFor({ state: 'visible', timeout: 15_000 });
	}
	await waitUntil(() => names.every(name => rowsOf()[name] !== undefined), 'the first drawing of the folder to save a row for every card', 15_000);
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-canvas-edge-path').length >= 2, undefined, { timeout: 15_000 });
	await page.waitForTimeout(1_500);
	const first = rowsOf();
	const [originX, originY] = first['a.md'];
	if (!same(first, { 'a.md': [originX, originY], 'b.md': [originX + 340, originY], 'c.md': [originX + 680, originY], 'd.md': [originX + 1020, originY], 'e.md': [originX + 1360, originY] })) {
		throw new Error(`The five cards must start in one row of the plain grid: ${JSON.stringify(first)}`);
	}

	// A marquee selects the card it touches also when the card has a connection, and one card is one card.
	await marquee(['b.md']);
	await expectState({ cards: ['b.md'], connections: 0, box: false, count: null }, 'A marquee over a card with a connection must select that card and no connection');
	if (await elementAt(await centreOf('b.md')) === 'basehalf-canvas-set-box') {
		throw new Error('One card selected by a marquee must not be under a box.');
	}

	// While a marquee is drawn the cards show the outline and nothing is selected.
	const during = await marquee(['d.md', 'e.md'], readState);
	if (during.outlines !== 2 || during.cards.length !== 0 || during.box) {
		throw new Error(`While a marquee is drawn, the cards in it must show the outline and nothing may be selected yet: ${JSON.stringify(during)}`);
	}
	const set = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'A marquee over two cards must make a set with a box and a toolbar');
	if (set.outlines !== 0) {
		throw new Error('No outline of the marquee may be left after it.');
	}
	// The toolbar of a set says what each of its buttons does, and shows no bare number.
	if (!same(set.names, ['Arrange', 'Duplicate', 'Copy Paths', 'Delete']) || await page.locator('.basehalf-canvas-selection-count').count() !== 0) {
		throw new Error(`The toolbar of a set must name its buttons: ${JSON.stringify(set.names)}`);
	}

	// The box takes the pointer: a click and a double click change nothing.
	const dCentre = await centreOf('d.md');
	const dRect = await rectOf('d.md');
	const eRect = await rectOf('e.md');
	const gap = { x: (dRect.x + dRect.width + eRect.x) / 2, y: dCentre.y };
	const dCaption = { x: dRect.x + 30, y: dRect.y - (dRect.y - set.box.top) / 2 };
	if (await elementAt(dCentre) !== 'basehalf-canvas-set-box' || await elementAt(gap) !== 'basehalf-canvas-set-box' || await elementAt(dCaption) !== 'basehalf-canvas-set-box') {
		throw new Error('The box of a set must be at the pointer over its cards, over their captions, and in its gaps.');
	}
	const circles = await page.evaluate(prefix => ['d.md', 'e.md', 'a.md'].map(name => document.querySelectorAll(`.basehalf-canvas-connect-capture[data-node-id="${prefix}${name}"]`).length), `${folderName}/`);
	if (!same(circles, [0, 0, 4])) {
		throw new Error(`The cards of a set must have no capture circles, and another card its four: ${JSON.stringify(circles)}`);
	}
	await page.mouse.click(dCentre.x, dCentre.y);
	await page.mouse.dblclick(gap.x, gap.y);
	await page.waitForTimeout(400);
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'A click and a double click inside the box must change nothing');
	if (await page.locator('.basehalf-canvas-card[data-note-editing="true"]').count() !== 0 || await page.locator('.basehalf-card-detail.visible').count() !== 0) {
		throw new Error('A double click inside the box must open nothing.');
	}

	// A Shift-click still reaches the card: one card is left, and a second Shift-click makes the set again.
	await page.keyboard.down('Shift');
	await page.mouse.click(dCentre.x, dCentre.y);
	await page.keyboard.up('Shift');
	await page.waitForTimeout(400);
	await expectState({ cards: ['e.md'], connections: 0, box: false, count: null }, 'A Shift-click on one card of a set of two must leave the other as the one selected card');
	await page.keyboard.down('Shift');
	await page.mouse.click(dCentre.x, dCentre.y);
	await page.keyboard.up('Shift');
	await page.waitForTimeout(400);
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'A Shift-click on a second card must make the same set as a marquee');

	// A drag from a gap moves the set, which stays selected, and one undo takes it back.
	await drag(gap, { x: gap.x + 30, y: gap.y + 110 });
	await waitUntil(() => !same(rowsOf()['d.md'], first['d.md']), 'the move of the set to be saved', 10_000);
	const movedRows = rowsOf();
	const delta = name => [movedRows[name][0] - first[name][0], movedRows[name][1] - first[name][1]];
	if (!same(delta('d.md'), delta('e.md')) || delta('d.md')[1] < 60
		|| !same([movedRows['a.md'], movedRows['b.md'], movedRows['c.md']], [first['a.md'], first['b.md'], first['c.md']])) {
		throw new Error(`A drag from a gap of the box must move the cards of the set by the same amount and no other card: ${JSON.stringify(movedRows)}`);
	}
	const movedState = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After it is moved, a set must still be the selection');
	// The box holds the captions above its cards: its top edge is above the cards by the caption.
	const boxIsAround = (box, rect) => !!box && Math.abs(box.left - rect.x) <= 3 && rect.y - box.top > 5 && rect.y - box.top < 45;
	const movedD = await rectOf('d.md');
	if (!boxIsAround(movedState.box, movedD)) {
		throw new Error(`After a move the box must be around its cards and their captions: ${JSON.stringify({ box: movedState.box, card: movedD })}`);
	}
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first), 'undo to put the set back', 10_000);
	await page.waitForTimeout(600);
	const undoneState = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After undo of a move the set must still be the selection');
	const undoneD = await rectOf('d.md');
	if (!boxIsAround(undoneState.box, undoneD)) {
		throw new Error(`After undo the box must be around its cards and their captions: ${JSON.stringify({ box: undoneState.box, card: undoneD })}`);
	}

	// Escape during a move puts the set back and saves nothing.
	const gapNow = async () => {
		const left = await rectOf('d.md');
		const right = await rectOf('e.md');
		return { x: (left.x + left.width + right.x) / 2, y: left.y + left.height / 2 };
	};
	const escapeFrom = await gapNow();
	await drag(escapeFrom, { x: escapeFrom.x + 50, y: escapeFrom.y + 90 }, async () => {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
	});
	await page.waitForTimeout(600);
	if (!same(rowsOf(), first)) {
		throw new Error(`Escape during a move must save nothing: ${JSON.stringify(rowsOf())}`);
	}
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After Escape during a move the set must still be the selection');

	// Arrange: a column from the corner of the box, and one undo.
	await page.locator('.basehalf-canvas-selection-toolbar [data-toolbar-item="arrange"]').click();
	await page.locator('.basehalf-canvas-arrange-menu-item[data-arrangement="column"]').click();
	const column = { ...first, 'e.md': [first['d.md'][0], first['d.md'][1] + 280] };
	await waitUntil(() => same(rowsOf(), column), 'Arrange to put the set in a column and to move no other card', 10_000);
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After Arrange the set must still be the selection');
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first) && chosenRows().length === names.length, 'one undo to take the arrangement back', 10_000);

	// Tidy Canvas moves every card, keeps the selection, and asks.
	const tidied = {
		'a.md': [originX, originY + 140],
		'b.md': [originX + 420, originY],
		'c.md': [originX + 420, originY + 280],
		'd.md': [originX + 840, originY],
		'e.md': [originX + 1180, originY]
	};
	await page.locator('[data-testid="canvas-tidy"]').click();
	await waitUntil(() => same(rowsOf(), tidied), 'Tidy Canvas to lay out the canvas along its connections', 10_000);
	await page.waitForTimeout(900);
	const asked = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'Tidy Canvas must leave the selection as it is');
	if (asked.question !== 1) {
		throw new Error('After a tidy that moved a card, the question must be asked.');
	}
	const aRect = await rectOf('a.md');
	const bRect = await rectOf('b.md');
	if (aRect.x + aRect.width >= bRect.x) {
		throw new Error('After a tidy, a connection must run from left to right.');
	}

	// The question does not block the canvas, and Revert puts every card back, also one moved since.
	const eCentre = await centreOf('e.md');
	const eNow = await rectOf('e.md');
	const empty = { x: eCentre.x, y: eNow.y + eNow.height + 70 };
	if (await elementAt(empty) !== 'react-flow__pane') {
		throw new Error(`The point below e.md must be empty canvas, but it is on ${await elementAt(empty)}.`);
	}
	await page.mouse.click(empty.x, empty.y);
	await page.waitForTimeout(400);
	await drag(eCentre, { x: eCentre.x - 40, y: eCentre.y + 150 });
	await waitUntil(() => !same(rowsOf()['e.md'], tidied['e.md']), 'a card to be moved while the question is open', 10_000);
	if ((await readState()).question !== 1) {
		throw new Error('The question must stay open while a card is moved.');
	}
	await page.locator('[data-testid="canvas-tidy-revert"]').click();
	await waitUntil(() => same(rowsOf(), first) && chosenRows().length === names.length, 'Revert to put every card back and to give every row back as it was', 10_000);
	await page.waitForTimeout(600);
	if ((await readState()).question !== 0) {
		throw new Error('Revert must close the question.');
	}

	// Undo of a tidy closes the question. Keep closes it and changes no place.
	await page.locator('[data-testid="canvas-tidy"]').click();
	await waitUntil(() => same(rowsOf(), tidied), 'a second tidy', 10_000);
	await page.waitForTimeout(900);
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first), 'undo to take the tidy back', 10_000);
	await page.waitForTimeout(600);
	if ((await readState()).question !== 0) {
		throw new Error('Undo of a tidy must close the question.');
	}
	await page.locator('[data-testid="canvas-tidy"]').click();
	await waitUntil(() => same(rowsOf(), tidied), 'a third tidy', 10_000);
	await page.waitForTimeout(900);
	await page.locator('[data-testid="canvas-tidy-keep"]').click();
	await page.waitForTimeout(400);
	if ((await readState()).question !== 0 || !same(rowsOf(), tidied)) {
		throw new Error(`Keep must close the question and change no place: ${JSON.stringify(rowsOf())}`);
	}
	// Keep leaves the focus on the canvas: undo works without a click, and so does the key of Tidy Canvas.
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first), 'undo, right after Keep, to take the tidy back', 10_000);
	await page.keyboard.press('Shift+Alt+KeyF');
	await waitUntil(() => same(rowsOf(), tidied), 'Shift+Alt+F to tidy the canvas', 10_000);
	await page.waitForTimeout(900);
	await page.locator('[data-testid="canvas-tidy-keep"]').click();
	await page.waitForTimeout(400);
	// A tidied canvas: nothing moves and nothing is asked.
	await page.locator('[data-testid="canvas-tidy"]').click();
	await page.waitForTimeout(1_500);
	if ((await readState()).question !== 0 || !same(rowsOf(), tidied)) {
		throw new Error(`Tidying a tidied canvas must move no card and ask nothing: ${JSON.stringify(rowsOf())}`);
	}

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(mirror(folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}
