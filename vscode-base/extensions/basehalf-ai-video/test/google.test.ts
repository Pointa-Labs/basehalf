/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../src/providers/commands.ts';
import { GOOGLE, OMNI_PRICE_DATE, omniEstimate, omniPrice } from '../src/providers/google.ts';
import type { MediaInspector } from '../src/providers/media.ts';
import { buildCatalog } from '../src/providers/registry.ts';
import type { CatalogParameter, PollState } from '../src/providers/types.ts';
import { error, isoMedia, jpegHeader, plannedFiles, png, recordingSleep, sendJson, startServer, value, wav, webpHeader, type Received } from './providerTestKit.ts';

const KEY = 'gemini-test-key-0001';
const MODEL = 'gemini-omni-1.1-flash';
const PROMPT = 'A marble rolls down a wooden track in a single continuous shot.';
/** The video a finished interaction answers inline. */
const VIDEO = isoMedia(2);

const folder = mkdtempSync(join(tmpdir(), 'basehalf-google-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

function file(name: string, bytes: Buffer, mimeType: string) {
	const fsPath = join(folder, name);
	writeFileSync(fsPath, bytes);
	return { fsPath, mimeType };
}

function base64(media: { readonly fsPath: string }): string {
	return readFileSync(media.fsPath).toString('base64');
}

const START = file('start.png', png(640, 360), 'image/png');
const END = file('end.jpg', jpegHeader(800, 600), 'image/jpeg');
const STYLE = file('style.webp', webpHeader('VP8X', 512, 512), 'image/webp');
const TAKE = file('take.mov', isoMedia(2, { brand: 'qt  ' }), 'video/quicktime');
const CLIP = file('clip.mp4', isoMedia(4), 'video/mp4');
const LONG_TAKE = file('long-take.mp4', isoMedia(4.5), 'video/mp4');
const LONG_CLIP = file('long-clip.mp4', isoMedia(12), 'video/mp4');
const SHORT_TAKE = file('short-take.mp4', isoMedia(2), 'video/mp4');
/** An MP4 whose length AI Video cannot read. */
const UNREADABLE = file('unreadable.mp4', Buffer.from('not a movie'), 'video/mp4');
const VOICE = file('voice.wav', wav(3), 'audio/wav');
const NO_INPUTS = { images: [], videos: [], audios: [] };

let parts = 0;
function partPath(): string {
	return join(folder, `video-${parts++}.mp4.part`);
}

function commands(options: VideoProviderCommandOptions = {}) {
	return new VideoProviderCommands([GOOGLE], { ...options, http: { sleep: async () => undefined, ...options.http } });
}

function access(endpoint: string, apiKey = KEY) {
	return { provider: 'google', region: 'global', endpoint, credentials: { apiKey } };
}

function generation(mode: string, params: Record<string, unknown>, prompt: string, inputs: Record<string, unknown> = NO_INPUTS) {
	return { model: MODEL, mode, params, prompt, inputs };
}

function taskRef(endpoint: string, remoteId: string, apiKey = KEY) {
	return { ...access(endpoint, apiKey), model: MODEL, remoteId };
}

// --- a local server that answers like the Interactions API --------------------------------------

function interaction(id: string, status: string, steps: readonly unknown[] = [], extra: Record<string, unknown> = {}) {
	return { id, object: 'interaction', model: MODEL, status, created: '2026-10-19T08:00:00Z', updated: '2026-10-19T08:01:30Z', steps, ...extra };
}

/** The stored interaction begins with the user's input, which a poll answers again. */
const USER_INPUT = { type: 'user_input', content: [{ type: 'image', mime_type: 'image/png', data: readFileSync(START.fsPath).toString('base64') }, { type: 'text', text: PROMPT }] };
const THOUGHT = { type: 'thought', content: [{ type: 'thought', text: 'Planning the camera move.' }] };

function videoOutput(content: Record<string, unknown> = { data: VIDEO.toString('base64') }) {
	return { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', ...content }] };
}

const COMPLETED_STEPS = [USER_INPUT, THOUGHT, videoOutput()];

interface Gemini {
	readonly endpoint: string;
	readonly received: Received[];
	/** The bodies of the creates, as JSON. */
	readonly created: Record<string, unknown>[];
	close(): Promise<void>;
}

/**
 * Creates answer an interaction in progress at once, as a background create
 * does; a GET answers the next entry of the interaction's script, then keeps
 * answering its last one; the file of a URI delivery is downloaded with the key.
 */
async function startGemini(script: Readonly<Record<string, readonly unknown[]>> = {}): Promise<Gemini> {
	const created: Record<string, unknown>[] = [];
	const asked = new Map<string, number>();
	const server = await startServer((request, response) => {
		if (request.headers['x-goog-api-key'] !== KEY) {
			sendJson(response, 401, { error: { code: 'authentication', message: 'API key not valid. Please pass a valid API key.' } });
			return;
		}
		if (request.method === 'POST' && request.path === '/v1beta/interactions') {
			created.push(JSON.parse(request.body.toString('utf8')));
			sendJson(response, 200, interaction(`v1_created${created.length}`, 'in_progress'));
			return;
		}
		const get = /^\/v1beta\/interactions\/(?<id>[^/]+)$/.exec(request.path)?.groups?.id;
		if (request.method === 'GET' && get && script[get]) {
			const index = asked.get(get) ?? 0;
			asked.set(get, index + 1);
			sendJson(response, 200, script[get][Math.min(index, script[get].length - 1)]);
			return;
		}
		if (request.method === 'GET' && request.path === '/v1beta/files/abc-123:download?alt=media') {
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.byteLength) });
			response.end(VIDEO);
			return;
		}
		sendJson(response, 404, { error: { code: 'not_found', message: 'The interaction was not found.' } });
	});
	return { endpoint: `${server.url}/v1beta`, received: server.received, created, close: () => server.close() };
}

