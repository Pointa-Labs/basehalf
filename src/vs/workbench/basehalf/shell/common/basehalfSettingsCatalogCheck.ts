/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../../base/common/collections.js';
import { baseHalfSettingRule } from '../../../../platform/configuration/common/basehalfSettingsCatalog.js';
import { IRegisteredConfigurationPropertySchema, OVERRIDE_PROPERTY_REGEX } from '../../../../platform/configuration/common/configurationRegistry.js';
import { BASEHALF_PACKAGED_EXTENSION_IDS } from './basehalfBuiltInExtensions.js';

/** What the window writes to its log, followed by the names, when a registered setting has no class. */
export const BASEHALF_SETTINGS_WITHOUT_CLASS_LOG = '[BaseHalf] settings without a class:';

/**
 * The registered settings that no rule of the catalog names (the settings BaseHalf offers, criterion 1): the
 * settings of the base and of the extensions that ship. A setting of an extension the user installed has no rule
 * and needs none, and a section of a language (`[markdown]`) is no setting.
 */
export function baseHalfSettingsWithoutClass(properties: IStringDictionary<IRegisteredConfigurationPropertySchema>): string[] {
	const without: string[] = [];
	for (const key of Object.keys(properties)) {
		if (OVERRIDE_PROPERTY_REGEX.test(key) || baseHalfSettingRule(key)) {
			continue;
		}
		const source = properties[key].source;
		const extensionId = typeof source === 'string' ? undefined : source?.id;
		if (extensionId === undefined || BASEHALF_PACKAGED_EXTENSION_IDS.has(extensionId.toLowerCase())) {
			without.push(key);
		}
	}
	return without.sort();
}
