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
- Keeping the `basehalf.workspace.move` operation. Tracking a rename that
  someone has to announce is the model this specification replaces. The
  operation is removed in the last step of this work, once the smoke shows
  that following works.

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
- **Followed item**: an item that has any card information. Every card has
  a row since [canvas card placement](canvas-card-placement.md), so every
  item whose card was shown is followed, also one the user never touched.
- **Fingerprint** of a file:
  - its size in bytes and the SHA-256 of its content. For a file larger than
    16 MiB the hash covers three windows of 1 MiB: the first, the last, and
    the one at the middle;
  - for a text file of at most 1 MiB, also its **pieces**: its words, in
    lower case, and for text in a script without spaces between words each
    pair of neighboring characters. For each distinct piece BaseHalf keeps a
    32-bit hash and a weight, its length times how often it occurs. A file
    with more than 512 distinct pieces keeps the 512 with the smallest
    hashes, so that two versions of a file keep the same ones. A file is
    text when its first 8 KiB hold no NUL byte.
- **Similarity** of two text files: the weight of the pieces they share,
  divided by the weight of the pieces of the larger file.
- **Why words and not lines.** Git compares lines. An agent that is asked to
  tighten a note rewords every sentence and keeps most of the words. In the
  trial of 2026-10-11 two agents did exactly that, and no line and no
  sentence of the note was left as it was, while two thirds and more of its
  own words were.
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
  so it adds nothing to git.
- **When a fingerprint is computed.** From saved disk content, never from an
  unsaved buffer:
  - when an item becomes followed, or comes under a followed folder;
  - again when a file event changed the file, once the folder's file events
    have been quiet for one second;
  - again at open, when the file's size or modification time differs from
    the snapshot, as git refreshes its index.
- An item that is followed only because an entry names it joins when the
  reference index is `ready`, because only the index knows the entries. When
  such an item moves, it stays followed at its new path while the entry that
  still names its old path is owed.
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
  - **What an earlier comparison already saw.** A file that appeared before
    an earlier comparison ran was there next to the file that disappears
    now, and BaseHalf saw them as two items. It is that file's new place
    only as a copy of it, with the same content, whose original was then
    deleted. It is never paired by mostly the same content. Without this
    rule, deleting one of two similar files that were made a moment ago
    would hand its card and the entries that name it to the other.
  - Waiting for the quiet second is deliberate. A file that is renamed to a
    backup name and written again at its old name has not moved: its path is
    there again by then, so it did not disappear.
  - **Noted when it happens.** When file events remove a file BaseHalf has
    a fingerprint for, and a file with the same content appeared in those
    events or shortly before, BaseHalf notes at once what that file holds.
    An agent often rewrites a file right after renaming it, and nothing of
    the old content may be left by the time the folder is quiet. The
    comparison then goes by what was noted, under rule 1 as for any files
    with the same content. So a renamed folder is still one pair, and among
    several copies the file name still decides.
  - **A file that only passed through.** A file without card information
    that is gone again before a comparison saw it, or that arrived with the
    content of a file that was just removed, is not something that
    disappeared. It was a temporary name on the way to the final one. This
    holds also when it got a fingerprint meanwhile as a file below a
    followed folder: otherwise a quick rename through a temporary name
    would leave two files with the same content that disappeared, and rule
    1 would pair neither.
  - **What was last seen is kept until the events say otherwise.** A file
    that cannot be read when its fingerprint is refreshed keeps the
    fingerprint it has. When many files are renamed at once their events
    arrive in several batches, and between two batches the files of the
    later ones are already gone from disk. Their fingerprints are what they
    are recognized by when their events arrive.
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
   each other. When exactly one file is left on each side after that, those
   two are paired. Anything else is not paired.
2. **Mostly the same content.** The text files that are still unpaired are
   compared, of those that appeared only the ones that are new in this
   comparison. Two files with the same content are not compared: rule 1
   has decided about them. A pair qualifies when all of these hold:
   - **Most of it is unchanged.** The similarity is at least one half, as
     git asks.
   - **What was particular to the old file is still there.** At least half
     of the pieces of the file that disappeared are in the file that
     appeared, when a piece counts less the more files have it: a piece
     that *n* other fingerprinted files also have counts with one part in
     *n* + 1 of its weight. Ordinary words, a shared heading, a template,
     and the frame of a generated file then count for little.
   - The pieces the two share weigh at least 32 characters.

   Pairs are taken in order of similarity, highest first, each file at most
   once; between equal pairs, one with the same file name comes first.
3. **A folder follows its files.** A followed folder that disappeared is
   paired with a folder that appeared and received most of its files: more
   than half of the files that the snapshot holds a fingerprint for below it
   were paired, by rule 1 or 2, with a file at the same relative path below
   that one folder. Files that were moved into a folder that was already
   there keep their own cards, and the old folder's card stays behind.
