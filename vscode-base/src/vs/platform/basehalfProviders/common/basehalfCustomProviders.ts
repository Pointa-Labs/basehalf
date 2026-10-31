/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isVoiceId } from './basehalfProviderVoices.js';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CountSlot, CustomModelDefinition, CustomProviderDefinition, ModelKind } from './basehalfProviderTypes.js';

/**
 * Custom providers (D108; providers, "Custom providers"): a provider that
 * BaseHalf does not integrate, which the user adds with a name, an API
 * address, a key, and the ids of its models. Its models are called in the
 * format of their card type, which many relays and providers share: images
 * in OpenAI's Image API, videos in the video API that relays share, and
 * speech in OpenAI's speech API.
 *
 * What the user entered is a `CustomProviderDefinition` (`basehalfProviderTypes.ts`).
 * The window keeps it, adds the provider to its catalog with
 * {@link describeCustomProvider}, and sends it with every call for the
 * provider; the provider service reads it with
 * {@link parseCustomProviderDefinition} and builds the provider's module from
 * it for that call. Both use these functions, so the window and the service
 * see the same entry.
 */

/** The one region of a custom provider, whose base URL is its API address. */
export const CUSTOM_PROVIDER_REGION = 'custom';
export const CUSTOM_PROVIDER_ID_PATTERN = /^custom-[0-9a-f]{8}$/;
export const MAX_CUSTOM_PROVIDER_LABEL_LENGTH = 64;
export const MAX_CUSTOM_MODELS = 64;
export const MAX_CUSTOM_VOICES = 64;
export const MAX_CUSTOM_ADDRESS_LENGTH = 2048;
/** "1 to 256 characters without spaces", as every id a provider is sent. */
const SERVICE_MODEL_ID = /^\S{1,256}$/;
/** The six voices that every model of OpenAI's speech API has. */
export const DEFAULT_CUSTOM_VOICES: readonly string[] = Object.freeze(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

const MODEL_KINDS: readonly ModelKind[] = Object.freeze(['image', 'video', 'audio']);
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/** Whether an id is that of a custom provider. */
export function isCustomProviderId(id: string): boolean {
	return CUSTOM_PROVIDER_ID_PATTERN.test(id);
}

/** What the user entered breaks a rule of a custom provider; the message says which. */
export class CustomProviderDefinitionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CustomProviderDefinitionError';
	}
}

function refuse(message: string): never {
	throw new CustomProviderDefinitionError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[(?<inner>.*)\]$/, '$<inner>');
	return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Why an API address cannot be one, or nothing: the rules of an endpoint, an
 * `https` address, or an `http` one on this computer, without a user name, a
 * password, a query, a fragment, or a trailing slash.
 */
export function customProviderAddressProblem(address: string): string | undefined {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return 'The API address is not a complete address.';
	}
	if (address.length > MAX_CUSTOM_ADDRESS_LENGTH) {
		return `The API address is longer than ${MAX_CUSTOM_ADDRESS_LENGTH} characters.`;
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
		return 'Use an API address that starts with https://. An address with http:// is allowed only on this computer (localhost), because the key would travel unencrypted.';
	}
	if (url.username || url.password || url.search || url.hash || address.includes('?') || address.includes('#')) {
		return 'The API address must have no user name, password, query, or fragment.';
	}
	if (address.endsWith('/')) {
		return 'The API address must not end with a slash.';
	}
	return undefined;
}

/**
 * Reads what the user entered for a custom provider, as the window stores it
 * and as a request carries it. Throws {@link CustomProviderDefinitionError},
 * naming the rule, for anything else: an id that is not `custom-` and eight
 * hexadecimal digits, a name that is empty or longer than 64 characters, an
 * address that {@link customProviderAddressProblem} refuses, no model or more
 * than 64, a model id with a space or longer than 256 characters, the same id
 * twice or two ids that make the same id of the catalog, a card type that is
 * not image, video, or audio, and a voice id that cannot be one.
 */
