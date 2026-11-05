/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The changes of a file: the card of a code file, the marks of a changed card, the
// Changes view of Card Detail and what the rows of Source Control open, and the
// multi-file diff. All on real rows, real buttons, and the fixture's real git.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { workspacePath } from '../../context.mts';
import { commitFixtureChanges, createSilentWav } from '../../fixture.mts';
import { closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { assertCanvasFolder, openRootCanvas, setCanvasZoomPercent } from '../../lib/canvas.mts';
import { quickOpen, runCommand } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';
import { openExplorerRow } from '../../lib/workspace.mts';

const FOLDER = 'changes-smoke';
const CODE = `${FOLDER}/orders.ts`;
const NOTE = `${FOLDER}/plan.md`;
const PICTURE = `${FOLDER}/logo.png`;
const SOUND = `${FOLDER}/tone.wav`;
const LAST_CHANGE = `${FOLDER}/last-change.txt`;
const BINARY = `${FOLDER}/pack.bin`;
const NEW_NOTE = `${FOLDER}/new-note.md`;
const NEW_PICTURE = `${FOLDER}/new-logo.png`;
const UNDER_BH = '.bh/mirror/changes-smoke-record.yaml';

const CODE_LINES = (first: string) => `// A license would stand here.\n\nexport function ${first}(a: number): number {\n\tif (a > 0) {\n\t\treturn a;\n\t}\n\n\treturn ${first}Result;\n}\n`;

function png(red: number): Buffer {
	const chunk = (kind: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(zlib.crc32(body) >>> 0);
		return Buffer.concat([length, body, crc]);
	};
	const width = 40;
	const height = 30;
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const rows = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			rows.set([red, 80, 120], y * (width * 3 + 1) + 1 + x * 3);
		}
	}
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const inWorkspace = (relativePath: string) => path.join(workspacePath, relativePath);
const cardOf = (page, cardPath: string) => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
const rowOf = (page, name: string) => page.locator('.scm-view .monaco-list-row', { hasText: name }).first();

async function showRow(page, name: string) {
	for (let index = 0; index < 16 && !(await rowOf(page, name).count()); index++) {
		const box = await page.locator('.scm-view').first().boundingBox();
		await page.mouse.move(box.x + 60, box.y + 200);
		await page.mouse.wheel(0, index < 8 ? 160 : -160);
		await page.waitForTimeout(200);
	}
	return rowOf(page, name);
}

const readDetail = page => page.evaluate(() => {
	const visible = element => !!element && element.getClientRects().length > 0;
	const detail = document.querySelector('.basehalf-card-detail.visible');
	const diff = detail?.querySelector('.basehalf-card-detail-surface.active .monaco-diff-editor');
	return {
		open: !!detail,
		title: detail?.querySelector('.basehalf-card-detail-title-button')?.textContent ?? null,
		views: detail ? [...detail.querySelectorAll('.basehalf-card-detail-projections .basehalf-card-detail-projection')].map(button => `${button.getAttribute('aria-label')}${button.classList.contains('checked') ? '*' : ''}`) : [],
		diff: visible(diff),
		sideBySide: diff?.classList.contains('side-by-side') ?? null,
		actions: detail ? [...detail.querySelectorAll('.basehalf-card-detail-changes-actions:not([hidden]) button')].map(button => button.getAttribute('aria-label')) : [],
		versions: detail ? [...detail.querySelectorAll('.basehalf-card-detail-surface.active .basehalf-card-detail-changes-caption')].map(caption => caption.textContent) : [],
		overCanvas: !document.querySelector('.basehalf-canvas-on-top')
	};
});

/** A committed folder with a code file, a note, and a picture, then changes to them and new files, as an agent leaves them. */
export async function prepareChangedFiles(page) {
	fs.mkdirSync(inWorkspace(FOLDER), { recursive: true });
	fs.writeFileSync(inWorkspace(CODE), CODE_LINES('before'), 'utf8');
	fs.writeFileSync(inWorkspace(NOTE), '# Plan\n\nThe first line.\n\nThe second line.\n', 'utf8');
	fs.writeFileSync(inWorkspace(PICTURE), png(40));
	fs.writeFileSync(inWorkspace(SOUND), createSilentWav(1));
	fs.writeFileSync(inWorkspace(LAST_CHANGE), 'a line\n', 'utf8');
	fs.writeFileSync(inWorkspace(BINARY), Buffer.from([0, 1, 2, 0, 3]));
	commitFixtureChanges(workspacePath, 'changes smoke: first version');
	fs.writeFileSync(inWorkspace(CODE), CODE_LINES('after'), 'utf8');
	fs.writeFileSync(inWorkspace(NOTE), '# Plan\n\nThe first line, changed.\n\nThe second line.\n', 'utf8');
	fs.writeFileSync(inWorkspace(PICTURE), png(220));
	fs.writeFileSync(inWorkspace(SOUND), createSilentWav(2));
	fs.writeFileSync(inWorkspace(LAST_CHANGE), 'a line, changed\n', 'utf8');
	fs.writeFileSync(inWorkspace(BINARY), Buffer.from([0, 4, 5, 0, 6]));
	fs.writeFileSync(inWorkspace(NEW_NOTE), '# New note\n\nAn agent wrote it.\n', 'utf8');
	fs.writeFileSync(inWorkspace(NEW_PICTURE), png(120));
	fs.mkdirSync(path.dirname(inWorkspace(UNDER_BH)), { recursive: true });
	fs.writeFileSync(inWorkspace(UNDER_BH), 'a: 1\n', 'utf8');
	await runCommand(page, 'Git: Refresh');
	await runCommand(page, 'Source Control: Focus on Changes View');
	await (await showRow(page, 'orders.ts')).waitFor({ state: 'attached', timeout: 20_000 });
}

