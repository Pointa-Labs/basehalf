/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, estimateOf, measureItems, type MeasuredItem, type PlannedCounts } from './check.ts';
import { isRecord, ProviderFailure, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type HttpAnswer, type ProviderHttp } from './http.ts';
import { base64Length, base64Of, bufferSource, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector } from './media.ts';
import type { ProviderModule, VideoLocation } from './module.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, CheckResult, Estimate, Media, ModeLimits, Params, PlannedMedia, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * Luma's video model, Ray 3.2, on the Luma Agents API (D59;
 * `docs/specs/video-providers/luma.md`, which records the pages each fact
 * comes from). One API key as a bearer token; images inline as base64; the
 * clip of an edit through Luma's Files API, which must have checked the file
 * before a generation may use it; generations asked about at
 * `GET /generations/{id}`; no cancellation.
 */

type Resolution = '360p' | '540p' | '720p' | '1080p';
type Strength = 'auto' | 'adhere_1' | 'adhere_2' | 'adhere_3' | 'flex_1' | 'flex_2' | 'flex_3' | 'reimagine_1' | 'reimagine_2' | 'reimagine_3';
type FailureCode = 'content_moderated' | 'generation_failed' | 'budget_exhausted' | 'output_not_found' | 'image_too_large' | 'unsupported_format' | 'corrupt_input' | 'invalid_request' | 'rate_limited';

// --- labels and messages ------------------------------------------------------------------------

