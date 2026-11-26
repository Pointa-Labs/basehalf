/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Kling module (docs/specs/providers/kling.md) through the provider
 * commands, against a local server that answers like Kling's new API for
 * videos and its earlier API for images. No test calls Kling or uses a real
 * key.
 */

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { KLING } from '../../node/kling.js';
import type { MediaInspector } from '../../node/media.js';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import type { CatalogModel, CatalogParameter, PlannedMedia } from '../../common/basehalfProviderTypes.js';
import { error, gifHeader, isoMedia, jpegHeader, partTargets, plannedFiles, png, routed, sendJson, serveFiles, startServer, tinyPng, value, webpHeader, type Received } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: kling', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const folder = mkdtempSync(join(tmpdir(), 'basehalf-kling-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

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

	function base64(media: FileMedia): string {
		return readFileSync(media.fsPath).toString('base64');
	}

	function commands(options: { readonly inspector?: () => MediaInspector } = {}): VideoProviderCommands {
		return new VideoProviderCommands([KLING], { http: { sleep: async () => undefined }, ...options });
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

	/** Kling's answer to a create. */
	function created(id: string) {
		return { code: 0, message: 'SUCCEED', request_id: `request-${id}`, data: { id, status: 'submitted', create_time: 1781080778802, update_time: 1781080778802 } };
	}

	function sentBody(request: Received): unknown {
		return JSON.parse(request.body.toString('utf8'));
	}

	const prompt = { type: 'prompt', text: PROMPT };
	// An omni model's items carry the ids its prompt names them by (D74).
	const withId = (id: string | undefined) => id ? { id } : {};
	const firstFrame = (id?: string) => ({ type: 'first_frame', url: base64(START), ...withId(id) });
	const lastFrame = (id?: string) => ({ type: 'last_frame', url: base64(END), ...withId(id) });
	const referImage = (media: FileMedia, id?: string) => ({ type: 'refer_image', url: base64(media), ...withId(id) });

	// --- the catalog --------------------------------------------------------------------------------

	test('the catalog declares Kling with two regions, one API key, and six models with their modes, limits, and settings', () => {
		const provider = buildCatalog([KLING]).providers[0];
		assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
			id: 'kling',
			label: 'Kling',
			regions: [
				{ id: 'cn', label: 'China', baseUrl: 'https://api-beijing.klingai.com', console: 'https://klingai.com/dev/api-key' },
				{ id: 'intl', label: 'International', baseUrl: 'https://api-singapore.klingai.com', console: 'https://kling.ai/dev/api-key' }
			],
			credentials: [{ id: 'apiKey', label: 'API Key' }]
		});

		const frames = (endFrame: string) => ['frames', 'Frames', 'optional', endFrame, 0, 0];
		const references = ['reference', 'References', 'none', 'none', 1, 7];
		const sentAs = (id: string) => ({ cn: id, intl: id });
		const videoModels = provider.models.filter(model => model.kind === 'video');
		assert.deepEqual(videoModels.map(model => ({
			id: model.id,
			label: model.label,
			sentAs: model.providerModels,
			prompt: model.prompt,
			modes: model.modes.map(mode => [mode.id, mode.label, mode.inputs.startFrame, mode.inputs.endFrame, mode.inputs.images.min, mode.inputs.images.max]),
			deprecated: model.deprecated
		})), [
			{ id: 'kling-3.0-turbo', label: 'Kling 3.0 Turbo', sentAs: sentAs('kling-3.0-turbo'), prompt: { required: 'withoutMedia', maxLength: 3072 }, modes: [frames('none')], deprecated: undefined },
			{ id: 'kling-3.0', label: 'Kling 3.0', sentAs: sentAs('kling-3.0'), prompt: { required: 'withoutMedia', maxLength: 3072 }, modes: [frames('optional')], deprecated: undefined },
			{ id: 'kling-3.0-omni', label: 'Kling 3.0 Omni', sentAs: sentAs('kling-3.0-omni'), prompt: { required: 'withoutMedia', maxLength: 3072 }, modes: [frames('optional'), references], deprecated: undefined },
			{ id: 'kling-o1', label: 'Kling O1', sentAs: sentAs('kling-o1'), prompt: { required: 'withoutMedia', maxLength: 2500 }, modes: [frames('optional'), references], deprecated: undefined },
			{ id: 'kling-2.6', label: 'Kling 2.6', sentAs: sentAs('kling-2.6'), prompt: { required: 'withoutMedia', maxLength: 2500 }, modes: [frames('optional')], deprecated: undefined },
			{ id: 'kling-2.5-turbo', label: 'Kling 2.5 Turbo', sentAs: sentAs('kling-2.5-turbo'), prompt: { required: 'withoutMedia', maxLength: 2500 }, modes: [frames('optional')], deprecated: undefined }
		]);

		// Every mode takes images only, within Kling's limits.
		for (const model of videoModels) {
			for (const mode of model.modes) {
				assert.deepEqual({ videos: mode.inputs.videos, audios: mode.inputs.audios, source: mode.inputs.source, limits: mode.limits }, {
					videos: { min: 0, max: 0 },
					audios: { min: 0, max: 0 },
					source: 'none',
					limits: { imageFormats: ['png', 'jpeg'], imageMinSide: 300, imageAspect: [0.4, 2.5], imageMaxBytes: 50 * 1024 * 1024 }
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
		const sound = ['sound', 'Sound', 'boolean', false];
		assert.deepEqual(Object.fromEntries(videoModels.map(model => [model.id, settings(model)])), {
			'kling-3.0-turbo': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 3, 15, 1, 'seconds', 5]],
			'kling-3.0': [['resolution', 'Resolution', ['720p', '1080p', '4k'], '720p'], ratio, ['duration', 'Duration', 3, 15, 1, 'seconds', 5], sound],
			'kling-3.0-omni': [['resolution', 'Resolution', ['720p', '1080p', '4k'], '720p'], ratio, ['duration', 'Duration', 3, 15, 1, 'seconds', 5], sound],
			'kling-o1': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 3, 10, 1, 'seconds', 5]],
			'kling-2.6': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 5, 10, 5, 'seconds', 5], sound],
			'kling-2.5-turbo': [['resolution', 'Resolution', ['720p', '1080p'], '720p'], ratio, ['duration', 'Duration', 5, 10, 5, 'seconds', 5]]
		});
		const parameters = videoModels.flatMap(model => model.parameters);
		assert.ok(parameters.every(parameter => !parameter.advanced && !parameter.optional && !parameter.modes));
		assert.ok(parameters.filter(parameter => parameter.name === 'ratio').every(parameter => parameter.kind === 'choice' && parameter.display === 'ratio'));
		assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'kling'), 'BaseHalf ships the Kling module');
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
					model: 'kling-3.0', mode: 'frames', params: { resolution: '4k', duration: 15, sound: true }, inputs: { startFrame: START, endFrame: END },
					path: '/image-to-video/kling-3.0',
					body: () => ({ contents: [prompt, firstFrame(), lastFrame()], settings: { resolution: '4k', duration: 15, audio: 'native' } })
				},
				{
					model: 'kling-3.0-omni', mode: 'frames', params: { ratio: '1:1', sound: true },
					path: '/omni-video/kling-3.0-omni',
					body: () => ({ contents: [prompt], settings: { resolution: '720p', aspect_ratio: '1:1', duration: 5, audio: 'native' } })
				},
				{
					model: 'kling-3.0-omni', mode: 'frames', params: { resolution: '1080p', duration: 8 }, inputs: { startFrame: START, endFrame: END },
					path: '/omni-video/kling-3.0-omni',
					body: () => ({ contents: [prompt, firstFrame('image_1'), lastFrame('image_2')], settings: { resolution: '1080p', duration: 8, audio: 'off' } })
				},
				{
					model: 'kling-3.0-omni', mode: 'reference', params: { resolution: '4k', ratio: '9:16', duration: 15 }, inputs: { images: REFERENCES },
					path: '/omni-video/kling-3.0-omni',
					body: () => ({ contents: [prompt, ...REFERENCES.map((media, index) => referImage(media, `image_${index + 1}`))], settings: { resolution: '4k', aspect_ratio: '9:16', duration: 15, audio: 'off' } })
				},
				{
					model: 'kling-o1', mode: 'frames', params: { resolution: '1080p', duration: 10 }, inputs: { startFrame: START },
					path: '/omni-video/kling-o1',
					body: () => ({ contents: [prompt, firstFrame('image_1')], settings: { resolution: '1080p', duration: 10 } })
				},
				{
					model: 'kling-o1', mode: 'reference', params: { ratio: '1:1', duration: 3 }, inputs: { images: REFERENCES.slice(0, 2) }, prompt: '',
					path: '/omni-video/kling-o1',
					body: () => ({ contents: REFERENCES.slice(0, 2).map((media, index) => referImage(media, `image_${index + 1}`)), settings: { resolution: '720p', aspect_ratio: '1:1', duration: 3 } })
				},
				{
					model: 'kling-2.6', mode: 'frames', params: { resolution: '1080p', duration: 10, sound: true },
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
			const message = 'Kling refused the API key. Check it in Providers. (1000: Authentication failed)';
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
				withAddress: { size: video.byteLength, format: 'mp4' },
				withoutAddress: { size: video.byteLength, format: 'mp4' },
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
		const problems = async (model: string, mode: 'frames' | 'reference', params: Record<string, unknown>, inputs: PlannedMedia, text = PROMPT) =>
			value(await providers.check({ provider: 'kling', region: 'cn', model, mode, params, prompt: text, inputs })).problems;
		const long = 'a'.repeat(2501);
		assert.deepEqual({
			soundAt720p: await problems('kling-2.6', 'frames', { sound: true }, plannedFiles()),
			soundAt1080p: await problems('kling-2.6', 'frames', { sound: true, resolution: '1080p' }, plannedFiles()),
			endFrameAt720p: await problems('kling-2.6', 'frames', {}, plannedFiles({ startFrame: true, endFrame: true })),
			endFrameWithSound: await problems('kling-2.6', 'frames', { resolution: '1080p', sound: true }, plannedFiles({ startFrame: true, endFrame: true })),
			turboEndFrameAt720p: await problems('kling-2.5-turbo', 'frames', {}, plannedFiles({ startFrame: true, endFrame: true })),
			turboEndFrameAt1080p: await problems('kling-2.5-turbo', 'frames', { resolution: '1080p' }, plannedFiles({ startFrame: true, endFrame: true })),
			o1FramesSeven: await problems('kling-o1', 'frames', { duration: 7 }, plannedFiles({ startFrame: true })),
			o1FramesFromText: await problems('kling-o1', 'frames', { duration: 3 }, plannedFiles()),
			o1ReferencesSeven: await problems('kling-o1', 'reference', { duration: 7 }, plannedFiles({ images: 2 })),
			turboLongPromptWithFrame: await problems('kling-3.0-turbo', 'frames', {}, plannedFiles({ startFrame: true }), long),
			turboLongPromptFromText: await problems('kling-3.0-turbo', 'frames', {}, plannedFiles(), long),
			turboEndFrame: await problems('kling-3.0-turbo', 'frames', {}, plannedFiles({ startFrame: true, endFrame: true })),
			eightReferences: await problems('kling-3.0-omni', 'reference', {}, plannedFiles({ images: 8 })),
			o1At4k: await problems('kling-o1', 'frames', { resolution: '4k' }, plannedFiles())
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

	test('check refuses WebP and GIF images and a request larger than BaseHalf sends, and submit sends nothing then', async () => {
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
				ruleSubmitted: error(await providers.submit(generation(server.url, 'kling-2.6', 'frames', { sound: true })))
			};
			assert.deepEqual({ outcomes, sent: server.received.length }, {
				outcomes: {
					webp: ['The start frame frame.webp is a WebP image; this mode takes PNG or JPEG images.'],
					gif: ['Reference image 2 moving.gif is a GIF image; this mode takes PNG or JPEG images.'],
					jpegAndPng: [],
					oneLarge: [],
					twoLarge: ['The images make a request of 133.3 MiB; BaseHalf sends at most 128 MiB. Use fewer or smaller images.'],
					submitted: { code: 'rejected', message: 'The start frame frame.webp is a WebP image; this mode takes PNG or JPEG images.' },
					ruleSubmitted: { code: 'rejected', message: 'Kling 2.6 makes sound only at 1080p.' }
				},
				sent: 0
			});
		} finally {
			await server.close();
		}
	});

	// --- image models -------------------------------------------------------------------------------

	const MiB = 1024 * 1024;
	const IMAGE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];

	/** A request of an image model in References mode. */
	function imageGeneration(endpoint: string, model: string, params: Record<string, unknown>, images: readonly FileMedia[] = [], prompt = PROMPT, region = 'intl') {
		return generation(endpoint, model, 'reference', params, { images }, prompt, region);
	}

	function imageTaskRef(endpoint: string, model: string, remoteId: string) {
		return { provider: 'kling', region: 'intl', endpoint, credentials: { apiKey: KEY }, model, remoteId };
	}

	/** Kling's answer to an image create on its earlier API. */
	function imageCreated(taskId: string) {
		return { code: 0, message: 'SUCCEED', request_id: `request-${taskId}`, data: { task_id: taskId, task_status: 'submitted', task_info: { external_task_id: '' }, created_at: 1781080778802, updated_at: 1781080778802 } };
	}

	/** A parameter in one line: its name, whether it is optional and under More, its values, its default, and its tooltip. */
	function describeImageParameter(parameter: CatalogParameter): string {
		const name = `${parameter.name}${parameter.optional ? '?' : ''}${parameter.advanced ? ' (More)' : ''}`;
		const tooltip = parameter.tooltip ? ` (${parameter.tooltip})` : '';
		switch (parameter.kind) {
			case 'choice':
				return `${name}: ${parameter.options.map(option => `${option.value}=${option.label}`).join(' ')} = ${parameter.default}${tooltip}`;
			case 'integer':
			case 'number':
				return `${name}: ${parameter.min}-${parameter.max} = ${parameter.default}${tooltip}`;
			case 'boolean':
				return `${name} = ${parameter.default}${tooltip}`;
			case 'text':
				return `${name}: text ${parameter.maxLength}${tooltip}`;
			case 'voice':
				return `${name}: voice ${parameter.options.map(option => option.value).join(' ')} = ${parameter.default}${tooltip}`;
		}
	}

	test('the image models follow the video models: PNG, as tasks of Kling\'s earlier API, with their references, limits, and settings', () => {
		const provider = buildCatalog([KLING]).providers[0];
		assert.deepEqual(provider.models.map(model => model.kind), [...Array(6).fill('video'), ...Array(3).fill('image')]);
		const ratios = (adaptive: boolean) => [...IMAGE_RATIOS.map(ratio => `${ratio}=${ratio}`), ...(adaptive ? ['adaptive=Adaptive'] : [])].join(' ');
		const references = (max: number) => ({ startFrame: 'none', endFrame: 'none', images: { min: 0, max }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' });
		const limits = { imageFormats: ['png', 'jpeg'], imageMinSide: 300, imageAspect: [0.4, 2.5], imageMaxBytes: 10 * MiB };
		const entry = (id: string, label: string, sentAs: string, max: number, parameters: string[]) => ({
			id,
			label,
			sentAs: { cn: sentAs, intl: sentAs },
			prompt: { required: 'always', maxLength: 2500 },
			outputFormat: 'png',
			answersAtOnce: undefined,
			modes: [{ id: 'reference', label: 'References', inputs: references(max), limits }],
			parameters
		});
		assert.deepEqual(provider.models.filter(model => model.kind === 'image').map(model => ({
			id: model.id,
			label: model.label,
			sentAs: model.providerModels,
			prompt: model.prompt,
			outputFormat: model.outputFormat,
			answersAtOnce: model.answersAtOnce,
			modes: model.modes.map(mode => ({ id: mode.id, label: mode.label, inputs: mode.inputs, limits: mode.limits })),
			parameters: model.parameters.map(describeImageParameter)
		})), [
			entry('kling-image-3.0-omni', 'Kling Image 3.0 Omni', 'kling-v3-omni', 10, [
				`ratio: ${ratios(true)} = 16:9 (The shape of the image. Adaptive lets Kling choose it from the reference images, and needs one.)`,
				'resolution: 1k=1K 2k=2K 4k=4K = 1k',
				'count: 1-9 = 1'
			]),
			entry('kling-image-3.0', 'Kling Image 3.0', 'kling-v3', 1, [
				`ratio: ${ratios(false)} = 16:9`,
				'resolution: 1k=1K 2k=2K = 1k',
				'count: 1-9 = 1',
				'negative_prompt? (More): text 2500 (What the image should not show. Kling takes it only when no reference image is connected.)'
			]),
			entry('kling-image-o1', 'Kling Image O1', 'kling-image-o1', 10, [
				`ratio: ${ratios(true)} = adaptive (The shape of the image. Adaptive lets Kling choose it from the prompt and the reference images.)`,
				'resolution: 1k=1K 2k=2K = 1k',
				'count: 1-9 = 1'
			])
		]);
	});

	test('each image model creates its task once at its call, with the key and the body Kling documents, its references as plain base64', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, imageCreated(`image-${server.received.length}`)));
		try {
			const cases: readonly { name: string; request: ReturnType<typeof imageGeneration>; path: string; body: () => unknown }[] = [
				{
					name: '3.0 Omni from the prompt, with Kling\'s defaults',
					request: imageGeneration(server.url, 'kling-image-3.0-omni', {}),
					path: '/v1/images/omni-image',
					body: () => ({ model_name: 'kling-v3-omni', prompt: PROMPT, resolution: '1k', n: 1, aspect_ratio: '16:9' })
				},
				{
					name: '3.0 Omni from three references, Adaptive, at 4K, four images',
					request: imageGeneration(server.url, 'kling-image-3.0-omni', { ratio: 'adaptive', resolution: '4k', count: 4 }, REFERENCES, PROMPT, 'cn'),
					path: '/v1/images/omni-image',
					body: () => ({ model_name: 'kling-v3-omni', prompt: PROMPT, image_list: REFERENCES.map(media => ({ image: base64(media) })), resolution: '4k', n: 4, aspect_ratio: 'auto' })
				},
				{
					name: '3.0 from the prompt with a negative prompt',
					request: imageGeneration(server.url, 'kling-image-3.0', { ratio: '21:9', resolution: '2k', count: 9, negative_prompt: 'blurry, text' }),
					path: '/v1/images/generations',
					body: () => ({ model_name: 'kling-v3', prompt: PROMPT, negative_prompt: 'blurry, text', resolution: '2k', n: 9, aspect_ratio: '21:9' })
				},
				{
					name: '3.0 from one reference, a blank negative prompt sends none',
					request: imageGeneration(server.url, 'kling-image-3.0', { ratio: '1:1', negative_prompt: '  ' }, [START]),
					path: '/v1/images/generations',
					body: () => ({ model_name: 'kling-v3', prompt: PROMPT, image: base64(START), resolution: '1k', n: 1, aspect_ratio: '1:1' })
				},
				{
					name: 'O1 from the prompt, Adaptive by default',
					request: imageGeneration(server.url, 'kling-image-o1', {}),
					path: '/v1/images/omni-image',
					body: () => ({ model_name: 'kling-image-o1', prompt: PROMPT, resolution: '1k', n: 1, aspect_ratio: 'auto' })
				},
				{
					name: 'O1 from two references at 2K',
					request: imageGeneration(server.url, 'kling-image-o1', { ratio: '9:16', resolution: '2k', count: 2 }, REFERENCES.slice(0, 2)),
					path: '/v1/images/omni-image',
					body: () => ({ model_name: 'kling-image-o1', prompt: PROMPT, image_list: REFERENCES.slice(0, 2).map(media => ({ image: base64(media) })), resolution: '2k', n: 2, aspect_ratio: '9:16' })
				}
			];
			const providers = commands();
			const outcomes = [];
			for (const entry of cases) {
				const before = server.received.length;
				const answer = await providers.submit(entry.request);
				outcomes.push({
					name: entry.name,
					answer,
					sent: server.received.slice(before).map(request => ({ method: request.method, path: request.path, authorization: request.headers.authorization, type: request.headers['content-type'], body: sentBody(request) }))
				});
			}
			assert.deepEqual(outcomes, cases.map((entry, index) => ({
				name: entry.name,
				answer: { ok: true, value: { remoteId: `image-${index + 1}` } },
				sent: [{ method: 'POST', path: entry.path, authorization: `Bearer ${KEY}`, type: 'application/json', body: entry.body() }]
			})));
		} finally {
			await server.close();
		}
	});

	test('an image task is asked about at its call\'s own path, and every state maps, its images in order without their watermarks', async () => {
		const tasks: Readonly<Record<string, unknown>> = {
			'i-1': { task_id: 'i-1', task_status: 'submitted', task_status_msg: '' },
			'i-2': { task_id: 'i-2', task_status: 'processing', task_status_msg: '' },
			'i-3': {
				task_id: 'i-3',
				task_status: 'succeed',
				task_status_msg: '',
				watermark_info: { enabled: false },
				task_result: {
					result_type: 'single',
					images: [
						{ index: 0, url: 'https://p1-kling.klingai.com/kcdn/i-3-0.png', watermark_url: 'https://p1-kling.klingai.com/kcdn/i-3-0-mark.png' },
						{ index: 1, url: 'https://p1-kling.klingai.com/kcdn/i-3-1.png' },
						{ index: 2, url: ' ' }
					]
				}
			},
			'i-4': { task_id: 'i-4', task_status: 'failed', task_status_msg: 'Failure to pass the risk control system' },
			'i-5': { task_id: 'i-5', task_status: 'failed' },
			'i-6': { task_id: 'i-6', task_status: 'paused' },
			'i-7': { task_id: 'i-7', task_status: 'succeed', task_result: { images: [] } }
		};
		const server = await startServer((request, response) => {
			const id = /^(?:\/relay)?\/v1\/images\/(?:generations|omni-image)\/([^/?]+)$/.exec(request.path)?.[1] ?? '';
			if (id === 'gone') {
				sendJson(response, 404, { code: 1203, message: 'task not found', request_id: 'r' });
			} else if (id === 'gone-in-body') {
				sendJson(response, 200, { code: 1203, message: 'task not found', request_id: 'r' });
			} else if (tasks[id]) {
				sendJson(response, 200, { code: 0, message: 'SUCCEED', request_id: 'r', data: tasks[id] });
			} else {
				sendJson(response, 200, { code: 0, message: 'SUCCEED', request_id: 'r' });
			}
		});
		try {
			const providers = commands();
			const poll = (model: string, id: string, endpoint = server.url) => providers.poll(imageTaskRef(endpoint, model, id));
			const states = [];
			for (const id of ['i-1', 'i-2', 'i-3', 'i-4', 'i-5']) {
				states.push(value(await poll('kling-image-3.0-omni', id)));
			}
			const others = [];
			for (const id of ['i-6', 'i-7', 'no-data', 'gone', 'gone-in-body']) {
				others.push(error(await poll('kling-image-o1', id)));
			}
			value(await poll('kling-image-3.0', 'i-1'));
			value(await poll('kling-image-3.0', 'i-2', `${server.url}/relay`));
			assert.deepEqual({
				states,
				others: others.map(entry => entry.code),
				unreadable: others[1].message,
				asked: server.received.map(request => `${request.method} ${request.path} ${request.headers.authorization} ${request.headers['content-type']}`)
			}, {
				states: [
					{ state: 'pending' },
					{ state: 'running' },
					{ state: 'succeeded', outputs: [{ url: 'https://p1-kling.klingai.com/kcdn/i-3-0.png' }, { url: 'https://p1-kling.klingai.com/kcdn/i-3-1.png' }] },
					{ state: 'failed', message: 'Failure to pass the risk control system' },
					{ state: 'failed', message: 'Kling reports that the task failed.' }
				],
				others: ['invalidResponse', 'invalidResponse', 'invalidResponse', 'notFound', 'notFound'],
				unreadable: 'Kling reports that the task succeeded but gives no address of its images.',
				asked: [
					...['i-1', 'i-2', 'i-3', 'i-4', 'i-5', 'i-6', 'i-7', 'no-data', 'gone', 'gone-in-body'].map(id => `GET /v1/images/omni-image/${id} Bearer ${KEY} application/json`),
					`GET /v1/images/generations/i-1 Bearer ${KEY} application/json`,
					`GET /relay/v1/images/generations/i-2 Bearer ${KEY} application/json`
				]
			});
		} finally {
			await server.close();
		}
	});

	test('an image downloads from the address of the poll without the key, and an image task is not cancelled', async () => {
		const cdn = await startServer(routed(serveFiles({ '/kcdn/i-9-0.png': tinyPng() })));
		const api = await startServer((request, response) => sendJson(response, 200, {
			code: 0,
			message: 'SUCCEED',
			data: { task_id: 'i-9', task_status: 'succeed', task_result: { images: [{ index: 0, url: `${cdn.url}/kcdn/i-9-0.png`, watermark_url: `${cdn.url}/kcdn/i-9-0-mark.png` }] } }
		}));
		try {
			const providers = commands();
			const ref = imageTaskRef(api.url, 'kling-image-3.0', 'i-9');
			const polled = value(await providers.poll(ref));
			const target = partTargets(1)[0];
			const url = (polled as unknown as { outputs: { url: string }[] }).outputs[0].url;
			const downloaded = value(await providers.download({ ...ref, kind: 'image', url, targetFsPath: target }));
			const cancelled = value(await providers.cancel(ref));
			assert.deepEqual({
				downloaded,
				same: readFileSync(target).equals(tinyPng()),
				cdn: cdn.received.map(request => `${request.path} ${request.headers.authorization ?? 'no key'}`),
				cancelled,
				api: api.received.length
			}, {
				downloaded: { size: tinyPng().byteLength, format: 'png' },
				same: true,
				cdn: ['/kcdn/i-9-0.png no key'],
				cancelled: { cancelled: false },
				api: 1
			});
		} finally {
			await api.close();
			await cdn.close();
		}
	});

	test('image creates: a refused key, the codes of a 429, refused content, and lost answers, each sent once', async () => {
		const replies: readonly [number, unknown][] = [
			[401, { code: 1000, message: 'Authentication failed' }],
			[429, { code: 1102, message: 'resource pack exhausted' }],
			[429, { code: 1303, message: 'parallel task over resource pack limit' }],
			[400, { code: 1301, message: 'risk control' }],
			[200, { code: 1301, message: 'risk control' }],
			[400, { code: 1201, message: 'aspect_ratio is invalid' }],
			[500, { code: 5000, message: 'internal error' }],
			[200, { code: 0, message: 'SUCCEED', data: { task_status: 'submitted' } }]
		];
		let next = 0;
		const server = await startServer((request, response, socket) => {
			if (next >= replies.length) {
				socket.destroy();
				return;
			}
			const [status, body] = replies[next++];
			sendJson(response, status, body);
		});
		try {
			const providers = commands();
			const outcomes = [];
			for (let index = 0; index <= replies.length; index++) {
				const failed = error(await providers.submit(imageGeneration(server.url, 'kling-image-o1', { count: 3 }, REFERENCES.slice(0, 1))));
				outcomes.push([failed.code, failed.status]);
			}
			const poll = error(await providers.poll(imageTaskRef(server.url, 'kling-image-o1', 'i-1')));
			assert.deepEqual({ outcomes, poll: poll.code, sent: server.received.length }, {
				outcomes: [
					['auth', 401],
					['balance', 429],
					['rateLimited', 429],
					['rejected', 400],
					['rejected', undefined],
					['rejected', 400],
					['unknownOutcome', 500],
					['unknownOutcome', undefined],
					['unknownOutcome', undefined]
				],
				poll: 'network',
				// One create each, and the poll's three retries after its first try.
				sent: replies.length + 1 + 4
			});
		} finally {
			await server.close();
		}
	});

	test('check adds the rules of the image models to the declarations\' own, and a request it refuses is not sent', async () => {
		const providers = commands();
		const problems = async (model: string, params: Record<string, unknown>, images: readonly FileMedia[] = [], checker = providers) =>
			value(await checker.check({ provider: 'kling', region: 'cn', model, mode: 'reference', params, prompt: PROMPT, inputs: { images, videos: [], audios: [] } })).problems;
		const sized = (bytes: number) => commands({ inspector: () => ({ inspect: async () => ({ bytes, format: 'png', width: 1024, height: 1024 }) }) });
		const results = {
			omniAdaptiveFromPrompt: await problems('kling-image-3.0-omni', { ratio: 'adaptive' }),
			omniAdaptiveWithReference: await problems('kling-image-3.0-omni', { ratio: 'adaptive' }, [START]),
			o1AdaptiveFromPrompt: await problems('kling-image-o1', {}),
			negativePromptWithReference: await problems('kling-image-3.0', { negative_prompt: 'text' }, [START]),
			negativePromptFromPrompt: await problems('kling-image-3.0', { negative_prompt: 'text' }),
			twoReferencesOn30: await problems('kling-image-3.0', {}, REFERENCES.slice(0, 2)),
			o1At4k: await problems('kling-image-o1', { resolution: '4k' }),
			tenImages: await problems('kling-image-3.0', { count: 10 }),
			webp: await problems('kling-image-o1', {}, [WEBP]),
			largeReference: await problems('kling-image-o1', {}, [START], sized(11 * MiB)),
			tooLargeTogether: await problems('kling-image-3.0-omni', {}, Array.from({ length: 10 }, () => START), sized(10 * MiB))
		};
		assert.deepEqual(results, {
			omniAdaptiveFromPrompt: ['Kling Image 3.0 Omni chooses the shape itself only from reference images; choose a ratio, or connect an image.'],
			omniAdaptiveWithReference: [],
			o1AdaptiveFromPrompt: [],
			negativePromptWithReference: ['Kling Image 3.0 takes a negative prompt only when no reference image is connected; clear the negative prompt, or remove the image.'],
			negativePromptFromPrompt: [],
			twoReferencesOn30: ['Kling Image 3.0 in References mode takes at most 1 reference image; 2 are planned.'],
			o1At4k: ['Resolution cannot be 4k for Kling Image O1; choose 1K, 2K.'],
			tenImages: ['Images must be between 1 and 9.'],
			webp: ['Reference image 1 frame.webp is a WebP image; this mode takes PNG or JPEG images.'],
			largeReference: ['Reference image 1 start.png is 11 MiB; an image may be at most 10 MiB.'],
			tooLargeTogether: ['The images make a request of 133.3 MiB; BaseHalf sends at most 128 MiB. Use fewer or smaller images.']
		});
		const server = await startServer((request, response) => sendJson(response, 200, imageCreated('never')));
		try {
			const refused = error(await providers.submit(imageGeneration(server.url, 'kling-image-3.0-omni', { ratio: 'adaptive' })));
			assert.deepEqual({ refused, sent: server.received.length }, {
				refused: { code: 'rejected', message: 'Kling Image 3.0 Omni chooses the shape itself only from reference images; choose a ratio, or connect an image.' },
				sent: 0
			});
		} finally {
			await server.close();
		}
	});

	test('an image address BaseHalf does not download from is refused on its own, and the task\'s other images land', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {
			code: 0,
			message: 'SUCCEED',
			data: {
				task_id: 'i-8',
				task_status: 'succeed',
				task_result: { images: [{ index: 0, url: 'http://p1-kling.klingai.com/kcdn/i-8-0.png' }, { index: 1, url: 'https://p1-kling.klingai.com/kcdn/i-8-1.png' }] }
			}
		}));
		try {
			const polled = value(await commands().poll(imageTaskRef(server.url, 'kling-image-o1', 'i-8')));
			assert.deepEqual(polled, {
				state: 'succeeded',
				outputs: [{ refused: 'The provider gave an image address that does not start with https://.' }, { url: 'https://p1-kling.klingai.com/kcdn/i-8-1.png' }]
			});
		} finally {
			await server.close();
		}
	});
});
