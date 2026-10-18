/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Alibaba (Wan) provider module (docs/specs/video-providers/alibaba.md)
 * through the provider commands, against a local server that answers like
 * DashScope and a second one that answers like the OSS host of its
 * temporary upload. Nothing here talks to Alibaba Cloud.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { alibabaModule } from '../src/providers/alibaba.ts';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../src/providers/commands.ts';
import { describeBytes, type MediaInspector } from '../src/providers/media.ts';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { Estimate, Media } from '../src/providers/types.ts';
import { error, gifHeader, isoMedia, png, recordingSleep, sendJson, startServer, value, wav, type Received, type TestServer } from './providerTestKit.ts';

const KEY = 'sk-alibaba-local-test-1';
const OSS_ACCESS_KEY = 'LTAI-local-upload';
const UPLOAD_DIR = 'dashscope-instant/acct/2026-10-19/abcd';

const folder = mkdtempSync(join(tmpdir(), 'basehalf-alibaba-'));
test.after(() => rmSync(folder, { recursive: true, force: true }));

function file(name: string, bytes: Buffer): string {
	const path = join(folder, name);
	writeFileSync(path, bytes);
	return path;
}

const START = file('start.png', png(640, 360));
const END = file('end.png', png(360, 640));
const PORTRAIT = file('portrait.png', png(600, 800));
const CLIP = file('clip.mp4', isoMedia(4));
const LONG_CLIP = file('long.mp4', isoMedia(12));
const VOICE = file('voice.wav', wav(3));
const GIF = file('moving.gif', gifHeader(640, 360));
const M4A = file('voice.m4a', isoMedia(3, { brand: 'M4A ' }));

const image = (fsPath: string): Media => ({ fsPath, mimeType: 'image/png' });
const video = (fsPath: string): Media => ({ fsPath, mimeType: 'video/mp4' });
const audio = (fsPath: string): Media => ({ fsPath, mimeType: 'audio/wav' });
const dataUrl = (fsPath: string) => `data:image/png;base64,${readFileSync(fsPath).toString('base64')}`;

function commands(options: VideoProviderCommandOptions = {}): VideoProviderCommands {
	return new VideoProviderCommands([alibabaModule], { ...options, http: { sleep: async () => undefined, ...options.http } });
}

type Inputs = { startFrame?: Media; endFrame?: Media; images?: Media[]; videos?: Media[]; audios?: Media[]; source?: Media };

function submitRequest(endpoint: string, model: string, mode: string, params: Record<string, unknown>, prompt: string, inputs: Inputs = {}, region = 'cn') {
	return {
		provider: 'alibaba',
		region,
		endpoint,
		credentials: { apiKey: KEY },
		model,
		mode,
		params,
		prompt,
		inputs: { images: [], videos: [], audios: [], ...inputs }
	};
}

type Counts = { readonly startFrame: boolean; readonly endFrame: boolean; readonly images: number; readonly videos: number; readonly audios: number; readonly source: boolean };

/** The planned inputs counted, for a check without files. */
function counted(change: Partial<Counts> = {}): Counts {
	return { startFrame: false, endFrame: false, images: 0, videos: 0, audios: 0, source: false, ...change };
}

/** A check of planned files, or of counts made by `counted`. */
function checkRequest(model: string, mode: string, params: Record<string, unknown>, prompt: string, inputs: Inputs | Counts, region = 'cn') {
	const planned = typeof (inputs as Counts).startFrame === 'boolean' ? inputs : { images: [], videos: [], audios: [], ...inputs };
	return { provider: 'alibaba', region, model, mode, params, prompt, inputs: planned };
}

// --- a provider that answers like DashScope ------------------------------------------------------

interface Provider {
	readonly api: TestServer;
	readonly oss: TestServer;
	/** The state each task id answers, `PENDING` unless set. */
	readonly tasks: Map<string, Record<string, unknown>>;
	close(): Promise<void>;
}

type Handler = (request: Received, response: ServerResponse, socket: Socket) => boolean;

/**
 * DashScope on one server and its OSS upload host on another, so the two have
 * different origins. A handler answers first when it returns true.
 */
async function startProvider(handlers: { api?: Handler; oss?: Handler } = {}): Promise<Provider> {
	const tasks = new Map<string, Record<string, unknown>>();
	let created = 0;
	const oss = await startServer((request, response, socket) => {
		if (handlers.oss?.(request, response, socket)) {
			return;
		}
		response.writeHead(200, { 'Content-Length': '0' });
		response.end();
	});
	const api = await startServer((request, response, socket) => {
		if (handlers.api?.(request, response, socket)) {
			return;
		}
		const url = new URL(request.path, 'http://local');
		if (request.method === 'GET' && url.pathname === '/api/v1/uploads') {
			sendJson(response, 200, {
				request_id: 'policy-request',
				data: {
					policy: 'eyJleHBpcmF0aW9uIjoiMjAyNi0xMC0xOVQwMDowMDowMFoifQ==',
					signature: 'c2lnbmF0dXJl',
					upload_dir: UPLOAD_DIR,
					upload_host: oss.url,
					expire_in_seconds: 300,
					max_file_size_mb: 100,
					capacity_limit_mb: 999999999,
					oss_access_key_id: OSS_ACCESS_KEY,
					x_oss_object_acl: 'private',
					x_oss_forbid_overwrite: 'true'
				}
			});
			return;
		}
		if (request.method === 'POST' && url.pathname === '/api/v1/services/aigc/video-generation/video-synthesis') {
			created++;
			sendJson(response, 200, { output: { task_status: 'PENDING', task_id: `task-${created}` }, request_id: `create-${created}` });
			return;
		}
		const task = /^\/api\/v1\/tasks\/([^/]+)(\/cancel)?$/.exec(url.pathname);
		if (task && request.method === 'GET' && !task[2]) {
			sendJson(response, 200, { request_id: 'query', output: { task_id: decodeURIComponent(task[1]), ...(tasks.get(decodeURIComponent(task[1])) ?? { task_status: 'PENDING' }) } });
			return;
		}
		if (task && request.method === 'POST' && task[2]) {
			const state = tasks.get(decodeURIComponent(task[1]))?.task_status ?? 'PENDING';
			if (state === 'PENDING') {
				tasks.set(decodeURIComponent(task[1]), { task_status: 'CANCELED' });
				sendJson(response, 200, 'cancel-request-id');
			} else {
				sendJson(response, 400, { code: 'UnsupportedOperation', message: 'Failed to cancel the task. Confirm that the task is in PENDING status.', request_id: 'cancel' });
			}
			return;
		}
		sendJson(response, 404, { code: 'NotFound', message: 'Not found!' });
	});
	return { api, oss, tasks, close: async () => { await api.close(); await oss.close(); } };
}

