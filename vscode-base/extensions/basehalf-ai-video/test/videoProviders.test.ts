/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MOCK_VIDEO_FIXTURE_URL, MOCK_VIDEO_PROVIDER_KEY, startMockVideoProvider } from '../../../scripts/basehalf-video-mock-provider.mts';
import { cancelVideoTask, downloadVideo, pollVideoTask, submitVideoTask, videoSizeFor } from '../src/videoProviders.ts';
import type { VideoProviderKind, VideoProviderPollState, VideoProviderRequest, VideoProviderResponse } from '../src/videoProviderTypes.ts';

const FIXTURE = readFileSync(MOCK_VIDEO_FIXTURE_URL);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const folder = mkdtempSync(join(tmpdir(), 'basehalf-video-providers-'));
const startPng = join(folder, 'start.png');
writeFileSync(startPng, PNG);
test.after(() => rmSync(folder, { recursive: true, force: true }));

let parts = 0;
function partPath(): string {
	return join(folder, `video-${parts++}.mp4.part`);
}

function request(provider: VideoProviderKind, baseUrl: string, overrides: Partial<VideoProviderRequest> = {}): VideoProviderRequest {
	return {
		provider,
		baseUrl,
		apiKey: MOCK_VIDEO_PROVIDER_KEY,
		model: 'doubao-seedance-2-5-260628',
		prompt: 'A bicycle passes the sea at dusk.',
		mode: 'frames',
		ratio: '16:9',
		resolution: '720p',
		duration: 5,
		audio: true,
		referenceImages: [],
		referenceVideos: [],
		referenceAudios: [],
		...overrides
	};
}

function value<T>(response: VideoProviderResponse<T>): T {
	assert.equal(response.ok, true, response.ok ? '' : JSON.stringify(response.error));
	return (response as { readonly value: T }).value;
}

function error<T>(response: VideoProviderResponse<T>): { code: string; message: string; status?: number } {
	assert.equal(response.ok, false, 'expected an error');
	return (response as { readonly error: { code: string; message: string; status?: number } }).error;
}

