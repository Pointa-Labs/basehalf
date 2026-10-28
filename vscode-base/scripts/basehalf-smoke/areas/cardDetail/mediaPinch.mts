/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A pinch in Card Detail (editing media, "Zooming the picture and the time", criteria 16 to 20): the picture of a
// video grows past its player as a browser zooms its page, the page of an SVG zooms, the crop view of a PNG zooms, a
// swipe moves a zoomed picture and zooms nothing, the frame viewer and the waveform spread their time out while they
// are edited, and nothing else zooms, neither the window nor the canvas.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { root, workspacePath } from '../../context.mts';
import { assertCardDetail, cardDetailModeLabel, enterEditing, pinch } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { patternPng } from './imageEdit.mts';

const FOLDER = 'pinch';
const VIDEO = `${FOLDER}/wide.mp4`;
const SOUND = `${FOLDER}/voice.wav`;
const IMAGE = `${FOLDER}/still.png`;
const DETAIL = '.basehalf-card-detail.visible';
const SURFACE = '.basehalf-card-detail-surface.active';
const PLAYER = `${SURFACE} .basehalf-canvas-video-player.detail`;
const FRAMES = `${SURFACE} .basehalf-video-frames:not(.basehalf-sound-waveform)`;
const WAVE = `${SURFACE} .basehalf-sound-waveform`;
const CROP = `${SURFACE} .basehalf-image-crop`;
const RATE = 16000;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

/** Six seconds of a tone at 16 kHz in mono, 16 bits, in three phrases with pauses between them. */
function phrasesWav() {
	const frames = RATE * 6;
	const data = Buffer.alloc(frames * 2);
	for (let index = 0; index < frames; index++) {
		const second = Math.floor(index / RATE);
		const loud = second % 2 === 0 ? 1 : 0.25;
		data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * index / RATE) * 14000 * loud), index * 2);
	}
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(RATE, 24);
	header.writeUInt32LE(RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

/** What a pinch must never change: the zoom of the window and of the canvas under Card Detail. */
async function zoomOutside(page) {
	return page.evaluate(() => ({
		visual: window.visualViewport?.scale,
		ratio: window.devicePixelRatio,
		canvas: Array.from(document.querySelectorAll('.basehalf-canvas-chrome *')).map(element => element.textContent?.trim()).find(text => /%$/.test(text ?? ''))
	}));
}

/** Escape goes back to viewing while editing, and closes Card Detail while viewing (D96). */
async function closeDetail(page) {
	await page.mouse.move(4, 4);
	if (await cardDetailModeLabel(page) === 'Done') {
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => document.querySelector('.basehalf-card-detail.visible .basehalf-card-detail-mode-button')?.getAttribute('aria-label') === 'Edit', undefined, { timeout: 5_000 });
	}
	await page.keyboard.press('Escape');
	await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
}

/** The times a strip shows, and its box. */
async function readStrip(page, selector) {
	return page.evaluate(selector => {
		const strip = document.querySelector(`${selector} .basehalf-video-frames-strip`);
		const box = strip.getBoundingClientRect();
		return { from: Number(strip.dataset.from), to: Number(strip.dataset.to), x: box.x, y: box.y, width: box.width, height: box.height };
	}, selector);
}

function timeAt(strip, x) {
	return strip.from + (x - strip.x) / strip.width * (strip.to - strip.from);
}

/** The pixels of a PNG of 8 bits a channel, gray, RGB, or RGBA, as the window's screenshots are. */
function decodePng(png) {
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels = 0;
	const data = [];
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString('latin1', offset + 4, offset + 8);
		const body = png.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[body[9]];
			if (body[8] !== 8 || !channels) {
				throw new Error(`A screenshot of ${body[8]} bits in color type ${body[9]} cannot be read here.`);
			}
		} else if (type === 'IDAT') {
			data.push(body);
		}
		offset += 12 + length;
	}
	const raw = zlib.inflateSync(Buffer.concat(data));
	const stride = width * channels;
	const pixels = Buffer.alloc(stride * height);
	for (let row = 0; row < height; row++) {
		const filter = raw[row * (stride + 1)];
		const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
		for (let index = 0; index < stride; index++) {
			const left = index >= channels ? pixels[row * stride + index - channels] : 0;
			const up = row > 0 ? pixels[(row - 1) * stride + index] : 0;
			const upLeft = row > 0 && index >= channels ? pixels[(row - 1) * stride + index - channels] : 0;
			const paeth = () => {
				const estimate = left + up - upLeft;
				const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
				return a <= b && a <= c ? left : b <= c ? up : upLeft;
			};
			const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth() : 0;
			pixels[row * stride + index] = (line[index] + predicted) & 0xff;
		}
	}
	return { width, height, channels, pixels };
}

