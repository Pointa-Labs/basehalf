/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Resizing a Note while it is edited on its card: the editing, its caret, an
// input method's composition, and both undos go on through the resize.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { canvasCardCornerBandPoint, waitForCanvasCardCornerIndicators } from './cardChrome.mts';
import { centerCanvasCards } from './creation.mts';
import { placeCanvasInlineCaretAfter } from './noteEditor.mts';
import { workspacePath } from '../../context.mts';
import { canvasNoteInlineEditor, waitForCanvasNoteInlineEditor, zoomCanvas } from '../../lib/canvas.mts';
import { closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { waitUntil } from '../../lib/steps.mts';

const UNDO_KEY = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO_KEY = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
const SAVE_KEY = process.platform === 'darwin' ? 'Meta+S' : 'Control+S';

/** The width and height of a card's row in the layout of the workspace's root. */
function readLayoutSize(cardPath) {
	const layout = fs.readFileSync(path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml'), 'utf8');
	const start = layout.indexOf(`path: ${JSON.stringify(cardPath)}`);
	if (start < 0) {
		throw new Error(`The layout holds no row for ${cardPath}`);
	}
	const next = layout.indexOf('\n  - ', start);
	const row = layout.slice(start, next < 0 ? undefined : next);
	return {
		width: Number(/\n\s*width: ([0-9.]+)/.exec(row)?.[1]),
		height: Number(/\n\s*height: ([0-9.]+)/.exec(row)?.[1])
	};
}

/** Records the composition ends and blurs of the editor, from now on. */
function recordEditorEvents(editable) {
	return editable.evaluate(root => {
		const events = [];
		for (const type of ['compositionend', 'blur']) {
			root.addEventListener(type, () => events.push(type), true);
		}
		(window as typeof window & { __basehalfSmokeEditorEvents?: string[] }).__basehalfSmokeEditorEvents = events;
	});
}

function takeEditorEvents(page) {
	return page.evaluate(() => (window as typeof window & { __basehalfSmokeEditorEvents?: string[] }).__basehalfSmokeEditorEvents?.splice(0) ?? []);
}

/** Drags the bottom-right band by an offset, checking the editing in the middle of the gesture. */
async function dragBottomRightBand(page, note, editable, offset) {
	const start = await canvasCardCornerBandPoint(note, 'bottom-right', 3);
	await page.mouse.move(start.x - 24, start.y - 24);
	await page.mouse.move(start.x, start.y, { steps: 4 });
	await waitForCanvasCardCornerIndicators(page, 'README.md', ['bottom-right'], 'while its Note is edited');
	const layoutBefore = readLayoutSize('README.md');
	await page.mouse.down();
	// The resizer drops the distance of the first move.
	await page.mouse.move(start.x + Math.sign(offset.x) * 3, start.y + Math.sign(offset.y) * 3);
	await page.mouse.move(start.x + offset.x, start.y + offset.y, { steps: 12 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.getAttribute('data-card-resizing') === 'true', null, { timeout: 10_000 });
	const during = await editable.evaluate(root => ({
		keyboard: document.activeElement === root,
		editing: root.closest('.basehalf-canvas-card')?.getAttribute('data-note-editing')
	}));
	if (!during.keyboard || during.editing !== 'true') {
		throw new Error(`A resize took the keyboard from the Note being edited: ${JSON.stringify(during)}`);
	}
	if (JSON.stringify(readLayoutSize('README.md')) !== JSON.stringify(layoutBefore)) {
		throw new Error('The size of a Note being edited was saved before pointer-up');
	}
	await page.mouse.up();
	await waitUntil(() => Math.abs(readLayoutSize('README.md').width - layoutBefore.width) > Math.abs(offset.x) / 2, 'the new size of the Note being edited to be saved after pointer-up', 10_000);
	return readLayoutSize('README.md');
}

export async function assertCanvasNoteResizeWhileEditing(page) {
	await closeCardDetailIfOpen(page);
	const pane = page.locator('.react-flow__pane');
	const note = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const readmePath = path.join(workspacePath, 'README.md');
	const originalMarkdown = fs.readFileSync(readmePath, 'utf8');
	const readme = () => fs.readFileSync(readmePath, 'utf8');
	const needle = 'soft-line-beta';
	await zoomCanvas(page, 'reset');
	await note.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [note]);
	await pane.click({ position: { x: 16, y: 16 } });
	await note.click();
	const sizeAtRest = readLayoutSize('README.md');
	const paragraph = note.locator('.bh-md-preview p', { hasText: needle }).first();
	await paragraph.dblclick();
	const editor = await waitForCanvasNoteInlineEditor(page, 'README.md');
	await placeCanvasInlineCaretAfter(editor.editable, needle);

	// The fixture saves a note only when asked to.
	const editorText = () => editor.editable.evaluate(root => root.textContent ?? '');
	const editorHolds = (text, description) => page.waitForFunction(
		expected => document.querySelector('[data-testid="canvas-note-editor-README.md"] .ProseMirror')?.textContent?.includes(expected),
		text,
		{ timeout: 10_000 }
	).catch(() => {
		throw new Error(`Timed out waiting for ${description}`);
	});
	const saveAndExpect = async (expected, description) => {
		await page.keyboard.press(SAVE_KEY);
		await waitUntil(() => readme() === expected, description, 15_000);
	};

	// Typing, a resize from the corner, and more typing: the letters go where the caret was.
	await page.keyboard.type(' resize-marker');
	await editorHolds(`${needle} resize-marker`, 'the typing before the resize');
	await recordEditorEvents(editor.editable);
	const boxBefore = await note.boundingBox();
	const grown = await dragBottomRightBand(page, note, editor.editable, { x: 84, y: 60 });
	const boxAfter = await note.boundingBox();
	if (!boxBefore || !boxAfter || boxAfter.width < boxBefore.width + 40 || boxAfter.height < boxBefore.height + 30) {
		throw new Error(`The Note being edited did not grow with its corner: ${JSON.stringify({ boxBefore, boxAfter, grown })}`);
	}
	const eventsOfResize = await takeEditorEvents(page);
	if (eventsOfResize.length > 0) {
		throw new Error(`A resize ended the editing of the Note: ${JSON.stringify(eventsOfResize)}`);
	}
	await page.keyboard.type('Q');
	await editorHolds(`${needle} resize-markerQ`, 'letters typed after the resize to go where the caret was');
	await saveAndExpect(originalMarkdown.replace(needle, `${needle} resize-markerQ`), 'the note to hold exactly the text typed around the resize');

	// Command+Z in the editor undoes its text, asks nothing, and leaves the size.
	for (let press = 0; press < 3; press++) {
		const before = await editorText();
		if (!before.includes('resize-marker')) {
			break;
		}
		await page.keyboard.press(UNDO_KEY);
		await page.waitForFunction(
			previous => document.querySelector('[data-testid="canvas-note-editor-README.md"] .ProseMirror')?.textContent !== previous,
			before,
			{ timeout: 10_000 }
		).catch(() => {
			throw new Error('Command+Z in the Note being edited did not undo its text after a resize');
		});
	}
	await saveAndExpect(originalMarkdown, 'Command+Z in the Note being edited to undo its text after a resize');
	if (JSON.stringify(readLayoutSize('README.md')) !== JSON.stringify(grown)) {
		throw new Error(`Command+Z in the Note being edited changed its size: ${JSON.stringify({ grown, now: readLayoutSize('README.md') })}`);
	}

	// An input method's composition stays open through a resize.
	await placeCanvasInlineCaretAfter(editor.editable, needle);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
	await page.waitForFunction(token => document.querySelector('[data-testid="canvas-note-editor-README.md"] .ProseMirror')?.textContent?.includes(`${token}ni`), needle, { timeout: 5_000 });
	await recordEditorEvents(editor.editable);
	const shrunk = await dragBottomRightBand(page, note, editor.editable, { x: -84, y: -60 });
	const eventsOfComposition = await takeEditorEvents(page);
	if (eventsOfComposition.length > 0) {
		throw new Error(`A resize ended an open composition in the Note being edited: ${JSON.stringify(eventsOfComposition)}`);
	}
	await cdp.send('Input.insertText', { text: '你' });
	await editorHolds(`${needle}你`, 'the composition ended after a resize to put its text at the caret');
	await saveAndExpect(originalMarkdown.replace(needle, `${needle}你`), 'the note to hold the text of the composition');
	await page.keyboard.press(UNDO_KEY);
	await page.waitForFunction(
		token => !document.querySelector('[data-testid="canvas-note-editor-README.md"] .ProseMirror')?.textContent?.includes(`${token}你`),
		needle,
		{ timeout: 10_000 }
	);
	await saveAndExpect(originalMarkdown, 'Command+Z to undo the text of the composition');
	await cdp.detach();

	// Once the editing has ended, the canvas undoes and redoes the sizes.
	await page.keyboard.press('Escape');
	await canvasNoteInlineEditor(page, 'README.md').host.waitFor({ state: 'detached', timeout: 15_000 });
	await note.focus();
	await page.keyboard.press(UNDO_KEY);
	await waitUntil(() => JSON.stringify(readLayoutSize('README.md')) === JSON.stringify(grown), 'canvas undo to put back the size before the second resize', 10_000);
	await note.focus();
	await page.keyboard.press(UNDO_KEY);
	await waitUntil(() => JSON.stringify(readLayoutSize('README.md')) === JSON.stringify(sizeAtRest), 'canvas undo to put back the size the Note had at rest', 10_000);
	await note.focus();
	await page.keyboard.press(REDO_KEY);
	await waitUntil(() => JSON.stringify(readLayoutSize('README.md')) === JSON.stringify(grown), 'canvas redo to make the first resize again', 10_000);
	await note.focus();
	await page.keyboard.press(UNDO_KEY);
	await waitUntil(() => JSON.stringify(readLayoutSize('README.md')) === JSON.stringify(sizeAtRest), 'canvas undo to leave the Note at its size at rest', 10_000);
	if (readme() !== originalMarkdown || JSON.stringify(shrunk) === JSON.stringify(grown)) {
		throw new Error('Resizing a Note while it was edited did not leave its text as it was');
	}
}
