/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

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
	'## Where you are',
	'',
	'Ordinary files are the content. The hidden `.bh/` folder holds BaseHalf project metadata:',
	'- canvas layout;',
	'- reading aids;',
	'- each card\'s one-line `description`, in `.bh/mirror/<path>/badge.yaml`;',
	'- the upstream lists of non-Markdown nodes, in `.bh/mirror/<path>/upstream.yaml`.',
	'',
	'Read a node\'s `description` when you need to know what the user says it is for. Never delete or regenerate `.bh/`. Edit it only when the user asks.',
	'',
	'## Relationships',
	'',
	'`A → B` means A\'s context flows into B. The downstream file lists its upstream paths:',
	'- a Markdown note, under the `upstream` key of its frontmatter;',
	'- a `.bhnode`, under its `upstream` field;',
	'- any other node, in `.bh/mirror/<path>/upstream.yaml`.',
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
	'To find what flows out of X, search for X\'s path in the `upstream` entries of Markdown and `.bhnode` files and in `.bh/mirror/**/upstream.yaml`. `.bh` is hidden, so search it explicitly. Markdown links never create relationships.',
	'',
	'## Preserving relationships',
	'',
	'- When you rewrite or restructure a file, edit it in place and keep its frontmatter, including the upstream list, unchanged. Never delete and recreate it.',
	'- To move or rename a file or folder, use this instead of `mv` or `git mv`:',
	'',
	'  ```sh',
	'  basehalf --run-operation \'{"operationId":"basehalf.workspace.move","parameters":{"from":"old/path.md","to":"new/path.md"}}\'',
	'  ```',
	'',
	'  `from` and `to` are full paths relative to the workspace folder, not to your current directory, and `to` is the new path, not a folder to move into. Write a `\'` in a path as `\'\\\'\'`. BaseHalf moves the item\'s metadata with it and updates the `upstream` entries that name it. Tell the user what the result lists under `skipped`, `incomplete`, or `notUpdated`, and leave those entries as they are.',
	'- If the operation is refused, do not move the item: fix the request if the error is about a path, otherwise tell the user why. If it returned no result, `cancelled`, or a refusal about the terminal, check whether `from` still exists before doing anything else.',
	'- Only if `basehalf` is not found, or it says Agent operations are available only inside a BaseHalf TUI Agent session, move the item yourself. Then update every `upstream` entry that names its old path, or a path inside it, including those in `.bh/mirror/**/upstream.yaml`: the one `.bh/` edit allowed without being asked. Tell the user that its BaseHalf metadata stayed at the old path (for a folder or a file that is not Markdown or `.bhnode`, that includes its own upstream list), and that moving it back and renaming it in BaseHalf restores it.',
	'- Moving keeps a relationship; it does not change one.',
	'- When the user asks you to create a note from other files, list those files under the new note\'s `upstream`. Otherwise add or remove entries only when the user asks.',
	'- An older "BaseHalf workspace" section in `CLAUDE.md` or `AGENTS.md` that mentions `current_focus.yaml`, `references`, or `referenced_by` is out of date. Follow this instruction instead.',
	'',
	'## Canvas workflows',
	'',
	'- Before any other canvas workflow, run `basehalf --list-capabilities`. Its JSON is the only authority for recipes, slots, parameters, document formats, and every operation except `basehalf.workspace.move`.',
	'- Use `basehalf --run-node <workspace-relative .bhnode>` for a saved node.',
	'- Use `basehalf --run-operation \'<json>\'` only for `basehalf.workspace.move` and for operations that discovery returned.',
	'- Never author attempts or results.',
	'- Accepted runs continue after the session closes.',
	'- These commands work only inside Agent Area terminals.'
].join('\n');

/** The Claude Code flag that appends {@link BASEHALF_AGENT_LAUNCH_INSTRUCTIONS}. */
export const BASEHALF_AGENT_LAUNCH_INSTRUCTIONS_FLAG = '--append-system-prompt';
