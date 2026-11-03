/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Notes on the canvas at rest: their Markdown, scrolling a long one, and a list a Note cannot hold.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { closeCanvasBadgeFace, openCanvasBadgeFace } from './badges.mts';
import { frameCanvasCardsForConnection } from './connections.mts';
import { centerCanvasCards } from './creation.mts';
import { waitForViewTransitions } from '../../app.mts';
import { root, workspacePath } from '../../context.mts';
import { createMinimalPdfFixture, createSilentWav, createSolidPng } from '../../fixture.mts';
import { restoreSystemAppearance, showSystemAppearance } from '../../lib/appearance.mts';
import {
	assertCanvasEdgeVisible,
	assertCanvasFolder,
	canvasNoteInlineEditor,
	emptyCanvasPoint,
	openRootCanvas,
	waitForCanvasCardSelection,
	waitForCanvasNoteInlineEditor,
	zoomCanvas
} from '../../lib/canvas.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { withTheSystemBrowserStoodIn } from '../../lib/opener.mts';
import { drawnColor } from '../../lib/png.mts';
import { visibleQuickInput } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';
import { readWorkspaceFile } from '../../lib/workspace.mts';

/**
 * Canvas wheel gestures: a scroll that starts on a long note at rest moves
 * the note, a scroll that starts on the canvas keeps moving the canvas over
 * the note and over its editor, and the note keeps its place.
 */
