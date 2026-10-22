/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * What the smoke's generation card steps (D63, D64, generation cards,
 * "Verification") need beside the window: the local test provider of
 * `basehalf-video-mock-provider.mts`, which answers like ByteDance's ModelArk
 * API for videos and images, small PNG images, and a search of the workspace
 * for the test key. Nothing here talks to a real provider.
 */

import fs from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { MOCK_JPEG_FIXTURE_URL, MOCK_VIDEO_FIXTURE_URL, startMockVideoProvider, type MockVideoProvider, type MockVideoProviderRequest } from '../../../basehalf-video-mock-provider.mts';

export interface VideoSmokeProvider {
	/** The test provider; `requests` lists the create requests it received. */
	readonly mock: MockVideoProvider;
	/** The endpoint the smoke enters for its provider: the relay, at the path of the provider's own API. */
	readonly endpoint: string;
	readonly key: string;
	/** The fixture video, which the provider serves with a box of its own for each task. */
	readonly video: Buffer;
	/** Whether the bytes are a video the provider served: the fixture, and a box naming its task. */
	isVideo(bytes: Buffer): boolean;
	/** Whether the bytes are an image the provider served for a prompt with `[mock:jpeg]`: the fixture JPEG, with a comment naming it. */
	isJpeg(bytes: Buffer): boolean;
	/** The create requests received since `count` of them had arrived. */
	requestsSince(count: number): readonly MockVideoProviderRequest[];
	/** When the relay received each request that creates a task or images, in milliseconds since the epoch, oldest first. */
	readonly creates: readonly number[];
	close(): Promise<void>;
}

/**
 * Starts the test provider behind a relay on 127.0.0.1, answering files of
 * their own: the file of every task differs from the others, as a real
 * provider's do, so that BaseHalf can tell one moved file from another by its
 * content. The relay passes
 * every request on unchanged, and holds a request that creates a task, or
 * images answered at once, for `holdCreateMs` first: on this computer the
 * provider answers within a few milliseconds, and the hold leaves the card
 * `submitting` long enough to be read. A connection the provider drops
 * without an answer is dropped the same way, so an unknown outcome stays
 * unknown.
 */
export async function startVideoSmokeProvider(options: { readonly durationMs: number; readonly holdCreateMs: number }): Promise<VideoSmokeProvider> {
	const mock = await startMockVideoProvider({ durationMs: options.durationMs, uniqueFiles: true });
	const video = fs.readFileSync(MOCK_VIDEO_FIXTURE_URL);
	const jpeg = fs.readFileSync(MOCK_JPEG_FIXTURE_URL);
	const target = new URL(mock.url);
	const sockets = new Set<Socket>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const creates: number[] = [];
	const relay = createServer((request: IncomingMessage, response: ServerResponse) => {
		const receivedAt = Date.now();
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('error', () => response.destroy());
		request.on('end', () => {
			const body = Buffer.concat(chunks);
			const forward = () => {
				const upstream = httpRequest({
					host: target.hostname,
					port: target.port,
					path: request.url,
					method: request.method,
					headers: { ...request.headers, host: target.host }
				}, answer => {
					response.writeHead(answer.statusCode ?? 502, answer.headers);
					answer.pipe(response);
				});
				upstream.on('error', () => response.destroy());
				upstream.end(body);
			};
			const pathname = new URL(request.url ?? '/', mock.url).pathname;
			if (request.method === 'POST' && /\/contents\/generations\/tasks$|\/videos$|\/images\/generations$/.test(pathname)) {
				creates.push(receivedAt);
				const timer = setTimeout(() => {
					timers.delete(timer);
					forward();
				}, options.holdCreateMs);
				timers.add(timer);
			} else {
				forward();
			}
		});
	});
	relay.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});
	await new Promise<void>((resolve, reject) => {
		relay.once('error', reject);
		relay.listen(0, '127.0.0.1', () => resolve());
	});
	const { port } = relay.address() as AddressInfo;
	return {
		mock,
		endpoint: `http://127.0.0.1:${port}/api/v3`,
		key: mock.key,
		video,
		isVideo: bytes => bytes.byteLength > video.byteLength && bytes.subarray(0, video.byteLength).equals(video) && bytes.toString('latin1', video.byteLength + 4, video.byteLength + 8) === 'free',
		isJpeg: bytes => bytes.byteLength > jpeg.byteLength && bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(2) === 0xfffe && bytes.subarray(bytes.byteLength - jpeg.byteLength + 2).equals(jpeg.subarray(2)),
		requestsSince: count => mock.requests.slice(count),
		creates,
		async close() {
			for (const timer of timers) {
				clearTimeout(timer);
			}
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>(resolve => relay.close(() => resolve()));
			await mock.close();
		}
	};
}

/** A PNG of one color, `width` by `height`, 8-bit RGB. */
export function solidPng(width: number, height: number, color: readonly [number, number, number]): Buffer {
	const row = Buffer.alloc(1 + width * 3);
	for (let x = 0; x < width; x++) {
		row.set(color, 1 + x * 3);
	}
	const pixels = Buffer.concat(Array.from({ length: height }, () => row));
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk('IHDR', header),
		pngChunk('IDAT', zlib.deflateSync(pixels)),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

/** The size a PNG file says it has, or `undefined` when the bytes are not a PNG. */
export function pngSize(bytes: Buffer): { readonly width: number; readonly height: number } | undefined {
	if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
		return undefined;
	}
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

/** The files under `root`, relative to it, whose bytes contain `needle`. Git's own folder is left out: its objects are compressed. */
export function filesContaining(root: string, needle: string): string[] {
	const found: string[] = [];
	const bytes = Buffer.from(needle, 'utf8');
	const visit = (folder: string) => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const full = path.join(folder, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== '.git') {
					visit(full);
				}
			} else if (entry.isFile() && fs.readFileSync(full).includes(bytes)) {
				found.push(path.relative(root, full));
			}
		}
	};
	visit(root);
	return found;
}
