/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../../node/commands.js';
import { GOOGLE } from '../../node/google.js';
import type { MediaInspector } from '../../node/media.js';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import type { CatalogParameter, PollState } from '../../common/basehalfProviderTypes.js';
import { remoteIdOf, remoteIdIn, error, isoMedia, jpegHeader, partTargets, plannedFiles, png, recordingSleep, sendJson, startServer, tinyJpeg, tinyPng, value, wav, webpHeader, type Received } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: google', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const KEY = 'gemini-test-key-0001';
	const MODEL = 'gemini-omni-1.1-flash';
	const PROMPT = 'A marble rolls down a wooden track in a single continuous shot.';
	/** The video a finished interaction answers inline. */
	const VIDEO = isoMedia(2);

	const folder = mkdtempSync(join(tmpdir(), 'basehalf-google-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

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

	function generation(mode: string, params: Record<string, unknown>, prompt: string, inputs: object = NO_INPUTS) {
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
				return `${parameter.name}=${parameter.options.map(option => `${option.value} ${option.label}`).join('|')}:${parameter.default}${parameter.display ? ` (${parameter.display})` : ''}${parameter.advanced ? ' (more)' : ''}${modes}`;
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
			videoModels: provider.models.filter(entry => entry.kind === 'video').length,
			model: { id: model.id, label: model.label, providerModels: model.providerModels, prompt: model.prompt, deprecated: model.deprecated },
			modes: model.modes.map(mode => ({ mode: `${mode.id} ${mode.label}`, inputs: mode.inputs, limits: mode.limits })),
			parameters: model.parameters.map(summary)
		}, {
			id: 'google',
			label: 'Google',
			regions: [{ id: 'global', label: 'Gemini API', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', console: 'https://aistudio.google.com/api-keys' }],
			credentials: [{ id: 'apiKey', label: 'API Key' }],
			videoModels: 1,
			model: { id: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash', providerModels: { global: 'gemini-omni-1.1-flash' }, prompt: { required: 'always', maxLength: 1_048_576 }, deprecated: undefined },
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
				const remoteId = remoteIdOf(await providers.submit({ ...access(gemini.endpoint), ...request }));
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
			const polled = value(await providers.poll(taskRef(endpoint, remoteIdIn(submitted))));
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
				noId: { code: 'unknownOutcome', message: 'Google accepted the request but gave no interaction id BaseHalf can read.' },
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
				downloaded: { size: large.byteLength, format: 'mp4' },
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
				waiting: { state: 'failed', message: 'Google waits for an action on the generation that BaseHalf cannot take.' },
				budget: { state: 'failed', message: 'Google ended the generation when its budget ran out.' },
				text: { state: 'failed', message: 'Google finished the generation without a video: I cannot make a video of this person.' },
				empty: { state: 'failed', message: 'Google finished the generation without a video.' },
				strange: { code: 'invalidResponse', message: 'Google reports a generation status BaseHalf does not know: paused.' },
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
				inline: { answer: { size: VIDEO.byteLength, format: 'mp4' }, same: true, left: true },
				fileUrl: `${gemini.endpoint}/files/abc-123:download?alt=media`,
				viaFile: { answer: { size: VIDEO.byteLength, format: 'mp4' }, same: true, left: true },
				fileWithoutPoll: { answer: { size: VIDEO.byteLength, format: 'mp4' }, same: true, left: true },
				fileKeys: [KEY, KEY],
				elsewhereUrl: `${cdn.url}/v/video.mp4?token=t`,
				elsewhere: { answer: { size: VIDEO.byteLength, format: 'mp4' }, same: true, left: true },
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
				const remoteId = remoteIdOf(await providers.submit({ ...access(endpoint), ...generation('frames', {}, PROMPT) }));
				const polled = value(await providers.poll(taskRef(endpoint, remoteId))) as { state: 'succeeded'; videoUrl: string };
				const target = partPath();
				const downloaded = value(await providers.download({ ...taskRef(endpoint, remoteId), targetFsPath: target }));
				results.push({ remoteId, videoUrl: polled.videoUrl, downloaded, same: readFileSync(target).equals(VIDEO) });
			}
			const expected = { remoteId: 'v1_relayed', videoUrl: `${relay.url}/files/abc-123:download?alt=media`, downloaded: { size: VIDEO.byteLength, format: 'mp4' }, same: true };
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
		const problems = async (mode: string, params: Record<string, unknown>, prompt: string, inputs: object, options: VideoProviderCommandOptions = {}) =>
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

	// --- image models ----------------------------------------------------------------------------------

	const BANANA = 'gemini-nano-banana-2.1';
	const PRO = 'gemini-3-pro-image';
	const LITE = 'gemini-3.1-flash-lite-image';
	const FLASH = 'gemini-3.1-flash-image';
	const IMAGE_PROMPT = 'A paper lantern floating over a night market.';
	const FREE_TIER = 'Google offers this model only on a paid tier, and the project of this API key is on the free tier. Set up billing for the project in Google AI Studio, or use the key of a project that has it.';

	function imageGeneration(model: string, params: Record<string, unknown>, prompt: string, images: readonly unknown[] = []) {
		return { model, mode: 'reference', params, prompt, inputs: { images, videos: [], audios: [] } };
	}

	/** A request for an image model, with the one target its image is written to. */
	function imageRequest(endpoint: string, model: string, params: Record<string, unknown> = {}, images: readonly unknown[] = [], prompt = IMAGE_PROMPT) {
		return { ...access(endpoint), ...imageGeneration(model, params, prompt, images), targets: partTargets(1) };
	}

	/** An image content block, as Google answers it inside a step. */
	function imageBlock(bytes: Buffer, mimeType = 'image/jpeg') {
		return { type: 'image', mime_type: mimeType, data: bytes.toString('base64') };
	}

	function imageOutputStep(...content: unknown[]) {
		return { type: 'model_output', content };
	}

	/** A thought step with an interim image, which is not an output. */
	const THOUGHT_IMAGE = { type: 'thought', summary: [{ type: 'text', text: 'Placing the lantern.' }, imageBlock(tinyPng(), 'image/png')] };

	/**
	 * A local server that answers like the Interactions API for image models: each
	 * create gets the next of `answers` (`drop` closes the connection after the
	 * request arrived); a GET answers the next entry of an interaction's script;
	 * the file of a URI delivery is downloaded with the key.
	 */
	async function startImageGemini(answers: readonly (readonly [number, unknown] | 'drop')[], script: Readonly<Record<string, readonly unknown[]>> = {}) {
		const created: Record<string, unknown>[] = [];
		const asked = new Map<string, number>();
		const server = await startServer((request, response, socket) => {
			if (request.headers['x-goog-api-key'] !== KEY) {
				sendJson(response, 401, { error: { code: 'authentication', message: 'API key not valid. Please pass a valid API key.' } });
				return;
			}
			if (request.method === 'POST' && request.path === '/v1beta/interactions') {
				created.push(JSON.parse(request.body.toString('utf8')));
				const answer = answers[Math.min(created.length, answers.length) - 1];
				if (answer === 'drop') {
					socket.destroy();
				} else {
					sendJson(response, answer[0], answer[1]);
				}
				return;
			}
			const get = /^\/v1beta\/interactions\/(?<id>[^/]+)$/.exec(request.path)?.groups?.id;
			if (request.method === 'GET' && get && script[get]) {
				const index = asked.get(get) ?? 0;
				asked.set(get, index + 1);
				sendJson(response, 200, script[get][Math.min(index, script[get].length - 1)]);
				return;
			}
			if (request.method === 'GET' && request.path === '/v1beta/files/img-1:download?alt=media') {
				const image = tinyJpeg();
				response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(image.byteLength) });
				response.end(image);
				return;
			}
			sendJson(response, 404, { error: { code: 'not_found', message: 'The interaction was not found.' } });
		});
		return { endpoint: `${server.url}/v1beta`, received: server.received, created, close: () => server.close() };
	}

	/** A finished image interaction, as a create answers it: an interim image while thinking, then the image. */
	function finishedImage(id: string, image = tinyJpeg()) {
		return interaction(id, 'completed', [THOUGHT_IMAGE, imageOutputStep(imageBlock(image))]);
	}

	const TEN_RATIOS = 'ratio=adaptive Adaptive|1:1 1:1|16:9 16:9|9:16 9:16|4:3 4:3|3:4 3:4|3:2 3:2|2:3 2:3|5:4 5:4|4:5 4:5|21:9 21:9:adaptive (ratio)';
	const FOURTEEN_RATIOS = 'ratio=adaptive Adaptive|1:1 1:1|16:9 16:9|9:16 9:16|4:3 4:3|3:4 3:4|3:2 3:2|2:3 2:3|5:4 5:4|4:5 4:5|21:9 21:9|4:1 4:1|1:4 1:4|8:1 8:1|1:8 1:8:adaptive (ratio)';

	test('the catalog declares four image models that answer at once with JPEG, each with its ratios, resolutions, thinking levels, and prompt bound', () => {
		const provider = buildCatalog([GOOGLE]).providers[0];
		const images = provider.models.filter(model => model.kind === 'image');
		const references = { id: 'reference', label: 'References', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 14 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: {} };
		assert.deepEqual(images.map(model => ({
			id: model.id,
			label: model.label,
			sentAs: model.providerModels,
			prompt: model.prompt,
			outputFormat: model.outputFormat,
			answersAtOnce: model.answersAtOnce,
			deprecated: model.deprecated,
			modes: model.modes,
			parameters: model.parameters.map(summary)
		})), [
			{
				id: BANANA, label: 'Nano Banana 2.1', sentAs: { global: BANANA }, prompt: { required: 'always', maxLength: 131_072 }, outputFormat: 'jpeg', answersAtOnce: true, deprecated: undefined, modes: [references],
				parameters: [FOURTEEN_RATIOS, 'resolution=1k 1K|2k 2K|4k 4K:1k', 'thinking_level=minimal Minimal|medium Medium|high High:medium (more)']
			},
			{
				id: PRO, label: 'Nano Banana Pro', sentAs: { global: PRO }, prompt: { required: 'always', maxLength: 65_536 }, outputFormat: 'jpeg', answersAtOnce: true, deprecated: undefined, modes: [references],
				parameters: [TEN_RATIOS, 'resolution=1k 1K|2k 2K|4k 4K:1k']
			},
			{
				id: LITE, label: 'Nano Banana 2 Lite', sentAs: { global: LITE }, prompt: { required: 'always', maxLength: 65_536 }, outputFormat: 'jpeg', answersAtOnce: true, deprecated: undefined, modes: [references],
				parameters: [TEN_RATIOS, 'resolution=1k 1K:1k', 'thinking_level=minimal Minimal|high High:minimal (more)']
			},
			{
				id: FLASH, label: 'Nano Banana 2', sentAs: { global: FLASH }, prompt: { required: 'always', maxLength: 131_072 }, outputFormat: 'jpeg', answersAtOnce: true, deprecated: true, modes: [references],
				parameters: [FOURTEEN_RATIOS, 'resolution=1k 1K|2k 2K|4k 4K:1k', 'thinking_level=minimal Minimal|high High:minimal (more)']
			}
		]);
		assert.deepEqual(images[0].parameters.map(parameter => parameter.tooltip), [
			'The shape of the image. Adaptive follows the shape of the reference images, or makes a square without them.',
			'1K, 2K, and 4K images have about 1, 4, and 16 million pixels.',
			'How much the model reasons before it draws. More thinking can help a complex image and takes longer.'
		]);
		assert.deepEqual(buildCatalog(PROVIDER_MODULES).providers.find(entry => entry.id === 'google')?.models.map(model => `${model.kind} ${model.id}`), [
			`video ${MODEL}`, `image ${BANANA}`, `image ${PRO}`, `image ${LITE}`, `image ${FLASH}`
		]);
	});

	test('an image request sends the prompt, then each reference image as base64, once and not in the background, and writes the image it answers', async () => {
		const gemini = await startImageGemini([[200, finishedImage('v1_image')]]);
		try {
			const providers = commands();
			const cases: readonly { readonly model: string; readonly params: Record<string, unknown>; readonly images?: readonly { readonly fsPath: string }[]; readonly prompt?: string; readonly body: () => unknown }[] = [
				{
					// The defaults: Adaptive sends no ratio, 1K, and the model's thinking level.
					model: BANANA, params: {},
					body: () => ({ model: BANANA, input: [{ type: 'text', text: IMAGE_PROMPT }], response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K' }, generation_config: { thinking_level: 'medium' } })
				},
				{
					model: BANANA, params: { ratio: '8:1', resolution: '4k', thinking_level: 'high' }, images: [START, END, STYLE], prompt: 'Put the lantern of Image 1 into the market of Image 2, painted like Image 3.',
					body: () => ({
						model: BANANA,
						input: [
							{ type: 'text', text: 'Put the lantern of Image 1 into the market of Image 2, painted like Image 3.' },
							{ type: 'image', mime_type: 'image/png', data: base64(START) },
							{ type: 'image', mime_type: 'image/jpeg', data: base64(END) },
							{ type: 'image', mime_type: 'image/webp', data: base64(STYLE) }
						],
						response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '4K', aspect_ratio: '8:1' },
						generation_config: { thinking_level: 'high' }
					})
				},
				{
					// Pro always thinks: no thinking level is sent.
					model: PRO, params: {},
					body: () => ({ model: PRO, input: [{ type: 'text', text: IMAGE_PROMPT }], response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K' } })
				},
				{
					model: PRO, params: { ratio: '21:9', resolution: '2k' }, images: [START],
					body: () => ({ model: PRO, input: [{ type: 'text', text: IMAGE_PROMPT }, { type: 'image', mime_type: 'image/png', data: base64(START) }], response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '2K', aspect_ratio: '21:9' } })
				},
				{
					model: LITE, params: { ratio: '4:5', thinking_level: 'high' },
					body: () => ({ model: LITE, input: [{ type: 'text', text: IMAGE_PROMPT }], response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K', aspect_ratio: '4:5' }, generation_config: { thinking_level: 'high' } })
				},
				{
					model: LITE, params: {}, images: [END],
					body: () => ({ model: LITE, input: [{ type: 'text', text: IMAGE_PROMPT }, { type: 'image', mime_type: 'image/jpeg', data: base64(END) }], response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K' }, generation_config: { thinking_level: 'minimal' } })
				},
				{
					// A deprecated model still runs for the cards that use it.
					model: FLASH, params: { ratio: '1:8', thinking_level: 'high' },
					body: () => ({ model: FLASH, input: [{ type: 'text', text: IMAGE_PROMPT }], response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K', aspect_ratio: '1:8' }, generation_config: { thinking_level: 'high' } })
				},
				{
					model: FLASH, params: { resolution: '4k' }, images: [STYLE, START],
					body: () => ({
						model: FLASH,
						input: [{ type: 'text', text: IMAGE_PROMPT }, { type: 'image', mime_type: 'image/webp', data: base64(STYLE) }, { type: 'image', mime_type: 'image/png', data: base64(START) }],
						response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '4K' },
						generation_config: { thinking_level: 'minimal' }
					})
				}
			];
			const outcomes = [];
			for (const entry of cases) {
				const request = imageRequest(gemini.endpoint, entry.model, entry.params, entry.images ?? [], entry.prompt);
				const answer = value(await providers.submit(request));
				outcomes.push({ answer, image: readFileSync(request.targets[0]).equals(tinyJpeg()), body: gemini.created.at(-1) });
				assert.deepEqual(answer, { outputs: [{ written: request.targets[0], size: tinyJpeg().byteLength, format: 'jpeg' }] });
			}
			assert.deepEqual(outcomes.map(outcome => ({ image: outcome.image, body: outcome.body })), cases.map(entry => ({ image: true, body: entry.body() })));
			const create = gemini.received[0];
			assert.deepEqual({
				request: { method: create.method, path: create.path, key: create.headers['x-goog-api-key'], type: create.headers['content-type'] },
				sent: gemini.received.map(entry => `${entry.method} ${entry.path}`)
			}, {
				request: { method: 'POST', path: '/v1beta/interactions', key: KEY, type: 'application/json' },
				sent: cases.map(() => 'POST /v1beta/interactions')
			});
		} finally {
			await gemini.close();
		}
	});

	test('the image of an answer is its output\'s last image, and an answer without one, a failed one, a blocked one, or an unfinished one is refused with Google\'s words', async () => {
		const gemini = await startImageGemini([
			[200, interaction('v1_two', 'completed', [THOUGHT_IMAGE, imageOutputStep(imageBlock(tinyPng(), 'image/png'), imageBlock(tinyJpeg()))])],
			[200, interaction('v1_png', 'completed', [imageOutputStep(imageBlock(tinyPng(), 'image/jpeg'))])],
			[200, interaction('v1_text', 'completed', [imageOutputStep({ type: 'text', text: 'I cannot make an image of a real person.' })])],
			[200, interaction('v1_empty', 'completed')],
			[200, interaction('v1_blocked', 'failed', [], { errors: [{ code: 'image_safety', message: 'The image was blocked by the safety filters.' }] })],
			[200, interaction('v1_short', 'incomplete', [THOUGHT_IMAGE])],
			[200, interaction('v1_waiting', 'requires_action')],
			[200, interaction('v1_file', 'completed', [imageOutputStep({ type: 'image', mime_type: 'image/jpeg', uri: 'files/img-1' })])],
			[200, interaction('v1_strange', 'paused')],
			[200, { status: 'in_progress' }]
		]);
		try {
			const providers = commands();
			const submit = async () => {
				const request = imageRequest(gemini.endpoint, BANANA);
				const answer = await providers.submit(request);
				return { answer: answer.ok ? answer.value : answer.error, targets: request.targets };
			};
			const two = await submit();
			const asPng = await submit();
			const outcomes = {
				text: (await submit()).answer,
				empty: (await submit()).answer,
				blocked: (await submit()).answer,
				short: (await submit()).answer,
				waiting: (await submit()).answer
			};
			const file = await submit();
			const fileUrl = (file.answer as { outputs: { url: string }[] }).outputs[0].url;
			const target = partTargets(1)[0];
			const downloaded = value(await providers.download({ ...access(gemini.endpoint), model: BANANA, kind: 'image', url: fileUrl, targetFsPath: target }));
			const strange = (await submit()).answer;
			const noId = (await submit()).answer;
			assert.deepEqual({
				two: two.answer,
				lastKept: readFileSync(two.targets[0]).equals(tinyJpeg()),
				asPng: asPng.answer,
				...outcomes,
				fileUrl,
				downloaded,
				fileKey: gemini.received.find(entry => entry.path.startsWith('/v1beta/files/'))?.headers['x-goog-api-key'],
				strange,
				noId,
				sent: gemini.created.length
			}, {
				two: { outputs: [{ written: two.targets[0], size: tinyJpeg().byteLength, format: 'jpeg' }] },
				lastKept: true,
				// Google named JPEG; the bytes are a PNG, and they decide.
				asPng: { outputs: [{ written: asPng.targets[0], size: tinyPng().byteLength, format: 'png' }] },
				text: { outputs: [{ refused: 'Google finished the generation without an image: I cannot make an image of a real person.' }] },
				empty: { outputs: [{ refused: 'Google finished the generation without an image.' }] },
				blocked: { outputs: [{ refused: 'The image was blocked by the safety filters.' }] },
				short: { outputs: [{ refused: 'Google ended the generation before the image was finished.' }] },
				waiting: { outputs: [{ refused: 'Google waits for an action on the generation that BaseHalf cannot take.' }] },
				fileUrl: `${gemini.endpoint}/files/img-1:download?alt=media`,
				downloaded: { size: tinyJpeg().byteLength, format: 'jpeg' },
				fileKey: KEY,
				strange: { code: 'unknownOutcome', message: 'Google reports a generation status BaseHalf does not know: paused.' },
				noId: { code: 'unknownOutcome', message: 'Google accepted the request but gave no interaction id BaseHalf can read.' },
				sent: 10
			});
		} finally {
			await gemini.close();
		}
	});

	test('an image interaction that Google answers before it ends is followed by its id, and its image lands on the targets named with the task', async () => {
		const gemini = await startImageGemini([[200, interaction('v1_image_run', 'in_progress')]], {
			v1_image_run: [interaction('v1_image_run', 'queued'), interaction('v1_image_run', 'in_progress'), finishedImage('v1_image_run')],
			v1_image_text: [interaction('v1_image_text', 'completed', [imageOutputStep({ type: 'text', text: 'No image this time.' })])],
			v1_image_failed: [interaction('v1_image_failed', 'failed', [], { errors: [{ code: 'no_image', message: 'The model was unable to generate an image.' }] })]
		});
		try {
			const providers = commands();
			const submitted = value(await providers.submit(imageRequest(gemini.endpoint, BANANA)));
			const targets = partTargets(1);
			const ref = (remoteId: string) => ({ ...access(gemini.endpoint), model: BANANA, remoteId, targets });
			const states: PollState[] = [];
			for (let attempt = 0; attempt < 3; attempt++) {
				states.push(value(await providers.poll(ref('v1_image_run'))));
			}
			assert.deepEqual({
				submitted,
				states,
				image: readFileSync(targets[0]).equals(tinyJpeg()),
				text: value(await providers.poll(ref('v1_image_text'))),
				failed: value(await providers.poll(ref('v1_image_failed'))),
				asked: gemini.received.filter(entry => entry.method === 'GET').map(entry => entry.path)
			}, {
				submitted: { remoteId: 'v1_image_run' },
				states: [{ state: 'pending' }, { state: 'running' }, { state: 'succeeded', outputs: [{ written: targets[0], size: tinyJpeg().byteLength, format: 'jpeg' }] }],
				image: true,
				text: { state: 'failed', message: 'Google finished the generation without an image: No image this time.' },
				failed: { state: 'failed', message: 'The model was unable to generate an image.' },
				asked: ['/v1beta/interactions/v1_image_run', '/v1beta/interactions/v1_image_run', '/v1beta/interactions/v1_image_run', '/v1beta/interactions/v1_image_text', '/v1beta/interactions/v1_image_failed']
			});
		} finally {
			await gemini.close();
		}
	});

	test('an image request reads a refused key, an empty balance, too many requests, a free-tier key, a blocked prompt, and a server error, and is sent once', async () => {
		const server = await startServer((request, response, socket) => {
			const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => sendJson(response, status, body, headers);
			const prefix = request.path.split('/')[1];
			switch (prefix) {
				case 'key':
					return answer(401, { error: { code: 'authentication', message: 'API key not valid. Please pass a valid API key.' } });
				case 'prepay':
					return answer(402, { error: { code: 'payment_required', message: 'Your Prepay credit balance is depleted.' } });
				case 'busy':
					return answer(429, { error: { code: 'rate_limit_exceeded', message: 'You exceeded your current quota of images per minute.' } }, { 'Retry-After': '7' });
				case 'free':
					return answer(429, { error: { code: 'quota_exceeded', message: 'You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3-pro-image' } });
				case 'free-details':
					return answer(429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
				case 'country':
					return answer(400, { error: { code: 'failed_precondition', message: 'Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.' } });
				case 'blocked':
					return answer(400, { error: { code: 'image_safety', message: 'The prompt could not be submitted: it may violate the policy on harmful content.' } });
				case 'down':
					return answer(503, { error: { code: 'service_unavailable', message: 'The service is currently unavailable.' } });
				default:
					socket.destroy();
			}
		});
		try {
			const providers = commands();
			const submit = async (prefix: string, model = PRO) => error(await providers.submit(imageRequest(`${server.url}/${prefix}/v1beta`, model)));
			const outcomes = {
				key: await submit('key'),
				prepay: await submit('prepay'),
				busy: await submit('busy'),
				free: await submit('free'),
				freeDetails: await submit('free-details'),
				country: await submit('country'),
				blocked: await submit('blocked'),
				down: await submit('down'),
				dropped: (await submit('drop')).code,
				// The video model is not offered on the free tier either.
				freeVideo: error(await providers.submit({ ...access(`${server.url}/free/v1beta`), ...generation('frames', {}, PROMPT) }))
			};
			assert.deepEqual({ outcomes, sent: server.received.map(entry => entry.path.split('/')[1]) }, {
				outcomes: {
					key: { code: 'auth', message: 'API key not valid. Please pass a valid API key.', status: 401 },
					prepay: { code: 'balance', message: 'Your Prepay credit balance is depleted.', status: 402 },
					busy: { code: 'rateLimited', message: 'You exceeded your current quota of images per minute. The provider asks to wait 7 seconds.', status: 429 },
					free: { code: 'auth', message: FREE_TIER, status: 429 },
					freeDetails: { code: 'auth', message: FREE_TIER, status: 429 },
					country: { code: 'auth', message: FREE_TIER, status: 400 },
					blocked: { code: 'rejected', message: 'The prompt could not be submitted: it may violate the policy on harmful content.', status: 400 },
					down: { code: 'unknownOutcome', message: 'The service is currently unavailable.', status: 503 },
					dropped: 'unknownOutcome',
					freeVideo: { code: 'auth', message: FREE_TIER, status: 429 }
				},
				sent: ['key', 'prepay', 'busy', 'free', 'free-details', 'country', 'blocked', 'down', 'drop', 'free']
			});
		} finally {
			await server.close();
		}
	});

	test('check of an image model reports too many images, a value the model does not take, the prompt rule, other inputs, and the size of the request; nothing is sent then', async () => {
		const large: () => MediaInspector = () => ({ inspect: async () => ({ name: 'large.png', bytes: 40_000_000, format: 'png' as const, width: 4000, height: 3000 }) });
		const problems = async (model: string, params: Record<string, unknown>, prompt: string, inputs: object, options: VideoProviderCommandOptions = {}, mode = 'reference') =>
			value(await commands(options).check({ provider: 'google', region: 'global', model, mode, params, prompt, inputs })).problems;
		assert.deepEqual({
			textOnly: await problems(BANANA, {}, 'p', plannedFiles()),
			fourteen: await problems(BANANA, { ratio: '4:1', resolution: '2k' }, 'p', plannedFiles({ images: 14 })),
			fifteen: await problems(BANANA, {}, 'p', plannedFiles({ images: 15 })),
			wideOnPro: await problems(PRO, { ratio: '8:1' }, 'p', plannedFiles()),
			liteAt2k: await problems(LITE, { resolution: '2k' }, 'p', plannedFiles()),
			thinkingOnPro: await problems(PRO, { thinking_level: 'high' }, 'p', plannedFiles()),
			mediumOnLite: await problems(LITE, { thinking_level: 'medium' }, 'p', plannedFiles()),
			noPrompt: await problems(BANANA, {}, ' ', plannedFiles({ images: 1 })),
			longPrompt: await problems(PRO, {}, 'x'.repeat(65_537), plannedFiles()),
			video: await problems(BANANA, {}, 'p', plannedFiles({ videos: 1 })),
			frames: await problems(BANANA, {}, 'p', plannedFiles(), {}, 'frames'),
			tooLarge: await problems(BANANA, {}, 'p', { images: [START, END, STYLE], videos: [], audios: [] }, { inspector: large })
		}, {
			textOnly: [],
			fourteen: [],
			fifteen: ['Nano Banana 2.1 in References mode takes at most 14 reference images; 15 are planned.'],
			wideOnPro: ['Ratio cannot be 8:1 for Nano Banana Pro; choose Adaptive, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 5:4, 4:5, 21:9.'],
			liteAt2k: ['Resolution cannot be 2k for Nano Banana 2 Lite; choose 1K.'],
			thinkingOnPro: ['Nano Banana Pro has no setting named "thinking_level".'],
			mediumOnLite: ['Thinking cannot be medium for Nano Banana 2 Lite; choose Minimal, High.'],
			noPrompt: ['Write a prompt: Nano Banana 2.1 needs one.'],
			longPrompt: ['The prompt is 65537 characters long; Nano Banana Pro takes at most 65536.'],
			video: ['Nano Banana 2.1 in References mode takes no reference videos.'],
			frames: ['Nano Banana 2.1 has no frames mode.'],
			tooLarge: ['The request with its inputs would be about 160.0 MB; the Gemini API takes at most 100 MB in one request. Use fewer or smaller inputs.']
		});
		const gemini = await startImageGemini([[200, finishedImage('v1_never')]]);
		try {
			const refused = [
				error(await commands().submit({ ...access(gemini.endpoint), ...imageGeneration(BANANA, {}, 'p', plannedFiles({ images: 15 }).images), targets: partTargets(1) })),
				error(await commands({ inspector: large }).submit({ ...access(gemini.endpoint), ...imageGeneration(BANANA, {}, 'p', [START, END, STYLE]), targets: partTargets(1) })),
				// A model that answers at once is sent nothing without a target to write its image to.
				error(await commands().submit({ ...access(gemini.endpoint), ...imageGeneration(BANANA, {}, 'p') }))
			];
			assert.deepEqual({ refused: refused.map(entry => entry.code), sent: gemini.received.length }, { refused: ['rejected', 'rejected', 'rejected'], sent: 0 });
		} finally {
			await gemini.close();
		}
	});
});
