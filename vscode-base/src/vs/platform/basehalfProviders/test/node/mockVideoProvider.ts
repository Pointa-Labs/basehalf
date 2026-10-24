/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * A local video and image provider for tests and the smoke (D59, D64). It
 * answers like ByteDance's ModelArk API (Volcengine Ark and BytePlus
 * ModelArk) under `/api/v3`, and accepts one test key:
 *
 * - Seedance's task API: it checks the shape of a create request, moves each
 *   task from queued to running to succeeded over a few seconds, cancels a
 *   queued task on DELETE, and serves a small MP4 made for these tests from a
 *   separate path without a key, as a signed CDN link would be.
 * - Seedream's `POST /images/generations`, which answers at once: it checks
 *   the shape of the request and answers small PNGs, one per image asked for
 *   (`max_images` of a set, otherwise one), as addresses it serves itself
 *   without a key (`response_format: url`, the default) or as base64
 *   (`b64_json`).
 *
 * It never talks to a real provider.
 *
 *   node scripts/basehalf-video-mock-provider.mts \
 *     [--port <port>] [--key <key>] [--seconds <seconds>] [--fail <failure>]
 *
 * Its base URL is `http://127.0.0.1:<port>/api/v3`. Failures, for every request
 * (`--fail`, or `POST /__mock/configure` with `{"fail": ...}`), or for one
 * request through a marker in its prompt:
 *
 * - `key`: every key is refused (HTTP 401). Marker: none; use a wrong key.
 * - `reject` / `[mock:reject]`: the request is refused (HTTP 400).
 * - `task` / `[mock:fail]`: the task is made and later fails; of images, the
 *   last one is refused by the content check and the others are made.
 * - `expire` / `[mock:expire]`: the task is made and later expires.
 * - `drop` / `[mock:drop]`: the connection closes after the request arrived,
 *   without an answer: the outcome is unknown to the caller.
 * - `slow` / `[mock:slow]`: the task never finishes; images are answered only
 *   after the time a task takes (`--seconds`).
 * - `[mock:fewer]`: a set of images has one image fewer than asked.
 * - `[mock:jpeg]`: the images are JPEG files, also for a model that delivers
 *   PNG.
 *
 * `GET /__mock/requests` lists the create requests received, of tasks and of
 * images, without keys and with inline media shortened. The fixture video
 * was recorded from a canvas animation with Chromium's MediaRecorder and
 * remuxed with avconvert: 2 s, 320×180, H.264. The fixture JPEG is a PNG of
 * one color, 16×16, converted with sips. With `uniqueFiles`, as the smoke
 * starts it, each file it answers is its own, as a real provider's are.
 */

import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import type { AddressInfo, Socket } from 'net';
import * as zlib from 'zlib';

export const MOCK_VIDEO_PROVIDER_KEY = 'basehalf-mock-key';
// The fixtures are in `scripts/fixtures/`; this module is in `src/vs/platform/basehalfProviders/test/node/`, or at the same depth in `out/`.
export const MOCK_VIDEO_FIXTURE_URL = new URL('../../../../../../scripts/fixtures/basehalf-video-mock.mp4', import.meta.url);
export const MOCK_JPEG_FIXTURE_URL = new URL('../../../../../../scripts/fixtures/basehalf-image-mock.jpg', import.meta.url);

export type MockVideoProviderFailure = 'none' | 'key' | 'reject' | 'task' | 'expire' | 'drop' | 'slow';
export const FAILURES: readonly MockVideoProviderFailure[] = ['none', 'key', 'reject', 'task', 'expire', 'drop', 'slow'];

export interface MockVideoProviderOptions {
	/** 0 chooses a free port. */
	readonly port?: number;
	readonly key?: string;
	/** How long a task takes from creation to its end. A third of it is queued. */
	readonly durationMs?: number;
	readonly fail?: MockVideoProviderFailure;
	/** The bytes served as the video; the fixture by default. */
	readonly video?: Buffer;
	/**
	 * Makes every file it answers a file of its own, as a real provider's are:
	 * a video ends with an MP4 `free` box, a PNG holds a `tEXt` chunk, and a
	 * JPEG a comment, each naming its task or image. Without it, the files of
	 * every task are the same bytes.
	 */
	readonly uniqueFiles?: boolean;
}

/** A create request as received, without its key. */
export interface MockVideoProviderRequest {
	/** What it asked for: a video task, or images answered at once. */
	readonly kind: 'video' | 'image';
	/** The task it made; none for images, which make no task. */
	readonly taskId: string | undefined;
	readonly model: string | undefined;
	/** The text item of `content`, or the `prompt` of images. */
	readonly prompt: string | undefined;
	/**
	 * The `content` items: `text`, `image_url <role> data:<type>`, `audio_url
	 * <role> data:<type>`; of images, each reference as `image data:<type>`.
	 */
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
	const uniqueFiles = options.uniqueFiles === true;
	let fail: MockVideoProviderFailure = options.fail ?? 'none';
	let durationMs = options.durationMs ?? 3_000;
	const tasks = new Map<string, MockTask>();
	/** The images answered as addresses, by their path under `/files/images/`. */
	const images = new Map<string, { readonly bytes: Buffer; readonly type: string }>();
	const requests: MockVideoProviderRequest[] = [];
	const sockets = new Set<Socket>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let origin = '';

