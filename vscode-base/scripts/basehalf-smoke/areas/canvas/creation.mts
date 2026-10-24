/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Making things on the canvas: the create menu, notes, files, folders, and where new cards go.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { assertNoCanvasNoteHeavyEditor, selectCanvasInlineToken } from './noteEditor.mts';
import { root, workspacePath } from '../../context.mts';
import { gitStatusOfWorkspace } from '../../fixture.mts';
import {
	assertCanvasFolder,
	canvasNoteInlineEditor,
	clickCanvasCreateAction,
	openRootCanvas,
	panCanvasCardTo,
	panCanvasToward,
	readCanvasCardGeometry,
	readCanvasCreateMenu,
	setCanvasZoomPercent,
	waitForCanvasCardSelection,
	waitForCanvasNoteInlineEditor
} from '../../lib/canvas.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame, dispatchMarkdownRichComposition } from '../../lib/markdownRich.mts';
import { hideNotificationsCenter, showNotificationsCenter } from '../../lib/notifications.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

export async function assertCanvasDoubleClickCreateMenu(page) {
	const pane = page.locator('.react-flow__pane');
	await pane.waitFor({ state: 'visible', timeout: 10_000 });
	const point = await pane.evaluate(element => {
		const rect = element.getBoundingClientRect();
		for (let y = rect.top + 48; y < rect.bottom - 48; y += 48) {
			for (let x = rect.left + 48; x < rect.right - 48; x += 48) {
				if (element.ownerDocument.elementFromPoint(x, y) === element) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!point) {
		throw new Error('Could not find an unobstructed canvas point for the double-click create menu');
	}

	await page.mouse.dblclick(point.x, point.y, { button: 'left', delay: 50 });
	const createAction = page.locator('.context-view.monaco-menu-container .action-label[aria-label="New Note"]').last();
	await createAction.waitFor({ state: 'visible', timeout: 10_000 });
	await page.keyboard.press('Escape');
	await createAction.waitFor({ state: 'hidden', timeout: 10_000 });
}

/**
 * Generation cards, "Creating a generation card" and criteria 2 and 80, and
 * canvas Create menu, criteria 1 and 2: the Create menu offers New Note, New
 * Image, New Video, New Audio, and New Folder, with no New File and no
 * submenu of nodes, and then Paste and Import Files.... New Image and New
 * Video each make a draft in the folder of the canvas: a card, selected, with
 * its panel and its prompt focused, and a `generation.yaml` with an empty
 * prompt (no generation ran on this computer), and no file. Each is one step
 * of the canvas undo stack. The Create button centers the card on the middle
 * of the canvas, or puts it at the nearest open place in sight, and the view
 * goes to a card that is out of sight; the step hands the view back as it
 * found it, within the pixels of a drag. New Audio's draft is checked in the
 * video suite (`areas/video/audioCards.mts`): one more draft here leaves the
 * view a fraction of a pixel elsewhere, and that decides the next step's
 * near-tie of two open places for its folder.
 */
export async function assertCanvasCreateMenuMakesDrafts(page) {
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const readmeBefore = await readme.boundingBox();
	const zoomBefore = Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom'));
	if (!readmeBefore) {
		throw new Error('The README card must be drawn before the drafts are made');
	}
	const menu = await readCanvasCreateMenu(page);
	if (JSON.stringify(menu) !== JSON.stringify(['New Note', 'New Image', 'New Video', 'New Audio', 'New Folder', '|', 'Paste', 'Import Files...'])) {
		throw new Error(`The Create menu must offer New Note, New Image, New Video, New Audio, and New Folder, then Paste and Import Files..., and nothing else: ${JSON.stringify(menu)}`);
	}
	const mirror = name => path.join(workspacePath, '.bh', 'mirror', name);
	const canvasPath = mirror('canvas.yaml');
	// A draft without a model has the ratio of its kind: 1:1 for an image, 16:9 for a video (canvas card placement).
	for (const [label, name, size] of [['New Image', 'image.png', { width: 300, height: 300 }], ['New Video', 'video.mp4', { width: 533, height: 300 }]]) {
		await clickCanvasCreateAction(page, label);
		const info = path.join(mirror(name), 'generation.yaml');
		await waitUntil(() => fs.existsSync(info), `${label} to make the draft ${name}`);
		if (fs.readFileSync(info, 'utf8') !== 'prompt: ""\n' || fs.existsSync(path.join(workspacePath, name)) || fs.readdirSync(mirror(name)).join() !== 'generation.yaml') {
			throw new Error(`${label} must make a draft with only an empty prompt and no file: ${JSON.stringify({ info: fs.readFileSync(info, 'utf8'), file: fs.existsSync(path.join(workspacePath, name)), files: fs.readdirSync(mirror(name)) })}`);
		}
		if (await page.locator('.quick-input-widget').isVisible()) {
			throw new Error(`${label} unexpectedly opened Quick Input`);
		}
		const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
		await card.waitFor({ state: 'visible', timeout: 10_000 });
		await waitForCanvasCardSelection(page, name);
		const kind = label === 'New Image' ? 'image' : 'video';
		const shown = await card.evaluate(element => ({ generation: element.getAttribute('data-generation'), kind: element.getAttribute('data-generation-kind'), face: element.querySelector('.bh-generation-card')?.getAttribute('data-state') ?? null }));
		if (shown.generation !== 'draft' || shown.kind !== kind || shown.face !== 'draft') {
			throw new Error(`The card of ${name} must be a draft of ${kind}: ${JSON.stringify(shown)}`);
		}
		await waitUntil(() => {
			const row = readCanvasCardGeometry(fs.readFileSync(canvasPath, 'utf8'), name);
			return row?.width === size.width && row.height === size.height;
		}, `the draft ${name} to get a place of ${size.width} by ${size.height}`);
		await page.waitForFunction(cardPath => {
			const surface = Array.from(document.querySelectorAll('.basehalf-canvas-video-panel-surface')).find(element => element.getAttribute('data-basehalf-card-path') === cardPath);
			return document.activeElement === surface?.querySelector('.bh-prompt-editor');
		}, name, { timeout: 15_000 });
		if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
			throw new Error(`${label} opened content instead of leaving the new card selected`);
		}
	}
	// One undo takes back each draft: Escape gives the keyboard from the prompt back to the card.
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') === 'video.mp4', null, { timeout: 10_000 });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await waitUntil(() => !fs.existsSync(mirror('video.mp4')), 'one undo to take back the draft video.mp4');
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="video.mp4"]').waitFor({ state: 'detached', timeout: 10_000 });
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await waitUntil(() => !fs.existsSync(mirror('image.png')), 'the next undo to take back the draft image.png');
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="image.png"]').waitFor({ state: 'detached', timeout: 10_000 });
	const layout = fs.readFileSync(canvasPath, 'utf8');
	if (readCanvasCardGeometry(layout, 'image.png') || readCanvasCardGeometry(layout, 'video.mp4')) {
		throw new Error(`Undo of a new draft must take its place too:\n${layout}`);
	}
	await setCanvasZoomPercent(page, Number((zoomBefore * 100).toFixed(2)));
	await panCanvasCardTo(page, readme, { x: readmeBefore.x, y: readmeBefore.y });
}

