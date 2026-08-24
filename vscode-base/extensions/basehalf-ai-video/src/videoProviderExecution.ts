/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { request as httpsRequest } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import type { SerializedVideoProviderRequest } from './videoProviderAdapters';

const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SUBMISSION_BYTES = 64 * 1024 * 1024;
export const MAX_GENERATED_VIDEO_BYTES = 256 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAXIMUM_POLL_ATTEMPTS = 180;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const REMOTE_CANCEL_TIMEOUT_MS = 10_000;
const MAX_SAFE_READ_RETRIES = 3;

export interface VideoProviderExecutionAccess {
	readonly endpoint: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly authorization: 'bearer' | 'header' | 'none';
	readonly headerName?: string;
	/** All short-lived credential values granted by the host for this provider. */
	readonly credentialValues?: Readonly<Record<string, string>>;
	readonly apiKey?: string;
}

export interface VideoExecutionCancellation {
	readonly isCancellationRequested: boolean;
	readonly onCancellationRequested: (listener: () => void) => { dispose(): void };
}

export interface VideoHttpRequest {
	readonly method: 'GET' | 'POST' | 'DELETE';
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: Uint8Array;
	readonly maximumResponseBytes: number;
	readonly maximumRedirects?: number;
	readonly timeoutMilliseconds?: number;
}

export interface VideoHttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Uint8Array;
}

export type VideoHttpClient = (
	request: VideoHttpRequest,
	cancellation: VideoExecutionCancellation
) => Promise<VideoHttpResponse>;

export interface VideoProviderExecutionOptions {
	readonly httpClient?: VideoHttpClient;
	readonly cancellation: VideoExecutionCancellation;
	/** Existing durable remote task for an exact host-validated Retry. */
	readonly resumeProviderRequestId?: string;
	/** Must durably persist the remote id before the executor begins polling. */
	readonly acknowledgeProviderRequestId: (providerRequestId: string) => PromiseLike<void>;
	readonly onStatus?: (message: string) => void;
	readonly wait?: (milliseconds: number, cancellation: VideoExecutionCancellation) => Promise<void>;
	readonly pollIntervalMilliseconds?: number;
	readonly maximumPollAttempts?: number;
}

export interface ExecutedVideoProviderRequest {
	readonly providerRequestId: string;
	readonly video: Uint8Array;
	readonly usage?: {
		readonly outputTokens?: number;
		readonly videoSeconds?: number;
	};
}

export class VideoProviderCancelledError extends Error {
	constructor() {
		super('Video generation was cancelled.');
		this.name = 'VideoProviderCancelledError';
	}
}

export class VideoProviderProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VideoProviderProtocolError';
	}
}

class VideoProviderHttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'VideoProviderHttpError';
		this.status = status;
	}
}

interface ProviderPollResult {
	readonly kind: 'pending' | 'succeeded' | 'failed' | 'cancelled';
	readonly message: string;
	readonly videoUrl?: string;
	readonly fileId?: string;
	readonly usage?: ExecutedVideoProviderRequest['usage'];
}

const NEVER_CANCELLED: VideoExecutionCancellation = Object.freeze({
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => undefined })
});

/**
 * Executes one already validated provider request. A paid POST is never
 * transport-retried. An exact Retry first resumes its durable task and may
 * submit one replacement only after that task is confirmed terminal; only
 * idempotent task reads and file lookup use transient retries.
 */
