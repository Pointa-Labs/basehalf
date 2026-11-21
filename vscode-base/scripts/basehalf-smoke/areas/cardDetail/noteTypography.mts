/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A note has one typography, which follows its font and its text size, and opens in the form of its setting
// (note rendering, "The typography of a note" and "The form a note opens in"; D145).

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, openRootCanvas } from '../../lib/canvas.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitForReading } from '../../lib/steps.mts';

const SETTINGS = path.join(workspacePath, '.vscode', 'settings.json');
const FOLDER = 'typography';
const NOTE = `${FOLDER}/typeset.md`;
const PLAIN = `${FOLDER}/plain.txt`;
const SERIF = 'Georgia, serif';
const PARAGRAPH = 'Gas that falls toward a black hole rarely falls straight in. It keeps the angular momentum it had, settles into a flat, spinning disk, and loses energy by friction until it spirals through the innermost stable orbit.';
const NOTE_TEXT = [
	'# typeset',
	'',
	PARAGRAPH,
	'',
	'## Level two',
	'',
	// Long enough to keep its place at the smallest text size: the note still scrolls a view's height past its middle.
	...Array.from({ length: 60 }, (_, index) => [`${PARAGRAPH} (${index + 1})`, '']).flat(),
	'### Level three',
	'',
	'#### Level four',
	'',
	'##### Level five',
	'',
	'###### Level six',
	'',
	'The temperature falls as `T ∝ r^(-3/4)`.',
	''
].join('\n');

const RICH_VIEW = '.basehalf-markdown-rich-scroll';
const RICH_BLOCKS = '.bn-block-content';
const RICH_TEXTS = '.bn-block-content[data-content-type="paragraph"]';
const RICH_HEADINGS = '.bn-block-content[data-content-type="heading"]';
const PREVIEW = '.basehalf-card-detail.visible .basehalf-card-detail-markdown-preview-content.rendered-markdown';
const PREVIEW_VIEW = '.basehalf-card-detail.visible .basehalf-card-detail-markdown-preview-scroll';

const inWorkspace = (relativePath: string) => path.join(workspacePath, ...relativePath.split('/'));

/** Runs `run` with `values` added to the settings of the workspace, and puts the settings back. */
async function withSettings(page, values: Record<string, unknown>, run: () => Promise<void>) {
	const before = fs.readFileSync(SETTINGS, 'utf8');
	fs.writeFileSync(SETTINGS, JSON.stringify({ ...JSON.parse(before), ...values }, null, '\t'), 'utf8');
	try {
		await run();
	} finally {
		fs.writeFileSync(SETTINGS, before, 'utf8');
		// The window reads a changed settings file within about a second.
		await page.waitForTimeout(1_500);
	}
}

/** What a page draws a note with: its text, its headings by level, its code, the width of its text, and where its first paragraph breaks. */
function typesetOf(target, selectors: { text: string; texts: string; headings: string; code: string }) {
	return target.evaluate(({ text, texts, headings, code }) => {
		const paragraph = document.querySelector(texts);
		const breaks: string[] = [];
		const letters = paragraph && document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode();
		if (letters) {
			// The first letters of each line of the paragraph.
			const range = document.createRange();
			const content = letters.textContent ?? '';
			let line = Number.NaN;
			for (let index = 0; index < content.length; index++) {
				range.setStart(letters, index);
				range.setEnd(letters, index + 1);
				const top = Math.round(range.getBoundingClientRect().top);
				if (top !== line) {
					breaks.push(content.slice(index, index + 10));
					line = top;
				}
			}
		}
		const style = paragraph ? getComputedStyle(paragraph) : undefined;
		const codeElement = document.querySelector(code);
		return {
			font: style?.fontFamily,
			size: style?.fontSize,
			line: style?.lineHeight,
			width: Math.round(document.querySelector(text)?.getBoundingClientRect().width ?? 0),
			headings: [...document.querySelectorAll(headings)].map(heading => getComputedStyle(heading).fontSize),
			code: codeElement ? getComputedStyle(codeElement).fontFamily : undefined,
			breaks
		};
	}, selectors);
}

const richTypeset = frame => typesetOf(frame, { text: '.bn-editor', texts: RICH_TEXTS, headings: RICH_HEADINGS, code: '.bn-inline-content code' });
const previewTypeset = page => typesetOf(page, { text: PREVIEW, texts: `${PREVIEW} > p`, headings: `${PREVIEW} > :is(h1, h2, h3, h4, h5, h6)`, code: `${PREVIEW} p code` });

