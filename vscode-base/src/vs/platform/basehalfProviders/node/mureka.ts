/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { measureItems, type MeasuredItem } from './check.js';
import { isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import type { HttpAnswer, ProviderHttp } from './http.js';
import { bufferSource, measure, MEDIA_MIME_TYPES, plannedItems, readMedia, type MediaInspector, type PlannedItem, type ReadMedia } from './media.js';
import type { ModuleCheckResult, ModulePollState, OutputLocation, ProviderModule } from './module.js';
import type { CatalogMode, CatalogModel, CatalogParameter, CatalogProvider, CheckRequest, SubmitRequest, TaskRef } from '../common/basehalfProviderTypes.js';

/**
 * Mureka's music models on Mureka's own API (`https://api.mureka.ai`), with
 * one API key as a bearer token (D78; `docs/specs/providers/mureka.md`, which
 * records the pages each fact comes from). From a Description is Mureka's
 * Prompt to song (`POST /v1/song/easy-generate`), which writes the lyrics and
 * sings them with the chosen model, or with Instrumental on its instrumental
 * call (`POST /v1/instrumental/generate`); From Lyrics is its Lyrics to song
 * (`POST /v1/song/generate`), with Style as its style prompt. A reference song
 * is uploaded before the task is created (`POST /v1/files/upload`). Every
 * request is a task, asked about at the query of its kind; a task that
 * succeeded gives one address per song. Mureka has no cancellation.
 */

type MurekaModelId = 'mureka-9.5' | 'mureka-o2';

/** The query that asks about a task: songs at `/v1/song/query/{id}`, instrumentals at `/v1/instrumental/query/{id}`. */
type TaskKind = 'song' | 'instrumental';

/** The formats Mureka takes a reference song in. */
type ReferenceFormat = 'mp3' | 'm4a';

// --- limits --------------------------------------------------------------------------------------

const MIB = 1024 * 1024;
/** The upload's "Size limit: 10 MB", read as MiB, as other modules read a file's MB. */
const REFERENCE_MAX_BYTES = 10 * MIB;
/** A reference song: "The supported audio duration range is [30,30] seconds, excess will be trimmed." */
const REFERENCE_SECONDS = 30;
/** The lyrics of Lyrics to song: "maximum 5000 characters". */
const LYRICS_MAX_LENGTH = 5000;
/** The prompt of Prompt to song: "maximum 2000 characters". */
const DESCRIPTION_MAX_LENGTH = 2000;
/** The prompt of the instrumental call, and the style (`prompt`) of Lyrics to song: "maximum 1024 characters". */
const SHORT_PROMPT_MAX_LENGTH = 1024;
/** `n`: "Defaults to 2, maximum 3." */
const MAX_SONGS = 3;
const DEFAULT_SONGS = 2;

// --- the provider's English texts, in one place so they can be translated -----------------------

const MODE_LABELS = Object.freeze({ reference: 'From a Description', lyrics: 'From Lyrics' });

const TEXT = Object.freeze({
	provider: 'Mureka',
	region: 'Global',
	apiKey: 'API Key',
	modes: MODE_LABELS,
	models: Object.freeze<Record<MurekaModelId, { readonly label: string; readonly description: string }>>({
		'mureka-9.5': {
			label: 'Mureka 9.5',
			description: 'Mureka\'s newest song model: up to 3 songs from a description, sung with lyrics Mureka writes or as instrumentals, or from lyrics and a style. A connected song of 30 seconds or more guides the music.'
		},
		'mureka-o2': {
			label: 'Mureka O2',
			description: 'Up to 3 songs from a description, sung with lyrics Mureka writes, or from lyrics and a style; no instrumentals. A connected song of 30 seconds or more guides the music.'
		}
	}),
	count: 'Songs',
	countTooltip: 'How many songs to make with one request. Each song lands on its own card.',
	instrumental: 'Instrumental',
	instrumentalTooltip: 'Music without singing, made from the description alone.',
	style: 'Style',
	styleTooltip: 'The style of the song: its genre, mood, instruments, and voice, such as "r&b, slow, passionate, male vocal".',
	descriptionTooLong: (length: number, label: string) => `The prompt is ${length} characters long; in ${MODE_LABELS.reference} mode, ${label} takes at most ${DESCRIPTION_MAX_LENGTH}.`,
	instrumentalTooLong: (length: number, label: string) => `The prompt is ${length} characters long; with Instrumental on, ${label} takes at most ${SHORT_PROMPT_MAX_LENGTH}.`,
	notReferenceFormat: (item: string) => `${item} is not an MP3 or M4A file; Mureka takes the reference song as MP3 or M4A.`,
	referenceTooShort: (item: string, seconds: string) => `${item} is ${seconds} seconds long; Mureka takes a reference song of at least ${REFERENCE_SECONDS} seconds and uses ${REFERENCE_SECONDS} seconds of it.`,
	instrumentalWithReference: (label: string) => `With Instrumental on, ${label} makes music from the description alone: remove the reference song, or turn Instrumental off.`,
	styleWithReference: (label: string) => `${label} follows Style or a reference song, not both: clear Style, or remove the reference song.`,
	noInstrumental: (label: string) => `${label} makes no instrumentals.`,
	notTaken: (item: string) => `${item} cannot be sent: Mureka takes one reference song and nothing else.`,
	noMode: (label: string, mode: string) => `${label} has no ${mode} mode.`,
	notOffered: (label: string) => `Mureka does not offer ${label} in this region.`,
	noModel: (id: string) => `Mureka has no model "${id}".`,
	uploadFailed: (item: string, detail: string) => `${item} could not be uploaded to Mureka: ${detail}`,
	uploadUnreadable: 'Mureka answered the upload in a form BaseHalf cannot read.',
	noTaskId: 'Mureka accepted the request but gave no task id BaseHalf can read.',
	notMurekaTask: (remoteId: string) => `The task ${remoteId} names no Mureka query, so BaseHalf cannot ask Mureka about it.`,
	unknownStatus: (status: string) => `Mureka reports a task status BaseHalf does not know: ${status || 'none'}.`,
	failed: 'Mureka reports that the task failed.',
	timedOut: 'Mureka stopped the task because it took too long.',
	cancelled: 'Mureka reports that the task was cancelled.',
	noSongs: 'Mureka reports that the task succeeded but gives no songs.',
	noAddress: 'Mureka gives no address for this song.',
	notServed: 'Mureka does not serve requests from this region.',
	answeredStatus: (status: number) => `Mureka answered with HTTP ${status}.`,
	concurrency: 'Mureka works on only as many generations at once as the account\'s top-up allows: wait for one to finish.'
});

// --- the models ----------------------------------------------------------------------------------

interface MurekaModel {
	readonly id: MurekaModelId;
	/** The id sent as `model`. */
	readonly providerModel: string;
	/** Mureka's instrumental call takes the model (`InstrumentalGenerateReq.model`). */
	readonly instrumental: boolean;
}

const MODELS_IN_ORDER: readonly MurekaModel[] = Object.freeze<MurekaModel[]>([
	{ id: 'mureka-9.5', providerModel: 'mureka-9.5', instrumental: true },
	// The instrumental call does not list mureka-o2 among its models.
	{ id: 'mureka-o2', providerModel: 'mureka-o2', instrumental: false }
]);

const MODELS: ReadonlyMap<string, MurekaModel> = new Map(MODELS_IN_ORDER.map(model => [model.id, model]));

// --- the catalog entry ---------------------------------------------------------------------------

const NONE = Object.freeze({ min: 0, max: 0 });

/** Both modes take 0 or 1 sound, the reference song, of at most 10 MiB. */
function modesOf(): CatalogMode[] {
	const inputs = { startFrame: 'none', endFrame: 'none', images: NONE, videos: NONE, audios: { min: 0, max: 1 }, source: 'none' } as const;
	const limits = { audioMaxBytes: REFERENCE_MAX_BYTES };
	return [
		{ id: 'reference', label: TEXT.modes.reference, inputs, limits },
		{ id: 'lyrics', label: TEXT.modes.lyrics, inputs, limits }
	];
}

function parametersOf(model: MurekaModel): CatalogParameter[] {
	const parameters: CatalogParameter[] = [
		// The shared name of Mureka's `n`.
		{ name: 'count', label: TEXT.count, tooltip: TEXT.countTooltip, kind: 'integer', min: 1, max: MAX_SONGS, step: 1, default: DEFAULT_SONGS }
	];
	if (model.instrumental) {
		// Not a field: it sends the description to the instrumental call instead of Prompt to song.
		parameters.push({ name: 'instrumental', label: TEXT.instrumental, tooltip: TEXT.instrumentalTooltip, kind: 'boolean', default: false, modes: ['reference'] });
	}
	// The shared name of the `prompt` of Lyrics to song, its style prompt.
	parameters.push({ name: 'style', label: TEXT.style, tooltip: TEXT.styleTooltip, kind: 'text', maxLength: SHORT_PROMPT_MAX_LENGTH, optional: true, modes: ['lyrics'] });
	return parameters;
}

function catalogModel(model: MurekaModel): CatalogModel {
	const text = TEXT.models[model.id];
	return {
		id: model.id,
		kind: 'audio',
		makes: 'music',
		label: text.label,
		description: text.description,
		providerModels: { global: model.providerModel },
		// The limit of the lyrics; `check` tells the shorter one of a description.
		prompt: { required: 'always', maxLength: LYRICS_MAX_LENGTH },
		modes: modesOf(),
		parameters: parametersOf(model),
		// Each choice's `url`; its lossless forms are `flac_url` and `wav_url`.
		outputFormat: 'mp3'
	};
}

const ENTRY: CatalogProvider = Object.freeze<CatalogProvider>({
	id: 'mureka',
	label: TEXT.provider,
	regions: [{ id: 'global', label: TEXT.region, baseUrl: 'https://api.mureka.ai', console: 'https://platform.mureka.ai/apiKeys' }],
	credentials: [{ id: 'apiKey', label: TEXT.apiKey }],
	models: MODELS_IN_ORDER.map(catalogModel)
});

// --- rules ---------------------------------------------------------------------------------------

function modelOf(id: string): MurekaModel {
	const model = MODELS.get(id);
	if (!model) {
		throw rejected(TEXT.noModel(id));
	}
	return model;
}

function labelOf(model: MurekaModel): string {
	return TEXT.models[model.id].label;
}

/** Whether the request makes an instrumental: From a Description with Instrumental on. */
function makesInstrumental(request: Pick<CheckRequest, 'mode' | 'params'>): boolean {
	return request.mode === 'reference' && request.params.instrumental === true;
}

/** The Style of a request in From Lyrics, when it says something. */
function styleOf(request: Pick<CheckRequest, 'mode' | 'params'>): string | undefined {
	const style = request.params.style;
	return request.mode === 'lyrics' && typeof style === 'string' && style.trim() ? style : undefined;
}

function seconds(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** What Mureka refuses of a reference song: a format other than MP3 or M4A, or less than the 30 seconds it uses. */
function referenceProblems(song: MeasuredItem): string[] {
	const { format, seconds: length } = song.facts;
	if (format !== 'mp3' && format !== 'm4a') {
		return [TEXT.notReferenceFormat(song.label)];
	}
	if (length !== undefined && length < REFERENCE_SECONDS - 0.05) {
		return [TEXT.referenceTooShort(song.label, seconds(length))];
	}
	return [];
}

/**
 * The rules the declarations cannot express (mureka.md, "Modes and inputs"):
 * the length of a description, the format and the length of the reference
 * song, and the reference song that neither an instrumental nor a Style takes.
 */
async function check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
	const model = modelOf(request.model);
	const label = labelOf(model);
	const problems: string[] = [];
	const instrumental = makesInstrumental(request);
	const length = [...request.prompt].length;
	if (request.mode === 'reference' && length > (instrumental ? SHORT_PROMPT_MAX_LENGTH : DESCRIPTION_MAX_LENGTH)) {
		problems.push(instrumental ? TEXT.instrumentalTooLong(length, label) : TEXT.descriptionTooLong(length, label));
	}
	const songs = (await measureItems(request.inputs, media)).filter(item => item.kind === 'audio');
	if (songs.length && instrumental) {
		problems.push(TEXT.instrumentalWithReference(label));
	}
	if (songs.length && styleOf(request) !== undefined) {
		problems.push(TEXT.styleWithReference(label));
	}
	for (const song of songs) {
		problems.push(...referenceProblems(song));
	}
	return { problems };
}

// --- the reference song --------------------------------------------------------------------------

const UPLOAD = '/v1/files/upload';

/** The reference song read whole, with the format its header shows. */
interface Reference {
	readonly item: PlannedItem;
	readonly read: ReadMedia;
	readonly format: ReferenceFormat;
}

async function readReference(item: PlannedItem): Promise<Reference> {
	const read = await readMedia(item.media, REFERENCE_MAX_BYTES, item.label);
	const { format } = await measure(bufferSource(read.bytes));
	if (format !== 'mp3' && format !== 'm4a') {
		throw rejected(TEXT.notReferenceFormat(item.label));
	}
	return { item, read, format };
}

/** An id of Mureka's answer as text: a string, or a whole number. */
function idOf(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value.trim() || undefined;
	}
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
}

