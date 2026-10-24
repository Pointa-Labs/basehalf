/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, measureItems, type MeasuredItem, type PlannedCounts } from './check.js';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import type { HttpAnswer, ProviderHttp } from './http.js';
import { base64Length, bufferSource, dataUrlOf, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaFormat, type MediaInspector, type PlannedItem, type ReadMedia } from './media.js';
import type { AnsweredAtOnce, ModuleCheckResult, ModuleVoices, OutputLocation, ProviderModule, VideoLocation } from './module.js';
import { promptLanguage, referenceNumber, sharedPromptName, writePromptNames, type PromptContext } from './prompt.js';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, ListedVoice, Params, ParamValue, PollState, PromptPart, SubmitRequest, TaskRef, VoicesRequest } from '../common/basehalfProviderTypes.js';

/**
 * MiniMax's video, image, and speech models on MiniMax's own API, in China
 * (`api.minimax.cn`) and internationally (`api.minimax.io`), with a key of the
 * region (`docs/specs/providers/minimax.md`). MiniMax H3 and H3 Max run on the
 * V2 API, which takes a `content` list of text, frames, and references;
 * images travel as data URLs, videos and audio as uploaded files
 * (`mm_file://`). The Hailuo models run on the V1 API, which takes frames as
 * data URLs and reports its errors in `base_resp` of an HTTP 200 answer. The
 * image models answer `POST /v1/image_generation` with the images, as base64,
 * and report their errors in `base_resp` as V1 does. The speech models answer
 * `POST /v1/t2a_v2` with the speech, as the hex of an MP3, and report their
 * errors the same way; their voices, MiniMax's and the account's, come from
 * `POST /v1/get_voice` (D78).
 */

type MediaKind = 'image' | 'video' | 'audio';

// --- the provider's English texts, in one place so they can be translated -----------------------

const MODEL_TEXTS: Readonly<Record<string, { readonly label: string; readonly description: string }>> = Object.freeze({
	'h3': { label: 'MiniMax H3', description: 'MiniMax\'s multimodal video model: 4 to 15 seconds at 768P or 2K, from a prompt, frames, or up to 9 images, 3 videos, and 3 audio clips.' },
	'h3-max': { label: 'MiniMax H3 Max', description: 'A faster MiniMax H3 at 480P or 768P, 5 to 15 seconds, from the same inputs.' },
	'hailuo-2.3': { label: 'Hailuo 2.3', description: '6 or 10 seconds at 768P, or 6 seconds at 1080P, from a prompt or a start frame.' },
	'hailuo-2.3-fast': { label: 'Hailuo 2.3 Fast', description: 'A faster Hailuo 2.3 that brings a start frame to life: 6 or 10 seconds at 768P, or 6 seconds at 1080P.' },
	'hailuo-02': { label: 'Hailuo 02', description: '6 or 10 seconds at 768P, or 6 seconds at 1080P, from a prompt, a start frame, or a start and an end frame; 512P from a start frame alone.' },
	'image-01': { label: 'MiniMax Image-01', description: 'Up to 9 images at about 1K from a prompt, or from a prompt and one reference image of a person.' },
	'image-01-live': { label: 'MiniMax Image-01 Live', description: 'Image-01 with drawing styles (comic, lively, medieval, watercolor): up to 9 images from a prompt, or from a prompt and one reference image of a person. Offered in China.' },
	'speech-2.8-hd': { label: 'Speech 2.8 HD', description: 'MiniMax\'s most lifelike speech, which also reads interjections such as (laughs) and (sighs) in the text: up to 9,999 characters in 40 languages.' },
	'speech-2.8-turbo': { label: 'Speech 2.8 Turbo', description: 'A faster Speech 2.8 with a natural flow, which also reads interjections such as (laughs) and (sighs): up to 9,999 characters in 40 languages.' },
	'speech-2.6-hd': { label: 'Speech 2.6 HD', description: 'Natural speech with low latency, which can also speak fluently or whisper: up to 9,999 characters in 40 languages.' },
	'speech-2.6-turbo': { label: 'Speech 2.6 Turbo', description: 'A faster Speech 2.6, which can also speak fluently or whisper: up to 9,999 characters in 40 languages.' }
});

/** MiniMax's emotions (`voice_setting.emotion`), by the catalog's values: the seven every speech model takes, then the two of Speech 2.6. */
const EMOTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
	happy: 'Happy',
	sad: 'Sad',
	angry: 'Angry',
	fearful: 'Fearful',
	disgusted: 'Disgusted',
	surprised: 'Surprised',
	calm: 'Calm',
	fluent: 'Fluent',
	whisper: 'Whisper'
});

/** MiniMax's languages (`language_boost`), its values in its order, with their names. */
const LANGUAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
	'Chinese': 'Chinese',
	'Chinese,Yue': 'Cantonese',
	'English': 'English',
	'Arabic': 'Arabic',
	'Russian': 'Russian',
	'Spanish': 'Spanish',
	'French': 'French',
	'Portuguese': 'Portuguese',
	'German': 'German',
	'Turkish': 'Turkish',
	'Dutch': 'Dutch',
	'Ukrainian': 'Ukrainian',
	'Vietnamese': 'Vietnamese',
	'Indonesian': 'Indonesian',
	'Japanese': 'Japanese',
	'Italian': 'Italian',
	'Korean': 'Korean',
	'Thai': 'Thai',
	'Polish': 'Polish',
	'Romanian': 'Romanian',
	'Greek': 'Greek',
	'Czech': 'Czech',
	'Finnish': 'Finnish',
	'Hindi': 'Hindi',
	'Bulgarian': 'Bulgarian',
	'Danish': 'Danish',
	'Hebrew': 'Hebrew',
	'Malay': 'Malay',
	'Persian': 'Persian',
	'Slovak': 'Slovak',
	'Swedish': 'Swedish',
	'Croatian': 'Croatian',
	'Filipino': 'Filipino',
	'Hungarian': 'Hungarian',
	'Norwegian': 'Norwegian',
	'Slovenian': 'Slovenian',
	'Catalan': 'Catalan',
	'Nynorsk': 'Nynorsk',
	'Tamil': 'Tamil',
	'Afrikaans': 'Afrikaans'
});

/** MiniMax's sound effects (`voice_modify.sound_effects`), by the catalog's values. */
const SOUND_EFFECT_LABELS: Readonly<Record<string, string>> = Object.freeze({
	spacious_echo: 'Spacious Echo',
	auditorium_echo: 'Auditorium Echo',
	lofi_telephone: 'Lo-Fi Telephone',
	robotic: 'Robotic'
});

