/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail's waveform of a sound (editing media): the editor at once, a stretch selected and cut, a trim by a handle, undo, Escape, and Revert to Original.

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

const FOLDER = 'sound';
const SOUND = `${FOLDER}/take.wav`;
const DETAIL = '.basehalf-card-detail.visible';
const SURFACE = '.basehalf-card-detail-surface.active';
const WAVE = `${SURFACE} .basehalf-sound-waveform`;
const LINE = `${SURFACE} .basehalf-media-edit-line`;
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const RATE = 16000;
/** Changes of one name within 0.6 s are one step: the changes of this test are apart. */
const APART_MS = 700;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

/** Four seconds of a tone at 16 kHz in mono, 16 bits, louder each second. */
function toneWav() {
	const frames = RATE * 4;
	const data = Buffer.alloc(frames * 2);
	for (let index = 0; index < frames; index++) {
		data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * index / RATE) * 12000 * (1 + Math.floor(index / RATE)) / 4), index * 2);
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

/** The seconds of a WAV of this step. */
function seconds(bytes) {
	return bytes.readUInt32LE(40) / (RATE * 2);
}

/** The waveform, once its sound is decoded and Play can play. */
async function waitForWaveform(page) {
	await page.waitForFunction(selector => document.querySelector(`${selector} .basehalf-sound-waveform-play`)?.getAttribute('aria-disabled') === 'false', WAVE, { timeout: 15_000 });
}

/** The length of the parts that the waveform shows joined, and the stretch between its handles. */
async function readWave(page) {
	return page.evaluate(selector => {
		const end = document.querySelector(`${selector} .basehalf-video-frames-handle.end`);
		const start = document.querySelector(`${selector} .basehalf-video-frames-handle.start`);
		return { length: Number(end?.getAttribute('aria-valuemax')), start: Number(start?.getAttribute('aria-valuenow')), end: Number(end?.getAttribute('aria-valuenow')) };
	}, WAVE);
}

/** The parts of the line under the editor that show, without the dots between them. */
async function lineText(page) {
	return page.evaluate(selector => Array.from(document.querySelector(selector)?.querySelectorAll('.basehalf-media-edit-line-part:not([hidden])') ?? []).map(part => part.textContent).join(' | '), LINE);
}

/** The place on the strip of a time of the parts joined. */
async function stripPoint(page, time) {
	const strip = await page.locator(`${WAVE} .basehalf-video-frames-strip`).boundingBox();
	const { length } = await readWave(page);
	return { x: strip.x + strip.width * time / length, y: strip.y + strip.height * 0.7 };
}

