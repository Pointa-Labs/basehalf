/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The menu of blocks in a note (the menu of blocks in a note, D117), in the real
// window: what the page's test cannot see, which is the theme, the file on the
// disk, the system's file chooser, the magnified note, and the real add button.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { workspacePath } from '../../context.mts';
import { createSolidPng } from '../../fixture.mts';
import { pinch } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { waitUntil } from '../../lib/steps.mts';
import { readFormatsNote, showNote } from './noteFormats.mts';

const NOTE = path.join('docs', 'guide.md');
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

function theMenu(frame) {
	return frame.locator('.basehalf-markdown-rich-portal .basehalf-note-menu').first();
}

/** Moves the real pointer to the line that holds `text`, and clicks the add button beside it at `where` of its box. */
async function clickAddBeside(page, frame, text, where = { x: 0.5, y: 0.5 }) {
	const line = await frame.locator('.bn-editor .bn-block-content', { hasText: text }).first().boundingBox();
	await page.mouse.move(line.x + 80, line.y + 8);
	await page.mouse.move(line.x + 20, line.y + 8, { steps: 4 });
	const handles = frame.locator('.basehalf-markdown-rich-portal .bn-side-menu');
	await handles.first().waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(120);
	const button = await handles.locator('button').first().boundingBox();
	const x = button.x + button.width * where.x;
	const y = button.y + button.height * where.y;
	await page.mouse.move(x, y, { steps: 3 });
	await page.waitForTimeout(80);
	await page.mouse.click(x, y);
	await theMenu(frame).waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(80);
}

function blockTexts(frame) {
	return frame.evaluate(() => [...document.querySelectorAll('.bn-editor .bn-block-content')].map(block => block.textContent));
}

async function closeMenu(page, frame) {
	await page.keyboard.press('Escape');
	await theMenu(frame).waitFor({ state: 'hidden', timeout: 5_000 });
}

/**
 * The menu of blocks, criteria 1, 3, and 4, and rules 20 and 24: a click on the
 * corner of the add button opens the menu, which shows its first group at once
 * in BaseHalf's colors with one lit row and the handles gone; Escape closes it
 * with Card Detail open, the new line goes, and the file is not written.
 */
export async function assertNoteBlockMenuLooks(page) {
	const lines = ['First line of the note.', '', 'Second line.', '', 'Third line.', ''];
	const frame = await showNote(page, lines, 'Third line.');
	const file = path.join(workspacePath, NOTE);
	await page.waitForTimeout(1_200);
	const bytes = readFormatsNote();
	const time = fs.statSync(file).mtimeMs;
	const blocks = await blockTexts(frame);

	await clickAddBeside(page, frame, 'First line', { x: 0.04, y: 0.04 });
	await frame.locator('.bn-side-menu').first().waitFor({ state: 'detached', timeout: 3_000 });
	const seen = await theMenu(frame).evaluate(menu => {
		const box = menu.getBoundingClientRect();
		const rows = [...menu.querySelectorAll('.basehalf-note-menu-row')];
		const shown = rows.filter(row => row.getBoundingClientRect().bottom <= box.bottom);
		const lit = rows.filter(row => row.getAttribute('aria-selected') === 'true');
		const style = getComputedStyle(menu);
		const probe = document.createElement('div');
		document.body.append(probe);
		const color = (property, variable) => {
			probe.style.setProperty(property, `var(${variable})`);
			return getComputedStyle(probe).getPropertyValue(property);
		};
		const wanted = {
			background: color('background-color', '--vscode-menu-background'),
			border: color('border-top-color', '--vscode-menu-border'),
			selection: color('color', '--vscode-menu-selectionBackground'),
		};
		probe.remove();
		const point = rows[3].getBoundingClientRect();
		return {
			width: box.width,
			height: box.height,
			shownRows: shown.map(row => row.querySelector('.basehalf-note-menu-title')?.textContent),
			rowHeights: [...new Set(rows.map(row => row.getBoundingClientRect().height))],
			group: menu.querySelector('.basehalf-note-menu-group')?.textContent,
			lit: lit.map(row => row.textContent),
			background: style.backgroundColor,
			border: style.borderTopColor,
			radius: style.borderTopLeftRadius,
			litBackground: getComputedStyle(lit[0]).backgroundColor,
			wanted,
			onTop: !!document.elementFromPoint(point.left + 40, point.top + 15)?.closest('.basehalf-note-menu-row'),
			placeholder: getComputedStyle(document.querySelector('.bn-suggestion-decorator .bn-block-content'), '::after').content,
		};
	});
	const problems = [];
	if (seen.width !== 280 || seen.height > 428 || seen.rowHeights.length !== 1 || seen.rowHeights[0] !== 30) {
		problems.push('its size');
	}
	if (seen.group !== 'Basic' || seen.shownRows.length !== 12 || seen.shownRows[0] !== 'Paragraph' || seen.shownRows[11] !== 'Divider' || seen.lit.length !== 1 || !seen.onTop) {
		problems.push('what it shows');
	}
	if (seen.background !== seen.wanted.background || seen.border !== seen.wanted.border || seen.litBackground !== seen.wanted.selection || seen.radius !== '12px') {
		problems.push('its colors');
	}
	if (!seen.placeholder.includes('Type to filter')) {
		problems.push('the words of the new line');
	}
	if (problems.length > 0) {
		throw new Error(`The menu of blocks is wrong in ${problems.join(', ')}: ${JSON.stringify(seen)}`);
	}

	await closeMenu(page, frame);
	if (!await page.locator('.basehalf-card-detail.visible').first().isVisible()) {
		throw new Error('Escape closed Card Detail along with the menu of blocks');
	}
	await page.waitForTimeout(1_200);
	if (JSON.stringify(await blockTexts(frame)) !== JSON.stringify(blocks) || readFormatsNote() !== bytes || fs.statSync(file).mtimeMs !== time) {
		throw new Error(`A canceled add changed the note: ${JSON.stringify({ blocks: await blockTexts(frame), file: readFormatsNote() })}`);
	}
	await page.keyboard.type('Z');
	await waitUntil(() => readFormatsNote() !== bytes, 'a letter typed after Escape to be stored', 10_000);
	await page.keyboard.press(UNDO);
	await waitUntil(() => readFormatsNote() === bytes, 'the letter to be undone', 10_000);
}

