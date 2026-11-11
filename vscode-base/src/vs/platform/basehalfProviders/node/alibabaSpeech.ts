/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { apiPath, RATE_LIMIT_NOTE, readAlibabaError, refusedCreate } from './alibabaApi.js';
import { QWEN_AUDIO_30_FLASH_DEFAULT_VOICE, QWEN_AUDIO_30_FLASH_VOICES, QWEN_AUDIO_30_PLUS_DEFAULT_VOICE, QWEN_AUDIO_30_PLUS_VOICES, QWEN_AUDIO_31_DEFAULT_VOICE, QWEN_AUDIO_31_FLASH_VOICES, QWEN_AUDIO_31_PLUS_VOICES } from './alibabaVoices.js';
import { isRecord, ProviderFailure, rejected, unknownOutcome, unreadable } from './failure.js';
import type { HttpAnswer, ProviderHttp } from './http.js';
import type { AnsweredAtOnce, ModuleCheckResult, ModuleVoices, OutputLocation } from './module.js';
import type { CatalogModel, CatalogParameter, CatalogVoiceOption, CheckRequest, ListedVoice, SubmitRequest, VoicesRequest } from '../common/basehalfProviderTypes.js';

/**
 * The Qwen-Audio speech models of Alibaba Cloud Model Studio
 * (docs/specs/providers/alibaba.md, "Speech models"; D78): their declarations,
 * the request that speaks the prompt, and the voices of the user's account.
 * One call, `POST /services/audio/tts/SpeechSynthesizer`, answers at once
 * with the address of an MP3, which is downloaded over `https` without the
 * key. The Alibaba module (`alibaba.ts`) hands these models' calls here.
 */

// --- labels ---------------------------------------------------------------------------------------

/** Every label of the speech models, in English, in one place to translate later. */
const TEXT = Object.freeze({
	mode: 'Speech',
	voice: 'Voice',
	speed: 'Speed',
	speedTooltip: 'How fast the voice speaks: 1 is its own pace.',
	instruction: 'Instruction',
	instructionTooltip: 'How the voice speaks, in a sentence: a dialect, a feeling, or a role, such as “请讲上海话。”. Write it in the language of the text.',
	pitch: 'Pitch',
	pitchTooltip: 'Raises or lowers the voice: 1 is its own pitch.',
	volume: 'Volume',
	volumeTooltip: 'How loud the voice is: 50 is its own volume.',
	language: 'Language',
	languageTooltip: 'The language of the text, for a text the model could read as another. Auto lets the model tell.',
	auto: 'Auto',
	other: 'Other',
	watermark: 'Watermark',
	watermarkTooltip: 'Marks the file as made by AI.',
	seed: 'Seed',
	seedTooltip: 'The same seed and settings give similar results.',
	models: {
		'qwen-audio-3.1-tts-plus': { label: 'Qwen-Audio 3.1 TTS Plus', description: 'Qwen\'s most lifelike speech, for narration and voiceovers, in four flagship voices that speak Mandarin, Chinese dialects, and other languages; tags such as [excited] in the text set its feeling.' },
		'qwen-audio-3.1-tts-flash': { label: 'Qwen-Audio 3.1 TTS Flash', description: 'Fast Qwen speech in many voices of Mandarin, Chinese dialects, English, and 50 more languages; tags such as [excited] or [laughing] in the text set its feeling or add a sound.' },
		'qwen-audio-3.0-tts-plus': { label: 'Qwen-Audio 3.0 TTS Plus', description: 'The previous Qwen speech, in two voices that speak Mandarin and English; tags such as [excited] in the text set its feeling.' },
		'qwen-audio-3.0-tts-flash': { label: 'Qwen-Audio 3.0 TTS Flash', description: 'The previous, faster Qwen speech, in twelve voices of Mandarin and English; tags such as [excited] in the text set its feeling.' }
	},
	/** The languages of `language_hints`, by Alibaba's codes, in the reference's order. */
	languages: {
		zh: 'Chinese',
		en: 'English',
		fr: 'French',
		de: 'German',
		ja: 'Japanese',
		ko: 'Korean',
		ru: 'Russian',
		pt: 'Portuguese',
		th: 'Thai',
		id: 'Indonesian',
		vi: 'Vietnamese',
		es: 'Spanish',
		it: 'Italian',
		ms: 'Malay',
		fil: 'Filipino',
		ar: 'Arabic'
	},
	tooLong: (model: string, length: number) => `The text is too long for ${model}: it takes ${SPEECH_MAX_CHARACTERS} characters, a Chinese character counting as two, and this one counts ${length}.`,
	noVoice: (model: string, voice: string, said: string) => `${model} does not speak in the voice "${voice}": choose another voice. Alibaba Cloud says: ${said}`,
	noSound: 'Alibaba Cloud accepted the request but answered no sound BaseHalf can read.',
	refused: 'Alibaba Cloud refused the request.',
	notOffered: (model: string) => `Alibaba Cloud does not offer ${model} in this region.`,
	rateLimit: (model: string) => `Alibaba Cloud takes at most ${SPEECH_REQUESTS_A_MINUTE} requests a minute for ${model}.`,
	unreadableVoices: 'Alibaba Cloud answered voices BaseHalf cannot read.',
	made: (date: string) => `Made on ${date}`
});

