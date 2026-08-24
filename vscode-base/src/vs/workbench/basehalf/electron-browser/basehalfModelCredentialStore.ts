/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IEncryptionService } from '../../../platform/encryption/common/encryptionService.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../platform/ipc/common/mainProcessService.js';
import { secretStorageKey } from '../../../platform/secrets/common/secrets.js';
import { ISerializableApplicationStorageCompareAndSwapResult, ISerializableApplicationStorageItemRequest } from '../../../platform/storage/common/storageIpc.js';
import { IBaseHalfModelCredentialStore } from '../common/basehalfModelCredentialStore.js';

export class BaseHalfModelCredentialStore implements IBaseHalfModelCredentialStore {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IEncryptionService private readonly encryptionService: IEncryptionService,
	) { }

	async get(key: string): Promise<string | undefined> {
		const encrypted = await this.readEncrypted(key);
		return encrypted === undefined ? undefined : this.encryptionService.decrypt(encrypted);
	}

	async set(key: string, value: string): Promise<void> {
		const encrypted = await this.encryptionService.encrypt(value);
		for (;;) {
			const current = await this.readEncrypted(key);
			const result = await this.compareAndSwap(key, current, encrypted);
			if (result.swapped) {
				return;
			}
		}
	}

	async delete(key: string): Promise<void> {
		for (;;) {
			const current = await this.readEncrypted(key);
			if (current === undefined) {
				return;
			}
			const result = await this.compareAndSwap(key, current, undefined);
			if (result.swapped) {
				return;
			}
		}
	}

	private readEncrypted(key: string): Promise<string | undefined> {
		return this.mainProcessService.getChannel('storage').call('getApplicationItem', request(key));
	}

	private compareAndSwap(key: string, expected: string | undefined, value: string | undefined): Promise<ISerializableApplicationStorageCompareAndSwapResult> {
		return this.mainProcessService.getChannel('storage').call('compareAndSwapApplicationItem', request(key, expected, value));
	}
}

function request(key: string, expected?: string, value?: string): ISerializableApplicationStorageItemRequest {
	return { profile: undefined, workspace: undefined, key: secretStorageKey(key), expected, value };
}

registerSingleton(IBaseHalfModelCredentialStore, BaseHalfModelCredentialStore, InstantiationType.Delayed);