/** A code card shows the file as the editor does (note rendering, rule 33), and a note and plain text stay in one color. */
export async function assertCodeCardAsTheEditor(page) {
	await openRootCanvas(page);
	await cardOf(page, FOLDER).dblclick({ timeout: 10_000 });
	await assertCanvasFolder(page, FOLDER);
	const code = await waitForReading(() => cardOf(page, CODE).locator('.basehalf-canvas-card-preview').evaluate(preview => {
		const style = getComputedStyle(preview);
		const lines = [...preview.querySelectorAll<HTMLElement>('.basehalf-canvas-code-line')].sort((a, b) => Number.parseFloat(a.style.top) - Number.parseFloat(b.style.top));
		return {
			kind: preview.classList.contains('kind-code'),
			whiteSpace: style.whiteSpace,
			tabSize: style.tabSize,
			text: lines.map(line => line.textContent).join('\n'),
			colors: new Set([...preview.querySelectorAll('span[class*="mtk"]')].map(span => getComputedStyle(span).color)).size
		};
	}), reading => reading.kind && reading.colors > 2, 'a code card in the colors of its language', 20_000);
	if (code.whiteSpace !== 'pre' || code.tabSize !== '4' || !code.text.startsWith('// A license would stand here.\n\nexport function after') || !code.text.includes('\n\tif (a > ')) {
		throw new Error(`A code card must show its file from line 1 with its indentation and blank lines: ${JSON.stringify(code)}`);
	}
	const note = await cardOf(page, NOTE).locator('.basehalf-canvas-card-preview').evaluate(preview => ({ kind: preview.classList.contains('kind-markdown'), colored: preview.querySelectorAll('span[class*="mtk"]').length }));
	if (!note.kind || note.colored !== 0) {
		throw new Error(`A note must keep its card, in one color: ${JSON.stringify(note)}`);
	}
}

