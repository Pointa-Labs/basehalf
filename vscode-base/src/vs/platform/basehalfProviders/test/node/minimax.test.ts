/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import type { IncomingHttpHeaders, ServerResponse } from 'http';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { MINIMAX } from '../../node/minimax.js';
import { buildCatalog } from '../../node/registry.js';
import type { CatalogModel, CatalogParameter, Output, PollState } from '../../common/basehalfProviderTypes.js';
import { remoteIdIn, error, gifHeader, isoMedia, jpegHeader, partTargets, plannedFiles, png, recordingSleep, routed, sendJson, serveFiles, startServer, tinyJpeg, tinyPng, remoteIdOf, value, wav, webpHeader, type Received } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: minimax', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const folder = mkdtempSync(join(tmpdir(), 'basehalf-minimax-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

	const MIB = 1024 * 1024;

	function file(name: string, bytes: Buffer, mimeType: string) {
		const fsPath = join(folder, name);
		writeFileSync(fsPath, bytes);
		return { fsPath, mimeType };
	}

	function base64(media: { readonly fsPath: string }): string {
		return readFileSync(media.fsPath).toString('base64');
	}

	/** A PNG whose header says its size, padded with zeros after its end to `bytes`. */
	function paddedPng(width: number, height: number, bytes: number): Buffer {
		const image = png(width, height);
		return Buffer.concat([image, Buffer.alloc(bytes - image.byteLength)]);
	}

	const START = file('start.png', png(640, 360), 'image/png');
	const END = file('end.jpg', jpegHeader(800, 600), 'image/jpeg');
	const CHARACTER = file('character.png', png(512, 768), 'image/png');
	const PLACE = file('place.webp', webpHeader('VP8X', 1024, 768), 'image/webp');
	const DANCE = file('dance.mp4', isoMedia(6), 'video/mp4');
	const VOICE = file('voice.wav', wav(3), 'audio/wav');
	const SONG = file('song.m4a', isoMedia(4, { brand: 'M4A ' }), 'audio/mp4');
	const MOTION = file('motion.gif', gifHeader(640, 360), 'image/gif');
	const TINY = file('tiny.png', png(300, 300), 'image/png');
	const VIDEO = isoMedia(2);

	const KEY = 'mm-test-key-0123456789abcdef';
	const NO_INPUTS = { images: [], videos: [], audios: [] };
	const LIMITS = 'MiniMax takes 20 requests a minute for Hailuo models, 300 requests a minute with at most 30 tasks at a time for H3 models, and 10 requests a minute for image models.';
	/** The file ids the fake hands out: 64-bit numbers beyond 2^53, which a JSON number cannot keep. */
	const FIRST_FILE_ID = 9007199254740993n;

	function commands(sleep = recordingSleep().sleep) {
		return new VideoProviderCommands([MINIMAX], { http: { sleep } });
	}

	function access(endpoint: string, region = 'intl') {
		return { provider: 'minimax', region, endpoint, credentials: { apiKey: KEY } };
	}

	function generation(model: string, mode: string, params: Record<string, unknown>, prompt: string, inputs: object = NO_INPUTS) {
		return { model, mode, params, prompt, inputs };
	}

	let parts = 0;
	function partPath(): string {
		return join(folder, `video-${parts++}.mp4.part`);
	}

	function sendRaw(response: ServerResponse, status: number, text: string): void {
		const bytes = Buffer.from(text, 'utf8');
		response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength) });
		response.end(bytes);
	}

	interface FormPart {
		readonly fileName?: string;
		readonly contentType?: string;
		readonly bytes: Buffer;
	}

	/** The parts of a multipart form, by name. */
	function formParts(request: Received): Map<string, FormPart> {
		const boundary = /boundary=(?<boundary>\S+)$/.exec(String(request.headers['content-type']))?.groups?.boundary;
		assert.ok(boundary, 'a multipart form has a boundary');
		const delimiter = Buffer.from(`--${boundary}`, 'latin1');
		const found = new Map<string, FormPart>();
		let start = request.body.indexOf(delimiter);
		while (start >= 0) {
			const next = request.body.indexOf(delimiter, start + delimiter.length);
			if (next < 0) {
				break;
			}
			const part = request.body.subarray(start + delimiter.length + 2, next - 2);
			const headerEnd = part.indexOf('\r\n\r\n');
			const head = part.subarray(0, headerEnd).toString('utf8');
			const name = / name="(?<name>[^"]*)"/.exec(head)?.groups?.name ?? '';
			found.set(name, {
				fileName: /filename="(?<file>[^"]*)"/.exec(head)?.groups?.file,
				contentType: /Content-Type: (?<type>.+)/i.exec(head)?.groups?.type.trim(),
				bytes: part.subarray(headerEnd + 4)
			});
			start = next;
		}
		return found;
	}

	interface Upload {
		readonly purpose: string | undefined;
		readonly fileName: string | undefined;
		readonly contentType: string | undefined;
		readonly bytes: Buffer;
	}

	interface FakeMiniMax {
		/** The endpoint to enter: the fake's origin, like MiniMax's base URLs. */
		readonly url: string;
		/** Where the videos are, another origin, as MiniMax's addresses are. */
		readonly cdnUrl: string;
		readonly received: Received[];
		readonly cdnReceived: Received[];
		readonly creates: { readonly path: string; readonly headers: IncomingHttpHeaders; readonly body: Record<string, unknown> }[];
		readonly uploads: Upload[];
		/** The statuses a task answers, one per query, the last one again and again; `Fail:1027` adds a code of `base_resp` (V1). */
		script(remoteId: string, statuses: readonly string[]): void;
		close(): Promise<void>;
	}

	const V1_MESSAGES: Readonly<Record<string, string>> = Object.freeze({ 1000: 'unknown error', 1002: 'rate limit', 1027: 'output new_sensitive', 2013: 'invalid params' });

	/** A local server that answers like MiniMax's V1 and V2 video APIs and its file API. */
	async function startMiniMax(): Promise<FakeMiniMax> {
		const cdn = await startServer((request, response) => {
			response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(VIDEO.byteLength) });
			response.end(VIDEO);
		});
		const statuses = new Map<string, string[]>();
		const creates: FakeMiniMax['creates'] = [];
		const uploads: Upload[] = [];
		let tasks = 0;
		let files = 0n;
		const next = (remoteId: string): string | undefined => {
			const list = statuses.get(remoteId);
			return list && list.length > 1 ? list.shift() : list?.[0];
		};
		const server = await startServer((request, response) => {
			const url = new URL(request.path, 'http://127.0.0.1');
			const v2Task = /^\/v2\/query\/video_generation\/(?<id>[^/]+)$/.exec(url.pathname)?.groups?.id;
			const v2Delete = request.method === 'DELETE' ? /^\/v2\/video_generation\/(?<id>[^/]+)$/.exec(url.pathname)?.groups?.id : undefined;
			if (request.method === 'POST' && (url.pathname === '/v2/video_generation' || url.pathname === '/v1/video_generation')) {
				creates.push({ path: url.pathname, headers: request.headers, body: JSON.parse(request.body.toString('utf8')) });
				const v2 = url.pathname.startsWith('/v2/');
				const remoteId = String((v2 ? 424010985738600 : 106916112212000) + ++tasks);
				statuses.set(remoteId, [v2 ? 'queued' : 'Preparing']);
				sendJson(response, 200, v2 ? { task_id: remoteId } : { task_id: remoteId, base_resp: { status_code: 0, status_msg: 'success' } });
			} else if (v2Task !== undefined) {
				const status = next(v2Task);
				if (status === undefined) {
					sendJson(response, 400, { type: 'error', error: { type: 'bad_request_error', message: 'invalid task_id', http_code: '400' }, request_id: '0217852290155' });
					return;
				}
				sendJson(response, 200, {
					task: {
						id: v2Task,
						model: 'MiniMax-H3',
						status,
						created_at: 1785125529,
						updated_at: 1785125946,
						...(status === 'succeeded' ? { content: { url: `${cdn.url}/output/${v2Task}.mp4` }, usage: { total_seconds: 5, input_seconds: 0, output_seconds: 5, input_image_count: 0 } } : {}),
						...(status === 'failed' ? { error: { code: '1026', message: 'video description contains sensitive content' }, usage: {} } : {}),
						resolution: '768P',
						duration: 5,
						ratio: '16:9',
						task_type: 'generation',
						modality: 'video'
					}
				});
			} else if (v2Delete !== undefined) {
				const status = statuses.get(v2Delete)?.[0];
				if (status === 'queued') {
					statuses.set(v2Delete, ['cancelled']);
					sendJson(response, 200, { task_id: v2Delete, action: 'cancelled', status: 'cancelled' });
				} else if (status === 'succeeded' || status === 'failed') {
					statuses.delete(v2Delete);
					sendJson(response, 200, { task_id: v2Delete, action: 'deleted', status: 'deleted' });
				} else {
					sendJson(response, 400, { type: 'error', error: { type: 'bad_request_error', message: `a ${status ?? 'missing'} task cannot be cancelled (2013)`, http_code: '400' }, request_id: '0217852290155' });
				}
			} else if (request.method === 'GET' && url.pathname === '/v1/query/video_generation') {
				const remoteId = url.searchParams.get('task_id') ?? '';
				const [status, code] = (next(remoteId) ?? ':2013').split(':');
				const base = code ? `{"status_code":${code},"status_msg":"${V1_MESSAGES[code]}"}` : '{"status_code":0,"status_msg":"success"}';
				// The file id is sent as a JSON number beyond 2^53.
				const done = status === 'Success' ? `,"file_id":${FIRST_FILE_ID},"video_width":1366,"video_height":768` : '';
				sendRaw(response, 200, `{"task_id":"${remoteId}","status":"${status}"${done},"base_resp":${base}}`);
			} else if (request.method === 'GET' && url.pathname === '/v1/files/retrieve') {
				const fileId = url.searchParams.get('file_id') ?? '';
				sendRaw(response, 200, `{"file":{"file_id":${fileId},"bytes":${VIDEO.byteLength},"created_at":1700469398,"filename":"output_aigc.mp4","purpose":"video_generation","download_url":"${cdn.url}/files/${fileId}/output_aigc.mp4"},"base_resp":{"status_code":0,"status_msg":"success"}}`);
			} else if (request.method === 'POST' && url.pathname === '/v1/files/upload') {
				const form = formParts(request);
				const media = form.get('file');
				uploads.push({ purpose: form.get('purpose')?.bytes.toString('utf8'), fileName: media?.fileName, contentType: media?.contentType, bytes: media?.bytes ?? Buffer.alloc(0) });
				const fileId = FIRST_FILE_ID + 2n * files++;
				sendRaw(response, 200, `{"file":{"file_id":${fileId},"bytes":${media?.bytes.byteLength ?? 0},"created_at":1700469398,"filename":"${media?.fileName ?? ''}","purpose":"video_generation_input"},"base_resp":{"status_code":0,"status_msg":"success"}}`);
			} else {
				sendJson(response, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found', http_code: '404' } });
			}
		});
		return {
			url: server.url,
			cdnUrl: cdn.url,
			received: server.received,
			cdnReceived: cdn.received,
			creates,
			uploads,
			script: (remoteId, list) => statuses.set(remoteId, [...list]),
			close: async () => {
				await server.close();
				await cdn.close();
			}
		};
	}

	async function pollEach(providers: VideoProviderCommands, ref: Record<string, unknown>, times: number): Promise<PollState[]> {
		const states: PollState[] = [];
		for (let index = 0; index < times; index++) {
			states.push(value(await providers.poll(ref)));
		}
		return states;
	}

	function summary(parameter: CatalogParameter): string {
		const more = parameter.advanced ? ' (more)' : '';
		switch (parameter.kind) {
			case 'choice':
				return `${parameter.name}=${parameter.options.map(option => option.value).join('|')}:${parameter.default}${more}`;
			case 'integer':
			case 'number':
				return `${parameter.name}=${parameter.min}-${parameter.max}/${parameter.step}:${parameter.default ?? 'unset'}${more}`;
			default:
				return `${parameter.name}:${String(parameter.default)}${more}`;
		}
	}

	test('the catalog entry declares both regions, the API key, and five video models with their modes, inputs, limits, and parameters', () => {
		const provider = buildCatalog([MINIMAX]).providers[0];
		assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
			id: 'minimax',
			label: 'MiniMax',
			regions: [
				{ id: 'cn', label: 'China', baseUrl: 'https://api.minimax.cn', console: 'https://platform.minimax.cn/user-center/basic-information/interface-key' },
				{ id: 'intl', label: 'International', baseUrl: 'https://api.minimax.io', console: 'https://platform.minimax.io/user-center/basic-information/interface-key' }
			],
			credentials: [{ id: 'apiKey', label: 'API Key' }]
		});
		const videos = provider.models.filter(model => model.kind === 'video');
		const models = Object.fromEntries(videos.map((model: CatalogModel) => [model.id, {
			label: model.label,
			ids: model.providerModels,
			prompt: `${model.prompt.required} ${model.prompt.maxLength}`,
			modes: model.modes.map(mode => `${mode.id}: start ${mode.inputs.startFrame}, end ${mode.inputs.endFrame}, images ${mode.inputs.images.max}, videos ${mode.inputs.videos.max}, audio ${mode.inputs.audios.max}`),
			parameters: model.parameters.map(summary)
		}]));
		const ratio = 'ratio=16:9|4:3|1:1|3:4|9:16|21:9|adaptive:16:9';
		const h3Modes = ['frames: start optional, end optional, images 0, videos 0, audio 0', 'reference: start none, end none, images 9, videos 3, audio 3'];
		const hailuoParameters = (resolutions: string) => [`resolution=${resolutions}:768p`, 'duration=6-10/4:6', 'prompt_extend:true', 'fast_pretreatment:false (more)'];
		assert.deepEqual(models, {
			'h3': {
				label: 'MiniMax H3',
				ids: { cn: 'MiniMax-H3', intl: 'MiniMax-H3' },
				prompt: 'always 7000',
				modes: h3Modes,
				parameters: ['resolution=768p|2k:768p', ratio, 'duration=4-15/1:5', 'watermark:false (more)']
			},
			'h3-max': {
				label: 'MiniMax H3 Max',
				ids: { cn: 'MiniMax-H3-Max', intl: 'MiniMax-H3-Max' },
				prompt: 'always 7000',
				modes: h3Modes,
				parameters: ['resolution=480p|768p:768p', ratio, 'duration=5-15/1:5', 'prompt_expansion_mode=disabled|balanced|quality:balanced', 'watermark:false (more)']
			},
			'hailuo-2.3': {
				label: 'Hailuo 2.3',
				ids: { cn: 'MiniMax-Hailuo-2.3', intl: 'MiniMax-Hailuo-2.3' },
				prompt: 'withoutMedia 2000',
				modes: ['frames: start optional, end none, images 0, videos 0, audio 0'],
				parameters: hailuoParameters('768p|1080p')
			},
			'hailuo-2.3-fast': {
				label: 'Hailuo 2.3 Fast',
				ids: { cn: 'MiniMax-Hailuo-2.3-Fast', intl: 'MiniMax-Hailuo-2.3-Fast' },
				prompt: 'withoutMedia 2000',
				modes: ['frames: start required, end none, images 0, videos 0, audio 0'],
				parameters: hailuoParameters('768p|1080p')
			},
			'hailuo-02': {
				label: 'Hailuo 02',
				ids: { cn: 'MiniMax-Hailuo-02', intl: 'MiniMax-Hailuo-02' },
				prompt: 'withoutMedia 2000',
				modes: ['frames: start optional, end optional, images 0, videos 0, audio 0'],
				parameters: hailuoParameters('512p|768p|1080p')
			}
		});
		// The shared resolution values, labelled as MiniMax writes them.
		assert.deepEqual(videos.map(model => {
			const resolution = model.parameters.find(parameter => parameter.name === 'resolution');
			return resolution?.kind === 'choice' ? resolution.options.map(option => `${option.value}=${option.label}`).join(' ') : '';
		}), ['768p=768p 2k=2K', '480p=480p 768p=768p', '768p=768p 1080p=1080p', '768p=768p 1080p=1080p', '512p=512p 768p=768p 1080p=1080p']);
		assert.deepEqual(videos.map(model => model.modes.map(mode => mode.limits)), [
			...Array.from({ length: 2 }, () => [
				{ imageMinSide: 256, imageMaxSide: 5760, imageAspect: [0.4, 2.5], imageMaxBytes: 30 * MIB },
				{ imageMinSide: 256, imageMaxSide: 5760, imageAspect: [0.4, 2.5], imageMaxBytes: 30 * MIB, videoSeconds: [2, 15], videoTotalSeconds: 15, videoMaxBytes: 50 * MIB, audioSeconds: [2, 15], audioTotalSeconds: 15, audioMaxBytes: 15 * MIB }
			]),
			...Array.from({ length: 3 }, () => [{ imageMinSide: 301, imageAspect: [0.4, 2.5], imageMaxBytes: 20 * MIB - 1 }])
		]);
	});

	test('H3 and H3 Max are created once per mode with the exact body: the prompt alone, frames as data URLs, and references with uploaded videos and audio', async () => {
		const fake = await startMiniMax();
		try {
			const providers = commands();
			const remoteIds = [
				remoteIdOf(await providers.submit({ ...access(fake.url), ...generation('h3', 'frames', { resolution: '2k', ratio: '21:9', duration: 12 }, 'A fleet jumps away in a blinding flash.') })),
				remoteIdOf(await providers.submit({ ...access(fake.url, 'cn'), ...generation('h3', 'frames', { ratio: 'adaptive', duration: 6, watermark: true }, 'The girl grows up.', { startFrame: START, endFrame: END, ...NO_INPUTS }) })),
				remoteIdOf(await providers.submit({ ...access(fake.url), ...generation('h3-max', 'reference', { resolution: '480p', duration: 8, prompt_expansion_mode: 'quality' }, 'Image 1 dances like Video 1 in Image 2, with the voice of Audio 1.', { images: [CHARACTER, PLACE], videos: [DANCE], audios: [VOICE] }) })),
				remoteIdOf(await providers.submit({ ...access(fake.url, 'cn'), ...generation('h3-max', 'frames', {}, 'A boy plays basketball by the sea.') }))
			];
			assert.deepEqual({
				remoteIds,
				paths: fake.creates.map(create => create.path),
				headers: [fake.creates[0].headers.authorization, fake.creates[0].headers['content-type']],
				bodies: fake.creates.map(create => create.body),
				uploads: fake.uploads.map(upload => ({ purpose: upload.purpose, fileName: upload.fileName, contentType: upload.contentType, size: upload.bytes.byteLength })),
				uploaded: [fake.uploads[0].bytes.equals(readFileSync(DANCE.fsPath)), fake.uploads[1].bytes.equals(readFileSync(VOICE.fsPath))],
				uploadKey: fake.received.find(entry => entry.path === '/v1/files/upload')?.headers.authorization
			}, {
				remoteIds: ['424010985738601', '424010985738602', '424010985738603', '424010985738604'],
				paths: ['/v2/video_generation', '/v2/video_generation', '/v2/video_generation', '/v2/video_generation'],
				headers: [`Bearer ${KEY}`, 'application/json'],
				bodies: [
					{
						model: 'MiniMax-H3',
						content: [{ type: 'text', text: 'A fleet jumps away in a blinding flash.' }],
						resolution: '2K',
						duration: 12,
						ratio: '21:9'
					},
					{
						model: 'MiniMax-H3',
						content: [
							{ type: 'text', text: 'The girl grows up.' },
							{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64(START)}` }, role: 'first_frame' },
							{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64(END)}` }, role: 'last_frame' }
						],
						resolution: '768P',
						duration: 6,
						ratio: 'adaptive',
						aigc_watermark: true
					},
					{
						model: 'MiniMax-H3-Max',
						content: [
							{ type: 'text', text: 'Image 1 dances like Video 1 in Image 2, with the voice of Audio 1.' },
							{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64(CHARACTER)}` }, role: 'reference_image' },
							{ type: 'image_url', image_url: { url: `data:image/webp;base64,${base64(PLACE)}` }, role: 'reference_image' },
							{ type: 'video_url', video_url: { url: `mm_file://${FIRST_FILE_ID}` }, role: 'reference_video' },
							{ type: 'audio_url', audio_url: { url: `mm_file://${FIRST_FILE_ID + 2n}` }, role: 'reference_audio' }
						],
						resolution: '480P',
						duration: 8,
						ratio: '16:9',
						extra: { prompt_expansion_mode: 'quality' }
					},
					{
						model: 'MiniMax-H3-Max',
						content: [{ type: 'text', text: 'A boy plays basketball by the sea.' }],
						resolution: '768P',
						duration: 5,
						ratio: '16:9',
						extra: { prompt_expansion_mode: 'balanced' },
						aigc_watermark: false
					}
				],
				uploads: [
					{ purpose: 'video_generation_input', fileName: 'reference-video-1.mp4', contentType: 'video/mp4', size: readFileSync(DANCE.fsPath).byteLength },
					{ purpose: 'video_generation_input', fileName: 'reference-audio-1.wav', contentType: 'audio/wav', size: readFileSync(VOICE.fsPath).byteLength }
				],
				uploaded: [true, true],
				uploadKey: `Bearer ${KEY}`
			});
		} finally {
			await fake.close();
		}
	});

	test('images that would take an H3 request past 64 MB are uploaded, the largest first, and the others stay inline', async () => {
		const large = file('large.png', paddedPng(800, 600, 27 * MIB), 'image/png');
		const largest = file('largest.png', paddedPng(1024, 768, 29 * MIB), 'image/png');
		const fake = await startMiniMax();
		try {
			value(await commands().submit({ ...access(fake.url), ...generation('h3', 'reference', { ratio: 'adaptive' }, 'Image 1 walks into Image 2.', { images: [large, largest], videos: [], audios: [] }) }));
			const content = fake.creates[0].body.content as { readonly image_url: { readonly url: string } }[];
			assert.deepEqual({
				uploads: fake.uploads.map(upload => `${upload.fileName} ${upload.contentType} ${upload.bytes.byteLength}`),
				inline: content[1].image_url.url === `data:image/png;base64,${base64(large)}`,
				uploaded: content[2].image_url.url,
				createBytes: fake.received.filter(entry => entry.path === '/v2/video_generation').map(entry => entry.body.byteLength < 64_000_000)
			}, {
				uploads: [`reference-image-2.png image/png ${29 * MIB}`],
				inline: true,
				uploaded: `mm_file://${FIRST_FILE_ID}`,
				createBytes: [true]
			});
		} finally {
			await fake.close();
		}
	});

	test('the Hailuo models are created once per mode with the exact body: the prompt alone, a start frame, and a start and an end frame', async () => {
		const fake = await startMiniMax();
		try {
			const providers = commands();
			const remoteIds = [
				remoteIdOf(await providers.submit({ ...access(fake.url), ...generation('hailuo-2.3', 'frames', {}, 'A man picks up a book [Pedestal up], then reads [Static shot].') })),
				remoteIdOf(await providers.submit({ ...access(fake.url, 'cn'), ...generation('hailuo-2.3-fast', 'frames', { resolution: '1080p', duration: 6, prompt_extend: false, fast_pretreatment: true }, '', { startFrame: START, ...NO_INPUTS }) })),
				remoteIdOf(await providers.submit({ ...access(fake.url), ...generation('hailuo-02', 'frames', { duration: 10 }, 'A little girl grows up.', { startFrame: START, endFrame: END, ...NO_INPUTS }) })),
				remoteIdOf(await providers.submit({ ...access(fake.url, 'cn'), ...generation('hailuo-02', 'frames', { resolution: '512p', duration: 10 }, 'A mouse runs toward the camera.', { startFrame: START, ...NO_INPUTS }) }))
			];
			const start = `data:image/png;base64,${base64(START)}`;
			assert.deepEqual({ remoteIds, paths: fake.creates.map(create => create.path), bodies: fake.creates.map(create => create.body), uploads: fake.uploads.length }, {
				remoteIds: ['106916112212001', '106916112212002', '106916112212003', '106916112212004'],
				paths: ['/v1/video_generation', '/v1/video_generation', '/v1/video_generation', '/v1/video_generation'],
				bodies: [
					{ model: 'MiniMax-Hailuo-2.3', prompt: 'A man picks up a book [Pedestal up], then reads [Static shot].', prompt_optimizer: true, fast_pretreatment: false, duration: 6, resolution: '768P' },
					{ model: 'MiniMax-Hailuo-2.3-Fast', first_frame_image: start, prompt_optimizer: false, fast_pretreatment: true, duration: 6, resolution: '1080P' },
					{ model: 'MiniMax-Hailuo-02', prompt: 'A little girl grows up.', first_frame_image: start, last_frame_image: `data:image/jpeg;base64,${base64(END)}`, prompt_optimizer: true, duration: 10, resolution: '768P' },
					{ model: 'MiniMax-Hailuo-02', prompt: 'A mouse runs toward the camera.', first_frame_image: start, prompt_optimizer: true, fast_pretreatment: false, duration: 10, resolution: '512P' }
				],
				uploads: 0
			});
		} finally {
			await fake.close();
		}
	});

	test('an H3 task is followed through queued, running, and succeeded, then failed and cancelled ones, and its video is downloaded without the key', async () => {
		const fake = await startMiniMax();
		try {
			const providers = commands();
			const start = async () => remoteIdOf(await providers.submit({ ...access(fake.url), ...generation('h3', 'frames', {}, 'A storm over the pier.') }));
			const ref = (remoteId: string) => ({ ...access(fake.url), model: 'h3', remoteId });
			const made = await start();
			fake.script(made, ['queued', 'running', 'succeeded']);
			const states = await pollEach(providers, ref(made), 3);
			const fromPoll = partPath();
			const viaPoll = value(await providers.download({ ...ref(made), videoUrl: (states[2] as { readonly videoUrl: string }).videoUrl, targetFsPath: fromPoll }));
			const fromModule = partPath();
			const viaModule = value(await providers.download({ ...ref(made), targetFsPath: fromModule }));
			const failed = await start();
			fake.script(failed, ['failed']);
			const cancelled = await start();
			fake.script(cancelled, ['cancelled']);
			const odd = await start();
			fake.script(odd, ['expired']);
			assert.deepEqual({
				states,
				sizes: [viaPoll.size, viaModule.size],
				same: [readFileSync(fromPoll).equals(VIDEO), readFileSync(fromModule).equals(VIDEO)],
				cdn: fake.cdnReceived.map(entry => `${entry.path} ${entry.headers.authorization ?? 'no key'}`),
				failed: value(await providers.poll(ref(failed))),
				cancelled: value(await providers.poll(ref(cancelled))),
				unknown: error(await providers.poll(ref('424010985738699'))),
				odd: error(await providers.poll(ref(odd))).code
			}, {
				states: [{ state: 'pending' }, { state: 'running' }, { state: 'succeeded', videoUrl: `${fake.cdnUrl}/output/${made}.mp4` }],
				sizes: [VIDEO.byteLength, VIDEO.byteLength],
				same: [true, true],
				cdn: [`/output/${made}.mp4 no key`, `/output/${made}.mp4 no key`],
				failed: { state: 'failed', message: 'video description contains sensitive content (1026)' },
				cancelled: { state: 'cancelled', message: 'The task was cancelled.' },
				unknown: { code: 'notFound', message: 'invalid task_id', status: 400 },
				odd: 'invalidResponse'
			});
		} finally {
			await fake.close();
		}
	});

	test('a Hailuo task is followed through Preparing, Queueing, Processing, and Success, and its video found through its file id, every digit kept', async () => {
		const fake = await startMiniMax();
		try {
			const providers = commands();
			const start = async () => remoteIdOf(await providers.submit({ ...access(fake.url, 'cn'), ...generation('hailuo-2.3', 'frames', {}, 'A storm over the pier.') }));
			const ref = (remoteId: string) => ({ ...access(fake.url, 'cn'), model: 'hailuo-2.3', remoteId });
			const made = await start();
			fake.script(made, ['Preparing', 'Queueing', 'Processing', 'Success']);
			const states = await pollEach(providers, ref(made), 4);
			const before = fake.received.length;
			const target = partPath();
			const downloaded = value(await providers.download({ ...ref(made), targetFsPath: target }));
			const lookups = fake.received.slice(before).map(entry => `${entry.method} ${entry.path}`);
			const failed = await start();
			fake.script(failed, ['Fail']);
			const sensitive = await start();
			fake.script(sensitive, ['Fail:1027']);
			const busy = await start();
			fake.script(busy, ['Processing:1002']);
			const failedWithCode = await start();
			fake.script(failedWithCode, ['Fail:1000']);
			const unwell = await start();
			fake.script(unwell, ['Processing:1000']);
			assert.deepEqual({
				states,
				lookups,
				downloaded: downloaded.size,
				same: readFileSync(target).equals(VIDEO),
				cdn: fake.cdnReceived.map(entry => `${entry.path} ${entry.headers.authorization ?? 'no key'}`),
				failed: value(await providers.poll(ref(failed))),
				sensitive: value(await providers.poll(ref(sensitive))),
				busy: error(await providers.poll(ref(busy))),
				failedWithCode: value(await providers.poll(ref(failedWithCode))),
				unwell: error(await providers.poll(ref(unwell))),
				unknown: error(await providers.poll(ref('106916112212099'))),
				cancelled: value(await providers.cancel(ref(made)))
			}, {
				states: [{ state: 'pending' }, { state: 'pending' }, { state: 'running' }, { state: 'succeeded' }],
				lookups: [`GET /v1/query/video_generation?task_id=${made}`, `GET /v1/files/retrieve?file_id=${FIRST_FILE_ID}`],
				downloaded: VIDEO.byteLength,
				same: true,
				cdn: [`/files/${FIRST_FILE_ID}/output_aigc.mp4 no key`],
				failed: { state: 'failed', message: 'MiniMax reports that the video could not be made.' },
				sensitive: { state: 'failed', message: 'output new_sensitive (1027)' },
				busy: { code: 'rateLimited', message: `rate limit (1002) ${LIMITS}` },
				failedWithCode: { state: 'failed', message: 'unknown error (1000)' },
				// Asked again at the next interval, as after a network error.
				unwell: { code: 'network', message: 'unknown error (1000)' },
				unknown: { code: 'notFound', message: 'invalid params (2013)' },
				cancelled: { cancelled: false }
			});
			// Hailuo cannot cancel a task: nothing was sent for it.
			assert.equal(fake.received.at(-1)?.path, '/v1/query/video_generation?task_id=106916112212099');
		} finally {
			await fake.close();
		}
	});

	test('a queued H3 task is cancelled with one DELETE; a running one is not asked, and a DELETE refused because the task started answers false', async () => {
		const fake = await startMiniMax();
		try {
			const providers = commands();
			const start = async () => remoteIdOf(await providers.submit({ ...access(fake.url), ...generation('h3', 'frames', {}, 'A storm over the pier.') }));
			const ref = (remoteId: string) => ({ ...access(fake.url), model: 'h3', remoteId });
			const queued = await start();
			const running = await start();
			fake.script(running, ['running']);
			const cancelled = value(await providers.cancel(ref(queued)));
			const after = value(await providers.poll(ref(queued)));
			const notAsked = value(await providers.cancel(ref(running)));
			assert.deepEqual({
				cancelled,
				after,
				notAsked,
				requests: fake.received.filter(entry => entry.method !== 'POST').map(entry => `${entry.method} ${entry.path}`)
			}, {
				cancelled: { cancelled: true },
				after: { state: 'cancelled', message: 'The task was cancelled.' },
				notAsked: { cancelled: false },
				requests: [
					`GET /v2/query/video_generation/${queued}`,
					`DELETE /v2/video_generation/${queued}`,
					`GET /v2/query/video_generation/${queued}`,
					`GET /v2/query/video_generation/${running}`
				]
			});
		} finally {
			await fake.close();
		}
		const raced = await startServer((request, response) => {
			if (request.method === 'DELETE') {
				sendJson(response, 400, { type: 'error', error: { type: 'bad_request_error', message: 'a running task cannot be cancelled (2013)', http_code: '400' } });
				return;
			}
			sendJson(response, 200, { task: { id: '424010985738601', status: 'queued' } });
		});
		try {
			const answer = value(await commands().cancel({ ...access(raced.url), model: 'h3-max', remoteId: '424010985738601' }));
			assert.deepEqual({ answer, methods: raced.received.map(entry => entry.method) }, { answer: { cancelled: false }, methods: ['GET', 'DELETE'] });
		} finally {
			await raced.close();
		}
	});

	test('refused keys, too many requests, an empty balance, and the codes of base_resp in HTTP 200 answers', async () => {
		let respond: (response: ServerResponse) => void = response => sendJson(response, 500, {});
		const server = await startServer((request, response) => respond(response));
		try {
			const sleep = recordingSleep();
			const providers = commands(sleep.sleep);
			const create = async (model: string, answer: (response: ServerResponse) => void) => {
				respond = answer;
				return error(await providers.submit({ ...access(server.url), ...generation(model, 'frames', {}, 'A storm over the pier.') }));
			};
			const v2Error = (status: number, type: string, message: string) => (response: ServerResponse) =>
				sendJson(response, status, { type: 'error', error: { type, message, http_code: String(status) }, request_id: '021785229015510a2c883cf675b9804d' });
			const v1Code = (code: number, message: string) => (response: ServerResponse) => sendJson(response, 200, { task_id: '', base_resp: { status_code: code, status_msg: message } });
			const login = 'login fail: Please carry the API secret key in the \'Authorization\' field of the request header (1004)';
			const outcomes = {
				key: await create('h3', v2Error(401, 'authorized_error', login)),
				busy: await create('h3', v2Error(429, 'rate_limit_error', 'rate limit, please retry later (1002)')),
				empty: await create('h3-max', v2Error(402, 'insufficient_balance_error', 'insufficient balance (1008)')),
				sensitive: await create('h3', v2Error(422, 'unprocessable_entity_error', 'video description contains sensitive content (1026)')),
				overloaded: await create('h3', v2Error(529, 'overloaded_error', 'overloaded (1000)')),
				hailuoBalance: await create('hailuo-2.3', v1Code(1008, 'insufficient balance')),
				hailuoKey: await create('hailuo-2.3', v1Code(2049, 'invalid api key')),
				hailuoBusy: await create('hailuo-02', v1Code(1002, 'rate limit')),
				hailuoParams: await create('hailuo-02', v1Code(2013, 'invalid params, duration')),
				hailuoInternal: await create('hailuo-2.3', v1Code(1000, 'unknown error'))
			};
			const creates = server.received.length;
			let polls = 0;
			respond = response => polls++ === 0
				? sendJson(response, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'rate limit, please retry later (1002)', http_code: '429' } }, { 'Retry-After': '2' })
				: sendJson(response, 200, { task: { id: '424010985738601', status: 'running' } });
			const polled = value(await providers.poll({ ...access(server.url), model: 'h3', remoteId: '424010985738601' }));
			respond = response => sendJson(response, 200, { file: {}, base_resp: { status_code: 1004, status_msg: 'token not match group' } });
			const uploadKey = error(await providers.submit({ ...access(server.url), ...generation('h3', 'reference', {}, 'Dance like Video 1.', { images: [], videos: [DANCE], audios: [] }) }));
			respond = response => sendJson(response, 400, { file: {}, base_resp: { status_code: 2013, status_msg: 'invalid file, video too short' } });
			const uploadRefused = error(await providers.submit({ ...access(server.url), ...generation('h3', 'reference', {}, 'Speak like Audio 1.', { images: [], videos: [], audios: [VOICE] }) }));
			assert.deepEqual({ outcomes, creates, polled, waits: sleep.waits, uploadKey, uploadRefused, last: server.received.slice(-2).map(entry => entry.path) }, {
				outcomes: {
					key: { code: 'auth', message: login, status: 401 },
					busy: { code: 'rateLimited', message: `rate limit, please retry later (1002) ${LIMITS}`, status: 429 },
					empty: { code: 'balance', message: 'insufficient balance (1008)', status: 402 },
					sensitive: { code: 'rejected', message: 'video description contains sensitive content (1026)', status: 422 },
					overloaded: { code: 'unknownOutcome', message: 'overloaded (1000)', status: 529 },
					hailuoBalance: { code: 'balance', message: 'insufficient balance (1008)' },
					hailuoKey: { code: 'auth', message: 'invalid api key (2049)' },
					hailuoBusy: { code: 'rateLimited', message: `rate limit (1002) ${LIMITS}` },
					hailuoParams: { code: 'rejected', message: 'invalid params, duration (2013)' },
					hailuoInternal: { code: 'unknownOutcome', message: 'unknown error (1000)' }
				},
				// Each request that creates a task was sent once, never again.
				creates: 10,
				polled: { state: 'running' },
				waits: [2000],
				uploadKey: { code: 'auth', message: 'Reference video 1 dance.mp4 could not be uploaded to MiniMax: token not match group (1004)' },
				uploadRefused: { code: 'rejected', message: 'Reference audio 1 voice.wav could not be uploaded to MiniMax: invalid file, video too short (2013)', status: 400 },
				// A refused upload creates no task.
				last: ['/v1/files/upload', '/v1/files/upload']
			});
		} finally {
			await server.close();
		}
	});

	test('a create whose connection drops after it was sent, or that a server error answers, has an unknown outcome and is sent once', async () => {
		let drop = true;
		const server = await startServer((request, response, socket) => {
			if (drop) {
				socket.destroy();
				return;
			}
			sendJson(response, 503, { type: 'error', error: { type: 'server_error', message: 'internal error (1000)', http_code: '503' } });
		});
		try {
			const sleep = recordingSleep();
			const providers = commands(sleep.sleep);
			const h3 = error(await providers.submit({ ...access(server.url), ...generation('h3', 'frames', {}, 'A storm over the pier.') }));
			const hailuo = error(await providers.submit({ ...access(server.url, 'cn'), ...generation('hailuo-02', 'frames', {}, 'A storm over the pier.') }));
			drop = false;
			const busy = error(await providers.submit({ ...access(server.url), ...generation('hailuo-2.3', 'frames', {}, 'A storm over the pier.') }));
			assert.deepEqual({
				codes: [h3.code, hailuo.code, busy.code],
				dropped: [h3.message, hailuo.message].map(message => message.startsWith('The connection ended after the request was sent')),
				busy: busy.message,
				sent: server.received.map(entry => `${entry.method} ${entry.path}`),
				waits: sleep.waits
			}, {
				codes: ['unknownOutcome', 'unknownOutcome', 'unknownOutcome'],
				dropped: [true, true],
				busy: 'internal error (1000)',
				sent: ['POST /v2/video_generation', 'POST /v1/video_generation', 'POST /v1/video_generation'],
				waits: []
			});
		} finally {
			await server.close();
		}
	});

	test('check reports the rules between settings, the inputs MiniMax refuses, and nothing for a planned generation that can run', async () => {
		const providers = commands();
		const problems = async (model: string, mode: string, params: Record<string, unknown>, inputs: object, region = 'intl', prompt = 'A storm over the pier.') =>
			value(await providers.check({ provider: 'minimax', region, model, mode, params, prompt, inputs })).problems;
		const frame = { images: [], videos: [], audios: [] };
		assert.deepEqual({
			adaptiveWithoutFrame: await problems('h3', 'frames', { ratio: 'adaptive' }, plannedFiles()),
			ratioWithFrame: await problems('h3-max', 'frames', { ratio: '9:16' }, plannedFiles({ startFrame: true })),
			adaptiveWithFrames: await problems('h3', 'frames', { ratio: 'adaptive' }, plannedFiles({ startFrame: true, endFrame: true })),
			noReferences: await problems('h3', 'reference', {}, plannedFiles()),
			tooManyReferences: await problems('h3', 'reference', {}, plannedFiles({ images: 9, videos: 3, audios: 1 })),
			watermarkAbroad: await problems('h3', 'frames', { watermark: true }, plannedFiles()),
			watermarkInChina: await problems('h3-max', 'frames', { watermark: true }, plannedFiles(), 'cn'),
			fullHdTenSeconds: await problems('hailuo-02', 'frames', { resolution: '1080p', duration: 10 }, plannedFiles()),
			fullHdSixSeconds: await problems('hailuo-2.3', 'frames', { resolution: '1080p', duration: 6 }, plannedFiles()),
			lowWithoutFrame: await problems('hailuo-02', 'frames', { resolution: '512p' }, plannedFiles()),
			lowWithEndFrame: await problems('hailuo-02', 'frames', { resolution: '512p' }, plannedFiles({ startFrame: true, endFrame: true })),
			// MiniMax's own spellings and field names are not the catalog's.
			minimaxSpelling: await problems('h3', 'frames', { resolution: '768P' }, plannedFiles()),
			minimaxField: await problems('hailuo-2.3', 'frames', { prompt_optimizer: false }, plannedFiles()),
			fastWithEndFrame: await problems('hailuo-02', 'frames', { fast_pretreatment: true }, plannedFiles({ startFrame: true, endFrame: true })),
			fastNeedsFrame: await problems('hailuo-2.3-fast', 'frames', {}, plannedFiles()),
			noEndFrame: await problems('hailuo-2.3', 'frames', {}, plannedFiles({ startFrame: true, endFrame: true })),
			shortMax: await problems('h3-max', 'frames', { duration: 4 }, plannedFiles()),
			noPrompt: await problems('h3', 'reference', {}, plannedFiles({ images: 1 }), 'intl', ''),
			longPrompt: await problems('hailuo-2.3', 'frames', {}, plannedFiles(), 'intl', 'x'.repeat(2001)),
			gif: await problems('h3', 'reference', {}, { ...frame, images: [MOTION] }),
			m4a: await problems('h3-max', 'reference', {}, { ...frame, audios: [SONG] }),
			tinyFrame: await problems('hailuo-2.3', 'frames', {}, { ...frame, startFrame: TINY }),
			canRun: await problems('h3', 'reference', { resolution: '2k' }, { images: [CHARACTER, PLACE], videos: [DANCE], audios: [VOICE] })
		}, {
			adaptiveWithoutFrame: ['MiniMax H3 needs a ratio for a video made from the prompt alone: choose one, or connect an image.'],
			ratioWithFrame: [],
			adaptiveWithFrames: [],
			noReferences: ['MiniMax H3 in References mode needs at least one image, video, or audio clip.'],
			tooManyReferences: ['MiniMax H3 takes at most 12 references together; 13 are planned.'],
			watermarkAbroad: ['MiniMax offers the AIGC watermark only in China: turn it off, or set up MiniMax in the China region.'],
			watermarkInChina: [],
			fullHdTenSeconds: ['Hailuo 02 makes 1080P videos of 6 seconds only: choose 6 seconds, or another resolution.'],
			fullHdSixSeconds: [],
			lowWithoutFrame: ['Hailuo 02 makes 512P videos only from a start frame: connect an image, or choose another resolution.'],
			lowWithEndFrame: ['Hailuo 02 makes 512P videos only without an end frame: remove it, or choose another resolution.'],
			minimaxSpelling: ['Resolution cannot be 768P for MiniMax H3; choose 768p, 2K.'],
			minimaxField: ['Hailuo 2.3 has no setting named "prompt_optimizer".'],
			fastWithEndFrame: ['Hailuo 02 offers Fast Optimization only without an end frame: turn it off, or remove the end frame.'],
			fastNeedsFrame: ['Hailuo 2.3 Fast in Frames mode needs a start frame.'],
			noEndFrame: ['Hailuo 2.3 in Frames mode takes no end frame.'],
			shortMax: ['Duration must be between 5 and 15 seconds.'],
			noPrompt: ['Write a prompt: MiniMax H3 needs one.'],
			longPrompt: ['The prompt is 2001 characters long; Hailuo 2.3 takes at most 2000.'],
			gif: ['Reference image 1 motion.gif is a GIF image; this mode takes PNG, JPEG, or WebP images.'],
			m4a: ['Reference audio 1 song.m4a is M4A audio; MiniMax takes WAV or MP3.'],
			tinyFrame: ['The start frame tiny.png is 300 × 300 px; each side must be at least 301 px.'],
			canRun: []
		});
	});

	test('no message carries the key, and a relay endpoint with a path is followed', async () => {
		const relay = await startServer((request, response) => {
			if (request.path.startsWith('/minimax/v2/query/')) {
				sendJson(response, 400, { type: 'error', error: { type: 'bad_request_error', message: `unknown key ${String(request.headers.authorization)}`, http_code: '400' } });
				return;
			}
			sendJson(response, 200, { task_id: '424010985738601' });
		});
		try {
			const providers = commands();
			const endpoint = `${relay.url}/minimax`;
			const created = value(await providers.submit({ ...access(endpoint), ...generation('h3', 'frames', {}, 'A storm over the pier.') }));
			const echoed = error(await providers.poll({ ...access(endpoint), model: 'h3', remoteId: remoteIdIn(created) }));
			assert.deepEqual({ created, echoed, paths: relay.received.map(entry => entry.path) }, {
				created: { remoteId: '424010985738601' },
				echoed: { code: 'rejected', message: 'unknown key Bearer ***', status: 400 },
				paths: ['/minimax/v2/video_generation', '/minimax/v2/query/video_generation/424010985738601']
			});
		} finally {
			await relay.close();
		}
	});

	// --- the image models ---------------------------------------------------------------------------

	/** An image request in References mode, with a new target for each image it may make. */
	function imageGeneration(model: string, params: Record<string, unknown>, prompt: string, inputs: object = NO_INPUTS) {
		const count = typeof params.count === 'number' ? params.count : 1;
		return { model, mode: 'reference', params, prompt, inputs, targets: partTargets(count) };
	}

	/** MiniMax's answer with these images as base64 and `withheld` images its content check stopped. */
	function imagesAnswer(files: readonly Buffer[], withheld = 0): Record<string, unknown> {
		return {
			id: '03ff3cd0820949eb8a410056b5f21d38',
			data: { image_base64: files.map(file => file.toString('base64')) },
			metadata: { success_count: String(files.length), failed_count: String(withheld) },
			base_resp: { status_code: 0, status_msg: 'success' }
		};
	}

	/** The JSON bodies of the image requests a server received, in order. */
	function imageBodies(received: readonly Received[]): Record<string, unknown>[] {
		return received.filter(entry => entry.method === 'POST' && entry.path.endsWith('/v1/image_generation')).map(entry => JSON.parse(entry.body.toString('utf8')));
	}

	function outputsOf(submitted: unknown): Output[] {
		return (submitted as { readonly outputs: Output[] }).outputs;
	}

	test('the image models answer at once: Image-01 in both regions and Image-01 Live in China, with one reference, JPEG, and their parameters', () => {
		const provider = buildCatalog([MINIMAX]).providers[0];
		const images = Object.fromEntries(provider.models.filter(model => model.kind === 'image').map(model => [model.id, {
			label: model.label,
			ids: model.providerModels,
			format: model.outputFormat,
			atOnce: model.answersAtOnce,
			prompt: `${model.prompt.required} ${model.prompt.maxLength}`,
			modes: model.modes.map(mode => `${mode.id}: start ${mode.inputs.startFrame}, end ${mode.inputs.endFrame}, images ${mode.inputs.images.min}-${mode.inputs.images.max}, videos ${mode.inputs.videos.max}, audio ${mode.inputs.audios.max}`),
			limits: model.modes.map(mode => mode.limits),
			parameters: model.parameters.map(summary)
		}]));
		const reference = ['reference: start none, end none, images 0-1, videos 0, audio 0'];
		const limits = [{ imageFormats: ['png', 'jpeg'], imageMaxBytes: 10 * MIB - 1 }];
		const tail = ['seed=0-2147483647/1:unset (more)', 'watermark:false (more)'];
		assert.deepEqual(images, {
			'image-01': {
				label: 'MiniMax Image-01',
				ids: { cn: 'image-01', intl: 'image-01' },
				format: 'jpeg',
				atOnce: true,
				prompt: 'always 1500',
				modes: reference,
				limits,
				parameters: ['ratio=16:9|4:3|3:2|1:1|2:3|3:4|9:16|21:9:1:1', 'count=1-9/1:1', 'prompt_extend:false', ...tail]
			},
			'image-01-live': {
				label: 'MiniMax Image-01 Live',
				ids: { cn: 'image-01-live' },
				format: 'jpeg',
				atOnce: true,
				prompt: 'always 1500',
				modes: reference,
				limits,
				parameters: ['ratio=16:9|4:3|3:2|1:1|2:3|3:4|9:16:1:1', 'count=1-9/1:1', 'prompt_extend:false', 'style_type=comic|lively|medieval|watercolor:undefined', 'style_weight=0.1-1/0.1:0.8 (more)', ...tail]
			}
		});
		const style = provider.models.find(model => model.id === 'image-01-live')?.parameters.find(parameter => parameter.name === 'style_type');
		assert.deepEqual(style?.kind === 'choice' ? { labels: style.options.map(option => option.label), optional: style.optional } : undefined, { labels: ['Comic', 'Lively', 'Medieval', 'Watercolor'], optional: true });
	});

	test('an image request is sent once with the exact body: the prompt alone, a character reference as a data URL, the seed, the style as MiniMax words it, and the watermark in China only', async () => {
		const server = await startServer((request, response) => {
			const body = JSON.parse(request.body.toString('utf8'));
			sendJson(response, 200, imagesAnswer(Array.from({ length: Number(body.n) }, () => tinyJpeg())));
		});
		try {
			const providers = commands();
			const sent = async (region: string, request: ReturnType<typeof imageGeneration>) => {
				const outputs = outputsOf(value(await providers.submit({ ...access(server.url, region), ...request })));
				return { body: imageBodies(server.received).at(-1), outputs: outputs.map(output => (output as { readonly format?: string }).format ?? output) };
			};
			const alone = await sent('intl', imageGeneration('image-01', { ratio: '16:9', count: 3, prompt_extend: true }, 'A man in a white t-shirt on Venice Beach, 90s documentary style.'));
			const person = await sent('cn', imageGeneration('image-01', { seed: 42, watermark: true }, 'Image 1 reading in a library.', { images: [CHARACTER], videos: [], audios: [] }));
			const styled = await sent('cn', imageGeneration('image-01-live', { ratio: '9:16', style_type: 'watercolor', style_weight: 0.5 }, 'A girl looking out of a window.', { images: [END], videos: [], audios: [] }));
			const plain = await sent('cn', imageGeneration('image-01-live', {}, 'A girl looking out of a window.'));
			assert.deepEqual({ alone, person, styled, plain, paths: server.received.map(entry => `${entry.method} ${entry.path} ${entry.headers.authorization}`) }, {
				alone: {
					body: { model: 'image-01', prompt: 'A man in a white t-shirt on Venice Beach, 90s documentary style.', aspect_ratio: '16:9', n: 3, prompt_optimizer: true, response_format: 'base64' },
					outputs: ['jpeg', 'jpeg', 'jpeg']
				},
				person: {
					body: {
						model: 'image-01',
						prompt: 'Image 1 reading in a library.',
						aspect_ratio: '1:1',
						n: 1,
						prompt_optimizer: false,
						response_format: 'base64',
						seed: 42,
						subject_reference: [{ type: 'character', image_file: `data:image/png;base64,${base64(CHARACTER)}` }],
						aigc_watermark: true
					},
					outputs: ['jpeg']
				},
				styled: {
					body: {
						model: 'image-01-live',
						prompt: 'A girl looking out of a window.',
						aspect_ratio: '9:16',
						n: 1,
						prompt_optimizer: false,
						response_format: 'base64',
						subject_reference: [{ type: 'character', image_file: `data:image/jpeg;base64,${base64(END)}` }],
						style: { style_type: '水彩', style_weight: 0.5 },
						aigc_watermark: false
					},
					outputs: ['jpeg']
				},
				// Without a style, no style is sent.
				plain: {
					body: { model: 'image-01-live', prompt: 'A girl looking out of a window.', aspect_ratio: '1:1', n: 1, prompt_optimizer: false, response_format: 'base64', aigc_watermark: false },
					outputs: ['jpeg']
				},
				paths: Array.from({ length: 4 }, () => `POST /v1/image_generation Bearer ${KEY}`)
			});
		} finally {
			await server.close();
		}
	});

	test('the images answered land in MiniMax\'s order, the ones its content check withheld are refused alone, and addresses download without the key', async () => {
		const files = await startServer(routed(serveFiles({ '/image/1.jpeg': tinyJpeg(), '/image/2.png': tinyPng() })));
		let answer: Record<string, unknown> = {};
		const server = await startServer((request, response) => sendJson(response, 200, answer));
		try {
			const providers = commands();
			const submit = async (count: number) => {
				const request = { ...access(server.url), ...imageGeneration('image-01', { count }, 'Four postcards of one city.') };
				return { request, outputs: outputsOf(value(await providers.submit(request))) };
			};
			answer = imagesAnswer([tinyJpeg(), tinyPng()], 2);
			const withheld = await submit(4);
			answer = { data: { image_urls: [`${files.url}/image/1.jpeg`, `${files.url}/image/2.png`, 7] }, metadata: { success_count: 2, failed_count: 0 }, base_resp: { status_code: 0, status_msg: 'success' } };
			const addresses = await submit(3);
			const target = partTargets(1)[0];
			const downloaded = value(await providers.download({ ...access(server.url), model: 'image-01', kind: 'image', url: `${files.url}/image/1.jpeg`, targetFsPath: target }));
			answer = { metadata: { success_count: 0, failed_count: 2 }, base_resp: { status_code: 0, status_msg: 'success' } };
			const allWithheld = await submit(2);
			const blocked = 'MiniMax\'s content check stopped this image.';
			assert.deepEqual({
				withheld: withheld.outputs,
				written: [readFileSync(withheld.request.targets[0]).equals(tinyJpeg()), readFileSync(withheld.request.targets[1]).equals(tinyPng())],
				addresses: addresses.outputs,
				downloaded,
				keySent: files.received.map(entry => entry.headers.authorization ?? 'none'),
				allWithheld: allWithheld.outputs
			}, {
				withheld: [
					{ written: withheld.request.targets[0], size: tinyJpeg().byteLength, format: 'jpeg' },
					{ written: withheld.request.targets[1], size: tinyPng().byteLength, format: 'png' },
					{ refused: blocked },
					{ refused: blocked }
				],
				written: [true, true],
				addresses: [{ url: `${files.url}/image/1.jpeg` }, { url: `${files.url}/image/2.png` }, { refused: 'MiniMax answered an image BaseHalf cannot read.' }],
				downloaded: { size: tinyJpeg().byteLength, format: 'jpeg' },
				keySent: ['none'],
				allWithheld: [{ refused: blocked }, { refused: blocked }]
			});
		} finally {
			await server.close();
			await files.close();
		}
	});

	test('an image request refused by base_resp, by its HTTP status, or whose answer is lost is sent once and maps as a video request does', async () => {
		let respond: (response: ServerResponse) => void = response => sendJson(response, 200, {});
		const server = await startServer((request, response, socket) => {
			if (request.path === '/drop/v1/image_generation') {
				socket.destroy();
				return;
			}
			respond(response);
		});
		try {
			const providers = commands();
			const create = async (answer: (response: ServerResponse) => void, endpoint = server.url) => {
				respond = answer;
				return error(await providers.submit({ ...access(endpoint), ...imageGeneration('image-01', {}, 'A storm over the pier.') }));
			};
			const code = (status: number, message: string) => (response: ServerResponse) => sendJson(response, 200, { id: '03ff3cd0820949eb8a410056b5f21d38', base_resp: { status_code: status, status_msg: message } });
			const before = server.received.length;
			const outcomes = {
				sensitive: await create(code(1026, 'input new_sensitive')),
				balance: await create(code(1008, 'insufficient balance')),
				key: await create(code(2049, 'invalid api key')),
				busy: await create(code(1002, 'rate limit')),
				params: await create(code(2013, 'invalid params, aspect_ratio')),
				internal: await create(code(1000, 'unknown error')),
				unauthorized: await create(response => sendJson(response, 401, { base_resp: { status_code: 1004, status_msg: 'login fail: Please carry the API secret key in the \'Authorization\' field of the request header' } })),
				limited: await create(response => sendJson(response, 429, { base_resp: { status_code: 1002, status_msg: 'rate limit' } }, { 'Retry-After': '4' })),
				nothing: await create(response => sendJson(response, 200, { base_resp: { status_code: 0, status_msg: 'success' } })),
				dropped: (await create(() => undefined, `${server.url}/drop`)).code
			};
			assert.deepEqual({ outcomes, sent: server.received.length - before }, {
				outcomes: {
					sensitive: { code: 'rejected', message: 'input new_sensitive (1026)' },
					balance: { code: 'balance', message: 'insufficient balance (1008)' },
					key: { code: 'auth', message: 'invalid api key (2049)' },
					busy: { code: 'rateLimited', message: `rate limit (1002) ${LIMITS}` },
					params: { code: 'rejected', message: 'invalid params, aspect_ratio (2013)' },
					internal: { code: 'unknownOutcome', message: 'unknown error (1000)' },
					unauthorized: { code: 'auth', message: 'login fail: Please carry the API secret key in the \'Authorization\' field of the request header (1004)', status: 401 },
					limited: { code: 'rateLimited', message: `rate limit (1002) ${LIMITS} The provider asks to wait 4 seconds.`, status: 429 },
					nothing: { code: 'unknownOutcome', message: 'MiniMax accepted the request but answered no images BaseHalf can read.' },
					dropped: 'unknownOutcome'
				},
				// Each request was sent once, never again.
				sent: 10
			});
		} finally {
			await server.close();
		}
	});

	test('check reports the watermark outside China, and the declarations refuse what the image models do not take', async () => {
		const providers = commands();
		const problems = async (model: string, params: Record<string, unknown>, prompt: string, inputs: object, region = 'intl') =>
			value(await providers.check({ provider: 'minimax', region, model, mode: 'reference', params, prompt, inputs })).problems;
		assert.deepEqual(await problems('image-01', { watermark: true }, 'p', NO_INPUTS), ['MiniMax offers the AIGC watermark only in China: turn it off, or set up MiniMax in the China region.']);
		assert.deepEqual(await problems('image-01', { watermark: true, count: 9 }, 'p', { images: [CHARACTER], videos: [], audios: [] }, 'cn'), []);
		assert.deepEqual(await problems('image-01-live', {}, 'p', NO_INPUTS), ['MiniMax does not offer MiniMax Image-01 Live in International.']);
		assert.deepEqual(await problems('image-01', {}, 'p', { images: [CHARACTER, TINY], videos: [], audios: [] }), ['MiniMax Image-01 in References mode takes at most 1 reference image; 2 are planned.']);
		assert.deepEqual(await problems('image-01', {}, 'p', { images: [PLACE], videos: [], audios: [] }), ['Reference image 1 place.webp is a WebP image; this mode takes PNG or JPEG images.']);
		assert.deepEqual(await problems('image-01-live', { ratio: '21:9' }, 'p', NO_INPUTS, 'cn'), ['Ratio cannot be 21:9 for MiniMax Image-01 Live; choose 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16.']);
		assert.deepEqual(await problems('image-01-live', { style_type: 'anime' }, 'p', NO_INPUTS, 'cn'), ['Style cannot be anime for MiniMax Image-01 Live; choose Comic, Lively, Medieval, Watercolor.']);
		assert.deepEqual(await problems('image-01', { count: 10 }, 'p', NO_INPUTS), ['Images must be between 1 and 9.']);
		assert.deepEqual(await problems('image-01', {}, 'x'.repeat(1501), NO_INPUTS), ['The prompt is 1501 characters long; MiniMax Image-01 takes at most 1500.']);
		assert.deepEqual(await problems('image-01', {}, '', NO_INPUTS), ['Write a prompt: MiniMax Image-01 needs one.']);
	});

	test('an image model has no task: poll refuses it, and cancel answers false without a request', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, { task: { id: '1', status: 'queued' } }));
		try {
			const providers = commands();
			const ref = { ...access(server.url, 'cn'), model: 'image-01-live', remoteId: '03ff3cd0820949eb8a410056b5f21d38' };
			assert.deepEqual({ poll: error(await providers.poll(ref)), cancel: value(await providers.cancel(ref)), sent: server.received.length }, {
				poll: { code: 'rejected', message: 'MiniMax Image-01 Live answers with its images at once: there is no task to ask about.' },
				cancel: { cancelled: false },
				sent: 0
			});
		} finally {
			await server.close();
		}
	});
});
