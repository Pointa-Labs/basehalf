/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * A local video provider for tests and the smoke (D58). It speaks the Seedance
 * task API (as Volcengine Ark and BytePlus ModelArk do) under `/api/v3` and
 * the `/videos` task API (as OpenAI and relays do) under `/v1`, accepts one
 * test key, moves each task from queued to running to succeeded over a few
 * seconds, and serves a small MP4 made for these tests. It never talks to a
 * real provider.
 *
 *   node --experimental-strip-types scripts/basehalf-video-mock-provider.mts \
 *     [--port <port>] [--key <key>] [--seconds <seconds>] [--fail <failure>]
 *
 * Failures, for every request (`--fail`, or `POST /__mock/configure` with
 * `{"fail": ...}`), or for one request through a marker in its prompt:
 *
 * - `key`: every key is refused (HTTP 401). Marker: none; use a wrong key.
 * - `reject` / `[mock:reject]`: the request is refused (HTTP 400).
 * - `task` / `[mock:fail]`: the task is made and later fails.
 * - `drop` / `[mock:drop]`: the connection closes after the request arrived,
 *   without an answer: the outcome is unknown to the caller.
 * - `slow` / `[mock:slow]`: the task never finishes.
 *
 * `GET /__mock/requests` lists the create requests received, without keys.
 * The fixture video was recorded from a canvas animation with Chromium's
 * MediaRecorder and remuxed with avconvert: 2 s, 320×180, H.264.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MOCK_VIDEO_PROVIDER_KEY = 'basehalf-mock-key';
export const MOCK_VIDEO_FIXTURE_URL = new URL('./fixtures/basehalf-video-mock.mp4', import.meta.url);

export type MockVideoProviderFailure = 'none' | 'key' | 'reject' | 'task' | 'drop' | 'slow';
const FAILURES: readonly MockVideoProviderFailure[] = ['none', 'key', 'reject', 'task', 'drop', 'slow'];

export interface MockVideoProviderOptions {
	/** 0 chooses a free port. */
	readonly port?: number;
	readonly key?: string;
	/** How long a task takes from creation to success. A third of it is queued. */
	readonly durationMs?: number;
	readonly fail?: MockVideoProviderFailure;
	/** The bytes served as the video; the fixture by default. */
	readonly video?: Buffer;
}

/** A create request as received, without its key. */
export interface MockVideoProviderRequest {
	readonly api: 'seedance' | 'videos';
	readonly taskId: string | undefined;
	readonly model: string | undefined;
	readonly prompt: string | undefined;
	/** Seedance: the content item types and roles. `/videos`: the form fields and files. */
	readonly parts: readonly string[];
	readonly body: Record<string, unknown> | undefined;
}

export interface MockVideoProvider {
	/** `http://127.0.0.1:<port>` */
	readonly url: string;
	/** The endpoint of a Seedance channel. */
	readonly seedanceBaseUrl: string;
	/** The endpoint of a `/videos` channel. */
	readonly videosBaseUrl: string;
	readonly key: string;
	readonly requests: readonly MockVideoProviderRequest[];
	configure(options: { readonly fail?: MockVideoProviderFailure; readonly durationMs?: number }): void;
	close(): Promise<void>;
}

interface MockTask {
	readonly id: string;
	readonly api: 'seedance' | 'videos';
	readonly model: string;
	readonly createdAt: number;
	readonly fails: boolean;
	readonly slow: boolean;
	cancelled: boolean;
}