export async function executeSerializedVideoProviderRequest(
	serialized: SerializedVideoProviderRequest,
	access: VideoProviderExecutionAccess,
	options: VideoProviderExecutionOptions
): Promise<ExecutedVideoProviderRequest> {
	if (serialized.provider !== access.providerId) {
		throw new VideoProviderProtocolError(`The selected provider '${access.providerId}' does not match request adapter '${serialized.provider}'.`);
	}
	const httpClient = options.httpClient ?? createNodeVideoHttpClient();
	const wait = options.wait ?? waitForCancellation;
	const pollInterval = boundedInteger(options.pollIntervalMilliseconds ?? DEFAULT_POLL_INTERVAL_MS, 0, 60_000, 'poll interval');
	const maximumPollAttempts = boundedInteger(options.maximumPollAttempts ?? DEFAULT_MAXIMUM_POLL_ATTEMPTS, 1, 10_000, 'maximum poll attempts');
	const credentialSecrets = collectCredentialSecrets(access);
	const reportStatus = (message: string): void => options.onStatus?.(redactCredentialSecrets(message, credentialSecrets));
	const baseHeaders = authorizationHeaders(access);
	const submitBody = Buffer.from(JSON.stringify(serialized.body), 'utf8');
	if (submitBody.byteLength > MAX_SUBMISSION_BYTES) {
		throw new VideoProviderProtocolError(`The provider submission exceeds the ${MAX_SUBMISSION_BYTES}-byte request limit.`);
	}
	const submitUrl = providerUrl(access.endpoint, serialized.endpointPath);
	let providerRequestId: string | undefined;
	let terminal = false;
	let taskDurablyKnown = options.resumeProviderRequestId !== undefined;
	let replacementSubmitted = false;
	let durableAcknowledgementFailed = false;
	const submitTask = async (): Promise<string> => {
		throwIfCancelled(options.cancellation);
		reportStatus(replacementSubmitted ? 'Submitting replacement video generation' : 'Submitting video generation');
		throwIfCancelled(options.cancellation);
		const submitted = await requestJson(httpClient, {
			method: 'POST',
			url: submitUrl,
			headers: {
				...baseHeaders,
				...serialized.headers,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: submitBody,
			maximumResponseBytes: MAX_JSON_RESPONSE_BYTES
		}, options.cancellation);
		return parseSubmissionId(serialized.provider, submitted);
	};
	const acknowledgeTask = async (taskId: string): Promise<void> => {
		try {
			await options.acknowledgeProviderRequestId(taskId);
		} catch (error) {
			durableAcknowledgementFailed = true;
			throw error;
		}
	};

	try {
		throwIfCancelled(options.cancellation);
		if (options.resumeProviderRequestId !== undefined) {
			providerRequestId = boundedIdentifier(options.resumeProviderRequestId, 'provider Retry task id');
			reportStatus('Resuming existing video generation');
		} else {
			providerRequestId = await submitTask();
			taskDurablyKnown = false;
		}
		// Polling cannot begin until the host has durably frozen this identity into
		// the new Attempt, including when an exact Retry reuses an existing task.
		await acknowledgeTask(providerRequestId);
		taskDurablyKnown = true;
		throwIfCancelled(options.cancellation);

		let attempt = 0;
		while (attempt < maximumPollAttempts) {
			throwIfCancelled(options.cancellation);
			await wait(pollInterval, options.cancellation);
			throwIfCancelled(options.cancellation);
			const polled = await pollProvider(httpClient, serialized.provider, access, baseHeaders, providerRequestId, options.cancellation, wait);
			terminal = polled.kind !== 'pending';
			reportStatus(polled.message);
			throwIfCancelled(options.cancellation);
			if (polled.kind === 'pending') {
				attempt++;
				continue;
			}
			if (polled.kind === 'failed' || polled.kind === 'cancelled') {
				if (options.resumeProviderRequestId !== undefined && !replacementSubmitted) {
					reportStatus('The previous remote task is terminal; retrying with a new generation');
					replacementSubmitted = true;
					providerRequestId = await submitTask();
					terminal = false;
					taskDurablyKnown = false;
					await acknowledgeTask(providerRequestId);
					taskDurablyKnown = true;
					attempt = 0;
					continue;
				}
				throw new VideoProviderProtocolError(polled.message);
			}

			const videoUrl = serialized.provider === 'minimax'
				? await resolveMiniMaxDownloadUrl(httpClient, access, baseHeaders, requiredText(polled.fileId, 'MiniMax file id'), options.cancellation, wait)
				: requiredText(polled.videoUrl, `${serialized.provider} output URL`);
			throwIfCancelled(options.cancellation);
			reportStatus('Downloading generated video');
			const video = await downloadAndValidateMp4(httpClient, videoUrl, options.cancellation);
			return Object.freeze({
				providerRequestId,
				video,
				...(polled.usage === undefined ? {} : { usage: polled.usage })
			});
		}
		throw new VideoProviderProtocolError(`Provider task '${providerRequestId}' did not finish within the reviewed polling window.`);
	} catch (error) {
		if (providerRequestId && !terminal
			&& ((!durableAcknowledgementFailed && options.cancellation.isCancellationRequested) || !taskDurablyKnown)) {
			await cancelRemoteTaskBestEffort(httpClient, serialized.provider, access, baseHeaders, providerRequestId);
		}
		throw redactProviderExecutionError(error, credentialSecrets);
	}
}

export function createNodeVideoHttpClient(): VideoHttpClient {
	return async (request, cancellation) => requestWithRedirects(request, cancellation, request.maximumRedirects ?? 0);
}

async function requestWithRedirects(
	request: VideoHttpRequest,
	cancellation: VideoExecutionCancellation,
	redirectsRemaining: number
): Promise<VideoHttpResponse> {
	const response = await requestOnce(request, cancellation);
	if (![301, 302, 303, 307, 308].includes(response.status)) {
		return response;
	}
	const location = response.headers.location;
	if (!location || redirectsRemaining < 1) {
		throw new VideoProviderProtocolError('The provider returned an unexpected redirect.');
	}
	const from = safeHttpsUrl(request.url, 'request URL');
	const to = safeHttpsUrl(new URL(location, from).toString(), 'redirect URL');
	const sameOrigin = from.origin === to.origin;
	const headers = sameOrigin ? request.headers : stripCredentialHeaders(request.headers);
	return requestWithRedirects({
		...request,
		url: to.toString(),
		headers,
		...(response.status === 303 ? { method: 'GET', body: undefined } : {}),
		maximumRedirects: redirectsRemaining - 1
	}, cancellation, redirectsRemaining - 1);
}

function requestOnce(request: VideoHttpRequest, cancellation: VideoExecutionCancellation): Promise<VideoHttpResponse> {
	throwIfCancelled(cancellation);
	const url = safeHttpsUrl(request.url, 'request URL');
	if (!Number.isSafeInteger(request.maximumResponseBytes) || request.maximumResponseBytes < 0) {
		throw new VideoProviderProtocolError('HTTP response limit is invalid.');
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		let cancellationSubscription: { dispose(): void } | undefined;
		const settle = (callback: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			cancellationSubscription?.dispose();
			callback();
		};
		const nodeRequest = httpsRequest(url, {
			method: request.method,
			headers: {
				...request.headers,
				...(request.body === undefined ? {} : { 'Content-Length': String(request.body.byteLength) })
			}
		}, response => {
			const chunks: Buffer[] = [];
			let length = 0;
			response.on('data', (chunk: Buffer | string) => {
				const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
				length += bytes.byteLength;
				if (length > request.maximumResponseBytes) {
					response.destroy(new VideoProviderProtocolError(`HTTP response exceeds the ${request.maximumResponseBytes}-byte limit.`));
					return;
				}
				chunks.push(bytes);
			});
			response.on('end', () => settle(() => resolve(Object.freeze({
				status: response.statusCode ?? 0,
				headers: freezeHeaders(response.headers),
				body: Buffer.concat(chunks, length)
			}))));
			response.on('error', error => settle(() => reject(error)));
		});
		nodeRequest.setTimeout(request.timeoutMilliseconds ?? DEFAULT_REQUEST_TIMEOUT_MS, () => {
			nodeRequest.destroy(new VideoProviderProtocolError('The provider request timed out.'));
		});
		nodeRequest.on('error', error => settle(() => reject(error)));
		cancellationSubscription = cancellation.onCancellationRequested(() => {
			nodeRequest.destroy(new VideoProviderCancelledError());
		});
		if (cancellation.isCancellationRequested) {
			nodeRequest.destroy(new VideoProviderCancelledError());
			return;
		}
		if (request.body !== undefined) {
			nodeRequest.write(request.body);
		}
		nodeRequest.end();
	});
}

