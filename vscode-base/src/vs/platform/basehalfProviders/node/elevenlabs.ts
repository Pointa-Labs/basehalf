/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isRecord, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import type { ProviderHttp } from './http.js';
import type { AnsweredAtOnce, ModuleCheckResult, ModuleVoices, ProviderModule } from './module.js';
import type { CatalogModel, CatalogParameter, CatalogProvider, CatalogVoiceOption, CheckRequest, ListedVoice, ParamValue, PollState, SubmitRequest, TaskRef, VoicesRequest } from '../common/basehalfProviderTypes.js';

/**
 * ElevenLabs' speech and sound-effect models on ElevenLabs' own API
 * (`docs/specs/providers/elevenlabs.md`, D78). Speech is
 * `POST /v1/text-to-speech/{voice_id}` and sound effects
 * `POST /v1/sound-generation`, each asked for as MP3 at 44.1 kHz and 128 kbps,
 * which every plan may ask for, and answered at once with the file itself.
 * The voices are listed with `GET /v2/voices`: the account's own and
 * ElevenLabs' Default voices, each with the address of its sample.
 */

// --- the provider's English texts, in one place so they can be translated -----------------------

const MODEL_TEXTS = Object.freeze({
	'eleven-v4': { label: 'Eleven v4', description: 'ElevenLabs\' most expressive speech, directed with audio tags such as [whispers] in the text: more than 90 languages, up to 10,000 characters.' },
	'eleven-v3': { label: 'Eleven v3', description: 'ElevenLabs\' earlier expressive speech, with audio tags: more than 70 languages, up to 5,000 characters.' },
	'eleven-multilingual-v2': { label: 'Multilingual v2', description: 'Lifelike, steady speech in 29 languages, the most stable on long texts: up to 10,000 characters.' },
	'eleven-flash-v2.5': { label: 'Flash v2.5', description: 'ElevenLabs\' fastest speech, in 32 languages: up to 40,000 characters.' },
	'eleven-text-to-sound-v2': { label: 'Sound Effects', description: 'Sound effects, ambiences, and loops from a description, up to 30 seconds.' }
});

const TEXT = Object.freeze({
	provider: 'ElevenLabs',
	region: 'Global',
	apiKey: 'API Key',
	modes: { speech: 'Speech', sound: 'Sound Effects' },
	models: MODEL_TEXTS,
	parameters: {
		voice: 'Voice',
		speed: 'Speed',
		speedTooltip: 'How fast the voice speaks: 1 is its own pace, from 0.7 to 1.2.',
		stability: 'Stability',
		stabilityTooltip: 'How steady the voice is from one take to the next: lower gives a broader emotional range, higher can sound monotonous.',
		stabilityPresets: { creative: 'Creative', natural: 'Natural', robust: 'Robust' },
		stabilityPresetsTooltip: 'Creative is the most expressive and may stray, Natural stays closest to the voice, and Robust is the steadiest but follows audio tags less.',
		similarity: 'Similarity',
		similarityTooltip: 'How closely the speech keeps to the original voice. Set high, it may also copy the noise of the voice\'s recording.',
		style: 'Style Exaggeration',
		styleTooltip: 'Amplifies the style of the original speaker. ElevenLabs recommends 0: higher can make the voice less stable and slower to make.',
		speakerBoost: 'Speaker Boost',
		speakerBoostTooltip: 'Makes the speech sound more like the original speaker, a little more slowly.',
		language: 'Language',
		languageTooltip: 'The language of the text, so that its numbers and words are read the right way. Not set, ElevenLabs tells it from the text.',
		seed: 'Seed',
		seedTooltip: 'The same seed with the same request gives a similar take, as far as ElevenLabs can. Leave it empty for a new one each time.',
		duration: 'Duration',
		durationTooltip: 'How long the sound is. Auto lets ElevenLabs choose from the description.',
		auto: 'Auto',
		loop: 'Loop',
		loopTooltip: 'Makes a sound that plays on repeat with no start or end you can hear.',
		promptInfluence: 'Prompt Influence',
		promptInfluenceTooltip: 'How closely the sound follows the description: higher is more literal and less varied.'
	},
	noModel: (id: string) => `ElevenLabs has no model "${id}".`,
	noTask: (model: string) => `${model} answers with its sound at once: there is no task to ask about.`,
	noSound: 'ElevenLabs accepted the request but answered no sound.',
	unreadableVoices: 'ElevenLabs answered voices BaseHalf cannot read.',
	keyPermission: (said: string) => `The API key lacks a permission that this needs: ${said} Allow it for the key on ElevenLabs' API keys page, or use a key that has it.`,
	plan: (said: string) => `The plan of this ElevenLabs account does not include this: ${said}`,
	freePlanStopped: 'ElevenLabs has stopped the free plan of this account, as it does when it notices unusual activity, such as a VPN or a network that others share. A paid plan is not affected.',
	voiceNotFound: (said: string) => `ElevenLabs does not know this voice, or this account cannot use it: choose another voice. ElevenLabs says: ${said}`,
	voiceDenied: (said: string) => `This ElevenLabs account may not use this voice: choose another voice. ElevenLabs says: ${said}`,
	concurrent: (said: string) => `ElevenLabs is already running as many requests of this account at once as its plan allows: wait for them to finish, then generate again. ElevenLabs says: ${said}`,
	busy: 'ElevenLabs is busy: generate again in a moment.',
	invalid: (fields: string) => `ElevenLabs refused the request: ${fields}`
});

