/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail's edit mode of a video (editing media): Edit, the frame viewer, Done, Save as New, and Revert.

import fs from 'fs';
import path from 'path';
import { root, workspacePath } from '../../context.mts';
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { showExplorer } from '../../lib/workspace.mts';

const FOLDER = 'edit';
const VIDEO = `${FOLDER}/shot.mp4`;
const DETAIL = '.basehalf-card-detail.visible';
const FRAMES = '.basehalf-card-detail-surface.active .basehalf-video-frames';
const NOTE = '.basehalf-card-detail-surface.active .basehalf-media-edit-note';
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO = process.platform === 'darwin' ? 'Shift+Meta+Z' : 'Control+Shift+Z';

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

function headerButton(page, name) {
	return page.locator(`${DETAIL} .basehalf-card-detail-edit-actions [data-edit-action="${name}"]`);
}

/** The part kept, in seconds, from the strip's properties; the length of the video the viewer shows. */
async function readPart(page) {
	return page.evaluate(selector => {
		const viewer = document.querySelector(selector);
		const strip = viewer?.querySelector('.basehalf-video-frames-strip');
		const duration = Number(viewer?.querySelector('.basehalf-video-frames-handle.end')?.getAttribute('aria-valuemax'));
		const at = name => parseFloat(strip.style.getPropertyValue(name)) / 100 * duration;
		return { start: at('--basehalf-video-frames-start'), end: at('--basehalf-video-frames-end'), duration, whole: viewer.classList.contains('whole') };
	}, FRAMES);
}

/** Edit, and the frame viewer of a video of about this length once its pictures show. */
async function enterEdit(page, duration) {
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-disabled') === 'false', `${DETAIL} .basehalf-card-detail-edit-actions [data-edit-action="edit"]`, { timeout: 15_000 });
	await headerButton(page, 'edit').click();
	await page.waitForFunction(({ selector, duration }) => {
		const viewer = document.querySelector(selector);
		const length = Number(viewer?.querySelector('.basehalf-video-frames-handle.end')?.getAttribute('aria-valuemax'));
		return !!viewer && viewer.querySelectorAll('.basehalf-video-frames-picture').length > 0
			&& (duration === undefined || Math.abs(length - duration) < 0.05);
	}, { selector: FRAMES, duration }, { timeout: 15_000 });
}

/** Waits until Card Detail shows the file out of edit mode, with this line under it. */
async function waitForNote(page, pattern) {
	await page.waitForFunction(({ selector, source }) => new RegExp(source).test(document.querySelector(selector)?.textContent ?? ''), { selector: NOTE, source: pattern.source }, { timeout: 30_000 });
}