function creates(provider: Provider): Received[] {
	return provider.api.received.filter(request => request.path.endsWith('/video-synthesis'));
}

function bodyOf(request: Received): unknown {
	return JSON.parse(request.body.toString('utf8'));
}

/** The fields of a multipart form in order, a file field by its file name, type, and size. */
function formFields(request: Received): [string, string][] {
	const boundary = /boundary=(.+)$/.exec(String(request.headers['content-type']))?.[1];
	assert.ok(boundary, 'a multipart form');
	const fields: [string, string][] = [];
	for (const part of request.body.toString('latin1').split(`--${boundary}`).slice(1, -1)) {
		const [head, ...rest] = part.split('\r\n\r\n');
		const content = rest.join('\r\n\r\n').replace(/\r\n$/, '');
		const name = /name="([^"]+)"/.exec(head)?.[1] ?? '';
		const fileName = /filename="([^"]+)"/.exec(head)?.[1];
		const type = /Content-Type: (\S+)/i.exec(head)?.[1];
		fields.push([name, fileName ? `${fileName} ${type} ${Buffer.from(content, 'latin1').byteLength}` : content]);
	}
	return fields;
}

/** The `key` of each upload the OSS host received, in order. */
function uploadedKeys(provider: Provider): string[] {
	return provider.oss.received.map(request => formFields(request).find(([name]) => name === 'key')?.[1] ?? '');
}

// --- the catalog -------------------------------------------------------------------------------------

test('the provider is shipped with two regions, one key, and its fifteen models', () => {
	assert.ok(PROVIDER_MODULES.includes(alibabaModule));
	const provider = buildCatalog([alibabaModule]).providers[0];
	assert.deepEqual({
		id: provider.id,
		label: provider.label,
		regions: provider.regions.map(region => [region.id, region.baseUrl, region.currency]),
		credentials: provider.credentials.map(credential => credential.id),
		models: provider.models.map(model => [model.id, Object.keys(model.providerModels).join('+'), model.modes.map(mode => mode.id).join('+')])
	}, {
		id: 'alibaba',
		label: 'Alibaba (Wan)',
		regions: [['cn', 'https://dashscope.aliyuncs.com', 'CNY'], ['intl', 'https://dashscope-intl.aliyuncs.com', 'USD']],
		credentials: ['apiKey'],
		models: [
			['wan3.0-video', 'cn+intl', 'frames+reference+edit+extend'],
			['wan3.0-video-prime', 'cn+intl', 'frames+reference+edit+extend'],
			['happyhorse-1.1-t2v', 'cn+intl', 'frames'],
			['happyhorse-1.1-i2v', 'cn+intl', 'frames'],
			['happyhorse-1.1-r2v', 'cn+intl', 'reference'],
			['wan2.7-t2v', 'cn+intl', 'frames'],
			['wan2.7-i2v', 'cn+intl', 'frames+extend'],
			['wan2.7-r2v', 'cn+intl', 'reference'],
			['wan2.7-videoedit', 'cn', 'edit'],
			['wan2.6-t2v', 'cn+intl', 'frames'],
			['wan2.6-i2v', 'cn+intl', 'frames'],
			['wan2.6-i2v-flash', 'cn+intl', 'frames'],
			['happyhorse-1.0-t2v', 'cn+intl', 'frames'],
			['happyhorse-1.0-i2v', 'cn+intl', 'frames'],
			['happyhorse-1.0-r2v', 'cn+intl', 'reference']
		]
	});
	const parameters = (id: string) => provider.models.find(model => model.id === id)!.parameters;
	const wan3 = parameters('wan3.0-video');
	assert.deepEqual(wan3.map(parameter => [parameter.name, parameter.default ?? null, parameter.modes?.join('+') ?? 'all']), [
		['resolution', '1080P', 'all'],
		['ratio', 'adaptive', 'frames+reference'],
		['duration', 5, 'frames+reference'],
		['audio', true, 'all'],
		['prompt_extend', true, 'all'],
		['watermark', false, 'all'],
		['seed', null, 'all']
	]);
	const choices = (id: string, name: string) => {
		const parameter = parameters(id).find(entry => entry.name === name);
		return parameter?.kind === 'choice' ? parameter.options.map(option => option.value) : undefined;
	};
	assert.deepEqual({
		hh11: choices('happyhorse-1.1-t2v', 'resolution'),
		hh10: choices('happyhorse-1.0-r2v', 'resolution'),
		hhRatio: choices('happyhorse-1.1-r2v', 'ratio'),
		wan3Ratio: choices('wan3.0-video-prime', 'ratio'),
		wan26Size: choices('wan2.6-t2v', 'size'),
		hhWatermark: parameters('happyhorse-1.0-t2v').find(entry => entry.name === 'watermark')?.default
	}, {
		hh11: ['480P', '720P', '1080P'],
		hh10: ['720P', '1080P'],
		hhRatio: ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'],
		wan3Ratio: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
		wan26Size: ['1280*720', '720*1280', '960*960', '1088*832', '832*1088', '1920*1080', '1080*1920', '1440*1440', '1632*1248', '1248*1632'],
		hhWatermark: true
	});
});

// --- creating tasks ------------------------------------------------------------------------------------

