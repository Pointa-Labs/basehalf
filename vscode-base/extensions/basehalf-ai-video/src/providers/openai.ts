/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { measureItems } from './check.ts';
import { isRecord, readCommonError, rejected, unknownOutcome, type ProviderErrorReading } from './failure.ts';
import { DEFAULT_HTTP_OPTIONS, type FormPart, type ProviderHttp } from './http.ts';
import { bufferSource, describeBytes, measure, plannedItems, readMedia, type MediaFormat, type MediaInspector } from './media.ts';
import type { AnsweredAtOnce, OutputLocation, ProviderModule } from './module.ts';
import type { CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, CheckResult, OutputFormat, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * OpenAI's GPT Image models on OpenAI's own Image API (providers, "OpenAI").
 * The API answers a request with the images themselves, as base64: an image
 * made from the prompt alone is asked for as JSON at `/images/generations`,
 * and one made from reference images as a multipart form at `/images/edits`,
 * each image an `image[]` file. There is no task to poll or cancel, and no
 * video.
 */

type Resolution = '1k' | '2k' | '4k';
type Quality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

// --- the provider's English texts, in one place so they can be translated -----------------------

const MODEL_TEXTS = Object.freeze({
	'gpt-image-2.5-flare': { label: 'GPT Image 2.5 Flare', description: 'OpenAI\'s fast model for everyday images: up to 10 images from a prompt and up to 16 reference images. OpenAI calls its 2K and 4K sizes experimental.' },
	'gpt-image-2.5-sunburst': { label: 'GPT Image 2.5 Sunburst', description: 'OpenAI\'s model for when editing precision matters most: up to 10 images from a prompt and up to 16 reference images. OpenAI calls its 2K and 4K sizes experimental.' },
	'gpt-image-2': { label: 'GPT Image 2', description: 'OpenAI\'s earlier image model, with quality up to High and a transparent background in preview: up to 10 images from a prompt and up to 16 reference images. OpenAI calls its 2K and 4K sizes experimental.' }
});

const TEXT = Object.freeze({
	provider: 'OpenAI',
	region: 'Global',
	apiKey: 'API Key',
	reference: 'References',
	models: MODEL_TEXTS,
	parameters: {
		ratio: 'Ratio',
		ratioTooltip: 'The shape of the image. Adaptive lets OpenAI choose the shape and the size from the prompt; Resolution applies to the other shapes.',
		adaptive: 'Adaptive',
		resolution: 'Resolution',
		resolutions: { '1k': '1K', '2k': '2K', '4k': '4K' } satisfies Record<Resolution, string>,
		quality: 'Quality',
		qualityTooltip: 'How much effort and detail OpenAI spends on each image. Auto lets OpenAI choose.',
		qualities: { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', auto: 'Auto' } satisfies Record<Quality, string>,
		count: 'Images',
		countTooltip: 'How many images to make with one request.',
		background: 'Background',
		backgroundTooltip: 'Transparent makes a PNG with a transparent background. Auto lets OpenAI choose.',
		backgrounds: { opaque: 'Opaque', transparent: 'Transparent', auto: 'Auto' },
		moderation: 'Moderation',
		moderationTooltip: 'How strictly OpenAI filters what it makes. Low filters less; OpenAI takes it only for an image made from the prompt alone.',
		moderations: { auto: 'Auto', low: 'Low' }
	},
	moderationWithReferences: 'OpenAI takes Moderation Low only for an image made from the prompt alone: set Moderation to Auto, or disconnect the reference images.',
	requestTooLarge: (size: string, limit: string) => `The reference images make a request of ${size}; AI Video sends at most ${limit}. Use fewer or smaller images.`,
	imagesOnly: (label: string) => `${label} cannot be sent: GPT Image takes reference images only.`,
	imageFormat: (label: string) => `${label} is not a PNG, JPEG, or WebP image.`,
	noModel: (id: string) => `OpenAI has no model "${id}".`,
	noSize: (model: string) => `${model} has no size for these settings.`,
	noImageTask: (model: string) => `${model} answers with its images at once: there is no task to ask about.`,
	unreadableImage: 'OpenAI answered an image AI Video cannot read.',
	noImages: 'OpenAI accepted the request but answered no images AI Video can read.'
});

// --- the models --------------------------------------------------------------------------------

type ModelId = keyof typeof MODEL_TEXTS;

interface GptImage {
	/** The catalog's id, which is also the id sent: OpenAI's alias of its default snapshot. */
	readonly id: ModelId;
	readonly qualities: readonly Quality[];
}

const ALL_QUALITIES: readonly Quality[] = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'auto']);

