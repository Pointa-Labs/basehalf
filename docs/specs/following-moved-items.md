# Following items moved outside BaseHalf

Status: Active (2026-10-11). Reviewed three times; the third review, of the
git model, is folded in. Implementation in progress; the specifications
listed under [Specifications this changes](#specifications-this-changes) are
updated in the commit that implements the part they describe.
Decisions: [D44](../decisions.md#d44--a-cards-information-follows-its-item-whoever-moved-it-new-2026-10-11),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22)
(generation information, drafts, and generating cards)
Related: [reference graph](reference-graph.md),
[mirror file resilience](mirror-file-resilience.md),
[workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
[agent skill](agent-skill.md), [agent launch context](agent-launch-context.md),
[generation cards](generation-cards.md)

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
  The [reference graph](reference-graph.md#terminology) calls it a node. A
  draft is an item too: a `generation.yaml` with no `made.yaml` and no file
  yet ([generation cards](generation-cards.md#drafts-and-missing-files)).
- **Card information** of an item:
  1. its files under `.bh/mirror/<path>/`: `badge.yaml`, `appearance.yaml`,
     `adhd.yaml`, `upstream.yaml`, `generation.yaml`, and `made.yaml`; for a
     folder also its `canvas.yaml` and everything below its mirror directory;
  2. its card row and its edge anchor rows in its parent folder's
     `canvas.yaml`;
  3. the upstream entries in other items' stores that name its path, or for a
     folder a path inside it.
- **Followed item**: an item that has any card information. Every card has
  a row since [canvas card placement](canvas-card-placement.md), so every
  item whose card was shown is followed, also one the user never touched.
  The folders above a draft are followed too, also one the canvas never
  showed, such as a folder where an agent wrote a draft: a draft has no file
  to be recognized by, and comes along when its folder does (rule 4).
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
    files and drafts;
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
    have been quiet for 300 ms;
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
  - A comparison runs when the folder's file events have been quiet for
    300 ms, and at the latest ten seconds after the first of them. It pairs
    across the two lists by the rules below. A pair that was made earlier in
    the same 60 seconds still counts for a folder.
  - **Why 300 ms.** It was one second at first, a value nobody had measured,
    and every rename outside BaseHalf showed a second late. Measured on
    2026-10-11 with a watcher on the folder:
    - the events of one operation arrive together: a rename, `mv`, a rename
      through a temporary name, a save that renames the file to a backup
      and writes it again, a save that replaces the file, a move that
      writes a new file and deletes the old one;
    - the events of many arrive in batches at most 53 ms apart: 20 and 200
      renames in a loop, a folder of 200 files copied and its original
      deleted, a branch checkout that renames 20 files;
    - the file watcher itself hands on a change of more than 500 files in
      batches 200 ms apart.

    300 ms is longer than all of these. What it does not cover, no wait of
    this kind can: an agent that renames a file with one tool call and
    rewrites it with the next, seconds later. The rules "Noted when it
    happens" and "What an earlier comparison already saw" are for that.
  - **What an earlier comparison already saw.** A file that appeared before
    an earlier comparison ran was there next to the file that disappears
    now, and BaseHalf saw them as two items. It is that file's new place
    only as a copy of it, with the same content, whose original was then
    deleted. It is never paired by mostly the same content. Without this
    rule, deleting one of two similar files that were made a moment ago
    would hand its card and the entries that name it to the other.
  - Waiting until the folder is quiet is deliberate. A file that is renamed
    to a backup name and written again at its old name has not moved: its
    path is there again by then, so it did not disappear.
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
- **What a drawing has already seen.** The canvas reads a folder from disk
  when it draws it. File events for the same change reach BaseHalf later.
  The file watcher hands on a change of thousands of files in batches of 500,
  200 ms apart, and its first batch can hold a few files only. A drawing in
  between sees a renamed file as one card that is gone and one that is new.
  - When a drawing finds that an item with a card row is not in the folder
    any more, and file events have not told BaseHalf, the canvas tells it.
    BaseHalf looks at each such path again by itself. An item that is gone
    is taken as removed, and the items of that folder that BaseHalf did not
    know are taken as added, exactly as if file events had said so.
  - The file events that arrive later for the same change find it known and
    change nothing.
  - A file that was taken as removed and is written again can arrive as one
    update of its path, because the file watcher joins a removal and an
    addition of the same path. BaseHalf takes that update as an addition, so
    that it knows the file again.
  - A drawing for what the user did is drawn as it is. A redraw for what
    happened on disk is not shown while the folder is not settled: the
    canvas waits as it does for any item that is being recognized
    ([what the user sees](#what-the-user-sees)). Whether the folder is
    settled decides, and not which drawing told BaseHalf: one drawing can
    tell and be overtaken by the next.
  - Found on 2026-10-11 with 2,100 files renamed at once, 100 of them in the
    folder that was shown. The first batch of events held 16 files. BaseHalf
    paired them, the canvas drew, and 84 cards lost the places BaseHalf had
    chosen for them: their rows were removed as rows of deleted files before
    their events had arrived.
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
   the new path, as it would have at the old one. A draft below the folder
   is such an item: its card information takes the new path, and it is a
   draft there, as it was at the old one.

Anything else is not recognized, and today's behavior applies: the sweep at
open marks its `badge.yaml` orphan, and the entries that name it show as
broken. The sweep never marks the `badge.yaml` of a draft: a draft is card
information without a file by design. A generation card whose generated file
is gone, which has a `made.yaml`, is not a draft, and the sweep treats it as
any file that is gone.

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
to the new one. The pairs that are pending in a workspace folder are
relocated in one run ([many items at once](#many-items-at-once)).

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
   or below it.
   It stays a pending pair. While it is held back it does not keep the
   canvas from redrawing. A generation card that generates, or a folder that
   holds one, is not held back: the same run writes the card's new path into
   its task record, once the card's `generation.yaml` is at the new path, so
   that its files land where the card is
   ([generation cards](generation-cards.md#moving-renaming-copying-and-undo)).
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
     `generation.yaml` and `made.yaml` store no `path` and move as they are.
   - **The path a task record names always holds the card's
     `generation.yaml`.** A card's `generation.yaml` and then its `made.yaml`
     are copied first, the task records take the new paths, and only then
     are the old copies removed, `generation.yaml` first. A run that stops in
     between leaves the generation information at both paths, and the next
     run finishes it.
   - **A card whose `generation.yaml` finds its place taken** keeps all of
     its card information at the old path, its badge, appearance, and
     upstream list included, so that a card's information stays together, and
     its task record keeps naming the old path.
   - **A draft at the new path moves aside.** When the item arrives at the
     path of a draft, the draft's card information and card row first move
     to the next free name, as a rename of the draft does, and the item's
     own card information then moves in
     ([generation cards](generation-cards.md#drafts-and-missing-files)). The
     next free name is the first numbered name of the folder at which neither
     an item nor any card information is, so that nothing is replaced. The
     same holds below a paired folder, for each of its items that arrives at
     a draft's path. The entries that named the draft's path name the item
     that took it from then on. A `generation.yaml` at the new path with
     exactly the bytes of the item's own at the old path is the item's, which
     a run that stopped had begun to move, and not a draft's.
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
It does not walk the rest of the mirror tree. Measured in the trial of
2026-10-11: about 30 ms per file, where walking the whole tree took about
315 ms per file in a folder with 60 cards.

### Many items at once

The pending pairs of a workspace folder are relocated in one run, in the
order in which they were recognized. The result is the one that relocating
each pair by itself, in that order, gives. What changes is how often a file
is read and written.

1. **Checked together.** Rules 2 and 3 are applied to every pair first, and
   whether the item has a directory under `.bh/mirror/` is looked up with
   them. A pair below another pair of the same run is left for the next run:
   it starts again where its card information is after this one. When the
   pair above it fails, it waits with it.
2. **A layout is read once and written once.** Every layout that holds a row
   of a pair that passed is read once. The rows follow pair after pair as
   rule 4 says, on what was read. Then each layout that changed is written
   once.
3. **New places before old ones, as for one pair.** A layout that takes a row
   in is written before the layout that the row leaves, so that a run that
   stops in between leaves the row in both and never in neither. When one
   pair takes a row out of a layout that another pair puts a row into, the
   two cannot be written in such an order. The run then writes in more than
   one step, and each step holds the pairs that can.
4. **One layout that cannot be written does not hold the others.** When a
   step fails, each of its pairs is relocated by itself. The pairs whose
   layouts could be written are done, and only the others stay pending.
5. **Mirror files** move item after item, as rule 4 says. An item without a
   directory under `.bh/mirror/` has none, and nothing more is read for it.
6. **Reported together.** The canvas, the open editors, and the entries step
   are told about all the pairs of the run at once. The canvas then draws
   them in one redraw.

A drag, a resize, or a connection that the user makes while the run lasts
waits until it has finished, as rule 1 says for one pair.

**Why.** Relocating each pair by itself cost 20 to 35 ms a file, measured on
2026-10-11 with timing lines in the program itself, in a folder of 300 placed
notes without descriptions:

| Renamed at once | Checks | Layout | Mirror files | Empty directories | From the first card to the last |
| --- | --- | --- | --- | --- | --- |
| 20 | 16 ms | 331 ms | 60 ms | 84 ms | 0.48 s |
| 100 | 214 ms | 3,482 ms | 881 ms | 731 ms | 5.7 s |

Six tenths of it rewrote the same layout once for every file: a read, a
write, and a read to check it, of all 300 rows each time. A quarter looked
for mirror files that these notes do not have, four times for each note, and
for empty directories. With 100 files the run was longer than the canvas
waits. The canvas then drew the notes that had not been followed yet as new
cards at the end, and moved each back when its pair was done. Whether the
window was sampled in every frame during the measurement made no difference:
32 ms a file without, 34 ms with.

**Measured after the change**, on the same day and machine, in the real
window, with every frame of the canvas recorded. The folder that is shown
holds 300 placed notes, in a workspace of 4,300. "Before" is the build before
this section, the reference index's
[one pass over the stores](reference-graph.md#events), and
[what a drawing has already seen](#when-basehalf-compares).

| Renamed at once | Before: new names drawn | After: every row followed | After: new names drawn |
| --- | --- | --- | --- |
| 1 | 0.50 s | 0.43 s | 0.50 s |
| 20 | 1.13 s | 0.45 s | 0.53 s |
| 50 | 2.51 s | 0.45 s | 0.57 s |
| 100 | 7.97 s, with cards at other places in 468 frames and as few as 274 of 286 cards drawn | 0.58 s | 0.80 s |
| 200 | did not finish | 0.74 s | 1.10 s |
| 300 | not measured | 1.11 s | 1.63 s |
| 300, and 700 in other folders | not measured | 2.85 s | 3.44 s |
| 100, and 2,000 in other folders | not measured | 4.52 s | 4.70 s |

- In every row after the change, each renamed card kept its place, and no
  frame showed a card at a place that is not its own. In one frame of each
  run, up to fourteen cards at the right edge that the canvas does not draw
  otherwise were drawn.
- The machine ran other programs during these runs, with a load average of
  14 to 24. One of four runs of a single rename, the first change after the
  folder was opened, took 2.4 seconds. The other three took 0.5.
- The run of 100 files itself, from the first check to the last report, took
  about 60 ms, where it had taken 5.7 seconds.
- With 300 files, the time from the rename to the comparison had been 3.6
  seconds. A processor profile of the window showed 2.7 seconds of it in the
  reference index, which compared every deleted path with every store. It
  is 13 ms since the index drops the paths of a batch in one pass.
- The last two rows did not work before
  [what a drawing has already seen](#when-basehalf-compares): with 1,000
  files the canvas drew at its old limit of two seconds and showed cards at
  other places for a second, and with 2,100 files 84 to 87 of the 100 cards
  lost their places. In the row of 1,000 the file watcher dropped events,
  and BaseHalf compared with the disk as after any lost events.
- With thousands of files the canvas waits for the last file event of the
  whole change, because every batch of events starts the quiet time again.
  That is the 4.4 seconds of the last row.
- Not changed: the lists that the comparison keeps are gone through once for
  each removed, added, and paired file. That is about 0.3 seconds of the
  1.1 seconds for 300 files in a workspace of 4,300.

**Pending pairs.** A paired item is kept with the snapshot as a pending pair
until its relocation has finished: when it was held back, when the window
closed in the middle, and when a stage failed for an environmental reason.
BaseHalf tries every pending pair again at open, at each comparison, and
when the editor that held it back ends. A failure is logged. It
shows no Retry and Skip notification: nothing the user did is waiting on it.
A pair whose relocation failed does not keep the canvas from redrawing, like
a pair that is held back: it waits for the next try, and the canvas does not
wait for it.

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
  reverted, and at open. This covers a document with unsaved changes and
  stores that a `partial` index did not see. The list of a generation card is
  written at once, also while the card generates. Moves compose: after `a`
  to `b` and `b` to `c`, entries that name `a` or `b` get `c`. At most 1,000
  moves are kept.
- Until an owed entry is rewritten it is broken in the store and shows as
  broken, so the canvas and the store agree.
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
  above it, until the comparison has finished and relocation is done.
  Navigation and the user's own edits are drawn at once. A card of a file
  that was deleted outside BaseHalf therefore stays for about half a second
  before it goes.
- **The wait has a limit of ten seconds, and it is a safeguard.** After it
  the canvas draws what is on disk and corrects itself when relocation has
  finished. The limit was two seconds, a value nobody had measured. Measured
  on 2026-10-11, 1,000 files renamed at once were followed after 3.2
  seconds, and the canvas had drawn 300 cards at other places for the second
  before that. Ten seconds is also the latest that a comparison starts after
  the first file event, so the canvas never gives up before BaseHalf has
  compared.
- **What the limit costs.** While file events keep arriving in the workspace
  folder without a pause of 300 ms, the comparison starts ten seconds after
  the first of them. A card of the shown folder whose file was removed or
  renamed in that time changes when the comparison has run, and the cards of
  files that were added to that folder meanwhile appear with it. With the
  old limit the canvas drew after two seconds, with the renamed file as a
  new card at the end, and corrected itself later.
- **A redraw that was put off** behind a drag or a description that is being
  typed is drawn as it is when that ends, and does not wait. The rows are
  kept either way ([canvas card placement](canvas-card-placement.md#a-chosen-row-whose-item-is-gone)),
  so the card is at its place once its pair is relocated.
- **Each move gets its own wait.** The ten seconds count from the first
  change of one move. Once the folder is settled again, or another folder is
  shown, the next change starts a new wait. A wait that ended at its limit
  is not started again for the same move.
- **At open.** The first drawing of a folder's canvas waits for the
  comparison of its workspace folder in the same way, for at most 500 ms. A
  later redraw waits for that comparison for at most two seconds. No change
  is on its way then: the folder is only being read, and the ten seconds
  are not for that.
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
    although the template is most of each. A small note of
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
27. **Many at once.** Thirty placed notes of one folder, two of them
    described, are renamed outside at once. Every row is at its new path
    with its place, and both descriptions followed. Renamed again while no
    window is open, the same holds after the next open, and the layout was
    written once. Following many moves through the layouts gives what
    following each by itself gives, with fewer writes, also when one move
    takes a row out of a layout that another puts a row into. When one
    layout cannot be written, the moves of the other layouts are followed.
28. **A drawing ahead of the file events.** A described file is renamed and
    another is deleted, and their file events have not arrived. Told what a
    listing shows, BaseHalf recognizes the rename, and the folder is not
    settled until it has. A file that the listing left out and that is there
    is not touched. The file events that arrive later change nothing. The
    deleted file is given up when the time in which it can be paired has
    passed, and not before.
29. **In the real window, many at once.** Recorded, not automated: the table
    under [many items at once](#many-items-at-once).
30. **Generation cards.** A folder that holds a draft and a file is renamed
    outside: the draft is at the new path with its prompt and place, and its
    own list names the new paths of what moved with it, as a file's does;
    also when the canvas never showed the folder. A folder
    renamed outside while a card in it generates is followed at once, and the
    file lands in the renamed folder. A file recognized as moved onto a
    draft's path keeps its own card, and the draft moves to the next free
    name. These are criteria 5 and 8 of
    [generation cards](generation-cards.md#acceptance-criteria) too.

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
   200,000 items, the ten and 60 seconds, the time the canvas waits,
   and one half and 32 characters for similarity are first values. The measurements under
   Verification decide them. None blocks implementation. The quiet time
   before a comparison was one second and is 300 ms since it was measured
   ([When BaseHalf compares](#when-basehalf-compares)). The time the canvas
   waits was two seconds and is ten since it was measured
   ([what the user sees](#what-the-user-sees)).
