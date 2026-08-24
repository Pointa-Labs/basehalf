/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IBaseHalfModelCredentialStore = createDecorator<IBaseHalfModelCredentialStore>('basehalfModelCredentialStore');

/** Durable, encrypted application credential storage serialized by Electron main. */
export interface IBaseHalfModelCredentialStore {
	readonly _serviceBrand: undefined;
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}
