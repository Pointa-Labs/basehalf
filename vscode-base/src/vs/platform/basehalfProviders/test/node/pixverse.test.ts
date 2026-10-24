/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The PixVerse module (docs/specs/video-providers/pixverse.md) through the
 * provider commands, against local servers that answer like PixVerse's API
 * and its media host. No test calls PixVerse or uses a real key.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VideoProviderCommands } from '../src/providers/commands.ts';
import type { MediaFacts, MediaInspector } from '../src/providers/media.ts';
import { PIXVERSE } from '../src/providers/pixverse.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { CatalogModel, PlannedMedia } from '../src/providers/types.ts';
import { error, isoMedia, jpegHeader, plannedFiles, png, sendJson, startServer, value, webpHeader, type Received, type TestServer } from './providerTestKit.ts';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-pixverse-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

interface FileMedia {
	readonly fsPath: string;
	readonly mimeType: string;
}

function file(name: string, bytes: Buffer, mimeType: string): FileMedia {
	const fsPath = join(folder, name);
	writeFileSync(fsPath, bytes);
	return { fsPath, mimeType };
}

const START = file('start.png', png(640, 360), 'image/png');
const END = file('end.jpg', jpegHeader(1280, 720), 'image/jpeg');
const REFERENCES = [
	file('one.png', png(400, 400), 'image/png'),
	file('two.jpg', jpegHeader(720, 1280), 'image/jpeg'),
	file('three.webp', webpHeader('VP8X', 600, 300), 'image/webp')
];
const CLIPS = [
	file('clip.mp4', isoMedia(6), 'video/mp4'),
	file('take.mov', isoMedia(4.5, { brand: 'qt  ' }), 'video/quicktime')
];
const SOURCE = file('source.mp4', isoMedia(12), 'video/mp4');
const LONG_SOURCE = file('long-source.mp4', isoMedia(30), 'video/mp4');

const KEY = 'pixverse-test-key-0001';
const PROMPT = 'A paper lantern drifts over a night market.';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Mode = 'frames' | 'reference' | 'extend';

interface Inputs {
	readonly startFrame?: FileMedia;
	readonly endFrame?: FileMedia;
	readonly images?: readonly FileMedia[];
	readonly videos?: readonly FileMedia[];
	readonly source?: FileMedia;
}

function commands(options: { readonly inspector?: () => MediaInspector } = {}): VideoProviderCommands {
	return new VideoProviderCommands([PIXVERSE], { http: { sleep: async () => undefined }, ...options });
}

function generation(endpoint: string, model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs = {}, prompt = PROMPT) {
	return {
		provider: 'pixverse',
		region: 'global',
		endpoint,
		credentials: { apiKey: KEY },
		model,
		mode,
		params,
		prompt,
		inputs: {
			...(inputs.startFrame ? { startFrame: inputs.startFrame } : {}),
			...(inputs.endFrame ? { endFrame: inputs.endFrame } : {}),
			images: inputs.images ?? [],
			videos: inputs.videos ?? [],
			audios: [],
			...(inputs.source ? { source: inputs.source } : {})
		}
	};
}

function taskRef(endpoint: string, remoteId: string) {
	return { provider: 'pixverse', region: 'global', endpoint, credentials: { apiKey: KEY }, model: 'pixverse-v6', remoteId };
}

/** PixVerse's answer: `ErrCode` 0 and `Resp`. */
function ok(resp: unknown) {
	return { ErrCode: 0, ErrMsg: 'Success', Resp: resp };
}

/** The path of a request under `/openapi/v2`, whatever the endpoint's own path. */
function apiPath(request: Received): string {
	return request.path.replace(/^.*?\/openapi\/v2/, '');
}

/**
 * A server that answers like PixVerse: image uploads with ids from 101, media
 * uploads from 201, and creates from 301. `answer` handles a request first when
 * it returns true.
 */
async function pixverse(answer?: (request: Received, response: ServerResponse) => boolean): Promise<TestServer> {
	let images = 0;
	let media = 0;
	let videos = 0;
	return startServer((request, response) => {
		if (answer?.(request, response)) {
			return;
		}
		const path = apiPath(request);
		if (request.method === 'POST' && path === '/image/upload') {
			images++;
			sendJson(response, 200, ok({ img_id: 100 + images, img_url: `https://media.example/image-${images}.png` }));
		} else if (request.method === 'POST' && path === '/media/upload') {
			media++;
			sendJson(response, 200, ok({ media_id: 200 + media, media_type: 'video', url: `https://media.example/video-${media}.mp4`, width: 1280, height: 720 }));
		} else if (request.method === 'POST' && /^\/video\/[a-z]+\/generate$/.test(path)) {
			videos++;
			sendJson(response, 200, ok({ video_id: 300 + videos, credits: 45 }));
		} else {
			sendJson(response, 200, { ErrCode: 500008, ErrMsg: 'Requested data not found', Resp: null });
		}
	});
}

interface Part {
	readonly name: string;
	readonly fileName: string | undefined;
	readonly contentType: string | undefined;
	readonly bytes: Buffer;
}

/** The parts of a multipart form, in order. */
function formParts(request: Received): Part[] {
	const boundary = /boundary=(?<boundary>\S+)$/.exec(String(request.headers['content-type']))?.groups?.boundary;
	assert.ok(boundary, 'a multipart form has a boundary');
	const delimiter = Buffer.from(`--${boundary}`, 'latin1');
	const parts: Part[] = [];
	let start = request.body.indexOf(delimiter);
	while (start >= 0) {
		const next = request.body.indexOf(delimiter, start + delimiter.length);
		if (next < 0) {
			break;
		}
		const part = request.body.subarray(start + delimiter.length + 2, next - 2);
		const headerEnd = part.indexOf('\r\n\r\n');
		const head = part.subarray(0, headerEnd).toString('utf8');
		parts.push({
			name: / name="(?<name>[^"]*)"/.exec(head)?.groups?.name ?? '',
			fileName: /filename="(?<file>[^"]*)"/.exec(head)?.groups?.file,
			contentType: /Content-Type: (?<type>.+)/i.exec(head)?.groups?.type.trim(),
			bytes: part.subarray(headerEnd + 4)
		});
		start = next;
	}
	return parts;
}

