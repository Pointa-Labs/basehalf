/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A code file on its card and in Card Detail: the face, the wheel, marks, the place a card and
// its views share, editing on the card, and Source as VS Code's editor. On a fixture repository
// with a long file changed in three places.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app, workspacePath } from '../../context.mts';
import { commitFixtureChanges, createSolidPng } from '../../fixture.mts';
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
const IGNORED = `${FOLDER}/ignored.ts`;
const NEAR_TOP = `${FOLDER}/near-top.ts`;
const NOTE = `${FOLDER}/note.md`;
const IMAGE = `${FOLDER}/picture.png`;
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

/** Commits one path and leaves the changes the other steps read. */
function commitOnly(relativePath: string, message: string) {
	execFileSync('git', ['add', '--', relativePath], { cwd: workspacePath, stdio: 'ignore' });
	execFileSync('git', ['commit', '-m', message, '--', relativePath], { cwd: workspacePath, stdio: 'ignore' });
}

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

/** Moves the canvas until the cards are out of view and back, so that they are drawn anew. */
async function panAwayAndBack(page, whileItComesBack?: () => Promise<void>) {
	const canvas = await page.locator('.react-flow').first().boundingBox();
	await page.waitForTimeout(300);
	const before = await readCanvasView(page);
	// A selected card stays drawn out of view.
	await page.mouse.click(canvas.x + 30, canvas.y + 30);
	await page.waitForTimeout(250);
	await page.mouse.wheel(0, 3_000);
	await waitForReading(() => page.locator('.basehalf-canvas-code-scroller').count(), count => count === 0, 'the faces out of view', 10_000);
	await page.waitForTimeout(300);
	await whileItComesBack?.();
	await page.mouse.wheel(0, -3_000);
	await waitForReading(() => readCanvasView(page), view => JSON.stringify(view) === JSON.stringify(before), 'the canvas back where it was', 10_000);
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

	// The setting of the font reaches a face that shows.
	const settings = inWorkspace('.vscode/settings.json');
	const settingsBefore = fs.readFileSync(settings, 'utf8');
	fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(settingsBefore), 'editor.fontFamily': 'Andale Mono' }, null, '\t'));
	await waitForReading(() => readFace(page, LONG), reading => !!reading.font?.includes('Andale Mono'), 'a change of editor.fontFamily on the face', 10_000);
	fs.writeFileSync(settings, settingsBefore);
	await waitForReading(() => readFace(page, LONG), reading => !reading.font?.includes('Andale Mono'), 'the setting gone', 10_000);
}

