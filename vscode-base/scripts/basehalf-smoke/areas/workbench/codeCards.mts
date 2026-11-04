/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A code file on its card and in Card Detail: the face, the wheel, marks, the place a card and
// its views share, editing on the card, and Source as VS Code's editor. On a fixture repository
// with a long file changed in three places.

import fs from 'fs';
import path from 'path';
import { app, workspacePath } from '../../context.mts';
import { commitFixtureChanges } from '../../fixture.mts';
import { closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { withTheRunsClipboard } from '../../lib/clipboard.mts';
import { assertCanvasFolder, openRootCanvas, readCanvasView, setCanvasZoomPercent, zoomCanvas } from '../../lib/canvas.mts';
import { quickOpen, runCommand } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

const FOLDER = 'code-cards-smoke';
const LONG = `${FOLDER}/long.ts`;
const SHORT = `${FOLDER}/short.ts`;
const LARGE = `${FOLDER}/large.ts`;
const EMPTY = `${FOLDER}/empty.ts`;
const LINE_COUNT = 800;
const ADDED_AT = 300;
const MODIFIED_AT = 40;
const DELETED_AT = 600;

const inWorkspace = (relativePath: string) => path.join(workspacePath, relativePath);
const cardOf = (page, cardPath: string) => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);

function longFile(): string[] {
	const lines = ['// A license would stand here.', '', 'export const table = {'];
	while (lines.length < LINE_COUNT - 1) {
		lines.push(`\tentry${lines.length}: { value: ${lines.length}, label: 'line ${lines.length}', wide: 'a line long enough to go on past the edge of the card, and well past it' },`);
	}
	lines.push('};');
	return lines;
}

const readFace = (page, cardPath: string) => cardOf(page, cardPath).evaluate(card => {
	const preview = card.querySelector<HTMLElement>('.basehalf-canvas-card-preview');
	const scroller = card.querySelector<HTMLElement>('.basehalf-canvas-code-scroller');
	const numbers = [...card.querySelectorAll('.basehalf-canvas-code-number')].map(number => Number(number.textContent)).sort((a, b) => a - b);
	const top = scroller?.getBoundingClientRect().top ?? 0;
	const scale = scroller ? scroller.getBoundingClientRect().height / scroller.clientHeight : 1;
	const shown = [...card.querySelectorAll<HTMLElement>('.basehalf-canvas-code-number')].filter(number => number.getBoundingClientRect().top >= top - 2 * scale).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
	return {
		kind: !!preview?.classList.contains('kind-code'),
		mask: preview ? getComputedStyle(preview).maskImage : null,
		font: preview ? getComputedStyle(preview).fontFamily : null,
		scrollTop: scroller?.scrollTop ?? 0,
		scrollHeight: scroller?.scrollHeight ?? 0,
		clientHeight: scroller?.clientHeight ?? 0,
		firstNumber: numbers[0] ?? null,
		topLine: shown ? Number(shown.textContent) : null,
		lines: [...card.querySelectorAll('.basehalf-canvas-code-line')].length,
		bars: [...card.querySelectorAll('.basehalf-canvas-code-mark')].map(mark => mark.className.split(' ').pop()),
		ticks: [...card.querySelectorAll('.basehalf-canvas-code-tick')].map(tick => tick.className.split(' ').pop()),
		colored: card.querySelectorAll('.basehalf-canvas-code-line span[class*="mtk"]').length,
		editing: !!preview?.classList.contains('editing'),
		editor: !!card.querySelector('.basehalf-canvas-code-editor .monaco-editor'),
		selected: !!card.closest('.react-flow__node')?.classList.contains('selected')
	};
});

const zoomText = page => readCanvasView(page).then(view => JSON.stringify(view));

/** A committed folder with a long file and a short one, then changes in three places of the long one. */
export async function prepareCodeCards(page) {
	fs.mkdirSync(inWorkspace(FOLDER), { recursive: true });
	fs.writeFileSync(inWorkspace(LONG), longFile().join('\n') + '\n');
	fs.writeFileSync(inWorkspace(SHORT), 'export const short = 1;\n');
	fs.writeFileSync(inWorkspace(EMPTY), '');
	commitFixtureChanges(workspacePath, 'code cards');
	const lines = longFile();
	lines[MODIFIED_AT - 1] = `${lines[MODIFIED_AT - 1]} // changed`;
	lines.splice(DELETED_AT, 4);
	lines.splice(ADDED_AT, 0, '\t// added one', '\t// added two', '\t// added three');
	fs.writeFileSync(inWorkspace(LONG), lines.join('\n') + '\n');
	await runCommand(page, 'Git: Refresh');
	await openRootCanvas(page);
	await cardOf(page, FOLDER).dblclick({ timeout: 10_000 });
	await assertCanvasFolder(page, FOLDER);
	await setCanvasZoomPercent(page, 100);
}

