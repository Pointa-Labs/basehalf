/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, isPlannedMedia, measureItems } from './check.ts';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import type { HttpAnswer, ProviderHttp } from './http.ts';
import { base64Length, base64Of, bufferSource, measure, plannedItems, readMedia, type MediaFormat, type MediaInspector } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, CheckResult, Estimate, ModeId, Params, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * Google's video model on the Gemini API, Gemini Omni Flash, run through the
 * Interactions API in the background (video providers, "Google (Gemini
 * API)"): the create answers at once with the interaction's id, a poll reads
 * the stored interaction, and the finished video comes inside it as base64.
 * Inputs travel inline as base64 too.
 */

const MODEL_ID = 'gemini-omni-1.1-flash';

type Resolution = '360p' | '720p' | '1080p' | '4k';

// --- the provider's English texts, in one place so they can be translated -----------------------

const RESOLUTION_LABELS: Readonly<Record<Resolution, string>> = Object.freeze({ '360p': '360p', '720p': '720p', '1080p': '1080p', '4k': '4K' });

const TEXT = Object.freeze({
	provider: 'Google',
	region: 'Gemini API',
	apiKey: 'API Key',
	model: 'Gemini Omni 1.1 Flash',
	description: 'Video with sound, 3 to 10 seconds long, from a prompt, a start and an end frame, or reference images and videos; it also edits and extends clips of up to 10 seconds.',
	modes: { frames: 'Frames', reference: 'References', edit: 'Edit', extend: 'Extend' },
	parameters: {
		resolution: 'Resolution',
		resolutionTooltip: '1080p and 4K are upscaled from the generated video. Google publishes the price of 720p only, so the other resolutions show no estimate.',
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the video: landscape or portrait.',
		seed: 'Seed',
		seedTooltip: 'The same seed with the same request gives a similar video. Leave it empty for a new one each time.'
	},
	resolutions: RESOLUTION_LABELS,
	referencesNeedInput: 'Gemini Omni 1.1 Flash in References mode needs at least one reference image or video.',
	requestTooLarge: (megabytes: string) => `The request with its inputs would be about ${megabytes} MB; the Gemini API takes at most 100 MB in one request. Use fewer or smaller inputs.`,
	imageFormat: (label: string) => `${label} is not a PNG, JPEG, WebP, or GIF image.`,
	videoFormat: (label: string) => `${label} is not an MP4 or MOV video.`,
	noAudio: (label: string) => `${label} cannot be sent: Gemini Omni 1.1 Flash takes no audio references.`,
	noTaskId: 'Google accepted the request but gave no interaction id AI Video can read.',
	failed: 'Google reports that the generation failed.',
	cancelled: 'The generation was cancelled.',
	incomplete: 'Google ended the generation without a complete video.',
	requiresAction: 'Google waits for an action on the generation that AI Video cannot take.',
	budgetExceeded: 'Google ended the generation when its budget ran out.',
	noVideo: 'Google finished the generation without a video.',
	noVideoSaying: (text: string) => `Google finished the generation without a video: ${text}`,
	notReady: 'The generation has no video yet.',
	unreadableAddress: 'Google gave a video address AI Video cannot read.',
	unknownStatus: (status: string) => `Google reports a generation status AI Video does not know: ${status || 'none'}.`
});

// --- the model ---------------------------------------------------------------------------------

/** Inline data may be at most 100 MB per request (File input methods); the whole request is held to it. */
const REQUEST_MAX_BYTES = 100_000_000;
/** The JSON around the inputs, and around each input part, counted generously. */
const REQUEST_OVERHEAD_BYTES = 2048;
const PART_OVERHEAD_BYTES = 128;
/** A poll's answer carries the finished video as base64 and may carry the inputs again. */
const INTERACTION_MAX_BYTES = 384 * 1024 * 1024;
/** The context window, in tokens; the prompt is bounded at as many characters. */
const PROMPT_MAX_LENGTH = 1_048_576;
/** Reference videos: "a maximum of 3 clips, up to 3 seconds each". */
const REFERENCE_VIDEO_SECONDS: readonly [number, number] = [0.1, 3];
/** Input videos for editing and extending are at most 10 seconds. */
const CLIP_SECONDS: readonly [number, number] = [0.1, 10];
/** Google states no maximum; its guide shows six reference images in one request. */
const REFERENCE_IMAGES_MAX = 6;

const NO_SLOT = Object.freeze({ min: 0, max: 0 });