async function pollProvider(
	httpClient: VideoHttpClient,
	provider: string,
	access: VideoProviderExecutionAccess,
	headers: Readonly<Record<string, string>>,
	providerRequestId: string,
	cancellation: VideoExecutionCancellation,
	wait: (milliseconds: number, cancellation: VideoExecutionCancellation) => Promise<void>
): Promise<ProviderPollResult> {
	const task = encodeURIComponent(providerRequestId);
	if (provider === 'byteplus') {
		const body = await requestJsonWithSafeRetries(httpClient, {
			method: 'GET',
			url: providerUrl(access.endpoint, `/api/v3/contents/generations/tasks/${task}`),
			headers: { ...headers, Accept: 'application/json' },
			maximumResponseBytes: MAX_JSON_RESPONSE_BYTES
		}, cancellation, wait);
		return parseBytePlusPoll(body);
	}
	if (provider === 'minimax') {
		const body = await requestJsonWithSafeRetries(httpClient, {
			method: 'GET',
			url: providerUrl(access.endpoint, `/v1/query/video_generation?task_id=${task}`),
			headers: { ...headers, Accept: 'application/json' },
			maximumResponseBytes: MAX_JSON_RESPONSE_BYTES
		}, cancellation, wait);
		return parseMiniMaxPoll(body);
	}
	if (provider === 'alibaba-cloud') {
		const body = await requestJsonWithSafeRetries(httpClient, {
			method: 'GET',
			url: providerUrl(access.endpoint, `/api/v1/tasks/${task}`),
			headers: { ...headers, Accept: 'application/json' },
			maximumResponseBytes: MAX_JSON_RESPONSE_BYTES
		}, cancellation, wait);
		return parseWanPoll(body);
	}
	throw new VideoProviderProtocolError(`No asynchronous task protocol exists for provider '${provider}'.`);
}

