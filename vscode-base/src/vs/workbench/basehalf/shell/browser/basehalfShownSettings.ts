/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { BASEHALF_AGENT_SESSION_CHOICES } from '../../agentArea/common/basehalfAgentArea.js';
import { BASEHALF_NOTES_FONT_SIZE_MAX, BASEHALF_NOTES_FONT_SIZE_MIN, BASEHALF_NOTES_MONOSPACE_FONT, BASEHALF_NOTES_SERIF_FONT, BaseHalfSetting } from '../common/basehalfConfiguration.js';
import { BaseHalfSettingsListPageId } from '../common/basehalfSettings.js';

/** BaseHalf's two color themes, by the names the base gives them (light and dark, D148). */
const BASEHALF_DARK_COLOR_THEME = 'Dark 2026';
const BASEHALF_LIGHT_COLOR_THEME = 'Light 2026';

/** How a setting is changed on a page. */
export type BaseHalfSettingControl =
	| { readonly kind: 'switch' }
	| { readonly kind: 'choice'; readonly options: readonly IBaseHalfSettingOption[]; /** Names a value that is none of the choices, as the choices are named. */ readonly name?: (value: string | number) => string }
	| { readonly kind: 'text'; readonly placeholder?: string }
	| { readonly kind: 'number'; readonly minimum: number; readonly maximum: number };

export interface IBaseHalfSettingOption {
	readonly value: string | number;
	readonly label: string;
}

/** A shown setting of the catalog (the settings BaseHalf offers, "Shown"), under BaseHalf's own name and words. */
export interface IBaseHalfShownSetting {
	readonly key: string;
	readonly label: string;
	readonly description?: string;
	readonly control: BaseHalfSettingControl;
}

/** Settings that stand in one box. A page whose settings are one group gives it no title: the page's name says it. */
export interface IBaseHalfShownSettingsSection {
	readonly id: string;
	readonly title?: string;
	readonly settings: readonly IBaseHalfShownSetting[];
}

/** The zoom of the window is a level, each a fifth larger than the one before; the page names it by its percentage. */
function windowZoomOptions(): IBaseHalfSettingOption[] {
	return [-3, -2, -1, 0, 1, 2, 3, 4, 5].map(level => ({ value: level, label: percentage(Math.pow(1.2, level)) }));
}

function percentage(factor: number): string {
	return localize('basehalf.settings.percentage', "{0}%", Math.round(factor * 100));
}

function general(): IBaseHalfShownSettingsSection[] {
	return [
		{
			id: 'window',
			title: localize('basehalf.settings.window', "Window"),
			settings: [{
				key: 'workbench.colorTheme',
				label: localize('basehalf.settings.appearance', "Appearance"),
				control: {
					kind: 'choice', options: [
						{ value: BASEHALF_DARK_COLOR_THEME, label: localize('basehalf.settings.appearance.dark', "Dark") },
						{ value: BASEHALF_LIGHT_COLOR_THEME, label: localize('basehalf.settings.appearance.light', "Light") }
					]
				}
			}, {
				key: 'window.autoDetectColorScheme',
				label: localize('basehalf.settings.matchSystem', "Match the System"),
				description: localize('basehalf.settings.matchSystemDescription', "Dark or light, as the system is."),
				control: { kind: 'switch' }
			}, {
				key: 'window.zoomLevel',
				label: localize('basehalf.settings.zoom', "Zoom"),
				control: { kind: 'choice', options: windowZoomOptions(), name: level => typeof level === 'number' ? percentage(Math.pow(1.2, level)) : String(level) }
			}]
		},
		{
			id: 'code',
			title: localize('basehalf.settings.code', "Code"),
			settings: [{
				key: 'editor.fontFamily',
				label: localize('basehalf.settings.codeFont', "Font"),
				control: { kind: 'text' }
			}, {
				key: 'editor.fontSize',
				label: localize('basehalf.settings.codeFontSize', "Font Size"),
				description: localize('basehalf.settings.codeFontSizeDescription', "In Source. A code card keeps its size."),
				control: { kind: 'number', minimum: 6, maximum: 100 }
			}, {
				key: 'editor.wordWrap',
				label: localize('basehalf.settings.wordWrap', "Wrap Long Lines"),
				description: localize('basehalf.settings.wordWrapDescription', "In Source."),
				control: {
					kind: 'choice', options: [
						{ value: 'off', label: localize('basehalf.settings.off', "Off") },
						{ value: 'on', label: localize('basehalf.settings.on', "On") }
					]
				}
			}]
		},
		{
			id: 'files',
			title: localize('basehalf.settings.files', "Files"),
			settings: [{
				key: BaseHalfSetting.FilesShowHiddenFolder,
				label: localize('basehalf.settings.showHiddenFolder', "Show the .bh Folder"),
				description: localize('basehalf.settings.showHiddenFolderDescription', "It holds the files of notes and the records of cards."),
				control: { kind: 'switch' }
			}]
		}
	];
}

