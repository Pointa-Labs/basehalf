/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Runway module (docs/specs/video-providers/runway.md) through the
 * provider commands, against local servers that answer like Runway's API, its
 * upload storage, and the CDN of its videos. No test calls Runway or uses a
 * real key.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import { RUNWAY } from '../src/providers/runway.ts';
import type { CatalogModel, Estimate, PlannedMedia } from '../src/providers/types.ts';
import { error, gifHeader, isoMedia, jpegHeader, plannedFiles, png, recordingSleep, sendJson, startServer, value, type Received, type TestServer } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-runway-'));
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

/** An MP4 of only its file type and movie header: `seconds` long, and smaller than 512 bytes. */
function tinyMp4(seconds: number): Buffer {
	const box = (type: string, ...content: Buffer[]) => {
		const data = Buffer.concat(content);
		const head = Buffer.alloc(8);
		head.writeUInt32BE(data.length + 8, 0);
		head.write(type, 4, 'latin1');
		return Buffer.concat([head, data]);
	};
	const header = Buffer.alloc(100);
	header.writeUInt32BE(600, 12);
	header.writeUInt32BE(seconds * 600, 16);
	return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2mp41', 'latin1')), box('moov', box('mvhd', header))]);
}

/** A PNG of `bytes` bytes: a real header, then bytes that do not compress. */
function largePng(bytes: number): Buffer {
	const head = png(640, 360);
	return Buffer.concat([head, randomBytes(bytes - head.byteLength)]);
}

const START = file('start.png', png(640, 360), 'image/png');
const SQUARE = file('square.jpg', jpegHeader(800, 800), 'image/jpeg');
const WIDE = file('wide.png', png(2100, 1000), 'image/png');
const HUGE = file('huge.jpg', jpegHeader(8001, 4001), 'image/jpeg');
const GIF = file('moving.gif', gifHeader(640, 360), 'image/gif');
const CLIP = file('clip.mp4', isoMedia(7.5), 'video/mp4');
const TAKE = file('take.mov', isoMedia(4, { brand: 'qt  ' }), 'video/quicktime');
const LONG_CLIP = file('long.mp4', isoMedia(31), 'video/mp4');
const SHORT_CLIP = file('short.mp4', isoMedia(1.5), 'video/mp4');
/** An MP4 whose length AI Video cannot read. */
const UNREADABLE = file('unreadable.mp4', Buffer.from('not a movie'), 'video/mp4');
const TINY_CLIP = file('tiny.mp4', tinyMp4(4), 'video/mp4');
// Runway takes an image data URI of at most 5,242,880 characters: `data:image/png;base64,` (22) and the base64 of the bytes.
// 3,932,142 bytes are 1,310,714 groups of three, 5,242,856 base64 characters: 5,242,878 in all, inline.
const AT_LIMIT = file('at-limit.png', largePng(3_932_142), 'image/png');
// One byte more takes a group of four more characters: 5,242,882, so it is uploaded.
const OVER_LIMIT = file('over-limit.png', largePng(3_932_143), 'image/png');

const KEY = `key_${'0123456789abcdef'.repeat(8)}`;
const VERSION = '2024-11-06';
const PROMPT = 'A paper boat drifts down a rainy street.';
const PRICE_DATE = '2026-10-19';

function dataUri(media: FileMedia, type: string): string {
	return `data:${type};base64,${readFileSync(media.fsPath).toString('base64')}`;
}

function commands(options: { readonly sleep?: (ms: number) => Promise<void> } = {}): VideoProviderCommands {
	return new VideoProviderCommands([RUNWAY], { http: { sleep: options.sleep ?? (async () => undefined) } });
}

interface Inputs {
	readonly startFrame?: FileMedia;
	readonly endFrame?: FileMedia;
	readonly source?: FileMedia;
}

type Mode = 'frames' | 'edit';

function generation(endpoint: string, model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs = {}, prompt = PROMPT) {
	return {
		provider: 'runway',
		region: 'global',
		endpoint,
		credentials: { apiKey: KEY },
		model,
		mode,
		params,
		prompt,
		inputs: {
			...(inputs.startFrame ? { startFrame: inputs.startFrame } : {}),
			...(inputs.endFrame ? { endFrame: inputs.endFrame } : {}),
			images: [],
			videos: [],
			audios: [],
			...(inputs.source ? { source: inputs.source } : {})
		}
	};
}

function taskRef(endpoint: string, remoteId: string, model = 'gen4.5') {
	return { provider: 'runway', region: 'global', endpoint, credentials: { apiKey: KEY }, model, remoteId };
}

function sentBody(request: Received): unknown {
	return JSON.parse(request.body.toString('utf8'));
}

/** The parts of a multipart form, in order. */
function formParts(request: Received): { readonly name: string; readonly filename?: string; readonly type?: string; readonly value: Buffer }[] {
	const boundary = /boundary=(?<boundary>\S+)$/.exec(String(request.headers['content-type']))?.groups?.boundary;
	assert.ok(boundary, 'a multipart form');
	const delimiter = Buffer.from(`--${boundary}`);
	const parts = [];
	let start = request.body.indexOf(delimiter) + delimiter.length;
	for (let next = request.body.indexOf(delimiter, start); next >= 0; next = request.body.indexOf(delimiter, start)) {
		// Each part follows its delimiter's line break and ends before the line break of the next.
		const chunk = request.body.subarray(start + 2, next - 2);
		const split = chunk.indexOf('\r\n\r\n');
		const headers = chunk.subarray(0, split).toString('utf8');
		const filename = /filename="(?<name>[^"]*)"/.exec(headers)?.groups?.name;
		const type = /Content-Type: (?<type>\S+)/.exec(headers)?.groups?.type;
		parts.push({
			name: /name="(?<name>[^"]*)"/.exec(headers)?.groups?.name ?? '',
			...(filename !== undefined ? { filename } : {}),
			...(type !== undefined ? { type } : {}),
			value: chunk.subarray(split + 4)
		});
		start = next + delimiter.length;
	}
	return parts;
}

