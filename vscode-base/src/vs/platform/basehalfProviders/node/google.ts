/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { countsOf, measureItems } from './check.js';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import type { HttpAnswer, ProviderHttp } from './http.js';
import { base64Length, base64Of, bufferSource, measure, plannedItems, readMedia, type MediaFormat, type MediaInspector } from './media.js';
import type { AnsweredAtOnce, ModuleCheckResult, ModulePollState, OutputLocation, ProviderModule, VideoLocation } from './module.js';
import { promptLanguage, sharedPromptName, writePromptNames, type PromptContext } from './prompt.js';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, ImageFormat, ModeId, PollState, PromptPart, SubmitRequest, TaskRef } from '../common/basehalfProviderTypes.js';

/**
 * Google's models on the Gemini API, all through the Interactions API
 * (docs/specs/providers/google.md). The video model, Gemini Omni Flash, runs
 * in the background: the create answers at once with the interaction's id, a
 * poll reads the stored interaction, and the finished video comes inside it as
 * base64. The image models, Nano Banana, answer the create with their image,
 * also as base64. Inputs travel inline as base64 too.
 */

const MODEL_ID = 'gemini-omni-1.1-flash';

type Resolution = '360p' | '720p' | '1080p' | '4k';

type ImageModelId = 'gemini-nano-banana-2.1' | 'gemini-3-pro-image' | 'gemini-3.1-flash-lite-image' | 'gemini-3.1-flash-image';
type ImageResolution = '1k' | '2k' | '4k';
type ThinkingLevel = 'minimal' | 'medium' | 'high';

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
		resolutionTooltip: '1080p and 4K are upscaled from the generated video.',
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the video: landscape or portrait.',
		seed: 'Seed',
		seedTooltip: 'The same seed with the same request gives a similar video. Leave it empty for a new one each time.'
	},
	resolutions: RESOLUTION_LABELS,
	images: Object.freeze<Record<ImageModelId, { readonly label: string; readonly description: string }>>({
		'gemini-nano-banana-2.1': {
			label: 'Nano Banana 2.1',
			description: 'Google\'s recommended image model: fast images from a prompt or from up to 14 reference images, at 1K, 2K, or 4K, in shapes from 8:1 to 1:8.'
		},
		'gemini-3-pro-image': {
			label: 'Nano Banana Pro',
			description: 'Google\'s image model for the most demanding images, such as text, diagrams, and product shots: from a prompt or from up to 14 reference images, at 1K, 2K, or 4K.'
		},
		'gemini-3.1-flash-lite-image': {
			label: 'Nano Banana 2 Lite',
			description: 'Google\'s fastest image model, at 1K: images from a prompt or from reference images. It is not made for many reference images.'
		},
		'gemini-3.1-flash-image': {
			label: 'Nano Banana 2',
			description: 'Google replaced it with Nano Banana 2.1.'
		}
	}),
	image: Object.freeze({
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the image. Adaptive follows the shape of the reference images, or makes a square without them.',
		adaptive: 'Adaptive',
		resolution: 'Resolution',
		resolutionTooltip: '1K, 2K, and 4K images have about 1, 4, and 16 million pixels.',
		resolutions: Object.freeze<Record<ImageResolution, string>>({ '1k': '1K', '2k': '2K', '4k': '4K' }),
		thinking: 'Thinking',
		thinkingTooltip: 'How much the model reasons before it draws. More thinking can help a complex image and takes longer.',
		thinkingLevels: Object.freeze<Record<ThinkingLevel, string>>({ minimal: 'Minimal', medium: 'Medium', high: 'High' })
	}),
	referencesNeedInput: 'Gemini Omni 1.1 Flash in References mode needs at least one reference image or video.',
	requestTooLarge: (megabytes: string) => `The request with its inputs would be about ${megabytes} MB; the Gemini API takes at most 100 MB in one request. Use fewer or smaller inputs.`,
	imageFormat: (label: string) => `${label} is not a PNG, JPEG, WebP, or GIF image.`,
	videoFormat: (label: string) => `${label} is not an MP4 or MOV video.`,
	noAudio: (label: string) => `${label} cannot be sent: Gemini Omni 1.1 Flash takes no audio references.`,
	noLyrics: 'Gemini Omni 1.1 Flash makes videos; it has no Lyrics mode.',
	imagesOnly: (label: string) => `${label} cannot be sent: Google's image models take reference images only.`,
	notOffered: (model: string) => `Google does not offer "${model}" in this region.`,
	noTaskId: 'Google accepted the request but gave no interaction id BaseHalf can read.',
	failed: 'Google reports that the generation failed.',
	cancelled: 'The generation was cancelled.',
	incomplete: 'Google ended the generation without a complete video.',
	imageIncomplete: 'Google ended the generation before the image was finished.',
	requiresAction: 'Google waits for an action on the generation that BaseHalf cannot take.',
	budgetExceeded: 'Google ended the generation when its budget ran out.',
	noVideo: 'Google finished the generation without a video.',
	noVideoSaying: (text: string) => `Google finished the generation without a video: ${text}`,
	noImage: 'Google finished the generation without an image.',
	noImageSaying: (text: string) => `Google finished the generation without an image: ${text}`,
	notReady: 'The generation has no video yet.',
	unreadableAddress: 'Google gave an address BaseHalf cannot read.',
	unknownStatus: (status: string) => `Google reports a generation status BaseHalf does not know: ${status || 'none'}.`,
	freeTier: 'Google offers this model only on a paid tier, and the project of this API key is on the free tier. Set up billing for the project in Google AI Studio, or use the key of a project that has it.'
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
	kind: 'video',
	label: TEXT.model,
	description: TEXT.description,
	providerModels: { global: MODEL_ID },
	prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
	modes: MODES,
	parameters: PARAMETERS
};

