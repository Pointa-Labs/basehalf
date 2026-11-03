/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The formats of a note in Card Detail (note formats, D110): Rich offers only
// what the note's file keeps, draws the palette as stored, and its keys run no
// command of the window.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { app, workspacePath } from '../../context.mts';
import { createSolidPng } from '../../fixture.mts';
import { restoreSystemAppearance, showSystemAppearance, waitForSystemAppearance } from '../../lib/appearance.mts';
import { assertCardDetail, closeCardDetailIfOpen, pinch } from '../../lib/cardDetail.mts';
import { withTheRunsClipboard } from '../../lib/clipboard.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { withTheSystemBrowserStoodIn } from '../../lib/opener.mts';
import { decodePng, drawnColor, screenColor } from '../../lib/png.mts';
import { quickOpen, shownFileName, visibleQuickInput } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

// The suite's last steps take over a note that Quick Open knows from the start.
const FORMATS_NOTE = path.join('docs', 'guide.md');

/** Opens a note of every kind of block in Card Detail. These steps run last, so no other step reads the note they write. */
export async function openNoteFormatsNote(page) {
	fs.writeFileSync(path.join(workspacePath, FORMATS_NOTE), [
		'# Formats',
		'',
		'Formats target words here, and one <span style="color:#e8706b;">red</span> word.',
		'',
		'![concept](concept.svg)',
		'',
		'[concept.svg](concept.svg)',
		'',
		'| A   | B   |',
		'| --- | --- |',
		'| a   | b   |',
		'',
	].join('\n'), 'utf8');
	await quickOpen(page, 'guide.md');
	await assertCardDetail(page, 'guide.md');
}

function readFormatsNote() {
	return fs.readFileSync(path.join(workspacePath, FORMATS_NOTE), 'utf8');
}

/** Selects the first text of the note that holds `text`, as the keyboard would. */
async function selectText(frame, text) {
	const selected = await frame.evaluate(needle => {
		const editor = document.querySelector('.ProseMirror');
		if (!editor) {
			return false;
		}
		const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = node.textContent?.indexOf(needle) ?? -1;
			if (at >= 0) {
				editor.focus();
				const range = document.createRange();
				range.setStart(node, at);
				range.setEnd(node, at + needle.length);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				return true;
			}
		}
		return false;
	}, text);
	if (!selected) {
		throw new Error(`The note shows no text "${text}"`);
	}
	await frame.page().waitForTimeout(250);
}

/** The labels of the toolbar's controls, once it shows. */
async function toolbarLabels(frame) {
	const toolbar = frame.locator('.basehalf-markdown-rich-portal .bn-formatting-toolbar').first();
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	return toolbar.locator('button, [role="combobox"], select').evaluateAll(controls => controls.map(control => control.getAttribute('aria-label') ?? control.textContent?.trim() ?? ''));
}

const nothingTheFileCannotKeep = /align|nest|comment|merge|preview|download/i;

/**
 * Note formats, criteria 4 and 21: no control Rich offers makes what the
 * note's file cannot keep, and a palette color is drawn as the file stores it.
 */
export async function assertNoteFormatsOfferOnlyWhatTheFileKeeps(page) {
	const frame = await activeMarkdownRichFrame(page);
	const red = frame.locator('.bn-editor [data-style-type="textColor"]', { hasText: 'red' }).first();
	await red.waitFor({ state: 'visible', timeout: 20_000 });
	const color = await red.evaluate(element => getComputedStyle(element).color);
	if (color !== 'rgb(232, 112, 107)') {
		throw new Error(`A red word is drawn ${color}, not the stored rgb(232, 112, 107)`);
	}

	await selectText(frame, 'target');
	const text = await toolbarLabels(frame);
	if (text.some(label => nothingTheFileCannotKeep.test(label)) || !text.some(label => /colors/i.test(label))) {
		throw new Error(`The toolbar of selected text offers ${JSON.stringify(text)}`);
	}

	await frame.locator('.bn-editor [data-content-type="image"] img').first().click();
	const picture = await toolbarLabels(frame);
	if (picture.some(label => nothingTheFileCannotKeep.test(label)) || !picture.some(label => /caption/i.test(label))) {
		throw new Error(`The toolbar of a picture offers ${JSON.stringify(picture)}`);
	}

	await frame.locator('.bn-editor [data-content-type="file"]').first().click();
	const file = await toolbarLabels(frame);
	if (file.some(label => nothingTheFileCannotKeep.test(label) || /caption/i.test(label))) {
		throw new Error(`The toolbar of a file offers ${JSON.stringify(file)}`);
	}

	const paragraph = frame.locator('.bn-editor .bn-block-content', { hasText: 'Formats target' }).first();
	await paragraph.hover({ position: { x: 8, y: 8 } });
	const handle = frame.locator('.basehalf-markdown-rich-portal .bn-side-menu [draggable="true"]').first();
	await handle.waitFor({ state: 'visible', timeout: 10_000 });
	await handle.click();
	const items = frame.locator('.basehalf-markdown-rich-portal .bn-menu-dropdown .bn-menu-item');
	await items.first().waitFor({ state: 'visible', timeout: 10_000 });
	const handleMenu = await items.evaluateAll(elements => elements.filter(element => (element as HTMLElement).offsetParent !== null).map(element => element.textContent?.trim() ?? ''));
	await page.keyboard.press('Escape');
	if (handleMenu.length !== 1 || !/delete/i.test(handleMenu[0])) {
		throw new Error(`The menu of a block's drag handle offers ${JSON.stringify(handleMenu)}`);
	}

	const cell = frame.locator('.bn-editor td, .bn-editor th', { hasText: 'a' }).first();
	await cell.hover();
	const rowHandle = frame.locator('.basehalf-markdown-rich-portal .bn-table-handle').first();
	await rowHandle.waitFor({ state: 'visible', timeout: 10_000 });
	await rowHandle.click();
	// The editor draws this menu outside BaseHalf's portal.
	const tableItems = frame.locator('.bn-table-handle-menu [role="menuitem"]');
	await tableItems.first().waitFor({ state: 'visible', timeout: 10_000 });
	const tableMenu = await tableItems.evaluateAll(elements => elements.map(element => element.textContent?.trim() ?? ''));
	await page.keyboard.press('Escape');
	if (tableMenu.some(label => /header|color|merge|split/i.test(label)) || !tableMenu.some(label => /delete/i.test(label))) {
		throw new Error(`The menu of a table's row offers ${JSON.stringify(tableMenu)}`);
	}
}

/**
 * Note formats, criterion 26 and plan R9: Mod-Shift-S makes strikethrough,
 * Mod-B bold, and Mod-Alt-0 a paragraph, and the window runs no command of
 * its own for them: the sidebar stays as it was. The window's own keys go on
 * working from Rich: Mod-P opens Quick Open.
 */
