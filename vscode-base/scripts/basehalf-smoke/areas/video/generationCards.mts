/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Generation cards of images and videos (D63, D64), step by step against the
// local test provider.

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import process from 'process';
import {
	ageTaskRecord,
	assertSameCanvasView,
	canonicalJson,
	canvasCard,
	captureCardFrame,
	cardInformationFiles,
	cardVideoControlBox,
	cardVideoPicturePoint,
	chooseModel,
	chooseSetting,
	clickBlankCanvas,
	clickCanvasCardOnTop,
	clickGenerate,
	clickModel,
	closeAgentArea,
	closePanelMenu,
	createGenerationSmokeFolder,
	drawCanvasConnectionInto,
	END_IMAGE,
	GENERATION_FOLDER,
	GENERATION_TIMEOUT_MS,
	mirrorFolder,
	openModelMenu,
	PARTIAL_FILE_NAME,
	partialFilesSeenInCardFolders,
	openSettings,
	pickInputOnCanvas,
	playCardVideo,
	readCanvasLayout,
	readCardRow,
	readCardToolbar,
	readCardVideoPlayer,
	readCardYaml,
	readCursorAt,
	readGenerationCard,
	readGenerationInfo,
	readGenerationPanel,
	readMade,
	readMentionMenu,
	readPanelGeometry,
	readSettingsPopover,
	readTaskRecords,
	readTextIfThere,
	readUpstreamSidecar,
	replacePrompt,
	runGenerateInTerminal,
	sampleCardPhases,
	savePrompt,
	SCENE_NOTE,
	SCENE_NOTE_TEXT,
	seekCardVideo,
	selectGenerationCard,
	showCardOnCanvas,
	START_IMAGE,
	statesOf,
	taskRecordOf,
	TASK_RECORD_FOLDER,
	waitForGenerationPanel,
	waitForGenerationStart,
	watchGenerations,
	workspaceFile,
	writeGenerationInfo,
	writeUpstreamSidecar
} from './generationProbes.mts';
import { filesContaining, pngSize, solidPng, startVideoSmokeProvider } from './videoProvider.mts';
import { workspacePath } from '../../context.mts';
import {
	assertCanvasEdgeGone,
	assertCanvasEdgeVisible,
	assertCanvasFolder,
	assertCanvasMenuOpenedByClick,
	assertNoCanvasFocusRing,
	clickCanvasCreateAction,
	emptyCanvasPoint,
	panCanvasCardTo,
	panCanvasToward,
	readCanvasCardGeometry,
	readCanvasView,
	setCanvasZoomPercent,
	waitForCanvasCardSelection
} from '../../lib/canvas.mts';
import { expectNotification } from '../../lib/notifications.mts';
import { closeProvidersPage, openProvidersPage, readProviderEditor, readProviderRows, SMOKE_PROVIDER, SMOKE_REGION, waitForProvidersPage } from '../../lib/providers.mts';
import { quickOpen, runCommand, visibleQuickInput } from '../../lib/quickInput.mts';
import { assertSettingsFramesShowedOnly, watchSettingsFrames } from '../../lib/settingsFrames.mts';
import { step, waitForReading, waitUntil } from '../../lib/steps.mts';

const UNDO = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';

// The cards of the steps, in the folder of GENERATION_FOLDER. New Video names
// its draft `video.mp4`, then `video-2.mp4`, as the canvas numbers what it
// creates; New Image names its draft `image.png` while no image model was
// used, and after the extension of the last image model used.
const VIDEO = `${GENERATION_FOLDER}/video.mp4`;
// What Generate makes beside VIDEO once that holds its video.
const VIDEO_AGAIN = `${GENERATION_FOLDER}/video-2.mp4`;
// The next New Video: generations that end without a video, then one that a reload interrupts.
const VIDEO_FAILS = `${GENERATION_FOLDER}/video-3.mp4`;
const IMAGE = `${GENERATION_FOLDER}/image.png`;
const IMAGE_JPEG = `${GENERATION_FOLDER}/image.jpg`;
// A video file beside the cards, for the player of a video file's card; it goes again after its step.
const CLIP = `${GENERATION_FOLDER}/clip.mp4`;
// A draft an agent writes.
const AGENT_DRAFT = `${GENERATION_FOLDER}/agent-shot.mp4`;

// The models of the provider SMOKE_PROVIDER that the steps use, by the ids of
// its module: a video model with frames, one that takes 480p and 720p only,
// one with a seed among its advanced settings, one an agent switches to, an
// image model that makes several images in one generation, and one that
// delivers JPEG.
const SEEDANCE = 'seedance-2.5';
const SEEDANCE_SMALL = 'seedance-2.0-fast';
const SEEDANCE_SEED = 'seedance-1.0-pro';
const SEEDANCE_AGENT = 'seedance-2.0';
const SET_MODEL = 'seedream-5.0-lite';
const JPEG_MODEL = 'seedream-4.5';

const VIDEO_PROMPT = 'A cyclist rides along the sea at dusk, the camera follows slowly';
// The prompt once `@` has typed the name of the end frame into it.
const VIDEO_PROMPT_WITH_NAME = `${VIDEO_PROMPT} Image 2`;
// What the provider module of SMOKE_PROVIDER says of a prompt that sets the resolution itself.
const PROMPT_FLAG_PROBLEM = 'The prompt sets --rs; choose it in the settings instead, so that what the panel shows is sent.';
// The test provider makes a video in this long; Generate first asks 3 s after the task is made.
const VIDEO_PROVIDER_DURATION_MS = 2_000;
// The relay holds each create request this long, so a card is read while it is `submitting`.
const VIDEO_PROVIDER_CREATE_HOLD_MS = 1_500;

// The test provider, and what the steps learn from the window: the models the
// Providers page names for each kind, the model its region does not offer,
// the test key of a second provider, and the prompt typed into VIDEO.
const smoke = { provider: undefined, models: undefined, notOffered: undefined, secondKey: undefined, prompt: undefined };

// --- Generation cards (D63, D64, docs/specs/generation-cards.md) -----------------------------------
//
// Acceptance criteria 1 to 8, 13 to 29, and 32 to 38 of generation cards,
// through the window and against the local test provider with its test key,
// reached through the provider module of SMOKE_PROVIDER; no paid provider is
// called. Criterion 30, Sequence, is in workflowTemplate.mts. The steps run
// in order, each where the one before ended.

export async function runGenerationCardSteps(page) {
	await step('video-new-video-makes-draft', () => assertNewVideoMakesDraft(page));
	await step('video-prompt-saves-without-dialog', () => assertPromptSavesWithoutDialog(page));
	await step('video-new-image-makes-draft', () => assertNewImageMakesDraft(page));
	await step('video-providers-set-up', () => assertProvidersSetUp(page));
	await step('video-panel-model-and-settings', () => assertPanelModelAndSettings(page));
	await step('video-provider-key-stays-secret', () => assertProviderKeyStaysSecret(page));
	await step('video-image-model-menu', () => assertImageModelMenu(page));
	await step('video-panel-inputs-and-names', () => assertPanelInputsAndNames(page));
	await step('video-panel-placement', () => assertPanelPlacement(page));
	await step('video-prompt-and-agent-write-together', () => assertPromptAndAgentWriteTogether(page));
	await step('video-generate-lands-video', () => assertGenerateLandsVideo(page));
	await step('video-card-detail-shows-what-made-it', () => assertCardDetailShowsWhatMadeIt(page));
	await step('video-capture-frames', () => assertCaptureFrames(page));
	await step('video-card-keeps-its-player', () => assertCardKeepsItsPlayer(page));
	await step('video-card-player-gestures', () => assertCardPlayerGestures(page));
	await step('video-generate-again-makes-draft', () => assertGenerateAgainMakesDraft(page));
	await step('video-generation-fails-and-stops', () => assertGenerationFailsAndStops(page));
	await step('video-image-generations', () => assertImageGenerations(page));
	await step('video-image-arrives-as-jpeg', () => assertImageArrivesAsJpeg(page));
	await step('video-reload-continues-generations', () => assertReloadContinuesGenerations(page));
	await step('video-agent-generates', () => assertAgentGenerates(page));
	await step('video-renames-keep-cards', () => assertRenamesKeepCards(page));
	await step('video-missing-file-comes-back', () => assertMissingFileComesBack(page));
	await step('video-conflict-markers-keep-the-card', () => assertConflictMarkersKeepTheCard(page));
	await step('video-file-at-draft-path', () => assertFileAtDraftPath(page));
	await step('video-delete-draft-and-undo', () => assertDeleteDraftAndUndo(page));
}

// Criterion 1: no partial file is in the folder of a card at any time while
// its files land. Every generation of the suite was watched for one, also
// for a moment between two readings, as the file system reports it. A name
// `.<file>.exclusive.<id>` is where the file system's exclusive create
// writes the bytes before it links them to the file's name.
export async function assertLandingLeftNoPartialFile() {
	const seen = partialFilesSeenInCardFolders();
	if (seen.length) {
		throw new Error(`While files landed, ${seen.length} partial files were in the folders of their cards: ${JSON.stringify(seen)}`);
	}
}

export async function videoSmokeProvider() {
	smoke.provider ??= await startVideoSmokeProvider({ durationMs: VIDEO_PROVIDER_DURATION_MS, holdCreateMs: VIDEO_PROVIDER_CREATE_HOLD_MS });
	return smoke.provider;
}

export async function stopVideoSmokeProvider() {
	const provider = smoke.provider;
	smoke.provider = undefined;
	await provider?.close().catch(error => console.error(`[basehalf-smoke] the video test provider did not stop: ${error instanceof Error ? error.message : String(error)}`));
}

// --- helpers of the steps --------------------------------------------------------------------------

/** What a draft holds: exactly `info` in its `generation.yaml`, the card information files `files`, and no file. */
function assertDraftInformation(cardPath, info, what, files = ['generation.yaml']) {
	const read = readGenerationInfo(cardPath);
	if (canonicalJson(read) !== canonicalJson(info) || fs.existsSync(workspaceFile(cardPath)) || JSON.stringify(cardInformationFiles(cardPath)) !== JSON.stringify(files)) {
		throw new Error(`${what} must leave ${cardPath} a draft with ${canonicalJson(info)} and ${files.join(', ')}, and no file: ${JSON.stringify({ read, file: fs.existsSync(workspaceFile(cardPath)), files: cardInformationFiles(cardPath) })}`);
	}
}

/** The prompt, provider, model, mode, and values of a card, without the prompt. */
function choiceOf(info) {
	const { prompt: _prompt, ...choice } = info ?? {};
	return choice;
}

/**
 * Checks the states a record went through: `expected` in order, where a state
 * with a question mark may be missing, and nothing else.
 */
function assertStates(seen, expected, what) {
	const states = statesOf(seen);
	let index = 0;
	for (const wanted of expected) {
		const optional = wanted.endsWith('?');
		const state = optional ? wanted.slice(0, -1) : wanted;
		if (states[index] === state) {
			index++;
		} else if (!optional) {
			throw new Error(`${what} must go ${expected.join(', ')}: ${JSON.stringify(seen?.states)}`);
		}
	}
	if (index !== states.length) {
		throw new Error(`${what} must go ${expected.join(', ')} and nothing else: ${JSON.stringify(seen?.states)}`);
	}
}

async function assertNoDialog(page, what) {
	if (await page.locator('.monaco-dialog-box').count() !== 0) {
		throw new Error(`${what} opened a dialog: ${await page.locator('.monaco-dialog-box').first().innerText()}`);
	}
}

/** The keyboard focus goes from the prompt back to the card: Escape with no menu open. */
async function focusCardFromPrompt(page, cardPath) {
	await page.keyboard.press('Escape');
	await page.waitForFunction(path => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') === path, cardPath, { timeout: 10_000 });
}

/** Clicks Generate and waits until the card's new generation ends or lands. */
async function generateUntilEnded(page, panel) {
	const provider = await videoSmokeProvider();
	const requestsBefore = provider.mock.requests.length;
	const watch = watchGenerations();
	await clickGenerate(panel);
	await watch.until(w => !!w.first() && (w.first().removed || ['failed', 'stopped'].includes(w.first().record.state)), 'the generation to end');
	watch.stop();
	const seen = watch.first();
	return { seen, record: seen.record, requestsBefore, requests: provider.requestsSince(requestsBefore) };
}

/** Makes a draft from the Create menu, and returns its path once it is selected with its panel. */
async function createDraftFromMenu(page, label) {
	const pattern = label === 'New Image' ? /^image(-\d+)?\.(png|jpg)$/ : /^video(-\d+)?\.mp4$/;
	const drafts = () => {
		try {
			return fs.readdirSync(mirrorFolder(GENERATION_FOLDER)).filter(name => pattern.test(name) && fs.existsSync(path.join(mirrorFolder(GENERATION_FOLDER), name, 'generation.yaml'))
				&& !fs.existsSync(path.join(mirrorFolder(GENERATION_FOLDER), name, 'made.yaml')) && !fs.existsSync(workspaceFile(`${GENERATION_FOLDER}/${name}`)));
		} catch {
			return [];
		}
	};
	const before = new Set(drafts());
	await clickCanvasCreateAction(page, label);
	let created;
	await waitUntil(() => (created = drafts().find(name => !before.has(name))) !== undefined, `${label} to make a draft`, 20_000);
	const cardPath = `${GENERATION_FOLDER}/${created}`;
	await waitForCanvasCardSelection(page, cardPath, 15_000);
	const panel = await waitForGenerationPanel(page, cardPath);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.promptFocused, `the prompt of ${cardPath} to have the keyboard focus`);
	return { cardPath, panel };
}

/** Pans the canvas, as the user does, until no card is in sight: the cards lie above the visible part of the canvas. */
async function panBelowTheCards(page) {
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	for (let attempt = 0; attempt < 12; attempt++) {
		const lowest = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('.react-flow__node')).map(node => node.getBoundingClientRect().bottom)));
		if (lowest < canvasBox.y - 20) {
			return;
		}
		await panCanvasToward(page, canvasBox, 0, -(lowest - canvasBox.y + 40));
	}
	throw new Error('The canvas did not move to a part of it where no card is');
}

/**
 * Sets the number of images of an image card in its settings, a step at a
 * time with the keyboard on the slider: each step is saved, and the popover
 * is drawn again with the slider keeping the focus.
 */
async function setImageCount(page, panel, cardPath, count) {
	await openSettings(panel);
	const slider = panel.locator('.bh-video-panel-menu.settings input.bh-video-panel-slider[data-key="count:slider"]');
	let value = readGenerationInfo(cardPath)?.params?.count ?? 1;
	while (value !== count) {
		const next = value < count ? value + 1 : value - 1;
		await slider.focus();
		await page.keyboard.press(value < count ? 'ArrowRight' : 'ArrowLeft');
		await waitForReading(() => readGenerationInfo(cardPath), info => info?.params?.count === next, `${cardPath} to store ${next} images`, 10_000);
		value = next;
	}
	await waitForReading(() => slider.inputValue(), shown => shown === String(count), `the slider to show ${count} images`);
	await closePanelMenu(page, panel, 'settings');
}

/**
 * Reloads the window with Developer: Reload Window, and waits for the
 * workbench and the canvas of `folder` to show again. The command is run
 * without waiting for Quick Input to close, which the reload takes with it.
 */
async function reloadWindow(page, folder) {
	await page.evaluate(() => {
		globalThis.__basehalfSmokeBeforeReload = true;
	});
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill('>Developer: Reload Window');
	const row = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await waitForReading(async () => ((await row.getAttribute('aria-label')) ?? (await row.textContent()) ?? '').replace(/\s+/g, ' ').trim(), text => text.startsWith('Developer: Reload Window'), 'Quick Input to offer Developer: Reload Window');
	await page.keyboard.press('Enter');
	await waitForReading(() => page.evaluate(() => !globalThis.__basehalfSmokeBeforeReload && document.querySelector('.basehalf-canvas-workbench') !== null), reloaded => reloaded, 'the window to reload', 60_000);
	await page.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	const current = await page.locator('.basehalf-command-center-breadcrumb-segment.current').last().getAttribute('title', { timeout: 20_000 }).catch(() => null);
	if (current !== [path.basename(workspacePath), ...folder.split('/')].join(' / ')) {
		await quickOpen(page, folder);
	}
	await assertCanvasFolder(page, folder);
}

/** The rows of a folder in Files, the Explorer, with the folder open; a draft is not among them. */
async function assertNotInFiles(page, folder, names) {
	const list = page.locator('.explorer-viewlet .monaco-list').first();
	if (!await list.isVisible().catch(() => false)) {
		await runCommand(page, 'Focus on Files Explorer');
		await list.waitFor({ state: 'visible', timeout: 10_000 });
	}
	const folderRow = page.locator('.explorer-viewlet .monaco-list-row').filter({ has: page.locator('.label-name', { hasText: new RegExp(`^${folder}$`) }) }).first();
	await folderRow.waitFor({ state: 'visible', timeout: 10_000 });
	if (await folderRow.getAttribute('aria-expanded') !== 'true') {
		await folderRow.locator('.monaco-tl-twistie').click();
		await waitForReading(() => folderRow.getAttribute('aria-expanded'), expanded => expanded === 'true', `the row of ${folder} in Files to open`);
	}
	const rows = await waitForReading(() => page.locator('.explorer-viewlet .monaco-list-row .label-name').allInnerTexts(), shown => shown.includes('start.png') && shown.includes('end.png'), `Files to list the files of ${folder}`);
	const listed = names.filter(name => rows.includes(name));
	if (listed.length) {
		throw new Error(`A draft must not be in Files: ${JSON.stringify({ listed, rows })}`);
	}
}

// --- drafts ----------------------------------------------------------------------------------------

