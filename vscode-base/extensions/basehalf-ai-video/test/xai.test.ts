/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The xAI module (docs/specs/video-providers/xai.md) through the provider
 * commands, against local servers that answer like xAI's API and its video
 * host. No test calls xAI or uses a real key.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { ModeId, PlannedMedia } from '../src/providers/types.ts';
import { XAI } from '../src/providers/xai.ts';
import { error, isoMedia, jpegHeader, plannedFiles, png, sendJson, startServer, value, webpHeader, type Received } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-xai-'));
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
const REFERENCES = [
	file('one.png', png(400, 400), 'image/png'),
	file('two.jpg', jpegHeader(720, 1280), 'image/jpeg'),
	file('three.webp', webpHeader('VP8X', 600, 300), 'image/webp')
];
const SEVEN = Array.from({ length: 7 }, (_, index) => file(`reference-${index + 1}.png`, png(300 + index, 300), 'image/png'));
const CLIP = file('clip.mp4', isoMedia(6), 'video/mp4');
const SHORT_CLIP = file('short.mp4', isoMedia(4), 'video/mp4');
const LONG_CLIP = file('long.mp4', isoMedia(9.5), 'video/mp4');
const MOV = file('clip.mov', isoMedia(5, { brand: 'qt  ' }), 'video/quicktime');

const KEY = 'xai-test-key-0001';
const PROMPT = 'A paper boat drifts down a rain-soaked street.';
const V15 = 'grok-imagine-video-1.5';
const LITE = 'grok-imagine-video-1.5-lite';
const CLASSIC = 'grok-imagine-video';

function dataUrl(media: FileMedia, type: string): string {
	return `data:${type};base64,${readFileSync(media.fsPath).toString('base64')}`;
}

function commands(options: { readonly inspector?: () => MediaInspector } = {}): VideoProviderCommands {
	return new VideoProviderCommands([XAI], { http: { sleep: async () => undefined }, ...options });
}

interface Inputs {
	readonly startFrame?: FileMedia;
	readonly endFrame?: FileMedia;
	readonly images?: readonly FileMedia[];
	readonly source?: FileMedia;
}

function generation(endpoint: string, model: string, mode: ModeId, params: Record<string, unknown>, inputs: Inputs = {}, prompt = PROMPT) {
	return {
		provider: 'xai',
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
			images: inputs.images ?? [],
			videos: [],
			audios: [],
			...(inputs.source ? { source: inputs.source } : {})
		}
	};
}

function taskRef(endpoint: string, remoteId: string) {
	return { provider: 'xai', region: 'global', endpoint, credentials: { apiKey: KEY }, model: V15, remoteId };
}

function sentBody(request: Received): unknown {
	return JSON.parse(request.body.toString('utf8'));
}

/** A finished task, as `GET /videos/{request_id}` answers it. */
function done(url: string) {
	return { status: 'done', video: { url, duration: 6, respect_moderation: true }, model: V15, progress: 100, usage: { cost_in_usd_ticks: 4000000000 } };
}

// --- the catalog --------------------------------------------------------------------------------