function canvas(): IBaseHalfShownSettingsSection[] {
	return [{
		id: 'canvas',
		settings: [{
			key: BaseHalfSetting.CanvasDefaultZoom,
			label: localize('basehalf.settings.canvasZoom', "Zoom of a New Folder"),
			description: localize('basehalf.settings.canvasZoomDescription', "The largest zoom at which a folder first shows all its cards."),
			control: {
				kind: 'choice',
				options: [0.25, 0.33, 0.5, 0.67, 0.75, 1].map(zoom => ({ value: zoom, label: percentage(zoom) })),
				name: zoom => typeof zoom === 'number' ? percentage(zoom) : String(zoom)
			}
		}, {
			key: BaseHalfSetting.CanvasWheel,
			label: localize('basehalf.settings.canvasWheel', "Mouse Wheel"),
			description: localize('basehalf.settings.canvasWheelDescription', "A pinch zooms either way, and a drag with the middle or the right button moves the canvas."),
			control: {
				kind: 'choice', options: [
					{ value: 'pan', label: localize('basehalf.settings.canvasWheel.pan', "Moves the Canvas") },
					{ value: 'zoom', label: localize('basehalf.settings.canvasWheel.zoom', "Zooms") }
				]
			}
		}, {
			key: BaseHalfSetting.CanvasSnap,
			label: localize('basehalf.settings.canvasSnap', "Snap to Cards"),
			description: localize('basehalf.settings.canvasSnapDescription', "A card that is moved or resized lines up with the cards near it."),
			control: { kind: 'switch' }
		}, {
			key: BaseHalfSetting.CanvasBackground,
			label: localize('basehalf.settings.canvasBackground', "Background"),
			control: {
				kind: 'choice', options: [
					{ value: 'lines', label: localize('basehalf.settings.canvasBackground.lines', "Lines") },
					{ value: 'dots', label: localize('basehalf.settings.canvasBackground.dots', "Dots") },
					{ value: 'plain', label: localize('basehalf.settings.canvasBackground.plain', "Plain") }
				]
			}
		}, {
			key: BaseHalfSetting.CanvasPlayVideosOnHover,
			label: localize('basehalf.settings.canvasPlayVideos', "Play Videos Under the Pointer"),
			description: localize('basehalf.settings.canvasPlayVideosDescription', "Without sound."),
			control: { kind: 'switch' }
		}]
	}];
}

