/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, isPlannedMedia, measureItems } from './check.ts';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import type { ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, measure, plannedItems, readMedia, type MediaFormat, type MediaInspector } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, CheckResult, CountSlot, Estimate, Params, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * ByteDance's Seedance models on Volcengine Ark (China) and BytePlus
 * ModelArk (international), which serve the same task API at two base URLs
 * with their own keys, model ids, and prices (video providers, "ByteDance
 * (Seedance)"). Images and audio travel as data URLs; reference videos are
 * not offered, since the API takes them only as public URLs or asset ids.
 */

type RegionId = 'cn' | 'intl';
type Resolution = '480p' | '720p' | '1080p' | '4k';

// --- the provider's English texts, in one place so they can be translated -----------------------

const RESOLUTION_LABELS: Readonly<Record<Resolution, string>> = Object.freeze({ '480p': '480p', '720p': '720p', '1080p': '1080p', '4k': '4K' });

const MODEL_TEXTS: Readonly<Record<string, { readonly label: string; readonly description: string }>> = Object.freeze({
	'seedance-2.5': { label: 'Seedance 2.5', description: 'Up to 30 seconds with sound, from a prompt, frames, or up to 30 images and 10 audio clips.' },
	'seedance-2.0': { label: 'Seedance 2.0', description: 'Up to 15 seconds with sound and up to 4K, from a prompt, frames, or up to 9 images and 3 audio clips.' },
	'seedance-2.0-fast': { label: 'Seedance 2.0 Fast', description: 'A faster Seedance 2.0 at 480p and 720p.' },
	'seedance-2.0-mini': { label: 'Seedance 2.0 Mini', description: 'The lowest-cost Seedance 2.0, at 480p and 720p.' },
	'seedance-1.5-pro': { label: 'Seedance 1.5 Pro', description: 'Up to 12 seconds with sound, from a prompt or frames. BytePlus is retiring it for Seedance 2.0 Mini.' },
	'seedance-1.0-pro': { label: 'Seedance 1.0 Pro', description: 'Up to 12 seconds without sound, from a prompt or frames. Volcengine Ark is retiring it.' },
	'seedance-1.0-pro-fast': { label: 'Seedance 1.0 Pro Fast', description: 'A faster Seedance 1.0 Pro, from a prompt or a start frame. Volcengine Ark is retiring it.' }
});

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
		durationTooltip: 'Seconds of video. Auto lets the model choose; the price is then a range.',
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
	startFrameKeepsRatio: (model: string) => `${model} keeps the start frame's ratio: choose Adaptive.`,
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

/** Output sizes by resolution, in the order of {@link RATIOS}, from the create pages. */
type SizeTable = Readonly<Partial<Record<Resolution, readonly (readonly [number, number])[]>>>;

const RATIOS = Object.freeze(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const);

const SIZES_720P: readonly (readonly [number, number])[] = [[1280, 720], [1112, 834], [960, 960], [834, 1112], [720, 1280], [1470, 630]];
const SIZES_1080P: readonly (readonly [number, number])[] = [[1920, 1080], [1664, 1248], [1440, 1440], [1248, 1664], [1080, 1920], [2206, 946]];

const SIZES_2_5: SizeTable = {
	'480p': [[854, 480], [752, 560], [640, 640], [560, 752], [480, 854], [992, 432]],
	'720p': SIZES_720P,
	'1080p': SIZES_1080P
};

/** Seedance 2.0, 2.0 Fast, 2.0 Mini, and 1.5 Pro. */
const SIZES_2_0: SizeTable = {
	'480p': [[864, 496], [752, 560], [640, 640], [560, 752], [496, 864], [992, 432]],
	'720p': SIZES_720P,
	'1080p': SIZES_1080P,
	'4k': [[3840, 2160], [3326, 2494], [2880, 2880], [2494, 3326], [2160, 3840], [4398, 1886]]
};

const SIZES_1_0: SizeTable = {
	'480p': [[864, 480], [736, 544], [640, 640], [544, 736], [480, 864], [960, 416]],
	'720p': [[1248, 704], [1120, 832], [960, 960], [832, 1120], [704, 1248], [1504, 640]],
	'1080p': [[1920, 1088], [1664, 1248], [1440, 1440], [1248, 1664], [1088, 1920], [2176, 928]]
};

/** Price per million tokens by resolution, for output without an input video; `silent` when sound changes it. */
interface PriceTable {
	readonly perMillion: Readonly<Partial<Record<Resolution, number>>>;
	readonly silent?: Readonly<Partial<Record<Resolution, number>>>;
}

/** The dates of the price lists the prices below were read from. */
const PRICE_DATES: Readonly<Record<RegionId, string>> = Object.freeze({ cn: '2026-10-17', intl: '2026-10-18' });

const VIDEO_FPS = 24;

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
	readonly sizes: SizeTable;
	readonly defaultRatio: 'adaptive' | '16:9';
	/** Seedance 2.5 keeps the start frame's ratio. */
	readonly startFrameNeedsAdaptive: boolean;
	/** Seedance 1.0 takes Adaptive only with a start frame. */
	readonly adaptiveNeedsStartFrame: boolean;
	readonly prices: Readonly<Partial<Record<RegionId, PriceTable>>>;
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
		sizes: SIZES_2_5,
		defaultRatio: 'adaptive',
		startFrameNeedsAdaptive: true,
		adaptiveNeedsStartFrame: false,
		prices: {
			cn: { perMillion: { '480p': 70, '720p': 70, '1080p': 77 } },
			intl: { perMillion: { '480p': 10.7, '720p': 10.7, '1080p': 11.7 } }
		}
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
		sizes: SIZES_2_0,
		defaultRatio: 'adaptive',
		startFrameNeedsAdaptive: false,
		adaptiveNeedsStartFrame: false,
		prices: {
			cn: { perMillion: { '480p': 46, '720p': 46, '1080p': 51, '4k': 26 } },
			intl: { perMillion: { '480p': 7, '720p': 7, '1080p': 7.7, '4k': 4 } }
		}
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
		sizes: SIZES_2_0,
		defaultRatio: 'adaptive',
		startFrameNeedsAdaptive: false,
		adaptiveNeedsStartFrame: false,
		prices: {
			cn: { perMillion: { '480p': 37, '720p': 37 } },
			intl: { perMillion: { '480p': 5.6, '720p': 5.6 } }
		}
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
		sizes: SIZES_2_0,
		defaultRatio: 'adaptive',
		startFrameNeedsAdaptive: false,
		adaptiveNeedsStartFrame: false,
		prices: {
			cn: { perMillion: { '480p': 23, '720p': 23 } },
			intl: { perMillion: { '480p': 3.5, '720p': 3.5 } }
		}
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
		sizes: SIZES_2_0,
		defaultRatio: 'adaptive',
		startFrameNeedsAdaptive: false,
		adaptiveNeedsStartFrame: false,
		prices: {
			intl: { perMillion: { '480p': 2.4, '720p': 2.4, '1080p': 2.4 }, silent: { '480p': 1.2, '720p': 1.2, '1080p': 1.2 } }
		},
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
		sizes: SIZES_1_0,
		defaultRatio: '16:9',
		startFrameNeedsAdaptive: false,
		adaptiveNeedsStartFrame: true,
		prices: {
			cn: { perMillion: { '480p': 15, '720p': 15, '1080p': 15 } },
			intl: { perMillion: { '480p': 2.5, '720p': 2.5, '1080p': 2.5 } }
		}
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
		sizes: SIZES_1_0,
		defaultRatio: '16:9',
		startFrameNeedsAdaptive: false,
		adaptiveNeedsStartFrame: true,
		prices: {
			cn: { perMillion: { '480p': 4.2, '720p': 4.2, '1080p': 4.2 } },
			intl: { perMillion: { '480p': 1, '720p': 1, '1080p': 1 } }
		}
	}
] satisfies Seedance[]);

