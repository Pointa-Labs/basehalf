/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { countsOf, estimateOf, isPlannedMedia, measureItems, type MeasuredItem } from './check.ts';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type HttpAnswer, type ProviderHttp } from './http.ts';
import { bufferSource, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaFormat, type MediaInspector, type PlannedItem, type ReadMedia } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type {
	CatalogMode,
	CatalogModel,
	CatalogParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
	Estimate,
	ModeId,
	ModeInputs,
	ModeLimits,
	PlannedCounts,
	PollState,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * PixVerse's video models on its own API (D59; docs/specs/video-providers/pixverse.md,
 * which records the pages each fact comes from). The key goes in `API-KEY`, with a new
 * `Ai-trace-id` on every request; images and videos are uploaded first for their ids;
 * the mode and the inputs choose one of five create endpoints, which all take the same
 * `model`; tasks are asked about at `GET /openapi/v2/video/result/{video_id}`; there is
 * no cancellation.
 */

type ModelId = 'pixverse-c1' | 'pixverse-v6' | 'pixverse-v5.6' | 'pixverse-v5';
type Resolution = '360p' | '540p' | '720p' | '1080p';
/** The create endpoint a generation goes to. */
type Route = 'text' | 'image' | 'transition' | 'fusion' | 'extend';
/** What a request is, for reading PixVerse's codes. */
type Call = 'create' | 'upload' | 'query';

const RESOLUTIONS: readonly Resolution[] = Object.freeze(['360p', '540p', '720p', '1080p']);

// --- labels -------------------------------------------------------------------------------------

function list(values: readonly number[]): string {
	return values.length > 2 ? `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}` : values.join(' or ');
}

