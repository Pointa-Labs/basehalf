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
  socket, so the canvas workflow commands would be refused. Codex still sees the `upstream` lists of Markdown and `.bhnode` files in the files
  themselves.
- VS Code extension agents.
- Plain Terminal sessions.
- Remote sessions.
- Windows. Argument quoting through command shims is not verified.
- Sessions whose workspace has any folder marked with
  `.basehalf-no-workspace-setup`. Development sessions on the BaseHalf source
  tree must not receive product instructions.

## Mechanism

Launch context is the instruction text below. What an Agent Area terminal's
environment declares to the programs in it, such as
`CLAUDE_CODE_FORCE_SYNC_OUTPUT`, belongs to
[Agent Area terminal](agent-area-terminal.md#scroll-regions-for-claude-code)
and reaches every Agent Area terminal, whether or not it receives launch
context.

The instruction text is a string constant exported from
`vs/workbench/basehalf/common/basehalfAgentLaunchInstructions.ts`. It is part of
the application bundle, so no local process can change it.
- The text stays under 4 KiB, measured in UTF-8.
- For a qualifying session, `baseHalfTuiSessionLaunchConfig` returns
  `args: ['--append-system-prompt', TEXT]`.
- Restarts use the same function, so a restart keeps the argument.
- **With the BaseHalf skill.** When the [agent skill](agent-skill.md) is
  installed for Claude Code, TEXT is a short pointer instead of the full
  instruction, because the skill holds the same sections: "You are running
  inside a BaseHalf workspace, started from BaseHalf's Agent Area. The
  `basehalf` skill describes this workspace: where a card's description and
  its upstream and downstream connections are, how to move and rename files
  so that they keep them, and how to run canvas workflows. Use that skill
  before you read, write, move, or rename anything here." Whether the skill
  is installed is read when the session launches. Everything else in this
  section applies to both texts.

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
   - upstream lists BaseHalf keeps, in `.bh/mirror/<path>/upstream.yaml`.

   Read a node's `description` when you need to know what the user says it is
   for. Never delete or regenerate `.bh/`. Edit it only when the user asks.
2. **Relationships.** `A → B` means A's context flows into B. The downstream
   file lists its upstream paths:
   - a Markdown note, under the `upstream` key of its frontmatter;
   - a `.bhnode`, under its `upstream` field;
   - any other node, in `.bh/mirror/<path>/upstream.yaml`. A note with no
     `upstream` key may have its list there too: then edit that list, not the
     note.

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
   - Files and folders can be moved and renamed with ordinary tools. BaseHalf
     recognizes the item at its new path, by its content, and moves what it
     keeps for it under `.bh/`
     ([following moved items](following-moved-items.md)). The text names no
     operation for moving.
   - Entries name items by path, so an entry that names the old path of a
     moved item is broken until it is updated. BaseHalf updates them when it
     sees the move, and the agent may update them too.
   - Never move, rename, or delete anything under `.bh/`. BaseHalf does that
     itself.
   - Moving keeps a relationship; it does not change one.
   - When the user asks you to create a note from other files, list those
     files under the new note's `upstream`. Otherwise add or remove entries
     only when the user asks.
   - An older "BaseHalf workspace" section in `CLAUDE.md` or `AGENTS.md` that
     mentions `current_focus.yaml`, `references`, or `referenced_by` is out of
     date. Follow this instruction instead.
4. **Canvas workflows.**
   - Before any canvas workflow, run `basehalf --list-capabilities`. Its JSON
     is the only authority for node documents, templates, and operations.
   - A Video node is a `.bhnode` whose `kind` is `video`. Write only its
     `title`, `prompt`, `upstream`, and `generation`; BaseHalf writes `task`
     and `result`. Its inputs are its `upstream` entries, in order
     ([Video node](video-node.md#what-an-agent-may-write)).
   - Use `basehalf --run-node <workspace-relative .bhnode>` to start a saved
     Video node. It prints the path of the node that runs and does not wait
     for the video.
   - Use `basehalf --run-operation '<json>'` only for operations that
     discovery returned.
   - A generation continues after the session closes.
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
5. With the skill installed for Claude Code, a qualifying session's argument
   is the pointer text, which names the `basehalf` skill. Without it, the
   argument is the full instruction. Both are recognized when the argument is
   stripped for a relaunch. Unit test.