function summary(parameter: CatalogParameter): string {
	const modes = parameter.modes ? ` [${parameter.modes.join(', ')}]` : '';
	switch (parameter.kind) {
		case 'choice':
			return `${parameter.name}=${parameter.options.map(option => `${option.value} ${option.label}`).join('|')}:${parameter.default}${parameter.display ? ` (${parameter.display})` : ''}${modes}`;
		case 'integer':
		case 'number':
			return `${parameter.name}=${parameter.min}-${parameter.max}:${parameter.default ?? 'unset'}${parameter.optional ? ' optional' : ''}${parameter.advanced ? ' (more)' : ''}${modes}`;
		default:
			return `${parameter.name}:${String(parameter.default)}${modes}`;
	}
}

// --- the catalog -------------------------------------------------------------------------------

test('the catalog entry declares the Gemini API, its key, and Gemini Omni 1.1 Flash with its four modes and settings', () => {
	const provider = buildCatalog([GOOGLE]).providers[0];
	const model = provider.models[0];
	assert.deepEqual({
		id: provider.id,
		label: provider.label,
		regions: provider.regions,
		credentials: provider.credentials,
		models: provider.models.length,
		model: { id: model.id, label: model.label, providerModels: model.providerModels, prompt: model.prompt, estimate: model.estimate, deprecated: model.deprecated },
		modes: model.modes.map(mode => ({ mode: `${mode.id} ${mode.label}`, inputs: mode.inputs, limits: mode.limits })),
		parameters: model.parameters.map(summary)
	}, {
		id: 'google',
		label: 'Google',
		regions: [{ id: 'global', label: 'Gemini API', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', currency: 'USD', console: 'https://aistudio.google.com/api-keys' }],
		credentials: [{ id: 'apiKey', label: 'API Key' }],
		models: 1,
		model: { id: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash', providerModels: { global: 'gemini-omni-1.1-flash' }, prompt: { required: 'always', maxLength: 1_048_576 }, estimate: true, deprecated: undefined },
		modes: [
			{ mode: 'frames Frames', inputs: { startFrame: 'optional', endFrame: 'optional', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: {} },
			{ mode: 'reference References', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 6 }, videos: { min: 0, max: 3 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: { videoSeconds: [0.1, 3] } },
			{ mode: 'edit Edit', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'required' }, limits: { videoSeconds: [0.1, 10] } },
			{ mode: 'extend Extend', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'required' }, limits: { videoSeconds: [0.1, 10] } }
		],
		parameters: [
			'resolution=360p 360p|720p 720p|1080p 1080p|4k 4K:720p',
			'ratio=16:9 16:9|9:16 9:16:16:9 (ratio) [frames, reference]',
			'seed=0-2147483647:unset optional (more)'
		]
	});
	assert.deepEqual(GOOGLE.headers({ apiKey: KEY }), { 'x-goog-api-key': KEY });
});

// --- creating ----------------------------------------------------------------------------------

test('each mode creates one background interaction with its task, its inputs inline as base64, and the prompt last', async () => {
	const gemini = await startGemini();
	try {
		const providers = commands();
		const sent = async (request: ReturnType<typeof generation>) => {
			const { remoteId } = value(await providers.submit({ ...access(gemini.endpoint), ...request }));
			return { remoteId, body: gemini.created.at(-1) };
		};
		const text = await sent(generation('frames', {}, PROMPT));
		const frames = await sent(generation('frames', { resolution: '1080p', ratio: '9:16', seed: 42 }, 'From the forest at dawn to the snowy forest at night.', { startFrame: START, endFrame: END, ...NO_INPUTS }));
		const references = await sent(generation('reference', { resolution: '360p' }, 'The woman in Video 1 holds the lantern of Image 1.', { images: [STYLE], videos: [TAKE], audios: [] }));
		const edit = await sent(generation('edit', { resolution: '4k' }, 'Make the sky stormy. Keep everything else the same.', { source: CLIP, ...NO_INPUTS }));
		const extend = await sent(generation('extend', { seed: 7 }, 'The camera keeps following the car into the tunnel.', { source: CLIP, ...NO_INPUTS }));
		const create = gemini.received[0];
		assert.deepEqual({
			ids: [text, frames, references, edit, extend].map(entry => entry.remoteId),
			request: { method: create.method, path: create.path, key: create.headers['x-goog-api-key'], type: create.headers['content-type'], length: Number(create.headers['content-length']) === create.body.byteLength },
			sent: gemini.received.length
		}, {
			ids: ['v1_created1', 'v1_created2', 'v1_created3', 'v1_created4', 'v1_created5'],
			request: { method: 'POST', path: '/v1beta/interactions', key: KEY, type: 'application/json', length: true },
			sent: 5
		});
		assert.deepEqual(text.body, {
			model: MODEL,
			input: [{ type: 'text', text: PROMPT }],
			generation_config: { video_config: { task: 'text_to_video' } },
			response_format: { type: 'video', resolution: '720p', aspect_ratio: '16:9' },
			background: true
		});
		assert.deepEqual(frames.body, {
			model: MODEL,
			input: [
				{ type: 'image', mime_type: 'image/png', data: base64(START) },
				{ type: 'image', mime_type: 'image/jpeg', data: base64(END) },
				{ type: 'text', text: 'From the forest at dawn to the snowy forest at night.' }
			],
			generation_config: { video_config: { task: 'image_to_video' }, seed: 42 },
			response_format: { type: 'video', resolution: '1080p', aspect_ratio: '9:16' },
			background: true
		});
		assert.deepEqual(references.body, {
			model: MODEL,
			input: [
				{ type: 'image', mime_type: 'image/webp', data: base64(STYLE) },
				{ type: 'video', mime_type: 'video/mov', data: base64(TAKE) },
				{ type: 'text', text: 'The woman in Video 1 holds the lantern of Image 1.' }
			],
			generation_config: { video_config: { task: 'reference_to_video' } },
			response_format: { type: 'video', resolution: '360p', aspect_ratio: '16:9' },
			background: true
		});
		// Edit and Extend keep the clip's shape: no ratio is sent.
		assert.deepEqual(edit.body, {
			model: MODEL,
			input: [{ type: 'video', mime_type: 'video/mp4', data: base64(CLIP) }, { type: 'text', text: 'Make the sky stormy. Keep everything else the same.' }],
			generation_config: { video_config: { task: 'edit' } },
			response_format: { type: 'video', resolution: '4k' },
			background: true
		});
		assert.deepEqual(extend.body, {
			model: MODEL,
			input: [{ type: 'video', mime_type: 'video/mp4', data: base64(CLIP) }, { type: 'text', text: 'The camera keeps following the car into the tunnel.' }],
			generation_config: { video_config: { task: 'extend' }, seed: 7 },
			response_format: { type: 'video', resolution: '720p' },
			background: true
		});
	} finally {
		await gemini.close();
	}
});

test('a create that Google answers with the finished interaction, video included, still gives its id to follow', async () => {
	const large = Buffer.concat([VIDEO, Buffer.alloc(5 * 1024 * 1024, 0x2a)]);
	const finished = interaction('v1_at_once', 'completed', [THOUGHT, videoOutput({ data: large.toString('base64') })]);
	const server = await startServer((_request, response) => sendJson(response, 200, finished));
	try {
		const providers = commands();
		const endpoint = `${server.url}/v1beta`;
		const submitted = value(await providers.submit({ ...access(endpoint), ...generation('frames', {}, PROMPT) }));
		const polled = value(await providers.poll(taskRef(endpoint, submitted.remoteId)));
		assert.deepEqual({ submitted, polled, sent: server.received.map(entry => entry.method) }, {
			submitted: { remoteId: 'v1_at_once' },
			polled: { state: 'succeeded' },
			sent: ['POST', 'GET']
		});
	} finally {
		await server.close();
	}
});

test('a create is sent once: a dropped connection, a server error, and an answer without an id leave the outcome unknown', async () => {
	let mode: 'drop' | 'error' | 'noId' = 'drop';
	const server = await startServer((_request, response, socket) => {
		if (mode === 'drop') {
			socket.destroy();
		} else if (mode === 'error') {
			sendJson(response, 503, { error: { code: 'service_unavailable', message: 'The service is currently unavailable.' } });
		} else {
			sendJson(response, 200, { status: 'in_progress' });
		}
	});
	try {
		const providers = commands();
		const request = { ...access(`${server.url}/v1beta`), ...generation('frames', {}, PROMPT) };
		const dropped = error(await providers.submit(request));
		const droppedSent = server.received.length;
		mode = 'error';
		const failed = error(await providers.submit(request));
		mode = 'noId';
		const noId = error(await providers.submit(request));
		assert.deepEqual({ dropped: dropped.code, droppedSent, failed, noId, sent: server.received.length }, {
			dropped: 'unknownOutcome',
			droppedSent: 1,
			failed: { code: 'unknownOutcome', message: 'The service is currently unavailable.', status: 503 },
			noId: { code: 'unknownOutcome', message: 'Google accepted the request but gave no interaction id AI Video can read.' },
			sent: 3
		});
	} finally {
		await server.close();
	}
});

// --- following ---------------------------------------------------------------------------------

test('a poll follows the interaction from queued through in progress to completed, reading an answer larger than 4 MiB', async () => {
	// A finished video of more than 6 MiB, whose base64 makes an answer over the default limit of 4 MiB.
	const large = Buffer.concat([VIDEO, Buffer.alloc(6 * 1024 * 1024, 0x2a)]);
	const gemini = await startGemini({
		v1_run: [interaction('v1_run', 'queued', [USER_INPUT]), interaction('v1_run', 'in_progress', [USER_INPUT, THOUGHT]), interaction('v1_run', 'completed', [USER_INPUT, THOUGHT, videoOutput({ data: large.toString('base64') })])]
	});
	try {
		const providers = commands();
		const ref = taskRef(gemini.endpoint, 'v1_run');
		const states: PollState[] = [];
		for (let attempt = 0; attempt < 3; attempt++) {
			states.push(value(await providers.poll(ref)));
		}
		const target = partPath();
		const downloaded = value(await providers.download({ ...ref, targetFsPath: target }));
		assert.deepEqual({ states, downloaded, same: readFileSync(target).equals(large), asked: gemini.received.map(entry => `${entry.method} ${entry.path} ${entry.headers['x-goog-api-key'] === KEY}`) }, {
			states: [{ state: 'pending' }, { state: 'running' }, { state: 'succeeded' }],
			downloaded: { size: large.byteLength },
			same: true,
			asked: Array.from({ length: 4 }, () => `GET /v1beta/interactions/v1_run true`)
		});
	} finally {
		await gemini.close();
	}
});

test('a failed, cancelled, incomplete, or waiting interaction, and one completed without a video, end with Google\'s words', async () => {
	const gemini = await startGemini({
		v1_blocked: [interaction('v1_blocked', 'failed', [USER_INPUT], { errors: [{ code: 'safety', message: 'The prompt was blocked by the safety filters.' }] })],
		v1_output_error: [interaction('v1_output_error', 'failed', [USER_INPUT, { type: 'model_output', error: { code: 13, message: 'Video generation failed.' } }])],
		v1_failed: [interaction('v1_failed', 'failed')],
		v1_cancelled: [interaction('v1_cancelled', 'cancelled', [USER_INPUT])],
		v1_incomplete: [interaction('v1_incomplete', 'incomplete', [USER_INPUT, THOUGHT])],
		v1_waiting: [interaction('v1_waiting', 'requires_action', [USER_INPUT])],
		v1_budget: [interaction('v1_budget', 'budget_exceeded')],
		v1_text: [interaction('v1_text', 'completed', [USER_INPUT, { type: 'model_output', content: [{ type: 'text', text: 'I cannot make a video of this person.' }] }])],
		v1_empty: [interaction('v1_empty', 'completed', [USER_INPUT])],
		v1_strange: [interaction('v1_strange', 'paused')]
	});
	try {
		const providers = commands();
		const poll = async (id: string) => {
			const answer = await providers.poll(taskRef(gemini.endpoint, id));
			return answer.ok ? answer.value : answer.error;
		};
		assert.deepEqual({
			blocked: await poll('v1_blocked'),
			outputError: await poll('v1_output_error'),
			failed: await poll('v1_failed'),
			cancelled: await poll('v1_cancelled'),
			incomplete: await poll('v1_incomplete'),
			waiting: await poll('v1_waiting'),
			budget: await poll('v1_budget'),
			text: await poll('v1_text'),
			empty: await poll('v1_empty'),
			strange: await poll('v1_strange'),
			unknown: await poll('v1_nothing')
		}, {
			blocked: { state: 'failed', message: 'The prompt was blocked by the safety filters.' },
			outputError: { state: 'failed', message: 'Video generation failed.' },
			failed: { state: 'failed', message: 'Google reports that the generation failed.' },
			cancelled: { state: 'cancelled', message: 'The generation was cancelled.' },
			incomplete: { state: 'failed', message: 'Google ended the generation without a complete video.' },
			waiting: { state: 'failed', message: 'Google waits for an action on the generation that AI Video cannot take.' },
			budget: { state: 'failed', message: 'Google ended the generation when its budget ran out.' },
			text: { state: 'failed', message: 'Google finished the generation without a video: I cannot make a video of this person.' },
			empty: { state: 'failed', message: 'Google finished the generation without a video.' },
			strange: { code: 'invalidResponse', message: 'Google reports a generation status AI Video does not know: paused.' },
			unknown: { code: 'notFound', message: 'The interaction was not found.', status: 404 }
		});
	} finally {
		await gemini.close();
	}
});

// --- downloading -------------------------------------------------------------------------------

test('the video is written from the interaction\'s base64, or downloaded from the address Google gives, with the key only to its own origin', async () => {
	const cdn = await startServer((_request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.byteLength) });
		response.end(VIDEO);
	});
	const gemini = await startGemini({
		v1_inline: [interaction('v1_inline', 'completed', COMPLETED_STEPS)],
		v1_file: [interaction('v1_file', 'completed', [USER_INPUT, videoOutput({ uri: 'files/abc-123' })])],
		v1_elsewhere: [interaction('v1_elsewhere', 'completed', [USER_INPUT, videoOutput({ uri: `${cdn.url}/v/video.mp4?token=t` })])],
		v1_running: [interaction('v1_running', 'in_progress', [USER_INPUT])]
	});
	try {
		const providers = commands();
		const download = async (id: string, videoUrl?: string) => {
			const target = partPath();
			const answer = await providers.download({ ...taskRef(gemini.endpoint, id), ...(videoUrl ? { videoUrl } : {}), targetFsPath: target });
			return { answer: answer.ok ? answer.value : answer.error, same: existsSync(target) && readFileSync(target).equals(VIDEO), left: existsSync(target) };
		};
		const inlinePoll = value(await providers.poll(taskRef(gemini.endpoint, 'v1_inline')));
		const inline = await download('v1_inline');
		const filePoll = value(await providers.poll(taskRef(gemini.endpoint, 'v1_file'))) as { state: 'succeeded'; videoUrl: string };
		const viaFile = await download('v1_file', filePoll.videoUrl);
		const fileWithoutPoll = await download('v1_file');
		const elsewherePoll = value(await providers.poll(taskRef(gemini.endpoint, 'v1_elsewhere'))) as { state: 'succeeded'; videoUrl: string };
		const elsewhere = await download('v1_elsewhere', elsewherePoll.videoUrl);
		const notReady = await download('v1_running');
		const fileDownloads = gemini.received.filter(entry => entry.path.startsWith('/v1beta/files/'));
		assert.deepEqual({
			inlinePoll,
			inline,
			fileUrl: filePoll.videoUrl,
			viaFile,
			fileWithoutPoll,
			fileKeys: fileDownloads.map(entry => entry.headers['x-goog-api-key']),
			elsewhereUrl: elsewherePoll.videoUrl,
			elsewhere,
			cdnKey: cdn.received.map(entry => entry.headers['x-goog-api-key'] ?? 'none'),
			notReady
		}, {
			inlinePoll: { state: 'succeeded' },
			inline: { answer: { size: VIDEO.byteLength }, same: true, left: true },
			fileUrl: `${gemini.endpoint}/files/abc-123:download?alt=media`,
			viaFile: { answer: { size: VIDEO.byteLength }, same: true, left: true },
			fileWithoutPoll: { answer: { size: VIDEO.byteLength }, same: true, left: true },
			fileKeys: [KEY, KEY],
			elsewhereUrl: `${cdn.url}/v/video.mp4?token=t`,
			elsewhere: { answer: { size: VIDEO.byteLength }, same: true, left: true },
			cdnKey: ['none'],
			notReady: { answer: { code: 'invalidResponse', message: 'The generation has no video yet.' }, same: false, left: false }
		});
	} finally {
		await gemini.close();
		await cdn.close();
	}
});