4. **Below a paired folder.** Every followed item below a paired folder that
   is still unpaired takes the same relative path below the folder's new
   path, as it does when a folder is moved through the workbench. An item
   that is no longer there leaves its card information without an item at
   the new path, as it would have at the old one.

Anything else is not recognized, and today's behavior applies: the sweep at
open marks its `badge.yaml` orphan, and the entries that name it show as
broken.

A file that appeared is fingerprinted only when a file disappeared in the
same comparison. Rule 2 is skipped when the number of unpaired text files
that disappeared times the number that appeared exceeds 1,000,000.

**Why rule 2 asks two questions.** Both earlier versions asked one, and
both were measured on the 364 Markdown files of this repository
([measurement](#verification)).

- The first left out every piece that a third file also had and compared
  what was left. That is right for whole sentences and wrong for words,
  because other notes use the same words. It left 134 files with fewer than
  32 characters of their own, among them nearly every file below 1 KB. Such
  a file could never have been recognized after an edit.
- The second counted such a piece less, in the same one comparison. Then a
  few new words that no other file has outweigh the ordinary words that
  stayed. A file of 35 lines with 3 lines replaced came out below one half.
- Asked apart, the first question is the one git asks, and new text counts
  in it as what it is. The second only looks at the old file, so new text
  cannot weigh it down.

Rule 2 can still pair two different files that are mostly the same text,
when one is deleted and the other is created in the same comparison or in
the minute after it: two
copies with small differences, or two notes made from one template that
hold little else when few other files have that template. The card of the
deleted one then shows on the new one. This is accepted, as git accepts it,
in place of a question.

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
   It stays a pending pair. While it is held back it does not keep the
   canvas from redrawing.
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
   - A layout file that BaseHalf cannot read in full is left as it is, at the
     old path and at the new one. Moving its readable rows would rewrite it.
   - The one exception is an orphan `badge.yaml` at the new path, which
     belongs to an item that is gone. BaseHalf saves it as a
     [recovery copy](mirror-file-resilience.md) and the moved card takes its
     place.
   - A relocated `badge.yaml` gets its new `path` and loses an orphan mark.
   - **A card row that BaseHalf chose** at the new path is not something of
     the user's, and gives way
     ([canvas card placement](canvas-card-placement.md#a-row-follows-its-item)).
     It is there when the item was drawn as a new card before it was known
     to be a moved one, or when an earlier run stopped after writing it. In
     the same folder the row that follows replaces it, so the card has the
     place and size it had. A row of the user's at the new path stands, as
     above.
   - **A card row that changes folder** does not keep its coordinates: they
     belong to the canvas it left. It goes to the end of the other canvas
     with its size, as a row BaseHalf chose, and a row BaseHalf chose that
     is already there keeps its place and takes that size, or goes to the
     end when it would reach a neighbour at that size. A folder without
     a layout gets no row, and the card appears when its canvas is first
     drawn. Either way the row at the old path is then removed, and a second
     run changes nothing.
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

**One item costs the same in any folder.** Relocation reads only the item's
own directory under `.bh/mirror/` and the layouts of the two parent folders.
It does not walk the rest of the mirror tree, so that a rename of many files
at once finishes inside the time the canvas waits. Measured in the trial of
2026-10-11: about 30 ms per file, where walking the whole tree took about
315 ms per file in a folder with 60 cards.

**Pending pairs.** A paired item is kept with the snapshot as a pending pair
until its relocation has finished: when it was held back, when the window
closed in the middle, and when a stage failed for an environmental reason.
BaseHalf tries every pending pair again at open, at each comparison, and
when the editor or the run that held it back ends. A failure is logged. It
shows no Retry and Skip notification: nothing the user did is waiting on it.

An item can move again before its card information has followed it. Then
there is still one pair for it, from where its card information is to where
the item is now:

- When the item of a pending pair is found at yet another path, or is moved
  there through the workbench, the pair ends there, and its card information
  goes to that path in one step. An item that is back at its old path needs
  nothing.
- When an item below a folder with a pending pair moves by itself, its own
  pair starts below the folder's old path, where its card information still
  is, and is relocated before the folder.
- When a pair is relocated while a later move of the same item was being
  recognized, the later pair starts at the path the card information has
  reached.

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
  old path any more, or the old path names an item again. A move outside the
  workbench is owed from the moment its card information has followed, so
  that a window that closes before the entries are written does not lose
  them. It tries again
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
name disappears. A card for the new name appears at the end of the canvas,
with "Loading preview…" and without a description. Only later would
relocation bring it back.

- **One change, not two.** A paired item's card keeps its place, its size,
  and its description, and shows its new name. The canvas does not draw a
  state in which the card is gone or somewhere else. To make this hold, the
  canvas does not redraw a folder for what happened on disk, from the
  removal of a followed item in it, of the folder itself, or of a folder
  above it, until the comparison has finished and relocation is done, for at
  most two seconds. Navigation and the user's own edits are drawn at once.
  After that it draws what is on disk and corrects itself when relocation
  has finished. A card of a file that was deleted outside
  BaseHalf therefore stays for about a second before it goes.
- **Each move gets its own wait.** The two seconds count from the first
  change of one move. Once the folder is settled again, or another folder is
  shown, the next change starts a new wait. A wait that ended at its limit
  is not started again for the same move.
- **At open.** The first drawing of a folder's canvas waits for the
  comparison of its workspace folder in the same way, for at most 500 ms.
- **The user's own edits are kept.** A card that the user drags or resizes
  while relocation runs stays where they put it, and no warning appears.
  When it is the card of the item that is being followed, its new place is
  saved under the item's new path.
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
  description at the end of the canvas.
- **The redraw after the wait is still a redraw for what happened on disk.**
  It does not replace a description the user is typing, and it waits again
  when another item is being recognized. Every card is followed now, so the
  wait is common
  ([canvas card placement](canvas-card-placement.md#every-shown-item-is-followed)).

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
  - never move, rename, or delete anything under `.bh/`. Editing a list
    there stays as the texts already describe it.
- Where a card's description and connections are does not change, so the
  rest of both texts stays.

## What is recognized

The answer is the same for every tool. Where it depends on whether BaseHalf
was running, the row says so.

| What happened to the item | Recognized |
| --- | --- |
| Renamed or moved, content unchanged | Yes |
| Renamed and edited or reworded, with at least half of its own words kept | Yes |
| Renamed, and then rewritten completely while BaseHalf runs | Yes, paired at the rename |
| A folder renamed as a whole, with more than half of its files recognizable | Yes, and the files in it that were rewritten come along |
| A folder's files moved one by one to a new folder, within a minute while BaseHalf runs | Yes |
| A folder renamed with most of its files rewritten | No |
| Moved by copying and deleting the original | Yes |
| Copied, the copy edited, and the original deleted in a later step, while BaseHalf runs | No: BaseHalf saw two files |
| A PDF, image, or other file that is not text, renamed and changed | No |
| Renamed and rewritten by more than half while BaseHalf was closed, or in one step | No |
| An empty file, or a folder that holds no file | No |
| Deleted, and written again more than a minute later while BaseHalf runs | No |
| Moved out of the workspace and brought back later | No |

An item that is not recognized is handled as today, whatever its kind: its
description stays at the old path, and so does a place the user gave it. A
place that BaseHalf chose for it is removed once the item is given up
([canvas card placement](canvas-card-placement.md#a-chosen-row-whose-item-is-gone)).
At its new path it is a new card at the end of the canvas.

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
23. **What many files share says little.** Two notes whose only common text
    is a heading are not paired. Two notes made from one template that
    several other notes also use, whose own text differs, are not paired,
    although the template is most of each. The same holds for two `.bhnode`
    documents with the same frame and different content. A small note of
    ordinary words, renamed and edited among notes that use the same words,
    is paired, also when the edit adds words that no other file has.
24. **A folder that was already there.** All files of a described folder are
    moved into another folder that existed before, and the old folder is
    deleted. The files keep their cards. The other folder's description is
    unchanged.
25. **In the product.** The smoke renames a described, placed PDF and a
    described, placed note from outside the window while BaseHalf runs, and
    does the same before a window reload with the note also edited. All four
    cards keep their description and their place. It also renames the folder
    whose canvas is open and finds the same cards and no error text. And it
    renames twelve placed notes of the open folder at once, after one of
    them went through a temporary name: every card keeps its place and its
    description, and in no frame is a card drawn anywhere else.
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
- The size of the snapshot before the limits are final. On 174 Markdown
  files of this repository a stored fingerprint is about 3 KB of JSON, which
  would be about 15 MiB for 5,000 followed notes, written whole at every
  save.
- The cost of an index that stays `partial`: every move then stays owed, up
  to 1,000 of them, and is planned again at each retry.

**Measurement, 2026-10-11**, on the 364 Markdown files of this repository,
with the implementation's own recognition: one file disappears, one appears,
and every other file is there.

- **Different files**, 66,066 pairs. 74 share at least half as written, the
  first question of rule 2. For 32 of them the pair is made when one is
  deleted and the other created. All 32 are copies of each other, files made
  from one template that hold little else, or two texts with most of their
  wording in common: `AGENTS.md` and `CLAUDE.md`, the same `CONTRIBUTING.md`
  in three extensions, the short `README.md` of the language extensions. The
  other 42 use the same vocabulary for different things, such as the plans
  of two phases, and are not paired.
- **The same file, edited**, against its own older version under a new name:
  16 of 16 changed files over 5 commits and 24 of 24 over 30 commits. Over
  100 commits 4 of 12: the 8 that are not paired share less than half with
  what they were.
- **Every file, renamed and edited.** With a tenth of its lines replaced by
  words that no other file has, 338 of 351 are paired. 11 of the 13 that are
  not hold less than 200 characters. With a third of its lines replaced, 316
  of 351.
- **What an agent does to a note.** The two rewrites of the trial below have
  a similarity of 0.83 and 0.69 with the note they came from. Both are
  paired, alone and among the files of this repository.

So the two questions of rule 2, each at one half, separate an edited file
from another file on this material. Technical documents are not personal
notes, and the check above stays.

**Trial for criterion 26, 2026-10-11.** A folder with a described PDF, a
described note, and a second note whose entries name both. Claude Code and
Codex each got two tasks in it, with the skill text of version 2 and no
BaseHalf window: rename the PDF, and rename the note and tighten its wording.

- All four runs renamed with `mv`, left `.bh/` as it was, and changed the
  entries in the second note to the new path themselves.
- The reworded note kept no line as it was.
- BaseHalf's own service, opened on the folder as it was before each run,
  closed, and opened again on what the agent left, recognized all four: the
  PDF by the same content, the note by mostly the same content.
- From a recognized pair to the card, the path is the one that the tests and
  the smoke of criterion 25 cover. The trial did not open a window on these
  four folders.

**Tried in the real window, 2026-10-11.** A folder of 82 invented personal
notes, mostly Chinese, with diary and meeting templates, short memos, lists,
long notes, PDFs and images; 65 cards described, 53 placed by hand, 15
connections. A script moved files from outside the window and recorded every
frame of the canvas.

- **Twelve kinds of change**: rename, rename and rewrite at once, rename of
  an unplaced card, move to another folder, rename of a folder from its
  parent and while its canvas is open, rename of a PDF, two quick renames,
  20 renames at once, delete, copy and then delete the original, and delete
  one of two similar lists. In each, the card changed in one frame, about
  1.7 to 2.1 seconds after the change on disk, at the same place and size
  and with its description. No frame showed the item without a card, with
  two cards, or at another place. No notification appeared. The connections
  of a renamed card were missing for one frame.
- **While the user is at it.** A note that was open in the main surface
  when it was renamed stayed open and showed its new name, with no error
  text. A card that was dragged 300 ms after its file was renamed, before
  the canvas showed the new name, was saved at the place it was dragged to,
  under the new path.
- **Recognition on these notes.** Renamed only: 82 of 82. With a paragraph
  added, 5% of the characters changed, the format changed, or the paragraphs
  reordered: 79 to 81. The notes that were missed are the three diary pages
  that hold only the template's headings, which have less than 32
  characters to be recognized by. With one line in five rewritten: 73. With
  two in five: 57. With three in five: 15. Of 6,642 ordered pairs of
  different notes, 2 would be paired when one is deleted and the other
  created: a note and its reworked second version. A deleted diary page or
  meeting note and a new one from the same template: 0 of 30.
- **Agents.** Claude Code and Codex, each with the skill text of version 2,
  were asked in plain words to rename 20 diary pages, to sort a folder into
  subfolders by subject, to rename a long note and tighten its wording, to
  sort meeting notes by month, and, with BaseHalf closed, to rename a folder
  and change the title line of every note in it. In all five runs every
  described card that moved kept its description, 29 of 29, every card
  placed by hand that stayed in its folder kept its place, the affected
  connections pointed to the new paths, the canvas changed once, and the
  agent left `.bh/` alone.
- **What this found and what was changed for it.** Two quick renames below a
  followed folder were not followed. Of 20 files renamed at once, 4 were
  followed. The canvas was not held for a second move after a first one, and
  drew the cards at automatic places before it corrected itself. Relocation
  walked the whole mirror tree for every file. The rules "A file that only
  passed through", "What was last seen is kept until the events say
  otherwise", "One item costs the same in any folder", and "Each move gets
  its own wait" are the fixes.
- **Changed after the trial.** A card that was moved to another folder kept
  its coordinates in that folder's layout and could land on a card that was
  there. [Canvas card placement](canvas-card-placement.md) puts it at the
  end of that folder's canvas instead, for moves inside BaseHalf and outside
  it.

## Open questions

1. **The limits.** 16 MiB, 1 MiB and 512 pieces, 200 files per folder,
   200,000 items, the one, ten, and 60 seconds, the time the canvas waits,
   and one half and 32 characters for similarity are first values. The measurements under
   Verification decide them. None blocks implementation.