/** What a request carried: its method, path, and key, and its form or its JSON. */
function sent(request: Received) {
	const common = { method: request.method, path: request.path, key: request.headers['api-key'] };
	if (String(request.headers['content-type']).startsWith('multipart/form-data')) {
		return { ...common, form: formParts(request) };
	}
	return { ...common, type: request.headers['content-type'], body: request.body.byteLength ? JSON.parse(request.body.toString('utf8')) : undefined };
}

function imageUpload(media: FileMedia, fileName: string, contentType: string) {
	return { method: 'POST', path: '/openapi/v2/image/upload', key: KEY, form: [{ name: 'image', fileName, contentType, bytes: readFileSync(media.fsPath) }] };
}

function mediaUpload(media: FileMedia, fileName: string, contentType: string) {
	return { method: 'POST', path: '/openapi/v2/media/upload', key: KEY, form: [{ name: 'file', fileName, contentType, bytes: readFileSync(media.fsPath) }] };
}

function create(endpoint: string, body: unknown) {
	return { method: 'POST', path: `/openapi/v2/video/${endpoint}/generate`, key: KEY, type: 'application/json', body };
}

const startUpload = () => imageUpload(START, 'start-frame.png', 'image/png');
const endUpload = () => imageUpload(END, 'end-frame.jpg', 'image/jpeg');

// --- the catalog --------------------------------------------------------------------------------

test('the catalog declares PixVerse with one region, one API key, and four models with their modes, limits, and settings', () => {
	const provider = buildCatalog([PIXVERSE]).providers[0];
	assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
		id: 'pixverse',
		label: 'PixVerse',
		regions: [{ id: 'global', label: 'Global', baseUrl: 'https://app-api.pixverse.ai', console: 'https://platform.pixverse.ai' }],
		credentials: [{ id: 'apiKey', label: 'API Key' }]
	});

	const frames = ['frames', 'Frames', 'optional', 'optional', [0, 0], [0, 0], 'none'];
	const references = ['reference', 'References', 'none', 'none', [0, 10], [0, 2], 'none'];
	const extend = ['extend', 'Extend', 'none', 'none', [0, 0], [0, 0], 'required'];
	assert.deepEqual(provider.models.map(model => ({
		id: model.id,
		label: model.label,
		sentAs: model.providerModels,
		prompt: model.prompt,
		modes: model.modes.map(mode => [mode.id, mode.label, mode.inputs.startFrame, mode.inputs.endFrame, [mode.inputs.images.min, mode.inputs.images.max], [mode.inputs.videos.min, mode.inputs.videos.max], mode.inputs.source]),
		deprecated: model.deprecated
	})), [
		{ id: 'pixverse-c1', label: 'PixVerse C1', sentAs: { global: 'c1' }, prompt: { required: 'always', maxLength: 5000 }, modes: [frames], deprecated: undefined },
		{ id: 'pixverse-v6', label: 'PixVerse V6', sentAs: { global: 'v6' }, prompt: { required: 'always', maxLength: 5000 }, modes: [frames, references, extend], deprecated: undefined },
		{ id: 'pixverse-v5.6', label: 'PixVerse V5.6', sentAs: { global: 'v5.6' }, prompt: { required: 'always', maxLength: 5000 }, modes: [frames], deprecated: undefined },
		{ id: 'pixverse-v5', label: 'PixVerse V5', sentAs: { global: 'v5' }, prompt: { required: 'always', maxLength: 5000 }, modes: [frames], deprecated: undefined }
	]);

	// Images of every format the upload takes, within its size; reference videos and the source within Fusion's and Video Extend's limits; no audio.
	const images = { imageMaxSide: 10000, imageMaxBytes: 20 * 1024 * 1024 };
	const limits = Object.fromEntries(provider.models.map(model => [model.id, Object.fromEntries(model.modes.map(mode => [mode.id, mode.limits]))]));
	assert.deepEqual(limits, {
		'pixverse-c1': { frames: images },
		'pixverse-v6': { frames: images, reference: { ...images, videoTotalSeconds: 15 }, extend: { videoTotalSeconds: 30, videoMaxBytes: 50 * 1024 * 1024 } },
		'pixverse-v5.6': { frames: images },
		'pixverse-v5': { frames: images }
	});
	assert.ok(provider.models.every(model => model.modes.every(mode => mode.inputs.audios.max === 0)));

	const settings = (model: CatalogModel) => model.parameters.map(parameter => {
		const flags = [parameter.modes ?? 'all', parameter.advanced === true ? 'More' : '', parameter.optional === true ? 'optional' : ''];
		switch (parameter.kind) {
			case 'choice': return [parameter.name, parameter.label, parameter.options.map(option => option.label), parameter.default, ...flags];
			case 'integer': return [parameter.name, parameter.label, parameter.min, parameter.max, parameter.step, parameter.unit, parameter.default, ...flags];
			default: return [parameter.name, parameter.label, parameter.kind, parameter.default, ...flags];
		}
	});
	const resolution = ['resolution', 'Resolution', ['360p', '540p', '720p', '1080p'], '720p', 'all', '', ''];
	const wide = ['16:9', '9:16', '4:3', '3:4', '1:1', '2:3', '3:2', '21:9'];
	const narrow = ['16:9', '9:16', '4:3', '3:4', '1:1'];
	const seed = ['seed', 'Seed', 0, 2147483647, 1, undefined, undefined, 'all', 'More', 'optional'];
	const notExtend = ['frames', 'reference'];
	assert.deepEqual(Object.fromEntries(provider.models.map(model => [model.id, settings(model)])), {
		'pixverse-c1': [
			resolution,
			['ratio', 'Ratio', wide, '16:9', 'all', '', ''],
			['duration', 'Duration', 1, 15, 1, 'seconds', 5, 'all', '', ''],
			['sound', 'Sound', 'boolean', false, 'all', '', ''],
			seed
		],
		'pixverse-v6': [
			resolution,
			['ratio', 'Ratio', wide, '16:9', notExtend, '', ''],
			['duration', 'Duration', 1, 15, 1, 'seconds', 5, 'all', '', ''],
			['sound', 'Sound', 'boolean', false, notExtend, '', ''],
			['generate_multi_clip_switch', 'Multi-clip', 'boolean', false, ['frames'], '', ''],
			seed
		],
		'pixverse-v5.6': [
			resolution,
			['ratio', 'Ratio', narrow, '16:9', 'all', '', ''],
			['duration', 'Duration', 5, 10, 1, 'seconds', 5, 'all', '', ''],
			['sound', 'Sound', 'boolean', false, 'all', '', ''],
			seed
		],
		'pixverse-v5': [
			resolution,
			['ratio', 'Ratio', narrow, '16:9', 'all', '', ''],
			['duration', 'Duration', 5, 8, 3, 'seconds', 5, 'all', '', ''],
			seed
		]
	});
	const parameters = provider.models.flatMap(model => model.parameters);
	assert.ok(parameters.filter(parameter => parameter.name === 'ratio').every(parameter => parameter.kind === 'choice' && parameter.display === 'ratio' && parameter.tooltip?.includes('start frame')));
	assert.ok(provider.models.find(model => model.id === 'pixverse-v6')?.parameters.find(parameter => parameter.name === 'duration')?.tooltip?.includes('reference videos'));
	assert.ok(PROVIDER_MODULES.includes(PIXVERSE), 'AI Video ships the PixVerse module');
	assert.ok(buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'pixverse'));
});

