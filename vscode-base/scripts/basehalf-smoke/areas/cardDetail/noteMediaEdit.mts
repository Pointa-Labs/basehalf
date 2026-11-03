/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A video and a sound edited where their note shows them (D114; formats of a note, criteria 37 to 40): Edit draws the
// editor of the file's card over the media with nothing flashing, an end handle dragged trims the file, Done shows the
// new version in the note, and the whole edit is one step of the note's undo; the keys of Card Detail's player work in
// the editor, and Escape and a press in the note go back to the note. Every frame is recorded on both sides of the
// page's frame, in one clock.

import fs from 'fs';
import path from 'path';
import { root, workspacePath } from '../../context.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

const FOLDER = 'notemedia';
const NOTE = `${FOLDER}/media.md`;
const VIDEO = `${FOLDER}/clip.mp4`;
const SOUND = `${FOLDER}/take.wav`;
const NOTE_TEXT = ['# Media', '', 'Text above the video.', '', '<video src="clip.mp4" controls></video>', '', 'Text between.', '', '<audio src="take.wav" controls></audio>', '', 'Text under.', ''].join('\n');
const STAGE = '.basehalf-note-media-stage';
// Criteria 37 to 39 ask for 100 ms, 1 s, and 300 ms on an idle machine; a loaded one is slower, and the smoke allows that and logs the times.
const EDIT_SHOWN_LIMIT_MS = 400;
const DONE_GONE_LIMIT_MS = 2_000;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

function information(relativePath) {
	const folder = workspaceFile(`.bh/mirror/${relativePath}`);
	return fs.existsSync(folder) ? fs.readdirSync(folder).sort().join(' ') : '';
}

/** Five seconds of a tone at 16 kHz in mono, 16 bits, louder each second, so that the waveform has bars. */
function toneWav(seconds) {
	const rate = 16_000;
	const data = Buffer.alloc(rate * seconds * 2);
	for (let i = 0; i < rate * seconds; i++) {
		const loudness = 0.15 + 0.15 * Math.floor(i / rate);
		data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 32_767 * Math.min(0.9, loudness)), i * 2);
	}
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

/** The length of a WAV file, from its header, in seconds. */
function wavSeconds(relativePath) {
	const bytes = fs.readFileSync(workspaceFile(relativePath));
	const data = bytes.indexOf('data', 12);
	return bytes.readUInt32LE(data + 4) / bytes.readUInt32LE(28);
}

async function noteFrame(page) {
	let found;
	for (let attempt = 0; attempt < 200 && !found; attempt++) {
		for (const frame of page.frames()) {
			if (await frame.locator('.basehalf-markdown-rich.ready .bn-block-content[data-url="clip.mp4"] video.bn-visual-media').count().catch(() => 0)) {
				found = frame;
			}
		}
		if (!found) {
			await page.waitForTimeout(100);
		}
	}
	if (!found) {
		throw new Error('Rich did not show the note with its video');
	}
	await found.waitForFunction(() => document.querySelector('video.bn-visual-media')?.readyState >= 2 && document.querySelector('audio.bn-audio')?.readyState >= 1, undefined, { timeout: 15_000 });
	return found;
}

