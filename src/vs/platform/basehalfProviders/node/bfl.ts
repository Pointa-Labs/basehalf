/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, measureItems, type MeasuredItem } from './check.js';
import { failureForStatus, isRecord, ProviderFailure, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import { DEFAULT_HTTP_OPTIONS, isAllowedAddress, retryAfterMs, type HttpAnswer, type HttpCall, type ProviderHttp } from './http.js';
import { base64Length, base64Of, bufferSource, dataUrlOf, describeBytes, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector, type ReadMedia } from './media.js';
import type { ModuleCheckResult, ModulePollState, ProviderModule, VideoLocation } from './module.js';
import { promptLanguage, referenceNumber, sharedPromptName, writePromptNames, type PromptContext } from './prompt.js';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, Media, ModeId, ModeInputs, ModeLimits, ModelKind, Params, PlannedMedia, PromptPart, SubmitRequest, TaskRef } from '../common/basehalfProviderTypes.js';

/**
 * Black Forest Labs' FLUX 3 video model and its image models, FLUX 3 Image and
 * FLUX.2, with the user's own key (D59, D64; docs/specs/providers/bfl.md,
 * which records the pages each fact comes from). The video: Frames and Extend
 * run on `/flux-3-video`, whose body names the task (`t2v`, `i2v`, `v2v`), and
 * Edit on the route of FLUX Video Edit [fast], with images and the clip inline
 * as data URLs. The images: each model has its route, and takes its images
 * inline as plain base64. The key goes in `x-key`. A task is followed at the
 * polling address its create answered, kept as the task's id: on the
 * endpoint's origin it is asked with the key, on a BFL cluster host without
 * it, which BFL does not need there. There is no cancellation.
 */

type Resolution = '720p' | '1080p' | '2k' | '4k';
type ImageModelId = 'flux-3-image' | 'flux-2-pro' | 'flux-2-max' | 'flux-2-flex' | 'flux-2-klein-4b' | 'flux-2-klein-9b';
type Flux2Resolution = '1k' | '1.5k' | '2k';

/** A route of the API: what `check` answers as `providerModel`, and the task its body names. */
interface Route {
	readonly id: 'flux-3-video' | 'flux-tools/video-edit-v1';
	/** The body's `mode` on `/flux-3-video`; the edit's route takes none. */
	readonly task?: 't2v' | 'i2v' | 'v2v';
}

