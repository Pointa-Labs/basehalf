/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, measureItems, type MeasuredItem, type PlannedCounts } from './check.ts';
import { isRecord, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type HttpAnswer, type ProviderHttp } from './http.ts';
import { base64Length, bufferSource, dataUrlOf, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector, type PlannedItem } from './media.ts';
import type { ModulePollState, OutputLocation, ProviderModule, TaskSucceeded, VideoLocation } from './module.ts';
import type {
	CatalogMode,
	CatalogModel,
	CatalogParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
	ModeId,
	ModeInputs,
	Params,
	PollState,
	ProviderErrorCode,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * xAI's Grok Imagine video and image models with the user's own key (D59,
 * D64; `docs/specs/providers/xai.md`, which records the pages each fact comes
 * from). One API key as a bearer token; every input inline as a data URL; the
 * create answers a request id that `GET /videos/{id}` or `GET /images/{id}`
 * follows until the task ends; no cancellation. Each video model has one id
 * for every task, and the mode chooses the endpoint; an image request without
 * reference images is a generation, with them an edit, and is always deferred.
 */

type XaiModelId = 'grok-imagine-video-1.5' | 'grok-imagine-video-1.5-lite' | 'grok-imagine-video';
type XaiImageModelId = 'grok-imagine-image-2.0' | 'grok-imagine-image';
type Resolution = '480p' | '720p' | '1080p';
type ImageResolution = '1k' | '2k';
type ImageQuality = 'auto' | 'low' | 'medium';

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
			description: 'Text or a start frame to video with lip-synced sound, 1 to 15 seconds; 1080p is upscaled from 720p.'
		},
		'grok-imagine-video': {
			label: 'Grok Imagine Video',
			description: 'Text, a start frame, or up to 7 reference images to video with sound at 480p or 720p; it also edits clips of up to 8.7 seconds and extends clips by 2 to 10 seconds.'
		}
	}),
	imageModels: Object.freeze<Record<XaiImageModelId, { readonly label: string; readonly description: string }>>({
		'grok-imagine-image-2.0': {
			label: 'Grok Imagine Image 2.0',
			description: 'xAI\'s image model: images from a prompt, or edits of up to 5 images, at 1K or 2K, up to 10 at a time, at Low or Medium quality.'
		},
		'grok-imagine-image': {
			label: 'Grok Imagine Image',
			description: 'Images from a prompt, or edits of up to 3 images, at 1K or 2K, up to 10 at a time.'
		}
	}),
	adaptive: 'Adaptive',
	quality: 'Quality',
	count: 'Images',
	imageResolutions: Object.freeze<Record<ImageResolution, string>>({ '1k': '1K', '2k': '2K' }),
	qualities: Object.freeze<Record<ImageQuality, string>>({ auto: 'Auto', low: 'Low', medium: 'Medium' }),
	tipImageRatio: 'The shape of the image. Adaptive lets xAI choose one for the prompt, or keeps the shape of the first reference image.',
	tipQuality: 'Auto lets xAI choose: it currently makes a new image at Low and an edit at Medium. Medium spends more effort on detail.',
	oneImageRatio: (label: string) => `With one reference image, ${label} keeps the shape of that image. Choose Adaptive for Ratio, or connect another image.`,
	noImageAddress: 'xAI gave no address for this image.',
	imageWithheld: 'xAI withheld this image because it did not pass moderation; xAI still charges for the generation.',
	noImages: 'xAI reports that the images are ready but gives no list of them AI Video can read.',
	notOffered: (label: string) => `xAI does not offer ${label} in this region.`,
	noRequestId: 'xAI accepted the request but gave no request id AI Video can read.',
	failed: 'xAI reports that the generation failed.',
	withheld: 'xAI withheld the video because it did not pass moderation; xAI still charges for the generation.',
	expired: 'xAI reports that the request expired before its video was ready.',
	noAddress: 'xAI reports that the video is ready but gives no address AI Video can read.',
	notReady: 'xAI has no video for this request yet.',
	unknownStatus: (status: string) => `xAI reports a status AI Video does not know: ${status}.`,
	rateLimits: 'xAI takes 10 requests a second for each video model and 6 for each image model at the first usage tier, unless the team\'s limit was raised.',
	notMp4: (label: string) => `${label} is not an MP4 video; xAI edits and extends MP4 videos only.`,
	notImage: (label: string) => `${label} is not a PNG, JPEG, or WebP image.`,
	noOtherMedia: (label: string) => `${label} cannot be sent: xAI takes images and the clip to work on only.`,
	imagesOnly: (label: string) => `${label} cannot be sent: xAI's image models take reference images only.`
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
}