/** What a request to the API carried: its method, path, both headers, and its JSON. */
function apiCall(request: Received) {
	return {
		method: request.method,
		path: request.path,
		authorization: request.headers.authorization,
		version: request.headers['x-runway-version'],
		type: request.headers['content-type'],
		...(request.body.byteLength ? { body: sentBody(request) } : {})
	};
}

/** Runway's storage: every upload is accepted unless the test answers otherwise. */
async function startStorage(answer?: (count: number, response: ServerResponse) => boolean): Promise<TestServer> {
	let count = 0;
	return startServer((request, response) => {
		count++;
		if (answer?.(count, response)) {
			return;
		}
		response.writeHead(204);
		response.end();
	});
}

/** Runway's API: tasks are created, uploads get an address of `storage`, and other requests are answered by `other`. */
async function startApi(storage: TestServer, other?: (request: Received, response: ServerResponse) => boolean): Promise<TestServer> {
	let tasks = 0;
	let uploads = 0;
	return startServer((request, response) => {
		if (other?.(request, response)) {
			return;
		}
		if (request.method === 'POST' && /\/uploads$/.test(request.path)) {
			uploads++;
			const filename = (sentBody(request) as { filename: string }).filename;
			sendJson(response, 200, {
				uploadUrl: `${storage.url}/bucket/upload-${uploads}`,
				fields: { key: `ephemeral/${uploads}/${filename}`, policy: 'eyJjb25kaXRpb25zIjpbXX0=', 'x-amz-signature': `signature-${uploads}` },
				runwayUri: `runway://upload-${uploads}`
			});
			return;
		}
		if (request.method === 'POST') {
			tasks++;
			sendJson(response, 200, { id: `17f20503-6c24-4c16-946b-35dbbce2a${String(tasks).padStart(3, '0')}`, estimatedCost: { credits: 60 } });
			return;
		}
		sendJson(response, 404, { error: 'Not found' });
	});
}

function taskId(index: number): string {
	return `17f20503-6c24-4c16-946b-35dbbce2a${String(index).padStart(3, '0')}`;
}

// --- the catalog --------------------------------------------------------------------------------

test('the catalog declares Runway with one region, one API key, and its three own models with their modes, limits, and settings', () => {
	const provider = buildCatalog([RUNWAY]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'runway',
		label: 'Runway',
		regions: [{ id: 'global', label: 'Runway Dev', baseUrl: 'https://api.dev.runwayml.com', currency: 'USD', console: 'https://dev.runway.com/' }],
		credentials: [{ id: 'apiKey', label: 'API Key', placeholder: 'key_…' }]
	});
	const none = { min: 0, max: 0 };
	// 128 MiB, the most AI Video sends in one request, less 1 MiB for the upload's form fields.
	const fileMaxBytes = 127 * 1024 * 1024;
	assert.deepEqual(provider.models.map(model => ({
		id: model.id,
		label: model.label,
		sentAs: model.providerModels,
		prompt: model.prompt,
		modes: model.modes,
		estimate: model.estimate,
		deprecated: model.deprecated
	})), [
		{
			id: 'gen4.5', label: 'Gen-4.5', sentAs: { global: 'gen4.5' }, prompt: { required: 'always', maxLength: 1000 },
			modes: [{ id: 'frames', label: 'Frames', inputs: { startFrame: 'optional', endFrame: 'none', images: none, videos: none, audios: none, source: 'none' }, limits: { imageMaxSide: 8000, imageAspect: [0.5, 2], imageMaxBytes: fileMaxBytes } }],
			estimate: true, deprecated: undefined
		},
		{
			id: 'gen4_turbo', label: 'Gen-4 Turbo', sentAs: { global: 'gen4_turbo' }, prompt: { required: 'withoutMedia', maxLength: 1000 },
			modes: [{ id: 'frames', label: 'Frames', inputs: { startFrame: 'required', endFrame: 'none', images: none, videos: none, audios: none, source: 'none' }, limits: { imageMaxSide: 8000, imageAspect: [0.5, 2.358], imageMaxBytes: fileMaxBytes } }],
			estimate: true, deprecated: undefined
		},
		{
			id: 'aleph2', label: 'Aleph 2.0', sentAs: { global: 'aleph2' }, prompt: { required: 'withoutMedia', maxLength: 1000 },
			modes: [{ id: 'edit', label: 'Edit', inputs: { startFrame: 'none', endFrame: 'none', images: none, videos: none, audios: none, source: 'required' }, limits: { videoSeconds: [2, 30], videoMaxBytes: fileMaxBytes } }],
			estimate: true, deprecated: undefined
		}
	]);

	const settings = (model: CatalogModel) => model.parameters.map(parameter => {
		const flags = [parameter.optional ? 'optional' : '', parameter.advanced ? 'More' : ''].filter(Boolean).join(' ');
		switch (parameter.kind) {
			case 'choice': return [parameter.name, parameter.label, parameter.options.map(option => `${option.value}=${option.label}`), parameter.default, parameter.display ?? '', flags];
			case 'integer': return [parameter.name, parameter.label, parameter.min, parameter.max, parameter.step, parameter.unit ?? '', parameter.default, flags];
			default: return [parameter.name, parameter.label, parameter.kind, parameter.default, flags];
		}
	});
	const resolution = ['resolution', 'Resolution', ['720p=720p'], '720p', '', ''];
	const ratio = ['ratio', 'Ratio', ['16:9=16:9', '9:16=9:16', '4:3=4:3', '3:4=3:4', '1:1=1:1', '21:9=21:9'], '16:9', 'ratio', ''];
	const duration = ['duration', 'Duration', 2, 10, 1, 'seconds', 5, ''];
	const seed = ['seed', 'Seed', 0, 2147483647, 1, '', undefined, 'optional More'];
	const publicFigures = ['publicFigureThreshold', 'Public Figures', ['auto=Auto', 'low=Low'], 'auto', '', 'More'];
	assert.deepEqual(Object.fromEntries(provider.models.map(model => [model.id, settings(model)])), {
		'gen4.5': [resolution, ratio, duration, seed, publicFigures],
		'gen4_turbo': [resolution, ratio, duration, seed, publicFigures],
		'aleph2': [
			['targetAspectRatio', 'Ratio', ['adaptive=Adaptive', '16:9=16:9', '4:3=4:3', '3:2=3:2', '1:1=1:1', '2:3=2:3', '3:4=3:4', '9:16=9:16', '21:9=21:9'], 'adaptive', 'ratio', ''],
			seed,
			publicFigures
		]
	});
	assert.ok(provider.models.flatMap(model => model.parameters).every(parameter => !parameter.modes && (parameter.kind !== 'choice' || (parameter.name !== 'ratio' && parameter.name !== 'targetAspectRatio') || parameter.tooltip)));
	assert.ok(PROVIDER_MODULES.includes(RUNWAY), 'AI Video ships the Runway module');
	assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'runway'));
});

