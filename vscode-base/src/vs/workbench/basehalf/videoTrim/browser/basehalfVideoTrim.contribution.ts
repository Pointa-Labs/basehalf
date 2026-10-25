/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { BaseHalfVideoTrimService, IBaseHalfVideoTrimService } from './basehalfVideoTrimService.js';

// Trimming a video: the service that saves the clips of the trim bar under the player of Card Detail.
registerSingleton(IBaseHalfVideoTrimService, BaseHalfVideoTrimService, InstantiationType.Delayed);
