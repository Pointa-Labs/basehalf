/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { rejects, strictEqual } from 'assert';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { IBaseSerializableStorageRequest, ISerializableApplicationStorageCompareAndSwapResult, ISerializableApplicationStorageItemRequest, ISerializableItemsChangeEvent } from '../../common/storageIpc.js';
import { IStorageChangeEvent, IStorageMain } from '../../electron-main/storageMain.js';
import { StorageDatabaseChannel } from '../../electron-main/storageIpc.js';
import { IStorageMainService } from '../../electron-main/storageMainService.js';

suite('StorageDatabaseChannel durable application items', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	class TestStorage {
		readonly items = new Map<string, string>();
		readonly onDidCloseStorage = Event.None;
		readonly whenInit = Promise.resolve();
		readonly path = '/durable/state.vscdb';

		private readonly onDidChangeStorageEmitter = disposables.add(new Emitter<IStorageChangeEvent>());
		readonly onDidChangeStorage = this.onDidChangeStorageEmitter.event;

		private readonly writes: Promise<void>[] = [];
		writeCount = 0;
		inMemory = false;
		durable = true;

		queueWrite(write: Promise<void>): void {
			this.writes.push(write);
		}

		async init(): Promise<void> { }
		get(key: string): string | undefined { return this.items.get(key); }

		set(key: string, value: string | boolean | number | undefined | null): Promise<void> {
			this.writeCount++;
			this.items.set(key, String(value));
			this.onDidChangeStorageEmitter.fire({ key });
			return this.writes.shift() ?? Promise.resolve();
		}

		delete(key: string): Promise<void> {
			this.writeCount++;
			this.items.delete(key);
			this.onDidChangeStorageEmitter.fire({ key });
			return this.writes.shift() ?? Promise.resolve();
		}

		isInMemory(): boolean { return this.inMemory; }
		async isDurable(): Promise<boolean> { return this.durable; }
	}

	function createChannel(storage: TestStorage): StorageDatabaseChannel {
		const sharedStorage = new TestStorage();
		const storageMainService = {
			applicationStorage: storage as unknown as IStorageMain,
			applicationSharedStorage: sharedStorage as unknown as IStorageMain
		} as IStorageMainService;
		return disposables.add(new StorageDatabaseChannel(new NullLogService(), storageMainService));
	}

	function request(key: string, expected?: string, value?: string): ISerializableApplicationStorageItemRequest {
		return { profile: undefined, workspace: undefined, key, expected, value };
	}

	function listen(channel: StorageDatabaseChannel): ISerializableItemsChangeEvent[] {
		const events: ISerializableItemsChangeEvent[] = [];
		const listenRequest: IBaseSerializableStorageRequest = { profile: undefined, workspace: undefined };
		disposables.add(channel.listen(undefined, 'onDidChangeStorage', listenRequest)(event => events.push(event)));
		return events;
	}

	test('serializes updates per key and makes reads wait for durable completion', async () => {
		const storage = new TestStorage();
		const channel = createChannel(storage);
		const events = listen(channel);
		const firstWrite = new DeferredPromise<void>();
		storage.queueWrite(firstWrite.p);

		const key = 'basehalf.plugins.catalog';
		const first = channel.call(undefined, 'compareAndSwapApplicationItem', request(key, undefined, 'one')) as Promise<ISerializableApplicationStorageCompareAndSwapResult>;
		await timeout(0);
		const second = channel.call(undefined, 'compareAndSwapApplicationItem', request(key, 'one', 'two')) as Promise<ISerializableApplicationStorageCompareAndSwapResult>;
		let readSettled = false;
		const read = channel.call(undefined, 'getApplicationItem', request(key)).then(value => {
			readSettled = true;
			return value;
		});

		await timeout(150);
		strictEqual(storage.writeCount, 1);
		strictEqual(readSettled, false);
		strictEqual(events.length, 0);

		firstWrite.complete();
		strictEqual((await first).swapped, true);
		strictEqual((await second).swapped, true);
		strictEqual(await read, 'two');
		strictEqual(storage.writeCount, 2);
		strictEqual(events.length, 2);
	});

	test('restores the cache and publishes no event when persistence fails', async () => {
		const storage = new TestStorage();
		const key = 'basehalf.plugins.receipt.pointa.example';
		storage.items.set(key, 'old');
		const failedWrite = new DeferredPromise<void>();
		storage.queueWrite(failedWrite.p);
		storage.queueWrite(Promise.resolve());
		const channel = createChannel(storage);
		const events = listen(channel);

		const update = channel.call(undefined, 'compareAndSwapApplicationItem', request(key, 'old', 'new'));
		await timeout(150);
		strictEqual(events.length, 0);

		failedWrite.error(new Error('write failed'));
		await rejects(update, /write failed/);
		await timeout(150);
		strictEqual(storage.get(key), 'old');
		strictEqual(storage.writeCount, 2);
		strictEqual(events.length, 0);
	});

	test('awaits durable deletion before publishing it', async () => {
		const storage = new TestStorage();
		const key = 'basehalf.plugins.receipt.pointa.example';
		storage.items.set(key, 'old');
		const deleteWrite = new DeferredPromise<void>();
		storage.queueWrite(deleteWrite.p);
		const channel = createChannel(storage);
		const events = listen(channel);

		const update = channel.call(undefined, 'compareAndSwapApplicationItem', request(key, 'old', undefined));
		await timeout(150);
		strictEqual(storage.get(key), undefined);
		strictEqual(events.length, 0);

		deleteWrite.complete();
		const result: ISerializableApplicationStorageCompareAndSwapResult = await update;
		strictEqual(result.swapped, true);
		strictEqual(events.length, 1);
		strictEqual(events[0].deleted?.[0], key);
	});

	test('admits only narrowly addressed BaseHalf model credentials', async () => {
		const storage = new TestStorage();
		const channel = createChannel(storage);
		const credentialKey = 'secret://basehalf.modelConnections.pointa.test.byteplus.11111111-1111-4111-8111-111111111111.credentials';
		strictEqual((await channel.call(undefined, 'compareAndSwapApplicationItem', request(credentialKey, undefined, 'encrypted')) as ISerializableApplicationStorageCompareAndSwapResult).swapped, true);
		strictEqual(await channel.call(undefined, 'getApplicationItem', request(credentialKey)), 'encrypted');
		await rejects(channel.call(undefined, 'getApplicationItem', request('secret://extension.arbitrary.token')), /invalid/i);
	});

	test('rejects reads and updates when application storage is in memory', async () => {
		const storage = new TestStorage();
		storage.inMemory = true;
		storage.durable = false;
		const channel = createChannel(storage);
		const key = 'basehalf.plugins.catalog';

		await rejects(channel.call(undefined, 'getApplicationItem', request(key)), /durable/i);
		await rejects(channel.call(undefined, 'compareAndSwapApplicationItem', request(key, undefined, 'value')), /durable/i);
		strictEqual(storage.writeCount, 0);
	});

	test('rejects application items when the storage backend is unhealthy', async () => {
		const storage = new TestStorage();
		storage.durable = false;
		const channel = createChannel(storage);
		const key = 'basehalf.plugins.catalog';

		await rejects(channel.call(undefined, 'getApplicationItem', request(key)), /durable/i);
		await rejects(channel.call(undefined, 'compareAndSwapApplicationItem', request(key, undefined, 'value')), /durable/i);
		strictEqual(storage.writeCount, 0);
	});
});