const TEXT = Object.freeze({
	provider: 'MiniMax',
	regions: { cn: 'China', intl: 'International' },
	apiKey: 'API Key',
	modes: { frames: 'Frames', reference: 'References' },
	models: MODEL_TEXTS,
	parameters: {
		resolution: 'Resolution',
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the video. With a frame, the video keeps the frame\'s shape: choose Adaptive. In References mode, Adaptive lets the model choose.',
		adaptive: 'Adaptive',
		duration: 'Duration',
		promptExpansion: 'Prompt Expansion',
		promptExpansionTooltip: 'How much MiniMax expands the prompt before it makes the video.',
		promptExpansionModes: { disabled: 'Off', balanced: 'Balanced', quality: 'Quality' },
		promptOptimizer: 'Prompt Optimizer',
		promptOptimizerTooltip: 'Lets MiniMax rewrite the prompt for a better video. Turn it off to keep the prompt as written.',
		fastOptimization: 'Fast Optimization',
		fastOptimizationTooltip: 'Makes the prompt optimizer faster. It does nothing when the optimizer is off.',
		watermark: 'Watermark',
		watermarkTooltip: 'Marks the video as made by AI. Offered in the China region only.'
	},
	image: {
		ratioTooltip: 'The shape of the image, at about 1K.',
		count: 'Images',
		countTooltip: 'How many images to make with one request.',
		promptOptimizerTooltip: 'Lets MiniMax rewrite the prompt for a better image. Turn it off to keep the prompt as written.',
		style: 'Style',
		styleTooltip: 'A drawing style MiniMax gives the images.',
		styles: { comic: 'Comic', lively: 'Lively', medieval: 'Medieval', watercolor: 'Watercolor' },
		styleWeight: 'Style Weight',
		styleWeightTooltip: 'How strongly the style shows, from 0.1 to 1.',
		seed: 'Seed',
		seedTooltip: 'The same seed with the same request gives similar images. Leave it empty for a new one each time.',
		watermarkTooltip: 'Marks the images as made by AI. Offered in the China region only.'
	},
	speech: {
		mode: 'Speech',
		voice: 'Voice',
		speed: 'Speed',
		speedTooltip: 'How fast the voice speaks: 1 is its own pace.',
		volume: 'Volume',
		volumeTooltip: 'How loud the voice is: 1 is its own volume.',
		pitch: 'Pitch',
		pitchTooltip: 'Raises or lowers the voice by semitones: 0 is its own pitch.',
		emotion: 'Emotion',
		emotionTooltip: 'The feeling the voice speaks with. Auto lets MiniMax choose the one that fits the text.',
		auto: 'Auto',
		emotions: EMOTION_LABELS,
		language: 'Language',
		languageTooltip: 'The language of the text, so that MiniMax reads it as that language, such as Cantonese. Auto lets MiniMax detect it.',
		languages: LANGUAGE_LABELS,
		deepen: 'Deepen / Brighten',
		deepenTooltip: 'Below 0 deepens the voice, above 0 brightens it.',
		stronger: 'Stronger / Softer',
		strongerTooltip: 'Below 0 makes the voice stronger, above 0 softer.',
		nasal: 'Nasal / Crisp',
		nasalTooltip: 'Below 0 makes the voice fuller, above 0 crisper.',
		soundEffect: 'Sound Effect',
		soundEffectTooltip: 'An effect MiniMax adds to the voice.',
		soundEffects: SOUND_EFFECT_LABELS,
		/** The catalog's voice: a system voice of both regions. */
		defaultVoice: { label: 'Graceful Lady', description: 'English' },
		noInputs: (label: string) => `${label} cannot be sent: MiniMax's speech models take text only.`,
		noSpeech: 'MiniMax accepted the request but answered no speech BaseHalf can read.',
		unreadable: 'MiniMax answered a sound BaseHalf cannot read.',
		noTask: (model: string) => `${model} answers with its speech at once: there is no task to ask about.`,
		rateLimits: 'MiniMax takes 60 requests a minute for speech models.',
		/** What MiniMax's codes of a speech request mean (its error code page), after MiniMax's words and code. */
		codes: Object.freeze<Record<number, string>>({
			1026: 'MiniMax\'s content check refused the text.',
			1027: 'MiniMax\'s content check stopped the speech.',
			1042: 'More than a tenth of the text is characters MiniMax cannot read.',
			2054: 'MiniMax does not know this voice for this key: choose another voice.',
			20132: 'MiniMax does not know this voice for this key: choose another voice.',
			2042: 'The voice belongs to another MiniMax account: choose one of this account\'s voices.',
			2043: 'This model does not speak in this voice: choose another voice or another model.',
			2061: 'The MiniMax plan of this key does not include this model.',
			2068: 'The MiniMax plan of this key does not include this model.'
		}),
		notSpeech: (model: string) => `${model} speaks in no voice that MiniMax lists.`
	},
	imageReferenceOnly: (label: string) => `${label} cannot be sent: MiniMax's image models take one reference image only.`,
	imageBlocked: 'MiniMax\'s content check stopped this image.',
	unreadableImage: 'MiniMax answered an image BaseHalf cannot read.',
	noImages: 'MiniMax accepted the request but answered no images BaseHalf can read.',
	noImageTask: (model: string) => `${model} answers with its images at once: there is no task to ask about.`,
	needsRatio: (model: string) => `${model} needs a ratio for a video made from the prompt alone: choose one, or connect an image.`,
	referencesNeedInput: (model: string) => `${model} in References mode needs at least one image, video, or audio clip.`,
	tooManyReferences: (model: string, count: number) => `${model} takes at most 12 references together; ${count} are planned.`,
	watermarkChinaOnly: 'MiniMax offers the AIGC watermark only in China: turn it off, or set up MiniMax in the China region.',
	durationAt: (model: string, resolution: string, seconds: string) => `${model} makes ${resolution} videos of ${seconds} seconds only: choose ${seconds} seconds, or another resolution.`,
	startFrameOnly: (model: string, resolution: string) => `${model} makes ${resolution} videos only from a start frame: connect an image, or choose another resolution.`,
	noEndFrameAt: (model: string, resolution: string) => `${model} makes ${resolution} videos only without an end frame: remove it, or choose another resolution.`,
	fastWithEndFrame: (model: string) => `${model} offers Fast Optimization only without an end frame: turn it off, or remove the end frame.`,
	m4aAudio: (label: string) => `${label} is M4A audio; MiniMax takes WAV or MP3.`,
	wrongFormat: (label: string) => `${label} is not in a format MiniMax takes.`,
	notOffered: (model: string) => `${model} is not offered in this region.`,
	noResolution: (model: string, resolution: string) => `${model} makes no ${resolution} videos.`,
	noSource: (label: string) => `${label} cannot be sent: MiniMax's models take no video to work on.`,
	framesOnly: (label: string) => `${label} cannot be sent: Hailuo models take frames only.`,
	requestTooLarge: 'The request with its inputs is larger than the 64 MB MiniMax takes. Use fewer or smaller inputs.',
	uploadFailed: (label: string, detail: string) => `${label} could not be uploaded to MiniMax: ${detail}`,
	uploadUnreadable: 'MiniMax answered the upload in a form BaseHalf cannot read.',
	errorCode: (code: number) => `MiniMax answered with error code ${code}.`,
	rateLimits: 'MiniMax takes 20 requests a minute for Hailuo models, 300 requests a minute with at most 30 tasks at a time for H3 models, and 10 requests a minute for image models.',
	noTaskId: 'MiniMax accepted the request but gave no task id BaseHalf can read.',
	noTask: 'MiniMax answered without the task.',
	unknownStatus: (status: string) => `MiniMax reports a task status BaseHalf does not know: ${status || 'none'}.`,
	failed: 'MiniMax reports that the video could not be made.',
	cancelled: 'The task was cancelled.',
	notReady: 'The task has no video yet.',
	noVideo: 'MiniMax gives no video address for this task.',
	noFile: 'MiniMax gives no file for the video of this task.'
});

// --- the models --------------------------------------------------------------------------------

/** MiniMax H3 and H3 Max, on the V2 API. */
interface H3Model {
	readonly api: 'v2';
	readonly id: string;
	readonly providerModel: string;
	readonly resolutions: readonly string[];
	readonly defaultResolution: string;
	readonly duration: { readonly min: number; readonly max: number };
	/** `extra.prompt_expansion_mode`, which only H3 Max takes. */
	readonly promptExpansion: boolean;
}

/** The Hailuo models, on the V1 API. */
interface HailuoModel {
	readonly api: 'v1';
	readonly id: string;
	readonly providerModel: string;
	/** The durations each resolution is made in, in the order the resolutions are offered. */
	readonly durations: Readonly<Record<string, readonly number[]>>;
	readonly startFrame: 'optional' | 'required';
	readonly endFrame: boolean;
	/** Resolutions made only from a start frame without an end frame (image to video). */
	readonly startFrameOnly: readonly string[];
}

/** The image models, which `POST /v1/image_generation` answers at once. */
interface ImageModel {
	readonly api: 'image';
	readonly id: string;
	readonly providerModel: string;
	readonly regions: readonly ('cn' | 'intl')[];
	readonly ratios: readonly string[];
	/** The drawing styles of `style`, which only Image-01 Live takes. */
	readonly styles: boolean;
}

/** The speech models, which `POST /v1/t2a_v2` answers at once (D78). */
interface SpeechModel {
	readonly api: 'speech';
	readonly id: string;
	readonly providerModel: string;
	/** The values of `voice_setting.emotion` it takes. */
	readonly emotions: readonly string[];
}

type MiniMaxModel = H3Model | HailuoModel | ImageModel | SpeechModel;

/** The ratios of Image-01, in the order the panel shows them, with the sizes MiniMax makes: 16:9 is 1280 × 720, 21:9 is 1344 × 576. */
const IMAGE_RATIOS = Object.freeze(['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9']);

/** The drawing styles of Image-01 Live, by the catalog's values: MiniMax's own words. */
const STYLES: Readonly<Record<keyof typeof TEXT.image.styles, string>> = Object.freeze({ comic: '漫画', lively: '元气', medieval: '中世纪', watercolor: '水彩' });