/** The face: numbers from line 1, the editor's font, nothing faded, and a ruler with a tick for each change. */
export async function assertCodeCardFace(page) {
	const face = await waitForReading(() => readFace(page, LONG), reading => reading.kind && reading.colored > 2, 'a code card in colors', 20_000);
	if (face.firstNumber !== 1 || face.mask !== 'none') {
		throw new Error(`A code card must show numbers from line 1, and nothing faded: ${JSON.stringify(face)}`);
	}
	if (!face.font?.includes('Menlo') && !face.font?.includes('monospace')) {
		throw new Error(`A code card must have the editor's font: ${face.font}`);
	}
	// Only the lines in view are drawn, whatever the length of the file.
	if (face.lines > Math.ceil(face.clientHeight / 18) + 2) {
		throw new Error(`A face must draw only the lines in view: ${JSON.stringify(face)}`);
	}
	const marked = await waitForReading(() => readFace(page, LONG), reading => reading.ticks.length >= 3, 'a tick in the ruler for each change', 20_000);
	if (marked.ticks.join() !== 'modified,added,deleted') {
		throw new Error(`The ruler must have a tick for each change: ${JSON.stringify(marked.ticks)}`);
	}
	const short = await readFace(page, SHORT);
	if (short.ticks.length !== 0 || short.bars.length !== 0) {
		throw new Error(`An unchanged file has no marks: ${JSON.stringify(short)}`);
	}
}