export async function startMockVideoProvider(options: MockVideoProviderOptions = {}): Promise<MockVideoProvider> {
	const key = options.key ?? MOCK_VIDEO_PROVIDER_KEY;
	const video = options.video ?? readFileSync(MOCK_VIDEO_FIXTURE_URL);
	let fail: MockVideoProviderFailure = options.fail ?? 'none';
	let durationMs = options.durationMs ?? 3_000;
	const tasks = new Map<string, MockTask>();
	const requests: MockVideoProviderRequest[] = [];
	const sockets = new Set<Socket>();
	let origin = '';

	const server: Server = createServer((request, response) => {
		void handle(request, response).catch(error => {
			if (!response.headersSent) {
				json(response, 500, { error: { message: `The mock provider failed: ${error instanceof Error ? error.message : String(error)}` } });
			} else {
				response.destroy();
			}
		});
	});
	server.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? '/', origin);
		const path = url.pathname;
		const body = await readBody(request);

		if (path === '/__mock/configure' && request.method === 'POST') {
			const settings = parseJson(body) ?? {};
			if (typeof settings.fail === 'string' && (FAILURES as readonly string[]).includes(settings.fail)) {
				fail = settings.fail as MockVideoProviderFailure;
			}
			if (typeof settings.durationMs === 'number' && settings.durationMs >= 0) {
				durationMs = settings.durationMs;
			}
			json(response, 200, { fail, durationMs });
			return;
		}
		if (path === '/__mock/requests' && request.method === 'GET') {
			json(response, 200, { requests });
			return;
		}
		if (path.startsWith('/files/') && request.method === 'GET') {
			// A CDN address: no key, like a signed link.
			const id = decodeURIComponent(path.slice('/files/'.length).replace(/\.mp4$/, ''));
			if (!tasks.has(id)) {
				json(response, 404, { error: { message: 'No such file.' } });
				return;
			}
			sendVideo(response);
			return;
		}

		const seedance = path.startsWith('/api/v3/');
		const videos = path.startsWith('/v1/videos');
		if (!seedance && !videos) {
			json(response, 404, { error: { message: `No API at ${path}.` } });
			return;
		}
		if (fail === 'key' || request.headers.authorization !== `Bearer ${key}`) {
			json(response, 401, seedance
				? { error: { code: 'AuthenticationError', message: 'The API key in the request is missing or invalid.', type: 'Unauthorized' } }
				: { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } });
			return;
		}

		if (seedance) {
			const taskPath = /^\/api\/v3\/contents\/generations\/tasks(?:\/(?<id>[^/]+))?$/.exec(path);
			if (!taskPath) {
				json(response, 404, { error: { code: 'NotFound', message: `No API at ${path}.` } });
				return;
			}
			const id = taskPath.groups?.id ? decodeURIComponent(taskPath.groups.id) : undefined;
			if (request.method === 'POST' && !id) {
				const payload = parseJson(body);
				const prompt = seedancePrompt(payload);
				const parts = Array.isArray(payload?.content) ? payload.content.map(seedancePart) : [];
				await create('seedance', request, payload, prompt, parts, task => json(response, 200, { id: task.id }), () => json(response, 400, {
					error: { code: 'InputTextSensitiveContentDetected', message: 'The request was refused: the prompt may contain sensitive content.', type: 'BadRequest' }
				}));
				return;
			}
			const task = id ? tasks.get(id) : undefined;
			if (!task || task.api !== 'seedance') {
				json(response, 404, { error: { code: 'ResourceNotFound', message: 'The specified task does not exist.', type: 'NotFound' } });
				return;
			}
			if (request.method === 'GET') {
				const state = stateOf(task);
				json(response, 200, {
					id: task.id,
					model: task.model,
					status: state,
					...(state === 'succeeded' ? { content: { video_url: `${origin}/files/${encodeURIComponent(task.id)}.mp4` } } : {}),
					...(state === 'failed' ? { error: { code: 'OutputVideoSensitiveContentDetected', message: 'The video could not be made: the output may contain sensitive content.' } } : {}),
					created_at: Math.floor(task.createdAt / 1000)
				});
				return;
			}
			if (request.method === 'DELETE') {
				if (stateOf(task) === 'running') {
					json(response, 400, { error: { code: 'InvalidAction', message: 'A running task cannot be cancelled.' } });
					return;
				}
				if (stateOf(task) === 'queued') {
					task.cancelled = true;
				}
				json(response, 200, {});
				return;
			}
		}

		if (videos) {
			const videoPath = /^\/v1\/videos(?:\/(?<id>[^/]+)(?<content>\/content)?)?$/.exec(path);
			const id = videoPath?.groups?.id ? decodeURIComponent(videoPath.groups.id) : undefined;
			if (request.method === 'POST' && videoPath && !id) {
				const form = parseForm(request.headers['content-type'], body);
				const payload = form ? form.fields : parseJson(body);
				const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined;
				const parts = form ? [...Object.keys(form.fields).map(name => `field ${name}`), ...form.files.map(file => `file ${file.name} ${file.type} ${file.size}`)] : [];
				const model = typeof payload?.model === 'string' ? payload.model : 'relay-video-1';
				await create('videos', request, payload, prompt, parts, task => json(response, 200, videoObject(task, model, payload)), () => json(response, 400, {
					error: { message: 'Your request was rejected by the safety system.', type: 'invalid_request_error', code: 'moderation_blocked' }
				}));
				return;
			}
			const task = id ? tasks.get(id) : undefined;
			if (!task || task.api !== 'videos') {
				json(response, 404, { error: { message: `No video found with id '${id ?? ''}'.`, type: 'invalid_request_error', code: 'not_found' } });
				return;
			}
			if (request.method === 'GET' && videoPath?.groups?.content) {
				if (stateOf(task) !== 'succeeded') {
					json(response, 400, { error: { message: 'The video is not ready.', type: 'invalid_request_error' } });
					return;
				}
				sendVideo(response);
				return;
			}
			if (request.method === 'GET') {
				json(response, 200, videoObject(task, task.model, undefined));
				return;
			}
		}
		json(response, 405, { error: { message: `${request.method} is not allowed at ${path}.` } });
	}

	async function create(
		api: 'seedance' | 'videos',
		request: IncomingMessage,
		payload: Record<string, unknown> | undefined,
		prompt: string | undefined,
		parts: readonly string[],
		accepted: (task: MockTask) => void,
		refused: () => void
	): Promise<void> {
		const marker = (name: string) => prompt?.includes(`[mock:${name}]`) === true;
		const model = typeof payload?.model === 'string' ? payload.model : '';
		if (fail === 'reject' || marker('reject')) {
			requests.push({ api, taskId: undefined, model, prompt, parts, body: redact(payload) });
			refused();
			return;
		}
		const task: MockTask = {
			id: api === 'seedance' ? `cgt-${Date.now()}-${randomBytes(3).toString('hex')}` : `video_${randomBytes(8).toString('hex')}`,
			api,
			model,
			createdAt: Date.now(),
			fails: fail === 'task' || marker('fail'),
			slow: fail === 'slow' || marker('slow'),
			cancelled: false
		};
		tasks.set(task.id, task);
		requests.push({ api, taskId: task.id, model, prompt, parts, body: redact(payload) });
		if (fail === 'drop' || marker('drop')) {
			// The provider made the task, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		accepted(task);
	}

	function stateOf(task: MockTask): 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' {
		if (task.cancelled) {
			return 'cancelled';
		}
		const elapsed = Date.now() - task.createdAt;
		if (elapsed < durationMs / 3) {
			return 'queued';
		}
		if (task.slow || elapsed < durationMs) {
			return 'running';
		}
		return task.fails ? 'failed' : 'succeeded';
	}

	function videoObject(task: MockTask, model: string, payload: Record<string, unknown> | undefined): Record<string, unknown> {
		const state = stateOf(task);
		const elapsed = Date.now() - task.createdAt;
		return {
			id: task.id,
			object: 'video',
			model,
			status: state === 'queued' ? 'queued' : state === 'running' ? 'in_progress' : state === 'succeeded' ? 'completed' : state,
			progress: state === 'succeeded' ? 100 : Math.min(99, Math.floor(100 * elapsed / Math.max(1, durationMs))),
			created_at: Math.floor(task.createdAt / 1000),
			...(typeof payload?.seconds === 'string' ? { seconds: payload.seconds } : {}),
			...(typeof payload?.size === 'string' ? { size: payload.size } : {}),
			...(state === 'failed' ? { error: { code: 'video_generation_failed', message: 'The video could not be made: the output may contain sensitive content.' } } : {})
		};
	}

	function sendVideo(response: ServerResponse): void {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
		response.end(video);
	}

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
	});
	const address = server.address() as AddressInfo;
	origin = `http://127.0.0.1:${address.port}`;

	return {
		url: origin,
		seedanceBaseUrl: `${origin}/api/v3`,
		videosBaseUrl: `${origin}/v1`,
		key,
		requests,
		configure(settings) {
			if (settings.fail !== undefined) {
				fail = settings.fail;
			}
			if (settings.durationMs !== undefined) {
				durationMs = settings.durationMs;
			}
		},
		close() {
			for (const socket of sockets) {
				socket.destroy();
			}
			return new Promise(resolve => server.close(() => resolve()));
		}
	};
}

function readBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
}

function json(response: ServerResponse, status: number, value: unknown): void {
	const body = Buffer.from(JSON.stringify(value), 'utf8');
	response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength) });
	response.end(body);
}

function parseJson(body: Buffer): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(body.toString('utf8'));
		return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function seedancePrompt(payload: Record<string, unknown> | undefined): string | undefined {
	const content = Array.isArray(payload?.content) ? payload.content : [];
	const text = content.find((item: unknown) => isRecord(item) && item.type === 'text');
	return isRecord(text) && typeof text.text === 'string' ? text.text : undefined;
}

function seedancePart(item: unknown): string {
	if (!isRecord(item)) {
		return 'invalid';
	}
	if (item.type === 'image_url' && isRecord(item.image_url) && typeof item.image_url.url === 'string') {
		const url = item.image_url.url;
		return `image_url ${String(item.role)} ${url.startsWith('data:') ? url.slice(0, url.indexOf(';')) : 'url'}`;
	}
	return String(item.type);
}

/** The request body without inline media, which is large and not needed to check it. */
function redact(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!payload) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(payload, (_key, value: unknown) => typeof value === 'string' && value.startsWith('data:') ? `${value.slice(0, value.indexOf(','))},…` : value));
}

interface ParsedForm {
	readonly fields: Record<string, string>;
	readonly files: readonly { readonly name: string; readonly type: string; readonly size: number }[];
}

