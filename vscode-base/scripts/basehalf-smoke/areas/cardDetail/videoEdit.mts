/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail's editor of a video (editing media): viewing first, Edit, a trim saved with nothing pressed, its undo and redo, Revert to Original,
// Escape back to viewing, and viewing that shows the file as the trim made it and plays it once (D96).

import fs from 'fs';
import path from 'path';
import { root, workspacePath } from '../../context.mts';
import { waitForViewTransitions } from '../../app.mts';
import { assertCardDetail, cardDetailModeLabel, enterEditing } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { showExplorer } from '../../lib/workspace.mts';
import { readVideoControlsShape } from '../video/generationProbes.mts';

const FOLDER = 'edit';
const VIDEO = `${FOLDER}/shot.mp4`;
const DETAIL = '.basehalf-card-detail.visible';
const SURFACE = '.basehalf-card-detail-surface.active';
const FRAMES = `${SURFACE} .basehalf-video-frames`;
const LINE = `${SURFACE} .basehalf-media-edit-line`;
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO = process.platform === 'darwin' ? 'Shift+Meta+Z' : 'Control+Shift+Z';
/** Changes of one name within 0.6 s are one step: the changes of this test are apart. */
const APART_MS = 700;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
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

/** The frame viewer of a video of about this length, once its pictures show. */
async function waitForViewer(page, duration) {
	await page.waitForFunction(({ selector, duration }) => {
		const viewer = document.querySelector(selector);
		const length = Number(viewer?.querySelector('.basehalf-video-frames-handle.end')?.getAttribute('aria-valuemax'));
		return !!viewer && viewer.querySelectorAll('.basehalf-video-frames-picture').length > 0
			&& (duration === undefined || Math.abs(length - duration) < 0.05);
	}, { selector: FRAMES, duration }, { timeout: 15_000 });
}

/** The parts of the line under the editor that show, without the dots between them. */
async function lineText(page) {
	return page.evaluate(selector => Array.from(document.querySelector(selector)?.querySelectorAll('.basehalf-media-edit-line-part:not([hidden])') ?? []).map(part => part.textContent).join(' | '), LINE);
}