export async function assertNoteFormatsKeysStayInRich(page) {
	const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
	const frame = await activeMarkdownRichFrame(page);
	const sidebar = page.locator('#workbench\\.parts\\.sidebar');
	const sidebarShown = await sidebar.isVisible();

	await selectText(frame, 'target');
	await page.keyboard.press(`${mod}+Shift+s`);
	await waitUntil(() => readFormatsNote().includes('~~target~~'), 'Mod-Shift-S to strike the word through', 10_000);

	await page.keyboard.press(`${mod}+b`);
	await waitUntil(() => readFormatsNote().includes('**~~target~~**'), 'Mod-B to make the word bold', 10_000);
	if (await sidebar.isVisible() !== sidebarShown) {
		throw new Error('Mod-B in Rich also showed or hid the sidebar');
	}

	await selectText(frame, 'Formats');
	await page.keyboard.press(`${mod}+Alt+0`);
	await waitUntil(() => readFormatsNote().startsWith('Formats\n'), 'Mod-Alt-0 to make the heading a paragraph', 10_000);
	if (await sidebar.isVisible() !== sidebarShown) {
		throw new Error('A key of Rich changed the window\'s layout');
	}

	await selectText(frame, 'target');
	await page.keyboard.press(`${mod}+p`);
	await visibleQuickInput(page).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {
		throw new Error('Mod-P with the caret in Rich did not open Quick Open');
	});
	await page.keyboard.press('Escape');
	await visibleQuickInput(page).waitFor({ state: 'hidden', timeout: 5_000 });
}

/** Writes the note the steps work on and waits until Rich shows `needle`. */
async function showNote(page, lines, needle) {
	fs.writeFileSync(path.join(workspacePath, FORMATS_NOTE), lines.join('\n'), 'utf8');
	const frame = await activeMarkdownRichFrame(page);
	await frame.locator('.bn-editor .bn-block-content', { hasText: needle }).first().waitFor({ state: 'visible', timeout: 20_000 });
	return frame;
}

/** The point of the page at the end of the line that holds `text`, or `left` pixels left of its first letter. */
async function linePoint(frame, text, where) {
	const content = frame.locator('.bn-editor .bn-block-content', { hasText: text }).first();
	const point = await content.evaluate((element, [needle, place]) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = node.textContent?.indexOf(needle) ?? -1;
			if (at >= 0) {
				const range = document.createRange();
				// Left of a line: of the first letter of its block, wherever the text is.
				const first = place === 'end' ? node : document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode() ?? node;
				node = first;
				const offset = place === 'end' ? at + needle.length : 0;
				range.setStart(node, place === 'end' ? offset - 1 : offset);
				range.setEnd(node, place === 'end' ? offset : offset + 1);
				const letter = range.getBoundingClientRect();
				const box = element.getBoundingClientRect();
				return { x: (place === 'end' ? letter.right - 1 : letter.left - place) - box.left, y: letter.top + letter.height / 2 - box.top };
			}
		}
		return undefined;
	}, [text, where]);
	if (!point) {
		throw new Error(`The note shows no text "${text}"`);
	}
	// In the page's coordinates: a click left of a line falls outside the block's box.
	const box = await content.boundingBox();
	if (!box) {
		throw new Error(`The line "${text}" is not shown`);
	}
	return { x: box.x + point.x, y: box.y + point.y };
}

/** Clicks into the line that holds `text`: at its end, or `left` pixels left of its first letter. */
async function clickLine(frame, text, where) {
	const { x, y } = await linePoint(frame, text, where);
	await frame.page().mouse.click(x, y);
	await frame.page().waitForTimeout(80);
}

/**
 * Note formats, criterion 20: letters typed after Command-→ at the end of a
 * line before a fixed block, after Command-← at the start of a line after
 * one, after → before one, and after a click 3 pixels left of a line's first
 * letter are saved, in each of 10 tries of each.
 */