function notes(): IBaseHalfShownSettingsSection[] {
	return [{
		id: 'notes',
		settings: [{
			key: BaseHalfSetting.NotesFontFamily,
			label: localize('basehalf.settings.notesFont', "Font"),
			description: localize('basehalf.settings.notesFontDescription', "On the card and in Card Detail."),
			control: {
				kind: 'choice', options: [
					{ value: '', label: localize('basehalf.settings.notesFont.default', "Default") },
					{ value: BASEHALF_NOTES_SERIF_FONT, label: localize('basehalf.settings.notesFont.serif', "Serif") },
					{ value: BASEHALF_NOTES_MONOSPACE_FONT, label: localize('basehalf.settings.notesFont.monospace', "Monospace") }
				]
			}
		}, {
			key: BaseHalfSetting.NotesFontSize,
			label: localize('basehalf.settings.notesFontSize', "Text Size"),
			description: localize('basehalf.settings.notesFontSizeDescription', "In Card Detail. On the canvas, a card's text follows the zoom."),
			control: { kind: 'number', minimum: BASEHALF_NOTES_FONT_SIZE_MIN, maximum: BASEHALF_NOTES_FONT_SIZE_MAX }
		}, {
			key: BaseHalfSetting.NotesOpenIn,
			label: localize('basehalf.settings.notesOpenIn', "Opens In"),
			control: {
				kind: 'choice', options: [
					{ value: 'rich', label: localize('basehalf.settings.notesOpenIn.rich', "Rich") },
					{ value: 'preview', label: localize('basehalf.settings.notesOpenIn.preview', "Preview") },
					{ value: 'source', label: localize('basehalf.settings.notesOpenIn.source', "Source") }
				]
			}
		}, {
			key: BaseHalfSetting.EditorReadingMode,
			label: localize('basehalf.settings.readingAids', "Reading Aids"),
			description: localize('basehalf.settings.readingAidsDescription', "Keywords stand out, and a paragraph can be marked as read."),
			control: { kind: 'switch' }
		}]
	}];
}

function agentArea(): IBaseHalfShownSettingsSection[] {
	return [
		{
			id: 'sessions',
			title: localize('basehalf.settings.sessions', "Sessions"),
			settings: [{
				key: BaseHalfSetting.AgentDefaultSession,
				label: localize('basehalf.settings.defaultSession', "First Session"),
				description: localize('basehalf.settings.defaultSessionDescription', "A new tab starts with it."),
				control: { kind: 'choice', options: BASEHALF_AGENT_SESSION_CHOICES.map(choice => ({ value: choice.kind, label: choice.label })) }
			}, {
				key: BaseHalfSetting.AgentRestoreSessions,
				label: localize('basehalf.settings.restoreSessions', "Reopen Sessions"),
				description: localize('basehalf.settings.restoreSessionsDescription', "A folder opens with the tabs and panes it was closed with, each started anew."),
				control: { kind: 'switch' }
			}]
		},
		{
			id: 'terminal',
			title: localize('basehalf.settings.terminal', "Terminal"),
			settings: [{
				key: 'terminal.integrated.fontFamily',
				label: localize('basehalf.settings.terminalFont', "Font"),
				control: { kind: 'text', placeholder: localize('basehalf.settings.terminalFontPlaceholder', "Same as Code") }
			}, {
				key: 'terminal.integrated.fontSize',
				label: localize('basehalf.settings.terminalFontSize', "Font Size"),
				control: { kind: 'number', minimum: 6, maximum: 100 }
			}]
		},
		{
			id: 'agents',
			title: localize('basehalf.settings.agents', "Agents"),
			settings: [{
				key: BaseHalfSetting.AgentsOfferSkill,
				label: localize('basehalf.settings.offerSkill', "Offer the BaseHalf Skill"),
				description: localize('basehalf.settings.offerSkillDescription', "The skill tells agents what is selected and how cards connect."),
				control: { kind: 'switch' }
			}, {
				key: BaseHalfSetting.AgentsShareSelection,
				label: localize('basehalf.settings.shareSelection', "Share the Selection"),
				description: localize('basehalf.settings.shareSelectionDescription', "Agents with the skill can read which cards and which text are selected."),
				control: { kind: 'switch' }
			}]
		}
	];
}

/**
 * The settings of a page of BaseHalf's Settings, in its order (BaseHalf's Settings, "The pages").
 * `update.mode` is on the About page, with the state of an update.
 */
export function baseHalfShownSettings(page: BaseHalfSettingsListPageId): IBaseHalfShownSettingsSection[] {
	switch (page) {
		case 'general': return general();
		case 'canvas': return canvas();
		case 'notes': return notes();
		case 'agentArea': return agentArea();
	}
}
