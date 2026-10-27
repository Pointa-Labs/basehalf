/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Dropping into a folder: cards let go on a folder's card or on a folder of the path go into that folder.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, emptyCanvasPoint, openRootCanvas, readCanvasCardGeometry, readCanvasView, zoomCanvas } from '../../lib/canvas.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

// Dropping into a folder (docs/specs/canvas-drop-into-folder.md), criteria 1,
// 3, 5, 6, 7, and 10, and of 11 the size, the yellow, the grown edge, and the
// path, with real pointer drags on a folder of its own: a note let go on a
// folder's card goes into it, in one step of undo and redo, while the folder
// grows and glows yellow and takes it on its grown edge too; a name the folder
// holds is kept beside it, and the note that names it follows; the drag and
// the click right after a drop work; the pointer decides, not the card; a card
// let go over Files goes back, and the view does not move while the pointer is
// outside the canvas; and a card let go on a folder of the path in the title
// bar, which shows the yellow, goes up into it.
export async function assertCanvasDropIntoFolder(page) {
	const folderName = 'dropping';
	const inFolder = (...segments) => path.join(workspacePath, folderName, ...segments);
	const exists = (...segments) => fs.existsSync(inFolder(...segments));
	const mirror = (...segments) => path.join(workspacePath, '.bh', 'mirror', ...segments);
	const cardPath = name => `${folderName}/${name}`;
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath(name)}"]`);
	const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
	const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
	const same = (first, second) => JSON.stringify(first) === JSON.stringify(second);
	const rowOf = name => {
		const layout = mirror(folderName, 'canvas.yaml');
		return readCanvasCardGeometry(fs.existsSync(layout) ? fs.readFileSync(layout, 'utf8') : '', cardPath(name));
	};
	const notes = () => fs.readFileSync(inFolder('notes.md'), 'utf8');
	const namesUpstream = name => new RegExp(`upstream:\\n\\s+- "?${cardPath(name).replace(/[.]/g, '\\.')}"?\\n`).test(notes());
	const rectOf = async name => {
		const box = await card(name).boundingBox();
		if (!box) {
			throw new Error(`The card of ${cardPath(name)} is not drawn.`);
		}
		return box;
	};
	const centreOf = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
	// Where a card is taken to be dragged: its caption, as for every kind of card.
	const grip = async name => {
		const point = await page.evaluate(p => {
			const element = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(p)}"]`);
			const identity = element?.querySelector('.basehalf-canvas-card-caption-identity');
			const box = (identity instanceof HTMLElement ? identity : element)?.getBoundingClientRect();
			return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined;
		}, cardPath(name));
		if (!point) {
			throw new Error(`The card of ${cardPath(name)} has no caption to drag it by.`);
		}
		return point;
	};
	const lookOf = names => page.evaluate(paths => Object.fromEntries(paths.map(p => {
		const element = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(p)}"]`);
		if (!element) {
			return [p, null];
		}
		const style = getComputedStyle(element);
		return [p, { target: element.hasAttribute('data-basehalf-drop-target'), dropping: element.hasAttribute('data-basehalf-dropping'), filter: style.filter, scale: style.scale, border: style.borderTopColor, glow: style.boxShadow }];
	})), names.map(cardPath));
	// The yellow of a folder that takes a drop (D92), as computed styles give it.
	const yellow = 'rgb(240, 197, 76)';
	const glowsYellow = look => look?.border === yellow && /color\(srgb 0\.941176 0\.772549 0\.298039 \/ 0\.38\) 0px 0px 36px 10px/.test(look.glow ?? '');
	const selectedCards = () => page.evaluate(() => document.querySelectorAll('.react-flow__node.selected').length);
	// A drag as the user makes it: the press, a small first move that starts
	// the drag, steps to the end, and what `beforeRelease` reads while the
	// button is still down.
	const drag = async (from, to, beforeRelease) => {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x + 6, from.y + 4, { steps: 2 });
		for (let index = 1; index <= 12; index++) {
			await page.mouse.move(from.x + (to.x - from.x) * index / 12, from.y + (to.y - from.y) * index / 12);
			await page.waitForTimeout(16);
		}
		await page.waitForTimeout(250);
		const during = beforeRelease ? await beforeRelease() : undefined;
		await page.mouse.up();
		await page.waitForTimeout(350);
		return during;
	};
	const pressOnCanvas = async key => {
		await page.locator('.basehalf-canvas-cards').focus();
		await page.keyboard.press(key);
	};
	// Where the file `name` is once the files rest, a second without change:
	// in the box, here, or neither.
	const restingPlaceOf = async name => {
		const placeOf = () => exists('box', name) && !exists(name) ? 'box' : exists(name) && !exists('box', name) ? 'here' : 'neither';
		const started = Date.now();
		let last = placeOf();
		let since = started;
		while (Date.now() - started < 15_000 && (Date.now() - since < 1000 || Date.now() - started < 1500)) {
			await page.waitForTimeout(50);
			const now = placeOf();
			if (now !== last) {
				last = now;
				since = Date.now();
			}
		}
		return last;
	};
	const restingView = () => waitForReading(async () => {
		const first = await readCanvasView(page);
		await page.waitForTimeout(200);
		return [first, await readCanvasView(page)];
	}, ([first, second]) => same(first, second), 'the view of the canvas to rest');
	// What the view does while the pointer is held outside the canvas.
	const viewWhileOutside = async () => {
		const first = await readCanvasView(page);
		await page.waitForTimeout(600);
		return { first, second: await readCanvasView(page) };
	};

	// Two rows of a note, a folder, and a note: a.md, the box, plan.md; b.md,
	// the shelf, notes.md, which names plan.md upstream. The box holds a
	// plan.md of its own, and inner.md.
	const listing = upstream => `---\nupstream:\n  - ${upstream}\n---\n# Notes\n\nA note that builds on the plan.\n`;
	fs.mkdirSync(inFolder('box'), { recursive: true });
	fs.mkdirSync(inFolder('shelf'), { recursive: true });
	fs.writeFileSync(inFolder('a.md'), '# A\n\nA note that goes into the box.\n', 'utf8');
	fs.writeFileSync(inFolder('b.md'), '# B\n\nA note that stays on this canvas.\n', 'utf8');
	fs.writeFileSync(inFolder('plan.md'), '# Plan\n', 'utf8');
	fs.writeFileSync(inFolder('notes.md'), listing(cardPath('plan.md')), 'utf8');
	fs.writeFileSync(inFolder('box', 'plan.md'), '# The older plan\n', 'utf8');
	fs.writeFileSync(inFolder('box', 'inner.md'), '# Inner\n', 'utf8');
	fs.writeFileSync(inFolder('shelf', 'kept.md'), '# Kept\n', 'utf8');
	const row = (name, kind, x, y, width, height) => [`  - path: "${cardPath(name)}"`, `    kind: ${kind}`, `    x: ${x}`, `    y: ${y}`, `    width: ${width}`, `    height: ${height}`];
	const writeLayout = (folder, rows) => {
		fs.mkdirSync(mirror(...folder.split('/')), { recursive: true });
		fs.writeFileSync(mirror(...folder.split('/'), 'canvas.yaml'), [`path: "${folder}"`, 'size:', '  width: 2400', '  height: 1600', 'cards:', ...rows.flat(), 'edges: []', ''].join('\n'), 'utf8');
	};
	writeLayout(folderName, [
		row('a.md', 'file', 0, 0, 300, 220), row('box', 'folder', 360, 0, 248, 188), row('plan.md', 'file', 680, 0, 300, 220),
		row('b.md', 'file', 0, 320, 300, 220), row('shelf', 'folder', 360, 320, 248, 188), row('notes.md', 'file', 680, 320, 300, 220)
	]);
	writeLayout(`${folderName}/box`, [row('box/plan.md', 'file', 0, 0, 300, 220), row('box/inner.md', 'file', 360, 0, 300, 220)]);

	const folderCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`);
	await folderCard.waitFor({ state: 'visible', timeout: 15_000 });
	const view = await readCanvasView(page);
	const box = await folderCard.boundingBox();
	if (!box || box.x < view.canvas.left || box.y < view.canvas.top || box.x + box.width > view.canvas.right || box.y + box.height > view.canvas.bottom) {
		await zoomCanvas(page, 'fit');
		await restingView();
	}
	await folderCard.dblclick();
	await assertCanvasFolder(page, folderName);
	for (const name of ['a.md', 'box', 'plan.md', 'b.md', 'shelf', 'notes.md']) {
		await card(name).waitFor({ state: 'visible', timeout: 15_000 });
	}
	const planEdge = `${cardPath('plan.md')}${String.fromCharCode(0)}${cardPath('notes.md')}`;
	await page.waitForFunction(id => Array.from(document.querySelectorAll('.basehalf-canvas-edge-path')).some(edge => edge instanceof SVGPathElement && edge.dataset.edgeId === id), planEdge, { timeout: 15_000 });
	await zoomCanvas(page, 'fit');
	await restingView();
	const firstRows = Object.fromEntries(['a.md', 'b.md', 'plan.md'].map(name => [name, rowOf(name)]));

	// 1. A note let go on a folder's card goes into it. While it is held there,
	// the folder shows that it takes the note and the note is half transparent;
	// afterwards the card is gone, the folder lists the note, and nothing is
	// selected. 11. The folder grows to 108 percent and glows yellow, and the
	// note let go on its grown edge, outside its place, still goes into it.
	const boxAtRest = await rectOf('box');
	const held = await drag(await grip('a.md'), centreOf(boxAtRest), async () => {
		const middle = await lookOf(['box', 'shelf', 'a.md']);
		// Between the folder's own edge and the edge it is drawn with now.
		const grown = await rectOf('box');
		const rim = { x: Math.round((boxAtRest.x + boxAtRest.width + grown.x + grown.width) / 2), y: Math.round(grown.y + grown.height / 2) };
		await page.mouse.move(rim.x, rim.y, { steps: 2 });
		await page.waitForTimeout(150);
		return { middle, grown, rim, onRim: (await lookOf(['box']))[cardPath('box')] };
	});
	const heldBox = held.middle[cardPath('box')];
	if (!heldBox?.target || held.middle[cardPath('shelf')]?.target || !held.middle[cardPath('a.md')]?.dropping || held.middle[cardPath('a.md')]?.filter !== 'opacity(0.5)') {
		throw new Error(`While a note is held over a folder's card, that folder alone must show that it takes the note, and the note must be half transparent: ${JSON.stringify(held)}`);
	}
	if (heldBox.scale !== '1.08' || !glowsYellow(heldBox) || held.rim.x <= boxAtRest.x + boxAtRest.width) {
		throw new Error(`A folder's card that takes a note must grow to 108 percent and glow yellow: ${JSON.stringify({ heldBox, boxAtRest, grown: held.grown })}`);
	}
	if (!held.onRim?.target || held.onRim.scale !== '1.08') {
		throw new Error(`With the pointer on the grown edge of the folder's card, outside its place, the folder must still take the note: ${JSON.stringify({ onRim: held.onRim, rim: held.rim, boxAtRest })}`);
	}
	await waitUntil(() => exists('box', 'a.md') && !exists('a.md'), 'a.md, let go on the grown edge of the box, to move into it');
	await card('a.md').waitFor({ state: 'detached', timeout: 10_000 });
	await waitForReading(() => card('box').locator('.basehalf-canvas-folder-preview-label').allTextContents(), labels => labels.includes('a'), 'the card of the box to list the note it took');
	const afterDrop = await lookOf(['box']);
	if (await selectedCards() !== 0 || afterDrop[cardPath('box')]?.target) {
		throw new Error(`After a drop into a folder, no card may be selected and the folder must look as at rest: ${JSON.stringify({ selected: await selectedCards(), afterDrop })}`);
	}
	// One undo brings it back at its place and size; redo moves it again.
	await pressOnCanvas(undoKey);
	await waitUntil(() => exists('a.md') && !exists('box', 'a.md'), 'undo to bring a.md back out of the box');
	await card('a.md').waitFor({ state: 'visible', timeout: 10_000 });
	await waitUntil(() => same(rowOf('a.md'), firstRows['a.md']), 'a.md to be back at its place and size after undo');
	await pressOnCanvas(redoKey);
	await waitUntil(() => exists('box', 'a.md') && !exists('a.md'), 'redo to move a.md into the box again');
	await card('a.md').waitFor({ state: 'detached', timeout: 10_000 });
	await pressOnCanvas(undoKey);
	await waitUntil(() => exists('a.md') && !exists('box', 'a.md'), 'a second undo to bring a.md back out of the box');
	await card('a.md').waitFor({ state: 'visible', timeout: 10_000 });

	// Exact undo, criterion 20: redo pressed at once after the undo of a drop,
	// before the files are back, waits for the undo and redoes the drop; the
	// undo of before dropped the whole history of the files instead.
	await pressOnCanvas(redoKey);
	await waitUntil(() => exists('box', 'a.md') && !exists('a.md'), 'redo to move a.md into the box before the quick undo and redo');
	await card('a.md').waitFor({ state: 'detached', timeout: 10_000 });
	await pressOnCanvas(undoKey);
	await pressOnCanvas(redoKey);
	const resting = await restingPlaceOf('a.md');
	if (resting !== 'box') {
		throw new Error(`Redo pressed at once after an undo must redo the drop once the undo is done: a.md rests ${resting === 'here' ? 'out of' : 'nowhere near'} the box.`);
	}
	await pressOnCanvas(undoKey);
	await waitUntil(() => exists('a.md') && !exists('box', 'a.md'), 'the next undo to bring a.md back out of the box');
	await card('a.md').waitFor({ state: 'visible', timeout: 10_000 });
	await waitUntil(() => same(rowOf('a.md'), firstRows['a.md']), 'a.md to be back at its place and size after the quick undo and redo');

	// 5. A name the folder holds: plan.md let go on the box, which holds a
	// plan.md, is plan 2.md there, the box's own plan.md is untouched, and the
	// note that names plan.md upstream names plan 2.md.
	const olderPlan = fs.readFileSync(inFolder('box', 'plan.md'), 'utf8');
	await drag(await grip('plan.md'), centreOf(await rectOf('box')));
	await waitUntil(() => exists('box', 'plan 2.md') && !exists('plan.md'), 'plan.md, let go on the box that holds a plan.md, to be plan 2.md in it');
	await waitUntil(() => namesUpstream('box/plan 2.md'), 'the note that names plan.md upstream to name box/plan 2.md');
	if (fs.readFileSync(inFolder('box', 'plan.md'), 'utf8') !== olderPlan) {
		throw new Error('The plan.md that the box held must keep its bytes.');
	}

	// 10. Right after the drop, a drag of another card stays where it is let
	// go, and the first click on empty canvas ends the selection.
	const { zoom } = await readCanvasView(page);
	const bFrom = await grip('b.md');
	await drag(bFrom, { x: bFrom.x + 90, y: bFrom.y + 50 });
	const movedB = await waitForReading(() => rowOf('b.md'), saved => !!saved && !same(saved, firstRows['b.md']), 'the drag of b.md right after a drop to be saved where it was let go');
	if (Math.abs(movedB.x - firstRows['b.md'].x - 90 / zoom) > 12 || Math.abs(movedB.y - firstRows['b.md'].y - 50 / zoom) > 12) {
		throw new Error(`A drag right after a drop must stay where it is let go: ${JSON.stringify({ before: firstRows['b.md'], after: movedB, zoom })}`);
	}
	if (await selectedCards() !== 1) {
		throw new Error(`The card just dragged must be the one selected card: ${await selectedCards()}`);
	}
	const blank = await emptyCanvasPoint(page);
	await page.mouse.click(blank.x, blank.y);
	await waitForReading(selectedCards, count => count === 0, 'the first click on empty canvas after a drop to end the selection', 5_000);
	// Undo takes back the drag of b.md, then the drop, with its name and the entry.
	await pressOnCanvas(undoKey);
	await waitUntil(() => same(rowOf('b.md'), firstRows['b.md']), 'undo to put b.md back');
	await pressOnCanvas(undoKey);
	await waitUntil(() => exists('plan.md') && !exists('box', 'plan 2.md') && namesUpstream('plan.md'), 'undo to bring plan.md back under its name, named upstream again');
	await card('plan.md').waitFor({ state: 'visible', timeout: 10_000 });

	// 3. The pointer decides: b.md let go over part of the shelf's card while
	// the pointer is beside it stays there, and nothing moves.
	const shelf = await rectOf('shelf');
	const bGrip = await grip('b.md');
	const bBox = await rectOf('b.md');
	const beside = { x: shelf.x - 20, y: shelf.y + shelf.height / 2 };
	if (beside.x + bBox.x + bBox.width - bGrip.x < shelf.x + 60) {
		throw new Error(`b.md must reach over the shelf's card while the pointer is beside it: ${JSON.stringify({ shelf, bBox, bGrip })}`);
	}
	const over = await drag(bGrip, beside, () => lookOf(['shelf', 'b.md']));
	if (over[cardPath('shelf')]?.target || over[cardPath('b.md')]?.dropping) {
		throw new Error(`A card over a folder's card with the pointer beside it must not be taken by the folder: ${JSON.stringify(over)}`);
	}
	await waitForReading(() => rowOf('b.md'), saved => !!saved && !same(saved, firstRows['b.md']), 'b.md to be saved where it was let go, over the shelf');
	if (!exists('b.md') || exists('shelf', 'b.md')) {
		throw new Error('A card let go with the pointer beside a folder must not move into it.');
	}
	await pressOnCanvas(undoKey);
	await waitUntil(() => same(rowOf('b.md'), firstRows['b.md']), 'undo to put b.md back from over the shelf');

	// 7. Let go over Files, outside the canvas: the card goes back to where it
	// was, nothing moves, and the view stays while the pointer is outside.
	const filesRow = page.locator(`.explorer-folders-view .monaco-list-row[aria-label="${folderName}"]`).first();
	if (!await filesRow.isVisible()) {
		throw new Error(`Files must be shown with ${folderName} in it.`);
	}
	const rowBox = await filesRow.boundingBox();
	// The card's place on the canvas, from where it is drawn and where the
	// canvas is: the view can move while the pointer crosses the edge.
	const placeOf = async name => {
		const [drawn, at] = [await rectOf(name), await readCanvasView(page)];
		return { x: (drawn.x - at.x) / at.zoom, y: (drawn.y - at.y) / at.zoom };
	};
	const placeBefore = await placeOf('a.md');
	const outside = await drag(await grip('a.md'), { x: rowBox.x + Math.min(60, rowBox.width / 2), y: rowBox.y + rowBox.height / 2 }, viewWhileOutside);
	if (!same(outside.first, outside.second)) {
		throw new Error(`The view must not move while the pointer is outside the canvas: ${JSON.stringify(outside)}`);
	}
	await page.waitForTimeout(600);
	const placeAfter = await placeOf('a.md');
	if (!exists('a.md') || !same(rowOf('a.md'), firstRows['a.md']) || Math.abs(placeAfter.x - placeBefore.x) > 2 || Math.abs(placeAfter.y - placeBefore.y) > 2) {
		throw new Error(`A card let go over Files must go back to its place, and nothing may move: ${JSON.stringify({ row: rowOf('a.md'), first: firstRows['a.md'], placeBefore, placeAfter })}`);
	}

	// 6. Out of a folder: on the box's canvas, a card let go on this folder's
	// name in the path goes up into it, the box's canvas stays as it is shown,
	// and undo brings the card back.
	await card('box').dblclick();
	await assertCanvasFolder(page, `${folderName}/box`);
	await card('box/inner.md').waitFor({ state: 'visible', timeout: 15_000 });
	await restingView();
	const segment = page.locator('button.basehalf-command-center-breadcrumb-segment[data-basehalf-drop-folder]', { hasText: folderName }).last();
	const segmentBox = await segment.boundingBox();
	if (!segmentBox) {
		throw new Error(`The path must show ${folderName} as a folder above the box.`);
	}
	const up = await drag(await grip('box/inner.md'), centreOf(segmentBox), async () => ({
		lit: await segment.evaluate(element => element.hasAttribute('data-basehalf-drop-target') && getComputedStyle(element).outlineColor),
		dropping: (await lookOf(['box/inner.md']))[cardPath('box/inner.md')]?.dropping,
		...await viewWhileOutside()
	}));
	if (up.lit !== yellow || !up.dropping || !same(up.first, up.second)) {
		throw new Error(`A card held over a folder of the path must show that it goes there, with the view still: ${JSON.stringify(up)}`);
	}
	await waitUntil(() => exists('inner.md') && !exists('box', 'inner.md'), 'inner.md, let go on the folder above in the path, to move up into it');
	await assertCanvasFolder(page, `${folderName}/box`);
	await card('box/inner.md').waitFor({ state: 'detached', timeout: 10_000 });
	await pressOnCanvas(undoKey);
	await waitUntil(() => exists('box', 'inner.md') && !exists('inner.md'), 'undo to bring inner.md back into the box');
	await card('box/inner.md').waitFor({ state: 'visible', timeout: 10_000 });

	await openRootCanvas(page);
	fs.rmSync(inFolder(), { recursive: true, force: true });
	fs.rmSync(mirror(folderName), { recursive: true, force: true });
	await folderCard.waitFor({ state: 'detached', timeout: 15_000 });
}
