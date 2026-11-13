/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A note's title names its file, and its card shows no name above it.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { centerCanvasCards, deleteCanvasCardFromItsMenu } from './creation.mts';
import { workspacePath } from '../../context.mts';
import { cardFramesFailing, stopCardFrames, watchCardFrames } from '../../lib/cardFrames.mts';
import { clickCanvasCreateAction, emptyCanvasPoint, waitForCanvasCardSelection, waitForCanvasNoteInlineEditor } from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';

const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
const TITLE = 'Smoke title';
const TITLED = `${TITLE}.md`;
const TITLED_AGAIN = `${TITLE} 2.md`;
// A note as an agent writes it: a name of its own, and a heading that says something else.
const WRITTEN = 'title-form.md';
const WRITTEN_RETITLED = 'How they form now.md';
// A note that lists the written note as upstream.
const DOWNSTREAM = 'title-uses.md';

const at = name => path.join(workspacePath, name);
const text = name => fs.existsSync(at(name)) ? fs.readFileSync(at(name), 'utf8') : null;

/**
 * Note title, criteria 1, 2, 4, 7 to 9, 11, 12, 15, and 16, in the real
 * window: a new note starts at its title line; the title typed there names
 * the file once the note is let go, and not before; the rename is a step of
 * the canvas's undo; a taken name gets a number; a note left empty keeps its
 * name; a note that was written with a name keeps it until its title is
 * changed, and the note that lists it follows; the card shows no glyph and
 * no name, with its badge button in its corner; and F2 shows the caption
 * with the rename editor. Criterion 3, the note made from a connection, is
 * part of `canvas-create-from-connection`.
 */
