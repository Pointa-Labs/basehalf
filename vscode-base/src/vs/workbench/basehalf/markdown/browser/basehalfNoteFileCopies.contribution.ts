/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkingCopyFileService, SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { baseHalfCopyNoteFiles } from '../common/basehalfNoteFileCopies.js';

/**
 * A copy of notes through the workbench, in Files or on the canvas, gives
 * each copied note its own folder of clones of its files (files in notes,
 * rule 33): once the files are copied and before the copy resolves, so that
 * no editor holds a copy whose links name the original's files.
 */
export class BaseHalfNoteFileCopiesContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.noteFileCopies';

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfFileClonesService private readonly fileClonesService: IBaseHalfFileClonesService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: async (_files, operation) => {
				if (operation !== FileOperation.COPY) {
					return;
				}
				return {
					didRun: completedFiles => this.copyFiles(completedFiles),
					// The pairs that were copied before the copy failed are copies all the same.
					didFail: completedFiles => this.copyFiles(completedFiles),
					dispose: () => undefined
				};
			}
		}));
	}

	private async copyFiles(completedFiles: readonly SourceTargetPair[]): Promise<void> {
		let failed;
		try {
			failed = await baseHalfCopyNoteFiles({
				fileService: this.fileService,
				fileClonesService: this.fileClonesService,
				workspaceFolderOf: resource => this.workspaceContextService.getWorkspaceFolder(resource)?.uri
			}, completedFiles);
		} catch (error) {
			this.logService.error('[BaseHalf] the files of copied notes could not be copied', error);
			return;
		}
		// A copy whose files could not be cloned links the original's files (rule 33).
		if (failed.length) {
			this.notificationService.warn(failed.length === 1
				? localize('basehalf.noteFiles.copy.failedOne', "BaseHalf could not copy the files of {0}: the copy shows the files of the note it copies.", basename(failed[0]))
				: localize('basehalf.noteFiles.copy.failedMany', "BaseHalf could not copy the files of {0} notes: the copies show the files of the notes they copy.", failed.length));
		}
	}
}

registerWorkbenchContribution2(BaseHalfNoteFileCopiesContribution.ID, BaseHalfNoteFileCopiesContribution, WorkbenchPhase.AfterRestored);