function seconds(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Every label and message of the module, in one table so that they can be translated later. */
const TEXT = Object.freeze({
	provider: 'PixVerse',
	region: 'Global',
	apiKey: 'API Key',
	modes: Object.freeze({ frames: 'Frames', reference: 'References', extend: 'Extend' }),
	resolution: 'Resolution',
	ratio: 'Ratio',
	ratioTooltip: 'The shape of the video. A video made from a start frame takes the shape of the frame.',
	duration: 'Duration',
	v6DurationTooltip: 'In Extend mode, the seconds added to the video. With reference videos, the video is as long as the longest of them.',
	v56DurationTooltip: '5, 8, or 10 seconds; 10 seconds up to 720p.',
	sound: 'Sound',
	multiClip: 'Multi-clip',
	multiClipTooltip: 'PixVerse makes the video of several clips. Not with an end frame.',
	seed: 'Seed',
	seedTooltip: 'The same seed and settings give similar results.',
	models: Object.freeze<Record<ModelId, { readonly label: string; readonly description: string }>>({
		'pixverse-c1': {
			label: 'PixVerse C1',
			description: 'Text, a start frame, or start and end frames to video of 1 to 15 seconds up to 1080p, for cinematic scenes and complex motion; with sound when asked.'
		},
		'pixverse-v6': {
			label: 'PixVerse V6',
			description: 'Text, frames, reference images and up to 2 reference videos, or a video to extend; 1 to 15 seconds up to 1080p, with sound and multiple clips when asked.'
		},
		'pixverse-v5.6': {
			label: 'PixVerse V5.6',
			description: 'Text or frames to video of 5, 8, or 10 seconds up to 1080p (10 seconds up to 720p), with sound when asked.'
		},
		'pixverse-v5': {
			label: 'PixVerse V5',
			description: 'Text or frames to silent video of 5 or 8 seconds up to 1080p.'
		}
	}),
	notOffered: (label: string) => `PixVerse does not offer ${label} in this region.`,
	durations: (label: string, values: readonly number[]) => `${label} makes videos of ${list(values)} seconds.`,
	durationsAt1080p: (label: string, values: readonly number[]) => `At 1080p, ${label} makes videos of ${list(values)} seconds.`,
	imagePrompt: (length: number, label: string, limit: number) => `The prompt is ${length} characters long; with a start frame and no end frame, ${label} takes at most ${limit}.`,
	multiClipEndFrame: (label: string) => `${label} makes multiple clips only without an end frame. Turn Multi-clip off, or leave out the end frame.`,
	noReferences: (label: string) => `${label} in References mode needs at least one reference image or video.`,
	tooManyImages: (label: string, limit: number, planned: number) => `Without a reference video, ${label} takes at most ${limit} reference images; ${planned} are planned.`,
	extendTooLong: (source: number, added: number, limit: number) => `The source video is ${seconds(source)} seconds long and ${added} seconds are to be added; PixVerse makes at most ${limit} seconds in all. Choose a shorter duration.`,
	videoTooLarge: (label: string, size: string, limit: string) => `${label} is ${size}; AI Video uploads at most ${limit} in one request.`,
	wrongFormat: (label: string, kind: 'image' | 'video') => kind === 'image' ? `${label} is not a JPEG, PNG, or WebP image.` : `${label} is not an MP4 or MOV video.`,
	noAudio: (label: string) => `PixVerse takes no audio in this mode: ${label}.`,
	uploadFailed: (label: string, detail: string) => `${label} could not be uploaded to PixVerse: ${detail}`,
	uploadUnreadable: 'PixVerse answered the upload in a form AI Video cannot read.',
	noTaskId: 'PixVerse accepted the request but gave no task id AI Video can read.',
	noTask: 'PixVerse answered about the task in a form AI Video cannot read.',
	noVideo: 'PixVerse gives no address of a video for this task.',
	moderated: 'PixVerse\'s content moderation refused the video. Change the prompt or the inputs.',
	failed: 'PixVerse reports that the video could not be generated.',
	unknownStatus: (status: string) => `PixVerse reports a task state AI Video does not know: ${status.slice(0, 40)}.`
});

// --- the models ---------------------------------------------------------------------------------

type Credits = Readonly<Record<Resolution, number>>;

/** Credits per second of video, without and with sound. */
interface PerSecond {
	readonly kind: 'second';
	readonly silent: Credits;
	readonly sound: Credits;
}

/** Credits per request, by duration, without and with sound; a resolution without a price is not made at that duration. */
interface PerRequest {
	readonly kind: 'request';
	readonly tiers: Readonly<Record<number, { readonly silent: Partial<Credits>; readonly sound?: Partial<Credits> }>>;
}

interface PixVerseModel {
	readonly id: ModelId;
	/** PixVerse's `model`, the same at every endpoint. */
	readonly sentAs: string;
	readonly ratios: readonly string[];
	readonly duration: { readonly min: number; readonly max: number; readonly step: number };
	/** The only durations made, where the range allows more. */
	readonly durations?: readonly number[];
	/** The only durations made at 1080p, where fewer than at other resolutions. */
	readonly durationsAt1080p?: readonly number[];
	readonly durationTooltip?: string;
	/** Whether the model has the Sound setting (`generate_audio_switch`). */
	readonly sound: boolean;
	/** Whether the model has Multi-clip (`generate_multi_clip_switch`). */
	readonly multiClip: boolean;
	/** Whether the model has the References mode (Fusion). */
	readonly references: boolean;
	/** Whether the model has the Extend mode (Video Extend). */
	readonly extend: boolean;
	readonly price: PerSecond | PerRequest;
}

const WIDE_RATIOS: readonly string[] = Object.freeze(['16:9', '9:16', '4:3', '3:4', '1:1', '2:3', '3:2', '21:9']);
const RATIOS: readonly string[] = Object.freeze(['16:9', '9:16', '4:3', '3:4', '1:1']);

const MODELS: readonly PixVerseModel[] = Object.freeze<PixVerseModel[]>([
	{
		id: 'pixverse-c1', sentAs: 'c1', ratios: WIDE_RATIOS, duration: { min: 1, max: 15, step: 1 },
		sound: true, multiClip: false, references: false, extend: false,
		price: { kind: 'second', silent: { '360p': 6, '540p': 8, '720p': 10, '1080p': 19 }, sound: { '360p': 8, '540p': 10, '720p': 13, '1080p': 24 } }
	},
	{
		id: 'pixverse-v6', sentAs: 'v6', ratios: WIDE_RATIOS, duration: { min: 1, max: 15, step: 1 }, durationTooltip: TEXT.v6DurationTooltip,
		sound: true, multiClip: true, references: true, extend: true,
		price: { kind: 'second', silent: { '360p': 5, '540p': 7, '720p': 9, '1080p': 18 }, sound: { '360p': 7, '540p': 9, '720p': 12, '1080p': 23 } }
	},
	{
		id: 'pixverse-v5.6', sentAs: 'v5.6', ratios: RATIOS, duration: { min: 5, max: 10, step: 1 },
		durations: [5, 8, 10], durationsAt1080p: [5, 8], durationTooltip: TEXT.v56DurationTooltip,
		sound: true, multiClip: false, references: false, extend: false,
		price: {
			kind: 'request',
			tiers: {
				5: { silent: { '360p': 35, '540p': 35, '720p': 45, '1080p': 75 }, sound: { '360p': 80, '540p': 80, '720p': 90, '1080p': 120 } },
				8: { silent: { '360p': 70, '540p': 70, '720p': 90, '1080p': 150 }, sound: { '360p': 115, '540p': 115, '720p': 135, '1080p': 195 } },
				10: { silent: { '360p': 77, '540p': 77, '720p': 99 }, sound: { '360p': 122, '540p': 122, '720p': 144 } }
			}
		}
	},
	{
		id: 'pixverse-v5', sentAs: 'v5', ratios: RATIOS, duration: { min: 5, max: 8, step: 3 },
		sound: false, multiClip: false, references: false, extend: false,
		price: {
			kind: 'request',
			tiers: {
				5: { silent: { '360p': 45, '540p': 45, '720p': 60, '1080p': 120 } },
				8: { silent: { '360p': 90, '540p': 90, '720p': 120, '1080p': 240 } }
			}
		}
	}
]);

/** "225 Credits = USD 1." */
const CREDITS_PER_DOLLAR = 225;
/** The day the price list was read; the list states no date of its own. */
const PRICE_DATE = '2026-10-19';

const MiB = 1024 * 1024;
/** Smaller than 20 MB, neither side over 10,000 px (Upload Image). */
const IMAGE_MAX_BYTES = 20 * MiB;
const IMAGE_MAX_SIDE = 10_000;
/** A source video of at most 30 seconds and 50 MB, at most 40 seconds with what is added (Video Extend). */
const SOURCE_MAX_BYTES = 50 * MiB;
const SOURCE_MAX_SECONDS = 30;
const EXTENDED_MAX_SECONDS = 40;
/** Up to 2 reference videos of 15 seconds together; up to 7 images without one, 10 with one (Fusion). */
const MAX_REFERENCE_VIDEOS = 2;
const REFERENCE_VIDEOS_MAX_SECONDS = 15;
const MAX_REFERENCE_IMAGES = 10;
const MAX_REFERENCE_IMAGES_WITHOUT_VIDEO = 7;
/** The prompt of every create page, and the shorter one of Image-to-Video. */
const PROMPT_MAX_LENGTH = 5000;
const IMAGE_TO_VIDEO_PROMPT_MAX_LENGTH = 2048;
/** The largest file AI Video uploads: its request limit, less room for the form around the file. */
const UPLOAD_MAX_BYTES = DEFAULT_HTTP_OPTIONS.maxRequestBytes - 64 * 1024;
/** The shortest and the longest video V6 makes, for reference videos whose lengths are not measured. */
const V6_SECONDS: readonly [number, number] = [1, 15];

const NO_INPUTS = Object.freeze({ min: 0, max: 0 });
const FRAMES_ONLY: readonly ModeId[] = Object.freeze(['frames']);

function inputs(change: Partial<ModeInputs>): ModeInputs {
	return { startFrame: 'none', endFrame: 'none', images: NO_INPUTS, videos: NO_INPUTS, audios: NO_INPUTS, source: 'none', ...change };
}

// JPEG, PNG, and WebP, all that Upload Image takes: no mode declares image formats.
const IMAGE_LIMITS: ModeLimits = Object.freeze({ imageMaxSide: IMAGE_MAX_SIDE, imageMaxBytes: IMAGE_MAX_BYTES });

function declareModes(model: PixVerseModel): CatalogMode[] {
	const modes: CatalogMode[] = [{
		id: 'frames',
		label: TEXT.modes.frames,
		inputs: inputs({ startFrame: 'optional', endFrame: 'optional' }),
		limits: IMAGE_LIMITS
	}];
	if (model.references) {
		modes.push({
			id: 'reference',
			label: TEXT.modes.reference,
			inputs: inputs({ images: { min: 0, max: MAX_REFERENCE_IMAGES }, videos: { min: 0, max: MAX_REFERENCE_VIDEOS } }),
			limits: { ...IMAGE_LIMITS, videoTotalSeconds: REFERENCE_VIDEOS_MAX_SECONDS }
		});
	}
	if (model.extend) {
		modes.push({
			id: 'extend',
			label: TEXT.modes.extend,
			inputs: inputs({ source: 'required' }),
			// One video: its length is the total.
			limits: { videoTotalSeconds: SOURCE_MAX_SECONDS, videoMaxBytes: SOURCE_MAX_BYTES }
		});
	}
	return modes;
}

function declareParameters(model: PixVerseModel, modes: readonly CatalogMode[]): CatalogParameter[] {
	// Video Extend takes neither a ratio nor a sound setting.
	const exceptExtend = model.extend ? { modes: modes.map(mode => mode.id).filter(mode => mode !== 'extend') } : {};
	const parameters: CatalogParameter[] = [
		{
			name: 'resolution',
			label: TEXT.resolution,
			kind: 'choice',
			options: RESOLUTIONS.map(resolution => ({ value: resolution, label: resolution })),
			default: '720p'
		},
		{
			name: 'ratio',
			label: TEXT.ratio,
			tooltip: TEXT.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: model.ratios.map(ratio => ({ value: ratio, label: ratio })),
			default: '16:9',
			// Sent by text to video and fusion only: a video made from a frame takes the frame's shape.
			setByStartFrame: true,
			...exceptExtend
		},
		{
			name: 'duration',
			label: TEXT.duration,
			...(model.durationTooltip ? { tooltip: model.durationTooltip } : {}),
			kind: 'integer',
			unit: 'seconds',
			...model.duration,
			default: 5
		}
	];
	if (model.sound) {
		parameters.push({ name: 'sound', label: TEXT.sound, kind: 'boolean', default: false, ...exceptExtend });
	}
	if (model.multiClip) {
		parameters.push({
			name: 'generate_multi_clip_switch',
			label: TEXT.multiClip,
			tooltip: TEXT.multiClipTooltip,
			kind: 'boolean',
			default: false,
			...(modes.length > 1 ? { modes: FRAMES_ONLY } : {})
		});
	}
	parameters.push({ name: 'seed', label: TEXT.seed, tooltip: TEXT.seedTooltip, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true });
	return parameters;
}

function declareModel(model: PixVerseModel): CatalogModel {
	const modes = declareModes(model);
	return {
		id: model.id,
		label: TEXT.models[model.id].label,
		description: TEXT.models[model.id].description,
		providerModels: { global: model.sentAs },
		prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
		modes,
		parameters: declareParameters(model, modes),
		estimate: true
	};
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'pixverse',
	label: TEXT.provider,
	regions: [
		{ id: 'global', label: TEXT.region, baseUrl: 'https://app-api.pixverse.ai', currency: 'USD', console: 'https://platform.pixverse.ai' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODELS.map(declareModel)
});

function modelOf(id: string): PixVerseModel {
	const model = MODELS.find(entry => entry.id === id);
	if (!model) {
		throw rejected(`PixVerse has no model "${id}".`);
	}
	return model;
}

function labelOf(model: PixVerseModel): string {
	return TEXT.models[model.id].label;
}

// --- errors -------------------------------------------------------------------------------------

/**
 * How a code is answered: a code of the contract; `missing`, an unknown task when asking
 * about one and a refusal otherwise; `server`, PixVerse's own failure, after which a task
 * may exist.
 */
type ErrorKind = 'auth' | 'balance' | 'rateLimited' | 'rejected' | 'missing' | 'server';

/** PixVerse's `ErrCode`s (Error Codes, Concurrency Rules) with what the user can do. */
const ERROR_CODES: ReadonlyMap<number, { readonly kind: ErrorKind; readonly text: string }> = new Map<number, { readonly kind: ErrorKind; readonly text: string }>([
	[10004, { kind: 'auth', text: 'PixVerse received no API key. Set it in Video Providers.' }],
	[10005, { kind: 'auth', text: 'PixVerse does not know the API key. Check it in Video Providers; it is a key of the PixVerse API Platform.' }],
	[400012, { kind: 'auth', text: 'PixVerse refused the account of the API key. Check the account in the PixVerse API Platform.' }],
	[400011, { kind: 'rejected', text: 'PixVerse refused the request: a required setting is missing.' }],
	[400013, { kind: 'rejected', text: 'PixVerse refused a setting of the request as the wrong type or value.' }],
	[400017, { kind: 'rejected', text: 'PixVerse refused a setting of the request.' }],
	[400018, { kind: 'rejected', text: 'PixVerse refused the prompt as too long.' }],
	[400019, { kind: 'rejected', text: 'PixVerse refused the prompt as too long.' }],
	[400032, { kind: 'rejected', text: 'PixVerse does not know an uploaded image of the request.' }],
	[500008, { kind: 'missing', text: 'PixVerse does not know what the request names, such as the task.' }],
	[500020, { kind: 'rejected', text: 'The PixVerse account may not use this model or capability. Check its access in the PixVerse API Platform.' }],
	[500030, { kind: 'rejected', text: 'PixVerse refused an image as too large.' }],
	[500031, { kind: 'rejected', text: 'PixVerse could not read an image.' }],
	[500032, { kind: 'rejected', text: 'PixVerse does not take the format of an image.' }],
	[500033, { kind: 'rejected', text: 'PixVerse refused the size of an image.' }],
	[500041, { kind: 'rejected', text: 'PixVerse could not take an image.' }],
	[500042, { kind: 'rejected', text: 'PixVerse refused the path of an image.' }],
	[500044, { kind: 'rateLimited', text: 'PixVerse is already running as many tasks as the account may run at once. Wait for one to finish.' }],
	[500054, { kind: 'rejected', text: 'PixVerse\'s content moderation refused the prompt or an input.' }],
	[500060, { kind: 'rejected', text: 'The PixVerse account has reached its monthly limit of effects.' }],
	[500063, { kind: 'rejected', text: 'PixVerse\'s moderation refused the prompt or an input before generating.' }],
	[500064, { kind: 'missing', text: 'PixVerse reports that the content was deleted or is unavailable.' }],
	[500069, { kind: 'server', text: 'PixVerse is under high load.' }],
	[500070, { kind: 'rejected', text: 'The PixVerse template is not activated.' }],
	[500071, { kind: 'rejected', text: 'PixVerse does not make this resolution for the request.' }],
	[500090, { kind: 'balance', text: 'The PixVerse account has too few credits. Add credits in the PixVerse API Platform.' }],
	[500100, { kind: 'server', text: 'PixVerse had an internal error.' }],
	[712008, { kind: 'rateLimited', text: 'PixVerse received too many requests from this account or address. Wait a moment.' }],
	[99999, { kind: 'server', text: 'PixVerse had an unknown error.' }]
]);

function codeOf(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isInteger(value)) {
		return value;
	}
	return typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : undefined;
}

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorMessage(code: number, said: unknown): string {
	const words = textOf(said) ?? '';
	const known = ERROR_CODES.get(code);
	if (!known) {
		return words ? `PixVerse: ${words} (${code})` : `PixVerse answered with error ${code}.`;
	}
	return words ? `${known.text} (${code}: ${words})` : `${known.text} (${code})`;
}

/** The failure of an answer that carries a nonzero `ErrCode`, which PixVerse sends mostly with HTTP 200. */
function codedFailure(code: number, said: unknown, call: Call): ProviderFailure {
	const message = errorMessage(code, said);
	const kind = ERROR_CODES.get(code)?.kind;
	switch (kind) {
		case 'auth':
		case 'balance':
		case 'rateLimited':
		case 'rejected':
			return new ProviderFailure(kind, message);
		case 'missing':
			return new ProviderFailure(call === 'query' ? 'notFound' : 'rejected', message);
		case 'server':
			return call === 'create' ? unknownOutcome(message) : new ProviderFailure('network', message);
		default:
			// A code the documentation does not list: a create may have made a task.
			return call === 'create' ? unknownOutcome(message) : call === 'query' ? unreadable(message) : rejected(message);
	}
}

/** The body of a 2xx answer, after its `ErrCode`. */
function accepted(answer: HttpAnswer, call: Call): Record<string, unknown> {
	const body = answer.object();
	const code = codeOf(body.ErrCode);
	if (code !== undefined && code !== 0) {
		throw codedFailure(code, body.ErrMsg, call);
	}
	return body;
}

/** An answer that is not 2xx: its code refines a refusal; a server error leaves a create's outcome unknown. */
function readPixVerseError(status: number, body: unknown): ProviderErrorReading | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const code = codeOf(body.ErrCode);
	if (code === undefined || code === 0) {
		const said = textOf(body.ErrMsg);
		return said ? { message: said } : readCommonError(body);
	}
	const message = errorMessage(code, body.ErrMsg);
	const kind = ERROR_CODES.get(code)?.kind;
	if (status >= 500 || status === 408 || kind === undefined || kind === 'missing' || kind === 'server') {
		return { message };
	}
	return { message, code: kind };
}

