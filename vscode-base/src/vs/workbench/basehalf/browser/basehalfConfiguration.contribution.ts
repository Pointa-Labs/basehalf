/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IConfigurationMigrationRegistry } from '../../common/configuration.js';
import {
	BASEHALF_AGENT_DEFAULT_SESSION,
	BASEHALF_CANVAS_DEFAULT_ZOOM,
	BASEHALF_CANVAS_MAX_ZOOM,
	BASEHALF_CANVAS_MIN_ZOOM,
	BASEHALF_LEGACY_READING_MODE_SETTING,
	BaseHalfSetting,
	migrateLegacyBaseHalfReadingMode
} from '../common/basehalfConfiguration.js';
import { BASEHALF_AGENT_SESSION_CHOICES } from '../common/basehalfAgentArea.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'basehalf',
	order: 1,
	title: localize('basehalfConfigurationTitle', 'BaseHalf'),
	type: 'object',
	properties: {
		[BaseHalfSetting.EditorReadingMode]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.RESOURCE,
			description: localize('basehalf.editor.readingMode', 'Controls whether BaseHalf ADHD reading aids are enabled in rich Markdown documents.')
		},
		[BaseHalfSetting.CanvasDefaultZoom]: {
			type: 'number',
			default: BASEHALF_CANVAS_DEFAULT_ZOOM,
			minimum: BASEHALF_CANVAS_MIN_ZOOM,
			maximum: BASEHALF_CANVAS_MAX_ZOOM,
			scope: ConfigurationScope.RESOURCE,
			description: localize('basehalf.canvas.defaultZoom', 'Controls the initial BaseHalf canvas zoom when a folder has no saved focus mirror.')
		},
		[BaseHalfSetting.AgentDefaultSession]: {
			type: 'string',
			default: BASEHALF_AGENT_DEFAULT_SESSION,
			enum: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.kind),
			enumItemLabels: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.label),
			enumDescriptions: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.description),
			scope: ConfigurationScope.WINDOW,
			description: localize('basehalf.agent.defaultSession', 'Controls which Agent Area session is created when the Agent Area is opened with no active sessions.')
		}
	}
});

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: BASEHALF_LEGACY_READING_MODE_SETTING,
		migrateFn: (value, accessor) => migrateLegacyBaseHalfReadingMode(value, accessor(BaseHalfSetting.EditorReadingMode))
	}]);