test('the catalog declares xAI with one region, one API key, and three models with their modes, limits, and settings', () => {
	const provider = buildCatalog([XAI]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'xai',
		label: 'xAI',
		regions: [{ id: 'global', label: 'Global', baseUrl: 'https://api.x.ai/v1', console: 'https://console.x.ai/team/default/api-keys' }],
		credentials: [{ id: 'apiKey', label: 'API Key' }]
	});

	const none = { min: 0, max: 0 };
	const frames = (endFrame: 'optional' | 'none') => ({
		id: 'frames', label: 'Frames',
		inputs: { startFrame: 'optional', endFrame, images: none, videos: none, audios: none, source: 'none' },
		limits: {}
	});
	const references = (max: number) => ({
		id: 'reference', label: 'References',
		inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max }, videos: none, audios: none, source: 'none' },
		limits: {}
	});
	const clip = (id: 'edit' | 'extend', label: string, seconds: [number, number]) => ({
		id, label,
		inputs: { startFrame: 'none', endFrame: 'none', images: none, videos: none, audios: none, source: 'required' },
		limits: { videoSeconds: seconds }
	});
	const prompt = { required: 'withoutMedia', maxLength: 1048576 };
	assert.deepEqual(provider.models.map(model => ({
		id: model.id,
		label: model.label,
		sentAs: model.providerModels,
		prompt: model.prompt,
		modes: model.modes,
		deprecated: model.deprecated
	})), [
		{ id: V15, label: 'Grok Imagine Video 1.5', sentAs: { global: V15 }, prompt, modes: [frames('optional'), references(14)], deprecated: undefined },
		{ id: LITE, label: 'Grok Imagine Video 1.5 Lite', sentAs: { global: LITE }, prompt, modes: [frames('none')], deprecated: undefined },
		{ id: CLASSIC, label: 'Grok Imagine Video', sentAs: { global: CLASSIC }, prompt, modes: [frames('none'), references(7), clip('edit', 'Edit', [0.1, 8.7]), clip('extend', 'Extend', [2, 15])], deprecated: undefined }
	]);

	const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'].map(ratio => ({ value: ratio, label: ratio }));
	const resolutions = (values: readonly string[]) => values.map(entry => ({ value: entry, label: entry }));
	const ratio = { name: 'ratio', label: 'Ratio', tooltip: 'The shape of the video. A video made from a start frame takes the shape of the frame.', kind: 'choice', display: 'ratio', options: ratios, default: '16:9', setByStartFrame: true };
	const duration = { name: 'duration', label: 'Duration', kind: 'integer', unit: 'seconds', min: 1, max: 15, step: 1, default: 5 };
	const sound = { name: 'sound', label: 'Sound', tooltip: 'Turn it off for a silent video.', kind: 'boolean', default: true };
	const generationModes = { modes: ['frames', 'reference'] };
	assert.deepEqual(Object.fromEntries(provider.models.map(model => [model.id, model.parameters])), {
		[V15]: [
			{ name: 'resolution', label: 'Resolution', tooltip: 'With an end frame or reference images, 720p at most.', kind: 'choice', options: resolutions(['480p', '720p', '1080p']), default: '480p' },
			ratio,
			duration,
			sound
		],
		[LITE]: [
			{ name: 'resolution', label: 'Resolution', tooltip: '1080p is upscaled from 720p.', kind: 'choice', options: resolutions(['480p', '720p', '1080p']), default: '480p' },
			ratio,
			duration,
			sound
		],
		[CLASSIC]: [
			{ name: 'resolution', label: 'Resolution', kind: 'choice', options: resolutions(['480p', '720p']), default: '480p', ...generationModes },
			{ ...ratio, ...generationModes },
			{ ...duration, tooltip: 'In Extend mode, the length added to the clip: 2 to 10 seconds. From reference images, 10 seconds at most.', modes: ['frames', 'reference', 'extend'] },
			{ ...sound, ...generationModes }
		]
	});
	assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'xai'), 'AI Video ships the xAI module');
});

// --- creating a task ----------------------------------------------------------------------------

