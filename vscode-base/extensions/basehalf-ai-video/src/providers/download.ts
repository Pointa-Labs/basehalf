/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { open, unlink } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isAbsolute } from 'node:path';
import { ProviderFailure, rejected, unreadable } from './failure.ts';
import { isAllowedAddress, networkDetail, RETRYABLE_STATUSES, retryAfterMs, startRequest, USER_AGENT, type BoundHttp } from './http.ts';
import type { VideoLocation } from './module.ts';

/** The largest video downloaded (video node, "Starting"). */
export const MAX_VIDEO_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface DownloadOptions {
	readonly maxBytes?: number;
	/** Idle time allowed while connecting and between chunks. */
	readonly timeoutMs?: number;
}

/** A failure after which the whole download starts again, with the wait the provider asked for. */
class RetryableDownload extends Error {
	readonly failure: ProviderFailure;
	readonly waitMs: number | undefined;

	constructor(failure: ProviderFailure, waitMs?: number) {
		super(failure.message);
		this.failure = failure;
		this.waitMs = waitMs;
	}
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

function isMp4(head: Buffer): boolean {
	return head.byteLength >= 8 && head.toString('latin1', 4, 8) === 'ftyp';
}

/**
 * Downloads a video to `targetFsPath`, a new file whose name ends in `.part`:
 * at most five redirects, the credentials only to the endpoint's own origin
 * (never to a CDN), at most 512 MiB (`tooLarge`), and an MP4 `ftyp` box first
 * (`notVideo`). A network error, or HTTP 408, 429, 500, 502, 503, or 504,
 * starts it again, as `ProviderHttp.request` does. A download that fails
 * leaves no file.
 */
export async function downloadVideo(http: BoundHttp, location: VideoLocation, targetFsPath: string, options: DownloadOptions = {}): Promise<number> {
	if (!isAbsolute(targetFsPath) || !targetFsPath.endsWith('.part')) {
		throw rejected('AI Video writes a download only to a new .part file.');
	}
	const maxBytes = options.maxBytes ?? MAX_VIDEO_DOWNLOAD_BYTES;
	const timeoutMs = options.timeoutMs ?? http.options.requestTimeoutMs;
	for (const value of Object.values(location.headers ?? {})) {
		http.secretValues.add(value);
	}
	const delays = http.options.retryDelaysMs;
	for (let attempt = 0; ; attempt++) {
		try {
			return await downloadOnce(http, location, targetFsPath, maxBytes, timeoutMs);
		} catch (error) {
			if (!(error instanceof RetryableDownload)) {
				throw error;
			}
			const wait = error.waitMs ?? delays[attempt];
			if (attempt >= delays.length || wait > http.options.maxRetryAfterMs) {
				throw error.failure;
			}
			await http.options.sleep(wait);
		}
	}
}

async function downloadOnce(http: BoundHttp, location: VideoLocation, targetFsPath: string, maxBytes: number, timeoutMs: number): Promise<number> {
	let url = videoUrl(location.url);
	for (let redirects = 0; ; redirects++) {
		const ownOrigin = url.origin === http.endpoint.origin;
		const headers: Record<string, string> = {
			Accept: 'video/mp4,application/octet-stream;q=0.9,*/*;q=0.5',
			'User-Agent': USER_AGENT,
			...(ownOrigin ? (location.headers ?? http.credentialHeadersFor(url)) : {})
		};
		const startedAt = Date.now();
		const { request, response } = await openGet(url, headers, timeoutMs, () => http.log('GET', url, 'failed', startedAt));
		const status = response.statusCode ?? 0;
		http.log('GET', url, status, startedAt);
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
			if (RETRYABLE_STATUSES.has(status)) {
				throw new RetryableDownload(new ProviderFailure(status === 429 ? 'rateLimited' : 'network', `The video download answered with HTTP ${status}.`, status), retryAfterMs(response.headers['retry-after']));
			}
			if (ownOrigin && (status === 401 || status === 403)) {
				throw new ProviderFailure('auth', `The provider refused the video download (HTTP ${status}). Check the credentials in Video Providers.`, status);
			}
			if (status === 401 || status === 403 || status === 404 || status === 410) {
				throw new ProviderFailure('notFound', `The video is no longer at the address the provider gave (HTTP ${status}); the address may have expired.`, status);
			}
			throw new ProviderFailure('network', `The video download answered with HTTP ${status}.`, status);
		}
		return write(request, response, targetFsPath, maxBytes);
	}
}

function openGet(url: URL, headers: Record<string, string>, timeoutMs: number, onFailure: () => void): Promise<{ request: ClientRequest; response: IncomingMessage }> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let request: ClientRequest;
		try {
			request = startRequest(url, { method: 'GET', headers }, response => {
				settled = true;
				resolve({ request, response });
			});
		} catch (error) {
			reject(rejected(`AI Video could not start the download: ${networkDetail(error)}`));
			return;
		}
		request.on('error', error => {
			if (!settled) {
				settled = true;
				onFailure();
				reject(new RetryableDownload(new ProviderFailure('network', networkDetail(error))));
			}
		});
		request.setTimeout(timeoutMs, () => request.destroy(new Error('No data came in time.')));
		request.end();
	});
}

async function write(request: ClientRequest, response: IncomingMessage, targetFsPath: string, limit: number): Promise<number> {
	const declared = Number(response.headers['content-length']);
	if (Number.isFinite(declared) && declared > limit) {
		response.resume();
		request.destroy();
		throw new ProviderFailure('tooLarge', `The video is ${declared} bytes, more than the ${limit} bytes BaseHalf downloads.`);
	}
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(targetFsPath, 'wx');
	} catch (error) {
		response.resume();
		request.destroy();
		throw rejected(`AI Video could not create the download file: ${networkDetail(error)}`);
	}
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
		if (!response.complete) {
			throw new RetryableDownload(new ProviderFailure('network', 'The video download was cut off.'));
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
		if (error instanceof ProviderFailure || error instanceof RetryableDownload) {
			throw error;
		}
		throw new RetryableDownload(new ProviderFailure('network', networkDetail(error)));
	}
}
