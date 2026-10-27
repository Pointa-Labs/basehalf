/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Audio cards (D78), step by step against the local test provider, which
// answers like ElevenLabs and like Mureka, each set up with the test key and
// its endpoint at that provider; no paid provider is called. The steps work in
// a folder of their own, on its canvas, and run in order, each where the one
// before ended.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { videoSmokeProvider } from './generationCards.mts';
import {
	canonicalJson,
	canvasCard,
	cardInformationFiles,
	cardVideoControlBox,
	cardVideoPicturePoint,
	chooseModel,
	clickBlankCanvas,
	clickCanvasCardOnTop,
	clickGenerate,
	clickModel,
	closePanelMenu,
	mirrorFolder,
	openModelMenu,
	openSettings,
	openVoiceMenu,
	panBelowTheCards,
	readCardRow,
	readCardToolbar,
	readCardVideoPlayer,
	readGenerationCard,
	readGenerationInfo,
	readGenerationPanel,
	readMade,
	readMentionMenu,
	readRecordPanel,
	readSettingsPopover,
	readUpstreamSidecar,
	readVoiceMenu,
	savePrompt,
	selectGenerationCard,
	showCardOnCanvas,
	statesOf,
	voiceInMenu,
	waitForGenerationPanel,
	watchGenerations,
	workspaceFile,
	writeGenerationInfo
} from './generationProbes.mts';
import { filesContaining } from './videoProvider.mts';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, clickCanvasCreateAction, emptyCanvasPoint, panCanvasCardTo, setCanvasZoomPercent, waitForCanvasCardSelection } from '../../lib/canvas.mts';
import { closeProvidersPage, openProvidersPage, readProviderEditor, waitForProvidersPage } from '../../lib/providers.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { step, waitForReading, waitUntil } from '../../lib/steps.mts';

// The folder of the steps, with a note whose text a voice says and a video
// that plays on the canvas while a voice's sample does.
const AUDIO_FOLDER = 'audio-smoke';
const INTRO_NOTE = `${AUDIO_FOLDER}/intro.md`;
const INTRO_TEXT = 'Welcome to the coast.';
const REEL = `${AUDIO_FOLDER}/reel.mp4`;
// New Audio names its draft `audio.mp3`, after the format of its model, and
// `audio.wav` while a model that delivers WAV is chosen; the next New Audio
// is `audio-2.mp3`, and the second of its songs `audio-3.mp3`.
const SPEECH = `${AUDIO_FOLDER}/audio.mp3`;
const SPEECH_WAV = `${AUDIO_FOLDER}/audio.wav`;
const SONG = `${AUDIO_FOLDER}/audio-2.mp3`;
const SECOND_SONG = `${AUDIO_FOLDER}/audio-3.mp3`;
const LYRICS = 'Neon lights along the bay, we dance until the morning comes';
const STYLE = 'city pop';

// The models of the steps, by the ids of their modules, with the line each
// shows under its name in the model menu.
const ELEVEN_V4 = { provider: 'elevenlabs', model: 'eleven-v4', label: 'Eleven v4', providerModel: 'eleven_v4', line: 'Speech · Up to 10,000 characters' };
const SOUND_EFFECTS = { provider: 'elevenlabs', model: 'eleven-text-to-sound-v2', line: 'Sound Effects · Up to 30s' };
const MUREKA_9_5 = { provider: 'mureka', model: 'mureka-9.5', label: 'Mureka 9.5', line: 'Music · From a Description · From Lyrics · Up to 3 songs · 1 reference sound' };
const WAV_SPEECH = { provider: 'google', model: 'gemini-3.8-flash-tts' };
// The providers of the catalog that make audio.
const AUDIO_PROVIDERS = ['elevenlabs', 'fishaudio', 'google', 'minimax', 'mureka'];

// What the empty prompt says it is (criterion 82).
const PLACEHOLDER = {
	speech: 'Write what the voice says. Type @ to mention an input.',
	music: 'Describe the music. Type @ to mention an input.',
	lyrics: 'Write the lyrics. Type @ to mention an input.',
	sound: 'Describe the sound. Type @ to mention an input.'
};

// The voices of ElevenLabs' module: the six of its catalog, Eldrin the
// default; and those the local test provider lists, the account's two, the
// default voice, and George, one of ElevenLabs' Default voices.
const CATALOG_VOICES = ['Eldrin', 'Elara', 'Talia', 'Darian', 'Alicia', 'Finley'];
const DEFAULT_VOICE = { id: '6WwXjDDEMyNmFG95zycZ', label: 'Eldrin' };
const ACCOUNT_VOICE = { id: 'bhSeaCaptain00000002', label: 'Sea Captain' };
const ELEVENLABS_MODELS = ['eleven-v4', 'eleven-v3', 'eleven-multilingual-v2', 'eleven-flash-v2.5', 'eleven-text-to-sound-v2'];

// --- Audio cards (D78, docs/specs/generation-cards.md) ---------------------------------------------
//
// Acceptance criteria 80 to 89 of generation cards, and criterion 8 of
// providers for the Providers page's Audio, through the window and against the
// local test provider, reached through the ElevenLabs and Mureka modules.
// New Audio from Create from Connection is in the canvas suite.

export async function runAudioCardSteps(page) {
	await step('audio-new-audio-makes-draft', () => assertNewAudioMakesDraft(page));
	await step('audio-model-menu-and-placeholders', () => assertAudioModelMenu(page));
	await step('audio-voice-menu-before-set-up', () => assertVoiceMenuBeforeSetUp(page));
	await step('audio-voice-menu-voices-and-samples', () => assertVoiceMenu(page));
	await step('audio-voice-menu-without-a-list', () => assertVoiceMenuWithoutAList(page));
	await step('audio-note-spoken', () => assertNoteIsSpoken(page));
	await step('audio-songs-from-lyrics', () => assertSongsFromLyrics(page));
}

// --- helpers of the steps --------------------------------------------------------------------------

/**
 * The folder of the steps: the note and the video at the top left of its
 * canvas, one above the other, written before BaseHalf opens the folder.
 */
