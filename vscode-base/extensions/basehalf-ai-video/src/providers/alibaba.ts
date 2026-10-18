/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { countsOf, estimateOf, isPlannedMedia, measureItems, type MeasuredItem } from './check.ts';
import { isRecord, ProviderFailure, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type FormPart, type ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector, type PlannedItem } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type {
	CatalogModel,
	CatalogParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
	ChoiceParameter,
	Currency,
	Estimate,
	Media,
	ModeId,
	ModeInputs,
	ModeLimits,
	NumberParameter,
	Params,
	ParamValue,
	PlannedCounts,
	PollState,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * Alibaba Cloud Model Studio (DashScope): the Wan and HappyHorse video models
 * with the user's own key (D59; docs/specs/video-providers/alibaba.md).
 *
 * The catalog lists one model per version. Alibaba has one model id per task
 * of a version (text to video, image to video, references, editing); the mode
 * and the inputs of a generation choose the task, `check` answers its id, and
 * `submit` sends that id. One create endpoint serves every task, each with its
 * own `input` and `parameters`. Images go inline as data URLs. Videos and
 * audio are taken only as addresses, so in China (Beijing) they go through the
 * provider's temporary upload, and elsewhere `check` refuses them.
 */

type Region = 'cn' | 'intl';

/** How a task's request is built and its price counted. */
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
type PriceTable = Readonly<Partial<Record<Resolution, number>>>;
type RegionPrices = Readonly<Record<Region, PriceTable>>;

/** One of Alibaba's model ids: the task a generation of a catalog model runs. */
interface Task {
	/** Alibaba's model id, the same in both regions. */
	readonly id: string;
	readonly family: Family;
	/** Per second of video, by resolution, in the region's currency. */
	readonly prices: RegionPrices;
	/** Per second of a video without sound, for a task whose price depends on it. */
	readonly silentPrices?: RegionPrices;
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
	provider: 'Alibaba (Wan)',
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
	wan26FlashDescription: 'A start frame to video, faster, with or without sound; 2 to 15 seconds.'
});

// --- regions and prices ----------------------------------------------------------------------------

const CURRENCIES: Readonly<Record<Region, Currency>> = Object.freeze({ cn: 'CNY', intl: 'USD' });

/** The dates of the price lists the prices below were read from. */
const PRICE_DATES: Readonly<Record<Region, string>> = Object.freeze({ cn: '2026-10-18', intl: '2026-10-15' });

const PRICES = Object.freeze({
	/** List prices; a limited-time 30% discount applies on 2026-10-19. */
	wan3: { cn: { '480p': 0.3, '720p': 0.6, '1080p': 1.2 }, intl: { '480p': 0.05, '720p': 0.1, '1080p': 0.2 } },
	wan3Prime: { cn: { '480p': 0.45, '720p': 0.9, '1080p': 1.8 }, intl: { '480p': 0.068, '720p': 0.14, '1080p': 0.28 } },
	/** Every Wan 2.7 task, and Wan 2.6 text and image to video. */
	wan27: { cn: { '720p': 0.6, '1080p': 1 }, intl: { '720p': 0.1, '1080p': 0.15 } },
	wan26Flash: { cn: { '720p': 0.3, '1080p': 0.5 }, intl: { '720p': 0.05, '1080p': 0.075 } },
	wan26FlashSilent: { cn: { '720p': 0.15, '1080p': 0.25 }, intl: { '720p': 0.025, '1080p': 0.0375 } },
	happyHorse11: { cn: { '480p': 0.45, '720p': 0.9, '1080p': 1.2 }, intl: { '480p': 0.07, '720p': 0.14, '1080p': 0.18 } },
	happyHorse10: { cn: { '720p': 0.9, '1080p': 1.6 }, intl: { '720p': 0.14, '1080p': 0.24 } }
} satisfies Record<string, RegionPrices>);

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

function task(id: string, family: Family, prices: RegionPrices, takes: readonly string[], silentPrices?: RegionPrices): Task {
	return { id, family, prices, takes: new Set(takes), ...(silentPrices ? { silentPrices } : {}) };
}