export function parseCustomProviderDefinition(value: unknown): CustomProviderDefinition {
	if (!isRecord(value)) {
		refuse('A custom provider must be an object.');
	}
	const id = value.id;
	if (typeof id !== 'string' || !isCustomProviderId(id)) {
		refuse('The id of a custom provider must be custom- and eight hexadecimal digits.');
	}
	const label = typeof value.label === 'string' ? value.label.trim() : '';
	if (!label || [...label].length > MAX_CUSTOM_PROVIDER_LABEL_LENGTH || CONTROL_CHARACTERS.test(label)) {
		refuse(`The name of a custom provider must be 1 to ${MAX_CUSTOM_PROVIDER_LABEL_LENGTH} characters of plain text.`);
	}
	const baseUrl = value.baseUrl;
	if (typeof baseUrl !== 'string') {
		refuse('A custom provider needs its API address.');
	}
	const addressProblem = customProviderAddressProblem(baseUrl);
	if (addressProblem) {
		refuse(addressProblem);
	}
	if (!Array.isArray(value.models) || !value.models.length) {
		refuse('A custom provider needs at least one model.');
	}
	if (value.models.length > MAX_CUSTOM_MODELS) {
		refuse(`A custom provider has at most ${MAX_CUSTOM_MODELS} models.`);
	}
	const models: CustomModelDefinition[] = [];
	const ids = new Set<string>();
	const catalogIds = new Set<string>();
	for (const entry of value.models) {
		if (!isRecord(entry) || typeof entry.id !== 'string' || !SERVICE_MODEL_ID.test(entry.id)) {
			refuse('The id of a model must be 1 to 256 characters without spaces.');
		}
		const kind = MODEL_KINDS.find(candidate => candidate === entry.kind);
		if (!kind) {
			refuse(`The card type of ${entry.id} must be image, video, or audio.`);
		}
		const catalogId = customModelCatalogId(entry.id);
		if (ids.has(entry.id) || catalogIds.has(catalogId)) {
			refuse(`The model ${entry.id} is listed twice.`);
		}
		ids.add(entry.id);
		catalogIds.add(catalogId);
		models.push(Object.freeze({ id: entry.id, kind }));
	}
	let voices: string[] | undefined;
	if (value.voices !== undefined) {
		if (!Array.isArray(value.voices) || value.voices.length > MAX_CUSTOM_VOICES) {
			refuse(`A custom provider has at most ${MAX_CUSTOM_VOICES} voices.`);
		}
		voices = [];
		for (const voice of value.voices) {
			if (typeof voice !== 'string' || !isVoiceId(voice) || /\s/.test(voice)) {
				refuse('The id of a voice must be 1 to 256 characters without spaces.');
			}
			if (!voices.includes(voice)) {
				voices.push(voice);
			}
		}
	}
	return Object.freeze({
		id,
		label,
		baseUrl,
		models: Object.freeze(models),
		...(voices?.length ? { voices: Object.freeze(voices) } : {})
	});
}

/** Six hexadecimal digits of a text: FNV-1a over its UTF-16 code units, kept to 24 bits. */
function shortHash(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return (hash & 0xffffff).toString(16).padStart(6, '0');
}

/**
 * The id of the catalog of a custom model, made from the id its service gives
 * it: in lower case, with every character that is not a letter, a digit, a
 * dot, a hyphen, or an underscore as a hyphen, with an `m` before one that
 * does not start with a letter or a digit, cut to 56 characters, and, when
 * that changed it, a hyphen and six hexadecimal digits of the service's id,
 * so that two ids never meet. The same id gives the same id each time.
 */
export function customModelCatalogId(serviceId: string): string {
	let id = serviceId.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
	if (!/^[a-z0-9]/.test(id)) {
		id = `m${id}`;
	}
	id = id.slice(0, 56);
	return id === serviceId ? id : `${id}-${shortHash(serviceId)}`;
}

// --- the entry of the catalog -------------------------------------------------------------------

