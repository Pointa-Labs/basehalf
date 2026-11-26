/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { MOCK_VIDEO_FIXTURE_URL, MOCK_VIDEO_PROVIDER_KEY, mockPng, startMockVideoProvider } from './mockVideoProvider.js';
import { BYTEDANCE } from '../../node/bytedance.js';
import { VideoProviderCommands } from '../../node/commands.js';
import type { MediaInspector } from '../../node/media.js';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import type { CatalogModel, CatalogParameter, ChoiceParameter, Output, PollState } from '../../common/basehalfProviderTypes.js';
import { remoteIdIn, answerImagesAtOnce, error, jpegHeader, mp3, partTargets, plannedFiles, png, recordingSleep, routed, sendJson, serveFiles, startServer, tinyJpeg, tinyPng, remoteIdOf, value, wav } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: bytedance', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const FIXTURE = readFileSync(MOCK_VIDEO_FIXTURE_URL);
	const folder = mkdtempSync(join(tmpdir(), 'basehalf-bytedance-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

	function file(name: string, bytes: Buffer, mimeType: string) {
		const fsPath = join(folder, name);
		writeFileSync(fsPath, bytes);
		return { fsPath, mimeType };
	}

	const START = file('start.png', png(640, 360), 'image/png');
	const END = file('end.jpg', jpegHeader(800, 600), 'image/jpeg');
	const VOICE = file('voice.wav', wav(3), 'audio/wav');
	const MUSIC = file('music.mp3', mp3(100), 'audio/mpeg');
	const SONG = file('song.m4a', Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 0x4d, 0x34, 0x41, 0x20, 0x69, 0x73, 0x6f, 0x6d]), 'audio/mp4');
	const NO_INPUTS = { images: [], videos: [], audios: [] };

	let parts = 0;
	function partPath(): string {
		return join(folder, `video-${parts++}.mp4.part`);
	}

	function commands(sleep = recordingSleep().sleep, inspector?: () => MediaInspector) {
		return new VideoProviderCommands([BYTEDANCE], { http: { sleep }, ...(inspector ? { inspector } : {}) });
	}

	function access(endpoint: string, region = 'cn', apiKey = MOCK_VIDEO_PROVIDER_KEY) {
		return { provider: 'bytedance', region, endpoint, credentials: { apiKey } };
	}

	function generation(model: string, mode: string, params: Record<string, unknown>, prompt: string, inputs: object = NO_INPUTS) {
		return { model, mode, params, prompt, inputs };
	}

	async function pollUntilEnd(providers: VideoProviderCommands, ref: Record<string, unknown>): Promise<PollState[]> {
		const states: PollState[] = [];
		for (let attempt = 0; attempt < 200; attempt++) {
			const state = value(await providers.poll(ref));
			states.push(state);
			if (state.state !== 'pending' && state.state !== 'running') {
				return states;
			}
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		throw new Error('The task did not end.');
	}

	function summary(parameter: CatalogParameter): string {
		switch (parameter.kind) {
			case 'choice':
				return `${parameter.name}=${parameter.options.map(option => option.value).join('|')}:${parameter.default}`;
			case 'integer':
			case 'number':
				return `${parameter.name}=${parameter.min}-${parameter.max}${parameter.auto ? `|${parameter.auto.value}` : ''}:${parameter.default ?? 'unset'}${parameter.advanced ? ' (more)' : ''}`;
			default:
				return `${parameter.name}:${String(parameter.default)}${parameter.advanced ? ' (more)' : ''}`;
		}
	}

	test('the catalog entry declares the two regions, the API key, and every video model with the ids each region sends', () => {
		const provider = buildCatalog([BYTEDANCE]).providers[0];
		assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
			id: 'bytedance',
			label: 'ByteDance',
			regions: [
				{ id: 'cn', label: 'China · Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', console: 'https://ark.volcengine.com/region:cn-beijing/apiKey' },
				{ id: 'intl', label: 'International · BytePlus ModelArk', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', console: 'https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey' }
			],
			credentials: [{ id: 'apiKey', label: 'API Key' }]
		});
		const models = Object.fromEntries(provider.models.filter(model => model.kind === 'video').map((model: CatalogModel) => [model.id, {
			label: model.label,
			ids: model.providerModels,
			modes: model.modes.map(mode => `${mode.id}: start ${mode.inputs.startFrame}, end ${mode.inputs.endFrame}, images ${mode.inputs.images.min}-${mode.inputs.images.max}, audio ${mode.inputs.audios.min}-${mode.inputs.audios.max}, videos ${mode.inputs.videos.max}`),
			parameters: model.parameters.map(summary),
			...(model.deprecated ? { deprecated: true } : {})
		}]));
		const frames = 'frames: start optional, end optional, images 0-0, audio 0-0, videos 0';
		assert.deepEqual(models, {
			'seedance-2.5': {
				label: 'Seedance 2.5',
				ids: { cn: 'doubao-seedance-2-5-260628', intl: 'dreamina-seedance-2-5-260628' },
				modes: [frames, 'reference: start none, end none, images 0-30, audio 0-10, videos 0'],
				parameters: ['resolution=480p|720p|1080p:720p', 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:adaptive', 'duration=4-30|-1:5', 'sound:true', 'watermark:false (more)']
			},
			'seedance-2.0': {
				label: 'Seedance 2.0',
				ids: { cn: 'doubao-seedance-2-0-260128', intl: 'dreamina-seedance-2-0-260128' },
				modes: [frames, 'reference: start none, end none, images 1-9, audio 0-3, videos 0'],
				parameters: ['resolution=480p|720p|1080p|4k:720p', 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:adaptive', 'duration=4-15|-1:5', 'sound:true', 'watermark:false (more)']
			},
			'seedance-2.0-fast': {
				label: 'Seedance 2.0 Fast',
				ids: { cn: 'doubao-seedance-2-0-fast-260128', intl: 'dreamina-seedance-2-0-fast-260128' },
				modes: [frames, 'reference: start none, end none, images 1-9, audio 0-3, videos 0'],
				parameters: ['resolution=480p|720p:720p', 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:adaptive', 'duration=4-15|-1:5', 'sound:true', 'watermark:false (more)']
			},
			'seedance-2.0-mini': {
				label: 'Seedance 2.0 Mini',
				ids: { cn: 'doubao-seedance-2-0-mini-260615', intl: 'dreamina-seedance-2-0-mini-260615' },
				modes: [frames, 'reference: start none, end none, images 1-9, audio 0-3, videos 0'],
				parameters: ['resolution=480p|720p:720p', 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:adaptive', 'duration=4-15|-1:5', 'sound:true', 'watermark:false (more)']
			},
			'seedance-1.5-pro': {
				label: 'Seedance 1.5 Pro',
				ids: { intl: 'seedance-1-5-pro-251215' },
				modes: [frames],
				parameters: ['resolution=480p|720p|1080p:720p', 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:adaptive', 'duration=4-12|-1:5', 'sound:true', 'seed=0-2147483647:unset (more)', 'camera_fixed:false (more)', 'watermark:false (more)'],
				deprecated: true
			},
			'seedance-1.0-pro': {
				label: 'Seedance 1.0 Pro',
				ids: { cn: 'doubao-seedance-1-0-pro-250528', intl: 'seedance-1-0-pro-250528' },
				modes: [frames],
				parameters: ['resolution=480p|720p|1080p:1080p', 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:16:9', 'duration=2-12:5', 'seed=0-2147483647:unset (more)', 'camera_fixed:false (more)', 'watermark:false (more)']
			},
			'seedance-1.0-pro-fast': {
				label: 'Seedance 1.0 Pro Fast',
				ids: { cn: 'doubao-seedance-1-0-pro-fast-251015', intl: 'seedance-1-0-pro-fast-251015' },
				modes: ['frames: start optional, end none, images 0-0, audio 0-0, videos 0'],
				parameters: ['resolution=480p|720p|1080p:1080p', 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:16:9', 'duration=2-12:5', 'seed=0-2147483647:unset (more)', 'camera_fixed:false (more)', 'watermark:false (more)']
			}
		});
		const limits = provider.models[0].modes[1].limits;
		assert.deepEqual(limits, { imageMinSide: 300, imageMaxSide: 6000, imageAspect: [0.4, 2.5], imageMaxBytes: 31457280, audioSeconds: [2, 30], audioTotalSeconds: 30, audioMaxBytes: 15728640 });
		assert.deepEqual(provider.models[1].modes[1].limits.audioSeconds, [2, 15]);
		assert.deepEqual(provider.models[0].prompt, { required: 'withoutMedia', maxLength: 20000 });
	});

	test('a generation is created once, followed through queued, running, and succeeded, and its MP4 downloaded', async () => {
		const mock = await startMockVideoProvider({ durationMs: 300 });
		try {
			const providers = commands();
			const submitted = value(await providers.submit({
				...access(mock.baseUrl),
				...generation('seedance-2.5', 'frames', { resolution: '720p', ratio: 'adaptive', duration: 5, sound: true, watermark: false }, 'A bicycle passes the sea at dusk.', { startFrame: START, endFrame: END, ...NO_INPUTS })
			}));
			const ref = { ...access(mock.baseUrl), model: 'seedance-2.5', remoteId: remoteIdIn(submitted) };
			const states = await pollUntilEnd(providers, ref);
			const last = states.at(-1) as { state: 'succeeded'; videoUrl: string };
			const viaUrl = partPath();
			const fromPoll = value(await providers.download({ ...ref, videoUrl: last.videoUrl, targetFsPath: viaUrl }));
			const viaModule = partPath();
			const fromModule = value(await providers.download({ ...ref, targetFsPath: viaModule }));
			assert.deepEqual({
				states: [...new Set(states.map(state => state.state))],
				sizes: [fromPoll.size, fromModule.size],
				same: [readFileSync(viaUrl).equals(FIXTURE), readFileSync(viaModule).equals(FIXTURE)],
				requests: mock.requests.length,
				parts: mock.requests[0].parts,
				body: { ...mock.requests[0].body, content: undefined }
			}, {
				states: ['pending', 'running', 'succeeded'],
				sizes: [FIXTURE.byteLength, FIXTURE.byteLength],
				same: [true, true],
				requests: 1,
				parts: ['text', 'image_url first_frame data:image/png', 'image_url last_frame data:image/jpeg'],
				body: { model: 'doubao-seedance-2-5-260628', content: undefined, resolution: '720p', ratio: 'adaptive', duration: 5, generate_audio: true, watermark: false }
			});
		} finally {
			await mock.close();
		}
	});

	test('a task that fails, one that expires, and a queued task that is cancelled end with the provider\'s words', async () => {
		const mock = await startMockVideoProvider({ durationMs: 60 });
		try {
			const providers = commands();
			const start = async (prompt: string) => remoteIdOf(await providers.submit({ ...access(mock.baseUrl, 'intl'), ...generation('seedance-2.0-mini', 'frames', { resolution: '480p', ratio: '16:9', duration: 4 }, prompt) }));
			const ref = (remoteId: string) => ({ ...access(mock.baseUrl, 'intl'), model: 'seedance-2.0-mini', remoteId });
			const failed = (await pollUntilEnd(providers, ref(await start('A storm over the pier [mock:fail]')))).at(-1);
			const expired = (await pollUntilEnd(providers, ref(await start('A storm over the pier [mock:expire]')))).at(-1);
			mock.configure({ durationMs: 60_000 });
			const queued = await start('A storm over the pier');
			const cancelled = value(await providers.cancel(ref(queued)));
			const afterCancel = value(await providers.poll(ref(queued)));
			const unknown = error(await providers.poll(ref('cgt-nothing')));
			assert.deepEqual({ failed, expired, cancelled, afterCancel, unknown: unknown.code }, {
				failed: { state: 'failed', message: 'The video could not be made: the output may contain sensitive content.' },
				expired: { state: 'failed', message: 'The task expired before it finished.' },
				cancelled: { cancelled: true },
				afterCancel: { state: 'cancelled', message: 'The task was cancelled.' },
				unknown: 'notFound'
			});
		} finally {
			await mock.close();
		}
	});

	test('a running task is not cancelled: no DELETE is sent, and a DELETE refused because the task started answers false', async () => {
		let status = 'running';
		const server = await startServer((request, response) => {
			if (request.method === 'DELETE') {
				sendJson(response, 400, { error: { code: 'InvalidParameter', message: 'The task is running.' } });
				return;
			}
			sendJson(response, 200, { id: 'cgt-1', status });
		});
		try {
			const providers = commands();
			const ref = { ...access(`${server.url}/api/v3`), model: 'seedance-2.0', remoteId: 'cgt-1' };
			const running = value(await providers.cancel(ref));
			const runningMethods = server.received.map(entry => entry.method);
			status = 'queued';
			const raced = value(await providers.cancel(ref));
			assert.deepEqual({ running, runningMethods, raced, methods: server.received.map(entry => `${entry.method} ${entry.path}`) }, {
				running: { cancelled: false },
				runningMethods: ['GET'],
				raced: { cancelled: false },
				methods: ['GET /api/v3/contents/generations/tasks/cgt-1', 'GET /api/v3/contents/generations/tasks/cgt-1', 'DELETE /api/v3/contents/generations/tasks/cgt-1']
			});
		} finally {
			await server.close();
		}
	});

	test('a refused key, too many requests with Retry-After, an empty balance, a model not activated, and a dropped create', async () => {
		const mock = await startMockVideoProvider();
		let polls = 0;
		const busy = await startServer((request, response) => {
			if (request.path.includes('/overdue/')) {
				sendJson(response, 403, { error: { code: 'AccountOverdueError', message: 'The request failed because your account has an overdue balance.', type: 'Forbidden' } });
			} else if (request.path.includes('/closed/')) {
				sendJson(response, 404, { error: { code: 'ModelNotOpen', message: 'Your account has not activated the model doubao-seedance-2-0-260128.', type: 'NotFound' } });
			} else if (request.method === 'POST') {
				sendJson(response, 429, { error: { code: 'ModelAccountRpmRateLimitExceeded', message: 'RPM (Requests Per Minute) limit of the model is exceeded.', type: 'TooManyRequests' } }, { 'Retry-After': '3' });
			} else if (polls++ === 0) {
				sendJson(response, 429, { error: { code: 'APIAccountRpmRateLimitExceeded', message: 'The RPM limit for the API on your account has been exceeded.' } }, { 'Retry-After': '2' });
			} else {
				sendJson(response, 200, { id: 'cgt-1', status: 'queued' });
			}
		});
		try {
			const sleep = recordingSleep();
			const providers = commands(sleep.sleep);
			const request = (endpoint: string, apiKey = MOCK_VIDEO_PROVIDER_KEY) => ({ ...access(endpoint, 'cn', apiKey), ...generation('seedance-2.0', 'frames', { resolution: '720p' }, 'A lighthouse at night.') });
			const refusedKey = error(await providers.submit(request(mock.baseUrl, 'wrong-key')));
			const dropped = error(await providers.submit({ ...request(mock.baseUrl), prompt: 'A lighthouse at night. [mock:drop]' }));
			const dropRequests = mock.requests.length;
			const limited = error(await providers.submit(request(`${busy.url}/api/v3`)));
			const createsSent = busy.received.filter(entry => entry.method === 'POST').length;
			const polled = value(await providers.poll({ ...access(`${busy.url}/api/v3`), model: 'seedance-2.0', remoteId: 'cgt-1' }));
			const overdue = error(await providers.submit(request(`${busy.url}/overdue/api/v3`)));
			const closed = error(await providers.submit(request(`${busy.url}/closed/api/v3`)));
			assert.deepEqual({ refusedKey, dropped: dropped.code, dropRequests, limited, createsSent, polled, waits: sleep.waits, overdue, closed }, {
				refusedKey: { code: 'auth', message: 'The API key in the request is missing or invalid.', status: 401 },
				dropped: 'unknownOutcome',
				dropRequests: 1,
				limited: { code: 'rateLimited', message: 'RPM (Requests Per Minute) limit of the model is exceeded. The provider asks to wait 3 seconds.', status: 429 },
				createsSent: 1,
				polled: { state: 'pending' },
				waits: [2000],
				overdue: { code: 'balance', message: 'The request failed because your account has an overdue balance.', status: 403 },
				closed: { code: 'rejected', message: 'Your account has not activated the model doubao-seedance-2-0-260128.', status: 404 }
			});
		} finally {
			await busy.close();
			await mock.close();
		}
	});

	test('each model\'s parameters, frames, and references map to the API\'s fields and content roles', async () => {
		const mock = await startMockVideoProvider({ durationMs: 60_000 });
		try {
			const providers = commands();
			const sent = async (region: string, request: ReturnType<typeof generation>) => {
				value(await providers.submit({ ...access(mock.baseUrl, region), ...request }));
				const received = mock.requests.at(-1)!;
				return { parts: received.parts, body: { ...received.body, content: undefined } };
			};
			const references = await sent('intl', generation('seedance-2.0', 'reference', { resolution: '4k', ratio: '9:16', duration: -1, sound: false, watermark: true }, '图片1里的人在雨中唱歌', {
				images: [START, END], videos: [], audios: [VOICE, MUSIC]
			}));
			const fast = await sent('cn', generation('seedance-1.0-pro-fast', 'frames', { resolution: '1080p', ratio: '21:9', duration: 12, seed: 42, camera_fixed: true }, 'A train crosses a bridge.'));
			const silent = await sent('intl', generation('seedance-1.5-pro', 'frames', { sound: false }, '', { startFrame: START, ...NO_INPUTS }));
			const audioOnly = await sent('cn', generation('seedance-2.5', 'reference', {}, 'Sing along to the clip.', { images: [], videos: [], audios: [VOICE] }));
			assert.deepEqual({ references, fast, silent, audioOnly }, {
				references: {
					parts: ['text', 'image_url reference_image data:image/png', 'image_url reference_image data:image/jpeg', 'audio_url reference_audio data:audio/wav', 'audio_url reference_audio data:audio/mp3'],
					body: { model: 'dreamina-seedance-2-0-260128', content: undefined, resolution: '4k', ratio: '9:16', duration: -1, generate_audio: false, watermark: true }
				},
				fast: {
					parts: ['text'],
					body: { model: 'doubao-seedance-1-0-pro-fast-251015', content: undefined, resolution: '1080p', ratio: '21:9', duration: 12, seed: 42, camera_fixed: true, watermark: false }
				},
				silent: {
					parts: ['image_url first_frame data:image/png'],
					body: { model: 'seedance-1-5-pro-251215', content: undefined, resolution: '720p', ratio: 'adaptive', duration: 5, generate_audio: false, camera_fixed: false, watermark: false }
				},
				audioOnly: {
					parts: ['text', 'audio_url reference_audio data:audio/wav'],
					body: { model: 'doubao-seedance-2-5-260628', content: undefined, resolution: '720p', ratio: 'adaptive', duration: 5, generate_audio: true, watermark: false }
				}
			});
		} finally {
			await mock.close();
		}
	});

	test('check reports the rules between parameters, the provider\'s input rules, and the size of the whole request', async () => {
		const providers = commands();
		const problems = async (model: string, mode: string, params: Record<string, unknown>, prompt: string, inputs: object, region = 'cn') =>
			value(await providers.check({ provider: 'bytedance', region, model, mode, params, prompt, inputs })).problems;
		// With a start frame, Seedance 2.5 takes the frame's shape: the ratio is left out, not refused.
		assert.deepEqual(await problems('seedance-2.5', 'frames', { ratio: '16:9' }, 'p', plannedFiles({ startFrame: true })), []);
		assert.deepEqual(await problems('seedance-2.5', 'frames', { ratio: '16:9' }, 'p', plannedFiles()), []);
		assert.deepEqual(await problems('seedance-1.0-pro', 'frames', { ratio: 'adaptive' }, 'p', plannedFiles()), ['Seedance 1.0 Pro chooses a ratio only from a start frame: choose a ratio, or connect an image.']);
		assert.deepEqual(await problems('seedance-1.0-pro', 'frames', { ratio: 'adaptive' }, '', plannedFiles({ startFrame: true })), []);
		assert.deepEqual(await problems('seedance-2.5', 'reference', {}, 'p', plannedFiles()), ['Seedance 2.5 in References mode needs at least one image or audio clip.']);
		assert.deepEqual(await problems('seedance-2.0', 'reference', {}, 'p', plannedFiles({ audios: 1 })), ['Seedance 2.0 in References mode needs at least 1 reference image.']);
		assert.deepEqual(await problems('seedance-2.0', 'frames', { resolution: '4k' }, 'A dog --dur 10 --rs 1080p', plannedFiles()), ['The prompt sets --dur; choose it in the settings instead, so that what the panel shows is sent.']);
		assert.deepEqual(await problems('seedance-2.0-fast', 'frames', { resolution: '1080p' }, 'p', plannedFiles()), ['Resolution cannot be 1080p for Seedance 2.0 Fast; choose 480p, 720p.']);
		assert.deepEqual(await problems('seedance-1.5-pro', 'frames', {}, 'p', plannedFiles()), ['ByteDance does not offer Seedance 1.5 Pro in China · Volcengine Ark.']);
		// An M4A without a movie header: its length cannot be read, and Seedance would not take it anyway.
		assert.deepEqual(await problems('seedance-2.5', 'reference', {}, '', { images: [START], videos: [], audios: [SONG, VOICE] }), [
			'Reference audio 1 song.m4a is not audio whose length BaseHalf can read (WAV, MP3, or M4A).',
			'Reference audio 1 song.m4a is M4A audio; Seedance takes WAV or MP3.'
		]);
		// A file whose length is known but whose format Seedance does not take.
		const m4a = () => ({ inspect: async () => ({ name: 'song.m4a', bytes: 1000, format: 'm4a' as const, seconds: 3 }) });
		assert.deepEqual(value(await commands(undefined, m4a).check({ provider: 'bytedance', region: 'cn', model: 'seedance-2.5', mode: 'reference', params: {}, prompt: 'p', inputs: { images: [], videos: [], audios: [SONG] } })).problems, [
			'Reference audio 1 song.m4a is M4A audio; Seedance takes WAV or MP3.'
		]);
		// Three images of 29 MiB each are within the limit of an image, and over 64 MB together as data URLs.
		const large = () => ({ inspect: async () => ({ name: 'large.png', bytes: 29 * 1024 * 1024, format: 'png' as const, width: 4000, height: 3000 }) });
		assert.deepEqual(value(await commands(undefined, large).check({ provider: 'bytedance', region: 'intl', model: 'seedance-2.0', mode: 'reference', params: {}, prompt: 'p', inputs: { images: [START, START, START], videos: [], audios: [] } })).problems, [
			'The request with its inputs would be about 121.6 MB; Seedance takes at most 64 MB. Use fewer or smaller inputs.'
		]);
	});

	// --- Seedream: the image models -----------------------------------------------------------------

	const IMAGES_PATH = '/api/v3/images/generations';

	/** A Seedream request in References mode, with a new target for each image it may make. */
	function imageRequest(endpoint: string, model: string, params: Record<string, unknown>, prompt: string, inputs: object = NO_INPUTS, region = 'cn') {
		const count = typeof params.count === 'number' ? params.count : 1;
		return { ...access(endpoint, region), model, mode: 'reference', params, prompt, inputs, targets: partTargets(count) };
	}

	/** The references of a request: these images, and no other media. */
	function references(...images: readonly unknown[]) {
		return { images, videos: [], audios: [] };
	}

	/** The JSON bodies of the requests for images a test server received, in order. */
	function imageBodies(server: { readonly received: readonly { readonly method: string; readonly path: string; readonly body: Buffer }[] }): Record<string, unknown>[] {
		return server.received.filter(entry => entry.method === 'POST' && entry.path.endsWith('/images/generations')).map(entry => JSON.parse(entry.body.toString('utf8')));
	}

	function outputsOf(submitted: unknown): Output[] {
		return (submitted as { readonly outputs: Output[] }).outputs;
	}

	/** The address of an output, when it is one. */
	function addressOf(output: Output): string | undefined {
		return (output as { readonly url?: string }).url;
	}

	test('the Seedream image models answer at once in both regions, with their formats, references, limits, and parameters, and Volcengine Ark retires three', () => {
		const provider = buildCatalog([BYTEDANCE]).providers[0];
		const images = Object.fromEntries(provider.models.filter(model => model.kind === 'image').map(model => [model.id, {
			label: model.label,
			ids: model.providerModels,
			format: model.outputFormat,
			atOnce: model.answersAtOnce,
			...(model.deprecatedIn ? { deprecatedIn: model.deprecatedIn } : {}),
			modes: model.modes.map(mode => `${mode.id}: start ${mode.inputs.startFrame}, end ${mode.inputs.endFrame}, images ${mode.inputs.images.min}-${mode.inputs.images.max}, audio ${mode.inputs.audios.max}, videos ${mode.inputs.videos.max}, source ${mode.inputs.source}`),
			parameters: model.parameters.map(summary)
		}]));
		const ratio = 'ratio=16:9|4:3|3:2|1:1|2:3|3:4|9:16|21:9|adaptive:adaptive';
		const takes = (max: number) => [`reference: start none, end none, images 0-${max}, audio 0, videos 0, source none`];
		assert.deepEqual(images, {
			'seedream-5.0-pro': {
				label: 'Seedream 5.0 Pro',
				ids: { cn: 'doubao-seedream-5-0-pro-260628', intl: 'dola-seedream-5-0-pro-260628' },
				format: 'png',
				atOnce: true,
				modes: takes(10),
				parameters: [ratio, 'resolution=1k|1.5k|2k:2k', 'background=opaque|transparent:opaque', 'optimize_prompt_options.mode=standard|fast:standard', 'watermark:false (more)']
			},
			'seedream-5.0-flash': {
				label: 'Seedream 5.0 Flash',
				ids: { cn: 'doubao-seedream-5-0-flash-260915', intl: 'dola-seedream-5-0-flash-260915' },
				format: 'png',
				atOnce: true,
				modes: takes(10),
				parameters: [ratio, 'resolution=1k|1.5k|2k:2k', 'background=opaque|transparent:opaque', 'watermark:false (more)']
			},
			'seedream-5.0-lite': {
				label: 'Seedream 5.0 Lite',
				ids: { cn: 'doubao-seedream-5-0-260128', intl: 'seedream-5-0-260128' },
				format: 'png',
				atOnce: true,
				deprecatedIn: ['cn'],
				modes: takes(14),
				parameters: [ratio, 'resolution=2k|3k|4k:2k', 'count=1-15:1', 'watermark:false (more)']
			},
			'seedream-4.5': {
				label: 'Seedream 4.5',
				ids: { cn: 'doubao-seedream-4-5-251128', intl: 'seedream-4-5-251128' },
				format: 'jpeg',
				atOnce: true,
				deprecatedIn: ['cn'],
				modes: takes(14),
				parameters: [ratio, 'resolution=2k|4k:2k', 'count=1-15:1', 'watermark:false (more)']
			},
			'seedream-4.0': {
				label: 'Seedream 4.0',
				ids: { cn: 'doubao-seedream-4-0-250828', intl: 'seedream-4-0-250828' },
				format: 'jpeg',
				atOnce: true,
				deprecatedIn: ['cn'],
				modes: takes(14),
				parameters: [ratio, 'resolution=1k|2k|4k:2k', 'count=1-15:1', 'optimize_prompt_options.mode=standard|fast:standard', 'watermark:false (more)']
			}
		});
		const pro = provider.models.find(model => model.id === 'seedream-5.0-pro')!;
		const lite = provider.models.find(model => model.id === 'seedream-5.0-lite')!;
		const labels = (model: CatalogModel, name: string) => (model.parameters.find(parameter => parameter.name === name) as ChoiceParameter).options.map(option => option.label);
		assert.deepEqual({
			prompt: pro.prompt,
			limits: pro.modes[0].limits,
			resolutions: [...labels(pro, 'resolution'), ...labels(lite, 'resolution')],
			deprecated: provider.models.filter(model => model.kind === 'image' && model.deprecated).length,
			shipped: PROVIDER_MODULES.includes(BYTEDANCE)
		}, {
			prompt: { required: 'always', maxLength: 20000 },
			limits: { imageMinSide: 15, imageAspect: [0.0625, 16], imageMaxBytes: 31457280 },
			resolutions: ['1K', '1.5K', '2K', '2K', '3K', '4K'],
			deprecated: 0,
			shipped: true
		});
	});

	test('a Seedream generation is sent once to the local test provider and answers its images at once, from the prompt alone and from references', async () => {
		const mock = await startMockVideoProvider();
		try {
			const providers = commands();
			const sent = async (request: ReturnType<typeof imageRequest>) => {
				const before = mock.requests.length;
				const outputs = outputsOf(value(await providers.submit(request)));
				return { outputs, received: mock.requests.slice(before) };
			};
			const alone = await sent(imageRequest(mock.baseUrl, 'seedream-5.0-pro', { ratio: '16:9', resolution: '2k' }, 'A lighthouse at dawn.', NO_INPUTS, 'intl'));
			const set = await sent(imageRequest(mock.baseUrl, 'seedream-5.0-lite', { ratio: 'adaptive', resolution: '4k', count: 3 }, '图片1和图片2里的猫，三张连续的画面', references(START, END)));
			const single = await sent(imageRequest(mock.baseUrl, 'seedream-4.5', { watermark: true }, 'A paper boat.', references(START), 'intl'));
			const fast = await sent(imageRequest(mock.baseUrl, 'seedream-4.0', { ratio: '21:9', resolution: '1k', 'optimize_prompt_options.mode': 'fast' }, 'A long bridge.'));
			// Each image is an address the provider serves; it downloads as the PNG it is.
			const address = (output: Output) => {
				const url = addressOf(output);
				return url ? new URL(url).pathname.replace(/\/img-[^/]*-(?<n>\d+)\.png$/, '/image-$<n>.png') : output;
			};
			const target = partTargets(1)[0];
			const downloaded = value(await providers.download({ ...access(mock.baseUrl, 'intl'), model: 'seedream-5.0-pro', kind: 'image', url: addressOf(alone.outputs[0]), targetFsPath: target }));
			assert.deepEqual({
				alone: { kinds: alone.received.map(entry => entry.kind), body: alone.received[0].body, outputs: alone.outputs.map(address) },
				set: { parts: set.received[0].parts, body: set.received[0].body, outputs: set.outputs.map(address) },
				single: single.received[0].body,
				fast: fast.received[0].body,
				downloaded,
				same: readFileSync(target).equals(mockPng(1))
			}, {
				alone: {
					kinds: ['image'],
					body: { model: 'dola-seedream-5-0-pro-260628', prompt: 'A lighthouse at dawn.', size: '2816x1584', output_format: 'png', background: 'opaque', optimize_prompt_options: { mode: 'standard' }, response_format: 'url', watermark: false },
					outputs: ['/files/images/image-1.png']
				},
				set: {
					parts: ['image data:image/png', 'image data:image/jpeg'],
					body: {
						model: 'doubao-seedream-5-0-260128',
						prompt: '图片1和图片2里的猫，三张连续的画面',
						image: ['data:image/png;base64,…', 'data:image/jpeg;base64,…'],
						size: '4K',
						sequential_image_generation: 'auto',
						sequential_image_generation_options: { max_images: 3 },
						output_format: 'png',
						response_format: 'url',
						watermark: false
					},
					outputs: ['/files/images/image-1.png', '/files/images/image-2.png', '/files/images/image-3.png']
				},
				// One reference is sent as a string; JPEG models take no output format.
				single: { model: 'seedream-4-5-251128', prompt: 'A paper boat.', image: 'data:image/png;base64,…', size: '2K', sequential_image_generation: 'disabled', response_format: 'url', watermark: true },
				fast: { model: 'doubao-seedream-4-0-250828', prompt: 'A long bridge.', size: '1512x648', sequential_image_generation: 'disabled', optimize_prompt_options: { mode: 'fast' }, response_format: 'url', watermark: false },
				downloaded: { size: mockPng(1).byteLength, format: 'png' },
				same: true
			});
		} finally {
			await mock.close();
		}
	});

	test('every ratio at every level of each Seedream model sends the size of the provider\'s own table, and Adaptive sends the level alone', async () => {
		const server = await startServer(routed(answerImagesAtOnce({ path: IMAGES_PATH, images: [tinyPng()], as: 'url', shape: urls => ({ data: urls.map(url => ({ url })) }) })));
		try {
			const providers = commands();
			const sizes: Record<string, Record<string, Record<string, string>>> = {};
			for (const model of buildCatalog([BYTEDANCE]).providers[0].models.filter(entry => entry.kind === 'image')) {
				const values = (name: string) => (model.parameters.find(parameter => parameter.name === name) as ChoiceParameter).options.map(option => String(option.value));
				for (const level of values('resolution')) {
					for (const ratio of values('ratio')) {
						value(await providers.submit(imageRequest(`${server.url}/api/v3`, model.id, { resolution: level, ratio }, 'A test card.')));
						((sizes[model.id] ??= {})[level] ??= {})[ratio] = String(imageBodies(server).at(-1)?.size);
					}
				}
			}
			const adaptive = Object.fromEntries(Object.entries(sizes).map(([model, levels]) => [model, Object.values(levels).map(row => row.adaptive)]));
			// Spot values, read from the official tables.
			const spots = [
				sizes['seedream-5.0-pro']['1k']['16:9'], sizes['seedream-5.0-pro']['1.5k']['21:9'], sizes['seedream-5.0-pro']['2k']['4:3'],
				sizes['seedream-5.0-flash']['2k']['9:16'],
				sizes['seedream-5.0-lite']['2k']['4:3'], sizes['seedream-5.0-lite']['3k']['3:2'], sizes['seedream-5.0-lite']['4k']['16:9'],
				sizes['seedream-4.5']['2k']['2:3'], sizes['seedream-4.5']['4k']['21:9'],
				sizes['seedream-4.0']['1k']['16:9'], sizes['seedream-4.0']['1k']['21:9'], sizes['seedream-4.0']['4k']['1:1']
			];
			// Every size has its ratio's shape and lies in the range of pixels the model takes for a width and height.
			const ranges: Record<string, readonly [number, number]> = {
				'seedream-5.0-pro': [921_600, 4_624_220],
				'seedream-5.0-flash': [921_600, 4_624_220],
				'seedream-5.0-lite': [3_686_400, 16_777_216],
				'seedream-4.5': [3_686_400, 16_777_216],
				'seedream-4.0': [921_600, 16_777_216]
			};
			const outside: string[] = [];
			for (const [model, levels] of Object.entries(sizes)) {
				for (const [level, row] of Object.entries(levels)) {
					for (const [ratio, size] of Object.entries(row).filter(([name]) => name !== 'adaptive')) {
						const [width, height] = size.split('x').map(Number);
						const [across, down] = ratio.split(':').map(Number);
						if (width * height < ranges[model][0] || width * height > ranges[model][1] || Math.abs(width / height / (across / down) - 1) > 0.02) {
							outside.push(`${model} ${level} ${ratio} ${size}`);
						}
					}
				}
			}
			assert.deepEqual({ adaptive, spots, outside, sent: imageBodies(server).length }, {
				adaptive: {
					'seedream-5.0-pro': ['1K', '1.5K', '2K'],
					'seedream-5.0-flash': ['1K', '1.5K', '2K'],
					'seedream-5.0-lite': ['2K', '3K', '4K'],
					'seedream-4.5': ['2K', '4K'],
					'seedream-4.0': ['1K', '2K', '4K']
				},
				spots: ['1424x800', '2352x1008', '2368x1776', '1584x2816', '2304x1728', '3744x2496', '5504x3040', '1664x2496', '6240x2656', '1280x720', '1512x648', '4096x4096'],
				outside: [],
				sent: (3 + 3 + 3 + 2 + 3) * 9
			});
		} finally {
			await server.close();
		}
	});

	test('a Seedream answer keeps the provider\'s order: an address on a file host downloaded without the key, base64 written to its target, and an image refused alone', async () => {
		const files = await startServer(routed(serveFiles({ '/seedream/1.png': tinyPng() })));
		const api = await startServer(routed(answerImagesAtOnce({
			path: IMAGES_PATH,
			images: [tinyPng(), tinyJpeg()],
			as: 'base64',
			shape: images => ({
				data: [
					{ url: `${files.url}/seedream/1.png`, size: '2048x2048' },
					{ b64_json: images[0], size: '2048x2048', output_format: 'png' },
					{ error: { code: 'OutputImageSensitiveContentDetected', message: 'The generated image may contain sensitive content.' } },
					// The bytes decide the format of a file, whatever the provider says.
					{ b64_json: images[1], output_format: 'png' },
					{ size: '2048x2048' }
				]
			})
		})));
		try {
			const providers = commands();
			const request = imageRequest(`${api.url}/api/v3`, 'seedream-4.0', { count: 5 }, 'Five postcards of one city.');
			const outputs = outputsOf(value(await providers.submit(request)));
			const target = partTargets(1)[0];
			const downloaded = value(await providers.download({ ...access(`${api.url}/api/v3`), model: 'seedream-4.0', kind: 'image', url: (outputs[0] as { url: string }).url, targetFsPath: target }));
			assert.deepEqual({
				outputs,
				downloaded,
				keySent: files.received.map(entry => entry.headers.authorization ?? 'none'),
				written: [readFileSync(request.targets[1]).equals(tinyPng()), readFileSync(request.targets[3]).equals(tinyJpeg()), readFileSync(target).equals(tinyPng())]
			}, {
				outputs: [
					{ url: `${files.url}/seedream/1.png` },
					{ written: request.targets[1], size: tinyPng().byteLength, format: 'png' },
					{ refused: 'The generated image may contain sensitive content.' },
					{ written: request.targets[3], size: tinyJpeg().byteLength, format: 'jpeg' },
					{ refused: 'ByteDance answered an image BaseHalf cannot read.' }
				],
				downloaded: { size: tinyPng().byteLength, format: 'png' },
				keySent: ['none'],
				written: [true, true, true]
			});
		} finally {
			await api.close();
			await files.close();
		}
	});

	test('through the local test provider, a set with one image refused lands the others, and a set the model makes smaller answers fewer images', async () => {
		const mock = await startMockVideoProvider();
		try {
			const providers = commands();
			const shapes = (outputs: readonly Output[]) => outputs.map(output => addressOf(output) ? 'address' : output);
			const refusedOne = outputsOf(value(await providers.submit(imageRequest(mock.baseUrl, 'seedream-5.0-lite', { count: 3 }, 'Three frames of a storm [mock:fail]'))));
			const fewer = outputsOf(value(await providers.submit(imageRequest(mock.baseUrl, 'seedream-4.5', { count: 4 }, 'Four frames of a storm [mock:fewer]'))));
			const asBase64 = await startServer(routed(answerImagesAtOnce({ path: IMAGES_PATH, images: [mockPng(1), mockPng(2)], as: 'base64', shape: images => ({ data: images.map(b64_json => ({ b64_json })) }) })));
			try {
				const written = outputsOf(value(await providers.submit(imageRequest(`${asBase64.url}/api/v3`, 'seedream-5.0-lite', { count: 2 }, 'Two frames of a storm'))));
				assert.deepEqual({ refusedOne: shapes(refusedOne), fewer: shapes(fewer), written: written.map(output => (output as { readonly format?: string }).format ?? output) }, {
					refusedOne: ['address', 'address', { refused: 'The image could not be made: the output may contain sensitive content.' }],
					fewer: ['address', 'address', 'address'],
					written: ['png', 'png']
				});
			} finally {
				await asBase64.close();
			}
		} finally {
			await mock.close();
		}
	});

	test('a Seedream request refused for its key or its content, too many requests, an overdue account, a server error, and a dropped answer are sent once', async () => {
		const mock = await startMockVideoProvider();
		const busy = await startServer((request, response) => {
			if (request.path.startsWith('/overdue/')) {
				sendJson(response, 403, { error: { code: 'AccountOverdueError', message: 'The request failed because your account has an overdue balance.', type: 'Forbidden' } });
			} else if (request.path.startsWith('/private/')) {
				sendJson(response, 400, { error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'The input image may contain a real person.', type: 'BadRequest' } });
			} else if (request.path.startsWith('/broken/')) {
				sendJson(response, 500, { error: { code: 'InternalServiceError', message: 'The service encountered an unexpected internal error.', type: 'InternalServerError' } });
			} else if (request.path.startsWith('/none/')) {
				sendJson(response, 200, { error: { code: 'OutputImageSensitiveContentDetected', message: 'The generated image may contain sensitive content.' } });
			} else if (request.path.startsWith('/empty/')) {
				sendJson(response, 200, { created: 1761100000 });
			} else {
				sendJson(response, 429, { error: { code: 'ModelAccountIpmRateLimitExceeded', message: 'The IPM (Images Per Minute) limit of the model is exceeded.', type: 'TooManyRequests' } }, { 'Retry-After': '3' });
			}
		});
		try {
			const providers = commands();
			const request = (endpoint: string, prompt = 'A lighthouse at night.', apiKey = MOCK_VIDEO_PROVIDER_KEY) => ({ ...imageRequest(endpoint, 'seedream-5.0-flash', {}, prompt), credentials: { apiKey } });
			const refusedKey = error(await providers.submit(request(mock.baseUrl, 'A lighthouse at night.', 'wrong-key')));
			const refusedContent = error(await providers.submit(request(mock.baseUrl, 'A lighthouse at night. [mock:reject]')));
			const before = mock.requests.length;
			const dropped = error(await providers.submit(request(mock.baseUrl, 'A lighthouse at night. [mock:drop]')));
			const dropRequests = mock.requests.length - before;
			const limited = error(await providers.submit(request(`${busy.url}/api/v3`)));
			const limitedSent = busy.received.length;
			const outcomes = {
				overdue: error(await providers.submit(request(`${busy.url}/overdue/api/v3`))),
				privacy: error(await providers.submit(request(`${busy.url}/private/api/v3`))),
				broken: error(await providers.submit(request(`${busy.url}/broken/api/v3`))).code,
				none: error(await providers.submit(request(`${busy.url}/none/api/v3`))),
				empty: error(await providers.submit(request(`${busy.url}/empty/api/v3`)))
			};
			assert.deepEqual({ refusedKey, refusedContent, dropped: dropped.code, dropRequests, limited, limitedSent, ...outcomes, sent: busy.received.length }, {
				refusedKey: { code: 'auth', message: 'The API key in the request is missing or invalid.', status: 401 },
				refusedContent: { code: 'rejected', message: 'The request was refused: the prompt may contain sensitive content.', status: 400 },
				dropped: 'unknownOutcome',
				dropRequests: 1,
				limited: { code: 'rateLimited', message: 'The IPM (Images Per Minute) limit of the model is exceeded. The provider asks to wait 3 seconds.', status: 429 },
				limitedSent: 1,
				overdue: { code: 'balance', message: 'The request failed because your account has an overdue balance.', status: 403 },
				privacy: { code: 'rejected', message: 'The input image may contain a real person.', status: 400 },
				broken: 'unknownOutcome',
				none: { code: 'rejected', message: 'The generated image may contain sensitive content.' },
				empty: { code: 'unknownOutcome', message: 'ByteDance accepted the request but answered no images BaseHalf can read.' },
				sent: 6
			});
		} finally {
			await busy.close();
			await mock.close();
		}
	});

	test('check reports a set larger than the model makes, a transparent background without one PNG or WebP reference, a reference of too many pixels, and a request too large', async () => {
		const problems = async (model: string, params: Record<string, unknown>, inputs: object, prompt = 'p', inspector?: () => MediaInspector) =>
			value(await commands(undefined, inspector).check({ provider: 'bytedance', region: 'intl', model, mode: 'reference', params, prompt, inputs })).problems;
		// References and the images of a set together are at most 15.
		assert.deepEqual(await problems('seedream-5.0-lite', { count: 15 }, NO_INPUTS), []);
		assert.deepEqual(await problems('seedream-5.0-lite', { count: 15 }, references(START)), ['Seedream 5.0 Lite makes at most 15 images and references together: with 1 reference image, choose at most 14 images.']);
		assert.deepEqual(await problems('seedream-4.0', { count: 3 }, references(...Array(13).fill(START))), ['Seedream 4.0 makes at most 15 images and references together: with 13 reference images, choose at most 2 images.']);
		assert.deepEqual(await problems('seedream-4.5', { count: 1 }, references(...Array(14).fill(START))), []);
		// A transparent background keeps the transparency of exactly one reference that can have it.
		assert.deepEqual(await problems('seedream-5.0-pro', { background: 'transparent' }, NO_INPUTS), ['Seedream 5.0 Pro makes a transparent background only from exactly one reference image that has transparency: connect one, or choose Opaque.']);
		assert.deepEqual(await problems('seedream-5.0-flash', { background: 'transparent' }, references(START, START)), ['Seedream 5.0 Flash makes a transparent background only from exactly one reference image that has transparency: connect one, or choose Opaque.']);
		assert.deepEqual(await problems('seedream-5.0-pro', { background: 'transparent' }, references(END)), ['Reference image 1 end.jpg is a JPEG image, which has no transparency: a transparent background needs a PNG or WebP reference.']);
		assert.deepEqual(await problems('seedream-5.0-pro', { background: 'transparent' }, references(START)), []);
		// What the declarations refuse.
		assert.deepEqual(await problems('seedream-5.0-pro', { count: 2 }, NO_INPUTS), ['Seedream 5.0 Pro has no setting named "count".']);
		assert.deepEqual(await problems('seedream-5.0-lite', { resolution: '1.5k' }, NO_INPUTS), ['Resolution cannot be 1.5k for Seedream 5.0 Lite; choose 2K, 3K, 4K.']);
		assert.deepEqual(await problems('seedream-5.0-flash', {}, references(...Array(11).fill(START))), ['Seedream 5.0 Flash in References mode takes at most 10 reference images; 11 are planned.']);
		assert.deepEqual(await problems('seedream-4.5', {}, NO_INPUTS, ''), ['Write a prompt: Seedream 4.5 needs one.']);
		// What the files measure: too many pixels, and a request too large as data URLs.
		const huge = () => ({ inspect: async () => ({ name: 'huge.png', bytes: 1000, format: 'png' as const, width: 6001, height: 6000 }) });
		assert.deepEqual(await problems('seedream-5.0-pro', {}, references(START), 'p', huge), ['Reference image 1 start.png has 36,006,000 pixels; Seedream takes images of at most 36,000,000 pixels (6000 × 6000).']);
		const large = () => ({ inspect: async () => ({ name: 'large.png', bytes: 29 * 1024 * 1024, format: 'png' as const, width: 4000, height: 3000 }) });
		assert.deepEqual(await problems('seedream-4.5', {}, references(START, START, START), 'p', large), ['The request with its inputs would be about 121.6 MB; Seedream takes at most 64 MB. Use fewer or smaller inputs.']);
	});

	test('a Seedream model has no task: poll refuses it, and cancel answers false without a request', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, { id: 'cgt-1', status: 'queued' }));
		try {
			const providers = commands();
			const ref = { ...access(`${server.url}/api/v3`), model: 'seedream-5.0-pro', remoteId: 'img-1' };
			assert.deepEqual({ poll: error(await providers.poll(ref)), cancel: value(await providers.cancel(ref)), sent: server.received.length }, {
				poll: { code: 'rejected', message: 'Seedream 5.0 Pro answers with its images at once: there is no task to ask about.' },
				cancel: { cancelled: false },
				sent: 0
			});
		} finally {
			await server.close();
		}
	});
});
