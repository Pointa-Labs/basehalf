/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const BASEHALF_MIRROR_LINK_CHANNEL = 'basehalfMirrorLink';
export const IBaseHalfMirrorLinkService = createDecorator<IBaseHalfMirrorLinkService>('baseHalfMirrorLinkService');

export interface IBaseHalfMirrorLinkService {
	readonly _serviceBrand: undefined;

	setCurrentFocusSymlink(currentFocusFsPath: string, target: string): Promise<void>;
}

