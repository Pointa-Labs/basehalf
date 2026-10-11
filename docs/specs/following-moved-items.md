# Following items moved outside BaseHalf

Status: Active (2026-10-11). Reviewed three times; the third review, of the
git model, is folded in. Implementation in progress; the specifications
listed under [Specifications this changes](#specifications-this-changes) are
updated in the commit that implements the part they describe.
Decision: [D44](../decisions.md#d44--a-cards-information-follows-its-item-whoever-moved-it-new-2026-10-11)
Related: [reference graph](reference-graph.md),
[mirror file resilience](mirror-file-resilience.md),
[workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
[agent skill](agent-skill.md), [agent launch context](agent-launch-context.md)

## Problem

BaseHalf keeps what it knows about a card under the card's path:

- the description, appearance, reading aids, and a kept upstream list are in
  `.bh/mirror/<path>/`;
- the card's place on the canvas is a row in its parent folder's
  `canvas.yaml` that names the path;
- upstream entries in other items name the path.

A path changes whenever the item is moved or renamed. When the move goes
through the workbench, BaseHalf updates all of this. A move made by anything
else leaves all of it at the old path: an agent in its own application or in
a plain terminal, the Finder, git, a sync client. Afterwards BaseHalf finds a
file it holds nothing for and information for a file that is gone. It cannot
tell that they are the same item, so no amount of waiting repairs it.

The `basehalf.workspace.move` operation, the instruction to agents to use it
instead of `mv`, and the orphan mark all work around this. They cover only a
session started in Agent Area while BaseHalf runs. In the
[recorded trials](agent-skill.md#recorded-trials) of the agent skill, Claude
Code and Codex each renamed a described file outside Agent Area, and the
description stayed at the old path in every run.

BaseHalf is the container that intelligence flows through. A container that
needs every agent to rename files through its own command is not one.

## The one thing this solves

An item that an agent or the user renames or moves with ordinary tools keeps
its card. Nothing else is in scope.

There is one method, and it is the same for every kind of item. Card
information stays where it is today. BaseHalf recognizes the item at its new
path and moves what it keeps for it. It asks the user nothing. Where it does
not recognize an item, it does nothing, and today's behavior applies.

## The model: what git does

Git has the same problem and a settled answer. BaseHalf takes it over.

- **It does not track renames.** Nobody tells git that a file moved, and git
  watches nothing. It keeps a snapshot of what it last saw.
- **It compares two snapshots.** What is in the old one and not in the new
  one disappeared. What is only in the new one appeared.
- **It infers a rename from content.** A file that disappeared and a file
  that appeared are the same file when their content is the same, or mostly
  the same: at least half, by git's default. Git uses this rule also when it
  merges, where a wrong pair changes files.
- **A folder is where its files are.** Git has no folders of its own. A
  folder was renamed when its files went to another folder.
- **It never asks.** What it cannot pair is a deletion and an addition.

This fits what tools leave behind, measured on 2026-10-11. Claude Code's
edit tools replace the file on every edit, and Codex's patch tool renames by
writing a new file, so the file system's own identity for a file does not
survive either. Content survives every way of moving a file, and most of it
survives an edit. So the outcome depends on what happened to the content and
not on which tool did it or on whether BaseHalf was running.

What BaseHalf does not take from git: storing things under a hash of their
content. Card information stays under the item's path, where an agent finds
it by path, and where an edit to the file changes nothing.

## Goals

- **Whatever BaseHalf can update by itself, it updates by itself.** The user
  does not know that a card's information is stored anywhere, and is never
  asked to keep it in step.
- **What the canvas shows is what is stored.** A connection on the canvas
  always has its entry in a store, and a stored entry always shows on the
  canvas, as a connection or as a broken entry. Neither is ever ahead of the
  other for longer than one redraw.
- A renamed or moved item keeps its card without anyone doing anything: no
  command for agents, no background program, no question to the user.
- One method for all items. A note is not handled differently from any other
  file.
- The same result whichever tool moved the item, and whether or not BaseHalf
  was running.
- No new button, notification, list, or setting.
- Where card information is stored does not change, and BaseHalf writes
  nothing new into the workspace folder.

## Non-goals

- A file whose content changed by more than half while it was renamed. It is
  another file by then, and its old description would not describe it.
- An empty file, and a folder that holds no file. They have no content to
  recognize.
- An item that is moved out of the workspace and comes back later. It
  disappeared in one comparison and appeared in another.
- A followed path that another item took over, as when `b.md` is renamed
  away and `a.md` is renamed to `b.md`. The card stays with the path.
- A move between workspace folders.
- A copy. A copy is a new item without a card.
- Removing the `basehalf.workspace.move` operation. It becomes unnecessary
  and is removed in a later change.

## Terms

- **Item**: a file or folder in a workspace folder that the canvas could show.
  The [reference graph](reference-graph.md#terminology) calls it a node.
- **Card information** of an item:
  1. its files under `.bh/mirror/<path>/`: `badge.yaml`, `appearance.yaml`,
     `adhd.yaml`, and `upstream.yaml`; for a folder also its `canvas.yaml` and
     everything below its mirror directory;
  2. its card row and its edge anchor rows in its parent folder's
     `canvas.yaml`;
  3. the upstream entries in other items' stores that name its path, or for a
     folder a path inside it.
- **Followed item**: an item that has any card information.
- **Fingerprint** of a file:
  - its size in bytes and the SHA-256 of its content. For a file larger than
    16 MiB the hash covers three windows of 1 MiB: the first, the last, and
    the one at the middle;
  - for a text file of at most 1 MiB, also its **pieces**. A piece is a
    line, divided further after `.`, `!`, `?`, and `;` when white space
    follows, and after `。`, `！`, `？`, and `；`. Notes are often written one
    paragraph per line, and whole lines would make one changed word cost the
    paragraph. For each piece that is not blank, BaseHalf keeps a 32-bit
    hash of it without surrounding white space, and its length. A file with
    more than 512 pieces keeps the 512 with the smallest hashes, so that two
    versions of a file keep the same ones. A file is text when its first
    8 KiB hold no NUL byte.
- **Similarity** of two text files: the length of the pieces they share,
  counted with repetition, divided by the length of the pieces of the larger
  file. Counting length and not pieces keeps a shared heading or a shared
  `---` from making two short notes look alike, as git's measure does.
- **Snapshot**: what BaseHalf last saw in a workspace folder.
- **Free place**: a place at the new path that holds nothing, or only the
  canonical empty file that retirement leaves behind
  ([workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)).
  Such an empty file is not card information.

## The snapshot

- One snapshot per workspace folder. It holds:
  - the path and kind of every item the canvas could show, under the
    exclusions of the
    [reference index's enumeration](reference-graph.md#sources). Symbolic
    links are left out. This listing is new: the index lists only Markdown
    and `.bhnode` files;
  - the fingerprint, with the size and modification time it was computed at,
    of every followed file and of the first 200 files below each followed
    folder, at any depth, in path order. The second group is what lets a
    folder be recognized by its files when they have no cards of their own;
  - the pairs that still wait for relocation, and the
    [entry updates](#entries-are-always-updated) that are still owed.
- It is kept in a file of its own in BaseHalf's application storage for the
  workspace on this machine. It is never written into the workspace folder,
  so it adds nothing to git and opening a folder still writes nothing there.
- **When a fingerprint is computed.** From saved disk content, never from an
  unsaved buffer:
  - when an item becomes followed, or comes under a followed folder;
  - again when a file event changed the file, once the folder's file events
    have been quiet for one second;
  - again at open, when the file's size or modification time differs from
    the snapshot, as git refreshes its index.
- An item that is followed only because an entry names it joins when the
  reference index is `ready`, because only the index knows the entries.
- A workbench move or delete updates the snapshot inside its own operation.
- **The same path.** On a volume that ignores letter case or Unicode form, a
  path that differs from a snapshot path only in those is the same path. The
  snapshot takes the new spelling and nothing is moved.
- A snapshot that is lost or was never written is taken from what is on disk.
  Moves made before that are not recognized.
- A snapshot that is behind after a crash only makes BaseHalf find the same
  things again, and relocation is safe to repeat.

## When BaseHalf compares

- **At open.** As soon as a workspace folder opens or is added, BaseHalf
  lists it and compares it with the snapshot. Everything that changed while
  it was closed is one comparison. Comparison and the relocation of mirror
  files and canvas rows do not wait for the reference index. Only the entries
  step of relocation does.
- **While it runs.** BaseHalf keeps two short lists for the workspace folder:
  what file events removed that it has a fingerprint for or that is a
  followed folder, and what they added. An item stays on its list for 60
  seconds.
  - A comparison runs when the folder's file events have been quiet for one
    second, and at the latest ten seconds after the first of them. It pairs
    across the two lists by the rules below. A pair that was made earlier in
    the same 60 seconds still counts for a folder.
  - Waiting for the quiet second is deliberate. A file that is renamed to a
    backup name and written again at its old name has not moved: its path is
    there again by then, so it did not disappear.
  - After 60 seconds an unpaired item that disappeared is deleted, as far as
    BaseHalf is concerned, and is never paired with something that appears
    later. This is what keeps a new note from taking the card of a similar
    note that was deleted long ago.
- **File events name the top of a change.** Removing a folder is one event,
  and covers everything the snapshot holds below it. An added folder is
  listed, because its files may have no events of their own.
- **After lost events.** After a watcher error, or file events for more than
  1,000 paths at once, BaseHalf lists the folder and compares as at open.
  The reference index does the same.
- **A pair that could not be relocated** because its new path was gone again
  goes back on the list. A rename through a temporary name is then paired
  with the final name.
- **Before the existing checks.** The orphan sweep at open, and the
  reappearance check for an added path, run only after the comparison has
  considered that path. A path that was paired gets no reappearance check.
- Reading is done without the workspace mutation lease: the listing and the
  fingerprints. Only relocation takes it.
- A marked folder is never touched (the
  [source-tree guard](spec-driven-development.md#basehalf-source-tree-boundary)).

## Recognition

A comparison has two lists. What **disappeared**: the files the snapshot
holds a fingerprint for, and the followed folders. What **appeared**: every
item that is new. Only these are paired. An item that was already there is
never a candidate, so an old copy of a file cannot take its card. Relocation
then acts on the pairs of followed items.

1. **Same content.** A file that disappeared is paired with a file that
   appeared and has the same size and hash. When several files on either
   side share that content, files with the same file name are paired with
   each other. Those that this does not decide are not paired.
2. **Mostly the same content.** The text files that are still unpaired are
   compared. Pieces that a third fingerprinted file also has are left out on
   both sides: they are a shared heading, a template, or the frame of a
   generated file, and say nothing about which file this is. A pair
   qualifies when the similarity of what is left is at least one half and
   the two share at least 32 characters of it. Pairs are taken in order of
   similarity, highest first, each file at most once; between equal pairs,
   one with the same file name comes first.
3. **A folder follows its files.** A followed folder that disappeared is
   paired with a folder that appeared and received most of its files: more
   than half of the files that the snapshot holds a fingerprint for below it
   were paired, by rule 1 or 2, with a file at the same relative path below
   that one folder. Files that were moved into a folder that was already
   there keep their own cards, and the old folder's card stays behind.
4. **Below a paired folder.** Every followed item below a paired folder that
   is still unpaired takes the same relative path below the folder's new
   path, when an item of its kind is there.

Anything else is not recognized, and today's behavior applies: the sweep at
open marks its `badge.yaml` orphan, and the entries that name it show as
broken.

A file that appeared is fingerprinted only when a file disappeared in the
same comparison. Rule 2 is skipped when the number of unpaired text files
that disappeared times the number that appeared exceeds 1,000,000.

Rule 2 can still pair two different files that share most of the text that
only they have, when one is deleted and the other is created in the same
comparison. The card of the deleted one then shows on the new one. This is
accepted, as git accepts it, in place of a question.

## Relocation

For each paired item, BaseHalf moves its card information from the old path
to the new one.

1. **Exclusive, without refusing the user.** Relocation runs alone against
   other writes of card information in the workspace folder, and open
   canvases and Card Detail are told about its outcome as after a workbench
   move. A drag, a resize, or a connection that the user makes meanwhile is
   not refused: it waits and is applied when relocation has finished.
   Neither existing mode does both. The structural reservation of a
   workbench move refuses a canvas edit made while it is pending, and the
   card returns to its old place with a warning. The plain lease tells no
   one. Relocation needs a mode that does both.
2. **Check again.** The old path still names nothing and the new path still
   names an item of the same kind. Otherwise the item is skipped.
3. **Held back**: an item with unsaved changes in an editor for its old path
   or below it, and a `.bhnode` that is running or a folder that holds one.
   It becomes a pending pair.
4. **Mirror files and canvas rows** move piece by piece. A piece is one
   mirror file, or one row of a `canvas.yaml`.
   - A piece moves when its place at the new path is free. Then the piece at
     the old path is removed.
   - When the new place already holds exactly the piece that is being moved,
     only the piece at the old path is removed. This is what an interrupted
     move leaves, and it makes the move safe to repeat.
   - Anything else at the new place stays as it is, and the piece stays at
     the old path. Nothing at the new path is replaced, retired, or
     rewritten.
   - The one exception is an orphan `badge.yaml` at the new path, which
     belongs to an item that is gone. BaseHalf saves it as a
     [recovery copy](mirror-file-resilience.md) and the moved card takes its
     place.
   - A relocated `badge.yaml` gets its new `path` and loses an orphan mark.
5. **Entries.** Once the reference index is `ready` or `partial`, it reads
   the stores at the new paths, including a kept upstream list that moved
   with its item. Then every entry that still names an old path, and whose
   old path names no item, is rewritten to the new path. BaseHalf does not
   ask and shows nothing. See
   [entries are always updated](#entries-are-always-updated) for the stores
   it cannot write at that moment.
6. **Snapshot.** The snapshot takes the new paths.

These rules make relocation safe to repeat, also when it stopped between
writing a piece at the new path and removing it at the old one. The
workbench's move cascade is not safe to repeat: it retires what is at the
destination, and it replaces rows and reading aids there. Relocation needs
its own variant of those stages and never runs the workbench one.

**Pending pairs.** A paired item is kept with the snapshot as a pending pair
until its relocation has finished: when it was held back, when the window
closed in the middle, and when a stage failed for an environmental reason.
BaseHalf tries every pending pair again at open, at each comparison, and
when the editor or the run that held it back ends. A failure is logged. It
shows no Retry and Skip notification: nothing the user did is waiting on it.

Nothing is added to the undo stack. Moving the item back is recognized like
any other move.

## Entries are always updated

The entries that name a moved item are updated in the same way after every
move: a move this specification follows, and a move through the workbench.

- BaseHalf rewrites them without asking and shows no notification.
- The setting `basehalf.references.updateOnFileMove` is removed, with its
  prompt, its **Always Update** and **Skip** actions, and the "Updated K
  items" message.
- **Undo.** The update adds no undo step of its own. Undoing a workbench
  move is a move back and updates the entries back. With a step of its own,
  one Undo would break every entry while the file kept its new name.
- **What is owed is remembered.** For each move BaseHalf keeps the old and
  the new path with the snapshot until no store that it may write names the
  old path any more, or the old path names an item again. It tries again
  when the reference index becomes `ready`, when a document is saved or
  reverted, when a `.bhnode` run ends, and at open. This covers a document
  with unsaved changes, a `.bhnode` that is running, and stores that a
  `partial` index did not see. Moves compose: after `a` to `b` and `b` to
  `c`, entries that name `a` or `b` get `c`. At most 1,000 moves are kept.
- Until an owed entry is rewritten it is broken in the store and shows as
  broken, so the canvas and the store agree.
- **A store that is never rewritten** stays as the
  [rename refactor](reference-graph.md#rename-refactor) defines: sealed and
  imported Result artifacts, and bound entries of attempted and sealed
  `.bhnode` documents. They keep the old path on purpose.
- **A marked folder** is never rewritten by itself, neither its notes nor its
  sidecars. The rename refactor asked there; with the question gone, it
  leaves the entries as they are.
- The other rules of the rename refactor stay: which entries are rewritten,
  entries inside a moved folder, case-only renames, whose spelling is now
  updated without a question, and store kind changes, whose entries now
  move into the file without a question.

## What the user sees

The aim is that the user notices nothing. Without the rules below, a rename
outside BaseHalf would be followed correctly and still look wrong. Today the
canvas lists the folder again 100 ms after a file event. The card of the old
name disappears. A card for the new name appears in an automatic grid slot,
which can lie on top of other cards, with "Loading preview…" and without a
description. Only later would relocation bring it back.

- **One change, not two.** A paired item's card keeps its place, its size,
  and its description, and shows its new name. The canvas does not draw a
  state in which the card is gone or somewhere else. To make this hold, the
  canvas does not redraw a folder from the removal of a followed item in it
  until the comparison has finished and relocation is done, for at most two
  seconds. After that it draws what is on disk and corrects itself when
  relocation has finished. A card of a file that was deleted outside
  BaseHalf therefore stays for about a second before it goes.
- **At open.** The first drawing of a folder's canvas waits for the
  comparison of its workspace folder in the same way, for at most 500 ms.
- **The user's own edits are kept.** A card that the user drags or resizes
  while relocation runs stays where they put it, and no warning appears.
- **Connections stay drawn.** The connections of a paired item are drawn to
  its card in the same redraw that shows its new name. The entries that name
  it are rewritten before that redraw, except those in a store that cannot
  be written right now.
- **An open canvas follows its folder.** When the folder whose canvas is
  open is paired with a new path, the canvas shows that folder at the new
  path with the view it had. Today the canvas stays on the old path and
  shows the file system's error text on an empty canvas. This also happens
  when the folder is renamed through the workbench, and the same fix covers
  it.
- **An open editor follows its file.** An editor or a Card Detail that is
  open on the old path without unsaved changes shows the item at its new
  path. One with unsaved changes is left as it is and holds relocation back.
- **A stored view follows its folder.** The saved canvas view of a paired
  folder, and of the folders below it, is kept for the new path.
- **Nothing is announced.** No notification, no button, no list. BaseHalf
  logs each relocation.
- **Not recognized.** As today: the item is a new card without a
  description in an automatic place.

## What agents are told

The texts for agents get shorter.

- The shared sections of the [launch instruction](agent-launch-context.md)
  and of the [agent skill](agent-skill.md) drop the instruction to use
  `basehalf.workspace.move` instead of `mv`, and the rules for when the
  operation is out of reach.
- They say instead, as facts and not as steps (D36):
  - an item can be moved and renamed with ordinary tools;
  - entries name items by path, so an entry that names an old path is broken
    until it is updated, by the agent or by BaseHalf;
  - never edit, move, or delete anything under `.bh/`.
- Where a card's description and connections are does not change, so the
  rest of both texts stays.

## What is recognized

The answer is the same for every tool, and whether or not BaseHalf was
running.

| What happened to the item | Recognized |
| --- | --- |
| Renamed or moved, content unchanged | Yes |
| Renamed and edited, at least half of its text unchanged | Yes |
| A folder renamed as a whole, with more than half of its files recognizable | Yes, and the files in it that were rewritten come along |
| A folder's files moved one by one to a new folder, within a minute while BaseHalf runs | Yes |
| A folder renamed with most of its files rewritten | No |
| Moved by copying and deleting the original | Yes |
| A PDF, image, or other file that is not text, renamed and changed | No |
| Renamed and rewritten by more than half | No |
| An empty file, or a folder that holds no file | No |
| Deleted, and written again more than a minute later while BaseHalf runs | No |
| Moved out of the workspace and brought back later | No |

An item that is not recognized is handled as today, whatever its kind: its
description and its place stay at the old path.

## Limits

- A workspace folder with more than 200,000 items the canvas could show gets
  no snapshot, and nothing is recognized there. BaseHalf logs this.
- A file that cannot be read has no fingerprint in that comparison.
- Two windows on the same folder each compare on their own. Relocation
  replaces nothing and is safe to repeat, so both end with the same result.
  The implementation shows this with a test.

## Specifications this changes

When this becomes Active, the same commit updates:

- [reference graph](reference-graph.md): the setting and the prompt of the
  Rename refactor, "Outside the workbench" under it, and "Agent moves";
- [mirror file resilience](mirror-file-resilience.md): the non-goal
  "Following files that are moved or deleted outside BaseHalf", the last rule
  of "The stored path", and the order of the orphan sweep and the
  reappearance check;
- [workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md):
  the application storage table, the rule that a moved folder's canvas view
  is forgotten, and the release notes;
- [agent launch context](agent-launch-context.md) and
  [agent skill](agent-skill.md): the content contract, the skill's version,
  and a new recorded trial;
- [architecture invariants](../harness/architecture-invariants.md) and the
  [harness](../harness/README.md) route.

## Acceptance criteria

Unit tests unless another kind is named. "Outside" means with the file
system and not through the workbench. Criteria 1 to 4 are each run for a
described PDF and for a described note where the criterion applies to it,
with the same expectations.

1. **Same content.** The item has a description and a card row and is
   renamed outside. Its `badge.yaml` and card row are at the new path with
   the same description and geometry, and no card information is left at the
   old path. Once at open, once while running. Once with a rename call, once
   with the file written to the new path and the old one deleted. Renaming
   it back outside brings everything back to the first path.
2. **Mostly the same content.** A note is renamed and a third of its text
   is changed, while no window is open. Its card is at the new path after
   open. The same holds when the new file is written with those changes in
   one step.
3. **Rename, then edit, while running.** A note is renamed outside and its
   file is replaced, with a third of its text changed, 500 ms later. Its
   card is at the new path.
4. **Too different.** A note is renamed and two thirds of its text is
   changed. A PDF is renamed and one byte is changed. Nothing moves and
   nothing is shown. The badge is marked orphan at open as today.
5. **Folder.** A folder that holds a described PDF and two described notes
   is renamed outside, and one note is rewritten completely. The folder's
   card and all three children's cards are at the new paths. The same holds
   when the files are moved one by one to a new folder within a minute and
   the old folder is deleted, and when the folder's files have no cards and
   sit in a subfolder.
6. **Only what appeared.** A followed file is deleted while a file with the
   same content, which was there at the last comparison, exists elsewhere.
   Nothing moves.
7. **Not later.** A described note is deleted while running. Two minutes
   later a note with the same content is created. It gets no description. A
   note that is written again two seconds after it was deleted keeps its
   card, and so does one that is copied to a new name eleven seconds before
   the original is deleted.
8. **Several candidates.** A followed file disappears and two files with
   its content appear, one of them with its file name. The card goes to
   that one. With neither having its name, nothing moves.
9. **Entries.** A note lists the renamed item as upstream. After relocation
   the entry names the new path, nothing was asked, and nothing was shown.
   The same holds for a move through the workbench, and undoing that move
   restores the entry with one Undo. A note with unsaved changes keeps a
   broken entry, which shows as broken, and gets the new path when it is
   saved, also after a restart in between. In a marked folder nothing is
   rewritten.
10. **Nothing is replaced.** The new path already has a description and a
    card row. After relocation both are unchanged, and the old description
    is still at the old path. With an orphan `badge.yaml` at the new path,
    the moved description takes its place and a recovery copy exists.
11. **Safe to repeat.** Relocation is stopped once after a whole stage, and
    once after a piece was written at the new path and before it was removed
    at the old one. The comparison runs again. Both results equal that of an
    uninterrupted run.
12. **Held back.** With unsaved changes in an editor for the old path, the
    item is not relocated. It is relocated when the changes are saved to
    another path or discarded, without any file event.
13. **Workbench moves.** A move through the workbench leaves the snapshot at
    the new paths and pairs nothing. The existing cascade and refactor tests
    stay green. The one change for it is criterion 19.
14. **Nothing in the workspace, nothing shown.** A comparison in which
    nothing disappeared writes nothing into the workspace folder. No path in
    this specification shows a notification. A marked folder is never
    touched.
15. **The snapshot.** A lost snapshot is taken again and recognizes nothing
    for earlier moves. A note that was edited while no window was open and
    renamed outside after the next open is recognized, because its
    fingerprint was computed again at open.
16. **Before the index.** At open, mirror files and canvas rows are at the
    new path while the reference index is still `building`. The entries are
    updated when it is `ready`.
17. **One change on the canvas.** While running, an item with a card row is
    renamed outside. No scene that the canvas publishes lacks its card or
    shows it at another position or without its description.
18. **The user's edit is kept.** A card position that is saved while
    relocation runs is stored after it, and no warning is shown.
19. **The open canvas follows.** The canvas is open on a folder that is
    renamed outside. It shows the same cards at the new path with the same
    view and no error text. The same holds for a rename through the
    workbench.
20. **The open editor follows.** A Card Detail without unsaved changes is
    open on a note that is renamed outside. It shows the note at its new
    path.
21. **A backup is not a move.** While running, a described file is renamed
    to a backup name and written again at its old name half a second later.
    Its card stays at the old name.
22. **Shown is stored.** After every comparison and relocation in these
    tests, the scene the canvas publishes equals what the reference index
    reports: a connection for each entry that names an item, and a broken
    entry for each that does not.
23. **What files share with others says nothing.** Two notes whose only
    common text is a heading are not paired. Two notes made from one
    template, whose own text differs, are not paired, although the template
    is most of each. Two `.bhnode` documents with the same frame and
    different content are not paired.
24. **A folder that was already there.** All files of a described folder are
    moved into another folder that existed before, and the old folder is
    deleted. The files keep their cards. The other folder's description is
    unchanged.
25. **In the product.** The smoke renames a described, placed PDF and a
    described, placed note from outside the window while BaseHalf runs, and
    does the same before a window reload with the note also edited. All four
    cards keep their description and their place. It also renames the folder
    whose canvas is open and finds the same cards and no error text.
26. **Agents.** Recorded once, not automated: with the new skill text,
    Claude Code and Codex each rename a described PDF, and rename and edit a
    described note, outside Agent Area with their own tools and with no
    BaseHalf window open. After the next open all four cards have their
    descriptions.

## Verification

- Unit tests for fingerprints and similarity, and for recognition as a pure
  function of the snapshot and the items on disk. That function takes no
  file type: one method serves every kind of item.
- Unit tests on an in-memory file system for comparison and relocation.
- The smoke steps of criterion 25.
- Measurements on a real folder before the limits are final: the listing and
  comparison at open for 100,000 files with 5,000 followed and nothing
  changed, the first fingerprints of a workspace with 5,000 followed files,
  and the fingerprint of a 2 GiB video.
- A check of rule 2 against real notes before it ships: for the maintainer's
  own workspaces, how similar unrelated notes are to each other, so that one
  half is confirmed or replaced by a measured value.

**First measurement, 2026-10-11**, on the 362 Markdown files of this
repository, with the implementation of similarity:

- Different files against each other, 65,341 pairs: 5 reach one half, and
  99.5% are below 0.1. The 5 are files that are copies or close variants of
  each other on purpose, such as `AGENTS.md` and `CLAUDE.md`, and two sibling
  skill files at 0.59. No pair of unrelated documents reaches one half.
- A file against its own older version: 7 of 7 changed files stay at or
  above one half over 5 commits, and 10 of 13 over 30 commits. The 3 below
  were replaced or largely rewritten.

So one half separates an edited file from another file on this material.
Technical documents are not personal notes, and the check above stays.

## Open questions

1. **The limits.** 16 MiB, 1 MiB and 512 pieces, 200 files per folder,
   200,000 items, the one, ten, and 60 seconds, the time the canvas waits,
   and one half and 32 characters for similarity are first values. The measurements under
   Verification decide them. None blocks implementation.
