/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, isPlannedMedia, measureItems } from './check.ts';
import { isRecord, ProviderFailure, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type FormPart, type HttpAnswer, type ProviderHttp } from './http.ts';
import { bufferSource, dataUrlOf, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaFormat, type MediaInspector, type PlannedItem, type ReadMedia } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, CheckResult, Estimate, Params, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * Runway's own video models on its API, Runway Dev (D59;
 * `docs/specs/video-providers/runway.md`, which records the pages each fact
 * comes from). One API key as a bearer token, and the API's version in
 * `X-Runway-Version` on every request to the API. Images go inline as data
 * URIs, or through Runway's ephemeral upload when they are large; clips always
 * go through the upload. Tasks are asked about at `GET /v1/tasks/{id}` and
 * cancelled with `DELETE` while they have not ended.
 */

type RunwayModelId = 'gen4.5' | 'gen4_turbo' | 'aleph2';

// --- labels -------------------------------------------------------------------------------------

/** Every English text of the module, in one table so that they can be translated later. */
const LABELS = Object.freeze({
	provider: 'Runway',
	region: 'Runway Dev',
	apiKey: 'API Key',
	apiKeyPlaceholder: 'key_…',
	modes: Object.freeze({ frames: 'Frames', edit: 'Edit' }),
	resolution: 'Resolution',
	resolutionTooltip: 'Runway makes the videos of this model at 720p.',
	ratio: 'Ratio',
	adaptive: 'Adaptive',
	duration: 'Duration',
	seed: 'Seed',
	seedTooltip: 'The same seed with the same request gives a similar video. Leave it empty for a new one each time.',
	publicFigures: 'Public Figures',
	publicFiguresTooltip: 'How strictly Runway\'s moderation blocks recognizable public figures. Low is less strict.',
	publicFigureValues: Object.freeze({ auto: 'Auto', low: 'Low' }),
	models: Object.freeze<Record<RunwayModelId, { readonly label: string; readonly description: string; readonly ratioTooltip: string }>>({
		'gen4.5': {
			label: 'Gen-4.5',
			description: 'Runway\'s text and image to video model: from a prompt, with or without a start frame, 2 to 10 seconds of 720p video.',
			ratioTooltip: 'The shape of the video. From the prompt alone, Gen-4.5 makes 16:9 or 9:16 videos; a start frame is cropped from its center to the shape.'
		},
		'gen4_turbo': {
			label: 'Gen-4 Turbo',
			description: 'Runway\'s fastest image to video model: from a start frame, with or without a prompt, 2 to 10 seconds of 720p video.',
			ratioTooltip: 'The shape of the video. The start frame is cropped from its center to the shape.'
		},
		'aleph2': {
			label: 'Aleph 2.0',
			description: 'Runway\'s video editing model: changes a clip of 2 to 30 seconds as the prompt says, keeping its length and its resolution up to 1080p, or extends it to another shape.',
			ratioTooltip: 'Adaptive keeps the shape of the clip. Another shape extends the clip to it: Runway letterboxes the clip and fills the new area.'
		}
	}),
	promptUnits: (units: number, label: string, max: number) => `The prompt is ${units} characters long as Runway counts them, where most emoji count as two; ${label} takes at most ${max}.`,
	textToVideoRatio: (label: string) => `Without a start frame, ${label} makes 16:9 or 9:16 videos only. Choose one of them, or connect a start frame.`,
	clipTooSmall: (item: string, size: string, min: number) => `${item} is ${size}; Runway's upload takes files of at least ${min} bytes.`,
	needsStartFrame: (label: string) => `${label} needs a start frame.`,
	needsClip: (label: string) => `${label} needs a clip to work on.`,
	notTaken: (label: string, item: string) => `${label} does not take ${item}.`,
	notImage: (item: string) => `${item} is not a PNG, JPEG, or WebP image.`,
	notClip: (item: string) => `${item} is not an MP4 or MOV video.`,
	notInRegion: (label: string) => `Runway does not offer ${label} in this region.`,
	noRatio: (label: string, ratio: string) => `${label} has no size for the ratio ${ratio}.`,
	uploadFailed: (item: string, detail: string) => `${item} could not be uploaded to Runway: ${detail}`,
	uploadUnreadable: 'Runway answered the upload request in a form AI Video cannot read.',
	storageRefused: (status: number, code: string | undefined, message: string | undefined) => `Runway's storage refused the file (HTTP ${status}${code ? `, ${code}` : ''})${message ? `: ${message}` : '.'}`,
	noTaskId: 'Runway accepted the request but gave no task id AI Video can read.',
	unknownState: (state: string) => `Runway reports a task state AI Video does not know: ${state}.`,
	failed: 'Runway reports that the task failed.',
	failures: Object.freeze({
		safetyInput: 'Runway\'s moderation refused an input, and Runway does not refund such a task.',
		safetyOutput: 'Runway\'s moderation refused the video it made.',
		preprocessingSafety: 'Runway\'s moderation refused the prompt or an input.',
		badOutput: 'Runway rejected the result. Logos, watermarks, or text in the inputs, or a prompt that asks for text, are common causes; generating again may succeed.',
		invalidAsset: 'Runway cannot use an input, for its size, its length, or another property.',
		internal: 'Runway had an internal problem; generating again in a moment may succeed.'
	}),
	cancelled: 'Runway reports that the task was cancelled.',
	noVideo: 'Runway gives no address of a video for this task.',
	refusedKey: 'Runway refused the API key. Check it in Video Providers: Runway refuses a key that is not valid, was disabled, or belongs to a suspended account.',
	overLimit: 'A Runway project starts as many video generations in 24 hours as its usage tier allows (50 at tier 1, more after more credits are bought), and its uploads are limited too.',
	answeredStatus: (status: number) => `Runway answered with HTTP ${status}.`
});

