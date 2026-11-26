/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { registerSharedProcessRemoteService } from '../../ipc/electron-browser/services.js';
import { BASEHALF_FILE_LINKS_CHANNEL, IBaseHalfFileLinksService } from '../common/basehalfFileLinks.js';

registerSharedProcessRemoteService(IBaseHalfFileLinksService, BASEHALF_FILE_LINKS_CHANNEL);
