/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadFile, MAX_IMAGE_DOWNLOAD_BYTES } from '../src/providers/download.ts';
import { ProviderFailure } from '../src/providers/failure.ts';
import { BoundHttp, parseEndpoint, resolveHttpOptions } from '../src/providers/http.ts';
import { gifHeader, isoMedia, recordingSleep, routed, sendJson, serveFiles, startServer, tinyJpeg, tinyPng, webpHeader } from './providerTestKit.ts';

const VIDEO = isoMedia(2);
const folder = mkdtempSync(join(tmpdir(), 'basehalf-provider-download-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

let parts = 0;
function partPath(): string {
	return join(folder, `video-${parts++}.mp4.part`);
}

function bound(endpoint: string, sleep = recordingSleep().sleep): BoundHttp {
	return new BoundHttp(parseEndpoint(endpoint), () => ({ Authorization: 'Bearer sk-download-secret' }), undefined, resolveHttpOptions({ sleep }));
}

async function failure(promise: Promise<unknown>): Promise<ProviderFailure> {
	try {
		await promise;
	} catch (caught) {
		assert.ok(caught instanceof ProviderFailure, `expected a ProviderFailure, got ${String(caught)}`);
		return caught;
	}
	assert.fail('expected a failure');
}

test('a download follows at most five redirects and never carries the credentials to another origin', async () => {
	const cdn = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4' });
		response.end(VIDEO);
	});
	const api = await startServer((request, response) => {
		const hops = Number(/hops=(?<hops>\d+)/.exec(request.path)?.groups?.hops ?? '0');
		response.writeHead(302, { Location: hops > 0 ? `/api/redirect?hops=${hops - 1}` : `${cdn.url}/signed/video.mp4?sig=1` });
		response.end();
	});
	try {
		const target = partPath();
		const { size } = await downloadFile(bound(`${api.url}/api`), { url: `${api.url}/api/redirect?hops=3` }, target, 'video');
		const tooMany = await failure(downloadFile(bound(`${api.url}/api`), { url: `${api.url}/api/redirect?hops=5` }, partPath(), 'video'));
		assert.deepEqual({
			size,
			same: readFileSync(target).equals(VIDEO),
			keyToApi: api.received.slice(0, 4).every(entry => entry.headers.authorization === 'Bearer sk-download-secret'),
			keyToCdn: cdn.received.map(entry => entry.headers.authorization ?? null),
			tooMany: [tooMany.code, tooMany.message]
		}, {
			size: VIDEO.byteLength,
			same: true,
			keyToApi: true,
			keyToCdn: [null],
			tooMany: ['invalidResponse', 'The video address redirected more than five times.']
		});
	} finally {
		await api.close();
		await cdn.close();
	}
});

test('a module\'s own download headers replace the credential headers on the endpoint\'s origin only', async () => {
	const api = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4' });
		response.end(VIDEO);
	});
	try {
		const http = bound(`${api.url}/api`);
		await downloadFile(http, { url: `${api.url}/files/v.mp4`, headers: { 'x-goog-api-key': 'key-for-files' } }, partPath(), 'video');
		assert.deepEqual({ headers: [api.received[0].headers['x-goog-api-key'], api.received[0].headers.authorization ?? null], secret: http.secretValues.has('key-for-files') }, { headers: ['key-for-files', null], secret: true });
	} finally {
		await api.close();
	}
});