function createAudioSmokeFolder(video) {
	fs.mkdirSync(workspaceFile(AUDIO_FOLDER), { recursive: true });
	fs.writeFileSync(workspaceFile(INTRO_NOTE), `${INTRO_TEXT}\n`, 'utf8');
	fs.writeFileSync(workspaceFile(REEL), video);
	const mirror = mirrorFolder(AUDIO_FOLDER);
	fs.mkdirSync(mirror, { recursive: true });
	fs.writeFileSync(path.join(mirror, 'canvas.yaml'), [
		`path: "${AUDIO_FOLDER}"`,
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		...[[INTRO_NOTE, 0], [REEL, 300]].flatMap(([cardPath, y]) => [
			`  - path: "${cardPath}"`,
			'    kind: file',
			'    x: 0',
			`    y: ${y}`,
			'    width: 300',
			'    height: 220'
		]),
		'edges: []',
		''
	].join('\n'), 'utf8');
}

/** Makes a draft with New Audio, and returns its path once it is selected with its panel and its prompt has the keyboard. */
async function newAudioDraft(page) {
	const drafts = () => {
		try {
			return fs.readdirSync(mirrorFolder(AUDIO_FOLDER)).filter(name => /^audio(-\d+)?\.(mp3|wav)$/.test(name) && fs.existsSync(path.join(mirrorFolder(AUDIO_FOLDER), name, 'generation.yaml'))
				&& !fs.existsSync(workspaceFile(`${AUDIO_FOLDER}/${name}`)));
		} catch {
			return [];
		}
	};
	const before = new Set(drafts());
	await clickCanvasCreateAction(page, 'New Audio');
	let created;
	await waitUntil(() => (created = drafts().find(name => !before.has(name))) !== undefined, 'New Audio to make a draft', 20_000);
	const cardPath = `${AUDIO_FOLDER}/${created}`;
	await waitForCanvasCardSelection(page, cardPath, 15_000);
	const panel = await waitForGenerationPanel(page, cardPath);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.promptFocused && seen.catalog === 'ready', `the prompt of ${cardPath} to have the keyboard focus`);
	return { cardPath, panel };
}

/**
 * Sets a provider up on the open Providers page as a user does: its endpoint
 * at the local test provider, then each credential, the test key. Returns
 * what the page shows of it then.
 */
async function setUpProvider(page, providers, providerId, endpoint, key) {
	if ((await readProviderEditor(providers)).provider !== providerId) {
		await providers.locator(`.basehalf-video-provider-row[data-provider="${providerId}"]`).click();
	}
	const editor = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === providerId, `the page to show ${providerId}`);
	await providers.locator('.basehalf-video-provider-field.endpoint input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(endpoint);
	await page.keyboard.press('Enter');
	await waitForReading(() => readProviderEditor(providers), seen => seen.endpoint === endpoint && seen.customEndpoint, `the endpoint of ${providerId} at the local test provider to be saved`);
	for (const credential of editor.credentials) {
		const input = providers.locator(`.basehalf-video-provider-field.credential[data-credential="${credential.id}"] input[type="password"]`);
		await input.click();
		await waitForReading(() => input.evaluate(element => element === element.ownerDocument.activeElement, undefined, { timeout: 2_000 }), focused => focused, `the field of ${credential.id} to have the keyboard focus`);
		await page.keyboard.type(key);
		await page.keyboard.press('Enter');
		await waitForReading(() => readProviderEditor(providers), seen => seen.credentials.find(candidate => candidate.id === credential.id)?.set === true, `${credential.id} of ${providerId} to be saved`);
	}
	return waitForReading(() => readProviderEditor(providers), seen => seen.provider === providerId && seen.rowSetUp === 'true', `${providerId} to be set up`);
}

/** The sections of a reading of the voice menu, each as its title and the names of its voices. */
function voiceSections(menu) {
	return (menu?.sections ?? []).map(section => `${section.title}: ${section.voices.map(voice => voice.label).join(', ')}`);
}

/** Clicks the play button of the voice named `label` in the open voice menu. */
async function clickSample(panel, label) {
	const voice = voiceInMenu(await readVoiceMenu(panel), label);
	if (!voice) {
		throw new Error(`The voice menu must list ${label}`);
	}
	await panel.locator(`.bh-voice-menu-option[data-key="voice:${voice.id}"] button.bh-voice-menu-play`).click();
}

// --- New Audio and the model menu ------------------------------------------------------------------

// Criteria 80 and 82: New Audio from the canvas's menu makes a draft named
// `audio.mp3`, with an empty prompt and no model since no sound was generated
// on this computer, at the size of a file card, 300 by 220, showing the glyph
// of a sound and its name, selected with its panel and its prompt focused,
// and no toolbar; without a model its prompt says "Describe the sound.".
async function assertNewAudioMakesDraft(page) {
	const provider = await videoSmokeProvider();
	createAudioSmokeFolder(provider.video);
	await quickOpen(page, AUDIO_FOLDER);
	await assertCanvasFolder(page, AUDIO_FOLDER);
	for (const cardPath of [INTRO_NOTE, REEL]) {
		await canvasCard(page, cardPath).waitFor({ state: 'visible', timeout: 20_000 });
	}
	// At half size, the note and the video at the top left: a new draft comes in the middle, clear of the video.
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	await setCanvasZoomPercent(page, 50);
	await panCanvasCardTo(page, canvasCard(page, INTRO_NOTE), { x: canvasBox.x + 40, y: canvasBox.y + 40 });

	const { cardPath, panel } = await newAudioDraft(page);
	if (cardPath !== SPEECH || canonicalJson(readGenerationInfo(SPEECH)) !== canonicalJson({ prompt: '' }) || fs.existsSync(workspaceFile(SPEECH))
		|| JSON.stringify(cardInformationFiles(SPEECH)) !== JSON.stringify(['generation.yaml'])) {
		throw new Error(`New Audio must make the draft ${SPEECH}, with an empty prompt and no model, and no file: ${JSON.stringify({ cardPath, info: readGenerationInfo(SPEECH), files: cardInformationFiles(SPEECH) })}`);
	}
	const card = await waitForReading(() => readGenerationCard(page, SPEECH), seen => seen?.face?.state === 'draft', `the card of ${SPEECH} to show a draft`);
	if (card.generation !== 'draft' || card.kind !== 'audio' || card.face.kind !== 'audio' || !card.face.glyph || card.name !== 'audio.mp3' || card.video || card.image) {
		throw new Error(`The card of a new audio draft must show the glyph of a sound and its name: ${JSON.stringify(card)}`);
	}
	const row = await waitForReading(() => readCardRow(SPEECH, AUDIO_FOLDER), seen => seen !== undefined, `the draft ${SPEECH} to get a place`);
	if (row.width !== 300 || row.height !== 220) {
		throw new Error(`An audio draft has the size of a file card, 300 by 220: ${JSON.stringify(row)}`);
	}
	const shown = await readGenerationPanel(panel);
	if (shown.kind !== 'audio' || shown.model !== 'Choose Model' || shown.generate?.label !== 'Choose a model to generate.' || shown.placeholder !== PLACEHOLDER.sound || shown.voice !== null) {
		throw new Error(`The panel of an audio draft without a model must ask for a model and describe the sound: ${JSON.stringify(shown)}`);
	}
	// What a draft takes is added from its panel: no toolbar above it.
	await page.waitForTimeout(400);
	const toolbar = await readCardToolbar(page);
	if (toolbar !== null) {
		throw new Error(`A selected audio draft must show no toolbar: ${JSON.stringify(toolbar)}`);
	}
}

