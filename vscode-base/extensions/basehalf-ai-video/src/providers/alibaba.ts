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
	CatalogMode,
	CatalogModel,
	CatalogParameter,
	ChoiceParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
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
 * One create endpoint serves every model; each model family has its own
 * `input` and `parameters`. Images go inline as data URLs. Videos and audio
 * are taken only as addresses, so in China (Beijing) they go through the
 * provider's temporary upload, and elsewhere they are refused by `check`.
 */

type Region = 'cn' | 'intl';

/** How a model's request is built and its price counted. */
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

type PriceTable = Readonly<Record<string, number>>;
type RegionPrices = Readonly<Record<Region, PriceTable>>;

interface ModelSpec {
	readonly model: CatalogModel;
	readonly family: Family;
	/** Per second of video, by resolution tier, in the region's currency. */
	readonly prices: RegionPrices;
	/** Per second of a video without sound, for a model whose price depends on it. */
	readonly silentPrices?: RegionPrices;
}

// --- labels ---------------------------------------------------------------------------------------

/** Every label of the provider's catalog entry, in English, in one place to translate later. */
const LABELS = Object.freeze({
	provider: 'Alibaba (Wan)',
	regionCn: 'China (Beijing)',
	regionIntl: 'International (Singapore)',
	apiKey: 'API Key',
	modeText: 'Text',
	modeFrames: 'Frames',
	modeReference: 'References',
	modeEdit: 'Edit',
	modeExtend: 'Extend',
	resolution: 'Resolution',
	ratio: 'Ratio',
	adaptive: 'Adaptive',
	size: 'Size',
	duration: 'Duration',
	auto: 'Auto',
	wholeVideo: 'Whole Video',
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
	tipAdaptive: 'Adaptive follows the inputs.',
	tipExtendDuration: 'In Extend mode, the length of the whole result, the clip included.',
	tipEditDuration: 'Whole Video keeps the length of the video; a shorter duration keeps its beginning.',
	tipAudioSetting: 'Auto lets the model decide from the prompt; Keep Original keeps the sound of the video.',
	tipShots: 'Multiple shots need Prompt Rewriting.',
	tipPromptExtend: 'A language model rewrites the prompt first. It helps short prompts and takes longer.',
	tipWanWatermark: 'Adds “AI Generated” in the lower-right corner.',
	tipHappyHorseWatermark: 'Adds “Happy Horse” in the lower-right corner.',
	tipSeed: 'The same seed and settings give similar results.',
	wan3: 'Wan 3.0',
	wan3Description: 'Text, start and end frames, references (images, videos, and audio), editing, and extension in one model; up to 30 seconds with sound.',
	wan3Prime: 'Wan 3.0 Prime',
	wan3PrimeDescription: 'The faster Wan 3.0, with the same inputs and settings.',
	happyHorse11T2v: 'HappyHorse 1.1 Text to Video',
	happyHorse11I2v: 'HappyHorse 1.1 Image to Video',
	happyHorse11R2v: 'HappyHorse 1.1 Reference to Video',
	happyHorse10T2v: 'HappyHorse 1.0 Text to Video',
	happyHorse10I2v: 'HappyHorse 1.0 Image to Video',
	happyHorse10R2v: 'HappyHorse 1.0 Reference to Video',
	happyHorseT2vDescription: 'Text to video with sound, 3 to 15 seconds.',
	happyHorseI2vDescription: 'A start frame to video with sound, 3 to 15 seconds.',
	happyHorseR2vDescription: 'Up to 9 reference images to video with sound, 3 to 15 seconds.',
	wan27T2v: 'Wan 2.7 Text to Video',
	wan27T2vDescription: 'Text to video with sound and multi-shot storytelling, 2 to 15 seconds.',
	wan27I2v: 'Wan 2.7 Image to Video',
	wan27I2vDescription: 'A start frame, start and end frames, or a clip to continue; 2 to 15 seconds.',
	wan27R2v: 'Wan 2.7 Reference to Video',
	wan27R2vDescription: 'Up to 5 reference images and videos of characters, props, or scenes; 2 to 15 seconds.',
	wan27Edit: 'Wan 2.7 Video Edit',
	wan27EditDescription: 'Changes a clip of 2 to 10 seconds by instruction, with up to 4 reference images.',
	wan26T2v: 'Wan 2.6 Text to Video',
	wan26T2vDescription: 'Text to video with sound and multi-shot storytelling, 2 to 15 seconds.',
	wan26I2v: 'Wan 2.6 Image to Video',
	wan26I2vDescription: 'A start frame to video with sound and multi-shot storytelling, 2 to 15 seconds.',
	wan26I2vFlash: 'Wan 2.6 Image to Video Flash',
	wan26I2vFlashDescription: 'The faster Wan 2.6 Image to Video, with or without sound.'
});

