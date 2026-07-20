/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { revive } from '../../../base/common/marshalling.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../log/common/log.js';
import { IBaseSerializableStorageRequest, ISerializableApplicationStorageCompareAndSwapResult, ISerializableApplicationStorageItemRequest, ISerializableItemsChangeEvent, ISerializableUpdateRequest, Key, Value } from '../common/storageIpc.js';
import { ApplicationSharedStorageMain, IStorageChangeEvent, IStorageMain } from './storageMain.js';
import { IStorageMainService } from './storageMainService.js';
import { IUserDataProfile } from '../../userDataProfile/common/userDataProfile.js';
import { reviveIdentifier, IAnyWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export class StorageDatabaseChannel extends Disposable implements IServerChannel {

	private static readonly STORAGE_CHANGE_DEBOUNCE_TIME = 100;

	private readonly onDidChangeApplicationStorageEmitter = this._register(new Emitter<ISerializableItemsChangeEvent>());
	private readonly onDidChangeApplicationSharedStorageEmitter = this._register(new Emitter<ISerializableItemsChangeEvent>());

	private readonly mapProfileToOnDidChangeProfileStorageEmitter = new Map<string /* profile ID */, Emitter<ISerializableItemsChangeEvent>>();
	private readonly applicationItemOperationTails = new Map<string, Promise<void>>();
	private readonly pendingDurableApplicationItemUpdates = new Set<string>();

	constructor(
		private readonly logService: ILogService,
		private readonly storageMainService: IStorageMainService
	) {
		super();

		this.registerStorageChangeListeners(storageMainService.applicationStorage, this.onDidChangeApplicationStorageEmitter, true);
		this.registerStorageChangeListeners(storageMainService.applicationSharedStorage, this.onDidChangeApplicationSharedStorageEmitter);
	}

	//#region Storage Change Events

	private registerStorageChangeListeners(storage: IStorageMain, emitter: Emitter<ISerializableItemsChangeEvent>, protectDurableApplicationItems = false): void {

		// Listen for changes in provided storage to send to listeners
		// that are listening. Use a debouncer to reduce IPC traffic.
		const storageChanges = this._register(new Emitter<IStorageChangeEvent>());
		this._register(storage.onDidChangeStorage(event => {
			if (protectDurableApplicationItems && this.pendingDurableApplicationItemUpdates.has(event.key)) {
				return;
			}

			storageChanges.fire(event);
		}));

		this._register(Event.debounce(storageChanges.event, (prev: IStorageChangeEvent[] | undefined, cur: IStorageChangeEvent) => {
			if (!prev) {
				prev = [cur];
			} else {
				prev.push(cur);
			}

			return prev;
		}, StorageDatabaseChannel.STORAGE_CHANGE_DEBOUNCE_TIME)(events => {
			if (events.length) {
				emitter.fire(this.serializeStorageChangeEvents(events, storage));
			}
		}));
	}

	private serializeStorageChangeEvents(events: IStorageChangeEvent[], storage: IStorageMain): ISerializableItemsChangeEvent {
		const changed = new Map<Key, Value>();
		const deleted = new Set<Key>();
		events.forEach(event => {
			const existing = storage.get(event.key);
			if (typeof existing === 'string') {
				changed.set(event.key, existing);
			} else {
				deleted.add(event.key);
			}
		});

		return {
			changed: Array.from(changed.entries()),
			deleted: Array.from(deleted.values())
		};
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	listen(_: unknown, event: string, arg: IBaseSerializableStorageRequest): Event<any> {
		switch (event) {
			case 'onDidChangeStorage': {
				const profile = arg.profile ? revive<IUserDataProfile>(arg.profile) : undefined;

				// Without profile: application or application-shared scope
				if (!profile) {
					if (arg.applicationShared) {
						return this.onDidChangeApplicationSharedStorageEmitter.event;
					}

					return this.onDidChangeApplicationStorageEmitter.event;
				}

				// With profile: profile scope for the profile
				let profileStorageChangeEmitter = this.mapProfileToOnDidChangeProfileStorageEmitter.get(profile.id);
				if (!profileStorageChangeEmitter) {
					profileStorageChangeEmitter = this._register(new Emitter<ISerializableItemsChangeEvent>());
					this.registerStorageChangeListeners(this.storageMainService.profileStorage(profile), profileStorageChangeEmitter);
					this.mapProfileToOnDidChangeProfileStorageEmitter.set(profile.id, profileStorageChangeEmitter);
				}

				return profileStorageChangeEmitter.event;
			}
		}

		throw new Error(`Event not found: ${event}`);
	}

	//#endregion

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async call(_: unknown, command: string, arg: IBaseSerializableStorageRequest): Promise<any> {
		const profile = arg.profile ? revive<IUserDataProfile>(arg.profile) : undefined;
		const workspace = reviveIdentifier(arg.workspace);
		const applicationShared = arg.applicationShared;

		// Get storage to be ready
		const storage = await this.withStorageInitialized(profile, workspace, applicationShared);

		// handle call
		switch (command) {
			case 'getApplicationItem': {
				if (profile || workspace || applicationShared) {
					throw new Error('Application item reads cannot target another storage scope.');
				}
				const request = arg as ISerializableApplicationStorageItemRequest;
				this.validateApplicationItemRequest(request);
				await this.waitForApplicationItemOperation(request.key);
				await this.assertDurableApplicationStorage(storage);
				return storage.get(request.key);
			}

			case 'compareAndSwapApplicationItem': {
				if (profile || workspace || applicationShared) {
					throw new Error('Application item updates cannot target another storage scope.');
				}
				const request = arg as ISerializableApplicationStorageItemRequest;
				this.validateApplicationItemRequest(request);
				return this.queueApplicationItemOperation(request.key, async () => {
					await this.assertDurableApplicationStorage(storage);
					const current = storage.get(request.key);
					if (current !== request.expected) {
						return { swapped: false, current } satisfies ISerializableApplicationStorageCompareAndSwapResult;
					}

					if (current === request.value) {
						return { swapped: true, current: request.value } satisfies ISerializableApplicationStorageCompareAndSwapResult;
					}

					this.pendingDurableApplicationItemUpdates.add(request.key);
					try {
						await this.updateApplicationItem(storage, request.key, request.value);
						await this.assertDurableApplicationStorage(storage);
						this.onDidChangeApplicationStorageEmitter.fire(this.serializeStorageChangeEvents([{ key: request.key }], storage));
						return { swapped: true, current: request.value } satisfies ISerializableApplicationStorageCompareAndSwapResult;
					} catch (error) {
						try {
							await this.updateApplicationItem(storage, request.key, current);
						} catch (rollbackError) {
							this.logService.error('StorageIPC#compareAndSwapApplicationItem: Unable to restore the application plugin state cache.', rollbackError);
						}
						throw error;
					} finally {
						this.pendingDurableApplicationItemUpdates.delete(request.key);
					}
				});
			}

			case 'getItems': {
				const items = new Map(storage.items);
				return Array.from(items.entries());
			}

			case 'getFallbackApplicationStorageItems': {
				if (storage instanceof ApplicationSharedStorageMain) {
					return Array.from(storage.applicationStorageItems.entries());
				}
				return [];
			}

			case 'updateItems': {
				const items: ISerializableUpdateRequest = arg;

				if (items.insert) {
					for (const [key, value] of items.insert) {
						storage.set(key, value);
					}
				}

				items.delete?.forEach(key => storage.delete(key));

				break;
			}

			case 'optimize': {
				return storage.optimize();
			}

			case 'isUsed': {
				const path = arg.payload as string | undefined;
				if (typeof path === 'string') {
					return this.storageMainService.isUsed(path);
				}
				return false;
			}

			default:
				throw new Error(`Call not found: ${command}`);
		}
	}

	private validateApplicationItemRequest(request: ISerializableApplicationStorageItemRequest): void {
		if (typeof request.key !== 'string'
			|| !request.key.startsWith('basehalf.plugins.')
			|| request.key.length > 512
			|| (request.expected !== undefined && (typeof request.expected !== 'string' || Buffer.byteLength(request.expected, 'utf8') > 6 * 1024 * 1024))
			|| (request.value !== undefined && (typeof request.value !== 'string' || Buffer.byteLength(request.value, 'utf8') > 6 * 1024 * 1024))) {
			throw new Error('Invalid application plugin state request.');
		}
	}

	private async assertDurableApplicationStorage(storage: IStorageMain): Promise<void> {
		if (storage.isInMemory() || !(await storage.isDurable())) {
			throw new Error('Durable application plugin state storage is unavailable.');
		}
	}

	private updateApplicationItem(storage: IStorageMain, key: string, value: string | undefined): Promise<void> {
		return value === undefined ? storage.delete(key) : storage.set(key, value);
	}

	private waitForApplicationItemOperation(key: string): Promise<void> {
		return this.applicationItemOperationTails.get(key) ?? Promise.resolve();
	}

	private queueApplicationItemOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const result = this.waitForApplicationItemOperation(key).then(operation);
		const tail = result.then(() => undefined, () => undefined);
		this.applicationItemOperationTails.set(key, tail);
		void tail.then(() => {
			if (this.applicationItemOperationTails.get(key) === tail) {
				this.applicationItemOperationTails.delete(key);
			}
		});
		return result;
	}

	private async withStorageInitialized(profile: IUserDataProfile | undefined, workspace: IAnyWorkspaceIdentifier | undefined, applicationShared?: boolean): Promise<IStorageMain> {
		let storage: IStorageMain;
		if (workspace) {
			storage = this.storageMainService.workspaceStorage(workspace);
		} else if (profile) {
			storage = this.storageMainService.profileStorage(profile);
		} else if (applicationShared) {
			storage = this.storageMainService.applicationSharedStorage;
		} else {
			storage = this.storageMainService.applicationStorage;
		}

		try {
			await storage.init();
		} catch (error) {
			this.logService.error(`StorageIPC#init: Unable to init ${workspace ? 'workspace' : profile ? 'profile' : applicationShared ? 'application-shared' : 'application'} storage due to ${error}`);
		}

		return storage;
	}
}