export async function assertCanvasNewFilesGoToTheEnd(page) {
	const folderName = 'placed';
	const mirror = (...segments) => path.join(workspacePath, '.bh', 'mirror', ...segments);
	const layoutPath = mirror(folderName, 'canvas.yaml');
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}/${name}"]`);
	const note = name => fs.writeFileSync(path.join(workspacePath, folderName, name), `# ${name}\n\nA note of the folder that tests where cards go, with words of its own: ${name}-alpha, ${name}-beta.\n`, 'utf8');
	const rowOf = name => {
		const raw = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : '';
		const row = readCanvasCardGeometry(raw, `${folderName}/${name}`);
		return row ? { x: row.x, y: row.y, chosen: new RegExp(`- path: "${folderName}/${name.replace(/[.]/g, '\\.')}"\\n(?: {4}.*\\n)*? {4}auto: true`).test(raw) } : undefined;
	};
	const hiddenInGit = () => gitStatusOfWorkspace().split('\n').filter(line => line.includes('.bh/')).sort().join('\n');
	// A folder, which is listed first, and three notes.
	const original = ['sub', 'b.md', 'c.md', 'd.md'];
	const added = ['a.md', 'x1.md', 'x2.md', 'x3.md'];
	const gitBefore = hiddenInGit();

	fs.mkdirSync(path.join(workspacePath, folderName, 'sub'), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'sub', 'inside.md'), '# Inside\n\nA note inside the folder card that is dragged.\n', 'utf8');
	original.slice(1).forEach(note);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	await card('d.md').waitFor({ state: 'visible', timeout: 15_000 });

	// The first drawing: the plain grid for four cards, saved as places BaseHalf chose.
	await waitUntil(() => original.every(name => rowOf(name) !== undefined), 'the first drawing of a folder to save a row for every card', 15_000);
	const first = Object.fromEntries(original.map(name => [name, rowOf(name)]));
	const expectedFirst = { 'sub': { x: 540, y: 690, chosen: true }, 'b.md': { x: 880, y: 690, chosen: true }, 'c.md': { x: 1220, y: 690, chosen: true }, 'd.md': { x: 1560, y: 690, chosen: true } };
	if (JSON.stringify(first) !== JSON.stringify(expectedFirst)) {
		throw new Error(`The first drawing of a folder must be the plain grid, saved as places BaseHalf chose: ${JSON.stringify(first)}`);
	}

	// Every frame while files are added: where the three cards that were there are drawn.
	await page.evaluate(paths => {
		const cardOf = cardPath => Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element instanceof HTMLElement && element.dataset.basehalfCardPath === cardPath);
		const placeOf = element => {
			const rect = element.getBoundingClientRect();
			return `${Math.round(rect.x / 4)},${Math.round(rect.y / 4)}`;
		};
		const places = new Map(paths.map(cardPath => [cardPath, placeOf(cardOf(cardPath))]));
		const watch = { running: true, framesWithACardElsewhere: 0, framesWithACardMissing: 0 };
		globalThis.basehalfPlaced = watch;
		const tick = () => {
			if (!watch.running) {
				return;
			}
			for (const [cardPath, place] of places) {
				const element = cardOf(cardPath);
				if (!element) {
					watch.framesWithACardMissing++;
				} else if (placeOf(element) !== place) {
					watch.framesWithACardElsewhere++;
				}
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, original.map(name => `${folderName}/${name}`));

	// A file whose name sorts before all others, and then three at once.
	note('a.md');
	await card('a.md').waitFor({ state: 'visible', timeout: 15_000 });
	await waitUntil(() => rowOf('a.md') !== undefined, 'a new file to get a saved place', 15_000);
	added.slice(1).forEach(note);
	for (const name of added) {
		await card(name).waitFor({ state: 'visible', timeout: 15_000 });
	}
	await waitUntil(() => added.every(name => rowOf(name) !== undefined), 'every new file to get a saved place', 15_000);
	await page.waitForTimeout(1_000);
	const watch = await page.evaluate(() => {
		const state = globalThis.basehalfPlaced;
		state.running = false;
		return { framesWithACardElsewhere: state.framesWithACardElsewhere, framesWithACardMissing: state.framesWithACardMissing };
	});
	const rows = Object.fromEntries([...original, ...added].map(name => [name, rowOf(name)]));
	// It was not sorted in: it is beside the last card. The row of five cells is then full, and a new row starts.
	const endPlaces = ['1900,690', '540,970', '880,970', '1220,970'];
	const addedPlaces = added.map(name => `${rows[name].x},${rows[name].y}`);
	if (original.some(name => JSON.stringify(rows[name]) !== JSON.stringify(expectedFirst[name]))
		|| addedPlaces[0] !== endPlaces[0]
		|| [...addedPlaces].sort().join(' ') !== [...endPlaces].sort().join(' ')
		|| added.some(name => !rows[name].chosen)
		|| watch.framesWithACardElsewhere > 0 || watch.framesWithACardMissing > 0) {
		throw new Error(`Files that are added must go to the end of the canvas, and no card that was there may move: ${JSON.stringify({ rows, watch })}`);
	}

	// The user drags a card: it is saved where it was dropped, as the user's, and no other row changes.
	// It is the folder card, taken by its middle: pressing on the text of a note can start editing it.
	const box = await card('sub').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 130, { steps: 8 });
	await page.mouse.up();
	await waitUntil(() => rowOf('sub')?.chosen === false, 'a dragged card to be saved as the user\'s', 15_000);
	const afterDrag = Object.fromEntries([...original, ...added].map(name => [name, rowOf(name)]));
	// It went right and up by about the distance of the pointer, whatever the zoom is.
	const moved = { x: afterDrag['sub'].x - 540, y: afterDrag['sub'].y - 690 };
	if ([...original, ...added].some(name => name !== 'sub' && JSON.stringify(afterDrag[name]) !== JSON.stringify(rows[name]))
		|| moved.x < 20 || moved.x > 200 || moved.y > -60 || moved.y < -400) {
		throw new Error(`A drag must change the row of the dragged card and no other: ${JSON.stringify({ moved, afterDrag })}`);
	}

	// Git shows none of it: not the layouts, not the ignore file. The notes themselves are new files, as they should be.
	const status = gitStatusOfWorkspace();
	if (hiddenInGit() !== gitBefore || !status.includes(`${folderName}/a.md`)) {
		throw new Error(`Card places must not show in git, and the notes must:\n${status}`);
	}

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(mirror(folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

/**
 * Mirror file resilience, acceptance criterion 14: folders whose names look
 * like numbers leave their canvas readable. Cards next to them still move and
 * stay where they are dropped, and deleting the folders removes their rows
 * without a layout notice or a metadata notification.
 */
export async function assertCanvasNumericFolderNames(page) {
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const savedGeometry = name => readCanvasCardGeometry(fs.readFileSync(canvasPath, 'utf8'), name);
	const cardFor = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	await page.keyboard.press('Escape');

	// Each folder is made by New Folder and renamed on its card (canvas Create menu).
	const isFolder = name => fs.existsSync(path.join(workspacePath, name)) && fs.statSync(path.join(workspacePath, name)).isDirectory();
	for (const name of ['09', '2024']) {
		await clickCanvasCreateAction(page, 'New Folder');
		await waitUntil(() => isFolder('untitled folder'), 'canvas New Folder to create untitled folder');
		const untitled = cardFor('untitled folder');
		await untitled.waitFor({ state: 'visible', timeout: 10_000 });
		await waitForCanvasCardSelection(page, 'untitled folder');
		await untitled.focus();
		await page.keyboard.press('F2');
		const input = untitled.locator('.basehalf-canvas-inline-name-input input');
		await input.waitFor({ state: 'visible', timeout: 10_000 });
		await input.fill(name);
		await input.press('Enter');
		await waitUntil(() => isFolder(name) && !fs.existsSync(path.join(workspacePath, 'untitled folder')), `the rename of untitled folder to ${name}`);
		await cardFor(name).waitFor({ state: 'visible', timeout: 10_000 });
		await waitUntil(() => savedGeometry(name) !== undefined, `the position of the folder ${name} to be saved`);
	}

	// A move reads the canvas that now holds `path: "09"` before it writes.
	// New cards can land outside the window, so pan to the one that moves and
	// hand the viewport back at the end, where later steps expect it.
	const anchor = cardFor('README.md');
	const anchorBefore = await anchor.boundingBox();
	const moved = cardFor('2024');
	await page.keyboard.press('Escape');
	await centerCanvasCards(page, [moved]);
	const savedBefore = savedGeometry('2024');
	const boxBefore = await moved.boundingBox();
	if (!savedBefore || !boxBefore || !anchorBefore) {
		throw new Error('Missing the 2024 folder card or the viewport anchor before the move');
	}
	const start = { x: boxBefore.x + boxBefore.width / 2, y: boxBefore.y + boxBefore.height / 2 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 70, start.y + 45, { steps: 10 });
	await page.mouse.up();
	await waitUntil(() => {
		const saved = savedGeometry('2024');
		return saved !== undefined && (saved.x !== savedBefore.x || saved.y !== savedBefore.y);
	}, 'the moved 2024 folder card to be saved next to the 09 folder card');
	// A rejected save writes nothing, and the next render returns the card to
	// its old position. The saved position must have changed and must stay.
	// It is compared in canvas coordinates: the viewport may still be settling,
	// so the card's place on screen says nothing.
	const savedAfter = savedGeometry('2024');
	await page.waitForTimeout(500);
	const savedLater = savedGeometry('2024');
	if (!savedAfter || !savedLater || savedLater.x !== savedAfter.x || savedLater.y !== savedAfter.y
		|| (savedLater.x === savedBefore.x && savedLater.y === savedBefore.y)) {
		throw new Error(`The moved 2024 folder card did not stay where it was dropped: ${JSON.stringify({ savedBefore, savedAfter, savedLater })}`);
	}

	for (const name of ['2024', '09']) {
		await page.keyboard.press('Escape');
		// Each card is shown before it is clicked: the view went to the one that moved.
		await centerCanvasCards(page, [cardFor(name)]);
		await deleteCanvasCardFromItsMenu(page, name);
		await waitUntil(() => savedGeometry(name) === undefined, `the row of the folder ${name} to leave canvas.yaml`);
	}

	// Toasts never render under the smoke driver, so open notifications are read from the center.
	const notices = await page.locator('.basehalf-canvas-warning').evaluateAll(elements => elements.map(element => element.textContent ?? ''));
	const center = await showNotificationsCenter(page);
	const notifications = await center.locator('.notification-list-item').evaluateAll(elements => elements.map(element => element.textContent ?? ''));
	await hideNotificationsCenter(page);
	const unexpected = [...notices, ...notifications].filter(text => /saved layout|saved card positions|card position|cards and badges/.test(text));
	if (unexpected.length > 0) {
		throw new Error(`Numeric folder names produced a layout notice or a metadata notification: ${JSON.stringify(unexpected)}`);
	}
	if (fs.existsSync(path.join(workspacePath, '.bh', 'cache', 'recovered'))) {
		throw new Error('Numeric folder names made BaseHalf save a recovery copy of a canvas it wrote itself');
	}
	await page.keyboard.press('Escape');
	await panCanvasCardTo(page, anchor, anchorBefore);
}

/**
 * New Note from Card Detail and from the Create menu, and the editing of an
 * empty note. The canvas makes no file from a typed name (canvas Create
 * menu): the data file comes as an agent or Files adds it, and the empty
 * note is a New Note beside it, renamed on its card.
 */
export async function assertCanvasCreateNote(page) {
	const createButton = page.locator('.basehalf-canvas-create-button');
	await createButton.waitFor({ state: 'visible', timeout: 10_000 });

	fs.writeFileSync(path.join(workspacePath, 'smoke-data.json'), '', 'utf8');
	const dataCard = page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-data.json"]');
	await dataCard.waitFor({ state: 'visible', timeout: 10_000 });
	await centerCanvasCards(page, [dataCard]);
	await dataCard.dblclick();
	await assertCardDetail(page, 'smoke-data.json');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'untitled.md')), 'global New Note to create an untitled Markdown file');
	const untitledNote = page.locator('.basehalf-canvas-card[data-basehalf-card-path="untitled.md"]');
	await untitledNote.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas New Note opened Card Detail instead of staying on the canvas');
	}
	await waitForCanvasCardSelection(page, 'untitled.md');
	const createdNoteEditor = await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="untitled.md"]', 'new Note automatic inline editing');
	await page.keyboard.press('Escape');
	await createdNoteEditor.host.waitFor({ state: 'detached', timeout: 10_000 });
	fs.rmSync(path.join(workspacePath, 'untitled.md'), { force: true });
	await untitledNote.waitFor({ state: 'hidden', timeout: 10_000 });

	// The Create menu closes after dispatching its command. Its focus restoration
	// must not override the explicit New Note inline-edit intent.
	await clickCanvasCreateAction(page, 'New Note');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'untitled.md')), 'canvas Create menu New Note to create an untitled Markdown file');
	await untitledNote.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas Create menu New Note opened Card Detail instead of staying on the canvas');
	}
	await waitForCanvasCardSelection(page, 'untitled.md');
	const menuCreatedNoteEditor = await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await page.keyboard.press('Escape');
	await menuCreatedNoteEditor.host.waitFor({ state: 'detached', timeout: 10_000 });
	fs.rmSync(path.join(workspacePath, 'untitled.md'), { force: true });
	await untitledNote.waitFor({ state: 'hidden', timeout: 10_000 });

	// The empty note: a New Note with the data card in the middle of the view
	// goes to the nearest open place beside it, so that both are in sight
	// together below. Escape leaves it empty, and it is renamed on its card.
	await centerCanvasCards(page, [dataCard]);
	await clickCanvasCreateAction(page, 'New Note');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'untitled.md')), 'New Note beside the data card');
	const besideEditor = await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await page.keyboard.press('Escape');
	await besideEditor.host.waitFor({ state: 'detached', timeout: 10_000 });
	await untitledNote.focus();
	await page.keyboard.press('F2');
	const noteName = untitledNote.locator('.basehalf-canvas-inline-name-input input');
	await noteName.waitFor({ state: 'visible', timeout: 10_000 });
	await noteName.fill('smoke-note');
	await noteName.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'smoke-note.md')) && !fs.existsSync(path.join(workspacePath, 'untitled.md')), 'the new note to be renamed smoke-note');
	const emptyNote = page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]');
	await emptyNote.waitFor({ state: 'visible', timeout: 10_000 });
	if (fs.statSync(path.join(workspacePath, 'smoke-note.md')).size !== 0) {
		throw new Error('A New Note that was left with Escape must stay empty');
	}

	await centerCanvasCards(page, [emptyNote]);
	const emptyNotePlaceholder = emptyNote.locator('.basehalf-canvas-note-empty', { hasText: 'Double-click to edit' });
	await emptyNotePlaceholder.waitFor({ state: 'visible', timeout: 10_000 });
	await emptyNote.click();
	const emptyNoteEditor = canvasNoteInlineEditor(page, 'smoke-note.md');
	const emptyNoteToolbar = page.getByRole('toolbar', { name: 'Actions for smoke-note.md', exact: true });
	await emptyNoteToolbar.waitFor({ state: 'visible', timeout: 10_000 });
	const emptyToolbarLabels = await emptyNoteToolbar.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
	const expectedEmptyToolbarLabels = ['Background color', 'Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Divider', 'Copy all', 'Expand smoke-note.md'];
	if (JSON.stringify(emptyToolbarLabels) !== JSON.stringify(expectedEmptyToolbarLabels)) {
		throw new Error(`The empty Note toolbar has an unexpected action contract: ${JSON.stringify(emptyToolbarLabels)}`);
	}
	if (await emptyNote.getAttribute('data-preview-level') !== 'preview' || await emptyNoteEditor.host.count() !== 0) {
		throw new Error('Selecting a newly created empty Note mounted its editor before a double click');
	}
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]', 'empty Note selection');
	const emptyInlineOpenStarted = Date.now();
	await emptyNotePlaceholder.dblclick();
	const activeEmptyNoteEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	console.error(`[basehalf-smoke] canvas-note-empty-inline-ready-ms ${Date.now() - emptyInlineOpenStarted}`);
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]', 'empty Note inline editing');
	const emptyNotePath = path.join(workspacePath, 'smoke-note.md');
	const initialEmptyNoteMarkdown = fs.readFileSync(emptyNotePath, 'utf8');
	if (initialEmptyNoteMarkdown.trim() !== '') {
		throw new Error(`A newly created empty Note had unexpected content before its first Canvas edit: ${JSON.stringify(initialEmptyNoteMarkdown)}`);
	}
	const projectionTokens = {
		heading1: 'Projection heading one',
		heading2: 'Projection heading two',
		heading3: 'Projection heading three',
		paragraph: 'Projection paragraph',
		emphasis: 'Projection bold italic',
		bullet: 'Projection bullet item',
		numbered: 'Projection numbered item',
		dividerTail: 'Projection divider tail',
		richHeading1: 'Rich command heading one',
		richHeading2: 'Rich command heading two',
		richHeading3: 'Rich command heading three',
		richParagraph: 'Rich command paragraph',
		richEmphasis: 'Rich command bold italic',
		richBullet: 'Rich command bullet item',
		richOrdered: 'Rich command numbered item',
		richDivider: 'Rich command divider anchor'
	};
	const projectionParagraphs = Object.values(projectionTokens);
	for (let index = 0; index < projectionParagraphs.length; index++) {
		await page.keyboard.insertText(projectionParagraphs[index]);
		if (index < projectionParagraphs.length - 1) {
			await page.keyboard.press('Enter');
		}
	}

	const applyBlockFormat = async (token, action, selector) => {
		await selectCanvasInlineToken(activeEmptyNoteEditor.editable, token);
		await emptyNoteToolbar.getByRole('button', { name: action, exact: true }).click();
		await activeEmptyNoteEditor.editable.locator(selector, { hasText: token }).waitFor({ state: 'visible', timeout: 3_000 });
	};
	await applyBlockFormat(projectionTokens.heading1, 'Heading 1', 'h1');
	await applyBlockFormat(projectionTokens.heading2, 'Heading 2', 'h2');
	await applyBlockFormat(projectionTokens.heading3, 'Heading 3', 'h3');
	await applyBlockFormat(projectionTokens.heading3, 'Bulleted list', 'ul li');
	await applyBlockFormat(projectionTokens.heading3, 'Heading 3', 'h3');
	await applyBlockFormat(projectionTokens.paragraph, 'Heading 1', 'h1');
	await applyBlockFormat(projectionTokens.paragraph, 'Paragraph', 'p');
	await selectCanvasInlineToken(activeEmptyNoteEditor.editable, projectionTokens.emphasis);
	await emptyNoteToolbar.getByRole('button', { name: 'Bold', exact: true }).click();
	await emptyNoteToolbar.getByRole('button', { name: 'Italic', exact: true }).click();
	const canvasEmphasis = activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.emphasis });
	await canvasEmphasis.locator('strong', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 3_000 });
	await canvasEmphasis.locator('em', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 3_000 });
	await applyBlockFormat(projectionTokens.bullet, 'Bulleted list', 'ul li');
	await selectCanvasInlineToken(activeEmptyNoteEditor.editable, projectionTokens.bullet);
	const bulletListItem = activeEmptyNoteEditor.editable.locator('ul li', { hasText: projectionTokens.bullet });
	await emptyNoteToolbar.getByRole('button', { name: 'Bulleted list', exact: true }).click();
	await bulletListItem.waitFor({ state: 'detached', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('.basehalf-canvas-markdown-inline-unit > p', { hasText: projectionTokens.bullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await applyBlockFormat(projectionTokens.bullet, 'Bulleted list', 'ul li');
	await applyBlockFormat(projectionTokens.bullet, 'Numbered list', 'ol li');
	await applyBlockFormat(projectionTokens.bullet, 'Bulleted list', 'ul li');
	await applyBlockFormat(projectionTokens.numbered, 'Numbered list', 'ol li');
	await applyBlockFormat(projectionTokens.numbered, 'Heading 1', 'h1');
	await applyBlockFormat(projectionTokens.numbered, 'Numbered list', 'ol li');
	await selectCanvasInlineToken(activeEmptyNoteEditor.editable, projectionTokens.dividerTail);
	await emptyNoteToolbar.getByRole('button', { name: 'Divider', exact: true }).click();
	await activeEmptyNoteEditor.editable.locator('hr').waitFor({ state: 'visible', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 3_000 });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await activeEmptyNoteEditor.editable.locator('hr').waitFor({ state: 'detached', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 3_000 });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
	await activeEmptyNoteEditor.editable.locator('hr').waitFor({ state: 'visible', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 3_000 });

	await emptyNoteToolbar.getByRole('button', { name: 'Expand smoke-note.md', exact: true }).click();
	await assertCardDetail(page, 'smoke-note.md');
	await emptyNoteEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await waitUntil(() => {
		const markdown = fs.readFileSync(emptyNotePath, 'utf8');
		return projectionParagraphs.every(token => markdown.includes(token));
	}, 'Canvas formatting to save every edited block before Expand', 15_000);
	const canvasFormattedMarkdown = fs.readFileSync(emptyNotePath, 'utf8');
	const sourceSemantics = {
		heading1: new RegExp(`^# ${projectionTokens.heading1}$`, 'm').test(canvasFormattedMarkdown),
		heading2: new RegExp(`^## ${projectionTokens.heading2}$`, 'm').test(canvasFormattedMarkdown),
		heading3: new RegExp(`^### ${projectionTokens.heading3}$`, 'm').test(canvasFormattedMarkdown),
		paragraph: new RegExp(`^${projectionTokens.paragraph}$`, 'm').test(canvasFormattedMarkdown),
		bullet: new RegExp(`^[*+-] ${projectionTokens.bullet}$`, 'm').test(canvasFormattedMarkdown),
		numbered: new RegExp(`^1\\. ${projectionTokens.numbered}$`, 'm').test(canvasFormattedMarkdown),
		divider: /^---$/m.test(canvasFormattedMarkdown)
	};
	if (Object.values(sourceSemantics).some(value => !value)) {
		throw new Error(`Canvas toolbar did not save standard Markdown semantics: ${JSON.stringify({ sourceSemantics, canvasFormattedMarkdown })}`);
	}
	const projectionFrame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	await projectionFrame.locator('.bn-editor', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 15_000 });
	const richBlocks = await projectionFrame.locator('.bn-block-content').evaluateAll(elements => elements.map(element => ({
		type: element.getAttribute('data-content-type'),
		level: element.getAttribute('data-level'),
		headingTag: element.querySelector('h1, h2, h3')?.tagName ?? null,
		text: element.textContent?.trim() ?? '',
		bold: element.querySelector('strong') !== null,
		italic: element.querySelector('em') !== null,
		divider: element.querySelector('hr') !== null
	})));
	const richBlock = token => richBlocks.find(block => block.text.includes(token));
	const richSemantics = {
		heading1: richBlock(projectionTokens.heading1)?.type === 'heading' && richBlock(projectionTokens.heading1)?.headingTag === 'H1',
		heading2: richBlock(projectionTokens.heading2)?.type === 'heading' && richBlock(projectionTokens.heading2)?.headingTag === 'H2',
		heading3: richBlock(projectionTokens.heading3)?.type === 'heading' && richBlock(projectionTokens.heading3)?.headingTag === 'H3',
		paragraph: richBlock(projectionTokens.paragraph)?.type === 'paragraph',
		bold: richBlock(projectionTokens.emphasis)?.type === 'paragraph' && richBlock(projectionTokens.emphasis)?.bold === true,
		italic: richBlock(projectionTokens.emphasis)?.type === 'paragraph' && richBlock(projectionTokens.emphasis)?.italic === true,
		bullet: richBlock(projectionTokens.bullet)?.type === 'bulletListItem',
		numbered: richBlock(projectionTokens.numbered)?.type === 'numberedListItem',
		divider: richBlocks.some(block => block.type === 'divider' && block.divider),
		dividerTail: richBlock(projectionTokens.dividerTail)?.type === 'paragraph'
	};
	if (Object.values(richSemantics).some(value => !value)) {
		throw new Error(`The rich projection did not preserve Canvas formatting semantics: ${JSON.stringify({ richSemantics, richBlocks })}`);
	}

	// Exercise the shared commands inside the real BlockNote projection. This
	// intentionally enters through the same validated webview message boundary
	// as the host adapter, then leaves the resulting Markdown for the Canvas
	// projection to parse after Card Detail closes.
	const richKey = decodeURIComponent(await projectionFrame.locator('#root').getAttribute('data-basehalf-key') ?? '');
	if (!richKey) {
		throw new Error('The rich projection did not expose its document key');
	}
	const sendRichFormat = async command => {
		await projectionFrame.evaluate(({ key, command }) => new Promise((resolve, reject) => {
			const message = { type: 'basehalf.markdownRich.command', key, command };
			const onMessage = event => {
				if (event.source !== window
					|| event.data?.type !== message.type
					|| event.data?.key !== key
					|| event.data?.command !== command) {
					return;
				}
				window.clearTimeout(timeout);
				window.removeEventListener('message', onMessage);
				resolve(undefined);
			};
			const timeout = window.setTimeout(() => {
				window.removeEventListener('message', onMessage);
				reject(new Error(`Timed out delivering rich editor command: ${command}`));
			}, 3_000);
			window.addEventListener('message', onMessage);
			window.postMessage(message, '*');
		}), { key: richKey, command });
	};
	const focusRichBlock = async token => {
		const block = projectionFrame.locator('.bn-block-content', { hasText: token }).first();
		await block.scrollIntoViewIfNeeded();
		await block.click();
		return block;
	};
	const selectRichToken = async token => {
		const selected = await projectionFrame.evaluate(expectedToken => {
			const root = document.querySelector('.bn-editor');
			if (!root) {
				return false;
			}
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const start = node.textContent?.indexOf(expectedToken) ?? -1;
				if (start < 0) {
					continue;
				}
				const range = document.createRange();
				range.setStart(node, start);
				range.setEnd(node, start + expectedToken.length);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				document.dispatchEvent(new Event('selectionchange'));
				return true;
			}
			return false;
		}, token);
		if (!selected) {
			throw new Error(`The rich projection did not render selectable text: ${token}`);
		}
		await page.waitForTimeout(50);
	};

	await focusRichBlock(projectionTokens.richHeading1);
	await sendRichFormat('setHeading1');
	await projectionFrame.locator('h1', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('setHeading1');
	await sendRichFormat('undo');
	await projectionFrame.locator('.bn-block-content[data-content-type="paragraph"]', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('redo');
	await projectionFrame.locator('h1', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 3_000 });
	await focusRichBlock(projectionTokens.richHeading2);
	await sendRichFormat('setHeading2');
	await projectionFrame.locator('h2', { hasText: projectionTokens.richHeading2 }).waitFor({ state: 'visible', timeout: 3_000 });
	await focusRichBlock(projectionTokens.richParagraph);
	await sendRichFormat('setHeading1');
	await projectionFrame.locator('h1', { hasText: projectionTokens.richParagraph }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('setParagraph');
	await projectionFrame.locator('.bn-block-content[data-content-type="paragraph"]', { hasText: projectionTokens.richParagraph }).waitFor({ state: 'visible', timeout: 3_000 });

	await selectRichToken(projectionTokens.richEmphasis);
	await sendRichFormat('toggleBold');
	await sendRichFormat('toggleItalic');
	const richCommandEmphasis = projectionFrame.locator('.bn-block-content', { hasText: projectionTokens.richEmphasis });
	await richCommandEmphasis.locator('strong', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 3_000 });
	await richCommandEmphasis.locator('em', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 3_000 });

	await focusRichBlock(projectionTokens.richBullet);
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="bulletListItem"]', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="paragraph"]', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="bulletListItem"]', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await focusRichBlock(projectionTokens.richOrdered);
	await sendRichFormat('toggleOrderedList');
	await projectionFrame.locator('.bn-block-content[data-content-type="numberedListItem"]', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="bulletListItem"]', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleOrderedList');
	await projectionFrame.locator('.bn-block-content[data-content-type="numberedListItem"]', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 3_000 });

	const dividerCountBeforeRichCommand = await projectionFrame.locator('.bn-block-content[data-content-type="divider"] hr').count();
	await focusRichBlock(projectionTokens.richDivider);
	await sendRichFormat('insertDivider');
	await projectionFrame.waitForFunction(expected => document.querySelectorAll('.bn-block-content[data-content-type="divider"] hr').length === expected, dividerCountBeforeRichCommand + 1);
	await sendRichFormat('undo');
	await projectionFrame.waitForFunction(expected => document.querySelectorAll('.bn-block-content[data-content-type="divider"] hr').length === expected, dividerCountBeforeRichCommand);
	if (!(await projectionFrame.locator('h1', { hasText: projectionTokens.richHeading1 }).count())
		|| !(await projectionFrame.locator('.bn-block-content[data-content-type="numberedListItem"]', { hasText: projectionTokens.richOrdered }).count())) {
		throw new Error('One rich Undo crossed the formatting-command boundary');
	}
	await sendRichFormat('redo');
	await projectionFrame.waitForFunction(expected => document.querySelectorAll('.bn-block-content[data-content-type="divider"] hr').length === expected, dividerCountBeforeRichCommand + 1);

	await focusRichBlock(projectionTokens.richHeading3);
	await dispatchMarkdownRichComposition(projectionFrame, 'compositionstart');
	await sendRichFormat('setHeading3');
	if (await projectionFrame.locator('h3', { hasText: projectionTokens.richHeading3 }).count()) {
		throw new Error('The rich projection ran a formatting command before IME composition settled');
	}
	await dispatchMarkdownRichComposition(projectionFrame, 'compositionend');
	await projectionFrame.locator('h3', { hasText: projectionTokens.richHeading3 }).waitFor({ state: 'visible', timeout: 3_000 });

	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [emptyNote]);
	await emptyNote.locator('.bh-md-preview h1', { hasText: projectionTokens.heading1 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.heading2 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h3', { hasText: projectionTokens.heading3 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	const previewEmphasis = emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.emphasis });
	await previewEmphasis.locator('strong', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await previewEmphasis.locator('em', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview ul li', { hasText: projectionTokens.bullet }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview ol li', { hasText: projectionTokens.numbered }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(expected => {
		const preview = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"] .bh-md-preview');
		return preview?.querySelectorAll('hr').length === expected;
	}, dividerCountBeforeRichCommand + 1, { timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h1', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.richHeading2 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h3', { hasText: projectionTokens.richHeading3 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.richParagraph }).waitFor({ state: 'visible', timeout: 15_000 });
	const richCommandPreviewEmphasis = emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.richEmphasis });
	await richCommandPreviewEmphasis.locator('strong', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await richCommandPreviewEmphasis.locator('em', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview ul li', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 15_000 });
	const richFormattedMarkdown = fs.readFileSync(emptyNotePath, 'utf8');
	if (richFormattedMarkdown === canvasFormattedMarkdown) {
		throw new Error('The rich formatting adapter did not serialize any of its semantic edits');
	}
	if (!new RegExp(`^1\\. ${projectionTokens.richOrdered}$`, 'm').test(richFormattedMarkdown)
		|| !new RegExp(`^${projectionTokens.richDivider}\\n\\n(?:---|\\*\\*\\*)$`, 'm').test(richFormattedMarkdown)) {
		throw new Error(`The rich list or divider command did not save standard Markdown: ${JSON.stringify(richFormattedMarkdown)}`);
	}

	// A resting-toolbar command is accepted before its inline projection exists.
	// Expanding immediately afterwards must wait for that edit and its durable
	// working-copy flush instead of dropping or replaying the command later.
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.paragraph }).dblclick();
	const reopenedEmptyNoteEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	await reopenedEmptyNoteEditor.editable.locator('ol li', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 15_000 });
	if ((await reopenedEmptyNoteEditor.editable.locator('hr').count()) !== dividerCountBeforeRichCommand + 1) {
		throw new Error('The Canvas editor did not parse the divider saved by the rich projection');
	}
	await selectCanvasInlineToken(reopenedEmptyNoteEditor.editable, projectionTokens.paragraph);
	await page.keyboard.press('Escape');
	await reopenedEmptyNoteEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNoteToolbar.getByRole('button', { name: 'Heading 2', exact: true }).click();
	await emptyNoteToolbar.getByRole('button', { name: 'Expand smoke-note.md', exact: true }).click();
	await assertCardDetail(page, 'smoke-note.md');
	const immediateExpandFrame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	await immediateExpandFrame.locator('h2', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	await waitUntil(
		() => new RegExp(`^## ${projectionTokens.paragraph}$`, 'm').test(fs.readFileSync(emptyNotePath, 'utf8')),
		'resting format command to persist before immediate Expand',
		15_000
	);
	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	// The data card, beside the note, is selected below while a format command
	// waits: both are in sight first.
	await centerCanvasCards(page, [emptyNote, dataCard]);
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });

	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.dividerTail }).dblclick();
	const selectionExitEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	await selectCanvasInlineToken(selectionExitEditor.editable, projectionTokens.dividerTail);
	await page.keyboard.press('Escape');
	await selectionExitEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNoteToolbar.getByRole('button', { name: 'Heading 1', exact: true }).click();
	await dataCard.click();
	await selectionExitEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h1', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 15_000 });
	await waitUntil(
		() => new RegExp(`^# ${projectionTokens.dividerTail}$`, 'm').test(fs.readFileSync(emptyNotePath, 'utf8')),
		'resting format command to persist before selecting another card',
		15_000
	);

	// Direct navigation does not originate from the selected-card delegate. Its
	// navigation barrier must still wait for a resting format intent to mount,
	// execute, and reach disk before Quick Open changes the visible resource.
	await emptyNote.click();
	await emptyNoteToolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.paragraph }).dblclick();
	const quickOpenExitEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	await selectCanvasInlineToken(quickOpenExitEditor.editable, projectionTokens.paragraph);
	await page.keyboard.press('Escape');
	await quickOpenExitEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNoteToolbar.getByRole('button', { name: 'Heading 3', exact: true }).click();
	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	await waitUntil(
		() => new RegExp(`^### ${projectionTokens.paragraph}$`, 'm').test(fs.readFileSync(emptyNotePath, 'utf8')),
		'resting format command to persist before direct Quick Open navigation',
		15_000
	);
	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [emptyNote]);
	await emptyNote.locator('.bh-md-preview h3', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]', 'Canvas to rich projection round trip');
	if (await page.getByRole('button', { name: /save/i }).filter({ visible: true }).count()) {
		throw new Error('Inline Note editing exposed an explicit Save action');
	}

	// The data file has a row that BaseHalf placed: it is deleted on the
	// canvas, so that its row goes with it. The note's row, from New Note, is
	// the user's and stays when the file goes.
	await page.keyboard.press('Escape');
	await centerCanvasCards(page, [dataCard]);
	await deleteCanvasCardFromItsMenu(page, 'smoke-data.json');
	fs.rmSync(path.join(workspacePath, 'smoke-note.md'), { force: true });
	await emptyNote.waitFor({ state: 'detached', timeout: 10_000 });
}

