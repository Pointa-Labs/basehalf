/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * What the provider tests share: a local HTTP server that records what it
 * receives, with routes that answer as an image API, a speech API, and a
 * provider's storage do; small provider modules declared for the tests, of
 * images and videos and of sounds; builders of small media files, tiny valid
 * images and sounds among them; planned inputs as such files; requests of an
 * audio model and the voices a module lists, run through the commands; and
 * new files to write outputs to. Nothing here talks to a real provider.
 */

import { hasKey } from '../../../../base/common/types.js';
import { strict as assert } from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo, Socket } from 'net';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import zlib from 'zlib';
import { VideoProviderCommands } from '../../node/commands.js';
import { ProviderFailure } from '../../node/failure.js';
import { audioFormatOf, imageFormatOf, MEDIA_MIME_TYPES } from '../../node/media.js';
import type { OutputLocation, ProviderModule } from '../../node/module.js';
import type { AudioOutputFormat, CatalogMode, CatalogProvider, ListedVoice, Media, ModeId, Params, PlannedMedia, PromptPart, ProviderAccess, ProviderResponse, SubmitPayload, SubmitResult, VoicesResult } from '../../common/basehalfProviderTypes.js';

export interface Received {
	readonly method: string;
	/** With its query. */
	readonly path: string;
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
}

export interface TestServer {
	/** `http://127.0.0.1:<port>` */
	readonly url: string;
	readonly received: Received[];
	close(): Promise<void>;
}

/** A server on 127.0.0.1 that hands every request, with its whole body, to `handler`. */
export async function startServer(handler: (request: Received, response: ServerResponse, socket: Socket) => void): Promise<TestServer> {
	const received: Received[] = [];
	const sockets = new Set<Socket>();
	const { createServer } = await import('http');
	const server = createServer((incoming: IncomingMessage, response) => {
		const chunks: Buffer[] = [];
		incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
		incoming.on('end', () => {
			const entry: Received = { method: incoming.method ?? '', path: incoming.url ?? '', headers: incoming.headers, body: Buffer.concat(chunks) };
			received.push(entry);
			handler(entry, response, incoming.socket);
		});
	});
	server.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}`,
		received,
		close: () => new Promise(resolve => {
			for (const socket of sockets) {
				socket.destroy();
			}
			server.close(() => resolve());
		})
	};
}

export function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
	const bytes = Buffer.from(JSON.stringify(body), 'utf8');
	response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength), ...headers });
	response.end(bytes);
}

export function value<T>(response: ProviderResponse<T>): T {
	assert.equal(response.ok, true, response.ok ? '' : JSON.stringify(response.error));
	return (response as { readonly value: T }).value;
}

/** The task id of a submit's answer that is a task. */
export function remoteIdIn(submitted: SubmitResult): string {
	assert.ok(hasKey(submitted, { remoteId: true }), `expected a task, got ${JSON.stringify(submitted)}`);
	return submitted.remoteId;
}

/** The task id of a submit that the provider answered with a task. */
export function remoteIdOf(response: ProviderResponse<SubmitResult>): string {
	return remoteIdIn(value(response));
}

export function error<T>(response: ProviderResponse<T>): { code: string; message: string; status?: number } {
	assert.equal(response.ok, false, `expected an error, got ${JSON.stringify(response)}`);
	return (response as { readonly error: { code: string; message: string; status?: number } }).error;
}

/** A sleep that waits for nothing and records what it was asked to wait. */
export function recordingSleep(): { readonly waits: number[]; sleep(ms: number): Promise<void> } {
	const waits: number[] = [];
	return { waits, sleep: async (ms: number) => { waits.push(ms); } };
}

// --- routes -------------------------------------------------------------------------------------

/** A route of a test server: it answers the request and returns true, or returns false and leaves it to the next route. */
export type TestRoute = (request: Received, response: ServerResponse, socket: Socket) => boolean;

/** A handler for {@link startServer} that gives each request to the first route that takes it, and answers 404 when none does. */
export function routed(...routes: readonly TestRoute[]): (request: Received, response: ServerResponse, socket: Socket) => void {
	return (request, response, socket) => {
		if (!routes.some(route => route(request, response, socket))) {
			sendJson(response, 404, { error: { message: `No route for ${request.method} ${request.path.split('?')[0]}.` } });
		}
	};
}

/** The type a sound of each format is served with. */
const AUDIO_MIME_TYPES: Readonly<Record<AudioOutputFormat, string>> = Object.freeze({ mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4' });

/** The type and extension of image or sound bytes, from their signature; other bytes are sent as a plain file. */
function mediaFile(bytes: Buffer): { readonly contentType: string; readonly extension: string } {
	const image = imageFormatOf(bytes);
	if (image) {
		return { contentType: MEDIA_MIME_TYPES[image], extension: image === 'jpeg' ? 'jpg' : image };
	}
	const sound = audioFormatOf(bytes);
	return sound ? { contentType: AUDIO_MIME_TYPES[sound], extension: sound } : { contentType: 'application/octet-stream', extension: 'bin' };
}

/**
 * A route that serves files, as a provider's storage or CDN does: `files` maps
 * a path, without its query, to the bytes a GET of it answers, with the type
 * of an image's or a sound's format. It takes no other request.
 */
export function serveFiles(files: Readonly<Record<string, Buffer>>): TestRoute {
	return (request, response) => {
		const bytes = request.method === 'GET' ? files[request.path.split('?')[0]] : undefined;
		if (!bytes) {
			return false;
		}
		response.writeHead(200, { 'Content-Type': mediaFile(bytes).contentType, 'Content-Length': String(bytes.byteLength) });
		response.end(bytes);
		return true;
	};
}

export interface ImagesAtOnce {
	/** The path of the create, such as `/v1/images/generations`; a query is not compared. */
	readonly path: string;
	/** POST unless given. */
	readonly method?: string;
	/** The images the provider made, in its order. */
	readonly images: readonly Buffer[];
	/**
	 * How each image is answered: its base64, or the address of a file that the
	 * route serves itself, `/files/at-once-<n>.<extension>` on the server that
	 * received the create.
	 */
	readonly as: 'base64' | 'url';
	/** The JSON answered, in the provider's form, from the base64 or the address of each image. */
	readonly shape: (images: readonly string[]) => unknown;
	/** 200 unless given. */
	readonly status?: number;
}

/**
 * A route that answers a create at once with the images, as an image API that
 * answers at once does, for example
 * `answerImagesAtOnce({ path: '/v1/images/generations', images: [tinyPng()], as: 'base64', shape: images => ({ data: images.map(b64_json => ({ b64_json })) }) })`.
 * With `as: 'url'`, it also serves each image at its address.
 */
export function answerImagesAtOnce(options: ImagesAtOnce): TestRoute {
	const files = new Map(options.images.map((bytes, index) => [`/files/at-once-${index + 1}.${mediaFile(bytes).extension}`, bytes]));
	const serve = serveFiles(Object.fromEntries(files));
	return (request, response, socket) => {
		if (options.as === 'url' && serve(request, response, socket)) {
			return true;
		}
		if (request.method !== (options.method ?? 'POST') || request.path.split('?')[0] !== options.path) {
			return false;
		}
		const images = options.as === 'base64'
			? options.images.map(bytes => bytes.toString('base64'))
			: [...files.keys()].map(path => `http://${request.headers.host}${path}`);
		sendJson(response, options.status ?? 200, options.shape(images));
		return true;
	};
}