// --- the image models --------------------------------------------------------------------------

/** One of Google's image models, as the image guide and its model page describe it. */
interface GoogleImageModel {
	/** The catalog id, which is also the id sent. */
	readonly id: ImageModelId;
	/** The values of `response_format.aspect_ratio` it takes. */
	readonly ratios: readonly string[];
	readonly resolutions: readonly ImageResolution[];
	/** Its levels of `generation_config.thinking_level` and their default; absent when it has none. */
	readonly thinking?: { readonly levels: readonly ThinkingLevel[]; readonly default: ThinkingLevel };
	/** Its input token limit; the prompt is bounded at as many characters. */
	readonly inputTokens: number;
	readonly deprecated?: boolean;
}

/** The ten ratios every image model takes, in the order the panel shows them. */
const RATIOS_10: readonly string[] = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']);
/** The fourteen of Nano Banana 2.1 and 2: the ten, then the wide and tall ones. */
const RATIOS_14: readonly string[] = Object.freeze([...RATIOS_10, '4:1', '1:4', '8:1', '1:8']);

const IMAGE_MODELS: readonly GoogleImageModel[] = Object.freeze([
	{ id: 'gemini-nano-banana-2.1', ratios: RATIOS_14, resolutions: ['1k', '2k', '4k'], thinking: { levels: ['minimal', 'medium', 'high'], default: 'medium' }, inputTokens: 131_072 },
	{ id: 'gemini-3-pro-image', ratios: RATIOS_10, resolutions: ['1k', '2k', '4k'], inputTokens: 65_536 },
	{ id: 'gemini-3.1-flash-lite-image', ratios: RATIOS_10, resolutions: ['1k'], thinking: { levels: ['minimal', 'high'], default: 'minimal' }, inputTokens: 65_536 },
	{ id: 'gemini-3.1-flash-image', ratios: RATIOS_14, resolutions: ['1k', '2k', '4k'], thinking: { levels: ['minimal', 'high'], default: 'minimal' }, inputTokens: 131_072, deprecated: true }
] satisfies GoogleImageModel[]);