test('a create sends each family its own input and parameters, with the key and X-DashScope-Async, once', async () => {
	const provider = await startProvider();
	try {
		const providers = commands();
		const api = provider.api.url;
		// A bare origin and one that already ends in /api/v1 both reach /api/v1/... once.
		const cases: [string, ReturnType<typeof submitRequest>, unknown][] = [
			['wan3 text', submitRequest(api, 'wan3.0-video', 'frames', {}, 'A kite over the sea.'), {
				model: 'wan3.0-video',
				input: { prompt: 'A kite over the sea.' },
				parameters: { resolution: '1080P', ratio: 'adaptive', duration: 5, audio: true, prompt_extend: true, watermark: false }
			}],
			['wan3 frames', submitRequest(`${api}/api/v1`, 'wan3.0-video-prime', 'frames', { resolution: '480P', ratio: '16:9', duration: -1, audio: false, seed: 7 }, '', { startFrame: image(START), endFrame: image(END) }, 'intl'), {
				model: 'wan3.0-video-prime',
				input: { media: [{ type: 'first_frame', url: dataUrl(START) }, { type: 'last_frame', url: dataUrl(END) }] },
				parameters: { resolution: '480P', ratio: '16:9', duration: -1, audio: false, prompt_extend: true, watermark: false, seed: 7 }
			}],
			['wan2.7 text', submitRequest(api, 'wan2.7-t2v', 'frames', { resolution: '720P', ratio: '9:16', duration: 12, negative_prompt: 'blur', watermark: true }, 'Rain on a window.', {}, 'intl'), {
				model: 'wan2.7-t2v',
				input: { prompt: 'Rain on a window.', negative_prompt: 'blur' },
				parameters: { resolution: '720P', ratio: '9:16', duration: 12, prompt_extend: true, watermark: true }
			}],
			['wan2.7 frames', submitRequest(api, 'wan2.7-i2v', 'frames', { negative_prompt: '  ', prompt_extend: false }, 'The door opens.', { startFrame: image(START), endFrame: image(END) }), {
				model: 'wan2.7-i2v',
				input: { prompt: 'The door opens.', media: [{ type: 'first_frame', url: dataUrl(START) }, { type: 'last_frame', url: dataUrl(END) }] },
				parameters: { resolution: '1080P', duration: 5, prompt_extend: false, watermark: false }
			}],
			['wan2.6 text', submitRequest(api, 'wan2.6-t2v', 'frames', { size: '832*1088', duration: 3, shot_type: 'multi' }, 'A city wakes up.'), {
				model: 'wan2.6-t2v',
				input: { prompt: 'A city wakes up.' },
				parameters: { size: '832*1088', duration: 3, shot_type: 'multi', prompt_extend: true, watermark: false }
			}],
			['wan2.6 flash', submitRequest(api, 'wan2.6-i2v-flash', 'frames', { resolution: '720P', audio: false }, '', { startFrame: image(START) }, 'intl'), {
				model: 'wan2.6-i2v-flash',
				input: { img_url: dataUrl(START) },
				parameters: { resolution: '720P', duration: 5, shot_type: 'single', audio: false, prompt_extend: true, watermark: false }
			}],
			['wan2.6 frames', submitRequest(api, 'wan2.6-i2v', 'frames', { negative_prompt: 'text', seed: 0 }, 'Leaves fall.', { startFrame: image(END) }), {
				model: 'wan2.6-i2v',
				input: { prompt: 'Leaves fall.', negative_prompt: 'text', img_url: dataUrl(END) },
				parameters: { resolution: '1080P', duration: 5, shot_type: 'single', prompt_extend: true, watermark: false, seed: 0 }
			}],
			['happyhorse text', submitRequest(api, 'happyhorse-1.1-t2v', 'frames', { resolution: '480P', ratio: '21:9', duration: 15 }, 'A horse in the snow.'), {
				model: 'happyhorse-1.1-t2v',
				input: { prompt: 'A horse in the snow.' },
				parameters: { resolution: '480P', ratio: '21:9', duration: 15, watermark: true }
			}],
			['happyhorse frames', submitRequest(api, 'happyhorse-1.0-i2v', 'frames', { watermark: false }, '', { startFrame: image(START) }, 'intl'), {
				model: 'happyhorse-1.0-i2v',
				input: { media: [{ type: 'first_frame', url: dataUrl(START) }] },
				parameters: { resolution: '1080P', duration: 5, watermark: false }
			}],
			['happyhorse references', submitRequest(api, 'happyhorse-1.0-r2v', 'reference', { resolution: '720P', ratio: '4:5' }, '[Image 1] meets [Image 2].', { images: [image(PORTRAIT), image(PORTRAIT)] }), {
				model: 'happyhorse-1.0-r2v',
				input: { prompt: '[Image 1] meets [Image 2].', media: [{ type: 'reference_image', url: dataUrl(PORTRAIT) }, { type: 'reference_image', url: dataUrl(PORTRAIT) }] },
				parameters: { resolution: '720P', ratio: '4:5', duration: 5, watermark: true }
			}]
		];
		const ids: string[] = [];
		for (const [, request] of cases) {
			ids.push(value(await providers.submit(request)).remoteId);
		}
		const sent = creates(provider);
		assert.deepEqual({
			ids,
			paths: [...new Set(sent.map(request => request.path))],
			bodies: sent.map(bodyOf),
			headers: [...new Set(sent.map(request => `${request.headers.authorization} | ${request.headers['x-dashscope-async']} | ${request.headers['content-type']} | ${request.headers['x-dashscope-ossresourceresolve'] ?? 'no oss'}`))],
			uploads: provider.oss.received.length,
			others: provider.api.received.length - sent.length
		}, {
			ids: cases.map((_, index) => `task-${index + 1}`),
			paths: ['/api/v1/services/aigc/video-generation/video-synthesis'],
			bodies: cases.map(([, , body]) => body),
			headers: [`Bearer ${KEY} | enable | application/json | no oss`],
			uploads: 0,
			others: 0
		});
	} finally {
		await provider.close();
	}
});

