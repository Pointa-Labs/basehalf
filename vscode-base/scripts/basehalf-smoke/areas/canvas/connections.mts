/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Connecting cards: the capture circles, connecting into a Note, the line kept for Create from Connection, and undo.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { AGENT_CREATED_CARD_CONTENT, AGENT_CREATED_CARD_PATH } from './agents.mts';
import { agentNoteWithUpstream, bhTreeChangesSince } from './badges.mts';
import { centerCanvasCards } from './creation.mts';
import { canvasReconnectBlankPoint, pointDistance } from './edges.mts';
import { workspacePath } from '../../context.mts';
import { readBhTree } from '../../fixture.mts';
import {
	assertCanvasEdgeGone,
	assertCanvasEdgeVisible,
	assertCanvasFolder,
	openCanvasZoomMenu,
	readCanvasCardGeometry,
	readCanvasCardPlaces,
	readCanvasView,
	startCanvasConnectionDrag,
	waitForCanvasCardSelection,
	waitForCanvasNoteInlineEditor,
	zoomCanvas
} from '../../lib/canvas.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { clickNotificationAction } from '../../lib/notifications.mts';
import { waitUntil } from '../../lib/steps.mts';
import { openExplorerRow, readWorkspaceFile } from '../../lib/workspace.mts';

// Zooms out to at most 50% and centers `cards`, so every card and its
// connection handles are inside the visible canvas.
export async function frameCanvasCardsForConnection(page, cards) {
	for (let attempt = 0; attempt < 16; attempt++) {
		const zoom = await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom').then(Number);
		if (zoom <= 0.5) {
			break;
		}
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(50);
	}
	for (const card of cards) {
		await card.waitFor({ state: 'visible', timeout: 10_000 });
	}
	for (let attempt = 0; attempt < 4; attempt++) {
		await centerCanvasCards(page, cards);
		const canvasBounds = await page.locator('.basehalf-canvas-cards').boundingBox();
		const cardBounds = await Promise.all(cards.map(card => card.boundingBox()));
		if (canvasBounds && cardBounds.every(bounds => bounds
			&& bounds.x >= canvasBounds.x - 1
			&& bounds.y >= canvasBounds.y - 1
			&& bounds.x + bounds.width <= canvasBounds.x + canvasBounds.width + 1
			&& bounds.y + bounds.height <= canvasBounds.y + canvasBounds.height + 1)) {
			return;
		}
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(50);
	}
	throw new Error('Connection fixture cards are not fully inside the visible canvas viewport');
}