const MODELS: readonly GptImage[] = Object.freeze([
	{ id: 'gpt-image-2.5-flare', qualities: ALL_QUALITIES },
	{ id: 'gpt-image-2.5-sunburst', qualities: ALL_QUALITIES },
	{ id: 'gpt-image-2', qualities: ['low', 'medium', 'high', 'auto'] }
] satisfies GptImage[]);

const MODELS_BY_ID: ReadonlyMap<string, GptImage> = new Map(MODELS.map(model => [model.id, model]));

// --- sizes -------------------------------------------------------------------------------------

/** The ratios of an image, in the order the panel shows them; Adaptive comes after them. */
const RATIOS = Object.freeze(['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9'] as const);
const RESOLUTIONS: readonly Resolution[] = Object.freeze(['1k', '2k', '4k']);
/** The area each resolution aims at: 1024², 2048², and 3840 × 2160. */
const TARGET_PIXELS: Readonly<Record<Resolution, number>> = Object.freeze({ '1k': 1024 * 1024, '2k': 2048 * 2048, '4k': 3840 * 2160 });

/** OpenAI's size rules: both sides multiples of 16, edges at most 3840, 655,360 to 8,294,400 pixels, at most 3:1. */
const SIDE_STEP = 16;
const MAX_EDGE = 3840;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_SHAPE = 3;

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

/**
 * The `size` of a ratio at a resolution: the width and height of exactly that
 * shape, multiples of 16 within OpenAI's size rules, whose area is closest to
 * the resolution's.
 */
function sizeOf(ratio: string, resolution: Resolution): string | undefined {
	const [across, down] = ratio.split(':').map(Number);
	if (!Number.isInteger(across) || !Number.isInteger(down) || across <= 0 || down <= 0) {
		return undefined;
	}
	const divisor = gcd(across, down);
	const [wide, high] = [across / divisor, down / divisor];
	// The smallest scale at which both sides are multiples of 16.
	const unitWide = SIDE_STEP / gcd(wide, SIDE_STEP);
	const unitHigh = SIDE_STEP / gcd(high, SIDE_STEP);
	const unit = unitWide * unitHigh / gcd(unitWide, unitHigh);
	const target = TARGET_PIXELS[resolution];
	let best: { readonly width: number; readonly height: number } | undefined;
	for (let scale = 1; ; scale++) {
		const width = wide * unit * scale;
		const height = high * unit * scale;
		if (Math.max(width, height) > MAX_EDGE || width * height > MAX_PIXELS) {
			break;
		}
		const fits = width * height >= MIN_PIXELS && Math.max(width, height) <= MAX_SHAPE * Math.min(width, height);
		if (fits && (!best || Math.abs(width * height - target) < Math.abs(best.width * best.height - target))) {
			best = { width, height };
		}
	}
	return best ? `${best.width}x${best.height}` : undefined;
}

// --- the catalog entry -------------------------------------------------------------------------

/** "Each image should be a png, webp, or jpg file less than 50MB." */
const IMAGE_MAX_BYTES = 50 * 1024 * 1024 - 1;
const MAX_REFERENCES = 16;
const MAX_IMAGES = 10;
const PROMPT_MAX_LENGTH = 32_000;
/** What AI Video sends in one request: OpenAI documents no limit of its own for an edit. */
const REQUEST_MAX_BYTES = DEFAULT_HTTP_OPTIONS.maxRequestBytes;