// --- the voices of the catalog --------------------------------------------------------------------

/**
 * Voices of ElevenLabs' Voice Library that replace its Default voices, which
 * expire on 2026-12-31 and exist only in accounts made before March 2026;
 * ElevenLabs says the new ones stay. Eldrin replaces George, the voice of
 * ElevenLabs' quickstart, and is the default.
 */
const VOICES: readonly CatalogVoiceOption[] = Object.freeze([
	{ value: '6WwXjDDEMyNmFG95zycZ', label: 'Eldrin', description: 'Crisp British baritone' },
	{ value: 'WQP7cQUF5aAS6Axh5yaa', label: 'Elara', description: 'Crisp pro narrator' },
	{ value: 'OZ0L6eISlOejga3XjDFt', label: 'Talia', description: 'Warm, soft guide' },
	{ value: 'gOupLcAkjEnguROwi4oS', label: 'Darian', description: 'Warm, grounded storyteller' },
	{ value: 'BFd5oBc2DDna33pSi4Gf', label: 'Alicia', description: 'Polished global anchor' },
	{ value: 'fnYMz3F5gMEDGMWcH1ex', label: 'Finley', description: 'Articulate anchor' }
]);

const DEFAULT_VOICE = VOICES[0].value;

// --- the languages of `language_code` -------------------------------------------------------------

type Language = readonly [code: string, name: string];

/** Languages in the order of their English names. */
function byName(languages: readonly Language[]): readonly Language[] {
	return Object.freeze([...languages].sort((a, b) => a[1].localeCompare(b[1], 'en')));
}

