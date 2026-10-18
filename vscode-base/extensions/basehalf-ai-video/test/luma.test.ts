/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Luma module (docs/specs/video-providers/luma.md) through the provider
 * commands, against a local server that answers like the Luma Agents API and
 * a second one that answers like the storage its presigned uploads go to. No
 * test calls Luma or uses a real key.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import { LUMA } from '../src/providers/luma.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { CatalogParameter, Estimate } from '../src/providers/types.ts';
import { error, gifHeader, isoMedia, jpegHeader, png, recordingSleep, sendJson, startServer, value, webpHeader, type Received, type TestServer } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-luma-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

interface FileMedia {
	readonly fsPath: string;
	readonly mimeType: string;
}

function file(name: string, bytes: Buffer, mimeType: string): FileMedia {
	const fsPath = join(folder, name);
	writeFileSync(fsPath, bytes);
	return { fsPath, mimeType };
}

const START = file('start.png', png(640, 360), 'image/png');
const END = file('end.jpg', jpegHeader(1280, 720), 'image/jpeg');
const WEBP_END = file('end.webp', webpHeader('VP8X', 640, 360), 'image/webp');
const GIF = file('moving.gif', gifHeader(640, 360), 'image/gif');
const GUIDE = file('guide.png', png(400, 300), 'image/png');
const CLIP = file('clip.mp4', isoMedia(8), 'video/mp4');
const MOV_CLIP = file('clip.mov', isoMedia(4, { brand: 'qt  ' }), 'video/quicktime');
const LONG_CLIP = file('long.mp4', isoMedia(20), 'video/mp4');
const CLIP_3S = file('three.mp4', isoMedia(3), 'video/mp4');
const CLIP_5S = file('five.mp4', isoMedia(5), 'video/mp4');
const CLIP_7_5S = file('seven-and-a-half.mp4', isoMedia(7.5), 'video/mp4');
const CLIP_10S = file('ten.mp4', isoMedia(10), 'video/mp4');
const DRAWN = `data:image/png;base64,${png(320, 180).toString('base64')}`;

const KEY = 'luma-api-local-test-0001';
const PROMPT = 'A paper boat drifts down a rainy street.';
const PRICE_DATE = '2026-10-19';
const MiB = 1024 * 1024;

function base64(media: FileMedia): string {
	return readFileSync(media.fsPath).toString('base64');
}

function inline(media: FileMedia): { data: string; media_type: string } {
	return { data: base64(media), media_type: media.mimeType };
}

function commands(options: { readonly sleep?: (ms: number) => Promise<void>; readonly inspector?: () => MediaInspector } = {}): VideoProviderCommands {
	return new VideoProviderCommands([LUMA], { http: { sleep: options.sleep ?? (async () => undefined) }, ...(options.inspector ? { inspector: options.inspector } : {}) });
}

interface Inputs {
	readonly startFrame?: FileMedia | { readonly dataUrl: string };
	readonly endFrame?: FileMedia;
	readonly images?: readonly FileMedia[];
	readonly source?: FileMedia;
}

function generation(endpoint: string, mode: 'frames' | 'edit', params: Record<string, unknown>, inputs: Inputs = {}, prompt = PROMPT) {
	return {
		provider: 'luma',
		region: 'global',
		endpoint,
		credentials: { apiKey: KEY },
		model: 'ray-3.2',
		mode,
		params,
		prompt,
		inputs: {
			...(inputs.startFrame ? { startFrame: inputs.startFrame } : {}),
			...(inputs.endFrame ? { endFrame: inputs.endFrame } : {}),
			images: inputs.images ?? [],
			videos: [],
			audios: [],
			...(inputs.source ? { source: inputs.source } : {})
		}
	};
}

function taskRef(endpoint: string, remoteId: string) {
	return { provider: 'luma', region: 'global', endpoint, credentials: { apiKey: KEY }, model: 'ray-3.2', remoteId };
}

function counts(planned: { readonly startFrame?: boolean; readonly endFrame?: boolean; readonly images?: number; readonly source?: boolean } = {}) {
	return { startFrame: false, endFrame: false, images: 0, videos: 0, audios: 0, source: false, ...planned };
}

function sentBody(request: Received): Record<string, unknown> {
	return JSON.parse(request.body.toString('utf8'));
}

/** Luma's answer to a create: HTTP 201 with the generation queued. */
function created(id: string, type = 'video') {
	return { id, type, state: 'queued', model: 'ray-3.2', created_at: '2026-10-19T12:00:00Z', output: [], failure_reason: null, failure_code: null };
}

// --- a local Luma -------------------------------------------------------------------------------

type Handler = (request: Received, response: ServerResponse, socket: Socket) => boolean;

interface FakeLuma {
	readonly api: TestServer;
	readonly storage: TestServer;
	close(): Promise<void>;
}

/**
 * The Agents API on one server and its storage on another, so the two have
 * different origins. A file answers the states of `fileStates` in turn: the
 * first from `complete`, the next ones from `GET /files/{id}`, the last one
 * again and again.
 */
