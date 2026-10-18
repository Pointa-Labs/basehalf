/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Black Forest Labs module (docs/specs/video-providers/bfl.md) through the
 * provider commands, against local servers that answer like BFL's API and its
 * delivery host. No test calls Black Forest Labs or uses a real key.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BFL } from '../src/providers/bfl.ts';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../src/providers/commands.ts';
import { BoundHttp, parseEndpoint, resolveHttpOptions, type HttpAnswer, type HttpCall, type ProviderHttp } from '../src/providers/http.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { Estimate } from '../src/providers/types.ts';
import { error, gifHeader, isoMedia, jpegHeader, png, recordingSleep, sendJson, startServer, value, webpHeader, type Received, type TestServer } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-bfl-'));
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
const WEBP = file('frame.webp', webpHeader('VP8X', 640, 360), 'image/webp');
const GIF = file('moving.gif', gifHeader(640, 360), 'image/gif');
const CLIP = file('clip.mp4', isoMedia(7.5), 'video/mp4');
const TEN_SECONDS = file('ten.mp4', isoMedia(10), 'video/mp4');
const LONG_CLIP = file('long.mp4', isoMedia(16), 'video/mp4');
const SHORT_CLIP = file('short.mp4', isoMedia(0.5), 'video/mp4');
const MOV = file('clip.mov', isoMedia(4, { brand: 'qt  ' }), 'video/quicktime');

const KEY = 'bfl_localTestKey0001';
const PROMPT = 'A paper boat drifts down a rainy street; rain patters on the water.';
const PRICE_DATE = '2026-10-15';
const MiB = 1024 * 1024;

function dataUrl(media: FileMedia, type: string): string {
	return `data:${type};base64,${readFileSync(media.fsPath).toString('base64')}`;
}

function commands(options: VideoProviderCommandOptions = {}): VideoProviderCommands {
	return new VideoProviderCommands([BFL], { ...options, http: { sleep: async () => undefined, ...options.http } });
}

type Mode = 'frames' | 'edit' | 'extend';

interface Inputs {
	readonly startFrame?: FileMedia;
	readonly endFrame?: FileMedia;
	readonly images?: readonly FileMedia[];
	readonly source?: FileMedia;
}

function planned(inputs: Inputs) {
	return {
		...(inputs.startFrame ? { startFrame: inputs.startFrame } : {}),
		...(inputs.endFrame ? { endFrame: inputs.endFrame } : {}),
		images: inputs.images ?? [],
		videos: [],
		audios: [],
		...(inputs.source ? { source: inputs.source } : {})
	};
}

function generation(endpoint: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs = {}, prompt = PROMPT) {
	return { provider: 'bfl', region: 'global', endpoint, credentials: { apiKey: KEY }, model: 'flux-3', mode, params, prompt, inputs: planned(inputs) };
}

function taskRef(endpoint: string, remoteId: string) {
	return { provider: 'bfl', region: 'global', endpoint, credentials: { apiKey: KEY }, model: 'flux-3', remoteId };
}

/** The planned inputs counted, for a check without files. */
function counts(change: Partial<{ startFrame: boolean; endFrame: boolean; images: number; source: boolean }> = {}) {
	return { startFrame: false, endFrame: false, images: 0, videos: 0, audios: 0, source: false, ...change };
}

/** A check of counts made by `counts`, or of files made by `planned`. */
function checkRequest(mode: Mode, params: Record<string, unknown>, inputs: ReturnType<typeof counts> | ReturnType<typeof planned>, prompt = PROMPT) {
	return { provider: 'bfl', region: 'global', model: 'flux-3', mode, params, prompt, inputs };
}

/** BFL's answer to a create, its polling address on the server under `base`. */
function created(server: TestServer, id: string, base = '') {
	return { id, polling_url: `${server.url}${base}/get_result?id=${id}`, cost: 75, input_mp: null, output_mp: null };
}

function sentBody(request: Received): unknown {
	return JSON.parse(request.body.toString('utf8'));
}

/** An answer as the framework's HTTP gives it, for a module called without a server. */
function jsonAnswer(body: Record<string, unknown>): HttpAnswer {
	return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(body), 'utf8'), json: () => body, object: () => body };
}

// --- the catalog --------------------------------------------------------------------------------