const MODELS: ReadonlyMap<string, Seedance> = new Map(SEEDANCE.map(model => [model.id, model]));

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
			default: model.defaultRatio
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
		parameters.push({ name: 'generate_audio', label: labels.sound, tooltip: labels.soundTooltip, kind: 'boolean', default: true });
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
		estimate: true,
		...(model.deprecated ? { deprecated: true } : {})
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'bytedance',
	label: TEXT.provider,
	regions: [
		{ id: 'cn', label: TEXT.regions.cn, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', currency: 'CNY', console: 'https://ark.volcengine.com/region:cn-beijing/apiKey' },
		{ id: 'intl', label: TEXT.regions.intl, baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', currency: 'USD', console: 'https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: SEEDANCE.map(catalogModel)
});

// --- rules and estimates -----------------------------------------------------------------------

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

/** Tokens of a video: seconds × width × height × frames per second / 1024 (the pricing pages' formula). */
export function seedanceTokens(seconds: number, width: number, height: number): number {
	return seconds * width * height * VIDEO_FPS / 1024;
}

/** The price of a generation from the price list of the region, a range when the provider chooses the length or the ratio. */
export function seedanceEstimate(modelId: string, region: string, params: Params): Estimate | undefined {
	const model = MODELS.get(modelId);
	const table = model?.prices[region as RegionId];
	if (!model || !table) {
		return undefined;
	}
	const resolution = params.resolution as Resolution;
	const rate = (params.generate_audio === false && table.silent ? table.silent : table.perMillion)[resolution];
	const sizes = model.sizes[resolution];
	if (rate === undefined || !sizes) {
		return undefined;
	}
	const ratioIndex = RATIOS.indexOf(params.ratio as typeof RATIOS[number]);
	const pixels = (ratioIndex >= 0 ? [sizes[ratioIndex]] : sizes).map(([width, height]) => width * height);
	const duration = Number(params.duration);
	const [shortest, longest] = duration === -1 ? [model.duration.min, model.duration.max] : [duration, duration];
	const price = (seconds: number, area: number) => seedanceTokens(seconds, area, 1) * rate / 1_000_000;
	return estimateOf(region === 'cn' ? 'CNY' : 'USD', price(shortest, Math.min(...pixels)), price(longest, Math.max(...pixels)), PRICE_DATES[region as RegionId]);
}

async function check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
	const model = modelOf(request.model);
	const label = TEXT.models[model.id].label;
	const counts = countsOf(request.inputs);
	const problems: string[] = [];
	if (model.startFrameNeedsAdaptive && request.mode === 'frames' && counts.startFrame && request.params.ratio !== 'adaptive') {
		problems.push(TEXT.startFrameKeepsRatio(label));
	}
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
	if (isPlannedMedia(request.inputs)) {
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
	}
	const estimate = seedanceEstimate(model.id, request.region, request.params);
	return estimate ? { problems, estimate } : { problems };
}

// --- requests ----------------------------------------------------------------------------------

const TASKS = '/contents/generations/tasks';

function taskPath(remoteId: string): string {
	return `${TASKS}/${encodeURIComponent(remoteId)}`;
}

const ROLES = Object.freeze({ startFrame: 'first_frame', endFrame: 'last_frame', image: 'reference_image' } as const);

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
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
	// The parameters are named as the API's fields; the commands checked and completed them.
	const body = Buffer.from(JSON.stringify({ model: providerModel, content, ...request.params }), 'utf8');
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

async function poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
	return taskState(await readTask(ref, http));
}

async function videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
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
