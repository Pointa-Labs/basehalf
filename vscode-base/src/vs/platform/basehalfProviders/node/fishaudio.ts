/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import type { HttpAnswer, ProviderHttp } from './http.js';
import type { AnsweredAtOnce, ModuleCheckResult, ModuleVoices, ProviderModule } from './module.js';
import type { CatalogModel, CatalogParameter, CatalogProvider, CatalogVoiceOption, CheckRequest, ListedVoice, PollState, SubmitRequest, TaskRef, VoicesRequest } from '../common/basehalfProviderTypes.js';

/**
 * Fish Audio's speech models on Fish Audio's own API
 * (`docs/specs/providers/fishaudio.md`, D78). Every model is
 * `POST /v1/tts` with the model in the `model` header, which is always sent,
 * since Fish Audio serves a missing or unknown model as S2.1 Pro without an
 * error; it is asked for MP3 at 192 kbps and answers at once with the file.
 * The voices are listed with `GET /model`: the account's own, then the
 * voices of Fish Audio's library whose rights Fish Audio secured, each with
 * the address of its sample.
 */

// --- the provider's English texts, in one place so they can be translated -----------------------

const MODEL_TEXTS = Object.freeze({
	'drama-3': { label: 'Drama 3', description: 'Fish Audio\'s speech that you direct in plain words, such as [barely holding it together] before a line, with sounds, pauses, and tags for single words.' },
	's2.1-pro': { label: 'S2.1 Pro', description: 'Fish Audio\'s recommended speech: 83 languages, expression in brackets such as [whispers sweetly].' },
	's2-pro': { label: 'S2 Pro', description: 'Fish Audio\'s previous S2 speech: more than 80 languages, expression in brackets.' }
});

const TEXT = Object.freeze({
	provider: 'Fish Audio',
	region: 'Global',
	apiKey: 'API Key',
	mode: 'Speech',
	models: MODEL_TEXTS,
	parameters: {
		voice: 'Voice',
		speed: 'Speed',
		speedTooltip: 'How fast the voice speaks: 1 is its own pace, from 0.5 to 2.',
		temperature: 'Temperature',
		temperatureTooltip: 'How varied the delivery is: higher is more expressive, lower more consistent.',
		topP: 'Top P',
		topPTooltip: 'How wide a choice of sounds Fish Audio samples from: lower is more predictable.'
	},
	noModel: (id: string) => `Fish Audio has no model "${id}".`,
	noTask: (model: string) => `${model} answers with its sound at once: there is no task to ask about.`,
	noSound: 'Fish Audio accepted the request but answered no sound.',
	unreadableVoices: 'Fish Audio answered voices BaseHalf cannot read.',
	noVoice: (id: string, said: string) => `Fish Audio has no voice "${id}" that this account can use: choose another voice. Fish Audio says: ${said}`,
	voiceRefused: (id: string, said: string) => `Fish Audio does not let this key use the voice "${id}": choose another voice. Fish Audio says: ${said}`,
	concurrent: (said: string) => `Fish Audio is already running as many requests of this account at once as it allows: wait for them to finish, then generate again. Fish Audio says: ${said}`
});

// --- the voices of the catalog --------------------------------------------------------------------

/** The voice the model speaks in when a request names none: the module sends no `reference_id` for it. */
const DEFAULT_VOICE = 'default';

/** The default, and the public voices of Fish Audio's Drama 3 page, which any account uses by their ids. */
const VOICES: readonly CatalogVoiceOption[] = Object.freeze([
	{ value: DEFAULT_VOICE, label: 'Default Voice', description: 'The voice the model speaks in when none is chosen' },
	{ value: 'bf322df2096a46f18c579d0baa36f41d', label: 'Adrian', description: 'American English, male' },
	{ value: 'c70cfb98867a4bfb9ae20d2401257b92', label: 'Delia', description: 'American English, female' },
	{ value: 'f3a2b90078d54a65af4b95f63bc7798e', label: 'Sheila', description: 'American English, female' }
]);

// --- the models and the catalog entry ------------------------------------------------------------

type ModelId = keyof typeof MODEL_TEXTS;

/** The catalog's ids are Fish Audio's `model` headers. */
const MODEL_IDS: readonly ModelId[] = Object.freeze(['drama-3', 's2.1-pro', 's2-pro']);

/**
 * Fish Audio states no longest text for `/v1/tts`; its own app takes at most
 * 30,000 characters in one generation, which BaseHalf takes as its bound.
 */
const PROMPT_MAX_LENGTH = 30_000;

/** The highest MP3 bitrate Fish Audio offers; it names no plan that may not ask for it. */
const MP3_BITRATE = 192;

