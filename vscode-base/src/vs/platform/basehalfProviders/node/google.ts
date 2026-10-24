/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, measureItems } from './check.js';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import type { HttpAnswer, ProviderHttp } from './http.js';
import { audioFormatOf, base64Length, base64Of, bufferSource, measure, pcmToWav, plannedItems, readMedia, type MediaFormat, type MediaInspector, type PcmLayout, type PlannedItem } from './media.js';
import type { AnsweredAtOnce, ModuleCheckResult, ModulePollState, OutputLocation, ProviderModule, VideoLocation } from './module.js';
import { promptLanguage, sharedPromptName, writePromptNames, type PromptContext } from './prompt.js';
import type { AudioFormat, CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, ImageFormat, ModeId, OutputFormat, PollState, PromptPart, SubmitRequest, TaskRef } from '../common/basehalfProviderTypes.js';

/**
 * Google's models on the Gemini API (docs/specs/providers/google.md). The
 * video model, Gemini Omni Flash, runs in the background through the
 * Interactions API: the create answers at once with the interaction's id, a
 * poll reads the stored interaction, and the finished video comes inside it
 * as base64. The image models, Nano Banana, and the music models, Lyria,
 * answer the create of their interaction with their image or song, also as
 * base64. The speech models, Gemini 3.8 TTS, answer `generateContent` with
 * the speech as a WAV (D78). Inputs travel inline as base64 too.
 */

const MODEL_ID = 'gemini-omni-1.1-flash';

type Resolution = '360p' | '720p' | '1080p' | '4k';

type ImageModelId = 'gemini-nano-banana-2.1' | 'gemini-3-pro-image' | 'gemini-3.1-flash-lite-image' | 'gemini-3.1-flash-image';
type ImageResolution = '1k' | '2k' | '4k';
type ThinkingLevel = 'minimal' | 'medium' | 'high';

type SpeechModelId = 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';
type MusicModelId = 'lyria-3.5' | 'lyria-3-clip-preview';

// --- the provider's English texts, in one place so they can be translated -----------------------

const RESOLUTION_LABELS: Readonly<Record<Resolution, string>> = Object.freeze({ '360p': '360p', '720p': '720p', '1080p': '1080p', '4k': '4K' });