/** Up to 14 reference images, the image guide's limit for every model. */
const IMAGE_REFERENCES_MAX = 14;
/** The ratio that leaves the shape to Google, which follows the reference images or makes a square. */
const ADAPTIVE = 'adaptive';
/** `response_format.image_size` of each resolution: an uppercase K, which Google requires. */
const IMAGE_SIZES: Readonly<Record<ImageResolution, string>> = Object.freeze({ '1k': '1K', '2k': '2K', '4k': '4K' });
/** The only output type the reference names: the models declare JPEG, so a draft has its final name. */
const IMAGE_OUTPUT_TYPE = 'image/jpeg';

const IMAGE_REFERENCES: CatalogMode = {
	id: 'reference',
	label: TEXT.modes.reference,
	inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: IMAGE_REFERENCES_MAX }, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
	limits: {}
};

function declareImageModel(model: GoogleImageModel): CatalogModel {
	const parameters: CatalogParameter[] = [
		{
			name: 'ratio',
			label: TEXT.image.ratio,
			tooltip: TEXT.image.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: [{ value: ADAPTIVE, label: TEXT.image.adaptive }, ...model.ratios.map(value => ({ value, label: value }))],
			default: ADAPTIVE
		},
		{
			name: 'resolution',
			label: TEXT.image.resolution,
			tooltip: TEXT.image.resolutionTooltip,
			kind: 'choice',
			options: model.resolutions.map(value => ({ value, label: TEXT.image.resolutions[value] })),
			default: '1k'
		}
	];
	if (model.thinking) {
		parameters.push({
			name: 'thinking_level',
			label: TEXT.image.thinking,
			tooltip: TEXT.image.thinkingTooltip,
			kind: 'choice',
			options: model.thinking.levels.map(value => ({ value, label: TEXT.image.thinkingLevels[value] })),
			default: model.thinking.default,
			advanced: true
		});
	}
	return {
		id: model.id,
		kind: 'image',
		label: TEXT.images[model.id].label,
		description: TEXT.images[model.id].description,
		providerModels: { global: model.id },
		prompt: { required: 'always', maxLength: model.inputTokens },
		modes: [IMAGE_REFERENCES],
		parameters,
		outputFormat: 'jpeg',
		answersAtOnce: true,
		...(model.deprecated ? { deprecated: true } : {})
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'google',
	label: TEXT.provider,
	regions: [
		{ id: 'global', label: TEXT.region, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', console: 'https://aistudio.google.com/api-keys' }
	],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: [OMNI, ...IMAGE_MODELS.map(declareImageModel)]
});

function imageModelOf(id: string): GoogleImageModel | undefined {
	return IMAGE_MODELS.find(model => model.id === id);
}

/** The id sent for a model in a region, or a refusal when the region does not offer it. */
function providerModelOf(model: string, region: string): string {
	const providerModel = ENTRY.models.find(entry => entry.id === model)?.providerModels[region];
	if (!providerModel) {
		throw rejected(TEXT.notOffered(model));
	}
	return providerModel;
}

// --- check -------------------------------------------------------------------------------------

async function check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
	const counts = countsOf(request.inputs);
	const problems: string[] = [];
	if (!imageModelOf(request.model) && request.mode === 'reference' && counts.images === 0 && counts.videos === 0) {
		problems.push(TEXT.referencesNeedInput);
	}
	let size = REQUEST_OVERHEAD_BYTES + Buffer.byteLength(JSON.stringify(request.prompt), 'utf8');
	for (const item of await measureItems(request.inputs, media)) {
		size += base64Length(item.facts.bytes) + PART_OVERHEAD_BYTES;
	}
	if (size > REQUEST_MAX_BYTES) {
		problems.push(TEXT.requestTooLarge((size / 1_000_000).toFixed(1)));
	}
	return { problems };
}