// --- the models ---------------------------------------------------------------------------------

const MiB = 1024 * 1024;
/** Runway's upload takes files of 512 bytes to 200 MB. */
const UPLOAD_MIN_BYTES = 512;
const UPLOAD_MAX_BYTES = 200 * MiB;
/** Room for the upload's form fields within the largest request AI Video sends. */
const FORM_ROOM_BYTES = MiB;
/** The largest file AI Video uploads: 127 MiB, within Runway's limit and the 128 MiB AI Video sends in one request. */
const FILE_MAX_BYTES = Math.min(UPLOAD_MAX_BYTES, DEFAULT_HTTP_OPTIONS.maxRequestBytes - FORM_ROOM_BYTES);
/** The longest image data URI Runway takes, in characters: 5 MiB. A longer one is uploaded. */
const IMAGE_DATA_URI_MAX_LENGTH = 5 * MiB;
/** "Height and width must not exceed 8000px." */
const IMAGE_MAX_SIDE = 8000;
/** Characters of a prompt, which Runway counts in UTF-16 code units. */
const PROMPT_MAX_LENGTH = 1000;
/** Aleph 2.0 takes clips of 2 to 30 seconds. */
const CLIP_SECONDS: readonly [number, number] = [2, 30];

/** The pixel size Runway takes in `ratio` for each shape; every size is of 720p's class. */
const PIXEL_SIZES: ReadonlyMap<string, string> = new Map([
	['16:9', '1280:720'],
	['9:16', '720:1280'],
	['4:3', '1104:832'],
	['3:4', '832:1104'],
	['1:1', '960:960'],
	['21:9', '1584:672']
]);
/** Gen-4.5 from the prompt alone takes `1280:720` and `720:1280` only. */
const TEXT_TO_VIDEO_RATIOS: readonly string[] = Object.freeze(['16:9', '9:16']);
/** The shapes Aleph 2.0 extends a clip to (`targetAspectRatio`), in Runway's order. */
const ALEPH_RATIOS: readonly string[] = Object.freeze(['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9']);

const NO_INPUTS = Object.freeze({ min: 0, max: 0 });

function framesMode(startFrame: 'optional' | 'required', imageAspect: readonly [number, number]): CatalogMode {
	return {
		id: 'frames',
		label: LABELS.modes.frames,
		inputs: { startFrame, endFrame: 'none', images: NO_INPUTS, videos: NO_INPUTS, audios: NO_INPUTS, source: 'none' },
		limits: { imageMaxSide: IMAGE_MAX_SIDE, imageAspect, imageMaxBytes: FILE_MAX_BYTES }
	};
}

