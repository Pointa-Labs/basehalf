/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The Video node of the built-in AI Video, step by step against the local test provider.

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { filesContaining, pngSize, recordVideoNodeStates, startVideoSmokeProvider } from './videoProvider.mts';
import {
	assertSameCanvasView,
	canonicalJson,
	captureVideoCardFrame,
	clickBlankVideoCanvas,
	clickCanvasCardOnTop,
	clickVideoModel,
	closeVideoPanelMenu,
	createVideoSmokeFolder,
	drawCanvasConnectionInto,
	generateVideoUntilEnded,
	openVideoSettings,
	playVideoCard,
	readAgentAreaTerminalJson,
	readVideoCanvasLayout,
	readVideoCard,
	readVideoMentionMenu,
	readVideoModelMenu,
	readVideoNode,
	readVideoPanel,
	readVideoPanelGeometry,
	readVideoSettingsPopover,
	replaceVideoPrompt,
	seekVideoCard,
	selectVideoCard,
	setCanvasZoomPercent,
	videoCanvasCard,
	videoPanel,
	videoWorkspaceFile,
	waitForGenerationStart,
	waitForVideoPanel
} from './videoProbes.mts';
import { workspacePath } from '../../context.mts';
import { waitForAgentAreaTerminalPrompt } from '../../lib/agentArea.mts';
import {
	assertCanvasFolder,
	assertCanvasMenuOpenedByClick,
	assertNoCanvasFocusRing,
	clickCanvasCreateSubmenuAction,
	panCanvasCardTo,
	readCanvasCardGeometry,
	readCanvasView,
	waitForCanvasCardSelection
} from '../../lib/canvas.mts';
import { quickOpen, runCommand } from '../../lib/quickInput.mts';
import { assertSettingsFramesShowedOnly, watchSettingsFrames } from '../../lib/settingsFrames.mts';
import { step, waitUntil } from '../../lib/steps.mts';
import {
	closeVideoProvidersPage,
	openVideoProvidersPage,
	readVideoProviderEditor,
	readVideoProviderRows,
	VIDEO_PROVIDER,
	VIDEO_REGION,
	waitForReading,
	waitForVideoProvidersPage
} from '../../lib/videoProviders.mts';

// The Video node steps (D58, D59) work in a folder of their own with two
// images, against the local test provider of basehalf-smoke-video.mts,
// reached through the provider whose catalog id is VIDEO_PROVIDER in
// VIDEO_REGION. Its labels, credentials, and models are read from the
// catalog the window shows.
export const VIDEO_FOLDER = 'video-smoke';
const VIDEO_NODE = `${VIDEO_FOLDER}/video.bhnode`;
// What Generate makes beside VIDEO_NODE once that holds a video: numbered as
// the create menu numbers new nodes.
const VIDEO_SIBLING_NODE = `${VIDEO_FOLDER}/video-2.bhnode`;
// The second node made from the create menu, for generations that end without a video.
const VIDEO_SECOND_NODE = `${VIDEO_FOLDER}/video-3.bhnode`;
const VIDEO_AGENT_NODE = `${VIDEO_FOLDER}/agent-shot.bhnode`;
export const VIDEO_START_IMAGE = `${VIDEO_FOLDER}/start.png`;
export const VIDEO_END_IMAGE = `${VIDEO_FOLDER}/end.png`;
const VIDEO_PROMPT = 'A cyclist rides along the sea at dusk, the camera follows slowly';
// The prompt once `@` has typed the name of the end frame into it.
const VIDEO_PROMPT_WITH_NAME = `${VIDEO_PROMPT} Image 2`;
// The test provider makes a video in this long; Generate first asks 3 s after the task is made.
const VIDEO_PROVIDER_DURATION_MS = 2_000;
// The relay holds each create request this long, so the node's file is read while it is `submitting`.
const VIDEO_PROVIDER_CREATE_HOLD_MS = 1_500;
export const VIDEO_GENERATION_TIMEOUT_MS = 60_000;
// The test provider, and what the steps learn from the window: the first
// model of VIDEO_PROVIDER, the settings it shows, and the generation the node
// stores once they are chosen.
const videoSmoke = { provider: undefined, model: undefined, summary: undefined, generation: undefined };

// --- The Video node (D58, D59, docs/specs/video-node.md) -------------------------------------
//
// Acceptance criteria 2, 4, 6 to 17, 19, 20, and 22, and the two frames of 3,
// through the window and against the local test provider with its test key,
// reached through the provider module of VIDEO_PROVIDER; no paid provider is
// called. The steps run in order, each where the one before ended.

export async function runVideoNodeSteps(page) {
	await step('video-node-create-opens-panel', () => assertVideoNodeCreateOpensPanel(page));
	await step('video-node-prompt-saves-without-dialog', () => assertVideoNodePromptSavesWithoutDialog(page));
	await step('video-providers-set-up', () => assertVideoProvidersSetUp(page));
	await step('video-panel-model-and-settings', () => assertVideoPanelModelAndSettings(page));
	await step('video-provider-key-stays-secret', () => assertVideoProviderKeyStaysSecret(page));
	await step('video-panel-inputs-and-names', () => assertVideoPanelInputsAndNames(page));
	await step('video-panel-placement', () => assertVideoPanelPlacement(page));
	await step('video-generate-writes-video', () => assertVideoGenerateWritesVideo(page));
	await step('video-capture-frames', () => assertVideoCaptureFrames(page));
	await step('video-card-keeps-its-player', () => assertVideoCardKeepsItsPlayer(page));
	await step('video-generate-again-makes-sibling', () => assertVideoGenerateAgainMakesSibling(page));
	await step('video-generation-fails-and-stops', () => assertVideoGenerationFailsAndStops(page));
	await step('video-agent-runs-node', () => assertVideoAgentRunsNode(page));
}

export async function videoSmokeProvider() {
	videoSmoke.provider ??= await startVideoSmokeProvider({ durationMs: VIDEO_PROVIDER_DURATION_MS, holdCreateMs: VIDEO_PROVIDER_CREATE_HOLD_MS });
	return videoSmoke.provider;
}

export async function stopVideoSmokeProvider() {
	const provider = videoSmoke.provider;
	videoSmoke.provider = undefined;
	await provider?.close().catch(error => console.error(`[basehalf-smoke] the video test provider did not stop: ${error instanceof Error ? error.message : String(error)}`));
}