/** The emotions every speech model takes; Speech 2.6 also takes `fluent` and `whisper`, which the reference names for 2.6 only. */
const EMOTIONS = Object.freeze(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm']);

const MODELS_IN_ORDER: readonly MiniMaxModel[] = Object.freeze<MiniMaxModel[]>([
	{
		api: 'v2',
		id: 'h3',
		providerModel: 'MiniMax-H3',
		resolutions: ['768P', '2K'],
		defaultResolution: '768P',
		duration: { min: 4, max: 15 },
		promptExpansion: false
	},
	{
		api: 'v2',
		id: 'h3-max',
		providerModel: 'MiniMax-H3-Max',
		resolutions: ['480P', '768P'],
		defaultResolution: '768P',
		duration: { min: 5, max: 15 },
		promptExpansion: true
	},
	{
		api: 'v1',
		id: 'hailuo-2.3',
		providerModel: 'MiniMax-Hailuo-2.3',
		durations: { '768P': [6, 10], '1080P': [6] },
		startFrame: 'optional',
		endFrame: false,
		startFrameOnly: []
	},
	{
		api: 'v1',
		id: 'hailuo-2.3-fast',
		providerModel: 'MiniMax-Hailuo-2.3-Fast',
		durations: { '768P': [6, 10], '1080P': [6] },
		startFrame: 'required',
		endFrame: false,
		startFrameOnly: []
	},
	{
		api: 'v1',
		id: 'hailuo-02',
		providerModel: 'MiniMax-Hailuo-02',
		durations: { '512P': [6, 10], '768P': [6, 10], '1080P': [6] },
		startFrame: 'optional',
		endFrame: true,
		startFrameOnly: ['512P']
	},
	{
		api: 'image',
		id: 'image-01',
		providerModel: 'image-01',
		regions: ['cn', 'intl'],
		ratios: IMAGE_RATIOS,
		styles: false
	},
	{
		api: 'image',
		id: 'image-01-live',
		providerModel: 'image-01-live',
		// The international text-to-image page does not name it.
		regions: ['cn'],
		// 21:9 is Image-01's only.
		ratios: IMAGE_RATIOS.filter(ratio => ratio !== '21:9'),
		styles: true
	},
	{ api: 'speech', id: 'speech-2.8-hd', providerModel: 'speech-2.8-hd', emotions: EMOTIONS },
	{ api: 'speech', id: 'speech-2.8-turbo', providerModel: 'speech-2.8-turbo', emotions: EMOTIONS },
	{ api: 'speech', id: 'speech-2.6-hd', providerModel: 'speech-2.6-hd', emotions: [...EMOTIONS, 'fluent', 'whisper'] },
	{ api: 'speech', id: 'speech-2.6-turbo', providerModel: 'speech-2.6-turbo', emotions: [...EMOTIONS, 'fluent', 'whisper'] }
]);

const MODELS: ReadonlyMap<string, MiniMaxModel> = new Map(MODELS_IN_ORDER.map(model => [model.id, model]));

// --- the catalog entry -------------------------------------------------------------------------

const MIB = 1024 * 1024;
/** "Total request body ≤ 64 MB": counted as 64,000,000 bytes to stay on the safe side. */
const REQUEST_MAX_BYTES = 64_000_000;
const H3_MAX_BYTES: Readonly<Record<MediaKind, number>> = Object.freeze({ image: 30 * MIB, video: 50 * MIB, audio: 15 * MIB });
/** "Less than 20MB"; Hailuo takes frames only. */
const HAILUO_IMAGE_MAX_BYTES = 20 * MIB - 1;
const HAILUO_MAX_BYTES: Readonly<Record<MediaKind, number>> = Object.freeze({ image: HAILUO_IMAGE_MAX_BYTES, video: 0, audio: 0 });
const MAX_REFERENCES = 12;
const REFERENCE_VIDEO_SECONDS: readonly [number, number] = [2, 15];
const REFERENCE_TOTAL_SECONDS = 15;

const NONE = Object.freeze({ min: 0, max: 0 });
const RATIOS = Object.freeze(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const);

const H3_IMAGE_LIMITS = Object.freeze({ imageMinSide: 256, imageMaxSide: 5760, imageAspect: [0.4, 2.5] as const, imageMaxBytes: H3_MAX_BYTES.image });
const H3_REFERENCE_LIMITS = Object.freeze({
	...H3_IMAGE_LIMITS,
	videoSeconds: REFERENCE_VIDEO_SECONDS,
	videoTotalSeconds: REFERENCE_TOTAL_SECONDS,
	videoMaxBytes: H3_MAX_BYTES.video,
	audioSeconds: REFERENCE_VIDEO_SECONDS,
	audioTotalSeconds: REFERENCE_TOTAL_SECONDS,
	audioMaxBytes: H3_MAX_BYTES.audio
});
/** "Short edge > 300px; aspect ratio between 2:5 and 5:2". */
const HAILUO_LIMITS = Object.freeze({ imageMinSide: 301, imageAspect: [0.4, 2.5] as const, imageMaxBytes: HAILUO_IMAGE_MAX_BYTES });
/** The character reference of an image model: "JPG, JPEG, PNG; less than 10MB". */
const IMAGE_REFERENCE_MAX_BYTES = 10 * MIB - 1;
const IMAGE_MODEL_MAX_BYTES: Readonly<Record<MediaKind, number>> = Object.freeze({ image: IMAGE_REFERENCE_MAX_BYTES, video: 0, audio: 0 });
const IMAGE_MODEL_LIMITS = Object.freeze({ imageFormats: ['png', 'jpeg'] as const, imageMaxBytes: IMAGE_REFERENCE_MAX_BYTES });
/** The most images one request makes (`n`). */
const MAX_IMAGES = 9;
/** "Must be less than 10,000 characters." */
const SPEECH_MAX_LENGTH = 9999;
/** The voice the catalog declares: a system voice that both regions' lists name, and the reference among the latest English voices. */
const DEFAULT_VOICE = 'English_Graceful_Lady';
/** The emotion that lets MiniMax choose: nothing is sent for it. */
const AUTO = 'auto';

function modesOf(model: MiniMaxModel): CatalogMode[] {
	if (model.api === 'speech') {
		// The prompt is what the voice says; the mode takes no inputs.
		return [{ id: 'reference', label: TEXT.speech.mode, inputs: { startFrame: 'none', endFrame: 'none', images: NONE, videos: NONE, audios: NONE, source: 'none' }, limits: {} }];
	}
	if (model.api === 'image') {
		return [{
			id: 'reference',
			label: TEXT.modes.reference,
			inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 1 }, videos: NONE, audios: NONE, source: 'none' },
			limits: IMAGE_MODEL_LIMITS
		}];
	}
	if (model.api === 'v1') {
		return [{
			id: 'frames',
			label: TEXT.modes.frames,
			inputs: { startFrame: model.startFrame, endFrame: model.endFrame ? 'optional' : 'none', images: NONE, videos: NONE, audios: NONE, source: 'none' },
			limits: HAILUO_LIMITS
		}];
	}
	return [
		{
			id: 'frames',
			label: TEXT.modes.frames,
			inputs: { startFrame: 'optional', endFrame: 'optional', images: NONE, videos: NONE, audios: NONE, source: 'none' },
			limits: H3_IMAGE_LIMITS
		},
		{
			id: 'reference',
			label: TEXT.modes.reference,
			inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 9 }, videos: { min: 0, max: 3 }, audios: { min: 0, max: 3 }, source: 'none' },
			limits: H3_REFERENCE_LIMITS
		}
	];
}

/**
 * The catalog's value of a resolution as MiniMax writes it: lower case, as
 * every provider's (video providers, "Shared names"), so `768P` is `768p`.
 */
function catalogResolution(resolution: string): string {
	return resolution.toLowerCase();
}

/** MiniMax's own value of each resolution of the catalog, such as `768P` for `768p`. */
const MINIMAX_RESOLUTIONS: ReadonlyMap<string, string> = new Map(MODELS_IN_ORDER
	.flatMap(model => model.api === 'v2' ? model.resolutions : model.api === 'v1' ? Object.keys(model.durations) : [])
	.map(resolution => [catalogResolution(resolution), resolution]));

/** MiniMax's own value of a resolution of the catalog, or undefined for one MiniMax does not make. */
function minimaxResolution(value: ParamValue | undefined): string | undefined {
	return typeof value === 'string' ? MINIMAX_RESOLUTIONS.get(value) : undefined;
}