/** A card read past what it read of its file stands there when it comes back into view, and a kept card draws what it read last. */
export async function assertCardKeepsItsPlace(page) {
	await zoomCanvas(page, 'fit');
	await page.waitForTimeout(400);
	await setCanvasZoomPercent(page, 100);
	await page.waitForTimeout(300);
	const box = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(250);
	for (let index = 0; index < 6; index++) {
		await page.mouse.wheel(0, 900);
		await page.waitForTimeout(40);
	}
	const read = await waitForReading(() => readFace(page, LONG), reading => reading.topLine !== null && reading.topLine >= 295 && reading.colored > 2, 'the card read past its head', 10_000);
	await page.waitForTimeout(300);

	// Out of view and back: the face is made anew, without a model at first, and on no frame does it show other lines.
	await panAwayAndBack(page, () => page.evaluate(cardPath => {
		const state = { numbers: [] as number[], running: true };
		globalThis.__bhCodeCardNumbers = state;
		const tick = () => {
			if (state.running) {
				const numbers = [...document.querySelectorAll(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"] .basehalf-canvas-code-number`)].map(number => Number(number.textContent));
				state.numbers.push(...numbers);
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	}, LONG));
	const back = await waitForReading(() => readFace(page, LONG), reading => reading.kind && reading.colored > 2, 'the face back in view', 10_000);
	await page.waitForTimeout(600);
	const settled = await readFace(page, LONG);
	const numbersShown = await page.evaluate(() => {
		globalThis.__bhCodeCardNumbers.running = false;
		return globalThis.__bhCodeCardNumbers.numbers;
	});
	if (numbersShown.some(number => number < read.topLine - 8)) {
		throw new Error(`A face that comes back must show no lines but those at its place: it stands at ${read.topLine} and showed ${Math.min(...numbersShown)}`);
	}
	// A place is a line, and the line that was cut at the top now stands whole.
	if (Math.abs(back.topLine - read.topLine) > 1 || Math.abs(settled.topLine - read.topLine) > 1) {
		throw new Error(`A card must stand at its place when it comes back into view: ${read.topLine}, then ${back.topLine} and ${settled.topLine}`);
	}

	// To another folder and back.
	await openRootCanvas(page);
	await cardOf(page, FOLDER).dblclick({ timeout: 10_000 });
	await assertCanvasFolder(page, FOLDER);
	await waitForReading(() => readFace(page, LONG), reading => reading.kind && reading.colored > 2, 'the face in its folder again', 10_000);
	await page.waitForTimeout(600);
	const again = await readFace(page, LONG);
	if (Math.abs(again.topLine - read.topLine) > 1) {
		throw new Error(`A card must stand at its place when its folder opens again: ${read.topLine} and ${again.topLine}`);
	}

	// A card that was kept while its file changed draws what it read last when it comes back. A file git ignores has no marks and no model.
	await zoomCanvas(page, 'fit');
	await page.waitForTimeout(400);
	fs.appendFileSync(inWorkspace('.git/info/exclude'), `${IGNORED}\n`);
	fs.writeFileSync(inWorkspace(IGNORED), 'export const first = 1;\n');
	const textOf = () => cardOf(page, IGNORED).locator('.basehalf-canvas-code-scroller').textContent({ timeout: 5_000 }).catch(() => '');
	await waitForReading(textOf, text => text.includes('first'), 'the first text of a file', 15_000);
	fs.writeFileSync(inWorkspace(IGNORED), 'export const second = 2;\n');
	await waitForReading(textOf, text => text.includes('second'), 'the second text on the card', 15_000);
	await panAwayAndBack(page);
	await waitForReading(textOf, text => text.includes('second'), 'the second text when the card comes back', 10_000);
	fs.rmSync(inWorkspace(IGNORED));
	await cardOf(page, IGNORED).waitFor({ state: 'detached', timeout: 15_000 });
	await setCanvasZoomPercent(page, 100);
}

/** A change near a file's top is in view when the Changes view opens there, and nothing scrolls. The card still comes to it. */
export async function assertCardComesToAChangeInView(page) {
	const lines = Array.from({ length: 400 }, (_, index) => `export const line${index} = ${index};`);
	fs.writeFileSync(inWorkspace(NEAR_TOP), lines.join('\n') + '\n');
	commitOnly(NEAR_TOP, 'a file with a change near its top');
	lines[4] = '// changed near the top';
	fs.writeFileSync(inWorkspace(NEAR_TOP), lines.join('\n') + '\n');
	await runCommand(page, 'Git: Refresh');
	await cardOf(page, NEAR_TOP).waitFor({ state: 'attached', timeout: 15_000 });
	await zoomCanvas(page, 'fit');
	await page.waitForTimeout(400);
	await setCanvasZoomPercent(page, 100);
	await page.waitForTimeout(300);
	await waitForReading(() => readFace(page, NEAR_TOP), reading => reading.kind && reading.ticks.length === 1, 'the tick of the change near the top', 20_000);
	const box = await cardOf(page, NEAR_TOP).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(250);
	for (let index = 0; index < 4; index++) {
		await page.mouse.wheel(0, 1_500);
		await page.waitForTimeout(60);
	}
	await waitForReading(() => readFace(page, NEAR_TOP), reading => reading.topLine !== null && reading.topLine > 150, 'the card far from the change', 10_000);
	await page.waitForTimeout(300);
	await cardOf(page, NEAR_TOP).locator('.basehalf-canvas-card-caption .basehalf-canvas-card-change').click({ timeout: 10_000 });
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail-surface.active .monaco-diff-editor'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(1_000);
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.basehalf-card-detail.visible'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(200);
	const atChange = await readFace(page, NEAR_TOP);
	if (atChange.topLine === null || atChange.topLine > 6 || !atChange.bars.includes('modified')) {
		throw new Error(`The card must come to a change that was in view when the Changes view opened: ${JSON.stringify(atChange)}`);
	}
	fs.rmSync(inWorkspace(NEAR_TOP));
	commitOnly(NEAR_TOP, 'the file with a change near its top goes');
	await runCommand(page, 'Git: Refresh');
	await cardOf(page, NEAR_TOP).waitFor({ state: 'detached', timeout: 15_000 });
}

/** A note's views that have no place go on by the selection or the first change, as before there were places. */
export async function assertViewsOfANoteGoOn(page) {
	const lines = Array.from({ length: 240 }, (_, index) => `Paragraph number ${index + 1} of a long note.\n`);
	fs.writeFileSync(inWorkspace(NOTE), lines.join('\n'));
	commitOnly(NOTE, 'a long note');
	const changed = [...lines];
	changed[150] = 'Paragraph changed by an agent.\n';
	fs.writeFileSync(inWorkspace(NOTE), changed.join('\n'));
	await runCommand(page, 'Git: Refresh');
	const firstLine = (selector: string) => page.evaluate(selectorOf => Number(document.querySelector(selectorOf)?.textContent ?? 0), selector);
	const projection = name => page.locator(`.basehalf-card-detail-projection[data-projection="${name}"]`);

	// From Rich to Changes: the first change, and not the first line.
	await quickOpen(page, NOTE);
	await projection('changes').click({ timeout: 10_000 });
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail-surface.active .monaco-diff-editor .editor.modified .view-line'), undefined, { timeout: 10_000 });
	await waitForReading(() => firstLine('.basehalf-card-detail-surface.active .editor.modified .margin-view-overlays .line-numbers'), line => line > 200, 'the Changes view at the first change of a note opened in Rich', 10_000);
	await closeCardDetailIfOpen(page);

	// From Rich to Source: the selection it was opened at.
	await page.keyboard.press('Meta+P');
	const search = page.locator('.quick-input-widget .quick-input-box input').first();
	await search.waitFor({ state: 'visible', timeout: 10_000 });
	await search.fill(`${NOTE}:400`);
	await page.locator('.quick-input-widget .quick-input-list .monaco-list-row').first().waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(300);
	await page.keyboard.press('Enter');
	await search.waitFor({ state: 'hidden', timeout: 10_000 });
	await projection('source').click({ timeout: 10_000 });
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail-surface.active .monaco-editor .view-line'), undefined, { timeout: 10_000 });
	await waitForReading(() => firstLine('.basehalf-card-detail-surface.active .margin-view-overlays .line-numbers'), line => line > 350, 'Source at the selection of a note opened at a line', 10_000);
	await closeCardDetailIfOpen(page);
	fs.rmSync(inWorkspace(NOTE));
	commitOnly(NOTE, 'the note goes');
	await runCommand(page, 'Git: Refresh');
	await cardOf(page, NOTE).waitFor({ state: 'detached', timeout: 15_000 });
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
	// A tick is as large on the screen at every zoom, and the rounded corners cut none.
	const tick = await cardOf(page, LONG).evaluate(card => {
		const box = card.querySelector('.basehalf-canvas-code-tick').getBoundingClientRect();
		const ruler = card.querySelector('.basehalf-canvas-code-ruler').getBoundingClientRect();
		const content = card.querySelector('.basehalf-canvas-card-preview').getBoundingClientRect();
		return { width: box.width, height: box.height, belowTheCorner: ruler.top - content.top };
	});
	if (Math.abs(tick.width - 4) > 0.5 || tick.height < 2.5 || tick.belowTheCorner < 3) {
		throw new Error(`A tick must be as large at 40% as at 100%, and below the card's corner: ${JSON.stringify(tick)}`);
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
	// It opens at the card's place, with the caret in what shows.
	const opened = await readSource();
	const caretLine = Number(/Ln (\d+)/.exec(opened.line ?? '')?.[1] ?? 0);
	if (opened.firstLine < 280 || caretLine < opened.firstLine) {
		throw new Error(`Source must open at the card's place with the caret in what shows: ${JSON.stringify(opened)}`);
	}
	const lines = await page.locator('.basehalf-card-detail-surface.active .monaco-editor').first().boundingBox();
	await page.mouse.click(lines.x + 300, lines.y + 120);

	// Find takes Escape first.
	await page.keyboard.press('Meta+F');
	await waitForReading(readSource, reading => reading.find, 'Find in Source', 5_000);
	await page.keyboard.press('Escape');
	const afterEscape = await waitForReading(readSource, reading => !reading.find, 'Escape closes Find', 5_000);
	if (!afterEscape.open) {
		throw new Error('Escape must close Find before Card Detail');
	}

	// Several cursors take Escape next, as in the editor, and leave Card Detail open.
	await page.keyboard.press('Meta+Alt+ArrowDown');
	await waitForReading(readSource, reading => /\d+ selections/.test(reading.line ?? ''), 'a second cursor in Source', 5_000);
	await page.keyboard.press('Escape');
	const oneCursor = await waitForReading(readSource, reading => !/\d+ selections/.test(reading.line ?? ''), 'Escape to leave one cursor in Source', 5_000);
	if (!oneCursor.open) {
		throw new Error('Escape with several cursors must leave one cursor before it closes Card Detail');
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
	const lineInSource = () => lineOf('.basehalf-card-detail-surface.active .margin-view-overlays .line-numbers');
	const toChanges = async () => {
		await page.locator('.basehalf-card-detail-projection[data-projection="changes"]').click({ timeout: 5_000 });
		await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail-surface.active .monaco-diff-editor'), undefined, { timeout: 10_000 });
		await page.waitForTimeout(800);
	};
	const toSource = async () => {
		await page.locator('.basehalf-card-detail-projection[data-projection="source"]').click({ timeout: 5_000 });
		await page.waitForFunction(() => !document.querySelector('.basehalf-card-detail-surface.active .monaco-diff-editor') && !!document.querySelector('.basehalf-card-detail-surface.active .monaco-editor .view-line'), undefined, { timeout: 10_000 });
		await page.waitForTimeout(500);
	};
	const sourceLine = await lineInSource();
	await toChanges();
	const changesLine = await lineOf('.basehalf-card-detail-surface.active .editor.modified .margin-view-overlays .line-numbers');
	if (Math.abs(changesLine - sourceLine) > 3) {
		throw new Error(`Changes must go on at the line of Source: ${sourceLine} and ${changesLine}`);
	}
	await toSource();
	const lineAgain = await lineInSource();
	if (Math.abs(lineAgain - sourceLine) > 3) {
		throw new Error(`Source must come back at its line: ${sourceLine} and ${lineAgain}`);
	}

	// Near the file's end the card under them stands short of what is read, and that moves no place.
	await page.keyboard.press('Control+G');
	await page.waitForTimeout(300);
	await page.keyboard.type(String(LINE_COUNT - 5));
	await page.keyboard.press('Enter');
	await waitForReading(readSource, reading => reading.line?.includes(`Ln ${LINE_COUNT - 5}`), 'Go to Line near the end of the file', 10_000);
	await page.waitForTimeout(500);
	const nearTheEnd = await lineInSource();
	await toChanges();
	await toSource();
	const nearTheEndAgain = await lineInSource();
	if (Math.abs(nearTheEndAgain - nearTheEnd) > 3) {
		throw new Error(`Source must come back at its line near the file's end: ${nearTheEnd} and ${nearTheEndAgain}`);
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
	// Far from what will be read: an earlier step left this card near a change.
	const start = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.waitForTimeout(250);
	for (let index = 0; index < 4; index++) {
		await page.mouse.wheel(0, -20_000);
		await page.waitForTimeout(60);
	}
	await waitForReading(() => readFace(page, LONG), reading => reading.scrollTop === 0, 'the card at its first line', 5_000);
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
	// The third change: three lines were added above where the lines were taken out.
	const face = await readFace(page, LONG);
	const changeRead = DELETED_AT + 3;
	if (face.topLine === null || Math.abs(face.topLine - changeRead) > 8 || !face.bars.includes('deleted')) {
		throw new Error(`The card must show the change that was read, about line ${changeRead}, with its marks: ${JSON.stringify(face)}`);
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
			if (frame.text !== anchor.text || Math.abs(frame.top - anchor.top) > 1 || Math.abs(frame.left - anchor.left) > 1) {
				throw new Error(`${what}: the line "${anchor.text}" at ${anchor.top},${anchor.left} became "${frame.text}" at ${frame.top},${frame.left} (${frame.editing ? 'editor' : 'face'})`);
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

	// The same with the text moved sideways, and it stays there, also when the file is written from outside.
	const sideways = () => cardOf(page, LONG).evaluate(card => card.querySelector('.basehalf-canvas-code-text').scrollLeft);
	const sidewaysBox = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.move(sidewaysBox.x + sidewaysBox.width * 0.6, sidewaysBox.y + sidewaysBox.height * 0.5);
	await page.waitForTimeout(250);
	await page.mouse.wheel(150, 0);
	const movedSideways = await waitForReading(sideways, left => left >= 100, 'the text moved sideways', 5_000);
	await page.waitForTimeout(300);
	await startFrames();
	await page.mouse.dblclick(sidewaysBox.x + sidewaysBox.width * 0.6, sidewaysBox.y + sidewaysBox.height * 0.5);
	await waitForReading(() => readFace(page, LONG), reading => reading.editing && reading.editor, 'the card\'s editor with the text moved sideways', 10_000);
	await page.waitForTimeout(200);
	await page.keyboard.press('Escape');
	await waitForReading(() => readFace(page, LONG), reading => !reading.editing && !reading.editor, 'the card at rest with the text moved sideways', 10_000);
	await page.waitForTimeout(200);
	assertStill(await stopFrames(), 'Editing with the text moved sideways');
	if (await sideways() !== movedSideways) {
		throw new Error(`The text must stay as far sideways when the editing ends: ${movedSideways} and ${await sideways()}`);
	}
	fs.appendFileSync(inWorkspace(LONG), '// written from outside\n');
	await waitForReading(() => readFace(page, LONG), reading => reading.ticks.length > 3, 'the written line among the marks', 15_000);
	if (await sideways() !== movedSideways) {
		throw new Error(`The text must stay as far sideways when the file is written from outside: ${movedSideways} and ${await sideways()}`);
	}
	await page.mouse.wheel(-400, 0);
	await waitForReading(sideways, left => left === 0, 'the text back at its start', 5_000);
	await page.waitForTimeout(300);

	// A double click at a line puts the caret on that line. What is typed is written when the editing ends.
	const box = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	const pressAt = { x: box.x + box.width * 0.6, y: box.y + 8 + 18 * 2 + 9 };
	const lineAtPress = await cardOf(page, LONG).evaluate((card, y) => {
		const number = [...card.querySelectorAll('.basehalf-canvas-code-number')].find(element => {
			const rect = element.getBoundingClientRect();
			return rect.top <= y && rect.bottom > y;
		});
		return Number(number?.textContent ?? 0);
	}, pressAt.y);
	await page.mouse.dblclick(pressAt.x, pressAt.y);
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'the editor on the card', 10_000);
	const status = () => page.evaluate(() => document.querySelector('#status\\.editor\\.selection')?.textContent?.trim() ?? '');
	await waitForReading(status, text => text.includes(`Ln ${lineAtPress},`), `the caret on line ${lineAtPress}, where the double click was`, 5_000);
	// A drag selects text, and does not move the card.
	const cardBeforeDrag = await cardOf(page, LONG).boundingBox();
	await page.mouse.move(pressAt.x - 60, pressAt.y);
	await page.mouse.down();
	await page.mouse.move(pressAt.x, pressAt.y, { steps: 6 });
	await page.mouse.up();
	await waitForReading(status, text => /selected/.test(text), 'a drag in the card\'s editor to select text', 5_000);
	const cardAfterDrag = await cardOf(page, LONG).boundingBox();
	if (cardAfterDrag.x !== cardBeforeDrag.x || cardAfterDrag.y !== cardBeforeDrag.y) {
		throw new Error(`A drag in the card's editor must not move the card: ${JSON.stringify({ cardBeforeDrag, cardAfterDrag })}`);
	}
	await page.keyboard.press('End');
	await page.keyboard.type(' TYPED ON CARD');
	await page.waitForTimeout(100);
	const written = () => fs.readFileSync(inWorkspace(LONG), 'utf8');
	// A file with unwritten text that shows on its card gets no editor of its own over the canvas (the fixture writes after an hour).
	await page.waitForTimeout(1_200);
	const onTheCard = await cardOf(page, LONG).evaluate((card, point) => !!card.ownerDocument.elementFromPoint(point.x, point.y)?.closest('.basehalf-canvas-code-editor'), pressAt);
	if (!onTheCard) {
		throw new Error('A file with unwritten text on its card must get no editor over the canvas');
	}
	// A write of what is typed leaves Expand there.
	await page.keyboard.press('Meta+S');
	await waitUntil(() => written().includes('TYPED ON CARD'), 'what is typed on the card to be written while it is edited', 10_000);
	await page.waitForTimeout(800);
	await page.locator('[data-toolbar-item="expand"]').waitFor({ state: 'visible', timeout: 5_000 });
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

	// The wheel moves the lines of the card's editor and not the canvas, and the face takes the place the editor leaves.
	await page.keyboard.press('Enter');
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'Enter edits a selected code card', 10_000);
	const faceBefore = await readFace(page, LONG);
	const canvasBeforeWheel = await zoomText(page);
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
	for (let index = 0; index < 8; index++) {
		await page.mouse.wheel(0, 200);
		await page.waitForTimeout(40);
	}
	await page.waitForTimeout(400);
	if (await zoomText(page) !== canvasBeforeWheel) {
		throw new Error('The wheel over the card\'s editor must not move the canvas');
	}
	const topInEditor = await cardOf(page, LONG).evaluate(card => {
		const scroller = card.querySelector('.basehalf-canvas-code-editor').getBoundingClientRect();
		const numbers = [...card.querySelectorAll('.basehalf-canvas-code-editor .margin-view-overlays .line-numbers')]
			.map(number => ({ line: Number(number.textContent), top: number.getBoundingClientRect().top }))
			.filter(number => number.top >= scroller.top - 2)
			.sort((a, b) => a.top - b.top);
		return numbers[0].line;
	});
	await page.keyboard.press('Escape');
	const faceAfter = await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'the end of the editing after the wheel', 10_000);
	if (faceAfter.scrollTop <= faceBefore.scrollTop || Math.abs(faceAfter.topLine - topInEditor) > 1) {
		throw new Error(`The face must stand where the editor left it: the editor at line ${topInEditor}, ${JSON.stringify({ before: faceBefore.scrollTop, after: faceAfter })}`);
	}

	// A press on its name ends it, and a drag by the name moves the card. Enter edits a card that was only clicked.
	const name = await cardOf(page, LONG).locator('.basehalf-canvas-card-caption').first().boundingBox();
	await page.keyboard.press('Enter');
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'Enter edits a selected code card', 10_000);
	const cardBeforeName = await cardOf(page, LONG).boundingBox();
	await page.mouse.move(name.x + 40, name.y + name.height / 2);
	await page.mouse.down();
	await page.mouse.move(name.x + 76, name.y + name.height / 2 + 24, { steps: 6 });
	await page.mouse.up();
	await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'a press on the name to end the editing', 10_000);
	await waitForReading(() => cardOf(page, LONG).boundingBox(), found => Math.abs(found.x - cardBeforeName.x) + Math.abs(found.y - cardBeforeName.y) > 20, 'a drag by the name to move the card', 5_000);
	await page.waitForTimeout(300);
	const scroller = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.click(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
	await page.waitForTimeout(100);
	await page.keyboard.press('Enter');
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'Enter edits a code card that was clicked', 10_000);

	// A press outside ends it too, and writes what was typed first.
	await page.keyboard.type('X2');
	const canvas = await page.locator('.react-flow').first().boundingBox();
	await page.mouse.click(canvas.x + 40, canvas.y + 40);
	await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'a press outside ends the editing', 10_000);
	await waitUntil(() => written().includes('X2'), 'what was typed before the press to be written', 10_000);

	// Enter edits a card selected without a click on it, with the keyboard elsewhere on the canvas.
	await page.waitForTimeout(300);
	const selectedByMarquee = await cardOf(page, LONG).boundingBox();
	await page.mouse.move(selectedByMarquee.x - 12, selectedByMarquee.y + 60);
	await page.mouse.down();
	await page.mouse.move(selectedByMarquee.x + 30, selectedByMarquee.y + 90, { steps: 5 });
	await page.mouse.up();
	await waitForReading(() => readFace(page, LONG), reading => reading.selected, 'a marquee to select the card', 5_000);
	await page.keyboard.press('Enter');
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'Enter edits a code card selected by a marquee', 10_000);

	// An input method writes at the caret, which its text area stands at, at a zoom other than 100%.
	await page.keyboard.press('Escape');
	await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'the end of the editing before the input method', 10_000);
	await setCanvasZoomPercent(page, 150);
	await page.waitForTimeout(400);
	const atZoom = await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').boundingBox();
	await page.mouse.dblclick(atZoom.x + atZoom.width * 0.5, atZoom.y + 150);
	await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'the card\'s editor at 150%', 10_000);
	const inputMethod = await page.context().newCDPSession(page);
	await inputMethod.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 });
	await page.waitForTimeout(200);
	const composing = await cardOf(page, LONG).evaluate(card => {
		const input = document.activeElement;
		const box = input.getBoundingClientRect();
		const line = [...card.querySelectorAll('.basehalf-canvas-code-editor .view-line')].find(element => element.textContent.includes('zhong'));
		const lineBox = line?.getBoundingClientRect();
		return { tag: input.tagName, top: box.top, left: box.left, lineTop: lineBox?.top ?? null, lineBottom: lineBox?.bottom ?? null };
	});
	if (composing.tag !== 'TEXTAREA' || composing.lineTop === null || composing.top < composing.lineTop - 4 || composing.top > composing.lineBottom + 4) {
		throw new Error(`An input method must write at the caret, with its text area there: ${JSON.stringify(composing)}`);
	}
	// Its Escape is its own and leaves the editing.
	await page.keyboard.press('Escape');
	await page.waitForTimeout(200);
	await inputMethod.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
	await inputMethod.send('Input.insertText', { text: '中' });
	await inputMethod.detach();
	await page.keyboard.press('Meta+S');
	await waitUntil(() => written().includes('中'), 'what an input method writes to reach the file', 10_000);
	await setCanvasZoomPercent(page, 100);
	await page.waitForTimeout(300);
	await waitForReading(() => readFace(page, LONG), reading => reading.editor || !reading.editor, 'the card', 1_000);
	if (!(await readFace(page, LONG)).editor) {
		await cardOf(page, LONG).locator('.basehalf-canvas-code-scroller').click({ timeout: 5_000 });
		await page.keyboard.press('Enter');
		await waitForReading(() => readFace(page, LONG), reading => reading.editor, 'Enter edits the card again', 10_000);
	}

	// Several cursors take Escape first, as in the editor.
	await page.keyboard.press('Meta+Alt+ArrowDown');
	await waitForReading(status, text => /\d+ selections/.test(text), 'a second cursor', 5_000);
	await page.keyboard.press('Escape');
	await waitForReading(status, text => !/\d+ selections/.test(text), 'Escape to leave one cursor', 5_000);
	if (!(await readFace(page, LONG)).editor) {
		throw new Error('Escape with several cursors must leave one cursor before it ends the editing');
	}
	await page.keyboard.press('Escape');
	await waitForReading(() => readFace(page, LONG), reading => !reading.editor, 'the end of the editing', 10_000);

	// Card Detail stands over the canvas: Enter there edits no card under it.
	fs.writeFileSync(inWorkspace(IMAGE), createSolidPng(16, 16, [200, 120, 60]));
	await cardOf(page, IMAGE).waitFor({ state: 'attached', timeout: 15_000 });
	await waitForReading(() => readFace(page, LONG), reading => reading.selected, 'the card still selected', 5_000);
	await quickOpen(page, IMAGE);
	await page.waitForFunction(() => !!document.querySelector('.basehalf-card-detail.visible'), undefined, { timeout: 10_000 });
	await page.waitForTimeout(400);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(400);
	if ((await readFace(page, LONG)).editor) {
		throw new Error('Enter in Card Detail must not edit the card selected under it');
	}
	await closeCardDetailIfOpen(page);
	fs.rmSync(inWorkspace(IMAGE));
	await cardOf(page, IMAGE).waitFor({ state: 'detached', timeout: 15_000 });

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
	const expand = page.locator('[data-toolbar-item="expand"]');
	await expand.waitFor({ state: 'visible', timeout: 5_000 });
	const fromTheLeft = await page.evaluate(() => [...document.querySelectorAll('.basehalf-canvas-selection-toolbar [data-toolbar-item]')]
		.sort((one, other) => one.getBoundingClientRect().left - other.getBoundingClientRect().left)
		.map(item => item.getAttribute('data-toolbar-item')));
	if (fromTheLeft.length < 2 || fromTheLeft.at(-1) !== 'expand') {
		throw new Error(`Expand must stand at the right end of the toolbar, as a note's does: ${fromTheLeft.join(', ')}`);
	}
	await expand.click({ timeout: 5_000 });
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
	// Read far beyond its head in Source: the card shows the last lines of its head, and not nothing.
	await page.locator('.basehalf-card-detail-surface.active .monaco-editor .view-line').first().waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForTimeout(500);
	await page.keyboard.press('Control+G');
	await page.waitForTimeout(300);
	await page.keyboard.type('40000');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(800);
	await closeCardDetailIfOpen(page);
	const afterSource = await waitForReading(() => readFace(page, LARGE), reading => reading.kind, 'the face of a large file after Source', 5_000);
	await page.waitForTimeout(400);
	const shown = await readFace(page, LARGE);
	if (face.editor || afterSource.editor) {
		throw new Error('A file above 5 MiB is not edited on its card');
	}
	if (shown.lines === 0) {
		throw new Error(`A file above 5 MiB must show the last lines of its head for a place beyond it: ${JSON.stringify(shown)}`);
	}
	fs.rmSync(inWorkspace(LARGE));
}