// Criteria 8 and 12, and the first half of 10: a Video node made from the
// create menu is selected and shows its panel with the prompt focused and no
// ring around it, nothing has moved the view, and with no model chosen
// Generate is disabled and says why, also in its tooltip.
async function assertVideoNodeCreateOpensPanel(page) {
	await videoSmokeProvider();
	createVideoSmokeFolder();
	await quickOpen(page, VIDEO_FOLDER);
	await assertCanvasFolder(page, VIDEO_FOLDER);
	const start = videoCanvasCard(page, VIDEO_START_IMAGE);
	await start.waitFor({ state: 'visible', timeout: 20_000 });
	await videoCanvasCard(page, VIDEO_END_IMAGE).waitFor({ state: 'visible', timeout: 20_000 });
	// At half size, with the images at the top left, the middle of the view
	// has room for the new card, which is 720 by 405.
	await setCanvasZoomPercent(page, 50);
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	await panCanvasCardTo(page, start, { x: canvasBox.x + 40, y: canvasBox.y + 60 });
	const viewBefore = await readCanvasView(page);

	await clickCanvasCreateSubmenuAction(page, 'New Media or Document', 'Video');
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(VIDEO_NODE)), `the create menu to make ${VIDEO_NODE}`, 20_000);
	const created = readVideoNode(VIDEO_NODE);
	// No generation ran on this computer yet, so the node chooses no model.
	if (JSON.stringify(Object.keys(created).sort()) !== JSON.stringify(['id', 'kind', 'prompt', 'title', 'upstream', 'version'])
		|| created.version !== 6 || created.kind !== 'video' || created.title !== 'Video' || created.prompt !== '' || created.upstream.length !== 0) {
		throw new Error(`The create menu made an unexpected Video node: ${JSON.stringify(created)}`);
	}
	await waitForCanvasCardSelection(page, VIDEO_NODE, 15_000);
	const panel = await waitForVideoPanel(page, VIDEO_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.promptFocused, 'the prompt of the new Video node to have the keyboard focus');
	await assertNoCanvasFocusRing(page, 'The prompt of the new Video node');
	assertSameCanvasView(viewBefore, await readCanvasView(page), 'Making a Video node and opening its panel');
	// The panel shows that the models load until AI Video answers with the catalog.
	const shown = await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === true && seen.catalog === 'ready', 'Generate to be disabled while no model is chosen, once the catalog is there', 30_000);
	// No model and no prompt: the first blocker is the model.
	if (shown.generate.label !== 'Choose a model to generate.' || shown.model !== 'Choose Model' || !shown.modelOutlined || shown.generate.stop) {
		throw new Error(`Without a model, Generate must say so as its name and the model button must be outlined: ${JSON.stringify(shown)}`);
	}
	await panel.locator('button.bh-video-panel-generate').hover();
	await page.locator('.workbench-hover', { hasText: 'Choose a model to generate.' }).waitFor({ state: 'visible', timeout: 10_000 });
	await page.mouse.move(canvasBox.x + 8, canvasBox.y + canvasBox.height - 8);
}

// Criteria 9 and 10, and the first half of 23: the prompt typed with the
// keyboard, with no ring around it, is saved to the node's file when the user
// clicks the canvas, without a model and without a dialog, and the panel goes
// with the card's selection.
async function assertVideoNodePromptSavesWithoutDialog(page) {
	const panel = videoPanel(page, VIDEO_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.promptFocused, 'the prompt to keep the keyboard focus');
	await page.keyboard.type(VIDEO_PROMPT);
	await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === VIDEO_PROMPT, 'the prompt to hold what was typed');
	await assertNoCanvasFocusRing(page, 'The prompt while it is typed in');
	await clickBlankVideoCanvas(page);
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === VIDEO_PROMPT, `the typed prompt to be saved in ${VIDEO_NODE}`, 10_000);
	await waitForReading(() => page.locator('.basehalf-canvas-video-panel-surface').count(), count => count === 0, 'the Video panel to go when its card is no longer selected');
	// Saving never asks, also a moment later.
	await page.waitForTimeout(500);
	if (await page.locator('.monaco-dialog-box').count() !== 0) {
		throw new Error(`Saving the prompt of a Video node opened a dialog: ${await page.locator('.monaco-dialog-box').first().innerText()}`);
	}
	if (readVideoNode(VIDEO_NODE).generation !== undefined) {
		throw new Error(`Saving the prompt chose a model: ${JSON.stringify(readVideoNode(VIDEO_NODE))}`);
	}
}

// Criterion 6, and the start of 7: the page sets up the provider of the
// catalog in a region of its own, and points it at the test provider, a relay
// on this computer that mirrors the provider's own API. Its credentials come
// in a later step, so the model menu first shows it as not set up. Settings,
// opened for the first time in this window, shows the page from its first
// frame on (settings pages, criterion 1).
async function assertVideoProvidersSetUp(page) {
	const provider = await videoSmokeProvider();
	await watchSettingsFrames(page);
	const providers = await openVideoProvidersPage(page);
	await assertSettingsFramesShowedOnly(page, 'Video Providers', 'basehalf-video-providers', 'The command Video Providers');
	await waitForReading(() => readVideoProviderRows(providers), seen => seen.some(row => row.id === VIDEO_PROVIDER), `the page to list ${VIDEO_PROVIDER}`, 30_000);
	await providers.locator(`.basehalf-video-provider-row[data-provider="${VIDEO_PROVIDER}"]`).click();
	let editor = await waitForReading(() => readVideoProviderEditor(providers), seen => seen.provider === VIDEO_PROVIDER, `the page to show ${VIDEO_PROVIDER}`);
	if (!editor.regions.some(region => region.id === VIDEO_REGION)) {
		throw new Error(`${VIDEO_PROVIDER} must offer the region ${VIDEO_REGION}: ${JSON.stringify(editor)}`);
	}
	if (!editor.regions.find(region => region.id === VIDEO_REGION)?.checked) {
		await providers.locator(`.basehalf-video-provider-region[data-region="${VIDEO_REGION}"]`).click();
		editor = await waitForReading(() => readVideoProviderEditor(providers), seen => seen.regions.find(region => region.id === VIDEO_REGION)?.checked === true, `the region ${VIDEO_REGION} to be chosen`);
	}
	await providers.locator('#basehalf-video-provider-endpoint').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(provider.endpoint);
	await page.keyboard.press('Enter');
	const saved = await waitForReading(() => readVideoProviderEditor(providers), seen => seen.endpoint === provider.endpoint && seen.customEndpoint, 'the endpoint of the test provider to be saved');
	if (saved.rowSetUp !== 'false' || saved.credentials.some(credential => credential.set)) {
		throw new Error(`Without its credentials, ${VIDEO_PROVIDER} must not be set up: ${JSON.stringify(saved)}`);
	}
	await closeVideoProvidersPage(page, providers);
	await assertCanvasFolder(page, VIDEO_FOLDER);
}