// --- regions and prices ----------------------------------------------------------------------------

const CURRENCIES: Readonly<Record<Region, Currency>> = Object.freeze({ cn: 'CNY', intl: 'USD' });

/** The dates of the price lists the prices below were read from. */
const PRICE_DATES: Readonly<Record<Region, string>> = Object.freeze({ cn: '2026-10-18', intl: '2026-10-15' });

const PRICES = Object.freeze({
	/** List prices; a limited-time 30% discount applies on 2026-10-19. */
	wan3: { cn: { '480P': 0.3, '720P': 0.6, '1080P': 1.2 }, intl: { '480P': 0.05, '720P': 0.1, '1080P': 0.2 } },
	wan3Prime: { cn: { '480P': 0.45, '720P': 0.9, '1080P': 1.8 }, intl: { '480P': 0.068, '720P': 0.14, '1080P': 0.28 } },
	wan27: { cn: { '720P': 0.6, '1080P': 1 }, intl: { '720P': 0.1, '1080P': 0.15 } },
	wan26Flash: { cn: { '720P': 0.3, '1080P': 0.5 }, intl: { '720P': 0.05, '1080P': 0.075 } },
	wan26FlashSilent: { cn: { '720P': 0.15, '1080P': 0.25 }, intl: { '720P': 0.025, '1080P': 0.0375 } },
	happyHorse11: { cn: { '480P': 0.45, '720P': 0.9, '1080P': 1.2 }, intl: { '480P': 0.07, '720P': 0.14, '1080P': 0.18 } },
	happyHorse10: { cn: { '720P': 0.9, '1080P': 1.6 }, intl: { '720P': 0.14, '1080P': 0.24 } }
} satisfies Record<string, RegionPrices>);

/** The sizes of Wan 2.6 Text to Video, their labels, and the tier each is priced at. */
const WAN26_SIZES: readonly (readonly [value: string, label: string, tier: string])[] = [
	['1280*720', '1280 × 720 (16:9)', '720P'],
	['720*1280', '720 × 1280 (9:16)', '720P'],
	['960*960', '960 × 960 (1:1)', '720P'],
	['1088*832', '1088 × 832 (4:3)', '720P'],
	['832*1088', '832 × 1088 (3:4)', '720P'],
	['1920*1080', '1920 × 1080 (16:9)', '1080P'],
	['1080*1920', '1080 × 1920 (9:16)', '1080P'],
	['1440*1440', '1440 × 1440 (1:1)', '1080P'],
	['1632*1248', '1632 × 1248 (4:3)', '1080P'],
	['1248*1632', '1248 × 1632 (3:4)', '1080P']
];
const SIZE_TIERS: ReadonlyMap<string, string> = new Map(WAN26_SIZES.map(([value, , tier]) => [value, tier]));

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

const TEXT_MODE: CatalogMode = { id: 'frames', label: LABELS.modeText, inputs: NO_INPUTS, limits: {} };

function options(values: readonly string[]): { value: string; label: string }[] {
	return values.map(value => ({ value, label: value }));
}

function resolution(values: readonly string[]): ChoiceParameter {
	return { name: 'resolution', label: LABELS.resolution, kind: 'choice', options: options(values), default: '1080P' };
}

const WAN_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);
const HAPPYHORSE_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9']);

function ratio(values: readonly string[]): ChoiceParameter {
	return { name: 'ratio', label: LABELS.ratio, kind: 'choice', display: 'ratio', options: options(values), default: '16:9' };
}

function duration(min: number, max: number): NumberParameter {
	return { name: 'duration', label: LABELS.duration, kind: 'integer', unit: 'seconds', min, max, step: 1, default: 5 };
}

const SOUND: CatalogParameter = { name: 'audio', label: LABELS.sound, kind: 'boolean', default: true };
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