/**
 * The menu of blocks, criterion 5: a block chosen from the add button's menu is
 * one step of undo, after any wait and any letters, and that undo puts the file
 * back byte for byte.
 */
export async function assertNoteBlockMenuChoiceIsOneUndo(page) {
	const lines = ['First line.', '', 'Second line.', ''];
	const frame = await showNote(page, lines, 'Second line.');
	await page.waitForTimeout(1_200);
	const bytes = readFormatsNote();
	await clickAddBeside(page, frame, 'First line');
	await page.keyboard.type('heading 2', { delay: 30 });
	await page.waitForTimeout(700);
	await page.keyboard.press('Enter');
	await theMenu(frame).waitFor({ state: 'hidden', timeout: 5_000 });
	const stored = 'First line.\n\n##\n\nSecond line.\n';
	await waitUntil(() => readFormatsNote() === stored, 'the chosen heading to be stored where the line was', 10_000).catch(() => {
		throw new Error(`The chosen heading was stored as ${JSON.stringify(readFormatsNote())}`);
	});
	await page.keyboard.press(UNDO);
	await waitUntil(() => readFormatsNote() === bytes, 'one undo to put the file back', 10_000).catch(() => {
		throw new Error(`One undo left ${JSON.stringify(readFormatsNote())}`);
	});
	const blocks = await blockTexts(frame);
	if (JSON.stringify(blocks) !== JSON.stringify(['First line.', 'Second line.'])) {
		throw new Error(`One undo left the blocks ${JSON.stringify(blocks)}`);
	}
}

/**
 * The menu of blocks, criterion 14: Image from the add button opens the system's
 * chooser at once; Cancel leaves the note as it was; a chosen file takes the
 * line's place, and one undo takes it away with no line left.
 */
