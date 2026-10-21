/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Renaming a card from its name.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { centerCanvasCards } from './creation.mts';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, panCanvasCardTo } from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';

export async function assertCanvasInlineRename(page) {
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.focus();
	await page.keyboard.press('F2');
	const input = readme.locator('.basehalf-canvas-inline-name-input input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	const value = await input.inputValue();
	if (value !== 'README') {
		throw new Error(`Expected inline rename to hold the name of the note, got ${JSON.stringify(value)}`);
	}
	if (await page.locator('.quick-input-widget').isVisible()) {
		throw new Error('Canvas rename unexpectedly opened Quick Input instead of the card-local editor');
	}
	await input.fill('README-renamed.md');
	await input.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"] .basehalf-canvas-inline-name-input input'), null, { timeout: 10_000 });
	await readme.waitFor({ state: 'visible', timeout: 10_000 });

	await readme.focus();
	await page.keyboard.press('F2');
	// Typed, not filled: the editor has the keyboard by itself. It holds the
	// name of the note, all of it selected, and the file keeps its extension.
	await waitForCanvasNameEditor(page, 'README.md', { value: 'README', selection: [0, 6] });
	await page.keyboard.type('README-renamed');
	await page.keyboard.press('Enter');
	await waitUntil(() => !fs.existsSync(path.join(workspacePath, 'README.md')) && fs.existsSync(path.join(workspacePath, 'README-renamed.md')), 'canvas inline rename to commit');
	const renamed = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README-renamed.md"]');
	await renamed.waitFor({ state: 'visible', timeout: 10_000 });

	await renamed.focus();
	await page.keyboard.press('F2');
	const restoreInput = renamed.locator('.basehalf-canvas-inline-name-input input');
	await restoreInput.fill('README.md');
	await restoreInput.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'README.md')) && !fs.existsSync(path.join(workspacePath, 'README-renamed.md')), 'canvas inline rename to restore the fixture');
	await readme.waitFor({ state: 'visible', timeout: 10_000 });
	// The name that restored the fixture was filled in with its extension: it
	// is the file name, and no second extension was added.
	if (fs.existsSync(path.join(workspacePath, 'README.md.md'))) {
		throw new Error('A note name typed with its extension got the extension twice');
	}
	await assertCanvasCardNameRenamesInPlace(page);
}

/** Waits until the rename editor of a card is open with the keyboard, and checks what it holds. */
async function waitForCanvasNameEditor(page, cardPath, expected) {
	const selector = `.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"] .basehalf-canvas-inline-name-input input`;
	await page.locator(selector).waitFor({ state: 'visible', timeout: 10_000 });
	const read = () => page.evaluate(inputSelector => {
		const input = document.querySelector(inputSelector);
		return input instanceof HTMLInputElement
			? { value: input.value, selection: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input }
			: undefined;
	}, selector);
	const wanted = JSON.stringify({ ...expected, focused: true });
	const deadline = Date.now() + 5_000;
	let seen;
	do {
		seen = await read();
		if (JSON.stringify(seen) === wanted) {
			return;
		}
		await page.waitForTimeout(50);
	} while (Date.now() < deadline);
	throw new Error(`The rename editor of ${cardPath} is not ready for typing: ${JSON.stringify({ expected, seen })}`);
}

/**
 * The name of a card (canvas card name): the text cursor over the text alone,
 * and the double click that renames in place.
 */