export async function assertCanvasNoteWheelScroll(page) {
	const folderName = 'scrolled';
	const longPath = `${folderName}/long.md`;
	const longFile = path.join(workspacePath, folderName, 'long.md');
	const longNote = paragraphs => [
		'# Long',
		'',
		...Array.from({ length: paragraphs }, (_, index) => `Paragraph ${index + 1} of a note that is longer than its card, with enough words to fill a line or two.\n`)
	].join('\n');
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}/${name}"]`);
	const state = cardPath => page.evaluate(target => {
		const element = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === target);
		const note = element?.querySelector('.bh-md-preview');
		const viewport = document.querySelector('.react-flow__viewport');
		return {
			scrollTop: note instanceof HTMLElement ? note.scrollTop : undefined,
			overflow: note instanceof HTMLElement ? note.scrollHeight - note.clientHeight : undefined,
			editorScrollTop: element?.querySelector('.basehalf-canvas-note-editor.ready .basehalf-canvas-markdown-inline')?.scrollTop,
			text: note?.textContent ?? '',
			// The note drawn before its file changed carries this mark; a redrawn note does not.
			marked: note instanceof HTMLElement && note.dataset.smokeDrawnBefore === 'true',
			viewport: viewport instanceof HTMLElement ? getComputedStyle(viewport).transform : undefined
		};
	}, cardPath);
	// Waits until the card is as described, and checks that it stays so.
	const settled = async (cardPath, description, predicate) => {
		const deadline = Date.now() + 10_000;
		let last;
		do {
			last = await state(cardPath);
			if (predicate(last)) {
				await page.waitForTimeout(300);
				last = await state(cardPath);
				if (predicate(last)) {
					return last;
				}
			}
			await page.waitForTimeout(50);
		} while (Date.now() < deadline);
		throw new Error(`${description}: ${JSON.stringify({ ...last, text: last.text.length })}`);
	};
	// A scroll that starts on empty canvas and whose later events are delivered
	// to `selector`, as they are once the canvas has brought it under the
	// pointer. The events are sent in one task, so the quiet time cannot pass
	// between them however busy the machine is.
	const canvasGestureOver = async selector => {
		await page.waitForTimeout(600);
		const sent = await page.evaluate(targetSelector => {
			const pane = document.querySelector('.basehalf-canvas-cards .react-flow__pane');
			const target = document.querySelector(targetSelector);
			if (!(pane instanceof HTMLElement) || !(target instanceof HTMLElement)) {
				return false;
			}
			const wheel = element => {
				const box = element.getBoundingClientRect();
				element.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true }));
			};
			wheel(pane);
			for (let index = 0; index < 5; index++) {
				wheel(target);
			}
			return true;
		}, selector);
		if (!sent) {
			throw new Error(`The canvas gesture found no ${selector}`);
		}
		// The gesture ends, and the canvas reports its pan as ended.
		await page.waitForTimeout(600);
	};
	const middleOf = async name => {
		const box = await card(name).boundingBox();
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};

	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'fits.md'), '# Fits\n\nA note that fits its card.\n', 'utf8');
	fs.writeFileSync(longFile, longNote(40), 'utf8');
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	await card('long.md').waitFor({ state: 'visible', timeout: 15_000 });
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [card('long.md')]);
	const rest = await settled(longPath, 'A long note at rest must hold more than its card shows', now => now.scrollTop === 0 && now.overflow > 400);

	// The pointer is moved onto the note: a scroll moves the note and not the canvas.
	const first = await middleOf('long.md');
	await page.mouse.move(first.x, first.y);
	await page.mouse.wheel(0, 60);
	const scrolled = await settled(longPath, 'A scroll on a long note that the pointer was moved onto must move the note and not the canvas', now => now.scrollTop === 60 && now.viewport === rest.viewport);

	// The box that cuts the text of the scrolled note is the card content: no band without text is left under the outline.
	const cut = await card('long.md').evaluate(element => {
		const body = element.querySelector('.basehalf-canvas-card-body')?.getBoundingClientRect();
		const note = element.querySelector('.bh-md-preview')?.getBoundingClientRect();
		return body && note ? { top: note.top - body.top, bottom: body.bottom - note.bottom } : undefined;
	});
	if (!cut || Math.abs(cut.top) > 0.5 || Math.abs(cut.bottom) > 0.5) {
		throw new Error(`The text of a scrolled note must be cut at the top and the bottom of the card content: ${JSON.stringify(cut)}`);
	}

	// A scroll that starts on the canvas keeps moving the canvas when its events reach the note.
	await canvasGestureOver(`.basehalf-canvas-card[data-basehalf-card-path="${longPath}"] .bh-md-preview`);
	const panned = await state(longPath);
	if (panned.scrollTop !== 60 || panned.viewport === scrolled.viewport) {
		throw new Error(`A scroll that starts on the canvas must keep moving the canvas over a long note: ${JSON.stringify({ scrolled: scrolled.viewport, panned: panned.viewport, scrollTop: panned.scrollTop })}`);
	}

	// The pan has ended. The next scroll starts on the note and moves it.
	const second = await middleOf('long.md');
	await page.mouse.move(second.x, second.y);
	await page.mouse.wheel(0, 50);
	const pannedOn = await settled(longPath, 'A scroll that starts on a long note after a pan has ended must move the note', now => now.scrollTop === 110 && now.viewport === panned.viewport);

	// A note that fits its card has nothing to scroll: the canvas moves.
	const fits = await middleOf('fits.md');
	await page.mouse.move(fits.x, fits.y);
	await page.waitForTimeout(400);
	await page.mouse.wheel(0, 30);
	await settled(`${folderName}/fits.md`, 'A scroll on a note that fits its card must move the canvas', now => now.scrollTop === 0 && now.viewport !== pannedOn.viewport);

	// The note keeps its place when it is selected, deselected, and redrawn.
	const selectAt = await middleOf('long.md');
	await page.mouse.click(selectAt.x, selectAt.y);
	await waitForCanvasCardSelection(page, longPath);
	await settled(longPath, 'A selected note must keep its scroll position', now => now.scrollTop === 110);
	const empty = await emptyCanvasPoint(page);
	await page.mouse.click(empty.x, empty.y);
	await page.waitForFunction(target => !Array.from(document.querySelectorAll('.basehalf-canvas-card.selected')).some(element => element instanceof HTMLElement && element.dataset.basehalfCardPath === target), longPath, { timeout: 10_000 });
	await settled(longPath, 'A deselected note must keep its scroll position', now => now.scrollTop === 110);
	// The card builds a long note in parts as far as it shows (note rendering),
	// so the paragraph added at the end is not built yet: a new element tells
	// that the note was redrawn.
	await card('long.md').locator('.bh-md-preview').evaluate(note => note.setAttribute('data-smoke-drawn-before', 'true'));
	fs.writeFileSync(longFile, longNote(41), 'utf8');
	await settled(longPath, 'A note that is redrawn after its file changed must keep its scroll position', now => !now.marked && now.text.includes('Paragraph 1 ') && now.scrollTop === 110);

	// The editor opens where the note at rest was, and a scroll of the canvas goes on over it.
	await centerCanvasCards(page, [card('long.md')]);
	const editAt = await middleOf('long.md');
	await page.mouse.dblclick(editAt.x, editAt.y);
	const editor = await waitForCanvasNoteInlineEditor(page, longPath);
	const editing = await settled(longPath, 'The editor must open where the note at rest was', now => now.editorScrollTop === 110);
	await canvasGestureOver(`.basehalf-canvas-card[data-basehalf-card-path="${longPath}"] .basehalf-canvas-note-editor .basehalf-canvas-markdown-inline`);
	const afterEditorPan = await state(longPath);
	if (afterEditorPan.editorScrollTop !== 110 || afterEditorPan.viewport === editing.viewport) {
		throw new Error(`A scroll that starts on the canvas must keep moving the canvas over a note that is edited: ${JSON.stringify({ editing: editing.viewport, after: afterEditorPan.viewport, editorScrollTop: afterEditorPan.editorScrollTop })}`);
	}
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
	await settled(longPath, 'A note must keep its scroll position when editing ends', now => now.scrollTop === 110);

	// Drawn again, the note holds its first part only, and a scroll to its end
	// builds the rest and shows its last paragraph (note rendering, rule 28).
	await card('long.md').locator('.bh-md-preview').evaluate(note => note.setAttribute('data-smoke-drawn-before', 'true'));
	fs.writeFileSync(longFile, longNote(40), 'utf8');
	const drawnAgain = await settled(longPath, 'A note drawn again must hold only the parts it shows', now => !now.marked && now.text.includes('Paragraph 1 ') && !now.text.includes('Paragraph 40'));
	await centerCanvasCards(page, [card('long.md')]);
	const endAt = await middleOf('long.md');
	await page.mouse.move(endAt.x, endAt.y);
	await page.waitForTimeout(400);
	for (let index = 0; index < 20; index++) {
		await page.mouse.wheel(0, 300);
	}
	await settled(longPath, 'A scroll to the end of a long note must build its last part and show its last paragraph', now => now.text.includes('Paragraph 40') && now.overflow > drawnAgain.overflow && now.overflow - now.scrollTop < 1);

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(path.join(workspacePath, '.bh', 'mirror', folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

// A note is shown rendered on its card: at rest, and in the blocks that stay
// as they are while another block of the card is edited. A table that is wider
// than the card scrolls sideways in its own box.
export async function assertCanvasNoteRendersMarkdown(page) {
	const folderName = 'rendered';
	const notePath = `${folderName}/table.md`;
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${notePath}"]`);
	const shown = () => card.evaluate(element => {
		const note = element.querySelector('.basehalf-canvas-note-editor.ready .basehalf-canvas-markdown-inline') ?? element.querySelector('.bh-md-preview');
		const table = note?.querySelector('table');
		if (!(note instanceof HTMLElement) || !(table instanceof HTMLElement)) {
			return undefined;
		}
		const box = table.getBoundingClientRect();
		const mask = getComputedStyle(table).maskImage;
		return {
			headers: Array.from(table.querySelectorAll('thead th'), cell => cell.textContent).join('|'),
			cells: table.querySelectorAll('tbody td').length,
			linesInLastCell: table.querySelectorAll('tbody td:last-child br').length + 1,
			// A cell that broke a number would be higher than one line of text.
			numberCellLines: Math.round(table.querySelector('tbody td:nth-child(2)').getBoundingClientRect().height / box.height * 10) / 10,
			smallHeadings: note.querySelectorAll('h4').length,
			boxes: Array.from(note.querySelectorAll('li.bh-md-task input[type="checkbox"]'), input => input instanceof HTMLInputElement && input.checked && input.disabled ? 'done' : 'open').join('|'),
			tagsAsText: /<\/?(?:table|thead|tbody|tr|th|td|br|h4|input)\b/.test(note.textContent ?? ''),
			noteWiderThanCard: note.scrollWidth - note.clientWidth,
			table: `${Math.round(box.width)}x${Math.round(box.height)} holds ${table.scrollWidth}`,
			tableHoldsMore: table.scrollWidth > table.clientWidth,
			tableAt: Math.round(table.scrollLeft),
			fades: `${/^linear-gradient\(to right, rgba\(0, 0, 0, 0\)/.test(mask) ? 'left' : ''}${/rgba\(0, 0, 0, 0\)\)$/.test(mask) ? 'right' : ''}`,
			// The height of the table's box. The bar of a scrolled table lies over the box and adds nothing to it.
			tableBoxHeight: table.offsetHeight,
			systemScrollbar: table.offsetHeight - table.clientHeight,
			code: Array.from(note.querySelectorAll('pre'), pre => {
				const style = getComputedStyle(pre);
				return {
					size: `${Math.round(pre.getBoundingClientRect().width)}x${Math.round(pre.getBoundingClientRect().height)}`,
					lines: Math.round((pre.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight)),
					holdsMore: pre.scrollWidth > pre.clientWidth,
					hasBackground: style.backgroundColor !== 'rgba(0, 0, 0, 0)'
				};
			}),
			noteAt: note.scrollTop,
			viewport: getComputedStyle(document.querySelector('.react-flow__viewport')).transform
		};
	});
	// The bar of the note's table: whether it is shown, and whether it lies inside the lower edge of the table.
	const bar = () => card.evaluate(element => {
		const note = element.querySelector('.basehalf-canvas-note-editor.ready .basehalf-canvas-markdown-inline') ?? element.querySelector('.bh-md-preview');
		const table = note?.querySelector('table');
		const found = note?.querySelector('.basehalf-sideways-scrollbar');
		if (!(table instanceof HTMLElement) || !(found instanceof HTMLElement)) {
			return 'none';
		}
		const tableBox = table.getBoundingClientRect();
		const barBox = found.getBoundingClientRect();
		const inside = barBox.left >= tableBox.left && barBox.right <= tableBox.right && barBox.top >= tableBox.top && tableBox.bottom - barBox.bottom >= 0 && tableBox.bottom - barBox.bottom <= 4;
		// The bar is as long, of the table's shown width, as that width is of the table's full width.
		const proportional = Math.abs(barBox.width / tableBox.width - (table.clientWidth - 4) / table.scrollWidth) < 0.02;
		return `${getComputedStyle(found).opacity === '1' ? 'shown' : 'hidden'}${inside && proportional ? ' inside the lower edge' : ' misplaced'}, takes ${getComputedStyle(found).pointerEvents === 'none' ? 'no press' : 'presses'}`;
	});
	const columns = ['开始时间', 'ret_1h', 'ret_6h', 'ret_24h', 'vol_24h', 'buy_ratio', 'rel_volume', '标签 y'];

	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'table.md'), [
		'First paragraph.',
		'',
		`| ${columns.join(' | ')} |`,
		`|${columns.map(() => '---').join('|')}|`,
		'| 11:00 | +0.72% | +1.74% | +12.02% | 1.10% | 49.8% | 1.34 | up<br>next |',
		'',
		'#### Small heading',
		'',
		'- [ ] open',
		'- [x] done',
		'',
		'```python',
		'short = 1',
		'next_ret = close.shift(-1) / close - 1               # one line of code that is longer than the card is wide',
		'```',
		''
	].join('\n'), 'utf8');
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	await card.waitFor({ state: 'visible', timeout: 15_000 });
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [card]);
	await card.locator('.bh-md-preview table').waitFor({ state: 'attached', timeout: 10_000 });

	const rest = await shown();
	const expected = {
		headers: columns.join('|'), cells: 8, linesInLastCell: 2, smallHeadings: 1, boxes: 'open|done', tagsAsText: false,
		noteWiderThanCard: 0, tableHoldsMore: true, tableAt: 0, fades: 'right', systemScrollbar: 0, noteAt: 0
	};
	const comparable = state => JSON.stringify(state, Object.keys(expected));
	if (comparable(rest) !== JSON.stringify(expected)) {
		throw new Error(`A note at rest must show its table, small heading, and task boxes rendered, with a table of eight columns that is cut at the right and no wider note: ${JSON.stringify(rest)}`);
	}
	// A code block is a box with a background, and a line of code is not broken: two lines of code are two lines high.
	const code = rest.code[0];
	if (rest.code.length !== 1 || code.lines !== 2 || !code.holdsMore || !code.hasBackground) {
		throw new Error(`A code block on a card must be a box of its own whose lines are not broken: ${JSON.stringify(rest.code)}`);
	}

	// A sideways scroll that begins on the table moves the table, and neither the note nor the canvas.
	const tableBox = await card.locator('.bh-md-preview table').boundingBox();
	await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2);
	await page.waitForTimeout(400);
	await page.mouse.wheel(60, 0);
	await page.waitForFunction(target => {
		const table = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === target)?.querySelector('.bh-md-preview table');
		return table instanceof HTMLElement && Math.round(table.scrollLeft) === 60;
	}, notePath, { timeout: 10_000 }).catch(() => undefined);
	const scrolled = await shown();
	if (JSON.stringify({ ...scrolled, tableAt: 0, fades: 'right' }) !== JSON.stringify(rest) || scrolled.tableAt !== 60 || scrolled.fades !== 'leftright') {
		throw new Error(`A sideways scroll on a table wider than its card must move the table and nothing else: ${JSON.stringify({ rest, scrolled })}`);
	}
	// While the table is scrolled, its bar lies over it, inside its lower edge. Before and after there is none to see.
	const barBeforeAnyScroll = rest.systemScrollbar === 0 ? 'none' : 'a system scrollbar';
	const barWhileScrolled = await bar();
	// The bar goes, and the quiet time passes, so that the double-click below is not part of the gesture.
	await page.waitForTimeout(1_300);
	const barAfterTheScroll = await bar();
	if (barBeforeAnyScroll !== 'none' || barWhileScrolled !== 'shown inside the lower edge, takes no press' || barAfterTheScroll !== 'hidden inside the lower edge, takes no press') {
		throw new Error(`The bar of a table must show inside its lower edge while the table is scrolled sideways, and at no other time: ${JSON.stringify({ barBeforeAnyScroll, barWhileScrolled, barAfterTheScroll })}`);
	}

	// The table cannot be edited on the card. It stays the same table, at the same place, while the paragraph is edited.
	await card.locator('.bh-md-preview p', { hasText: 'First paragraph.' }).dblclick();
	const editor = await waitForCanvasNoteInlineEditor(page, notePath);
	const editing = await shown();
	if (JSON.stringify(editing) !== JSON.stringify(scrolled)) {
		throw new Error(`A table and a code block must look the same, at the same sideways position, while another block of their note is edited: ${JSON.stringify({ scrolled, editing })}`);
	}
	// Opening the editor put the table back where it was: that is no scroll, and shows no bar.
	const barOnOpeningTheEditor = await bar();
	// In the editor the table scrolls as any box does, and shows the same bar and no other.
	const editorTableBox = await card.locator('.basehalf-canvas-note-editor table').first().boundingBox();
	await page.mouse.move(editorTableBox.x + editorTableBox.width / 2, editorTableBox.y + editorTableBox.height / 2);
	await page.mouse.wheel(-20, 0);
	await page.waitForFunction(target => {
		const table = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === target)?.querySelector('.basehalf-canvas-note-editor table');
		return table instanceof HTMLElement && Math.round(table.scrollLeft) === 40;
	}, notePath, { timeout: 10_000 }).catch(() => undefined);
	const scrolledInTheEditor = await shown();
	const barInTheEditor = await bar();
	if (JSON.stringify({ ...scrolledInTheEditor, tableAt: 60 }) !== JSON.stringify(scrolled) || scrolledInTheEditor.tableAt !== 40
		|| barOnOpeningTheEditor !== 'none' || barInTheEditor !== 'shown inside the lower edge, takes no press') {
		throw new Error(`A table in the card's editor must scroll sideways with the same bar as at rest: ${JSON.stringify({ scrolled, scrolledInTheEditor, barOnOpeningTheEditor, barInTheEditor })}`);
	}
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
	// The fades follow the table's scroll through an animation, which the next frame brings up to date.
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const after = await shown();
	if (JSON.stringify(after) !== JSON.stringify(scrolledInTheEditor)) {
		throw new Error(`A table must keep its sideways position when editing ends: ${JSON.stringify({ scrolledInTheEditor, after })}`);
	}

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(path.join(workspacePath, '.bh', 'mirror', folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

// A link on a note's card opens what it names (note formats, criterion 13,
// rule 56, and plan R6): a click on the card at rest, and Command-click in the
// card's editor. A note of the folder whose name holds a space opens in Card
// Detail within 1 s, a link to a missing file does nothing, a link to a
// heading in a closed toggle opens the note in Card Detail with the heading in
// view, a web link opens the system's browser at its address as written, and
// no dialog shows.
export async function assertCanvasNoteLinksOpenTheirTargets(page) {
	const folderName = 'links-on-cards';
	const notePath = `${folderName}/links.md`;
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${notePath}"]`);
	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'my file.md'), '# My file\n\nThe linked note.\n', 'utf8');
	const filler = Array.from({ length: 40 }, (_, index) => `Filler paragraph ${index + 1}.\n`).join('\n');
	fs.writeFileSync(path.join(workspacePath, notePath), `See [my file.md](my%20file.md), [Setup](#setup), [site](https://example.com/a?b=c#d), and [gone](missing.md).\n\n${filler}\n<details>\n<summary>More</summary>\n\n## Setup\n\nThe end.\n\n</details>\n\n${filler}`, 'utf8');
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	await card.waitFor({ state: 'visible', timeout: 15_000 });
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [card]);
	const restingLink = name => card.locator('.bh-md-preview a', { hasText: name }).first();
	await restingLink('my file.md').waitFor({ state: 'visible', timeout: 10_000 });
	// The card's editor, opened on the first word of the line of links when it is not open.
	const editorLink = async name => {
		const editor = canvasNoteInlineEditor(page, notePath);
		if (!await editor.editable.isVisible().catch(() => false)) {
			// While Card Detail goes back into its card, the window's root takes every click.
			await waitForViewTransitions(page);
			// The first word of the line, where the card shows it: after Card Detail the note can stand scrolled a little,
			// and a press at the card's very edge is the edge's.
			const line = await card.locator('.bh-md-preview p', { hasText: 'See' }).first().boundingBox();
			const cardBox = await card.boundingBox();
			await page.mouse.dblclick(line.x + 4, Math.min(Math.max(line.y, cardBox.y + 12) + 6, line.y + line.height - 4));
			await waitForCanvasNoteInlineEditor(page, notePath);
		}
		return editor.editable.locator('a', { hasText: name }).first();
	};
	const commandClick = async name => (await editorLink(name)).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
	// The card at rest again: the line the editor edits is drawn by the editor meanwhile.
	const closeEditor = async () => {
		const editor = canvasNoteInlineEditor(page, notePath);
		if (await editor.editable.isVisible().catch(() => false)) {
			await editor.editable.click({ position: { x: 4, y: 6 } });
			await page.keyboard.press('Escape');
			await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
		}
	};

	for (const [gesture, open] of [['A click on the card at rest', name => restingLink(name).click()], ['Command-click in the card\'s editor', commandClick]]) {
		await open('gone');
		await page.waitForTimeout(1_000);
		if (await page.locator('.basehalf-card-detail.visible').count() || await dialogCount(page)) {
			throw new Error(`${gesture} on a link to a missing file did something: Card Detail ${await page.locator('.basehalf-card-detail.visible').count()}, dialogs ${await dialogCount(page)}`);
		}
		await open('my file.md');
		await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-title', { hasText: 'my file' }).waitFor({ state: 'visible', timeout: 1_000 }).catch(() => {
			throw new Error(`${gesture} on [my file.md](my%20file.md) did not open Card Detail of my file.md within 1 s`);
		});
		if (await dialogCount(page)) {
			throw new Error(`${gesture} on a link showed a dialog`);
		}
		await closeCardDetailIfOpen(page);
		await open('Setup');
		await assertNoteOpensAtSetup(page, gesture);
		await closeCardDetailIfOpen(page);
	}

	await closeEditor();
	await withTheSystemBrowserStoodIn(async opened => {
		await restingLink('site').click();
		await waitForReading(opened, addresses => addresses.length === 1, 'a click on a web link on a card at rest to open it in the system\'s browser', 1_000);
		await commandClick('site');
		await waitForReading(opened, addresses => addresses.length === 2, 'Command-click on a web link in the card\'s editor to open it in the system\'s browser', 1_000);
		const addresses = await opened();
		if (addresses.some(address => address !== 'https://example.com/a?b=c#d') || await dialogCount(page)) {
			throw new Error(`A web link on a card should open at its address as written, with no dialog: ${JSON.stringify(addresses)}`);
		}
	});

	await closeEditor();
	await removeFolder(page, folderName);
}

