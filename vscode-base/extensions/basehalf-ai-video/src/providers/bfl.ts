/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf } from './check.ts';
import { isRecord, ProviderFailure, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, isAllowedAddress, type HttpCall, type ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type {
	CatalogMode,
	CatalogModel,
	CatalogParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
	Media,
	ModeId,
	ModeInputs,
	ModeLimits,
	Params,
	PlannedMedia,
	PollState,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * Black Forest Labs' FLUX 3 video model with the user's own key (D59;
 * docs/specs/video-providers/bfl.md, which records the pages each fact comes
 * from). One catalog model: Frames and Extend run on `/flux-3-video`, whose
 * body names the task (`t2v`, `i2v`, `v2v`), and Edit on the route of FLUX
 * Video Edit [fast]. The key goes in `x-key`; images and the clip go inline as
 * data URLs. A task is followed at the polling address its create answered,
 * kept as the task's id: on the endpoint's origin it is asked with the key, on
 * a BFL cluster host without it, which BFL does not need there. There is no
 * cancellation.
 */

type Resolution = '720p' | '1080p' | '2k' | '4k';

/** A route of the API: what `check` answers as `providerModel`, and the task its body names. */
interface Route {
	readonly id: 'flux-3-video' | 'flux-tools/video-edit-v1';
	/** The body's `mode` on `/flux-3-video`; the edit's route takes none. */
	readonly task?: 't2v' | 'i2v' | 'v2v';
}

const MiB = 1024 * 1024;
/** Auto: BFL fits the length to the content. */
const AUTO_DURATION = -1;
const SHORTEST_SECONDS = 5;
const LONGEST_SECONDS = 20;
/** Continuation: at most 15 seconds of new video (release notes of 2026-08-17). */
const LONGEST_CONTINUATION_SECONDS = 15;
/** The edit's prompt, once trimmed: 1 to 4,096 characters. */
const EDIT_PROMPT_MAX_LENGTH = 4096;
/** BFL states no limit for the prompt of `/flux-3-video`; this is BaseHalf's bound. */
const PROMPT_MAX_LENGTH = 20_000;
/** An edit's clip: about 0.7 seconds (17 frames at 24 fps) to 15 seconds; the output keeps its length. */
const EDIT_CLIP_SECONDS: readonly [number, number] = Object.freeze([0.7, 15]) as readonly [number, number];
/** The most AI Video sends in one request; inline images are read up to the part of it their base64 can take. */
const REQUEST_MAX_BYTES = DEFAULT_HTTP_OPTIONS.maxRequestBytes;
const IMAGE_READ_MAX_BYTES = Math.floor(REQUEST_MAX_BYTES * 3 / 4);
/** The longest task id a node keeps. */
const REMOTE_ID_MAX_LENGTH = 256;

// --- labels and messages ------------------------------------------------------------------------

/** Every text of the module in English, in one table so that it can be translated later. */
const TEXT = Object.freeze({
	provider: 'Black Forest Labs',
	region: 'Global',
	apiKey: 'API Key',
	model: 'FLUX 3',
	description: 'Video with sound from text, a start frame, or a start and an end frame, 5 to 20 seconds up to 4K; it also continues a clip by 5 to 15 seconds and edits a clip of up to 15 seconds. A preview model.',
	modes: Object.freeze({ frames: 'Frames', edit: 'Edit', extend: 'Extend' }),
	resolution: 'Resolution',
	resolutionTooltip: 'At 16:9, HD is 1280 × 704, FHD 1920 × 1088, QHD 2560 × 1440, and UHD 3840 × 2176. Above HD, the same generation is finished at the larger size.',
	resolutions: Object.freeze<Record<Resolution, string>>({ '720p': '720p', '1080p': '1080p', '2k': '2K', '4k': '4K' }),
	ratio: 'Ratio',
	ratioTooltip: 'The shape of the video. Adaptive lets FLUX 3 choose it from the prompt and the inputs; a continuation then keeps the shape of the clip.',
	adaptive: 'Adaptive',
	duration: 'Duration',
	durationTooltip: 'In Extend mode, the length of the new part, at most 15 seconds. Auto lets FLUX 3 fit the length to the content.',
	auto: 'Auto',
	sound: 'Sound',
	soundTooltip: 'Speech, effects, and ambience made together with the video.',
	safetyTolerance: 'Safety Tolerance',
	safetyTooltip: 'How strictly Black Forest Labs moderates the prompt, the inputs, and the video: 0 is the strictest, 4 the most lenient.',
	extendDuration: 'FLUX 3 continues a clip by 5 to 15 seconds; choose 15 seconds or less, or Auto.',
	editPrompt: (length: number) => `The prompt is ${length} characters long; FLUX 3 in Edit mode takes at most ${EDIT_PROMPT_MAX_LENGTH}.`,
	notMp4: (label: string) => `${label} is a MOV video; Black Forest Labs takes MP4 videos only.`,
	notImage: (label: string) => `${label} is not a PNG, JPEG, or WebP image.`,
	notVideo: (label: string) => `${label} is not an MP4 video.`,
	noSuchInput: (label: string) => `FLUX 3 takes no ${label.charAt(0).toLowerCase()}${label.slice(1)}.`,
	tooLarge: (size: number, limit: number) => `The inputs make a request of ${describeBytes(size)}; AI Video sends at most ${describeBytes(limit)}. Use fewer or smaller inputs.`,
	noMode: (mode: string) => `FLUX 3 has no ${mode} mode.`,
	noResolution: (value: unknown) => `FLUX 3 has no resolution ${String(value)}.`,
	noTask: 'Black Forest Labs accepted the request but gave no task id or polling address AI Video can read.',
	pollingElsewhere: 'The task\'s polling address is neither on the endpoint set up for Black Forest Labs nor on a host of Black Forest Labs, so AI Video does not ask it.',
	requestModerated: (reasons: string) => `Black Forest Labs' moderation refused the prompt or an input before the video was made${reasons}. Change the request: the same one is refused again.`,
	contentModerated: (reasons: string) => `Black Forest Labs' moderation withheld the finished video${reasons}. Change the prompt or the inputs.`,
	failed: (detail: string) => detail ? `Black Forest Labs reports that the generation failed: ${detail}` : 'Black Forest Labs reports that the generation failed.',
	noCard: 'Black Forest Labs ended the task without a result (No Card Generated).',
	notFound: (id: string) => `Black Forest Labs does not know the task ${id}: it does not exist or has expired.`,
	unknownStatus: (status: string) => `Black Forest Labs reports a task state AI Video does not know: ${status}.`,
	noVideo: 'Black Forest Labs gives no address of a video for this task.',
	refusedKey: 'Black Forest Labs refused the API key. Check it in Video Providers.',
	forbidden: 'Black Forest Labs refused the API key for this request: the key may be wrong, or its project may not use this endpoint. Check it in Video Providers.',
	balance: 'The Black Forest Labs organization has too few credits for this request. Add credits in the BFL dashboard.',
	rateLimited: 'Black Forest Labs is already running as many tasks as the account may run at once, or received too many requests. Wait for a task to finish.',
	refused: (words: string) => words ? `Black Forest Labs refused the request: ${words}` : 'Black Forest Labs refused the request.',
	said: (words: string) => `Black Forest Labs: ${words}`
});

// --- the model ----------------------------------------------------------------------------------

/** The resolution classes of the API, by the shared values. */
const RESOLUTION_CLASSES: Readonly<Record<Resolution, string>> = Object.freeze({ '720p': 'hd', '1080p': 'fhd', '2k': 'qhd', '4k': 'uhd' });
const RESOLUTIONS = Object.freeze(Object.keys(RESOLUTION_CLASSES)) as readonly Resolution[];
const RATIOS: readonly string[] = Object.freeze(['21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21']);

const NONE = Object.freeze({ min: 0, max: 0 });
const NO_INPUTS = Object.freeze<ModeInputs>({ startFrame: 'none', endFrame: 'none', images: NONE, videos: NONE, audios: NONE, source: 'none' });

/** "up to 15 seconds and 50 MiB", at least 17 frames at 24 fps. */
const EDIT_LIMITS: ModeLimits = Object.freeze({ videoSeconds: EDIT_CLIP_SECONDS, videoMaxBytes: 50 * MiB });
/** "mp4, up to 50 MB and 15 seconds" (cookbook): 50 MB counted as 50,000,000 bytes; only the maximum length is stated. */
const EXTEND_LIMITS: ModeLimits = Object.freeze({ videoSeconds: Object.freeze([0.1, 15]) as readonly [number, number], videoMaxBytes: 50_000_000 });

const MODES = Object.freeze<CatalogMode[]>([
	{ id: 'frames', label: TEXT.modes.frames, inputs: { ...NO_INPUTS, startFrame: 'optional', endFrame: 'optional' }, limits: {} },
	{ id: 'edit', label: TEXT.modes.edit, inputs: { ...NO_INPUTS, source: 'required' }, limits: EDIT_LIMITS },
	{ id: 'extend', label: TEXT.modes.extend, inputs: { ...NO_INPUTS, source: 'required' }, limits: EXTEND_LIMITS }
]);

/** The settings of a generation; the edit follows its clip in all of them. */
const GENERATING: readonly ModeId[] = Object.freeze(['frames', 'extend']);

const PARAMETERS = Object.freeze<CatalogParameter[]>([
	{
		name: 'resolution',
		label: TEXT.resolution,
		tooltip: TEXT.resolutionTooltip,
		kind: 'choice',
		options: RESOLUTIONS.map(value => ({ value, label: TEXT.resolutions[value] })),
		default: '720p',
		modes: GENERATING
	},
	{
		name: 'ratio',
		label: TEXT.ratio,
		tooltip: TEXT.ratioTooltip,
		kind: 'choice',
		display: 'ratio',
		options: [{ value: 'adaptive', label: TEXT.adaptive }, ...RATIOS.map(value => ({ value, label: value }))],
		default: 'adaptive',
		modes: GENERATING
	},
	{
		name: 'duration',
		label: TEXT.duration,
		tooltip: TEXT.durationTooltip,
		kind: 'integer',
		unit: 'seconds',
		min: SHORTEST_SECONDS,
		max: LONGEST_SECONDS,
		step: 1,
		// BFL's own default is Auto; 5 seconds gives a video of a known length until the user chooses Auto.
		default: 5,
		auto: { value: AUTO_DURATION, label: TEXT.auto },
		modes: GENERATING
	},
	{ name: 'sound', label: TEXT.sound, tooltip: TEXT.soundTooltip, kind: 'boolean', default: true, modes: GENERATING },
	{ name: 'safety_tolerance', label: TEXT.safetyTolerance, tooltip: TEXT.safetyTooltip, kind: 'integer', min: 0, max: 4, step: 1, default: 2, advanced: true }
]);

const FLUX_3 = Object.freeze<CatalogModel>({
	id: 'flux-3',
	label: TEXT.model,
	description: TEXT.description,
	providerModels: { global: 'flux-3-video' },
	prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
	modes: MODES,
	parameters: PARAMETERS
});

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'bfl',
	label: TEXT.provider,
	regions: [{ id: 'global', label: TEXT.region, baseUrl: 'https://api.bfl.ai/v1', console: 'https://dashboard.bfl.ai' }],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey, placeholder: 'bfl_…' }],
	models: [FLUX_3]
});