function parseForm(contentType: string | undefined, body: Buffer): ParsedForm | undefined {
	const boundary = /multipart\/form-data;\s*boundary=(?<boundary>[^;]+)/i.exec(contentType ?? '')?.groups?.boundary;
	if (!boundary) {
		return undefined;
	}
	const fields: Record<string, string> = {};
	const files: { name: string; type: string; size: number }[] = [];
	const delimiter = Buffer.from(`--${boundary}`);
	let position = body.indexOf(delimiter);
	while (position >= 0) {
		const start = position + delimiter.byteLength;
		if (body.subarray(start, start + 2).toString() === '--') {
			break;
		}
		const next = body.indexOf(delimiter, start);
		if (next < 0) {
			break;
		}
		const part = body.subarray(start + 2, next - 2);
		const split = part.indexOf('\r\n\r\n');
		const head = part.subarray(0, split).toString('utf8');
		const content = part.subarray(split + 4);
		const name = /name="(?<name>[^"]*)"/.exec(head)?.groups?.name ?? '';
		const fileName = /filename="(?<file>[^"]*)"/.exec(head)?.groups?.file;
		if (fileName !== undefined) {
			files.push({ name, type: /Content-Type:\s*(?<type>[^\r\n]+)/i.exec(head)?.groups?.type ?? '', size: content.byteLength });
		} else {
			fields[name] = content.toString('utf8');
		}
		position = next;
	}
	return { fields, files };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const failure = argument('fail');
	if (failure !== undefined && !(FAILURES as readonly string[]).includes(failure)) {
		console.error(`--fail must be one of ${FAILURES.join(', ')}.`);
		process.exit(2);
	}
	const provider = await startMockVideoProvider({
		port: Number(argument('port') ?? 0),
		...(argument('key') ? { key: argument('key') } : {}),
		...(argument('seconds') ? { durationMs: Number(argument('seconds')) * 1000 } : {}),
		...(failure ? { fail: failure as MockVideoProviderFailure } : {})
	});
	console.log(JSON.stringify({
		ok: true,
		url: provider.url,
		seedanceBaseUrl: provider.seedanceBaseUrl,
		videosBaseUrl: provider.videosBaseUrl,
		key: provider.key,
		fixture: fileURLToPath(MOCK_VIDEO_FIXTURE_URL)
	}));
	const stop = () => {
		void provider.close().then(() => process.exit(0));
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}
