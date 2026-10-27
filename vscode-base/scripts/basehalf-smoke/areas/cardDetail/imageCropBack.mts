/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A crop as a phone's photo editor has it (editing media, "The crop frame", D97), criteria 23 to 26: let go, the frame waits a
// second before it glides to rest; a corner held in the view's margin takes a crop back to the original in one drag, recorded on
// every frame; while editing, a pinch zooms the picture under the frame and a swipe moves it; and Edit from a zoomed view glides back.

import fs from 'fs';
import path from 'path';
import { waitForViewTransitions } from '../../app.mts';
import { workspacePath } from '../../context.mts';
import { assertCardDetail, enterEditing, leaveEditing } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { patternPng, waitForCrop } from './imageEdit.mts';

const FOLDER = 'cropback';
const IMAGE = `${FOLDER}/wide.png`;
const DETAIL = '.basehalf-card-detail.visible';
const SURFACE = '.basehalf-card-detail-surface.active';
const CROP = `${SURFACE} .basehalf-image-crop`;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

async function pinch(page, x, y, scaleFactor) {
	await waitForViewTransitions(page);
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send('Input.synthesizePinchGesture', { x, y, scaleFactor, relativeSpeed: 600, gestureSourceType: 'mouse' });
	} finally {
		await cdp.detach().catch(() => undefined);
	}
}