/** The route a mode runs on: the edit's own, or `/flux-3-video` with the task the inputs make. */
function routeOf(mode: ModeId, startFrame: boolean): Route {
	switch (mode) {
		case 'frames':
			return { id: 'flux-3-video', task: startFrame ? 'i2v' : 't2v' };
		case 'extend':
			return { id: 'flux-3-video', task: 'v2v' };
		case 'edit':
			return { id: 'flux-tools/video-edit-v1' };
		default:
			throw rejected(TEXT.noMode(mode));
	}
}

function resolutionClass(value: unknown): string {
	if (typeof value !== 'string' || !Object.hasOwn(RESOLUTION_CLASSES, value)) {
		throw rejected(TEXT.noResolution(value));
	}
	return RESOLUTION_CLASSES[value as Resolution];
}

// --- requests -----------------------------------------------------------------------------------

/** The inputs as the body takes them: the start and the end frame in order, and the clip of Edit and Extend. */
interface SentMedia {
	readonly keyframes: readonly string[];
	readonly clip?: string;
}

/** The JSON of the request that creates the task (bfl.md, "Requests"). */
function requestBody(route: Route, params: Params, prompt: string, media: SentMedia): Record<string, unknown> {
	if (route.task === undefined) {
		// The edit follows its clip: length, shape, frame rate, and sound.
		return { video: media.clip ?? '', prompt, safety_tolerance: params.safety_tolerance };
	}
	return {
		mode: route.task,
		prompt,
		// One image starts the video, two start and end it.
		...(route.task === 'i2v' ? { keyframes: media.keyframes.length === 1 ? media.keyframes[0] : [...media.keyframes] } : {}),
		...(route.task === 'v2v' ? { start_video: media.clip ?? '' } : {}),
		aspect_ratio: params.ratio === 'adaptive' ? 'auto' : params.ratio,
		duration: params.duration === AUTO_DURATION ? 'auto' : params.duration,
		resolution: resolutionClass(params.resolution),
		generate_audio: params.sound === true,
		safety_tolerance: params.safety_tolerance
	};
}