/** Drags the card at `cardPath` by its body, as the user does, until its top left corner is at `corner` on screen, and waits for its new place to be saved. */
async function dragCanvasCardTo(page, cardPath, corner) {
	const before = readCardRow(cardPath);
	const grip = await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const rect = card?.getBoundingClientRect();
		if (!card || !rect) {
			return undefined;
		}
		for (const [x, y] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
			const point = { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
			const hit = document.elementFromPoint(point.x, point.y);
			if (hit && card.contains(hit) && !hit.closest('.basehalf-canvas-card-caption, .nodrag')) {
				return { x: point.x, y: point.y, left: rect.left, top: rect.top };
			}
		}
		return undefined;
	}, cardPath);
	if (!grip) {
		throw new Error(`No part of the card ${cardPath} is on top to drag`);
	}
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	await page.mouse.move(grip.x + corner.x - grip.left, grip.y + corner.y - grip.top, { steps: 12 });
	await page.mouse.up();
	await waitUntil(() => {
		const row = readCardRow(cardPath);
		return row !== undefined && (row.x !== before?.x || row.y !== before?.y);
	}, `the card ${cardPath} to be saved where it was dragged`, 10_000);
}

/**
 * Canvas card placement, "A card the user just created is shown": a card made
 * with the Create button is fully in sight once its panel has the keyboard.
 * The view stays when the card's place was in sight in the view as it was,
 * and goes to the card only when it was not, as when the view had no open
 * place for a card of 720 by 405.
 */
async function assertCreatedCardInSight(page, row, viewBefore, what) {
	const viewAfter = await readCanvasView(page);
	const onScreen = view => ({ left: view.x + row.x * view.zoom, top: view.y + row.y * view.zoom, right: view.x + (row.x + row.width) * view.zoom, bottom: view.y + (row.y + row.height) * view.zoom });
	const inSight = (view, rect) => rect.left >= view.canvas.left - 1 && rect.top >= view.canvas.top - 1 && rect.right <= view.canvas.right + 1 && rect.bottom <= view.canvas.bottom + 1;
	const sameView = Math.abs(viewBefore.x - viewAfter.x) <= 0.5 && Math.abs(viewBefore.y - viewAfter.y) <= 0.5 && Math.abs(viewBefore.zoom - viewAfter.zoom) <= 0.001;
	const placedInSight = inSight(viewBefore, onScreen(viewBefore));
	if (!inSight(viewAfter, onScreen(viewAfter)) || sameView !== placedInSight) {
		throw new Error(`${what} must put its card in sight, and move the view only when the card's place was out of sight: ${JSON.stringify({ row, viewBefore, viewAfter, placedInSight, sameView })}`);
	}
}

// Criteria 2, 15, the first half of 18, and the first half of 32: New Video
// makes a draft, `video.mp4`: a card selected with its panel and its prompt
// focused with no ring, a `generation.yaml` with an empty prompt and no model,
// no file, and nothing in Files; the card is in sight, and the view moves only
// when the view as it was had no open place for it; with no model Generate is
// disabled and says why, also in its tooltip; the toolbar offers Upload
// Video. Undo takes the draft back with its place, and redo brings it back.
async function assertNewVideoMakesDraft(page) {
	await videoSmokeProvider();
	createGenerationSmokeFolder();
	await quickOpen(page, GENERATION_FOLDER);
	await assertCanvasFolder(page, GENERATION_FOLDER);
	for (const cardPath of [START_IMAGE, END_IMAGE, SCENE_NOTE]) {
		await canvasCard(page, cardPath).waitFor({ state: 'visible', timeout: 20_000 });
	}
	// The view as the folder opened: the new card, 720 by 405, is centered on
	// its middle, or at the nearest open place in sight, or the view goes to it.
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	const viewBefore = await readCanvasView(page);

	await clickCanvasCreateAction(page, 'New Video');
	await waitUntil(() => readGenerationInfo(VIDEO) !== undefined, `New Video to make the draft ${VIDEO}`, 20_000);
	// No generation ran on this computer yet: the draft chooses no model.
	assertDraftInformation(VIDEO, { prompt: '' }, 'New Video');
	await waitForCanvasCardSelection(page, VIDEO, 15_000);
	const card = await waitForReading(() => readGenerationCard(page, VIDEO), seen => seen?.face?.state === 'draft', `the card of ${VIDEO} to show a draft`);
	if (card.generation !== 'draft' || card.kind !== 'video' || card.face.kind !== 'video' || !card.face.glyph || card.name !== 'video.mp4' || card.video || card.image) {
		throw new Error(`The card of a new video draft must show the glyph of a video and its name: ${JSON.stringify(card)}`);
	}
	const row = await waitForReading(() => readCardRow(VIDEO), seen => seen !== undefined, `the draft ${VIDEO} to get a place`);
	if (row.width !== 720 || row.height !== 405) {
		throw new Error(`A new video draft is drawn at 720 by 405: ${JSON.stringify(row)}`);
	}
	const panel = await waitForGenerationPanel(page, VIDEO);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.promptFocused, 'the prompt of the new draft to have the keyboard focus');
	await assertNoCanvasFocusRing(page, 'The prompt of the new draft');
	await assertCreatedCardInSight(page, row, viewBefore, 'New Video');
	// The panel shows that the models load until AI Video answers with the catalog.
	const shown = await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === true && seen.catalog === 'ready', 'Generate to be disabled while no model is chosen, once the catalog is there', 30_000);
	// No model and no prompt: the first blocker is the model, and the model button says it; there is no reason line.
	if (shown.kind !== 'video' || shown.generate.label !== 'Choose a model to generate.' || shown.model !== 'Choose Model' || !shown.modelOutlined || shown.generate.stop || shown.reason !== null) {
		throw new Error(`Without a model, Generate must say so as its name and the model button must be outlined: ${JSON.stringify(shown)}`);
	}
	const toolbar = await waitForReading(() => readCardToolbar(page), seen => seen?.path === VIDEO, 'the toolbar of the selected draft');
	if (!toolbar.draft || toolbar.media !== 'video' || toolbar.surface !== 'empty' || JSON.stringify(toolbar.actions) !== JSON.stringify(['importResult']) || toolbar.labels[0] !== 'Upload Video') {
		throw new Error(`The toolbar of a selected video draft must offer Upload Video: ${JSON.stringify(toolbar)}`);
	}
	await panel.locator('button.bh-video-panel-generate').hover();
	await page.locator('.workbench-hover', { hasText: 'Choose a model to generate.' }).waitFor({ state: 'visible', timeout: 10_000 });
	await page.mouse.move(canvasBox.x + 8, canvasBox.y + canvasBox.height - 8);

	// Undo takes the new draft back, with all of its card information and its
	// place; redo brings it back where it was.
	await focusCardFromPrompt(page, VIDEO);
	await page.keyboard.press(UNDO);
	await waitUntil(() => !fs.existsSync(mirrorFolder(VIDEO)), 'undo to take back the new draft with its card information', 10_000);
	await canvasCard(page, VIDEO).waitFor({ state: 'detached', timeout: 10_000 });
	await waitUntil(() => readCardRow(VIDEO) === undefined, 'undo to take back the place of the new draft', 10_000);
	await canvasCard(page, START_IMAGE).focus();
	await page.keyboard.press(REDO);
	await waitUntil(() => readGenerationInfo(VIDEO) !== undefined, 'redo to bring the draft back', 10_000);
	assertDraftInformation(VIDEO, { prompt: '' }, 'Redo of New Video');
	await canvasCard(page, VIDEO).waitFor({ state: 'attached', timeout: 10_000 });
	await waitUntil(() => {
		const back = readCardRow(VIDEO);
		return back?.x === row.x && back.y === row.y;
	}, 'redo to bring the draft back to its place', 10_000);

	// The steps after this one work at half size, with the images at the top
	// left and the video card to their right, its corner at the middle.
	await setCanvasZoomPercent(page, 50);
	await panCanvasCardTo(page, canvasCard(page, START_IMAGE), { x: canvasBox.x + 40, y: canvasBox.y + 60 });
	await dragCanvasCardTo(page, VIDEO, { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 });

	// A draft is a card, not yet a file: it is not in Files.
	await assertNotInFiles(page, GENERATION_FOLDER, ['video.mp4']);
}

// Criterion 3 and the first half of 33: the prompt typed with the keyboard,
// with no ring around it, is saved to the draft's `generation.yaml` when the
// user clicks the canvas, without a model and without a dialog, the panel goes
// with the card's selection, and the panel reads the prompt back the same.
async function assertPromptSavesWithoutDialog(page) {
	const panel = await selectGenerationCard(page, VIDEO);
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await waitForReading(() => readGenerationPanel(panel), seen => seen.promptFocused, 'the prompt to have the keyboard focus');
	await page.keyboard.type(VIDEO_PROMPT);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === VIDEO_PROMPT, 'the prompt to hold what was typed');
	await assertNoCanvasFocusRing(page, 'The prompt while it is typed in');
	await clickBlankCanvas(page);
	await waitUntil(() => readGenerationInfo(VIDEO)?.prompt === VIDEO_PROMPT, `the typed prompt to be saved in the generation.yaml of ${VIDEO}`, 10_000);
	await waitForReading(() => page.locator('.basehalf-canvas-video-panel-surface').count(), count => count === 0, 'the panel to go when its card is no longer selected');
	// Saving never asks, also a moment later, and chooses no model.
	await page.waitForTimeout(500);
	await assertNoDialog(page, 'Saving the prompt of a draft');
	assertDraftInformation(VIDEO, { prompt: VIDEO_PROMPT }, 'Saving the prompt');
	const again = await selectGenerationCard(page, VIDEO);
	await waitForReading(() => readGenerationPanel(again), seen => seen.prompt === VIDEO_PROMPT && !seen.promptFocused, 'the panel to read the saved prompt back');
	await clickBlankCanvas(page);
}

// Criterion 2 for images: New Image makes a draft named `image.png`, since no
// image model was used, drawn at the size of a file card, with its panel and
// the toolbar's Upload Image.
async function assertNewImageMakesDraft(page) {
	await clickCanvasCreateAction(page, 'New Image');
	await waitUntil(() => readGenerationInfo(IMAGE) !== undefined, `New Image to make the draft ${IMAGE}`, 20_000);
	assertDraftInformation(IMAGE, { prompt: '' }, 'New Image');
	await waitForCanvasCardSelection(page, IMAGE, 15_000);
	const card = await waitForReading(() => readGenerationCard(page, IMAGE), seen => seen?.face?.state === 'draft', `the card of ${IMAGE} to show a draft`);
	if (card.generation !== 'draft' || card.kind !== 'image' || card.face.kind !== 'image' || !card.face.glyph || card.name !== 'image.png') {
		throw new Error(`The card of a new image draft must show the glyph of an image and its name: ${JSON.stringify(card)}`);
	}
	const row = await waitForReading(() => readCardRow(IMAGE), seen => seen !== undefined, `the draft ${IMAGE} to get a place`);
	if (row.width !== 300 || row.height !== 220) {
		throw new Error(`A new image draft is drawn at the size of a file card, 300 by 220: ${JSON.stringify(row)}`);
	}
	const panel = await waitForGenerationPanel(page, IMAGE);
	const shown = await waitForReading(() => readGenerationPanel(panel), seen => seen.promptFocused && seen.catalog === 'ready', 'the prompt of the new image draft to have the keyboard focus');
	if (shown.kind !== 'image' || shown.generate?.label !== 'Choose a model to generate.') {
		throw new Error(`The panel of an image draft must be one of an image card without a model: ${JSON.stringify(shown)}`);
	}
	const toolbar = await waitForReading(() => readCardToolbar(page), seen => seen?.path === IMAGE, 'the toolbar of the selected image draft');
	if (!toolbar.draft || toolbar.media !== 'image' || JSON.stringify(toolbar.actions) !== JSON.stringify(['importResult']) || toolbar.labels[0] !== 'Upload Image') {
		throw new Error(`The toolbar of a selected image draft must offer Upload Image: ${JSON.stringify(toolbar)}`);
	}
	await clickBlankCanvas(page);
}

// --- Providers and the panel -------------------------------------------------------------------------

// Criteria 13 and 14: the page sets up the provider of the catalog in a
// region of its own, and points it at the test provider, a relay on this
// computer that mirrors the provider's own API. Its credentials come in a
// later step, so the model menu first shows it as not set up. The page names
// each provider's models under Images and Videos, and dims a model the
// region does not offer. Settings, opened for the first time in this window,
// shows the page from its first frame on (settings pages, criterion 1).
async function assertProvidersSetUp(page) {
	const provider = await videoSmokeProvider();
	await watchSettingsFrames(page);
	const providers = await openProvidersPage(page);
	await assertSettingsFramesShowedOnly(page, 'Providers', 'basehalf-video-providers', 'The command Providers');
	await waitForReading(() => readProviderRows(providers), seen => seen.some(row => row.id === SMOKE_PROVIDER) && seen.some(row => row.id === 'minimax'), `the page to list ${SMOKE_PROVIDER}`, 30_000);
	const chooseRegion = async (providerId, regionId) => {
		await providers.locator(`.basehalf-video-provider-row[data-provider="${providerId}"]`).click();
		const editor = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === providerId, `the page to show ${providerId}`);
		if (!editor.regions.some(region => region.id === regionId)) {
			throw new Error(`${providerId} must offer the region ${regionId}: ${JSON.stringify(editor)}`);
		}
		if (!editor.regions.find(region => region.id === regionId)?.checked) {
			await providers.locator(`.basehalf-video-provider-region[data-region="${regionId}"]`).click();
		}
		return waitForReading(() => readProviderEditor(providers), seen => seen.provider === providerId && seen.regions.find(region => region.id === regionId)?.checked === true, `the region ${regionId} of ${providerId} to be chosen`);
	};
	await chooseRegion(SMOKE_PROVIDER, SMOKE_REGION);
	await providers.locator('.basehalf-video-provider-field.endpoint input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(provider.endpoint);
	await page.keyboard.press('Enter');
	const saved = await waitForReading(() => readProviderEditor(providers), seen => seen.endpoint === provider.endpoint && seen.customEndpoint, 'the endpoint of the test provider to be saved');
	if (saved.rowSetUp !== 'false' || saved.credentials.some(credential => credential.set)) {
		throw new Error(`Without its credentials, ${SMOKE_PROVIDER} must not be set up: ${JSON.stringify(saved)}`);
	}
	// The models by kind, as a card of each kind will list them.
	const models = kind => saved.kinds.find(line => line.kind === kind)?.models.map(model => model.id) ?? [];
	smoke.models = { image: models('image'), video: models('video') };
	if (!smoke.models.video.includes(SEEDANCE) || !smoke.models.image.includes(SET_MODEL) || !smoke.models.image.includes(JPEG_MODEL) || saved.kinds.some(line => line.models.some(model => model.unavailable))) {
		throw new Error(`The page must name the models of ${SMOKE_PROVIDER} under Images and Videos, all offered in ${SMOKE_REGION}: ${JSON.stringify(saved.kinds)}`);
	}
	// In its international region, MiniMax does not offer one of its image
	// models: the page dims it, with the reason.
	const minimax = await chooseRegion('minimax', 'intl');
	const notOffered = minimax.kinds.flatMap(line => line.models).find(model => model.unavailable);
	if (!notOffered || !/ is not offered in International\.$/.test(notOffered.description ?? '')) {
		throw new Error(`The page must dim the model that a region does not offer, with the reason: ${JSON.stringify(minimax.kinds)}`);
	}
	smoke.notOffered = { provider: 'minimax', model: notOffered.id };
	await closeProvidersPage(page, providers);
	await assertCanvasFolder(page, GENERATION_FOLDER);
}

