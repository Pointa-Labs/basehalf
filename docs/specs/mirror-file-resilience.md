# Mirror file reading, writing, and recovery

Status: Active (2026-10-10)
Decision: [D40](../decisions.md#d40--mirror-metadata-never-blocks-the-user-new-2026-10-10)
Related: [workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
[reference graph](reference-graph.md)

## Problem

Creating a folder named `09` on a canvas wrote `- path: "09"` into
`canvas.yaml`. The reader guessed value types from their text, ignored the
quotes, and read the path as the number 9. BaseHalf then treated the file it
had just written as corrupt:

- the canvas showed "Corrupt canvas.yaml";
- every card move was rejected and the card returned to its old position,
  because each layout write starts by reading the file;
- deleting the folder finished on disk, but the metadata cascade stopped at
  its first stage. Retry could not succeed, and further file operations in the
  workspace stayed blocked until the window was reloaded.

One unreadable value made a whole canvas read-only and then locked the
workspace. The same reader was copied into the badge and reading-aid mirrors,
where a description or keyword such as `2024` or `true` had the same effect.

## Goals

- BaseHalf reads back every mirror file it writes.
- Content that BaseHalf cannot read never blocks a card move, a file
  operation, or any other user action, and is never destroyed.
- A failed metadata update after a file operation is never a dead end.
- No recovery depends on the user opening or editing a file under `.bh/`.
  BaseHalf assumes users never do that, so it recovers by itself.
- Messages say what happened in plain language and include the cause.

## Non-goals

- `upstream.yaml` and the `upstream` keys of Markdown and `.bhnode` files.
  They are reference truth: unreadable and invalid entries stay visible issues
  that only the user repairs ([reference graph](reference-graph.md)).
- `appearance.yaml`, which has its own one-line grammar.
- Following files that are moved or deleted outside BaseHalf.
- Mirror files above their size limit. Reading one is an environmental
  failure, as defined below.

## Terms

- **Mirror file**: `canvas.yaml`, `badge.yaml`, or `adhd.yaml` under
  `.bh/mirror/`.
- **Layout file**: `canvas.yaml`. It holds card positions, sizes, and edge
  anchor memory. BaseHalf rewrites it on every card move, and a lost row costs
  one automatic placement.
- **Annotation file**: `badge.yaml` (a description) or `adhd.yaml` (reading
  aids). The user authored its content.
- **Content failure**: the bytes of a mirror file cannot be read as that
  file: a YAML syntax error, a root that is not a mapping, a `path` that does
  not name the file's node ([The stored path](#the-stored-path)), or a field
  with the wrong shape. Reading the same bytes again gives the same result.
- **Environmental failure**: the file system refuses the operation: missing
  permission, a full disk, a mirror path that passes through a symbolic link,
  a file above its size limit, or a concurrent writer that keeps winning.
  Trying again later can succeed.
- **Recovery copy**: the exact bytes of a mirror file that BaseHalf could not
  fully read, saved before BaseHalf replaces them.

## Value grammar

`basehalfMirrorYaml.ts` owns the grammar. The three mirror services use it and
keep no reader of their own.

**Writing.** A string is always written in double quotes with JSON escapes. A
number is written as plain decimal text.

**Reading.** A field is read by the type its schema gives it, never by what
its text looks like:

| Field type | Accepted | Result |
| --- | --- | --- |
| string | any scalar: double-quoted, single-quoted, plain, or block | its text. `"09"`, `'09'`, and `09` all read as the string `09` |
| number | a scalar whose text is a decimal number, with optional sign, fraction, and exponent | a finite number |
| boolean | a scalar whose text is `true` or `false` | that boolean |
| list | a sequence | its items. A plain empty, `~`, or `null` value is an empty list |

A plain `~` or `null` is an absent value for every field type. A plain empty
value is the empty string for a string field. For a key that appears more than
once in a mapping, the YAML parser reports an error, which is a content
failure. A byte order mark at the start of the file is ignored.

**Text the parser stops at.** The YAML parser stops at text it cannot place,
such as the markers of a merge conflict or a line that is not YAML, and
reports no error. Everything after that point was never read. The reader
compares where the parser stopped with the end of the text. When anything but
white space, comments, or document markers is left, the document is
incomplete, and the reader reports the line. An incomplete document is never
treated as a complete one: a layout file has `partial` damage, and an
annotation file has a content failure.

**Write check.** Before BaseHalf commits bytes to a mirror file, it reads
those bytes back with the reader above. The commit goes ahead only when the
reader accepts all of them and returns the value that was serialized. If not,
nothing is written, the file on disk stays as it was, and the operation fails
with an internal error that is logged. This guards against defects in BaseHalf;
no user input is expected to reach it.

Canvas rows are made canonical before serialization: the last card for a path
and the last edge for an endpoint pair win, as they do on reading. A card size
that rounds to zero at the written precision is refused before serialization.

## The stored path

Every mirror file stores the `path` of its node. A file whose stored path
names another node is a content failure. A stored path that differs from the
node's path only in letter case or Unicode normalization still names the node:
the file was found in that node's mirror directory, and this is what a rename
made outside BaseHalf leaves behind on a file system that ignores those
differences.

- Such a file is read as the node's own, with no damage and no recovery copy.
- In a canvas, card rows and edge ends that start with the stored spelling of
  the folder are read under the folder's current spelling.
- The next write stores the current spelling. Reading changes nothing on disk.
- This does not follow a file or folder that was moved to another name
  outside BaseHalf, which stays a non-goal.

## Layout files

### Reading

Reading a canvas never fails because of the file's content.

- **Rows.** A card row is kept when it is a mapping with a string `path`, a
  `kind` of `file` or `folder`, finite `x` and `y`, and positive finite
  `width` and `height`. A size is positive when it is still above zero at the
  precision BaseHalf writes, so that every row it reads is a row it can write
  back. An edge row is kept when `from` and `to` are strings
  and both anchors are `north`, `east`, `south`, or `west`. Every other row is
  skipped. An invalid `size` is dropped. A `cards` or `edges` value that is
  not a list reads as an empty list.
- **Incomplete file.** When the parser stopped before the end, the rows read
  up to that line are kept and the rest count as skipped.
- **Whole file.** A file with a YAML syntax error, a root that is not a
  mapping, or a `path` that does not name its folder has no readable layout.
  It reads as a canvas without saved layout.

The read reports the damage: `partial` when rows or the size were skipped or
the file is incomplete, `unreadable` when the whole file was. The first cause
is included for the log.

Reading changes nothing on disk.

### What the user sees

| State | Canvas |
| --- | --- |
| readable | saved layout |
| `partial` | saved layout for the readable rows; cards whose row was skipped are placed as cards that were never positioned; notice "Some saved card positions could not be read" |
| `unreadable` | every card placed as never positioned; notice "This canvas's saved layout could not be read" |
| environmental read failure | every card placed as never positioned; notice "The saved layout could not be loaded: <cause>" |

The notice is one line on the canvas. It does not block any interaction and
goes away once the file is readable again.

### Writing over content that could not be read

Every card move, resize, create, connect, and structural update can be
applied to a damaged layout file. When a write replaces bytes that had
`partial` or `unreadable` damage, BaseHalf first saves a recovery copy:

`.bh/cache/recovered/mirror/<folder path>/canvas.<12 hex digits>.yaml`

The digits are the start of the SHA-1 of the replaced bytes, so saving the
same bytes twice gives one file. The copy is written before the layout file
changes, under the same symbolic-link guard as other `.bh/` writes. If the
copy cannot be written, the layout file is not changed and the write fails as
an environmental failure.

The write then commits against the exact bytes it read, as every layout write
does. The new file holds the readable rows plus the change, and is fully
readable.

A write that changes nothing leaves a damaged file and creates no copy.

After the write, BaseHalf shows one information notification:

> BaseHalf could not read part of the saved layout of <folder>, so it saved a
> new one. A copy of the old one is kept.

The notification does not name the copy's path, which is under the hidden
`.bh/` folder (D41). The path is logged.

`.bh/cache/` is machine-local state and is not meant for git. BaseHalf never
deletes recovery copies.

### Saving a card position fails

A card move that cannot be saved because of an environmental failure returns
the card to its saved position and shows "Couldn't save the card position:
<cause>", where <cause> is a [plain failure reason](#failure-reasons-in-messages).

### Failure reasons in messages

The text of a file system error names system error codes and files under
`.bh/`. BaseHalf logs it and shows one of these reasons instead (D41):

| Failure | Reason shown |
| --- | --- |
| No permission | "BaseHalf isn't allowed to read or change files in this folder." |
| No space left | "The disk is full." |
| Read-only file system | "The disk can't be written to." |
| File locked for writing | "Another program is using a file BaseHalf needs." |
| File over a size limit | "A file is too large for BaseHalf to read." |
| A `.bh/` path behind a symbolic link | "BaseHalf's own folder is behind a symbolic link, and BaseHalf doesn't change files through links." |
| A write that failed its write check | "BaseHalf could not save this safely, so it changed nothing." |
| Any other file system error | "The disk reported a problem." |

These reasons are the <cause> of the card-position message, the badge
editor's "BaseHalf could not load it", the cascade notification below, and the
read and write failures of the [reference graph](reference-graph.md#wording).
An error that states a BaseHalf rule in its own words, such as "This item is
being moved", keeps its text.

## Annotation files

`badge.yaml` and `adhd.yaml` use the value grammar and the write check. A
description or keyword that looks like a number, a boolean, or `null` is read
as the text the user typed.

### Reading

Reading an annotation file never fails because of its content. A file with a
content failure, which includes an incomplete document, reads as a node
without a description or without reading aids. The description field and the
reading-aid controls stay usable. Reading changes nothing on disk.

A badge with a content failure is not an issue on its card: the badge editor
shows the empty description field, and neither the card nor the canvas counts
it as an issue.

When the file system refuses to read a badge, there is no description to
edit. The canvas shows "1 description could not be loaded" ("N descriptions
could not be loaded" for several). In place of the description field the badge editor shows "Description
can't be read" and one line with the cause: "BaseHalf could not load it:
<cause>", a [plain failure reason](#failure-reasons-in-messages). It offers no
action there: the earlier **Open Metadata** button,
which opened `badge.yaml`, is removed.

The [reference graph](reference-graph.md#badge-editor) removes its **Open
File** actions for the same reason (D41), so no control in the product opens a
file under `.bh/`.

### Writing over content that could not be read

When the user saves a description, a keyword, or a read mark for a node whose
annotation file has a content failure, BaseHalf first saves a recovery copy of
the file, in the same place and under the same rules as for a layout file:

`.bh/cache/recovered/mirror/<node path>/badge.<12 hex digits>.yaml`
`.bh/cache/recovered/mirror/<node path>/adhd.<12 hex digits>.yaml`

It then writes the new file against the exact bytes it read. If the copy
cannot be written, the annotation file is not changed and the write fails as
an environmental failure. The legacy `references` and `referenced_by` blocks
of a badge travel into the new file byte for byte, as on every badge write. A
write that changes nothing, such as clearing a description that could not be
read, leaves the file and creates no copy.

After the write, BaseHalf shows one information notification:

> BaseHalf could not read the saved description of <node>, so it saved the new
> one. A copy of the old one is kept.

For reading aids it says "the saved reading aids", "saved new ones", and "A
copy of the old ones is kept."

BaseHalf does not replace an annotation file on its own. The replacement
happens only as part of a write the user asked for.

## Structural operations

The mirror cascade runs after a workbench move or delete has finished on
disk.

**Content failures never stop a stage.**

- A layout file is read as described above. A file with no readable layout is
  left in place, byte for byte, and the stage continues. Readable rows of a
  partly damaged file move or retire as usual, and the write over the damaged
  bytes saves a recovery copy.
- An `adhd.yaml` with a content failure is left in place, byte for byte, by
  both retirement and relocation, and the stage continues. BaseHalf logs the
  file and the cause. When the readable reading aids of a moved file must
  replace such a file at the destination, BaseHalf first saves it as a
  recovery copy.
- A `badge.yaml` with a content failure is left in place on retirement. On
  relocation it travels with its node as before: its `path` line is rewritten
  and every other byte is kept. The orphan sweep and the reappearance check
  skip it.

A mirror directory that still holds such a file is not pruned.

**Environmental failures** keep the existing recovery: the stage is retried,
and if it still fails the cascade holds its place and BaseHalf shows one
sticky notification:

> Your change is done (<operation>), but BaseHalf couldn't finish updating its
> cards and badges to match. Retry, or Skip to keep working. Cause: <cause>
>
> Retry · Skip

The message is written for someone who does not read code (D41): it does not
name the stage, a mirror file, or "metadata", and <cause> is a
[plain failure reason](#failure-reasons-in-messages). The stage and the error
are logged.

- **Retry** resumes at the stage that failed.
- **Skip** ends the metadata update for that operation. The stages that have
  not run are dropped, the lease is released, and later file operations
  proceed. Metadata that those stages would have moved or retired stays at its
  old mirror path, which is the state a move or delete outside BaseHalf
  leaves. Empty mirror directories are not pruned after a skip. The skip is
  logged with the operation and the stage.
- Closing the notification without choosing shows it again.
- While the notification is pending, another move or delete in that workspace
  folder is refused with "BaseHalf is still updating its cards and badges
  after an earlier change (<operation>). Choose Retry or Skip in Notifications
  before moving or deleting these items again."
- When a retry succeeds, BaseHalf says "BaseHalf finished updating its cards
  and badges (<operation>)."

## Compatibility

- Mirror files written by earlier releases read unchanged. Files that earlier
  releases reported as corrupt because of a quoted numeric, boolean, or null
  string are readable without any rewrite.
- `BaseHalfCanvasMirrorCorrupt` is removed. `readCanvas` resolves for every
  file content and rejects only on an environmental failure. The same holds
  for `readBadge`, `readBadges`, `listBadges`, `patchBadge`, `readAdhd`, and
  the reading-aid writes: `BaseHalfBadgeMirrorCorrupt` and
  `BaseHalfAdhdMirrorCorrupt` no longer reach a caller, and a badge read
  problem no longer has a `corrupt` flag.
- The badge editor's **Open Metadata** button is removed.
- The file formats do not change.

## Acceptance criteria

1. For every name in a list that includes `09`, `2024`, `-3`, `1.5`, `1e21`,
   `true`, `false`, `null`, `~`, the empty string, names with leading and
   trailing spaces, quotes, backslashes, `: `, ` #`, line breaks, control
   characters, U+2028, and non-ASCII text: a canvas card, a canvas edge
   endpoint, a canvas folder path, a badge path and description, and an ADHD
   path and keyword written by BaseHalf read back as the same string.
2. A hand-written plain `path: 09` reads as the string `09` in all three
   mirror files.
3. After a card named `09` is added to a canvas, the canvas reports no
   damage, a second card can be moved, and purging `09` removes its row.
4. A canvas with one invalid card row and one valid row reads the valid row
   and reports `partial` damage. Moving a card saves a recovery copy with the
   original bytes and leaves a file without damage that holds the valid row
   and the moved card.
5. A canvas that holds merge conflict markers reads the rows before them,
   reports `partial` damage with the line, and is replaced only after a
   recovery copy with both sides is saved. A `badge.yaml` or `adhd.yaml` with
   such markers has a content failure. A file that starts with a byte order
   mark reads as the same file without it.
6. A canvas with a YAML syntax error, and one whose `path` names another
   folder, read as no layout with `unreadable` damage. Moving a card saves a
   recovery copy and a readable file. A write that changes nothing leaves the
   file and creates no copy. A canvas, a `badge.yaml`, and an `adhd.yaml`
   whose `path` differs from the node's only in letter case read as the
   node's own, with rows under the current spelling, and the next write
   stores the current spelling without a recovery copy. A card row whose size
   would be written as zero is skipped, and the canvas stays writable.
7. When the recovery copy cannot be written, the layout file is unchanged and
   the write is rejected.
8. `purgeNode` and `relocateNode` complete when the parent canvas, a subtree
   canvas, or a destination canvas has a content failure. A file with no
   readable layout that the operation does not need to replace keeps its
   bytes.
9. `retireAdhd` and `relocateAdhd` complete and leave the bytes in place when
   the `adhd.yaml` has a content failure. Reading aids that move onto such a
   file replace it after a recovery copy is saved.
10. A `badge.yaml` and an `adhd.yaml` with a YAML syntax error, a `path` that
    names another node, or an invalid field read as no description and no
    reading aids, without an error and without a badge read problem. Saving a
    description, adding a keyword, or marking a range read saves a recovery
    copy with the original bytes, writes a readable file, and reports the
    copy. A badge's legacy blocks are still in the new file. Clearing the
    description or removing a keyword leaves the file and creates no copy.
    When the recovery copy cannot be written, the file is unchanged and the
    write is rejected.
11. When the file system refuses to read a `badge.yaml`, the badge editor
    shows the cause in place of the description field and no button.
12. A card whose size rounds to zero is refused before anything is written.
   Bytes that the reader does not accept in full are never committed.
13. The recovery notification offers Retry and Skip, and its text includes
    the cause. Skip releases the workspace for the next file operation and
    runs no further stage.
14. In the product, creating a folder named `09` on a canvas, moving another
    card, and deleting the folder shows no notice or notification, keeps the
    moved card where it was dropped, and removes the folder's row.

## Verification

- Unit tests of `basehalfMirrorYaml`, the canvas, badge, and ADHD mirror
  services, and the cascade recovery cover criteria 1–10, 12, and 13.
- The BaseHalf smoke covers criteria 11 and 14, and the badge part of
  criterion 10, against its fixture workspace.
