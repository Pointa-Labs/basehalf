/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, ViewContainer } from '../../common/views.js';
import { BASEHALF_PRODUCT_PROFILE_ID, shouldBaseHalfHideViewContainer } from '../common/basehalfWorkbenchProfile.js';

class BaseHalfWorkbenchProfileContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfWorkbenchProfile';

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();

		const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		this.enforceHiddenViewContainers(viewContainersRegistry);
		this._register(viewContainersRegistry.onDidRegister(({ viewContainer }) => this.enforceHiddenViewContainer(viewContainersRegistry, viewContainer)));
	}

	private enforceHiddenViewContainers(viewContainersRegistry: IViewContainersRegistry): void {
		for (const viewContainer of [...viewContainersRegistry.all]) {
			this.enforceHiddenViewContainer(viewContainersRegistry, viewContainer);
		}
	}

	private enforceHiddenViewContainer(viewContainersRegistry: IViewContainersRegistry, viewContainer: ViewContainer): void {
		if (!shouldBaseHalfHideViewContainer(viewContainer.id)) {
			return;
		}

		viewContainersRegistry.deregisterViewContainer(viewContainer);
		this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] hidden view container deregistered: ${viewContainer.id}`);
	}
}

registerWorkbenchContribution2(BaseHalfWorkbenchProfileContribution.ID, BaseHalfWorkbenchProfileContribution, WorkbenchPhase.BlockStartup);