const EDIT_MODE: CatalogMode = {
	id: 'edit',
	label: LABELS.modes.edit,
	inputs: { startFrame: 'none', endFrame: 'none', images: NO_INPUTS, videos: NO_INPUTS, audios: NO_INPUTS, source: 'required' },
	limits: { videoSeconds: CLIP_SECONDS, videoMaxBytes: FILE_MAX_BYTES }
};

const RESOLUTION: CatalogParameter = {
	name: 'resolution',
	label: LABELS.resolution,
	tooltip: LABELS.resolutionTooltip,
	kind: 'choice',
	options: [{ value: '720p', label: '720p' }],
	default: '720p'
};

function sizedRatio(model: RunwayModelId): CatalogParameter {
	return {
		name: 'ratio',
		label: LABELS.ratio,
		tooltip: LABELS.models[model].ratioTooltip,
		kind: 'choice',
		display: 'ratio',
		options: [...PIXEL_SIZES.keys()].map(value => ({ value, label: value })),
		default: '16:9'
	};
}

const ALEPH_RATIO: CatalogParameter = {
	name: 'ratio',
	label: LABELS.ratio,
	tooltip: LABELS.models.aleph2.ratioTooltip,
	kind: 'choice',
	display: 'ratio',
	options: [{ value: 'adaptive', label: LABELS.adaptive }, ...ALEPH_RATIOS.map(value => ({ value, label: value }))],
	default: 'adaptive'
};

const DURATION: CatalogParameter = { name: 'duration', label: LABELS.duration, kind: 'integer', unit: 'seconds', min: 2, max: 10, step: 1, default: 5 };

/** Runway takes seeds up to 4294967295; the shared seed is 0 to 2147483647. */
const SEED: CatalogParameter = { name: 'seed', label: LABELS.seed, tooltip: LABELS.seedTooltip, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true };

/** Sent as `contentModeration.publicFigureThreshold`; Runway's moderation is `auto` by default. */
const PUBLIC_FIGURES: CatalogParameter = {
	name: 'publicFigureThreshold',
	label: LABELS.publicFigures,
	tooltip: LABELS.publicFiguresTooltip,
	kind: 'choice',
	options: [{ value: 'auto', label: LABELS.publicFigureValues.auto }, { value: 'low', label: LABELS.publicFigureValues.low }],
	default: 'auto',
	advanced: true
};

function declareModel(id: RunwayModelId, required: 'always' | 'withoutMedia', mode: CatalogMode, parameters: readonly CatalogParameter[]): CatalogModel {
	return {
		id,
		label: LABELS.models[id].label,
		description: LABELS.models[id].description,
		providerModels: { global: id },
		prompt: { required, maxLength: PROMPT_MAX_LENGTH },
		modes: [mode],
		parameters,
		estimate: true
	};
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'runway',
	label: LABELS.provider,
	regions: [
		{ id: 'global', label: LABELS.region, baseUrl: 'https://api.dev.runwayml.com', currency: 'USD', console: 'https://dev.runway.com/' }
	],
	credentials: [{ id: 'apiKey', label: LABELS.apiKey, placeholder: LABELS.apiKeyPlaceholder }],
	models: [
		// Gen-4.5 requires a prompt at both of its endpoints.
		declareModel('gen4.5', 'always', framesMode('optional', [0.5, 2]), [RESOLUTION, sizedRatio('gen4.5'), DURATION, SEED, PUBLIC_FIGURES]),
		declareModel('gen4_turbo', 'withoutMedia', framesMode('required', [0.5, 2.358]), [RESOLUTION, sizedRatio('gen4_turbo'), DURATION, SEED, PUBLIC_FIGURES]),
		declareModel('aleph2', 'withoutMedia', EDIT_MODE, [ALEPH_RATIO, SEED, PUBLIC_FIGURES])
	]
});

const MODEL_IDS: ReadonlySet<string> = new Set<RunwayModelId>(['gen4.5', 'gen4_turbo', 'aleph2']);

function modelOf(id: string): RunwayModelId {
	if (!MODEL_IDS.has(id)) {
		throw rejected(`Runway has no model "${id}".`);
	}
	return id as RunwayModelId;
}

function labelOf(model: RunwayModelId): string {
	return LABELS.models[model].label;
}

// --- estimates ----------------------------------------------------------------------------------