test('the catalog declares Black Forest Labs with one region and one key, and FLUX 3 with its modes, limits, and settings', () => {
	const provider = buildCatalog([BFL]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'bfl',
		label: 'Black Forest Labs',
		regions: [{ id: 'global', label: 'Global', baseUrl: 'https://api.bfl.ai/v1', currency: 'USD', console: 'https://dashboard.bfl.ai' }],
		credentials: [{ id: 'apiKey', label: 'API Key', placeholder: 'bfl_…' }]
	});
	assert.deepEqual(provider.models.map(model => model.id), ['flux-3']);
	const model = provider.models[0];
	assert.deepEqual({ label: model.label, providerModels: model.providerModels, prompt: model.prompt, estimate: model.estimate, deprecated: model.deprecated }, {
		label: 'FLUX 3',
		providerModels: { global: 'flux-3-video' },
		prompt: { required: 'always', maxLength: 20000 },
		estimate: true,
		deprecated: undefined
	});
	assert.ok(model.description && model.description.length > 0);

	const none = { min: 0, max: 0 };
	const inputs = (change: Record<string, unknown>) => ({ startFrame: 'none', endFrame: 'none', images: none, videos: none, audios: none, source: 'none', ...change });
	assert.deepEqual(model.modes, [
		{ id: 'frames', label: 'Frames', inputs: inputs({ startFrame: 'optional', endFrame: 'optional' }), limits: {} },
		{ id: 'edit', label: 'Edit', inputs: inputs({ source: 'required' }), limits: { videoSeconds: [0.7, 15], videoMaxBytes: 50 * MiB } },
		{ id: 'extend', label: 'Extend', inputs: inputs({ source: 'required' }), limits: { videoSeconds: [0.1, 15], videoMaxBytes: 50_000_000 } }
	]);

	assert.ok(model.parameters.every(parameter => typeof parameter.tooltip === 'string' && parameter.tooltip.length > 0), 'every setting explains itself');
	assert.deepEqual(model.parameters.map(({ tooltip: _tooltip, ...parameter }) => parameter), [
		{
			name: 'resolution',
			label: 'Resolution',
			kind: 'choice',
			options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
			default: '720p',
			modes: ['frames', 'extend']
		},
		{
			name: 'ratio',
			label: 'Ratio',
			kind: 'choice',
			display: 'ratio',
			options: [{ value: 'adaptive', label: 'Adaptive' }, ...['21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'].map(ratio => ({ value: ratio, label: ratio }))],
			default: 'adaptive',
			modes: ['frames', 'extend']
		},
		{ name: 'duration', label: 'Duration', kind: 'integer', unit: 'seconds', min: 5, max: 20, step: 1, default: 5, auto: { value: -1, label: 'Auto' }, modes: ['frames', 'extend'] },
		{ name: 'sound', label: 'Sound', kind: 'boolean', default: true, modes: ['frames', 'extend'] },
		{ name: 'safety_tolerance', label: 'Safety Tolerance', kind: 'integer', min: 0, max: 4, step: 1, default: 2, advanced: true }
	]);
	assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'bfl'), 'AI Video ships the Black Forest Labs module');
});

// --- creating a task ----------------------------------------------------------------------------