async function startLuma(options: { readonly fileStates?: readonly string[]; readonly api?: Handler; readonly storage?: Handler } = {}): Promise<FakeLuma> {
	const states = options.fileStates ?? ['ready'];
	let files = 0;
	let generations = 0;
	const asked = new Map<string, number>();
	const storage = await startServer((request, response, socket) => {
		if (options.storage?.(request, response, socket)) {
			return;
		}
		response.writeHead(200, { 'Content-Length': '0', ETag: '"etag-1"' });
		response.end();
	});
	const api = await startServer((request, response, socket) => {
		if (options.api?.(request, response, socket)) {
			return;
		}
		const path = new URL(request.path, 'http://local').pathname;
		if (request.method === 'POST' && path === '/files') {
			const id = `file-${++files}`;
			const body = sentBody(request);
			const record = { id, created_at: '2026-10-19T12:00:00Z', mime_type: body.mime_type, purpose: 'input', size_bytes: body.size_bytes, state: 'pending', expires_at: body.expires_at };
			sendJson(response, 201, {
				id,
				state: 'pending',
				upload: {
					url: `${storage.url}/bucket/${id}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123`,
					method: 'PUT',
					headers: { 'Content-Type': String(body.mime_type), 'x-amz-server-side-encryption': 'AES256' },
					expires_at: '2026-10-19T13:00:00Z'
				},
				file: record
			});
			return;
		}
		const fileMatch = /^\/files\/([^/]+)(\/complete)?$/.exec(path);
		if (fileMatch) {
			const id = decodeURIComponent(fileMatch[1]);
			const index = fileMatch[2] ? 0 : (asked.get(id) ?? 0) + 1;
			asked.set(id, index);
			const state = states[Math.min(index, states.length - 1)];
			sendJson(response, 200, { id, created_at: '2026-10-19T12:00:00Z', mime_type: 'video/mp4', purpose: 'input', size_bytes: 1, state, ...(state === 'failed' ? { failure_reason: 'The file was flagged by moderation.' } : {}) });
			return;
		}
		if (request.method === 'POST' && path === '/generations') {
			const body = sentBody(request);
			sendJson(response, 201, created(`gen-${++generations}`, String(body.type)));
			return;
		}
		sendJson(response, 404, { detail: 'Not Found' });
	});
	return { api, storage, close: async () => { await api.close(); await storage.close(); } };
}

/** What the local Luma received, as method, path, and the key it carried. */
function exchanges(server: TestServer): string[] {
	return server.received.map(request => `${request.method} ${request.path} ${request.headers.authorization ?? 'no key'}`);
}

// --- the catalog --------------------------------------------------------------------------------

test('the catalog declares Luma with one region, one API key, and Ray 3.2 with its two modes, limits, and settings', () => {
	const provider = buildCatalog([LUMA]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'luma',
		label: 'Luma',
		regions: [{ id: 'global', label: 'Luma Agents API', baseUrl: 'https://agents.lumalabs.ai/v1', currency: 'USD', console: 'https://platform.lumalabs.ai' }],
		credentials: [{ id: 'apiKey', label: 'API Key', placeholder: 'luma-api-…' }]
	});
	assert.equal(provider.models.length, 1);
	const model = provider.models[0];
	assert.deepEqual({ id: model.id, label: model.label, providerModels: model.providerModels, prompt: model.prompt, estimate: model.estimate, deprecated: model.deprecated }, {
		id: 'ray-3.2',
		label: 'Ray 3.2',
		providerModels: { global: 'ray-3.2' },
		prompt: { required: 'always', maxLength: 6000 },
		estimate: true,
		deprecated: undefined
	});
	const none = { min: 0, max: 0 };
	const imageLimits = { imageMaxSide: 8000, imageMaxBytes: 52_428_800 };
	assert.deepEqual(model.modes, [
		{
			id: 'frames',
			label: 'Frames',
			inputs: { startFrame: 'optional', endFrame: 'optional', images: none, videos: none, audios: none, source: 'none' },
			limits: imageLimits
		},
		{
			id: 'edit',
			label: 'Edit',
			inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 1 }, videos: none, audios: none, source: 'required' },
			limits: { ...imageLimits, videoSeconds: [0.1, 18], videoMaxBytes: 200 * MiB }
		}
	]);
	const settings = (parameter: CatalogParameter) => {
		const common = [parameter.name, parameter.label, parameter.modes ?? 'all', parameter.advanced === true ? 'More' : 'shown'];
		switch (parameter.kind) {
			case 'choice': return [...common, parameter.options.map(option => `${option.value}=${option.label}`), parameter.default, parameter.display ?? ''];
			case 'integer': return [...common, parameter.min, parameter.max, parameter.step, parameter.unit, parameter.default];
			default: return [...common, parameter.kind, parameter.default];
		}
	};
	assert.deepEqual(model.parameters.map(settings), [
		['resolution', 'Resolution', 'all', 'shown', ['360p=360p', '540p=540p', '720p=720p', '1080p=1080p'], '720p', ''],
		['ratio', 'Ratio', ['frames'], 'shown', ['adaptive=Adaptive', '9:16=9:16', '3:4=3:4', '1:1=1:1', '4:3=4:3', '16:9=16:9', '21:9=21:9'], 'adaptive', 'ratio'],
		['duration', 'Duration', ['frames'], 'shown', 5, 10, 5, 'seconds', 5],
		['loop', 'Loop', ['frames'], 'shown', 'boolean', false],
		['strength', 'Strength', ['edit'], 'shown', [
			'auto=Auto', 'adhere_1=Adhere 1', 'adhere_2=Adhere 2', 'adhere_3=Adhere 3', 'flex_1=Flex 1', 'flex_2=Flex 2', 'flex_3=Flex 3',
			'reimagine_1=Reimagine 1', 'reimagine_2=Reimagine 2', 'reimagine_3=Reimagine 3'
		], 'auto', ''],
		['hdr', 'HDR', 'all', 'More', 'boolean', false]
	]);
	assert.ok(model.parameters.every(parameter => !parameter.optional), 'every setting has a default');
	assert.deepEqual(model.parameters.filter(parameter => !parameter.tooltip).map(parameter => parameter.name), ['duration']);
	assert.ok(PROVIDER_MODULES.includes(LUMA), 'AI Video ships the Luma module');
	assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'luma'));
});

// --- creating a generation ----------------------------------------------------------------------