// --- creating a task ----------------------------------------------------------------------------

test('each model and mode is created once, at its path, with the exact body, the key, and the version header', async () => {
	const storage = await startStorage();
	const api = await startApi(storage);
	try {
		const auto = { publicFigureThreshold: 'auto' };
		const cases: readonly { model: string; mode: Mode; params: Record<string, unknown>; inputs?: Inputs; prompt?: string; path: string; body: () => unknown; uploads?: readonly string[] }[] = [
			{
				// From the prompt alone, with every default: 16:9 at 720p is 1280:720.
				model: 'gen4.5', mode: 'frames', params: {},
				path: '/v1/text_to_video',
				body: () => ({ model: 'gen4.5', promptText: PROMPT, ratio: '1280:720', duration: 5, contentModeration: auto })
			},
			{
				model: 'gen4.5', mode: 'frames', params: { ratio: '9:16', duration: 10, seed: 42, publicFigureThreshold: 'low' },
				path: '/v1/text_to_video',
				body: () => ({ model: 'gen4.5', promptText: PROMPT, ratio: '720:1280', duration: 10, seed: 42, contentModeration: { publicFigureThreshold: 'low' } })
			},
			{
				// A start frame: image to video, the frame inline as a data URI of its format.
				model: 'gen4.5', mode: 'frames', params: { ratio: '21:9', duration: 2 }, inputs: { startFrame: START },
				path: '/v1/image_to_video',
				body: () => ({ model: 'gen4.5', promptText: PROMPT, ratio: '1584:672', duration: 2, contentModeration: auto, promptImage: dataUri(START, 'image/png') })
			},
			{
				model: 'gen4.5', mode: 'frames', params: { ratio: '1:1' }, inputs: { startFrame: SQUARE },
				path: '/v1/image_to_video',
				body: () => ({ model: 'gen4.5', promptText: PROMPT, ratio: '960:960', duration: 5, contentModeration: auto, promptImage: dataUri(SQUARE, 'image/jpeg') })
			},
			{
				// A prompt of spaces is not sent: Gen-4 Turbo takes the start frame alone.
				model: 'gen4_turbo', mode: 'frames', params: { ratio: '4:3' }, inputs: { startFrame: SQUARE }, prompt: '   ',
				path: '/v1/image_to_video',
				body: () => ({ model: 'gen4_turbo', ratio: '1104:832', duration: 5, contentModeration: auto, promptImage: dataUri(SQUARE, 'image/jpeg') })
			},
			{
				model: 'gen4_turbo', mode: 'frames', params: { ratio: '3:4', duration: 7, seed: 0 }, inputs: { startFrame: START },
				path: '/v1/image_to_video',
				body: () => ({ model: 'gen4_turbo', promptText: PROMPT, ratio: '832:1104', duration: 7, seed: 0, contentModeration: auto, promptImage: dataUri(START, 'image/png') })
			},
			{
				// Adaptive keeps the clip's shape: no targetAspectRatio. The clip is uploaded first.
				model: 'aleph2', mode: 'edit', params: {}, inputs: { source: CLIP },
				path: '/v1/video_to_video',
				uploads: ['source-video.mp4'],
				body: () => ({ model: 'aleph2', videoUri: 'runway://upload-1', promptText: PROMPT, contentModeration: auto })
			},
			{
				model: 'aleph2', mode: 'edit', params: { targetAspectRatio: '9:16', seed: 7, publicFigureThreshold: 'low' }, inputs: { source: TAKE }, prompt: '',
				path: '/v1/video_to_video',
				uploads: ['source-video.mov'],
				body: () => ({ model: 'aleph2', videoUri: 'runway://upload-2', targetAspectRatio: '9:16', seed: 7, contentModeration: { publicFigureThreshold: 'low' } })
			}
		];
		const providers = commands();
		const outcomes = [];
		for (const entry of cases) {
			const before = api.received.length;
			const answer = await providers.submit(generation(api.url, entry.model, entry.mode, entry.params, entry.inputs, entry.prompt));
			const sent = api.received.slice(before).map(apiCall);
			outcomes.push({ model: entry.model, answer, sent });
		}
		const call = (path: string, body: unknown) => ({ method: 'POST', path, authorization: `Bearer ${KEY}`, version: VERSION, type: 'application/json', body });
		assert.deepEqual(outcomes, cases.map((entry, index) => ({
			model: entry.model,
			answer: { ok: true, value: { remoteId: taskId(index + 1) } },
			sent: [
				...(entry.uploads ?? []).map(filename => call('/v1/uploads', { filename, type: 'ephemeral' })),
				call(entry.path, entry.body())
			]
		})));

		// The storage got each clip once: the fields of its upload in order, then the file, without the key or the version.
		assert.deepEqual(storage.received.map(request => ({
			method: request.method,
			path: request.path,
			authorization: request.headers.authorization ?? null,
			version: request.headers['x-runway-version'] ?? null,
			parts: formParts(request).map(part => part.filename !== undefined ? [part.name, part.filename, part.type, part.value.equals(readFileSync(part.filename.endsWith('.mov') ? TAKE.fsPath : CLIP.fsPath))] : [part.name, part.value.toString('utf8')])
		})), [
			{
				method: 'POST', path: '/bucket/upload-1', authorization: null, version: null,
				parts: [['key', 'ephemeral/1/source-video.mp4'], ['policy', 'eyJjb25kaXRpb25zIjpbXX0='], ['x-amz-signature', 'signature-1'], ['file', 'source-video.mp4', 'video/mp4', true]]
			},
			{
				method: 'POST', path: '/bucket/upload-2', authorization: null, version: null,
				parts: [['key', 'ephemeral/2/source-video.mov'], ['policy', 'eyJjb25kaXRpb25zIjpbXX0='], ['x-amz-signature', 'signature-2'], ['file', 'source-video.mov', 'video/quicktime', true]]
			}
		]);
	} finally {
		await api.close();
		await storage.close();
	}
});

