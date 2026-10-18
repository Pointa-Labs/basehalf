/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Kling module (docs/specs/video-providers/kling.md) through the provider
 * commands, against a local server that answers like Kling's new API. No test
 * calls Kling or uses a real key.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import { klingModule } from '../src/providers/kling.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { CatalogModel, Estimate } from '../src/providers/types.ts';
import { error, gifHeader, isoMedia, jpegHeader, png, sendJson, startServer, value, webpHeader, type Received } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-kling-'));
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
	file('three.png', png(600, 300), 'image/png')
];
const WEBP = file('frame.webp', webpHeader('VP8X', 640, 360), 'image/webp');
const GIF = file('moving.gif', gifHeader(640, 360), 'image/gif');

const KEY = 'kling-test-key-0001';
const PROMPT = 'A paper boat drifts down a rainy street.';
const PRICE_DATE = '2026-10-19';

function base64(media: FileMedia): string {
	return readFileSync(media.fsPath).toString('base64');
}

function commands(options: { readonly inspector?: () => MediaInspector } = {}): VideoProviderCommands {
	return new VideoProviderCommands([klingModule], { http: { sleep: async () => undefined }, ...options });
}

interface Inputs {
	readonly startFrame?: FileMedia;
	readonly endFrame?: FileMedia;
	readonly images?: readonly FileMedia[];
}

function generation(endpoint: string, model: string, mode: 'frames' | 'reference', params: Record<string, unknown>, inputs: Inputs = {}, prompt = PROMPT, region = 'intl') {
	return {
		provider: 'kling',
		region,
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
			audios: []
		}
	};
}

function taskRef(endpoint: string, remoteId: string) {
	return { provider: 'kling', region: 'cn', endpoint, credentials: { apiKey: KEY }, model: 'kling-3.0', remoteId };
}

function counts(planned: { readonly startFrame?: boolean; readonly endFrame?: boolean; readonly images?: number } = {}) {
	return { startFrame: false, endFrame: false, images: 0, videos: 0, audios: 0, source: false, ...planned };
}

/** Kling's answer to a create. */
function created(id: string) {
	return { code: 0, message: 'SUCCEED', request_id: `request-${id}`, data: { id, status: 'submitted', create_time: 1781080778802, update_time: 1781080778802 } };
}

function sentBody(request: Received): unknown {
	return JSON.parse(request.body.toString('utf8'));
}

const prompt = { type: 'prompt', text: PROMPT };
const firstFrame = () => ({ type: 'first_frame', url: base64(START) });
const lastFrame = () => ({ type: 'last_frame', url: base64(END) });
const referImage = (media: FileMedia) => ({ type: 'refer_image', url: base64(media) });

// --- the catalog --------------------------------------------------------------------------------

