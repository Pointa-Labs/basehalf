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
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { quickOpen } from '../../lib/quickInput.mts';
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
