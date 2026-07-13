/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IContextKey, IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { BaseHalfCanNavigateBackContext, BaseHalfCanNavigateForwardContext, BaseHalfSurfaceActiveContext, IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';

class BaseHalfNavigationContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.navigation';

	private readonly canNavigateBack: IContextKey<boolean>;
	private readonly canNavigateForward: IContextKey<boolean>;
	private readonly surfaceActive: IContextKey<boolean>;

	constructor(
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();

		this.canNavigateBack = this.contextKeyService.createKey<boolean>(BaseHalfCanNavigateBackContext, false);
		this.canNavigateForward = this.contextKeyService.createKey<boolean>(BaseHalfCanNavigateForwardContext, false);
		this.surfaceActive = this.contextKeyService.createKey<boolean>(BaseHalfSurfaceActiveContext, false);

		this._register(this.canvasNavigationService.onDidChangeState(() => this.updateContextKeys()));
		this._register(this.canvasNavigationService.onDidChangeSurfaceActive(() => this.updateContextKeys()));
		this.updateContextKeys();
	}

	private updateContextKeys(): void {
		this.surfaceActive.set(this.canvasNavigationService.isSurfaceActive);
		this.canNavigateBack.set(this.canvasNavigationService.isSurfaceActive && this.canvasNavigationService.canGoBack);
		this.canNavigateForward.set(this.canvasNavigationService.isSurfaceActive && this.canvasNavigationService.canGoForward);
	}
}

registerWorkbenchContribution2(BaseHalfNavigationContribution.ID, BaseHalfNavigationContribution, WorkbenchPhase.AfterRestored);

registerAction2(class BaseHalfOpenResourceApiAction extends Action2 {
	constructor() {
		super({ id: 'basehalf.openResource', title: { value: 'Open in BaseHalf', original: 'Open in BaseHalf' } });
	}

	override async run(accessor: ServicesAccessor, resource: unknown): Promise<void> {
		const revived = URI.revive(resource as URI | undefined);
		if (!revived) {
			throw new Error('basehalf.openResource requires a URI argument.');
		}
		await accessor.get(IBaseHalfCanvasNavigationService).openResource(revived, { source: 'api', pinned: true });
	}
});
