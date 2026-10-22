/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import { ProviderFailure } from '../src/providers/failure.ts';
import { error, isoMedia, png, sendJson, startServer, testModule, value, webpHeader } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-provider-commands-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));
const startFrame = join(folder, 'start.png');
writeFileSync(startFrame, png(640, 360));
const smallFrame = join(folder, 'small.png');
writeFileSync(smallFrame, png(100, 100));

const KEY = 'sk-commands-secret-1';
const NO_INPUTS = { images: [], videos: [], audios: [] };

function commands(overrides: Parameters<typeof testModule>[0] = {}) {
	return new VideoProviderCommands([testModule(overrides)], { http: { sleep: async () => undefined } });
}

function submitRequest(endpoint: string, overrides: Record<string, unknown> = {}) {
	return {
		provider: 'testprovider',
		region: 'home',
		endpoint,
		credentials: { apiKey: KEY },
		model: 'clip-1',
		mode: 'frames',
		params: { resolution: '720p', duration: 5 },
		prompt: 'A bicycle passes the sea.',
		inputs: { startFrame: { fsPath: startFrame, mimeType: 'image/png' }, ...NO_INPUTS },
		...overrides
	};
}

test('catalog answers the validated catalog of the modules', () => {
	const catalog = value(commands().catalog());
	assert.deepEqual(catalog.providers.map(provider => [provider.id, provider.models.map(model => model.id)]), [['testprovider', ['clip-1', 'clip-away', 'still-1', 'still-tasks']]]);
	assert.throws(() => new VideoProviderCommands([testModule({ describe: () => ({ ...testModule().describe(), regions: [] }) })]), /at least one region is needed/);
});

test('check runs the declarations\' checks, then the module\'s rules', async () => {
	const providers = commands();
	const base = { provider: 'testprovider', region: 'home', model: 'clip-1', mode: 'frames', prompt: '', inputs: NO_INPUTS };
	const empty = value(await providers.check({ ...base, params: {} }));
	const rule = value(await providers.check({ ...base, prompt: 'p', params: { duration: 12 } }));
	const badValue = value(await providers.check({ ...base, prompt: 'p', params: { resolution: '4k' } }));
	const away = value(await providers.check({ ...base, model: 'clip-away', prompt: 'p', params: {} }));
	const notOffered = value(await providers.check({ ...base, model: 'clip-away', region: 'home', prompt: 'p', params: {} }));
	const withFiles = value(await providers.check({ ...base, prompt: 'p', params: {}, inputs: { startFrame: { fsPath: smallFrame, mimeType: 'image/png' }, ...NO_INPUTS } }));
	assert.deepEqual({ empty, rule, badValue, away, notOffered, withFiles }, {
		empty: { problems: ['Write a prompt or connect an image: Clip 1 needs one or the other.'] },
		rule: { problems: ['720p allows 10 seconds at most.'] },
		badValue: { problems: ['Resolution cannot be 4k for Clip 1; choose 480p, 720p.'] },
		away: { problems: ['Test Provider does not offer Clip Away in Home.'] },
		notOffered: { problems: ['Test Provider does not offer Clip Away in Home.'] },
		withFiles: { problems: ['The start frame small.png is 100 × 100 px; each side must be between 300 and 6000 px.'] }
	});
	const awayRegion = value(await providers.check({ ...base, region: 'away', model: 'clip-away', prompt: 'p', params: {} }));
	assert.deepEqual(awayRegion, { problems: [] });
});

