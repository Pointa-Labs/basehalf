/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { BaseHalfFileLinkEntry } from '../../../../platform/basehalfFiles/common/basehalfFileLinks.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { BASEHALF_AGENT_SHARED_SECTIONS } from './basehalfAgentLaunchInstructions.js';

/** The name of the agent skill, and of its folder. */
export const BASEHALF_AGENT_SKILL_NAME = 'basehalf';
export const BASEHALF_AGENT_SKILL_FILE_NAME = 'SKILL.md';
/** A whole number that grows whenever the skill text changes. BaseHalf's own
 * copy never takes the text of a lower version (agent skill, "Keeping it
 * current"). */
export const BASEHALF_AGENT_SKILL_VERSION = '10';

/**
 * What an agent decides by. It leads with the one sign of a BaseHalf
 * workspace, a hidden `.bh/` directory, and says to look for it, because an
 * agent does not see hidden entries unless it lists them. It asks only about
 * the working folder: every session on the machine reads this text, and a
 * look above the working folder is one the agent has to ask the user for.
 */
export const BASEHALF_AGENT_SKILL_DESCRIPTION = 'A folder that contains a hidden `.bh/` directory is a BaseHalf workspace. Before you read, write, move, or rename notes and files, check whether your working folder has `.bh/` (list hidden entries to see it), and use this skill if it does. Also use it when a Markdown note has an `upstream` list in its frontmatter, and when asked what a file is for, what it builds on (upstream), or what uses it (downstream). In such a workspace, also use it when a request does not say which file or text it is about, such as "this", "here", or "improve it": BaseHalf records what the user selected.';

/**
 * What the record of the user's selection is (the selection agents can see,
 * "The skill"). It says what the record means, not when to read it.
 */
export const BASEHALF_AGENT_SELECTION_SECTION: readonly string[] = [
	'## What the user selected',
	'',
	'BaseHalf records what the user selected last in this workspace, in `.bh/cache/selection.yaml`. When the user\'s request does not say which file, card, or text it is about, such as "this", "here", or "improve it", it is about what they selected. When the request names something else, the request wins.',
	'',
	'The file exists only while BaseHalf is open with this workspace, and it changes whenever the user selects something else, also while you work. Read it again before you rely on it later. Never write it. Its fields:',
	'',
	'- `selected` says what the user selected:',
	'  - `folder`: nothing, on the canvas of the folder at `path`;',
	'  - `card`: the file or folder at `path`. It is the selected card, the note the user is editing with no text selected, or the card open in Card Detail;',
	'  - `cards`: two or more cards, listed under `paths`;',
	'  - `text`: text in the note at `path`, on lines `first_line` to `last_line` of the file, counted from 1 with the frontmatter. `text` is the selected text as the note shows it, without Markdown marks. `text_is_cut: true` means the selection was longer and the text is cut; the lines are complete.',
	'  - `text` in a PDF or a book: `path` is the PDF or the book. A PDF\'s text is on pages `first_page` to `last_page`, counted from 1. A book\'s text begins in the chapter of its contents named by `chapter`, which is missing when the book names none there. `text` is the text as BaseHalf\'s reader shows it.',
	'- Paths are relative to the workspace folder and use forward slashes. The workspace folder itself is `.`.'
];

/**
 * Where an image or a sound that an agent made with a tool of its own goes
 * (agent skill, "The skill", section 5): the folder of the canvas the user
 * works on, which the record of the selection names. It names no tool, and it
 * is not in the launch instruction.
 */
export const BASEHALF_AGENT_OWN_IMAGE_SECTION: readonly string[] = [
	'## An image or a sound you make yourself',
	'',
	'When you make an image or a sound with a tool of your own, such as your own image generation, put the file in the folder of the canvas the user works on, where it is a card. That folder is the one `.bh/cache/selection.yaml` names: the folder at `path` when `selected` is `folder`, and otherwise the folder that holds the selected card, cards, or note. When there is no record, ask the user which folder.'
];

/**
 * The text of the skill's `SKILL.md` (agent skill, "The skill"). It is part
 * of the application bundle. It says where a card's badge is and what it
 * means, and never what to read or in what order.
 */