// Criteria 7, 11, 12, and 22, and the model menu of 24: the model menu lists
// the catalog's models by provider, says that the provider is not set up, and
// ends with the way to Video Providers; opened by a click, it has no current
// item and no ring; choosing the first model of VIDEO_PROVIDER stores it with
// its mode and the defaults of its values, and leaves no ring on the model
// button; Generate names the provider that is not set up; the settings
// popover is drawn from the model's parameters, and a change is shown and
// stored at once; the estimate shows before the credentials are set.
async function assertVideoPanelModelAndSettings(page) {
	const panel = await selectVideoCard(page, VIDEO_NODE);
	await panel.locator('button.bh-video-panel-model').click();
	const menu = await waitForReading(() => readVideoModelMenu(panel), seen => seen !== null && seen.groups.length > 0, 'the model menu to list the catalog\'s models');
	await assertCanvasMenuOpenedByClick(page, '.bh-video-panel-menu.model', 'The model menu');
	const group = menu.groups.find(candidate => candidate.provider === VIDEO_PROVIDER);
	if (!group || group.detail !== 'Not set up' || !group.items.length || JSON.stringify(menu.end) !== JSON.stringify(['Video Providers…'])) {
		throw new Error(`The model menu must list ${VIDEO_PROVIDER}'s models as not set up, and end with Video Providers…: ${JSON.stringify(menu)}`);
	}
	// Each model with its abilities on a second line, its modes first.
	if (menu.groups.some(candidate => candidate.items.some(item => !item.detail || !/^(Frames|References|Extend|Edit)\b/.test(item.detail)))) {
		throw new Error(`Every model must show its abilities under its name: ${JSON.stringify(menu.groups.map(candidate => candidate.items))}`);
	}
	videoSmoke.model = group.items[0].model;
	await clickVideoModel(page, panel, videoSmoke.model);
	const afterChoice = await assertNoCanvasFocusRing(page, 'The model button after a model was chosen with the mouse');
	if (!afterChoice.element?.includes('bh-video-panel-model')) {
		throw new Error(`Choosing a model must give the focus back to the model button: ${JSON.stringify(afterChoice)}`);
	}
	const chosen = await waitForReading(() => readVideoNode(VIDEO_NODE).generation, generation => generation?.provider === VIDEO_PROVIDER && generation.model === videoSmoke.model
		&& typeof generation.mode === 'string' && generation.params && typeof generation.params === 'object', 'choosing the model to store its provider, model, mode, and values', 10_000);
	// Frames take the two images of the next steps.
	if (chosen.mode !== 'frames') {
		throw new Error(`The first model of ${VIDEO_PROVIDER} must start in frames mode: ${JSON.stringify(chosen)}`);
	}
	const blocked = await waitForReading(() => readVideoPanel(panel), seen => seen.model === group.items[0].label && / is not set up\. Set it up in Video Providers\.$/.test(seen.generate?.label ?? ''), 'Generate to say that the provider is not set up');
	if (!blocked.generate.disabled || !blocked.modelOutlined) {
		throw new Error(`Without its credentials, Generate must be disabled and the model button outlined: ${JSON.stringify(blocked)}`);
	}
	// The reason shows above the footer too, with Set Up.
	if (blocked.reason?.text !== blocked.generate.label || blocked.reason?.action !== 'Set Up') {
		throw new Error(`The panel must say why Generate cannot run, with Set Up: ${JSON.stringify(blocked)}`);
	}
	// The estimate is asked for without the credentials.
	const estimated = await waitForReading(() => readVideoPanel(panel), seen => seen.estimate !== null, 'the estimate to show beside Generate', 15_000);
	if (!/^(≈ [¥$][\d,]+\.\d\d|[¥$][\d,]+\.\d\d–[¥$][\d,]+\.\d\d)$/.test(estimated.estimate.text) || !/What .+ bills is what counts\.$/.test(estimated.estimate.label ?? '')) {
		throw new Error(`The estimate must show a price in the region's currency, with its source: ${JSON.stringify(estimated.estimate)}`);
	}

	let settings = await openVideoSettings(panel);
	if (settings.width !== 300 || !settings.parameters.length || settings.checked.length === 0) {
		throw new Error(`The settings popover must be drawn from the model's parameters, 300 px wide: ${JSON.stringify(settings)}`);
	}
	// A choice of a parameter that is not chosen yet: shown and stored at once.
	const choice = settings.choices.find(candidate => !candidate.checked && !candidate.key.startsWith('mode:') && !candidate.key.endsWith(':none') && !candidate.key.endsWith(':auto'));
	if (!choice) {
		throw new Error(`The settings of the first model must offer a choice to change: ${JSON.stringify(settings)}`);
	}
	const before = (await readVideoPanel(panel)).settings;
	await panel.locator(`.bh-video-panel-menu.settings [data-key="${choice.key}"]`).click();
	settings = await waitForReading(() => readVideoSettingsPopover(panel), seen => seen?.checked.includes(choice.key) === true, `the choice ${choice.key} to be shown`);
	const changed = await waitForReading(() => readVideoPanel(panel), seen => seen.settings !== before, 'the settings button to sum up the change');
	const stored = await waitForReading(() => readVideoNode(VIDEO_NODE).generation, generation => String(generation?.params?.[choice.parameter]) === choice.value, `${VIDEO_NODE} to store ${choice.key}`, 10_000);
	if (!changed.settings.startsWith('Frames')) {
		throw new Error(`The settings button must name the mode first: ${JSON.stringify(changed)}`);
	}
	videoSmoke.summary = changed.settings;
	videoSmoke.generation = stored;
	await closeVideoPanelMenu(page, panel, 'settings');
	// Set Up opens Video Providers at the provider that is not set up, from
	// the first frame of Settings on, though Settings was last closed there.
	await watchSettingsFrames(page);
	await panel.locator('button.bh-video-panel-reason-action').click();
	const providers = await waitForVideoProvidersPage(page);
	await assertSettingsFramesShowedOnly(page, 'Video Providers', 'basehalf-video-providers', 'Set Up of the Video panel');
	await waitForReading(() => readVideoProviderEditor(providers), seen => seen.provider === VIDEO_PROVIDER, `Set Up to open Video Providers at ${VIDEO_PROVIDER}`);
	await closeVideoProvidersPage(page, providers);
	await clickBlankVideoCanvas(page);
}

