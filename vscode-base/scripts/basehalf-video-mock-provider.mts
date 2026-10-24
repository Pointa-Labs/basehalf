/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * A local provider of videos, images, and sounds for tests and the smoke
 * (D59, D64, D78). It answers like three providers' APIs, each under a path
 * of its own, and accepts one test key at each:
 *
 * - ByteDance's ModelArk (Volcengine Ark and BytePlus ModelArk) under
 *   `/api/v3`, with `Authorization: Bearer <key>`:
 *   - Seedance's task API: it checks the shape of a create request, moves
 *     each task from queued to running to succeeded over a few seconds,
 *     cancels a queued task on DELETE, and serves a small MP4 made for these
 *     tests from a separate path without a key, as a signed CDN link would be.
 *   - Seedream's `POST /images/generations`, which answers at once: it checks
 *     the shape of the request and answers small PNGs, one per image asked
 *     for (`max_images` of a set, otherwise one), as addresses it serves
 *     itself without a key (`response_format: url`, the default) or as base64
 *     (`b64_json`).
 * - ElevenLabs under `/elevenlabs`, with `xi-api-key: <key>`:
 *   - `POST /v1/text-to-speech/{voice}` and `POST /v1/sound-generation`
 *     check the request as ElevenLabs validates it (a list of the fields that
 *     do not validate, HTTP 422) and answer an MP3 at once, the voice too: a
 *     voice it does not know is not found (HTTP 404).
 *   - `GET /v2/voices` lists four voices with ElevenLabs' paging
 *     (`page_size`, at most 100, and `next_page_token` while `has_more`): two
 *     of the account (a clone and a designed voice), the default voice of
 *     BaseHalf's catalog, saved from the Voice Library, and George, one of
 *     ElevenLabs' Default voices (`premade`). Each has a `preview_url`, a
 *     short MP3 it serves without a key. The other five Voice Library voices
 *     of BaseHalf's catalog speak too, unlisted, as any account uses a
 *     library voice by its id.
 * - Mureka under `/mureka`, with `Authorization: Bearer <key>`:
 *   - `POST /v1/files/upload`, a multipart form of `purpose` and `file`,
 *     keeps the file and answers its id, which a song takes as
 *     `reference_id`.
 *   - `POST /v1/song/generate` (lyrics), `/v1/song/easy-generate` (a
 *     description), and `/v1/instrumental/generate` check the request and
 *     make a task, which `GET /v1/song/query/{id}` and
 *     `/v1/instrumental/query/{id}` move from preparing to running to
 *     succeeded over a few seconds, with `n` choices (2 unless asked), each
 *     the address of an MP3 it serves without a key.
 *
 * It never talks to a real provider.
 *
 *   node --experimental-strip-types scripts/basehalf-video-mock-provider.mts \
 *     [--port <port>] [--key <key>] [--seconds <seconds>] [--fail <failure>]
 *
 * Its base URLs, which it prints, are `http://127.0.0.1:<port>/api/v3`,
 * `http://127.0.0.1:<port>/elevenlabs`, and `http://127.0.0.1:<port>/mureka`:
 * enter one as the endpoint of its provider in Providers. Failures, for every
 * request (`--fail`, or `POST /__mock/configure` with `{"fail": ...}`), or for
 * one request through a marker in its prompt, its text, its lyrics, or its
 * description:
 *
 * - `key`: every key is refused (HTTP 401), in each API's form. Marker: none;
 *   use a wrong key.
 * - `reject` / `[mock:reject]`: the request is refused (HTTP 400).
 * - `task` / `[mock:fail]`: the task is made and later fails; of images, the
 *   last one is refused by the content check and the others are made; of a
 *   sound answered at once, the answer is not a sound.
 * - `expire` / `[mock:expire]`: the task is made and later expires; a song's
 *   task times out (`timeouted`).
 * - `drop` / `[mock:drop]`: the connection closes after the request arrived,
 *   without an answer: the outcome is unknown to the caller.
 * - `slow` / `[mock:slow]`: the task never finishes; images and sounds are
 *   answered only after the time a task takes (`--seconds`).
 * - `[mock:fewer]`: a set of images, or the songs of a task, has one fewer
 *   than asked.
 * - `[mock:jpeg]`: the images are JPEG files, also for a model that delivers
 *   PNG.
 *
 * `GET /__mock/requests` lists the requests received that create a task,
 * images, or a sound, and the uploads, without keys, with inline media
 * shortened, and with an upload's file as its name, type, and size: the
 * text, the voice, the lyrics, the style, and `n` of a sound, as each was
 * sent. The fixture video was recorded from a canvas animation with
 * Chromium's MediaRecorder and remuxed with avconvert: 2 s, 320×180, H.264.
 * The fixture JPEG is a PNG of one color, 16×16, converted with sips. A sound
 * is an MP3 of silence that the provider writes itself, 3 s long, or the
 * length a sound effect asks for, and 12 s for a voice's sample. With
 * `uniqueFiles`, as the smoke starts it, each file it answers is its own, as
 * a real provider's are.
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
		elevenLabsUrl: provider.elevenLabsUrl,
		murekaUrl: provider.murekaUrl,
		key: provider.key,
		fixture: fileURLToPath(MOCK_VIDEO_FIXTURE_URL)
	}));
	const stop = () => {
		void provider.close().then(() => process.exit(0));
	};
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}