/** How an image model is asked: its route, its images, and the fields of its family. */
interface ImageRoute {
	readonly id: ImageModelId;
	readonly family: 'flux-3' | 'flux-2';
	readonly maxImages: number;
	/** FLUX.2's prompt upsampling: `disable_pup` ([pro], [max]), `prompt_upsampling` ([flex]), or none ([klein]). */
	readonly upsampling?: 'disable_pup' | 'prompt_upsampling';
	/** [flex]'s `steps` and `guidance`. */
	readonly tuning?: boolean;
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
/** BFL states no limit for the prompt of `/flux-3-video` or of its image routes; this is BaseHalf's bound. */
const PROMPT_MAX_LENGTH = 20_000;
/** An edit's clip: about 0.7 seconds (17 frames at 24 fps) to 15 seconds; the output keeps its length. */
const EDIT_CLIP_SECONDS: readonly [number, number] = Object.freeze([0.7, 15]) as readonly [number, number];
/** The most BaseHalf sends in one request; inline images are read up to the part of it their base64 can take. */
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
	modes: Object.freeze({ frames: 'Frames', edit: 'Edit', extend: 'Extend', reference: 'References' }),
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
	// The image models.
	imageModels: Object.freeze<Record<ImageModelId, { readonly label: string; readonly description: string }>>({
		'flux-3-image': {
			label: 'FLUX 3 Image',
			description: 'Black Forest Labs\' newest image model: an image from the prompt, an edit of a connected image, or a composition of up to 10, up to 4K, grounded in a web search.'
		},
		'flux-2-pro': {
			label: 'FLUX.2 [pro]',
			description: 'FLUX.2 for most images and edits: an image from the prompt, or an edit or a composition of up to 8 connected images, up to 4 megapixels.'
		},
		'flux-2-max': {
			label: 'FLUX.2 [max]',
			description: 'FLUX.2\'s highest quality and prompt following, with up to 8 connected images, up to 4 megapixels; it searches the web when the prompt asks about something current.'
		},
		'flux-2-flex': {
			label: 'FLUX.2 [flex]',
			description: 'FLUX.2 for text in the image and small details, with adjustable steps and guidance; up to 8 connected images, up to 4 megapixels.'
		},
		'flux-2-klein-4b': {
			label: 'FLUX.2 [klein] 4B',
			description: 'The fastest FLUX.2 model: an image from the prompt or from up to 4 connected images, up to 4 megapixels. It does not rewrite the prompt, so describe the image fully.'
		},
		'flux-2-klein-9b': {
			label: 'FLUX.2 [klein] 9B',
			description: 'A fast FLUX.2 model with higher quality than 4B: an image from the prompt or from up to 4 connected images, up to 4 megapixels. It does not rewrite the prompt, so describe the image fully.'
		}
	}),
	imageResolutionTooltip: 'Each size has about the same number of pixels at every shape: 1K about 1 megapixel, 1.5K about 2, 2K about 4, and 4K about 16, which can take several minutes.',
	flux2ResolutionTooltip: 'The size of the image: 1K is about 1 megapixel (1024 × 1024 at 1:1), 1.5K about 2, and 2K about 4, the largest FLUX.2 makes. Black Forest Labs recommends about 2 megapixels or less for quality and speed.',
	imageRatioTooltip: 'The shape of the image. Adaptive takes a shape the prompt asks for, otherwise the shape of the first connected image; from the prompt alone it makes a square image.',
	flux2RatioTooltip: 'The shape of the image, also for an edit: FLUX.2 makes the image at exactly this shape.',
	grounding: 'Grounding',
	groundingTooltip: 'Black Forest Labs searches the web and images to get real things right. Off is faster and uses only the prompt and the connected images.',
	promptRewriting: 'Prompt Rewriting',
	promptRewritingTooltip: 'Black Forest Labs rewrites the prompt with more detail before it generates. Off generates from the prompt exactly as written.',
	steps: 'Steps',
	stepsTooltip: 'More steps give more detail and realism, and take longer.',
	guidance: 'Guidance',
	guidanceTooltip: 'How closely the image follows the prompt: higher follows it more closely, at some cost to realism.',
	seed: 'Seed',
	seedTooltip: 'The same seed with the same request gives a similar image. Leave it empty for a new one each time.',
	imageSafetyTooltip: 'How strictly Black Forest Labs moderates the prompt, the connected images, and the image: 0 is the strictest.',
	extendDuration: 'FLUX 3 continues a clip by 5 to 15 seconds; choose 15 seconds or less, or Auto.',
	editPrompt: (length: number) => `The prompt is ${length} characters long; FLUX 3 in Edit mode takes at most ${EDIT_PROMPT_MAX_LENGTH}.`,
	tooManyPixels: (label: string, width: number, height: number) => `${label} is ${width} × ${height} px, more than the 16 megapixels FLUX 3 Image takes.`,
	notMp4: (label: string) => `${label} is a MOV video; Black Forest Labs takes MP4 videos only.`,
	notImage: (label: string) => `${label} is not a PNG, JPEG, or WebP image.`,
	notVideo: (label: string) => `${label} is not an MP4 video.`,
	noSuchInput: (model: string, label: string) => `${model} takes no ${label.charAt(0).toLowerCase()}${label.slice(1)}.`,
	tooLarge: (size: number, limit: number) => `The inputs make a request of ${describeBytes(size)}; BaseHalf sends at most ${describeBytes(limit)}. Use fewer or smaller inputs.`,
	noMode: (mode: string) => `FLUX 3 has no ${mode} mode.`,
	noResolution: (value: unknown) => `FLUX 3 has no resolution ${String(value)}.`,
	noSize: (model: string, ratio: unknown, resolution: unknown) => `${model} has no size for the ratio ${String(ratio)} at ${String(resolution)}.`,
	noModel: (model: string) => `Black Forest Labs has no model "${model}".`,
	noTask: 'Black Forest Labs accepted the request but gave no task id or polling address BaseHalf can read.',
	pollingElsewhere: 'The task\'s polling address is neither on the endpoint set up for Black Forest Labs nor on a host of Black Forest Labs, so BaseHalf does not ask it.',
	requestModerated: (reasons: string) => `Black Forest Labs' moderation refused the prompt or an input before the video was made${reasons}. Change the request: the same one is refused again.`,
	contentModerated: (reasons: string) => `Black Forest Labs' moderation withheld the finished video${reasons}. Change the prompt or the inputs.`,
	imageRequestModerated: (reasons: string) => `Black Forest Labs' moderation refused the prompt or an input before the image was made${reasons}. Change the request: the same one is refused again.`,
	imageContentModerated: (reasons: string) => `Black Forest Labs' moderation withheld the finished image${reasons}. Change the prompt or the inputs.`,
	failed: (detail: string) => detail ? `Black Forest Labs reports that the generation failed: ${detail}` : 'Black Forest Labs reports that the generation failed.',
	noCard: 'Black Forest Labs ended the task without a result (No Card Generated).',
	notFound: (id: string) => `Black Forest Labs does not know the task ${id}: it does not exist or has expired.`,
	unknownStatus: (status: string) => `Black Forest Labs reports a task state BaseHalf does not know: ${status}.`,
	noVideo: 'Black Forest Labs gives no address of a video for this task.',
	noImage: 'Black Forest Labs reports the image ready but gives no address of it.',
	refusedKey: 'Black Forest Labs refused the API key. Check it in Providers.',
	forbidden: 'Black Forest Labs refused the API key for this request: the key may be wrong, or its project may not use this endpoint. Check it in Providers.',
	balance: 'The Black Forest Labs organization has too few credits for this request. Add credits in the BFL dashboard.',
	rateLimited: 'Black Forest Labs is already running as many tasks as the account may run at once, or received too many requests. Wait for a task to finish.',
	refused: (words: string) => words ? `Black Forest Labs refused the request: ${words}` : 'Black Forest Labs refused the request.',
	said: (words: string) => `Black Forest Labs: ${words}`
});