test('an endpoint with a path keeps it, and one that ends with /v1 does not get it twice', async () => {
	const storage = await startStorage();
	const api = await startApi(storage, (request, response) => {
		if (request.method === 'GET') {
			sendJson(response, 200, { id: 'task-1', status: 'RUNNING', createdAt: '2026-10-19T02:00:00.000Z', progress: 0.25, estimatedCost: { credits: 60 } });
			return true;
		}
		return false;
	});
	try {
		const providers = commands();
		const sent = [];
		for (const endpoint of [`${api.url}/relay/runway/`, `${api.url}/relay/v1`]) {
			const before = api.received.length;
			value(await providers.submit(generation(endpoint, 'aleph2', 'edit', {}, { source: CLIP })));
			const polled = value(await providers.poll(taskRef(endpoint, 'task-1')));
			sent.push({ polled, calls: api.received.slice(before).map(request => [request.method, request.path, request.headers['x-runway-version']]) });
		}
		assert.deepEqual(sent, [
			{
				polled: { state: 'running', fraction: 0.25 },
				calls: [['POST', '/relay/runway/v1/uploads', VERSION], ['POST', '/relay/runway/v1/video_to_video', VERSION], ['GET', '/relay/runway/v1/tasks/task-1', VERSION]]
			},
			{
				polled: { state: 'running', fraction: 0.25 },
				calls: [['POST', '/relay/v1/uploads', VERSION], ['POST', '/relay/v1/video_to_video', VERSION], ['GET', '/relay/v1/tasks/task-1', VERSION]]
			}
		]);
	} finally {
		await api.close();
		await storage.close();
	}
});

test('an image whose data URI is at most 5 MiB goes inline, and a larger one through the upload', async () => {
	const storage = await startStorage();
	const api = await startApi(storage);
	try {
		const providers = commands();
		value(await providers.submit(generation(api.url, 'gen4.5', 'frames', {}, { startFrame: AT_LIMIT })));
		value(await providers.submit(generation(api.url, 'gen4_turbo', 'frames', {}, { startFrame: OVER_LIMIT })));
		const [inline, uploadRequest, uploaded] = api.received;
		const stored = formParts(storage.received[0]).at(-1);
		assert.deepEqual({
			inline: [inline.path, (sentBody(inline) as { promptImage: string }).promptImage.length, (sentBody(inline) as { promptImage: string }).promptImage === dataUri(AT_LIMIT, 'image/png')],
			upload: [uploadRequest.path, sentBody(uploadRequest)],
			uploaded: [uploaded.path, (sentBody(uploaded) as { promptImage: string }).promptImage],
			stored: [stored?.name, stored?.filename, stored?.type, stored?.value.equals(readFileSync(OVER_LIMIT.fsPath))]
		}, {
			inline: ['/v1/image_to_video', 5_242_878, true],
			upload: ['/v1/uploads', { filename: 'start-frame.png', type: 'ephemeral' }],
			uploaded: ['/v1/image_to_video', 'runway://upload-1'],
			stored: ['file', 'start-frame.png', 'image/png', true]
		});
	} finally {
		await api.close();
		await storage.close();
	}
});