export interface AudioAtOnce {
	/** The path of the create, such as `/v1/text-to-speech/voice-1`; a query is not compared. */
	readonly path: string;
	/** POST unless given. */
	readonly method?: string;
	/** The sounds the provider made, in its order; a speech API makes one. */
	readonly sounds: readonly Buffer[];
	/**
	 * How the sounds are answered: `bytes`, the first sound itself as the body
	 * with the type of its format, as most speech APIs answer; or JSON that
	 * `shape` makes from each sound's `base64` or `hex`, or from the address of
	 * a file that the route serves itself (`url`),
	 * `/files/sound-<n>.<extension>` on the server that received the create.
	 */
	readonly as: 'bytes' | 'base64' | 'hex' | 'url';
	/** The JSON answered, in the provider's form, from the encoded sounds or their addresses; not for `bytes`. */
	readonly shape?: (sounds: readonly string[]) => unknown;
	/** 200 unless given. */
	readonly status?: number;
}

/**
 * A route that answers a create at once with the sounds (D78), as a speech or
 * sound-effect API does, for example
 * `answerAudioAtOnce({ path: '/v1/text-to-speech/aria', sounds: [tinyMp3()], as: 'bytes' })`, or
 * `answerAudioAtOnce({ path: '/v1/t2a_v2', sounds: [tinyMp3()], as: 'hex', shape: ([audio]) => ({ data: { audio, status: 2 } }) })`.
 * With `as: 'url'`, it also serves each sound at its address.
 */
export function answerAudioAtOnce(options: AudioAtOnce): TestRoute {
	const files = new Map(options.sounds.map((bytes, index) => [`/files/sound-${index + 1}.${mediaFile(bytes).extension}`, bytes]));
	const serve = serveFiles(Object.fromEntries(files));
	return (request, response, socket) => {
		if (options.as === 'url' && serve(request, response, socket)) {
			return true;
		}
		if (request.method !== (options.method ?? 'POST') || request.path.split('?')[0] !== options.path) {
			return false;
		}
		if (options.as === 'bytes') {
			const [sound] = options.sounds;
			response.writeHead(options.status ?? 200, { 'Content-Type': mediaFile(sound).contentType, 'Content-Length': String(sound.byteLength) });
			response.end(sound);
			return true;
		}
		assert.ok(options.shape, `an answer of sounds as ${options.as} needs its shape`);
		const sounds = options.as === 'url'
			? [...files.keys()].map(path => `http://${request.headers.host}${path}`)
			: options.sounds.map(bytes => bytes.toString(options.as === 'hex' ? 'hex' : 'base64'));
		sendJson(response, options.status ?? 200, options.shape(sounds));
		return true;
	};
}