test('the catalog declares Kling with two regions, one API key, and six models with their modes, limits, and settings', () => {
	const provider = buildCatalog([klingModule]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'kling',
		label: 'Kling',
		regions: [
			{ id: 'cn', label: 'China', baseUrl: 'https://api-beijing.klingai.com', currency: 'CNY', console: 'https://klingai.com/dev/api-key' },
			{ id: 'intl', label: 'International', baseUrl: 'https://api-singapore.klingai.com', currency: 'USD', console: 'https://kling.ai/dev/api-key' }
		],
		credentials: [{ id: 'apiKey', label: 'API Key' }]
	});

	const frames = (endFrame: string) => ['frames', 'Frames', 'optional', endFrame, 0, 0];
	const references = ['reference', 'References', 'none', 'none', 1, 7];
	const sentAs = (id: string) => ({ cn: id, intl: id });
	assert.deepEqual(provider.models.map(model => ({
		id: model.id,
		label: model.label,
		sentAs: model.providerModels,
		prompt: model.prompt,
		modes: model.modes.map(mode => [mode.id, mode.label, mode.inputs.startFrame, mode.inputs.endFrame, mode.inputs.images.min, mode.inputs.images.max]),
		estimate: model.estimate,
		deprecated: model.deprecated
	})), [
		{ id: 'kling-3.0-turbo', label: 'Kling 3.0 Turbo', sentAs: sentAs('kling-3.0-turbo'), prompt: { required: 'withoutMedia', maxLength: 3072 }, modes: [frames('none')], estimate: true, deprecated: undefined },
		{ id: 'kling-3.0', label: 'Kling 3.0', sentAs: sentAs('kling-3.0'), prompt: { required: 'withoutMedia', maxLength: 3072 }, modes: [frames('optional')], estimate: true, deprecated: undefined },
		{ id: 'kling-3.0-omni', label: 'Kling 3.0 Omni', sentAs: sentAs('kling-3.0-omni'), prompt: { required: 'withoutMedia', maxLength: 3072 }, modes: [frames('optional'), references], estimate: true, deprecated: undefined },
		{ id: 'kling-o1', label: 'Kling O1', sentAs: sentAs('kling-o1'), prompt: { required: 'withoutMedia', maxLength: 2500 }, modes: [frames('optional'), references], estimate: true, deprecated: undefined },
		{ id: 'kling-2.6', label: 'Kling 2.6', sentAs: sentAs('kling-2.6'), prompt: { required: 'withoutMedia', maxLength: 2500 }, modes: [frames('optional')], estimate: true, deprecated: undefined },
		{ id: 'kling-2.5-turbo', label: 'Kling 2.5 Turbo', sentAs: sentAs('kling-2.5-turbo'), prompt: { required: 'withoutMedia', maxLength: 2500 }, modes: [frames('optional')], estimate: true, deprecated: undefined }
	]);

	// Every mode takes images only, within Kling's limits.
	for (const model of provider.models) {
		for (const mode of model.modes) {
			assert.deepEqual({ videos: mode.inputs.videos, audios: mode.inputs.audios, source: mode.inputs.source, limits: mode.limits }, {
				videos: { min: 0, max: 0 },
				audios: { min: 0, max: 0 },
				source: 'none',
				limits: { imageMinSide: 300, imageAspect: [0.4, 2.5], imageMaxBytes: 50 * 1024 * 1024 }
			}, `${model.id} ${mode.id}`);
		}
	}

	const settings = (model: CatalogModel) => model.parameters.map(parameter => {
		switch (parameter.kind) {
			case 'choice': return [parameter.name, parameter.label, parameter.options.map(option => option.value), parameter.default];
			case 'integer': return [parameter.name, parameter.label, parameter.min, parameter.max, parameter.step, parameter.unit, parameter.default];
			default: return [parameter.name, parameter.label, parameter.kind, parameter.default];
		}
	});
	const ratio = ['ratio', 'Ratio', ['16:9', '9:16', '1:1'], '16:9'];
	const sound = ['generate_audio', 'Sound', 'boolean', false];
	assert.deepEqual(Object.fromEntries(provider.models.map(model => [model.id, settings(model)])), {
		'kling-3.0-turbo': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 3, 15, 1, 'seconds', 5]],
		'kling-3.0': [['resolution', 'Resolution', ['720p', '1080p', '4k'], '720p'], ratio, ['duration', 'Duration', 3, 15, 1, 'seconds', 5], sound],
		'kling-3.0-omni': [['resolution', 'Resolution', ['720p', '1080p', '4k'], '720p'], ratio, ['duration', 'Duration', 3, 15, 1, 'seconds', 5], sound],
		'kling-o1': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 3, 10, 1, 'seconds', 5]],
		'kling-2.6': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 5, 10, 5, 'seconds', 5], sound],
		'kling-2.5-turbo': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 5, 10, 5, 'seconds', 5]]
	});
	const parameters = provider.models.flatMap(model => model.parameters);
	assert.ok(parameters.every(parameter => !parameter.advanced && !parameter.optional && !parameter.modes));
	assert.ok(parameters.filter(parameter => parameter.name === 'ratio').every(parameter => parameter.kind === 'choice' && parameter.display === 'ratio'));
	assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'kling'), 'AI Video ships the Kling module');
});

// --- creating a task ----------------------------------------------------------------------------