const PARAMETERS: readonly CatalogParameter[] = (() => {
	const labels = TEXT.parameters;
	return Object.freeze<CatalogParameter[]>([
		{ name: 'voice', label: labels.voice, kind: 'voice', options: VOICES, default: DEFAULT_VOICE, listed: true },
		{ name: 'speed', label: labels.speed, tooltip: labels.speedTooltip, kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1 },
		{ name: 'temperature', label: labels.temperature, tooltip: labels.temperatureTooltip, kind: 'number', min: 0, max: 1, step: 0.01, default: 0.7, advanced: true },
		{ name: 'top_p', label: labels.topP, tooltip: labels.topPTooltip, kind: 'number', min: 0, max: 1, step: 0.01, default: 0.7, advanced: true }
	]);
})();

function catalogModel(id: ModelId): CatalogModel {
	const text = TEXT.models[id];
	const none = { min: 0, max: 0 };
	return {
		id,
		kind: 'audio',
		makes: 'speech',
		label: text.label,
		description: text.description,
		providerModels: { global: id },
		prompt: { required: 'always', maxLength: PROMPT_MAX_LENGTH },
		modes: [{
			id: 'reference',
			label: TEXT.mode,
			inputs: { startFrame: 'none', endFrame: 'none', images: none, videos: none, audios: none, source: 'none' },
			limits: {}
		}],
		parameters: [...PARAMETERS],
		outputFormat: 'mp3',
		answersAtOnce: true
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'fishaudio',
	label: TEXT.provider,
	regions: [{ id: 'global', label: TEXT.region, baseUrl: 'https://api.fish.audio', console: 'https://fish.audio/app/api-keys/' }],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODEL_IDS.map(catalogModel)
});

// --- requests ----------------------------------------------------------------------------------

function modelOf(id: string): ModelId {
	const model = MODEL_IDS.find(candidate => candidate === id);
	if (!model) {
		throw rejected(TEXT.noModel(id));
	}
	return model;
}

async function check(request: CheckRequest): Promise<ModuleCheckResult> {
	// The declarations hold every rule: no two settings depend on each other.
	modelOf(request.model);
	return { problems: [] };
}

/** A 400 of Fish Audio whose message says that what was named does not exist. */
const NOT_FOUND = /not\s+found|not\s+exist/i;

/**
 * A refusal of a request that names a voice, said plainly: a 404 is the
 * voice, since an unknown model never fails, a 400 is the voice when Fish
 * Audio's message says it is not found, and a 403 refuses the voice to the
 * key. Any other failure stays as it is.
 */
function voiceFailure(error: unknown, voice: string | undefined): unknown {
	if (voice === undefined || !(error instanceof ProviderFailure) || error.code === 'unknownOutcome') {
		return error;
	}
	if (error.status === 404 || (error.status === 400 && NOT_FOUND.test(error.message))) {
		return rejected(TEXT.noVoice(voice, error.message), error.status);
	}
	if (error.status === 403) {
		return rejected(TEXT.voiceRefused(voice, error.message), error.status);
	}
	return error;
}

/** Sends the request once and answers its one sound, the MP3 that Fish Audio answers with. */
async function submit(request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	const model = modelOf(request.model);
	const params = request.params;
	const voice = typeof params.voice === 'string' && params.voice !== DEFAULT_VOICE ? params.voice : undefined;
	let answer: HttpAnswer;
	try {
		answer = await http.create({
			method: 'POST',
			path: '/v1/tts',
			// Always sent: a missing or unknown model is served, and billed, as S2.1 Pro.
			headers: { model, Accept: 'audio/mpeg' },
			body: {
				kind: 'json',
				value: {
					text: request.prompt,
					...(voice !== undefined ? { reference_id: voice } : {}),
					prosody: { speed: params.speed },
					temperature: params.temperature,
					top_p: params.top_p,
					format: 'mp3',
					mp3_bitrate: MP3_BITRATE,
					// The guide and the API reference disagree on the default; `normal` is "best quality".
					latency: 'normal'
				}
			}
		});
	} catch (error) {
		throw voiceFailure(error, voice);
	}
	if (!answer.body.byteLength) {
		throw unknownOutcome(TEXT.noSound);
	}
	return { outputs: [{ bytes: answer.body, format: 'mp3' }] };
}

async function poll(ref: TaskRef): Promise<PollState> {
	throw rejected(TEXT.noTask(TEXT.models[modelOf(ref.model)].label));
}

async function cancel(): Promise<boolean> {
	// The request answered with the sound: there is nothing to cancel.
	return false;
}

// --- voices ------------------------------------------------------------------------------------

const VOICES_PAGE_SIZE = 100;

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringsOf(value: unknown): string[] {
	return Array.isArray(value) ? value.map(textOf).filter((entry): entry is string => entry !== undefined) : [];
}

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });

/** The English name of a language code, `en` is English; the code itself when it names none. */
function languageName(code: string): string {
	try {
		return LANGUAGE_NAMES.of(code) ?? code;
	} catch {
		return code;
	}
}