export async function assertNoteBlockMenuFiles(page) {
	const frame = await showNote(page, ['First line.', '', 'Second line.', ''], 'Second line.');
	await page.waitForTimeout(1_200);
	const bytes = readFormatsNote();

	await clickAddBeside(page, frame, 'First line');
	let chooser = page.waitForEvent('filechooser', { timeout: 8_000 });
	await page.keyboard.type('image', { delay: 30 });
	await page.keyboard.press('Enter');
	await (await chooser).setFiles([]);
	await frame.waitForFunction(() => document.querySelectorAll('.bn-editor .bn-block-content').length === 2, undefined, { timeout: 8_000 }).catch(async () => {
		throw new Error(`Cancel in the chooser left ${JSON.stringify(await blockTexts(frame))}`);
	});

	await clickAddBeside(page, frame, 'First line');
	chooser = page.waitForEvent('filechooser', { timeout: 8_000 });
	await frame.locator('.basehalf-note-menu-row', { hasText: 'Image' }).first().click();
	await (await chooser).setFiles({ name: 'chosen.png', mimeType: 'image/png', buffer: createSolidPng(8, 8, [20, 120, 200]) });
	await waitUntil(() => /^First line\.\n\n!\[[^\]]*\]\([^)]*chosen\.png\)\n\nSecond line\.\n$/.test(readFormatsNote()), 'the chosen picture to be stored where the line was', 15_000).catch(() => {
		throw new Error(`The chosen picture was stored as ${JSON.stringify(readFormatsNote())}`);
	});
	await page.keyboard.press(UNDO);
	await waitUntil(() => readFormatsNote() === bytes, 'one undo to take the picture away', 10_000).catch(() => {
		throw new Error(`One undo of a chosen picture left ${JSON.stringify(readFormatsNote())}`);
	});
	const blocks = await blockTexts(frame);
	if (JSON.stringify(blocks) !== JSON.stringify(['First line.', 'Second line.'])) {
		throw new Error(`One undo of a chosen picture left the blocks ${JSON.stringify(blocks)}`);
	}
}

/** Where the menu stands against the line it opened on. */
function menuAgainstLine(frame) {
	return frame.evaluate(() => {
		const line = document.querySelector('.bn-suggestion-decorator')?.getBoundingClientRect();
		const menu = document.querySelector('.basehalf-note-menu');
		const box = menu?.getBoundingClientRect();
		return line && box ? {
			below: box.top - line.bottom,
			above: line.top - box.bottom,
			left: box.left - line.left,
			bottom: box.bottom,
			top: box.top,
			font: getComputedStyle(menu).fontSize,
			row: menu.querySelector('.basehalf-note-menu-row')?.getBoundingClientRect().height,
			view: innerHeight,
		} : undefined;
	});
}

/**
 * The menu of blocks, criteria 7, 11, and 13: the menu opens under a line in the
 * lower half of the note when there is room and over a line near the bottom, and
 * letters do not move it to the other side; a click elsewhere puts the caret on
 * the line aimed at; and on a magnified note it stands 4 px from the drawn line,
 * itself not magnified.
 */