export async function assertNoteFormatsKeepTypedLetters(page) {
	if (process.platform !== 'darwin') {
		return;
	}
	const frame = await showNote(page, ['Line before the island.', '', '<div>raw island here</div>', '', 'Line after the island.', ''], 'Line after the island.');
	const tries = 10;
	for (let index = 0; index < tries; index++) {
		await clickLine(frame, 'Line before the island', 'end');
		await page.keyboard.press('Meta+ArrowRight');
		await page.keyboard.type('a');
	}
	for (let index = 0; index < tries; index++) {
		await clickLine(frame, 'Line after the island', 'end');
		await page.keyboard.press('Meta+ArrowLeft');
		await page.keyboard.type('b');
	}
	await waitUntil(() => readFormatsNote().includes(`Line before the island.${'a'.repeat(tries)}`) && readFormatsNote().includes(`${'b'.repeat(tries)}Line after the island.`),
		'letters typed after Command-→ and Command-← beside a fixed block to be saved', 10_000).catch(() => {
		throw new Error(`Letters typed after Command-→ or Command-← were lost: ${JSON.stringify(readFormatsNote())}`);
	});

	// The first letter of this line starts its block: the click lands in the margin before it.
	for (let index = 0; index < tries; index++) {
		await clickLine(frame, 'Line before the island', 3);
		await page.keyboard.type('d');
	}
	await waitUntil(() => readFormatsNote().startsWith(`${'d'.repeat(tries)}Line before the island.`),
		'letters typed after a click left of a line to be saved', 10_000).catch(() => {
		throw new Error(`Letters typed after a click 3 pixels left of a line were lost: ${JSON.stringify(readFormatsNote())}`);
	});

	// The line ends with the letters typed after Command-→: → there selects the fixed block.
	for (let index = 0; index < tries; index++) {
		await clickLine(frame, 'a'.repeat(tries), 'end');
		await page.keyboard.press('Meta+ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('c');
	}
	await waitUntil(() => (readFormatsNote().match(/^c$/gm) ?? []).length === tries,
		'a letter typed with the fixed block selected to start a paragraph after it', 10_000).catch(() => {
		throw new Error(`Letters typed with a fixed block selected were lost: ${JSON.stringify(readFormatsNote())}`);
	});
}

/** Picks `item` of the slash menu typed as `query` in a new line after `line`, and gives the chooser it opens at once `files`. */
async function chooseFromTheMenu(page, frame, line, query, item, files) {
	await clickLine(frame, line, 'end');
	await page.keyboard.press('Enter');
	await page.keyboard.type(query, { delay: 50 });
	const entry = frame.locator('.bn-suggestion-menu-item', { hasText: item }).first();
	await entry.waitFor({ state: 'visible', timeout: 8_000 });
	const chooser = page.waitForEvent('filechooser', { timeout: 8_000 });
	await entry.click();
	await (await chooser).setFiles(files);
}

/**
 * Note formats, rules 8 and 49, criteria 10 and 11, plan R3: Video in the slash menu opens the system's file chooser
 * at once, the chosen file is stored as a video, and one Undo takes it away again; a chooser closed without a file
 * adds nothing. At magnifications of 100%, 200%, and 400%, the dragged edge of a picture stays within 1 pixel of the
 * pointer, and the picture's width is stored as a whole number of pixels.
 */
export async function assertNoteFormatsMediaFromTheMenu(page) {
	let frame = await showNote(page, ['Media here.', ''], 'Media here.');
	await chooseFromTheMenu(page, frame, 'Media here.', '/video', 'Video', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('a stand-in for a video') });
	// It is kept in the note's own folder in the store, linked from the note (files in notes, rules 12 and 18).
	await waitUntil(() => /^Media here\.\n\n<video src="\.\.\/\.bh\/attachments\/[a-z0-9]{10}\/clip\.mp4" controls><\/video>\n$/.test(readFormatsNote()), 'the chosen video to be stored as a video where the menu was', 15_000).catch(() => {
		throw new Error(`The video chosen in the slash menu was not stored as a video in the note's own folder: ${JSON.stringify(readFormatsNote())}`);
	});
	const stored = /attachments\/([a-z0-9]{10})\//.exec(readFormatsNote())[1];
	if (!fs.existsSync(path.join(workspacePath, '.bh', 'attachments', stored, 'clip.mp4'))) {
		throw new Error('The chosen video was not kept in the note\'s own folder');
	}
	// A video of the note is edited in place: its menu opens it nowhere else and names no Card Detail (rule 22).
	await frame.locator('video').first().click({ button: 'right' });
	await page.waitForTimeout(300);
	const items = await frame.locator('.basehalf-markdown-rich-context-menu button').allTextContents();
	await page.keyboard.press('Escape');
	if (items.some(item => item === 'Open' || /Card Detail/.test(item))) {
		throw new Error(`The menu of a video in a note offered to open it elsewhere: ${JSON.stringify(items)}`);
	}
	await page.keyboard.press(`${COMMAND}+z`);
	await waitUntil(() => readFormatsNote() === 'Media here.\n', 'one Undo to take the added video away', 10_000).catch(() => {
		throw new Error(`One Undo did not take the added video away: ${JSON.stringify(readFormatsNote())}`);
	});
	await chooseFromTheMenu(page, frame, 'Media here.', '/image', 'Image', []);
	await page.waitForTimeout(1_000);
	if (readFormatsNote() !== 'Media here.\n' || await frame.locator('.basehalf-note-media-placeholder').count() > 0) {
		throw new Error(`A chooser closed without a file added something: ${JSON.stringify(readFormatsNote())}`);
	}

	fs.writeFileSync(path.join(workspacePath, 'docs', 'wide.png'), createSolidPng(200, 80, [70, 130, 180]));
	frame = await showNote(page, ['Resize below.', '', '![](wide.png)', ''], 'Resize below.');
	const picture = frame.locator('.bn-visual-media').first();
	await picture.waitFor({ state: 'visible', timeout: 15_000 });
	const text = await frame.locator('.bn-block-content', { hasText: 'Resize below.' }).first().boundingBox();
	// At 100% first, then at 200%: the dragged edge stays under the pointer at both.
	const atHundred = await dragPictureEdge(page, frame, picture);
	await pinch(page, text.x + 4, text.y + 4, 2);
	await page.waitForTimeout(400);
	const atTwoHundred = await dragPictureEdge(page, frame, picture);
	await pinch(page, text.x + 4, text.y + 4, 0.5);
	await page.waitForTimeout(400);
	if (atHundred.off.length > 0 || atTwoHundred.off.length > 0 || Math.abs(atTwoHundred.before.scale - 2) > 0.05) {
		throw new Error(`The dragged edge of a picture left the pointer: ${JSON.stringify({ atHundred, atTwoHundred })}`);
	}
	await waitUntil(() => /^Resize below\.\n\n<img src="wide\.png" width="\d+">\n$/.test(readFormatsNote()), 'the picture\'s new width to be stored as a whole number', 10_000).catch(() => {
		throw new Error(`The resized picture was not stored with a whole width: ${JSON.stringify(readFormatsNote())}`);
	});

	// At 400%, where a step of 10 pixels on the screen is 2.5 pixels of the page: a narrower picture, magnified about its corner, fits the view.
	frame = await showNote(page, ['Resize below.', '', '<img src="wide.png" width="100">', ''], 'Resize below.');
	const narrow = frame.locator('.bn-visual-media').first();
	await narrow.waitFor({ state: 'visible', timeout: 15_000 });
	await waitForReading(() => narrow.boundingBox(), box => Math.round(box?.width ?? 0) === 100, 'the picture to show 100 pixels wide', 10_000);
	const corner = await narrow.boundingBox();
	await pinch(page, corner.x + 2, corner.y + 2, 4);
	await page.waitForTimeout(400);
	const atFourHundred = await dragPictureEdge(page, frame, narrow);
	await pinch(page, corner.x + 2, corner.y + 2, 0.25);
	await page.waitForTimeout(400);
	if (atFourHundred.off.length > 0 || Math.abs(atFourHundred.before.scale - 4) > 0.05) {
		throw new Error(`At 400% the dragged edge of a picture left the pointer: ${JSON.stringify(atFourHundred)}`);
	}
	await waitUntil(() => readFormatsNote() === 'Resize below.\n\n<img src="wide.png" width="120">\n', 'the width dragged at 400% to be stored as a whole number', 10_000).catch(() => {
		throw new Error(`The picture resized at 400% was not stored 120 pixels wide: ${JSON.stringify(readFormatsNote())}`);
	});
}

/** Drags the right edge of `picture` 80 pixels right in 8 moves, and gives the moves after which the edge was more than 1 pixel from the pointer. */
async function dragPictureEdge(page, frame, picture) {
	const shown = await picture.boundingBox();
	await page.mouse.move(shown.x + shown.width / 2, shown.y + shown.height / 2);
	const handles = frame.locator('.bn-resize-handle');
	await handles.first().waitFor({ state: 'visible', timeout: 5_000 });
	// The right one of the picture's two handles, in the window's measure.
	const handleBox = async () => {
		const boxes = await Promise.all((await handles.all()).map(handle => handle.boundingBox()));
		return boxes.filter(Boolean).sort((a, b) => b.x - a.x)[0];
	};
	const geometry = () => frame.evaluate(() => {
		const wrapper = document.querySelector('.bn-visual-media-wrapper');
		const image = document.querySelector('.bn-visual-media');
		const notePage = document.querySelector('.basehalf-markdown-rich-page');
		return {
			wrapperClient: wrapper?.clientWidth,
			wrapperShown: wrapper?.getBoundingClientRect().width,
			imageShown: image?.getBoundingClientRect().width,
			scale: notePage ? notePage.getBoundingClientRect().width / notePage.offsetWidth : undefined,
		};
	});
	const start = await handleBox();
	const pointer = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
	const before = await geometry();
	await page.mouse.move(pointer.x, pointer.y);
	await page.mouse.down();
	const off = [];
	for (let step = 1; step <= 8; step++) {
		await page.mouse.move(pointer.x + step * 10, pointer.y);
		await page.waitForTimeout(48);
		const now = await handleBox();
		const drift = now.x + now.width / 2 - (pointer.x + step * 10);
		if (Math.abs(drift) > 1) {
			off.push({ step, drift });
		}
	}
	const after = await geometry();
	await page.mouse.up();
	return { off, before, after };
}

