/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Going to things: Quick Text Search with the rich reveal, folders as canvases, and breadcrumbs.

import path from 'path';
import { zoomCanvas } from '../../lib/canvas.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';

export async function assertCanvasContainsCard(page, path) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
	if (await card.isVisible({ timeout: 2_000 }).catch(() => false)) {
		return;
	}
	for (let attempt = 0; attempt < 8; attempt++) {
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		if (await card.isVisible({ timeout: 500 }).catch(() => false)) {
			return;
		}
	}
	const canvas = page.locator('.basehalf-canvas-cards');
	for (let attempt = 0; attempt < 8; attempt++) {
		const bounds = await canvas.boundingBox();
		if (!bounds) {
			break;
		}
		const startX = bounds.x + bounds.width / 2;
		const startY = bounds.y + bounds.height / 2;
		await page.mouse.move(startX, startY);
		await page.mouse.down({ button: 'middle' });
		await page.mouse.move(bounds.x + bounds.width - 16, bounds.y + bounds.height - 16, { steps: 8 });
		await page.mouse.up({ button: 'middle' });
		if (await card.isVisible({ timeout: 500 }).catch(() => false)) {
			return;
		}
	}
	await card.waitFor({ state: 'visible', timeout: 20_000 });
}

export async function assertCanvasBreadcrumbsRemoved(page) {
	const count = await page.locator('.basehalf-breadcrumb').count();
	if (count !== 0) {
		throw new Error(`Expected BaseHalf breadcrumbs to be removed, found ${count}`);
	}
}

// Search navigation reveals the matched block in the rich projection: the
// block holding the needle carries the transient reveal highlight.
export async function assertMarkdownRichRevealsText(page, needle) {
	const frame = await activeMarkdownRichFrame(page);
	await frame.waitForFunction(text => Array.from(document.querySelectorAll('.basehalf-markdown-rich-selection-reveal'))
		.some(block => block.textContent?.includes(text)), needle, { timeout: 10_000 });
}
