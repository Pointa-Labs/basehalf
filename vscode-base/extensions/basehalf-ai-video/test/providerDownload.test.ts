/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadVideo } from '../src/providers/download.ts';
import { ProviderFailure } from '../src/providers/failure.ts';
import { BoundHttp, parseEndpoint, resolveHttpOptions } from '../src/providers/http.ts';
import { isoMedia, recordingSleep, sendJson, startServer } from './providerTestKit.ts';

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
		const size = await downloadVideo(bound(`${api.url}/api`), { url: `${api.url}/api/redirect?hops=3` }, target);
		const tooMany = await failure(downloadVideo(bound(`${api.url}/api`), { url: `${api.url}/api/redirect?hops=5` }, partPath()));
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
		await downloadVideo(http, { url: `${api.url}/files/v.mp4`, headers: { 'x-goog-api-key': 'key-for-files' } }, partPath());
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
		const tooLarge = await failure(downloadVideo(http, { url: `${files.url}/video.mp4` }, declared, { maxBytes: 1000 }));
		const streamed = partPath();
		const tooLong = await failure(downloadVideo(http, { url: `${files.url}/chunked.mp4` }, streamed, { maxBytes: VIDEO.byteLength + 10 }));
		const html = partPath();
		const notVideo = await failure(downloadVideo(http, { url: `${files.url}/page.html` }, html));
		const notPart = await failure(downloadVideo(http, { url: `${files.url}/video.mp4` }, join(folder, 'video.mp4')));
		const insecure = await failure(downloadVideo(http, { url: 'http://cdn.example.com/video.mp4' }, partPath()));
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
		const size = await downloadVideo(http, { url: `${files.url}/v.mp4` }, target);
		const gone = await failure(downloadVideo(http, { url: `${files.url}/gone.mp4` }, partPath()));
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