const TEXT = Object.freeze({
	region: 'Custom',
	apiKey: 'API Key',
	references: 'References',
	frames: 'Frames',
	fromText: 'From Text',
	imageDescription: (provider: string) => `An image model of ${provider}, called in OpenAI's Image API format. It offers that format's settings; ${provider} decides which it takes.`,
	videoDescription: (provider: string) => `A video model of ${provider}, called in the video format that relays share. It offers that format's settings; ${provider} decides which it takes.`,
	speechDescription: (provider: string) => `A speech model of ${provider}, called in OpenAI's speech API format. It offers that format's settings; ${provider} decides which it takes.`,
	parameters: {
		ratio: 'Ratio',
		imageRatioTooltip: 'The shape of the image: 1:1 is 1024 × 1024, 3:2 is 1536 × 1024, and 2:3 is 1024 × 1536. Adaptive sends no size and lets the provider choose.',
		adaptive: 'Adaptive',
		quality: 'Quality',
		qualityTooltip: 'How much effort and detail the provider spends on each image. Auto sends no quality and lets the provider choose.',
		qualities: { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' },
		count: 'Images',
		countTooltip: 'How many images to make with one request.',
		duration: 'Duration',
		resolution: 'Resolution',
		videoRatioTooltip: 'The shape of the video. With the resolution, it gives the width and the height that are sent.',
		seed: 'Seed',
		seedTooltip: 'The same seed with the same request gives a similar video. Leave it empty for a new one each time.',
		voice: 'Voice',
		speed: 'Speed',
		speedTooltip: 'How fast the voice speaks: 1 is its own pace.'
	}
});

const NO_SLOT: CountSlot = Object.freeze({ min: 0, max: 0 });

/** The sizes of OpenAI's Image API, by the shared ratio that names each shape. */
export const CUSTOM_IMAGE_SIZES: Readonly<Record<string, string>> = Object.freeze({ '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' });
/** "Each image should be a png, webp, or jpg file less than 50MB." */
export const CUSTOM_IMAGE_MAX_BYTES = 50 * 1024 * 1024 - 1;
const CUSTOM_IMAGE_MAX_REFERENCES = 16;
const CUSTOM_IMAGE_MAX_COUNT = 4;
const CUSTOM_IMAGE_PROMPT_LENGTH = 32_000;

/** The short side of a video for each resolution. */
export const CUSTOM_VIDEO_SHORT_SIDES: Readonly<Record<string, number>> = Object.freeze({ '480p': 480, '720p': 720, '1080p': 1080 });
const CUSTOM_VIDEO_RATIOS: readonly string[] = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);
/** A start frame travels inside the JSON of the request, as a data URL. */
export const CUSTOM_VIDEO_FRAME_MAX_BYTES = 10 * 1024 * 1024;
const CUSTOM_VIDEO_PROMPT_LENGTH = 4000;

/** "The maximum length is 4096 characters." */
const CUSTOM_SPEECH_PROMPT_LENGTH = 4096;

/**
 * The width and the height of a video for a resolution and a ratio: the short
 * side is the resolution's number, the long side that times the ratio, rounded
 * to an even number (720p at 16:9 is 1280 × 720).
 */
export function customVideoSize(resolution: string, ratio: string): { readonly width: number; readonly height: number } | undefined {
	const short = CUSTOM_VIDEO_SHORT_SIDES[resolution];
	const [across, down] = ratio.split(':').map(Number);
	if (!short || !Number.isInteger(across) || !Number.isInteger(down) || across <= 0 || down <= 0) {
		return undefined;
	}
	const long = Math.round(short * Math.max(across, down) / Math.min(across, down) / 2) * 2;
	return across >= down ? { width: long, height: short } : { width: short, height: long };
}

function imageParameters(): CatalogParameter[] {
	const labels = TEXT.parameters;
	return [
		{
			name: 'ratio',
			label: labels.ratio,
			tooltip: labels.imageRatioTooltip,
			kind: 'choice',
			display: 'ratio',
			options: [...Object.keys(CUSTOM_IMAGE_SIZES).map(value => ({ value, label: value })), { value: 'adaptive', label: labels.adaptive }],
			default: 'adaptive'
		},
		{
			name: 'quality',
			label: labels.quality,
			tooltip: labels.qualityTooltip,
			kind: 'choice',
			options: (['auto', 'low', 'medium', 'high'] as const).map(value => ({ value, label: labels.qualities[value] })),
			default: 'auto'
		},
		{ name: 'count', label: labels.count, tooltip: labels.countTooltip, kind: 'integer', min: 1, max: CUSTOM_IMAGE_MAX_COUNT, step: 1, default: 1 }
	];
}