/** Every label of the catalog entry and every message, in one table so that they can be translated later. */
const TEXT = Object.freeze({
	provider: 'Luma',
	region: 'Luma Agents API',
	apiKey: 'API Key',
	model: 'Ray 3.2',
	description: 'Text, or a start and an end frame, to video of 5 or 10 seconds from 360p to 1080p, looping or in HDR when asked; it also edits clips of up to 18 seconds.',
	modes: Object.freeze({ frames: 'Frames', edit: 'Edit' }),
	resolution: 'Resolution',
	resolutionTooltip: '360p is Luma\'s draft tier, for fast, low-cost previews.',
	ratio: 'Ratio',
	adaptive: 'Adaptive',
	ratioTooltip: 'The shape of the video. Adaptive lets Ray 3.2 choose it from the prompt and the frames.',
	duration: 'Duration',
	loop: 'Loop',
	loopTooltip: 'A video whose end joins its start, to play in a loop: 5 seconds long, without HDR or an end frame.',
	strength: 'Strength',
	strengthTooltip: 'How much the edit keeps of the clip. Adhere keeps its motion, composition, and structure; Flex keeps its motion and lets the prompt change its style and content; Reimagine lets the prompt drive most of it. Auto lets Ray 3.2 decide from the clip.',
	strengths: Object.freeze<Record<Strength, string>>({
		auto: 'Auto',
		adhere_1: 'Adhere 1',
		adhere_2: 'Adhere 2',
		adhere_3: 'Adhere 3',
		flex_1: 'Flex 1',
		flex_2: 'Flex 2',
		flex_3: 'Flex 3',
		reimagine_1: 'Reimagine 1',
		reimagine_2: 'Reimagine 2',
		reimagine_3: 'Reimagine 3'
	}),
	hdr: 'HDR',
	hdrTooltip: 'An HDR-encoded MP4 at 720p or 1080p, at twice the price. In Frames mode an HDR video is 5 seconds long and does not loop.',
	// The rules between parameters.
	hdrResolution: 'Ray 3.2 makes HDR video at 720p or 1080p only.',
	hdrDuration: 'Ray 3.2 makes HDR video of 5 seconds only.',
	loopDuration: 'Ray 3.2 makes a looping video of 5 seconds only.',
	loopHdr: 'Ray 3.2 does not make a looping video in HDR.',
	loopEndFrame: 'A looping video takes no end frame: remove the end frame, or turn Loop off.',
	framesTooLarge: (size: number, limit: number) => `The frames make a request of ${describeBytes(size)}; AI Video sends at most ${describeBytes(limit)}. Use smaller images.`,
	clipTooLarge: (label: string, size: number, limit: number) => `${label} is ${describeBytes(size)}; AI Video uploads at most ${describeBytes(limit)} in one request. Use a smaller clip.`,
	// Inputs and uploads.
	notTaken: (label: string) => `Ray 3.2 does not take ${inSentence(label)} in this mode.`,
	noClip: 'Ray 3.2 in Edit mode needs a video to work on.',
	imageFormat: (label: string) => `${label} is not a PNG, JPEG, or WebP image.`,
	videoFormat: (label: string) => `${label} is not an MP4 or MOV video.`,
	uploadFailed: (label: string, detail: string) => `${label} could not be uploaded to Luma: ${detail.replace(/^Luma: /, '')}`,
	uploadUnreadable: 'Luma answered the upload in a form AI Video cannot read.',
	storageRefused: (label: string, status: number, code: string | undefined, message: string | undefined) =>
		`Luma's storage refused the upload of ${inSentence(label)} (HTTP ${status}${code ? `, ${code}` : ''})${message ? `: ${message}` : '.'}`,
	fileFailed: (label: string, reason: string) => `Luma refused ${inSentence(label)} when it checked it${reason ? `: ${reason}` : '.'}`,
	fileDeleted: (label: string) => `Luma removed ${inSentence(label)} before the generation could use it. Generate again.`,
	fileNotReady: (label: string) => `Luma has not finished checking ${inSentence(label)} after 2 minutes, and nothing was generated. Generate again in a moment.`,
	// Answers.
	noTaskId: 'Luma accepted the request but gave no generation id AI Video can read.',
	transient: (detail: string) => `Luma is unavailable for a moment and made no generation, so nothing is charged. Generate again in a moment.${detail ? ` (${detail})` : ''}`,
	unknownState: (state: string) => `Luma reports a generation state AI Video does not know: ${state || 'none'}.`,
	noVideo: 'Luma reports that the generation completed but gives no address of its video.',
	noVideoAddress: 'Luma gives no address of a video for this generation.',
	failed: 'Luma reports that the generation failed.',
	failures: Object.freeze<Record<FailureCode, string>>({
		content_moderated: 'Luma\'s content moderation refused the prompt, an input, or the video, and refunds the charge. Change the prompt or the inputs.',
		generation_failed: 'Luma\'s model failed to make the video, and Luma refunds the charge. Generating again usually works.',
		budget_exhausted: 'The Luma account ran out of funds during the generation; part of it may be charged. Add funds in the Luma API Platform.',
		output_not_found: 'Luma could not retrieve the video it made, and refunds the charge. Generating again usually works.',
		image_too_large: 'An input image is too large for Luma. Use a smaller image.',
		unsupported_format: 'An input is in a format Luma cannot process.',
		corrupt_input: 'Luma could not decode an input. Use another file.',
		invalid_request: 'Luma refused the request as invalid while it ran.',
		rate_limited: 'A service Luma relies on was too busy. Generate again in a moment.'
	}),
	// Errors by status.
	refusedKey: 'Luma refused the API key. Check it in Video Providers.',
	noBalance: 'The Luma account has too little balance. Add funds in the Luma API Platform.',
	refusedAccount: 'Luma refused this account. Contact Luma support.',
	tooManyJobs: 'Luma is already running as many generations at once as this account\'s plan allows. Wait for one to finish.',
	tooManyRequests: 'Luma received more requests from this account in the last minute than its plan allows. Wait a moment.',
	httpStatus: (status: number) => `Luma answered with HTTP ${status}.`
});

/** A planned input's label, such as "The source video clip.mp4", inside a sentence. */
function inSentence(label: string): string {
	return label.charAt(0).toLowerCase() + label.slice(1);
}

// --- the model ----------------------------------------------------------------------------------

/** The one id Luma takes for every task of Ray 3.2. */
const MODEL_ID = 'ray-3.2';
const REGION = 'global';

