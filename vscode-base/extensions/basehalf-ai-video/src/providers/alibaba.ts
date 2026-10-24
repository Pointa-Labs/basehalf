/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { countsOf, measureItems, type MeasuredItem, type PlannedCounts } from './check.ts';
import { failureForStatus, isRecord, ProviderFailure, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, retryAfterMs, type FormPart, type HttpAnswer, type ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector, type PlannedItem } from './media.ts';
import type { AnsweredAtOnce, ModuleCheckResult, OutputLocation, ProviderModule, VideoLocation } from './module.ts';
import { promptLanguage, referenceNumber, sharedPromptName, writePromptNames, type PromptContext } from './prompt.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckLimit, CheckRequest, ChoiceParameter, Media, ModeId, ModeInputs, ModeLimits, NumberParameter, Params, ParamValue, PollState, PromptPart, SubmitRequest, TaskRef } from './types.ts';

/**
 * Alibaba Cloud Model Studio (DashScope): the Wan and HappyHorse video models
 * and the Qwen-Image and Wan image models with the user's own key (D59, D64;
 * docs/specs/providers/alibaba.md).
 *
 * The catalog lists one video model per version. Alibaba has one model id per
 * task of a version (text to video, image to video, references, editing); the
 * mode and the inputs of a generation choose the task, `check` answers its id,
 * and `submit` sends that id. One create endpoint serves every task, each with
 * its own `input` and `parameters`. Images go inline as data URLs. Videos and
 * audio are taken only as addresses, so in China (Beijing) they go through the
 * provider's temporary upload, and elsewhere `check` refuses them.
 *
 * The image models are made by the synchronous call, which answers with the
 * addresses of the images (alibaba.md, "The synchronous call").
 */

type Region = 'cn' | 'intl';

/** How a task's request is built. */
type Family =
	| 'wan3'
	| 'wan27-t2v'
	| 'wan27-i2v'
	| 'wan27-r2v'
	| 'wan27-edit'
	| 'wan26-t2v'
	| 'wan26-i2v'
	| 'happyhorse-t2v'
	| 'happyhorse-i2v'
	| 'happyhorse-r2v';

type Resolution = '480p' | '720p' | '1080p';

/** One of Alibaba's model ids: the task a generation of a catalog model runs. */
interface Task {
	/** Alibaba's model id, the same in both regions. */
	readonly id: string;
	readonly family: Family;
	/** The catalog's parameters this task sends, by their catalog names. */
	readonly takes: ReadonlySet<string>;
}

interface ModelSpec {
	readonly model: CatalogModel;
	/** The task a generation runs, chosen by its mode and its inputs. */
	route(mode: ModeId, counts: PlannedCounts): Task;
}

// --- labels ---------------------------------------------------------------------------------------

/** Every label of the provider's catalog entry, in English, in one place to translate later. */
const LABELS = Object.freeze({
	provider: 'Alibaba (Wan, Qwen-Image)',
	regionCn: 'China (Beijing)',
	regionIntl: 'International (Singapore)',
	apiKey: 'API Key',
	modeFrames: 'Frames',
	modeReference: 'References',
	modeEdit: 'Edit',
	modeExtend: 'Extend',
	resolution: 'Resolution',
	ratio: 'Ratio',
	adaptive: 'Adaptive',
	duration: 'Duration',
	auto: 'Auto',
	sound: 'Sound',
	soundAuto: 'Auto',
	soundOrigin: 'Keep Original',
	shots: 'Shots',
	singleShot: 'Single',
	multipleShots: 'Multiple',
	negativePrompt: 'Negative Prompt',
	promptExtend: 'Prompt Rewriting',
	watermark: 'Watermark',
	seed: 'Seed',
	tipAdaptive: 'The shape of the video. Adaptive follows the inputs.',
	tipFrameShape: 'The shape of the video. A video made from a start frame takes the shape of the frame.',
	tipExtendDuration: 'In Extend mode, the length of the whole result, the clip included.',
	tipAudioSetting: 'Auto lets the model decide from the prompt; Keep Original keeps the sound of the video.',
	tipShots: 'Multiple shots need Prompt Rewriting.',
	tipPromptExtend: 'A language model rewrites the prompt first. It helps short prompts and takes longer.',
	tipWanWatermark: 'Adds “AI Generated” in the lower-right corner.',
	tipHappyHorseWatermark: 'Adds “Happy Horse” in the lower-right corner.',
	tipSeed: 'The same seed and settings give similar results.',
	wan3: 'Wan 3.0',
	wan3Description: 'Text, start and end frames, references (images, videos, and audio), editing, and extension; up to 30 seconds with sound.',
	wan3Prime: 'Wan 3.0 Prime',
	wan3PrimeDescription: 'The faster Wan 3.0, with the same inputs and settings.',
	happyHorse11: 'HappyHorse 1.1',
	happyHorse10: 'HappyHorse 1.0',
	happyHorseDescription: 'Text, a start frame, or up to 9 reference images to video with sound; 3 to 15 seconds.',
	wan27: 'Wan 2.7',
	wan27Description: 'Text, start and end frames, references (images and videos), editing in China, and extension; 2 to 15 seconds.',
	wan26: 'Wan 2.6',
	wan26Description: 'Text or a start frame to video with sound and multi-shot storytelling; 2 to 15 seconds.',
	wan26Flash: 'Wan 2.6 Flash',
	wan26FlashDescription: 'A start frame to video, faster, with or without sound; 2 to 15 seconds.',
	count: 'Images',
	tipImageRatio: 'The shape of the image. Adaptive follows the last reference image, and is square without one.',
	tipQwenWatermark: 'Adds a watermark to the image.',
	qwen30Pro: 'Qwen-Image 3.0 Pro',
	qwen30ProDescription: 'From the prompt alone or up to 3 reference images: 1 to 6 images at 1K or 2K.',
	qwen30: 'Qwen-Image 3.0',
	qwen30Description: 'The faster Qwen-Image 3.0, with the same inputs and settings.',
	qwen21Pro: 'Qwen-Image 2.1 Pro',
	qwen21ProDescription: 'From the prompt alone or up to 10 reference images: 1 to 6 images at 1K or 2K, transparent when the prompt asks for it.',
	qwen21Turbo: 'Qwen-Image 2.1 Turbo',
	qwen21TurboDescription: 'The faster Qwen-Image 2.1, with the same inputs and settings.',
	wan27ImagePro: 'Wan 2.7 Image Pro',
	wan27ImageProDescription: 'From the prompt alone or up to 9 reference images: 1 to 4 images at 1K or 2K, and 4K from the prompt alone.',
	wan27Image: 'Wan 2.7 Image',
	wan27ImageDescription: 'The faster Wan 2.7 Image at 1K or 2K, with the same inputs.'
});

// --- resolutions -----------------------------------------------------------------------------------

/** Alibaba writes resolutions in capitals, and takes them so. */
const RESOLUTION_VALUES: Readonly<Record<Resolution, string>> = Object.freeze({ '480p': '480P', '720p': '720P', '1080p': '1080P' });

/** The size Wan 2.6 Text to Video takes for each resolution and ratio, as its documentation lists them. */
const WAN26_SIZES: ReadonlyMap<string, string> = new Map([
	['720p 16:9', '1280*720'],
	['720p 9:16', '720*1280'],
	['720p 1:1', '960*960'],
	['720p 4:3', '1088*832'],
	['720p 3:4', '832*1088'],
	['1080p 16:9', '1920*1080'],
	['1080p 9:16', '1080*1920'],
	['1080p 1:1', '1440*1440'],
	['1080p 4:3', '1632*1248'],
	['1080p 3:4', '1248*1632']
]);

// --- tasks -----------------------------------------------------------------------------------------

const WAN_EXTRAS = ['negative_prompt', 'prompt_extend', 'watermark', 'seed'];