test('in China, videos and audio go through the temporary upload, without the key, and the create resolves their oss:// addresses', async () => {
	const provider = await startProvider();
	try {
		const providers = commands();
		const api = provider.api.url;
		const requests = [
			submitRequest(api, 'wan3.0-video', 'reference', { resolution: '720P', ratio: '16:9', duration: 6 }, 'Image 1 dances to Audio 1 like Video 1.', { images: [image(PORTRAIT)], videos: [video(CLIP)], audios: [audio(VOICE)] }),
			submitRequest(api, 'wan3.0-video', 'edit', {}, 'Make Video 1 clay, with the hat of Image 1.', { source: video(CLIP), images: [image(START)] }),
			submitRequest(api, 'wan3.0-video-prime', 'extend', { resolution: '480P' }, 'Extend Video 1 backward.', { source: video(CLIP) }),
			submitRequest(api, 'wan2.7-i2v', 'extend', { duration: 9 }, 'The car drives on.', { source: video(CLIP) }),
			submitRequest(api, 'wan2.7-r2v', 'reference', { ratio: '1:1' }, 'Image 1 talks to Video 1.', { images: [image(PORTRAIT)], videos: [video(CLIP)] }),
			submitRequest(api, 'wan2.7-videoedit', 'edit', { audio_setting: 'origin' }, 'Change the coat to red.', { source: video(CLIP), images: [image(PORTRAIT)] }),
			submitRequest(api, 'wan2.7-videoedit', 'edit', { ratio: '4:3', duration: 3 }, '', { source: video(CLIP) })
		];
		for (const request of requests) {
			value(await providers.submit(request));
		}
		const keys = uploadedKeys(provider);
		const oss = (index: number) => `oss://${keys[index]}`;
		const sent = creates(provider);
		const policies = provider.api.received.filter(request => request.path.startsWith('/api/v1/uploads'));
		assert.deepEqual({
			bodies: sent.map(bodyOf),
			ossHeader: sent.map(request => request.headers['x-dashscope-ossresourceresolve']),
			policies: policies.map(request => `${request.path} ${request.headers.authorization} ${request.headers['content-type']}`),
			keys: keys.map(key => /^dashscope-instant\/acct\/2026-10-19\/abcd\/[0-9a-f-]{36}\.(mp4|wav)$/.test(key)),
			unique: new Set(keys).size,
			uploadKeySent: provider.oss.received.map(request => request.headers.authorization ?? 'no key'),
			firstForm: formFields(provider.oss.received[0]).map(([name, content]) => name === 'key' ? [name, 'the key'] : [name, content.replace(/^[0-9a-f-]{36}/, 'NAME')])
		}, {
			bodies: [
				{
					model: 'wan3.0-video',
					input: { prompt: 'Image 1 dances to Audio 1 like Video 1.', media: [{ type: 'reference_image', url: dataUrl(PORTRAIT) }, { type: 'reference_video', url: oss(0) }, { type: 'reference_audio', url: oss(1) }] },
					parameters: { resolution: '720P', ratio: '16:9', duration: 6, audio: true, prompt_extend: true, watermark: false }
				},
				{
					model: 'wan3.0-video',
					input: { prompt: 'Make Video 1 clay, with the hat of Image 1.', media: [{ type: 'reference_video', url: oss(2) }, { type: 'reference_image', url: dataUrl(START) }] },
					parameters: { resolution: '1080P', audio: true, prompt_extend: true, watermark: false, ratio: 'adaptive', duration: -1 }
				},
				{
					model: 'wan3.0-video-prime',
					input: { prompt: 'Extend Video 1 backward.', media: [{ type: 'reference_video', url: oss(3) }] },
					parameters: { resolution: '480P', audio: true, prompt_extend: true, watermark: false, ratio: 'adaptive', duration: -1 }
				},
				{
					model: 'wan2.7-i2v',
					input: { prompt: 'The car drives on.', media: [{ type: 'first_clip', url: oss(4) }] },
					parameters: { resolution: '1080P', duration: 9, prompt_extend: true, watermark: false }
				},
				{
					model: 'wan2.7-r2v',
					input: { prompt: 'Image 1 talks to Video 1.', media: [{ type: 'reference_image', url: dataUrl(PORTRAIT) }, { type: 'reference_video', url: oss(5) }] },
					parameters: { resolution: '1080P', ratio: '1:1', duration: 5, prompt_extend: true, watermark: false }
				},
				{
					// Whole Video (0) is left out, as the provider documents.
					model: 'wan2.7-videoedit',
					input: { prompt: 'Change the coat to red.', media: [{ type: 'video', url: oss(6) }, { type: 'reference_image', url: dataUrl(PORTRAIT) }] },
					parameters: { resolution: '1080P', audio_setting: 'origin', prompt_extend: true, watermark: false }
				},
				{
					model: 'wan2.7-videoedit',
					input: { media: [{ type: 'video', url: oss(7) }] },
					parameters: { resolution: '1080P', ratio: '4:3', duration: 3, audio_setting: 'auto', prompt_extend: true, watermark: false }
				}
			],
			ossHeader: requests.map(() => 'enable'),
			policies: [
				'wan3.0-video', 'wan3.0-video', 'wan3.0-video', 'wan3.0-video-prime', 'wan2.7-i2v', 'wan2.7-r2v', 'wan2.7-videoedit', 'wan2.7-videoedit'
			].map(model => `/api/v1/uploads?action=getPolicy&model=${model} Bearer ${KEY} application/json`),
			keys: keys.map(() => true),
			unique: 8,
			uploadKeySent: keys.map(() => 'no key'),
			firstForm: [
				['OSSAccessKeyId', OSS_ACCESS_KEY],
				['Signature', 'c2lnbmF0dXJl'],
				['policy', 'eyJleHBpcmF0aW9uIjoiMjAyNi0xMC0xOVQwMDowMDowMFoifQ=='],
				['x-oss-object-acl', 'private'],
				['x-oss-forbid-overwrite', 'true'],
				['key', 'the key'],
				['success_action_status', '200'],
				['file', `NAME.mp4 video/mp4 ${readFileSync(CLIP).byteLength}`]
			]
		});
		assert.equal(formFields(provider.oss.received[1]).at(-1)?.[1].replace(/^[0-9a-f-]{36}/, 'NAME'), `NAME.wav audio/wav ${readFileSync(VOICE).byteLength}`);
	} finally {
		await provider.close();
	}
});