/** The wheel over a card moves its lines to the file's end and leaves the canvas; over a short file, or below 50%, it moves the canvas. */
export async function assertCodeCardWheel(page) {
	const canvasBefore = await zoomText(page);
	const box = await cardOf(page, LONG).boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, 720);
	const moved = await waitForReading(() => readFace(page, LONG), reading => reading.scrollTop >= 700, 'lines moved by the wheel', 5_000);
	if (await zoomText(page) !== canvasBefore) {
		throw new Error('A wheel gesture on a long code card must not move the canvas');
	}
	if (moved.topLine === null || moved.topLine < 39 || moved.topLine > 42) {
		throw new Error(`720 pixels of the wheel must show about line 40: ${JSON.stringify(moved)}`);
	}
	// That line is the one marked as modified, and its bar shows beside it.
	const barred = await waitForReading(() => readFace(page, LONG), reading => reading.bars.includes('modified'), 'the bar of a modified line', 10_000);
	if (barred.ticks.length !== 3) {
		throw new Error(`The ruler must stay while the card shows other lines: ${JSON.stringify(barred)}`);
	}
	// To the end of the file, which the head of it did not hold, without moving the canvas.
	await page.waitForTimeout(300);
	for (let index = 0; index < 6; index++) {
		await page.mouse.wheel(0, 8_000);
		await page.waitForTimeout(60);
	}
	const end = await waitForReading(() => readFace(page, LONG), reading => reading.scrollTop + reading.clientHeight >= reading.scrollHeight - 1 && reading.topLine !== null && reading.topLine > LINE_COUNT - 20, 'the end of the file', 10_000);
	if (await zoomText(page) !== canvasBefore) {
		throw new Error(`Scrolling to the end of a file must not move the canvas: ${JSON.stringify(end)}`);
	}
	await waitForReading(() => readFace(page, LONG), reading => reading.colored > 2, 'colors at the end of the file', 10_000);
	await page.waitForTimeout(300);
	for (let index = 0; index < 6; index++) {
		await page.mouse.wheel(0, -8_000);
		await page.waitForTimeout(60);
	}
	await waitForReading(() => readFace(page, LONG), reading => reading.scrollTop === 0 && reading.firstNumber === 1, 'back at the first line', 10_000);
	await page.waitForTimeout(300);

	// A sideways gesture moves the text and leaves the numbers and the canvas.
	const readSideways = () => cardOf(page, LONG).evaluate(card => ({
		text: card.querySelector('.basehalf-canvas-code-text').scrollLeft,
		numbers: Math.round(card.querySelector('.basehalf-canvas-code-gutter').getBoundingClientRect().left - card.getBoundingClientRect().left)
	}));
	const sidewaysBefore = await readSideways();
	await page.mouse.wheel(150, 0);
	const sideways = await waitForReading(readSideways, reading => reading.text >= 100, 'the text moved sideways', 5_000);
	if (sideways.numbers !== sidewaysBefore.numbers || await zoomText(page) !== canvasBefore) {
		throw new Error(`A sideways gesture must move only the text: ${JSON.stringify({ sidewaysBefore, sideways })}`);
	}
	await page.waitForTimeout(250);
	await page.mouse.wheel(-400, 0);
	await waitForReading(readSideways, reading => reading.text === 0, 'the text back at its start', 5_000);
	await page.waitForTimeout(300);

	// A drag from a face moves the card, as from a note at rest, and selects no text.
	const place = await cardOf(page, LONG).boundingBox();
	await page.mouse.move(place.x + place.width / 2, place.y + place.height / 2);
	await page.mouse.down();
	await page.mouse.move(place.x + place.width / 2 + 40, place.y + place.height / 2 + 30, { steps: 6 });
	await page.mouse.up();
	const dragged = await waitForReading(() => cardOf(page, LONG).boundingBox(), found => Math.abs(found.x - place.x) + Math.abs(found.y - place.y) > 20, 'the card moved by a drag from its face', 5_000);
	if (await page.evaluate(() => getSelection()?.toString().length ?? 0)) {
		throw new Error(`A drag from a face must select no text: ${JSON.stringify(dragged)}`);
	}
	await page.waitForTimeout(300);
	// What fits its card leaves the wheel to the canvas.
	const short = await cardOf(page, SHORT).boundingBox();
	await page.mouse.move(short.x + short.width / 2, short.y + short.height / 2);
	await page.mouse.wheel(0, 90);
	await waitForReading(() => zoomText(page), text => text !== canvasBefore, 'the canvas moved by the wheel over a short file', 5_000);
	await page.waitForTimeout(300);

	// Below 50% a line can no longer be read, and the canvas moves.
	await setCanvasZoomPercent(page, 40);
	await page.waitForTimeout(300);
	const far = await cardOf(page, LONG).boundingBox();
	const farBefore = await zoomText(page);
	await page.mouse.move(far.x + far.width / 2, far.y + far.height / 2);
	await page.mouse.wheel(0, 90);
	await waitForReading(() => zoomText(page), text => text !== farBefore, 'the canvas moved by the wheel at 40%', 5_000);
	const atFar = await readFace(page, LONG);
	if (atFar.scrollTop !== 0) {
		throw new Error(`At 40% a gesture on a card must move the canvas and not its lines: ${JSON.stringify(atFar)}`);
	}
	await page.waitForTimeout(300);
	await setCanvasZoomPercent(page, 100);
}