test('a failed upload starts over with a new upload address; a refusal of the storage or of the key creates no task', async () => {
	const sleep = recordingSleep();
	let storageAnswer: (count: number, response: ServerResponse) => boolean = () => false;
	const storage = await startStorage((count, response) => storageAnswer(count, response));
	let uploadsRefused = false;
	const api = await startApi(storage, (request, response) => {
		if (uploadsRefused && request.path.endsWith('/uploads')) {
			sendJson(response, 401, { error: 'Invalid API key' });
			return true;
		}
		return false;
	});
	try {
		const providers = commands({ sleep: sleep.sleep });
		// The connection drops, then the storage is busy, then the upload gets through.
		storageAnswer = (count, response) => {
			if (count === 1) {
				response.socket?.destroy();
				return true;
			}
			if (count === 2) {
				response.writeHead(503, { 'Content-Type': 'application/xml' });
				response.end('<Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>');
				return true;
			}
			return false;
		};
		const retried = value(await providers.submit(generation(api.url, 'aleph2', 'edit', {}, { source: CLIP })));
		const create = api.received.at(-1)!;
		const afterRetry = {
			retried,
			slots: api.received.filter(request => request.path === '/v1/uploads').length,
			stored: storage.received.map(request => request.path),
			waits: [...sleep.waits],
			videoUri: (sentBody(create) as { videoUri: string }).videoUri
		};

		const before = { api: api.received.length, storage: storage.received.length };
		storageAnswer = (_count, response) => {
			response.writeHead(403, { 'Content-Type': 'application/xml' });
			response.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>');
			return true;
		};
		const refused = error(await providers.submit(generation(api.url, 'aleph2', 'edit', {}, { source: CLIP })));
		uploadsRefused = true;
		const refusedKey = error(await providers.submit(generation(api.url, 'gen4.5', 'frames', {}, { startFrame: OVER_LIMIT })));
		assert.deepEqual({
			afterRetry,
			refused,
			refusedKey: [refusedKey.code, refusedKey.status, refusedKey.message.includes(KEY)],
			sentAfter: api.received.slice(before.api).map(request => request.path),
			storedAfter: storage.received.length - before.storage
		}, {
			afterRetry: {
				retried: { remoteId: taskId(1) },
				slots: 3,
				stored: ['/bucket/upload-1', '/bucket/upload-2', '/bucket/upload-3'],
				waits: [1000, 2000],
				videoUri: 'runway://upload-3'
			},
			refused: {
				code: 'rejected',
				status: 403,
				message: 'The source video clip.mp4 could not be uploaded to Runway: Runway\'s storage refused the file (HTTP 403, AccessDenied): Request has expired'
			},
			refusedKey: ['auth', 401, false],
			// One upload address for the refused storage, one refused for the key, and no task.
			sentAfter: ['/v1/uploads', '/v1/uploads'],
			storedAfter: 1
		});
	} finally {
		await api.close();
		await storage.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome, and it was sent once', async () => {
	const server = await startServer((request, response, socket) => socket.destroy());
	try {
		const failed = error(await commands().submit(generation(server.url, 'gen4.5', 'frames', {})));
		assert.deepEqual({ code: failed.code, sent: server.received.length }, { code: 'unknownOutcome', sent: 1 });
	} finally {
		await server.close();
	}
});

// --- errors -------------------------------------------------------------------------------------

test('a refused key answers auth for a create and for a poll, with what to do, and no message carries the key', async () => {
	const server = await startServer((request, response) => sendJson(response, 401, { error: 'Invalid API key' }));
	try {
		const providers = commands();
		const submitted = error(await providers.submit(generation(server.url, 'gen4.5', 'frames', {})));
		const polled = error(await providers.poll(taskRef(server.url, 'task-1')));
		const message = 'Runway refused the API key. Check it in Video Providers: Runway refuses a key that is not valid, was disabled, or belongs to a suspended account. (Invalid API key)';
		assert.deepEqual({ submitted, polled, sent: server.received.length }, {
			submitted: { code: 'auth', message, status: 401 },
			polled: { code: 'auth', message, status: 401 },
			sent: 2
		});
		assert.ok(!JSON.stringify([submitted, polled]).includes(KEY));
	} finally {
		await server.close();
	}
});

test('429 answers rateLimited with the limits of the tiers: a create is sent once, a poll is asked again', async () => {
	const server = await startServer((request, response) => sendJson(response, 429, { error: 'You have exceeded your daily generation limit.' }));
	try {
		const sleep = recordingSleep();
		const providers = commands({ sleep: sleep.sleep });
		const submitted = error(await providers.submit(generation(server.url, 'gen4.5', 'frames', {})));
		const created = server.received.length;
		const polled = error(await providers.poll(taskRef(server.url, 'task-1')));
		const message = 'You have exceeded your daily generation limit. A Runway project starts as many video generations in 24 hours as its usage tier allows (50 at tier 1, more after more credits are bought), and its uploads are limited too.';
		assert.deepEqual({ submitted, polled, created, asked: server.received.length - created, waits: sleep.waits }, {
			submitted: { code: 'rateLimited', message, status: 429 },
			polled: { code: 'rateLimited', message, status: 429 },
			created: 1,
			asked: 4,
			waits: [1000, 2000, 4000]
		});
	} finally {
		await server.close();
	}
});

test('other answers to a create: refusals make no task, server errors and answers without a task id leave the outcome unknown', async () => {
	const replies: readonly [number, unknown][] = [
		[400, { error: 'Validation of body failed', issues: [{ code: 'custom', path: ['promptImage'], message: 'Invalid asset aspect ratio. width / height ratio must be between 0.5 and 2. Got 2.5.' }], docUrl: 'https://docs.dev.runwayml.com/api' }],
		[400, { error: 'The model has reached its sunset date.', reason: 'DEPRECATED_MODEL' }],
		[404, { error: 'Not found' }],
		[405, {}],
		[500, { error: 'Internal error' }],
		[502, {}],
		[200, { estimatedCost: { credits: 60 } }],
		[200, { id: taskId(8), estimatedCost: { credits: 60 } }]
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
			const answer = await providers.submit(generation(server.url, 'gen4.5', 'frames', {}));
			outcomes.push(answer.ok ? answer.value : [answer.error.code, answer.error.status, answer.error.message]);
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				['rejected', 400, 'Validation of body failed (promptImage: Invalid asset aspect ratio. width / height ratio must be between 0.5 and 2. Got 2.5.)'],
				['rejected', 400, 'The model has reached its sunset date. (DEPRECATED_MODEL)'],
				['rejected', 404, 'Not found'],
				['rejected', 405, 'The provider answered with HTTP 405.'],
				['unknownOutcome', 500, 'Internal error'],
				['unknownOutcome', 502, 'The provider answered with HTTP 502.'],
				['unknownOutcome', undefined, 'Runway accepted the request but gave no task id AI Video can read.'],
				{ remoteId: taskId(8) }
			],
			sent: replies.length
		});
	} finally {
		await server.close();
	}
});

