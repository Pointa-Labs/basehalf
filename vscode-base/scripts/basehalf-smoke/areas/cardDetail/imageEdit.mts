/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail's crop view of an image (editing media): the editor at once, a ratio, a turn and a flip saved as they are made, the wheel that zooms only the view, Revert to Original, and undo.

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
const SURFACE = '.basehalf-card-detail-surface.active';
const CROP = `${SURFACE} .basehalf-image-crop`;
const LINE = `${SURFACE} .basehalf-media-edit-line`;
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
/** Changes of one name within 0.6 s are one step: the changes of this test are apart. */
const APART_MS = 700;

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
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
export function patternPng(width, height) {
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

/** The crop view, once its picture is loaded. */
export async function waitForCrop(page) {
	await page.locator(CROP).waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(selector => (document.querySelector(selector)?.naturalWidth ?? 0) > 0, `${CROP} .basehalf-image-crop-picture`, { timeout: 15_000 });
}

/** The parts of the line under the editor that show, without the dots between them. */
async function lineText(page) {
	return page.evaluate(selector => Array.from(document.querySelector(selector)?.querySelectorAll('.basehalf-media-edit-line-part:not([hidden])') ?? []).map(part => part.textContent).join(' | '), LINE);
}

export async function chooseRatio(page, label) {
	await page.locator(`${CROP} .basehalf-image-crop-tool.ratio`).click();
	const item = page.locator('.context-view.monaco-menu-container .action-label').filter({ hasText: new RegExp(`^${label}$`) }).filter({ visible: true }).last();
	await item.waitFor({ state: 'visible', timeout: 10_000 });
	// VS Code attaches menu mouse-up listeners after a 100 ms guard against the pointer event that opened the menu.
	await page.waitForTimeout(150);
	await item.click();
}

export async function assertCardDetailImageEdit(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	// Large enough that the view can zoom it: it zooms up to twice its pixels.
	const original = patternPng(1200, 800);
	fs.writeFileSync(workspaceFile(IMAGE), original);
	const cardInformation = workspaceFile(`.bh/mirror/${IMAGE}`);
	const read = file => fs.existsSync(file) ? fs.readFileSync(file) : undefined;
	const recordText = () => read(path.join(cardInformation, 'edit.yaml'))?.toString() ?? '';
	try {
		// An SVG shows in its page, without an editor, and nothing says why.
		await quickOpen(page, 'concept.svg');
		await assertCardDetail(page, 'concept.svg');
		await page.locator(`${SURFACE} .basehalf-card-detail-media-webview iframe, ${SURFACE} .basehalf-card-detail-media-webview webview`).first().waitFor({ state: 'attached', timeout: 15_000 });
		if (await page.locator(CROP).count() || await page.locator(LINE).count()) {
			throw new Error('Card Detail of an SVG shows its page, without a crop view or a line.');
		}

		await quickOpen(page, IMAGE);
		await assertCardDetail(page, 'still.png');
		await waitForCrop(page);
		// At rest the frame waits for the pointer: no corner shows while it is elsewhere.
		await page.mouse.move(2, 2);
		await page.waitForTimeout(250);
		const atRest = await page.evaluate(selector => getComputedStyle(document.querySelector(`${selector} .basehalf-image-crop-corner.topLeft`)).opacity, CROP);
		if (atRest !== '0' || await lineText(page) !== '') {
			throw new Error(`The crop view of an image that was never edited shows the picture without its frame, and an empty line: ${JSON.stringify({ atRest, line: await lineText(page) })}`);
		}

		// Square is a change: the file becomes its middle 800 × 800, with nothing pressed.
		await chooseRatio(page, 'Square');
		await waitUntil(() => /\ncrop:\n {2}x: 600\n {2}y: 400\n {2}width: 800\n {2}height: 800\n/.test(recordText()), 'the square crop to be written', 30_000);
		const squared = fs.readFileSync(workspaceFile(IMAGE));
		if (JSON.stringify(pngSize(squared)) !== '[800,800]' || !read(path.join(cardInformation, 'original.png'))?.equals(original) || !squared.includes(Buffer.from('Comment\0a still', 'latin1'))) {
			throw new Error(`Square on a 1200 × 800 PNG keeps its middle 800 × 800, its original, and its text: ${JSON.stringify({ size: pngSize(squared), record: recordText() })}`);
		}
		await page.waitForFunction(selector => !!document.querySelector(`${selector} .basehalf-media-edit-line-saving`)?.parentElement?.hidden, LINE, { timeout: 15_000 });
		if (await lineText(page) !== 'Cropped to 800 × 800 | Revert to Original') {
			throw new Error(`The line under the crop view says the edit and offers Revert to Original: ${await lineText(page)}`);
		}

		// A turn and a flip are changes of the original, each its own step.
		await page.locator(`${CROP} .basehalf-image-crop-tool.turn`).click();
		await page.waitForTimeout(APART_MS);
		await page.locator(`${CROP} .basehalf-image-crop-tool.flip`).click();
		await waitUntil(() => /\nturn: 1\nflip: true\n/.test(recordText()), 'the turn and the flip to be written', 30_000);
		const turned = fs.readFileSync(workspaceFile(IMAGE));
		const turnedRecord = recordText();
		if (turned.equals(squared) || JSON.stringify(pngSize(turned)) !== '[800,800]') {
			throw new Error(`A turn and a flip are written as an edit of the original: ${turnedRecord}`);
		}

		// The wheel over the picture zooms the view and changes no edit; a double click shows the picture as it fits again.
		const view = await page.locator(`${CROP} .basehalf-image-crop-view`).boundingBox();
		await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
		await page.mouse.wheel(0, -400);
		await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('zoomed'), CROP, { timeout: 5_000 });
		await page.waitForTimeout(1_500);
		if (!fs.readFileSync(workspaceFile(IMAGE)).equals(turned) || recordText() !== turnedRecord) {
			throw new Error('The wheel zooms the view only: the file and its record stay as they were.');
		}
		await page.mouse.dblclick(view.x + view.width / 2, view.y + view.height / 2);
		await page.waitForFunction(selector => !document.querySelector(selector)?.classList.contains('zoomed'), CROP, { timeout: 5_000 });

		// Revert to Original puts the original back; undo of it brings the edit back byte for byte.
		await page.locator(`${LINE} .basehalf-media-edit-line-action.revert`).click();
		await waitUntil(() => !!read(workspaceFile(IMAGE))?.equals(original) && !fs.existsSync(path.join(cardInformation, 'edit.yaml')), 'Revert to Original to put the original PNG back', 30_000);
		await page.locator(`${CROP} .basehalf-image-crop-tool.turn`).focus();
		await page.keyboard.press(UNDO);
		await waitUntil(() => !!read(workspaceFile(IMAGE))?.equals(turned) && recordText() === turnedRecord, 'undo to bring the edit back', 30_000);

		// Escape during a drag of a corner puts the frame back and leaves Card Detail open; the next Escape closes it.
		const corner = await page.locator(`${CROP} .basehalf-image-crop-corner.topLeft`).boundingBox();
		await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
		await page.mouse.down();
		await page.mouse.move(corner.x + 30, corner.y + 30, { steps: 5 });
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await page.waitForTimeout(400);
		if (!(await page.locator(DETAIL).isVisible()) || !fs.readFileSync(workspaceFile(IMAGE)).equals(turned) || recordText() !== turnedRecord) {
			throw new Error('Escape during a drag puts the frame back and leaves Card Detail open, with no change.');
		}
		await page.keyboard.press('Escape');
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
	} finally {
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
	}
}