/** Credits per second of video, from Runway's price list. */
const CREDITS_PER_SECOND: Readonly<Record<RunwayModelId, number>> = Object.freeze({ 'gen4.5': 12, 'gen4_turbo': 5, 'aleph2': 28 });
/** Aleph 2.0 costs at least 56 credits a generation. */
const ALEPH_MINIMUM_CREDITS = 56;
/** What a credit costs. */
const USD_PER_CREDIT = 0.01;
/** The day the price list was read; the list states no date of its own. */
const PRICE_DATE = '2026-10-19';

/**
 * Credits × $0.01 (runway.md, "Estimate"): a second of Gen-4.5 is 12
 * credits, of Gen-4 Turbo 5; Aleph 2.0's video is as long as its clip, 28
 * credits a second and at least 56, a range of 2 to 30 seconds while the
 * clip is not measured.
 */
function estimateFor(model: RunwayModelId, params: Params, clipSeconds: number | undefined): Estimate | undefined {
	const rate = CREDITS_PER_SECOND[model];
	if (model === 'aleph2') {
		const [shortest, longest] = clipSeconds !== undefined ? [clipSeconds, clipSeconds] : CLIP_SECONDS;
		const dollars = (seconds: number) => Math.max(ALEPH_MINIMUM_CREDITS, rate * seconds) * USD_PER_CREDIT;
		return estimateOf('USD', dollars(shortest), dollars(longest), PRICE_DATE);
	}
	if (typeof params.duration !== 'number') {
		return undefined;
	}
	const amount = rate * params.duration * USD_PER_CREDIT;
	return estimateOf('USD', amount, amount, PRICE_DATE);
}

// --- requests -----------------------------------------------------------------------------------

/** The API version every request to the API names; requests without it fail. */
const API_VERSION = '2024-11-06';
/** Sent to the API only, not to Runway's storage or to the address of a video. */
const VERSION_HEADER: Readonly<Record<string, string>> = Object.freeze({ 'X-Runway-Version': API_VERSION });

/** A path of the API under the endpoint, which may already end with `/v1`. */
function apiPath(http: ProviderHttp, path: string): string {
	return /\/v1$/i.test(http.endpoint.pathname) ? path : `/v1${path}`;
}

function taskPath(http: ProviderHttp, remoteId: string): string {
	return apiPath(http, `/tasks/${encodeURIComponent(remoteId)}`);
}

/** The format the bytes of an input show. */
async function formatOf(read: ReadMedia): Promise<MediaFormat | undefined> {
	return (await measure(bufferSource(read.bytes))).format;
}

/** The name an upload gets, whose extension must match its contents. */
const UPLOAD_NAMES: Readonly<Partial<Record<PlannedItem['slot'], string>>> = Object.freeze({ startFrame: 'start-frame', source: 'source-video' });
const EXTENSIONS: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp', mp4: 'mp4', mov: 'mov' });

/** Refusals of Runway's storage that end an upload; a network error, 408, 429, or 5xx starts it over. */
const STORAGE_REFUSALS: readonly number[] = Object.freeze([400, 401, 403, 404, 405, 409, 411, 412, 413, 415]);

interface UploadSlot {
	readonly uploadUrl: string;
	readonly fields: Readonly<Record<string, string>>;
	readonly runwayUri: string;
}

function uploadSlotOf(body: Record<string, unknown>): UploadSlot {
	const { uploadUrl, fields, runwayUri } = body;
	if (typeof uploadUrl !== 'string' || !uploadUrl
		|| !isRecord(fields) || !Object.values(fields).every(value => typeof value === 'string')
		|| typeof runwayUri !== 'string' || !/^runway:\/\/\S+$/.test(runwayUri)) {
		throw unreadable(LABELS.uploadUnreadable);
	}
	return { uploadUrl, fields: fields as Record<string, string>, runwayUri };
}

