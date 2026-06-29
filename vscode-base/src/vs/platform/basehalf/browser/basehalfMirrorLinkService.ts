/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IBaseHalfMirrorLinkService } from '../common/basehalfMirrorLink.js';

export class BrowserBaseHalfMirrorLinkService implements IBaseHalfMirrorLinkService {
	declare readonly _serviceBrand: undefined;

	async setCurrentFocusSymlink(): Promise<void> {
		throw new Error('BaseHalf current_focus.yaml symlink updates require the Electron main-process service.');
	}
}

registerSingleton(IBaseHalfMirrorLinkService, BrowserBaseHalfMirrorLinkService, InstantiationType.Delayed);

