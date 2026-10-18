/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, isPlannedMedia, measureItems, type MeasuredItem } from './check.ts';
import { isRecord, ProviderFailure, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import type { HttpAnswer, ProviderHttp } from './http.ts';
import { base64Length, bufferSource, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaFormat, type MediaInspector } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type {
	CatalogMode,
	CatalogModel,
	CatalogParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
	CountSlot,
	Currency,
	Media,
	ModeId,
	ModeLimits,
	Params,
	PlannedCounts,
	PollState,
	ProviderErrorCode,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * Vidu on its own API (docs/specs/video-providers/vidu.md): two regions, one
 * API key sent as `Authorization: Token <key>`, inputs inside the JSON request
 * as data URLs, and nine catalog models over four create requests. Frames
 * mode picks the request from its inputs: none is text to video, a start
 * frame image to video, and a start and an end frame start–end to video.
 */

type RegionId = 'cn' | 'intl';

/** The create requests, by their path under `/ent/v2/`. */
type Route = 'text2video' | 'img2video' | 'start-end2video' | 'reference2video';

const MIB = 1024 * 1024;

/** The day the price list was read (vidu.md, "Estimate"). */
const PRICE_DATE = '2026-10-19';

/** What one credit costs in each region. */
const CREDIT_PRICES = Object.freeze<Record<RegionId, { readonly currency: Currency; readonly perCredit: number }>>({
	cn: { currency: 'CNY', perCredit: 0.03125 },
	intl: { currency: 'USD', perCredit: 0.005 }
});

/** The largest request body Vidu takes. */
const MAX_BODY_BYTES = 20 * MIB;
/** The largest input read for a request; no mode allows more. */
const MAX_INPUT_BYTES = 50 * MIB;
/** What the JSON around the inputs and the prompt can take, and each data URL's prefix. */
const BODY_FIELDS_BYTES = 512;
const DATA_URL_PREFIX_BYTES = 40;
/** The shape of the start frame against the end frame's (aspect ratio divided). */
const FRAME_SHAPE: readonly [number, number] = [0.8, 1.25];
/** Credits Q2 adds for sound from a start frame. */
const Q2_SOUND_CREDITS = 15;
/** Credits `is_rec` may add (the update notice of 2025-11-03). */
const EXPAND_PROMPT_CREDITS = 10;
const SEED_MAX = 2147483647;
/** The type of an MP3's data URL, as Vidu's pages write it. */
const MP3_DATA_TYPE = 'video/mp3';

// --- labels -------------------------------------------------------------------------------------

/** Every label, description, and tooltip the module declares, in one place to translate. */
const TEXT = Object.freeze({
	provider: 'Vidu',
	regions: Object.freeze<Record<RegionId, string>>({ cn: 'China', intl: 'International' }),
	apiKey: 'API Key',
	frames: 'Frames',
	references: 'References',
	resolution: 'Resolution',
	duration: 'Duration',
	ratio: 'Ratio',
	ratioAuto: 'Auto',
	ratioWithoutFrame: 'Used when there is no start frame; a video made from a frame takes the shape of the frame.',
	ratioWithAuto: 'Auto lets Vidu choose the shape from the reference images.',
	sound: 'Sound',
	soundTooltip: 'Dialogue and sound effects made together with the picture.',
	soundFromStartFrame: 'Dialogue and sound made with the picture, from a start frame alone. It adds 15 credits.',
	expandPrompt: 'Expand Prompt',
	expandPromptTooltip: 'Vidu writes a fuller prompt from yours and the start frame before it generates. It may add 10 credits.',
	seed: 'Seed',
	seedTooltip: 'The same seed and settings make a similar video. Empty or 0 makes a new one each time.',
	models: Object.freeze<Record<string, { readonly label: string; readonly description: string }>>({
		'q4-preview': {
			label: 'Vidu Q4 Preview',
			description: 'Vidu\'s newest model, in preview: sound with the picture and up to 4K, from a start frame or from up to 15 reference images and 3 audio clips.'
		},
		'q3-pro': {
			label: 'Vidu Q3 Pro',
			description: 'Sound with the picture and changes of shot, from text, a start frame, or a start and an end frame.'
		},
		'q3-turbo': {
			label: 'Vidu Q3 Turbo',
			description: 'Faster and cheaper than Q3 Pro, with sound and changes of shot, from text, a start frame, or a start and an end frame.'
		},
		'q3-pro-fast': {
			label: 'Vidu Q3 Pro Fast',
			description: 'Close to Q3 Pro and faster, from a start frame or a start and an end frame.'
		},
		'q3': {
			label: 'Vidu Q3',
			description: 'Keeps the subjects of up to 7 reference images consistent across shots, with sound.'
		},
		'q3-mix': {
			label: 'Vidu Q3 Mix',
			description: 'Strong picture and motion from up to 7 reference images and, in International, up to 3 audio clips.'
		},
		'q3-turbo-reference': {
			label: 'Vidu Q3 Turbo References',
			description: 'Q3 Turbo from up to 7 reference images, fast and inexpensive. In China only.'
		},
		'q2-pro': {
			label: 'Vidu Q2 Pro',
			description: 'Rich detail from a start frame or a start and an end frame; sound from a start frame on request.'
		},
		'q2-turbo': {
			label: 'Vidu Q2 Turbo',
			description: 'Fast and inexpensive, from a start frame or a start and an end frame; sound from a start frame on request.'
		}
	})
});

// --- the models ---------------------------------------------------------------------------------

interface FramesSpec {
	readonly startFrame: 'optional' | 'required';
	readonly endFrame: 'none' | 'optional';
	readonly limits: ModeLimits;
}

interface ReferenceSpec {
	readonly images: CountSlot;
	readonly audios: CountSlot;
	/** The regions whose pages document reference audio; all when absent. */
	readonly audioRegions?: readonly RegionId[];
	readonly limits: ModeLimits;
}

/** The most characters of a prompt, in one region or for some routes when they are named. */
interface PromptLimit {
	readonly max: number;
	readonly region?: RegionId;
	readonly routes?: readonly Route[];
}

type Price =
	/** Credits a second by resolution, for the routes named or for all. */
	| { readonly kind: 'perSecond'; readonly rates: Readonly<Record<string, number>>; readonly routes?: readonly Route[] }
	/** Credits for 1 second, for 2 seconds, and for each further second, by resolution. */
	| { readonly kind: 'byLength'; readonly rates: Readonly<Record<string, readonly [number, number, number]>> };

interface ViduModel {
	/** The catalog id. */
	readonly id: string;
	/** Vidu's id of the model in each region that offers it. */
	readonly providerModels: Readonly<Partial<Record<RegionId, string>>>;
	readonly frames?: FramesSpec;
	readonly reference?: ReferenceSpec;
	readonly promptRequired: 'always' | 'withoutMedia';
	readonly promptLimits: readonly PromptLimit[];
	readonly resolutions: readonly string[];
	readonly durations: readonly [number, number];
	/** `aspect_ratio`: the mode it applies to, and whether `auto` is a choice. */
	readonly ratio?: { readonly mode: ModeId; readonly auto: boolean };
	/** `audio`: its default, and whether only `img2video` takes it. */
	readonly sound?: { readonly default: boolean; readonly startFrameAlone?: boolean };
	/** `is_rec`, which `img2video` takes. */
	readonly expandPrompt?: boolean;
	readonly price: Price;
}

const FRAME_LIMITS: ModeLimits = Object.freeze({ imageMaxBytes: 10 * MIB, imageAspect: [0.25, 4] as const });
const REFERENCE_IMAGE_LIMITS: ModeLimits = Object.freeze({ imageMinSide: 128, imageAspect: [0.25, 4] as const });
const Q3_RESOLUTIONS = ['540p', '720p', '1080p'] as const;
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;

/**
 * The models, in the order the window lists them (vidu.md, "Models"). Q3 Pro
 * comes first: it takes text, a start frame, or both frames, so a node works
 * on it with whatever it is given.
 */
const MODELS: readonly ViduModel[] = Object.freeze<ViduModel[]>([
	{
		id: 'q3-pro',
		providerModels: { cn: 'viduq3-pro', intl: 'viduq3-pro' },
		frames: { startFrame: 'optional', endFrame: 'optional', limits: FRAME_LIMITS },
		promptRequired: 'withoutMedia',
		promptLimits: [{ max: 20000 }],
		resolutions: Q3_RESOLUTIONS,
		durations: [1, 16],
		ratio: { mode: 'frames', auto: false },
		sound: { default: true },
		price: { kind: 'perSecond', rates: { '540p': 9, '720p': 20, '1080p': 24 } }
	},
	{
		id: 'q3-turbo',
		providerModels: { cn: 'viduq3-turbo', intl: 'viduq3-turbo' },
		frames: { startFrame: 'optional', endFrame: 'optional', limits: FRAME_LIMITS },
		promptRequired: 'withoutMedia',
		promptLimits: [{ max: 20000 }, { max: 5000, region: 'intl', routes: ['text2video'] }],
		resolutions: Q3_RESOLUTIONS,
		durations: [1, 16],
		ratio: { mode: 'frames', auto: false },
		sound: { default: true },
		price: { kind: 'perSecond', rates: { '540p': 7, '720p': 12, '1080p': 13 } }
	},
	{
		id: 'q3-pro-fast',
		providerModels: { cn: 'viduq3-pro-fast', intl: 'viduq3-pro-fast' },
		frames: { startFrame: 'required', endFrame: 'optional', limits: FRAME_LIMITS },
		promptRequired: 'withoutMedia',
		promptLimits: [{ max: 20000 }],
		resolutions: ['720p', '1080p'],
		durations: [1, 16],
		sound: { default: true },
		price: { kind: 'perSecond', rates: { '720p': 12, '1080p': 15 }, routes: ['img2video'] }
	},
	{
		id: 'q4-preview',
		providerModels: { cn: 'viduq4-preview', intl: 'viduq4-preview' },
		frames: { startFrame: 'required', endFrame: 'none', limits: { imageMaxBytes: 50 * MIB } },
		reference: { images: { min: 1, max: 15 }, audios: { min: 0, max: 3 }, limits: { imageMaxBytes: 50 * MIB, audioSeconds: [3, 12], audioMaxBytes: 50 * MIB } },
		promptRequired: 'withoutMedia',
		promptLimits: [{ max: 20000 }],
		resolutions: ['540p', '720p', '1080p', '2K', '4K'],
		durations: [3, 16],
		ratio: { mode: 'reference', auto: false },
		sound: { default: true },
		expandPrompt: true,
		price: { kind: 'perSecond', rates: { '540p': 9, '720p': 19, '1080p': 24, '2K': 38, '4K': 78 } }
	},
	{
		id: 'q3',
		providerModels: { cn: 'viduq3', intl: 'viduq3' },
		reference: { images: { min: 1, max: 7 }, audios: { min: 0, max: 0 }, limits: REFERENCE_IMAGE_LIMITS },
		promptRequired: 'always',
		promptLimits: [{ max: 20000 }, { max: 5000, region: 'intl' }],
		resolutions: Q3_RESOLUTIONS,
		durations: [3, 16],
		ratio: { mode: 'reference', auto: true },
		sound: { default: true },
		price: { kind: 'perSecond', rates: { '540p': 7, '720p': 12, '1080p': 15 } }
	},
	{
		id: 'q3-mix',
		providerModels: { cn: 'viduq3-mix', intl: 'viduq3-mix' },
		reference: {
			images: { min: 1, max: 7 },
			audios: { min: 0, max: 3 },
			audioRegions: ['intl'],
			limits: { ...REFERENCE_IMAGE_LIMITS, audioSeconds: [3, 12], audioMaxBytes: 20 * MIB }
		},
		promptRequired: 'always',
		promptLimits: [{ max: 20000 }, { max: 5000, region: 'intl' }],
		resolutions: ['720p', '1080p'],
		durations: [3, 15],
		ratio: { mode: 'reference', auto: true },
		price: { kind: 'perSecond', rates: { '720p': 24, '1080p': 29 } }
	},
	{
		id: 'q3-turbo-reference',
		providerModels: { cn: 'viduq3-turbo' },
		reference: { images: { min: 1, max: 7 }, audios: { min: 0, max: 0 }, limits: REFERENCE_IMAGE_LIMITS },
		promptRequired: 'always',
		promptLimits: [{ max: 5000 }],
		resolutions: Q3_RESOLUTIONS,
		durations: [3, 15],
		ratio: { mode: 'reference', auto: true },
		price: { kind: 'perSecond', rates: { '540p': 4, '720p': 10, '1080p': 13 } }
	},
	{
		id: 'q2-pro',
		providerModels: { cn: 'viduq2-pro', intl: 'viduq2-pro' },
		frames: { startFrame: 'required', endFrame: 'optional', limits: FRAME_LIMITS },
		promptRequired: 'withoutMedia',
		promptLimits: [{ max: 5000 }, { max: 2000, routes: ['img2video'] }],
		resolutions: Q3_RESOLUTIONS,
		durations: [1, 10],
		sound: { default: false, startFrameAlone: true },
		price: { kind: 'byLength', rates: { '540p': [8, 10, 5], '720p': [15, 25, 10], '1080p': [55, 70, 15] } }
	},
	{
		id: 'q2-turbo',
		providerModels: { cn: 'viduq2-turbo', intl: 'viduq2-turbo' },
		frames: { startFrame: 'required', endFrame: 'optional', limits: FRAME_LIMITS },
		promptRequired: 'withoutMedia',
		promptLimits: [{ max: 5000 }, { max: 2000, routes: ['img2video'] }],
		resolutions: Q3_RESOLUTIONS,
		durations: [1, 10],
		sound: { default: false, startFrameAlone: true },
		price: { kind: 'byLength', rates: { '540p': [6, 8, 2], '720p': [8, 10, 10], '1080p': [35, 45, 10] } }
	}
]);

const MODELS_BY_ID: ReadonlyMap<string, ViduModel> = new Map(MODELS.map(model => [model.id, model]));

// --- the catalog --------------------------------------------------------------------------------

const NO_INPUTS: CountSlot = Object.freeze({ min: 0, max: 0 });

function catalogModes(model: ViduModel): CatalogMode[] {
	const modes: CatalogMode[] = [];
	if (model.frames) {
		modes.push({
			id: 'frames',
			label: TEXT.frames,
			inputs: { startFrame: model.frames.startFrame, endFrame: model.frames.endFrame, images: NO_INPUTS, videos: NO_INPUTS, audios: NO_INPUTS, source: 'none' },
			limits: model.frames.limits
		});
	}
	if (model.reference) {
		modes.push({
			id: 'reference',
			label: TEXT.references,
			inputs: { startFrame: 'none', endFrame: 'none', images: model.reference.images, videos: NO_INPUTS, audios: model.reference.audios, source: 'none' },
			limits: model.reference.limits
		});
	}
	return modes;
}

function catalogParameters(model: ViduModel): CatalogParameter[] {
	const parameters: CatalogParameter[] = [
		{ name: 'resolution', label: TEXT.resolution, kind: 'choice', options: model.resolutions.map(value => ({ value, label: value })), default: '720p' },
		{ name: 'duration', label: TEXT.duration, kind: 'integer', unit: 'seconds', min: model.durations[0], max: model.durations[1], step: 1, default: 5 }
	];
	if (model.ratio) {
		const options = RATIOS.map(value => ({ value, label: value }));
		const tooltip = model.ratio.mode === 'frames' ? TEXT.ratioWithoutFrame : model.ratio.auto ? TEXT.ratioWithAuto : undefined;
		parameters.push({
			name: 'aspect_ratio',
			label: TEXT.ratio,
			kind: 'choice',
			display: 'ratio',
			options: model.ratio.auto ? [...options, { value: 'auto', label: TEXT.ratioAuto }] : options,
			default: '16:9',
			modes: [model.ratio.mode],
			...(tooltip ? { tooltip } : {})
		});
	}
	if (model.sound) {
		parameters.push({ name: 'audio', label: TEXT.sound, kind: 'boolean', default: model.sound.default, tooltip: model.sound.startFrameAlone ? TEXT.soundFromStartFrame : TEXT.soundTooltip });
	}
	if (model.expandPrompt) {
		parameters.push({ name: 'is_rec', label: TEXT.expandPrompt, kind: 'boolean', default: false, modes: ['frames'], tooltip: TEXT.expandPromptTooltip });
	}
	parameters.push({ name: 'seed', label: TEXT.seed, kind: 'integer', min: 0, max: SEED_MAX, step: 1, optional: true, advanced: true, tooltip: TEXT.seedTooltip });
	return parameters;
}

function catalogModel(model: ViduModel): CatalogModel {
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
		prompt: { required: model.promptRequired, maxLength: Math.max(...model.promptLimits.map(limit => limit.max)) },
		modes: catalogModes(model),
		parameters: catalogParameters(model),
		estimate: true
	};
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'vidu',
	label: TEXT.provider,
	regions: [
		{ id: 'cn', label: TEXT.regions.cn, baseUrl: 'https://api.vidu.cn', currency: 'CNY', console: 'https://platform.vidu.cn' },
		{ id: 'intl', label: TEXT.regions.intl, baseUrl: 'https://api.vidu.com', currency: 'USD', console: 'https://platform.vidu.com' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODELS.map(catalogModel)
});

// --- requests -----------------------------------------------------------------------------------

function viduModel(id: string): ViduModel {
	const model = MODELS_BY_ID.get(id);
	if (!model) {
		throw rejected(`Vidu has no model "${id}".`);
	}
	return model;
}

function regionOf(id: string): RegionId {
	if (id !== 'cn' && id !== 'intl') {
		throw rejected(`Vidu has no region "${id}".`);
	}
	return id;
}

/** The create request a generation sends, from its mode and planned inputs. */
function routeOf(mode: ModeId, counts: PlannedCounts): Route {
	if (mode === 'reference') {
		return 'reference2video';
	}
	if (!counts.startFrame) {
		return 'text2video';
	}
	return counts.endFrame ? 'start-end2video' : 'img2video';
}

/** The limit of the prompt in a region for a route: the smallest that applies. */
function promptLimitOf(model: ViduModel, region: RegionId, route: Route): PromptLimit {
	const applying = model.promptLimits.filter(limit => (limit.region === undefined || limit.region === region) && (limit.routes === undefined || limit.routes.includes(route)));
	return applying.reduce((smallest, limit) => limit.max < smallest.max ? limit : smallest);
}

const ROUTE_PHRASES: Readonly<Record<Route, string>> = Object.freeze({
	'text2video': 'from text alone',
	'img2video': 'with a start frame alone',
	'start-end2video': 'with a start and an end frame',
	'reference2video': 'with reference images'
});

function limitWhere(limit: PromptLimit, route: Route): string {
	const parts: string[] = [];
	if (limit.routes) {
		parts.push(ROUTE_PHRASES[route]);
	}
	if (limit.region) {
		parts.push(`in ${TEXT.regions[limit.region]}`);
	}
	return parts.length ? ` ${parts.join(' ')}` : '';
}

const FORMAT_NAMES: Readonly<Record<MediaFormat, string>> = Object.freeze({
	png: 'a PNG image',
	jpeg: 'a JPEG image',
	webp: 'a WebP image',
	gif: 'a GIF',
	mp4: 'an MP4 file',
	mov: 'a MOV file',
	m4a: 'an M4A file',
	wav: 'a WAV file',
	mp3: 'an MP3 file'
});

/** The size of a create request with these inputs, enough to compare with Vidu's limit. */
function requestBytes(items: readonly MeasuredItem[], prompt: string): number {
	let bytes = BODY_FIELDS_BYTES + Buffer.byteLength(JSON.stringify(prompt), 'utf8');
	for (const item of items) {
		bytes += DATA_URL_PREFIX_BYTES + base64Length(item.facts.bytes);
	}
	return bytes;
}

/** The rules of Vidu's pages that need the files: formats, the shape of the frames, and the size of the request. */
function fileProblems(items: readonly MeasuredItem[], prompt: string): string[] {
	const problems: string[] = [];
	for (const item of items) {
		const format = item.facts.format;
		if (item.kind === 'image' && format === 'gif') {
			problems.push(`${item.label} is a GIF; Vidu takes PNG, JPEG, or WebP images.`);
		} else if (item.kind === 'audio' && format !== undefined && format !== 'mp3') {
			problems.push(`${item.label} is ${FORMAT_NAMES[format]}; Vidu takes MP3 audio only.`);
		}
	}
	const start = items.find(item => item.slot === 'startFrame')?.facts;
	const end = items.find(item => item.slot === 'endFrame')?.facts;
	if (start?.width && start.height && end?.width && end.height) {
		const shape = (start.width / start.height) / (end.width / end.height);
		if (shape < FRAME_SHAPE[0] - 1e-9 || shape > FRAME_SHAPE[1] + 1e-9) {
			problems.push(`The start and end frames differ too much in shape: the start frame's aspect ratio is ${shape.toFixed(2)} times the end frame's; Vidu takes ${FRAME_SHAPE[0]} to ${FRAME_SHAPE[1]} times.`);
		}
	}
	const bytes = requestBytes(items, prompt);
	if (bytes > MAX_BODY_BYTES) {
		problems.push(`The request with its inputs would be ${describeBytes(bytes)}; Vidu takes at most ${describeBytes(MAX_BODY_BYTES)}. Use fewer or smaller inputs.`);
	}
	return problems;
}

/** The credits of a generation, as the lowest and highest; undefined without a published price. */
function creditsOf(model: ViduModel, route: Route, params: Params): readonly [number, number] | undefined {
	const resolution = String(params.resolution);
	const duration = Number(params.duration);
	const price = model.price;
	let credits: number;
	if (price.kind === 'perSecond') {
		const rate = price.rates[resolution];
		if (rate === undefined || (price.routes && !price.routes.includes(route))) {
			return undefined;
		}
		credits = rate * duration;
	} else {
		const steps = price.rates[resolution];
		if (!steps) {
			return undefined;
		}
		credits = duration <= 1 ? steps[0] : steps[1] + (duration - 2) * steps[2];
		if (params.audio === true && route === 'img2video') {
			credits += Q2_SOUND_CREDITS;
		}
	}
	const expanded = model.expandPrompt === true && route === 'img2video' && params.is_rec === true;
	return [credits, credits + (expanded ? EXPAND_PROMPT_CREDITS : 0)];
}

async function readInput(media: Media, label: string): Promise<{ readonly base64: string; readonly format: MediaFormat | undefined }> {
	const read = await readMedia(media, MAX_INPUT_BYTES, label);
	const { format } = await measure(bufferSource(read.bytes));
	return { base64: read.bytes.toString('base64'), format };
}

/** An image as a data URL of its own format, read from its bytes. */
async function imageDataUrl(media: Media, label: string): Promise<string> {
	const { base64, format } = await readInput(media, label);
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(`${label} is not a PNG, JPEG, or WebP image.`);
	}
	return `data:${MEDIA_MIME_TYPES[format]};base64,${base64}`;
}

/** An MP3 as a data URL of the type Vidu's pages write. */
async function audioDataUrl(media: Media, label: string): Promise<string> {
	const { base64, format } = await readInput(media, label);
	if (format !== 'mp3') {
		throw rejected(`${label} is not MP3 audio.`);
	}
	return `data:${MP3_DATA_TYPE};base64,${base64}`;
}

/** The body of a create request: the fields its route takes (vidu.md, "Requests"). */
async function createBody(model: ViduModel, providerModel: string, route: Route, request: SubmitRequest): Promise<Record<string, unknown>> {
	const images: string[] = [];
	const sounds: string[] = [];
	for (const item of plannedItems(request.inputs)) {
		if (item.slot === 'startFrame' || item.slot === 'endFrame' || item.slot === 'image') {
			images.push(await imageDataUrl(item.media, item.label));
		} else if (item.slot === 'audio') {
			sounds.push(await audioDataUrl(item.media, item.label));
		} else {
			throw rejected(`${item.label} cannot be sent to Vidu.`);
		}
	}
	const params = request.params;
	const body: Record<string, unknown> = { model: providerModel };
	if (images.length) {
		body.images = images;
	}
	if (sounds.length) {
		body.sounds = sounds;
	}
	if (request.prompt.trim()) {
		body.prompt = request.prompt;
	}
	body.duration = params.duration;
	body.resolution = params.resolution;
	if (params.aspect_ratio !== undefined && (route === 'text2video' || route === 'reference2video')) {
		body.aspect_ratio = params.aspect_ratio;
	}
	if (params.audio !== undefined && !(model.sound?.startFrameAlone && route !== 'img2video')) {
		body.audio = params.audio;
	}
	if (params.is_rec !== undefined && route === 'img2video') {
		body.is_rec = params.is_rec;
	}
	if (params.seed !== undefined) {
		body.seed = params.seed;
	}
	return body;
}

// --- answers ------------------------------------------------------------------------------------

interface Reason {
	/** What the code means, as a sentence without its full stop. */
	readonly text: string;
	/** The contract's code, where it says more than the HTTP status. */
	readonly code?: ProviderErrorCode;
	/** What the user can do, a sentence after the code. */
	readonly advice?: string;
}

/** How each documented error code reads (vidu.md, "Errors"). */
const REASONS = Object.freeze<Record<string, Reason>>({
	Unauthorized: { code: 'auth', text: 'Vidu did not accept the API key', advice: 'Check it in Video Providers.' },
	Forbidden: { code: 'auth', text: 'Vidu refused the request for this API key', advice: 'Check it in Video Providers.' },
	CreditInsufficient: { code: 'balance', text: 'The Vidu account has too few credits for this generation' },
	QuotaExceeded: { code: 'rateLimited', text: 'Too many tasks of this Vidu account run at once', advice: 'Vidu runs up to 5 tasks at a time for an organization.' },
	TooManyRequests: { code: 'rateLimited', text: 'Vidu received too many requests in a short time' },
	SystemThrottling: { code: 'rateLimited', text: 'Vidu is limiting requests for now' },
	TaskNotFound: { text: 'Vidu does not know this task' },
	ModelUnavailable: { text: 'Vidu says this model is not available' },
	TaskPromptPolicyViolation: { text: 'Vidu\'s content review refused the prompt' },
	AuditSubmitIllegal: { text: 'Vidu\'s content review refused the inputs' },
	AuditFailed: { text: 'Vidu\'s content review refused the inputs' },
	PhotoAuditNotPass: { text: 'Vidu\'s content review refused an image' },
	CreationPolicyViolation: { text: 'Vidu\'s content review refused the video it made' },
	ImageFormatInvalid: { text: 'Vidu cannot read the format of an image' },
	ImageSizeInvalid: { text: 'An image is too large or too small for Vidu' },
	PageSizeOutOfRange: { text: 'An image is outside Vidu\'s limits of size, format, or aspect ratio' },
	OperationInProcess: { text: 'Vidu is still handling an earlier request', advice: 'Try again shortly.' },
	UserCancelled: { text: 'The task was cancelled' },
	InternalServiceFailure: { text: 'Vidu had an internal error' }
});

/** What a code of Vidu's means, when this module knows it. */
function reasonOf(code: string): Reason | undefined {
	return Object.hasOwn(REASONS, code) ? REASONS[code] : undefined;
}

/** A documented code as a sentence: Vidu's words for codes without one of their own here. */
function describeReason(reason: string, message: string): string {
	const known = reasonOf(reason);
	if (known) {
		return `${known.text} (${reason}).${known.advice ? ` ${known.advice}` : ''}`;
	}
	if (reason && message) {
		return `Vidu refused the request: ${message} (${reason}).`;
	}
	return `Vidu refused the request: ${message || reason}.`;
}

/** Whether an answer carries one of Vidu's errors rather than a task. */
function carriesError(value: Record<string, unknown>): boolean {
	return (typeof value.code === 'number' && value.code >= 400) || (typeof value.reason === 'string' && value.reason.trim() !== '');
}

/** Vidu's error answer: `{code, reason, message, metadata}`. */
function readViduError(body: unknown, status: number | undefined): (ProviderErrorReading & { readonly message: string }) | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	if (!reason && !message) {
		return undefined;
	}
	const code = reasonOf(reason)?.code;
	// A server error keeps its status's meaning: a create it answers may have made a task.
	return code && (status === undefined || status < 500) ? { message: describeReason(reason, message), code } : { message: describeReason(reason, message) };
}