// --- creating a task ----------------------------------------------------------------------------

test('each mode of each model uploads its inputs, then is created once at its endpoint with the exact body, the key, and a new trace id on every request', async () => {
	const cases: readonly { model: string; mode: Mode; params: Record<string, unknown>; inputs?: Inputs; sent: () => unknown[] }[] = [
		{
			model: 'pixverse-c1', mode: 'frames', params: { resolution: '1080p', ratio: '21:9', duration: 12, sound: true, seed: 42 },
			sent: () => [create('text', { model: 'c1', prompt: PROMPT, duration: 12, quality: '1080p', aspect_ratio: '21:9', seed: 42, generate_audio_switch: true })]
		},
		{
			// A start frame sets the shape: Image-to-Video takes no ratio.
			model: 'pixverse-c1', mode: 'frames', params: { ratio: '1:1' }, inputs: { startFrame: START },
			sent: () => [startUpload(), create('img', { model: 'c1', prompt: PROMPT, duration: 5, quality: '720p', img_id: 101, generate_audio_switch: false })]
		},
		{
			model: 'pixverse-c1', mode: 'frames', params: { resolution: '360p', duration: 15 }, inputs: { startFrame: START, endFrame: END },
			sent: () => [startUpload(), endUpload(), create('transition', { model: 'c1', prompt: PROMPT, duration: 15, quality: '360p', first_frame_img: 101, last_frame_img: 102, generate_audio_switch: false })]
		},
		{
			model: 'pixverse-v6', mode: 'frames', params: { ratio: '9:16', generate_multi_clip_switch: true },
			sent: () => [create('text', { model: 'v6', prompt: PROMPT, duration: 5, quality: '720p', aspect_ratio: '9:16', generate_audio_switch: false, generate_multi_clip_switch: true })]
		},
		{
			model: 'pixverse-v6', mode: 'frames', params: { sound: true, seed: 0 }, inputs: { startFrame: START },
			sent: () => [startUpload(), create('img', { model: 'v6', prompt: PROMPT, duration: 5, quality: '720p', img_id: 101, seed: 0, generate_audio_switch: true, generate_multi_clip_switch: false })]
		},
		{
			// First and Last Frame Video takes no multi-clip.
			model: 'pixverse-v6', mode: 'frames', params: { resolution: '540p', duration: 1 }, inputs: { startFrame: START, endFrame: END },
			sent: () => [startUpload(), endUpload(), create('transition', { model: 'v6', prompt: PROMPT, duration: 1, quality: '540p', first_frame_img: 101, last_frame_img: 102, generate_audio_switch: false })]
		},
		{
			model: 'pixverse-v6', mode: 'reference', params: { ratio: '3:2', duration: 9 }, inputs: { images: REFERENCES },
			sent: () => [
				imageUpload(REFERENCES[0], 'reference-image-1.png', 'image/png'),
				imageUpload(REFERENCES[1], 'reference-image-2.jpg', 'image/jpeg'),
				imageUpload(REFERENCES[2], 'reference-image-3.webp', 'image/webp'),
				create('fusion', { model: 'v6', prompt: PROMPT, duration: 9, quality: '720p', aspect_ratio: '3:2', image_references: [{ img_id: 101, ref_name: 'image1' }, { img_id: 102, ref_name: 'image2' }, { img_id: 103, ref_name: 'image3' }], generate_audio_switch: false })
			]
		},
		{
			// With reference videos: the Omni mode, and the duration follows the longest video.
			model: 'pixverse-v6', mode: 'reference', params: { resolution: '1080p', duration: 9, sound: true }, inputs: { images: REFERENCES.slice(0, 2), videos: CLIPS },
			sent: () => [
				imageUpload(REFERENCES[0], 'reference-image-1.png', 'image/png'),
				imageUpload(REFERENCES[1], 'reference-image-2.jpg', 'image/jpeg'),
				mediaUpload(CLIPS[0], 'reference-video-1.mp4', 'video/mp4'),
				mediaUpload(CLIPS[1], 'reference-video-2.mov', 'video/quicktime'),
				create('fusion', {
					model: 'v6', prompt: PROMPT, duration: 0, quality: '1080p', aspect_ratio: '16:9',
					image_references: [{ img_id: 101, ref_name: 'image1' }, { img_id: 102, ref_name: 'image2' }],
					video_references: [{ video_media_id: 201, ref_name: 'video1' }, { video_media_id: 202, ref_name: 'video2' }],
					reference_mode: 'omni',
					generate_audio_switch: true
				})
			]
		},
		{
			model: 'pixverse-v6', mode: 'reference', params: { ratio: '21:9' }, inputs: { videos: CLIPS.slice(0, 1) },
			sent: () => [
				mediaUpload(CLIPS[0], 'reference-video-1.mp4', 'video/mp4'),
				create('fusion', { model: 'v6', prompt: PROMPT, duration: 0, quality: '720p', aspect_ratio: '21:9', video_references: [{ video_media_id: 201, ref_name: 'video1' }], reference_mode: 'omni', generate_audio_switch: false })
			]
		},
		{
			// The 30-second source leaves room for 10 seconds: 12 are fitted to them (D70).
			model: 'pixverse-v6', mode: 'extend', params: { resolution: '1080p', duration: 12 }, inputs: { source: LONG_SOURCE },
			sent: () => [mediaUpload(LONG_SOURCE, 'source-video.mp4', 'video/mp4'), create('extend', { model: 'v6', prompt: PROMPT, duration: 10, quality: '1080p', video_media_id: 201 })]
		},
		{
			// Video Extend takes neither a ratio nor a sound setting.
			model: 'pixverse-v6', mode: 'extend', params: { resolution: '1080p', duration: 7, seed: 2147483647 }, inputs: { source: SOURCE },
			sent: () => [mediaUpload(SOURCE, 'source-video.mp4', 'video/mp4'), create('extend', { model: 'v6', prompt: PROMPT, duration: 7, quality: '1080p', video_media_id: 201, seed: 2147483647 })]
		},
		{
			model: 'pixverse-v5.6', mode: 'frames', params: { ratio: '4:3', duration: 10, sound: true },
			sent: () => [create('text', { model: 'v5.6', prompt: PROMPT, duration: 10, quality: '720p', aspect_ratio: '4:3', generate_audio_switch: true })]
		},
		{
			model: 'pixverse-v5.6', mode: 'frames', params: { resolution: '1080p', duration: 8 }, inputs: { startFrame: START, endFrame: END },
			sent: () => [startUpload(), endUpload(), create('transition', { model: 'v5.6', prompt: PROMPT, duration: 8, quality: '1080p', first_frame_img: 101, last_frame_img: 102, generate_audio_switch: false })]
		},
		{
			// V5 makes no sound.
			model: 'pixverse-v5', mode: 'frames', params: { resolution: '1080p', ratio: '1:1', duration: 8 },
			sent: () => [create('text', { model: 'v5', prompt: PROMPT, duration: 8, quality: '1080p', aspect_ratio: '1:1' })]
		},
		{
			model: 'pixverse-v5', mode: 'frames', params: {}, inputs: { startFrame: START },
			sent: () => [startUpload(), create('img', { model: 'v5', prompt: PROMPT, duration: 5, quality: '720p', img_id: 101 })]
		}
	];
	const traceIds: string[] = [];
	const outcomes = [];
	for (const entry of cases) {
		const server = await pixverse();
		try {
			const answer = await commands().submit(generation(server.url, entry.model, entry.mode, entry.params, entry.inputs));
			traceIds.push(...server.received.map(request => String(request.headers['ai-trace-id'])));
			outcomes.push({ model: entry.model, answer, sent: server.received.map(sent) });
		} finally {
			await server.close();
		}
	}
	assert.deepEqual(outcomes, cases.map(entry => ({ model: entry.model, answer: { ok: true, value: { remoteId: '301' } }, sent: entry.sent() })));
	assert.ok(traceIds.every(id => UUID_V4.test(id)), 'every request carries a UUID v4 trace id');
	assert.equal(new Set(traceIds).size, traceIds.length, 'no trace id is sent twice');
});