/**
 * Deletes an item with Delete... in its card's menu, as a user does. Its row
 * leaves the layout with it at once; a file removed from disk would leave a
 * row that BaseHalf placed, removed a minute later in a write of its own.
 */
async function deleteCanvasCardFromItsMenu(page, name) {
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	await card.click({ button: 'right' });
	await clickCanvasMenuAction(page, 'Delete...');
	const dialog = page.locator('.monaco-dialog-box', { hasText: `'${name}'` }).first();
	await dialog.waitFor({ state: 'visible', timeout: 10_000 });
	await dialog.locator('.monaco-button', { hasText: /^(Delete Permanently|Move to Trash)$/ }).click();
	await waitUntil(() => !fs.existsSync(path.join(workspacePath, name)), `${name} to be deleted`);
	await card.waitFor({ state: 'hidden', timeout: 10_000 });
}

/** Runs an action of the canvas menu that is open. */
async function clickCanvasMenuAction(page, label) {
	const action = page.locator('.context-view.monaco-menu-container .action-label')
		.filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
		.filter({ visible: true })
		.last();
	await action.waitFor({ state: 'visible', timeout: 10_000 });
	// The menu takes a click only after its guard against the press that opened it.
	await page.waitForTimeout(150);
	await action.click();
}

/** A point of empty canvas with room for a card of `width` by `height` right of and below it. */
async function roomyCanvasPoint(page, width, height) {
	const point = await page.evaluate(([cardWidth, cardHeight]) => {
		const pane = document.querySelector('.basehalf-canvas-cards .react-flow__pane');
		if (!(pane instanceof HTMLElement)) {
			return undefined;
		}
		const box = pane.getBoundingClientRect();
		// The caption stands above a card: keep room for it too.
		for (let y = box.top + 60; y + cardHeight < box.bottom - 24; y += 24) {
			for (let x = box.left + 24; x + cardWidth < box.right - 24; x += 24) {
				const corners = [[0, -40], [cardWidth, -40], [0, cardHeight], [cardWidth, cardHeight], [cardWidth / 2, cardHeight / 2]];
				if (corners.every(([dx, dy]) => pane.ownerDocument.elementFromPoint(x + dx, y + dy) === pane)) {
					return { x, y };
				}
			}
		}
		return undefined;
	}, [width, height]);
	if (!point) {
		throw new Error(`The canvas has no empty room of ${width} by ${height}`);
	}
	return point;
}

