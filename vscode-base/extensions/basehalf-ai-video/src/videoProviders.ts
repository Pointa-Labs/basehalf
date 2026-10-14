/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { open, readFile, stat, unlink } from 'node:fs/promises';
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import type {
	VideoProviderCancelResult,
	VideoProviderDownloadRequest,
	VideoProviderDownloadResult,
	VideoProviderEndpoint,
	VideoProviderErrorCode,
	VideoProviderKind,
	VideoProviderMedia,
	VideoProviderPollState,
	VideoProviderRequest,
	VideoProviderResponse,
	VideoProviderSubmitResult,
	VideoProviderTaskRef
} from './videoProviderTypes';

/**
 * The provider requests of a Video node generation (D58). The workbench
 * calls the four commands below; each answers `{ok: true, value}` or
 * `{ok: false, error}` and never throws. Nothing is kept between calls: the
 * key, the endpoint, and the task id arrive with every call.
 *
 * Formats: the Seedance task API (Volcengine Ark, BytePlus ModelArk), Wan
 * video synthesis (Alibaba Cloud Model Studio), MiniMax video generation, Veo
 * long-running prediction (Google Gemini), and `/videos` tasks (OpenAI and
 * relays). A request that may have created a task is never sent again; a
 * failure after its body was sent answers `unknownOutcome`.
 */

export const VIDEO_PROVIDER_COMMANDS = Object.freeze({
	submit: 'basehalf.video.provider.submit',
	poll: 'basehalf.video.provider.poll',
	download: 'basehalf.video.provider.download',
	cancel: 'basehalf.video.provider.cancel'
});

/** The largest video downloaded. */
export const MAX_VIDEO_DOWNLOAD_BYTES = 512 * 1024 * 1024;
/** The largest image, video, or audio file sent from the workspace. */
export const MAX_VIDEO_INPUT_BYTES = 20 * 1024 * 1024;
/** The largest request body, inputs included. */
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
/** The largest answer read from an API call. */
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_MESSAGE_LENGTH = 1000;
const USER_AGENT = 'BaseHalf-AI-Video';

/** Limits that tests can lower. */
export interface VideoProviderOptions {
	/** Idle time of a request that may create a task. */
	readonly createTimeoutMs?: number;
	/** Idle time of any other request. */
	readonly queryTimeoutMs?: number;
	readonly maxDownloadBytes?: number;
}

const DEFAULT_OPTIONS: Required<VideoProviderOptions> = Object.freeze({
	createTimeoutMs: 120_000,
	queryTimeoutMs: 60_000,
	maxDownloadBytes: MAX_VIDEO_DOWNLOAD_BYTES
});

// --- the commands -------------------------------------------------------------------------------

/** Sends the request once and answers the provider's task id. */
export function submitVideoTask(argument: unknown, options: VideoProviderOptions = {}): Promise<VideoProviderResponse<VideoProviderSubmitResult>> {
	const call = new ProviderCall(argument, options);
	return call.answer(async () => {
		const request = parseRequest(argument);
		const remoteId = await FORMATS[request.provider].submit(request, call);
		return { remoteId };
	});
}

/** Asks the provider about a task. */
export function pollVideoTask(argument: unknown, options: VideoProviderOptions = {}): Promise<VideoProviderResponse<VideoProviderPollState>> {
	const call = new ProviderCall(argument, options);
	return call.answer(async () => {
		const ref = parseTaskRef(argument);
		return FORMATS[ref.provider].poll(ref, call);
	});
}

/**
 * Downloads a task's video to `targetFsPath`, a new `.part` file: at most five
 * redirects, the key only to the endpoint's origin, at most 512 MiB, and an
 * MP4 `ftyp` box first. A download that fails leaves no file.
 */
export function downloadVideo(argument: unknown, options: VideoProviderOptions = {}): Promise<VideoProviderResponse<VideoProviderDownloadResult>> {
	const call = new ProviderCall(argument, options);
	return call.answer(async () => {
		const request = parseDownloadRequest(argument);
		const format = FORMATS[request.provider];
		bind(format, request, call);
		const source = request.videoUrl ?? await format.contentUrl(request, call);
		const size = await call.download(source, request.targetFsPath);
		return { size };
	});
}

/** Asks the provider to cancel a task, where its format allows it. Best effort. */
export function cancelVideoTask(argument: unknown, options: VideoProviderOptions = {}): Promise<VideoProviderResponse<VideoProviderCancelResult>> {
	const call = new ProviderCall(argument, options);
	return call.answer(async () => {
		const ref = parseTaskRef(argument);
		return { cancelled: await FORMATS[ref.provider].cancel(ref, call) };
	});
}

// --- failures -----------------------------------------------------------------------------------

class ProviderFailure extends Error {
	readonly code: VideoProviderErrorCode;
	readonly status: number | undefined;

	constructor(code: VideoProviderErrorCode, message: string, status?: number) {
		super(message);
		this.name = 'ProviderFailure';
		this.code = code;
		this.status = status;
	}
}

function rejected(message: string, status?: number): ProviderFailure {
	return new ProviderFailure('rejected', message, status);
}

function unreadable(message: string): ProviderFailure {
	return new ProviderFailure('invalidResponse', message);
}