// Criterion 6: each credential is typed into the page and saved; the page
// then says that it is set and never shows it, and no workspace file holds
// it. With them, the provider is set up and Generate is enabled.
async function assertVideoProviderKeyStaysSecret(page) {
	const provider = await videoSmokeProvider();
	const providers = await openVideoProvidersPage(page);
	await providers.locator(`.basehalf-video-provider-row[data-provider="${VIDEO_PROVIDER}"]`).click();
	const editor = await waitForReading(() => readVideoProviderEditor(providers), seen => seen.provider === VIDEO_PROVIDER, `the page to show ${VIDEO_PROVIDER}`);
	for (const credential of editor.credentials) {
		const field = providers.locator(`.basehalf-video-provider-field.credential[data-credential="${credential.id}"]`);
		const input = field.locator('input[type="password"]');
		await input.click();
		await waitForReading(() => input.evaluate(element => element === element.ownerDocument.activeElement, undefined, { timeout: 2_000 }), focused => focused, `the field of ${credential.id} to have the keyboard focus`);
		await page.keyboard.type(provider.key);
		await page.keyboard.press('Enter');
		await waitForReading(() => readVideoProviderEditor(providers), seen => seen.credentials.find(candidate => candidate.id === credential.id)?.set === true, `${credential.id} to be saved`);
	}
	const saved = await waitForReading(() => readVideoProviderEditor(providers), seen => seen.rowSetUp === 'true', `${VIDEO_PROVIDER} to be set up`);
	if (saved.credentials.some(credential => credential.state !== 'Set. It is encrypted on this computer and never shown.' || credential.input !== null)) {
		throw new Error(`The page must say that every credential is set, without a field that holds it: ${JSON.stringify(saved)}`);
	}
	const inPage = await page.evaluate(key => ({
		markup: document.documentElement.outerHTML.includes(key),
		fields: Array.from(document.querySelectorAll('input, textarea')).some(field => field.value.includes(key))
	}), provider.key);
	if (inPage.markup || inPage.fields) {
		throw new Error(`The window holds the provider's credentials after they were saved: ${JSON.stringify(inPage)}`);
	}
	const files = filesContaining(workspacePath, provider.key);
	if (files.length) {
		throw new Error(`The provider's credentials are in workspace files: ${files.join(', ')}`);
	}
	await closeVideoProvidersPage(page, providers);
	await assertCanvasFolder(page, VIDEO_FOLDER);
	const panel = await selectVideoCard(page, VIDEO_NODE);
	const ready = await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false, 'Generate to be enabled once the provider is set up');
	if (ready.generate.label !== 'Generate' || ready.modelOutlined) {
		throw new Error(`With a model, the provider set up, and a prompt, Generate must be ready: ${JSON.stringify(ready)}`);
	}
}

// Criteria 3, 4, 13: an image connected with Pick on Canvas and one connected
// by a drawn line are the start and end frames, in upstream order; the swap
// arrow exchanges their two entries and nothing else, in one undo step; `@`
// lists the inputs by name and types the chosen one; a name of no input is
// underlined.
async function assertVideoPanelInputsAndNames(page) {
	let panel = await selectVideoCard(page, VIDEO_NODE);
	const empty = await readVideoPanel(panel);
	if (JSON.stringify(empty.emptySlots) !== JSON.stringify(['start', 'end'])) {
		throw new Error(`Frames mode of the first model of ${VIDEO_PROVIDER} must show an empty start and end slot: ${JSON.stringify(empty)}`);
	}
	await panel.locator('button.bh-video-panel-slot.empty[data-role="start"]').click();
	const addMenu = panel.locator('.bh-video-panel-menu.add');
	await addMenu.waitFor({ state: 'visible', timeout: 10_000 });
	await addMenu.locator('.bh-video-panel-menu-item[data-key="pick"]').click();
	// The panel says what the next click does.
	await panel.locator('.bh-video-panel-inputs.picking .bh-video-panel-inputs-hint[role="status"]').waitFor({ state: 'visible', timeout: 10_000 });
	await clickCanvasCardOnTop(page, VIDEO_START_IMAGE);
	await waitUntil(() => JSON.stringify(readVideoNode(VIDEO_NODE).upstream) === JSON.stringify([VIDEO_START_IMAGE]), 'Pick on Canvas to connect start.png', 10_000);
	await panel.locator('.bh-video-panel-inputs.picking').waitFor({ state: 'detached', timeout: 10_000 });
	// The click that picked selected nothing.
	await waitForCanvasCardSelection(page, VIDEO_NODE);

	await drawCanvasConnectionInto(page, VIDEO_END_IMAGE, VIDEO_NODE);
	await waitUntil(() => JSON.stringify(readVideoNode(VIDEO_NODE).upstream) === JSON.stringify([VIDEO_START_IMAGE, VIDEO_END_IMAGE]), 'the drawn connection to add end.png after start.png', 10_000);
	panel = await selectVideoCard(page, VIDEO_NODE);
	const frames = await waitForReading(() => readVideoPanel(panel), seen => seen.start?.path === VIDEO_START_IMAGE && seen.end?.path === VIDEO_END_IMAGE, 'the panel to show start.png and end.png as the frames');
	// The inputs change no value; a value the start frame sets (the ratio of the
	// first model) leaves the summary and shows as set by the frame.
	const before = videoSmoke.summary.split(' · ');
	const after = frames.settings?.split(' · ') ?? [];
	if (frames.start.name !== 'Image 1' || frames.end.name !== 'Image 2' || after.length !== before.length - 1 || !after.every(part => before.includes(part))) {
		throw new Error(`The frames must be named by upstream order, and the settings must leave out only the value the start frame sets from ${videoSmoke.summary}: ${JSON.stringify(frames)}`);
	}
	await panel.locator('button.bh-video-panel-settings').click();
	await waitForReading(() => readVideoSettingsPopover(panel), seen => seen !== null && seen.focusInside, 'the settings popover to open');
	const notes = await panel.evaluate(element => Array.from(element.querySelectorAll('.bh-video-panel-menu.settings .bh-video-panel-setting.fixed'))
		.map(section => `${section.querySelector('.bh-video-panel-setting-label')?.textContent}: ${section.querySelector('.bh-video-panel-setting-note')?.textContent}`));
	if (JSON.stringify(notes) !== JSON.stringify(['Ratio: Set by the start frame'])) {
		throw new Error(`With a start frame, the settings must show the ratio as set by it: ${JSON.stringify(notes)}`);
	}
	await closeVideoPanelMenu(page, panel, 'settings');
	videoSmoke.summary = frames.settings;

	const beforeSwap = readVideoNode(VIDEO_NODE);
	await panel.locator('button.bh-video-panel-swap').click();
	await waitUntil(() => canonicalJson(readVideoNode(VIDEO_NODE)) === canonicalJson({ ...beforeSwap, upstream: [VIDEO_END_IMAGE, VIDEO_START_IMAGE] }), 'the swap arrow to exchange the two entries and change nothing else', 10_000);
	await waitForReading(() => readVideoPanel(panel), seen => seen.start?.path === VIDEO_END_IMAGE && seen.start.name === 'Image 1' && seen.end?.path === VIDEO_START_IMAGE, 'the panel to show the swapped frames, named by their new order');
	await waitForReading(() => page.evaluate(() => !!document.activeElement?.closest('.basehalf-canvas-workbench')), inside => inside, 'the keyboard focus to stay on the canvas after the swap');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await waitUntil(() => canonicalJson(readVideoNode(VIDEO_NODE)) === canonicalJson(beforeSwap), 'one undo to put the two frames back', 10_000);
	await waitForReading(() => readVideoPanel(panel), seen => seen.start?.path === VIDEO_START_IMAGE && seen.end?.path === VIDEO_END_IMAGE, 'the panel to show the frames in their first order again');

	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
	await page.keyboard.type(' @');
	const mention = await waitForReading(() => readVideoMentionMenu(panel), seen => seen !== null && seen.options.length > 0, 'typing @ to list the inputs that have a name');
	if (JSON.stringify(mention.options.map(option => option.label)) !== JSON.stringify(['Image 1', 'Image 2'])
		|| !mention.options[0].file.startsWith('start') || !mention.options[1].file.startsWith('end')) {
		throw new Error(`@ must list Image 1 (start.png) and Image 2 (end.png): ${JSON.stringify(mention)}`);
	}
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	const named = await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === VIDEO_PROMPT_WITH_NAME, 'choosing Image 2 to type its name');
	if (await readVideoMentionMenu(panel) !== null || JSON.stringify(named.names) !== JSON.stringify([{ text: 'Image 2', known: true, underlined: false }])) {
		throw new Error(`The chosen name must be typed and marked as a known input: ${JSON.stringify(named)}`);
	}
	await page.keyboard.type(' Video 1');
	await waitForReading(() => readVideoPanel(panel), seen => JSON.stringify(seen.names) === JSON.stringify([{ text: 'Image 2', known: true, underlined: false }, { text: 'Video 1', known: false, underlined: true }]), 'Video 1, the name of no input, to be underlined');
	for (let index = 0; index < ' Video 1'.length; index++) {
		await page.keyboard.press('Backspace');
	}
	await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === VIDEO_PROMPT_WITH_NAME, 'the prompt to end with the name of Image 2 again');
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === VIDEO_PROMPT_WITH_NAME, 'the prompt with the name to be saved', 10_000);
}

