/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkingCopyFileService, SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { copyBaseHalfMediaEdits } from './basehalfMediaEditCopy.js';
import { BaseHalfMediaEditService, IBaseHalfMediaEditService } from './basehalfMediaEditService.js';

// Editing media: the service that saves the edits of Card Detail's edit mode, saves them as new files, and reverts them.
registerSingleton(IBaseHalfMediaEditService, BaseHalfMediaEditService, InstantiationType.Delayed);

/**
 * A copy of an edited file through the workbench, in Files, on the canvas, or
 * by an extension, can be reverted as the file can (editing media, "Copies,
 * deletes, and the Trash"): once the files are copied, each copy gets the
 * original and the edit record of what it copies.
 */
export class BaseHalfMediaEditCopyContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.mediaEditCopy';

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfFileClonesService private readonly fileClonesService: IBaseHalfFileClonesService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
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
					didRun: completedFiles => this.copyEdits(completedFiles),
					// The pairs that were copied before the copy failed are copies all the same.
					didFail: completedFiles => this.copyEdits(completedFiles),
					dispose: () => undefined
				};
			}
		}));
	}

	private async copyEdits(completedFiles: readonly SourceTargetPair[]): Promise<void> {
		const failed = await copyBaseHalfMediaEdits({
			fileService: this.fileService,
			fileClonesService: this.fileClonesService,
			workspaceContextService: this.workspaceContextService,
			uriIdentityService: this.uriIdentityService,
			logService: this.logService
		}, completedFiles);
		// The files are copied either way: a copy without its original is an ordinary file.
		if (failed.length) {
			this.notificationService.warn(failed.length === 1
				? localize('basehalf.mediaEdit.copy.failedOne', "BaseHalf could not copy the original of {0}: the copy can't be reverted.", basename(failed[0]))
				: localize('basehalf.mediaEdit.copy.failedMany', "BaseHalf could not copy the originals of {0} files: the copies can't be reverted.", failed.length));
		}
	}
}

registerWorkbenchContribution2(BaseHalfMediaEditCopyContribution.ID, BaseHalfMediaEditCopyContribution, WorkbenchPhase.AfterRestored);