export async function assertNoteBlockMenuPlacement(page) {
	const lines = [];
	for (let index = 1; index <= 40; index++) {
		lines.push(`Line number ${index} of the long note.`, '');
	}
	const frame = await showNote(page, lines, 'Line number 40');
	await page.waitForTimeout(800);

	const place = async text => frame.evaluate(needle => {
		const block = [...document.querySelectorAll('.bn-editor .bn-block-content')].find(candidate => candidate.textContent.includes(needle));
		return { top: block.getBoundingClientRect().top, view: innerHeight };
	}, text);
	const scrollLineTo = async (text, fromBottom) => {
		await frame.evaluate(([needle, distance]) => {
			const scroll = document.querySelector('.basehalf-markdown-rich-scroll');
			const block = [...document.querySelectorAll('.bn-editor .bn-block-content')].find(candidate => candidate.textContent.includes(needle));
			scroll.scrollTop += block.getBoundingClientRect().bottom - (innerHeight - distance);
		}, [text, fromBottom]);
		await page.waitForTimeout(150);
	};

	// In the lower half, with more than 240 px below it.
	await scrollLineTo('Line number 30 ', 330);
	const { top, view } = await place('Line number 30 ');
	if (top < view / 2) {
		throw new Error(`The line for the check of the lower half stands at ${top} of ${view}`);
	}
	await clickAddBeside(page, frame, 'Line number 30 ');
	const lower = await menuAgainstLine(frame);
	if (!lower || Math.abs(lower.below - 4) > 1 || Math.abs(lower.left) > 1) {
		throw new Error(`Under a line in the lower half the menu stands at ${JSON.stringify(lower)}`);
	}
	await closeMenu(page, frame);

	// Near the bottom: over the line, also once letters shorten the list.
	await scrollLineTo('Line number 30 ', 60);
	await clickAddBeside(page, frame, 'Line number 30 ');
	const near = await menuAgainstLine(frame);
	if (!near || Math.abs(near.above - 4) > 1) {
		throw new Error(`Near the bottom the menu stands at ${JSON.stringify(near)}`);
	}
	await page.keyboard.type('qu', { delay: 40 });
	await page.waitForTimeout(250);
	const narrowed = await menuAgainstLine(frame);
	if (!narrowed || Math.abs(narrowed.above - 4) > 1 || narrowed.top <= near.top) {
		throw new Error(`Letters moved the menu from over its line: ${JSON.stringify({ near, narrowed })}`);
	}
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await closeMenu(page, frame);

	// A click elsewhere lands on the line aimed at, which the new line's going moves.
	await scrollLineTo('Line number 30 ', 330);
	await clickAddBeside(page, frame, 'Line number 30 ');
	const target = await frame.locator('.bn-editor .bn-block-content', { hasText: 'Line number 32 ' }).first().boundingBox();
	await page.mouse.click(target.x + 380, target.y + target.height / 2);
	await theMenu(frame).waitFor({ state: 'hidden', timeout: 5_000 });
	await page.waitForTimeout(150);
	await page.keyboard.type('Q');
	await waitUntil(() => readFormatsNote().includes('Line number 32 of the long note.Q'), 'the letter after a click elsewhere to land on the line aimed at', 10_000).catch(() => {
		throw new Error(`After a click elsewhere the letter went elsewhere: ${JSON.stringify(readFormatsNote().split('\n').filter(line => line.includes('Q')))}`);
	});
	await page.keyboard.press('Backspace');

	// On a magnified note.
	const line = await frame.locator('.bn-editor .bn-block-content', { hasText: 'Line number 32 ' }).first().boundingBox();
	await pinch(page, line.x + 60, line.y + 8, 2);
	await page.waitForTimeout(600);
	await clickAddBeside(page, frame, 'Line number 32 ');
	const magnified = await menuAgainstLine(frame);
	if (!magnified || (Math.abs(magnified.below - 4) > 1 && Math.abs(magnified.above - 4) > 1) || magnified.font !== '13px' || magnified.row !== 30) {
		throw new Error(`On a magnified note the menu stands at ${JSON.stringify(magnified)}`);
	}
	await closeMenu(page, frame);
	const magnifiedLine = await frame.locator('.bn-editor .bn-block-content', { hasText: 'Line number 32 ' }).first().boundingBox();
	await pinch(page, magnifiedLine.x + 60, magnifiedLine.y + 8, 0.5);
	await page.waitForTimeout(600);
}

/** The menu of blocks, rule 25: Escape closes the lists of `/`, `[[`, and `:`, Card Detail stays, and what the user typed stays. */
export async function assertNoteBlockMenuEscapeClosesEveryList(page) {
	const frame = await showNote(page, ['First line.', '', 'Second line.', ''], 'Second line.');
	const line = frame.locator('.bn-editor .bn-block-content', { hasText: 'Second line.' }).first();
	await line.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');

	for (const { keys, list } of [
		{ keys: ' /', list: '.basehalf-note-menu' },
		{ keys: ' [[', list: '.basehalf-note-menu' },
		{ keys: ' :sm', list: '.bn-grid-suggestion-menu' },
	]) {
		await page.keyboard.type(keys, { delay: 30 });
		const shown = frame.locator(`.basehalf-markdown-rich-portal ${list}`).first();
		await shown.waitFor({ state: 'visible', timeout: 8_000 });
		await page.keyboard.press('Escape');
		await shown.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {
			throw new Error(`Escape did not close the list that "${keys}" opened`);
		});
		if (!await page.locator('.basehalf-card-detail.visible').first().isVisible()) {
			throw new Error(`Escape closed Card Detail along with the list that "${keys}" opened`);
		}
	}
	await waitUntil(() => readFormatsNote().includes('Second line. / [[ :sm'), 'what was typed to stay', 10_000).catch(() => {
		throw new Error(`What was typed did not stay after Escape: ${JSON.stringify(readFormatsNote())}`);
	});
}