// --- requests ----------------------------------------------------------------------------------

const INTERACTIONS = '/interactions';

function interactionPath(remoteId: string): string {
	return `${INTERACTIONS}/${encodeURIComponent(remoteId)}`;
}

/** The MIME types the Interactions API names for each format BaseHalf reads. */
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
		case 'lyrics':
			// A mode of music models; the commands send a module only a mode its model declares.
			throw rejected(TEXT.noLyrics);
	}
}

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const image = imageModelOf(request.model);
	return image ? submitImage(image, request, http) : submitVideo(request, http);
}

async function submitVideo(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	if (request.model !== OMNI.id) {
		throw rejected(TEXT.notOffered(request.model));
	}
	const providerModel = providerModelOf(request.model, request.region);
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

/**
 * An image request (google.md, "Image models"): the prompt, then the reference
 * images in the plan's order, sent once and not in the background. Google
 * answers with the finished interaction, whose image is the one output; an
 * interaction it answers before it ends is followed by its id instead.
 */
async function submitImage(model: GoogleImageModel, request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
	const providerModel = providerModelOf(model.id, request.region);
	const input: unknown[] = [{ type: 'text', text: request.prompt }];
	for (const item of plannedItems(request.inputs)) {
		if (item.slot !== 'image') {
			// The one mode of an image model takes reference images only.
			throw rejected(TEXT.imagesOnly(item.label));
		}
		const read = await readMedia(item.media, REQUEST_MAX_BYTES, item.label);
		const { format } = await measure(bufferSource(read.bytes));
		const type = format ? IMAGE_TYPES[format] : undefined;
		if (!type) {
			throw rejected(TEXT.imageFormat(item.label));
		}
		input.push({ type: 'image', mime_type: type, data: base64Of(read) });
	}
	// The parameters arrive checked and completed: the ratio, the resolution, and the thinking level of a model that has one.
	const { ratio, resolution, thinking_level: thinkingLevel } = request.params;
	const body = Buffer.from(JSON.stringify({
		model: providerModel,
		input,
		response_format: {
			type: 'image',
			mime_type: IMAGE_OUTPUT_TYPE,
			image_size: IMAGE_SIZES[resolution as ImageResolution],
			...(ratio !== undefined && ratio !== ADAPTIVE ? { aspect_ratio: ratio } : {})
		},
		...(thinkingLevel !== undefined ? { generation_config: { thinking_level: thinkingLevel } } : {})
	}), 'utf8');
	if (body.byteLength > REQUEST_MAX_BYTES) {
		throw rejected(TEXT.requestTooLarge((body.byteLength / 1_000_000).toFixed(1)));
	}
	// The answer holds the image; it is read up to the size the commands allow a model that answers at once.
	const answer = await http.create({ method: 'POST', path: INTERACTIONS, body: { kind: 'bytes', bytes: body, contentType: 'application/json' } });
	const interaction = answer.object();
	const reading = readInteraction(interaction);
	if (!STATUSES.has(reading.status)) {
		// The request was taken, and the image may have been made.
		throw unknownOutcome(TEXT.unknownStatus(reading.status));
	}
	const state = imageState(reading, http.endpoint);
	switch (state.state) {
		case 'pending':
		case 'running': {
			// Not finished within the answer: the interaction is stored, so its id is followed like a video's.
			const id = interaction.id;
			if (typeof id !== 'string' || !id.trim()) {
				throw unknownOutcome(TEXT.noTaskId);
			}
			return id;
		}
		case 'succeeded':
			return { outputs: state.outputs };
		default:
			return { outputs: [{ refused: state.message }] };
	}
}

// --- the interaction ---------------------------------------------------------------------------

/** What BaseHalf reads of an interaction. */
interface Reading {
	readonly status: string;
	/** The output's video: its base64, or the address Google gave instead. */
	readonly video?: { readonly data?: string; readonly uri?: string };
	/** The output's last image, with the type Google names: its base64, or the address Google gave instead. */
	readonly image?: { readonly data?: string; readonly uri?: string; readonly mimeType?: string };
	/** The model's text output, when it wrote one. */
	readonly text?: string;
	/** The interaction's errors, or its output step's error. */
	readonly error?: string;
}

/** Every status the reference names. */
const STATUSES: ReadonlySet<string> = new Set(['queued', 'in_progress', 'requires_action', 'completed', 'failed', 'cancelled', 'incomplete', 'budget_exceeded']);

/** The formats of the image types Google answers. */
const IMAGE_FORMATS_BY_TYPE: Readonly<Record<string, ImageFormat>> = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' });

function words(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readInteraction(interaction: Record<string, unknown>): Reading {
	const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
	let video: Reading['video'];
	let image: Reading['image'];
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
			} else if (part.type === 'image') {
				// The last image of the output is the final one (the SDK's `output_image`); images
				// of `thought` steps are the model's drafts and are not read.
				const mimeType = words(part.mime_type)?.toLowerCase();
				if (typeof part.data === 'string' && part.data.length > 0) {
					image = { data: part.data, ...(mimeType ? { mimeType } : {}) };
				} else if (words(part.uri)) {
					image = { uri: words(part.uri), ...(mimeType ? { mimeType } : {}) };
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
		...(image ? { image } : {}),
		...(texts.length ? { text: texts.join(' ') } : {}),
		...(errors.length ? { error: [...new Set(errors)].join(' ') } : {})
	};
}

/**
 * The address of a file Google answered as `uri`: an absolute address as it
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

/** A state that reads the same for a video and an image: still to come, or ended without its file. */
type CommonState =
	| { readonly state: 'pending' | 'running' }
	| { readonly state: 'failed' | 'cancelled'; readonly message: string };

/** The state of an image interaction: a success has the image as its one output. */
type ImageState = CommonState | { readonly state: 'succeeded'; readonly outputs: readonly OutputLocation[] };

/** Every status but `completed` and `incomplete`, whose words depend on what the model makes. */
function commonState(reading: Reading): CommonState {
	switch (reading.status) {
		case 'queued':
			return { state: 'pending' };
		case 'in_progress':
			return { state: 'running' };
		case 'failed':
			return { state: 'failed', message: reading.error ?? TEXT.failed };
		case 'cancelled':
			return { state: 'cancelled', message: reading.error ?? TEXT.cancelled };
		case 'requires_action':
			return { state: 'failed', message: TEXT.requiresAction };
		case 'budget_exceeded':
			return { state: 'failed', message: reading.error ? `${TEXT.budgetExceeded} ${reading.error}` : TEXT.budgetExceeded };
		default:
			throw unreadable(TEXT.unknownStatus(reading.status));
	}
}

function stateOf(reading: Reading, endpoint: URL): PollState {
	switch (reading.status) {
		case 'completed':
			if (reading.video?.data) {
				return { state: 'succeeded' };
			}
			if (reading.video?.uri) {
				return { state: 'succeeded', videoUrl: videoAddress(reading.video.uri, endpoint) };
			}
			return { state: 'failed', message: reading.text || reading.error ? TEXT.noVideoSaying((reading.text ?? reading.error)!) : TEXT.noVideo };
		case 'incomplete':
			return { state: 'failed', message: reading.error ? `${TEXT.incomplete} ${reading.error}` : TEXT.incomplete };
		default:
			return commonState(reading);
	}
}

/** The state of an image interaction (google.md, "Image models", "Answer"). */
function imageState(reading: Reading, endpoint: URL): ImageState {
	switch (reading.status) {
		case 'completed': {
			const image = reading.image;
			if (image?.data) {
				const format = image.mimeType ? IMAGE_FORMATS_BY_TYPE[image.mimeType] : undefined;
				return { state: 'succeeded', outputs: [{ bytes: Buffer.from(image.data, 'base64'), ...(format ? { format } : {}) }] };
			}
			if (image?.uri) {
				let url: string;
				try {
					url = videoAddress(image.uri, endpoint);
				} catch (error) {
					return { state: 'failed', message: error instanceof Error ? error.message : TEXT.unreadableAddress };
				}
				return { state: 'succeeded', outputs: [{ url }] };
			}
			return { state: 'failed', message: reading.text || reading.error ? TEXT.noImageSaying((reading.text ?? reading.error)!) : TEXT.noImage };
		}
		case 'incomplete':
			return { state: 'failed', message: reading.error ? `${TEXT.imageIncomplete} ${reading.error}` : TEXT.imageIncomplete };
		default:
			return commonState(reading);
	}
}

async function getInteraction(ref: TaskRef, http: ProviderHttp): Promise<Reading> {
	const answer = await http.request({ method: 'GET', path: interactionPath(ref.remoteId), maxAnswerBytes: INTERACTION_MAX_BYTES });
	return readInteraction(answer.object());
}

/** An image interaction is followed only when Google answered its create before it ended; its image is the task's output. */
async function poll(ref: TaskRef, http: ProviderHttp): Promise<ModulePollState> {
	const reading = await getInteraction(ref, http);
	return imageModelOf(ref.model) ? imageState(reading, http.endpoint) : stateOf(reading, http.endpoint);
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
		// Taken without an answer BaseHalf can read; Google updates the status after its clean-up.
	}
	return !ENDED.has(status);
}

// --- errors ------------------------------------------------------------------------------------

/** Words that name the free tier, as in `generate_content_free_tier_requests` or `FreeTier`. */
const FREE_TIER_WORDS = /free[\s_-]?tier/i;

/**
 * Google's words of an error answer: `{"error": {"code", "message"}}` with a
 * `snake_case` code, or the older shape with a numeric code and a `status`.
 * Every code the API errors page lists agrees with its HTTP status (402
 * `payment_required`, 429 `rate_limit_exceeded`, …), so the status decides,
 * except for a refusal that names the free tier: no model of this module is
 * offered there (Pricing), so the key needs a paid tier, and waiting, which a
 * 429 asks for, does not help.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	if (status >= 400 && status < 500 && FREE_TIER_WORDS.test(JSON.stringify(error ?? body) ?? '')) {
		return { message: TEXT.freeTier, code: 'auth' };
	}
	const message = error ? words(error.message) ?? words(error.code) ?? words(error.status) : undefined;
	return message ? { message } : readCommonError(body);
}

/**
 * The names of the inputs in a prompt (D74; Google, "Names in the prompt").
 * Gemini Omni reads the tags of its roles: `<FIRST_FRAME>`, `<LAST_FRAME>`,
 * and `<IMAGE_REF_0>` and `<VIDEO_REF_0>` for the references, counted from 0
 * by kind in the order they are sent. Its clip has no tag, and the image
 * models' prompts name images in words, so those take the shared names.
 */
function writePrompt(prompt: readonly PromptPart[], request: PromptContext): string {
	const language = promptLanguage(prompt);
	if (request.model !== MODEL_ID) {
		return writePromptNames(prompt, input => sharedPromptName(input, language));
	}
	return writePromptNames(prompt, input => {
		switch (input.input) {
			case 'startFrame': return '<FIRST_FRAME>';
			case 'endFrame': return '<LAST_FRAME>';
			case 'images': return `<IMAGE_REF_${input.index ?? 0}>`;
			case 'videos': return `<VIDEO_REF_${input.index ?? 0}>`;
			default: return sharedPromptName(input, language);
		}
	});
}

export const GOOGLE: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ 'x-goog-api-key': credentials.apiKey }),
	readError,
	writePrompt,
	check,
	submit,
	poll,
	videoLocation,
	cancel
});