// Connecting a card into an annotatable Markdown note stores the connection
// once, in the downstream note (D37): its first bytes gain an `upstream`
// frontmatter list, canvas.yaml gains only the anchor row, and nothing else
// under .bh/ changes. The first frontmatter BaseHalf adds is announced once.
export async function assertCanvasConnectIntoNote(page) {
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const note = AGENT_CREATED_CARD_PATH;
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	await frameCanvasCardsForConnection(page, [docs, noteCard]);
	const docsNode = page.locator('.react-flow__node', { has: docs });
	const noteNode = page.locator('.react-flow__node', { has: noteCard });
	const docsEast = docsNode.locator(':scope > .basehalf-canvas-card-connect-handle.east');
	const noteWest = noteNode.locator(':scope > .basehalf-canvas-card-connect-handle.west');
	await page.locator('.basehalf-canvas-cards').focus();
	await page.keyboard.press('Escape');
	await docs.click();

	if (readWorkspaceFile(note) !== AGENT_CREATED_CARD_CONTENT) {
		throw new Error(`${note} must start without frontmatter`);
	}
	const beforeCancelCanvas = fs.readFileSync(canvasPath, 'utf8');
	// A blank release opens the Create from Connection menu; Escape closes it
	// and writes nothing.
	const release = await dropCanvasConnectionOnBlank(page, 'docs');
	const cancelAction = await connectionCreateMenuAction(page, release, 'Note');
	await page.keyboard.press('Escape');
	await cancelAction.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForTimeout(150);
	if (fs.readFileSync(canvasPath, 'utf8') !== beforeCancelCanvas || readWorkspaceFile(note) !== AGENT_CREATED_CARD_CONTENT) {
		throw new Error('Expected closing the Create from Connection menu to write nothing to canvas.yaml or the note');
	}
	const draftCountAfterCancel = await page.locator('.react-flow__connection-path').count();
	if (draftCountAfterCancel !== 0) {
		throw new Error(`Expected connection draft to be removed after cancel, got ${draftCountAfterCancel}`);
	}

	const bhBeforeConnect = readBhTree();
	await docs.hover();
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="docs"] > .basehalf-canvas-card-connect-handle.east')).pointerEvents !== 'none', null, { timeout: 10_000 });
	const freshSourceBox = await docsEast.boundingBox();
	const freshTargetBox = await noteWest.boundingBox();
	if (!freshSourceBox || !freshTargetBox) {
		throw new Error('Missing React Flow handles after cancelled connection');
	}
	// Inside the outline the card keeps the pointer; press the handle's outside half.
	await page.mouse.move(freshSourceBox.x + freshSourceBox.width / 2 + 3, freshSourceBox.y + freshSourceBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(freshTargetBox.x + freshTargetBox.width / 2, freshTargetBox.y + freshTargetBox.height / 2, { steps: 8 });
	await page.waitForFunction(() => document.querySelector('.react-flow__connection-path') !== null, null, { timeout: 10_000 });
	await page.mouse.up();

	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs']), `the connection to be saved as the upstream frontmatter of ${note}`);
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"')
			&& canvas.includes('from_anchor: east')
			&& canvas.includes(`to: "${note}"`)
			&& canvas.includes('to_anchor: west');
	}, 'canvas.yaml to persist the four-side anchor row');
	await clickNotificationAction(page, `Saved this connection inside ${note}.`, 'OK');
	const bhChanges = bhTreeChangesSince(bhBeforeConnect);
	if (bhChanges.some(rel => rel !== '.bh/mirror/canvas.yaml')) {
		throw new Error(`Connecting into a note may change only its bytes and the canvas.yaml anchor row, but .bh/ also changed: ${bhChanges.join(', ')}`);
	}
}