/** The marks of changed cards: the letter and color of Files, and a bar of 3 screen pixels at every zoom. */
export async function assertChangedCardsAreMarked(page) {
	const readMarks = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.basehalf-canvas-card')].map(card => {
		const letter = card.querySelector('.basehalf-canvas-card-caption .basehalf-canvas-card-change');
		const bar = card.querySelector('.basehalf-canvas-card-change-bar');
		return [card.getAttribute('data-basehalf-card-path'), {
			letter: letter ? getComputedStyle(letter, '::after').content.replace(/"/g, '') : null,
			bar: bar ? bar.getBoundingClientRect().width : null,
			color: getComputedStyle(card.querySelector('.basehalf-canvas-card-label')).color
		}];
	})));
	const marks = await waitForReading(readMarks, reading => reading[CODE]?.letter === 'M' && reading[NEW_NOTE]?.letter === 'U' && reading[PICTURE]?.letter === 'M', 'the marks of the changed cards', 20_000);
	if (marks[CODE].color === marks[`${FOLDER}/unchanged.txt`]?.color) {
		throw new Error('A changed card must have the color of Files on its name');
	}
	for (const percent of [150, 50]) {
		await setCanvasZoomPercent(page, percent);
		const bar = await waitForReading(readMarks, reading => Math.abs((reading[CODE]?.bar ?? 0) - 3) < 0.2, `a bar of 3 screen pixels at ${percent}%`, 5_000);
		if (Math.abs(bar[CODE].bar - 3) >= 0.2) {
			throw new Error(`The bar must be 3 screen pixels at ${percent}%: ${bar[CODE].bar}`);
		}
	}
	await setCanvasZoomPercent(page, 100);

	// The folder of the changes has the mark with a dot, and its list says what changed.
	await openRootCanvas(page);
	const folder = await waitForReading(() => cardOf(page, FOLDER).evaluate(card => ({
		bar: !!card.querySelector('.basehalf-canvas-card-change-bar'),
		rows: [...card.querySelectorAll('.basehalf-canvas-folder-preview-row')].map(row => [row.querySelector('.basehalf-canvas-folder-preview-label')?.textContent, row.querySelector('.basehalf-canvas-card-change') ? getComputedStyle(row.querySelector('.basehalf-canvas-card-change'), '::after').content.replace(/"/g, '') : null])
	})), reading => reading.bar && reading.rows.some(([name, letter]) => name === 'orders.ts' && letter === 'M'), 'the mark of a folder that holds changes', 15_000);
	if (!folder.rows.some(([name, letter]) => name === 'new-note' && letter === 'U')) {
		throw new Error(`The list of a folder must say what Files says: ${JSON.stringify(folder.rows)}`);
	}

	// A click on the letter opens the Changes view and selects no card.
	await cardOf(page, FOLDER).dblclick({ timeout: 10_000 });
	await assertCanvasFolder(page, FOLDER);
	// All the cards in the view, away from the side bar.
	await setCanvasZoomPercent(page, 50);
	await cardOf(page, CODE).locator('.basehalf-canvas-card-caption .basehalf-canvas-card-change').click({ timeout: 10_000 });
	const opened = await waitForReading(() => readDetail(page), reading => reading.diff, 'the Changes view from the letter', 10_000);
	if (opened.title !== 'orders.ts' || opened.views.join() !== 'Source,Changes*') {
		throw new Error(`The letter must open the Changes view: ${JSON.stringify(opened)}`);
	}
	await closeCardDetailIfOpen(page);
}

/** A changed file opens at its usual view from everywhere but its row and its letter: Quick Open, Files, and its card. */
export async function assertChangedFileOpensAsUsual(page) {
	const assertUsual = async (from: string) => {
		const shown = await waitForReading(() => readDetail(page), reading => reading.title === 'orders.ts' && reading.views.length > 0, `the changed file from ${from}`, 10_000);
		if (shown.views.join() !== 'Source*,Changes') {
			throw new Error(`A changed file must open at its usual view from ${from}: ${JSON.stringify(shown)}`);
		}
		await closeCardDetailIfOpen(page);
	};
	await quickOpen(page, CODE);
	await assertUsual('Quick Open');
	await openExplorerRow(page, FOLDER);
	await openExplorerRow(page, 'orders.ts');
	await assertUsual('Files');
	await assertCanvasFolder(page, FOLDER);
	// A double click edits a code card where it stands, and Expand opens it.
	await cardOf(page, CODE).locator('.basehalf-canvas-code-scroller').click({ timeout: 10_000 });
	await page.locator('[data-toolbar-item="expand"]').click({ timeout: 10_000 });
	await assertUsual('its card');
}

/** A row opens the Changes view; the view shows the diff, and typing, Revert Block, and Escape work in it. */
export async function assertRowOpensTheChangesView(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	await (await showRow(page, 'orders.ts')).click({ timeout: 10_000 });
	const shown = await waitForReading(() => readDetail(page), reading => reading.diff, 'the Changes view from a row', 10_000);
	if (shown.title !== 'orders.ts' || shown.views.join() !== 'Source,Changes*' || shown.overCanvas || shown.actions.join() !== 'Previous Change,Next Change,Inline View') {
		throw new Error(`A row must open Card Detail at the Changes view: ${JSON.stringify(shown)}`);
	}
	if (!await page.evaluate(() => !!document.activeElement?.closest('.scm-view'))) {
		throw new Error('The keyboard must stay in the list after a click on a row');
	}
	// Next Change works from there too, as in VS Code.
	const cursorOn = (text: string) => page.evaluate(wanted => {
		const editor = document.querySelector('.basehalf-card-detail-surface.active .editor.modified');
		const cursor = editor?.querySelector('.cursors-layer .cursor')?.getBoundingClientRect();
		const line = [...(editor?.querySelectorAll('.view-line') ?? [])].find(element => element.textContent?.includes(wanted))?.getBoundingClientRect();
		return !!cursor && !!line && Math.abs(cursor.top - line.top) < 4;
	}, text);
	await waitForReading(() => cursorOn('after('), onIt => onIt, 'the first change in sight', 5_000);
	await page.keyboard.press('Alt+F5');
	await waitForReading(() => cursorOn('afterResult'), onIt => onIt, 'Alt-F5 to go to the next change with the keyboard in the list', 5_000);
	await page.keyboard.press('Shift+Alt+F5');
	await waitForReading(() => cursorOn('after('), onIt => onIt, 'Shift-Alt-F5 to go back with the keyboard in the list', 5_000);
	// The same row again, with Card Detail of the file open: the view stays.
	await (await showRow(page, 'orders.ts')).click({ timeout: 10_000 });
	await page.waitForTimeout(800);
	if (!(await readDetail(page)).diff) {
		throw new Error('A click on the row of the open file must leave its Changes view open');
	}

	// The right side is the file: a space, typed, reaches it, and Source shows it.
	const modified = page.locator('.basehalf-card-detail-surface.active .editor.modified .view-lines');
	await modified.click({ position: { x: 300, y: 10 } });
	await page.keyboard.press('Meta+ArrowUp');
	await page.keyboard.type('// typed in the view\n');
	// The fixture saves after a long delay, so that a step decides when: the key saves here as in Source.
	await page.keyboard.press('Meta+S');
	await waitUntil(() => fs.readFileSync(inWorkspace(CODE), 'utf8').startsWith('// typed in the view\n'), 'typed text with its spaces to reach the file', 10_000);
	await page.locator('.basehalf-card-detail-projection[aria-label="Source"]').click();
	await waitForReading(() => page.evaluate(() => document.querySelector('.basehalf-card-detail-surface.active .view-line')?.textContent?.replace(/ /g, ' ')), line => line === '// typed in the view', 'Source to show what was typed in the view', 10_000);
	await page.locator('.basehalf-card-detail-projection[aria-label="Changes"]').click();
	await waitForReading(() => readDetail(page), reading => reading.diff, 'the Changes view again', 10_000);

	// Revert Block, as VS Code has it, changes the file.
	const lengthBefore = fs.readFileSync(inWorkspace(CODE), 'utf8').length;
	// The toolbar of a block is drawn again when the view comes back: it takes a click once it stands.
	await page.waitForTimeout(600);
	const revert = page.locator('.basehalf-card-detail-surface.active .gutter .action-label[aria-label="Revert Block"]').first();
	await revert.hover({ timeout: 10_000 });
	await page.waitForTimeout(200);
	await revert.click({ timeout: 10_000 });
	await waitForReading(() => page.evaluate(() => document.querySelector('.basehalf-card-detail-surface.active .editor.modified .view-line')?.textContent?.replace(/\u00a0/g, ' ')), line => line !== '// typed in the view', 'Revert Block to change the right side', 5_000);
	await modified.click({ position: { x: 300, y: 10 } });
	await page.keyboard.press('Meta+S');
	await waitUntil(() => fs.readFileSync(inWorkspace(CODE), 'utf8').length !== lengthBefore, 'Revert Block to change the file', 10_000);

	// Find takes Escape first, and then Escape from the diff closes Card Detail.
	await modified.click({ position: { x: 300, y: 10 } });
	await page.keyboard.press('Meta+F');
	const find = page.locator('.basehalf-card-detail-surface.active .find-widget.visible');
	await find.first().waitFor({ state: 'visible', timeout: 5_000 });
	await page.keyboard.press('Escape');
	await waitForReading(() => find.count(), count => count === 0, 'Escape to close Find', 5_000);
	if (!(await readDetail(page)).open) {
		throw new Error('Escape must close Find and leave Card Detail open');
	}
	await page.keyboard.press('Escape');
	await waitForReading(() => readDetail(page), reading => !reading.open, 'Escape to close Card Detail', 5_000);
}

/** When the last change goes, the file's usual view shows, with the keyboard in it. */
export async function assertLastChangeGoes(page) {
	await (await showRow(page, 'last-change.txt')).click({ timeout: 10_000 });
	await waitForReading(() => readDetail(page), reading => reading.diff && reading.title === 'last-change.txt', 'the Changes view of a file with one change', 10_000);
	await page.locator('.basehalf-card-detail-surface.active .editor.modified .view-lines').click({ position: { x: 100, y: 10 } });
	// Written back from outside, as an agent or Revert Block leaves it.
	fs.writeFileSync(inWorkspace(LAST_CHANGE), 'a line\n', 'utf8');
	await waitForReading(() => readDetail(page), reading => reading.open && !reading.diff, 'the usual view once the last change went', 15_000);
	if (!await page.evaluate(() => !!document.activeElement?.closest('.basehalf-card-detail-surface.active'))) {
		throw new Error('The keyboard must go with the view when the last change goes');
	}
	await page.keyboard.press('Escape');
	await waitForReading(() => readDetail(page), reading => !reading.open, 'Escape to close Card Detail after the last change went', 5_000);
}

/** A new file opens as usual, and a picture shows its two versions; a file under `.bh` stays VS Code's. */
export async function assertRowsOfOtherKinds(page) {
	await (await showRow(page, 'new-note')).click({ timeout: 10_000 });
	const note = await waitForReading(() => readDetail(page), reading => reading.title === 'new-note', 'a new note from its row', 10_000);
	if (note.views.join() !== 'Rich*,Preview,Source') {
		throw new Error(`A new note must open as usual, in Rich: ${JSON.stringify(note)}`);
	}
	await closeCardDetailIfOpen(page);

	await (await showRow(page, 'logo.png')).click({ timeout: 10_000 });
	const picture = await waitForReading(() => readDetail(page), reading => reading.versions.length === 2 && reading.versions.every(text => text.includes('×')), 'the two versions of a picture', 10_000);
	if (picture.views.join() !== 'View,Changes*' || !picture.versions[0].startsWith('Before') || !picture.versions[1].startsWith('Now')) {
		throw new Error(`A changed picture must show Before and Now: ${JSON.stringify(picture)}`);
	}
	await closeCardDetailIfOpen(page);

	await (await showRow(page, 'new-logo.png')).click({ timeout: 10_000 });
	const newPicture = await waitForReading(() => readDetail(page), reading => reading.title === 'new-logo.png', 'a new picture from its row', 10_000);
	if (newPicture.views.includes('Changes') || newPicture.overCanvas) {
		throw new Error(`A new picture must open in its viewer: ${JSON.stringify(newPicture)}`);
	}
	await closeCardDetailIfOpen(page);

	// A file that turns out not to be text: Changes gives way to its usual view, which shows, and a press on the switch leaves Escape working.
	await quickOpen(page, BINARY);
	await waitForReading(() => readDetail(page), reading => reading.title === 'pack.bin' && reading.views.join() === 'Source*,Changes', 'a changed binary file at its usual view', 10_000);
	await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="Changes"]').click({ timeout: 5_000 });
	await waitForReading(() => readDetail(page), reading => reading.views.length === 0, 'a binary file to lose the Changes view', 10_000);
	await page.waitForTimeout(500);
	const binary = await page.evaluate(() => ({
		active: document.querySelector('.basehalf-card-detail-surface.active .basehalf-card-detail-source-notice')?.textContent ?? null,
		actions: [...document.querySelectorAll('.basehalf-card-detail-changes-actions:not([hidden]) button')].length
	}));
	if (!binary.active?.includes('binary') || binary.actions !== 0) {
		throw new Error(`A binary file must show its usual view, not an empty Changes view: ${JSON.stringify(binary)}`);
	}
	await page.keyboard.press('Escape');
	await waitForReading(() => readDetail(page), reading => !reading.open, 'Escape to close Card Detail after a press on the switch', 5_000);
}

/** The two views of a changed sound take turns: neither's controls show over the other, each version plays in place, one at a time, and what plays stops with its view. */
export async function assertViewsOfASoundTakeTurns(page) {
	const readViews = () => page.evaluate(() => {
		const shown = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
		const bars = selector => [...document.querySelectorAll(`.basehalf-card-detail-surface${selector} .basehalf-canvas-video-player-bar`)].filter(shown).length;
		return {
			barsOfShownView: bars('.active'),
			barsOfOtherView: bars(':not(.active)'),
			waveformPlay: document.querySelector('.basehalf-sound-waveform-play')?.getAttribute('aria-label') ?? null,
			waveformReady: document.querySelector('.basehalf-sound-waveform-play')?.getAttribute('aria-disabled') === 'false',
			// What it is stands right under each version.
			captionGaps: [...document.querySelectorAll('.basehalf-card-detail-surface.active .basehalf-card-detail-changes-version')].map(version => {
				const player = version.querySelector('.basehalf-canvas-video-player').getBoundingClientRect();
				return Math.round(version.querySelector('.basehalf-card-detail-changes-caption').getBoundingClientRect().top - player.bottom);
			})
		};
	});
	const choose = view => page.locator(`.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="${view}"]`).click({ timeout: 5_000 });

	await (await showRow(page, 'tone.wav')).click({ timeout: 10_000 });
	const changes = await waitForReading(readViews, reading => reading.barsOfShownView === 2, 'the two players of a changed sound', 10_000);
	if (!changes.captionGaps.every(gap => gap >= 0 && gap <= 16)) {
		throw new Error(`Before and Now must stand right under their versions: ${JSON.stringify(changes)}`);
	}
	const played = await page.evaluate(async () => {
		const media = [...document.querySelectorAll('.basehalf-card-detail-surface.active .basehalf-card-detail-changes-stage video')];
		media.forEach(element => { element.muted = true; });
		await media[0].play();
		await media[1].play();
		await new Promise(resolve => setTimeout(resolve, 300));
		return media.map(element => element.paused);
	});
	if (played.join() !== 'true,false') {
		throw new Error(`Starting one version must pause the other: ${JSON.stringify(played)}`);
	}

	await choose('View');
	const view = await waitForReading(readViews, reading => reading.waveformReady, 'the waveform of the changed sound', 10_000);
	if (view.barsOfOtherView !== 0) {
		throw new Error(`The controls of the Changes view must not show over the file's view: ${JSON.stringify(view)}`);
	}
	await page.locator('.basehalf-card-detail-surface.active .basehalf-sound-waveform-play').click({ timeout: 5_000 });
	await waitForReading(readViews, reading => reading.waveformPlay === 'Pause', 'the waveform playing', 5_000);
	await choose('Changes');
	const back = await waitForReading(readViews, reading => reading.barsOfShownView === 2, 'the players of Changes again', 5_000);
	if (back.waveformPlay !== 'Play') {
		throw new Error(`What plays must stop with its view: ${JSON.stringify(back)}`);
	}
	await closeCardDetailIfOpen(page);
}

/** Open Changes on a group of Source Control. */
async function openChangesOfGroup(page, title: RegExp) {
	const groups = page.locator('.scm-view .monaco-list-row:has(.resource-group)');
	for (let index = 0; index < await groups.count(); index++) {
		if (title.test(await groups.nth(index).innerText())) {
			await groups.nth(index).hover();
			await groups.nth(index).locator('.action-label[aria-label^="Open"]').first().click({ timeout: 10_000 });
			return;
		}
	}
	throw new Error(`No group of Source Control matches ${title}`);
}

/** The multi-file diff lists every changed file but those under `.bh`, a row shows its file in it, and Escape closes it. */
export async function assertMultiFileDiff(page) {
	await openChangesOfGroup(page, /^Changes/m);
	await page.locator('.multiDiffEntry').first().waitFor({ state: 'visible', timeout: 15_000 });
	const box = await page.locator('.multiDiffEditor').first().boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const titles = new Set<string>();
	let placeholder = false;
	for (let index = 0; index < 50; index++) {
		const shown = await page.evaluate(() => [...document.querySelectorAll('.multiDiffEntry')].map(entry => ({
			title: (entry.querySelector('.header .file-path')?.textContent ?? '').trim(),
			binary: getComputedStyle(entry.querySelector('.binary-file-placeholder') ?? document.body).display === 'grid'
		})));
		for (const { title, binary } of shown) {
			titles.add(title);
			placeholder ||= binary && title.startsWith('logo.png');
		}
		await page.mouse.wheel(0, 300);
		await page.waitForTimeout(30);
	}
	const names = [...titles];
	if (names.some(name => name.includes('changes-smoke-record') || name.includes('.bh/'))) {
		throw new Error(`The multi-file diff must leave out files under .bh: ${JSON.stringify(names)}`);
	}
	if (!['orders.ts', 'plan', 'logo.png', 'new-logo.png'].every(name => names.some(title => title.startsWith(name))) || !placeholder) {
		throw new Error(`The multi-file diff must list every changed file, binary ones as placeholders: ${JSON.stringify({ names, placeholder })}`);
	}

	// A row shows its file in it, and does not open Card Detail. From the end of the list, to a file above what shows.
	const titlesInView = () => page.evaluate(() => {
		const view = document.querySelector('.multiDiffEditor').getBoundingClientRect();
		return [...document.querySelectorAll('.multiDiffEntry')].filter(entry => {
			const header = entry.querySelector('.header').getBoundingClientRect();
			return header.height > 0 && header.top >= view.top - 1 && header.bottom <= view.bottom;
		}).map(entry => (entry.querySelector('.header .file-path')?.textContent ?? '').trim());
	});
	await (await showRow(page, 'plan')).click({ timeout: 10_000 });
	const inView = await waitForReading(titlesInView, titles => titles.some(title => title.startsWith('plan')), 'a row to show its file in the multi-file diff', 5_000);
	if ((await readDetail(page)).open) {
		throw new Error(`A row must not open Card Detail while the multi-file diff is open: ${JSON.stringify(inView)}`);
	}

	// Escape closes it once the editor has nothing else to do with the key.
	const line = await page.evaluate(() => {
		const view = document.querySelector('.multiDiffEditor').getBoundingClientRect();
		const shown = [...document.querySelectorAll('.multiDiffEntry .editor.modified .view-line')].map(element => element.getBoundingClientRect()).find(rect => rect.height > 0 && rect.top > view.top + 60 && rect.bottom < view.bottom);
		return shown && { x: shown.x + 40, y: shown.y + shown.height / 2 };
	});
	await page.mouse.click(line.x, line.y);
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !!document.querySelector('.basehalf-canvas-on-top'), null, { timeout: 5_000 });

	// A row of what it leaves out opens VS Code's editor of that file, not an error in its place.
	await openChangesOfGroup(page, /^Changes/m);
	await page.locator('.multiDiffEntry').first().waitFor({ state: 'visible', timeout: 15_000 });
	await (await showRow(page, '.bh')).click({ timeout: 10_000 });
	await (await showRow(page, 'changes-smoke-record')).click({ timeout: 10_000 });
	const underBh = page.locator('.part.editor .editor-instance .monaco-editor .view-line', { hasText: 'a: 1' });
	await underBh.first().waitFor({ state: 'visible', timeout: 10_000 });
	await page.locator('.part.titlebar .action-label[aria-label^="Close"]').first().click({ timeout: 10_000 });
	await page.waitForFunction(() => !!document.querySelector('.basehalf-canvas-on-top'), null, { timeout: 5_000 });
}

