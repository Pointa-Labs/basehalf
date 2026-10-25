/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const BASEHALF_FILE_CLONES_CHANNEL = 'basehalfFileClones';

export const IBaseHalfFileClonesService = createDecorator<IBaseHalfFileClonesService>('baseHalfFileClonesService');

/**
 * Clones files on disk, which a window cannot do itself: the service runs in
 * the shared process (editing media, "Copies, deletes, and the Trash").
 */
export interface IBaseHalfFileClonesService {
	readonly _serviceBrand: undefined;
	/**
	 * Copies a file to a path that holds nothing: by a clone on a disk that can
	 * make one, as macOS's can, which takes no room until one of the two
	 * changes, and byte for byte on other disks. The parent folder must exist.
	 */
	clone(source: URI, target: URI): Promise<void>;
}
