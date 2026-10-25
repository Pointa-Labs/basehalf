/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail's waveform of a sound (editing media): Edit, Delete, Trim, Done, Revert, and undo.

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

const FOLDER = 'sound';
const SOUND = `${FOLDER}/take.wav`;
const DETAIL = '.basehalf-card-detail.visible';
const WAVE = '.basehalf-card-detail-surface.active .basehalf-sound-waveform';
const NOTE = '.basehalf-card-detail-surface.active .basehalf-media-edit-note';
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const RATE = 16000;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

function editAction(name) {
	return `${DETAIL} .basehalf-card-detail-edit-actions [data-edit-action="${name}"]`;
}

/** Four seconds of a tone at 16 kHz in mono, 16 bits. */
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

async function enterEdit(page) {
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-disabled') === 'false', editAction('edit'), { timeout: 15_000 });
	await page.locator(editAction('edit')).click();
	await page.waitForFunction(selector => document.querySelector(`${selector} .basehalf-sound-waveform-play`)?.getAttribute('aria-disabled') === 'false', WAVE, { timeout: 15_000 });
}

async function waitForNote(page, pattern) {
	await page.waitForFunction(({ selector, source }) => new RegExp(source).test(document.querySelector(selector)?.textContent ?? ''), { selector: NOTE, source: pattern.source }, { timeout: 30_000 });
}

/** Drags a handle of the waveform to a time, holding the place where it was pressed. */
async function dragHandle(page, which, time) {
	const strip = await page.locator(`${WAVE} .basehalf-video-frames-strip`).boundingBox();
	const handle = await page.locator(`${WAVE} .basehalf-video-frames-handle.${which}`).boundingBox();
	const duration = Number(await page.locator(`${WAVE} .basehalf-video-frames-handle.end`).getAttribute('aria-valuemax'));
	const fromX = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	const edgeX = which === 'start' ? handle.x + handle.width : handle.x;
	const toX = strip.x + strip.width * time / duration + (fromX - edgeX);
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
	try {
		await quickOpen(page, SOUND);
		await assertCardDetail(page, 'take.wav');
		await enterEdit(page);
		const disabled = await page.evaluate(selector => ['trim', 'delete'].map(name => document.querySelector(`${selector} .basehalf-sound-waveform-action.${name}`)?.getAttribute('aria-disabled')), WAVE);
		if (disabled.join() !== 'true,true') {
			throw new Error(`With the whole sound between the handles, Trim and Delete wait: ${disabled}`);
		}
		// Delete the second second: what is around it is joined.
		await dragHandle(page, 'start', 1);
		await dragHandle(page, 'end', 2);
		await page.locator(`${WAVE} .basehalf-sound-waveform-action.delete`).click();
		await page.waitForFunction(selector => Number(document.querySelector(`${selector} .basehalf-video-frames-handle.end`)?.getAttribute('aria-valuemax')) < 3.3, WAVE, { timeout: 5_000 });
		// Command+Z in edit mode undoes the Delete, and Shift+Command+Z does it again.
		await page.locator(`${WAVE} .basehalf-video-frames-handle.start`).focus();
		await page.keyboard.press(UNDO);
		await page.waitForFunction(selector => Number(document.querySelector(`${selector} .basehalf-video-frames-handle.end`)?.getAttribute('aria-valuemax')) > 3.9, WAVE, { timeout: 5_000 });
		await page.keyboard.press(process.platform === 'darwin' ? 'Shift+Meta+Z' : 'Control+Shift+Z');
		await page.waitForFunction(selector => Number(document.querySelector(`${selector} .basehalf-video-frames-handle.end`)?.getAttribute('aria-valuemax')) < 3.3, WAVE, { timeout: 5_000 });

		await page.locator(editAction('done')).click();
		await waitForNote(page, /^Edited\./);
		const edited = fs.readFileSync(workspaceFile(SOUND));
		const record = fs.readFileSync(path.join(cardInformation, 'edit.yaml'), 'utf8');
		const length = seconds(edited);
		if (length < 2.7 || length > 3.3 || !fs.readFileSync(path.join(cardInformation, 'original.wav')).equals(original) || (record.match(/ {2}- start: /g) ?? []).length !== 2) {
			throw new Error(`Done writes the two parts joined, keeps the original, and records both parts: ${JSON.stringify({ length, record })}`);
		}

		// Edit again shows the sound as the edit made it; Revert puts the original back, and undo brings the edit back.
		await enterEdit(page);
		const again = Number(await page.locator(`${WAVE} .basehalf-video-frames-handle.end`).getAttribute('aria-valuemax'));
		if (Math.abs(again - length) > 0.05) {
			throw new Error(`Edit on an edited sound shows its parts joined: ${again} for ${length}`);
		}
		await page.locator(editAction('revert')).click();
		await waitForNote(page, /^The original is back\./);
		if (!fs.readFileSync(workspaceFile(SOUND)).equals(original)) {
			throw new Error('Revert puts back the original WAV.');
		}
		await page.locator(editAction('edit')).focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => fs.readFileSync(workspaceFile(SOUND)).equals(edited), 'undo to bring the edit back', 15_000);
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