function resolutionParameter(resolutions: readonly string[], defaultResolution: string): CatalogParameter {
	return {
		name: 'resolution',
		label: TEXT.parameters.resolution,
		kind: 'choice',
		// The shared values with the shared labels (768p, 2K); the request sends MiniMax's own (768P, 2K).
		options: resolutions.map(resolution => ({ value: catalogResolution(resolution), label: /k$/i.test(resolution) ? resolution.toUpperCase() : resolution.toLowerCase() })),
		default: catalogResolution(defaultResolution)
	};
}

function imageParametersOf(model: ImageModel): CatalogParameter[] {
	const labels = TEXT.image;
	const parameters: CatalogParameter[] = [
		{
			name: 'ratio',
			label: TEXT.parameters.ratio,
			tooltip: labels.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: model.ratios.map(value => ({ value, label: value })),
			// MiniMax's default; it has no Adaptive.
			default: '1:1'
		},
		{ name: 'count', label: labels.count, tooltip: labels.countTooltip, kind: 'integer', min: 1, max: MAX_IMAGES, step: 1, default: 1 },
		// The shared name of MiniMax's `prompt_optimizer`, off by default as MiniMax's is.
		{ name: 'prompt_extend', label: TEXT.parameters.promptOptimizer, tooltip: labels.promptOptimizerTooltip, kind: 'boolean', default: false }
	];
	if (model.styles) {
		const names = labels.styles;
		parameters.push(
			{
				name: 'style_type',
				label: labels.style,
				tooltip: labels.styleTooltip,
				kind: 'choice',
				options: (Object.keys(STYLES) as (keyof typeof STYLES)[]).map(value => ({ value, label: names[value] })),
				optional: true
			},
			{ name: 'style_weight', label: labels.styleWeight, tooltip: labels.styleWeightTooltip, kind: 'number', min: 0.1, max: 1, step: 0.1, default: 0.8, advanced: true }
		);
	}
	parameters.push(
		{ name: 'seed', label: labels.seed, tooltip: labels.seedTooltip, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true },
		// The shared name of MiniMax's `aigc_watermark`.
		{ name: 'watermark', label: TEXT.parameters.watermark, tooltip: labels.watermarkTooltip, kind: 'boolean', default: false, advanced: true }
	);
	return parameters;
}

/** A voice effect of `voice_modify`: a whole number from -100 to 100, 0 leaving the voice as it is. */
function voiceEffect(name: string, label: string, tooltip: string): CatalogParameter {
	return { name: `voice_modify.${name}`, label, tooltip, kind: 'integer', min: -100, max: 100, step: 1, default: 0, advanced: true };
}

/**
 * The settings of a speech model (minimax.md, "Speech models"): the voice,
 * the shared Speed, then MiniMax's own fields under their names, the voice
 * effects of `voice_modify` among the advanced ones.
 */