test('each mode is created once at its route with the exact body and the key in x-key, and check answers that route', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, created(server, `task-${server.received.length}`)));
	try {
		const settings = (change: Record<string, unknown>) => ({ aspect_ratio: 'auto', duration: 5, resolution: 'hd', generate_audio: true, safety_tolerance: 2, ...change });
		const cases: readonly { mode: Mode; params: Record<string, unknown>; inputs?: Inputs; path: string; body: () => unknown }[] = [
			{
				// The defaults: HD, Adaptive, 5 seconds, sound, tolerance 2.
				mode: 'frames', params: {},
				path: '/flux-3-video',
				body: () => ({ mode: 't2v', prompt: PROMPT, ...settings({}) })
			},
			{
				mode: 'frames', params: { resolution: '1080p', ratio: '9:16', duration: 20, sound: false, safety_tolerance: 0 },
				path: '/flux-3-video',
				body: () => ({ mode: 't2v', prompt: PROMPT, ...settings({ aspect_ratio: '9:16', duration: 20, resolution: 'fhd', generate_audio: false, safety_tolerance: 0 }) })
			},
			{
				// One image starts the video and goes as one data URL; Auto and Adaptive go as auto.
				mode: 'frames', params: { resolution: '2k', duration: -1 }, inputs: { startFrame: START },
				path: '/flux-3-video',
				body: () => ({ mode: 'i2v', prompt: PROMPT, keyframes: dataUrl(START, 'image/png'), ...settings({ duration: 'auto', resolution: 'qhd' }) })
			},
			{
				// Two images start and end it, each with the type its bytes show.
				mode: 'frames', params: { resolution: '4k', ratio: '21:9', duration: 12 }, inputs: { startFrame: START, endFrame: END },
				path: '/flux-3-video',
				body: () => ({ mode: 'i2v', prompt: PROMPT, keyframes: [dataUrl(START, 'image/png'), dataUrl(END, 'image/jpeg')], ...settings({ aspect_ratio: '21:9', duration: 12, resolution: 'uhd' }) })
			},
			{
				mode: 'frames', params: { ratio: '1:1' }, inputs: { startFrame: WEBP },
				path: '/flux-3-video',
				body: () => ({ mode: 'i2v', prompt: PROMPT, keyframes: dataUrl(WEBP, 'image/webp'), ...settings({ aspect_ratio: '1:1' }) })
			},
			{
				mode: 'extend', params: { resolution: '4k', duration: 15, sound: false }, inputs: { source: CLIP },
				path: '/flux-3-video',
				body: () => ({ mode: 'v2v', prompt: PROMPT, start_video: dataUrl(CLIP, 'video/mp4'), ...settings({ duration: 15, resolution: 'uhd', generate_audio: false }) })
			},
			{
				mode: 'extend', params: { ratio: '16:9', duration: -1, safety_tolerance: 4 }, inputs: { source: CLIP },
				path: '/flux-3-video',
				body: () => ({ mode: 'v2v', prompt: PROMPT, start_video: dataUrl(CLIP, 'video/mp4'), ...settings({ aspect_ratio: '16:9', duration: 'auto', safety_tolerance: 4 }) })
			},
			{
				// The edit follows its clip: only the clip, the prompt, and the tolerance.
				mode: 'edit', params: { safety_tolerance: 3 }, inputs: { source: CLIP },
				path: '/flux-tools/video-edit-v1',
				body: () => ({ video: dataUrl(CLIP, 'video/mp4'), prompt: PROMPT, safety_tolerance: 3 })
			},
			{
				mode: 'edit', params: {}, inputs: { source: CLIP },
				path: '/flux-tools/video-edit-v1',
				body: () => ({ video: dataUrl(CLIP, 'video/mp4'), prompt: PROMPT, safety_tolerance: 2 })
			}
		];
		const providers = commands();
		const outcomes = [];
		for (const entry of cases) {
			const before = server.received.length;
			const request = generation(server.url, entry.mode, entry.params, entry.inputs);
			const checked = value(await providers.check(checkRequest(entry.mode, entry.params, request.inputs)));
			const answer = await providers.submit(request);
			outcomes.push({
				mode: entry.mode,
				checked: [checked.problems, checked.providerModel],
				answer,
				sent: server.received.slice(before).map(received => ({
					method: received.method,
					path: received.path,
					key: received.headers['x-key'],
					authorization: received.headers.authorization,
					type: received.headers['content-type'],
					body: sentBody(received)
				}))
			});
		}
		assert.deepEqual(outcomes, cases.map((entry, index) => ({
			mode: entry.mode,
			checked: [[], entry.path.slice(1)],
			// The task is followed at the polling address the create answered.
			answer: { ok: true, value: { remoteId: `${server.url}/get_result?id=task-${index + 1}` } },
			sent: [{ method: 'POST', path: entry.path, key: KEY, authorization: undefined, type: 'application/json', body: entry.body() }]
		})));
	} finally {
		await server.close();
	}
});

test('the route follows the mode and the inputs, with files and without', async () => {
	const providers = commands();
	const routed = async (mode: Mode, inputs: ReturnType<typeof counts> | ReturnType<typeof planned>) => value(await providers.check(checkRequest(mode, {}, inputs))).providerModel;
	assert.deepEqual({
		text: await routed('frames', counts()),
		startFrame: await routed('frames', counts({ startFrame: true })),
		startAndEndFiles: await routed('frames', planned({ startFrame: START, endFrame: END })),
		extend: await routed('extend', counts({ source: true })),
		extendFile: await routed('extend', planned({ source: CLIP })),
		edit: await routed('edit', counts({ source: true })),
		editFile: await routed('edit', planned({ source: CLIP }))
	}, {
		text: 'flux-3-video',
		startFrame: 'flux-3-video',
		startAndEndFiles: 'flux-3-video',
		extend: 'flux-3-video',
		extendFile: 'flux-3-video',
		edit: 'flux-tools/video-edit-v1',
		editFile: 'flux-tools/video-edit-v1'
	});
});

test('an endpoint with a path, such as a relay\'s, keeps it for creating and asking; a create without a polling address is asked by its id', async () => {
	let creates = 0;
	const server = await startServer((request, response) => {
		if (request.method === 'POST') {
			creates++;
			sendJson(response, 200, creates === 1 ? created(server, 'task-1', '/relay/bfl/v1') : { id: 'task-2' });
			return;
		}
		sendJson(response, 200, { id: 'task', status: 'Generating', progress: 0.5 });
	});
	try {
		const providers = commands();
		const endpoint = `${server.url}/relay/bfl/v1/`;
		const first = value(await providers.submit(generation(endpoint, 'frames', {})));
		const second = value(await providers.submit(generation(endpoint, 'extend', {}, { source: CLIP })));
		const polled = [value(await providers.poll(taskRef(endpoint, first.remoteId))), value(await providers.poll(taskRef(endpoint, second.remoteId)))];
		assert.deepEqual({ first, second, polled, sent: server.received.map(request => [request.method, request.path, request.headers['x-key']]) }, {
			first: { remoteId: `${server.url}/relay/bfl/v1/get_result?id=task-1` },
			second: { remoteId: 'task-2' },
			polled: [{ state: 'running', fraction: 0.5 }, { state: 'running', fraction: 0.5 }],
			// The polling address is on the endpoint's origin, so the key goes with it.
			sent: [
				['POST', '/relay/bfl/v1/flux-3-video', KEY],
				['POST', '/relay/bfl/v1/flux-3-video', KEY],
				['GET', '/relay/bfl/v1/get_result?id=task-1', KEY],
				['GET', '/relay/bfl/v1/get_result?id=task-2', KEY]
			]
		});
	} finally {
		await server.close();
	}
});

