/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';
import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { IBaseHalfFileTimesService } from '../common/basehalfFileTimes.js';

export class BaseHalfFileTimesService implements IBaseHalfFileTimesService {
	declare readonly _serviceBrand: undefined;

	async touch(resources: readonly URI[]): Promise<void> {
		const now = new Date();
		for (const resource of resources) {
			if (resource.scheme !== Schemas.file) {
				throw new Error(`Only files on disk have times to set, not ${resource.toString()}`);
			}
			await promises.utimes(resource.fsPath, now, now);
		}
	}
}