// Criteria 14, 17, 18, and 34, and the second half of 33: the model menu of a
// video card lists the video models of the catalog by provider, with their
// abilities, says that the provider is not set up, and ends with the way to
// Providers; opened by a click, it has no current item and no ring; choosing
// a model stores it with its mode and the defaults of its values, and leaves
// no ring on the model button; Generate names the provider that is not set
// up, also on a line above the footer with Set Up; the settings popover is
// drawn from the model's parameters with the advanced ones under More; a
// change is shown and stored at once; a model that does not accept a value
// gives it its default; a field of the popover shows its focus by its border
// alone; and Set Up opens Providers at the provider.
async function assertPanelModelAndSettings(page) {
	const panel = await selectGenerationCard(page, VIDEO);
	const menu = await openModelMenu(panel);
	await assertCanvasMenuOpenedByClick(page, '.bh-video-panel-menu.model', 'The model menu');
	const group = menu.groups.find(candidate => candidate.provider === SMOKE_PROVIDER);
	if (!group || group.detail !== 'Not set up' || JSON.stringify(group.items.map(item => item.model)) !== JSON.stringify(smoke.models.video)
		|| JSON.stringify(menu.end) !== JSON.stringify(['Providers…'])) {
		throw new Error(`The model menu of a video card must list ${SMOKE_PROVIDER}'s video models as not set up, and end with Providers…: ${JSON.stringify(menu)}`);
	}
	// A video card offers no image model.
	const imageModels = menu.groups.flatMap(candidate => candidate.items.filter(item => candidate.provider === SMOKE_PROVIDER ? smoke.models.image.includes(item.model) : candidate.provider === smoke.notOffered.provider && item.model === smoke.notOffered.model));
	if (imageModels.length) {
		throw new Error(`The model menu of a video card must list no image model: ${JSON.stringify(imageModels)}`);
	}
	// Each model with its abilities on a second line, its modes first.
	if (menu.groups.some(candidate => candidate.items.some(item => !item.detail || !/^(Frames|References|Extend|Edit)\b/.test(item.detail)))) {
		throw new Error(`Every video model must show its abilities under its name: ${JSON.stringify(menu.groups.map(candidate => candidate.items))}`);
	}
	const seedance = group.items.find(item => item.model === SEEDANCE);
	await clickModel(page, panel, SMOKE_PROVIDER, SEEDANCE);
	const afterChoice = await assertNoCanvasFocusRing(page, 'The model button after a model was chosen with the mouse');
	if (!afterChoice.element?.includes('bh-video-panel-model')) {
		throw new Error(`Choosing a model must give the focus back to the model button: ${JSON.stringify(afterChoice)}`);
	}
	const chosen = await waitForReading(() => readGenerationInfo(VIDEO), info => info?.provider === SMOKE_PROVIDER && info.model === SEEDANCE
		&& typeof info.mode === 'string' && info.params && typeof info.params === 'object', 'choosing the model to store its provider, model, mode, and values', 10_000);
	// Frames take the two images of the next steps; the prompt stays.
	if (chosen.mode !== 'frames' || chosen.prompt !== VIDEO_PROMPT) {
		throw new Error(`${SEEDANCE} must start in frames mode, and keep the prompt: ${JSON.stringify(chosen)}`);
	}
	const blocked = await waitForReading(() => readGenerationPanel(panel), seen => seen.model === seedance.label && / is not set up\. Set it up in Providers\.$/.test(seen.generate?.label ?? ''), 'Generate to say that the provider is not set up');
	if (!blocked.generate.disabled || !blocked.modelOutlined || blocked.reason?.text !== blocked.generate.label || blocked.reason?.action !== 'Set Up') {
		throw new Error(`Without its credentials, Generate must be disabled, the model button outlined, and the reason shown with Set Up: ${JSON.stringify(blocked)}`);
	}

	let settings = await openSettings(panel);
	if (settings.width !== 300 || JSON.stringify(settings.parameters) !== JSON.stringify(['resolution', 'ratio', 'duration', 'sound']) || settings.advanced.length) {
		throw new Error(`The settings popover must be drawn from the model's parameters for its mode, 300 px wide, with the advanced ones under More: ${JSON.stringify(settings)}`);
	}
	await panel.locator('.bh-video-panel-menu.settings button.bh-video-panel-more').click();
	settings = await waitForReading(() => readSettingsPopover(panel), seen => (seen?.advanced.length ?? 0) > 0, 'More to show the advanced settings');
	if (JSON.stringify(settings.advanced) !== JSON.stringify(['watermark'])) {
		throw new Error(`More must show the advanced settings of the model: ${JSON.stringify(settings)}`);
	}
	// A choice is shown and stored at once.
	const before = (await readGenerationPanel(panel)).settings;
	await chooseSetting(panel, VIDEO, 'resolution:1080p', 'resolution', '1080p');
	const changed = await waitForReading(() => readGenerationPanel(panel), seen => seen.settings !== before && seen.settings?.includes('1080p'), 'the settings button to sum up the change');
	if (!changed.settings.startsWith('Frames')) {
		throw new Error(`The settings button must name the mode first: ${JSON.stringify(changed)}`);
	}
	await closePanelMenu(page, panel, 'settings');
	// A model that does not take a value gives it its default and keeps the others.
	const small = await chooseModel(page, panel, VIDEO, SMOKE_PROVIDER, SEEDANCE_SMALL);
	if (small.params.resolution !== '720p' || small.params.duration !== chosen.params.duration || small.params.sound !== chosen.params.sound || small.mode !== 'frames' || small.prompt !== VIDEO_PROMPT) {
		throw new Error(`${SEEDANCE_SMALL} must give 1080p its default and keep the values it takes: ${JSON.stringify({ chosen, small })}`);
	}
	// A field of the settings popover shows its focus by its border alone: the
	// seed of a model that has one, among its advanced settings.
	await chooseModel(page, panel, VIDEO, SMOKE_PROVIDER, SEEDANCE_SEED);
	await openSettings(panel);
	if (await panel.locator('.bh-video-panel-menu.settings .bh-video-panel-advanced').count() === 0) {
		await panel.locator('.bh-video-panel-menu.settings button.bh-video-panel-more').click();
	}
	const field = panel.locator('.bh-video-panel-menu.settings input.bh-video-panel-field[data-key="seed:field"]');
	await field.waitFor({ state: 'visible', timeout: 10_000 });
	const atRest = await field.evaluate(element => getComputedStyle(element).borderColor);
	await field.click();
	const focused = await field.evaluate(element => {
		const style = getComputedStyle(element);
		return { focused: element.ownerDocument.activeElement === element, outline: style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0 ? null : `${style.outlineStyle} ${style.outlineWidth}`, border: style.borderColor, shadow: style.boxShadow };
	});
	if (!focused.focused || focused.outline !== null || focused.border === atRest || focused.shadow !== 'none') {
		throw new Error(`A field of the settings popover must show its focus by its border alone: ${JSON.stringify({ atRest, focused })}`);
	}
	await page.keyboard.press('Escape');
	await waitForReading(() => panel.locator('.bh-video-panel-menu.settings').count(), count => count === 0, 'Escape in a field to close the settings popover');
	const back = await chooseModel(page, panel, VIDEO, SMOKE_PROVIDER, SEEDANCE);
	if (back.mode !== 'frames' || back.prompt !== VIDEO_PROMPT || back.params.seed !== undefined || back.params.camera_fixed !== undefined) {
		throw new Error(`Choosing ${SEEDANCE} again must keep the values it takes and drop the others: ${JSON.stringify(back)}`);
	}
	// Set Up opens Providers at the provider that is not set up, from the
	// first frame of Settings on, though Settings was last closed there.
	await watchSettingsFrames(page);
	await panel.locator('button.bh-video-panel-reason-action').click();
	const providers = await waitForProvidersPage(page);
	await assertSettingsFramesShowedOnly(page, 'Providers', 'basehalf-video-providers', 'Set Up of the panel');
	await waitForReading(() => readProviderEditor(providers), seen => seen.provider === SMOKE_PROVIDER, `Set Up to open Providers at ${SMOKE_PROVIDER}`);
	await closeProvidersPage(page, providers);
	await clickBlankCanvas(page);
}

// Criterion 13: each credential is typed into the page and saved; the page
// then says that it is set and never shows it, and no workspace file holds
// it. With them, the provider is set up and Generate is enabled. A second
// provider, set up with a test key of its own, is listed after it among the
// set-up providers of the next step.
async function assertProviderKeyStaysSecret(page) {
	const provider = await videoSmokeProvider();
	smoke.secondKey = `sk-basehalf-smoke-${randomUUID().replace(/-/g, '')}`;
	const providers = await openProvidersPage(page);
	for (const [providerId, key] of [[SMOKE_PROVIDER, provider.key], ['openai', smoke.secondKey]]) {
		await providers.locator(`.basehalf-video-provider-row[data-provider="${providerId}"]`).click();
		const editor = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === providerId, `the page to show ${providerId}`);
		for (const credential of editor.credentials) {
			const input = providers.locator(`.basehalf-video-provider-field.credential[data-credential="${credential.id}"] input[type="password"]`);
			await input.click();
			await waitForReading(() => input.evaluate(element => element === element.ownerDocument.activeElement, undefined, { timeout: 2_000 }), focused => focused, `the field of ${credential.id} to have the keyboard focus`);
			await page.keyboard.type(key);
			await page.keyboard.press('Enter');
			await waitForReading(() => readProviderEditor(providers), seen => seen.credentials.find(candidate => candidate.id === credential.id)?.set === true, `${credential.id} of ${providerId} to be saved`);
		}
		const saved = await waitForReading(() => readProviderEditor(providers), seen => seen.rowSetUp === 'true', `${providerId} to be set up`);
		if (saved.credentials.some(credential => credential.state !== 'Set. It is encrypted on this computer and never shown.' || credential.input !== null)) {
			throw new Error(`The page must say that every credential is set, without a field that holds it: ${JSON.stringify(saved)}`);
		}
	}
	for (const key of [provider.key, smoke.secondKey]) {
		const inPage = await page.evaluate(secret => ({
			markup: document.documentElement.outerHTML.includes(secret),
			fields: Array.from(document.querySelectorAll('input, textarea')).some(field => field.value.includes(secret))
		}), key);
		const files = filesContaining(workspacePath, key);
		if (inPage.markup || inPage.fields || files.length) {
			throw new Error(`The window or the workspace holds a provider's credentials after they were saved: ${JSON.stringify({ inPage, files })}`);
		}
	}
	await closeProvidersPage(page, providers);
	await assertCanvasFolder(page, GENERATION_FOLDER);
	const panel = await selectGenerationCard(page, VIDEO);
	const ready = await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === false, 'Generate to be enabled once the provider is set up');
	if (ready.generate.label !== 'Generate' || ready.modelOutlined || ready.reason !== null) {
		throw new Error(`With a model, the provider set up, and a prompt, Generate must be ready: ${JSON.stringify(ready)}`);
	}
	await clickBlankCanvas(page);
}

// Criteria 14 and 34: the model menu of an image card lists the image models
// of the catalog, the providers that are set up first, each in the catalog's
// order, each model with its abilities; a model its region does not offer is
// dimmed with the reason; a card without a model opens it with no current
// item and no ring. Choosing an image model that delivers JPEG renames
// `image.png` to `image.jpg` where it is, and one that delivers PNG names it
// `image.png` again.
async function assertImageModelMenu(page) {
	let panel = await selectGenerationCard(page, IMAGE);
	const menu = await openModelMenu(panel);
	await assertCanvasMenuOpenedByClick(page, '.bh-video-panel-menu.model', 'The model menu of a card without a model');
	const order = menu.groups.map(group => group.provider);
	const bytedance = menu.groups[0];
	const second = menu.groups[1];
	if (order[0] !== SMOKE_PROVIDER || order[1] !== 'openai' || !bytedance.detail || bytedance.detail === 'Not set up' || second.detail !== null
		|| menu.groups.slice(2).some(group => group.detail !== 'Not set up') || JSON.stringify(menu.end) !== JSON.stringify(['Providers…'])) {
		throw new Error(`The model menu must list the providers that are set up first, then the others, and end with Providers…: ${JSON.stringify(menu.groups.map(group => ({ provider: group.provider, detail: group.detail })))}`);
	}
	if (JSON.stringify(bytedance.items.map(item => item.model)) !== JSON.stringify(smoke.models.image)) {
		throw new Error(`An image card must list ${SMOKE_PROVIDER}'s image models: ${JSON.stringify(bytedance.items)}`);
	}
	// The abilities of an image model: its largest resolution, how many images it can make, and how many references it takes.
	const set = bytedance.items.find(item => item.model === SET_MODEL);
	if (!/\bUp to \d+ images\b/.test(set?.detail ?? '') || !/\b\d+ references?\b/.test(set?.detail ?? '') || menu.groups.some(group => group.items.some(item => !item.detail))) {
		throw new Error(`Every image model must show its abilities under its name: ${JSON.stringify(bytedance.items)}`);
	}
	const notOffered = menu.groups.find(group => group.provider === smoke.notOffered.provider)?.items.find(item => item.model === smoke.notOffered.model);
	if (!notOffered?.unavailable || !/^Not offered in International\b/.test(notOffered.description ?? '')) {
		throw new Error(`A model the provider's region does not offer must be dimmed with the reason: ${JSON.stringify(notOffered)}`);
	}
	const row = readCardRow(IMAGE);
	await clickModel(page, panel, SMOKE_PROVIDER, JPEG_MODEL);
	await waitUntil(() => readGenerationInfo(IMAGE_JPEG)?.model === JPEG_MODEL && !fs.existsSync(mirrorFolder(IMAGE)), `choosing ${JPEG_MODEL}, which delivers JPEG, to rename ${IMAGE} to ${IMAGE_JPEG}`, 10_000);
	await canvasCard(page, IMAGE_JPEG).waitFor({ state: 'attached', timeout: 10_000 });
	await waitUntil(() => {
		const moved = readCardRow(IMAGE_JPEG);
		return moved?.x === row.x && moved.y === row.y && readCardRow(IMAGE) === undefined;
	}, `the card of ${IMAGE_JPEG} to keep the place of ${IMAGE}`, 10_000);
	// The panel of the card at its new name.
	panel = await waitForGenerationPanel(page, IMAGE_JPEG);
	await openModelMenu(panel);
	await clickModel(page, panel, SMOKE_PROVIDER, SET_MODEL);
	await waitUntil(() => readGenerationInfo(IMAGE)?.model === SET_MODEL && !fs.existsSync(mirrorFolder(IMAGE_JPEG)), `choosing ${SET_MODEL}, which delivers PNG, to rename ${IMAGE_JPEG} to ${IMAGE}`, 10_000);
	panel = await waitForGenerationPanel(page, IMAGE);
	const info = readGenerationInfo(IMAGE);
	if (info.mode !== 'reference' || info.params?.count !== 1) {
		throw new Error(`${SET_MODEL} makes its images by reference, one by default: ${JSON.stringify(info)}`);
	}
	const settings = await openSettings(panel);
	if (!settings.parameters.includes('count') || settings.parameters.includes('duration')) {
		throw new Error(`The settings of an image model are its own: ${JSON.stringify(settings)}`);
	}
	await closePanelMenu(page, panel, 'settings');
	await clickBlankCanvas(page);
}

// Criterion 19, and the inputs: an image connected with Pick on Canvas and one
// connected by a drawn line are the start and end frames, in upstream order,
// and a note connected by a line is a text input; the swap arrow exchanges the
// two frames' entries and nothing else, in one undo step; `@` lists the
// inputs that have a name and types the chosen one; a name of no input is
// underlined; a problem that the provider module reports for the prompt
// blocks Generate and shows above the footer until it is gone.
async function assertPanelInputsAndNames(page) {
	let panel = await selectGenerationCard(page, VIDEO);
	const empty = await readGenerationPanel(panel);
	if (JSON.stringify(empty.emptySlots) !== JSON.stringify(['start', 'end'])) {
		throw new Error(`Frames mode of ${SEEDANCE} must show an empty start and end slot: ${JSON.stringify(empty)}`);
	}
	const summaryWithoutFrames = empty.settings;
	await pickInputOnCanvas(page, panel, START_IMAGE, 'button.bh-video-panel-slot.empty[data-role="start"]');
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(VIDEO)) === JSON.stringify([START_IMAGE]), 'Pick on Canvas to connect start.png', 10_000);
	// The click that picked selected nothing.
	await waitForCanvasCardSelection(page, VIDEO);
	await drawCanvasConnectionInto(page, END_IMAGE, VIDEO);
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(VIDEO)) === JSON.stringify([START_IMAGE, END_IMAGE]), 'the drawn connection to add end.png after start.png', 10_000);
	await drawCanvasConnectionInto(page, SCENE_NOTE, VIDEO);
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(VIDEO)) === JSON.stringify([START_IMAGE, END_IMAGE, SCENE_NOTE]), 'the drawn connection to add the note after the images', 10_000);
	panel = await selectGenerationCard(page, VIDEO);
	const frames = await waitForReading(() => readGenerationPanel(panel), seen => seen.start?.path === START_IMAGE && seen.end?.path === END_IMAGE && seen.inputs.some(input => input.path === SCENE_NOTE), 'the panel to show start.png and end.png as the frames, and the note');
	const note = frames.inputs.find(input => input.path === SCENE_NOTE);
	if (note.kind !== 'text' || note.use !== 'text' || note.unused) {
		throw new Error(`A connected note is a text input that joins the prompt: ${JSON.stringify(frames.inputs)}`);
	}
	// The inputs change no value; a value the start frame sets (the ratio of
	// the model) leaves the summary and shows as set by the frame.
	const before = summaryWithoutFrames.split(' · ');
	const after = frames.settings?.split(' · ') ?? [];
	if (frames.start.name !== 'Image 1' || frames.end.name !== 'Image 2' || after.length !== before.length - 1 || !after.every(part => before.includes(part))) {
		throw new Error(`The frames must be named by upstream order, and the settings must leave out only the value the start frame sets from ${summaryWithoutFrames}: ${JSON.stringify(frames)}`);
	}
	await panel.locator('button.bh-video-panel-settings').click();
	await waitForReading(() => readSettingsPopover(panel), seen => seen !== null && seen.focusInside, 'the settings popover to open');
	const notes = await panel.evaluate(element => Array.from(element.querySelectorAll('.bh-video-panel-menu.settings .bh-video-panel-setting.fixed'))
		.map(section => `${section.querySelector('.bh-video-panel-setting-label')?.textContent}: ${section.querySelector('.bh-video-panel-setting-note')?.textContent}`));
	if (JSON.stringify(notes) !== JSON.stringify(['Ratio: Set by the start frame'])) {
		throw new Error(`With a start frame, the settings must show the ratio as set by it: ${JSON.stringify(notes)}`);
	}
	await closePanelMenu(page, panel, 'settings');

	const beforeSwap = { info: readGenerationInfo(VIDEO), upstream: readUpstreamSidecar(VIDEO) };
	await panel.locator('button.bh-video-panel-swap').click();
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(VIDEO)) === JSON.stringify([END_IMAGE, START_IMAGE, SCENE_NOTE]) && canonicalJson(readGenerationInfo(VIDEO)) === canonicalJson(beforeSwap.info), 'the swap arrow to exchange the two entries and change nothing else', 10_000);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.start?.path === END_IMAGE && seen.start.name === 'Image 1' && seen.end?.path === START_IMAGE, 'the panel to show the swapped frames, named by their new order');
	await waitForReading(() => page.evaluate(() => !!document.activeElement?.closest('.basehalf-canvas-workbench')), inside => inside, 'the keyboard focus to stay on the canvas after the swap');
	await page.keyboard.press(UNDO);
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(VIDEO)) === JSON.stringify(beforeSwap.upstream), 'one undo to put the two frames back', 10_000);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.start?.path === START_IMAGE && seen.end?.path === END_IMAGE, 'the panel to show the frames in their first order again');

	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
	await page.keyboard.type(' @');
	const mention = await waitForReading(() => readMentionMenu(panel), seen => seen !== null && seen.options.length > 0, 'typing @ to list the inputs that have a name');
	// The note has no name: its text joins the prompt.
	if (JSON.stringify(mention.options.map(option => option.label)) !== JSON.stringify(['Image 1', 'Image 2'])
		|| !mention.options[0].file.startsWith('start') || !mention.options[1].file.startsWith('end')) {
		throw new Error(`@ must list Image 1 (start.png) and Image 2 (end.png): ${JSON.stringify(mention)}`);
	}
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	const named = await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === VIDEO_PROMPT_WITH_NAME, 'choosing Image 2 to type its name');
	if (await readMentionMenu(panel) !== null || JSON.stringify(named.names) !== JSON.stringify([{ text: 'Image 2', known: true, underlined: false }])) {
		throw new Error(`The chosen name must be typed and marked as a known input: ${JSON.stringify(named)}`);
	}
	await page.keyboard.type(' Video 1');
	await waitForReading(() => readGenerationPanel(panel), seen => JSON.stringify(seen.names) === JSON.stringify([{ text: 'Image 2', known: true, underlined: false }, { text: 'Video 1', known: false, underlined: true }]), 'Video 1, the name of no input, to be underlined');
	for (let index = 0; index < ' Video 1'.length; index++) {
		await page.keyboard.press('Backspace');
	}
	await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === VIDEO_PROMPT_WITH_NAME, 'the prompt to end with the name of Image 2 again');

	// The panel asks the provider module about the prompt as it changes.
	await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === false, 'Generate to be enabled with the provider set up and both frames connected');
	await page.keyboard.type(' --rs');
	const flagged = await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.label === PROMPT_FLAG_PROBLEM, 'the provider module\'s problem with --rs in the prompt to name Generate');
	if (!flagged.generate.disabled || flagged.reason?.text !== PROMPT_FLAG_PROBLEM || flagged.reason.action !== null) {
		throw new Error(`A problem the provider module reports must disable Generate and show above the footer, with no action: ${JSON.stringify(flagged)}`);
	}
	for (let index = 0; index < ' --rs'.length; index++) {
		await page.keyboard.press('Backspace');
	}
	await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === VIDEO_PROMPT_WITH_NAME && seen.generate?.disabled === false && seen.reason === null, 'Generate to be enabled again once the prompt no longer sets --rs');
	await waitUntil(() => readGenerationInfo(VIDEO)?.prompt === VIDEO_PROMPT_WITH_NAME, 'the prompt with the name to be saved', 10_000);
}

