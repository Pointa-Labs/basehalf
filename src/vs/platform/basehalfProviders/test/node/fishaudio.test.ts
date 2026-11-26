/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import type { ServerResponse } from 'http';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { ELEVENLABS } from '../../node/elevenlabs.js';
import { FISH_AUDIO } from '../../node/fishaudio.js';
import type { HttpOptions } from '../../node/http.js';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import type { CatalogParameter, Output, VoiceParameter } from '../../common/basehalfProviderTypes.js';
import { answerAudioAtOnce, audioRequest, error, listVoicesAgainst, routed, sendJson, serveFiles, startServer, testAccess, tinyMp3, value, type Received, type TestRoute } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: fishaudio', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const KEY = 'fa-0123456789abcdef0123456789abcdef';
	const ADRIAN = 'bf322df2096a46f18c579d0baa36f41d';

	function commands(http: HttpOptions = {}) {
		return new VideoProviderCommands([FISH_AUDIO], { http: { sleep: async () => undefined, ...http } });
	}

	function access(server: string) {
		return testAccess(FISH_AUDIO, server, { apiKey: KEY });
	}

	/** A request as the local server received it: the call, the headers that matter, and the JSON body. */
	function sent(request: Received) {
		return {
			call: `${request.method} ${request.path}`,
			authorization: request.headers.authorization,
			model: request.headers.model,
			type: request.headers['content-type'],
			accept: request.headers.accept,
			body: JSON.parse(request.body.toString('utf8'))
		};
	}

	function outputsOf(submitted: unknown): Output[] {
		return (submitted as { readonly outputs: Output[] }).outputs;
	}

	function summary(parameter: CatalogParameter): string {
		const more = parameter.advanced ? ' (more)' : '';
		switch (parameter.kind) {
			case 'integer':
			case 'number':
				return `${parameter.name}=${parameter.min}-${parameter.max}/${parameter.step}:${parameter.default}${more}`;
			case 'voice':
				return `${parameter.name}=${parameter.options.map(option => option.value).join('|')}:${parameter.default}${parameter.listed ? ' listed' : ''}`;
			default:
				return `${parameter.name}:${String(parameter.default)}${more}`;
		}
	}

	test('the catalog entry declares the global region, the API key, and Drama 3, S2.1 Pro, and S2 Pro, each an MP3 answered at once without inputs, with the default voice first, after ElevenLabs', () => {
		const provider = buildCatalog([FISH_AUDIO]).providers[0];
		assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
			id: 'fishaudio',
			label: 'Fish Audio',
			regions: [{ id: 'global', label: 'Global', baseUrl: 'https://api.fish.audio', console: 'https://fish.audio/app/api-keys/' }],
			credentials: [{ id: 'apiKey', label: 'API Key' }]
		});
		const models = Object.fromEntries(provider.models.map(model => [model.id, {
			label: model.label,
			what: `${model.kind} ${model.makes} ${model.outputFormat} ${model.answersAtOnce ? 'at once' : 'task'}`,
			ids: model.providerModels,
			prompt: `${model.prompt.required} ${model.prompt.maxLength}`,
			modes: model.modes.map(mode => `${mode.id} ${mode.label}: start ${mode.inputs.startFrame}, images ${mode.inputs.images.max}, videos ${mode.inputs.videos.max}, audio ${mode.inputs.audios.max}, source ${mode.inputs.source}`),
			parameters: model.parameters.map(summary)
		}]));
		const entry = (label: string, id: string) => ({
			label,
			what: 'audio speech mp3 at once',
			ids: { global: id },
			prompt: 'always 30000',
			modes: ['reference Speech: start none, images 0, videos 0, audio 0, source none'],
			parameters: [
				`voice=default|${ADRIAN}|c70cfb98867a4bfb9ae20d2401257b92|f3a2b90078d54a65af4b95f63bc7798e:default listed`,
				'speed=0.5-2/0.05:1',
				'temperature=0-1/0.01:0.7 (more)',
				'top_p=0-1/0.01:0.7 (more)'
			]
		});
		assert.deepEqual(models, { 'drama-3': entry('Drama 3', 'drama-3'), 's2.1-pro': entry('S2.1 Pro', 's2.1-pro'), 's2-pro': entry('S2 Pro', 's2-pro') });
		const voices = (provider.models[0].parameters.find(parameter => parameter.kind === 'voice') as VoiceParameter).options;
		const index = PROVIDER_MODULES.indexOf(FISH_AUDIO);
		assert.deepEqual({
			voices: voices.map(option => `${option.label}: ${option.description}`),
			placed: [PROVIDER_MODULES[index - 1] === ELEVENLABS, buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'fishaudio')],
			deprecated: provider.models.some(model => model.deprecated)
		}, {
			voices: ['Default Voice: The voice the model speaks in when none is chosen', 'Adrian: American English, male', 'Delia: American English, female', 'Sheila: American English, female'],
			placed: [true, true],
			deprecated: false
		});
	});

	test('each model is one request to /v1/tts with its model header and a JSON body for an MP3 of 192 kbps, without a voice for the default one, and the MP3 it answers is written to its target', async () => {
		const server = await startServer(routed(answerAudioAtOnce({ path: '/v1/tts', sounds: [tinyMp3()], as: 'bytes' })));
		try {
			const providers = commands();
			const requests = [
				// The default voice: no reference_id.
				audioRequest(access(server.url), 'drama-3', { prompt: '[barely holding it together] I\'m fine. Really.' }),
				audioRequest(access(server.url), 's2.1-pro', { params: { voice: ADRIAN, speed: 1.25, temperature: 0.5, top_p: 0.9 }, prompt: 'Welcome to the coast.' }),
				// A voice of the account, not in the catalog.
				audioRequest(access(server.url), 's2-pro', { params: { voice: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', speed: 0.5 }, prompt: '欢迎来到海边。' })
			];
			const answered = [];
			for (const request of requests) {
				answered.push(outputsOf(value(await providers.submit(request))));
			}
			const headers = (model: string) => ({ authorization: `Bearer ${KEY}`, model, type: 'application/json', accept: 'audio/mpeg' });
			const fixed = { format: 'mp3', mp3_bitrate: 192, latency: 'normal' };
			assert.deepEqual(server.received.map(sent), [
				{ call: 'POST /v1/tts', ...headers('drama-3'), body: { text: '[barely holding it together] I\'m fine. Really.', prosody: { speed: 1 }, temperature: 0.7, top_p: 0.7, ...fixed } },
				{ call: 'POST /v1/tts', ...headers('s2.1-pro'), body: { text: 'Welcome to the coast.', reference_id: ADRIAN, prosody: { speed: 1.25 }, temperature: 0.5, top_p: 0.9, ...fixed } },
				{ call: 'POST /v1/tts', ...headers('s2-pro'), body: { text: '欢迎来到海边。', reference_id: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', prosody: { speed: 0.5 }, temperature: 0.7, top_p: 0.7, ...fixed } }
			]);
			assert.deepEqual({
				answered,
				written: requests.map(request => readFileSync(request.targets![0]).equals(tinyMp3()))
			}, {
				answered: requests.map(request => [{ written: request.targets![0], size: tinyMp3().byteLength, format: 'mp3' }]),
				written: [true, true, true]
			});
		} finally {
			await server.close();
		}
	});

	test('an answer without a sound leaves the outcome unknown', async () => {
		const server = await startServer((request, response) => {
			response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
			response.end();
		});
		try {
			assert.deepEqual([error(await commands().submit(audioRequest(access(server.url), 's2.1-pro'))), server.received.length], [
				{ code: 'unknownOutcome', message: 'Fish Audio accepted the request but answered no sound.' },
				1
			]);
		} finally {
			await server.close();
		}
	});

	/** A voice model as `GET /model` answers it. */
	function voiceModel(id: string, title: string, fields: Record<string, unknown> = {}) {
		return { _id: id, type: 'tts', title, description: '', state: 'trained', tags: [], samples: [], languages: [], visibility: 'public', like_count: 0, mark_count: 0, shared_count: 0, task_count: 0, author: { _id: 'author-1', nickname: 'Someone' }, ...fields };
	}

	/** `GET /model`: the account's pages (`self=true`) and the licensed library's (`licensed=true`), by `page_number`. */
	function modelPages(own: readonly (readonly unknown[])[], library: readonly (readonly unknown[])[], answer: (pages: readonly (readonly unknown[])[], page: number) => Record<string, unknown> = (pages, page) => ({ total: pages.flat().length, items: pages[page - 1] ?? [], has_more: page < pages.length })): TestRoute {
		return (request, response) => {
			const [path, query] = request.path.split('?');
			if (request.method !== 'GET' || path !== '/model') {
				return false;
			}
			const search = new URLSearchParams(query);
			const pages = search.get('self') === 'true' ? own : library;
			sendJson(response, 200, answer(pages, Number(search.get('page_number'))));
			return true;
		};
	}

	test('voices lists the account\'s voice models on every page, then Fish Audio\'s licensed library by score, only ready voices of speech, each once, with descriptions and samples', async () => {
		const sample = (id: string) => `https://platform.r2.fish.audio/task/${id}.mp3`;
		const { answer, received } = await listVoicesAgainst(FISH_AUDIO, 's2.1-pro', { apiKey: KEY }, routed(modelPages(
			[
				[
					voiceModel('own-1', 'My Narrator', { visibility: 'private', languages: ['en'], tags: ['calm'], samples: [{ title: 'Default', text: 'Hello.', task_id: 't-1', audio: sample('own-1') }] }),
					voiceModel('own-singing', 'My Singing', { type: 'svc' }),
					voiceModel('own-training', 'Still Training', { state: 'training' })
				],
				[voiceModel('shared-2', 'Saved Voice', { languages: ['zh', 'ja'], tags: ['female', 'young'], samples: [{ title: 'A', text: 'a', task_id: 't-2', audio: '/task/relative.mp3' }, { title: 'B', text: 'b', task_id: 't-3', audio: sample('shared-2') }] })]
			],
			[
				[
					voiceModel('library-1', 'Energetic Male', { licensed: true, languages: ['en'], tags: ['male', 'energetic'], samples: [{ title: 'Sample', text: 'Hi.', task_id: 't-4', audio: sample('library-1') }] }),
					voiceModel('shared-2', 'Saved Voice', { licensed: true }),
					voiceModel('taken-down', 'Gone', { licensed: true, dmca_taken_down: true })
				],
				[voiceModel('library-2', 'Quiet Teller', { licensed: true, description: 'A soft voice for bedtime stories.' })]
			]
		)));
		assert.deepEqual({ answer, received: received.map(entry => `${entry.method} ${entry.path} ${entry.headers.authorization}`) }, {
			answer: {
				ok: true,
				value: {
					voices: [
						{ id: 'own-1', label: 'My Narrator', description: 'English · Calm', own: true, sample: sample('own-1') },
						{ id: 'shared-2', label: 'Saved Voice', description: 'Chinese, Japanese · Female, Young', own: true, sample: sample('shared-2') },
						{ id: 'library-1', label: 'Energetic Male', description: 'English · Male, Energetic', own: false, sample: sample('library-1') },
						{ id: 'library-2', label: 'Quiet Teller', description: 'A soft voice for bedtime stories.', own: false }
					]
				}
			},
			received: [
				`GET /model?self=true&page_size=100&page_number=1 Bearer ${KEY}`,
				`GET /model?self=true&page_size=100&page_number=2 Bearer ${KEY}`,
				`GET /model?licensed=true&sort_by=score&page_size=100&page_number=1 Bearer ${KEY}`,
				`GET /model?licensed=true&sort_by=score&page_size=100&page_number=2 Bearer ${KEY}`
			]
		});
	});

	test('voices takes the library\'s pages while the list holds fewer than 2,000, reads a total where has_more is missing, and ends at a library page Fish Audio refuses after the first', async () => {
		const page = (number: number, size = 100) => Array.from({ length: size }, (_entry, index) => voiceModel(`library-${number}-${index}`, `Voice ${number}.${index}`, { licensed: true }));
		const long = await listVoicesAgainst(FISH_AUDIO, 's2-pro', { apiKey: KEY }, routed(modelPages([[voiceModel('own-1', 'Mine')]], Array.from({ length: 30 }, (_entry, number) => page(number)))));
		const counted = await listVoicesAgainst(FISH_AUDIO, 's2-pro', { apiKey: KEY }, routed(modelPages([], [page(0, 100), page(1, 20)], (pages, number) => ({ total: 120, items: pages[number - 1] ?? [] }))));
		const refused = await listVoicesAgainst(FISH_AUDIO, 's2-pro', { apiKey: KEY }, routed((request, response) => {
			const number = Number(new URLSearchParams(request.path.split('?')[1]).get('page_number'));
			if (request.path.includes('licensed=true') && number === 2) {
				sendJson(response, 400, { message: 'Page window exceeded', status: 400 });
				return true;
			}
			return false;
		}, modelPages([], [page(0), page(1), page(2)])));
		const firstRefused = await listVoicesAgainst(FISH_AUDIO, 's2-pro', { apiKey: KEY }, (request, response) => sendJson(response, 401, { message: 'Invalid Token', status: 401 }));
		// The account's own voices fill the list: the library is not asked.
		const ownPage = (number: number) => Array.from({ length: 100 }, (_entry, index) => voiceModel(`own-${number}-${index}`, `Mine ${number}.${index}`));
		const full = await listVoicesAgainst(FISH_AUDIO, 's2-pro', { apiKey: KEY }, routed(modelPages(Array.from({ length: 20 }, (_entry, number) => ownPage(number)), [page(0)])));
		const listed = value(long.answer);
		assert.deepEqual({
			long: [listed.voices.length, listed.truncated, listed.voices[0].id, listed.voices.at(-1)?.id, long.received.length],
			counted: [value(counted.answer).voices.length, value(counted.answer).truncated, counted.received.length],
			refused: [value(refused.answer).voices.length, value(refused.answer).truncated, refused.received.length],
			firstRefused: [firstRefused.answer, firstRefused.received.length],
			full: [value(full.answer).voices.length, value(full.answer).truncated, full.received.filter(entry => entry.path.includes('licensed=true')).length, full.received.length]
		}, {
			// The account's one voice and 1,999 of the library: 20 library pages, after one of the account's.
			long: [2000, true, 'own-1', 'library-19-98', 21],
			counted: [120, undefined, 3],
			refused: [100, true, 3],
			firstRefused: [{ ok: false, error: { code: 'auth', message: 'Invalid Token', status: 401 } }, 1],
			full: [2000, true, 0, 20]
		});
	});

	test('a voice\'s sample is fetched from Fish Audio\'s storage without the key, which goes only to the API', async () => {
		const cdn = await startServer(routed(serveFiles({ '/task/own-1.mp3': tinyMp3() })));
		const api = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const fetched = await commands().voicePreview({ ...access(api.url), model: 'drama-3', sample: `${cdn.url}/task/own-1.mp3` });
			assert.ok(fetched.ok && fetched.value.bytes instanceof VSBuffer);
			assert.deepEqual({
				format: fetched.ok ? fetched.value.format : undefined,
				same: fetched.ok ? Buffer.from(fetched.value.bytes.buffer).equals(tinyMp3()) : false,
				keyToCdn: cdn.received.map(entry => entry.headers.authorization ?? null),
				toApi: api.received.length
			}, { format: 'mp3', same: true, keyToCdn: [null], toApi: 0 });
		} finally {
			await cdn.close();
			await api.close();
		}
	});

	test('Fish Audio\'s errors map to plain codes and messages: a key, credits, a voice that is missing or not the key\'s, parameters, too many requests, and a server error, each sent once', async () => {
		const failure = (status: number, message: string) => (response: ServerResponse) => sendJson(response, status, { message, status });
		const answers: Record<string, (response: ServerResponse) => void> = {
			key: failure(401, 'Invalid Token'),
			credits: failure(402, 'Insufficient balance'),
			missing: failure(404, 'Model not found'),
			missingAsBadRequest: failure(400, 'Reference model not found'),
			parameters: failure(400, 'Invalid parameter: temperature must be between 0 and 1'),
			notYours: failure(403, 'Permission denied'),
			unprocessable: failure(422, 'Unprocessable request body'),
			busy: failure(429, 'Too many requests'),
			server: failure(500, 'Internal server error'),
			overloaded: (response) => {
				// An error of the network in front of the API, which is not JSON.
				response.writeHead(503, { 'Content-Type': 'text/html' });
				response.end('<html><body>Service Unavailable</body></html>');
			}
		};
		let answering = 'key';
		const server = await startServer((request, response, socket) => {
			if (request.path.startsWith('/drop/')) {
				socket.destroy();
				return;
			}
			answers[answering](response);
		});
		const silent = await startServer(() => { /* never answers */ });
		try {
			const providers = commands();
			const outcomes: Record<string, unknown> = {};
			for (const name of Object.keys(answers)) {
				answering = name;
				outcomes[name] = error(await providers.submit(audioRequest(access(server.url), 's2.1-pro', { params: { voice: ADRIAN } })));
			}
			// Without a voice, a 403 refuses the key, and a 404 is Fish Audio's own word.
			answering = 'notYours';
			outcomes.notYoursWithoutVoice = error(await providers.submit(audioRequest(access(server.url), 's2.1-pro')));
			answering = 'missing';
			outcomes.missingWithoutVoice = error(await providers.submit(audioRequest(access(server.url), 's2.1-pro')));
			outcomes.dropped = error(await providers.submit(audioRequest(access(`${server.url}/drop`), 'drama-3'))).code;
			const never = error(await commands({ atOnceTimeoutMs: 200 }).submit(audioRequest(access(silent.url), 'drama-3')));
			const noVoice = (said: string) => `Fish Audio has no voice "${ADRIAN}" that this account can use: choose another voice. Fish Audio says: ${said}`;
			assert.deepEqual({ outcomes, sent: server.received.length, never: [never.code, /No answer came in time/.test(never.message), silent.received.length] }, {
				outcomes: {
					key: { code: 'auth', message: 'Invalid Token', status: 401 },
					credits: { code: 'balance', message: 'Insufficient balance', status: 402 },
					missing: { code: 'rejected', message: noVoice('Model not found'), status: 404 },
					missingAsBadRequest: { code: 'rejected', message: noVoice('Reference model not found'), status: 400 },
					parameters: { code: 'rejected', message: 'Invalid parameter: temperature must be between 0 and 1', status: 400 },
					notYours: { code: 'rejected', message: `Fish Audio does not let this key use the voice "${ADRIAN}": choose another voice. Fish Audio says: Permission denied`, status: 403 },
					unprocessable: { code: 'rejected', message: 'Unprocessable request body', status: 422 },
					busy: { code: 'rateLimited', message: 'Fish Audio is already running as many requests of this account at once as it allows: wait for them to finish, then generate again. Fish Audio says: Too many requests', status: 429 },
					server: { code: 'unknownOutcome', message: 'Internal server error', status: 500 },
					overloaded: { code: 'unknownOutcome', message: 'The provider answered with HTTP 503.', status: 503 },
					notYoursWithoutVoice: { code: 'auth', message: 'Permission denied', status: 403 },
					missingWithoutVoice: { code: 'rejected', message: 'Model not found', status: 404 },
					dropped: 'unknownOutcome'
				},
				// Each request was sent once, never again.
				sent: Object.keys(answers).length + 3,
				never: ['unknownOutcome', true, 1]
			});
		} finally {
			await server.close();
			await silent.close();
		}
	});

	test('check takes a voice of the account and the default one, and refuses a speed beyond 2, a long prompt, and a setting Fish Audio does not document', async () => {
		const problems = async (params: Record<string, unknown>, prompt = 'Welcome to the coast.') =>
			value(await commands().check({ provider: 'fishaudio', region: 'global', model: 's2.1-pro', mode: 'reference', params, prompt, inputs: { images: [], videos: [], audios: [] } })).problems;
		assert.deepEqual({
			accountVoice: await problems({ voice: '0f1e2d3c4b5a69788796a5b4c3d2e1f0' }),
			defaultVoice: await problems({ voice: 'default' }),
			fast: await problems({ speed: 2.5 }),
			long: await problems({}, 'a'.repeat(30_001)),
			volume: await problems({ volume: 3 })
		}, {
			accountVoice: [],
			defaultVoice: [],
			fast: ['Speed must be between 0.5 and 2.'],
			long: ['The prompt is 30001 characters long; S2.1 Pro takes at most 30000.'],
			volume: ['S2.1 Pro has no setting named "volume".']
		});
	});

	test('Fish Audio has no task: poll refuses one, and cancel answers false, without a request', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const providers = commands();
			const ref = { ...access(server.url), model: 's2-pro', remoteId: 'speech-1' };
			assert.deepEqual({ poll: error(await providers.poll(ref)), cancel: value(await providers.cancel(ref)), sent: server.received.length }, {
				poll: { code: 'rejected', message: 'S2 Pro answers with its sound at once: there is no task to ask about.' },
				cancel: { cancelled: false },
				sent: 0
			});
		} finally {
			await server.close();
		}
	});
});