test('a relay entered as an endpoint without a path gets every call, and the file download, under its origin with one slash', async () => {
	const relay = await startServer((request, response) => {
		if (request.method === 'POST' && request.path === '/interactions') {
			sendJson(response, 200, interaction('v1_relayed', 'in_progress'));
		} else if (request.path === '/interactions/v1_relayed') {
			sendJson(response, 200, interaction('v1_relayed', 'completed', [videoOutput({ uri: 'files/abc-123' })]));
		} else if (request.path === '/files/abc-123:download?alt=media') {
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.byteLength) });
			response.end(VIDEO);
		} else {
			sendJson(response, 404, { error: { code: 'not_found', message: `No such path: ${request.path}` } });
		}
	});
	try {
		const providers = commands();
		const results: unknown[] = [];
		for (const endpoint of [relay.url, `${relay.url}/`]) {
			const { remoteId } = value(await providers.submit({ ...access(endpoint), ...generation('frames', {}, PROMPT) }));
			const polled = value(await providers.poll(taskRef(endpoint, remoteId))) as { state: 'succeeded'; videoUrl: string };
			const target = partPath();
			const downloaded = value(await providers.download({ ...taskRef(endpoint, remoteId), targetFsPath: target }));
			results.push({ remoteId, videoUrl: polled.videoUrl, downloaded, same: readFileSync(target).equals(VIDEO) });
		}
		const expected = { remoteId: 'v1_relayed', videoUrl: `${relay.url}/files/abc-123:download?alt=media`, downloaded: { size: VIDEO.byteLength }, same: true };
		assert.deepEqual({ results, paths: [...new Set(relay.received.map(entry => `${entry.method} ${entry.path} ${entry.headers['x-goog-api-key'] === KEY}`))] }, {
			results: [expected, expected],
			paths: ['POST /interactions true', 'GET /interactions/v1_relayed true', 'GET /files/abc-123:download?alt=media true']
		});
	} finally {
		await relay.close();
	}
});