test('a polling address on a host of Black Forest Labs is kept and asked without the key; one on any other host is never asked', async () => {
	const other = await startServer((request, response) => sendJson(response, 200, { id: 'task-3', status: 'Ready', result: { sample: 'https://example.com/video.mp4' } }));
	let creates = 0;
	const api = await startServer((request, response) => {
		if (request.method === 'POST') {
			creates++;
			sendJson(response, 200, creates === 1
				? { id: 'task-bfl', polling_url: 'https://api.us1.bfl.ai/v1/get_result?id=task-bfl' }
				: { id: 'task-3', polling_url: `${other.url}/v1/get_result?id=task-3` });
			return;
		}
		sendJson(response, 200, { id: 'task-3', status: 'Pending', progress: null });
	});
	try {
		const providers = commands();
		const onBfl = value(await providers.submit(generation(api.url, 'frames', {})));
		const elsewhere = value(await providers.submit(generation(api.url, 'frames', {})));
		const polled = value(await providers.poll(taskRef(api.url, elsewhere.remoteId)));
		// An address written into a node by hand, on neither the endpoint's origin nor a BFL host.
		const refused = error(await providers.poll(taskRef(api.url, `${other.url}/v1/get_result?id=task-3`)));
		assert.deepEqual({ onBfl, elsewhere, polled, refused, toApi: api.received.map(request => [request.method, request.path]), toOther: other.received.length }, {
			onBfl: { remoteId: 'https://api.us1.bfl.ai/v1/get_result?id=task-bfl' },
			elsewhere: { remoteId: 'task-3' },
			polled: { state: 'pending' },
			refused: { code: 'rejected', message: 'The task\'s polling address is neither on the endpoint set up for Black Forest Labs nor on a host of Black Forest Labs, so AI Video does not ask it.' },
			toApi: [['POST', '/flux-3-video'], ['POST', '/flux-3-video'], ['GET', '/get_result?id=task-3']],
			toOther: 0
		});

		// On a BFL host the module asks the polling address itself and adds no header; the
		// framework sends the key to the endpoint's origin only, so the cluster gets none.
		const calls: HttpCall[] = [];
		const recording: ProviderHttp = {
			endpoint: parseEndpoint('https://api.bfl.ai/v1'),
			create: async () => { throw new Error('not used'); },
			request: async call => {
				calls.push(call);
				return jsonAnswer({ id: 'task-bfl', status: 'Generating', progress: 0.25 });
			},
			requestOnce: async () => { throw new Error('not used'); }
		};
		const state = await BFL.poll(taskRef('https://api.bfl.ai/v1', onBfl.remoteId), recording);
		const bound = new BoundHttp(parseEndpoint('https://api.bfl.ai/v1'), () => BFL.headers({ apiKey: KEY }), BFL.readError, resolveHttpOptions({}));
		assert.deepEqual({
			state,
			calls,
			toCluster: bound.credentialHeadersFor(new URL(onBfl.remoteId)),
			toEndpoint: bound.credentialHeadersFor(new URL('https://api.bfl.ai/v1/get_result?id=task-bfl'))
		}, {
			state: { state: 'running', fraction: 0.25 },
			calls: [{ method: 'GET', url: 'https://api.us1.bfl.ai/v1/get_result?id=task-bfl' }],
			toCluster: {},
			toEndpoint: { 'x-key': KEY }
		});
	} finally {
		await api.close();
		await other.close();
	}
});

