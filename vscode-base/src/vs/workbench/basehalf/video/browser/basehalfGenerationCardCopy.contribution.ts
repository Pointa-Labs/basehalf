/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkingCopyFileService, SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { createBaseHalfGenerationTaskId } from '../common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardStore } from '../common/basehalfVideoGeneration.js';
import { copyBaseHalfGenerationCardInformation } from './basehalfGenerationCardCopy.js';

/**
 * A copy of a generation card through the workbench, in Files, on the canvas,
 * or by an extension, is a generation card too (generation cards, "Moving,
 * renaming, copying, and undo"): once the files are copied, and before the
 * copy's listeners run, each copy gets the card information of what it
 * copies.
 */
export class BaseHalfGenerationCardCopyContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.generationCardCopy';

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfGenerationCardStore private readonly cardStore: IBaseHalfGenerationCardStore,
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
					didRun: completedFiles => this.copyCardInformation(completedFiles),
					// The pairs that were copied before the copy failed are copies all the same.
					didFail: completedFiles => this.copyCardInformation(completedFiles),
					dispose: () => undefined
				};
			}
		}));
	}

	private async copyCardInformation(completedFiles: readonly SourceTargetPair[]): Promise<void> {
		const { failed } = await copyBaseHalfGenerationCardInformation({
			fileService: this.fileService,
			workspaceContextService: this.workspaceContextService,
			uriIdentityService: this.uriIdentityService,
			cardStore: this.cardStore,
			logService: this.logService
		}, completedFiles, () => createBaseHalfGenerationTaskId(Date.now(), generateUuid));
		// The files are copied either way: a copy that did not get its card information is a plain file.
		if (failed.length) {
			this.notificationService.warn(failed.length === 1
				? localize('basehalf.generation.copy.failedOne', "BaseHalf could not copy the prompt and settings of {0}.", basename(failed[0]))
				: localize('basehalf.generation.copy.failedMany', "BaseHalf could not copy the prompt and settings of {0} cards.", failed.length));
		}
	}
}

registerWorkbenchContribution2(BaseHalfGenerationCardCopyContribution.ID, BaseHalfGenerationCardCopyContribution, WorkbenchPhase.AfterRestored);