test('Frames is created once at /generations with the exact body: frames as keyframes, and as the start frame of a looping video', async () => {
	const luma = await startLuma();
	try {
		const cases: readonly { readonly params: Record<string, unknown>; readonly inputs?: Inputs; readonly body: () => Record<string, unknown> }[] = [
			{
				// Luma's defaults: 720p, 5 seconds, and the shape chosen by the model.
				params: {},
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, video: { resolution: '720p', duration: '5s' } })
			},
			{
				params: { resolution: '1080p', duration: 10, ratio: '21:9' },
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, aspect_ratio: '21:9', video: { resolution: '1080p', duration: '10s' } })
			},
			{
				// A start frame alone is one keyframe at the first frame, at 10 seconds too.
				params: { resolution: '540p', duration: 10 },
				inputs: { startFrame: START },
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, video: { resolution: '540p', duration: '10s', keyframes: [inline(START)], keyframe_indexes: [0] } })
			},
			{
				// Start and end frames at the first and the last frame of 5 seconds at 24 frames a second, in HDR.
				params: { resolution: '1080p', hdr: true },
				inputs: { startFrame: START, endFrame: END },
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, video: { resolution: '1080p', duration: '5s', hdr: true, keyframes: [inline(START), inline(END)], keyframe_indexes: [0, 120] } })
			},
			{
				params: { duration: 10, ratio: '16:9' },
				inputs: { startFrame: START, endFrame: WEBP_END },
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, aspect_ratio: '16:9', video: { resolution: '720p', duration: '10s', keyframes: [inline(START), inline(WEBP_END)], keyframe_indexes: [0, 240] } })
			},
			{
				// Keyframes do not take Loop: a looping video sends its start frame as start_frame.
				params: { loop: true },
				inputs: { startFrame: START },
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, video: { resolution: '720p', duration: '5s', loop: true, start_frame: inline(START) } })
			},
			{
				params: { loop: true, ratio: '1:1', resolution: '360p' },
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, aspect_ratio: '1:1', video: { resolution: '360p', duration: '5s', loop: true } })
			},
			{
				// An image the window drew to PNG arrives as a data URL.
				params: { ratio: '9:16' },
				inputs: { startFrame: { dataUrl: DRAWN } },
				body: () => ({ model: 'ray-3.2', type: 'video', prompt: PROMPT, aspect_ratio: '9:16', video: { resolution: '720p', duration: '5s', keyframes: [{ data: DRAWN.slice('data:image/png;base64,'.length), media_type: 'image/png' }], keyframe_indexes: [0] } })
			}
		];
		const providers = commands();
		const outcomes = [];
		for (const entry of cases) {
			const before = luma.api.received.length;
			const answer = await providers.submit(generation(luma.api.url, 'frames', entry.params, entry.inputs));
			outcomes.push({
				answer,
				sent: luma.api.received.slice(before).map(request => ({
					method: request.method,
					path: request.path,
					authorization: request.headers.authorization,
					type: request.headers['content-type'],
					body: sentBody(request)
				}))
			});
		}
		assert.deepEqual(outcomes, cases.map((entry, index) => ({
			answer: { ok: true, value: { remoteId: `gen-${index + 1}` } },
			sent: [{ method: 'POST', path: '/generations', authorization: `Bearer ${KEY}`, type: 'application/json', body: entry.body() }]
		})));
		assert.equal(luma.storage.received.length, 0, 'Frames uploads nothing');
	} finally {
		await luma.close();
	}
});

test('Edit uploads the clip without the key, waits until Luma has checked the file, then creates the edit once', async () => {
	const luma = await startLuma({ fileStates: ['pending', 'pending', 'ready'] });
	try {
		const sleep = recordingSleep();
		const providers = commands({ sleep: sleep.sleep });
		const before = Date.now();
		const answer = await providers.submit(generation(luma.api.url, 'edit', {}, { source: CLIP }, 'Make it moonlit 35mm film.'));
		const after = Date.now();
		const fileRequest = sentBody(luma.api.received[0]);
		const expires = Date.parse(String(fileRequest.expires_at));
		const put = luma.storage.received[0];
		assert.deepEqual({
			answer,
			api: exchanges(luma.api),
			file: { ...fileRequest, expires_at: 'checked below' },
			stored: exchanges(luma.storage),
			storedHeaders: [put.headers['content-type'], put.headers['x-amz-server-side-encryption'], put.headers['content-length']],
			storedBytes: put.body.equals(readFileSync(CLIP.fsPath)),
			jsonTypes: luma.api.received.map(request => request.headers['content-type'] ?? 'no body'),
			waits: sleep.waits,
			edit: sentBody(luma.api.received[4])
		}, {
			answer: { ok: true, value: { remoteId: 'gen-1' } },
			api: [
				`POST /files Bearer ${KEY}`,
				`POST /files/file-1/complete Bearer ${KEY}`,
				`GET /files/file-1 Bearer ${KEY}`,
				`GET /files/file-1 Bearer ${KEY}`,
				`POST /generations Bearer ${KEY}`
			],
			file: { mime_type: 'video/mp4', size_bytes: readFileSync(CLIP.fsPath).byteLength, purpose: 'input', expires_at: 'checked below' },
			stored: ['PUT /bucket/file-1?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123 no key'],
			storedHeaders: ['video/mp4', 'AES256', String(readFileSync(CLIP.fsPath).byteLength)],
			storedBytes: true,
			jsonTypes: ['application/json', 'no body', 'no body', 'no body', 'application/json'],
			// Asked about every 2 seconds while the file is pending.
			waits: [2000, 2000],
			edit: { model: 'ray-3.2', type: 'video_edit', prompt: 'Make it moonlit 35mm film.', source: { file_id: 'file-1' }, video: { resolution: '720p', edit: { auto_controls: true } } }
		});
		// Luma may delete the file a day after its upload.
		const day = 24 * 60 * 60 * 1000;
		assert.ok(expires >= before + day - 1000 && expires <= after + day + 1000, `expires_at ${String(fileRequest.expires_at)}`);
	} finally {
		await luma.close();
	}
});

test('Edit sends a MOV clip as video/quicktime, the image as the guide frame, a strength, and HDR', async () => {
	const luma = await startLuma({ fileStates: ['ready'] });
	try {
		const sleep = recordingSleep();
		const answer = await commands({ sleep: sleep.sleep }).submit(generation(luma.api.url, 'edit', { resolution: '1080p', strength: 'flex_2', hdr: true }, { source: MOV_CLIP, images: [GUIDE] }));
		assert.deepEqual({
			answer,
			api: exchanges(luma.api).map(line => line.split(' ').slice(0, 2).join(' ')),
			mimeType: sentBody(luma.api.received[0]).mime_type,
			storedType: luma.storage.received[0].headers['content-type'],
			waits: sleep.waits,
			edit: sentBody(luma.api.received[2])
		}, {
			answer: { ok: true, value: { remoteId: 'gen-1' } },
			// The file is ready when its upload completes: nothing is asked or waited for.
			api: ['POST /files', 'POST /files/file-1/complete', 'POST /generations'],
			mimeType: 'video/quicktime',
			storedType: 'video/quicktime',
			waits: [],
			edit: {
				model: 'ray-3.2',
				type: 'video_edit',
				prompt: PROMPT,
				source: { file_id: 'file-1' },
				video: { resolution: '1080p', edit: { strength: 'flex_2' }, start_frame: inline(GUIDE), hdr: true }
			}
		});
	} finally {
		await luma.close();
	}
});