/** The model in both regions under its own id. */
function both(id: string): Readonly<Record<string, string>> {
	return { cn: id, intl: id };
}

function wan3(id: string, label: string, description: string, prices: RegionPrices): ModelSpec {
	return {
		family: 'wan3',
		prices,
		model: {
			id,
			label,
			description,
			providerModels: both(id),
			prompt: { required: 'withoutMedia', maxLength: 20000 },
			modes: [
				{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'optional', endFrame: 'optional' }), limits: WAN_IMAGES },
				{ id: 'reference', label: LABELS.modeReference, inputs: inputs({ images: { min: 0, max: 10 }, videos: { min: 0, max: 5 }, audios: { min: 0, max: 5 } }), limits: WAN3_MEDIA },
				{ id: 'edit', label: LABELS.modeEdit, inputs: inputs({ images: { min: 0, max: 10 }, source: 'required' }), limits: WAN3_MEDIA },
				{ id: 'extend', label: LABELS.modeExtend, inputs: inputs({ source: 'required' }), limits: WAN3_MEDIA }
			],
			parameters: [
				resolution(['480P', '720P', '1080P']),
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

function happyHorse(version: '1.1' | '1.0', kind: 't2v' | 'i2v' | 'r2v', label: string, description: string): ModelSpec {
	const id = `happyhorse-${version}-${kind}`;
	const parameters: CatalogParameter[] = [resolution(version === '1.1' ? ['480P', '720P', '1080P'] : ['720P', '1080P'])];
	if (kind !== 'i2v') {
		parameters.push(ratio(HAPPYHORSE_RATIOS));
	}
	parameters.push(duration(3, 15), HAPPYHORSE_WATERMARK, SEED);
	const mode: CatalogMode = kind === 't2v'
		? TEXT_MODE
		: kind === 'i2v'
			? { id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'required' }), limits: { imageMinSide: 300, imageAspect: [0.4, 2.5], imageMaxBytes: 20 * MiB } }
			: { id: 'reference', label: LABELS.modeReference, inputs: inputs({ images: { min: 1, max: 9 } }), limits: { imageMinSide: 400, imageMaxBytes: 20 * MiB } };
	return {
		family: `happyhorse-${kind}`,
		prices: version === '1.1' ? PRICES.happyHorse11 : PRICES.happyHorse10,
		model: {
			id,
			label,
			description,
			providerModels: both(id),
			prompt: { required: kind === 'i2v' ? 'withoutMedia' : 'always', maxLength: 5000 },
			modes: [mode],
			parameters,
			estimate: true
		}
	};
}

const WAN27_RESOLUTION = resolution(['720P', '1080P']);
const WAN_EXTRAS: readonly CatalogParameter[] = [NEGATIVE_PROMPT, PROMPT_EXTEND, WAN_WATERMARK, SEED];