const MODES: readonly CatalogMode[] = [
	{
		id: 'frames',
		label: TEXT.modes.frames,
		inputs: { startFrame: 'optional', endFrame: 'optional', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
		limits: {}
	},
	{
		id: 'reference',
		label: TEXT.modes.reference,
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: REFERENCE_IMAGES_MAX }, videos: { min: 0, max: 3 }, audios: NO_SLOT, source: 'none' },
		limits: { videoSeconds: REFERENCE_VIDEO_SECONDS }
	},
	{
		id: 'edit',
		label: TEXT.modes.edit,
		inputs: { startFrame: 'none', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'required' },
		limits: { videoSeconds: CLIP_SECONDS }
	},
	{
		id: 'extend',
		label: TEXT.modes.extend,
		inputs: { startFrame: 'none', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'required' },
		limits: { videoSeconds: CLIP_SECONDS }
	}
];

const RESOLUTIONS: readonly Resolution[] = ['360p', '720p', '1080p', '4k'];

const PARAMETERS: readonly CatalogParameter[] = [
	{
		name: 'resolution',
		label: TEXT.parameters.resolution,
		tooltip: TEXT.parameters.resolutionTooltip,
		kind: 'choice',
		options: RESOLUTIONS.map(value => ({ value, label: TEXT.resolutions[value] })),
		default: '720p'
	},
	{
		name: 'ratio',
		label: TEXT.parameters.ratio,
		tooltip: TEXT.parameters.ratioTooltip,
		kind: 'choice',
		display: 'ratio',
		options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
		default: '16:9',
		modes: ['frames', 'reference']
	},
	{
		name: 'seed',
		label: TEXT.parameters.seed,
		tooltip: TEXT.parameters.seedTooltip,
		kind: 'integer',
		min: 0,
		max: 2147483647,
		step: 1,
		optional: true,
		advanced: true
	}
];

const OMNI: CatalogModel = {
	id: MODEL_ID,
	label: TEXT.model,
	description: TEXT.description,
	providerModels: { global: MODEL_ID },
	prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
	modes: MODES,
	parameters: PARAMETERS,
	estimate: true
};

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'google',
	label: TEXT.provider,
	regions: [
		{ id: 'global', label: TEXT.region, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', currency: 'USD', console: 'https://aistudio.google.com/api-keys' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: [OMNI]
});

// --- estimate ----------------------------------------------------------------------------------

/** The date of the price list the rate below was read from (Gemini Developer API pricing). */
export const OMNI_PRICE_DATE = '2026-10-16';
/** "5,792 tokens per second of 720p video", the only resolution the price list gives a rate for. */
const TOKENS_PER_SECOND_720P = 5792;
/** Video output, per million tokens, paid tier, Standard. */
const USD_PER_MILLION_VIDEO_TOKENS = 17.5;
/** The length of a video the prompt decides: 3 to 10 seconds. */
const OUTPUT_SECONDS: readonly [number, number] = [3, 10];

/** The list price of `seconds` of 720p video in US dollars. */
export function omniPrice(seconds: number): number {
	return seconds * TOKENS_PER_SECOND_720P * USD_PER_MILLION_VIDEO_TOKENS / 1_000_000;
}

/**
 * The price of a generation: the seconds of video it answers at the 720p
 * rate, a range since the prompt decides the length. An extended video holds
 * the clip and 3 to 10 seconds more; without the clip's length, a clip of at
 * most 10 seconds. No estimate at the resolutions the price list gives no
 * rate for.
 */
export function omniEstimate(mode: ModeId, params: Params, clipSeconds?: number): Estimate | undefined {
	if (params.resolution !== '720p') {
		return undefined;
	}
	const [shortest, longest] = mode === 'extend'
		? [(clipSeconds ?? 0) + OUTPUT_SECONDS[0], (clipSeconds ?? CLIP_SECONDS[1]) + OUTPUT_SECONDS[1]]
		: OUTPUT_SECONDS;
	return estimateOf('USD', omniPrice(shortest), omniPrice(longest), OMNI_PRICE_DATE);
}

// --- check -------------------------------------------------------------------------------------

async function check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
	const counts = countsOf(request.inputs);
	const problems: string[] = [];
	if (request.mode === 'reference' && counts.images === 0 && counts.videos === 0) {
		problems.push(TEXT.referencesNeedInput);
	}
	let clipSeconds: number | undefined;
	if (isPlannedMedia(request.inputs)) {
		let size = REQUEST_OVERHEAD_BYTES + Buffer.byteLength(JSON.stringify(request.prompt), 'utf8');
		for (const item of await measureItems(request.inputs, media)) {
			size += base64Length(item.facts.bytes) + PART_OVERHEAD_BYTES;
			if (item.slot === 'source') {
				clipSeconds = item.facts.seconds;
			}
		}
		if (size > REQUEST_MAX_BYTES) {
			problems.push(TEXT.requestTooLarge((size / 1_000_000).toFixed(1)));
		}
	}
	const estimate = omniEstimate(request.mode, request.params, clipSeconds);
	return estimate ? { problems, estimate } : { problems };
}

