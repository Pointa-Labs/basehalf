/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const BASEHALF_FILE_TIMES_CHANNEL = 'basehalfFileTimes';

export const IBaseHalfFileTimesService = createDecorator<IBaseHalfFileTimesService>('baseHalfFileTimesService');

/**
 * Sets the times of files on disk, which a window cannot do itself: the
 * service runs in the shared process (exact undo, "Changing files in place").
 */
export interface IBaseHalfFileTimesService {
	readonly _serviceBrand: undefined;
	/** Gives files on disk the time of now as their modification time, as a save would, and leaves their bytes as they are. */
	touch(resources: readonly URI[]): Promise<void>;
}
