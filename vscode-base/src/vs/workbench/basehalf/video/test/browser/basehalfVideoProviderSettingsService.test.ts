/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandEvent, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { BaseHalfVideoProviderSettingsService } from '../../browser/basehalfVideoProviderSettingsService.js';
import { IBaseHalfModelCredentialStore } from '../../common/basehalfModelCredentialStore.js';
import { IBaseHalfVideoProviderStatus } from '../../common/basehalfVideoGeneration.js';
import {
	BASEHALF_IMAGE_LAST_USED_STORAGE_KEY,
	BASEHALF_VIDEO_LAST_USED_STORAGE_KEY,
	BASEHALF_VIDEO_PROVIDERS_COMMAND_ID,
	BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY,
	BaseHalfVideoProviderSettingsError,
	baseHalfVideoProviderSecretAddress
} from '../../common/basehalfVideoProviderSettings.js';
import { TEST_VIDEO_CATALOG } from '../common/basehalfVideoCatalogFixture.js';

class MemoryCredentials implements IBaseHalfModelCredentialStore {
	declare readonly _serviceBrand: undefined;
	readonly values = new Map<string, string>();
	/** Values that cannot be decrypted, as when the key that encrypted them is gone. */
	readonly unreadable = new Set<string>();
	async get(key: string): Promise<string | undefined> {
		if (this.unreadable.has(key)) {
			throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
		}
		return this.values.get(key);
	}
	async set(key: string, value: string): Promise<void> {
		this.values.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.values.delete(key);
	}
}

class RecordingCommands implements ICommandService {
	declare readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly onDidExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly calls: { readonly id: string; readonly args: unknown[] }[] = [];
	async executeCommand<R = unknown>(id: string, ...args: unknown[]): Promise<R> {
		this.calls.push({ id, args });
		return undefined as R;
	}
}

suite('BaseHalfVideoProviderSettingsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const [acme, borealis] = TEST_VIDEO_CATALOG.providers;

	function createHarness() {
		const store = disposables.add(new DisposableStore());
		const storage = store.add(new InMemoryStorageService());
		const credentials = new MemoryCredentials();
		const commands = new RecordingCommands();
		const service = store.add(new BaseHalfVideoProviderSettingsService(storage, credentials, commands, new NullLogService()));
		return { storage, credentials, commands, service };
	}

	function status(value: IBaseHalfVideoProviderStatus) {
		return { region: value.region.id, setUp: value.setUp, endpoint: value.endpoint, customEndpoint: value.customEndpoint, credentials: [...value.credentials] };
	}

	test('a provider starts in its first region at its base URL and is set up once every declared value is set', async () => {
		const { service, storage, credentials } = createHarness();
		let changes = 0;
		disposables.add(service.onDidChange(() => changes++));
		const fresh = status(service.getStatus(borealis));
		await service.setCredential(borealis, 'accessKey', '  ak-0123  ');
		const half = status(service.getStatus(borealis));
		await service.setCredential(borealis, 'secretKey', 'sk-4567');
		const stored = storage.get(BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION) ?? '';
		assert.deepStrictEqual({
			fresh,
			half,
			full: status(service.getStatus(borealis)),
			secret: JSON.parse(credentials.values.get('basehalf.modelServices.video.borealis.apiKey') ?? 'null'),
			record: JSON.parse(stored),
			storageHoldsValues: stored.includes('ak-0123') || stored.includes('sk-4567'),
			changes
		}, {
			fresh: { region: 'main', setUp: false, endpoint: 'https://api.borealis.example', customEndpoint: false, credentials: [] },
			half: { region: 'main', setUp: false, endpoint: 'https://api.borealis.example', customEndpoint: false, credentials: ['accessKey'] },
			full: { region: 'main', setUp: true, endpoint: 'https://api.borealis.example', customEndpoint: false, credentials: ['accessKey', 'secretKey'] },
			secret: { accessKey: 'ak-0123', secretKey: 'sk-4567' },
			record: { version: 1, providers: { borealis: { credentials: ['accessKey', 'secretKey'] } } },
			storageHoldsValues: false,
			changes: 2
		});
	});

	test('reads the access to a provider only when it is set up, for its region or another one', async () => {
		const { service } = createHarness();
		assert.strictEqual(await service.getAccess(acme), undefined);
		await service.setCredential(acme, 'apiKey', 'acme-secret');
		await service.setRegion(acme, 'west');
		await service.setEndpoint(acme, 'http://127.0.0.1:8123/api/v1/');
		assert.deepStrictEqual({
			access: await service.getAccess(acme),
			eastTask: await service.getAccess(acme, 'east'),
			goneRegion: await service.getAccess(acme, 'north')
		}, {
			access: { provider: 'acme', region: 'west', endpoint: 'http://127.0.0.1:8123/api/v1', credentials: { apiKey: 'acme-secret' } },
			eastTask: { provider: 'acme', region: 'east', endpoint: 'https://east.acme.example/api/v1', credentials: { apiKey: 'acme-secret' } },
			goneRegion: undefined
		});
	});

	test('keeps an endpoint the user entered across a region change, and goes back to the base URL when it is cleared', async () => {
		const { service } = createHarness();
		await service.setEndpoint(acme, 'https://relay.example.com/acme/');
		await service.setRegion(acme, 'west');
		const relay = status(service.getStatus(acme));
		await service.setEndpoint(acme, 'https://west.acme.example/api/v1');
		const baseUrl = status(service.getStatus(acme));
		await service.setEndpoint(acme, 'https://relay.example.com/acme');
		await service.setEndpoint(acme, '   ');
		await assert.rejects(() => service.setEndpoint(acme, 'http://relay.example.com/v1'), BaseHalfVideoProviderSettingsError);
		await assert.rejects(() => service.setEndpoint(acme, 'https://user:pass@relay.example.com'), BaseHalfVideoProviderSettingsError);
		await assert.rejects(() => service.setRegion(acme, 'north'), BaseHalfVideoProviderSettingsError);
		assert.deepStrictEqual({ relay, baseUrl, cleared: status(service.getStatus(acme)) }, {
			relay: { region: 'west', setUp: false, endpoint: 'https://relay.example.com/acme', customEndpoint: true, credentials: [] },
			baseUrl: { region: 'west', setUp: false, endpoint: 'https://west.acme.example/api/v1', customEndpoint: false, credentials: [] },
			cleared: { region: 'west', setUp: false, endpoint: 'https://west.acme.example/api/v1', customEndpoint: false, credentials: [] }
		});
	});

	test('refuses a value that is not a credential, removes one, and shows a value the credential store lost as not set', async () => {
		const { service, credentials } = createHarness();
		await assert.rejects(() => service.setCredential(acme, 'apiKey', 'two words'), (error: Error) => error instanceof BaseHalfVideoProviderSettingsError
			&& error.message === 'Use only letters, digits, and symbols for the API Key, without spaces or line breaks. Check that only the API Key was pasted.');
		await assert.rejects(() => service.setCredential(acme, 'token', 'x'), BaseHalfVideoProviderSettingsError);
		await service.setCredential(acme, 'apiKey', 'acme-secret');
		await service.setCredential(acme, 'apiKey', undefined);
		const removed = { status: status(service.getStatus(acme)), secrets: credentials.values.size };
		await service.setCredential(acme, 'apiKey', 'acme-secret');
		credentials.values.clear();
		assert.deepStrictEqual({ removed, access: await service.getAccess(acme), lost: status(service.getStatus(acme)).setUp }, {
			removed: { status: { region: 'east', setUp: false, endpoint: 'https://east.acme.example/api/v1', customEndpoint: false, credentials: [] }, secrets: 0 },
			access: undefined,
			lost: false
		});
		assert.strictEqual(baseHalfVideoProviderSecretAddress('acme'), 'basehalf.modelServices.video.acme.apiKey');
		assert.throws(() => baseHalfVideoProviderSecretAddress('Acme Video'), BaseHalfVideoProviderSettingsError);
	});

	test('remembers the last generation on this computer, ignores what it cannot read, and follows another window', () => {
		const { service, storage } = createHarness();
		let changes = 0;
		disposables.add(service.onDidChange(() => changes++));
		const generation = { provider: 'acme', model: 'acme-motion-2', mode: 'frames' as const, params: { resolution: '720p', duration: 5, sound: true } };
		service.setLastUsed(generation);
		const stored = JSON.parse(storage.get(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, StorageScope.APPLICATION) ?? 'null');
		service.setLastUsed({ ...generation, params: { resolution: { nested: true } } as never });
		const afterInvalid = service.getLastUsed();
		storage.store(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, '{"model":"acme-still","mode":"sideways"}', StorageScope.APPLICATION, StorageTarget.MACHINE);
		const unreadable = service.getLastUsed();
		storage.store(BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, JSON.stringify({ version: 1, providers: { acme: { region: 'west', credentials: ['apiKey'] } } }), StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.deepStrictEqual({ stored, afterInvalid, unreadable, elsewhere: status(service.getStatus(acme)), changes }, {
			stored: generation,
			afterInvalid: generation,
			unreadable: undefined,
			elsewhere: { region: 'west', setUp: true, endpoint: 'https://west.acme.example/api/v1', customEndpoint: false, credentials: ['apiKey'] },
			changes: 3
		});
	});

	test('keeps the last values of an image apart from those of a video, each under its own key', () => {
		const { service, storage } = createHarness();
		const video = { provider: 'acme', model: 'acme-motion-2', mode: 'frames' as const, params: { duration: 5 } };
		const image = { provider: 'acme', model: 'acme-paint', mode: 'reference' as const, params: { count: 4 } };
		service.setLastUsed(video, 'video');
		service.setLastUsed(image, 'image');
		storage.store(BASEHALF_IMAGE_LAST_USED_STORAGE_KEY, JSON.stringify({ ...image, params: { count: 2 } }), StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.deepStrictEqual({
			video: service.getLastUsed('video'),
			videoByDefault: service.getLastUsed(),
			image: service.getLastUsed('image'),
			stored: [JSON.parse(storage.get(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, StorageScope.APPLICATION) ?? 'null'), BASEHALF_IMAGE_LAST_USED_STORAGE_KEY]
		}, {
			video,
			videoByDefault: video,
			image: { ...image, params: { count: 2 } },
			stored: [video, 'basehalf.image.lastUsed.v1']
		});
	});

	test('a stored value that cannot be read is neither used nor deleted, works again once it can be read, and Replace and Remove write over it', async () => {
		const { service, credentials } = createHarness();
		const address = 'basehalf.modelServices.video.acme.apiKey';
		await service.setCredential(acme, 'apiKey', 'acme-old');
		credentials.unreadable.add(address);
		const refused = await service.getAccess(acme).then(() => 'no error', (error: Error) => error.message);
		const shown = service.getStatus(acme).setUp;
		const kept = credentials.values.get(address);
		credentials.unreadable.delete(address);
		const again = (await service.getAccess(acme))?.credentials;
		credentials.unreadable.add(address);
		await service.setCredential(acme, 'apiKey', 'acme-new');
		const replaced = credentials.values.get(address);
		await service.setCredential(acme, 'apiKey', undefined);
		assert.deepStrictEqual({ refused, shown, kept, again, replaced, removed: !credentials.values.has(address), setUp: service.getStatus(acme).setUp }, {
			refused: 'BaseHalf can\'t read the credentials of Acme Video on this computer. Set them again in Providers.',
			shown: true,
			kept: JSON.stringify({ apiKey: 'acme-old' }),
			again: { apiKey: 'acme-old' },
			replaced: JSON.stringify({ apiKey: 'acme-new' }),
			removed: true,
			setUp: false
		});
	});

	test('opens the Providers page through its command, on a provider when one is given', async () => {
		const { service, commands } = createHarness();
		await service.openSettings();
		await service.openSettings('acme');
		assert.deepStrictEqual(commands.calls, [{ id: BASEHALF_VIDEO_PROVIDERS_COMMAND_ID, args: [] }, { id: BASEHALF_VIDEO_PROVIDERS_COMMAND_ID, args: ['acme'] }]);
	});
});
