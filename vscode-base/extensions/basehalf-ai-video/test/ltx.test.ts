/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The LTX module (docs/specs/video-providers/ltx.md) through the provider
 * commands, against a local server that answers like LTX's API, a second one
 * that answers like the storage behind its signed upload addresses, and a
 * third that serves a finished video. No test calls LTX or uses a real key.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../src/providers/commands.ts';
import { LTX } from '../src/providers/ltx.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { CatalogModel, Media } from '../src/providers/types.ts';
import { error, isoMedia, jpegHeader, mp3, plannedFiles, png, recordingSleep, sendJson, startServer, value, wav, type Received, type TestServer } from './providerTestKit.ts';

const KEY = 'ltx-local-test-key-0001';
const PROMPT = 'A lighthouse keeper climbs the stairs as the beam sweeps the water.';
const MIB = 1024 * 1024;

const folder = mkdtempSync(join(tmpdir(), 'basehalf-ltx-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

function file(name: string, bytes: Buffer): string {
	const fsPath = join(folder, name);
	writeFileSync(fsPath, bytes);
	return fsPath;
}

/** A PNG with a private chunk of `padding` bytes before its end, so that its data URI is longer than 7,000,000 characters. */
function paddedPng(width: number, height: number, padding: number): Buffer {
	const image = png(width, height);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(padding);
	const typed = Buffer.concat([Buffer.from('paDd', 'latin1'), Buffer.alloc(padding, 0x41)]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typed));
	return Buffer.concat([image.subarray(0, image.byteLength - 12), length, typed, crc, image.subarray(image.byteLength - 12)]);
}

/** A WAV in WAVE_FORMAT_EXTENSIBLE of `seconds` at 8 kHz, 16-bit mono, whose subformat is `subformat` (1 is PCM). */
function extensibleWav(seconds: number, subformat: number): Buffer {
	const format = Buffer.alloc(40);
	format.writeUInt16LE(0xfffe, 0);
	format.writeUInt16LE(1, 2);
	format.writeUInt32LE(8000, 4);
	format.writeUInt32LE(16_000, 8);
	format.writeUInt16LE(2, 12);
	format.writeUInt16LE(16, 14);
	format.writeUInt16LE(22, 16);
	format.writeUInt16LE(16, 18);
	format.writeUInt32LE(4, 20);
	format.writeUInt16LE(subformat, 24);
	Buffer.from('000000001000800000aa00389b71', 'hex').copy(format, 26);
	const chunk = (id: string, content: Buffer) => {
		const head = Buffer.alloc(8);
		head.write(id, 0, 'latin1');
		head.writeUInt32LE(content.length, 4);
		return Buffer.concat([head, content]);
	};
	const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), chunk('fmt ', format), chunk('data', Buffer.alloc(seconds * 16_000))]);
	const head = Buffer.alloc(8);
	head.write('RIFF', 0, 'latin1');
	head.writeUInt32LE(body.length, 4);
	return Buffer.concat([head, body]);
}

/** A PCM WAV whose format tag is changed to 0x0055, MPEG Layer III inside a WAV. */
function mp3InWav(seconds: number): Buffer {
	const bytes = wav(seconds);
	bytes.writeUInt16LE(0x0055, 20);
	return bytes;
}