test('an endpoint with a path, such as a relay\'s, keeps it, and an endpoint that ends with /openapi/v2 gets no second one', async () => {
	const server = await pixverse((request, response) => {
		if (request.method === 'GET') {
			sendJson(response, 200, ok({ id: 301, status: 5 }));
			return true;
		}
		return false;
	});
	try {
		const providers = commands();
		const relay = `${server.url}/relay/pixverse/`;
		const submitted = value(await providers.submit(generation(relay, 'pixverse-v6', 'frames', {}, { startFrame: START })));
		const polled = value(await providers.poll(taskRef(relay, submitted.remoteId)));
		const versioned = `${server.url}/openapi/v2`;
		const direct = value(await providers.submit(generation(versioned, 'pixverse-c1', 'frames', {})));
		const directPoll = value(await providers.poll(taskRef(versioned, direct.remoteId)));
		assert.deepEqual({ submitted, polled, direct, directPoll, sent: server.received.map(request => [request.method, request.path, request.headers['api-key']]) }, {
			submitted: { remoteId: '301' },
			polled: { state: 'running' },
			direct: { remoteId: '302' },
			directPoll: { state: 'running' },
			sent: [
				['POST', '/relay/pixverse/openapi/v2/image/upload', KEY],
				['POST', '/relay/pixverse/openapi/v2/video/img/generate', KEY],
				['GET', '/relay/pixverse/openapi/v2/video/result/301', KEY],
				['POST', '/openapi/v2/video/text/generate', KEY],
				['GET', '/openapi/v2/video/result/302', KEY]
			]
		});
	} finally {
		await server.close();
	}
});