test('an upload that is refused, too large, or retried after its answer was lost ends before or reaches the create as it should', async () => {
	let dropFirst = true;
	let expired = false;
	let smallLimit = false;
	const provider = await startProvider({
		oss(request, response, socket) {
			if (expired) {
				const xml = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Invalid according to Policy: Policy expired.</Message></Error>';
				response.writeHead(403, { 'Content-Type': 'application/xml', 'Content-Length': String(Buffer.byteLength(xml)) });
				response.end(xml);
				return true;
			}
			if (dropFirst) {
				// The file arrived, the answer is lost: the retry finds its own copy.
				dropFirst = false;
				socket.destroy();
				return true;
			}
			if (provider.oss.received.length === 2) {
				const xml = '<Error><Code>FileAlreadyExists</Code><Message>The object you specified already exists and can not be overwritten.</Message></Error>';
				response.writeHead(409, { 'Content-Type': 'application/xml', 'Content-Length': String(Buffer.byteLength(xml)) });
				response.end(xml);
				return true;
			}
			return false;
		},
		api(request, response) {
			if (smallLimit && request.path.startsWith('/api/v1/uploads')) {
				// 4 KiB, less than the clip.
				sendJson(response, 200, { data: { policy: 'p', signature: 's', upload_dir: UPLOAD_DIR, upload_host: provider.oss.url, oss_access_key_id: 'a', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true', max_file_size_mb: 0.00390625 } });
				return true;
			}
			return false;
		}
	});
	try {
		const sleep = recordingSleep();
		const providers = commands({ http: { sleep: sleep.sleep } });
		const request = submitRequest(provider.api.url, 'wan2.7-i2v', 'extend', {}, 'On.', { source: video(CLIP) });
		const retried = value(await providers.submit(request));
		const retriedKeys = uploadedKeys(provider);
		expired = true;
		const refused = error(await providers.submit(request));
		expired = false;
		smallLimit = true;
		const tooLarge = error(await providers.submit(request));
		assert.deepEqual({ retried, sameKey: retriedKeys[0] === retriedKeys[1], waits: sleep.waits, refused, tooLarge, creates: creates(provider).length, uploads: provider.oss.received.length }, {
			retried: { remoteId: 'task-1' },
			sameKey: true,
			waits: [1000],
			refused: { code: 'rejected', message: 'Alibaba Cloud\'s temporary storage refused the source video clip.mp4 (HTTP 403, AccessDenied): Invalid according to Policy: Policy expired.', status: 403 },
			tooLarge: { code: 'rejected', message: `The source video clip.mp4 is ${describeBytes(readFileSync(CLIP).byteLength)}; Alibaba Cloud's temporary storage takes at most 4 KiB for this model.` },
			creates: 1,
			uploads: 3
		});
	} finally {
		await provider.close();
	}
});

test('a create whose connection drops after it was sent has an unknown outcome and is sent once', async () => {
	const provider = await startProvider({
		api(request, response, socket) {
			if (request.path.endsWith('/video-synthesis')) {
				socket.destroy();
				return true;
			}
			return false;
		}
	});
	try {
		const failure = error(await commands().submit(submitRequest(provider.api.url, 'wan2.7-t2v', 'frames', {}, 'A lighthouse at night.')));
		assert.deepEqual({ code: failure.code, sent: creates(provider).length }, { code: 'unknownOutcome', sent: 1 });
	} finally {
		await provider.close();
	}
});

test('refused keys, too many requests, an empty balance, and an unreadable answer are told apart, and a create is never sent twice', async () => {
	let answer: [number, unknown] = [401, { code: 'InvalidApiKey', message: 'Invalid API-key provided.', request_id: 'r' }];
	const provider = await startProvider({
		api(request, response) {
			if (request.path.endsWith('/video-synthesis') || request.path.startsWith('/api/v1/tasks/')) {
				sendJson(response, answer[0], answer[1]);
				return true;
			}
			return false;
		}
	});
	try {
		const sleep = recordingSleep();
		const providers = commands({ http: { sleep: sleep.sleep } });
		const create = () => providers.submit(submitRequest(provider.api.url, 'happyhorse-1.1-t2v', 'frames', {}, 'A field.'));
		const ref = { provider: 'alibaba', region: 'cn', endpoint: provider.api.url, credentials: { apiKey: KEY }, model: 'happyhorse-1.1-t2v', remoteId: 'task-9' };
		const outcomes: Record<string, unknown> = {};
		outcomes.badKey = error(await create());
		outcomes.badKeyPoll = error(await providers.poll(ref)).code;
		answer = [429, { code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded, please try again later.', request_id: 'r' }];
		outcomes.throttled = error(await create());
		const createsSoFar = creates(provider).length;
		outcomes.throttledPoll = error(await providers.poll(ref)).code;
		answer = [400, { code: 'Arrearage', message: 'Access denied, please make sure your account is in good standing.', request_id: 'r' }];
		outcomes.arrearage = error(await create()).code;
		answer = [429, { code: 'PrepaidBillOverdue', message: 'The prepaid bill is overdue.', request_id: 'r' }];
		outcomes.overdue = error(await create()).code;
		answer = [429, { code: 'CommodityNotPurchased', message: 'Commodity has not purchased yet.', request_id: 'r' }];
		outcomes.notPurchased = error(await create()).code;
		answer = [400, { code: 'InvalidParameter', message: 'The size does not match.', request_id: 'r' }];
		outcomes.invalid = error(await create());
		answer = [500, { code: 'InternalError', message: 'An internal error has occured.', request_id: 'r' }];
		outcomes.serverError = error(await create()).code;
		answer = [200, { request_id: 'r', output: { task_status: 'PENDING' } }];
		outcomes.noTaskId = error(await create()).code;
		assert.deepEqual({ ...outcomes, createsSoFar, creates: creates(provider).length, waits: sleep.waits }, {
			badKey: { code: 'auth', message: 'Invalid API-key provided. (InvalidApiKey)', status: 401 },
			badKeyPoll: 'auth',
			throttled: { code: 'rateLimited', message: 'Requests rate limit exceeded, please try again later. (Throttling.RateQuota) Alibaba Cloud takes at most 5 requests a second and runs at most 5 tasks at once for each video model.', status: 429 },
			createsSoFar: 2,
			throttledPoll: 'rateLimited',
			arrearage: 'balance',
			overdue: 'balance',
			notPurchased: 'rejected',
			invalid: { code: 'rejected', message: 'The size does not match. (InvalidParameter)', status: 400 },
			serverError: 'unknownOutcome',
			noTaskId: 'unknownOutcome',
			creates: 8,
			// Only the poll is retried: three times, 1, 2, then 4 seconds apart.
			waits: [1000, 2000, 4000]
		});
	} finally {
		await provider.close();
	}
});

// --- following a task -----------------------------------------------------------------------------------

test('a poll maps every task state, and the video is downloaded from its own host without the key', async () => {
	const mp4 = isoMedia(5);
	const cdn = await startServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4.byteLength) });
		response.end(mp4);
	});
	const provider = await startProvider();
	try {
		const providers = commands();
		const ref = (remoteId: string) => ({ provider: 'alibaba', region: 'intl', endpoint: provider.api.url, credentials: { apiKey: KEY }, model: 'wan3.0-video', remoteId });
		provider.tasks.set('t-run', { task_status: 'RUNNING', submit_time: '2026-10-19 10:00:00.000' });
		provider.tasks.set('t-done', { task_status: 'SUCCEEDED', video_url: `${cdn.url}/result/video.mp4?Expires=1` });
		provider.tasks.set('t-done-later', { task_status: 'SUCCEEDED' });
		provider.tasks.set('t-failed', { task_status: 'FAILED', code: 'InvalidParameter', message: 'The two modes are mutually exclusive.' });
		provider.tasks.set('t-quiet-failure', { task_status: 'FAILED' });
		provider.tasks.set('t-cancelled', { task_status: 'CANCELED' });
		provider.tasks.set('t-expired', { task_status: 'UNKNOWN' });
		provider.tasks.set('t-odd', { task_status: 'SLEEPING' });
		const states = {
			pending: value(await providers.poll(ref('t-new'))),
			running: value(await providers.poll(ref('t-run'))),
			succeeded: value(await providers.poll(ref('t-done'))),
			succeededWithout: value(await providers.poll(ref('t-done-later'))),
			failed: value(await providers.poll(ref('t-failed'))),
			quietFailure: value(await providers.poll(ref('t-quiet-failure'))),
			cancelled: value(await providers.poll(ref('t-cancelled'))),
			expired: error(await providers.poll(ref('t-expired'))),
			odd: error(await providers.poll(ref('t-odd'))).code
		};
		const target = join(folder, 'result.mp4.part');
		const downloaded = value(await providers.download({ ...ref('t-done'), videoUrl: `${cdn.url}/result/video.mp4?Expires=1`, targetFsPath: target }));
		const withoutAddress = error(await providers.download({ ...ref('t-done-later'), targetFsPath: join(folder, 'later.mp4.part') }));
		provider.tasks.set('t-done-later', { task_status: 'SUCCEEDED', video_url: `${cdn.url}/result/later.mp4` });
		const askedAgain = value(await providers.download({ ...ref('t-done-later'), targetFsPath: join(folder, 'later.mp4.part') }));
		assert.deepEqual({
			states,
			downloaded,
			same: readFileSync(target).equals(mp4),
			withoutAddress,
			askedAgain,
			cdnKey: cdn.received.map(request => request.headers.authorization ?? 'no key'),
			queried: provider.api.received.filter(request => request.method === 'GET').map(request => request.path).slice(0, 2)
		}, {
			states: {
				pending: { state: 'pending' },
				running: { state: 'running' },
				succeeded: { state: 'succeeded', videoUrl: `${cdn.url}/result/video.mp4?Expires=1` },
				succeededWithout: { state: 'succeeded' },
				failed: { state: 'failed', message: 'The two modes are mutually exclusive. (InvalidParameter)' },
				quietFailure: { state: 'failed', message: 'Alibaba Cloud reports that the task failed.' },
				cancelled: { state: 'cancelled', message: 'Alibaba Cloud reports that the task was cancelled.' },
				expired: { code: 'notFound', message: 'Alibaba Cloud does not know this task: it does not exist, or it is older than 24 hours.' },
				odd: 'invalidResponse'
			},
			downloaded: { size: mp4.byteLength },
			same: true,
			withoutAddress: { code: 'invalidResponse', message: 'Alibaba Cloud gave no video address for this task.' },
			askedAgain: { size: mp4.byteLength },
			cdnKey: ['no key', 'no key'],
			queried: ['/api/v1/tasks/t-new', '/api/v1/tasks/t-run']
		});
	} finally {
		await provider.close();
		await cdn.close();
	}
});