/** Uploads the reference song for the purpose `reference` and answers its id, the `reference_id` of the request. */
async function upload(http: ProviderHttp, reference: Reference): Promise<string> {
	const { item, read, format } = reference;
	let answer: HttpAnswer;
	try {
		answer = await http.request({
			method: 'POST',
			path: UPLOAD,
			body: {
				kind: 'form',
				parts: [
					{ name: 'purpose', value: 'reference' },
					{ name: 'file', file: { bytes: read.bytes, fileName: `reference-song.${format}`, contentType: MEDIA_MIME_TYPES[format] } }
				]
			}
		});
	} catch (error) {
		if (error instanceof ProviderFailure) {
			// No task was made: say which input Mureka refused.
			throw new ProviderFailure(error.code === 'invalidResponse' ? 'rejected' : error.code, TEXT.uploadFailed(item.label, error.message), error.status);
		}
		throw error;
	}
	let id: string | undefined;
	try {
		id = idOf(answer.object().id);
	} catch {
		id = undefined;
	}
	if (!id) {
		throw rejected(TEXT.uploadFailed(item.label, TEXT.uploadUnreadable));
	}
	return id;
}

// --- requests ------------------------------------------------------------------------------------

/** Prompt to song: Mureka writes the lyrics from the description and sings them. */
const SONG_FROM_DESCRIPTION = '/v1/song/easy-generate';
/** Lyrics to song. */
const SONG_FROM_LYRICS = '/v1/song/generate';
const INSTRUMENTAL = '/v1/instrumental/generate';