test('each mode of each model is created once, at its endpoint, with the exact body and every input inline as a data URL', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { request_id: `request-${server.received.length}` }));
	try {
		const png = (media: FileMedia) => ({ url: dataUrl(media, 'image/png') });
		const jpeg = (media: FileMedia) => ({ url: dataUrl(media, 'image/jpeg') });
		const cases: readonly { model: string; mode: ModeId; params: Record<string, unknown>; inputs?: Inputs; prompt?: string; path: string; body: () => unknown }[] = [
			{
				// Text to video with every default: 480p, 16:9, 5 seconds, sound on.
				model: V15, mode: 'frames', params: {},
				path: '/videos/generations',
				body: () => ({ model: V15, prompt: PROMPT, duration: 5, aspect_ratio: '16:9', resolution: '480p', generate_audio: true })
			},
			{
				// A start frame without a prompt sends no prompt, and no ratio: the video takes the frame's shape.
				model: V15, mode: 'frames', params: { resolution: '1080p', ratio: '1:1', sound: false }, inputs: { startFrame: START }, prompt: '  ',
				path: '/videos/generations',
				body: () => ({ model: V15, image: png(START), duration: 5, resolution: '1080p', generate_audio: false })
			},
			{
				model: V15, mode: 'frames', params: { resolution: '720p', duration: 8 }, inputs: { startFrame: START, endFrame: END },
				path: '/videos/generations',
				body: () => ({ model: V15, prompt: PROMPT, image: png(START), last_frame: jpeg(END), duration: 8, resolution: '720p', generate_audio: true })
			},
			{
				model: V15, mode: 'reference', params: { resolution: '720p', ratio: '9:16', duration: 12 }, inputs: { images: REFERENCES },
				path: '/videos/generations',
				body: () => ({
					model: V15,
					prompt: PROMPT,
					reference_images: [png(REFERENCES[0]), jpeg(REFERENCES[1]), { url: dataUrl(REFERENCES[2], 'image/webp') }],
					duration: 12,
					aspect_ratio: '9:16',
					resolution: '720p',
					generate_audio: true
				})
			},
			{
				// On 1.5 a prompt is optional with reference images.
				model: V15, mode: 'reference', params: {}, inputs: { images: [REFERENCES[0]] }, prompt: '',
				path: '/videos/generations',
				body: () => ({ model: V15, reference_images: [png(REFERENCES[0])], duration: 5, aspect_ratio: '16:9', resolution: '480p', generate_audio: true })
			},
			{
				model: LITE, mode: 'frames', params: { resolution: '1080p', ratio: '21:9', duration: 15, sound: false },
				path: '/videos/generations',
				body: () => ({ model: LITE, prompt: PROMPT, duration: 15, aspect_ratio: '21:9', resolution: '1080p', generate_audio: false })
			},
			{
				model: LITE, mode: 'frames', params: {}, inputs: { startFrame: END },
				path: '/videos/generations',
				body: () => ({ model: LITE, prompt: PROMPT, image: jpeg(END), duration: 5, resolution: '480p', generate_audio: true })
			},
			{
				model: CLASSIC, mode: 'frames', params: { resolution: '720p', ratio: '5:2', duration: 1 },
				path: '/videos/generations',
				body: () => ({ model: CLASSIC, prompt: PROMPT, duration: 1, aspect_ratio: '5:2', resolution: '720p', generate_audio: true })
			},
			{
				model: CLASSIC, mode: 'reference', params: { resolution: '720p', duration: 10, sound: false }, inputs: { images: SEVEN },
				path: '/videos/generations',
				body: () => ({ model: CLASSIC, prompt: PROMPT, reference_images: SEVEN.map(png), duration: 10, aspect_ratio: '16:9', resolution: '720p', generate_audio: false })
			},
			{
				// Editing takes no setting: the edit keeps the clip's length, shape, and resolution.
				model: CLASSIC, mode: 'edit', params: {}, inputs: { source: CLIP },
				path: '/videos/edits',
				body: () => ({ model: CLASSIC, prompt: PROMPT, video: { url: dataUrl(CLIP, 'video/mp4') } })
			},
			{
				// The duration of an extension is the length it adds.
				model: CLASSIC, mode: 'extend', params: { duration: 8 }, inputs: { source: SHORT_CLIP },
				path: '/videos/extensions',
				body: () => ({ model: CLASSIC, prompt: PROMPT, video: { url: dataUrl(SHORT_CLIP, 'video/mp4') }, duration: 8 })
			}
		];
		const providers = commands();
		const outcomes = [];
		for (const entry of cases) {
			const before = server.received.length;
			const answer = await providers.submit(generation(server.url, entry.model, entry.mode, entry.params, entry.inputs, entry.prompt));
			outcomes.push({
				model: entry.model,
				mode: entry.mode,
				answer,
				sent: server.received.slice(before).map(request => ({
					method: request.method,
					path: request.path,
					authorization: request.headers.authorization,
					type: request.headers['content-type'],
					body: sentBody(request)
				}))
			});
		}
		assert.deepEqual(outcomes, cases.map((entry, index) => ({
			model: entry.model,
			mode: entry.mode,
			answer: { ok: true, value: { remoteId: `request-${index + 1}` } },
			sent: [{ method: 'POST', path: entry.path, authorization: `Bearer ${KEY}`, type: 'application/json', body: entry.body() }]
		})));
	} finally {
		await server.close();
	}
});