/** What an HTTP status means, for a request that may create a task or for any other. */
function failureForStatus(status: number, detail: string, creates: boolean): ProviderFailure | undefined {
	if (status >= 200 && status < 300) {
		return undefined;
	}
	const message = detail || `The provider answered with HTTP ${status}.`;
	if (status === 401 || status === 403) {
		return new ProviderFailure('auth', message, status);
	}
	if (status === 429) {
		return new ProviderFailure('rateLimited', message, status);
	}
	if (status === 404 || status === 410) {
		return new ProviderFailure('notFound', message, status);
	}
	if (status === 408 || status >= 500) {
		// The provider may have made the task before it failed to answer.
		return new ProviderFailure(creates ? 'unknownOutcome' : 'network', message, status);
	}
	if (status >= 300 && status < 400) {
		// A redirected request is not followed: a request is never sent twice.
		return new ProviderFailure(creates ? 'rejected' : 'invalidResponse', `The provider redirected the request (HTTP ${status}). Check the endpoint.`, status);
	}
	return rejected(message, status);
}

/** Plain text of at most 1,000 characters, without control characters, markup, or the key. */
function plainText(value: string, apiKey: string | undefined): string {
	let text = value;
	if (apiKey && apiKey.length >= 4) {
		text = text.split(apiKey).join('***');
	}
	text = text.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

/** The message in a provider's error answer, in the shapes the supported formats use. */
function messageOf(value: unknown): string {
	if (!isRecord(value)) {
		return '';
	}
	const error = value.error;
	const candidates = [
		isRecord(error) ? error.message : undefined,
		isRecord(error) ? error.msg : undefined,
		typeof error === 'string' ? error : undefined,
		value.message,
		value.msg,
		value.error_message,
		isRecord(value.base_resp) ? value.base_resp.status_msg : undefined,
		isRecord(value.output) ? value.output.message : undefined,
		value.detail,
		isRecord(error) ? error.code : undefined,
		value.code
	];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim()) {
			return candidate;
		}
	}
	return '';
}

// --- one call -----------------------------------------------------------------------------------

interface HttpAnswer {
	readonly status: number;
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
}

interface ApiCall {
	readonly method: 'GET' | 'POST' | 'DELETE';
	/** Appended to the endpoint, such as `/contents/generations/tasks`. */
	readonly path: string;
	readonly json?: unknown;
	readonly raw?: { readonly body: Buffer; readonly contentType: string };
	/** The request may create a task: a failure after its body was sent has an unknown outcome. */
	readonly creates?: boolean;
	readonly headers?: Readonly<Record<string, string>>;
	/** An empty answer is fine, as for a cancellation. */
	readonly empty?: boolean;
}

/** The endpoint, key, and limits of one command, with the HTTP it needs. */
class ProviderCall {
	private readonly options: Required<VideoProviderOptions>;
	private readonly apiKey: string | undefined;
	/** Whether a request that may create a task left this computer. */
	private createStarted = false;