function task(id: string, family: Family, takes: readonly string[]): Task {
	return { id, family, takes: new Set(takes) };
}

function happyHorseTasks(version: '1.1' | '1.0'): { readonly t2v: Task; readonly i2v: Task; readonly r2v: Task } {
	return {
		t2v: task(`happyhorse-${version}-t2v`, 'happyhorse-t2v', ['resolution', 'ratio', 'duration', 'watermark', 'seed']),
		i2v: task(`happyhorse-${version}-i2v`, 'happyhorse-i2v', ['resolution', 'duration', 'watermark', 'seed']),
		r2v: task(`happyhorse-${version}-r2v`, 'happyhorse-r2v', ['resolution', 'ratio', 'duration', 'watermark', 'seed'])
	};
}

const WAN3_TAKES = ['resolution', 'ratio', 'duration', 'sound', 'prompt_extend', 'watermark', 'seed'];

const TASKS = Object.freeze({
	wan3: task('wan3.0-video', 'wan3', WAN3_TAKES),
	wan3Prime: task('wan3.0-video-prime', 'wan3', WAN3_TAKES),
	wan27T2v: task('wan2.7-t2v', 'wan27-t2v', ['resolution', 'ratio', 'duration', ...WAN_EXTRAS]),
	wan27I2v: task('wan2.7-i2v', 'wan27-i2v', ['resolution', 'duration', ...WAN_EXTRAS]),
	wan27R2v: task('wan2.7-r2v', 'wan27-r2v', ['resolution', 'ratio', 'duration', ...WAN_EXTRAS]),
	wan27Edit: task('wan2.7-videoedit', 'wan27-edit', ['resolution', 'audio_setting', ...WAN_EXTRAS]),
	// Its resolution and ratio are sent together as a size.
	wan26T2v: task('wan2.6-t2v', 'wan26-t2v', ['resolution', 'ratio', 'duration', 'shot_type', ...WAN_EXTRAS]),
	wan26I2v: task('wan2.6-i2v', 'wan26-i2v', ['resolution', 'duration', 'shot_type', ...WAN_EXTRAS]),
	wan26Flash: task('wan2.6-i2v-flash', 'wan26-i2v', ['resolution', 'duration', 'shot_type', 'sound', ...WAN_EXTRAS]),
	happyHorse11: happyHorseTasks('1.1'),
	happyHorse10: happyHorseTasks('1.0')
});

// --- declarations --------------------------------------------------------------------------------

const MiB = 1024 * 1024;
const WAN3_AUTO_DURATION = -1;
const WAN3_SHORTEST_SECONDS = 2;
const WAN3_LONGEST_SECONDS = 30;
/** The longest Wan 2.7 References makes with a reference video. */
const WAN27_LONGEST_WITH_VIDEO = 10;
/** How far over the longest a measured sum may be, for the rounding of a measured length. */
const WAN3_MEASURE_SLACK = 0.05;

const NO_INPUTS: ModeInputs = {
	startFrame: 'none',
	endFrame: 'none',
	images: { min: 0, max: 0 },
	videos: { min: 0, max: 0 },
	audios: { min: 0, max: 0 },
	source: 'none'
};

function inputs(change: Partial<ModeInputs>): ModeInputs {
	return { ...NO_INPUTS, ...change };
}

const WAN_IMAGES: ModeLimits = { imageMinSide: 240, imageMaxSide: 8000, imageAspect: [1 / 8, 8], imageMaxBytes: 20 * MiB };
const WAN3_MEDIA: ModeLimits = {
	...WAN_IMAGES,
	videoSeconds: [1, 15],
	videoTotalSeconds: 15,
	videoMaxBytes: 100 * MiB,
	audioSeconds: [1, 15],
	audioTotalSeconds: 15,
	audioMaxBytes: 15 * MiB
};

function options(values: readonly string[]): { value: string; label: string }[] {
	return values.map(value => ({ value, label: value }));
}

function resolution(values: readonly Resolution[]): ChoiceParameter {
	return { name: 'resolution', label: LABELS.resolution, kind: 'choice', options: values.map(value => ({ value, label: value })), default: '1080p' };
}

/** Edit and Extend send a clip, which only the temporary upload of the China region can carry. */
const CLIP_REGIONS: readonly string[] = Object.freeze(['cn']);

const WAN_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);
const HAPPYHORSE_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9']);

/** The ratio of a video made from the prompt or references; a start frame sets the shape itself, so Frames sends it only without one. */
function ratio(values: readonly string[], modes?: readonly ModeId[]): ChoiceParameter {
	const framed = !modes || modes.includes('frames');
	return { name: 'ratio', label: LABELS.ratio, tooltip: LABELS.tipFrameShape, kind: 'choice', display: 'ratio', options: options(values), default: '16:9', ...(modes ? { modes } : {}), ...(framed ? { setByStartFrame: true } : {}) };
}

function duration(min: number, max: number): NumberParameter {
	return { name: 'duration', label: LABELS.duration, kind: 'integer', unit: 'seconds', min, max, step: 1, default: 5 };
}

const SOUND: CatalogParameter = { name: 'sound', label: LABELS.sound, kind: 'boolean', default: true };
const SHOTS: CatalogParameter = {
	name: 'shot_type',
	label: LABELS.shots,
	tooltip: LABELS.tipShots,
	kind: 'choice',
	options: [{ value: 'single', label: LABELS.singleShot }, { value: 'multi', label: LABELS.multipleShots }],
	default: 'single'
};
const NEGATIVE_PROMPT: CatalogParameter = { name: 'negative_prompt', label: LABELS.negativePrompt, kind: 'text', maxLength: 500, multiline: true, optional: true, advanced: true };
const PROMPT_EXTEND: CatalogParameter = { name: 'prompt_extend', label: LABELS.promptExtend, tooltip: LABELS.tipPromptExtend, kind: 'boolean', default: true, advanced: true };
const WAN_WATERMARK: CatalogParameter = { name: 'watermark', label: LABELS.watermark, tooltip: LABELS.tipWanWatermark, kind: 'boolean', default: false, advanced: true };
// Off, as for every other model: HappyHorse's own default puts its mark on the video.
const HAPPYHORSE_WATERMARK: CatalogParameter = { name: 'watermark', label: LABELS.watermark, tooltip: LABELS.tipHappyHorseWatermark, kind: 'boolean', default: false, advanced: true };
const SEED: CatalogParameter = { name: 'seed', label: LABELS.seed, tooltip: LABELS.tipSeed, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true };
const WAN_EXTRA_PARAMETERS: readonly CatalogParameter[] = [NEGATIVE_PROMPT, PROMPT_EXTEND, WAN_WATERMARK, SEED];

/** The model in both regions, sent first as the id of its first task. */
function both(id: string): Readonly<Record<string, string>> {
	return { cn: id, intl: id };
}

function wan3(id: string, label: string, description: string, only: Task): ModelSpec {
	return {
		route: () => only,
		model: {
			id,
			label,
			description,
			providerModels: both(only.id),
			prompt: { required: 'withoutMedia', maxLength: 20000 },
			modes: [
				{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'optional', endFrame: 'optional' }), limits: WAN_IMAGES },
				{ id: 'reference', label: LABELS.modeReference, inputs: inputs({ images: { min: 0, max: 10 }, videos: { min: 0, max: 5 }, audios: { min: 0, max: 5 } }), limits: WAN3_MEDIA },
				{ id: 'edit', label: LABELS.modeEdit, inputs: inputs({ images: { min: 0, max: 10 }, source: 'required' }), limits: WAN3_MEDIA, regions: CLIP_REGIONS },
				{ id: 'extend', label: LABELS.modeExtend, inputs: inputs({ source: 'required' }), limits: WAN3_MEDIA, regions: CLIP_REGIONS }
			],
			parameters: [
				resolution(['480p', '720p', '1080p']),
				{
					name: 'ratio',
					label: LABELS.ratio,
					tooltip: LABELS.tipAdaptive,
					kind: 'choice',
					display: 'ratio',
					options: [{ value: 'adaptive', label: LABELS.adaptive }, ...options(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])],
					default: 'adaptive',
					modes: ['frames', 'reference']
				},
				{ ...duration(WAN3_SHORTEST_SECONDS, WAN3_LONGEST_SECONDS), auto: { value: WAN3_AUTO_DURATION, label: LABELS.auto }, modes: ['frames', 'reference'] },
				SOUND,
				PROMPT_EXTEND,
				WAN_WATERMARK,
				SEED
			]
		}
	};
}