/** Drags on the waveform from one time to another, inside the part: it selects the stretch between them. */
async function select(page, from, to) {
	const start = await stripPoint(page, from);
	const end = await stripPoint(page, to);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	for (let index = 1; index <= 10; index++) {
		await page.mouse.move(start.x + (end.x - start.x) * index / 10, start.y);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();
}

/** Drags a handle of the waveform to a time, holding the place where it was pressed. */
async function dragHandle(page, which, time) {
	const strip = await page.locator(`${WAVE} .basehalf-video-frames-strip`).boundingBox();
	const handle = await page.locator(`${WAVE} .basehalf-video-frames-handle.${which}`).boundingBox();
	const { length } = await readWave(page);
	const fromX = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	const edgeX = which === 'start' ? handle.x + handle.width : handle.x;
	const toX = strip.x + strip.width * time / length + (fromX - edgeX);
	await page.mouse.move(fromX, y);
	await page.mouse.down();
	for (let index = 1; index <= 10; index++) {
		await page.mouse.move(fromX + (toX - fromX) * index / 10, y);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();
}

export async function assertCardDetailSoundEdit(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	const original = toneWav();
	fs.writeFileSync(workspaceFile(SOUND), original);
	const cardInformation = workspaceFile(`.bh/mirror/${SOUND}`);
	const read = file => fs.existsSync(file) ? fs.readFileSync(file) : undefined;
	const recordText = () => read(path.join(cardInformation, 'edit.yaml'))?.toString() ?? '';
	const parts = () => (recordText().match(/ {2}- start: /g) ?? []).length;
	try {
		await quickOpen(page, SOUND);
		await assertCardDetail(page, 'take.wav');
		await waitForWaveform(page);
		const atOpen = await page.evaluate(selector => ({
			buttons: Array.from(document.querySelectorAll(`${selector} button`)).filter(button => !button.hidden).map(button => button.className),
			player: !!document.querySelector('.basehalf-card-detail-surface.active .basehalf-canvas-video-player')
		}), WAVE);
		if (atOpen.player || atOpen.buttons.length !== 1 || !/basehalf-sound-waveform-play/.test(atOpen.buttons[0])) {
			throw new Error(`Card Detail of a sound shows its waveform at once, in place of a player, with Play as its one button: ${JSON.stringify(atOpen)}`);
		}

		// A drag inside the part selects a stretch, with Delete on it; Delete cuts it out, a change written with nothing more pressed.
		await select(page, 1, 2);
		const deleteButton = page.locator(`${WAVE} .basehalf-sound-waveform-delete`);
		await deleteButton.waitFor({ state: 'visible', timeout: 5_000 });
		await deleteButton.click();
		await page.waitForFunction(selector => Number(document.querySelector(`${selector} .basehalf-video-frames-handle.end`)?.getAttribute('aria-valuemax')) < 3.3, WAVE, { timeout: 5_000 });
		await waitUntil(() => parts() === 2 && !!read(path.join(cardInformation, 'original.wav'))?.equals(original), 'the cut to be written', 30_000);
		const cut = fs.readFileSync(workspaceFile(SOUND));
		const cutRecord = recordText();
		if (seconds(cut) < 2.7 || seconds(cut) > 3.3 || await deleteButton.isVisible()) {
			throw new Error(`Delete writes the two parts joined, and the selection goes with what it held: ${JSON.stringify({ length: seconds(cut), record: cutRecord })}`);
		}

		// Letting go of a handle trims the sound to the part between the handles.
		await page.waitForTimeout(APART_MS);
		await dragHandle(page, 'end', 2.5);
		await waitUntil(() => recordText() !== cutRecord && Math.abs(seconds(read(workspaceFile(SOUND))) - 2.5) < 0.15, 'the trim to be written', 30_000);
		await page.waitForFunction(selector => !!document.querySelector(`${selector} .basehalf-media-edit-line-saving`)?.parentElement?.hidden, LINE, { timeout: 15_000 });
		if (!/^Trimmed to 2 parts \| Revert to Original$/.test(await lineText(page))) {
			throw new Error(`The line under the waveform says the edit and offers Revert to Original: ${await lineText(page)}`);
		}

		// Command+Z undoes the trim, and the file is the cut again, byte for byte.
		await page.locator(`${WAVE} .basehalf-sound-waveform-play`).focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => !!read(workspaceFile(SOUND))?.equals(cut) && recordText() === cutRecord, 'undo to put the cut back', 30_000);

		// Escape with a stretch selected drops the selection only; the next Escape closes Card Detail.
		await select(page, 0.5, 1.5);
		await deleteButton.waitFor({ state: 'visible', timeout: 5_000 });
		await page.keyboard.press('Escape');
		await deleteButton.waitFor({ state: 'hidden', timeout: 5_000 });
		if (!(await page.locator(DETAIL).isVisible())) {
			throw new Error('Escape with a stretch selected drops the selection and leaves Card Detail open.');
		}
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });

		// Card Detail opened again shows the parts joined; Revert to Original puts the original back, and undo brings the edit back.
		await quickOpen(page, SOUND);
		await assertCardDetail(page, 'take.wav');
		await waitForWaveform(page);
		const again = await readWave(page);
		if (Math.abs(again.length - seconds(cut)) > 0.05) {
			throw new Error(`Card Detail of an edited sound shows its parts joined: ${JSON.stringify(again)} for ${seconds(cut)}`);
		}
		await page.locator(`${LINE} .basehalf-media-edit-line-action.revert`).click();
		await waitUntil(() => !!read(workspaceFile(SOUND))?.equals(original) && !fs.existsSync(path.join(cardInformation, 'edit.yaml')), 'Revert to Original to put the original WAV back', 30_000);
		await page.locator(`${WAVE} .basehalf-sound-waveform-play`).focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => !!read(workspaceFile(SOUND))?.equals(cut), 'undo to bring the edit back', 30_000);
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