/** The `<Code>` and `<Message>` of an error of the storage, which answers in XML. */
function storageErrorOf(body: Buffer): { readonly code?: string; readonly message?: string } {
	const text = body.toString('utf8');
	const code = /<Code>([^<]{1,100})<\/Code>/.exec(text)?.[1];
	const message = /<Message>([^<]{1,500})<\/Message>/.exec(text)?.[1];
	return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/**
 * Uploads a file to Runway's ephemeral storage and answers its `runway://`
 * address, valid for 24 hours. Runway says a failed upload is not sent again:
 * each attempt asks for a new upload address, and the whole upload is retried
 * as every upload is.
 */
async function upload(http: ProviderHttp, item: PlannedItem, read: ReadMedia, format: MediaFormat): Promise<string> {
	const filename = `${UPLOAD_NAMES[item.slot] ?? 'input'}.${EXTENSIONS[format] ?? format}`;
	try {
		return await http.retry(async () => {
			const asked = await http.requestOnce({
				method: 'POST',
				path: apiPath(http, '/uploads'),
				headers: VERSION_HEADER,
				body: { kind: 'json', value: { filename, type: 'ephemeral' } }
			});
			const slot = uploadSlotOf(asked.object());
			const parts: FormPart[] = [
				...Object.entries(slot.fields).map(([name, value]) => ({ name, value })),
				// The file goes last, after every field of the upload.
				{ name: 'file', file: { bytes: read.bytes, fileName: filename, contentType: MEDIA_MIME_TYPES[format] } }
			];
			const answer = await http.requestOnce({ method: 'POST', url: slot.uploadUrl, body: { kind: 'form', parts }, accept: STORAGE_REFUSALS });
			if (answer.status >= 200 && answer.status < 300) {
				return slot.runwayUri;
			}
			const error = storageErrorOf(answer.body);
			throw rejected(LABELS.storageRefused(answer.status, error.code, error.message), answer.status);
		});
	} catch (error) {
		if (error instanceof ProviderFailure) {
			// No task was made: say which input could not be sent.
			throw new ProviderFailure(error.code === 'invalidResponse' ? 'rejected' : error.code, LABELS.uploadFailed(item.label, error.message), error.status);
		}
		throw error;
	}
}

/** The start frame inline as a data URI when Runway takes it so, otherwise uploaded. */
async function imageUri(http: ProviderHttp, item: PlannedItem): Promise<string> {
	const read = await readMedia(item.media, FILE_MAX_BYTES, item.label);
	const format = await formatOf(read);
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(LABELS.notImage(item.label));
	}
	const dataUri = dataUrlOf(read, MEDIA_MIME_TYPES[format]);
	return dataUri.length <= IMAGE_DATA_URI_MAX_LENGTH ? dataUri : upload(http, item, read, format);
}

/** The clip, always uploaded. */
async function clipUri(http: ProviderHttp, item: PlannedItem): Promise<string> {
	const read = await readMedia(item.media, FILE_MAX_BYTES, item.label);
	const format = await formatOf(read);
	if (format !== 'mp4' && format !== 'mov') {
		throw rejected(LABELS.notClip(item.label));
	}
	if (read.bytes.byteLength < UPLOAD_MIN_BYTES) {
		throw rejected(LABELS.clipTooSmall(item.label, describeBytes(read.bytes.byteLength), UPLOAD_MIN_BYTES));
	}
	return upload(http, item, read, format);
}

/** The path and the JSON of the request that creates the task (runway.md, "Requests"). */
function createRequest(model: RunwayModelId, sentModel: string, params: Params, prompt: string, image: string | undefined, clip: string | undefined): { readonly path: string; readonly value: Record<string, unknown> } {
	const promptText = prompt.trim() ? { promptText: prompt } : {};
	const seed = typeof params.seed === 'number' ? { seed: params.seed } : {};
	const moderation = typeof params.publicFigureThreshold === 'string' ? { contentModeration: { publicFigureThreshold: params.publicFigureThreshold } } : {};
	if (model === 'aleph2') {
		if (clip === undefined) {
			throw rejected(LABELS.needsClip(labelOf(model)));
		}
		const shape = typeof params.ratio === 'string' && params.ratio !== 'adaptive' ? { targetAspectRatio: params.ratio } : {};
		return { path: '/video_to_video', value: { model: sentModel, videoUri: clip, ...promptText, ...shape, ...seed, ...moderation } };
	}
	const ratio = PIXEL_SIZES.get(String(params.ratio));
	if (!ratio) {
		throw rejected(LABELS.noRatio(labelOf(model), String(params.ratio)));
	}
	const common = { model: sentModel, ...promptText, ratio, duration: params.duration, ...seed, ...moderation };
	if (image !== undefined) {
		return { path: '/image_to_video', value: { ...common, promptImage: image } };
	}
	if (model === 'gen4_turbo') {
		throw rejected(LABELS.needsStartFrame(labelOf(model)));
	}
	return { path: '/text_to_video', value: common };
}