/** A picture only under Staged Changes, whose versions are both in git: its button in the multi-file diff opens the file. */
export async function assertStagedBinaryOpens(page) {
	execFileSync('git', ['add', PICTURE], { cwd: workspacePath, stdio: 'ignore' });
	await runCommand(page, 'Git: Refresh');
	await runCommand(page, 'Source Control: Focus on Changes View');
	const groups = page.locator('.scm-view .monaco-list-row:has(.resource-group)');
	await waitForReading(() => groups.first().innerText(), text => /^Staged Changes/m.test(text), 'the group of what is staged', 15_000);
	await openChangesOfGroup(page, /^Staged Changes/m);
	const entry = page.locator('.multiDiffEntry', { hasText: 'logo.png' }).first();
	await entry.locator('.binary-file-placeholder-actions .monaco-text-button').click({ timeout: 15_000 });
	const opened = await waitForReading(() => readDetail(page), reading => reading.title === 'logo.png' && reading.views.length > 0, 'the staged picture from its button', 10_000);
	if (opened.views.join() !== 'View,Changes*' || opened.overCanvas) {
		throw new Error(`The button of a staged picture must open its Changes view: ${JSON.stringify(opened)}`);
	}
	await closeCardDetailIfOpen(page);
	execFileSync('git', ['reset', '-q', '--', PICTURE], { cwd: workspacePath, stdio: 'ignore' });
	await runCommand(page, 'Git: Refresh');
}