/** The languages of Eleven v4, as ElevenLabs' models page lists them with their codes. */
const V4_LANGUAGES: readonly Language[] = byName([
	['af', 'Afrikaans'], ['ar', 'Arabic'], ['hy', 'Armenian'], ['as', 'Assamese'], ['ast', 'Asturian'], ['az', 'Azerbaijani'],
	['be', 'Belarusian'], ['bn', 'Bengali'], ['bs', 'Bosnian'], ['bg', 'Bulgarian'], ['my', 'Burmese'], ['yue', 'Cantonese'],
	['ca', 'Catalan'], ['ceb', 'Cebuano'], ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'],
	['en', 'English'], ['et', 'Estonian'], ['fil', 'Filipino'], ['fi', 'Finnish'], ['fr', 'French'], ['gl', 'Galician'],
	['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'], ['gu', 'Gujarati'], ['ha', 'Hausa'], ['he', 'Hebrew'],
	['hi', 'Hindi'], ['hu', 'Hungarian'], ['is', 'Icelandic'], ['id', 'Indonesian'], ['ga', 'Irish'], ['it', 'Italian'],
	['ja', 'Japanese'], ['jv', 'Javanese'], ['kn', 'Kannada'], ['kk', 'Kazakh'], ['ko', 'Korean'], ['ky', 'Kyrgyz'],
	['lv', 'Latvian'], ['ln', 'Lingala'], ['lt', 'Lithuanian'], ['lb', 'Luxembourgish'], ['mk', 'Macedonian'], ['ms', 'Malay'],
	['ml', 'Malayalam'], ['mt', 'Maltese'], ['zh', 'Mandarin Chinese'], ['mi', 'Māori'], ['mr', 'Marathi'], ['mn', 'Mongolian'],
	['ne', 'Nepali'], ['no', 'Norwegian'], ['oc', 'Occitan'], ['or', 'Odia'], ['ps', 'Pashto'], ['fa', 'Persian'],
	['pl', 'Polish'], ['pt', 'Portuguese'], ['pa', 'Punjabi'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sr', 'Serbian'],
	['sd', 'Sindhi'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['so', 'Somali'], ['es', 'Spanish'], ['sw', 'Swahili'],
	['sv', 'Swedish'], ['tg', 'Tajik'], ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['tr', 'Turkish'],
	['uk', 'Ukrainian'], ['ur', 'Urdu'], ['uz', 'Uzbek'], ['vi', 'Vietnamese'], ['cy', 'Welsh'], ['yo', 'Yoruba']
]);

/** Eleven v3's: those of Eleven v4 and Chichewa. */
const V3_LANGUAGES: readonly Language[] = byName([...V4_LANGUAGES, ['ny', 'Chichewa']]);

/** Flash v2.5's: the 29 languages of Multilingual v2, and Hungarian, Norwegian, and Vietnamese. */
const FLASH_LANGUAGES: readonly Language[] = byName([
	['en', 'English'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['de', 'German'], ['hi', 'Hindi'], ['fr', 'French'],
	['ko', 'Korean'], ['pt', 'Portuguese'], ['it', 'Italian'], ['es', 'Spanish'], ['id', 'Indonesian'], ['nl', 'Dutch'],
	['tr', 'Turkish'], ['fil', 'Filipino'], ['pl', 'Polish'], ['sv', 'Swedish'], ['bg', 'Bulgarian'], ['ro', 'Romanian'],
	['ar', 'Arabic'], ['cs', 'Czech'], ['el', 'Greek'], ['fi', 'Finnish'], ['hr', 'Croatian'], ['ms', 'Malay'],
	['sk', 'Slovak'], ['da', 'Danish'], ['ta', 'Tamil'], ['uk', 'Ukrainian'], ['ru', 'Russian'], ['hu', 'Hungarian'],
	['no', 'Norwegian'], ['vi', 'Vietnamese']
]);

// --- the models --------------------------------------------------------------------------------

type ModelId = keyof typeof MODEL_TEXTS;

/** A voice setting of `voice_settings`: the catalog's parameter, and ElevenLabs' field. */
type VoiceSetting = 'speed' | 'stability' | 'stabilityPresets' | 'similarity' | 'style' | 'speakerBoost';

interface SpeechModel {
	readonly makes: 'speech';
	readonly id: ModelId;
	readonly providerModel: string;
	readonly maxCharacters: number;
	/** The voice settings the model takes, in the order the panel shows them. */
	readonly settings: readonly VoiceSetting[];
	/** The languages its `language_code` takes; none for a model that takes no code. */
	readonly languages?: readonly Language[];
}

interface SoundModel {
	readonly makes: 'sound';
	readonly id: ModelId;
	readonly providerModel: string;
	readonly maxCharacters: number;
}

type ElevenLabsModel = SpeechModel | SoundModel;

/** Multilingual v2 and Flash v2.5 take all five voice settings. */
const ALL_SETTINGS: readonly VoiceSetting[] = Object.freeze(['speed', 'stability', 'similarity', 'style', 'speakerBoost']);

const MODELS: readonly ElevenLabsModel[] = Object.freeze([
	// "Both variants use two voice settings: Stability and Similarity."
	{ makes: 'speech', id: 'eleven-v4', providerModel: 'eleven_v4', maxCharacters: 10_000, settings: ['stability', 'similarity'], languages: V4_LANGUAGES },
	// "Speed", "Similarity", and "Speaker Boost" are "not available for the Eleven v3 model".
	{ makes: 'speech', id: 'eleven-v3', providerModel: 'eleven_v3', maxCharacters: 5_000, settings: ['stabilityPresets'], languages: V3_LANGUAGES },
	// `language_code` "is not supported for multilingual_v2 models".
	{ makes: 'speech', id: 'eleven-multilingual-v2', providerModel: 'eleven_multilingual_v2', maxCharacters: 10_000, settings: ALL_SETTINGS },
	{ makes: 'speech', id: 'eleven-flash-v2.5', providerModel: 'eleven_flash_v2_5', maxCharacters: 40_000, settings: ALL_SETTINGS, languages: FLASH_LANGUAGES },
	// The help center's limit of the prompt; the API reference states none.
	{ makes: 'sound', id: 'eleven-text-to-sound-v2', providerModel: 'eleven_text_to_sound_v2', maxCharacters: 450 }
] satisfies ElevenLabsModel[]);

const MODELS_BY_ID: ReadonlyMap<string, ElevenLabsModel> = new Map(MODELS.map(model => [model.id, model]));

// --- the catalog entry -------------------------------------------------------------------------

/** MP3 at 44.1 kHz and 128 kbps: 192 kbps needs ElevenLabs' Creator plan, and WAV at 44.1 kHz its Pro plan. */
const OUTPUT_FORMAT = 'mp3_44100_128';
/** The longest sound effect, and the shortest whole number of seconds. */
const SOUND_SECONDS = { min: 1, max: 30 } as const;
const AUTO = -1;

/**
 * Each voice setting as the catalog declares it, and the field of
 * `voice_settings` it is sent as. The defaults are the API's.
 */
const SETTINGS: Readonly<Record<VoiceSetting, { readonly parameter: CatalogParameter; readonly field: string }>> = (() => {
	const labels = TEXT.parameters;
	const presets = labels.stabilityPresets;
	return Object.freeze({
		speed: { field: 'speed', parameter: { name: 'speed', label: labels.speed, tooltip: labels.speedTooltip, kind: 'number', min: 0.7, max: 1.2, step: 0.05, default: 1 } },
		stability: { field: 'stability', parameter: { name: 'stability', label: labels.stability, tooltip: labels.stabilityTooltip, kind: 'number', min: 0, max: 1, step: 0.01, default: 0.5 } },
		stabilityPresets: {
			field: 'stability',
			parameter: {
				name: 'stability',
				label: labels.stability,
				tooltip: labels.stabilityPresetsTooltip,
				kind: 'choice',
				options: [{ value: 0, label: presets.creative }, { value: 0.5, label: presets.natural }, { value: 1, label: presets.robust }],
				default: 0.5
			}
		},
		similarity: { field: 'similarity_boost', parameter: { name: 'similarity_boost', label: labels.similarity, tooltip: labels.similarityTooltip, kind: 'number', min: 0, max: 1, step: 0.01, default: 0.75 } },
		style: { field: 'style', parameter: { name: 'style_exaggeration', label: labels.style, tooltip: labels.styleTooltip, kind: 'number', min: 0, max: 1, step: 0.01, default: 0, advanced: true } },
		speakerBoost: { field: 'use_speaker_boost', parameter: { name: 'use_speaker_boost', label: labels.speakerBoost, tooltip: labels.speakerBoostTooltip, kind: 'boolean', default: true, advanced: true } }
	});
})();

function speechParameters(model: SpeechModel): CatalogParameter[] {
	const labels = TEXT.parameters;
	return [
		{ name: 'voice', label: labels.voice, kind: 'voice', options: VOICES, default: DEFAULT_VOICE, listed: true },
		...model.settings.map(setting => SETTINGS[setting].parameter),
		...(model.languages ? [{
			name: 'language_code',
			label: labels.language,
			tooltip: labels.languageTooltip,
			kind: 'choice',
			options: model.languages.map(([value, label]) => ({ value, label })),
			optional: true,
			advanced: true
		} satisfies CatalogParameter] : []),
		// ElevenLabs takes seeds up to 4294967295; the shared seed is 0 to 2147483647.
		{ name: 'seed', label: labels.seed, tooltip: labels.seedTooltip, kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true }
	];
}

function soundParameters(): CatalogParameter[] {
	const labels = TEXT.parameters;
	return [
		{ name: 'duration', label: labels.duration, tooltip: labels.durationTooltip, kind: 'integer', unit: 'seconds', min: SOUND_SECONDS.min, max: SOUND_SECONDS.max, step: 1, default: AUTO, auto: { value: AUTO, label: labels.auto } },
		{ name: 'loop', label: labels.loop, tooltip: labels.loopTooltip, kind: 'boolean', default: false },
		{ name: 'prompt_influence', label: labels.promptInfluence, tooltip: labels.promptInfluenceTooltip, kind: 'number', min: 0, max: 1, step: 0.01, default: 0.3, advanced: true }
	];
}

function catalogModel(model: ElevenLabsModel): CatalogModel {
	const text = TEXT.models[model.id];
	const none = { min: 0, max: 0 };
	return {
		id: model.id,
		kind: 'audio',
		makes: model.makes,
		label: text.label,
		description: text.description,
		providerModels: { global: model.providerModel },
		prompt: { required: 'always', maxLength: model.maxCharacters },
		modes: [{
			id: 'reference',
			label: model.makes === 'speech' ? TEXT.modes.speech : TEXT.modes.sound,
			inputs: { startFrame: 'none', endFrame: 'none', images: none, videos: none, audios: none, source: 'none' },
			limits: {}
		}],
		parameters: model.makes === 'speech' ? speechParameters(model) : soundParameters(),
		outputFormat: 'mp3',
		answersAtOnce: true
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'elevenlabs',
	label: TEXT.provider,
	regions: [{ id: 'global', label: TEXT.region, baseUrl: 'https://api.elevenlabs.io', console: 'https://elevenlabs.io/app/api/api-keys' }],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODELS.map(catalogModel)
});

// --- requests ----------------------------------------------------------------------------------

function modelOf(id: string): ElevenLabsModel {
	const model = MODELS_BY_ID.get(id);
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

/** The JSON of a speech request: the text, the model, exactly its voice settings, and the seed and the language when they are set. */
function speechBody(model: SpeechModel, request: SubmitRequest): Record<string, unknown> {
	const params = request.params;
	const settings: Record<string, ParamValue> = {};
	for (const setting of model.settings) {
		const { parameter, field } = SETTINGS[setting];
		if (params[parameter.name] !== undefined) {
			settings[field] = params[parameter.name];
		}
	}
	return {
		text: request.prompt,
		model_id: model.providerModel,
		voice_settings: settings,
		...(params.seed !== undefined ? { seed: params.seed } : {}),
		...(params.language_code !== undefined ? { language_code: params.language_code } : {})
	};
}

/** The JSON of a sound effect: Auto sends no duration, so that ElevenLabs chooses it from the description. */
function soundBody(model: SoundModel, request: SubmitRequest): Record<string, unknown> {
	const params = request.params;
	const duration = params.duration;
	return {
		text: request.prompt,
		model_id: model.providerModel,
		loop: params.loop === true,
		prompt_influence: params.prompt_influence,
		...(typeof duration === 'number' && duration !== AUTO ? { duration_seconds: duration } : {})
	};
}

/** Sends the request once and answers its one sound, the MP3 that ElevenLabs answers with. */
async function submit(request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
	const model = modelOf(request.model);
	const call = model.makes === 'speech'
		? { path: `/v1/text-to-speech/${encodeURIComponent(String(request.params.voice ?? DEFAULT_VOICE))}`, body: speechBody(model, request) }
		: { path: '/v1/sound-generation', body: soundBody(model, request) };
	const answer = await http.create({
		method: 'POST',
		path: call.path,
		query: { output_format: OUTPUT_FORMAT },
		headers: { Accept: 'audio/mpeg' },
		body: { kind: 'json', value: call.body }
	});
	if (!answer.body.byteLength) {
		throw unknownOutcome(TEXT.noSound);
	}
	return { outputs: [{ bytes: answer.body, format: 'mp3' }] };
}

async function poll(ref: TaskRef): Promise<PollState> {
	throw rejected(TEXT.noTask(TEXT.models[modelOf(ref.model).id].label));
}

async function cancel(): Promise<boolean> {
	// The request answered with the sound: there is nothing to cancel.
	return false;
}

// --- voices ------------------------------------------------------------------------------------

const VOICES_PAGE_SIZE = 100;
/** The labels a voice's description is made of, in order; `descriptive` was `description` before. */
const DESCRIBING_LABELS: readonly (readonly string[])[] = Object.freeze([['gender'], ['age'], ['accent'], ['descriptive', 'description'], ['use_case']]);

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A label as words: `middle_aged` is "Middle aged". */
function labelWords(value: string): string {
	const words = value.replace(/_/g, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A few words from the voice's labels, or its own description. */
function descriptionOf(voice: Record<string, unknown>): string | undefined {
	const labels = isRecord(voice.labels) ? voice.labels : {};
	const words = DESCRIBING_LABELS
		.map(keys => keys.map(key => textOf(labels[key])).find(value => value !== undefined))
		.filter((value): value is string => value !== undefined)
		.map(labelWords);
	return words.length ? words.join(', ') : textOf(voice.description);
}

/** A voice of `GET /v2/voices`: every category but `premade`, the Default voices, is the account's own. */
function listedVoice(value: unknown): ListedVoice | undefined {
	if (!isRecord(value) || typeof value.voice_id !== 'string') {
		return undefined;
	}
	const description = descriptionOf(value);
	const sample = textOf(value.preview_url);
	return {
		id: value.voice_id,
		label: textOf(value.name) ?? '',
		...(description !== undefined ? { description } : {}),
		own: value.category !== 'premade',
		...(sample !== undefined ? { sample } : {})
	};
}

/**
 * The account's voices and ElevenLabs' Default voices, page after page with
 * `next_page_token` while ElevenLabs has more, and no more than `limit`.
 */
async function listVoices(_request: VoicesRequest, http: ProviderHttp, limit: number): Promise<ModuleVoices> {
	const voices: ListedVoice[] = [];
	const tokens = new Set<string>();
	let token: string | undefined;
	// More pages than `limit` voices take: every page but the last holds 100, and the first may hold more.
	const pages = Math.ceil((limit + 1) / VOICES_PAGE_SIZE) + 1;
	for (let page = 0; page < pages; page++) {
		const answer = (await http.request({
			method: 'GET',
			path: '/v2/voices',
			query: { page_size: VOICES_PAGE_SIZE, include_total_count: false, ...(token !== undefined ? { next_page_token: token } : {}) }
		})).object();
		if (!Array.isArray(answer.voices)) {
			throw unreadable(TEXT.unreadableVoices);
		}
		for (const entry of answer.voices) {
			const voice = listedVoice(entry);
			if (voice) {
				voices.push(voice);
			}
		}
		const next = textOf(answer.next_page_token);
		const more = answer.has_more === true && next !== undefined && !tokens.has(next);
		if (voices.length > limit || (more && voices.length >= limit)) {
			return { voices: voices.slice(0, limit), truncated: true };
		}
		if (!more) {
			return { voices };
		}
		tokens.add(next);
		token = next;
	}
	return { voices: voices.slice(0, limit), truncated: true };
}

// --- errors ------------------------------------------------------------------------------------

const BALANCE_CODES: ReadonlySet<string> = new Set(['quota_exceeded', 'insufficient_credits']);
const PLAN_CODES: ReadonlySet<string> = new Set(['subscription_required', 'feature_not_available']);
/** `missing_permissions` is how ElevenLabs answers a key without a permission; its error table names `insufficient_permissions`. */
const PERMISSION_CODES: ReadonlySet<string> = new Set(['insufficient_permissions', 'missing_permissions']);
const CONCURRENCY_CODES: ReadonlySet<string> = new Set(['too_many_concurrent_requests', 'concurrent_limit_exceeded']);
/** The documented message of a free plan that ElevenLabs stopped; its code is not documented. */
const FREE_PLAN_STOPPED = /free tier usage disabled/i;

/** The fields of a request that does not validate: each `loc` with its `msg`. */
function validationText(detail: readonly unknown[]): string | undefined {
	const fields = detail
		.filter(isRecord)
		.map(entry => {
			const where = Array.isArray(entry.loc) ? entry.loc.filter(part => part !== 'body').map(String).join('.') : '';
			const what = textOf(entry.msg);
			return what ? (where ? `${where}: ${what}` : what) : undefined;
		})
		.filter((entry): entry is string => entry !== undefined);
	return fields.length ? fields.join('; ') : undefined;
}

/**
 * Reads `detail`: `{type, code, message, status}` now, `{status, message}`
 * before, where `status` held the code, or a list of fields that do not
 * validate. The codes refine a 4xx answer only, so that a server error leaves
 * the outcome of a create unknown; a legacy `quota_exceeded` comes with 401
 * and is an empty balance, not a refused key.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const detail = isRecord(body) ? body.detail : undefined;
	if (Array.isArray(detail)) {
		const fields = validationText(detail);
		return fields ? { message: TEXT.invalid(fields), code: 'rejected' } : undefined;
	}
	if (!isRecord(detail)) {
		return readCommonError(body);
	}
	const code = textOf(detail.code) ?? textOf(detail.status);
	const said = textOf(detail.message) ?? code;
	if (!said) {
		return undefined;
	}
	if (status < 400 || status >= 500 || status === 408) {
		return { message: said };
	}
	if (FREE_PLAN_STOPPED.test(said)) {
		return { message: TEXT.freePlanStopped, code: 'rejected' };
	}
	if (code && BALANCE_CODES.has(code)) {
		return { message: said, code: 'balance' };
	}
	// A 402 is "insufficient credits or payment is required": with a code other than a credits code, the plan refuses.
	if (code && (PLAN_CODES.has(code) || (status === 402 && code !== 'payment_required'))) {
		return { message: TEXT.plan(said), code: 'rejected' };
	}
	if (code === 'voice_not_found') {
		return { message: TEXT.voiceNotFound(said), code: 'rejected' };
	}
	if (code === 'voice_access_denied') {
		return { message: TEXT.voiceDenied(said), code: 'rejected' };
	}
	if (code && PERMISSION_CODES.has(code)) {
		return { message: TEXT.keyPermission(said), code: 'auth' };
	}
	if (code && CONCURRENCY_CODES.has(code)) {
		return { message: TEXT.concurrent(said), code: 'rateLimited' };
	}
	if (code === 'system_busy') {
		return { message: TEXT.busy, code: 'rateLimited' };
	}
	return { message: said };
}

export const ELEVENLABS: ProviderModule = Object.freeze({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ 'xi-api-key': credentials.apiKey }),
	readError,
	check,
	submit,
	poll,
	cancel,
	listVoices
});