test('an inline video is written under the checks of a download: only an MP4, at most the size BaseHalf downloads, and no file left', async () => {
	const gemini = await startGemini({
		v1_html: [interaction('v1_html', 'completed', [videoOutput({ data: Buffer.from('<html>not a video</html>').toString('base64') })])],
		v1_short: [interaction('v1_short', 'completed', [videoOutput({ data: Buffer.from('abc').toString('base64') })])],
		v1_inline: [interaction('v1_inline', 'completed', COMPLETED_STEPS)]
	});
	try {
		const small = commands({ download: { maxBytes: 1024 } });
		const download = async (providers: VideoProviderCommands, id: string) => {
			const target = partPath();
			const answer = error(await providers.download({ ...taskRef(gemini.endpoint, id), targetFsPath: target }));
			return { code: answer.code, message: answer.message, left: existsSync(target) };
		};
		const taken = partPath();
		writeFileSync(taken, 'another download');
		const exists = error(await commands().download({ ...taskRef(gemini.endpoint, 'v1_inline'), targetFsPath: taken }));
		assert.deepEqual({
			html: await download(commands(), 'v1_html'),
			short: await download(commands(), 'v1_short'),
			large: await download(small, 'v1_inline'),
			exists: { code: exists.code, kept: readFileSync(taken, 'utf8') }
		}, {
			html: { code: 'notVideo', message: 'The file does not start like an MP4 video.', left: false },
			short: { code: 'notVideo', message: 'The file is too short to be an MP4 video.', left: false },
			large: { code: 'tooLarge', message: `The video is ${VIDEO.byteLength} bytes, more than the 1024 bytes BaseHalf downloads.`, left: false },
			exists: { code: 'rejected', kept: 'another download' }
		});
	} finally {
		await gemini.close();
	}
});