/** Drags a handle to a time, holding the place where it was pressed; with `escape`, Escape before the release. */
async function dragHandle(page, which, seconds, escape = false) {
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
	if (escape) {
		await page.keyboard.press('Escape');
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
	const copies = workspaceFile('.bh/cache/edit/shown');
	const read = file => fs.existsSync(file) ? fs.readFileSync(file) : undefined;
	try {
		await showVideoRowInFiles(page);
		await quickOpen(page, VIDEO);
		await assertCardDetail(page, 'shot.mp4');

		// Card Detail opens to view the video: the viewer is its timeline, with no handle, and the header holds Edit.
		await waitForViewer(page, undefined);
		const first = await readPart(page);
		const atOpen = await page.evaluate(({ detail, surface }) => ({
			header: Array.from(document.querySelectorAll(`${detail} .basehalf-card-detail-header button`)).filter(button => button.offsetParent).map(button => button.getAttribute('aria-label') ?? button.textContent),
			slider: getComputedStyle(document.querySelector(`${surface} .basehalf-canvas-video-player-slider`)).display,
			sound: !!document.querySelector(`${surface} .basehalf-video-frames-sound`),
			viewing: !!document.querySelector(`${surface} .basehalf-video-frames.viewing`),
			handles: Array.from(document.querySelectorAll(`${surface} .basehalf-video-frames-handle`)).map(handle => getComputedStyle(handle).visibility)
		}), { detail: DETAIL, surface: SURFACE });
		if (!first.whole || await cardDetailModeLabel(page) !== 'Edit' || atOpen.header.some(label => /Done|Cancel|Revert|Save/.test(label ?? '')) || atOpen.slider !== 'none' || atOpen.sound
			|| !atOpen.viewing || atOpen.handles.some(visibility => visibility !== 'hidden') || await lineText(page) !== '') {
			throw new Error(`Card Detail of a video that was never edited opens to view it: its frame viewer is its timeline, with no handle, Edit in the header and no other control of editing, the player without a bar of its own, and an empty line: ${JSON.stringify({ first, atOpen, line: await lineText(page) })}`);
		}
		// Generation cards, criteria 40 and 99 (D98): the controls float on their own backing, 8 px inside the picture, as wide as
		// what they hold over a frame viewer; they show while the video is paused, and while it plays they fade once the pointer rests.
		const shape = await readVideoControlsShape(page, undefined);
		if (!shape || shape.background !== 'none' || Math.abs(shape.bottom - 8) > 1 || Math.abs(shape.height - 30) > 1 || shape.left < 8 || shape.width > 240) {
			throw new Error(`Card Detail's controls must float on their own backing, 8 px inside the picture, as wide as Play, the time, and Full Screen: ${JSON.stringify(shape)}`);
		}
		const player = `${SURFACE} .basehalf-canvas-video-player.detail`;
		const controls = () => page.evaluate(selector => document.querySelector(selector)?.dataset.controls ?? null, player);
		const playerBox = await page.locator(player).boundingBox();
		const over = { x: playerBox.x + playerBox.width / 2, y: playerBox.y + playerBox.height * 0.4 };
		await page.mouse.move(over.x, over.y, { steps: 2 });
		const fade = { paused: await controls() };
		// The clip lasts two seconds: played at half speed, it still plays when its controls fade.
		await page.evaluate(selector => { document.querySelector(`${selector} video`).playbackRate = 0.5; }, player);
		await page.mouse.click(over.x, over.y);
		fade.playing = await controls();
		await page.waitForTimeout(3100);
		fade.rested = await controls();
		await page.mouse.move(over.x + 24, over.y + 12, { steps: 2 });
		fade.moved = await controls();
		await page.mouse.click(over.x + 24, over.y + 12);
		await page.waitForTimeout(300);
		fade.pausedAgain = await controls();
		await page.evaluate(selector => {
			const video = document.querySelector(`${selector} video`);
			video.playbackRate = 1;
			video.currentTime = 0;
		}, player);
		if (JSON.stringify(fade) !== JSON.stringify({ paused: 'shown', playing: 'shown', rested: 'faded', moved: 'shown', pausedAgain: 'shown' })) {
			throw new Error(`Card Detail's controls show while the video is paused, and while it plays fade once the pointer rests and come back with a move: ${JSON.stringify(fade)}`);
		}
		// Edit shows the handles; the picture stays where it is, and so does the header around Edit.
		const layout = () => page.evaluate(({ detail, surface }) => {
			const box = selector => {
				const rect = document.querySelector(selector)?.getBoundingClientRect();
				return rect ? [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 10) / 10) : undefined;
			};
			return {
				picture: box(`${surface} .basehalf-canvas-video-player.detail`), header: box(`${detail} .basehalf-card-detail-header`),
				mode: box(`${detail} .basehalf-card-detail-mode-button`), stage: box(`${surface} .basehalf-card-detail-video-stage`), line: box(`${surface} .basehalf-media-edit-line`),
				detail: box(detail)
			};
		}, { detail: DETAIL, surface: SURFACE });
		await waitForViewTransitions(page);
		const atRest = await layout();
		await enterEditing(page);
		const editingLayout = await layout();
		if (JSON.stringify(atRest) !== JSON.stringify(editingLayout) || await page.locator(`${FRAMES}.viewing`).count()) {
			throw new Error(`Edit shows the editor in place: ${JSON.stringify({ atRest, editingLayout })}`);
		}

		// Exact undo, criterion 16: from the first write to the last undo and redo, the video's row in Files is there in every frame.
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

		// Letting go of the handles is the change: with nothing pressed, the file becomes the part, its original and record beside it.
		await dragHandle(page, 'start', 0.5);
		await page.waitForTimeout(APART_MS);
		await dragHandle(page, 'end', 1.7);
		const part = await readPart(page);
		if (part.end - part.start < 0.999 || part.start < 0.3 || part.end > 1.9) {
			throw new Error(`The handles must keep about 0.5 s to 1.7 s, at least 1.0 s: ${JSON.stringify(part)}`);
		}
		await waitUntil(() => !!read(path.join(cardInformation, 'original.mp4'))?.equals(original) && /\n {2}- start: 0\.[3-7]\d*\n {4}end: 1\.[5-9]\d*\n$/.test(read(path.join(cardInformation, 'edit.yaml'))?.toString() ?? ''), 'the trim to be written with nothing pressed', 30_000);
		const edited = fs.readFileSync(workspaceFile(VIDEO));
		const record = fs.readFileSync(path.join(cardInformation, 'edit.yaml'), 'utf8');
		// The line says "Saving…" only while the file is written.
		await page.waitForFunction(selector => !!document.querySelector(`${selector} .basehalf-media-edit-line-saving`)?.parentElement?.hidden, LINE, { timeout: 15_000 });
		const line = await lineText(page);
		if (edited.equals(original) || !/^original: "original\.mp4"\nresult:\n {2}size: \d+\n {2}hash: "[0-9a-f]{64}"\nkeep:\n/.test(record) || !/^Trimmed to \d\.\ds–\d\.\ds \| Revert to Original$/.test(line) || fs.readdirSync(workspaceFile(FOLDER)).length !== 1) {
			throw new Error(`The trim replaces the video, keeps its original, writes the record, and the line says it: ${JSON.stringify({ same: edited.equals(original), record, line })}`);
		}

		// Command+Z with the keyboard on a handle undoes the last trim in the viewer at once, and the file follows; redo puts back the very bytes.
		await page.locator(`${FRAMES} .basehalf-video-frames-handle.end`).focus();
		await page.keyboard.press(UNDO);
		await page.waitForFunction(({ selector, duration }) => {
			const handle = document.querySelector(`${selector} .basehalf-video-frames-handle.end`);
			return Math.abs(Number(handle?.getAttribute('aria-valuenow')) - duration) < 0.05;
		}, { selector: FRAMES, duration: first.duration }, { timeout: 5_000 });
		await waitUntil(() => !/\n {4}end: 1\.[5-9]\d*\n$/.test(read(path.join(cardInformation, 'edit.yaml'))?.toString() ?? '') && !!read(path.join(cardInformation, 'edit.yaml')), 'the undo of the end to be written', 30_000);
		await page.keyboard.press(REDO);
		await waitUntil(() => !!read(workspaceFile(VIDEO))?.equals(edited) && read(path.join(cardInformation, 'edit.yaml'))?.toString() === record, 'redo to put back the very bytes of the trim', 30_000);
		const focused = await page.evaluate(selector => !!document.activeElement?.matches(`${selector} .basehalf-video-frames-handle.end`), FRAMES);
		if (!focused) {
			throw new Error('Undo and redo keep the editor, and the keyboard on the handle it was on.');
		}

		// Revert to Original puts the original back, and removes it and the record; its undo brings the edit back byte for byte.
		await page.locator(`${LINE} .basehalf-media-edit-line-action.revert`).click();
		await waitUntil(() => !!read(workspaceFile(VIDEO))?.equals(original) && !fs.existsSync(path.join(cardInformation, 'original.mp4')) && !fs.existsSync(path.join(cardInformation, 'edit.yaml')), 'Revert to Original to put the original back', 30_000);
		if (!(await readPart(page)).whole || await lineText(page) !== '') {
			throw new Error(`After Revert to Original the viewer keeps all of the video, and the line is empty: ${await lineText(page)}`);
		}
		await page.locator(`${FRAMES} .basehalf-video-frames-handle.start`).focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => !!read(workspaceFile(VIDEO))?.equals(edited) && !!read(path.join(cardInformation, 'original.mp4'))?.equals(original) && read(path.join(cardInformation, 'edit.yaml'))?.toString() === record, 'the undo of Revert to Original to bring the edit back', 30_000);
		const rowWatch = await page.evaluate(() => {
			const watch = globalThis.basehalfEditRowWatch;
			watch.running = false;
			return { frames: watch.frames, missing: watch.missing };
		});
		if (rowWatch.frames < 10 || rowWatch.missing !== 0) {
			throw new Error(`Writes, Revert to Original, and their undo and redo change the video in place: its row in Files must be there in every frame: ${JSON.stringify(rowWatch)}`);
		}

		// Escape during a drag puts back what the drag changed and leaves the editor open; the next Escape goes back to viewing, and the one after closes Card Detail.
		const beforeDrag = await readPart(page);
		await dragHandle(page, 'start', 0.1, true);
		const afterEscape = await readPart(page);
		if (Math.abs(afterEscape.start - beforeDrag.start) > 0.01 || !(await page.locator(DETAIL).isVisible()) || await cardDetailModeLabel(page) !== 'Done') {
			throw new Error(`Escape during a drag puts the handle back and leaves the editor open: ${JSON.stringify({ beforeDrag, afterEscape })}`);
		}
		await page.keyboard.press('Escape');
		await page.waitForFunction(selector => !!document.querySelector(`${selector}.viewing`), FRAMES, { timeout: 5_000 });
		if (!(await page.locator(DETAIL).isVisible()) || await cardDetailModeLabel(page) !== 'Edit') {
			throw new Error('Escape while editing goes back to viewing and leaves Card Detail open.');
		}
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
		await waitUntil(() => !fs.existsSync(copies) || fs.readdirSync(copies).length === 0, 'the copy that the editor read to go when Card Detail closed', 10_000);

		// Card Detail opened again views the file as the trim made it: the viewer shows the part, the player counts from its start, and Play plays it once.
		await quickOpen(page, VIDEO);
		await assertCardDetail(page, 'shot.mp4');
		await waitForViewer(page, first.duration);
		const viewed = await page.evaluate(selector => {
			const strip = document.querySelector(`${selector} .basehalf-video-frames-strip`);
			return { from: Number(strip.dataset.from), to: Number(strip.dataset.to), length: document.querySelector('.basehalf-card-detail-surface.active .basehalf-canvas-video-player-time.length')?.textContent };
		}, FRAMES);
		const partLength = part.end - part.start;
		if (Math.abs(viewed.from - part.start) > 0.02 || Math.abs(viewed.to - part.end) > 0.02 || !/^\d\.\ds$/.test(viewed.length ?? '') || Math.abs(parseFloat(viewed.length) - partLength) > 0.11 || await lineText(page) !== '') {
			throw new Error(`Viewing an edited video shows the part it kept, its length on the player, and an empty line: ${JSON.stringify({ part, viewed, line: await lineText(page) })}`);
		}
		await page.locator(`${SURFACE} .basehalf-canvas-video-player-bar .basehalf-canvas-video-player-button[aria-label="Play"]`).click();
		await page.waitForFunction(selector => !document.querySelector(`${selector} video`)?.paused, `${SURFACE} .basehalf-canvas-video-player.detail`, { timeout: 5_000 });
		await page.waitForFunction(selector => document.querySelector(`${selector} video`)?.paused, `${SURFACE} .basehalf-canvas-video-player.detail`, { timeout: 10_000 });
		const stoppedAt = await page.evaluate(selector => document.querySelector(`${selector} video`).currentTime, `${SURFACE} .basehalf-canvas-video-player.detail`);
		if (stoppedAt > part.end + 0.01 || stoppedAt < part.end - 0.2) {
			throw new Error(`While viewing, Play plays the part once and stops on its last frame: ${JSON.stringify({ stoppedAt, part })}`);
		}
		// Editing media, criteria 31 and 32 (D100): the keyboard is the player's. A press of Play with the pointer leaves it
		// there, and a key pressed there lights up no control. Home and End go to the ends of the part that the file keeps,
		// and Right and Left a second on and back, within it. The clip's frames last about 0.07 s.
		const playhead = () => page.evaluate(selector => {
			const video = document.querySelector(`${selector} video`);
			const active = document.activeElement;
			const style = active ? getComputedStyle(active) : undefined;
			return {
				at: Math.round(video.currentTime * 1000) / 1000,
				paused: video.paused,
				keyboard: active === document.querySelector(selector) ? 'player' : String(active?.className ?? ''),
				ring: !!style && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
			};
		}, player);
		// Playing starts at once, and a pause comes once the sound has gone down over 60 ms: each press waits for it.
		const until = paused => page.waitForFunction(({ selector, paused }) => document.querySelector(`${selector} video`)?.paused === paused, { selector: player, paused }, { timeout: 5_000 }).catch(() => undefined);
		await page.locator(player).focus();
		const playButton = page.locator(`${SURFACE} .basehalf-canvas-video-player-button.play`);
		await playButton.click();
		await until(false);
		await playButton.click();
		await until(true);
		const keys = { pressedPlay: await playhead() };
		for (const [name, key] of [['home', 'Home'], ['right', 'ArrowRight'], ['rightAgain', 'ArrowRight'], ['end', 'End'], ['left', 'ArrowLeft']]) {
			await page.keyboard.press(key);
			keys[name] = await playhead();
		}
		const lit = Object.entries(keys).filter(([, value]) => value.keyboard !== 'player' || value.ring).map(([name]) => name);
		if (lit.length || Math.abs(keys.home.at - part.start) > 0.02 || Math.abs(keys.right.at - part.start - 1) > 0.1 || keys.rightAgain.at > part.end
			|| keys.rightAgain.at < part.end - 0.15 || keys.end.at !== keys.rightAgain.at || Math.abs(keys.left.at - (keys.end.at - 1)) > 0.1) {
			throw new Error(`While viewing, the keyboard stays on the player through a press of Play, with no ring, and Left, Right, Home, and End move the playhead within the part kept: ${JSON.stringify({ part, lit, keys })}`);
		}
		// Edit shows the whole original in the viewer, with the handles where the trim left them.
		await enterEditing(page);
		const again = await readPart(page);
		if (Math.abs(again.start - part.start) > 0.02 || Math.abs(again.end - part.end) > 0.02 || !/ \| Revert to Original$/.test(await lineText(page))) {
			throw new Error(`Edit on an edited video shows its original with the part it kept, and Revert to Original: ${JSON.stringify({ part, again, line: await lineText(page) })}`);
		}
		// While editing, the keyboard is still the player's: End goes to the original's last frame, Shift+Right one frame on,
		// paused, and Space plays and pauses while the editing stays. Tab takes the keyboard to a control, which then shows its
		// ring; with the keyboard nowhere, Right still moves the playhead a second.
		const editing = {};
		for (const [name, key] of [['end', 'End'], ['home', 'Home'], ['frame', 'Shift+ArrowRight'], ['spacePlays', 'Space'], ['spacePauses', 'Space']]) {
			await page.keyboard.press(key);
			if (name === 'spacePlays') {
				await until(false);
				await page.waitForTimeout(300);
			} else if (name === 'spacePauses') {
				await until(true);
			}
			editing[name] = { ...await playhead(), mode: await cardDetailModeLabel(page) };
		}
		await page.keyboard.press('Tab');
		editing.tab = await playhead();
		await page.evaluate(() => document.activeElement?.blur());
		await page.keyboard.press('ArrowRight');
		editing.nowhere = await playhead();
		const frame = editing.frame.at - editing.home.at;
		const editingLit = ['end', 'home', 'frame', 'spacePlays', 'spacePauses'].filter(name => editing[name].keyboard !== 'player' || editing[name].ring || editing[name].mode !== 'Done');
		if (editingLit.length || editing.end.at < part.end + 0.2 || editing.home.at > 0.01 || frame < 0.02 || frame > 0.15 || !editing.frame.paused
			|| editing.spacePlays.paused || !editing.spacePauses.paused || editing.tab.keyboard === 'player' || !editing.tab.ring
			|| Math.abs(editing.nowhere.at - editing.spacePauses.at - 1) > 0.1) {
			throw new Error(`While editing, after a click on Edit, the keyboard stays on the player: End, Home, Shift+Right, and Space work there with no ring and the editing stays; Tab shows a ring on a control; Right works with the keyboard nowhere: ${JSON.stringify({ part, editingLit, editing })}`);
		}
		// The first Escape goes back to viewing, the second closes Card Detail.
		await page.keyboard.press('Escape');
		await page.waitForFunction(selector => !!document.querySelector(`${selector}.viewing`), FRAMES, { timeout: 5_000 });
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
