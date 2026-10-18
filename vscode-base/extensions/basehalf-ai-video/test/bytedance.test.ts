/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MOCK_VIDEO_FIXTURE_URL, MOCK_VIDEO_PROVIDER_KEY, startMockVideoProvider } from '../../../scripts/basehalf-video-mock-provider.mts';
import { BYTEDANCE, seedanceEstimate, seedanceTokens } from '../src/providers/bytedance.ts';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { buildCatalog } from '../src/providers/registry.ts';
import type { CatalogModel, CatalogParameter, PollState } from '../src/providers/types.ts';
import { error, jpegHeader, mp3, png, recordingSleep, sendJson, startServer, value, wav } from './providerTestKit.ts';

const FIXTURE = readFileSync(MOCK_VIDEO_FIXTURE_URL);
const folder = mkdtempSync(join(tmpdir(), 'basehalf-bytedance-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

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
const NO_COUNTS = { startFrame: false, endFrame: false, images: 0, videos: 0, audios: 0, source: false };

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

function generation(model: string, mode: string, params: Record<string, unknown>, prompt: string, inputs: Record<string, unknown> = NO_INPUTS) {
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

test('the catalog entry declares the two regions, the API key, and every model with the ids each region sends', () => {
	const provider = buildCatalog([BYTEDANCE]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'bytedance',
		label: 'ByteDance',
		regions: [
			{ id: 'cn', label: 'China · Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', currency: 'CNY', console: 'https://ark.volcengine.com/region:cn-beijing/apiKey' },
			{ id: 'intl', label: 'International · BytePlus ModelArk', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', currency: 'USD', console: 'https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey' }
		],
		credentials: [{ id: 'apiKey', label: 'API Key' }]
	});
	const models = Object.fromEntries(provider.models.map((model: CatalogModel) => [model.id, {
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
		const ref = { ...access(mock.baseUrl), model: 'seedance-2.5', remoteId: submitted.remoteId };
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
		const start = async (prompt: string) => value(await providers.submit({ ...access(mock.baseUrl, 'intl'), ...generation('seedance-2.0-mini', 'frames', { resolution: '480p', ratio: '16:9', duration: 4 }, prompt) })).remoteId;
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
	const problems = async (model: string, mode: string, params: Record<string, unknown>, prompt: string, inputs: Record<string, unknown>, region = 'cn') =>
		value(await providers.check({ provider: 'bytedance', region, model, mode, params, prompt, inputs })).problems;
	assert.deepEqual(await problems('seedance-2.5', 'frames', { ratio: '16:9' }, 'p', { ...NO_COUNTS, startFrame: true }), ['Seedance 2.5 keeps the start frame\'s ratio: choose Adaptive.']);
	assert.deepEqual(await problems('seedance-2.5', 'frames', { ratio: '16:9' }, 'p', NO_COUNTS), []);
	assert.deepEqual(await problems('seedance-1.0-pro', 'frames', { ratio: 'adaptive' }, 'p', NO_COUNTS), ['Seedance 1.0 Pro chooses a ratio only from a start frame: choose a ratio, or connect an image.']);
	assert.deepEqual(await problems('seedance-1.0-pro', 'frames', { ratio: 'adaptive' }, '', { ...NO_COUNTS, startFrame: true }), []);
	assert.deepEqual(await problems('seedance-2.5', 'reference', {}, 'p', NO_COUNTS), ['Seedance 2.5 in References mode needs at least one image or audio clip.']);
	assert.deepEqual(await problems('seedance-2.0', 'reference', {}, 'p', { ...NO_COUNTS, audios: 1 }), ['Seedance 2.0 in References mode needs at least 1 reference image.']);
	assert.deepEqual(await problems('seedance-2.0', 'frames', { resolution: '4k' }, 'A dog --dur 10 --rs 1080p', NO_COUNTS), ['The prompt sets --dur; choose it in the settings instead, so that what the panel shows is sent.']);
	assert.deepEqual(await problems('seedance-2.0-fast', 'frames', { resolution: '1080p' }, 'p', NO_COUNTS), ['Resolution cannot be 1080p for Seedance 2.0 Fast; choose 480p, 720p.']);
	assert.deepEqual(await problems('seedance-1.5-pro', 'frames', {}, 'p', NO_COUNTS), ['ByteDance does not offer Seedance 1.5 Pro in China · Volcengine Ark.']);
	// An M4A without a movie header: its length cannot be read, and Seedance would not take it anyway.
	assert.deepEqual(await problems('seedance-2.5', 'reference', {}, '', { images: [START], videos: [], audios: [SONG, VOICE] }), [
		'Reference audio 1 song.m4a is not audio whose length AI Video can read (WAV, MP3, or M4A).',
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

test('the estimate follows each price list: tokens are seconds × width × height × 24 / 1024 at the output size', async () => {
	const estimate = (model: string, region: string, params: Record<string, unknown>) => seedanceEstimate(model, region, params as Record<string, string | number | boolean>);
	const cny = (min: number, max = min) => ({ currency: 'CNY', min, max, priceDate: '2026-10-17' });
	const usd = (min: number, max = min) => ({ currency: 'USD', min, max, priceDate: '2026-10-18' });
	assert.equal(seedanceTokens(5, 1280, 720), 108_000);
	// Volcengine Ark, CNY, price list of 2026-10-17. Each matches its example on the page.
	// 2.5, 720p 16:9, 5 s: 5 × 1280 × 720 × 24 / 1024 = 108,000 tokens × ¥70.00 / M = ¥7.56.
	assert.deepEqual(estimate('seedance-2.5', 'cn', { resolution: '720p', ratio: '16:9', duration: 5 }), cny(7.56));
	// 2.0, 1080p 16:9, 5 s: 5 × 1920 × 1080 × 24 / 1024 = 243,000 tokens × ¥51.00 / M = ¥12.393 (the page shows ¥12.39).
	assert.deepEqual(estimate('seedance-2.0', 'cn', { resolution: '1080p', ratio: '16:9', duration: 5 }), cny(12.393));
	// 2.0 Mini, 480p 16:9, 5 s: 5 × 864 × 496 × 24 / 1024 = 50,220 tokens × ¥23.00 / M = ¥1.15506 (the page shows ¥1.16).
	assert.deepEqual(estimate('seedance-2.0-mini', 'cn', { resolution: '480p', ratio: '16:9', duration: 5 }), cny(1.15506));
	// 1.0 Pro Fast, 1080p 16:9, 5 s: 5 × 1920 × 1088 × 24 / 1024 = 244,800 tokens × ¥4.20 / M = ¥1.02816.
	assert.deepEqual(estimate('seedance-1.0-pro-fast', 'cn', { resolution: '1080p', ratio: '16:9', duration: 5 }), cny(1.02816));
	// 2.5, 480p, Adaptive, Auto: the shortest (4 s) at the smallest 480p size (640 × 640 = 409,600 px): 38,400 tokens × ¥70 / M = ¥2.688,
	// to the longest (30 s) at the largest (992 × 432 = 428,544 px): 301,320 tokens × ¥70 / M = ¥21.0924.
	assert.deepEqual(estimate('seedance-2.5', 'cn', { resolution: '480p', ratio: 'adaptive', duration: -1 }), cny(2.688, 21.0924));
	// BytePlus ModelArk, USD, price list of 2026-10-18. Each matches its example on the page.
	// 2.5, 1080p 16:9, 5 s: 243,000 tokens × $11.70 / M = $2.8431 (the page shows $2.843).
	assert.deepEqual(estimate('seedance-2.5', 'intl', { resolution: '1080p', ratio: '16:9', duration: 5 }), usd(2.8431));
	// 2.0 Fast, 720p 16:9, 5 s: 108,000 tokens × $5.60 / M = $0.6048 (the page shows $0.60).
	assert.deepEqual(estimate('seedance-2.0-fast', 'intl', { resolution: '720p', ratio: '16:9', duration: 5 }), usd(0.6048));
	// 1.5 Pro, 480p 16:9, 5 s: 50,220 tokens × $2.40 / M = $0.120528 with sound, × $1.20 / M = $0.060264 silent (the page: $0.12 and $0.06).
	assert.deepEqual(estimate('seedance-1.5-pro', 'intl', { resolution: '480p', ratio: '16:9', duration: 5, sound: true }), usd(0.120528));
	assert.deepEqual(estimate('seedance-1.5-pro', 'intl', { resolution: '480p', ratio: '16:9', duration: 5, sound: false }), usd(0.060264));
	// 1.0 Pro, 1080p 16:9, 5 s: 244,800 tokens (the page's usage) × $2.50 / M = $0.612 (the page shows $0.61).
	assert.deepEqual(estimate('seedance-1.0-pro', 'intl', { resolution: '1080p', ratio: '16:9', duration: 5 }), usd(0.612));
	// 2.0, 4K 16:9, 5 s: 5 × 3840 × 2160 × 24 / 1024 = 972,000 tokens × $4.00 / M = $3.888 (the page shows $3.89).
	assert.deepEqual(estimate('seedance-2.0', 'intl', { resolution: '4k', ratio: '16:9', duration: 5 }), usd(3.888));
	// Not offered in the region: no estimate.
	assert.equal(estimate('seedance-1.5-pro', 'cn', { resolution: '480p', ratio: '16:9', duration: 5 }), undefined);
	// Through check: the defaults of 2.0 (720p, Adaptive, 5 s) give the range over the six 720p sizes.
	// 5 s × 921,600 px × 24 / 1024 = 108,000 tokens × ¥46 / M = ¥4.968; 5 s × 927,408 px → 108,680.625 tokens × ¥46 / M = ¥4.99930875.
	const checked = value(await commands().check({ provider: 'bytedance', region: 'cn', model: 'seedance-2.0', mode: 'frames', params: {}, prompt: 'p', inputs: NO_COUNTS }));
	assert.deepEqual(checked, { problems: [], estimate: cny(4.968, 4.999309) });
});