// Connection handles capture the pointer within 24 screen pixels of their
// anchor point at every zoom: coming from outside the card shows its handles
// and snaps the near one to a 16-pixel connection-intent circle, and a drag
// from there starts a connection. The released line stays drawn while the
// Create from Connection menu is open, and Escape removes it.
export async function assertCanvasConnectionHandleCapture(page) {
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	for (const percent of [40, 100]) {
		const controller = await openCanvasZoomMenu(page);
		await controller.input.fill(`${percent}%`);
		await controller.input.press('Enter');
		await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
		const zoom = percent / 100;
		await page.waitForFunction(expected => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) === expected, zoom, { timeout: 10_000 });
		await centerCanvasCards(page, [docs]);
		await page.mouse.move(5, 5);
		// Pick a side whose outside is free: a neighbor's capture circle may cover it.
		const target = await page.evaluate(() => {
			const node = document.querySelector('.react-flow__node[data-id="docs"]');
			const rect = node?.getBoundingClientRect();
			if (!node || !rect) {
				return undefined;
			}
			const points = {
				east: { x: rect.right + 16, y: rect.top + rect.height / 2 },
				south: { x: rect.left + rect.width / 2, y: rect.bottom + 16 },
				west: { x: rect.left - 16, y: rect.top + rect.height / 2 },
				north: { x: rect.left + rect.width / 2, y: rect.top - 16 }
			};
			for (const [anchor, point] of Object.entries(points)) {
				const hit = document.elementFromPoint(point.x, point.y);
				if (hit?.matches('.basehalf-canvas-connect-capture') && hit.getAttribute('data-node-id') === 'docs' && hit.getAttribute('data-anchor') === anchor) {
					return { anchor, point };
				}
			}
			return undefined;
		});
		if (!target) {
			throw new Error(`No connection handle of docs captures a point 16 screen pixels outside its card at ${percent}%`);
		}
		await page.mouse.move(target.point.x, target.point.y, { steps: 4 });
		const snapped = await page.waitForFunction(({ anchor, zoom }) => {
			const node = document.querySelector('.react-flow__node[data-id="docs"]');
			const handle = node?.querySelector(`:scope > .basehalf-canvas-card-connect-handle.${anchor}`);
			const rest = node?.querySelector(`:scope > .basehalf-canvas-card-connect-handle:not(.${anchor})`);
			if (!handle || !rest || !handle.classList.contains('snapped') || getComputedStyle(handle).opacity !== '1' || getComputedStyle(rest).opacity !== '1') {
				return undefined;
			}
			const circle = element => {
				const style = getComputedStyle(element, '::before');
				return { diameter: parseFloat(style.width) * new DOMMatrixReadOnly(style.transform).a * zoom, background: style.backgroundColor };
			};
			const snap = circle(handle);
			const other = circle(rest);
			return Math.abs(snap.diameter - 16) <= 0.75 && Math.abs(other.diameter - 11) <= 0.75 && snap.background !== other.background
				? { snap, other }
				: undefined;
		}, { anchor: target.anchor, zoom }, { timeout: 10_000 }).catch(() => undefined);
		if (!snapped) {
			throw new Error(`The ${target.anchor} handle of docs did not snap to a 16-pixel intent circle at ${percent}%`);
		}
		await page.mouse.down();
		await page.mouse.move(target.point.x + (target.anchor === 'east' ? 12 : target.anchor === 'west' ? -12 : 0), target.point.y + (target.anchor === 'south' ? 12 : target.anchor === 'north' ? -12 : 0), { steps: 3 });
		await page.locator('.react-flow__connection-path').waitFor({ state: 'attached', timeout: 5_000 });
		const blank = await canvasReconnectBlankPoint(page, target.point);
		await page.mouse.move(blank.x, blank.y, { steps: 8 });
		await page.mouse.up();
		const cancelAction = await connectionCreateMenuAction(page, blank, 'Note');
		const dropLine = page.locator('[data-testid="canvas-connection-drop-line"]');
		if (await dropLine.count() !== 1) {
			throw new Error(`The released connection line must stay drawn while the menu is open at ${percent}%`);
		}
		const lineEnds = await dropLine.evaluate(path => {
			const ctm = path.getScreenCTM();
			const toScreen = point => {
				const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
				return { x: screen.x, y: screen.y };
			};
			return ctm ? { start: toScreen(path.getPointAtLength(0)), end: toScreen(path.getPointAtLength(path.getTotalLength())) } : undefined;
		});
		const handleCenter = await page.evaluate(anchor => {
			const rect = document.querySelector(`.react-flow__node[data-id="docs"] > .basehalf-canvas-card-connect-handle.${anchor}`)?.getBoundingClientRect();
			return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
		}, target.anchor);
		if (!lineEnds || !handleCenter || pointDistance(lineEnds.end, blank) > 2 || pointDistance(lineEnds.start, handleCenter) > 2) {
			throw new Error(`The kept connection line must run from the ${target.anchor} handle to the release point at ${percent}%: ${JSON.stringify({ lineEnds, handleCenter, release: blank })}`);
		}
		// Escape at one zoom, a click on empty canvas at the other.
		const dismissPoint = percent === 100 ? await canvasReconnectBlankPoint(page, blank) : undefined;
		await assertDropLineLeavesWithMenu(page, () => dismissPoint ? page.mouse.click(dismissPoint.x, dismissPoint.y) : page.keyboard.press('Escape'));
		await cancelAction.waitFor({ state: 'hidden', timeout: 10_000 });
		await dropLine.waitFor({ state: 'detached', timeout: 5_000 });
	}
}