// Criterion 16: opening the panel moves the canvas neither way; it sits 10
// px below its card, centered, as wide as the specification says, when there
// is room below; it hides while its card is off the canvas and comes back
// with it; it sits above the card when there is no room below, and inside
// the canvas, clamped, when there is room for neither; and it goes when the
// card is deselected.
async function assertPanelPlacement(page) {
	await clickBlankCanvas(page);
	const card = canvasCard(page, VIDEO);
	const home = await card.boundingBox();
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	const top = { x: canvasBox.x + 100, y: canvasBox.y + 40 };
	await panCanvasCardTo(page, card, top);
	const viewBefore = await readCanvasView(page);
	await clickCanvasCardOnTop(page, VIDEO);
	await waitForCanvasCardSelection(page, VIDEO);
	await waitForGenerationPanel(page, VIDEO);
	assertSameCanvasView(viewBefore, await readCanvasView(page), 'Opening the panel');
	// The panel emerges from the card's edge in 140 ms; it is measured where it comes to rest.
	const placed = await waitForReading(() => readPanelGeometry(page, VIDEO), seen => seen !== null && !seen.moving, 'the panel to come to rest');
	const width = Math.min(512, placed.host.width - 24);
	const left = Math.min(Math.max((placed.card.left + placed.card.right - width) / 2, 12), placed.host.width - 12 - width);
	if (placed.card.bottom + 10 + 260 > placed.host.height - 52) {
		throw new Error(`The step must leave room below the card for the tallest panel: ${JSON.stringify(placed)}`);
	}
	if (placed.placement !== 'below' || Math.abs(placed.panel.top - (placed.card.bottom + 10)) > 1.5
		|| Math.abs(placed.panel.width - width) > 1.5 || Math.abs(placed.panel.left - left) > 1.5
		|| placed.panel.height < 132 - 1 || placed.panel.height > 260 + 1) {
		throw new Error(`The panel must be ${width} px wide, centered 10 px below its card: ${JSON.stringify({ placed, width, left })}`);
	}
	await panCanvasCardTo(page, card, { x: canvasBox.x + canvasBox.width + 80, y: top.y });
	await waitForReading(() => readPanelGeometry(page, VIDEO), seen => seen?.visible === 'false' && seen.visibility === 'hidden', 'the panel to hide while its card is off the canvas');
	await panCanvasCardTo(page, card, top);
	await waitForReading(() => readPanelGeometry(page, VIDEO), seen => seen?.visible === 'true' && seen.visibility === 'visible' && seen.placement === 'below', 'the panel to show again below its card');
	// With no room below the card for the tallest panel, it sits above the
	// card, clear of its name and toolbar.
	await clickBlankCanvas(page);
	await panCanvasCardTo(page, card, { x: top.x, y: canvasBox.y + canvasBox.height - 52 - placed.card.height - 120 });
	await clickCanvasCardOnTop(page, VIDEO);
	await waitForGenerationPanel(page, VIDEO);
	const above = await waitForReading(() => readPanelGeometry(page, VIDEO), seen => seen !== null && !seen.moving && seen.placement !== 'below', 'the panel to go above its card when there is no room below');
	if (above.placement !== 'above' || above.panel.bottom > above.card.top - 10 + 1.5 || above.panel.top < 12 - 1.5) {
		throw new Error(`Without room below its card, the panel must sit above it: ${JSON.stringify(above)}`);
	}
	// At full size the card leaves room for neither: the panel is clamped inside the canvas.
	await clickBlankCanvas(page);
	await setCanvasZoomPercent(page, 100);
	await panCanvasCardTo(page, card, { x: canvasBox.x + 40, y: canvasBox.y + 120 });
	await clickCanvasCardOnTop(page, VIDEO);
	await waitForGenerationPanel(page, VIDEO);
	const clamped = await waitForReading(() => readPanelGeometry(page, VIDEO), seen => seen !== null && !seen.moving && seen.visible === 'true', 'the panel to come to rest at full size');
	if (clamped.placement !== 'clamped' || clamped.panel.top < 12 - 1.5 || clamped.panel.bottom > clamped.host.height - 52 + 1.5 || clamped.panel.left < 12 - 1.5 || clamped.panel.right > clamped.host.width - 12 + 1.5) {
		throw new Error(`With room for neither, the panel must be clamped inside the canvas: ${JSON.stringify(clamped)}`);
	}
	await clickBlankCanvas(page);
	await waitForReading(() => page.locator('.basehalf-canvas-video-panel-surface').count(), count => count === 0, 'the panel to go when its card is deselected');
	await setCanvasZoomPercent(page, 50);
	await panCanvasCardTo(page, card, { x: home.x, y: home.y });
}

// The end of criterion 3: a prompt typed in the panel while an agent writes
// another model into the card keeps both, since each writes only the fields
// it changes, against the bytes it read. At rest the panel shows the model the
// agent wrote, and the field keeps what was typed.
async function assertPromptAndAgentWriteTogether(page) {
	const panel = await selectGenerationCard(page, VIDEO);
	const before = readGenerationInfo(VIDEO);
	const file = path.join(mirrorFolder(VIDEO), 'generation.yaml');
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
	const tail = ' at golden hour';
	await page.keyboard.type(tail);
	// The panel saves half a second after typing stops; the agent writes before that.
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`model: "${SEEDANCE}"`, `model: "${SEEDANCE_AGENT}"`), 'utf8');
	const typed = `${before.prompt}${tail}`;
	await waitForReading(() => readGenerationInfo(VIDEO), info => info?.prompt === typed && info.model === SEEDANCE_AGENT && canonicalJson(info.params) === canonicalJson(before.params),
		'the prompt typed in the panel and the model the agent wrote to both be kept', 10_000);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === typed && seen.model === 'Seedance 2.0', 'the panel to show the model the agent wrote, and the prompt that was typed');
	// The agent writes the model back.
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`model: "${SEEDANCE_AGENT}"`, `model: "${SEEDANCE}"`), 'utf8');
	await waitForReading(() => readGenerationPanel(panel), seen => seen.model === 'Seedance 2.5', 'the panel to show the model the agent wrote back');
	smoke.prompt = typed;
	await clickBlankCanvas(page);
}

// --- a generation ------------------------------------------------------------------------------------

// Criteria 1, 4, 17, and 20: Generate writes the task record in
// `.bh/cache/generation/` as `preparing`, `submitting`, then `running` with
// the provider's task id, never into card information; the card shows the
// phases with the time and a progress bar; the provider gets one request with
// both frames and the note's text joined to the prompt, with the values the
// settings button sums up; the video lands at the card's path with no partial
// file in the folder at any time and nothing under `outputs/`; `made.yaml`
// holds the request the panel showed, with the path of the note and not its
// text; the record is removed; and the card plays the video.
async function assertGenerateLandsVideo(page) {
	const provider = await videoSmokeProvider();
	// The provider still makes the video when Generate first asks, 3 s after
	// the task is made: the card shows Generating then.
	provider.mock.configure({ durationMs: 6_000 });
	try {
		await generateAndLandVideo(page, provider);
	} finally {
		provider.mock.configure({ durationMs: VIDEO_PROVIDER_DURATION_MS });
	}
}

async function generateAndLandVideo(page, provider) {
	const panel = await selectGenerationCard(page, VIDEO);
	const ready = await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === false && seen.prompt === smoke.prompt, 'Generate to be enabled');
	const info = readGenerationInfo(VIDEO);
	const upstream = readUpstreamSidecar(VIDEO);
	const requestsBefore = provider.mock.requests.length;
	const watch = watchGenerations();
	const phases = await sampleCardPhases(page, VIDEO);
	await clickGenerate(panel);
	const generating = await waitForGenerationStart(page, () => readGenerationCard(page, VIDEO), seen => seen?.face?.state === 'generating', 'the card to show the generation');
	if (!['Preparing', 'Waiting', 'Generating', 'Saving'].includes(generating.face.phase) || !/^\d+:\d\d$/.test(generating.face.elapsed ?? '') || !generating.face.progress || generating.generation !== 'draft') {
		throw new Error(`A generating card must show its phase, the time since the start, and a progress bar: ${JSON.stringify(generating)}`);
	}
	await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.stop === true && seen.generate.label === 'Stop Generating' && !seen.generate.disabled, 'Generate to become the stop square');
	await assertNoDialog(page, 'Generate');
	// While it runs, the card information is only what a draft holds; the record is a file of this computer.
	await watch.until(w => w.first()?.record.state === 'running', 'the generation to run');
	if (JSON.stringify(cardInformationFiles(VIDEO)) !== JSON.stringify(['generation.yaml', 'upstream.yaml']) || canonicalJson(readGenerationInfo(VIDEO)) !== canonicalJson(info)
		|| !fs.existsSync(path.join(TASK_RECORD_FOLDER, `${watch.first().id}.json`))) {
		throw new Error(`A generation is recorded in .bh/cache/generation/ and never in card information: ${JSON.stringify({ files: cardInformationFiles(VIDEO), info: readGenerationInfo(VIDEO) })}`);
	}
	await watch.until(w => w.first().removed && fs.existsSync(workspaceFile(VIDEO)) && readMade(VIDEO) !== undefined, 'the video to land on its card and the record to be removed');
	watch.stop();
	const seen = watch.first();
	assertStates(seen, ['preparing', 'submitting', 'running', 'landing?'], 'The task record');
	const running = seen.states.find(state => state.state === 'running');
	const record = seen.record;
	if (seen.states.find(state => state.state === 'submitting')?.remoteId !== undefined || !running?.remoteId || JSON.stringify(record.cards.map(card => card.path)) !== JSON.stringify([VIDEO]) || record.answersAtOnce) {
		throw new Error(`The record must name the card, and get the provider's task id once it runs: ${JSON.stringify(seen.states)}`);
	}
	// What was sent: the card's prompt with the note's text, without its front matter, kept on this computer only.
	if (!record.sentPrompt?.startsWith(info.prompt) || !record.sentPrompt.includes(SCENE_NOTE_TEXT) || record.sentPrompt.includes('tags:')) {
		throw new Error(`The prompt as sent must be the card's prompt and the note's text without its front matter: ${JSON.stringify(record.sentPrompt)}`);
	}
	const made = readMade(VIDEO);
	// The start frame sets the ratio of the model: the record leaves it out, and the card keeps it.
	const { ratio: frameRatio, ...sentParams } = made.params ?? {};
	if (frameRatio !== undefined || info.params.ratio === undefined || made.id !== seen.id || made.remoteId !== running.remoteId || made.output !== undefined
		|| made.provider !== SMOKE_PROVIDER || made.region !== SMOKE_REGION || made.model !== SEEDANCE || typeof made.providerModel !== 'string' || !made.providerModel
		|| made.mode !== 'frames' || made.prompt !== info.prompt || JSON.stringify(made.inputs) !== JSON.stringify(upstream)
		|| Object.entries(info.params).some(([name, value]) => name !== 'ratio' && name in sentParams && sentParams[name] !== value)
		|| !(Date.parse(made.finishedAt) >= Date.parse(made.startedAt))) {
		throw new Error(`made.yaml must hold the request the panel showed, with the note's path and not its text: ${JSON.stringify({ made, info, upstream })}`);
	}
	// How the values reach the provider is its module's own; it got one request with them.
	const requests = provider.requestsSince(requestsBefore);
	const parts = JSON.stringify(requests[0]?.parts ?? []);
	const body = requests[0]?.body ?? {};
	if (requests.length !== 1 || requests[0].kind !== 'video' || requests[0].taskId !== running.remoteId || requests[0].model !== made.providerModel || requests[0].prompt !== record.sentPrompt
		|| !parts.includes('first_frame') || !parts.includes('last_frame') || body.resolution !== sentParams.resolution || body.duration !== sentParams.duration || body.generate_audio !== sentParams.sound) {
		throw new Error(`The test provider must get one request with the model's id in the region, the prompt, the two frames, and the values: ${JSON.stringify({ requests, made })}`);
	}
	// What the settings button said is what was sent.
	if (!ready.settings?.startsWith('Frames') || !ready.settings.includes(`${sentParams.duration}s`) || !ready.settings.includes(String(sentParams.resolution)) || (sentParams.sound === true) !== ready.settings.includes('Sound') || ready.settings.includes('Sound off') === (sentParams.sound === true)) {
		throw new Error(`The settings button must sum up what was sent: ${JSON.stringify({ settings: ready.settings, sentParams })}`);
	}
	if (!provider.isVideo(fs.readFileSync(workspaceFile(VIDEO))) || fs.existsSync(path.join(workspacePath, 'outputs'))) {
		throw new Error(`${VIDEO} must hold the test provider's video, and nothing may be written under outputs/`);
	}
	// Only the video appeared in the folder, and no partial file is left with
	// the records. Partial files seen in the folder for a moment are kept for
	// the last step of the suite, which checks every generation for them.
	const names = watch.names(GENERATION_FOLDER).filter(name => !PARTIAL_FILE_NAME.test(name));
	const expectedNames = ['end.png', 'scene.md', 'start.png', 'video.mp4'];
	const leftParts = fs.existsSync(TASK_RECORD_FOLDER) ? fs.readdirSync(TASK_RECORD_FOLDER).filter(name => name.startsWith(seen.id)) : [];
	if (JSON.stringify(names) !== JSON.stringify(expectedNames) || leftParts.length) {
		throw new Error(`Only the video may appear in the card's folder, and the record and its partial downloads must be gone: ${JSON.stringify({ names, leftParts })}`);
	}
	if (JSON.stringify(cardInformationFiles(VIDEO)) !== JSON.stringify(['generation.yaml', 'made.yaml', 'upstream.yaml']) || canonicalJson(readGenerationInfo(VIDEO)) !== canonicalJson(info)) {
		throw new Error(`The card keeps its prompt and settings, and gets its record: ${JSON.stringify(cardInformationFiles(VIDEO))}`);
	}
	// The card that showed the generation shows the video, in BaseHalf's player.
	const shown = await waitForReading(() => readGenerationCard(page, VIDEO), seen => seen?.generation === 'file' && seen.face === null && seen.video !== null && seen.video.readyState >= 1, 'the card to show the video');
	const sampled = await phases.stop();
	if (!sampled.phases.includes('Waiting') || !sampled.phases.includes('Generating') || sampled.phases.indexOf('Waiting') > sampled.phases.indexOf('Generating')
		|| sampled.states.at(-1)?.state !== 'file' || !sampled.states.some(entry => entry.state === 'generating')) {
		throw new Error(`The card must show the phases of the generation in order, and then the video: ${JSON.stringify(sampled)}`);
	}
	const afterGenerating = sampled.states.slice(sampled.states.findIndex(entry => entry.state === 'generating') + 1, -1);
	if (afterGenerating.length) {
		console.error(`[basehalf-smoke] between the generation and the video, the card showed ${JSON.stringify(afterGenerating)}`);
	}
	const played = await playCardVideo(page, VIDEO);
	if (played.error || !(played.currentTime >= 0.3) || played.width !== 320 || played.height !== 180 || !(played.duration > 1.5 && played.duration < 2.5) || !played.controls || played.native) {
		throw new Error(`The card must play the video, with BaseHalf's controls and not the system's while selected: ${JSON.stringify({ shown, played })}`);
	}
}

