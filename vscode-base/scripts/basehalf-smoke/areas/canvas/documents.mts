/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The cards of a PDF and a book: their cover at one size, and Hide Cover and Show Cover (PDFs and books).

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { readBhTree } from '../../fixture.mts';
import { assertCanvasFolder, emptyCanvasPoint, openRootCanvas, readCanvasCardGeometry, waitForCanvasCardSelection, zoomCanvas } from '../../lib/canvas.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitForReading } from '../../lib/steps.mts';

const PDF_CARD = 'docs/textbook.pdf';
const BOOK_CARD = 'docs/primer.epub';
const PDF_APPEARANCE = path.join(workspacePath, '.bh', 'mirror', 'docs', 'textbook.pdf', 'appearance.yaml');

function documentCard(page, cardPath) {
	return page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
}

async function openDocsCanvas(page) {
	await quickOpen(page, 'docs');
	await assertCanvasFolder(page, 'docs');
	await zoomCanvas(page, 'fit');
}

/** What the face of a document card shows: its cover, once the picture is drawn, its grey face, or nothing yet. */
function readFace(page, cardPath) {
	return documentCard(page, cardPath).evaluate(card => {
		const face = card.querySelector('.basehalf-canvas-card-document');
		const image = face?.querySelector('img.basehalf-canvas-card-document-cover');
		return {
			state: face?.getAttribute('data-cover'),
			drawn: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
			label: face?.querySelector('.basehalf-canvas-card-media-fallback-label')?.textContent?.trim()
		};
	});
}

function waitForFace(page, cardPath, state) {
	return waitForReading(() => readFace(page, cardPath), face => face.state === state && (state !== 'cover' || face.drawn), `the card of ${cardPath} to show its ${state}`, 20_000);
}

/**
 * Criteria 1, 5, and 6: a PDF and a book are 300 × 400 cards that show their
 * cover, the landscape first page whole in the middle of its card; a selected
 * one has no corner that resizes it; and showing them writes nothing under
 * `.bh/` but the places of the cards.
 */
export async function assertDocumentCardsShowCovers(page) {
	const before = readBhTree();
	await openDocsCanvas(page);
	for (const cardPath of [PDF_CARD, BOOK_CARD]) {
		await documentCard(page, cardPath).waitFor({ state: 'visible', timeout: 15_000 });
		await waitForFace(page, cardPath, 'cover');
	}
	const raw = await waitForReading(
		() => fs.readFileSync(path.join(workspacePath, '.bh', 'mirror', 'docs', 'canvas.yaml'), 'utf8'),
		text => [PDF_CARD, BOOK_CARD].every(cardPath => readCanvasCardGeometry(text, cardPath)),
		'the places of the document cards'
	);
	for (const cardPath of [PDF_CARD, BOOK_CARD]) {
		const geometry = readCanvasCardGeometry(raw, cardPath);
		if (geometry?.width !== 300 || geometry?.height !== 400) {
			throw new Error(`${cardPath} is not a card of 300 × 400: ${JSON.stringify(geometry)}`);
		}
	}
	// Covers are kept in the application's data folder, never in the workspace.
	// Opening the folder places its new cards, and the record for agents says what is shown.
	const after = readBhTree();
	const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
		.filter(entry => before[entry] !== after[entry] && entry !== '.bh/mirror/docs/canvas.yaml' && !entry.startsWith('.bh/cache/'));
	if (changed.length > 0) {
		throw new Error(`Showing documents changed ${changed.join(', ')} under .bh/`);
	}
	const page1 = await documentCard(page, PDF_CARD).evaluate(card => {
		const frame = card.querySelector('.basehalf-canvas-card-document').getBoundingClientRect();
		const cover = card.querySelector('img.basehalf-canvas-card-document-cover').getBoundingClientRect();
		return { ratio: cover.width / cover.height, above: cover.top - frame.top, below: frame.bottom - cover.bottom };
	});
	// The fixture's page is 300 × 200 points.
	if (Math.abs(page1.ratio - 1.5) > 0.05 || Math.abs(page1.above - page1.below) > 2) {
		throw new Error(`The landscape first page is not whole in the middle of its card: ${JSON.stringify(page1)}`);
	}

	const card = documentCard(page, PDF_CARD);
	await card.click();
	await waitForCanvasCardSelection(page, PDF_CARD);
	const corners = await card.evaluate(element => [...element.closest('.react-flow__node').querySelectorAll('.basehalf-canvas-node-resizer-handle')]
		.filter(handle => handle.getClientRects().length > 0 && getComputedStyle(handle).visibility !== 'hidden').length);
	if (corners > 0) {
		throw new Error(`A selected PDF card shows ${corners} corners that resize it`);
	}
	const empty = await emptyCanvasPoint(page);
	await page.mouse.click(empty.x, empty.y);
}

/**
 * Criterion 3: Hide Cover shows the grey face of a PDF in the same frame,
 * writes `cover: hidden`, and the card is still grey when the canvas is drawn
 * again; Show Cover brings the page back.
 */
export async function assertDocumentCoverHidesAndShows(page) {
	const card = documentCard(page, PDF_CARD);
	const frame = await card.boundingBox();
	await card.hover();
	await card.locator('.basehalf-canvas-card-cover-toggle[aria-label="Hide the cover of textbook.pdf"]').click();
	const hidden = await waitForFace(page, PDF_CARD, 'face');
	if (hidden.label !== 'PDF document') {
		throw new Error(`The grey face of a PDF says ${JSON.stringify(hidden.label)}`);
	}
	const hiddenFrame = await card.boundingBox();
	if (!frame || !hiddenFrame || ['x', 'y', 'width', 'height'].some(key => Math.abs(frame[key] - hiddenFrame[key]) > 0.5)) {
		throw new Error(`Hide Cover changed the frame of the card: ${JSON.stringify({ frame, hiddenFrame })}`);
	}
	await waitForReading(() => fs.existsSync(PDF_APPEARANCE) ? fs.readFileSync(PDF_APPEARANCE, 'utf8') : '', text => text === 'cover: hidden\n', 'Hide Cover to write cover: hidden');

	await openRootCanvas(page);
	await openDocsCanvas(page);
	await waitForFace(page, PDF_CARD, 'face');
	await card.hover();
	await card.locator('.basehalf-canvas-card-cover-toggle[aria-label="Show the cover of textbook.pdf"]').click();
	await waitForFace(page, PDF_CARD, 'cover');
	await waitForReading(() => fs.readFileSync(PDF_APPEARANCE, 'utf8'), text => text === 'cover: shown\n', 'Show Cover to write cover: shown');
	await openRootCanvas(page);
}