test('an endpoint with a path, such as a relay that mirrors xAI\'s API, keeps its path for creating and asking', async () => {
	const server = await startServer((request, response) => request.method === 'POST'
		? sendJson(response, 200, { request_id: 'request-1' })
		: sendJson(response, 202, { status: 'pending', progress: 30 }));
	try {
		const providers = commands();
		const endpoint = `${server.url}/relay/xai/v1/`;
		const submitted = value(await providers.submit(generation(endpoint, CLASSIC, 'edit', {}, { source: CLIP })));
		const polled = value(await providers.poll(taskRef(endpoint, 'request-1')));
		assert.deepEqual({ submitted, polled, sent: server.received.map(request => [request.method, request.path, request.headers.authorization]) }, {
			submitted: { remoteId: 'request-1' },
			polled: { state: 'running', fraction: 0.3 },
			sent: [
				['POST', '/relay/xai/v1/videos/edits', `Bearer ${KEY}`],
				['GET', '/relay/xai/v1/videos/request-1', `Bearer ${KEY}`]
			]
		});
	} finally {
		await server.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome, and it was sent once', async () => {
	const server = await startServer((request, response, socket) => socket.destroy());
	try {
		const failed = error(await commands().submit(generation(server.url, V15, 'reference', {}, { images: REFERENCES })));
		assert.deepEqual({ code: failed.code, sent: server.received.length }, { code: 'unknownOutcome', sent: 1 });
	} finally {
		await server.close();
	}
});

test('other answers to a create: refusals make no task, a server error and an answer without a request id leave the outcome unknown', async () => {
	const replies: readonly [number, unknown][] = [
		[404, { code: 'not-found', error: 'The model grok-imagine-video-1.5 does not exist or your team does not have access to it.' }],
		[422, { error: 'Failed to deserialize the JSON body into the target type: duration: invalid type' }],
		[415, { error: 'Expected request with `Content-Type: application/json`' }],
		[500, { code: 'internal', error: 'internal error' }],
		[503, {}],
		[200, {}],
		[200, { request_id: '' }],
		[200, { request_id: 'request-8' }]
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
			const answer = await providers.submit(generation(server.url, LITE, 'frames', {}));
			outcomes.push(answer.ok ? answer.value : [answer.error.code, answer.error.status, answer.error.message]);
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				['rejected', 404, 'The model grok-imagine-video-1.5 does not exist or your team does not have access to it. (not-found)'],
				['rejected', 422, 'Failed to deserialize the JSON body into the target type: duration: invalid type'],
				['rejected', 415, 'Expected request with `Content-Type: application/json`'],
				['unknownOutcome', 500, 'internal error (internal)'],
				['unknownOutcome', 503, 'The provider answered with HTTP 503.'],
				['unknownOutcome', undefined, 'xAI accepted the request but gave no request id AI Video can read.'],
				['unknownOutcome', undefined, 'xAI accepted the request but gave no request id AI Video can read.'],
				{ remoteId: 'request-8' }
			],
			sent: replies.length
		});
	} finally {
		await server.close();
	}
});

// --- errors -------------------------------------------------------------------------------------