// Criteria 80, 81, and 82: the model menu of an audio card lists only audio
// models, of the providers that make them, each with what it makes first on
// its second line; the placeholder follows the model and the mode: what the
// voice says, the music, the lyrics in From Lyrics, and the sound. Choosing a
// model that delivers WAV renames `audio.mp3` to `audio.wav` where it is, and
// one that delivers MP3 renames it back.
async function assertAudioModelMenu(page) {
	let panel = await selectGenerationCard(page, SPEECH);
	const menu = await openModelMenu(panel);
	const items = menu.groups.flatMap(group => group.items.map(item => ({ ...item, provider: group.provider })));
	const lineOf = model => items.find(item => item.provider === model.provider && item.model === model.model)?.detail;
	if (JSON.stringify(menu.groups.map(group => group.provider).sort()) !== JSON.stringify(AUDIO_PROVIDERS) || menu.groups.some(group => group.detail !== 'Not set up')
		|| items.some(item => !/^(Speech|Music|Sound Effects)( · |$)/.test(item.detail ?? '')) || JSON.stringify(menu.end) !== JSON.stringify(['Providers…'])) {
		throw new Error(`The model menu of an audio card must list only the audio models, of the providers that make them, each saying what it makes first: ${JSON.stringify(menu)}`);
	}
	if (lineOf(ELEVEN_V4) !== ELEVEN_V4.line || lineOf(MUREKA_9_5) !== MUREKA_9_5.line || lineOf(SOUND_EFFECTS) !== SOUND_EFFECTS.line) {
		throw new Error(`An audio model shows what it makes and its limits on its second line: ${JSON.stringify(items)}`);
	}
	await clickModel(page, panel, ELEVEN_V4.provider, ELEVEN_V4.model);
	await waitUntil(() => readGenerationInfo(SPEECH)?.model === ELEVEN_V4.model, `${SPEECH} to store ${ELEVEN_V4.model}`, 10_000);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.model === ELEVEN_V4.label && seen.placeholder === PLACEHOLDER.speech, 'a speech model to ask for what the voice says');

	// A music model describes the music, and asks for the lyrics in From Lyrics.
	const music = await chooseModel(page, panel, SPEECH, MUREKA_9_5.provider, MUREKA_9_5.model);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.placeholder === PLACEHOLDER.music, 'a music model to ask for a description of the music');
	await openSettings(panel);
	await panel.locator('.bh-video-panel-menu.settings [data-key="mode:lyrics"]').click();
	await waitUntil(() => readGenerationInfo(SPEECH)?.mode === 'lyrics', `${SPEECH} to store From Lyrics`, 10_000);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.placeholder === PLACEHOLDER.lyrics, 'From Lyrics to ask for the lyrics');
	await closePanelMenu(page, panel, 'settings');

	// A sound-effect model describes the sound.
	await chooseModel(page, panel, SPEECH, SOUND_EFFECTS.provider, SOUND_EFFECTS.model);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.placeholder === PLACEHOLDER.sound, 'a sound-effect model to ask for a description of the sound');

	// A speech model that delivers WAV, and one that delivers MP3 again: the draft follows its model's format where it is.
	const row = readCardRow(SPEECH, AUDIO_FOLDER);
	await openModelMenu(panel);
	await clickModel(page, panel, WAV_SPEECH.provider, WAV_SPEECH.model);
	await waitUntil(() => readGenerationInfo(SPEECH_WAV)?.model === WAV_SPEECH.model && !fs.existsSync(mirrorFolder(SPEECH)), `choosing ${WAV_SPEECH.model}, which delivers WAV, to rename ${SPEECH} to ${SPEECH_WAV}`, 10_000);
	await canvasCard(page, SPEECH_WAV).waitFor({ state: 'attached', timeout: 10_000 });
	await waitUntil(() => {
		const moved = readCardRow(SPEECH_WAV, AUDIO_FOLDER);
		return moved?.x === row.x && moved.y === row.y && readCardRow(SPEECH, AUDIO_FOLDER) === undefined;
	}, `the card of ${SPEECH_WAV} to keep the place of ${SPEECH}`, 10_000);
	panel = await waitForGenerationPanel(page, SPEECH_WAV);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.placeholder === PLACEHOLDER.speech, `the panel of ${SPEECH_WAV} to ask for what the voice says`);
	await openModelMenu(panel);
	await clickModel(page, panel, ELEVEN_V4.provider, ELEVEN_V4.model);
	await waitUntil(() => readGenerationInfo(SPEECH)?.model === ELEVEN_V4.model && !fs.existsSync(mirrorFolder(SPEECH_WAV)), `choosing ${ELEVEN_V4.model}, which delivers MP3, to rename ${SPEECH_WAV} back to ${SPEECH}`, 10_000);
	await canvasCard(page, SPEECH).waitFor({ state: 'attached', timeout: 10_000 });
	panel = await waitForGenerationPanel(page, SPEECH);
	const back = readGenerationInfo(SPEECH);
	// The voice of Gemini's model is not ElevenLabs': the draft speaks in ElevenLabs' default voice.
	if (back.mode !== 'reference' || back.prompt !== '' || music.mode !== 'reference' || (back.params?.voice !== undefined && back.params.voice !== DEFAULT_VOICE.id)) {
		throw new Error(`The draft must come back to ${ELEVEN_V4.model} with its own default voice and an empty prompt: ${JSON.stringify({ back, music })}`);
	}
	await clickBlankCanvas(page);
}

