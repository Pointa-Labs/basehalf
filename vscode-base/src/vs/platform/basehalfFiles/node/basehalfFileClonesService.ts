/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { constants, promises } from 'fs';
import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { IBaseHalfFileClonesService } from '../common/basehalfFileClones.js';

export class BaseHalfFileClonesService implements IBaseHalfFileClonesService {
	declare readonly _serviceBrand: undefined;

	async clone(source: URI, target: URI): Promise<void> {
		for (const resource of [source, target]) {
			if (resource.scheme !== Schemas.file) {
				throw new Error(`Only files on disk are cloned, not ${resource.toString()}`);
			}
		}
		// A clone where the disk can make one, a copy where it cannot; never over a file that is there.
		await promises.copyFile(source.fsPath, target.fsPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
	}
}