type SpeechModelId = keyof typeof TEXT.models;

// --- declarations ---------------------------------------------------------------------------------

/**
 * The most characters one call of Alibaba's SDK takes, a Chinese character
 * counting as two, as Alibaba counts the characters it bills; the HTTP
 * reference gives no limit (alibaba.md, "Speech models").
 */
const SPEECH_MAX_CHARACTERS = 20_000;
/** Alibaba states no limit of an instruction for these models; it took 1,800 characters (measured on 2026-11-11). */
const INSTRUCTION_MAX_CHARACTERS = 1000;
/** The rate the models make their sound at: asked for 48 kHz, an MP3 has nothing above 12 kHz (measured on 2026-11-11). */
const SAMPLE_RATE = 24_000;
const SPEECH_REQUESTS_A_MINUTE = 180;
/** The language that lets the model tell: nothing is sent for it. */
const AUTO = 'auto';

const NONE = { min: 0, max: 0 };

function speechParameters(voices: readonly CatalogVoiceOption[], defaultVoice: string, otherLanguage: boolean): CatalogParameter[] {
	return [
		{ name: 'voice', label: TEXT.voice, kind: 'voice', options: voices, default: defaultVoice, listed: true },
		// The shared name of Alibaba's `rate`.
		{ name: 'speed', label: TEXT.speed, tooltip: TEXT.speedTooltip, kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1 },
		{ name: 'instruction', label: TEXT.instruction, tooltip: TEXT.instructionTooltip, kind: 'text', maxLength: INSTRUCTION_MAX_CHARACTERS, optional: true },
		{ name: 'pitch', label: TEXT.pitch, tooltip: TEXT.pitchTooltip, kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1, advanced: true },
		{ name: 'volume', label: TEXT.volume, tooltip: TEXT.volumeTooltip, kind: 'integer', min: 0, max: 100, step: 1, default: 50, advanced: true },
		{
			name: 'language_hints',
			label: TEXT.language,
			tooltip: TEXT.languageTooltip,
			kind: 'choice',
			options: [
				{ value: AUTO, label: TEXT.auto },
				...Object.entries(TEXT.languages).map(([value, label]) => ({ value, label })),
				...(otherLanguage ? [{ value: 'other', label: TEXT.other }] : [])
			],
			default: AUTO,
			advanced: true
		},
		// The shared name of Alibaba's `enable_aigc_tag`, off as Alibaba's default is.
		{ name: 'watermark', label: TEXT.watermark, tooltip: TEXT.watermarkTooltip, kind: 'boolean', default: false, advanced: true },
		{ name: 'seed', label: TEXT.seed, tooltip: TEXT.seedTooltip, kind: 'integer', min: 0, max: 65535, step: 1, optional: true, advanced: true }
	];
}

/** A speech model: the same id in both regions, MP3, and its sound in the answer to the request. */
function speechModel(id: SpeechModelId, voices: readonly CatalogVoiceOption[], defaultVoice: string, otherLanguage = false): CatalogModel {
	return {
		id,
		kind: 'audio',
		makes: 'speech',
		label: TEXT.models[id].label,
		description: TEXT.models[id].description,
		providerModels: { cn: id, intl: id },
		prompt: { required: 'always', maxLength: SPEECH_MAX_CHARACTERS },
		// The prompt is what the voice says; the mode takes no inputs.
		modes: [{ id: 'reference', label: TEXT.mode, inputs: { startFrame: 'none', endFrame: 'none', images: NONE, videos: NONE, audios: NONE, source: 'none' }, limits: {} }],
		parameters: speechParameters(voices, defaultVoice, otherLanguage),
		outputFormat: 'mp3',
		answersAtOnce: true
	};
}

/** The speech models, after the image models, in this order (alibaba.md, "Speech models"). */
export const SPEECH_MODELS: readonly CatalogModel[] = Object.freeze([
	speechModel('qwen-audio-3.1-tts-plus', QWEN_AUDIO_31_PLUS_VOICES, QWEN_AUDIO_31_DEFAULT_VOICE),
	// `other` is a language of 3.1 TTS Flash alone, as the reference says.
	speechModel('qwen-audio-3.1-tts-flash', QWEN_AUDIO_31_FLASH_VOICES, QWEN_AUDIO_31_DEFAULT_VOICE, true),
	speechModel('qwen-audio-3.0-tts-plus', QWEN_AUDIO_30_PLUS_VOICES, QWEN_AUDIO_30_PLUS_DEFAULT_VOICE),
	speechModel('qwen-audio-3.0-tts-flash', QWEN_AUDIO_30_FLASH_VOICES, QWEN_AUDIO_30_FLASH_DEFAULT_VOICE)
]);