// Criterion 10: opening the panel moves the canvas neither way; it sits 10
// px below its card, centered, as wide as the specification says, when there
// is room below; it hides while its card is off the canvas and comes back
// with it; and it goes when the card is deselected.
async function assertVideoPanelPlacement(page) {
	await clickBlankVideoCanvas(page);
	const card = videoCanvasCard(page, VIDEO_NODE);
	const home = await card.boundingBox();
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	const top = { x: canvasBox.x + 100, y: canvasBox.y + 40 };
	await panCanvasCardTo(page, card, top);
	const viewBefore = await readCanvasView(page);
	await clickCanvasCardOnTop(page, VIDEO_NODE);
	await waitForCanvasCardSelection(page, VIDEO_NODE);
	await waitForVideoPanel(page, VIDEO_NODE);
	assertSameCanvasView(viewBefore, await readCanvasView(page), 'Opening the Video panel');
	// The panel emerges from the card's edge in 140 ms; it is measured where it comes to rest.
	const placed = await waitForReading(() => readVideoPanelGeometry(page, VIDEO_NODE), seen => seen !== null && !seen.moving, 'the panel to come to rest');
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
	await waitForReading(() => readVideoPanelGeometry(page, VIDEO_NODE), seen => seen?.visible === 'false' && seen.visibility === 'hidden', 'the panel to hide while its card is off the canvas');
	await panCanvasCardTo(page, card, top);
	await waitForReading(() => readVideoPanelGeometry(page, VIDEO_NODE), seen => seen?.visible === 'true' && seen.visibility === 'visible' && seen.placement === 'below', 'the panel to show again below its card');
	await clickBlankVideoCanvas(page);
	await waitForReading(() => page.locator('.basehalf-canvas-video-panel-surface').count(), count => count === 0, 'the panel to go when its card is deselected');
	await panCanvasCardTo(page, card, { x: home.x, y: home.y });
}