/** The task id of an accepted create. */
function taskIdOf(answer: HttpAnswer): string {
	const value = answer.object();
	const id = value.task_id;
	if (typeof id === 'string' && id.trim()) {
		return id;
	}
	if (typeof id === 'number') {
		// A number this long loses digits in JSON.parse: take them from the text.
		const digits = /"task_id"\s*:\s*(\d{1,64})(?![\d.eE])/.exec(answer.body.toString('utf8'))?.[1];
		if (digits) {
			return digits;
		}
	}
	if (carriesError(value)) {
		const reading = readViduError(value, undefined);
		const message = reading?.message ?? 'Vidu answered with an error.';
		if (typeof value.code === 'number' && value.code >= 500) {
			throw unknownOutcome(`Vidu answered with an error after the request reached it: ${message}`);
		}
		throw new ProviderFailure(reading?.code ?? 'rejected', message);
	}
	throw unknownOutcome('Vidu accepted the request but gave no task id.');
}

function creationsPath(remoteId: string): string {
	return `/ent/v2/tasks/${encodeURIComponent(remoteId)}/creations`;
}

function stateOf(answer: Record<string, unknown>): string {
	return typeof answer.state === 'string' ? answer.state.trim().toLowerCase() : '';
}

/** The address of the first creation, the video without a watermark. */
function creationUrlOf(answer: Record<string, unknown>): string | undefined {
	if (!Array.isArray(answer.creations)) {
		return undefined;
	}
	for (const creation of answer.creations) {
		if (isRecord(creation) && typeof creation.url === 'string' && creation.url.trim()) {
			return creation.url.trim();
		}
	}
	return undefined;
}