function happyHorse(version: '1.1' | '1.0'): ModelSpec {
	const tasks = version === '1.1' ? TASKS.happyHorse11 : TASKS.happyHorse10;
	return {
		route: (mode, counts) => mode === 'reference' ? tasks.r2v : counts.startFrame ? tasks.i2v : tasks.t2v,
		model: {
			id: `happyhorse-${version}`,
			label: version === '1.1' ? LABELS.happyHorse11 : LABELS.happyHorse10,
			description: LABELS.happyHorseDescription,
			providerModels: both(tasks.t2v.id),
			// References needs a prompt; check says so.
			prompt: { required: 'withoutMedia', maxLength: 5000 },
			modes: [
				{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'optional' }), limits: { imageMinSide: 300, imageAspect: [0.4, 2.5], imageMaxBytes: 20 * MiB } },
				{ id: 'reference', label: LABELS.modeReference, inputs: inputs({ images: { min: 1, max: 9 } }), limits: { imageMinSide: 400, imageMaxBytes: 20 * MiB } }
			],
			parameters: [
				resolution(version === '1.1' ? ['480p', '720p', '1080p'] : ['720p', '1080p']),
				ratio(HAPPYHORSE_RATIOS),
				duration(3, 15),
				HAPPYHORSE_WATERMARK,
				SEED
			]
		}
	};
}

const WAN27_RESOLUTION = resolution(['720p', '1080p']);

const MODEL_SPECS: readonly ModelSpec[] = [
	wan3('wan3.0', LABELS.wan3, LABELS.wan3Description, TASKS.wan3),
	wan3('wan3.0-prime', LABELS.wan3Prime, LABELS.wan3PrimeDescription, TASKS.wan3Prime),
	happyHorse('1.1'),
	{
		route: (mode, counts) => {
			switch (mode) {
				case 'reference': return TASKS.wan27R2v;
				case 'edit': return TASKS.wan27Edit;
				case 'extend': return TASKS.wan27I2v;
				default: return counts.startFrame ? TASKS.wan27I2v : TASKS.wan27T2v;
			}
		},
		model: {
			id: 'wan2.7',
			label: LABELS.wan27,
			description: LABELS.wan27Description,
			providerModels: both(TASKS.wan27T2v.id),
			// Text to video and References need a prompt; check says so for References.
			prompt: { required: 'withoutMedia', maxLength: 5000 },
			modes: [
				{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'optional', endFrame: 'optional' }), limits: WAN_IMAGES },
				{ id: 'reference', label: LABELS.modeReference, inputs: inputs({ images: { min: 0, max: 5 }, videos: { min: 0, max: 5 } }), limits: { ...WAN_IMAGES, videoSeconds: [1, 30], videoMaxBytes: 100 * MiB } },
				// Video editing runs only in China (Beijing), where its video can be sent; check says so elsewhere.
				{ id: 'edit', label: LABELS.modeEdit, inputs: inputs({ images: { min: 0, max: 4 }, source: 'required' }), limits: { ...WAN_IMAGES, videoSeconds: [2, 10], videoMaxBytes: 100 * MiB }, regions: CLIP_REGIONS },
				{ id: 'extend', label: LABELS.modeExtend, inputs: inputs({ source: 'required' }), limits: { videoSeconds: [2, 10], videoMaxBytes: 100 * MiB }, regions: CLIP_REGIONS }
			],
			parameters: [
				WAN27_RESOLUTION,
				ratio(WAN_RATIOS, ['frames', 'reference']),
				{ ...duration(2, 15), tooltip: LABELS.tipExtendDuration, modes: ['frames', 'reference', 'extend'] },
				{
					name: 'audio_setting',
					label: LABELS.sound,
					tooltip: LABELS.tipAudioSetting,
					kind: 'choice',
					options: [{ value: 'auto', label: LABELS.soundAuto }, { value: 'origin', label: LABELS.soundOrigin }],
					default: 'auto',
					modes: ['edit']
				},
				...WAN_EXTRA_PARAMETERS
			]
		}
	},
	{
		route: (_mode, counts) => counts.startFrame ? TASKS.wan26I2v : TASKS.wan26T2v,
		model: {
			id: 'wan2.6',
			label: LABELS.wan26,
			description: LABELS.wan26Description,
			providerModels: both(TASKS.wan26T2v.id),
			prompt: { required: 'withoutMedia', maxLength: 1500 },
			modes: [{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'optional' }), limits: { imageMinSide: 240, imageMaxSide: 8000, imageMaxBytes: 20 * MiB } }],
			parameters: [WAN27_RESOLUTION, ratio(WAN_RATIOS), duration(2, 15), SHOTS, ...WAN_EXTRA_PARAMETERS]
		}
	},
	{
		route: () => TASKS.wan26Flash,
		model: {
			id: 'wan2.6-flash',
			label: LABELS.wan26Flash,
			description: LABELS.wan26FlashDescription,
			providerModels: both(TASKS.wan26Flash.id),
			prompt: { required: 'withoutMedia', maxLength: 1500 },
			modes: [{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'required' }), limits: { imageMinSide: 240, imageMaxSide: 8000, imageMaxBytes: 20 * MiB } }],
			parameters: [WAN27_RESOLUTION, duration(2, 15), SHOTS, SOUND, ...WAN_EXTRA_PARAMETERS]
		}
	},
	happyHorse('1.0')
];

const SPECS: ReadonlyMap<string, ModelSpec> = new Map(MODEL_SPECS.map(spec => [spec.model.id, spec]));

// --- image models ----------------------------------------------------------------------------------

/** How an image model's size is sent: Qwen takes `W*H` only, Wan also a level alone. */
type ImageFamily = 'qwen' | 'wan';

/** An image resolution, as the catalog names it (providers, "Shared names"). */
type ImageLevel = '1k' | '2k' | '4k';

/** One image model: its declaration, how its size is sent, and its limit, which a rate-limited message names. */
interface ImageSpec {
	readonly model: CatalogModel;
	readonly family: ImageFamily;
	readonly rateLimit: string;
}

/** Each level as it is labeled, which is also how Wan takes it alone. */
const IMAGE_LEVEL_NAMES: Readonly<Record<ImageLevel, string>> = Object.freeze({ '1k': '1K', '2k': '2K', '4k': '4K' });
/** The side of the square of each level's pixels: 1K is 1024 × 1024, as Wan defines its levels. */
const IMAGE_LEVEL_SIDES: Readonly<Record<ImageLevel, number>> = Object.freeze({ '1k': 1024, '2k': 2048, '4k': 4096 });
const IMAGE_RATIOS = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']);
/** Qwen-Image takes each side up to 8,000 px, the longer at most ten times the shorter, and 10 MB. */
const QWEN_IMAGES: ModeLimits = { imageMaxSide: 8000, imageAspect: [1 / 10, 10], imageMaxBytes: 10 * MiB };
/** Qwen takes at most 4,500 tokens of prompt, and a character is rarely more than one. */
const QWEN_PROMPT_CHARACTERS = 4500;
const WAN_IMAGE_PROMPT_CHARACTERS = 5000;
const QWEN_MAX_IMAGES = 6;
const WAN_MAX_IMAGES = 4;

