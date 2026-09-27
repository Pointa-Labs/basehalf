/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IBaseHalfReferenceIndexService } from '../common/basehalfReferenceIndex.js';
import './basehalfReferenceEditService.js';
import './basehalfReferenceRefactorService.js';
import './basehalfRenameRefactor.contribution.js';

/** Command id of **BaseHalf: Rebuild Upstream Index**. */
export const BASEHALF_REBUILD_UPSTREAM_INDEX_COMMAND_ID = 'basehalf.references.rebuildIndex';

/**
 * Starts the reference index build when the workbench has restored, so every
 * workspace folder begins in the `building` state on open. The index only
 * reads; it never creates or changes a workspace file.
 */
export class BaseHalfReferenceIndexContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfReferenceIndex';

	constructor(
		@IBaseHalfReferenceIndexService referenceIndexService: IBaseHalfReferenceIndexService
	) {
		super();
		void referenceIndexService;
	}
}

registerWorkbenchContribution2(BaseHalfReferenceIndexContribution.ID, BaseHalfReferenceIndexContribution, WorkbenchPhase.AfterRestored);

registerAction2(class BaseHalfRebuildUpstreamIndexAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_REBUILD_UPSTREAM_INDEX_COMMAND_ID,
			title: localize2('basehalf.references.rebuildIndex', 'Rebuild Upstream Index'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfReferenceIndexService).rebuild();
	}
});