test('a parameter a start frame sets is left out with a start frame, and a mode outside its regions is refused', async () => {
	const provider = testModule().describe();
	const [clip, away] = provider.models;
	const declared = {
		...provider,
		models: [{
			...clip,
			modes: clip.modes.map(mode => mode.id === 'reference' ? { ...mode, regions: ['away'] } : mode),
			parameters: clip.parameters.map(entry => entry.name === 'ratio' ? { ...entry, modes: undefined, setByStartFrame: true } : entry)
		}, away]
	};
	const seen: Record<string, unknown>[] = [];
	const providers = commands({
		describe: () => declared,
		async check(request) {
			seen.push({ ...request.params });
			return { problems: [] };
		}
	});
	const base = { provider: 'testprovider', region: 'home', model: 'clip-1', mode: 'frames', prompt: 'p' };
	const frame = { fsPath: startFrame, mimeType: 'image/png' };
	// With a start frame, even a ratio the model does not offer is left out unchecked.
	const withFrame = value(await providers.check({ ...base, params: { ratio: '21:9' }, inputs: { startFrame: frame, ...NO_INPUTS } }));
	const withoutFrame = value(await providers.check({ ...base, params: { ratio: '21:9' }, inputs: NO_INPUTS }));
	const defaults = value(await providers.check({ ...base, params: {}, inputs: NO_INPUTS }));
	const outside = value(await providers.check({ ...base, mode: 'reference', params: {}, inputs: { ...NO_INPUTS, images: [frame] } }));
	assert.deepEqual({ withFrame: withFrame.problems, withoutFrame: withoutFrame.problems, outside: outside.problems, seen }, {
		withFrame: [],
		withoutFrame: ['Ratio cannot be 21:9 for Clip 1; choose 16:9, 9:16.'],
		outside: ['Clip 1 offers References mode only in Away. Choose another mode, or another region in Video Providers.'],
		seen: [{ resolution: '720p', duration: 5 }, { resolution: '720p', duration: 5, ratio: '16:9' }]
	});
	void defaults;
});

test('check refuses an image in a format the mode does not take, and answers the provider id the module would send', async () => {
	const webpFrame = join(folder, 'start.webp');
	writeFileSync(webpFrame, webpHeader('VP8X', 640, 360));
	const provider = testModule().describe();
	const pngAndJpeg = {
		...provider,
		models: provider.models.map(model => ({ ...model, modes: model.modes.map(mode => ({ ...mode, limits: { ...mode.limits, imageFormats: ['png', 'jpeg'] as const } })) }))
	};
	const providers = commands({
		describe: () => pngAndJpeg,
		async check(request) {
			return { problems: [], providerModel: request.inputs.startFrame ? 'clip-1-from-image' : 'clip-1-from-text' };
		}
	});
	const base = { provider: 'testprovider', region: 'home', model: 'clip-1', mode: 'frames', prompt: 'p', params: {} };
	const webp = value(await providers.check({ ...base, inputs: { startFrame: { fsPath: webpFrame, mimeType: 'image/webp' }, ...NO_INPUTS } }));
	const fromImage = value(await providers.check({ ...base, inputs: { startFrame: { fsPath: startFrame, mimeType: 'image/png' }, ...NO_INPUTS } }));
	const fromText = value(await providers.check({ ...base, inputs: NO_INPUTS }));
	assert.deepEqual({ webp, fromImage, fromText }, {
		webp: { problems: ['The start frame start.webp is a WebP image; this mode takes PNG or JPEG images.'], providerModel: 'clip-1-from-image' },
		fromImage: { problems: [], providerModel: 'clip-1-from-image' },
		fromText: { problems: [], providerModel: 'clip-1-from-text' }
	});
});

