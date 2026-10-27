/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The card of an image on the canvas shows an edit that Card Detail was closed on before its write landed (canvas card placement, criterion 40).

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, openRootCanvas } from '../../lib/canvas.mts';
import { assertCardDetail } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { chooseRatio, patternPng, waitForCrop } from './imageEdit.mts';

const FOLDER = 'edits';
const IMAGE = `${FOLDER}/photo.png`;
const DETAIL = '.basehalf-card-detail.visible';

function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

/** The size of the PNG on disk, or nothing while a write has moved it aside. */
function pngSizeOnDisk() {
	try {
		const bytes = fs.readFileSync(workspaceFile(IMAGE));
		return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
	} catch {
		return undefined;
	}
}

/** What the card of the image shows: the size of its picture and the ratio of the card. */
function readCard(cardPath) {
	const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
	const image = card?.querySelector('img.basehalf-canvas-card-media-visual');
	const rect = card?.getBoundingClientRect();
	return {
		picture: image?.complete ? `${image.naturalWidth}x${image.naturalHeight}` : undefined,
		ratio: rect ? Math.round(rect.width / rect.height * 100) / 100 : undefined
	};
}

/** Waits until the card shows a picture of `picture`, and has `ratio` when one is given. The window allows no code from text, so the reading is written out here again. */
function waitForCard(page, picture, ratio, timeout) {
	return page.waitForFunction(({ cardPath, picture, ratio }) => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
		const image = card?.querySelector('img.basehalf-canvas-card-media-visual');
		const rect = card?.getBoundingClientRect();
		return !!image?.complete && `${image.naturalWidth}x${image.naturalHeight}` === picture
			&& (ratio === undefined || (!!rect && Math.round(rect.width / rect.height * 100) / 100 === ratio));
	}, { cardPath: IMAGE, picture, ratio }, { timeout });
}

/** Records on every frame what the card of the image shows: its picture, or the cover that stands in for it, and its ratio. */
function startCardSampler(page) {
	return page.evaluate(cardPath => {
		const sampler = { running: true, frames: [] };
		globalThis.basehalfEditOnCardSampler = sampler;
		const tick = () => {
			if (!sampler.running) {
				return;
			}
			const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
			const image = card?.querySelector('img.basehalf-canvas-card-media-visual');
			const rect = card?.getBoundingClientRect();
			sampler.frames.push({
				picture: card?.querySelector('.basehalf-canvas-card-picture-cover') ? 'cover' : image?.complete && image.naturalWidth > 0 ? `${image.naturalWidth}x${image.naturalHeight}` : 'none',
				ratio: rect ? Math.round(rect.width / rect.height * 100) / 100 : undefined
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, IMAGE);
}

function stopCardSampler(page) {
	return page.evaluate(() => {
		const sampler = globalThis.basehalfEditOnCardSampler;
		sampler.running = false;
		return sampler.frames;
	});
}

export async function assertCardDetailEditShowsOnItsCard(page) {
	fs.mkdirSync(workspaceFile(FOLDER), { recursive: true });
	// A new file each run: the edit is the first one of the file, which writes its original beside it.
	fs.writeFileSync(workspaceFile(IMAGE), patternPng(1200, 800));
	try {
		await quickOpen(page, FOLDER);
		await assertCanvasFolder(page, FOLDER);
		const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${IMAGE}"]`);
		await card.waitFor({ state: 'visible', timeout: 15_000 });
		await waitForCard(page, '1200x800', undefined, 15_000);
		await card.dblclick();
		await assertCardDetail(page, 'photo.png');
		await waitForCrop(page);
		await chooseRatio(page, '16:9');
		// Closed at once, before the rest after a change: the write lands on the canvas.
		await startCardSampler(page);
		await page.locator('.basehalf-card-detail-close').click();
		await page.locator(DETAIL).waitFor({ state: 'hidden', timeout: 10_000 });
		await waitUntil(() => pngSizeOnDisk() === '1200x675', 'the 16:9 crop to be written', 30_000);
		try {
			await waitForCard(page, '1200x675', 1.78, 10_000);
		} catch {
			throw new Error(`The card shows the version that the edit wrote, 1200 × 675 at 16:9: ${JSON.stringify(await page.evaluate(readCard, IMAGE))}`);
		}
		// On every frame the card shows a picture, and the new one only in its new shape.
		await page.waitForTimeout(300);
		const frames = await stopCardSampler(page);
		const withoutPicture = frames.filter(frame => frame.picture === 'none').length;
		const newInOldShape = frames.filter(frame => frame.picture === '1200x675' && frame.ratio !== 1.78).length;
		if (withoutPicture > 0 || newInOldShape > 0) {
			throw new Error(`Of ${frames.length} frames, ${withoutPicture} showed the card without a picture and ${newInOldShape} the new picture in the old shape.`);
		}
	} finally {
		await openRootCanvas(page).catch(() => undefined);
		fs.rmSync(workspaceFile(FOLDER), { recursive: true, force: true });
		fs.rmSync(workspaceFile(`.bh/mirror/${FOLDER}`), { recursive: true, force: true });
	}
}