/** Opens the note again from Quick Open, and gives Rich's frame: what Rich shows then is read from the file. */
async function reopenFormatsNote(page) {
	await closeCardDetailIfOpen(page);
	await quickOpen(page, 'guide.md');
	await assertCardDetail(page, 'guide.md');
	return activeMarkdownRichFrame(page);
}

/**
 * Note formats, criteria 3 and 21: underline with the keys, and red and a yellow background from the toolbar's
 * Colors menu, on `word` of `**important word here**` store `**important <span …><u>word</u></span> here**`; opened
 * again, the word is underlined and drawn rgb(232, 112, 107).
 */
export async function assertNoteFormatsInlineFormatsStored(page) {
	let frame = await showNote(page, ['**important word here**', ''], 'important word here');
	await selectText(frame, 'word');
	await page.keyboard.press(`${COMMAND}+u`);
	await waitUntil(() => readFormatsNote().includes('<u>word</u>'), 'Mod-U to underline the word', 10_000);
	const colors = frame.locator('.basehalf-markdown-rich-portal [data-test="colors"]').first();
	await colors.waitFor({ state: 'visible', timeout: 5_000 });
	await colors.click();
	await frame.locator('[data-test="text-color-red"]').first().click();
	await waitUntil(() => readFormatsNote().includes('color:#e8706b;'), 'the Colors menu to make the word red', 10_000);
	await colors.click();
	await frame.locator('[data-test="background-color-yellow"]').first().click();
	const stored = '**important <span style="color:#e8706b;background-color:#4a401d;"><u>word</u></span> here**\n';
	await waitUntil(() => readFormatsNote() === stored, 'underline, red, and yellow to be stored in their spellings', 10_000).catch(() => {
		throw new Error(`The formats of a word were not stored in their spellings: ${JSON.stringify(readFormatsNote())}`);
	});
	frame = await reopenFormatsNote(page);
	await frame.locator('.bn-editor u', { hasText: 'word' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	const shown = await frame.evaluate(() => {
		const walker = document.createTreeWalker(document.querySelector('.bn-editor') ?? document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent === 'word' && node.parentElement) {
				return { color: getComputedStyle(node.parentElement).color, underlined: !!node.parentElement.closest('u') };
			}
		}
		return undefined;
	});
	if (shown?.color !== 'rgb(232, 112, 107)' || !shown.underlined) {
		throw new Error(`Opened again, the word should be underlined and drawn rgb(232, 112, 107): ${JSON.stringify(shown)}`);
	}
}

/**
 * Note formats, criteria 4 and 5: Toggle List from the slash menu, a title, Enter, and a block in it store a toggle in
 * its spelling, closed; folding it writes nothing; opened again, it shows closed with its block.
 */
export async function assertNoteFormatsToggleStored(page) {
	let frame = await showNote(page, ['Toggles.', ''], 'Toggles.');
	await clickLine(frame, 'Toggles.', 'end');
	await page.keyboard.press('Enter');
	await page.keyboard.type('/toggle', { delay: 50 });
	const entry = frame.locator('.bn-suggestion-menu-item', { hasText: 'Toggle List' }).first();
	await entry.waitFor({ state: 'visible', timeout: 8_000 });
	await entry.click();
	await page.keyboard.type('Title');
	await page.keyboard.press('Enter');
	await page.keyboard.type('child');
	const stored = 'Toggles.\n\n<details>\n<summary>Title</summary>\n\nchild\n\n</details>\n';
	await waitUntil(() => readFormatsNote() === stored, 'a new toggle to be stored closed, in its spelling', 10_000).catch(() => {
		throw new Error(`The new toggle was not stored in its spelling: ${JSON.stringify(readFormatsNote())}`);
	});
	const file = path.join(workspacePath, FORMATS_NOTE);
	const before = fs.statSync(file).mtimeMs;
	await frame.locator('.bn-toggle-button').first().click();
	await page.waitForTimeout(2_000);
	if (fs.statSync(file).mtimeMs !== before || readFormatsNote() !== stored) {
		throw new Error(`Folding a toggle wrote the note: ${JSON.stringify(readFormatsNote())}`);
	}
	frame = await reopenFormatsNote(page);
	const wrapper = frame.locator('.bn-toggle-wrapper').first();
	await wrapper.waitFor({ state: 'visible', timeout: 15_000 });
	const shown = { open: await wrapper.getAttribute('data-show-children'), child: await frame.locator('.bn-block-content', { hasText: 'child' }).count() };
	if (shown.open !== 'false' || shown.child !== 1) {
		throw new Error(`Opened again, the toggle should show closed and hold its block: ${JSON.stringify(shown)}`);
	}
}

/** A note of underlined and red text and a list, the text the note stores for them, and a line after them. */
const COPIED_LINES = ['A <u>word</u> and <span style="color:#e8706b;">red</span>.', '', '- one', '- two', '', 'Last line.', ''];
const COPIED_MARKDOWN = 'A <u>word</u> and <span style="color:#e8706b;">red</span>.\n\n- one\n- two';

/** Selects from the start of the text that starts with `first` to the end of the text `last`, as the keyboard would. */
async function selectAcross(frame, first, last) {
	await frame.evaluate(([start, end]) => {
		const editor = document.querySelector('.ProseMirror');
		const walker = document.createTreeWalker(editor ?? document.body, NodeFilter.SHOW_TEXT);
		let from;
		let to;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			from ??= node.textContent?.startsWith(start) ? node : undefined;
			to = node.textContent === end ? node : to;
		}
		if (!from || !to || !(editor instanceof HTMLElement)) {
			throw new Error('The text to select is not shown');
		}
		editor.focus();
		const range = document.createRange();
		range.setStart(from, 0);
		range.setEnd(to, to.textContent.length);
		document.getSelection()?.removeAllRanges();
		document.getSelection()?.addRange(range);
	}, [first, last]);
	await frame.page().waitForTimeout(150);
}

function readClipboardText() {
	return app.evaluate(({ clipboard }) => clipboard.readText());
}

/** Command-C in Rich puts on the clipboard, as text, the Markdown the note stores for underlined and red text and a list. */
async function copyFromRich(page, frame) {
	// A click puts the keys in Rich: a step before may have left them on a control of the window.
	await clickLine(frame, 'Last line.', 'end');
	await selectAcross(frame, 'A ', 'two');
	await page.keyboard.press(`${COMMAND}+c`);
	await waitForReading(readClipboardText, text => text === COPIED_MARKDOWN, 'Command-C to put the Markdown the note stores on the clipboard', 10_000).catch(async () => {
		throw new Error(`Command-C put another text on the clipboard: ${JSON.stringify(await readClipboardText())}`);
	});
}

/** Note formats, criterion 18: Command-C of underlined and red text and of a list puts on the system's clipboard, as text, the Markdown the note stores for them. */
export async function assertNoteFormatsCopyCarriesMarkdown(page) {
	await withTheRunsClipboard('note formats copy', async () => {
		await copyFromRich(page, await showNote(page, COPIED_LINES, 'Last line.'));
	});
}

