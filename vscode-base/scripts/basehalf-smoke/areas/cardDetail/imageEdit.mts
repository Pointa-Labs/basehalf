/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail's crop view of an image (editing media): Edit, a ratio, a turn and a flip, Done, Revert, and undo.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { workspacePath } from '../../context.mts';
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

const FOLDER = 'crop';
const IMAGE = `${FOLDER}/still.png`;
const DETAIL = '.basehalf-card-detail.visible';
const CROP = '.basehalf-card-detail-surface.active .basehalf-image-crop';
const NOTE = '.basehalf-card-detail-surface.active .basehalf-media-edit-note';
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

function editAction(name) {
	return `${DETAIL} .basehalf-card-detail-edit-actions [data-edit-action="${name}"]`;
}

function chunk(type, body) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0);
	return Buffer.concat([head, body, crc]);
}

/** A PNG of a pattern in which every pixel of a row and of a column differs, with a text chunk. */
function patternPng(width, height) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const rows = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			rows.set([x & 255, y & 255, (x * 7 + y * 3) & 255], y * (width * 3 + 1) + 1 + x * 3);
		}
	}
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('tEXt', Buffer.from('Comment\0a still', 'latin1')), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function pngSize(bytes) {
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function waitForNote(page, pattern) {
	await page.waitForFunction(({ selector, source }) => new RegExp(source).test(document.querySelector(selector)?.textContent ?? ''), { selector: NOTE, source: pattern.source }, { timeout: 30_000 });
}

async function enterEdit(page) {
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-disabled') === 'false', editAction('edit'), { timeout: 15_000 });
	await page.locator(editAction('edit')).click();
	await page.locator(CROP).waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(selector => (document.querySelector(selector)?.naturalWidth ?? 0) > 0, `${CROP} .basehalf-image-crop-picture`, { timeout: 15_000 });
}

async function chooseRatio(page, label) {
	await page.locator(`${CROP} .basehalf-image-crop-tool.ratio`).click();
	const item = page.locator('.context-view.monaco-menu-container .action-label').filter({ hasText: new RegExp(`^${label}$`) }).filter({ visible: true }).last();
	await item.waitFor({ state: 'visible', timeout: 10_000 });
	// VS Code attaches menu mouse-up listeners after a 100 ms guard against the pointer event that opened the menu.
	await page.waitForTimeout(150);
	await item.click();
}

export async function assertCardDetailImageEdit(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	const original = patternPng(96, 64);
	fs.writeFileSync(workspaceFile(IMAGE), original);
	const cardInformation = workspaceFile(`.bh/mirror/${IMAGE}`);
	try {
		// An SVG is shown, and Edit says why it is not edited.
		await quickOpen(page, 'concept.svg');
		await assertCardDetail(page, 'concept.svg');
		await page.waitForFunction(selector => {
			const button = document.querySelector(selector);
			return button?.getAttribute('aria-disabled') === 'true' && /can't edit SVG images/.test(button.getAttribute('data-basehalf-hover') ?? '');
		}, editAction('edit'), { timeout: 15_000 });

		await quickOpen(page, IMAGE);
		await assertCardDetail(page, 'still.png');
		await enterEdit(page);
		await chooseRatio(page, 'Square');
		await page.locator(editAction('done')).click();
		await waitForNote(page, /^Edited\./);
		const squared = fs.readFileSync(workspaceFile(IMAGE));
		const record = fs.readFileSync(path.join(cardInformation, 'edit.yaml'), 'utf8');
		if (JSON.stringify(pngSize(squared)) !== '[64,64]' || !fs.readFileSync(path.join(cardInformation, 'original.png')).equals(original) || !/\ncrop:\n {2}x: 48\n {2}y: 32\n {2}width: 64\n {2}height: 64\n/.test(record) || !squared.includes(Buffer.from('Comment\0a still', 'latin1'))) {
			throw new Error(`Square on a 96 × 64 PNG keeps its middle 64 × 64, its original, and its text: ${JSON.stringify({ size: pngSize(squared), record })}`);
		}

		// Edit again starts from the original, square as it was; a turn and a flip are made of the original.
		await enterEdit(page);
		const ratio = await page.locator(`${CROP} .basehalf-image-crop-ratio-label`).textContent();
		if (ratio !== 'Square' || (await page.locator(editAction('revert')).count()) !== 1) {
			throw new Error(`Edit on a cropped image goes on with its ratio, and offers Revert: ${ratio}`);
		}
		await page.locator(`${CROP} .basehalf-image-crop-tool.turn`).click();
		await page.locator(`${CROP} .basehalf-image-crop-tool.flip`).click();
		await page.locator(editAction('done')).click();
		await waitForNote(page, /^Edited\./);
		const turned = fs.readFileSync(workspaceFile(IMAGE));
		const turnedRecord = fs.readFileSync(path.join(cardInformation, 'edit.yaml'), 'utf8');
		if (turned.equals(squared) || JSON.stringify(pngSize(turned)) !== '[64,64]' || !/\nturn: 1\nflip: true\n/.test(turnedRecord)) {
			throw new Error(`A turn and a flip are saved as one edit of the original: ${turnedRecord}`);
		}

		// Revert puts the original back; undo of the Revert brings the edit back.
		await enterEdit(page);
		await page.locator(editAction('revert')).click();
		await waitForNote(page, /^The original is back\./);
		if (!fs.readFileSync(workspaceFile(IMAGE)).equals(original) || fs.existsSync(path.join(cardInformation, 'edit.yaml'))) {
			throw new Error('Revert puts back the original PNG and removes the record.');
		}
		await page.locator(editAction('edit')).focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => fs.readFileSync(workspaceFile(IMAGE)).equals(turned), 'undo to bring the edit back', 15_000);

		// Escape in edit mode cancels and leaves Card Detail open; the next Escape closes it.
		await enterEdit(page);
		await page.locator(`${CROP} .basehalf-image-crop-corner.topLeft`).focus();
		await page.keyboard.press('Escape');
		await page.locator(CROP).waitFor({ state: 'detached', timeout: 10_000 });
		if (!(await page.locator(DETAIL).isVisible())) {
			throw new Error('Escape in edit mode cancels the edit and leaves Card Detail open.');
		}
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
