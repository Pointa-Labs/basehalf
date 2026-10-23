/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { getWindows, onDidRegisterWindow } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { setupBaseHalfHovers } from './basehalfHover.js';

/** Every window shows the hovers that BaseHalf's elements ask for with their attribute. */
class BaseHalfHoverContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalfHover';

	constructor(@IHoverService hoverService: IHoverService) {
		super();
		for (const { window } of getWindows()) {
			this._register(setupBaseHalfHovers(window.document.body, hoverService));
		}
		this._register(onDidRegisterWindow(({ window, disposables }) => disposables.add(setupBaseHalfHovers(window.document.body, hoverService))));
	}
}

registerWorkbenchContribution2(BaseHalfHoverContribution.ID, BaseHalfHoverContribution, WorkbenchPhase.BlockRestore);