/**
 * Under the player of a zoomed video, down to the frame viewer, the window shows only Card Detail's background:
 * the band of the viewer meets the player's bottom edge, and no sliver of the picture shows between them (editing
 * media, "Zooming the picture and the time"). The rows checked stop 6 pixels above the strip, where its playhead
 * and its frame reach.
 */
async function assertNothingUnderPlayer(page, when) {
	const geometry = await page.evaluate(({ player, frames }) => {
		const box = document.querySelector(player).getBoundingClientRect();
		const area = document.querySelector('.basehalf-card-detail-surface.active .basehalf-card-detail-media-webview').getBoundingClientRect();
		const strip = document.querySelector(`${frames} .basehalf-video-frames-strip`).getBoundingClientRect();
		const background = getComputedStyle(document.querySelector('.basehalf-card-detail.visible')).backgroundColor;
		return { bottom: box.bottom, stripTop: strip.top, left: area.left, right: area.right, background };
	}, { player: PLAYER, frames: FRAMES });
	const top = Math.ceil(geometry.bottom);
	const height = Math.floor(geometry.stripTop) - 6 - top;
	const left = Math.ceil(geometry.left) + 1;
	const width = Math.floor(geometry.right) - 1 - left;
	if (height < 1 || width < 1) {
		throw new Error(`The frame viewer stands under the player, with room between them: ${JSON.stringify(geometry)}`);
	}
	const shot = decodePng(await page.screenshot({ clip: { x: left, y: top, width, height } }));
	const background = (geometry.background.match(/\d+/g) ?? []).slice(0, 3).map(Number);
	let different = 0;
	let first;
	for (let index = 0; index < shot.width * shot.height; index++) {
		const pixel = Array.from(shot.pixels.subarray(index * shot.channels, index * shot.channels + 3));
		if (pixel.some((value, channel) => Math.abs(value - background[channel]) > 6)) {
			different++;
			first ??= { x: index % shot.width, y: Math.floor(index / shot.width), pixel };
		}
	}
	if (different) {
		throw new Error(`${when}: under the player, down to the frame viewer, no picture shows, only Card Detail's background: ${different} of ${shot.width * shot.height} pixels are not ${geometry.background}, first ${JSON.stringify(first)}, rows ${top} to ${top + height}`);
	}
}

async function readPlayer(page) {
	return page.evaluate(selector => {
		const player = document.querySelector(selector);
		const video = player.querySelector('video');
		const box = player.getBoundingClientRect();
		const rect = video.getBoundingClientRect();
		const bar = player.querySelector('.basehalf-canvas-video-player-bar').getBoundingClientRect();
		return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, bar: { width: bar.width, height: bar.height }, transform: video.style.transform, paused: video.paused };
	}, PLAYER);
}

