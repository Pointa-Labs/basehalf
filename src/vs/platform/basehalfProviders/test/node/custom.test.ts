/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { hasKey } from '../../../../base/common/types.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { customModelCatalogId, describeCustomProvider } from '../../common/basehalfCustomProviders.js';
import type { CatalogParameter, CustomProviderDefinition, Output, PollState, ProviderAccess } from '../../common/basehalfProviderTypes.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { MOCK_VIDEO_PROVIDER_KEY, startMockVideoProvider, type MockVideoProvider } from './mockVideoProvider.js';
import { error, partTargets, png, remoteIdOf, value } from './providerTestKit.js';

suite('BaseHalf providers: custom providers (D108)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const folder = mkdtempSync(join(tmpdir(), 'basehalf-custom-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

	function file(name: string, bytes: Buffer, mimeType: string) {
		const fsPath = join(folder, name);
		writeFileSync(fsPath, bytes);
		return { fsPath, mimeType };
	}

	const HARBOUR = file('harbour.png', png(64, 48), 'image/png');
	const NO_INPUTS = { images: [], videos: [], audios: [] };

	function definition(baseUrl: string, overrides: Partial<CustomProviderDefinition> = {}): CustomProviderDefinition {
		return {
			id: 'custom-0a1b2c3d',
			label: 'Harbour Relay',
			baseUrl,
			models: [{ id: 'gpt-image-1', kind: 'image' }, { id: 'Wan/Video-2.2', kind: 'video' }, { id: 'tts-1', kind: 'audio' }],
			voices: ['nova', 'harbour-voice'],
			...overrides
		};
	}

	function commands() {
		return new VideoProviderCommands(undefined, { http: { sleep: async () => undefined } });
	}

	function access(mock: MockVideoProvider, custom: CustomProviderDefinition = definition(mock.relayUrl)): ProviderAccess {
		return { provider: custom.id, region: 'custom', endpoint: custom.baseUrl, credentials: { apiKey: MOCK_VIDEO_PROVIDER_KEY }, custom };
	}

	function summary(parameter: CatalogParameter): string {
		const more = parameter.advanced ? ' (more)' : '';
		switch (parameter.kind) {
			case 'choice':
			case 'voice':
				return `${parameter.name}=${parameter.options.map(option => option.value).join('|')}:${parameter.default}${more}`;
			case 'integer':
			case 'number':
				return `${parameter.name}=${parameter.min}-${parameter.max}:${parameter.default ?? 'unset'}${more}`;
			default:
				return `${parameter.name}:${String(parameter.default)}${more}`;
		}
	}

	function writtenOf(outputs: readonly Output[]): string[] {
		return outputs.map(output => hasKey(output, { written: true }) ? `written ${output.format}` : hasKey(output, { url: true }) ? 'url' : `refused ${output.refused}`);
	}

	test('a check builds the provider from what the request carries: its models, by catalog ids made from the service ids, with the settings of their formats', async () => {
		const mock = await startMockVideoProvider();
		try {
			const providers = commands();
			const relay = access(mock);
			const checks = await Promise.all([
				providers.check({ ...relay, model: 'gpt-image-1', mode: 'reference', params: { ratio: '3:2', quality: 'high', count: 2 }, prompt: ['A pier at dawn'], inputs: NO_INPUTS }),
				providers.check({ ...relay, model: customModelCatalogId('Wan/Video-2.2'), mode: 'frames', params: { duration: 25 }, prompt: ['The tide comes in'], inputs: NO_INPUTS }),
				providers.check({ ...relay, model: 'tts-1', mode: 'reference', params: { voice: 'harbour-voice' }, prompt: ['Welcome aboard.'], inputs: NO_INPUTS }),
				providers.check({ ...relay, model: 'tts-1', mode: 'reference', params: { voice: 'alloy' }, prompt: ['Welcome aboard.'], inputs: NO_INPUTS })
			]);
			const entry = describeCustomProvider(definition(mock.relayUrl));
			assert.deepEqual({
				regions: entry.regions,
				credentials: entry.credentials,
				models: entry.models.map(model => `${model.id} ${model.kind}${model.makes ? `/${model.makes}` : ''} sends ${model.providerModels.custom}: ${model.modes.map(mode => mode.id).join(',')}; ${model.parameters.map(summary).join('; ')}`),
				checks: checks.map(check => check.ok ? check.value.problems : [`error ${check.error.message}`]),
				sent: mock.requests.length
			}, {
				regions: [{ id: 'custom', label: 'Custom', baseUrl: mock.relayUrl }],
				credentials: [{ id: 'apiKey', label: 'API Key' }],
				models: [
					'gpt-image-1 image sends gpt-image-1: reference; ratio=1:1|3:2|2:3|adaptive:adaptive; quality=auto|low|medium|high:auto; count=1-4:1',
					`${customModelCatalogId('Wan/Video-2.2')} video sends Wan/Video-2.2: frames; duration=1-20:5; resolution=480p|720p|1080p:720p; ratio=16:9|9:16|1:1|4:3|3:4:16:9; seed=0-2147483647:unset (more)`,
					'tts-1 audio/speech sends tts-1: reference; voice=nova|harbour-voice:nova; speed=0.5-2:1'
				],
				checks: [
					[],
					['Duration must be between 1 and 20 seconds.'],
					[],
					// A voice the user did not enter is not one of the provider's.
					['Voice cannot be alloy for tts-1; choose one of its voices.']
				],
				// A check sends nothing.
				sent: 0
			});
		} finally {
			await mock.close();
		}
	});

	test('an image model sends OpenAI\'s Image API: JSON without references, a multipart form of image[] files with them, and takes b64_json and url answers', async () => {
		const mock = await startMockVideoProvider();
		try {
			const providers = commands();
			const relay = access(mock);
			const fromPrompt = value(await providers.submit({ ...relay, model: 'gpt-image-1', mode: 'reference', params: { ratio: '3:2', quality: 'high', count: 2 }, prompt: ['A pier at dawn'], inputs: NO_INPUTS, targets: partTargets(2) }));
			const addresses = value(await providers.submit({ ...relay, model: 'gpt-image-1', mode: 'reference', params: {}, prompt: ['[mock:url] A gull'], inputs: NO_INPUTS, targets: partTargets(1) }));
			const edited = value(await providers.submit({ ...relay, model: 'gpt-image-1', mode: 'reference', params: { ratio: '1:1' }, prompt: [{ input: 'images', index: 0 }, ' at night'], inputs: { ...NO_INPUTS, images: [HARBOUR] }, targets: partTargets(1) }));
			assert.deepEqual({
				outputs: [fromPrompt, addresses, edited].map(answer => hasKey(answer, { outputs: true }) ? writtenOf(answer.outputs) : answer),
				requests: mock.requests.map(request => ({ model: request.model, prompt: request.prompt, parts: request.parts, body: request.body }))
			}, {
				outputs: [['written png', 'written png'], ['url'], ['written png']],
				requests: [
					{ model: 'gpt-image-1', prompt: 'A pier at dawn', parts: [], body: { model: 'gpt-image-1', prompt: 'A pier at dawn', n: 2, size: '1536x1024', quality: 'high' } },
					// Adaptive and Auto send no size and no quality.
					{ model: 'gpt-image-1', prompt: '[mock:url] A gull', parts: [], body: { model: 'gpt-image-1', prompt: '[mock:url] A gull', n: 1 } },
					{ model: 'gpt-image-1', prompt: 'Image 1 at night', parts: ['image image/png'], body: { model: 'gpt-image-1', prompt: 'Image 1 at night', n: '1', size: '1024x1024' } }
				]
			});
		} finally {
			await mock.close();
		}
	});

	test('a speech model sends OpenAI\'s speech API and keeps the MP3 it answers', async () => {
		const mock = await startMockVideoProvider();
		try {
			const providers = commands();
			const target = partTargets(1);
			const spoken = value(await providers.submit({ ...access(mock), model: 'tts-1', mode: 'reference', params: { voice: 'harbour-voice', speed: 1.25 }, prompt: ['Welcome aboard.'], inputs: NO_INPUTS, targets: target }));
			assert.deepEqual({
				outputs: hasKey(spoken, { outputs: true }) ? writtenOf(spoken.outputs) : spoken,
				// The header of an MPEG audio frame.
				starts: readFileSync(target[0]).subarray(0, 2).toString('hex'),
				request: mock.requests.map(request => [request.kind, request.voice, request.body])
			}, {
				outputs: ['written mp3'],
				starts: 'fffb',
				request: [['speech', 'harbour-voice', { model: 'tts-1', input: 'Welcome aboard.', voice: 'harbour-voice', response_format: 'mp3', speed: 1.25 }]]
			});
		} finally {
			await mock.close();
		}
	});

	test('a video model sends the relay\'s video API, with the start frame as a data URL, and follows its task through each status, the earlier names too, to its video', async () => {
		const mock = await startMockVideoProvider({ durationMs: 300 });
		try {
			const providers = commands();
			const relay = access(mock);
			const model = customModelCatalogId('Wan/Video-2.2');
			const follow = async (prompt: string, inputs: object) => {
				const remoteId = remoteIdOf(await providers.submit({ ...relay, model, mode: 'frames', params: { duration: 6, resolution: '720p', ratio: '9:16', seed: 7 }, prompt: [prompt], inputs: { ...NO_INPUTS, ...inputs } }));
				const ref = { ...relay, model, remoteId };
				const states: PollState[] = [];
				while (states.length < 200 && (!states.length || ['pending', 'running'].includes(states.at(-1)!.state))) {
					states.push(value(await providers.poll(ref)));
					await new Promise(resolve => setTimeout(resolve, 20));
				}
				const last = states.at(-1);
				const target = partTargets(1)[0];
				const downloaded = last?.state === 'succeeded' ? value(await providers.download({ ...ref, kind: 'video', videoUrl: last.videoUrl, targetFsPath: target })) : undefined;
				return { states: [...new Set(states.map(state => state.state === 'failed' ? `failed: ${state.message}` : state.state))], format: downloaded?.format };
			};
			const fromFrame = await follow('The tide comes in', { startFrame: HARBOUR });
			const legacy = await follow('[mock:legacy] Gulls over the pier', {});
			const failed = await follow('[mock:fail] A storm', {});
			assert.deepEqual({
				fromFrame,
				legacy,
				failed,
				created: mock.requests.map(request => [request.model, request.parts, request.body])
			}, {
				fromFrame: { states: ['pending', 'running', 'succeeded'], format: 'mp4' },
				legacy: { states: ['running', 'succeeded'], format: 'mp4' },
				failed: { states: ['pending', 'running', 'failed: The video could not be made: the output may contain sensitive content.'], format: undefined },
				created: [
					['Wan/Video-2.2', ['image data:image/png'], { model: 'Wan/Video-2.2', prompt: 'The tide comes in', duration: 6, width: 720, height: 1280, seed: 7, image: 'data:image/png;base64,…' }],
					['Wan/Video-2.2', [], { model: 'Wan/Video-2.2', prompt: '[mock:legacy] Gulls over the pier', duration: 6, width: 720, height: 1280, seed: 7 }],
					['Wan/Video-2.2', [], { model: 'Wan/Video-2.2', prompt: '[mock:fail] A storm', duration: 6, width: 720, height: 1280, seed: 7 }]
				]
			});
		} finally {
			await mock.close();
		}
	});

	test('a key the relay refuses is refused as credentials, and the key stays out of the message', async () => {
		const mock = await startMockVideoProvider();
		try {
			const refused = error(await commands().submit({ ...access(mock), credentials: { apiKey: 'sk-wrong-0123456789' }, model: 'gpt-image-1', mode: 'reference', params: {}, prompt: ['A pier'], inputs: NO_INPUTS, targets: partTargets(1) }));
			assert.deepEqual({ code: refused.code, message: refused.message, leaks: refused.message.includes('sk-wrong') }, { code: 'auth', message: 'Incorrect API key provided.', leaks: false });
		} finally {
			await mock.close();
		}
	});

	test('a call whose custom provider breaks a rule is refused, and nothing is sent (criterion 25)', async () => {
		const mock = await startMockVideoProvider();
		try {
			const providers = commands();
			const good = definition(mock.relayUrl);
			const broken: [string, CustomProviderDefinition, string?][] = [
				['an id that is not custom- and eight hexadecimal digits', { ...good, id: 'custom-relay' }],
				['another id than the request\'s provider', good, 'custom-ffffffff'],
				['an address of another computer over http', { ...good, baseUrl: 'http://relay.example.com/v1' }],
				['no model', { ...good, models: [] }],
				['more than 64 models', { ...good, models: Array.from({ length: 65 }, (_, index) => ({ id: `model-${index}`, kind: 'image' as const })) }],
				['a model id with a space', { ...good, models: [{ id: 'gpt image', kind: 'image' }] }],
				['the same id twice', { ...good, models: [{ id: 'gpt-image-1', kind: 'image' }, { id: 'gpt-image-1', kind: 'video' }] }],
				['a voice id that cannot be one', { ...good, voices: ['two words'] }]
			];
			const answers: Record<string, string> = {};
			for (const [why, custom, provider] of broken) {
				const refused = error(await providers.submit({ ...access(mock, custom), provider: provider ?? custom.id, model: 'gpt-image-1', mode: 'reference', params: {}, prompt: ['A pier'], inputs: NO_INPUTS, targets: partTargets(1) }));
				answers[why] = `${refused.code}: ${refused.message}`;
			}
			assert.deepEqual({ answers, sent: mock.requests.length }, {
				answers: {
					'an id that is not custom- and eight hexadecimal digits': 'rejected: The id of a custom provider must be custom- and eight hexadecimal digits. BaseHalf sent nothing.',
					'another id than the request\'s provider': 'rejected: The custom provider of the request is not custom-ffffffff. BaseHalf sent nothing.',
					'an address of another computer over http': 'rejected: Use an API address that starts with https://. An address with http:// is allowed only on this computer (localhost), because the key would travel unencrypted. BaseHalf sent nothing.',
					'no model': 'rejected: A custom provider needs at least one model. BaseHalf sent nothing.',
					'more than 64 models': 'rejected: A custom provider has at most 64 models. BaseHalf sent nothing.',
					'a model id with a space': 'rejected: The id of a model must be 1 to 256 characters without spaces. BaseHalf sent nothing.',
					'the same id twice': 'rejected: The model gpt-image-1 is listed twice. BaseHalf sent nothing.',
					'a voice id that cannot be one': 'rejected: The id of a voice must be 1 to 256 characters without spaces. BaseHalf sent nothing.'
				},
				sent: 0
			});
		} finally {
			await mock.close();
		}
	});
});