test('an upload Luma refuses, removes, or does not finish checking creates no generation', async () => {
	const refusals = async (fileStates: readonly string[]) => {
		const luma = await startLuma({ fileStates });
		try {
			const sleep = recordingSleep();
			const failed = error(await commands({ sleep: sleep.sleep }).submit(generation(luma.api.url, 'edit', {}, { source: CLIP })));
			const paths = luma.api.received.map(request => `${request.method} ${request.path}`);
			return { code: failed.code, message: failed.message, waits: sleep.waits.length, gets: paths.filter(path => path === 'GET /files/file-1').length, created: paths.includes('POST /generations') };
		} finally {
			await luma.close();
		}
	};
	assert.deepEqual({
		failed: await refusals(['pending', 'failed']),
		deleted: await refusals(['deleted']),
		unknown: await refusals(['archived']),
		neverReady: await refusals(['pending'])
	}, {
		failed: { code: 'rejected', message: 'Luma refused the source video clip.mp4 when it checked it: The file was flagged by moderation.', waits: 1, gets: 1, created: false },
		deleted: { code: 'rejected', message: 'Luma removed the source video clip.mp4 before the generation could use it. Generate again.', waits: 0, gets: 0, created: false },
		unknown: { code: 'rejected', message: 'The source video clip.mp4 could not be uploaded to Luma: Luma answered the upload in a form AI Video cannot read.', waits: 0, gets: 0, created: false },
		// Asked 60 times, 2 seconds apart: 2 minutes.
		neverReady: { code: 'rejected', message: 'Luma has not finished checking the source video clip.mp4 after 2 minutes, and nothing was generated. Generate again in a moment.', waits: 60, gets: 60, created: false }
	});
});

test('a refusal of the storage, a storage address that is not https, a refused key, and a lost file during the upload create no generation', async () => {
	const storageRefusal = await startLuma({
		storage: (request, response) => {
			const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error>', 'utf8');
			response.writeHead(403, { 'Content-Type': 'application/xml', 'Content-Length': String(xml.byteLength) });
			response.end(xml);
			return true;
		}
	});
	const keyRefusal = await startLuma({ api: (request, response) => { sendJson(response, 401, { detail: 'Invalid API key' }); return true; } });
	const lostFile = await startLuma({
		fileStates: ['pending'],
		api: (request, response) => {
			if (request.method === 'GET' && request.path.startsWith('/files/')) {
				sendJson(response, 404, { detail: 'File not found' });
				return true;
			}
			return false;
		}
	});
	const plainStorage = await startLuma({
		api: (request, response) => {
			if (request.method === 'POST' && request.path === '/files') {
				sendJson(response, 201, { id: 'file-1', state: 'pending', upload: { url: 'http://storage.example.com/bucket/file-1', method: 'PUT', headers: {} } });
				return true;
			}
			return false;
		}
	});
	try {
		const outcome = async (luma: FakeLuma) => {
			const failed = error(await commands().submit(generation(luma.api.url, 'edit', {}, { source: CLIP })));
			return { failed, api: luma.api.received.map(request => `${request.method} ${request.path}`), stored: luma.storage.received.length };
		};
		assert.deepEqual({ storage: await outcome(storageRefusal), key: await outcome(keyRefusal), lost: await outcome(lostFile), plain: await outcome(plainStorage) }, {
			storage: {
				failed: { code: 'rejected', status: 403, message: 'Luma\'s storage refused the upload of the source video clip.mp4 (HTTP 403, SignatureDoesNotMatch): The request signature we calculated does not match the signature you provided.' },
				api: ['POST /files'],
				stored: 1
			},
			key: {
				failed: { code: 'auth', status: 401, message: 'Luma refused the API key. Check it in Video Providers. (Invalid API key)' },
				api: ['POST /files'],
				stored: 0
			},
			lost: {
				failed: { code: 'rejected', status: 404, message: 'The source video clip.mp4 could not be uploaded to Luma: File not found.' },
				api: ['POST /files', 'POST /files/file-1/complete', 'GET /files/file-1'],
				stored: 1
			},
			// An address the bytes may not go to: nothing was generated, so the outcome is known.
			plain: {
				failed: { code: 'rejected', message: 'The source video clip.mp4 could not be uploaded to Luma: The provider gave an address that does not start with https://.' },
				api: ['POST /files'],
				stored: 0
			}
		});
	} finally {
		await storageRefusal.close();
		await keyRefusal.close();
		await lostFile.close();
		await plainStorage.close();
	}
});