/**
 * Note formats, plans R8 and R9: Command-X and Command-V in Rich take a word away and put it back, and what
 * Command-C in Rich copies, Command-V in Source pastes as exactly the Markdown the note stores.
 */
export async function assertNoteFormatsCopyIntoSource(page) {
	await withTheRunsClipboard('note formats copy into Source', async () => {
		const original = COPIED_LINES.join('\n');
		const frame = await showNote(page, COPIED_LINES, 'Last line.');
		await clickLine(frame, 'Last line.', 'end');
		await selectText(frame, 'line');
		await page.keyboard.press(`${COMMAND}+x`);
		await waitUntil(() => readFormatsNote() === original.replace('Last line.', 'Last .'), 'Command-X in Rich to cut the word', 10_000).catch(() => {
			throw new Error(`Command-X in Rich did not cut the word: ${JSON.stringify(readFormatsNote())}`);
		});
		await page.keyboard.press(`${COMMAND}+v`);
		await waitUntil(() => readFormatsNote() === original, 'Command-V in Rich to put the word back', 10_000).catch(() => {
			throw new Error(`Command-V in Rich did not put the cut word back: ${JSON.stringify(readFormatsNote())}`);
		});

		await copyFromRich(page, frame);
		await showProjection(page, 'Source');
		const source = page.locator('.basehalf-card-detail.visible .basehalf-card-detail-surface.active .basehalf-card-detail-source-editor .monaco-editor').first();
		await source.waitFor({ state: 'visible', timeout: 15_000 });
		await source.locator('.view-lines').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
		await page.keyboard.press(`${COMMAND}+v`);
		// The smoke's workspace saves a file only when told: Source hands its text to the note on the way back to Rich.
		await page.waitForTimeout(300);
		await showProjection(page, 'Rich');
		await waitUntil(() => readFormatsNote() === `${original}${COPIED_MARKDOWN}`, 'Command-V in Source to paste the Markdown copied in Rich', 15_000).catch(() => {
			throw new Error(`Command-V in Source pasted another text than Rich copied: ${JSON.stringify(readFormatsNote())}`);
		});
	});
}

const LINKED_NOTE = path.join('docs', 'my file.md');
const COMMAND = process.platform === 'darwin' ? 'Meta' : 'Control';
const RICH_SCROLL = '.basehalf-markdown-rich-scroll';
const PREVIEW_SCROLL = '.basehalf-card-detail.visible .basehalf-card-detail-surface.active .basehalf-card-detail-markdown-preview-scroll';

/**
 * Command-clicks `link` in Rich with the events of a click in its own page: a click that opens another note replaces
 * the frame the link is in, and the protocol's click waits on that frame without end.
 */
async function commandClick(link) {
	await link.scrollIntoViewIfNeeded();
	await link.evaluate((element, metaIsCommand) => {
		const box = element.getBoundingClientRect();
		const init = { bubbles: true, cancelable: true, view: window, button: 0, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, metaKey: metaIsCommand, ctrlKey: !metaIsCommand };
		element.dispatchEvent(new MouseEvent('mousedown', init));
		element.dispatchEvent(new MouseEvent('mouseup', init));
		element.dispatchEvent(new MouseEvent('click', init));
	}, process.platform === 'darwin');
}

/** Card Detail shows `name` within 1 s of `gesture`, and no dialog shows (note formats, criterion 13). */
async function assertOpensWithinASecond(page, name, gesture) {
	const title = page.locator('.basehalf-card-detail.visible .basehalf-card-detail-title', { hasText: shownFileName(name) });
	await title.waitFor({ state: 'visible', timeout: 1_000 }).catch(async () => {
		const shown = await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-title').first().textContent().catch(() => undefined);
		throw new Error(`${gesture} did not open ${name} within 1 s; Card Detail shows ${JSON.stringify(shown)}`);
	});
	if (await page.locator('.monaco-dialog-box').count()) {
		throw new Error(`${gesture} showed a dialog`);
	}
}

/** After `gesture` on a link to a missing file, Card Detail still shows `name` a second later, and no dialog shows. */
async function assertNothingOpens(page, name, gesture) {
	await page.waitForTimeout(1_000);
	const shown = await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-title').first().textContent();
	if (!shown?.includes(shownFileName(name)) || await page.locator('.monaco-dialog-box').count()) {
		throw new Error(`${gesture} did something: Card Detail shows ${JSON.stringify(shown)}, dialogs ${await page.locator('.monaco-dialog-box').count()}`);
	}
}

/** Within 1 s of `gesture`, the heading `text` stands 24 pixels below the top of the view `scroll` (note formats, criterion 14). */
async function assertHeadingRevealed(target, scroll, text, gesture) {
	const deadline = Date.now() + 1_000;
	let below;
	do {
		below = await target.evaluate(([selector, wanted]) => {
			const view = document.querySelector(selector);
			const heading = Array.from(view?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? []).find(element => element.textContent?.trim() === wanted);
			const box = heading?.getBoundingClientRect();
			// A heading in a closed toggle is not drawn.
			return view && box && box.height > 0 ? box.top - view.getBoundingClientRect().top - view.clientTop : undefined;
		}, [scroll, text]);
		if (below !== undefined && Math.abs(below - 24) <= 1) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	} while (Date.now() < deadline);
	throw new Error(`${gesture} left the heading "${text}" ${below === undefined ? 'hidden' : `${Math.round(below)} px`} below the top of the view, not 24 px, after 1 s`);
}

async function showProjection(page, label) {
	const button = page.locator(`.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="${label}"]`);
	if (await button.getAttribute('aria-pressed') !== 'true') {
		await button.click();
	}
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true',
		`.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="${label}"]`, { timeout: 10_000 });
}

/**
 * Note formats, criteria 13 to 15: `[[` on `my file.md` stores the link
 * `[my file.md](my%20file.md)`, which is a link after the note opens again.
 * Command-click on it in Rich and a click in Preview open its Card Detail
 * within 1 s, with no dialog; a link to a missing file does nothing; a link
 * to a heading in a closed toggle opens the toggle and scrolls the heading 24
 * pixels below the top of the view; and no link in Preview has a title. The
 * web link opens the system's browser, which a smoke run leaves alone: its
 * address is the resolver's, tested in the unit tests.
 */