// --- asking about a task ------------------------------------------------------------------------

test('asking about a task maps every state Runway reports, with its progress and failures, and reads no other answer', async () => {
	const createdAt = '2026-10-19T02:00:00.000Z';
	const tasks: Readonly<Record<string, unknown>> = {
		'pending': { id: 'pending', status: 'PENDING', createdAt, estimatedCost: { credits: 25 } },
		'throttled': { id: 'throttled', status: 'THROTTLED', createdAt, estimatedCost: { credits: 25 } },
		'running': { id: 'running', status: 'RUNNING', createdAt, progress: 0.4, estimatedCost: { credits: 25 } },
		'succeeded': { id: 'succeeded', status: 'SUCCEEDED', createdAt, output: ['https://dnznrvs05pmza.cloudfront.net/output.mp4?_jwt=a', 'https://dnznrvs05pmza.cloudfront.net/other.mp4?_jwt=b'], cost: { credits: 25 } },
		'moderated': { id: 'moderated', status: 'FAILED', createdAt, failure: 'The provided image was flagged by content moderation.', failureCode: 'SAFETY.INPUT.IMAGE', cost: { credits: 25 } },
		'bad-output': { id: 'bad-output', status: 'FAILED', createdAt, failure: 'The output was rejected.', failureCode: 'INTERNAL.BAD_OUTPUT.CODE01', cost: { credits: 0 } },
		'internal': { id: 'internal', status: 'FAILED', createdAt, failure: 'An unexpected error occurred.', cost: { credits: 0 } },
		'third-party': { id: 'third-party', status: 'FAILED', createdAt, failure: 'The provider is unavailable.', failureCode: 'THIRD_PARTY.UNAVAILABLE', cost: { credits: 0 } },
		'cancelled': { id: 'cancelled', status: 'CANCELLED', createdAt, cost: { credits: 0 } },
		'paused': { id: 'paused', status: 'PAUSED', createdAt },
		'no-status': { id: 'no-status', createdAt }
	};
	const server = await startServer((request, response) => {
		const id = request.path.split('/').at(-1) ?? '';
		if (tasks[id]) {
			sendJson(response, 200, tasks[id]);
		} else {
			sendJson(response, 404, { error: 'Task not found' });
		}
	});
	try {
		const providers = commands();
		const states: Record<string, unknown> = {};
		for (const id of ['pending', 'throttled', 'running', 'succeeded', 'moderated', 'bad-output', 'internal', 'third-party', 'cancelled']) {
			states[id] = value(await providers.poll(taskRef(server.url, id)));
		}
		const others: Record<string, unknown> = {};
		for (const id of ['paused', 'no-status', 'gone']) {
			const failed = error(await providers.poll(taskRef(server.url, id)));
			others[id] = [failed.code, failed.message];
		}
		const first = server.received[0];
		assert.deepEqual({
			states,
			others,
			asked: { method: first.method, path: first.path, authorization: first.headers.authorization, version: first.headers['x-runway-version'] }
		}, {
			states: {
				'pending': { state: 'pending' },
				'throttled': { state: 'pending' },
				'running': { state: 'running', fraction: 0.4 },
				'succeeded': { state: 'succeeded', videoUrl: 'https://dnznrvs05pmza.cloudfront.net/output.mp4?_jwt=a' },
				'moderated': { state: 'failed', message: 'Runway\'s moderation refused an input, and Runway does not refund such a task. The provided image was flagged by content moderation. (SAFETY.INPUT.IMAGE)' },
				'bad-output': { state: 'failed', message: 'Runway rejected the result. Logos, watermarks, or text in the inputs, or a prompt that asks for text, are common causes; generating again may succeed. The output was rejected. (INTERNAL.BAD_OUTPUT.CODE01)' },
				'internal': { state: 'failed', message: 'Runway had an internal problem; generating again in a moment may succeed. An unexpected error occurred.' },
				'third-party': { state: 'failed', message: 'The provider is unavailable. (THIRD_PARTY.UNAVAILABLE)' },
				'cancelled': { state: 'cancelled', message: 'Runway reports that the task was cancelled.' }
			},
			others: {
				'paused': ['invalidResponse', 'Runway reports a task state AI Video does not know: PAUSED.'],
				'no-status': ['invalidResponse', 'Runway reports a task state AI Video does not know: undefined.'],
				'gone': ['notFound', 'Task not found']
			},
			asked: { method: 'GET', path: '/v1/tasks/pending', authorization: `Bearer ${KEY}`, version: VERSION }
		});
	} finally {
		await server.close();
	}
});

test('the video downloads from the address of the poll, and without one from a fresh address of a new question, sending the CDN neither key nor version', async () => {
	const video = isoMedia(5);
	const cdn = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
		response.end(video);
	});
	let asked = 0;
	const api = await startServer((request, response) => {
		asked++;
		// Each question gives a fresh signed address.
		sendJson(response, 200, { id: 'task-9', status: 'SUCCEEDED', createdAt: '2026-10-19T02:00:00.000Z', output: [`${cdn.url}/output/task-9.mp4?_jwt=${asked}`], cost: { credits: 60 } });
	});
	try {
		const providers = commands();
		const ref = taskRef(api.url, 'task-9');
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: polled.state === 'succeeded' ? polled.videoUrl : undefined, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		assert.deepEqual({
			withAddress,
			withoutAddress,
			same: [readFileSync(first).equals(video), readFileSync(second).equals(video)],
			api: api.received.map(request => request.path),
			cdn: cdn.received.map(request => [request.path, request.headers.authorization ?? null, request.headers['x-runway-version'] ?? null])
		}, {
			withAddress: { size: video.byteLength },
			withoutAddress: { size: video.byteLength },
			same: [true, true],
			api: ['/v1/tasks/task-9', '/v1/tasks/task-9'],
			cdn: [['/output/task-9.mp4?_jwt=1', null, null], ['/output/task-9.mp4?_jwt=2', null, null]]
		});
	} finally {
		await api.close();
		await cdn.close();
	}
});