// --- outputs --------------------------------------------------------------------------------------

let runFolderPath: string | undefined;

/** A folder of the test run, made once and removed when the run ends. */
function runFolder(): string {
	if (!runFolderPath) {
		const folder = mkdtempSync(join(tmpdir(), 'basehalf-provider-run-'));
		process.once('exit', () => rmSync(folder, { recursive: true, force: true }));
		runFolderPath = folder;
	}
	return runFolderPath;
}

let targetsMade = 0;

/** `count` new files to write the outputs of a request to, as the window names them: absolute, ending in `.part`, none there yet. */
export function partTargets(count: number): string[] {
	return Array.from({ length: count }, () => join(runFolder(), `output-${++targetsMade}.part`));
}

// --- a provider for the tests -------------------------------------------------------------------

/** A References mode of an image model, which takes up to `max` images and makes an image from the prompt alone. */
function imageReferences(max: number): CatalogProvider['models'][number]['modes'][number] {
	return {
		id: 'reference',
		label: 'References',
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' },
		limits: {}
	};
}

/**
 * The catalog entry of the test provider: two regions, one key, two video
 * models, an image model that answers at once (`still-1`), and an image model
 * that runs as a task (`still-tasks`), each making 1 to 4 images.
 */
export function testProvider(): CatalogProvider {
	return {
		id: 'testprovider',
		label: 'Test Provider',
		regions: [
			{ id: 'home', label: 'Home', baseUrl: 'https://api.example.com/v1' },
			{ id: 'away', label: 'Away', baseUrl: 'https://api.example.cn/v1' }
		],
		credentials: [{ id: 'apiKey', label: 'API Key' }],
		models: [
			{
				id: 'clip-1',
				kind: 'video',
				label: 'Clip 1',
				providerModels: { home: 'clip-1-home', away: 'clip-1-away' },
				prompt: { required: 'withoutMedia', maxLength: 50 },
				modes: [
					{
						id: 'frames',
						label: 'Frames',
						inputs: { startFrame: 'optional', endFrame: 'optional', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' },
						limits: { imageMinSide: 300, imageMaxSide: 6000, imageAspect: [0.4, 2.5], imageMaxBytes: 1024 * 1024 }
					},
					{
						id: 'reference',
						label: 'References',
						inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max: 3 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 2 }, source: 'none' },
						limits: { imageMinSide: 300, audioSeconds: [2, 15], audioTotalSeconds: 15, audioMaxBytes: 1024 * 1024 }
					}
				],
				parameters: [
					{ name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }], default: '720p' },
					{ name: 'duration', label: 'Duration', kind: 'integer', unit: 'seconds', min: 4, max: 12, step: 1, default: 5, auto: { value: -1, label: 'Auto' } },
					{ name: 'ratio', label: 'Ratio', kind: 'choice', display: 'ratio', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }], default: '16:9', modes: ['reference'] },
					{ name: 'seed', label: 'Seed', kind: 'integer', min: 0, max: 100, step: 1, optional: true, advanced: true }
				]
			},
			{
				id: 'clip-away',
				kind: 'video',
				label: 'Clip Away',
				providerModels: { away: 'clip-away' },
				prompt: { required: 'always', maxLength: 100 },
				modes: [{ id: 'frames', label: 'Frames', inputs: { startFrame: 'optional', endFrame: 'none', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: {} }],
				parameters: []
			},
			{
				id: 'still-1',
				kind: 'image',
				label: 'Still 1',
				providerModels: { home: 'still-1-home', away: 'still-1-away' },
				prompt: { required: 'always', maxLength: 100 },
				modes: [imageReferences(4)],
				parameters: [{ name: 'count', label: 'Images', kind: 'integer', min: 1, max: 4, step: 1, default: 1 }],
				outputFormat: 'png',
				answersAtOnce: true
			},
			{
				id: 'still-tasks',
				kind: 'image',
				label: 'Still Tasks',
				providerModels: { home: 'still-tasks-home' },
				prompt: { required: 'always', maxLength: 100 },
				modes: [imageReferences(2)],
				parameters: [{ name: 'count', label: 'Images', kind: 'integer', min: 1, max: 4, step: 1, default: 1 }],
				outputFormat: 'jpeg'
			}
		]
	};
}

/** A module of the test provider whose behavior each test replaces where it needs to. */
export function testModule(overrides: Partial<ProviderModule> = {}): ProviderModule {
	return {
		describe: testProvider,
		headers: credentials => ({ Authorization: `Bearer ${credentials.apiKey}` }),
		async check(request) {
			return {
				problems: request.params.duration === 12 && request.params.resolution === '720p' ? ['720p allows 10 seconds at most.'] : []
			};
		},
		async submit(_request, http) {
			const answer = await http.create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: { ok: true } } });
			return String(answer.object().id);
		},
		async poll(ref, http) {
			const answer = (await http.request({ method: 'GET', path: `/tasks/${encodeURIComponent(ref.remoteId)}` })).object();
			return answer.status === 'done' ? { state: 'succeeded', videoUrl: String(answer.url) } : { state: 'running' };
		},
		async videoLocation(ref, http) {
			return { url: new URL(`tasks/${encodeURIComponent(ref.remoteId)}/video`, `${http.endpoint.href.replace(/\/$/, '')}/`).href };
		},
		async cancel() {
			throw new ProviderFailure('rejected', 'not used');
		},
		...overrides
	};
}