// --- refusals ----------------------------------------------------------------------------------

test('a refused key, a key without permission, too many requests, an empty Prepay balance, and other refusals read Google\'s codes', async () => {
	let polls = 0;
	const server = await startServer((request, response) => {
		const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => sendJson(response, status, body, headers);
		if (request.path.startsWith('/denied/')) {
			answer(403, { error: { code: 'permission_denied', message: 'Your API key was reported as leaked. Please use another API key.' } });
		} else if (request.path.startsWith('/busy/') && request.method === 'POST') {
			answer(429, { error: { code: 'rate_limit_exceeded', message: 'You exceeded your current quota of requests per minute.' } }, { 'Retry-After': '7' });
		} else if (request.path.startsWith('/busy/')) {
			if (polls++ === 0) {
				answer(429, { error: { code: 'too_many_requests', message: 'Too many requests.' } }, { 'Retry-After': '2' });
			} else {
				answer(200, interaction('v1_run', 'in_progress'));
			}
		} else if (request.path.startsWith('/spend/')) {
			answer(429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } });
		} else if (request.path.startsWith('/bare/')) {
			answer(400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
		} else if (request.path.startsWith('/prepay/')) {
			answer(402, { error: { code: 'payment_required', message: 'Your Prepay credit balance is depleted.' } });
		} else if (request.path.startsWith('/billing/')) {
			answer(400, { error: { code: 'failed_precondition', message: 'Billing is not enabled for this project.' } });
		} else if (request.path.startsWith('/model/')) {
			answer(404, { error: { code: 'model_not_found', message: 'The model gemini-omni-1.1-flash was not found.' } });
		} else if (request.path.startsWith('/echo/')) {
			answer(400, { error: { code: 'invalid_request', message: `The key ${request.headers['x-goog-api-key']} cannot be used here.` } });
		} else {
			answer(401, { error: { code: 'authentication', message: 'API key not valid. Please pass a valid API key.' } });
		}
	});
	try {
		const sleep = recordingSleep();
		const lines: string[] = [];
		const providers = commands({ http: { sleep: sleep.sleep, log: { info: line => lines.push(line) } } });
		const submit = async (path: string) => error(await providers.submit({ ...access(`${server.url}${path}v1beta`), ...generation('frames', {}, PROMPT) }));
		const refusedKey = await submit('/');
		const denied = await submit('/denied/');
		const limited = await submit('/busy/');
		const createsSent = server.received.filter(entry => entry.path.startsWith('/busy/')).length;
		const polled = value(await providers.poll(taskRef(`${server.url}/busy/v1beta`, 'v1_run')));
		assert.deepEqual({
			refusedKey,
			denied,
			limited,
			createsSent,
			polled,
			waits: sleep.waits,
			spend: await submit('/spend/'),
			bare: await submit('/bare/'),
			prepay: await submit('/prepay/'),
			billing: await submit('/billing/'),
			model: await submit('/model/'),
			echo: await submit('/echo/'),
			pollRefused: error(await providers.poll(taskRef(`${server.url}/v1beta`, 'v1_run')))
		}, {
			refusedKey: { code: 'auth', message: 'API key not valid. Please pass a valid API key.', status: 401 },
			denied: { code: 'auth', message: 'Your API key was reported as leaked. Please use another API key.', status: 403 },
			limited: { code: 'rateLimited', message: 'You exceeded your current quota of requests per minute. The provider asks to wait 7 seconds.', status: 429 },
			createsSent: 1,
			polled: { state: 'running' },
			waits: [2000],
			spend: { code: 'rateLimited', message: 'Resource has been exhausted (e.g. check quota).', status: 429 },
			bare: { code: 'rejected', message: 'INVALID_ARGUMENT', status: 400 },
			prepay: { code: 'balance', message: 'Your Prepay credit balance is depleted.', status: 402 },
			billing: { code: 'rejected', message: 'Billing is not enabled for this project.', status: 400 },
			model: { code: 'rejected', message: 'The model gemini-omni-1.1-flash was not found.', status: 404 },
			echo: { code: 'rejected', message: 'The key *** cannot be used here.', status: 400 },
			pollRefused: { code: 'auth', message: 'API key not valid. Please pass a valid API key.', status: 401 }
		});
		assert.equal(lines.some(line => line.includes(KEY)), false);
		assert.match(lines[0], /^POST \/v1beta\/interactions 401 \d+ ms$/);
	} finally {
		await server.close();
	}
});

