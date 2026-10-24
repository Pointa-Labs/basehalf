/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The voices of a speech model and their samples (D78; providers, "Voices",
 * "Requests", criterion 16): `voices` through the test audio module's list
 * calls, and `voicePreview` of a sample, against local servers that answer as
 * a provider's API and its CDN do.
 */

import { strict as assert } from 'assert';
import type { ServerResponse } from 'http';
import type { Socket } from 'net';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { MAX_VOICE_SAMPLE_BYTES } from '../../node/download.js';
import { ProviderFailure } from '../../node/failure.js';
import type { ListedVoice, VoicePreviewResult } from '../../common/basehalfProviderTypes.js';
import { error, isoMedia, listVoicesAgainst, routed, sendJson, serveFiles, startServer, testAccess, testAudioModule, tinyMp3, tinyWav, value, type Received, type TestProviderVoice, type TestRoute } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerVoices', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const KEY = 'sk-voices-secret-1';

	function commands(overrides: Parameters<typeof testAudioModule>[0] = {}) {
		return new VideoProviderCommands([testAudioModule(overrides)], { http: { sleep: async () => undefined } });
	}

	function access(server: string, region?: string) {
		return testAccess(testAudioModule(), server, { apiKey: KEY }, region);
	}

	/** The test provider's list call, `GET /v1/voices?page=<n>`, answering these pages in order. */
	function voicePages(...pages: readonly (readonly TestProviderVoice[])[]): TestRoute {
		return (request, response) => {
			const [path, query] = request.path.split('?');
			if (request.method !== 'GET' || path !== '/v1/voices') {
				return false;
			}
			const page = Number(new URLSearchParams(query).get('page'));
			sendJson(response, 200, { voices: pages[page - 1] ?? [], has_more: page < pages.length });
			return true;
		};
	}

	test('voices lists the account\'s voices first, then the provider\'s, over the pages the module asks for, with their samples and the key only to the endpoint (D78)', async () => {
		const { answer, received } = await listVoicesAgainst(testAudioModule(), 'speech-1', { apiKey: KEY }, routed(voicePages(
			[
				{ voice_id: 'aria', name: 'Aria', category: 'premade', labels: { gender: 'female', accent: 'American' }, preview_url: 'https://cdn.example.com/aria.mp3' },
				{ voice_id: 'cloned-7', name: 'My Narrator', category: 'cloned', preview_url: 'https://cdn.example.com/cloned-7.mp3?sig=1' }
			],
			[
				{ voice_id: 'bo', name: 'Bo', category: 'premade' },
				{ voice_id: 'designed-2', name: 'Sea Captain', category: 'generated', labels: { age: 'old' } }
			]
		)));
		assert.deepEqual({ answer, received: received.map(entry => `${entry.method} ${entry.path} ${entry.headers.authorization}`) }, {
			answer: {
				ok: true,
				value: {
					voices: [
						{ id: 'cloned-7', label: 'My Narrator', own: true, sample: 'https://cdn.example.com/cloned-7.mp3?sig=1' },
						{ id: 'designed-2', label: 'Sea Captain', description: 'old', own: true },
						{ id: 'aria', label: 'Aria', description: 'female, American', own: false, sample: 'https://cdn.example.com/aria.mp3' },
						{ id: 'bo', label: 'Bo', own: false }
					]
				}
			},
			received: [`GET /v1/voices?page=1 Bearer ${KEY}`, `GET /v1/voices?page=2 Bearer ${KEY}`]
		});
	});

	test('voices sends the key only to the endpoint\'s own origin, not to a page of voices the provider gives elsewhere (D78)', async () => {
		const elsewhere = await startServer((request, response) => sendJson(response, 200, { voices: [{ voice_id: 'bo', name: 'Bo', category: 'premade' }] }));
		const api = await startServer((request, response) => sendJson(response, 200, { voices: [{ voice_id: 'aria', name: 'Aria', category: 'premade' }], next: `${elsewhere.url}/voices/page-2?cursor=2` }));
		try {
			// A module that follows the address of the next page that the provider answers, as some list calls do.
			const providers = commands({
				async listVoices(_request, http) {
					const first = (await http.request({ method: 'GET', path: '/voices' })).object();
					const second = (await http.request({ method: 'GET', url: String(first.next) })).object();
					return { voices: [...first.voices as TestProviderVoice[], ...second.voices as TestProviderVoice[]].map(voice => ({ id: voice.voice_id, label: voice.name ?? '', own: false })) };
				}
			});
			const answered = value(await providers.voices({ ...access(api.url), model: 'speech-1' }));
			assert.deepEqual({
				answered: answered.voices.map(voice => voice.id),
				keyToApi: api.received.map(entry => entry.headers.authorization),
				keyElsewhere: elsewhere.received.map(entry => [entry.path, entry.headers.authorization ?? null])
			}, {
				answered: ['aria', 'bo'],
				keyToApi: [`Bearer ${KEY}`],
				keyElsewhere: [['/voices/page-2?cursor=2', null]]
			});
		} finally {
			await api.close();
			await elsewhere.close();
		}
	});

	test('voices answers what the module listed made safe to show and to send back: ids, names, descriptions, samples, and each voice once (D78)', async () => {
		const listed: unknown[] = [
			{ id: '', label: 'No id', own: true },
			{ id: 'v'.repeat(257), label: 'Too long an id', own: true },
			{ id: 'line\nbreak', label: 'Control character', own: false },
			{ id: '   ', label: 'Blank id', own: false },
			'not a voice',
			{ id: 'plain', label: '  Plain\tName\u0007  ', description: ' Warm,\ncalm ', own: false, sample: 'http://cdn.example.com/plain.mp3' },
			{ id: 'unnamed', label: '', own: 'yes', sample: 'https://cdn.example.com/unnamed.mp3' },
			{ id: 'long', label: 'L'.repeat(250), description: 'd'.repeat(400), own: true, sample: `https://cdn.example.com/${'s'.repeat(9000)}.mp3` },
			{ id: 'local', label: 'Local', own: false, sample: 'http://127.0.0.1:9/local.mp3' },
			{ id: 'script', label: 'Script', own: false, sample: 'javascript:alert(1)' },
			{ id: 'twice', label: 'Twice, the provider\'s', own: false },
			{ id: 'twice', label: 'Twice, the account\'s', own: true },
			{ id: '声音-1', label: '声音', own: false }
		];
		const answered = value(await commands({ listVoices: async () => ({ voices: listed as ListedVoice[] }) }).voices({ ...access('https://api.example.com'), model: 'speech-1' }));
		assert.deepEqual(answered, {
			voices: [
				{ id: 'long', label: `${'L'.repeat(199)}…`, description: `${'d'.repeat(299)}…`, own: true },
				{ id: 'twice', label: 'Twice, the account\'s', own: true },
				{ id: 'plain', label: 'Plain Name', description: 'Warm, calm', own: false },
				{ id: 'unnamed', label: 'unnamed', own: false, sample: 'https://cdn.example.com/unnamed.mp3' },
				{ id: 'local', label: 'Local', own: false, sample: 'http://127.0.0.1:9/local.mp3' },
				{ id: 'script', label: 'Script', own: false },
				{ id: '声音-1', label: '声音', own: false }
			]
		});
	});

	test('voices answers at most 2,000, and says when the provider had more (D78)', async () => {
		const voices = (count: number, own = false) => Array.from({ length: count }, (_entry, index): ListedVoice => ({ id: `voice-${own ? 'own' : 'library'}-${index}`, label: `Voice ${index}`, own }));
		const listing = (answer: { voices: ListedVoice[]; truncated?: boolean }) => commands({ listVoices: async () => answer }).voices({ ...access('https://api.example.com'), model: 'speech-1' });
		const many = value(await listing({ voices: [...voices(2400), ...voices(3, true)] }));
		const told = value(await listing({ voices: voices(5), truncated: true }));
		const exact = value(await listing({ voices: voices(2000) }));
		assert.deepEqual({
			many: [many.voices.length, many.truncated, many.voices.slice(0, 4).map(voice => voice.id)],
			told: [told.voices.length, told.truncated],
			exact: [exact.voices.length, exact.truncated]
		}, {
			many: [2000, true, ['voice-own-0', 'voice-own-1', 'voice-own-2', 'voice-library-0']],
			told: [5, true],
			exact: [2000, undefined]
		});
		// The module is asked for at most 2,000.
		const limits: number[] = [];
		value(await commands({ listVoices: async (_request, _http, limit) => { limits.push(limit); return { voices: [] }; } }).voices({ ...access('https://api.example.com'), model: 'speech-1' }));
		assert.deepEqual(limits, [2000]);
	});

	test('voices refuses a model whose voice the provider does not list, a model without a voice, a region that does not offer the model, and missing credentials, and sends nothing (D78)', async () => {
		const server = await startServer(routed(voicePages([{ voice_id: 'aria', name: 'Aria', category: 'premade' }])));
		try {
			const providers = commands();
			const asked = async (overrides: Record<string, unknown>) => error(await providers.voices({ ...access(server.url), model: 'speech-1', ...overrides }));
			assert.deepEqual({
				notListed: await asked({ model: 'speech-fixed' }),
				noVoice: await asked({ model: 'song-1' }),
				otherRegion: await asked({ ...access(server.url, 'away') }),
				noCredentials: await asked({ credentials: {} }),
				unknownModel: await asked({ model: 'speech-9' }),
				unknownProvider: (await asked({ provider: 'nobody' })).code,
				notARequest: (error(await providers.voices('voices, please'))).code,
				sent: server.received.length
			}, {
				notListed: { code: 'rejected', message: 'Test Audio lists no voices of Speech Fixed.' },
				noVoice: { code: 'rejected', message: 'Test Audio lists no voices of Song 1.' },
				otherRegion: { code: 'rejected', message: 'Test Audio does not offer Speech 1 in Away.' },
				noCredentials: { code: 'auth', message: 'Test Audio needs its API Key. Set it in Providers.' },
				unknownModel: { code: 'rejected', message: 'Test Audio has no model "speech-9".' },
				unknownProvider: 'unknownProvider',
				notARequest: 'rejected',
				sent: 0
			});
		} finally {
			await server.close();
		}
	});

	test('voices is retried as a poll is, after a network error, 429, and 503, and a refused key answers auth at once; no message carries the key (D78)', async () => {
		let calls = 0;
		const flaky = (request: Received, response: ServerResponse, socket: Socket) => {
			calls++;
			if (calls === 1) {
				socket.destroy();
				return;
			}
			if (calls === 2) {
				sendJson(response, 429, { error: { message: 'Slow down.' } });
				return;
			}
			if (calls === 3) {
				sendJson(response, 503, { error: { message: 'Busy.' } });
				return;
			}
			sendJson(response, 200, { voices: [{ voice_id: 'aria', name: 'Aria', category: 'premade' }], has_more: false });
		};
		const retried = await listVoicesAgainst(testAudioModule(), 'speech-1', { apiKey: KEY }, flaky);
		const refused = await listVoicesAgainst(testAudioModule(), 'speech-1', { apiKey: KEY }, (request, response) => sendJson(response, 401, { error: { message: `Invalid key ${KEY}.` } }));
		const forbidden = await listVoicesAgainst(testAudioModule(), 'speech-1', { apiKey: KEY }, (request, response) => sendJson(response, 403, { detail: 'This key may not list voices.' }));
		const unreadable = await listVoicesAgainst(testAudioModule({ listVoices: async () => ({ voices: 'many' as never }) }), 'speech-1', { apiKey: KEY }, (request, response) => sendJson(response, 200, {}));
		const thrown = await listVoicesAgainst(testAudioModule({ listVoices: async () => { throw new ProviderFailure('rejected', `The key ${KEY} may not do this.`); } }), 'speech-1', { apiKey: KEY }, (request, response) => sendJson(response, 200, {}));
		assert.deepEqual({
			retried: [retried.answer, retried.received.length],
			refused: [refused.answer, refused.received.length],
			forbidden: [forbidden.answer, forbidden.received.length],
			unreadable: unreadable.answer,
			thrown: thrown.answer
		}, {
			retried: [{ ok: true, value: { voices: [{ id: 'aria', label: 'Aria', own: false }] } }, 4],
			refused: [{ ok: false, error: { code: 'auth', message: 'Invalid key ***.', status: 401 } }, 1],
			forbidden: [{ ok: false, error: { code: 'auth', message: 'This key may not list voices.', status: 403 } }, 1],
			unreadable: { ok: false, error: { code: 'invalidResponse', message: 'The provider answered voices BaseHalf cannot read.' } },
			thrown: { ok: false, error: { code: 'rejected', message: 'The key *** may not do this.' } }
		});
	});

	/** The bytes and format of a sample's answer, or its error. */
	function sampleOf(response: Awaited<ReturnType<VideoProviderCommands['voicePreview']>>): { readonly format: VoicePreviewResult['format']; readonly bytes: Buffer } | { readonly code: string; readonly message: string } {
		if (!response.ok) {
			return { code: response.error.code, message: response.error.message };
		}
		assert.ok(response.value.bytes instanceof VSBuffer, 'a sample is a VSBuffer');
		return { format: response.value.format, bytes: Buffer.from(response.value.bytes.buffer) };
	}

	test('voicePreview answers a sample\'s bytes and format after redirects, with the key on the endpoint\'s origin only (D78)', async () => {
		const cdn = await startServer(routed(serveFiles({ '/samples/aria.mp3': tinyMp3(), '/samples/bo.wav': tinyWav() })));
		const api = await startServer((request, response) => {
			// The provider's own address of a sample, which needs the key, sends it on to its CDN.
			const name = /^\/v1\/voices\/(?<name>[a-z]+)\/sample/.exec(request.path)?.groups?.name;
			response.writeHead(302, { Location: `${cdn.url}/samples/${name}.${name === 'bo' ? 'wav' : 'mp3'}?sig=1` });
			response.end();
		});
		try {
			const providers = commands();
			const fetched = sampleOf(await providers.voicePreview({ ...access(api.url), model: 'speech-1', sample: `${api.url}/v1/voices/aria/sample` }));
			const direct = sampleOf(await providers.voicePreview({ ...access(api.url), model: 'speech-1', sample: `${cdn.url}/samples/bo.wav` }));
			assert.deepEqual({
				fetched,
				direct,
				keyToApi: api.received.map(entry => entry.headers.authorization),
				keyToCdn: cdn.received.map(entry => entry.headers.authorization ?? null),
				accept: cdn.received[0].headers.accept
			}, {
				fetched: { format: 'mp3', bytes: tinyMp3() },
				direct: { format: 'wav', bytes: tinyWav() },
				keyToApi: [`Bearer ${KEY}`],
				keyToCdn: [null, null],
				accept: 'audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/mp4,application/octet-stream;q=0.9,*/*;q=0.5'
			});
		} finally {
			await api.close();
			await cdn.close();
		}
	});

	test('voicePreview follows at most five redirects, keeps at most 5 MiB, refuses what is not a sound, and is retried as a download is (D78)', async () => {
		let busy = 0;
		const server = await startServer(routed(
			serveFiles({ '/video.mp4': isoMedia(2), '/page.html': Buffer.from('<html>Sign in to listen.</html>'.repeat(4)), '/short.mp3': tinyMp3().subarray(0, 30) }),
			(request, response) => {
				const path = request.path.split('?')[0];
				if (path === '/hops') {
					const hops = Number(new URLSearchParams(request.path.split('?')[1]).get('left'));
					response.writeHead(302, { Location: hops > 0 ? `/hops?left=${hops - 1}` : '/sample.mp3' });
					response.end();
					return true;
				}
				if (path === '/sample.mp3') {
					response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(tinyMp3().byteLength) });
					response.end(tinyMp3());
					return true;
				}
				if (path === '/announced.wav') {
					response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(MAX_VOICE_SAMPLE_BYTES + 1) });
					response.flushHeaders();
					return true;
				}
				if (path === '/streamed.wav') {
					// No length announced: the limit is found while reading.
					response.writeHead(200, { 'Content-Type': 'audio/wav' });
					response.write(tinyWav());
					response.end(Buffer.alloc(MAX_VOICE_SAMPLE_BYTES));
					return true;
				}
				if (path === '/busy.mp3') {
					busy++;
					if (busy < 3) {
						sendJson(response, 503, {});
						return true;
					}
					response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
					response.end(tinyMp3());
					return true;
				}
				if (path === '/v1/private.mp3') {
					sendJson(response, 403, { detail: 'Not your voice.' });
					return true;
				}
				return false;
			}
		));
		try {
			const providers = commands();
			const preview = async (path: string) => sampleOf(await providers.voicePreview({ ...access(server.url), model: 'speech-1', sample: `${server.url}${path}` }));
			const unlike = { code: 'notAudio', message: 'The file does not start like an MP3, WAV, FLAC, Ogg, or M4A sound.' };
			assert.deepEqual({
				fiveHops: await preview('/hops?left=4'),
				sixHops: await preview('/hops?left=5'),
				announced: await preview('/announced.wav'),
				streamed: await preview('/streamed.wav'),
				video: await preview('/video.mp4'),
				page: await preview('/page.html'),
				short: await preview('/short.mp3'),
				busy: await preview('/busy.mp3'),
				gone: await preview('/gone.mp3'),
				refusedByEndpoint: await preview('/v1/private.mp3')
			}, {
				fiveHops: { format: 'mp3', bytes: tinyMp3() },
				sixHops: { code: 'invalidResponse', message: 'The sample address redirected more than five times.' },
				announced: { code: 'tooLarge', message: `The sample is ${MAX_VOICE_SAMPLE_BYTES + 1} bytes, more than the ${MAX_VOICE_SAMPLE_BYTES} bytes BaseHalf downloads.` },
				streamed: { code: 'tooLarge', message: `The sample is larger than the ${MAX_VOICE_SAMPLE_BYTES} bytes BaseHalf downloads.` },
				video: unlike,
				page: unlike,
				short: { code: 'notAudio', message: 'The file is too short to be an MP3, WAV, FLAC, Ogg, or M4A sound.' },
				busy: { format: 'mp3', bytes: tinyMp3() },
				gone: { code: 'notFound', message: 'The sample is no longer at the address the provider gave (HTTP 404); the address may have expired.' },
				// The endpoint's own origin refusing the key is a refused key.
				refusedByEndpoint: { code: 'auth', message: 'The provider refused the sample download (HTTP 403). Check the credentials in Providers.' }
			});
			assert.equal(MAX_VOICE_SAMPLE_BYTES, 5 * 1024 * 1024);
		} finally {
			await server.close();
		}
	});

	test('voicePreview fetches only an https address, or an http one on this computer, only for a model whose voices are listed, and sends nothing otherwise (D78)', async () => {
		const server = await startServer(routed(serveFiles({ '/v1/sample.mp3': tinyMp3() })));
		try {
			const providers = commands();
			const refused = async (overrides: Record<string, unknown>) => error(await providers.voicePreview({ ...access(server.url), model: 'speech-1', sample: `${server.url}/v1/sample.mp3`, ...overrides }));
			const notHttps = { code: 'rejected', message: 'BaseHalf fetches a sample only from an https:// address, or an http:// address on this computer.' };
			assert.deepEqual({
				plainHttp: await refused({ sample: 'http://cdn.example.com/aria.mp3' }),
				withPassword: await refused({ sample: 'https://user:secret@cdn.example.com/aria.mp3' }),
				otherScheme: await refused({ sample: 'file:///etc/hosts' }),
				notAnAddress: await refused({ sample: 'aria.mp3' }),
				tooLong: (await refused({ sample: `https://cdn.example.com/${'s'.repeat(9000)}.mp3` })).code,
				notListed: await refused({ model: 'speech-fixed' }),
				noVoice: await refused({ model: 'fx-1' }),
				noCredentials: (await refused({ credentials: {} })).code,
				sent: server.received.length
			}, {
				plainHttp: notHttps,
				withPassword: notHttps,
				otherScheme: notHttps,
				notAnAddress: notHttps,
				tooLong: 'rejected',
				notListed: { code: 'rejected', message: 'Test Audio lists no voices of Speech Fixed, so it has no samples.' },
				noVoice: { code: 'rejected', message: 'Test Audio lists no voices of Effects 1, so it has no samples.' },
				noCredentials: 'auth',
				sent: 0
			});
			// On this computer, the endpoint's own origin gets the key.
			assert.deepEqual([sampleOf(await providers.voicePreview({ ...access(server.url), model: 'speech-1', sample: `${server.url}/v1/sample.mp3` })), server.received.map(entry => entry.headers.authorization)], [
				{ format: 'mp3', bytes: tinyMp3() },
				[`Bearer ${KEY}`]
			]);
		} finally {
			await server.close();
		}
	});
});