test('a create is sent once: a dropped connection, a server error, and an answer without a task leave the outcome unknown', async () => {
	const dropping = await startServer((request, response, socket) => socket.destroy());
	const replies: readonly [number, unknown][] = [
		[500, { detail: 'Internal Server Error' }],
		[200, { cost: 75 }],
		[200, { polling_url: 'not an address' }],
		[200, { id: 'task-8' }]
	];
	let next = 0;
	const answering = await startServer((request, response) => {
		const [status, body] = replies[next++];
		sendJson(response, status, body);
	});
	try {
		const providers = commands();
		const dropped = error(await providers.submit(generation(dropping.url, 'extend', {}, { source: CLIP })));
		const outcomes = [];
		for (let index = 0; index < replies.length; index++) {
			const answer = await providers.submit(generation(answering.url, 'frames', {}));
			outcomes.push(answer.ok ? answer.value : [answer.error.code, answer.error.status]);
		}
		assert.deepEqual({ dropped: dropped.code, droppedSent: dropping.received.length, outcomes, sent: answering.received.length }, {
			dropped: 'unknownOutcome',
			droppedSent: 1,
			outcomes: [['unknownOutcome', 500], ['unknownOutcome', undefined], ['unknownOutcome', undefined], { remoteId: 'task-8' }],
			sent: replies.length
		});
	} finally {
		await dropping.close();
		await answering.close();
	}
});

// --- errors -------------------------------------------------------------------------------------

