/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IConfigurationMigrationRegistry } from '../../common/configuration.js';
import {
	BASEHALF_CONFIGURATION_NODE,
	BASEHALF_LEGACY_READING_MODE_SETTING,
	BaseHalfSetting,
	migrateLegacyBaseHalfModelServices,
	migrateLegacyBaseHalfReadingMode
} from '../common/basehalfConfiguration.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(BASEHALF_CONFIGURATION_NODE);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: BASEHALF_LEGACY_READING_MODE_SETTING,
		migrateFn: (value, accessor) => migrateLegacyBaseHalfReadingMode(value, accessor(BaseHalfSetting.EditorReadingMode))
	}, {
		key: BaseHalfSetting.ModelServices,
		migrateFn: value => migrateLegacyBaseHalfModelServices(value)
	}]);
