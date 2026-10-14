/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { baseHalfItemDisplayName } from './basehalfCardDetail.js';

/** Where the record is, below a workspace folder (the selection agents can see, "The record"). */
export const BASEHALF_AGENT_SELECTION_SEGMENTS: readonly string[] = ['.bh', 'cache', 'selection.yaml'];

import { BASEHALF_AGENT_SELECTION_TEXT_LIMIT } from './basehalfSelectionLines.js';
export { BASEHALF_AGENT_SELECTION_TEXT_LIMIT };

/** How long the selection has to settle before the record is written. */
export const BASEHALF_AGENT_SELECTION_WRITE_DELAY_MS = 200;

/** A card of the canvas, by its path relative to the workspace folder. */
export interface IBaseHalfAgentSelectionCard {
	readonly path: string;
	readonly isFolder: boolean;
	/** The name and glyph its caption shows, when the canvas knows them: a node shows its title. */
	readonly caption?: IBaseHalfAgentSelectionCaption;
}

export interface IBaseHalfAgentSelectionCaption {
	readonly name: string;
	readonly icon: BaseHalfAgentSelectionIcon;
}

/** Text selected in a note, on its card or in Card Detail. */
export interface IBaseHalfAgentSelectionText {
	/** The note, relative to the workspace folder. */
	readonly path: string;
	/** The first and last line of the note's file that hold the selection, from 1. */
	readonly firstLine: number;
	readonly lastLine: number;
	/** The selected text as the note shows it: no Markdown marks, one line break between blocks. */
	readonly text: string;
}

/**
 * What a window knows of the user's selection. Paths are relative to
 * `workspaceFolder`, with forward slashes; the workspace folder itself is `.`.
 */
export interface IBaseHalfAgentSelectionInput {
	readonly workspaceFolder: URI;
	/** The name of the workspace folder, for a canvas of the workspace folder itself. */
	readonly workspaceFolderName: string;
	/** The folder whose canvas is shown. */
	readonly folderPath: string;
	/** The selected cards of that canvas, in the canvas's list order. */
	readonly cards: readonly IBaseHalfAgentSelectionCard[];
	/** The card that Card Detail shows, while it is open. */
	readonly detail?: IBaseHalfAgentSelectionCard;
	/** Text selected in the note being edited, on its card or in Card Detail. */
	readonly text?: IBaseHalfAgentSelectionText;
}

/** What is recorded (the selection agents can see, "What is recorded"). */
export type BaseHalfAgentSelection =
	| { readonly selected: 'folder'; readonly path: string; readonly name: string }
	| { readonly selected: 'card'; readonly path: string; readonly isFolder: boolean; readonly caption?: IBaseHalfAgentSelectionCaption }
	| { readonly selected: 'cards'; readonly paths: readonly string[] }
	| { readonly selected: 'text'; readonly path: string; readonly firstLine: number; readonly lastLine: number; readonly text: string; readonly cut: boolean };

/**
 * The rule: selected text wins, then the card Card Detail shows, then the
 * selected cards, then the folder of the canvas.
 */
export function baseHalfAgentSelectionFor(input: IBaseHalfAgentSelectionInput): BaseHalfAgentSelection {
	// Text that is only white space, such as a selected image or line break, shows nothing.
	if (input.text && input.text.text.trim().length > 0) {
		const cut = input.text.text.length > BASEHALF_AGENT_SELECTION_TEXT_LIMIT;
		// A cut never splits a character in two.
		const limit = /[\ud800-\udbff]/.test(input.text.text.charAt(BASEHALF_AGENT_SELECTION_TEXT_LIMIT - 1)) ? BASEHALF_AGENT_SELECTION_TEXT_LIMIT - 1 : BASEHALF_AGENT_SELECTION_TEXT_LIMIT;
		return {
			selected: 'text',
			path: input.text.path,
			firstLine: input.text.firstLine,
			lastLine: input.text.lastLine,
			text: cut ? input.text.text.slice(0, limit) : input.text.text,
			cut
		};
	}
	const card = (selected: IBaseHalfAgentSelectionCard): BaseHalfAgentSelection => selected.caption
		? { selected: 'card', path: selected.path, isFolder: selected.isFolder, caption: selected.caption }
		: { selected: 'card', path: selected.path, isFolder: selected.isFolder };
	if (input.detail) {
		return card(input.detail);
	}
	if (input.cards.length >= 2) {
		return { selected: 'cards', paths: input.cards.map(selected => selected.path) };
	}
	if (input.cards.length === 1) {
		return card(input.cards[0]);
	}
	const name = input.folderPath === '.' ? input.workspaceFolderName : input.folderPath.slice(input.folderPath.lastIndexOf('/') + 1);
	return { selected: 'folder', path: input.folderPath, name };
}

/**
 * The record's content: YAML whose strings are double-quoted scalars, which
 * JSON strings are. A comment says what the file is to an agent that finds it
 * without the skill.
 */
