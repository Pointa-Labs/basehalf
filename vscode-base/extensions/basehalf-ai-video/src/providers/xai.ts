/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, measureItems, type MeasuredItem, type PlannedCounts } from './check.ts';
import { isRecord, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type HttpAnswer, type ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector, type PlannedItem } from './media.ts';
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
	Params,
	PollState,
	ProviderErrorCode,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * xAI's Grok Imagine video models with the user's own key (D59;
 * `docs/specs/video-providers/xai.md`, which records the pages each fact
 * comes from). One API key as a bearer token; every input inline as a data
 * URL; the create answers a request id that `GET /videos/{id}` follows until
 * the task ends; no cancellation. Each model has one id for every task, and
 * the mode chooses the endpoint.
 */

type XaiModelId = 'grok-imagine-video-1.5' | 'grok-imagine-video-1.5-lite' | 'grok-imagine-video';
type Resolution = '480p' | '720p' | '1080p';

// --- labels -------------------------------------------------------------------------------------

/** Every English text of the module, in one table so that the labels can be translated later. */
const TEXT = Object.freeze({
	provider: 'xAI',
	region: 'Global',
	apiKey: 'API Key',
	modes: Object.freeze<Record<ModeId, string>>({ frames: 'Frames', reference: 'References', edit: 'Edit', extend: 'Extend' }),
	resolution: 'Resolution',
	ratio: 'Ratio',
	duration: 'Duration',
	sound: 'Sound',
	tipRatio: 'The shape of the video. A video made from a start frame takes the shape of the frame.',
	tipResolutionPinned: 'With an end frame or reference images, 720p at most.',
	tipResolutionUpscaled: '1080p is upscaled from 720p.',
	tipDurationClips: 'In Extend mode, the length added to the clip: 2 to 10 seconds. From reference images, 10 seconds at most.',
	tipSound: 'Turn it off for a silent video.',
	models: Object.freeze<Record<XaiModelId, { readonly label: string; readonly description: string }>>({
		'grok-imagine-video-1.5': {
			label: 'Grok Imagine Video 1.5',
			description: 'Text, start and end frames, or up to 14 reference images to video with lip-synced sound, 1 to 15 seconds; 1080p from text or a start frame, 720p otherwise.'
		},
		'grok-imagine-video-1.5-lite': {
			label: 'Grok Imagine Video 1.5 Lite',
			description: 'Text or a start frame to video with lip-synced sound at the lowest price, 1 to 15 seconds; 1080p is upscaled from 720p.'
		},
		'grok-imagine-video': {
			label: 'Grok Imagine Video',
			description: 'Text, a start frame, or up to 7 reference images to video with sound at 480p or 720p; it also edits clips of up to 8.7 seconds and extends clips by 2 to 10 seconds.'
		}
	}),
	noRequestId: 'xAI accepted the request but gave no request id AI Video can read.',
	failed: 'xAI reports that the generation failed.',
	withheld: 'xAI withheld the video because it did not pass moderation; xAI still charges for the generation.',
	expired: 'xAI reports that the request expired before its video was ready.',
	noAddress: 'xAI reports that the video is ready but gives no address AI Video can read.',
	notReady: 'xAI has no video for this request yet.',
	unknownStatus: (status: string) => `xAI reports a status AI Video does not know: ${status}.`,
	rateLimits: 'xAI takes 10 requests a second for each video model unless the team\'s limit was raised.',
	notMp4: (label: string) => `${label} is not an MP4 video; xAI edits and extends MP4 videos only.`,
	notImage: (label: string) => `${label} is not a PNG, JPEG, or WebP image.`,
	noOtherMedia: (label: string) => `${label} cannot be sent: xAI takes images and the clip to work on only.`
});

// --- the models ---------------------------------------------------------------------------------

