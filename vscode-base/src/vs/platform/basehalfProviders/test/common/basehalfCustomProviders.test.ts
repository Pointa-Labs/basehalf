/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { customModelCatalogId, customProviderAddressProblem, customVideoSize, describeCustomProvider, parseCustomProviderDefinition } from '../../common/basehalfCustomProviders.js';

suite('BaseHalf custom providers (D108)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const GOOD = {
		id: 'custom-0a1b2c3d',
		label: '  Harbour Relay ',
		baseUrl: 'https://relay.example.com/v1',
		models: [{ id: 'gpt-image-1', kind: 'image' }, { id: 'tts-1', kind: 'audio' }],
		voices: ['nova', 'nova', 'harbour-voice']
	};

	function refusal(value: unknown): string {
		try {
			parseCustomProviderDefinition(value);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		return 'taken';
	}

	test('reads what the user entered: the name trimmed, each voice once, the address as it is', () => {
		assert.deepStrictEqual(parseCustomProviderDefinition(GOOD), {
			id: 'custom-0a1b2c3d',
			label: 'Harbour Relay',
			baseUrl: 'https://relay.example.com/v1',
			models: [{ id: 'gpt-image-1', kind: 'image' }, { id: 'tts-1', kind: 'audio' }],
			voices: ['nova', 'harbour-voice']
		});
	});

	test('refuses what breaks a rule, naming the rule', () => {
		assert.deepStrictEqual({
			notAnObject: refusal('custom-0a1b2c3d'),
			id: refusal({ ...GOOD, id: 'custom-relay' }),
			emptyName: refusal({ ...GOOD, label: '   ' }),
			longName: refusal({ ...GOOD, label: 'x'.repeat(65) }),
			address: refusal({ ...GOOD, baseUrl: 'http://relay.example.com/v1' }),
			localAddress: refusal({ ...GOOD, baseUrl: 'http://127.0.0.1:8123/relay/v1' }),
			slash: refusal({ ...GOOD, baseUrl: 'https://relay.example.com/v1/' }),
			noModel: refusal({ ...GOOD, models: [] }),
			manyModels: refusal({ ...GOOD, models: Array.from({ length: 65 }, (_, index) => ({ id: `m${index}`, kind: 'image' })) }),
			space: refusal({ ...GOOD, models: [{ id: 'gpt image', kind: 'image' }] }),
			longId: refusal({ ...GOOD, models: [{ id: 'x'.repeat(257), kind: 'image' }] }),
			kind: refusal({ ...GOOD, models: [{ id: 'suno', kind: 'music' }] }),
			twice: refusal({ ...GOOD, models: [{ id: 'tts-1', kind: 'audio' }, { id: 'tts-1', kind: 'image' }] }),
			manyVoices: refusal({ ...GOOD, voices: Array.from({ length: 65 }, (_, index) => `voice-${index}`) }),
			voice: refusal({ ...GOOD, voices: ['two words'] })
		}, {
			notAnObject: 'A custom provider must be an object.',
			id: 'The id of a custom provider must be custom- and eight hexadecimal digits.',
			emptyName: 'The name of a custom provider must be 1 to 64 characters of plain text.',
			longName: 'The name of a custom provider must be 1 to 64 characters of plain text.',
			address: 'Use an API address that starts with https://. An address with http:// is allowed only on this computer (localhost), because the key would travel unencrypted.',
			// A service on this computer, such as a local server, is reached over http.
			localAddress: 'taken',
			slash: 'The API address must not end with a slash.',
			noModel: 'A custom provider needs at least one model.',
			manyModels: 'A custom provider has at most 64 models.',
			space: 'The id of a model must be 1 to 256 characters without spaces.',
			longId: 'The id of a model must be 1 to 256 characters without spaces.',
			kind: 'The card type of suno must be image, video, or audio.',
			twice: 'The model tts-1 is listed twice.',
			manyVoices: 'A custom provider has at most 64 voices.',
			voice: 'The id of a voice must be 1 to 256 characters without spaces.'
		});
	});

	test('the catalog id of a model is its service id where the catalog takes it, and otherwise a form of it with a hash, the same each time (criterion 26)', () => {
		const ids = ['gpt-image-1', 'GPT-Image-1', 'Wan/Video-2.2', 'wan-video-2.2', '-dash', `${'long-'.repeat(20)}model`];
		const made = ids.map(customModelCatalogId);
		assert.deepStrictEqual({
			made: made.map(id => id.replace(/-[0-9a-f]{6}$/, '-<hash>')),
			again: ids.map(customModelCatalogId),
			distinct: new Set(made).size,
			valid: made.every(id => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))
		}, {
			made: ['gpt-image-1', 'gpt-image-1-<hash>', 'wan-video-2.2-<hash>', 'wan-video-2.2', 'm-dash-<hash>', `${'long-'.repeat(11)}l-<hash>`],
			again: made,
			distinct: ids.length,
			valid: true
		});
	});

	test('a video\'s width and height: the short side is the resolution, the long side that times the ratio, even', () => {
		assert.deepStrictEqual([
			customVideoSize('720p', '16:9'),
			customVideoSize('720p', '9:16'),
			customVideoSize('720p', '1:1'),
			customVideoSize('480p', '16:9'),
			customVideoSize('1080p', '4:3'),
			customVideoSize('1080p', '3:4'),
			customVideoSize('4k', '16:9'),
			customVideoSize('720p', 'wide')
		], [
			{ width: 1280, height: 720 },
			{ width: 720, height: 1280 },
			{ width: 720, height: 720 },
			{ width: 854, height: 480 },
			{ width: 1440, height: 1080 },
			{ width: 1080, height: 1440 },
			undefined,
			undefined
		]);
	});

	test('an address is one by the rules of an endpoint', () => {
		assert.deepStrictEqual(['https://relay.example.com/v1', 'http://localhost:3000/v1', 'https://user:pass@relay.example.com/v1', 'https://relay.example.com/v1?key=1', 'relay.example.com/v1'].map(customProviderAddressProblem), [
			undefined,
			undefined,
			'The API address must have no user name, password, query, or fragment.',
			'The API address must have no user name, password, query, or fragment.',
			'The API address is not a complete address.'
		]);
	});

	test('a speech model speaks in the voices the user entered, or in the six of OpenAI\'s speech API', () => {
		const voices = (definition: unknown) => describeCustomProvider(parseCustomProviderDefinition(definition)).models.flatMap(model => model.parameters.filter(parameter => parameter.kind === 'voice').map(parameter => parameter.kind === 'voice' ? `${parameter.options.map(option => option.value).join(',')} (${parameter.default})` : ''));
		assert.deepStrictEqual({ entered: voices(GOOD), none: voices({ ...GOOD, voices: undefined }) }, {
			entered: ['nova,harbour-voice (nova)'],
			none: ['alloy,echo,fable,onyx,nova,shimmer (alloy)']
		});
	});
});