/** The request that creates the task (mureka.md, "Requests"), with the query that asks about it. */
function createCall(request: SubmitRequest, sentModel: string, referenceId: string | undefined): { readonly kind: TaskKind; readonly path: string; readonly body: Record<string, unknown> } {
	const n = request.params.count;
	const reference = referenceId !== undefined ? { reference_id: referenceId } : {};
	if (request.mode === 'lyrics') {
		const style = styleOf(request);
		return { kind: 'song', path: SONG_FROM_LYRICS, body: { lyrics: request.prompt, model: sentModel, n, ...(style !== undefined ? { prompt: style } : {}), ...reference } };
	}
	if (makesInstrumental(request)) {
		return { kind: 'instrumental', path: INSTRUMENTAL, body: { model: sentModel, prompt: request.prompt, n } };
	}
	return { kind: 'song', path: SONG_FROM_DESCRIPTION, body: { model: sentModel, prompt: request.prompt, n, ...reference } };
}

async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string> {
	const model = modelOf(request.model);
	const label = labelOf(model);
	const sentModel = ENTRY.models.find(entry => entry.id === model.id)?.providerModels[request.region];
	if (!sentModel) {
		throw rejected(TEXT.notOffered(label));
	}
	if (request.mode !== 'reference' && request.mode !== 'lyrics') {
		throw rejected(TEXT.noMode(label, request.mode));
	}
	const instrumental = makesInstrumental(request);
	if (instrumental && !model.instrumental) {
		throw rejected(TEXT.noInstrumental(label));
	}
	// Each mode takes the reference song and nothing else; `check` has said so before.
	const items = plannedItems(request.inputs);
	const other = items.find(item => item.slot !== 'audio') ?? items[1];
	if (other) {
		throw rejected(TEXT.notTaken(other.label));
	}
	if (items.length && instrumental) {
		throw rejected(TEXT.instrumentalWithReference(label));
	}
	if (items.length && styleOf(request) !== undefined) {
		throw rejected(TEXT.styleWithReference(label));
	}
	// The song is read and checked, then uploaded, before the task is created.
	const referenceId = items.length ? await upload(http, await readReference(items[0])) : undefined;
	const call = createCall(request, sentModel, referenceId);
	const answer = await http.create({ method: 'POST', path: call.path, body: { kind: 'json', value: call.body } });
	const id = idOf(answer.object().id);
	if (!id) {
		throw unknownOutcome(TEXT.noTaskId);
	}
	return `${call.kind}/${id}`;
}

