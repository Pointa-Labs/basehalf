/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { registerSharedProcessRemoteService } from '../../ipc/electron-browser/services.js';
import { BASEHALF_PROVIDERS_CHANNEL, IBaseHalfProviderService } from '../common/basehalfProviders.js';

// The window calls the provider service of the shared process directly (D75).
registerSharedProcessRemoteService(IBaseHalfProviderService, BASEHALF_PROVIDERS_CHANNEL);
