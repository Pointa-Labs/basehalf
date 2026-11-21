/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { BASEHALF_SETTINGS_WITHOUT_CLASS_LOG, baseHalfSettingsWithoutClass } from '../common/basehalfSettingsCatalogCheck.js';

/**
 * Names, in the window's log, every setting that the base or a shipped extension registers and the catalog gives
 * no class (the settings BaseHalf offers, criterion 1). Such a setting is listed as an advanced one until it is
 * classified; the smoke fails on the line, so a base update classifies its new settings before it ships.
 */
class BaseHalfSettingsCatalogContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfSettingsCatalog';

	constructor(
		@IExtensionService extensionService: IExtensionService,
		@ILogService logService: ILogService
	) {
		// The settings of the extensions are registered once the extensions are.
		void extensionService.whenInstalledExtensionsRegistered().then(() => {
			const without = baseHalfSettingsWithoutClass(Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties());
			if (without.length) {
				logService.warn(`${BASEHALF_SETTINGS_WITHOUT_CLASS_LOG} ${without.join(', ')}`);
			}
		});
	}
}

registerWorkbenchContribution2(BaseHalfSettingsCatalogContribution.ID, BaseHalfSettingsCatalogContribution, WorkbenchPhase.Eventually);
