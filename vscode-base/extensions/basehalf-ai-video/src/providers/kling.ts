/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, isPlannedMedia } from './check.ts';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type HttpAnswer, type ProviderHttp } from './http.ts';
import { base64Length, base64Of, describeBytes, plannedItems, readMedia, type MediaInspector, type PlannedItem } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type {
	CatalogMode,
	CatalogModel,
	CatalogParameter,
	CatalogProvider,
	CheckRequest,
	CheckResult,
	Currency,
	Estimate,
	Params,
	ParamValue,
	PlannedCounts,
	PlannedMedia,
	PollState,
	ProviderErrorCode,
	SubmitRequest,
	TaskRef
} from './types.ts';

/**
 * Kling's video models on its new API, where the model is part of the path
 * (D59; `docs/specs/video-providers/kling.md`, which records the pages each
 * fact comes from). One API key as a bearer token; images inline as plain
 * base64; tasks asked about at `GET /tasks`; no cancellation.
 */

type KlingModelId = 'kling-3.0-turbo' | 'kling-3.0' | 'kling-3.0-omni' | 'kling-o1' | 'kling-2.6' | 'kling-2.5-turbo';
type Resolution = '720p' | '1080p' | '4k';

// --- labels -------------------------------------------------------------------------------------

/** Every label of the catalog entry, in one table so that they can be translated later. */
const LABELS = Object.freeze({
	provider: 'Kling',
	regions: Object.freeze({ cn: 'China', intl: 'International' }),
	apiKey: 'API Key',
	modes: Object.freeze({ frames: 'Frames', reference: 'References' }),
	resolution: 'Resolution',
	resolutions: Object.freeze<Record<Resolution, string>>({ '720p': '720p', '1080p': '1080p', '4k': '4K' }),
	ratio: 'Ratio',
	ratioTooltip: 'The shape of the video. A video made from a start frame takes the shape of the frame.',
	duration: 'Duration',
	sound: 'Sound',
	models: Object.freeze<Record<KlingModelId, { readonly label: string; readonly description: string }>>({
		'kling-3.0-turbo': {
			label: 'Kling 3.0 Turbo',
			description: 'Text or a start frame to video of 3 to 15 seconds at 720p or 1080p, always with sound.'
		},
		'kling-3.0': {
			label: 'Kling 3.0',
			description: 'Text or frames to video of 3 to 15 seconds up to 4K, with sound when asked.'
		},
		'kling-3.0-omni': {
			label: 'Kling 3.0 Omni',
			description: 'Text, frames, or up to seven reference images to video of 3 to 15 seconds up to 4K, with sound when asked.'
		},
		'kling-o1': {
			label: 'Kling O1',
			description: 'Text, frames, or up to seven reference images to silent video at 720p or 1080p: 5 or 10 seconds in Frames mode, 3 to 10 with references.'
		},
		'kling-2.6': {
			label: 'Kling 2.6',
			description: 'Text or frames to video of 5 or 10 seconds at 720p or 1080p; sound and an end frame need 1080p.'
		},
		'kling-2.5-turbo': {
			label: 'Kling 2.5 Turbo',
			description: 'Text or frames to silent video of 5 or 10 seconds at 720p or 1080p; an end frame needs 1080p.'
		}
	})
});

// --- the models ---------------------------------------------------------------------------------

/** Units per generated second at one resolution, without and with sound. */
interface UnitsPerSecond {
	readonly silent?: number;
	readonly sound?: number;
}

interface KlingModel {
	/** The catalog id, which is also the id Kling takes in the path, in both regions. */
	readonly id: KlingModelId;
	/** `split`: `/text-to-video/<id>` and `/image-to-video/<id>`; `omni`: `/omni-video/<id>`. */
	readonly api: 'split' | 'omni';
	readonly endFrame: boolean;
	/** Whether the model has a References mode. */
	readonly references: boolean;
	readonly resolutions: readonly Resolution[];
	readonly duration: { readonly min: number; readonly max: number; readonly step: number };
	/** `setting`: the Sound parameter; `always`: sound without a setting; `never`: silent. */
	readonly sound: 'setting' | 'always' | 'never';
	readonly promptMaxLength: number;
	/** The prompt's limit with a start frame, where it is lower. */
	readonly promptMaxLengthWithFrame?: number;
	/** The only durations of Frames mode, where the parameter allows more. */
	readonly framesDurations?: readonly number[];
	readonly soundOnlyAt1080p?: boolean;
	readonly endFrameOnlyAt1080p?: boolean;
	readonly endFrameOnlySilent?: boolean;
	/** The price list, by resolution. */
	readonly units: Readonly<Partial<Record<Resolution, UnitsPerSecond>>>;
}