function createdTaskId(answer: HttpAnswer): string {
	const id = answer.object().id;
	if (typeof id !== 'string' || !id.trim()) {
		throw unknownOutcome(LABELS.noTaskId);
	}
	return id;
}

// --- tasks --------------------------------------------------------------------------------------

/** What a failure code says, before Runway's own words (errors/task-failures.md); a task without a code had an internal problem. */
const FAILURE_SENTENCES: readonly (readonly [RegExp, string])[] = Object.freeze([
	[/^SAFETY\.INPUT\./, LABELS.failures.safetyInput],
	[/^SAFETY\.OUTPUT\./, LABELS.failures.safetyOutput],
	[/^INPUT_PREPROCESSING\.SAFETY\./, LABELS.failures.preprocessingSafety],
	[/^INTERNAL\.BAD_OUTPUT\./, LABELS.failures.badOutput],
	[/^ASSET\.INVALID$/, LABELS.failures.invalidAsset],
	[/^(?:INPUT_PREPROCESSING\.INTERNAL|INTERNAL)$/, LABELS.failures.internal]
]);

function failureMessage(task: Record<string, unknown>): string {
	const code = typeof task.failureCode === 'string' && task.failureCode.trim() ? task.failureCode.trim() : undefined;
	const said = typeof task.failure === 'string' ? task.failure.trim() : '';
	const sentence = code === undefined ? LABELS.failures.internal : FAILURE_SENTENCES.find(([pattern]) => pattern.test(code))?.[1];
	const words = [said, code ? `(${code})` : ''].filter(Boolean).join(' ');
	return [sentence, words].filter(Boolean).join(' ') || LABELS.failed;
}

/** The first address of a succeeded task's output. */
function videoUrlOf(task: Record<string, unknown>): string | undefined {
	const output = Array.isArray(task.output) ? task.output.find(entry => typeof entry === 'string' && entry.trim()) : undefined;
	return typeof output === 'string' ? output.trim() : undefined;
}

function stateOf(task: Record<string, unknown>): PollState {
	switch (task.status) {
		case 'PENDING':
		// Beyond the tier's concurrency, the task waits and starts on its own.
		case 'THROTTLED':
			return { state: 'pending' };
		case 'RUNNING':
			return typeof task.progress === 'number' && Number.isFinite(task.progress) ? { state: 'running', fraction: task.progress } : { state: 'running' };
		case 'SUCCEEDED': {
			const videoUrl = videoUrlOf(task);
			return videoUrl ? { state: 'succeeded', videoUrl } : { state: 'succeeded' };
		}
		case 'FAILED':
			return { state: 'failed', message: failureMessage(task) };
		case 'CANCELLED':
			return { state: 'cancelled', message: LABELS.cancelled };
		default:
			throw unreadable(LABELS.unknownState(String(task.status).slice(0, 40)));
	}
}

async function askAbout(ref: TaskRef, http: ProviderHttp, accept?: readonly number[]): Promise<HttpAnswer> {
	return http.request({ method: 'GET', path: taskPath(http, ref.remoteId), headers: VERSION_HEADER, ...(accept ? { accept } : {}) });
}

// --- errors -------------------------------------------------------------------------------------

/**
 * An error answer of the API, `{error, issues, reason, docUrl}`: Runway's
 * words, the issues of its refused fields as `path: message`, and its reason
 * code, after what the user can do for a refused key or a limit. The statuses
 * give the contract's codes; Runway documents no answer for a project without
 * credits.
 */
function readRunwayError(status: number, body: unknown): ProviderErrorReading | undefined {
	const record = isRecord(body) ? body : {};
	const said = typeof record.error === 'string' ? record.error.trim() : '';
	const issues = (Array.isArray(record.issues) ? record.issues : []).filter(isRecord).map(issue => {
		const path = Array.isArray(issue.path) ? issue.path.filter(part => typeof part === 'string' || typeof part === 'number').join('.') : '';
		const message = typeof issue.message === 'string' ? issue.message.trim() : '';
		return path && message ? `${path}: ${message}` : message;
	}).filter(text => text.length > 0);
	const reason = typeof record.reason === 'string' && /^[A-Z][A-Z0-9_.]{0,79}$/.test(record.reason) ? record.reason : undefined;
	const words = [said, issues.length ? `(${issues.join('; ')})` : '', reason ? `(${reason})` : ''].filter(Boolean).join(' ');
	const note = status === 401 ? LABELS.refusedKey : status === 429 ? LABELS.overLimit : undefined;
	if (!note) {
		return words ? { message: words } : undefined;
	}
	const told = words || LABELS.answeredStatus(status);
	return { message: status === 401 ? `${note} (${told})` : `${told}${/[.!?)]$/.test(told) ? '' : '.'} ${note}` };
}