// --- an audio provider for the tests ----------------------------------------------------------------

/** A mode of an audio model that takes up to `audios` reference sounds and nothing else (D78). */
function audioMode(id: 'reference' | 'lyrics', label: string, audios = 0): CatalogMode {
	return {
		id,
		label,
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: audios }, source: 'none' },
		limits: audios ? { audioSeconds: [2, 30] } : {}
	};
}

/**
 * The catalog entry of an audio provider for the tests (D78): two regions and
 * one key, and
 *
 * - `speech-1`, speech in MP3, answered at once, offered at home only, whose
 *   voice the provider lists (`aria` and `bo` in the catalog);
 * - `speech-fixed`, speech in WAV, answered at once, with the catalog's two
 *   voices only (`Kore` and `Puck`);
 * - `song-1`, music in MP3, answered at once, From a Description and From
 *   Lyrics, 1 to 3 songs, with a reference song, Instrumental, and Style;
 * - `song-tasks`, music in MP3 that runs as a task, 1 or 2 songs;
 * - `fx-1`, sound effects in MP3, answered at once.
 */
export function testAudioProvider(): CatalogProvider {
	const atOnce = { kind: 'audio', outputFormat: 'mp3', answersAtOnce: true } as const;
	return {
		id: 'testaudio',
		label: 'Test Audio',
		regions: [
			{ id: 'home', label: 'Home', baseUrl: 'https://api.example.com/v1' },
			{ id: 'away', label: 'Away', baseUrl: 'https://api.example.cn/v1' }
		],
		credentials: [{ id: 'apiKey', label: 'API Key' }],
		models: [
			{
				...atOnce,
				id: 'speech-1',
				makes: 'speech',
				label: 'Speech 1',
				providerModels: { home: 'speech-1-home' },
				prompt: { required: 'always', maxLength: 200 },
				modes: [audioMode('reference', 'Speech')],
				parameters: [
					{ name: 'voice', label: 'Voice', kind: 'voice', options: [{ value: 'aria', label: 'Aria', description: 'Warm, calm' }, { value: 'bo', label: 'Bo' }], default: 'aria', listed: true },
					{ name: 'speed', label: 'Speed', kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1 }
				]
			},
			{
				...atOnce,
				id: 'speech-fixed',
				makes: 'speech',
				label: 'Speech Fixed',
				outputFormat: 'wav',
				providerModels: { home: 'speech-fixed', away: 'speech-fixed' },
				prompt: { required: 'always', maxLength: 200 },
				modes: [audioMode('reference', 'Speech')],
				parameters: [{ name: 'voice', label: 'Voice', kind: 'voice', options: [{ value: 'Kore', label: 'Kore', description: 'Firm' }, { value: 'Puck', label: 'Puck', description: 'Upbeat' }], default: 'Kore' }]
			},
			{
				...atOnce,
				id: 'song-1',
				makes: 'music',
				label: 'Song 1',
				providerModels: { home: 'song-1', away: 'song-1' },
				prompt: { required: 'withoutMedia', maxLength: 300 },
				modes: [audioMode('reference', 'From a Description', 1), audioMode('lyrics', 'From Lyrics', 1)],
				parameters: [
					{ name: 'count', label: 'Songs', kind: 'integer', min: 1, max: 3, step: 1, default: 1 },
					{ name: 'instrumental', label: 'Instrumental', kind: 'boolean', default: false, modes: ['reference'] },
					{ name: 'style', label: 'Style', kind: 'text', maxLength: 100, optional: true, modes: ['lyrics'] }
				]
			},
			{
				id: 'song-tasks',
				kind: 'audio',
				makes: 'music',
				label: 'Song Tasks',
				outputFormat: 'mp3',
				providerModels: { home: 'song-tasks' },
				prompt: { required: 'always', maxLength: 300 },
				modes: [audioMode('reference', 'From a Description')],
				parameters: [{ name: 'count', label: 'Songs', kind: 'integer', min: 1, max: 2, step: 1, default: 2 }]
			},
			{
				...atOnce,
				id: 'fx-1',
				makes: 'sound',
				label: 'Effects 1',
				providerModels: { home: 'fx-1' },
				prompt: { required: 'always', maxLength: 300 },
				modes: [audioMode('reference', 'Sound Effects')],
				parameters: [{ name: 'duration', label: 'Duration', kind: 'number', unit: 'seconds', min: 0.5, max: 30, step: 0.5, default: 5 }]
			}
		]
	};
}

/** A voice of the test audio provider's list call, `GET /voices?page=<n>`, in its own form. */
export interface TestProviderVoice {
	readonly voice_id: string;
	readonly name?: string;
	/** `premade` for the provider's own; any other category is the account's. */
	readonly category?: string;
	readonly labels?: Readonly<Record<string, string>>;
	readonly preview_url?: string;
}

