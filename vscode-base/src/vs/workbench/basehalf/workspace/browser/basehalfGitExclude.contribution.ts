/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ISCMRepository, ISCMService } from '../../../contrib/scm/common/scm.js';
import { baseHalfLeaveOutSystemFiles, baseHalfMayLeaveOutSystemFiles } from '../common/basehalfGitExclude.js';

/**
 * When Source Control finds a git repository, however it was made, the files
 * the system makes by itself go into its `info/exclude`
 * (Git/SCM/GitHub/GitGraph, "Files The System Makes", D115).
 */
export class BaseHalfGitExcludeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfGitExclude';

	constructor(
		@ISCMService scmService: ISCMService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		for (const repository of scmService.repositories) {
			void this.leaveOutSystemFiles(repository);
		}
		this._register(scmService.onDidAddRepository(repository => void this.leaveOutSystemFiles(repository)));
	}

	private async leaveOutSystemFiles(repository: ISCMRepository): Promise<void> {
		const root = repository.provider.rootUri;
		if (repository.provider.providerId !== 'git' || root?.scheme !== Schemas.file) {
			return;
		}
		try {
			const folders = this.contextService.getWorkspace().folders.map(folder => folder.uri);
			if (await baseHalfMayLeaveOutSystemFiles(this.fileService, root, folders)) {
				await baseHalfLeaveOutSystemFiles(this.fileService, root);
			}
		} catch (error) {
			this.logService.warn('[BaseHalf] could not add the files the system makes to a repository\'s exclude file', error);
		}
	}
}

registerWorkbenchContribution2(BaseHalfGitExcludeContribution.ID, BaseHalfGitExcludeContribution, WorkbenchPhase.AfterRestored);
