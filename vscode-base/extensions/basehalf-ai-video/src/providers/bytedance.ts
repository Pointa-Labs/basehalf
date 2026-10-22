/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, measureItems } from './check.ts';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import type { ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, measure, plannedItems, readMedia, type MediaFormat, type MediaInspector } from './media.ts';
import type { AnsweredAtOnce, OutputLocation, ProviderModule, VideoLocation } from './module.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, CheckResult, CountSlot, OutputFormat, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * ByteDance's models on Volcengine Ark (China) and BytePlus ModelArk
 * (international), which serve the same API at two base URLs with their own
 * keys and model ids (providers, "ByteDance (Seedance, Seedream)"). The
 * Seedance video models run as tasks; their images and audio travel as data
 * URLs, and reference videos are not offered, since the API takes them only
 * as public URLs or asset ids. The Seedream image models answer the request
 * with the images, as addresses on the provider's file host; their reference
 * images travel as data URLs.
 */

type RegionId = 'cn' | 'intl';
type Resolution = '480p' | '720p' | '1080p' | '4k';
/** A resolution of an image, as the catalog's shared values name it. */
type Level = '1k' | '1.5k' | '2k' | '3k' | '4k';

// --- the provider's English texts, in one place so they can be translated -----------------------

const RESOLUTION_LABELS: Readonly<Record<Resolution, string>> = Object.freeze({ '480p': '480p', '720p': '720p', '1080p': '1080p', '4k': '4K' });

const MODEL_TEXTS: Readonly<Record<string, { readonly label: string; readonly description: string }>> = Object.freeze({
	'seedance-2.5': { label: 'Seedance 2.5', description: 'Up to 30 seconds with sound, from a prompt, frames, or up to 30 images and 10 audio clips.' },
	'seedance-2.0': { label: 'Seedance 2.0', description: 'Up to 15 seconds with sound and up to 4K, from a prompt, frames, or up to 9 images and 3 audio clips.' },
	'seedance-2.0-fast': { label: 'Seedance 2.0 Fast', description: 'A faster Seedance 2.0 at 480p and 720p.' },
	'seedance-2.0-mini': { label: 'Seedance 2.0 Mini', description: 'Seedance 2.0 at 480p and 720p, up to 15 seconds with sound.' },
	'seedance-1.5-pro': { label: 'Seedance 1.5 Pro', description: 'Up to 12 seconds with sound, from a prompt or frames. BytePlus is retiring it for Seedance 2.0 Mini.' },
	'seedance-1.0-pro': { label: 'Seedance 1.0 Pro', description: 'Up to 12 seconds without sound, from a prompt or frames. Volcengine Ark is retiring it.' },
	'seedance-1.0-pro-fast': { label: 'Seedance 1.0 Pro Fast', description: 'A faster Seedance 1.0 Pro, from a prompt or a start frame. Volcengine Ark is retiring it.' },
	'seedream-5.0-pro': { label: 'Seedream 5.0 Pro', description: 'One image from a prompt and up to 10 reference images, at 1K, 1.5K, or 2K.' },
	'seedream-5.0-flash': { label: 'Seedream 5.0 Flash', description: 'A faster Seedream 5.0 Pro: one image from a prompt and up to 10 reference images, at 1K, 1.5K, or 2K.' },
	'seedream-5.0-lite': { label: 'Seedream 5.0 Lite', description: 'One image, or a set of related images, from a prompt and up to 14 reference images, at 2K, 3K, or 4K. Asked for several images, the model may make fewer. Volcengine Ark is retiring it.' },
	'seedream-4.5': { label: 'Seedream 4.5', description: 'One image, or a set of related images, from a prompt and up to 14 reference images, at 2K or 4K, as JPEG. Asked for several images, the model may make fewer. Volcengine Ark is retiring it.' },
	'seedream-4.0': { label: 'Seedream 4.0', description: 'One image, or a set of related images, from a prompt and up to 14 reference images, at 1K, 2K, or 4K, as JPEG. Asked for several images, the model may make fewer. Volcengine Ark is retiring it.' }
});

const LEVEL_LABELS: Readonly<Record<Level, string>> = Object.freeze({ '1k': '1K', '1.5k': '1.5K', '2k': '2K', '3k': '3K', '4k': '4K' });