/**
 * A module of the test audio provider whose behavior each test replaces where
 * it needs to. It sends a speech or a sound-effect request to
 * `POST /speech/<model>` and keeps the sound the provider answers with as an
 * inline output; a song request to `POST /songs`, answered at once with
 * `{ songs: [{ audio: <base64> } | { url } | { error }] }` or, for
 * `song-tasks`, with `{ id }`; and lists voices from `GET /voices?page=<n>`,
 * which answers `{ voices: TestProviderVoice[], has_more }`, until the
 * provider has no more or `limit` voices are listed.
 */
export function testAudioModule(overrides: Partial<ProviderModule> = {}): ProviderModule {
	return {
		describe: testAudioProvider,
		headers: credentials => ({ Authorization: `Bearer ${credentials.apiKey}` }),
		async check() {
			return { problems: [] };
		},
		async submit(request, http) {
			if (request.model.startsWith('song')) {
				const answer = (await http.create({ method: 'POST', path: '/songs', body: { kind: 'json', value: { model: request.model, mode: request.mode, prompt: request.prompt, params: request.params } } })).object();
				if (typeof answer.id === 'string') {
					return answer.id;
				}
				return { outputs: (answer.songs as Record<string, string>[]).map(readSong) };
			}
			const answer = await http.create({ method: 'POST', path: `/speech/${encodeURIComponent(request.model)}`, headers: { Accept: 'audio/mpeg' }, body: { kind: 'json', value: { text: request.prompt, params: request.params } } });
			return { outputs: [{ bytes: answer.body, format: 'mp3' }] };
		},
		async poll(ref, http) {
			const answer = (await http.request({ method: 'GET', path: `/songs/${encodeURIComponent(ref.remoteId)}` })).object();
			return answer.status === 'done' ? { state: 'succeeded', outputs: (answer.songs as Record<string, string>[]).map(readSong) } : { state: 'running' };
		},
		async cancel() {
			return false;
		},
		async listVoices(_request, http, limit) {
			const voices: ListedVoice[] = [];
			for (let page = 1; ; page++) {
				const answer = (await http.request({ method: 'GET', path: '/voices', query: { page } })).object();
				for (const voice of answer.voices as TestProviderVoice[]) {
					voices.push({
						id: voice.voice_id,
						label: voice.name ?? '',
						...(voice.labels ? { description: Object.values(voice.labels).join(', ') } : {}),
						own: voice.category !== 'premade',
						...(voice.preview_url !== undefined ? { sample: voice.preview_url } : {})
					});
				}
				if (voices.length > limit) {
					return { voices: voices.slice(0, limit), truncated: true };
				}
				if (answer.has_more !== true) {
					return { voices };
				}
			}
		},
		...overrides
	};
}

function readSong(song: Record<string, string>): OutputLocation {
	return song.audio !== undefined ? { bytes: Buffer.from(song.audio, 'base64') } : song.url !== undefined ? { url: song.url } : { refused: song.error ?? '' };
}

// --- audio requests and voices ------------------------------------------------------------------

/**
 * Where a test sends a module's requests: a local server (`http://127.0.0.1:<port>`)
 * at the path of a region's base URL, the first region unless one is named,
 * with these credentials. For a region whose base URL is
 * `https://api.example.com/v1`, the endpoint is `<server>/v1`.
 */
export function testAccess(module: ProviderModule, server: string, credentials: Readonly<Record<string, string>>, region?: string): ProviderAccess {
	const provider = module.describe();
	const entry = region === undefined ? provider.regions[0] : provider.regions.find(candidate => candidate.id === region);
	assert.ok(entry, `${provider.id} has no region ${region}`);
	return { provider: provider.id, region: entry.id, endpoint: `${server}${new URL(entry.baseUrl).pathname.replace(/\/+$/, '')}`, credentials: { ...credentials } };
}

/** What a planned request of an audio model says besides its access and its model. */
export interface AudioRequestOptions {
	/** `reference` unless given; `lyrics` for a song from lyrics. */
	readonly mode?: ModeId;
	/** The card's values, `voice` among them; a parameter left out has its default. */
	readonly params?: Params;
	/** The prompt as the window sends it, one string or its parts; `A calm voice reads the morning news.` unless given. */
	readonly prompt?: string | readonly PromptPart[];
	/** The planned inputs, such as a reference song in `audios`; none unless given. */
	readonly inputs?: Partial<PlannedMedia>;
	/** How many new targets the request names: the `count` of its settings, or 1, unless given; 0 names none, as for a model that runs as a task. */
	readonly targets?: number;
}

/**
 * A planned request of an audio model as the window sends it to `check` and
 * `submit` (D78), with a new `.part` target for each output it may make, for
 * example
 * `audioRequest(testAccess(ELEVENLABS, server.url, { apiKey: KEY }), 'eleven-v3', { params: { voice: 'JBFqnCBsd6RMkjVDRZzb' }, prompt: 'Welcome to the coast.' })`.
 * A check takes it as it is.
 */
