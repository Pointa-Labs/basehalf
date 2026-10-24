/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * A local provider of videos, images, and sounds for tests and the smoke
 * (D59, D64, D78). It answers like three providers' APIs, each under a path
 * of its own, and accepts one test key at each:
 *
 * - ByteDance's ModelArk (Volcengine Ark and BytePlus ModelArk) under
 *   `/api/v3`, with `Authorization: Bearer <key>`:
 *   - Seedance's task API: it checks the shape of a create request, moves
 *     each task from queued to running to succeeded over a few seconds,
 *     cancels a queued task on DELETE, and serves a small MP4 made for these
 *     tests from a separate path without a key, as a signed CDN link would be.
 *   - Seedream's `POST /images/generations`, which answers at once: it checks
 *     the shape of the request and answers small PNGs, one per image asked
 *     for (`max_images` of a set, otherwise one), as addresses it serves
 *     itself without a key (`response_format: url`, the default) or as base64
 *     (`b64_json`).
 * - ElevenLabs under `/elevenlabs`, with `xi-api-key: <key>`:
 *   - `POST /v1/text-to-speech/{voice}` and `POST /v1/sound-generation`
 *     check the request as ElevenLabs validates it (a list of the fields that
 *     do not validate, HTTP 422) and answer an MP3 at once, the voice too: a
 *     voice it does not know is not found (HTTP 404).
 *   - `GET /v2/voices` lists four voices with ElevenLabs' paging
 *     (`page_size`, at most 100, and `next_page_token` while `has_more`): two
 *     of the account (a clone and a designed voice), the default voice of
 *     BaseHalf's catalog, saved from the Voice Library, and George, one of
 *     ElevenLabs' Default voices (`premade`). Each has a `preview_url`, a
 *     short MP3 it serves without a key. The other five Voice Library voices
 *     of BaseHalf's catalog speak too, unlisted, as any account uses a
 *     library voice by its id.
 * - Mureka under `/mureka`, with `Authorization: Bearer <key>`:
 *   - `POST /v1/files/upload`, a multipart form of `purpose` and `file`,
 *     keeps the file and answers its id, which a song takes as
 *     `reference_id`.
 *   - `POST /v1/song/generate` (lyrics), `/v1/song/easy-generate` (a
 *     description), and `/v1/instrumental/generate` check the request and
 *     make a task, which `GET /v1/song/query/{id}` and
 *     `/v1/instrumental/query/{id}` move from preparing to running to
 *     succeeded over a few seconds, with `n` choices (2 unless asked), each
 *     the address of an MP3 it serves without a key.
 *
 * It never talks to a real provider.
 *
 *   node scripts/basehalf-video-mock-provider.mts \
 *     [--port <port>] [--key <key>] [--seconds <seconds>] [--fail <failure>]
 *
 * Its base URLs are `http://127.0.0.1:<port>/api/v3`,
 * `http://127.0.0.1:<port>/elevenlabs`, and `http://127.0.0.1:<port>/mureka`.
 * Failures, for every request (`--fail`, or `POST /__mock/configure` with
 * `{"fail": ...}`), or for one request through a marker in its prompt, its
 * text, its lyrics, or its description:
 *
 * - `key`: every key is refused (HTTP 401), in each API's form. Marker: none;
 *   use a wrong key.
 * - `reject` / `[mock:reject]`: the request is refused (HTTP 400).
 * - `task` / `[mock:fail]`: the task is made and later fails; of images, the
 *   last one is refused by the content check and the others are made; of a
 *   sound answered at once, the answer is not a sound.
 * - `expire` / `[mock:expire]`: the task is made and later expires; a song's
 *   task times out (`timeouted`).
 * - `drop` / `[mock:drop]`: the connection closes after the request arrived,
 *   without an answer: the outcome is unknown to the caller.
 * - `slow` / `[mock:slow]`: the task never finishes; images and sounds are
 *   answered only after the time a task takes (`--seconds`).
 * - `[mock:fewer]`: a set of images, or the songs of a task, has one fewer
 *   than asked.
 * - `[mock:jpeg]`: the images are JPEG files, also for a model that delivers
 *   PNG.
 *
 * `GET /__mock/requests` lists the requests received that create a task,
 * images, or a sound, and the uploads, without keys, with inline media
 * shortened, and with an upload's file as its name, type, and size. The
 * fixture video was recorded from a canvas animation with Chromium's
 * MediaRecorder and remuxed with avconvert: 2 s, 320×180, H.264. The fixture
 * JPEG is a PNG of one color, 16×16, converted with sips. A sound is an MP3
 * of silence, written here as MPEG-1 Layer III frames at 128 kbps, 3 s long,
 * or the length a sound effect asks for, and 12 s for a voice's sample. With
 * `uniqueFiles`, as the smoke starts it, each file it answers is its own, as
 * a real provider's are.
 */

import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import type { AddressInfo, Socket } from 'net';
import * as zlib from 'zlib';

export const MOCK_VIDEO_PROVIDER_KEY = 'basehalf-mock-key';
// The fixtures are in `scripts/fixtures/`; this module is in `src/vs/platform/basehalfProviders/test/node/`, or at the same depth in `out/`.
export const MOCK_VIDEO_FIXTURE_URL = new URL('../../../../../../scripts/fixtures/basehalf-video-mock.mp4', import.meta.url);
export const MOCK_JPEG_FIXTURE_URL = new URL('../../../../../../scripts/fixtures/basehalf-image-mock.jpg', import.meta.url);

export type MockVideoProviderFailure = 'none' | 'key' | 'reject' | 'task' | 'expire' | 'drop' | 'slow';
export const FAILURES: readonly MockVideoProviderFailure[] = ['none', 'key', 'reject', 'task', 'expire', 'drop', 'slow'];

export interface MockVideoProviderOptions {
	/** 0 chooses a free port. */
	readonly port?: number;
	readonly key?: string;
	/** How long a task takes from creation to its end. A third of it is queued. */
	readonly durationMs?: number;
	readonly fail?: MockVideoProviderFailure;
	/** The bytes served as the video; the fixture by default. */
	readonly video?: Buffer;
	/**
	 * Makes every file it answers a file of its own, as a real provider's are:
	 * a video ends with an MP4 `free` box, a PNG holds a `tEXt` chunk, a JPEG
	 * a comment, and an MP3 an ID3v1 tag, each naming its task, image, or
	 * sound. Without it, the files of every task are the same bytes.
	 */
	readonly uniqueFiles?: boolean;
}

