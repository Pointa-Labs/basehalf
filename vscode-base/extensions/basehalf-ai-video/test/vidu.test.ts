/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Vidu module (docs/specs/video-providers/vidu.md) through the provider
 * commands, against local servers that answer like Vidu. Nothing here talks to
 * Vidu.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../src/providers/commands.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { CatalogParameter, CatalogProvider } from '../src/providers/types.ts';
import { VIDU } from '../src/providers/vidu.ts';
import { error, gifHeader, isoMedia, mp3, plannedFiles, png, recordingSleep, sendJson, startServer, value, wav } from './providerTestKit.ts';

const KEY = 'vda-test-secret-42';
const MIB = 1024 * 1024;

const folder = mkdtempSync(join(tmpdir(), 'basehalf-vidu-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

function file(name: string, bytes: Buffer): string {
	const path = join(folder, name);
	writeFileSync(path, bytes);
	return path;
}

const START = file('start.png', png(640, 360));
const END = file('end.png', png(1280, 720));
const TALL = file('tall.png', png(360, 640));
const SQUARE = file('square.png', png(256, 256));
const SMALL = file('small.png', png(100, 100));
const MOVING = file('moving.gif', gifHeader(640, 360));
// 192 frames of 1152 samples at 44.1 kHz: 5.0 seconds.
const VOICE = file('voice.mp3', mp3(192));
const VOICE_WAV = file('voice.wav', wav(5));

const image = (fsPath: string) => ({ fsPath, mimeType: 'image/png' });
const audio = (fsPath: string) => ({ fsPath, mimeType: 'audio/mpeg' });
const dataUrl = (fsPath: string, type = 'image/png') => `data:${type};base64,${readFileSync(fsPath).toString('base64')}`;
const NO_MEDIA = { images: [], videos: [], audios: [] };

function commands(options: VideoProviderCommandOptions = {}): VideoProviderCommands {
	return new VideoProviderCommands([VIDU], { http: { sleep: async () => undefined }, ...options });
}

/** A request of `submit` to `endpoint`: Vidu Q3 Pro in China from text, unless `overrides` say otherwise. */
function generation(endpoint: string, overrides: Record<string, unknown> = {}) {
	return {
		provider: 'vidu',
		region: 'cn',
		endpoint,
		credentials: { apiKey: KEY },
		model: 'q3-pro',
		mode: 'frames',
		params: {},
		prompt: 'A lighthouse at dusk.',
		inputs: NO_MEDIA,
		...overrides
	};
}

/** A request of `check` without credentials: Vidu Q3 Pro in China from text, unless `overrides` say otherwise. */
function planned(overrides: Record<string, unknown> = {}) {
	return { provider: 'vidu', region: 'cn', model: 'q3-pro', mode: 'frames', params: {}, prompt: 'p', inputs: plannedFiles(), ...overrides };
}

function taskRef(endpoint: string, remoteId: string, region = 'intl') {
	return { provider: 'vidu', region, endpoint, credentials: { apiKey: KEY }, model: 'q3-pro', remoteId };
}

/** The options of a choice of a model, each as its value and its label. */
function optionLabels(provider: CatalogProvider, modelId: string, name: string): string[] | undefined {
	const parameter = provider.models.find(model => model.id === modelId)?.parameters.find(entry => entry.name === name);
	return parameter?.kind === 'choice' ? parameter.options.map(option => `${option.value} ${option.label}`) : undefined;
}

function describeParameter(parameter: CatalogParameter): string {
	const name = `${parameter.name}${parameter.modes ? `[${parameter.modes.join(',')}]` : ''}${parameter.optional ? '?' : ''}`;
	switch (parameter.kind) {
		case 'choice':
			return `${name}: ${parameter.options.map(option => option.value).join('|')} = ${parameter.default}`;
		case 'integer':
		case 'number':
			return `${name}: ${parameter.min}-${parameter.max}${parameter.default !== undefined ? ` = ${parameter.default}` : ''}`;
		case 'boolean':
			return `${name} = ${parameter.default}`;
		case 'text':
			return `${name}: text`;
	}
}

const FRAMES_ONLY = { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' };
const FRAME_LIMITS = { imageMaxBytes: 10 * MIB, imageAspect: [0.25, 4] };
const REFERENCE_IMAGE_LIMITS = { imageMinSide: 128, imageAspect: [0.25, 4] };
const RATIOS = '16:9|9:16|1:1|4:3|3:4';
const SEED = 'seed?: 0-2147483647';

test('Vidu is a shipped provider whose catalog lists the models, regions, modes, inputs, and parameters of its spec', () => {
	assert.ok(PROVIDER_MODULES.includes(VIDU));
	const provider = buildCatalog([VIDU]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'vidu',
		label: 'Vidu',
		regions: [
			{ id: 'cn', label: 'China', baseUrl: 'https://api.vidu.cn', console: 'https://platform.vidu.cn' },
			{ id: 'intl', label: 'International', baseUrl: 'https://api.vidu.com', console: 'https://platform.vidu.com' }
		],
		credentials: [{ id: 'apiKey', label: 'API Key' }]
	});
	const models = provider.models.map(model => ({
		id: model.id,
		label: model.label,
		providerModels: model.providerModels,
		prompt: model.prompt,
		modes: model.modes.map(mode => ({ id: mode.id, inputs: mode.inputs, limits: mode.limits })),
		parameters: model.parameters.map(describeParameter)
	}));
	const both = (id: string) => ({ cn: id, intl: id });
	assert.deepEqual(models, [
		{
			id: 'q3-pro',
			label: 'Vidu Q3 Pro',
			providerModels: both('viduq3-pro'),
			prompt: { required: 'withoutMedia', maxLength: 20000 },
			modes: [{ id: 'frames', inputs: { startFrame: 'optional', endFrame: 'optional', ...FRAMES_ONLY }, limits: FRAME_LIMITS }],
			parameters: ['resolution: 540p|720p|1080p = 720p', 'duration: 1-16 = 5', `ratio[frames]: ${RATIOS} = 16:9`, 'sound = true', SEED]
		},
		{
			id: 'q3-turbo',
			label: 'Vidu Q3 Turbo',
			providerModels: both('viduq3-turbo'),
			prompt: { required: 'withoutMedia', maxLength: 20000 },
			modes: [{ id: 'frames', inputs: { startFrame: 'optional', endFrame: 'optional', ...FRAMES_ONLY }, limits: FRAME_LIMITS }],
			parameters: ['resolution: 540p|720p|1080p = 720p', 'duration: 1-16 = 5', `ratio[frames]: ${RATIOS} = 16:9`, 'sound = true', SEED]
		},
		{
			id: 'q3-pro-fast',
			label: 'Vidu Q3 Pro Fast',
			providerModels: both('viduq3-pro-fast'),
			prompt: { required: 'withoutMedia', maxLength: 20000 },
			modes: [{ id: 'frames', inputs: { startFrame: 'required', endFrame: 'optional', ...FRAMES_ONLY }, limits: FRAME_LIMITS }],
			parameters: ['resolution: 720p|1080p = 720p', 'duration: 1-16 = 5', 'sound = true', SEED]
		},
		{
			id: 'q4-preview',
			label: 'Vidu Q4 Preview',
			providerModels: both('viduq4-preview'),
			prompt: { required: 'withoutMedia', maxLength: 20000 },
			modes: [
				{ id: 'frames', inputs: { startFrame: 'required', endFrame: 'none', ...FRAMES_ONLY }, limits: { imageMaxBytes: 50 * MIB } },
				{
					id: 'reference',
					inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max: 15 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 3 }, source: 'none' },
					limits: { imageMaxBytes: 50 * MIB, audioSeconds: [3, 12], audioMaxBytes: 50 * MIB }
				}
			],
			parameters: ['resolution: 540p|720p|1080p|2k|4k = 720p', 'duration: 3-16 = 5', `ratio[reference]: ${RATIOS} = 16:9`, 'sound = true', 'prompt_extend[frames] = false', SEED]
		},
		{
			id: 'q3',
			label: 'Vidu Q3',
			providerModels: both('viduq3'),
			prompt: { required: 'always', maxLength: 20000 },
			modes: [{ id: 'reference', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max: 7 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: REFERENCE_IMAGE_LIMITS }],
			parameters: ['resolution: 540p|720p|1080p = 720p', 'duration: 3-16 = 5', `ratio[reference]: ${RATIOS}|adaptive = 16:9`, 'sound = true', SEED]
		},
		{
			id: 'q3-mix',
			label: 'Vidu Q3 Mix',
			providerModels: both('viduq3-mix'),
			prompt: { required: 'always', maxLength: 20000 },
			modes: [{
				id: 'reference',
				inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max: 7 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 3 }, source: 'none' },
				limits: { ...REFERENCE_IMAGE_LIMITS, audioSeconds: [3, 12], audioMaxBytes: 20 * MIB }
			}],
			parameters: ['resolution: 720p|1080p = 720p', 'duration: 3-15 = 5', `ratio[reference]: ${RATIOS}|adaptive = 16:9`, SEED]
		},
		{
			id: 'q3-turbo-reference',
			label: 'Vidu Q3 Turbo References',
			providerModels: { cn: 'viduq3-turbo' },
			prompt: { required: 'always', maxLength: 5000 },
			modes: [{ id: 'reference', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max: 7 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: REFERENCE_IMAGE_LIMITS }],
			parameters: ['resolution: 540p|720p|1080p = 720p', 'duration: 3-15 = 5', `ratio[reference]: ${RATIOS}|adaptive = 16:9`, SEED]
		},
		{
			id: 'q2-pro',
			label: 'Vidu Q2 Pro',
			providerModels: both('viduq2-pro'),
			prompt: { required: 'withoutMedia', maxLength: 5000 },
			modes: [{ id: 'frames', inputs: { startFrame: 'required', endFrame: 'optional', ...FRAMES_ONLY }, limits: FRAME_LIMITS }],
			parameters: ['resolution: 540p|720p|1080p = 720p', 'duration: 1-10 = 5', 'sound = false', SEED]
		},
		{
			id: 'q2-turbo',
			label: 'Vidu Q2 Turbo',
			providerModels: both('viduq2-turbo'),
			prompt: { required: 'withoutMedia', maxLength: 5000 },
			modes: [{ id: 'frames', inputs: { startFrame: 'required', endFrame: 'optional', ...FRAMES_ONLY }, limits: FRAME_LIMITS }],
			parameters: ['resolution: 540p|720p|1080p = 720p', 'duration: 1-10 = 5', 'sound = false', SEED]
		}
	]);
	// The names and values every provider shares, with the labels Vidu writes.
	const names = new Set(provider.models.flatMap(model => model.parameters.map(parameter => parameter.name)));
	assert.deepEqual({
		names: [...names].sort(),
		q4Resolutions: optionLabels(provider, 'q4-preview', 'resolution'),
		q3Ratios: optionLabels(provider, 'q3', 'ratio')
	}, {
		names: ['duration', 'prompt_extend', 'ratio', 'resolution', 'seed', 'sound'],
		q4Resolutions: ['540p 540p', '720p 720p', '1080p 1080p', '2k 2K', '4k 4K'],
		q3Ratios: ['16:9 16:9', '9:16 9:16', '1:1 1:1', '4:3 4:3', '3:4 3:4', 'adaptive Adaptive']
	});
});

