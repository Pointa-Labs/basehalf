/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The sections that the launch instruction and the BaseHalf agent skill have
 * in common, word for word: where BaseHalf keeps its metadata, relationships,
 * preserving relationships, and canvas workflows (agent launch context,
 * "Content contract"). They do not tell an agent how to move a file: BaseHalf
 * follows a moved item by itself (following moved items).
 */
export const BASEHALF_AGENT_SHARED_SECTIONS: readonly string[] = [
	'## Where you are',
	'',
	'Ordinary files are the content. The hidden `.bh/` folder holds BaseHalf project metadata:',
	'- canvas layout;',
	'- reading aids;',
	'- each card\'s one-line `description`, in `.bh/mirror/<path>/badge.yaml`;',
	'- upstream lists BaseHalf keeps, in `.bh/mirror/<path>/upstream.yaml`;',
	'- each generation card\'s prompt and settings, in `.bh/mirror/<path>/generation.yaml`, and what made its file, in `made.yaml`.',
	'',
	'Read a node\'s `description` when you need to know what the user says it is for. Never delete or regenerate `.bh/`. Edit it only when the user asks.',
	'',
	'## Relationships',
	'',
	'`A → B` means A\'s context flows into B. The downstream file lists its upstream paths:',
	'- a Markdown note, under the `upstream` key of its frontmatter;',
	'- any other node, in `.bh/mirror/<path>/upstream.yaml`. A note with no `upstream` key may have its list there too: then edit that list, not the note.',
	'',
	'Each entry is relative to the workspace folder, uses forward slashes, has no `./` and no leading `/`, and names a folder without a trailing slash. Quote entries that YAML would read as numbers or booleans. For example:',
	'',
	'```yaml',
	'---',
	'upstream:',
	'  - courses/linear-algebra/overview.md',
	'  - sources/strang.pdf',
	'---',
	'```',
	'',
	'To find what flows out of X, search for X\'s path in the `upstream` entries of Markdown files and in `.bh/mirror/**/upstream.yaml`. `.bh` is hidden, so search it explicitly. Markdown links never create relationships.',
	'',
	'## Preserving relationships',
	'',
	'- When you rewrite or restructure a file, edit it in place and keep its frontmatter, including the upstream list, unchanged. Never delete and recreate it.',
	'- You can move and rename files and folders with ordinary tools. BaseHalf recognizes the item at its new path, by its content, and moves what it keeps for it under `.bh/`.',
	'- Entries name items by path, so an entry that names the old path of a moved item is broken until it is updated. BaseHalf updates them when it sees the move. You can update them yourself too.',
	'- Never move, rename, or delete anything under `.bh/`. BaseHalf does that itself.',
	'- Moving keeps a relationship; it does not change one.',
	'- When the user asks you to create a note from other files, list those files under the new note\'s `upstream`. Otherwise add or remove entries only when the user asks.',
	'- An older "BaseHalf workspace" section in `CLAUDE.md` or `AGENTS.md` that mentions `current_focus.yaml`, `references`, or `referenced_by` is out of date. Follow this instruction instead.',
	'',
	'## Canvas workflows',
	'',
	'- Before any canvas workflow, run `basehalf --list-capabilities`. Its JSON is the only authority for the model catalog, templates, and operations.',
	'- A generation card is an image or a video file; a draft is one whose file does not exist yet. Write `prompt`, `provider`, `model`, `mode`, and `params` in its `.bh/mirror/<path>/generation.yaml` to make a draft or change its next generation; never write `made.yaml`. Its inputs are the entries of its `upstream.yaml`, in order. The user renames, moves, or deletes a draft on the canvas.',
	'- Choose `provider`, `model`, `mode`, and `params` from `host.modelCatalog` of `basehalf --list-capabilities`: a model of the card\'s kind, one of its modes, and values its parameters accept; a parameter left out takes its default. A provider that is not set up there runs once the user sets it up in Providers.',
	'- Use `basehalf --generate <workspace-relative path>` to generate a card, a draft or one with its file. It prints the path of every card that generates, refuses values the model does not accept, and does not wait for the files.',
	'- Use `basehalf --run-operation \'<json>\'` only for operations that discovery returned.',
	'- A generation continues after the session closes.',
	'- These commands work only inside Agent Area terminals.'
];

/**
 * Launch-time context for Claude Code sessions that the Agent Area starts on
 * this machine. It is appended to Claude Code's system prompt with
 * `--append-system-prompt`, so BaseHalf never writes instructions into the
 * user's `CLAUDE.md` or `AGENTS.md`.
 *
 * The text is part of the application bundle (no local process can change
 * it) and must stay under 4 KiB in UTF-8. Its content and order follow the
 * agent launch context specification; tests lock the key phrases.
 */
export const BASEHALF_AGENT_LAUNCH_INSTRUCTIONS = [
	'# BaseHalf workspace',
	'',
	'You are running inside a BaseHalf workspace, started from BaseHalf\'s Agent Area.',
	'',
	...BASEHALF_AGENT_SHARED_SECTIONS
].join('\n');

/**
 * The launch instruction for a session whose Claude Code has the BaseHalf
 * agent skill installed. The skill holds the shared sections, so this only
 * says where the session runs and points at the skill (agent skill, "Agent
 * Area sessions").
 */
export const BASEHALF_AGENT_LAUNCH_POINTER = [
	'# BaseHalf workspace',
	'',
	'You are running inside a BaseHalf workspace, started from BaseHalf\'s Agent Area. The `basehalf` skill describes this workspace: where a card\'s description and its upstream and downstream connections are, what moving and renaming files does to them, and how to run canvas workflows. Use that skill before you read, write, move, or rename anything here, and when a request does not say which file or text it is about.'
].join('\n');

/** The Claude Code flag that appends {@link BASEHALF_AGENT_LAUNCH_INSTRUCTIONS}. */
export const BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_FLAG = '--append-system-prompt';