// "The toolbar": the toolbar of a card with its video offers Capture Frame,
// Reveal, and Open; Open shows the video in Card Detail with what made it,
// from its record, named from the catalog, and the inputs named as the prompt
// names them. A file that is no generation card has no such section.
async function assertCardDetailShowsWhatMadeIt(page) {
	await selectGenerationCard(page, VIDEO);
	const toolbar = await waitForReading(() => readCardToolbar(page), seen => seen?.path === VIDEO && seen.actions.length > 1, 'the toolbar of the card with its video');
	if (JSON.stringify(toolbar.actions) !== JSON.stringify(['captureFrame', 'revealVideo', 'openFullPreview']) || toolbar.media !== 'video' || toolbar.surface !== 'video' || toolbar.draft) {
		throw new Error(`The toolbar of a card with its video must offer Capture Frame, Reveal, and Open: ${JSON.stringify(toolbar)}`);
	}
	await page.locator('.basehalf-video-context-toolbar [data-video-action="openFullPreview"]').click();
	const detail = page.locator('.basehalf-card-detail.visible');
	await detail.waitFor({ state: 'visible', timeout: 15_000 });
	const section = detail.locator('.basehalf-card-detail-media.has-generation-provenance section.bh-generation-provenance');
	await section.waitFor({ state: 'visible', timeout: 15_000 });
	const shown = await section.evaluate(element => ({
		label: element.getAttribute('aria-label'),
		title: element.querySelector('.bh-generation-provenance-title')?.textContent ?? null,
		note: element.querySelector('.bh-generation-provenance-note')?.textContent ?? null,
		rows: Object.fromEntries(Array.from(element.querySelectorAll('dl.bh-generation-provenance-rows > dt')).map(term => [term.textContent, term.nextElementSibling?.textContent ?? null])),
		inputs: Array.from(element.querySelectorAll('.bh-generation-provenance-inputs li')).map(item => `${item.querySelector('.bh-generation-provenance-input-name')?.textContent} ${item.querySelector('.bh-generation-provenance-input-path')?.textContent}`)
	}));
	const made = readMade(VIDEO);
	if (shown.label !== 'What made this video' || shown.title !== 'Generated' || shown.note !== null
		|| shown.rows.Model !== `Seedance 2.5 (${made.providerModel})` || !/^ByteDance · International\b/.test(shown.rows.Provider ?? '') || shown.rows.Mode !== 'Frames'
		|| shown.rows.Prompt !== made.prompt || !(shown.rows.Settings ?? '').includes(String(made.params.resolution)) || !shown.rows.Started || !/, after \d+:\d\d$/.test(shown.rows.Finished ?? '')
		|| JSON.stringify(shown.inputs) !== JSON.stringify([`Image 1 ${START_IMAGE}`, `Image 2 ${END_IMAGE}`, `Text ${SCENE_NOTE}`])) {
		throw new Error(`Card Detail must say what made the video, from its record: ${JSON.stringify({ shown, made })}`);
	}
	await page.locator('.basehalf-card-detail-close').click();
	await detail.waitFor({ state: 'hidden', timeout: 10_000 });
	await assertCanvasFolder(page, GENERATION_FOLDER);
	// An image that is no generation card shows no such section.
	await clickBlankCanvas(page);
	await canvasCard(page, START_IMAGE).dblclick();
	await detail.waitFor({ state: 'visible', timeout: 15_000 });
	await detail.locator('.basehalf-card-detail-media').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForTimeout(1_000);
	if (await detail.locator('.has-generation-provenance, section.bh-generation-provenance').count() !== 0) {
		throw new Error('An image that is no generation card must show no section about what made it');
	}
	await page.locator('.basehalf-card-detail-close').click();
	await detail.waitFor({ state: 'hidden', timeout: 10_000 });
	await assertCanvasFolder(page, GENERATION_FOLDER);
}

// Criteria 29 and 34: Capture Frame writes the current, the first, and the
// last frame as PNGs beside the video, named after the card, and their cards
// appear to the right of the video card.
async function assertCaptureFrames(page) {
	await selectGenerationCard(page, VIDEO);
	await page.locator('.basehalf-video-context-toolbar [data-video-action="captureFrame"]').waitFor({ state: 'visible', timeout: 15_000 });
	// The current frame is the one the card's player shows. The click that
	// selected the card left the pointer on it, which plays the video.
	const away = await emptyCanvasPoint(page);
	await page.mouse.move(away.x, away.y);
	await waitForReading(() => readCardVideoPlayer(page, VIDEO), seen => seen?.paused === true, 'the video to pause when the pointer leaves its card');
	await seekCardVideo(page, VIDEO, 1);
	const frames = [['current', 'video frame at 1s.png'], ['first', 'video first frame.png'], ['last', 'video last frame.png']];
	for (const [frame, name] of frames) {
		await captureCardFrame(page, frame, `${GENERATION_FOLDER}/${name}`);
	}
	const layout = readCanvasLayout();
	const video = readCanvasCardGeometry(layout, VIDEO);
	for (const [, name] of frames) {
		const size = pngSize(fs.readFileSync(workspaceFile(`${GENERATION_FOLDER}/${name}`)));
		const row = readCanvasCardGeometry(layout, `${GENERATION_FOLDER}/${name}`);
		if (size?.width !== 320 || size.height !== 180) {
			throw new Error(`${name} must be a 320 by 180 PNG of the video: ${JSON.stringify(size)}`);
		}
		if (!video || !row || row.x < video.x + video.width) {
			throw new Error(`The card of ${name} must appear to the right of the video card: ${JSON.stringify({ video, row })}`);
		}
		// It is an ordinary image, which no generation made.
		if (readGenerationInfo(`${GENERATION_FOLDER}/${name}`) !== undefined || readMade(`${GENERATION_FOLDER}/${name}`) !== undefined) {
			throw new Error(`A captured frame is an ordinary image: ${name}`);
		}
	}
}

// "The card": the card changes in place when its generation information
// changes. A video that plays in it under the pointer goes on playing while
// the panel saves the prompt, with no frame of the loading face. The pointer
// leaving the card pauses it where it is; deselecting the card and selecting
// it again keeps the same player.
async function assertCardKeepsItsPlayer(page) {
	const before = readGenerationInfo(VIDEO);
	let panel = await selectGenerationCard(page, VIDEO);
	const read = () => readCardVideoPlayer(page, VIDEO);
	// The prompt has the keyboard while the pointer rests on the picture, which plays the video.
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	const picture = await cardVideoPicturePoint(page, VIDEO);
	await page.mouse.move(picture.x, picture.y, { steps: 4 });
	await waitForReading(read, seen => seen?.paused === false && seen.muted, 'the pointer on the card to play its video without sound');
	const started = await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.basehalf-canvas-video-player video');
		if (!card || !(video instanceof HTMLVideoElement)) {
			return { error: 'The card has no video element' };
		}
		video.dataset.smokePlayer = 'kept';
		// The test video lasts two seconds: it plays on through the whole edit.
		video.loop = true;
		// What paused the video, for the message of a failure: who called pause(), and the pointer.
		const why = [];
		globalThis.__bhWhyPaused = why;
		const pause = video.pause.bind(video);
		video.pause = () => {
			why.push(`pause() ${(new Error().stack ?? '').split('\n').slice(2, 6).join(' | ')}`);
			pause();
		};
		for (const type of ['pointerenter', 'pointerleave']) {
			video.closest('.basehalf-canvas-video-player')?.addEventListener(type, () => why.push(type));
		}
		const frames = [];
		globalThis.__bhVideoCardFrames = frames;
		globalThis.__bhVideoCardSampling = true;
		const sample = () => {
			const current = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
			const player = current?.querySelector('.basehalf-canvas-video-player video');
			frames.push({
				sameCard: current === card,
				samePlayer: player === video,
				loading: /Checking content/.test(current?.textContent ?? ''),
				paused: video.paused
			});
			if (globalThis.__bhVideoCardSampling && frames.length < 5_000) {
				requestAnimationFrame(sample);
			}
		};
		requestAnimationFrame(sample);
		return { time: video.currentTime };
	}, VIDEO);
	if (started.error) {
		throw new Error(started.error);
	}
	const edited = `${before.prompt} Slowly.`;
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(edited);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === edited, `the prompt to read ${edited}`);
	await waitUntil(() => readGenerationInfo(VIDEO)?.prompt === edited, 'the panel to save the edited prompt', 10_000);
	// The canvas reads the changed card information again and shows it in the same card.
	await page.waitForTimeout(1_500);
	const playing = await page.evaluate(() => {
		globalThis.__bhVideoCardSampling = false;
		const frames = globalThis.__bhVideoCardFrames ?? [];
		return {
			frames: frames.length,
			replaced: frames.filter(frame => !frame.sameCard || !frame.samePlayer).length,
			loading: frames.filter(frame => frame.loading).length,
			paused: frames.filter(frame => frame.paused).length,
			time: document.querySelector('video[data-smoke-player="kept"]')?.currentTime ?? null,
			why: globalThis.__bhWhyPaused ?? []
		};
	});
	if (playing.frames < 30 || playing.replaced !== 0 || playing.loading !== 0 || playing.paused !== 0 || !(playing.time > started.time)) {
		throw new Error(`A playing video must go on playing in the same card while its card information changes: ${JSON.stringify({ started, playing })}`);
	}
	// The pointer leaves the selected card: the video pauses, and the controls stay while the card is selected.
	const away = await emptyCanvasPoint(page);
	await page.mouse.move(away.x, away.y);
	const paused = await waitForReading(read, seen => seen?.kept === true && seen.paused && seen.selected && seen.controls === 'shown' && !seen.native, 'the pointer leaving the selected card to pause its video, with the controls still shown');
	await clickBlankCanvas(page);
	await waitForReading(read, seen => seen?.kept === true && seen.paused && !seen.selected && seen.controls === 'hidden' && Math.abs(seen.time - paused.time) < 0.05,
		'the deselected card to keep its player, paused where it was and without controls');
	panel = await selectGenerationCard(page, VIDEO);
	await waitForReading(read, seen => seen?.kept === true && seen.selected && seen.controls === 'shown', 'the selected card to show the same player with its controls');
	await savePrompt(page, panel, VIDEO, before.prompt);
}

// Criteria 35 to 38 ("The player"): the picture is the card's and the pointer
// plays it, on the card of a generated video and on the card of a video file.
async function assertCardPlayerGestures(page) {
	// A move in another folder changes the structure of the workspace while
	// the canvas keeps the cards it drew; Open on one of them still opens it.
	await renameRootReadmeInExplorerAndBack(page);
	await assertCardPlaysForThePointer(page, VIDEO);
	// Criterion 37: the card of a video file, the test provider's video beside the cards.
	const generated = canvasCard(page, VIDEO);
	const home = await generated.boundingBox();
	const zoom = Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom'));
	fs.writeFileSync(workspaceFile(CLIP), (await videoSmokeProvider()).video);
	const clip = canvasCard(page, CLIP);
	await clip.waitFor({ state: 'attached', timeout: 15_000 });
	// A new card's place is checked again when its row is written, and the card can move once then.
	await waitUntil(() => readCardRow(CLIP) !== undefined, `the card of ${CLIP} to get a place`, 15_000);
	await waitForReading(async () => {
		const before = await clip.boundingBox();
		await page.waitForTimeout(500);
		const after = await clip.boundingBox();
		return !!before && !!after && Math.abs(before.x - after.x) < 0.5 && Math.abs(before.y - after.y) < 0.5;
	}, still => still, `the card of ${CLIP} to stay where it is drawn`);
	if (await clip.getAttribute('data-generation') !== null) {
		throw new Error(`A video file with no generation information is no generation card: ${CLIP}`);
	}
	// The card of a file is 300 wide when it appears, and the controls show on a picture 160 screen pixels wide or more.
	const zoomed = zoom < 0.75;
	if (zoomed) {
		await setCanvasZoomPercent(page, 100);
	}
	const view = await readCanvasView(page);
	const box = await clip.boundingBox();
	if (!home || !box) {
		throw new Error(`The cards of ${VIDEO} and ${CLIP} must be on the canvas: ${JSON.stringify({ home, box })}`);
	}
	await panCanvasCardTo(page, clip, { x: Math.round((view.canvas.left + view.canvas.right - box.width) / 2), y: Math.round((view.canvas.top + view.canvas.bottom - box.height) / 2) });
	await waitForReading(() => readCardVideoPlayer(page, CLIP), seen => seen !== null && seen.readyState >= 1, `the card of ${CLIP} to show its video`);
	await assertCardPlaysForThePointer(page, CLIP);
	fs.rmSync(workspaceFile(CLIP), { force: true });
	await clip.waitFor({ state: 'detached', timeout: 10_000 });
	if (zoomed) {
		await setCanvasZoomPercent(page, Number((zoom * 100).toFixed(2)));
	}
	await panCanvasCardTo(page, generated, { x: home.x, y: home.y });
}

// One card's player, from the card deselected with the pointer off it, back
// to that. The pointer on the card plays the video without sound and shows
// the controls; the grab hand is over the picture and the arrow over the
// controls; a click on the picture selects the card and leaves the video
// playing, also on the selected card; a drag from the picture moves the
// selected card; play and pause, the position slider, and the sound button
// move no card; leaving the selected card pauses the video; Open and a double
// click on the picture open the card.
async function assertCardPlaysForThePointer(page, cardPath) {
	const read = () => readCardVideoPlayer(page, cardPath);
	const card = canvasCard(page, cardPath);
	await clickBlankCanvas(page);
	await waitForReading(read, seen => seen !== null && seen.paused && !seen.selected && seen.controls === 'hidden' && !seen.native, `the card of ${cardPath} to rest, paused and without controls`);
	// The test video lasts two seconds: it plays on through the whole step.
	await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.basehalf-canvas-video-player video');
		if (video instanceof HTMLVideoElement) {
			video.loop = true;
		}
	}, cardPath);

	// Criterion 36: the pointer on the card plays its video without sound and shows the controls.
	let picture = await cardVideoPicturePoint(page, cardPath);
	await page.mouse.move(picture.x, picture.y, { steps: 4 });
	await waitForReading(read, seen => seen?.paused === false && seen.muted && !seen.selected && seen.controls === 'shown',
		`the pointer on the card of ${cardPath} to play its video without sound and show the controls`);
	// Criterion 35: the card's grab hand over the picture, the arrow over the controls.
	const cursors = { picture: (await readCursorAt(page, picture))?.cursor };
	for (const control of ['sound', 'play', 'slider', 'open']) {
		cursors[control] = (await readCursorAt(page, await cardVideoControlBox(page, cardPath, control)))?.cursor;
	}
	if (JSON.stringify(cursors) !== JSON.stringify({ picture: 'grab', sound: 'default', play: 'default', slider: 'default', open: 'default' })) {
		throw new Error(`The pointer over the picture of ${cardPath} must be the grab hand, and over its controls the arrow: ${JSON.stringify(cursors)}`);
	}

	// Criterion 35: a click on the picture selects the card and leaves the
	// video playing, and so does a click on the picture of the selected card.
	await page.mouse.click(picture.x, picture.y);
	await waitForCanvasCardSelection(page, cardPath);
	const selected = await read();
	// Apart, so that the two clicks are not a double click.
	await page.waitForTimeout(700);
	await page.mouse.click(picture.x, picture.y);
	await page.waitForTimeout(300);
	const clicked = await read();
	if (selected?.paused !== false || clicked?.paused !== false || !clicked.selected || clicked.controls !== 'shown' || await page.locator('.basehalf-card-detail.visible').count() !== 0) {
		throw new Error(`A click on the picture of ${cardPath} must select the card and leave its video playing: ${JSON.stringify({ selected, clicked })}`);
	}

	// Criterion 35: a drag from the picture of the selected card moves the card
	// (snapping may pull it a few pixels); undo puts it back.
	const placed = readCardRow(cardPath);
	const start = await card.boundingBox();
	picture = await cardVideoPicturePoint(page, cardPath);
	await page.mouse.move(picture.x, picture.y);
	await page.mouse.down();
	await page.mouse.move(picture.x + 90, picture.y + 50, { steps: 8 });
	// The card follows the pointer while it is held; where it lands is the canvas's.
	const moved = await card.boundingBox();
	await page.mouse.up();
	if (!placed || !start || !moved || !(moved.x - start.x > 45 && moved.x - start.x < 106) || !(moved.y - start.y > 25 && moved.y - start.y < 66)) {
		throw new Error(`A drag from the picture of the selected card ${cardPath} must move the card: ${JSON.stringify({ start, moved })}`);
	}
	const row = () => readCardRow(cardPath);
	await waitUntil(() => row()?.x !== placed.x || row()?.y !== placed.y, `the canvas to save the moved card of ${cardPath}`, 10_000);
	await card.focus();
	await page.keyboard.press(UNDO);
	await waitUntil(() => row()?.x === placed.x && row()?.y === placed.y, `undo to put the card of ${cardPath} back`, 10_000);
	// The window draws the card back after the layout has it back.
	await waitForReading(() => card.boundingBox(), seen => seen !== null && Math.abs(seen.x - start.x) < 1 && Math.abs(seen.y - start.y) < 1, `the card of ${cardPath} to be drawn back where it was`);
	await waitForCanvasCardSelection(page, cardPath);

	// Criterion 36: play and pause, the position slider, and the sound button are the player's and move no card.
	picture = await cardVideoPicturePoint(page, cardPath);
	await page.mouse.move(picture.x, picture.y, { steps: 2 });
	await waitForReading(read, seen => seen?.paused === false, `the pointer on the picture of ${cardPath} to play the video`);
	const atRest = await card.boundingBox();
	const play = await cardVideoControlBox(page, cardPath, 'play');
	await page.mouse.click(play.x, play.y);
	await waitForReading(read, seen => seen?.paused === true, 'the play button to pause the video');
	const slider = await cardVideoControlBox(page, cardPath, 'slider');
	await page.mouse.move(slider.left + slider.width * 0.75, slider.y);
	await page.mouse.down();
	await waitForReading(read, seen => seen !== null && Math.abs(seen.time - seen.duration * 0.75) < 0.1, 'a press on the position slider to move the video');
	await page.mouse.move(slider.left + slider.width * 0.25, slider.y, { steps: 6 });
	await waitForReading(read, seen => seen !== null && Math.abs(seen.time - seen.duration * 0.25) < 0.1, 'the position slider to follow the pointer');
	await page.mouse.up();
	const sound = await cardVideoControlBox(page, cardPath, 'sound');
	await page.mouse.click(sound.x, sound.y);
	await waitForReading(read, seen => seen?.muted === false && seen.sound === 'Mute', 'the sound button to turn the sound on');
	await page.mouse.click(sound.x, sound.y);
	await waitForReading(read, seen => seen?.muted === true && seen.sound === 'Unmute', 'the sound button to turn the sound off again');
	await page.mouse.click(play.x, play.y);
	await waitForReading(read, seen => seen?.paused === false && seen.muted, 'the play button to play the video again, without sound');
	const afterControls = await card.boundingBox();
	const state = await read();
	if (!atRest || !afterControls || Math.abs(afterControls.x - atRest.x) > 0.5 || Math.abs(afterControls.y - atRest.y) > 0.5 || !state?.selected) {
		throw new Error(`A press on the controls of ${cardPath} must not move or deselect the card: ${JSON.stringify({ atRest, afterControls, state })}`);
	}

	// Criterion 36: leaving the selected card pauses the video; the controls stay while the card is selected.
	const away = await emptyCanvasPoint(page);
	await page.mouse.move(away.x, away.y);
	await waitForReading(read, seen => seen?.paused === true && seen.selected && seen.controls === 'shown', `the pointer leaving the selected card of ${cardPath} to pause its video, with the controls still shown`);

	// Criterion 38: Open, and a double click on the picture, open the card and
	// pause its video, which plays under the pointer until then. The card shows
	// the frame where the video stopped when Card Detail closes.
	for (const [what, open] of [
		['Open', async () => {
			const button = await cardVideoControlBox(page, cardPath, 'open');
			await page.mouse.click(button.x, button.y);
		}],
		['A double click on the picture', () => page.mouse.dblclick(picture.x, picture.y)]
	]) {
		picture = await cardVideoPicturePoint(page, cardPath);
		await page.mouse.move(picture.x, picture.y, { steps: 2 });
		await waitForReading(read, seen => seen?.paused === false, `the pointer on the picture of ${cardPath} to play the video before ${what}`);
		await open();
		const stopped = await closeOpenedVideoCard(page, read, `${what} on the card of ${cardPath}`);
		await waitForReading(read, seen => seen !== null && seen.readyState >= 1 && Math.abs(seen.time - stopped.time) < 0.05,
			`the card of ${cardPath} to show the frame where its video stopped, ${stopped.time} s`);
	}
	await clickBlankCanvas(page);
	await waitForReading(read, seen => seen?.paused === true && !seen.selected && seen.controls === 'hidden', `the deselected card of ${cardPath} to rest without controls`);
}