test('each model and mode creates its task once, at its path, with the Token header and the exact body', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { task_id: `task-${server.received.length}`, state: 'created', credits: 0 }));
	try {
		const prompt = 'A lighthouse at dusk.';
		const cases: { readonly name: string; readonly request: Record<string, unknown>; readonly path: string; readonly body: Record<string, unknown> }[] = [
			{
				name: 'Q3 Pro from text, with every setting, the ratio, and a seed',
				request: { params: { resolution: '1080p', duration: 8, ratio: '9:16', sound: false, seed: 42 } },
				path: '/ent/v2/text2video',
				body: { model: 'viduq3-pro', prompt, duration: 8, resolution: '1080p', aspect_ratio: '9:16', audio: false, seed: 42 }
			},
			{
				name: 'Q3 Turbo from a start frame without a prompt: no ratio, no prompt, the defaults',
				request: { region: 'intl', model: 'q3-turbo', prompt: '', inputs: { ...NO_MEDIA, startFrame: image(START) } },
				path: '/ent/v2/img2video',
				body: { model: 'viduq3-turbo', images: [dataUrl(START)], duration: 5, resolution: '720p', audio: true }
			},
			{
				name: 'Q3 Pro Fast from a start and an end frame',
				request: { model: 'q3-pro-fast', inputs: { ...NO_MEDIA, startFrame: image(START), endFrame: image(END) } },
				path: '/ent/v2/start-end2video',
				body: { model: 'viduq3-pro-fast', images: [dataUrl(START), dataUrl(END)], prompt, duration: 5, resolution: '720p', audio: true }
			},
			{
				name: 'Q4 Preview from a start frame sends Expand Prompt off',
				request: { region: 'intl', model: 'q4-preview', inputs: { ...NO_MEDIA, startFrame: image(START) } },
				path: '/ent/v2/img2video',
				body: { model: 'viduq4-preview', images: [dataUrl(START)], prompt, duration: 5, resolution: '720p', audio: true, is_rec: false }
			},
			{
				name: 'Q4 Preview from a start frame with Expand Prompt on, at 4K for 16 seconds',
				request: { model: 'q4-preview', params: { prompt_extend: true, resolution: '4k', duration: 16 }, inputs: { ...NO_MEDIA, startFrame: image(START) } },
				path: '/ent/v2/img2video',
				body: { model: 'viduq4-preview', images: [dataUrl(START)], prompt, duration: 16, resolution: '4K', audio: true, is_rec: true }
			},
			{
				name: 'Q4 Preview from reference images and audio',
				request: { model: 'q4-preview', mode: 'reference', params: { resolution: '2k', ratio: '1:1' }, inputs: { ...NO_MEDIA, images: [image(SQUARE), image(START)], audios: [audio(VOICE)] } },
				path: '/ent/v2/reference2video',
				body: { model: 'viduq4-preview', images: [dataUrl(SQUARE), dataUrl(START)], sounds: [dataUrl(VOICE, 'video/mp3')], prompt, duration: 5, resolution: '2K', aspect_ratio: '1:1', audio: true }
			},
			{
				name: 'Q3 from a reference image with the ratio Adaptive, sent as auto',
				request: { region: 'intl', model: 'q3', mode: 'reference', params: { ratio: 'adaptive', duration: 12 }, inputs: { ...NO_MEDIA, images: [image(SQUARE)] } },
				path: '/ent/v2/reference2video',
				body: { model: 'viduq3', images: [dataUrl(SQUARE)], prompt, duration: 12, resolution: '720p', aspect_ratio: 'auto', audio: true }
			},
			{
				name: 'Q3 Mix from reference images and audio in International, without a sound setting',
				request: { region: 'intl', model: 'q3-mix', mode: 'reference', params: { resolution: '1080p' }, inputs: { ...NO_MEDIA, images: [image(SQUARE), image(START)], audios: [audio(VOICE)] } },
				path: '/ent/v2/reference2video',
				body: { model: 'viduq3-mix', images: [dataUrl(SQUARE), dataUrl(START)], sounds: [dataUrl(VOICE, 'video/mp3')], prompt, duration: 5, resolution: '1080p', aspect_ratio: '16:9' }
			},
			{
				name: 'Q3 Turbo References in China sends viduq3-turbo',
				request: { model: 'q3-turbo-reference', mode: 'reference', inputs: { ...NO_MEDIA, images: [image(SQUARE)] } },
				path: '/ent/v2/reference2video',
				body: { model: 'viduq3-turbo', images: [dataUrl(SQUARE)], prompt, duration: 5, resolution: '720p', aspect_ratio: '16:9' }
			},
			{
				name: 'Q2 Pro from a start frame with sound',
				request: { model: 'q2-pro', params: { sound: true, duration: 4 }, inputs: { ...NO_MEDIA, startFrame: image(START) } },
				path: '/ent/v2/img2video',
				body: { model: 'viduq2-pro', images: [dataUrl(START)], prompt, duration: 4, resolution: '720p', audio: true }
			},
			{
				name: 'Q2 Turbo from a start and an end frame sends no sound field',
				request: { region: 'intl', model: 'q2-turbo', params: { resolution: '540p' }, inputs: { ...NO_MEDIA, startFrame: image(START), endFrame: image(END) } },
				path: '/ent/v2/start-end2video',
				body: { model: 'viduq2-turbo', images: [dataUrl(START), dataUrl(END)], prompt, duration: 5, resolution: '540p' }
			}
		];
		const providers = commands();
		const results = [];
		for (const entry of cases) {
			const answered = await providers.submit(generation(server.url, entry.request));
			const received = server.received.at(-1);
			results.push({
				name: entry.name,
				answered,
				method: received?.method,
				path: received?.path,
				authorization: received?.headers.authorization,
				contentType: received?.headers['content-type'],
				body: JSON.parse(received?.body.toString('utf8') ?? 'null')
			});
		}
		assert.deepEqual(results, cases.map((entry, index) => ({
			name: entry.name,
			answered: { ok: true, value: { remoteId: `task-${index + 1}` } },
			method: 'POST',
			path: entry.path,
			authorization: `Token ${KEY}`,
			contentType: 'application/json',
			body: entry.body
		})));
		assert.equal(server.received.length, cases.length);
	} finally {
		await server.close();
	}
});