test('cancel sends DELETE once, and only to a task that has not ended, so a video is never deleted', async () => {
	const statuses: Readonly<Record<string, string>> = { 'running': 'RUNNING', 'pending': 'PENDING', 'throttled': 'THROTTLED', 'done': 'SUCCEEDED', 'failed': 'FAILED', 'raced': 'RUNNING', 'busy': 'RUNNING' };
	const server = await startServer((request, response) => {
		const id = request.path.split('/').at(-1) ?? '';
		if (request.method === 'DELETE') {
			if (id === 'raced') {
				// Cancelled or deleted in the meantime.
				sendJson(response, 404, { error: 'Task not found' });
			} else if (id === 'busy') {
				sendJson(response, 503, {});
			} else {
				response.writeHead(204);
				response.end();
			}
			return;
		}
		if (statuses[id]) {
			sendJson(response, 200, { id, status: statuses[id], createdAt: '2026-10-19T02:00:00.000Z' });
		} else {
			sendJson(response, 404, { error: 'Task not found' });
		}
	});
	try {
		const providers = commands();
		const answers: Record<string, unknown> = {};
		for (const id of ['running', 'pending', 'throttled', 'done', 'failed', 'gone', 'raced']) {
			answers[id] = value(await providers.cancel(taskRef(server.url, id))).cancelled;
		}
		answers.busy = error(await providers.cancel(taskRef(server.url, 'busy'))).code;
		const deletes = server.received.filter(request => request.method === 'DELETE');
		assert.deepEqual({
			answers,
			deleted: deletes.map(request => request.path),
			headers: [deletes[0].headers.authorization, deletes[0].headers['x-runway-version']]
		}, {
			answers: { running: true, pending: true, throttled: true, done: false, failed: false, gone: false, raced: false, busy: 'network' },
			deleted: ['/v1/tasks/running', '/v1/tasks/pending', '/v1/tasks/throttled', '/v1/tasks/raced', '/v1/tasks/busy'],
			headers: [`Bearer ${KEY}`, VERSION]
		});
	} finally {
		await server.close();
	}
});

// --- checks -------------------------------------------------------------------------------------

test('check reports the rules the declarations cannot express, and the declarations\' own', async () => {
	const providers = commands();
	const problems = async (model: string, mode: Mode, params: Record<string, unknown>, inputs: PlannedMedia, text = PROMPT) =>
		value(await providers.check({ provider: 'runway', region: 'global', model, mode, params, prompt: text, inputs })).problems;
	const emoji = '🎬'.repeat(600);
	assert.deepEqual({
		textToVideo4by3: await problems('gen4.5', 'frames', { ratio: '4:3' }, plannedFiles()),
		textToVideo21by9: await problems('gen4.5', 'frames', { ratio: '21:9' }, plannedFiles()),
		textToVideo9by16: await problems('gen4.5', 'frames', { ratio: '9:16' }, plannedFiles()),
		imageToVideo4by3: await problems('gen4.5', 'frames', { ratio: '4:3' }, plannedFiles({ startFrame: true })),
		turbo21by9: await problems('gen4_turbo', 'frames', { ratio: '21:9' }, plannedFiles({ startFrame: true })),
		emojiPrompt: await problems('gen4.5', 'frames', {}, plannedFiles(), emoji),
		longPrompt: await problems('gen4_turbo', 'frames', {}, plannedFiles({ startFrame: true }), 'a'.repeat(1001)),
		noPrompt: await problems('gen4.5', 'frames', {}, plannedFiles({ startFrame: true }), '  '),
		turboWithoutFrame: await problems('gen4_turbo', 'frames', {}, plannedFiles()),
		endFrame: await problems('gen4.5', 'frames', {}, plannedFiles({ startFrame: true, endFrame: true })),
		alephWithoutClip: await problems('aleph2', 'edit', {}, plannedFiles()),
		alephWithoutPrompt: await problems('aleph2', 'edit', {}, plannedFiles({ source: true }), ''),
		duration11: await problems('gen4.5', 'frames', { duration: 11 }, plannedFiles()),
		resolution1080p: await problems('gen4_turbo', 'frames', { resolution: '1080p' }, plannedFiles({ startFrame: true })),
		alephDuration: await problems('aleph2', 'edit', { duration: 5 }, plannedFiles({ source: true })),
		alephRatio: await problems('aleph2', 'edit', { targetAspectRatio: '3:2' }, plannedFiles({ source: true })),
		largeSeed: await problems('aleph2', 'edit', { seed: 2147483648 }, plannedFiles({ source: true }))
	}, {
		textToVideo4by3: ['Without a start frame, Gen-4.5 makes 16:9 or 9:16 videos only. Choose one of them, or connect a start frame.'],
		textToVideo21by9: ['Without a start frame, Gen-4.5 makes 16:9 or 9:16 videos only. Choose one of them, or connect a start frame.'],
		textToVideo9by16: [],
		imageToVideo4by3: [],
		turbo21by9: [],
		emojiPrompt: ['The prompt is 1200 characters long as Runway counts them, where most emoji count as two; Gen-4.5 takes at most 1000.'],
		longPrompt: ['The prompt is 1001 characters long; Gen-4 Turbo takes at most 1000.'],
		noPrompt: ['Write a prompt: Gen-4.5 needs one.'],
		turboWithoutFrame: ['Gen-4 Turbo in Frames mode needs a start frame.'],
		endFrame: ['Gen-4.5 in Frames mode takes no end frame.'],
		alephWithoutClip: ['Aleph 2.0 in Edit mode needs a video to work on.'],
		alephWithoutPrompt: [],
		duration11: ['Duration must be between 2 and 10 seconds.'],
		resolution1080p: ['Resolution cannot be 1080p for Gen-4 Turbo; choose 720p.'],
		alephDuration: ['Aleph 2.0 has no setting named "duration".'],
		alephRatio: [],
		largeSeed: ['Seed must be between 0 and 2147483647.']
	});
	// Each model has one id at every endpoint, so check answers none: Gen-4.5 is gen4.5 with a start frame and without.
	const answered = async (inputs: PlannedMedia) =>
		Object.hasOwn(value(await providers.check({ provider: 'runway', region: 'global', model: 'gen4.5', mode: 'frames', params: {}, prompt: PROMPT, inputs })), 'providerModel');
	assert.deepEqual([await answered(plannedFiles()), await answered(plannedFiles({ startFrame: true }))], [false, false]);
});

