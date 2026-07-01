/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { IContextKey, IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { GoFilter, IHistoryService } from '../../services/history/common/history.js';
import { IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';

class BaseHalfNavigationContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.navigation';

	private readonly canNavigateBack: IContextKey<boolean>;
	private readonly canNavigateForward: IContextKey<boolean>;

	constructor(
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();

		this.canNavigateBack = contextKeyService.createKey<boolean>('canNavigateBack', false);
		this.canNavigateForward = contextKeyService.createKey<boolean>('canNavigateForward', false);

		this._register(CommandsRegistry.registerCommand('workbench.action.navigateBack', async accessor => {
			const navigationService = accessor.get(IBaseHalfCanvasNavigationService);
			if (await navigationService.goBack()) {
				return;
			}

			await accessor.get(IHistoryService).goBack(GoFilter.NONE);
		}));

		this._register(CommandsRegistry.registerCommand('workbench.action.navigateForward', async accessor => {
			const navigationService = accessor.get(IBaseHalfCanvasNavigationService);
			if (await navigationService.goForward()) {
				return;
			}

			await accessor.get(IHistoryService).goForward(GoFilter.NONE);
		}));

		this._register(this.canvasNavigationService.onDidChangeState(() => this.updateContextKeys()));
		this.updateContextKeys();
	}

	private updateContextKeys(): void {
		this.canNavigateBack.set(this.canvasNavigationService.canGoBack);
		this.canNavigateForward.set(this.canvasNavigationService.canGoForward);
	}
}

registerWorkbenchContribution2(BaseHalfNavigationContribution.ID, BaseHalfNavigationContribution, WorkbenchPhase.AfterRestored);
