/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What BaseHalf draws follows the settings of the workbench (D139): the back and forward buttons of a mouse, the
// file that Files reveals, the title of the window, what a save keeps of a note, and reduced motion.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { waitForViewTransitions } from '../../app.mts';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, openRootCanvas } from '../../lib/canvas.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';
import { showExplorer } from '../../lib/workspace.mts';

const SETTINGS = path.join(workspacePath, '.vscode', 'settings.json');
const FOLDER = 'follows';
const INNER = path.join(FOLDER, 'inside');
const REVEALED = path.join(INNER, 'revealed.md');
const APART = path.join(FOLDER, 'elsewhere', 'apart.md');
const KEPT = path.join(FOLDER, 'kept.md');
const PLAIN = path.join(FOLDER, 'plain.txt');
// A line break of Markdown, two spaces at the end of a line, and no line feed at the end of the file.
// Its title is its file's name, so that the note keeps its name (a note's title names its file).
const KEPT_TEXT = '# kept\n\nA kite over the harbour.  \nIt rises.\n\nA middle paragraph.\n\nThe last paragraph';
const PLAIN_TEXT = 'alpha   \nbeta\t\ngamma';

const inWorkspace = (relativePath: string) => path.join(workspacePath, relativePath);

/** Runs `run` with `values` added to the settings of the workspace, and puts the settings back. */
async function withSettings(page, values: Record<string, unknown>, run: () => Promise<void>) {
	const before = fs.readFileSync(SETTINGS, 'utf8');
	fs.writeFileSync(SETTINGS, JSON.stringify({ ...JSON.parse(before), ...values }, null, '\t'), 'utf8');
	try {
		// The window reads a changed settings file within about a second.
		await page.waitForTimeout(1_500);
		await run();
	} finally {
		fs.writeFileSync(SETTINGS, before, 'utf8');
		await page.waitForTimeout(1_500);
	}
}

/** The files of these steps, written once; no other step of the suite names them. */
export async function prepareFollowsSettings(page) {
	for (const [file, text] of [[REVEALED, '# Revealed\n\nA note inside a folder of a folder.\n'], [APART, '# Apart\n\nA note that Files leaves alone.\n'], [KEPT, KEPT_TEXT], [PLAIN, PLAIN_TEXT]]) {
		fs.mkdirSync(path.dirname(inWorkspace(file)), { recursive: true });
		fs.writeFileSync(inWorkspace(file), text, 'utf8');
	}
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${FOLDER}"]`).waitFor({ state: 'attached', timeout: 20_000 });
}

/** Presses and releases the back or the forward button of a mouse at a point of the window, as the system sends them. */
async function pressMouseButton(page, button: 'back' | 'forward', point: { x: number; y: number }) {
	await waitForViewTransitions(page);
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, buttons: button === 'back' ? 8 : 16, clickCount: 1 });
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, buttons: 0, clickCount: 1 });
	} finally {
		await cdp.detach().catch(() => undefined);
	}
}

