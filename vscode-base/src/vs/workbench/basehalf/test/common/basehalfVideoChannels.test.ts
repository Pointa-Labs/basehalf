/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfVideoChannelError,
	baseHalfVideoChannelDefaultName,
	baseHalfVideoChannelKeyAddress,
	createBaseHalfVideoChannelId,
	isBaseHalfLoopbackHost,
	normalizeBaseHalfVideoChannelEndpoint,
	normalizeBaseHalfVideoChannelKey,
	normalizeBaseHalfVideoChannelModels,
	normalizeBaseHalfVideoChannelName,
	parseBaseHalfVideoChannels,
	serializeBaseHalfVideoChannels
} from '../../common/basehalfVideoChannels.js';
import { IBaseHalfVideoChannel } from '../../common/basehalfVideoGeneration.js';

suite('BaseHalfVideoChannels', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('names a channel by its preset and four characters, and its key by an address the main process admits', () => {
		const sequence = [0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
		let index = 0;
		const random = () => sequence[index++ % sequence.length];
		const first = createBaseHalfVideoChannelId('ark', new Set(), random);
		const second = createBaseHalfVideoChannelId('ark', new Set([first]), random);
		assert.deepStrictEqual([first, second], ['ark-dhko', 'ark-svz2']);

		// The renderer may read and write only credential addresses that
		// storageIpc.ts admits; the channel key must be one of them.
		const admitted = /^secret:\/\/basehalf\.modelServices\.[a-z][a-z0-9.-]{0,63}\.apiKey$/;
		for (const provider of ['ark', 'byteplus', 'dashscope', 'minimax', 'gemini', 'openai'] as const) {
			const address = baseHalfVideoChannelKeyAddress(createBaseHalfVideoChannelId(provider, new Set()));
			assert.ok(admitted.test(`secret://${address}`), address);
		}
		assert.throws(() => baseHalfVideoChannelKeyAddress('../other'), BaseHalfVideoChannelError);
	});

	test('numbers a name that another channel has', () => {
		assert.deepStrictEqual([
			baseHalfVideoChannelDefaultName('Volcengine Ark', []),
			baseHalfVideoChannelDefaultName('Volcengine Ark', ['Volcengine Ark']),
			baseHalfVideoChannelDefaultName('Volcengine Ark', ['volcengine ark', 'Volcengine Ark 2'])
		], ['Volcengine Ark', 'Volcengine Ark 2', 'Volcengine Ark 3']);
	});

	test('takes https endpoints anywhere and http only on this computer', () => {
		assert.deepStrictEqual([
			normalizeBaseHalfVideoChannelEndpoint(' https://ark.cn-beijing.volces.com/api/v3/ '),
			normalizeBaseHalfVideoChannelEndpoint('https://relay.example.com'),
			normalizeBaseHalfVideoChannelEndpoint('http://127.0.0.1:8123/api/v3'),
			normalizeBaseHalfVideoChannelEndpoint('http://localhost:9000/v1'),
			normalizeBaseHalfVideoChannelEndpoint('http://[::1]:9000/v1')
		], [
			'https://ark.cn-beijing.volces.com/api/v3',
			'https://relay.example.com',
			'http://127.0.0.1:8123/api/v3',
			'http://localhost:9000/v1',
			'http://[::1]:9000/v1'
		]);
		for (const invalid of ['', 'ark.cn-beijing.volces.com', 'ftp://example.com', 'http://192.168.1.5/v1', 'https://user:pass@example.com', 'https://example.com/v1?key=1', 'https://example.com/v1#x', 'https://exa mple.com']) {
			assert.throws(() => normalizeBaseHalfVideoChannelEndpoint(invalid), BaseHalfVideoChannelError, invalid);
		}
		assert.deepStrictEqual(['localhost', '127.0.0.2', '[::1]', 'example.com', '10.0.0.1'].map(isBaseHalfLoopbackHost), [true, true, true, false, false]);
	});

	test('keeps model ids in the order given, each once', () => {
		assert.deepStrictEqual(normalizeBaseHalfVideoChannelModels([' doubao-seedance-2-5-260628 ', 'my relay model', 'doubao-seedance-2-5-260628']), ['doubao-seedance-2-5-260628', 'my relay model']);
		assert.throws(() => normalizeBaseHalfVideoChannelModels(['']), BaseHalfVideoChannelError);
		assert.throws(() => normalizeBaseHalfVideoChannelModels(['a\nb']), BaseHalfVideoChannelError);
		assert.throws(() => normalizeBaseHalfVideoChannelModels(['x'.repeat(257)]), BaseHalfVideoChannelError);
		assert.throws(() => normalizeBaseHalfVideoChannelName('  '), BaseHalfVideoChannelError);
		assert.strictEqual(normalizeBaseHalfVideoChannelName(' My Relay '), 'My Relay');
	});

	test('takes a key of visible characters only', () => {
		assert.strictEqual(normalizeBaseHalfVideoChannelKey('  sk-abc123_XYZ.=  '), 'sk-abc123_XYZ.=');
		for (const invalid of ['', 'two words', 'line\nbreak', 'ключ']) {
			assert.throws(() => normalizeBaseHalfVideoChannelKey(invalid), BaseHalfVideoChannelError, invalid);
		}
	});

	test('reads stored channels and leaves out entries that are not valid', () => {
		const channels: IBaseHalfVideoChannel[] = [
			{ id: 'ark-3f2a', provider: 'ark', name: 'Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seedance-2-5-260628'], hasKey: true },
			{ id: 'openai-x1y2', provider: 'openai', name: 'Relay', baseUrl: 'http://127.0.0.1:8123/v1', models: [], hasKey: false }
		];
		const raw = serializeBaseHalfVideoChannels(channels);
		assert.deepStrictEqual(parseBaseHalfVideoChannels(raw), channels);
		const tampered = JSON.parse(raw);
		tampered.channels.push(
			{ ...tampered.channels[0], id: 'ark-zzzz', baseUrl: 'http://evil.example.com' },
			{ ...tampered.channels[0], id: 'minimax-zzzz' },
			{ ...tampered.channels[0], id: 'ark-yyyy', apiKey: 'leaked' }
		);
		assert.deepStrictEqual(parseBaseHalfVideoChannels(JSON.stringify(tampered)).map(channel => channel.id), ['ark-3f2a', 'openai-x1y2', 'ark-yyyy']);
		assert.strictEqual(JSON.stringify(parseBaseHalfVideoChannels(JSON.stringify(tampered))).includes('leaked'), false);
		assert.deepStrictEqual([parseBaseHalfVideoChannels(undefined), parseBaseHalfVideoChannels('{'), parseBaseHalfVideoChannels('{"version":2,"channels":[]}')], [[], [], []]);
	});
});