const TEXT = Object.freeze({
	provider: 'ByteDance',
	regions: { cn: 'China · Volcengine Ark', intl: 'International · BytePlus ModelArk' },
	apiKey: 'API Key',
	modes: { frames: 'Frames', reference: 'References' },
	parameters: {
		resolution: 'Resolution',
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the video. Adaptive follows the start frame, or lets the model choose from the prompt.',
		adaptive: 'Adaptive',
		duration: 'Duration',
		durationTooltip: 'Seconds of video. Auto lets the model choose.',
		auto: 'Auto',
		sound: 'Sound',
		soundTooltip: 'Voices, effects, and music made with the video.',
		seed: 'Seed',
		seedTooltip: 'The same seed with the same request gives a similar video. Leave it empty for a new one each time.',
		cameraFixed: 'Fixed Camera',
		cameraFixedTooltip: 'Asks the model to keep the camera still.',
		watermark: 'Watermark',
		watermarkTooltip: 'Puts an "AI generated" mark in the corner of the video.'
	},
	resolutions: RESOLUTION_LABELS,
	models: MODEL_TEXTS,
	image: {
		ratioTooltip: 'The shape of the image. Adaptive lets the model choose it from the prompt and the references.',
		levels: LEVEL_LABELS,
		count: 'Images',
		countTooltip: 'How many images to make. ByteDance makes a set of related images as the prompt describes, up to this many, and may make fewer. References and images together are at most 15.',
		background: 'Background',
		backgroundTooltip: 'Transparent keeps the transparency of the one reference image that has it, and makes a PNG with a transparent background.',
		backgrounds: { opaque: 'Opaque', transparent: 'Transparent' },
		promptOptimization: 'Prompt Optimization',
		promptOptimizationTooltip: 'How ByteDance optimizes the prompt before it makes the image: Standard gives better images, Fast answers sooner.',
		promptOptimizationModes: { standard: 'Standard', fast: 'Fast' },
		watermarkTooltip: 'Puts an "AI generated" mark in the lower right corner of the image.'
	},
	setTooLarge: (model: string, references: number, most: number) => `${model} makes at most 15 images and references together: with ${references} reference ${references === 1 ? 'image' : 'images'}, choose at most ${most} ${most === 1 ? 'image' : 'images'}.`,
	transparentNeedsOne: (model: string) => `${model} makes a transparent background only from exactly one reference image that has transparency: connect one, or choose Opaque.`,
	transparentNotJpeg: (label: string) => `${label} is a JPEG image, which has no transparency: a transparent background needs a PNG or WebP reference.`,
	tooManyPixels: (label: string, pixels: string) => `${label} has ${pixels} pixels; Seedream takes images of at most 36,000,000 pixels (6000 × 6000).`,
	imageRequestTooLarge: (megabytes: string) => `The request with its inputs would be about ${megabytes} MB; Seedream takes at most 64 MB. Use fewer or smaller inputs.`,
	imagesOnly: (label: string) => `${label} cannot be sent: Seedream takes reference images only.`,
	noSize: (model: string) => `${model} has no size for these settings.`,
	noImageTask: (model: string) => `${model} answers with its images at once: there is no task to ask about.`,
	unreadableImage: 'ByteDance answered an image AI Video cannot read.',
	noImages: 'ByteDance accepted the request but answered no images AI Video can read.',
	adaptiveNeedsStartFrame: (model: string) => `${model} chooses a ratio only from a start frame: choose a ratio, or connect an image.`,
	referencesNeedInput: (model: string) => `${model} in References mode needs at least one image or audio clip.`,
	textSetting: (flag: string) => `The prompt sets ${flag}; choose it in the settings instead, so that what the panel shows is sent.`,
	audioFormat: (label: string, format: string) => `${label} is ${format.toUpperCase()} audio; Seedance takes WAV or MP3.`,
	imageFormat: (label: string) => `${label} is not a PNG, JPEG, WebP, or GIF image.`,
	requestTooLarge: (megabytes: string) => `The request with its inputs would be about ${megabytes} MB; Seedance takes at most 64 MB. Use fewer or smaller inputs.`,
	expired: 'The task expired before it finished.',
	failed: 'The provider reports that the task failed.',
	cancelled: 'The task was cancelled.',
	noVideo: 'The provider gives no video address for this task.',
	notReady: 'The task has no video yet.',
	unknownStatus: (status: string) => `The provider reports a task status AI Video does not know: ${status || 'none'}.`,
	noTaskId: 'The provider accepted the request but gave no task id AI Video can read.'
});

// --- the models --------------------------------------------------------------------------------

const RATIOS = Object.freeze(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const);

interface Seedance {
	readonly id: string;
	readonly providerModels: Readonly<Partial<Record<RegionId, string>>>;
	readonly resolutions: readonly Resolution[];
	readonly defaultResolution: Resolution;
	readonly duration: { readonly min: number; readonly max: number; readonly auto: boolean };
	readonly sound: boolean;
	/** `seed` and `camera_fixed`, which only the 1.x models take. */
	readonly seedAndCamera: boolean;
	readonly endFrame: boolean;
	readonly references?: { readonly images: CountSlot; readonly audios: CountSlot; readonly audioSeconds: readonly [number, number]; readonly audioTotalSeconds: number };
	readonly defaultRatio: 'adaptive' | '16:9';
	/** Seedance 2.5 keeps the start frame's ratio: the start frame sets it, and Adaptive is sent. */
	readonly startFrameSetsRatio: boolean;
	/** Seedance 1.0 takes Adaptive only with a start frame. */
	readonly adaptiveNeedsStartFrame: boolean;
	readonly deprecated?: boolean;
}

const SEEDANCE_2_REFERENCES = { images: { min: 1, max: 9 }, audios: { min: 0, max: 3 }, audioSeconds: [2, 15], audioTotalSeconds: 15 } as const;