/** Source: VS Code's editor, with its minimap, Find, marks, inline diff, commands, and status bar; Source and Changes keep the line. */
export async function assertSourceIsTheEditor(page) {
	await quickOpen(page, LONG);
	const readSource = () => page.evaluate(() => {
		const editor = document.querySelector('.basehalf-card-detail-surface.active .monaco-editor');
		const box = element => { if (!element) { return null; } const r = element.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height) }; };
		return {
			open: !!document.querySelector('.basehalf-card-detail.visible'),
			minimap: box(editor?.querySelector('.minimap')),
			folding: editor?.querySelectorAll('.codicon-folding-expanded').length ?? 0,
			marks: [...(editor?.querySelectorAll('.dirty-diff-glyph') ?? [])].length,
			find: !!editor?.querySelector('.find-widget.visible'),
			peek: !!editor?.querySelector('.dirty-diff'),
			sticky: (box(editor?.querySelector('.sticky-widget'))?.height ?? 0) > 0,
			fontSize: editor ? getComputedStyle(editor.querySelector('.view-lines')).fontSize : null,
			line: document.querySelector('#status\\.editor\\.selection')?.textContent?.trim() ?? null,
			language: document.querySelector('#status\\.editor\\.mode')?.textContent?.trim() ?? null,
			firstLine: Number(editor?.querySelector('.margin-view-overlays .line-numbers')?.textContent ?? 0)
		};
	});
	// What it computes after it opens, folding ranges and the status bar, comes by itself.
	await waitForReading(readSource, reading => reading.open && !!reading.minimap && reading.minimap.width >= 60 && reading.folding > 0 && !!reading.language?.includes('TypeScript') && !!reading.line?.includes('Ln'), 'Source as VS Code\'s editor, with its minimap, folding, and status bar', 15_000);
	const lines = await page.locator('.basehalf-card-detail-surface.active .monaco-editor .view-lines').boundingBox();
	await page.mouse.click(lines.x + 300, lines.y + 120);

	// Find takes Escape first.
	await page.keyboard.press('Meta+F');
	await waitForReading(readSource, reading => reading.find, 'Find in Source', 5_000);
	await page.keyboard.press('Escape');
	const afterEscape = await waitForReading(readSource, reading => !reading.find, 'Escape closes Find', 5_000);
	if (!afterEscape.open) {
		throw new Error('Escape must close Find before Card Detail');
	}

	// Go to Line goes there, the status bar follows, sticky scroll shows, and the mark beside an added line opens its change in place.
	await page.keyboard.press('Control+G');
	await page.waitForTimeout(300);
	await page.keyboard.type(String(ADDED_AT + 2));
	await page.keyboard.press('Enter');
	const atLine = await waitForReading(readSource, reading => reading.line?.includes(`Ln ${ADDED_AT + 2}`) && reading.marks > 0, 'Go to Line and the marks there', 10_000);
	if (!atLine.sticky) {
		throw new Error(`Sticky scroll must show: ${JSON.stringify(atLine)}`);
	}
	const mark = await page.locator('.basehalf-card-detail-surface.active .dirty-diff-glyph').first().boundingBox();
	await page.mouse.click(mark.x + 1, mark.y + mark.height / 2);
	await waitForReading(readSource, reading => reading.peek, 'a change in place after a click on its mark', 10_000);
	await page.keyboard.press('Escape');
	const afterPeek = await waitForReading(readSource, reading => !reading.peek, 'Escape closes the change in place', 5_000);
	if (!afterPeek.open) {
		throw new Error('Escape must close the change in place before Card Detail');
	}

	// The palette has the editor's commands, as for a tab.
	await page.keyboard.press('Meta+Shift+P');
	await page.waitForTimeout(300);
	await page.keyboard.type('Fold All');
	const rows = await waitForReading(() => page.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(row => row.textContent ?? '')), found => found.some(row => row.startsWith('Fold All')), 'Fold All in the palette', 5_000);
	if (!rows.length) {
		throw new Error('The palette must list the commands of the editor');
	}
	await page.keyboard.press('Escape');
	await page.waitForTimeout(200);

	// Settings apply, and at once.
	const settings = inWorkspace('.vscode/settings.json');
	const before = fs.readFileSync(settings, 'utf8');
	fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(before), 'editor.fontSize': 16 }, null, '\t'));
	await waitForReading(readSource, reading => reading.fontSize === '16px', 'a change of editor.fontSize', 10_000);
	fs.writeFileSync(settings, before);
	await waitForReading(readSource, reading => reading.fontSize === '12px', 'the setting gone', 10_000);

	// Source and Changes keep the line, in both directions.
	const lineOf = (selector: string) => page.evaluate(selectorOf => Number(document.querySelector(selectorOf)?.textContent ?? 0), selector);
	const sourceLine = await lineOf('.basehalf-card-detail-surface.active .margin-view-overlays .line-numbers');
	await page.locator('.basehalf-card-detail-projection[data-projection="changes"]').click({ timeout: 5_000 });
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail-surface.active .monaco-diff-editor'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(800);
	const changesLine = await lineOf('.basehalf-card-detail-surface.active .editor.modified .margin-view-overlays .line-numbers');
	if (Math.abs(changesLine - sourceLine) > 3) {
		throw new Error(`Changes must go on at the line of Source: ${sourceLine} and ${changesLine}`);
	}
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.basehalf-card-detail.visible'), undefined, { timeout: 10_000 });

	const canvasStatus = await page.evaluate(() => [...document.querySelectorAll('#workbench\\.parts\\.statusbar .statusbar-item')].filter(item => item.id.startsWith('status.editor.')).length);
	if (canvasStatus !== 0) {
		throw new Error(`On the canvas the status bar must have no entries of an editor: ${canvasStatus}`);
	}
}