function dialogCount(page) {
	return page.locator('.monaco-dialog-box').count();
}

/** After `gesture` on a link to the heading Setup in a closed toggle, Card Detail shows the note with the heading in view within 2 s. */
async function assertNoteOpensAtSetup(page, gesture) {
	await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-title', { hasText: 'links' }).waitFor({ state: 'visible', timeout: 5_000 });
	const frame = await activeMarkdownRichFrame(page);
	const deadline = Date.now() + 2_000;
	let place;
	do {
		place = await frame.evaluate(() => {
			const view = document.querySelector('.basehalf-markdown-rich-scroll');
			const heading = Array.from(view?.querySelectorAll('h2') ?? []).find(element => element.textContent?.trim() === 'Setup');
			const box = heading?.getBoundingClientRect();
			const room = view?.getBoundingClientRect();
			return box && room ? { shown: box.height > 0, inView: box.top >= room.top && box.bottom <= room.bottom } : undefined;
		});
		if (place?.shown && place.inView) {
			break;
		}
		await page.waitForTimeout(100);
	} while (Date.now() < deadline);
	if (!place?.shown || !place.inView) {
		throw new Error(`${gesture} on a link to a heading in a closed toggle did not open the note at the heading: ${JSON.stringify(place)}`);
	}
	if (await dialogCount(page)) {
		throw new Error(`${gesture} on a link to a heading showed a dialog`);
	}
}