interface XaiModel {
	/** The catalog id, which is also the id xAI takes for every task. */
	readonly id: XaiModelId;
	readonly resolutions: readonly Resolution[];
	/** Whether Frames takes an end frame (`last_frame`). */
	readonly endFrame: boolean;
	/** The most reference images of References; 0 without that mode. */
	readonly references: number;
	/** Whether the model edits and extends clips. */
	readonly clips: boolean;
	/** Reference to video (references, or frames with an end frame) goes up to 720p, below the model's 1080p. */
	readonly pinnedUpTo720p?: boolean;
	/** 1080p is upscaled from 720p. */
	readonly upscaled1080p?: boolean;
	/** The longest video from reference images, below the 15 seconds of the parameter. */
	readonly referenceMaxSeconds?: number;
	/** References, Edit, and Extend need a prompt (the API reference's rule). */
	readonly promptBeyondFrames?: boolean;
	/** US dollars per second of video, by resolution. */
	readonly perSecond: Readonly<Partial<Record<Resolution, number>>>;
	/** US dollars per input image: each frame and reference image. */
	readonly perImage: number;
	/** US dollars per second of an input video. */
	readonly perVideoSecond?: number;
}

const MODELS: readonly XaiModel[] = Object.freeze([
	{
		id: 'grok-imagine-video-1.5', resolutions: ['480p', '720p', '1080p'], endFrame: true, references: 14, clips: false,
		pinnedUpTo720p: true,
		perSecond: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 }, perImage: 0.01
	},
	{
		id: 'grok-imagine-video-1.5-lite', resolutions: ['480p', '720p', '1080p'], endFrame: false, references: 0, clips: false,
		upscaled1080p: true,
		perSecond: { '480p': 0.02, '720p': 0.03, '1080p': 0.14 }, perImage: 0.01
	},
	{
		id: 'grok-imagine-video', resolutions: ['480p', '720p'], endFrame: false, references: 7, clips: true,
		referenceMaxSeconds: 10, promptBeyondFrames: true,
		perSecond: { '480p': 0.05, '720p': 0.07 }, perImage: 0.002, perVideoSecond: 0.01
	}
] satisfies XaiModel[]);

/** The day the model pages were read; their prices state no date of their own. */
const PRICE_DATE = '2026-10-19';

/** xAI states no longest prompt; the most AI Video takes. */
const PROMPT_MAX_LENGTH = 1_048_576;
const RATIOS: readonly string[] = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2']);
/** A clip to edit is at most 8.7 seconds; xAI states no shortest one. */
const EDIT_CLIP_SECONDS: readonly [number, number] = Object.freeze([0.1, 8.7]) as readonly [number, number];
const EXTEND_CLIP_SECONDS: readonly [number, number] = Object.freeze([2, 15]) as readonly [number, number];
/** The seconds an extension adds. */
const EXTEND_ADDED_SECONDS: readonly [number, number] = Object.freeze([2, 10]) as readonly [number, number];

const NO_INPUTS: ModeInputs = Object.freeze({
	startFrame: 'none',
	endFrame: 'none',
	images: Object.freeze({ min: 0, max: 0 }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: 0 }),
	source: 'none'
});

function inputs(change: Partial<ModeInputs>): ModeInputs {
	return { ...NO_INPUTS, ...change };
}

function declareModes(model: XaiModel): CatalogMode[] {
	const modes: CatalogMode[] = [
		{ id: 'frames', label: TEXT.modes.frames, inputs: inputs({ startFrame: 'optional', endFrame: model.endFrame ? 'optional' : 'none' }), limits: {} }
	];
	if (model.references > 0) {
		modes.push({ id: 'reference', label: TEXT.modes.reference, inputs: inputs({ images: { min: 1, max: model.references } }), limits: {} });
	}
	if (model.clips) {
		modes.push(
			{ id: 'edit', label: TEXT.modes.edit, inputs: inputs({ source: 'required' }), limits: { videoSeconds: EDIT_CLIP_SECONDS } },
			{ id: 'extend', label: TEXT.modes.extend, inputs: inputs({ source: 'required' }), limits: { videoSeconds: EXTEND_CLIP_SECONDS } }
		);
	}
	return modes;
}

