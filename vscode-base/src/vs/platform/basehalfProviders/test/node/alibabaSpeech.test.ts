/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The speech models of the Alibaba module (docs/specs/providers/alibaba.md,
 * "Speech models"; D78) through the provider commands, against a local server
 * that answers like DashScope's speech call and its list of the account's
 * voices, and one that serves the sound as the OSS host does. Nothing here
 * talks to Alibaba Cloud.
 */

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import type { ServerResponse } from 'http';
import { ALIBABA } from '../../node/alibaba.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { buildCatalog } from '../../node/registry.js';
import type { CatalogModel, Params, VoiceParameter } from '../../common/basehalfProviderTypes.js';
import { audioRequest, error, listVoicesAgainst, partTargets, routed, sendJson, serveFiles, startServer, testAccess, tinyMp3, value, type AudioRequestOptions, type Received } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: alibaba speech', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const KEY = 'sk-ws-alibaba-local-test-1';
	const TEXT = '今天的海风很轻，我们沿着海岸慢慢走。';
	const SPEECH_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
	const VOICES_PATH = '/api/v1/services/audio/tts/customization';
	const SPEECH_MODELS = ['qwen-audio-3.1-tts-plus', 'qwen-audio-3.1-tts-flash', 'qwen-audio-3.0-tts-plus', 'qwen-audio-3.0-tts-flash'];

	function commands(): VideoProviderCommands {
		return new VideoProviderCommands([ALIBABA], { http: { sleep: async () => undefined } });
	}

	function speechRequest(endpoint: string, model: string, options: AudioRequestOptions = {}, region = 'cn') {
		return audioRequest(testAccess(ALIBABA, endpoint, { apiKey: KEY }, region), model, { prompt: TEXT, ...options });
	}

	/** DashScope's answer to a speech request: the sound's address, as the call answers it. */
	function speechAnswer(url: string, data = ''): Record<string, unknown> {
		return {
			output: { audio: { data, expires_at: 1794500000, id: 'audio_0f1e2d3c-0000-4000-8000-000000000001', url }, finish_reason: 'stop' },
			usage: { characters: 34, input_tokens: 18, output_tokens: 40, total_tokens: 58 },
			request_id: '0f1e2d3c-0000-4000-8000-000000000001'
		};
	}

	function bodiesOf(received: readonly Received[]): unknown[] {
		return received.filter(request => request.path === SPEECH_PATH).map(request => JSON.parse(request.body.toString('utf8')));
	}

	function speechModel(id: string): CatalogModel {
		const model = buildCatalog([ALIBABA]).providers[0].models.find(candidate => candidate.id === id);
		assert.ok(model, `the catalog has ${id}`);
		return model;
	}

	function voiceOf(model: CatalogModel): VoiceParameter {
		const voice = model.parameters.find((parameter): parameter is VoiceParameter => parameter.kind === 'voice');
		assert.ok(voice, `${model.id} speaks in a voice`);
		return voice;
	}

	// --- the catalog -------------------------------------------------------------------------------------

	test('the speech models follow the image models: speech in MP3, answered at once, in both regions, without inputs, under the provider\'s one key (D78, D107)', () => {
		const provider = buildCatalog([ALIBABA]).providers[0];
		const kinds = provider.models.map(model => model.kind);
		assert.deepEqual({
			label: provider.label,
			// The video models, then the image models, then the speech models.
			order: [kinds.indexOf('audio') > kinds.lastIndexOf('image'), kinds.lastIndexOf('image') > kinds.lastIndexOf('video'), kinds.slice(kinds.indexOf('audio')).every(kind => kind === 'audio')],
			credentials: provider.credentials.map(credential => credential.id),
			models: provider.models.filter(model => model.kind === 'audio').map(model => [
				model.id, model.label, model.makes, model.outputFormat, model.answersAtOnce, `${model.providerModels.cn} ${model.providerModels.intl}`,
				model.prompt.required, model.prompt.maxLength, model.modes.map(mode => `${mode.id} ${mode.label} ${mode.inputs.images.max}${mode.inputs.audios.max}${mode.inputs.videos.max} ${mode.inputs.startFrame} ${mode.inputs.source}`).join('|')
			])
		}, {
			label: 'Alibaba (Wan, Qwen)',
			order: [true, true, true],
			credentials: ['apiKey'],
			models: [
				['qwen-audio-3.1-tts-plus', 'Qwen-Audio 3.1 TTS Plus', 'speech', 'mp3', true, 'qwen-audio-3.1-tts-plus qwen-audio-3.1-tts-plus', 'always', 20000, 'reference Speech 000 none none'],
				['qwen-audio-3.1-tts-flash', 'Qwen-Audio 3.1 TTS Flash', 'speech', 'mp3', true, 'qwen-audio-3.1-tts-flash qwen-audio-3.1-tts-flash', 'always', 20000, 'reference Speech 000 none none'],
				['qwen-audio-3.0-tts-plus', 'Qwen-Audio 3.0 TTS Plus', 'speech', 'mp3', true, 'qwen-audio-3.0-tts-plus qwen-audio-3.0-tts-plus', 'always', 20000, 'reference Speech 000 none none'],
				['qwen-audio-3.0-tts-flash', 'Qwen-Audio 3.0 TTS Flash', 'speech', 'mp3', true, 'qwen-audio-3.0-tts-flash qwen-audio-3.0-tts-flash', 'always', 20000, 'reference Speech 000 none none']
			]
		});
		const flash = speechModel('qwen-audio-3.1-tts-flash');
		const languages = (model: CatalogModel) => {
			const parameter = model.parameters.find(candidate => candidate.name === 'language_hints');
			return parameter?.kind === 'choice' ? parameter.options.map(option => String(option.value)) : [];
		};
		const instruction = flash.parameters.find(parameter => parameter.name === 'instruction');
		assert.deepEqual({
			parameters: flash.parameters.map(parameter => [parameter.name, parameter.kind, parameter.default ?? null, parameter.advanced === true, parameter.optional === true]),
			numbers: flash.parameters.filter(parameter => parameter.kind === 'number' || parameter.kind === 'integer').map(parameter => parameter.kind === 'number' || parameter.kind === 'integer' ? `${parameter.name} ${parameter.min}-${parameter.max} by ${parameter.step}` : ''),
			instruction: instruction?.kind === 'text' ? instruction.maxLength : undefined,
			flashLanguages: languages(flash),
			// "other" is a language of 3.1 TTS Flash alone.
			plusLanguages: languages(speechModel('qwen-audio-3.1-tts-plus')).includes('other'),
			sameSettings: SPEECH_MODELS.map(id => speechModel(id).parameters.map(parameter => parameter.name).join(' '))
		}, {
			parameters: [
				['voice', 'voice', 'longanhuan_v3.1', false, false],
				['speed', 'number', 1, false, false],
				['instruction', 'text', null, false, true],
				['pitch', 'number', 1, true, false],
				['volume', 'integer', 50, true, false],
				['language_hints', 'choice', 'auto', true, false],
				['watermark', 'boolean', false, true, false],
				['seed', 'integer', null, true, true]
			],
			numbers: ['speed 0.5-2 by 0.05', 'pitch 0.5-2 by 0.05', 'volume 0-100 by 1', 'seed 0-65535 by 1'],
			instruction: 1000,
			flashLanguages: ['auto', 'zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru', 'pt', 'th', 'id', 'vi', 'es', 'it', 'ms', 'fil', 'ar', 'other'],
			plusLanguages: false,
			sameSettings: SPEECH_MODELS.map(() => 'voice speed instruction pitch volume language_hints watermark seed')
		});
	});

	test('each model speaks in the voices of the list, its default first; 69 of 3.1 TTS Flash\'s are China (Beijing)\'s alone, and the account\'s voices are listed', () => {
		const voices = SPEECH_MODELS.map(id => voiceOf(speechModel(id)));
		const flash = voices[1];
		const ids = (parameter: VoiceParameter) => parameter.options.map(option => option.value);
		const chinaOnly = flash.options.filter(option => option.regions !== undefined);
		assert.deepEqual({
			counts: voices.map(parameter => parameter.options.length),
			defaults: voices.map(parameter => `${parameter.default} ${parameter.options[0].value}`),
			listed: voices.map(parameter => parameter.listed),
			plus: ids(voices[0]),
			flashFirst: ids(flash).slice(0, 4),
			chinaOnly: [chinaOnly.length, [...new Set(chinaOnly.map(option => option.regions?.join(' ')))], chinaOnly[0].value, chinaOnly[chinaOnly.length - 1].value],
			// Both regions offer the flagship, premium English, and other-language voices.
			everywhere: flash.options.filter(option => option.regions === undefined).length,
			otherLanguages: ids(flash).filter(id => id.startsWith('qwen-audio-3.1-tts-flash-')).length,
			english: ids(flash).filter(id => /^[A-Z][a-z]+_v3\.1$/.test(id)).length,
			unique: voices.map(parameter => new Set(ids(parameter)).size === parameter.options.length),
			described: voices.every(parameter => parameter.options.every(option => option.label.trim() && option.description?.trim())),
			// A sweet premium Chinese voice of China (Beijing), which 3.1 TTS Flash offers there.
			feifei: flash.options.find(option => option.value === 'longfeifei_v3.1'),
			plusDefault: voices[2].options.map(option => option.value),
			flash30: ids(voices[3])
		}, {
			counts: [4, 139, 2, 12],
			defaults: ['longanhuan_v3.1 longanhuan_v3.1', 'longanhuan_v3.1 longanhuan_v3.1', 'longanlingxin longanlingxin', 'longanhuan_v3.6 longanhuan_v3.6'],
			listed: [true, true, true, true],
			plus: ['longanhuan_v3.1', 'longanlingxin_v3.1', 'xunanchuan_v3.1', 'longanfengyue_v3.1'],
			flashFirst: ['longanhuan_v3.1', 'longanlingxin_v3.1', 'xunanchuan_v3.1', 'longanfengyue_v3.1'],
			chinaOnly: [69, ['cn'], 'yuxiaoyun_v3.1', 'longanchong_v3.1'],
			everywhere: 70,
			otherLanguages: 51,
			english: 15,
			unique: [true, true, true, true],
			described: true,
			feifei: { value: 'longfeifei_v3.1', label: 'Long Feifei', description: 'Female · Sweet · Mandarin', regions: ['cn'] },
			plusDefault: ['longanlingxin', 'longanlufeng'],
			flash30: ['longanhuan_v3.6', 'longanfengyue', 'longanyuanfei', 'longanlingxi', 'longanxiaoxin', 'longjielidou_v3.6', 'longpaopao_v3.6', 'longhuohuo_v3.6', 'longchuanshu_v3.6', 'loongmary', 'loongeva_v3.6', 'loongjohn']
		});
	});

	// --- requests ----------------------------------------------------------------------------------------

	test('a speech request is sent once with the key and the exact body: the text, the voice, MP3 at 24 kHz, the settings under Alibaba\'s names, and only those that are set', async () => {
		const files = await startServer(routed(serveFiles({ '/prod/speech.mp3': tinyMp3() })));
		const api = await startServer((request, response) => sendJson(response, 200, speechAnswer(`${files.url}/prod/speech.mp3?Expires=1794500000&OSSAccessKeyId=LTAI-local-test&Signature=abc%3D`)));
		try {
			const providers = commands();
			const defaults = { format: 'mp3', sample_rate: 24000, rate: 1, pitch: 1, volume: 50, enable_aigc_tag: false };
			const cases: readonly { readonly model: string; readonly region: string; readonly params: Params; readonly input: Record<string, unknown> }[] = [
				{ model: 'qwen-audio-3.1-tts-flash', region: 'cn', params: {}, input: { text: TEXT, voice: 'longanhuan_v3.1', ...defaults } },
				{
					model: 'qwen-audio-3.1-tts-flash',
					region: 'cn',
					params: { voice: 'yuxiaoyun_v3.1', speed: 1.25, pitch: 0.9, volume: 60, instruction: '请用温柔的语气说。', language_hints: 'zh', watermark: true, seed: 7 },
					input: { text: TEXT, voice: 'yuxiaoyun_v3.1', format: 'mp3', sample_rate: 24000, rate: 1.25, pitch: 0.9, volume: 60, enable_aigc_tag: true, instruction: '请用温柔的语气说。', language_hints: ['zh'], seed: 7 }
				},
				// A blank instruction and Auto send nothing; seed 0 is sent.
				{ model: 'qwen-audio-3.1-tts-plus', region: 'intl', params: { instruction: '   ', language_hints: 'auto', seed: 0 }, input: { text: TEXT, voice: 'longanhuan_v3.1', ...defaults, seed: 0 } },
				{ model: 'qwen-audio-3.0-tts-plus', region: 'cn', params: { language_hints: 'en' }, input: { text: TEXT, voice: 'longanlingxin', ...defaults, language_hints: ['en'] } },
				{ model: 'qwen-audio-3.0-tts-flash', region: 'intl', params: { voice: 'loongmary', speed: 0.5 }, input: { text: TEXT, voice: 'loongmary', ...defaults, rate: 0.5 } }
			];
			const answers = [];
			for (const entry of cases) {
				answers.push(value(await providers.submit(speechRequest(api.url, entry.model, { params: entry.params }, entry.region))));
			}
			const address = `${files.url}/prod/speech.mp3?Expires=1794500000&OSSAccessKeyId=LTAI-local-test&Signature=abc%3D`;
			const target = partTargets(1)[0];
			const downloaded = value(await providers.download({ ...testAccess(ALIBABA, api.url, { apiKey: KEY }), model: 'qwen-audio-3.1-tts-flash', kind: 'audio', url: address, targetFsPath: target }));
			assert.deepEqual({
				bodies: bodiesOf(api.received),
				sent: api.received.map(request => `${request.method} ${request.path} ${request.headers.authorization} ${request.headers['content-type']} ${request.headers['x-dashscope-async'] ?? '-'} ${request.headers['x-dashscope-sse'] ?? '-'}`),
				answers,
				downloaded,
				same: readFileSync(target).equals(tinyMp3()),
				keyToFiles: files.received.map(request => request.headers.authorization ?? 'none')
			}, {
				bodies: cases.map(entry => ({ model: entry.model, input: entry.input })),
				sent: cases.map(() => `POST ${SPEECH_PATH} Bearer ${KEY} application/json - -`),
				answers: cases.map(() => ({ outputs: [{ url: address }] })),
				downloaded: { size: tinyMp3().byteLength, format: 'mp3' },
				same: true,
				keyToFiles: ['none']
			});
		} finally {
			await api.close();
			await files.close();
		}
	});

	test('an http address of aliyuncs.com is taken over https, other addresses as they are, and a sound answered inline lands as the file; an answer without a sound is a refusal or unknown', async () => {
		let answer: Record<string, unknown> = {};
		const api = await startServer((request, response) => sendJson(response, 200, answer));
		try {
			const providers = commands();
			const submit = async () => {
				const submitted = await providers.submit(speechRequest(api.url, 'qwen-audio-3.1-tts-flash'));
				return submitted.ok ? submitted.value : submitted.error;
			};
			// The form of the address DashScope answers, with made-up values.
			const oss = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/prod/qwen-audio-3.1-tts-flash/20261111/1000000000000001/0f1e2d3c.mp3?Expires=1794500000&OSSAccessKeyId=LTAI-local-test&Signature=bG9jYWwtc2lnbmF0dXJl%3D';
			answer = speechAnswer(oss);
			const fromOss = await submit();
			answer = speechAnswer('https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/a.mp3?Signature=x');
			const secure = await submit();
			answer = speechAnswer('http://relay.example.com/a.mp3');
			const elsewhere = await submit();
			answer = speechAnswer('', tinyMp3().toString('base64'));
			const request = speechRequest(api.url, 'qwen-audio-3.1-tts-flash');
			const [target] = request.targets ?? [];
			const inline = value(await providers.submit(request));
			answer = { code: 'DataInspectionFailed', message: 'Input data may contain inappropriate content.', request_id: 'r' };
			const refusal = await submit();
			answer = { output: { finish_reason: 'stop' }, request_id: 'r' };
			const nothing = await submit();
			assert.deepEqual({ fromOss, secure, elsewhere, inline, same: readFileSync(target).equals(tinyMp3()), refusal, nothing, sent: api.received.length }, {
				fromOss: { outputs: [{ url: `https://${oss.slice('http://'.length)}` }] },
				secure: { outputs: [{ url: 'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/a.mp3?Signature=x' }] },
				// Not an address BaseHalf downloads from: refused on its own.
				elsewhere: { outputs: [{ refused: 'The provider gave a sound address that does not start with https://.' }] },
				inline: { outputs: [{ written: target, size: tinyMp3().byteLength, format: 'mp3' }] },
				same: true,
				refusal: { code: 'rejected', message: 'Input data may contain inappropriate content. (DataInspectionFailed)' },
				nothing: { code: 'unknownOutcome', message: 'Alibaba Cloud accepted the request but answered no sound BaseHalf can read.' },
				sent: 6
			});
		} finally {
			await api.close();
		}
	});

	test('a voice the model does not have says to choose another; keys, limits, balance, content, an unknown model, and a lost answer are told apart, each request sent once', async () => {
		let respond: (response: ServerResponse) => void = response => sendJson(response, 200, {});
		const api = await startServer((request, response, socket) => {
			if (request.path.startsWith('/drop/')) {
				socket.destroy();
				return;
			}
			respond(response);
		});
		try {
			const providers = commands();
			const create = async (answer: (response: ServerResponse) => void, endpoint = api.url, params: Params = { voice: 'Emily_v3.1' }) => {
				respond = answer;
				return error(await providers.submit(speechRequest(endpoint, 'qwen-audio-3.1-tts-plus', { params })));
			};
			const refusal = (status: number, code: string, message: string, headers: Record<string, string> = {}) => (response: ServerResponse) => sendJson(response, status, { request_id: 'r', code, message }, headers);
			const outcomes = {
				voice: await create(refusal(400, 'InvalidParameter', '[cosyvoice:]Engine error [411]: TTS speak operation failed')),
				rate: await create(refusal(400, 'InvalidParameter', '[cosyvoice:]Engine error [421]: Invalid volume parameter')),
				text: await create(refusal(400, 'InvalidParameter', 'Please ensure input text is valid.')),
				key: await create(refusal(401, 'InvalidApiKey', 'Invalid API-key provided.')),
				limited: await create(refusal(429, 'Throttling.RateQuota', 'Requests rate limit exceeded, please try again later.', { 'Retry-After': '3' })),
				balance: await create(refusal(400, 'Arrearage', 'Access denied, please make sure your account is in good standing.')),
				content: await create(refusal(400, 'DataInspectionFailed', 'Input data may contain inappropriate content.')),
				model: await create(refusal(400, 'InvalidParameter', 'Model not exist.')),
				dropped: (await create(() => undefined, `${api.url}/drop`)).code
			};
			const limit = 'Alibaba Cloud takes at most 180 requests a minute for Qwen-Audio 3.1 TTS Plus.';
			assert.deepEqual({ outcomes, sent: api.received.length }, {
				outcomes: {
					voice: { code: 'rejected', message: 'Qwen-Audio 3.1 TTS Plus does not speak in the voice "Emily_v3.1": choose another voice. Alibaba Cloud says: [cosyvoice:]Engine error [411]: TTS speak operation failed (InvalidParameter)', status: 400 },
					rate: { code: 'rejected', message: '[cosyvoice:]Engine error [421]: Invalid volume parameter (InvalidParameter)', status: 400 },
					text: { code: 'rejected', message: 'Please ensure input text is valid. (InvalidParameter)', status: 400 },
					// At an endpoint of its own, the words of any refusal; the window says that the credentials were refused (D94).
					key: { code: 'auth', message: 'Invalid API-key provided. (InvalidApiKey)', status: 401 },
					limited: { code: 'rateLimited', message: `Requests rate limit exceeded, please try again later. (Throttling.RateQuota) ${limit} The provider asks to wait 3 seconds.`, status: 429 },
					balance: { code: 'balance', message: 'Access denied, please make sure your account is in good standing. (Arrearage)', status: 400 },
					content: { code: 'rejected', message: 'Input data may contain inappropriate content. (DataInspectionFailed)', status: 400 },
					model: { code: 'rejected', message: 'Model not exist. (InvalidParameter) A model released after September 30, 2026 may be offered only on the host of your workspace: enter its API host, from the Model Studio console, as the Endpoint in Providers.', status: 400 },
					dropped: 'unknownOutcome'
				},
				// Each request was sent once, never again.
				sent: 9
			});
		} finally {
			await api.close();
		}
	});

	// --- check -------------------------------------------------------------------------------------------

	test('check counts a Chinese character as two against 20,000, refuses a voice of China (Beijing) alone in International, and a request it refuses is not sent', async () => {
		const api = await startServer((request, response) => sendJson(response, 200, speechAnswer('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.mp3')));
		try {
			const providers = commands();
			const problems = async (prompt: string, params: Params = {}, region = 'cn', model = 'qwen-audio-3.1-tts-flash') => value(await providers.check(speechRequest('https://dashscope.aliyuncs.com', model, { prompt, params }, region))).problems;
			const checked = value(await providers.check(speechRequest('https://dashscope.aliyuncs.com', 'qwen-audio-3.0-tts-flash', {}, 'intl')));
			assert.deepEqual({
				ascii: await problems('a'.repeat(20000)),
				chinese: await problems('海'.repeat(10000)),
				chineseOver: await problems(`${'海'.repeat(10000)}。`),
				over: await problems('a'.repeat(20001)),
				empty: await problems(''),
				beijingVoiceInChina: await problems(TEXT, { voice: 'yuxiaoyun_v3.1' }),
				beijingVoiceElsewhere: await problems(TEXT, { voice: 'yuxiaoyun_v3.1' }, 'intl'),
				englishVoiceElsewhere: await problems(TEXT, { voice: 'Emily_v3.1' }, 'intl'),
				// A voice of the account is any id: the provider says whether it knows it.
				accountVoice: await problems(TEXT, { voice: 'qwen-audio-3.1-tts-flash-myvoice-a1b2c3' }, 'intl'),
				outOfRange: (await problems(TEXT, { speed: 2.5, volume: 101, seed: 65536 })).length,
				providerModel: checked.providerModel
			}, {
				ascii: [],
				chinese: [],
				chineseOver: ['The text is too long for Qwen-Audio 3.1 TTS Flash: it takes 20000 characters, a Chinese character counting as two, and this one counts 20001.'],
				over: ['The prompt is 20001 characters long; Qwen-Audio 3.1 TTS Flash takes at most 20000.'],
				empty: ['Write a prompt: Qwen-Audio 3.1 TTS Flash needs one.'],
				beijingVoiceInChina: [],
				beijingVoiceElsewhere: ['Qwen-Audio 3.1 TTS Flash offers the voice Yu Xiaoyun only in China (Beijing). Choose another voice, or another region in Providers.'],
				englishVoiceElsewhere: [],
				accountVoice: [],
				// Each setting beyond its range is a problem.
				outOfRange: 3,
				providerModel: 'qwen-audio-3.0-tts-flash'
			});
			const refused = await providers.submit(speechRequest(api.url, 'qwen-audio-3.1-tts-flash', { params: { voice: 'yuxiaoyun_v3.1' } }, 'intl'));
			const tooLong = await providers.submit(speechRequest(api.url, 'qwen-audio-3.1-tts-flash', { prompt: '海'.repeat(10001) }));
			assert.deepEqual({ refused: error(refused).code, tooLong: error(tooLong).code, sent: api.received.length }, { refused: 'rejected', tooLong: 'rejected', sent: 0 });
		} finally {
			await api.close();
		}
	});

	test('a note in the prompt is spoken as its text, and the prompt is sent as the window wrote it', async () => {
		const api = await startServer((request, response) => sendJson(response, 200, speechAnswer('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.mp3')));
		try {
			const providers = commands();
			// The window has written a connected note's plain text into the prompt already (generation cards, "Inputs").
			const prompt = ['Welcome to the coast.', '\n\n', 'The tide comes in at six.'];
			const checked = value(await providers.check(speechRequest('https://dashscope.aliyuncs.com', 'qwen-audio-3.1-tts-flash', { prompt })));
			value(await providers.submit(speechRequest(api.url, 'qwen-audio-3.1-tts-flash', { prompt })));
			assert.deepEqual({ checked: checked.prompt, sent: (bodiesOf(api.received)[0] as { input: { text: string } }).input.text }, {
				checked: 'Welcome to the coast.\n\nThe tide comes in at six.',
				sent: 'Welcome to the coast.\n\nThe tide comes in at six.'
			});
		} finally {
			await api.close();
		}
	});

	// --- voices ------------------------------------------------------------------------------------------

	test('voices lists the account\'s ready voices of the model, page after page, by the name the user gave them, and leaves out the others', async () => {
		const entry = (voice_id: string, status = 'OK', gmt_create = '2026-11-11 13:38:02') => ({ voice_id, gmt_create, gmt_modified: gmt_create, status });
		const pages: readonly (readonly ReturnType<typeof entry>[])[] = [
			[
				entry('qwen-audio-3.1-tts-flash-narrator-a1b2c3d4'),
				entry('qwen-audio-3.1-tts-flash-review-e5f6', 'DEPLOYING'),
				entry('qwen-audio-3.1-tts-flash-refused-0000', 'UNDEPLOYED'),
				entry('qwen-audio-3.0-tts-flash-myvoice-1234'),
				entry('cosyvoice-v3-flash-old-5678'),
				...Array.from({ length: 95 }, (_, index) => entry(`qwen-audio-3.1-tts-plus-other${index}-x`))
			],
			[entry('qwen-audio-3.1-tts-flash-coast-9999', 'OK', '2026-10-01 08:00:00'), entry('qwen-audio-3.1-tts-flash-oddname')]
		];
		const handler = routed((request, response) => {
			if (request.method !== 'POST' || request.path !== VOICES_PATH) {
				return false;
			}
			const body = JSON.parse(request.body.toString('utf8'));
			const page = pages[body.input.page_index] ?? [];
			sendJson(response, 200, { output: { page_index: body.input.page_index, page_size: body.input.page_size, total_count: 102, voice_list: page }, usage: { count: 1 }, request_id: 'r' });
			return true;
		});
		const listed = await listVoicesAgainst(ALIBABA, 'qwen-audio-3.1-tts-flash', { apiKey: KEY }, handler);
		const plus = await listVoicesAgainst(ALIBABA, 'qwen-audio-3.1-tts-plus', { apiKey: KEY }, handler, 'intl');
		assert.deepEqual({
			voices: value(listed.answer),
			bodies: listed.received.map(request => JSON.parse(request.body.toString('utf8'))),
			sent: listed.received.map(request => `${request.method} ${request.path} ${request.headers.authorization}`),
			plus: value(plus.answer).voices.length
		}, {
			voices: {
				voices: [
					{ id: 'qwen-audio-3.1-tts-flash-narrator-a1b2c3d4', label: 'narrator', description: 'Made on 2026-11-11', own: true },
					{ id: 'qwen-audio-3.1-tts-flash-coast-9999', label: 'coast', description: 'Made on 2026-10-01', own: true },
					// No prefix to name it by: its id names it.
					{ id: 'qwen-audio-3.1-tts-flash-oddname', label: 'qwen-audio-3.1-tts-flash-oddname', description: 'Made on 2026-11-11', own: true }
				]
			},
			bodies: [0, 1].map(page => ({ model: 'voice-enrollment', input: { action: 'list_voice', page_index: page, page_size: 100 } })),
			sent: [0, 1].map(() => `POST ${VOICES_PATH} Bearer ${KEY}`),
			plus: 95
		});
	});

	test('voices ends at an empty page, stops with truncated after the pages an account can fill, and refuses an answer it cannot read', async () => {
		const full = (pageIndex: number) => Array.from({ length: 100 }, (_, index) => ({ voice_id: `qwen-audio-3.0-tts-plus-v${pageIndex}x${index}-abc`, status: 'OK', gmt_create: '2026-11-11 00:00:00' }));
		const answering = (answer: (page: number) => unknown) => routed((request, response) => {
			const body = JSON.parse(request.body.toString('utf8'));
			sendJson(response, 200, answer(body.input.page_index));
			return true;
		});
		// No total: a short or empty page ends the list.
		const empty = await listVoicesAgainst(ALIBABA, 'qwen-audio-3.0-tts-plus', { apiKey: KEY }, answering(page => ({ output: { voice_list: page === 0 ? full(0) : [] } })));
		// A provider that always says it has more is asked no more than an account can fill.
		const endless = await listVoicesAgainst(ALIBABA, 'qwen-audio-3.0-tts-plus', { apiKey: KEY }, answering(page => ({ output: { total_count: 1_000_000, voice_list: full(page) } })));
		const unreadable = await listVoicesAgainst(ALIBABA, 'qwen-audio-3.0-tts-plus', { apiKey: KEY }, answering(() => ({ output: { voices: [] } })));
		const refused = await listVoicesAgainst(ALIBABA, 'qwen-audio-3.0-tts-plus', { apiKey: KEY }, routed((request, response) => {
			sendJson(response, 401, { code: 'InvalidApiKey', message: 'Invalid API-key provided.', request_id: 'r' });
			return true;
		}));
		const limited = await listVoicesAgainst(ALIBABA, 'qwen-audio-3.0-tts-plus', { apiKey: KEY }, routed((request, response) => {
			sendJson(response, 429, { code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded, please try again later.', request_id: 'r' });
			return true;
		}));
		assert.deepEqual({
			empty: [value(empty.answer).voices.length, value(empty.answer).truncated, empty.received.length],
			endless: [value(endless.answer).voices.length, value(endless.answer).truncated, endless.received.length],
			unreadable: error(unreadable.answer),
			refused: error(refused.answer).code,
			// Asked again as a poll is, and then refused without the limit of the video models, which is not the list's.
			limited: [error(limited.answer).code, error(limited.answer).message.includes('video'), limited.received.length]
		}, {
			empty: [100, undefined, 2],
			endless: [1100, true, 11],
			unreadable: { code: 'invalidResponse', message: 'Alibaba Cloud answered voices BaseHalf cannot read.' },
			refused: 'auth',
			limited: ['rateLimited', false, 4]
		});
	});
});