// --- the voice menu --------------------------------------------------------------------------------

// Criteria 83 and 85: a speech model's panel has the voice button between the
// model button and the settings button, with the default voice's name, and
// the settings summary names no voice. With ElevenLabs not set up, the voice
// menu lists the catalog's voices and says how to choose from all of them,
// with Set Up, which opens Providers at ElevenLabs; there the step sets it up
// with the test key and its endpoint at the local test provider, and the page
// lists ElevenLabs' models under Audio (providers, criterion 8).
async function assertVoiceMenuBeforeSetUp(page) {
	const provider = await videoSmokeProvider();
	const panel = await selectGenerationCard(page, SPEECH);
	const shown = await waitForReading(() => readGenerationPanel(panel), seen => seen.voice?.label === DEFAULT_VOICE.label, 'the voice button to name the default voice');
	if (shown.voice.name !== `Voice: ${DEFAULT_VOICE.label}` || !shown.settings || shown.settings.includes(DEFAULT_VOICE.label) || /\bVoice\b/.test(shown.settings)) {
		throw new Error(`The voice button must name the voice, and the settings summary none: ${JSON.stringify(shown)}`);
	}
	const footer = await panel.evaluate(element => ['model', 'voice', 'settings'].map(name => {
		const rect = element.querySelector(`button.bh-video-panel-${name}`)?.getBoundingClientRect();
		return rect ? { left: rect.left, right: rect.right, middle: rect.top + rect.height / 2 } : null;
	}));
	if (footer.some(rect => rect === null) || !(footer[0].right <= footer[1].left && footer[1].right <= footer[2].left) || Math.abs(footer[0].middle - footer[1].middle) > 2 || Math.abs(footer[1].middle - footer[2].middle) > 2) {
		throw new Error(`The voice button must stand between the model button and the settings button: ${JSON.stringify(footer)}`);
	}
	const menu = await openVoiceMenu(panel);
	const eldrin = voiceInMenu(menu, DEFAULT_VOICE.label);
	if (JSON.stringify(menu.status) !== JSON.stringify({ text: 'Set up ElevenLabs to choose from all of its voices and your own.', action: 'Set Up' })
		|| JSON.stringify(voiceSections(menu)) !== JSON.stringify([`Voices: ${CATALOG_VOICES.join(', ')}`]) || !eldrin?.checked || !eldrin.active
		|| menu.sections[0].voices.some(voice => voice.sample !== null || !voice.description)) {
		throw new Error(`Before ElevenLabs is set up, the voice menu must list the catalog's voices with their descriptions and say how to get the others: ${JSON.stringify(menu)}`);
	}
	await panel.locator('button.bh-voice-menu-status-action').click();
	const providers = await waitForProvidersPage(page);
	await waitForReading(() => readProviderEditor(providers), seen => seen.provider === 'elevenlabs', 'Set Up to open Providers at ElevenLabs');
	const saved = await setUpProvider(page, providers, 'elevenlabs', provider.elevenLabsEndpoint, provider.key);
	const audio = saved.kinds.find(line => line.kind === 'audio');
	if (saved.kinds.length !== 1 || audio?.label !== 'Audio' || JSON.stringify(audio.models.map(model => model.id)) !== JSON.stringify(ELEVENLABS_MODELS)) {
		throw new Error(`Providers must list ElevenLabs' models under Audio: ${JSON.stringify(saved.kinds)}`);
	}
	await closeProvidersPage(page, providers);
	await assertCanvasFolder(page, AUDIO_FOLDER);
}