async function showForm(page, label: 'Rich' | 'Preview' | 'Source') {
	const button = page.locator(`.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="${label}"]`);
	await button.click();
	await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('checked') === true,
		`.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="${label}"]`, { timeout: 10_000 });
}

/** The form Card Detail shows the open file in, by the checked button of its switch. */
function shownForm(page) {
	return page.evaluate(() => document.querySelector('.basehalf-card-detail.visible .basehalf-card-detail-projection.checked')?.getAttribute('aria-label') ?? null);
}

/** Samples every frame of a page until `stop` is called: the sizes and fonts of the note's text, and the block at the top of its view. */
async function sampleFrames(target, viewSelector: string, blockSelector: string, textSelector: string) {
	await target.evaluate(({ viewSelector, blockSelector, textSelector }) => {
		const samples = [];
		globalThis.__bhTypographyFrames = samples;
		globalThis.__bhTypographySampling = true;
		const view = document.querySelector(viewSelector);
		const tick = () => {
			const texts = [...document.querySelectorAll(textSelector)];
			const viewTop = view.getBoundingClientRect().top;
			const blocks = [...document.querySelectorAll(blockSelector)];
			const top = blocks.findIndex(block => block.getBoundingClientRect().height > 0 && block.getBoundingClientRect().bottom > viewTop + 1);
			const box = blocks[top]?.getBoundingClientRect();
			samples.push({
				sizes: [...new Set(texts.map(text => getComputedStyle(text).fontSize))],
				fonts: [...new Set(texts.map(text => getComputedStyle(text).fontFamily))],
				top,
				// How much of the block at the top of the view is above it, in parts of its height.
				through: box ? (viewTop - box.top) / box.height : null,
				height: box ? box.height : null,
				selection: document.getSelection()?.toString() ?? ''
			});
			if (globalThis.__bhTypographySampling) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	}, { viewSelector, blockSelector, textSelector });
	return () => target.evaluate(() => {
		globalThis.__bhTypographySampling = false;
		return globalThis.__bhTypographyFrames;
	});
}

/**
 * What the frames of a change must show: every frame the note's text in one size and one font, the size and the font of
 * the last frame the new ones, and the block at the top of the view the same throughout, with the same part of it above
 * the top of the view, to within 2 pixels.
 */
function assertFollowedAtOnce(frames, expected: { size: string; font: RegExp }, what: string) {
	const mixed = frames.filter(frame => frame.sizes.length !== 1 || frame.fonts.length !== 1);
	const first = frames[0];
	const last = frames[frames.length - 1];
	const moved = frames.filter(frame => frame.top !== first.top || frame.through === null || first.through === null
		|| Math.abs(frame.through - first.through) * frame.height > 2);
	if (frames.length < 10 || mixed.length > 0 || last.sizes[0] !== expected.size || !expected.font.test(last.fonts[0]) || moved.length > 0) {
		throw new Error(`${what} did not follow the setting at once: ${JSON.stringify({ frames: frames.length, mixed: mixed.slice(0, 3), first, last, moved: moved.slice(0, 3) })}`);
	}
}

/** The files of these steps, written once; no other step of the suite names them. */
export async function prepareNoteTypography(page) {
	fs.mkdirSync(inWorkspace(FOLDER), { recursive: true });
	fs.writeFileSync(inWorkspace(NOTE), NOTE_TEXT, 'utf8');
	fs.writeFileSync(inWorkspace(PLAIN), 'a line of plain text\n', 'utf8');
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${FOLDER}"]`).waitFor({ state: 'attached', timeout: 20_000 });
}

/**
 * Note rendering, criteria 23 to 25: a note is set the same in Rich and in Preview, in the font of the window at 16 px
 * without a value of the settings, with headings of 48, 32, 20.8, and 16 px and lines that break at the same words; and
 * both follow the text size and the font, code keeping the font of code.
 */
export async function assertNoteHasOneTypography(page) {
	await closeCardDetailIfOpen(page);
	await quickOpen(page, 'typeset.md');
	await assertCardDetail(page, 'typeset.md');
	const frame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	const windowFont = await page.evaluate(() => getComputedStyle(document.querySelector('.monaco-workbench')).fontFamily);
	const rich = await richTypeset(frame);
	await showForm(page, 'Preview');
	const preview = await waitForReading(() => previewTypeset(page), read => read.breaks.length > 0, 'Preview to draw the note');
	const expected = { font: windowFont, size: '16px', line: '24px', headings: ['48px', '32px', '20.8px', '16px', '16px', '16px'] };
	for (const [name, read] of [['Rich', rich], ['Preview', preview]]) {
		if (read.font !== expected.font || read.size !== expected.size || read.line !== expected.line
			|| JSON.stringify(read.headings) !== JSON.stringify(expected.headings) || read.width > 712 || read.width < 300) {
			throw new Error(`${name} does not set the note in its typography: ${JSON.stringify({ read, expected })}`);
		}
	}
	if (rich.width !== preview.width || JSON.stringify(rich.breaks) !== JSON.stringify(preview.breaks) || rich.breaks.length < 2 || rich.code !== preview.code) {
		throw new Error(`Rich and Preview set the same note differently: ${JSON.stringify({ rich, preview })}`);
	}

	// A text size and a font: both forms take them, a size beyond what a note takes is the largest it takes, and code keeps its font.
	await withSettings(page, { 'basehalf.notes.fontSize': 40, 'basehalf.notes.fontFamily': SERIF }, async () => {
		const large = await waitForReading(() => previewTypeset(page), read => read.size === '28px', 'Preview to take the text size');
		await showForm(page, 'Rich');
		const largeRich = await waitForReading(async () => richTypeset(await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active')), read => read.size === '28px', 'Rich to take the text size');
		for (const [name, read] of [['Rich', largeRich], ['Preview', large]]) {
			if (!read.font.startsWith('Georgia') || read.line !== '42px' || read.headings[0] !== '84px' || read.headings[5] !== '28px' || read.code !== rich.code) {
				throw new Error(`${name} did not take the text size and the font: ${JSON.stringify({ read, code: rich.code })}`);
			}
		}
		if (JSON.stringify(largeRich.breaks) !== JSON.stringify(large.breaks)) {
			throw new Error(`Rich and Preview break the note differently at 28 px: ${JSON.stringify({ rich: largeRich.breaks, preview: large.breaks })}`);
		}
	});
	await closeCardDetailIfOpen(page);
}

/**
 * Note rendering, criteria 26 and 27: with a note open in Rich, scrolled into its text with a word selected, a change
 * of the text size and of the font shows in one frame, with the block at the top of the view and the selection kept;
 * the same in Preview; and the cards of the canvas take the font in one frame and keep their size.
 */
export async function assertNoteTypographyIsFollowedAtOnce(page) {
	await closeCardDetailIfOpen(page);
	await quickOpen(page, 'typeset.md');
	await assertCardDetail(page, 'typeset.md');
	const frame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	// Into the middle of the note, and a word of a paragraph in view selected with the pointer.
	const word = await frame.evaluate(({ view, texts }) => {
		const scroller = document.querySelector(view);
		const paragraphs = [...document.querySelectorAll(texts)];
		scroller.scrollTop += paragraphs[6].getBoundingClientRect().top - scroller.getBoundingClientRect().top + 30;
		const letters = document.createTreeWalker(paragraphs[8], NodeFilter.SHOW_TEXT).nextNode();
		const range = document.createRange();
		const at = (letters.textContent ?? '').indexOf('momentum');
		range.setStart(letters, at);
		range.setEnd(letters, at + 'momentum'.length);
		const box = range.getBoundingClientRect();
		return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	}, { view: RICH_VIEW, texts: RICH_TEXTS });
	const frameBox = await (await frame.frameElement()).boundingBox();
	await page.mouse.dblclick(frameBox.x + word.x, frameBox.y + word.y);
	await frame.waitForFunction(() => document.getSelection()?.toString() === 'momentum', null, { timeout: 10_000 });

	await withSettings(page, { 'basehalf.notes.fontSize': 20, 'basehalf.notes.fontFamily': SERIF }, async () => {
		// The file is written by `withSettings` before this runs: the frames from here on hold the change.
		const stop = await sampleFrames(frame, RICH_VIEW, RICH_BLOCKS, RICH_TEXTS);
		await frame.waitForFunction(texts => getComputedStyle(document.querySelector(texts)).fontSize === '20px', RICH_TEXTS, { timeout: 15_000 });
		await page.waitForTimeout(500);
		const frames = await stop();
		assertFollowedAtOnce(frames, { size: '20px', font: /^Georgia/ }, 'Rich');
		if (frames.some(sample => sample.selection !== 'momentum')) {
			throw new Error('Rich lost the selection as the text size changed');
		}
		// The selection is the editor's still: a letter replaces it, and undo brings the word back.
		await page.keyboard.type('X');
		await frame.waitForFunction(texts => [...document.querySelectorAll(texts)][8].textContent.includes('angular X it had'), RICH_TEXTS, { timeout: 10_000 });
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
		await frame.waitForFunction(texts => [...document.querySelectorAll(texts)][8].textContent.includes('angular momentum it had'), RICH_TEXTS, { timeout: 10_000 });

		// The cards of the canvas, under Card Detail, are in the font and keep their size.
		const cards = await page.evaluate(() => [...document.querySelectorAll('.basehalf-canvas-card .bh-md-preview')].map(note => `${getComputedStyle(note).fontFamily.split(',')[0]} ${getComputedStyle(note).fontSize}`));
		if (cards.length === 0 || cards.some(card => card !== 'Georgia 13px')) {
			throw new Error(`The note cards of the canvas did not take the font, or changed their size: ${JSON.stringify(cards)}`);
		}
	});

	// Back to no value, in Preview: one frame again, with the place kept.
	await showForm(page, 'Preview');
	await page.waitForFunction(selector => !!document.querySelector(`${selector} > p`), PREVIEW, { timeout: 10_000 });
	await page.evaluate(({ view, content }) => {
		const scroller = document.querySelector(view);
		scroller.scrollTop += [...document.querySelectorAll(`${content} > p`)][6].getBoundingClientRect().top - scroller.getBoundingClientRect().top + 30;
	}, { view: PREVIEW_VIEW, content: PREVIEW });
	const previewBlocks = `${PREVIEW} > *`;
	await withSettings(page, { 'basehalf.notes.fontSize': 12 }, async () => {
		const stop = await sampleFrames(page, PREVIEW_VIEW, previewBlocks, `${PREVIEW} > p`);
		await page.waitForFunction(selector => getComputedStyle(document.querySelector(`${selector} > p`)).fontSize === '12px', PREVIEW, { timeout: 15_000 });
		await page.waitForTimeout(500);
		assertFollowedAtOnce(await stop(), { size: '12px', font: /./ }, 'Preview');
	});
	await showForm(page, 'Rich');
	await closeCardDetailIfOpen(page);
}

/**
 * Note rendering, criterion 31: a note opens in the form of the setting from the search and from a card's Expand, any
 * other file as before; an opening that names a form keeps it; the switch is kept nowhere; and a change of the setting
 * leaves the open Card Detail in its form.
 */
export async function assertNoteOpensInTheFormOfItsSetting(page) {
	await closeCardDetailIfOpen(page);
	const open = async (name: string) => {
		await closeCardDetailIfOpen(page);
		await quickOpen(page, name);
		await assertCardDetail(page, name);
		return shownForm(page);
	};
	const seen: Record<string, unknown> = {};
	await withSettings(page, { 'basehalf.notes.openIn': 'preview' }, async () => {
		await page.waitForTimeout(1_500);
		seen.note = await open('typeset.md');
		// The switch between the forms changes the open note, and the next opening follows the setting again.
		await showForm(page, 'Rich');
		seen.switched = await shownForm(page);
		seen.again = await open('typeset.md');
		// A file that is no note has no form of a note. A file with one projection shows no switch.
		seen.plain = await open('plain.txt');

		// A card's Expand names no form.
		await closeCardDetailIfOpen(page);
		await quickOpen(page, FOLDER);
		await assertCanvasFolder(page, FOLDER);
		const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${NOTE}"]`);
		await card.waitFor({ state: 'visible', timeout: 20_000 });
		await card.click({ position: { x: 12, y: 12 } });
		await page.getByRole('button', { name: `Expand ${NOTE}`, exact: true }).click();
		await assertCardDetail(page, 'typeset.md');
		seen.expand = await shownForm(page);
	});
	// The setting changed under an open Card Detail, which stays in its form; the next opening is Rich again.
	await page.waitForTimeout(1_500);
	seen.openStays = await shownForm(page);
	seen.withoutValue = await open('typeset.md');
	await withSettings(page, { 'basehalf.notes.openIn': 'source' }, async () => {
		await page.waitForTimeout(1_500);
		seen.source = await open('typeset.md');
	});
	const expected = { note: 'Preview', switched: 'Rich', again: 'Preview', plain: null, expand: 'Preview', openStays: 'Preview', withoutValue: 'Rich', source: 'Source' };
	if (JSON.stringify(seen) !== JSON.stringify(expected)) {
		throw new Error(`A note did not open in the form of its setting: ${JSON.stringify({ seen, expected })}`);
	}
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
}
