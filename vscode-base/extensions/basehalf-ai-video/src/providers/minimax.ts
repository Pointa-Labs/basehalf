/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, measureItems, type MeasuredItem, type PlannedCounts } from './check.ts';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import type { HttpAnswer, ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaFormat, type MediaInspector, type PlannedItem, type ReadMedia } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, CheckResult, ParamValue, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * MiniMax's video models on MiniMax's own API, in China (`api.minimax.cn`)
 * and internationally (`api.minimax.io`), with a key of the region
 * (`docs/specs/video-providers/minimax.md`). MiniMax H3 and H3 Max run on the
 * V2 API, which takes a `content` list of text, frames, and references;
 * images travel as data URLs, videos and audio as uploaded files
 * (`mm_file://`). The Hailuo models run on the V1 API, which takes frames as
 * data URLs and reports its errors in `base_resp` of an HTTP 200 answer.
 */

type MediaKind = 'image' | 'video' | 'audio';

// --- the provider's English texts, in one place so they can be translated -----------------------

const MODEL_TEXTS: Readonly<Record<string, { readonly label: string; readonly description: string }>> = Object.freeze({
	'h3': { label: 'MiniMax H3', description: 'MiniMax\'s multimodal video model: 4 to 15 seconds at 768P or 2K, from a prompt, frames, or up to 9 images, 3 videos, and 3 audio clips.' },
	'h3-max': { label: 'MiniMax H3 Max', description: 'A faster MiniMax H3 at 480P or 768P, 5 to 15 seconds, from the same inputs.' },
	'hailuo-2.3': { label: 'Hailuo 2.3', description: '6 or 10 seconds at 768P, or 6 seconds at 1080P, from a prompt or a start frame.' },
	'hailuo-2.3-fast': { label: 'Hailuo 2.3 Fast', description: 'A faster Hailuo 2.3 that brings a start frame to life: 6 or 10 seconds at 768P, or 6 seconds at 1080P.' },
	'hailuo-02': { label: 'Hailuo 02', description: '6 or 10 seconds at 768P, or 6 seconds at 1080P, from a prompt, a start frame, or a start and an end frame; 512P from a start frame alone.' }
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
	uploadUnreadable: 'MiniMax answered the upload in a form AI Video cannot read.',
	errorCode: (code: number) => `MiniMax answered with error code ${code}.`,
	rateLimits: 'MiniMax takes 20 requests a minute for Hailuo models, and 300 requests a minute with at most 30 tasks at a time for H3 models.',
	noTaskId: 'MiniMax accepted the request but gave no task id AI Video can read.',
	noTask: 'MiniMax answered without the task.',
	unknownStatus: (status: string) => `MiniMax reports a task status AI Video does not know: ${status || 'none'}.`,
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

type MiniMaxModel = H3Model | HailuoModel;

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
	}
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

function modesOf(model: MiniMaxModel): CatalogMode[] {
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
	.flatMap(model => model.api === 'v2' ? model.resolutions : Object.keys(model.durations))
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

function parametersOf(model: MiniMaxModel): CatalogParameter[] {
	const labels = TEXT.parameters;
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
	return {
		id: model.id,
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

async function check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
	const model = modelOf(request.model);
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
const BALANCE_CODE = 1008;
/** Unknown error, timeout, internal error, system error: the request may have been carried out. */
const SERVER_CODES: ReadonlySet<number> = new Set([1000, 1001, 1024, 1033]);
/** Sensitive input or output: a task that failed. */
const SENSITIVE_CODES: ReadonlySet<number> = new Set([1026, 1027]);
const INVALID_PARAMETERS_CODE = 2013;

type V1Call = 'create' | 'query' | 'retrieve' | 'upload';

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

/** The failure a nonzero code of `base_resp` stands for, which MiniMax answers with HTTP 200. */
function codeFailure(code: number, message: string | undefined, call: V1Call): ProviderFailure {
	const words = withCode(message, code);
	if (RATE_LIMIT_CODES.has(code)) {
		return new ProviderFailure('rateLimited', `${words} ${TEXT.rateLimits}`);
	}
	if (AUTH_CODES.has(code)) {
		return new ProviderFailure('auth', words);
	}
	if (code === BALANCE_CODE) {
		return new ProviderFailure('balance', words);
	}
	if (SERVER_CODES.has(code)) {
		return call === 'create' ? unknownOutcome(words) : new ProviderFailure('network', words);
	}
	if (code === INVALID_PARAMETERS_CODE && call === 'query') {
		// The task id is the one parameter of a query.
		return new ProviderFailure('notFound', words);
	}
	return rejected(words);
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
	if (type === 'insufficient_balance_error' || code === BALANCE_CODE) {
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
const V1_CREATE = '/v1/video_generation';
const V1_QUERY = '/v1/query/video_generation';
const V1_RETRIEVE = '/v1/files/retrieve';
const UPLOAD = '/v1/files/upload';

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

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	const model = modelOf(request.model);
	const label = TEXT.models[model.id].label;
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

async function poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
	const model = modelOf(ref.model);
	return model.api === 'v2' ? h3State(await readH3Task(ref, http)) : hailuoState((await readHailuoTask(ref, http)).object);
}

async function videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
	const model = modelOf(ref.model);
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
	if (model.api === 'v1') {
		// The V1 API cannot cancel a task.
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

export const MINIMAX: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
	readError,
	check,
	submit,
	poll,
	videoLocation,
	cancel
});