export function serializeBaseHalfAgentSelection(selection: BaseHalfAgentSelection): string {
	const lines = [
		'# What the user selected last in BaseHalf. BaseHalf rewrites this file; see the basehalf skill.',
		`selected: ${quote(selection.selected)}`
	];
	switch (selection.selected) {
		case 'folder':
		case 'card':
			lines.push(`path: ${quote(selection.path)}`);
			break;
		case 'cards':
			lines.push('paths:', ...selection.paths.map(path => `  - ${quote(path)}`));
			break;
		case 'text':
			lines.push(
				`path: ${quote(selection.path)}`,
				`first_line: ${selection.firstLine}`,
				`last_line: ${selection.lastLine}`,
				`text: ${quote(selection.text)}`
			);
			if (selection.cut) {
				lines.push('text_is_cut: true');
			}
			break;
	}
	return `${lines.join('\n')}\n`;
}

/**
 * A YAML double-quoted scalar. A JSON string is one, except that YAML does not
 * allow some characters that JSON leaves as they are: those are escaped.
 */
function quote(value: string): string {
	return JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029\ufffe\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The icon of an item's kind, as the caption of its card draws it. */
export type BaseHalfItemKindIcon = 'folder' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'code' | 'generic';

/** The icon of the status bar entry: an item's kind, a node's kind, several cards, or selected text. */
export type BaseHalfAgentSelectionIcon = BaseHalfItemKindIcon | 'presentation' | 'file' | 'cards' | 'selectedText';

/** What the status bar entry shows for a selection. */
export interface IBaseHalfAgentSelectionLabel {
	readonly icon: BaseHalfAgentSelectionIcon;
	/** The text after the icon; for several cards, their number. */
	readonly text: string;
	readonly count?: number;
}

/** Characters of selected text the entry is given; the rest would not fit. */
const LABEL_TEXT_LIMIT = 120;

export function baseHalfAgentSelectionLabel(selection: BaseHalfAgentSelection): IBaseHalfAgentSelectionLabel {
	switch (selection.selected) {
		case 'folder':
			return { icon: 'folder', text: selection.name };
		case 'card': {
			if (selection.caption) {
				return { icon: selection.caption.icon, text: selection.caption.name };
			}
			const name = selection.path.slice(selection.path.lastIndexOf('/') + 1);
			return { icon: baseHalfItemIcon(name, selection.isFolder), text: baseHalfItemDisplayName(name, selection.isFolder) };
		}
		case 'cards':
			return { icon: 'cards', text: '', count: selection.paths.length };
		case 'text':
			return { icon: 'selectedText', text: selection.text.slice(0, LABEL_TEXT_LIMIT * 4).replace(/\s+/g, ' ').trim().slice(0, LABEL_TEXT_LIMIT) };
	}
}

/**
 * The kind of an item by its name, as the caption of its card draws it. The
 * canvas and the status bar share it.
 */
export function baseHalfItemIcon(name: string, isFolder: boolean): BaseHalfItemKindIcon {
	if (isFolder) {
		return 'folder';
	}
	const lower = name.toLowerCase();
	const dot = lower.lastIndexOf('.');
	const ext = dot === -1 || dot === lower.length - 1 ? '' : lower.slice(dot + 1);
	const base = dot === -1 ? lower : lower.slice(0, dot);
	if (['md', 'markdown', 'mdx', 'txt', 'rst', 'org', 'gitignore', 'dockerignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc', 'csv', 'tsv', 'log', 'text'].includes(ext) || ['readme', 'license', 'changelog', 'authors', 'notice', 'copying'].includes(base)) {
		return 'text';
	}
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif', 'ico', 'tiff'].includes(ext)) {
		return 'image';
	}
	if (['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus'].includes(ext)) {
		return 'audio';
	}
	if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(ext)) {
		return 'video';
	}
	if (ext === 'pdf') {
		return 'pdf';
	}
	if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'rb', 'c', 'cpp', 'h', 'cs', 'php', 'swift', 'kt', 'json', 'yaml', 'yml', 'toml', 'css', 'scss', 'html', 'xml', 'sh', 'sql', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'ini', 'conf', 'cfg', 'env', 'properties', 'lock', 'lua', 'pl', 'r', 'gradle', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto'].includes(ext) || ['dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'jenkinsfile', 'vagrantfile'].includes(base)) {
		return 'code';
	}
	return 'generic';
}

export const IBaseHalfAgentSelectionService = createDecorator<IBaseHalfAgentSelectionService>('baseHalfAgentSelectionService');

/**
 * Keeps the record of what the user selected last in this window, and tells
 * the status bar what it holds (the selection agents can see).
 */
export interface IBaseHalfAgentSelectionService {
	readonly _serviceBrand: undefined;

	/** What the record holds now, or `undefined` while there is none. */
	readonly current: BaseHalfAgentSelection | undefined;
	readonly onDidChange: Event<BaseHalfAgentSelection | undefined>;

	/** The selection of the canvas and of Card Detail. `undefined` when no canvas is shown. */
	update(input: IBaseHalfAgentSelectionInput | undefined): void;
}