/** A change read in the Changes view is what the card shows on the first frame of the closing, and another card stays. */
export async function assertCardStandsAtWhatWasRead(page) {
	// The wheel moved the canvas in an earlier step: the cards in the view again.
	await zoomCanvas(page, 'fit');
	await page.waitForTimeout(400);
	await setCanvasZoomPercent(page, 100);
	await page.waitForTimeout(300);
	const shortBefore = await readFace(page, SHORT);
	await cardOf(page, LONG).locator('.basehalf-canvas-card-caption .basehalf-canvas-card-change').click({ timeout: 10_000 });
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail-surface.active .monaco-diff-editor'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(1_000);
	await page.keyboard.press('Alt+F5');
	await page.waitForTimeout(500);
	await page.keyboard.press('Alt+F5');
	await page.waitForTimeout(700);
	// The card follows under the view, so that it stands there when the view goes.
	await page.evaluate(() => {
		const state = { frames: [], running: true };
		globalThis.__bhCodeCardFrames = state;
		const tick = () => {
			if (!state.running) {
				return;
			}
			const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path$="long.ts"]');
			state.frames.push({
				open: !!document.querySelector('.basehalf-card-detail.visible'),
				top: card?.querySelector('.basehalf-canvas-code-scroller')?.scrollTop ?? null
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.basehalf-card-detail.visible'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(400);
	const frames = await page.evaluate(() => {
		globalThis.__bhCodeCardFrames.running = false;
		return globalThis.__bhCodeCardFrames.frames;
	});
	const tops = new Set(frames.map(frame => frame.top));
	if (tops.size !== 1 || !frames[0].top) {
		throw new Error(`The card must stand at what was read from before the closing, on every frame: ${JSON.stringify([...tops])}`);
	}
	const face = await readFace(page, LONG);
	const shownBar = face.bars.includes('added') || face.bars.includes('deleted') || face.bars.includes('modified');
	if (!shownBar) {
		throw new Error(`The card must show the change that was read, with its marks: ${JSON.stringify(face)}`);
	}
	const short = await readFace(page, SHORT);
	if (short.scrollTop !== shortBefore.scrollTop) {
		throw new Error(`Reading a change of one file must not move another card: ${JSON.stringify(short)}`);
	}
}

/** Lines stand still on every frame when the card's editor comes and goes, at three zooms, and typing, Space, undo, Find, and Escape work. */
export async function assertEditingOnTheCard(page) {
	const startFrames = () => page.evaluate(cardPath => {
		const state = { frames: [], running: true };
		globalThis.__bhCodeCardFrames = state;
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
		const tick = () => {
			if (!state.running) {
				return;
			}
			const preview = card.querySelector('.basehalf-canvas-card-preview');
			const editing = preview.classList.contains('editing');
			const line = [...card.querySelectorAll(editing ? '.basehalf-canvas-code-editor .view-line' : '.basehalf-canvas-code-line')]
				.map(element => ({ text: element.textContent.replace(/ /g, ' ').replace(/\t/g, '    ').trim(), rect: element.getBoundingClientRect() }))
				.filter(element => element.text.length > 4 && element.rect.top > card.getBoundingClientRect().top + 60)
				.sort((a, b) => a.rect.top - b.rect.top)[0];
			state.frames.push({ editing, text: line?.text ?? '', top: line?.rect.top ?? null, left: line?.rect.left ?? null });
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, LONG);
	const stopFrames = () => page.evaluate(() => {
		globalThis.__bhCodeCardFrames.running = false;
		return globalThis.__bhCodeCardFrames.frames;
	});
	const assertStill = (frames, what: string) => {
		const anchor = frames.find(frame => frame.text);
		for (const frame of frames) {
			if (frame.text === anchor.text && (Math.abs(frame.top - anchor.top) > 1 || Math.abs(frame.left - anchor.left) > 1)) {
				throw new Error(`${what}: the line moved from ${anchor.top},${anchor.left} to ${frame.top},${frame.left}`);
			}
		}
		if (!frames.some(frame => frame.editing) || !frames.some(frame => !frame.editing)) {
			throw new Error(`${what}: the frames did not cross the change: ${JSON.stringify(frames.slice(0, 3))}`);
		}
	};
	for (const zoom of [72, 150, 100]) {
		await setCanvasZoomPercent(page, zoom);
		await page.waitForTimeout(400);
		const box = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
		await startFrames();
		await page.mouse.dblclick(box.x + box.width * 0.6, box.y + box.height * 0.5);
		await waitForReading(() => readFace(page, LONG), reading => reading.editing && reading.editor, `the card's editor at ${zoom}%`, 10_000);
		await page.waitForTimeout(200);
		await page.keyboard.press('Escape');
		await waitForReading(() => readFace(page, LONG), reading => !reading.editing && !reading.editor, `the card at rest at ${zoom}%`, 10_000);
		await page.waitForTimeout(200);
		assertStill(await stopFrames(), `Editing at ${zoom}%`);
	}

	// A double click at a line puts the caret on that line. What is typed is written when the editing ends.
	const box = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.dblclick(box.x + box.width * 0.6, box.y + 8 + 18 * 2 + 9);
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'the editor on the card', 10_000);
	const status = () => page.evaluate(() => document.querySelector('#status\\.editor\\.selection')?.textContent?.trim() ?? '');
	await waitForReading(status, text => /Ln \d+/.test(text), 'the line of the caret in the status bar', 5_000);
	await page.keyboard.press('End');
	await page.keyboard.type(' TYPED ON CARD');
	await page.waitForTimeout(100);
	const written = () => fs.readFileSync(inWorkspace(LONG), 'utf8');
	const typedInEditor = await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${LONG}"] .basehalf-canvas-code-editor .view-lines`).textContent();
	if (!typedInEditor.replace(/ /g, ' ').includes('TYPED ON CARD')) {
		throw new Error('Letters and spaces typed on the card must show there');
	}
	// Undo is the editor's, and leaves the canvas alone.
	await page.keyboard.press('Meta+Z');
	await page.waitForTimeout(200);
	await page.keyboard.press('Meta+Shift+Z');
	await page.waitForTimeout(200);
	// Find is the editor's and takes Escape first.
	await page.keyboard.press('Meta+F');
	await waitForReading(() => cardOf(page, LONG).evaluate(card => !!card.querySelector('.find-widget.visible')), found => found, 'Find on the card', 5_000);
	await page.keyboard.press('Escape');
	await waitForReading(() => cardOf(page, LONG).evaluate(card => !card.querySelector('.find-widget.visible')), gone => gone, 'Escape closes Find', 5_000);
	const stillEditing = await readFace(page, LONG);
	if (!stillEditing.editor) {
		throw new Error('Escape must close Find before it ends the editing');
	}
	await page.keyboard.press('Escape');
	const ended = await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'the end of the editing', 10_000);
	if (!ended.selected) {
		throw new Error(`The card must stay selected when the editing ends: ${JSON.stringify(ended)}`);
	}
	await waitUntil(() => written().includes('TYPED ON CARD'), 'what was typed on the card to be written', 10_000);
	const keyboard = await page.evaluate(() => !!document.activeElement?.closest('.react-flow__node'));
	if (!keyboard) {
		throw new Error('The keyboard must go back to the canvas when the editing ends');
	}

	// The menu of the editor stands over the window, not inside the card.
	await page.keyboard.press('Enter');
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'Enter edits a selected code card', 10_000);
	const lines = await cardOf(page, LONG).locator('.basehalf-canvas-code-editor .view-lines').boundingBox();
	await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5, { button: 'right' });
	const menu = await waitForReading(() => page.evaluate(cardPath => {
		const found = document.querySelector('.monaco-menu-container .monaco-menu, .context-view .monaco-menu');
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
		return found ? { inCard: card.contains(found), text: found.textContent } : null;
	}, LONG), found => !!found, 'the menu of the editor', 5_000);
	if (menu.inCard || !menu.text.includes('Copy')) {
		throw new Error(`The menu of the card's editor must stand over the window: ${JSON.stringify(menu)}`);
	}
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
	if (!(await readFace(page, LONG)).editor || lines === null) {
		throw new Error('Escape must close the menu before it ends the editing');
	}

	// A copy in the card's editor is the text selected, as in any editor.
	await withTheRunsClipboard('code card copy', async () => {
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Meta+C');
		await waitForReading(() => app.evaluate(({ clipboard }) => clipboard.readText()), text => text.trim().length > 0 && !text.includes('code-cards-smoke'), 'the text selected on the clipboard', 5_000);
	});

	// Command-W ends the editing, and does not close the window.
	await page.keyboard.press('Meta+W');
	await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'Command-W ends the editing', 10_000);

	// A press outside ends it too, and writes what was typed first.
	await page.keyboard.press('Enter');
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'Enter edits a selected code card', 10_000);
	await page.keyboard.type('X2');
	const canvas = await page.locator('.react-flow').first().boundingBox();
	await page.mouse.click(canvas.x + 40, canvas.y + 40);
	await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'a press outside ends the editing', 10_000);
	await waitUntil(() => written().includes('X2'), 'what was typed before the press to be written', 10_000);

	// A file has the lines the editor has: a line after its last line break, and line 1 of an empty file, which is edited as any other.
	const short = await readFace(page, SHORT);
	if (short.firstNumber !== 1 || short.lines !== 2) {
		throw new Error(`A face must have the lines the editor has: ${JSON.stringify(short)}`);
	}
	await zoomCanvas(page, 'fit');
	await page.waitForTimeout(500);
	await waitForReading(() => readFace(page, EMPTY), reading => reading.kind && reading.firstNumber === 1 && reading.lines === 1, 'line 1 of an empty file', 10_000);
	const empty = await cardOf(page, EMPTY).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.dblclick(empty.x + empty.width / 2, empty.y + empty.height / 2);
	await waitForReading(() => readFace(page, EMPTY), reading => reading.editor, 'the editor of an empty file on its card', 10_000);
	await page.keyboard.type('export {};');
	await page.keyboard.press('Escape');
	await waitForReading(() => readFace(page, EMPTY), reading => !reading.editor, 'the end of editing an empty file', 10_000);
	await waitUntil(() => fs.readFileSync(inWorkspace(EMPTY), 'utf8') === 'export {};', 'what was typed in an empty file to be written', 10_000);
	await setCanvasZoomPercent(page, 100);
}