test('the region\'s endpoint is an origin without a path; an endpoint with one, such as a relay\'s, gets Vidu\'s paths under it', async () => {
	const server = await startServer((request, response) => {
		if (request.method === 'POST') {
			sendJson(response, 200, { task_id: 't-relay', state: 'created' });
		} else {
			sendJson(response, 200, { id: 't-relay', state: 'processing' });
		}
	});
	try {
		const providers = commands();
		const endpoints = [server.url, `${server.url}/`, `${server.url}/relay/vidu`];
		for (const endpoint of endpoints) {
			value(await providers.submit(generation(endpoint)));
			value(await providers.poll(taskRef(endpoint, 't-relay')));
			value(await providers.cancel(taskRef(endpoint, 't-relay')));
		}
		assert.deepEqual(server.received.map(request => `${request.method} ${request.path}`), [
			'POST /ent/v2/text2video',
			'GET /ent/v2/tasks/t-relay/creations',
			'POST /ent/v2/tasks/t-relay/cancel',
			'POST /ent/v2/text2video',
			'GET /ent/v2/tasks/t-relay/creations',
			'POST /ent/v2/tasks/t-relay/cancel',
			'POST /relay/vidu/ent/v2/text2video',
			'GET /relay/vidu/ent/v2/tasks/t-relay/creations',
			'POST /relay/vidu/ent/v2/tasks/t-relay/cancel'
		]);
	} finally {
		await server.close();
	}
});