const SEEDANCE: readonly Seedance[] = Object.freeze([
	{
		id: 'seedance-2.5',
		providerModels: { cn: 'doubao-seedance-2-5-260628', intl: 'dreamina-seedance-2-5-260628' },
		resolutions: ['480p', '720p', '1080p'],
		defaultResolution: '720p',
		duration: { min: 4, max: 30, auto: true },
		sound: true,
		seedAndCamera: false,
		endFrame: true,
		references: { images: { min: 0, max: 30 }, audios: { min: 0, max: 10 }, audioSeconds: [2, 30], audioTotalSeconds: 30 },
		defaultRatio: 'adaptive',
		startFrameSetsRatio: true,
		adaptiveNeedsStartFrame: false
	},
	{
		id: 'seedance-2.0',
		providerModels: { cn: 'doubao-seedance-2-0-260128', intl: 'dreamina-seedance-2-0-260128' },
		resolutions: ['480p', '720p', '1080p', '4k'],
		defaultResolution: '720p',
		duration: { min: 4, max: 15, auto: true },
		sound: true,
		seedAndCamera: false,
		endFrame: true,
		references: SEEDANCE_2_REFERENCES,
		defaultRatio: 'adaptive',
		startFrameSetsRatio: false,
		adaptiveNeedsStartFrame: false
	},
	{
		id: 'seedance-2.0-fast',
		providerModels: { cn: 'doubao-seedance-2-0-fast-260128', intl: 'dreamina-seedance-2-0-fast-260128' },
		resolutions: ['480p', '720p'],
		defaultResolution: '720p',
		duration: { min: 4, max: 15, auto: true },
		sound: true,
		seedAndCamera: false,
		endFrame: true,
		references: SEEDANCE_2_REFERENCES,
		defaultRatio: 'adaptive',
		startFrameSetsRatio: false,
		adaptiveNeedsStartFrame: false
	},
	{
		id: 'seedance-2.0-mini',
		providerModels: { cn: 'doubao-seedance-2-0-mini-260615', intl: 'dreamina-seedance-2-0-mini-260615' },
		resolutions: ['480p', '720p'],
		defaultResolution: '720p',
		duration: { min: 4, max: 15, auto: true },
		sound: true,
		seedAndCamera: false,
		endFrame: true,
		references: SEEDANCE_2_REFERENCES,
		defaultRatio: 'adaptive',
		startFrameSetsRatio: false,
		adaptiveNeedsStartFrame: false
	},
	{
		id: 'seedance-1.5-pro',
		providerModels: { intl: 'seedance-1-5-pro-251215' },
		resolutions: ['480p', '720p', '1080p'],
		defaultResolution: '720p',
		duration: { min: 4, max: 12, auto: true },
		sound: true,
		seedAndCamera: true,
		endFrame: true,
		defaultRatio: 'adaptive',
		startFrameSetsRatio: false,
		adaptiveNeedsStartFrame: false,
		deprecated: true
	},
	{
		id: 'seedance-1.0-pro',
		providerModels: { cn: 'doubao-seedance-1-0-pro-250528', intl: 'seedance-1-0-pro-250528' },
		resolutions: ['480p', '720p', '1080p'],
		defaultResolution: '1080p',
		duration: { min: 2, max: 12, auto: false },
		sound: false,
		seedAndCamera: true,
		endFrame: true,
		defaultRatio: '16:9',
		startFrameSetsRatio: false,
		adaptiveNeedsStartFrame: true
	},
	{
		id: 'seedance-1.0-pro-fast',
		providerModels: { cn: 'doubao-seedance-1-0-pro-fast-251015', intl: 'seedance-1-0-pro-fast-251015' },
		resolutions: ['480p', '720p', '1080p'],
		defaultResolution: '1080p',
		duration: { min: 2, max: 12, auto: false },
		sound: false,
		seedAndCamera: true,
		endFrame: false,
		defaultRatio: '16:9',
		startFrameSetsRatio: false,
		adaptiveNeedsStartFrame: true
	}
] satisfies Seedance[]);

const MODELS: ReadonlyMap<string, Seedance> = new Map(SEEDANCE.map(model => [model.id, model]));

/** The ratios of an image, in the order the panel shows them; Adaptive comes after them. */
const IMAGE_RATIOS = Object.freeze(['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9'] as const);
type ImageRatio = typeof IMAGE_RATIOS[number];
type SizeTable = Readonly<Partial<Record<Level, Readonly<Record<ImageRatio, string>>>>>;

