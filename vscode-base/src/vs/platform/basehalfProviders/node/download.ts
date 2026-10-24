/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { open, unlink } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isAbsolute } from 'node:path';
import { ProviderFailure, rejected, unreadable } from './failure.ts';
import { isAllowedAddress, networkDetail, RETRYABLE_STATUSES, retryAfterMs, startRequest, USER_AGENT, type BoundHttp } from './http.ts';
import { IMAGE_SIGNATURE_BYTES, imageFormatOf } from './media.ts';
import type { InlineOutput, OutputAddress } from './module.ts';
import type { ModelKind, OutputFormat, ProviderErrorCode } from './types.ts';

/** The largest video kept (providers, "Requests"). */
export const MAX_VIDEO_DOWNLOAD_BYTES = 512 * 1024 * 1024;
/** The largest image kept (providers, "Requests"). */
export const MAX_IMAGE_DOWNLOAD_BYTES = 64 * 1024 * 1024;
/** The longest address of a file that the window can hand back to `download`. */
export const MAX_ADDRESS_LENGTH = 8192;
const MAX_REDIRECTS = 5;

export interface DownloadOptions {
	/** The largest file kept, instead of the limit of its kind. */
	readonly maxBytes?: number;
	/** Idle time allowed while connecting and between chunks. */
	readonly timeoutMs?: number;
}

/** A file kept: its size, and the format its bytes start like. */
export interface KeptFile {
	readonly size: number;
	readonly format: OutputFormat;
}

/** What a file of each kind must be to be kept, and how messages name it. */
interface FileRule {
	readonly noun: 'image' | 'video';
	/** The noun with its article, as a sentence uses it. */
	readonly aNoun: string;
	readonly maxBytes: number;
	/** How many bytes the format is told from. */
	readonly headBytes: number;
	readonly formatOf: (head: Buffer) => OutputFormat | undefined;
	readonly notThis: ProviderErrorCode;
	readonly unlike: string;
	readonly tooShort: string;
	readonly accept: string;
}

const RULES: Readonly<Record<ModelKind, FileRule>> = Object.freeze({
	video: {
		noun: 'video',
		aNoun: 'a video',
		maxBytes: MAX_VIDEO_DOWNLOAD_BYTES,
		headBytes: 8,
		formatOf: head => isMp4(head) ? 'mp4' : undefined,
		notThis: 'notVideo',
		unlike: 'The file does not start like an MP4 video.',
		tooShort: 'The file is too short to be an MP4 video.',
		accept: 'video/mp4,application/octet-stream;q=0.9,*/*;q=0.5'
	},
	image: {
		noun: 'image',
		aNoun: 'an image',
		maxBytes: MAX_IMAGE_DOWNLOAD_BYTES,
		headBytes: IMAGE_SIGNATURE_BYTES,
		formatOf: imageFormatOf,
		notThis: 'notImage',
		unlike: 'The file does not start like a PNG, JPEG, or WebP image.',
		tooShort: 'The file is too short to be a PNG, JPEG, or WebP image.',
		accept: 'image/png,image/jpeg,image/webp,application/octet-stream;q=0.9,*/*;q=0.5'
	}
});

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

/** The address of a file of `kind`, checked: complete, and `https://` or `http://` on this computer, without credentials. */
export function downloadAddress(value: string, kind: ModelKind): URL {
	const rule = RULES[kind];
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw unreadable(`The provider gave ${rule.aNoun} address that is not complete.`);
	}
	if (!isAllowedAddress(url)) {
		throw unreadable(`The provider gave ${rule.aNoun} address that does not start with https://.`);
	}
	return url;
}

function isMp4(head: Buffer): boolean {
	return head.byteLength >= 8 && head.toString('latin1', 4, 8) === 'ftyp';
}

/**
 * Downloads a file of `kind` to `targetFsPath`, a new file whose name ends in
 * `.part`: at most five redirects, the credentials only to the endpoint's own
 * origin (never to a CDN), and only a file of the kind: a video that starts
 * like an MP4 (`notVideo`) of at most 512 MiB, or an image that starts like a
 * PNG, JPEG, or WebP (`notImage`) of at most 64 MiB (`tooLarge`). A network
 * error, or HTTP 408, 429, 500, 502, 503, or 504, starts it again, as
 * `ProviderHttp.request` does. A download that fails leaves no file. A file
 * the provider answered inline is written under the same checks. Answers the
 * size and the format the bytes start like.
 */