export async function assertCanvasNoteTitleNamesFile(page) {
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	const pressOutside = async () => {
		const blank = await emptyCanvasPoint(page);
		await page.mouse.click(blank.x, blank.y);
	};
	const keyboardOnCanvas = async () => {
		await page.locator('.basehalf-canvas-cards').focus();
		await page.waitForFunction(() => document.activeElement?.closest('.basehalf-canvas-cards') !== null, null, { timeout: 10_000 });
	};
	const newNote = async () => {
		await clickCanvasCreateAction(page, 'New Note');
		await waitUntil(() => fs.existsSync(at('untitled.md')), 'New Note to make untitled.md');
		return waitForCanvasNoteInlineEditor(page, 'untitled.md');
	};
	// What a note's card shows of its caption, in canvas pixels.
	const captionOf = name => page.evaluate(wanted => {
		const element = [...document.querySelectorAll('.basehalf-canvas-card')].find(candidate => candidate.getAttribute('data-basehalf-card-path') === wanted);
		const badge = element?.querySelector('.basehalf-canvas-card-badge-toggle');
		const caption = element?.querySelector('.basehalf-canvas-card-caption');
		if (!(element instanceof HTMLElement) || !(badge instanceof HTMLElement) || !(caption instanceof HTMLElement)) {
			return undefined;
		}
		const shown = part => (element.querySelector(part)?.getClientRects().length ?? 0) > 0;
		const zoom = Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) || 1;
		const box = element.getBoundingClientRect();
		const badgeBox = badge.getBoundingClientRect();
		const input = element.querySelector('.basehalf-canvas-inline-name-input input');
		return {
			glyph: shown('.basehalf-canvas-card-caption-icon'),
			name: shown('.basehalf-canvas-card-label'),
			badgeSize: badgeBox.width / zoom,
			badgeRight: (box.right - badgeBox.right) / zoom,
			badgeTop: (badgeBox.top - box.top) / zoom,
			captionAbove: caption.getBoundingClientRect().bottom <= box.top + 1,
			editor: input instanceof HTMLInputElement && input.getClientRects().length > 0
				? { value: input.value, selection: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input }
				: null
		};
	}, name);
	const inCorner = caption => !!caption && !caption.glyph && !caption.name && caption.editor === null
		&& Math.abs(caption.badgeSize - 24) <= 0.5 && Math.abs(caption.badgeRight - 10) <= 0.5 && Math.abs(caption.badgeTop - 11) <= 0.5;

	if (fs.existsSync(at('untitled.md')) || fs.existsSync(at(TITLED))) {
		throw new Error('The note title checks need a canvas without untitled.md');
	}

	// 1. A new note starts at its title line: one empty heading of level 1
	// that shows a pale `Title`, with the caret in it, and an empty file.
	// 19. Every frame from the card's first shows the title line, the one card
	// that is drawn, and never the hint or a loading face.
	await watchCardFrames(page);
	const editor = await newNote();
	const madeFrames = cardFramesFailing(await stopCardFrames(page), ['untitled.md'], card => (card.editor || card.titleLine) && !card.hint && !card.loading);
	if (madeFrames.wrong.length) {
		throw new Error(`A new note must show its title line from the first frame of its card: of ${madeFrames.shown} frames, ${madeFrames.wrong.length} did not, first ${JSON.stringify(madeFrames.wrong[0])}`);
	}
	const start = await editor.editable.evaluate(editable => {
		const blocks = [...editable.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, hr')];
		const first = blocks[0];
		const before = first ? getComputedStyle(first, '::before') : undefined;
		return {
			blocks: blocks.map(block => block.tagName),
			text: editable.textContent,
			placeholder: before?.content,
			pale: before?.color,
			ink: first ? getComputedStyle(first).color : undefined,
			caretInTitle: !!first && first.contains(window.getSelection()?.anchorNode ?? null)
		};
	});
	if (start.blocks.join() !== 'H1' || start.text !== '' || start.placeholder !== '"Title"' || !start.pale || start.pale === start.ink || !start.caretInTitle || text('untitled.md') !== '') {
		throw new Error(`A new note must start at an empty title line that shows a pale Title: ${JSON.stringify({ start, file: text('untitled.md') })}`);
	}
	// 15. The card shows no glyph and no name while it is edited.
	const edited = await captionOf('untitled.md');
	if (!inCorner(edited)) {
		throw new Error(`The card of a note that is edited must show no caption, with its badge button in its corner: ${JSON.stringify(edited)}`);
	}

	// 12. While the editor is open, the file keeps its name.
	await page.keyboard.type(TITLE);
	await page.waitForTimeout(700);
	if (!fs.existsSync(at('untitled.md')) || fs.existsSync(at(TITLED))) {
		throw new Error('A note must keep the name of its file while its editor is open');
	}

	// 2. A press outside the card: the file takes the name of the title, and
	// the card stays where it is, as large as it is.
	const placeBefore = await card('untitled.md').boundingBox();
	// 20. Every frame of the rename shows the card at its place with its title.
	await watchCardFrames(page);
	await pressOutside();
	await waitUntil(() => fs.existsSync(at(TITLED)) && !fs.existsSync(at('untitled.md')), 'the new note to take the name of its title');
	await card(TITLED).waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(1000);
	const renameFrames = cardFramesFailing(await stopCardFrames(page), ['untitled.md', TITLED], (shown, frame) => shown.text.includes(TITLE) && !shown.loading && !shown.hint
		&& Math.abs(shown.x - Math.round(placeBefore?.x ?? 0)) <= 1 && Math.abs(shown.y - Math.round(placeBefore?.y ?? 0)) <= 1
		&& frame.cards.filter(other => other.path === 'untitled.md' || other.path === TITLED).length === 1);
	if (renameFrames.wrong.length) {
		throw new Error(`A note that takes its title's name must show its title at its place in every frame: of ${renameFrames.shown} frames, ${renameFrames.wrong.length} did not, first ${JSON.stringify(renameFrames.wrong[0])}`);
	}
	const placeAfter = await card(TITLED).boundingBox();
	if (!/^# Smoke title\n?$/.test(text(TITLED) ?? '') || !placeBefore || !placeAfter
		|| Math.abs(placeAfter.x - placeBefore.x) > 1 || Math.abs(placeAfter.y - placeBefore.y) > 1
		|| Math.abs(placeAfter.width - placeBefore.width) > 1 || Math.abs(placeAfter.height - placeBefore.height) > 1) {
		throw new Error(`A note named by its title must hold the title and keep its place: ${JSON.stringify({ file: text(TITLED), placeBefore, placeAfter })}`);
	}
	// 15. At rest too.
	const atRest = await captionOf(TITLED);
	if (!inCorner(atRest)) {
		throw new Error(`The card of a note at rest must show no caption, with its badge button in its corner: ${JSON.stringify(atRest)}`);
	}

	// 11. The rename is one step: undo gives the name the file was made with
	// and leaves the title, a second undo takes the note away, and two redos
	// bring it back under the name of its title.
	const titledText = text(TITLED);
	await keyboardOnCanvas();
	await page.keyboard.press(UNDO);
	await waitUntil(() => text('untitled.md') === titledText && !fs.existsSync(at(TITLED)), 'one undo to give the note the name it was made with, its title in it');
	await card('untitled.md').waitFor({ state: 'visible', timeout: 10_000 });
	await keyboardOnCanvas();
	await page.keyboard.press(UNDO);
	await waitUntil(() => !fs.existsSync(at('untitled.md')) && !fs.existsSync(at(TITLED)), 'a second undo to take the new note away');
	await card('untitled.md').waitFor({ state: 'detached', timeout: 10_000 });
	await keyboardOnCanvas();
	await page.keyboard.press(REDO);
	await waitUntil(() => text('untitled.md') === titledText && !fs.existsSync(at(TITLED)), 'redo to bring the new note back');
	await card('untitled.md').waitFor({ state: 'visible', timeout: 10_000 });
	await keyboardOnCanvas();
	await page.keyboard.press(REDO);
	await waitUntil(() => text(TITLED) === titledText && !fs.existsSync(at('untitled.md')), 'a second redo to name the note by its title again');
	await card(TITLED).waitFor({ state: 'visible', timeout: 10_000 });

	// 9. A name that is taken: the next note with that title gets a number.
	await newNote();
	await page.keyboard.type(TITLE);
	await pressOutside();
	await waitUntil(() => fs.existsSync(at(TITLED_AGAIN)) && !fs.existsSync(at('untitled.md')), 'a second note with the same title to take the title with a number');
	if (text(TITLED_AGAIN) !== titledText || text(TITLED) !== titledText) {
		throw new Error(`A note whose title names a file that is there must keep its title and leave that file: ${JSON.stringify({ first: text(TITLED), second: text(TITLED_AGAIN) })}`);
	}
	await card(TITLED_AGAIN).waitFor({ state: 'visible', timeout: 10_000 });

	// 4. A new note that is left without typing is an empty untitled.md.
	const left = await newNote();
	await pressOutside();
	await left.host.waitFor({ state: 'detached', timeout: 10_000 });
	await page.waitForTimeout(700);
	if (text('untitled.md') !== '') {
		throw new Error(`A new note left without typing must stay an empty untitled.md: ${JSON.stringify(text('untitled.md'))}`);
	}

	// 16. F2 on a selected note: the caption stands above the card with the
	// name in the rename editor, all of it selected, and Escape takes it away.
	await centerCanvasCards(page, [card(TITLED)]);
	await card(TITLED).click();
	await waitForCanvasCardSelection(page, TITLED);
	const selected = await captionOf(TITLED);
	if (!inCorner(selected)) {
		throw new Error(`The card of a selected note must show no caption, with its badge button in its corner: ${JSON.stringify(selected)}`);
	}
	await page.keyboard.press('F2');
	await card(TITLED).locator('.basehalf-canvas-inline-name-input input').waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => document.activeElement instanceof HTMLInputElement && document.activeElement.closest('.basehalf-canvas-inline-name-input') !== null, null, { timeout: 5_000 });
	const named = await captionOf(TITLED);
	if (!named?.glyph || !named.captionAbove || named.editor?.value !== TITLE || named.editor.selection.join() !== `0,${TITLE.length}` || !named.editor.focused) {
		throw new Error(`F2 on a note must show its caption above the card with the name in the rename editor, all of it selected: ${JSON.stringify(named)}`);
	}
	await page.keyboard.press('Escape');
	await card(TITLED).locator('.basehalf-canvas-inline-name-input input').waitFor({ state: 'detached', timeout: 10_000 });
	const afterEscape = await captionOf(TITLED);
	if (!inCorner(afterEscape) || !fs.existsSync(at(TITLED))) {
		throw new Error(`Escape in the rename editor of a note must take the caption away and leave the name: ${JSON.stringify(afterEscape)}`);
	}
	await pressOutside();

	// 7. A note that was written with a name keeps it: when it appears, and
	// when the text below its title is changed on the card.
	fs.writeFileSync(at(WRITTEN), '## How they form\n\nStars collapse.\n', 'utf8');
	fs.writeFileSync(at(DOWNSTREAM), `---\nupstream:\n  - ${WRITTEN}\n---\n# What follows\n`, 'utf8');
	await card(WRITTEN).waitFor({ state: 'visible', timeout: 10_000 });
	await card(DOWNSTREAM).waitFor({ state: 'visible', timeout: 10_000 });
	await centerCanvasCards(page, [card(WRITTEN)]);
	await card(WRITTEN).locator('.bh-md-preview p', { hasText: 'Stars collapse.' }).dblclick();
	const below = await waitForCanvasNoteInlineEditor(page, WRITTEN);
	await page.keyboard.press('End');
	await page.keyboard.type(' And gas.');
	await pressOutside();
	await below.host.waitFor({ state: 'detached', timeout: 10_000 });
	await waitUntil(() => (text(WRITTEN) ?? '').includes('Stars collapse. And gas.'), 'the text typed below the title to be saved');
	await page.waitForTimeout(700);
	if (!fs.existsSync(at(WRITTEN)) || fs.existsSync(at('How they form.md'))) {
		throw new Error('A change below the title of a note must not rename its file');
	}

	// 8. Its title changed on the card: the file takes the new title, and the
	// note that listed the file lists its new name.
	await centerCanvasCards(page, [card(WRITTEN)]);
	await card(WRITTEN).locator('.bh-md-preview h2', { hasText: 'How they form' }).dblclick();
	const retitled = await waitForCanvasNoteInlineEditor(page, WRITTEN);
	await page.keyboard.press('End');
	await page.keyboard.type(' now');
	await pressOutside();
	await retitled.host.waitFor({ state: 'detached', timeout: 10_000 });
	await waitUntil(() => fs.existsSync(at(WRITTEN_RETITLED)) && !fs.existsSync(at(WRITTEN)), 'a note whose title was changed to take the name of the new title');
	if (!(text(WRITTEN_RETITLED) ?? '').startsWith('## How they form now\n')) {
		throw new Error(`A note renamed by its title must hold the title as typed: ${JSON.stringify(text(WRITTEN_RETITLED))}`);
	}
	await waitUntil(() => /upstream:\n\s+- "?How they form now\.md"?\n/.test(text(DOWNSTREAM) ?? ''), 'the note that listed the renamed file to list its new name');
	await card(WRITTEN_RETITLED).waitFor({ state: 'visible', timeout: 10_000 });

	// The notes of these checks go with their rows.
	for (const name of [TITLED, TITLED_AGAIN, 'untitled.md', DOWNSTREAM, WRITTEN_RETITLED]) {
		await centerCanvasCards(page, [card(name)]);
		await deleteCanvasCardFromItsMenu(page, name);
		await card(name).waitFor({ state: 'detached', timeout: 10_000 });
	}
	await page.keyboard.press('Escape');
}