/** Records every frame of the screen: the picture's scale, where it is, and whether it is drawn, the frame's place in the view, and the pointer. */
async function startFrames(page) {
	await page.evaluate(selector => {
		const root = document.querySelector(selector);
		const picture = root.querySelector('.basehalf-image-crop-picture');
		const frame = root.querySelector('.basehalf-image-crop-frame');
		const view = root.querySelector('.basehalf-image-crop-view');
		const state = { running: true, frames: [], pointer: { x: NaN, y: NaN } };
		globalThis.__bhCropBackFrames = state;
		for (const type of ['pointerdown', 'pointermove']) {
			root.addEventListener(type, event => { state.pointer = { x: event.clientX, y: event.clientY }; }, true);
		}
		const tick = time => {
			if (!state.running) {
				return;
			}
			const values = (/matrix\(([^)]+)\)/.exec(picture.style.transform)?.[1] ?? '').split(',').map(Number);
			const left = parseFloat(frame.style.left);
			const top = parseFloat(frame.style.top);
			const width = parseFloat(frame.style.width);
			const height = parseFloat(frame.style.height);
			state.frames.push({
				time,
				scale: Math.hypot(values[0], values[1]),
				x: values[4], y: values[5],
				drawn: picture.complete && picture.naturalWidth > 0 && getComputedStyle(picture).visibility !== 'hidden',
				left, top, right: left + width, bottom: top + height,
				viewWidth: view.clientWidth, viewHeight: view.clientHeight,
				size: root.querySelector('.basehalf-image-crop-size')?.textContent,
				adjusting: root.classList.contains('adjusting'),
				pointer: { ...state.pointer }
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, CROP);
}

async function stopFrames(page) {
	return page.evaluate(() => {
		const state = globalThis.__bhCropBackFrames;
		state.running = false;
		return state.frames;
	});
}

async function box(page, selector) {
	return page.locator(`${CROP} ${selector}`).boundingBox();
}

async function frameBox(page) {
	return box(page, '.basehalf-image-crop-frame');
}

async function sizeText(page) {
	return (await page.locator(`${CROP} .basehalf-image-crop-size`).textContent()) ?? '';
}

export async function assertCardDetailImageCropBack(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	const original = patternPng(2400, 1600);
	fs.writeFileSync(workspaceFile(IMAGE), original);
	const cardInformation = workspaceFile(`.bh/mirror/${IMAGE}`);
	const recordText = () => fs.existsSync(path.join(cardInformation, 'edit.yaml')) ? fs.readFileSync(path.join(cardInformation, 'edit.yaml'), 'utf8') : '';
	const isOriginal = () => fs.readFileSync(workspaceFile(IMAGE)).equals(original) && !fs.existsSync(path.join(cardInformation, 'edit.yaml')) && !fs.existsSync(path.join(cardInformation, 'original.png'));
	try {
		await quickOpen(page, IMAGE);
		await assertCardDetail(page, 'wide.png');
		await waitForCrop(page);
		await enterEditing(page);
		const view = await box(page, '.basehalf-image-crop-view');
		await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
		await page.waitForTimeout(250);

		// While editing, the rest of the original shows dimmed around the part kept (criterion 24).
		const dimmed = await page.evaluate(selector => getComputedStyle(document.querySelector(`${selector} .basehalf-image-crop-frame`)).boxShadow, CROP);
		if (!/rgba\(0, 0, 0, 0\.6/.test(dimmed)) {
			throw new Error(`While editing, the rest of the original shows dimmed around the part kept: ${dimmed}`);
		}

		// Criterion 24: a corner dragged in and let go stays where it was for a second, then glides to rest.
		const whole = await frameBox(page);
		const corner = await box(page, '.basehalf-image-crop-corner.topLeft');
		const grab = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
		await page.mouse.move(grab.x, grab.y);
		await page.mouse.down();
		await page.mouse.move(grab.x + 2, grab.y + 2);
		await page.mouse.move(grab.x + whole.width * 0.45, grab.y + whole.height * 0.45, { steps: 12 });
		await startFrames(page);
		await page.mouse.up();
		await page.waitForTimeout(1_700);
		const letGo = await stopFrames(page);
		const first = letGo[0];
		const moved = letGo.findIndex(frame => Math.abs(frame.left - first.left) > 1 || Math.abs(frame.right - first.right) > 1);
		const last = letGo[letGo.length - 1];
		const stillMs = moved > 0 ? letGo[moved].time - first.time : 0;
		const restedAt = letGo.findIndex((frame, index) => index >= moved && letGo.slice(index).every(other => Math.abs(other.scale - last.scale) < 1e-6 && Math.abs(other.left - last.left) < 0.01));
		if (moved < 0 || stillMs < 900 || restedAt < 0 || letGo[restedAt].time - letGo[moved].time > 300 || letGo.some(frame => !frame.drawn)) {
			throw new Error(`Let go, the frame waits a second where it was, then glides to rest within 300 ms, the picture drawn in every frame: ${JSON.stringify({ moved, stillMs, restedAt, frames: letGo.length })}`);
		}
		await waitUntil(() => /\ncrop:\n/.test(recordText()), 'the crop to be written', 30_000);

		// Criterion 23: the same corner held in the view's margin takes the crop back to the original in one drag.
		const cropped = await frameBox(page);
		const corner2 = await box(page, '.basehalf-image-crop-corner.topLeft');
		const grab2 = { x: corner2.x + corner2.width / 2, y: corner2.y + corner2.height / 2 };
		await page.mouse.move(grab2.x, grab2.y);
		await page.mouse.down();
		await page.mouse.move(grab2.x - 2, grab2.y - 2);
		await startFrames(page);
		await page.mouse.move(view.x + 6, view.y + 6, { steps: 15 });
		await page.waitForFunction(selector => document.querySelector(`${selector} .basehalf-image-crop-size`)?.textContent === '2400 × 1600', CROP, { timeout: 20_000 });
		await page.waitForTimeout(500);
		const held = await stopFrames(page);
		await page.mouse.up();
		const anchor = { right: cropped.x + cropped.width - view.x, bottom: cropped.y + cropped.height - view.y };
		const outside = held.filter(frame => frame.left < -0.5 || frame.top < -0.5 || frame.right > frame.viewWidth + 0.5 || frame.bottom > frame.viewHeight + 0.5);
		const drifted = held.filter(frame => Math.abs(frame.right - anchor.right) > 1 || Math.abs(frame.bottom - anchor.bottom) > 1);
		const grew = held.filter((frame, index) => index > 0 && frame.scale > held[index - 1].scale + 1e-9);
		const followed = held.length > 1 && held[held.length - 1].scale < held[0].scale;
		const tail = held.slice(-10);
		const stopped = tail.every(frame => Math.abs(frame.scale - tail[0].scale) < 1e-9);
		if (outside.length || drifted.length || grew.length || !followed || !stopped || held.some(frame => !frame.drawn)) {
			throw new Error(`A corner held in the margin brings the picture to it around the corner across, inside the view, and stops at the original's edge: ${JSON.stringify({ frames: held.length, outside: outside.length, drifted: drifted.slice(0, 2), anchor, grew: grew.length, followed, stopped })}`);
		}
		await waitUntil(isOriginal, 'the crop taken back to be written as the original\'s own bytes, with no record', 30_000);

		// Criterion 25: while editing, a pinch zooms the picture under the frame, and a swipe moves it.
		await page.waitForTimeout(1_400);
		const restFrame = await frameBox(page);
		const middle = { x: restFrame.x + restFrame.width / 2, y: restFrame.y + restFrame.height / 2 };
		await pinch(page, middle.x, middle.y, 2);
		await page.waitForTimeout(400);
		const pinchedFrame = await frameBox(page);
		const pinchedSize = await sizeText(page);
		if (Math.abs(pinchedFrame.x - restFrame.x) > 1 || Math.abs(pinchedFrame.width - restFrame.width) > 1 || Math.abs(pinchedFrame.height - restFrame.height) > 1 || pinchedSize !== '1200 × 800') {
			throw new Error(`A pinch by 2 while editing keeps the frame and halves the part kept around the pointer: ${JSON.stringify({ restFrame, pinchedFrame, pinchedSize })}`);
		}
		await waitUntil(() => /\ncrop:\n {2}x: [\d.]+\n {2}y: [\d.]+\n {2}width: 1200\n {2}height: 800\n/.test(recordText()), 'the pinch to be written as a crop of 1200 × 800', 30_000);
		const cropX = () => /\ncrop:\n {2}x: ([\d.]+)\n/.exec(recordText())?.[1];
		const pinchedX = cropX();

		// A drag inside the frame, as a trackpad's three-finger drag makes it: the picture follows the pointer exactly under the still
		// frame, as a phone's photo editor and the photo app move it, with no jump at the press or the release; one change.
		const from = { x: middle.x + 90, y: middle.y + 50 };
		await page.mouse.move(from.x, from.y);
		await startFrames(page);
		await page.waitForTimeout(150);
		await page.mouse.down();
		await page.waitForTimeout(100);
		for (let i = 1; i <= 20; i++) {
			await page.mouse.move(from.x - 8 * i, from.y - 4 * i);
			await page.waitForTimeout(16);
		}
		await page.waitForTimeout(100);
		await page.mouse.up();
		await page.waitForTimeout(1_200);
		const dragged = await stopFrames(page);
		const pressed = dragged.filter(frame => frame.adjusting && Number.isFinite(frame.pointer.x));
		const offsets = pressed.map(frame => ({ x: frame.x - frame.pointer.x, y: frame.y - frame.pointer.y }));
		const spread = values => Math.max(...values) - Math.min(...values);
		const framesMoved = dragged.filter(frame => Math.abs(frame.left - dragged[0].left) > 0.5 || Math.abs(frame.top - dragged[0].top) > 0.5 || Math.abs(frame.right - dragged[0].right) > 0.5 || Math.abs(frame.bottom - dragged[0].bottom) > 0.5);
		const pressAt = dragged.findIndex(frame => frame.adjusting);
		const releaseAt = dragged.findIndex((frame, index) => index > pressAt && !frame.adjusting);
		const untilPress = dragged.slice(0, pressAt + 1);
		const fromRelease = dragged.slice(releaseAt - 1);
		const letGoAt = pressed[pressed.length - 1];
		if (pressed.length < 10 || framesMoved.length || spread(offsets.map(o => o.x)) > 0.5 || spread(offsets.map(o => o.y)) > 0.5
			|| untilPress.some(frame => Math.abs(frame.x - untilPress[0].x) > 0.01 || Math.abs(frame.y - untilPress[0].y) > 0.01)
			|| fromRelease.some(frame => Math.abs(frame.x - letGoAt.x) > 0.01 || Math.abs(frame.y - letGoAt.y) > 0.01)
			|| Math.abs(letGoAt.x - dragged[0].x + 160) > 0.5 || Math.abs(letGoAt.y - dragged[0].y + 80) > 0.5) {
			throw new Error(`A drag inside the frame moves the picture under the still frame with the pointer, with no jump at the press or the release: ${JSON.stringify({ pressed: pressed.length, framesMoved: framesMoved.length, spreadX: spread(offsets.map(o => o.x)), spreadY: spread(offsets.map(o => o.y)), moved: letGoAt && { x: letGoAt.x - dragged[0].x, y: letGoAt.y - dragged[0].y } })}`);
		}
		await waitUntil(() => cropX() !== undefined && cropX() !== pinchedX, 'the drag inside the frame to be written as a crop moved', 30_000);
		const draggedX = cropX();
		const transformOf = () => page.evaluate(selector => document.querySelector(`${selector} .basehalf-image-crop-picture`).style.transform, CROP);
		const beforeSwipe = await transformOf();
		await page.mouse.move(middle.x, middle.y);
		for (let i = 0; i < 8; i++) {
			await page.mouse.wheel(-15, 0);
			await page.waitForTimeout(16);
		}
		await page.waitForTimeout(400);
		const swipedFrame = await frameBox(page);
		if (await transformOf() === beforeSwipe || Math.abs(swipedFrame.x - restFrame.x) > 1 || await sizeText(page) !== '1200 × 800') {
			throw new Error('A two-finger swipe while editing moves the picture under the frame, which stays where it is.');
		}
		await waitUntil(() => cropX() !== undefined && cropX() !== draggedX, 'the swipe to be written as a crop moved', 30_000);
		await page.mouse.dblclick(middle.x, middle.y);
		await page.waitForTimeout(300);
		if (await sizeText(page) !== '1200 × 800' || await page.locator(`${CROP}.zoomed`).count()) {
			throw new Error('A double click while editing changes nothing.');
		}
		await pinch(page, middle.x, middle.y, 0.3);
		await page.waitForTimeout(400);
		if (await sizeText(page) !== '2400 × 1600') {
			throw new Error(`A pinch out while editing takes the part back as far as the picture holds: ${await sizeText(page)}`);
		}
		await waitUntil(isOriginal, 'the pinch out to be written as the original', 30_000);

		// Criterion 26: Edit from a zoomed view glides back to as it fits, drawn in every frame.
		await leaveEditing(page);
		await pinch(page, view.x + view.width * 0.3, view.y + view.height * 0.4, 2);
		await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('zoomed'), CROP, { timeout: 5_000 });
		await startFrames(page);
		await enterEditing(page);
		await page.waitForTimeout(600);
		const edit = await stopFrames(page);
		const between = edit.filter((frame, index) => index > 0 && frame.scale < edit[index - 1].scale - 1e-9);
		if (between.length < 5 || edit.some(frame => !frame.drawn) || await page.locator(`${CROP}.zoomed`).count()) {
			throw new Error(`Edit from a zoomed view glides back to as it fits, the picture drawn in every frame: ${JSON.stringify({ frames: edit.length, gliding: between.length })}`);
		}
		await page.keyboard.press('Escape');
		await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('viewing'), CROP, { timeout: 5_000 });
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
