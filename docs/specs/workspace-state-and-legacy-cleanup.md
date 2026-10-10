# Workspace state and legacy cleanup

Status: Active (2026-09-27)
Decisions: [D35](../decisions.md#d35--the-focus-mirror-is-removed-new-2026-09-27),
[D36](../decisions.md#d36--basehalf-stops-writing-agent-guides-into-workspaces-new-2026-09-27)
Related: [reference graph](reference-graph.md), [agent launch context](agent-launch-context.md)

## Problem

Earlier releases mirrored the user's live position into two places: a symlink
at `.bh/current_focus.yaml` and a `focus.yaml` file per node under
`.bh/mirror/`. They also wrote an instruction section into the user's
`CLAUDE.md` and `AGENTS.md`, and installed `.bh/agent-harness/`, so that agents
would read that position every turn.

This caused several problems:
- Agents did not read the position reliably.
- The position went stale when the user returned from Card Detail to a canvas
  or left the app.
- Rich-text columns were rendered-text offsets, not source columns.
- Every cursor move churned git.
- User-owned root files were rewritten without being asked.

Agents' own `@` file mentions and IDE integrations already cover pointing at a
location.

## Goals

- Remove the focus mirror and every writer and reader of it.
- Keep per-folder canvas viewports as per-machine UI state instead of
  workspace files.
- Stop writing agent guides into workspaces, and stop editing `.gitignore`.
- Remove artifacts earlier releases wrote. BaseHalf-owned `.bh/` artifacts are
  removed automatically and disclosed. User-owned root files change only after
  confirmation.
- State plainly what BaseHalf persists in a workspace.

## Non-goals

- A replacement live "what the user is looking at" signal for agents.
- Managing `.gitignore`.
- Changing whether the root `CLAUDE.md` and `AGENTS.md` are hidden. They stay
  hidden by default as agent configuration. The cleanup notification's **Show**
  action is the in-product way to inspect them.

## What BaseHalf persists

In the workspace, under `.bh/`:

| Path | Kind | Content |
| --- | --- | --- |
| `.bh/mirror/<path>/badge.yaml` | project metadata | description |
| `.bh/mirror/<path>/upstream.yaml` | project metadata | the upstream list of a non-Markdown node (reference truth, [reference graph](reference-graph.md#sidecar-store)) |
| `.bh/mirror/<folder>/canvas.yaml` | project metadata | card layout and edge anchor memory |
| `.bh/mirror/<file>/adhd.yaml` | project metadata | reading aids |
| `.bh/mirror/<path>/appearance.yaml` | project metadata | visual presentation |
| `.bh/legacy-references.yaml` | project metadata | append-only migration record, only after a migration |
| `.bh/cache/` | machine-local runtime state | run leases, undo stashes, and recovery copies of mirror files BaseHalf could not read ([mirror file resilience](mirror-file-resilience.md)); not meant for git |

BaseHalf does not create or edit `.gitignore`. Lines that earlier releases
appended stay unless the user removes them. Project metadata may be committed,
so that canvas layout, descriptions, and non-Markdown upstream lists travel
with the folder. The release notes recommend ignoring `.bh/cache/`.

`.bh/mirror/<path>/` holds the per-node files above. A workbench move or
delete relocates or retires them through the mirror cascade
([mirror file resilience](mirror-file-resilience.md) defines what the cascade
does with content it cannot read and with a stage that fails). Once every
required stage of that cascade has finished, including after a Retry but not
after a Skip, BaseHalf
removes the directories left without any entry inside the moved or deleted
item's old mirror directory, bottom-up, then that directory's ancestors up to,
but not including, `.bh/mirror/`. It removes only empty directories, one at a
time, and never follows or removes a symbolic link. In a marked folder it
removes nothing. This step is best effort: a failure is logged and never
refuses, blocks, or reverses the operation.

Retirement can leave canonical empty files behind: a badge without a
description, an empty canvas, or an empty reading-aid file. The mirror services
use them as compare-and-swap tombstones, and a directory that holds one stays.
Directories that the cascade empties elsewhere, such as under a replaced
destination, are not pruned.

BaseHalf no longer writes any of these:
- `focus.yaml`;
- `.bh/current_focus.yaml`;
- `.bh/agent-harness/`;
- a section in `CLAUDE.md` or `AGENTS.md`.

Opening a folder no longer creates `.bh/` by itself.

In VS Code storage (this machine):

| Key | Scope | Content |
| --- | --- | --- |
| `basehalf.canvas.folderViewports.v1` | workspace | per-folder canvas viewport |
| `basehalf.cleanup.agentGuides.kept.v1` | workspace | folders where the user chose Keep for old agent guides |
| `basehalf.cleanup.mirrorNotice.v1` | workspace | folders already told about removed `.bh/` files |
| `basehalf.references.firstFrontmatterNotice.v1` | application | whether the first-frontmatter notice was shown |
| `basehalf.canvas.pendingTemplateSetups.v2` | workspace | pending template setups ([reference graph](reference-graph.md#templates)) |

## Canvas viewport state

`IBaseHalfCanvasViewportStateService` owns the viewport state.

- **Storage.** It uses `StorageScope.WORKSPACE` and `StorageTarget.MACHINE`,
  under `basehalf.canvas.folderViewports.v1`.
  - The value is a JSON map. Each key is a folder resource made canonical
    through `IUriIdentityService`.
  - Each value holds the canvas-space center `x` and `y`, the `zoom`, and a
    `source`: `user`, `auto`, or `import`.
  - The map is least-recently-used, capped at 256 entries. Invalid values are
    ignored.
- **Restore.** On canvas open, the stored viewport is restored when present.
  Otherwise the canvas fits its content, as it does today. Restore for a folder
  first waits up to 500 ms for the legacy import of that folder's workspace
  folder to finish.
- **Write.** A settled viewport is written after the existing 200 ms debounce.
  - Pan, zoom, fit, and zoom-menu changes are recorded with source `user`.
  - The automatic first fit is recorded with source `auto`. An `auto` value
    never replaces a `user` or `import` value, so a legacy import wins however
    the debounced write and the import are ordered.
  - A pending write is flushed on canvas dispose and on
    `IStorageService.onWillSaveState`.
  - A write that settles after its folder moved is dropped, because the scene
    must still be current.
- **Move or delete.** A workbench folder move or delete forgets the stored
  viewports for that folder and every folder below it.

Viewports no longer travel with the folder or through git. A workspace opened
on another machine, or under another workspace identity, fits on first open.

## Focus removal

- Nothing writes or reads `focus.yaml` or `.bh/current_focus.yaml`.
- The main-process mirror-link symlink service and its registrations are
  removed.
- Card Detail projections no longer report cursor, visible lines, or visible
  blocks.
- The rich editor no longer computes or sends focus fields. It keeps the side
  effect that cancels a pending point-focus placement on edits, selection
  changes, scrolling, reveal, and external merges.
- It also keeps two helpers: the scroll anchor used by external merges, and
  the line-to-block mapping used by ADHD reading aids, reveal, and read spans.

## Legacy cleanup

`IBaseHalfWorkspaceSetupService` becomes the legacy cleanup service. It runs
for each workspace folder when the folder is opened or added. For a marked
folder (its root contains `.basehalf-no-workspace-setup`, or the marker's
existence cannot be determined), it writes nothing. It returns a result with
`skipped: 'marker'` and logs one info line.

### Safety rules

- Cleanup for a folder runs under that folder's workspace mutation lease
  (`runExclusive`), so it never interleaves with the mirror cascade, migration,
  or canvas writes.
- The walk never descends into, or follows, a directory entry that is a
  symbolic link, at any depth under `.bh/`. If `.bh` itself is a symbolic link,
  cleanup skips the folder.
- Immediately before each delete, BaseHalf re-checks with
  `baseHalfAssertMirrorPathComponentsNotSymbolicLink` that no component from the
  workspace folder to the target is a link. It also re-checks that the target
  is still the file it classified: the same regular file, or, for
  `current_focus.yaml` and its tmp files, the same symbolic link.
- Deletes are non-recursive. Deleting a symbolic link removes the link, never
  its target.
- A failure in one item is logged and does not stop later items. The next open
  retries.
- Every step is idempotent and cheap enough to run on each open. Collaborators
  on older builds may recreate these files through git; cleanup removes them
  again.

### Automatic: BaseHalf-owned `.bh/` artifacts

The steps run in this order:

1. **Viewport import.** Each regular file `.bh/mirror/**/focus.yaml` that
   parses as a folder focus document (`kind: folder`, numeric
   `viewport_center`, positive `zoom`) is imported into viewport state with
   source `import`. The import replaces a stored viewport only when that
   viewport is missing or has source `auto`. A file whose `path` field does not
   match its mirror location is not imported (step 3 still deletes it).
2. **Current focus.** `.bh/current_focus.yaml` is deleted when it is a symbolic
   link. When it is a regular file, it is deleted only if it parses as a focus
   document; otherwise it is left and logged. Leftover
   `current_focus.yaml.*.tmp` symbolic links are deleted.
3. **Focus files.** Every regular file named `focus.yaml` under `.bh/mirror/`
   is deleted, whatever its content. A directory named `focus.yaml` is never
   deleted: a user file named `focus.yaml` owns a mirror directory of that
   name.
4. **Agent harness.** In `.bh/agent-harness/` and
   `.bh/agent-harness/scenarios/`, every regular file whose content starts
   with `<!-- bh:agent-harness managed` is deleted. The directories are removed
   only when empty. Every other file is kept.
5. **Empty directories.** Only empty, non-link directories under `.bh/mirror/`
   and `.bh/agent-harness/` that became empty through these deletions are
   removed.

When this pass removed anything in a folder, BaseHalf shows one information
notification for that folder, once per machine:

> BaseHalf removed N files that earlier versions kept for itself and no
> longer uses. Your notes and canvas layout were not changed.

In a multi-root workspace the message names the folder ("removed N files in
<folder> that…"). It does not name `.bh/` or the kinds of files (D41); the
removal is logged.

The notification offers **Show in Source Control** when the folder is a git
repository: the Git view is part of BaseHalf's own sidebar, and it is where
these removals show up for someone who keeps the folder in git. Later removals
are only logged.

### Confirmed: user-owned root files

The candidate files are `CLAUDE.md`, `AGENTS.md`, and
`.github/copilot-instructions.md` in each workspace folder root. A file
qualifies when it contains a BaseHalf section: `<!-- bh:workspace-hint -->`, or
`<!-- bh:recall-hint -->`.

**Notification.** It is shown after any migration notification has been
answered or closed; otherwise it waits until the next session. It is one sticky
notification that covers every folder that has qualifying files and where Keep
has not been chosen:

> Earlier BaseHalf versions added agent instructions to <file list>. They point
> agents at files BaseHalf no longer uses. Remove them? <files with nothing
> else> will be moved to the trash.
>
> Remove · Show · Keep

- **Show** opens each file in the Source projection with the BaseHalf section
  selected, one after another in navigation history, so Back reaches the
  earlier ones. The notification stays open.
- **Keep** is remembered per workspace folder on this machine.
- Closing without choosing shows the notification again next session.
- The command **BaseHalf: Remove Old Agent Instructions** runs Remove on
  demand, regardless of Keep.

**Remove** processes each file as follows:

1. Re-read the file. A file that has unsaved changes in an editor, is a
   symbolic link, or cannot be read is skipped.
2. Compute the change from those bytes, and write it with
   `writeFileWithExpectedContents` against them. On a mismatch, skip the file.
3. A closed section is removed from the start of the open-marker line through
   the line break that ends the close-marker line, plus one empty line
   immediately before the open-marker line if present. Everything after it is
   kept verbatim.
4. An open-marker-only or recall-hint section runs from its marker to the end
   of the file. That text is compared with the section bodies that shipped
   releases wrote, kept in a checked-in fixture taken from git history. The
   comparison ignores BOM, CRLF versus LF, and trailing whitespace. Then:
   - If the text equals a known body, the section, plus one preceding empty
     line, is removed, and the file is made to end with exactly one line break.
   - If a known body is followed by other text, the known body and one
     preceding empty line are removed, and the rest is kept verbatim.
   - Otherwise the file is unchanged and reported.
5. The written file keeps its BOM, its line endings, and every byte outside the
   removed section. Normalization is used only for comparison.
6. Suppose what remains, after the same comparison normalization, equals a
   BaseHalf-created base: `# CLAUDE.md` or `# AGENTS.md`, each with or without
   the line "Instructions AI coding agents read when working in this folder.",
   or `# Copilot instructions`. Then the file is moved to the trash. If the
   trash is unavailable, the file is left with that base text and reported.
   BaseHalf never deletes a root file permanently.

Remove ends with a report: "Removed the BaseHalf section from N files (K moved
to the trash)." Each skipped file is named with its reason and an **Open**
action. The notification returns next session for files that still contain a
section.

## Agent Area

Agents no longer receive BaseHalf context through workspace files. Agent Area
Claude Code sessions receive the launch-time instruction defined in
[agent launch context](agent-launch-context.md).

## Release notes

Each delivery slice adds only the statements that are true in its build. The
release that contains every slice states:

- Connecting two cards saves the connection with the card it points to. For
  a note, it is saved inside the note itself, so agents and other tools that
  read the note see it too. For PDFs, folders, and other files, BaseHalf keeps
  the list for you.
- The badge edits a card's Upstream list. Downstream shows what draws on it.
- Moving or renaming a file in BaseHalf offers to update the upstream lists
  that name it.
- Connections from earlier versions move into your files after you confirm.
- If BaseHalf can't read a card's upstream list, the badge offers Rebuild
  List, which keeps the connections it can read.
- Files and folders whose names look like numbers, such as 09, keep their
  place on the canvas.
- When BaseHalf can't read something it saved for a canvas or a card, it keeps
  working with what it can read and keeps a copy of the rest. It never asks
  you to open or fix a file.
- If BaseHalf can't finish updating its cards and badges after you move or
  delete something, you can Retry or Skip instead of being blocked.
- BaseHalf removes files that earlier versions kept for itself and no longer
  uses. It offers to remove the sections it added to CLAUDE.md and AGENTS.md,
  and remembers where you left each canvas on this computer.
- If you keep your notes in git: the removed files show up as deletions,
  BaseHalf no longer edits .gitignore, and we recommend ignoring .bh/cache/. A
  folder that ignores all of .bh/ does not share the upstream lists of PDFs,
  folders, and other non-note files.

The statements are written for someone who does not read code (D41): they do
not name file formats or show names in code formatting. The one statement
addressed to people who keep their notes in git names `.bh/`, because the
advice cannot be followed without it.

## Acceptance criteria

1. On a fresh in-memory folder, a unit test runs the workspace-open
   contributions (cleanup, canvas open, the reference index build, and
   migration detection). It finds no resource under `.bh/` and no change to
   `CLAUDE.md`, `AGENTS.md`, or `.gitignore`. The smoke confirms that the first
   canvas render adds or changes nothing under `.bh/` in its seeded fixture. A
   grep over `src/vs/workbench/basehalf` for
   `focus.yaml|current_focus|agent-harness` finds only cleanup code, tests, and
   the launch instruction sentence that calls old sections out of date.
2. Canvas viewports:
   - A viewport survives closing and reopening the folder and the window.
   - It is forgotten after a workbench folder move or delete.
   - A pending viewport is not lost on dispose.
   - A legacy folder viewport wins over an automatic fit made before the
     import finished.
3. Cleanup imports legacy folder viewports, then deletes the legacy symbolic
   link, the focus files, and the sentinel harness files. It spares user
   files, directories named `focus.yaml`, a regular `.bh/current_focus.yaml`
   that does not parse as focus, symbolically linked directories at any depth,
   and link targets.
   The symbolic link cases are tested against a real temporary directory.
4. Root-file cleanup:
   - The notification appears only when a BaseHalf section exists.
   - Remove deletes exactly the specified bytes.
   - Text after a legacy section that is not part of a known body is kept.
   - Line endings and BOM are unchanged.
   - Only boilerplate-only files are moved to the trash; without a trash they
     are kept and reported.
   - Keep suppresses the notification for that folder.
   - Dirty, symbolically linked, and concurrently changed files are skipped
     and reported.
5. A marked folder is never changed, and its result carries
   `skipped: 'marker'`.
6. After a workbench move of a file or a folder whose metadata moves with it,
   and after a permanent delete of a node with only a sidecar, no empty
   directory remains at the old mirror path or its emptied ancestors. A
   directory that still holds a file, such as a tombstone or an `upstream.yaml`
   kept by a delete to the trash, stays, and so do the directories of sibling
   nodes and symbolic links. A marked folder keeps its directories.