test('each mode of each model is created once, at its path, with the exact body Kling documents', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, created(`task-${server.received.length}`)));
	try {
		const cases: readonly { model: string; mode: 'frames' | 'reference'; params: Record<string, unknown>; inputs?: Inputs; prompt?: string; region?: string; path: string; body: () => unknown }[] = [
			{
				model: 'kling-3.0-turbo', mode: 'frames', params: { resolution: '1080p', ratio: '9:16', duration: 12 },
				path: '/text-to-video/kling-3.0-turbo',
				body: () => ({ prompt: PROMPT, settings: { resolution: '1080p', aspect_ratio: '9:16', duration: 12 } })
			},
			{
				// A start frame without a prompt sends no prompt item, and no ratio: the video takes the frame's shape.
				model: 'kling-3.0-turbo', mode: 'frames', params: { ratio: '1:1' }, inputs: { startFrame: START }, prompt: '  ', region: 'cn',
				path: '/image-to-video/kling-3.0-turbo',
				body: () => ({ contents: [firstFrame()], settings: { resolution: '720p', duration: 5 } })
			},
			{
				model: 'kling-3.0', mode: 'frames', params: {}, region: 'cn',
				path: '/text-to-video/kling-3.0',
				body: () => ({ prompt: PROMPT, settings: { resolution: '720p', aspect_ratio: '16:9', duration: 5, audio: 'off' } })
			},
			{
				model: 'kling-3.0', mode: 'frames', params: { resolution: '4k', duration: 15, generate_audio: true }, inputs: { startFrame: START, endFrame: END },
				path: '/image-to-video/kling-3.0',
				body: () => ({ contents: [prompt, firstFrame(), lastFrame()], settings: { resolution: '4k', duration: 15, audio: 'native' } })
			},
			{
				model: 'kling-3.0-omni', mode: 'frames', params: { ratio: '1:1', generate_audio: true },
				path: '/omni-video/kling-3.0-omni',
				body: () => ({ contents: [prompt], settings: { resolution: '720p', aspect_ratio: '1:1', duration: 5, audio: 'native' } })
			},
			{
				model: 'kling-3.0-omni', mode: 'frames', params: { resolution: '1080p', duration: 8 }, inputs: { startFrame: START, endFrame: END },
				path: '/omni-video/kling-3.0-omni',
				body: () => ({ contents: [prompt, firstFrame(), lastFrame()], settings: { resolution: '1080p', duration: 8, audio: 'off' } })
			},
			{
				model: 'kling-3.0-omni', mode: 'reference', params: { resolution: '4k', ratio: '9:16', duration: 15 }, inputs: { images: REFERENCES },
				path: '/omni-video/kling-3.0-omni',
				body: () => ({ contents: [prompt, ...REFERENCES.map(referImage)], settings: { resolution: '4k', aspect_ratio: '9:16', duration: 15, audio: 'off' } })
			},
			{
				model: 'kling-o1', mode: 'frames', params: { resolution: '1080p', duration: 10 }, inputs: { startFrame: START },
				path: '/omni-video/kling-o1',
				body: () => ({ contents: [prompt, firstFrame()], settings: { resolution: '1080p', duration: 10 } })
			},
			{
				model: 'kling-o1', mode: 'reference', params: { ratio: '1:1', duration: 3 }, inputs: { images: REFERENCES.slice(0, 2) }, prompt: '',
				path: '/omni-video/kling-o1',
				body: () => ({ contents: REFERENCES.slice(0, 2).map(referImage), settings: { resolution: '720p', aspect_ratio: '1:1', duration: 3 } })
			},
			{
				model: 'kling-2.6', mode: 'frames', params: { resolution: '1080p', duration: 10, generate_audio: true },
				path: '/text-to-video/kling-2.6',
				body: () => ({ prompt: PROMPT, settings: { resolution: '1080p', aspect_ratio: '16:9', duration: 10, audio: 'native' } })
			},
			{
				model: 'kling-2.6', mode: 'frames', params: { resolution: '1080p' }, inputs: { startFrame: START, endFrame: END },
				path: '/image-to-video/kling-2.6',
				body: () => ({ contents: [prompt, firstFrame(), lastFrame()], settings: { resolution: '1080p', duration: 5, audio: 'off' } })
			},
			{
				model: 'kling-2.5-turbo', mode: 'frames', params: { ratio: '9:16', duration: 10 },
				path: '/text-to-video/kling-2.5-turbo',
				body: () => ({ prompt: PROMPT, settings: { resolution: '720p', aspect_ratio: '9:16', duration: 10 } })
			},
			{
				model: 'kling-2.5-turbo', mode: 'frames', params: { resolution: '1080p' }, inputs: { startFrame: START, endFrame: END },
				path: '/image-to-video/kling-2.5-turbo',
				body: () => ({ contents: [prompt, firstFrame(), lastFrame()], settings: { resolution: '1080p', duration: 5 } })
			}
		];
		const providers = commands();
		const outcomes = [];
		for (const entry of cases) {
			const before = server.received.length;
			const answer = await providers.submit(generation(server.url, entry.model, entry.mode, entry.params, entry.inputs, entry.prompt, entry.region));
			outcomes.push({
				model: entry.model,
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
			answer: { ok: true, value: { remoteId: `task-${index + 1}` } },
			sent: [{ method: 'POST', path: entry.path, authorization: `Bearer ${KEY}`, type: 'application/json', body: entry.body() }]
		})));
	} finally {
		await server.close();
	}
});