test('ids of 64 bits keep every digit, from an upload\'s answer into the create and from the create into the task id', async () => {
	const raw = (response: ServerResponse, text: string) => {
		const bytes = Buffer.from(text, 'utf8');
		response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength) });
		response.end(bytes);
	};
	const server = await pixverse((request, response) => {
		const path = apiPath(request);
		if (path === '/image/upload') {
			raw(response, '{"ErrCode":0,"ErrMsg":"Success","Resp":{"img_id":9007199254740993,"img_url":"https://media.example/a.png"}}');
		} else if (path === '/media/upload') {
			raw(response, '{"ErrCode":0,"ErrMsg":"Success","Resp":{"media_id":18446744073709551615,"media_type":"video","url":"https://media.example/b.mp4","width":1280,"height":720}}');
		} else if (request.method === 'POST') {
			raw(response, '{"ErrCode":0,"ErrMsg":"Success","Resp":{"video_id":1234567890123456789,"credits":45}}');
		} else {
			raw(response, '{"ErrCode":0,"ErrMsg":"Success","Resp":{"id":1234567890123456789,"status":5}}');
		}
		return true;
	});
	try {
		const providers = commands();
		const frame = value(await providers.submit(generation(server.url, 'pixverse-v6', 'frames', {}, { startFrame: START })));
		const extended = value(await providers.submit(generation(server.url, 'pixverse-v6', 'extend', {}, { source: SOURCE })));
		const polled = value(await providers.poll(taskRef(server.url, frame.remoteId)));
		const creates = server.received.filter(request => request.path.endsWith('/generate')).map(request => request.body.toString('utf8'));
		assert.deepEqual({ frame, extended, polled, poll: server.received[server.received.length - 1].path }, {
			frame: { remoteId: '1234567890123456789' },
			extended: { remoteId: '1234567890123456789' },
			polled: { state: 'running' },
			poll: '/openapi/v2/video/result/1234567890123456789'
		});
		assert.match(creates[0], /"img_id":9007199254740993[,}]/);
		assert.match(creates[1], /"video_media_id":18446744073709551615[,}]/);
	} finally {
		await server.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome, and it was sent once, after its uploads', async () => {
	const server = await pixverse((request, response) => {
		if (request.path.endsWith('/generate')) {
			response.socket?.destroy();
			return true;
		}
		return false;
	});
	try {
		const failed = error(await commands().submit(generation(server.url, 'pixverse-v6', 'reference', {}, { images: REFERENCES.slice(0, 1), videos: CLIPS.slice(0, 1) })));
		assert.deepEqual({ code: failed.code, sent: server.received.map(request => apiPath(request)) }, {
			code: 'unknownOutcome',
			sent: ['/image/upload', '/media/upload', '/video/fusion/generate']
		});
	} finally {
		await server.close();
	}
});

// --- errors -------------------------------------------------------------------------------------

test('a refused key answers auth for a create and for a poll, and no message carries the key or a trace id', async () => {
	const server = await startServer((request, response) => sendJson(response, 401, { ErrCode: 10005, ErrMsg: `API key is not registered (trace ${request.headers['ai-trace-id']})` }));
	try {
		const providers = commands();
		const submitted = error(await providers.submit(generation(server.url, 'pixverse-v6', 'frames', {})));
		const polled = error(await providers.poll(taskRef(server.url, '301')));
		const message = 'PixVerse does not know the API key. Check it in Providers; it is a key of the PixVerse API Platform. (10005: API key is not registered (trace ***))';
		assert.deepEqual({ submitted, polled, sent: server.received.length }, {
			submitted: { code: 'auth', message, status: 401 },
			polled: { code: 'auth', message, status: 401 },
			sent: 2
		});
		assert.ok(!JSON.stringify([submitted, polled]).includes(KEY));
	} finally {
		await server.close();
	}
});

test('PixVerse\'s codes, mostly sent with HTTP 200, answer as they mean, and each create is sent once', async () => {
	const replies: readonly [number, unknown][] = [
		[200, { ErrCode: 10004, ErrMsg: 'API key is missing' }],
		[200, { ErrCode: 10005, ErrMsg: 'API key is not registered' }],
		[200, { ErrCode: 400012, ErrMsg: 'invalid account' }],
		[200, { ErrCode: 500090, ErrMsg: 'insufficient balance' }],
		[200, { ErrCode: 712008, ErrMsg: 'rate limit' }],
		[200, { ErrCode: 500044, ErrMsg: 'concurrency limit' }],
		[200, { ErrCode: 400017, ErrMsg: 'Invalid value for model.' }],
		[200, { ErrCode: 500054, ErrMsg: 'content moderation failed' }],
		[200, { ErrCode: 500020, ErrMsg: 'permission denied' }],
		[200, { ErrCode: 500008, ErrMsg: 'not found' }],
		[200, { ErrCode: 500069, ErrMsg: 'service busy' }],
		[200, { ErrCode: 99999, ErrMsg: 'unknown' }],
		[200, { ErrCode: 777777, ErrMsg: 'something new' }],
		[200, ok({ credits: 45 })],
		[429, { ErrCode: 712008, ErrMsg: 'rate limit' }],
		[400, { ErrCode: 400013, ErrMsg: 'json binding' }],
		[403, { ErrCode: 500020, ErrMsg: 'permission denied' }],
		[500, { ErrCode: 400017, ErrMsg: 'Invalid parameter' }],
		[503, { ErrCode: 500069, ErrMsg: 'service busy' }],
		[200, ok({ video_id: 318, credits: 45 })]
	];
	let next = 0;
	const server = await startServer((request, response) => {
		const [status, body] = replies[next++];
		sendJson(response, status, body);
	});
	try {
		const providers = commands();
		const outcomes = [];
		for (let index = 0; index < replies.length; index++) {
			const answer = await providers.submit(generation(server.url, 'pixverse-c1', 'frames', {}));
			outcomes.push(answer.ok ? answer.value : [answer.error.code, answer.error.status]);
		}
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: [
				['auth', undefined],
				['auth', undefined],
				['auth', undefined],
				['balance', undefined],
				['rateLimited', undefined],
				['rateLimited', undefined],
				['rejected', undefined],
				['rejected', undefined],
				['rejected', undefined],
				['rejected', undefined],
				['unknownOutcome', undefined],
				['unknownOutcome', undefined],
				['unknownOutcome', undefined],
				['unknownOutcome', undefined],
				['rateLimited', 429],
				['rejected', 400],
				['rejected', 403],
				['unknownOutcome', 500],
				['unknownOutcome', 503],
				{ remoteId: '318' }
			],
			sent: replies.length
		});
	} finally {
		await server.close();
	}
});

test('the messages of PixVerse\'s codes say what happened, with the code and PixVerse\'s words', async () => {
	const replies: readonly unknown[] = [
		{ ErrCode: 500090, ErrMsg: 'insufficient balance' },
		{ ErrCode: 712008, ErrMsg: 'rate limit' },
		{ ErrCode: 500044 },
		{ ErrCode: 777777, ErrMsg: 'something new' }
	];
	let next = 0;
	const server = await startServer((request, response) => sendJson(response, 200, replies[next++]));
	try {
		const providers = commands();
		const messages = [];
		for (let index = 0; index < replies.length; index++) {
			messages.push(error(await providers.submit(generation(server.url, 'pixverse-v5', 'frames', {}))).message);
		}
		assert.deepEqual(messages, [
			'The PixVerse account has too few credits. Add credits in the PixVerse API Platform. (500090: insufficient balance)',
			'PixVerse received too many requests from this account or address. Wait a moment. (712008: rate limit)',
			'PixVerse is already running as many tasks as the account may run at once. Wait for one to finish. (500044)',
			'PixVerse: something new (777777)'
		]);
	} finally {
		await server.close();
	}
});