/** A request as received, without its key: one that creates a task, images, or a sound, or an upload. */
export interface MockVideoProviderRequest {
	/**
	 * What it asked for: a video task or images answered at once (ModelArk);
	 * speech or a sound effect answered at once (ElevenLabs); a song or an
	 * instrumental task, or the upload of a file (Mureka).
	 */
	readonly kind: 'video' | 'image' | 'speech' | 'sound' | 'song' | 'instrumental' | 'upload';
	/** The task it made, by the provider's id; none for what is answered at once, an upload, and a refused request. */
	readonly taskId: string | undefined;
	readonly model: string | undefined;
	/**
	 * The text the card's prompt was sent as: the text item of `content`, the
	 * `prompt` of images, the `text` of speech and of a sound effect, the
	 * `lyrics` of a song from lyrics, and the `prompt` of a song or an
	 * instrumental from a description. A song's style and `n` are in `body`.
	 */
	readonly prompt: string | undefined;
	/** The voice of speech, as its path names it. */
	readonly voice?: string;
	/**
	 * The `content` items: `text`, `image_url <role> data:<type>`, `audio_url
	 * <role> data:<type>`; of images, each reference as `image data:<type>`;
	 * of an upload, each part of its form, `purpose=reference` or
	 * `file=<name> <type> <size> bytes`.
	 */
	readonly parts: readonly string[];
	/** The body with every data URL cut after its type; of an upload, its fields with the file by its name. */
	readonly body: Record<string, unknown> | undefined;
}

export interface MockVideoProvider {
	/** `http://127.0.0.1:<port>` */
	readonly url: string;
	/** The base URL to enter as ByteDance's endpoint: `http://127.0.0.1:<port>/api/v3`. */
	readonly baseUrl: string;
	/** The base URL to enter as ElevenLabs' endpoint: `http://127.0.0.1:<port>/elevenlabs`. */
	readonly elevenLabsUrl: string;
	/** The base URL to enter as Mureka's endpoint: `http://127.0.0.1:<port>/mureka`. */
	readonly murekaUrl: string;
	readonly key: string;
	readonly requests: readonly MockVideoProviderRequest[];
	configure(options: { readonly fail?: MockVideoProviderFailure; readonly durationMs?: number }): void;
	close(): Promise<void>;
}

type MockState = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

interface MockTask {
	readonly id: string;
	readonly model: string;
	readonly createdAt: number;
	readonly ends: 'succeeded' | 'failed' | 'expired';
	readonly slow: boolean;
	readonly params: Record<string, unknown>;
	cancelled: boolean;
}

/** A task of Mureka, of a song or an instrumental. */
interface MockSongTask {
	readonly id: string;
	/** The query that asks about it: `/v1/song/query/{id}` or `/v1/instrumental/query/{id}`. */
	readonly kind: 'song' | 'instrumental';
	readonly model: string;
	readonly createdAt: number;
	/** How many songs it was asked for. */
	readonly n: number;
	readonly ends: 'succeeded' | 'failed' | 'timeouted';
	readonly slow: boolean;
	/** It gives one song fewer than asked. */
	readonly fewer: boolean;
}

const RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
const RESOLUTIONS = new Set(['480p', '720p', '1080p', '4k']);
const IMAGE_ROLES = new Set(['first_frame', 'last_frame', 'reference_image']);

/** How long a sound the provider answers lasts, unless a sound effect asks for its length: long enough to be seen playing. */
const MOCK_SOUND_SECONDS = 3;
/** How long a voice's sample lasts: long enough to be stopped while it plays. */
const MOCK_SAMPLE_SECONDS = 12;

/**
 * The voices the local ElevenLabs lists, in its order (`GET /v2/voices`,
 * without their samples' addresses): two of the account, a clone and a
 * designed voice; the default voice of BaseHalf's catalog, Eldrin, which the
 * account saved from the Voice Library; and George, one of ElevenLabs'
 * Default voices.
 */