async function resolveMiniMaxDownloadUrl(
	httpClient: VideoHttpClient,
	access: VideoProviderExecutionAccess,
	headers: Readonly<Record<string, string>>,
	fileId: string,
	cancellation: VideoExecutionCancellation,
	wait: (milliseconds: number, cancellation: VideoExecutionCancellation) => Promise<void>
): Promise<string> {
	const body = await requestJsonWithSafeRetries(httpClient, {
		method: 'GET',
		url: providerUrl(access.endpoint, `/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`),
		headers: { ...headers, Accept: 'application/json' },
		maximumResponseBytes: MAX_JSON_RESPONSE_BYTES
	}, cancellation, wait);
	const file = record(record(body, 'MiniMax file response').file, 'MiniMax file');
	return requiredText(file.download_url, 'MiniMax download URL');
}

async function downloadAndValidateMp4(
	httpClient: VideoHttpClient,
	videoUrl: string,
	cancellation: VideoExecutionCancellation
): Promise<Uint8Array> {
	const response = await httpClient({
		method: 'GET',
		url: safeHttpsUrl(videoUrl, 'provider video URL').toString(),
		headers: { Accept: 'video/mp4,application/octet-stream;q=0.9' },
		maximumResponseBytes: MAX_GENERATED_VIDEO_BYTES,
		maximumRedirects: 5,
		timeoutMilliseconds: 5 * 60_000
	}, cancellation);
	if (response.body.byteLength > MAX_GENERATED_VIDEO_BYTES) {
		throw new VideoProviderProtocolError(`Provider video exceeds the ${MAX_GENERATED_VIDEO_BYTES}-byte limit.`);
	}
	assertSuccessfulHttp(response);
	if (response.body.byteLength < 12
		|| response.body[4] !== 0x66
		|| response.body[5] !== 0x74
		|| response.body[6] !== 0x79
		|| response.body[7] !== 0x70) {
		throw new VideoProviderProtocolError('The provider download is not a valid MP4 file.');
	}
	return response.body;
}

async function cancelRemoteTaskBestEffort(
	httpClient: VideoHttpClient,
	provider: string,
	access: VideoProviderExecutionAccess,
	headers: Readonly<Record<string, string>>,
	providerRequestId: string
): Promise<void> {
	const task = encodeURIComponent(providerRequestId);
	let request: VideoHttpRequest | undefined;
	if (provider === 'byteplus') {
		request = {
			method: 'DELETE',
			url: providerUrl(access.endpoint, `/api/v3/contents/generations/tasks/${task}`),
			headers: { ...headers, Accept: 'application/json' },
			maximumResponseBytes: MAX_JSON_RESPONSE_BYTES,
			timeoutMilliseconds: REMOTE_CANCEL_TIMEOUT_MS
		};
	} else if (provider === 'alibaba-cloud') {
		request = {
			method: 'POST',
			url: providerUrl(access.endpoint, `/api/v1/tasks/${task}/cancel`),
			headers: { ...headers, Accept: 'application/json' },
			body: Buffer.alloc(0),
			maximumResponseBytes: MAX_JSON_RESPONSE_BYTES,
			timeoutMilliseconds: REMOTE_CANCEL_TIMEOUT_MS
		};
	}
	if (!request) {
		return;
	}
	try {
		await httpClient(request, NEVER_CANCELLED);
	} catch {
		// Provider cancellation is best-effort. The local Attempt still fails
		// closed and never accepts a late or partial artifact.
	}
}