export const BASEHALF_AGENT_SKILL_MARKDOWN = [
	'---',
	`name: ${BASEHALF_AGENT_SKILL_NAME}`,
	// A JSON string is a YAML double-quoted scalar: the colon inside stays text.
	`description: ${JSON.stringify(BASEHALF_AGENT_SKILL_DESCRIPTION)}`,
	'metadata:',
	`  version: ${JSON.stringify(BASEHALF_AGENT_SKILL_VERSION)}`,
	'---',
	'',
	'# BaseHalf workspace',
	'',
	'## Is this a BaseHalf workspace?',
	'',
	'A folder is a BaseHalf workspace when it contains a `.bh/` directory. `.bh` is hidden, so list hidden entries to see it. Your working directory is usually the workspace folder. When it has no `.bh/` and a folder above it has one, that folder is the workspace folder. Every path in this skill is relative to the workspace folder.',
	'',
	'If you find `.bh/`, follow this skill for everything you do in that folder, whether or not BaseHalf is running. If there is no `.bh/`, the folder has nothing of BaseHalf\'s to keep intact, and only what this skill says about a note\'s `upstream` list applies.',
	'',
	'In a BaseHalf workspace the user arranges files and folders as cards on a canvas and connects them. Ordinary files are the content. BaseHalf keeps what it knows about each card in the files themselves and in `.bh/`.',
	'',
	'## A card\'s badge',
	'',
	'Every file and folder is a card. A card\'s badge is what the user recorded about it:',
	'',
	'- **Description**: one line on what the item is for, under `description` in `.bh/mirror/<path>/badge.yaml`. `<path>` is the item\'s path relative to the workspace folder. Many cards have none.',
	'- **Upstream**: the items whose content flows into this one. They are the context the user chose for it. Where the list is depends on the kind of item; see Relationships.',
	'- **Downstream**: the items this one flows into. It is stored nowhere. Find it by searching, as Relationships describes.',
	'',
	'The user can change a badge while you work. Read it from disk when you need it, and again before you rely on it later.',
	'',
	...BASEHALF_AGENT_SELECTION_SECTION,
	'',
	...BASEHALF_AGENT_SHARED_SECTIONS,
	'',
	...BASEHALF_AGENT_OWN_IMAGE_SECTION,
	''
].join('\n');

/** Whose skill folder a location is. */
export type BaseHalfAgentSkillAgent = 'claude' | 'shared';

/** One place the skill is installed, under the user's home folder. */
export interface IBaseHalfAgentSkillTarget {
	readonly agent: BaseHalfAgentSkillAgent;
	/** The agent's name in messages. */
	readonly label: string;
	/** The path of the skill's folder below the home folder. */
	readonly segments: readonly string[];
}

/**
 * Where the skill is installed (agent skill, "Where it is installed"): Claude
 * Code's own skill folder, and the location that Codex and other agents share.
 * Each is a link to BaseHalf's own copy.
 */
export const BASEHALF_AGENT_SKILL_TARGETS: readonly IBaseHalfAgentSkillTarget[] = [
	{ agent: 'claude', label: 'Claude Code', segments: ['.claude', 'skills', BASEHALF_AGENT_SKILL_NAME] },
	{ agent: 'shared', label: 'Codex', segments: ['.agents', 'skills', BASEHALF_AGENT_SKILL_NAME] }
];

/**
 * BaseHalf's own copy of the skill below the home folder, which the links
 * point at. Every BaseHalf on the machine, a development build included, uses
 * this one folder, outside the application bundle.
 */
export const BASEHALF_AGENT_SKILL_COPY_SEGMENTS: readonly string[] = ['.basehalf', 'agent-skill', BASEHALF_AGENT_SKILL_NAME];

/**
 * `linked`: a link to BaseHalf's own copy. `copy`: a folder, such as the copy
 * that an earlier release wrote there. `other`: a link to anywhere else, or a
 * file.
 */
export type BaseHalfAgentSkillState = 'missing' | 'linked' | 'copy' | 'other';

export function baseHalfAgentSkillState(entry: BaseHalfFileLinkEntry, copy: URI): BaseHalfAgentSkillState {
	switch (entry.kind) {
		case 'missing': return 'missing';
		case 'link': return isEqual(entry.target, copy) ? 'linked' : 'other';
		case 'folder': return 'copy';
		default: return 'other';
	}
}