const ELEVENLABS_LISTED_VOICES: readonly Readonly<Record<string, unknown> & { readonly voice_id: string }>[] = Object.freeze([
	{ voice_id: 'bhCoastNarrator00001', name: 'Coast Narrator', category: 'cloned', labels: {}, description: 'My own voice, read slowly.' },
	{ voice_id: 'bhSeaCaptain00000002', name: 'Sea Captain', category: 'generated', labels: { gender: 'male', age: 'old', descriptive: 'gravelly' }, description: 'A weathered sea captain.' },
	{ voice_id: '6WwXjDDEMyNmFG95zycZ', name: 'Eldrin', category: 'professional', labels: { gender: 'male', age: 'middle_aged', accent: 'british', descriptive: 'crisp', use_case: 'narrative_story' }, description: 'Crisp British baritone' },
	{ voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade', labels: { accent: 'british', descriptive: 'warm', age: 'middle_aged', gender: 'male', use_case: 'narrative_story' }, description: null }
]);
/** Every voice the local ElevenLabs speaks in: the listed ones, and the other Voice Library voices of BaseHalf's catalog, which an account uses by their ids. */
const ELEVENLABS_VOICES: ReadonlySet<string> = new Set([
	...ELEVENLABS_LISTED_VOICES.map(voice => voice.voice_id),
	'WQP7cQUF5aAS6Axh5yaa', 'OZ0L6eISlOejga3XjDFt', 'gOupLcAkjEnguROwi4oS', 'BFd5oBc2DDna33pSi4Gf', 'fnYMz3F5gMEDGMWcH1ex'
]);
/** The models of ElevenLabs' text to speech, and of its sound effects. */
const ELEVENLABS_SPEECH_MODELS: readonly string[] = ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2', 'eleven_turbo_v2_5', 'eleven_turbo_v2'];
const ELEVENLABS_SOUND_MODELS: readonly string[] = ['eleven_text_to_sound_v2'];
/** The formats of `output_format` that the local ElevenLabs makes: MP3 alone. */
const ELEVENLABS_MP3_FORMATS: readonly string[] = ['mp3_22050_32', 'mp3_24000_48', 'mp3_44100_32', 'mp3_44100_64', 'mp3_44100_96', 'mp3_44100_128', 'mp3_44100_192'];

/** Mureka's creates by their paths: the query that asks about the task, and whether the card's prompt is the lyrics. */
const MUREKA_CREATES: ReadonlyMap<string, { readonly kind: MockSongTask['kind']; readonly fromLyrics: boolean }> = new Map([
	['/v1/song/generate', { kind: 'song', fromLyrics: true }],
	['/v1/song/easy-generate', { kind: 'song', fromLyrics: false }],
	['/v1/instrumental/generate', { kind: 'instrumental', fromLyrics: false }]
]);
const MUREKA_SONG_MODELS: readonly string[] = ['auto', 'mureka-7.6', 'mureka-o2', 'mureka-8', 'mureka-9', 'mureka-9.5'];
const MUREKA_INSTRUMENTAL_MODELS: readonly string[] = ['auto', 'mureka-7.6', 'mureka-8', 'mureka-9', 'mureka-9.5'];
const MUREKA_UPLOAD_PURPOSES: readonly string[] = ['reference', 'melody', 'instrumental', 'voice', 'audio', 'remix'];
/** "Size limit: 10 MB". */
const MUREKA_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export async function startMockVideoProvider(options: MockVideoProviderOptions = {}): Promise<MockVideoProvider> {
	const key = options.key ?? MOCK_VIDEO_PROVIDER_KEY;
	const video = options.video ?? readFileSync(MOCK_VIDEO_FIXTURE_URL);
	const uniqueFiles = options.uniqueFiles === true;
	let fail: MockVideoProviderFailure = options.fail ?? 'none';
	let durationMs = options.durationMs ?? 3_000;
	const tasks = new Map<string, MockTask>();
	/** The images answered as addresses, by their path under `/files/images/`. */
	const images = new Map<string, { readonly bytes: Buffer; readonly type: string }>();
	/** Mureka's tasks of songs and instrumentals, by Mureka's id, and the files uploaded to it. */
	const songs = new Map<string, MockSongTask>();
	const uploads = new Map<string, { readonly purpose: string; readonly bytes: number }>();
	let nextSongTask = 1_436_211;
	let nextUpload = 542_321;
	const requests: MockVideoProviderRequest[] = [];
	const sockets = new Set<Socket>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let origin = '';

	const { createServer } = await import('http');
	const server: Server = createServer((request, response) => {
		void handle(request, response).catch(error => {
			if (!response.headersSent) {
				json(response, 500, { error: { code: 'InternalServiceError', message: `The mock provider failed: ${error instanceof Error ? error.message : String(error)}`, type: 'InternalServerError' } });
			} else {
				response.destroy();
			}
		});
	});
	server.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? '/', origin);
		const path = url.pathname;
		const body = await readBody(request);

		if (path === '/__mock/configure' && request.method === 'POST') {
			const settings = parseJson(body) ?? {};
			if (typeof settings.fail === 'string' && (FAILURES as readonly string[]).includes(settings.fail)) {
				fail = settings.fail as MockVideoProviderFailure;
			}
			if (typeof settings.durationMs === 'number' && settings.durationMs >= 0) {
				durationMs = settings.durationMs;
			}
			json(response, 200, { fail, durationMs });
			return;
		}
		if (path === '/__mock/requests' && request.method === 'GET') {
			json(response, 200, { requests });
			return;
		}
		if (path.startsWith('/files/images/') && request.method === 'GET') {
			// An image's address: no key, like a signed link.
			const image = images.get(decodeURIComponent(path.slice('/files/images/'.length)));
			if (!image) {
				json(response, 404, { error: { code: 'NoSuchKey', message: 'The specified key does not exist.' } });
				return;
			}
			response.writeHead(200, { 'Content-Type': image.type, 'Content-Length': String(image.bytes.byteLength) });
			response.end(image.bytes);
			return;
		}
		if (path.startsWith('/files/voices/') && request.method === 'GET') {
			// A voice's sample, on ElevenLabs' storage: no key.
			const voice = ELEVENLABS_LISTED_VOICES.find(candidate => `${candidate.voice_id}.mp3` === decodeURIComponent(path.slice('/files/voices/'.length)));
			if (!voice) {
				json(response, 404, { error: { code: 'NoSuchKey', message: 'The specified key does not exist.' } });
				return;
			}
			sendSound(response, mockMp3(MOCK_SAMPLE_SECONDS, uniqueFiles ? `sample-${voice.voice_id}` : undefined));
			return;
		}
		if (path.startsWith('/files/songs/') && request.method === 'GET') {
			// A song of a task that succeeded, on Mureka's file host: no key.
			const name = /^(?<kind>song|instrumental)-(?<id>\d+)-(?<index>\d+)\.mp3$/.exec(decodeURIComponent(path.slice('/files/songs/'.length)))?.groups;
			const task = name ? songs.get(name.id) : undefined;
			if (!name || !task || task.kind !== name.kind || songStateOf(task) !== 'succeeded' || Number(name.index) >= songsOf(task)) {
				json(response, 404, { error: { message: 'Not Found' } });
				return;
			}
			sendSound(response, mockMp3(MOCK_SOUND_SECONDS, uniqueFiles ? `${name.kind}-${name.id}-${name.index}` : undefined));
			return;
		}
		if (path.startsWith('/files/') && request.method === 'GET') {
			// A CDN address: no key, like a signed link.
			const id = decodeURIComponent(path.slice('/files/'.length).replace(/\.mp4$/, ''));
			if (!tasks.has(id) || stateOf(tasks.get(id)!) !== 'succeeded') {
				json(response, 404, { error: { code: 'NoSuchKey', message: 'The specified key does not exist.' } });
				return;
			}
			const file = uniqueFiles ? withFreeBox(video, id) : video;
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(file.byteLength) });
			response.end(file);
			return;
		}
		if (path === '/elevenlabs' || path.startsWith('/elevenlabs/')) {
			elevenLabs(request, response, url, path.slice('/elevenlabs'.length), body);
			return;
		}
		if (path === '/mureka' || path.startsWith('/mureka/')) {
			mureka(request, response, path.slice('/mureka'.length), body);
			return;
		}
		if (!path.startsWith('/api/v3/')) {
			json(response, 404, { error: { code: 'PathNotFound', message: 'The path of api not found.' } });
			return;
		}
		if (fail === 'key' || request.headers.authorization !== `Bearer ${key}`) {
			json(response, 401, { error: { code: 'AuthenticationError', message: 'The API key in the request is missing or invalid.', type: 'Unauthorized' } });
			return;
		}
		if (path === '/api/v3/images/generations') {
			if (request.method !== 'POST') {
				json(response, 405, { error: { code: 'InvalidAction', message: `${request.method} is not allowed at ${path}.` } });
				return;
			}
			createImages(request, response, parseJson(body));
			return;
		}
		const taskPath =/^\/api\/v3\/contents\/generations\/tasks(?:\/(?<id>[^/]+))?$/.exec(path);
		if (!taskPath) {
			json(response, 404, { error: { code: 'InvalidAction', message: `The specified action is invalid: ${request.method} ${path}` } });
			return;
		}
		const id = taskPath.groups?.id ? decodeURIComponent(taskPath.groups.id) : undefined;
		if (request.method === 'POST' && !id) {
			await create(request, response, parseJson(body));
			return;
		}
		const task = id ? tasks.get(id) : undefined;
		if (!task) {
			json(response, 404, { error: { code: 'ResourceNotFound', message: 'The specified task does not exist.', type: 'NotFound' } });
			return;
		}
		if (request.method === 'GET') {
			json(response, 200, taskObject(task));
			return;
		}
		if (request.method === 'DELETE') {
			// A queued task is cancelled; a task that ended loses its record; a running or cancelled one stays.
			const state = stateOf(task);
			if (state === 'queued') {
				task.cancelled = true;
				json(response, 200, {});
			} else if (state === 'running' || state === 'cancelled') {
				json(response, 400, { error: { code: 'InvalidParameter', message: `A ${state} task cannot be cancelled or deleted.`, type: 'BadRequest' } });
			} else {
				tasks.delete(task.id);
				json(response, 200, {});
			}
			return;
		}
		json(response, 405, { error: { code: 'InvalidAction', message: `${request.method} is not allowed at ${path}.` } });
	}

	async function create(request: IncomingMessage, response: ServerResponse, payload: Record<string, unknown> | undefined): Promise<void> {
		const prompt = textOf(payload);
		const parts = Array.isArray(payload?.content) ? payload.content.map(partOf) : [];
		const model = typeof payload?.model === 'string' ? payload.model : undefined;
		const marker = (name: string) => prompt?.includes(`[mock:${name}]`) === true;
		const invalid = invalidField(payload);
		if (invalid || fail === 'reject' || marker('reject')) {
			requests.push({ kind: 'video', taskId: undefined, model, prompt, parts, body: redact(payload) });
			json(response, 400, invalid
				? { error: { code: 'InvalidParameter', message: `The parameter \`${invalid}\` specified in the request is not valid.`, type: 'BadRequest' } }
				: { error: { code: 'InputTextSensitiveContentDetected', message: 'The request was refused: the prompt may contain sensitive content.', type: 'BadRequest' } });
			return;
		}
		const task: MockTask = {
			id: `cgt-${Date.now()}-${randomBytes(3).toString('hex')}`,
			model: model!,
			createdAt: Date.now(),
			ends: fail === 'task' || marker('fail') ? 'failed' : fail === 'expire' || marker('expire') ? 'expired' : 'succeeded',
			slow: fail === 'slow' || marker('slow'),
			params: { ...payload, content: undefined, model: undefined },
			cancelled: false
		};
		tasks.set(task.id, task);
		requests.push({ kind: 'video', taskId: task.id, model, prompt, parts, body: redact(payload) });
		if (fail === 'drop' || marker('drop')) {
			// The provider made the task, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		json(response, 200, { id: task.id });
	}

	/** Answers a request for images at once, as Seedream does: one entry of `data` per image, in order. */
	function createImages(request: IncomingMessage, response: ServerResponse, payload: Record<string, unknown> | undefined): void {
		const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined;
		const model = typeof payload?.model === 'string' ? payload.model : undefined;
		const references = typeof payload?.image === 'string' ? [payload.image] : Array.isArray(payload?.image) ? payload.image : [];
		const parts = references.map(reference => typeof reference === 'string' && reference.startsWith('data:') ? `image ${reference.slice(0, reference.indexOf(';'))}` : 'image url');
		const marker = (name: string) => prompt?.includes(`[mock:${name}]`) === true;
		const invalid = invalidImageField(payload);
		requests.push({ kind: 'image', taskId: undefined, model, prompt, parts, body: redact(payload) });
		if (invalid || fail === 'reject' || marker('reject')) {
			json(response, 400, invalid
				? { error: { code: 'InvalidParameter', message: `The parameter \`${invalid}\` specified in the request is not valid.`, type: 'BadRequest' } }
				: { error: { code: 'InputTextSensitiveContentDetected', message: 'The request was refused: the prompt may contain sensitive content.', type: 'BadRequest' } });
			return;
		}
		if (fail === 'drop' || marker('drop')) {
			// The provider made the images, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		const options = payload!.sequential_image_generation_options;
		const asked = payload!.sequential_image_generation === 'auto' ? (isRecord(options) && typeof options.max_images === 'number' ? options.max_images : 15) : 1;
		const made = marker('fewer') && asked > 1 ? asked - 1 : asked;
		const id = `img-${Date.now()}-${randomBytes(3).toString('hex')}`;
		const jpeg = marker('jpeg');
		const data: Record<string, unknown>[] = [];
		for (let number = 1; number <= made; number++) {
			if (number === made && (fail === 'task' || marker('fail'))) {
				data.push({ error: { code: 'OutputImageSensitiveContentDetected', message: 'The image could not be made: the output may contain sensitive content.' } });
				continue;
			}
			const tag = uniqueFiles ? `${id}-${number}` : undefined;
			const image = jpeg ? withJpegComment(readFileSync(MOCK_JPEG_FIXTURE_URL), tag) : mockPng(number, tag);
			const format = jpeg ? 'jpeg' : 'png';
			if (payload!.response_format === 'b64_json') {
				data.push({ b64_json: image.toString('base64'), size: `${MOCK_IMAGE_SIDE}x${MOCK_IMAGE_SIDE}`, output_format: format });
			} else {
				const name = `${id}-${number}.${jpeg ? 'jpg' : 'png'}`;
				images.set(name, { bytes: image, type: `image/${format}` });
				data.push({ url: `${origin}/files/images/${encodeURIComponent(name)}`, size: `${MOCK_IMAGE_SIDE}x${MOCK_IMAGE_SIDE}`, output_format: format });
			}
		}
		const generated = data.filter(entry => entry.error === undefined).length;
		const answer = () => json(response, 200, { model, created: Math.floor(Date.now() / 1000), data, usage: { generated_images: generated, output_tokens: generated * 4096, total_tokens: generated * 4096 } });
		if (fail === 'slow' || marker('slow')) {
			later(answer);
			return;
		}
		answer();
	}

	/** Calls `answer` once a task's time has passed, unless the provider closes first. */
	function later(answer: () => void): void {
		const timer = setTimeout(() => {
			timers.delete(timer);
			answer();
		}, durationMs);
		timers.add(timer);
	}

	// --- ElevenLabs ------------------------------------------------------------------------------

	/** ElevenLabs' API under `/elevenlabs`: speech and sound effects, answered at once, and the voices. */
	function elevenLabs(request: IncomingMessage, response: ServerResponse, url: URL, path: string, body: Buffer): void {
		if (fail === 'key' || request.headers['xi-api-key'] !== key) {
			// ElevenLabs' answer to a missing or wrong key, in the form it still sends.
			json(response, 401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
			return;
		}
		if (path === '/v2/voices' && request.method === 'GET') {
			listVoices(response, url);
			return;
		}
		const speech = /^\/v1\/text-to-speech\/(?<voice>[^/]+)$/.exec(path)?.groups;
		if (request.method === 'POST' && (speech || path === '/v1/sound-generation')) {
			makeSound(request, response, url, speech ? decodeURIComponent(speech.voice) : undefined, parseJson(body));
			return;
		}
		// The answer of ElevenLabs' framework to a path it does not have.
		json(response, 404, { detail: 'Not Found' });
	}

	/** Speech in `voice`, or without a voice a sound effect: checked, recorded, and answered at once with an MP3. */
	function makeSound(request: IncomingMessage, response: ServerResponse, url: URL, voice: string | undefined, payload: Record<string, unknown> | undefined): void {
		const text = typeof payload?.text === 'string' ? payload.text : undefined;
		const kind = voice === undefined ? 'sound' : 'speech';
		requests.push({ kind, taskId: undefined, model: typeof payload?.model_id === 'string' ? payload.model_id : undefined, prompt: text, ...(voice !== undefined ? { voice } : {}), parts: [], body: redact(payload) });
		const marker = (name: string) => text?.includes(`[mock:${name}]`) === true;
		const invalid = invalidSoundFields(kind, url, payload);
		if (invalid.length) {
			// A request that does not validate: each field with what is wrong with it.
			json(response, 422, { detail: invalid.map(([loc, msg]) => ({ loc, msg, type: 'value_error' })) });
			return;
		}
		if (voice !== undefined && !ELEVENLABS_VOICES.has(voice)) {
			json(response, 404, { detail: { type: 'not_found', code: 'voice_not_found', message: `A voice with the voice_id ${voice} was not found.`, status: 'voice_not_found', request_id: randomBytes(16).toString('hex') } });
			return;
		}
		if (fail === 'reject' || marker('reject')) {
			json(response, 400, { detail: { message: 'The request was refused: the text may contain content that is not allowed.' } });
			return;
		}
		if (fail === 'drop' || marker('drop')) {
			// ElevenLabs made the sound, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		const seconds = kind === 'sound' && typeof payload?.duration_seconds === 'number' ? payload.duration_seconds : MOCK_SOUND_SECONDS;
		const sound = fail === 'task' || marker('fail')
			? Buffer.from('<html><body>The sound could not be made.</body></html>', 'utf8')
			: mockMp3(seconds, uniqueFiles ? `${kind}-${Date.now()}-${randomBytes(3).toString('hex')}` : undefined);
		const answer = () => sendSound(response, sound);
		if (fail === 'slow' || marker('slow')) {
			later(answer);
			return;
		}
		answer();
	}

	/** `GET /v2/voices`: the voices, `page_size` at a time, from the offset that `next_page_token` names. */
	function listVoices(response: ServerResponse, url: URL): void {
		const size = Number(url.searchParams.get('page_size') ?? 10);
		const token = url.searchParams.get('next_page_token');
		const offset = token === null ? 0 : Number(/^offset:(?<offset>\d+)$/.exec(Buffer.from(token, 'base64url').toString('utf8'))?.groups?.offset ?? Number.NaN);
		const invalid: [string[], string][] = [
			...(!Number.isInteger(size) || size < 1 || size > 100 ? [[['query', 'page_size'], 'Input should be between 1 and 100']] as [string[], string][] : []),
			...(!Number.isInteger(offset) || offset > ELEVENLABS_LISTED_VOICES.length ? [[['query', 'next_page_token'], 'Invalid page token']] as [string[], string][] : [])
		];
		if (invalid.length) {
			json(response, 422, { detail: invalid.map(([loc, msg]) => ({ loc, msg, type: 'value_error' })) });
			return;
		}
		const end = offset + size;
		const more = end < ELEVENLABS_LISTED_VOICES.length;
		json(response, 200, {
			voices: ELEVENLABS_LISTED_VOICES.slice(offset, end).map(voice => ({ ...voice, preview_url: `${origin}/files/voices/${encodeURIComponent(voice.voice_id)}.mp3`, available_for_tiers: [] })),
			has_more: more,
			total_count: ELEVENLABS_LISTED_VOICES.length,
			next_page_token: more ? Buffer.from(`offset:${end}`, 'utf8').toString('base64url') : null
		});
	}

	// --- Mureka ----------------------------------------------------------------------------------

	/** Mureka's API under `/mureka`: uploads, the tasks of songs and instrumentals, and their queries. */
	function mureka(request: IncomingMessage, response: ServerResponse, path: string, body: Buffer): void {
		if (fail === 'key' || request.headers.authorization !== `Bearer ${key}`) {
			murekaError(response, 401, 'Invalid Authentication');
			return;
		}
		if (path === '/v1/files/upload' && request.method === 'POST') {
			upload(request, response, body);
			return;
		}
		const create = MUREKA_CREATES.get(path);
		if (create && request.method === 'POST') {
			createSongTask(request, response, path, create, parseJson(body));
			return;
		}
		const query = /^\/v1\/(?<kind>song|instrumental)\/query\/(?<id>[^/]+)$/.exec(path)?.groups;
		const task = query && request.method === 'GET' ? songs.get(decodeURIComponent(query.id)) : undefined;
		if (!task || task.kind !== query?.kind) {
			murekaError(response, 404, 'Not Found');
			return;
		}
		json(response, 200, songTaskObject(task));
	}

	/** `POST /v1/files/upload`: a multipart form of `purpose` and `file`, answered with the file's id. */
	function upload(request: IncomingMessage, response: ServerResponse, body: Buffer): void {
		const parts = multipartFormParts(request.headers['content-type'], body) ?? [];
		const purpose = parts.find(part => part.name === 'purpose' && part.fileName === undefined)?.bytes.toString('utf8');
		const file = parts.find(part => part.name === 'file' && part.fileName !== undefined);
		requests.push({
			kind: 'upload',
			taskId: undefined,
			model: undefined,
			prompt: undefined,
			parts: parts.map(part => part.fileName === undefined
				? `${part.name}=${part.bytes.toString('utf8')}`
				: `${part.name}=${part.fileName} ${part.contentType ?? 'application/octet-stream'} ${part.bytes.byteLength} bytes`),
			body: { ...(purpose !== undefined ? { purpose } : {}), ...(file ? { file: file.fileName } : {}) }
		});
		const invalid = !parts.length ? 'the request is not a multipart form'
			: purpose === undefined || !MUREKA_UPLOAD_PURPOSES.includes(purpose) ? `purpose must be one of ${MUREKA_UPLOAD_PURPOSES.join(', ')}`
				: !file?.bytes.byteLength ? 'file is required'
					: file.bytes.byteLength > MUREKA_UPLOAD_MAX_BYTES ? 'file is larger than 10 MB' : undefined;
		if (invalid !== undefined || purpose === undefined || !file) {
			murekaError(response, 400, `Invalid Request: ${invalid}.`);
			return;
		}
		const id = String(nextUpload++);
		uploads.set(id, { purpose, bytes: file.bytes.byteLength });
		json(response, 200, { id, bytes: file.bytes.byteLength, created_at: Math.floor(Date.now() / 1000), filename: file.fileName, purpose });
	}

	/** A create of a song or an instrumental: checked, recorded, and answered with its task, which starts preparing. */
	function createSongTask(request: IncomingMessage, response: ServerResponse, path: string, create: { readonly kind: MockSongTask['kind']; readonly fromLyrics: boolean }, payload: Record<string, unknown> | undefined): void {
		const text = (name: string) => typeof payload?.[name] === 'string' ? payload[name] as string : undefined;
		const prompt = create.fromLyrics ? text('lyrics') : text('prompt');
		const model = text('model');
		const marker = (name: string) => [text('lyrics'), text('prompt')].some(value => value?.includes(`[mock:${name}]`) === true);
		const invalid = invalidSongField(path, payload, uploads);
		const id = invalid === undefined && fail !== 'reject' && !marker('reject') ? String(nextSongTask++) : undefined;
		requests.push({ kind: create.kind, taskId: id, model, prompt, parts: [], body: redact(payload) });
		if (id === undefined) {
			murekaError(response, 400, invalid !== undefined ? `Invalid Request: ${invalid}.` : 'The request was refused: the prompt may contain content that is not allowed.');
			return;
		}
		const task: MockSongTask = {
			id,
			kind: create.kind,
			model: model!,
			createdAt: Date.now(),
			n: typeof payload?.n === 'number' ? payload.n : 2,
			ends: fail === 'task' || marker('fail') ? 'failed' : fail === 'expire' || marker('expire') ? 'timeouted' : 'succeeded',
			slow: fail === 'slow' || marker('slow'),
			fewer: marker('fewer')
		};
		songs.set(id, task);
		if (fail === 'drop' || marker('drop')) {
			// Mureka made the task, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		json(response, 200, { id, created_at: Math.floor(task.createdAt / 1000), model: task.model, status: 'preparing', trace_id: randomBytes(16).toString('hex') });
	}

	/** A song's task: preparing for the first third of its time, then running, then succeeded, failed, or timed out. */
	function songStateOf(task: MockSongTask): 'preparing' | 'running' | MockSongTask['ends'] {
		const elapsed = Date.now() - task.createdAt;
		if (elapsed < durationMs / 3) {
			return 'preparing';
		}
		return task.slow || elapsed < durationMs ? 'running' : task.ends;
	}

	/** How many songs a task that succeeded gives: `n`, or one fewer with `[mock:fewer]`. */
	function songsOf(task: MockSongTask): number {
		return task.fewer && task.n > 1 ? task.n - 1 : task.n;
	}

	/** A task as Mureka's query answers it: with a choice per song once it succeeded, each the address of its MP3. */
	function songTaskObject(task: MockSongTask): Record<string, unknown> {
		const state = songStateOf(task);
		return {
			id: task.id,
			created_at: Math.floor(task.createdAt / 1000),
			model: task.model,
			status: state,
			...(state === 'failed' ? { failed_reason: 'The song could not be made: the lyrics may contain content that is not allowed.' } : {}),
			...(state === 'succeeded' ? {
				finished_at: Math.floor((task.createdAt + durationMs) / 1000),
				choices: Array.from({ length: songsOf(task) }, (_unused, index) => ({
					index,
					id: `${task.id}-${index}`,
					url: `${origin}/files/songs/${task.kind}-${task.id}-${index}.mp3`,
					duration: MOCK_SOUND_SECONDS * 1000
				}))
			} : {}),
			trace_id: randomBytes(16).toString('hex')
		};
	}

	function stateOf(task: MockTask): MockState {
		if (task.cancelled) {
			return 'cancelled';
		}
		const elapsed = Date.now() - task.createdAt;
		if (elapsed < durationMs / 3) {
			return 'queued';
		}
		if (task.slow || elapsed < durationMs) {
			return 'running';
		}
		return task.ends;
	}

	function taskObject(task: MockTask): Record<string, unknown> {
		const state = stateOf(task);
		const duration = typeof task.params.duration === 'number' && task.params.duration > 0 ? task.params.duration : 5;
		return {
			id: task.id,
			model: task.model,
			status: state,
			...(state === 'succeeded' ? { content: { video_url: `${origin}/files/${encodeURIComponent(task.id)}.mp4` } } : {}),
			error: state === 'failed' ? { code: 'OutputVideoSensitiveContentDetected', message: 'The video could not be made: the output may contain sensitive content.' } : null,
			created_at: Math.floor(task.createdAt / 1000),
			updated_at: Math.floor(Date.now() / 1000),
			resolution: task.params.resolution ?? '720p',
			ratio: task.params.ratio ?? 'adaptive',
			duration,
			framespersecond: 24,
			...(typeof task.params.generate_audio === 'boolean' ? { generate_audio: task.params.generate_audio } : {}),
			execution_expires_after: 172800,
			...(state === 'succeeded' ? { usage: { completion_tokens: 108000, total_tokens: 108000 } } : {})
		};
	}

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
	});
	const address = server.address() as AddressInfo;
	origin = `http://127.0.0.1:${address.port}`;

	return {
		url: origin,
		baseUrl: `${origin}/api/v3`,
		elevenLabsUrl: `${origin}/elevenlabs`,
		murekaUrl: `${origin}/mureka`,
		key,
		requests,
		configure(settings) {
			if (settings.fail !== undefined) {
				fail = settings.fail;
			}
			if (settings.durationMs !== undefined) {
				durationMs = settings.durationMs;
			}
		},
		close() {
			for (const timer of timers) {
				clearTimeout(timer);
			}
			for (const socket of sockets) {
				socket.destroy();
			}
			return new Promise(resolve => server.close(() => resolve()));
		}
	};
}

const IMAGE_SIZES = /^(?:1K|1\.5K|2K|3K|4K|[1-9]\d{1,4}x[1-9]\d{1,4})$/;
const DATA_IMAGE = /^data:image\/[a-z]+;base64,/;

/** The first field of a request for images that Seedream would refuse, by its own documented rules. */
function invalidImageField(payload: Record<string, unknown> | undefined): string | undefined {
	if (!payload || typeof payload.model !== 'string' || !payload.model) {
		return 'model';
	}
	if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
		return 'prompt';
	}
	const image = payload.image;
	if (image !== undefined && !(typeof image === 'string' ? DATA_IMAGE.test(image) : Array.isArray(image) && image.length >= 1 && image.length <= 14 && image.every(entry => typeof entry === 'string' && DATA_IMAGE.test(entry)))) {
		return 'image';
	}
	if (payload.size !== undefined && !(typeof payload.size === 'string' && IMAGE_SIZES.test(payload.size))) {
		return 'size';
	}
	const choices: Readonly<Record<string, readonly unknown[]>> = {
		sequential_image_generation: ['auto', 'disabled'],
		output_format: ['png', 'jpeg'],
		response_format: ['url', 'b64_json'],
		background: ['transparent', 'opaque']
	};
	for (const [name, values] of Object.entries(choices)) {
		if (payload[name] !== undefined && !values.includes(payload[name])) {
			return name;
		}
	}
	const options = payload.sequential_image_generation_options;
	if (options !== undefined && !(isRecord(options) && Number.isInteger(options.max_images) && (options.max_images as number) >= 1 && (options.max_images as number) <= 15)) {
		return 'sequential_image_generation_options.max_images';
	}
	const optimize = payload.optimize_prompt_options;
	if (optimize !== undefined && !(isRecord(optimize) && (optimize.mode === 'standard' || optimize.mode === 'fast'))) {
		return 'optimize_prompt_options.mode';
	}
	if (payload.watermark !== undefined && typeof payload.watermark !== 'boolean') {
		return 'watermark';
	}
	return undefined;
}

/** The side of the images answered: small, and large enough to see on a card. */
const MOCK_IMAGE_SIDE = 16;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

/** A small RGB PNG of one color, another for each number, so that the images of a set differ; with `tag`, it holds it as a text chunk. */
export function mockPng(number: number, tag?: string): Buffer {
	const color = [(37 * number) % 256, (91 * number + 64) % 256, (53 * number + 128) % 256];
	const row = Buffer.alloc(1 + MOCK_IMAGE_SIDE * 3);
	for (let x = 0; x < MOCK_IMAGE_SIDE; x++) {
		row.set(color, 1 + x * 3);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(MOCK_IMAGE_SIDE, 0);
	header.writeUInt32BE(MOCK_IMAGE_SIDE, 4);
	header[8] = 8;
	header[9] = 2;
	const pixels = Buffer.concat(Array.from({ length: MOCK_IMAGE_SIDE }, () => row));
	const text = tag === undefined ? [] : [pngChunk('tEXt', Buffer.from(`Comment\0${tag}`, 'latin1'))];
	return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(pixels)), ...text, pngChunk('IEND', Buffer.alloc(0))]);
}