/** Opens the folder `folderName`, written just now, on its own canvas at 100%, with `cards` in the middle. */
async function openNewFolder(page, folderName, cards) {
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	for (const card of cards) {
		await card.waitFor({ state: 'visible', timeout: 15_000 });
	}
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, cards);
}

/** Goes back to the root canvas and takes the folder `folderName` and its layout away. */
async function removeFolder(page, folderName) {
	await closeCardDetailIfOpen(page);
	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(path.join(workspacePath, '.bh', 'mirror', folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

// Note formats, plans R10 and R12, and criterion 30: on a note's card at rest,
// a click on a toggle's title opens it, a video shows its first frame and a
// sound its glyph with BaseHalf's bar, whose play plays them with their sound,
// the pointer plays neither, a paragraph that is one link to a file is a file
// block that opens the file, and none of the clicks moves the card; a press on
// the video's picture does. One video or sound plays at a time: the note's
// sound pauses when a video's card starts under the pointer, and the video
// when the sound starts. Preview plays the note's video by a click on it.
export async function assertCanvasNoteMediaReactAtRest(page) {
	const folderName = 'media-on-cards';
	const notePath = `${folderName}/media.md`;
	const reelPath = `${folderName}/reel.mp4`;
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${notePath}"]`);
	const reel = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${reelPath}"]`);
	const video = fs.readFileSync(path.join(root, 'scripts', 'fixtures', 'basehalf-video-6s-mock.mp4'));
	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'clip.mp4'), video);
	fs.writeFileSync(path.join(workspacePath, reelPath), video);
	fs.writeFileSync(path.join(workspacePath, folderName, 'tone.wav'), createSilentWav(6));
	fs.writeFileSync(path.join(workspacePath, folderName, 'handout.pdf'), createMinimalPdfFixture());
	fs.writeFileSync(path.join(workspacePath, notePath), ['<details>', '<summary>More</summary>', '', 'Inside the toggle.', '', '</details>', '', '![clip](clip.mp4)', '', '<audio src="tone.wav" controls></audio>', '', '[handout.pdf](handout.pdf)', ''].join('\n'), 'utf8');
	// The note tall enough to show its sound and its file, beside the cards of the files.
	const mirror = path.join(workspacePath, '.bh', 'mirror', folderName);
	fs.mkdirSync(mirror, { recursive: true });
	fs.writeFileSync(path.join(mirror, 'canvas.yaml'), [
		`path: "${folderName}"`,
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		...[[notePath, 0, 0, 340, 560], [reelPath, 400, 0, 300, 220], [`${folderName}/clip.mp4`, 400, 300, 300, 220], [`${folderName}/tone.wav`, 760, 0, 300, 220], [`${folderName}/handout.pdf`, 760, 300, 240, 320]].flatMap(([cardPath, x, y, width, height]) => [
			`  - path: "${cardPath}"`,
			'    kind: file',
			`    x: ${x}`,
			`    y: ${y}`,
			`    width: ${width}`,
			`    height: ${height}`
		]),
		'edges: []',
		''
	].join('\n'), 'utf8');
	await openNewFolder(page, folderName, [card, reel]);
	const players = noteMediaPlayers(card.locator('.bh-md-preview'));
	await waitForReading(() => players.sound.media.evaluate(element => element.readyState), ready => ready >= 1, 'the note\'s sound to load', 10_000);
	await waitForReading(() => players.video.media.evaluate(element => element.readyState), ready => ready >= 1, 'the note\'s video to load', 10_000);
	const before = await card.boundingBox();
	const shown = {
		bars: await card.locator('.bh-md-preview .basehalf-canvas-video-player[data-controls="shown"]').count(),
		systemControls: await card.locator('.bh-md-preview video[controls], .bh-md-preview audio').count(),
		soundGlyph: await players.sound.player.locator('.basehalf-canvas-video-player-picture svg').count(),
		fileBlock: await card.locator('.bh-md-preview a.bh-md-file', { hasText: 'handout.pdf' }).locator('svg.bh-md-file-icon').count(),
	};
	if (shown.bars !== 2 || shown.systemControls !== 0 || shown.soundGlyph !== 1 || shown.fileBlock !== 1) {
		throw new Error(`A note's video and sound should show BaseHalf's bar and its file a file block on the card at rest: ${JSON.stringify(shown)}`);
	}

	const reacted = {};
	await card.locator('.bh-md-preview summary').first().click();
	reacted.toggle = await waitForReading(() => card.evaluate(element => element.querySelector('.bh-md-preview details')?.open === true), open => open, 'a click on a toggle\'s title to open it', 2_000).catch(() => false);
	// The pointer on the picture plays nothing.
	const videoBox = await players.video.player.boundingBox();
	await page.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 3, { steps: 4 });
	await page.waitForTimeout(600);
	reacted.pointerPlayedNothing = await players.video.media.evaluate(element => element.paused);
	await players.video.play.click();
	reacted.video = await waitForReading(() => players.video.media.evaluate(element => !element.paused && !element.muted), playing => playing, 'the play of the bar of a note\'s video to play it with its sound', 2_000).catch(() => false);
	// The sound that starts pauses the video: its sound goes down first.
	await players.sound.play.click();
	reacted.sound = await waitForReading(() => players.sound.media.evaluate(element => !element.paused && !element.muted), playing => playing, 'the play of the bar of a note\'s sound to play it', 2_000).catch(() => false);
	reacted.videoPausedForTheSound = await waitForReading(() => players.video.media.evaluate(element => element.paused), paused => paused, 'the note\'s video to pause when its sound starts', 2_000).catch(() => false);
	await players.sound.play.click();
	await waitForReading(() => players.sound.media.evaluate(element => element.paused), paused => paused, 'the pause of the bar of a note\'s sound to pause it', 2_000);
	const after = await card.boundingBox();
	const moved = { x: Math.round(after.x - before.x), y: Math.round(after.y - before.y) };
	if (!reacted.toggle || !reacted.pointerPlayedNothing || !reacted.video || !reacted.sound || !reacted.videoPausedForTheSound || moved.x !== 0 || moved.y !== 0) {
		throw new Error(`Clicks on a note's card at rest should open its toggle and play its video and its sound by their bars, one at a time, the pointer should play nothing, and nothing should move: ${JSON.stringify({ reacted, moved })}`);
	}

	// A press on the video's picture moves the card, as on a video's card.
	const picture = await players.video.player.boundingBox();
	const from = { x: picture.x + picture.width / 2, y: picture.y + picture.height / 3 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 30, from.y + 20, { steps: 6 });
	await page.mouse.move(from.x + 60, from.y + 40, { steps: 6 });
	await page.mouse.up();
	const dragged = await card.boundingBox();
	const draggedBy = { x: Math.round(dragged.x - after.x), y: Math.round(dragged.y - after.y) };
	if (Math.abs(draggedBy.x - 60) > 4 || Math.abs(draggedBy.y - 40) > 4) {
		throw new Error(`A press on the picture of a note's video should move its card: it moved by ${JSON.stringify(draggedBy)} for a drag of (60, 40)`);
	}

	// The video's card starts under the pointer, and the note's sound pauses; the sound starts again, and the video pauses.
	const reelVideo = reel.locator('.basehalf-canvas-video-player video').first();
	await players.sound.play.click();
	await waitForReading(() => players.sound.media.evaluate(element => !element.paused), playing => playing, 'the note\'s sound to play again', 2_000);
	const reelBox = await reel.boundingBox();
	await page.mouse.move(reelBox.x + reelBox.width / 2, reelBox.y + reelBox.height / 2, { steps: 4 });
	const oneAtATime = {};
	oneAtATime.videoStarted = await waitForReading(() => reelVideo.evaluate(element => !element.paused), playing => playing, 'the video\'s card under the pointer to play', 3_000).catch(() => false);
	oneAtATime.soundPaused = await waitForReading(() => players.sound.media.evaluate(element => element.paused), paused => paused, 'the note\'s sound to pause', 2_000).catch(() => false);
	await players.sound.play.click();
	oneAtATime.videoPaused = await waitForReading(() => reelVideo.evaluate(element => element.paused), paused => paused, 'the video to pause when the note\'s sound starts', 2_000).catch(() => false);
	await players.sound.play.click();
	if (!oneAtATime.videoStarted || !oneAtATime.soundPaused || !oneAtATime.videoPaused) {
		throw new Error(`One video or sound on the canvas should play at a time, a sound in a note too: ${JSON.stringify(oneAtATime)}`);
	}

	// The file block opens the file, as the link does.
	await card.locator('.bh-md-preview a.bh-md-file', { hasText: 'handout.pdf' }).click();
	await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-title', { hasText: 'handout' }).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {
		throw new Error('A click on the file block of a note at rest did not open its file in Card Detail');
	});
	await closeCardDetailIfOpen(page);

	// Preview: the same player, whose picture plays and pauses the video on a click, and the same file block.
	// Card Detail opens from the card's Expand (note formats, rule 82a).
	await waitForViewTransitions(page);
	const cardBox = await card.boundingBox();
	await page.mouse.click(cardBox.x + 24, cardBox.y + cardBox.height - 24);
	const toolbar = page.getByRole('toolbar', { name: `Actions for ${notePath}`, exact: true });
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await toolbar.getByRole('button', { name: `Expand ${notePath}`, exact: true }).click();
	await assertCardDetail(page, 'media.md');
	const projection = page.locator('.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="Preview"]');
	await projection.click();
	const preview = page.locator('.basehalf-card-detail.visible .basehalf-card-detail-markdown-preview-content');
	const inPreview = noteMediaPlayers(preview);
	await inPreview.video.player.waitFor({ state: 'visible', timeout: 10_000 });
	const pictureInPreview = await inPreview.video.player.boundingBox();
	await page.mouse.click(pictureInPreview.x + pictureInPreview.width / 2, pictureInPreview.y + pictureInPreview.height / 3);
	const previewPlays = await waitForReading(() => inPreview.video.media.evaluate(element => !element.paused && !element.muted), playing => playing, 'a click on the picture of a note\'s video in Preview to play it with its sound', 2_000).catch(() => false);
	await page.mouse.click(pictureInPreview.x + pictureInPreview.width / 2, pictureInPreview.y + pictureInPreview.height / 3);
	const previewPauses = await waitForReading(() => inPreview.video.media.evaluate(element => element.paused), paused => paused, 'a second click on it to pause it', 2_000).catch(() => false);
	const previewShows = {
		bars: await preview.locator('.basehalf-canvas-video-player[data-controls="shown"]').count(),
		fileBlock: await preview.locator('a.bh-md-file', { hasText: 'handout.pdf' }).count(),
	};
	await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-projection[aria-label="Rich"]').click().catch(() => undefined);
	await closeCardDetailIfOpen(page);
	if (!previewPlays || !previewPauses || previewShows.bars !== 2 || previewShows.fileBlock !== 1) {
		throw new Error(`In Preview a note's video and sound should show BaseHalf's bar, a click on the video should play and pause it, and the file should be a file block: ${JSON.stringify({ previewPlays, previewPauses, previewShows })}`);
	}
	await removeFolder(page, folderName);
}