test('a pending task is cancelled; a running one is not, and a cancellation is sent once', async () => {
	const provider = await startProvider();
	try {
		const providers = commands();
		const ref = (remoteId: string) => ({ provider: 'alibaba', region: 'cn', endpoint: `${provider.api.url}/api/v1`, credentials: { apiKey: KEY }, model: 'wan2.7-t2v', remoteId });
		provider.tasks.set('t-running', { task_status: 'RUNNING' });
		const pending = value(await providers.cancel(ref('t-pending')));
		const afterwards = value(await providers.poll(ref('t-pending')));
		const running = value(await providers.cancel(ref('t-running')));
		const cancels = provider.api.received.filter(request => request.path.endsWith('/cancel'));
		assert.deepEqual({ pending, afterwards, running, cancels: cancels.map(request => `${request.method} ${request.path} ${request.headers.authorization}`) }, {
			pending: { cancelled: true },
			afterwards: { state: 'cancelled', message: 'Alibaba Cloud reports that the task was cancelled.' },
			running: { cancelled: false },
			cancels: [`POST /api/v1/tasks/t-pending/cancel Bearer ${KEY}`, `POST /api/v1/tasks/t-running/cancel Bearer ${KEY}`]
		});
	} finally {
		await provider.close();
	}
});

// --- check -----------------------------------------------------------------------------------------------