const START = file('start.png', png(640, 360));
const END = file('end.jpg', jpegHeader(1280, 720));
const PORTRAIT = file('portrait.png', png(360, 640));
const LARGE = file('large.png', paddedPng(64, 64, 5_400_000));
const CLIP = file('clip.mp4', isoMedia(4));
const TAKE = file('take.mov', isoMedia(6, { brand: 'qt  ' }));
const SHORT = file('short.mp4', isoMedia(2));
const WEBM = file('clip.webm', Buffer.concat([Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d', 'hex'), Buffer.alloc(64)]));
const VOICE = file('voice.m4a', isoMedia(3, { brand: 'M4A ' }));
const SPEECH = file('speech.m4a', isoMedia(14, { brand: 'M4A ' }));
const SONG = file('song.mp3', mp3(115));
const PCM = file('pcm.wav', wav(3));
const PCM_EXTENSIBLE = file('pcm-extensible.wav', extensibleWav(3, 1));
const COMPRESSED_WAV = file('mp3-in.wav', mp3InWav(3));
/** A clip and an audio file whose lengths AI Video cannot read. */
const UNREADABLE_CLIP = file('unreadable.mp4', Buffer.from('not a movie'));
const UNREADABLE_AUDIO = file('unreadable.mp3', Buffer.from('not a song'));

const image = (fsPath: string, mimeType = 'image/png'): Media => ({ fsPath, mimeType });
const video = (fsPath: string): Media => ({ fsPath, mimeType: fsPath.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' });
const audio = (fsPath: string): Media => ({ fsPath, mimeType: fsPath.endsWith('.wav') ? 'audio/wav' : fsPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' });
const dataUri = (fsPath: string, type = 'image/png') => `data:${type};base64,${readFileSync(fsPath).toString('base64')}`;

function commands(options: VideoProviderCommandOptions = {}): VideoProviderCommands {
	return new VideoProviderCommands([LTX], { ...options, http: { sleep: async () => undefined, ...options.http } });
}

type Mode = 'frames' | 'reference' | 'edit' | 'extend';
type Inputs = { startFrame?: Media; endFrame?: Media; images?: readonly Media[]; audios?: readonly Media[]; source?: Media };

function generation(endpoint: string, model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs = {}, prompt = PROMPT) {
	return { provider: 'ltx', region: 'global', endpoint, credentials: { apiKey: KEY }, model, mode, params, prompt, inputs: { images: [], videos: [], audios: [], ...inputs } };
}

/** A check of planned files. */
function checkRequest(model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs, prompt = PROMPT) {
	return { provider: 'ltx', region: 'global', model, mode, params, prompt, inputs: { images: [], videos: [], audios: [], ...inputs } };
}

function taskRef(endpoint: string, remoteId: string, model = 'ltx-2-5-fast') {
	return { provider: 'ltx', region: 'global', endpoint, credentials: { apiKey: KEY }, model, remoteId };
}

// --- a provider that answers like LTX ----------------------------------------------------------

const ENDPOINTS = new Set(['text-to-video', 'image-to-video', 'audio-to-video', 'retake', 'extend']);
const REQUIRED_HEADERS = Object.freeze({ 'x-goog-content-length-range': '0,209715200', 'x-goog-if-generation-match': '0' });

interface Provider {
	readonly api: TestServer;
	readonly storage: TestServer;
	/** What each job answers, by task id (`<endpoint>/<id>`); `pending` unless set. */
	readonly jobs: Map<string, Record<string, unknown>>;
	close(): Promise<void>;
}

type Handler = (request: Received, response: ServerResponse, socket: Socket) => boolean;

/**
 * LTX's API on one server and the storage of its signed upload addresses on
 * another, so the two have different origins. Paths under `/relay/ltx` are
 * answered as the root, as a relay would. A handler answers first when it
 * returns true.
 */
async function startProvider(handlers: { api?: Handler; storage?: Handler } = {}): Promise<Provider> {
	const jobs = new Map<string, Record<string, unknown>>();
	let created = 0;
	let tickets = 0;
	const storage = await startServer((request, response, socket) => {
		if (handlers.storage?.(request, response, socket)) {
			return;
		}
		response.writeHead(200, { 'Content-Length': '0' });
		response.end();
	});
	const api = await startServer((request, response, socket) => {
		if (handlers.api?.(request, response, socket)) {
			return;
		}
		const path = new URL(request.path, 'http://local').pathname.replace(/^\/relay\/ltx(?=\/)/, '');
		if (request.method === 'POST' && path === '/v1/upload') {
			tickets++;
			sendJson(response, 200, {
				upload_url: `${storage.url}/ltx-uploads/upload-${tickets}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=0f${tickets}`,
				storage_uri: `ltx://uploads/upload-${tickets}`,
				expires_at: '2026-10-19T13:00:00Z',
				required_headers: REQUIRED_HEADERS
			});
			return;
		}
		const create = /^\/v2\/([a-z-]+)$/.exec(path);
		if (request.method === 'POST' && create && ENDPOINTS.has(create[1])) {
			created++;
			sendJson(response, 202, { id: `job-${created}`, created_at: '2026-10-19T12:00:00.000Z' });
			return;
		}
		const ask = /^\/v2\/([a-z-]+)\/([^/]+)$/.exec(path);
		if (request.method === 'GET' && ask && ENDPOINTS.has(ask[1])) {
			const id = decodeURIComponent(ask[2]);
			const job = jobs.get(`${ask[1]}/${id}`) ?? { status: 'pending' };
			if (job.status === 'missing') {
				sendJson(response, 404, { type: 'error', error: { type: 'not_found_error', message: 'Job not found' } });
				return;
			}
			sendJson(response, 200, { id, created_at: '2026-10-19T12:00:00.000Z', ...job });
			return;
		}
		sendJson(response, 404, { type: 'error', error: { type: 'not_found_error', message: 'Not found' } });
	});
	return { api, storage, jobs, close: async () => { await api.close(); await storage.close(); } };
}

function creates(provider: Provider): Received[] {
	return provider.api.received.filter(request => request.method === 'POST' && /\/v2\/[a-z-]+$/.test(request.path));
}

function tickets(provider: Provider): Received[] {
	return provider.api.received.filter(request => request.path.endsWith('/v1/upload'));
}

function bodyOf(request: Received): unknown {
	return JSON.parse(request.body.toString('utf8'));
}

function ltxError(type: string, message: string) {
	return { type: 'error', error: { type, message } };
}

// --- the catalog --------------------------------------------------------------------------------

test('the catalog declares LTX with one region, one API key, and four models with their modes, limits, and settings', () => {
	assert.ok(PROVIDER_MODULES.includes(LTX), 'AI Video ships the LTX module');
	const provider = buildCatalog([LTX]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'ltx',
		label: 'LTX',
		regions: [{ id: 'global', label: 'LTX API', baseUrl: 'https://api.ltx.io', console: 'https://console.ltx.io' }],
		credentials: [{ id: 'apiKey', label: 'API Key' }]
	});
	assert.deepEqual(provider.models.map(model => ({
		id: model.id,
		label: model.label,
		sentAs: model.providerModels,
		prompt: model.prompt,
		modes: model.modes.map(mode => `${mode.id} ${mode.label}`),
		deprecated: model.deprecated
	})), [
		{ id: 'ltx-2-5-fast', label: 'LTX-2.5 Fast', sentAs: { global: 'ltx-2-5-fast' }, prompt: { required: 'withoutMedia', maxLength: 5000 }, modes: ['frames Frames', 'reference References'], deprecated: undefined },
		{ id: 'ltx-2-5-pro', label: 'LTX-2.5 Pro', sentAs: { global: 'ltx-2-5-pro' }, prompt: { required: 'withoutMedia', maxLength: 5000 }, modes: ['frames Frames', 'reference References'], deprecated: undefined },
		{ id: 'ltx-2-3-fast', label: 'LTX-2.3 Fast', sentAs: { global: 'ltx-2-3-fast' }, prompt: { required: 'withoutMedia', maxLength: 5000 }, modes: ['frames Frames'], deprecated: undefined },
		{ id: 'ltx-2-3-pro', label: 'LTX-2.3 Pro', sentAs: { global: 'ltx-2-3-pro' }, prompt: { required: 'withoutMedia', maxLength: 5000 }, modes: ['frames Frames', 'reference References', 'edit Edit', 'extend Extend'], deprecated: undefined }
	]);

	const none = { min: 0, max: 0 };
	const frames = {
		inputs: { startFrame: 'optional', endFrame: 'optional', images: none, videos: none, audios: none, source: 'none' },
		limits: { imageMaxBytes: 15 * MIB }
	};
	const references = (longest: number) => ({
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 1 }, videos: none, audios: { min: 1, max: 1 }, source: 'none' },
		limits: { imageMaxBytes: 15 * MIB, audioTotalSeconds: longest, audioMaxBytes: 32 * MIB }
	});
	const clip = (videoMaxBytes: number) => ({
		inputs: { startFrame: 'none', endFrame: 'none', images: none, videos: none, audios: none, source: 'required' },
		limits: { videoMaxBytes }
	});
	assert.deepEqual(Object.fromEntries(provider.models.map(model => [model.id, model.modes.map(mode => ({ inputs: mode.inputs, limits: mode.limits }))])), {
		'ltx-2-5-fast': [frames, references(20)],
		'ltx-2-5-pro': [frames, references(10)],
		'ltx-2-3-fast': [frames],
		'ltx-2-3-pro': [frames, references(20), clip(32 * MIB), clip(100 * MIB)]
	});

	const settings = (model: CatalogModel) => model.parameters.map(parameter => {
		const flags = [parameter.advanced ? 'advanced' : '', parameter.optional ? 'optional' : '', parameter.modes ? parameter.modes.join('+') : 'all'].filter(Boolean).join(' ');
		switch (parameter.kind) {
			case 'choice': return [parameter.name, parameter.label, parameter.options.map(option => `${option.value}=${option.label}`), parameter.default ?? null, flags];
			case 'integer':
			case 'number': return [parameter.name, parameter.label, parameter.kind, parameter.min, parameter.max, parameter.step, parameter.unit, parameter.default ?? null, parameter.auto ? `${parameter.auto.value}=${parameter.auto.label}` : 'no auto', flags];
			default: return [parameter.name, parameter.label, parameter.kind, parameter.default ?? null, flags];
		}
	});
	const resolution = (flags: string) => ['resolution', 'Resolution', ['720p=720p', '1080p=1080p', '2k=2K', '4k=4K'], '1080p', flags];
	const wide = ['16:9=16:9', '9:16=9:16', '1:1=1:1', '3:2=3:2', '2:3=2:3'];
	const ratio = (values: string[], flags: string) => ['ratio', 'Ratio', values, '16:9', flags];
	const fps = (flags: string) => ['fps', 'Frame Rate', ['24=24 fps', '25=25 fps', '48=48 fps', '50=50 fps'], 24, `advanced ${flags}`];
	const camera = (flags: string) => ['camera_motion', 'Camera Motion', ['dolly_in=Dolly In', 'dolly_out=Dolly Out', 'dolly_left=Dolly Left', 'dolly_right=Dolly Right', 'jib_up=Jib Up', 'jib_down=Jib Down', 'static=Static', 'focus_shift=Focus Shift'], null, `optional ${flags}`];
	assert.deepEqual(Object.fromEntries(provider.models.map(model => [model.id, settings(model)])), {
		'ltx-2-5-fast': [
			resolution('all'), ratio(wide, 'all'),
			['duration', 'Duration', 'integer', 6, 20, 2, 'seconds', 6, '-1=Auto', 'frames'],
			fps('all'), ['sound', 'Sound', 'boolean', true, 'frames'], camera('all')
		],
		'ltx-2-5-pro': [
			resolution('all'), ratio(wide, 'all'),
			['duration', 'Duration', 'integer', 6, 10, 2, 'seconds', 6, '-1=Auto', 'frames'],
			fps('all'), ['sound', 'Sound', 'boolean', true, 'frames'], camera('all')
		],
		'ltx-2-3-fast': [
			resolution('all'), ratio(['16:9=16:9', '9:16=9:16'], 'all'),
			['duration', 'Duration', 'integer', 6, 20, 2, 'seconds', 6, 'no auto', 'all'],
			fps('all'), ['sound', 'Sound', 'boolean', true, 'all'], camera('all')
		],
		'ltx-2-3-pro': [
			resolution('frames+reference'), ratio(['16:9=16:9', '9:16=9:16'], 'frames+reference'),
			['duration', 'Duration', 'integer', 6, 10, 2, 'seconds', 6, 'no auto', 'frames'],
			fps('frames+reference'), ['sound', 'Sound', 'boolean', true, 'frames'], camera('frames+reference'),
			['start_time', 'Start', 'number', 0, 3600, 0.1, 'seconds', 0, 'no auto', 'edit'],
			['retake_duration', 'Length', 'number', 2, 3600, 0.1, 'seconds', 5, 'no auto', 'edit'],
			['retake_mode', 'Replace', ['replace_audio_and_video=Video and Sound', 'replace_video=Video', 'replace_audio=Sound'], 'replace_audio_and_video', 'edit'],
			['extend_duration', 'Extension', 'integer', 2, 20, 1, 'seconds', 5, 'no auto', 'extend'],
			['extend_mode', 'Extend At', ['end=End', 'start=Start'], 'end', 'extend'],
			['context', 'Context', 'integer', 1, 20, 1, 'seconds', null, 'no auto', 'advanced optional extend']
		]
	});
	assert.ok(provider.models.flatMap(model => model.parameters).filter(parameter => parameter.name === 'ratio').every(parameter => parameter.kind === 'choice' && parameter.display === 'ratio'));
});

// --- creating a job -----------------------------------------------------------------------------

test('each mode of each model creates its job once, at its endpoint, with the exact body, and answers the endpoint with the job id', async () => {
	const provider = await startProvider();
	try {
		const api = provider.api.url;
		const cases: readonly { model: string; mode: Mode; params: Record<string, unknown>; inputs?: Inputs; prompt?: string; path: string; body: (uploaded: readonly string[]) => unknown }[] = [
			{
				model: 'ltx-2-5-fast', mode: 'frames', params: {},
				path: '/v2/text-to-video',
				body: () => ({ prompt: PROMPT, model: 'ltx-2-5-fast', duration: 6, resolution: '1920x1080', fps: 24, generate_audio: true })
			},
			{
				// Auto is sent as null; the shared values become LTX's size, frame rate, and sound.
				model: 'ltx-2-5-fast', mode: 'frames', params: { duration: -1, resolution: '720p', ratio: '3:2', fps: 25, sound: false, camera_motion: 'dolly_in' },
				path: '/v2/text-to-video',
				body: () => ({ prompt: PROMPT, model: 'ltx-2-5-fast', duration: null, resolution: '1080x720', fps: 25, generate_audio: false, camera_motion: 'dolly_in' })
			},
			{
				model: 'ltx-2-5-pro', mode: 'frames', params: { resolution: '2k', ratio: '1:1', duration: 10 }, inputs: { startFrame: image(START), endFrame: image(END, 'image/jpeg') },
				path: '/v2/image-to-video',
				body: () => ({ image_uri: dataUri(START), last_frame_uri: dataUri(END, 'image/jpeg'), prompt: PROMPT, model: 'ltx-2-5-pro', duration: 10, resolution: '1440x1440', fps: 24, generate_audio: true })
			},
			{
				model: 'ltx-2-3-fast', mode: 'frames', params: { resolution: '4k', ratio: '9:16', camera_motion: 'focus_shift' },
				path: '/v2/text-to-video',
				body: () => ({ prompt: PROMPT, model: 'ltx-2-3-fast', duration: 6, resolution: '2160x3840', fps: 24, generate_audio: true, camera_motion: 'focus_shift' })
			},
			{
				model: 'ltx-2-3-fast', mode: 'frames', params: { duration: 20, fps: 25 }, inputs: { startFrame: image(PORTRAIT) },
				path: '/v2/image-to-video',
				body: () => ({ image_uri: dataUri(PORTRAIT), prompt: PROMPT, model: 'ltx-2-3-fast', duration: 20, resolution: '1920x1080', fps: 25, generate_audio: true })
			},
			{
				model: 'ltx-2-3-pro', mode: 'frames', params: { resolution: '720p', duration: 8, fps: 50, sound: false },
				path: '/v2/text-to-video',
				body: () => ({ prompt: PROMPT, model: 'ltx-2-3-pro', duration: 8, resolution: '1280x720', fps: 50, generate_audio: false })
			},
			{
				// References: the image is LTX's first frame; the audio is always uploaded.
				model: 'ltx-2-5-fast', mode: 'reference', params: { ratio: '2:3', camera_motion: 'jib_up' }, inputs: { images: [image(PORTRAIT)], audios: [audio(VOICE)] },
				path: '/v2/audio-to-video',
				body: ([voice]) => ({ image_uri: dataUri(PORTRAIT), audio_uri: voice, prompt: PROMPT, model: 'ltx-2-5-fast', resolution: '1080x1620', fps: 24, camera_motion: 'jib_up' })
			},
			{
				model: 'ltx-2-5-pro', mode: 'reference', params: { resolution: '4k' }, inputs: { audios: [audio(SONG)] },
				path: '/v2/audio-to-video',
				body: ([song]) => ({ audio_uri: song, prompt: PROMPT, model: 'ltx-2-5-pro', resolution: '3840x2160', fps: 24 })
			},
			{
				// With an image, audio to video takes no prompt, and none is sent.
				model: 'ltx-2-3-pro', mode: 'reference', params: { ratio: '9:16', fps: 48 }, inputs: { images: [image(START)], audios: [audio(VOICE)] }, prompt: '  ',
				path: '/v2/audio-to-video',
				body: ([voice]) => ({ image_uri: dataUri(START), audio_uri: voice, model: 'ltx-2-3-pro', resolution: '1080x1920', fps: 48 })
			},
			{
				model: 'ltx-2-3-pro', mode: 'edit', params: {}, inputs: { source: video(CLIP) },
				path: '/v2/retake',
				body: ([clip]) => ({ video_uri: clip, start_time: 0, duration: 5, mode: 'replace_audio_and_video', prompt: PROMPT, model: 'ltx-2-3-pro' })
			},
			{
				model: 'ltx-2-3-pro', mode: 'edit', params: { start_time: 1.5, retake_duration: 2.5, retake_mode: 'replace_audio' }, inputs: { source: video(TAKE) }, prompt: '',
				path: '/v2/retake',
				body: ([take]) => ({ video_uri: take, start_time: 1.5, duration: 2.5, mode: 'replace_audio', model: 'ltx-2-3-pro' })
			},
			{
				model: 'ltx-2-3-pro', mode: 'extend', params: {}, inputs: { source: video(CLIP) },
				path: '/v2/extend',
				body: ([clip]) => ({ video_uri: clip, duration: 5, mode: 'end', prompt: PROMPT, model: 'ltx-2-3-pro' })
			},
			{
				model: 'ltx-2-3-pro', mode: 'extend', params: { extend_duration: 12, extend_mode: 'start', context: 8 }, inputs: { source: video(TAKE) }, prompt: '',
				path: '/v2/extend',
				body: ([take]) => ({ video_uri: take, duration: 12, mode: 'start', context: 8, model: 'ltx-2-3-pro' })
			}
		];
		const providers = commands();
		const outcomes = [];
		const expected = [];
		for (const [index, entry] of cases.entries()) {
			const before = provider.api.received.length;
			const ticketsBefore = tickets(provider).length;
			const answer = await providers.submit(generation(api, entry.model, entry.mode, entry.params, entry.inputs, entry.prompt));
			const sent = provider.api.received.slice(before);
			const uploaded = Array.from({ length: tickets(provider).length - ticketsBefore }, (_, offset) => `ltx://uploads/upload-${ticketsBefore + offset + 1}`);
			const create = sent[sent.length - 1];
			outcomes.push({
				answer,
				create: { method: create.method, path: create.path, authorization: create.headers.authorization, type: create.headers['content-type'], body: bodyOf(create) },
				others: sent.slice(0, -1).map(request => `${request.method} ${request.path}`)
			});
			expected.push({
				answer: { ok: true, value: { remoteId: `${entry.path.slice('/v2/'.length)}/job-${index + 1}` } },
				create: { method: 'POST', path: entry.path, authorization: `Bearer ${KEY}`, type: 'application/json', body: entry.body(uploaded) },
				others: uploaded.map(() => 'POST /v1/upload')
			});
		}
		assert.deepEqual(outcomes, expected);
		// One upload for each video and audio input; the images here are small enough to go inline.
		assert.equal(provider.storage.received.length, 7);
		assert.equal(creates(provider).length, cases.length);
	} finally {
		await provider.close();
	}
});

test('an endpoint with a path, such as a relay that mirrors LTX\'s API, keeps its path for uploads, creating, and asking', async () => {
	const provider = await startProvider();
	try {
		const providers = commands();
		const endpoint = `${provider.api.url}/relay/ltx/`;
		const submitted = value(await providers.submit(generation(endpoint, 'ltx-2-3-pro', 'reference', {}, { audios: [audio(VOICE)] })));
		provider.jobs.set('audio-to-video/job-1', { status: 'processing' });
		const polled = value(await providers.poll(taskRef(endpoint, submitted.remoteId, 'ltx-2-3-pro')));
		assert.deepEqual({ submitted, polled, sent: provider.api.received.map(request => [request.method, request.path, request.headers.authorization]) }, {
			submitted: { remoteId: 'audio-to-video/job-1' },
			polled: { state: 'running' },
			sent: [
				['POST', '/relay/ltx/v1/upload', `Bearer ${KEY}`],
				['POST', '/relay/ltx/v2/audio-to-video', `Bearer ${KEY}`],
				['GET', '/relay/ltx/v2/audio-to-video/job-1', `Bearer ${KEY}`]
			]
		});
	} finally {
		await provider.close();
	}
});

// --- inputs and the upload ----------------------------------------------------------------------

test('videos, audio, and images too large for a data URI go through LTX\'s upload, with the headers it asks for and without the key', async () => {
	const provider = await startProvider({
		api(request, response) {
			if (request.path === '/v1/upload' && tickets(provider).length === 1) {
				// Headers AI Video sets itself are not taken from the answer; the others are sent unchanged.
				sendJson(response, 200, {
					upload_url: `${provider.storage.url}/ltx-uploads/upload-1?X-Goog-Signature=0f1`,
					storage_uri: 'ltx://uploads/upload-1',
					expires_at: '2026-10-19T13:00:00Z',
					required_headers: { ...REQUIRED_HEADERS, 'X-Goog-Meta-Origin': 'basehalf-test', 'Content-Length': '1', 'Host': 'elsewhere.invalid' }
				});
				return true;
			}
			if (request.path === '/v1/upload' && tickets(provider).length === 2) {
				sendJson(response, 200, { upload_url: `${provider.storage.url}/ltx-uploads/upload-2?X-Goog-Signature=0f2`, storage_uri: 'ltx://uploads/upload-2', expires_at: '2026-10-19T13:00:00Z', required_headers: REQUIRED_HEADERS });
				return true;
			}
			return false;
		}
	});
	try {
		const remoteId = value(await commands().submit(generation(provider.api.url, 'ltx-2-5-pro', 'reference', {}, { images: [image(LARGE)], audios: [audio(SONG)] }))).remoteId;
		const [first, second] = provider.storage.received;
		const ticket = tickets(provider)[0];
		const put = (request: Received) => ({
			method: request.method,
			path: request.path,
			type: request.headers['content-type'],
			length: request.headers['content-length'],
			host: request.headers.host,
			range: request.headers['x-goog-content-length-range'],
			match: request.headers['x-goog-if-generation-match'],
			authorization: request.headers.authorization ?? 'no key'
		});
		const storageHost = new URL(provider.storage.url).host;
		assert.deepEqual({
			remoteId,
			ticket: { method: ticket.method, authorization: ticket.headers.authorization, body: ticket.body.byteLength },
			puts: [put(first), put(second)],
			meta: [first.headers['x-goog-meta-origin'], second.headers['x-goog-meta-origin']],
			bytes: [first.body.equals(readFileSync(LARGE)), second.body.equals(readFileSync(SONG))],
			create: bodyOf(creates(provider)[0])
		}, {
			remoteId: 'audio-to-video/job-1',
			ticket: { method: 'POST', authorization: `Bearer ${KEY}`, body: 0 },
			puts: [
				{ method: 'PUT', path: '/ltx-uploads/upload-1?X-Goog-Signature=0f1', type: 'image/png', length: String(readFileSync(LARGE).byteLength), host: storageHost, range: '0,209715200', match: '0', authorization: 'no key' },
				{ method: 'PUT', path: '/ltx-uploads/upload-2?X-Goog-Signature=0f2', type: 'audio/mpeg', length: String(readFileSync(SONG).byteLength), host: storageHost, range: '0,209715200', match: '0', authorization: 'no key' }
			],
			meta: ['basehalf-test', undefined],
			bytes: [true, true],
			create: { image_uri: 'ltx://uploads/upload-1', audio_uri: 'ltx://uploads/upload-2', prompt: PROMPT, model: 'ltx-2-5-pro', resolution: '1920x1080', fps: 24 }
		});
		// The large image's data URI would be longer than 7,000,000 characters; the small images of the other tests go inline.
		assert.ok(dataUri(LARGE).length > 7_000_000 && dataUri(START).length < 7_000_000);
	} finally {
		await provider.close();
	}
});

test('an upload whose answer was lost is sent again and found there; a refused upload or ticket makes no job', async () => {
	let storageAnswer: 'drop-then-found' | 'expired' | 'ok' = 'drop-then-found';
	let ticketAnswer: 'ok' | 'refused' | 'unreadable' = 'ok';
	const provider = await startProvider({
		storage(request, response, socket) {
			if (storageAnswer === 'expired') {
				const xml = '<?xml version=\'1.0\' encoding=\'UTF-8\'?><Error><Code>ExpiredToken</Code><Message>The provided token has expired.</Message></Error>';
				response.writeHead(400, { 'Content-Type': 'application/xml', 'Content-Length': String(Buffer.byteLength(xml)) });
				response.end(xml);
				return true;
			}
			if (storageAnswer === 'drop-then-found') {
				if (provider.storage.received.length === 1) {
					// The file arrived and the answer is lost: the upload is sent again.
					socket.destroy();
					return true;
				}
				const xml = '<?xml version=\'1.0\' encoding=\'UTF-8\'?><Error><Code>PreconditionFailed</Code><Message>At least one of the pre-conditions you specified did not hold.</Message></Error>';
				response.writeHead(412, { 'Content-Type': 'application/xml', 'Content-Length': String(Buffer.byteLength(xml)) });
				response.end(xml);
				return true;
			}
			return false;
		},
		api(request, response) {
			if (request.path === '/v1/upload' && ticketAnswer === 'refused') {
				sendJson(response, 401, ltxError('authentication_error', 'Invalid API key'));
				return true;
			}
			if (request.path === '/v1/upload' && ticketAnswer === 'unreadable') {
				sendJson(response, 200, { upload_url: `${provider.storage.url}/ltx-uploads/x`, expires_at: '2026-10-19T13:00:00Z' });
				return true;
			}
			return false;
		}
	});
	try {
		const sleep = recordingSleep();
		const providers = commands({ http: { sleep: sleep.sleep } });
		const request = generation(provider.api.url, 'ltx-2-3-pro', 'extend', {}, { source: video(CLIP) });
		const found = value(await providers.submit(request));
		const sameAddress = provider.storage.received[0].path === provider.storage.received[1].path;
		storageAnswer = 'expired';
		const expired = error(await providers.submit(request));
		storageAnswer = 'ok';
		ticketAnswer = 'refused';
		const refused = error(await providers.submit(request));
		ticketAnswer = 'unreadable';
		const unreadable = error(await providers.submit(request));
		assert.deepEqual({ found, sameAddress, waits: sleep.waits, expired, refused, unreadable, tickets: tickets(provider).length, puts: provider.storage.received.length, creates: creates(provider).map(bodyOf) }, {
			found: { remoteId: 'extend/job-1' },
			sameAddress: true,
			waits: [1000],
			expired: { code: 'rejected', message: 'LTX\'s storage refused the source video clip.mp4 (HTTP 400, ExpiredToken): The provided token has expired.', status: 400 },
			refused: { code: 'auth', message: 'LTX could not take the source video clip.mp4: LTX refused the API key. Check it in Video Providers. (authentication_error: Invalid API key)', status: 401 },
			unreadable: { code: 'rejected', message: 'LTX could not take the source video clip.mp4: LTX answered the upload request in a form AI Video cannot read.' },
			tickets: 4,
			puts: 3,
			creates: [{ video_uri: 'ltx://uploads/upload-1', duration: 5, mode: 'end', prompt: PROMPT, model: 'ltx-2-3-pro' }]
		});
	} finally {
		await provider.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome, and it was sent once', async () => {
	const provider = await startProvider({
		api(request, response, socket) {
			if (request.method === 'POST' && request.path.startsWith('/v2/')) {
				socket.destroy();
				return true;
			}
			return false;
		}
	});
	try {
		const failed = error(await commands().submit(generation(provider.api.url, 'ltx-2-5-pro', 'frames', {}, { startFrame: image(START) })));
		assert.deepEqual({ code: failed.code, sent: creates(provider).length }, { code: 'unknownOutcome', sent: 1 });
	} finally {
		await provider.close();
	}
});

// --- errors -------------------------------------------------------------------------------------

test('a refused key answers auth for a create and for a poll, and no message carries the key', async () => {
	const provider = await startProvider({
		api(request, response) {
			sendJson(response, 401, ltxError('authentication_error', `Invalid API key ${KEY}`));
			return true;
		}
	});
	try {
		const providers = commands();
		const submitted = error(await providers.submit(generation(provider.api.url, 'ltx-2-3-fast', 'frames', {})));
		const polled = error(await providers.poll(taskRef(provider.api.url, 'text-to-video/job-1')));
		const message = 'LTX refused the API key. Check it in Video Providers. (authentication_error: Invalid API key ***)';
		assert.deepEqual({ submitted, polled, sent: provider.api.received.length }, {
			submitted: { code: 'auth', message, status: 401 },
			polled: { code: 'auth', message, status: 401 },
			sent: 2
		});
		assert.ok(!JSON.stringify([submitted, polled]).includes(KEY));
	} finally {
		await provider.close();
	}
});

test('too many requests answer rateLimited with LTX\'s words and the wait it asks for; a create is never sent again, a poll is', async () => {
	let polls = 0;
	const provider = await startProvider({
		api(request, response) {
			if (request.method === 'POST' && request.path === '/v2/text-to-video') {
				const queue = creates(provider).length === 1;
				sendJson(response, 429, queue
					? ltxError('rate_limit_error', 'Queue limit exceeded. Please try again later.')
					: ltxError('concurrency_limit_error', 'Too many concurrent requests. Please try again later.'), queue ? {} : { 'Retry-After': '60' });
				return true;
			}
			if (request.method === 'GET' && ++polls === 1) {
				sendJson(response, 429, ltxError('rate_limit_error', 'Queue limit exceeded. Please try again later.'), { 'Retry-After': '2' });
				return true;
			}
			return false;
		}
	});
	try {
		const sleep = recordingSleep();
		const providers = commands({ http: { sleep: sleep.sleep } });
		const queue = error(await providers.submit(generation(provider.api.url, 'ltx-2-5-fast', 'frames', {})));
		const concurrency = error(await providers.submit(generation(provider.api.url, 'ltx-2-5-fast', 'frames', {})));
		provider.jobs.set('text-to-video/job-7', { status: 'processing' });
		const polled = value(await providers.poll(taskRef(provider.api.url, 'text-to-video/job-7')));
		assert.deepEqual({ queue, concurrency, polled, creates: creates(provider).length, polls, waits: sleep.waits }, {
			queue: { code: 'rateLimited', message: 'LTX\'s job queue for the organization is full. Wait for a generation to finish. (rate_limit_error: Queue limit exceeded. Please try again later.)', status: 429 },
			concurrency: { code: 'rateLimited', message: 'LTX is running as many generations at once as the organization may (2 by default). Wait for one to finish. (concurrency_limit_error: Too many concurrent requests. Please try again later.) The provider asks to wait 60 seconds.', status: 429 },
			polled: { state: 'running' },
			creates: 2,
			polls: 2,
			waits: [2000]
		});
	} finally {
		await provider.close();
	}
});

test('other refusals make no job; LTX\'s own errors and answers without a job id leave the outcome unknown', async () => {
	const replies: readonly [number, unknown][] = [
		[402, ltxError('insufficient_funds_error', 'Not enough credits')],
		[403, ltxError('permission_error', 'This endpoint is not available for your account')],
		[422, ltxError('content_filtered_error', 'Content rejected by safety filters')],
		[400, ltxError('invalid_request_error', 'resolution 1080x720 is not supported')],
		[404, ltxError('not_found_error', 'Not found')],
		[500, ltxError('api_error', 'An unexpected error occurred')],
		[503, ltxError('service_unavailable_error', 'Service temporarily unavailable')],
		[529, ltxError('overloaded_error', 'API temporarily overloaded')],
		[202, { created_at: '2026-10-19T12:00:00.000Z' }],
		[202, 'accepted'],
		[202, { id: 'job-11', created_at: '2026-10-19T12:00:00.000Z' }]
	];
	let next = 0;
	const provider = await startProvider({
		api(request, response) {
			const [status, body] = replies[next++];
			sendJson(response, status, body);
			return true;
		}
	});
	try {
		const providers = commands();
		const outcomes = [];
		for (let index = 0; index < replies.length; index++) {
			const answer = await providers.submit(generation(provider.api.url, 'ltx-2-3-fast', 'frames', {}));
			outcomes.push(answer.ok ? answer.value : [answer.error.code, answer.error.status, answer.error.message]);
		}
		assert.deepEqual({ outcomes, sent: provider.api.received.length }, {
			outcomes: [
				['balance', 402, 'The LTX account has too few credits. Buy credits in the LTX console. (insufficient_funds_error: Not enough credits)'],
				['rejected', 403, 'LTX does not offer this to the account. (permission_error: This endpoint is not available for your account)'],
				['rejected', 422, 'LTX\'s safety filters refused the prompt or an input. (content_filtered_error: Content rejected by safety filters)'],
				['rejected', 400, 'LTX refused the request as invalid. (invalid_request_error: resolution 1080x720 is not supported)'],
				['rejected', 404, 'LTX: Not found (not_found_error)'],
				['unknownOutcome', 500, 'LTX had an internal error. (api_error: An unexpected error occurred)'],
				['unknownOutcome', 503, 'LTX is unavailable for a while. (service_unavailable_error: Service temporarily unavailable)'],
				['unknownOutcome', 529, 'LTX is overloaded for a while. (overloaded_error: API temporarily overloaded)'],
				['unknownOutcome', undefined, 'LTX accepted the request but gave no job id AI Video can read.'],
				['unknownOutcome', undefined, 'The provider accepted the request but answered in a form AI Video cannot read.'],
				{ remoteId: 'text-to-video/job-11' }
			],
			sent: replies.length
		});
	} finally {
		await provider.close();
	}
});

// --- asking about a job -------------------------------------------------------------------------

test('a job is asked about at the endpoint it was made at, and pending, processing, completed, and failed are mapped', async () => {
	const provider = await startProvider();
	try {
		provider.jobs.set('image-to-video/job-b', { status: 'processing' });
		provider.jobs.set('audio-to-video/job-c', { status: 'completed', completed_at: '2026-10-19T12:02:30.000Z', result: { video_url: 'https://storage.googleapis.com/ltx-results/job-c.mp4' } });
		provider.jobs.set('retake/job-d', { status: 'failed', completed_at: '2026-10-19T12:01:00.000Z', error: { type: 'content_filtered_error', message: 'Content rejected by safety filters' } });
		provider.jobs.set('extend/job-e', { status: 'failed', completed_at: '2026-10-19T12:01:00.000Z' });
		provider.jobs.set('text-to-video/job-f', { status: 'queued' });
		provider.jobs.set('text-to-video/job-g', { status: 'completed', completed_at: '2026-10-19T12:02:30.000Z', result: { exr_frames_url: 'https://storage.googleapis.com/ltx-results/job-g.zip' } });
		provider.jobs.set('text-to-video/job-h', { status: 'missing' });
		const providers = commands();
		const states = [];
		for (const remoteId of ['text-to-video/job-a', 'image-to-video/job-b', 'audio-to-video/job-c', 'retake/job-d', 'extend/job-e']) {
			states.push(value(await providers.poll(taskRef(provider.api.url, remoteId))));
		}
		const asked = provider.api.received.map(request => `${request.method} ${request.path} ${request.headers.authorization}`);
		const others = [];
		for (const remoteId of ['text-to-video/job-f', 'text-to-video/job-g', 'text-to-video/job-h']) {
			others.push(error(await providers.poll(taskRef(provider.api.url, remoteId))).code);
		}
		const sentBefore = provider.api.received.length;
		const notLtx = [error(await providers.poll(taskRef(provider.api.url, 'job-i'))), error(await providers.poll(taskRef(provider.api.url, 'video-to-video-hdr/job-j')))];
		assert.deepEqual({ states, asked, others, notLtx, sentForNotLtx: provider.api.received.length - sentBefore }, {
			states: [
				{ state: 'pending' },
				{ state: 'running' },
				{ state: 'succeeded', videoUrl: 'https://storage.googleapis.com/ltx-results/job-c.mp4' },
				{ state: 'failed', message: 'LTX\'s safety filters refused the prompt or an input. (content_filtered_error: Content rejected by safety filters)' },
				{ state: 'failed', message: 'LTX reports that the job failed.' }
			],
			asked: [
				`GET /v2/text-to-video/job-a Bearer ${KEY}`,
				`GET /v2/image-to-video/job-b Bearer ${KEY}`,
				`GET /v2/audio-to-video/job-c Bearer ${KEY}`,
				`GET /v2/retake/job-d Bearer ${KEY}`,
				`GET /v2/extend/job-e Bearer ${KEY}`
			],
			others: ['invalidResponse', 'invalidResponse', 'notFound'],
			notLtx: [
				{ code: 'rejected', message: 'The task job-i names no LTX endpoint, so AI Video cannot ask LTX about it.' },
				{ code: 'rejected', message: 'The task video-to-video-hdr/job-j names no LTX endpoint, so AI Video cannot ask LTX about it.' }
			],
			sentForNotLtx: 0
		});
	} finally {
		await provider.close();
	}
});

test('the video downloads from the address the poll gave, without the key, and without an address from the job asked about again', async () => {
	const mp4 = isoMedia(6);
	const cdn = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4.byteLength) });
		response.end(mp4);
	});
	const provider = await startProvider();
	try {
		provider.jobs.set('extend/job-9', { status: 'completed', completed_at: '2026-10-19T12:02:30.000Z', result: { video_url: `${cdn.url}/ltx-results/job-9.mp4?X-Goog-Signature=ab` } });
		provider.jobs.set('extend/job-10', { status: 'processing' });
		const providers = commands();
		const ref = taskRef(provider.api.url, 'extend/job-9', 'ltx-2-3-pro');
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: polled.state === 'succeeded' ? polled.videoUrl : undefined, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		const notReady = error(await providers.download({ ...taskRef(provider.api.url, 'extend/job-10', 'ltx-2-3-pro'), targetFsPath: join(folder, 'third.mp4.part') }));
		assert.deepEqual({
			withAddress,
			withoutAddress,
			notReady,
			same: [readFileSync(first).equals(mp4), readFileSync(second).equals(mp4)],
			cdn: cdn.received.map(request => `${request.path} ${request.headers.authorization ?? 'no key'}`),
			asked: provider.api.received.map(request => request.path)
		}, {
			withAddress: { size: mp4.byteLength, format: 'mp4' },
			withoutAddress: { size: mp4.byteLength, format: 'mp4' },
			notReady: { code: 'invalidResponse', message: 'LTX gives no address of a video for this job.' },
			same: [true, true],
			cdn: ['/ltx-results/job-9.mp4?X-Goog-Signature=ab no key', '/ltx-results/job-9.mp4?X-Goog-Signature=ab no key'],
			asked: ['/v2/extend/job-9', '/v2/extend/job-9', '/v2/extend/job-10']
		});
	} finally {
		await provider.close();
		await cdn.close();
	}
});