// --- cancelling --------------------------------------------------------------------------------

test('cancel is sent once and without a body; it is taken while the interaction runs and too late once it ended', async () => {
	const server = await startServer((request, response) => {
		const id = /^\/v1beta\/interactions\/(?<id>[^/]+)\/cancel$/.exec(request.path)?.groups?.id;
		if (request.headers['x-goog-api-key'] !== KEY) {
			sendJson(response, 401, { error: { code: 'authentication', message: 'API key not valid. Please pass a valid API key.' } });
		} else if (id === 'v1_run') {
			sendJson(response, 200, interaction('v1_run', 'cancelled', [USER_INPUT]));
		} else if (id === 'v1_cleaning') {
			sendJson(response, 200, interaction('v1_cleaning', 'in_progress'));
		} else if (id === 'v1_quiet') {
			response.writeHead(200);
			response.end();
		} else if (id === 'v1_done') {
			sendJson(response, 200, interaction('v1_done', 'completed', COMPLETED_STEPS));
		} else if (id === 'v1_sync') {
			sendJson(response, 400, { error: { code: 'invalid_request', message: 'Only background interactions that are still running can be cancelled.' } });
		} else {
			sendJson(response, 404, { error: { code: 'not_found', message: 'The interaction was not found.' } });
		}
	});
	try {
		const providers = commands();
		const endpoint = `${server.url}/v1beta`;
		const cancel = async (id: string, apiKey = KEY) => {
			const answer = await providers.cancel(taskRef(endpoint, id, apiKey));
			return answer.ok ? answer.value.cancelled : answer.error.code;
		};
		const outcomes = {
			running: await cancel('v1_run'),
			cleaningUp: await cancel('v1_cleaning'),
			noAnswer: await cancel('v1_quiet'),
			ended: await cancel('v1_done'),
			notBackground: await cancel('v1_sync'),
			unknown: await cancel('v1_gone'),
			refusedKey: await cancel('v1_run', 'wrong-key-0001')
		};
		const first = server.received[0];
		assert.deepEqual({ outcomes, first: { method: first.method, path: first.path, length: first.headers['content-length'], body: first.body.byteLength }, sent: server.received.length }, {
			outcomes: { running: true, cleaningUp: true, noAnswer: true, ended: false, notBackground: false, unknown: false, refusedKey: 'auth' },
			first: { method: 'POST', path: '/v1beta/interactions/v1_run/cancel', length: '0', body: 0 },
			sent: 7
		});
	} finally {
		await server.close();
	}
});

