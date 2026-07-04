/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { ConfigurationScope, IConfigurationNode } from '../../../platform/configuration/common/configurationRegistry.js';
import { BASEHALF_AGENT_SESSION_CHOICES, BaseHalfAgentSessionKind, baseHalfAgentSessionChoiceForKind } from './basehalfAgentArea.js';

export const BaseHalfSetting = {
	EditorReadingMode: 'basehalf.editor.readingMode',
	CanvasDefaultZoom: 'basehalf.canvas.defaultZoom',
	AgentDefaultSession: 'basehalf.agent.defaultSession'
} as const;
export type BaseHalfSetting = typeof BaseHalfSetting[keyof typeof BaseHalfSetting];

export const BASEHALF_LEGACY_READING_MODE_SETTING = 'editor.readingMode';

export const BASEHALF_CANVAS_MIN_ZOOM = 0.2;
export const BASEHALF_CANVAS_MAX_ZOOM = 4;
export const BASEHALF_CANVAS_DEFAULT_ZOOM = 1;

export const BASEHALF_AGENT_DEFAULT_SESSION: BaseHalfAgentSessionKind = 'tui-codex';

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
