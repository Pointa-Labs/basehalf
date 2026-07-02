/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { BaseHalfCanNavigateBackContext, BaseHalfCanNavigateForwardContext, IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';

class BaseHalfNavigationContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.navigation';

	private readonly canNavigateBack: IContextKey<boolean>;
	private readonly canNavigateForward: IContextKey<boolean>;

	constructor(
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();

		this.canNavigateBack = this.contextKeyService.createKey<boolean>(BaseHalfCanNavigateBackContext, false);
		this.canNavigateForward = this.contextKeyService.createKey<boolean>(BaseHalfCanNavigateForwardContext, false);

		this._register(this.canvasNavigationService.onDidChangeState(() => this.updateContextKeys()));
		this.updateContextKeys();
	}

	private updateContextKeys(): void {
		this.canNavigateBack.set(this.canvasNavigationService.canGoBack);
		this.canNavigateForward.set(this.canvasNavigationService.canGoForward);
	}
}

registerWorkbenchContribution2(BaseHalfNavigationContribution.ID, BaseHalfNavigationContribution, WorkbenchPhase.AfterRestored);