const MODELS: readonly KlingModel[] = Object.freeze([
	{
		id: 'kling-3.0-turbo', api: 'split', endFrame: false, references: false,
		resolutions: ['720p', '1080p'], duration: { min: 3, max: 15, step: 1 }, sound: 'always',
		promptMaxLength: 3072, promptMaxLengthWithFrame: 2500,
		units: { '720p': { sound: 0.8 }, '1080p': { sound: 1.0 } }
	},
	{
		id: 'kling-3.0', api: 'split', endFrame: true, references: false,
		resolutions: ['720p', '1080p', '4k'], duration: { min: 3, max: 15, step: 1 }, sound: 'setting',
		promptMaxLength: 3072,
		units: { '720p': { silent: 0.6, sound: 0.9 }, '1080p': { silent: 0.8, sound: 1.2 }, '4k': { silent: 3.0, sound: 3.0 } }
	},
	{
		id: 'kling-3.0-omni', api: 'omni', endFrame: true, references: true,
		resolutions: ['720p', '1080p', '4k'], duration: { min: 3, max: 15, step: 1 }, sound: 'setting',
		promptMaxLength: 3072,
		units: { '720p': { silent: 0.6, sound: 0.8 }, '1080p': { silent: 0.8, sound: 1.0 }, '4k': { silent: 3.0, sound: 3.0 } }
	},
	{
		id: 'kling-o1', api: 'omni', endFrame: true, references: true,
		resolutions: ['720p', '1080p'], duration: { min: 3, max: 10, step: 1 }, sound: 'never',
		promptMaxLength: 2500, framesDurations: [5, 10],
		units: { '720p': { silent: 0.6 }, '1080p': { silent: 0.8 } }
	},
	{
		id: 'kling-2.6', api: 'split', endFrame: true, references: false,
		resolutions: ['720p', '1080p'], duration: { min: 5, max: 10, step: 5 }, sound: 'setting',
		promptMaxLength: 2500, soundOnlyAt1080p: true, endFrameOnlyAt1080p: true, endFrameOnlySilent: true,
		units: { '720p': { silent: 0.3 }, '1080p': { silent: 0.5, sound: 1.0 } }
	},
	{
		id: 'kling-2.5-turbo', api: 'split', endFrame: true, references: false,
		resolutions: ['720p', '1080p'], duration: { min: 5, max: 10, step: 5 }, sound: 'never',
		promptMaxLength: 2500, endFrameOnlyAt1080p: true,
		units: { '720p': { silent: 0.3 }, '1080p': { silent: 0.5 } }
	}
]);

/** What one unit costs in each region: ¥1.0 in China and $0.14 elsewhere. */
const UNIT_PRICES: Readonly<Record<string, { readonly currency: Currency; readonly perUnit: number }>> = Object.freeze({
	cn: { currency: 'CNY', perUnit: 1 },
	intl: { currency: 'USD', perUnit: 0.14 }
});

/** The day the price list was read; the list states no date of its own. */
const PRICE_DATE = '2026-10-19';

/** 50 MB, the largest image Kling takes. */
const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 7;
const RATIOS: readonly string[] = Object.freeze(['16:9', '9:16', '1:1']);
const NO_INPUTS = Object.freeze({ min: 0, max: 0 });
const IMAGE_LIMITS = Object.freeze({
	imageMinSide: 300,
	imageAspect: Object.freeze([0.4, 2.5]) as readonly [number, number],
	imageMaxBytes: IMAGE_MAX_BYTES
});