	const { createServer } = await import('http');
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
		if (path.startsWith('/files/images/') && request.method === 'GET') {
			// An image's address: no key, like a signed link.
			const image = images.get(decodeURIComponent(path.slice('/files/images/'.length)));
			if (!image) {
				json(response, 404, { error: { code: 'NoSuchKey', message: 'The specified key does not exist.' } });
				return;
			}
			response.writeHead(200, { 'Content-Type': image.type, 'Content-Length': String(image.bytes.byteLength) });
			response.end(image.bytes);
			return;
		}
		if (path.startsWith('/files/') && request.method === 'GET') {
			// A CDN address: no key, like a signed link.
			const id = decodeURIComponent(path.slice('/files/'.length).replace(/\.mp4$/, ''));
			if (!tasks.has(id) || stateOf(tasks.get(id)!) !== 'succeeded') {
				json(response, 404, { error: { code: 'NoSuchKey', message: 'The specified key does not exist.' } });
				return;
			}
			const file = uniqueFiles ? withFreeBox(video, id) : video;
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(file.byteLength) });
			response.end(file);
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
		if (path === '/api/v3/images/generations') {
			if (request.method !== 'POST') {
				json(response, 405, { error: { code: 'InvalidAction', message: `${request.method} is not allowed at ${path}.` } });
				return;
			}
			createImages(request, response, parseJson(body));
			return;
		}
		const taskPath =/^\/api\/v3\/contents\/generations\/tasks(?:\/(?<id>[^/]+))?$/.exec(path);
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
			requests.push({ kind: 'video', taskId: undefined, model, prompt, parts, body: redact(payload) });
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
		requests.push({ kind: 'video', taskId: task.id, model, prompt, parts, body: redact(payload) });
		if (fail === 'drop' || marker('drop')) {
			// The provider made the task, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		json(response, 200, { id: task.id });
	}

	/** Answers a request for images at once, as Seedream does: one entry of `data` per image, in order. */
	function createImages(request: IncomingMessage, response: ServerResponse, payload: Record<string, unknown> | undefined): void {
		const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined;
		const model = typeof payload?.model === 'string' ? payload.model : undefined;
		const references = typeof payload?.image === 'string' ? [payload.image] : Array.isArray(payload?.image) ? payload.image : [];
		const parts = references.map(reference => typeof reference === 'string' && reference.startsWith('data:') ? `image ${reference.slice(0, reference.indexOf(';'))}` : 'image url');
		const marker = (name: string) => prompt?.includes(`[mock:${name}]`) === true;
		const invalid = invalidImageField(payload);
		requests.push({ kind: 'image', taskId: undefined, model, prompt, parts, body: redact(payload) });
		if (invalid || fail === 'reject' || marker('reject')) {
			json(response, 400, invalid
				? { error: { code: 'InvalidParameter', message: `The parameter \`${invalid}\` specified in the request is not valid.`, type: 'BadRequest' } }
				: { error: { code: 'InputTextSensitiveContentDetected', message: 'The request was refused: the prompt may contain sensitive content.', type: 'BadRequest' } });
			return;
		}
		if (fail === 'drop' || marker('drop')) {
			// The provider made the images, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		const options = payload!.sequential_image_generation_options;
		const asked = payload!.sequential_image_generation === 'auto' ? (isRecord(options) && typeof options.max_images === 'number' ? options.max_images : 15) : 1;
		const made = marker('fewer') && asked > 1 ? asked - 1 : asked;
		const id = `img-${Date.now()}-${randomBytes(3).toString('hex')}`;
		const jpeg = marker('jpeg');
		const data: Record<string, unknown>[] = [];
		for (let number = 1; number <= made; number++) {
			if (number === made && (fail === 'task' || marker('fail'))) {
				data.push({ error: { code: 'OutputImageSensitiveContentDetected', message: 'The image could not be made: the output may contain sensitive content.' } });
				continue;
			}
			const tag = uniqueFiles ? `${id}-${number}` : undefined;
			const image = jpeg ? withJpegComment(readFileSync(MOCK_JPEG_FIXTURE_URL), tag) : mockPng(number, tag);
			const format = jpeg ? 'jpeg' : 'png';
			if (payload!.response_format === 'b64_json') {
				data.push({ b64_json: image.toString('base64'), size: `${MOCK_IMAGE_SIDE}x${MOCK_IMAGE_SIDE}`, output_format: format });
			} else {
				const name = `${id}-${number}.${jpeg ? 'jpg' : 'png'}`;
				images.set(name, { bytes: image, type: `image/${format}` });
				data.push({ url: `${origin}/files/images/${encodeURIComponent(name)}`, size: `${MOCK_IMAGE_SIDE}x${MOCK_IMAGE_SIDE}`, output_format: format });
			}
		}
		const generated = data.filter(entry => entry.error === undefined).length;
		const answer = () => json(response, 200, { model, created: Math.floor(Date.now() / 1000), data, usage: { generated_images: generated, output_tokens: generated * 4096, total_tokens: generated * 4096 } });
		if (fail === 'slow' || marker('slow')) {
			const timer = setTimeout(() => {
				timers.delete(timer);
				answer();
			}, durationMs);
			timers.add(timer);
			return;
		}
		answer();
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
			for (const timer of timers) {
				clearTimeout(timer);
			}
			for (const socket of sockets) {
				socket.destroy();
			}
			return new Promise(resolve => server.close(() => resolve()));
		}
	};
}