/** The first letter in upper case: Fish Audio's tags are written as they were typed. */
function capitalized(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Its languages and tags, as "English, Japanese · Male, Narration", or its own description. */
function descriptionOf(model: Record<string, unknown>): string | undefined {
	const parts = [
		stringsOf(model.languages).map(languageName).join(', '),
		stringsOf(model.tags).map(capitalized).join(', ')
	].filter(part => part.length > 0);
	return parts.length ? parts.join(' · ') : textOf(model.description);
}

/** A voice model of `GET /model`: one of speech, ready, and not taken down. */
function listedVoice(value: unknown, own: boolean): ListedVoice | undefined {
	if (!isRecord(value) || typeof value._id !== 'string') {
		return undefined;
	}
	if ((value.type !== undefined && value.type !== 'tts') || (value.state !== undefined && value.state !== 'trained')
		|| value.dmca_taken_down === true || textOf(value.takedown_category) !== undefined) {
		return undefined;
	}
	const description = descriptionOf(value);
	// A sample's `audio` is a "URL or path"; a path's host is not documented.
	const sample = Array.isArray(value.samples)
		? value.samples.map(entry => isRecord(entry) ? textOf(entry.audio) : undefined).find(audio => audio !== undefined && /^https?:\/\//i.test(audio))
		: undefined;
	return {
		id: value._id,
		label: textOf(value.title) ?? '',
		...(description !== undefined ? { description } : {}),
		own,
		...(sample !== undefined ? { sample } : {})
	};
}

/** Whether a page of `GET /model` has more after it: `has_more`, or without it, a `total` above what the pages held. */
function hasMore(answer: Record<string, unknown>, page: number, count: number): boolean {
	if (count === 0) {
		return false;
	}
	if (typeof answer.has_more === 'boolean') {
		return answer.has_more;
	}
	return typeof answer.total === 'number' ? page * VOICES_PAGE_SIZE < answer.total : count >= VOICES_PAGE_SIZE;
}

interface ListedPages {
	readonly voices: ListedVoice[];
	/** Fish Audio had more than `room` voices, or did not serve a later page. */
	readonly more: boolean;
}

/**
 * The voices of `GET /model` with `query`, page after page until Fish Audio
 * has no more or more than `room` are listed. `later`: a page refused after
 * the first ends the list there, as having more.
 */
async function listPages(http: ProviderHttp, query: Readonly<Record<string, string | number | boolean>>, room: number, own: boolean, later: 'fail' | 'end'): Promise<ListedPages> {
	const voices: ListedVoice[] = [];
	// More pages than `room` voices take; a page holds at most 100.
	const pages = Math.ceil((room + 1) / VOICES_PAGE_SIZE) + 1;
	for (let page = 1; page <= pages; page++) {
		let answer: Record<string, unknown>;
		try {
			answer = (await http.request({ method: 'GET', path: '/model', query: { ...query, page_size: VOICES_PAGE_SIZE, page_number: page } })).object();
		} catch (error) {
			if (later === 'end' && page > 1 && error instanceof ProviderFailure) {
				return { voices, more: true };
			}
			throw error;
		}
		if (!Array.isArray(answer.items)) {
			throw unreadable(TEXT.unreadableVoices);
		}
		for (const item of answer.items) {
			const voice = listedVoice(item, own);
			if (voice) {
				voices.push(voice);
			}
		}
		const more = hasMore(answer, page, answer.items.length);
		if (voices.length > room || (more && voices.length >= room)) {
			return { voices: voices.slice(0, room), more: true };
		}
		if (!more) {
			return { voices, more: false };
		}
	}
	return { voices: voices.slice(0, room), more: true };
}

/**
 * The account's voices, every page, then the voices of Fish Audio's library
 * whose rights Fish Audio secured, best first, while the list holds fewer
 * than `limit`.
 */
async function listVoices(_request: VoicesRequest, http: ProviderHttp, limit: number): Promise<ModuleVoices> {
	const own = await listPages(http, { self: true }, limit, true, 'fail');
	if (own.more || own.voices.length >= limit) {
		// No room is left for the library, which has voices of its own.
		return { voices: own.voices, truncated: true };
	}
	const library = await listPages(http, { licensed: true, sort_by: 'score' }, limit - own.voices.length, false, 'end');
	return { voices: [...own.voices, ...library.voices], ...(library.more ? { truncated: true } : {}) };
}

// --- errors ------------------------------------------------------------------------------------

/**
 * Reads `{message, status}`, the shape of every error of Fish Audio. The
 * statuses decide the codes; a 429 says what Fish Audio's limit is.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const reading = readCommonError(body);
	if (status === 429) {
		return { message: TEXT.concurrent(reading?.message ?? 'Too many requests.') };
	}
	return reading;
}

export const FISH_AUDIO: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
	readError,
	check,
	submit,
	poll,
	cancel,
	listVoices
});