test('a refused key answers auth: 401 for a create and a poll, and the 400 xAI gives an incorrect key; no message carries the key', async () => {
	let next = 0;
	const replies: readonly [number, unknown][] = [
		[401, { code: 'unauthenticated', error: 'No authorization header or an invalid authorization token was provided.' }],
		[401, { code: 'unauthenticated', error: 'No authorization header or an invalid authorization token was provided.' }],
		[400, { code: 'Client specified an invalid argument', error: `Incorrect API key provided: ${KEY}. You can obtain an API key from https://console.x.ai.` }],
		[400, { code: 'Client specified an invalid argument', error: `Incorrect API key provided: ${KEY}. You can obtain an API key from https://console.x.ai.` }]
	];
	const server = await startServer((request, response) => {
		const [status, body] = replies[next++];
		sendJson(response, status, body);
	});
	try {
		const providers = commands();
		const outcomes = [
			error(await providers.submit(generation(server.url, V15, 'frames', {}))),
			error(await providers.poll(taskRef(server.url, 'request-1'))),
			error(await providers.submit(generation(server.url, V15, 'frames', {}))),
			error(await providers.poll(taskRef(server.url, 'request-1')))
		];
		const refused = 'No authorization header or an invalid authorization token was provided. (unauthenticated)';
		const incorrect = 'Incorrect API key provided: ***. You can obtain an API key from https://console.x.ai. (Client specified an invalid argument)';
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				{ code: 'auth', message: refused, status: 401 },
				{ code: 'auth', message: refused, status: 401 },
				{ code: 'auth', message: incorrect, status: 400 },
				{ code: 'auth', message: incorrect, status: 400 }
			],
			sent: 4
		});
		assert.ok(!JSON.stringify(outcomes).includes(KEY));
	} finally {
		await server.close();
	}
});

test('too many requests, an empty balance, a team without permission, and a refused argument are told apart, and each create is sent once', async () => {
	const replies: readonly [number, unknown][] = [
		[429, { code: 'Some resource has been exhausted', error: 'Too many requests: the rate limit of your team for grok-imagine-video-1.5 is 10 requests per second.' }],
		[403, { code: 'Some requested entity was not found', error: 'Your team has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.' }],
		[403, { code: 'permission_denied', error: 'Your API key does not have permission to use this model.' }],
		[400, { error: { code: 'invalid_argument', message: 'Unsupported aspect ratio.' } }]
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
			const failed = error(await providers.submit(generation(server.url, V15, 'frames', {})));
			outcomes.push([failed.code, failed.status, failed.message]);
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				['rateLimited', 429, 'Too many requests: the rate limit of your team for grok-imagine-video-1.5 is 10 requests per second. (Some resource has been exhausted) xAI takes 10 requests a second for each video model unless the team\'s limit was raised.'],
				['balance', 403, 'Your team has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit. (Some requested entity was not found)'],
				['auth', 403, 'Your API key does not have permission to use this model. (permission_denied)'],
				['rejected', 400, 'Unsupported aspect ratio. (invalid_argument)']
			],
			sent: replies.length
		});
	} finally {
		await server.close();
	}
});

test('a poll that is answered 429 is asked again, and answers once xAI does', async () => {
	let next = 0;
	const server = await startServer((request, response) => {
		next++;
		if (next === 1) {
			sendJson(response, 429, { error: 'Too many requests' }, { 'Retry-After': '1' });
			return;
		}
		sendJson(response, 202, { status: 'pending', progress: 64 });
	});
	try {
		const polled = value(await commands().poll(taskRef(server.url, 'request-1')));
		assert.deepEqual({ polled, sent: server.received.length }, { polled: { state: 'running', fraction: 0.64 }, sent: 2 });
	} finally {
		await server.close();
	}
});

// --- asking about a task ------------------------------------------------------------------------