function parametersOf(model: GptImage): CatalogParameter[] {
	const labels = TEXT.parameters;
	const backgrounds = labels.backgrounds;
	const moderations = labels.moderations;
	return [
		{
			name: 'ratio',
			label: labels.ratio,
			tooltip: labels.ratioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: [...RATIOS.map(value => ({ value, label: value })), { value: 'adaptive', label: labels.adaptive }],
			default: 'adaptive'
		},
		{ name: 'resolution', label: labels.resolution, kind: 'choice', options: RESOLUTIONS.map(value => ({ value, label: labels.resolutions[value] })), default: '1k' },
		{ name: 'quality', label: labels.quality, tooltip: labels.qualityTooltip, kind: 'choice', options: model.qualities.map(value => ({ value, label: labels.qualities[value] })), default: 'auto' },
		{ name: 'count', label: labels.count, tooltip: labels.countTooltip, kind: 'integer', min: 1, max: MAX_IMAGES, step: 1, default: 1 },
		{
			name: 'background',
			label: labels.background,
			tooltip: labels.backgroundTooltip,
			kind: 'choice',
			options: [{ value: 'opaque', label: backgrounds.opaque }, { value: 'transparent', label: backgrounds.transparent }, { value: 'auto', label: backgrounds.auto }],
			default: 'auto'
		},
		{
			name: 'moderation',
			label: labels.moderation,
			tooltip: labels.moderationTooltip,
			kind: 'choice',
			options: [{ value: 'auto', label: moderations.auto }, { value: 'low', label: moderations.low }],
			default: 'auto',
			advanced: true
		}
	];
}

function catalogModel(model: GptImage): CatalogModel {
	const text = TEXT.models[model.id];
	const none = { min: 0, max: 0 };
	return {
		id: model.id,
		kind: 'image',
		label: text.label,
		description: text.description,
		providerModels: { global: model.id },
		prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
		modes: [{
			id: 'reference',
			label: TEXT.reference,
			inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: MAX_REFERENCES }, videos: none, audios: none, source: 'none' },
			limits: { imageMaxBytes: IMAGE_MAX_BYTES }
		}],
		parameters: parametersOf(model),
		// Always asked for: a transparent background needs PNG or WebP.
		outputFormat: 'png',
		answersAtOnce: true
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'openai',
	label: TEXT.provider,
	regions: [{ id: 'global', label: TEXT.region, baseUrl: 'https://api.openai.com/v1', console: 'https://platform.openai.com/settings/organization/api-keys' }],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODELS.map(catalogModel)
});

// --- rules -------------------------------------------------------------------------------------

function modelOf(id: string): GptImage {
	const model = MODELS_BY_ID.get(id);
	if (!model) {
		throw rejected(TEXT.noModel(id));
	}
	return model;
}

/** The bytes of a form besides its images: the text fields, the prompt, and the boundaries. */
function formOverhead(prompt: string): number {
	return Buffer.byteLength(prompt, 'utf8') + 4096;
}

async function check(request: CheckRequest, media: MediaInspector): Promise<CheckResult> {
	modelOf(request.model);
	const problems: string[] = [];
	if (!request.inputs.images.length) {
		return { problems };
	}
	// OpenAI's multipart edits take no `moderation`.
	if (request.params.moderation === 'low') {
		problems.push(TEXT.moderationWithReferences);
	}
	let size = formOverhead(request.prompt);
	for (const item of await measureItems(request.inputs, media)) {
		size += item.facts.bytes + 256;
	}
	if (size > REQUEST_MAX_BYTES) {
		problems.push(TEXT.requestTooLarge(describeBytes(size), describeBytes(REQUEST_MAX_BYTES)));
	}
	return { problems };
}

// --- requests ----------------------------------------------------------------------------------

const IMAGE_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });
const EXTENSIONS: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp' });
const OUTPUT_FORMATS: ReadonlySet<string> = new Set<OutputFormat>(['png', 'jpeg', 'webp']);

