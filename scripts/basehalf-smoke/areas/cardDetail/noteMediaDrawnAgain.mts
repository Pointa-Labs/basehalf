/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A note's videos and sounds in Card Detail: Preview drawn again keeps its
// players (note rendering, rule 4b and criterion 13e), and Rich asks for no
// address of a note's picture, video, or sound that the window refuses (rule
// 6c and criterion 13f).

import fs from 'fs';
import path from 'path';
import { root, workspacePath } from '../../context.mts';
import { createSilentWav, createSolidPng } from '../../fixture.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { assertNoteMediaPlayedOn, readNoteMediaFrames, sampleNoteMediaEveryFrame, writeNoteAsAnAgent } from '../../lib/noteMediaFrames.mts';
import { quickOpen, visibleQuickInput } from '../../lib/quickInput.mts';
import { waitForReading } from '../../lib/steps.mts';

const PREVIEW = '.basehalf-card-detail.visible .basehalf-card-detail-markdown-preview-content';

/** Opens `name`, a note written just now, in Card Detail by Quick Open, once Quick Open has found it. */
async function openWrittenNote(page, name) {
	for (let attempt = 0; ; attempt++) {
		try {
			await quickOpen(page, name);
			await assertCardDetail(page, name);
			return;
		} catch (error) {
			if (attempt > 0) {
				throw error;
			}
			// A file written a moment ago may not be found yet.
			if (await visibleQuickInput(page).isVisible().catch(() => false)) {
				await page.keyboard.press('Escape');
			}
			await page.waitForTimeout(2_000);
		}
	}
}

async function showProjection(page, name) {
	await page.locator(`.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="${name}"]`).click();
}

// Criterion 13e in Preview: a video and a sound that play in Preview go on
// playing, on every frame, while their note is written from outside four
// times, as an agent writes it, though Preview draws the note again each time.
export async function assertPreviewNoteMediaPlaysOnWhenDrawnAgain(page) {
	const folder = path.join(workspacePath, 'preview-drawn-again');
	const file = path.join(folder, 'preview-media.md');
	fs.mkdirSync(folder, { recursive: true });
	fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-6s-mock.mp4'), path.join(folder, 'clip.mp4'));
	fs.writeFileSync(path.join(folder, 'tone.wav'), createSilentWav(30));
	fs.writeFileSync(file, ['# Media', '', 'Before the video.', '', '![clip](clip.mp4)', '', 'Between.', '', '<audio src="tone.wav" controls></audio>', '', 'The end.', ''].join('\n'), 'utf8');
	await openWrittenNote(page, 'preview-media.md');
	await showProjection(page, 'Preview');
	const readings = {};
	try {
		for (const [what, kind] of [['A video that plays in Preview', ':not(.sound)'], ['A sound that plays in Preview', '.sound']]) {
			const selector = `${PREVIEW} .basehalf-canvas-video-player.note${kind} video`;
			await waitForReading(() => page.evaluate(selector => document.querySelector(selector)?.readyState ?? 0, selector), ready => ready >= 2, `${what} to load`, 10_000);
			await page.locator(`${PREVIEW} .basehalf-canvas-video-player.note${kind} .basehalf-canvas-video-player-button.play`).first().click();
			await waitForReading(() => page.evaluate(selector => !document.querySelector(selector)?.paused, selector), playing => playing, `${what} to play`, 3_000);
			const stop = await sampleNoteMediaEveryFrame(page, selector);
			await writeNoteAsAnAgent(page, file);
			const reading = readNoteMediaFrames(await stop(), true);
			await page.evaluate(selector => document.querySelector(selector)?.pause(), selector);
			readings[kind] = reading;
			assertNoteMediaPlayedOn(what, reading, true);
		}
	} finally {
		console.error(`[basehalf-smoke] Preview media drawn again: ${JSON.stringify(readings)}`);
		await showProjection(page, 'Rich').catch(() => undefined);
		await closeCardDetailIfOpen(page);
		fs.rmSync(folder, { recursive: true, force: true });
		fs.rmSync(path.join(workspacePath, '.bh', 'mirror', 'preview-drawn-again'), { recursive: true, force: true });
	}
}

// Criterion 13f: a note with a picture, a video, and a sound at relative
// addresses, one picture in the store of the note's files, opened in Rich and
// its stored picture copied, asks the window for no address that it refuses.
// The copy goes to a clipboard of the event's own: the system's is left alone.
export async function assertNoteFormatsMediaAsksForNoRefusedAddress(page) {
	const folder = path.join(workspacePath, 'refused-media');
	const store = path.join(workspacePath, '.bh', 'attachments', 'r3fus3dme0');
	fs.mkdirSync(folder, { recursive: true });
	fs.mkdirSync(store, { recursive: true });
	fs.writeFileSync(path.join(folder, 'pic.png'), createSolidPng(64, 40, [80, 140, 200]));
	fs.writeFileSync(path.join(store, 'kept.png'), createSolidPng(64, 40, [200, 120, 80]));
	fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-6s-mock.mp4'), path.join(folder, 'clip.mp4'));
	fs.writeFileSync(path.join(folder, 'tone.wav'), createSilentWav(3));
	fs.writeFileSync(path.join(folder, 'refused-media.md'), ['# Media', '', '![pic](pic.png)', '', '![kept](../.bh/attachments/r3fus3dme0/kept.png)', '', '![clip](clip.mp4)', '', '<audio src="tone.wav" controls></audio>', '', 'The end.', ''].join('\n'), 'utf8');
	const refused = [];
	const onResponse = response => {
		if (response.status() >= 400 && response.url().startsWith('vscode-webview://')) {
			refused.push(`${response.status()} ${response.url().replace(/^vscode-webview:\/\/[^/]+/, '')}`);
		}
	};
	page.on('response', onResponse);
	let copied;
	try {
		await openWrittenNote(page, 'refused-media.md');
		const frame = await activeMarkdownRichFrame(page);
		await waitForReading(() => frame.evaluate(() => {
			const pictures = Array.from(document.querySelectorAll('.bn-block-content[data-content-type="image"] img'));
			const media = Array.from(document.querySelectorAll('video, audio'));
			return pictures.length === 2 && pictures.every(picture => picture.complete && picture.naturalWidth > 0) && media.length === 2 && media.every(element => element.readyState >= 1);
		}), shown => shown, 'Rich to show the note\'s two pictures, its video, and its sound', 15_000);
		copied = await frame.evaluate(() => {
			const picture = Array.from(document.querySelectorAll('.bn-block-content[data-content-type="image"]')).find(content => (content.getAttribute('data-url') ?? '').includes('kept.png'));
			const image = picture?.querySelector('img');
			if (!image) {
				return undefined;
			}
			const box = image.getBoundingClientRect();
			for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
				image.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, button: 0 }));
			}
			const data = new DataTransfer();
			document.querySelector('.ProseMirror')?.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
			return data.getData('blocknote/html');
		});
		await page.waitForTimeout(1_000);
	} finally {
		page.off('response', onResponse);
		await closeCardDetailIfOpen(page);
		fs.rmSync(folder, { recursive: true, force: true });
		fs.rmSync(store, { recursive: true, force: true });
		fs.rmSync(path.join(workspacePath, '.bh', 'mirror', 'refused-media'), { recursive: true, force: true });
	}
	if (!copied?.includes('../.bh/attachments/r3fus3dme0/kept.png') || refused.length > 0) {
		throw new Error(`Opening a note with relative pictures, a video, and a sound in Rich, and copying its stored picture, should ask for no address the window refuses: ${JSON.stringify({ refused, copied: copied?.slice(0, 200) })}`);
	}
}