	constructor(argument: unknown, options: VideoProviderOptions) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
		this.apiKey = isRecord(argument) && typeof argument.apiKey === 'string' ? argument.apiKey : undefined;
	}

	async answer<T>(run: () => Promise<T>): Promise<VideoProviderResponse<T>> {
		try {
			return { ok: true, value: await run() };
		} catch (error) {
			if (error instanceof ProviderFailure) {
				return {
					ok: false,
					error: {
						code: error.code,
						message: plainText(error.message, this.apiKey) || 'The provider request failed.',
						...(error.status !== undefined ? { status: error.status } : {})
					}
				};
			}
			const detail = plainText(error instanceof Error ? error.message : String(error), this.apiKey);
			return {
				ok: false,
				error: this.createStarted
					? { code: 'unknownOutcome', message: detail || 'The request failed after it was sent.' }
					: { code: 'rejected', message: `AI Video could not prepare the request: ${detail}` }
			};
		}
	}

	/** Calls the provider's API at the endpoint and answers its JSON. */
	async json(endpoint: VideoProviderEndpoint, authorization: Readonly<Record<string, string>>, call: ApiCall): Promise<Record<string, unknown>> {
		const url = apiUrl(endpoint.baseUrl, call.path);
		let body: Buffer | undefined;
		let contentType: string | undefined;
		if (call.raw) {
			body = call.raw.body;
			contentType = call.raw.contentType;
		} else if (call.json !== undefined) {
			body = Buffer.from(JSON.stringify(call.json), 'utf8');
			contentType = 'application/json';
		}
		if (body && body.byteLength > MAX_REQUEST_BYTES) {
			throw rejected('The request with its inputs is larger than 128 MiB. Use fewer or smaller inputs.');
		}
		const headers: Record<string, string> = {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
			...authorization,
			...(contentType ? { 'Content-Type': contentType } : {}),
			...(call.headers ?? {})
		};
		if (call.creates) {
			this.createStarted = true;
		}
		const answer = await this.send(call.method, url, headers, body, call.creates === true);
		const text = answer.body.toString('utf8');
		let parsed: unknown;
		if (text.trim()) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = undefined;
			}
		}
		const failure = failureForStatus(answer.status, messageOf(parsed), call.creates === true);
		if (failure) {
			throw failure;
		}
		if (!text.trim() && call.empty) {
			return {};
		}
		if (!isRecord(parsed)) {
			throw unreadable(call.creates
				? 'The provider accepted the request but answered in a form AI Video cannot read.'
				: 'The provider answered in a form AI Video cannot read.');
		}
		return parsed;
	}

	/**
	 * One HTTP exchange. A request that may create a task and fails after its
	 * body left this computer answers `unknownOutcome`; one that never got
	 * through answers `network`.
	 */
	private send(method: string, url: URL, headers: Record<string, string>, body: Buffer | undefined, creates: boolean): Promise<HttpAnswer> {
		return new Promise<HttpAnswer>((resolve, reject) => {
			let bodySent = false;
			let settled = false;
			const fail = (error: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				const detail = networkDetail(error);
				reject(creates && bodySent
					? new ProviderFailure('unknownOutcome', `The connection ended after the request was sent: ${detail}`)
					: new ProviderFailure('network', detail));
			};
			const request = startRequest(url, {
				method,
				headers: { ...headers, ...(body ? { 'Content-Length': String(body.byteLength) } : {}) }
			}, response => {
				const chunks: Buffer[] = [];
				let size = 0;
				response.on('data', (chunk: Buffer) => {
					size += chunk.byteLength;
					if (size > MAX_ANSWER_BYTES) {
						if (!settled) {
							settled = true;
							reject(creates
								? new ProviderFailure('unknownOutcome', 'The provider answered with more than 4 MiB.')
								: unreadable('The provider answered with more than 4 MiB.'));
						}
						request.destroy();
						return;
					}
					chunks.push(chunk);
				});
				response.on('end', () => {
					if (!settled) {
						settled = true;
						resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
					}
				});
				response.on('error', fail);
				response.on('close', () => {
					if (!response.complete) {
						fail(new Error('The answer was cut off.'));
					}
				});
			});
			request.on('finish', () => {
				bodySent = true;
			});
			request.on('error', fail);
			request.setTimeout(creates ? this.options.createTimeoutMs : this.options.queryTimeoutMs, () => {
				request.destroy(new Error('No answer came in time.'));
			});
			request.end(body);
		});
	}

	/** Streams a video to a new file. See {@link downloadVideo}. */
	async download(source: string, targetFsPath: string): Promise<number> {
		if (!isAbsolute(targetFsPath) || !targetFsPath.endsWith('.part')) {
			throw rejected('AI Video writes a download only to a new .part file.');
		}
		const authorizationOrigin = this.endpointOrigin;
		let url = videoUrl(source);
		for (let redirects = 0; ; redirects++) {
			const headers: Record<string, string> = {
				Accept: 'video/mp4,application/octet-stream;q=0.9,*/*;q=0.5',
				'User-Agent': USER_AGENT,
				// The key goes only to the endpoint's own origin, never to a CDN.
				...(authorizationOrigin && url.origin === authorizationOrigin ? this.authorization : {})
			};
			const { request, response } = await this.open(url, headers);
			const status = response.statusCode ?? 0;
			if (status >= 300 && status < 400 && response.headers.location) {
				response.resume();
				request.destroy();
				if (redirects >= MAX_REDIRECTS) {
					throw unreadable('The video address redirected more than five times.');
				}
				url = videoUrl(new URL(response.headers.location, url).href);
				continue;
			}
			if (status < 200 || status >= 300) {
				response.resume();
				request.destroy();
				throw new ProviderFailure(status === 401 || status === 403 ? 'auth' : status === 404 || status === 410 ? 'notFound' : 'network', `The video download answered with HTTP ${status}.`, status);
			}
			return this.write(request, response, targetFsPath);
		}
	}

	/** Set by the command for downloads that may need the key. */
	endpointOrigin: string | undefined;
	authorization: Readonly<Record<string, string>> = {};

	private open(url: URL, headers: Record<string, string>): Promise<{ request: ClientRequest; response: IncomingMessage }> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const request = startRequest(url, { method: 'GET', headers }, response => {
				settled = true;
				resolve({ request, response });
			});
			request.on('error', error => {
				if (!settled) {
					settled = true;
					reject(new ProviderFailure('network', networkDetail(error)));
				}
			});
			request.setTimeout(this.options.queryTimeoutMs, () => request.destroy(new Error('No data came in time.')));
			request.end();
		});
	}

	private async write(request: ClientRequest, response: IncomingMessage, targetFsPath: string): Promise<number> {
		const limit = this.options.maxDownloadBytes;
		const declared = Number(response.headers['content-length']);
		if (Number.isFinite(declared) && declared > limit) {
			response.resume();
			request.destroy();
			throw new ProviderFailure('tooLarge', `The video is ${declared} bytes, more than the ${limit} bytes BaseHalf downloads.`);
		}
		const handle = await open(targetFsPath, 'wx');
		let size = 0;
		let head = Buffer.alloc(0);
		let checked = false;
		try {
			for await (const chunk of response as AsyncIterable<Buffer>) {
				size += chunk.byteLength;
				if (size > limit) {
					throw new ProviderFailure('tooLarge', `The video is larger than the ${limit} bytes BaseHalf downloads.`);
				}
				if (!checked) {
					head = Buffer.concat([head, chunk]);
					if (head.byteLength >= 8) {
						if (!isMp4(head)) {
							throw new ProviderFailure('notVideo', 'The file does not start like an MP4 video.');
						}
						checked = true;
					}
				}
				await handle.write(chunk);
			}
			if (!checked) {
				throw new ProviderFailure('notVideo', 'The file is too short to be an MP4 video.');
			}
			await handle.close();
			return size;
		} catch (error) {
			request.destroy();
			await handle.close().catch(() => undefined);
			await unlink(targetFsPath).catch(() => undefined);
			throw error instanceof ProviderFailure ? error : new ProviderFailure('network', networkDetail(error));
		}
	}
}

function startRequest(url: URL, options: RequestOptions, onResponse: (response: IncomingMessage) => void): ClientRequest {
	// A fresh connection per request: what counts as sent is this request's own.
	const settings: RequestOptions = { ...options, agent: false };
	return url.protocol === 'https:' ? httpsRequest(url, settings, onResponse) : httpRequest(url, settings, onResponse);
}

function networkDetail(error: unknown): string {
	if (error instanceof Error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code && !error.message.includes(code) ? `${error.message} (${code})` : error.message;
	}
	return String(error);
}

