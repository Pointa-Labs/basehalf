/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * What the provider tests share: a local HTTP server that records what it
 * receives, a small provider module declared for the tests, and builders of
 * small media files. Nothing here talks to a real provider.
 */

import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import zlib from 'node:zlib';
import { ProviderFailure } from '../src/providers/failure.ts';
import type { ProviderModule } from '../src/providers/module.ts';
import type { CatalogProvider, ProviderResponse } from '../src/providers/types.ts';

export interface Received {
	readonly method: string;
	/** With its query. */
	readonly path: string;
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
}

export interface TestServer {
	/** `http://127.0.0.1:<port>` */
	readonly url: string;
	readonly received: Received[];
	close(): Promise<void>;
}

/** A server on 127.0.0.1 that hands every request, with its whole body, to `handler`. */
export async function startServer(handler: (request: Received, response: ServerResponse, socket: Socket) => void): Promise<TestServer> {
	const received: Received[] = [];
	const sockets = new Set<Socket>();
	const server = createServer((incoming: IncomingMessage, response) => {
		const chunks: Buffer[] = [];
		incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
		incoming.on('end', () => {
			const entry: Received = { method: incoming.method ?? '', path: incoming.url ?? '', headers: incoming.headers, body: Buffer.concat(chunks) };
			received.push(entry);
			handler(entry, response, incoming.socket);
		});
	});
	server.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}`,
		received,
		close: () => new Promise(resolve => {
			for (const socket of sockets) {
				socket.destroy();
			}
			server.close(() => resolve());
		})
	};
}

export function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
	const bytes = Buffer.from(JSON.stringify(body), 'utf8');
	response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength), ...headers });
	response.end(bytes);
}

export function value<T>(response: ProviderResponse<T>): T {
	assert.equal(response.ok, true, response.ok ? '' : JSON.stringify(response.error));
	return (response as { readonly value: T }).value;
}

export function error<T>(response: ProviderResponse<T>): { code: string; message: string; status?: number } {
	assert.equal(response.ok, false, `expected an error, got ${JSON.stringify(response)}`);
	return (response as { readonly error: { code: string; message: string; status?: number } }).error;
}

/** A sleep that waits for nothing and records what it was asked to wait. */
export function recordingSleep(): { readonly waits: number[]; sleep(ms: number): Promise<void> } {
	const waits: number[] = [];
	return { waits, sleep: async (ms: number) => { waits.push(ms); } };
}

// --- a provider for the tests -------------------------------------------------------------------

/** The catalog entry of the test provider: two regions, one key, two models. */
export function testProvider(): CatalogProvider {
	return {
		id: 'testprovider',
		label: 'Test Provider',
		regions: [
			{ id: 'home', label: 'Home', baseUrl: 'https://api.example.com/v1', currency: 'USD' },
			{ id: 'away', label: 'Away', baseUrl: 'https://api.example.cn/v1', currency: 'CNY' }
		],
		credentials: [{ id: 'apiKey', label: 'API Key' }],
		models: [
			{
				id: 'clip-1',
				label: 'Clip 1',
				providerModels: { home: 'clip-1-home', away: 'clip-1-away' },
				prompt: { required: 'withoutMedia', maxLength: 50 },
				modes: [
					{
						id: 'frames',
						label: 'Frames',
						inputs: { startFrame: 'optional', endFrame: 'optional', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' },
						limits: { imageMinSide: 300, imageMaxSide: 6000, imageAspect: [0.4, 2.5], imageMaxBytes: 1024 * 1024 }
					},
					{
						id: 'reference',
						label: 'References',
						inputs: { startFrame: 'none', endFrame: 'none', images: { min: 1, max: 3 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 2 }, source: 'none' },
						limits: { imageMinSide: 300, audioSeconds: [2, 15], audioTotalSeconds: 15, audioMaxBytes: 1024 * 1024 }
					}
				],
				parameters: [
					{ name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }], default: '720p' },
					{ name: 'duration', label: 'Duration', kind: 'integer', unit: 'seconds', min: 4, max: 12, step: 1, default: 5, auto: { value: -1, label: 'Auto' } },
					{ name: 'ratio', label: 'Ratio', kind: 'choice', display: 'ratio', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }], default: '16:9', modes: ['reference'] },
					{ name: 'seed', label: 'Seed', kind: 'integer', min: 0, max: 100, step: 1, optional: true, advanced: true }
				],
				estimate: true
			},
			{
				id: 'clip-away',
				label: 'Clip Away',
				providerModels: { away: 'clip-away' },
				prompt: { required: 'always', maxLength: 100 },
				modes: [{ id: 'frames', label: 'Frames', inputs: { startFrame: 'optional', endFrame: 'none', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: {} }],
				parameters: [],
				estimate: false
			}
		]
	};
}

/** A module of the test provider whose behavior each test replaces where it needs to. */
export function testModule(overrides: Partial<ProviderModule> = {}): ProviderModule {
	return {
		describe: testProvider,
		headers: credentials => ({ Authorization: `Bearer ${credentials.apiKey}` }),
		async check(request) {
			return {
				problems: request.params.duration === 12 && request.params.resolution === '720p' ? ['720p allows 10 seconds at most.'] : [],
				estimate: { currency: request.region === 'away' ? 'CNY' : 'USD', min: 1, max: 1, priceDate: '2026-10-18' }
			};
		},
		async submit(_request, http) {
			const answer = await http.create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: { ok: true } } });
			return String(answer.object().id);
		},
		async poll(ref, http) {
			const answer = (await http.request({ method: 'GET', path: `/tasks/${encodeURIComponent(ref.remoteId)}` })).object();
			return answer.status === 'done' ? { state: 'succeeded', videoUrl: String(answer.url) } : { state: 'running' };
		},
		async videoLocation(ref, http) {
			return { url: `${http.endpoint.href}/tasks/${encodeURIComponent(ref.remoteId)}/video` };
		},
		async cancel() {
			throw new ProviderFailure('rejected', 'not used');
		},
		...overrides
	};
}

// --- media --------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

/** A valid PNG of one gray color. */
export function png(width: number, height: number): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 0;
	const row = Buffer.alloc(1 + width, 0x80);
	row[0] = 0;
	const pixels = Buffer.concat(Array.from({ length: height }, () => row));
	return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** The header of a baseline JPEG with an APP0 and a large APP1 segment before its frame header. */
export function jpegHeader(width: number, height: number): Buffer {
	const segment = (marker: number, data: Buffer) => {
		const head = Buffer.alloc(4);
		head[0] = 0xff;
		head[1] = marker;
		head.writeUInt16BE(data.length + 2, 2);
		return Buffer.concat([head, data]);
	};
	const frame = Buffer.alloc(6);
	frame[0] = 8;
	frame.writeUInt16BE(height, 1);
	frame.writeUInt16BE(width, 3);
	frame[5] = 3;
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
		segment(0xe1, Buffer.alloc(40_000, 0x20)),
		Buffer.from([0xff]),
		segment(0xc0, Buffer.concat([frame, Buffer.alloc(9)])),
		segment(0xda, Buffer.alloc(10)),
		Buffer.from([0xff, 0xd9])
	]);
}

export function gifHeader(width: number, height: number): Buffer {
	const head = Buffer.alloc(13);
	head.write('GIF89a', 0, 'latin1');
	head.writeUInt16LE(width, 6);
	head.writeUInt16LE(height, 8);
	return head;
}

/** The first bytes of a WebP of each kind of first chunk. */
export function webpHeader(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Buffer {
	const head = Buffer.alloc(32);
	head.write('RIFF', 0, 'latin1');
	head.writeUInt32LE(24, 4);
	head.write('WEBP', 8, 'latin1');
	head.write(kind, 12, 'latin1');
	head.writeUInt32LE(10, 16);
	if (kind === 'VP8 ') {
		head[23] = 0x9d;
		head[24] = 0x01;
		head[25] = 0x2a;
		head.writeUInt16LE(width, 26);
		head.writeUInt16LE(height, 28);
	} else if (kind === 'VP8L') {
		head[20] = 0x2f;
		head.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
	} else {
		head.writeUIntLE(width - 1, 24, 3);
		head.writeUIntLE(height - 1, 27, 3);
	}
	return head;
}

function box(type: string, ...content: Buffer[]): Buffer {
	const data = Buffer.concat(content);
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length + 8, 0);
	head.write(type, 4, 'latin1');
	return Buffer.concat([head, data]);
}

/** An ISO media file whose movie header says `seconds`: ftyp, a media box first when asked, then moov with mvhd. */
export function isoMedia(seconds: number, options: { readonly brand?: string; readonly version?: 0 | 1; readonly mediaFirst?: boolean } = {}): Buffer {
	const timescale = 600;
	const duration = Math.round(seconds * timescale);
	let header: Buffer;
	if (options.version === 1) {
		header = Buffer.alloc(4 + 8 + 8 + 4 + 8 + 80);
		header[0] = 1;
		header.writeUInt32BE(timescale, 20);
		header.writeBigUInt64BE(BigInt(duration), 24);
	} else {
		header = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 80);
		header.writeUInt32BE(timescale, 12);
		header.writeUInt32BE(duration, 16);
	}
	const fileType = box('ftyp', Buffer.from(`${options.brand ?? 'isom'}\0\0\x02\0isomiso2mp41`, 'latin1'));
	const media = box('mdat', Buffer.alloc(5000, 0x11));
	const movie = box('moov', box('mvhd', header), box('trak', Buffer.alloc(32)));
	return Buffer.concat(options.mediaFirst ? [fileType, media, movie] : [fileType, movie, media]);
}

/** A PCM WAV of `seconds` at 8 kHz, 16-bit mono (16,000 bytes a second), with a LIST chunk before the data. */
export function wav(seconds: number): Buffer {
	const data = Buffer.alloc(Math.round(seconds * 16_000));
	const format = Buffer.alloc(16);
	format.writeUInt16LE(1, 0);
	format.writeUInt16LE(1, 2);
	format.writeUInt32LE(8000, 4);
	format.writeUInt32LE(16_000, 8);
	format.writeUInt16LE(2, 12);
	format.writeUInt16LE(16, 14);
	const chunk = (id: string, content: Buffer) => {
		const head = Buffer.alloc(8);
		head.write(id, 0, 'latin1');
		head.writeUInt32LE(content.length, 4);
		return Buffer.concat([head, content, content.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
	};
	const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), chunk('fmt ', format), chunk('LIST', Buffer.from('INFOISFT', 'latin1')), chunk('data', data)]);
	const head = Buffer.alloc(8);
	head.write('RIFF', 0, 'latin1');
	head.writeUInt32LE(body.length, 4);
	return Buffer.concat([head, body]);
}

/**
 * An MPEG-1 Layer III stream at 128 kbps and 44.1 kHz, joint stereo, of
 * `frames` frames of 1152 samples (417 or 418 bytes each), with an ID3v2 tag
 * first when asked and a Xing header in the first frame when asked.
 */
export function mp3(frames: number, options: { readonly id3?: boolean; readonly xingFrames?: number } = {}): Buffer {
	const parts: Buffer[] = [];
	if (options.id3) {
		const tag = Buffer.alloc(10 + 300);
		tag.write('ID3', 0, 'latin1');
		tag[3] = 4;
		// The size, syncsafe: 300 = 2 * 128 + 44.
		tag[8] = 2;
		tag[9] = 44;
		parts.push(tag);
	}
	for (let index = 0; index < frames; index++) {
		// Every third frame is padded, as an encoder does to keep 128 kbps at 44.1 kHz.
		const padding = index % 3 === 0 ? 1 : 0;
		const frame = Buffer.alloc(417 + padding);
		frame[0] = 0xff;
		frame[1] = 0xfb;
		frame[2] = 0x90 | (padding << 1);
		frame[3] = 0x44;
		if (index === 0 && options.xingFrames !== undefined) {
			frame.write('Xing', 4 + 32, 'latin1');
			frame.writeUInt32BE(1, 4 + 32 + 4);
			frame.writeUInt32BE(options.xingFrames, 4 + 32 + 8);
		}
		parts.push(frame);
	}
	return Buffer.concat(parts);
}