function declareModes(model: KlingModel): CatalogMode[] {
	const modes: CatalogMode[] = [{
		id: 'frames',
		label: LABELS.modes.frames,
		inputs: { startFrame: 'optional', endFrame: model.endFrame ? 'optional' : 'none', images: NO_INPUTS, videos: NO_INPUTS, audios: NO_INPUTS, source: 'none' },
		limits: IMAGE_LIMITS
	}];
	if (model.references) {
		modes.push({
			id: 'reference',
			label: LABELS.modes.reference,
			inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max: MAX_REFERENCE_IMAGES }, videos: NO_INPUTS, audios: NO_INPUTS, source: 'none' },
			limits: IMAGE_LIMITS
		});
	}
	return modes;
}

function declareParameters(model: KlingModel): CatalogParameter[] {
	const parameters: CatalogParameter[] = [
		{
			name: 'resolution',
			label: LABELS.resolution,
			kind: 'choice',
			options: model.resolutions.map(resolution => ({ value: resolution, label: LABELS.resolutions[resolution] })),
			default: '720p'
		},
		{
			name: 'ratio',
			label: LABELS.ratio,
			tooltip: LABELS.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: RATIOS.map(ratio => ({ value: ratio, label: ratio })),
			default: '16:9'
		},
		{ name: 'duration', label: LABELS.duration, kind: 'integer', unit: 'seconds', ...model.duration, default: 5 }
	];
	if (model.sound === 'setting') {
		parameters.push({ name: 'generate_audio', label: LABELS.sound, kind: 'boolean', default: false });
	}
	return parameters;
}

function declareModel(model: KlingModel): CatalogModel {
	return {
		id: model.id,
		label: LABELS.models[model.id].label,
		description: LABELS.models[model.id].description,
		providerModels: { cn: model.id, intl: model.id },
		prompt: { required: 'withoutMedia', maxLength: model.promptMaxLength },
		modes: declareModes(model),
		parameters: declareParameters(model),
		estimate: true
	};
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'kling',
	label: LABELS.provider,
	regions: [
		{ id: 'cn', label: LABELS.regions.cn, baseUrl: 'https://api-beijing.klingai.com', currency: 'CNY', console: 'https://klingai.com/dev/api-key' },
		{ id: 'intl', label: LABELS.regions.intl, baseUrl: 'https://api-singapore.klingai.com', currency: 'USD', console: 'https://kling.ai/dev/api-key' }
	],
	credentials: [{ id: 'apiKey', label: LABELS.apiKey }],
	models: MODELS.map(declareModel)
});

function modelOf(id: string): KlingModel {
	const model = MODELS.find(entry => entry.id === id);
	if (!model) {
		throw rejected(`Kling has no model "${id}".`);
	}
	return model;
}

function labelOf(model: KlingModel): string {
	return LABELS.models[model.id].label;
}

// --- errors -------------------------------------------------------------------------------------

/**
 * Kling's error codes (api/get-started/error-codes) with what the user can
 * do. A code without a contract code is read by its HTTP status: 1202 and
 * 1203 are a refused create or an unknown task, 5000 to 5002 an unknown
 * outcome or an error to ask again after.
 */
const ERROR_CODES: ReadonlyMap<number, { readonly code?: ProviderErrorCode; readonly text: string }> = new Map([
	[1000, { code: 'auth', text: 'Kling refused the API key. Check it in Video Providers.' }],
	[1001, { code: 'auth', text: 'Kling received no API key. Set it in Video Providers.' }],
	[1002, { code: 'auth', text: 'Kling refused the API key as invalid. Check it in Video Providers.' }],
	[1003, { code: 'auth', text: 'Kling does not accept the API key yet.' }],
	[1004, { code: 'auth', text: 'The Kling API key has expired. Make a new one in the Kling console.' }],
	[1100, { code: 'rejected', text: 'The Kling account is in an abnormal state. Check it in the Kling console.' }],
	[1101, { code: 'balance', text: 'The Kling account is in arrears. Add funds in the Kling console.' }],
	[1102, { code: 'balance', text: 'The Kling resource package is used up or has expired. Buy more in the Kling console.' }],
	[1103, { code: 'rejected', text: 'The Kling account may not use this model or API.' }],
	[1200, { code: 'rejected', text: 'Kling refused the request as invalid.' }],
	[1201, { code: 'rejected', text: 'Kling refused a setting or an input of the request.' }],
	[1202, { text: 'Kling does not take this request.' }],
	[1203, { text: 'Kling does not know what the request names, such as the model or the task.' }],
	[1300, { code: 'rejected', text: 'Kling\'s platform policy blocked the request.' }],
	[1301, { code: 'rejected', text: 'Kling\'s content safety refused the prompt or an image.' }],
	[1302, { code: 'rateLimited', text: 'Kling received too many requests from this account. Wait a moment.' }],
	[1303, { code: 'rateLimited', text: 'Kling is already running as many tasks at once as the resource package allows. Wait for one to finish.' }],
	[1304, { code: 'rejected', text: 'Kling\'s IP allow list for the account refused this computer.' }],
	[5000, { text: 'Kling had an internal error.' }],
	[5001, { text: 'Kling is unavailable for a while, usually for maintenance.' }],
	[5002, { text: 'Kling timed out, usually because of a backlog.' }]
]);