function isMp4(head: Buffer): boolean {
	return head.byteLength >= 8 && head.toString('latin1', 4, 8) === 'ftyp';
}

// --- addresses ----------------------------------------------------------------------------------

function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[(?<inner>.*)\]$/, '$<inner>');
	return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** An address that may carry a key: `https://`, or `http://` on this computer only. */
function isAllowedAddress(url: URL): boolean {
	return !url.username && !url.password
		&& (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname)));
}

function endpointUrl(baseUrl: string): URL {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw rejected('The endpoint is not a complete address. Check it in Video Providers.');
	}
	if (!isAllowedAddress(url) || url.search || url.hash) {
		throw rejected('The endpoint must start with https:// (http:// only on this computer) and have no user name, password, query, or fragment.');
	}
	return url;
}

function apiUrl(baseUrl: string, path: string): URL {
	const base = endpointUrl(baseUrl);
	return new URL(`${base.origin}${base.pathname.replace(/\/+$/, '')}${path}`);
}

function videoUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw unreadable('The provider gave a video address that is not complete.');
	}
	if (!isAllowedAddress(url)) {
		throw unreadable('The provider gave a video address that does not start with https://.');
	}
	return url;
}

// --- arguments ----------------------------------------------------------------------------------

const PROVIDERS: ReadonlySet<string> = new Set(['ark', 'byteplus', 'dashscope', 'minimax', 'gemini', 'openai']);

function parseEndpoint(value: unknown): VideoProviderEndpoint {
	if (!isRecord(value) || typeof value.provider !== 'string' || !PROVIDERS.has(value.provider)
		|| typeof value.baseUrl !== 'string' || typeof value.apiKey !== 'string' || typeof value.model !== 'string') {
		throw rejected('AI Video received a request it cannot read.');
	}
	if (!value.model.trim() || value.model.length > 256) {
		throw rejected('The model id is empty or too long.');
	}
	if (!/^[\x21-\x7E]{1,16384}$/.test(value.apiKey)) {
		throw new ProviderFailure('auth', 'The key is empty or has characters that cannot be sent. Set it again in Video Providers.');
	}
	endpointUrl(value.baseUrl);
	return { provider: value.provider as VideoProviderKind, baseUrl: value.baseUrl, apiKey: value.apiKey, model: value.model.trim() };
}

function parseTaskRef(value: unknown): VideoProviderTaskRef {
	const endpoint = parseEndpoint(value);
	const remoteId = isRecord(value) ? value.remoteId : undefined;
	if (typeof remoteId !== 'string' || !remoteId.trim() || remoteId.length > 256 || /[\u0000-\u001F\s]/.test(remoteId)) {
		throw rejected('The task id is not one a provider gave.');
	}
	return { ...endpoint, remoteId };
}

function parseDownloadRequest(value: unknown): VideoProviderDownloadRequest {
	const ref = parseTaskRef(value);
	const record = value as Record<string, unknown>;
	if (typeof record.targetFsPath !== 'string' || (record.videoUrl !== undefined && typeof record.videoUrl !== 'string')) {
		throw rejected('AI Video received a download it cannot read.');
	}
	return { ...ref, targetFsPath: record.targetFsPath, ...(typeof record.videoUrl === 'string' && record.videoUrl ? { videoUrl: record.videoUrl } : {}) };
}

function parseRequest(value: unknown): VideoProviderRequest {
	const endpoint = parseEndpoint(value);
	const record = value as Record<string, unknown>;
	const media = (entry: unknown): VideoProviderMedia => {
		if (isRecord(entry) && typeof entry.dataUrl === 'string') {
			return { dataUrl: entry.dataUrl };
		}
		if (isRecord(entry) && typeof entry.fsPath === 'string' && typeof entry.mimeType === 'string') {
			return { fsPath: entry.fsPath, mimeType: entry.mimeType };
		}
		throw rejected('AI Video received an input it cannot read.');
	};
	const list = (entry: unknown): VideoProviderMedia[] => Array.isArray(entry) ? entry.map(media) : [];
	if (typeof record.prompt !== 'string' || (record.mode !== 'frames' && record.mode !== 'reference')
		|| typeof record.ratio !== 'string' || typeof record.resolution !== 'string'
		|| typeof record.duration !== 'number' || !Number.isInteger(record.duration) || typeof record.audio !== 'boolean') {
		throw rejected('AI Video received a request it cannot read.');
	}
	return {
		...endpoint,
		prompt: record.prompt,
		mode: record.mode,
		ratio: record.ratio,
		resolution: record.resolution,
		duration: record.duration,
		audio: record.audio,
		...(record.startFrame !== undefined ? { startFrame: media(record.startFrame) } : {}),
		...(record.endFrame !== undefined ? { endFrame: media(record.endFrame) } : {}),
		referenceImages: list(record.referenceImages),
		referenceVideos: list(record.referenceVideos),
		referenceAudios: list(record.referenceAudios)
	};
}

// --- inputs -------------------------------------------------------------------------------------

interface ReadMedia {
	readonly bytes: Buffer;
	readonly mimeType: string;
	readonly name: string;
}

function isDataUrlMedia(media: VideoProviderMedia): media is { readonly dataUrl: string } {
	return typeof (media as { readonly dataUrl?: unknown }).dataUrl === 'string';
}