// --- the video model ----------------------------------------------------------------------------

/** The resolution classes of the API, by the shared values. */
const RESOLUTION_CLASSES: Readonly<Record<Resolution, string>> = Object.freeze({ '720p': 'hd', '1080p': 'fhd', '2k': 'qhd', '4k': 'uhd' });
const RESOLUTIONS = Object.freeze(Object.keys(RESOLUTION_CLASSES)) as readonly Resolution[];
const RATIOS: readonly string[] = Object.freeze(['21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21']);
const VIDEO_MODEL_ID = 'flux-3';

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
	id: VIDEO_MODEL_ID,
	kind: 'video',
	label: TEXT.model,
	description: TEXT.description,
	providerModels: { global: 'flux-3-video' },
	prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
	modes: MODES,
	parameters: PARAMETERS
});

// --- the image models ---------------------------------------------------------------------------

/** Each model's route, which is its id, and how its body is built (bfl.md, "Requests of the image models"). */
const IMAGE_ROUTES: readonly ImageRoute[] = Object.freeze([
	{ id: 'flux-3-image', family: 'flux-3', maxImages: 10 },
	{ id: 'flux-2-pro', family: 'flux-2', maxImages: 8, upsampling: 'disable_pup' },
	{ id: 'flux-2-max', family: 'flux-2', maxImages: 8, upsampling: 'disable_pup' },
	{ id: 'flux-2-flex', family: 'flux-2', maxImages: 8, upsampling: 'prompt_upsampling', tuning: true },
	{ id: 'flux-2-klein-4b', family: 'flux-2', maxImages: 4 },
	{ id: 'flux-2-klein-9b', family: 'flux-2', maxImages: 4 }
]);