test('a refused key answers auth for a create and for a poll, and no message carries the key', async () => {
	const server = await startServer((request, response) => sendJson(response, 401, { detail: 'Not authenticated' }));
	try {
		const providers = commands();
		const submitted = error(await providers.submit(generation(server.url, 'frames', {})));
		const polled = error(await providers.poll(taskRef(server.url, 'task-1')));
		const message = 'Black Forest Labs refused the API key. Check it in Video Providers. (Not authenticated)';
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

test('too few credits, a key without access, refused values, too many tasks, and other refusals answer the contract\'s codes, each create sent once', async () => {
	const replies: readonly [number, unknown, Record<string, string>?][] = [
		[402, { detail: 'Insufficient credits' }],
		[403, { detail: 'Forbidden' }],
		[422, { detail: [
			{ type: 'less_than_equal', loc: ['body', 't2v', 'duration'], msg: 'Input should be less than or equal to 20', input: 30 },
			{ type: 'literal_error', loc: ['body', 't2v', 'safety_tolerance'], msg: 'Input should be 0, 1 or 2', input: 4 }
		] }],
		[400, { detail: 'Invalid image data' }],
		[429, { detail: 'You have reached the maximum number of active tasks.' }, { 'Retry-After': '20' }],
		[404, { detail: 'Not Found' }]
	];
	let next = 0;
	const server = await startServer((request, response) => {
		const [status, body, headers] = replies[next++];
		sendJson(response, status, body, headers);
	});
	try {
		const providers = commands();
		const outcomes = [];
		for (let index = 0; index < replies.length; index++) {
			const failed = error(await providers.submit(generation(server.url, 'frames', {})));
			outcomes.push([failed.code, failed.status, failed.message]);
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				['balance', 402, 'The Black Forest Labs organization has too few credits for this request. Add credits in the BFL dashboard. (Insufficient credits)'],
				['auth', 403, 'Black Forest Labs refused the API key for this request: the key may be wrong, or its project may not use this endpoint. Check it in Video Providers. (Forbidden)'],
				// The fields and BFL's messages, never the values sent.
				['rejected', 422, 'Black Forest Labs refused the request: t2v.duration: Input should be less than or equal to 20; t2v.safety_tolerance: Input should be 0, 1 or 2'],
				['rejected', 400, 'Black Forest Labs refused the request: Invalid image data'],
				['rateLimited', 429, 'Black Forest Labs is already running as many tasks as the account may run at once, or received too many requests. Wait for a task to finish. (You have reached the maximum number of active tasks.) The provider asks to wait 20 seconds.'],
				['rejected', 404, 'Black Forest Labs: Not Found']
			],
			sent: replies.length
		});
	} finally {
		await server.close();
	}
});

// --- asking about a task ------------------------------------------------------------------------

test('a poll maps every status of get_result, with the progress BFL gives as a fraction', async () => {
	const sample = 'https://delivery-eu1.bfl.ai/results/ab/cd/sample.mp4?se=2026-10-19T10%3A00%3A00Z&sig=abc';
	const tasks: Readonly<Record<string, unknown>> = {
		't-pending': { id: 't-pending', status: 'Pending', result: null, progress: null, details: null, preview: null },
		't-reasoning': { id: 't-reasoning', status: 'Reasoning', progress: 0.1 },
		't-generating': { id: 't-generating', status: 'Generating', progress: 0.42 },
		't-percent': { id: 't-percent', status: 'Generating', progress: 42 },
		't-ready': { id: 't-ready', status: 'Ready', result: { sample, duration: 5 }, progress: 1, cost: 75 },
		't-ready-bare': { id: 't-ready-bare', status: 'Ready', result: {} },
		't-request': { id: 't-request', status: 'Request Moderated', result: null, details: { 'Moderation Reasons': ['Violence', 'Self Harm'] } },
		't-content': { id: 't-content', status: 'Content Moderated', result: null, details: { 'Moderation Reasons': ['Sexual Content'] } },
		't-error': { id: 't-error', status: 'Error', result: null, details: { error: 'The source clip is longer than 15 seconds.' } },
		't-error-bare': { id: 't-error-bare', status: 'Error', result: null },
		't-failed': { id: 't-failed', status: 'Failed' },
		't-no-card': { id: 't-no-card', status: 'No Card Generated' },
		't-unknown': { id: 't-unknown', status: 'Task not found' },
		't-paused': { id: 't-paused', status: 'Paused' }
	};
	const server = await startServer((request, response) => {
		const id = new URL(request.path, 'http://local').searchParams.get('id') ?? '';
		if (!tasks[id]) {
			sendJson(response, 404, { detail: 'Not Found' });
			return;
		}
		sendJson(response, 200, tasks[id]);
	});
	try {
		const providers = commands();
		const at = (id: string) => taskRef(server.url, `${server.url}/get_result?id=${id}`);
		const states = [];
		for (const id of ['t-pending', 't-reasoning', 't-generating', 't-percent', 't-ready', 't-ready-bare', 't-request', 't-content', 't-error', 't-error-bare', 't-failed', 't-no-card']) {
			states.push(value(await providers.poll(at(id))));
		}
		const others = [];
		for (const id of ['t-unknown', 't-paused', 't-gone']) {
			const failed = error(await providers.poll(at(id)));
			others.push([failed.code, failed.message]);
		}
		assert.deepEqual({ states, others }, {
			states: [
				{ state: 'pending' },
				{ state: 'running', fraction: 0.1 },
				{ state: 'running', fraction: 0.42 },
				// A progress outside 0 to 1 has no scale AI Video knows.
				{ state: 'running' },
				{ state: 'succeeded', videoUrl: sample },
				{ state: 'succeeded' },
				{ state: 'failed', message: 'Black Forest Labs\' moderation refused the prompt or an input before the video was made (Violence, Self Harm). Change the request: the same one is refused again.' },
				{ state: 'failed', message: 'Black Forest Labs\' moderation withheld the finished video (Sexual Content). Change the prompt or the inputs.' },
				{ state: 'failed', message: 'Black Forest Labs reports that the generation failed: The source clip is longer than 15 seconds.' },
				{ state: 'failed', message: 'Black Forest Labs reports that the generation failed.' },
				{ state: 'failed', message: 'Black Forest Labs reports that the generation failed.' },
				{ state: 'failed', message: 'Black Forest Labs ended the task without a result (No Card Generated).' }
			],
			others: [
				['notFound', 'Black Forest Labs does not know the task t-unknown: it does not exist or has expired.'],
				['invalidResponse', 'Black Forest Labs reports a task state AI Video does not know: Paused.'],
				['notFound', 'Black Forest Labs: Not Found']
			]
		});
		assert.ok(server.received.every(request => request.method === 'GET' && request.headers['x-key'] === KEY && request.body.length === 0));
	} finally {
		await server.close();
	}
});

test('a poll answered 503 with Retry-After is asked again after the wait, at the same address', async () => {
	let answered = 0;
	const server = await startServer((request, response) => {
		answered++;
		if (answered === 1) {
			sendJson(response, 503, { detail: 'Service Unavailable' }, { 'Retry-After': '7' });
			return;
		}
		sendJson(response, 200, { id: 'task-5', status: 'Generating' });
	});
	try {
		const sleep = recordingSleep();
		const polled = value(await commands({ http: { sleep: sleep.sleep } }).poll(taskRef(server.url, 'task-5')));
		assert.deepEqual({ polled, waits: sleep.waits, paths: server.received.map(request => request.path) }, {
			polled: { state: 'running' },
			waits: [7000],
			paths: ['/get_result?id=task-5', '/get_result?id=task-5']
		});
	} finally {
		await server.close();
	}
});

test('the video downloads from its delivery address without the key, and without an address from the task asked about again', async () => {
	const video = isoMedia(5);
	const delivery = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
		response.end(video);
	});
	const api = await startServer((request, response) => sendJson(response, 200, { id: 'task-9', status: 'Ready', result: { sample: `${delivery.url}/results/task-9/sample.mp4?sig=abc` }, progress: null }));
	try {
		const providers = commands();
		const ref = taskRef(api.url, `${api.url}/get_result?id=task-9`);
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: polled.state === 'succeeded' ? polled.videoUrl : undefined, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		assert.deepEqual({
			withAddress,
			withoutAddress,
			same: [readFileSync(first).equals(video), readFileSync(second).equals(video)],
			asked: api.received.map(request => [request.path, request.headers['x-key']]),
			downloaded: delivery.received.map(request => [request.path, request.headers['x-key']])
		}, {
			withAddress: { size: video.byteLength },
			withoutAddress: { size: video.byteLength },
			same: [true, true],
			asked: [['/get_result?id=task-9', KEY], ['/get_result?id=task-9', KEY]],
			downloaded: [['/results/task-9/sample.mp4?sig=abc', undefined], ['/results/task-9/sample.mp4?sig=abc', undefined]]
		});
	} finally {
		await api.close();
		await delivery.close();
	}
});