// --- ids ----------------------------------------------------------------------------------------

/** A PixVerse id, a 64-bit integer, kept as its digits so that none is rounded. */
class PixVerseId {
	readonly digits: string;

	constructor(digits: string) {
		this.digits = digits;
	}
}

/**
 * An id of an answer as its digits. PixVerse sends ids as JSON numbers, which lose digits
 * beyond 2^53: the digits are then read from the answer's text.
 */
function idOf(answer: HttpAnswer, value: unknown, field: string): string | undefined {
	if (typeof value === 'string') {
		const text = value.trim();
		return /^[1-9]\d{0,19}$/.test(text) ? text : undefined;
	}
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		return undefined;
	}
	const digits = new RegExp(`"${field}"\\s*:\\s*([1-9]\\d{0,19})(?![\\d.eE])`).exec(answer.body.toString('utf8'))?.[1];
	if (digits !== undefined && Number(digits) === value) {
		return digits;
	}
	return Number.isSafeInteger(value) ? String(value) : undefined;
}

/** JSON whose ids are numbers with every digit. */
function jsonBytes(value: unknown): Uint8Array {
	const marker = `pixverse-id:${randomUUID()}:`;
	const text = JSON.stringify(value, (_key, entry: unknown) => entry instanceof PixVerseId ? `${marker}${entry.digits}` : entry);
	return Buffer.from(text.replace(new RegExp(`"${marker}(\\d+)"`, 'g'), '$1'), 'utf8');
}

