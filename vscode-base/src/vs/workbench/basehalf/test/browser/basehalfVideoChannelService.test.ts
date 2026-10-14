/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { BaseHalfVideoChannelService } from '../../browser/basehalfVideoChannelService.js';
import {
	BASEHALF_VIDEO_CHANNELS_STORAGE_KEY,
	BASEHALF_VIDEO_LAST_USED_STORAGE_KEY,
	BASEHALF_VIDEO_PROVIDERS_COMMAND_ID,
	BaseHalfVideoChannelError,
	baseHalfVideoChannelKeyAddress
} from '../../common/basehalfVideoChannels.js';
import { getBaseHalfVideoProviderPresets } from '../../common/basehalfVideoProviders.js';
import { FakeProviderCommands, InMemoryCredentialStore } from './basehalfVideoTestFixtures.js';

suite('BaseHalfVideoChannelService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createHarness() {
		const store = disposables.add(new DisposableStore());
		const storage = store.add(new InMemoryStorageService());
		const credentials = new InMemoryCredentialStore();
		const commands = new FakeProviderCommands(store.add(new FileService(new NullLogService())));
		const service = store.add(new BaseHalfVideoChannelService(storage, credentials, commands));
		return { storage, credentials, commands, service };
	}

	test('starts a channel of each preset with the endpoint and models of the table and no key', async () => {
		const { service } = createHarness();
		for (const preset of getBaseHalfVideoProviderPresets()) {
			await service.addChannel(preset.kind);
		}
		assert.deepStrictEqual(service.getChannels().map(channel => ({ provider: channel.provider, name: channel.name, baseUrl: channel.baseUrl, models: channel.models, hasKey: channel.hasKey })), [
			{ provider: 'ark', name: 'Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seedance-2-5-260628'], hasKey: false },
			{ provider: 'byteplus', name: 'BytePlus ModelArk', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', models: ['dreamina-seedance-2-0-mini-260615', 'seedance-1-5-pro-251215'], hasKey: false },
			{ provider: 'dashscope', name: 'Alibaba Cloud Model Studio', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', models: ['wan2.6-t2v', 'wan2.6-i2v'], hasKey: false },
			{ provider: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', models: ['MiniMax-Hailuo-02'], hasKey: false },
			{ provider: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview'], hasKey: false },
			{ provider: 'openai', name: 'OpenAI Compatible', baseUrl: '', models: [], hasKey: false }
		]);
		assert.ok(service.getChannels().every(channel => new RegExp(`^${channel.provider}-[a-z0-9]{4}$`).test(channel.id)));

		const second = await service.addChannel('ark');
		assert.strictEqual(second.name, 'Volcengine Ark 2');
		assert.strictEqual(new Set(service.getChannels().map(channel => channel.id)).size, 7);
	});

	test('keeps the key only in the credential store and tells only whether one is set', async () => {
		const { service, storage, credentials } = createHarness();
		const channel = await service.addChannel('ark');
		let changes = 0;
		disposables.add(service.onDidChange(() => changes++));

		await service.setKey(channel.id, '  ark-secret-key-123  ');
		const stored = storage.get(BASEHALF_VIDEO_CHANNELS_STORAGE_KEY, StorageScope.APPLICATION) ?? '';
		assert.deepStrictEqual({
			hasKey: service.getChannel(channel.id)?.hasKey,
			key: await service.getKey(channel.id),
			credential: credentials.values.get(baseHalfVideoChannelKeyAddress(channel.id)),
			storageHoldsKey: stored.includes('ark-secret-key-123'),
			changes
		}, { hasKey: true, key: 'ark-secret-key-123', credential: 'ark-secret-key-123', storageHoldsKey: false, changes: 1 });

		await assert.rejects(() => service.setKey(channel.id, 'two words'), BaseHalfVideoChannelError);
		assert.strictEqual(await service.getKey(channel.id), 'ark-secret-key-123');

		await service.setKey(channel.id, undefined);
		assert.deepStrictEqual({ hasKey: service.getChannel(channel.id)?.hasKey, key: await service.getKey(channel.id), credentials: credentials.values.size }, { hasKey: false, key: undefined, credentials: 0 });
	});

	test('shows a key the credential store lost as missing', async () => {
		const { service, credentials } = createHarness();
		const channel = await service.addChannel('openai');
		await service.setKey(channel.id, 'sk-test');
		credentials.values.clear();
		assert.strictEqual(await service.getKey(channel.id), undefined);
		assert.strictEqual(service.getChannel(channel.id)?.hasKey, false);
	});

	test('changes a channel only with valid values and removes its key with it', async () => {
		const { service, credentials } = createHarness();
		const channel = await service.addChannel('openai');
		await service.setKey(channel.id, 'sk-relay');
		await service.updateChannel(channel.id, { name: ' My Relay ', baseUrl: 'http://127.0.0.1:8123/v1/', models: ['relay-video-1', ' seedance-relay ', 'relay-video-1'] });
		assert.deepStrictEqual(service.getChannel(channel.id), { ...channel, name: 'My Relay', baseUrl: 'http://127.0.0.1:8123/v1', models: ['relay-video-1', 'seedance-relay'], hasKey: true });

		await assert.rejects(() => service.updateChannel(channel.id, { baseUrl: 'http://relay.example.com/v1' }), BaseHalfVideoChannelError);
		await assert.rejects(() => service.updateChannel(channel.id, { name: '' }), BaseHalfVideoChannelError);
		await assert.rejects(() => service.updateChannel('openai-none', { name: 'x' }), BaseHalfVideoChannelError);
		assert.strictEqual(service.getChannel(channel.id)?.baseUrl, 'http://127.0.0.1:8123/v1');

		await service.removeChannel(channel.id);
		assert.deepStrictEqual({ channels: service.getChannels(), credentials: credentials.values.size }, { channels: [], credentials: 0 });
	});

	test('resolves a model to the named channel while it offers it, then to the first that does', async () => {
		const { service } = createHarness();
		const first = await service.addChannel('ark');
		const relay = await service.addChannel('openai');
		await service.updateChannel(relay.id, { models: ['my-model', 'doubao-seedance-2-5-260628'] });
		const resolved = (choice: { channel?: string; model?: string }) => {
			const result = service.resolve(choice);
			return result ? `${result.channel.id} ${result.model}` : undefined;
		};
		assert.deepStrictEqual([
			resolved({ channel: relay.id, model: 'doubao-seedance-2-5-260628' }),
			resolved({ channel: 'ark-gone', model: 'doubao-seedance-2-5-260628' }),
			resolved({ model: 'my-model' }),
			resolved({ channel: first.id, model: 'my-model' }),
			resolved({ model: 'unknown' }),
			resolved({ channel: first.id })
		], [
			`${relay.id} doubao-seedance-2-5-260628`,
			`${first.id} doubao-seedance-2-5-260628`,
			`${relay.id} my-model`,
			`${relay.id} my-model`,
			undefined,
			undefined
		]);
	});

	test('remembers the last settings on this computer and ignores what it cannot read', () => {
		const { service, storage } = createHarness();
		assert.strictEqual(service.getLastUsed(), undefined);
		const settings = { channel: 'ark-3f2a', model: 'doubao-seedance-2-5-260628', mode: 'frames' as const, ratio: '16:9', resolution: '720p', duration: 5, audio: true };
		service.setLastUsed(settings);
		assert.deepStrictEqual(service.getLastUsed(), settings);
		assert.deepStrictEqual(JSON.parse(storage.get(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, StorageScope.APPLICATION) ?? ''), settings);

		storage.store(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, '{"mode":"sideways"}', StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.strictEqual(service.getLastUsed(), undefined);
	});

	test('follows channels another window changed', async () => {
		const { service, storage } = createHarness();
		const channel = await service.addChannel('ark');
		let changes = 0;
		disposables.add(service.onDidChange(() => changes++));
		const raw = JSON.parse(storage.get(BASEHALF_VIDEO_CHANNELS_STORAGE_KEY, StorageScope.APPLICATION) ?? '');
		raw.channels[0].name = 'Renamed Elsewhere';
		storage.store(BASEHALF_VIDEO_CHANNELS_STORAGE_KEY, JSON.stringify(raw), StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.deepStrictEqual({ name: service.getChannel(channel.id)?.name, changes }, { name: 'Renamed Elsewhere', changes: 1 });
	});

	test('opens the Video Providers page through its command', async () => {
		const { service, commands } = createHarness();
		await service.openSettings();
		assert.deepStrictEqual(commands.calls.map(call => call.id), [BASEHALF_VIDEO_PROVIDERS_COMMAND_ID]);
	});
});