// Criterion 14 (and 11, the request shows what the panel showed): Generate
// writes the task as `submitting`, then `running` with the provider's task
// id; the card shows the phase; the provider gets one request with both
// frames; the video lands in outputs/<node id>/<task id>.mp4 with a
// `generated` result, and the card plays it.
async function assertVideoGenerateWritesVideo(page) {
	const provider = await videoSmokeProvider();
	const panel = await selectVideoCard(page, VIDEO_NODE);
	const ready = await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false && seen.prompt === VIDEO_PROMPT_WITH_NAME, 'Generate to be enabled');
	const node = readVideoNode(VIDEO_NODE);
	const requestsBefore = provider.mock.requests.length;
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_NODE), document => document.result !== undefined || ['failed', 'stopped'].includes(document.task?.state), VIDEO_GENERATION_TIMEOUT_MS);
	await panel.locator('button.bh-video-panel-generate').click();
	const generating = await waitForGenerationStart(page, () => readVideoCard(page, VIDEO_NODE), seen => seen?.state === 'generating', 'the card to show the generation');
	if (!['Waiting', 'Generating', 'Downloading'].includes(generating.phase) || !/^\d+:\d\d$/.test(generating.elapsed ?? '') || !generating.progress) {
		throw new Error(`A generating card must show its phase, the time since the start, and a progress bar: ${JSON.stringify(generating)}`);
	}
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.stop === true && seen.generate.label === 'Stop Generating' && !seen.generate.disabled, 'Generate to become the stop square');
	if (await page.locator('.monaco-dialog-box').count() !== 0) {
		throw new Error('Generate asked a question before it ran');
	}
	const { states, document } = await recording;
	const observed = states.filter(state => state.state !== 'idle');
	const taskId = observed[0]?.taskId;
	const remoteId = observed[1]?.remoteId;
	if (observed.length !== 3 || observed[0].state !== 'submitting' || observed[0].remoteId !== undefined || observed[1].state !== 'running'
		|| observed[1].taskId !== taskId || !remoteId || observed[2].state !== 'result') {
		throw new Error(`The node's file must go submitting, running with the provider's task id, then show the result: ${JSON.stringify(states)}`);
	}
	const result = document.result;
	const recorded = result?.generation?.request;
	// The request record: the provider in its region, the catalog's model and the id sent there, and what the panel showed.
	// The start frame sets the first model's ratio: the record leaves it out, and the node keeps it.
	const { ratio: frameRatio, ...sentParams } = node.generation.params;
	const sent = { provider: VIDEO_PROVIDER, region: VIDEO_REGION, model: videoSmoke.model, providerModel: recorded?.providerModel, mode: 'frames', params: sentParams, prompt: VIDEO_PROMPT_WITH_NAME, inputs: [VIDEO_START_IMAGE, VIDEO_END_IMAGE] };
	if (frameRatio === undefined) {
		throw new Error(`The node must keep the ratio that the start frame sets: ${JSON.stringify(node.generation)}`);
	}
	if (document.task !== undefined || result?.source !== 'generated' || typeof recorded?.providerModel !== 'string' || !recorded.providerModel
		|| canonicalJson(result.artifact) !== canonicalJson({ kind: 'video', path: `outputs/${node.id}/${taskId}.mp4`, size: provider.video.length })
		|| result.generation?.taskId !== taskId || result.generation.remoteId !== remoteId || canonicalJson(recorded) !== canonicalJson(sent)) {
		throw new Error(`The node must show the generated video with the request the panel showed: ${JSON.stringify(document)}`);
	}
	// How the values reach the provider is its module's own; the record says what was sent.
	const requests = provider.requestsSince(requestsBefore);
	const parts = JSON.stringify(requests[0]?.parts ?? []);
	if (requests.length !== 1 || requests[0].taskId !== remoteId || requests[0].model !== recorded.providerModel || requests[0].prompt !== VIDEO_PROMPT_WITH_NAME
		|| !parts.includes('first_frame') || !parts.includes('last_frame')) {
		throw new Error(`The test provider must get one request with the model's id in the region, the prompt, and the two frames: ${JSON.stringify(requests)}`);
	}
	// What the settings button said is what was sent.
	if (ready.settings !== videoSmoke.summary) {
		throw new Error(`The settings button must sum up what is sent, ${videoSmoke.summary}: ${JSON.stringify(ready)}`);
	}
	const video = path.join(workspacePath, 'outputs', node.id, `${taskId}.mp4`);
	if (!fs.readFileSync(video).equals(provider.video)) {
		throw new Error(`${video} must hold the test provider's video`);
	}
	const shown = await waitForReading(() => readVideoCard(page, VIDEO_NODE), seen => seen?.state === 'video' && seen.video !== null && seen.video.readyState >= 1, 'the card to show the video');
	// The card that showed the generation shows the video alone.
	if (shown.faceShown) {
		throw new Error(`The card must show the video without the face of the generation over it: ${JSON.stringify(shown)}`);
	}
	const played = await playVideoCard(page, VIDEO_NODE);
	if (played.error || !(played.currentTime >= 0.3) || played.width !== 320 || played.height !== 180 || !(played.duration > 1.5 && played.duration < 2.5) || !played.controls) {
		throw new Error(`The card must play the video, with its controls while selected: ${JSON.stringify(played)}`);
	}
}

// Criterion 20: Capture Frame writes the current, the first, and the last
// frame as PNGs beside the node, named after it, and their cards appear to
// the right of the video card.
async function assertVideoCaptureFrames(page) {
	await selectVideoCard(page, VIDEO_NODE);
	const toolbar = page.locator('.basehalf-video-context-toolbar');
	await toolbar.locator('[data-video-action="captureFrame"]').waitFor({ state: 'visible', timeout: 15_000 });
	const actions = await toolbar.locator('[data-video-action]').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-video-action')));
	if (JSON.stringify(actions) !== JSON.stringify(['captureFrame', 'revealVideo', 'openFullPreview'])) {
		throw new Error(`The toolbar of a card with a video must offer Capture Frame, Reveal, and Open: ${JSON.stringify(actions)}`);
	}
	// The current frame is the one the card's player shows.
	await seekVideoCard(page, VIDEO_NODE, 1);
	const frames = [['current', 'Video frame at 1s.png'], ['first', 'Video first frame.png'], ['last', 'Video last frame.png']];
	for (const [frame, name] of frames) {
		await captureVideoCardFrame(page, frame, `${VIDEO_FOLDER}/${name}`);
	}
	const layout = readVideoCanvasLayout();
	const video = readCanvasCardGeometry(layout, VIDEO_NODE);
	for (const [, name] of frames) {
		const size = pngSize(fs.readFileSync(path.join(workspacePath, VIDEO_FOLDER, name)));
		const row = readCanvasCardGeometry(layout, `${VIDEO_FOLDER}/${name}`);
		if (size?.width !== 320 || size.height !== 180) {
			throw new Error(`${name} must be a 320 by 180 PNG of the video: ${JSON.stringify(size)}`);
		}
		if (!video || !row || row.x < video.x + video.width) {
			throw new Error(`The card of ${name} must appear to the right of the video card: ${JSON.stringify({ video, row })}`);
		}
	}
}

