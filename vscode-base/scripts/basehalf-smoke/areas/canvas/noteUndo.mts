/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Command+Z in the editor of a note on its card undoes its text and never a
// step of the canvas, and nothing asks.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { centerCanvasCards } from './creation.mts';
import { workspacePath } from '../../context.mts';
import { canvasNoteInlineEditor, waitForCanvasCardSelection, waitForCanvasNoteInlineEditor } from '../../lib/canvas.mts';
import { closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { waitUntil } from '../../lib/steps.mts';

const UNDO_KEY = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const NOTE = 'undo-asks.md';
const RENAMED = 'undo-asked.md';
const TEXT = 'Typed into after a rename.\n';

export async function assertCanvasNoteUndoAsksNothing(page) {
	await closeCardDetailIfOpen(page);
	const at = name => path.join(workspacePath, name);
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	fs.writeFileSync(at(NOTE), TEXT, 'utf8');
	await card(NOTE).waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [card(NOTE)]);

	// A rename on the canvas is a step of the canvas that names the note's file.
	await card(NOTE).focus();
	await page.keyboard.press('F2');
	const nameInput = card(NOTE).locator('.basehalf-canvas-inline-name-input input');
	await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
	await nameInput.fill(RENAMED.replace(/\.md$/, ''));
	await nameInput.press('Enter');
	await waitUntil(() => fs.existsSync(at(RENAMED)) && !fs.existsSync(at(NOTE)), 'the rename on the canvas', 15_000);
	await card(RENAMED).waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [card(RENAMED)]);

	// Typing in the note's editor on its card, and Command+Z past the typing.
	const paragraph = card(RENAMED).locator('.bh-md-preview p').first();
	await paragraph.click();
	await waitForCanvasCardSelection(page, RENAMED);
	await paragraph.dblclick();
	await waitForCanvasNoteInlineEditor(page, RENAMED);
	await page.keyboard.type('XY');
	await page.waitForFunction(name => document.querySelector(`[data-testid="canvas-note-editor-${name}"] .ProseMirror`)?.textContent?.includes('XY'), RENAMED, { timeout: 10_000 });
	await page.keyboard.press(UNDO_KEY);
	await page.waitForFunction(name => !document.querySelector(`[data-testid="canvas-note-editor-${name}"] .ProseMirror`)?.textContent?.includes('XY'), RENAMED, { timeout: 10_000 });
	// The next step back is the rename: the keys do nothing there.
	await page.keyboard.press(UNDO_KEY);
	await page.waitForTimeout(500);
	if (!fs.existsSync(at(RENAMED)) || fs.existsSync(at(NOTE))) {
		throw new Error('Command+Z in the editor of a note undid the rename on the canvas');
	}
	if (await canvasNoteInlineEditor(page, RENAMED).host.count() !== 1) {
		throw new Error('Command+Z past the typing ended the editing of the note');
	}
	// An editor that waits for a question cannot close.
	await page.keyboard.press('Escape');
	await canvasNoteInlineEditor(page, RENAMED).host.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {
		throw new Error('The editor of the note did not close after Command+Z past the typing: its undo waits for a question');
	});
	if (fs.readFileSync(at(RENAMED), 'utf8') !== TEXT) {
		throw new Error('Command+Z in the editor of a note left its text changed');
	}

	// The note goes through the app, as a user deletes it.
	await card(RENAMED).click();
	await waitForCanvasCardSelection(page, RENAMED);
	await page.keyboard.press('Delete');
	await waitUntil(() => !fs.existsSync(at(RENAMED)), 'the note of the step to be deleted', 15_000);
}