/** The width and height Seedream 5.0 Pro and Flash make for each ratio at each level: the provider's own table. */
const PRO_FLASH_SIZES: SizeTable = Object.freeze({
	'1k': { '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152', '16:9': '1424x800', '9:16': '800x1424', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1568x672' },
	'1.5k': { '1:1': '1536x1536', '4:3': '1792x1344', '3:4': '1344x1792', '16:9': '2048x1152', '9:16': '1152x2048', '3:2': '1872x1248', '2:3': '1248x1872', '21:9': '2352x1008' },
	'2k': { '1:1': '2048x2048', '4:3': '2368x1776', '3:4': '1776x2368', '16:9': '2816x1584', '9:16': '1584x2816', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344' }
});

/**
 * The same for Seedream 5.0 Lite, 4.5, and 4.0, whose tables agree at the
 * levels they share: 1K is 4.0's, 3K is 5.0 Lite's.
 */
const LITE_4_SIZES: SizeTable = Object.freeze({
	'1k': { '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152', '16:9': '1280x720', '9:16': '720x1280', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1512x648' },
	'2k': { '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '16:9': '2848x1600', '9:16': '1600x2848', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344' },
	'3k': { '1:1': '3072x3072', '4:3': '3456x2592', '3:4': '2592x3456', '16:9': '4096x2304', '9:16': '2304x4096', '3:2': '3744x2496', '2:3': '2496x3744', '21:9': '4704x2016' },
	'4k': { '1:1': '4096x4096', '4:3': '4704x3520', '3:4': '3520x4704', '16:9': '5504x3040', '9:16': '3040x5504', '3:2': '4992x3328', '2:3': '3328x4992', '21:9': '6240x2656' }
});

/** A level as `size` names it, which lets the model choose the shape. */
const LEVEL_SIZES: Readonly<Record<Level, string>> = Object.freeze({ '1k': '1K', '1.5k': '1.5K', '2k': '2K', '3k': '3K', '4k': '4K' });

/** The parameter of `optimize_prompt_options.mode`, named as its field. */
const PROMPT_MODE = 'optimize_prompt_options.mode';

interface Seedream {
	readonly id: string;
	readonly providerModels: Readonly<Record<RegionId, string>>;
	readonly levels: readonly Level[];
	readonly sizes: SizeTable;
	readonly maxReferences: number;
	/** Makes a set of related images through `sequential_image_generation`. */
	readonly sets: boolean;
	/** PNG is asked for with `output_format`; JPEG models take no format. */
	readonly outputFormat: 'png' | 'jpeg';
	/** Takes `background`, which can keep a reference's transparency. */
	readonly background: boolean;
	/** Offers the `fast` mode of `optimize_prompt_options`. */
	readonly fastPrompt: boolean;
	/** The regions that retire it. */
	readonly retiringIn?: readonly RegionId[];
}

const SEEDREAM: readonly Seedream[] = Object.freeze([
	{
		id: 'seedream-5.0-pro',
		providerModels: { cn: 'doubao-seedream-5-0-pro-260628', intl: 'dola-seedream-5-0-pro-260628' },
		levels: ['1k', '1.5k', '2k'],
		sizes: PRO_FLASH_SIZES,
		maxReferences: 10,
		sets: false,
		outputFormat: 'png',
		background: true,
		fastPrompt: true
	},
	{
		id: 'seedream-5.0-flash',
		providerModels: { cn: 'doubao-seedream-5-0-flash-260915', intl: 'dola-seedream-5-0-flash-260915' },
		levels: ['1k', '1.5k', '2k'],
		sizes: PRO_FLASH_SIZES,
		maxReferences: 10,
		sets: false,
		outputFormat: 'png',
		background: true,
		fastPrompt: false
	},
	{
		id: 'seedream-5.0-lite',
		// BytePlus's model list gives `seedream-5-0-260128`, which "also supports" `seedream-5-0-lite-260128`.
		providerModels: { cn: 'doubao-seedream-5-0-260128', intl: 'seedream-5-0-260128' },
		levels: ['2k', '3k', '4k'],
		sizes: LITE_4_SIZES,
		maxReferences: 14,
		sets: true,
		outputFormat: 'png',
		background: false,
		fastPrompt: false,
		retiringIn: ['cn']
	},
	{
		id: 'seedream-4.5',
		providerModels: { cn: 'doubao-seedream-4-5-251128', intl: 'seedream-4-5-251128' },
		levels: ['2k', '4k'],
		sizes: LITE_4_SIZES,
		maxReferences: 14,
		sets: true,
		outputFormat: 'jpeg',
		background: false,
		fastPrompt: false,
		retiringIn: ['cn']
	},
	{
		id: 'seedream-4.0',
		providerModels: { cn: 'doubao-seedream-4-0-250828', intl: 'seedream-4-0-250828' },
		levels: ['1k', '2k', '4k'],
		sizes: LITE_4_SIZES,
		maxReferences: 14,
		sets: true,
		outputFormat: 'jpeg',
		background: false,
		fastPrompt: true,
		retiringIn: ['cn']
	}
] satisfies Seedream[]);

const IMAGE_MODELS: ReadonlyMap<string, Seedream> = new Map(SEEDREAM.map(model => [model.id, model]));

// --- the catalog entry -------------------------------------------------------------------------

const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
/** "The request body may not exceed 64 MB": counted as 64,000,000 bytes to stay on the safe side. */
const REQUEST_MAX_BYTES = 64_000_000;
const PROMPT_MAX_LENGTH = 20_000;

const IMAGE_LIMITS = Object.freeze({ imageMinSide: 300, imageMaxSide: 6000, imageAspect: [0.4, 2.5] as const, imageMaxBytes: IMAGE_MAX_BYTES });

function modesOf(model: Seedance): CatalogMode[] {
	const none = { min: 0, max: 0 };
	const modes: CatalogMode[] = [{
		id: 'frames',
		label: TEXT.modes.frames,
		inputs: { startFrame: 'optional', endFrame: model.endFrame ? 'optional' : 'none', images: none, videos: none, audios: none, source: 'none' },
		limits: IMAGE_LIMITS
	}];
	if (model.references) {
		modes.push({
			id: 'reference',
			label: TEXT.modes.reference,
			inputs: { startFrame: 'none', endFrame: 'none', images: model.references.images, videos: none, audios: model.references.audios, source: 'none' },
			limits: { ...IMAGE_LIMITS, audioSeconds: model.references.audioSeconds, audioTotalSeconds: model.references.audioTotalSeconds, audioMaxBytes: AUDIO_MAX_BYTES }
		});
	}
	return modes;
}

function parametersOf(model: Seedance): CatalogParameter[] {
	const labels = TEXT.parameters;
	const parameters: CatalogParameter[] = [
		{
			name: 'resolution',
			label: labels.resolution,
			kind: 'choice',
			options: model.resolutions.map(value => ({ value, label: TEXT.resolutions[value] })),
			default: model.defaultResolution
		},
		{
			name: 'ratio',
			label: labels.ratio,
			tooltip: labels.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: [...RATIOS.map(value => ({ value, label: value })), { value: 'adaptive', label: labels.adaptive }],
			default: model.defaultRatio,
			...(model.startFrameSetsRatio ? { setByStartFrame: true } : {})
		},
		{
			name: 'duration',
			label: labels.duration,
			kind: 'integer',
			unit: 'seconds',
			min: model.duration.min,
			max: model.duration.max,
			step: 1,
			default: 5,
			...(model.duration.auto ? { tooltip: labels.durationTooltip, auto: { value: -1, label: labels.auto } } : {})
		}
	];
	if (model.sound) {
		parameters.push({ name: 'sound', label: labels.sound, tooltip: labels.soundTooltip, kind: 'boolean', default: true });
	}
	if (model.seedAndCamera) {
		parameters.push(
			{ name: 'seed', label: labels.seed, tooltip: labels.seedTooltip, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true },
			{ name: 'camera_fixed', label: labels.cameraFixed, tooltip: labels.cameraFixedTooltip, kind: 'boolean', default: false, advanced: true }
		);
	}
	parameters.push({ name: 'watermark', label: labels.watermark, tooltip: labels.watermarkTooltip, kind: 'boolean', default: false, advanced: true });
	return parameters;
}

function catalogModel(model: Seedance): CatalogModel {
	const text = TEXT.models[model.id];
	const providerModels: Record<string, string> = {};
	for (const [region, providerModel] of Object.entries(model.providerModels)) {
		if (providerModel) {
			providerModels[region] = providerModel;
		}
	}
	return {
		id: model.id,
		label: text.label,
		description: text.description,
		providerModels,
		prompt: { required: 'withoutMedia', maxLength: PROMPT_MAX_LENGTH },
		modes: modesOf(model),
		parameters: parametersOf(model),
		...(model.deprecated ? { deprecated: true } : {})
	};
}

/** References and images of a set together (Seedream 5.0 Lite, 4.5, 4.0). */
const MAX_SET_IMAGES = 15;
/** "Total pixels: [196, 6000×6000]"; more than 14 px on each side and 1/16 to 16 in shape are declared. */
const SEEDREAM_MAX_PIXELS = 36_000_000;
const SEEDREAM_LIMITS = Object.freeze({ imageMinSide: 15, imageAspect: [1 / 16, 16] as const, imageMaxBytes: IMAGE_MAX_BYTES });

function seedreamParameters(model: Seedream): CatalogParameter[] {
	const labels = TEXT.image;
	const parameters: CatalogParameter[] = [
		{
			name: 'ratio',
			label: TEXT.parameters.ratio,
			tooltip: labels.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: [...IMAGE_RATIOS.map(value => ({ value, label: value })), { value: 'adaptive', label: TEXT.parameters.adaptive }],
			default: 'adaptive'
		},
		{
			name: 'resolution',
			label: TEXT.parameters.resolution,
			kind: 'choice',
			options: model.levels.map(value => ({ value, label: labels.levels[value] })),
			default: '2k'
		}
	];
	if (model.sets) {
		parameters.push({ name: 'count', label: labels.count, tooltip: labels.countTooltip, kind: 'integer', min: 1, max: MAX_SET_IMAGES, step: 1, default: 1 });
	}
	if (model.background) {
		const names = labels.backgrounds;
		parameters.push({
			name: 'background',
			label: labels.background,
			tooltip: labels.backgroundTooltip,
			kind: 'choice',
			options: [{ value: 'opaque', label: names.opaque }, { value: 'transparent', label: names.transparent }],
			default: 'opaque'
		});
	}
	if (model.fastPrompt) {
		const names = labels.promptOptimizationModes;
		parameters.push({
			name: PROMPT_MODE,
			label: labels.promptOptimization,
			tooltip: labels.promptOptimizationTooltip,
			kind: 'choice',
			options: [{ value: 'standard', label: names.standard }, { value: 'fast', label: names.fast }],
			default: 'standard',
			advanced: true
		});
	}
	parameters.push({ name: 'watermark', label: TEXT.parameters.watermark, tooltip: labels.watermarkTooltip, kind: 'boolean', default: false, advanced: true });
	return parameters;
}

function seedreamModel(model: Seedream): CatalogModel {
	const text = TEXT.models[model.id];
	const none = { min: 0, max: 0 };
	return {
		id: model.id,
		kind: 'image',
		label: text.label,
		description: text.description,
		providerModels: { ...model.providerModels },
		prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
		modes: [{
			id: 'reference',
			label: TEXT.modes.reference,
			inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: model.maxReferences }, videos: none, audios: none, source: 'none' },
			limits: SEEDREAM_LIMITS
		}],
		parameters: seedreamParameters(model),
		outputFormat: model.outputFormat,
		answersAtOnce: true,
		...(model.retiringIn ? { deprecatedIn: [...model.retiringIn] } : {})
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'bytedance',
	label: TEXT.provider,
	regions: [
		{ id: 'cn', label: TEXT.regions.cn, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', console: 'https://ark.volcengine.com/region:cn-beijing/apiKey' },
		{ id: 'intl', label: TEXT.regions.intl, baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', console: 'https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: [...SEEDANCE.map(catalogModel), ...SEEDREAM.map(seedreamModel)]
});

// --- rules -------------------------------------------------------------------------------------

/** The API's settings written as text after the prompt, which would override the panel's. */
const TEXT_SETTING = /(?:^|\s)(--(?:rs|resolution|rt|ratio|dur|duration|fps|framespersecond|frames|seed|cf|camerafixed|camera_fixed|wm|watermark))(?=[\s=]|$)/i;

const AUDIO_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ wav: 'audio/wav', mp3: 'audio/mp3' });
const IMAGE_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' });

function modelOf(id: string): Seedance {
	const model = MODELS.get(id);
	if (!model) {
		throw rejected(`ByteDance has no model "${id}".`);
	}
	return model;
}

async function check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
	const image = IMAGE_MODELS.get(request.model);
	return image ? checkSeedream(image, request, media) : checkSeedance(request, media);
}

/** The rules of a Seedream model: the size of a set, a transparent background, the pixels of a reference, and the whole request. */
async function checkSeedream(model: Seedream, request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
	const label = TEXT.models[model.id].label;
	const counts = countsOf(request.inputs);
	const problems: string[] = [];
	const count = typeof request.params.count === 'number' ? request.params.count : 1;
	if (model.sets && counts.images + count > MAX_SET_IMAGES) {
		problems.push(TEXT.setTooLarge(label, counts.images, Math.max(1, MAX_SET_IMAGES - counts.images)));
	}
	const measured = await measureItems(request.inputs, media);
	if (request.params.background === 'transparent') {
		if (counts.images !== 1) {
			problems.push(TEXT.transparentNeedsOne(label));
		} else if (measured[0]?.facts.format === 'jpeg') {
			problems.push(TEXT.transparentNotJpeg(measured[0].label));
		}
	}
	let size = Buffer.byteLength(JSON.stringify(request.prompt), 'utf8') + 2048;
	for (const item of measured) {
		const { width, height } = item.facts;
		if (width && height && width * height > SEEDREAM_MAX_PIXELS) {
			problems.push(TEXT.tooManyPixels(item.label, (width * height).toLocaleString('en-US')));
		}
		size += base64Length(item.facts.bytes) + 128;
	}
	if (size > REQUEST_MAX_BYTES) {
		problems.push(TEXT.imageRequestTooLarge((size / 1_000_000).toFixed(1)));
	}
	return { problems };
}

async function checkSeedance(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
	const model = modelOf(request.model);
	const label = TEXT.models[model.id].label;
	const counts = countsOf(request.inputs);
	const problems: string[] = [];
	if (model.adaptiveNeedsStartFrame && request.params.ratio === 'adaptive' && !counts.startFrame) {
		problems.push(TEXT.adaptiveNeedsStartFrame(label));
	}
	if (request.mode === 'reference' && model.references?.images.min === 0 && counts.images === 0 && counts.audios === 0) {
		problems.push(TEXT.referencesNeedInput(label));
	}
	const flag = TEXT_SETTING.exec(request.prompt);
	if (flag) {
		problems.push(TEXT.textSetting(flag[1]));
	}
	let size = Buffer.byteLength(JSON.stringify(request.prompt), 'utf8') + 2048;
	for (const item of await measureItems(request.inputs, media)) {
		if (item.kind === 'audio' && item.facts.format && !AUDIO_TYPES[item.facts.format]) {
			problems.push(TEXT.audioFormat(item.label, item.facts.format));
		}
		size += base64Length(item.facts.bytes) + 128;
	}
	if (size > REQUEST_MAX_BYTES) {
		problems.push(TEXT.requestTooLarge((size / 1_000_000).toFixed(1)));
	}
	return { problems };
}

// --- requests ----------------------------------------------------------------------------------

const TASKS = '/contents/generations/tasks';

function taskPath(remoteId: string): string {
	return `${TASKS}/${encodeURIComponent(remoteId)}`;
}

const ROLES = Object.freeze({ startFrame: 'first_frame', endFrame: 'last_frame', image: 'reference_image' } as const);

const IMAGES = '/images/generations';

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const image = IMAGE_MODELS.get(request.model);
	return image ? submitSeedream(image, request, http) : submitSeedance(request, http);
}