test('an endpoint with a path, such as a relay that mirrors the API, keeps its path for creating, uploading, and asking', async () => {
	const server = await startServer((request, response) => {
		if (request.method === 'POST' && request.path.endsWith('/generations')) {
			sendJson(response, 201, created('gen-1'));
			return;
		}
		sendJson(response, 200, { ...created('gen-1'), state: 'processing' });
	});
	try {
		const providers = commands();
		const endpoint = `${server.url}/relay/luma/v1/`;
		const submitted = value(await providers.submit(generation(endpoint, 'frames', {})));
		const polled = value(await providers.poll(taskRef(endpoint, 'gen-1')));
		assert.deepEqual({ submitted, polled, sent: exchanges(server) }, {
			submitted: { remoteId: 'gen-1' },
			polled: { state: 'running' },
			sent: [`POST /relay/luma/v1/generations Bearer ${KEY}`, `GET /relay/luma/v1/generations/gen-1 Bearer ${KEY}`]
		});
	} finally {
		await server.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome, and it was sent once', async () => {
	const server = await startServer((request, response, socket) => socket.destroy());
	try {
		const failed = error(await commands().submit(generation(server.url, 'frames', {}, { startFrame: START, endFrame: END })));
		assert.deepEqual({ code: failed.code, sent: server.received.length }, { code: 'unknownOutcome', sent: 1 });
	} finally {
		await server.close();
	}
});

// --- errors -------------------------------------------------------------------------------------

test('a refused key answers auth for a create and for a poll, and no message carries the key', async () => {
	const server = await startServer((request, response) => sendJson(response, 401, { detail: request.method === 'POST' ? 'API key has been revoked' : 'Invalid API key' }));
	try {
		const providers = commands();
		const submitted = error(await providers.submit(generation(server.url, 'frames', {})));
		const polled = error(await providers.poll(taskRef(server.url, 'gen-1')));
		assert.deepEqual({ submitted, polled, sent: server.received.length }, {
			submitted: { code: 'auth', status: 401, message: 'Luma refused the API key. Check it in Video Providers. (API key has been revoked)' },
			polled: { code: 'auth', status: 401, message: 'Luma refused the API key. Check it in Video Providers. (Invalid API key)' },
			sent: 2
		});
		assert.ok(!JSON.stringify([submitted, polled]).includes(KEY));
	} finally {
		await server.close();
	}
});

test('too many requests and too many generations at once answer rateLimited with the limit and the wait, each create sent once', async () => {
	let next = 0;
	const server = await startServer((request, response) => {
		if (next++ === 0) {
			sendJson(response, 429, { detail: 'Rate limit exceeded' }, { 'Retry-After': '12', 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '0' });
		} else {
			sendJson(response, 429, { detail: 'Too many concurrent jobs' }, { 'Retry-After': '60' });
		}
	});
	try {
		const providers = commands();
		const perMinute = error(await providers.submit(generation(server.url, 'frames', {})));
		const atOnce = error(await providers.submit(generation(server.url, 'frames', {})));
		assert.deepEqual({ perMinute, atOnce, sent: server.received.length }, {
			perMinute: { code: 'rateLimited', status: 429, message: 'Luma received more requests from this account in the last minute than its plan allows. Wait a moment. (Rate limit exceeded) The provider asks to wait 12 seconds.' },
			atOnce: { code: 'rateLimited', status: 429, message: 'Luma is already running as many generations at once as this account\'s plan allows. Wait for one to finish. (Too many concurrent jobs) The provider asks to wait 60 seconds.' },
			sent: 2
		});
	} finally {
		await server.close();
	}
});

test('other answers: refusals make no generation, a transient 503 made none either, other server errors and answers without an id leave the outcome unknown', async () => {
	const replies: readonly [number, unknown][] = [
		[400, { detail: 'Prompt must be between 1 and 6000 characters' }],
		[402, { detail: 'Insufficient balance. Please add funds to continue.' }],
		[403, { detail: 'API client is suspended' }],
		[413, { detail: 'video.start_frame: image exceeds 50 MB limit' }],
		[422, { detail: [{ loc: ['body', 'video', 'duration'], msg: 'Input should be \'5s\' or \'10s\'', type: 'enum' }] }],
		[503, { detail: 'The service is temporarily unavailable. Please try again.', error: { code: 'TRANSIENT.SERVICE.UNAVAILABLE', user_message: 'The service is temporarily unavailable. Please try again.', retry: true, reason: 'The service is temporarily unavailable. Please try again.' } }],
		[503, { detail: 'Media URL ingestion is unavailable (fetch proxy not configured)' }],
		[502, { detail: 'source: fetch proxy unavailable' }],
		[201, { state: 'queued', model: 'ray-3.2' }],
		[201, created('gen-10')]
	];
	let next = 0;
	const server = await startServer((request, response) => {
		const [status, body] = replies[next++];
		sendJson(response, status, body);
	});
	try {
		const providers = commands();
		const outcomes = [];
		for (let index = 0; index < replies.length; index++) {
			const answer = await providers.submit(generation(server.url, 'frames', {}));
			outcomes.push(answer.ok ? answer.value : [answer.error.code, answer.error.status, answer.error.message]);
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				['rejected', 400, 'Luma: Prompt must be between 1 and 6000 characters.'],
				['balance', 402, 'The Luma account has too little balance. Add funds in the Luma API Platform. (Insufficient balance. Please add funds to continue.)'],
				['auth', 403, 'Luma refused this account. Contact Luma support. (API client is suspended)'],
				['rejected', 413, 'Luma: video.start_frame: image exceeds 50 MB limit.'],
				['rejected', 422, 'Luma: body.video.duration: Input should be \'5s\' or \'10s\'.'],
				['rejected', 503, 'Luma is unavailable for a moment and made no generation, so nothing is charged. Generate again in a moment. (The service is temporarily unavailable. Please try again.)'],
				['unknownOutcome', 503, 'Luma: Media URL ingestion is unavailable (fetch proxy not configured).'],
				['unknownOutcome', 502, 'Luma: source: fetch proxy unavailable.'],
				['unknownOutcome', undefined, 'Luma accepted the request but gave no generation id AI Video can read.'],
				{ remoteId: 'gen-10' }
			],
			sent: replies.length
		});
	} finally {
		await server.close();
	}
});

// --- asking about a generation ------------------------------------------------------------------