test('a download stops at its size limit, refuses what is not an MP4, writes only a new .part file, and leaves no file when it fails', async () => {
	const files = await startServer((request, response) => {
		if (request.path.endsWith('.html')) {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end('<html>expired</html>'.repeat(4));
			return;
		}
		if (request.path.endsWith('/chunked.mp4')) {
			// No length announced: the limit is found while reading.
			response.writeHead(200, { 'Content-Type': 'video/mp4' });
			response.write(VIDEO);
			response.end(VIDEO);
			return;
		}
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.byteLength) });
		response.end(VIDEO);
	});
	try {
		const http = bound('https://ark.cn-beijing.volces.com/api/v3');
		const declared = partPath();
		const tooLarge = await failure(downloadFile(http, { url: `${files.url}/video.mp4` }, declared, 'video', { maxBytes: 1000 }));
		const streamed = partPath();
		const tooLong = await failure(downloadFile(http, { url: `${files.url}/chunked.mp4` }, streamed, 'video', { maxBytes: VIDEO.byteLength + 10 }));
		const html = partPath();
		const notVideo = await failure(downloadFile(http, { url: `${files.url}/page.html` }, html, 'video'));
		const notPart = await failure(downloadFile(http, { url: `${files.url}/video.mp4` }, join(folder, 'video.mp4'), 'video'));
		const insecure = await failure(downloadFile(http, { url: 'http://cdn.example.com/video.mp4' }, partPath(), 'video'));
		assert.deepEqual({
			codes: [tooLarge.code, tooLong.code, notVideo.code, notPart.code, insecure.code],
			left: [existsSync(declared), existsSync(streamed), existsSync(html)],
			keySent: files.received.some(entry => entry.headers.authorization !== undefined)
		}, {
			codes: ['tooLarge', 'tooLarge', 'notVideo', 'rejected', 'invalidResponse'],
			left: [false, false, false],
			keySent: false
		});
	} finally {
		await files.close();
	}
});

test('a download is retried on 503 and on a cut-off answer, and refused for good on 403 from another origin', async () => {
	let calls = 0;
	const files = await startServer((request, response, socket) => {
		calls++;
		if (request.path.endsWith('/gone.mp4')) {
			response.writeHead(403);
			response.end();
			return;
		}
		if (calls === 1) {
			sendJson(response, 503, {});
			return;
		}
		if (calls === 2) {
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.byteLength) });
			response.write(VIDEO.subarray(0, 100));
			setTimeout(() => socket.destroy(), 20);
			return;
		}
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.byteLength) });
		response.end(VIDEO);
	});
	try {
		const sleep = recordingSleep();
		const http = bound('https://ark.ap-southeast.bytepluses.com/api/v3', sleep.sleep);
		const target = partPath();
		const { size } = await downloadFile(http, { url: `${files.url}/v.mp4` }, target, 'video');
		const gone = await failure(downloadFile(http, { url: `${files.url}/gone.mp4` }, partPath(), 'video'));
		assert.deepEqual({ size, same: readFileSync(target).equals(VIDEO), waits: sleep.waits, gone: [gone.code, gone.status] }, {
			size: VIDEO.byteLength,
			same: true,
			waits: [1000, 2000],
			gone: ['notFound', 403]
		});
	} finally {
		await files.close();
	}
});

test('an image download keeps a PNG, a JPEG, or a WebP, answers the format its bytes start like, and sends the key to no CDN', async () => {
	const images = { '/a.png': tinyPng(), '/b.jpg': tinyJpeg(), '/c.webp': webpHeader('VP8L', 2, 2), '/d.png': tinyJpeg() };
	const cdn = await startServer(routed(serveFiles(images)));
	try {
		const http = bound('https://api.example.com/v1');
		const kept: Record<string, unknown> = {};
		for (const [path, bytes] of Object.entries(images)) {
			const target = partPath();
			kept[path] = { ...await downloadFile(http, { url: `${cdn.url}${path}?sig=1` }, target, 'image'), same: readFileSync(target).equals(bytes) };
		}
		assert.deepEqual({ kept, keySent: cdn.received.some(entry => entry.headers.authorization !== undefined), accept: cdn.received[0].headers.accept }, {
			kept: {
				'/a.png': { size: tinyPng().byteLength, format: 'png', same: true },
				'/b.jpg': { size: tinyJpeg().byteLength, format: 'jpeg', same: true },
				'/c.webp': { size: 32, format: 'webp', same: true },
				// The bytes decide, not the name.
				'/d.png': { size: tinyJpeg().byteLength, format: 'jpeg', same: true }
			},
			keySent: false,
			accept: 'image/png,image/jpeg,image/webp,application/octet-stream;q=0.9,*/*;q=0.5'
		});
	} finally {
		await cdn.close();
	}
});