// --- requests ----------------------------------------------------------------------------------

const INTERACTIONS = '/interactions';

function interactionPath(remoteId: string): string {
	return `${INTERACTIONS}/${encodeURIComponent(remoteId)}`;
}

/** The MIME types the Interactions API names for each format AI Video reads. */
const IMAGE_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' });
const VIDEO_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ mp4: 'video/mp4', mov: 'video/mov' });

/** What the mode asks the model to do with its inputs (`generation_config.video_config.task`). */
function taskOf(mode: ModeId, startFrame: boolean): string {
	switch (mode) {
		case 'frames':
			return startFrame ? 'image_to_video' : 'text_to_video';
		case 'reference':
			return 'reference_to_video';
		case 'edit':
			return 'edit';
		case 'extend':
			return 'extend';
	}
}

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	const providerModel = OMNI.providerModels[request.region];
	if (request.model !== OMNI.id || !providerModel) {
		throw rejected(`Google does not offer "${request.model}" in this region.`);
	}
	// The media in the plan's order, then the prompt, as the guide's requests list them.
	const input: unknown[] = [];
	for (const item of plannedItems(request.inputs)) {
		if (item.slot === 'audio') {
			// No mode declares audio; the guide calls audio references unsupported.
			throw rejected(TEXT.noAudio(item.label));
		}
		const read = await readMedia(item.media, REQUEST_MAX_BYTES, item.label);
		const { format } = await measure(bufferSource(read.bytes));
		const video = item.slot === 'video' || item.slot === 'source';
		const type = format ? (video ? VIDEO_TYPES : IMAGE_TYPES)[format] : undefined;
		if (!type) {
			throw rejected(video ? TEXT.videoFormat(item.label) : TEXT.imageFormat(item.label));
		}
		input.push({ type: video ? 'video' : 'image', mime_type: type, data: base64Of(read) });
	}
	input.push({ type: 'text', text: request.prompt });
	// The parameters arrive checked and completed; an unset seed is not sent.
	const { resolution, ratio: aspectRatio, seed } = request.params;
	const body = Buffer.from(JSON.stringify({
		model: providerModel,
		input,
		generation_config: {
			video_config: { task: taskOf(request.mode, request.inputs.startFrame !== undefined) },
			...(seed !== undefined ? { seed } : {})
		},
		response_format: { type: 'video', resolution, ...(aspectRatio !== undefined ? { aspect_ratio: aspectRatio } : {}) },
		background: true
	}), 'utf8');
	if (body.byteLength > REQUEST_MAX_BYTES) {
		throw rejected(TEXT.requestTooLarge((body.byteLength / 1_000_000).toFixed(1)));
	}
	// Read as large as a poll: should Google run the interaction at once despite
	// `background`, its answer is the finished interaction, video included, and
	// its id is followed like any other.
	const answer = await http.create({ method: 'POST', path: INTERACTIONS, body: { kind: 'bytes', bytes: body, contentType: 'application/json' }, maxAnswerBytes: INTERACTION_MAX_BYTES });
	const id = answer.object().id;
	if (typeof id !== 'string' || !id.trim()) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return id;
}

// --- the interaction ---------------------------------------------------------------------------

/** What AI Video reads of an interaction. */
interface Reading {
	readonly status: string;
	/** The output's video: its base64, or the address Google gave instead. */
	readonly video?: { readonly data?: string; readonly uri?: string };
	/** The model's text output, when it wrote one. */
	readonly text?: string;
	/** The interaction's errors, or its output step's error. */
	readonly error?: string;
}