test('asking about a task maps pending with and without progress, done, a withheld video, failed, and expired, and reads no other answer', async () => {
	const answers: Readonly<Record<string, readonly [number, unknown]>> = {
		'r-1': [202, { status: 'pending', progress: 0 }],
		'r-2': [202, { status: 'pending', progress: 42 }],
		'r-3': [202, ''],
		'r-4': [200, done('https://vidgen.x.ai/xai-vidgen-bucket/xai-video-r-4.mp4')],
		'r-5': [200, { status: 'failed', error: { code: 'invalid_argument', message: 'Prompt cannot be empty. Please provide a prompt.' } }],
		'r-6': [200, { status: 'expired' }],
		'r-7': [200, { status: 'done', video: { url: '', duration: 6, respect_moderation: false }, model: V15 }],
		'r-8': [200, { status: 'failed' }],
		'r-9': [200, { status: 'paused' }],
		'r-10': [200, { status: 'done', video: { duration: 6, respect_moderation: true }, model: V15 }],
		'r-11': [200, {}],
		'r-12': [202, { status: 'queued' }]
	};
	const server = await startServer((request, response) => {
		const id = decodeURIComponent(request.path.slice('/videos/'.length));
		const answer = answers[id];
		if (!answer) {
			sendJson(response, 404, { code: 'not-found', error: `No deferred video could be found with the given request_id: ${id}` });
			return;
		}
		const [status, body] = answer;
		if (body === '') {
			response.writeHead(status);
			response.end();
			return;
		}
		sendJson(response, status, body);
	});
	try {
		const providers = commands();
		const states = [];
		for (const id of ['r-1', 'r-2', 'r-3', 'r-4', 'r-5', 'r-6', 'r-7', 'r-8', 'r-12']) {
			states.push(value(await providers.poll(taskRef(server.url, id))));
		}
		const others = [];
		for (const id of ['r-9', 'r-10', 'r-11', 'r-13']) {
			const failed = error(await providers.poll(taskRef(server.url, id)));
			others.push([failed.code, failed.message]);
		}
		const first = server.received[0];
		assert.deepEqual({
			states,
			others,
			asked: { method: first.method, path: first.path, authorization: first.headers.authorization, body: first.body.byteLength }
		}, {
			states: [
				{ state: 'pending' },
				{ state: 'running', fraction: 0.42 },
				{ state: 'pending' },
				{ state: 'succeeded', videoUrl: 'https://vidgen.x.ai/xai-vidgen-bucket/xai-video-r-4.mp4' },
				{ state: 'failed', message: 'Prompt cannot be empty. Please provide a prompt. (invalid_argument)' },
				{ state: 'failed', message: 'xAI reports that the request expired before its video was ready.' },
				{ state: 'failed', message: 'xAI withheld the video because it did not pass moderation; xAI still charges for the generation.' },
				{ state: 'failed', message: 'xAI reports that the generation failed.' },
				// HTTP 202 says the generation still runs.
				{ state: 'pending' }
			],
			others: [
				['invalidResponse', 'xAI reports a status AI Video does not know: paused.'],
				['invalidResponse', 'xAI reports that the video is ready but gives no address AI Video can read.'],
				['invalidResponse', 'xAI reports a status AI Video does not know: none.'],
				['notFound', 'No deferred video could be found with the given request_id: r-13 (not-found)']
			],
			asked: { method: 'GET', path: '/videos/r-1', authorization: `Bearer ${KEY}`, body: 0 }
		});
	} finally {
		await server.close();
	}
});

test('the video downloads from the address the poll gave, without the key, and without an address from the task asked about again', async () => {
	const video = isoMedia(6);
	const host = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
		response.end(video);
	});
	const api = await startServer((request, response) => sendJson(response, 200, done(`${host.url}/xai-vidgen-bucket/xai-video-request-9.mp4`)));
	try {
		const providers = commands();
		const ref = taskRef(api.url, 'request-9');
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: polled.state === 'succeeded' ? polled.videoUrl : undefined, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		assert.deepEqual({
			withAddress,
			withoutAddress,
			same: [readFileSync(first).equals(video), readFileSync(second).equals(video)],
			asked: api.received.map(request => [request.path, request.headers.authorization]),
			downloaded: host.received.map(request => [request.path, request.headers.authorization])
		}, {
			withAddress: { size: video.byteLength, format: 'mp4' },
			withoutAddress: { size: video.byteLength, format: 'mp4' },
			same: [true, true],
			asked: [['/videos/request-9', `Bearer ${KEY}`], ['/videos/request-9', `Bearer ${KEY}`]],
			downloaded: [['/xai-vidgen-bucket/xai-video-request-9.mp4', undefined], ['/xai-vidgen-bucket/xai-video-request-9.mp4', undefined]]
		});
	} finally {
		await api.close();
		await host.close();
	}
});