test('check refuses what Alibaba Cloud cannot take: videos and audio outside China, and the rules between settings and inputs', async () => {
	const providers = commands();
	const problems = async (request: ReturnType<typeof checkRequest>) => value(await providers.check(request)).problems;
	const results = {
		intlReference: await problems(checkRequest('wan3.0-video', 'reference', {}, 'p', counted({ images: 1, videos: 1, audios: 1 }), 'intl')),
		intlAudio: await problems(checkRequest('wan3.0-video', 'reference', {}, 'p', counted({ audios: 1 }), 'intl')),
		intlImages: await problems(checkRequest('wan3.0-video', 'reference', {}, 'p', counted({ images: 3 }), 'intl')),
		intlEdit: await problems(checkRequest('wan3.0-video-prime', 'edit', {}, 'p', counted({ source: true }), 'intl')),
		intlExtend: await problems(checkRequest('wan2.7-i2v', 'extend', {}, 'p', counted({ source: true }), 'intl')),
		intlVideoEdit: await problems(checkRequest('wan2.7-videoedit', 'edit', {}, 'p', counted({ source: true }), 'intl')),
		chinaReference: await problems(checkRequest('wan3.0-video', 'reference', {}, 'p', counted({ images: 1, videos: 1, audios: 1 }))),
		r2vNothing: await problems(checkRequest('wan2.7-r2v', 'reference', {}, 'p', counted())),
		r2vTooMany: await problems(checkRequest('wan2.7-r2v', 'reference', {}, 'p', counted({ images: 3, videos: 3 }))),
		r2vLongWithVideo: await problems(checkRequest('wan2.7-r2v', 'reference', { duration: 12 }, 'p', counted({ videos: 1 }))),
		r2vLongWithImages: await problems(checkRequest('wan2.7-r2v', 'reference', { duration: 15 }, 'p', counted({ images: 2 }))),
		shotsWithoutRewriting: await problems(checkRequest('wan2.6-i2v', 'frames', { shot_type: 'multi', prompt_extend: false }, '', counted({ startFrame: true }))),
		shotsWithRewriting: await problems(checkRequest('wan2.6-t2v', 'frames', { shot_type: 'multi' }, 'p', counted())),
		chineseTooLong: await problems(checkRequest('happyhorse-1.1-t2v', 'frames', {}, '马'.repeat(2501), counted())),
		chineseLongest: await problems(checkRequest('happyhorse-1.1-t2v', 'frames', {}, '马'.repeat(2500), counted())),
		latinTooLong: await problems(checkRequest('happyhorse-1.0-r2v', 'reference', {}, 'a'.repeat(5001), counted({ images: 1 })))
	};
	assert.deepEqual(results, {
		intlReference: ['Alibaba Cloud takes videos and audio only as addresses, and the temporary upload BaseHalf sends them through works in China (Beijing) only. Choose China (Beijing) in Video Providers, or leave out the videos and audio.'],
		intlAudio: ['Alibaba Cloud takes videos and audio only as addresses, and the temporary upload BaseHalf sends them through works in China (Beijing) only. Choose China (Beijing) in Video Providers, or leave out the audio.'],
		intlImages: [],
		intlEdit: ['Wan 3.0 Prime in Edit mode sends a video. Alibaba Cloud takes videos and audio only as addresses, and the temporary upload BaseHalf sends them through works in China (Beijing) only. Choose China (Beijing) in Video Providers.'],
		intlExtend: ['Wan 2.7 Image to Video in Extend mode sends a video. Alibaba Cloud takes videos and audio only as addresses, and the temporary upload BaseHalf sends them through works in China (Beijing) only. Choose China (Beijing) in Video Providers.'],
		intlVideoEdit: ['Alibaba (Wan) does not offer Wan 2.7 Video Edit in International (Singapore).'],
		chinaReference: [],
		r2vNothing: ['Wan 2.7 Reference to Video needs at least one reference image or video.'],
		r2vTooMany: ['Wan 2.7 Reference to Video takes at most 5 reference images and videos together; 6 are planned.'],
		r2vLongWithVideo: ['With a reference video, Wan 2.7 Reference to Video makes at most 10 seconds; choose 10 seconds or less.'],
		r2vLongWithImages: [],
		shotsWithoutRewriting: ['Multiple shots need Prompt Rewriting: turn Prompt Rewriting on, or choose a single shot.'],
		shotsWithRewriting: [],
		chineseTooLong: ['The prompt is too long for HappyHorse 1.1 Text to Video: it takes 5000 characters, a Chinese character counting as two, and this one counts 5002.'],
		chineseLongest: [],
		latinTooLong: ['The prompt is 5001 characters long; HappyHorse 1.0 Reference to Video takes at most 5000.']
	});
});

test('check with files refuses a GIF, M4A audio, videos too long for the result, and images too large to send together', async () => {
	const providers = commands();
	const problems = async (request: ReturnType<typeof checkRequest>) => value(await providers.check(request)).problems;
	const results = {
		gif: await problems(checkRequest('wan2.7-i2v', 'frames', {}, '', { startFrame: image(GIF) })),
		m4a: await problems(checkRequest('wan3.0-video', 'reference', {}, 'Sing like Audio 1.', { audios: [{ fsPath: M4A, mimeType: 'audio/mp4' }] })),
		tooLong: await problems(checkRequest('wan3.0-video', 'reference', { duration: 20 }, 'Like Video 1.', { videos: [video(LONG_CLIP)] })),
		autoWithLong: await problems(checkRequest('wan3.0-video', 'reference', { duration: -1 }, 'Like Video 1.', { videos: [video(LONG_CLIP)] })),
		fits: await problems(checkRequest('wan3.0-video', 'reference', { duration: 18 }, 'Like Video 1.', { videos: [video(LONG_CLIP)] }))
	};
	// Ten images of 13 MiB each are 130 MiB, 173.3 MiB once encoded: more than one request carries.
	const big: MediaInspector = { inspect: async () => ({ bytes: 13 * 1024 * 1024, format: 'png', width: 1000, height: 1000 }) };
	const heavy = value(await commands({ inspector: () => big }).check(checkRequest('wan3.0-video', 'reference', {}, 'p', { images: Array.from({ length: 10 }, () => image(START)) }))).problems;
	assert.deepEqual({ ...results, heavy }, {
		gif: ['The start frame moving.gif is a GIF; Alibaba Cloud takes PNG, JPEG, or WebP images.'],
		m4a: ['Reference audio 1 voice.m4a is M4A audio; Alibaba Cloud takes WAV or MP3.'],
		tooLong: ['The videos are 12 seconds long and the result is to be 20 seconds; together they may be at most 30 seconds for Wan 3.0. Choose a shorter duration, or Auto.'],
		autoWithLong: [],
		fits: [],
		heavy: ['The images are 173.3 MiB together once encoded; AI Video sends at most 128 MiB in one request. Use fewer or smaller images.']
	});
});