const MiB = 1024 * 1024;
/** 50 MB as Luma counts it (52,428,800 bytes), and 8,000 px a side, for every image. */
const IMAGE_MAX_BYTES = 50 * MiB;
const IMAGE_MAX_SIDE = 8000;
/** The clip of an edit: at most 18 seconds (Luma states no shortest) and 200 MB as Luma counts it. */
const CLIP_SECONDS: readonly [number, number] = Object.freeze([0.1, 18]) as readonly [number, number];
const CLIP_MAX_BYTES = 200 * MiB;
/** The output's frame grid, where keyframes are placed. */
const FRAMES_PER_SECOND = 24;

const RESOLUTIONS: readonly Resolution[] = Object.freeze(['360p', '540p', '720p', '1080p']);
const HDR_RESOLUTIONS: ReadonlySet<string> = new Set<Resolution>(['720p', '1080p']);
const RATIOS: readonly string[] = Object.freeze(['9:16', '3:4', '1:1', '4:3', '16:9', '21:9']);
const ADAPTIVE = 'adaptive';
const STRENGTHS = Object.freeze(Object.keys(TEXT.strengths)) as readonly Strength[];

const NO_INPUTS = Object.freeze({ min: 0, max: 0 });
const IMAGE_LIMITS: ModeLimits = Object.freeze({ imageMaxSide: IMAGE_MAX_SIDE, imageMaxBytes: IMAGE_MAX_BYTES });

const MODES: readonly CatalogMode[] = Object.freeze([
	{
		id: 'frames',
		label: TEXT.modes.frames,
		inputs: { startFrame: 'optional', endFrame: 'optional', images: NO_INPUTS, videos: NO_INPUTS, audios: NO_INPUTS, source: 'none' },
		limits: IMAGE_LIMITS
	},
	{
		// The image is the edit's single guide frame: the look of its first frame.
		id: 'edit',
		label: TEXT.modes.edit,
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 1 }, videos: NO_INPUTS, audios: NO_INPUTS, source: 'required' },
		limits: { ...IMAGE_LIMITS, videoSeconds: CLIP_SECONDS, videoMaxBytes: CLIP_MAX_BYTES }
	}
]);

const PARAMETERS: readonly CatalogParameter[] = Object.freeze([
	{
		name: 'resolution',
		label: TEXT.resolution,
		tooltip: TEXT.resolutionTooltip,
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
		options: [{ value: ADAPTIVE, label: TEXT.adaptive }, ...RATIOS.map(ratio => ({ value: ratio, label: ratio }))],
		default: ADAPTIVE,
		modes: ['frames']
	},
	{ name: 'duration', label: TEXT.duration, kind: 'integer', unit: 'seconds', min: 5, max: 10, step: 5, default: 5, modes: ['frames'] },
	{ name: 'loop', label: TEXT.loop, tooltip: TEXT.loopTooltip, kind: 'boolean', default: false, modes: ['frames'] },
	{
		name: 'strength',
		label: TEXT.strength,
		tooltip: TEXT.strengthTooltip,
		kind: 'choice',
		options: STRENGTHS.map(strength => ({ value: strength, label: TEXT.strengths[strength] })),
		default: 'auto',
		modes: ['edit']
	},
	{ name: 'hdr', label: TEXT.hdr, tooltip: TEXT.hdrTooltip, kind: 'boolean', default: false, advanced: true }
]);

const MODEL: CatalogModel = Object.freeze<CatalogModel>({
	id: MODEL_ID,
	label: TEXT.model,
	description: TEXT.description,
	providerModels: { [REGION]: MODEL_ID },
	prompt: { required: 'always', maxLength: 6000 },
	modes: MODES,
	parameters: PARAMETERS,
	estimate: true
});