/** Drags a handle to a time, holding the place where it was pressed. */
async function dragHandle(page, which, seconds) {
	const strip = await page.locator(`${FRAMES} .basehalf-video-frames-strip`).boundingBox();
	const handle = await page.locator(`${FRAMES} .basehalf-video-frames-handle.${which}`).boundingBox();
	const { duration } = await readPart(page);
	const fromX = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	const edgeX = which === 'start' ? handle.x + handle.width : handle.x;
	const toX = strip.x + strip.width * seconds / duration + (fromX - edgeX);
	await page.mouse.move(fromX, y);
	await page.mouse.down();
	for (let index = 1; index <= 10; index++) {
		await page.mouse.move(fromX + (toX - fromX) * index / 10, y);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();
}

/** Shows the video's row in Files, its folder open there, so that the row can be watched. */
async function showVideoRowInFiles(page) {
	if (!(await page.locator('.explorer-viewlet').isVisible().catch(() => false))) {
		await showExplorer(page);
	}
	const videoRow = page.locator('.explorer-viewlet .monaco-list-row', { hasText: 'shot.mp4' }).first();
	if (!(await videoRow.isVisible().catch(() => false))) {
		const folderRow = page.locator('.explorer-viewlet .monaco-list-row', { hasText: FOLDER }).first();
		await folderRow.waitFor({ state: 'visible', timeout: 15_000 });
		if ((await folderRow.getAttribute('aria-expanded')) !== 'true') {
			await folderRow.locator('.monaco-tl-twistie').click();
		}
	}
	await videoRow.waitFor({ state: 'visible', timeout: 15_000 });
	await videoRow.scrollIntoViewIfNeeded();
}

export async function assertCardDetailVideoEdit(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-mock.mp4'), workspaceFile(VIDEO));
	const original = fs.readFileSync(workspaceFile(VIDEO));
	const cardInformation = workspaceFile(`.bh/mirror/${VIDEO}`);
	try {
		await showVideoRowInFiles(page);
		await quickOpen(page, VIDEO);
		await assertCardDetail(page, 'shot.mp4');
		await enterEdit(page, undefined);
		const first = await readPart(page);
		const atFirst = { done: await headerButton(page, 'done').getAttribute('aria-disabled'), revert: await headerButton(page, 'revert').count(), whole: first.whole };
		if (atFirst.done !== 'true' || atFirst.revert !== 0 || !atFirst.whole) {
			throw new Error(`Edit on a video that was never edited keeps all of it, without Revert, and Done waits for an edit: ${JSON.stringify(atFirst)}`);
		}

		await dragHandle(page, 'start', 0.5);
		await dragHandle(page, 'end', 1.7);
		const part = await readPart(page);
		if (part.end - part.start < 0.999 || part.start < 0.3 || part.end > 1.9) {
			throw new Error(`The handles must keep about 0.5 s to 1.7 s, at least 1.0 s: ${JSON.stringify(part)}`);
		}
		// Command+Z in edit mode undoes the editor's last change, and no step of the canvas.
		await page.locator(`${FRAMES} .basehalf-video-frames-handle.end`).focus();
		await page.keyboard.press(UNDO);
		const undone = await readPart(page);
		await page.keyboard.press(REDO);
		const redone = await readPart(page);
		if (Math.abs(undone.end - first.duration) > 0.05 || Math.abs(undone.start - part.start) > 0.01 || Math.abs(redone.end - part.end) > 0.01 || !fs.readFileSync(workspaceFile(VIDEO)).equals(original)) {
			throw new Error(`Undo in edit mode puts the end handle back, and redo moves it again: ${JSON.stringify({ part, undone, redone })}`);
		}

		// Exact undo, criterion 16: from Done to its undo and redo, the video's row in Files is there in every frame.
		await page.evaluate(() => {
			const watch = { running: true, frames: 0, missing: 0 };
			const tick = () => {
				if (!watch.running) {
					return;
				}
				watch.frames++;
				if (!Array.from(document.querySelectorAll('.explorer-viewlet .monaco-list-row')).some(row => row.textContent?.includes('shot.mp4'))) {
					watch.missing++;
				}
				requestAnimationFrame(tick);
			};
			globalThis.basehalfEditRowWatch = watch;
			requestAnimationFrame(tick);
		});

		// Done writes the part into the file, keeps the file as it was as the original, and the record beside it.
		await headerButton(page, 'done').click();
		await waitForNote(page, /^Edited\./);
		const edited = fs.readFileSync(workspaceFile(VIDEO));
		const record = fs.readFileSync(path.join(cardInformation, 'edit.yaml'), 'utf8');
		if (edited.equals(original) || !fs.readFileSync(path.join(cardInformation, 'original.mp4')).equals(original) || !/^original: "original\.mp4"\nresult:\n {2}size: \d+\n {2}hash: "[0-9a-f]{64}"\nkeep:\n/.test(record)) {
			throw new Error(`Done replaces the video, keeps its original, and writes the record: ${JSON.stringify({ same: edited.equals(original), record })}`);
		}
		const files = fs.readdirSync(workspaceFile(FOLDER));
		const leftInCache = fs.existsSync(workspaceFile('.bh/cache/edit')) ? fs.readdirSync(workspaceFile('.bh/cache/edit')) : [];
		if (files.length !== 1 || leftInCache.length) {
			throw new Error(`Done makes no other file beside the video and leaves nothing in the cache: ${JSON.stringify({ files, leftInCache })}`);
		}

		// Edit again starts from the whole original, with the handles where the edit left them.
		await enterEdit(page, first.duration);
		const again = await readPart(page);
		if (Math.abs(again.start - part.start) > 0.02 || Math.abs(again.end - part.end) > 0.02 || (await headerButton(page, 'revert').count()) !== 1) {
			throw new Error(`Edit on an edited video shows its original with the part it kept, and Revert: ${JSON.stringify({ part, again })}`);
		}

		// Save as New writes the part into a copy beside the video, and leaves the video as it was.
		await dragHandle(page, 'start', 0.2);
		await headerButton(page, 'more').click();
		const saveAsNew = page.locator('.context-view.monaco-menu-container .action-label').filter({ hasText: /^Save as New Video$/ }).filter({ visible: true }).last();
		await saveAsNew.waitFor({ state: 'visible', timeout: 10_000 });
		// VS Code attaches menu mouse-up listeners after a 100 ms guard against the pointer event that opened the menu.
		await page.waitForTimeout(150);
		await saveAsNew.click();
		await waitForNote(page, /^Saved shot copy\.mp4\./);
		const copy = workspaceFile(`${FOLDER}/shot copy.mp4`);
		if (!fs.existsSync(copy) || fs.readFileSync(copy).equals(edited) || !fs.readFileSync(workspaceFile(VIDEO)).equals(edited) || fs.existsSync(workspaceFile(`.bh/mirror/${FOLDER}/shot copy.mp4/edit.yaml`))) {
			throw new Error('Save as New writes the edit into shot copy.mp4, an ordinary file, and leaves the video as it was.');
		}
		// Its undo takes the copy away; the video stays edited.
		await headerButton(page, 'edit').focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => !fs.existsSync(copy), 'undo to take the new file away', 15_000);

		// Revert puts the original back, and removes it and the record.
		await enterEdit(page, first.duration);
		await headerButton(page, 'revert').click();
		await waitForNote(page, /^The original is back\./);
		if (!fs.readFileSync(workspaceFile(VIDEO)).equals(original) || fs.existsSync(path.join(cardInformation, 'original.mp4')) || fs.existsSync(path.join(cardInformation, 'edit.yaml'))) {
			throw new Error('Revert puts back the original\'s bytes and removes the original and the record.');
		}

		// Out of edit mode, undo and redo are steps of the canvas: undo of the Revert brings the edit back exactly, redo reverts again.
		await headerButton(page, 'edit').focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => fs.readFileSync(workspaceFile(VIDEO)).equals(edited) && fs.existsSync(path.join(cardInformation, 'original.mp4')) && fs.readFileSync(path.join(cardInformation, 'edit.yaml'), 'utf8') === record, 'undo to bring the edit back', 15_000);
		await headerButton(page, 'edit').focus();
		await page.keyboard.press(REDO);
		await waitUntil(() => fs.readFileSync(workspaceFile(VIDEO)).equals(original) && !fs.existsSync(path.join(cardInformation, 'edit.yaml')), 'redo to revert again', 15_000);
		const rowWatch = await page.evaluate(() => {
			const watch = globalThis.basehalfEditRowWatch;
			watch.running = false;
			return { frames: watch.frames, missing: watch.missing };
		});
		if (rowWatch.frames < 10 || rowWatch.missing !== 0) {
			throw new Error(`Done, Revert, and their undo and redo change the video in place: its row in Files must be there in every frame: ${JSON.stringify(rowWatch)}`);
		}

		// Escape in edit mode cancels and leaves Card Detail open; the next Escape closes it.
		await enterEdit(page, first.duration);
		await page.locator(`${FRAMES} .basehalf-video-frames-handle.start`).focus();
		await page.keyboard.press('Escape');
		await page.locator(FRAMES).waitFor({ state: 'detached', timeout: 10_000 });
		if (!(await page.locator(DETAIL).isVisible())) {
			throw new Error('Escape in edit mode cancels the edit and leaves Card Detail open.');
		}
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