async function assertVideoPinch(page) {
	await quickOpen(page, VIDEO);
	await assertCardDetail(page, 'wide.mp4');
	await page.waitForFunction(selector => (document.querySelector(`${selector} video`)?.videoWidth ?? 0) > 0, PLAYER, { timeout: 15_000 });
	await page.waitForFunction(selector => !!document.querySelector(selector)?.querySelector('.basehalf-video-frames-picture'), FRAMES, { timeout: 15_000 });

	// Criterion 20: as it fits, a swipe over the picture moves nothing and zooms nothing.
	const fitting = await readPlayer(page);
	await page.mouse.move(fitting.box.x + fitting.box.width / 2, fitting.box.y + fitting.box.height / 2);
	await page.mouse.wheel(40, 120);
	await page.waitForTimeout(200);
	if ((await readPlayer(page)).transform !== '') {
		throw new Error('As it fits, a swipe over the picture of a video moves nothing and zooms nothing.');
	}

	// Criterion 16: the picture grows 1.6 times around the pointer, past its player; the player and its controls keep their size.
	const before = await readPlayer(page);
	const at = { x: before.box.x + before.box.width * 0.3, y: before.box.y + before.box.height * 0.4 };
	const fromMiddle = { x: at.x - (before.box.x + before.box.width / 2), y: at.y - (before.box.y + before.box.height / 2) };
	await pinch(page, at.x, at.y, 1.6);
	await page.waitForTimeout(300);
	const zoomed = await readPlayer(page);
	const zoom = zoomed.rect.width / zoomed.box.width;
	const under = { x: zoomed.rect.x + zoomed.rect.width / 2 + fromMiddle.x * zoom, y: zoomed.rect.y + zoomed.rect.height / 2 + fromMiddle.y * zoom };
	if (Math.abs(zoom - 1.6) > 0.01 || Math.hypot(under.x - at.x, under.y - at.y) > 2
		|| JSON.stringify(zoomed.box) !== JSON.stringify(before.box) || JSON.stringify(zoomed.bar) !== JSON.stringify(before.bar)
		|| !(zoomed.rect.x < zoomed.box.x - 1 && zoomed.rect.y < zoomed.box.y - 1 && zoomed.rect.x + zoomed.rect.width > zoomed.box.x + zoomed.box.width + 1)) {
		throw new Error(`A pinch by 1.6 over the picture of a video draws it 1.6 times larger, past its player's box, the point under the pointer staying under it, the player and its controls at their size: ${JSON.stringify({ before, zoomed, zoom, under, at })}`);
	}
	await assertNothingUnderPlayer(page, 'Zoomed in by a pinch');
	// Criterion 20: a two-finger swipe moves the zoomed picture with the fingers, and zooms nothing.
	await page.mouse.move(at.x, at.y);
	await page.mouse.wheel(50, 30);
	await page.waitForTimeout(250);
	const swiped = await readPlayer(page);
	if (Math.abs(swiped.rect.width - zoomed.rect.width) > 0.5 || Math.abs(swiped.rect.x - (zoomed.rect.x - 50)) > 1 || Math.abs(swiped.rect.y - (zoomed.rect.y - 30)) > 1) {
		throw new Error(`A swipe moves the zoomed picture with the fingers and zooms nothing: ${JSON.stringify({ zoomed: zoomed.rect, swiped: swiped.rect })}`);
	}
	await assertNothingUnderPlayer(page, 'Moved by a swipe');

	// A drag moves the zoomed picture and plays nothing; a click plays it.
	const middle = { x: before.box.x + before.box.width / 2, y: before.box.y + before.box.height / 2 };
	await page.mouse.move(middle.x, middle.y);
	await page.mouse.down();
	for (let index = 1; index <= 8; index++) {
		await page.mouse.move(middle.x - 15 * index, middle.y - 5 * index);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();
	await page.waitForTimeout(250);
	const dragged = await readPlayer(page);
	await page.mouse.click(middle.x, middle.y);
	await page.waitForFunction(selector => !document.querySelector(`${selector} video`)?.paused, PLAYER, { timeout: 5_000 }).catch(() => undefined);
	const clicked = await readPlayer(page);
	if (dragged.transform === zoomed.transform || !dragged.paused || clicked.paused) {
		throw new Error(`A drag moves the zoomed picture without playing it, and a click then plays it: ${JSON.stringify({ zoomed: zoomed.transform, dragged, clicked: clicked.paused })}`);
	}
	await page.mouse.click(middle.x, middle.y);
	await pinch(page, middle.x, middle.y, 0.5);
	await page.waitForTimeout(300);
	const back = await readPlayer(page);
	if (back.transform !== '' || JSON.stringify(back.rect) !== JSON.stringify(before.rect)) {
		throw new Error(`A pinch by 0.5 shows the picture as it fits: ${JSON.stringify({ back, before })}`);
	}

	// Criterion 19: while viewing, a pinch over the frame viewer does nothing.
	const viewed = await readStrip(page, FRAMES);
	await pinch(page, viewed.x + viewed.width * 0.6, viewed.y + viewed.height / 2, 2);
	await page.waitForTimeout(300);
	const afterViewingPinch = await readStrip(page, FRAMES);
	if (afterViewingPinch.from !== viewed.from || afterViewingPinch.to !== viewed.to) {
		throw new Error(`While viewing, a pinch over the frame viewer spreads nothing out: ${JSON.stringify({ viewed, afterViewingPinch })}`);
	}

	// Criterion 18: after Edit, a pinch by 2 over the frame viewer spreads its time out around the pointer, and its pictures come.
	await enterEditing(page);
	const strip = await readStrip(page, FRAMES);
	const pointer = { x: strip.x + strip.width * 0.6, y: strip.y + strip.height / 2 };
	await pinch(page, pointer.x, pointer.y, 2);
	await page.waitForFunction(selector => {
		const viewer = document.querySelector(selector);
		const layer = viewer?.querySelector('.basehalf-video-frames-pictures.zoom');
		return !!viewer?.classList.contains('zoomed') && !!layer?.querySelector('.basehalf-video-frames-picture') && layer.style.transform === '';
	}, FRAMES, { timeout: 5_000 });
	const spread = await readStrip(page, FRAMES);
	const frame = 1 / 24;
	if (Math.abs((strip.to - strip.from) / (spread.to - spread.from) - 2) > 0.02 || Math.abs(timeAt(spread, pointer.x) - timeAt(strip, pointer.x)) > frame) {
		throw new Error(`A pinch by 2 over the frame viewer spreads its time out 2 times around the pointer: ${JSON.stringify({ strip, spread })}`);
	}
	await closeDetail(page);
}

async function assertSoundPinch(page) {
	await quickOpen(page, SOUND);
	await assertCardDetail(page, 'voice.wav');
	await page.waitForFunction(selector => document.querySelector(`${selector} .basehalf-sound-waveform-play`)?.getAttribute('aria-disabled') === 'false', WAVE, { timeout: 15_000 });

	// Criterion 19: a pinch over Play changes nothing.
	const whole = await readStrip(page, WAVE);
	const play = await page.locator(`${WAVE} .basehalf-sound-waveform-play`).boundingBox();
	await pinch(page, play.x + play.width / 2, play.y + play.height / 2, 3);
	await page.waitForTimeout(200);
	const afterPlay = await readStrip(page, WAVE);
	if (afterPlay.from !== whole.from || afterPlay.to !== whole.to) {
		throw new Error(`A pinch over Play spreads nothing out: ${JSON.stringify({ whole, afterPlay })}`);
	}

	// Criterion 19: while viewing, a pinch over the waveform does nothing.
	const middle = { x: whole.x + whole.width / 2, y: whole.y + whole.height / 2 };
	await pinch(page, middle.x, middle.y, 4);
	await page.waitForTimeout(300);
	const afterViewingPinch = await readStrip(page, WAVE);
	if (afterViewingPinch.from !== whole.from || afterViewingPinch.to !== whole.to) {
		throw new Error(`While viewing, a pinch over the waveform spreads nothing out: ${JSON.stringify({ whole, afterViewingPinch })}`);
	}

	// Criterion 18: after Edit, a pinch by 4 over the middle of the waveform spreads its time out 4 times around the pointer.
	await enterEditing(page);
	await pinch(page, middle.x, middle.y, 4);
	await page.waitForTimeout(300);
	const spread = await readStrip(page, WAVE);
	const bar = (spread.to - spread.from) / (spread.width / 5);
	if (Math.abs((whole.to - whole.from) / (spread.to - spread.from) - 4) > 0.04 || Math.abs(timeAt(spread, middle.x) - timeAt(whole, middle.x)) > bar) {
		throw new Error(`A pinch by 4 over the waveform spreads its time out 4 times around the pointer: ${JSON.stringify({ whole, spread })}`);
	}
	// The wheel moves it along.
	await page.mouse.move(middle.x, middle.y);
	await page.mouse.wheel(150, 0);
	await page.waitForTimeout(200);
	const moved = await readStrip(page, WAVE);
	if (!(moved.from > spread.from) || Math.abs((moved.to - moved.from) - (spread.to - spread.from)) > 1e-3) {
		throw new Error(`The wheel moves a spread-out waveform along: ${JSON.stringify({ spread, moved })}`);
	}
	// A press moves the playhead to the time under the pointer.
	const pressX = moved.x + moved.width * 0.25;
	await page.mouse.click(pressX, middle.y);
	await page.waitForTimeout(150);
	const playhead = await page.evaluate(selector => parseFloat(document.querySelector(`${selector} .basehalf-video-frames-playhead`).style.left), WAVE);
	if (Math.abs(playhead - 25) > 1) {
		throw new Error(`A press on a spread-out waveform moves the playhead to the time under the pointer: ${playhead}%`);
	}
	// A drag selects a stretch that Delete cuts out, and the waveform stays spread out.
	const from = moved.x + moved.width * 0.4;
	const to = moved.x + moved.width * 0.6;
	await page.mouse.move(from, middle.y);
	await page.mouse.down();
	for (let index = 1; index <= 8; index++) {
		await page.mouse.move(from + (to - from) * index / 8, middle.y);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();
	const remove = page.locator(`${WAVE} .basehalf-sound-waveform-delete`);
	await remove.waitFor({ state: 'visible', timeout: 5_000 });
	await remove.click();
	await page.waitForFunction(selector => document.querySelector(`${selector} .basehalf-sound-waveform-delete`)?.hidden, WAVE, { timeout: 5_000 });
	const cut = await readStrip(page, WAVE);
	if (Math.abs((cut.to - cut.from) - (moved.to - moved.from)) > 1e-3) {
		throw new Error(`A cut keeps the stretch that a pinch spread out: ${JSON.stringify({ moved, cut })}`);
	}
	await closeDetail(page);
}

async function assertPicturePinch(page) {
	// Criterion 17: over a PNG the pinch zooms the crop view while viewing, and changes no edit.
	const original = fs.readFileSync(workspaceFile(IMAGE));
	await quickOpen(page, IMAGE);
	await assertCardDetail(page, 'still.png');
	await page.waitForFunction(selector => (document.querySelector(selector)?.naturalWidth ?? 0) > 0, `${CROP} .basehalf-image-crop-picture`, { timeout: 15_000 });
	const view = await page.locator(`${CROP} .basehalf-image-crop-view`).boundingBox();
	await pinch(page, view.x + view.width / 2, view.y + view.height / 2, 1.6);
	await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('zoomed'), CROP, { timeout: 5_000 });
	await page.waitForTimeout(1_500);
	if (!fs.readFileSync(workspaceFile(IMAGE)).equals(original) || fs.existsSync(workspaceFile(`.bh/mirror/${IMAGE}/edit.yaml`))) {
		throw new Error('A pinch zooms the crop view only: the file and its record stay as they were.');
	}
	await closeDetail(page);

	// Over an SVG the pinch makes the picture 1.6 times larger around the pointer, and Fit shows it as it fits.
	await quickOpen(page, 'concept.svg');
	await assertCardDetail(page, 'concept.svg');
	let frame;
	for (let tries = 0; tries < 60 && !frame; tries++) {
		for (const candidate of page.frames()) {
			if (await candidate.evaluate(() => (document.getElementById('media')?.naturalWidth ?? 0) > 0).catch(() => false)) {
				frame = candidate;
			}
		}
		if (!frame) {
			await page.waitForTimeout(150);
		}
	}
	if (!frame) {
		throw new Error('Card Detail of an SVG shows the picture in its page.');
	}
	const host = await page.locator(`${SURFACE} .basehalf-card-detail-media-webview`).first().boundingBox();
	const width = () => frame.evaluate(() => document.getElementById('media').getBoundingClientRect().width);
	const fitted = await width();
	const box = await frame.evaluate(() => {
		const rect = document.getElementById('media').getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	});
	await pinch(page, host.x + box.x + box.width / 2, host.y + box.y + box.height / 2, 1.6);
	await page.waitForTimeout(400);
	const pinched = await width();
	await frame.locator('button[data-action="fit"]').click();
	await page.waitForTimeout(200);
	const again = await width();
	if (Math.abs(pinched / fitted - 1.6) > 0.02 || Math.abs(again - fitted) > 0.5) {
		throw new Error(`A pinch by 1.6 over an SVG draws it 1.6 times larger, and Fit shows it as it fits: ${JSON.stringify({ fitted, pinched, again })}`);
	}
	await closeDetail(page);
}

export async function assertCardDetailMediaPinch(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-720p-mock.mp4'), workspaceFile(VIDEO));
	fs.writeFileSync(workspaceFile(SOUND), phrasesWav());
	// Large enough that the view can zoom it: it zooms up to twice its pixels.
	fs.writeFileSync(workspaceFile(IMAGE), patternPng(1200, 800));
	try {
		const outside = await zoomOutside(page);
		await assertVideoPinch(page);
		await assertSoundPinch(page);
		await assertPicturePinch(page);
		// Criterion 19: no pinch zoomed the window or the canvas.
		const after = await zoomOutside(page);
		if (JSON.stringify(after) !== JSON.stringify(outside)) {
			throw new Error(`No pinch in Card Detail zooms the window or the canvas under it: ${JSON.stringify({ outside, after })}`);
		}
	} finally {
		if (await page.locator(DETAIL).isVisible().catch(() => false)) {
			await page.keyboard.press('Escape').catch(() => undefined);
		}
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
		// The cut of the sound kept its original beside its card information.
		fs.rmSync(workspaceFile(`.bh/mirror/${FOLDER}`), { recursive: true, force: true });
	}
}