/** Expand opens Card Detail at the card's place, and a commit takes the marks and leaves the text and the place. */
export async function assertExpandAndCommit(page) {
	const box = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(250);
	await page.mouse.wheel(0, 1_800);
	const scrolled = await waitForReading(() => readFace(page, LONG), reading => reading.topLine !== null && reading.topLine >= 95, 'the card scrolled', 5_000);
	await page.waitForTimeout(200);
	await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').click({ timeout: 5_000 });
	await page.locator('[data-toolbar-item="expand"]').click({ timeout: 5_000 });
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail-surface.active .monaco-editor .minimap'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(500);
	const shown = await page.evaluate(() => Number(document.querySelector('.basehalf-card-detail-surface.active .margin-view-overlays .line-numbers')?.textContent ?? 0));
	if (Math.abs(shown - scrolled.topLine) > 3) {
		throw new Error(`Expand must open at the card's place: the card at ${scrolled.topLine}, Source at ${shown}`);
	}
	// Command-W closes Card Detail, as it closes a tab, and leaves the window.
	await page.keyboard.press('Meta+W');
	await page.waitForFunction(() => !document.querySelector('.basehalf-card-detail.visible'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(300);
	const atPlace = await readFace(page, LONG);
	commitFixtureChanges(workspacePath, 'the changes of the long file');
	await runCommand(page, 'Git: Refresh');
	const committed = await waitForReading(() => readFace(page, LONG), reading => reading.ticks.length === 0 && reading.bars.length === 0, 'a commit to take the marks', 20_000);
	if (committed.topLine !== atPlace.topLine) {
		throw new Error(`A commit must leave the card's place: ${atPlace.topLine} and ${committed.topLine}`);
	}
}

/** A file above 5 MiB keeps its head on its card, and a double click opens Card Detail. */
export async function assertLargeFileKeepsItsHead(page) {
	const line = '// a line of a very large file, to fill it up to more than five mebibytes of text\n';
	fs.writeFileSync(inWorkspace(LARGE), line.repeat(Math.ceil(5.2 * 1024 * 1024 / line.length)));
	await waitForReading(() => cardOf(page, LARGE).count(), count => count > 0, 'the card of a large file', 15_000);
	const face = await waitForReading(() => readFace(page, LARGE), reading => reading.kind && reading.firstNumber === 1, 'the head of a large file', 15_000);
	await zoomCanvas(page, 'fit');
	await page.waitForTimeout(500);
	const box = await cardOf(page, LARGE).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail.visible'), undefined, { timeout: 15_000 });
	await closeCardDetailIfOpen(page);
	if (face.editor) {
		throw new Error('A file above 5 MiB is not edited on its card');
	}
	fs.rmSync(inWorkspace(LARGE));
}