test('the task id of an accepted create: a string, a long number with every digit, or an unknown outcome without one', async () => {
	const server = await startServer((request, response) => {
		const prompt = JSON.parse(request.body.toString('utf8')).prompt;
		if (prompt === 'number') {
			const text = '{"task_id": 843187375766450176123, "state": "created"}';
			response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)) });
			response.end(text);
		} else if (prompt === 'none') {
			sendJson(response, 200, { state: 'created' });
		} else {
			sendJson(response, 200, { task_id: '843187375766450177', state: 'created' });
		}
	});
	try {
		const providers = commands();
		const text = await providers.submit(generation(server.url, { prompt: 'string' }));
		const number = await providers.submit(generation(server.url, { prompt: 'number' }));
		const none = error(await providers.submit(generation(server.url, { prompt: 'none' })));
		assert.deepEqual({ text, number, none, sent: server.received.length }, {
			text: { ok: true, value: { remoteId: '843187375766450177' } },
			number: { ok: true, value: { remoteId: '843187375766450176123' } },
			none: { code: 'unknownOutcome', message: 'Vidu accepted the request but gave no task id.' },
			sent: 3
		});
	} finally {
		await server.close();
	}
});

test('a poll follows a task through every state, with the progress Vidu gives, and reads failures and cancellations', async () => {
	const steps = [
		{ state: 'created' },
		{ state: 'queueing', progress: 0 },
		{ state: 'processing', progress: 40 },
		{ state: 'processing' },
		{ state: 'success', creations: [{ id: 'c-1', url: 'https://cdn.example.com/c-1.mp4', cover_url: 'https://cdn.example.com/c-1.jpg', watermarked_url: 'https://cdn.example.com/c-1-wm.mp4' }] }
	];
	const answers: Record<string, unknown> = {
		'failed': { state: 'failed', err_code: 'CreationPolicyViolation' },
		'cancelled': { state: 'failed', err_code: 'UserCancelled' },
		'shouting': { state: 'FAILED', err_code: '' },
		'new-code': { state: 'failed', err_code: 'SomethingNew' },
		'odd-code': { state: 'failed', err_code: 'constructor' },
		'scheduled': { state: 'scheduled', progress: 150 },
		'done-without-address': { state: 'success', creations: [] },
		'no-state': { id: 'no-state' }
	};
	const server = await startServer((request, response) => {
		const id = /^\/ent\/v2\/tasks\/([^/]+)\/creations$/.exec(request.path)?.[1] ?? '';
		if (id === 'steps') {
			sendJson(response, 200, { id, ...steps.shift() });
		} else if (answers[id]) {
			sendJson(response, 200, answers[id]);
		} else {
			sendJson(response, 404, { code: 404, reason: 'TaskNotFound', message: 'task not found' });
		}
	});
	try {
		const providers = commands();
		const poll = async (id: string) => providers.poll(taskRef(server.url, id));
		const sequence = [];
		for (let index = 0; index < 5; index++) {
			sequence.push(value(await poll('steps')));
		}
		const results = {
			sequence,
			failed: value(await poll('failed')),
			cancelled: value(await poll('cancelled')),
			shouting: value(await poll('shouting')),
			newCode: value(await poll('new-code')),
			oddCode: value(await poll('odd-code')),
			scheduled: value(await poll('scheduled')),
			doneWithoutAddress: value(await poll('done-without-address')),
			noState: error(await poll('no-state')),
			unknown: error(await poll('gone')),
			asked: [server.received[0].method, server.received[0].path, server.received[0].headers.authorization]
		};
		assert.deepEqual(results, {
			sequence: [
				{ state: 'pending' },
				{ state: 'pending', fraction: 0 },
				{ state: 'running', fraction: 0.4 },
				{ state: 'running' },
				{ state: 'succeeded', videoUrl: 'https://cdn.example.com/c-1.mp4' }
			],
			failed: { state: 'failed', message: 'Vidu\'s content review refused the video it made (CreationPolicyViolation). Vidu charges nothing for a video that fails.' },
			cancelled: { state: 'cancelled', message: 'The task was cancelled at Vidu (UserCancelled).' },
			shouting: { state: 'failed', message: 'Vidu could not make the video. Vidu charges nothing for a video that fails.' },
			newCode: { state: 'failed', message: 'Vidu could not make the video (SomethingNew). Vidu charges nothing for a video that fails.' },
			oddCode: { state: 'failed', message: 'Vidu could not make the video (constructor). Vidu charges nothing for a video that fails.' },
			scheduled: { state: 'running' },
			doneWithoutAddress: { state: 'succeeded' },
			noState: { code: 'invalidResponse', message: 'Vidu answered without the state of the task.' },
			unknown: { code: 'notFound', message: 'Vidu does not know this task (TaskNotFound).', status: 404 },
			asked: ['GET', '/ent/v2/tasks/steps/creations', `Token ${KEY}`]
		});
	} finally {
		await server.close();
	}
});