// Dismisses the Create from Connection menu and checks, on the first frame
// without the menu, that the kept connection line is already gone.
async function assertDropLineLeavesWithMenu(page, dismiss) {
	const firstFrameWithoutMenu = page.evaluate(() => new Promise(resolve => {
		const check = () => {
			const action = document.querySelector('.context-view.monaco-menu-container .action-label[aria-label="Note"]');
			if (action && action.getClientRects().length > 0) {
				requestAnimationFrame(check);
				return;
			}
			const line = document.querySelector('.basehalf-canvas-connection-drop-line');
			resolve(!!line && getComputedStyle(line).display !== 'none');
		};
		requestAnimationFrame(check);
	}));
	await dismiss();
	if (await firstFrameWithoutMenu) {
		throw new Error('The kept connection line was still drawn on the first frame after the menu closed');
	}
}

// Drags a connection from `sourcePath` and releases it on empty canvas.
async function dropCanvasConnectionOnBlank(page, sourcePath) {
	const sourcePoint = await startCanvasConnectionDrag(page, sourcePath);
	const blank = await canvasReconnectBlankPoint(page, sourcePoint);
	await page.mouse.move(blank.x, blank.y, { steps: 8 });
	await page.mouse.up();
	return blank;
}

// A point on empty canvas where a released connection line opens the create
// menu: nothing is drawn there, and no card's handle is near enough to take the
// line. `where` picks the point:
// - 'rightEdge': 60 screen pixels inside the right edge of the canvas, so that
//   a card created there reaches past the edge and is partly out of sight.
// - 'besideCard': just left of a card other than `sourcePath`, level with its
//   top, so that a card created there lies on that card.
async function canvasConnectionReleasePoint(page, where, sourcePath) {
	const point = await page.evaluate(({ where, sourcePath }) => {
		const canvas = document.querySelector('.basehalf-canvas-cards')?.getBoundingClientRect();
		const pane = document.querySelector('.react-flow__pane');
		const viewport = document.querySelector('.react-flow__viewport');
		if (!canvas || !pane || !viewport) {
			throw new Error('Missing canvas for a connection release point');
		}
		const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
		const nodes = [...document.querySelectorAll('.react-flow__node')].map(node => ({ path: node.getAttribute('data-id'), rect: node.getBoundingClientRect() }));
		const handles = nodes.flatMap(({ rect }) => [
			{ x: rect.left, y: rect.top + rect.height / 2 },
			{ x: rect.right, y: rect.top + rect.height / 2 },
			{ x: rect.left + rect.width / 2, y: rect.top },
			{ x: rect.left + rect.width / 2, y: rect.bottom }
		]);
		// The connection radius is 48 canvas pixels, and a capture circle 24 screen pixels.
		const clear = (x, y) => x > canvas.left + 50 && x < canvas.right - 50 && y > canvas.top + 50 && y < canvas.bottom - 50
			&& document.elementFromPoint(x, y) === pane
			&& handles.every(handle => Math.hypot(handle.x - x, handle.y - y) > Math.max(30, 60 * zoom));
		if (where === 'rightEdge') {
			const x = Math.round(canvas.right - 60);
			for (const fraction of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
				const y = Math.round(canvas.top + (canvas.bottom - canvas.top) * fraction);
				if (clear(x, y)) {
					return { x, y };
				}
			}
			return undefined;
		}
		for (const { path, rect } of nodes) {
			const x = Math.round(rect.left - 40 * zoom);
			const y = Math.round(rect.top - 10 * zoom);
			if (path !== sourcePath && clear(x, y)) {
				return { x, y, beside: path };
			}
		}
		return undefined;
	}, { where, sourcePath });
	if (!point) {
		throw new Error(`No empty canvas point to release a connection line at: ${where}`);
	}
	return point;
}

