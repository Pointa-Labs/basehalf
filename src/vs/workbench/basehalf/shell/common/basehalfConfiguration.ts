/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';
import { BASEHALF_AGENT_SESSION_CHOICES, BaseHalfAgentSessionKind, baseHalfAgentSessionChoiceForKind } from '../../agentArea/common/basehalfAgentArea.js';
import { BASEHALF_NOTES_OPEN_IN_SETTING } from '../../cardDetail/common/basehalfCardDetail.js';
import { BASEHALF_FILES_SHOW_HIDDEN_FOLDER_SETTING } from '../../workspace/common/basehalfBhFolder.js';

export const BaseHalfSetting = {
	EditorReadingMode: 'basehalf.editor.readingMode',
	CanvasDefaultZoom: 'basehalf.canvas.defaultZoom',
	CanvasWheel: 'basehalf.canvas.wheel',
	CanvasSnap: 'basehalf.canvas.snap',
	CanvasBackground: 'basehalf.canvas.background',
	CanvasPlayVideosOnHover: 'basehalf.canvas.playVideosOnHover',
	NotesFontFamily: 'basehalf.notes.fontFamily',
	NotesFontSize: 'basehalf.notes.fontSize',
	NotesOpenIn: BASEHALF_NOTES_OPEN_IN_SETTING,
	FilesShowHiddenFolder: BASEHALF_FILES_SHOW_HIDDEN_FOLDER_SETTING,
	AgentDefaultSession: 'basehalf.agent.defaultSession',
	AgentRestoreSessions: 'basehalf.agent.restoreSessions',
	AgentsOfferSkill: 'basehalf.agents.offerSkill',
	AgentsShareSelection: 'basehalf.agents.shareSelection'
} as const;
export type BaseHalfSetting = typeof BaseHalfSetting[keyof typeof BaseHalfSetting];

export const BASEHALF_LEGACY_READING_MODE_SETTING = 'editor.readingMode';

export const BASEHALF_CANVAS_MIN_ZOOM = 0.2;
export const BASEHALF_CANVAS_MAX_ZOOM = 4;
export const BASEHALF_CANVAS_DEFAULT_ZOOM = 1;
/** The canvas fits a folder it has no view of at most at 100%: a larger value of the setting would change nothing. */
export const BASEHALF_CANVAS_DEFAULT_ZOOM_MAX = 1;

export const BASEHALF_AGENT_DEFAULT_SESSION: BaseHalfAgentSessionKind = 'tui-codex';

/** What a turn of the mouse wheel does on the canvas. */
export type BaseHalfCanvasWheel = 'pan' | 'zoom';
export const BASEHALF_CANVAS_WHEELS: readonly BaseHalfCanvasWheel[] = ['pan', 'zoom'];
/** What the canvas draws behind its cards. */
export type BaseHalfCanvasBackground = 'lines' | 'dots' | 'plain';
export const BASEHALF_CANVAS_BACKGROUNDS: readonly BaseHalfCanvasBackground[] = ['lines', 'dots', 'plain'];

/** The size of a note's text in Card Detail, in pixels at a zoom of 100%. */
export const BASEHALF_NOTES_FONT_SIZE = 16;
export const BASEHALF_NOTES_FONT_SIZE_MIN = 12;
export const BASEHALF_NOTES_FONT_SIZE_MAX = 28;
/** The fonts BaseHalf's Settings offers for a note beside the default; the setting takes any list of fonts. */
export const BASEHALF_NOTES_SERIF_FONT = 'Charter, \'Iowan Old Style\', Georgia, serif';
export const BASEHALF_NOTES_MONOSPACE_FONT = 'Menlo, Monaco, Consolas, monospace';
/** The form a note opens in. */
export type BaseHalfNotesOpenIn = 'rich' | 'preview' | 'source';
export const BASEHALF_NOTES_OPEN_INS: readonly BaseHalfNotesOpenIn[] = ['rich', 'preview', 'source'];

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
		[BaseHalfSetting.CanvasWheel]: {
			type: 'string',
			default: 'pan',
			enum: [...BASEHALF_CANVAS_WHEELS],
			enumItemLabels: [localize('basehalf.canvas.wheel.pan', 'Moves the Canvas'), localize('basehalf.canvas.wheel.zoom', 'Zooms')],
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.canvas.wheel', 'What a turn of the mouse wheel, or two fingers moved on a trackpad, does on the canvas. A pinch zooms either way, and a drag with the middle or the right button moves the canvas.')
		},
		[BaseHalfSetting.CanvasSnap]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.canvas.snap', 'A card that is moved or resized lines up with the cards near it. The magnet of the canvas changes this setting.')
		},
		[BaseHalfSetting.CanvasBackground]: {
			type: 'string',
			default: 'lines',
			enum: [...BASEHALF_CANVAS_BACKGROUNDS],
			enumItemLabels: [localize('basehalf.canvas.background.lines', 'Lines'), localize('basehalf.canvas.background.dots', 'Dots'), localize('basehalf.canvas.background.plain', 'Plain')],
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.canvas.background', 'What the canvas draws behind its cards.')
		},
		[BaseHalfSetting.CanvasPlayVideosOnHover]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.canvas.playVideosOnHover', 'A video card plays, without sound, while the pointer is over it.')
		},
		[BaseHalfSetting.NotesFontFamily]: {
			type: 'string',
			default: '',
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.notes.fontFamily', 'The font of a note\'s text, on its card and in Card Detail: a list of fonts, the first that the computer has is used. Empty is the font of the window.')
		},
		[BaseHalfSetting.NotesFontSize]: {
			type: 'number',
			default: BASEHALF_NOTES_FONT_SIZE,
			minimum: BASEHALF_NOTES_FONT_SIZE_MIN,
			maximum: BASEHALF_NOTES_FONT_SIZE_MAX,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.notes.fontSize', 'The size of a note\'s text in Card Detail, in pixels. On the canvas, the text of a card follows the zoom.')
		},
		[BaseHalfSetting.NotesOpenIn]: {
			type: 'string',
			default: 'rich',
			enum: [...BASEHALF_NOTES_OPEN_INS],
			enumItemLabels: [localize('basehalf.notes.openIn.rich', 'Rich'), localize('basehalf.notes.openIn.preview', 'Preview'), localize('basehalf.notes.openIn.source', 'Source')],
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.notes.openIn', 'The form of Card Detail a note opens in.')
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
			description: localize('basehalf.agent.defaultSession', 'The session a new tab of the Agent Area starts with.')
		},
		[BaseHalfSetting.AgentRestoreSessions]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.agent.restoreSessions', 'A folder opens with the tabs and panes its Agent Area was closed with, each session started anew in its folder.')
		},
		[BaseHalfSetting.AgentsOfferSkill]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.agents.offerSkill', 'BaseHalf offers to install its skill for agents. The skill tells agents what is selected and how cards connect.')
		},
		[BaseHalfSetting.AgentsShareSelection]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			tags: [BASEHALF_SETTINGS_TAG],
			description: localize('basehalf.agents.shareSelection', 'While the skill is installed, BaseHalf records which cards and which text are selected, where agents can read it.')
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