function declareParameters(model: XaiModel): CatalogParameter[] {
	// Edit and Extend take none of the settings of a generation; Extend takes the seconds it adds.
	const generation: { readonly modes?: readonly ModeId[] } = model.clips ? { modes: ['frames', 'reference'] } : {};
	const resolutionTip = model.pinnedUpTo720p ? TEXT.tipResolutionPinned : model.upscaled1080p ? TEXT.tipResolutionUpscaled : undefined;
	return [
		{
			name: 'resolution',
			label: TEXT.resolution,
			...(resolutionTip ? { tooltip: resolutionTip } : {}),
			kind: 'choice',
			options: model.resolutions.map(value => ({ value, label: value })),
			default: '480p',
			...generation
		},
		{
			name: 'ratio',
			label: TEXT.ratio,
			tooltip: TEXT.tipRatio,
			kind: 'choice',
			display: 'ratio',
			options: RATIOS.map(value => ({ value, label: value })),
			default: '16:9',
			// Sent only without a start frame, whose shape the video takes.
			setByStartFrame: true,
			...generation
		},
		{
			name: 'duration',
			label: TEXT.duration,
			...(model.clips ? { tooltip: TEXT.tipDurationClips, modes: ['frames', 'reference', 'extend'] satisfies ModeId[] } : {}),
			kind: 'integer',
			unit: 'seconds',
			min: 1,
			max: 15,
			step: 1,
			default: 5
		},
		{ name: 'sound', label: TEXT.sound, tooltip: TEXT.tipSound, kind: 'boolean', default: true, ...generation }
	];
}

function declareModel(model: XaiModel): CatalogModel {
	return {
		id: model.id,
		label: TEXT.models[model.id].label,
		description: TEXT.models[model.id].description,
		providerModels: { global: model.id },
		prompt: { required: 'withoutMedia', maxLength: PROMPT_MAX_LENGTH },
		modes: declareModes(model),
		parameters: declareParameters(model),
		estimate: true
	};
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'xai',
	label: TEXT.provider,
	regions: [
		{ id: 'global', label: TEXT.region, baseUrl: 'https://api.x.ai/v1', currency: 'USD', console: 'https://console.x.ai/team/default/api-keys' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODELS.map(declareModel)
});

function modelOf(id: string): XaiModel {
	const model = MODELS.find(entry => entry.id === id);
	if (!model) {
		throw rejected(`xAI has no model "${id}".`);
	}
	return model;
}

function labelOf(model: XaiModel): string {
	return TEXT.models[model.id].label;
}

// --- requests -----------------------------------------------------------------------------------

/** The endpoint of each mode: the generations share one, editing and extension have their own. */
const CREATE_PATHS: Readonly<Record<ModeId, string>> = Object.freeze({
	frames: '/videos/generations',
	reference: '/videos/generations',
	edit: '/videos/edits',
	extend: '/videos/extensions'
});

/** An input as xAI takes it: a data URL, with the slot it fills. */
interface SentMedia {
	readonly slot: PlannedItem['slot'];
	readonly url: string;
}

/** The path and the JSON of the request that creates the task (xai.md, "Requests"). */
function createRequest(model: XaiModel, mode: ModeId, params: Params, prompt: string, media: readonly SentMedia[]): { readonly path: string; readonly value: Record<string, unknown> } {
	const value: Record<string, unknown> = { model: model.id };
	if (prompt.trim()) {
		value.prompt = prompt;
	}
	const urlOf = (slot: PlannedItem['slot']) => media.find(entry => entry.slot === slot)?.url;
	if (mode === 'edit' || mode === 'extend') {
		const clip = urlOf('source');
		if (clip !== undefined) {
			value.video = { url: clip };
		}
		if (mode === 'extend') {
			value.duration = params.duration;
		}
		return { path: CREATE_PATHS[mode], value };
	}
	const startFrame = urlOf('startFrame');
	const endFrame = urlOf('endFrame');
	if (startFrame !== undefined) {
		value.image = { url: startFrame };
	}
	if (endFrame !== undefined) {
		value.last_frame = { url: endFrame };
	}
	const references = media.filter(entry => entry.slot === 'image');
	if (references.length) {
		value.reference_images = references.map(entry => ({ url: entry.url }));
	}
	value.duration = params.duration;
	if (startFrame === undefined) {
		// A video made from a start frame takes the frame's shape; xAI ignores the ratio then.
		value.aspect_ratio = params.ratio;
	}
	value.resolution = params.resolution;
	value.generate_audio = params.sound === true;
	return { path: CREATE_PATHS[mode], value };
}

/** An input read whole and written as a data URL, its type read from its bytes. */
async function dataUrlFor(item: PlannedItem): Promise<string> {
	if (item.slot === 'video' || item.slot === 'audio') {
		throw rejected(TEXT.noOtherMedia(item.label));
	}
	const read = await readMedia(item.media, DEFAULT_HTTP_OPTIONS.maxRequestBytes, item.label);
	const { format } = await measure(bufferSource(read.bytes));
	if (item.slot === 'source') {
		if (format !== 'mp4') {
			throw rejected(TEXT.notMp4(item.label));
		}
		return dataUrlOf(read, MEDIA_MIME_TYPES.mp4);
	}
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(TEXT.notImage(item.label));
	}
	return dataUrlOf(read, MEDIA_MIME_TYPES[format]);
}