test('check outside China and a submit that check refuses send nothing', async () => {
	const provider = await startProvider();
	try {
		const failure = error(await commands().submit(submitRequest(provider.api.url, 'wan3.0-video', 'reference', {}, 'Like Video 1.', { videos: [video(CLIP)] }, 'intl')));
		assert.deepEqual({ code: failure.code, received: provider.api.received.length + provider.oss.received.length }, { code: 'rejected', received: 0 });
	} finally {
		await provider.close();
	}
});

// --- estimates ----------------------------------------------------------------------------------------------

test('estimates follow the price lists of each region: three combinations each, and ranges where the length is known only later', async () => {
	const providers = commands();
	const estimate = async (request: ReturnType<typeof checkRequest>): Promise<Estimate | undefined> => {
		const result = value(await providers.check(request));
		assert.deepEqual(result.problems, []);
		return result.estimate;
	};
	const cny = (min: number, max = min): Estimate => ({ currency: 'CNY', min, max, priceDate: '2026-10-18' });
	const usd = (min: number, max = min): Estimate => ({ currency: 'USD', min, max, priceDate: '2026-10-15' });
	const results = {
		// China (CNY, price list of 2026-10-18).
		// Wan 3.0 at 1080P, 10 seconds, no input video: 1.2 × 10 = 12.
		cnWan3: await estimate(checkRequest('wan3.0-video', 'frames', { duration: 10 }, 'p', counted())),
		// Wan 2.6 Image to Video Flash at 720P without sound, 5 seconds: 0.15 × 5 = 0.75.
		cnFlashSilent: await estimate(checkRequest('wan2.6-i2v-flash', 'frames', { resolution: '720P', audio: false }, '', counted({ startFrame: true }))),
		// HappyHorse 1.1 at 480P, 15 seconds: 0.45 × 15 = 6.75.
		cnHappyHorse: await estimate(checkRequest('happyhorse-1.1-t2v', 'frames', { resolution: '480P', duration: 15 }, 'p', counted())),
		// International (USD, price list of 2026-10-15).
		// Wan 3.0 Prime at 720P, 8 seconds: 0.14 × 8 = 1.12.
		intlPrime: await estimate(checkRequest('wan3.0-video-prime', 'frames', { resolution: '720P', duration: 8 }, 'p', counted(), 'intl')),
		// Wan 2.7 Text to Video at 1080P, 15 seconds: 0.15 × 15 = 2.25.
		intlWan27: await estimate(checkRequest('wan2.7-t2v', 'frames', { duration: 15 }, 'p', counted(), 'intl')),
		// HappyHorse 1.0 Reference to Video at 1080P, 4 seconds: 0.24 × 4 = 0.96.
		intlHappyHorse: await estimate(checkRequest('happyhorse-1.0-r2v', 'reference', { duration: 4 }, 'p', counted({ images: 2 }), 'intl')),
		// Wan 2.6 Text to Video is priced by the tier of its size: 1280×720 is 720P, 0.10 × 5 = 0.5.
		intlWan26Size: await estimate(checkRequest('wan2.6-t2v', 'frames', { size: '1280*720' }, 'p', counted(), 'intl')),
		// Ranges.
		// Wan 3.0 with Auto and no input video: 2 to 30 seconds at 0.20 = 0.4 to 6.
		intlWan3Auto: await estimate(checkRequest('wan3.0-video', 'frames', { duration: -1 }, 'p', counted(), 'intl')),
		// Wan 3.0 References with a measured 4-second video at 720P, 6 seconds: (4 + 6) × 0.6 = 6.
		cnWan3Video: await estimate(checkRequest('wan3.0-video', 'reference', { resolution: '720P', duration: 6 }, 'p', { videos: [video(CLIP)] })),
		// The same without files: one video of 1 to 15 seconds, (1 + 6) × 0.6 = 4.2 to (15 + 6) × 0.6 = 12.6.
		cnWan3Counted: await estimate(checkRequest('wan3.0-video', 'reference', { resolution: '720P', duration: 6 }, 'p', counted({ videos: 1 }))),
		// Wan 3.0 Edit with a 4-second video at 1080P: the output length is Auto, (4 + 2) × 1.2 = 7.2 to 30 × 1.2 = 36.
		cnWan3Edit: await estimate(checkRequest('wan3.0-video', 'edit', {}, 'p', { source: video(CLIP) })),
		// Wan 2.7 Reference to Video, two 4-second videos at 1080P, 6 seconds: each billed up to 2.5 seconds,
		// (2.5 + 2.5 + 6) × 1 = 11.
		cnR2v: await estimate(checkRequest('wan2.7-r2v', 'reference', { duration: 6 }, 'p', { videos: [video(CLIP), video(CLIP)] })),
		// Wan 2.7 Video Edit of a 4-second video at 720P, whole: (4 + 4) × 0.6 = 4.8.
		cnEditWhole: await estimate(checkRequest('wan2.7-videoedit', 'edit', { resolution: '720P' }, 'p', { source: video(CLIP) })),
		// Shortened to 3 seconds: the kept part, (3 + 3) × 0.6 = 3.6, to the whole input, (4 + 3) × 0.6 = 4.2.
		cnEditShort: await estimate(checkRequest('wan2.7-videoedit', 'edit', { resolution: '720P', duration: 3 }, 'p', { source: video(CLIP) })),
		// Wan 2.7 Image to Video Extend bills the whole result: 9 seconds at 1080P, 1 × 9 = 9.
		cnExtend: await estimate(checkRequest('wan2.7-i2v', 'extend', { duration: 9 }, 'p', { source: video(CLIP) }))
	};
	assert.deepEqual(results, {
		cnWan3: cny(12),
		cnFlashSilent: cny(0.75),
		cnHappyHorse: cny(6.75),
		intlPrime: usd(1.12),
		intlWan27: usd(2.25),
		intlHappyHorse: usd(0.96),
		intlWan26Size: usd(0.5),
		intlWan3Auto: usd(0.4, 6),
		cnWan3Video: cny(6),
		cnWan3Counted: cny(4.2, 12.6),
		cnWan3Edit: cny(7.2, 36),
		cnR2v: cny(11),
		cnEditWhole: cny(4.8),
		cnEditShort: cny(3.6, 4.2),
		cnExtend: cny(9)
	});
});
