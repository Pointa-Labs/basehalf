/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Black Forest Labs module (docs/specs/providers/bfl.md) through the
 * provider commands, against local servers that answer like BFL's API and its
 * delivery host. No test calls Black Forest Labs or uses a real key.
 */

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { BFL } from '../../node/bfl.js';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../../node/commands.js';
import { BoundHttp, parseEndpoint, resolveHttpOptions, type HttpAnswer, type HttpCall, type ProviderHttp } from '../../node/http.js';
import type { MediaInspector } from '../../node/media.js';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import { remoteIdIn, error, gifHeader, isoMedia, jpegHeader, partTargets, png, recordingSleep, routed, sendJson, serveFiles, startServer, tinyPng, value, webpHeader, type Received, type TestServer } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: bfl', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const folder = mkdtempSync(join(tmpdir(), 'basehalf-bfl-'));
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
	const WEBP = file('frame.webp', webpHeader('VP8X', 640, 360), 'image/webp');
	const GIF = file('moving.gif', gifHeader(640, 360), 'image/gif');
	const CLIP = file('clip.mp4', isoMedia(7.5), 'video/mp4');
	const LONG_CLIP = file('long.mp4', isoMedia(16), 'video/mp4');
	const SHORT_CLIP = file('short.mp4', isoMedia(0.5), 'video/mp4');
	const MOV = file('clip.mov', isoMedia(4, { brand: 'qt  ' }), 'video/quicktime');

	const KEY = 'bfl_localTestKey0001';
	const PROMPT = 'A paper boat drifts down a rainy street; rain patters on the water.';
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

	/** A check of the files made by `planned`. */
	function checkRequest(mode: Mode, params: Record<string, unknown>, inputs: ReturnType<typeof planned>, prompt = PROMPT) {
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
			regions: [{ id: 'global', label: 'Global', baseUrl: 'https://api.bfl.ai/v1', console: 'https://dashboard.bfl.ai' }],
			credentials: [{ id: 'apiKey', label: 'API Key', placeholder: 'bfl_…' }]
		});
		// The video model, then the image models (their own test below).
		assert.deepEqual(provider.models.map(model => [model.id, model.kind]), [
			['flux-3', 'video'],
			['flux-3-image', 'image'],
			['flux-2-pro', 'image'],
			['flux-2-max', 'image'],
			['flux-2-flex', 'image'],
			['flux-2-klein-4b', 'image'],
			['flux-2-klein-9b', 'image']
		]);
		const model = provider.models[0];
		assert.deepEqual({ label: model.label, providerModels: model.providerModels, prompt: model.prompt, deprecated: model.deprecated }, {
			label: 'FLUX 3',
			providerModels: { global: 'flux-3-video' },
			prompt: { required: 'always', maxLength: 20000 },
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
		assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'bfl'), 'BaseHalf ships the Black Forest Labs module');
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

	test('the route follows the mode and the inputs', async () => {
		const providers = commands();
		const routed = async (mode: Mode, inputs: Inputs) => value(await providers.check(checkRequest(mode, {}, planned(inputs)))).providerModel;
		assert.deepEqual({
			text: await routed('frames', {}),
			startFrame: await routed('frames', { startFrame: START }),
			startAndEnd: await routed('frames', { startFrame: START, endFrame: END }),
			extend: await routed('extend', { source: CLIP }),
			edit: await routed('edit', { source: CLIP })
		}, {
			text: 'flux-3-video',
			startFrame: 'flux-3-video',
			startAndEnd: 'flux-3-video',
			extend: 'flux-3-video',
			edit: 'flux-tools/video-edit-v1'
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
			const polled = [value(await providers.poll(taskRef(endpoint, remoteIdIn(first)))), value(await providers.poll(taskRef(endpoint, remoteIdIn(second))))];
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
			const polled = value(await providers.poll(taskRef(api.url, remoteIdIn(elsewhere))));
			// An address written into a node by hand, on neither the endpoint's origin nor a BFL host.
			const refused = error(await providers.poll(taskRef(api.url, `${other.url}/v1/get_result?id=task-3`)));
			assert.deepEqual({ onBfl, elsewhere, polled, refused, toApi: api.received.map(request => [request.method, request.path]), toOther: other.received.length }, {
				onBfl: { remoteId: 'https://api.us1.bfl.ai/v1/get_result?id=task-bfl' },
				elsewhere: { remoteId: 'task-3' },
				polled: { state: 'pending' },
				refused: { code: 'rejected', message: 'The task\'s polling address is neither on the endpoint set up for Black Forest Labs nor on a host of Black Forest Labs, so BaseHalf does not ask it.' },
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
				requestOnce: async () => { throw new Error('not used'); },
				wait: async () => { throw new Error('not used'); },
				retry: async () => { throw new Error('not used'); }
			};
			const state = await BFL.poll(taskRef('https://api.bfl.ai/v1', remoteIdIn(onBfl)), recording);
			const bound = new BoundHttp(parseEndpoint('https://api.bfl.ai/v1'), () => BFL.headers({ apiKey: KEY }), BFL.readError, resolveHttpOptions({}));
			assert.deepEqual({
				state,
				calls,
				toCluster: bound.credentialHeadersFor(new URL(remoteIdIn(onBfl))),
				toEndpoint: bound.credentialHeadersFor(new URL('https://api.bfl.ai/v1/get_result?id=task-bfl'))
			}, {
				state: { state: 'running', fraction: 0.25 },
				// A 503 is read by the module: its body may carry the task's state.
				calls: [{ method: 'GET', url: 'https://api.us1.bfl.ai/v1/get_result?id=task-bfl', accept: [503] }],
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
			const message = 'Black Forest Labs refused the API key. Check it in Providers. (Not authenticated)';
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
					['auth', 403, 'Black Forest Labs refused the API key for this request: the key may be wrong, or its project may not use this endpoint. Check it in Providers. (Forbidden)'],
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
					// A progress outside 0 to 1 has no scale BaseHalf knows.
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
					['invalidResponse', 'Black Forest Labs reports a task state BaseHalf does not know: Paused.'],
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
				withAddress: { size: video.byteLength, format: 'mp4' },
				withoutAddress: { size: video.byteLength, format: 'mp4' },
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
		const problems = async (mode: Mode, params: Record<string, unknown>, inputs: Inputs, text = PROMPT) =>
			value(await providers.check(checkRequest(mode, params, planned(inputs), text))).problems;
		const clip = { source: CLIP };
		assert.deepEqual({
			extendTwenty: await problems('extend', { duration: 20 }, clip),
			extendFifteen: await problems('extend', { duration: 15 }, clip),
			extendAuto: await problems('extend', { duration: -1 }, clip),
			framesTwenty: await problems('frames', { duration: 20 }, {}),
			framesTwentyOne: await problems('frames', { duration: 21 }, {}),
			editLongPrompt: await problems('edit', {}, clip, 'a'.repeat(4097)),
			editTrimmedPrompt: await problems('edit', {}, clip, `  ${'a'.repeat(4096)}  `),
			framesLongerPrompt: await problems('frames', {}, {}, 'a'.repeat(4097)),
			tooLongPrompt: await problems('frames', {}, {}, 'a'.repeat(20001)),
			noPrompt: await problems('frames', {}, { startFrame: START }, '  '),
			editWithImage: await problems('edit', {}, { source: CLIP, images: [START] }),
			endFrameAlone: await problems('frames', {}, { endFrame: END }),
			editResolution: await problems('edit', { resolution: '1080p' }, clip),
			toleranceFive: await problems('frames', { safety_tolerance: 5 }, {}),
			extendWithoutClip: await problems('extend', {}, {})
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

	test('check refuses a MOV clip, clips outside their lengths, another image format, and a request too large to send; submit then sends nothing', async () => {
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
					twoLarge: ['The inputs make a request of 133.3 MiB; BaseHalf sends at most 128 MiB. Use fewer or smaller inputs.'],
					submittedMov: { code: 'rejected', message: 'The source video clip.mov is a MOV video; Black Forest Labs takes MP4 videos only.' },
					submittedRule: { code: 'rejected', message: 'FLUX 3 continues a clip by 5 to 15 seconds; choose 15 seconds or less, or Auto.' }
				},
				sent: 0
			});
		} finally {
			await server.close();
		}
	});

	// --- the image models ---------------------------------------------------------------------------

	type ImageModel = 'flux-3-image' | 'flux-2-pro' | 'flux-2-max' | 'flux-2-flex' | 'flux-2-klein-4b' | 'flux-2-klein-9b';

	const IMAGE_MODELS: readonly ImageModel[] = ['flux-3-image', 'flux-2-pro', 'flux-2-max', 'flux-2-flex', 'flux-2-klein-4b', 'flux-2-klein-9b'];
	const SHAPES = ['21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21'];

	/** The bytes of a file as plain base64, as the image routes take them. */
	function base64(media: FileMedia): string {
		return readFileSync(media.fsPath).toString('base64');
	}

	/** A generation of an image model: References mode, with the planned images in order. */
	function imageGeneration(endpoint: string, model: ImageModel, params: Record<string, unknown>, images: readonly FileMedia[] = [], prompt = PROMPT) {
		return { provider: 'bfl', region: 'global', endpoint, credentials: { apiKey: KEY }, model, mode: 'reference', params, prompt, inputs: { images, videos: [], audios: [] } };
	}

	function imageTaskRef(endpoint: string, remoteId: string, model: ImageModel = 'flux-3-image', targets?: readonly string[]) {
		return { ...taskRef(endpoint, remoteId), model, ...(targets ? { targets } : {}) };
	}

	test('the catalog declares FLUX 3 Image and five FLUX.2 models as image models in PNG, with their references and settings', () => {
		const provider = buildCatalog([BFL]).providers[0];
		const images = provider.models.filter(model => model.kind === 'image');
		assert.deepEqual(images.map(model => ({
			id: model.id,
			label: model.label,
			route: model.providerModels,
			prompt: model.prompt,
			outputFormat: model.outputFormat,
			answersAtOnce: model.answersAtOnce,
			images: model.modes.map(mode => [mode.id, mode.label, mode.inputs.images.min, mode.inputs.images.max, mode.limits])
		})), [
			{ id: 'flux-3-image', label: 'FLUX 3 Image', route: { global: 'flux-3-image' }, prompt: { required: 'always', maxLength: 20000 }, outputFormat: 'png', answersAtOnce: undefined, images: [['reference', 'References', 0, 10, { imageMinSide: 256 }]] },
			{ id: 'flux-2-pro', label: 'FLUX.2 [pro]', route: { global: 'flux-2-pro' }, prompt: { required: 'always', maxLength: 20000 }, outputFormat: 'png', answersAtOnce: undefined, images: [['reference', 'References', 0, 8, {}]] },
			{ id: 'flux-2-max', label: 'FLUX.2 [max]', route: { global: 'flux-2-max' }, prompt: { required: 'always', maxLength: 20000 }, outputFormat: 'png', answersAtOnce: undefined, images: [['reference', 'References', 0, 8, {}]] },
			{ id: 'flux-2-flex', label: 'FLUX.2 [flex]', route: { global: 'flux-2-flex' }, prompt: { required: 'always', maxLength: 20000 }, outputFormat: 'png', answersAtOnce: undefined, images: [['reference', 'References', 0, 8, {}]] },
			{ id: 'flux-2-klein-4b', label: 'FLUX.2 [klein] 4B', route: { global: 'flux-2-klein-4b' }, prompt: { required: 'always', maxLength: 20000 }, outputFormat: 'png', answersAtOnce: undefined, images: [['reference', 'References', 0, 4, {}]] },
			{ id: 'flux-2-klein-9b', label: 'FLUX.2 [klein] 9B', route: { global: 'flux-2-klein-9b' }, prompt: { required: 'always', maxLength: 20000 }, outputFormat: 'png', answersAtOnce: undefined, images: [['reference', 'References', 0, 4, {}]] }
		]);
		const none = { min: 0, max: 0 };
		for (const model of images) {
			assert.deepEqual({ ...model.modes[0].inputs, images: none }, { startFrame: 'none', endFrame: 'none', images: none, videos: none, audios: none, source: 'none' }, `${model.id} takes images only`);
			assert.ok(model.description && !/image 1/i.test(model.description), `${model.id} leaves the names of its images to the module (D74)`);
			assert.ok(model.parameters.every(parameter => typeof parameter.tooltip === 'string' && parameter.tooltip.length > 0), `${model.id} explains every setting`);
		}
		const settings = (id: string) => images.find(model => model.id === id)!.parameters.map(({ tooltip: _tooltip, ...parameter }) => parameter);
		const flux2 = {
			resolution: { name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '1k', label: '1K' }, { value: '1.5k', label: '1.5K' }, { value: '2k', label: '2K' }], default: '1k' },
			ratio: { name: 'ratio', label: 'Ratio', kind: 'choice', display: 'ratio', options: SHAPES.map(shape => ({ value: shape, label: shape })), default: '1:1' },
			rewriting: { name: 'prompt_extend', label: 'Prompt Rewriting', kind: 'boolean', default: true, advanced: true },
			seed: { name: 'seed', label: 'Seed', kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true },
			safety: { name: 'safety_tolerance', label: 'Safety Tolerance', kind: 'integer', min: 0, max: 5, step: 1, default: 2, advanced: true }
		};
		assert.deepEqual({
			'flux-3-image': settings('flux-3-image'),
			'flux-2-pro': settings('flux-2-pro'),
			'flux-2-max': settings('flux-2-max'),
			'flux-2-flex': settings('flux-2-flex'),
			'flux-2-klein-4b': settings('flux-2-klein-4b'),
			'flux-2-klein-9b': settings('flux-2-klein-9b')
		}, {
			'flux-3-image': [
				{ name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '1k', label: '1K' }, { value: '1.5k', label: '1.5K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }], default: '1k' },
				{ name: 'ratio', label: 'Ratio', kind: 'choice', display: 'ratio', options: [{ value: 'adaptive', label: 'Adaptive' }, ...SHAPES.map(shape => ({ value: shape, label: shape }))], default: 'adaptive' },
				{ name: 'grounding', label: 'Grounding', kind: 'boolean', default: true },
				{ name: 'safety_tolerance', label: 'Safety Tolerance', kind: 'integer', min: 0, max: 4, step: 1, default: 2, advanced: true }
			],
			'flux-2-pro': [flux2.resolution, flux2.ratio, flux2.rewriting, flux2.seed, flux2.safety],
			'flux-2-max': [flux2.resolution, flux2.ratio, flux2.rewriting, flux2.seed, flux2.safety],
			'flux-2-flex': [
				flux2.resolution,
				flux2.ratio,
				flux2.rewriting,
				{ name: 'steps', label: 'Steps', kind: 'integer', min: 1, max: 50, step: 1, default: 50, advanced: true },
				{ name: 'guidance', label: 'Guidance', kind: 'number', min: 1.5, max: 10, step: 0.1, default: 5, advanced: true },
				flux2.seed,
				flux2.safety
			],
			'flux-2-klein-4b': [flux2.resolution, flux2.ratio, flux2.seed, flux2.safety],
			'flux-2-klein-9b': [flux2.resolution, flux2.ratio, flux2.seed, flux2.safety]
		});
		assert.deepEqual(buildCatalog(PROVIDER_MODULES).providers.find(entry => entry.id === 'bfl')?.models.filter(model => model.kind === 'image').map(model => model.id), IMAGE_MODELS, 'BaseHalf ships the image models');
	});

	test('each image model is created once at its route with the exact body, its images as plain base64 in order, and the key in x-key', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, created(server, `task-${server.received.length}`)));
		try {
			const flux2 = (change: Record<string, unknown>) => ({ prompt: PROMPT, width: 1024, height: 1024, safety_tolerance: 2, output_format: 'png', ...change });
			const cases: readonly { readonly model: ImageModel; readonly params: Record<string, unknown>; readonly images?: readonly FileMedia[]; readonly body: () => unknown }[] = [
				{
					// BFL's defaults: the shape the prompt or the images give, 1K, grounding, tolerance 2.
					model: 'flux-3-image', params: {},
					body: () => ({ prompt: PROMPT, aspect_ratio: 'auto', resolution: '1k', grounding: true, safety_tolerance: 2 })
				},
				{
					model: 'flux-3-image', params: { ratio: '7:5', resolution: '4k', grounding: false, safety_tolerance: 4 }, images: [START, END],
					body: () => ({ prompt: PROMPT, images: [base64(START), base64(END)], aspect_ratio: '7:5', resolution: '4k', grounding: false, safety_tolerance: 4 })
				},
				{
					// One image is a list of one, as BFL's examples send it.
					model: 'flux-3-image', params: { resolution: '1.5k' }, images: [WEBP],
					body: () => ({ prompt: PROMPT, images: [base64(WEBP)], aspect_ratio: 'auto', resolution: '1.5k', grounding: true, safety_tolerance: 2 })
				},
				{
					// FLUX.2's default: 1024 × 1024, upsampling on.
					model: 'flux-2-pro', params: {},
					body: () => flux2({ disable_pup: false })
				},
				{
					model: 'flux-2-max', params: { ratio: '16:9', resolution: '1.5k', prompt_extend: false, seed: 7, safety_tolerance: 5 }, images: [START, END, WEBP],
					body: () => flux2({ input_image: base64(START), input_image_2: base64(END), input_image_3: base64(WEBP), width: 1920, height: 1072, disable_pup: true, seed: 7, safety_tolerance: 5 })
				},
				{
					model: 'flux-2-flex', params: { ratio: '3:4', prompt_extend: false, steps: 30, guidance: 3.5 }, images: [END],
					body: () => flux2({ input_image: base64(END), width: 880, height: 1168, prompt_upsampling: false, steps: 30, guidance: 3.5 })
				},
				{
					model: 'flux-2-flex', params: {},
					body: () => flux2({ prompt_upsampling: true, steps: 50, guidance: 5 })
				},
				{
					// [klein] has no upsampling field, and takes 4 images.
					model: 'flux-2-klein-4b', params: { ratio: '9:21', resolution: '2k' }, images: [START, END, WEBP, START],
					body: () => flux2({ input_image: base64(START), input_image_2: base64(END), input_image_3: base64(WEBP), input_image_4: base64(START), width: 1328, height: 3120 })
				},
				{
					model: 'flux-2-klein-9b', params: { seed: 0 },
					body: () => flux2({ seed: 0 })
				}
			];
			const providers = commands();
			const outcomes = [];
			for (const entry of cases) {
				const before = server.received.length;
				const request = imageGeneration(server.url, entry.model, entry.params, entry.images);
				const checked = value(await providers.check(request));
				const answer = await providers.submit(request);
				outcomes.push({
					checked: [checked.problems, checked.providerModel],
					answer,
					sent: server.received.slice(before).map(received => ({ method: received.method, path: received.path, key: received.headers['x-key'], type: received.headers['content-type'], body: sentBody(received) }))
				});
			}
			assert.deepEqual(outcomes, cases.map((entry, index) => ({
				// Each model has one route, so check answers none.
				checked: [[], undefined],
				answer: { ok: true, value: { remoteId: `${server.url}/get_result?id=task-${index + 1}` } },
				sent: [{ method: 'POST', path: `/${entry.model}`, key: KEY, type: 'application/json', body: entry.body() }]
			})));
		} finally {
			await server.close();
		}
	});

	test('FLUX.2 sends the width and height of its tier\'s area for each shape, in multiples of 16 and never above the tier', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, created(server, 'task')));
		try {
			const providers = commands();
			const sizes: Record<string, string> = {};
			for (const resolution of ['1k', '1.5k', '2k']) {
				for (const ratio of SHAPES) {
					const before = server.received.length;
					value(await providers.submit(imageGeneration(server.url, 'flux-2-pro', { ratio, resolution })));
					const { width, height } = sentBody(server.received[before]) as { width: number; height: number };
					const area = { '1k': 1, '1.5k': 2, '2k': 4 }[resolution]! * 1024 * 1024;
					assert.ok(width % 16 === 0 && height % 16 === 0 && width * height <= area, `${resolution} ${ratio}: ${width} × ${height}`);
					sizes[`${resolution} ${ratio}`] = `${width} × ${height}`;
				}
			}
			// The table of bfl.md, "Parameters of the image models".
			const table: readonly (readonly [string, string, string, string])[] = [
				['21:9', '1552 × 656', '2208 × 944', '3120 × 1328'],
				['2:1', '1440 × 720', '2048 × 1024', '2896 × 1440'],
				['16:9', '1360 × 768', '1920 × 1072', '2720 × 1536'],
				['3:2', '1248 × 832', '1760 × 1168', '2496 × 1664'],
				['7:5', '1200 × 864', '1712 × 1216', '2416 × 1728'],
				['4:3', '1168 × 880', '1664 × 1248', '2352 × 1760'],
				['5:4', '1136 × 912', '1616 × 1280', '2288 × 1824'],
				['1:1', '1024 × 1024', '1440 × 1440', '2048 × 2048'],
				['4:5', '912 × 1136', '1280 × 1616', '1824 × 2288'],
				['3:4', '880 × 1168', '1248 × 1664', '1760 × 2352'],
				['5:7', '864 × 1200', '1216 × 1712', '1728 × 2416'],
				['2:3', '832 × 1248', '1168 × 1760', '1664 × 2496'],
				['9:16', '768 × 1360', '1072 × 1920', '1536 × 2720'],
				['1:2', '720 × 1440', '1024 × 2048', '1440 × 2896'],
				['9:21', '656 × 1552', '944 × 2208', '1328 × 3120']
			];
			assert.deepEqual(sizes, Object.fromEntries(table.flatMap(([ratio, ...cells]) => ['1k', '1.5k', '2k'].map((resolution, index) => [`${resolution} ${ratio}`, cells[index]]))));
		} finally {
			await server.close();
		}
	});

	test('check of an image model reports images outside FLUX 3 Image\'s pixels, too many images, values a model lacks, and a request too large to send; submit then sends nothing', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, created(server, 'task')));
		try {
			const providers = commands();
			const small = file('small.png', png(200, 300), 'image/png');
			const sixteen = file('sixteen.jpg', jpegHeader(4096, 4096), 'image/jpeg');
			const over = file('over.jpg', jpegHeader(4097, 4096), 'image/jpeg');
			const problems = async (model: ImageModel, params: Record<string, unknown>, images: readonly FileMedia[] = [], checker = providers) =>
				value(await checker.check(imageGeneration(server.url, model, params, images))).problems;
			// Six images measured as 20 MiB each: 160 MiB in base64, more than BaseHalf sends.
			const large = commands({ inspector: () => ({ inspect: async () => ({ bytes: 20 * MiB, format: 'png', width: 1920, height: 1080 }) }) });
			assert.deepEqual({
				sixteenMegapixels: await problems('flux-3-image', {}, [sixteen]),
				aboveSixteen: await problems('flux-3-image', {}, [START, over]),
				aboveSixteenForFlux2: await problems('flux-2-pro', {}, [over]),
				small: await problems('flux-3-image', {}, [small]),
				smallForFlux2: await problems('flux-2-max', {}, [small]),
				elevenImages: await problems('flux-3-image', {}, Array.from({ length: 11 }, () => START)),
				nineImages: await problems('flux-2-pro', {}, Array.from({ length: 9 }, () => START)),
				fiveImages: await problems('flux-2-klein-9b', {}, Array.from({ length: 5 }, () => START)),
				seedForFlux3: await problems('flux-3-image', { seed: 3 }),
				toleranceFiveForFlux3: await problems('flux-3-image', { safety_tolerance: 5 }),
				toleranceSixForFlux2: await problems('flux-2-pro', { safety_tolerance: 6 }),
				adaptiveForFlux2: await problems('flux-2-pro', { ratio: 'adaptive' }),
				fourKForFlux2: await problems('flux-2-flex', { resolution: '4k' }),
				rewritingForKlein: await problems('flux-2-klein-4b', { prompt_extend: false }),
				guidanceOffStep: await problems('flux-2-flex', { guidance: 3.55 }),
				gif: await problems('flux-2-pro', {}, [GIF]),
				tooLarge: await problems('flux-2-pro', {}, [START, START, START, START, START, START], large),
				submittedOver: error(await providers.submit(imageGeneration(server.url, 'flux-3-image', {}, [over]))),
				submittedTooMany: error(await providers.submit(imageGeneration(server.url, 'flux-2-klein-4b', {}, Array.from({ length: 5 }, () => START))))
			}, {
				sixteenMegapixels: [],
				aboveSixteen: ['Reference image 2 over.jpg is 4097 × 4096 px, more than the 16 megapixels FLUX 3 Image takes.'],
				aboveSixteenForFlux2: [],
				small: ['Reference image 1 small.png is 200 × 300 px; each side must be at least 256 px.'],
				smallForFlux2: [],
				elevenImages: ['FLUX 3 Image in References mode takes at most 10 reference images; 11 are planned.'],
				nineImages: ['FLUX.2 [pro] in References mode takes at most 8 reference images; 9 are planned.'],
				fiveImages: ['FLUX.2 [klein] 9B in References mode takes at most 4 reference images; 5 are planned.'],
				seedForFlux3: ['FLUX 3 Image has no setting named "seed".'],
				toleranceFiveForFlux3: ['Safety Tolerance must be between 0 and 4.'],
				toleranceSixForFlux2: ['Safety Tolerance must be between 0 and 5.'],
				adaptiveForFlux2: [`Ratio cannot be adaptive for FLUX.2 [pro]; choose ${SHAPES.join(', ')}.`],
				fourKForFlux2: ['Resolution cannot be 4k for FLUX.2 [flex]; choose 1K, 1.5K, 2K.'],
				rewritingForKlein: ['FLUX.2 [klein] 4B has no setting named "prompt_extend".'],
				guidanceOffStep: ['Guidance must be a step of 0.1 from 1.5.'],
				gif: ['Reference image 1 moving.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.'],
				tooLarge: ['The inputs make a request of 160.0 MiB; BaseHalf sends at most 128 MiB. Use fewer or smaller inputs.'],
				submittedOver: { code: 'rejected', message: 'Reference image 1 over.jpg is 4097 × 4096 px, more than the 16 megapixels FLUX 3 Image takes.' },
				submittedTooMany: { code: 'rejected', message: 'FLUX.2 [klein] 4B in References mode takes at most 4 reference images; 5 are planned.' }
			});
			assert.equal(server.received.length, 0, 'a refused request sends nothing');
		} finally {
			await server.close();
		}
	});

	test('a poll of an image task maps every status, says what moderation refused about the image, and reads a 503 that carries a state', async () => {
		const sample = 'https://delivery-eu1.bfl.ai/results/ab/cd/sample.png?se=2026-10-22T10%3A10%3A00Z&sig=abc';
		const tasks: Readonly<Record<string, unknown>> = {
			'i-pending': { id: 'i-pending', status: 'Pending', result: null, progress: null },
			'i-reasoning': { id: 'i-reasoning', status: 'Reasoning', progress: 0.05 },
			'i-generating': { id: 'i-generating', status: 'Generating', progress: 0.6 },
			'i-ready': { id: 'i-ready', status: 'Ready', result: { sample, prompt: 'An expanded prompt.', duration: 9.2 }, progress: 1 },
			'i-request': { id: 'i-request', status: 'Request Moderated', result: null, details: { 'Moderation Reasons': ['Violence'] } },
			'i-content': { id: 'i-content', status: 'Content Moderated', result: null, details: { 'Moderation Reasons': ['Sexual Content'] } },
			'i-error': { id: 'i-error', status: 'Error', result: null, details: { error: 'A reference image could not be decoded.' } },
			'i-no-card': { id: 'i-no-card', status: 'No Card Generated' },
			'i-bare': { id: 'i-bare', status: 'Ready', result: {} },
			'i-gone': { id: 'i-gone', status: 'Task not found' }
		};
		let outage = 0;
		const server = await startServer((request, response) => {
			const id = new URL(request.path, 'http://local').searchParams.get('id') ?? '';
			if (id === 'i-failed-503') {
				// A failed task answered as a 503 with its state.
				sendJson(response, 503, { id, status: 'Error', result: null, details: { error: 'The generation crashed.' } });
				return;
			}
			if (id === 'i-outage') {
				if (outage++ === 0) {
					sendJson(response, 503, { detail: 'Service Unavailable' });
					return;
				}
				sendJson(response, 200, { id, status: 'Generating', progress: 0.3 });
				return;
			}
			if (id === 'i-down') {
				sendJson(response, 503, { detail: 'Service Unavailable' });
				return;
			}
			sendJson(response, 200, tasks[id] ?? { detail: 'Not Found' });
		});
		try {
			const sleep = recordingSleep();
			const providers = commands({ http: { sleep: sleep.sleep } });
			const at = (id: string, model: ImageModel = 'flux-3-image') => imageTaskRef(server.url, `${server.url}/get_result?id=${id}`, model);
			const states: Record<string, unknown> = {};
			for (const id of ['i-pending', 'i-reasoning', 'i-generating', 'i-ready', 'i-request', 'i-content', 'i-error', 'i-no-card', 'i-failed-503', 'i-outage']) {
				states[id] = value(await providers.poll(at(id, id === 'i-ready' ? 'flux-2-max' : 'flux-3-image')));
			}
			const waitsBeforeDown = sleep.waits.length;
			const others: Record<string, unknown> = {};
			for (const id of ['i-bare', 'i-gone', 'i-down']) {
				const failed = error(await providers.poll(at(id)));
				others[id] = [failed.code, failed.message];
			}
			const asked = (id: string) => server.received.filter(request => request.path.endsWith(`id=${id}`)).length;
			assert.deepEqual({ states, others, asked: [asked('i-failed-503'), asked('i-outage'), asked('i-down')], waits: [sleep.waits.slice(0, waitsBeforeDown), sleep.waits.slice(waitsBeforeDown)] }, {
				states: {
					'i-pending': { state: 'pending' },
					'i-reasoning': { state: 'running', fraction: 0.05 },
					'i-generating': { state: 'running', fraction: 0.6 },
					// Without targets, the address is answered for the window to download.
					'i-ready': { state: 'succeeded', outputs: [{ url: sample }] },
					'i-request': { state: 'failed', message: 'Black Forest Labs\' moderation refused the prompt or an input before the image was made (Violence). Change the request: the same one is refused again.' },
					'i-content': { state: 'failed', message: 'Black Forest Labs\' moderation withheld the finished image (Sexual Content). Change the prompt or the inputs.' },
					'i-error': { state: 'failed', message: 'Black Forest Labs reports that the generation failed: A reference image could not be decoded.' },
					'i-no-card': { state: 'failed', message: 'Black Forest Labs ended the task without a result (No Card Generated).' },
					'i-failed-503': { state: 'failed', message: 'Black Forest Labs reports that the generation failed: The generation crashed.' },
					'i-outage': { state: 'running', fraction: 0.3 }
				},
				others: {
					'i-bare': ['invalidResponse', 'Black Forest Labs reports the image ready but gives no address of it.'],
					'i-gone': ['notFound', 'Black Forest Labs does not know the task i-gone: it does not exist or has expired.'],
					'i-down': ['network', 'Black Forest Labs: Service Unavailable']
				},
				// A 503 with a state is read at once; an outage is asked again, three times at most.
				asked: [1, 2, 4],
				waits: [[1000], [1000, 2000, 4000]]
			});
			assert.ok(server.received.every(request => request.method === 'GET' && request.headers['x-key'] === KEY));
		} finally {
			await server.close();
		}
	});

	test('a ready image is downloaded by the poll itself into the task\'s target, without the key on the delivery host; without a target, its address is answered', async () => {
		const picture = tinyPng();
		const delivery = await startServer(routed(serveFiles({ '/results/task-7/sample.png': picture })));
		const api = await startServer((request, response) => sendJson(response, 200, { id: 'task-7', status: 'Ready', result: { sample: `${delivery.url}/results/task-7/sample.png?sig=abc` }, progress: null }));
		try {
			const providers = commands();
			const remoteId = `${api.url}/get_result?id=task-7`;
			const [target, later] = partTargets(2);
			const withTarget = value(await providers.poll(imageTaskRef(api.url, remoteId, 'flux-2-pro', [target])));
			const withoutTarget = value(await providers.poll(imageTaskRef(api.url, remoteId, 'flux-3-image')));
			const address = (withoutTarget.state === 'succeeded' ? withoutTarget.outputs?.[0] : undefined) as { readonly url?: string } | undefined;
			const downloaded = value(await providers.download({ ...imageTaskRef(api.url, remoteId), kind: 'image', url: address?.url ?? '', targetFsPath: later }));
			assert.deepEqual({
				withTarget,
				written: readFileSync(target).equals(picture),
				withoutTarget,
				downloaded,
				delivery: delivery.received.map(request => [request.path, request.headers['x-key'] ?? null]),
				asked: api.received.map(request => [request.path, request.headers['x-key']])
			}, {
				withTarget: { state: 'succeeded', outputs: [{ written: target, size: picture.byteLength, format: 'png' }] },
				written: true,
				withoutTarget: { state: 'succeeded', outputs: [{ url: `${delivery.url}/results/task-7/sample.png?sig=abc` }] },
				downloaded: { size: picture.byteLength, format: 'png' },
				delivery: [['/results/task-7/sample.png?sig=abc', null], ['/results/task-7/sample.png?sig=abc', null]],
				asked: [['/get_result?id=task-7', KEY], ['/get_result?id=task-7', KEY]]
			});
		} finally {
			await api.close();
			await delivery.close();
		}
	});

	test('an image create answers a refused key, too few credits, too many tasks, and a refused value with the contract\'s codes, and a dropped create is sent once', async () => {
		const replies: readonly [number, unknown][] = [
			[401, { detail: 'Not authenticated' }],
			[402, { detail: 'Insufficient credits' }],
			[429, { detail: 'You have reached the maximum number of active tasks.' }],
			[422, { detail: [{ type: 'less_than_equal', loc: ['body', 'safety_tolerance'], msg: 'Input should be less than or equal to 4', input: 6 }] }],
			[400, { detail: 'Reference image exceeds 16 megapixels.' }]
		];
		let next = 0;
		const server = await startServer((request, response) => {
			const [status, body] = replies[next++];
			sendJson(response, status, body);
		});
		const dropped = await startServer((request, response, socket) => socket.destroy());
		try {
			const providers = commands();
			const outcomes = [];
			for (let index = 0; index < replies.length; index++) {
				const failed = error(await providers.submit(imageGeneration(server.url, index % 2 ? 'flux-2-pro' : 'flux-3-image', {}, [START])));
				outcomes.push([failed.code, failed.status, failed.message]);
			}
			const lost = error(await providers.submit(imageGeneration(dropped.url, 'flux-2-klein-4b', {})));
			assert.deepEqual({ outcomes, sent: server.received.length, lost: [lost.code, dropped.received.length] }, {
				outcomes: [
					['auth', 401, 'Black Forest Labs refused the API key. Check it in Providers. (Not authenticated)'],
					['balance', 402, 'The Black Forest Labs organization has too few credits for this request. Add credits in the BFL dashboard. (Insufficient credits)'],
					['rateLimited', 429, 'Black Forest Labs is already running as many tasks as the account may run at once, or received too many requests. Wait for a task to finish. (You have reached the maximum number of active tasks.)'],
					['rejected', 422, 'Black Forest Labs refused the request: safety_tolerance: Input should be less than or equal to 4'],
					['rejected', 400, 'Black Forest Labs refused the request: Reference image exceeds 16 megapixels.']
				],
				sent: replies.length,
				lost: ['unknownOutcome', 1]
			});
			assert.ok(!JSON.stringify(outcomes).includes(KEY));
		} finally {
			await server.close();
			await dropped.close();
		}
	});
});
