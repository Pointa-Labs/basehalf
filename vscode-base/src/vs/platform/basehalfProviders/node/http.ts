/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'http';
import { raceCancellationError } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { dispose, type IDisposable } from '../../../base/common/lifecycle.js';
import { failureForStatus, isRecord, ProviderFailure, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';

/**
 * HTTP for one provider command (video providers, "Requests"), bound to the
 * command's endpoint and to the module's credential headers, which go to the
 * endpoint's origin only.
 *
 * - `create` sends the request that creates a task, once. It is never retried:
 *   when its answer does not come back, or says nothing but a server error, the
 *   outcome is `unknownOutcome`. For a model that answers at once, whose
 *   provider makes the files before it answers, it waits up to ten minutes for
 *   the whole answer and reads up to 256 MiB of it.
 * - `request` sends a poll, a lookup, or an upload, and retries it on network
 *   errors and on HTTP 408, 429, 500, 502, 503, and 504: three times, 1, 2,
 *   then 4 seconds apart, or after the `Retry-After` the provider asks for, up
 *   to 30 seconds.
 * - `requestOnce` sends any other request once, such as a cancellation.
 * - `retry` runs a group of `requestOnce` calls again as a whole, under the
 *   rule of `request`, such as an upload that must start over with a new
 *   upload address.
 *
 * An answer that is not 2xx (and not in `accept`) throws a
 * {@link ProviderFailure}: `auth` for 401 and 403, `balance` for 402, `notFound`
 * for 404, `rateLimited` for 429, `rejected` for any other 4xx, with the
 * provider's message as the module's `readError` reads it. API requests never
 * follow a redirect. The extension's log gets the method, the path without its
 * query, the status, and the time of each exchange, and nothing else.
 */
export interface ProviderHttp {
	/** The endpoint of the command, without a trailing slash: the region's base URL or the one the user entered. */
	readonly endpoint: URL;
	/** Sends the request that creates a task, once. A command sends at most one. */
	create(call: HttpCall): Promise<HttpAnswer>;
	/** Sends a request that changes nothing at the provider, or an upload, with retries. */
	request(call: HttpCall): Promise<HttpAnswer>;
	/** Sends a request once, without retries, such as a cancellation. */
	requestOnce(call: HttpCall): Promise<HttpAnswer>;
	/**
	 * Waits, as between the retries of `request` and through the same sleep, so
	 * that tests make it instant: for a module that asks again until the
	 * provider is ready, such as for an uploaded file.
	 */
	wait(ms: number): Promise<void>;

	/**
	 * Runs a group of requests that only together do one thing, and runs the
	 * whole group again when one of its `requestOnce` calls fails as `request`
	 * would send it again: after a network error or an answer of 408, 429, 500,
	 * 502, 503, or 504, three times, 1, 2, then 4 seconds apart, or after the
	 * `Retry-After` the provider asks for, up to 30 seconds. It is for an upload
	 * whose provider says to start over with a new upload address rather than
	 * send a failed upload again. A group that sent a `create` is never run again.
	 */
	retry<T>(group: () => Promise<T>): Promise<T>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpCall {
	readonly method: HttpMethod;
	/**
	 * A path under the endpoint, such as `/contents/generations/tasks`. Encode
	 * ids with `encodeURIComponent`; a query goes in `query`.
	 */
	readonly path?: string;
	/**
	 * Instead of `path`: an absolute `https` address elsewhere, such as an upload
	 * address the provider handed out. The credential headers go only to the
	 * endpoint's origin.
	 */
	readonly url?: string;
	readonly query?: Readonly<Record<string, string | number | boolean>>;
	/** Headers of this request besides the credential headers. */
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: HttpBody;
	/** Statuses answered instead of thrown, such as 404 for a task that is gone. */
	readonly accept?: readonly number[];
	/**
	 * The largest answer read: 4 MiB unless the options say otherwise, and for
	 * the create of a model that answers at once, 256 MiB.
	 */
	readonly maxAnswerBytes?: number;
}

export type HttpBody =
	| { readonly kind: 'json'; readonly value: unknown }
	| { readonly kind: 'form'; readonly parts: readonly FormPart[] }
	| { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly contentType: string };

/** A field of a multipart form: text, or a file. */
export interface FormPart {
	readonly name: string;
	readonly value?: string;
	readonly file?: { readonly bytes: Uint8Array; readonly fileName: string; readonly contentType: string };
}

export interface HttpAnswer {
	readonly status: number;
	/** Lowercase names. */
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
	/** The body as JSON. Throws `invalidResponse`, or `unknownOutcome` for the answer to a create, when it is not JSON. */
	json(): unknown;
	/** The body as a JSON object, under the same rule as `json`. */
	object(): Record<string, unknown>;
}

/** Where the commands write their one line per exchange. A logger of the shared process is one. */
export interface ProviderLog {
	info(message: string): void;
}

export const NO_LOG: ProviderLog = Object.freeze({ info: () => undefined });

/** What an exchange needs of a request in flight: Node's own requests have it. */
export interface TransportRequest {
	/** The body has left this computer, or is leaving it. */
	on(event: 'finish', listener: () => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	/** Calls `onTimeout` once nothing has moved for `ms`. */
	setTimeout(ms: number, onTimeout: () => void): this;
	/** Ends the request; with an error, its `error` listeners hear it. */
	destroy(error?: Error): this;
	end(body?: Uint8Array): this;
}

/** What an exchange reads of an answer: a stream of its body with its status and headers. */
export interface TransportResponse extends AsyncIterable<Buffer> {
	readonly statusCode?: number;
	/** Lowercase names. */
	readonly headers: IncomingHttpHeaders;
	/** The whole body arrived. */
	readonly complete: boolean;
	on(event: 'data', listener: (chunk: Buffer) => void): this;
	on(event: 'end' | 'close', listener: () => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	resume(): this;
}

/** Starts one request. It never follows a redirect: a 3xx answer is the answer. */
export type ProviderTransport = (url: URL, options: { readonly method: string; readonly headers: Readonly<Record<string, string>> }, onResponse: (response: TransportResponse) => void) => TransportRequest;

/** Limits of the HTTP of a command. Tests lower them. */
export interface HttpOptions {
	/** The waits before the retries of `request`: 1, 2, then 4 seconds. */
	readonly retryDelaysMs?: readonly number[];
	/** The longest `Retry-After` waited for; a longer one ends the retries. */
	readonly maxRetryAfterMs?: number;
	/** Idle time allowed to a request that creates a task. */
	readonly createTimeoutMs?: number;
	/**
	 * The whole time allowed to the request that creates a task of a model that
	 * answers at once, from sending it to the last byte of its answer: ten
	 * minutes (providers, "Requests"). No byte for as long ends it too.
	 */
	readonly atOnceTimeoutMs?: number;
	/** Idle time allowed to any other request. */
	readonly requestTimeoutMs?: number;
	readonly maxAnswerBytes?: number;
	/** The largest answer read of the create of a model that answers at once, its files included. */
	readonly maxAtOnceAnswerBytes?: number;
	readonly maxRequestBytes?: number;
	readonly log?: ProviderLog;
	readonly sleep?: (ms: number) => Promise<void>;
	/** How requests are sent: Node's own requests unless the shared process says otherwise. */
	readonly transport?: ProviderTransport;
}

export type ResolvedHttpOptions = Required<HttpOptions>;

export const DEFAULT_HTTP_OPTIONS: ResolvedHttpOptions = Object.freeze({
	retryDelaysMs: Object.freeze([1000, 2000, 4000]),
	maxRetryAfterMs: 30_000,
	createTimeoutMs: 120_000,
	atOnceTimeoutMs: 10 * 60_000,
	requestTimeoutMs: 60_000,
	maxAnswerBytes: 4 * 1024 * 1024,
	maxAtOnceAnswerBytes: 256 * 1024 * 1024,
	maxRequestBytes: 128 * 1024 * 1024,
	log: NO_LOG,
	sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
	transport: (url, options, onResponse) => NODE_TRANSPORT(url, options, onResponse)
});

export function resolveHttpOptions(options: HttpOptions | undefined): ResolvedHttpOptions {
	return { ...DEFAULT_HTTP_OPTIONS, ...options };
}

/**
 * The HTTP of a call that ends with its token: the window that made the call
 * closed or reloaded (providers, "Requests"). A request that runs is torn
 * down, none starts after, and a wait before a retry ends. The token of a call
 * also ends when the call has answered, when none of its requests runs.
 */
export function boundToCall(options: ResolvedHttpOptions, token: CancellationToken): ResolvedHttpOptions {
	if (token === CancellationToken.None) {
		return options;
	}
	const ended = () => new Error('The window that asked for this is gone.');
	return {
		...options,
		transport: (url, settings, onResponse) => {
			if (token.isCancellationRequested) {
				throw ended();
			}
			// The token's listener goes with the exchange.
			const listeners: IDisposable[] = [];
			const done = () => dispose(listeners);
			const request = options.transport(url, settings, response => {
				response.on('close', done);
				onResponse(response);
			});
			listeners.push(token.onCancellationRequested(() => request.destroy(ended())));
			request.on('error', done);
			return request;
		},
		sleep: ms => raceCancellationError(options.sleep(ms), token)
	};
}

/** The statuses after which a request that may be retried is sent again. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export const USER_AGENT = 'BaseHalf-AI-Video';

// --- addresses ----------------------------------------------------------------------------------

function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[(?<inner>.*)\]$/, '$<inner>');
	return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** An address that may carry credentials: `https://`, or `http://` on this computer, without a user name or password. */
export function isAllowedAddress(url: URL): boolean {
	return !url.username && !url.password
		&& (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname)));
}

/** The endpoint of a command, checked: `https://`, or `http://` on this computer, without query or fragment. */
export function parseEndpoint(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw rejected('The endpoint is not a complete address. Check it in Providers.');
	}
	if (!isAllowedAddress(url) || url.search || url.hash) {
		throw rejected('The endpoint must start with https:// (http:// only on this computer) and have no user name, password, query, or fragment.');
	}
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url;
}

function callUrl(endpoint: URL, call: HttpCall): URL {
	let url: URL;
	if (call.url !== undefined) {
		try {
			url = new URL(call.url);
		} catch {
			throw unreadable('The provider gave an address that is not complete.');
		}
		if (!isAllowedAddress(url)) {
			throw unreadable('The provider gave an address that does not start with https://.');
		}
	} else {
		const path = call.path ?? '';
		if (!path.startsWith('/') || /[?#]/.test(path) || path.split('/').some(segment => segment === '..' || segment === '.')) {
			throw new Error(`An API path must start with / and carry no query, fragment, or dot segment: ${path}`);
		}
		// An endpoint without a path still has the pathname `/`, which would double the slash.
		const base = endpoint.pathname === '/' ? '' : endpoint.pathname;
		url = new URL(`${endpoint.origin}${base}${path}`);
	}
	for (const [name, value] of Object.entries(call.query ?? {})) {
		url.searchParams.set(name, String(value));
	}
	return url;
}

// --- one exchange -------------------------------------------------------------------------------

interface RawAnswer {
	readonly status: number;
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
}

/** A transport failure, with whether `request` may send the request again. */
class TransportFailure extends ProviderFailure {
	readonly retryable: boolean;

	constructor(failure: ProviderFailure, retryable: boolean) {
		super(failure.code, failure.message, failure.status);
		this.retryable = retryable;
	}
}

/** The answer of a `requestOnce` call that `request` would send again (408, 429, 5xx), with the wait the provider asked for. */
class RetryableAnswer extends ProviderFailure {
	readonly waitMs: number | undefined;

	constructor(failure: ProviderFailure, waitMs: number | undefined) {
		super(failure.code, failure.message, failure.status);
		this.waitMs = waitMs;
	}
}

/** A failure without what lets a group of requests run again, once its own retries are spent. */
function settled(error: unknown): unknown {
	return error instanceof TransportFailure || error instanceof RetryableAnswer ? new ProviderFailure(error.code, error.message, error.status) : error;
}

/** The request of Node's `http` or `https`, or of what stands for them, such as modules that apply the system's proxy. */
export interface NodeHttpModule {
	request(url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest;
}

/** Node's `http` and `https`, or what stands for them. */
export interface NodeHttpModules {
	readonly http: NodeHttpModule;
	readonly https: NodeHttpModule;
}

/**
 * Node's own requests, through `modules` once `load` gave them: one connection
 * each, and none is sent again by itself, so that a create reaches the
 * provider once (providers, "Requests"). Node's `http` and `https` load with
 * the first request.
 */
export function createNodeTransport(load: () => NodeHttpModules = loadNodeHttpModules): ProviderTransport {
	let modules: NodeHttpModules | undefined;
	return (url, options, onResponse) => {
		modules ??= load();
		// A fresh connection per request: what counts as sent is this request's own.
		const settings: RequestOptions = { method: options.method, headers: { ...options.headers }, agent: false };
		return (url.protocol === 'https:' ? modules.https : modules.http).request(url, settings, onResponse);
	};
}

function loadNodeHttpModules(): NodeHttpModules {
	return { http: process.getBuiltinModule('http'), https: process.getBuiltinModule('https') };
}

/** Node's own requests, which the tests send with. */
const NODE_TRANSPORT = createNodeTransport();

export function networkDetail(error: unknown): string {
	if (error instanceof Error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code && !error.message.includes(code) ? `${error.message} (${code})` : error.message;
	}
	return String(error);
}

/** The wait a `Retry-After` header asks for, in milliseconds. */
export function retryAfterMs(value: string | string[] | undefined, now = Date.now()): number | undefined {
	const text = Array.isArray(value) ? value[0] : value;
	if (!text?.trim()) {
		return undefined;
	}
	if (/^\d+$/.test(text.trim())) {
		return Number(text.trim()) * 1000;
	}
	const date = Date.parse(text);
	return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function encodeBody(body: HttpBody | undefined): { readonly bytes: Buffer; readonly contentType: string } | undefined {
	if (!body) {
		return undefined;
	}
	switch (body.kind) {
		case 'json':
			return { bytes: Buffer.from(JSON.stringify(body.value), 'utf8'), contentType: 'application/json' };
		case 'form': {
			const boundary = `----BaseHalf${randomUUID().replace(/-/g, '')}`;
			const parts: Buffer[] = [];
			const safe = (text: string) => text.replace(/["\r\n\\]/g, '_');
			for (const part of body.parts) {
				if (part.file) {
					parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(part.name)}"; filename="${safe(part.file.fileName)}"\r\nContent-Type: ${part.file.contentType}\r\n\r\n`, 'utf8'));
					parts.push(Buffer.from(part.file.bytes));
					parts.push(Buffer.from('\r\n', 'utf8'));
				} else {
					parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(part.name)}"\r\n\r\n${part.value ?? ''}\r\n`, 'utf8'));
				}
			}
			parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
			return { bytes: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
		}
		case 'bytes':
			return { bytes: Buffer.from(body.bytes), contentType: body.contentType };
	}
}

/**
 * The HTTP of one command. The commands make one per call and read back
 * whether a create was answered and which header values carried secrets.
 */
export class BoundHttp implements ProviderHttp {
	readonly endpoint: URL;
	readonly options: ResolvedHttpOptions;
	/** The model of the command answers at once: its create waits for the files. */
	readonly answersAtOnce: boolean;
	/**
	 * The time a create may take: the idle time of `createTimeoutMs`, or for a
	 * model that answers at once, the whole exchange within `atOnceTimeoutMs`.
	 */
	readonly createTimeoutMs: number;
	private readonly authorize: () => Readonly<Record<string, string>>;
	private readonly readError: (status: number, body: unknown) => ProviderErrorReading | undefined;
	private createCalled = false;
	/** A create got a 2xx answer: a task may exist from here on. */
	createAnswered = false;
	/** The values of the credential headers sent, kept out of every message. */
	readonly secretValues = new Set<string>();

	constructor(
		endpoint: URL,
		authorize: () => Readonly<Record<string, string>>,
		readError: ((status: number, body: unknown) => ProviderErrorReading | undefined) | undefined,
		options: ResolvedHttpOptions,
		answersAtOnce = false
	) {
		this.endpoint = endpoint;
		this.authorize = authorize;
		this.readError = readError ?? ((_status, body) => readCommonError(body));
		this.options = options;
		this.answersAtOnce = answersAtOnce;
		this.createTimeoutMs = answersAtOnce ? options.atOnceTimeoutMs : options.createTimeoutMs;
	}

	/** The credential headers for an address: only on the endpoint's origin. */
	credentialHeadersFor(url: URL): Readonly<Record<string, string>> {
		if (url.origin !== this.endpoint.origin) {
			return {};
		}
		const headers = this.authorize();
		for (const value of Object.values(headers)) {
			// "Bearer <token>": the token is the secret.
			this.secretValues.add(/^[A-Za-z][\w-]*\s+(?<token>\S+)$/.exec(value)?.groups?.token ?? value);
		}
		return headers;
	}

	log(method: string, url: URL, outcome: number | string, startedAt: number): void {
		this.options.log.info(`${method} ${url.pathname} ${outcome} ${Date.now() - startedAt} ms`);
	}

	async create(call: HttpCall): Promise<HttpAnswer> {
		if (this.createCalled) {
			throw new Error('A provider command sends at most one request that creates a task.');
		}
		this.createCalled = true;
		const raw = await this.exchange(call, true);
		const answer = this.finish(raw, call, true);
		this.createAnswered = true;
		return answer;
	}

	async request(call: HttpCall): Promise<HttpAnswer> {
		const delays = this.options.retryDelaysMs;
		for (let attempt = 0; ; attempt++) {
			let raw: RawAnswer;
			try {
				raw = await this.exchange(call, false);
			} catch (error) {
				if (error instanceof TransportFailure && error.retryable && attempt < delays.length) {
					await this.options.sleep(delays[attempt]);
					continue;
				}
				// Its retries are spent: a group around it does not send it again.
				throw settled(error);
			}
			if (RETRYABLE_STATUSES.has(raw.status) && !(call.accept ?? []).includes(raw.status) && attempt < delays.length) {
				const asked = retryAfterMs(raw.headers['retry-after']);
				if (asked === undefined) {
					await this.options.sleep(delays[attempt]);
					continue;
				}
				if (asked <= this.options.maxRetryAfterMs) {
					await this.options.sleep(asked);
					continue;
				}
			}
			return this.finish(raw, call, false);
		}
	}

	async requestOnce(call: HttpCall): Promise<HttpAnswer> {
		return this.finish(await this.exchange(call, false), call, false, true);
	}

	wait(ms: number): Promise<void> {
		return this.options.sleep(Number.isFinite(ms) ? Math.max(0, ms) : 0);
	}

	async retry<T>(group: () => Promise<T>): Promise<T> {
		const delays = this.options.retryDelaysMs;
		for (let attempt = 0; ; attempt++) {
			const created = this.createCalled;
			try {
				return await group();
			} catch (error) {
				const wait = error instanceof RetryableAnswer
					? error.waitMs ?? delays[attempt]
					: error instanceof TransportFailure && error.retryable ? delays[attempt] : undefined;
				// A group that sent a request creating a task is never sent again.
				if (attempt >= delays.length || wait === undefined || wait > this.options.maxRetryAfterMs || this.createCalled !== created) {
					throw settled(error);
				}
				await this.options.sleep(wait);
			}
		}
	}

	/** The answer, or the failure of its status; `once`: the failure says when a group may send it again. */
	private finish(raw: RawAnswer, call: HttpCall, creates: boolean, once = false): HttpAnswer {
		const ok = raw.status >= 200 && raw.status < 300;
		if (!ok && !(call.accept ?? []).includes(raw.status)) {
			const failure = failureForStatus(raw.status, this.readError(raw.status, parseJson(raw.body)), creates);
			const asked = retryAfterMs(raw.headers['retry-after']);
			const told = failure.code === 'rateLimited' && asked !== undefined && asked > 0
				? new ProviderFailure(failure.code, `${failure.message} The provider asks to wait ${Math.ceil(asked / 1000)} seconds.`, failure.status)
				: failure;
			throw once && RETRYABLE_STATUSES.has(raw.status) ? new RetryableAnswer(told, asked) : told;
		}
		const fail = () => creates
			? unknownOutcome('The provider accepted the request but answered in a form BaseHalf cannot read.')
			: unreadable('The provider answered in a form BaseHalf cannot read.');
		return {
			status: raw.status,
			headers: raw.headers,
			body: raw.body,
			json() {
				const value = parseJson(raw.body);
				if (value === undefined) {
					throw fail();
				}
				return value;
			},
			object() {
				const value = parseJson(raw.body);
				if (!isRecord(value)) {
					throw fail();
				}
				return value;
			}
		};
	}

	/**
	 * One exchange. A transport failure of a request that creates a task is
	 * `unknownOutcome` once its body has left this computer, and `network` before.
	 * The create of a model that answers at once ends when its whole answer has
	 * not come within its time, however the bytes trickle in.
	 */
	private exchange(call: HttpCall, creates: boolean): Promise<RawAnswer> {
		const url = callUrl(this.endpoint, call);
		const body = encodeBody(call.body);
		if (body && body.bytes.byteLength > this.options.maxRequestBytes) {
			throw rejected(`The request with its inputs is larger than ${Math.floor(this.options.maxRequestBytes / (1024 * 1024))} MiB. Use fewer or smaller inputs.`);
		}
		const headers: Record<string, string> = {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
			...(body ? { 'Content-Type': body.contentType, 'Content-Length': String(body.bytes.byteLength) } : {}),
			...(call.headers ?? {}),
			...this.credentialHeadersFor(url)
		};
		const atOnce = creates && this.answersAtOnce;
		const limit = call.maxAnswerBytes ?? (atOnce ? this.options.maxAtOnceAnswerBytes : this.options.maxAnswerBytes);
		const startedAt = Date.now();
		return new Promise<RawAnswer>((resolve, reject) => {
			let bodySent = false;
			let settled = false;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			const fail = (error: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(deadline);
				this.log(call.method, url, 'failed', startedAt);
				const detail = networkDetail(error);
				reject(creates && bodySent
					? new TransportFailure(unknownOutcome(`The connection ended after the request was sent: ${detail}`), false)
					: new TransportFailure(new ProviderFailure('network', detail), true));
			};
			let request: TransportRequest;
			try {
				request = this.options.transport(url, { method: call.method, headers }, response => {
					const chunks: Buffer[] = [];
					let size = 0;
					response.on('data', (chunk: Buffer) => {
						if (settled) {
							return;
						}
						size += chunk.byteLength;
						if (size > limit) {
							settled = true;
							clearTimeout(deadline);
							this.log(call.method, url, response.statusCode ?? 'failed', startedAt);
							const message = `The provider answered with more than ${Math.floor(limit / 1024)} KiB.`;
							reject(new TransportFailure(creates ? unknownOutcome(message) : unreadable(message), false));
							request.destroy();
							return;
						}
						chunks.push(chunk);
					});
					response.on('end', () => {
						if (!settled) {
							settled = true;
							clearTimeout(deadline);
							this.log(call.method, url, response.statusCode ?? 0, startedAt);
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
			} catch (error) {
				reject(rejected(`BaseHalf could not send the request: ${networkDetail(error)}`));
				return;
			}
			request.on('finish', () => {
				bodySent = true;
			});
			request.on('error', fail);
			const timedOut = () => request.destroy(new Error('No answer came in time.'));
			request.setTimeout(creates ? this.createTimeoutMs : this.options.requestTimeoutMs, timedOut);
			if (atOnce) {
				deadline = setTimeout(timedOut, this.createTimeoutMs);
				// Node's timer keeps no process alive by itself; a window's timer has no `unref`.
				(deadline as unknown as { unref?: () => void }).unref?.();
			}
			request.end(body?.bytes);
		});
	}
}

function parseJson(body: Buffer): unknown {
	const text = body.toString('utf8');
	if (!text.trim()) {
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