// --- requests -----------------------------------------------------------------------------------

const API_BASE = '/openapi/v2';
const IMAGE_UPLOAD = '/image/upload';
const MEDIA_UPLOAD = '/media/upload';
const RESULT = '/video/result';
const CREATE_PATHS: Readonly<Record<Route, string>> = Object.freeze({
	text: '/video/text/generate',
	image: '/video/img/generate',
	transition: '/video/transition/generate',
	fusion: '/video/fusion/generate',
	extend: '/video/extend/generate'
});

/** A path under the endpoint's `/openapi/v2`, which the endpoint may already end with. */
function apiPath(http: ProviderHttp, path: string): string {
	return /\/openapi\/v2$/i.test(http.endpoint.pathname) ? path : `${API_BASE}${path}`;
}

/** The endpoint of a generation, by its mode and inputs. */
function routeOf(mode: ModeId, counts: PlannedCounts): Route {
	switch (mode) {
		case 'reference':
			return 'fusion';
		case 'extend':
			return 'extend';
		default:
			return counts.startFrame ? (counts.endFrame ? 'transition' : 'image') : 'text';
	}
}

/** An input read whole, with the format its header shows. */
interface Prepared {
	readonly item: PlannedItem;
	readonly kind: 'image' | 'video';
	readonly read: ReadMedia;
	readonly format: MediaFormat;
}