const PROVIDER: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'luma',
	label: TEXT.provider,
	regions: [{ id: REGION, label: TEXT.region, baseUrl: 'https://agents.lumalabs.ai/v1', currency: 'USD', console: 'https://platform.lumalabs.ai' }],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey, placeholder: 'luma-api-…' }],
	models: [MODEL]
});

// --- prices -------------------------------------------------------------------------------------

/** The day the price list was read; the list states no date of its own. */
const PRICE_DATE = '2026-10-19';

/** Frames, the video-generation tier: the total of a video in US dollars, for 5 and 10 seconds, and for 5 seconds in HDR. */
const GENERATION_PRICES: Readonly<Record<Resolution, { readonly seconds5: number; readonly seconds10: number; readonly hdr5?: number }>> = Object.freeze({
	'360p': { seconds5: 0.06, seconds10: 0.18 },
	'540p': { seconds5: 0.15, seconds10: 0.45 },
	'720p': { seconds5: 0.3, seconds10: 0.9, hdr5: 0.6 },
	'1080p': { seconds5: 1.2, seconds10: 3.6, hdr5: 2.4 }
});

/** Edit, the video-edit tier: the totals for 10 seconds, standard and HDR. Those for 5 seconds are half: one rate per second. */
const EDIT_PRICES_10S: Readonly<Record<Resolution, { readonly standard: number; readonly hdr: number }>> = Object.freeze({
	'360p': { standard: 1.08, hdr: 2.16 },
	'540p': { standard: 1.44, hdr: 2.88 },
	'720p': { standard: 2.16, hdr: 4.32 },
	'1080p': { standard: 4.32, hdr: 8.64 }
});

/** The seconds an edit may be billed, at least one 5-second block: Luma lists edit totals for 5 and 10 seconds only. */
function billedBlockSeconds(seconds: number): number {
	return Math.max(1, Math.ceil((seconds - 0.05) / 5)) * 5;
}

function estimateFor(request: CheckRequest, measured: readonly MeasuredItem[]): Estimate | undefined {
	const resolution = RESOLUTIONS.find(entry => entry === request.params.resolution);
	if (!resolution) {
		return undefined;
	}
	const hdr = request.params.hdr === true;
	if (request.mode === 'frames') {
		const row = GENERATION_PRICES[resolution];
		const duration = request.params.duration;
		const amount = hdr ? (duration === 5 ? row.hdr5 : undefined) : duration === 5 ? row.seconds5 : duration === 10 ? row.seconds10 : undefined;
		return amount === undefined ? undefined : estimateOf('USD', amount, amount, PRICE_DATE);
	}
	// The edited video keeps the clip's length; when its length cannot be read, the clip is any length Luma takes.
	const perSecond = (hdr ? EDIT_PRICES_10S[resolution].hdr : EDIT_PRICES_10S[resolution].standard) / 10;
	const clip = measured.find(item => item.slot === 'source')?.facts.seconds;
	const [shortest, longest] = clip !== undefined ? [clip, clip] : CLIP_SECONDS;
	return estimateOf('USD', shortest * perSecond, Math.max(longest, billedBlockSeconds(longest)) * perSecond, PRICE_DATE);
}

// --- checks ---------------------------------------------------------------------------------------

/** The rules between parameters and inputs that the declarations cannot express (luma.md, "Rules between parameters"). */
function ruleProblems(request: CheckRequest, counts: PlannedCounts): string[] {
	const problems: string[] = [];
	const hdr = request.params.hdr === true;
	if (hdr && !HDR_RESOLUTIONS.has(String(request.params.resolution))) {
		problems.push(TEXT.hdrResolution);
	}
	if (request.mode === 'frames') {
		const loop = request.params.loop === true;
		const tenSeconds = request.params.duration === 10;
		if (hdr && tenSeconds) {
			problems.push(TEXT.hdrDuration);
		}
		if (loop && tenSeconds) {
			problems.push(TEXT.loopDuration);
		}
		if (loop && hdr) {
			problems.push(TEXT.loopHdr);
		}
		if (loop && counts.endFrame) {
			problems.push(TEXT.loopEndFrame);
		}
	}
	return problems;
}