test('check measures images and clips against Runway\'s limits, and submit sends nothing then', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { id: taskId(1) }));
	try {
		const providers = commands();
		const withFiles = async (model: string, mode: Mode, inputs: Inputs, params: Record<string, unknown> = {}) =>
			value(await providers.check(generation(server.url, model, mode, params, inputs))).problems;
		const outcomes = {
			wideForGen45: await withFiles('gen4.5', 'frames', { startFrame: WIDE }),
			wideForTurbo: await withFiles('gen4_turbo', 'frames', { startFrame: WIDE }),
			huge: await withFiles('gen4_turbo', 'frames', { startFrame: HUGE }),
			gif: await withFiles('gen4.5', 'frames', { startFrame: GIF }),
			clip: await withFiles('aleph2', 'edit', { source: CLIP }),
			longClip: await withFiles('aleph2', 'edit', { source: LONG_CLIP }),
			tinyClip: await withFiles('aleph2', 'edit', { source: TINY_CLIP }),
			submittedWide: error(await providers.submit(generation(server.url, 'gen4.5', 'frames', {}, { startFrame: WIDE }))),
			submittedRule: error(await providers.submit(generation(server.url, 'gen4.5', 'frames', { ratio: '1:1' }))),
			submittedTiny: error(await providers.submit(generation(server.url, 'aleph2', 'edit', {}, { source: TINY_CLIP })))
		};
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: {
				wideForGen45: ['The start frame wide.png has an aspect ratio (width to height) of 2.10; it must be between 0.5 and 2.'],
				wideForTurbo: [],
				huge: ['The start frame huge.jpg is 8001 × 4001 px; each side must be at most 8000 px.'],
				gif: ['The start frame moving.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.'],
				clip: [],
				longClip: ['The source video long.mp4 is 31 seconds long; a video must be 2 to 30 seconds.'],
				tinyClip: [`The source video tiny.mp4 is ${readFileSync(TINY_CLIP.fsPath).byteLength} bytes; Runway's upload takes files of at least 512 bytes.`],
				submittedWide: { code: 'rejected', message: 'The start frame wide.png has an aspect ratio (width to height) of 2.10; it must be between 0.5 and 2.' },
				submittedRule: { code: 'rejected', message: 'Without a start frame, Gen-4.5 makes 16:9 or 9:16 videos only. Choose one of them, or connect a start frame.' },
				submittedTiny: { code: 'rejected', message: `The source video tiny.mp4 is ${readFileSync(TINY_CLIP.fsPath).byteLength} bytes; Runway's upload takes files of at least 512 bytes.` }
			},
			sent: 0
		});
	} finally {
		await server.close();
	}
});

// --- estimates ----------------------------------------------------------------------------------

test('estimates follow the price list: credits a second at $0.01 a credit', async () => {
	const providers = commands();
	const estimate = async (model: string, mode: Mode, params: Record<string, unknown>, inputs: PlannedMedia) =>
		value(await providers.check({ provider: 'runway', region: 'global', model, mode, params, prompt: PROMPT, inputs })).estimate;
	const measured = async (source: FileMedia) =>
		value(await providers.check(generation('http://127.0.0.1:1', 'aleph2', 'edit', {}, { source }))).estimate;
	const amount = (min: number, max = min): Estimate => ({ currency: 'USD', min, max, priceDate: PRICE_DATE });
	assert.deepEqual({
		// Gen-4.5 with its defaults, 5 seconds: 12 credits/s × 5 s = 60 credits × $0.01 = $0.60.
		gen45Defaults: await estimate('gen4.5', 'frames', {}, plannedFiles()),
		// Gen-4.5 from a start frame, 2 seconds: 12 × 2 = 24 credits = $0.24.
		gen45Short: await estimate('gen4.5', 'frames', { duration: 2 }, plannedFiles({ startFrame: true })),
		// Gen-4 Turbo, 10 seconds: 5 credits/s × 10 s = 50 credits = $0.50.
		turbo: await estimate('gen4_turbo', 'frames', { duration: 10 }, plannedFiles({ startFrame: true })),
		// Aleph 2.0 with the 7.5-second clip measured: 28 credits/s × 7.5 s = 210 credits = $2.10.
		alephMeasured: await measured(CLIP),
		// Aleph 2.0 with a clip whose length cannot be read, 2 to 30 seconds: 28 × 2 = 56 to 28 × 30 = 840 credits, $0.56 to $8.40.
		alephUnreadable: await measured(UNREADABLE),
		// A clip of 1.5 seconds, which check refuses: 28 × 1.5 = 42 credits, below the minimum of 56: $0.56.
		alephMinimum: await measured(SHORT_CLIP)
	}, {
		gen45Defaults: amount(0.6),
		gen45Short: amount(0.24),
		turbo: amount(0.5),
		alephMeasured: amount(2.1),
		alephUnreadable: amount(0.56, 8.4),
		alephMinimum: amount(0.56)
	});
});
