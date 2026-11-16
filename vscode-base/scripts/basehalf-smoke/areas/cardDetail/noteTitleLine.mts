/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail starts every note with its title line (note title, "The title line and the text under it"; D136).

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { clickCanvasCreateAction, openRootCanvas, waitForCanvasNoteInlineEditor } from '../../lib/canvas.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

const FOLDER = 'titles';

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

function text(relativePath) {
	const file = workspaceFile(relativePath);
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/** The lines of the note in Rich: each block's kind, text, the pale word of a title line, and whether the caret is in it. */
function richLines(frame) {
	return frame.evaluate(() => {
		const editor = document.querySelector('.bn-editor');
		const selection = window.getSelection();
		return [...(editor?.querySelectorAll('.bn-block-content') ?? [])].map(block => ({
			type: block.getAttribute('data-content-type'),
			text: block.textContent,
			title: block.hasAttribute('data-basehalf-title-line') ? getComputedStyle(block, '::after').content : undefined,
			caret: !!editor?.contains(document.activeElement) && block.contains(selection?.anchorNode ?? null),
		}));
	});
}

async function openNote(page, relativePath) {
	await quickOpen(page, relativePath);
	await assertCardDetail(page, path.basename(relativePath));
	const frame = await activeMarkdownRichFrame(page);
	await frame.waitForFunction(() => document.querySelector('.bn-editor')?.contains(document.activeElement) === true, null, { timeout: 10_000 });
	return frame;
}

/**
 * Note title, criteria 25 to 28 and 30, in the real window: New Note and
 * Expand open Card Detail at the title line, and the title typed there names
 * the file once Card Detail closes; a title begun on the card goes on at its
 * end in Card Detail; a note that begins with a paragraph shows an
 * empty title line above it, which writes nothing until a title is typed into
 * it; the line under an empty title line made a heading is the title line;
 * and a press below a note of only a title puts the caret in the line under
 * it, with no handles beside the title line.
 */
export async function assertCardDetailNoteTitleLine(page) {
	fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	fs.writeFileSync(workspaceFile(`${FOLDER}/plain-first.md`), 'Text first.\n\nMore.\n', 'utf8');
	fs.writeFileSync(workspaceFile(`${FOLDER}/one-two.md`), 'One\n\nTwo\n', 'utf8');
	fs.writeFileSync(workspaceFile(`${FOLDER}/only-title.md`), '# Comet\n', 'utf8');
	try {
		// The canvas of the folder: Card Detail of one of its notes closes onto it.
		await openNote(page, `${FOLDER}/only-title.md`);
		await closeCardDetailIfOpen(page);

		// 25. New Note, Expand: the title line with the caret in it.
		await clickCanvasCreateAction(page, 'New Note');
		await waitUntil(() => text(`${FOLDER}/untitled.md`) !== null, 'New Note to make untitled.md in the folder');
		// A card is named by its path in the workspace.
		await waitForCanvasNoteInlineEditor(page, `${FOLDER}/untitled.md`);
		await page.locator(`button[aria-label="Expand ${FOLDER}/untitled.md"]`).click();
		await assertCardDetail(page, 'untitled.md');
		let frame = await activeMarkdownRichFrame(page);
		await frame.waitForFunction(() => document.querySelector('.bn-editor')?.contains(document.activeElement) === true, null, { timeout: 10_000 });
		const opened = await richLines(frame);
		if (JSON.stringify(opened) !== JSON.stringify([{ type: 'heading', text: '', title: '"Title"', caret: true }, { type: 'paragraph', text: '', caret: false }])) {
			throw new Error(`A new note opened large must start at its empty title line, with the caret in it and a line under it: ${JSON.stringify(opened)}`);
		}
		await page.keyboard.type('Anatomy');
		await waitUntil(() => text(`${FOLDER}/untitled.md`) === '# Anatomy\n', 'the title typed in Card Detail to be saved as the note\'s title');
		await page.keyboard.press('Escape');
		await waitUntil(() => text(`${FOLDER}/Anatomy.md`) === '# Anatomy\n' && text(`${FOLDER}/untitled.md`) === null, 'the new note to take the name of its title once Card Detail closed');

		// 30. A title begun on the card goes on in Card Detail, at its end.
		await clickCanvasCreateAction(page, 'New Note');
		await waitUntil(() => text(`${FOLDER}/untitled.md`) !== null, 'New Note to make untitled.md in the folder');
		await waitForCanvasNoteInlineEditor(page, `${FOLDER}/untitled.md`);
		await page.keyboard.type('Nebu');
		await page.locator(`button[aria-label="Expand ${FOLDER}/untitled.md"]`).click();
		await assertCardDetail(page, 'untitled.md');
		frame = await activeMarkdownRichFrame(page);
		await frame.waitForFunction(() => document.querySelector('.bn-editor')?.contains(document.activeElement) === true, null, { timeout: 10_000 });
		const begun = await richLines(frame);
		if (JSON.stringify(begun.map(line => [line.type, line.text, line.caret])) !== JSON.stringify([['heading', 'Nebu', true], ['paragraph', '', false]])) {
			throw new Error(`A title begun on the card must go on in Card Detail at its end: ${JSON.stringify(begun)}`);
		}
		await page.keyboard.type('la');
		// The card wrote the title without a line break after it, and Rich keeps how the file ends.
		await waitUntil(() => /^# Nebula\n?$/.test(text(`${FOLDER}/untitled.md`) ?? ''), 'the title to go on where it stopped').catch(() => {
			throw new Error(`The title did not go on where it stopped: ${JSON.stringify(text(`${FOLDER}/untitled.md`))}`);
		});
		await page.keyboard.press('Escape');
		await waitUntil(() => /^# Nebula\n?$/.test(text(`${FOLDER}/Nebula.md`) ?? '') && text(`${FOLDER}/untitled.md`) === null, 'the note to take the name of its title once Card Detail closed');

		// 26. A note that begins with a paragraph: an empty title line above it.
		frame = await openNote(page, `${FOLDER}/plain-first.md`);
		const plain = await richLines(frame);
		if (JSON.stringify(plain) !== JSON.stringify([{ type: 'heading', text: '', title: '"Title"', caret: false }, { type: 'paragraph', text: 'Text first.', caret: false }, { type: 'paragraph', text: 'More.', caret: true }])) {
			throw new Error(`A note that begins with a paragraph must show an empty title line above it, with the caret at the end of the note: ${JSON.stringify(plain)}`);
		}
		await page.keyboard.type(' Again.');
		await waitUntil(() => text(`${FOLDER}/plain-first.md`) === 'Text first.\n\nMore. Again.\n', 'a line typed at the end to be saved, without a title');
		const titleBox = await frame.locator('.bn-block-content').first().boundingBox();
		await page.mouse.click(titleBox.x + 8, titleBox.y + titleBox.height / 2);
		await page.keyboard.type('Plain');
		await waitUntil(() => text(`${FOLDER}/plain-first.md`) === '# Plain\n\nText first.\n\nMore. Again.\n', 'the title typed into the empty title line to be saved above the text');
		await page.keyboard.press('Escape');
		await waitUntil(() => text(`${FOLDER}/Plain.md`) !== null && text(`${FOLDER}/plain-first.md`) === null, 'the note to take the name of the title typed in Card Detail');

		// 27. The line under an empty title line made a heading is the title line.
		frame = await openNote(page, `${FOLDER}/one-two.md`);
		const one = await frame.locator('.bn-block-content', { hasText: 'One' }).boundingBox();
		await page.mouse.click(one.x + 2, one.y + one.height / 2);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
		await page.keyboard.type('## ');
		await frame.waitForFunction(() => document.querySelector('.bn-block-content')?.getAttribute('data-content-type') === 'heading' && document.querySelector('.bn-block-content')?.textContent === 'One', null, { timeout: 5_000 });
		const madeHeading = await richLines(frame);
		if (JSON.stringify(madeHeading.map(line => [line.type, line.text, line.title !== undefined])) !== JSON.stringify([['heading', 'One', false], ['paragraph', 'Two', false]])) {
			throw new Error(`The line under an empty title line made a heading must be the title line, and the empty line go: ${JSON.stringify(madeHeading)}`);
		}
		await waitUntil(() => text(`${FOLDER}/one-two.md`) === '## One\n\nTwo\n', 'the heading to be saved as the note\'s first line');
		await page.keyboard.press('Escape');
		await waitUntil(() => text(`${FOLDER}/One.md`) !== null, 'the note to take the name of the heading that is its title now');

		// 28. A press below a note of only a title; no handles beside the title line.
		frame = await openNote(page, `${FOLDER}/only-title.md`);
		const title = await frame.locator('.bn-block-content').first().boundingBox();
		await page.mouse.move(title.x + 20, title.y + title.height / 2);
		await page.waitForTimeout(400);
		const handles = await frame.evaluate(() => [...document.querySelectorAll('.bn-side-menu')].filter(menu => menu.getClientRects().length > 0).length);
		if (handles !== 0) {
			throw new Error(`The title line must show no handles under the pointer: ${handles} shown`);
		}
		const scroll = await frame.locator('.basehalf-markdown-rich-scroll').boundingBox();
		await page.mouse.click(title.x + 40, Math.min(scroll.y + scroll.height - 40, title.y + title.height + 160));
		await page.waitForTimeout(200);
		const pressed = await richLines(frame);
		if (JSON.stringify(pressed.map(line => [line.type, line.text, line.caret])) !== JSON.stringify([['heading', 'Comet', false], ['paragraph', '', true]])) {
			throw new Error(`A press below a note of only a title must put the caret in the line under the title: ${JSON.stringify(pressed)}`);
		}
		await page.keyboard.type('A tail of dust.');
		await waitUntil(() => text(`${FOLDER}/only-title.md`) === '# Comet\n\nA tail of dust.\n', 'the text typed below the title to be saved under it');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(700);
		if (text(`${FOLDER}/only-title.md`) === null) {
			throw new Error('Text typed under the title must not rename the note');
		}
	} finally {
		await closeCardDetailIfOpen(page);
		await openRootCanvas(page);
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
		fs.rmSync(workspaceFile(`.bh/mirror/${FOLDER}`), { recursive: true, force: true });
	}
}