test('the video downloads from the creation\'s address without the key, also when the poll gave no address', async () => {
	const video = isoMedia(3);
	const storage = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
		response.end(video);
	});
	const api = await startServer((request, response) => sendJson(response, 200, {
		id: 't-9',
		state: 'success',
		credits: 100,
		creations: [{ id: 'c-9', url: `${storage.url}/creations/c-9.mp4`, cover_url: `${storage.url}/creations/c-9.jpg`, watermarked_url: `${storage.url}/creations/c-9-wm.mp4` }]
	}));
	try {
		const providers = commands();
		const ref = taskRef(api.url, 't-9');
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: (polled as { videoUrl: string }).videoUrl, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		assert.deepEqual({
			polled,
			withAddress,
			withoutAddress,
			same: [readFileSync(first).equals(video), readFileSync(second).equals(video)],
			storage: storage.received.map(request => [request.path, request.headers.authorization]),
			api: api.received.map(request => [request.path, request.headers.authorization])
		}, {
			polled: { state: 'succeeded', videoUrl: `${storage.url}/creations/c-9.mp4` },
			withAddress: { size: video.byteLength },
			withoutAddress: { size: video.byteLength },
			same: [true, true],
			storage: [['/creations/c-9.mp4', undefined], ['/creations/c-9.mp4', undefined]],
			api: [['/ent/v2/tasks/t-9/creations', `Token ${KEY}`], ['/ent/v2/tasks/t-9/creations', `Token ${KEY}`]]
		});
	} finally {
		await api.close();
		await storage.close();
	}
});