/** An image as `data:<type>;base64,…`, its type read from its bytes. */
async function imageDataUrl(media: Media, label: string): Promise<string> {
	const read = await readMedia(media, IMAGE_READ_MAX_BYTES, label);
	const { format } = await measure(bufferSource(read.bytes));
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(TEXT.notImage(label));
	}
	return dataUrlOf(read, MEDIA_MIME_TYPES[format]);
}

/** The clip as `data:video/mp4;base64,…`, read up to the mode's limit. */
async function clipDataUrl(media: Media, label: string, maxBytes: number): Promise<string> {
	const read = await readMedia(media, maxBytes, label);
	const { format } = await measure(bufferSource(read.bytes));
	if (format !== 'mp4') {
		throw rejected(format === 'mov' ? TEXT.notMp4(label) : TEXT.notVideo(label));
	}
	return dataUrlOf(read, MEDIA_MIME_TYPES.mp4);
}

async function sentMedia(mode: ModeId, inputs: PlannedMedia): Promise<SentMedia> {
	const keyframes: string[] = [];
	let clip: string | undefined;
	for (const item of plannedItems(inputs)) {
		if (item.slot === 'startFrame' || item.slot === 'endFrame') {
			keyframes.push(await imageDataUrl(item.media, item.label));
		} else if (item.slot === 'source') {
			clip = await clipDataUrl(item.media, item.label, (mode === 'edit' ? EDIT_LIMITS : EXTEND_LIMITS).videoMaxBytes ?? REQUEST_MAX_BYTES);
		} else {
			throw rejected(TEXT.noSuchInput(item.label));
		}
	}
	return clip === undefined ? { keyframes } : { keyframes, clip };
}