// Criteria 83 and 84: the voice menu, once ElevenLabs is set up, lists the
// account's voices under Your Voices and ElevenLabs' under Voices, the
// catalog's first, as the local test provider lists them; typing filters
// them. A sample's play button turns to stop while it plays, another sample
// stops it, and closing the menu stops it, as the window's own state says;
// a sample that starts pauses a video that plays on the canvas, and a video
// that starts there stops the sample. Choosing a voice of the account saves
// it at once, closes the menu, and the button shows it; the settings summary
// names no voice.
async function assertVoiceMenu(page) {
	const panel = await selectGenerationCard(page, SPEECH);
	await openVoiceMenu(panel);
	let menu = await waitForReading(() => readVoiceMenu(panel), seen => seen?.status === null && seen.sections.length === 2, 'the voice menu to list the voices of ElevenLabs and of the account');
	const expected = ['Your Voices: Coast Narrator, Sea Captain', `Voices: ${[...CATALOG_VOICES, 'George'].join(', ')}`];
	const captain = voiceInMenu(menu, ACCOUNT_VOICE.label);
	const eldrin = voiceInMenu(menu, DEFAULT_VOICE.label);
	if (JSON.stringify(voiceSections(menu)) !== JSON.stringify(expected) || captain?.id !== ACCOUNT_VOICE.id || captain.description !== 'Male, Old, Gravelly' || captain.sample !== 'stopped'
		|| eldrin?.description !== 'Crisp British baritone' || eldrin.sample !== 'stopped' || !eldrin.checked || !eldrin.active
		|| voiceInMenu(menu, 'Elara')?.sample !== null || voiceInMenu(menu, 'George')?.description !== 'Male, Middle aged, British, Warm, Narrative story') {
		throw new Error(`The voice menu must list the account's voices and ElevenLabs', with their descriptions and samples: ${JSON.stringify(menu)}`);
	}

	// Typing keeps the voices whose name or description holds what was typed.
	await page.keyboard.type('captain');
	await waitForReading(() => readVoiceMenu(panel), seen => JSON.stringify(voiceSections(seen)) === JSON.stringify(['Your Voices: Sea Captain']), 'typing captain to keep Sea Captain alone');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.press('Backspace');
	await waitForReading(() => readVoiceMenu(panel), seen => JSON.stringify(voiceSections(seen)) === JSON.stringify(expected) && seen.searchFocused, 'an empty search to list every voice again');

	// A sample plays, and its button stops it; another sample stops the first.
	await clickSample(panel, DEFAULT_VOICE.label);
	await waitForReading(() => readVoiceMenu(panel), seen => voiceInMenu(seen, DEFAULT_VOICE.label)?.sample === 'playing', 'the sample of Eldrin to play, its button turned to stop');
	await clickSample(panel, ACCOUNT_VOICE.label);
	menu = await waitForReading(() => readVoiceMenu(panel), seen => voiceInMenu(seen, ACCOUNT_VOICE.label)?.sample === 'playing', 'the sample of Sea Captain to play');
	if (voiceInMenu(menu, DEFAULT_VOICE.label)?.sample !== 'stopped' || menu.sampleFailure !== null || !menu.searchFocused) {
		throw new Error(`Another sample must stop the one that plays, and the search field keeps the keyboard: ${JSON.stringify(menu)}`);
	}
	// Closing the menu stops it: opened again within the sample's 12 seconds, no sample plays.
	await page.keyboard.press('Escape');
	await waitForReading(() => panel.locator('.bh-video-panel-menu.voice').count(), count => count === 0, 'Escape to close the voice menu');
	menu = await openVoiceMenu(panel);
	if (menu.sections.flatMap(section => section.voices).some(voice => voice.sample === 'playing' || voice.sample === 'loading')) {
		throw new Error(`Closing the voice menu must stop its sample: ${JSON.stringify(menu)}`);
	}

	// A sample pauses a video that plays on the canvas: the video under the pointer, the sample started with Space from the search field.
	await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.basehalf-canvas-video-player video');
		if (video instanceof HTMLVideoElement) {
			// The test video lasts two seconds: it plays on through the whole check.
			video.loop = true;
		}
	}, REEL);
	const onReel = await cardVideoPicturePoint(page, REEL);
	const away = await emptyCanvasPoint(page);
	await page.mouse.move(onReel.x, onReel.y);
	await waitForReading(() => readCardVideoPlayer(page, REEL), seen => seen?.paused === false, 'the pointer on the video to play it');
	if (!(await readVoiceMenu(panel))?.searchFocused) {
		throw new Error('The search field of the voice menu must keep the keyboard while the pointer is on the canvas');
	}
	await page.keyboard.press(' ');
	await waitForReading(() => readVoiceMenu(panel), seen => voiceInMenu(seen, DEFAULT_VOICE.label)?.sample === 'playing', 'Space to play the sample of the current voice');
	await waitForReading(() => readCardVideoPlayer(page, REEL), seen => seen?.paused === true, 'the sample that starts to pause the video that plays on the canvas');
	// A video that starts on the canvas stops the sample.
	await page.mouse.move(away.x, away.y);
	await page.mouse.move(onReel.x, onReel.y);
	await waitForReading(() => readCardVideoPlayer(page, REEL), seen => seen?.paused === false, 'the pointer on the video to play it again');
	await waitForReading(() => readVoiceMenu(panel), seen => voiceInMenu(seen, DEFAULT_VOICE.label)?.sample === 'stopped', 'the video that starts on the canvas to stop the sample');
	await page.mouse.move(away.x, away.y);
	await waitForReading(() => readCardVideoPlayer(page, REEL), seen => seen?.paused === true, 'the pointer leaving the video to pause it');

	// Choosing a voice of the account saves it at once, closes the menu, and the button shows it.
	await panel.locator(`.bh-voice-menu-option[data-key="voice:${ACCOUNT_VOICE.id}"]`).click();
	await waitUntil(() => readGenerationInfo(SPEECH)?.params?.voice === ACCOUNT_VOICE.id, `choosing ${ACCOUNT_VOICE.label} to save it in ${SPEECH}`, 10_000);
	await waitForReading(() => panel.locator('.bh-video-panel-menu.voice').count(), count => count === 0, 'choosing a voice to close the menu');
	const chosen = await waitForReading(() => readGenerationPanel(panel), seen => seen.voice?.label === ACCOUNT_VOICE.label, 'the voice button to show the chosen voice');
	if (!chosen.settings || chosen.settings.includes(ACCOUNT_VOICE.label) || chosen.settings.includes(ACCOUNT_VOICE.id)) {
		throw new Error(`The settings summary must name no voice: ${JSON.stringify(chosen)}`);
	}
}

// Criterion 85: a voice the card has that no list names, as an agent may
// write one of another account, shows at the top of Voices by its id with
// "Not among the voices of this account."; a list that cannot be loaded
// keeps the last list with the reason and Try Again, which loads it again.
// The step leaves the card with the voice of the account it found.
async function assertVoiceMenuWithoutAList(page) {
	const provider = await videoSmokeProvider();
	const panel = await selectGenerationCard(page, SPEECH);
	const foreign = 'voice-of-another-account';
	writeGenerationInfo(SPEECH, { ...readGenerationInfo(SPEECH), params: { ...readGenerationInfo(SPEECH).params, voice: foreign } });
	await waitForReading(() => readGenerationPanel(panel), seen => seen.voice?.label === foreign, 'the voice button to show a voice that no list names by its id');
	let menu = await openVoiceMenu(panel);
	menu = await waitForReading(() => readVoiceMenu(panel), seen => seen?.status === null && voiceInMenu(seen, foreign) !== undefined, 'the voice menu to list the voice that no list names');
	const voices = menu.sections.find(section => section.title === 'Voices')?.voices ?? [];
	if (voices[0]?.id !== foreign || voices[0].description !== 'Not among the voices of this account.' || !voices[0].checked) {
		throw new Error(`A voice that no list names must head Voices by its id: ${JSON.stringify(menu)}`);
	}
	await page.keyboard.press('Escape');
	await waitForReading(() => panel.locator('.bh-video-panel-menu.voice').count(), count => count === 0, 'Escape to close the voice menu');

	// The provider refuses the key for now: the last list stays, with the reason and Try Again.
	provider.mock.configure({ fail: 'key' });
	try {
		await openVoiceMenu(panel);
		menu = await waitForReading(() => readVoiceMenu(panel), seen => seen?.status?.action === 'Try Again', 'the voice menu to say that the voices could not be loaded');
		if (menu.status.text !== 'The voices could not be loaded: Invalid API key' || JSON.stringify(voiceSections(menu)[0]) !== JSON.stringify('Your Voices: Coast Narrator, Sea Captain')) {
			throw new Error(`A list that cannot be loaded must keep the last list, with the reason: ${JSON.stringify(menu)}`);
		}
	} finally {
		provider.mock.configure({ fail: 'none' });
	}
	await panel.locator('button.bh-voice-menu-status-action').click();
	await waitForReading(() => readVoiceMenu(panel), seen => seen?.status === null, 'Try Again to load the voices');
	await panel.locator(`.bh-voice-menu-option[data-key="voice:${ACCOUNT_VOICE.id}"]`).click();
	await waitUntil(() => readGenerationInfo(SPEECH)?.params?.voice === ACCOUNT_VOICE.id, `choosing ${ACCOUNT_VOICE.label} again to save it`, 10_000);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.voice?.label === ACCOUNT_VOICE.label, 'the voice button to show the voice of the account again');
	await clickBlankCanvas(page);
}

