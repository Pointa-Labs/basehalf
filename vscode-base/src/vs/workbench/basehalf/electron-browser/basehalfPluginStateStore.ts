/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../platform/ipc/common/mainProcessService.js';
import { ISerializableApplicationStorageCompareAndSwapResult, ISerializableApplicationStorageItemRequest } from '../../../platform/storage/common/storageIpc.js';
import { IBaseHalfPluginStateStore } from '../common/basehalfPluginStateStore.js';

const BASEHALF_PLUGIN_STORAGE_PREFIX = 'basehalf.plugins.';
const MAX_PLUGIN_STATE_BYTES = 6 * 1024 * 1024;

export class BaseHalfPluginStateStore implements IBaseHalfPluginStateStore {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) { }

	read(key: string): Promise<string | undefined> {
		assertPluginStateKey(key);
		const request: ISerializableApplicationStorageItemRequest = {
			profile: undefined,
			workspace: undefined,
			key
		};
		return this.mainProcessService.getChannel('storage').call('getApplicationItem', request);
	}

	compareAndSwap(key: string, expected: string | undefined, value: string | undefined): Promise<ISerializableApplicationStorageCompareAndSwapResult> {
		assertPluginStateKey(key);
		if (expected !== undefined && new TextEncoder().encode(expected).byteLength > MAX_PLUGIN_STATE_BYTES) {
			throw new Error('The expected plugin state exceeds the storage limit.');
		}
		if (value !== undefined && new TextEncoder().encode(value).byteLength > MAX_PLUGIN_STATE_BYTES) {
			throw new Error('The plugin state exceeds the storage limit.');
		}
		const request: ISerializableApplicationStorageItemRequest = {
			profile: undefined,
			workspace: undefined,
			key,
			expected,
			value
		};
		return this.mainProcessService.getChannel('storage').call('compareAndSwapApplicationItem', request);
	}
}

function assertPluginStateKey(key: string): void {
	if (!key.startsWith(BASEHALF_PLUGIN_STORAGE_PREFIX) || key.length > 512) {
		throw new Error('Invalid plugin state key.');
	}
}

registerSingleton(IBaseHalfPluginStateStore, BaseHalfPluginStateStore, InstantiationType.Delayed);