const FORMATS: Readonly<Record<Prepared['kind'], ReadonlySet<MediaFormat>>> = Object.freeze({
	image: new Set<MediaFormat>(['png', 'jpeg', 'webp']),
	video: new Set<MediaFormat>(['mp4', 'mov'])
});
const EXTENSIONS: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp', mp4: 'mp4', mov: 'mov' });

async function prepare(item: PlannedItem): Promise<Prepared> {
	if (item.slot === 'audio') {
		throw rejected(TEXT.noAudio(item.label));
	}
	const kind = item.slot === 'video' || item.slot === 'source' ? 'video' : 'image';
	const maxBytes = kind === 'image' ? IMAGE_MAX_BYTES : item.slot === 'source' ? SOURCE_MAX_BYTES : UPLOAD_MAX_BYTES;
	const read = await readMedia(item.media, maxBytes, item.label);
	const { format } = await measure(bufferSource(read.bytes));
	if (!format || !FORMATS[kind].has(format)) {
		throw rejected(TEXT.wrongFormat(item.label, kind));
	}
	return { item, kind, read, format };
}

/** The name an upload gets: its slot and its format, such as `reference-image-2.webp`. */
function uploadName(entry: Prepared): string {
	const { slot, index } = entry.item;
	const base = slot === 'startFrame' ? 'start-frame' : slot === 'endFrame' ? 'end-frame' : slot === 'source' ? 'source-video' : `reference-${slot}-${index + 1}`;
	return `${base}.${EXTENSIONS[entry.format] ?? 'bin'}`;
}