export type BaseHalfAgentSkillOffer = 'install' | 'update';

/**
 * What to offer for the skill's states: nothing once a location is linked,
 * an update when an earlier copy is in every place, and otherwise an install.
 */
export function baseHalfAgentSkillOffer(states: readonly BaseHalfAgentSkillState[]): BaseHalfAgentSkillOffer | undefined {
	if (states.includes('linked')) {
		return undefined;
	}
	return states.includes('missing') ? 'install' : 'update';
}

function frontMatterOf(text: string): string | undefined {
	return /^---\n(?<fields>[\s\S]*?)\n---\n/.exec(text)?.groups?.fields;
}

/** The version a skill text states in its front matter, as a number; `undefined` when it states none. */
export function baseHalfAgentSkillVersion(text: string): number | undefined {
	const frontMatter = frontMatterOf(text);
	const version = frontMatter !== undefined ? /^[ \t]+version:[ \t]*"(?<number>\d+)"[ \t]*$/m.exec(frontMatter)?.groups?.number : undefined;
	return version !== undefined ? Number(version) : undefined;
}

/**
 * Whether a text is BaseHalf's skill, of any version: its front matter names
 * `basehalf` and states a version. Only such a copy, which an earlier release
 * wrote, is BaseHalf's to replace or remove (agent skill, "Installing and
 * removing").
 */
export function baseHalfIsAgentSkillText(text: string): boolean {
	const frontMatter = frontMatterOf(text);
	return frontMatter !== undefined && new RegExp(`^name:[ \\t]*${BASEHALF_AGENT_SKILL_NAME}[ \\t]*$`, 'm').test(frontMatter) && baseHalfAgentSkillVersion(text) !== undefined;
}

/**
 * Whether BaseHalf's own copy takes the bundled text: unless it holds it
 * already or states a higher version, so that an older BaseHalf never
 * writes over the text of a newer one (agent skill, "Keeping it current").
 */
export function baseHalfAgentSkillCopyTakesBundledText(copy: string | undefined): boolean {
	if (copy === BASEHALF_AGENT_SKILL_MARKDOWN) {
		return false;
	}
	const version = copy === undefined ? undefined : baseHalfAgentSkillVersion(copy);
	return version === undefined || version <= Number(BASEHALF_AGENT_SKILL_VERSION);
}

export interface IBaseHalfAgentSkillLocation extends IBaseHalfAgentSkillTarget {
	/** The skill's folder in the agent's own folder. */
	readonly resource: URI;
	readonly state: BaseHalfAgentSkillState;
}

export interface IBaseHalfAgentSkillInstallResult {
	readonly installed: readonly IBaseHalfAgentSkillTarget[];
	/** Locations that could not be written, each with a plain reason. */
	readonly failed: readonly { readonly target: IBaseHalfAgentSkillTarget; readonly reason: string }[];
}

export const IBaseHalfAgentSkillService = createDecorator<IBaseHalfAgentSkillService>('baseHalfAgentSkillService');

/**
 * Installs the BaseHalf agent skill into the agents' own skill folders in the
 * user's home folder, only when the user asks, as links to BaseHalf's own
 * copy, and keeps that copy at the bundled text. Nothing is ever written into
 * a workspace.
 */
export interface IBaseHalfAgentSkillService {
	readonly _serviceBrand: undefined;

	/** Whether this window can install the skill: a local desktop window. */
	readonly available: boolean;
	/** Fires after this window installed or removed the skill. */
	readonly onDidChange: Event<void>;
	/** The state of the skill at each location. */
	inspect(): Promise<readonly IBaseHalfAgentSkillLocation[]>;
	/** Whether the skill is installed for an agent, in any state but missing. */
	isInstalledFor(agent: BaseHalfAgentSkillAgent): Promise<boolean>;
	/** While a location is linked, writes the bundled text into BaseHalf's own copy, unless the copy holds it or a higher version. */
	refresh(): Promise<void>;
	/** Writes BaseHalf's own copy and links every location to it. */
	install(): Promise<IBaseHalfAgentSkillInstallResult>;
	/** Removes the links, earlier copies, and BaseHalf's own copy. Resolves `false` when nothing was installed. */
	remove(): Promise<boolean>;
}