/** A request too large for AI Video to send: the frames inline, or the clip in its upload. */
function fileProblems(request: CheckRequest, inputs: PlannedMedia, measured: readonly MeasuredItem[]): string[] {
	const limit = DEFAULT_HTTP_OPTIONS.maxRequestBytes;
	if (request.mode === 'edit') {
		const clip = measured.find(item => item.slot === 'source');
		return clip && clip.facts.bytes > limit ? [TEXT.clipTooLarge(clip.label, clip.facts.bytes, limit)] : [];
	}
	// The JSON of the request with empty images, then the images as base64.
	const empty = { data: '', media_type: 'image/jpeg' };
	const frames = measured.filter(item => item.slot === 'startFrame' || item.slot === 'endFrame');
	const body = framesBody(request.params, request.prompt, inputs.startFrame ? empty : undefined, inputs.endFrame ? empty : undefined);
	const size = Buffer.byteLength(JSON.stringify(body), 'utf8') + frames.reduce((total, item) => total + base64Length(item.facts.bytes), 0);
	return size > limit ? [TEXT.framesTooLarge(size, limit)] : [];
}

// --- requests -----------------------------------------------------------------------------------

/** An image or a video as Luma takes it inline: its bytes as base64 with their type. */
interface InlineMedia {
	readonly data: string;
	readonly media_type: string;
}

/** The body of a Frames request (luma.md, "Frames"): frames as keyframes, or as the start frame of a looping video. */
function framesBody(params: Params, prompt: string, start: InlineMedia | undefined, end: InlineMedia | undefined): Record<string, unknown> {
	const loop = params.loop === true;
	const video: Record<string, unknown> = { resolution: params.resolution, duration: `${params.duration}s` };
	if (loop) {
		video.loop = true;
	}
	if (params.hdr === true) {
		video.hdr = true;
	}
	if (start && loop) {
		// Keyframes do not take Loop; a looping video takes no end frame, which a rule says.
		video.start_frame = start;
	} else if (start) {
		// The first and the last frame of the output's grid: 120 for 5 seconds, 240 for 10.
		video.keyframes = end ? [start, end] : [start];
		video.keyframe_indexes = end ? [0, FRAMES_PER_SECOND * Number(params.duration)] : [0];
	}
	return {
		model: MODEL_ID,
		type: 'video',
		prompt,
		...(params.ratio !== ADAPTIVE ? { aspect_ratio: params.ratio } : {}),
		video
	};
}

/** The body of an Edit request (luma.md, "Edit"), with the uploaded clip's file id. */
function editBody(params: Params, prompt: string, fileId: string, guide: InlineMedia | undefined): Record<string, unknown> {
	const strength = params.strength;
	const video: Record<string, unknown> = {
		resolution: params.resolution,
		edit: strength === 'auto' || strength === undefined ? { auto_controls: true } : { strength }
	};
	if (guide) {
		video.start_frame = guide;
	}
	if (params.hdr === true) {
		video.hdr = true;
	}
	return { model: MODEL_ID, type: 'video_edit', prompt, source: { file_id: fileId }, video };
}

/** An image read whole, with its type read from its bytes. */
async function inlineImage(media: Media, label: string): Promise<InlineMedia> {
	const read = await readMedia(media, IMAGE_MAX_BYTES, label);
	const { format } = await measure(bufferSource(read.bytes));
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(TEXT.imageFormat(label));
	}
	return { data: base64Of(read), media_type: MEDIA_MIME_TYPES[format] };
}

