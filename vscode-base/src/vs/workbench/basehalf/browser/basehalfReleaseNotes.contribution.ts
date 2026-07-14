/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import { MenuId, registerAction2, Action2 } from '../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import product from '../../../platform/product/common/product.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { showLocalReleaseNotesInEditor } from '../../contrib/update/browser/update.js';
import { IBrowserWorkbenchEnvironmentService } from '../../services/environment/browser/environmentService.js';
import { IHostService } from '../../services/host/browser/host.js';
import { BASEHALF_RELEASE_NOTES_COMMAND_ID, getBaseHalfReleaseNotesMarkdown, shouldShowBaseHalfReleaseNotes } from '../common/basehalfReleaseNotes.js';

class ShowBaseHalfReleaseNotesAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_RELEASE_NOTES_COMMAND_ID,
			title: {
				...localize2('basehalf.showReleaseNotes', "Show Release Notes"),
				mnemonicTitle: localize({ key: 'basehalf.mshowReleaseNotes', comment: ['&& denotes a mnemonic'] }, "Show &&Release Notes"),
			},
			category: { value: product.nameShort, original: product.nameShort },
			f1: true,
			menu: [{
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 5,
			}]
		});
	}

	async run(accessor: ServicesAccessor, version?: string): Promise<void> {
		const instantiationService = accessor.get(IInstantiationService);
		const productService = accessor.get(IProductService);
		const targetVersion = version ?? productService.basehalfVersion ?? productService.version;
		await showLocalReleaseNotesInEditor(instantiationService, targetVersion, getBaseHalfReleaseNotesMarkdown(targetVersion));
	}
}

class BaseHalfReleaseNotesContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfReleaseNotes';
	private static readonly LAST_VERSION_STORAGE_KEY = 'basehalf.releaseNotes.lastVersion';

	constructor(
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@IHostService hostService: IHostService,
		@IProductService productService: IProductService,
		@ILogService logService: ILogService,
	) {
		const currentVersion = productService.basehalfVersion ?? productService.version;
		const previousVersion = storageService.get(BaseHalfReleaseNotesContribution.LAST_VERSION_STORAGE_KEY, StorageScope.APPLICATION);
		storageService.store(BaseHalfReleaseNotesContribution.LAST_VERSION_STORAGE_KEY, currentVersion, StorageScope.APPLICATION, StorageTarget.MACHINE);
		if (!shouldShowBaseHalfReleaseNotes(previousVersion, currentVersion)
			|| environmentService.skipReleaseNotes
			|| configurationService.getValue<boolean>('update.showReleaseNotes') === false) {
			return;
		}
		void hostService.hadLastFocus().then(hadLastFocus => {
			if (hadLastFocus) {
				return showLocalReleaseNotesInEditor(instantiationService, currentVersion, getBaseHalfReleaseNotesMarkdown(currentVersion));
			}
			return undefined;
		}).catch(error => logService.warn('Unable to show BaseHalf release notes after update.', error));
	}
}

if (!product.releaseNotesUrl) {
	registerAction2(ShowBaseHalfReleaseNotesAction);
	registerWorkbenchContribution2(BaseHalfReleaseNotesContribution.ID, BaseHalfReleaseNotesContribution, WorkbenchPhase.AfterRestored);
}