test('an image download refuses a GIF, a page, and a file too short to tell, stops at 64 MiB, and leaves no file', async () => {
	const files = await startServer(routed(
		serveFiles({ '/d.gif': gifHeader(2, 2), '/page.html': Buffer.from('<html>expired</html>'), '/short.png': tinyPng().subarray(0, 10) }),
		(request, response) => {
			if (request.path === '/huge.png') {
				// Announced larger than BaseHalf keeps: refused before a byte is read.
				response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(MAX_IMAGE_DOWNLOAD_BYTES + 1) });
				response.flushHeaders();
				return true;
			}
			if (request.path === '/chunked.jpg') {
				response.writeHead(200, { 'Content-Type': 'image/jpeg' });
				response.write(tinyJpeg());
				response.end(tinyJpeg());
				return true;
			}
			return false;
		}
	));
	try {
		const http = bound('https://api.example.com/v1');
		const outcome = async (path: string, maxBytes?: number) => {
			const target = partPath();
			const failed = await failure(downloadFile(http, { url: `${files.url}${path}` }, target, 'image', maxBytes !== undefined ? { maxBytes } : {}));
			return [failed.code, failed.message, existsSync(target)];
		};
		assert.deepEqual({
			gif: await outcome('/d.gif'),
			page: await outcome('/page.html'),
			short: await outcome('/short.png'),
			huge: await outcome('/huge.png'),
			streamed: await outcome('/chunked.jpg', tinyJpeg().byteLength + 10),
			gone: await outcome('/missing.png')
		}, {
			gif: ['notImage', 'The file does not start like a PNG, JPEG, or WebP image.', false],
			page: ['notImage', 'The file does not start like a PNG, JPEG, or WebP image.', false],
			short: ['notImage', 'The file is too short to be a PNG, JPEG, or WebP image.', false],
			huge: ['tooLarge', `The image is ${MAX_IMAGE_DOWNLOAD_BYTES + 1} bytes, more than the ${MAX_IMAGE_DOWNLOAD_BYTES} bytes BaseHalf downloads.`, false],
			streamed: ['tooLarge', `The image is larger than the ${tinyJpeg().byteLength + 10} bytes BaseHalf downloads.`, false],
			gone: ['notFound', 'The image is no longer at the address the provider gave (HTTP 404); the address may have expired.', false]
		});
		assert.equal(MAX_IMAGE_DOWNLOAD_BYTES, 64 * 1024 * 1024);
	} finally {
		await files.close();
	}
});

test('an image the provider answered inline is written under the checks of a download, and the bytes decide its format', async () => {
	// An endpoint nothing listens on: an inline file is never requested.
	const http = bound('https://api.example.com/v1');
	const target = partPath();
	const kept = await downloadFile(http, { bytes: tinyJpeg(), format: 'png' }, target, 'image');
	const outcome = async (bytes: Uint8Array) => {
		const failedTarget = partPath();
		const failed = await failure(downloadFile(http, { bytes }, failedTarget, 'image'));
		return [failed.code, failed.message, existsSync(failedTarget)];
	};
	const huge = Buffer.alloc(MAX_IMAGE_DOWNLOAD_BYTES + 1);
	tinyPng().copy(huge);
	assert.deepEqual({
		kept,
		same: readFileSync(target).equals(tinyJpeg()),
		video: await outcome(VIDEO),
		short: await outcome(tinyPng().subarray(0, 8)),
		huge: await outcome(huge)
	}, {
		kept: { size: tinyJpeg().byteLength, format: 'jpeg' },
		same: true,
		video: ['notImage', 'The file does not start like a PNG, JPEG, or WebP image.', false],
		short: ['notImage', 'The file is too short to be a PNG, JPEG, or WebP image.', false],
		huge: ['tooLarge', `The image is ${MAX_IMAGE_DOWNLOAD_BYTES + 1} bytes, more than the ${MAX_IMAGE_DOWNLOAD_BYTES} bytes BaseHalf downloads.`, false]
	});
});