/** The MP4 with a `free` box after its last box, which players skip, holding `tag`. */
function withFreeBox(video: Buffer, tag: string): Buffer {
	const payload = Buffer.from(tag, 'utf8');
	const header = Buffer.alloc(8);
	header.writeUInt32BE(8 + payload.byteLength, 0);
	header.write('free', 4, 'latin1');
	return Buffer.concat([video, header, payload]);
}

/** The JPEG with a comment segment after its start marker, holding `tag`. */
function withJpegComment(jpeg: Buffer, tag: string | undefined): Buffer {
	if (tag === undefined) {
		return jpeg;
	}
	const payload = Buffer.from(tag, 'latin1');
	const segment = Buffer.alloc(4);
	segment.writeUInt16BE(0xfffe, 0);
	segment.writeUInt16BE(2 + payload.byteLength, 2);
	return Buffer.concat([jpeg.subarray(0, 2), segment, payload, jpeg.subarray(2)]);
}

/**
 * An MPEG-1 Layer III stream of silence at 128 kbps and 44.1 kHz, joint
 * stereo: `frames` frames of 1,152 samples, 417 or 418 bytes each, every
 * third padded, as an encoder pads them to keep 128 kbps. The side
 * information and the data of each frame are zeros, which a decoder plays as
 * silence.
 */
