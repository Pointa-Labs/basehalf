/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The trim bar under the player of a video in Card Detail (trimming a video).

import fs from 'fs';
import path from 'path';
import { root, workspacePath } from '../../context.mts';
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { showExplorer } from '../../lib/workspace.mts';

const FOLDER = 'trim';
const VIDEO = `${FOLDER}/shot.mp4`;
const BAR = '.basehalf-card-detail-surface.active .basehalf-video-trim';
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO = process.platform === 'darwin' ? 'Shift+Meta+Z' : 'Control+Shift+Z';

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

/** The selection's start and end in seconds, from the strip's properties. */
async function readRange(page) {
	return page.evaluate(selector => {
		const bar = document.querySelector(selector);
		const strip = bar?.querySelector('.basehalf-video-trim-strip');
		const duration = Number(bar?.querySelector('.basehalf-video-trim-handle.end')?.getAttribute('aria-valuemax'));
		const at = name => parseFloat(strip.style.getPropertyValue(name)) / 100 * duration;
		return { start: at('--basehalf-video-trim-start'), end: at('--basehalf-video-trim-end'), duration };
	}, BAR);
}

/** Waits until the bar has read a video of about this length, with all of it selected. */
async function waitForWholeBar(page, duration) {
	await page.waitForFunction(({ selector, duration }) => {
		const bar = document.querySelector(selector);
		const length = Number(bar?.querySelector('.basehalf-video-trim-handle.end')?.getAttribute('aria-valuemax'));
		return !!bar && !bar.classList.contains('loading') && bar.classList.contains('whole')
			&& bar.querySelectorAll('.basehalf-video-trim-picture').length > 0
			&& (duration === undefined || Math.abs(length - duration) < 0.05);
	}, { selector: BAR, duration }, { timeout: 15_000 });
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

/** Drags a handle to a time, holding the place where it was pressed. */
async function dragHandle(page, which, seconds) {
	const strip = await page.locator(`${BAR} .basehalf-video-trim-strip`).boundingBox();
	const handle = await page.locator(`${BAR} .basehalf-video-trim-handle.${which}`).boundingBox();
	const { duration } = await readRange(page);
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

export async function assertCardDetailVideoTrim(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-mock.mp4'), workspaceFile(VIDEO));
	const original = fs.readFileSync(workspaceFile(VIDEO));
	try {
		await showVideoRowInFiles(page);
		await quickOpen(page, VIDEO);
		await assertCardDetail(page, 'shot.mp4');
		await waitForWholeBar(page, undefined);
		const before = await page.evaluate(selector => {
			const bar = document.querySelector(selector);
			return { trim: bar.querySelector('.basehalf-video-trim-confirm').getAttribute('aria-disabled'), length: bar.querySelector('.basehalf-video-trim-length').textContent };
		}, BAR);
		if (before.trim !== 'true' || !/s$/.test(before.length ?? '')) {
			throw new Error(`With the whole video selected, Trim is disabled and the bar shows the video's length: ${JSON.stringify(before)}`);
		}

		await dragHandle(page, 'start', 0.5);
		await dragHandle(page, 'end', 1.7);
		const range = await readRange(page);
		if (range.end - range.start < 0.999 || range.start < 0.3 || range.end > 1.9) {
			throw new Error(`The handles must select about 0.5 s to 1.7 s, at least 1.0 s: ${JSON.stringify(range)}`);
		}

		// The selection plays over and over, and no frame after its end is shown.
		const shown = await page.evaluate(async () => {
			const video = document.querySelector('.basehalf-card-detail-surface.active .basehalf-canvas-video-player.detail video');
			const play = document.querySelector('.basehalf-card-detail-surface.active .basehalf-canvas-video-player.detail .basehalf-canvas-video-player-button.play');
			const times = [];
			let running = true;
			const watch = () => {
				if (running) {
					video.requestVideoFrameCallback((_now, metadata) => {
						times.push(metadata.mediaTime);
						watch();
					});
				}
			};
			watch();
			play.click();
			await new Promise(resolve => setTimeout(resolve, 3000));
			running = false;
			play.click();
			return times;
		});
		const outside = shown.filter(time => time < range.start - 0.002 || time >= range.end - 0.002);
		const jumpedBack = shown.some((time, index) => index > 0 && time < shown[index - 1]);
		if (outside.length || !jumpedBack || shown.length < 10) {
			throw new Error(`The selection must play over and over with no frame outside it: ${JSON.stringify({ range, outside, jumpedBack, count: shown.length })}`);
		}

		// Exact undo, criterion 16: from the trim to its redo, the video's row in Files is there in every frame.
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
			globalThis.basehalfTrimRowWatch = watch;
			requestAnimationFrame(tick);
		});

		// Trim replaces the video, under its name, with the selection.
		await page.locator(`${BAR} .basehalf-video-trim-confirm`).click();
		await page.waitForFunction(selector => /^Trimmed to /.test(document.querySelector(`${selector} .basehalf-video-trim-status`)?.textContent ?? ''), BAR, { timeout: 30_000 });
		const trimmedLength = range.end - range.start;
		await waitForWholeBar(page, trimmedLength);
		const trimmed = fs.readFileSync(workspaceFile(VIDEO));
		if (trimmed.equals(original)) {
			throw new Error('Trim must replace the video with its selection.');
		}
		const files = fs.readdirSync(workspaceFile(FOLDER));
		if (files.length !== 1 || files[0] !== 'shot.mp4') {
			throw new Error(`Trim makes no other file beside the video: ${JSON.stringify(files)}`);
		}
		const cache = path.join(workspacePath, '.bh', 'cache', 'trim');
		const leftInCache = fs.existsSync(cache) ? fs.readdirSync(cache) : [];
		if (leftInCache.length) {
			throw new Error(`No part of a trim is left in the cache: ${JSON.stringify(leftInCache)}`);
		}

		// Undo on the bar puts the video back as it was, and redo trims it again (exact undo).
		await page.locator(`${BAR} .basehalf-video-trim-handle.start`).focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => fs.readFileSync(workspaceFile(VIDEO)).equals(original), 'undo to put the video back as it was', 15_000);
		await waitForWholeBar(page, range.duration);
		await page.locator(`${BAR} .basehalf-video-trim-handle.start`).focus();
		await page.keyboard.press(REDO);
		await waitUntil(() => fs.readFileSync(workspaceFile(VIDEO)).equals(trimmed), 'redo to trim the video again', 15_000);
		await waitForWholeBar(page, trimmedLength);
		const rowWatch = await page.evaluate(() => {
			const watch = globalThis.basehalfTrimRowWatch;
			watch.running = false;
			return { frames: watch.frames, missing: watch.missing };
		});
		if (rowWatch.frames < 10 || rowWatch.missing !== 0) {
			throw new Error(`A trim, its undo, and its redo change the video in place: its row in Files must be there in every frame: ${JSON.stringify(rowWatch)}`);
		}

		// Escape on a handle closes Card Detail, as anywhere in it.
		await page.locator(`${BAR} .basehalf-video-trim-handle.start`).focus();
		await page.keyboard.press('Escape');
		await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
