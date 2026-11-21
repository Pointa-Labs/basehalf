/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';
import { BASEHALF_AGENT_SESSION_CHOICES, BaseHalfAgentSessionKind, baseHalfAgentSessionChoiceForKind } from '../../agentArea/common/basehalfAgentArea.js';
import { BASEHALF_FILES_SHOW_HIDDEN_FOLDER_SETTING } from '../../workspace/common/basehalfBhFolder.js';

export const BaseHalfSetting = {
	EditorReadingMode: 'basehalf.editor.readingMode',
	CanvasDefaultZoom: 'basehalf.canvas.defaultZoom',
	FilesShowHiddenFolder: BASEHALF_FILES_SHOW_HIDDEN_FOLDER_SETTING,
	AgentDefaultSession: 'basehalf.agent.defaultSession',
	AgentsOfferSkill: 'basehalf.agents.offerSkill'
} as const;
export type BaseHalfSetting = typeof BaseHalfSetting[keyof typeof BaseHalfSetting];

export const BASEHALF_LEGACY_READING_MODE_SETTING = 'editor.readingMode';

export const BASEHALF_CANVAS_MIN_ZOOM = 0.2;
export const BASEHALF_CANVAS_MAX_ZOOM = 4;
export const BASEHALF_CANVAS_DEFAULT_ZOOM = 1;
/** The canvas fits a folder it has no view of at most at 100%: a larger value of the setting would change nothing. */
export const BASEHALF_CANVAS_DEFAULT_ZOOM_MAX = 1;

export const BASEHALF_AGENT_DEFAULT_SESSION: BaseHalfAgentSessionKind = 'tui-codex';

/** The tag of every BaseHalf setting: `@tag:basehalf` lists them in the advanced list. */
export const BASEHALF_SETTINGS_TAG = 'basehalf';

// Exported so tests can restore BaseHalf settings after platform suites reset
// the shared configuration registry.
export const BASEHALF_CONFIGURATION_NODE: IConfigurationNode = {
	id: 'basehalf',
	order: 1,
	title: localize('basehalfConfigurationTitle', 'BaseHalf'),
	type: 'object',
	properties: {
		[BaseHalfSetting.EditorReadingMode]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.RESOURCE,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.editor.readingMode', 'Keywords stand out in notes, and a paragraph can be marked as read.')
		},
		[BaseHalfSetting.CanvasDefaultZoom]: {
			type: 'number',
			default: BASEHALF_CANVAS_DEFAULT_ZOOM,
			minimum: BASEHALF_CANVAS_MIN_ZOOM,
			maximum: BASEHALF_CANVAS_DEFAULT_ZOOM_MAX,
			scope: ConfigurationScope.RESOURCE,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.canvas.defaultZoom', 'The largest zoom at which a folder first shows all its cards, and at which a new card comes into view. 1 is 100%.')
		},
		[BaseHalfSetting.FilesShowHiddenFolder]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.RESOURCE,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.files.showHiddenFolder', 'Files shows the `.bh` folder, which holds the files of notes and the records of cards. Changing what it holds can lose them.')
		},
		[BaseHalfSetting.AgentDefaultSession]: {
			type: 'string',
			default: BASEHALF_AGENT_DEFAULT_SESSION,
			enum: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.kind),
			enumItemLabels: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.label),
			enumDescriptions: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.description),
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.agent.defaultSession', 'The session started when the Agent Area opens with no session.')
		},
		[BaseHalfSetting.AgentsOfferSkill]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.agents.offerSkill', 'BaseHalf offers to install its skill for agents. The skill tells agents what is selected and how cards connect.')
		}
	}
};

export type BaseHalfConfigurationMigrationValue = { readonly value: unknown };
export type BaseHalfConfigurationMigrationPairs = [string, BaseHalfConfigurationMigrationValue][];

export function normalizeBaseHalfCanvasZoom(value: unknown, fallback = BASEHALF_CANVAS_DEFAULT_ZOOM): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	return Math.min(BASEHALF_CANVAS_MAX_ZOOM, Math.max(BASEHALF_CANVAS_MIN_ZOOM, numeric));
}

export function isBaseHalfAgentSessionKind(value: unknown): value is BaseHalfAgentSessionKind {
	if (typeof value !== 'string') {
		return false;
	}

	try {
		baseHalfAgentSessionChoiceForKind(value as BaseHalfAgentSessionKind);
		return true;
	} catch {
		return false;
	}
}

export function normalizeBaseHalfAgentDefaultSession(value: unknown): BaseHalfAgentSessionKind {
	return isBaseHalfAgentSessionKind(value) ? value : BASEHALF_AGENT_DEFAULT_SESSION;
}

export function migrateLegacyBaseHalfReadingMode(value: unknown, existingReadingMode: unknown): BaseHalfConfigurationMigrationPairs {
	if (typeof value !== 'boolean') {
		return [];
	}

	const next: BaseHalfConfigurationMigrationPairs = [];
	if (existingReadingMode === undefined) {
		next.push([BaseHalfSetting.EditorReadingMode, { value }]);
	}
	next.push([BASEHALF_LEGACY_READING_MODE_SETTING, { value: undefined }]);
	return next;
}