// Criterion 38: Card Detail opened from a card's player lies over the card's
// canvas with the card's video paused, and closing it shows that canvas again.
// Returns the player as Card Detail found it.
async function closeOpenedVideoCard(page, read, what) {
	const detail = page.locator('.basehalf-card-detail.visible');
	if (!await detail.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
		throw new Error(`${what} must open the card in Card Detail`);
	}
	const player = await read();
	if (player?.paused !== true) {
		throw new Error(`${what} must pause the card's video: ${JSON.stringify(player)}`);
	}
	await page.locator('.basehalf-card-detail-close').click();
	await detail.waitFor({ state: 'hidden', timeout: 10_000 });
	await assertCanvasFolder(page, GENERATION_FOLDER);
	return player;
}

// Renames README.md at the workspace root from the Explorer and back, with
// the keyboard, which opens nothing: two moves made in the window, outside
// the folder whose canvas is open.
async function renameRootReadmeInExplorerAndBack(page) {
	const list = page.locator('.explorer-viewlet .monaco-list').first();
	if (!await list.isVisible().catch(() => false)) {
		await runCommand(page, 'Focus on Files Explorer');
	}
	// The folder of the steps is open in Files since the first step; it is closed, so that README.md is the last row of the root.
	const folderRow = page.locator('.explorer-viewlet .monaco-list-row').filter({ has: page.locator('.label-name', { hasText: new RegExp(`^${GENERATION_FOLDER}$`) }) }).first();
	if (await folderRow.getAttribute('aria-expanded').catch(() => null) === 'true') {
		await folderRow.locator('.monaco-tl-twistie').click();
		await waitForReading(() => folderRow.getAttribute('aria-expanded'), expanded => expanded === 'false', `the row of ${GENERATION_FOLDER} in Files to close`);
	}
	for (const [from, to] of [['README.md', 'README-moved.md'], ['README-moved.md', 'README.md']]) {
		await list.focus();
		// The file is the last row of the root, after the folders.
		await page.keyboard.press('End');
		await waitForReading(() => page.locator('.explorer-viewlet .monaco-list-row.focused').innerText().catch(() => ''), text => text.includes(from), `the Explorer to select ${from}`);
		await page.keyboard.press(process.platform === 'darwin' ? 'Enter' : 'F2');
		const input = page.locator('.explorer-viewlet .explorer-item .monaco-inputbox input');
		await input.waitFor({ state: 'visible', timeout: 10_000 });
		await input.fill(to);
		await page.keyboard.press('Enter');
		await input.waitFor({ state: 'hidden', timeout: 10_000 });
		await waitUntil(() => fs.existsSync(path.join(workspacePath, to)) && !fs.existsSync(path.join(workspacePath, from)), `the Explorer to rename ${from} to ${to}`, 10_000);
	}
	await assertCanvasFolder(page, GENERATION_FOLDER);
	// Until the canvas has drawn the new structure, it lets a click on it go:
	// the selection ends once it has.
	const blank = await emptyCanvasPoint(page);
	await waitForReading(async () => {
		await page.mouse.click(blank.x, blank.y);
		await page.waitForTimeout(150);
		return page.locator('.react-flow__node.selected').count();
	}, count => count === 0, 'a click on the blank canvas to end the selection once the canvas has drawn the moves');
}

// Criterion 24: Generate on a card that has its file makes a draft beside
// it, named like it with the next free number, with the same prompt,
// settings, and inputs, to its right, selects it, and runs there; the
// original card, its file, and its card information do not change.
async function assertGenerateAgainMakesDraft(page) {
	const provider = await videoSmokeProvider();
	const original = ['generation.yaml', 'made.yaml', 'upstream.yaml'].map(name => readTextIfThere(path.join(mirrorFolder(VIDEO), name)));
	const originalFile = fs.readFileSync(workspaceFile(VIDEO));
	const panel = await selectGenerationCard(page, VIDEO);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === false && !seen.generate.stop, 'Generate to be enabled on the card that has its video');
	const requestsBefore = provider.mock.requests.length;
	const watch = watchGenerations();
	// Cmd/Ctrl+Enter in the prompt generates.
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
	await waitUntil(() => readGenerationInfo(VIDEO_AGAIN) !== undefined, `Generate to make ${VIDEO_AGAIN}`, 20_000);
	await waitForCanvasCardSelection(page, VIDEO_AGAIN, 20_000);
	await page.locator(`.basehalf-canvas-video-panel-surface[data-basehalf-card-path="${VIDEO_AGAIN}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(VIDEO_AGAIN)) && readMade(VIDEO_AGAIN) !== undefined, `the video to land on ${VIDEO_AGAIN}`);
	watch.stop();
	const seen = watch.first();
	assertStates(seen, ['preparing', 'submitting', 'running', 'landing?'], 'The generation of the new draft');
	if (JSON.stringify(seen.record.cards.map(card => card.path)) !== JSON.stringify([VIDEO_AGAIN])) {
		throw new Error(`The generation must land on the new draft only: ${JSON.stringify(seen.record.cards)}`);
	}
	if (canonicalJson(readGenerationInfo(VIDEO_AGAIN)) !== canonicalJson(readCardYaml(original[0])) || JSON.stringify(readUpstreamSidecar(VIDEO_AGAIN)) !== JSON.stringify(readCardYaml(original[2]).upstream)
		|| readMade(VIDEO_AGAIN).id !== seen.id || !provider.isVideo(fs.readFileSync(workspaceFile(VIDEO_AGAIN))) || fs.readFileSync(workspaceFile(VIDEO_AGAIN)).equals(fs.readFileSync(workspaceFile(VIDEO)))) {
		throw new Error(`The new card must have the original's prompt, settings, and inputs, and its own video: ${JSON.stringify({ info: readGenerationInfo(VIDEO_AGAIN), upstream: readUpstreamSidecar(VIDEO_AGAIN), made: readMade(VIDEO_AGAIN) })}`);
	}
	const now = ['generation.yaml', 'made.yaml', 'upstream.yaml'].map(name => readTextIfThere(path.join(mirrorFolder(VIDEO), name)));
	if (JSON.stringify(now) !== JSON.stringify(original) || !fs.readFileSync(workspaceFile(VIDEO)).equals(originalFile)) {
		throw new Error(`Generating again changed ${VIDEO}: ${JSON.stringify({ original, now })}`);
	}
	const layout = readCanvasLayout();
	const originalRow = readCanvasCardGeometry(layout, VIDEO);
	const againRow = readCanvasCardGeometry(layout, VIDEO_AGAIN);
	if (!originalRow || !againRow || againRow.x < originalRow.x + originalRow.width) {
		throw new Error(`The new card must appear to the right of the original: ${JSON.stringify({ originalRow, againRow })}`);
	}
	if (provider.requestsSince(requestsBefore).length !== 1) {
		throw new Error(`Generating again must send one request: ${JSON.stringify(provider.requestsSince(requestsBefore))}`);
	}
}

// Criteria 22 and 23: a task the provider fails ends as failed with the
// provider's message on the card; a refused key ends it with the provider's
// message; a request whose answer never comes ends with the message about the
// provider's console and is not sent again; the stop square ends a running
// task as stopped and keeps no file. A new draft starts with the provider,
// model, mode, and values of the last generation of its kind.
async function assertGenerationFailsAndStops(page) {
	const provider = await videoSmokeProvider();
	await clickBlankCanvas(page);
	const { cardPath, panel } = await createDraftFromMenu(page, 'New Video');
	if (cardPath !== VIDEO_FAILS) {
		throw new Error(`New Video must take the next free number: ${cardPath}`);
	}
	const created = readGenerationInfo(VIDEO_FAILS);
	const lastUsed = readGenerationInfo(VIDEO_AGAIN);
	if (created.prompt !== '' || canonicalJson(choiceOf(created)) !== canonicalJson(choiceOf(lastUsed)) || lastUsed.model !== SEEDANCE) {
		throw new Error(`A new draft must start with the provider, model, mode, and values of the last generation of its kind: ${JSON.stringify({ created, lastUsed })}`);
	}

	await page.keyboard.type('[mock:fail] A storm over the pier');
	let ended = await generateUntilEnded(page, panel);
	assertStates(ended.seen, ['preparing', 'submitting', 'running', 'failed'], 'A task the provider fails');
	if (!/^The provider could not make it: \S/.test(ended.record.error ?? '') || ended.requests.length !== 1) {
		throw new Error(`A task the provider fails must end as failed with its message: ${JSON.stringify(ended)}`);
	}
	await waitForReading(() => readGenerationCard(page, VIDEO_FAILS), seen => seen?.face?.state === 'failed' && seen.face.message === ended.record.error, 'the card to show the provider\'s message');

	provider.mock.configure({ fail: 'key' });
	try {
		await replacePrompt(page, panel, 'A storm over the pier, seen from the cliff');
		ended = await generateUntilEnded(page, panel);
	} finally {
		provider.mock.configure({ fail: 'none' });
	}
	assertStates(ended.seen, ['preparing', 'submitting', 'failed'], 'A request with a refused key');
	if (!/^The provider refused the credentials: \S/.test(ended.record.error ?? '') || ended.record.error.includes(provider.key)) {
		throw new Error(`A refused key must end the task with the provider's message, without the key: ${JSON.stringify(ended.record)}`);
	}
	await waitForReading(() => readGenerationCard(page, VIDEO_FAILS), seen => seen?.face?.state === 'failed' && seen.face.message === ended.record.error, 'the card to show that the key was refused');

	await replacePrompt(page, panel, '[mock:drop] A storm over the pier');
	ended = await generateUntilEnded(page, panel);
	const unknown = 'The request may have reached the provider, but no answer came back. Check the provider\'s console before generating again: a second request may be charged again.';
	assertStates(ended.seen, ['preparing', 'submitting', 'failed'], 'A request without an answer');
	if (!ended.record.error?.startsWith(unknown) || ended.requests.length !== 1 || ended.requests[0].prompt !== '[mock:drop] A storm over the pier') {
		throw new Error(`A request without an answer must end with the message about the provider's console: ${JSON.stringify(ended)}`);
	}
	await waitForReading(() => readGenerationCard(page, VIDEO_FAILS), seen => seen?.face?.state === 'failed' && seen.face.message === ended.record.error, 'the card to show that the outcome is unknown');
	// Nothing sends the request again.
	await page.waitForTimeout(VIDEO_PROVIDER_CREATE_HOLD_MS + 2_000);
	if (provider.requestsSince(ended.requestsBefore).length !== 1) {
		throw new Error(`A request whose outcome is unknown was sent again: ${JSON.stringify(provider.requestsSince(ended.requestsBefore))}`);
	}

	await replacePrompt(page, panel, '[mock:slow] A storm over the pier');
	const watch = watchGenerations();
	await clickGenerate(panel);
	await watch.until(w => w.first()?.record.state === 'running', 'the slow task to run');
	await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.stop === true, 'Generate to become the stop square');
	await panel.locator('button.bh-video-panel-generate').click();
	await watch.until(w => w.first()?.record.state === 'stopped', 'the stop square to end the task as stopped');
	watch.stop();
	assertStates(watch.first(), ['preparing', 'submitting', 'running', 'stopped'], 'A stopped task');
	if (!watch.first().record.endedAt || fs.existsSync(workspaceFile(VIDEO_FAILS)) || readMade(VIDEO_FAILS) !== undefined) {
		throw new Error(`The stop square must end the task as stopped and keep no file: ${JSON.stringify(watch.first().record)}`);
	}
	await waitForReading(() => readGenerationCard(page, VIDEO_FAILS), seen => seen?.face?.state === 'stopped' && seen.face.message === 'Stopped', 'the card to say Stopped');
	await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.stop === false && seen.generate.disabled === false, 'Generate to start a new generation on the same card');
	// A file that arrives later is not kept: none is there a moment later, and no partial download is left.
	await page.waitForTimeout(1_000);
	const parts = fs.existsSync(TASK_RECORD_FOLDER) ? fs.readdirSync(TASK_RECORD_FOLDER).filter(name => name.startsWith(watch.first().id) && name.endsWith('.part')) : [];
	if (fs.existsSync(workspaceFile(VIDEO_FAILS)) || parts.length) {
		throw new Error(`A stopped generation keeps no file: ${JSON.stringify(parts)}`);
	}
}

// --- several images ----------------------------------------------------------------------------------