const TEXT = Object.freeze({
	provider: 'Google',
	region: 'Gemini API',
	apiKey: 'API Key',
	model: 'Gemini Omni 1.1 Flash',
	description: 'Video with sound, 3 to 10 seconds long, from a prompt, a start and an end frame, or reference images and videos; it also edits and extends clips of up to 10 seconds.',
	modes: { frames: 'Frames', reference: 'References', edit: 'Edit', extend: 'Extend' },
	parameters: {
		resolution: 'Resolution',
		resolutionTooltip: '1080p and 4K are upscaled from the generated video.',
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the video: landscape or portrait.',
		seed: 'Seed',
		seedTooltip: 'The same seed with the same request gives a similar video. Leave it empty for a new one each time.'
	},
	resolutions: RESOLUTION_LABELS,
	images: Object.freeze<Record<ImageModelId, { readonly label: string; readonly description: string }>>({
		'gemini-nano-banana-2.1': {
			label: 'Nano Banana 2.1',
			description: 'Google\'s recommended image model: fast images from a prompt or from up to 14 reference images, at 1K, 2K, or 4K, in shapes from 8:1 to 1:8.'
		},
		'gemini-3-pro-image': {
			label: 'Nano Banana Pro',
			description: 'Google\'s image model for the most demanding images, such as text, diagrams, and product shots: from a prompt or from up to 14 reference images, at 1K, 2K, or 4K.'
		},
		'gemini-3.1-flash-lite-image': {
			label: 'Nano Banana 2 Lite',
			description: 'Google\'s fastest image model, at 1K: images from a prompt or from reference images. It is not made for many reference images.'
		},
		'gemini-3.1-flash-image': {
			label: 'Nano Banana 2',
			description: 'Google replaced it with Nano Banana 2.1.'
		}
	}),
	image: Object.freeze({
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the image. Adaptive follows the shape of the reference images, or makes a square without them.',
		adaptive: 'Adaptive',
		resolution: 'Resolution',
		resolutionTooltip: '1K, 2K, and 4K images have about 1, 4, and 16 million pixels.',
		resolutions: Object.freeze<Record<ImageResolution, string>>({ '1k': '1K', '2k': '2K', '4k': '4K' }),
		thinking: 'Thinking',
		thinkingTooltip: 'How much the model reasons before it draws. More thinking can help a complex image and takes longer.',
		thinkingLevels: Object.freeze<Record<ThinkingLevel, string>>({ minimal: 'Minimal', medium: 'Medium', high: 'High' })
	}),
	speech: Object.freeze({
		models: Object.freeze<Record<SpeechModelId, { readonly label: string; readonly description: string }>>({
			'gemini-3.8-flash-tts': {
				label: 'Gemini 3.8 Flash TTS',
				description: 'Google\'s most expressive speech, for narration and acting: up to 8,192 characters in over 130 languages, in one of 30 voices.'
			},
			'gemini-3.8-flash-lite-tts': {
				label: 'Gemini 3.8 Flash-Lite TTS',
				description: 'Google\'s fast speech for everyday reading aloud: up to 8,192 characters in over 100 languages, in one of 30 voices.'
			}
		}),
		mode: 'Speech',
		voice: 'Voice',
		/** Google's one-word description of each prebuilt voice. */
		voices: Object.freeze<Record<string, string>>({
			Zephyr: 'Bright', Puck: 'Upbeat', Charon: 'Informative',
			Kore: 'Firm', Fenrir: 'Excitable', Leda: 'Youthful',
			Orus: 'Firm', Aoede: 'Breezy', Callirrhoe: 'Easy-going',
			Autonoe: 'Bright', Enceladus: 'Breathy', Iapetus: 'Clear',
			Umbriel: 'Easy-going', Algieba: 'Smooth', Despina: 'Smooth',
			Erinome: 'Clear', Algenib: 'Gravelly', Rasalgethi: 'Informative',
			Laomedeia: 'Upbeat', Achernar: 'Soft', Alnilam: 'Firm',
			Schedar: 'Even', Gacrux: 'Mature', Pulcherrima: 'Forward',
			Achird: 'Friendly', Zubenelgenubi: 'Casual', Vindemiatrix: 'Gentle',
			Sadachbia: 'Lively', Sadaltager: 'Knowledgeable', Sulafat: 'Warm'
		}),
		textOnly: (label: string) => `${label} cannot be sent: Google's speech models take text only.`,
		noTask: (model: string) => `${model} answers with its speech at once: there is no task to ask about.`,
		/** Without the speech, with Google's reason (a finish reason such as `SAFETY`) and its words when it gives them. */
		noSpeech: (reason: string | undefined, said: string | undefined) => `Google finished the generation without the speech${reason ? ` (${reason})` : ''}${said ? `: ${said}` : '.'}`,
		blocked: (reason: string) => `Google blocked the text (${reason}).`,
		freeQuota: 'Google\'s free tier lets the project of this API key use this model only so much, and that is used up for now. Wait and try again, or set up billing for the project in Google AI Studio for higher limits.',
		freeTierUnavailable: 'Google\'s free tier is not available to the project of this API key. Set up billing for the project in Google AI Studio, or use the key of a project that has it.'
	}),
	music: Object.freeze({
		models: Object.freeze<Record<MusicModelId, { readonly label: string; readonly description: string }>>({
			'lyria-3.5': {
				label: 'Lyria 3.5',
				description: 'Google\'s full-length songs of a couple of minutes, with verses, choruses, and vocals or as instrumentals, from a description, your lyrics, or up to 10 images.'
			},
			'lyria-3-clip-preview': {
				label: 'Lyria 3 Clip',
				description: 'Music clips of 30 seconds, such as loops and previews, from a description or up to 10 images.'
			}
		}),
		modes: Object.freeze({ reference: 'From a Description', lyrics: 'From Lyrics' }),
		instrumental: 'Instrumental',
		instrumentalTooltip: 'Music without singing.',
		style: 'Style',
		styleTooltip: 'The style of the song, such as its genre, instruments, mood, and singer. Lyria sings the prompt as the lyrics.',
		imagesOnly: (label: string) => `${label} cannot be sent: Google's music models take reference images only.`,
		noSong: 'Google finished the generation without a song.',
		noSongSaying: (text: string) => `Google finished the generation without a song: ${text}`,
		incomplete: 'Google ended the generation before the song was finished.'
	}),
	referencesNeedInput: 'Gemini Omni 1.1 Flash in References mode needs at least one reference image or video.',
	requestTooLarge: (megabytes: string) => `The request with its inputs would be about ${megabytes} MB; the Gemini API takes at most 100 MB in one request. Use fewer or smaller inputs.`,
	imageFormat: (label: string) => `${label} is not a PNG, JPEG, WebP, or GIF image.`,
	videoFormat: (label: string) => `${label} is not an MP4 or MOV video.`,
	noAudio: (label: string) => `${label} cannot be sent: Gemini Omni 1.1 Flash takes no audio references.`,
	noLyrics: 'Gemini Omni 1.1 Flash makes videos; it has no Lyrics mode.',
	imagesOnly: (label: string) => `${label} cannot be sent: Google's image models take reference images only.`,
	notOffered: (model: string) => `Google does not offer "${model}" in this region.`,
	noTaskId: 'Google accepted the request but gave no interaction id BaseHalf can read.',
	failed: 'Google reports that the generation failed.',
	cancelled: 'The generation was cancelled.',
	incomplete: 'Google ended the generation without a complete video.',
	imageIncomplete: 'Google ended the generation before the image was finished.',
	requiresAction: 'Google waits for an action on the generation that BaseHalf cannot take.',
	budgetExceeded: 'Google ended the generation when its budget ran out.',
	noVideo: 'Google finished the generation without a video.',
	noVideoSaying: (text: string) => `Google finished the generation without a video: ${text}`,
	noImage: 'Google finished the generation without an image.',
	noImageSaying: (text: string) => `Google finished the generation without an image: ${text}`,
	notReady: 'The generation has no video yet.',
	unreadableAddress: 'Google gave an address BaseHalf cannot read.',
	unknownStatus: (status: string) => `Google reports a generation status BaseHalf does not know: ${status || 'none'}.`,
	freeTier: 'Google offers this model only on a paid tier, and the project of this API key is on the free tier. Set up billing for the project in Google AI Studio, or use the key of a project that has it.'
});

// --- the model ---------------------------------------------------------------------------------

/** Inline data may be at most 100 MB per request (File input methods); the whole request is held to it. */
const REQUEST_MAX_BYTES = 100_000_000;
/** The JSON around the inputs, and around each input part, counted generously. */
const REQUEST_OVERHEAD_BYTES = 2048;
const PART_OVERHEAD_BYTES = 128;
/** A poll's answer carries the finished video as base64 and may carry the inputs again. */
const INTERACTION_MAX_BYTES = 384 * 1024 * 1024;
/** The context window, in tokens; the prompt is bounded at as many characters. */
const PROMPT_MAX_LENGTH = 1_048_576;
/** Reference videos: "a maximum of 3 clips, up to 3 seconds each". */
const REFERENCE_VIDEO_SECONDS: readonly [number, number] = [0.1, 3];
/** Input videos for editing and extending are at most 10 seconds. */
const CLIP_SECONDS: readonly [number, number] = [0.1, 10];
/** Google states no maximum; its guide shows six reference images in one request. */
const REFERENCE_IMAGES_MAX = 6;

const NO_SLOT = Object.freeze({ min: 0, max: 0 });

const MODES: readonly CatalogMode[] = [
	{
		id: 'frames',
		label: TEXT.modes.frames,
		inputs: { startFrame: 'optional', endFrame: 'optional', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
		limits: {}
	},
	{
		id: 'reference',
		label: TEXT.modes.reference,
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: REFERENCE_IMAGES_MAX }, videos: { min: 0, max: 3 }, audios: NO_SLOT, source: 'none' },
		limits: { videoSeconds: REFERENCE_VIDEO_SECONDS }
	},
	{
		id: 'edit',
		label: TEXT.modes.edit,
		inputs: { startFrame: 'none', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'required' },
		limits: { videoSeconds: CLIP_SECONDS }
	},
	{
		id: 'extend',
		label: TEXT.modes.extend,
		inputs: { startFrame: 'none', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'required' },
		limits: { videoSeconds: CLIP_SECONDS }
	}
];

const RESOLUTIONS: readonly Resolution[] = ['360p', '720p', '1080p', '4k'];

