# Agent launch context

Status: Active (2026-09-27)
Decision: [D36](../decisions.md#d36--basehalf-stops-writing-agent-guides-into-workspaces-new-2026-09-27)
Related: [reference graph](reference-graph.md),
[workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md)

## Problem

BaseHalf no longer writes instructions into workspace `CLAUDE.md` or
`AGENTS.md`. Agents started from Agent Area still need to know how BaseHalf
stores relationships, and how to discover and run canvas workflows:
`basehalf --list-capabilities`, `--run-node`, and `--run-operation`.

Agent Area launches these agents itself, so BaseHalf can pass that context at
launch without touching user files.

## Scope

In scope: Claude Code TUI sessions that Agent Area launches on the local
machine, on macOS and Linux. A session qualifies when
`baseHalfAgentSessionUsesLocalNodeRunBridge(kind, isRemote)` is true for
`tui-claude`; that predicate is what makes the `basehalf` commands work.

These receive no launch context:
- Codex TUI. Codex has no append-only instruction flag, and overriding
  `developer_instructions` would replace the user's own value. Passing it only
  when the user sets none is not safe yet either: Codex also takes that value
  from `/etc/codex/config.toml`, from project `.codex/config.toml` files above
  the workspace folder, and from a `CODEX_HOME` that only the terminal
  environment may define. Its default sandbox also denies the `basehalf` bridge
  socket, so the agent move the instruction relies on would be refused. Codex
  still sees the `upstream` lists of Markdown and `.bhnode` files in the files
  themselves.
- VS Code extension agents.
- Plain Terminal sessions.
- Remote sessions.
- Windows. Argument quoting through command shims is not verified.
- Sessions whose workspace has any folder marked with
  `.basehalf-no-workspace-setup`. Development sessions on the BaseHalf source
  tree must not receive product instructions.

## Mechanism

The instruction text is a string constant exported from
`vs/workbench/basehalf/common/basehalfAgentLaunchInstructions.ts`. It is part of
the application bundle, so no local process can change it.
- The text stays under 4 KiB, measured in UTF-8.
- For a qualifying session, `baseHalfTuiSessionLaunchConfig` returns
  `args: ['--append-system-prompt', TEXT]`.
- Restarts use the same function, so a restart keeps the argument.

If a session that was launched with the argument exits with a non-zero code
within 5 seconds, before any user input, Agent Area relaunches it once without
the argument. It logs the reason, and that session and its restarts continue
without launch context. An installed Claude Code that rejects the argument
therefore never makes the TUI unusable.

When any terminal process exits with a non-zero code, the exit message that
names its command line shows an argument that contains a line break and is
longer than 200 characters by its first non-blank line followed by `…`. The
instruction text therefore never floods the terminal after, for example, the
user declines Claude Code's folder trust prompt. Shorter arguments, such as a
multi-line shell task, stay unchanged.

## Content contract

The instruction covers the following, in this order.

1. **Where it runs.** The session runs inside a BaseHalf workspace. Ordinary
   files are the content. The hidden `.bh/` folder holds BaseHalf project
   metadata:
   - canvas layout;
   - reading aids;
   - each card's one-line `description`, in `.bh/mirror/<path>/badge.yaml`;
   - the upstream lists of non-Markdown nodes, in
     `.bh/mirror/<path>/upstream.yaml`.

   Read a node's `description` when you need to know what the user says it is
   for. Never delete or regenerate `.bh/`. Edit it only when the user asks.
2. **Relationships.** `A → B` means A's context flows into B. The downstream
   file lists its upstream paths:
   - a Markdown note, under the `upstream` key of its frontmatter;
   - a `.bhnode`, under its `upstream` field;
   - any other node, in `.bh/mirror/<path>/upstream.yaml`. A note with no
     `upstream` key may have its list there too.

   Each entry is relative to the workspace folder, uses forward slashes, has no
   `./` and no leading `/`, and names a folder without a trailing slash. Quote
   entries that YAML would read as numbers or booleans. For example:

   ```yaml
   ---
   upstream:
     - courses/linear-algebra/overview.md
     - sources/strang.pdf
   ---
   ```

   To find what flows out of X, search for X's path in the `upstream` entries
   of Markdown and `.bhnode` files and in `.bh/mirror/**/upstream.yaml`. `.bh`
   is hidden, so search it explicitly. Markdown links never create
   relationships.
3. **Preserving relationships.**
   - When you rewrite or restructure a file, edit it in place and keep its
     frontmatter, including the upstream list, unchanged. Never delete and
     recreate it.
   - To move or rename a file or folder, use the
     [agent move](reference-graph.md#agent-moves) operation
     `basehalf.workspace.move` instead of `mv` or `git mv`, and show the
     example command. `from` and `to` are full paths relative to the workspace
     folder, not to the current directory, and `to` is the new path, not a
     folder to move into. Say how to write a `'` inside the shell-quoted JSON.
     BaseHalf moves the item's metadata with it and updates the `upstream`
     entries that name it. Tell the user what the result lists under
     `skipped`, `incomplete`, or `notUpdated`, and leave those entries as they
     are.
   - If the operation is refused, do not move the item: fix the request when
     the error is about a path, and otherwise tell the user why. If it returned
     no result, `cancelled`, or a refusal about the terminal, check whether
     `from` still exists before doing anything else.
   - Only if `basehalf` is not found, or it says Agent operations are
     available only inside a BaseHalf TUI Agent session, move the item
     yourself. Then update every `upstream` entry that names its old path, or a
     path inside it, including those in `.bh/mirror/**/upstream.yaml`, which
     is the one `.bh/` edit allowed without being asked. Tell the user that
     its BaseHalf metadata stayed at the old path (for a folder or a file that
     is not Markdown or `.bhnode`, that includes its own upstream list), and
     that moving it back and renaming it in BaseHalf restores it.
   - Moving keeps a relationship; it does not change one.
   - When the user asks you to create a note from other files, list those
     files under the new note's `upstream`. Otherwise add or remove entries
     only when the user asks.
   - An older "BaseHalf workspace" section in `CLAUDE.md` or `AGENTS.md` that
     mentions `current_focus.yaml`, `references`, or `referenced_by` is out of
     date. Follow this instruction instead.
4. **Canvas workflows.**
   - Before any other canvas workflow, run `basehalf --list-capabilities`.
     Its JSON is the only authority for recipes, slots, parameters, document
     formats, and every operation except `basehalf.workspace.move`.
   - Use `basehalf --run-node <workspace-relative .bhnode>` for a saved node.
   - Use `basehalf --run-operation '<json>'` only for
     `basehalf.workspace.move` and for operations that discovery returned.
   - Never author attempts or results.
   - Accepted runs continue after the session closes.
   - These commands work only inside Agent Area terminals.

## Acceptance criteria

1. The launch configuration table holds:
   - A local `tui-claude` session on macOS or Linux, with no marked folder,
     includes `--append-system-prompt` and the text, and a restart keeps it.
   - A remote session, a Windows session, a marked workspace, a Codex TUI
     session, and a plain terminal session do not include it.

   This is covered by a pure unit test.
2. An early non-zero exit relaunches the session once without the argument.
   Unit test.
3. A unit test holds the text under 4 KiB in UTF-8 and locks these phrases:
   - `relative to the workspace folder`
   - `keep its frontmatter, including the upstream list`
   - `update every \`upstream\` entry that names its old path`
   - the move example command
   - `not to your current directory`
   - `do not move the item`
   - `Only if \`basehalf\` is not found`
   - `Never delete or regenerate \`.bh/\``
   - `out of date`
   - `basehalf --list-capabilities`
   - the example block
4. A unit test shows the terminal exit message for a long multi-line argument
   by its first non-blank line and `…`, and leaves a short multi-line argument
   unchanged.