async function assertCanvasCardNameRenamesInPlace(page) {
	const cardSelector = cardPath => `.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`;
	const readme = page.locator(cardSelector('README.md'));
	const docs = page.locator(cardSelector('docs'));
	const docsBefore = await docs.boundingBox();
	if (!docsBefore) {
		throw new Error('The docs card has no place before the card name checks');
	}
	const caption = cardPath => page.evaluate(selector => {
		const card = document.querySelector(selector);
		const label = card?.querySelector('.basehalf-canvas-card-label');
		const glyph = card?.querySelector('.basehalf-canvas-card-caption-icon');
		const badge = card?.querySelector('.basehalf-canvas-card-badge-toggle');
		const identity = card?.querySelector('.basehalf-canvas-card-caption-identity');
		if (!card || !label || !glyph || !badge || !identity) {
			return undefined;
		}
		const range = document.createRange();
		range.selectNodeContents(label);
		const labelBox = label.getBoundingClientRect();
		const glyphBox = glyph.getBoundingClientRect();
		const badgeBox = badge.getBoundingClientRect();
		const middle = labelBox.top + labelBox.height / 2;
		const cursorAt = (x, y) => {
			const hit = document.elementFromPoint(x, y);
			return hit ? getComputedStyle(hit).cursor : undefined;
		};
		const name = { x: labelBox.left + Math.min(12, labelBox.width / 2), y: middle };
		const glyphPoint = { x: glyphBox.left + glyphBox.width / 2, y: glyphBox.top + glyphBox.height / 2 };
		return {
			name,
			glyph: glyphPoint,
			text: label.textContent,
			rows: [...card.querySelectorAll('.basehalf-canvas-folder-preview-label')].map(row => row.textContent),
			labelLeft: labelBox.left,
			labelTop: labelBox.top,
			labelHeight: labelBox.height,
			font: (style => `${style.fontSize} ${style.fontWeight} ${style.lineHeight} ${style.color}`)(getComputedStyle(label)),
			labelWidth: labelBox.width,
			textWidth: range.getBoundingClientRect().width,
			identityWidth: identity.getBoundingClientRect().width,
			nameHit: document.elementFromPoint(name.x, name.y) === label,
			rightOfNameHit: document.elementFromPoint(labelBox.right + 8, middle) === label,
			cursors: {
				name: cursorAt(name.x, name.y),
				glyph: cursorAt(glyphPoint.x, glyphPoint.y),
				rightOfName: cursorAt(labelBox.right + 8, middle),
				badge: cursorAt(badgeBox.left + badgeBox.width / 2, badgeBox.top + badgeBox.height / 2)
			}
		};
	}, cardSelector(cardPath));
	const canvasState = () => page.evaluate(() => ({
		editor: document.querySelector('.basehalf-canvas-inline-name-input input')?.closest('.basehalf-canvas-card')?.getAttribute('data-basehalf-card-path') ?? null,
		selected: [...document.querySelectorAll('.basehalf-canvas-card.selected')].map(card => card.getAttribute('data-basehalf-card-path')),
		toolbar: !!document.querySelector('.basehalf-canvas-selection-toolbar, .basehalf-canvas-note-toolbar'),
		noteEditing: document.querySelectorAll('.basehalf-canvas-card[data-note-editing="true"]').length,
		cardDetail: !!document.querySelector('.basehalf-card-detail.visible')
	}));
	const expectState = async (expected, context) => {
		const deadline = Date.now() + 5_000;
		let seen;
		do {
			seen = await canvasState();
			if (JSON.stringify(seen) === JSON.stringify(expected)) {
				return;
			}
			await page.waitForTimeout(50);
		} while (Date.now() < deadline);
		throw new Error(`Unexpected canvas state ${context}: ${JSON.stringify({ expected, seen })}`);
	};
	const doubleClick = async point => {
		await page.mouse.move(point.x, point.y);
		await page.mouse.dblclick(point.x, point.y);
	};
	// The rename editor as it is drawn: where its text stands, in what type,
	// and whether anything frames it or says that the name cannot be used.
	const nameEditor = () => page.evaluate(() => {
		const input = document.querySelector('.basehalf-canvas-card .basehalf-canvas-inline-name-input input');
		const frame = input?.closest('.monaco-inputbox');
		if (!(input instanceof HTMLInputElement) || !frame) {
			return undefined;
		}
		const box = input.getBoundingClientRect();
		const style = getComputedStyle(input);
		const frameStyle = getComputedStyle(frame);
		const message = document.querySelector('.monaco-inputbox-message');
		return {
			left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
			top: box.top,
			height: box.height,
			width: box.width,
			font: `${style.fontSize} ${style.fontWeight} ${style.lineHeight} ${style.color}`,
			frame: [style.borderLeftWidth, style.paddingLeft, style.backgroundColor, style.outlineStyle, frameStyle.borderLeftWidth, frameStyle.borderTopWidth, frameStyle.backgroundColor, frameStyle.outlineStyle].join(' '),
			underlined: style.textDecorationLine.includes('underline'),
			message: message && message.getClientRects().length > 0 ? message.textContent : null
		};
	});

	await centerCanvasCards(page, [readme]);
	const atRest = await caption('README.md');
	// A note is named without its extension, on its card and in a folder card.
	const folderAtRest = await caption('docs');
	if (!atRest || !folderAtRest
		|| atRest.text !== 'README'
		|| folderAtRest.text !== 'docs'
		|| !folderAtRest.rows.some(row => row === 'guide' || row === 'far')
		|| folderAtRest.rows.some(row => /\.md$/i.test(row ?? ''))) {
		throw new Error(`A note is not named without its extension: ${JSON.stringify({ note: atRest?.text, folder: folderAtRest?.text, rows: folderAtRest?.rows })}`);
	}
	if (!atRest
		|| atRest.cursors.name !== 'text'
		|| atRest.cursors.glyph === 'text'
		|| atRest.cursors.rightOfName === 'text'
		|| atRest.cursors.badge === 'text'
		|| !atRest.nameHit
		|| atRest.rightOfNameHit
		|| Math.abs(atRest.labelWidth - atRest.textWidth) > 1
		|| atRest.labelWidth > atRest.identityWidth - 24) {
		throw new Error(`The name of a card does not take the text cursor over its text alone: ${JSON.stringify(atRest)}`);
	}

	// A double click on the name: the editor, the keyboard, and nothing opened.
	const placeBefore = await readme.boundingBox();
	// Changing a name selects no card: between the first press and the open
	// editor no frame shows a selected card or the toolbar of one. The two
	// clicks come as a person's do, so a toolbar that the first one brought up
	// would have its frames.
	await page.mouse.move(atRest.name.x, atRest.name.y);
	await page.evaluate(() => {
		const watch = { selected: 0, toolbar: 0, stop: false };
		(window as typeof window & { __basehalfSmokeNameSelection?: typeof watch }).__basehalfSmokeNameSelection = watch;
		const tick = () => {
			if (document.querySelector('.basehalf-canvas-card.selected')) {
				watch.selected++;
			}
			if (document.querySelector('.basehalf-canvas-selection-toolbar, .basehalf-canvas-note-toolbar')) {
				watch.toolbar++;
			}
			if (!watch.stop) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
	await page.mouse.click(atRest.name.x, atRest.name.y);
	await page.waitForTimeout(200);
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after one click on the name of a note');
	await page.mouse.click(atRest.name.x, atRest.name.y, { clickCount: 2 });
	await waitForCanvasNameEditor(page, 'README.md', { value: 'README', selection: [0, 6] });
	await expectState({ editor: 'README.md', selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after a double click on the name of a note');
	const selectionFrames = await page.evaluate(() => {
		const watch = (window as typeof window & { __basehalfSmokeNameSelection?: { selected: number; toolbar: number; stop: boolean } }).__basehalfSmokeNameSelection;
		if (!watch) {
			return { selected: -1, toolbar: -1 };
		}
		watch.stop = true;
		return { selected: watch.selected, toolbar: watch.toolbar };
	});
	if (selectionFrames.selected !== 0 || selectionFrames.toolbar !== 0) {
		throw new Error(`A double click on the name of a card showed the card selected on the way to its editor: ${JSON.stringify(selectionFrames)}`);
	}

	// The editor is not disturbed by what happens in the folder meanwhile: a
	// file of another card, and the very note that is being renamed. The caret
	// stands inside the typed text, so a caret that went to the end shows.
	await page.keyboard.type('README-by');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.evaluate(() => {
		const input = document.querySelector('.basehalf-canvas-inline-name-input input');
		const watch = { input, card: input?.closest('.basehalf-canvas-card'), lost: [] as string[], stop: false };
		(window as typeof window & { __basehalfSmokeNameEditor?: typeof watch }).__basehalfSmokeNameEditor = watch;
		const tick = () => {
			if (!(input instanceof HTMLInputElement) || !input.isConnected || document.activeElement !== input
				|| input.value !== 'README-by' || input.selectionStart !== 7 || input.selectionEnd !== 7) {
				watch.lost.push(JSON.stringify(input instanceof HTMLInputElement
					? { connected: input.isConnected, focused: document.activeElement === input, value: input.value, caret: [input.selectionStart, input.selectionEnd] }
					: null));
			}
			if (!watch.stop && watch.lost.length < 5) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
	const nameEditorWatch = () => page.evaluate(() => {
		const watch = (window as typeof window & { __basehalfSmokeNameEditor?: { card: Element | null | undefined; lost: string[]; stop: boolean } }).__basehalfSmokeNameEditor;
		if (!watch) {
			return { lost: ['the watch of the rename editor is gone'], sameCard: true };
		}
		return {
			lost: watch.lost,
			sameCard: document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]') === watch.card
		};
	});
	// Another card's file: the card of the editor is kept as it is.
	const probePath = path.join(workspacePath, 'docs', 'name-editor-probe.md');
	const readmePath = path.join(workspacePath, 'README.md');
	const readmeBytes = fs.readFileSync(readmePath);
	fs.writeFileSync(probePath, '# Written while a name is edited\n', 'utf8');
	await page.waitForTimeout(1_200);
	fs.rmSync(probePath);
	await page.waitForTimeout(1_200);
	const afterOtherFile = await nameEditorWatch();
	if (afterOtherFile.lost.length > 0 || !afterOtherFile.sameCard) {
		throw new Error(`The rename editor did not stay as it was while another file of the folder changed: ${JSON.stringify(afterOtherFile)}`);
	}
	// The note that is being renamed: its card is drawn again with other
	// content, and the editor moves into the new drawing.
	fs.writeFileSync(readmePath, Buffer.concat([readmeBytes, Buffer.from('\nname-editor-probe\n', 'utf8')]));
	await readme.locator('.bh-md-preview p', { hasText: 'name-editor-probe' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	const afterOwnFile = await nameEditorWatch();
	if (afterOwnFile.lost.length > 0 || afterOwnFile.sameCard) {
		throw new Error(`The rename editor did not move into the new drawing of its card: ${JSON.stringify(afterOwnFile)}`);
	}
	fs.writeFileSync(readmePath, readmeBytes);
	await readme.locator('.bh-md-preview p', { hasText: 'name-editor-probe' }).first().waitFor({ state: 'detached', timeout: 15_000 });
	const lost = await page.evaluate(() => {
		const watch = (window as typeof window & { __basehalfSmokeNameEditor?: { lost: string[]; stop: boolean } }).__basehalfSmokeNameEditor;
		if (!watch) {
			return ['the watch of the rename editor is gone'];
		}
		watch.stop = true;
		return watch.lost;
	});
	if (lost.length > 0) {
		throw new Error(`The rename editor did not stay as it was while the renamed note was written: ${lost.join(' ')}`);
	}
	// The caret is where it was: two characters before the end of the typed part.
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type('-name');
	await page.keyboard.press('Enter');
	await waitUntil(() => !fs.existsSync(path.join(workspacePath, 'README.md')) && fs.existsSync(path.join(workspacePath, 'README-by-name.md')), 'the double-clicked name to rename the note');
	const byName = page.locator(cardSelector('README-by-name.md'));
	await byName.waitFor({ state: 'visible', timeout: 10_000 });
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after Enter in the rename editor');
	const placeAfter = await byName.boundingBox();
	if (!placeBefore || !placeAfter
		|| Math.abs(placeAfter.x - placeBefore.x) > 1 || Math.abs(placeAfter.y - placeBefore.y) > 1
		|| Math.abs(placeAfter.width - placeBefore.width) > 1 || Math.abs(placeAfter.height - placeBefore.height) > 1) {
		throw new Error(`A card renamed from its name did not keep its place: ${JSON.stringify({ placeBefore, placeAfter })}`);
	}

	// Escape renames nothing. Then the fixture gets its name back.
	const renamed = await caption('README-by-name.md');
	await doubleClick(renamed.name);
	await waitForCanvasNameEditor(page, 'README-by-name.md', { value: 'README-by-name', selection: [0, 14] });

	// The editor is the name made editable: its text stands where the name
	// stood, in the same type, and nothing frames it.
	const opened = await nameEditor();
	if (!opened || !renamed
		|| Math.abs(opened.left - renamed.labelLeft) > 0.5
		|| Math.abs(opened.top - renamed.labelTop) > 0.5
		|| Math.abs(opened.height - renamed.labelHeight) > 0.5
		|| Math.abs(opened.width - renamed.textWidth) > 1
		|| opened.font !== renamed.font
		|| opened.frame !== '0px 0px rgba(0, 0, 0, 0) none 0px 0px rgba(0, 0, 0, 0) none'
		|| opened.underlined || opened.message !== null) {
		throw new Error(`The rename editor is not the name in place: ${JSON.stringify({ opened, atRest: { left: renamed?.labelLeft, top: renamed?.labelTop, height: renamed?.labelHeight, width: renamed?.textWidth, font: renamed?.font } })}`);
	}
	// What is done inside the editor stays there: a click in the middle of the
	// text puts the caret there, and no card is selected by it.
	const editorBox = await page.locator('.basehalf-canvas-card .basehalf-canvas-inline-name-input input').boundingBox();
	if (!editorBox) {
		throw new Error('The rename editor has no box for the click inside it');
	}
	await page.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2);
	await page.waitForTimeout(400);
	const caret = await page.evaluate(() => {
		const input = document.querySelector('.basehalf-canvas-card .basehalf-canvas-inline-name-input input');
		return input instanceof HTMLInputElement
			? { start: input.selectionStart ?? -1, end: input.selectionEnd ?? -1, length: input.value.length, focused: document.activeElement === input }
			: undefined;
	});
	if (!caret || !caret.focused || caret.start !== caret.end || caret.start <= 0 || caret.start >= caret.length) {
		throw new Error(`A click in the middle of the rename editor did not put the caret there: ${JSON.stringify(caret)}`);
	}
	await expectState({ editor: 'README-by-name.md', selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after a click inside the rename editor');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	// It is as wide as its text.
	await page.keyboard.type('ab');
	const short = await nameEditor();
	await page.keyboard.type('cdefgh');
	const longer = await nameEditor();
	if (!short || !longer || !(short.width < opened.width - 20) || !(longer.width > short.width + 20)) {
		throw new Error(`The rename editor is not as wide as its text: ${JSON.stringify({ opened: opened.width, short: short?.width, longer: longer?.width })}`);
	}
	// A name that cannot be used is marked in the text while it is typed, and
	// the reason comes when Enter is refused.
	await page.keyboard.type('/x');
	await page.waitForTimeout(400);
	const unusable = await nameEditor();
	if (!unusable?.underlined || unusable.message !== null) {
		throw new Error(`A name that cannot be used is not marked quietly while it is typed: ${JSON.stringify(unusable)}`);
	}
	await page.keyboard.press('Enter');
	await page.waitForTimeout(600);
	const refused = await nameEditor();
	if (!refused?.underlined || !refused.message) {
		throw new Error(`Enter on a name that cannot be used did not keep the editor open with the reason: ${JSON.stringify(refused)}`);
	}
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await page.waitForTimeout(400);
	const usable = await nameEditor();
	if (!usable || usable.underlined || usable.message !== null) {
		throw new Error(`A name that can be used again is still marked: ${JSON.stringify(usable)}`);
	}
	await page.keyboard.press('Escape');
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after Escape in the rename editor');
	if (!fs.existsSync(path.join(workspacePath, 'README-by-name.md')) || fs.existsSync(path.join(workspacePath, 'abcdefgh.md'))) {
		throw new Error('Escape in the rename editor renamed the note');
	}
	await doubleClick(renamed.name);
	await waitForCanvasNameEditor(page, 'README-by-name.md', { value: 'README-by-name', selection: [0, 14] });
	await page.keyboard.type('README');
	await page.keyboard.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'README.md')) && !fs.existsSync(path.join(workspacePath, 'README-by-name.md')), 'the double-clicked name to restore the fixture');
	await readme.waitFor({ state: 'visible', timeout: 10_000 });
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after the fixture got its name back');

	// The glyph of a note is not the name: nothing opens.
	await doubleClick((await caption('README.md')).glyph);
	await page.waitForTimeout(600);
	// The glyph is the card: it selects it, and the card's toolbar comes up.
	await expectState({ editor: null, selected: ['README.md'], toolbar: true, noteEditing: 0, cardDetail: false }, 'after a double click on the glyph of a note');

	// The name of a folder is renamed in place, and the folder is not entered.
	// Earlier steps leave cards where their drags ended, and one can lie over
	// the name of a folder: the folder whose name is on top is taken.
	let folderPath;
	let folder;
	const seenFolders = {};
	for (const candidate of ['docs', 'src']) {
		await centerCanvasCards(page, [page.locator(cardSelector(candidate))]);
		const seen = await caption(candidate);
		seenFolders[candidate] = seen;
		if (seen?.nameHit) {
			folderPath = candidate;
			folder = seen;
			break;
		}
	}
	if (!folderPath || !folder) {
		throw new Error(`No folder card has its name on top for the card name checks: ${JSON.stringify(seenFolders)}`);
	}
	if (folder.cursors.name !== 'text' || folder.cursors.glyph === 'text') {
		throw new Error(`The name of a folder card does not take the text cursor: ${JSON.stringify(folder)}`);
	}
	await doubleClick(folder.name);
	await waitForCanvasNameEditor(page, folderPath, { value: folderPath, selection: [0, folderPath.length] });
	await expectState({ editor: folderPath, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after a double click on the name of a folder');
	await assertCanvasFolder(page, '');
	await page.keyboard.press('Escape');
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after Escape in the rename editor of a folder');

	// Hand the canvas back as the step found it: nothing selected, docs in place.
	const emptyCanvas = await page.evaluate(() => {
		const pane = document.querySelector('.react-flow__pane');
		if (!pane) {
			return undefined;
		}
		const rect = pane.getBoundingClientRect();
		for (let y = rect.bottom - 48; y > rect.top + 48; y -= 48) {
			for (let x = rect.right - 48; x > rect.left + 48; x -= 48) {
				if (document.elementFromPoint(x, y) === pane) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!emptyCanvas) {
		throw new Error('No empty canvas point to end the selection after the card name checks');
	}
	await page.mouse.click(emptyCanvas.x, emptyCanvas.y);
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after the card name checks');
	await panCanvasCardTo(page, docs, { x: docsBefore.x, y: docsBefore.y });
}
