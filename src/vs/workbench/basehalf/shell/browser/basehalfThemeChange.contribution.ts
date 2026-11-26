/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { keepBaseHalfThemeChangesInstant } from '../../ui/browser/basehalfThemeChange.js';

/** A change of the theme shows in one frame in the window: nothing glides from the old palette to the new. */
class BaseHalfThemeChangeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalfThemeChange';

	constructor(
		@IThemeService themeService: IThemeService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super();
		this._register(keepBaseHalfThemeChangesInstant(layoutService.mainContainer, themeService));
	}
}

registerWorkbenchContribution2(BaseHalfThemeChangeContribution.ID, BaseHalfThemeChangeContribution, WorkbenchPhase.BlockStartup);