/** Under an editor over the canvas Card Detail comes to the front, and none stays behind it; walking the results of Quick Search closes nothing. */
export async function assertWhatOpenedLastIsInFront(page) {
	// A deleted file's row leaves VS Code's editor over the canvas, and with no tabs a pinned one stays behind the next.
	const deletedFiles = ['deleted.txt', 'deleted-2.txt'].map(name => inWorkspace(`${FOLDER}/${name}`));
	for (const deleted of deletedFiles) {
		fs.writeFileSync(deleted, 'a line\n', 'utf8');
	}
	// Only these files: the other changes stay, for the row that follows.
	execFileSync('git', ['add', ...deletedFiles], { cwd: workspacePath, stdio: 'ignore' });
	execFileSync('git', ['commit', '-m', 'changes smoke: files to delete', '--', ...deletedFiles], { cwd: workspacePath, stdio: 'ignore' });
	deletedFiles.forEach(deleted => fs.rmSync(deleted));
	await runCommand(page, 'Git: Refresh');
	await runCommand(page, 'Source Control: Focus on Changes View');
	await (await showRow(page, 'deleted.txt')).dblclick({ timeout: 20_000 });
	await waitForReading(() => readDetail(page), reading => reading.overCanvas && !reading.open, 'the editor of a deleted file over the canvas', 10_000);
	await (await showRow(page, 'deleted-2.txt')).click({ timeout: 10_000 });
	await page.waitForTimeout(500);

	await page.keyboard.press('Meta+P');
	const search = page.locator('.quick-input-widget input').first();
	await search.waitFor({ state: 'visible', timeout: 10_000 });
	await search.fill('%The second line');
	await page.waitForTimeout(1_500);
	await page.keyboard.press('ArrowDown');
	await page.waitForTimeout(800);
	const walking = await readDetail(page);
	await page.keyboard.press('Escape');
	await search.waitFor({ state: 'hidden', timeout: 10_000 });
	const walked = await readDetail(page);
	if (!walking.overCanvas || !walked.overCanvas) {
		throw new Error(`Walking the results of Quick Search must close no editor over the canvas: ${JSON.stringify({ walking, walked })}`);
	}

	await (await showRow(page, 'plan')).click({ timeout: 10_000 });
	await waitForReading(() => readDetail(page), reading => reading.diff, 'Card Detail over that editor', 10_000);
	await page.waitForTimeout(800);
	const detail = await readDetail(page);
	if (detail.overCanvas || !detail.diff) {
		throw new Error(`Card Detail must come to the front, with no editor left behind it: ${JSON.stringify(detail)}`);
	}
	await closeCardDetailIfOpen(page);
}