test('a refused or unreadable upload ends the submit before the create; a retried upload and a retried poll get new trace ids', async () => {
	let imageUploads = 0;
	let polls = 0;
	const server = await pixverse((request, response) => {
		const path = apiPath(request);
		if (request.path.startsWith('/format/') && path === '/image/upload') {
			sendJson(response, 200, { ErrCode: 500032, ErrMsg: 'unsupported image format' });
		} else if (request.path.startsWith('/limit/') && path === '/media/upload') {
			sendJson(response, 200, { ErrCode: 712008, ErrMsg: 'rate limit' });
		} else if (request.path.startsWith('/page/') && path === '/image/upload') {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end('<html>maintenance</html>');
		} else if (request.path.startsWith('/key/') && path === '/image/upload') {
			sendJson(response, 401, { ErrCode: 10005, ErrMsg: 'API key is not registered' });
		} else if (request.path.startsWith('/busy/') && path === '/image/upload' && imageUploads++ === 0) {
			sendJson(response, 503, { ErrCode: 500069, ErrMsg: 'service busy' });
		} else if (request.path.startsWith('/busy/') && request.method === 'GET' && polls++ === 0) {
			sendJson(response, 502, { ErrMsg: 'bad gateway' });
		} else if (request.path.startsWith('/busy/') && request.method === 'GET') {
			sendJson(response, 200, ok({ id: 301, status: 5 }));
		} else {
			return false;
		}
		return true;
	});
	try {
		const providers = commands();
		const submit = async (prefix: string, model: string, mode: Mode, inputs: Inputs) => providers.submit(generation(`${server.url}${prefix}`, model, mode, {}, inputs));
		const format = error(await submit('/format/', 'pixverse-v6', 'frames', { startFrame: START }));
		const limit = error(await submit('/limit/', 'pixverse-v6', 'reference', { images: REFERENCES.slice(0, 1), videos: CLIPS.slice(0, 1) }));
		const page = error(await submit('/page/', 'pixverse-c1', 'frames', { startFrame: START }));
		const key = error(await submit('/key/', 'pixverse-c1', 'frames', { startFrame: START }));
		const busy = value(await submit('/busy/', 'pixverse-c1', 'frames', { startFrame: START }));
		const polled = value(await providers.poll(taskRef(`${server.url}/busy/`, busy.remoteId)));
		const paths = (prefix: string) => server.received.filter(request => request.path.startsWith(prefix)).map(request => `${request.method} ${apiPath(request)}`);
		const traces = (prefix: string) => server.received.filter(request => request.path.startsWith(prefix)).map(request => String(request.headers['ai-trace-id']));
		assert.deepEqual({
			format,
			limit,
			page,
			key,
			busy,
			polled,
			sent: { format: paths('/format/'), limit: paths('/limit/'), page: paths('/page/'), key: paths('/key/'), busy: paths('/busy/') }
		}, {
			format: { code: 'rejected', message: 'The start frame start.png could not be uploaded to PixVerse: PixVerse does not take the format of an image. (500032: unsupported image format)' },
			limit: { code: 'rateLimited', message: 'Reference video 1 clip.mp4 could not be uploaded to PixVerse: PixVerse received too many requests from this account or address. Wait a moment. (712008: rate limit)' },
			page: { code: 'rejected', message: 'The start frame start.png could not be uploaded to PixVerse: PixVerse answered the upload in a form AI Video cannot read.' },
			key: { code: 'auth', message: 'The start frame start.png could not be uploaded to PixVerse: PixVerse does not know the API key. Check it in Providers; it is a key of the PixVerse API Platform. (10005: API key is not registered)', status: 401 },
			busy: { remoteId: '301' },
			polled: { state: 'running' },
			sent: {
				format: ['POST /image/upload'],
				limit: ['POST /image/upload', 'POST /media/upload'],
				page: ['POST /image/upload'],
				key: ['POST /image/upload'],
				busy: ['POST /image/upload', 'POST /image/upload', 'POST /video/img/generate', 'GET /video/result/301', 'GET /video/result/301']
			}
		});
		const busyTraces = traces('/busy/');
		assert.equal(new Set(busyTraces).size, busyTraces.length, 'each attempt has its own trace id');
	} finally {
		await server.close();
	}
});

// --- asking about a task ------------------------------------------------------------------------

test('asking about a task maps 5, 1, 7, and 8, waits for the address of a completed task, and reads no other answer', async () => {
	const tasks: Readonly<Record<string, unknown>> = {
		'501': { id: 501, status: 5, url: '', outputWidth: 0, outputHeight: 0 },
		'502': { id: 502, status: 1, url: 'https://media.pixverse.ai/openapi/502.mp4', outputWidth: 1280, outputHeight: 720, has_audio: false, credits: 45 },
		'503': { id: 503, status: 1, url: '' },
		'504': { id: 504, status: 7, url: '' },
		'505': { id: 505, status: 8, url: '' },
		'506': { id: 506, status: 6 }
	};
	const server = await startServer((request, response) => {
		const id = request.path.split('/').pop() ?? '';
		if (id === '508') {
			sendJson(response, 200, ok(null));
		} else if (id === '509') {
			sendJson(response, 404, { ErrMsg: 'not found' });
		} else if (tasks[id]) {
			sendJson(response, 200, ok(tasks[id]));
		} else {
			sendJson(response, 200, { ErrCode: 500008, ErrMsg: 'Requested data not found', Resp: null });
		}
	});
	try {
		const providers = commands();
		const states = [];
		for (const id of ['501', '502', '503', '504', '505']) {
			states.push(value(await providers.poll(taskRef(server.url, id))));
		}
		const others = [];
		for (const id of ['506', '507', '508', '509']) {
			others.push(error(await providers.poll(taskRef(server.url, id))).code);
		}
		const first = server.received[0];
		assert.deepEqual({
			states,
			others,
			asked: { method: first.method, path: first.path, key: first.headers['api-key'], type: first.headers['content-type'], body: first.body.byteLength }
		}, {
			states: [
				{ state: 'running' },
				{ state: 'succeeded', videoUrl: 'https://media.pixverse.ai/openapi/502.mp4' },
				{ state: 'running' },
				{ state: 'failed', message: 'PixVerse\'s content moderation refused the video. Change the prompt or the inputs.' },
				{ state: 'failed', message: 'PixVerse reports that the video could not be generated.' }
			],
			others: ['invalidResponse', 'notFound', 'invalidResponse', 'notFound'],
			asked: { method: 'GET', path: '/openapi/v2/video/result/501', key: KEY, type: undefined, body: 0 }
		});
		assert.ok(server.received.every(request => UUID_V4.test(String(request.headers['ai-trace-id']))));
	} finally {
		await server.close();
	}
});