test('Black Forest Labs has no cancellation: cancel answers false and sends nothing', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, {}));
	try {
		const answer = value(await commands().cancel(taskRef(server.url, `${server.url}/get_result?id=task-1`)));
		assert.deepEqual({ answer, sent: server.received.length }, { answer: { cancelled: false }, sent: 0 });
	} finally {
		await server.close();
	}
});

// --- checks -------------------------------------------------------------------------------------

test('check reports the rules between settings and modes, after the declarations\' own checks', async () => {
	const providers = commands();
	const problems = async (mode: Mode, params: Record<string, unknown>, inputs: ReturnType<typeof counts>, text = PROMPT) =>
		value(await providers.check(checkRequest(mode, params, inputs, text))).problems;
	const clip = counts({ source: true });
	assert.deepEqual({
		extendTwenty: await problems('extend', { duration: 20 }, clip),
		extendFifteen: await problems('extend', { duration: 15 }, clip),
		extendAuto: await problems('extend', { duration: -1 }, clip),
		framesTwenty: await problems('frames', { duration: 20 }, counts()),
		framesTwentyOne: await problems('frames', { duration: 21 }, counts()),
		editLongPrompt: await problems('edit', {}, clip, 'a'.repeat(4097)),
		editTrimmedPrompt: await problems('edit', {}, clip, `  ${'a'.repeat(4096)}  `),
		framesLongerPrompt: await problems('frames', {}, counts(), 'a'.repeat(4097)),
		tooLongPrompt: await problems('frames', {}, counts(), 'a'.repeat(20001)),
		noPrompt: await problems('frames', {}, counts({ startFrame: true }), '  '),
		editWithImage: await problems('edit', {}, counts({ source: true, images: 1 })),
		endFrameAlone: await problems('frames', {}, counts({ endFrame: true })),
		editResolution: await problems('edit', { resolution: '1080p' }, clip),
		toleranceFive: await problems('frames', { safety_tolerance: 5 }, counts()),
		extendWithoutClip: await problems('extend', {}, counts())
	}, {
		extendTwenty: ['FLUX 3 continues a clip by 5 to 15 seconds; choose 15 seconds or less, or Auto.'],
		extendFifteen: [],
		extendAuto: [],
		framesTwenty: [],
		framesTwentyOne: ['Duration must be between 5 and 20 seconds, or Auto.'],
		editLongPrompt: ['The prompt is 4097 characters long; FLUX 3 in Edit mode takes at most 4096.'],
		editTrimmedPrompt: [],
		framesLongerPrompt: [],
		tooLongPrompt: ['The prompt is 20001 characters long; FLUX 3 takes at most 20000.'],
		noPrompt: ['Write a prompt: FLUX 3 needs one.'],
		editWithImage: ['FLUX 3 in Edit mode takes no reference images.'],
		endFrameAlone: ['An end frame needs a start frame.'],
		editResolution: ['Resolution does not apply in Edit mode.'],
		toleranceFive: ['Safety Tolerance must be between 0 and 4.'],
		extendWithoutClip: ['FLUX 3 in Extend mode needs a video to work on.']
	});
});

test('with files, check refuses a MOV clip, clips outside their lengths, another image format, and a request too large to send; submit then sends nothing', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, created(server, 'task-1')));
	try {
		const providers = commands();
		// Every input measured as a 50 MiB PNG: two of them as base64 make more than 128 MiB.
		const large = commands({ inspector: (): MediaInspector => ({ inspect: async () => ({ bytes: 50 * MiB, format: 'png', width: 1920, height: 1080 }) }) });
		const withFiles = async (mode: Mode, params: Record<string, unknown>, inputs: Inputs, checker = providers) =>
			value(await checker.check(checkRequest(mode, params, planned(inputs)))).problems;
		const outcomes = {
			movExtend: await withFiles('extend', {}, { source: MOV }),
			movEdit: await withFiles('edit', {}, { source: MOV }),
			longExtend: await withFiles('extend', {}, { source: LONG_CLIP }),
			shortEdit: await withFiles('edit', {}, { source: SHORT_CLIP }),
			gif: await withFiles('frames', {}, { startFrame: GIF }),
			webpAndJpeg: await withFiles('frames', {}, { startFrame: WEBP, endFrame: END }),
			clip: await withFiles('edit', {}, { source: CLIP }),
			oneLarge: await withFiles('frames', {}, { startFrame: START }, large),
			twoLarge: await withFiles('frames', {}, { startFrame: START, endFrame: END }, large),
			submittedMov: error(await providers.submit(generation(server.url, 'extend', {}, { source: MOV }))),
			submittedRule: error(await providers.submit(generation(server.url, 'extend', { duration: 20 }, { source: CLIP })))
		};
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: {
				movExtend: ['The source video clip.mov is a MOV video; Black Forest Labs takes MP4 videos only.'],
				movEdit: ['The source video clip.mov is a MOV video; Black Forest Labs takes MP4 videos only.'],
				longExtend: ['The source video long.mp4 is 16 seconds long; a video must be 0.1 to 15 seconds.'],
				shortEdit: ['The source video short.mp4 is 0.5 seconds long; a video must be 0.7 to 15 seconds.'],
				gif: ['The start frame moving.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.'],
				webpAndJpeg: [],
				clip: [],
				oneLarge: [],
				twoLarge: ['The inputs make a request of 133.3 MiB; AI Video sends at most 128 MiB. Use fewer or smaller inputs.'],
				submittedMov: { code: 'rejected', message: 'The source video clip.mov is a MOV video; Black Forest Labs takes MP4 videos only.' },
				submittedRule: { code: 'rejected', message: 'FLUX 3 continues a clip by 5 to 15 seconds; choose 15 seconds or less, or Auto.' }
			},
			sent: 0
		});
	} finally {
		await server.close();
	}
});