test('a cancellation is sent once and answers whether Vidu took it', async () => {
	const refusal = { code: 400, reason: 'BadRequest', message: 'task state is scheduled, can not cancel', metadata: { trace_id: '04e5c2fe159ff7c574acd0424e78c35f' } };
	const server = await startServer((request, response) => {
		const id = /^\/ent\/v2\/tasks\/([^/]+)\/cancel$/.exec(request.path)?.[1];
		if (id === 'queued') {
			sendJson(response, 200, {});
		} else if (id === 'scheduled') {
			sendJson(response, 400, refusal);
		} else if (id === 'scheduled-in-body') {
			sendJson(response, 200, refusal);
		} else {
			sendJson(response, 503, { code: 503, reason: 'InternalServiceFailure', message: 'busy' });
		}
	});
	try {
		const providers = commands();
		const results = {
			queued: value(await providers.cancel(taskRef(server.url, 'queued'))),
			scheduled: value(await providers.cancel(taskRef(server.url, 'scheduled'))),
			scheduledInBody: value(await providers.cancel(taskRef(server.url, 'scheduled-in-body'))),
			busy: error(await providers.cancel(taskRef(server.url, 'busy'))).code,
			sent: server.received.map(request => [request.method, request.path, request.headers.authorization, JSON.parse(request.body.toString('utf8'))])
		};
		assert.deepEqual(results, {
			queued: { cancelled: true },
			scheduled: { cancelled: false },
			scheduledInBody: { cancelled: false },
			busy: 'network',
			sent: ['queued', 'scheduled', 'scheduled-in-body', 'busy'].map(id => ['POST', `/ent/v2/tasks/${id}/cancel`, `Token ${KEY}`, { id }])
		});
	} finally {
		await server.close();
	}
});