/**
 * A polling address AI Video asks: `https` (or `http` on this computer), at
 * most as long as a task id, on the endpoint's origin, or on a host of BFL
 * over `https`. The framework sends the key to the endpoint's origin only.
 */
function followableAddress(value: string, endpoint: URL): URL | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (!isAllowedAddress(url) || url.hash || url.href.length > REMOTE_ID_MAX_LENGTH || /[\u0000- \u007F<>]/.test(url.href)) {
		return undefined;
	}
	if (url.origin === endpoint.origin) {
		return url;
	}
	const host = url.hostname.toLowerCase();
	return url.protocol === 'https:' && (host === 'bfl.ai' || host.endsWith('.bfl.ai')) ? url : undefined;
}

function isAddress(remoteId: string): boolean {
	return /^https?:\/\//i.test(remoteId);
}

/** The task's `remoteId`: the polling address BFL answered when AI Video may ask it, otherwise the task's id. */
function remoteIdOf(body: Record<string, unknown>, endpoint: URL): string {
	const polling = typeof body.polling_url === 'string' ? followableAddress(body.polling_url.trim(), endpoint) : undefined;
	if (polling) {
		return polling.href;
	}
	const id = typeof body.id === 'string' ? body.id.trim() : '';
	if (id && id.length <= REMOTE_ID_MAX_LENGTH && !isAddress(id) && !/[\u0000- \u007F]/.test(id)) {
		return id;
	}
	throw unknownOutcome(TEXT.noTask);
}

