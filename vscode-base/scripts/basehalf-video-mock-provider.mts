/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * A local video and image provider for tests and the smoke (D59, D64). It
 * answers like ByteDance's ModelArk API (Volcengine Ark and BytePlus
 * ModelArk) under `/api/v3`, and accepts one test key:
 *
 * - Seedance's task API: it checks the shape of a create request, moves each
 *   task from queued to running to succeeded over a few seconds, cancels a
 *   queued task on DELETE, and serves a small MP4 made for these tests from a
 *   separate path without a key, as a signed CDN link would be.
 * - Seedream's `POST /images/generations`, which answers at once: it checks
 *   the shape of the request and answers small PNGs, one per image asked for
 *   (`max_images` of a set, otherwise one), as addresses it serves itself
 *   without a key (`response_format: url`, the default) or as base64
 *   (`b64_json`).
 *
 * It never talks to a real provider.
 *
 *   node --experimental-strip-types scripts/basehalf-video-mock-provider.mts \
 *     [--port <port>] [--key <key>] [--seconds <seconds>] [--fail <failure>]
 *
 * Its base URL is `http://127.0.0.1:<port>/api/v3`. Failures, for every request
 * (`--fail`, or `POST /__mock/configure` with `{"fail": ...}`), or for one
 * request through a marker in its prompt:
 *
 * - `key`: every key is refused (HTTP 401). Marker: none; use a wrong key.
 * - `reject` / `[mock:reject]`: the request is refused (HTTP 400).
 * - `task` / `[mock:fail]`: the task is made and later fails; of images, the
 *   last one is refused by the content check and the others are made.
 * - `expire` / `[mock:expire]`: the task is made and later expires.
 * - `drop` / `[mock:drop]`: the connection closes after the request arrived,
 *   without an answer: the outcome is unknown to the caller.
 * - `slow` / `[mock:slow]`: the task never finishes; images are answered only
 *   after the time a task takes (`--seconds`).
 * - `[mock:fewer]`: a set of images has one image fewer than asked.
 * - `[mock:jpeg]`: the images are JPEG files, also for a model that delivers
 *   PNG.
 *
 * `GET /__mock/requests` lists the create requests received, of tasks and of
 * images, without keys and with inline media shortened. The fixture video
 * was recorded from a canvas animation with Chromium's MediaRecorder and
 * remuxed with avconvert: 2 s, 320×180, H.264. The fixture JPEG is a PNG of
 * one color, 16×16, converted with sips. With `uniqueFiles`, as the smoke
 * starts it, each file it answers is its own, as a real provider's are.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { FAILURES, MOCK_VIDEO_FIXTURE_URL, startMockVideoProvider, type MockVideoProviderFailure } from '../out/vs/platform/basehalfProviders/test/node/mockVideoProvider.js';

// The provider itself is the unit tests' helper, compiled into `out/` with them (D75).
export * from '../out/vs/platform/basehalfProviders/test/node/mockVideoProvider.js';

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const failure = argument('fail');
	if (failure !== undefined && !(FAILURES as readonly string[]).includes(failure)) {
		console.error(`--fail must be one of ${FAILURES.join(', ')}.`);
		process.exit(2);
	}
	const provider = await startMockVideoProvider({
		port: Number(argument('port') ?? 0),
		...(argument('key') ? { key: argument('key') } : {}),
		...(argument('seconds') ? { durationMs: Number(argument('seconds')) * 1000 } : {}),
		...(failure ? { fail: failure as MockVideoProviderFailure } : {})
	});
	console.log(JSON.stringify({
		ok: true,
		url: provider.url,
		baseUrl: provider.baseUrl,
		key: provider.key,
		fixture: fileURLToPath(MOCK_VIDEO_FIXTURE_URL)
	}));
	const stop = () => {
		void provider.close().then(() => process.exit(0));
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}