test('asking about a generation maps queued, processing, completed, and failed, and reads no other answer', async () => {
	const generations: Readonly<Record<string, unknown>> = {
		'g-1': created('g-1'),
		'g-2': { ...created('g-2'), state: 'processing' },
		'g-3': { ...created('g-3'), state: 'completed', output: [{ type: 'video', url: 'https://storage.example.com/generations/g-3/output.mp4?X-Amz-Expires=3600' }] },
		'g-4': { ...created('g-4'), state: 'failed', failure_code: 'content_moderated', failure_reason: 'Generation output was flagged by our content moderation system.' },
		'g-5': { ...created('g-5'), state: 'failed', failure_code: 'something_new', failure_reason: 'A new kind of failure.' },
		'g-6': { ...created('g-6'), state: 'failed', failure_code: null, failure_reason: null },
		'g-7': { ...created('g-7'), state: 'paused' },
		'g-8': { ...created('g-8'), state: 'completed', output: [{ type: 'image', url: 'https://storage.example.com/thumb.png' }] }
	};
	const server = await startServer((request, response) => {
		const id = decodeURIComponent(request.path.split('/').at(-1) ?? '');
		if (generations[id]) {
			sendJson(response, 200, generations[id]);
		} else {
			sendJson(response, 404, { detail: 'Generation not found' });
		}
	});
	try {
		const providers = commands();
		const states = [];
		for (const id of ['g-1', 'g-2', 'g-3', 'g-4', 'g-5', 'g-6']) {
			states.push(value(await providers.poll(taskRef(server.url, id))));
		}
		const others = [];
		for (const id of ['g-7', 'g-8', 'g-9']) {
			const failed = error(await providers.poll(taskRef(server.url, id)));
			others.push([failed.code, failed.message]);
		}
		const first = server.received[0];
		assert.deepEqual({ states, others, asked: [first.method, first.path, first.headers.authorization] }, {
			states: [
				{ state: 'pending' },
				{ state: 'running' },
				{ state: 'succeeded', videoUrl: 'https://storage.example.com/generations/g-3/output.mp4?X-Amz-Expires=3600' },
				{ state: 'failed', message: 'Luma\'s content moderation refused the prompt, an input, or the video, and refunds the charge. Change the prompt or the inputs. (content_moderated: Generation output was flagged by our content moderation system.)' },
				{ state: 'failed', message: 'A new kind of failure. (something_new)' },
				{ state: 'failed', message: 'Luma reports that the generation failed.' }
			],
			others: [
				['invalidResponse', 'Luma reports a generation state AI Video does not know: paused.'],
				['invalidResponse', 'Luma reports that the generation completed but gives no address of its video.'],
				['notFound', 'Luma: Generation not found.']
			],
			asked: ['GET', '/generations/g-1', `Bearer ${KEY}`]
		});
	} finally {
		await server.close();
	}
});

test('every failure code says what happened and what to do', async () => {
	const codes = ['content_moderated', 'generation_failed', 'budget_exhausted', 'output_not_found', 'image_too_large', 'unsupported_format', 'corrupt_input', 'invalid_request', 'rate_limited'];
	const server = await startServer((request, response) => {
		const code = request.path.split('/').at(-1) ?? '';
		sendJson(response, 200, { ...created(code), state: 'failed', failure_code: code, failure_reason: 'Reason.' });
	});
	try {
		const providers = commands();
		const messages: Record<string, string> = {};
		for (const code of codes) {
			const polled = value(await providers.poll(taskRef(server.url, code)));
			messages[code] = polled.state === 'failed' ? polled.message : polled.state;
		}
		assert.deepEqual(messages, {
			content_moderated: 'Luma\'s content moderation refused the prompt, an input, or the video, and refunds the charge. Change the prompt or the inputs. (content_moderated: Reason.)',
			generation_failed: 'Luma\'s model failed to make the video, and Luma refunds the charge. Generating again usually works. (generation_failed: Reason.)',
			budget_exhausted: 'The Luma account ran out of funds during the generation; part of it may be charged. Add funds in the Luma API Platform. (budget_exhausted: Reason.)',
			output_not_found: 'Luma could not retrieve the video it made, and refunds the charge. Generating again usually works. (output_not_found: Reason.)',
			image_too_large: 'An input image is too large for Luma. Use a smaller image. (image_too_large: Reason.)',
			unsupported_format: 'An input is in a format Luma cannot process. (unsupported_format: Reason.)',
			corrupt_input: 'Luma could not decode an input. Use another file. (corrupt_input: Reason.)',
			invalid_request: 'Luma refused the request as invalid while it ran. (invalid_request: Reason.)',
			rate_limited: 'A service Luma relies on was too busy. Generate again in a moment. (rate_limited: Reason.)'
		});
	} finally {
		await server.close();
	}
});

test('the video downloads from the address the poll gave without the key, and without an address from the generation asked about again', async () => {
	const video = isoMedia(5);
	const storage = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
		response.end(video);
	});
	const api = await startServer((request, response) => sendJson(response, 200, {
		...created('gen-9'),
		state: 'completed',
		output: [{ type: 'video', url: `${storage.url}/generations/gen-9/output.mp4?X-Amz-Expires=3600&X-Amz-Signature=fresh` }]
	}));
	try {
		const providers = commands();
		const ref = taskRef(api.url, 'gen-9');
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: polled.state === 'succeeded' ? polled.videoUrl : undefined, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		assert.deepEqual({
			withAddress,
			withoutAddress,
			same: [readFileSync(first).equals(video), readFileSync(second).equals(video)],
			api: exchanges(api),
			storage: exchanges(storage)
		}, {
			withAddress: { size: video.byteLength },
			withoutAddress: { size: video.byteLength },
			same: [true, true],
			api: [`GET /generations/gen-9 Bearer ${KEY}`, `GET /generations/gen-9 Bearer ${KEY}`],
			storage: [
				'GET /generations/gen-9/output.mp4?X-Amz-Expires=3600&X-Amz-Signature=fresh no key',
				'GET /generations/gen-9/output.mp4?X-Amz-Expires=3600&X-Amz-Signature=fresh no key'
			]
		});
	} finally {
		await api.close();
		await storage.close();
	}
});

test('Luma has no cancellation: cancel answers false and sends nothing, so no record is ever deleted', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, {}));
	try {
		const answer = value(await commands().cancel(taskRef(server.url, 'gen-1')));
		assert.deepEqual({ answer, sent: server.received.length }, { answer: { cancelled: false }, sent: 0 });
	} finally {
		await server.close();
	}
});

// --- checks -------------------------------------------------------------------------------------

