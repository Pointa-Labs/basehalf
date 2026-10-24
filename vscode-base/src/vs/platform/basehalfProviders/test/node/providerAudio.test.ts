/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sounds as the outputs of a generation and the checks of an audio model
 * (D78; providers, "Requests", "Parameters", criteria 15, 17, and 18), with
 * the test audio provider of the test kit: speech and sound effects answered
 * at once, songs answered at once or as a task, a voice the provider lists
 * and one it does not, and Lyrics mode.
 */

import { strict as assert } from 'assert';
import { existsSync, readFileSync } from 'fs';
import { VideoProviderCommands, type VideoProviderCommandOptions } from '../../node/commands.js';
import type { CheckRequest, ParamValue } from '../../common/basehalfProviderTypes.js';
import { answerAudioAtOnce, audioRequest, error, partTargets, plannedFiles, png, routed, sendJson, serveFiles, startServer, testAccess, testAudioModule, testModule, tinyMp3, tinyWav, value, type AudioRequestOptions } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerAudio', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const KEY = 'sk-audio-secret-1';
	const UNLIKE = 'The file does not start like an MP3, WAV, FLAC, Ogg, or M4A sound.';

	function commands(overrides: Parameters<typeof testAudioModule>[0] = {}, options: VideoProviderCommandOptions = {}) {
		return new VideoProviderCommands([testAudioModule(overrides), testModule()], { ...options, http: { sleep: async () => undefined, ...options.http } });
	}

	function access(server: string) {
		return testAccess(testAudioModule(), server, { apiKey: KEY });
	}

	test('a speech model answered at once writes the sound to its target, and the bytes decide its format, whatever the module said (D78)', async () => {
		const server = await startServer(routed(answerAudioAtOnce({ path: '/v1/speech/speech-fixed', sounds: [tinyWav()], as: 'bytes' })));
		try {
			const request = audioRequest(access(server.url), 'speech-fixed', { prompt: 'Welcome to the coast.' });
			const [target] = request.targets ?? [];
			// The module says MP3; the provider answered a WAV.
			const answered = value(await commands().submit(request));
			const sent = server.received[0];
			assert.deepEqual({
				answered,
				same: readFileSync(target).equals(tinyWav()),
				sent: [sent.method, sent.path, sent.headers.authorization, sent.headers.accept, JSON.parse(sent.body.toString('utf8'))]
			}, {
				answered: { outputs: [{ written: target, size: tinyWav().byteLength, format: 'wav' }] },
				same: true,
				// The voice the card left unset is the catalog's default.
				sent: ['POST', '/v1/speech/speech-fixed', `Bearer ${KEY}`, 'audio/mpeg', { text: 'Welcome to the coast.', params: { voice: 'Kore' } }]
			});
		} finally {
			await server.close();
		}
	});

	test('the test kit answers sounds at once as hex, as base64, or as addresses it serves, as speech and music APIs answer (D78)', async () => {
		const hex = await startServer(routed(answerAudioAtOnce({ path: '/v1/speech/fx-1', sounds: [tinyMp3()], as: 'hex', shape: ([audio]) => ({ data: { audio, status: 2 } }) })));
		const base64 = await startServer(routed(answerAudioAtOnce({ path: '/v1/songs', sounds: [tinyWav(), tinyMp3()], as: 'base64', shape: songs => ({ songs: songs.map(audio => ({ audio })) }) })));
		const addresses = await startServer(routed(answerAudioAtOnce({ path: '/v1/songs', sounds: [tinyMp3(), tinyWav()], as: 'url', shape: songs => ({ songs: songs.map(url => ({ url })) }) })));
		try {
			// A module that reads the hex of a sound inside JSON, as some speech APIs answer.
			const fromHex = commands({
				async submit(_request, http) {
					const answer = (await http.create({ method: 'POST', path: '/speech/fx-1', body: { kind: 'json', value: {} } })).object() as { data: { audio: string } };
					return { outputs: [{ bytes: Buffer.from(answer.data.audio, 'hex') }] };
				}
			});
			const hexRequest = audioRequest(access(hex.url), 'fx-1');
			const fromBase64 = audioRequest(access(base64.url), 'song-1', { params: { count: 2 } });
			const fromAddresses = audioRequest(access(addresses.url), 'song-1', { params: { count: 2 } });
			const providers = commands();
			const songs = value(await providers.submit(fromAddresses)) as { readonly outputs: readonly { readonly url: string }[] };
			const downloaded = [];
			for (const { url } of songs.outputs) {
				downloaded.push(value(await providers.download({ ...access(addresses.url), model: 'song-1', kind: 'audio', url, targetFsPath: partTargets(1)[0] })));
			}
			assert.deepEqual({
				hex: value(await fromHex.submit(hexRequest)),
				base64: value(await providers.submit(fromBase64)),
				addresses: songs.outputs.map(output => output.url.replace(addresses.url, '')),
				downloaded
			}, {
				hex: { outputs: [{ written: hexRequest.targets?.[0], size: tinyMp3().byteLength, format: 'mp3' }] },
				base64: { outputs: [{ written: fromBase64.targets?.[0], size: tinyWav().byteLength, format: 'wav' }, { written: fromBase64.targets?.[1], size: tinyMp3().byteLength, format: 'mp3' }] },
				addresses: ['/files/sound-1.mp3', '/files/sound-2.wav'],
				downloaded: [{ size: tinyMp3().byteLength, format: 'mp3' }, { size: tinyWav().byteLength, format: 'wav' }]
			});
		} finally {
			await hex.close();
			await base64.close();
			await addresses.close();
		}
	});

	test('a music model whose count is 2 needs a target for each song, writes each to its own, and refuses a song that is not a sound on its own (D78)', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {
			songs: [{ audio: tinyMp3().toString('base64') }, { audio: Buffer.from('<html>busy</html>'.repeat(5)).toString('base64') }]
		}));
		try {
			const providers = commands();
			const fewer = error(await providers.submit(audioRequest(access(server.url), 'song-1', { params: { count: 3 }, targets: 2 })));
			const sentBefore = server.received.length;
			const request = audioRequest(access(server.url), 'song-1', { params: { count: 2 }, prompt: 'A slow song about the sea.' });
			const answered = value(await providers.submit(request));
			const targets = request.targets ?? [];
			assert.deepEqual({ fewer, sentBefore, answered, left: targets.map(target => existsSync(target)), same: readFileSync(targets[0]).equals(tinyMp3()) }, {
				fewer: { code: 'rejected', message: 'Song 1 may make 3 files, but the request names 2 to write them to. BaseHalf sent nothing.' },
				sentBefore: 0,
				answered: { outputs: [{ written: targets[0], size: tinyMp3().byteLength, format: 'mp3' }, { refused: UNLIKE }] },
				left: [true, false],
				same: true
			});
		} finally {
			await server.close();
		}
	});

	test('the poll of a song task writes the songs answered inline to the targets named with it, keeps an address, and says what a song refused without a word is (D78)', async () => {
		const server = await startServer((request, response) => {
			if (request.method === 'POST') {
				sendJson(response, 200, { id: 'song-task-1' });
				return;
			}
			sendJson(response, 200, { status: 'done', songs: [{ audio: tinyWav().toString('base64') }, { url: 'https://cdn.example.com/song-2.mp3?sig=1' }, { error: ' ' }] });
		});
		try {
			const providers = commands();
			const submitted = value(await providers.submit(audioRequest(access(server.url), 'song-tasks', { targets: 0 })));
			const targets = partTargets(3);
			const polled = value(await providers.poll({ ...access(server.url), model: 'song-tasks', remoteId: 'song-task-1', targets }));
			assert.deepEqual({ submitted, polled, left: targets.map(target => existsSync(target)) }, {
				submitted: { remoteId: 'song-task-1' },
				polled: {
					state: 'succeeded',
					outputs: [
						{ written: targets[0], size: tinyWav().byteLength, format: 'wav' },
						{ url: 'https://cdn.example.com/song-2.mp3?sig=1' },
						{ refused: 'The provider refused this sound.' }
					]
				},
				left: [true, false, false]
			});
		} finally {
			await server.close();
		}
	});

	test('a sound BaseHalf cannot keep is refused on its own with the reason, named as a sound, and the others land (D78)', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, {}));
		try {
			const providers = commands({
				async submit(_request, http) {
					await http.create({ method: 'POST', path: '/speech/fx-1', body: { kind: 'json', value: {} } });
					return {
						outputs: [
							{ url: 'http://cdn.example.com/effect.mp3' },
							{ url: `https://cdn.example.com/${'k'.repeat(9000)}.mp3` },
							{ bytes: png(64, 64) },
							{ bytes: tinyMp3() }
						]
					};
				}
			});
			const request = audioRequest(access(server.url), 'fx-1', { targets: 4 });
			const answered = value(await providers.submit(request));
			assert.deepEqual(answered, {
				outputs: [
					{ refused: 'The provider gave a sound address that does not start with https://.' },
					{ refused: 'The provider gave a sound address longer than BaseHalf takes.' },
					{ refused: UNLIKE },
					{ written: request.targets?.[3], size: tinyMp3().byteLength, format: 'mp3' }
				]
			});
		} finally {
			await server.close();
		}
	});

	test('download takes the kind audio and a sound\'s address, answers its format, and refuses another kind or no address (D78)', async () => {
		const cdn = await startServer(routed(serveFiles({ '/song.mp3': tinyMp3(), '/speech.wav': tinyWav(), '/page.html': Buffer.from('<html>expired</html>'.repeat(4)) })));
		try {
			const providers = commands();
			const endpoint = 'https://api.example.com/v1';
			const sound = (path: string, overrides: Record<string, unknown> = {}) => ({ provider: 'testaudio', region: 'home', endpoint, credentials: { apiKey: KEY }, model: 'song-tasks', remoteId: 'song-task-1', kind: 'audio', url: `${cdn.url}${path}`, targetFsPath: partTargets(1)[0], ...overrides });
			assert.deepEqual({
				mp3: value(await providers.download(sound('/song.mp3'))),
				wav: value(await providers.download(sound('/speech.wav', { remoteId: undefined }))),
				page: error(await providers.download(sound('/page.html'))),
				withoutAddress: error(await providers.download(sound('/song.mp3', { url: undefined }))),
				imageOfAudioModel: error(await providers.download(sound('/song.mp3', { kind: 'image' }))),
				audioOfImageModel: error(await providers.download(sound('/song.mp3', { provider: 'testprovider', model: 'still-tasks' }))),
				oddKind: error(await providers.download(sound('/song.mp3', { kind: 'text' }))),
				keySent: cdn.received.some(entry => entry.headers.authorization !== undefined)
			}, {
				mp3: { size: tinyMp3().byteLength, format: 'mp3' },
				wav: { size: tinyWav().byteLength, format: 'wav' },
				page: { code: 'notAudio', message: UNLIKE },
				withoutAddress: { code: 'rejected', message: 'BaseHalf downloads a sound only from the address the provider gave.' },
				imageOfAudioModel: { code: 'rejected', message: 'Song Tasks makes sounds; BaseHalf downloads only a file of that kind for it.' },
				audioOfImageModel: { code: 'rejected', message: 'Still Tasks makes images; BaseHalf downloads only a file of that kind for it.' },
				oddKind: { code: 'rejected', message: 'BaseHalf received a download it cannot read.' },
				keySent: false
			});
		} finally {
			await cdn.close();
		}
	});

	test('check takes a voice of the catalog, or any id of a voice when the provider lists voices, and only the catalog\'s otherwise (D78, criterion 17)', async () => {
		const seen: unknown[] = [];
		const providers = commands({
			async check(request) {
				seen.push(request.params.voice);
				return { problems: [] };
			}
		});
		const problems = async (model: string, voice?: ParamValue) => value(await providers.check(audioRequest(access('https://api.example.com'), model, { params: voice === undefined ? {} : { voice } }))).problems;
		assert.deepEqual({
			listedOption: await problems('speech-1', 'bo'),
			listedDefault: await problems('speech-1', undefined),
			accountVoice: await problems('speech-1', 'JBFqnCBsd6RMkjVDRZzb'),
			longestId: await problems('speech-1', '声'.repeat(256)),
			tooLong: await problems('speech-1', 'v'.repeat(257)),
			control: await problems('speech-1', 'aria\nbo'),
			blank: await problems('speech-1', '  '),
			number: await problems('speech-1', 42),
			fixedOption: await problems('speech-fixed', 'Puck'),
			fixedOther: await problems('speech-fixed', 'aria'),
			fixedLong: await problems('speech-fixed', 'v'.repeat(100))
		}, {
			listedOption: [],
			listedDefault: [],
			accountVoice: [],
			longestId: [],
			tooLong: ['Voice is 257 characters long; the id of a voice has at most 256.'],
			control: ['Voice has characters that the id of a voice cannot have.'],
			blank: ['Voice has no value.'],
			number: ['Voice must be the id of a voice.'],
			fixedOption: [],
			fixedOther: ['Voice cannot be aria for Speech Fixed; choose one of its voices.'],
			fixedLong: ['Speech Fixed has no such voice; choose one of its voices.']
		});
		// The module sees the voice that is sent: the card's, or the catalog's default.
		assert.deepEqual(seen, ['bo', 'aria', 'JBFqnCBsd6RMkjVDRZzb', '声'.repeat(256), 'Puck']);
	});

	test('in Lyrics mode the prompt is the lyrics: required whatever the model\'s rule, counted as it is sent, and Style applies there alone (D78, criterion 18)', async () => {
		const providers = commands();
		const song = (options: AudioRequestOptions) => audioRequest(access('https://api.example.com'), 'song-1', options);
		const problems = async (options: AudioRequestOptions) => value(await providers.check(song(options))).problems;
		// The lyrics, then a mention of the reference song, which the shared names write as `Audio 1`: 3 × 90 + 2 + 7 + 20 = 299 characters.
		const lyrics = (verses: number): AudioRequestOptions => ({ mode: 'lyrics', prompt: [`${'la '.repeat(verses)}\n\n`, { input: 'audios', index: 0 }, ' '.repeat(20)], inputs: plannedFiles({ audios: 1 }) });
		assert.deepEqual({
			noLyrics: await problems({ mode: 'lyrics', prompt: '' }),
			// A reference song does not stand for the lyrics.
			noLyricsWithSong: await problems({ mode: 'lyrics', prompt: '', inputs: plannedFiles({ audios: 1 }) }),
			noDescription: await problems({ prompt: '' }),
			withinLimit: await problems(lyrics(90)),
			beyondLimit: await problems(lyrics(91)),
			styleInDescription: await problems({ params: { style: 'Folk' } }),
			instrumentalInLyrics: await problems({ mode: 'lyrics', prompt: 'Tide comes in', params: { instrumental: true } }),
			styleInLyrics: await problems({ mode: 'lyrics', prompt: 'Tide comes in', params: { style: 'Slow folk, a woman sings' } }),
			written: value(await providers.check(song(lyrics(90)))).prompt
		}, {
			noLyrics: ['Write the lyrics: Song 1 sings them in From Lyrics mode.'],
			noLyricsWithSong: ['Write the lyrics: Song 1 sings them in From Lyrics mode.'],
			noDescription: ['Write a prompt: Song 1 needs one.'],
			withinLimit: [],
			beyondLimit: ['The prompt is 302 characters long; Song 1 takes at most 300.'],
			styleInDescription: ['Style does not apply in From a Description mode.'],
			instrumentalInLyrics: ['Instrumental does not apply in From Lyrics mode.'],
			styleInLyrics: [],
			written: `${'la '.repeat(90)}\n\nAudio 1${' '.repeat(20)}`
		});
	});

	test('a request in Lyrics mode reaches the module with the lyrics as its prompt and Style among its settings, as it was checked (D78, criterion 18)', async () => {
		const server = await startServer((request, response) => sendJson(response, 200, { songs: [{ audio: tinyMp3().toString('base64') }, { audio: tinyMp3().toString('base64') }] }));
		try {
			const checked: CheckRequest[] = [];
			const providers = commands({
				async check(request) {
					checked.push(request);
					return { problems: [] };
				}
			});
			const request = audioRequest(access(server.url), 'song-1', { mode: 'lyrics', prompt: 'Tide comes in, tide goes out', params: { style: 'Slow folk, a woman sings', count: 2 } });
			const answered = value(await providers.submit(request));
			const params = { count: 2, style: 'Slow folk, a woman sings' };
			assert.deepEqual({ checked: checked.map(entry => [entry.mode, entry.prompt, entry.params]), body: JSON.parse(server.received[0].body.toString('utf8')), answered }, {
				checked: [['lyrics', 'Tide comes in, tide goes out', params]],
				body: { model: 'song-1', mode: 'lyrics', prompt: 'Tide comes in, tide goes out', params },
				answered: { outputs: (request.targets ?? []).map(written => ({ written, size: tinyMp3().byteLength, format: 'mp3' })) }
			});
		} finally {
			await server.close();
		}
	});
});