test('the video downloads from the media host without the key, from the poll\'s address or from the task asked about again', async () => {
	const video = isoMedia(5);
	const media = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength) });
		response.end(video);
	});
	const api = await startServer((request, response) => sendJson(response, 200, ok({ id: 309, status: 1, url: `${media.url}/openapi/output/309.mp4` })));
	try {
		const providers = commands();
		const ref = taskRef(api.url, '309');
		const polled = value(await providers.poll(ref));
		const first = join(folder, 'first.mp4.part');
		const second = join(folder, 'second.mp4.part');
		const withAddress = value(await providers.download({ ...ref, videoUrl: polled.state === 'succeeded' ? polled.videoUrl : undefined, targetFsPath: first }));
		const withoutAddress = value(await providers.download({ ...ref, targetFsPath: second }));
		assert.deepEqual({
			withAddress,
			withoutAddress,
			same: [readFileSync(first).equals(video), readFileSync(second).equals(video)],
			asked: api.received.map(request => request.path),
			downloaded: media.received.map(request => [request.path, request.headers['api-key'], request.headers['ai-trace-id']])
		}, {
			withAddress: { size: video.byteLength, format: 'mp4' },
			withoutAddress: { size: video.byteLength, format: 'mp4' },
			same: [true, true],
			asked: ['/openapi/v2/video/result/309', '/openapi/v2/video/result/309'],
			downloaded: [['/openapi/output/309.mp4', undefined, undefined], ['/openapi/output/309.mp4', undefined, undefined]]
		});
	} finally {
		await api.close();
		await media.close();
	}
});

test('PixVerse has no cancellation: cancel answers false and sends nothing', async () => {
	const server = await startServer((request, response) => sendJson(response, 200, ok({})));
	try {
		const answer = value(await commands().cancel(taskRef(server.url, '301')));
		assert.deepEqual({ answer, sent: server.received.length }, { answer: { cancelled: false }, sent: 0 });
	} finally {
		await server.close();
	}
});

// --- checks -------------------------------------------------------------------------------------

test('check reports the rules between settings and inputs that the declarations cannot express, and the declarations\' own', async () => {
	const providers = commands();
	const problems = async (model: string, mode: Mode, params: Record<string, unknown>, inputs: PlannedMedia, text = PROMPT) =>
		value(await providers.check({ provider: 'pixverse', region: 'global', model, mode, params, prompt: text, inputs })).problems;
	const long = 'a'.repeat(2049);
	assert.deepEqual({
		v56Six: await problems('pixverse-v5.6', 'frames', { duration: 6 }, plannedFiles()),
		v56Ten: await problems('pixverse-v5.6', 'frames', { duration: 10 }, plannedFiles()),
		v56TenAt1080p: await problems('pixverse-v5.6', 'frames', { duration: 10, resolution: '1080p' }, plannedFiles()),
		v56EightAt1080p: await problems('pixverse-v5.6', 'frames', { duration: 8, resolution: '1080p' }, plannedFiles({ startFrame: true })),
		v5Six: await problems('pixverse-v5', 'frames', { duration: 6 }, plannedFiles()),
		v5EightAt1080p: await problems('pixverse-v5', 'frames', { duration: 8, resolution: '1080p' }, plannedFiles()),
		longPromptWithFrame: await problems('pixverse-c1', 'frames', {}, plannedFiles({ startFrame: true }), long),
		longPromptWithFrames: await problems('pixverse-c1', 'frames', {}, plannedFiles({ startFrame: true, endFrame: true }), long),
		longPromptFromText: await problems('pixverse-c1', 'frames', {}, plannedFiles(), long),
		multiClipWithEndFrame: await problems('pixverse-v6', 'frames', { generate_multi_clip_switch: true }, plannedFiles({ startFrame: true, endFrame: true })),
		multiClipWithStartFrame: await problems('pixverse-v6', 'frames', { generate_multi_clip_switch: true }, plannedFiles({ startFrame: true })),
		noReferences: await problems('pixverse-v6', 'reference', {}, plannedFiles()),
		eightImages: await problems('pixverse-v6', 'reference', {}, plannedFiles({ images: 8 })),
		eightImagesAndAVideo: await problems('pixverse-v6', 'reference', {}, plannedFiles({ images: 8, videos: 1 })),
		elevenImages: await problems('pixverse-v6', 'reference', {}, plannedFiles({ images: 11, videos: 1 })),
		threeVideos: await problems('pixverse-v6', 'reference', {}, plannedFiles({ videos: 3 })),
		noPrompt: await problems('pixverse-v6', 'frames', {}, plannedFiles({ startFrame: true }), ' '),
		soundInExtend: await problems('pixverse-v6', 'extend', { sound: true }, plannedFiles({ source: true })),
		noSource: await problems('pixverse-v6', 'extend', {}, plannedFiles()),
		v5WideRatio: await problems('pixverse-v5', 'frames', { ratio: '2:3' }, plannedFiles()),
		c1WideRatio: await problems('pixverse-c1', 'frames', { ratio: '2:3' }, plannedFiles()),
		c1NoReferences: await problems('pixverse-c1', 'reference', {}, plannedFiles({ images: 1 }))
	}, {
		v56Six: ['PixVerse V5.6 makes videos of 5, 8, or 10 seconds.'],
		v56Ten: [],
		v56TenAt1080p: ['At 1080p, PixVerse V5.6 makes videos of 5 or 8 seconds.'],
		v56EightAt1080p: [],
		v5Six: ['Duration must be a step of 3 from 5.'],
		v5EightAt1080p: [],
		longPromptWithFrame: ['The prompt is 2049 characters long; with a start frame and no end frame, PixVerse C1 takes at most 2048.'],
		longPromptWithFrames: [],
		longPromptFromText: [],
		multiClipWithEndFrame: ['PixVerse V6 makes multiple clips only without an end frame. Turn Multi-clip off, or leave out the end frame.'],
		multiClipWithStartFrame: [],
		noReferences: ['PixVerse V6 in References mode needs at least one reference image or video.'],
		eightImages: ['Without a reference video, PixVerse V6 takes at most 7 reference images; 8 are planned.'],
		eightImagesAndAVideo: [],
		elevenImages: ['PixVerse V6 in References mode takes at most 10 reference images; 11 are planned.'],
		threeVideos: ['PixVerse V6 in References mode takes at most 2 reference videos; 3 are planned.'],
		noPrompt: ['Write a prompt: PixVerse V6 needs one.'],
		soundInExtend: ['Sound does not apply in Extend mode.'],
		noSource: ['PixVerse V6 in Extend mode needs a video to work on.'],
		v5WideRatio: ['Ratio cannot be 2:3 for PixVerse V5; choose 16:9, 9:16, 4:3, 3:4, 1:1.'],
		c1WideRatio: [],
		c1NoReferences: ['PixVerse C1 has no reference mode.']
	});
});