test('xAI has no cancellation: cancel answers false and sends nothing', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, {}));
	try {
		const answer = value(await commands().cancel(taskRef(server.url, 'request-1')));
		assert.deepEqual({ answer, sent: server.received.length }, { answer: { cancelled: false }, sent: 0 });
	} finally {
		await server.close();
	}
});

// --- checks -------------------------------------------------------------------------------------

test('check reports the rules between settings and inputs that the declarations cannot express, and answers no provider model', async () => {
	const providers = commands();
	const answer = async (model: string, mode: ModeId, params: Record<string, unknown>, inputs: PlannedMedia, text = PROMPT) =>
		value(await providers.check({ provider: 'xai', region: 'global', model, mode, params, prompt: text, inputs }));
	const problems = async (model: string, mode: ModeId, params: Record<string, unknown>, inputs: PlannedMedia, text = PROMPT) =>
		(await answer(model, mode, params, inputs, text)).problems;
	assert.deepEqual({
		endFrameAt1080p: await problems(V15, 'frames', { resolution: '1080p' }, plannedFiles({ startFrame: true, endFrame: true })),
		endFrameAt720p: await problems(V15, 'frames', { resolution: '720p' }, plannedFiles({ startFrame: true, endFrame: true })),
		startFrameAt1080p: await problems(V15, 'frames', { resolution: '1080p' }, plannedFiles({ startFrame: true })),
		referencesAt1080p: await problems(V15, 'reference', { resolution: '1080p' }, plannedFiles({ images: 2 })),
		referencesWithoutPrompt: await problems(V15, 'reference', {}, plannedFiles({ images: 2 }), ''),
		fifteenReferences: await problems(V15, 'reference', {}, plannedFiles({ images: 15 })),
		noReference: await problems(V15, 'reference', {}, plannedFiles()),
		liteEndFrame: await problems(LITE, 'frames', {}, plannedFiles({ startFrame: true, endFrame: true })),
		liteReferences: await problems(LITE, 'reference', {}, plannedFiles({ images: 1 })),
		classicAt1080p: await problems(CLASSIC, 'frames', { resolution: '1080p' }, plannedFiles()),
		classicReferences11: await problems(CLASSIC, 'reference', { duration: 11 }, plannedFiles({ images: 3 })),
		classicReferences10: await problems(CLASSIC, 'reference', { duration: 10 }, plannedFiles({ images: 3 })),
		eightReferences: await problems(CLASSIC, 'reference', {}, plannedFiles({ images: 8 })),
		classicReferencesWithoutPrompt: await problems(CLASSIC, 'reference', {}, plannedFiles({ images: 1 }), ' '),
		editWithoutPrompt: await problems(CLASSIC, 'edit', {}, plannedFiles({ source: true }), ''),
		editWithDuration: await problems(CLASSIC, 'edit', { duration: 5 }, plannedFiles({ source: true })),
		editWithoutClip: await problems(CLASSIC, 'edit', {}, plannedFiles()),
		extendOneSecond: await problems(CLASSIC, 'extend', { duration: 1 }, plannedFiles({ source: true })),
		extendEleven: await problems(CLASSIC, 'extend', { duration: 11 }, plannedFiles({ source: true })),
		extendWithoutPrompt: await problems(CLASSIC, 'extend', {}, plannedFiles({ source: true }), ''),
		extendTen: await problems(CLASSIC, 'extend', { duration: 10 }, plannedFiles({ source: true })),
		textWithoutPrompt: await problems(CLASSIC, 'frames', {}, plannedFiles(), ''),
		startFrameWithoutPrompt: await problems(CLASSIC, 'frames', {}, plannedFiles({ startFrame: true }), ''),
		sameModelId: Object.hasOwn(await answer(V15, 'reference', {}, plannedFiles({ images: 1 })), 'providerModel')
	}, {
		endFrameAt1080p: ['Grok Imagine Video 1.5 makes a video from a start and an end frame at 480p or 720p.'],
		endFrameAt720p: [],
		startFrameAt1080p: [],
		referencesAt1080p: ['Grok Imagine Video 1.5 makes a video from reference images at 480p or 720p.'],
		referencesWithoutPrompt: [],
		fifteenReferences: ['Grok Imagine Video 1.5 in References mode takes at most 14 reference images; 15 are planned.'],
		noReference: ['Grok Imagine Video 1.5 in References mode needs at least 1 reference image.'],
		liteEndFrame: ['Grok Imagine Video 1.5 Lite in Frames mode takes no end frame.'],
		liteReferences: ['Grok Imagine Video 1.5 Lite has no reference mode.'],
		classicAt1080p: ['Resolution cannot be 1080p for Grok Imagine Video; choose 480p, 720p.'],
		classicReferences11: ['Grok Imagine Video makes a video from reference images of at most 10 seconds.'],
		classicReferences10: [],
		eightReferences: ['Grok Imagine Video in References mode takes at most 7 reference images; 8 are planned.'],
		classicReferencesWithoutPrompt: ['Write a prompt: Grok Imagine Video needs one in References mode.'],
		editWithoutPrompt: ['Write a prompt: Grok Imagine Video needs one in Edit mode.'],
		editWithDuration: ['Duration does not apply in Edit mode.'],
		editWithoutClip: ['Grok Imagine Video in Edit mode needs a video to work on.'],
		extendOneSecond: ['In Extend mode, Grok Imagine Video adds 2 to 10 seconds to the clip.'],
		extendEleven: ['In Extend mode, Grok Imagine Video adds 2 to 10 seconds to the clip.'],
		extendWithoutPrompt: ['Write a prompt: Grok Imagine Video needs one in Extend mode.'],
		extendTen: [],
		textWithoutPrompt: ['Write a prompt or connect an image: Grok Imagine Video needs one or the other.'],
		startFrameWithoutPrompt: [],
		sameModelId: false
	});
});