test('LTX has no cancellation: cancel answers false and sends nothing', async () => {
	const provider = await startProvider();
	try {
		const answer = value(await commands().cancel(taskRef(provider.api.url, 'text-to-video/job-1')));
		assert.deepEqual({ answer, sent: provider.api.received.length }, { answer: { cancelled: false }, sent: 0 });
	} finally {
		await provider.close();
	}
});

// --- checks -------------------------------------------------------------------------------------

test('check reports the rules between settings and inputs that the declarations cannot express', async () => {
	const providers = commands();
	const problems = async (model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs, prompt = PROMPT) =>
		value(await providers.check(checkRequest(model, mode, params, inputs, prompt))).problems;
	assert.deepEqual({
		promptWithFrame: await problems('ltx-2-5-fast', 'frames', {}, plannedFiles({ startFrame: true }), ' '),
		promptWithoutFrame: await problems('ltx-2-3-pro', 'frames', {}, plannedFiles(), ''),
		fastLongAt4k: await problems('ltx-2-5-fast', 'frames', { duration: 12, resolution: '4k' }, plannedFiles()),
		fastLongAt48: await problems('ltx-2-3-fast', 'frames', { duration: 20, fps: 48 }, plannedFiles({ startFrame: true })),
		fastLongAt720p: await problems('ltx-2-5-fast', 'frames', { duration: 20, resolution: '720p', fps: 25 }, plannedFiles()),
		fastTenAt4k: await problems('ltx-2-3-fast', 'frames', { duration: 10, resolution: '4k', fps: 50 }, plannedFiles()),
		proLong: await problems('ltx-2-5-pro', 'frames', { duration: 12 }, plannedFiles()),
		oddDuration: await problems('ltx-2-3-pro', 'frames', { duration: 7 }, plannedFiles()),
		autoWithEndFrame: await problems('ltx-2-5-pro', 'frames', { duration: -1 }, plannedFiles({ startFrame: true, endFrame: true })),
		autoWithStartFrame: await problems('ltx-2-5-pro', 'frames', { duration: -1 }, plannedFiles({ startFrame: true })),
		autoOn23: await problems('ltx-2-3-fast', 'frames', { duration: -1 }, plannedFiles()),
		squareOn23: await problems('ltx-2-3-pro', 'frames', { ratio: '1:1' }, plannedFiles()),
		referencesWithoutAudio: await problems('ltx-2-5-fast', 'reference', {}, plannedFiles({ images: 1 })),
		referencesTwoImages: await problems('ltx-2-5-fast', 'reference', {}, plannedFiles({ images: 2, audios: 1 })),
		referencesAudioWithoutPrompt: await problems('ltx-2-3-pro', 'reference', {}, plannedFiles({ audios: 1 }), ''),
		referencesImageWithoutPrompt: await problems('ltx-2-3-pro', 'reference', {}, plannedFiles({ images: 1, audios: 1 }), ''),
		noReferencesOn23Fast: await problems('ltx-2-3-fast', 'reference', {}, plannedFiles({ audios: 1 })),
		noEditOn25: await problems('ltx-2-5-pro', 'edit', {}, plannedFiles({ source: true })),
		extendWithoutClip: await problems('ltx-2-3-pro', 'extend', {}, plannedFiles()),
		editWithoutPrompt: await problems('ltx-2-3-pro', 'edit', {}, plannedFiles({ source: true }), ''),
		soundInEdit: await problems('ltx-2-3-pro', 'edit', { sound: false }, plannedFiles({ source: true })),
		contextTooLong: await problems('ltx-2-3-pro', 'extend', { context: 25 }, plannedFiles({ source: true })),
		sectionTooShort: await problems('ltx-2-3-pro', 'edit', { retake_duration: 1.5 }, plannedFiles({ source: true }))
	}, {
		promptWithFrame: ['Write a prompt: LTX-2.5 Fast needs one in Frames mode.'],
		promptWithoutFrame: ['Write a prompt or connect an image: LTX-2.3 Pro needs one or the other.'],
		fastLongAt4k: ['LTX-2.5 Fast makes videos longer than 10 seconds only at 720p or 1080p and 24 or 25 fps.'],
		fastLongAt48: ['LTX-2.3 Fast makes videos longer than 10 seconds only at 720p or 1080p and 24 or 25 fps.'],
		fastLongAt720p: [],
		fastTenAt4k: [],
		proLong: ['Duration must be between 6 and 10 seconds, or Auto.'],
		oddDuration: ['Duration must be a step of 2 from 6.'],
		autoWithEndFrame: ['LTX-2.5 Pro cannot choose the length itself with an end frame: choose a duration, or leave out the end frame.'],
		autoWithStartFrame: [],
		autoOn23: ['Duration must be between 6 and 20 seconds.'],
		squareOn23: ['Ratio cannot be 1:1 for LTX-2.3 Pro; choose 16:9, 9:16.'],
		referencesWithoutAudio: ['LTX-2.5 Fast in References mode needs at least 1 reference audio.'],
		referencesTwoImages: ['LTX-2.5 Fast in References mode takes at most 1 reference image; 2 are planned.'],
		referencesAudioWithoutPrompt: ['Write a prompt or connect an image: LTX-2.3 Pro needs one or the other.'],
		referencesImageWithoutPrompt: [],
		noReferencesOn23Fast: ['LTX-2.3 Fast has no reference mode.'],
		noEditOn25: ['LTX-2.5 Pro has no edit mode.'],
		extendWithoutClip: ['LTX-2.3 Pro in Extend mode needs a video to work on.'],
		editWithoutPrompt: [],
		soundInEdit: ['Sound does not apply in Edit mode.'],
		contextTooLong: ['Context must be between 1 and 20 seconds.'],
		sectionTooShort: ['Length must be between 2 and 3600 seconds.']
	});
});