async function middleOf(page, selector: string) {
	const box = await page.locator(selector).first().boundingBox();
	if (!box) {
		throw new Error(`Nothing to point at: ${selector}`);
	}
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The shown place and the workbench, criteria 1 and 2: the back and forward buttons of a mouse go where Go Back and
 * Go Forward go, over a note in Rich, over the canvas, and over Files, and do nothing with their setting off.
 */
export async function assertMouseButtonsGoBackAndForward(page) {
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
	await quickOpen(page, FOLDER);
	await assertCanvasFolder(page, FOLDER);
	await quickOpen(page, 'revealed.md');
	await assertCardDetail(page, REVEALED);

	// Over the note, which is a page of its own.
	await pressMouseButton(page, 'back', await middleOf(page, '.basehalf-card-detail.visible .basehalf-card-detail-surface.active'));
	await assertCanvasFolder(page, FOLDER);
	// Over the canvas.
	await pressMouseButton(page, 'back', await middleOf(page, '.basehalf-canvas-react-island'));
	await assertCanvasFolder(page, '');
	// Over Files.
	await showExplorer(page);
	const overFiles = await middleOf(page, '.explorer-viewlet .explorer-folders-view');
	await pressMouseButton(page, 'forward', overFiles);
	await assertCanvasFolder(page, FOLDER);
	await pressMouseButton(page, 'forward', overFiles);
	await assertCardDetail(page, REVEALED);

	await withSettings(page, { 'workbench.editor.mouseBackForwardToNavigate': false }, async () => {
		await pressMouseButton(page, 'back', await middleOf(page, '.basehalf-card-detail.visible .basehalf-card-detail-surface.active'));
		await pressMouseButton(page, 'back', overFiles);
		await page.waitForTimeout(800);
		await assertCardDetail(page, REVEALED);
	});
	await closeCardDetailIfOpen(page);
}

function readFiles(page) {
	return page.evaluate(() => [...document.querySelectorAll('.explorer-viewlet .explorer-folders-view .monaco-list-row')].map(row => ({
		name: row.querySelector('.label-name')?.textContent ?? '',
		selected: row.classList.contains('selected')
	})));
}

/**
 * The shown place and the workbench, criteria 4 and 5: Files opens the folders above a file that Card Detail comes
 * to show and selects its row, the keyboard stays in the note, the row stays selected on the canvas, and with
 * `explorer.autoReveal` off Files is left as it is.
 */
export async function assertFilesRevealTheFileInCardDetail(page) {
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
	await showExplorer(page);
	await page.locator(`.explorer-viewlet .monaco-list-row[aria-label="${FOLDER}"]`).waitFor({ state: 'visible', timeout: 20_000 });
	// Its folders are closed: no row of the note is drawn.
	const before = await readFiles(page);
	if (before.some(row => row.name === 'revealed.md' || row.name === 'apart.md')) {
		throw new Error(`The folders of the notes must be closed before they are revealed: ${JSON.stringify(before)}`);
	}

	await quickOpen(page, 'revealed.md');
	await assertCardDetail(page, REVEALED);
	await waitForReading(() => readFiles(page), rows => rows.some(row => row.name === 'revealed.md' && row.selected), 'Files to select the note that Card Detail shows', 10_000);
	const keyboard = await page.evaluate(() => !!document.activeElement?.closest('.explorer-viewlet'));
	if (keyboard) {
		throw new Error('Revealing a file in Files must leave the keyboard in the note');
	}
	await closeCardDetailIfOpen(page);
	await assertCanvasFolder(page, INNER.split(path.sep).join('/'));
	const onCanvas = await readFiles(page);
	if (!onCanvas.some(row => row.name === 'revealed.md' && row.selected)) {
		throw new Error(`Closing Card Detail must leave the selection of Files: ${JSON.stringify(onCanvas)}`);
	}

	await withSettings(page, { 'explorer.autoReveal': false }, async () => {
		await quickOpen(page, 'apart.md');
		await assertCardDetail(page, APART);
		await page.waitForTimeout(1_500);
		const rows = await readFiles(page);
		if (rows.some(row => row.name === 'apart.md') || !rows.some(row => row.name === 'revealed.md' && row.selected)) {
			throw new Error(`With explorer.autoReveal off, Files must stay as it is: ${JSON.stringify(rows)}`);
		}
		await closeCardDetailIfOpen(page);
	});
}

/**
 * The shown place and the workbench, criteria 7 and 9: the title of the window, which the system shows, names the
 * note in Card Detail before the workspace and a canvas by the workspace, and the path in the title bar is as before.
 */
export async function assertWindowTitleNamesTheShownPlace(page) {
	const workspace = path.basename(workspacePath);
	const separator = process.platform === 'darwin' ? ' — ' : ' - ';
	const read = () => page.evaluate(() => ({
		title: document.title,
		path: [...document.querySelectorAll('.basehalf-command-center-breadcrumbs .basehalf-command-center-breadcrumb-segment')].map(segment => segment.textContent?.trim()).join(' / ')
	}));
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
	const onRoot = await waitForReading(read, reading => !reading.title.includes('revealed'), 'the title of the window on the canvas of the workspace folder', 10_000);
	if (!onRoot.title.startsWith(workspace) || onRoot.path !== workspace) {
		throw new Error(`On the canvas of the workspace folder the window is named by the workspace: ${JSON.stringify(onRoot)}`);
	}

	await quickOpen(page, 'revealed.md');
	await assertCardDetail(page, REVEALED);
	const onNote = await waitForReading(read, reading => reading.title.startsWith('revealed'), 'the title of the window to name the note', 10_000);
	// A note is named without its extension, here as in the path of the title bar (canvas card name).
	if (!onNote.title.startsWith(`revealed${separator}${workspace}`) || onNote.path !== `${workspace} / ${FOLDER} / inside / revealed`) {
		throw new Error(`In Card Detail the window is named by the note and the workspace, and the path stays: ${JSON.stringify(onNote)}`);
	}

	await closeCardDetailIfOpen(page);
	const onFolder = await waitForReading(read, reading => !reading.title.includes('revealed'), 'the title of the window on the canvas of a folder', 10_000);
	if (!onFolder.title.startsWith(workspace) || onFolder.path !== `${workspace} / ${FOLDER} / inside`) {
		throw new Error(`On the canvas of a folder the window is named by the workspace, and the path stays: ${JSON.stringify(onFolder)}`);
	}
}

/**
 * Formats of a note, criterion 43, and the settings catalog, criterion 6: with the three settings of white space on,
 * a save of a note from Rich keeps the two spaces at the end of a line and adds no line feed at the end, and a save
 * of a text file from Source takes the white space at the ends of its lines and ends it with one line feed.
 */
export async function assertSaveKeepsTheWhiteSpaceOfANote(page) {
	await closeCardDetailIfOpen(page);
	await withSettings(page, { 'files.trimTrailingWhitespace': true, 'files.insertFinalNewline': true, 'files.trimFinalNewlines': true }, async () => {
		await quickOpen(page, 'kept.md');
		await assertCardDetail(page, KEPT);
		const frame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
		await frame.locator('.bn-editor p', { hasText: 'A middle paragraph.' }).first().click();
		await page.keyboard.press('End');
		await page.keyboard.type('R');
		const expected = KEPT_TEXT.replace('A middle paragraph.', 'A middle paragraph.R');
		await waitUntil(() => fs.readFileSync(inWorkspace(KEPT), 'utf8').includes('paragraph.R'), 'Rich to save the letter typed into the note', 15_000);
		await page.waitForTimeout(600);
		const kept = fs.readFileSync(inWorkspace(KEPT), 'utf8');
		if (kept !== expected) {
			throw new Error(`A save of a note must change nothing but what was typed: ${JSON.stringify(kept)}`);
		}
		await closeCardDetailIfOpen(page);
		const afterClose = fs.readFileSync(inWorkspace(KEPT), 'utf8');
		if (afterClose !== expected) {
			throw new Error(`Leaving Card Detail must save the note as it was typed: ${JSON.stringify(afterClose)}`);
		}

		await quickOpen(page, 'plain.txt');
		await assertCardDetail(page, PLAIN);
		const source = page.locator('.basehalf-card-detail.visible .basehalf-card-detail-surface.active .monaco-editor').first();
		await source.waitFor({ state: 'visible', timeout: 15_000 });
		await source.locator('.view-lines').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
		await page.keyboard.type('T');
		// The smoke's workspace saves a file only when told: leaving Card Detail saves what Source holds.
		await closeCardDetailIfOpen(page);
		await waitUntil(() => fs.readFileSync(inWorkspace(PLAIN), 'utf8') !== PLAIN_TEXT, 'Source to save the text file', 15_000);
		const plain = fs.readFileSync(inWorkspace(PLAIN), 'utf8');
		if (plain !== 'alpha\nbeta\ngammaT\n') {
			throw new Error(`A save of a text file follows the settings of white space: ${JSON.stringify(plain)}`);
		}
	});
}

/**
 * Architecture invariants, "Product shell": `workbench.reduceMotion` decides whether BaseHalf animates, in the window
 * and in a page. Chromium computes the styles also in a window that draws no frames.
 */
export async function assertReducedMotionFollowsTheSetting(page) {
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
	const folder = `.basehalf-canvas-card.folder[data-basehalf-card-path="${FOLDER}"]`;
	await page.locator(folder).waitFor({ state: 'attached', timeout: 20_000 });
	const read = () => page.evaluate(selector => {
		const moves = (element: Element | null) => element ? getComputedStyle(element).transitionDuration.split(',').some(duration => parseFloat(duration) > 0) : undefined;
		return {
			root: [...document.querySelector('.monaco-workbench')!.classList].filter(name => name.endsWith('-motion')).join(),
			folderCard: moves(document.querySelector(selector)),
			connectionHandle: moves(document.querySelector('.basehalf-canvas-card-connect-handle'))
		};
	}, folder);
	const asItComes = await read();
	// The run's machine may itself reduce motion, which `auto` follows: `off` and `on` hold whatever it says.
	await withSettings(page, { 'workbench.reduceMotion': 'off' }, async () => {
		const off = await waitForReading(read, reading => reading.root === 'monaco-enable-motion', 'the window to animate with workbench.reduceMotion off', 10_000);
		if (off.folderCard !== true || off.connectionHandle !== true) {
			throw new Error(`With workbench.reduceMotion off, a folder's card and a connection handle change over time: ${JSON.stringify({ asItComes, off })}`);
		}
	});
	await withSettings(page, { 'workbench.reduceMotion': 'on' }, async () => {
		const on = await waitForReading(read, reading => reading.root === 'monaco-reduce-motion', 'the window to reduce motion with workbench.reduceMotion on', 10_000);
		if (on.folderCard !== false || on.connectionHandle !== false) {
			throw new Error(`With workbench.reduceMotion on, a folder's card and a connection handle change at once: ${JSON.stringify({ asItComes, on })}`);
		}
		// A page learns it from the class the workbench keeps on its body.
		await quickOpen(page, 'revealed.md');
		await assertCardDetail(page, REVEALED);
		const frame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
		const inPage = await frame.evaluate(() => {
			const probe = document.createElement('span');
			probe.className = 'basehalf-adhd-check';
			document.querySelector('.basehalf-markdown-rich')!.appendChild(probe);
			const moves = getComputedStyle(probe).transitionDuration.split(',').some(duration => parseFloat(duration) > 0);
			probe.remove();
			return { body: document.body.classList.contains('vscode-reduce-motion'), moves };
		});
		if (!inPage.body || inPage.moves) {
			throw new Error(`With workbench.reduceMotion on, the page of a note reduces motion too: ${JSON.stringify(inPage)}`);
		}
		await closeCardDetailIfOpen(page);
	});
}