const PARAMETERS: readonly CatalogParameter[] = [
	{
		name: 'resolution',
		label: TEXT.parameters.resolution,
		tooltip: TEXT.parameters.resolutionTooltip,
		kind: 'choice',
		options: RESOLUTIONS.map(value => ({ value, label: TEXT.resolutions[value] })),
		default: '720p'
	},
	{
		name: 'ratio',
		label: TEXT.parameters.ratio,
		tooltip: TEXT.parameters.ratioTooltip,
		kind: 'choice',
		display: 'ratio',
		options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
		default: '16:9',
		modes: ['frames', 'reference']
	},
	{
		name: 'seed',
		label: TEXT.parameters.seed,
		tooltip: TEXT.parameters.seedTooltip,
		kind: 'integer',
		min: 0,
		max: 2147483647,
		step: 1,
		optional: true,
		advanced: true
	}
];

const OMNI: CatalogModel = {
	id: MODEL_ID,
	kind: 'video',
	label: TEXT.model,
	description: TEXT.description,
	providerModels: { global: MODEL_ID },
	prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
	modes: MODES,
	parameters: PARAMETERS
};

// --- the image models --------------------------------------------------------------------------

/** One of Google's image models, as the image guide and its model page describe it. */
interface GoogleImageModel {
	/** The catalog id, which is also the id sent. */
	readonly id: ImageModelId;
	/** The values of `response_format.aspect_ratio` it takes. */
	readonly ratios: readonly string[];
	readonly resolutions: readonly ImageResolution[];
	/** Its levels of `generation_config.thinking_level` and their default; absent when it has none. */
	readonly thinking?: { readonly levels: readonly ThinkingLevel[]; readonly default: ThinkingLevel };
	/** Its input token limit; the prompt is bounded at as many characters. */
	readonly inputTokens: number;
	readonly deprecated?: boolean;
}

/** The ten ratios every image model takes, in the order the panel shows them. */
const RATIOS_10: readonly string[] = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']);
/** The fourteen of Nano Banana 2.1 and 2: the ten, then the wide and tall ones. */
const RATIOS_14: readonly string[] = Object.freeze([...RATIOS_10, '4:1', '1:4', '8:1', '1:8']);

const IMAGE_MODELS: readonly GoogleImageModel[] = Object.freeze([
	{ id: 'gemini-nano-banana-2.1', ratios: RATIOS_14, resolutions: ['1k', '2k', '4k'], thinking: { levels: ['minimal', 'medium', 'high'], default: 'medium' }, inputTokens: 131_072 },
	{ id: 'gemini-3-pro-image', ratios: RATIOS_10, resolutions: ['1k', '2k', '4k'], inputTokens: 65_536 },
	{ id: 'gemini-3.1-flash-lite-image', ratios: RATIOS_10, resolutions: ['1k'], thinking: { levels: ['minimal', 'high'], default: 'minimal' }, inputTokens: 65_536 },
	{ id: 'gemini-3.1-flash-image', ratios: RATIOS_14, resolutions: ['1k', '2k', '4k'], thinking: { levels: ['minimal', 'high'], default: 'minimal' }, inputTokens: 131_072, deprecated: true }
] satisfies GoogleImageModel[]);

/** Up to 14 reference images, the image guide's limit for every model. */
const IMAGE_REFERENCES_MAX = 14;
/** The ratio that leaves the shape to Google, which follows the reference images or makes a square. */
const ADAPTIVE = 'adaptive';
/** `response_format.image_size` of each resolution: an uppercase K, which Google requires. */
const IMAGE_SIZES: Readonly<Record<ImageResolution, string>> = Object.freeze({ '1k': '1K', '2k': '2K', '4k': '4K' });
/** The only output type the reference names: the models declare JPEG, so a draft has its final name. */
const IMAGE_OUTPUT_TYPE = 'image/jpeg';

const IMAGE_REFERENCES: CatalogMode = {
	id: 'reference',
	label: TEXT.modes.reference,
	inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: IMAGE_REFERENCES_MAX }, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
	limits: {}
};

function declareImageModel(model: GoogleImageModel): CatalogModel {
	const parameters: CatalogParameter[] = [
		{
			name: 'ratio',
			label: TEXT.image.ratio,
			tooltip: TEXT.image.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: [{ value: ADAPTIVE, label: TEXT.image.adaptive }, ...model.ratios.map(value => ({ value, label: value }))],
			default: ADAPTIVE
		},
		{
			name: 'resolution',
			label: TEXT.image.resolution,
			tooltip: TEXT.image.resolutionTooltip,
			kind: 'choice',
			options: model.resolutions.map(value => ({ value, label: TEXT.image.resolutions[value] })),
			default: '1k'
		}
	];
	if (model.thinking) {
		parameters.push({
			name: 'thinking_level',
			label: TEXT.image.thinking,
			tooltip: TEXT.image.thinkingTooltip,
			kind: 'choice',
			options: model.thinking.levels.map(value => ({ value, label: TEXT.image.thinkingLevels[value] })),
			default: model.thinking.default,
			advanced: true
		});
	}
	return {
		id: model.id,
		kind: 'image',
		label: TEXT.images[model.id].label,
		description: TEXT.images[model.id].description,
		providerModels: { global: model.id },
		prompt: { required: 'always', maxLength: model.inputTokens },
		modes: [IMAGE_REFERENCES],
		parameters,
		outputFormat: 'jpeg',
		answersAtOnce: true,
		...(model.deprecated ? { deprecated: true } : {})
	};
}

// --- the speech and music models (D78) ------------------------------------------------------------

/** One of Google's speech models: its catalog id, which is also the id sent, and its input token limit. */
interface GoogleSpeechModel {
	readonly id: SpeechModelId;
	/** The prompt is bounded at as many characters. */
	readonly inputTokens: number;
}

const SPEECH_MODELS: readonly GoogleSpeechModel[] = Object.freeze([
	{ id: 'gemini-3.8-flash-tts', inputTokens: 8192 },
	{ id: 'gemini-3.8-flash-lite-tts', inputTokens: 8192 }
] satisfies GoogleSpeechModel[]);

/** The prebuilt voice every example of the speech guide speaks in. */
const DEFAULT_VOICE = 'Kore';

