/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUpdateService } from '../../../../platform/update/common/update.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { settingsCustomSectionRegistry } from '../../../contrib/preferences/browser/settingsCustomSections.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { BASEHALF_ABOUT_SETTINGS_SECTION_ID, BASEHALF_OPEN_ABOUT_COMMAND_ID, baseHalfUpdateCheckFailure } from '../common/basehalfAbout.js';
import { BaseHalfAboutView } from './basehalfAbout.js';

settingsCustomSectionRegistry.register({
	id: BASEHALF_ABOUT_SETTINGS_SECTION_ID,
	create: instantiationService => instantiationService.createInstance(BaseHalfAboutView)
});

registerAction2(class OpenBaseHalfAboutAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_OPEN_ABOUT_COMMAND_ID,
			title: localize2('basehalf.about.open', "About BaseHalf"),
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		// Settings opens on the page itself (settings pages, "Opening Settings at a page").
		await accessor.get(IPreferencesService).openSettings({ jsonEditor: false, customSection: { id: BASEHALF_ABOUT_SETTINGS_SECTION_ID } });
	}
});

/**
 * A check that the user asked for and that failed is told in a notification
 * (app update, "Where an update shows"), once: every window hears it, and the
 * window the user last worked in tells it, as the base told it in the card of
 * the title bar's entry, which BaseHalf does not have.
 */
export class BaseHalfUpdateCheckFailureContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.updateCheckFailure';

	constructor(
		@IUpdateService updateService: IUpdateService,
		@INotificationService notificationService: INotificationService,
		@IHostService hostService: IHostService
	) {
		super();
		this._register(updateService.onStateChange(async state => {
			const failure = baseHalfUpdateCheckFailure(state);
			if (failure && await hostService.hadLastFocus()) {
				notificationService.error(localize('basehalf.about.checkFailed', "BaseHalf could not check for updates. {0}", failure));
			}
		}));
	}
}

registerWorkbenchContribution2(BaseHalfUpdateCheckFailureContribution.ID, BaseHalfUpdateCheckFailureContribution, WorkbenchPhase.AfterRestored);