function parseSubmissionId(provider: string, value: unknown): string {
	const body = record(value, `${provider} submission`);
	if (provider === 'byteplus') {
		return boundedIdentifier(body.id, 'BytePlus task id');
	}
	if (provider === 'minimax') {
		return boundedIdentifier(body.task_id, 'MiniMax task id');
	}
	if (provider === 'alibaba-cloud') {
		return boundedIdentifier(record(body.output, 'Wan submission output').task_id, 'Wan task id');
	}
	throw new VideoProviderProtocolError(`No submission protocol exists for provider '${provider}'.`);
}

function parseBytePlusPoll(value: unknown): ProviderPollResult {
	const body = record(value, 'BytePlus task');
	const status = requiredText(body.status, 'BytePlus task status').toLowerCase();
	if (status === 'queued' || status === 'running') {
		return { kind: 'pending', message: status === 'queued' ? 'Video generation queued' : 'Generating video' };
	}
	if (status === 'succeeded') {
		const content = record(body.content, 'BytePlus task content');
		return {
			kind: 'succeeded',
			message: 'Video generation completed',
			videoUrl: requiredText(content.video_url, 'BytePlus output URL'),
			usage: bytePlusUsage(body.usage)
		};
	}
	if (status === 'failed' || status === 'expired') {
		return { kind: 'failed', message: providerFailureMessage('BytePlus video generation failed', body) };
	}
	if (status === 'cancelled' || status === 'canceled') {
		return { kind: 'cancelled', message: 'BytePlus video generation was cancelled.' };
	}
	throw new VideoProviderProtocolError(`BytePlus returned unknown task status '${status}'.`);
}

function parseMiniMaxPoll(value: unknown): ProviderPollResult {
	const body = record(value, 'MiniMax task');
	const status = requiredText(body.status, 'MiniMax task status');
	if (status === 'Preparing' || status === 'Queueing' || status === 'Processing') {
		return { kind: 'pending', message: status === 'Processing' ? 'Generating video' : 'Video generation queued' };
	}
	if (status === 'Success') {
		return {
			kind: 'succeeded',
			message: 'Video generation completed',
			fileId: boundedIdentifier(body.file_id, 'MiniMax file id')
		};
	}
	if (status === 'Fail') {
		return { kind: 'failed', message: providerFailureMessage('MiniMax video generation failed', body) };
	}
	throw new VideoProviderProtocolError(`MiniMax returned unknown task status '${status}'.`);
}

function parseWanPoll(value: unknown): ProviderPollResult {
	const body = record(value, 'Wan task');
	const output = record(body.output, 'Wan task output');
	const status = requiredText(output.task_status, 'Wan task status').toUpperCase();
	if (status === 'PENDING' || status === 'RUNNING') {
		return { kind: 'pending', message: status === 'PENDING' ? 'Video generation queued' : 'Generating video' };
	}
	if (status === 'SUCCEEDED') {
		return {
			kind: 'succeeded',
			message: 'Video generation completed',
			videoUrl: requiredText(output.video_url, 'Wan output URL'),
			usage: wanUsage(body.usage)
		};
	}
	if (status === 'FAILED' || status === 'UNKNOWN') {
		return { kind: 'failed', message: providerFailureMessage('Wan video generation failed', output) };
	}
	if (status === 'CANCELED' || status === 'CANCELLED') {
		return { kind: 'cancelled', message: 'Wan video generation was cancelled.' };
	}
	throw new VideoProviderProtocolError(`Wan returned unknown task status '${status}'.`);
}

function bytePlusUsage(value: unknown): ExecutedVideoProviderRequest['usage'] | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const outputTokens = optionalNonNegativeInteger(value.completion_tokens);
	return outputTokens === undefined ? undefined : Object.freeze({ outputTokens });
}

function wanUsage(value: unknown): ExecutedVideoProviderRequest['usage'] | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const videoSeconds = optionalNonNegativeNumber(value.output_video_duration ?? value.video_duration);
	return videoSeconds === undefined ? undefined : Object.freeze({ videoSeconds });
}