/**
 * Canvas Create menu, criteria 3 to 8: New Folder makes `untitled folder` at
 * once, with no box, field, or message in any frame, at the point of the
 * secondary click, selected, and the canvas stays. The Create button makes
 * `untitled folder 2`, in sight. A double click on the name opens the rename
 * editor with the whole name selected. One undo on the canvas removes the
 * folder and its card, and redo makes it again. The step hands the view back
 * as it found it.
 */
export async function assertCanvasNewFolder(page) {
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const readmeBefore = await readme.boundingBox();
	if (!readmeBefore) {
		throw new Error('The README card must be drawn before New Folder');
	}
	const isFolder = name => fs.existsSync(path.join(workspacePath, name)) && fs.statSync(path.join(workspacePath, name)).isDirectory();
	const cardFor = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	const undo = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
	const redo = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
	await page.keyboard.press('Escape');

	// Every frame from the click on: a box, a field, or a message for a name.
	await page.evaluate(() => {
		const watch = { running: true, frames: 0, named: 0 };
		globalThis.basehalfNewFolderWatch = watch;
		const tick = () => {
			if (!watch.running) {
				return;
			}
			watch.frames++;
			if (document.querySelector('.basehalf-canvas-inline-create-card, .basehalf-canvas-inline-name-editor, .basehalf-canvas-surface .monaco-inputbox, .context-view .monaco-inputbox-container')) {
				watch.named++;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	const point = await roomyCanvasPoint(page, 260, 200);
	await page.mouse.click(point.x, point.y, { button: 'right' });
	await clickCanvasMenuAction(page, 'New Folder');
	await waitUntil(() => isFolder('untitled folder'), 'New Folder to make untitled folder');
	const first = cardFor('untitled folder');
	await first.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForCanvasCardSelection(page, 'untitled folder');
	await page.waitForTimeout(300);
	const watch = await page.evaluate(() => {
		const state = globalThis.basehalfNewFolderWatch;
		state.running = false;
		return { frames: state.frames, named: state.named };
	});
	const node = await page.locator('.react-flow__node[data-id="untitled folder"]').boundingBox();
	if (watch.frames < 5 || watch.named !== 0 || !node || Math.abs(node.x - point.x) > 1 || Math.abs(node.y - point.y) > 1) {
		throw new Error(`New Folder must make its card at the point with nothing to fill in: ${JSON.stringify({ watch, point, node })}`);
	}
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false) || await page.locator('.quick-input-widget').isVisible()) {
		throw new Error('New Folder opened Card Detail or Quick Input instead of staying on the canvas');
	}

	// The Create button: the next free name, in sight.
	await clickCanvasCreateAction(page, 'New Folder');
	await waitUntil(() => isFolder('untitled folder 2'), 'the second New Folder to make untitled folder 2');
	const second = cardFor('untitled folder 2');
	await second.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForCanvasCardSelection(page, 'untitled folder 2');
	await page.waitForTimeout(300);
	const secondBox = await second.boundingBox();
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	if (!secondBox || !canvasBox || secondBox.x < canvasBox.x || secondBox.y < canvasBox.y
		|| secondBox.x + secondBox.width > canvasBox.x + canvasBox.width || secondBox.y + secondBox.height > canvasBox.y + canvasBox.height) {
		throw new Error(`New Folder from the Create button must make a card in sight: ${JSON.stringify({ secondBox, canvasBox })}`);
	}

	// The name is changed on the card: the whole name is selected.
	const label = first.locator('.basehalf-canvas-card-label');
	const labelBox = await label.boundingBox();
	await page.mouse.click(labelBox.x + 8, labelBox.y + labelBox.height / 2);
	await page.waitForTimeout(200);
	await page.mouse.click(labelBox.x + 8, labelBox.y + labelBox.height / 2, { clickCount: 2 });
	const input = first.locator('.basehalf-canvas-inline-name-input input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => {
		const field = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="untitled folder"] .basehalf-canvas-inline-name-input input');
		return field instanceof HTMLInputElement && document.activeElement === field && field.value === 'untitled folder'
			&& field.selectionStart === 0 && field.selectionEnd === 'untitled folder'.length;
	}, null, { timeout: 5_000 });
	await page.keyboard.press('Escape');
	await input.waitFor({ state: 'detached', timeout: 10_000 });

	// One undo on the canvas takes the last folder back; redo makes it again.
	await page.waitForFunction(() => document.activeElement?.closest('.basehalf-canvas-cards') !== null, null, { timeout: 10_000 });
	await page.keyboard.press(undo);
	await waitUntil(() => !fs.existsSync(path.join(workspacePath, 'untitled folder 2')), 'one undo on the canvas to remove untitled folder 2');
	await second.waitFor({ state: 'detached', timeout: 10_000 });
	if (!isFolder('untitled folder')) {
		throw new Error('One undo must take back only the last New Folder');
	}
	await page.keyboard.press(redo);
	await waitUntil(() => isFolder('untitled folder 2'), 'redo on the canvas to make untitled folder 2 again');
	await second.waitFor({ state: 'visible', timeout: 10_000 });

	// Two more undos take both folders back, the last first, and their rows
	// with them: a folder removed from disk would leave the row that BaseHalf
	// gave the folder that redo made, removed a minute later in a write of its own.
	for (const name of ['untitled folder 2', 'untitled folder']) {
		await page.waitForFunction(() => document.activeElement?.closest('.basehalf-canvas-cards') !== null, null, { timeout: 10_000 });
		await page.keyboard.press(undo);
		await waitUntil(() => !fs.existsSync(path.join(workspacePath, name)), `undo on the canvas to remove ${name}`);
		await cardFor(name).waitFor({ state: 'detached', timeout: 10_000 });
	}
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	await waitUntil(() => ['untitled folder', 'untitled folder 2'].every(name => readCanvasCardGeometry(fs.readFileSync(canvasPath, 'utf8'), name) === undefined), 'the rows of the folders that undo removed to leave canvas.yaml');
	await page.keyboard.press('Escape');
	await panCanvasCardTo(page, readme, { x: readmeBefore.x, y: readmeBefore.y });
}

