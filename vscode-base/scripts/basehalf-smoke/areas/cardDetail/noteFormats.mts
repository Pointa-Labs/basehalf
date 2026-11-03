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
import { workspacePath } from '../../context.mts';
import { createSolidPng } from '../../fixture.mts';
import { assertCardDetail, closeCardDetailIfOpen, pinch } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { quickOpen, shownFileName } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

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
 * Note formats, criterion 26: Mod-Shift-S makes strikethrough, Mod-B bold,
 * and Mod-Alt-0 a paragraph, and the window runs no command of its own for
 * them: the sidebar stays as it was.
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
}

/** Writes the note the steps work on and waits until Rich shows `needle`. */
async function showNote(page, lines, needle) {
	fs.writeFileSync(path.join(workspacePath, FORMATS_NOTE), lines.join('\n'), 'utf8');
	const frame = await activeMarkdownRichFrame(page);
	await frame.locator('.bn-editor .bn-block-content', { hasText: needle }).first().waitFor({ state: 'visible', timeout: 20_000 });
	return frame;
}

/** Clicks into the line that holds `text`: at its end, or `left` pixels left of its first letter. */
async function clickLine(frame, text, where) {
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
	await frame.page().mouse.click(box.x + point.x, box.y + point.y);
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
 * Note formats, rules 28 and 49, criteria 10 and 11: Video in the slash menu opens the system's file chooser at once,
 * the chosen file is stored as a video, and one Undo takes it away again; a chooser closed without a file adds
 * nothing. At a magnification of 200%, the dragged edge of a picture stays within 1 pixel of the pointer, and the
 * picture's width is stored as a whole number of pixels.
 */
export async function assertNoteFormatsMediaFromTheMenu(page) {
	let frame = await showNote(page, ['Media here.', ''], 'Media here.');
	await chooseFromTheMenu(page, frame, 'Media here.', '/video', 'Video', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('a stand-in for a video') });
	await waitUntil(() => /^Media here\.\n\n<video src="[^"]*clip\.mp4" controls><\/video>\n$/.test(readFormatsNote()), 'the chosen video to be stored as a video where the menu was', 15_000).catch(() => {
		throw new Error(`The video chosen in the slash menu was not stored as a video: ${JSON.stringify(readFormatsNote())}`);
	});
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
	if (atHundred.off.length > 0 || atTwoHundred.off.length > 0) {
		throw new Error(`The dragged edge of a picture left the pointer: ${JSON.stringify({ atHundred, atTwoHundred })}`);
	}
	await waitUntil(() => /^Resize below\.\n\n<img src="wide\.png" width="\d+">\n$/.test(readFormatsNote()), 'the picture\'s new width to be stored as a whole number', 10_000).catch(() => {
		throw new Error(`The resized picture was not stored with a whole width: ${JSON.stringify(readFormatsNote())}`);
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

const LINKED_NOTE = path.join('docs', 'my file.md');
const COMMAND = process.platform === 'darwin' ? 'Meta' : 'Control';
const RICH_SCROLL = '.basehalf-markdown-rich-scroll';
const PREVIEW_SCROLL = '.basehalf-card-detail.visible .basehalf-card-detail-surface.active .basehalf-card-detail-markdown-preview-scroll';

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
		'Links: [Setup](#setup), [gone](missing.md), and',
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

	await richLink('my file.md').click({ modifiers: [COMMAND] });
	await assertOpensWithinASecond(page, 'my file.md', 'Command-click on a link in Rich');
	await quickOpen(page, 'guide.md');
	await assertCardDetail(page, 'guide.md');
	frame = await activeMarkdownRichFrame(page);
	await richLink('gone').click({ modifiers: [COMMAND] });
	await assertNothingOpens(page, 'guide.md', 'Command-click on a link to a missing file in Rich');
	await richLink('Setup').click({ modifiers: [COMMAND] });
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
	await showProjection(page, 'Rich');
}