/** The 15 shapes of FLUX 3 Image's `aspect_ratio`, which FLUX.2 makes as exact sizes. */
const IMAGE_RATIOS: readonly string[] = Object.freeze(['21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21']);
/** FLUX 3 Image's tiers by the shared values; `768sq`, its tier for fast previews, has none. */
const FLUX3_RESOLUTIONS: Readonly<Record<string, string>> = Object.freeze({ '1k': '1K', '1.5k': '1.5K', '2k': '2K', '4k': '4K' });
/** The most pixels of FLUX.2's tiers, following FLUX 3 Image's areas: about 1, 2, and 4 megapixels, FLUX.2's largest. */
const FLUX2_AREAS: Readonly<Record<Flux2Resolution, number>> = Object.freeze({ '1k': 1024 * 1024, '1.5k': 2 * 1024 * 1024, '2k': 4 * 1024 * 1024 });
const FLUX2_RESOLUTION_LABELS: Readonly<Record<Flux2Resolution, string>> = Object.freeze({ '1k': '1K', '1.5k': '1.5K', '2k': '2K' });
/** FLUX.2's sides are multiples of 16. */
const FLUX2_SIDE_STEP = 16;
/** FLUX 3 Image takes images of at least 256 × 256 px and at most 16 megapixels. */
const FLUX3_MIN_SIDE = 256;
const FLUX3_MAX_PIXELS = 16 * 1024 * 1024;

function imageMode(route: ImageRoute): CatalogMode {
	return {
		id: 'reference',
		label: TEXT.modes.reference,
		inputs: { ...NO_INPUTS, images: { min: 0, max: route.maxImages } },
		limits: route.family === 'flux-3' ? { imageMinSide: FLUX3_MIN_SIDE } : {}
	};
}

function imageSafety(max: number): CatalogParameter {
	return { name: 'safety_tolerance', label: TEXT.safetyTolerance, tooltip: TEXT.imageSafetyTooltip, kind: 'integer', min: 0, max, step: 1, default: 2, advanced: true };
}

/** The settings of an image model, in the order the panel shows them (bfl.md, "Parameters of the image models"). */
function imageParameters(route: ImageRoute): CatalogParameter[] {
	if (route.family === 'flux-3') {
		return [
			{
				name: 'resolution',
				label: TEXT.resolution,
				tooltip: TEXT.imageResolutionTooltip,
				kind: 'choice',
				options: Object.entries(FLUX3_RESOLUTIONS).map(([value, label]) => ({ value, label })),
				default: '1k'
			},
			{
				name: 'ratio',
				label: TEXT.ratio,
				tooltip: TEXT.imageRatioTooltip,
				kind: 'choice',
				display: 'ratio',
				options: [{ value: 'adaptive', label: TEXT.adaptive }, ...IMAGE_RATIOS.map(value => ({ value, label: value }))],
				default: 'adaptive'
			},
			{ name: 'grounding', label: TEXT.grounding, tooltip: TEXT.groundingTooltip, kind: 'boolean', default: true },
			imageSafety(4)
		];
	}
	const parameters: CatalogParameter[] = [
		{
			name: 'resolution',
			label: TEXT.resolution,
			tooltip: TEXT.flux2ResolutionTooltip,
			kind: 'choice',
			options: (Object.keys(FLUX2_AREAS) as Flux2Resolution[]).map(value => ({ value, label: FLUX2_RESOLUTION_LABELS[value] })),
			default: '1k'
		},
		{
			name: 'ratio',
			label: TEXT.ratio,
			tooltip: TEXT.flux2RatioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: IMAGE_RATIOS.map(value => ({ value, label: value })),
			default: '1:1'
		}
	];
	if (route.upsampling) {
		parameters.push({ name: 'prompt_extend', label: TEXT.promptRewriting, tooltip: TEXT.promptRewritingTooltip, kind: 'boolean', default: true, advanced: true });
	}
	if (route.tuning) {
		parameters.push(
			{ name: 'steps', label: TEXT.steps, tooltip: TEXT.stepsTooltip, kind: 'integer', min: 1, max: 50, step: 1, default: 50, advanced: true },
			{ name: 'guidance', label: TEXT.guidance, tooltip: TEXT.guidanceTooltip, kind: 'number', min: 1.5, max: 10, step: 0.1, default: 5, advanced: true }
		);
	}
	parameters.push(
		{ name: 'seed', label: TEXT.seed, tooltip: TEXT.seedTooltip, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true },
		imageSafety(5)
	);
	return parameters;
}