async function requestJsonWithSafeRetries(
	httpClient: VideoHttpClient,
	request: VideoHttpRequest,
	cancellation: VideoExecutionCancellation,
	wait: (milliseconds: number, cancellation: VideoExecutionCancellation) => Promise<void>
): Promise<unknown> {
	let lastError: unknown;
	for (let attempt = 0; attempt < MAX_SAFE_READ_RETRIES; attempt++) {
		throwIfCancelled(cancellation);
		try {
			return await requestJson(httpClient, request, cancellation);
		} catch (error) {
			if (error instanceof VideoProviderCancelledError) {
				throw error;
			}
			if (error instanceof VideoProviderHttpError && !isRetryableStatus(error.status)) {
				throw error;
			}
			lastError = error;
			if (attempt + 1 < MAX_SAFE_READ_RETRIES) {
				await wait(250 * (attempt + 1), cancellation);
			}
		}
	}
	throw lastError;
}

async function requestJson(
	httpClient: VideoHttpClient,
	request: VideoHttpRequest,
	cancellation: VideoExecutionCancellation
): Promise<unknown> {
	const response = await httpClient(request, cancellation);
	if (response.body.byteLength > request.maximumResponseBytes) {
		throw new VideoProviderProtocolError(`HTTP response exceeds the ${request.maximumResponseBytes}-byte limit.`);
	}
	if (response.status < 200 || response.status >= 300) {
		const message = httpFailureMessage(response);
		throw new VideoProviderHttpError(response.status, message);
	}
	try {
		return JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown;
	} catch {
		throw new VideoProviderProtocolError('The provider returned malformed JSON.');
	}
}

function assertSuccessfulHttp(response: VideoHttpResponse): void {
	if (response.status < 200 || response.status >= 300) {
		throw new VideoProviderHttpError(response.status, httpFailureMessage(response));
	}
}

function authorizationHeaders(access: VideoProviderExecutionAccess): Readonly<Record<string, string>> {
	// The host connection shape is provider-neutral, while every protocol
	// implemented by this official extension documents Bearer authentication.
	// Reject the generic alternatives before any provider request is sent.
	if (access.authorization !== 'bearer') {
		throw new VideoProviderProtocolError('Official video providers require a Bearer API key connection.');
	}
	const apiKey = requiredSecret(access.apiKey);
	return Object.freeze({ Authorization: `Bearer ${apiKey}` });
}

function requiredSecret(value: string | undefined): string {
	if (!value || value.length > 16_384 || /[\r\n]/.test(value)) {
		throw new VideoProviderProtocolError('The configured model credential is missing or invalid.');
	}
	return value;
}

function collectCredentialSecrets(access: VideoProviderExecutionAccess): readonly string[] {
	const values = new Set<string>();
	for (const value of Object.values(access.credentialValues ?? {})) {
		if (value) {
			values.add(value);
		}
	}
	if (access.apiKey) {
		values.add(access.apiKey);
	}
	// Replace longer credentials first in case one credential is a prefix of another.
	return Object.freeze([...values].sort((left, right) => right.length - left.length));
}

function redactCredentialSecrets(message: string, secrets: readonly string[]): string {
	let redacted = message;
	for (const secret of secrets) {
		redacted = redacted.split(secret).join('[REDACTED]');
	}
	return redacted;
}

function redactProviderExecutionError(error: unknown, secrets: readonly string[]): unknown {
	if (error instanceof VideoProviderCancelledError) {
		const message = redactCredentialSecrets(error.message, secrets);
		return message === error.message ? error : new VideoProviderCancelledError();
	}
	if (error instanceof VideoProviderHttpError) {
		const message = redactCredentialSecrets(error.message, secrets);
		return message === error.message ? error : new VideoProviderHttpError(error.status, message);
	}
	if (error instanceof VideoProviderProtocolError) {
		const message = redactCredentialSecrets(error.message, secrets);
		return message === error.message ? error : new VideoProviderProtocolError(message);
	}
	if (error instanceof Error) {
		const message = redactCredentialSecrets(error.message, secrets);
		if (message === error.message) {
			return error;
		}
		const redacted = new Error(message);
		redacted.name = error.name;
		return redacted;
	}
	if (typeof error === 'string') {
		return redactCredentialSecrets(error, secrets);
	}
	// Never forward an opaque provider/client rejection object: it may contain
	// credentials outside a conventional Error.message field.
	return new VideoProviderProtocolError('Video provider execution failed.');
}