/** The players of the video and the sound of a rendered note: the player, its media element, and the play of its bar. */
function noteMediaPlayers(note) {
	const of = player => ({ player, media: player.locator('video').first(), play: player.locator('.basehalf-canvas-video-player-button.play').first() });
	return {
		video: of(note.locator('.basehalf-canvas-video-player.note:not(.sound)').first()),
		sound: of(note.locator('.basehalf-canvas-video-player.note.sound').first()),
	};
}

const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';

// Note formats, criterion 23: a double click on a picture in a note opens the
// card's editor with the caret at the end of the line before the picture, and
// no Card Detail. A click selects the picture, Delete removes it, and one undo
// brings it back. A letter typed while it is selected starts a paragraph after
// it, and the file holds the picture and the letter, nothing else changed. A
// note that holds only a picture opens the card's editor and writes nothing.
export async function assertCanvasNotePictureEditsOnTheCard(page) {
	const folderName = 'picture-on-cards';
	const notePath = `${folderName}/picture.md`;
	const onlyPath = `${folderName}/only.md`;
	const NOTE = 'Before the picture.\n\n![pic](pic.png)\n\nAfter the picture.\n';
	const ONLY = '![pic](pic.png)\n';
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${notePath}"]`);
	const only = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${onlyPath}"]`);
	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'pic.png'), createSolidPng(160, 90, [64, 140, 220]));
	fs.writeFileSync(path.join(workspacePath, notePath), NOTE, 'utf8');
	fs.writeFileSync(path.join(workspacePath, onlyPath), ONLY, 'utf8');
	const mirror = path.join(workspacePath, '.bh', 'mirror', folderName);
	fs.mkdirSync(mirror, { recursive: true });
	fs.writeFileSync(path.join(mirror, 'canvas.yaml'), [
		`path: "${folderName}"`,
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		...[[notePath, 0, 0, 320, 300], [onlyPath, 380, 0, 320, 300], [`${folderName}/pic.png`, 760, 0, 240, 180]].flatMap(([cardPath, x, y, width, height]) => [
			`  - path: "${cardPath}"`,
			'    kind: file',
			`    x: ${x}`,
			`    y: ${y}`,
			`    width: ${width}`,
			`    height: ${height}`
		]),
		'edges: []',
		''
	].join('\n'), 'utf8');
	await openNewFolder(page, folderName, [card, only]);
	const note = () => fs.readFileSync(path.join(workspacePath, notePath), 'utf8');
	const editor = canvasNoteInlineEditor(page, notePath);
	const openOnThePicture = async (target, targetPath) => {
		const picture = target.locator('.bh-md-preview img').first();
		await picture.waitFor({ state: 'visible', timeout: 10_000 });
		await waitForViewTransitions(page);
		await picture.dblclick();
		await waitForCanvasNoteInlineEditor(page, targetPath);
		if (await page.locator('.basehalf-card-detail.visible').count()) {
			throw new Error(`A double click on the picture of ${targetPath} opened Card Detail instead of the card's editor`);
		}
	};
	const close = async (targetPath = notePath) => {
		await page.keyboard.press('Escape');
		await canvasNoteInlineEditor(page, targetPath).host.waitFor({ state: 'detached', timeout: 10_000 });
	};
	const fixedPicture = () => editor.editable.locator('.basehalf-canvas-markdown-inline-unit.unsupported', { has: page.locator('img') }).first();
	const seen = {};

	// The caret at the end of the line before the picture: a letter typed goes there.
	await openOnThePicture(card, notePath);
	await page.keyboard.type('Q');
	await page.waitForFunction(() => document.activeElement?.closest('.ProseMirror')?.textContent?.includes('Before the picture.Q'), undefined, { timeout: 5_000 }).then(() => {
		seen.caretBeforeThePicture = true;
	}, () => {
		seen.caretBeforeThePicture = false;
	});
	await page.keyboard.press(UNDO);
	await close();
	seen.undoneLetter = note() === NOTE;

	// A click selects the picture, Delete removes it, and one undo brings it back.
	await openOnThePicture(card, notePath);
	await fixedPicture().click();
	await page.waitForFunction(() => document.querySelector('.ProseMirror .basehalf-canvas-markdown-inline-unit.unsupported.ProseMirror-selectednode img') !== null, undefined, { timeout: 5_000 });
	await page.keyboard.press('Delete');
	await editor.editable.locator('img').waitFor({ state: 'detached', timeout: 5_000 });
	seen.textKept = await editor.editable.locator('p').allTextContents();
	await page.keyboard.press(UNDO);
	await editor.editable.locator('img').waitFor({ state: 'attached', timeout: 5_000 });
	await close();
	seen.pictureBack = note() === NOTE;

	// A letter typed while the picture is selected starts a paragraph after it.
	await openOnThePicture(card, notePath);
	await fixedPicture().click();
	await page.waitForFunction(() => document.querySelector('.ProseMirror .basehalf-canvas-markdown-inline-unit.unsupported.ProseMirror-selectednode img') !== null, undefined, { timeout: 5_000 });
	await page.keyboard.type('x');
	await close();
	seen.letterAfter = note();

	// A note that holds only a picture: the card's editor opens beside it, and nothing is written.
	await openOnThePicture(only, onlyPath);
	await close(onlyPath);
	seen.onlyUnchanged = fs.readFileSync(path.join(workspacePath, onlyPath), 'utf8') === ONLY;

	const expected = {
		caretBeforeThePicture: true,
		undoneLetter: true,
		textKept: ['Before the picture.', 'After the picture.'],
		pictureBack: true,
		letterAfter: 'Before the picture.\n\n![pic](pic.png)\n\nx\n\nAfter the picture.\n',
		onlyUnchanged: true,
	};
	if (JSON.stringify(seen) !== JSON.stringify(expected)) {
		throw new Error(`A picture in a note should be edited on the card as one unit: ${JSON.stringify(seen)}, expected ${JSON.stringify(expected)}`);
	}
	await removeFolder(page, folderName);
}

