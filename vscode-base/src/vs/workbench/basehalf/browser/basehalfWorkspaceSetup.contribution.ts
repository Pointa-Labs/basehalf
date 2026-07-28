/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IBaseHalfWorkspaceSetupService } from '../common/basehalfWorkspaceSetup.js';

/**
 * Runs BaseHalf workspace setup for every opened workspace folder: agent hints
 * in CLAUDE.md/AGENTS.md, the `.bh/agent-harness/` docs, and the `.bh/cache/`
 * gitignore policy. A tracked `.basehalf-no-workspace-setup` marker opts a
 * repository out before any write. Idempotent per open — an already-current
 * workspace is a no-op — and best-effort: a setup failure must never block the
 * workbench.
 */
class BaseHalfWorkspaceSetupContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.workspaceSetup';

	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IBaseHalfWorkspaceSetupService private readonly setupService: IBaseHalfWorkspaceSetupService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._register(contextService.onDidChangeWorkspaceFolders(event => {
			for (const added of event.added) {
				this.run(added.uri);
			}
		}));

		for (const folder of contextService.getWorkspace().folders) {
			this.run(folder.uri);
		}
	}

	private run(workspaceFolder: URI): void {
		this.setupService.ensureSetup(workspaceFolder).then(report => {
			if (report.claudeMdUpdated || report.agentsMdUpdated || report.agentHarnessUpdated || report.gitignoreUpdated) {
				this.logService.info(`BaseHalf workspace setup refreshed ${workspaceFolder.toString()}: ${JSON.stringify(report)}`);
			}
		}, error => {
			this.logService.error('BaseHalf workspace setup failed', error);
		});
	}
}

registerWorkbenchContribution2(BaseHalfWorkspaceSetupContribution.ID, BaseHalfWorkspaceSetupContribution, WorkbenchPhase.AfterRestored);