/** The task's id, also inside a polling address, for messages. */
function taskIdOf(remoteId: string): string {
	if (!isAddress(remoteId)) {
		return remoteId;
	}
	try {
		return new URL(remoteId).searchParams.get('id') || remoteId;
	} catch {
		return remoteId;
	}
}

/** A poll: the polling address, or `get_result` under the endpoint for a task id. */
function pollCall(remoteId: string, endpoint: URL): HttpCall {
	if (!isAddress(remoteId)) {
		return { method: 'GET', path: '/get_result', query: { id: remoteId } };
	}
	const url = followableAddress(remoteId, endpoint);
	if (!url) {
		throw rejected(TEXT.pollingElsewhere);
	}
	return { method: 'GET', url: url.href };
}

async function askAbout(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	return (await http.request(pollCall(ref.remoteId, http.endpoint))).object();
}

/** " (Violence, Self Harm)" from the moderation reasons of `details`, or nothing. */
function reasonsOf(body: Record<string, unknown>): string {
	const reasons = isRecord(body.details) ? body.details['Moderation Reasons'] : undefined;
	const words = Array.isArray(reasons) ? reasons.filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0).map(reason => reason.trim()) : [];
	return words.length ? ` (${words.join(', ')})` : '';
}

/** BFL's explanation of a failed task. */
function failureDetailOf(body: Record<string, unknown>): string {
	const details = body.details;
	for (const value of isRecord(details) ? [details.error, details.message] : []) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return '';
}

function sampleOf(body: Record<string, unknown>): string | undefined {
	const sample = isRecord(body.result) ? body.result.sample : undefined;
	return typeof sample === 'string' && sample.trim() ? sample.trim() : undefined;
}

/** A task's state from `get_result` (bfl.md, "Asking about a task"). */
function pollStateOf(body: Record<string, unknown>, remoteId: string): PollState {
	const status = body.status;
	const progress = body.progress;
	// BFL does not document the scale of `progress`; only a fraction is shown.
	const fraction = typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 1 ? { fraction: progress } : {};
	switch (status) {
		case 'Pending':
			return { state: 'pending', ...fraction };
		case 'Reasoning':
		case 'Generating':
			return { state: 'running', ...fraction };
		case 'Ready': {
			const videoUrl = sampleOf(body);
			return videoUrl ? { state: 'succeeded', videoUrl } : { state: 'succeeded' };
		}
		case 'Request Moderated':
			return { state: 'failed', message: TEXT.requestModerated(reasonsOf(body)) };
		case 'Content Moderated':
			return { state: 'failed', message: TEXT.contentModerated(reasonsOf(body)) };
		case 'Error':
		case 'Failed':
			return { state: 'failed', message: TEXT.failed(failureDetailOf(body)) };
		case 'No Card Generated':
			return { state: 'failed', message: TEXT.noCard };
		case 'Task not found':
			throw new ProviderFailure('notFound', TEXT.notFound(taskIdOf(remoteId)));
		default:
			throw unreadable(TEXT.unknownStatus(typeof status === 'string' && status.trim() ? status.trim().slice(0, 40) : 'none'));
	}
}

// --- errors -------------------------------------------------------------------------------------

/** BFL's words in an error answer: `detail` as text or as a validation list (its fields and messages, never the values sent), `details.error`, or `message`. */
function wordsOf(body: unknown): string {
	if (!isRecord(body)) {
		return '';
	}
	const detail = body.detail;
	if (typeof detail === 'string' && detail.trim()) {
		return detail.trim();
	}
	if (Array.isArray(detail)) {
		const parts = detail.filter(isRecord).map(entry => {
			const message = typeof entry.msg === 'string' ? entry.msg.trim() : '';
			const field = Array.isArray(entry.loc) ? entry.loc.filter(part => part !== 'body' && (typeof part === 'string' || typeof part === 'number')).join('.') : '';
			return message && field ? `${field}: ${message}` : message;
		}).filter(Boolean);
		if (parts.length) {
			return parts.slice(0, 5).join('; ');
		}
	}
	const candidates = [isRecord(body.details) ? body.details.error : undefined, body.message, isRecord(body.error) ? body.error.message : body.error];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim()) {
			return candidate.trim();
		}
	}
	return '';
}