function imageModel(route: ImageRoute): CatalogModel {
	return Object.freeze<CatalogModel>({
		id: route.id,
		kind: 'image',
		label: TEXT.imageModels[route.id].label,
		description: TEXT.imageModels[route.id].description,
		providerModels: { global: route.id },
		prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
		modes: [imageMode(route)],
		parameters: imageParameters(route),
		// FLUX.2 is asked for PNG; FLUX 3 Image has no format field, and BFL's own clients save its images as PNG.
		outputFormat: 'png'
	});
}

const PROVIDER = Object.freeze<CatalogProvider>({
	id: 'bfl',
	label: TEXT.provider,
	regions: [{ id: 'global', label: TEXT.region, baseUrl: 'https://api.bfl.ai/v1', console: 'https://dashboard.bfl.ai' }],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey, placeholder: 'bfl_…' }],
	models: [FLUX_3, ...IMAGE_ROUTES.map(imageModel)]
});

/** The route of an image model, or undefined for the video model. */
function imageRouteOf(model: string): ImageRoute | undefined {
	return IMAGE_ROUTES.find(route => route.id === model);
}

function kindOf(model: string): ModelKind {
	return imageRouteOf(model) ? 'image' : 'video';
}

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

/**
 * FLUX.2's width and height for a ratio `a:b` and a tier of `A` pixels:
 * √(A·a/b) and √(A·b/a), each rounded down to a multiple of 16 (bfl.md,
 * "Parameters of the image models"), so the image never has more pixels than
 * its tier.
 */
function flux2Size(ratio: unknown, resolution: unknown): { readonly width: number; readonly height: number } | undefined {
	const shape = typeof ratio === 'string' ? /^(\d{1,3}):(\d{1,3})$/.exec(ratio) : null;
	if (!shape || typeof resolution !== 'string' || !Object.hasOwn(FLUX2_AREAS, resolution)) {
		return undefined;
	}
	const area = FLUX2_AREAS[resolution as Flux2Resolution];
	const [across, down] = [Number(shape[1]), Number(shape[2])];
	if (!across || !down) {
		return undefined;
	}
	const side = (value: number) => Math.floor(value / FLUX2_SIDE_STEP + 1e-9) * FLUX2_SIDE_STEP;
	return { width: side(Math.sqrt(area * across / down)), height: side(Math.sqrt(area * down / across)) };
}

// --- requests -----------------------------------------------------------------------------------

/** The inputs as the body takes them: the start and the end frame in order, and the clip of Edit and Extend. */
interface SentMedia {
	readonly keyframes: readonly string[];
	readonly clip?: string;
}

/** The JSON of the request that creates a video task (bfl.md, "Requests"). */
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

/**
 * The JSON of the request that creates an image task (bfl.md, "Requests of the
 * image models"): FLUX 3 Image's images as a list, FLUX.2's as `input_image`,
 * `input_image_2`, and so on, each plain base64 in the order of the inputs.
 */
function imageBody(route: ImageRoute, params: Params, prompt: string, images: readonly string[]): Record<string, unknown> {
	if (route.family === 'flux-3') {
		return {
			prompt,
			...(images.length ? { images: [...images] } : {}),
			aspect_ratio: params.ratio === 'adaptive' ? 'auto' : params.ratio,
			resolution: params.resolution,
			grounding: params.grounding === true,
			safety_tolerance: params.safety_tolerance
		};
	}
	const size = flux2Size(params.ratio, params.resolution);
	if (!size) {
		throw rejected(TEXT.noSize(TEXT.imageModels[route.id].label, params.ratio, params.resolution));
	}
	const body: Record<string, unknown> = { prompt };
	images.forEach((image, index) => {
		body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = image;
	});
	body.width = size.width;
	body.height = size.height;
	if (route.upsampling === 'disable_pup') {
		body.disable_pup = params.prompt_extend !== true;
	} else if (route.upsampling === 'prompt_upsampling') {
		body.prompt_upsampling = params.prompt_extend === true;
	}
	if (route.tuning) {
		body.steps = params.steps;
		body.guidance = params.guidance;
	}
	if (typeof params.seed === 'number') {
		body.seed = params.seed;
	}
	body.safety_tolerance = params.safety_tolerance;
	body.output_format = 'png';
	return body;
}