// --- check -------------------------------------------------------------------------------------

test('check reports the inputs each mode takes, the lengths of videos, the prompt rule, and the size of the whole request', async () => {
	const providers = commands();
	const problems = async (mode: string, params: Record<string, unknown>, prompt: string, inputs: Record<string, unknown>, options: VideoProviderCommandOptions = {}) =>
		value(await (options.inspector ? commands(options) : providers).check({ provider: 'google', region: 'global', model: MODEL, mode, params, prompt, inputs })).problems;
	// Three images of 40 MB each are over 100 MB together as base64.
	const large: () => MediaInspector = () => ({ inspect: async () => ({ name: 'large.png', bytes: 40_000_000, format: 'png' as const, width: 4000, height: 3000 }) });
	assert.deepEqual({
		emptyReferences: await problems('reference', {}, 'p', plannedFiles()),
		imageReference: await problems('reference', {}, 'p', plannedFiles({ images: 1 })),
		videoReference: await problems('reference', {}, 'p', { images: [], videos: [SHORT_TAKE], audios: [] }),
		sevenImages: await problems('reference', {}, 'p', plannedFiles({ images: 7 })),
		audio: await problems('reference', {}, 'p', { images: [STYLE], videos: [], audios: [VOICE] }),
		noPrompt: await problems('frames', {}, ' ', { startFrame: START, ...NO_INPUTS }),
		endWithoutStart: await problems('frames', {}, 'p', plannedFiles({ endFrame: true })),
		longTake: await problems('reference', {}, 'p', { images: [], videos: [LONG_TAKE], audios: [] }),
		longClip: await problems('edit', {}, 'p', { source: LONG_CLIP, ...NO_INPUTS }),
		noClip: await problems('extend', {}, 'p', plannedFiles()),
		ratioInEdit: await problems('edit', { ratio: '9:16' }, 'p', plannedFiles({ source: true })),
		square: await problems('frames', { ratio: '1:1' }, 'p', plannedFiles()),
		tooLarge: await problems('reference', {}, 'p', { images: [START, END, STYLE], videos: [], audios: [] }, { inspector: large }),
		fits: await problems('frames', {}, 'p', { startFrame: START, endFrame: END, ...NO_INPUTS })
	}, {
		emptyReferences: ['Gemini Omni 1.1 Flash in References mode needs at least one reference image or video.'],
		imageReference: [],
		videoReference: [],
		sevenImages: ['Gemini Omni 1.1 Flash in References mode takes at most 6 reference images; 7 are planned.'],
		audio: ['Gemini Omni 1.1 Flash in References mode takes no reference audio clips.'],
		noPrompt: ['Write a prompt: Gemini Omni 1.1 Flash needs one.'],
		endWithoutStart: ['An end frame needs a start frame.'],
		longTake: ['Reference video 1 long-take.mp4 is 4.5 seconds long; a video must be 0.1 to 3 seconds.'],
		longClip: ['The source video long-clip.mp4 is 12 seconds long; a video must be 0.1 to 10 seconds.'],
		noClip: ['Gemini Omni 1.1 Flash in Extend mode needs a video to work on.'],
		ratioInEdit: ['Ratio does not apply in Edit mode.'],
		square: ['Ratio cannot be 1:1 for Gemini Omni 1.1 Flash; choose 16:9, 9:16.'],
		// 2,048 + 3 bytes of prompt + 3 × (53,333,336 + 128) = 160,002,443 bytes.
		tooLarge: ['The request with its inputs would be about 160.0 MB; the Gemini API takes at most 100 MB in one request. Use fewer or smaller inputs.'],
		fits: []
	});
	// Nothing is sent for a request check refuses.
	const gemini = await startGemini();
	try {
		const refused = error(await commands({ inspector: large }).submit({ ...access(gemini.endpoint), ...generation('reference', {}, 'p', { images: [START, END, STYLE], videos: [], audios: [] }) }));
		assert.deepEqual({ refused: refused.code, sent: gemini.received.length }, { refused: 'rejected', sent: 0 });
	} finally {
		await gemini.close();
	}
});