function readBflError(status: number, body: unknown): ProviderErrorReading | undefined {
	const words = wordsOf(body);
	const said = words ? ` (${words})` : '';
	switch (status) {
		case 401:
			return { code: 'auth', message: `${TEXT.refusedKey}${said}` };
		case 403:
			return { code: 'auth', message: `${TEXT.forbidden}${said}` };
		case 402:
			return { code: 'balance', message: `${TEXT.balance}${said}` };
		case 429:
			return { code: 'rateLimited', message: `${TEXT.rateLimited}${said}` };
		case 400:
		case 422:
			return { code: 'rejected', message: TEXT.refused(words) };
		default:
			// Other statuses keep their meaning: a server error leaves a create's outcome unknown.
			return words ? { message: TEXT.said(words) } : undefined;
	}
}

// --- checks -------------------------------------------------------------------------------------

/** The rules the declarations cannot express (bfl.md, "Parameters"). */
function ruleProblems(request: CheckRequest): string[] {
	const problems: string[] = [];
	const duration = request.params.duration;
	if (request.mode === 'extend' && typeof duration === 'number' && duration !== AUTO_DURATION && duration > LONGEST_CONTINUATION_SECONDS) {
		problems.push(TEXT.extendDuration);
	}
	const length = [...request.prompt.trim()].length;
	if (request.mode === 'edit' && length > EDIT_PROMPT_MAX_LENGTH) {
		problems.push(TEXT.editPrompt(length));
	}
	return problems;
}

/** A clip that is not an MP4, and a request larger than AI Video sends. */
async function fileProblems(route: Route, request: CheckRequest, inputs: PlannedMedia, media: MediaInspector): Promise<string[]> {
	const problems: string[] = [];
	const keyframes: string[] = [];
	let clip: string | undefined;
	let mediaLength = 0;
	for (const item of plannedItems(inputs)) {
		const facts = await media.inspect(item.media);
		const type = item.slot === 'source' ? MEDIA_MIME_TYPES.mp4 : MEDIA_MIME_TYPES[facts.format ?? 'png'];
		mediaLength += `data:${type};base64,`.length + base64Length(facts.bytes);
		if (item.slot !== 'source') {
			keyframes.push('');
			continue;
		}
		clip = '';
		if (facts.format === 'mov') {
			problems.push(TEXT.notMp4(item.label));
		}
	}
	// The JSON with empty inputs, then the inputs as data URLs.
	const body = requestBody(route, request.params, request.prompt, clip === undefined ? { keyframes } : { keyframes, clip });
	const size = Buffer.byteLength(JSON.stringify(body), 'utf8') + mediaLength;
	if (size > REQUEST_MAX_BYTES) {
		problems.push(TEXT.tooLarge(size, REQUEST_MAX_BYTES));
	}
	return problems;
}

// --- the module ---------------------------------------------------------------------------------

export const BFL: ProviderModule = Object.freeze({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
		return { 'x-key': credentials.apiKey };
	},

	readError: readBflError,

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const route = routeOf(request.mode, countsOf(request.inputs).startFrame);
		const problems = ruleProblems(request);
		problems.push(...await fileProblems(route, request, request.inputs, media));
		return { problems, providerModel: route.id };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		// The route check answered: the same mode and inputs choose it.
		const route = routeOf(request.mode, request.inputs.startFrame !== undefined);
		const media = await sentMedia(request.mode, request.inputs);
		const answer = await http.create({
			method: 'POST',
			path: `/${route.id}`,
			body: { kind: 'json', value: requestBody(route, request.params, request.prompt, media) }
		});
		return remoteIdOf(answer.object(), http.endpoint);
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return pollStateOf(await askAbout(ref, http), ref.remoteId);
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const state = pollStateOf(await askAbout(ref, http), ref.remoteId);
		if (state.state === 'succeeded' && state.videoUrl) {
			return { url: state.videoUrl };
		}
		throw unreadable(TEXT.noVideo);
	},

	async cancel(): Promise<boolean> {
		// Black Forest Labs has no cancellation; nothing is sent.
		return false;
	}
});