/** The statuses of Luma's storage that refuse an upload; others are asked again or read as errors. */
const STORAGE_REFUSALS: readonly number[] = Object.freeze([400, 401, 403, 404, 405, 409, 411, 412, 413]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
/** The headers of an upload that the request sets itself. */
const OWN_HEADERS: ReadonlySet<string> = new Set(['host', 'content-length', 'content-type', 'authorization', 'transfer-encoding', 'connection']);

/** The `<Code>` and `<Message>` of a storage error answer, which is XML. */
function storageError(body: Buffer): { readonly code?: string; readonly message?: string } {
	const text = body.toString('utf8');
	const code = /<Code>([^<]{1,100})<\/Code>/.exec(text)?.[1];
	const message = /<Message>([^<]{1,500})<\/Message>/.exec(text)?.[1];
	return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/** Runs a step of an upload: nothing was generated yet, so a lost file or an unreadable answer refuses the generation. */
async function uploadStep<T>(label: string, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof ProviderFailure && (error.code === 'notFound' || error.code === 'invalidResponse' || error.code === 'unknownOutcome')) {
			throw new ProviderFailure('rejected', TEXT.uploadFailed(label, error.message), error.status);
		}
		throw error;
	}
}

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** How long the file may wait for Luma's check, and how often it is asked about: 2 minutes. */
const FILE_READY_INTERVAL_MS = 2000;
const FILE_READY_CHECKS = 60;
/** Luma may delete an uploaded file a day after its upload; without a time, a file is never removed. */
const FILE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Uploads the clip of an edit through Luma's Files API (luma.md, "The upload")
 * and answers its file id once Luma has checked the file: the presigned
 * upload, the bytes to Luma's storage without the key, `complete`, then
 * asking until the file is ready.
 */
async function uploadClip(http: ProviderHttp, bytes: Buffer, mimeType: string, label: string): Promise<string> {
	const created = await uploadStep(label, async () => (await http.request({
		method: 'POST',
		path: '/files',
		body: {
			kind: 'json',
			value: { mime_type: mimeType, size_bytes: bytes.byteLength, purpose: 'input', expires_at: new Date(Date.now() + FILE_LIFETIME_MS).toISOString() }
		}
	})).object());
	const fileId = textOf(created.id) ?? (isRecord(created.file) ? textOf(created.file.id) : undefined);
	const upload = isRecord(created.upload) ? created.upload : undefined;
	const url = upload ? textOf(upload.url) : undefined;
	const method = upload ? textOf(upload.method)?.toUpperCase() ?? 'PUT' : undefined;
	if (!fileId || !url || method !== 'PUT') {
		throw rejected(TEXT.uploadFailed(label, TEXT.uploadUnreadable));
	}
	let contentType = mimeType;
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(upload && isRecord(upload.headers) ? upload.headers : {})) {
		if (typeof value !== 'string' || !HEADER_NAME.test(name) || /[\u0000-\u001F\u007F]/.test(value)) {
			continue;
		}
		if (name.toLowerCase() === 'content-type') {
			contentType = value;
		} else if (!OWN_HEADERS.has(name.toLowerCase())) {
			headers[name] = value;
		}
	}
	const stored = await uploadStep(label, () => http.request({ method: 'PUT', url, headers, body: { kind: 'bytes', bytes, contentType }, accept: STORAGE_REFUSALS }));
	if (stored.status < 200 || stored.status >= 300) {
		const error = storageError(stored.body);
		throw rejected(TEXT.storageRefused(label, stored.status, error.code, error.message), stored.status);
	}
	const path = `/files/${encodeURIComponent(fileId)}`;
	let file = await uploadStep(label, async () => (await http.request({ method: 'POST', path: `${path}/complete` })).object());
	for (let checks = 0; ; checks++) {
		switch (file.state) {
			case 'ready':
				return fileId;
			case 'failed':
				throw rejected(TEXT.fileFailed(label, textOf(file.failure_reason) ?? ''));
			case 'deleted':
				throw rejected(TEXT.fileDeleted(label));
			case 'pending':
				break;
			default:
				throw rejected(TEXT.uploadFailed(label, TEXT.uploadUnreadable));
		}
		if (checks >= FILE_READY_CHECKS) {
			throw rejected(TEXT.fileNotReady(label));
		}
		await http.wait(FILE_READY_INTERVAL_MS);
		file = await uploadStep(label, async () => (await http.request({ method: 'GET', path })).object());
	}
}