export async function assertNoteFormatsLinksOpenTheirTargets(page) {
	fs.writeFileSync(path.join(workspacePath, LINKED_NOTE), '# My file\n\nThe linked note.\n', 'utf8');
	const filler = Array.from({ length: 40 }, (_, index) => [`Filler paragraph ${index + 1}.`, '']).flat();
	let frame = await showNote(page, [
		'# Links',
		'',
		'Links: [Setup](#setup), [gone](missing.md), [site](https://example.com/a?b=c#d), and',
		'',
		...filler,
		'<details>',
		'<summary>More</summary>',
		'',
		'## Setup',
		'',
		'The end.',
		'',
		'</details>',
		'',
		...filler,
	], 'Filler paragraph 40.');

	await clickLine(frame, 'and', 'end');
	await page.keyboard.press('End');
	await page.keyboard.type(' [[', { delay: 80 });
	await frame.locator('.bn-suggestion-menu').waitFor({ state: 'visible', timeout: 8_000 });
	await page.keyboard.type('my', { delay: 80 });
	await frame.locator('.bn-suggestion-menu-item', { hasText: 'my file.md' }).first().waitFor({ state: 'visible', timeout: 8_000 });
	await page.keyboard.press('Enter');
	await waitUntil(() => readFormatsNote().includes('and [my file.md](my%20file.md)'), '[[ on my file.md to store [my file.md](my%20file.md)', 15_000).catch(() => {
		throw new Error(`[[ did not store the link: ${JSON.stringify(readFormatsNote().split('\n')[2])}`);
	});

	// The link is a link after the note opens again.
	await closeCardDetailIfOpen(page);
	await quickOpen(page, 'guide.md');
	await assertCardDetail(page, 'guide.md');
	frame = await activeMarkdownRichFrame(page);
	const richLink = name => frame.locator('.bn-editor a', { hasText: name }).first();
	await richLink('my file.md').waitFor({ state: 'visible', timeout: 10_000 });

	await commandClick(richLink('my file.md'));
	await assertOpensWithinASecond(page, 'my file.md', 'Command-click on a link in Rich');
	await quickOpen(page, 'guide.md');
	await assertCardDetail(page, 'guide.md');
	frame = await activeMarkdownRichFrame(page);
	await commandClick(richLink('gone'));
	await assertNothingOpens(page, 'guide.md', 'Command-click on a link to a missing file in Rich');
	await commandClick(richLink('Setup'));
	await assertHeadingRevealed(frame, RICH_SCROLL, 'Setup', 'Command-click on a link to a heading in a closed toggle in Rich');

	// Preview: a click opens a link, as a page does.
	await showProjection(page, 'Preview');
	const preview = page.locator(`${PREVIEW_SCROLL} .basehalf-card-detail-markdown-preview-content`);
	await preview.locator('a', { hasText: 'my file.md' }).first().waitFor({ state: 'visible', timeout: 10_000 });
	const titled = await preview.locator('a[title], img[title]').count();
	if (titled > 0) {
		throw new Error(`${titled} links or pictures in Preview have a title (criterion 15)`);
	}
	await preview.locator('a', { hasText: 'my file.md' }).first().click();
	await assertOpensWithinASecond(page, 'my file.md', 'A click on a link in Preview');
	await quickOpen(page, 'guide.md');
	await assertCardDetail(page, 'guide.md');
	await showProjection(page, 'Preview');
	await preview.locator('a', { hasText: 'gone' }).first().click();
	await assertNothingOpens(page, 'guide.md', 'A click on a link to a missing file in Preview');
	await preview.locator('a', { hasText: 'Setup' }).first().click();
	await assertHeadingRevealed(page, PREVIEW_SCROLL, 'Setup', 'A click on a link to a heading in a closed toggle in Preview');

	// A web link goes to the system's browser at its address as written, with no dialog. The run stands in for
	// the browser, so that nothing opens on the machine.
	await withTheSystemBrowserStoodIn(async opened => {
		await preview.locator('a', { hasText: 'site' }).first().click();
		await waitForReading(opened, addresses => addresses.length > 0, 'a click on a web link in Preview to open it in the system\'s browser', 1_000).catch(() => {
			throw new Error('A click on a web link in Preview opened nothing within 1 s');
		});
		await showProjection(page, 'Rich');
		frame = await activeMarkdownRichFrame(page);
		await commandClick(richLink('site'));
		await waitForReading(opened, addresses => addresses.length > 1, 'Command-click on a web link in Rich to open it in the system\'s browser', 1_000).catch(() => {
			throw new Error('Command-click on a web link in Rich opened nothing within 1 s');
		});
		const addresses = await opened();
		if (addresses.some(address => address !== 'https://example.com/a?b=c#d') || await page.locator('.monaco-dialog-box').count() > 0) {
			throw new Error(`A web link should open at its address as written, with no dialog: ${JSON.stringify(addresses)}`);
		}
	});
}

/**
 * Note formats, criterion 17 and plan R7: what a page in a browser puts on the clipboard, a centered paragraph
 * with a red word, a merged colored table, an underlined link, and a picture with a width, pasted with Command-V,
 * stores the forms of rule 72.
 */
export async function assertNoteFormatsPasteFromAPage(page) {
	await withTheRunsClipboard('note formats paste from a page', async () => {
		const frame = await showNote(page, ['Pasted below.', ''], 'Pasted below.');
		await app.evaluate(({ clipboard }) => clipboard.write({
			html: '<p style="text-align:center">A centered line with a <span style="color: rgb(232, 112, 107)">red</span> word.</p>'
				+ '<table><tr><td colspan="2" style="background-color:yellow">wide</td></tr><tr><td>x</td><td>y</td></tr></table>'
				+ '<p><a href="https://example.com/"><u>linked</u></a> and a picture <img src="https://example.com/picture.png" width="200"></p>',
			text: 'A centered line with a red word.\nwide\nx y\nlinked and a picture',
		}));
		await clickLine(frame, 'Pasted below.', 'end');
		await page.keyboard.press('Enter');
		await page.keyboard.press(`${COMMAND}+v`);
		await waitUntil(() => readFormatsNote().includes('linked'), 'Command-V to paste what the page copied', 10_000);
		await page.waitForTimeout(500);
		const stored = readFormatsNote();
		const forms = {
			red: stored.includes('A centered line with a <span style="color:#e8706b;">red</span> word.'),
			splitTable: stored.includes('| wide |') && !stored.includes('colspan'),
			link: stored.includes('[linked](https://example.com/)') && !stored.includes('<u>linked'),
			picture: stored.includes('![](https://example.com/picture.png)') && !stored.includes('width='),
			noAlignmentOrCellColor: !/text-align|background-color:yellow/.test(stored),
		};
		if (Object.values(forms).some(kept => !kept)) {
			throw new Error(`A paste from a page did not store the forms of rule 72: ${JSON.stringify({ forms, stored })}`);
		}
	});
}

/** Puts the caret `offset` letters into the note's first text `text`, as a click there would. */
async function placeCaret(frame, text, offset) {
	const placed = await frame.evaluate(([needle, at]) => {
		const editor = document.querySelector('.ProseMirror');
		if (!(editor instanceof HTMLElement)) {
			return false;
		}
		const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const start = node.textContent?.indexOf(needle) ?? -1;
			if (start >= 0) {
				editor.focus();
				const range = document.createRange();
				range.setStart(node, start + at);
				range.collapse(true);
				document.getSelection()?.removeAllRanges();
				document.getSelection()?.addRange(range);
				return true;
			}
		}
		return false;
	}, [text, offset]);
	if (!placed) {
		throw new Error(`The note shows no text "${text}"`);
	}
	await frame.page().waitForTimeout(150);
}

