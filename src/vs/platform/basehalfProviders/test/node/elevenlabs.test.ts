/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import type { ServerResponse } from 'http';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { hasKey } from '../../../../base/common/types.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { ELEVENLABS } from '../../node/elevenlabs.js';
import type { HttpOptions } from '../../node/http.js';
import { OPENAI } from '../../node/openai.js';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import type { CatalogModel, CatalogParameter, ChoiceParameter, Output, VoiceParameter } from '../../common/basehalfProviderTypes.js';
import { MOCK_VIDEO_PROVIDER_KEY, mockSoundTag, startMockVideoProvider } from './mockVideoProvider.js';
import { audioRequest, error, listVoicesAgainst, routed, sendJson, serveFiles, startServer, testAccess, tinyMp3, value, type Received, type TestRoute } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: elevenlabs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const KEY = 'sk_0123456789abcdef0123456789abcdef0123456789abcdef';
	const ELDRIN = '6WwXjDDEMyNmFG95zycZ';
	const QUERY = '?output_format=mp3_44100_128';

	function commands(http: HttpOptions = {}) {
		return new VideoProviderCommands([ELEVENLABS], { http: { sleep: async () => undefined, ...http } });
	}

	function access(server: string) {
		return testAccess(ELEVENLABS, server, { apiKey: KEY });
	}

	/** ElevenLabs' speech and sound-effect calls, answered at once with an MP3, as ElevenLabs answers them. */
	const answerSounds: TestRoute = (request, response) => {
		const path = request.path.split('?')[0];
		if (request.method !== 'POST' || !(path.startsWith('/v1/text-to-speech/') || path === '/v1/sound-generation')) {
			return false;
		}
		response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(tinyMp3().byteLength) });
		response.end(tinyMp3());
		return true;
	};

	/** A request as the local server received it: the call with its query, the headers that matter, and the JSON body. */
	function sent(request: Received) {
		return {
			call: `${request.method} ${request.path}`,
			key: request.headers['xi-api-key'],
			type: request.headers['content-type'],
			accept: request.headers.accept,
			body: JSON.parse(request.body.toString('utf8'))
		};
	}

	function outputsOf(submitted: unknown): Output[] {
		return (submitted as { readonly outputs: Output[] }).outputs;
	}

	function summary(parameter: CatalogParameter): string {
		const flags = `${parameter.optional ? ' (optional)' : ''}${parameter.advanced ? ' (more)' : ''}`;
		switch (parameter.kind) {
			case 'choice':
				return parameter.options.length > 5
					? `${parameter.name}=${parameter.options.length} options:${parameter.default ?? 'unset'}${flags}`
					: `${parameter.name}=${parameter.options.map(option => `${option.value} ${option.label}`).join('|')}:${parameter.default}${flags}`;
			case 'integer':
			case 'number':
				return `${parameter.name}=${parameter.min}-${parameter.max}/${parameter.step}:${parameter.default ?? 'unset'}${parameter.auto ? ` auto ${parameter.auto.value}` : ''}${parameter.unit ? ` ${parameter.unit}` : ''}${flags}`;
			case 'voice':
				return `${parameter.name}=${parameter.options.map(option => option.value).join('|')}:${parameter.default}${parameter.listed ? ' listed' : ''}${flags}`;
			default:
				return `${parameter.name}:${String(parameter.default)}${flags}`;
		}
	}

	function languagesOf(model: CatalogModel): ChoiceParameter['options'] {
		return (model.parameters.find(parameter => parameter.name === 'language_code') as ChoiceParameter).options;
	}

	test('the catalog entry declares the global region, the API key, the four speech models and Sound Effects, each an MP3 answered at once without inputs, after OpenAI', () => {
		const provider = buildCatalog([ELEVENLABS]).providers[0];
		assert.deepEqual({ id: provider.id, label: provider.label, regions: provider.regions, credentials: provider.credentials }, {
			id: 'elevenlabs',
			label: 'ElevenLabs',
			regions: [{ id: 'global', label: 'Global', baseUrl: 'https://api.elevenlabs.io', console: 'https://elevenlabs.io/app/api/api-keys' }],
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
		const voice = `voice=${ELDRIN}|WQP7cQUF5aAS6Axh5yaa|OZ0L6eISlOejga3XjDFt|gOupLcAkjEnguROwi4oS|BFd5oBc2DDna33pSi4Gf|fnYMz3F5gMEDGMWcH1ex:${ELDRIN} listed`;
		const speech = (label: string, id: string, characters: number, parameters: string[]) => ({
			label,
			what: 'audio speech mp3 at once',
			ids: { global: id },
			prompt: `always ${characters}`,
			modes: ['reference Speech: start none, images 0, videos 0, audio 0, source none'],
			parameters: [voice, ...parameters, 'seed=0-2147483647/1:unset (optional) (more)']
		});
		const allSettings = ['speed=0.7-1.2/0.05:1', 'stability=0-1/0.01:0.5', 'similarity_boost=0-1/0.01:0.75', 'style_exaggeration=0-1/0.01:0 (more)', 'use_speaker_boost:true (more)'];
		assert.deepEqual(models, {
			'eleven-v4': speech('Eleven v4', 'eleven_v4', 10_000, ['stability=0-1/0.01:0.5', 'similarity_boost=0-1/0.01:0.75', 'language_code=84 options:unset (optional) (more)']),
			'eleven-v3': speech('Eleven v3', 'eleven_v3', 5000, ['stability=0 Creative|0.5 Natural|1 Robust:0.5', 'language_code=85 options:unset (optional) (more)']),
			'eleven-multilingual-v2': speech('Multilingual v2', 'eleven_multilingual_v2', 10_000, allSettings),
			'eleven-flash-v2.5': speech('Flash v2.5', 'eleven_flash_v2_5', 40_000, [...allSettings, 'language_code=32 options:unset (optional) (more)']),
			'eleven-text-to-sound-v2': {
				label: 'Sound Effects',
				what: 'audio sound mp3 at once',
				ids: { global: 'eleven_text_to_sound_v2' },
				prompt: 'always 450',
				modes: ['reference Sound Effects: start none, images 0, videos 0, audio 0, source none'],
				parameters: ['duration=1-30/1:-1 auto -1 seconds', 'loop:false', 'prompt_influence=0-1/0.01:0.3 (more)']
			}
		});
		const [v4, v3, , flash] = provider.models;
		const voices = (v4.parameters.find(parameter => parameter.kind === 'voice') as VoiceParameter).options;
		const index = PROVIDER_MODULES.indexOf(ELEVENLABS);
		assert.deepEqual({
			v4: languagesOf(v4).slice(0, 3),
			mandarin: languagesOf(v4).find(option => option.value === 'zh'),
			chichewa: [languagesOf(v4).some(option => option.value === 'ny'), languagesOf(v3).find(option => option.value === 'ny')],
			flash: [['hu', 'no', 'vi', 'en'].every(code => languagesOf(flash).some(option => option.value === code)), languagesOf(flash).find(option => option.value === 'zh')?.label],
			voices: voices.map(option => `${option.label}: ${option.description}`),
			placed: [PROVIDER_MODULES[index - 1] === OPENAI, buildCatalog(PROVIDER_MODULES).providers.some(entry => entry.id === 'elevenlabs')],
			deprecated: provider.models.some(model => model.deprecated),
			taskless: [ELEVENLABS.videoLocation, typeof ELEVENLABS.listVoices]
		}, {
			v4: [{ value: 'af', label: 'Afrikaans' }, { value: 'ar', label: 'Arabic' }, { value: 'hy', label: 'Armenian' }],
			mandarin: { value: 'zh', label: 'Mandarin Chinese' },
			chichewa: [false, { value: 'ny', label: 'Chichewa' }],
			flash: [true, 'Chinese'],
			voices: ['Eldrin: Crisp British baritone', 'Elara: Crisp pro narrator', 'Talia: Warm, soft guide', 'Darian: Warm, grounded storyteller', 'Alicia: Polished global anchor', 'Finley: Articulate anchor'],
			placed: [true, true],
			deprecated: false,
			taskless: [undefined, 'function']
		});
	});

	test('each speech model is one request to /v1/text-to-speech/{voice} for an MP3 of 128 kbps, with exactly its voice settings, and the MP3 it answers is written to its target', async () => {
		const server = await startServer(routed(answerSounds));
		try {
			const providers = commands();
			const requests = [
				// A voice of the account, not in the catalog, with a seed and a language.
				audioRequest(access(server.url), 'eleven-v4', { params: { voice: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.3, similarity_boost: 0.9, seed: 7, language_code: 'en' }, prompt: '[whispers] Welcome to the coast.' }),
				// The default voice and Creative stability.
				audioRequest(access(server.url), 'eleven-v3', { params: { stability: 0 }, prompt: 'Welcome to the coast.' }),
				// Every setting at its default; an id that has to be encoded in the path.
				audioRequest(access(server.url), 'eleven-multilingual-v2', { params: { voice: 'my voice/2' }, prompt: 'Welcome to the coast.' }),
				audioRequest(access(server.url), 'eleven-flash-v2.5', { params: { speed: 1.2, style_exaggeration: 0.25, use_speaker_boost: false, language_code: 'vi' }, prompt: 'Chào mừng đến bờ biển.' })
			];
			const answered = [];
			for (const request of requests) {
				answered.push(outputsOf(value(await providers.submit(request))));
			}
			const json = { key: KEY, type: 'application/json', accept: 'audio/mpeg' };
			assert.deepEqual(server.received.map(sent), [
				{
					call: `POST /v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb${QUERY}`, ...json,
					body: { text: '[whispers] Welcome to the coast.', model_id: 'eleven_v4', voice_settings: { stability: 0.3, similarity_boost: 0.9 }, seed: 7, language_code: 'en' }
				},
				{
					call: `POST /v1/text-to-speech/${ELDRIN}${QUERY}`, ...json,
					body: { text: 'Welcome to the coast.', model_id: 'eleven_v3', voice_settings: { stability: 0 } }
				},
				{
					call: `POST /v1/text-to-speech/my%20voice%2F2${QUERY}`, ...json,
					body: { text: 'Welcome to the coast.', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 1, stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }
				},
				{
					call: `POST /v1/text-to-speech/${ELDRIN}${QUERY}`, ...json,
					body: { text: 'Chào mừng đến bờ biển.', model_id: 'eleven_flash_v2_5', voice_settings: { speed: 1.2, stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: false }, language_code: 'vi' }
				}
			]);
			assert.deepEqual({
				answered,
				written: requests.map(request => readFileSync(request.targets![0]).equals(tinyMp3()))
			}, {
				answered: requests.map(request => [{ written: request.targets![0], size: tinyMp3().byteLength, format: 'mp3' }]),
				written: [true, true, true, true]
			});
		} finally {
			await server.close();
		}
	});

	test('Sound Effects is one request to /v1/sound-generation with loop and prompt influence, and a duration only when it is not Auto', async () => {
		const server = await startServer(routed(answerSounds));
		try {
			const providers = commands();
			const timed = audioRequest(access(server.url), 'eleven-text-to-sound-v2', { params: { duration: 12, loop: true, prompt_influence: 0.6 }, prompt: 'Rain on a tin roof.' });
			const auto = audioRequest(access(server.url), 'eleven-text-to-sound-v2', { prompt: 'A heavy wooden door creaks open.' });
			const outputs = [outputsOf(value(await providers.submit(timed))), outputsOf(value(await providers.submit(auto)))];
			const json = { key: KEY, type: 'application/json', accept: 'audio/mpeg' };
			assert.deepEqual({ received: server.received.map(sent), outputs }, {
				received: [
					{ call: `POST /v1/sound-generation${QUERY}`, ...json, body: { text: 'Rain on a tin roof.', model_id: 'eleven_text_to_sound_v2', loop: true, prompt_influence: 0.6, duration_seconds: 12 } },
					{ call: `POST /v1/sound-generation${QUERY}`, ...json, body: { text: 'A heavy wooden door creaks open.', model_id: 'eleven_text_to_sound_v2', loop: false, prompt_influence: 0.3 } }
				],
				outputs: [
					[{ written: timed.targets![0], size: tinyMp3().byteLength, format: 'mp3' }],
					[{ written: auto.targets![0], size: tinyMp3().byteLength, format: 'mp3' }]
				]
			});
		} finally {
			await server.close();
		}
	});

	test('speech generates against the local test provider: the voices with their samples, a voice of the account, and the MP3 it answers, which it received with the text, the voice, and the settings', async () => {
		const mock = await startMockVideoProvider({ uniqueFiles: true });
		try {
			const providers = commands();
			const access = testAccess(ELEVENLABS, mock.elevenLabsUrl, { apiKey: MOCK_VIDEO_PROVIDER_KEY });
			const listed = value(await providers.voices({ ...access, model: 'eleven-v4' }));
			const captain = listed.voices.find(voice => voice.label === 'Sea Captain');
			const sample = value(await providers.voicePreview({ ...access, model: 'eleven-v4', sample: captain?.sample ?? '' }));
			const request = audioRequest(access, 'eleven-v4', { params: { voice: captain?.id ?? '', stability: 0.3 }, prompt: 'Welcome to the coast.' });
			const outputs = outputsOf(value(await providers.submit(request)));
			const unknown = error(await providers.submit(audioRequest(access, 'eleven-flash-v2.5', { params: { voice: 'nobody' }, prompt: 'Welcome to the coast.' })));
			assert.deepEqual({
				voices: listed.voices.map(voice => `${voice.label}: ${voice.description}${voice.own ? ', own' : ''}${voice.sample?.startsWith(`${mock.url}/files/voices/`) ? ', with a sample' : ''}`),
				sample: [sample.format, mockSoundTag(Buffer.from(sample.bytes.buffer))],
				outputs: outputs.map(output => hasKey(output, { written: true }) ? `${output.format} ${output.size === readFileSync(output.written).byteLength}` : output),
				tag: mockSoundTag(readFileSync(request.targets![0]))?.split('-')[0],
				received: mock.requests.map(entry => ({ kind: entry.kind, model: entry.model, prompt: entry.prompt, voice: entry.voice, settings: entry.body?.voice_settings })),
				unknown
			}, {
				voices: [
					'Coast Narrator: My own voice, read slowly., own, with a sample',
					'Sea Captain: Male, Old, Gravelly, own, with a sample',
					'Eldrin: Male, Middle aged, British, Crisp, Narrative story, own, with a sample',
					'George: Male, Middle aged, British, Warm, Narrative story, with a sample'
				],
				sample: ['mp3', 'sample-bhSeaCaptain00000002'],
				outputs: ['mp3 true'],
				tag: 'speech',
				received: [
					{ kind: 'speech', model: 'eleven_v4', prompt: 'Welcome to the coast.', voice: 'bhSeaCaptain00000002', settings: { stability: 0.3, similarity_boost: 0.75 } },
					{ kind: 'speech', model: 'eleven_flash_v2_5', prompt: 'Welcome to the coast.', voice: 'nobody', settings: { speed: 1, stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }
				],
				unknown: { code: 'rejected', message: 'ElevenLabs does not know this voice, or this account cannot use it: choose another voice. ElevenLabs says: A voice with the voice_id nobody was not found.', status: 404 }
			});
		} finally {
			await mock.close();
		}
	});

	test('an answer without a sound leaves the outcome unknown, and one that is not a sound is refused on its own', async () => {
		let body = Buffer.alloc(0);
		const server = await startServer((request, response) => {
			response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(body.byteLength) });
			response.end(body);
		});
		try {
			const providers = commands();
			const empty = error(await providers.submit(audioRequest(access(server.url), 'eleven-v4')));
			body = Buffer.from('<html><body>Sign in to continue.</body></html>'.repeat(3));
			const page = outputsOf(value(await providers.submit(audioRequest(access(server.url), 'eleven-v4'))));
			assert.deepEqual({ empty, page, sent: server.received.length }, {
				empty: { code: 'unknownOutcome', message: 'ElevenLabs accepted the request but answered no sound.' },
				page: [{ refused: 'The file does not start like an MP3, WAV, FLAC, Ogg, or M4A sound.' }],
				sent: 2
			});
		} finally {
			await server.close();
		}
	});

	/** ElevenLabs' `GET /v2/voices`, answering these pages, each after the token of the one before. */
	function voicePages(...pages: readonly (readonly unknown[])[]): TestRoute {
		return (request, response) => {
			const [path, query] = request.path.split('?');
			if (request.method !== 'GET' || path !== '/v2/voices') {
				return false;
			}
			const token = new URLSearchParams(query).get('next_page_token');
			const page = token === null ? 0 : Number(token.replace('page-', ''));
			const more = page + 1 < pages.length;
			sendJson(response, 200, { voices: pages[page] ?? [], has_more: more, total_count: 0, next_page_token: more ? `page-${page + 1}` : null });
			return true;
		};
	}

	test('voices follows next_page_token while ElevenLabs has more, marks every voice but the Default ones as the account\'s, describes each from its labels, and gives its preview as its sample', async () => {
		const sample = (id: string) => `https://storage.googleapis.com/eleven-public-prod/premade/voices/${id}/preview.mp3`;
		const { answer, received } = await listVoicesAgainst(ELEVENLABS, 'eleven-v4', { apiKey: KEY }, routed(voicePages(
			[
				{ voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade', labels: { accent: 'british', description: 'warm', age: 'middle_aged', gender: 'male', use_case: 'narration' }, preview_url: sample('JBFqnCBsd6RMkjVDRZzb'), available_for_tiers: [] },
				{ voice_id: 'cloned-voice-1', name: 'My Narrator', category: 'cloned', labels: {}, description: 'My own voice, read slowly.', preview_url: null },
				{ voice_id: 'designed-voice-2', name: 'Sea Captain', category: 'generated', labels: { gender: 'male', age: 'old', descriptive: 'gravelly' }, preview_url: sample('designed-voice-2') }
			],
			[
				{ voice_id: 'library-voice-3', name: 'Jade - Upbeat and Natural', category: 'professional', labels: { gender: 'female', age: 'young', accent: 'american', descriptive: 'upbeat', use_case: 'social_media' }, preview_url: sample('library-voice-3') },
				{ voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', category: 'premade', labels: { accent: 'american', gender: 'female' } }
			]
		)));
		assert.deepEqual({ answer, received: received.map(entry => `${entry.method} ${entry.path} ${entry.headers['xi-api-key']}`) }, {
			answer: {
				ok: true,
				value: {
					voices: [
						{ id: 'cloned-voice-1', label: 'My Narrator', description: 'My own voice, read slowly.', own: true },
						{ id: 'designed-voice-2', label: 'Sea Captain', description: 'Male, Old, Gravelly', own: true, sample: sample('designed-voice-2') },
						{ id: 'library-voice-3', label: 'Jade - Upbeat and Natural', description: 'Female, Young, American, Upbeat, Social media', own: true, sample: sample('library-voice-3') },
						{ id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', description: 'Male, Middle aged, British, Warm, Narration', own: false, sample: sample('JBFqnCBsd6RMkjVDRZzb') },
						{ id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', description: 'Female, American', own: false }
					]
				}
			},
			received: [
				`GET /v2/voices?page_size=100&include_total_count=false ${KEY}`,
				`GET /v2/voices?page_size=100&include_total_count=false&next_page_token=page-1 ${KEY}`
			]
		});
	});

	test('voices answers at most 2,000 and says ElevenLabs had more, and stops at a page token it was given before', async () => {
		const page = (number: number) => Array.from({ length: 100 }, (_entry, index) => ({ voice_id: `voice-${number}-${index}`, name: `Voice ${number}.${index}`, category: 'generated', labels: {} }));
		const many = await listVoicesAgainst(ELEVENLABS, 'eleven-v3', { apiKey: KEY }, routed(voicePages(...Array.from({ length: 25 }, (_entry, number) => page(number)))));
		const looping = await listVoicesAgainst(ELEVENLABS, 'eleven-v3', { apiKey: KEY }, (request, response) => sendJson(response, 200, { voices: [{ voice_id: `voice-${request.path.length}`, name: 'Again', category: 'cloned' }], has_more: true, next_page_token: 'same' }));
		const listed = value(many.answer);
		assert.deepEqual({
			many: [listed.voices.length, listed.truncated, listed.voices.at(-1)?.id, many.received.length],
			looping: [value(looping.answer).voices.length, value(looping.answer).truncated, looping.received.length]
		}, {
			many: [2000, true, 'voice-19-99', 20],
			looping: [2, undefined, 2]
		});
	});

	test('a voice\'s sample is fetched from ElevenLabs\' storage without the key, which goes only to the API', async () => {
		const cdn = await startServer(routed(serveFiles({ '/eleven-public-prod/premade/voices/george/preview.mp3': tinyMp3() })));
		const api = await startServer(routed(answerSounds));
		try {
			const fetched = await commands().voicePreview({ ...access(api.url), model: 'eleven-multilingual-v2', sample: `${cdn.url}/eleven-public-prod/premade/voices/george/preview.mp3` });
			assert.ok(fetched.ok && fetched.value.bytes instanceof VSBuffer);
			assert.deepEqual({
				format: fetched.ok ? fetched.value.format : undefined,
				same: fetched.ok ? Buffer.from(fetched.value.bytes.buffer).equals(tinyMp3()) : false,
				keyToCdn: cdn.received.map(entry => entry.headers['xi-api-key'] ?? null),
				toApi: api.received.length
			}, { format: 'mp3', same: true, keyToCdn: [null], toApi: 0 });
		} finally {
			await cdn.close();
			await api.close();
		}
	});

	test('ElevenLabs\' errors map to plain codes and messages: a key, a permission, credits, a plan, a stopped free plan, a voice, fields, too many requests, and a server error, each sent once', async () => {
		const legacy = (status: number, code: string, message: string, headers: Record<string, string> = {}) => (response: ServerResponse) =>
			sendJson(response, status, { detail: { status: code, message } }, headers);
		const current = (status: number, type: string, code: string, message: string) => (response: ServerResponse) =>
			sendJson(response, status, { detail: { type, code, message, status: code, request_id: '3c807fc4c3a1705f9638ecc764a91c01' } });
		const unusual = 'Unusual activity detected. Free Tier usage disabled. If you are using a proxy/VPN you might need to purchase a Paid Plan to not trigger our abuse detectors.';
		const answers: Record<string, (response: ServerResponse) => void> = {
			key: legacy(401, 'invalid_api_key', 'Invalid API key'),
			permission: legacy(401, 'missing_permissions', 'The API key you used is missing the permission text_to_speech to execute this operation.'),
			quota: legacy(401, 'quota_exceeded', 'This request exceeds your quota of 10000. You have 12 credits remaining, while 40 credits are required for this request.'),
			credits: current(402, 'payment_required', 'insufficient_credits', 'Your account does not have enough credits for this operation.'),
			payment: (response) => sendJson(response, 402, { detail: { status: 'payment_required', message: 'Payment is required.' } }),
			paidPlan: current(402, 'payment_required', 'paid_plan_required', 'Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.'),
			subscription: current(403, 'authorization_error', 'subscription_required', 'A paid subscription is required to access this feature.'),
			freePlan: legacy(401, 'detected_unusual_activity', unusual),
			missingVoice: legacy(400, 'voice_not_found', 'A voice with voice_id \'nobody\' was not found.'),
			missingVoiceNow: current(404, 'not_found', 'voice_not_found', 'The specified voice ID does not exist.'),
			deniedVoice: current(403, 'authorization_error', 'voice_access_denied', 'You do not have access to this voice.'),
			allowlist: current(403, 'authorization_error', 'forbidden', 'Access to this resource is forbidden.'),
			fields: (response) => sendJson(response, 422, { detail: [{ loc: ['body', 'voice_settings', 'stability'], msg: 'Input should be less than or equal to 1', type: 'less_than_equal' }, { loc: ['query', 'output_format'], msg: 'Input should be mp3_44100_128', type: 'enum' }] }),
			tooLong: legacy(400, 'max_character_limit_exceeded', 'This request\'s text has 10001 characters and exceeds the character limit of 10000 characters.'),
			concurrent: legacy(429, 'too_many_concurrent_requests', 'Too many concurrent requests. Your current subscription is associated with a maximum of 2 concurrent requests.'),
			busy: legacy(429, 'system_busy', 'We are experiencing heavy traffic, please try again later.', { 'Retry-After': '5' }),
			server: current(500, 'internal_error', 'internal_error', 'An unexpected error occurred. Contact support if this persists.'),
			unavailable: current(503, 'service_unavailable', 'quota_exceeded', 'The service is temporarily unavailable. Try again later.')
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
				outcomes[name] = error(await providers.submit(audioRequest(access(server.url), 'eleven-v4', { params: { voice: 'nobody' } })));
			}
			outcomes.dropped = error(await providers.submit(audioRequest(access(`${server.url}/drop`), 'eleven-v4'))).code;
			const never = error(await commands({ atOnceTimeoutMs: 200 }).submit(audioRequest(access(silent.url), 'eleven-text-to-sound-v2')));
			const plan = (said: string) => `The plan of this ElevenLabs account does not include this: ${said}`;
			assert.deepEqual({ outcomes, sent: server.received.length, never: [never.code, /No answer came in time/.test(never.message), silent.received.length] }, {
				outcomes: {
					key: { code: 'auth', message: 'Invalid API key', status: 401 },
					permission: { code: 'auth', message: 'The API key lacks a permission that this needs: The API key you used is missing the permission text_to_speech to execute this operation. Allow it for the key on ElevenLabs\' API keys page, or use a key that has it.', status: 401 },
					// A legacy empty quota comes with 401, and is no refused key.
					quota: { code: 'balance', message: 'This request exceeds your quota of 10000. You have 12 credits remaining, while 40 credits are required for this request.', status: 401 },
					credits: { code: 'balance', message: 'Your account does not have enough credits for this operation.', status: 402 },
					payment: { code: 'balance', message: 'Payment is required.', status: 402 },
					paidPlan: { code: 'rejected', message: plan('Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.'), status: 402 },
					subscription: { code: 'rejected', message: plan('A paid subscription is required to access this feature.'), status: 403 },
					freePlan: { code: 'rejected', message: 'ElevenLabs has stopped the free plan of this account, as it does when it notices unusual activity, such as a VPN or a network that others share. A paid plan is not affected.', status: 401 },
					missingVoice: { code: 'rejected', message: 'ElevenLabs does not know this voice, or this account cannot use it: choose another voice. ElevenLabs says: A voice with voice_id \'nobody\' was not found.', status: 400 },
					missingVoiceNow: { code: 'rejected', message: 'ElevenLabs does not know this voice, or this account cannot use it: choose another voice. ElevenLabs says: The specified voice ID does not exist.', status: 404 },
					deniedVoice: { code: 'rejected', message: 'This ElevenLabs account may not use this voice: choose another voice. ElevenLabs says: You do not have access to this voice.', status: 403 },
					allowlist: { code: 'auth', message: 'Access to this resource is forbidden.', status: 403 },
					fields: { code: 'rejected', message: 'ElevenLabs refused the request: voice_settings.stability: Input should be less than or equal to 1; query.output_format: Input should be mp3_44100_128', status: 422 },
					tooLong: { code: 'rejected', message: 'This request\'s text has 10001 characters and exceeds the character limit of 10000 characters.', status: 400 },
					concurrent: { code: 'rateLimited', message: 'ElevenLabs is already running as many requests of this account at once as its plan allows: wait for them to finish, then generate again. ElevenLabs says: Too many concurrent requests. Your current subscription is associated with a maximum of 2 concurrent requests.', status: 429 },
					busy: { code: 'rateLimited', message: 'ElevenLabs is busy: generate again in a moment. The provider asks to wait 5 seconds.', status: 429 },
					server: { code: 'unknownOutcome', message: 'An unexpected error occurred. Contact support if this persists.', status: 500 },
					// A server error keeps its unknown outcome, whatever its code says.
					unavailable: { code: 'unknownOutcome', message: 'The service is temporarily unavailable. Try again later.', status: 503 },
					dropped: 'unknownOutcome'
				},
				// Each request was sent once, never again.
				sent: Object.keys(answers).length + 1,
				never: ['unknownOutcome', true, 1]
			});
		} finally {
			await server.close();
			await silent.close();
		}
	});

	test('a key that may not list voices is refused with the permission it lacks, once, and a voices answer that is not a list is unreadable', async () => {
		const refused = await listVoicesAgainst(ELEVENLABS, 'eleven-v4', { apiKey: KEY }, (request, response) =>
			sendJson(response, 401, { detail: { status: 'missing_permissions', message: 'The API key you used is missing the permission voices_read to execute this operation.' } }));
		const unreadable = await listVoicesAgainst(ELEVENLABS, 'eleven-v4', { apiKey: KEY }, (request, response) => sendJson(response, 200, { voices: 'many' }));
		assert.deepEqual({ refused: [refused.answer, refused.received.length], unreadable: unreadable.answer }, {
			refused: [{ ok: false, error: { code: 'auth', message: 'The API key lacks a permission that this needs: The API key you used is missing the permission voices_read to execute this operation. Allow it for the key on ElevenLabs\' API keys page, or use a key that has it.', status: 401 } }, 1],
			unreadable: { ok: false, error: { code: 'invalidResponse', message: 'ElevenLabs answered voices BaseHalf cannot read.' } }
		});
	});

	test('check takes a voice of the account and refuses what a model does not take: a long prompt, a setting of another model, a stability between Eleven v3\'s presets, and a duration beyond 30 seconds', async () => {
		const problems = async (model: string, params: Record<string, unknown>, prompt = 'Welcome to the coast.') =>
			value(await commands().check({ provider: 'elevenlabs', region: 'global', model, mode: 'reference', params, prompt, inputs: { images: [], videos: [], audios: [] } })).problems;
		assert.deepEqual({
			accountVoice: await problems('eleven-v4', { voice: 'JBFqnCBsd6RMkjVDRZzb' }),
			longV3: await problems('eleven-v3', {}, 'a'.repeat(5001)),
			longFlash: await problems('eleven-flash-v2.5', {}, 'a'.repeat(40_000)),
			empty: await problems('eleven-v4', {}, ''),
			speedOnV3: await problems('eleven-v3', { speed: 1 }),
			between: await problems('eleven-v3', { stability: 0.3 }),
			fastV2: await problems('eleven-multilingual-v2', { speed: 1.3 }),
			languageOnV2: await problems('eleven-multilingual-v2', { language_code: 'en' }),
			longSound: await problems('eleven-text-to-sound-v2', { duration: 31 }),
			longDescription: await problems('eleven-text-to-sound-v2', {}, 'a'.repeat(451)),
			auto: await problems('eleven-text-to-sound-v2', { duration: -1 })
		}, {
			accountVoice: [],
			longV3: ['The prompt is 5001 characters long; Eleven v3 takes at most 5000.'],
			longFlash: [],
			empty: ['Write a prompt: Eleven v4 needs one.'],
			speedOnV3: ['Eleven v3 has no setting named "speed".'],
			between: ['Stability cannot be 0.3 for Eleven v3; choose Creative, Natural, Robust.'],
			fastV2: ['Speed must be between 0.7 and 1.2.'],
			languageOnV2: ['Multilingual v2 has no setting named "language_code".'],
			longSound: ['Duration must be between 1 and 30 seconds, or Auto.'],
			longDescription: ['The prompt is 451 characters long; Sound Effects takes at most 450.'],
			auto: []
		});
	});

	test('ElevenLabs has no task: poll refuses one, and cancel answers false, without a request', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const providers = commands();
			const ref = { ...access(server.url), model: 'eleven-v4', remoteId: 'speech-1' };
			assert.deepEqual({ poll: error(await providers.poll(ref)), cancel: value(await providers.cancel(ref)), sent: server.received.length }, {
				poll: { code: 'rejected', message: 'Eleven v4 answers with its sound at once: there is no task to ask about.' },
				cancel: { cancelled: false },
				sent: 0
			});
		} finally {
			await server.close();
		}
	});
});
