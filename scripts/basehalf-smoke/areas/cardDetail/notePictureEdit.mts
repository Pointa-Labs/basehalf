/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A picture edited where its note shows it (D113; formats of a note, criteria 31 to 34, 37, and 38): Edit draws the card's editor over the
// note's picture with nothing flashing, a corner of the crop frame follows the pointer on every frame, Done glides the editor to
// the edited file as the note shows it, and the whole edit is one step of the note's undo. A cropped picture edited again
// shows its whole original, and a picture taller than the view keeps the tools in it. Every frame is recorded on both sides
// of the page's frame, in one clock.

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { startFramesClock } from '../../lib/framesClock.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { patternPng } from './imageEdit.mts';

const FOLDER = 'notepicture';
const NOTE = `${FOLDER}/trip.md`;
const PICTURE = `${FOLDER}/photo.png`;
const INFORMATION = `.bh/mirror/${PICTURE}`;
const NOTE_TEXT = ['# Trip', '', 'The text above the picture.', '', '![photo](photo.png)', '', 'The text under the picture, which moves down to make room for the tools.', '', 'More text.', ''].join('\n');
const TALL_NOTE = `${FOLDER}/tall.md`;
const TALL_PICTURE = `${FOLDER}/tall.png`;
const TALL_NOTE_TEXT = ['# Tower', '', 'The text above the picture.', '', '![tower](tall.png)', '', 'The text under the picture.', ''].join('\n');
const STAGE = '.basehalf-note-media-stage';
// Criteria 31, 33, 37, and 38 ask for 50 ms, 300 ms, and 400 ms on an idle machine; a loaded one is slower, and the smoke allows that and logs the times.
const EDIT_SHOWN_LIMIT_MS = 250;
const DONE_GONE_LIMIT_MS = 600;
const COME_TO_VIEW_LIMIT_MS = 800;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