export function audioRequest(access: ProviderAccess, model: string, options: AudioRequestOptions = {}): SubmitPayload {
	const params = options.params ?? {};
	const targets = options.targets ?? (typeof params.count === 'number' ? params.count : 1);
	const prompt = options.prompt ?? 'A calm voice reads the morning news.';
	return {
		...access,
		model,
		mode: options.mode ?? 'reference',
		params,
		prompt: typeof prompt === 'string' ? (prompt ? [prompt] : []) : prompt,
		inputs: { images: [], videos: [], audios: [], ...options.inputs },
		...(targets > 0 ? { targets: partTargets(targets) } : {})
	};
}

/** The voices of a speech model as `voices` answered them, and what the local server received meanwhile, in order. */
export interface ListedVoices {
	readonly answer: ProviderResponse<VoicesResult>;
	readonly received: readonly Received[];
}

/**
 * Lists the voices of a speech model of `module` as the window asks for them
 * when its voice menu opens (D78): `voices` through the commands, against a
 * local server that `handler` answers as the provider's list calls, at the
 * path of the region's base URL ({@link testAccess}); the server stops
 * before it answers. For example
 * `listVoicesAgainst(FISH_AUDIO, 's2.1-pro', { apiKey: KEY }, routed(myVoicePages))`.
 */
export async function listVoicesAgainst(module: ProviderModule, model: string, credentials: Readonly<Record<string, string>>, handler: (request: Received, response: ServerResponse, socket: Socket) => void, region?: string): Promise<ListedVoices> {
	const server = await startServer(handler);
	try {
		const commands = new VideoProviderCommands([module], { http: { sleep: async () => undefined } });
		const answer = await commands.voices({ ...testAccess(module, server.url, credentials, region), model });
		return { answer, received: [...server.received] };
	} finally {
		await server.close();
	}
}

// --- media --------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

/** A valid PNG of one gray color. */
export function png(width: number, height: number): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 0;
	const row = Buffer.alloc(1 + width, 0x80);
	row[0] = 0;
	const pixels = Buffer.concat(Array.from({ length: height }, () => row));
	return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** A valid PNG of 2 × 2 gray pixels, as a provider that answers with an image may send it. */
export function tinyPng(): Buffer {
	return png(2, 2);
}

/**
 * A valid baseline JPEG of 2 × 2 pixels, as an encoder (macOS `sips`) wrote
 * it, its Exif and other metadata segments taken out: JFIF, its frame header,
 * Huffman and quantization tables, and its scan, so any decoder reads it.
 */
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBAMDAwQFBAQEBAUHBQUFBQUHCAcHBwcHBwgICAgICAgICgoKCgoKCwsLCwsNDQ0NDQ0NDQ0N/9sAQwECAgIDAwMGAwMGDQkHCQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N/90ABAAB/9oADAMBAAIRAxEAPwDj6KKK/qw/ms//2Q==';

/** A valid baseline JPEG of 2 × 2 pixels, made by a real encoder. */
export function tinyJpeg(): Buffer {
	return Buffer.from(TINY_JPEG_BASE64, 'base64');
}

/** The header of a baseline JPEG with an APP0 and a large APP1 segment before its frame header. */
export function jpegHeader(width: number, height: number): Buffer {
	const segment = (marker: number, data: Buffer) => {
		const head = Buffer.alloc(4);
		head[0] = 0xff;
		head[1] = marker;
		head.writeUInt16BE(data.length + 2, 2);
		return Buffer.concat([head, data]);
	};
	const frame = Buffer.alloc(6);
	frame[0] = 8;
	frame.writeUInt16BE(height, 1);
	frame.writeUInt16BE(width, 3);
	frame[5] = 3;
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
		segment(0xe1, Buffer.alloc(40_000, 0x20)),
		Buffer.from([0xff]),
		segment(0xc0, Buffer.concat([frame, Buffer.alloc(9)])),
		segment(0xda, Buffer.alloc(10)),
		Buffer.from([0xff, 0xd9])
	]);
}

export function gifHeader(width: number, height: number): Buffer {
	const head = Buffer.alloc(13);
	head.write('GIF89a', 0, 'latin1');
	head.writeUInt16LE(width, 6);
	head.writeUInt16LE(height, 8);
	return head;
}

/** The first bytes of a WebP of each kind of first chunk. */
export function webpHeader(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Buffer {
	const head = Buffer.alloc(32);
	head.write('RIFF', 0, 'latin1');
	head.writeUInt32LE(24, 4);
	head.write('WEBP', 8, 'latin1');
	head.write(kind, 12, 'latin1');
	head.writeUInt32LE(10, 16);
	if (kind === 'VP8 ') {
		head[23] = 0x9d;
		head[24] = 0x01;
		head[25] = 0x2a;
		head.writeUInt16LE(width, 26);
		head.writeUInt16LE(height, 28);
	} else if (kind === 'VP8L') {
		head[20] = 0x2f;
		head.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
	} else {
		head.writeUIntLE(width - 1, 24, 3);
		head.writeUIntLE(height - 1, 27, 3);
	}
	return head;
}

function box(type: string, ...content: Buffer[]): Buffer {
	const data = Buffer.concat(content);
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length + 8, 0);
	head.write(type, 4, 'latin1');
	return Buffer.concat([head, data]);
}

