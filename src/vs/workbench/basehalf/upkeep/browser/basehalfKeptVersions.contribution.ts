/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IBaseHalfKeptVersionsService } from './basehalfKeptVersions.js';

/**
 * Sends to the Trash what windows that are gone left in the kept versions
 * (exact undo, "When the kept versions go to the Trash"), when the window
 * opens and when a workspace folder is added. The service renews its own
 * mark and sweeps again every minute after that.
 */
class BaseHalfKeptVersionsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfKeptVersions';

	constructor(
		@IBaseHalfKeptVersionsService keptVersions: IBaseHalfKeptVersionsService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@ILogService logService: ILogService
	) {
		super();
		const sweep = () => void keptVersions.sweep().catch(error => logService.warn('[BaseHalf] could not sweep the kept versions', error));
		sweep();
		this._register(contextService.onDidChangeWorkspaceFolders(sweep));
	}
}

registerWorkbenchContribution2(BaseHalfKeptVersionsContribution.ID, BaseHalfKeptVersionsContribution, WorkbenchPhase.Eventually);
