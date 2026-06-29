/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../ipc/electron-browser/services.js';
import { BASEHALF_MIRROR_LINK_CHANNEL, IBaseHalfMirrorLinkService } from '../common/basehalfMirrorLink.js';

registerMainProcessRemoteService(IBaseHalfMirrorLinkService, BASEHALF_MIRROR_LINK_CHANNEL);