/**
 * An ISO media file whose movie header says `seconds`: ftyp, a media box first
 * when asked, then moov with mvhd. Its major brand is `isom` unless given, and
 * its compatible brands `isom`, `iso2`, and `mp41` unless given.
 */
export function isoMedia(seconds: number, options: { readonly brand?: string; readonly compatible?: readonly string[]; readonly version?: 0 | 1; readonly mediaFirst?: boolean } = {}): Buffer {
	const timescale = 600;
	const duration = Math.round(seconds * timescale);
	let header: Buffer;
	if (options.version === 1) {
		header = Buffer.alloc(4 + 8 + 8 + 4 + 8 + 80);
		header[0] = 1;
		header.writeUInt32BE(timescale, 20);
		header.writeBigUInt64BE(BigInt(duration), 24);
	} else {
		header = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 80);
		header.writeUInt32BE(timescale, 12);
		header.writeUInt32BE(duration, 16);
	}
	const fileType = box('ftyp', Buffer.from(`${options.brand ?? 'isom'}\0\0\x02\0${(options.compatible ?? ['isom', 'iso2', 'mp41']).join('')}`, 'latin1'));
	const media = box('mdat', Buffer.alloc(5000, 0x11));
	const movie = box('moov', box('mvhd', header), box('trak', Buffer.alloc(32)));
	return Buffer.concat(options.mediaFirst ? [fileType, media, movie] : [fileType, movie, media]);
}

/** A PCM WAV of `seconds` at 8 kHz, 16-bit mono (16,000 bytes a second), with a LIST chunk before the data. */
export function wav(seconds: number): Buffer {
	const data = Buffer.alloc(Math.round(seconds * 16_000));
	const format = Buffer.alloc(16);
	format.writeUInt16LE(1, 0);
	format.writeUInt16LE(1, 2);
	format.writeUInt32LE(8000, 4);
	format.writeUInt32LE(16_000, 8);
	format.writeUInt16LE(2, 12);
	format.writeUInt16LE(16, 14);
	const chunk = (id: string, content: Buffer) => {
		const head = Buffer.alloc(8);
		head.write(id, 0, 'latin1');
		head.writeUInt32LE(content.length, 4);
		return Buffer.concat([head, content, content.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
	};
	const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), chunk('fmt ', format), chunk('LIST', Buffer.from('INFOISFT', 'latin1')), chunk('data', data)]);
	const head = Buffer.alloc(8);
	head.write('RIFF', 0, 'latin1');
	head.writeUInt32LE(body.length, 4);
	return Buffer.concat([head, body]);
}

/**
 * An MPEG-1 Layer III stream at 128 kbps and 44.1 kHz, joint stereo, of
 * `frames` frames of 1152 samples (417 or 418 bytes each), with an ID3v2 tag
 * first when asked and a Xing header in the first frame when asked.
 */
export function mp3(frames: number, options: { readonly id3?: boolean; readonly xingFrames?: number } = {}): Buffer {
	const parts: Buffer[] = [];
	if (options.id3) {
		const tag = Buffer.alloc(10 + 300);
		tag.write('ID3', 0, 'latin1');
		tag[3] = 4;
		// The size, syncsafe: 300 = 2 * 128 + 44.
		tag[8] = 2;
		tag[9] = 44;
		parts.push(tag);
	}
	for (let index = 0; index < frames; index++) {
		// Every third frame is padded, as an encoder does to keep 128 kbps at 44.1 kHz.
		const padding = index % 3 === 0 ? 1 : 0;
		const frame = Buffer.alloc(417 + padding);
		frame[0] = 0xff;
		frame[1] = 0xfb;
		frame[2] = 0x90 | (padding << 1);
		frame[3] = 0x44;
		if (index === 0 && options.xingFrames !== undefined) {
			frame.write('Xing', 4 + 32, 'latin1');
			frame.writeUInt32BE(1, 4 + 32 + 4);
			frame.writeUInt32BE(options.xingFrames, 4 + 32 + 8);
		}
		parts.push(frame);
	}
	return Buffer.concat(parts);
}

/** A valid MP3 of silence, as a speech API answers it: four MPEG-1 Layer III frames at 128 kbps and 44.1 kHz, about a tenth of a second, 1,670 bytes. */
export function tinyMp3(): Buffer {
	return mp3(4);
}

/** A valid WAV of silence: a hundredth of a second of 16-bit mono PCM at 8 kHz, 220 bytes. */
export function tinyWav(): Buffer {
	return wav(0.01);
}

/**
 * The start of a FLAC stream: its marker and its metadata, STREAMINFO for
 * 44.1 kHz stereo at 16 bits, then a padding block, with no audio frame
 * after them; 78 bytes.
 */
