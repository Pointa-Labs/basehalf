/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { registerSharedProcessRemoteService } from '../../ipc/electron-browser/services.js';
import { BASEHALF_FILE_TIMES_CHANNEL, IBaseHalfFileTimesService } from '../common/basehalfFileTimes.js';

registerSharedProcessRemoteService(IBaseHalfFileTimesService, BASEHALF_FILE_TIMES_CHANNEL);