/** Reads an input from the workspace, or decodes one the workbench encoded. */
async function readMedia(media: VideoProviderMedia, what: string): Promise<ReadMedia> {
	if (isDataUrlMedia(media)) {
		const match = /^data:(?<type>[a-z]+\/[a-z0-9.+-]+);base64,(?<payload>[A-Za-z0-9+/=]*)$/i.exec(media.dataUrl);
		if (!match?.groups) {
			throw rejected(`The ${what} is not an encoded image AI Video can read.`);
		}
		const bytes = Buffer.from(match.groups.payload, 'base64');
		if (bytes.byteLength > MAX_VIDEO_INPUT_BYTES) {
			throw rejected(`The ${what} is larger than 20 MiB.`);
		}
		return { bytes, mimeType: match.groups.type.toLowerCase(), name: `${what.replace(/\s+/g, '-')}.png` };
	}
	const name = basename(media.fsPath);
	if (!isAbsolute(media.fsPath)) {
		throw rejected(`The ${what} ${name} is not a file on this computer.`);
	}
	let size: number;
	try {
		const info = await stat(media.fsPath);
		if (!info.isFile()) {
			throw new Error('not a file');
		}
		size = info.size;
	} catch {
		throw rejected(`The ${what} ${name} is missing.`);
	}
	if (size > MAX_VIDEO_INPUT_BYTES) {
		throw rejected(`The ${what} ${name} is larger than 20 MiB.`);
	}
	return { bytes: await readFile(media.fsPath), mimeType: media.mimeType.toLowerCase(), name };
}

async function dataUrlOf(media: VideoProviderMedia, what: string): Promise<string> {
	if (isDataUrlMedia(media)) {
		await readMedia(media, what);
		return media.dataUrl;
	}
	const read = await readMedia(media, what);
	return `data:${read.mimeType};base64,${read.bytes.toString('base64')}`;
}

function refuseLocalVideoAndAudio(request: VideoProviderRequest, format: string): void {
	if (request.referenceVideos.length || request.referenceAudios.length) {
		throw rejected(`The ${format} takes videos and audio only from public addresses, not from files on this computer.`);
	}
}

// --- formats ------------------------------------------------------------------------------------

interface VideoFormat {
	authorization(apiKey: string): Readonly<Record<string, string>>;
	submit(request: VideoProviderRequest, call: ProviderCall): Promise<string>;
	poll(ref: VideoProviderTaskRef, call: ProviderCall): Promise<VideoProviderPollState>;
	/** Where the video of a task that succeeded is, when the poll gave no address. */
	contentUrl(ref: VideoProviderTaskRef, call: ProviderCall): Promise<string>;
	cancel(ref: VideoProviderTaskRef, call: ProviderCall): Promise<boolean>;
}

function bearer(apiKey: string): Readonly<Record<string, string>> {
	return { Authorization: `Bearer ${apiKey}` };
}

/** Binds a format's key header to the call, for downloads from the endpoint's own origin. */
function bind(format: VideoFormat, endpoint: VideoProviderEndpoint, call: ProviderCall): Readonly<Record<string, string>> {
	const authorization = format.authorization(endpoint.apiKey);
	call.authorization = authorization;
	call.endpointOrigin = endpointUrl(endpoint.baseUrl).origin;
	return authorization;
}

/** The Seedance task API of Volcengine Ark and BytePlus ModelArk. */
const SEEDANCE: VideoFormat = {
	authorization: bearer,
	async submit(request, call) {
		refuseLocalVideoAndAudio(request, 'Seedance task API');
		const content: unknown[] = [];
		if (request.prompt.trim()) {
			content.push({ type: 'text', text: request.prompt });
		}
		const image = async (media: VideoProviderMedia, what: string, role: string) => ({ type: 'image_url', image_url: { url: await dataUrlOf(media, what) }, role });
		if (request.startFrame) {
			content.push(await image(request.startFrame, 'start frame', 'first_frame'));
		}
		if (request.endFrame) {
			content.push(await image(request.endFrame, 'end frame', 'last_frame'));
		}
		for (const reference of request.referenceImages) {
			content.push(await image(reference, 'reference image', 'reference_image'));
		}
		const answer = await call.json(request, bind(SEEDANCE, request, call), {
			method: 'POST',
			path: '/contents/generations/tasks',
			creates: true,
			json: {
				model: request.model,
				content,
				ratio: request.ratio,
				resolution: request.resolution,
				duration: request.duration,
				generate_audio: request.audio,
				watermark: false
			}
		});
		return taskId(answer.id);
	},
	async poll(ref, call) {
		const answer = await call.json(ref, bind(SEEDANCE, ref, call), { method: 'GET', path: `/contents/generations/tasks/${encodeURIComponent(ref.remoteId)}` });
		const status = typeof answer.status === 'string' ? answer.status.toLowerCase() : '';
		switch (status) {
			case 'queued':
				return { state: 'pending' };
			case 'running':
				return { state: 'running' };
			case 'succeeded': {
				const url = isRecord(answer.content) ? answer.content.video_url : undefined;
				return typeof url === 'string' && url ? { state: 'succeeded', videoUrl: url } : { state: 'succeeded' };
			}
			case 'failed':
			case 'expired':
				return { state: 'failed', message: messageOf(answer) || `The task ${status === 'expired' ? 'expired' : 'failed'}.` };
			case 'cancelled':
			case 'canceled':
				return { state: 'cancelled', message: messageOf(answer) || 'The task was cancelled.' };
			default:
				throw unreadable(`The provider reports a task status AI Video does not know: ${status || 'none'}.`);
		}
	},
	async contentUrl(ref, call) {
		const state = await SEEDANCE.poll(ref, call);
		if (state.state === 'succeeded' && state.videoUrl) {
			return state.videoUrl;
		}
		throw unreadable('The provider gives no video address for this task.');
	},
	async cancel(ref, call) {
		// Ark deletes a queued task; it cannot stop one that runs.
		await call.json(ref, bind(SEEDANCE, ref, call), { method: 'DELETE', path: `/contents/generations/tasks/${encodeURIComponent(ref.remoteId)}`, empty: true });
		return true;
	}
};