// Drags a connection from `sourcePath` and releases it at `point`. Returns the
// release point on screen and in canvas coordinates, and the view it was
// released in.
async function dropCanvasConnectionAt(page, sourcePath, point) {
	await startCanvasConnectionDrag(page, sourcePath);
	await page.mouse.move(point.x, point.y, { steps: 8 });
	const view = await readCanvasView(page);
	await page.mouse.up();
	return { screen: { x: point.x, y: point.y }, canvas: { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom }, view };
}

// A card created from a connection line is where the line was released: the
// middle of its west side is at the release point, also when the card reaches
// past the edge of the window or into another card. Nothing else moves for
// it: no other card, and not the view, which is the user's to move (canvas
// card placement, criteria 34 and 35).
async function assertCanvasCardCreatedWhereLineWasReleased(page, canvasPath, cardPath, drop, otherRows) {
	const screenPixel = 1 / drop.view.zoom + 0.01;
	const released = candidate => candidate !== undefined
		&& Math.abs(candidate.x - drop.canvas.x) <= screenPixel && Math.abs(candidate.y + candidate.height / 2 - drop.canvas.y) <= screenPixel;
	// A drawing between the new file and its row can save another place for a
	// moment, so the row is read until it is the card's own.
	let row;
	const deadline = Date.now() + 10_000;
	while (!released(row = readCanvasCardGeometry(fs.readFileSync(canvasPath, 'utf8'), cardPath))) {
		if (Date.now() > deadline) {
			throw new Error(`${cardPath} must be where its line was released: ${JSON.stringify({ row, released: drop.canvas })}`);
		}
		await page.waitForTimeout(50);
	}
	const raw = fs.readFileSync(canvasPath, 'utf8');
	const moved = Object.entries(otherRows).filter(([otherPath, before]) => before !== undefined && JSON.stringify(readCanvasCardGeometry(raw, otherPath)) !== JSON.stringify(before)).map(([otherPath]) => otherPath);
	if (moved.length > 0) {
		throw new Error(`Creating ${cardPath} must not change another card's row: ${moved.join(', ')}`);
	}
	// What is drawn is what is stored.
	const drawnBy = Date.now() + 10_000;
	for (; ;) {
		const drawn = (await readCanvasCardPlaces(page, [cardPath]))[cardPath];
		if (Math.abs(drawn.x - row.x) <= 1 && Math.abs(drawn.y - row.y) <= 1) {
			break;
		}
		if (Date.now() > drawnBy) {
			throw new Error(`${cardPath} must be drawn where its row says: ${JSON.stringify({ drawn, row })}`);
		}
		await page.waitForTimeout(50);
	}
	// The view stays where the user had it, after everything the create starts has run.
	await page.waitForTimeout(500);
	const view = await readCanvasView(page);
	if (Math.abs(view.x - drop.view.x) > 0.5 || Math.abs(view.y - drop.view.y) > 0.5 || Math.abs(view.zoom - drop.view.zoom) > 0.001) {
		throw new Error(`Creating ${cardPath} must not move the view: ${JSON.stringify({ before: drop.view, after: view })}`);
	}
	return row;
}

// The Create from Connection menu item `label`, after checking the menu opened
// at the release point and not as Quick Input.
async function connectionCreateMenuAction(page, release, label) {
	const action = page.locator(`.context-view.monaco-menu-container .action-label[aria-label="${label}"]`).last();
	await action.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.quick-input-widget').isVisible()) {
		throw new Error('Create from Connection opened Quick Input instead of the canvas create menu');
	}
	const menu = await page.locator('.context-view.monaco-menu-container').last().boundingBox();
	if (!menu) {
		throw new Error('Missing Create from Connection menu geometry');
	}
	const nearest = {
		x: Math.min(Math.max(release.x, menu.x), menu.x + menu.width),
		y: Math.min(Math.max(release.y, menu.y), menu.y + menu.height)
	};
	if (pointDistance(nearest, release) > 32) {
		throw new Error(`Create from Connection menu opened at ${JSON.stringify(menu)}, away from the release point ${JSON.stringify(release)}`);
	}
	// VS Code attaches menu mouse-up listeners after a 100 ms guard against the
	// pointer event that opened the menu.
	await page.waitForTimeout(150);
	return action;
}