// --- estimates ----------------------------------------------------------------------------------

test('estimates follow the rate card: one amount for a duration, a range for Auto, and the clip\'s length for an edit', async () => {
	const providers = commands();
	const estimate = async (mode: Mode, params: Record<string, unknown>, inputs: ReturnType<typeof counts> | ReturnType<typeof planned>) =>
		value(await providers.check(checkRequest(mode, params, inputs))).estimate;
	const usd = (min: number, max = min): Estimate => ({ currency: 'USD', min, max, priceDate: PRICE_DATE });
	assert.deepEqual({
		// Text to video with the defaults, HD for 5 s: $0.15/s × 5 s = $0.75.
		framesDefaults: await estimate('frames', {}, counts()),
		// A start and an end frame at UHD (4K) for 20 s: $0.41/s × 20 s = $8.20.
		frames4k: await estimate('frames', { resolution: '4k', duration: 20 }, counts({ startFrame: true, endFrame: true })),
		// FHD with Auto, 5 to 20 s: $0.24/s × 5 s = $1.20 to $0.24/s × 20 s = $4.80.
		framesAuto: await estimate('frames', { resolution: '1080p', duration: -1 }, counts()),
		// A continuation at QHD (2K) of 10 s, the new part only: $0.31/s × 10 s = $3.10.
		extend2k: await estimate('extend', { resolution: '2k', duration: 10 }, counts({ source: true })),
		// A continuation at HD with Auto, 5 to 15 s: $0.21/s × 5 s = $1.05 to $0.21/s × 15 s = $3.15.
		extendAuto: await estimate('extend', { duration: -1 }, counts({ source: true })),
		// An edit of a 7.5 s clip, whose length the output keeps: $0.03/s × 7.5 s = $0.225.
		editClip: await estimate('edit', {}, planned({ source: CLIP })),
		// An edit without its file, a clip of 0.7 to 15 s: $0.03/s × 0.7 s = $0.021 to $0.03/s × 15 s = $0.45.
		editRange: await estimate('edit', {}, counts({ source: true }))
	}, {
		framesDefaults: usd(0.75),
		frames4k: usd(8.2),
		framesAuto: usd(1.2, 4.8),
		extend2k: usd(3.1),
		extendAuto: usd(1.05, 3.15),
		editClip: usd(0.225),
		editRange: usd(0.021, 0.45)
	});
});

test('every rate of the card is used as listed, per second of output video', async () => {
	// The rate card's published data, last updated 2026-10-15: dollars per second.
	const rows: readonly [Mode, string, number][] = [
		['frames', '720p', 0.15], ['frames', '1080p', 0.24], ['frames', '2k', 0.28], ['frames', '4k', 0.41],
		['extend', '720p', 0.21], ['extend', '1080p', 0.27], ['extend', '2k', 0.31], ['extend', '4k', 0.45]
	];
	const providers = commands();
	const round = (money: number) => Math.round(money * 1e6) / 1e6;
	for (const [mode, resolution, rate] of rows) {
		const answer = value(await providers.check(checkRequest(mode, { resolution, duration: 10 }, counts({ source: mode === 'extend' }))));
		assert.deepEqual(answer.estimate, { currency: 'USD', min: round(rate * 10), max: round(rate * 10), priceDate: PRICE_DATE }, `${mode} ${resolution}`);
	}
	// The edit: $0.03 per second of the clip at every size; a 10 s clip costs $0.30.
	const edit = value(await providers.check(checkRequest('edit', {}, planned({ source: TEN_SECONDS }))));
	assert.deepEqual(edit.estimate, { currency: 'USD', min: 0.3, max: 0.3, priceDate: PRICE_DATE });
});