/** The `size` of a Seedream request: the level alone for Adaptive, else the width and height of the provider's table. */
function seedreamSize(model: Seedream, level: unknown, ratio: unknown): string | undefined {
	if (typeof level !== 'string' || !model.levels.includes(level as Level)) {
		return undefined;
	}
	return ratio === 'adaptive' ? LEVEL_SIZES[level as Level] : model.sizes[level as Level]?.[ratio as ImageRatio];
}

/**
 * Sends a Seedream request once and answers its images as the provider gives
 * them: addresses, inline files a relay may answer, and images refused alone.
 */
async function submitSeedream(model: Seedream, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	const label = TEXT.models[model.id].label;
	const providerModel = model.providerModels[request.region as RegionId];
	if (!providerModel) {
		throw rejected(`${label} is not offered in this region.`);
	}
	const params = request.params;
	const size = seedreamSize(model, params.resolution, params.ratio);
	if (!size) {
		// The declarations' checks refuse a value the model does not offer.
		throw rejected(TEXT.noSize(label));
	}
	const images: string[] = [];
	for (const item of plannedItems(request.inputs)) {
		if (item.slot !== 'image') {
			throw rejected(TEXT.imagesOnly(item.label));
		}
		const read = await readMedia(item.media, IMAGE_MAX_BYTES, item.label);
		const { format } = await measure(bufferSource(read.bytes));
		const type = format ? IMAGE_TYPES[format] : undefined;
		if (!type) {
			throw rejected(TEXT.imageFormat(item.label));
		}
		images.push(dataUrlOf(read, type));
	}
	const count = typeof params.count === 'number' ? params.count : 1;
	const sets = !model.sets ? {} : count > 1
		? { sequential_image_generation: 'auto', sequential_image_generation_options: { max_images: count } }
		: { sequential_image_generation: 'disabled' };
	const body = Buffer.from(JSON.stringify({
		model: providerModel,
		prompt: request.prompt,
		// One reference as a string, several as a list, as the API shows them.
		...(images.length === 1 ? { image: images[0] } : images.length > 1 ? { image: images } : {}),
		size,
		...sets,
		...(model.outputFormat === 'png' ? { output_format: 'png' } : {}),
		...(model.background ? { background: params.background } : {}),
		...(model.fastPrompt ? { optimize_prompt_options: { mode: params[PROMPT_MODE] } } : {}),
		// Addresses: a set of large PNGs as base64 could pass the most AI Video reads of an answer.
		response_format: 'url',
		// Seedream marks images unless told not to.
		watermark: params.watermark === true
	}), 'utf8');
	if (body.byteLength > REQUEST_MAX_BYTES) {
		throw rejected(TEXT.imageRequestTooLarge((body.byteLength / 1_000_000).toFixed(1)));
	}
	const answer = await http.create({ method: 'POST', path: IMAGES, body: { kind: 'bytes', bytes: body, contentType: 'application/json' } });
	return { outputs: seedreamOutputs(answer.object()) };
}