test('check refuses a MOV clip, clips of the wrong length, and a request larger than AI Video sends, and submit sends nothing then', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { request_id: 'request-1' }));
	try {
		const providers = commands();
		const withFiles = async (model: string, mode: ModeId, params: Record<string, unknown>, inputs: Inputs, checker = providers) =>
			value(await checker.check(generation(server.url, model, mode, params, inputs))).problems;
		// Every image measured as 100 MiB: as a data URL it is more than the 128 MiB AI Video sends; 90 MiB is not.
		const sized = (mebibytes: number) => commands({ inspector: () => ({ inspect: async () => ({ bytes: mebibytes * 1024 * 1024, format: 'png', width: 1920, height: 1080 }) }) });
		const outcomes = {
			mov: await withFiles(CLASSIC, 'edit', {}, { source: MOV }),
			longEdit: await withFiles(CLASSIC, 'edit', {}, { source: LONG_CLIP }),
			longExtend: await withFiles(CLASSIC, 'extend', {}, { source: LONG_CLIP }),
			mp4: await withFiles(CLASSIC, 'edit', {}, { source: CLIP }),
			large: await withFiles(V15, 'frames', {}, { startFrame: START }, sized(100)),
			largeEnough: await withFiles(V15, 'frames', {}, { startFrame: START }, sized(90)),
			submittedMov: error(await providers.submit(generation(server.url, CLASSIC, 'extend', {}, { source: MOV }))),
			submittedRule: error(await providers.submit(generation(server.url, V15, 'reference', { resolution: '1080p' }, { images: REFERENCES })))
		};
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: {
				mov: ['The source video clip.mov is not an MP4 video; xAI edits and extends MP4 videos only.'],
				longEdit: ['The source video long.mp4 is 9.5 seconds long; a video must be 0.1 to 8.7 seconds.'],
				longExtend: [],
				mp4: [],
				large: ['The inputs make a request of 133.3 MiB; AI Video sends at most 128 MiB. Use fewer or smaller inputs.'],
				largeEnough: [],
				submittedMov: { code: 'rejected', message: 'The source video clip.mov is not an MP4 video; xAI edits and extends MP4 videos only.' },
				submittedRule: { code: 'rejected', message: 'Grok Imagine Video 1.5 makes a video from reference images at 480p or 720p.' }
			},
			sent: 0
		});
	} finally {
		await server.close();
	}
});