function words(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** What xAI answered about a task: its JSON, and whether the answer was HTTP 202, which says the generation still runs. */
interface TaskAnswer {
	readonly inProgress: boolean;
	readonly body?: Record<string, unknown>;
}

async function askAbout(ref: TaskRef, http: ProviderHttp): Promise<TaskAnswer> {
	const answer: HttpAnswer = await http.request({ method: 'GET', path: `/videos/${encodeURIComponent(ref.remoteId)}` });
	if (answer.status === 202) {
		// Still in progress; the body, when AI Video can read it, says how far.
		try {
			return { inProgress: true, body: answer.object() };
		} catch {
			return { inProgress: true };
		}
	}
	return { inProgress: false, body: answer.object() };
}

/** `progress` from 0 to 99 while pending, when the answer has it. */
function progressOf(body: Record<string, unknown>): number {
	const progress = body.progress;
	return typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
}

/** The failure's message with its code, such as "Prompt cannot be empty. (invalid_argument)". */
function failureMessage(error: unknown): string {
	const message = isRecord(error) ? words(error.message) : words(error);
	const code = isRecord(error) ? words(error.code) : undefined;
	return [message ?? TEXT.failed, code ? `(${code})` : ''].filter(Boolean).join(' ');
}

/** A task's state from xAI's answer (xai.md, "Asking about a task"). */
function stateOf(answer: TaskAnswer): PollState {
	const body = answer.body;
	const status = body ? words(body.status) : undefined;
	if (!body || status === undefined) {
		if (answer.inProgress) {
			return { state: 'pending' };
		}
		throw unreadable(TEXT.unknownStatus('none'));
	}
	switch (status) {
		case 'pending': {
			const progress = progressOf(body);
			return progress > 0 ? { state: 'running', fraction: progress / 100 } : { state: 'pending' };
		}
		case 'done': {
			const video = isRecord(body.video) ? body.video : undefined;
			if (video?.respect_moderation === false) {
				return { state: 'failed', message: TEXT.withheld };
			}
			const url = words(video?.url);
			if (!url) {
				throw unreadable(TEXT.noAddress);
			}
			return { state: 'succeeded', videoUrl: url };
		}
		case 'failed':
			return { state: 'failed', message: failureMessage(body.error) };
		case 'expired':
			return { state: 'failed', message: TEXT.expired };
		default:
			if (answer.inProgress) {
				// HTTP 202 says the generation still runs, whatever the status is called.
				return { state: 'pending' };
			}
			throw unreadable(TEXT.unknownStatus(status.slice(0, 40)));
	}
}

// --- errors -------------------------------------------------------------------------------------

/** A 400 that names the API key: xAI answers an incorrect key so (Debugging Errors). */
const API_KEY_WORDS = /\bapi[\s_-]?key\b/i;
/** Requests are rejected once the prepaid credits are used up or the invoiced billing limit is reached (Manage Billing). */
const BALANCE_WORDS = /\bcredits?\b|\bspending limit\b|\bbilling limit\b|\binsufficient (?:balance|funds)\b/i;

/**
 * An error answer of xAI, `{"code": "<code>", "error": "<message>"}`: its
 * message with its code. xAI documents statuses rather than codes, so a 400
 * about the API key and a refusal about credits are read from the message.
 */
function readXaiError(status: number, body: unknown): ProviderErrorReading | undefined {
	const error = isRecord(body) ? body.error : undefined;
	const said = words(error) ?? (isRecord(error) ? words(error.message) : undefined) ?? readCommonError(body)?.message;
	const code = isRecord(body) ? words(body.code) ?? (isRecord(error) ? words(error.code) : undefined) : undefined;
	const text = [said, code && code !== said ? `(${code})` : '', status === 429 ? TEXT.rateLimits : ''].filter(Boolean).join(' ');
	const about = `${said ?? ''} ${code ?? ''}`;
	let mapped: ProviderErrorCode | undefined;
	if (status === 400 && API_KEY_WORDS.test(about)) {
		mapped = 'auth';
	} else if (status >= 400 && status < 500 && status !== 429 && BALANCE_WORDS.test(about)) {
		mapped = 'balance';
	}
	return text || mapped ? { ...(text ? { message: text } : {}), ...(mapped ? { code: mapped } : {}) } : undefined;
}

// --- checks and estimates -----------------------------------------------------------------------

/** The rules between parameters and inputs that the declarations cannot express (xai.md, "Rules between parameters"). */
function ruleProblems(model: XaiModel, request: CheckRequest, counts: PlannedCounts): string[] {
	const problems: string[] = [];
	const label = labelOf(model);
	const { resolution, duration } = request.params;
	if (model.pinnedUpTo720p && request.mode === 'frames' && counts.endFrame && resolution === '1080p') {
		problems.push(`${label} makes a video from a start and an end frame at 480p or 720p.`);
	}
	if (model.pinnedUpTo720p && request.mode === 'reference' && resolution === '1080p') {
		problems.push(`${label} makes a video from reference images at 480p or 720p.`);
	}
	if (model.referenceMaxSeconds !== undefined && request.mode === 'reference' && typeof duration === 'number' && duration > model.referenceMaxSeconds) {
		problems.push(`${label} makes a video from reference images of at most ${model.referenceMaxSeconds} seconds.`);
	}
	if (request.mode === 'extend' && typeof duration === 'number' && (duration < EXTEND_ADDED_SECONDS[0] || duration > EXTEND_ADDED_SECONDS[1])) {
		problems.push(`In ${TEXT.modes.extend} mode, ${label} adds ${EXTEND_ADDED_SECONDS[0]} to ${EXTEND_ADDED_SECONDS[1]} seconds to the clip.`);
	}
	if (model.promptBeyondFrames && request.mode !== 'frames' && !request.prompt.trim()) {
		problems.push(`Write a prompt: ${label} needs one in ${TEXT.modes[request.mode]} mode.`);
	}
	return problems;
}

/** A clip that is not an MP4, and a request too large for AI Video to send. */
function fileProblems(model: XaiModel, request: CheckRequest, measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	const media: SentMedia[] = [];
	let encoded = 0;
	for (const item of measured) {
		if (item.slot === 'source' && item.facts.format === 'mov') {
			// The declared lengths already refused a clip that is neither an MP4 nor a MOV.
			problems.push(TEXT.notMp4(item.label));
		}
		const type = item.facts.format ? MEDIA_MIME_TYPES[item.facts.format] : 'application/octet-stream';
		media.push({ slot: item.slot, url: '' });
		encoded += `data:${type};base64,`.length + base64Length(item.facts.bytes);
	}
	// The JSON of the request with empty inputs, then the inputs as data URLs.
	const { value } = createRequest(model, request.mode, request.params, request.prompt, media);
	const size = Buffer.byteLength(JSON.stringify(value), 'utf8') + encoded;
	const limit = DEFAULT_HTTP_OPTIONS.maxRequestBytes;
	if (size > limit) {
		problems.push(`The inputs make a request of ${describeBytes(size)}; AI Video sends at most ${describeBytes(limit)}. Use fewer or smaller inputs.`);
	}
	return problems;
}

/** The length of the clip: measured, or the shortest and longest its mode allows when it cannot be read. */
function clipSeconds(mode: ModeId, measured: readonly MeasuredItem[]): readonly [number, number] {
	const seconds = measured.find(item => item.slot === 'source')?.facts.seconds;
	if (seconds !== undefined) {
		return [seconds, seconds];
	}
	return mode === 'edit' ? EDIT_CLIP_SECONDS : EXTEND_CLIP_SECONDS;
}

/**
 * The price of a generation in US dollars (xai.md, "Estimate"): the seconds
 * of video at the resolution's price, and each input image and second of
 * input video. An edited or extended video keeps the clip's resolution, which
 * AI Video does not measure, so its estimate spans the 480p and 720p prices;
 * an extension spans the seconds it adds and the whole result too.
 */
function estimateFor(model: XaiModel, mode: ModeId, params: Params, counts: PlannedCounts, measured: readonly MeasuredItem[]): Estimate | undefined {
	if (mode === 'frames' || mode === 'reference') {
		const perSecond = model.perSecond[params.resolution as Resolution];
		if (perSecond === undefined || typeof params.duration !== 'number') {
			return undefined;
		}
		const images = (counts.startFrame ? 1 : 0) + (counts.endFrame ? 1 : 0) + counts.images;
		const amount = params.duration * perSecond + images * model.perImage;
		return estimateOf('USD', amount, amount, PRICE_DATE);
	}
	const low = model.perSecond['480p'];
	const high = model.perSecond['720p'];
	const input = model.perVideoSecond;
	if (low === undefined || high === undefined || input === undefined) {
		return undefined;
	}
	const [shortest, longest] = clipSeconds(mode, measured);
	if (mode === 'edit') {
		// The edited video is as long as the clip.
		return estimateOf('USD', shortest * (low + input), longest * (high + input), PRICE_DATE);
	}
	if (typeof params.duration !== 'number') {
		return undefined;
	}
	const added = params.duration;
	return estimateOf('USD', added * low + shortest * input, (longest + added) * high + longest * input, PRICE_DATE);
}

// --- the module ---------------------------------------------------------------------------------

export const XAI: ProviderModule = Object.freeze({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
		return { Authorization: `Bearer ${credentials.apiKey}` };
	},

	readError: readXaiError,

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const model = modelOf(request.model);
		const counts = countsOf(request.inputs);
		const measured = await measureItems(request.inputs, media);
		const problems = [
			...ruleProblems(model, request, counts),
			...fileProblems(model, request, measured)
		];
		const estimate = estimateFor(model, request.mode, request.params, counts, measured);
		return estimate ? { problems, estimate } : { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const model = modelOf(request.model);
		if (PROVIDER.models.find(entry => entry.id === model.id)?.providerModels[request.region] === undefined) {
			throw rejected(`xAI does not offer ${labelOf(model)} in this region.`);
		}
		const items = plannedItems(request.inputs);
		// A reference video or audio is refused before any file is read.
		for (const item of items) {
			if (item.slot === 'video' || item.slot === 'audio') {
				throw rejected(TEXT.noOtherMedia(item.label));
			}
		}
		const media: SentMedia[] = [];
		for (const item of items) {
			media.push({ slot: item.slot, url: await dataUrlFor(item) });
		}
		const { path, value } = createRequest(model, request.mode, request.params, request.prompt, media);
		const answer = await http.create({ method: 'POST', path, body: { kind: 'json', value } });
		const requestId = answer.object().request_id;
		if (typeof requestId !== 'string' || !requestId.trim()) {
			throw unknownOutcome(TEXT.noRequestId);
		}
		return requestId;
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return stateOf(await askAbout(ref, http));
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const state = stateOf(await askAbout(ref, http));
		if (state.state === 'succeeded' && state.videoUrl) {
			return { url: state.videoUrl };
		}
		throw unreadable(state.state === 'failed' || state.state === 'cancelled' ? state.message : TEXT.notReady);
	},

	async cancel(): Promise<boolean> {
		// xAI has no cancellation; nothing is sent.
		return false;
	}
});
