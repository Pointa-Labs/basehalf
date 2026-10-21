/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';
import { BASEHALF_AGENT_SESSION_CHOICES, BaseHalfAgentSessionKind, baseHalfAgentSessionChoiceForKind } from '../../agentArea/common/basehalfAgentArea.js';

export const BaseHalfSetting = {
	EditorReadingMode: 'basehalf.editor.readingMode',
	AttachmentsDirectory: 'basehalf.editor.attachmentsDirectory',
	CanvasDefaultZoom: 'basehalf.canvas.defaultZoom',
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

/**
 * The values Settings accepts as the attachments folder: the rule of
 * `parseBaseHalfAttachmentsDirectory`, which puts files into `attachments`
 * for any other value. A folder inside the note's folder, with `/` or `\`
 * between its parts, `./` before it and slashes after it allowed; no part is
 * `.` or `..`, ends with a dot or a space, is longer than 160 characters,
 * holds a control character or one of `< > : " | ? *`, or is a name Windows
 * keeps for itself (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9, also with
 * an extension). Settings compiles it with the `u` flag.
 */
export const BASEHALF_ATTACHMENTS_DIRECTORY_PATTERN = (() => {
	const separator = String.raw`[\\/]`;
	const character = String.raw`[^\\/\u0000-\u001f<>:"|?*]`;
	const last = String.raw`[^\\/\u0000-\u001f<>:"|?*. ]`;
	const partEnds = String.raw`(?:${separator}|\s*$)`;
	const dots = String.raw`(?!\.\.?${partEnds})`;
	const reserved = String.raw`(?!(?:[cC][oO][nN]|[pP][rR][nN]|[aA][uU][xX]|[nN][uU][lL]|[cC][oO][mM][1-9]|[lL][pP][tT][1-9])(?:\.[^\\/]*)?${partEnds})`;
	const part = `${dots}${reserved}${character}{0,159}${last}`;
	// The rule trims the value before it takes off `./`: spaces before the first part are not part of it.
	return String.raw`^\s*(?:\.${separator}|(?!\s))${part}(?:${separator}${part})*${separator}*\s*$`;
})();

/**
 * The tag of every BaseHalf setting. The welcome page's Open BaseHalf Settings
 * searches Settings for it (`@tag:basehalf`).
 */
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
			description: localize('basehalf.editor.readingMode', 'Controls whether BaseHalf ADHD reading aids are enabled in rich Markdown documents.')
		},
		[BaseHalfSetting.AttachmentsDirectory]: {
			type: 'string',
			default: 'attachments',
			pattern: BASEHALF_ATTACHMENTS_DIRECTORY_PATTERN,
			patternErrorMessage: localize('basehalf.editor.attachmentsDirectory.invalid', 'Enter a folder inside the note\'s folder, such as attachments or media/images. A part of it cannot be . or .., end with a dot or a space, or contain < > : " | ? *. Until then, files go to attachments.'),
			scope: ConfigurationScope.RESOURCE,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.editor.attachmentsDirectory', 'Controls the folder, relative to a Markdown document, where files inserted from the rich editor are stored.')
		},
		[BaseHalfSetting.CanvasDefaultZoom]: {
			type: 'number',
			default: BASEHALF_CANVAS_DEFAULT_ZOOM,
			minimum: BASEHALF_CANVAS_MIN_ZOOM,
			maximum: BASEHALF_CANVAS_DEFAULT_ZOOM_MAX,
			scope: ConfigurationScope.RESOURCE,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.canvas.defaultZoom', 'The largest zoom at which the canvas first shows a folder that has no saved view on this computer, and frames cards you create: it fits the cards at this zoom or smaller. 1 is 100%.')
		},
		[BaseHalfSetting.AgentDefaultSession]: {
			type: 'string',
			default: BASEHALF_AGENT_DEFAULT_SESSION,
			enum: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.kind),
			enumItemLabels: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.label),
			enumDescriptions: BASEHALF_AGENT_SESSION_CHOICES.map(choice => choice.description),
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.agent.defaultSession', 'Controls which Agent Area session is created when the Agent Area is opened with no active sessions.')
		},
		[BaseHalfSetting.AgentsOfferSkill]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.agents.offerSkill', 'Controls whether BaseHalf offers to install its skill for your agents when you open a folder. The skill tells agents such as Claude Code and Codex where a card\'s description and connections are.')
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