/** Uploads an image (`img_id`) or a video (`media_id`) and answers its id. */
async function upload(http: ProviderHttp, entry: Prepared): Promise<PixVerseId> {
	const image = entry.kind === 'image';
	const label = entry.item.label;
	let answer: HttpAnswer;
	try {
		answer = await http.request({
			method: 'POST',
			path: apiPath(http, image ? IMAGE_UPLOAD : MEDIA_UPLOAD),
			body: {
				kind: 'form',
				parts: [{ name: image ? 'image' : 'file', file: { bytes: entry.read.bytes, fileName: uploadName(entry), contentType: MEDIA_MIME_TYPES[entry.format] } }]
			}
		});
	} catch (error) {
		if (error instanceof ProviderFailure) {
			// Nothing was created yet: say which input PixVerse did not take.
			throw new ProviderFailure(error.code === 'invalidResponse' ? 'rejected' : error.code, TEXT.uploadFailed(label, error.message), error.status);
		}
		throw error;
	}
	let body: Record<string, unknown>;
	try {
		body = answer.object();
	} catch {
		throw rejected(TEXT.uploadFailed(label, TEXT.uploadUnreadable));
	}
	const code = codeOf(body.ErrCode);
	if (code !== undefined && code !== 0) {
		const failure = codedFailure(code, body.ErrMsg, 'upload');
		throw new ProviderFailure(failure.code, TEXT.uploadFailed(label, failure.message));
	}
	const field = image ? 'img_id' : 'media_id';
	const id = idOf(answer, isRecord(body.Resp) ? body.Resp[field] : undefined, field);
	if (!id) {
		throw rejected(TEXT.uploadFailed(label, TEXT.uploadUnreadable));
	}
	return new PixVerseId(id);
}

/** The ids of the uploaded inputs, by slot. */
interface Uploaded {
	startFrame?: PixVerseId;
	endFrame?: PixVerseId;
	readonly images: PixVerseId[];
	readonly videos: PixVerseId[];
	source?: PixVerseId;
}