/** The images of a Seedream answer, in the provider's order. An answer with an error and no image made none. */
function seedreamOutputs(object: Record<string, unknown>): OutputLocation[] {
	const data = object.data;
	if (!Array.isArray(data) || (!data.length && isRecord(object.error))) {
		const message = errorText(object);
		if (message) {
			throw rejected(message);
		}
		throw unknownOutcome(TEXT.noImages);
	}
	return data.map(seedreamOutput);
}

function seedreamOutput(entry: unknown): OutputLocation {
	if (!isRecord(entry)) {
		return { refused: TEXT.unreadableImage };
	}
	if (isRecord(entry.error)) {
		// One image of a set that the provider refused, such as by its content check; the others continue.
		return { refused: errorText(entry) ?? '' };
	}
	if (typeof entry.url === 'string' && entry.url) {
		return { url: entry.url };
	}
	if (typeof entry.b64_json === 'string' && entry.b64_json) {
		const format: OutputFormat | undefined = entry.output_format === 'png' || entry.output_format === 'jpeg' ? entry.output_format : undefined;
		return { bytes: Buffer.from(entry.b64_json, 'base64'), ...(format ? { format } : {}) };
	}
	return { refused: TEXT.unreadableImage };
}

async function submitSeedance(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	const model = modelOf(request.model);
	const providerModel = model.providerModels[request.region as RegionId];
	if (!providerModel) {
		throw rejected(`${TEXT.models[model.id].label} is not offered in this region.`);
	}
	const content: unknown[] = [];
	if (request.prompt.trim()) {
		content.push({ type: 'text', text: request.prompt });
	}
	for (const item of plannedItems(request.inputs)) {
		if (item.slot === 'audio') {
			const read = await readMedia(item.media, AUDIO_MAX_BYTES, item.label);
			const { format } = await measure(bufferSource(read.bytes));
			const type = format ? AUDIO_TYPES[format] : undefined;
			if (!type) {
				throw rejected(TEXT.audioFormat(item.label, format ?? 'unknown'));
			}
			content.push({ type: 'audio_url', audio_url: { url: dataUrlOf(read, type) }, role: 'reference_audio' });
		} else if (item.slot === 'startFrame' || item.slot === 'endFrame' || item.slot === 'image') {
			const read = await readMedia(item.media, IMAGE_MAX_BYTES, item.label);
			const { format } = await measure(bufferSource(read.bytes));
			const type = format ? IMAGE_TYPES[format] : undefined;
			if (!type) {
				throw rejected(TEXT.imageFormat(item.label));
			}
			content.push({ type: 'image_url', image_url: { url: dataUrlOf(read, type) }, role: ROLES[item.slot] });
		} else {
			// No mode of this provider declares a video slot.
			throw rejected(`${item.label} cannot be sent: Seedance takes videos only from public addresses.`);
		}
	}
	// The commands checked and completed the parameters. Each is named as the API's field, except Sound,
	// whose shared name is `sound` and whose field is `generate_audio`.
	const { sound, ...fields } = request.params;
	// With a start frame, Seedance 2.5 takes the frame's shape: its ratio arrives unset, and Adaptive is sent.
	const shape = fields.ratio === undefined && model.startFrameSetsRatio ? { ratio: 'adaptive' } : {};
	const body = Buffer.from(JSON.stringify({ model: providerModel, content, ...fields, ...shape, ...(sound !== undefined ? { generate_audio: sound } : {}) }), 'utf8');
	if (body.byteLength > REQUEST_MAX_BYTES) {
		throw rejected(TEXT.requestTooLarge((body.byteLength / 1_000_000).toFixed(1)));
	}
	const answer = await http.create({ method: 'POST', path: TASKS, body: { kind: 'bytes', bytes: body, contentType: 'application/json' } });
	const id = answer.object().id;
	if (typeof id !== 'string' || !id.trim()) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return id;
}