// --- a voice that speaks a note --------------------------------------------------------------------

// Criteria 86 and 89: a note connected to the speech draft and mentioned in
// its prompt, from the reference menu, is spoken without its name: the local
// test provider receives exactly the note's text, in the chosen voice. The
// sound lands under the draft's name; its card plays it with the player's
// Play, with its sound, and Card Detail plays it, with what made it; the
// panel of the card names the model, the voice, and the settings.
async function assertNoteIsSpoken(page) {
	const provider = await videoSmokeProvider();
	const panel = await selectGenerationCard(page, SPEECH);
	await panel.locator('.bh-prompt-editor').click();
	await page.keyboard.type('@');
	await waitForReading(() => readMentionMenu(panel), seen => seen !== null && seen.searchFocused && seen.options.some(option => option.file === 'Notes'), 'typing @ to open the reference menu with Notes');
	await panel.locator('.bh-reference-menu-option[data-key="kind:text"]').hover();
	const flyout = panel.locator('.bh-reference-menu.flyout');
	await flyout.waitFor({ state: 'visible', timeout: 10_000 });
	await flyout.locator('.bh-reference-menu-option', { hasText: 'intro' }).click();
	await waitUntil(() => JSON.stringify(readUpstreamSidecar(SPEECH)) === JSON.stringify([INTRO_NOTE]), `choosing the note in the reference menu to connect ${INTRO_NOTE}`, 10_000);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === `@[${INTRO_NOTE}] ` && seen.promptFocused, 'the mention of the note to take the place of the @');
	await page.keyboard.press('Backspace');
	await waitForReading(() => readGenerationInfo(SPEECH)?.prompt ?? null, prompt => prompt === `@[${INTRO_NOTE}]`, 'the prompt that mentions the note to be saved', 10_000);
	const ready = await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === false && JSON.stringify(seen.chips.map(chip => chip.text)) === JSON.stringify(['intro']), 'Generate to be ready with the note mentioned');
	if (ready.voice?.label !== ACCOUNT_VOICE.label || ready.inputs.length !== 1 || ready.inputs[0].path !== INTRO_NOTE) {
		throw new Error(`The draft must speak in the chosen voice with the note connected: ${JSON.stringify(ready)}`);
	}

	const requestsBefore = provider.mock.requests.length;
	const watch = watchGenerations([AUDIO_FOLDER]);
	await clickGenerate(panel);
	await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(SPEECH)) && readMade(SPEECH) !== undefined, `the speech to land on ${SPEECH}`);
	watch.stop();
	const seen = watch.first();
	// ElevenLabs answers with the sound at once: there is no task to ask about.
	if (JSON.stringify(statesOf(seen).filter(state => state !== 'landing')) !== JSON.stringify(['preparing', 'submitting']) || !seen.record.answersAtOnce || seen.record.sentPrompt !== INTRO_TEXT) {
		throw new Error(`Speech must be answered at once, its prompt sent as the note's text: ${JSON.stringify(seen)}`);
	}
	// Exactly the note's text, without its name, in the chosen voice (criterion 86).
	const requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || requests[0].kind !== 'speech' || requests[0].prompt !== INTRO_TEXT || requests[0].voice !== ACCOUNT_VOICE.id || requests[0].model !== ELEVEN_V4.providerModel) {
		throw new Error(`The local test provider must receive the note's text alone, in the chosen voice: ${JSON.stringify(requests)}`);
	}
	const made = readMade(SPEECH);
	if (made.provider !== ELEVEN_V4.provider || made.model !== ELEVEN_V4.model || made.providerModel !== ELEVEN_V4.providerModel || made.mode !== 'reference' || made.prompt !== `@[${INTRO_NOTE}]`
		|| JSON.stringify(made.inputs) !== JSON.stringify([INTRO_NOTE]) || made.params?.voice !== ACCOUNT_VOICE.id || made.output !== undefined) {
		throw new Error(`made.yaml must hold what made the sound, with the note's path and not its text: ${JSON.stringify(made)}`);
	}
	// The sound lands under the draft's name: the provider's own MP3, with the card's record and inputs.
	if (!provider.soundTag(fs.readFileSync(workspaceFile(SPEECH)))?.startsWith('speech-') || fs.existsSync(workspaceFile(SPEECH_WAV))
		|| JSON.stringify(cardInformationFiles(SPEECH)) !== JSON.stringify(['made.yaml', 'upstream.yaml'])) {
		throw new Error(`The sound must land as ${SPEECH}, with its record: ${JSON.stringify(cardInformationFiles(SPEECH))}`);
	}
	// The open panel becomes the panel of the card with its file: the model, the voice, and the settings (criterion 89).
	const record = await waitForReading(() => readRecordPanel(panel), seen => seen.record && seen.state === 'ready' && seen.model === ELEVEN_V4.label, 'the panel of the card to show what made its sound');
	if (record.voice !== ACCOUNT_VOICE.label || !record.settings?.startsWith('Speech') || record.settings.includes(ACCOUNT_VOICE.label) || record.prompt !== made.prompt
		|| JSON.stringify(record.inputs) !== JSON.stringify(['intro']) || record.line !== null || JSON.stringify(record.buttons) !== JSON.stringify(['New Version'])) {
		throw new Error(`The panel of the card must name the model, the voice, and the settings it was made with: ${JSON.stringify(record)}`);
	}

	// The card plays the sound in the player, the glyph of a sound where a video shows its frame: Play plays it with its sound.
	await clickBlankCanvas(page);
	await setCanvasZoomPercent(page, 100);
	await showCardOnCanvas(page, SPEECH);
	const player = await waitForReading(() => readCardVideoPlayer(page, SPEECH), seen => seen !== null && seen.readyState >= 1 && seen.duration > 2, 'the card to show the sound in its player');
	if (player.media !== 'sound' || !player.glyph || !player.paused) {
		throw new Error(`The card of a sound must show its player, with the glyph of a sound, at rest: ${JSON.stringify(player)}`);
	}
	await clickCanvasCardOnTop(page, SPEECH);
	await waitForCanvasCardSelection(page, SPEECH);
	await waitForReading(() => readCardVideoPlayer(page, SPEECH), seen => seen?.selected && seen.controls === 'shown', 'the selected card to show the controls of its player');
	const play = await cardVideoControlBox(page, SPEECH, 'play');
	await page.mouse.click(play.x, play.y);
	const playing = await waitForReading(() => readCardVideoPlayer(page, SPEECH), seen => seen?.paused === false && seen.time > 0.3, 'Play to play the sound');
	if (playing.muted) {
		throw new Error(`A sound plays with its sound on: ${JSON.stringify(playing)}`);
	}
	await page.mouse.click(play.x, play.y);
	await waitForReading(() => readCardVideoPlayer(page, SPEECH), seen => seen?.paused === true, 'Pause to pause the sound');

	// Open shows it in Card Detail, as its waveform in place of a player (editing media, D85), which plays it with what made it under it.
	const toolbar = await waitForReading(() => readCardToolbar(page), seen => seen?.path === SPEECH, 'the toolbar of the card with its sound');
	if (JSON.stringify(toolbar.actions) !== JSON.stringify(['revealVideo', 'openFullPreview']) || toolbar.media !== 'audio') {
		throw new Error(`The toolbar of a card with its sound must offer Reveal and Open: ${JSON.stringify(toolbar)}`);
	}
	await page.locator('.basehalf-video-context-toolbar [data-video-action="openFullPreview"]').click();
	const detail = page.locator('.basehalf-card-detail.visible');
	await detail.waitFor({ state: 'visible', timeout: 15_000 });
	const waveform = detail.locator('.basehalf-card-detail-media .basehalf-sound-waveform');
	await waveform.waitFor({ state: 'visible', timeout: 15_000 });
	const readDetail = () => detail.evaluate(element => {
		const media = element.querySelector('.basehalf-card-detail-media');
		const play = media?.querySelector('.basehalf-sound-waveform-play');
		// The waveform plays the sound with the window's audio: no element of Card Detail plays it, and none is muted.
		const elements = Array.from(media?.querySelectorAll('video, audio') ?? []) as HTMLMediaElement[];
		const time = /^([\d.]+)s/.exec(media?.querySelector('.basehalf-sound-waveform-time')?.textContent ?? '')?.[1];
		return {
			player: !!media?.querySelector('.basehalf-canvas-video-player'),
			fullScreen: !!media?.querySelector('.basehalf-canvas-video-player-button.full-screen'),
			ready: play?.getAttribute('aria-disabled') === 'false',
			playing: play?.getAttribute('aria-label') === 'Pause',
			mediaElements: elements.length,
			muted: elements.some(item => item.muted),
			time: time === undefined ? 0 : Number(time)
		};
	}, undefined, { timeout: 2_000 });
	const shown = await waitForReading(readDetail, seen => seen.ready, 'the waveform to decode the sound so that Play can play it');
	if (shown.player || shown.fullScreen || shown.mediaElements !== 0 || shown.playing) {
		throw new Error(`Card Detail must show the sound as its waveform, at rest, in place of BaseHalf's player, without Full Screen: ${JSON.stringify(shown)}`);
	}
	await waveform.locator('.basehalf-sound-waveform-play').click();
	const heard = await waitForReading(readDetail, seen => seen.playing && seen.time > 0.3, 'the waveform to play the sound');
	if (heard.muted) {
		throw new Error(`Card Detail plays a sound with its sound on: ${JSON.stringify(heard)}`);
	}
	await waveform.locator('.basehalf-sound-waveform-play').click();
	await waitForReading(readDetail, seen => !seen.playing, 'Pause to pause the sound');
	const section = detail.locator('.basehalf-card-detail-media.has-generation-provenance section.bh-generation-provenance');
	await section.waitFor({ state: 'visible', timeout: 15_000 });
	const provenance = await section.evaluate(element => ({
		label: element.getAttribute('aria-label'),
		rows: Object.fromEntries(Array.from(element.querySelectorAll('dl.bh-generation-provenance-rows > dt')).map(term => [term.textContent, term.nextElementSibling?.textContent ?? null])),
		inputs: Array.from(element.querySelectorAll('.bh-generation-provenance-inputs li')).map(item => `${item.querySelector('.bh-generation-provenance-input-name')?.textContent} ${item.querySelector('.bh-generation-provenance-input-path')?.textContent}`)
	}));
	if (provenance.label !== 'What made this sound' || provenance.rows.Model !== `${ELEVEN_V4.label} (${ELEVEN_V4.providerModel})` || provenance.rows.Provider !== 'ElevenLabs · Global'
		|| provenance.rows.Mode !== 'Speech' || provenance.rows.Prompt !== 'intro' || JSON.stringify(provenance.inputs) !== JSON.stringify([`Note ${INTRO_NOTE}`])) {
		throw new Error(`Card Detail must say what made the sound: ${JSON.stringify(provenance)}`);
	}
	await page.locator('.basehalf-card-detail-close').click();
	await detail.waitFor({ state: 'hidden', timeout: 10_000 });
	await assertCanvasFolder(page, AUDIO_FOLDER);
	await clickBlankCanvas(page);
}