function happyHorseTasks(version: '1.1' | '1.0'): { readonly t2v: Task; readonly i2v: Task; readonly r2v: Task } {
	const prices = version === '1.1' ? PRICES.happyHorse11 : PRICES.happyHorse10;
	return {
		t2v: task(`happyhorse-${version}-t2v`, 'happyhorse-t2v', prices, ['resolution', 'ratio', 'duration', 'watermark', 'seed']),
		i2v: task(`happyhorse-${version}-i2v`, 'happyhorse-i2v', prices, ['resolution', 'duration', 'watermark', 'seed']),
		r2v: task(`happyhorse-${version}-r2v`, 'happyhorse-r2v', prices, ['resolution', 'ratio', 'duration', 'watermark', 'seed'])
	};
}

const WAN3_TAKES = ['resolution', 'ratio', 'duration', 'sound', 'prompt_extend', 'watermark', 'seed'];

const TASKS = Object.freeze({
	wan3: task('wan3.0-video', 'wan3', PRICES.wan3, WAN3_TAKES),
	wan3Prime: task('wan3.0-video-prime', 'wan3', PRICES.wan3Prime, WAN3_TAKES),
	wan27T2v: task('wan2.7-t2v', 'wan27-t2v', PRICES.wan27, ['resolution', 'ratio', 'duration', ...WAN_EXTRAS]),
	wan27I2v: task('wan2.7-i2v', 'wan27-i2v', PRICES.wan27, ['resolution', 'duration', ...WAN_EXTRAS]),
	wan27R2v: task('wan2.7-r2v', 'wan27-r2v', PRICES.wan27, ['resolution', 'ratio', 'duration', ...WAN_EXTRAS]),
	wan27Edit: task('wan2.7-videoedit', 'wan27-edit', PRICES.wan27, ['resolution', 'audio_setting', ...WAN_EXTRAS]),
	// Its resolution and ratio are sent together as a size.
	wan26T2v: task('wan2.6-t2v', 'wan26-t2v', PRICES.wan27, ['resolution', 'ratio', 'duration', 'shot_type', ...WAN_EXTRAS]),
	wan26I2v: task('wan2.6-i2v', 'wan26-i2v', PRICES.wan27, ['resolution', 'duration', 'shot_type', ...WAN_EXTRAS]),
	wan26Flash: task('wan2.6-i2v-flash', 'wan26-i2v', PRICES.wan26Flash, ['resolution', 'duration', 'shot_type', 'sound', ...WAN_EXTRAS], PRICES.wan26FlashSilent),
	happyHorse11: happyHorseTasks('1.1'),
	happyHorse10: happyHorseTasks('1.0')
});

// --- declarations --------------------------------------------------------------------------------

const MiB = 1024 * 1024;
const WAN3_AUTO_DURATION = -1;
const WAN3_LONGEST_SECONDS = 30;
const WAN3_SHORTEST_OUTPUT = 2;

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
	return { name: 'resolution', label: LABELS.resolution, kind: 'choice', options: values.map(value => ({ value, label: RESOLUTION_VALUES[value] })), default: '1080p' };
}

const WAN_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);
const HAPPYHORSE_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9']);

/** The ratio of a video made from the prompt or references; a start frame sets the shape itself, so Frames sends it only without one. */
function ratio(values: readonly string[], modes?: readonly ModeId[]): ChoiceParameter {
	return { name: 'ratio', label: LABELS.ratio, tooltip: LABELS.tipFrameShape, kind: 'choice', display: 'ratio', options: options(values), default: '16:9', ...(modes ? { modes } : {}) };
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
const HAPPYHORSE_WATERMARK: CatalogParameter = { name: 'watermark', label: LABELS.watermark, tooltip: LABELS.tipHappyHorseWatermark, kind: 'boolean', default: true, advanced: true };
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
				{ id: 'edit', label: LABELS.modeEdit, inputs: inputs({ images: { min: 0, max: 10 }, source: 'required' }), limits: WAN3_MEDIA },
				{ id: 'extend', label: LABELS.modeExtend, inputs: inputs({ source: 'required' }), limits: WAN3_MEDIA }
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
				{ ...duration(2, WAN3_LONGEST_SECONDS), auto: { value: WAN3_AUTO_DURATION, label: LABELS.auto }, modes: ['frames', 'reference'] },
				SOUND,
				PROMPT_EXTEND,
				WAN_WATERMARK,
				SEED
			],
			estimate: true
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
			],
			estimate: true
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
				{ id: 'edit', label: LABELS.modeEdit, inputs: inputs({ images: { min: 0, max: 4 }, source: 'required' }), limits: { ...WAN_IMAGES, videoSeconds: [2, 10], videoMaxBytes: 100 * MiB } },
				{ id: 'extend', label: LABELS.modeExtend, inputs: inputs({ source: 'required' }), limits: { videoSeconds: [2, 10], videoMaxBytes: 100 * MiB } }
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
			],
			estimate: true
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
			parameters: [WAN27_RESOLUTION, ratio(WAN_RATIOS), duration(2, 15), SHOTS, ...WAN_EXTRA_PARAMETERS],
			estimate: true
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
			parameters: [WAN27_RESOLUTION, duration(2, 15), SHOTS, SOUND, ...WAN_EXTRA_PARAMETERS],
			estimate: true
		}
	},
	happyHorse('1.0')
];