function speechParametersOf(model: SpeechModel): CatalogParameter[] {
	const labels = TEXT.speech;
	return [
		{ name: 'voice', label: labels.voice, kind: 'voice', options: [{ value: DEFAULT_VOICE, ...labels.defaultVoice }], default: DEFAULT_VOICE, listed: true },
		{ name: 'speed', label: labels.speed, tooltip: labels.speedTooltip, kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1 },
		// "(0, 10]": the volume starts at its first step.
		{ name: 'vol', label: labels.volume, tooltip: labels.volumeTooltip, kind: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
		{ name: 'pitch', label: labels.pitch, tooltip: labels.pitchTooltip, kind: 'integer', min: -12, max: 12, step: 1, default: 0 },
		{
			name: 'emotion',
			label: labels.emotion,
			tooltip: labels.emotionTooltip,
			kind: 'choice',
			options: [{ value: AUTO, label: labels.auto }, ...model.emotions.map(value => ({ value, label: labels.emotions[value] }))],
			default: AUTO
		},
		{
			name: 'language_boost',
			label: labels.language,
			tooltip: labels.languageTooltip,
			kind: 'choice',
			options: [{ value: AUTO, label: labels.auto }, ...Object.entries(labels.languages).map(([value, label]) => ({ value, label }))],
			optional: true,
			advanced: true
		},
		voiceEffect('pitch', labels.deepen, labels.deepenTooltip),
		voiceEffect('intensity', labels.stronger, labels.strongerTooltip),
		voiceEffect('timbre', labels.nasal, labels.nasalTooltip),
		{
			name: 'voice_modify.sound_effects',
			label: labels.soundEffect,
			tooltip: labels.soundEffectTooltip,
			kind: 'choice',
			options: Object.entries(labels.soundEffects).map(([value, label]) => ({ value, label })),
			optional: true,
			advanced: true
		}
	];
}

function parametersOf(model: MiniMaxModel): CatalogParameter[] {
	const labels = TEXT.parameters;
	if (model.api === 'speech') {
		return speechParametersOf(model);
	}
	if (model.api === 'image') {
		return imageParametersOf(model);
	}
	if (model.api === 'v1') {
		return [
			resolutionParameter(Object.keys(model.durations), '768P'),
			{ name: 'duration', label: labels.duration, kind: 'integer', unit: 'seconds', min: 6, max: 10, step: 4, default: 6 },
			// The shared name of MiniMax's `prompt_optimizer`.
			{ name: 'prompt_extend', label: labels.promptOptimizer, tooltip: labels.promptOptimizerTooltip, kind: 'boolean', default: true },
			{ name: 'fast_pretreatment', label: labels.fastOptimization, tooltip: labels.fastOptimizationTooltip, kind: 'boolean', default: false, advanced: true }
		];
	}
	const parameters: CatalogParameter[] = [
		resolutionParameter(model.resolutions, model.defaultResolution),
		{
			name: 'ratio',
			label: labels.ratio,
			tooltip: labels.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: [...RATIOS.map(value => ({ value, label: value })), { value: 'adaptive', label: labels.adaptive }],
			default: '16:9',
			// A video made from frames keeps their shape, which MiniMax takes as Adaptive.
			setByStartFrame: true
		},
		{ name: 'duration', label: labels.duration, kind: 'integer', unit: 'seconds', min: model.duration.min, max: model.duration.max, step: 1, default: 5 }
	];
	if (model.promptExpansion) {
		const modes = labels.promptExpansionModes;
		parameters.push({
			name: 'prompt_expansion_mode',
			label: labels.promptExpansion,
			tooltip: labels.promptExpansionTooltip,
			kind: 'choice',
			options: [{ value: 'disabled', label: modes.disabled }, { value: 'balanced', label: modes.balanced }, { value: 'quality', label: modes.quality }],
			default: 'balanced'
		});
	}
	// The shared name of MiniMax's `aigc_watermark`.
	parameters.push({ name: 'watermark', label: labels.watermark, tooltip: labels.watermarkTooltip, kind: 'boolean', default: false, advanced: true });
	return parameters;
}

function catalogModel(model: MiniMaxModel): CatalogModel {
	const text = TEXT.models[model.id];
	if (model.api === 'speech') {
		return {
			id: model.id,
			kind: 'audio',
			makes: 'speech',
			label: text.label,
			description: text.description,
			// MiniMax serves each model under the same id in both regions.
			providerModels: { cn: model.providerModel, intl: model.providerModel },
			prompt: { required: 'always', maxLength: SPEECH_MAX_LENGTH },
			modes: modesOf(model),
			parameters: parametersOf(model),
			outputFormat: 'mp3',
			answersAtOnce: true
		};
	}
	if (model.api === 'image') {
		return {
			id: model.id,
			kind: 'image',
			label: text.label,
			description: text.description,
			providerModels: Object.fromEntries(model.regions.map(region => [region, model.providerModel])),
			prompt: { required: 'always', maxLength: 1500 },
			modes: modesOf(model),
			parameters: parametersOf(model),
			// MiniMax states no format; its guides save the images as JPEG.
			outputFormat: 'jpeg',
			answersAtOnce: true
		};
	}
	return {
		id: model.id,
		kind: 'video',
		label: text.label,
		description: text.description,
		// MiniMax serves each model under the same id in both regions.
		providerModels: { cn: model.providerModel, intl: model.providerModel },
		prompt: model.api === 'v2' ? { required: 'always', maxLength: 7000 } : { required: 'withoutMedia', maxLength: 2000 },
		modes: modesOf(model),
		parameters: parametersOf(model)
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'minimax',
	label: TEXT.provider,
	regions: [
		{ id: 'cn', label: TEXT.regions.cn, baseUrl: 'https://api.minimax.cn', console: 'https://platform.minimax.cn/user-center/basic-information/interface-key' },
		{ id: 'intl', label: TEXT.regions.intl, baseUrl: 'https://api.minimax.io', console: 'https://platform.minimax.io/user-center/basic-information/interface-key' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODELS_IN_ORDER.map(catalogModel)
});

// --- rules -------------------------------------------------------------------------------------

function modelOf(id: string): MiniMaxModel {
	const model = MODELS.get(id);
	if (!model) {
		throw rejected(`MiniMax has no model "${id}".`);
	}
	return model;
}

function h3Rules(model: H3Model, request: CheckRequest, counts: PlannedCounts): string[] {
	const label = TEXT.models[model.id].label;
	const problems: string[] = [];
	if (request.mode === 'frames') {
		const framed = counts.startFrame || counts.endFrame;
		// Text to video needs a ratio; with frames the ratio arrives unset, and Adaptive is sent.
		if (!framed && request.params.ratio === 'adaptive') {
			problems.push(TEXT.needsRatio(label));
		}
	} else if (request.mode === 'reference') {
		const references = counts.images + counts.videos + counts.audios;
		if (references === 0) {
			problems.push(TEXT.referencesNeedInput(label));
		} else if (references > MAX_REFERENCES) {
			problems.push(TEXT.tooManyReferences(label, references));
		}
	}
	if (request.params.watermark === true && request.region !== 'cn') {
		problems.push(TEXT.watermarkChinaOnly);
	}
	return problems;
}

function hailuoRules(model: HailuoModel, request: CheckRequest, counts: PlannedCounts): string[] {
	const label = TEXT.models[model.id].label;
	const problems: string[] = [];
	const resolution = minimaxResolution(request.params.resolution);
	if (resolution === undefined) {
		// The declarations' checks refuse a value the model does not offer.
		return problems;
	}
	const durations = model.durations[resolution] ?? [];
	if (!durations.includes(Number(request.params.duration))) {
		problems.push(TEXT.durationAt(label, resolution, durations.join(' or ')));
	}
	if (model.startFrameOnly.includes(resolution)) {
		if (!counts.startFrame) {
			problems.push(TEXT.startFrameOnly(label, resolution));
		} else if (counts.endFrame) {
			problems.push(TEXT.noEndFrameAt(label, resolution));
		}
	}
	if (request.params.fast_pretreatment === true && counts.endFrame) {
		problems.push(TEXT.fastWithEndFrame(label));
	}
	return problems;
}

/** The formats the declarations let through that MiniMax does not take. */
function formatProblems(items: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	for (const item of items) {
		if (item.kind === 'audio' && item.facts.format === 'm4a') {
			problems.push(TEXT.m4aAudio(item.label));
		}
	}
	return problems;
}

/** The rules of an image model that its declarations cannot say. */
function imageRules(request: CheckRequest): string[] {
	// Only the China pages document `aigc_watermark`.
	return request.params.watermark === true && request.region !== 'cn' ? [TEXT.watermarkChinaOnly] : [];
}

async function check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
	const model = modelOf(request.model);
	if (model.api === 'speech') {
		// No rule joins the settings of a speech model; its declarations say the rest.
		return { problems: [] };
	}
	if (model.api === 'image') {
		return { problems: imageRules(request) };
	}
	const counts = countsOf(request.inputs);
	const problems = model.api === 'v2' ? h3Rules(model, request, counts) : hailuoRules(model, request, counts);
	const measured = await measureItems(request.inputs, media);
	problems.push(...formatProblems(measured));
	return { problems };
}

// --- errors ------------------------------------------------------------------------------------

/** MiniMax's codes (its error code page), by what they mean for a request. */
const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([1002, 1039, 1041, 2045, 2056]);
const AUTH_CODES: ReadonlySet<number> = new Set([1004, 2049]);
/** Insufficient balance, insufficient credit, and a usage limit reached with credit auto consumption off. */
const BALANCE_CODES: ReadonlySet<number> = new Set([1008, 2053, 2067]);
/** Unknown error, timeout, internal error, system error: the request may have been carried out. */
const SERVER_CODES: ReadonlySet<number> = new Set([1000, 1001, 1024, 1033]);
/** Sensitive input or output: a task that failed. */
const SENSITIVE_CODES: ReadonlySet<number> = new Set([1026, 1027]);
const INVALID_PARAMETERS_CODE = 2013;

/** What a `base_resp` answers: a create of a task or an image, a query, a file, an upload, a speech request, or the list of voices. */
type V1Call = 'create' | 'query' | 'retrieve' | 'upload' | 'speech' | 'voices';

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function codeOf(value: unknown): number | undefined {
	const code = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined;
	return code !== undefined && Number.isInteger(code) ? code : undefined;
}

/** MiniMax's words with its code, as its own messages end: `insufficient balance (1008)`. */
function withCode(message: string | undefined, code: number): string {
	if (!message) {
		return TEXT.errorCode(code);
	}
	return message.endsWith(`(${code})`) ? message : `${message} (${code})`;
}

/** The `base_resp` of a V1 or file answer, when it has one. */
function baseRespOf(object: Record<string, unknown>): { readonly code: number; readonly message: string | undefined } | undefined {
	const base = object.base_resp;
	if (!isRecord(base)) {
		return undefined;
	}
	const code = codeOf(base.status_code);
	return code === undefined ? undefined : { code, message: textOf(base.status_msg) };
}

/** The limits a rate limit of a call names: the speech models' for a speech request, none for the list of voices, whose limit MiniMax does not state. */
function rateLimitsOf(call: V1Call): string {
	return call === 'speech' ? TEXT.speech.rateLimits : call === 'voices' ? '' : TEXT.rateLimits;
}

/** The failure a nonzero code of `base_resp` stands for, which MiniMax answers with HTTP 200. */
function codeFailure(code: number, message: string | undefined, call: V1Call): ProviderFailure {
	const words = withCode(message, code);
	if (RATE_LIMIT_CODES.has(code)) {
		return new ProviderFailure('rateLimited', `${words} ${rateLimitsOf(call)}`.trim());
	}
	if (AUTH_CODES.has(code)) {
		return new ProviderFailure('auth', words);
	}
	if (BALANCE_CODES.has(code)) {
		return new ProviderFailure('balance', words);
	}
	if (SERVER_CODES.has(code)) {
		return call === 'create' || call === 'speech' ? unknownOutcome(words) : new ProviderFailure('network', words);
	}
	if (code === INVALID_PARAMETERS_CODE && call === 'query') {
		// The task id is the one parameter of a query.
		return new ProviderFailure('notFound', words);
	}
	// A speech request says what its codes mean: sensitive text, a voice MiniMax does not know, one the key may not use.
	const meaning = call === 'speech' ? TEXT.speech.codes[code] : undefined;
	return rejected(meaning ? `${words} ${meaning}` : words);
}

/**
 * A failure of an HTTP answer to a speech request or to the list of voices,
 * whose rate limit names the limits of that call: `readError`, which does
 * not know the call, names those of the video and image models.
 */
function withLimitsOf(error: unknown, call: V1Call): unknown {
	if (error instanceof ProviderFailure && error.code === 'rateLimited' && error.message.includes(TEXT.rateLimits)) {
		return new ProviderFailure('rateLimited', error.message.replace(TEXT.rateLimits, rateLimitsOf(call)).replace(/\s{2,}/g, ' ').trim(), error.status);
	}
	return error;
}

function throwOnBaseResp(object: Record<string, unknown>, call: V1Call): void {
	const base = baseRespOf(object);
	if (base && base.code !== 0) {
		throw codeFailure(base.code, base.message, call);
	}
}

/**
 * Reads an error answer: V2's `{error: {type, message}}`, whose message ends
 * with MiniMax's code, or a `base_resp`. The codes refine a 4xx answer only,
 * so that a server error leaves a create's outcome unknown.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const record = isRecord(body) ? body : undefined;
	const error = record && isRecord(record.error) ? record.error : undefined;
	const base = record && isRecord(record.base_resp) ? record.base_resp : undefined;
	const message = textOf(error?.message) ?? textOf(base?.status_msg) ?? readCommonError(body)?.message;
	const code = codeOf(base?.status_code) ?? codeOf(/\((\d{4,5})\)\s*$/.exec(message ?? '')?.[1]);
	if (message === undefined && code === undefined) {
		return undefined;
	}
	const words = code !== undefined ? withCode(message, code) : message ?? '';
	if (status < 400 || status >= 500 || status === 408) {
		return { message: words };
	}
	const type = textOf(error?.type);
	if (/invalid task_?id/i.test(words)) {
		return { message: words, code: 'notFound' };
	}
	if (type === 'insufficient_balance_error' || (code !== undefined && BALANCE_CODES.has(code))) {
		return { message: words, code: 'balance' };
	}
	if (status === 429 || type === 'rate_limit_error' || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
		return { message: `${words} ${TEXT.rateLimits}`, code: 'rateLimited' };
	}
	if (type === 'authorized_error' || (code !== undefined && AUTH_CODES.has(code))) {
		return { message: words, code: 'auth' };
	}
	return { message: words };
}

/**
 * An id of an answer as text. MiniMax's ids are 64-bit numbers, sometimes
 * sent as JSON numbers: then the digits are read from the answer's text,
 * since a number beyond 2^53 loses them.
 */
function idOf(answer: HttpAnswer, value: unknown, field: string): string | undefined {
	if (typeof value === 'string') {
		return textOf(value);
	}
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
		const digits = new RegExp(`"${field}"\\s*:\\s*(\\d+)`).exec(answer.body.toString('utf8'))?.[1];
		return digits ?? (Number.isSafeInteger(value) ? String(value) : undefined);
	}
	return undefined;
}

// --- addresses ---------------------------------------------------------------------------------

const V2_CREATE = '/v2/video_generation';
const V2_QUERY = '/v2/query/video_generation';
const IMAGE_CREATE = '/v1/image_generation';
const V1_CREATE = '/v1/video_generation';
const V1_QUERY = '/v1/query/video_generation';
const V1_RETRIEVE = '/v1/files/retrieve';
const UPLOAD = '/v1/files/upload';
const SPEECH_CREATE = '/v1/t2a_v2';
const VOICES = '/v1/get_voice';

/** The path of a V2 task under the path of its kind of request. */
function v2TaskPath(base: string, remoteId: string): string {
	return `${base}/${encodeURIComponent(remoteId)}`;
}

// --- media -------------------------------------------------------------------------------------

const IMAGE_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });
const FORMATS_BY_KIND: Readonly<Record<MediaKind, ReadonlySet<MediaFormat>>> = Object.freeze({
	image: new Set<MediaFormat>(['png', 'jpeg', 'webp']),
	video: new Set<MediaFormat>(['mp4', 'mov']),
	audio: new Set<MediaFormat>(['wav', 'mp3'])
});
const EXTENSIONS: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp', mp4: 'mp4', mov: 'mov', wav: 'wav', mp3: 'mp3' });