// --- the module ---------------------------------------------------------------------------------

export const RUNWAY: ProviderModule = Object.freeze<ProviderModule>({
	describe() {
		return PROVIDER;
	},

	headers(credentials) {
		return { Authorization: `Bearer ${credentials.apiKey}` };
	},

	readError: readRunwayError,

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const model = modelOf(request.model);
		const label = labelOf(model);
		const counts = countsOf(request.inputs);
		const problems: string[] = [];
		// The declarations count characters; Runway counts UTF-16 code units.
		if (request.prompt.length > PROMPT_MAX_LENGTH && [...request.prompt].length <= PROMPT_MAX_LENGTH) {
			problems.push(LABELS.promptUnits(request.prompt.length, label, PROMPT_MAX_LENGTH));
		}
		if (model === 'gen4.5' && !counts.startFrame && !TEXT_TO_VIDEO_RATIOS.includes(String(request.params.ratio))) {
			problems.push(LABELS.textToVideoRatio(label));
		}
		let clipSeconds: number | undefined;
		if (isPlannedMedia(request.inputs)) {
			for (const item of await measureItems(request.inputs, media)) {
				if (item.kind !== 'video') {
					continue;
				}
				if (item.facts.bytes < UPLOAD_MIN_BYTES) {
					problems.push(LABELS.clipTooSmall(item.label, describeBytes(item.facts.bytes), UPLOAD_MIN_BYTES));
				}
				clipSeconds = item.facts.seconds;
			}
		}
		const estimate = estimateFor(model, request.params, clipSeconds);
		return estimate ? { problems, estimate } : { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const model = modelOf(request.model);
		const sentModel = PROVIDER.models.find(entry => entry.id === model)?.providerModels[request.region];
		if (!sentModel) {
			throw rejected(LABELS.notInRegion(labelOf(model)));
		}
		const items = plannedItems(request.inputs);
		// An input the mode does not take is refused before any file is read.
		const taken: PlannedItem['slot'] = model === 'aleph2' ? 'source' : 'startFrame';
		const other = items.find(item => item.slot !== taken);
		if (other) {
			throw rejected(LABELS.notTaken(labelOf(model), other.label.charAt(0).toLowerCase() + other.label.slice(1)));
		}
		let image: string | undefined;
		let clip: string | undefined;
		for (const item of items) {
			if (item.slot === 'startFrame') {
				image = await imageUri(http, item);
			} else {
				clip = await clipUri(http, item);
			}
		}
		const { path, value } = createRequest(model, sentModel, request.params, request.prompt, image, clip);
		const answer = await http.create({ method: 'POST', path: apiPath(http, path), headers: VERSION_HEADER, body: { kind: 'json', value } });
		return createdTaskId(answer);
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return stateOf((await askAbout(ref, http)).object());
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		// A new question gives a fresh address: the addresses of a task expire within 24 to 48 hours.
		const state = stateOf((await askAbout(ref, http)).object());
		if (state.state !== 'succeeded' || !state.videoUrl) {
			throw unreadable(LABELS.noVideo);
		}
		return { url: state.videoUrl };
	},

	async cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean> {
		// DELETE cancels a task that has not ended, but deletes one that has, with its video.
		const asked = await askAbout(ref, http, [404]);
		if (asked.status === 404) {
			return false;
		}
		const status = asked.object().status;
		if (status !== 'PENDING' && status !== 'THROTTLED' && status !== 'RUNNING') {
			return false;
		}
		const answer = await http.requestOnce({ method: 'DELETE', path: taskPath(http, ref.remoteId), headers: VERSION_HEADER, accept: [404] });
		// 404: the task was already cancelled or deleted.
		return answer.status !== 404;
	}
});