// --- several songs ---------------------------------------------------------------------------------

// Criteria 87 and 88: Mureka, set up with the test key and its endpoint at
// the local test provider. A new draft starts with the model and the values
// of the last sound made. Mureka 9.5 shows its modes first in its settings,
// From a Description and From Lyrics, and From Lyrics shows Style; with
// Style `city pop` and 2 songs, Generate makes the draft and one more draft
// in a row to its right before anything is sent, the provider receives the
// lyrics, the style, and `n: 2`, and each song lands on its own card, whose
// panel says which song of the two it is.
async function assertSongsFromLyrics(page) {
	const provider = await videoSmokeProvider();
	const providers = await openProvidersPage(page);
	await setUpProvider(page, providers, 'mureka', provider.murekaEndpoint, provider.key);
	await closeProvidersPage(page, providers);
	await assertCanvasFolder(page, AUDIO_FOLDER);
	// A draft where the canvas is empty, so that the draft of the second song has the room to its right.
	await clickBlankCanvas(page);
	await panBelowTheCards(page);
	const { cardPath, panel } = await newAudioDraft(page);
	const started = readGenerationInfo(cardPath);
	if (cardPath !== SONG || started.provider !== ELEVEN_V4.provider || started.model !== ELEVEN_V4.model || started.params?.voice !== ACCOUNT_VOICE.id || started.prompt !== '') {
		throw new Error(`New Audio must make ${SONG} with the model and the values of the last sound made: ${JSON.stringify({ cardPath, started })}`);
	}
	await chooseModel(page, panel, SONG, MUREKA_9_5.provider, MUREKA_9_5.model);
	let settings = await openSettings(panel);
	if (JSON.stringify(settings.keys.slice(0, 2)) !== JSON.stringify(['mode:reference', 'mode:lyrics']) || !settings.checked.includes('mode:reference') || settings.parameters.includes('style') || !settings.parameters.includes('count')) {
		throw new Error(`A music model with From Lyrics must show its modes first, and Style only in From Lyrics: ${JSON.stringify(settings)}`);
	}
	await panel.locator('.bh-video-panel-menu.settings [data-key="mode:lyrics"]').click();
	await waitUntil(() => readGenerationInfo(SONG)?.mode === 'lyrics', `${SONG} to store From Lyrics`, 10_000);
	settings = await waitForReading(() => readSettingsPopover(panel), seen => seen?.parameters.includes('style') === true, 'From Lyrics to show Style among the settings');
	if (JSON.stringify(settings.parameters) !== JSON.stringify(['count', 'style']) || !settings.checked.includes('mode:lyrics') || !settings.checked.includes('count:2')) {
		throw new Error(`From Lyrics must show Songs, two by default, and Style: ${JSON.stringify(settings)}`);
	}
	await panel.locator('.bh-video-panel-menu.settings input[data-key="style:text"]').click();
	await page.keyboard.type(STYLE);
	await page.keyboard.press('Enter');
	await waitUntil(() => readGenerationInfo(SONG)?.params?.style === STYLE, `the style of ${SONG} to be saved`, 10_000);
	await closePanelMenu(page, panel, 'settings');
	await savePrompt(page, panel, SONG, LYRICS);
	const ready = await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === false, 'Generate to be ready');
	if (!ready.settings?.startsWith('From Lyrics') || !ready.settings.includes(STYLE) || ready.voice !== null) {
		throw new Error(`The settings of the song must sum up From Lyrics and its style, and a music model has no voice: ${JSON.stringify(ready)}`);
	}

	const row = readCardRow(SONG, AUDIO_FOLDER);
	const requestsBefore = provider.mock.requests.length;
	const createsBefore = provider.creates.length;
	const watch = watchGenerations([AUDIO_FOLDER]);
	await clickGenerate(panel);
	await watch.until(w => w.first()?.record.cards?.length === 2, 'the generation of two songs to name its two cards');
	const cards = watch.first().record.cards.map(card => card.path);
	if (JSON.stringify(cards) !== JSON.stringify([SONG, SECOND_SONG])) {
		throw new Error(`Two songs land on the draft and one more draft: ${JSON.stringify(cards)}`);
	}
	await watch.until(w => w.first().removed && cards.every(card => fs.existsSync(workspaceFile(card)) && readMade(card) !== undefined), 'both songs to land, each on its card');
	watch.stop();
	const seen = watch.first();
	// The second draft was made before the request was sent, in a row to the right of the first.
	const madeAt = fs.statSync(mirrorFolder(SECOND_SONG)).birthtimeMs;
	const sentAt = provider.creates[createsBefore];
	const second = readCardRow(SECOND_SONG, AUDIO_FOLDER);
	if (sentAt === undefined || !(madeAt < sentAt) || !second || second.x < row.x + row.width || second.y !== row.y) {
		throw new Error(`The draft of the second song must be made before the request is sent, to the right of the first: ${JSON.stringify({ madeAt, sentAt, row, second })}`);
	}
	// The provider received the lyrics, the style, and n: 2, once (criterion 87).
	const requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || requests[0].kind !== 'song' || requests[0].model !== MUREKA_9_5.model || requests[0].prompt !== LYRICS
		|| requests[0].body?.lyrics !== LYRICS || requests[0].body?.prompt !== STYLE || requests[0].body?.n !== 2 || requests[0].body?.reference_id !== undefined) {
		throw new Error(`The local test provider must receive the lyrics, the style, and n: 2 in one request: ${JSON.stringify(requests)}`);
	}
	// Each song is its own file, on its own card, which says which song of the two it is.
	for (const [index, card] of cards.entries()) {
		const made = readMade(card);
		const tag = provider.soundTag(fs.readFileSync(workspaceFile(card)));
		if (tag !== `song-${requests[0].taskId}-${index}` || made.id !== `${seen.id}-${index + 1}` || made.output !== index + 1 || made.outputs !== 2 || made.remoteId !== `song/${requests[0].taskId}`
			|| made.model !== MUREKA_9_5.model || made.mode !== 'lyrics' || made.prompt !== LYRICS || made.params?.style !== STYLE || made.params?.count !== 2 || readGenerationInfo(card) !== undefined) {
			throw new Error(`Song ${index + 1} of 2 must land on its own card, made from the lyrics and the style: ${JSON.stringify({ card, tag, made, files: cardInformationFiles(card) })}`);
		}
		const songPanel = await selectGenerationCard(page, card);
		const shown = await waitForReading(() => readRecordPanel(songPanel), panelSeen => panelSeen.record && panelSeen.state === 'ready' && panelSeen.line !== null, `the panel of ${card} to say which song it is`);
		if (shown.line !== `Song ${index + 1} of 2` || shown.model !== MUREKA_9_5.label || shown.voice !== null || !shown.settings?.startsWith('From Lyrics') || shown.prompt !== LYRICS) {
			throw new Error(`The panel of ${card} must say "Song ${index + 1} of 2": ${JSON.stringify(shown)}`);
		}
	}
	// No workspace file holds the test key.
	const holding = filesContaining(workspacePath, provider.key);
	if (holding.length) {
		throw new Error(`A provider's credentials are in workspace files: ${holding.join(', ')}`);
	}
	await clickBlankCanvas(page);
}