// "The card": the card of a node changes in place when its node changes. A
// video that plays in it goes on playing while the panel saves the prompt,
// with no frame of the loading face, and pauses where it is when the card is
// deselected; selecting the card again keeps the same player.
async function assertVideoCardKeepsItsPlayer(page) {
	const before = readVideoNode(VIDEO_NODE);
	let panel = await selectVideoCard(page, VIDEO_NODE);
	const started = await page.evaluate(async path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.bh-video-card[data-state="video"] video.bh-video-card-video');
		if (!card || !(video instanceof HTMLVideoElement)) {
			return { error: 'The card has no video element' };
		}
		video.dataset.smokePlayer = 'kept';
		video.muted = true;
		video.loop = true;
		const frames = [];
		globalThis.__bhVideoCardFrames = frames;
		globalThis.__bhVideoCardSampling = true;
		const sample = () => {
			const current = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
			const player = current?.querySelector('video.bh-video-card-video');
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
		try {
			await video.play();
		} catch (error) {
			return { error: `The video did not play: ${String(error)}` };
		}
		requestAnimationFrame(sample);
		return { time: video.currentTime };
	}, VIDEO_NODE);
	if (started.error) {
		throw new Error(started.error);
	}
	const edited = `${before.prompt} Slowly.`;
	await replaceVideoPrompt(page, panel, edited);
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === edited, 'the panel to save the edited prompt', 10_000);
	// The canvas reads the changed node again and shows it in the same card.
	await page.waitForTimeout(1_500);
	const playing = await page.evaluate(() => {
		globalThis.__bhVideoCardSampling = false;
		const frames = globalThis.__bhVideoCardFrames ?? [];
		return {
			frames: frames.length,
			replaced: frames.filter(frame => !frame.sameCard || !frame.samePlayer).length,
			loading: frames.filter(frame => frame.loading).length,
			paused: frames.filter(frame => frame.paused).length,
			time: document.querySelector('video[data-smoke-player="kept"]')?.currentTime ?? null
		};
	});
	if (playing.frames < 30 || playing.replaced !== 0 || playing.loading !== 0 || playing.paused !== 0 || !(playing.time > started.time)) {
		throw new Error(`A playing video must go on playing in the same card while its node changes: ${JSON.stringify({ started, playing })}`);
	}
	const readPlayer = () => page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('video.bh-video-card-video');
		return video instanceof HTMLVideoElement ? { kept: video.dataset.smokePlayer === 'kept', paused: video.paused, controls: video.controls } : null;
	}, VIDEO_NODE);
	await clickBlankVideoCanvas(page);
	await waitForReading(readPlayer, seen => seen?.kept === true && seen.paused && !seen.controls, 'the deselected card to keep its player, paused and without controls');
	panel = await selectVideoCard(page, VIDEO_NODE);
	await waitForReading(readPlayer, seen => seen?.kept === true && seen.controls, 'the selected card to show the same player with its controls');
	await replaceVideoPrompt(page, panel, before.prompt);
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === before.prompt, 'the panel to save the prompt again', 10_000);
}

// Criterion 17: Generate on a node that holds a video makes a node beside it
// with the same prompt, settings, and inputs, to its right, selects it, and
// runs there; the original node does not change.
async function assertVideoGenerateAgainMakesSibling(page) {
	const provider = await videoSmokeProvider();
	const original = fs.readFileSync(videoWorkspaceFile(VIDEO_NODE), 'utf8');
	const originalNode = JSON.parse(original);
	const panel = await selectVideoCard(page, VIDEO_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false && !seen.generate.stop, 'Generate to be enabled on the node that holds a video');
	const requestsBefore = provider.mock.requests.length;
	// Cmd/Ctrl+Enter in the prompt generates.
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(VIDEO_SIBLING_NODE)), `Generate to make ${VIDEO_SIBLING_NODE}`, 20_000);
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_SIBLING_NODE), document => document.result !== undefined || ['failed', 'stopped'].includes(document.task?.state), VIDEO_GENERATION_TIMEOUT_MS);
	await waitForCanvasCardSelection(page, VIDEO_SIBLING_NODE, 20_000);
	await page.locator(`.basehalf-canvas-video-panel-surface[data-basehalf-card-path="${VIDEO_SIBLING_NODE}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	const { states, document } = await recording;
	const observed = states.filter(state => state.state !== 'idle').map(state => state.state);
	if (JSON.stringify(observed) !== JSON.stringify(['submitting', 'running', 'result'])) {
		throw new Error(`The new node must run the generation: ${JSON.stringify(states)}`);
	}
	if (document.title !== 'Video 2' || document.prompt !== originalNode.prompt || canonicalJson(document.generation) !== canonicalJson(originalNode.generation)
		|| JSON.stringify(document.upstream) !== JSON.stringify(originalNode.upstream) || document.result?.source !== 'generated'
		|| !fs.existsSync(path.join(workspacePath, ...document.result.artifact.path.split('/')))) {
		throw new Error(`The new node must have the original's prompt, settings, and inputs, and its own video: ${JSON.stringify(document)}`);
	}
	if (fs.readFileSync(videoWorkspaceFile(VIDEO_NODE), 'utf8') !== original) {
		throw new Error(`Generating again changed ${VIDEO_NODE}`);
	}
	const layout = readVideoCanvasLayout();
	const originalRow = readCanvasCardGeometry(layout, VIDEO_NODE);
	const siblingRow = readCanvasCardGeometry(layout, VIDEO_SIBLING_NODE);
	if (!originalRow || !siblingRow || siblingRow.x < originalRow.x + originalRow.width) {
		throw new Error(`The new node's card must appear to the right of the original: ${JSON.stringify({ originalRow, siblingRow })}`);
	}
	if (provider.requestsSince(requestsBefore).length !== 1) {
		throw new Error(`Generating again must send one request: ${JSON.stringify(provider.requestsSince(requestsBefore))}`);
	}
}