// Criterion 25 and the undo of 32: one image lands on its card; a generation
// of four images makes three drafts in a row to the right of the card before
// the request is sent, and lands one image on each; when the provider refuses
// one, that card fails alone; when it makes fewer than asked, the cards left
// over fail; undo of the drafts a generation made refuses while they
// generate. A provider that answers at once (criterion 21) lands its files
// without a task to ask about.
async function assertImageGenerations(page) {
	const provider = await videoSmokeProvider();
	// One image, on image.png.
	let panel = await selectGenerationCard(page, IMAGE);
	await savePrompt(page, panel, IMAGE, 'A lighthouse at dawn');
	let requestsBefore = provider.mock.requests.length;
	let watch = watchGenerations();
	await clickGenerate(panel);
	await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(IMAGE)) && readMade(IMAGE) !== undefined, `the image to land on ${IMAGE}`);
	watch.stop();
	let seen = watch.first();
	assertStates(seen, ['preparing', 'submitting', 'landing?'], 'An image answered at once');
	let made = readMade(IMAGE);
	if (!seen.record.answersAtOnce || seen.record.remoteId !== undefined || !pngSize(fs.readFileSync(workspaceFile(IMAGE))) || made.id !== seen.id || made.output !== undefined
		|| made.model !== SET_MODEL || made.mode !== 'reference' || made.prompt !== 'A lighthouse at dawn' || JSON.stringify(made.inputs) !== '[]') {
		throw new Error(`One image must land on its card, from an answer with the file and no task: ${JSON.stringify({ record: seen.record, made })}`);
	}
	let requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || requests[0].kind !== 'image' || requests[0].body?.sequential_image_generation !== 'disabled') {
		throw new Error(`One image is asked for in one request: ${JSON.stringify(requests)}`);
	}
	await waitForReading(() => readGenerationCard(page, IMAGE), card => card?.generation === 'file' && card.image?.complete === true && card.image.width > 0, 'the card to show the image');

	// Four images from one generation, from a draft made where the canvas is
	// empty, so that the drafts of the further images have the room to its right.
	await clickBlankCanvas(page);
	await panBelowTheCards(page);
	const four = await createDraftFromMenu(page, 'New Image');
	await setImageCount(page, four.panel, four.cardPath, 4);
	await savePrompt(page, four.panel, four.cardPath, 'Four views of the pier');
	const fourInfo = readGenerationInfo(four.cardPath);
	const fourRow = readCardRow(four.cardPath);
	requestsBefore = provider.mock.requests.length;
	const createsBefore = provider.creates.length;
	watch = watchGenerations();
	await clickGenerate(four.panel);
	await watch.until(w => w.first()?.record.cards?.length === 4, 'the generation of four images to name its four cards');
	const cards = watch.first().record.cards.map(card => card.path);
	if (cards[0] !== four.cardPath || new Set(cards).size !== 4) {
		throw new Error(`A generation of four images lands on the card and three new drafts: ${JSON.stringify(cards)}`);
	}
	await watch.until(w => w.first().removed && cards.every(card => fs.existsSync(workspaceFile(card)) && readMade(card) !== undefined), 'the four images to land on their cards');
	watch.stop();
	seen = watch.first();
	// The drafts were made before the request was sent.
	const madeAt = cards.slice(1).map(card => fs.statSync(path.join(mirrorFolder(card), 'generation.yaml')).birthtimeMs);
	const sentAt = provider.creates[createsBefore];
	if (sentAt === undefined || madeAt.some(time => !(time < sentAt))) {
		throw new Error(`The three new drafts must be made before the request is sent: ${JSON.stringify({ madeAt, sentAt })}`);
	}
	for (const [index, card] of cards.entries()) {
		made = readMade(card);
		const row = readCardRow(card);
		if (made.id !== `${seen.id}-${index + 1}` || made.output !== index + 1 || made.outputs !== 4 || made.prompt !== fourInfo.prompt || !pngSize(fs.readFileSync(workspaceFile(card)))
			|| canonicalJson(readGenerationInfo(card)) !== canonicalJson(fourInfo) || (index > 0 && (!row || row.x < fourRow.x + fourRow.width || row.y !== fourRow.y))) {
			throw new Error(`Image ${index + 1} of 4 must land on its own card, to the right of the first, with the same prompt and settings: ${JSON.stringify({ card, made, row, fourRow, info: readGenerationInfo(card) })}`);
		}
	}
	requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || requests[0].body?.sequential_image_generation !== 'auto' || requests[0].body?.sequential_image_generation_options?.max_images !== 4) {
		throw new Error(`Four images are asked for in one request: ${JSON.stringify(requests)}`);
	}

	// The provider refuses one image of four: that card fails alone.
	await clickBlankCanvas(page);
	const refused = await createDraftFromMenu(page, 'New Image');
	await setImageCount(page, refused.panel, refused.cardPath, 4);
	await savePrompt(page, refused.panel, refused.cardPath, '[mock:fail] Four views of the harbour');
	watch = watchGenerations();
	await clickGenerate(refused.panel);
	await watch.until(w => w.first()?.record.state === 'failed', 'the generation with a refused image to end');
	watch.stop();
	seen = watch.first();
	const refusedCards = seen.record.cards;
	if (refusedCards.length !== 4 || refusedCards.slice(0, 3).some(card => card.state !== 'landed' || !fs.existsSync(workspaceFile(card.path)))
		|| refusedCards[3].state !== 'failed' || !/^The provider refused this one: \S/.test(refusedCards[3].error ?? '') || fs.existsSync(workspaceFile(refusedCards[3].path))) {
		throw new Error(`When the provider refuses one image, that card fails alone and the others land: ${JSON.stringify(refusedCards)}`);
	}
	const lastCard = refusedCards[3].path;
	await waitForReading(() => readGenerationCard(page, lastCard), card => card?.face?.state === 'failed' && card.face.message === refusedCards[3].error, 'the refused card to show why');

	// The provider makes fewer images than asked: the card left over fails.
	// The failed card generates again on itself, with one new draft, slowly
	// enough for undo to be tried while they generate.
	panel = await selectGenerationCard(page, lastCard);
	await setImageCount(page, panel, lastCard, 2);
	await savePrompt(page, panel, lastCard, '[mock:fewer] [mock:slow] Two views of the harbour');
	watch = watchGenerations();
	await clickGenerate(panel);
	await watch.until(w => w.first()?.record.state === 'submitting' && w.first().record.cards.length === 2, 'the generation of two images to be on its way');
	const fewerCards = watch.first().record.cards.map(card => card.path);
	// Undo of the drafts the generation made refuses while they generate, and says why.
	await page.waitForTimeout(300);
	await canvasCard(page, START_IMAGE).focus();
	await page.keyboard.press(UNDO);
	await expectNotification(page, 'is generating. Stop it first.');
	if (readGenerationInfo(fewerCards[1]) === undefined) {
		throw new Error(`Undo must not take back a draft while it generates: ${fewerCards[1]}`);
	}
	await watch.until(w => w.first()?.record.state === 'failed' || w.first()?.removed, 'the generation of fewer images to end', GENERATION_TIMEOUT_MS);
	watch.stop();
	const fewer = watch.first().record.cards;
	if (fewer[0].state !== 'landed' || !fs.existsSync(workspaceFile(fewerCards[0])) || fewer[1].state !== 'failed' || fewer[1].error !== 'The provider made fewer images than asked.') {
		throw new Error(`When the provider makes fewer images than asked, the cards left over fail: ${JSON.stringify(fewer)}`);
	}
	await waitForReading(() => readGenerationCard(page, fewerCards[1]), card => card?.face?.state === 'failed' && card.face.message === 'The provider made fewer images than asked.', 'the card left over to say why');
	await clickBlankCanvas(page);
}

// Criterion 27: an image that arrives as JPEG for a draft named `.png` lands
// as `.jpg`, with its card information, its connections, and its place.
async function assertImageArrivesAsJpeg(page) {
	const provider = await videoSmokeProvider();
	// The draft is made where start.png is in sight, to pick it on the canvas.
	await clickBlankCanvas(page);
	await showCardOnCanvas(page, START_IMAGE, true);
	const { cardPath, panel } = await createDraftFromMenu(page, 'New Image');
	if (!cardPath.endsWith('.png')) {
		throw new Error(`The last image model used delivers PNG, so a new image draft is named .png: ${cardPath}`);
	}
	await setImageCount(page, panel, cardPath, 1);
	await pickInputOnCanvas(page, panel, START_IMAGE);
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(cardPath)) === JSON.stringify([START_IMAGE]), 'Pick on Canvas to connect start.png to the image draft', 10_000);
	await savePrompt(page, panel, cardPath, '[mock:jpeg] The pier in the rain');
	const row = readCardRow(cardPath);
	const info = readGenerationInfo(cardPath);
	const jpeg = cardPath.replace(/\.png$/, '.jpg');
	const requestsBefore = provider.mock.requests.length;
	const watch = watchGenerations();
	await clickGenerate(panel);
	await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(jpeg)) && readMade(jpeg) !== undefined, `the JPEG to land as ${jpeg}`);
	watch.stop();
	const moved = readCardRow(jpeg);
	if (!provider.isJpeg(fs.readFileSync(workspaceFile(jpeg))) || fs.existsSync(workspaceFile(cardPath)) || fs.existsSync(mirrorFolder(cardPath))
		|| canonicalJson(readGenerationInfo(jpeg)) !== canonicalJson(info) || JSON.stringify(readUpstreamSidecar(jpeg)) !== JSON.stringify([START_IMAGE])
		|| moved?.x !== row.x || moved.y !== row.y || readCardRow(cardPath) !== undefined) {
		throw new Error(`A JPEG for a .png draft must land as .jpg with its card information, its connections, and its place: ${JSON.stringify({ files: cardInformationFiles(jpeg), row, moved })}`);
	}
	await assertCanvasEdgeVisible(page, START_IMAGE, jpeg);
	await waitForReading(() => readGenerationCard(page, jpeg), card => card?.generation === 'file' && card.image?.complete === true && card.image.width > 0, 'the card to show the JPEG');
	const requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || !JSON.stringify(requests[0].parts).includes('image data:image/png')) {
		throw new Error(`One request must send the connected image as a reference: ${JSON.stringify(requests)}`);
	}
	await clickBlankCanvas(page);
}

// --- a reload ----------------------------------------------------------------------------------------

// Criteria 21 and 26: after a reload, a `running` task is followed again by
// the new window, once the window that followed it has not said it is alive
// for 90 seconds, and lands; it is never sent again. An image of a provider
// that answers at once, whose answer was on its way when the window reloaded,
// ends with the message about files that may have been made and charged, and
// a video request still on its way to a provider with tasks ends with the
// message about the provider's console; nothing is sent again. The two
// minutes are made by writing the record as it is when its window last said
// it was alive then.
async function assertReloadContinuesGenerations(page) {
	const provider = await videoSmokeProvider();
	// The provider takes long over this video, and over the image's answer.
	provider.mock.configure({ durationMs: 10_000 });
	try {
		const panel = await selectGenerationCard(page, VIDEO_FAILS);
		await savePrompt(page, panel, VIDEO_FAILS, 'A storm over the pier, after the reload');
		const requestsBefore = provider.mock.requests.length;
		let watch = watchGenerations();
		await clickGenerate(panel);
		await watch.until(w => w.first()?.record.state === 'running', 'the generation to run');
		const before = watch.first().record;
		await reloadWindow(page, GENERATION_FOLDER);
		// The reloaded window shows the card generating, from the record of this computer.
		await waitForReading(() => readGenerationCard(page, VIDEO_FAILS), card => card?.face?.state === 'generating', 'the reloaded window to show the card generating', 30_000);
		ageTaskRecord(before.id);
		await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(VIDEO_FAILS)) && readMade(VIDEO_FAILS) !== undefined, 'the reloaded window to take the generation over and land its video');
		watch.stop();
		const followers = [...new Set(watch.first().states.map(state => state.follower))];
		const made = readMade(VIDEO_FAILS);
		if (followers.length !== 2 || followers[0] !== before.follower || made.id !== before.id || made.remoteId !== before.remoteId || !provider.isVideo(fs.readFileSync(workspaceFile(VIDEO_FAILS)))
			|| provider.requestsSince(requestsBefore).length !== 1) {
			throw new Error(`After a reload, the running task must be followed by the new window and land, and never be sent again: ${JSON.stringify({ states: watch.first().states, made, requests: provider.requestsSince(requestsBefore).length })}`);
		}
		await waitForReading(() => readGenerationCard(page, VIDEO_FAILS), card => card?.generation === 'file' && card.video !== null, 'the card to show the video that landed after the reload');

		// An image answered at once, its answer on its way when the window reloads.
		await clickBlankCanvas(page);
		const image = await createDraftFromMenu(page, 'New Image');
		await setImageCount(page, image.panel, image.cardPath, 1);
		await savePrompt(page, image.panel, image.cardPath, '[mock:slow] The pier at night');
		const imageRequestsBefore = provider.mock.requests.length;
		const createsBefore = provider.creates.length;
		watch = watchGenerations();
		await clickGenerate(image.panel);
		await watch.until(w => w.first()?.record.state === 'submitting', 'the image to be on its way');
		const asked = watch.first().record;
		await reloadWindow(page, GENERATION_FOLDER);
		await waitForReading(() => readGenerationCard(page, image.cardPath), card => card?.face?.state === 'generating', 'the reloaded window to show the image card generating', 30_000);
		ageTaskRecord(asked.id);
		await watch.until(w => w.first()?.record.state === 'failed', 'the reloaded window to end the image whose answer it cannot receive');
		watch.stop();
		const closed = 'BaseHalf closed while the provider was making the files. They may have been made and charged, but BaseHalf could not receive them. Check the provider\'s console.';
		if (watch.first().record.error !== closed || !watch.first().record.answersAtOnce) {
			throw new Error(`An answer on its way when the window closed must end the card with the message about files that may have been made and charged: ${JSON.stringify(watch.first().record)}`);
		}
		await waitForReading(() => readGenerationCard(page, image.cardPath), card => card?.face?.state === 'failed' && card.face.message === closed, 'the image card to say why');
		// Nothing is sent again, also once the provider's answer came back to nobody.
		await page.waitForTimeout(VIDEO_PROVIDER_CREATE_HOLD_MS + 2_000);
		if (provider.creates.length !== createsBefore + 1 || provider.requestsSince(imageRequestsBefore).length > 1) {
			throw new Error(`The image request was sent again after the reload: ${JSON.stringify(provider.requestsSince(imageRequestsBefore))}`);
		}

		// A video request still on its way to a provider with tasks when the
		// window reloads: the relay holds it until after the reload.
		provider.holdCreates(10_000);
		await clickBlankCanvas(page);
		const shot = await createDraftFromMenu(page, 'New Video');
		await page.keyboard.type('The pier in the fog, after another reload');
		const shotCreatesBefore = provider.creates.length;
		watch = watchGenerations();
		await clickGenerate(shot.panel);
		await watch.until(w => w.first()?.record.state === 'submitting', 'the video request to be on its way');
		const onItsWay = watch.first().record;
		await reloadWindow(page, GENERATION_FOLDER);
		await waitForReading(() => readGenerationCard(page, shot.cardPath), card => card?.face?.state === 'generating', 'the reloaded window to show the video card waiting', 30_000);
		ageTaskRecord(onItsWay.id);
		await watch.until(w => w.first()?.record.state === 'failed', 'the reloaded window to end the request that BaseHalf closed on');
		watch.stop();
		const orphaned = 'BaseHalf closed while the request was on its way to the provider. Check the provider\'s console before generating again: a second request may be charged again.';
		if (watch.first().record.error !== orphaned || watch.first().record.answersAtOnce) {
			throw new Error(`A request on its way when the window closed must end the card with the message about the provider's console: ${JSON.stringify(watch.first().record)}`);
		}
		await waitForReading(() => readGenerationCard(page, shot.cardPath), card => card?.face?.state === 'failed' && card.face.message === orphaned, 'the video card to say why');
		// The relay passes the held request on, once: nothing sends it again.
		await page.waitForTimeout(10_000 + 2_000);
		if (provider.creates.length !== shotCreatesBefore + 1) {
			throw new Error(`The video request was sent again after the reload: ${provider.creates.length - shotCreatesBefore} requests`);
		}
	} finally {
		provider.mock.configure({ durationMs: VIDEO_PROVIDER_DURATION_MS });
		provider.holdCreates(VIDEO_PROVIDER_CREATE_HOLD_MS);
	}
	await clickBlankCanvas(page);
}

// --- agents --------------------------------------------------------------------------------------------

// Criteria 3, 4, 24, and 28: a draft an agent wrote with a prompt, a provider,
// a model, a mode, values, and an input shows on the canvas; `basehalf
// --generate` in an Agent Area terminal refuses a value the model does not
// accept and writes nothing; it starts the generation without a question and
// prints the card once its record is `submitting`; a second one while it
// generates is refused with "This card is already generating." and sends
// nothing; the video lands as one Generate makes. From the card with its
// file, a generation that a problem of the provider module stops makes no
// draft and sends nothing.
async function assertAgentGenerates(page) {
	const provider = await videoSmokeProvider();
	const prompt = 'The pier at noon, seen from the water';
	writeUpstreamSidecar(AGENT_DRAFT, [START_IMAGE]);
	writeGenerationInfo(AGENT_DRAFT, { prompt, provider: SMOKE_PROVIDER, model: SEEDANCE, mode: 'frames', params: { resolution: '8k' } });
	await canvasCard(page, AGENT_DRAFT).waitFor({ state: 'attached', timeout: 20_000 });
	if (await canvasCard(page, AGENT_DRAFT).getAttribute('data-generation') !== 'draft') {
		throw new Error(`A draft an agent wrote must show on the canvas as a draft: ${AGENT_DRAFT}`);
	}
	let requestsBefore = provider.mock.requests.length;
	const refused = await runGenerateInTerminal(page, AGENT_DRAFT);
	if (refused.ok !== false || refused.outcome !== 'rejected' || refused.error !== 'Seedance 2.5 does not accept "8k" for Resolution.' || taskRecordOf(AGENT_DRAFT) !== undefined || provider.requestsSince(requestsBefore).length) {
		throw new Error(`basehalf --generate must refuse a value the model does not accept, and write and send nothing: ${JSON.stringify(refused)}`);
	}
	// The agent leaves the values to their defaults but the duration.
	writeGenerationInfo(AGENT_DRAFT, { prompt, provider: SMOKE_PROVIDER, model: SEEDANCE, mode: 'frames', params: { duration: 4 } });
	await page.waitForTimeout(500);
	requestsBefore = provider.mock.requests.length;
	const watch = watchGenerations();
	const answer = await runGenerateInTerminal(page, AGENT_DRAFT);
	const atAnswer = taskRecordOf(AGENT_DRAFT);
	if (canonicalJson(answer) !== canonicalJson({ version: 5, type: 'generate', ok: true, outcome: 'succeeded', path: AGENT_DRAFT, cards: [AGENT_DRAFT] })
		|| (atAnswer === undefined && readMade(AGENT_DRAFT) === undefined) || ['preparing'].includes(atAnswer?.state)) {
		throw new Error(`basehalf --generate must print the card once its record is submitting: ${JSON.stringify({ answer, atAnswer })}`);
	}
	await assertNoDialog(page, 'basehalf --generate');
	const again = await runGenerateInTerminal(page, AGENT_DRAFT);
	if (again.ok !== false || again.error !== 'This card is already generating.') {
		throw new Error(`A second basehalf --generate while the card generates must be refused: ${JSON.stringify(again)}`);
	}
	await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(AGENT_DRAFT)) && readMade(AGENT_DRAFT) !== undefined, 'the video an agent generated to land');
	watch.stop();
	assertStates(watch.first(), ['preparing?', 'submitting', 'running', 'landing?'], 'The generation an agent started');
	const made = readMade(AGENT_DRAFT);
	if (made.provider !== SMOKE_PROVIDER || made.region !== SMOKE_REGION || made.model !== SEEDANCE || made.mode !== 'frames' || made.prompt !== prompt
		|| JSON.stringify(made.inputs) !== JSON.stringify([START_IMAGE]) || made.params.duration !== 4 || made.params.resolution !== '720p') {
		throw new Error(`The card an agent generated must end with a video, the values it left out sent with their defaults: ${JSON.stringify(made)}`);
	}
	const requests = provider.requestsSince(requestsBefore);
	const parts = JSON.stringify(requests[0]?.parts ?? []);
	if (requests.length !== 1 || !parts.includes('first_frame') || parts.includes('last_frame') || requests[0].prompt !== prompt) {
		throw new Error(`The agent's generation must send one request with the prompt and the start frame: ${JSON.stringify(requests)}`);
	}
	// From the card with its file, a prompt the provider module refuses stops
	// the generation after its new draft was made: the draft goes, and nothing is sent.
	const file = path.join(mirrorFolder(AGENT_DRAFT), 'generation.yaml');
	const info = fs.readFileSync(file, 'utf8');
	fs.writeFileSync(file, info.replace(`prompt: ${JSON.stringify(prompt)}`, `prompt: ${JSON.stringify(`${prompt} --rs 1080p`)}`), 'utf8');
	await page.waitForTimeout(500);
	requestsBefore = provider.mock.requests.length;
	const blocked = await runGenerateInTerminal(page, AGENT_DRAFT);
	const leftDrafts = fs.readdirSync(mirrorFolder(GENERATION_FOLDER)).filter(name => /^agent-shot-\d+\.mp4$/.test(name));
	if (blocked.ok !== false || blocked.error !== PROMPT_FLAG_PROBLEM || leftDrafts.length || provider.requestsSince(requestsBefore).length || [...readTaskRecords().values()].some(record => record.cards.some(card => card.path.startsWith(`${GENERATION_FOLDER}/agent-shot-`)))) {
		throw new Error(`A generation that a blocker stops must make no draft and send nothing: ${JSON.stringify({ blocked, leftDrafts })}`);
	}
	fs.writeFileSync(file, info, 'utf8');
	await closeAgentArea(page);
	// After all these generations, no workspace file holds a credential.
	for (const key of [provider.key, smoke.secondKey]) {
		const files = filesContaining(workspacePath, key);
		if (files.length) {
			throw new Error(`A provider's credentials are in workspace files: ${files.join(', ')}`);
		}
	}
}