const MODELS: readonly XaiModel[] = Object.freeze([
	{
		id: 'grok-imagine-video-1.5', resolutions: ['480p', '720p', '1080p'], endFrame: true, references: 14, clips: false,
		pinnedUpTo720p: true
	},
	{
		id: 'grok-imagine-video-1.5-lite', resolutions: ['480p', '720p', '1080p'], endFrame: false, references: 0, clips: false,
		upscaled1080p: true
	},
	{
		id: 'grok-imagine-video', resolutions: ['480p', '720p'], endFrame: false, references: 7, clips: true,
		referenceMaxSeconds: 10, promptBeyondFrames: true
	}
] satisfies XaiModel[]);

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
		parameters: declareParameters(model)
	};
}

// --- the image models ---------------------------------------------------------------------------

interface XaiImageModel {
	/** The catalog id, which is also the id xAI takes. */
	readonly id: XaiImageModelId;
	/** The most source images of an edit. */
	readonly references: number;
	/** The values of `aspect_ratio` it takes besides `auto`, in the order the panel shows them. */
	readonly ratios: readonly string[];
	/** Whether it takes `quality`. */
	readonly quality: boolean;
}

/** The ratios of both image models before the wide ones, and the phone shapes after them. */
const IMAGE_RATIOS_COMMON: readonly string[] = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2']);
const IMAGE_RATIOS_PHONES: readonly string[] = Object.freeze(['19.5:9', '9:19.5', '20:9', '9:20']);

const IMAGE_MODELS: readonly XaiImageModel[] = Object.freeze([
	// 2.0 "additionally accepts quality, up to five source images for editing, and the 21:9 and 5:2 aspect ratios".
	{ id: 'grok-imagine-image-2.0', references: 5, ratios: [...IMAGE_RATIOS_COMMON, '21:9', '5:2', ...IMAGE_RATIOS_PHONES], quality: true },
	{ id: 'grok-imagine-image', references: 3, ratios: [...IMAGE_RATIOS_COMMON, ...IMAGE_RATIOS_PHONES], quality: false }
] satisfies XaiImageModel[]);

/** The models API's `max_prompt_length` of its example, read as characters, the smaller reading. */
const IMAGE_PROMPT_MAX_LENGTH = 1024;
/** `n`: 1 to 10 images in one request. */
const IMAGE_COUNT_MAX = 10;
/** xAI's `auto`, which is sent as nothing: the shape the model picks for the prompt, or that of the first reference image. */
const ADAPTIVE = 'adaptive';
const IMAGE_RESOLUTIONS: readonly ImageResolution[] = Object.freeze(['1k', '2k']);
const IMAGE_QUALITIES: readonly ImageQuality[] = Object.freeze(['auto', 'low', 'medium']);

