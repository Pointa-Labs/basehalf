/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { BaseHalfGenerationKind } from '../common/basehalfGenerationInfo.js';
import { BaseHalfAudioDraftPanel } from './basehalfAudioDraftPanel.js';
import { BaseHalfImageDraftPanel } from './basehalfImageDraftPanel.js';
import { BaseHalfVideoDraftPanel } from './basehalfVideoDraftPanel.js';
import { BaseHalfVideoNodePanel, IBaseHalfVideoNodePanelHost, IBaseHalfVideoNodePanelOptions } from './basehalfVideoNodePanel.js';

/** The panel of a draft of `kind`: its kind's own (generation cards, "The panel of each kind"; D91). */
export function createBaseHalfDraftPanel(
	instantiationService: IInstantiationService,
	kind: BaseHalfGenerationKind,
	resource: URI,
	host: IBaseHalfVideoNodePanelHost,
	options?: IBaseHalfVideoNodePanelOptions
): BaseHalfVideoNodePanel {
	switch (kind) {
		case 'image': return instantiationService.createInstance(BaseHalfImageDraftPanel, resource, host, options);
		case 'audio': return instantiationService.createInstance(BaseHalfAudioDraftPanel, resource, host, options);
		case 'video': return instantiationService.createInstance(BaseHalfVideoDraftPanel, resource, host, options);
	}
}