async function readTask(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	return (await http.request({ method: 'GET', path: taskPath(ref.remoteId) })).object();
}

function errorText(task: Record<string, unknown>): string | undefined {
	const error = task.error;
	if (!isRecord(error)) {
		return undefined;
	}
	const message = typeof error.message === 'string' && error.message.trim() ? error.message : undefined;
	const code = typeof error.code === 'string' && error.code.trim() ? error.code : undefined;
	return message ?? code;
}

function taskState(task: Record<string, unknown>): PollState {
	const status = typeof task.status === 'string' ? task.status.toLowerCase() : '';
	switch (status) {
		case 'queued':
			return { state: 'pending' };
		case 'running':
			return { state: 'running' };
		case 'succeeded': {
			const url = isRecord(task.content) ? task.content.video_url : undefined;
			return typeof url === 'string' && url ? { state: 'succeeded', videoUrl: url } : { state: 'succeeded' };
		}
		case 'failed':
			return { state: 'failed', message: errorText(task) ?? TEXT.failed };
		case 'expired':
			return { state: 'failed', message: errorText(task) ? `${TEXT.expired} ${errorText(task)}` : TEXT.expired };
		case 'cancelled':
		case 'canceled':
			return { state: 'cancelled', message: errorText(task) ?? TEXT.cancelled };
		default:
			throw unreadable(TEXT.unknownStatus(status));
	}
}