/** Width*height of Wan text-to-video for a resolution and a ratio. */
const WAN_SIZES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
	'480P': Object.freeze({ '16:9': '832*480', '9:16': '480*832', '1:1': '624*624' }),
	'720P': Object.freeze({ '16:9': '1280*720', '9:16': '720*1280', '1:1': '960*960', '4:3': '1088*832', '3:4': '832*1088' }),
	'1080P': Object.freeze({ '16:9': '1920*1080', '9:16': '1080*1920', '1:1': '1440*1440', '4:3': '1632*1248', '3:4': '1248*1632' })
});

/** Wan models that BaseHalf knows to have no sound switch: they choose their own sound. */
const WAN_WITHOUT_SOUND_SWITCH: ReadonlySet<string> = new Set(['wan2.6-t2v', 'wan2.6-i2v']);

/** Wan video synthesis of Alibaba Cloud Model Studio (DashScope). */
const WAN: VideoFormat = {
	authorization: bearer,
	async submit(request, call) {
		refuseLocalVideoAndAudio(request, 'Wan video synthesis');
		if (request.referenceImages.length) {
			throw rejected('Wan video synthesis takes reference images only from public addresses, not from files on this computer.');
		}
		const resolution = request.resolution.toUpperCase();
		const input: Record<string, unknown> = {};
		const parameters: Record<string, unknown> = { watermark: false };
		if (request.prompt.trim()) {
			input.prompt = request.prompt;
		}
		if (request.duration !== -1) {
			parameters.duration = request.duration;
		}
		if (!request.audio && !WAN_WITHOUT_SOUND_SWITCH.has(request.model)) {
			parameters.audio = false;
		}
		let path = '/services/aigc/video-generation/video-synthesis';
		if (request.startFrame && request.endFrame) {
			// First and last frame models answer at their own path.
			path = '/services/aigc/image2video/video-synthesis';
			input.first_frame_url = await dataUrlOf(request.startFrame, 'start frame');
			input.last_frame_url = await dataUrlOf(request.endFrame, 'end frame');
			parameters.resolution = resolution;
		} else if (request.startFrame) {
			input.img_url = await dataUrlOf(request.startFrame, 'start frame');
			parameters.resolution = resolution;
		} else {
			const size = WAN_SIZES[resolution]?.[request.ratio];
			if (size) {
				parameters.size = size;
			}
		}
		const answer = await call.json(request, bind(WAN, request, call), {
			method: 'POST',
			path,
			creates: true,
			headers: { 'X-DashScope-Async': 'enable' },
			json: { model: request.model, input, parameters }
		});
		return taskId(isRecord(answer.output) ? answer.output.task_id : undefined);
	},
	async poll(ref, call) {
		const answer = await call.json(ref, bind(WAN, ref, call), { method: 'GET', path: `/tasks/${encodeURIComponent(ref.remoteId)}` });
		const output = isRecord(answer.output) ? answer.output : {};
		const status = typeof output.task_status === 'string' ? output.task_status.toUpperCase() : '';
		switch (status) {
			case 'PENDING':
				return { state: 'pending' };
			case 'RUNNING':
				return { state: 'running' };
			case 'SUCCEEDED': {
				const url = output.video_url;
				return typeof url === 'string' && url ? { state: 'succeeded', videoUrl: url } : { state: 'succeeded' };
			}
			case 'FAILED':
				return { state: 'failed', message: messageOf(answer) || 'The task failed.' };
			case 'CANCELED':
			case 'CANCELLED':
				return { state: 'cancelled', message: messageOf(answer) || 'The task was cancelled.' };
			case 'UNKNOWN':
				// A task that does not exist, or that is older than a day.
				throw new ProviderFailure('notFound', messageOf(answer) || 'The provider does not know this task, or it is older than a day.');
			default:
				throw unreadable(`The provider reports a task status AI Video does not know: ${status || 'none'}.`);
		}
	},
	async contentUrl(ref, call) {
		const state = await WAN.poll(ref, call);
		if (state.state === 'succeeded' && state.videoUrl) {
			return state.videoUrl;
		}
		throw unreadable('The provider gives no video address for this task.');
	},
	async cancel(ref, call) {
		// Model Studio cancels a task only while it waits.
		await call.json(ref, bind(WAN, ref, call), { method: 'POST', path: `/tasks/${encodeURIComponent(ref.remoteId)}/cancel`, empty: true });
		return true;
	}
};

/** MiniMax answers HTTP 200 with its own status code; anything but 0 refused the request. */
function checkMiniMaxStatus(answer: Record<string, unknown>): void {
	const base = answer.base_resp;
	if (!isRecord(base) || base.status_code === undefined || base.status_code === 0) {
		return;
	}
	const code = Number(base.status_code);
	const message = typeof base.status_msg === 'string' && base.status_msg.trim() ? base.status_msg : `MiniMax status ${code}.`;
	if (code === 1004 || code === 2049) {
		throw new ProviderFailure('auth', message);
	}
	if (code === 1002 || code === 1039) {
		throw new ProviderFailure('rateLimited', message);
	}
	throw rejected(message);
}