const MODEL_SPECS: readonly ModelSpec[] = [
	wan3('wan3.0-video', LABELS.wan3, LABELS.wan3Description, PRICES.wan3),
	wan3('wan3.0-video-prime', LABELS.wan3Prime, LABELS.wan3PrimeDescription, PRICES.wan3Prime),
	happyHorse('1.1', 't2v', LABELS.happyHorse11T2v, LABELS.happyHorseT2vDescription),
	happyHorse('1.1', 'i2v', LABELS.happyHorse11I2v, LABELS.happyHorseI2vDescription),
	happyHorse('1.1', 'r2v', LABELS.happyHorse11R2v, LABELS.happyHorseR2vDescription),
	{
		family: 'wan27-t2v',
		prices: PRICES.wan27,
		model: {
			id: 'wan2.7-t2v',
			label: LABELS.wan27T2v,
			description: LABELS.wan27T2vDescription,
			providerModels: both('wan2.7-t2v'),
			prompt: { required: 'always', maxLength: 5000 },
			modes: [TEXT_MODE],
			parameters: [WAN27_RESOLUTION, ratio(WAN_RATIOS), duration(2, 15), ...WAN_EXTRAS],
			estimate: true
		}
	},
	{
		family: 'wan27-i2v',
		prices: PRICES.wan27,
		model: {
			id: 'wan2.7-i2v',
			label: LABELS.wan27I2v,
			description: LABELS.wan27I2vDescription,
			providerModels: both('wan2.7-i2v'),
			prompt: { required: 'withoutMedia', maxLength: 5000 },
			modes: [
				{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'required', endFrame: 'optional' }), limits: WAN_IMAGES },
				{ id: 'extend', label: LABELS.modeExtend, inputs: inputs({ source: 'required' }), limits: { videoSeconds: [2, 10], videoMaxBytes: 100 * MiB } }
			],
			parameters: [WAN27_RESOLUTION, { ...duration(2, 15), tooltip: LABELS.tipExtendDuration }, ...WAN_EXTRAS],
			estimate: true
		}
	},
	{
		family: 'wan27-r2v',
		prices: PRICES.wan27,
		model: {
			id: 'wan2.7-r2v',
			label: LABELS.wan27R2v,
			description: LABELS.wan27R2vDescription,
			providerModels: both('wan2.7-r2v'),
			prompt: { required: 'always', maxLength: 5000 },
			modes: [{ id: 'reference', label: LABELS.modeReference, inputs: inputs({ images: { min: 0, max: 5 }, videos: { min: 0, max: 5 } }), limits: { ...WAN_IMAGES, videoSeconds: [1, 30], videoMaxBytes: 100 * MiB } }],
			parameters: [WAN27_RESOLUTION, ratio(WAN_RATIOS), duration(2, 15), ...WAN_EXTRAS],
			estimate: true
		}
	},
	{
		family: 'wan27-edit',
		prices: PRICES.wan27,
		model: {
			id: 'wan2.7-videoedit',
			label: LABELS.wan27Edit,
			description: LABELS.wan27EditDescription,
			// Its only mode sends a video, which BaseHalf can send only in China (Beijing).
			providerModels: { cn: 'wan2.7-videoedit' },
			prompt: { required: 'withoutMedia', maxLength: 5000 },
			modes: [{ id: 'edit', label: LABELS.modeEdit, inputs: inputs({ images: { min: 0, max: 4 }, source: 'required' }), limits: { ...WAN_IMAGES, videoSeconds: [2, 10], videoMaxBytes: 100 * MiB } }],
			parameters: [
				WAN27_RESOLUTION,
				{ name: 'ratio', label: LABELS.ratio, kind: 'choice', display: 'ratio', options: options(WAN_RATIOS), optional: true },
				{ ...duration(2, 10), default: 0, auto: { value: 0, label: LABELS.wholeVideo }, tooltip: LABELS.tipEditDuration },
				{
					name: 'audio_setting',
					label: LABELS.sound,
					tooltip: LABELS.tipAudioSetting,
					kind: 'choice',
					options: [{ value: 'auto', label: LABELS.soundAuto }, { value: 'origin', label: LABELS.soundOrigin }],
					default: 'auto'
				},
				...WAN_EXTRAS
			],
			estimate: true
		}
	},
	{
		family: 'wan26-t2v',
		prices: PRICES.wan27,
		model: {
			id: 'wan2.6-t2v',
			label: LABELS.wan26T2v,
			description: LABELS.wan26T2vDescription,
			providerModels: both('wan2.6-t2v'),
			prompt: { required: 'always', maxLength: 1500 },
			modes: [TEXT_MODE],
			parameters: [
				{ name: 'size', label: LABELS.size, kind: 'choice', options: WAN26_SIZES.map(([value, label]) => ({ value, label })), default: '1920*1080' },
				duration(2, 15),
				SHOTS,
				...WAN_EXTRAS
			],
			estimate: true
		}
	},
	...(['wan2.6-i2v', 'wan2.6-i2v-flash'] as const).map((id): ModelSpec => {
		const flash = id === 'wan2.6-i2v-flash';
		return {
			family: 'wan26-i2v',
			prices: flash ? PRICES.wan26Flash : PRICES.wan27,
			...(flash ? { silentPrices: PRICES.wan26FlashSilent } : {}),
			model: {
				id,
				label: flash ? LABELS.wan26I2vFlash : LABELS.wan26I2v,
				description: flash ? LABELS.wan26I2vFlashDescription : LABELS.wan26I2vDescription,
				providerModels: both(id),
				prompt: { required: 'withoutMedia', maxLength: 1500 },
				modes: [{ id: 'frames', label: LABELS.modeFrames, inputs: inputs({ startFrame: 'required' }), limits: { imageMinSide: 240, imageMaxSide: 8000, imageMaxBytes: 20 * MiB } }],
				parameters: [WAN27_RESOLUTION, duration(2, 15), SHOTS, ...(flash ? [SOUND] : []), ...WAN_EXTRAS],
				estimate: true
			}
		};
	}),
	happyHorse('1.0', 't2v', LABELS.happyHorse10T2v, LABELS.happyHorseT2vDescription),
	happyHorse('1.0', 'i2v', LABELS.happyHorse10I2v, LABELS.happyHorseI2vDescription),
	happyHorse('1.0', 'r2v', LABELS.happyHorse10R2v, LABELS.happyHorseR2vDescription)
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
	if (counts.source) {
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

function ruleProblems(spec: ModelSpec, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): string[] {
	const problems: string[] = [];
	const params = request.params;
	const model = spec.model;
	switch (spec.family) {
		case 'wan3': {
			const seconds = measured ? knownVideoSeconds(measured) : undefined;
			if (typeof params.duration === 'number' && params.duration !== WAN3_AUTO_DURATION && seconds !== undefined && seconds > 0 && seconds + params.duration > WAN3_LONGEST_SECONDS + 0.05) {
				problems.push(`The videos are ${formatSeconds(seconds)} seconds long and the result is to be ${params.duration} seconds; together they may be at most ${WAN3_LONGEST_SECONDS} seconds for ${model.label}. Choose a shorter duration, or Auto.`);
			}
			break;
		}
		case 'wan27-r2v': {
			const references = counts.images + counts.videos;
			if (references === 0) {
				problems.push(`${model.label} needs at least one reference image or video.`);
			} else if (references > 5) {
				problems.push(`${model.label} takes at most 5 reference images and videos together; ${references} are planned.`);
			}
			if (counts.videos > 0 && typeof params.duration === 'number' && params.duration > 10) {
				problems.push(`With a reference video, ${model.label} makes at most 10 seconds; choose 10 seconds or less.`);
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
				problems.push(`The prompt is too long for ${model.label}: it takes 5000 characters, a Chinese character counting as two, and this one counts ${length}.`);
			}
			break;
		}
		default:
			break;
	}
	return problems;
}

/** Formats the provider does not take, and images too large to send together. */
function formatProblems(measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	let encodedImages = 0;
	for (const item of measured) {
		if (item.kind === 'image') {
			encodedImages += base64Length(item.facts.bytes);
			if (item.facts.format === 'gif') {
				problems.push(`${item.label} is a GIF; Alibaba Cloud takes PNG, JPEG, or WebP images.`);
			}
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

/** The seconds of video billed, as a range when something is known only after the run. */
function billedSeconds(spec: ModelSpec, mode: ModeId, params: Params, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): readonly [number, number] {
	const duration = typeof params.duration === 'number' ? params.duration : 0;
	switch (spec.family) {
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
			// The output is the video, or its beginning when a duration shortens it; whether the
			// whole input or the kept part is billed then is not documented.
			const [low, high] = inputVideoSeconds(counts, measured, 2, 10);
			const kept = (seconds: number) => duration === 0 ? seconds : Math.min(duration, seconds);
			return [2 * kept(low), high + kept(high)];
		}
		default:
			return [duration, duration];
	}
}

function estimateFor(spec: ModelSpec, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): Estimate | undefined {
	const region = regionOf(request.region);
	const tier = spec.family === 'wan26-t2v' ? SIZE_TIERS.get(String(request.params.size)) : String(request.params.resolution);
	const table = spec.silentPrices && request.params.audio === false ? spec.silentPrices : spec.prices;
	const price = tier !== undefined ? table[region][tier] : undefined;
	if (price === undefined) {
		return undefined;
	}
	const [low, high] = billedSeconds(spec, request.mode, request.params, counts, measured);
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

/** Uploads a video or an audio clip to the provider's temporary storage and answers its `oss://` address. */
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

/** A planned input's label, such as "The source video clip.mp4", inside a sentence. */
function inSentence(label: string): string {
	return label.charAt(0).toLowerCase() + label.slice(1);
}

function limitOf(limits: ModeLimits, kind: 'image' | 'video' | 'audio'): number {
	switch (kind) {
		case 'image': return limits.imageMaxBytes ?? 20 * MiB;
		case 'video': return limits.videoMaxBytes ?? 100 * MiB;
		case 'audio': return limits.audioMaxBytes ?? 15 * MiB;
	}
}

/** The planned inputs as the provider's media entries, the video worked on first. */
async function mediaEntries(spec: ModelSpec, request: SubmitRequest, http: ProviderHttp): Promise<{ readonly entries: { readonly type: string; readonly url: string }[]; readonly uploaded: boolean }> {
	const mode = spec.model.modes.find(entry => entry.id === request.mode);
	const providerModel = spec.model.providerModels[request.region];
	const items = plannedItems(request.inputs);
	const ordered = [...items.filter(item => item.slot === 'source'), ...items.filter(item => item.slot !== 'source')];
	const entries: { type: string; url: string }[] = [];
	let uploaded = false;
	for (const item of ordered) {
		const type = MEDIA_TYPES[spec.family][item.slot];
		if (!type || !mode) {
			throw rejected(`${spec.model.label} in ${modeLabel(spec.model, request.mode)} mode does not take ${inSentence(item.label)}.`);
		}
		const kind = item.slot === 'video' || item.slot === 'source' ? 'video' : item.slot === 'audio' ? 'audio' : 'image';
		if (kind === 'image') {
			entries.push({ type, url: await imageDataUrl(item.media, item.label, limitOf(mode.limits, 'image')) });
			continue;
		}
		if (regionOf(request.region) !== 'cn' || providerModel === undefined) {
			throw rejected(REGION_MEDIA_REASON);
		}
		entries.push({ type, url: await uploadedAddress(http, providerModel, item.media, item.label, limitOf(mode.limits, kind)) });
		uploaded = true;
	}
	return { entries, uploaded };
}

/** The body of a create: the model, its `input`, and its `parameters` under the provider's names. */
function requestBody(spec: ModelSpec, request: SubmitRequest, providerModel: string, entries: readonly { readonly type: string; readonly url: string }[]): Record<string, unknown> {
	const { negative_prompt: negativePrompt, ...rest } = request.params;
	const parameters: Record<string, ParamValue> = { ...rest };
	const input: Record<string, unknown> = {};
	if (request.prompt.trim()) {
		input.prompt = request.prompt;
	}
	if (typeof negativePrompt === 'string' && negativePrompt.trim()) {
		input.negative_prompt = negativePrompt;
	}
	if (spec.family === 'wan26-i2v') {
		const frame = entries.find(entry => entry.type === 'img_url');
		if (frame) {
			input.img_url = frame.url;
		}
	} else if (entries.length) {
		input.media = entries;
	}
	if (spec.family === 'wan3' && (request.mode === 'edit' || request.mode === 'extend')) {
		// As the provider's guide recommends: the ratio and the length follow the video.
		parameters.ratio = 'adaptive';
		parameters.duration = WAN3_AUTO_DURATION;
	}
	if (spec.family === 'wan27-edit' && parameters.duration === 0) {
		// 0 keeps the whole video, as leaving it out does.
		delete parameters.duration;
	}
	return { model: providerModel, input, parameters };
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

export const alibabaModule: ProviderModule = Object.freeze({
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
		const measured = isPlannedMedia(request.inputs) ? await measureItems(request.inputs, media) : undefined;
		const problems = [
			...regionProblems(spec, request, counts),
			...ruleProblems(spec, request, counts, measured),
			...(measured ? formatProblems(measured) : [])
		];
		const estimate = estimateFor(spec, request, counts, measured);
		return estimate ? { problems, estimate } : { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const spec = specOf(request.model);
		const providerModel = spec.model.providerModels[request.region];
		if (providerModel === undefined) {
			throw rejected(`${LABELS.provider} does not offer ${spec.model.label} in this region.`);
		}
		const { entries, uploaded } = await mediaEntries(spec, request, http);
		const answer = await http.create({
			method: 'POST',
			path: apiPath(http, '/services/aigc/video-generation/video-synthesis'),
			headers: {
				'X-DashScope-Async': 'enable',
				...(uploaded ? { 'X-DashScope-OssResourceResolve': 'enable' } : {})
			},
			body: { kind: 'json', value: requestBody(spec, request, providerModel, entries) }
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