export function silentMp3(frames: number): Buffer {
	const parts: Buffer[] = [];
	for (let index = 0; index < frames; index++) {
		const padding = index % 3 === 0 ? 1 : 0;
		const frame = Buffer.alloc(417 + padding);
		frame[0] = 0xff;
		frame[1] = 0xfb;
		frame[2] = 0x90 | (padding << 1);
		frame[3] = 0x44;
		parts.push(frame);
	}
	return Buffer.concat(parts);
}

/** An ID3v1 tag: 128 bytes at the end of an MP3, which players skip. */
const ID3V1_BYTES = 128;
/** The artist of the tag of a sound this provider made: what tells its sounds from others. */
const MOCK_SOUND_ARTIST = 'BaseHalf local test provider';

/**
 * A sound of silence as MP3, about `seconds` long (`silentMp3`); with `tag`,
 * of at most 30 characters, an ID3v1 tag at its end names it, so that the
 * sound is a file of its own.
 */
export function mockMp3(seconds: number, tag?: string): Buffer {
	const stream = silentMp3(Math.max(1, Math.round(seconds * 44_100 / 1152)));
	if (tag === undefined) {
		return stream;
	}
	const id3 = Buffer.alloc(ID3V1_BYTES);
	id3.write('TAG', 0, 'latin1');
	id3.write(tag.slice(0, 30), 3, 'latin1');
	id3.write(MOCK_SOUND_ARTIST, 33, 'latin1');
	// No genre.
	id3[ID3V1_BYTES - 1] = 0xff;
	return Buffer.concat([stream, id3]);
}