/** Refuses a task of a Seedream model: it answered with its images, and there is no task to ask about. */
function refuseImageTask(ref: TaskRef): void {
	const image = IMAGE_MODELS.get(ref.model);
	if (image) {
		throw rejected(TEXT.noImageTask(TEXT.models[image.id].label));
	}
}

async function poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
	refuseImageTask(ref);
	return taskState(await readTask(ref, http));
}

async function videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
	refuseImageTask(ref);
	const state = taskState(await readTask(ref, http));
	if (state.state !== 'succeeded') {
		throw unreadable(TEXT.notReady);
	}
	if (!state.videoUrl) {
		throw unreadable(TEXT.noVideo);
	}
	return { url: state.videoUrl };
}

async function cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean> {
	if (IMAGE_MODELS.has(ref.model)) {
		// The request answered with the images: there is nothing to cancel.
		return false;
	}
	// Only a queued task can be cancelled; a DELETE on a task that ended deletes its record.
	if (taskState(await readTask(ref, http)).state !== 'pending') {
		return false;
	}
	try {
		await http.requestOnce({ method: 'DELETE', path: taskPath(ref.remoteId) });
		return true;
	} catch (error) {
		if (error instanceof ProviderFailure && (error.code === 'rejected' || error.code === 'notFound')) {
			// The task started, or ended, in the meantime.
			return false;
		}
		throw error;
	}
}

/** The provider's codes that say more than the HTTP status. */
const BALANCE_CODES: ReadonlySet<string> = new Set(['AccountOverdueError', 'OperationDenied.ServiceOverdue']);
const NOT_ACTIVATED_CODES: ReadonlySet<string> = new Set(['OperationDenied.ServiceNotOpen', 'ModelNotOpen']);

function readError(_status: number, body: unknown): ProviderErrorReading | undefined {
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	const code = typeof error?.code === 'string' ? error.code : undefined;
	const message = typeof error?.message === 'string' && error.message.trim() ? error.message : code;
	if (!message) {
		return readCommonError(body);
	}
	if (code && BALANCE_CODES.has(code)) {
		return { message, code: 'balance' };
	}
	if (code && (NOT_ACTIVATED_CODES.has(code) || code.startsWith('InvalidEndpointOrModel'))) {
		return { message, code: 'rejected' };
	}
	return { message };
}

export const BYTEDANCE: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
	readError,
	check,
	submit,
	poll,
	videoLocation,
	cancel
});