export function flacHeader(): Buffer {
	const info = Buffer.alloc(34);
	// The smallest and largest block, 4096 samples; the frame sizes, unknown.
	info.writeUInt16BE(4096, 0);
	info.writeUInt16BE(4096, 2);
	// 44,100 Hz in 20 bits, 2 channels less one in 3 bits, 16 bits less one in 5 bits, no samples.
	info.writeUInt32BE((44100 << 12) | (1 << 9) | (15 << 4), 10);
	// Each block: whether it is the last, its type (0 STREAMINFO, 1 padding), and its length.
	return Buffer.concat([Buffer.from('fLaC', 'latin1'), Buffer.from([0x00, 0x00, 0x00, 34]), info, Buffer.from([0x81, 0x00, 0x00, 32]), Buffer.alloc(32)]);
}

/**
 * The first page of an Ogg stream (its checksum left zero) holding the start
 * of the identification header of `codec`: Opus, Vorbis, or FLAC, which are
 * sounds, or Theora, a video.
 */
export function oggHeader(codec: 'opus' | 'vorbis' | 'flac' | 'theora'): Buffer {
	const packet = Buffer.alloc(48);
	const signatures = { opus: 'OpusHead', vorbis: '\x01vorbis', flac: '\x7FFLAC', theora: '\x80theora' };
	packet.write(signatures[codec], 0, 'latin1');
	const page = Buffer.alloc(27);
	page.write('OggS', 0, 'latin1');
	// Version 0, the first page of its stream, granule 0, a serial number, page 0.
	page[5] = 0x02;
	page.writeUInt32LE(0x4241_5345, 14);
	page[26] = 1;
	return Buffer.concat([page, Buffer.from([packet.byteLength]), packet]);
}

// --- planned inputs for checks -------------------------------------------------------------------

/** How many inputs of each slot a test plans. */
export interface PlannedCount {
	readonly startFrame?: boolean;
	readonly endFrame?: boolean;
	readonly images?: number;
	readonly videos?: number;
	readonly audios?: number;
	readonly source?: boolean;
}

const plannedPaths = new Map<string, string>();

/** A small media file of the test run, written once and removed when the run ends. */
function plannedFile(name: string, mimeType: string, bytes: () => Buffer): Media {
	let path = plannedPaths.get(name);
	if (!path) {
		path = join(runFolder(), name);
		writeFileSync(path, bytes());
		plannedPaths.set(name, path);
	}
	return { fsPath: path, mimeType };
}

/**
 * Planned inputs of the given counts as small files that BaseHalf measures as
 * it measures a user's: a 1280 × 720 PNG for each image, an MP4 of 5 seconds
 * for each video, and a WAV of 5 seconds for each audio clip.
 */
export function plannedFiles(count: PlannedCount = {}): PlannedMedia {
	const image = (name: string) => plannedFile(`${name}.png`, 'image/png', () => png(1280, 720));
	const video = (name: string) => plannedFile(`${name}.mp4`, 'video/mp4', () => isoMedia(5));
	const audio = (name: string) => plannedFile(`${name}.wav`, 'audio/wav', () => wav(5));
	const several = (amount: number | undefined, make: (number: number) => Media) => Array.from({ length: amount ?? 0 }, (_entry, index) => make(index + 1));
	return {
		...(count.startFrame ? { startFrame: image('start') } : {}),
		...(count.endFrame ? { endFrame: image('end') } : {}),
		images: several(count.images, number => image(`image-${number}`)),
		videos: several(count.videos, number => video(`video-${number}`)),
		audios: several(count.audios, number => audio(`audio-${number}`)),
		...(count.source ? { source: video('source') } : {})
	};
}

// --- multipart forms ----------------------------------------------------------------------------

/** One part of a multipart form a test server received: its name, a file's name and type, and its bytes. */
export interface ReceivedPart {
	readonly name: string;
	readonly fileName?: string;
	readonly contentType?: string;
	readonly bytes: Buffer;
}

/** The parts of a multipart form a test server received, in order, also when several share a name (`image[]`). */
export function multipartParts(request: Received): ReceivedPart[] {
	const boundary = /boundary=(?<boundary>[^;\s]+)/.exec(String(request.headers['content-type']))?.groups?.boundary;
	assert.ok(boundary, 'a multipart form has a boundary');
	const delimiter = Buffer.from(`--${boundary}`, 'latin1');
	const parts: ReceivedPart[] = [];
	let start = request.body.indexOf(delimiter);
	while (start >= 0) {
		const next = request.body.indexOf(delimiter, start + delimiter.length);
		if (next < 0) {
			break;
		}
		// Each part starts after the delimiter's line break and ends before the next delimiter's.
		const part = request.body.subarray(start + delimiter.length + 2, next - 2);
		const headerEnd = part.indexOf('\r\n\r\n');
		const head = part.subarray(0, headerEnd).toString('utf8');
		const fileName = /filename="(?<file>[^"]*)"/.exec(head)?.groups?.file;
		const contentType = /Content-Type: (?<type>.+)/i.exec(head)?.groups?.type.trim();
		parts.push({
			name: / name="(?<name>[^"]*)"/.exec(head)?.groups?.name ?? '',
			...(fileName !== undefined ? { fileName } : {}),
			...(contentType !== undefined ? { contentType } : {}),
			bytes: part.subarray(headerEnd + 4)
		});
		start = next;
	}
	return parts;
}