// Create from Connection: each item creates a card that lists the source as
// upstream (D37), draws the edge, and leaves the source unchanged. Image,
// Video, and Audio make a draft (generation cards, criteria 2 and 80): its
// generation.yaml, its upstream.yaml with the source, and no file. A created
// draft, its card, and its edge go away in one canvas undo step. The card is
// where the line was released, and the view stays where it is.
export async function assertCanvasCreateFromConnection(page) {
	const source = 'README.md';
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const notePath = path.join(workspacePath, 'untitled.md');
	if (fs.existsSync(notePath)) {
		throw new Error('Create from Connection needs a canvas without untitled.md');
	}
	const readme = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${source}"]`);
	await frameCanvasCardsForConnection(page, [readme]);
	await page.locator('.basehalf-canvas-cards').focus();
	await page.keyboard.press('Escape');
	const sourceBefore = readWorkspaceFile(source);
	const rowsOfShownCards = async () => {
		const raw = fs.readFileSync(canvasPath, 'utf8');
		const shown = await page.locator('.basehalf-canvas-card[data-basehalf-card-path]').evaluateAll(cards => cards.map(card => card.getAttribute('data-basehalf-card-path')));
		return Object.fromEntries(shown.map(cardPath => [cardPath, readCanvasCardGeometry(raw, cardPath)]));
	};

	for (const [label, kind, pattern] of [['Image', 'image', /^image(-\d+)?\.png$/], ['Video', 'video', /^video(-\d+)?\.mp4$/], ['Audio', 'audio', /^audio(-\d+)?\.mp3$/]]) {
		// A new draft takes the first default name that no file, folder, or draft has.
		const mirror = name => path.join(workspacePath, '.bh', 'mirror', name);
		const drafts = () => fs.readdirSync(path.join(workspacePath, '.bh', 'mirror')).filter(name => pattern.test(name) && fs.existsSync(path.join(mirror(name), 'generation.yaml')));
		const draftsBefore = new Set(drafts());
		// Released near the right edge of the canvas: the card reaches past it.
		const rowsBefore = await rowsOfShownCards();
		const drop = await dropCanvasConnectionAt(page, source, await canvasConnectionReleasePoint(page, 'rightEdge', source));
		await (await connectionCreateMenuAction(page, drop.screen, label)).click();
		let draft;
		await waitUntil(() => (draft = drafts().find(name => !draftsBefore.has(name))) !== undefined, `Create from Connection to make a draft of ${kind}`);
		const row = await assertCanvasCardCreatedWhereLineWasReleased(page, canvasPath, draft, drop, rowsBefore);
		if ((row.x + row.width) * drop.view.zoom + drop.view.x <= drop.view.canvas.right) {
			throw new Error(`The line must be released where the card reaches past the right edge of the canvas: ${JSON.stringify({ row, view: drop.view })}`);
		}
		const upstream = fs.readFileSync(path.join(mirror(draft), 'upstream.yaml'), 'utf8');
		if (fs.existsSync(path.join(workspacePath, draft)) || !/^prompt: ""\n/.test(fs.readFileSync(path.join(mirror(draft), 'generation.yaml'), 'utf8'))
			|| upstream.split(/\r?\n/).filter(line => line.trim()).join('|') !== `upstream:|  - ${source}`) {
			throw new Error(`Create from Connection must make a draft of ${kind} that lists ${source} as its input, with no file: ${JSON.stringify({ draft, upstream, files: fs.readdirSync(mirror(draft)) })}`);
		}
		const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${draft}"]`);
		if (await card.getAttribute('data-generation') !== 'draft' || await card.getAttribute('data-generation-kind') !== kind) {
			throw new Error(`The card of ${draft} must be a draft of ${kind}`);
		}
		await assertCanvasEdgeVisible(page, source, draft);
		// The new edge replaces the line kept while the menu was open.
		await page.locator('[data-testid="canvas-connection-drop-line"]').waitFor({ state: 'detached', timeout: 5_000 });
		await waitForCanvasCardSelection(page, draft);
		await waitUntil(() => fs.readFileSync(canvasPath, 'utf8').includes(`to: "${draft}"`), 'canvas.yaml to remember the anchors of the created edge');
		await readme.focus();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
		await waitUntil(() => !fs.existsSync(mirror(draft)), `one canvas undo to remove the created ${draft} with its card information`, 15_000);
		await assertCanvasEdgeGone(page, source, draft);
		await card.waitFor({ state: 'detached', timeout: 10_000 });
	}

	// Released just beside another card: the note lies on that card.
	const rowsBeforeNote = await rowsOfShownCards();
	const notePoint = await canvasConnectionReleasePoint(page, 'besideCard', source);
	const noteDrop = await dropCanvasConnectionAt(page, source, notePoint);
	await (await connectionCreateMenuAction(page, noteDrop.screen, 'Note')).click();
	await waitUntil(() => fs.existsSync(notePath), 'Create from Connection to create untitled.md');
	const noteRow = await assertCanvasCardCreatedWhereLineWasReleased(page, canvasPath, 'untitled.md', noteDrop, rowsBeforeNote);
	const besideRow = rowsBeforeNote[notePoint.beside];
	if (!besideRow || noteRow.x >= besideRow.x + besideRow.width || besideRow.x >= noteRow.x + noteRow.width
		|| noteRow.y >= besideRow.y + besideRow.height || besideRow.y >= noteRow.y + noteRow.height) {
		throw new Error(`The note released beside ${notePoint.beside} must lie on it: ${JSON.stringify({ noteRow, besideRow })}`);
	}
	const noteText = readWorkspaceFile('untitled.md');
	if (noteText !== `---\nupstream:\n  - ${source}\n---\n`) {
		throw new Error(`Create from Connection note must start with only its upstream frontmatter, got ${JSON.stringify(noteText)}`);
	}
	const editor = await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await assertCanvasEdgeVisible(page, source, 'untitled.md');
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
	fs.rmSync(notePath, { force: true });
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="untitled.md"]').waitFor({ state: 'detached', timeout: 10_000 });
	if (readWorkspaceFile(source) !== sourceBefore) {
		throw new Error('Create from Connection changed the source card instead of only the new node');
	}
}

