/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { open, stat, unlink } from 'fs/promises';
import { isAbsolute } from '../../../base/common/path.js';
import { ProviderFailure, rejected, unreadable } from './failure.js';
import { isAllowedAddress, networkDetail, RETRYABLE_STATUSES, retryAfterMs, USER_AGENT, type BoundHttp, type ProviderTransport, type TransportRequest, type TransportResponse } from './http.js';
import { AUDIO_SIGNATURE_BYTES, audioFormatOf, IMAGE_SIGNATURE_BYTES, imageFormatOf } from './media.js';
import type { InlineOutput, OutputAddress } from './module.js';
import type { AudioOutputFormat, ModelKind, OutputFormat, ProviderErrorCode } from '../common/basehalfProviderTypes.js';

/** The largest video kept (providers, "Requests"). */
export const MAX_VIDEO_DOWNLOAD_BYTES = 512 * 1024 * 1024;
/** The largest image kept (providers, "Requests"). */
export const MAX_IMAGE_DOWNLOAD_BYTES = 64 * 1024 * 1024;
/** The largest sound kept (providers, "Requests"). */
export const MAX_AUDIO_DOWNLOAD_BYTES = 256 * 1024 * 1024;
/** The largest sample of a voice that `voicePreview` fetches for the window to play (providers, "Requests"). */
export const MAX_VOICE_SAMPLE_BYTES = 5 * 1024 * 1024;
/** The longest address of a file that the window can hand back to `download` or `voicePreview`. */
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

/** A voice's sample, fetched into memory: its bytes, and the format they start like. */
export interface FetchedSample {
	readonly bytes: Buffer;
	readonly format: AudioOutputFormat;
}

/** What a file of each kind must be to be kept, and how messages name it. */
interface FileRule {
	readonly noun: 'image' | 'video' | 'sound' | 'sample';
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

/** What a sound must be, whether a generation made it or it is a voice's sample (D78). */
const SOUND = Object.freeze({
	headBytes: AUDIO_SIGNATURE_BYTES,
	formatOf: audioFormatOf,
	notThis: 'notAudio',
	unlike: 'The file does not start like an MP3, WAV, FLAC, Ogg, or M4A sound.',
	tooShort: 'The file is too short to be an MP3, WAV, FLAC, Ogg, or M4A sound.',
	accept: 'audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/mp4,application/octet-stream;q=0.9,*/*;q=0.5'
} as const);

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
	},
	audio: { noun: 'sound', aNoun: 'a sound', maxBytes: MAX_AUDIO_DOWNLOAD_BYTES, ...SOUND }
});

/** What a voice's sample must be to reach the window: a sound of at most 5 MiB. */
const SAMPLE_RULE: FileRule = Object.freeze({ noun: 'sample', aNoun: 'a sample', maxBytes: MAX_VOICE_SAMPLE_BYTES, ...SOUND });

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
	return addressOf(value, RULES[kind]);
}