function providerUrl(endpoint: string, path: string): string {
	const base = safeHttpsUrl(endpoint, 'model service endpoint');
	return safeHttpsUrl(new URL(path, `${base.origin}/`).toString(), 'provider API URL').toString();
}

function safeHttpsUrl(value: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new VideoProviderProtocolError(`The ${label} is invalid.`);
	}
	if (url.protocol !== 'https:' || url.username || url.password) {
		throw new VideoProviderProtocolError(`The ${label} must be an HTTPS URL without embedded credentials.`);
	}
	if (isPrivateLiteralHost(url.hostname)) {
		throw new VideoProviderProtocolError(`The ${label} cannot target a local or private-address host.`);
	}
	return url;
}

function isPrivateLiteralHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost' || host.endsWith('.localhost')) {
		return true;
	}
	const family = isIP(host);
	if (family === 4) {
		const octets = host.split('.').map(Number);
		return octets[0] === 0
			|| octets[0] === 10
			|| octets[0] === 127
			|| (octets[0] === 169 && octets[1] === 254)
			|| (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
			|| (octets[0] === 192 && octets[1] === 168)
			|| (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
			|| octets[0] >= 224;
	}
	if (family === 6) {
		return host === '::' || host === '::1'
			|| host.startsWith('::ffff:')
			|| host.startsWith('fc') || host.startsWith('fd')
			|| /^fe[89ab]/.test(host) || host.startsWith('ff');
	}
	return false;
}

function stripCredentialHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
	const stripped: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === 'accept') {
			stripped[name] = value;
		}
	}
	return Object.freeze(stripped);
}

function freezeHeaders(headers: IncomingHttpHeaders): Readonly<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value === 'string') {
			result[name.toLowerCase()] = value;
		} else if (Array.isArray(value)) {
			result[name.toLowerCase()] = value.join(', ');
		}
	}
	return Object.freeze(result);
}

function httpFailureMessage(response: VideoHttpResponse): string {
	let detail = '';
	try {
		const body = JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown;
		if (isRecord(body)) {
			detail = providerFailureDetail(body);
		}
	} catch {
		// Do not copy arbitrary HTML or proxy bodies into project-visible errors.
	}
	return `Provider request failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`;
}

function providerFailureMessage(fallback: string, body: Readonly<Record<string, unknown>>): string {
	const detail = providerFailureDetail(body);
	return `${fallback}${detail ? `: ${detail}` : '.'}`;
}

function providerFailureDetail(body: Readonly<Record<string, unknown>>): string {
	const error = isRecord(body.error) ? body.error : undefined;
	const baseResponse = isRecord(body.base_resp) ? body.base_resp : undefined;
	const candidate = error?.message ?? body.message ?? body.fail_reason ?? body.error_message ?? baseResponse?.status_msg;
	return typeof candidate === 'string' ? candidate.replace(/[\r\n]+/g, ' ').trim().slice(0, 500) : '';
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!isRecord(value)) {
		throw new VideoProviderProtocolError(`The provider response has no valid ${label}.`);
	}
	return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 4_096) {
		throw new VideoProviderProtocolError(`The provider response has no valid ${label}.`);
	}
	return value;
}

function boundedIdentifier(value: unknown, label: string): string {
	const identifier = requiredText(value, label);
	if (identifier.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/.test(identifier)) {
		throw new VideoProviderProtocolError(`The provider response has no valid ${label}.`);
	}
	return identifier;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new VideoProviderProtocolError(`The ${label} is outside its reviewed range.`);
	}
	return value;
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

function throwIfCancelled(cancellation: VideoExecutionCancellation): void {
	if (cancellation.isCancellationRequested) {
		throw new VideoProviderCancelledError();
	}
}

function waitForCancellation(milliseconds: number, cancellation: VideoExecutionCancellation): Promise<void> {
	throwIfCancelled(cancellation);
	if (milliseconds === 0) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const handle = setTimeout(() => {
			subscription.dispose();
			resolve();
		}, milliseconds);
		const subscription = cancellation.onCancellationRequested(() => {
			clearTimeout(handle);
			subscription.dispose();
			reject(new VideoProviderCancelledError());
		});
	});
}