export async function downloadFile(http: BoundHttp, location: OutputAddress | InlineOutput, targetFsPath: string, kind: ModelKind, options: DownloadOptions = {}): Promise<KeptFile> {
	const rule = RULES[kind];
	if (!isAbsolute(targetFsPath) || !targetFsPath.endsWith('.part')) {
		throw rejected('AI Video writes a download only to a new .part file.');
	}
	const maxBytes = options.maxBytes ?? rule.maxBytes;
	if (isInline(location)) {
		return writeInline(Buffer.from(location.bytes.buffer, location.bytes.byteOffset, location.bytes.byteLength), targetFsPath, rule, maxBytes);
	}
	const timeoutMs = options.timeoutMs ?? http.options.requestTimeoutMs;
	for (const value of Object.values(location.headers ?? {})) {
		http.secretValues.add(value);
	}
	const delays = http.options.retryDelaysMs;
	for (let attempt = 0; ; attempt++) {
		try {
			return await downloadOnce(http, location, targetFsPath, rule, kind, maxBytes, timeoutMs);
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

function isInline(location: OutputAddress | InlineOutput): location is InlineOutput {
	return (location as { readonly bytes?: unknown }).bytes instanceof Uint8Array;
}

/** Writes a file the provider answered inline: at most `limit` bytes, of the rule's kind, and no file left when it fails. */
async function writeInline(bytes: Buffer, targetFsPath: string, rule: FileRule, limit: number): Promise<KeptFile> {
	if (bytes.byteLength > limit) {
		throw new ProviderFailure('tooLarge', `The ${rule.noun} is ${bytes.byteLength} bytes, more than the ${limit} bytes BaseHalf downloads.`);
	}
	const format = bytes.byteLength >= rule.headBytes ? rule.formatOf(bytes) : undefined;
	if (!format) {
		throw new ProviderFailure(rule.notThis, bytes.byteLength < rule.headBytes ? rule.tooShort : rule.unlike);
	}
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(targetFsPath, 'wx');
	} catch (error) {
		throw rejected(`AI Video could not create the download file: ${networkDetail(error)}`);
	}
	try {
		await handle.writeFile(bytes);
		await handle.close();
		return { size: bytes.byteLength, format };
	} catch (error) {
		await handle.close().catch(() => undefined);
		await unlink(targetFsPath).catch(() => undefined);
		throw rejected(`AI Video could not write the ${rule.noun}: ${networkDetail(error)}`);
	}
}

async function downloadOnce(http: BoundHttp, location: OutputAddress, targetFsPath: string, rule: FileRule, kind: ModelKind, maxBytes: number, timeoutMs: number): Promise<KeptFile> {
	let url = downloadAddress(location.url, kind);
	for (let redirects = 0; ; redirects++) {
		const ownOrigin = url.origin === http.endpoint.origin;
		const headers: Record<string, string> = {
			Accept: rule.accept,
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
				throw unreadable(`The ${rule.noun} address redirected more than five times.`);
			}
			url = downloadAddress(new URL(response.headers.location, url).href, kind);
			continue;
		}
		if (status < 200 || status >= 300) {
			response.resume();
			request.destroy();
			if (RETRYABLE_STATUSES.has(status)) {
				throw new RetryableDownload(new ProviderFailure(status === 429 ? 'rateLimited' : 'network', `The ${rule.noun} download answered with HTTP ${status}.`, status), retryAfterMs(response.headers['retry-after']));
			}
			if (ownOrigin && (status === 401 || status === 403)) {
				throw new ProviderFailure('auth', `The provider refused the ${rule.noun} download (HTTP ${status}). Check the credentials in Providers.`, status);
			}
			if (status === 401 || status === 403 || status === 404 || status === 410) {
				throw new ProviderFailure('notFound', `The ${rule.noun} is no longer at the address the provider gave (HTTP ${status}); the address may have expired.`, status);
			}
			throw new ProviderFailure('network', `The ${rule.noun} download answered with HTTP ${status}.`, status);
		}
		return write(request, response, targetFsPath, rule, maxBytes);
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

async function write(request: ClientRequest, response: IncomingMessage, targetFsPath: string, rule: FileRule, limit: number): Promise<KeptFile> {
	const declared = Number(response.headers['content-length']);
	if (Number.isFinite(declared) && declared > limit) {
		response.resume();
		request.destroy();
		throw new ProviderFailure('tooLarge', `The ${rule.noun} is ${declared} bytes, more than the ${limit} bytes BaseHalf downloads.`);
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
	let format: OutputFormat | undefined;
	try {
		for await (const chunk of response as AsyncIterable<Buffer>) {
			size += chunk.byteLength;
			if (size > limit) {
				throw new ProviderFailure('tooLarge', `The ${rule.noun} is larger than the ${limit} bytes BaseHalf downloads.`);
			}
			if (!format) {
				head = Buffer.concat([head, chunk]);
				if (head.byteLength >= rule.headBytes) {
					format = rule.formatOf(head);
					if (!format) {
						throw new ProviderFailure(rule.notThis, rule.unlike);
					}
				}
			}
			await handle.write(chunk);
		}
		if (!response.complete) {
			throw new RetryableDownload(new ProviderFailure('network', `The ${rule.noun} download was cut off.`));
		}
		if (!format) {
			throw new ProviderFailure(rule.notThis, rule.tooShort);
		}
		await handle.close();
		return { size, format };
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