test('an endpoint with a path, such as a relay that mirrors Kling\'s API, keeps its path for creating and asking', async () => {
	const server = await startServer((request, response) => request.method === 'POST'
		? sendJson(response, 200, created('task-1'))
		: sendJson(response, 200, { code: 0, message: 'SUCCEED', data: [{ id: 'task-1', status: 'processing' }] }));
	try {
		const providers = commands();
		const endpoint = `${server.url}/relay/kling/`;
		const submitted = value(await providers.submit(generation(endpoint, 'kling-2.6', 'frames', {})));
		const polled = value(await providers.poll(taskRef(endpoint, 'task-1')));
		assert.deepEqual({ submitted, polled, sent: server.received.map(request => [request.method, request.path, request.headers.authorization]) }, {
			submitted: { remoteId: 'task-1' },
			polled: { state: 'running' },
			sent: [
				['POST', '/relay/kling/text-to-video/kling-2.6', `Bearer ${KEY}`],
				['GET', '/relay/kling/tasks?task_ids=task-1', `Bearer ${KEY}`]
			]
		});
	} finally {
		await server.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome, and it was sent once', async () => {
	const server = await startServer((request, response, socket) => socket.destroy());
	try {
		const failed = error(await commands().submit(generation(server.url, 'kling-3.0-omni', 'reference', {}, { images: REFERENCES })));
		assert.deepEqual({ code: failed.code, sent: server.received.length }, { code: 'unknownOutcome', sent: 1 });
	} finally {
		await server.close();
	}
});

// --- errors -------------------------------------------------------------------------------------

test('a refused key answers auth for a create and for a poll, and no message carries the key', async () => {
	const server = await startServer((request, response) => sendJson(response, 401, { code: 1000, message: 'Authentication failed', request_id: 'request-1' }));
	try {
		const providers = commands();
		const submitted = error(await providers.submit(generation(server.url, 'kling-3.0', 'frames', {})));
		const polled = error(await providers.poll(taskRef(server.url, 'task-1')));
		const message = 'Kling refused the API key. Check it in Video Providers. (1000: Authentication failed)';
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

test('each code of a 429 answers as Kling means it, and each create is sent once', async () => {
	const answers: Readonly<Record<number, string>> = {
		1100: 'account exception',
		1101: 'account arrears',
		1102: 'resource pack exhausted',
		1302: 'rate limit exceeded',
		1303: 'parallel task over resource pack limit',
		1304: 'ip whitelist'
	};
	const codes = Object.keys(answers).map(Number);
	let next = 0;
	const server = await startServer((request, response) => {
		const code = codes[next++];
		sendJson(response, 429, { code, message: answers[code], request_id: `request-${code}` });
	});
	try {
		const providers = commands();
		const outcomes: Record<number, unknown> = {};
		for (const code of codes) {
			const failed = error(await providers.submit(generation(server.url, 'kling-2.6', 'frames', {})));
			outcomes[code] = [failed.code, failed.status, failed.message];
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: {
				1100: ['rejected', 429, 'The Kling account is in an abnormal state. Check it in the Kling console. (1100: account exception)'],
				1101: ['balance', 429, 'The Kling account is in arrears. Add funds in the Kling console. (1101: account arrears)'],
				1102: ['balance', 429, 'The Kling resource package is used up or has expired. Buy more in the Kling console. (1102: resource pack exhausted)'],
				1302: ['rateLimited', 429, 'Kling received too many requests from this account. Wait a moment. (1302: rate limit exceeded)'],
				1303: ['rateLimited', 429, 'Kling is already running as many tasks at once as the resource package allows. Wait for one to finish. (1303: parallel task over resource pack limit)'],
				1304: ['rejected', 429, 'Kling\'s IP allow list for the account refused this computer. (1304: ip whitelist)']
			},
			sent: codes.length
		});
	} finally {
		await server.close();
	}
});

test('other answers: refusals make no task, Kling\'s own errors and answers without a task id leave the outcome unknown', async () => {
	const replies: readonly [number, unknown][] = [
		[403, { code: 1103, message: 'no permission for this model' }],
		[400, { code: 1301, message: 'risk control' }],
		[404, { code: 1203, message: 'model not found' }],
		[500, { code: 5000, message: 'internal error' }],
		[200, { code: 1303, message: 'parallel task over resource pack limit' }],
		[200, { code: 5001, message: 'maintenance' }],
		[200, { code: 0, message: 'SUCCEED', data: { status: 'submitted' } }],
		[200, { code: 0, message: 'SUCCEED', data: { id: 'task-7', status: 'submitted' } }]
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
			const answer = await providers.submit(generation(server.url, 'kling-3.0-turbo', 'frames', {}));
			outcomes.push(answer.ok ? answer.value : [answer.error.code, answer.error.status]);
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				['rejected', 403],
				['rejected', 400],
				['rejected', 404],
				['unknownOutcome', 500],
				['rateLimited', undefined],
				['unknownOutcome', undefined],
				['unknownOutcome', undefined],
				{ remoteId: 'task-7' }
			],
			sent: replies.length
		});
	} finally {
		await server.close();
	}
});