/** The width and the height a PNG file says it has. */
function pngSize(relativePath) {
	const bytes = fs.readFileSync(workspaceFile(relativePath));
	return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

function information() {
	const folder = workspaceFile(INFORMATION);
	return fs.existsSync(folder) ? fs.readdirSync(folder).sort().join(' ') : '';
}

async function noteFrame(page, url = 'photo.png') {
	let found;
	for (let attempt = 0; attempt < 200 && !found; attempt++) {
		for (const frame of page.frames()) {
			if (await frame.locator(`.basehalf-markdown-rich.ready .bn-block-content[data-url="${url}"] img.bn-visual-media`).count().catch(() => 0)) {
				found = frame;
			}
		}
		if (!found) {
			await page.waitForTimeout(100);
		}
	}
	if (!found) {
		throw new Error('Rich did not show the note with its picture');
	}
	await found.waitForFunction(() => { const img = document.querySelector('img.bn-visual-media'); return !!img && img.complete && img.naturalWidth > 0; }, undefined, { timeout: 15_000 });
	return found;
}

// Each frame is stamped when it is read, not with the time its frame began: a press handled in a frame before its callbacks
// ran would otherwise seem to come after what that frame shows.

/** Records every frame of the window: the editor, its picture, its frame, its top left corner, the frame of the page, and the pointer. */
async function startWindowFrames(page) {
	await startFramesClock(page);
	await page.evaluate(selector => {
		const state = { running: true, frames: [], pointer: { x: NaN, y: NaN } };
		globalThis.__bhNotePictureFrames = state;
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
			const picture = stage?.querySelector('.basehalf-image-crop-picture');
			state.frames.push({
				t: globalThis.__bhFramesNow(),
				stage: !!stage,
				shown: !!stage && getComputedStyle(stage).visibility !== 'hidden' && !!picture && picture.complete && picture.naturalWidth > 0,
				editing: !!stage?.querySelector('.basehalf-image-crop:not(.viewing)'),
				kept: box(stage?.querySelector('.basehalf-image-crop-frame')),
				whole: box(picture),
				view: box(stage?.querySelector('.basehalf-image-crop-view')),
				corner: box(stage?.querySelector('.basehalf-image-crop-corner.topLeft')),
				line: box(stage?.querySelector('.basehalf-media-edit-line')),
				layer: box(layer),
				iframe: box(iframe),
				pointer: { ...state.pointer }
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, STAGE);
}

/** Records every frame of the page: its picture's box, whether it is drawn, and the top of the text under it. */
async function startPageFrames(frame, url = 'photo.png') {
	await startFramesClock(frame);
	await frame.evaluate(url => {
		const state = { running: true, frames: [], clicks: [] };
		globalThis.__bhNotePictureFrames = state;
		document.addEventListener('click', event => {
			if (event.target.closest?.('button')?.textContent?.trim() === 'Edit') {
				state.clicks.push(globalThis.__bhFramesNow());
			}
		}, true);
		const tick = () => {
			if (!state.running) {
				return;
			}
			const img = document.querySelector(`.bn-block-content[data-url="${url}"] img.bn-visual-media`);
			const r = img?.getBoundingClientRect();
			state.frames.push({
				t: globalThis.__bhFramesNow(),
				img: r && { l: r.left, t: r.top, w: r.width, h: r.height },
				shown: !!img && getComputedStyle(img).visibility !== 'hidden' && img.complete && img.naturalWidth > 0,
				natural: img ? `${img.naturalWidth}x${img.naturalHeight}` : undefined,
				under: img?.closest('.bn-block-outer')?.nextElementSibling?.getBoundingClientRect().top
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, url);
}

const windowFrames = page => page.evaluate(() => globalThis.__bhNotePictureFrames);
const pageFrames = frame => frame.evaluate(() => globalThis.__bhNotePictureFrames);

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

/** The distance of the editor's part kept from the note's picture, on the screen. */
function offset(kept, iframe, img) {
	return Math.max(Math.abs(kept.l - (img.l + iframe.l)), Math.abs(kept.t - (img.t + iframe.t)), Math.abs(kept.w - img.w), Math.abs(kept.h - img.h));
}

/** On every frame of the window from `from` to `to`, the editor's picture or the note's is drawn. */
function assertAPictureOnEveryFrame(windowRecord, pageRecord, from, to, what) {
	const bare = windowRecord.frames.filter(frame => frame.t >= from && frame.t <= to && !frame.shown && !pageAt(pageRecord.frames, frame.t)?.shown);
	if (bare.length > 0) {
		throw new Error(`${what}: ${bare.length} frames showed neither the editor's picture nor the note's, the first ${(bare[0].t - from).toFixed(1)} ms in`);
	}
}

/**
 * Selects the picture near its top, so that its toolbar above it stays in the view under Card Detail's header, presses Edit
 * in the toolbar, and waits for its editor to show: the time of the press.
 */
async function pressEdit(page, frame, url) {
	const clicks = (await pageFrames(frame)).clicks.length;
	await frame.locator(`.bn-block-content[data-url="${url}"] img.bn-visual-media`).click({ position: { x: 100, y: 30 } });
	const edit = frame.locator('.bn-formatting-toolbar button', { hasText: 'Edit' });
	await edit.waitFor({ state: 'visible', timeout: 5_000 });
	await page.waitForTimeout(300);
	await edit.click();
	await page.locator(`${STAGE}:not(.drawing) .basehalf-image-crop:not(.viewing)`).waitFor({ state: 'visible', timeout: 5_000 });
	const pressed = (await pageFrames(frame)).clicks[clicks];
	if (!pressed) {
		throw new Error('Edit in the picture\'s toolbar was not pressed');
	}
	return pressed;
}

/** Waits until a frame of the window meets `test`, at most `limit` ms after `from`: that frame. */
async function frameWithin(page, from, limit, test, what) {
	const deadline = Date.now() + limit + 2_000;
	while (Date.now() < deadline) {
		const found = (await windowFrames(page)).frames.find(entry => entry.t >= from && test(entry));
		if (found) {
			if (found.t - from > limit) {
				throw new Error(`${what} ${(found.t - from).toFixed(1)} ms after the press; the smoke allows ${limit} ms`);
			}
			return found;
		}
		await page.waitForTimeout(50);
	}
	throw new Error(`${what}: not within ${limit} ms`);
}

/** The editor's picture stands within 1 px of the note's on the first frame it shows after the press. */
async function assertEditorOnTheNotesPicture(page, frame, pressed) {
	const windowRecord = await windowFrames(page);
	const pageRecord = await pageFrames(frame);
	const firstShown = windowRecord.frames.find(entry => entry.t >= pressed && entry.shown && entry.editing);
	if (!firstShown || firstShown.t - pressed > EDIT_SHOWN_LIMIT_MS) {
		throw new Error(`the editor showed ${firstShown ? (firstShown.t - pressed).toFixed(1) : '?'} ms after Edit; the smoke allows ${EDIT_SHOWN_LIMIT_MS} ms`);
	}
	const entryOffset = offset(firstShown.kept, firstShown.iframe, pageAt(pageRecord.frames, firstShown.t).img);
	if (entryOffset > 1) {
		throw new Error(`the editor's picture stood ${entryOffset.toFixed(2)} px from the note's when it showed`);
	}
	return { firstShown, entryOffset };
}

/** Drags the crop frame's top left corner, held where it is grabbed, so that the frame's corner goes to `to`, over `steps` frames. */
async function dragTopLeftTo(page, to, steps) {
	const corner = await page.locator(`${STAGE} .basehalf-image-crop-corner.topLeft`).boundingBox();
	const kept = await page.locator(`${STAGE} .basehalf-image-crop-frame`).boundingBox();
	const start = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
	const end = { x: to.x + start.x - kept.x, y: to.y + start.y - kept.y };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(start.x + (end.x - start.x) * i / steps, start.y + (end.y - start.y) * i / steps);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
	}
	await page.mouse.up();
}

export async function assertNotePictureEditInPlace(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	fs.writeFileSync(workspaceFile(PICTURE), patternPng(1600, 1000));
	fs.writeFileSync(workspaceFile(NOTE), NOTE_TEXT, 'utf8');
	// The whole path: Quick Open opens a file just written by its path, before its search knows it.
	await quickOpen(page, NOTE);
	await assertCardDetail(page, 'trip.md');
	const frame = await noteFrame(page);
	await page.waitForTimeout(500);
	await startWindowFrames(page);
	await startPageFrames(frame);

	// Criterion 31: Edit in the picture's toolbar.
	await frame.locator('.bn-block-content[data-url="photo.png"] img.bn-visual-media').click();
	const edit = frame.locator('.bn-formatting-toolbar button', { hasText: 'Edit' });
	await edit.waitFor({ state: 'visible', timeout: 5_000 });
	await page.waitForTimeout(300);
	await edit.click();
	await page.locator(`${STAGE}:not(.drawing) .basehalf-image-crop:not(.viewing)`).waitFor({ state: 'visible', timeout: 5_000 });
	await page.waitForTimeout(300);
	let windowRecord = await windowFrames(page);
	let pageRecord = await pageFrames(frame);
	const pressed = pageRecord.clicks[0];
	const firstShown = windowRecord.frames.find(entry => entry.t >= pressed && entry.shown && entry.editing);
	if (!pressed || !firstShown) {
		throw new Error('the editor did not show after Edit');
	}
	if (firstShown.t - pressed > EDIT_SHOWN_LIMIT_MS) {
		throw new Error(`the editor showed ${(firstShown.t - pressed).toFixed(1)} ms after Edit; the smoke allows ${EDIT_SHOWN_LIMIT_MS} ms (criterion 31: 50 ms on an idle machine)`);
	}
	const before = pageRecord.frames.filter(entry => entry.t < pressed).at(-1);
	const after = pageRecord.frames.find(entry => entry.t >= pressed);
	if (!before || !after || Math.abs(after.under - before.under - 108) > 0.5) {
		throw new Error(`the text under the picture moved ${after && before ? (after.under - before.under).toFixed(1) : '?'} px in the frame of the press; 108 px expected`);
	}
	const entryOffset = offset(firstShown.kept, firstShown.iframe, pageAt(pageRecord.frames, firstShown.t).img);
	if (entryOffset > 1) {
		const near = entry => entry.t >= pressed - 20 && entry.t <= firstShown.t + 60;
		const describe = entry => `${(entry.t - pressed).toFixed(1)}ms ${JSON.stringify({ ...entry, t: undefined, pointer: undefined, corner: undefined })}`;
		throw new Error(`the editor's picture stood ${entryOffset.toFixed(2)} px from the note's when it showed.\nwindow:\n${windowRecord.frames.filter(near).map(describe).join('\n')}\npage:\n${pageRecord.frames.filter(near).map(describe).join('\n')}`);
	}
	assertAPictureOnEveryFrame(windowRecord, pageRecord, pressed, firstShown.t, 'Edit');

	// Criterion 32: the top left corner, dragged to the right over 40 frames, stays under the pointer.
	const corner = await page.locator(`${STAGE} .basehalf-image-crop-corner.topLeft`).boundingBox();
	const start = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
	const dragFrom = (await windowFrames(page)).frames.length;
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	for (let i = 1; i <= 40; i++) {
		await page.mouse.move(start.x + 7 * i, start.y);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
	}
	const dragTo = (await windowFrames(page)).frames.length;
	await page.mouse.up();
	windowRecord = await windowFrames(page);
	const dragged = windowRecord.frames.slice(dragFrom, dragTo).filter(entry => entry.corner && Number.isFinite(entry.pointer.x));
	const grab = dragged[0] && { x: dragged[0].corner.l + dragged[0].corner.w / 2 - dragged[0].pointer.x, y: dragged[0].corner.t + dragged[0].corner.h / 2 - dragged[0].pointer.y };
	const drift = Math.max(...dragged.map(entry => Math.hypot(entry.corner.l + entry.corner.w / 2 - entry.pointer.x - grab.x, entry.corner.t + entry.corner.h / 2 - entry.pointer.y - grab.y)));
	if (dragged.length < 40 || !(drift <= 1)) {
		throw new Error(`the corner drifted ${drift.toFixed(2)} px from the pointer over ${dragged.length} frames`);
	}
	// The frame rests a second before it glides to rest.
	await page.waitForTimeout(1_800);

	// No words say what the edit is: the line under the tools holds Revert to Original and nothing else (D120).
	await page.waitForFunction(stage => !!document.querySelector(`${stage} .basehalf-media-edit-line-saving`)?.parentElement?.hidden, STAGE, { timeout: 15_000 });
	const lineParts = await page.evaluate(stage => Array.from(document.querySelectorAll(`${stage} .basehalf-media-edit-line-part:not([hidden])`)).map(part => part.textContent), STAGE);
	if (JSON.stringify(lineParts) !== '["Revert to Original"]') {
		throw new Error(`The line under the tools of a picture edited in its note holds Revert to Original and nothing else: ${JSON.stringify(lineParts)}`);
	}

	// Criterion 33: Done.
	const done = await page.evaluate(() => globalThis.__bhFramesNow());
	await page.locator('.basehalf-note-media-done').click();
	await page.locator(STAGE).waitFor({ state: 'detached', timeout: 5_000 });
	await page.waitForTimeout(300);
	windowRecord = await windowFrames(page);
	pageRecord = await pageFrames(frame);
	const gone = windowRecord.frames.find(entry => entry.t >= done && !entry.stage);
	if (!gone || gone.t - done > DONE_GONE_LIMIT_MS) {
		throw new Error(`the editor went ${gone ? (gone.t - done).toFixed(1) : '?'} ms after Done; the smoke allows ${DONE_GONE_LIMIT_MS} ms (criterion 33: 300 ms on an idle machine)`);
	}
	assertAPictureOnEveryFrame(windowRecord, pageRecord, done, gone.t + 100, 'Done');
	const last = windowRecord.frames.filter(entry => entry.t < gone.t && entry.stage).at(-1);
	const endOffset = offset(last.kept, last.iframe, pageAt(pageRecord.frames, last.t).img);
	const shown = pageRecord.frames.at(-1);
	const edited = pngSize(PICTURE);
	if (endOffset > 1 || shown.natural !== edited || Math.abs(shown.img.w - before.img.w) > 0.5 || !edited.endsWith('x1000') || edited === '1600x1000') {
		throw new Error(`after Done the editor stood ${endOffset.toFixed(2)} px from the note's picture, which shows ${shown.natural} at ${shown.img.w.toFixed(1)} px (before ${before.img.w.toFixed(1)} px); the file is ${edited}`);
	}
	if (fs.readFileSync(workspaceFile(NOTE), 'utf8') !== NOTE_TEXT || information() !== 'edit.yaml original.png') {
		throw new Error(`the edit changed the note's file, or the picture's card information holds ${JSON.stringify(information())}`);
	}

	// Criterion 34: one step of the note's undo.
	await page.keyboard.press('Meta+Z');
	await waitUntil(() => pngSize(PICTURE) === '1600x1000' && !information().includes('edit.yaml'), 'Command+Z in the note puts the picture back as the original', 10_000);
	await frame.waitForFunction(() => document.querySelector('.bn-block-content[data-url="photo.png"] img.bn-visual-media')?.naturalWidth === 1600, undefined, { timeout: 5_000 });
	await page.keyboard.press('Meta+Shift+Z');
	await waitUntil(() => pngSize(PICTURE) === edited && information() === 'edit.yaml original.png', 'Shift+Command+Z in the note puts the crop back', 10_000);
	await frame.waitForFunction(width => document.querySelector('.bn-block-content[data-url="photo.png"] img.bn-visual-media')?.naturalWidth === width, Number(edited.split('x')[0]), { timeout: 5_000 });
	if (fs.readFileSync(workspaceFile(NOTE), 'utf8') !== NOTE_TEXT) {
		throw new Error('the undo of the picture changed the note\'s file');
	}

	// Criterion 37: Edit again glides out to the whole original of the cropped picture, and one drag takes it back.
	await page.waitForTimeout(400);
	const [keptWidth, keptHeight] = edited.split('x').map(Number);
	const againPressed = await pressEdit(page, frame, 'photo.png');
	const near = (box, width, height) => !!box && Math.abs(box.w - width) <= 1 && Math.abs(box.h - height) <= 1;
	// The whole original fits the box the editor draws the picture in: its view less the frame's margin, the picture's box in a view tall enough.
	const fits = entry => {
		const fit = entry.view && Math.min((entry.view.w - 48) / 1600, (entry.view.h - 48) / 1000);
		return entry.shown && !!fit && near(entry.whole, 1600 * fit, 1000 * fit) && near(entry.kept, keptWidth * fit, keptHeight * fit);
	};
	const again = await assertEditorOnTheNotesPicture(page, frame, againPressed);
	const whole = await frameWithin(page, againPressed, COME_TO_VIEW_LIMIT_MS, fits, 'the whole original fit the picture\'s box');
	assertAPictureOnEveryFrame(await windowFrames(page), await pageFrames(frame), againPressed, whole.t, 'Edit again');
	await dragTopLeftTo(page, { x: whole.whole.l - 3, y: whole.whole.t - 3 }, 30);
	await page.waitForTimeout(1_600);
	await page.locator('.basehalf-note-media-done').click();
	await page.locator(STAGE).waitFor({ state: 'detached', timeout: 5_000 });
	await waitUntil(() => pngSize(PICTURE) === '1600x1000', 'one drag of the frame\'s corner onto the original\'s takes the whole original back', 10_000);

	await page.evaluate(() => { globalThis.__bhNotePictureFrames.running = false; });
	await frame.evaluate(() => { globalThis.__bhNotePictureFrames.running = false; });
	await closeCardDetailIfOpen(page);
	console.error(`[basehalf-smoke] note picture edit: ${JSON.stringify({
		editShownMs: +(firstShown.t - pressed).toFixed(1),
		entryOffsetPx: +entryOffset.toFixed(2),
		dragFrames: dragged.length,
		dragDriftPx: +drift.toFixed(2),
		doneGoneMs: +(gone.t - done).toFixed(1),
		endOffsetPx: +endOffset.toFixed(2),
		edited,
		againOffsetPx: +again.entryOffset.toFixed(2),
		wholeMs: +(whole.t - againPressed).toFixed(1)
	})}`);
}

export async function assertNotePictureEditTallInView(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	// Shown as wide as the note's column, a picture three times as tall as wide is taller than any view with the tools under it.
	fs.writeFileSync(workspaceFile(TALL_PICTURE), patternPng(1000, 3000));
	fs.writeFileSync(workspaceFile(TALL_NOTE), TALL_NOTE_TEXT, 'utf8');
	await quickOpen(page, TALL_NOTE);
	await assertCardDetail(page, 'tall.md');
	const frame = await noteFrame(page, 'tall.png');
	await page.waitForTimeout(500);
	await startWindowFrames(page);
	await startPageFrames(frame, 'tall.png');

	// Criterion 38.
	const pressed = await pressEdit(page, frame, 'tall.png');
	const noteBox = pageAt((await pageFrames(frame)).frames, pressed).img;
	const { entryOffset } = await assertEditorOnTheNotesPicture(page, frame, pressed);
	const inView = entry => entry.shown && !!entry.line && !!entry.layer && entry.line.t + entry.line.h <= entry.layer.t + entry.layer.h + 0.5 && entry.whole.h < noteBox.h - 1;
	const fitted = await frameWithin(page, pressed, COME_TO_VIEW_LIMIT_MS, inView, 'the tools came into the view');
	// It rests where it glided: the frames after hold it.
	await page.waitForTimeout(300);
	const rested = (await windowFrames(page)).frames.at(-1);
	const across = Math.abs(rested.whole.l + rested.whole.w / 2 - (noteBox.l + rested.iframe.l + noteBox.w / 2));
	if (!inView(rested) || across > 1 || rested.whole.t < rested.layer.t) {
		throw new Error(`the tall picture's editor rests ${JSON.stringify({ whole: rested.whole, line: rested.line, layer: rested.layer })}, ${across.toFixed(2)} px from the picture's middle across`);
	}
	assertAPictureOnEveryFrame(await windowFrames(page), await pageFrames(frame), pressed, fitted.t, 'Edit of a tall picture');

	// Done after no change glides it back to the note's picture.
	const done = await page.evaluate(() => globalThis.__bhFramesNow());
	await page.locator('.basehalf-note-media-done').click();
	await page.locator(STAGE).waitFor({ state: 'detached', timeout: 5_000 });
	await page.waitForTimeout(300);
	const windowRecord = await windowFrames(page);
	const pageRecord = await pageFrames(frame);
	const gone = windowRecord.frames.find(entry => entry.t >= done && !entry.stage);
	assertAPictureOnEveryFrame(windowRecord, pageRecord, done, gone.t + 100, 'Done of a tall picture');
	const last = windowRecord.frames.filter(entry => entry.t < gone.t && entry.stage).at(-1);
	const endOffset = offset(last.kept, last.iframe, pageAt(pageRecord.frames, last.t).img);
	if (endOffset > 1 || fs.readFileSync(workspaceFile(TALL_NOTE), 'utf8') !== TALL_NOTE_TEXT || pngSize(TALL_PICTURE) !== '1000x3000') {
		throw new Error(`after Done the tall picture's editor stood ${endOffset.toFixed(2)} px from the note's picture, or a file changed`);
	}
	await page.evaluate(() => { globalThis.__bhNotePictureFrames.running = false; });
	await frame.evaluate(() => { globalThis.__bhNotePictureFrames.running = false; });
	await closeCardDetailIfOpen(page);
	console.error(`[basehalf-smoke] note picture edit, tall: ${JSON.stringify({
		entryOffsetPx: +entryOffset.toFixed(2),
		inViewMs: +(fitted.t - pressed).toFixed(1),
		lineBottom: +(rested.line.t + rested.line.h).toFixed(1),
		viewBottom: +(rested.layer.t + rested.layer.h).toFixed(1),
		acrossPx: +across.toFixed(2),
		endOffsetPx: +endOffset.toFixed(2)
	})}`);
}