/** The tag that names a sound this provider made of its own (`mockMp3` with a tag); `undefined` for other bytes. */
export function mockSoundTag(bytes: Buffer): string | undefined {
	if (bytes.byteLength <= ID3V1_BYTES + 4 || bytes[0] !== 0xff || bytes[1] !== 0xfb) {
		return undefined;
	}
	const id3 = bytes.subarray(bytes.byteLength - ID3V1_BYTES);
	if (id3.toString('latin1', 0, 3) !== 'TAG' || id3.toString('latin1', 33, 33 + MOCK_SOUND_ARTIST.length) !== MOCK_SOUND_ARTIST) {
		return undefined;
	}
	return id3.toString('latin1', 3, 33).replace(/\0+$/, '') || undefined;
}

function sendSound(response: ServerResponse, sound: Buffer): void {
	response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(sound.byteLength) });
	response.end(sound);
}

/** One part of a multipart form: its name, a file's name and type, and its bytes. */
export interface MockFormPart {
	readonly name: string;
	readonly fileName?: string;
	readonly contentType?: string;
	readonly bytes: Buffer;
}

/**
 * The parts of a multipart form of the type `contentType`, in order, also when
 * several share a name (`image[]`); `undefined` when the type names no
 * boundary.
 */
export function multipartFormParts(contentType: string | undefined, body: Buffer): MockFormPart[] | undefined {
	const boundary = /boundary=(?<boundary>[^;\s]+)/.exec(contentType ?? '')?.groups?.boundary;
	if (!boundary) {
		return undefined;
	}
	const delimiter = Buffer.from(`--${boundary}`, 'latin1');
	const parts: MockFormPart[] = [];
	let start = body.indexOf(delimiter);
	while (start >= 0) {
		const next = body.indexOf(delimiter, start + delimiter.length);
		if (next < 0) {
			break;
		}
		// Each part starts after the delimiter's line break and ends before the next delimiter's.
		const part = body.subarray(start + delimiter.length + 2, next - 2);
		const headerEnd = part.indexOf('\r\n\r\n');
		const head = part.subarray(0, headerEnd).toString('utf8');
		const fileName = /filename="(?<file>[^"]*)"/.exec(head)?.groups?.file;
		const type = /Content-Type: (?<type>.+)/i.exec(head)?.groups?.type.trim();
		parts.push({
			name: / name="(?<name>[^"]*)"/.exec(head)?.groups?.name ?? '',
			...(fileName !== undefined ? { fileName } : {}),
			...(type !== undefined ? { contentType: type } : {}),
			bytes: part.subarray(headerEnd + 4)
		});
		start = next;
	}
	return parts;
}