const SPEECH_BY_ID: ReadonlyMap<string, CatalogModel> = new Map(SPEECH_MODELS.map(model => [model.id, model]));

/** The speech model of a catalog id, when it is one. */
export function speechModelOf(id: string): CatalogModel | undefined {
	return SPEECH_BY_ID.get(id);
}

// --- check ----------------------------------------------------------------------------------------

/** The characters of a text as Alibaba counts them: a Chinese character (a CJK ideograph) as two. */
function billedLength(text: string): number {
	let length = 0;
	for (const character of text) {
		length += /\p{Script=Han}/u.test(character) ? 2 : 1;
	}
	return length;
}

/** The rule of the text that the declarations cannot express: a Chinese character counts as two. */
export async function speechCheck(model: CatalogModel, request: CheckRequest): Promise<ModuleCheckResult> {
	const length = billedLength(request.prompt);
	// A text of more than 20,000 characters is refused by the declarations already.
	const problems = length > SPEECH_MAX_CHARACTERS && [...request.prompt].length <= SPEECH_MAX_CHARACTERS ? [TEXT.tooLong(model.label, length)] : [];
	return { problems, providerModel: model.providerModels[request.region] };
}

// --- requests -------------------------------------------------------------------------------------

/** The body of a speech request (alibaba.md, "Speech requests"): the prompt as the text, MP3 at the models' rate, and each setting under Alibaba's name. */
function speechBody(providerModel: string, request: SubmitRequest): Record<string, unknown> {
	const params = request.params;
	const input: Record<string, unknown> = {
		text: request.prompt,
		voice: params.voice,
		// Always sent: without it, Alibaba answers a WAV (measured).
		format: 'mp3',
		sample_rate: SAMPLE_RATE,
		rate: params.speed,
		pitch: params.pitch,
		volume: params.volume,
		enable_aigc_tag: params.watermark
	};
	if (typeof params.instruction === 'string' && params.instruction.trim()) {
		input.instruction = params.instruction;
	}
	if (typeof params.language_hints === 'string' && params.language_hints !== AUTO) {
		// Alibaba reads only the first value.
		input.language_hints = [params.language_hints];
	}
	if (typeof params.seed === 'number') {
		input.seed = params.seed;
	}
	return { model: providerModel, input };
}

/**
 * An address of the answer as BaseHalf downloads it: an `http://` address on
 * a host of `aliyuncs.com`, as the OSS host of the sound answers it, is taken
 * over `https://`, which it answers with the same signature. Any other
 * address stays as it is, and the download refuses one it does not take.
 */
function secureAddress(address: string): string {
	let host: string;
	try {
		const url = new URL(address);
		if (url.protocol !== 'http:') {
			return address;
		}
		host = url.hostname.toLowerCase();
	} catch {
		return address;
	}
	// The rest of the address, its signature among it, is kept exactly as it was answered.
	return host === 'aliyuncs.com' || host.endsWith('.aliyuncs.com') ? `https://${address.slice('http://'.length)}` : address;
}

/**
 * The sound of an answer: the address of `output.audio.url`, or the bytes of
 * `output.audio.data` as a relay may answer. A 2xx answer without either that
 * carries a code is a refusal; one without a code cannot be read, though the
 * sound may have been made.
 */
function speechOutput(body: Record<string, unknown>): OutputLocation {
	const output = body.output;
	const audio = isRecord(output) ? output.audio : undefined;
	const url = isRecord(audio) && typeof audio.url === 'string' ? audio.url.trim() : '';
	if (url) {
		return { url: secureAddress(url) };
	}
	const data = isRecord(audio) && typeof audio.data === 'string' ? audio.data.trim() : '';
	if (data) {
		return { bytes: Buffer.from(data, 'base64'), format: 'mp3' };
	}
	const reading = typeof body.code === 'string' && body.code.trim() ? readAlibabaError(200, body) : undefined;
	if (reading) {
		throw new ProviderFailure(reading.code ?? 'rejected', reading.message ?? TEXT.refused);
	}
	throw unknownOutcome(TEXT.noSound);
}

/** Engine error 411 is a voice that the model does not have (measured on 2026-11-11). */
const NO_SUCH_VOICE = /Engine error \[411\]/i;

/** A refusal that says a voice the model does not have, said plainly; any other failure stays as it is. */
function voiceFailure(error: unknown, model: CatalogModel, voice: unknown): unknown {
	if (error instanceof ProviderFailure && error.code === 'rejected' && error.status === 400 && NO_SUCH_VOICE.test(error.message) && typeof voice === 'string') {
		return rejected(TEXT.noVoice(model.label, voice, error.message), error.status);
	}
	return error;
}

