/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfAgentSessionKind, baseHalfAgentSessionChoiceForKind } from './basehalfAgentArea.js';

export const BaseHalfSetting = {
	EditorReadingMode: 'basehalf.editor.readingMode',
	CanvasDefaultZoom: 'basehalf.canvas.defaultZoom',
	AgentDefaultSession: 'basehalf.agent.defaultSession'
} as const;
export type BaseHalfSetting = typeof BaseHalfSetting[keyof typeof BaseHalfSetting];

export const BASEHALF_LEGACY_READING_MODE_SETTING = 'editor.readingMode';

export const BASEHALF_CANVAS_MIN_ZOOM = 0.25;
export const BASEHALF_CANVAS_MAX_ZOOM = 2;
export const BASEHALF_CANVAS_DEFAULT_ZOOM = 1;

export const BASEHALF_AGENT_DEFAULT_SESSION: BaseHalfAgentSessionKind = 'tui-codex';

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