function imageModes(maxReferences: number, limits: ModeLimits): CatalogMode[] {
	return [{ id: 'reference', label: LABELS.modeReference, inputs: inputs({ images: { min: 0, max: maxReferences } }), limits }];
}

/** The parameters every image model has, then its own. */
function imageParameters(levels: readonly ImageLevel[], maxCount: number, own: readonly CatalogParameter[]): CatalogParameter[] {
	return [
		{
			name: 'ratio',
			label: LABELS.ratio,
			tooltip: LABELS.tipImageRatio,
			kind: 'choice',
			display: 'ratio',
			options: [{ value: 'adaptive', label: LABELS.adaptive }, ...options(IMAGE_RATIOS)],
			default: 'adaptive'
		},
		{ name: 'resolution', label: LABELS.resolution, kind: 'choice', options: levels.map(level => ({ value: level, label: IMAGE_LEVEL_NAMES[level] })), default: '2k' },
		{ name: 'count', label: LABELS.count, kind: 'integer', min: 1, max: maxCount, step: 1, default: 1 },
		...own
	];
}

const QWEN_WATERMARK: CatalogParameter = { name: 'watermark', label: LABELS.watermark, tooltip: LABELS.tipQwenWatermark, kind: 'boolean', default: false, advanced: true };

/** An image model: the same id in both regions, PNG, and its images in the answer to the request. */
function imageModel(id: string, label: string, description: string, maxPrompt: number, modes: CatalogMode[], parameters: CatalogParameter[]): CatalogModel {
	return {
		id,
		kind: 'image',
		label,
		description,
		providerModels: both(id),
		prompt: { required: 'always', maxLength: maxPrompt },
		modes,
		parameters,
		outputFormat: 'png',
		answersAtOnce: true
	};
}

function qwenImage(id: string, label: string, description: string, maxReferences: number, negativePrompt: boolean, perMinute: number): ImageSpec {
	const own = [...(negativePrompt ? [NEGATIVE_PROMPT] : []), PROMPT_EXTEND, QWEN_WATERMARK, SEED];
	return {
		family: 'qwen',
		rateLimit: `Alibaba Cloud takes at most ${perMinute} requests a minute for ${label}.`,
		model: imageModel(id, label, description, QWEN_PROMPT_CHARACTERS, imageModes(maxReferences, QWEN_IMAGES), imageParameters(['1k', '2k'], QWEN_MAX_IMAGES, own))
	};
}

function wanImage(id: string, label: string, description: string, levels: readonly ImageLevel[]): ImageSpec {
	return {
		family: 'wan',
		rateLimit: `Alibaba Cloud takes at most 5 requests a second and works on at most 5 at once for ${label}.`,
		model: imageModel(id, label, description, WAN_IMAGE_PROMPT_CHARACTERS, imageModes(9, WAN_IMAGES), imageParameters(levels, WAN_MAX_IMAGES, [WAN_WATERMARK, SEED]))
	};
}

/** The image models, after the video models (alibaba.md, "Image models"). */
const IMAGE_MODEL_SPECS: readonly ImageSpec[] = [
	qwenImage('qwen-image-3.0-pro', LABELS.qwen30Pro, LABELS.qwen30ProDescription, 3, true, 5),
	qwenImage('qwen-image-3.0', LABELS.qwen30, LABELS.qwen30Description, 3, true, 20),
	qwenImage('qwen-image-2.1-pro', LABELS.qwen21Pro, LABELS.qwen21ProDescription, 10, false, 20),
	qwenImage('qwen-image-2.1-turbo', LABELS.qwen21Turbo, LABELS.qwen21TurboDescription, 10, false, 120),
	wanImage('wan2.7-image-pro', LABELS.wan27ImagePro, LABELS.wan27ImageProDescription, ['1k', '2k', '4k']),
	wanImage('wan2.7-image', LABELS.wan27Image, LABELS.wan27ImageDescription, ['1k', '2k'])
];

const IMAGE_SPECS: ReadonlyMap<string, ImageSpec> = new Map(IMAGE_MODEL_SPECS.map(spec => [spec.model.id, spec]));