// --- asking about a task ------------------------------------------------------------------------

test('asking about a task maps submitted, processing, succeeded, and failed, and reads no other answer', async () => {
	const tasks: Readonly<Record<string, unknown>> = {
		't-1': { id: 't-1', status: 'submitted', message: '', create_time: 1, update_time: 1, outputs: [] },
		't-2': { id: 't-2', status: 'processing', message: '', create_time: 1, update_time: 2, outputs: [] },
		't-3': {
			id: 't-3',
			status: 'succeeded',
			message: '',
			outputs: [
				{ type: 'image', url: 'https://p1-kling.klingai.com/kcdn/cover.png' },
				{ type: 'video', id: 'video-1', url: 'https://p1-kling.klingai.com/kcdn/t-3.mp4', watermark_url: 'https://p1-kling.klingai.com/kcdn/t-3-watermark.mp4', duration: '5' }
			],
			billing: [{ charge_type: 'unit', amount: '4', package_type: 'video' }]
		},
		't-4': { id: 't-4', status: 'failed', message: 'Failure to pass the risk control system', outputs: [] },
		't-5': { id: 't-5', status: 'paused' },
		't-6': { id: 't-6', status: 'succeeded', outputs: [] }
	};
	const server = await startServer((request, response) => {
		const id = new URL(request.path, 'http://localhost').searchParams.get('task_ids') ?? '';
		if (id === 't-8') {
			sendJson(response, 404, { code: 1203, message: 'task not found' });
			return;
		}
		sendJson(response, 200, { code: 0, message: 'SUCCEED', request_id: 'request-1', data: tasks[id] ? [tasks[id]] : [] });
	});
	try {
		const providers = commands();
		const states = [];
		for (const id of ['t-1', 't-2', 't-3', 't-4']) {
			states.push(value(await providers.poll(taskRef(server.url, id))));
		}
		const others = [];
		for (const id of ['t-5', 't-6', 't-7', 't-8']) {
			others.push(error(await providers.poll(taskRef(server.url, id))).code);
		}
		const first = server.received[0];
		assert.deepEqual({
			states,
			others,
			asked: { method: first.method, path: first.path, authorization: first.headers.authorization, type: first.headers['content-type'] }
		}, {
			states: [
				{ state: 'pending' },
				{ state: 'running' },
				{ state: 'succeeded', videoUrl: 'https://p1-kling.klingai.com/kcdn/t-3.mp4' },
				{ state: 'failed', message: 'Failure to pass the risk control system' }
			],
			others: ['invalidResponse', 'invalidResponse', 'notFound', 'notFound'],
			asked: { method: 'GET', path: '/tasks?task_ids=t-1', authorization: `Bearer ${KEY}`, type: 'application/json' }
		});
	} finally {
		await server.close();
	}
});