async function pollUntilDone(task: Parameters<typeof pollVideoTask>[0]): Promise<VideoProviderPollState[]> {
	const states: VideoProviderPollState[] = [];
	for (let attempt = 0; attempt < 100; attempt++) {
		const state = value(await pollVideoTask(task));
		states.push(state);
		if (state.state !== 'pending' && state.state !== 'running') {
			return states;
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error('The task did not end.');
}

interface Received {
	readonly method: string;
	readonly path: string;
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
}

/** A small HTTP server for one format, with every request it received. */
async function server(handler: (request: Received, response: ServerResponse) => void): Promise<{ url: string; received: Received[]; close(): Promise<void> }> {
	const received: Received[] = [];
	const instance = createServer((incoming: IncomingMessage, response) => {
		const chunks: Buffer[] = [];
		incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
		incoming.on('end', () => {
			const entry = { method: incoming.method ?? '', path: incoming.url ?? '', headers: incoming.headers, body: Buffer.concat(chunks) };
			received.push(entry);
			handler(entry, response);
		});
	});
	await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', () => resolve()));
	const port = (instance.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}`,
		received,
		close: () => new Promise(resolve => {
			instance.closeAllConnections();
			instance.close(() => resolve());
		})
	};
}

function json(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { 'Content-Type': 'application/json' });
	response.end(JSON.stringify(body));
}

test('Seedance task API: sends frames as data URLs once, follows the task, and downloads its MP4', async () => {
	const mock = await startMockVideoProvider({ durationMs: 300 });
	try {
		const submitted = value(await submitVideoTask(request('ark', mock.seedanceBaseUrl, {
			ratio: 'adaptive',
			startFrame: { fsPath: startPng, mimeType: 'image/png' },
			endFrame: { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }
		})));
		const task = { provider: 'ark' as const, baseUrl: mock.seedanceBaseUrl, apiKey: MOCK_VIDEO_PROVIDER_KEY, model: 'doubao-seedance-2-5-260628', remoteId: submitted.remoteId };
		const states = await pollUntilDone(task);
		const last = states.at(-1)!;
		assert.equal(last.state, 'succeeded');
		const target = partPath();
		const downloaded = value(await downloadVideo({ ...task, videoUrl: (last as { videoUrl: string }).videoUrl, targetFsPath: target }));
		assert.deepEqual({
			states: [...new Set(states.map(state => state.state))],
			size: downloaded.size,
			same: readFileSync(target).equals(FIXTURE),
			requests: mock.requests.length,
			parts: mock.requests[0].parts,
			body: { ...mock.requests[0].body, content: undefined }
		}, {
			states: ['pending', 'running', 'succeeded'],
			size: FIXTURE.byteLength,
			same: true,
			requests: 1,
			parts: ['text', 'image_url first_frame data:image/png', 'image_url last_frame data:image/png'],
			body: { model: 'doubao-seedance-2-5-260628', content: undefined, ratio: 'adaptive', resolution: '720p', duration: 5, generate_audio: true, watermark: false }
		});
	} finally {
		await mock.close();
	}
});

test('Seedance task API: a refused key, a refused request, a failed task, an unknown task, and a cancelled queued task', async () => {
	const mock = await startMockVideoProvider({ durationMs: 60_000 });
	try {
		const refusedKey = error(await submitVideoTask({ ...request('ark', mock.seedanceBaseUrl), apiKey: 'wrong-key' }));
		const refused = error(await submitVideoTask(request('ark', mock.seedanceBaseUrl, { prompt: 'Show it [mock:reject]' })));
		const queued = value(await submitVideoTask(request('ark', mock.seedanceBaseUrl)));
		const task = { provider: 'ark' as const, baseUrl: mock.seedanceBaseUrl, apiKey: MOCK_VIDEO_PROVIDER_KEY, model: 'm', remoteId: queued.remoteId };
		const cancelled = value(await cancelVideoTask(task));
		const afterCancel = value(await pollVideoTask(task));
		const unknown = error(await pollVideoTask({ ...task, remoteId: 'cgt-nothing' }));
		mock.configure({ durationMs: 0 });
		const failing = value(await submitVideoTask(request('ark', mock.seedanceBaseUrl, { prompt: 'Show it [mock:fail]' })));
		const failed = value(await pollVideoTask({ ...task, remoteId: failing.remoteId }));
		assert.deepEqual({ refusedKey, refused, cancelled, afterCancel: afterCancel.state, unknown: unknown.code, failed }, {
			refusedKey: { code: 'auth', message: 'The API key in the request is missing or invalid.', status: 401 },
			refused: { code: 'rejected', message: 'The request was refused: the prompt may contain sensitive content.', status: 400 },
			cancelled: { cancelled: true },
			afterCancel: 'cancelled',
			unknown: 'notFound',
			failed: { state: 'failed', message: 'The video could not be made: the output may contain sensitive content.' }
		});
	} finally {
		await mock.close();
	}
});

test('a request whose connection closes after it was sent has an unknown outcome; one that never connected did not go out', async () => {
	const mock = await startMockVideoProvider();
	const dropped = await submitVideoTask(request('ark', mock.seedanceBaseUrl, { prompt: 'Show it [mock:drop]' }));
	const madeTasks = mock.requests.length;
	await mock.close();
	const refused = await submitVideoTask(request('ark', mock.seedanceBaseUrl));

	const silent = await server(() => { /* never answers */ });
	const timedOut = await submitVideoTask(request('ark', `${silent.url}/api/v3`), { createTimeoutMs: 200 });
	await silent.close();

	assert.deepEqual({ dropped: error(dropped).code, madeTasks, refused: error(refused).code, timedOut: error(timedOut).code }, { dropped: 'unknownOutcome', madeTasks: 1, refused: 'network', timedOut: 'unknownOutcome' });
	assert.match(error(dropped).message, /^The connection ended after the request was sent/);
});

test('/videos tasks: a multipart form with the frames as input references, progress, and the content endpoint with the key', async () => {
	const mock = await startMockVideoProvider({ durationMs: 300 });
	try {
		const submitted = value(await submitVideoTask(request('openai', mock.videosBaseUrl, {
			model: 'relay-video-1',
			duration: 8,
			startFrame: { fsPath: startPng, mimeType: 'image/png' }
		})));
		const task = { provider: 'openai' as const, baseUrl: mock.videosBaseUrl, apiKey: MOCK_VIDEO_PROVIDER_KEY, model: 'relay-video-1', remoteId: submitted.remoteId };
		const states = await pollUntilDone(task);
		const target = partPath();
		const downloaded = value(await downloadVideo({ ...task, targetFsPath: target }));
		assert.deepEqual({
			parts: mock.requests[0].parts,
			fields: mock.requests[0].body,
			fractions: states.every(state => state.state !== 'running' || (state.fraction !== undefined && state.fraction >= 0 && state.fraction <= 1)),
			last: states.at(-1),
			same: readFileSync(target).equals(FIXTURE),
			size: downloaded.size
		}, {
			parts: ['field model', 'field prompt', 'field seconds', 'field size', `file input_reference image/png ${PNG.byteLength}`],
			fields: { model: 'relay-video-1', prompt: 'A bicycle passes the sea at dusk.', seconds: '8', size: '1280x720' },
			fractions: true,
			last: { state: 'succeeded' },
			same: true,
			size: FIXTURE.byteLength
		});
		const wrongKey = error(await pollVideoTask({ ...task, apiKey: 'sk-wrong' }));
		assert.deepEqual(wrongKey, { code: 'auth', message: 'Incorrect API key provided.', status: 401 });
	} finally {
		await mock.close();
	}
});

test('downloads follow at most five redirects and never carry the key to another origin', async () => {
	const cdn = await server((received, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4' });
		response.end(FIXTURE);
	});
	const api = await server((received, response) => {
		const hops = Number(/hops=(?<hops>\d+)/.exec(received.path)?.groups?.hops ?? '0');
		if (received.path.startsWith('/v1/redirect')) {
			response.writeHead(302, { Location: hops > 0 ? `/v1/redirect?hops=${hops - 1}` : `${cdn.url}/signed/video.mp4` });
			response.end();
			return;
		}
		json(response, 404, {});
	});
	try {
		const task = { provider: 'openai' as const, baseUrl: `${api.url}/v1`, apiKey: 'sk-secret-key', model: 'm', remoteId: 'video_1' };
		const target = partPath();
		const followed = value(await downloadVideo({ ...task, videoUrl: `${api.url}/v1/redirect?hops=3`, targetFsPath: target }));
		const tooMany = error(await downloadVideo({ ...task, videoUrl: `${api.url}/v1/redirect?hops=5`, targetFsPath: partPath() }));
		assert.deepEqual({
			size: followed.size,
			keyToApi: api.received.every(entry => entry.headers.authorization === 'Bearer sk-secret-key'),
			keyToCdn: cdn.received.map(entry => entry.headers.authorization ?? null),
			tooMany: tooMany.code
		}, { size: FIXTURE.byteLength, keyToApi: true, keyToCdn: [null], tooMany: 'invalidResponse' });
	} finally {
		await api.close();
		await cdn.close();
	}
});

test('downloads stop at the size limit and refuse what is not an MP4, and leave no file', async () => {
	const files = await server((received, response) => {
		response.writeHead(200, { 'Content-Type': received.path.endsWith('.html') ? 'text/html' : 'video/mp4' });
		response.end(received.path.endsWith('.html') ? Buffer.from('<html>expired</html>'.repeat(4)) : FIXTURE);
	});
	try {
		const task = { provider: 'ark' as const, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'ark-key', model: 'm', remoteId: 'cgt-1' };
		const large = partPath();
		const tooLarge = error(await downloadVideo({ ...task, videoUrl: `${files.url}/video.mp4`, targetFsPath: large }, { maxDownloadBytes: 1000 }));
		const html = partPath();
		const notVideo = error(await downloadVideo({ ...task, videoUrl: `${files.url}/page.html`, targetFsPath: html }));
		const notPart = error(await downloadVideo({ ...task, videoUrl: `${files.url}/video.mp4`, targetFsPath: join(folder, 'video.mp4') }));
		const insecure = error(await downloadVideo({ ...task, videoUrl: 'http://cdn.example.com/video.mp4', targetFsPath: partPath() }));
		assert.deepEqual({
			tooLarge: tooLarge.code,
			notVideo: notVideo.code,
			notPart: notPart.code,
			insecure: insecure.code,
			left: [existsSync(large), existsSync(html)],
			keySent: files.received.some(entry => entry.headers.authorization !== undefined)
		}, { tooLarge: 'tooLarge', notVideo: 'notVideo', notPart: 'rejected', insecure: 'invalidResponse', left: [false, false], keySent: false });
	} finally {
		await files.close();
	}
});

test('Wan video synthesis: text, first frame, and first and last frame requests, and its task states', async () => {
	const wan = await server((received, response) => {
		if (received.method === 'POST' && received.path.endsWith('/video-synthesis')) {
			json(response, 200, { output: { task_id: `task-${wan.received.length}`, task_status: 'PENDING' }, request_id: 'r' });
			return;
		}
		if (received.path === '/api/v1/tasks/task-done') {
			json(response, 200, { output: { task_id: 'task-done', task_status: 'SUCCEEDED', video_url: 'https://dashscope-result.oss.example.com/v.mp4' } });
			return;
		}
		if (received.path === '/api/v1/tasks/task-gone') {
			json(response, 200, { output: { task_id: 'task-gone', task_status: 'UNKNOWN' } });
			return;
		}
		if (received.path === '/api/v1/tasks/task-bad') {
			json(response, 200, { output: { task_id: 'task-bad', task_status: 'FAILED', code: 'DataInspectionFailed', message: 'Input data may contain inappropriate content.' } });
			return;
		}
		if (received.path.endsWith('/cancel')) {
			json(response, 200, { request_id: 'r' });
			return;
		}
		json(response, 400, { code: 'InvalidParameter', message: 'Unexpected request.' });
	});
	try {
		const base = `${wan.url}/api/v1`;
		const text = value(await submitVideoTask(request('dashscope', base, { model: 'wan2.6-t2v', audio: false, resolution: '1080P', ratio: '9:16' })));
		const first = value(await submitVideoTask(request('dashscope', base, { model: 'wan2.6-i2v', ratio: 'adaptive', startFrame: { fsPath: startPng, mimeType: 'image/png' } })));
		const both = value(await submitVideoTask(request('dashscope', base, {
			model: 'wan2.2-kf2v-flash',
			audio: false,
			startFrame: { fsPath: startPng, mimeType: 'image/png' },
			endFrame: { fsPath: startPng, mimeType: 'image/png' }
		})));
		const bodies = wan.received.slice(0, 3).map(entry => ({ path: entry.path, async: entry.headers['x-dashscope-async'], body: JSON.parse(entry.body.toString('utf8'), (_key, item: unknown) => typeof item === 'string' && item.startsWith('data:') ? 'DATA_URL' : item) }));
		const task = { provider: 'dashscope' as const, baseUrl: base, apiKey: 'sk-wan', model: 'wan2.6-t2v', remoteId: 'task-done' };
		assert.deepEqual({
			ids: [text.remoteId, first.remoteId, both.remoteId],
			bodies,
			done: value(await pollVideoTask(task)),
			gone: error(await pollVideoTask({ ...task, remoteId: 'task-gone' })).code,
			bad: value(await pollVideoTask({ ...task, remoteId: 'task-bad' })),
			cancel: value(await cancelVideoTask({ ...task, remoteId: 'task-1' })),
			cancelPath: wan.received.at(-1)?.path,
			auth: wan.received.every(entry => entry.headers.authorization === `Bearer ${entry === wan.received[0] || entry === wan.received[1] || entry === wan.received[2] ? MOCK_VIDEO_PROVIDER_KEY : 'sk-wan'}`)
		}, {
			ids: ['task-1', 'task-2', 'task-3'],
			bodies: [
				{ path: '/api/v1/services/aigc/video-generation/video-synthesis', async: 'enable', body: { model: 'wan2.6-t2v', input: { prompt: 'A bicycle passes the sea at dusk.' }, parameters: { watermark: false, duration: 5, size: '1080*1920' } } },
				{ path: '/api/v1/services/aigc/video-generation/video-synthesis', async: 'enable', body: { model: 'wan2.6-i2v', input: { prompt: 'A bicycle passes the sea at dusk.', img_url: 'DATA_URL' }, parameters: { watermark: false, duration: 5, resolution: '720P' } } },
				{ path: '/api/v1/services/aigc/image2video/video-synthesis', async: 'enable', body: { model: 'wan2.2-kf2v-flash', input: { prompt: 'A bicycle passes the sea at dusk.', first_frame_url: 'DATA_URL', last_frame_url: 'DATA_URL' }, parameters: { watermark: false, duration: 5, audio: false, resolution: '720P' } } }
			],
			done: { state: 'succeeded', videoUrl: 'https://dashscope-result.oss.example.com/v.mp4' },
			gone: 'notFound',
			bad: { state: 'failed', message: 'Input data may contain inappropriate content.' },
			cancel: { cancelled: true },
			cancelPath: '/api/v1/tasks/task-1/cancel',
			auth: true
		});
	} finally {
		await wan.close();
	}
});

test('MiniMax video generation: first and last frames, its own status codes, and the download address of the file', async () => {
	const minimax: Awaited<ReturnType<typeof server>> = await server((received, response) => {
		if (received.method === 'POST' && received.path === '/v1/video_generation') {
			const body = JSON.parse(received.body.toString('utf8'));
			if (body.prompt === 'no money') {
				json(response, 200, { task_id: '', base_resp: { status_code: 1008, status_msg: 'insufficient balance' } });
				return;
			}
			if (received.headers.authorization !== 'Bearer mm-key') {
				json(response, 200, { base_resp: { status_code: 1004, status_msg: 'login fail: Please carry the API secret key in the Authorization field' } });
				return;
			}
			json(response, 200, { task_id: '106916112212032', base_resp: { status_code: 0, status_msg: 'success' } });
			return;
		}
		if (received.path === '/v1/query/video_generation?task_id=106916112212032') {
			json(response, 200, { task_id: '106916112212032', status: 'Success', file_id: 205258526306433, base_resp: { status_code: 0, status_msg: 'success' } });
			return;
		}
		if (received.path === '/v1/files/retrieve?file_id=205258526306433') {
			json(response, 200, { file: { file_id: 205258526306433, download_url: `${minimax.url}/cdn/video.mp4` }, base_resp: { status_code: 0, status_msg: 'success' } });
			return;
		}
		if (received.path === '/cdn/video.mp4') {
			response.writeHead(200, { 'Content-Type': 'video/mp4' });
			response.end(FIXTURE);
			return;
		}
		json(response, 404, {});
	});
	try {
		const base = `${minimax.url}/v1`;
		const submitted = value(await submitVideoTask({
			...request('minimax', base, { model: 'MiniMax-Hailuo-02', resolution: '768P', duration: 6, audio: false, startFrame: { fsPath: startPng, mimeType: 'image/png' }, endFrame: { fsPath: startPng, mimeType: 'image/png' } }),
			apiKey: 'mm-key'
		}));
		const body = JSON.parse(minimax.received[0].body.toString('utf8'), (_key, item: unknown) => typeof item === 'string' && item.startsWith('data:image/png;base64,') ? 'PNG_DATA_URL' : item);
		const noMoney = error(await submitVideoTask({ ...request('minimax', base, { prompt: 'no money' }), apiKey: 'mm-key' }));
		const wrongKey = error(await submitVideoTask({ ...request('minimax', base), apiKey: 'wrong' }));
		const task = { provider: 'minimax' as const, baseUrl: base, apiKey: 'mm-key', model: 'MiniMax-Hailuo-02', remoteId: submitted.remoteId };
		const polled = value(await pollVideoTask(task));
		const target = partPath();
		const downloaded = value(await downloadVideo({ ...task, targetFsPath: target }));
		assert.deepEqual({ remoteId: submitted.remoteId, body, noMoney, wrongKey: wrongKey.code, polled, size: downloaded.size, cancel: value(await cancelVideoTask(task)) }, {
			remoteId: '106916112212032',
			body: { model: 'MiniMax-Hailuo-02', resolution: '768P', prompt: 'A bicycle passes the sea at dusk.', duration: 6, first_frame_image: 'PNG_DATA_URL', last_frame_image: 'PNG_DATA_URL' },
			noMoney: { code: 'rejected', message: 'insufficient balance' },
			wrongKey: 'auth',
			polled: { state: 'succeeded' },
			size: FIXTURE.byteLength,
			cancel: { cancelled: false }
		});
	} finally {
		await minimax.close();
	}
});

test('Veo long-running prediction: inline images, the operation, and a download with the key on its own origin only', async () => {
	const storage = await server((received, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4' });
		response.end(FIXTURE);
	});
	const gemini = await server((received, response) => {
		if (received.method === 'POST' && received.path === '/v1beta/models/veo-3.1-generate-preview:predictLongRunning') {
			json(response, 200, { name: 'models/veo-3.1-generate-preview/operations/op123' });
			return;
		}
		if (received.path === '/v1beta/models/veo-3.1-generate-preview/operations/op123') {
			json(response, 200, { name: 'models/veo-3.1-generate-preview/operations/op123', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${gemini.url}/v1beta/files/abc:download?alt=media` } }] } } });
			return;
		}
		if (received.path === '/v1beta/models/veo-3.1-generate-preview/operations/filtered') {
			json(response, 200, { done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['The prompt was blocked.'] } } });
			return;
		}
		if (received.path === '/v1beta/files/abc:download?alt=media') {
			response.writeHead(302, { Location: `${storage.url}/video.mp4` });
			response.end();
			return;
		}
		json(response, 404, { error: { code: 404, message: 'Not found.' } });
	});
	try {
		const base = `${gemini.url}/v1beta`;
		const submitted = value(await submitVideoTask({
			...request('gemini', base, { model: 'veo-3.1-generate-preview', ratio: '9:16', resolution: '1080p', duration: 8, startFrame: { fsPath: startPng, mimeType: 'image/png' }, endFrame: { fsPath: startPng, mimeType: 'image/png' } }),
			apiKey: 'AIza-test'
		}));
		const sent = JSON.parse(gemini.received[0].body.toString('utf8'));
		const task = { provider: 'gemini' as const, baseUrl: base, apiKey: 'AIza-test', model: 'veo-3.1-generate-preview', remoteId: submitted.remoteId };
		const polled = value(await pollVideoTask(task));
		const filtered = value(await pollVideoTask({ ...task, remoteId: 'models/veo-3.1-generate-preview/operations/filtered' }));
		const traversal = error(await pollVideoTask({ ...task, remoteId: 'models/../../etc' }));
		const downloaded = value(await downloadVideo({ ...task, videoUrl: (polled as { videoUrl: string }).videoUrl, targetFsPath: partPath() }));
		assert.deepEqual({
			remoteId: submitted.remoteId,
			sent: { ...sent, instances: [{ ...sent.instances[0], image: Object.keys(sent.instances[0].image.inlineData), lastFrame: sent.instances[0].lastFrame.inlineData.mimeType }] },
			key: gemini.received.every(entry => entry.headers['x-goog-api-key'] === 'AIza-test' && entry.headers.authorization === undefined),
			filtered,
			traversal: traversal.code,
			size: downloaded.size,
			keyToStorage: storage.received.map(entry => entry.headers['x-goog-api-key'] ?? null)
		}, {
			remoteId: 'models/veo-3.1-generate-preview/operations/op123',
			sent: { instances: [{ prompt: 'A bicycle passes the sea at dusk.', image: ['mimeType', 'data'], lastFrame: 'image/png' }], parameters: { aspectRatio: '9:16', resolution: '1080p', durationSeconds: '8' } },
			key: true,
			filtered: { state: 'failed', message: 'The prompt was blocked.' },
			traversal: 'rejected',
			size: FIXTURE.byteLength,
			keyToStorage: [null]
		});
	} finally {
		await gemini.close();
		await storage.close();
	}
});