const PROVIDER: CatalogProvider = {
	id: 'alibaba',
	label: LABELS.provider,
	regions: [
		{ id: 'cn', label: LABELS.regionCn, baseUrl: 'https://dashscope.aliyuncs.com', console: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key' },
		{ id: 'intl', label: LABELS.regionIntl, baseUrl: 'https://dashscope-intl.aliyuncs.com', console: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/settings/api-key' }
	],
	credentials: [{ id: 'apiKey', label: LABELS.apiKey, placeholder: 'sk-…' }],
	models: [...MODEL_SPECS.map(spec => spec.model), ...IMAGE_MODEL_SPECS.map(spec => spec.model)]
};

// --- check -----------------------------------------------------------------------------------------

const RATE_LIMIT_NOTE = 'Alibaba Cloud takes at most 5 requests a second and runs at most 5 tasks at once for each video model.';
const REGION_MEDIA_REASON = 'Alibaba Cloud takes videos and audio only as addresses, and the temporary upload BaseHalf sends them through works in China (Beijing) only.';

function regionOf(value: string): Region {
	return value === 'intl' ? 'intl' : 'cn';
}

function modeLabel(model: CatalogModel, mode: ModeId): string {
	return model.modes.find(entry => entry.id === mode)?.label ?? mode;
}

/** A Chinese character counts as two: HappyHorse takes 5,000 characters or 2,500 Chinese ones. */
function happyHorsePromptLength(prompt: string): number {
	let length = 0;
	for (const character of prompt) {
		length += /\p{Script=Han}/u.test(character) ? 2 : 1;
	}
	return length;
}

/** Videos and audio outside China; Edit and Extend are offered in China only by their modes' regions. */
function regionProblems(request: CheckRequest, counts: PlannedCounts): string[] {
	if (regionOf(request.region) === 'cn') {
		return [];
	}
	if (counts.videos > 0 || counts.audios > 0) {
		const kinds = counts.videos > 0 && counts.audios > 0 ? 'videos and audio' : counts.videos > 0 ? 'videos' : 'audio';
		return [`${REGION_MEDIA_REASON} Choose China (Beijing) in Providers, or leave out the ${kinds}.`];
	}
	return [];
}

/** How long the connected videos are, as a limit's reason or a problem begins (alibaba.md, "Ranges that the inputs narrow"). */
function wan3VideosLast(videos: number, seconds: number): string {
	return videos === 1 ? `The connected video lasts ${formatSeconds(seconds)} seconds` : `The connected videos last ${formatSeconds(seconds)} seconds`;
}

/** The ranges that the inputs narrow (D70): the duration that Wan 3.0's videos and Wan 2.7's reference video leave room for. */
function taskLimits(spec: ModelSpec, routed: Task, counts: PlannedCounts, measured: readonly MeasuredItem[]): Record<string, CheckLimit> {
	const label = spec.model.label;
	switch (routed.family) {
		case 'wan3': {
			const seconds = knownVideoSeconds(measured);
			const longest = seconds === undefined ? undefined : Math.floor(WAN3_LONGEST_SECONDS + WAN3_MEASURE_SLACK - seconds);
			if (seconds !== undefined && seconds > 0 && longest !== undefined && longest >= WAN3_SHORTEST_SECONDS) {
				return { duration: { max: longest, reason: `${wan3VideosLast(counts.videos, seconds)}, and ${label} makes at most ${WAN3_LONGEST_SECONDS} seconds with ${counts.videos === 1 ? 'it' : 'them'}.` } };
			}
			return {};
		}
		case 'wan27-r2v':
			return counts.videos > 0 ? { duration: { max: WAN27_LONGEST_WITH_VIDEO, reason: `With a reference video, ${label} makes at most ${WAN27_LONGEST_WITH_VIDEO} seconds.` } } : {};
		default:
			return {};
	}
}

/** The total length of the measured videos, when every one is known. */
function knownVideoSeconds(measured: readonly MeasuredItem[]): number | undefined {
	let total = 0;
	for (const item of measured) {
		if (item.kind === 'video') {
			if (item.facts.seconds === undefined) {
				return undefined;
			}
			total += item.facts.seconds;
		}
	}
	return total;
}

/** The rules of the routed task that the model's declarations cannot express. */
function taskProblems(spec: ModelSpec, routed: Task, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	const params = request.params;
	const label = spec.model.label;
	const mode = modeLabel(spec.model, request.mode);
	switch (routed.family) {
		case 'wan3': {
			const seconds = knownVideoSeconds(measured);
			// A duration beyond the room the videos leave is fitted to it (taskLimits): this is the case of no room at all.
			if (typeof params.duration === 'number' && params.duration !== WAN3_AUTO_DURATION && seconds !== undefined && seconds > 0 && seconds + params.duration > WAN3_LONGEST_SECONDS + WAN3_MEASURE_SLACK) {
				problems.push(`${wan3VideosLast(counts.videos, seconds)}; ${label} makes at most ${WAN3_LONGEST_SECONDS} seconds with ${counts.videos === 1 ? 'it' : 'them'}, which leaves no room for a result. Leave out a video, or choose Auto.`);
			}
			break;
		}
		case 'wan27-r2v': {
			const references = counts.images + counts.videos;
			if (references === 0) {
				problems.push(`${label} in ${mode} mode needs at least one reference image or video.`);
			} else if (references > 5) {
				problems.push(`${label} in ${mode} mode takes at most 5 reference images and videos together; ${references} are planned.`);
			}
			break;
		}
		case 'wan26-t2v':
		case 'wan26-i2v':
			if (params.shot_type === 'multi' && params.prompt_extend === false) {
				problems.push(`${LABELS.multipleShots} shots need ${LABELS.promptExtend}: turn ${LABELS.promptExtend} on, or choose a single shot.`);
			}
			break;
		case 'happyhorse-t2v':
		case 'happyhorse-i2v':
		case 'happyhorse-r2v': {
			// A prompt over 5,000 characters is refused by the declarations already.
			const length = happyHorsePromptLength(request.prompt);
			if (length > 5000 && [...request.prompt].length <= 5000) {
				problems.push(`The prompt is too long for ${label}: it takes 5000 characters, a Chinese character counting as two, and this one counts ${length}.`);
			}
			break;
		}
		default:
			break;
	}
	// The model declares the prompt rule of its loosest task; reference to video needs a prompt.
	if ((routed.family === 'wan27-r2v' || routed.family === 'happyhorse-r2v') && !request.prompt.trim()) {
		problems.push(`Write a prompt: ${label} needs one in ${mode} mode.`);
	}
	return problems;
}

/** Audio the provider does not take, and images too large to send together. */
function formatProblems(measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	let encodedImages = 0;
	for (const item of measured) {
		if (item.kind === 'image') {
			encodedImages += base64Length(item.facts.bytes);
		} else if (item.kind === 'audio' && item.facts.format === 'm4a') {
			problems.push(`${item.label} is M4A audio; Alibaba Cloud takes WAV or MP3.`);
		}
	}
	const limit = DEFAULT_HTTP_OPTIONS.maxRequestBytes;
	if (encodedImages > limit) {
		problems.push(`The images are ${describeBytes(encodedImages)} together once encoded; AI Video sends at most ${describeBytes(limit)} in one request. Use fewer or smaller images.`);
	}
	return problems;
}

function formatSeconds(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// --- requests --------------------------------------------------------------------------------------

/** The provider's media type of each planned slot, by family. */
const MEDIA_TYPES: Readonly<Record<Family, Partial<Record<PlannedItem['slot'], string>>>> = Object.freeze({
	'wan3': { startFrame: 'first_frame', endFrame: 'last_frame', image: 'reference_image', video: 'reference_video', audio: 'reference_audio', source: 'reference_video' },
	'wan27-t2v': {},
	'wan27-i2v': { startFrame: 'first_frame', endFrame: 'last_frame', source: 'first_clip' },
	'wan27-r2v': { image: 'reference_image', video: 'reference_video' },
	'wan27-edit': { source: 'video', image: 'reference_image' },
	'wan26-t2v': {},
	'wan26-i2v': { startFrame: 'img_url' },
	'happyhorse-t2v': {},
	'happyhorse-i2v': { startFrame: 'first_frame' },
	'happyhorse-r2v': { image: 'reference_image' }
});

/** A path under the endpoint's `/api/v1`, which the endpoint may already end with. */
function apiPath(http: ProviderHttp, path: string): string {
	return /\/api\/v1$/i.test(http.endpoint.pathname) ? path : `/api/v1${path}`;
}

function taskPath(http: ProviderHttp, remoteId: string, suffix = ''): string {
	return apiPath(http, `/tasks/${encodeURIComponent(remoteId)}${suffix}`);
}

/** The width and height of an image, as its header gives them. */
interface Shape {
	readonly width: number;
	readonly height: number;
}

/** An image as `data:<type>;base64,…`, its type read from its bytes, with its shape. */
async function readImage(media: Media, label: string, maxBytes: number): Promise<{ readonly dataUrl: string; readonly shape?: Shape }> {
	const read = await readMedia(media, maxBytes, label);
	const { format, width, height } = await measure(bufferSource(read.bytes));
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(`${label} is not a PNG, JPEG, or WebP image.`);
	}
	return { dataUrl: dataUrlOf(read, MEDIA_MIME_TYPES[format]), ...(width && height ? { shape: { width, height } } : {}) };
}

/** An image as `data:<type>;base64,…`, its type read from its bytes. */
async function imageDataUrl(media: Media, label: string, maxBytes: number): Promise<string> {
	return (await readImage(media, label, maxBytes)).dataUrl;
}

interface UploadPolicy {
	readonly policy: string;
	readonly signature: string;
	readonly uploadDir: string;
	readonly uploadHost: string;
	readonly accessKeyId: string;
	readonly objectAcl: string;
	readonly forbidOverwrite: string;
	readonly maxBytes?: number;
}

async function uploadPolicy(http: ProviderHttp, providerModel: string): Promise<UploadPolicy> {
	const answer = await http.request({
		method: 'GET',
		path: apiPath(http, '/uploads'),
		query: { action: 'getPolicy', model: providerModel },
		headers: { 'Content-Type': 'application/json' }
	});
	const data = answer.object().data;
	const text = (name: string): string => {
		const value = isRecord(data) ? data[name] : undefined;
		if (typeof value !== 'string' || !value) {
			throw unreadable('Alibaba Cloud answered the upload request in a form AI Video cannot read.');
		}
		return value;
	};
	const megabytes = isRecord(data) ? Number(data.max_file_size_mb) : NaN;
	return {
		policy: text('policy'),
		signature: text('signature'),
		uploadDir: text('upload_dir').replace(/\/+$/, ''),
		uploadHost: text('upload_host'),
		accessKeyId: text('oss_access_key_id'),
		objectAcl: text('x_oss_object_acl'),
		forbidOverwrite: text('x_oss_forbid_overwrite'),
		...(Number.isFinite(megabytes) && megabytes > 0 ? { maxBytes: megabytes * MiB } : {})
	};
}

/** The `<Code>` and `<Message>` of an OSS error answer, which is XML. */
function ossError(body: Buffer): { readonly code?: string; readonly message?: string } {
	const text = body.toString('utf8');
	const code = /<Code>([^<]{1,100})<\/Code>/.exec(text)?.[1];
	const message = /<Message>([^<]{1,500})<\/Message>/.exec(text)?.[1];
	return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/** A planned input's label, such as "The source video clip.mp4", inside a sentence. */
function inSentence(label: string): string {
	return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Uploads a video or an audio clip to the provider's temporary storage and answers its `oss://` address, usable with `providerModel` only. */
async function uploadedAddress(http: ProviderHttp, providerModel: string, media: Media, label: string, maxBytes: number): Promise<string> {
	const read = await readMedia(media, maxBytes, label);
	const { format } = await measure(bufferSource(read.bytes));
	if (format !== 'mp4' && format !== 'mov' && format !== 'wav' && format !== 'mp3') {
		throw rejected(`${label} is not an MP4 or MOV video or a WAV or MP3 clip.`);
	}
	const policy = await uploadPolicy(http, providerModel);
	if (policy.maxBytes !== undefined && read.bytes.byteLength > policy.maxBytes) {
		throw rejected(`${label} is ${describeBytes(read.bytes.byteLength)}; Alibaba Cloud's temporary storage takes at most ${describeBytes(policy.maxBytes)} for this model.`);
	}
	// Its own name: a retried upload that finds its earlier copy can only find its own.
	const fileName = `${randomUUID()}.${format}`;
	const key = `${policy.uploadDir}/${fileName}`;
	const parts: FormPart[] = [
		{ name: 'OSSAccessKeyId', value: policy.accessKeyId },
		{ name: 'Signature', value: policy.signature },
		{ name: 'policy', value: policy.policy },
		{ name: 'x-oss-object-acl', value: policy.objectAcl },
		{ name: 'x-oss-forbid-overwrite', value: policy.forbidOverwrite },
		{ name: 'key', value: key },
		{ name: 'success_action_status', value: '200' },
		// The file goes last, as OSS requires.
		{ name: 'file', file: { bytes: read.bytes, fileName, contentType: MEDIA_MIME_TYPES[format] } }
	];
	const answer = await http.request({ method: 'POST', url: policy.uploadHost, body: { kind: 'form', parts }, accept: [400, 403, 404, 409, 411, 413] });
	if (answer.status >= 200 && answer.status < 300) {
		return `oss://${key}`;
	}
	const error = ossError(answer.body);
	if (answer.status === 409 && error.code === 'FileAlreadyExists') {
		return `oss://${key}`;
	}
	throw rejected(`Alibaba Cloud's temporary storage refused ${inSentence(label)} (HTTP ${answer.status}${error.code ? `, ${error.code}` : ''})${error.message ? `: ${error.message}` : '.'}`, answer.status);
}

function limitOf(limits: ModeLimits, kind: 'image' | 'video' | 'audio'): number {
	switch (kind) {
		case 'image': return limits.imageMaxBytes ?? 20 * MiB;
		case 'video': return limits.videoMaxBytes ?? 100 * MiB;
		case 'audio': return limits.audioMaxBytes ?? 15 * MiB;
	}
}

type MediaEntry = { readonly type: string; readonly url: string };

/** The planned inputs as the routed task's media entries, the video worked on first. */
async function mediaEntries(spec: ModelSpec, routed: Task, request: SubmitRequest, http: ProviderHttp): Promise<{ readonly entries: MediaEntry[]; readonly uploaded: boolean }> {
	const mode = spec.model.modes.find(entry => entry.id === request.mode);
	const items = plannedItems(request.inputs);
	const ordered = [...items.filter(item => item.slot === 'source'), ...items.filter(item => item.slot !== 'source')];
	const entries: MediaEntry[] = [];
	let uploaded = false;
	for (const item of ordered) {
		const type = MEDIA_TYPES[routed.family][item.slot];
		if (!type || !mode) {
			throw rejected(`${spec.model.label} in ${modeLabel(spec.model, request.mode)} mode does not take ${inSentence(item.label)}.`);
		}
		const kind = item.slot === 'video' || item.slot === 'source' ? 'video' : item.slot === 'audio' ? 'audio' : 'image';
		if (kind === 'image') {
			entries.push({ type, url: await imageDataUrl(item.media, item.label, limitOf(mode.limits, 'image')) });
			continue;
		}
		if (regionOf(request.region) !== 'cn') {
			throw rejected(REGION_MEDIA_REASON);
		}
		// An upload is bound to the model that uses it.
		entries.push({ type, url: await uploadedAddress(http, routed.id, item.media, item.label, limitOf(mode.limits, kind)) });
		uploaded = true;
	}
	return { entries, uploaded };
}

/** The routed task's `parameters`: each catalog parameter it takes, under Alibaba's name and value. */
function providerParameters(routed: Task, mode: ModeId, params: Params): Record<string, ParamValue> {
	const sent: Record<string, ParamValue> = {};
	for (const [name, value] of Object.entries(params)) {
		if (!routed.takes.has(name) || name === 'negative_prompt') {
			continue;
		}
		if (name === 'resolution') {
			sent.resolution = RESOLUTION_VALUES[value as Resolution] ?? String(value);
		} else if (name === 'sound') {
			sent.audio = value;
		} else {
			sent[name] = value;
		}
	}
	if (routed.family === 'wan26-t2v') {
		// Wan 2.6 Text to Video takes its resolution and ratio as one size.
		const size = WAN26_SIZES.get(`${String(params.resolution)} ${String(params.ratio)}`);
		if (!size) {
			throw rejected(`${routed.id} has no size for ${String(params.resolution)} at ${String(params.ratio)}.`);
		}
		delete sent.resolution;
		delete sent.ratio;
		sent.size = size;
	}
	if (routed.family === 'wan3' && (mode === 'edit' || mode === 'extend')) {
		// As the provider's guide recommends: the ratio and the length follow the video.
		sent.ratio = 'adaptive';
		sent.duration = WAN3_AUTO_DURATION;
	}
	return sent;
}

/** The body of a create: the routed task's id, its `input`, and its `parameters`. */
function requestBody(routed: Task, request: SubmitRequest, entries: readonly MediaEntry[]): Record<string, unknown> {
	const input: Record<string, unknown> = {};
	if (request.prompt.trim()) {
		input.prompt = request.prompt;
	}
	const negativePrompt = request.params.negative_prompt;
	if (routed.takes.has('negative_prompt') && typeof negativePrompt === 'string' && negativePrompt.trim()) {
		input.negative_prompt = negativePrompt;
	}
	if (routed.family === 'wan26-i2v') {
		const frame = entries.find(entry => entry.type === 'img_url');
		if (frame) {
			input.img_url = frame.url;
		}
	} else if (entries.length) {
		input.media = entries;
	}
	return { model: routed.id, input, parameters: providerParameters(routed, request.mode, request.params) };
}

// --- image requests --------------------------------------------------------------------------------

/** Sizes are whole multiples of 16, and their shape is at most 8:1 either way. */
const IMAGE_SIZE_STEP = 16;
const IMAGE_MAX_ASPECT = 8;

function greatestDivisor(a: number, b: number): number {
	return b === 0 ? a : greatestDivisor(b, a % b);
}

/**
 * `W*H` in exactly a ratio such as `16:9`, in whole multiples of 16, as large
 * as the square of `side` pixels allows (alibaba.md, "Image parameters").
 */
function sizeOfRatio(ratio: string, side: number): string {
	const [width, height] = ratio.split(':').map(Number);
	const divisor = greatestDivisor(width, height);
	const across = IMAGE_SIZE_STEP * width / divisor;
	const down = IMAGE_SIZE_STEP * height / divisor;
	const pixels = side * side;
	let steps = Math.max(1, Math.floor(Math.sqrt(pixels / (across * down))));
	while (across * down * (steps + 1) * (steps + 1) <= pixels) {
		steps++;
	}
	while (steps > 1 && across * down * steps * steps > pixels) {
		steps--;
	}
	return `${across * steps}*${down * steps}`;
}

/** `W*H` of a shape at the square of `side` pixels: rounded down to multiples of 16, the shape held within 1:8 to 8:1. */
function sizeOfShape(shape: Shape, side: number): string {
	const aspect = Math.min(IMAGE_MAX_ASPECT, Math.max(1 / IMAGE_MAX_ASPECT, shape.width / shape.height));
	const floor = (value: number) => Math.max(IMAGE_SIZE_STEP, Math.floor(value / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP);
	let width = floor(side * Math.sqrt(aspect));
	let height = floor(side / Math.sqrt(aspect));
	// Rounding can tip the shape past 8:1; shortening the long side only makes the image smaller.
	width = Math.min(width, height * IMAGE_MAX_ASPECT);
	height = Math.min(height, width * IMAGE_MAX_ASPECT);
	return `${width}*${height}`;
}

/**
 * The `size` an image model is sent: a ratio at the resolution's pixels; for
 * Adaptive, Wan's level alone, and for Qwen the shape of the last reference
 * image at the resolution's pixels, or its square without one.
 */
function imageSize(spec: ImageSpec, params: Params, lastReference: Shape | undefined): string {
	const level = String(params.resolution) as ImageLevel;
	if (!Object.hasOwn(IMAGE_LEVEL_SIDES, level)) {
		throw rejected(`${spec.model.label} has no resolution ${String(params.resolution)}.`);
	}
	const side = IMAGE_LEVEL_SIDES[level];
	if (params.ratio !== 'adaptive') {
		return sizeOfRatio(String(params.ratio), side);
	}
	if (spec.family === 'wan') {
		return IMAGE_LEVEL_NAMES[level];
	}
	return lastReference ? sizeOfShape(lastReference, side) : `${side}*${side}`;
}

/** The body of an image model's create: one message of the references in order and then the prompt, and the parameters under Alibaba's names. */
async function imageRequestBody(spec: ImageSpec, request: SubmitRequest): Promise<Record<string, unknown>> {
	const content: Record<string, string>[] = [];
	const maxBytes = limitOf(spec.model.modes[0].limits, 'image');
	let lastReference: Shape | undefined;
	for (const item of plannedItems(request.inputs)) {
		if (item.slot !== 'image') {
			throw rejected(`${spec.model.label} takes reference images only.`);
		}
		const image = await readImage(item.media, item.label, maxBytes);
		content.push({ image: image.dataUrl });
		lastReference = image.shape;
	}
	content.push({ text: request.prompt });
	const params = request.params;
	const parameters: Record<string, ParamValue> = { size: imageSize(spec, params, lastReference) };
	if (typeof params.count === 'number') {
		parameters.n = params.count;
	}
	if (spec.family === 'qwen') {
		const negativePrompt = params.negative_prompt;
		if (typeof negativePrompt === 'string' && negativePrompt.trim()) {
			parameters.negative_prompt = negativePrompt;
		}
		if (typeof params.prompt_extend === 'boolean') {
			parameters.prompt_extend = params.prompt_extend;
		}
	}
	if (typeof params.watermark === 'boolean') {
		parameters.watermark = params.watermark;
	}
	if (typeof params.seed === 'number') {
		parameters.seed = params.seed;
	}
	return { model: spec.model.providerModels[request.region], input: { messages: [{ role: 'user', content }] }, parameters };
}

/**
 * The images of an answer, in order: every `image` of every choice's content.
 * A 2xx answer without choices that carries a code is a refusal; one without
 * either cannot be read, though the images may have been made.
 */
function imageOutputsOf(body: Record<string, unknown>): OutputLocation[] {
	const output = body.output;
	const choices = isRecord(output) ? output.choices : undefined;
	if (!Array.isArray(choices)) {
		const reading = typeof body.code === 'string' && body.code.trim() ? readAlibabaError(200, body) : undefined;
		if (reading) {
			throw new ProviderFailure(reading.code ?? 'rejected', reading.message ?? 'Alibaba Cloud refused the request.');
		}
		throw unknownOutcome('Alibaba Cloud accepted the request but answered without images AI Video can read.');
	}
	const outputs: OutputLocation[] = [];
	for (const choice of choices) {
		const message = isRecord(choice) ? choice.message : undefined;
		const content = isRecord(message) && Array.isArray(message.content) ? message.content : [];
		for (const item of content) {
			if (isRecord(item) && typeof item.image === 'string' && item.image.trim()) {
				outputs.push({ url: item.image.trim() });
			}
		}
	}
	return outputs;
}

/** A refused create of an image model, read as every error is, with the model's own limit when it is a rate limit. */
function imageCreateRefused(spec: ImageSpec, answer: HttpAnswer): ProviderFailure {
	let body: unknown;
	try {
		body = answer.json();
	} catch {
		body = undefined;
	}
	const failure = failureForStatus(answer.status, readAlibabaError(answer.status, body, spec.rateLimit), true);
	const asked = retryAfterMs(answer.headers['retry-after']);
	return failure.code === 'rateLimited' && asked !== undefined && asked > 0
		? new ProviderFailure(failure.code, `${failure.message} The provider asks to wait ${Math.ceil(asked / 1000)} seconds.`, failure.status)
		: failure;
}

/** Rules of an image model that its declarations cannot express, and a request too large to send. */
async function imageCheck(spec: ImageSpec, request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
	const problems: string[] = [];
	if (request.params.resolution === '4k' && countsOf(request.inputs).images > 0) {
		problems.push(`${spec.model.label} makes 4K images from the prompt alone; with reference images, choose 1K or 2K.`);
	}
	problems.push(...formatProblems(await measureItems(request.inputs, media)));
	return { problems, providerModel: spec.model.providerModels[request.region] };
}

/** Sends an image model's request once and answers its images (alibaba.md, "Image requests"). */
async function imageSubmit(spec: ImageSpec, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	if (spec.model.providerModels[request.region] === undefined) {
		throw rejected(`${LABELS.provider} does not offer ${spec.model.label} in this region.`);
	}
	const body = await imageRequestBody(spec, request);
	const answer = await http.create({
		method: 'POST',
		path: apiPath(http, '/services/aigc/multimodal-generation/generation'),
		body: { kind: 'json', value: body },
		// Read here, so that a rate-limited answer names this model's own limit.
		accept: [429]
	});
	if (answer.status === 429) {
		throw imageCreateRefused(spec, answer);
	}
	return { outputs: imageOutputsOf(answer.object()) };
}

/** A task's state from its query answer. */
function pollStateOf(body: Record<string, unknown>): PollState {
	const output = body.output;
	if (!isRecord(output) || typeof output.task_status !== 'string') {
		throw unreadable('Alibaba Cloud answered about the task in a form AI Video cannot read.');
	}
	const reason = () => {
		const message = typeof output.message === 'string' ? output.message.trim() : '';
		const code = typeof output.code === 'string' ? output.code.trim() : '';
		return [message, code ? `(${code})` : ''].filter(Boolean).join(' ');
	};
	switch (output.task_status) {
		case 'PENDING':
			return { state: 'pending' };
		case 'RUNNING':
			return { state: 'running' };
		case 'SUCCEEDED':
			return typeof output.video_url === 'string' && output.video_url ? { state: 'succeeded', videoUrl: output.video_url } : { state: 'succeeded' };
		case 'FAILED':
			return { state: 'failed', message: reason() || 'Alibaba Cloud reports that the task failed.' };
		case 'CANCELED':
			return { state: 'cancelled', message: reason() || 'Alibaba Cloud reports that the task was cancelled.' };
		case 'UNKNOWN':
			throw new ProviderFailure('notFound', 'Alibaba Cloud does not know this task: it does not exist, or it is older than 24 hours.');
		default:
			throw unreadable(`Alibaba Cloud reports a task state AI Video does not know: ${output.task_status.slice(0, 40)}.`);
	}
}

/** Provider codes that say more than their HTTP status. */
const ERROR_CODES: Readonly<Record<string, ProviderErrorReading['code']>> = Object.freeze({
	'Arrearage': 'balance',
	'PrepaidBillOverdue': 'balance',
	'PostpaidBillOverdue': 'balance',
	'BudgetLimitExceeded': 'balance',
	'AllocationQuota.FreeTierOnly': 'balance',
	'CommodityNotPurchased': 'rejected',
	'DataInspectionFailed': 'rejected',
	'IPInfringementSuspect': 'rejected'
});

/** The pages advise generating again without Prompt Rewriting when the intellectual-property check refuses. */
const PROMPT_REWRITING_ADVICE = 'Prompt Rewriting can cause this: turn it off and generate again.';
/** The shared hosts get no new features after 2026-09-30 (alibaba.md, "Requests"). */
const WORKSPACE_HOST_ADVICE = 'A model released after September 30, 2026 may be offered only on the host of your workspace: enter its API host, from the Model Studio console, as the Endpoint in Providers.';

/**
 * An error answer of DashScope, `{code, message, request_id}`: its message with
 * its code and what the user can do, and the contract's code where the
 * provider's says more. A rate-limited answer adds `rateLimitNote`.
 */
function readAlibabaError(status: number, body: unknown, rateLimitNote = RATE_LIMIT_NOTE): ProviderErrorReading | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const code = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : undefined;
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	const throttled = status === 429 && (code === undefined || code.startsWith('Throttling'));
	const unknownModel = code === 'ModelNotFound' || (code === 'InvalidParameter' && /model not exist/i.test(message));
	const advice = unknownModel ? WORKSPACE_HOST_ADVICE : code === 'IPInfringementSuspect' ? PROMPT_REWRITING_ADVICE : '';
	const text = [message, code ? `(${code})` : '', throttled ? rateLimitNote : '', advice].filter(Boolean).join(' ');
	const mapped = code && Object.hasOwn(ERROR_CODES, code) ? ERROR_CODES[code] : undefined;
	return text || mapped ? { ...(text ? { message: text } : {}), ...(mapped ? { code: mapped } : {}) } : undefined;
}

function specOf(model: string): ModelSpec {
	const spec = SPECS.get(model);
	if (!spec) {
		throw rejected(`${LABELS.provider} has no model "${model}".`);
	}
	return spec;
}

/**
 * The names of the inputs in a prompt (D74; Alibaba, "Names in the prompt").
 * Wan 3.0 counts each kind in the order of `media`, the clip first, so the
 * clip of an edit or an extension is Video 1 and a start frame Image 1; Wan
 * 2.7's references are `Image 1` and `Video 1`, `图1` and `视频1`;
 * HappyHorse's references are `[Image 1]` in both languages; the image
 * models' images are `image 1` and `图1`. What no page names is written with
 * the shared names.
 */
function writePrompt(prompt: readonly PromptPart[], request: PromptContext): string {
	const language = promptLanguage(prompt);
	const zh = language === 'zh';
	const shared = (input: Parameters<typeof sharedPromptName>[0]) => sharedPromptName(input, language);
	if (IMAGE_SPECS.has(request.model)) {
		return writePromptNames(prompt, input => input.input === 'images' ? (zh ? `图${referenceNumber(input)}` : `image ${referenceNumber(input)}`) : shared(input));
	}
	const inputs = request.inputs;
	switch (SPECS.get(request.model)?.route(request.mode, countsOf(inputs)).family) {
		case 'wan3': {
			const image = (number: number) => zh ? `图片${number}` : `Image ${number}`;
			const video = (number: number) => zh ? `视频${number}` : `Video ${number}`;
			const frames = (inputs.startFrame ? 1 : 0) + (inputs.endFrame ? 1 : 0);
			const clip = inputs.source ? 1 : 0;
			return writePromptNames(prompt, input => {
				switch (input.input) {
					case 'startFrame': return image(1);
					case 'endFrame': return image(inputs.startFrame ? 2 : 1);
					case 'source': return video(1);
					case 'images': return image(frames + referenceNumber(input));
					case 'videos': return video(clip + referenceNumber(input));
					default: return shared(input);
				}
			});
		}
		case 'wan27-r2v':
			return writePromptNames(prompt, input => input.input === 'images'
				? (zh ? `图${referenceNumber(input)}` : `Image ${referenceNumber(input)}`)
				: input.input === 'videos' ? (zh ? `视频${referenceNumber(input)}` : `Video ${referenceNumber(input)}`) : shared(input));
		case 'happyhorse-r2v':
			return writePromptNames(prompt, input => input.input === 'images' ? `[Image ${referenceNumber(input)}]` : shared(input));
		default:
			return writePromptNames(prompt, shared);
	}
}

export const ALIBABA: ProviderModule = Object.freeze({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
		return { Authorization: `Bearer ${credentials.apiKey}` };
	},

	readError: readAlibabaError,

	writePrompt,

	async check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
		const image = IMAGE_SPECS.get(request.model);
		if (image) {
			return imageCheck(image, request, media);
		}
		const spec = SPECS.get(request.model);
		if (!spec) {
			return { problems: [] };
		}
		const counts = countsOf(request.inputs);
		const routed = spec.route(request.mode, counts);
		const measured = await measureItems(request.inputs, media);
		const problems = [
			...regionProblems(request, counts),
			...taskProblems(spec, routed, request, counts, measured),
			...formatProblems(measured)
		];
		const limits = taskLimits(spec, routed, counts, measured);
		return { problems, providerModel: routed.id, ...(Object.keys(limits).length ? { limits } : {}) };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
		const image = IMAGE_SPECS.get(request.model);
		if (image) {
			return imageSubmit(image, request, http);
		}
		const spec = specOf(request.model);
		if (spec.model.providerModels[request.region] === undefined) {
			throw rejected(`${LABELS.provider} does not offer ${spec.model.label} in this region.`);
		}
		// The task check answered: the same mode and inputs choose it.
		const routed = spec.route(request.mode, countsOf(request.inputs));
		const { entries, uploaded } = await mediaEntries(spec, routed, request, http);
		const answer = await http.create({
			method: 'POST',
			path: apiPath(http, '/services/aigc/video-generation/video-synthesis'),
			headers: {
				'X-DashScope-Async': 'enable',
				...(uploaded ? { 'X-DashScope-OssResourceResolve': 'enable' } : {})
			},
			body: { kind: 'json', value: requestBody(routed, request, entries) }
		});
		const output = answer.object().output;
		const taskId = isRecord(output) ? output.task_id : undefined;
		if (typeof taskId !== 'string' || !taskId) {
			throw unknownOutcome('Alibaba Cloud accepted the request but gave no task id AI Video can read.');
		}
		return taskId;
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return pollStateOf((await http.request({ method: 'GET', path: taskPath(http, ref.remoteId) })).object());
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const state = pollStateOf((await http.request({ method: 'GET', path: taskPath(http, ref.remoteId) })).object());
		if (state.state === 'succeeded' && state.videoUrl) {
			return { url: state.videoUrl };
		}
		throw unreadable('Alibaba Cloud gave no video address for this task.');
	},

	async cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean> {
		const answer = await http.requestOnce({ method: 'POST', path: taskPath(http, ref.remoteId, '/cancel'), accept: [400] });
		if (answer.status !== 400) {
			return true;
		}
		let body: unknown;
		try {
			body = answer.json();
		} catch {
			body = undefined;
		}
		if (isRecord(body) && body.code === 'UnsupportedOperation') {
			// Only a task that waits in the queue can be cancelled.
			return false;
		}
		throw rejected(readAlibabaError(400, body)?.message ?? 'Alibaba Cloud refused to cancel the task (HTTP 400).', 400);
	}
});