// Canvas undo of a connection after the note was opened and closed again:
// the undo step re-resolves the note and removes exactly its entry, leaving the
// note's original bytes; redo writes the entry back. The anchor row stays.
export async function assertCanvasUndoAfterClosingNote(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const connected = agentNoteWithUpstream(['docs']);
	if (readWorkspaceFile(note) !== connected) {
		throw new Error(`${note} must hold the docs connection before canvas undo`);
	}
	await openExplorerRow(page, note);
	await assertCardDetail(page, note);
	await closeCardDetailIfOpen(page);
	await assertCanvasFolder(page, '');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await docs.waitFor({ state: 'visible', timeout: 10_000 });
	const undoKey = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
	const redoKey = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
	await docs.focus();
	await page.keyboard.press(undoKey);
	await waitUntil(() => readWorkspaceFile(note) === AGENT_CREATED_CARD_CONTENT, `canvas undo to remove the docs entry from ${note} after it was closed`, 15_000);
	await assertCanvasEdgeGone(page, 'docs', note);
	if (!fs.readFileSync(canvasPath, 'utf8').includes(`to: "${note}"`)) {
		throw new Error('Canvas undo of a connection removed its anchor row');
	}
	await docs.focus();
	await page.keyboard.press(redoKey);
	await waitUntil(() => readWorkspaceFile(note) === connected, `canvas redo to write the docs entry back into ${note}`, 15_000);
	await assertCanvasEdgeVisible(page, 'docs', note);
	// Leave docs centered at 100%, where the card drag and resize checks run.
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) >= 0.5, null, { timeout: 10_000 });
	await centerCanvasCards(page, [docs]);
}