const IMAGE_SIZES = /^(?:1K|1\.5K|2K|3K|4K|[1-9]\d{1,4}x[1-9]\d{1,4})$/;
const DATA_IMAGE = /^data:image\/[a-z]+;base64,/;

/** The first field of a request for images that Seedream would refuse, by its own documented rules. */
function invalidImageField(payload: Record<string, unknown> | undefined): string | undefined {
	if (!payload || typeof payload.model !== 'string' || !payload.model) {
		return 'model';
	}
	if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
		return 'prompt';
	}
	const image = payload.image;
	if (image !== undefined && !(typeof image === 'string' ? DATA_IMAGE.test(image) : Array.isArray(image) && image.length >= 1 && image.length <= 14 && image.every(entry => typeof entry === 'string' && DATA_IMAGE.test(entry)))) {
		return 'image';
	}
	if (payload.size !== undefined && !(typeof payload.size === 'string' && IMAGE_SIZES.test(payload.size))) {
		return 'size';
	}
	const choices: Readonly<Record<string, readonly unknown[]>> = {
		sequential_image_generation: ['auto', 'disabled'],
		output_format: ['png', 'jpeg'],
		response_format: ['url', 'b64_json'],
		background: ['transparent', 'opaque']
	};
	for (const [name, values] of Object.entries(choices)) {
		if (payload[name] !== undefined && !values.includes(payload[name])) {
			return name;
		}
	}
	const options = payload.sequential_image_generation_options;
	if (options !== undefined && !(isRecord(options) && Number.isInteger(options.max_images) && (options.max_images as number) >= 1 && (options.max_images as number) <= 15)) {
		return 'sequential_image_generation_options.max_images';
	}
	const optimize = payload.optimize_prompt_options;
	if (optimize !== undefined && !(isRecord(optimize) && (optimize.mode === 'standard' || optimize.mode === 'fast'))) {
		return 'optimize_prompt_options.mode';
	}
	if (payload.watermark !== undefined && typeof payload.watermark !== 'boolean') {
		return 'watermark';
	}
	return undefined;
}

/** The side of the images answered: small, and large enough to see on a card. */
const MOCK_IMAGE_SIDE = 16;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

/** A small RGB PNG of one color, another for each number, so that the images of a set differ; with `tag`, it holds it as a text chunk. */
export function mockPng(number: number, tag?: string): Buffer {
	const color = [(37 * number) % 256, (91 * number + 64) % 256, (53 * number + 128) % 256];
	const row = Buffer.alloc(1 + MOCK_IMAGE_SIDE * 3);
	for (let x = 0; x < MOCK_IMAGE_SIDE; x++) {
		row.set(color, 1 + x * 3);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(MOCK_IMAGE_SIDE, 0);
	header.writeUInt32BE(MOCK_IMAGE_SIDE, 4);
	header[8] = 8;
	header[9] = 2;
	const pixels = Buffer.concat(Array.from({ length: MOCK_IMAGE_SIDE }, () => row));
	const text = tag === undefined ? [] : [pngChunk('tEXt', Buffer.from(`Comment\0${tag}`, 'latin1'))];
	return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(pixels)), ...text, pngChunk('IEND', Buffer.alloc(0))]);
}

/** The MP4 with a `free` box after its last box, which players skip, holding `tag`. */
function withFreeBox(video: Buffer, tag: string): Buffer {
	const payload = Buffer.from(tag, 'utf8');
	const header = Buffer.alloc(8);
	header.writeUInt32BE(8 + payload.byteLength, 0);
	header.write('free', 4, 'latin1');
	return Buffer.concat([video, header, payload]);
}

/** The JPEG with a comment segment after its start marker, holding `tag`. */
function withJpegComment(jpeg: Buffer, tag: string | undefined): Buffer {
	if (tag === undefined) {
		return jpeg;
	}
	const payload = Buffer.from(tag, 'latin1');
	const segment = Buffer.alloc(4);
	segment.writeUInt16BE(0xfffe, 0);
	segment.writeUInt16BE(2 + payload.byteLength, 2);
	return Buffer.concat([jpeg.subarray(0, 2), segment, payload, jpeg.subarray(2)]);
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