/** An error as Mureka answers it: its message, and the id of the request's trace. */
function murekaError(response: ServerResponse, status: number, message: string): void {
	json(response, status, { error: { message }, trace_id: randomBytes(16).toString('hex') });
}

/** The first field of a create request that the API would refuse, by its own documented rules. */
function invalidField(payload: Record<string, unknown> | undefined): string | undefined {
	if (!payload || typeof payload.model !== 'string' || !payload.model) {
		return 'model';
	}
	if (!Array.isArray(payload.content) || payload.content.length === 0) {
		return 'content';
	}
	for (const item of payload.content) {
		if (!isRecord(item)) {
			return 'content';
		}
		if (item.type === 'text') {
			if (typeof item.text !== 'string') {
				return 'content.text';
			}
		} else if (item.type === 'image_url') {
			if (!isRecord(item.image_url) || typeof item.image_url.url !== 'string' || !/^data:image\/[a-z]+;base64,/.test(item.image_url.url)) {
				return 'content.image_url.url';
			}
			if (item.role !== undefined && !IMAGE_ROLES.has(String(item.role))) {
				return 'content.role';
			}
		} else if (item.type === 'audio_url') {
			if (!isRecord(item.audio_url) || typeof item.audio_url.url !== 'string' || !/^data:audio\/[a-z0-9]+;base64,/.test(item.audio_url.url)) {
				return 'content.audio_url.url';
			}
			if (item.role !== 'reference_audio') {
				return 'content.role';
			}
		} else {
			return 'content.type';
		}
	}
	if (payload.resolution !== undefined && !RESOLUTIONS.has(String(payload.resolution))) {
		return 'resolution';
	}
	if (payload.ratio !== undefined && !RATIOS.has(String(payload.ratio))) {
		return 'ratio';
	}
	if (payload.duration !== undefined && !(Number.isInteger(payload.duration) && (payload.duration === -1 || (payload.duration as number) >= 2))) {
		return 'duration';
	}
	for (const flag of ['generate_audio', 'watermark', 'camera_fixed']) {
		if (payload[flag] !== undefined && typeof payload[flag] !== 'boolean') {
			return flag;
		}
	}
	if (payload.seed !== undefined && !Number.isInteger(payload.seed)) {
		return 'seed';
	}
	return undefined;
}