/** The reference images as `image[]` file parts, in the order of the inputs. */
async function imageParts(request: SubmitRequest): Promise<FormPart[]> {
	const parts: FormPart[] = [];
	for (const item of plannedItems(request.inputs)) {
		if (item.slot !== 'image') {
			throw rejected(TEXT.imagesOnly(item.label));
		}
		const read = await readMedia(item.media, IMAGE_MAX_BYTES, item.label);
		const { format } = await measure(bufferSource(read.bytes));
		const type = format ? IMAGE_TYPES[format] : undefined;
		if (!format || !type) {
			throw rejected(TEXT.imageFormat(item.label));
		}
		parts.push({ name: 'image[]', file: { bytes: read.bytes, fileName: `image-${item.index + 1}.${EXTENSIONS[format]}`, contentType: type } });
	}
	return parts;
}

/**
 * Sends the request once and answers its images: a generation as JSON
 * without reference images, an edit as a multipart form with them.
 */
async function submit(request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	const model = modelOf(request.model);
	const params = request.params;
	const size = params.ratio === 'adaptive' ? 'auto' : sizeOf(String(params.ratio), params.resolution as Resolution);
	if (!size) {
		// The declarations' checks refuse a value the model does not offer.
		throw rejected(TEXT.noSize(TEXT.models[model.id].label));
	}
	const fields: Record<string, string | number> = {
		model: model.id,
		prompt: request.prompt,
		n: Number(params.count),
		size,
		quality: String(params.quality),
		background: String(params.background),
		output_format: 'png'
	};
	const images = await imageParts(request);
	const answer = images.length
		// Moderation is not a field of a multipart edit; `check` refuses Low with references.
		? await http.create({ method: 'POST', path: '/images/edits', body: { kind: 'form', parts: [...Object.entries(fields).map(([name, value]) => ({ name, value: String(value) })), ...images] } })
		: await http.create({ method: 'POST', path: '/images/generations', body: { kind: 'json', value: { ...fields, moderation: params.moderation } } });
	return { outputs: outputsOf(answer.object()) };
}

/** The images of an answer, in OpenAI's order: base64 files, or the addresses a relay may give. */
function outputsOf(object: Record<string, unknown>): OutputLocation[] {
	const data = object.data;
	if (!Array.isArray(data)) {
		throw unknownOutcome(TEXT.noImages);
	}
	const format: OutputFormat = typeof object.output_format === 'string' && OUTPUT_FORMATS.has(object.output_format) ? object.output_format as OutputFormat : 'png';
	return data.map((entry): OutputLocation => {
		if (isRecord(entry) && typeof entry.b64_json === 'string' && entry.b64_json) {
			return { bytes: Buffer.from(entry.b64_json, 'base64'), format };
		}
		if (isRecord(entry) && typeof entry.url === 'string' && entry.url) {
			return { url: entry.url };
		}
		return { refused: TEXT.unreadableImage };
	});
}

async function poll(ref: TaskRef): Promise<PollState> {
	throw rejected(TEXT.noImageTask(TEXT.models[modelOf(ref.model).id].label));
}

async function cancel(): Promise<boolean> {
	// The request answered with the images: there is nothing to cancel.
	return false;
}

// --- errors ------------------------------------------------------------------------------------

/** The codes of a 429 that an empty balance or a limit of spending causes; retrying does not help. */
const BALANCE_CODES: ReadonlySet<string> = new Set(['credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']);

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Reads `{error: {message, type, code}}`. The codes refine a 4xx answer only,
 * so that a server error leaves the outcome of a create unknown; a blocked
 * prompt or image is a 400, which is refused by its status.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	const code = textOf(error?.code);
	const message = textOf(error?.message) ?? readCommonError(body)?.message ?? code;
	if (!message) {
		return undefined;
	}
	if (status >= 400 && status < 500 && status !== 408 && ((code && BALANCE_CODES.has(code)) || textOf(error?.type) === 'insufficient_quota')) {
		return { message, code: 'balance' };
	}
	return { message };
}

export const OPENAI: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
	readError,
	check,
	submit,
	poll,
	cancel
});