/** The JSON of the request that creates the task (pixverse.md, "Creating the task"). */
function createBody(model: PixVerseModel, route: Route, request: SubmitRequest, ids: Uploaded): Record<string, unknown> {
	const params = request.params;
	const body: Record<string, unknown> = { model: model.sentAs, prompt: request.prompt, duration: params.duration, quality: params.resolution };
	switch (route) {
		case 'text':
			body.aspect_ratio = params.ratio;
			break;
		case 'image':
			body.img_id = ids.startFrame;
			break;
		case 'transition':
			body.first_frame_img = ids.startFrame;
			body.last_frame_img = ids.endFrame;
			break;
		case 'fusion':
			body.aspect_ratio = params.ratio;
			if (ids.images.length) {
				body.image_references = ids.images.map(id => ({ img_id: id }));
			}
			if (ids.videos.length) {
				// Video references run in the Omni mode, whose video is as long as the longest reference.
				body.video_references = ids.videos.map(id => ({ video_media_id: id }));
				body.reference_mode = 'omni';
				body.duration = 0;
			}
			break;
		case 'extend':
			body.video_media_id = ids.source;
			break;
	}
	if (typeof params.seed === 'number') {
		body.seed = params.seed;
	}
	if (model.sound && route !== 'extend') {
		body.generate_audio_switch = params.sound === true;
	}
	if (model.multiClip && (route === 'text' || route === 'image')) {
		body.generate_multi_clip_switch = params.generate_multi_clip_switch === true;
	}
	return body;
}

function createdTaskId(answer: HttpAnswer): string {
	const body = accepted(answer, 'create');
	const id = idOf(answer, isRecord(body.Resp) ? body.Resp.video_id : undefined, 'video_id');
	if (!id) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return id;
}

/** The task as `GET /openapi/v2/video/result/{video_id}` gives it. */
async function askAbout(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	const answer = await http.request({ method: 'GET', path: apiPath(http, `${RESULT}/${encodeURIComponent(ref.remoteId)}`) });
	const task = accepted(answer, 'query').Resp;
	if (!isRecord(task)) {
		throw unreadable(TEXT.noTask);
	}
	return task;
}

function stateOf(task: Record<string, unknown>): PollState {
	switch (codeOf(task.status)) {
		case 5:
			return { state: 'running' };
		case 1: {
			// Complete only "when status=1 and Resp.url is accessible".
			const url = textOf(task.url);
			return url ? { state: 'succeeded', videoUrl: url } : { state: 'running' };
		}
		case 7:
			return { state: 'failed', message: TEXT.moderated };
		case 8:
			return { state: 'failed', message: TEXT.failed };
		default:
			throw unreadable(TEXT.unknownStatus(String(task.status)));
	}
}

// --- checks and estimates -----------------------------------------------------------------------

/** The rules between parameters and inputs that the declarations cannot express (pixverse.md, "Rules between parameters and inputs"). */
function ruleProblems(model: PixVerseModel, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): string[] {
	const problems: string[] = [];
	const label = labelOf(model);
	const duration = Number(request.params.duration);
	if (model.durations && !model.durations.includes(duration)) {
		problems.push(TEXT.durations(label, model.durations));
	} else if (model.durationsAt1080p && request.params.resolution === '1080p' && !model.durationsAt1080p.includes(duration)) {
		problems.push(TEXT.durationsAt1080p(label, model.durationsAt1080p));
	}
	const length = [...request.prompt].length;
	if (routeOf(request.mode, counts) === 'image' && length > IMAGE_TO_VIDEO_PROMPT_MAX_LENGTH) {
		problems.push(TEXT.imagePrompt(length, label, IMAGE_TO_VIDEO_PROMPT_MAX_LENGTH));
	}
	if (model.multiClip && request.mode === 'frames' && counts.endFrame && request.params.generate_multi_clip_switch === true) {
		problems.push(TEXT.multiClipEndFrame(label));
	}
	if (request.mode === 'reference') {
		if (counts.images + counts.videos === 0) {
			problems.push(TEXT.noReferences(label));
		} else if (counts.videos === 0 && counts.images > MAX_REFERENCE_IMAGES_WITHOUT_VIDEO) {
			problems.push(TEXT.tooManyImages(label, MAX_REFERENCE_IMAGES_WITHOUT_VIDEO, counts.images));
		}
	}
	if (request.mode === 'extend') {
		const source = measured?.find(item => item.slot === 'source')?.facts.seconds;
		if (source !== undefined && source + duration > EXTENDED_MAX_SECONDS + 0.05) {
			problems.push(TEXT.extendTooLong(source, duration, EXTENDED_MAX_SECONDS));
		}
	}
	return problems;
}

