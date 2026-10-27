/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The frame viewer follows a handle held against its edge (editing media, criterion 23, D98): a 6 s video in Card
// Detail, Edit, its start handle held until the viewer spreads out around it, then the pointer held 12 px inside the
// strip's right edge, where the spread moves along with the handle 24 px inside the edge, then 40 px inside, where
// both stop.

import fs from 'fs';
import path from 'path';
import { root, workspacePath } from '../../context.mts';
import { assertCardDetail, enterEditing } from '../../lib/cardDetail.mts';
import { quickOpen } from '../../lib/quickInput.mts';

const FOLDER = 'edge';
const VIDEO = `${FOLDER}/long.mp4`;
const FRAMES = '.basehalf-card-detail-surface.active .basehalf-video-frames';
const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';

export async function assertCardDetailVideoEdgeFollow(page) {
	const folder = path.join(workspacePath, FOLDER);
	fs.mkdirSync(folder, { recursive: true });
	fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-6s-mock.mp4'), path.join(folder, 'long.mp4'));
	try {
		await quickOpen(page, VIDEO);
		await assertCardDetail(page, 'long.mp4');
		await page.locator(`${FRAMES}.viewing`).waitFor({ state: 'visible', timeout: 15_000 });
		await enterEditing(page);
		await page.locator(`${FRAMES}:not(.viewing) .basehalf-video-frames-handle.start`).waitFor({ state: 'visible', timeout: 10_000 });
		const strip = await page.locator(`${FRAMES} .basehalf-video-frames-strip`).boundingBox();
		const handle = await page.locator(`${FRAMES} .basehalf-video-frames-handle.start`).boundingBox();
		// Every frame while the handle is held: its time, where its time lies on the screen, and whether the viewer is spread.
		await page.evaluate(selector => {
			const samples = [];
			globalThis.basehalfEdgeSamples = samples;
			const tick = () => {
				const frames = document.querySelector(selector);
				const start = frames?.querySelector('.basehalf-video-frames-handle.start');
				if (!frames || !start || !globalThis.basehalfEdgeSamples) {
					return;
				}
				samples.push({ time: Number(start.getAttribute('aria-valuenow')), edge: start.getBoundingClientRect().right, spread: frames.classList.contains('spread') });
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		}, FRAMES);
		const y = handle.y + handle.height / 2;
		await page.mouse.move(handle.x + handle.width / 2, y);
		await page.mouse.down();
		await page.mouse.move(handle.x + handle.width / 2 + 6, y, { steps: 2 });
		// Held still for 0.4 s, the viewer spreads out around the handle: 2 s of the 6 s.
		await page.waitForTimeout(700);
		await page.mouse.move(strip.x + strip.width - 12, y, { steps: 10 });
		await page.waitForTimeout(200);
		const arrived = await page.evaluate(() => globalThis.basehalfEdgeSamples.length);
		await page.waitForTimeout(2000);
		const held = await page.evaluate(() => globalThis.basehalfEdgeSamples.length);
		await page.mouse.move(strip.x + strip.width - 40, y, { steps: 3 });
		await page.waitForTimeout(300);
		const back = await page.evaluate(() => globalThis.basehalfEdgeSamples.length);
		await page.waitForTimeout(800);
		const samples = await page.evaluate(() => {
			const all = globalThis.basehalfEdgeSamples;
			globalThis.basehalfEdgeSamples = undefined;
			return all;
		});
		await page.mouse.up();
		const right = strip.x + strip.width;
		const atEdge = samples.slice(arrived, held);
		const stopped = samples.slice(back);
		const distances = atEdge.map(sample => right - sample.edge).sort((a, b) => a - b);
		const seen = {
			spread: atEdge.every(sample => sample.spread),
			from: atEdge[0]?.time,
			to: atEdge.at(-1)?.time,
			// The handle's time lies at the margin's inner side, 24 px inside the edge, give or take half a frame of the
			// video (18 px for a frame of 1/30 s in a spread of 2 s): never at the pointer, 12 px inside.
			closest: Math.round(distances[0]),
			middle: Math.round(distances[Math.floor(distances.length / 2)]),
			stoppedFrom: stopped[0]?.time,
			stoppedTo: stopped.at(-1)?.time
		};
		if (!seen.spread || !(seen.to > seen.from + 0.3) || !(seen.to > 2.2) || seen.closest <= 12 || seen.middle < 16 || seen.middle > 32
			|| Math.abs(seen.stoppedTo - seen.stoppedFrom) > 0.001) {
			throw new Error(`Held 12 px inside the strip's edge, the spread moves along, the handle at the margin's inner side, and 40 px inside both stop: ${JSON.stringify(seen)}`);
		}
		await page.keyboard.press(UNDO);
	} finally {
		fs.rmSync(folder, { recursive: true, force: true });
	}
}
