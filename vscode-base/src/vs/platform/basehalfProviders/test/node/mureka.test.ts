/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Mureka module (D78; `docs/specs/providers/mureka.md`) through the
 * provider commands, against local servers that answer like Mureka's API and
 * its file host: the catalog entry, the exact requests of each model and mode
 * with a reference song uploaded first, Songs, every task state, the errors,
 * a create that never answers, and the rules of `check`.
 */

import { strict as assert } from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { hasKey } from '../../../../base/common/types.js';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../../node/commands.js';
import { MUREKA } from '../../node/mureka.js';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import type { CatalogParameter, PollState } from '../../common/basehalfProviderTypes.js';
import { audioRequest, error, isoMedia, mp3, multipartParts, partTargets, recordingSleep, remoteIdOf, sendJson, startServer, testAccess, tinyMp3, value, wav, type AudioRequestOptions, type Received } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: mureka', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const folder = mkdtempSync(join(tmpdir(), 'basehalf-mureka-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

	const MIB = 1024 * 1024;
	const KEY = 'op_mureka-test-key-0123456789';
	const LYRICS = '[Verse]\nIn the stormy night, I wander alone\nLost in the rain, feeling like I have been thrown\n\n[Chorus]\nHold on, hold on';
	const BUSY = 'Mureka works on only as many generations at once as the account\'s top-up allows: wait for one to finish.';

	function file(name: string, bytes: Buffer, mimeType: string) {
		const fsPath = join(folder, name);
		writeFileSync(fsPath, bytes);
		return { fsPath, mimeType };
	}

	/** An MP3 whose Xing header says 1,200 frames, 31.3 seconds, in the bytes of four. */
	const SONG_BYTES = mp3(4, { xingFrames: 1200 });
	const M4A_BYTES = isoMedia(31, { brand: 'M4A ' });
	const SONG = file('song.mp3', SONG_BYTES, 'audio/mpeg');
	const SONG_M4A = file('song.m4a', M4A_BYTES, 'audio/mp4');
	/** 460 frames: 12.0 seconds. */
	const HUM = file('hum.mp3', mp3(4, { xingFrames: 460 }), 'audio/mpeg');
	const WAVE = file('song.wav', wav(31), 'audio/wav');
	const LARGE = file('large.mp3', Buffer.concat([SONG_BYTES, Buffer.alloc(11 * MIB)]), 'audio/mpeg');

	function commands(options: VideoProviderCommandOptions = {}, sleep = recordingSleep().sleep) {
		return new VideoProviderCommands([MUREKA], { ...options, http: { sleep, ...options.http } });
	}

	function access(server: string) {
		return testAccess(MUREKA, server, { apiKey: KEY });
	}

	/** A planned song of a Mureka model, which runs as a task: no target is named. */
	function song(server: string, model: string, options: AudioRequestOptions = {}) {
		return audioRequest(access(server), model, { targets: 0, ...options });
	}

	function taskRef(server: string, model: string, remoteId: string) {
		return { ...access(server), model, remoteId };
	}

	interface FakeMureka {
		/** The endpoint to enter: the fake's origin, as Mureka's base URL is. */
		readonly url: string;
		/** Where the songs are, another origin, as Mureka's file host is. */
		readonly cdnUrl: string;
		readonly received: Received[];
		readonly cdnReceived: Received[];
		/**
		 * The statuses a task answers, one per query, the last one again and
		 * again; `failed:<reason>` and `timeouted:<reason>` add Mureka's reason.
		 */
		script(remoteId: string, statuses: readonly string[]): void;
		close(): Promise<void>;
	}

	/** The creates of Mureka's API, by path, with the query of the task each makes. */
	const CREATES: Readonly<Record<string, string>> = Object.freeze({
		'/v1/song/easy-generate': 'song',
		'/v1/song/generate': 'song',
		'/v1/instrumental/generate': 'instrumental'
	});

	/** A local server that answers like Mureka's API: uploads, the three creates, and the two queries. */
	async function startMureka(): Promise<FakeMureka> {
		const cdn = await startServer((request, response) => {
			response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(tinyMp3().byteLength) });
			response.end(tinyMp3());
		});
		const tasks = new Map<string, { readonly n: number; readonly model: string; statuses: string[] }>();
		let made = 0;
		let uploads = 0;
		const server = await startServer((request, response) => {
			const path = request.path.split('?')[0];
			if (request.method === 'POST' && path === '/v1/files/upload') {
				const parts = multipartParts(request);
				const media = parts.find(part => part.name === 'file');
				sendJson(response, 200, { id: String(542321 + uploads++), filename: media?.fileName, bytes: media?.bytes.byteLength, created_at: 1677610602, purpose: parts.find(part => part.name === 'purpose')?.bytes.toString('utf8') });
				return;
			}
			const kind = request.method === 'POST' ? CREATES[path] : undefined;
			if (kind) {
				const body = JSON.parse(request.body.toString('utf8'));
				const id = String(1436211 + made++);
				tasks.set(`${kind}/${id}`, { n: typeof body.n === 'number' ? body.n : 2, model: body.model, statuses: ['preparing'] });
				sendJson(response, 200, { id, created_at: 1677610602, model: body.model, status: 'preparing', trace_id: `trace-${id}` });
				return;
			}
			const query = request.method === 'GET' ? /^\/v1\/(?<kind>song|instrumental)\/query\/(?<id>[^/]+)$/.exec(path)?.groups : undefined;
			const remoteId = query ? `${query.kind}/${decodeURIComponent(query.id)}` : '';
			const task = tasks.get(remoteId);
			if (!query || !task) {
				sendJson(response, 404, { error: { message: 'Not Found' }, trace_id: 'trace-404' });
				return;
			}
			const entry = task.statuses.length > 1 ? task.statuses.shift() ?? '' : task.statuses[0];
			const colon = entry.indexOf(':');
			const status = colon < 0 ? entry : entry.slice(0, colon);
			const id = remoteId.slice(remoteId.indexOf('/') + 1);
			// The choices come in another order than their indexes.
			const choices = Array.from({ length: task.n }, (_unused, index) => ({
				index,
				id: `${id}-${index}`,
				url: `${cdn.url}/${query.kind}-${id}-${index}.mp3`,
				flac_url: `${cdn.url}/${query.kind}-${id}-${index}.flac`,
				wav_url: `${cdn.url}/${query.kind}-${id}-${index}.wav`,
				duration: 182000,
				lyrics_sections: [{ section_type: 'verse', start: 0, end: 30000, lines: [] }]
			})).reverse();
			sendJson(response, 200, {
				id,
				created_at: 1677610602,
				model: task.model,
				status,
				...(colon < 0 ? {} : { failed_reason: entry.slice(colon + 1) }),
				...(status === 'succeeded' ? { finished_at: 1677610652, choices } : {}),
				trace_id: `trace-${id}`
			});
		});
		return {
			url: server.url,
			cdnUrl: cdn.url,
			received: server.received,
			cdnReceived: cdn.received,
			script: (remoteId, statuses) => {
				const task = tasks.get(remoteId);
				assert.ok(task, `the fake made no task ${remoteId}`);
				task.statuses = [...statuses];
			},
			close: async () => {
				await server.close();
				await cdn.close();
			}
		};
	}

	/** A create the fake received, as its method, path, credentials, type, and JSON body. */
	function sent(entry: Received): unknown[] {
		return [entry.method, entry.path, entry.headers.authorization, entry.headers['content-type'], JSON.parse(entry.body.toString('utf8'))];
	}

	async function pollEach(providers: VideoProviderCommands, ref: Record<string, unknown>, times: number): Promise<PollState[]> {
		const states: PollState[] = [];
		for (let index = 0; index < times; index++) {
			states.push(value(await providers.poll(ref)));
		}
		return states;
	}

	function summary(parameter: CatalogParameter): string {
		const modes = parameter.modes ? ` (${parameter.modes.join(', ')})` : '';
		switch (parameter.kind) {
			case 'integer':
			case 'number':
				return `${parameter.name}=${parameter.min}-${parameter.max}/${parameter.step}:${parameter.default}${modes}`;
			case 'text':
				return `${parameter.name}=text ${parameter.maxLength}${parameter.optional ? ', optional' : ''}${modes}`;
			default:
				return `${parameter.name}:${String(parameter.default)}${modes}`;
		}
	}

	test('the catalog entry declares one region, the API key, and Mureka 9.5 and Mureka O2 as music in MP3 with their modes, inputs, limits, and parameters, the last of the providers', () => {
		const provider = buildCatalog([MUREKA]).providers[0];
		const models = Object.fromEntries(provider.models.map(model => [model.id, {
			label: model.label,
			makes: `${model.kind} ${model.makes} ${model.outputFormat}`,
			ids: model.providerModels,
			atOnce: model.answersAtOnce,
			prompt: `${model.prompt.required} ${model.prompt.maxLength}`,
			modes: model.modes.map(mode => `${mode.id} ${mode.label}: start ${mode.inputs.startFrame}, images ${mode.inputs.images.max}, videos ${mode.inputs.videos.max}, audio ${mode.inputs.audios.min}-${mode.inputs.audios.max}, source ${mode.inputs.source}`),
			limits: model.modes.map(mode => mode.limits),
			parameters: model.parameters.map(summary)
		}]));
		const modes = [
			'reference From a Description: start none, images 0, videos 0, audio 0-1, source none',
			'lyrics From Lyrics: start none, images 0, videos 0, audio 0-1, source none'
		];
		const limits = [{ audioMaxBytes: 10 * MIB }, { audioMaxBytes: 10 * MIB }];
		const style = 'style=text 1024, optional (lyrics)';
		assert.deepEqual({
			id: provider.id,
			label: provider.label,
			regions: provider.regions,
			credentials: provider.credentials,
			models,
			last: PROVIDER_MODULES.at(-1) === MUREKA,
			shipped: buildCatalog().providers.some(entry => entry.id === 'mureka')
		}, {
			id: 'mureka',
			label: 'Mureka',
			regions: [{ id: 'global', label: 'Global', baseUrl: 'https://api.mureka.ai', console: 'https://platform.mureka.ai/apiKeys' }],
			credentials: [{ id: 'apiKey', label: 'API Key' }],
			models: {
				'mureka-9.5': { label: 'Mureka 9.5', makes: 'audio music mp3', ids: { global: 'mureka-9.5' }, atOnce: undefined, prompt: 'always 5000', modes, limits, parameters: ['count=1-3/1:2', 'instrumental:false (reference)', style] },
				// Mureka's instrumental call does not take O2.
				'mureka-o2': { label: 'Mureka O2', makes: 'audio music mp3', ids: { global: 'mureka-o2' }, atOnce: undefined, prompt: 'always 5000', modes, limits, parameters: ['count=1-3/1:2', style] }
			},
			last: true,
			shipped: true
		});
		assert.deepEqual(provider.models[0].parameters.map(parameter => [parameter.label, parameter.tooltip]), [
			['Songs', 'How many songs to make with one request. Each song lands on its own card.'],
			['Instrumental', 'Music without singing, made from the description alone.'],
			['Style', 'The style of the song: its genre, mood, instruments, and voice, such as "r&b, slow, passionate, male vocal".']
		]);
	});

	test('From a Description sends the description and the chosen model to Prompt to song, or with Instrumental on to the instrumental call, and From Lyrics sends the lyrics and Style to Lyrics to song, each once with Songs as n', async () => {
		const fake = await startMureka();
		try {
			const providers = commands();
			const ids = [
				remoteIdOf(await providers.submit(song(fake.url, 'mureka-9.5', { prompt: 'A bright summer love song with a catchy chorus' }))),
				remoteIdOf(await providers.submit(song(fake.url, 'mureka-o2', { prompt: 'A lullaby for a rainy night', params: { count: 1 } }))),
				remoteIdOf(await providers.submit(song(fake.url, 'mureka-9.5', { prompt: 'Calm piano for a morning walk', params: { instrumental: true, count: 3 } }))),
				remoteIdOf(await providers.submit(song(fake.url, 'mureka-9.5', { mode: 'lyrics', prompt: LYRICS, params: { style: 'r&b, slow, passionate, male vocal' } }))),
				// A Style of spaces alone is no Style.
				remoteIdOf(await providers.submit(song(fake.url, 'mureka-o2', { mode: 'lyrics', prompt: LYRICS, params: { style: '   ', count: 3 } })))
			];
			const auth = `Bearer ${KEY}`;
			assert.deepEqual({ ids, sent: fake.received.map(sent) }, {
				ids: ['song/1436211', 'song/1436212', 'instrumental/1436213', 'song/1436214', 'song/1436215'],
				sent: [
					['POST', '/v1/song/easy-generate', auth, 'application/json', { model: 'mureka-9.5', prompt: 'A bright summer love song with a catchy chorus', n: 2 }],
					['POST', '/v1/song/easy-generate', auth, 'application/json', { model: 'mureka-o2', prompt: 'A lullaby for a rainy night', n: 1 }],
					['POST', '/v1/instrumental/generate', auth, 'application/json', { model: 'mureka-9.5', prompt: 'Calm piano for a morning walk', n: 3 }],
					['POST', '/v1/song/generate', auth, 'application/json', { lyrics: LYRICS, model: 'mureka-9.5', n: 2, prompt: 'r&b, slow, passionate, male vocal' }],
					['POST', '/v1/song/generate', auth, 'application/json', { lyrics: LYRICS, model: 'mureka-o2', n: 3 }]
				]
			});
		} finally {
			await fake.close();
		}
	});

	test('a reference song is uploaded for the purpose reference before its task is created and sent as reference_id, as an MP3 or an M4A, in both modes; its mention takes the shared name', async () => {
		const fake = await startMureka();
		try {
			const providers = commands();
			const ids = [
				remoteIdOf(await providers.submit(song(fake.url, 'mureka-9.5', { prompt: ['A song like ', { input: 'audios', index: 0 }, ', about the sea'], inputs: { audios: [SONG] } }))),
				remoteIdOf(await providers.submit(song(fake.url, 'mureka-o2', { mode: 'lyrics', prompt: LYRICS, params: { count: 1 }, inputs: { audios: [SONG_M4A] } })))
			];
			const uploads = fake.received.filter(entry => entry.path === '/v1/files/upload').map(entry => [
				entry.headers.authorization,
				...multipartParts(entry).map(part => part.fileName === undefined
					? `${part.name}=${part.bytes.toString('utf8')}`
					: `${part.name}=${part.fileName} ${part.contentType} ${part.bytes.equals(part.fileName.endsWith('.mp3') ? SONG_BYTES : M4A_BYTES) ? 'same' : 'other'}`)
			]);
			assert.deepEqual({
				ids,
				order: fake.received.map(entry => `${entry.method} ${entry.path}`),
				uploads,
				creates: fake.received.filter(entry => entry.path !== '/v1/files/upload').map(entry => JSON.parse(entry.body.toString('utf8')))
			}, {
				ids: ['song/1436211', 'song/1436212'],
				order: ['POST /v1/files/upload', 'POST /v1/song/easy-generate', 'POST /v1/files/upload', 'POST /v1/song/generate'],
				uploads: [
					[`Bearer ${KEY}`, 'purpose=reference', 'file=reference-song.mp3 audio/mpeg same'],
					[`Bearer ${KEY}`, 'purpose=reference', 'file=reference-song.m4a audio/mp4 same']
				],
				creates: [
					// Mureka documents no names for inputs: the shared one.
					{ model: 'mureka-9.5', prompt: 'A song like Audio 1, about the sea', n: 2, reference_id: '542321' },
					{ lyrics: LYRICS, model: 'mureka-o2', n: 1, reference_id: '542322' }
				]
			});
		} finally {
			await fake.close();
		}
	});

	test('Songs of 1 and of 3 land one song per choice, in the order of the choices, from addresses downloaded without the key', async () => {
		const fake = await startMureka();
		try {
			const providers = commands();
			const one = remoteIdOf(await providers.submit(song(fake.url, 'mureka-9.5', { prompt: 'A short jingle for a bakery', params: { count: 1 } })));
			const three = remoteIdOf(await providers.submit(song(fake.url, 'mureka-o2', { mode: 'lyrics', prompt: LYRICS, params: { count: 3 } })));
			fake.script(one, ['succeeded']);
			fake.script(three, ['succeeded']);
			const polled = [
				value(await providers.poll(taskRef(fake.url, 'mureka-9.5', one))),
				value(await providers.poll(taskRef(fake.url, 'mureka-o2', three)))
			];
			const urls = polled.map(state => state.state === 'succeeded' ? (state.outputs ?? []).map(output => hasKey(output, { url: true }) ? output.url : JSON.stringify(output)) : []);
			const downloads = [];
			for (const url of urls.flat()) {
				downloads.push(value(await providers.download({ ...taskRef(fake.url, 'mureka-o2', three), kind: 'audio', url, targetFsPath: partTargets(1)[0] })));
			}
			assert.deepEqual({
				n: fake.received.filter(entry => entry.method === 'POST').map(entry => JSON.parse(entry.body.toString('utf8')).n),
				states: polled.map(state => state.state),
				addresses: urls.map(list => list.map(url => url.replace(fake.cdnUrl, ''))),
				downloads,
				keySent: fake.cdnReceived.some(entry => entry.headers.authorization !== undefined)
			}, {
				n: [1, 3],
				states: ['succeeded', 'succeeded'],
				addresses: [['/song-1436211-0.mp3'], ['/song-1436212-0.mp3', '/song-1436212-1.mp3', '/song-1436212-2.mp3']],
				downloads: Array.from({ length: 4 }, () => ({ size: tinyMp3().byteLength, format: 'mp3' })),
				keySent: false
			});
		} finally {
			await fake.close();
		}
	});

	test('a task is asked about at the query of its kind through every state: pending, running, and succeeded, or failed with Mureka\'s reason, timed out, or cancelled', async () => {
		const fake = await startMureka();
		try {
			const providers = commands();
			const create = async (options: AudioRequestOptions) => remoteIdOf(await providers.submit(song(fake.url, 'mureka-9.5', { params: { count: 1 }, ...options })));
			const ids = {
				song: await create({ prompt: 'A song about the harbor' }),
				instrumental: await create({ prompt: 'Calm piano', params: { instrumental: true, count: 1 } }),
				failed: await create({ mode: 'lyrics', prompt: LYRICS }),
				failedSilently: await create({ prompt: 'A song' }),
				timedOut: await create({ prompt: 'A song' }),
				timedOutWithReason: await create({ prompt: 'A song' }),
				cancelled: await create({ prompt: 'A song' }),
				unknown: await create({ prompt: 'A song' })
			};
			fake.script(ids.song, ['preparing', 'queued', 'running', 'streaming', 'succeeded']);
			fake.script(ids.instrumental, ['queued', 'running', 'succeeded']);
			fake.script(ids.failed, ['running', 'failed:The lyrics contain words that are not allowed.']);
			fake.script(ids.failedSilently, ['failed']);
			fake.script(ids.timedOut, ['timeouted']);
			fake.script(ids.timedOutWithReason, ['timeouted:generation exceeded 600 seconds']);
			fake.script(ids.cancelled, ['cancelled']);
			fake.script(ids.unknown, ['paused']);
			const ref = (remoteId: string) => taskRef(fake.url, 'mureka-9.5', remoteId);
			const songs = (kind: string, id: string) => ({ state: 'succeeded', outputs: [{ url: `${fake.cdnUrl}/${kind}-${id}-0.mp3` }] });
			assert.deepEqual({
				song: await pollEach(providers, ref(ids.song), 5),
				instrumental: await pollEach(providers, ref(ids.instrumental), 3),
				failed: await pollEach(providers, ref(ids.failed), 2),
				failedSilently: value(await providers.poll(ref(ids.failedSilently))),
				timedOut: value(await providers.poll(ref(ids.timedOut))),
				timedOutWithReason: value(await providers.poll(ref(ids.timedOutWithReason))),
				cancelled: value(await providers.poll(ref(ids.cancelled))),
				unknown: error(await providers.poll(ref(ids.unknown))),
				queries: fake.received.filter(entry => entry.method === 'GET').map(entry => entry.path)
			}, {
				song: [{ state: 'pending' }, { state: 'pending' }, { state: 'running' }, { state: 'running' }, songs('song', '1436211')],
				instrumental: [{ state: 'pending' }, { state: 'running' }, songs('instrumental', '1436212')],
				failed: [{ state: 'running' }, { state: 'failed', message: 'The lyrics contain words that are not allowed.' }],
				failedSilently: { state: 'failed', message: 'Mureka reports that the task failed.' },
				timedOut: { state: 'failed', message: 'Mureka stopped the task because it took too long.' },
				timedOutWithReason: { state: 'failed', message: 'Mureka stopped the task because it took too long. (generation exceeded 600 seconds)' },
				cancelled: { state: 'cancelled', message: 'Mureka reports that the task was cancelled.' },
				unknown: { code: 'invalidResponse', message: 'Mureka reports a task status BaseHalf does not know: paused.' },
				queries: [
					...Array.from({ length: 5 }, () => '/v1/song/query/1436211'),
					...Array.from({ length: 3 }, () => '/v1/instrumental/query/1436212'),
					'/v1/song/query/1436213', '/v1/song/query/1436213',
					'/v1/song/query/1436214', '/v1/song/query/1436215', '/v1/song/query/1436216', '/v1/song/query/1436217', '/v1/song/query/1436218'
				]
			});
		} finally {
			await fake.close();
		}
	});

	test('a task that succeeded without choices cannot be read, and a choice without an address is refused alone', async () => {
		let choices: unknown[] = [];
		const server = await startServer((request, response) => sendJson(response, 200, { id: '1436211', status: 'succeeded', choices }));
		try {
			const providers = commands();
			const ref = taskRef(server.url, 'mureka-9.5', 'song/1436211');
			const empty = error(await providers.poll(ref));
			choices = [{ index: 1, url: 'https://cdn.mureka.ai/song-2.mp3' }, { index: 0, flac_url: 'https://cdn.mureka.ai/song-1.flac' }];
			assert.deepEqual({ empty, partial: value(await providers.poll(ref)) }, {
				empty: { code: 'invalidResponse', message: 'Mureka reports that the task succeeded but gives no songs.' },
				partial: { state: 'succeeded', outputs: [{ refused: 'Mureka gives no address for this song.' }, { url: 'https://cdn.mureka.ai/song-2.mp3' }] }
			});
		} finally {
			await server.close();
		}
	});

	test('Mureka O2 makes no instrumentals: it declares no Instrumental, and check and submit refuse one without sending anything', async () => {
		const fake = await startMureka();
		try {
			const providers = commands();
			const request = song(fake.url, 'mureka-o2', { prompt: 'Calm piano for a morning walk', params: { instrumental: true } });
			assert.deepEqual({
				declared: buildCatalog([MUREKA]).providers[0].models.find(model => model.id === 'mureka-o2')?.parameters.map(parameter => parameter.name),
				checked: value(await providers.check(request)).problems,
				submitted: error(await providers.submit(request)),
				sent: fake.received.length
			}, {
				declared: ['count', 'style'],
				checked: ['Mureka O2 has no setting named "instrumental".'],
				submitted: { code: 'rejected', message: 'Mureka O2 has no setting named "instrumental".' },
				sent: 0
			});
		} finally {
			await fake.close();
		}
	});

	test('check refuses a reference song that is too large, not an MP3 or an M4A, or shorter than 30 seconds, one with Instrumental on or with Style, and a description longer than Mureka takes; submit sends nothing then', async () => {
		const fake = await startMureka();
		try {
			const providers = commands();
			const problems = async (model: string, options: AudioRequestOptions) => value(await providers.check(song(fake.url, model, options))).problems;
			const description = (length: number) => 'a'.repeat(length);
			assert.deepEqual({
				mp3: await problems('mureka-9.5', { prompt: 'A song like this one', inputs: { audios: [SONG] } }),
				m4a: await problems('mureka-o2', { mode: 'lyrics', prompt: LYRICS, inputs: { audios: [SONG_M4A] } }),
				large: await problems('mureka-9.5', { prompt: 'A song like this one', inputs: { audios: [LARGE] } }),
				wav: await problems('mureka-o2', { prompt: 'A song like this one', inputs: { audios: [WAVE] } }),
				short: await problems('mureka-9.5', { mode: 'lyrics', prompt: LYRICS, inputs: { audios: [HUM] } }),
				instrumentalWithSong: await problems('mureka-9.5', { prompt: 'Calm piano', params: { instrumental: true }, inputs: { audios: [SONG] } }),
				styleWithSong: await problems('mureka-o2', { mode: 'lyrics', prompt: LYRICS, params: { style: 'Slow folk' }, inputs: { audios: [SONG] } }),
				blankStyleWithSong: await problems('mureka-o2', { mode: 'lyrics', prompt: LYRICS, params: { style: ' ' }, inputs: { audios: [SONG] } }),
				twoSongs: await problems('mureka-9.5', { prompt: 'A song', inputs: { audios: [SONG, SONG_M4A] } }),
				descriptionAtLimit: await problems('mureka-9.5', { prompt: description(2000) }),
				descriptionTooLong: await problems('mureka-9.5', { prompt: description(2001) }),
				instrumentalAtLimit: await problems('mureka-9.5', { prompt: description(1024), params: { instrumental: true } }),
				instrumentalTooLong: await problems('mureka-9.5', { prompt: description(1025), params: { instrumental: true } }),
				lyricsAtLimit: await problems('mureka-o2', { mode: 'lyrics', prompt: description(5000) }),
				lyricsTooLong: await problems('mureka-o2', { mode: 'lyrics', prompt: description(5001) }),
				noLyrics: await problems('mureka-9.5', { mode: 'lyrics', prompt: '', inputs: { audios: [SONG] } }),
				noDescription: await problems('mureka-9.5', { prompt: '' }),
				styleTooLong: await problems('mureka-9.5', { mode: 'lyrics', prompt: LYRICS, params: { style: 's'.repeat(1025) } }),
				fourSongs: await problems('mureka-9.5', { prompt: 'A song', params: { count: 4 } })
			}, {
				mp3: [],
				m4a: [],
				large: ['Reference audio 1 large.mp3 is 11.0 MiB; an audio clip may be at most 10 MiB.'],
				wav: ['Reference audio 1 song.wav is not an MP3 or M4A file; Mureka takes the reference song as MP3 or M4A.'],
				short: ['Reference audio 1 hum.mp3 is 12.0 seconds long; Mureka takes a reference song of at least 30 seconds and uses 30 seconds of it.'],
				instrumentalWithSong: ['With Instrumental on, Mureka 9.5 makes music from the description alone: remove the reference song, or turn Instrumental off.'],
				styleWithSong: ['Mureka O2 follows Style or a reference song, not both: clear Style, or remove the reference song.'],
				blankStyleWithSong: [],
				twoSongs: ['Mureka 9.5 in From a Description mode takes at most 1 reference audio; 2 are planned.'],
				descriptionAtLimit: [],
				descriptionTooLong: ['The prompt is 2001 characters long; in From a Description mode, Mureka 9.5 takes at most 2000.'],
				instrumentalAtLimit: [],
				instrumentalTooLong: ['The prompt is 1025 characters long; with Instrumental on, Mureka 9.5 takes at most 1024.'],
				lyricsAtLimit: [],
				lyricsTooLong: ['The prompt is 5001 characters long; Mureka O2 takes at most 5000.'],
				noLyrics: ['Write the lyrics: Mureka 9.5 sings them in From Lyrics mode.'],
				noDescription: ['Write a prompt: Mureka 9.5 needs one.'],
				styleTooLong: ['Style is 1025 characters long; Mureka 9.5 takes at most 1024.'],
				fourSongs: ['Songs must be between 1 and 3.']
			});
			const refused = [
				error(await providers.submit(song(fake.url, 'mureka-9.5', { prompt: 'A song like this one', inputs: { audios: [LARGE] } }))),
				error(await providers.submit(song(fake.url, 'mureka-o2', { prompt: 'A song like this one', inputs: { audios: [WAVE] } }))),
				error(await providers.submit(song(fake.url, 'mureka-9.5', { prompt: 'Calm piano', params: { instrumental: true }, inputs: { audios: [SONG] } })))
			];
			assert.deepEqual({ codes: refused.map(entry => entry.code), sent: fake.received.length }, { codes: ['rejected', 'rejected', 'rejected'], sent: 0 });
		} finally {
			await fake.close();
		}
	});

	test('errors: a refused key, the region Mureka does not serve, too many requests, an empty balance, a refused request, and server errors; a create is sent once, a refused upload makes no task, and a poll is asked again', async () => {
		let status = 200;
		let body: unknown = {};
		const server = await startServer((request, response) => sendJson(response, status, body));
		try {
			const sleep = recordingSleep();
			const providers = commands({}, sleep.sleep);
			const answer = (code: number, message?: string) => {
				status = code;
				body = message === undefined ? {} : { error: { message }, trace_id: 'trace-1e94aba5a2de4cc4bff54a2813c8d36c' };
			};
			const create = async (code: number, message?: string) => {
				answer(code, message);
				return error(await providers.submit(song(server.url, 'mureka-9.5', { prompt: 'A song about the harbor' })));
			};
			const creates = {
				key: await create(401, 'Invalid Authentication'),
				region: await create(403, 'You are accessing the API from an unsupported region'),
				regionSilent: await create(403),
				busy: await create(429, 'Rate limit reached for requests'),
				busySilent: await create(429),
				quota: await create(429, 'You exceeded your current quota, please check your billing details'),
				payment: await create(402, 'Payment required'),
				refused: await create(400, 'The prompt contains content that is not allowed.'),
				overloaded: await create(503, 'The engine is currently overloaded, please try again later'),
				failing: await create(500, 'The server had an error while processing your request')
			};
			const createsSent = server.received.length;
			const waitsOfCreates = [...sleep.waits];
			answer(403, 'You are accessing the API from an unsupported region');
			const upload = error(await providers.submit(song(server.url, 'mureka-o2', { mode: 'lyrics', prompt: LYRICS, inputs: { audios: [SONG] } })));
			const afterUpload = server.received.slice(createsSent).map(entry => `${entry.method} ${entry.path}`);
			answer(429, 'Rate limit reached for requests');
			const busyPoll = error(await providers.poll(taskRef(server.url, 'mureka-9.5', 'song/1436211')));
			answer(404, 'Not Found');
			const unknownTask = error(await providers.poll(taskRef(server.url, 'mureka-9.5', 'instrumental/1436299')));
			assert.deepEqual({ creates, createsSent, waitsOfCreates, upload, afterUpload, busyPoll, unknownTask, waits: sleep.waits }, {
				creates: {
					key: { code: 'auth', message: 'Invalid Authentication', status: 401 },
					// The key is fine: Mureka refuses where the request comes from.
					region: { code: 'rejected', message: 'Mureka does not serve requests from this region. (You are accessing the API from an unsupported region)', status: 403 },
					regionSilent: { code: 'rejected', message: 'Mureka does not serve requests from this region.', status: 403 },
					busy: { code: 'rateLimited', message: `Rate limit reached for requests. ${BUSY}`, status: 429 },
					busySilent: { code: 'rateLimited', message: `Mureka answered with HTTP 429. ${BUSY}`, status: 429 },
					quota: { code: 'balance', message: 'You exceeded your current quota, please check your billing details', status: 429 },
					payment: { code: 'balance', message: 'Payment required', status: 402 },
					refused: { code: 'rejected', message: 'The prompt contains content that is not allowed.', status: 400 },
					// Mureka may have made the task before it failed to answer.
					overloaded: { code: 'unknownOutcome', message: 'The engine is currently overloaded, please try again later', status: 503 },
					failing: { code: 'unknownOutcome', message: 'The server had an error while processing your request', status: 500 }
				},
				createsSent: 10,
				waitsOfCreates: [],
				upload: { code: 'rejected', message: 'Reference audio 1 song.mp3 could not be uploaded to Mureka: Mureka does not serve requests from this region. (You are accessing the API from an unsupported region)', status: 403 },
				afterUpload: ['POST /v1/files/upload'],
				busyPoll: { code: 'rateLimited', message: `Rate limit reached for requests. ${BUSY}`, status: 429 },
				unknownTask: { code: 'notFound', message: 'Not Found', status: 404 },
				// The poll answered 429 was asked four times.
				waits: [1000, 2000, 4000]
			});
		} finally {
			await server.close();
		}
	});

	test('a create whose answer never comes, or whose connection drops after it was sent, has an unknown outcome and is sent once; a poll whose answer never comes is asked again, then fails for the network', async () => {
		let drop = false;
		const server = await startServer((request, response, socket) => {
			if (drop) {
				socket.destroy();
			}
			// Otherwise no answer ever comes.
		});
		try {
			const sleep = recordingSleep();
			const providers = commands({ http: { createTimeoutMs: 100, requestTimeoutMs: 100 } }, sleep.sleep);
			const silent = error(await providers.submit(song(server.url, 'mureka-9.5', { prompt: 'A song about the harbor' })));
			drop = true;
			const dropped = error(await providers.submit(song(server.url, 'mureka-o2', { mode: 'lyrics', prompt: LYRICS })));
			drop = false;
			const polled = error(await providers.poll(taskRef(server.url, 'mureka-9.5', 'song/1436211')));
			assert.deepEqual({
				codes: [silent.code, dropped.code, polled.code],
				silent: silent.message,
				dropped: dropped.message.startsWith('The connection ended after the request was sent'),
				polled: polled.message,
				sent: server.received.map(entry => `${entry.method} ${entry.path}`),
				waits: sleep.waits
			}, {
				codes: ['unknownOutcome', 'unknownOutcome', 'network'],
				silent: 'The connection ended after the request was sent: No answer came in time.',
				dropped: true,
				polled: 'No answer came in time.',
				sent: ['POST /v1/song/easy-generate', 'POST /v1/song/generate', ...Array.from({ length: 4 }, () => 'GET /v1/song/query/1436211')],
				waits: [1000, 2000, 4000]
			});
		} finally {
			await server.close();
		}
	});

	test('cancel answers false and sends nothing, and a task id that names no Mureka query is refused without asking', async () => {
		const fake = await startMureka();
		try {
			const providers = commands();
			const ref = (remoteId: string) => taskRef(fake.url, 'mureka-9.5', remoteId);
			assert.deepEqual({
				cancelled: value(await providers.cancel(ref('song/1436211'))),
				noQuery: error(await providers.poll(ref('1436211'))),
				otherQuery: error(await providers.poll(ref('video/1436211'))),
				noId: error(await providers.poll(ref('song/'))),
				sent: fake.received.length
			}, {
				cancelled: { cancelled: false },
				noQuery: { code: 'rejected', message: 'The task 1436211 names no Mureka query, so BaseHalf cannot ask Mureka about it.' },
				otherQuery: { code: 'rejected', message: 'The task video/1436211 names no Mureka query, so BaseHalf cannot ask Mureka about it.' },
				noId: { code: 'rejected', message: 'The task song/ names no Mureka query, so BaseHalf cannot ask Mureka about it.' },
				sent: 0
			});
		} finally {
			await fake.close();
		}
	});
});