/** Reference videos too large for AI Video to upload in one request. */
function fileProblems(measured: readonly MeasuredItem[]): string[] {
	return measured
		.filter(item => item.slot === 'video' && item.facts.bytes > UPLOAD_MAX_BYTES)
		.map(item => TEXT.videoTooLarge(item.label, describeBytes(item.facts.bytes), describeBytes(UPLOAD_MAX_BYTES)));
}

/** The seconds of the longest reference video, which the result follows: to its next whole second, or V6's range when not measured. */
function referenceSeconds(measured: readonly MeasuredItem[] | undefined): readonly [number, number] {
	const lengths = (measured ?? []).filter(item => item.kind === 'video').map(item => item.facts.seconds);
	if (!lengths.length || lengths.some(length => length === undefined)) {
		return V6_SECONDS;
	}
	const longest = Math.max(...lengths as number[]);
	return [longest, Math.max(longest, Math.ceil(longest - 1e-6))];
}

function dollars(lowCredits: number, highCredits: number): Estimate {
	return estimateOf('USD', lowCredits / CREDITS_PER_DOLLAR, highCredits / CREDITS_PER_DOLLAR, PRICE_DATE);
}

/** Credits by the price list, divided by 225 (pixverse.md, "Estimate"); none for a combination without a price. */
function estimateFor(model: PixVerseModel, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[] | undefined): Estimate | undefined {
	const resolution = RESOLUTIONS.find(entry => entry === request.params.resolution);
	const duration = request.params.duration;
	if (!resolution || typeof duration !== 'number') {
		return undefined;
	}
	const sound = request.params.sound === true;
	const price = model.price;
	if (price.kind === 'request') {
		const tier = price.tiers[duration];
		const credits = (sound ? tier?.sound : tier?.silent)?.[resolution];
		return credits === undefined ? undefined : dollars(credits, credits);
	}
	const perSecond = (withSound: boolean) => (withSound ? price.sound : price.silent)[resolution];
	if (request.mode === 'extend') {
		// Video Extend has no sound setting; it is billed at "the applicable ... audio" rate.
		return dollars(perSecond(false) * duration, perSecond(true) * duration);
	}
	if (request.mode === 'reference' && counts.videos > 0) {
		// Twice the standard V6 rate, for as long as the longest reference video.
		const [low, high] = referenceSeconds(measured);
		return dollars(2 * perSecond(sound) * low, 2 * perSecond(sound) * high);
	}
	return dollars(perSecond(sound) * duration, perSecond(sound) * duration);
}

// --- the module ---------------------------------------------------------------------------------

export const PIXVERSE: ProviderModule = Object.freeze({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
		// A new trace id on every request, a retry too: PixVerse traces by it and never deduplicates by it.
		return { 'API-KEY': credentials.apiKey, 'Ai-trace-id': randomUUID() };
	},

	readError: readPixVerseError,

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const model = modelOf(request.model);
		const counts = countsOf(request.inputs);
		const measured = isPlannedMedia(request.inputs) ? await measureItems(request.inputs, media) : undefined;
		const problems = [...ruleProblems(model, request, counts, measured), ...(measured ? fileProblems(measured) : [])];
		const estimate = estimateFor(model, request, counts, measured);
		return estimate ? { problems, estimate } : { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const model = modelOf(request.model);
		if (PROVIDER.models.find(entry => entry.id === model.id)?.providerModels[request.region] === undefined) {
			throw rejected(TEXT.notOffered(labelOf(model)));
		}
		const route = routeOf(request.mode, countsOf(request.inputs));
		// Every input is read before anything is uploaded.
		const prepared: Prepared[] = [];
		for (const item of plannedItems(request.inputs)) {
			prepared.push(await prepare(item));
		}
		const ids: Uploaded = { images: [], videos: [] };
		for (const entry of prepared) {
			const id = await upload(http, entry);
			const slot = entry.item.slot;
			if (slot === 'image') {
				ids.images.push(id);
			} else if (slot === 'video') {
				ids.videos.push(id);
			} else if (slot === 'startFrame' || slot === 'endFrame' || slot === 'source') {
				ids[slot] = id;
			}
		}
		const answer = await http.create({
			method: 'POST',
			path: apiPath(http, CREATE_PATHS[route]),
			body: { kind: 'bytes', bytes: jsonBytes(createBody(model, route, request, ids)), contentType: 'application/json' }
		});
		return createdTaskId(answer);
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return stateOf(await askAbout(ref, http));
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const state = stateOf(await askAbout(ref, http));
		if (state.state !== 'succeeded' || !state.videoUrl) {
			throw unreadable(TEXT.noVideo);
		}
		return { url: state.videoUrl };
	},

	async cancel(): Promise<boolean> {
		// PixVerse documents no cancellation; nothing is sent.
		return false;
	}
});