export async function centerCanvasCards(page, cards) {
	const canvas = page.locator('.basehalf-canvas-cards');
	for (let attempt = 0; attempt < 4; attempt++) {
		const canvasBox = await canvas.boundingBox();
		const cardBoxes = await Promise.all(cards.map(card => card.boundingBox()));
		if (!canvasBox || cardBoxes.some(box => !box)) {
			await page.waitForTimeout(100);
			continue;
		}

		const boxes = cardBoxes;
		const left = Math.min(...boxes.map(box => box.x));
		const right = Math.max(...boxes.map(box => box.x + box.width));
		const top = Math.min(...boxes.map(box => box.y));
		const bottom = Math.max(...boxes.map(box => box.y + box.height));
		const deltaX = canvasBox.x + canvasBox.width / 2 - (left + right) / 2;
		const deltaY = canvasBox.y + canvasBox.height / 2 - (top + bottom) / 2;
		if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) {
			return;
		}

		await panCanvasToward(page, canvasBox, deltaX, deltaY);
	}

	throw new Error('Canvas viewport did not settle around the requested cards');
}

export function readCanvasCardNumber(canvas, cardPath, field) {
	const match = new RegExp(`- path: "${escapeRegExp(cardPath)}"[\\s\\S]*?\\n    ${escapeRegExp(field)}: (-?\\d+(?:\\.\\d+)?)`).exec(canvas);
	return match ? Number(match[1]) : undefined;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