test('payloads are validated strictly, an unknown provider answers unknownProvider, and nothing is sent for them', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { id: 'task-1' }));
	try {
		const providers = commands();
		const endpoint = `${server.url}/v1`;
		const outcomes = [
			await providers.submit({ ...submitRequest(endpoint), provider: 'nobody' }),
			await providers.submit({ ...submitRequest(endpoint), region: 'mars' }),
			await providers.submit({ ...submitRequest(endpoint), model: 'clip-9' }),
			await providers.submit({ ...submitRequest(endpoint), mode: 'dance' }),
			await providers.submit({ ...submitRequest(endpoint), credentials: {} }),
			await providers.submit({ ...submitRequest(endpoint), credentials: { apiKey: 'has spaces' } }),
			await providers.submit({ ...submitRequest(endpoint), endpoint: 'http://relay.example.com/v1' }),
			await providers.submit({ ...submitRequest(endpoint), params: { duration: { nested: true } } }),
			await providers.submit({ ...submitRequest(endpoint), inputs: { startFrame: { fsPath: startFrame }, ...NO_INPUTS } }),
			await providers.submit({ ...submitRequest(endpoint), inputs: { startFrame: true, endFrame: false, images: 0, videos: 0, audios: 0, source: false } }),
			await providers.submit({ ...submitRequest(endpoint), inputs: { startFrame: { fsPath: join(folder, 'missing.png'), mimeType: 'image/png' }, ...NO_INPUTS } }),
			await providers.submit({ ...submitRequest(endpoint), prompt: 42 }),
			await providers.submit('not a request'),
			await providers.poll({ ...submitRequest(endpoint), remoteId: 'has space' }),
			// A check takes the files, never counts of them.
			await providers.check({ provider: 'testprovider', region: 'home', model: 'clip-1', mode: 'frames', params: {}, prompt: 'p', inputs: { startFrame: false, endFrame: false, images: 0, videos: 0, audios: 0, source: false } }),
			await providers.check({ provider: 'nobody', region: 'home', model: 'clip-1', mode: 'frames', params: {}, prompt: '', inputs: NO_INPUTS })
		].map(outcome => error<unknown>(outcome).code);
		assert.deepEqual({ outcomes, received: server.received.length }, {
			outcomes: ['unknownProvider', 'rejected', 'rejected', 'rejected', 'auth', 'auth', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'unknownProvider'],
			received: 0
		});
	} finally {
		await server.close();
	}
});

test('submit refuses with the first problem before anything is sent, and answers the task id once accepted', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { id: `task-${server.received.length}` }));
	try {
		const providers = commands();
		const endpoint = `${server.url}/v1`;
		const refused = error(await providers.submit(submitRequest(endpoint, { inputs: { startFrame: { fsPath: smallFrame, mimeType: 'image/png' }, ...NO_INPUTS } })));
		const sentBefore = server.received.length;
		const accepted = value(await providers.submit(submitRequest(endpoint)));
		assert.deepEqual({ refused, sentBefore, accepted, sent: server.received.length, key: server.received[0].headers.authorization }, {
			refused: { code: 'rejected', message: 'The start frame small.png is 100 × 100 px; each side must be between 300 and 6000 px.' },
			sentBefore: 0,
			accepted: { remoteId: 'task-1' },
			sent: 1,
			key: `Bearer ${KEY}`
		});
	} finally {
		await server.close();
	}
});

test('after the provider accepted a request, an answer that cannot be read leaves the outcome unknown', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, { id: '' }));
	try {
		const endpoint = `${server.url}/v1`;
		const noId = error(await commands().submit(submitRequest(endpoint)));
		const thrown = error(await commands({
			async submit(_request, http) {
				await http.create({ method: 'POST', path: '/tasks', body: { kind: 'json', value: {} } });
				throw new TypeError('Cannot read properties of undefined');
			}
		}).submit(submitRequest(endpoint)));
		const beforeCreate = error(await commands({
			async submit() {
				throw new TypeError('Cannot read properties of undefined');
			}
		}).submit(submitRequest(endpoint)));
		assert.deepEqual({ noId: noId.code, thrown, beforeCreate, sent: server.received.length }, {
			noId: 'unknownOutcome',
			thrown: { code: 'unknownOutcome', message: 'The provider accepted the request, but AI Video could not read its answer: Cannot read properties of undefined' },
			beforeCreate: { code: 'rejected', message: 'AI Video could not prepare the request: Cannot read properties of undefined' },
			sent: 2
		});
	} finally {
		await server.close();
	}
});