test('the video downloads from the address the poll gave, and without an address from the task asked about again', async () => {
	const video = isoMedia(5);
	const server = await startServer((request, response) => {
		if (request.path.startsWith('/kcdn/')) {
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
			response.end(video);
			return;
		}
		sendJson(response, 200, {
			code: 0,
			message: 'SUCCEED',
			data: [{ id: 'task-9', status: 'succeeded', outputs: [{ type: 'video', url: `${server.url}/kcdn/task-9.mp4`, watermark_url: `${server.url}/kcdn/task-9-watermark.mp4` }] }]
		});
	});
	try {
		const providers = commands();
		const ref = taskRef(server.url, 'task-9');
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: polled.state === 'succeeded' ? polled.videoUrl : undefined, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		assert.deepEqual({
			withAddress,
			withoutAddress,
			same: [readFileSync(first).equals(video), readFileSync(second).equals(video)],
			paths: server.received.map(request => request.path)
		}, {
			withAddress: { size: video.byteLength },
			withoutAddress: { size: video.byteLength },
			same: [true, true],
			paths: ['/tasks?task_ids=task-9', '/kcdn/task-9.mp4', '/tasks?task_ids=task-9', '/kcdn/task-9.mp4']
		});
	} finally {
		await server.close();
	}
});

test('Kling has no cancellation: cancel answers false and sends nothing', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { code: 0 }));
	try {
		const answer = value(await commands().cancel(taskRef(server.url, 'task-1')));
		assert.deepEqual({ answer, sent: server.received.length }, { answer: { cancelled: false }, sent: 0 });
	} finally {
		await server.close();
	}
});

// --- checks -------------------------------------------------------------------------------------

test('check reports the rules between settings and inputs that the declarations cannot express', async () => {
	const providers = commands();
	const problems = async (model: string, mode: 'frames' | 'reference', params: Record<string, unknown>, inputs: ReturnType<typeof counts>, text = PROMPT) =>
		value(await providers.check({ provider: 'kling', region: 'cn', model, mode, params, prompt: text, inputs })).problems;
	const long = 'a'.repeat(2501);
	assert.deepEqual({
		soundAt720p: await problems('kling-2.6', 'frames', { generate_audio: true }, counts()),
		soundAt1080p: await problems('kling-2.6', 'frames', { generate_audio: true, resolution: '1080p' }, counts()),
		endFrameAt720p: await problems('kling-2.6', 'frames', {}, counts({ startFrame: true, endFrame: true })),
		endFrameWithSound: await problems('kling-2.6', 'frames', { resolution: '1080p', generate_audio: true }, counts({ startFrame: true, endFrame: true })),
		turboEndFrameAt720p: await problems('kling-2.5-turbo', 'frames', {}, counts({ startFrame: true, endFrame: true })),
		turboEndFrameAt1080p: await problems('kling-2.5-turbo', 'frames', { resolution: '1080p' }, counts({ startFrame: true, endFrame: true })),
		o1FramesSeven: await problems('kling-o1', 'frames', { duration: 7 }, counts({ startFrame: true })),
		o1FramesFromText: await problems('kling-o1', 'frames', { duration: 3 }, counts()),
		o1ReferencesSeven: await problems('kling-o1', 'reference', { duration: 7 }, counts({ images: 2 })),
		turboLongPromptWithFrame: await problems('kling-3.0-turbo', 'frames', {}, counts({ startFrame: true }), long),
		turboLongPromptFromText: await problems('kling-3.0-turbo', 'frames', {}, counts(), long),
		turboEndFrame: await problems('kling-3.0-turbo', 'frames', {}, counts({ startFrame: true, endFrame: true })),
		eightReferences: await problems('kling-3.0-omni', 'reference', {}, counts({ images: 8 })),
		o1At4k: await problems('kling-o1', 'frames', { resolution: '4k' }, counts())
	}, {
		soundAt720p: ['Kling 2.6 makes sound only at 1080p.'],
		soundAt1080p: [],
		endFrameAt720p: ['Kling 2.6 makes a video from start and end frames only at 1080p.'],
		endFrameWithSound: ['Kling 2.6 makes a video from start and end frames only without sound.'],
		turboEndFrameAt720p: ['Kling 2.5 Turbo makes a video from start and end frames only at 1080p.'],
		turboEndFrameAt1080p: [],
		o1FramesSeven: ['Kling O1 makes videos of 5 or 10 seconds in Frames mode.'],
		o1FramesFromText: ['Kling O1 makes videos of 5 or 10 seconds in Frames mode.'],
		o1ReferencesSeven: [],
		turboLongPromptWithFrame: ['The prompt is 2501 characters long; with a start frame, Kling 3.0 Turbo takes at most 2500.'],
		turboLongPromptFromText: [],
		turboEndFrame: ['Kling 3.0 Turbo in Frames mode takes no end frame.'],
		eightReferences: ['Kling 3.0 Omni in References mode takes at most 7 reference images; 8 are planned.'],
		o1At4k: ['Resolution cannot be 4k for Kling O1; choose 720p, 1080p.']
	});
});