/** Types 你 as the system's input method gives it: the letters typed for the word first, then the word chosen. */
async function typeThroughInputMethod(page, cdp) {
	await cdp.send('Input.imeSetComposition', { text: 'n', selectionStart: 1, selectionEnd: 1 });
	await page.waitForTimeout(80);
	await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
	await page.waitForTimeout(400);
	await cdp.send('Input.insertText', { text: '你' });
	await page.waitForTimeout(150);
}

/**
 * Note formats, plan R15: Chinese typed with an input method, the letters for a word first and then the word
 * chosen, into an underlined red word, into a toggle's title, and into a picture's caption is stored as typed, with
 * the tags around it as they were.
 */
export async function assertNoteFormatsInputMethod(page) {
	fs.writeFileSync(path.join(workspacePath, 'docs', 'wide.png'), createSolidPng(200, 80, [70, 130, 180]));
	const lines = [
		'A <span style="color:#e8706b;"><u>word</u></span> here.',
		'',
		'<details>',
		'<summary>Title</summary>',
		'',
		'child',
		'',
		'</details>',
		'',
		'<figure><img alt="wide" src="wide.png"><figcaption>cap</figcaption></figure>',
		'',
	];
	const frame = await showNote(page, lines, 'here.');
	const stores = (text, what) => waitUntil(() => readFormatsNote().includes(text), what, 10_000).catch(() => {
		throw new Error(`Chinese typed with an input method ${what}: ${JSON.stringify(readFormatsNote())}`);
	});
	const cdp = await page.context().newCDPSession(page);
	try {
		await placeCaret(frame, 'word', 2);
		await typeThroughInputMethod(page, cdp);
		await stores('A <span style="color:#e8706b;"><u>wo你rd</u></span> here.', 'into an underlined red word was not stored in it');

		await placeCaret(frame, 'Title', 5);
		await typeThroughInputMethod(page, cdp);
		await stores('<summary>Title你</summary>', 'into a toggle\'s title was not stored in it');

		await frame.locator('.bn-editor [data-content-type="image"] img').first().click();
		const captionButton = frame.locator('.basehalf-markdown-rich-portal .bn-formatting-toolbar button[aria-label*="caption" i]').first();
		await captionButton.waitFor({ state: 'visible', timeout: 10_000 });
		await captionButton.click();
		const caption = frame.locator('input[name="file-caption"]').first();
		await caption.waitFor({ state: 'visible', timeout: 5_000 });
		await caption.press('End');
		await typeThroughInputMethod(page, cdp);
		await page.keyboard.press('Enter');
		await stores('<figcaption>cap你</figcaption>', 'into a picture\'s caption was not stored in it');
	} finally {
		await cdp.detach().catch(() => undefined);
	}
	const expected = lines.join('\n').replace('<u>word</u>', '<u>wo你rd</u>').replace('Title<', 'Title你<').replace('cap<', 'cap你<');
	await waitUntil(() => readFormatsNote() === expected, 'the note to hold what was typed and nothing else', 5_000).catch(() => {
		throw new Error(`Chinese typed with an input method changed more of the note than it typed: ${JSON.stringify(readFormatsNote())}`);
	});
}

/**
 * Note formats, criterion 24 and plan R4: a heading in a toggle leaves the outline in the frame the toggle closes in,
 * and comes back in the frame it opens in. The outline is read in every frame while the toggle is clicked closed and
 * open again.
 */
export async function assertNoteFormatsOutlineFollowsToggles(page) {
	const frame = await showNote(page, ['# Outline', '', '<details open>', '<summary>Folded</summary>', '', '## Inside', '', 'child', '', '</details>', '', '## After', ''], 'After');
	const ticks = () => frame.evaluate(() => document.querySelectorAll('.basehalf-note-outline-tick').length);
	await waitForReading(ticks, count => count === 3, 'the outline to show the three headings', 10_000);
	await frame.evaluate(() => {
		const run = window as unknown as { basehalfOutlineFrames?: object[]; basehalfOutlineStop?: boolean };
		const samples = [];
		run.basehalfOutlineFrames = samples;
		run.basehalfOutlineStop = false;
		const read = () => {
			samples.push({
				at: Math.round(performance.now()),
				open: document.querySelector('.bn-toggle-wrapper')?.getAttribute('data-show-children') === 'true',
				ticks: document.querySelectorAll('.basehalf-note-outline-tick').length,
			});
			if (!run.basehalfOutlineStop) {
				requestAnimationFrame(read);
			}
		};
		requestAnimationFrame(read);
	});
	const button = frame.locator('.bn-toggle-button').first();
	await button.click();
	await page.waitForTimeout(400);
	await button.click();
	await page.waitForTimeout(400);
	const samples = await frame.evaluate(() => {
		const run = window as unknown as { basehalfOutlineFrames?: { at: number; open: boolean; ticks: number }[]; basehalfOutlineStop?: boolean };
		run.basehalfOutlineStop = true;
		return run.basehalfOutlineFrames ?? [];
	});
	let changes = 0;
	let behind = 0;
	let longest = 0;
	for (let index = 0; index < samples.length; index++) {
		changes += index > 0 && samples[index].open !== samples[index - 1].open ? 1 : 0;
		behind = samples[index].ticks === (samples[index].open ? 3 : 2) ? 0 : behind + 1;
		longest = Math.max(longest, behind);
	}
	// The outline reads the page in the frame of a change, before it is drawn: a reading taken before the
	// outline's own in that frame is one behind, and the next must not be.
	if (samples.length < 20 || changes !== 2 || longest > 1) {
		throw new Error(`The outline did not follow a toggle within a frame: ${JSON.stringify({ frames: samples.length, changes, longestBehind: longest, samples: samples.filter((sample, index) => index === 0 || sample.open !== samples[index - 1].open || sample.ticks !== samples[index - 1].ticks) })}`);
	}
}

/** The palette of rule 46: each color's text and background. */
const PALETTE = {
	gray: ['#9b9a97', '#3f3e3b'],
	brown: ['#ba8e78', '#4f3a30'],
	red: ['#e8706b', '#692b2b'],
	orange: ['#dc8434', '#583b1f'],
	yellow: ['#d5ae38', '#4a401d'],
	green: ['#5cad83', '#24443a'],
	blue: ['#4ba3dc', '#1f4157'],
	purple: ['#a882e4', '#45306a'],
	pink: ['#e36aaf', '#62294b'],
};
const RED = [232, 112, 107];