const SPEECH_MODE: CatalogMode = {
	id: 'reference',
	label: TEXT.speech.mode,
	// "TTS models accept text-only inputs."
	inputs: { startFrame: 'none', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
	limits: {}
};

/** The 30 prebuilt voices, in the order of the guide's table, with Google's words for each; Google's other voices are not listed (google.md, "Speech models"). */
const VOICE_PARAMETER: CatalogParameter = {
	name: 'voice',
	label: TEXT.speech.voice,
	kind: 'voice',
	options: Object.entries(TEXT.speech.voices).map(([value, description]) => ({ value, label: value, description })),
	default: DEFAULT_VOICE,
	listed: false
};

function declareSpeechModel(model: GoogleSpeechModel): CatalogModel {
	return {
		id: model.id,
		kind: 'audio',
		makes: 'speech',
		label: TEXT.speech.models[model.id].label,
		description: TEXT.speech.models[model.id].description,
		providerModels: { global: model.id },
		prompt: { required: 'always', maxLength: model.inputTokens },
		modes: [SPEECH_MODE],
		parameters: [VOICE_PARAMETER],
		// Uncompressed samples, which come as a WAV, or raw and written as one.
		outputFormat: 'wav',
		answersAtOnce: true
	};
}

/** One of Google's music models: whether it sings lyrics of the card's own, and its input token limit. */
interface GoogleMusicModel {
	readonly id: MusicModelId;
	readonly lyrics: boolean;
	readonly inputTokens: number;
}

const MUSIC_MODELS: readonly GoogleMusicModel[] = Object.freeze([
	{ id: 'lyria-3.5', lyrics: true, inputTokens: 131_072 },
	// Google documents lyrics of one's own for Lyria 3.5 only.
	{ id: 'lyria-3-clip-preview', lyrics: false, inputTokens: 131_072 }
] satisfies GoogleMusicModel[]);

/** "You can provide up to 10 images alongside your text prompt." */
const MUSIC_IMAGES_MAX = 10;
const MUSIC_STYLE_MAX_LENGTH = 1000;
/** The header the prompt guide puts the lyrics beneath. */
const LYRICS_HEADER = 'Lyrics:';
/** Google's words for a track without vocals, as its guide's instrumental request ends. */
const INSTRUMENTAL_ONLY = 'Instrumental only, no vocals.';

function musicMode(id: 'reference' | 'lyrics'): CatalogMode {
	return {
		id,
		label: TEXT.music.modes[id],
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: MUSIC_IMAGES_MAX }, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
		limits: {}
	};
}

function declareMusicModel(model: GoogleMusicModel): CatalogModel {
	const parameters: CatalogParameter[] = [
		{ name: 'instrumental', label: TEXT.music.instrumental, tooltip: TEXT.music.instrumentalTooltip, kind: 'boolean', default: false, modes: ['reference'] }
	];
	if (model.lyrics) {
		parameters.push({ name: 'style', label: TEXT.music.style, tooltip: TEXT.music.styleTooltip, kind: 'text', maxLength: MUSIC_STYLE_MAX_LENGTH, optional: true, modes: ['lyrics'] });
	}
	return {
		id: model.id,
		kind: 'audio',
		makes: 'music',
		label: TEXT.music.models[model.id].label,
		description: TEXT.music.models[model.id].description,
		providerModels: { global: model.id },
		// Lyria makes music "from text prompts or from images".
		prompt: { required: 'withoutMedia', maxLength: model.inputTokens },
		modes: model.lyrics ? [musicMode('reference'), musicMode('lyrics')] : [musicMode('reference')],
		parameters,
		// "By default, the Lyria 3.5 models generate audio in MP3 format."
		outputFormat: 'mp3',
		answersAtOnce: true
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'google',
	label: TEXT.provider,
	regions: [
		{ id: 'global', label: TEXT.region, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', console: 'https://aistudio.google.com/api-keys' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: [OMNI, ...IMAGE_MODELS.map(declareImageModel), ...SPEECH_MODELS.map(declareSpeechModel), ...MUSIC_MODELS.map(declareMusicModel)]
});

function imageModelOf(id: string): GoogleImageModel | undefined {
	return IMAGE_MODELS.find(model => model.id === id);
}

function speechModelOf(id: string): GoogleSpeechModel | undefined {
	return SPEECH_MODELS.find(model => model.id === id);
}

function musicModelOf(id: string): GoogleMusicModel | undefined {
	return MUSIC_MODELS.find(model => model.id === id);
}

/** The id sent for a model in a region, or a refusal when the region does not offer it. */
function providerModelOf(model: string, region: string): string {
	const providerModel = ENTRY.models.find(entry => entry.id === model)?.providerModels[region];
	if (!providerModel) {
		throw rejected(TEXT.notOffered(model));
	}
	return providerModel;
}

// --- check -------------------------------------------------------------------------------------

async function check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
	const counts = countsOf(request.inputs);
	const problems: string[] = [];
	// Only the video model needs a reference in References mode; an image, a speech, or a music model makes its file from the prompt alone.
	if (request.model === OMNI.id && request.mode === 'reference' && counts.images === 0 && counts.videos === 0) {
		problems.push(TEXT.referencesNeedInput);
	}
	let size = REQUEST_OVERHEAD_BYTES + Buffer.byteLength(JSON.stringify(request.prompt), 'utf8');
	for (const item of await measureItems(request.inputs, media)) {
		size += base64Length(item.facts.bytes) + PART_OVERHEAD_BYTES;
	}
	if (size > REQUEST_MAX_BYTES) {
		problems.push(TEXT.requestTooLarge((size / 1_000_000).toFixed(1)));
	}
	return { problems };
}

// --- requests ----------------------------------------------------------------------------------

const INTERACTIONS = '/interactions';

function interactionPath(remoteId: string): string {
	return `${INTERACTIONS}/${encodeURIComponent(remoteId)}`;
}

/** The MIME types the Interactions API names for each format BaseHalf reads. */
const IMAGE_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' });
const VIDEO_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ mp4: 'video/mp4', mov: 'video/mov' });

/** What the mode asks the model to do with its inputs (`generation_config.video_config.task`). */
function taskOf(mode: ModeId, startFrame: boolean): string {
	switch (mode) {
		case 'frames':
			return startFrame ? 'image_to_video' : 'text_to_video';
		case 'reference':
			return 'reference_to_video';
		case 'edit':
			return 'edit';
		case 'extend':
			return 'extend';
		case 'lyrics':
			// A mode of music models; the commands send a module only a mode its model declares.
			throw rejected(TEXT.noLyrics);
	}
}

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const image = imageModelOf(request.model);
	if (image) {
		return submitImage(image, request, http);
	}
	const speech = speechModelOf(request.model);
	if (speech) {
		return submitSpeech(speech, request, http);
	}
	const music = musicModelOf(request.model);
	return music ? submitMusic(music, request, http) : submitVideo(request, http);
}