// Note formats, criterion 21: a red word on a note's card is drawn
// rgb(232, 112, 107), on the screen too, with the system in light and in dark
// appearance.
export async function assertCanvasNotePaletteInBothAppearances(page) {
	const folderName = 'palette-on-cards';
	const notePath = `${folderName}/red.md`;
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${notePath}"]`);
	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, notePath), 'A <span style="color:#e8706b;">red</span> word on a card.\n', 'utf8');
	await openNewFolder(page, folderName, [card]);
	const word = card.locator('.bh-md-preview span[style]', { hasText: 'red' }).first();
	const seen = {};
	try {
		for (const appearance of ['light', 'dark']) {
			await showSystemAppearance(page, appearance);
			await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			seen[appearance] = await drawnColor(word, [232, 112, 107]);
		}
	} finally {
		await restoreSystemAppearance(page);
	}
	const red = JSON.stringify({ color: 'rgb(232, 112, 107)', pixels: 'rgb(232, 112, 107)' });
	if (Object.values(seen).some(shown => JSON.stringify(shown) !== red)) {
		throw new Error(`A red word on a card is not drawn as stored in each appearance: ${JSON.stringify(seen)}`);
	}
	await removeFolder(page, folderName);
}

// A note that starts with a horizontal rule cannot take an upstream list in
// its own text. BaseHalf keeps the list for it instead of refusing: the note's
// bytes never change, the connection is drawn, and the badge says where the
// list is. Once the note can hold a list, the kept list stays in use and Move
// into File moves it into the note.
export async function assertNoteThatCannotHoldAListKeepsItWithBaseHalf(page) {
	const note = 'rule-note.md';
	const notePath = path.join(workspacePath, note);
	const keptPath = path.join(workspacePath, '.bh', 'mirror', note, 'upstream.yaml');
	const original = '---\nA line between two rules.\n---\n\nBody\n';
	fs.writeFileSync(notePath, original, 'utf8');
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	await noteCard.waitFor({ state: 'visible', timeout: 10_000 });
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await frameCanvasCardsForConnection(page, [readme, noteCard]);

	await openCanvasBadgeFace(noteCard);
	const upstream = noteCard.locator('[data-testid="badge-upstream"]');
	const helper = await upstream.locator('.basehalf-canvas-card-badge-helper').textContent();
	if (!helper?.includes('BaseHalf keeps this list for this file.')) {
		throw new Error(`The badge does not say that BaseHalf keeps this note's list: ${JSON.stringify(helper)}`);
	}
	if (await upstream.locator('.basehalf-canvas-card-badge-issue-row').count() !== 0) {
		throw new Error('A note that only starts with a horizontal rule shows an upstream issue');
	}
	await noteCard.locator('[data-testid="badge-add-upstream"]').click();
	const widget = page.locator('.quick-input-widget:visible');
	await widget.locator('.quick-input-title', { hasText: `Add upstream to ${note}` }).waitFor({ state: 'visible', timeout: 10_000 });
	await visibleQuickInput(page).fill('README');
	const readmeRow = widget.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: 'README.md' }).first();
	await readmeRow.waitFor({ state: 'visible', timeout: 15_000 });
	await readmeRow.click();
	await widget.waitFor({ state: 'hidden', timeout: 10_000 });
	await waitUntil(() => fs.existsSync(keptPath) && fs.readFileSync(keptPath, 'utf8') === 'upstream:\n  - README.md\n', 'BaseHalf to keep the upstream list for the note');
	if (fs.readFileSync(notePath, 'utf8') !== original) {
		throw new Error(`Connecting into the note changed the note: ${JSON.stringify(fs.readFileSync(notePath, 'utf8'))}`);
	}
	const readmeUpstreamRow = noteCard.locator('[data-testid="badge-upstream-row"][data-upstream-status="valid"]', { hasText: 'README' });
	await readmeUpstreamRow.waitFor({ state: 'visible', timeout: 10_000 });
	const readmeUpstreamLink = readmeUpstreamRow.locator('.basehalf-canvas-card-badge-link');
	if (await readmeUpstreamLink.textContent() !== 'README' || await readmeUpstreamRow.getAttribute('data-upstream-path') !== 'README.md' || await readmeUpstreamLink.getAttribute('title') !== null) {
		throw new Error(`An Upstream row does not name a note without its extension, stand for its path, and show nothing more under the pointer: ${JSON.stringify({ text: await readmeUpstreamLink.textContent(), path: await readmeUpstreamRow.getAttribute('data-upstream-path'), title: await readmeUpstreamLink.getAttribute('title') })}`);
	}
	await closeCanvasBadgeFace(noteCard);
	await assertCanvasEdgeVisible(page, 'README.md', note);

	// The rule is removed: the note could hold the list now. Its connection
	// stays, and the badge offers to move the list into the note.
	fs.writeFileSync(notePath, 'Body\n', 'utf8');
	await noteCard.locator('.basehalf-canvas-card-badge-dot.issue[data-testid="card-reference-issue-marker"]:visible').waitFor({ state: 'visible', timeout: 10_000 });
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await openCanvasBadgeFace(noteCard);
	const moveIntoFile = upstream.locator('.basehalf-canvas-card-badge-issue-row[data-upstream-issue="misplaced"] .basehalf-canvas-card-badge-issue-action', { hasText: 'Move into File' });
	await moveIntoFile.waitFor({ state: 'visible', timeout: 10_000 });
	await moveIntoFile.click();
	await waitUntil(() => readWorkspaceFile(note) === '---\nupstream:\n  - README.md\n---\nBody\n' && !fs.existsSync(keptPath), 'Move into File to move the kept list into the note');
	await closeCanvasBadgeFace(noteCard);
	await assertCanvasEdgeVisible(page, 'README.md', note);

	// Leave the canvas as the following steps expect it.
	fs.rmSync(notePath);
	await noteCard.waitFor({ state: 'detached', timeout: 10_000 });
}