test('check reports the rules between settings and inputs that the declarations cannot express, and answers no other model id', async () => {
	const providers = commands();
	const checked = async (mode: 'frames' | 'edit', params: Record<string, unknown>, inputs: ReturnType<typeof counts>, text = PROMPT) =>
		value(await providers.check({ provider: 'luma', region: 'global', model: 'ray-3.2', mode, params, prompt: text, inputs }));
	const problems = async (mode: 'frames' | 'edit', params: Record<string, unknown>, inputs = counts(), text = PROMPT) => (await checked(mode, params, inputs, text)).problems;
	assert.deepEqual({
		hdrAt540p: await problems('frames', { hdr: true, resolution: '540p' }),
		hdrAt720p: await problems('frames', { hdr: true }),
		hdrTenSeconds: await problems('frames', { hdr: true, duration: 10, resolution: '1080p' }),
		hdrWithFrames: await problems('frames', { hdr: true }, counts({ startFrame: true, endFrame: true })),
		tenSecondsWithFrames: await problems('frames', { duration: 10 }, counts({ startFrame: true, endFrame: true })),
		loopTenSeconds: await problems('frames', { loop: true, duration: 10 }),
		loopHdr: await problems('frames', { loop: true, hdr: true }),
		loopEndFrame: await problems('frames', { loop: true }, counts({ startFrame: true, endFrame: true })),
		loopStartFrame: await problems('frames', { loop: true }, counts({ startFrame: true })),
		allLoopRules: await problems('frames', { loop: true, hdr: true, duration: 10, resolution: '360p' }, counts({ startFrame: true, endFrame: true })),
		editHdrAt360p: await problems('edit', { hdr: true, resolution: '360p' }, counts({ source: true })),
		editHdrAt1080p: await problems('edit', { hdr: true, resolution: '1080p', strength: 'reimagine_3' }, counts({ source: true, images: 1 })),
		editTwoImages: await problems('edit', {}, counts({ source: true, images: 2 })),
		editWithoutClip: await problems('edit', {}, counts()),
		editDuration: await problems('edit', { duration: 10 }, counts({ source: true })),
		noPrompt: await problems('frames', {}, counts({ startFrame: true }), '  '),
		longPrompt: await problems('frames', {}, counts(), 'a'.repeat(6001)),
		fullPrompt: await problems('frames', {}, counts(), 'a'.repeat(6000)),
		unknownRatio: await problems('frames', { ratio: '2:1' }),
		providerModel: (await checked('edit', {}, counts({ source: true }))).providerModel
	}, {
		hdrAt540p: ['Ray 3.2 makes HDR video at 720p or 1080p only.'],
		hdrAt720p: [],
		hdrTenSeconds: ['Ray 3.2 makes HDR video of 5 seconds only.'],
		hdrWithFrames: [],
		tenSecondsWithFrames: [],
		loopTenSeconds: ['Ray 3.2 makes a looping video of 5 seconds only.'],
		loopHdr: ['Ray 3.2 does not make a looping video in HDR.'],
		loopEndFrame: ['A looping video takes no end frame: remove the end frame, or turn Loop off.'],
		loopStartFrame: [],
		allLoopRules: [
			'Ray 3.2 makes HDR video at 720p or 1080p only.',
			'Ray 3.2 makes HDR video of 5 seconds only.',
			'Ray 3.2 makes a looping video of 5 seconds only.',
			'Ray 3.2 does not make a looping video in HDR.',
			'A looping video takes no end frame: remove the end frame, or turn Loop off.'
		],
		editHdrAt360p: ['Ray 3.2 makes HDR video at 720p or 1080p only.'],
		editHdrAt1080p: [],
		editTwoImages: ['Ray 3.2 in Edit mode takes at most 1 reference image; 2 are planned.'],
		editWithoutClip: ['Ray 3.2 in Edit mode needs a video to work on.'],
		editDuration: ['Duration does not apply in Edit mode.'],
		noPrompt: ['Write a prompt: Ray 3.2 needs one.'],
		longPrompt: ['The prompt is 6001 characters long; Ray 3.2 takes at most 6000.'],
		fullPrompt: [],
		unknownRatio: ['Ratio cannot be 2:1 for Ray 3.2; choose Adaptive, 9:16, 3:4, 1:1, 4:3, 16:9, 21:9.'],
		providerModel: undefined
	});
});

test('with files, check takes WebP, refuses GIF, a clip too long, and requests larger than AI Video sends, and submit then sends nothing', async () => {
	const luma = await startLuma();
	try {
		const providers = commands();
		const withFiles = async (mode: 'frames' | 'edit', inputs: Inputs, params: Record<string, unknown> = {}, checker = providers) =>
			value(await checker.check(generation(luma.api.url, mode, params, inputs))).problems;
		// Every image measured as 50 MiB, the most Luma takes, and every clip as 150 MiB of 8 seconds.
		const large = commands({
			inspector: () => ({
				inspect: async media => (media as { readonly mimeType?: string }).mimeType?.startsWith('video/')
					? { bytes: 150 * MiB, format: 'mp4', seconds: 8 }
					: { bytes: 50 * MiB, format: 'png', width: 1920, height: 1080 }
			})
		});
		const outcomes = {
			webp: await withFiles('frames', { startFrame: START, endFrame: WEBP_END }),
			gif: await withFiles('frames', { startFrame: GIF }),
			clip: await withFiles('edit', { source: CLIP, images: [GUIDE] }),
			mov: await withFiles('edit', { source: MOV_CLIP }),
			longClip: await withFiles('edit', { source: LONG_CLIP }),
			notAClip: await withFiles('edit', { source: { fsPath: START.fsPath, mimeType: 'video/mp4' } }),
			oneLargeFrame: await withFiles('frames', { startFrame: START }, {}, large),
			twoLargeFrames: await withFiles('frames', { startFrame: START, endFrame: END }, {}, large),
			largeClip: await withFiles('edit', { source: CLIP }, {}, large),
			submittedGif: error(await providers.submit(generation(luma.api.url, 'frames', {}, { startFrame: GIF }))),
			submittedLong: error(await providers.submit(generation(luma.api.url, 'edit', {}, { source: LONG_CLIP }))),
			submittedRule: error(await providers.submit(generation(luma.api.url, 'edit', { hdr: true, resolution: '540p' }, { source: CLIP })))
		};
		assert.deepEqual({ outcomes, api: luma.api.received.length, storage: luma.storage.received.length }, {
			outcomes: {
				webp: [],
				gif: ['The start frame moving.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.'],
				clip: [],
				mov: [],
				longClip: ['The source video long.mp4 is 20 seconds long; a video must be 0.1 to 18 seconds.'],
				notAClip: ['The source video start.png is not a video whose length AI Video can read (MP4 or MOV).'],
				oneLargeFrame: [],
				twoLargeFrames: ['The frames make a request of 133.3 MiB; AI Video sends at most 128 MiB. Use smaller images.'],
				largeClip: ['The source video clip.mp4 is 150 MiB; AI Video uploads at most 128 MiB in one request. Use a smaller clip.'],
				submittedGif: { code: 'rejected', message: 'The start frame moving.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.' },
				submittedLong: { code: 'rejected', message: 'The source video long.mp4 is 20 seconds long; a video must be 0.1 to 18 seconds.' },
				submittedRule: { code: 'rejected', message: 'Ray 3.2 makes HDR video at 720p or 1080p only.' }
			},
			api: 0,
			storage: 0
		});
	} finally {
		await luma.close();
	}
});