/** An image read whole, refused unless its bytes are a PNG, JPEG, or WebP. */
async function readImage(media: Media, label: string): Promise<{ readonly read: ReadMedia; readonly format: 'png' | 'jpeg' | 'webp' }> {
	const read = await readMedia(media, IMAGE_READ_MAX_BYTES, label);
	const { format } = await measure(bufferSource(read.bytes));
	if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
		throw rejected(TEXT.notImage(label));
	}
	return { read, format };
}

/** An image as `data:<type>;base64,…`, its type read from its bytes: the video's keyframes. */
async function imageDataUrl(media: Media, label: string): Promise<string> {
	const { read, format } = await readImage(media, label);
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
			throw rejected(TEXT.noSuchInput(TEXT.model, item.label));
		}
	}
	return clip === undefined ? { keyframes } : { keyframes, clip };
}

/** The images of an image request as plain base64, the form BFL's samples send, in the order of the inputs. */
async function sentImages(route: ImageRoute, inputs: PlannedMedia): Promise<string[]> {
	const items = plannedItems(inputs);
	// Every input is refused before any file is read.
	const other = items.find(item => item.slot !== 'image');
	if (other) {
		throw rejected(TEXT.noSuchInput(TEXT.imageModels[route.id].label, other.label));
	}
	const images: string[] = [];
	for (const item of items) {
		images.push(base64Of((await readImage(item.media, item.label)).read));
	}
	return images;
}

/**
 * A polling address BaseHalf asks: `https` (or `http` on this computer), at
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

/** The task's `remoteId`: the polling address BFL answered when BaseHalf may ask it, otherwise the task's id. */
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

function jsonOf(answer: HttpAnswer): unknown {
	try {
		return answer.json();
	} catch {
		return undefined;
	}
}

/**
 * The task as a poll answers it (bfl.md, "Asking about a task"). A 503 may
 * carry the task's state in a normal JSON body, which is read; one without is
 * an outage, asked again as every poll is: after its `Retry-After`, or 1, 2,
 * then 4 seconds apart.
 */