test('check refuses clips and audio LTX does not take; submit refuses PCM audio and every problem before anything is sent', async () => {
	const provider = await startProvider();
	try {
		const providers = commands();
		const problems = async (model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs, prompt = PROMPT) =>
			value(await providers.check(checkRequest(model, mode, params, inputs, prompt))).problems;
		const checked = {
			shortClip: await problems('ltx-2-3-pro', 'edit', {}, { source: video(SHORT) }),
			webm: await problems('ltx-2-3-pro', 'extend', {}, { source: { fsPath: WEBM, mimeType: 'video/webm' } }),
			movie: await problems('ltx-2-3-pro', 'extend', {}, { source: video(TAKE) }),
			sectionAfterClip: await problems('ltx-2-3-pro', 'edit', { start_time: 4.5 }, { source: video(CLIP) }),
			sectionAtEnd: await problems('ltx-2-3-pro', 'edit', { start_time: 3.5 }, { source: video(CLIP) }),
			longAudioAt4k: await problems('ltx-2-3-pro', 'reference', { resolution: '4k' }, { audios: [audio(SPEECH)] }),
			longAudioAt1080p: await problems('ltx-2-3-pro', 'reference', {}, { audios: [audio(SPEECH)] }),
			longAudioOnPro: await problems('ltx-2-5-pro', 'reference', {}, { audios: [audio(SPEECH)] }),
			// check measures lengths only; submit reads the file and refuses PCM.
			pcmChecked: await problems('ltx-2-5-fast', 'reference', {}, { audios: [audio(PCM)] })
		};
		const submitted = {
			pcm: error(await providers.submit(generation(provider.api.url, 'ltx-2-5-fast', 'reference', {}, { images: [image(START)], audios: [audio(PCM)] }))),
			pcmExtensible: error(await providers.submit(generation(provider.api.url, 'ltx-2-3-pro', 'reference', {}, { audios: [audio(PCM_EXTENSIBLE)] }))),
			shortClip: error(await providers.submit(generation(provider.api.url, 'ltx-2-3-pro', 'extend', {}, { source: video(SHORT) }))),
			promptWithFrame: error(await providers.submit(generation(provider.api.url, 'ltx-2-3-fast', 'frames', {}, { startFrame: image(START) }, '')))
		};
		const nothingSent = provider.api.received.length + provider.storage.received.length;
		const compressed = value(await providers.submit(generation(provider.api.url, 'ltx-2-3-pro', 'reference', {}, { audios: [audio(COMPRESSED_WAV)] })));
		assert.deepEqual({ checked, submitted, nothingSent, compressed, type: provider.storage.received[0]?.headers['content-type'] }, {
			checked: {
				shortClip: ['The source video short.mp4 is 2 seconds long; LTX needs a clip of at least 73 frames, about 3 seconds at 24 fps.'],
				webm: ['The source video clip.webm is not an MP4 or MOV video whose length AI Video can read.'],
				movie: [],
				sectionAfterClip: ['The section starts at 4.5 seconds, after the end of the source video clip.mp4, which is 4 seconds long.'],
				sectionAtEnd: [],
				longAudioAt4k: ['Reference audio 1 speech.m4a is 14 seconds long; at 4K, LTX-2.3 Pro takes at most 10 seconds of audio.'],
				longAudioAt1080p: [],
				longAudioOnPro: ['The audio clips are 14 seconds long together; at most 10 seconds are allowed.'],
				pcmChecked: []
			},
			submitted: {
				pcm: { code: 'rejected', message: 'Reference audio 1 pcm.wav holds PCM audio, which LTX does not take. Use MP3 or M4A audio, or a WAV of AAC, MP3, Vorbis, or FLAC audio.' },
				pcmExtensible: { code: 'rejected', message: 'Reference audio 1 pcm-extensible.wav holds PCM audio, which LTX does not take. Use MP3 or M4A audio, or a WAV of AAC, MP3, Vorbis, or FLAC audio.' },
				shortClip: { code: 'rejected', message: 'The source video short.mp4 is 2 seconds long; LTX needs a clip of at least 73 frames, about 3 seconds at 24 fps.' },
				promptWithFrame: { code: 'rejected', message: 'Write a prompt: LTX-2.3 Fast needs one in Frames mode.' }
			},
			nothingSent: 0,
			compressed: { remoteId: 'audio-to-video/job-1' },
			type: 'audio/wav'
		});
	} finally {
		await provider.close();
	}
});