// --- estimates ----------------------------------------------------------------------------------

test('estimates follow the price list: three combinations of each mode, and the range of an edit', async () => {
	const providers = commands();
	const withCounts = async (mode: 'frames' | 'edit', params: Record<string, unknown>, inputs = counts()) =>
		value(await providers.check({ provider: 'luma', region: 'global', model: 'ray-3.2', mode, params, prompt: PROMPT, inputs })).estimate;
	const withClip = async (clip: FileMedia, params: Record<string, unknown>) =>
		value(await providers.check(generation('https://agents.lumalabs.ai/v1', 'edit', params, { source: clip }))).estimate;
	const usd = (min: number, max = min): Estimate => ({ currency: 'USD', min, max, priceDate: PRICE_DATE });
	assert.deepEqual({
		// Frames with Luma's defaults, 720p and 5 seconds: the 5-second total, $0.30.
		framesDefaults: await withCounts('frames', {}),
		// Two frames at 1080p for 10 seconds: the 10-second total, $3.60.
		frames1080p10s: await withCounts('frames', { resolution: '1080p', duration: 10 }, counts({ startFrame: true, endFrame: true })),
		// HDR at 1080p, always 5 seconds: $2.40.
		framesHdr: await withCounts('frames', { resolution: '1080p', hdr: true }),
		// 360p, 10 seconds, looping or not: $0.18.
		frames360p10s: await withCounts('frames', { resolution: '360p', duration: 10 }),
		// Edit at 720p of a 7.5-second clip: r = $2.16 / 10 s = $0.216/s; 7.5 s × $0.216 = $1.62,
		// up to two 5-second blocks, 10 s × $0.216 = $2.16.
		edit720p: await withClip(CLIP_7_5S, {}),
		// Edit in HDR at 1080p of a 10-second clip: r = $8.64 / 10 s = $0.864/s; 10 s × $0.864 = $8.64, a whole number of blocks.
		edit1080pHdr: await withClip(CLIP_10S, { resolution: '1080p', hdr: true, strength: 'adhere_1' }),
		// Edit at 360p of a 3-second clip: r = $1.08 / 10 s = $0.108/s; 3 s × $0.108 = $0.324, up to one block, 5 s × $0.108 = $0.54.
		edit360p: await withClip(CLIP_3S, { resolution: '360p' }),
		// Edit at 540p before the clip is measured: r = $1.44 / 10 s = $0.144/s; from 0.1 s × $0.144 = $0.0144
		// to 18 s, four 5-second blocks, 20 s × $0.144 = $2.88.
		edit540pUnmeasured: await withCounts('edit', { resolution: '540p' }, counts({ source: true })),
		// HDR at 540p and HDR for 10 seconds have no price; a rule refuses them.
		noPriceHdr540p: await withCounts('frames', { resolution: '540p', hdr: true }),
		noPriceHdr10s: await withCounts('frames', { resolution: '720p', hdr: true, duration: 10 })
	}, {
		framesDefaults: usd(0.3),
		frames1080p10s: usd(3.6),
		framesHdr: usd(2.4),
		frames360p10s: usd(0.18),
		edit720p: usd(1.62, 2.16),
		edit1080pHdr: usd(8.64),
		edit360p: usd(0.324, 0.54),
		edit540pUnmeasured: usd(0.0144, 2.88),
		noPriceHdr540p: undefined,
		noPriceHdr10s: undefined
	});
});

test('every price of the list: the generation totals by resolution and length, and the edit totals of 5- and 10-second clips', async () => {
	// guides/pricing as read on 2026-10-19.
	const generations: readonly [string, Record<string, unknown>, number][] = [
		['360p', { duration: 5 }, 0.06], ['360p', { duration: 10 }, 0.18],
		['540p', { duration: 5 }, 0.15], ['540p', { duration: 10 }, 0.45],
		['720p', { duration: 5 }, 0.3], ['720p', { duration: 10 }, 0.9], ['720p', { hdr: true }, 0.6],
		['1080p', { duration: 5 }, 1.2], ['1080p', { duration: 10 }, 3.6], ['1080p', { hdr: true }, 2.4]
	];
	const edits: readonly [string, boolean, number, number][] = [
		['360p', false, 0.54, 1.08], ['540p', false, 0.72, 1.44], ['720p', false, 1.08, 2.16], ['1080p', false, 2.16, 4.32],
		['360p', true, 1.08, 2.16], ['540p', true, 1.44, 2.88], ['720p', true, 2.16, 4.32], ['1080p', true, 4.32, 8.64]
	];
	const providers = commands();
	const usd = (amount: number): Estimate => ({ currency: 'USD', min: amount, max: amount, priceDate: PRICE_DATE });
	for (const [resolution, params, total] of generations) {
		const estimate = value(await providers.check({ provider: 'luma', region: 'global', model: 'ray-3.2', mode: 'frames', params: { resolution, ...params }, prompt: PROMPT, inputs: counts() })).estimate;
		assert.deepEqual(estimate, usd(total), `frames ${resolution} ${JSON.stringify(params)}`);
	}
	for (const [resolution, hdr, fiveSeconds, tenSeconds] of edits) {
		const estimate = async (clip: FileMedia) => value(await providers.check(generation('https://agents.lumalabs.ai/v1', 'edit', { resolution, hdr }, { source: clip }))).estimate;
		assert.deepEqual([await estimate(CLIP_5S), await estimate(CLIP_10S)], [usd(fiveSeconds), usd(tenSeconds)], `edit ${resolution} ${hdr ? 'HDR' : 'standard'}`);
	}
});