async function submitVideo(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	if (request.model !== OMNI.id) {
		throw rejected(TEXT.notOffered(request.model));
	}
	const providerModel = providerModelOf(request.model, request.region);
	// The media in the plan's order, then the prompt, as the guide's requests list them.
	const input: unknown[] = [];
	for (const item of plannedItems(request.inputs)) {
		if (item.slot === 'audio') {
			// No mode declares audio; the guide calls audio references unsupported.
			throw rejected(TEXT.noAudio(item.label));
		}
		const read = await readMedia(item.media, REQUEST_MAX_BYTES, item.label);
		const { format } = await measure(bufferSource(read.bytes));
		const video = item.slot === 'video' || item.slot === 'source';
		const type = format ? (video ? VIDEO_TYPES : IMAGE_TYPES)[format] : undefined;
		if (!type) {
			throw rejected(video ? TEXT.videoFormat(item.label) : TEXT.imageFormat(item.label));
		}
		input.push({ type: video ? 'video' : 'image', mime_type: type, data: base64Of(read) });
	}
	input.push({ type: 'text', text: request.prompt });
	// The parameters arrive checked and completed; an unset seed is not sent.
	const { resolution, ratio: aspectRatio, seed } = request.params;
	const body = Buffer.from(JSON.stringify({
		model: providerModel,
		input,
		generation_config: {
			video_config: { task: taskOf(request.mode, request.inputs.startFrame !== undefined) },
			...(seed !== undefined ? { seed } : {})
		},
		response_format: { type: 'video', resolution, ...(aspectRatio !== undefined ? { aspect_ratio: aspectRatio } : {}) },
		background: true
	}), 'utf8');
	if (body.byteLength > REQUEST_MAX_BYTES) {
		throw rejected(TEXT.requestTooLarge((body.byteLength / 1_000_000).toFixed(1)));
	}
	// Read as large as a poll: should Google run the interaction at once despite
	// `background`, its answer is the finished interaction, video included, and
	// its id is followed like any other.
	const answer = await http.create({ method: 'POST', path: INTERACTIONS, body: { kind: 'bytes', bytes: body, contentType: 'application/json' }, maxAnswerBytes: INTERACTION_MAX_BYTES });
	const id = answer.object().id;
	if (typeof id !== 'string' || !id.trim()) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return id;
}

/** The reference images of a request in the plan's order, each inline with the type its bytes show; `notImage` refuses any other input. */
async function imageParts(items: readonly PlannedItem[], notImage: (label: string) => string): Promise<unknown[]> {
	const parts: unknown[] = [];
	for (const item of items) {
		if (item.slot !== 'image') {
			// The modes of an image or a music model take reference images only.
			throw rejected(notImage(item.label));
		}
		const read = await readMedia(item.media, REQUEST_MAX_BYTES, item.label);
		const { format } = await measure(bufferSource(read.bytes));
		const type = format ? IMAGE_TYPES[format] : undefined;
		if (!type) {
			throw rejected(TEXT.imageFormat(item.label));
		}
		parts.push({ type: 'image', mime_type: type, data: base64Of(read) });
	}
	return parts;
}

/**
 * Creates an interaction that Google answers with its file, an image or a
 * song, sent once and not in the background: the finished interaction's file
 * is the one output, and an interaction Google answers before it ends is
 * followed by its id instead.
 */
async function createAtOnce(body: Record<string, unknown>, kind: FileKind, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const bytes = Buffer.from(JSON.stringify(body), 'utf8');
	if (bytes.byteLength > REQUEST_MAX_BYTES) {
		throw rejected(TEXT.requestTooLarge((bytes.byteLength / 1_000_000).toFixed(1)));
	}
	// The answer holds the file; it is read up to the size the commands allow a model that answers at once.
	const answer = await http.create({ method: 'POST', path: INTERACTIONS, body: { kind: 'bytes', bytes, contentType: 'application/json' } });
	const interaction = answer.object();
	const reading = readInteraction(interaction);
	if (!STATUSES.has(reading.status)) {
		// The request was taken, and the file may have been made.
		throw unknownOutcome(TEXT.unknownStatus(reading.status));
	}
	const state = fileState(reading, http.endpoint, kind);
	switch (state.state) {
		case 'pending':
		case 'running': {
			// Not finished within the answer: the interaction is stored, so its id is followed like a video's.
			const id = interaction.id;
			if (typeof id !== 'string' || !id.trim()) {
				throw unknownOutcome(TEXT.noTaskId);
			}
			return id;
		}
		case 'succeeded':
			return { outputs: state.outputs };
		default:
			return { outputs: [{ refused: state.message }] };
	}
}

/**
 * An image request (google.md, "Image models"): the prompt, then the reference
 * images in the plan's order, sent once and not in the background. Google
 * answers with the finished interaction, whose image is the one output; an
 * interaction it answers before it ends is followed by its id instead.
 */
async function submitImage(model: GoogleImageModel, request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const providerModel = providerModelOf(model.id, request.region);
	const input: unknown[] = [{ type: 'text', text: request.prompt }, ...await imageParts(plannedItems(request.inputs), TEXT.imagesOnly)];
	// The parameters arrive checked and completed: the ratio, the resolution, and the thinking level of a model that has one.
	const { ratio, resolution, thinking_level: thinkingLevel } = request.params;
	return createAtOnce({
		model: providerModel,
		input,
		response_format: {
			type: 'image',
			mime_type: IMAGE_OUTPUT_TYPE,
			image_size: IMAGE_SIZES[resolution as ImageResolution],
			...(ratio !== undefined && ratio !== ADAPTIVE ? { aspect_ratio: ratio } : {})
		},
		...(thinkingLevel !== undefined ? { generation_config: { thinking_level: thinkingLevel } } : {})
	}, 'image', http);
}

/**
 * The text of a music request (google.md, "Music models", "Request"): in
 * From a Description the prompt, with Google's words for an instrumental when
 * Instrumental is on; in From Lyrics the Style, then the lyrics beneath the
 * `Lyrics:` header the prompt guide puts them under, a blank line between.
 */