// Criteria 15 and 16: a task the provider fails ends as failed with the
// provider's message on the card; a request whose answer never comes ends
// with the message about the provider's console and is not sent again; the
// stop square ends a running task as stopped and keeps no video. A new node
// starts with the provider, model, mode, and values of the last generation.
async function assertVideoGenerationFailsAndStops(page) {
	const provider = await videoSmokeProvider();
	await clickBlankVideoCanvas(page);
	// At a quarter size the middle of the view has room for another node.
	await setCanvasZoomPercent(page, 25);
	await clickCanvasCreateSubmenuAction(page, 'New Media or Document', 'Video');
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(VIDEO_SECOND_NODE)), `the create menu to make ${VIDEO_SECOND_NODE}`, 20_000);
	const created = readVideoNode(VIDEO_SECOND_NODE);
	const lastUsed = readVideoNode(VIDEO_SIBLING_NODE).generation;
	if (created.version !== 6 || canonicalJson(created.generation) !== canonicalJson(lastUsed) || lastUsed?.model !== videoSmoke.model) {
		throw new Error(`A new Video node must start with the provider, model, mode, and values of the last generation: ${JSON.stringify({ created, lastUsed })}`);
	}
	await waitForCanvasCardSelection(page, VIDEO_SECOND_NODE, 15_000);
	const panel = await waitForVideoPanel(page, VIDEO_SECOND_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.promptFocused, 'the prompt of the second Video node to have the keyboard focus');

	await page.keyboard.type('[mock:fail] A storm over the pier');
	let ended = await generateVideoUntilEnded(page, panel, VIDEO_SECOND_NODE);
	const failure = ended.document.task?.error ?? '';
	if (JSON.stringify(ended.states.map(state => state.state)) !== JSON.stringify(['submitting', 'running', 'failed']) || !/^The provider could not make the video: \S/.test(failure) || ended.requests.length !== 1) {
		throw new Error(`A task the provider fails must end as failed with its message: ${JSON.stringify(ended)}`);
	}
	await waitForReading(() => readVideoCard(page, VIDEO_SECOND_NODE), seen => seen?.state === 'failed' && seen.message === failure, 'the card to show the provider\'s message');

	await replaceVideoPrompt(page, panel, '[mock:drop] A storm over the pier');
	ended = await generateVideoUntilEnded(page, panel, VIDEO_SECOND_NODE);
	const unknown = 'The request may have reached the provider, but no answer came back. Check the provider\'s console before generating again: a second request may be charged again.';
	if (JSON.stringify(ended.states.map(state => state.state)) !== JSON.stringify(['submitting', 'failed']) || !ended.document.task.error.startsWith(unknown)
		|| ended.requests.length !== 1 || ended.requests[0].prompt !== '[mock:drop] A storm over the pier') {
		throw new Error(`A request without an answer must end with the message about the provider's console: ${JSON.stringify(ended)}`);
	}
	await waitForReading(() => readVideoCard(page, VIDEO_SECOND_NODE), seen => seen?.state === 'failed' && seen.message === ended.document.task.error, 'the card to show that the outcome is unknown');
	// Nothing sends the request again.
	await page.waitForTimeout(VIDEO_PROVIDER_CREATE_HOLD_MS + 2_000);
	if (provider.requestsSince(ended.requestsBefore).length !== 1) {
		throw new Error(`A request whose outcome is unknown was sent again: ${JSON.stringify(provider.requestsSince(ended.requestsBefore))}`);
	}

	await replaceVideoPrompt(page, panel, '[mock:slow] A storm over the pier');
	const previousTask = readVideoNode(VIDEO_SECOND_NODE).task?.id;
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_SECOND_NODE), document => document.result !== undefined || (document.task?.id !== previousTask && ['failed', 'stopped'].includes(document.task?.state)), VIDEO_GENERATION_TIMEOUT_MS);
	await panel.locator('button.bh-video-panel-generate').click();
	await waitUntil(() => readVideoNode(VIDEO_SECOND_NODE).task?.state === 'running', 'the slow task to run', 20_000);
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.stop === true, 'Generate to become the stop square');
	await panel.locator('button.bh-video-panel-generate').click();
	const stopped = await recording;
	const stoppedPath = stopped.states.filter(state => state.state !== 'idle' && state.taskId !== previousTask).map(state => state.state);
	if (JSON.stringify(stoppedPath) !== JSON.stringify(['submitting', 'running', 'stopped']) || !stopped.document.task.endedAt || stopped.document.result !== undefined) {
		throw new Error(`The stop square must end the task as stopped: ${JSON.stringify(stopped)}`);
	}
	await waitForReading(() => readVideoCard(page, VIDEO_SECOND_NODE), seen => seen?.state === 'stopped' && seen.message === 'Stopped', 'the card to say Stopped');
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.stop === false && seen.generate.disabled === false, 'Generate to start a new generation in the same node');
	if (fs.existsSync(path.join(workspacePath, 'outputs', created.id))) {
		throw new Error(`A node whose generations ended without a video has files in outputs/${created.id}`);
	}
}

// Criteria 19 and 2: a Video node an agent wrote with a title, a prompt,
// upstream, and generation shows on the canvas; `basehalf --run-node` in an
// Agent Area terminal starts it without a question and prints its path once
// its task is recorded; the video lands as one Generate makes.
async function assertVideoAgentRunsNode(page) {
	const provider = await videoSmokeProvider();
	const prompt = 'The pier at noon, seen from the water';
	// An agent names the provider, the model, and the mode, and leaves the values to their defaults.
	fs.writeFileSync(videoWorkspaceFile(VIDEO_AGENT_NODE), `${JSON.stringify({
		version: 6,
		id: randomUUID(),
		kind: 'video',
		title: 'Agent shot',
		prompt,
		upstream: [VIDEO_START_IMAGE],
		generation: { provider: VIDEO_PROVIDER, model: videoSmoke.model, mode: 'frames' }
	}, null, '\t')}\n`, 'utf8');
	await videoCanvasCard(page, VIDEO_AGENT_NODE).waitFor({ state: 'attached', timeout: 20_000 });
	await runCommand(page, 'Terminal: Create New Terminal');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.waitFor({ state: 'visible', timeout: 20_000 });
	await terminal.click();
	await waitForAgentAreaTerminalPrompt(page);
	const requestsBefore = provider.mock.requests.length;
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_AGENT_NODE), document => document.result !== undefined || ['failed', 'stopped'].includes(document.task?.state), VIDEO_GENERATION_TIMEOUT_MS);
	await page.keyboard.insertText(`basehalf --run-node ${VIDEO_AGENT_NODE}`);
	await page.keyboard.press('Enter');
	const answer = await readAgentAreaTerminalJson(page, `"nodePath":${JSON.stringify(VIDEO_AGENT_NODE)}`);
	const atAnswer = readVideoNode(VIDEO_AGENT_NODE);
	if (answer.ok !== true || answer.outcome !== 'succeeded' || answer.nodePath !== VIDEO_AGENT_NODE || (atAnswer.task === undefined && atAnswer.result === undefined)) {
		throw new Error(`basehalf --run-node must print the node's path once its task is recorded: ${JSON.stringify({ answer, atAnswer })}`);
	}
	if (await page.locator('.monaco-dialog-box').count() !== 0) {
		throw new Error('basehalf --run-node asked a question');
	}
	const { states, document } = await recording;
	const recorded = document.result?.generation?.request;
	if (JSON.stringify(states.filter(state => state.state !== 'idle').map(state => state.state)) !== JSON.stringify(['submitting', 'running', 'result'])
		|| document.result?.source !== 'generated' || recorded?.provider !== VIDEO_PROVIDER || recorded.region !== VIDEO_REGION || recorded.model !== videoSmoke.model
		|| recorded.mode !== 'frames' || recorded.prompt !== prompt || JSON.stringify(recorded.inputs) !== JSON.stringify([VIDEO_START_IMAGE])
		// The values left out were sent with their defaults.
		|| !recorded.params || Object.keys(recorded.params).length === 0) {
		throw new Error(`The node an agent ran must end with a generated video: ${JSON.stringify({ states, document })}`);
	}
	const requests = provider.requestsSince(requestsBefore);
	const parts = JSON.stringify(requests[0]?.parts ?? []);
	if (requests.length !== 1 || !parts.includes('first_frame') || parts.includes('last_frame') || requests[0].prompt !== prompt) {
		throw new Error(`The agent's run must send one request with the prompt and the start frame: ${JSON.stringify(requests)}`);
	}
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	// After all these generations, no workspace file holds the credentials.
	const files = filesContaining(workspacePath, provider.key);
	if (files.length) {
		throw new Error(`The provider's credentials are in workspace files: ${files.join(', ')}`);
	}
}