function videoParameters(): CatalogParameter[] {
	const labels = TEXT.parameters;
	return [
		{ name: 'duration', label: labels.duration, kind: 'integer', unit: 'seconds', min: 1, max: 20, step: 1, default: 5 },
		{ name: 'resolution', label: labels.resolution, kind: 'choice', options: Object.keys(CUSTOM_VIDEO_SHORT_SIDES).map(value => ({ value, label: value })), default: '720p' },
		{ name: 'ratio', label: labels.ratio, tooltip: labels.videoRatioTooltip, kind: 'choice', display: 'ratio', options: CUSTOM_VIDEO_RATIOS.map(value => ({ value, label: value })), default: '16:9' },
		{ name: 'seed', label: labels.seed, tooltip: labels.seedTooltip, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true }
	];
}

function speechParameters(voices: readonly string[]): CatalogParameter[] {
	const labels = TEXT.parameters;
	return [
		{ name: 'voice', label: labels.voice, kind: 'voice', options: voices.map(value => ({ value, label: value })), default: voices[0], listed: false },
		{ name: 'speed', label: labels.speed, tooltip: labels.speedTooltip, kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1 }
	];
}

function catalogModel(model: CustomModelDefinition, definition: CustomProviderDefinition): CatalogModel {
	const common = {
		id: customModelCatalogId(model.id),
		label: model.id,
		providerModels: { [CUSTOM_PROVIDER_REGION]: model.id }
	};
	switch (model.kind) {
		case 'image': {
			const mode: CatalogMode = {
				id: 'reference',
				label: TEXT.references,
				inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: CUSTOM_IMAGE_MAX_REFERENCES }, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
				limits: { imageMaxBytes: CUSTOM_IMAGE_MAX_BYTES }
			};
			return {
				...common,
				kind: 'image',
				description: TEXT.imageDescription(definition.label),
				prompt: { required: 'always', maxLength: CUSTOM_IMAGE_PROMPT_LENGTH },
				modes: [mode],
				parameters: imageParameters(),
				outputFormat: 'png',
				answersAtOnce: true
			};
		}
		case 'video': {
			const mode: CatalogMode = {
				id: 'frames',
				label: TEXT.frames,
				inputs: { startFrame: 'optional', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
				limits: { imageMaxBytes: CUSTOM_VIDEO_FRAME_MAX_BYTES }
			};
			return {
				...common,
				kind: 'video',
				description: TEXT.videoDescription(definition.label),
				prompt: { required: 'withoutMedia', maxLength: CUSTOM_VIDEO_PROMPT_LENGTH },
				modes: [mode],
				parameters: videoParameters()
			};
		}
		case 'audio': {
			const mode: CatalogMode = {
				id: 'reference',
				label: TEXT.fromText,
				inputs: { startFrame: 'none', endFrame: 'none', images: NO_SLOT, videos: NO_SLOT, audios: NO_SLOT, source: 'none' },
				limits: {}
			};
			return {
				...common,
				kind: 'audio',
				makes: 'speech',
				description: TEXT.speechDescription(definition.label),
				prompt: { required: 'always', maxLength: CUSTOM_SPEECH_PROMPT_LENGTH },
				modes: [mode],
				parameters: speechParameters(definition.voices?.length ? definition.voices : DEFAULT_CUSTOM_VOICES),
				outputFormat: 'mp3',
				answersAtOnce: true
			};
		}
	}
}

/**
 * The entry of the catalog of a custom provider: its id and its name, one
 * region, Custom, at its API address, without a console, one credential, the
 * API Key, and each model under {@link customModelCatalogId} of the id its
 * service gives it, labeled with that id, with the settings of its format.
 */
export function describeCustomProvider(definition: CustomProviderDefinition): CatalogProvider {
	return {
		id: definition.id,
		label: definition.label,
		regions: [{ id: CUSTOM_PROVIDER_REGION, label: TEXT.region, baseUrl: definition.baseUrl }],
		credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
		models: definition.models.map(model => catalogModel(model, definition))
	};
}