test('refuses what it cannot send before anything leaves this computer', async () => {
	const nothing = await server((received, response) => json(response, 500, {}));
	try {
		const base = `${nothing.url}/api/v3`;
		const outcomes = [
			await submitVideoTask(request('ark', base, { referenceVideos: [{ fsPath: startPng, mimeType: 'video/mp4' }] })),
			await submitVideoTask(request('ark', base, { startFrame: { fsPath: join(folder, 'missing.png'), mimeType: 'image/png' } })),
			await submitVideoTask(request('ark', 'http://relay.example.com/api/v3')),
			await submitVideoTask({ ...request('ark', base), apiKey: 'has spaces' }),
			await submitVideoTask({ provider: 'unknown' })
		].map(outcome => error(outcome).code);
		assert.deepEqual({ outcomes, received: nothing.received.length }, { outcomes: ['rejected', 'rejected', 'rejected', 'auth', 'rejected'], received: 0 });
	} finally {
		await nothing.close();
	}
});

test('a provider error answer and an unreadable answer to a request', async () => {
	const failing = await server((received, response) => {
		if (received.path.includes('server-error')) {
			json(response, 503, { error: { message: 'Service is busy.' } });
		} else if (received.path.includes('busy')) {
			json(response, 429, { error: { message: 'Too many requests.' } });
		} else {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end('<html>gateway</html>');
		}
	});
	try {
		const created = (path: string) => submitVideoTask(request('ark', `${failing.url}/${path}`));
		assert.deepEqual({
			serverError: error(await created('server-error')),
			busy: error(await created('busy')).code,
			unreadable: error(await created('html')).code,
			pollServerError: error(await pollVideoTask({ provider: 'ark', baseUrl: `${failing.url}/server-error`, apiKey: 'k-123', model: 'm', remoteId: 'cgt-1' })).code
		}, {
			serverError: { code: 'unknownOutcome', message: 'Service is busy.', status: 503 },
			busy: 'rateLimited',
			unreadable: 'invalidResponse',
			pollServerError: 'network'
		});
	} finally {
		await failing.close();
	}
});

test('sizes a /videos request from the ratio and the resolution', () => {
	assert.deepEqual(
		[['16:9', '720p'], ['9:16', '720p'], ['1:1', '1080p'], ['4:3', '480p'], ['21:9', '720p'], ['adaptive', '720p'], ['16:9', '768P']].map(([ratio, resolution]) => videoSizeFor(ratio, resolution)),
		['1280x720', '720x1280', '1080x1080', '640x480', '1680x720', undefined, '1366x768']
	);
});

test('the key never appears in an error message', async () => {
	const echo = await server((received, response) => json(response, 400, { error: { message: `Bad key ${received.headers.authorization}` } }));
	try {
		const failure = error(await submitVideoTask({ ...request('ark', `${echo.url}/api/v3`), apiKey: 'sk-very-secret-123' }));
		assert.deepEqual(failure, { code: 'rejected', message: 'Bad key Bearer ***', status: 400 });
	} finally {
		await echo.close();
	}
});