/** MiniMax video generation. */
const MINIMAX: VideoFormat = {
	authorization: bearer,
	async submit(request, call) {
		refuseLocalVideoAndAudio(request, 'MiniMax video generation');
		if (request.referenceImages.length) {
			throw rejected('MiniMax video generation takes no reference images.');
		}
		const body: Record<string, unknown> = { model: request.model, resolution: request.resolution.toUpperCase() };
		if (request.prompt.trim()) {
			body.prompt = request.prompt;
		}
		if (request.duration !== -1) {
			body.duration = request.duration;
		}
		if (request.startFrame) {
			body.first_frame_image = await dataUrlOf(request.startFrame, 'start frame');
		}
		if (request.endFrame) {
			body.last_frame_image = await dataUrlOf(request.endFrame, 'end frame');
		}
		const answer = await call.json(request, bind(MINIMAX, request, call), { method: 'POST', path: '/video_generation', creates: true, json: body });
		checkMiniMaxStatus(answer);
		return taskId(answer.task_id);
	},
	async poll(ref, call) {
		const answer = await call.json(ref, bind(MINIMAX, ref, call), { method: 'GET', path: `/query/video_generation?task_id=${encodeURIComponent(ref.remoteId)}` });
		checkMiniMaxStatus(answer);
		switch (answer.status) {
			case 'Preparing':
			case 'Queueing':
				return { state: 'pending' };
			case 'Processing':
				return { state: 'running' };
			case 'Success':
				// The address comes from the file it made; see contentUrl.
				return { state: 'succeeded' };
			case 'Fail':
				return { state: 'failed', message: messageOf(answer) || 'The task failed.' };
			default:
				throw unreadable(`The provider reports a task status AI Video does not know: ${typeof answer.status === 'string' ? answer.status : 'none'}.`);
		}
	},
	async contentUrl(ref, call) {
		const authorization = bind(MINIMAX, ref, call);
		const task = await call.json(ref, authorization, { method: 'GET', path: `/query/video_generation?task_id=${encodeURIComponent(ref.remoteId)}` });
		checkMiniMaxStatus(task);
		const fileId = task.file_id;
		if ((typeof fileId !== 'string' || !fileId) && typeof fileId !== 'number') {
			throw unreadable('The provider names no file for this task.');
		}
		const file = await call.json(ref, authorization, { method: 'GET', path: `/files/retrieve?file_id=${encodeURIComponent(String(fileId))}` });
		checkMiniMaxStatus(file);
		const url = isRecord(file.file) ? file.file.download_url : undefined;
		if (typeof url !== 'string' || !url) {
			throw unreadable('The provider gives no download address for the video.');
		}
		return url;
	},
	async cancel() {
		// MiniMax documents no cancellation of a video task.
		return false;
	}
};

function inlineData(media: ReadMedia): Record<string, unknown> {
	return { inlineData: { mimeType: media.mimeType, data: media.bytes.toString('base64') } };
}

/** An operation name as Veo gives it: `models/<model>/operations/<id>`. */
function operationPath(remoteId: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(remoteId) || remoteId.split('/').some(segment => segment === '..' || segment === '.' || !segment)) {
		throw rejected('The task id is not an operation the provider gave.');
	}
	return remoteId;
}

