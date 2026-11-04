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
import { commitFixtureChanges } from '../../fixture.mts';
import { closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { assertCanvasFolder, openRootCanvas, setCanvasZoomPercent } from '../../lib/canvas.mts';
import { runCommand } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

const FOLDER = 'changes-smoke';
const CODE = `${FOLDER}/orders.ts`;
const NOTE = `${FOLDER}/plan.md`;
const PICTURE = `${FOLDER}/logo.png`;
const NEW_NOTE = `${FOLDER}/new-note.md`;
const NEW_PICTURE = `${FOLDER}/new-logo.png`;
const UNDER_BH = '.bh/mirror/changes-smoke-record.yaml';

const CODE_LINES = (first: string) => `// A license would stand here.\n\nexport function ${first}(a: number): number {\n\tif (a > 0) {\n\t\treturn a;\n\t}\n\n\treturn 0;\n}\n`;

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
	commitFixtureChanges(workspacePath, 'changes smoke: first version');
	fs.writeFileSync(inWorkspace(CODE), CODE_LINES('after'), 'utf8');
	fs.writeFileSync(inWorkspace(NOTE), '# Plan\n\nThe first line, changed.\n\nThe second line.\n', 'utf8');
	fs.writeFileSync(inWorkspace(PICTURE), png(220));
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
		return {
			kind: preview.classList.contains('kind-code'),
			whiteSpace: style.whiteSpace,
			tabSize: style.tabSize,
			text: preview.textContent,
			colors: new Set([...preview.querySelectorAll('span[class*="mtk"]')].map(span => getComputedStyle(span).color)).size
		};
	}), reading => reading.kind && reading.colors > 2, 'a code card in the colors of its language', 20_000);
	if (code.whiteSpace !== 'pre' || code.tabSize !== '4' || !code.text.startsWith('// A license would stand here.\n\nexport function after') || !code.text.includes('\n\tif (a > 0) {\n\t\treturn a;')) {
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
	await cardOf(page, CODE).locator('.basehalf-canvas-card-caption .basehalf-canvas-card-change').click({ timeout: 10_000 });
	const opened = await waitForReading(() => readDetail(page), reading => reading.diff, 'the Changes view from the letter', 10_000);
	if (opened.title !== 'orders.ts' || opened.views.join() !== 'Source,Changes*') {
		throw new Error(`The letter must open the Changes view: ${JSON.stringify(opened)}`);
	}
	await closeCardDetailIfOpen(page);
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

	// Escape from the diff closes Card Detail.
	await modified.click({ position: { x: 300, y: 10 } });
	await page.keyboard.press('Escape');
	await waitForReading(() => readDetail(page), reading => !reading.open, 'Escape to close Card Detail', 5_000);
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
}

/** The multi-file diff lists every changed file but those under `.bh`, a row shows its file in it, and Escape closes it. */
export async function assertMultiFileDiff(page) {
	const groups = page.locator('.scm-view .monaco-list-row:has(.resource-group)');
	for (let index = 0; index < await groups.count(); index++) {
		if (/^Changes/m.test(await groups.nth(index).innerText())) {
			await groups.nth(index).hover();
			await groups.nth(index).locator('.action-label[aria-label^="Open Changes"]').first().click({ timeout: 10_000 });
			break;
		}
	}
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
}

/** Under an editor over the canvas Card Detail comes to the front; over Card Detail a diff of its file stays. */
export async function assertWhatOpenedLastIsInFront(page) {
	// A deleted file's row leaves VS Code's editor over the canvas.
	const deleted = inWorkspace(`${FOLDER}/deleted.txt`);
	fs.writeFileSync(deleted, 'a line\n', 'utf8');
	// Only this file: the other changes stay, for the row that follows.
	execFileSync('git', ['add', deleted], { cwd: workspacePath, stdio: 'ignore' });
	execFileSync('git', ['commit', '-m', 'changes smoke: a file to delete', '--', deleted], { cwd: workspacePath, stdio: 'ignore' });
	fs.rmSync(deleted);
	await runCommand(page, 'Git: Refresh');
	await runCommand(page, 'Source Control: Focus on Changes View');
	await (await showRow(page, 'deleted.txt')).click({ timeout: 20_000 });
	await waitForReading(() => readDetail(page), reading => reading.overCanvas && !reading.open, 'the editor of a deleted file over the canvas', 10_000);

	await (await showRow(page, 'plan')).click({ timeout: 10_000 });
	const detail = await waitForReading(() => readDetail(page), reading => reading.diff, 'Card Detail over that editor', 10_000);
	if (detail.overCanvas) {
		throw new Error(`Card Detail must come to the front of an editor over the canvas: ${JSON.stringify(detail)}`);
	}
	await closeCardDetailIfOpen(page);
}

/** A space reaches the commit message box, an editor of the kind the canvas library used to take the key from. */
export async function assertCommitBoxTakesSpaces(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	await page.locator('.scm-editor').first().click({ timeout: 10_000 });
	await page.keyboard.type('a message with spaces');
	const text = await waitForReading(() => page.evaluate(() => document.querySelector('.scm-editor .view-line')?.textContent?.replace(/ /g, ' ')), value => value === 'a message with spaces', 'spaces in the commit message box', 5_000);
	await page.keyboard.press('Meta+A');
	await page.keyboard.press('Backspace');
	return text;
}

/** Leaves the fixture as the next steps expect it: nothing changed. */
export async function finishChangedFiles(page) {
	await closeCardDetailIfOpen(page);
	await runCommand(page, 'View: Close All Editors');
	fs.rmSync(inWorkspace(UNDER_BH), { force: true });
	commitFixtureChanges(workspacePath, 'changes smoke: the last version');
	await runCommand(page, 'Git: Refresh');
}