// --- tasks ---------------------------------------------------------------------------------------

const TASK_KINDS: ReadonlySet<string> = new Set<TaskKind>(['song', 'instrumental']);

/** The query and Mureka's id that a task id names: `song/<id>` or `instrumental/<id>`. */
function taskOf(remoteId: string): { readonly kind: TaskKind; readonly id: string } {
	const slash = remoteId.indexOf('/');
	const kind = slash > 0 ? remoteId.slice(0, slash) : '';
	const id = slash > 0 ? remoteId.slice(slash + 1) : '';
	if (!TASK_KINDS.has(kind) || !id) {
		throw rejected(TEXT.notMurekaTask(remoteId));
	}
	return { kind: kind as TaskKind, id };
}

/** The place of a choice among the choices, when Mureka gives it. */
function indexOf(choice: unknown): number | undefined {
	return isRecord(choice) && typeof choice.index === 'number' && Number.isSafeInteger(choice.index) ? choice.index : undefined;
}

/** One song per choice, in the order of the choices' `index`: its address, which lasts 30 days. */
function songsOf(task: Record<string, unknown>): OutputLocation[] {
	const choices: readonly unknown[] = Array.isArray(task.choices) ? task.choices : [];
	if (!choices.length) {
		throw unreadable(TEXT.noSongs);
	}
	const ordered = choices.every(choice => indexOf(choice) !== undefined)
		? [...choices].sort((a, b) => (indexOf(a) ?? 0) - (indexOf(b) ?? 0))
		: choices;
	return ordered.map((choice): OutputLocation => {
		const url = isRecord(choice) && typeof choice.url === 'string' ? choice.url.trim() : '';
		return url ? { url } : { refused: TEXT.noAddress };
	});
}