/** Veo long-running prediction of the Gemini API. */
const VEO: VideoFormat = {
	authorization: apiKey => ({ 'x-goog-api-key': apiKey }),
	async submit(request, call) {
		refuseLocalVideoAndAudio(request, 'Veo long-running prediction');
		const instance: Record<string, unknown> = {};
		if (request.prompt.trim()) {
			instance.prompt = request.prompt;
		}
		if (request.startFrame) {
			instance.image = inlineData(await readMedia(request.startFrame, 'start frame'));
		}
		if (request.endFrame) {
			instance.lastFrame = inlineData(await readMedia(request.endFrame, 'end frame'));
		}
		if (request.referenceImages.length) {
			const references: unknown[] = [];
			for (const reference of request.referenceImages) {
				references.push({ image: inlineData(await readMedia(reference, 'reference image')), referenceType: 'asset' });
			}
			instance.referenceImages = references;
		}
		const parameters: Record<string, unknown> = {};
		if (request.ratio && request.ratio !== 'adaptive') {
			parameters.aspectRatio = request.ratio;
		}
		if (request.resolution) {
			parameters.resolution = request.resolution.toLowerCase();
		}
		if (request.duration !== -1) {
			parameters.durationSeconds = request.duration;
		}
		const model = request.model.replace(/^models\//, '');
		const answer = await call.json(request, bind(VEO, request, call), {
			method: 'POST',
			path: `/models/${encodeURIComponent(model)}:predictLongRunning`,
			creates: true,
			json: { instances: [instance], parameters }
		});
		return operationPath(taskId(answer.name));
	},
	async poll(ref, call) {
		const answer = await call.json(ref, bind(VEO, ref, call), { method: 'GET', path: `/${operationPath(ref.remoteId)}` });
		if (answer.done !== true) {
			return { state: 'running' };
		}
		if (isRecord(answer.error)) {
			return { state: 'failed', message: messageOf(answer) || 'The operation failed.' };
		}
		const response = isRecord(answer.response) ? answer.response : {};
		const generated = isRecord(response.generateVideoResponse) ? response.generateVideoResponse : {};
		const samples = Array.isArray(generated.generatedSamples) ? generated.generatedSamples : [];
		const first: unknown = samples[0];
		const uri = isRecord(first) && isRecord(first.video) ? first.video.uri : undefined;
		if (typeof uri === 'string' && uri) {
			return { state: 'succeeded', videoUrl: uri };
		}
		const reasons = Array.isArray(generated.raiMediaFilteredReasons) ? generated.raiMediaFilteredReasons.filter((reason): reason is string => typeof reason === 'string') : [];
		return { state: 'failed', message: reasons.length ? reasons.join(' ') : 'The provider made no video.' };
	},
	async contentUrl(ref, call) {
		const state = await VEO.poll(ref, call);
		if (state.state === 'succeeded' && state.videoUrl) {
			return state.videoUrl;
		}
		throw unreadable('The provider gives no video address for this operation.');
	},
	async cancel() {
		return false;
	}
};

/** `1280x720` for `16:9` at `720p`: the short side from the resolution, the long side from the ratio. */
export function videoSizeFor(ratio: string, resolution: string): string | undefined {
	const ratioMatch = /^(?<width>\d+):(?<height>\d+)$/.exec(ratio);
	const resolutionMatch = /^(?<lines>\d{3,4})p$/i.exec(resolution);
	if (!ratioMatch?.groups || !resolutionMatch?.groups) {
		return undefined;
	}
	const width = Number(ratioMatch.groups.width);
	const height = Number(ratioMatch.groups.height);
	const short = Number(resolutionMatch.groups.lines);
	if (!width || !height) {
		return undefined;
	}
	const long = Math.round(short * Math.max(width, height) / Math.min(width, height) / 2) * 2;
	return width >= height ? `${long}x${short}` : `${short}x${long}`;
}

/** A multipart form for `/videos`. */
function multipart(fields: readonly (readonly [string, string])[], files: readonly (readonly [string, ReadMedia])[]): { readonly body: Buffer; readonly contentType: string } {
	const boundary = `----BaseHalf${randomUUID().replace(/-/g, '')}`;
	const parts: Buffer[] = [];
	for (const [name, value] of fields) {
		parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
	}
	for (const [name, file] of files) {
		const fileName = file.name.replace(/["\r\n]/g, '_');
		parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fileName}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`, 'utf8'));
		parts.push(file.bytes);
		parts.push(Buffer.from('\r\n', 'utf8'));
	}
	parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
	return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** The `/videos` tasks of OpenAI and of relays that speak them. */
const VIDEOS: VideoFormat = {
	authorization: bearer,
	async submit(request, call) {
		const fields: [string, string][] = [['model', request.model], ['prompt', request.prompt]];
		if (request.duration !== -1) {
			fields.push(['seconds', String(request.duration)]);
		}
		const size = videoSizeFor(request.ratio, request.resolution);
		if (size) {
			fields.push(['size', size]);
		}
		const files: [string, ReadMedia][] = [];
		// Images are input references in order: the start frame, then the end
		// frame, or the reference images.
		if (request.startFrame) {
			files.push(['input_reference', await readMedia(request.startFrame, 'start frame')]);
		}
		if (request.endFrame) {
			files.push(['input_reference', await readMedia(request.endFrame, 'end frame')]);
		}
		for (const image of request.referenceImages) {
			files.push(['input_reference', await readMedia(image, 'reference image')]);
		}
		for (const video of request.referenceVideos) {
			files.push(['input_video', await readMedia(video, 'reference video')]);
		}
		for (const audio of request.referenceAudios) {
			files.push(['input_audio', await readMedia(audio, 'reference audio')]);
		}
		const answer = await call.json(request, bind(VIDEOS, request, call), { method: 'POST', path: '/videos', creates: true, raw: multipart(fields, files) });
		return taskId(answer.id);
	},
	async poll(ref, call) {
		const answer = await call.json(ref, bind(VIDEOS, ref, call), { method: 'GET', path: `/videos/${encodeURIComponent(ref.remoteId)}` });
		const status = typeof answer.status === 'string' ? answer.status.toLowerCase() : '';
		const progress = typeof answer.progress === 'number' && Number.isFinite(answer.progress) ? Math.min(1, Math.max(0, answer.progress / 100)) : undefined;
		switch (status) {
			case 'queued':
			case 'pending':
				return progress !== undefined ? { state: 'pending', fraction: progress } : { state: 'pending' };
			case 'in_progress':
			case 'processing':
			case 'running':
				return progress !== undefined ? { state: 'running', fraction: progress } : { state: 'running' };
			case 'completed':
			case 'succeeded': {
				const url = [answer.video_url, answer.url, answer.download_url].find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
				return url ? { state: 'succeeded', videoUrl: url } : { state: 'succeeded' };
			}
			case 'failed':
				return { state: 'failed', message: messageOf(answer) || 'The task failed.' };
			case 'cancelled':
			case 'canceled':
				return { state: 'cancelled', message: messageOf(answer) || 'The task was cancelled.' };
			default:
				throw unreadable(`The provider reports a task status AI Video does not know: ${status || 'none'}.`);
		}
	},
	async contentUrl(ref, call) {
		bind(VIDEOS, ref, call);
		return apiUrl(ref.baseUrl, `/videos/${encodeURIComponent(ref.remoteId)}/content`).href;
	},
	async cancel() {
		return false;
	}
};

const FORMATS: Readonly<Record<VideoProviderKind, VideoFormat>> = Object.freeze({
	ark: SEEDANCE,
	byteplus: SEEDANCE,
	dashscope: WAN,
	minimax: MINIMAX,
	gemini: VEO,
	openai: VIDEOS
});

// --- helpers ------------------------------------------------------------------------------------

/** A provider's task id, as the node's file can hold it. */
function taskId(value: unknown): string {
	if (typeof value === 'number' && Number.isSafeInteger(value)) {
		return String(value);
	}
	if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001F\s]/.test(value)) {
		throw unreadable('The provider accepted the request but gave no task id AI Video can read.');
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