test('check refuses what PixVerse cannot take, and submit then uploads and sends nothing', async () => {
	const server = await pixverse();
	try {
		const providers = commands();
		const wide = file('wide.png', png(10_001, 2), 'image/png');
		const long = [file('nine.mp4', isoMedia(9), 'video/mp4'), file('seven.mp4', isoMedia(7), 'video/mp4')];
		const thirty = file('thirty.mp4', isoMedia(30), 'video/mp4');
		const thirtyOne = file('thirty-one.mp4', isoMedia(31), 'video/mp4');
		const forty = file('forty.mp4', isoMedia(39.5), 'video/mp4');
		const webm = file('clip.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]), 'video/webm');
		// Every input measured from a table: a reference video larger than AI Video uploads.
		const facts: Readonly<Record<string, MediaFacts>> = {
			'one.png': { bytes: 1000, format: 'png', width: 400, height: 400 },
			'clip.mp4': { bytes: 130 * 1024 * 1024, format: 'mp4', seconds: 6 }
		};
		const measured = commands({ inspector: () => ({ inspect: async media => facts[((media as { readonly fsPath?: string }).fsPath ?? '').split('/').pop() ?? ''] }) });
		const withFiles = async (model: string, mode: Mode, params: Record<string, unknown>, inputs: Inputs, checker = providers) =>
			value(await checker.check(generation(server.url, model, mode, params, inputs))).problems;
		const outcomes = {
			wideImage: await withFiles('pixverse-v6', 'frames', {}, { startFrame: wide }),
			everyFormat: await withFiles('pixverse-v6', 'reference', {}, { images: REFERENCES }),
			longVideos: await withFiles('pixverse-v6', 'reference', {}, { videos: long }),
			unreadableVideo: await withFiles('pixverse-v6', 'reference', {}, { videos: [webm] }),
			longSource: await withFiles('pixverse-v6', 'extend', {}, { source: thirtyOne }),
			extendedTooFar: await withFiles('pixverse-v6', 'extend', { duration: 11 }, { source: thirty }),
			extendedTooFarLimits: value(await providers.check(generation(server.url, 'pixverse-v6', 'extend', { duration: 11 }, { source: thirty }))).limits,
			extendedToForty: await withFiles('pixverse-v6', 'extend', { duration: 10 }, { source: thirty }),
			noRoom: await withFiles('pixverse-v6', 'extend', { duration: 5 }, { source: forty }),
			largeVideo: await withFiles('pixverse-v6', 'reference', {}, { images: REFERENCES.slice(0, 1), videos: CLIPS.slice(0, 1) }, measured),
			submitted: error(await providers.submit(generation(server.url, 'pixverse-v6', 'extend', { duration: 5 }, { source: thirtyOne }))),
			ruleSubmitted: error(await providers.submit(generation(server.url, 'pixverse-v5.6', 'frames', { duration: 10, resolution: '1080p' }, { startFrame: START })))
		};
		assert.deepEqual({ outcomes, sent: server.received.length }, {
			outcomes: {
				wideImage: ['The start frame wide.png is 10001 × 2 px; each side must be at most 10000 px.'],
				everyFormat: [],
				longVideos: ['The videos are 16 seconds long together; at most 15 seconds are allowed.'],
				unreadableVideo: ['Reference video 1 clip.webm is not a video whose length AI Video can read (MP4 or MOV).'],
				longSource: ['The videos are 31 seconds long together; at most 30 seconds are allowed.'],
				// Fitted to the room the source leaves (D70).
				extendedTooFar: [],
				extendedTooFarLimits: { duration: { max: 10, reason: 'The source video lasts 30 seconds, and PixVerse makes at most 40 seconds in all.' } },
				extendedToForty: [],
				// No duration fits: the source alone is nearly 40 seconds, and longer than a source may be.
				noRoom: [
					'The videos are 39.5 seconds long together; at most 30 seconds are allowed.',
					'The source video lasts 39.5 seconds, and PixVerse makes at most 40 seconds in all, which leaves no room to extend it. Choose a shorter source video.'
				],
				largeVideo: ['Reference video 1 clip.mp4 is 130 MiB; AI Video uploads at most 127.9 MiB in one request.'],
				submitted: { code: 'rejected', message: 'The videos are 31 seconds long together; at most 30 seconds are allowed.' },
				ruleSubmitted: { code: 'rejected', message: 'At 1080p, PixVerse V5.6 makes videos of 5 or 8 seconds.' }
			},
			sent: 0
		});
	} finally {
		await server.close();
	}
});