/** Sends a speech request once and answers its one sound (alibaba.md, "Speech requests"). */
export async function speechSubmit(model: CatalogModel, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	const providerModel = model.providerModels[request.region];
	if (providerModel === undefined) {
		throw rejected(TEXT.notOffered(model.label));
	}
	let answer: HttpAnswer;
	try {
		answer = await http.create({
			method: 'POST',
			path: apiPath(http, '/services/audio/tts/SpeechSynthesizer'),
			body: { kind: 'json', value: speechBody(providerModel, request) },
			// Read here, so that a rate-limited answer names the speech models' own limit.
			accept: [429]
		});
	} catch (error) {
		throw voiceFailure(error, model, request.params.voice);
	}
	if (answer.status === 429) {
		throw refusedCreate(answer, TEXT.rateLimit(model.label));
	}
	return { outputs: [speechOutput(answer.object())] };
}

// --- the voices of the account --------------------------------------------------------------------

const VOICES_PAGE_SIZE = 100;
/** An account has at most 1,000 voices of its own; a page more than that takes ends the list. */
const VOICES_MAX_PAGES = Math.ceil(1000 / VOICES_PAGE_SIZE) + 1;

/**
 * A voice of `list_voice` that the account can speak in with the model whose
 * id is `providerModel`: ready (`OK`), and named after the model, as every
 * voice of these models is (`<model>-<prefix>-<suffix>`). Its label is the
 * prefix the user gave it, or its id; its description says when it was made.
 */
function accountVoice(entry: unknown, providerModel: string): ListedVoice | undefined {
	if (!isRecord(entry) || typeof entry.voice_id !== 'string' || entry.status !== 'OK' || !entry.voice_id.startsWith(`${providerModel}-`)) {
		return undefined;
	}
	const id = entry.voice_id;
	const rest = id.slice(providerModel.length + 1);
	const cut = rest.lastIndexOf('-');
	const prefix = cut > 0 ? rest.slice(0, cut) : '';
	const made = typeof entry.gmt_create === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(entry.gmt_create)?.[0] : undefined;
	return { id, label: prefix || id, ...(made ? { description: TEXT.made(made) } : {}), own: true };
}

/**
 * A refusal of the list of voices for too many requests, whose limit Alibaba
 * does not state: the note of the video models' limit, which the module's
 * reading of every error adds to a rate limit, is left out.
 */
function withoutVideoLimit(error: unknown): unknown {
	if (error instanceof ProviderFailure && error.code === 'rateLimited' && error.message.includes(RATE_LIMIT_NOTE)) {
		return new ProviderFailure(error.code, error.message.replace(RATE_LIMIT_NOTE, '').replace(/\s{2,}/g, ' ').trim(), error.status);
	}
	return error;
}

/**
 * The voices of the user's account for a speech model (alibaba.md, "Voices of
 * the speech models"): `list_voice`, page after page from 0, until the pages
 * hold `total_count` voices, a page holds none, or more than `limit` are
 * found. The system voices are the catalog's.
 */
export async function listSpeechVoices(model: CatalogModel, request: VoicesRequest, http: ProviderHttp, limit: number): Promise<ModuleVoices> {
	const providerModel = model.providerModels[request.region];
	if (providerModel === undefined) {
		throw rejected(TEXT.notOffered(model.label));
	}
	const voices: ListedVoice[] = [];
	for (let page = 0; page < VOICES_MAX_PAGES; page++) {
		let answer: Record<string, unknown>;
		try {
			answer = (await http.request({
				method: 'POST',
				path: apiPath(http, '/services/audio/tts/customization'),
				body: { kind: 'json', value: { model: 'voice-enrollment', input: { action: 'list_voice', page_index: page, page_size: VOICES_PAGE_SIZE } } }
			})).object();
		} catch (error) {
			throw withoutVideoLimit(error);
		}
		const output = answer.output;
		const list = isRecord(output) ? output.voice_list : undefined;
		if (!Array.isArray(list)) {
			throw unreadable(TEXT.unreadableVoices);
		}
		for (const entry of list) {
			const voice = accountVoice(entry, providerModel);
			if (voice) {
				if (voices.length >= limit) {
					return { voices, truncated: true };
				}
				voices.push(voice);
			}
		}
		const total = isRecord(output) && typeof output.total_count === 'number' ? output.total_count : undefined;
		const listed = (page + 1) * VOICES_PAGE_SIZE;
		if (!list.length || (total !== undefined ? listed >= total : list.length < VOICES_PAGE_SIZE)) {
			return { voices };
		}
	}
	return { voices, truncated: true };
}
