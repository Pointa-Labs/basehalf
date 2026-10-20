/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * A local video provider for tests and the smoke (D59). It answers like
 * ByteDance's Seedance task API (Volcengine Ark and BytePlus ModelArk) under
 * `/api/v3`: it accepts one test key, checks the shape of a create request,
 * moves each task from queued to running to succeeded over a few seconds,
 * cancels a queued task on DELETE, and serves a small MP4 made for these
 * tests from a separate path without a key, as a signed CDN link would be.
 * It never talks to a real provider.
 *
 *   node --experimental-strip-types scripts/basehalf-video-mock-provider.mts \
 *     [--port <port>] [--key <key>] [--seconds <seconds>] [--fail <failure>]
 *
 * Its base URL is `http://127.0.0.1:<port>/api/v3`. Failures, for every request
 * (`--fail`, or `POST /__mock/configure` with `{"fail": ...}`), or for one
 * request through a marker in its prompt:
 *
 * - `key`: every key is refused (HTTP 401). Marker: none; use a wrong key.
 * - `reject` / `[mock:reject]`: the request is refused (HTTP 400).
 * - `task` / `[mock:fail]`: the task is made and later fails.
 * - `expire` / `[mock:expire]`: the task is made and later expires.
 * - `drop` / `[mock:drop]`: the connection closes after the request arrived,
 *   without an answer: the outcome is unknown to the caller.
 * - `slow` / `[mock:slow]`: the task never finishes.
 *
 * `GET /__mock/requests` lists the create requests received, without keys and
 * with inline media shortened. The fixture video was recorded from a canvas
 * animation with Chromium's MediaRecorder and remuxed with avconvert: 2 s,
 * 320×180, H.264.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MOCK_VIDEO_PROVIDER_KEY = 'basehalf-mock-key';
export const MOCK_VIDEO_FIXTURE_URL = new URL('./fixtures/basehalf-video-mock.mp4', import.meta.url);

export type MockVideoProviderFailure = 'none' | 'key' | 'reject' | 'task' | 'expire' | 'drop' | 'slow';
const FAILURES: readonly MockVideoProviderFailure[] = ['none', 'key', 'reject', 'task', 'expire', 'drop', 'slow'];

export interface MockVideoProviderOptions {
	/** 0 chooses a free port. */
	readonly port?: number;
	readonly key?: string;
	/** How long a task takes from creation to its end. A third of it is queued. */
	readonly durationMs?: number;
	readonly fail?: MockVideoProviderFailure;
	/** The bytes served as the video; the fixture by default. */
	readonly video?: Buffer;
}

/** A create request as received, without its key. */
export interface MockVideoProviderRequest {
	readonly taskId: string | undefined;
	readonly model: string | undefined;
	/** The text item of `content`. */
	readonly prompt: string | undefined;
	/** The `content` items: `text`, `image_url <role> data:<type>`, `audio_url <role> data:<type>`. */
	readonly parts: readonly string[];
	/** The body with every data URL cut after its type. */
	readonly body: Record<string, unknown> | undefined;
}

export interface MockVideoProvider {
	/** `http://127.0.0.1:<port>` */
	readonly url: string;
	/** The base URL to enter as the endpoint: `http://127.0.0.1:<port>/api/v3`. */
	readonly baseUrl: string;
	readonly key: string;
	readonly requests: readonly MockVideoProviderRequest[];
	configure(options: { readonly fail?: MockVideoProviderFailure; readonly durationMs?: number }): void;
	close(): Promise<void>;
}

type MockState = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

interface MockTask {
	readonly id: string;
	readonly model: string;
	readonly createdAt: number;
	readonly ends: 'succeeded' | 'failed' | 'expired';
	readonly slow: boolean;
	readonly params: Record<string, unknown>;
	cancelled: boolean;
}

const RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
const RESOLUTIONS = new Set(['480p', '720p', '1080p', '4k']);
const IMAGE_ROLES = new Set(['first_frame', 'last_frame', 'reference_image']);

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
				json(response, 500, { error: { code: 'InternalServiceError', message: `The mock provider failed: ${error instanceof Error ? error.message : String(error)}`, type: 'InternalServerError' } });
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
			if (!tasks.has(id) || stateOf(tasks.get(id)!) !== 'succeeded') {
				json(response, 404, { error: { code: 'NoSuchKey', message: 'The specified key does not exist.' } });
				return;
			}
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
			response.end(video);
			return;
		}
		if (!path.startsWith('/api/v3/')) {
			json(response, 404, { error: { code: 'PathNotFound', message: 'The path of api not found.' } });
			return;
		}
		if (fail === 'key' || request.headers.authorization !== `Bearer ${key}`) {
			json(response, 401, { error: { code: 'AuthenticationError', message: 'The API key in the request is missing or invalid.', type: 'Unauthorized' } });
			return;
		}
		const taskPath = /^\/api\/v3\/contents\/generations\/tasks(?:\/(?<id>[^/]+))?$/.exec(path);
		if (!taskPath) {
			json(response, 404, { error: { code: 'InvalidAction', message: `The specified action is invalid: ${request.method} ${path}` } });
			return;
		}
		const id = taskPath.groups?.id ? decodeURIComponent(taskPath.groups.id) : undefined;
		if (request.method === 'POST' && !id) {
			await create(request, response, parseJson(body));
			return;
		}
		const task = id ? tasks.get(id) : undefined;
		if (!task) {
			json(response, 404, { error: { code: 'ResourceNotFound', message: 'The specified task does not exist.', type: 'NotFound' } });
			return;
		}
		if (request.method === 'GET') {
			json(response, 200, taskObject(task));
			return;
		}
		if (request.method === 'DELETE') {
			// A queued task is cancelled; a task that ended loses its record; a running or cancelled one stays.
			const state = stateOf(task);
			if (state === 'queued') {
				task.cancelled = true;
				json(response, 200, {});
			} else if (state === 'running' || state === 'cancelled') {
				json(response, 400, { error: { code: 'InvalidParameter', message: `A ${state} task cannot be cancelled or deleted.`, type: 'BadRequest' } });
			} else {
				tasks.delete(task.id);
				json(response, 200, {});
			}
			return;
		}
		json(response, 405, { error: { code: 'InvalidAction', message: `${request.method} is not allowed at ${path}.` } });
	}

	async function create(request: IncomingMessage, response: ServerResponse, payload: Record<string, unknown> | undefined): Promise<void> {
		const prompt = textOf(payload);
		const parts = Array.isArray(payload?.content) ? payload.content.map(partOf) : [];
		const model = typeof payload?.model === 'string' ? payload.model : undefined;
		const marker = (name: string) => prompt?.includes(`[mock:${name}]`) === true;
		const invalid = invalidField(payload);
		if (invalid || fail === 'reject' || marker('reject')) {
			requests.push({ taskId: undefined, model, prompt, parts, body: redact(payload) });
			json(response, 400, invalid
				? { error: { code: 'InvalidParameter', message: `The parameter \`${invalid}\` specified in the request is not valid.`, type: 'BadRequest' } }
				: { error: { code: 'InputTextSensitiveContentDetected', message: 'The request was refused: the prompt may contain sensitive content.', type: 'BadRequest' } });
			return;
		}
		const task: MockTask = {
			id: `cgt-${Date.now()}-${randomBytes(3).toString('hex')}`,
			model: model!,
			createdAt: Date.now(),
			ends: fail === 'task' || marker('fail') ? 'failed' : fail === 'expire' || marker('expire') ? 'expired' : 'succeeded',
			slow: fail === 'slow' || marker('slow'),
			params: { ...payload, content: undefined, model: undefined },
			cancelled: false
		};
		tasks.set(task.id, task);
		requests.push({ taskId: task.id, model, prompt, parts, body: redact(payload) });
		if (fail === 'drop' || marker('drop')) {
			// The provider made the task, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		json(response, 200, { id: task.id });
	}

	function stateOf(task: MockTask): MockState {
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
		return task.ends;
	}

	function taskObject(task: MockTask): Record<string, unknown> {
		const state = stateOf(task);
		const duration = typeof task.params.duration === 'number' && task.params.duration > 0 ? task.params.duration : 5;
		return {
			id: task.id,
			model: task.model,
			status: state,
			...(state === 'succeeded' ? { content: { video_url: `${origin}/files/${encodeURIComponent(task.id)}.mp4` } } : {}),
			error: state === 'failed' ? { code: 'OutputVideoSensitiveContentDetected', message: 'The video could not be made: the output may contain sensitive content.' } : null,
			created_at: Math.floor(task.createdAt / 1000),
			updated_at: Math.floor(Date.now() / 1000),
			resolution: task.params.resolution ?? '720p',
			ratio: task.params.ratio ?? 'adaptive',
			duration,
			framespersecond: 24,
			...(typeof task.params.generate_audio === 'boolean' ? { generate_audio: task.params.generate_audio } : {}),
			execution_expires_after: 172800,
			...(state === 'succeeded' ? { usage: { completion_tokens: 108000, total_tokens: 108000 } } : {})
		};
	}

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
	});
	const address = server.address() as AddressInfo;
	origin = `http://127.0.0.1:${address.port}`;

	return {
		url: origin,
		baseUrl: `${origin}/api/v3`,
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

/** The first field of a create request that the API would refuse, by its own documented rules. */
function invalidField(payload: Record<string, unknown> | undefined): string | undefined {
	if (!payload || typeof payload.model !== 'string' || !payload.model) {
		return 'model';
	}
	if (!Array.isArray(payload.content) || payload.content.length === 0) {
		return 'content';
	}
	for (const item of payload.content) {
		if (!isRecord(item)) {
			return 'content';
		}
		if (item.type === 'text') {
			if (typeof item.text !== 'string') {
				return 'content.text';
			}
		} else if (item.type === 'image_url') {
			if (!isRecord(item.image_url) || typeof item.image_url.url !== 'string' || !/^data:image\/[a-z]+;base64,/.test(item.image_url.url)) {
				return 'content.image_url.url';
			}
			if (item.role !== undefined && !IMAGE_ROLES.has(String(item.role))) {
				return 'content.role';
			}
		} else if (item.type === 'audio_url') {
			if (!isRecord(item.audio_url) || typeof item.audio_url.url !== 'string' || !/^data:audio\/[a-z0-9]+;base64,/.test(item.audio_url.url)) {
				return 'content.audio_url.url';
			}
			if (item.role !== 'reference_audio') {
				return 'content.role';
			}
		} else {
			return 'content.type';
		}
	}
	if (payload.resolution !== undefined && !RESOLUTIONS.has(String(payload.resolution))) {
		return 'resolution';
	}
	if (payload.ratio !== undefined && !RATIOS.has(String(payload.ratio))) {
		return 'ratio';
	}
	if (payload.duration !== undefined && !(Number.isInteger(payload.duration) && (payload.duration === -1 || (payload.duration as number) >= 2))) {
		return 'duration';
	}
	for (const flag of ['generate_audio', 'watermark', 'camera_fixed']) {
		if (payload[flag] !== undefined && typeof payload[flag] !== 'boolean') {
			return flag;
		}
	}
	if (payload.seed !== undefined && !Number.isInteger(payload.seed)) {
		return 'seed';
	}
	return undefined;
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

function textOf(payload: Record<string, unknown> | undefined): string | undefined {
	const content = Array.isArray(payload?.content) ? payload.content : [];
	const text = content.find((item: unknown) => isRecord(item) && item.type === 'text');
	return isRecord(text) && typeof text.text === 'string' ? text.text : undefined;
}

function partOf(item: unknown): string {
	if (!isRecord(item)) {
		return 'invalid';
	}
	const media = item.type === 'image_url' ? item.image_url : item.type === 'audio_url' ? item.audio_url : undefined;
	if (isRecord(media) && typeof media.url === 'string') {
		const url = media.url;
		return `${String(item.type)} ${String(item.role)} ${url.startsWith('data:') ? url.slice(0, url.indexOf(';')) : 'url'}`;
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
		baseUrl: provider.baseUrl,
		key: provider.key,
		fixture: fileURLToPath(MOCK_VIDEO_FIXTURE_URL)
	}));
	const stop = () => {
		void provider.close().then(() => process.exit(0));
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}