test('no message carries a credential: not an error the provider echoes, not a failed task, not a module\'s own failure', async () => {
	const server = await startServer((request, response) => {
		if (request.path.startsWith('/v1/tasks/failed')) {
			sendJson(response, 200, { status: 'failed' });
			return;
		}
		sendJson(response, 400, { error: { message: `Bad key ${request.headers.authorization} for <b>${request.path}</b>` } });
	});
	try {
		const endpoint = `${server.url}/v1`;
		const echoed = error(await commands().submit(submitRequest(endpoint)));
		const failedTask = value(await commands({
			async poll(ref) {
				return { state: 'failed', message: `Task failed for key ${KEY}.` };
			}
		}).poll({ ...submitRequest(endpoint), remoteId: 'failed-1' }));
		const ownFailure = error(await commands({
			async poll() {
				throw new ProviderFailure('rejected', `The key ${KEY} is wrong.`);
			}
		}).poll({ ...submitRequest(endpoint), remoteId: 'x' }));
		assert.deepEqual({ echoed, failedTask, ownFailure }, {
			echoed: { code: 'rejected', message: 'Bad key Bearer *** for /v1/tasks', status: 400 },
			failedTask: { state: 'failed', message: 'Task failed for key ***.' },
			ownFailure: { code: 'rejected', message: 'The key *** is wrong.' }
		});
	} finally {
		await server.close();
	}
});

test('poll, download, and cancel dispatch to the module; a download without an address asks the module where the video is', async () => {
	const video = isoMedia(2);
	const server = await startServer((request, response) => {
		if (request.path === '/v1/tasks/t-1') {
			sendJson(response, 200, { status: 'done', url: `${server.url}/v1/tasks/t-1/video` });
			return;
		}
		if (request.path === '/v1/tasks/t-1/video') {
			response.writeHead(200, { 'Content-Type': 'video/mp4' });
			response.end(video);
			return;
		}
		sendJson(response, 404, {});
	});
	try {
		const providers = commands({ cancel: async () => true });
		const ref = { provider: 'testprovider', region: 'home', endpoint: `${server.url}/v1`, credentials: { apiKey: KEY }, model: 'clip-1', remoteId: 't-1' };
		const polled = value(await providers.poll(ref));
		const target = join(folder, 'video.mp4.part');
		const downloaded = value(await providers.download({ ...ref, targetFsPath: target }));
		const cancelled = value(await providers.cancel(ref));
		const unknown = error(await providers.poll({ ...ref, remoteId: 't-2' }));
		assert.deepEqual({ polled, downloaded, same: readFileSync(target).equals(video), cancelled, unknown: unknown.code, videoKey: server.received[1].headers.authorization }, {
			polled: { state: 'succeeded', videoUrl: `${server.url}/v1/tasks/t-1/video` },
			downloaded: { size: video.byteLength, format: 'mp4' },
			same: true,
			cancelled: { cancelled: true },
			unknown: 'notFound',
			videoKey: `Bearer ${KEY}`
		});
	} finally {
		await server.close();
	}
});

test('a module that leaves out videoLocation downloads a video only from the address its poll gave', async () => {
	const video = isoMedia(2);
	const server = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4' });
		response.end(video);
	});
	try {
		const providers = commands({ videoLocation: undefined });
		const ref = { provider: 'testprovider', region: 'home', endpoint: `${server.url}/v1`, credentials: { apiKey: KEY }, model: 'clip-1', remoteId: 't-1' };
		const withAddress = value(await providers.download({ ...ref, videoUrl: `${server.url}/v1/tasks/t-1/video`, targetFsPath: join(folder, 'located.mp4.part') }));
		const withoutAddress = error(await providers.download({ ...ref, targetFsPath: join(folder, 'unlocated.mp4.part') }));
		assert.deepEqual({ withAddress, withoutAddress, requests: server.received.length }, {
			withAddress: { size: video.byteLength, format: 'mp4' },
			withoutAddress: { code: 'invalidResponse', message: 'AI Video needs the address the poll gave to download a video from Test Provider.' },
			requests: 1
		});
	} finally {
		await server.close();
	}
});
