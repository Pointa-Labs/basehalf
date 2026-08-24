/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { FileOperation, IFileService } from '../../../platform/files/common/files.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IWorkingCopyFileService } from '../../services/workingCopy/common/workingCopyFileService.js';
import { forkCopiedBaseHalfNodeTrees, forkPartiallyCopiedBaseHalfNodeTrees, prepareBaseHalfNodeCopyPlans } from './basehalfNodeCopy.js';

class BaseHalfNodeFileOperationsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.nodeFileOperations';

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IFileService private readonly fileService: IFileService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: async (files, operation) => {
				if (operation !== FileOperation.COPY) {
					return;
				}
				const plans = await prepareBaseHalfNodeCopyPlans(this.fileService, files);
				return {
					didRun: completedFiles => this.finalizeCopy(plans, completedFiles),
					didFail: completedFiles => this.finalizePartialCopy(plans, completedFiles),
					dispose: () => undefined
				};
			}
		}));
	}

	private async finalizeCopy(
		plans: Parameters<typeof forkCopiedBaseHalfNodeTrees>[1],
		completedFiles: Parameters<typeof forkCopiedBaseHalfNodeTrees>[2]
	): Promise<void> {
		const forked = await forkCopiedBaseHalfNodeTrees(this.fileService, plans, completedFiles);
		if (forked.length > 0) {
			this.notificationService.info(forked.length === 1
				? 'Copied node settings into a new Draft. Connections, Result, and Attempts start empty.'
				: `Copied ${forked.length} node settings into new Drafts. Connections, Results, and Attempts start empty.`);
		}
	}

	private async finalizePartialCopy(
		plans: Parameters<typeof forkPartiallyCopiedBaseHalfNodeTrees>[1],
		completedFiles: Parameters<typeof forkPartiallyCopiedBaseHalfNodeTrees>[2]
	): Promise<void> {
		await forkPartiallyCopiedBaseHalfNodeTrees(this.fileService, plans, completedFiles);
	}
}

registerWorkbenchContribution2(BaseHalfNodeFileOperationsContribution.ID, BaseHalfNodeFileOperationsContribution, WorkbenchPhase.AfterRestored);