function musicText(request: SubmitRequest): string {
	if (request.mode === 'lyrics') {
		const style = typeof request.params.style === 'string' ? request.params.style.trim() : '';
		return [...(style ? [style] : []), LYRICS_HEADER, request.prompt].join('\n\n');
	}
	const description = request.prompt.trim() ? request.prompt : '';
	return request.params.instrumental === true ? [description, INSTRUMENTAL_ONLY].filter(text => text.length > 0).join('\n\n') : description;
}

/**
 * A music request (google.md, "Music models"): the text, then the reference
 * images in the plan's order, sent once and not in the background, as an
 * image request is; the song is the one output.
 */
async function submitMusic(model: GoogleMusicModel, request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const providerModel = providerModelOf(model.id, request.region);
	const text = musicText(request);
	// Without a text, the images alone describe the music.
	const input: unknown[] = [...(text ? [{ type: 'text', text }] : []), ...await imageParts(plannedItems(request.inputs), TEXT.music.imagesOnly)];
	return createAtOnce({ model: providerModel, input }, 'audio', http);
}

/**
 * The layout of raw samples from their type, such as
 * `audio/l16;codec=pcm;rate=24000`: 16-bit little-endian samples, as Google
 * describes its raw samples, mono and at 24 kHz unless the type says another
 * rate or number of channels. Undefined for any other type.
 */
function rawSamplesOf(mimeType: string | undefined): PcmLayout | undefined {
	if (!mimeType || !/^audio\/(?:l16|pcm)(?:[;\s]|$)/.test(mimeType)) {
		return undefined;
	}
	const field = (name: string) => Number(new RegExp(`;\\s*${name}=(\\d{1,6})`).exec(mimeType)?.[1]);
	const rate = field('rate');
	const channels = field('channels');
	return { sampleRate: rate >= 8000 && rate <= 192_000 ? rate : 24_000, channels: channels >= 1 && channels <= 8 ? channels : 1, bitsPerSample: 16 };
}

/** The speech Google answered: a WAV as it is, raw samples written as a WAV, and anything else for the checks of a download to decide. */
function speechAudio(data: string, mimeType: string | undefined): OutputLocation {
	const bytes = Buffer.from(data, 'base64');
	if (audioFormatOf(bytes) === 'wav') {
		return { bytes, format: 'wav' };
	}
	const layout = rawSamplesOf(mimeType);
	return layout ? { bytes: pcmToWav(bytes, layout), format: 'wav' } : { bytes };
}

/** The speech of a `generateContent` answer: the last audio part of its first candidate, or the reason it has none. */
function speechOutput(response: Record<string, unknown>): OutputLocation {
	const candidates = Array.isArray(response.candidates) ? response.candidates : [];
	const candidate = isRecord(candidates[0]) ? candidates[0] : undefined;
	const content = candidate && isRecord(candidate.content) ? candidate.content : undefined;
	let audio: { readonly data: string; readonly mimeType?: string } | undefined;
	const texts: string[] = [];
	for (const part of Array.isArray(content?.parts) ? content.parts : []) {
		if (!isRecord(part)) {
			continue;
		}
		const inline = isRecord(part.inlineData) ? part.inlineData : isRecord(part.inline_data) ? part.inline_data : undefined;
		if (inline && typeof inline.data === 'string' && inline.data.length > 0) {
			const mimeType = (words(inline.mimeType) ?? words(inline.mime_type))?.toLowerCase();
			audio = { data: inline.data, ...(mimeType ? { mimeType } : {}) };
			continue;
		}
		const said = words(part.text);
		if (said) {
			texts.push(said);
		}
	}
	if (audio) {
		return speechAudio(audio.data, audio.mimeType);
	}
	const blocked = isRecord(response.promptFeedback) ? words(response.promptFeedback.blockReason) : undefined;
	if (blocked) {
		return { refused: TEXT.speech.blocked(blocked) };
	}
	// A candidate without the speech says why with its finish reason; an answer without a candidate says nothing.
	const said = words(candidate?.finishMessage) ?? (texts.length ? texts.join(' ') : undefined);
	return { refused: TEXT.speech.noSpeech(words(candidate?.finishReason), said) };
}

/**
 * A refusal that names the free tier, for a speech model, which the free
 * tier offers (google.md, "Speech models", "Errors"): `readError`, which does
 * not know the model, answers that the model needs a paid tier. With HTTP
 * 429 the project's free quota is used up; otherwise the project has no free
 * tier.
 */
function speechTierFailure(error: unknown): unknown {
	if (!(error instanceof ProviderFailure) || error.message !== TEXT.freeTier) {
		return error;
	}
	return error.status === 429
		? new ProviderFailure('rateLimited', TEXT.speech.freeQuota, error.status)
		: new ProviderFailure('auth', TEXT.speech.freeTierUnavailable, error.status);
}

/**
 * A speech request (google.md, "Speech models"): the prompt as the one text
 * part of `generateContent`, with the audio modality, WAV, and a prebuilt
 * voice, sent once. Google answers it with the speech.
 */
async function submitSpeech(model: GoogleSpeechModel, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	const providerModel = providerModelOf(model.id, request.region);
	const [item] = plannedItems(request.inputs);
	if (item) {
		// The one mode takes no inputs.
		throw rejected(TEXT.speech.textOnly(item.label));
	}
	let answer: HttpAnswer;
	try {
		answer = await http.create({
			method: 'POST',
			path: `/models/${encodeURIComponent(providerModel)}:generateContent`,
			body: {
				kind: 'json',
				value: {
					contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
					generationConfig: {
						responseModalities: ['AUDIO'],
						responseFormat: { audio: { mimeType: 'AUDIO_WAV' } },
						speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: request.params.voice } } }
					}
				}
			}
		});
	} catch (error) {
		throw speechTierFailure(error);
	}
	return { outputs: [speechOutput(answer.object())] };
}

// --- the interaction ---------------------------------------------------------------------------

/** What BaseHalf reads of an interaction. */
interface Reading {
	readonly status: string;
	/** The output's video: its base64, or the address Google gave instead. */
	readonly video?: { readonly data?: string; readonly uri?: string };
	/** The output's last image, with the type Google names: its base64, or the address Google gave instead. */
	readonly image?: { readonly data?: string; readonly uri?: string; readonly mimeType?: string };
	/** The output's last audio block, a song, read as the image is. */
	readonly audio?: { readonly data?: string; readonly uri?: string; readonly mimeType?: string };
	/** The model's text output, when it wrote one. */
	readonly text?: string;
	/** The interaction's errors, or its output step's error. */
	readonly error?: string;
}