/**
 * What ElevenLabs refuses of a request of speech or of a sound effect, by its
 * own documented rules, each field as the place it was sent at and what is
 * wrong with it, as its 422 answer says it.
 */
function invalidSoundFields(kind: 'speech' | 'sound', url: URL, payload: Record<string, unknown> | undefined): [string[], string][] {
	const invalid: [string[], string][] = [];
	const format = url.searchParams.get('output_format');
	if (format !== null && !ELEVENLABS_MP3_FORMATS.includes(format)) {
		invalid.push([['query', 'output_format'], `Input should be one of the MP3 formats, which the local test provider makes: ${ELEVENLABS_MP3_FORMATS.join(', ')}`]);
	}
	if (!payload) {
		return [...invalid, [['body'], 'Input should be a valid dictionary']];
	}
	if (typeof payload.text !== 'string' || !payload.text.trim()) {
		invalid.push([['body', 'text'], 'String should have at least 1 character']);
	}
	const models = kind === 'speech' ? ELEVENLABS_SPEECH_MODELS : ELEVENLABS_SOUND_MODELS;
	if (payload.model_id !== undefined && !(typeof payload.model_id === 'string' && models.includes(payload.model_id))) {
		invalid.push([['body', 'model_id'], `Input should be one of ${models.join(', ')}`]);
	}
	const between = (value: unknown, min: number, max: number) => value === undefined || value === null || (typeof value === 'number' && value >= min && value <= max);
	const field = (path: string[], valid: boolean, message: string) => {
		if (!valid) {
			invalid.push([['body', ...path], message]);
		}
	};
	if (kind === 'speech') {
		const settings = payload.voice_settings;
		field(['voice_settings'], settings === undefined || settings === null || isRecord(settings), 'Input should be a valid dictionary');
		if (isRecord(settings)) {
			for (const [name, min, max] of [['stability', 0, 1], ['similarity_boost', 0, 1], ['style', 0, 1], ['speed', 0.7, 1.2]] as const) {
				field(['voice_settings', name], between(settings[name], min, max), `Input should be between ${min} and ${max}`);
			}
			field(['voice_settings', 'use_speaker_boost'], settings.use_speaker_boost === undefined || typeof settings.use_speaker_boost === 'boolean', 'Input should be a valid boolean');
		}
		field(['seed'], payload.seed === undefined || (Number.isInteger(payload.seed) && between(payload.seed, 0, 4_294_967_295)), 'Input should be a whole number between 0 and 4294967295');
		field(['language_code'], payload.language_code === undefined || typeof payload.language_code === 'string', 'Input should be a valid string');
	} else {
		field(['duration_seconds'], between(payload.duration_seconds, 0.5, 30), 'Input should be between 0.5 and 30');
		field(['prompt_influence'], between(payload.prompt_influence, 0, 1), 'Input should be between 0 and 1');
		field(['loop'], payload.loop === undefined || typeof payload.loop === 'boolean', 'Input should be a valid boolean');
	}
	return invalid;
}

/** The first field of a create of a song or an instrumental that Mureka would refuse, by its own documented rules, with why. */
function invalidSongField(path: string, payload: Record<string, unknown> | undefined, uploads: ReadonlyMap<string, { readonly purpose: string }>): string | undefined {
	if (!payload) {
		return 'the body is not a JSON object';
	}
	const instrumental = path === '/v1/instrumental/generate';
	const models = instrumental ? MUREKA_INSTRUMENTAL_MODELS : MUREKA_SONG_MODELS;
	if (typeof payload.model !== 'string' || !models.includes(payload.model)) {
		return `model must be one of ${models.join(', ')}`;
	}
	if (payload.n !== undefined && !(Number.isInteger(payload.n) && (payload.n as number) >= 1 && (payload.n as number) <= 3)) {
		return 'n must be 1, 2, or 3';
	}
	const text = (name: string, maxLength: number, required: boolean) => {
		const value = payload[name];
		if (value === undefined && !required) {
			return undefined;
		}
		return typeof value !== 'string' || (required && !value.trim()) ? `${name} is required` : [...value].length > maxLength ? `${name} is longer than ${maxLength} characters` : undefined;
	};
	const wrong = path === '/v1/song/generate'
		? text('lyrics', 5000, true) ?? text('prompt', 1024, false)
		: text('prompt', instrumental ? 1024 : 2000, true);
	if (wrong !== undefined) {
		return wrong;
	}
	if (payload.reference_id !== undefined) {
		if (instrumental) {
			return 'reference_id is not taken by the instrumental call';
		}
		if (typeof payload.reference_id !== 'string' || uploads.get(payload.reference_id)?.purpose !== 'reference') {
			return 'reference_id names no file uploaded for the purpose reference';
		}
	}
	return undefined;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
}

function json(response: ServerResponse, status: number, value: unknown): void {
	const body = Buffer.from(JSON.stringify(value), 'utf8');
	response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength) });
	response.end(body);
}

function parseJson(body: Buffer): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(body.toString('utf8'));
		return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function textOf(payload: Record<string, unknown> | undefined): string | undefined {
	const content = Array.isArray(payload?.content) ? payload.content : [];
	const text = content.find((item: unknown) => isRecord(item) && item.type === 'text');
	return isRecord(text) && typeof text.text === 'string' ? text.text : undefined;
}

function partOf(item: unknown): string {
	if (!isRecord(item)) {
		return 'invalid';
	}
	const media = item.type === 'image_url' ? item.image_url : item.type === 'audio_url' ? item.audio_url : undefined;
	if (isRecord(media) && typeof media.url === 'string') {
		const url = media.url;
		return `${String(item.type)} ${String(item.role)} ${url.startsWith('data:') ? url.slice(0, url.indexOf(';')) : 'url'}`;
	}
	return String(item.type);
}

/** The request body without inline media, which is large and not needed to check it. */
function redact(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!payload) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(payload, (_key, value: unknown) => typeof value === 'string' && value.startsWith('data:') ? `${value.slice(0, value.indexOf(','))},…` : value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