function rgbOf(hex) {
	return `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
}

/**
 * Note formats, criterion 21, rule 7, and plans R1 and R11: with the system in light and in dark appearance, a red
 * word is drawn rgb(232, 112, 107) in Rich and in Preview, on the screen too, the swatches of the Colors menu are the
 * palette's values, and Rich's page behind the text is #121314, which the palette's contrast is chosen for.
 */
export async function assertNoteFormatsPaletteInBothAppearances(page) {
	await showNote(page, ['A <span style="color:#e8706b;">red</span> word.', '', 'Second line.', '', 'Third line.', '', 'Last line on the page.', ''], 'on the page.');
	const seen = {};
	try {
		for (const appearance of ['light', 'dark']) {
			await showSystemAppearance(page, appearance);
			const frame = await activeMarkdownRichFrame(page);
			await waitForSystemAppearance(frame, appearance);
			const rich = await drawnColor(frame.locator('.bn-editor [data-style-type="textColor"]', { hasText: 'red' }).first(), RED);
			// The end of the last line, where no letter is drawn and no menu of the red word shows.
			const line = await frame.locator('.bn-editor .bn-block-content', { hasText: 'on the page.' }).first().boundingBox();
			const { width, height, channels, pixels } = decodePng(await page.screenshot({ clip: { x: line.x + line.width - 48, y: line.y + 2, width: 40, height: Math.max(4, line.height - 4) } }));
			const pageColor = await screenColor(frame.locator('.bn-editor').first(), [18, 19, 20]);
			const background = new Set();
			for (let index = 0; index < width * height; index++) {
				const off = Math.max(...pageColor.map((value, channel) => Math.abs(pixels[index * channels + channel] - value)));
				background.add(off <= 2 ? 'rgb(18, 19, 20)' : `rgb(${pixels[index * channels]}, ${pixels[index * channels + 1]}, ${pixels[index * channels + 2]})`);
			}

			await selectText(frame, 'word');
			const colors = frame.locator('.basehalf-markdown-rich-portal [data-test="colors"]').first();
			await colors.waitFor({ state: 'visible', timeout: 5_000 });
			await colors.click();
			await frame.locator('[data-test="text-color-red"]').first().waitFor({ state: 'visible', timeout: 5_000 });
			const swatches = await frame.evaluate(names => Object.fromEntries(names.map(name => [name, [
				getComputedStyle(document.querySelector(`[data-test="text-color-${name}"] .bn-color-icon`)).color,
				getComputedStyle(document.querySelector(`[data-test="background-color-${name}"] .bn-color-icon`)).backgroundColor,
			]])), Object.keys(PALETTE));
			await page.keyboard.press('Escape');
			await placeCaret(frame, 'Second', 0);

			await showProjection(page, 'Preview');
			const preview = await drawnColor(page.locator(`${PREVIEW_SCROLL} .basehalf-card-detail-markdown-preview-content span[style]`, { hasText: 'red' }).first(), RED);
			await showProjection(page, 'Rich');
			seen[appearance] = {
				rich,
				preview,
				page: [...background],
				swatchesOffThePalette: Object.entries(swatches).filter(([name, [text, back]]) => text !== rgbOf(PALETTE[name][0]) || back !== rgbOf(PALETTE[name][1])),
			};
		}
	} finally {
		await restoreSystemAppearance(page);
	}
	const red = { color: 'rgb(232, 112, 107)', pixels: 'rgb(232, 112, 107)' };
	const wrong = Object.values(seen).filter(shown => JSON.stringify(shown.rich) !== JSON.stringify(red) || JSON.stringify(shown.preview) !== JSON.stringify(red)
		|| shown.swatchesOffThePalette.length > 0 || JSON.stringify(shown.page) !== JSON.stringify(['rgb(18, 19, 20)']));
	if (wrong.length > 0) {
		throw new Error(`The palette is not drawn as stored in each appearance: ${JSON.stringify(seen)}`);
	}
}

/**
 * Puts the caret at the end of the line that holds `text`, opens Rich's own menu right of it, where no word is under
 * the pointer for the system to select, and picks `item` in it.
 */
async function pickInRichMenu(page, frame, text, item) {
	await clickLine(frame, text, 'end');
	const { x, y } = await linePoint(frame, text, 'end');
	await page.mouse.click(x + 40, y, { button: 'right' });
	const entry = frame.locator('.basehalf-markdown-rich-context-menu button', { hasText: new RegExp(`^${item}$`) });
	await entry.waitFor({ state: 'visible', timeout: 5_000 });
	await entry.click();
}

/**
 * Note formats, criterion 27 and plan R13: Paste in Rich's menu inserts a screenshot on the clipboard as the same
 * picture Command-V inserts, and a fixed block copied in Rich as a fixed block.
 */
export async function assertNoteFormatsMenuPaste(page) {
	await withTheRunsClipboard('note formats menu paste', async () => {
		const lines = ['Paste a picture here.', '', 'Fixed below.', '', '<div>raw island here</div>', '', 'End.', ''];
		const original = lines.join('\n');
		const frame = await showNote(page, lines, 'End.');
		const screenshot = createSolidPng(40, 30, [200, 60, 60]).toString('base64');
		await app.evaluate(({ clipboard, nativeImage }, base64) => clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))), screenshot);
		const pasted = description => waitForReading(() => readFormatsNote(), text => text !== original && /\.png\b/.test(text), description, 15_000);
		// The file a picture is copied into is named by the copy: only the name may differ.
		const shape = text => text.replace(/[^\s"()[\]/]+\.png\b/g, 'picture.png');

		await clickLine(frame, 'Paste a picture here.', 'end');
		await page.keyboard.press(`${COMMAND}+v`);
		const byKeys = await pasted('Command-V to paste the screenshot');
		await page.keyboard.press(`${COMMAND}+z`);
		await waitUntil(() => readFormatsNote() === original, 'one Undo to take the pasted picture away', 10_000);
		await pickInRichMenu(page, frame, 'Paste a picture here.', 'Paste');
		const byMenu = await pasted('Paste in Rich\'s menu to paste the screenshot');
		if (shape(byMenu) !== shape(byKeys)) {
			throw new Error(`Paste in Rich's menu inserted a screenshot otherwise than Command-V: ${JSON.stringify({ byKeys, byMenu })}`);
		}
		const pictures = () => frame.locator('.bn-editor [data-content-type="image"] img').count();
		await waitForReading(pictures, count => count === 1, 'the picture pasted from the menu to show', 10_000);
		await page.keyboard.press(`${COMMAND}+z`);
		await waitUntil(() => readFormatsNote() === original, 'one Undo to take the picture pasted from the menu away', 10_000);

		// → at the end of the line before a fixed block selects it (criterion 20).
		await clickLine(frame, 'Fixed below.', 'end');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press(`${COMMAND}+c`);
		await waitForReading(readClipboardText, text => text === '<div>raw island here</div>', 'Command-C on a selected fixed block to copy its text', 10_000);
		await pickInRichMenu(page, frame, 'End.', 'Paste');
		await waitUntil(() => readFormatsNote() === `${original}\n<div>raw island here</div>\n`, 'Paste in Rich\'s menu to paste the fixed block after the line', 10_000).catch(() => {
			throw new Error(`Paste in Rich's menu did not paste the copied fixed block: ${JSON.stringify(readFormatsNote())}`);
		});
		const fixed = await frame.locator('.basehalf-raw-passthrough', { hasText: 'raw island here' }).count();
		if (fixed !== 2) {
			throw new Error(`A fixed block pasted from Rich's menu should show as a fixed block: ${fixed} shown`);
		}
	});
}