// --- estimate ----------------------------------------------------------------------------------

test('the estimate is the seconds of 720p video at 5,792 tokens a second and $17.50 per million tokens, a range since the prompt sets the length', async () => {
	const usd = (min: number, max: number) => ({ currency: 'USD', min, max, priceDate: OMNI_PRICE_DATE });
	// Gemini Developer API pricing of 2026-10-16: 5,792 × $17.50 / 1,000,000 = $0.10136 a second ("approximately $0.10 per second").
	assert.equal(OMNI_PRICE_DATE, '2026-10-16');
	assert.equal(omniPrice(1), 0.10136);
	const providers = commands();
	const checked = async (mode: string, params: Record<string, unknown>, inputs: Record<string, unknown>) =>
		value(await providers.check({ provider: 'google', region: 'global', model: MODEL, mode, params, prompt: PROMPT, inputs })).estimate;
	assert.deepEqual({
		// 1. Frames at 720p, the default: 3 s × $0.10136 = $0.30408 to 10 s × $0.10136 = $1.0136.
		frames: await checked('frames', {}, plannedFiles()),
		// 2. Extend at 720p with the 4-second clip measured: 7 s, $0.70952, to 14 s, $1.41904.
		extendMeasured: await checked('extend', { resolution: '720p' }, { source: CLIP, ...NO_INPUTS }),
		// 3. Extend at 720p of a clip whose length cannot be read: a clip of at most 10 s gives 3 s, $0.30408, to 20 s, $2.0272.
		extendUnreadable: await checked('extend', {}, { source: UNREADABLE, ...NO_INPUTS }),
		references: await checked('reference', { ratio: '9:16' }, plannedFiles({ images: 2 })),
		edit: await checked('edit', {}, { source: CLIP, ...NO_INPUTS }),
		// Google gives a rate for 720p only.
		at1080p: await checked('frames', { resolution: '1080p' }, plannedFiles()),
		at4k: await checked('edit', { resolution: '4k' }, plannedFiles({ source: true }))
	}, {
		frames: usd(0.30408, 1.0136),
		extendMeasured: usd(0.70952, 1.41904),
		extendUnreadable: usd(0.30408, 2.0272),
		references: usd(0.30408, 1.0136),
		edit: usd(0.30408, 1.0136),
		at1080p: undefined,
		at4k: undefined
	});
	assert.deepEqual(omniEstimate('extend', { resolution: '720p' }, 2.5), usd(0.557480, 1.26700));
	assert.equal(omniEstimate('frames', { resolution: '360p' }), undefined);
});