function declareImageModel(model: XaiImageModel): CatalogModel {
	const parameters: CatalogParameter[] = [
		{
			name: 'ratio',
			label: TEXT.ratio,
			tooltip: TEXT.tipImageRatio,
			kind: 'choice',
			display: 'ratio',
			options: [{ value: ADAPTIVE, label: TEXT.adaptive }, ...model.ratios.map(value => ({ value, label: value }))],
			default: ADAPTIVE
		},
		{
			name: 'resolution',
			label: TEXT.resolution,
			kind: 'choice',
			options: IMAGE_RESOLUTIONS.map(value => ({ value, label: TEXT.imageResolutions[value] })),
			default: '1k'
		}
	];
	if (model.quality) {
		parameters.push({
			name: 'quality',
			label: TEXT.quality,
			tooltip: TEXT.tipQuality,
			kind: 'choice',
			options: IMAGE_QUALITIES.map(value => ({ value, label: TEXT.qualities[value] })),
			default: 'auto'
		});
	}
	parameters.push({ name: 'count', label: TEXT.count, kind: 'integer', min: 1, max: IMAGE_COUNT_MAX, step: 1, default: 1 });
	return {
		id: model.id,
		kind: 'image',
		label: TEXT.imageModels[model.id].label,
		description: TEXT.imageModels[model.id].description,
		providerModels: { global: model.id },
		prompt: { required: 'always', maxLength: IMAGE_PROMPT_MAX_LENGTH },
		modes: [{ id: 'reference', label: TEXT.modes.reference, inputs: inputs({ images: { min: 0, max: model.references } }), limits: {} }],
		parameters,
		outputFormat: 'jpeg'
	};
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'xai',
	label: TEXT.provider,
	regions: [
		{ id: 'global', label: TEXT.region, baseUrl: 'https://api.x.ai/v1', console: 'https://console.x.ai/team/default/api-keys' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: [...MODELS.map(declareModel), ...IMAGE_MODELS.map(declareImageModel)]
});

function modelOf(id: string): XaiModel {
	const model = MODELS.find(entry => entry.id === id);
	if (!model) {
		throw rejected(`xAI has no model "${id}".`);
	}
	return model;
}

function imageModelOf(id: string): XaiImageModel | undefined {
	return IMAGE_MODELS.find(entry => entry.id === id);
}

function labelOf(model: XaiModel): string {
	return TEXT.models[model.id].label;
}

/** Whether the region offers the model, as its declaration says. */
function offered(model: string, region: string): boolean {
	return PROVIDER.models.find(entry => entry.id === model)?.providerModels[region] !== undefined;
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

/**
 * The path and the JSON of an image request (xai.md, "Image models",
 * "Requests"): a generation without reference images, an edit with them,
 * always deferred so that it runs as a task.
 */
function imageRequest(model: XaiImageModel, params: Params, prompt: string, images: readonly string[]): { readonly path: string; readonly value: Record<string, unknown> } {
	const value: Record<string, unknown> = { model: model.id, prompt };
	if (images.length === 1) {
		value.image = { url: images[0] };
	} else if (images.length > 1) {
		value.images = images.map(url => ({ url }));
	}
	value.n = params.count;
	value.resolution = params.resolution;
	if (typeof params.ratio === 'string' && params.ratio !== ADAPTIVE && images.length !== 1) {
		// The edit of one image always takes that image's shape: xAI says not to set a ratio then.
		value.aspect_ratio = params.ratio;
	}
	if (model.quality) {
		value.quality = params.quality;
	}
	value.deferred = true;
	return { path: images.length ? '/images/edits' : '/images/generations', value };
}

/** The request id of a create's answer, the task id. */
function requestIdOf(answer: HttpAnswer): string {
	const requestId = answer.object().request_id;
	if (typeof requestId !== 'string' || !requestId.trim()) {
		throw unknownOutcome(TEXT.noRequestId);
	}
	return requestId;
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

/** Sends an image request once and answers its request id (xai.md, "Image models", "Requests"). */
async function submitImage(model: XaiImageModel, request: SubmitRequest, http: ProviderHttp): Promise<string> {
	if (!offered(model.id, request.region)) {
		throw rejected(TEXT.notOffered(TEXT.imageModels[model.id].label));
	}
	const items = plannedItems(request.inputs);
	// The one mode of an image model takes reference images only; anything else is refused before any file is read.
	for (const item of items) {
		if (item.slot !== 'image') {
			throw rejected(TEXT.imagesOnly(item.label));
		}
	}
	const images: string[] = [];
	for (const item of items) {
		images.push(await dataUrlFor(item));
	}
	const { path, value } = imageRequest(model, request.params, request.prompt, images);
	return requestIdOf(await http.create({ method: 'POST', path, body: { kind: 'json', value } }));
}

function words(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** What xAI answered about a task: its JSON, and whether the answer was HTTP 202, which says the generation still runs. */
interface TaskAnswer {
	readonly inProgress: boolean;
	readonly body?: Record<string, unknown>;
}

/** Asks about a task of a video model at `/videos`, or of an image model at `/images`. */
async function askAbout(ref: TaskRef, http: ProviderHttp, collection: 'videos' | 'images' = 'videos'): Promise<TaskAnswer> {
	const answer: HttpAnswer = await http.request({ method: 'GET', path: `/${collection}/${encodeURIComponent(ref.remoteId)}` });
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

/** How the answer of a finished task is read for the kind of its files. */
interface Finish<T> {
	/** The answer of a task that is `done`. */
	readonly done: (body: Record<string, unknown>) => T;
	/** What `expired` says, for the kind that documents it. */
	readonly expired?: string;
}

/** A task's state from xAI's answer, its `done` read by the kind of the task's files (xai.md, "Asking about a task"). */
function taskState<T extends ModulePollState>(answer: TaskAnswer, finish: Finish<T>): PollState | T {
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
		case 'done':
			return finish.done(body);
		case 'failed':
			return { state: 'failed', message: failureMessage(body.error) };
		default:
			if (status === 'expired' && finish.expired !== undefined) {
				return { state: 'failed', message: finish.expired };
			}
			if (answer.inProgress) {
				// HTTP 202 says the generation still runs, whatever the status is called.
				return { state: 'pending' };
			}
			throw unreadable(TEXT.unknownStatus(status.slice(0, 40)));
	}
}

/** A finished video task: the address of its video, or a video moderation withheld. */
const VIDEO_FINISH: Finish<PollState> = Object.freeze({
	done(body: Record<string, unknown>): PollState {
		const video = isRecord(body.video) ? body.video : undefined;
		if (video?.respect_moderation === false) {
			return { state: 'failed', message: TEXT.withheld };
		}
		const url = words(video?.url);
		if (!url) {
			throw unreadable(TEXT.noAddress);
		}
		return { state: 'succeeded', videoUrl: url };
	},
	expired: TEXT.expired
});

/** One image of a finished task: its temporary address, or why it has none. */
function imageOutputOf(entry: unknown): OutputLocation {
	if (isRecord(entry) && entry.respect_moderation === false) {
		return { refused: TEXT.imageWithheld };
	}
	const url = isRecord(entry) ? words(entry.url) : undefined;
	return url ? { url } : { refused: TEXT.noImageAddress };
}

/** A finished image task: one output per entry of `data`, in xAI's order. */
const IMAGE_FINISH: Finish<TaskSucceeded> = Object.freeze({
	done(body: Record<string, unknown>): TaskSucceeded {
		if (!Array.isArray(body.data)) {
			throw unreadable(TEXT.noImages);
		}
		return { state: 'succeeded', outputs: body.data.map(imageOutputOf) };
	}
});

function stateOf(answer: TaskAnswer): PollState {
	return taskState(answer, VIDEO_FINISH);
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

// --- checks -------------------------------------------------------------------------------------

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

/**
 * A request too large for AI Video to send: `value` is the JSON of the request
 * with empty inputs, to which the inputs add their data URLs.
 */
function sizeProblems(value: Record<string, unknown>, measured: readonly MeasuredItem[]): string[] {
	let encoded = 0;
	for (const item of measured) {
		const type = item.facts.format ? MEDIA_MIME_TYPES[item.facts.format] : 'application/octet-stream';
		encoded += `data:${type};base64,`.length + base64Length(item.facts.bytes);
	}
	const size = Buffer.byteLength(JSON.stringify(value), 'utf8') + encoded;
	const limit = DEFAULT_HTTP_OPTIONS.maxRequestBytes;
	return size > limit ? [`The inputs make a request of ${describeBytes(size)}; AI Video sends at most ${describeBytes(limit)}. Use fewer or smaller inputs.`] : [];
}

/** A clip that is not an MP4, and a request too large for AI Video to send. */
function fileProblems(model: XaiModel, request: CheckRequest, measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	const media: SentMedia[] = [];
	for (const item of measured) {
		if (item.slot === 'source' && item.facts.format === 'mov') {
			// The declared lengths already refused a clip that is neither an MP4 nor a MOV.
			problems.push(TEXT.notMp4(item.label));
		}
		media.push({ slot: item.slot, url: '' });
	}
	const { value } = createRequest(model, request.mode, request.params, request.prompt, media);
	return [...problems, ...sizeProblems(value, measured)];
}

/** The rules of an image request (xai.md, "Image models", "Rules between parameters"), and its size. */
function imageProblems(model: XaiImageModel, request: CheckRequest, counts: PlannedCounts, measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	if (counts.images === 1 && request.params.ratio !== undefined && request.params.ratio !== ADAPTIVE) {
		problems.push(TEXT.oneImageRatio(TEXT.imageModels[model.id].label));
	}
	const { value } = imageRequest(model, request.params, request.prompt, measured.map(() => ''));
	return [...problems, ...sizeProblems(value, measured)];
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
		const counts = countsOf(request.inputs);
		const measured = await measureItems(request.inputs, media);
		const image = imageModelOf(request.model);
		if (image) {
			return { problems: imageProblems(image, request, counts, measured) };
		}
		const model = modelOf(request.model);
		const problems = [
			...ruleProblems(model, request, counts),
			...fileProblems(model, request, measured)
		];
		return { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const image = imageModelOf(request.model);
		if (image) {
			return submitImage(image, request, http);
		}
		const model = modelOf(request.model);
		if (!offered(model.id, request.region)) {
			throw rejected(TEXT.notOffered(labelOf(model)));
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
		return requestIdOf(await http.create({ method: 'POST', path, body: { kind: 'json', value } }));
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<ModulePollState> {
		if (imageModelOf(ref.model)) {
			return taskState(await askAbout(ref, http, 'images'), IMAGE_FINISH);
		}
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