const SPECS: ReadonlyMap<string, ModelSpec> = new Map(MODEL_SPECS.map(spec => [spec.model.id, spec]));

const PROVIDER: CatalogProvider = {
	id: 'alibaba',
	label: LABELS.provider,
	regions: [
		{ id: 'cn', label: LABELS.regionCn, baseUrl: 'https://dashscope.aliyuncs.com', currency: 'CNY', console: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key' },
		{ id: 'intl', label: LABELS.regionIntl, baseUrl: 'https://dashscope-intl.aliyuncs.com', currency: 'USD', console: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/settings/api-key' }
	],
	credentials: [{ id: 'apiKey', label: LABELS.apiKey, placeholder: 'sk-…' }],
	models: MODEL_SPECS.map(spec => spec.model)
};

// --- check -----------------------------------------------------------------------------------------

/** The share of the 5 seconds of input video Wan 2.7 Reference to Video bills, per video, for one to five videos. */
const WAN27_R2V_INPUT_CAPS: readonly number[] = [5, 2.5, 1.65, 1.25, 1];

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

function regionProblems(spec: ModelSpec, request: CheckRequest, counts: PlannedCounts): string[] {
	if (regionOf(request.region) === 'cn') {
		return [];
	}
	// Edit and Extend always send a video, connected yet or not.
	if (request.mode === 'edit' || request.mode === 'extend') {
		return [`${spec.model.label} in ${modeLabel(spec.model, request.mode)} mode sends a video. ${REGION_MEDIA_REASON} Choose China (Beijing) in Video Providers.`];
	}
	if (counts.videos > 0 || counts.audios > 0) {
		const kinds = counts.videos > 0 && counts.audios > 0 ? 'videos and audio' : counts.videos > 0 ? 'videos' : 'audio';
		return [`${REGION_MEDIA_REASON} Choose China (Beijing) in Video Providers, or leave out the ${kinds}.`];
	}
	return [];
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
function taskProblems(spec: ModelSpec, routed: Task, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): string[] {
	const problems: string[] = [];
	const params = request.params;
	const label = spec.model.label;
	const mode = modeLabel(spec.model, request.mode);
	switch (routed.family) {
		case 'wan3': {
			const seconds = measured ? knownVideoSeconds(measured) : undefined;
			if (typeof params.duration === 'number' && params.duration !== WAN3_AUTO_DURATION && seconds !== undefined && seconds > 0 && seconds + params.duration > WAN3_LONGEST_SECONDS + 0.05) {
				problems.push(`The videos are ${formatSeconds(seconds)} seconds long and the result is to be ${params.duration} seconds; together they may be at most ${WAN3_LONGEST_SECONDS} seconds for ${label}. Choose a shorter duration, or Auto.`);
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
			if (counts.videos > 0 && typeof params.duration === 'number' && params.duration > 10) {
				problems.push(`With a reference video, ${label} makes at most 10 seconds; choose 10 seconds or less.`);
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

// --- estimates -------------------------------------------------------------------------------------

/** The input video seconds of a request, from the files when measured, otherwise from the counts and the shortest and longest allowed lengths. */
function inputVideoSeconds(counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined, shortest: number, longest: number, total = Infinity): readonly [number, number] {
	let low = 0;
	let high = 0;
	if (measured) {
		for (const item of measured) {
			if (item.kind === 'video') {
				low += item.facts.seconds ?? shortest;
				high += item.facts.seconds ?? longest;
			}
		}
	} else {
		const videos = counts.videos + (counts.source ? 1 : 0);
		low = videos * shortest;
		high = videos * longest;
	}
	return [low, Math.max(low, Math.min(high, total))];
}

/** Wan 2.7 Reference to Video bills each reference video up to its share of 5 seconds. */
function wan27ReferenceSeconds(counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): readonly [number, number] {
	const videos = measured ? measured.filter(item => item.kind === 'video') : undefined;
	const count = videos ? videos.length : counts.videos;
	if (count === 0) {
		return [0, 0];
	}
	const cap = WAN27_R2V_INPUT_CAPS[Math.min(count, WAN27_R2V_INPUT_CAPS.length) - 1];
	if (!videos) {
		return [count * Math.min(1, cap), count * cap];
	}
	let low = 0;
	let high = 0;
	for (const video of videos) {
		low += Math.min(video.facts.seconds ?? 1, cap);
		high += Math.min(video.facts.seconds ?? cap, cap);
	}
	return [low, high];
}

/** The seconds of video the routed task bills, as a range when something is known only after the run. */
function billedSeconds(routed: Task, mode: ModeId, params: Params, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): readonly [number, number] {
	const duration = typeof params.duration === 'number' ? params.duration : 0;
	switch (routed.family) {
		case 'wan3': {
			// Input videos and the output are billed; together they are at most 30 seconds.
			const [low, high] = inputVideoSeconds(counts, measured, 1, 15, 15);
			if (mode === 'edit' || mode === 'extend' || duration === WAN3_AUTO_DURATION) {
				return [Math.min(low + WAN3_SHORTEST_OUTPUT, WAN3_LONGEST_SECONDS), WAN3_LONGEST_SECONDS];
			}
			return [low + duration, Math.max(low + duration, Math.min(high + duration, WAN3_LONGEST_SECONDS))];
		}
		case 'wan27-r2v': {
			const [low, high] = wan27ReferenceSeconds(counts, measured);
			return [low + duration, high + duration];
		}
		case 'wan27-edit': {
			// The input video and the output, which keeps the length of the input, are billed.
			const [low, high] = inputVideoSeconds(counts, measured, 2, 10);
			return [2 * low, 2 * high];
		}
		default:
			return [duration, duration];
	}
}

function estimateFor(routed: Task, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): Estimate | undefined {
	const region = regionOf(request.region);
	const table = routed.silentPrices && request.params.sound === false ? routed.silentPrices : routed.prices;
	const price = table[region][request.params.resolution as Resolution];
	if (price === undefined) {
		return undefined;
	}
	const [low, high] = billedSeconds(routed, request.mode, request.params, counts, measured);
	return estimateOf(CURRENCIES[region], price * low, price * high, PRICE_DATES[region]);
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

/** An image as `data:<type>;base64,…`, its type read from its bytes. */
async function imageDataUrl(media: Media, label: string, maxBytes: number): Promise<string> {
	const read = await readMedia(media, maxBytes, label);
	const { format } = await measure(bufferSource(read.bytes));
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(`${label} is not a PNG, JPEG, or WebP image.`);
	}
	return dataUrlOf(read, MEDIA_MIME_TYPES[format]);
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
	'CommodityNotPurchased': 'rejected'
});

/** An error answer of DashScope, `{code, message, request_id}`: its message with its code, and the contract's code where the provider's says more. */
function readAlibabaError(status: number, body: unknown): ProviderErrorReading | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const code = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : undefined;
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	const throttled = status === 429 && (code === undefined || code.startsWith('Throttling'));
	const text = [message, code ? `(${code})` : '', throttled ? RATE_LIMIT_NOTE : ''].filter(Boolean).join(' ');
	const mapped = code ? ERROR_CODES[code] : undefined;
	return text || mapped ? { ...(text ? { message: text } : {}), ...(mapped ? { code: mapped } : {}) } : undefined;
}

function specOf(model: string): ModelSpec {
	const spec = SPECS.get(model);
	if (!spec) {
		throw rejected(`${LABELS.provider} has no model "${model}".`);
	}
	return spec;
}

export const ALIBABA: ProviderModule = Object.freeze({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
		return { Authorization: `Bearer ${credentials.apiKey}` };
	},

	readError: readAlibabaError,

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const spec = SPECS.get(request.model);
		if (!spec) {
			return { problems: [] };
		}
		const counts = countsOf(request.inputs);
		const routed = spec.route(request.mode, counts);
		const measured = isPlannedMedia(request.inputs) ? await measureItems(request.inputs, media) : undefined;
		const problems = [
			...regionProblems(spec, request, counts),
			...taskProblems(spec, routed, request, counts, measured),
			...(measured ? formatProblems(measured) : [])
		];
		const estimate = estimateFor(routed, request, counts, measured);
		return { problems, ...(estimate ? { estimate } : {}), providerModel: routed.id };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
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