/** `progress` from 0 to 100 as a fraction, when the answer has it (vidu.md, "Not confirmed"). */
function progressOf(answer: Record<string, unknown>): { readonly fraction?: number } {
	const progress = answer.progress;
	return typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100 ? { fraction: progress / 100 } : {};
}

function failureMessage(errCode: string): string {
	const known = reasonOf(errCode);
	const what = known ? `${known.text} (${errCode}).` : errCode ? `Vidu could not make the video (${errCode}).` : 'Vidu could not make the video.';
	return `${what} Vidu charges nothing for a video that fails.`;
}

function pollStateOf(answer: Record<string, unknown>): PollState {
	const state = stateOf(answer);
	switch (state) {
		case '':
			throw unreadable('Vidu answered without the state of the task.');
		case 'created':
		case 'queueing':
			return { state: 'pending', ...progressOf(answer) };
		case 'success': {
			const videoUrl = creationUrlOf(answer);
			return videoUrl ? { state: 'succeeded', videoUrl } : { state: 'succeeded' };
		}
		case 'failed': {
			const errCode = typeof answer.err_code === 'string' ? answer.err_code.trim() : '';
			return errCode === 'UserCancelled'
				? { state: 'cancelled', message: 'The task was cancelled at Vidu (UserCancelled).' }
				: { state: 'failed', message: failureMessage(errCode) };
		}
		default:
			// `processing`, and any state the pages do not list, such as `scheduled`.
			return { state: 'running', ...progressOf(answer) };
	}
}