test('with files, check refuses WebP and GIF images and a request larger than AI Video sends, and submit sends nothing then', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, created('task-1')));
	try {
		const providers = commands();
		const withFiles = async (model: string, mode: 'frames' | 'reference', inputs: Inputs, checker = providers) =>
			value(await checker.check(generation(server.url, model, mode, {}, inputs))).problems;
		// Every image measured as 50 MiB, the most Kling takes: two of them as base64 are more than 128 MiB.
		const large = commands({ inspector: () => ({ inspect: async () => ({ bytes: 50 * 1024 * 1024, format: 'png', width: 1920, height: 1080 }) }) });
		const outcomes = {
			webp: await withFiles('kling-3.0', 'frames', { startFrame: WEBP }),
			gif: await withFiles('kling-o1', 'reference', { images: [REFERENCES[0], GIF] }),
			jpegAndPng: await withFiles('kling-3.0', 'frames', { startFrame: START, endFrame: END }),
			oneLarge: await withFiles('kling-3.0', 'frames', { startFrame: START }, large),
			twoLarge: await withFiles('kling-3.0', 'frames', { startFrame: START, endFrame: END }, large),
			submitted: error(await providers.submit(generation(server.url, 'kling-3.0', 'frames', {}, { startFrame: WEBP }))),
			ruleSubmitted: error(await providers.submit(generation(server.url, 'kling-2.6', 'frames', { generate_audio: true })))
		};
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: {
				webp: ['The start frame frame.webp is a WebP image; Kling takes JPEG and PNG images only.'],
				gif: ['Reference image 2 moving.gif is a GIF image; Kling takes JPEG and PNG images only.'],
				jpegAndPng: [],
				oneLarge: [],
				twoLarge: ['The images make a request of 133.3 MiB; AI Video sends at most 128 MiB. Use fewer or smaller images.'],
				submitted: { code: 'rejected', message: 'The start frame frame.webp is a WebP image; Kling takes JPEG and PNG images only.' },
				ruleSubmitted: { code: 'rejected', message: 'Kling 2.6 makes sound only at 1080p.' }
			},
			sent: 0
		});
	} finally {
		await server.close();
	}
});

// --- estimates ----------------------------------------------------------------------------------