test('a refused key, too many tasks, and too few credits answer the contract\'s codes in Vidu\'s terms, and a create is never sent again', async () => {
	const answers: Record<string, [number, unknown]> = {
		key: [401, { code: 401, reason: 'Unauthorized', message: `unauthorized token ${KEY}` }],
		busy: [429, { code: 429, reason: 'QuotaExceeded', message: 'quota exceeded' }],
		credits: [400, { code: 400, reason: 'CreditInsufficient', message: 'insufficient credits' }],
		field: [400, { code: 400, reason: 'FieldInvalid', message: 'invalid field: duration' }],
		echo: [400, { code: 400, reason: 'BadRequest', message: `bad request for token ${KEY}` }],
		refusedWithOk: [200, { code: 400, reason: 'TaskPromptPolicyViolation', message: 'prompt policy violation' }],
		server: [500, { code: 500, reason: 'InternalServiceFailure', message: 'internal service failure' }]
	};
	const server = await startServer((request, response) => {
		if (request.method === 'GET') {
			sendJson(response, 429, { code: 429, reason: 'TooManyRequests', message: 'too many requests' });
			return;
		}
		const [status, body] = answers[JSON.parse(request.body.toString('utf8')).prompt];
		sendJson(response, status, body);
	});
	try {
		const sleep = recordingSleep();
		const providers = commands({ http: { sleep: sleep.sleep } });
		const submitted: Record<string, unknown> = {};
		for (const prompt of Object.keys(answers)) {
			submitted[prompt] = error(await providers.submit(generation(server.url, { prompt })));
		}
		const creates = server.received.length;
		const polled = error(await providers.poll(taskRef(server.url, 't-1')));
		assert.deepEqual({ submitted, creates, polled, polls: server.received.length - creates, waits: sleep.waits }, {
			submitted: {
				key: { code: 'auth', message: 'Vidu did not accept the API key (Unauthorized). Check it in Video Providers.', status: 401 },
				busy: { code: 'rateLimited', message: 'Too many tasks of this Vidu account run at once (QuotaExceeded). Vidu runs up to 5 tasks at a time for an organization.', status: 429 },
				credits: { code: 'balance', message: 'The Vidu account has too few credits for this generation (CreditInsufficient).', status: 400 },
				field: { code: 'rejected', message: 'Vidu refused the request: invalid field: duration (FieldInvalid).', status: 400 },
				echo: { code: 'rejected', message: 'Vidu refused the request: bad request for token *** (BadRequest).', status: 400 },
				refusedWithOk: { code: 'rejected', message: 'Vidu\'s content review refused the prompt (TaskPromptPolicyViolation).' },
				server: { code: 'unknownOutcome', message: 'Vidu had an internal error (InternalServiceFailure).', status: 500 }
			},
			creates: 7,
			polled: { code: 'rateLimited', message: 'Vidu received too many requests in a short time (TooManyRequests).', status: 429 },
			polls: 4,
			waits: [1000, 2000, 4000]
		});
	} finally {
		await server.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome and is not sent again', async () => {
	const server = await startServer((request, response, socket) => socket.destroy());
	try {
		const failed = error(await commands().submit(generation(server.url, { model: 'q3-turbo', inputs: { ...NO_MEDIA, startFrame: image(START) } })));
		assert.equal(failed.code, 'unknownOutcome');
		assert.match(failed.message, /^The connection ended after the request was sent/);
		assert.equal(server.received.length, 1);
	} finally {
		await server.close();
	}
});

test('check adds Vidu\'s own rules to the declarations\' checks, and submit then sends nothing', async () => {
	const providers = commands();
	const problems = async (overrides: Record<string, unknown>) => {
		const answered = value(await providers.check(planned(overrides)));
		return answered.problems;
	};
	const large: MediaInspector = { inspect: async () => ({ bytes: 9 * MIB, format: 'png', width: 1920, height: 1080 }) };
	const tooLarge = value(await commands({ inspector: () => large }).check(planned({
		model: 'q3',
		mode: 'reference',
		inputs: { ...NO_MEDIA, images: ['a.png', 'b.png', 'c.png'].map(name => image(join(folder, name))) }
	}))).problems;
	const shapes = 'The start and end frames differ too much in shape: the start frame\'s aspect ratio is 3.16 times the end frame\'s; Vidu takes 0.8 to 1.25 times.';
	const results = {
		shapes: await problems({ inputs: { ...NO_MEDIA, startFrame: image(START), endFrame: image(TALL) } }),
		sameShape: await problems({ inputs: { ...NO_MEDIA, startFrame: image(START), endFrame: image(END) } }),
		gif: await problems({ model: 'q3-turbo', inputs: { ...NO_MEDIA, startFrame: image(MOVING) } }),
		wav: await problems({ model: 'q4-preview', mode: 'reference', inputs: { ...NO_MEDIA, images: [image(SQUARE)], audios: [audio(VOICE_WAV)] } }),
		mixAudioInChina: await problems({ model: 'q3-mix', mode: 'reference', inputs: { ...NO_MEDIA, images: [image(SQUARE)], audios: [audio(VOICE)] } }),
		mixAudioInInternational: await problems({ region: 'intl', model: 'q3-mix', mode: 'reference', inputs: { ...NO_MEDIA, images: [image(SQUARE)], audios: [audio(VOICE)] } }),
		textInInternational: await problems({ region: 'intl', model: 'q3-turbo', prompt: 'x'.repeat(6000) }),
		textInChina: await problems({ model: 'q3-turbo', prompt: 'x'.repeat(6000) }),
		q2StartFrame: await problems({ model: 'q2-pro', prompt: 'x'.repeat(2500), inputs: plannedFiles({ startFrame: true }) }),
		q2StartAndEndFrames: await problems({ model: 'q2-pro', prompt: 'x'.repeat(2500), inputs: plannedFiles({ startFrame: true, endFrame: true }) }),
		q2SoundWithEndFrame: await problems({ model: 'q2-turbo', params: { sound: true }, inputs: plannedFiles({ startFrame: true, endFrame: true }) }),
		referencesWithoutPrompt: await problems({ model: 'q4-preview', mode: 'reference', prompt: '', inputs: plannedFiles({ images: 1 }) }),
		referencesWithoutPromptOrImage: await problems({ model: 'q4-preview', mode: 'reference', prompt: '' }),
		smallReference: await problems({ model: 'q3', mode: 'reference', inputs: { ...NO_MEDIA, images: [image(SMALL)] } }),
		turboReferencesInInternational: await problems({ region: 'intl', model: 'q3-turbo-reference', mode: 'reference', inputs: plannedFiles({ images: 1 }) }),
		tooLarge
	};
	assert.deepEqual(results, {
		shapes: [shapes],
		sameShape: [],
		gif: ['The start frame moving.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.'],
		wav: ['Reference audio 1 voice.wav is a WAV file; Vidu takes MP3 audio only.'],
		mixAudioInChina: ['Vidu Q3 Mix takes reference audio only in International.'],
		mixAudioInInternational: [],
		textInInternational: ['The prompt is 6000 characters long; Vidu Q3 Turbo takes at most 5000 from text alone in International.'],
		textInChina: [],
		q2StartFrame: ['The prompt is 2500 characters long; Vidu Q2 Pro takes at most 2000 with a start frame alone.'],
		q2StartAndEndFrames: [],
		q2SoundWithEndFrame: ['Vidu Q2 Turbo makes sound only from a start frame alone; turn off Sound to use an end frame.'],
		referencesWithoutPrompt: ['Write a prompt: Vidu Q4 Preview needs one in References mode.'],
		referencesWithoutPromptOrImage: ['Vidu Q4 Preview in References mode needs at least 1 reference image.', 'Write a prompt or connect an image: Vidu Q4 Preview needs one or the other.'],
		smallReference: ['Reference image 1 small.png is 100 × 100 px; each side must be at least 128 px.'],
		turboReferencesInInternational: ['Vidu does not offer Vidu Q3 Turbo References in International.'],
		tooLarge: ['The request with its inputs would be 36.0 MiB; Vidu takes at most 20 MiB. Use fewer or smaller inputs.']
	});
	const server = await startServer((request, response) => sendJson(response, 200, { task_id: 'never', state: 'created' }));
	try {
		const refused = error(await providers.submit(generation(server.url, { inputs: { ...NO_MEDIA, startFrame: image(START), endFrame: image(TALL) } })));
		assert.deepEqual({ refused, sent: server.received.length }, { refused: { code: 'rejected', message: shapes }, sent: 0 });
	} finally {
		await server.close();
	}
});