function words(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readInteraction(interaction: Record<string, unknown>): Reading {
	const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
	let video: Reading['video'];
	const texts: string[] = [];
	const errors: string[] = [];
	for (const entry of Array.isArray(interaction.errors) ? interaction.errors : []) {
		const message = isRecord(entry) ? words(entry.message) ?? words(entry.code) : undefined;
		if (message) {
			errors.push(message);
		}
	}
	for (const step of steps) {
		if (!isRecord(step) || step.type !== 'model_output') {
			continue;
		}
		const stepError = isRecord(step.error) ? words(step.error.message) : undefined;
		if (!errors.length && stepError) {
			errors.push(stepError);
		}
		for (const part of Array.isArray(step.content) ? step.content : []) {
			if (!isRecord(part)) {
				continue;
			}
			if (part.type === 'video') {
				// The base64 of a whole video: checked for presence, never copied.
				if (typeof part.data === 'string' && part.data.length > 0) {
					video = { data: part.data };
				} else if (words(part.uri)) {
					video = { uri: words(part.uri) };
				}
			} else if (part.type === 'text') {
				const said = words(part.text);
				if (said) {
					texts.push(said);
				}
			}
		}
	}
	return {
		status: typeof interaction.status === 'string' ? interaction.status : '',
		...(video ? { video } : {}),
		...(texts.length ? { text: texts.join(' ') } : {}),
		...(errors.length ? { error: [...new Set(errors)].join(' ') } : {})
	};
}

/**
 * The address of a video Google answered as `uri`: an absolute address as it
 * is, and a file's resource name as the Files API download under the endpoint.
 */
function videoAddress(uri: string, endpoint: URL): string {
	if (/^https?:\/\//i.test(uri)) {
		return uri;
	}
	const name = /^files\/(?<id>[A-Za-z0-9_-]{1,128})$/.exec(uri)?.groups?.id;
	if (!name) {
		throw unreadable(TEXT.unreadableAddress);
	}
	return `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, '')}/files/${name}:download?alt=media`;
}

function stateOf(reading: Reading, endpoint: URL): PollState {
	switch (reading.status) {
		case 'queued':
			return { state: 'pending' };
		case 'in_progress':
			return { state: 'running' };
		case 'completed':
			if (reading.video?.data) {
				return { state: 'succeeded' };
			}
			if (reading.video?.uri) {
				return { state: 'succeeded', videoUrl: videoAddress(reading.video.uri, endpoint) };
			}
			return { state: 'failed', message: reading.text || reading.error ? TEXT.noVideoSaying((reading.text ?? reading.error)!) : TEXT.noVideo };
		case 'failed':
			return { state: 'failed', message: reading.error ?? TEXT.failed };
		case 'cancelled':
			return { state: 'cancelled', message: reading.error ?? TEXT.cancelled };
		case 'incomplete':
			return { state: 'failed', message: reading.error ? `${TEXT.incomplete} ${reading.error}` : TEXT.incomplete };
		case 'requires_action':
			return { state: 'failed', message: TEXT.requiresAction };
		case 'budget_exceeded':
			return { state: 'failed', message: reading.error ? `${TEXT.budgetExceeded} ${reading.error}` : TEXT.budgetExceeded };
		default:
			throw unreadable(TEXT.unknownStatus(reading.status));
	}
}

async function getInteraction(ref: TaskRef, http: ProviderHttp): Promise<Reading> {
	const answer = await http.request({ method: 'GET', path: interactionPath(ref.remoteId), maxAnswerBytes: INTERACTION_MAX_BYTES });
	return readInteraction(answer.object());
}

async function poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
	return stateOf(await getInteraction(ref, http), http.endpoint);
}

async function videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
	const reading = await getInteraction(ref, http);
	const state = stateOf(reading, http.endpoint);
	if (state.state !== 'succeeded') {
		throw unreadable(state.state === 'failed' || state.state === 'cancelled' ? state.message : TEXT.notReady);
	}
	return reading.video?.data ? { bytes: Buffer.from(reading.video.data, 'base64') } : { url: state.videoUrl! };
}

/** Statuses after which a cancellation comes too late. */
const ENDED: ReadonlySet<string> = new Set(['completed', 'failed', 'incomplete', 'budget_exceeded']);

async function cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean> {
	let answer: HttpAnswer;
	try {
		answer = await http.requestOnce({ method: 'POST', path: `${interactionPath(ref.remoteId)}/cancel`, maxAnswerBytes: INTERACTION_MAX_BYTES });
	} catch (error) {
		if (error instanceof ProviderFailure && (error.code === 'rejected' || error.code === 'notFound')) {
			// The interaction no longer runs, or Google does not know it.
			return false;
		}
		throw error;
	}
	let status = '';
	try {
		const value = answer.object().status;
		status = typeof value === 'string' ? value : '';
	} catch {
		// Taken without an answer AI Video can read; Google updates the status after its clean-up.
	}
	return !ENDED.has(status);
}

// --- errors ------------------------------------------------------------------------------------

/**
 * Google's words of an error answer: `{"error": {"code", "message"}}` with a
 * `snake_case` code, or the older shape with a numeric code and a `status`.
 * Every code the API errors page lists agrees with its HTTP status (402
 * `payment_required`, 429 `rate_limit_exceeded`, …), so the status decides.
 */
function readError(_status: number, body: unknown): ProviderErrorReading | undefined {
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	const message = error ? words(error.message) ?? words(error.code) ?? words(error.status) : undefined;
	return message ? { message } : readCommonError(body);
}

export const GOOGLE: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ 'x-goog-api-key': credentials.apiKey }),
	readError,
	check,
	submit,
	poll,
	videoLocation,
	cancel
});