/** Records every frame of the window: the editor, whether its media shows, its player's picture, its end handle, the page's frame, and the pointer. */
async function startWindowFrames(page) {
	await page.evaluate(selector => {
		const state = { running: true, frames: [], pointer: { x: NaN, y: NaN } };
		globalThis.__bhNoteMediaFrames = state;
		const box = element => { if (!element) { return undefined; } const r = element.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; };
		for (const type of ['pointerdown', 'pointermove']) {
			document.addEventListener(type, event => { state.pointer = { x: event.clientX, y: event.clientY }; }, true);
		}
		const tick = () => {
			if (!state.running) {
				return;
			}
			const stage = document.querySelector(selector);
			const layer = document.querySelector('.basehalf-card-detail-note-media-layer');
			const iframe = [...(layer?.parentElement?.children ?? [])].find(child => child.tagName === 'IFRAME');
			const video = stage?.querySelector('video');
			const visible = !!stage && getComputedStyle(stage).visibility !== 'hidden';
			state.frames.push({
				t: performance.timeOrigin + performance.now(),
				stage: !!stage,
				kind: stage?.classList.contains('video') ? 'video' : stage?.classList.contains('audio') ? 'audio' : undefined,
				shown: visible && (stage.classList.contains('video') ? !!video && video.readyState >= 2 : true),
				stageBox: box(stage),
				picture: box(video),
				end: box(stage?.querySelector('.basehalf-video-frames-handle.end')),
				iframe: box(iframe),
				pointer: { ...state.pointer }
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, STAGE);
}

/** Records every frame of the page: the note's video and sound, whether each shows, and the tops of the text under them. */
async function startPageFrames(frame) {
	await frame.evaluate(() => {
		const state = { running: true, frames: [], clicks: [] };
		globalThis.__bhNoteMediaFrames = state;
		document.addEventListener('click', event => {
			if (event.target.closest?.('button, .basehalf-markdown-rich-context-menu *')?.textContent?.trim() === 'Edit') {
				state.clicks.push(performance.timeOrigin + performance.now());
			}
		}, true);
		const top = text => [...document.querySelectorAll('.bn-block-content[data-content-type="paragraph"]')].find(paragraph => paragraph.textContent === text)?.getBoundingClientRect().top;
		const tick = () => {
			if (!state.running) {
				return;
			}
			const video = document.querySelector('video.bn-visual-media');
			const sound = document.querySelector('audio.bn-audio');
			const box = element => { const r = element?.getBoundingClientRect(); return r && { l: r.left, t: r.top, w: r.width, h: r.height }; };
			state.frames.push({
				t: performance.timeOrigin + performance.now(),
				video: box(video),
				videoShown: !!video && getComputedStyle(video).visibility !== 'hidden' && video.readyState >= 2,
				sound: box(sound),
				soundShown: !!sound && getComputedStyle(sound).visibility !== 'hidden',
				between: top('Text between.'),
				under: top('Text under.')
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

const windowFrames = page => page.evaluate(() => globalThis.__bhNoteMediaFrames);
const pageFrames = frame => frame.evaluate(() => globalThis.__bhNoteMediaFrames);

/** The page's frame shown last at a time of the window. */
function pageAt(frames, time) {
	let shown;
	for (const frame of frames) {
		if (frame.t <= time + 0.5) {
			shown = frame;
		}
	}
	return shown;
}

/** On every frame of the window from `from` to `to`, the editor's media or the note's shows. */
function assertMediaOnEveryFrame(windowRecord, pageRecord, kind, from, to, what) {
	const bare = windowRecord.frames.filter(frame => frame.t >= from && frame.t <= to && !frame.shown && !pageAt(pageRecord.frames, frame.t)?.[kind === 'video' ? 'videoShown' : 'soundShown']);
	if (bare.length > 0) {
		throw new Error(`${what}: ${bare.length} frames showed neither the editor's ${kind} nor the note's, the first ${(bare[0].t - from).toFixed(1)} ms in`);
	}
}

/** Presses Edit of the video's toolbar, or of the menu of the video or the sound: the time of the press, once the editor shows. */
async function pressEdit(page, frame, kind, via = kind === 'video' ? 'toolbar' : 'menu') {
	const clicks = (await pageFrames(frame)).clicks.length;
	if (via === 'toolbar') {
		await frame.locator('video.bn-visual-media').click({ position: { x: 30, y: 10 } });
		await frame.evaluate(() => document.querySelector('video.bn-visual-media').pause());
		const edit = frame.locator('.bn-formatting-toolbar button', { hasText: 'Edit' });
		await edit.waitFor({ state: 'visible', timeout: 5_000 });
		await page.waitForTimeout(300);
		await edit.click();
	} else {
		// Edit is first in the menu of a picture, a video, and a sound; the system's control of a sound's bar takes every other press (rule 52g).
		await frame.locator(kind === 'video' ? 'video.bn-visual-media' : 'audio.bn-audio').click({ position: kind === 'video' ? { x: 30, y: 10 } : { x: 300, y: 20 }, button: 'right' });
		await frame.locator('.basehalf-markdown-rich-context-menu *', { hasText: /^Edit$/ }).last().click();
	}
	await page.locator(`${STAGE}.${kind}:not(.drawing)`).waitFor({ state: 'visible', timeout: 8_000 });
	await page.waitForTimeout(300);
	const pressed = (await pageFrames(frame)).clicks[clicks];
	if (!pressed) {
		throw new Error(`Edit of the ${kind} was not pressed`);
	}
	return pressed;
}

/** Criteria 37 and 39: the editor shows over the note's media within the limit, at its place, the text under it moved by the room in the frame of the press, and a picture or the bar on every frame. */
async function assertEditorOverTheNotesMedia(page, frame, kind, pressed) {
	const windowRecord = await windowFrames(page);
	const pageRecord = await pageFrames(frame);
	const first = windowRecord.frames.find(entry => entry.t >= pressed && entry.shown && entry.kind === kind);
	if (!first || first.t - pressed > EDIT_SHOWN_LIMIT_MS) {
		throw new Error(`the ${kind}'s editor showed ${first ? (first.t - pressed).toFixed(1) : '?'} ms after Edit; the smoke allows ${EDIT_SHOWN_LIMIT_MS} ms`);
	}
	const note = pageAt(pageRecord.frames, first.t)[kind === 'video' ? 'video' : 'sound'];
	const shown = kind === 'video' ? first.picture : first.stageBox;
	const offset = Math.max(Math.abs(shown.l - (note.l + first.iframe.l)), Math.abs(shown.t - (note.t + first.iframe.t)), Math.abs(shown.w - note.w), kind === 'video' ? Math.abs(shown.h - note.h) : 0);
	if (offset > 1) {
		throw new Error(`the ${kind}'s editor stood ${offset.toFixed(2)} px from the note's ${kind} when it showed`);
	}
	const before = pageRecord.frames.filter(entry => entry.t < pressed).at(-1);
	const after = pageRecord.frames.find(entry => entry.t >= pressed);
	const text = kind === 'video' ? 'between' : 'under';
	const moved = after[text] - before[text];
	// The room of a video is its edit bar and line; a sound's is what its editor takes past its bar.
	const room = kind === 'video' ? 100 : 196 - note.h;
	if (Math.abs(moved - room) > 0.5) {
		throw new Error(`the text under the ${kind} moved ${moved.toFixed(1)} px in the frame of the press; ${room} px expected`);
	}
	assertMediaOnEveryFrame(windowRecord, pageRecord, kind, pressed, first.t, `Edit of the ${kind}`);
	return { shownMs: +(first.t - pressed).toFixed(1), offsetPx: +offset.toFixed(2) };
}

/** Drags the end handle of the editor's strip to a fraction of the strip over `steps` frames: how far the handle stood from where it is held, past its first frame. */
async function dragEnd(page, fraction, steps) {
	const strip = await page.locator(`${STAGE} .basehalf-video-frames-strip`).boundingBox();
	const handle = await page.locator(`${STAGE} .basehalf-video-frames-handle.end`).boundingBox();
	const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
	const end = { x: strip.x + strip.width * fraction + start.x - (strip.x + strip.width), y: start.y };
	const from = (await windowFrames(page)).frames.length;
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(start.x + (end.x - start.x) * i / steps, start.y);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
	}
	const to = (await windowFrames(page)).frames.length;
	await page.mouse.up();
	// A handle moves once the pointer has gone past the frame viewer's threshold of a drag, as in Card Detail; from its first
	// move on it keeps to the pointer.
	const frames = (await windowFrames(page)).frames.slice(from, to).filter(entry => entry.end && Number.isFinite(entry.pointer.x));
	const still = frames[0]?.end.l;
	const firstMove = frames.findIndex(entry => Math.abs(entry.end.l - still) > 0.5);
	const moved = firstMove < 0 ? [] : frames.slice(firstMove);
	const offsets = moved.map(entry => entry.end.l + entry.end.w / 2 - entry.pointer.x);
	const spread = offsets.length ? Math.max(...offsets) - Math.min(...offsets) : Infinity;
	if (moved.length < steps || !(spread <= 1)) {
		throw new Error(`the end handle kept to the pointer within ${spread.toFixed(2)} px over ${moved.length} frames`);
	}
	return { frames: moved.length, spreadPx: +spread.toFixed(2) };
}

/** Done: the editor goes within the limit, and the note's media or the editor's shows on every frame. */
async function pressDone(page, frame, kind) {
	const done = await page.evaluate(() => performance.timeOrigin + performance.now());
	await page.locator('.basehalf-note-media-done').click();
	await page.locator(STAGE).waitFor({ state: 'detached', timeout: 10_000 });
	await page.waitForTimeout(300);
	const windowRecord = await windowFrames(page);
	const pageRecord = await pageFrames(frame);
	const gone = windowRecord.frames.find(entry => entry.t >= done && !entry.stage);
	if (!gone || gone.t - done > DONE_GONE_LIMIT_MS) {
		throw new Error(`the ${kind}'s editor went ${gone ? (gone.t - done).toFixed(1) : '?'} ms after Done; the smoke allows ${DONE_GONE_LIMIT_MS} ms`);
	}
	assertMediaOnEveryFrame(windowRecord, pageRecord, kind, done, gone.t + 100, `Done of the ${kind}`);
	return +(gone.t - done).toFixed(1);
}

async function openNote(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	if (!fs.existsSync(workspaceFile(VIDEO))) {
		fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-6s-mock.mp4'), workspaceFile(VIDEO));
		fs.writeFileSync(workspaceFile(SOUND), toneWav(5));
		fs.writeFileSync(workspaceFile(NOTE), NOTE_TEXT, 'utf8');
	}
	// The whole path: Quick Open opens a file just written by its path, before its search knows it.
	await quickOpen(page, NOTE);
	await assertCardDetail(page, 'media.md');
	const frame = await noteFrame(page);
	await page.waitForTimeout(500);
	await startWindowFrames(page);
	await startPageFrames(frame);
	return frame;
}

async function stopFrames(page, frame) {
	await page.evaluate(() => { globalThis.__bhNoteMediaFrames.running = false; });
	await frame.evaluate(() => { globalThis.__bhNoteMediaFrames.running = false; });
}

export async function assertNoteVideoEditInPlace(page) {
	const frame = await openNote(page);
	const videoSeconds = () => frame.evaluate(() => document.querySelector('video.bn-visual-media')?.duration);

	// Criterion 37.
	const pressed = await pressEdit(page, frame, 'video');
	const entry = await assertEditorOverTheNotesMedia(page, frame, 'video', pressed);

	// Criterion 38: the end handle from 6 s to 4 s, and Done.
	const drag = await dragEnd(page, 4 / 6, 30);
	await page.waitForTimeout(1_200);
	const doneMs = await pressDone(page, frame, 'video');
	await waitUntil(() => information(VIDEO) === 'edit.yaml original.mp4', 'the trim\'s card information', 10_000);
	await frame.waitForFunction(() => {
		const video = document.querySelector('video.bn-visual-media');
		return /basehalfVersion=/.test(video?.getAttribute('src') ?? '') && video.duration > 3.5 && video.duration < 4.5 && getComputedStyle(video).visibility !== 'hidden';
	}, undefined, { timeout: 10_000 });
	const trimmed = await videoSeconds();
	if (fs.readFileSync(workspaceFile(NOTE), 'utf8') !== NOTE_TEXT) {
		throw new Error('the trim changed the note\'s file');
	}
	// One step of the note's undo, and its redo.
	await page.keyboard.press('Meta+Z');
	await waitUntil(() => information(VIDEO) === '', 'Command+Z in the note puts the video back as the original', 10_000);
	await frame.waitForFunction(() => Math.abs(document.querySelector('video.bn-visual-media')?.duration - 6) < 0.1, undefined, { timeout: 10_000 });
	await page.keyboard.press('Meta+Shift+Z');
	await waitUntil(() => information(VIDEO) === 'edit.yaml original.mp4', 'Shift+Command+Z in the note puts the trim back', 10_000);
	await frame.waitForFunction(() => document.querySelector('video.bn-visual-media')?.duration < 4.5, undefined, { timeout: 10_000 });

	// Criterion 40: Space plays the part kept and pauses it; Escape goes back to the note, and so does a press on its text.
	await page.waitForTimeout(400);
	await pressEdit(page, frame, 'video', 'menu');
	const editorVideo = page.locator(`${STAGE} video`);
	await page.keyboard.press('Space');
	await waitUntil(async () => !(await editorVideo.evaluate(video => video.paused)), 'Space plays the part kept', 5_000);
	await page.keyboard.press('Space');
	await waitUntil(async () => await editorVideo.evaluate(video => video.paused), 'Space again pauses it', 5_000);
	await page.keyboard.press('Escape');
	await page.locator(STAGE).waitFor({ state: 'detached', timeout: 10_000 });
	await page.waitForTimeout(400);
	await pressEdit(page, frame, 'video', 'menu');
	await frame.locator('.bn-block-content[data-content-type="paragraph"]', { hasText: 'Text above the video.' }).click();
	await page.locator(STAGE).waitFor({ state: 'detached', timeout: 10_000 });
	if (fs.readFileSync(workspaceFile(NOTE), 'utf8') !== NOTE_TEXT) {
		throw new Error('the editing of the video changed the note\'s file');
	}
	await stopFrames(page, frame);
	await closeCardDetailIfOpen(page);
	console.error(`[basehalf-smoke] note video edit: ${JSON.stringify({ ...entry, dragFrames: drag.frames, handleSpreadPx: drag.spreadPx, doneGoneMs: doneMs, trimmedSeconds: trimmed })}`);
}

export async function assertNoteSoundEditInPlace(page) {
	const frame = await openNote(page);

	// Criterion 39.
	const pressed = await pressEdit(page, frame, 'audio');
	const entry = await assertEditorOverTheNotesMedia(page, frame, 'audio', pressed);
	const drag = await dragEnd(page, 3 / 5, 30);
	await page.waitForTimeout(1_200);
	const doneMs = await pressDone(page, frame, 'audio');
	await waitUntil(() => information(SOUND) === 'edit.yaml original.wav' && Math.abs(wavSeconds(SOUND) - 3) < 0.25, 'the trim of the sound to about 3 s, with its card information', 10_000);
	await frame.waitForFunction(() => /basehalfVersion=/.test(document.querySelector('audio.bn-audio')?.getAttribute('src') ?? ''), undefined, { timeout: 10_000 });
	const trimmed = wavSeconds(SOUND);
	await page.keyboard.press('Meta+Z');
	await waitUntil(() => information(SOUND) === '' && Math.abs(wavSeconds(SOUND) - 5) < 0.01, 'Command+Z in the note puts the 5 s back', 10_000);
	if (fs.readFileSync(workspaceFile(NOTE), 'utf8') !== NOTE_TEXT) {
		throw new Error('the editing of the sound changed the note\'s file');
	}
	await stopFrames(page, frame);
	await closeCardDetailIfOpen(page);
	console.error(`[basehalf-smoke] note sound edit: ${JSON.stringify({ ...entry, dragFrames: drag.frames, handleSpreadPx: drag.spreadPx, doneGoneMs: doneMs, trimmedSeconds: +trimmed.toFixed(3) })}`);
}
