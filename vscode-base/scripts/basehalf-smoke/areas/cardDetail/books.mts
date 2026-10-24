/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail of a book: the reader shows it, turns its pages, and grows a branch from a passage (PDFs and books).

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { EPUB_FIXTURE_PASSAGE } from '../../fixture.mts';
import { assertCanvasEdgeVisible, assertCanvasFolder, waitForCanvasCardSelection, waitForCanvasNoteInlineEditor } from '../../lib/canvas.mts';
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { waitForReading } from '../../lib/steps.mts';

/** The page of the book reader once it shows the book, and the frame of the section that holds the fixture's passage. */
async function bookFrames(page) {
	return waitForReading(async () => {
		let reader;
		let section;
		for (const frame of page.frames()) {
			if (await frame.locator('#basehalf-book-reader[data-status="ready"]').count().catch(() => 0) > 0) {
				reader = frame;
			} else if (await frame.locator('#smoke-passage').count().catch(() => 0) > 0) {
				section = frame;
			}
		}
		return { reader, section };
	}, frames => !!frames.reader && !!frames.section, 'the book reader to show the first chapter of primer.epub', 20_000);
}

async function readChapter(reader) {
	return (await reader.locator('#chapter').textContent())?.trim();
}

/** Criterion 8, in part: the book opens at its start, in the reader of its own. */
export async function assertBookCardDetail(page) {
	await assertCardDetail(page, 'primer.epub');
	const { reader } = await bookFrames(page);
	const chapter = await readChapter(reader);
	if (chapter !== 'Chapter One') {
		throw new Error(`The book did not open at its first chapter: ${JSON.stringify(chapter)}`);
	}
}

/** Criterion 8, in part: Next Page and the Left arrow key turn the pages of a book. */
export async function assertBookTurnsPages(page) {
	const { reader } = await bookFrames(page);
	await reader.locator('#next').click();
	await waitForReading(() => readChapter(reader), chapter => chapter === 'Chapter Two', 'Next Page to turn to the second chapter');
	// The reader turns a page once the turn before it has ended, and a key
	// pressed while it ends is dropped: press again until the page turns. The
	// first chapter is one page, so a press too many changes nothing.
	await waitForReading(async () => {
		await page.keyboard.press('ArrowLeft');
		await page.waitForTimeout(300);
		return readChapter(reader);
	}, chapter => chapter === 'Chapter One', 'the Left arrow key to turn back to the first chapter');
}

/** Criterion 11: Grow branch on a passage makes a note beside the book, connected from it, that names the chapter. */
export async function assertBookGrowsBranch(page) {
	const { reader, section } = await bookFrames(page);
	await section.evaluate(() => {
		const range = document.createRange();
		range.selectNodeContents(document.getElementById('smoke-passage'));
		const selection = document.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});
	const grow = reader.locator('#grow');
	await grow.waitFor({ state: 'visible', timeout: 10_000 });
	await grow.click();
	const branchPath = path.join(workspacePath, 'docs', 'primer-note.md');
	await waitForReading(() => fs.existsSync(branchPath), exists => exists, 'primer-note.md to be grown from the passage');
	await assertCanvasFolder(page, 'docs');
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs/primer-note.md"]').waitFor({ state: 'visible', timeout: 15_000 });
	await waitForCanvasCardSelection(page, 'docs/primer-note.md', 15_000);
	const editor = await waitForCanvasNoteInlineEditor(page, 'docs/primer-note.md');
	const markdown = fs.readFileSync(branchPath, 'utf8');
	if (!markdown.startsWith('---\nupstream:\n  - docs/primer.epub\n---\n')) {
		throw new Error(`primer-note.md did not list the book as upstream in its first bytes: ${JSON.stringify(markdown.slice(0, 120))}`);
	}
	if (!markdown.includes(`> ${EPUB_FIXTURE_PASSAGE}`) || !markdown.includes('Source: [primer.epub](./primer.epub), Chapter One')) {
		throw new Error(`primer-note.md did not quote the passage and name its chapter: ${JSON.stringify(markdown)}`);
	}
	await assertCanvasEdgeVisible(page, 'docs/primer.epub', 'docs/primer-note.md');
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
}