/** A space reaches the commit message box, an editor of the kind the canvas library used to take the key from. */
export async function assertCommitBoxTakesSpaces(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	// The rows walked before may have scrolled it away.
	const list = await page.locator('.scm-view').first().boundingBox();
	await page.mouse.move(list.x + 60, list.y + 200);
	await page.mouse.wheel(0, -4000);
	await page.waitForTimeout(300);
	await page.locator('.scm-editor').first().click({ timeout: 10_000 });
	await page.keyboard.type('a message with spaces');
	const text = await waitForReading(() => page.evaluate(() => document.querySelector('.scm-editor .view-line')?.textContent?.replace(/ /g, ' ')), value => value === 'a message with spaces', 'spaces in the commit message box', 5_000);
	await page.keyboard.press('Meta+A');
	await page.keyboard.press('Backspace');
	return text;
}

/** Leaves the fixture as the next steps expect it: nothing changed. */
/** A real conflict opens in VS Code's editor with its two sides in colors and its actions, and an action takes a side (D123). */
export async function assertConflictHasItsActions(page) {
	const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, stdio: 'pipe', encoding: 'utf8' }).trim();
	const name = 'conflict-smoke.txt';
	const side = 'conflict-smoke';
	const start = git('rev-parse', 'HEAD');
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
	fs.writeFileSync(inWorkspace(name), 'line one\nthe line\nline three\n', 'utf8');
	commitFixtureChanges(workspacePath, 'conflict smoke: the first version');
	git('checkout', '-q', '-b', side);
	fs.writeFileSync(inWorkspace(name), 'line one\nthe line from the side\nline three\n', 'utf8');
	git('commit', '-q', '-am', 'conflict smoke: the side');
	git('checkout', '-q', branch);
	fs.writeFileSync(inWorkspace(name), 'line one\nthe line from here\nline three\n', 'utf8');
	git('commit', '-q', '-am', 'conflict smoke: here');
	try {
		git('merge', side);
		throw new Error('The merge must end in a conflict.');
	} catch (error) {
		if (!git('status', '--porcelain').includes(`UU ${name}`)) {
			throw error;
		}
	}
	try {
		await runCommand(page, 'Git: Refresh');
		await runCommand(page, 'Source Control: Focus on Changes View');
		await (await showRow(page, name)).click({ timeout: 20_000 });
		const accept = page.locator('.part.editor .codelens-decoration a', { hasText: 'Accept Incoming Change' });
		await accept.waitFor({ state: 'visible', timeout: 20_000 });
		const actions = await page.locator('.part.editor .codelens-decoration a').allInnerTexts();
		if (actions.join() !== 'Accept Current Change,Accept Incoming Change,Accept Both Changes,Compare Changes') {
			throw new Error(`A conflict must offer its actions: ${actions.join()}`);
		}
		if (await page.locator('.part.editor [class*="ced-"]').count() === 0) {
			throw new Error('A conflict must show its two sides in colors.');
		}
		await accept.click({ timeout: 5_000 });
		// The editor draws a space as a no-break space.
		const lines = async () => (await page.locator('.part.editor .view-lines').first().innerText()).replace(/\u00a0/g, ' ');
		await waitForReading(lines, text => /the line from the side/.test(text) && !/<<<<<<<|the line from here/.test(text), 'the action to take the incoming side', 10_000);
	} finally {
		await runCommand(page, 'File: Revert File');
		await runCommand(page, 'View: Close All Editors');
		git('merge', '--abort');
		git('branch', '-D', side);
		git('reset', '-q', '--hard', start);
		await runCommand(page, 'Git: Refresh');
	}
}