/** An input read whole, with the format its header shows. */
interface Prepared {
	readonly item: PlannedItem;
	readonly kind: MediaKind;
	readonly read: ReadMedia;
	readonly format: MediaFormat;
}

function kindOf(item: PlannedItem): MediaKind {
	if (item.slot === 'source') {
		throw rejected(TEXT.noSource(item.label));
	}
	return item.slot === 'video' ? 'video' : item.slot === 'audio' ? 'audio' : 'image';
}

async function prepare(item: PlannedItem, maxBytes: Readonly<Record<MediaKind, number>>): Promise<Prepared> {
	const kind = kindOf(item);
	const read = await readMedia(item.media, maxBytes[kind], item.label);
	const { format } = await measure(bufferSource(read.bytes));
	if (!format || !FORMATS_BY_KIND[kind].has(format)) {
		throw rejected(TEXT.wrongFormat(item.label));
	}
	return { item, kind, read, format };
}

/** An input as a data URL of the format its header shows. */
function inlineUrl(entry: Prepared): string {
	return dataUrlOf(entry.read, IMAGE_TYPES[entry.format] ?? MEDIA_MIME_TYPES[entry.format]);
}

function inlineLength(entry: Prepared): number {
	return `data:${IMAGE_TYPES[entry.format] ?? MEDIA_MIME_TYPES[entry.format]};base64,`.length + base64Length(entry.read.bytes.byteLength);
}

/** The name an upload gets: its slot and its format, such as `reference-video-1.mp4`. */
function uploadName(entry: Prepared): string {
	const slot = entry.item.slot;
	const base = slot === 'startFrame' ? 'start-frame' : slot === 'endFrame' ? 'end-frame' : `reference-${slot}-${entry.item.index + 1}`;
	return `${base}.${EXTENSIONS[entry.format] ?? 'bin'}`;
}

/** Uploads an input for video generation and answers its `mm_file://` address. */
async function upload(http: ProviderHttp, entry: Prepared): Promise<string> {
	let answer: HttpAnswer;
	try {
		answer = await http.request({
			method: 'POST',
			path: UPLOAD,
			body: {
				kind: 'form',
				parts: [
					{ name: 'purpose', value: 'video_generation_input' },
					{ name: 'file', file: { bytes: entry.read.bytes, fileName: uploadName(entry), contentType: MEDIA_MIME_TYPES[entry.format] } }
				]
			}
		});
	} catch (error) {
		if (error instanceof ProviderFailure) {
			// Nothing was created yet: say which input MiniMax refused.
			throw new ProviderFailure(error.code === 'invalidResponse' ? 'rejected' : error.code, TEXT.uploadFailed(entry.item.label, error.message), error.status);
		}
		throw error;
	}
	let object: Record<string, unknown>;
	try {
		object = answer.object();
	} catch {
		throw rejected(TEXT.uploadFailed(entry.item.label, TEXT.uploadUnreadable));
	}
	const base = baseRespOf(object);
	if (base && base.code !== 0) {
		const failure = codeFailure(base.code, base.message, 'upload');
		throw new ProviderFailure(failure.code, TEXT.uploadFailed(entry.item.label, failure.message));
	}
	const id = idOf(answer, isRecord(object.file) ? object.file.file_id : undefined, 'file_id');
	if (!id) {
		throw rejected(TEXT.uploadFailed(entry.item.label, TEXT.uploadUnreadable));
	}
	return `mm_file://${id}`;
}

// --- requests ----------------------------------------------------------------------------------

const ROLES: Readonly<Record<Exclude<PlannedItem['slot'], 'source'>, string>> = Object.freeze({
	startFrame: 'first_frame',
	endFrame: 'last_frame',
	image: 'reference_image',
	video: 'reference_video',
	audio: 'reference_audio'
});

function h3Body(model: H3Model, request: SubmitRequest, resolution: string, entries: readonly Prepared[], urlOf: (entry: Prepared) => string): Record<string, unknown> {
	const content: unknown[] = [{ type: 'text', text: request.prompt }];
	for (const entry of entries) {
		const role = ROLES[entry.item.slot as Exclude<PlannedItem['slot'], 'source'>];
		const type = entry.kind === 'image' ? 'image_url' : entry.kind === 'video' ? 'video_url' : 'audio_url';
		content.push({ type, [type]: { url: urlOf(entry) }, role });
	}
	const params = request.params;
	return {
		model: model.providerModel,
		content,
		resolution,
		duration: params.duration,
		// A start frame sets the shape: the ratio arrives unset, and MiniMax takes Adaptive.
		ratio: params.ratio ?? 'adaptive',
		...(model.promptExpansion ? { extra: { prompt_expansion_mode: params.prompt_expansion_mode } } : {}),
		// Only the China create page documents the watermark.
		...(request.region === 'cn' ? { aigc_watermark: params.watermark === true } : {})
	};
}

async function submitH3(model: H3Model, request: SubmitRequest, resolution: string, http: ProviderHttp): Promise<string> {
	const entries: Prepared[] = [];
	for (const item of plannedItems(request.inputs)) {
		entries.push(await prepare(item, H3_MAX_BYTES));
	}
	const urls = new Map<Prepared, string>();
	// Videos and audio always travel as uploads; images inline, unless the body would be too large.
	for (const entry of entries) {
		if (entry.kind !== 'image') {
			urls.set(entry, await upload(http, entry));
		}
	}
	const inline = () => entries.filter(entry => entry.kind === 'image' && !urls.has(entry));
	const size = () => Buffer.byteLength(JSON.stringify(h3Body(model, request, resolution, entries, entry => urls.get(entry) ?? '')), 'utf8')
		+ inline().reduce((sum, entry) => sum + inlineLength(entry), 0);
	while (size() > REQUEST_MAX_BYTES) {
		const largest = inline().sort((a, b) => b.read.bytes.byteLength - a.read.bytes.byteLength)[0];
		if (!largest) {
			throw rejected(TEXT.requestTooLarge);
		}
		urls.set(largest, await upload(http, largest));
	}
	const bytes = Buffer.from(JSON.stringify(h3Body(model, request, resolution, entries, entry => urls.get(entry) ?? inlineUrl(entry))), 'utf8');
	if (bytes.byteLength > REQUEST_MAX_BYTES) {
		throw rejected(TEXT.requestTooLarge);
	}
	const answer = await http.create({ method: 'POST', path: V2_CREATE, body: { kind: 'bytes', bytes, contentType: 'application/json' } });
	const id = idOf(answer, answer.object().task_id, 'task_id');
	if (!id) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return id;
}