/** Sends the request that creates the generation, once, and answers its id. */
async function createGeneration(http: ProviderHttp, body: Record<string, unknown>): Promise<string> {
	// A 503 is read here: Luma's own code for it says whether a generation was made.
	const answer = await http.create({ method: 'POST', path: '/generations', body: { kind: 'json', value: body }, accept: [503] });
	if (answer.status === 503) {
		throw unavailable(answer);
	}
	const id = answer.object().id;
	if (typeof id !== 'string' || !id.trim()) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return id;
}

/** A 503 to a create: "no generation was created" for Luma's transient code; otherwise the outcome is unknown. */
function unavailable(answer: HttpAnswer): ProviderFailure {
	let body: unknown;
	try {
		body = answer.json();
	} catch {
		body = undefined;
	}
	const detail = detailOf(body);
	if (isRecord(body) && isRecord(body.error) && body.error.code === 'TRANSIENT.SERVICE.UNAVAILABLE') {
		return new ProviderFailure('rejected', TEXT.transient(detail), 503);
	}
	return new ProviderFailure('unknownOutcome', detail ? `Luma: ${sentence(detail)}` : TEXT.httpStatus(503), 503);
}

async function submitFrames(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	let start: InlineMedia | undefined;
	let end: InlineMedia | undefined;
	for (const item of plannedItems(request.inputs)) {
		if (item.slot === 'startFrame') {
			start = await inlineImage(item.media, item.label);
		} else if (item.slot === 'endFrame') {
			end = await inlineImage(item.media, item.label);
		} else {
			throw rejected(TEXT.notTaken(item.label));
		}
	}
	// `check` refuses both before a request is sent; nothing is sent without them either.
	if (end && !start) {
		throw rejected('An end frame needs a start frame.');
	}
	if (end && request.params.loop === true) {
		throw rejected(TEXT.loopEndFrame);
	}
	return createGeneration(http, framesBody(request.params, request.prompt, start, end));
}

async function submitEdit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	const items = plannedItems(request.inputs);
	// Every input is refused or read before anything is uploaded.
	for (const item of items) {
		if (item.slot !== 'source' && !(item.slot === 'image' && item.index === 0)) {
			throw rejected(TEXT.notTaken(item.label));
		}
	}
	const source = items.find(item => item.slot === 'source');
	if (!source) {
		throw rejected(TEXT.noClip);
	}
	const image = items.find(item => item.slot === 'image');
	const guide = image ? await inlineImage(image.media, image.label) : undefined;
	const clip = await readMedia(source.media, CLIP_MAX_BYTES, source.label);
	const { format } = await measure(bufferSource(clip.bytes));
	if (format !== 'mp4' && format !== 'mov') {
		throw rejected(TEXT.videoFormat(source.label));
	}
	const fileId = await uploadClip(http, clip.bytes, MEDIA_MIME_TYPES[format], source.label);
	return createGeneration(http, editBody(request.params, request.prompt, fileId, guide));
}

// --- answers --------------------------------------------------------------------------------------

/** The generation as `GET /generations/{id}` gives it. */
async function askAbout(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	return (await http.request({ method: 'GET', path: `/generations/${encodeURIComponent(ref.remoteId)}` })).object();
}

/** The address of the first video among a generation's outputs. */
function videoUrlOf(generation: Record<string, unknown>): string | undefined {
	for (const output of Array.isArray(generation.output) ? generation.output : []) {
		if (isRecord(output) && output.type === 'video' && textOf(output.url)) {
			return textOf(output.url);
		}
	}
	return undefined;
}

function failureMessage(code: unknown, reason: unknown): string {
	const words = textOf(reason) ?? '';
	const known = typeof code === 'string' && Object.hasOwn(TEXT.failures, code) ? TEXT.failures[code as FailureCode] : undefined;
	const tag = typeof code === 'string' && code.trim() ? code.trim().slice(0, 64) : undefined;
	if (known) {
		return words ? `${known} (${tag}: ${words})` : `${known} (${tag})`;
	}
	const said = words || TEXT.failed;
	return tag ? `${said} (${tag})` : said;
}