function codeOf(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isInteger(value)) {
		return value;
	}
	return typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : undefined;
}

function errorMessage(code: number, said: unknown): string {
	const words = typeof said === 'string' ? said.trim() : '';
	const known = ERROR_CODES.get(code);
	if (!known) {
		return words ? `Kling: ${words} (${code})` : `Kling answered with error ${code}.`;
	}
	return words ? `${known.text} (${code}: ${words})` : `${known.text} (${code})`;
}

/** The failure of a 2xx answer that carries an error code. */
function answeredFailure(code: number, said: unknown, creates: boolean): ProviderFailure {
	const message = errorMessage(code, said);
	const known = ERROR_CODES.get(code)?.code;
	if (known) {
		return new ProviderFailure(known, message);
	}
	if (code === 1202 || code === 1203) {
		return new ProviderFailure(creates ? 'rejected' : 'notFound', message);
	}
	// Kling's own errors and codes its documentation does not list: a task may exist.
	return creates ? unknownOutcome(message) : new ProviderFailure(code >= 5000 && code < 6000 ? 'network' : 'invalidResponse', message);
}

// --- requests -----------------------------------------------------------------------------------

/** An image as Kling takes it: its bytes as plain base64, without a `data:` prefix. */
interface SentImage {
	readonly slot: PlannedItem['slot'];
	readonly base64: string;
}

const CONTENT_TYPES: Readonly<Partial<Record<PlannedItem['slot'], string>>> = Object.freeze({
	startFrame: 'first_frame',
	endFrame: 'last_frame',
	image: 'refer_image'
});

/** Kling lists the JSON content type for every request, a query too. */
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });

function contentType(slot: PlannedItem['slot']): string {
	const type = CONTENT_TYPES[slot];
	if (!type) {
		throw rejected('Kling takes images only, no videos or audio.');
	}
	return type;
}

/**
 * An address under the endpoint, sent as the call's `url`. Kling's base URLs
 * are origins without a path, and such a URL keeps `/` as its path, which
 * joined with a call's `path` would ask for `//tasks`. The address is on the
 * endpoint's origin, so it gets the credential headers as a `path` would.
 */
function apiUrl(http: ProviderHttp, path: string): string {
	return `${http.endpoint.origin}${http.endpoint.pathname.replace(/\/+$/, '')}${path}`;
}

/** The path and the JSON of the request that creates the task (kling.md, "Requests"). */
function createRequest(model: KlingModel, region: string, params: Params, prompt: string, images: readonly SentImage[]): { readonly path: string; readonly value: unknown } {
	const sentModel = PROVIDER.models.find(entry => entry.id === model.id)?.providerModels[region];
	if (!sentModel) {
		throw rejected(`Kling does not offer ${labelOf(model)} in this region.`);
	}
	const id = encodeURIComponent(sentModel);
	const startFrame = images.some(image => image.slot === 'startFrame');
	const settings: Record<string, ParamValue> = { resolution: params.resolution, duration: params.duration };
	if (!startFrame) {
		// With a start frame, the video takes the frame's shape.
		settings.aspect_ratio = params.ratio;
	}
	if (model.sound === 'setting') {
		settings.audio = params.generate_audio === true ? 'native' : 'off';
	}
	if (model.api === 'split' && !startFrame) {
		return { path: `/text-to-video/${id}`, value: { prompt, settings } };
	}
	const contents = [
		...(prompt.trim() ? [{ type: 'prompt', text: prompt }] : []),
		...images.map(image => ({ type: contentType(image.slot), url: image.base64 }))
	];
	return { path: `/${model.api === 'split' ? 'image-to-video' : 'omni-video'}/${id}`, value: { contents, settings } };
}

