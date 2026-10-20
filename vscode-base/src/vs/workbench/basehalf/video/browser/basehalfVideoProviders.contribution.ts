/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './basehalfVideoCatalogService.js';
import './basehalfVideoGenerationService.js';
import './basehalfVideoProviderSettingsService.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { settingsCustomSectionRegistry } from '../../../contrib/preferences/browser/settingsCustomSections.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { BASEHALF_VIDEO_PROVIDERS_COMMAND_ID, BASEHALF_VIDEO_PROVIDERS_SETTINGS_SECTION_ID } from '../common/basehalfVideoProviderSettings.js';
import { BaseHalfVideoProvidersPage } from './basehalfVideoProvidersPage.js';

/**
 * The Video Providers page (D59), in the place of the former Models &
 * Providers page of Settings, and the command that opens it. The catalog,
 * provider settings, and generation services register themselves in the
 * modules imported above.
 */
settingsCustomSectionRegistry.register({
	id: BASEHALF_VIDEO_PROVIDERS_SETTINGS_SECTION_ID,
	create: instantiationService => instantiationService.createInstance(BaseHalfVideoProvidersPage)
});

registerAction2(class OpenBaseHalfVideoProvidersAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_VIDEO_PROVIDERS_COMMAND_ID,
			title: localize2('basehalf.video.providers.open', "Video Providers"),
			category: localize2('basehalf.category', "BaseHalf"),
			f1: true,
			menu: {
				id: MenuId.MenubarPreferencesMenu,
				group: '2_configuration',
				order: 20
			}
		});
	}

	/** With a provider id of the catalog, the page shows that provider. */
	override async run(accessor: ServicesAccessor, providerId?: unknown): Promise<void> {
		const preferencesService = accessor.get(IPreferencesService);
		await preferencesService.openSettings({ jsonEditor: false });
		settingsCustomSectionRegistry.request(BASEHALF_VIDEO_PROVIDERS_SETTINGS_SECTION_ID, typeof providerId === 'string' ? providerId : undefined);
	}
});