async function submitHailuo(model: HailuoModel, request: SubmitRequest, resolution: string, http: ProviderHttp): Promise<string> {
	const frames = new Map<PlannedItem['slot'], string>();
	for (const item of plannedItems(request.inputs)) {
		if (item.slot !== 'startFrame' && item.slot !== 'endFrame') {
			// No mode of a Hailuo model declares references or a source.
			throw rejected(TEXT.framesOnly(item.label));
		}
		frames.set(item.slot, inlineUrl(await prepare(item, HAILUO_MAX_BYTES)));
	}
	const params = request.params;
	const start = frames.get('startFrame');
	const end = frames.get('endFrame');
	const body: Record<string, unknown> = {
		model: model.providerModel,
		...(request.prompt.trim() ? { prompt: request.prompt } : {}),
		...(start !== undefined ? { first_frame_image: start } : {}),
		...(end !== undefined ? { last_frame_image: end } : {}),
		prompt_optimizer: params.prompt_extend === true,
		// The first and last frame request takes no fast pretreatment.
		...(end === undefined ? { fast_pretreatment: params.fast_pretreatment === true } : {}),
		duration: params.duration,
		resolution
	};
	const answer = await http.create({ method: 'POST', path: V1_CREATE, body: { kind: 'json', value: body } });
	const object = answer.object();
	throwOnBaseResp(object, 'create');
	const id = idOf(answer, object.task_id, 'task_id');
	if (!id) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return id;
}

/**
 * Sends an image request once and answers its images: the files MiniMax
 * answered, then one refusal for each image its content check withheld.
 */
async function submitImage(model: ImageModel, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	if (!model.regions.includes(request.region as ImageModel['regions'][number])) {
		throw rejected(TEXT.notOffered(TEXT.models[model.id].label));
	}
	let subject: string | undefined;
	for (const item of plannedItems(request.inputs)) {
		if (item.slot !== 'image' || subject !== undefined) {
			// The one mode takes one reference image and nothing else.
			throw rejected(TEXT.imageReferenceOnly(item.label));
		}
		subject = inlineUrl(await prepare(item, IMAGE_MODEL_MAX_BYTES));
	}
	const params = request.params;
	const style = model.styles && typeof params.style_type === 'string' ? STYLES[params.style_type as keyof typeof STYLES] : undefined;
	const body: Record<string, unknown> = {
		model: model.providerModel,
		prompt: request.prompt,
		aspect_ratio: params.ratio,
		n: params.count,
		prompt_optimizer: params.prompt_extend === true,
		// The images themselves: at about 1K, nine of them make a small answer.
		response_format: 'base64',
		...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
		...(subject !== undefined ? { subject_reference: [{ type: 'character', image_file: subject }] } : {}),
		...(style !== undefined ? { style: { style_type: style, style_weight: params.style_weight } } : {}),
		// Only the China pages document the watermark.
		...(request.region === 'cn' ? { aigc_watermark: params.watermark === true } : {})
	};
	const answer = await http.create({ method: 'POST', path: IMAGE_CREATE, body: { kind: 'json', value: body } });
	const object = answer.object();
	throwOnBaseResp(object, 'create');
	return { outputs: imageOutputs(object) };
}

/** The images of an answer in MiniMax's order, then the ones its content check withheld. */
function imageOutputs(object: Record<string, unknown>): OutputLocation[] {
	const data = isRecord(object.data) ? object.data : undefined;
	const files = Array.isArray(data?.image_base64) ? data.image_base64 : [];
	const addresses = Array.isArray(data?.image_urls) ? data.image_urls : [];
	const withheld = Math.min(MAX_IMAGES, codeOf(isRecord(object.metadata) ? object.metadata.failed_count : undefined) ?? 0);
	if (!data && !withheld) {
		throw unknownOutcome(TEXT.noImages);
	}
	return [
		...files.map((file): OutputLocation => typeof file === 'string' && file ? { bytes: Buffer.from(file, 'base64') } : { refused: TEXT.unreadableImage }),
		...addresses.map((address): OutputLocation => typeof address === 'string' && address ? { url: address } : { refused: TEXT.unreadableImage }),
		...Array.from({ length: withheld }, (): OutputLocation => ({ refused: TEXT.imageBlocked }))
	];
}

/** The voice effects of `voice_modify`, when one of them is set: the three numbers, and the sound effect when one is chosen. */
function voiceModifyOf(params: Params): Record<string, unknown> | undefined {
	const effect = (name: string) => typeof params[`voice_modify.${name}`] === 'number' ? params[`voice_modify.${name}`] as number : 0;
	const [pitch, intensity, timbre] = [effect('pitch'), effect('intensity'), effect('timbre')];
	const sound = params['voice_modify.sound_effects'];
	if (!pitch && !intensity && !timbre && typeof sound !== 'string') {
		return undefined;
	}
	return { pitch, intensity, timbre, ...(typeof sound === 'string' ? { sound_effects: sound } : {}) };
}

/**
 * The body of a speech request (minimax.md, "Speech models"): the prompt as
 * the text, the voice and MiniMax's settings of it, and MP3 at MiniMax's best
 * as hex. The parameters arrive checked and with their defaults.
 */
function speechBody(model: SpeechModel, request: SubmitRequest): Record<string, unknown> {
	const params = request.params;
	const emotion = params.emotion !== AUTO ? params.emotion : undefined;
	const voiceModify = voiceModifyOf(params);
	return {
		model: model.providerModel,
		text: request.prompt,
		stream: false,
		// The file itself in the answer, rather than an address that expires in 24 hours.
		output_format: 'hex',
		voice_setting: {
			voice_id: params.voice,
			speed: params.speed,
			vol: params.vol,
			pitch: params.pitch,
			...(emotion !== undefined ? { emotion } : {})
		},
		// The highest sample rate and bitrate MiniMax offers, in its default one channel.
		audio_setting: { format: 'mp3', sample_rate: 44100, bitrate: 256000, channel: 1 },
		...(params.language_boost !== undefined ? { language_boost: params.language_boost } : {}),
		...(voiceModify ? { voice_modify: voiceModify } : {})
	};
}

/** The speech of an answer: the hex of an MP3, or an address as a relay may answer. */
function speechOutput(object: Record<string, unknown>): OutputLocation {
	const audio = isRecord(object.data) && typeof object.data.audio === 'string' ? object.data.audio.trim() : '';
	if (!audio) {
		throw unknownOutcome(TEXT.speech.noSpeech);
	}
	if (/^https?:\/\//i.test(audio)) {
		return { url: audio };
	}
	if (audio.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(audio)) {
		return { refused: TEXT.speech.unreadable };
	}
	return { bytes: Buffer.from(audio, 'hex'), format: 'mp3' };
}

/** Sends a speech request once and answers its speech, which MiniMax answers with the request. */
async function submitSpeech(model: SpeechModel, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	const [item] = plannedItems(request.inputs);
	if (item) {
		// The one mode takes no inputs.
		throw rejected(TEXT.speech.noInputs(item.label));
	}
	let answer: HttpAnswer;
	try {
		answer = await http.create({ method: 'POST', path: SPEECH_CREATE, body: { kind: 'json', value: speechBody(model, request) } });
	} catch (error) {
		throw withLimitsOf(error, 'speech');
	}
	const object = answer.object();
	throwOnBaseResp(object, 'speech');
	return { outputs: [speechOutput(object)] };
}

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const model = modelOf(request.model);
	const label = TEXT.models[model.id].label;
	if (model.api === 'speech') {
		return submitSpeech(model, request, http);
	}
	if (model.api === 'image') {
		return submitImage(model, request, http);
	}
	if (request.region !== 'cn' && request.region !== 'intl') {
		throw rejected(TEXT.notOffered(label));
	}
	// MiniMax's own value, such as `768P`, found before anything is uploaded.
	const resolution = minimaxResolution(request.params.resolution);
	if (resolution === undefined) {
		throw rejected(TEXT.noResolution(label, String(request.params.resolution)));
	}
	return model.api === 'v2' ? submitH3(model, request, resolution, http) : submitHailuo(model, request, resolution, http);
}