function createdTaskId(answer: HttpAnswer): string {
	const body = answer.object();
	const code = codeOf(body.code);
	if (code !== undefined && code !== 0) {
		throw answeredFailure(code, body.message, true);
	}
	const id = isRecord(body.data) ? body.data.id : undefined;
	if (typeof id !== 'string' || !id.trim()) {
		throw unknownOutcome('Kling accepted the request but gave no task id AI Video can read.');
	}
	return id;
}

/** The task as `GET /tasks` gives it. */
async function askAbout(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	const answer = await http.request({ method: 'GET', url: apiUrl(http, '/tasks'), query: { task_ids: ref.remoteId }, headers: JSON_HEADERS });
	const body = answer.object();
	const code = codeOf(body.code);
	if (code !== undefined && code !== 0) {
		throw answeredFailure(code, body.message, false);
	}
	if (!Array.isArray(body.data)) {
		throw unreadable('Kling answered about the task in a form AI Video cannot read.');
	}
	const tasks = body.data.filter(isRecord);
	const task = tasks.find(entry => entry.id === ref.remoteId) ?? (body.data.length === 1 ? tasks[0] : undefined);
	if (!task) {
		throw new ProviderFailure('notFound', `Kling does not know the task ${ref.remoteId}.`);
	}
	return task;
}

/** The address of the first video among a task's outputs; not its watermarked one. */
function videoUrlOf(task: Record<string, unknown>): string | undefined {
	for (const output of Array.isArray(task.outputs) ? task.outputs : []) {
		if (isRecord(output) && output.type === 'video' && typeof output.url === 'string' && output.url.trim()) {
			return output.url.trim();
		}
	}
	return undefined;
}

// --- checks and estimates -----------------------------------------------------------------------

/** The rules between parameters and inputs that the declarations cannot express (kling.md, "Rules between parameters"). */
function ruleProblems(model: KlingModel, request: CheckRequest, counts: PlannedCounts): string[] {
	const problems: string[] = [];
	const label = labelOf(model);
	const { resolution, duration } = request.params;
	const sound = request.params.generate_audio === true;
	const length = [...request.prompt].length;
	if (model.promptMaxLengthWithFrame !== undefined && counts.startFrame && length > model.promptMaxLengthWithFrame) {
		problems.push(`The prompt is ${length} characters long; with a start frame, ${label} takes at most ${model.promptMaxLengthWithFrame}.`);
	}
	if (model.framesDurations && request.mode === 'frames' && !model.framesDurations.includes(Number(duration))) {
		problems.push(`${label} makes videos of ${model.framesDurations.join(' or ')} seconds in Frames mode.`);
	}
	if (model.soundOnlyAt1080p && sound && resolution !== '1080p') {
		problems.push(`${label} makes sound only at 1080p.`);
	}
	if (model.endFrameOnlyAt1080p && counts.endFrame && resolution !== '1080p') {
		problems.push(`${label} makes a video from start and end frames only at 1080p.`);
	}
	if (model.endFrameOnlySilent && counts.endFrame && sound) {
		problems.push(`${label} makes a video from start and end frames only without sound.`);
	}
	return problems;
}