/** VS Code's editor shows a picture Git opens there, a deleted one and one of a commit in Graph, and does not say that it cannot (D123). */
export async function assertPicturesInTheEditor(page) {
	const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, stdio: 'pipe', encoding: 'utf8' }).trim();
	const shown = async (what: string) => {
		await page.locator('.part.statusbar .statusbar-item', { hasText: 'Whole Image' }).first().waitFor({ state: 'visible', timeout: 20_000 });
		if (await page.locator('.part.editor', { hasText: 'not displayed in the text editor' }).count()) {
			throw new Error(`${what} must show, not say that it cannot.`);
		}
		await runCommand(page, 'View: Close All Editors');
	};
	const start = git('rev-parse', 'HEAD');
	try {
		fs.rmSync(inWorkspace(PICTURE));
		await runCommand(page, 'Git: Refresh');
		await runCommand(page, 'Source Control: Focus on Changes View');
		await (await showRow(page, 'logo.png')).click({ timeout: 20_000 });
		await shown('A deleted picture');
		git('checkout', '-q', '--', PICTURE);

		const inCommit = 'picture-of-a-commit.png';
		fs.writeFileSync(inWorkspace(inCommit), png(180));
		commitFixtureChanges(workspacePath, 'graph smoke: a picture');
		await runCommand(page, 'Git: Refresh');
		await runCommand(page, 'Source Control: Focus on Changes View');
		const rows = page.locator('.part.sidebar .monaco-list-row');
		await rows.filter({ hasText: 'graph smoke: a picture' }).first().click({ timeout: 20_000 });
		await rows.filter({ hasText: inCommit }).first().click({ timeout: 20_000 });
		await shown('A picture of a commit');
	} finally {
		await runCommand(page, 'View: Close All Editors');
		git('reset', '-q', '--hard', start);
		await runCommand(page, 'Git: Refresh');
	}
}

export async function finishChangedFiles(page) {
	await closeCardDetailIfOpen(page);
	await runCommand(page, 'View: Close All Editors');
	fs.rmSync(inWorkspace(UNDER_BH), { force: true });
	commitFixtureChanges(workspacePath, 'changes smoke: the last version');
	await runCommand(page, 'Git: Refresh');
}