/** Every status the reference names. */
const STATUSES: ReadonlySet<string> = new Set(['queued', 'in_progress', 'requires_action', 'completed', 'failed', 'cancelled', 'incomplete', 'budget_exceeded']);

/** The formats of the image types Google answers. */
const IMAGE_FORMATS_BY_TYPE: Readonly<Record<string, ImageFormat>> = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' });
/** The formats of the audio types Google names (the reference's `audio/mp3`, `audio/mpeg`, and `audio/wav`). */
const AUDIO_FORMATS_BY_TYPE: Readonly<Record<string, AudioFormat>> = Object.freeze({ 'audio/mp3': 'mp3', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' });

function words(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readInteraction(interaction: Record<string, unknown>): Reading {
	const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
	let video: Reading['video'];
	let image: Reading['image'];
	let audio: Reading['audio'];
	const texts: string[] = [];
	const errors: string[] = [];
	for (const entry of Array.isArray(interaction.errors) ? interaction.errors : []) {
		const message = isRecord(entry) ? words(entry.message) ?? words(entry.code) : undefined;
		if (message) {
			errors.push(message);
		}
	}
	for (const step of steps) {
		if (!isRecord(step) || step.type !== 'model_output') {
			continue;
		}
		const stepError = isRecord(step.error) ? words(step.error.message) : undefined;
		if (!errors.length && stepError) {
			errors.push(stepError);
		}
		for (const part of Array.isArray(step.content) ? step.content : []) {
			if (!isRecord(part)) {
				continue;
			}
			if (part.type === 'video') {
				// The base64 of a whole video: checked for presence, never copied.
				if (typeof part.data === 'string' && part.data.length > 0) {
					video = { data: part.data };
				} else if (words(part.uri)) {
					video = { uri: words(part.uri) };
				}
			} else if (part.type === 'image') {
				// The last image of the output is the final one (the SDK's `output_image`); images
				// of `thought` steps are the model's drafts and are not read.
				const mimeType = words(part.mime_type)?.toLowerCase();
				if (typeof part.data === 'string' && part.data.length > 0) {
					image = { data: part.data, ...(mimeType ? { mimeType } : {}) };
				} else if (words(part.uri)) {
					image = { uri: words(part.uri), ...(mimeType ? { mimeType } : {}) };
				}
			} else if (part.type === 'audio') {
				// The last audio block of the output is the song (the SDK's `output_audio`); its lyrics come as text.
				const mimeType = words(part.mime_type)?.toLowerCase();
				if (typeof part.data === 'string' && part.data.length > 0) {
					audio = { data: part.data, ...(mimeType ? { mimeType } : {}) };
				} else if (words(part.uri)) {
					audio = { uri: words(part.uri), ...(mimeType ? { mimeType } : {}) };
				}
			} else if (part.type === 'text') {
				const said = words(part.text);
				if (said) {
					texts.push(said);
				}
			}
		}
	}
	return {
		status: typeof interaction.status === 'string' ? interaction.status : '',
		...(video ? { video } : {}),
		...(image ? { image } : {}),
		...(audio ? { audio } : {}),
		...(texts.length ? { text: texts.join(' ') } : {}),
		...(errors.length ? { error: [...new Set(errors)].join(' ') } : {})
	};
}

/**
 * The address of a file Google answered as `uri`: an absolute address as it
 * is, and a file's resource name as the Files API download under the endpoint.
 */
function videoAddress(uri: string, endpoint: URL): string {
	if (/^https?:\/\//i.test(uri)) {
		return uri;
	}
	const name = /^files\/(?<id>[A-Za-z0-9_-]{1,128})$/.exec(uri)?.groups?.id;
	if (!name) {
		throw unreadable(TEXT.unreadableAddress);
	}
	return `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, '')}/files/${name}:download?alt=media`;
}

/** A state that reads the same for a video and an image: still to come, or ended without its file. */
type CommonState =
	| { readonly state: 'pending' | 'running' }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

/** What an interaction that answers its file makes: an image, or a song. */
type FileKind = 'image' | 'audio';

/** The state of an image or a music interaction: a success has the image or the song as its one output. */
type FileState = CommonState | { readonly state: 'succeeded'; readonly outputs: readonly OutputLocation[] };

/** Every status but `completed` and `incomplete`, whose words depend on what the model makes. */
function commonState(reading: Reading): CommonState {
	switch (reading.status) {
		case 'queued':
			return { state: 'pending' };
		case 'in_progress':
			return { state: 'running' };
		case 'failed':
			return { state: 'failed', message: reading.error ?? TEXT.failed };
		case 'cancelled':
			return { state: 'cancelled', message: reading.error ?? TEXT.cancelled };
		case 'requires_action':
			return { state: 'failed', message: TEXT.requiresAction };
		case 'budget_exceeded':
			return { state: 'failed', message: reading.error ? `${TEXT.budgetExceeded} ${reading.error}` : TEXT.budgetExceeded };
		default:
			throw unreadable(TEXT.unknownStatus(reading.status));
	}
}

function stateOf(reading: Reading, endpoint: URL): PollState {
	switch (reading.status) {
		case 'completed':
			if (reading.video?.data) {
				return { state: 'succeeded' };
			}
			if (reading.video?.uri) {
				return { state: 'succeeded', videoUrl: videoAddress(reading.video.uri, endpoint) };
			}
			return { state: 'failed', message: reading.text || reading.error ? TEXT.noVideoSaying((reading.text ?? reading.error)!) : TEXT.noVideo };
		case 'incomplete':
			return { state: 'failed', message: reading.error ? `${TEXT.incomplete} ${reading.error}` : TEXT.incomplete };
		default:
			return commonState(reading);
	}
}

/** How the file of each kind is read and named: its block of the output, the formats of its types, and the words of an interaction without it. */
const FILES: Readonly<Record<FileKind, {
	readonly of: (reading: Reading) => Reading['image'];
	readonly formats: Readonly<Record<string, OutputFormat>>;
	/** The reason an interaction ended without the file: an image model explains itself in text, and a song's text is its lyrics. */
	readonly why: (reading: Reading) => string | undefined;
	readonly none: string;
	readonly noneSaying: (text: string) => string;
	readonly incomplete: string;
}>> = Object.freeze({
	image: { of: reading => reading.image, formats: IMAGE_FORMATS_BY_TYPE, why: reading => reading.text ?? reading.error, none: TEXT.noImage, noneSaying: TEXT.noImageSaying, incomplete: TEXT.imageIncomplete },
	audio: { of: reading => reading.audio, formats: AUDIO_FORMATS_BY_TYPE, why: reading => reading.error ?? reading.text, none: TEXT.music.noSong, noneSaying: TEXT.music.noSongSaying, incomplete: TEXT.music.incomplete }
});

/** The state of an image or a music interaction (google.md, "Image models" and "Music models", "Answer"). */
function fileState(reading: Reading, endpoint: URL, kind: FileKind): FileState {
	const files = FILES[kind];
	switch (reading.status) {
		case 'completed': {
			const file = files.of(reading);
			if (file?.data) {
				const format = file.mimeType ? files.formats[file.mimeType] : undefined;
				return { state: 'succeeded', outputs: [{ bytes: Buffer.from(file.data, 'base64'), ...(format ? { format } : {}) }] };
			}
			if (file?.uri) {
				let url: string;
				try {
					url = videoAddress(file.uri, endpoint);
				} catch (error) {
					return { state: 'failed', message: error instanceof Error ? error.message : TEXT.unreadableAddress };
				}
				return { state: 'succeeded', outputs: [{ url }] };
			}
			const why = files.why(reading);
			return { state: 'failed', message: why ? files.noneSaying(why) : files.none };
		}
		case 'incomplete':
			return { state: 'failed', message: reading.error ? `${files.incomplete} ${reading.error}` : files.incomplete };
		default:
			return commonState(reading);
	}
}

async function getInteraction(ref: TaskRef, http: ProviderHttp): Promise<Reading> {
	const answer = await http.request({ method: 'GET', path: interactionPath(ref.remoteId), maxAnswerBytes: INTERACTION_MAX_BYTES });
	return readInteraction(answer.object());
}

/**
 * An image or a music interaction is followed only when Google answered its
 * create before it ended; its image or song is the task's output. A speech
 * model answered with its speech and has no task.
 */
async function poll(ref: TaskRef, http: ProviderHttp): Promise<ModulePollState> {
	const speech = speechModelOf(ref.model);
	if (speech) {
		throw rejected(TEXT.speech.noTask(TEXT.speech.models[speech.id].label));
	}
	const reading = await getInteraction(ref, http);
	if (imageModelOf(ref.model)) {
		return fileState(reading, http.endpoint, 'image');
	}
	return musicModelOf(ref.model) ? fileState(reading, http.endpoint, 'audio') : stateOf(reading, http.endpoint);
}

async function videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
	const reading = await getInteraction(ref, http);
	const state = stateOf(reading, http.endpoint);
	if (state.state !== 'succeeded') {
		throw unreadable(state.state === 'failed' || state.state === 'cancelled' ? state.message : TEXT.notReady);
	}
	return reading.video?.data ? { bytes: Buffer.from(reading.video.data, 'base64') } : { url: state.videoUrl! };
}

/** Statuses after which a cancellation comes too late. */
const ENDED: ReadonlySet<string> = new Set(['completed', 'failed', 'incomplete', 'budget_exceeded']);

async function cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean> {
	if (speechModelOf(ref.model)) {
		// A speech model answered with its speech: there is no interaction to stop.
		return false;
	}
	let answer: HttpAnswer;
	try {
		answer = await http.requestOnce({ method: 'POST', path: `${interactionPath(ref.remoteId)}/cancel`, maxAnswerBytes: INTERACTION_MAX_BYTES });
	} catch (error) {
		if (error instanceof ProviderFailure && (error.code === 'rejected' || error.code === 'notFound')) {
			// The interaction no longer runs, or Google does not know it.
			return false;
		}
		throw error;
	}
	let status = '';
	try {
		const value = answer.object().status;
		status = typeof value === 'string' ? value : '';
	} catch {
		// Taken without an answer BaseHalf can read; Google updates the status after its clean-up.
	}
	return !ENDED.has(status);
}

// --- errors ------------------------------------------------------------------------------------

/** Words that name the free tier, as in `generate_content_free_tier_requests` or `FreeTier`. */
const FREE_TIER_WORDS = /free[\s_-]?tier/i;

/**
 * Google's words of an error answer: `{"error": {"code", "message"}}` with a
 * `snake_case` code, or the older shape with a numeric code and a `status`.
 * Every code the API errors page lists agrees with its HTTP status (402
 * `payment_required`, 429 `rate_limit_exceeded`, …), so the status decides,
 * except for a refusal that names the free tier: no model of this module is
 * offered there (Pricing), so the key needs a paid tier, and waiting, which a
 * 429 asks for, does not help.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	if (status >= 400 && status < 500 && FREE_TIER_WORDS.test(JSON.stringify(error ?? body) ?? '')) {
		return { message: TEXT.freeTier, code: 'auth' };
	}
	const message = error ? words(error.message) ?? words(error.code) ?? words(error.status) : undefined;
	return message ? { message } : readCommonError(body);
}

/**
 * The names of the inputs in a prompt (D74; Google, "Names in the prompt").
 * Gemini Omni reads the tags of its roles: `<FIRST_FRAME>`, `<LAST_FRAME>`,
 * and `<IMAGE_REF_0>` and `<VIDEO_REF_0>` for the references, counted from 0
 * by kind in the order they are sent. Its clip has no tag, and the image
 * models' prompts name images in words, so those take the shared names, as
 * Lyria's references do; a speech model takes no inputs to name.
 */
function writePrompt(prompt: readonly PromptPart[], request: PromptContext): string {
	const language = promptLanguage(prompt);
	if (request.model !== MODEL_ID) {
		return writePromptNames(prompt, input => sharedPromptName(input, language));
	}
	return writePromptNames(prompt, input => {
		switch (input.input) {
			case 'startFrame': return '<FIRST_FRAME>';
			case 'endFrame': return '<LAST_FRAME>';
			case 'images': return `<IMAGE_REF_${input.index ?? 0}>`;
			case 'videos': return `<VIDEO_REF_${input.index ?? 0}>`;
			default: return sharedPromptName(input, language);
		}
	});
}

export const GOOGLE: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ 'x-goog-api-key': credentials.apiKey }),
	readError,
	writePrompt,
	check,
	submit,
	poll,
	videoLocation,
	cancel
});