test('estimates follow the price list: three combinations in each region', async () => {
	const providers = commands();
	const estimate = async (region: string, model: string, mode: 'frames' | 'reference', params: Record<string, unknown>, inputs = counts()) =>
		value(await providers.check({ provider: 'kling', region, model, mode, params, prompt: PROMPT, inputs })).estimate;
	const amount = (currency: 'CNY' | 'USD', money: number): Estimate => ({ currency, min: money, max: money, priceDate: PRICE_DATE });
	assert.deepEqual({
		// China, 1 unit = ¥1. Kling 3.0 at 1080p with sound: 1.2 units/s × 10 s × ¥1 = ¥12.
		cnSound: await estimate('cn', 'kling-3.0', 'frames', { resolution: '1080p', duration: 10, generate_audio: true }),
		// Kling 2.5 Turbo with its defaults, 720p and 5 s: 0.3 units/s × 5 s × ¥1 = ¥1.50.
		cnDefaults: await estimate('cn', 'kling-2.5-turbo', 'frames', {}),
		// Kling 3.0 Omni from two references at 4K with sound: 3.0 units/s × 15 s × ¥1 = ¥45.
		cn4k: await estimate('cn', 'kling-3.0-omni', 'reference', { resolution: '4k', duration: 15, generate_audio: true }, counts({ images: 2 })),
		// International, 1 unit = $0.14. Kling 3.0 Turbo at 1080p, always with sound: 1.0 unit/s × 7 s × $0.14 = $0.98.
		intlTurbo: await estimate('intl', 'kling-3.0-turbo', 'frames', { resolution: '1080p', duration: 7 }),
		// Kling O1 from three references at 720p: 0.6 units/s × 3 s × $0.14 = $0.252.
		intlO1: await estimate('intl', 'kling-o1', 'reference', { duration: 3 }, counts({ images: 3 })),
		// Kling 2.6 at 1080p with sound: 1.0 unit/s × 10 s × $0.14 = $1.40.
		intlSound: await estimate('intl', 'kling-2.6', 'frames', { resolution: '1080p', duration: 10, generate_audio: true }),
		// Kling 2.6 has no price for sound at 720p, which a rule refuses.
		noPrice: await estimate('cn', 'kling-2.6', 'frames', { generate_audio: true })
	}, {
		cnSound: amount('CNY', 12),
		cnDefaults: amount('CNY', 1.5),
		cn4k: amount('CNY', 45),
		intlTurbo: amount('USD', 0.98),
		intlO1: amount('USD', 0.252),
		intlSound: amount('USD', 1.4),
		noPrice: undefined
	});
});

test('every price of the list is its units at ¥1 in China and its listed dollars internationally', async () => {
	// pricing/base/video as read on 2026-10-19: the settings, the units per second, and the dollars per second of the international page.
	const rows: readonly [string, Record<string, unknown>, number, number][] = [
		['kling-3.0-turbo', { resolution: '720p' }, 0.8, 0.112],
		['kling-3.0-turbo', { resolution: '1080p' }, 1.0, 0.14],
		['kling-3.0', { resolution: '720p' }, 0.6, 0.084],
		['kling-3.0', { resolution: '1080p' }, 0.8, 0.112],
		['kling-3.0', { resolution: '4k' }, 3.0, 0.42],
		['kling-3.0', { resolution: '720p', generate_audio: true }, 0.9, 0.126],
		['kling-3.0', { resolution: '1080p', generate_audio: true }, 1.2, 0.168],
		['kling-3.0', { resolution: '4k', generate_audio: true }, 3.0, 0.42],
		['kling-3.0-omni', { resolution: '720p' }, 0.6, 0.084],
		['kling-3.0-omni', { resolution: '1080p' }, 0.8, 0.112],
		['kling-3.0-omni', { resolution: '4k' }, 3.0, 0.42],
		['kling-3.0-omni', { resolution: '720p', generate_audio: true }, 0.8, 0.112],
		['kling-3.0-omni', { resolution: '1080p', generate_audio: true }, 1.0, 0.14],
		['kling-3.0-omni', { resolution: '4k', generate_audio: true }, 3.0, 0.42],
		['kling-o1', { resolution: '720p' }, 0.6, 0.084],
		['kling-o1', { resolution: '1080p' }, 0.8, 0.112],
		['kling-2.6', { resolution: '720p' }, 0.3, 0.042],
		['kling-2.6', { resolution: '1080p' }, 0.5, 0.07],
		['kling-2.6', { resolution: '1080p', generate_audio: true }, 1.0, 0.14],
		['kling-2.5-turbo', { resolution: '720p' }, 0.3, 0.042],
		['kling-2.5-turbo', { resolution: '1080p' }, 0.5, 0.07]
	];
	const providers = commands();
	const tenSeconds = async (region: string, model: string, params: Record<string, unknown>) =>
		value(await providers.check({ provider: 'kling', region, model, mode: 'frames', params: { ...params, duration: 10 }, prompt: PROMPT, inputs: counts() })).estimate;
	const round = (money: number) => Math.round(money * 1e6) / 1e6;
	for (const [model, params, units, dollars] of rows) {
		assert.deepEqual(
			[await tenSeconds('cn', model, params), await tenSeconds('intl', model, params)],
			[
				{ currency: 'CNY', min: round(units * 10), max: round(units * 10), priceDate: PRICE_DATE },
				{ currency: 'USD', min: round(dollars * 10), max: round(dollars * 10), priceDate: PRICE_DATE }
			],
			`${model} ${JSON.stringify(params)}`
		);
	}
});