function stateOf(task: Record<string, unknown>): ModulePollState {
	const status = typeof task.status === 'string' ? task.status.trim().toLowerCase() : '';
	const reason = typeof task.failed_reason === 'string' && task.failed_reason.trim() ? task.failed_reason.trim() : undefined;
	switch (status) {
		case 'preparing':
		case 'queued':
			return { state: 'pending' };
		case 'running':
		// The phase of a request with `stream`, which BaseHalf does not send.
		case 'streaming':
			return { state: 'running' };
		case 'succeeded':
			return { state: 'succeeded', outputs: songsOf(task) };
		case 'failed':
			return { state: 'failed', message: reason ?? TEXT.failed };
		case 'timeouted':
			return { state: 'failed', message: reason ? `${TEXT.timedOut} (${reason})` : TEXT.timedOut };
		case 'cancelled':
			return { state: 'cancelled', message: reason ?? TEXT.cancelled };
		default:
			throw unreadable(TEXT.unknownStatus(status.slice(0, 40)));
	}
}

async function poll(ref: TaskRef, http: ProviderHttp): Promise<ModulePollState> {
	modelOf(ref.model);
	const task = taskOf(ref.remoteId);
	const answer = await http.request({ method: 'GET', path: `/v1/${task.kind}/query/${encodeURIComponent(task.id)}` });
	return stateOf(answer.object());
}

// --- errors --------------------------------------------------------------------------------------

/** The words of the 429 that says the account has no credits left: "You exceeded your current quota, please check your billing details". */
const NO_CREDITS = /current quota|billing|insufficient (?:balance|credits?)/i;

/** Mureka's words as a sentence, so that a note can follow them. */
function sentence(text: string): string {
	return /[.!?)]$/.test(text) ? text : `${text}.`;
}

/**
 * Reads an error answer, `{error: {message}, trace_id}` (mureka.md,
 * "Errors"): a 403 says that Mureka does not serve the region, which is no
 * fault of the key; a 429 is an empty balance when Mureka speaks of the
 * quota, and too many requests otherwise. Mureka's words refine a 4xx answer
 * only, so that a server error leaves a create's outcome unknown.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const said = readCommonError(body)?.message?.trim() || undefined;
	if (status < 400 || status >= 500 || status === 408) {
		return said ? { message: said } : undefined;
	}
	if (status === 403) {
		return { code: 'rejected', message: said ? `${TEXT.notServed} (${said})` : TEXT.notServed };
	}
	if (status === 429) {
		if (said && NO_CREDITS.test(said)) {
			return { code: 'balance', message: said };
		}
		return { code: 'rateLimited', message: `${sentence(said ?? TEXT.answeredStatus(status))} ${TEXT.concurrency}` };
	}
	return said ? { message: said } : undefined;
}

export const MUREKA: ProviderModule = Object.freeze<ProviderModule>({
	describe: () => ENTRY,
	headers: (credentials: Readonly<Record<string, string>>) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
	readError,
	check,
	submit,
	poll,
	// Mureka documents no cancellation: nothing is sent, and the task runs to its end.
	cancel: async () => false
});