test('check refuses audio or a clip whose length cannot be read, and nothing else in three or more combinations of each mode', async () => {
	const providers = commands();
	const problems = async (model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs) =>
		value(await providers.check(checkRequest(model, mode, params, inputs))).problems;
	const unreadableAudio = ['Reference audio 1 unreadable.mp3 is not audio whose length AI Video can read (WAV, MP3, or M4A).'];
	const unreadableClip = ['The source video unreadable.mp4 is not an MP4 or MOV video whose length AI Video can read.'];
	assert.deepEqual({
		// Text and image to video.
		proAt4k: await problems('ltx-2-5-pro', 'frames', { resolution: '4k', duration: 8 }, plannedFiles()),
		fastDefaults: await problems('ltx-2-3-fast', 'frames', {}, plannedFiles()),
		proFromFrame: await problems('ltx-2-3-pro', 'frames', { resolution: '720p', duration: 10 }, plannedFiles({ startFrame: true })),
		fastAt1440p: await problems('ltx-2-5-fast', 'frames', { resolution: '2k', ratio: '3:2', duration: 10 }, plannedFiles()),
		fastAuto: await problems('ltx-2-5-fast', 'frames', { duration: -1 }, plannedFiles()),
		fastAutoAt48: await problems('ltx-2-5-fast', 'frames', { duration: -1, fps: 48 }, plannedFiles()),
		// Audio to video.
		audioMeasured: await problems('ltx-2-3-pro', 'reference', {}, { audios: [audio(VOICE)] }),
		audioUnreadable: await problems('ltx-2-5-fast', 'reference', {}, { audios: [audio(UNREADABLE_AUDIO)] }),
		audioProAt4k: await problems('ltx-2-5-pro', 'reference', { resolution: '4k' }, { images: [image(START)], audios: [audio(UNREADABLE_AUDIO)] }),
		audioAt1440p: await problems('ltx-2-3-pro', 'reference', { resolution: '2k' }, { audios: [audio(UNREADABLE_AUDIO)] }),
		// Retake.
		retakeClip: await problems('ltx-2-3-pro', 'edit', {}, { source: video(CLIP) }),
		retakeMovie: await problems('ltx-2-3-pro', 'edit', { start_time: 1, retake_duration: 2 }, { source: video(TAKE) }),
		retakeUnreadable: await problems('ltx-2-3-pro', 'edit', {}, { source: video(UNREADABLE_CLIP) }),
		// Extend, without and with a Context.
		extendUnreadable: await problems('ltx-2-3-pro', 'extend', {}, { source: video(UNREADABLE_CLIP) }),
		extendClip: await problems('ltx-2-3-pro', 'extend', {}, { source: video(CLIP) }),
		extendContextClip: await problems('ltx-2-3-pro', 'extend', { extend_duration: 12, context: 8 }, { source: video(CLIP) }),
		extendContextUnreadable: await problems('ltx-2-3-pro', 'extend', { extend_duration: 12, context: 8 }, { source: video(UNREADABLE_CLIP) })
	}, {
		proAt4k: [],
		fastDefaults: [],
		proFromFrame: [],
		fastAt1440p: [],
		fastAuto: [],
		fastAutoAt48: [],
		audioMeasured: [],
		audioUnreadable: unreadableAudio,
		audioProAt4k: unreadableAudio,
		audioAt1440p: unreadableAudio,
		retakeClip: [],
		retakeMovie: [],
		retakeUnreadable: unreadableClip,
		extendUnreadable: unreadableClip,
		extendClip: [],
		extendContextClip: [],
		extendContextUnreadable: unreadableClip
	});
});