// --- tasks -------------------------------------------------------------------------------------

async function readH3Task(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	const task = (await http.request({ method: 'GET', path: v2TaskPath(V2_QUERY, ref.remoteId) })).object().task;
	if (!isRecord(task)) {
		throw unreadable(TEXT.noTask);
	}
	return task;
}

function taskError(task: Record<string, unknown>): string | undefined {
	const error = isRecord(task.error) ? task.error : undefined;
	const message = textOf(error?.message);
	const code = codeOf(error?.code);
	return code !== undefined ? withCode(message, code) : message;
}

function h3State(task: Record<string, unknown>): PollState {
	const status = textOf(task.status)?.toLowerCase() ?? '';
	switch (status) {
		case 'queued':
			return { state: 'pending' };
		case 'running':
			return { state: 'running' };
		case 'succeeded': {
			const url = isRecord(task.content) ? textOf(task.content.url) : undefined;
			return url ? { state: 'succeeded', videoUrl: url } : { state: 'succeeded' };
		}
		case 'failed':
			return { state: 'failed', message: taskError(task) ?? TEXT.failed };
		case 'cancelled':
			return { state: 'cancelled', message: taskError(task) ?? TEXT.cancelled };
		default:
			throw unreadable(TEXT.unknownStatus(status));
	}
}

async function readHailuoTask(ref: TaskRef, http: ProviderHttp): Promise<{ readonly answer: HttpAnswer; readonly object: Record<string, unknown> }> {
	const answer = await http.request({ method: 'GET', path: V1_QUERY, query: { task_id: ref.remoteId } });
	return { answer, object: answer.object() };
}

function hailuoState(object: Record<string, unknown>): PollState {
	const base = baseRespOf(object);
	const status = textOf(object.status)?.toLowerCase() ?? '';
	if (base && base.code !== 0) {
		// A code about the task's content, or with a task that failed, says why it failed; any other is about the query.
		if (SENSITIVE_CODES.has(base.code) || status === 'fail') {
			return { state: 'failed', message: withCode(base.message, base.code) };
		}
		throw codeFailure(base.code, base.message, 'query');
	}
	switch (status) {
		case 'preparing':
		case 'queueing':
			return { state: 'pending' };
		case 'processing':
			return { state: 'running' };
		case 'success':
			// The video is a file whose address `videoLocation` asks for.
			return { state: 'succeeded' };
		case 'fail':
			return { state: 'failed', message: TEXT.failed };
		default:
			throw unreadable(TEXT.unknownStatus(status));
	}
}

/** The video model of a task; an image or a speech model answered with its files and has no task to ask about. */
function videoModelOf(ref: TaskRef): H3Model | HailuoModel {
	const model = modelOf(ref.model);
	if (model.api === 'image') {
		throw rejected(TEXT.noImageTask(TEXT.models[model.id].label));
	}
	if (model.api === 'speech') {
		throw rejected(TEXT.speech.noTask(TEXT.models[model.id].label));
	}
	return model;
}

async function poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
	const model = videoModelOf(ref);
	return model.api === 'v2' ? h3State(await readH3Task(ref, http)) : hailuoState((await readHailuoTask(ref, http)).object);
}

async function videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
	const model = videoModelOf(ref);
	if (model.api === 'v2') {
		const state = h3State(await readH3Task(ref, http));
		if (state.state !== 'succeeded') {
			throw unreadable(TEXT.notReady);
		}
		if (!state.videoUrl) {
			throw unreadable(TEXT.noVideo);
		}
		return { url: state.videoUrl };
	}
	const { answer, object } = await readHailuoTask(ref, http);
	if (hailuoState(object).state !== 'succeeded') {
		throw unreadable(TEXT.notReady);
	}
	const fileId = idOf(answer, object.file_id, 'file_id');
	if (!fileId) {
		throw unreadable(TEXT.noFile);
	}
	const file = (await http.request({ method: 'GET', path: V1_RETRIEVE, query: { file_id: fileId } })).object();
	throwOnBaseResp(file, 'retrieve');
	const url = isRecord(file.file) ? textOf(file.file.download_url) : undefined;
	if (!url) {
		throw unreadable(TEXT.noVideo);
	}
	return { url };
}

async function cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean> {
	const model = modelOf(ref.model);
	if (model.api === 'v1' || model.api === 'image' || model.api === 'speech') {
		// The V1 API cannot cancel a task, and an image or a speech model answered with its files.
		return false;
	}
	// Only a queued task can be cancelled; a DELETE on a task that ended deletes its record.
	if (h3State(await readH3Task(ref, http)).state !== 'pending') {
		return false;
	}
	let answer: HttpAnswer;
	try {
		answer = await http.requestOnce({ method: 'DELETE', path: v2TaskPath(V2_CREATE, ref.remoteId) });
	} catch (error) {
		if (error instanceof ProviderFailure && (error.code === 'rejected' || error.code === 'notFound')) {
			// The task started, or ended, in the meantime.
			return false;
		}
		throw error;
	}
	let action: unknown;
	try {
		action = answer.object().action;
	} catch {
		// MiniMax took the request; its answer says nothing more.
		return true;
	}
	return action !== 'deleted';
}

// --- voices ------------------------------------------------------------------------------------

/** The voices of one list of `get_voice`'s answer: each its `voice_id`, named by its `voice_name`, described by the texts of its `description`. */
function voicesIn(list: unknown, own: boolean): ListedVoice[] {
	const voices: ListedVoice[] = [];
	for (const entry of Array.isArray(list) ? list : []) {
		if (!isRecord(entry) || typeof entry.voice_id !== 'string') {
			continue;
		}
		const texts = Array.isArray(entry.description) ? entry.description : [entry.description];
		const description = texts.map(textOf).filter((text): text is string => text !== undefined).join(' ');
		// A cloned or designed voice has no name; the service names it by its id.
		voices.push({ id: entry.voice_id, label: textOf(entry.voice_name) ?? '', ...(description ? { description } : {}), own });
	}
	return voices;
}

/**
 * The voices of a speech model (minimax.md, "Speech models", "Voices"): one
 * `get_voice` of every type, whose cloned and designed voices are the
 * account's, then MiniMax's system voices. MiniMax gives no samples.
 */
async function listVoices(request: VoicesRequest, http: ProviderHttp, limit: number): Promise<ModuleVoices> {
	const model = modelOf(request.model);
	if (model.api !== 'speech') {
		throw rejected(TEXT.speech.notSpeech(TEXT.models[model.id].label));
	}
	let answer: HttpAnswer;
	try {
		answer = await http.request({ method: 'POST', path: VOICES, body: { kind: 'json', value: { voice_type: 'all' } } });
	} catch (error) {
		throw withLimitsOf(error, 'voices');
	}
	const object = answer.object();
	throwOnBaseResp(object, 'voices');
	const voices = [...voicesIn(object.voice_cloning, true), ...voicesIn(object.voice_generation, true), ...voicesIn(object.system_voice, false)];
	return voices.length > limit ? { voices: voices.slice(0, limit), truncated: true } : { voices };
}

/**
 * The names of the inputs in a prompt (D74; MiniMax, "Names in the prompt").
 * The V2 guide calls its references "reference image 1", "reference video 1",
 * and "reference audio 1", 参考图1, 参考视频1, and 参考音频1, counted by kind
 * in the order of `content`. The frames, the V1 Hailuo models, and the image
 * models have no names there and take the shared ones; a speech model takes
 * no inputs to name.
 */
function writePrompt(prompt: readonly PromptPart[], request: PromptContext): string {
	const language = promptLanguage(prompt);
	const zh = language === 'zh';
	const v2 = MODELS_IN_ORDER.some(model => model.id === request.model && model.api === 'v2');
	return writePromptNames(prompt, input => {
		if (!v2 || input.index === undefined) {
			return sharedPromptName(input, language);
		}
		const number = referenceNumber(input);
		switch (input.input) {
			case 'images': return zh ? `参考图${number}` : `reference image ${number}`;
			case 'videos': return zh ? `参考视频${number}` : `reference video ${number}`;
			default: return zh ? `参考音频${number}` : `reference audio ${number}`;
		}
	});
}

export const MINIMAX: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
	readError,
	writePrompt,
	check,
	submit,
	poll,
	videoLocation,
	cancel,
	listVoices
});