/** Image formats Kling refuses, and a request too large for AI Video to send. */
async function fileProblems(model: KlingModel, request: CheckRequest, inputs: PlannedMedia, media: MediaInspector): Promise<string[]> {
	const problems: string[] = [];
	const images: SentImage[] = [];
	let imageBytes = 0;
	for (const item of plannedItems(inputs)) {
		if (CONTENT_TYPES[item.slot] === undefined) {
			continue;
		}
		const facts = await media.inspect(item.media);
		if (facts.format === 'webp' || facts.format === 'gif') {
			problems.push(`${item.label} is a ${facts.format === 'webp' ? 'WebP' : 'GIF'} image; Kling takes JPEG and PNG images only.`);
		}
		images.push({ slot: item.slot, base64: '' });
		imageBytes += base64Length(facts.bytes);
	}
	// The JSON of the request with empty images, then the images as base64.
	const { value } = createRequest(model, request.region, request.params, request.prompt, images);
	const size = Buffer.byteLength(JSON.stringify(value), 'utf8') + imageBytes;
	const limit = DEFAULT_HTTP_OPTIONS.maxRequestBytes;
	if (size > limit) {
		problems.push(`The images make a request of ${describeBytes(size)}; AI Video sends at most ${describeBytes(limit)}. Use fewer or smaller images.`);
	}
	return problems;
}

/** Units per second × seconds × the region's unit price (kling.md, "Estimate"); none for a combination without a price. */
function estimateFor(model: KlingModel, region: string, params: Params): Estimate | undefined {
	const price = UNIT_PRICES[region];
	const resolution = model.resolutions.find(entry => entry === params.resolution);
	const rates = resolution !== undefined ? model.units[resolution] : undefined;
	const withSound = model.sound === 'always' || (model.sound === 'setting' && params.generate_audio === true);
	const perSecond = withSound ? rates?.sound : rates?.silent;
	if (!price || perSecond === undefined || typeof params.duration !== 'number') {
		return undefined;
	}
	const amount = perSecond * params.duration * price.perUnit;
	return estimateOf(price.currency, amount, amount, PRICE_DATE);
}

// --- the module ---------------------------------------------------------------------------------

export const klingModule: ProviderModule = {
	describe() {
		return PROVIDER;
	},

	headers(credentials) {
		return { Authorization: `Bearer ${credentials.apiKey}` };
	},

	readError(_status, body): ProviderErrorReading | undefined {
		if (!isRecord(body)) {
			return undefined;
		}
		const code = codeOf(body.code);
		if (code === undefined || code === 0) {
			return readCommonError(body);
		}
		const known = ERROR_CODES.get(code)?.code;
		return { message: errorMessage(code, body.message), ...(known ? { code: known } : {}) };
	},

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const model = modelOf(request.model);
		const problems = ruleProblems(model, request, countsOf(request.inputs));
		if (isPlannedMedia(request.inputs)) {
			problems.push(...await fileProblems(model, request, request.inputs, media));
		}
		const estimate = estimateFor(model, request.region, request.params);
		return estimate ? { problems, estimate } : { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const model = modelOf(request.model);
		const items = plannedItems(request.inputs);
		// A video or audio input is refused before any file is read.
		items.forEach(item => contentType(item.slot));
		const images: SentImage[] = [];
		for (const item of items) {
			images.push({ slot: item.slot, base64: base64Of(await readMedia(item.media, IMAGE_MAX_BYTES, item.label)) });
		}
		const { path, value } = createRequest(model, request.region, request.params, request.prompt, images);
		const answer = await http.create({ method: 'POST', url: apiUrl(http, path), body: { kind: 'json', value } });
		return createdTaskId(answer);
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		const task = await askAbout(ref, http);
		switch (task.status) {
			case 'submitted':
				return { state: 'pending' };
			case 'processing':
				return { state: 'running' };
			case 'succeeded': {
				const videoUrl = videoUrlOf(task);
				if (!videoUrl) {
					throw unreadable('Kling reports that the task succeeded but gives no address of its video.');
				}
				return { state: 'succeeded', videoUrl };
			}
			case 'failed':
				return { state: 'failed', message: typeof task.message === 'string' ? task.message : '' };
			default:
				throw unreadable(`Kling reports a task state AI Video does not know: ${String(task.status).slice(0, 40)}.`);
		}
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const task = await askAbout(ref, http);
		const url = task.status === 'succeeded' ? videoUrlOf(task) : undefined;
		if (!url) {
			throw unreadable('Kling gives no address of a video for this task.');
		}
		return { url };
	},

	async cancel(): Promise<boolean> {
		// Kling has no cancellation; nothing is sent.
		return false;
	}
};