async function askAbout(ref: TaskRef, http: ProviderHttp): Promise<Record<string, unknown>> {
	const call: HttpCall = { ...pollCall(ref.remoteId, http.endpoint), accept: [503] };
	const delays = DEFAULT_HTTP_OPTIONS.retryDelaysMs;
	for (let attempt = 0; ; attempt++) {
		const answer = await http.request(call);
		if (answer.status !== 503) {
			return answer.object();
		}
		const body = jsonOf(answer);
		if (isRecord(body) && typeof body.status === 'string' && body.status.trim()) {
			return body;
		}
		const wait = retryAfterMs(answer.headers['retry-after']) ?? delays[attempt];
		if (attempt >= delays.length || wait > DEFAULT_HTTP_OPTIONS.maxRetryAfterMs) {
			throw failureForStatus(503, readBflError(503, body), false);
		}
		await http.wait(wait);
	}
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

/**
 * A task's state from `get_result` (bfl.md, "Asking about a task"). A video's
 * address is answered as it is. An image's address lasts minutes, so with the
 * headers it is downloaded with when the poll names a target for it: the poll
 * itself then downloads the image (bfl.md, "Answers of the image models").
 */
function pollStateOf(body: Record<string, unknown>, remoteId: string, kind: ModelKind, download?: Readonly<Record<string, string>>): ModulePollState {
	const status = body.status;
	const progress = body.progress;
	// BFL does not document the scale of `progress`; only a fraction is shown.
	const fraction = typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 1 ? { fraction: progress } : {};
	const image = kind === 'image';
	switch (status) {
		case 'Pending':
			return { state: 'pending', ...fraction };
		case 'Reasoning':
		case 'Generating':
			return { state: 'running', ...fraction };
		case 'Ready': {
			const sample = sampleOf(body);
			if (image) {
				if (!sample) {
					throw unreadable(TEXT.noImage);
				}
				return { state: 'succeeded', outputs: [{ url: sample, ...(download ? { headers: download } : {}) }] };
			}
			return sample ? { state: 'succeeded', videoUrl: sample } : { state: 'succeeded' };
		}
		case 'Request Moderated':
			return { state: 'failed', message: (image ? TEXT.imageRequestModerated : TEXT.requestModerated)(reasonsOf(body)) };
		case 'Content Moderated':
			return { state: 'failed', message: (image ? TEXT.imageContentModerated : TEXT.contentModerated)(reasonsOf(body)) };
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

/** A clip that is not an MP4, and a request larger than BaseHalf sends. */
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

/** An image of FLUX 3 Image above 16 megapixels, and an image request larger than BaseHalf sends. */
function imageProblems(route: ImageRoute, request: CheckRequest, measured: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	const images = measured.filter(item => item.slot === 'image');
	if (route.family === 'flux-3') {
		for (const item of images) {
			const { width, height } = item.facts;
			if (width && height && width * height > FLUX3_MAX_PIXELS) {
				problems.push(TEXT.tooManyPixels(item.label, width, height));
			}
		}
	}
	// The JSON with empty images, then the images as base64. A size the settings cannot make is refused when it is sent.
	if (route.family === 'flux-2' && !flux2Size(request.params.ratio, request.params.resolution)) {
		return problems;
	}
	const body = imageBody(route, request.params, request.prompt, images.map(() => ''));
	const size = Buffer.byteLength(JSON.stringify(body), 'utf8') + images.reduce((total, item) => total + base64Length(item.facts.bytes), 0);
	if (size > REQUEST_MAX_BYTES) {
		problems.push(TEXT.tooLarge(size, REQUEST_MAX_BYTES));
	}
	return problems;
}

// --- the module ---------------------------------------------------------------------------------

/** The headers that carry the key. */
function keyHeaders(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
	return { 'x-key': credentials.apiKey };
}

/**
 * The names of the inputs in a prompt (D74; BFL, "Names in the prompt"):
 * FLUX 3 Image calls the n-th entry of `images` "Image n", and FLUX.2 calls
 * its inputs "image 1", "image 2", in the prompt's every language. The video
 * model's frames and clip have no names there and take the shared ones.
 */
function writePrompt(prompt: readonly PromptPart[], request: PromptContext): string {
	const language = promptLanguage(prompt);
	const route = imageRouteOf(request.model);
	return writePromptNames(prompt, input => route && input.input === 'images'
		? `${route.family === 'flux-3' ? 'Image' : 'image'} ${referenceNumber(input)}`
		: sharedPromptName(input, language));
}

export const BFL: ProviderModule = Object.freeze({
	describe(): CatalogProvider {
		return PROVIDER;
	},

	headers: keyHeaders,

	readError: readBflError,

	writePrompt,

	async check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
		const image = imageRouteOf(request.model);
		if (image) {
			return { problems: imageProblems(image, request, await measureItems(request.inputs, media)) };
		}
		const route = routeOf(request.mode, countsOf(request.inputs).startFrame);
		const problems = ruleProblems(request);
		problems.push(...await fileProblems(route, request, request.inputs, media));
		return { problems, providerModel: route.id };
	},

	async submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const image = imageRouteOf(request.model);
		if (image) {
			const images = await sentImages(image, request.inputs);
			const answer = await http.create({ method: 'POST', path: `/${image.id}`, body: { kind: 'json', value: imageBody(image, request.params, request.prompt, images) } });
			return remoteIdOf(answer.object(), http.endpoint);
		}
		if (request.model !== VIDEO_MODEL_ID) {
			throw rejected(TEXT.noModel(request.model));
		}
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

	async poll(ref: TaskRef, http: ProviderHttp): Promise<ModulePollState> {
		const kind = kindOf(ref.model);
		// With a target, an image is downloaded by the poll itself: its address may last only 10 minutes.
		const download = kind === 'image' && ref.targets?.length ? keyHeaders(ref.credentials) : undefined;
		return pollStateOf(await askAbout(ref, http), ref.remoteId, kind, download);
	},

	async videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation> {
		const state = pollStateOf(await askAbout(ref, http), ref.remoteId, 'video');
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