function addressOf(value: string, rule: FileRule): URL {
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
 * like an MP4 (`notVideo`) of at most 512 MiB, an image that starts like a
 * PNG, JPEG, or WebP (`notImage`) of at most 64 MiB, or a sound that starts
 * like an MP3, WAV, FLAC, Ogg, or M4A (`notAudio`, `audioFormatOf`) of at most
 * 256 MiB (`tooLarge`). A network error, or HTTP 408, 429, 500, 502, 503, or
 * 504, starts it again, as `ProviderHttp.request` does. A download that fails
 * leaves no file. A file the provider answered inline is written under the
 * same checks. Answers the size and the format the bytes start like.
 */
export async function downloadFile(http: BoundHttp, location: OutputAddress | InlineOutput, targetFsPath: string, kind: ModelKind, options: DownloadOptions = {}): Promise<KeptFile> {
	const rule = RULES[kind];
	if (!isAbsolute(targetFsPath) || !targetFsPath.endsWith('.part')) {
		throw rejected('BaseHalf writes a download only to a new .part file.');
	}
	const maxBytes = options.maxBytes ?? rule.maxBytes;
	if (isInline(location)) {
		return writeInline(Buffer.from(location.bytes.buffer, location.bytes.byteOffset, location.bytes.byteLength), targetFsPath, rule, maxBytes);
	}
	const timeoutMs = options.timeoutMs ?? http.options.requestTimeoutMs;
	for (const value of Object.values(location.headers ?? {})) {
		http.secretValues.add(value);
	}
	return retried(http, () => downloadOnce(http, location, rule, maxBytes, timeoutMs, fileSink(targetFsPath, rule)));
}

/**
 * Fetches the sample of a voice into memory, for the window to play (D78;
 * providers, "Requests"): under the rules of a download (at most five
 * redirects, the credentials only to the endpoint's own origin, the same
 * retries), and only bytes that start like a sound (`notAudio`), at most
 * 5 MiB (`tooLarge`). Answers the bytes and the format they start like.
 */
export async function fetchSample(http: BoundHttp, address: string, options: DownloadOptions = {}): Promise<FetchedSample> {
	const maxBytes = options.maxBytes ?? SAMPLE_RULE.maxBytes;
	const timeoutMs = options.timeoutMs ?? http.options.requestTimeoutMs;
	const bytes = await retried(http, () => downloadOnce(http, { url: address }, SAMPLE_RULE, maxBytes, timeoutMs, memorySink()));
	// The bytes were taken for starting like a sound; this names the format they start like.
	const format = audioFormatOf(bytes);
	if (!format) {
		throw new ProviderFailure('notAudio', SAMPLE_RULE.unlike);
	}
	return { bytes, format };
}

function isInline(location: OutputAddress | InlineOutput): location is InlineOutput {
	return (location as { readonly bytes?: unknown }).bytes instanceof Uint8Array;
}

/** Runs a download again after a failure that starts it again: as many times, and after the same waits, as `ProviderHttp.request`. */
async function retried<T>(http: BoundHttp, run: () => Promise<T>): Promise<T> {
	const delays = http.options.retryDelaysMs;
	for (let attempt = 0; ; attempt++) {
		try {
			return await run();
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
		throw rejected(`BaseHalf could not create the download file: ${networkDetail(error)}`);
	}
	try {
		await handle.writeFile(bytes);
		await handle.close();
		return { size: bytes.byteLength, format };
	} catch (error) {
		await removeOwnFile(handle, targetFsPath);
		throw rejected(`BaseHalf could not write the ${rule.noun}: ${networkDetail(error)}`);
	}
}

/**
 * Closes a download's file and removes it, only while the name is still that
 * file's: the window that goes on with a generation downloads under the same
 * name, after a window that closed left its download (providers, "Requests").
 */
async function removeOwnFile(handle: Awaited<ReturnType<typeof open>>, targetFsPath: string): Promise<void> {
	const own = await handle.stat().catch(() => undefined);
	await handle.close().catch(() => undefined);
	const named = await stat(targetFsPath).catch(() => undefined);
	if (own && named && own.ino === named.ino && own.dev === named.dev) {
		await unlink(targetFsPath).catch(() => undefined);
	}
}

/** Where the bytes of one try of a download go, and what it answers once they all came and are of the rule's kind. */
interface DownloadSink<T> {
	/** Before the first byte. Throws when it cannot take them, such as a file that cannot be created. */
	open(): Promise<void>;
	write(chunk: Buffer): Promise<void>;
	finish(size: number, format: OutputFormat): Promise<T>;
	/** The try failed: nothing of it is left. */
	discard(): Promise<void>;
}

/** A new file whose name ends in `.part`, created with the first byte and removed when the try fails, while it is still its own. */
function fileSink(targetFsPath: string, rule: FileRule): DownloadSink<KeptFile> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	return {
		async open() {
			try {
				handle = await open(targetFsPath, 'wx');
			} catch (error) {
				throw rejected(`BaseHalf could not create the download file: ${networkDetail(error)}`);
			}
		},
		async write(chunk) {
			if (!handle) {
				throw new Error(`The ${rule.noun} file is not open.`);
			}
			await handle.write(chunk);
		},
		async finish(size, format) {
			await handle?.close();
			return { size, format };
		},
		async discard() {
			if (handle) {
				await removeOwnFile(handle, targetFsPath);
			}
		}
	};
}

/** The bytes in memory, for a sample that the window plays and that is never written. */
function memorySink(): DownloadSink<Buffer> {
	const chunks: Buffer[] = [];
	return {
		open: async () => undefined,
		write: async chunk => {
			chunks.push(chunk);
		},
		finish: async () => Buffer.concat(chunks),
		discard: async () => {
			chunks.length = 0;
		}
	};
}

async function downloadOnce<T>(http: BoundHttp, location: OutputAddress, rule: FileRule, maxBytes: number, timeoutMs: number, sink: DownloadSink<T>): Promise<T> {
	let url = addressOf(location.url, rule);
	for (let redirects = 0; ; redirects++) {
		const ownOrigin = url.origin === http.endpoint.origin;
		const headers: Record<string, string> = {
			Accept: rule.accept,
			'User-Agent': USER_AGENT,
			...(ownOrigin ? (location.headers ?? http.credentialHeadersFor(url)) : {})
		};
		const startedAt = Date.now();
		const { request, response } = await openGet(http.options.transport, url, headers, timeoutMs, () => http.log('GET', url, 'failed', startedAt));
		const status = response.statusCode ?? 0;
		http.log('GET', url, status, startedAt);
		if (status >= 300 && status < 400 && response.headers.location) {
			response.resume();
			request.destroy();
			if (redirects >= MAX_REDIRECTS) {
				throw unreadable(`The ${rule.noun} address redirected more than five times.`);
			}
			url = addressOf(new URL(response.headers.location, url).href, rule);
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
		return receive(request, response, rule, maxBytes, sink);
	}
}

function openGet(transport: ProviderTransport, url: URL, headers: Record<string, string>, timeoutMs: number, onFailure: () => void): Promise<{ request: TransportRequest; response: TransportResponse }> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let request: TransportRequest;
		try {
			request = transport(url, { method: 'GET', headers }, response => {
				settled = true;
				resolve({ request, response });
			});
		} catch (error) {
			reject(rejected(`BaseHalf could not start the download: ${networkDetail(error)}`));
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

/** Reads the body of an answer into the sink: at most `limit` bytes, of the rule's kind, and nothing left when it fails. */
async function receive<T>(request: TransportRequest, response: TransportResponse, rule: FileRule, limit: number, sink: DownloadSink<T>): Promise<T> {
	const declared = Number(response.headers['content-length']);
	if (Number.isFinite(declared) && declared > limit) {
		response.resume();
		request.destroy();
		throw new ProviderFailure('tooLarge', `The ${rule.noun} is ${declared} bytes, more than the ${limit} bytes BaseHalf downloads.`);
	}
	try {
		await sink.open();
	} catch (error) {
		response.resume();
		request.destroy();
		throw error;
	}
	let size = 0;
	let head = Buffer.alloc(0);
	let format: OutputFormat | undefined;
	try {
		for await (const chunk of response) {
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
			await sink.write(chunk);
		}
		if (!response.complete) {
			throw new RetryableDownload(new ProviderFailure('network', `The ${rule.noun} download was cut off.`));
		}
		if (!format) {
			throw new ProviderFailure(rule.notThis, rule.tooShort);
		}
		return await sink.finish(size, format);
	} catch (error) {
		request.destroy();
		await sink.discard();
		if (error instanceof ProviderFailure || error instanceof RetryableDownload) {
			throw error;
		}
		throw new RetryableDownload(new ProviderFailure('network', networkDetail(error)));
	}
}
