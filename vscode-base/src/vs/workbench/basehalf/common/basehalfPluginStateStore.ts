/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ISerializableApplicationStorageCompareAndSwapResult } from '../../../platform/storage/common/storageIpc.js';

export const IBaseHalfPluginStateStore = createDecorator<IBaseHalfPluginStateStore>('basehalfPluginStateStore');

export interface IBaseHalfPluginStateStore {
	readonly _serviceBrand: undefined;
	read(key: string): Promise<string | undefined>;
	compareAndSwap(key: string, expected: string | undefined, value: string | undefined): Promise<ISerializableApplicationStorageCompareAndSwapResult>;
}