function pollStateOf(generation: Record<string, unknown>): PollState {
	switch (generation.state) {
		case 'queued':
			return { state: 'pending' };
		case 'processing':
			return { state: 'running' };
		case 'completed': {
			const videoUrl = videoUrlOf(generation);
			if (!videoUrl) {
				throw unreadable(TEXT.noVideo);
			}
			return { state: 'succeeded', videoUrl };
		}
		case 'failed':
			return { state: 'failed', message: failureMessage(generation.failure_code, generation.failure_reason) };
		default:
			throw unreadable(TEXT.unknownState(String(generation.state ?? '').slice(0, 40)));
	}
}

// --- errors -------------------------------------------------------------------------------------

/** A sentence that ends with a full stop. */
function sentence(text: string): string {
	return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/**
 * Luma's `detail`: a sentence, or, for a request whose fields do not fit the
 * schema, a list of each field's path and message.
 */
function detailOf(body: unknown): string {
	if (!isRecord(body)) {
		return '';
	}
	if (typeof body.detail === 'string') {
		return body.detail.trim();
	}
	if (Array.isArray(body.detail)) {
		return body.detail.slice(0, 5).map(entry => {
			if (!isRecord(entry)) {
				return '';
			}
			const path = Array.isArray(entry.loc) ? entry.loc.filter(part => typeof part === 'string' || typeof part === 'number').join('.') : '';
			const message = typeof entry.msg === 'string' ? entry.msg.trim() : '';
			return [path, message].filter(Boolean).join(': ');
		}).filter(Boolean).join('; ');
	}
	return isRecord(body.error) && typeof body.error.user_message === 'string' ? body.error.user_message.trim() : '';
}

/** Luma's error answer, `{detail}`, with what the user can do; the HTTP status gives the contract's code. */
function readLumaError(status: number, body: unknown): ProviderErrorReading | undefined {
	const detail = detailOf(body);
	const own = (text: string) => ({ message: detail ? `${text} (${detail})` : text });
	switch (status) {
		case 401:
			return own(TEXT.refusedKey);
		case 402:
			return own(TEXT.noBalance);
		case 403:
			return own(TEXT.refusedAccount);
		case 429:
			return own(/concurrent/i.test(detail) ? TEXT.tooManyJobs : TEXT.tooManyRequests);
		default:
			return detail ? { message: `Luma: ${sentence(detail)}` } : undefined;
	}
}

// --- the module ---------------------------------------------------------------------------------

export const LUMA: ProviderModule = Object.freeze({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
		return { Authorization: `Bearer ${credentials.apiKey}` };
	},

	readError: readLumaError,

	async check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
		const problems = ruleProblems(request, countsOf(request.inputs));
		const measured = await measureItems(request.inputs, media);
		problems.push(...fileProblems(request, request.inputs, measured));
		const estimate = estimateFor(request, measured);
		return estimate ? { problems, estimate } : { problems };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		if (request.model !== MODEL_ID || PROVIDER.models[0].providerModels[request.region] === undefined) {
			throw rejected(`Luma does not offer the model "${request.model}" in this region.`);
		}
		return request.mode === 'edit' ? submitEdit(request, http) : submitFrames(request, http);
	},

	async poll(ref: TaskRef, http: ProviderHttp): Promise<PollState> {
		return pollStateOf(await askAbout(ref, http));
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const generation = await askAbout(ref, http);
		const url = generation.state === 'completed' ? videoUrlOf(generation) : undefined;
		if (!url) {
			throw unreadable(TEXT.noVideoAddress);
		}
		return { url };
	},

	async cancel(): Promise<boolean> {
		// Luma has no cancellation, and no DELETE for generations; nothing is sent.
		return false;
	}
});