// --- the module ---------------------------------------------------------------------------------

export const VIDU = Object.freeze<ProviderModule>({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
		return { Authorization: `Token ${credentials.apiKey}` };
	},

	readError(status: number, body: unknown): ProviderErrorReading | undefined {
		return readViduError(body, status);
	},

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const model = viduModel(request.model);
		const region = regionOf(request.region);
		const label = TEXT.models[model.id].label;
		const counts = countsOf(request.inputs);
		const route = routeOf(request.mode, counts);
		const problems: string[] = [];
		// Without an image, the declarations' own check already asks for a prompt.
		if (request.mode === 'reference' && model.promptRequired === 'withoutMedia' && !request.prompt.trim() && counts.images > 0) {
			problems.push(`Write a prompt: ${label} needs one in ${TEXT.references} mode.`);
		}
		const length = [...request.prompt].length;
		const limit = promptLimitOf(model, region, route);
		// A prompt over the declared length is reported by the declarations' own check.
		if (length > limit.max && length <= Math.max(...model.promptLimits.map(entry => entry.max))) {
			problems.push(`The prompt is ${length} characters long; ${label} takes at most ${limit.max}${limitWhere(limit, route)}.`);
		}
		if (model.sound?.startFrameAlone && request.params.audio === true && counts.endFrame) {
			problems.push(`${label} makes sound only from a start frame alone; turn off ${TEXT.sound} to use an end frame.`);
		}
		const audioRegions = model.reference?.audioRegions;
		if (request.mode === 'reference' && audioRegions && counts.audios > 0 && !audioRegions.includes(region)) {
			problems.push(`${label} takes reference audio only in ${audioRegions.map(id => TEXT.regions[id]).join(' and ')}.`);
		}
		if (isPlannedMedia(request.inputs)) {
			problems.push(...fileProblems(await measureItems(request.inputs, media), request.prompt));
		}
		const credits = creditsOf(model, route, request.params);
		if (!credits) {
			return { problems };
		}
		const price = CREDIT_PRICES[region];
		return { problems, estimate: estimateOf(price.currency, credits[0] * price.perCredit, credits[1] * price.perCredit, PRICE_DATE) };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const model = viduModel(request.model);
		const region = regionOf(request.region);
		const providerModel = model.providerModels[region];
		if (!providerModel) {
			throw rejected(`Vidu does not offer ${TEXT.models[model.id].label} in ${TEXT.regions[region]}.`);
		}
		const route = routeOf(request.mode, countsOf(request.inputs));
		const body = await createBody(model, providerModel, route, request);
		return taskIdOf(await http.create({ method: 'POST', path: `/ent/v2/${route}`, body: { kind: 'json', value: body } }));
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return pollStateOf((await http.request({ method: 'GET', path: creationsPath(ref.remoteId) })).object());
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const answer = (await http.request({ method: 'GET', path: creationsPath(ref.remoteId) })).object();
		const url = creationUrlOf(answer);
		if (!url) {
			throw unreadable(stateOf(answer) === 'success' ? 'Vidu reports the task as done but gives no video address.' : 'Vidu has no video for this task yet.');
		}
		return { url };
	},

	async cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean> {
		// Vidu refuses once the task is scheduled, with code 400; its page shows that answer under status 200.
		const answer = await http.requestOnce({
			method: 'POST',
			path: `/ent/v2/tasks/${encodeURIComponent(ref.remoteId)}/cancel`,
			body: { kind: 'json', value: { id: ref.remoteId } },
			accept: [400]
		});
		if (answer.status === 400) {
			return false;
		}
		try {
			const value = answer.json();
			return !(isRecord(value) && carriesError(value));
		} catch {
			// An accepted cancellation without a readable answer.
			return true;
		}
	}
});