// --- moving, renaming, deleting ------------------------------------------------------------------------

const HARBOUR = `${GENERATION_FOLDER}/harbour.mp4`;
const STORM = `${GENERATION_FOLDER}/storm.mp4`;

// Criterion 5: a card with its file renamed in Finder keeps its prompt,
// settings, record, connections, and place; a draft renamed on the canvas
// keeps its prompt, settings, connections, and place; the folder of a
// generating draft renamed in Finder lands the file in the renamed folder.
async function assertRenamesKeepCards(page) {
	const provider = await videoSmokeProvider();
	// A generated video, renamed in Finder; BaseHalf knows it, since it landed a while ago.
	const names = ['generation.yaml', 'made.yaml', 'upstream.yaml'];
	const before = { texts: names.map(name => readTextIfThere(path.join(mirrorFolder(VIDEO_AGAIN), name))), row: readCardRow(VIDEO_AGAIN) };
	fs.renameSync(workspaceFile(VIDEO_AGAIN), workspaceFile(HARBOUR));
	await waitUntil(() => JSON.stringify(cardInformationFiles(HARBOUR)) === JSON.stringify(names) && !fs.existsSync(mirrorFolder(VIDEO_AGAIN)), `the card information of ${VIDEO_AGAIN} to follow it to ${HARBOUR}`, 20_000);
	await canvasCard(page, HARBOUR).waitFor({ state: 'attached', timeout: 15_000 });
	const after = { texts: names.map(name => readTextIfThere(path.join(mirrorFolder(HARBOUR), name))), row: readCardRow(HARBOUR) };
	if (JSON.stringify(after.texts) !== JSON.stringify(before.texts) || after.row?.x !== before.row.x || after.row.y !== before.row.y || await canvasCard(page, HARBOUR).getAttribute('data-generation') !== 'file') {
		throw new Error(`A generated file renamed in Finder must keep its prompt, settings, record, connections, and place: ${JSON.stringify({ before, after })}`);
	}
	await assertCanvasEdgeVisible(page, START_IMAGE, HARBOUR);

	// A draft renamed on the canvas, made where start.png is in sight, to pick it on the canvas.
	await clickBlankCanvas(page);
	await showCardOnCanvas(page, START_IMAGE, true);
	const { cardPath, panel } = await createDraftFromMenu(page, 'New Video');
	await page.keyboard.type('A storm rolls in over the harbour');
	await pickInputOnCanvas(page, panel, START_IMAGE, 'button.bh-video-panel-slot.empty[data-role="start"]');
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(cardPath)) === JSON.stringify([START_IMAGE]) && readGenerationInfo(cardPath)?.prompt === 'A storm rolls in over the harbour', `the prompt and the input of ${cardPath} to be saved`, 10_000);
	const draft = { info: readGenerationInfo(cardPath), row: readCardRow(cardPath) };
	await clickBlankCanvas(page);
	await canvasCard(page, cardPath).focus();
	await page.keyboard.press('F2');
	const input = canvasCard(page, cardPath).locator('.basehalf-canvas-inline-name-input input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	await input.fill('storm.mp4');
	await input.press('Enter');
	await waitUntil(() => readGenerationInfo(STORM) !== undefined && !fs.existsSync(mirrorFolder(cardPath)), `renaming the draft on the canvas to move it to ${STORM}`, 10_000);
	await canvasCard(page, STORM).waitFor({ state: 'attached', timeout: 10_000 });
	const renamed = readCardRow(STORM);
	if (canonicalJson(readGenerationInfo(STORM)) !== canonicalJson(draft.info) || JSON.stringify(readUpstreamSidecar(STORM)) !== JSON.stringify([START_IMAGE])
		|| renamed?.x !== draft.row.x || renamed.y !== draft.row.y || readCardRow(cardPath) !== undefined || fs.existsSync(workspaceFile(STORM))) {
		throw new Error(`A draft renamed on the canvas must keep its prompt, settings, connections, and place: ${JSON.stringify({ draft, info: readGenerationInfo(STORM), renamed })}`);
	}
	await assertCanvasEdgeVisible(page, START_IMAGE, STORM);

	// The folder of a generating draft, renamed in Finder.
	const shotsBefore = `${GENERATION_FOLDER}/shots-a`;
	const shotsAfter = `${GENERATION_FOLDER}/shots-b`;
	fs.mkdirSync(workspaceFile(shotsBefore), { recursive: true });
	fs.writeFileSync(workspaceFile(`${shotsBefore}/plan.md`), '# Shots\n\nThe folder of a draft that generates while the folder is renamed.\n', 'utf8');
	writeGenerationInfo(`${shotsBefore}/clip.mp4`, { prompt: 'A quiet harbour', provider: SMOKE_PROVIDER, model: SEEDANCE, mode: 'frames' });
	// BaseHalf takes the new folder into what it follows after its quiet second.
	await page.waitForTimeout(3_000);
	provider.mock.configure({ durationMs: 10_000 });
	try {
		const watch = watchGenerations([shotsAfter]);
		const answer = await runGenerateInTerminal(page, `${shotsBefore}/clip.mp4`);
		if (answer.ok !== true) {
			throw new Error(`basehalf --generate must start the draft below the folder: ${JSON.stringify(answer)}`);
		}
		await watch.until(w => w.first()?.record.state === 'running', 'the draft below the folder to generate');
		fs.renameSync(workspaceFile(shotsBefore), workspaceFile(shotsAfter));
		await watch.until(w => w.first()?.record.cards?.[0]?.path === `${shotsAfter}/clip.mp4`, 'the move of the folder to write the new path of the card into its record', 20_000);
		await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(`${shotsAfter}/clip.mp4`)) && readMade(`${shotsAfter}/clip.mp4`) !== undefined, 'the file to land in the renamed folder');
		watch.stop();
		if (fs.existsSync(workspaceFile(shotsBefore)) || fs.existsSync(mirrorFolder(`${shotsBefore}/clip.mp4`)) || readGenerationInfo(`${shotsAfter}/clip.mp4`)?.prompt !== 'A quiet harbour') {
			throw new Error(`The file of a draft whose folder was renamed must land in the renamed folder: ${JSON.stringify({ old: fs.existsSync(workspaceFile(shotsBefore)), info: readGenerationInfo(`${shotsAfter}/clip.mp4`) })}`);
		}
	} finally {
		provider.mock.configure({ durationMs: VIDEO_PROVIDER_DURATION_MS });
	}
	await closeAgentArea(page);
}

// Criterion 6: a generated file deleted in Finder takes its card off the
// canvas and leaves no draft to generate; its card information stays, a
// draft renamed to its name meanwhile is refused, and when the file comes
// back its card comes back with its prompt and record. The smoke deletes
// permanently, so a file moved out of the workspace stands for one in the
// Trash.
async function assertMissingFileComesBack(page) {
	const names = ['generation.yaml', 'made.yaml', 'upstream.yaml'];
	const texts = names.map(name => readTextIfThere(path.join(mirrorFolder(HARBOUR), name)));
	const parked = path.join(path.dirname(workspacePath), 'harbour-parked.mp4');
	fs.renameSync(workspaceFile(HARBOUR), parked);
	await canvasCard(page, HARBOUR).waitFor({ state: 'detached', timeout: 20_000 });
	// It never becomes a draft: nothing shows at its path, and its card information stays.
	await page.waitForTimeout(1_500);
	if (await canvasCard(page, HARBOUR).count() !== 0 || JSON.stringify(names.map(name => readTextIfThere(path.join(mirrorFolder(HARBOUR), name)))) !== JSON.stringify(texts)) {
		throw new Error(`A generated file that is gone must leave the canvas and keep its card information: ${JSON.stringify(cardInformationFiles(HARBOUR))}`);
	}
	const refused = await runGenerateInTerminal(page, HARBOUR);
	if (refused.ok !== false || !refused.error?.includes('harbour.mp4') || taskRecordOf(HARBOUR) !== undefined) {
		throw new Error(`basehalf --generate must not generate a file that is gone: ${JSON.stringify(refused)}`);
	}
	await closeAgentArea(page);
	// A draft renamed to its name meanwhile is refused, and stays as it is.
	await canvasCard(page, STORM).focus();
	await page.keyboard.press('F2');
	const input = canvasCard(page, STORM).locator('.basehalf-canvas-inline-name-input input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	await input.fill('harbour.mp4');
	await input.press('Enter');
	await page.waitForTimeout(1_000);
	if (readGenerationInfo(STORM) === undefined || JSON.stringify(names.map(name => readTextIfThere(path.join(mirrorFolder(HARBOUR), name)))) !== JSON.stringify(texts)) {
		throw new Error(`Renaming a draft to the name of a generated file that is gone must be refused: ${JSON.stringify({ storm: readGenerationInfo(STORM), harbour: cardInformationFiles(HARBOUR) })}`);
	}
	if (await input.isVisible().catch(() => false)) {
		await input.press('Escape');
		await input.waitFor({ state: 'hidden', timeout: 10_000 });
	}
	// The file comes back, and its card with its prompt and record.
	fs.renameSync(parked, workspaceFile(HARBOUR));
	await canvasCard(page, HARBOUR).waitFor({ state: 'attached', timeout: 20_000 });
	await waitForReading(() => readGenerationCard(page, HARBOUR), card => card?.generation === 'file', `the card of ${HARBOUR} to come back`);
	if (JSON.stringify(names.map(name => readTextIfThere(path.join(mirrorFolder(HARBOUR), name)))) !== JSON.stringify(texts)) {
		throw new Error(`A generated file that comes back must find its prompt and record: ${JSON.stringify(cardInformationFiles(HARBOUR))}`);
	}
}

// Criterion 7: a `generation.yaml` with git's conflict markers leaves the card
// shown and the panel usable; saving a prompt keeps a recovery copy and says
// so, and `made.yaml` is unchanged.
async function assertConflictMarkersKeepTheCard(page) {
	const file = path.join(mirrorFolder(IMAGE), 'generation.yaml');
	const conflicted = ['<<<<<<< HEAD', 'prompt: "A lighthouse at dawn"', '=======', 'prompt: "A lighthouse at dusk"', '>>>>>>> theirs', ''].join('\n');
	const madeText = readTextIfThere(path.join(mirrorFolder(IMAGE), 'made.yaml'));
	fs.writeFileSync(file, conflicted, 'utf8');
	await page.waitForTimeout(1_000);
	const card = await readGenerationCard(page, IMAGE);
	if (card?.generation !== 'file' || !card.image?.complete) {
		throw new Error(`A card whose generation.yaml has conflict markers must stay shown: ${JSON.stringify(card)}`);
	}
	const panel = await selectGenerationCard(page, IMAGE);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.notice === 'BaseHalf could not read this card\'s prompt and settings.' && seen.prompt === '', 'the panel to say that it could not read the prompt and settings');
	await savePrompt(page, panel, IMAGE, 'A lighthouse in the fog');
	await expectNotification(page, 'BaseHalf could not read the saved prompt and settings of image.png, so it saved the new ones. A copy of the old ones is kept.');
	const recoveredFolder = path.join(workspacePath, '.bh', 'cache', 'recovered', 'mirror', ...IMAGE.split('/'));
	const copies = fs.existsSync(recoveredFolder) ? fs.readdirSync(recoveredFolder).filter(name => /^generation\.[0-9a-f]{12}\.yaml$/.test(name)) : [];
	if (copies.length !== 1 || fs.readFileSync(path.join(recoveredFolder, copies[0]), 'utf8') !== conflicted
		|| fs.readFileSync(file, 'utf8') !== 'prompt: "A lighthouse in the fog"\n' || readTextIfThere(path.join(mirrorFolder(IMAGE), 'made.yaml')) !== madeText) {
		throw new Error(`Saving a prompt over conflict markers must keep a recovery copy and leave made.yaml as it is: ${JSON.stringify({ copies, now: fs.readFileSync(file, 'utf8') })}`);
	}
	await clickBlankCanvas(page);
}

// Criterion 8: a file dropped into the folder under a draft's name becomes
// the draft's file; a file moved there in Finder that BaseHalf recognizes
// keeps its own card information, and the draft moves to the next free name.
async function assertFileAtDraftPath(page) {
	const dropped = `${GENERATION_FOLDER}/dropped.png`;
	writeGenerationInfo(dropped, { prompt: 'A picture dropped into the folder' });
	await waitForReading(() => readGenerationCard(page, dropped), card => card?.generation === 'draft', `the draft ${dropped} to show`, 20_000);
	// A card that an agent added goes to the end of the canvas, and the view stays: the step looks there.
	await showCardOnCanvas(page, dropped);
	fs.writeFileSync(workspaceFile(dropped), solidPng(320, 200, [16, 185, 129]));
	await waitForReading(() => readGenerationCard(page, dropped), card => card?.generation === 'file' && card.image?.complete === true && card.image.width === 320, `the card of ${dropped} to show the dropped file`, 20_000);
	if (readGenerationInfo(dropped)?.prompt !== 'A picture dropped into the folder' || readMade(dropped) !== undefined) {
		throw new Error(`A file dropped under a draft's name becomes its file, and keeps its prompt with no record: ${JSON.stringify(cardInformationFiles(dropped))}`);
	}

	const known = `${GENERATION_FOLDER}/known.png`;
	const target = `${GENERATION_FOLDER}/target.png`;
	const aside = `${GENERATION_FOLDER}/target-2.png`;
	fs.writeFileSync(workspaceFile(known), solidPng(320, 200, [190, 24, 93]));
	fs.mkdirSync(mirrorFolder(known), { recursive: true });
	fs.writeFileSync(path.join(mirrorFolder(known), 'badge.yaml'), `path: "${known}"\nkind: file\ndescription: "A picture with a description of its own"\n`, 'utf8');
	writeGenerationInfo(target, { prompt: 'The draft whose name a moved picture takes' });
	await waitForReading(() => readGenerationCard(page, target), card => card?.generation === 'draft', `the draft ${target} to show`, 20_000);
	await canvasCard(page, known).waitFor({ state: 'attached', timeout: 20_000 });
	// BaseHalf takes the new file and its description into what it follows after its quiet second.
	await page.waitForTimeout(3_000);
	fs.renameSync(workspaceFile(known), workspaceFile(target));
	await waitUntil(() => fs.existsSync(path.join(mirrorFolder(target), 'badge.yaml')) && readGenerationInfo(aside)?.prompt === 'The draft whose name a moved picture takes' && !fs.existsSync(mirrorFolder(known)),
		`the moved picture to keep its own card information at ${target}, and the draft to move to ${aside}`, 20_000);
	if (readGenerationInfo(target) !== undefined || !fs.readFileSync(path.join(mirrorFolder(target), 'badge.yaml'), 'utf8').includes('A picture with a description of its own')) {
		throw new Error(`The moved file keeps its own card information: ${JSON.stringify(cardInformationFiles(target))}`);
	}
	await waitForReading(() => readGenerationCard(page, aside), card => card?.generation === 'draft', `the draft to show at ${aside}`, 20_000);
	await showCardOnCanvas(page, target);
	await waitForReading(() => readGenerationCard(page, target), card => card !== null && card.generation === null && card.image?.complete === true, `the card of ${target} to show the moved picture`, 20_000);
}

// Criterion 32: deleting a draft takes its card information, its connections,
// and its place, after asking; undo brings back its prompt, settings,
// connections, and place.
async function assertDeleteDraftAndUndo(page) {
	await clickBlankCanvas(page);
	await showCardOnCanvas(page, STORM);
	const before = { info: readGenerationInfo(STORM), upstream: readUpstreamSidecar(STORM), row: readCardRow(STORM) };
	const card = canvasCard(page, STORM);
	await card.click({ button: 'right' });
	const deleteAction = page.locator('.context-view.monaco-menu-container .action-label').filter({ hasText: /^Delete\.\.\.$/ }).filter({ visible: true }).last();
	await deleteAction.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(150);
	await deleteAction.click();
	const dialog = page.locator('.monaco-dialog-box', { hasText: 'Delete \'storm.mp4\'?' }).first();
	await dialog.waitFor({ state: 'visible', timeout: 10_000 });
	await dialog.locator('.monaco-button', { hasText: /^Delete$/ }).click();
	await waitUntil(() => !fs.existsSync(mirrorFolder(STORM)) && readCardRow(STORM) === undefined, `deleting the draft to take its card information and its place`, 10_000);
	await card.waitFor({ state: 'detached', timeout: 10_000 });
	await assertCanvasEdgeGone(page, START_IMAGE, STORM);
	await canvasCard(page, START_IMAGE).focus();
	await page.keyboard.press(UNDO);
	await waitUntil(() => readGenerationInfo(STORM) !== undefined, 'undo to bring the deleted draft back', 10_000);
	await card.waitFor({ state: 'attached', timeout: 10_000 });
	const back = readCardRow(STORM);
	if (canonicalJson(readGenerationInfo(STORM)) !== canonicalJson(before.info) || JSON.stringify(readUpstreamSidecar(STORM)) !== JSON.stringify(before.upstream) || back?.x !== before.row.x || back.y !== before.row.y) {
		throw new Error(`Undo of deleting a draft must bring back its prompt, settings, connections, and place: ${JSON.stringify({ before, info: readGenerationInfo(STORM), upstream: readUpstreamSidecar(STORM), back })}`);
	}
	await assertCanvasEdgeVisible(page, START_IMAGE, STORM);
}
