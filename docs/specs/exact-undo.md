# Exact undo

Status: Active (2026-10-25)
Decision: [D82](../decisions.md#d82--a-delete-on-the-canvas-asks-nothing-and-undo-brings-back-exactly-what-a-step-took-new-2026-10-25)
Related: [canvas Create menu](canvas-create-menu.md) (New Folder and its
undo), [canvas card placement](canvas-card-placement.md) (rows),
[generation cards](generation-cards.md#deleting) (drafts),
[mirror file resilience](mirror-file-resilience.md) (the mirror cascade),
[reference graph](reference-graph.md#deleting) (entries that name a
deleted item), [workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)
(`.bh/cache/`)

## The rule

**What BaseHalf changes in the user's files is one step of undo, and undo
puts back exactly what the step took. A delete on the canvas happens at
once and asks nothing.**

BaseHalf builds on the undo history of VS Code, which the canvas already
uses. It adds no history of its own. What it adds is a place where a step
keeps what it took away: the **kept versions**.

## Problem

Measured on 2026-10-25 in a development window, with the Trash on:

- **A delete asks first.** The card's Delete... and the Delete key opened a
  dialog: "Move 'keep.md' to the Trash? You can restore it from the Trash.",
  with Cancel and Move to Trash; for cards that other cards list as
  upstream, it also had a checkbox to remove them from those lists. The two
  canvas products for media work that BaseHalf follows delete a node at
  once, without a question, and one undo puts it back where it was,
  selected. Both were tried that day on test canvases, with a node made for
  the test and deleted again afterwards.
- **Undo of a delete did not bring back what the delete took.** A delete on
  the canvas went through VS Code's file delete, whose undo keeps the bytes
  of a file only up to 5 MB and keeps nothing of what a folder holds:
  - a file of 6 MB: one undo brought nothing back;
  - a folder that held two notes: undo made an empty folder, and the notes
    stayed in the Trash, where BaseHalf cannot take them from;
  - a note with a description, a color, and a place: the note came back with
    its color, without its description, and its card went to the end of the
    canvas. The delete removes the card's row and its description at once,
    and nothing gives them back.
- **Redo of a New Folder put its card at the end of the canvas** (from
  1035, 488.5 to 1730, 690), for the same reason.
- **New Note was no step of the canvas undo.** Cmd+Z on the canvas did
  nothing to a note it had just made; its undo was in Files.
- **A change of a file in place had no undo to join.** The trimming of a
  video in Card Detail (D79, drafted on its own branch) was to save a new
  clip beside the video, and the user asked on 2026-10-25 that a trim change
  the video itself and be undone.

## Goals

- A delete on the canvas happens at once. Nothing asks.
- One undo of a delete brings each item back whole: the file or folder with
  everything in it, byte for byte, whatever its size; its card at its place
  and size; its card information; its connections.
- Undo of what the canvas made takes it away with what was typed or put into
  it since, and redo brings that back the same way.
- A feature that changes a file in place does it as one step, and undo puts
  the version before back.
- What undo keeps is still in the Trash in the end.

## Scope

In scope:

- Deleting on the canvas: Delete in a card's menu, the Delete button of the
  selection toolbar, and the Delete and Backspace keys, for one card or a
  set, drafts included.
- The undo and redo of New Note, New Folder, a note made from a connection
  or from a PDF, Duplicate, and the copies that Paste, Import Files..., and a
  drop of files from outside make.
- The kept versions: where they are, what goes there, and when it goes to
  the Trash.
- A step that changes the bytes of files in place, for features such as
  trimming.
- Cmd+Z and Shift+Cmd+Z while Card Detail is open.

Not in scope, and unchanged:

- Files in the sidebar. Its delete asks, as VS Code's does, and its undo is
  VS Code's. It can take the kept versions later.
- The undo of text in a note's editor and in Card Detail's editors.
- Moves and renames. Their undo is exact already.
- A generation. It is not undone
  ([generation cards](generation-cards.md#moving-renaming-copying-and-undo)).
- Changes that agents make. They are no steps of BaseHalf's undo.
- Making a project from a template. Its undo keeps the project in a place of
  its own already.

## Terms

- **Step**: one entry of the canvas undo history. Its name is what the menu
  bar's Undo shows, such as "Delete keep.md".
- **Item**: a file or a folder of the workspace, with everything a folder
  holds.
- **Card information** of an item: what `.bh/mirror/<path>/` holds for it and
  for everything below it (the description, reading aids, color, upstream
  list, prompt and settings, the generation record, and a folder's own
  layouts), its row and the anchor rows that name it in the layout of its
  folder.
- **Kept versions**: `.bh/cache/kept/` of the item's workspace folder.

## Required behavior

### Deleting

- Delete in a card's menu, the Delete button of the selection toolbar, and
  the Delete and Backspace keys delete what is selected at once. No dialog,
  question, or notice shows.
- The card's menu says **Delete**, without an ellipsis: it asks nothing.
- A delete is one step, named "Delete `<name>`" for one item and "Delete
  `<n>` items" for more. A set of files, folders, and drafts is one step:
  one undo brings all of them back.
- Entries of other items that name a deleted item stay as they are. They
  show as broken until undo brings the item back
  ([reference graph](reference-graph.md#deleting)). The dialog's checkbox
  that removed them goes with the dialog.
- A note with changes that are not saved yet is saved first. When that
  fails, nothing is deleted, and BaseHalf says why.
- A draft is deleted as before, with all of its card information
  ([generation cards](generation-cards.md#deleting)), also without a
  question. A draft that generates is not deleted, as before, and BaseHalf
  says why.

### The kept versions

- A delete moves each item into the kept versions of its workspace folder,
  whole, with its card information. It is a move on one disk: it takes no
  time and no room, whatever the size.
- Undo moves everything back: every file and folder as it was, with its
  bytes and dates; the card at its place and size; its card information.
  Redo moves it away again.
- The kept versions are under `.bh/cache/`, so neither Files, Search, nor
  git shows them ([workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)).
- A step that cannot be undone as it was says why and changes nothing, and
  the next undo goes to the step before:
  - an item is at the path again, as after a New Note with the same name:
    "'`<name>`' is there again. Undo did not replace it.";
  - what the step kept is gone from the kept versions, as when another
    window sent it to the Trash: "'`<name>`' is in the Trash now. Restore
    it from there."

### When the kept versions go to the Trash

- When the window closes, or reloads, everything it kept goes to the Trash.
  When the Trash is turned off (`files.enableTrash: false`) or the disk has
  none, it is deleted for good, as a delete without the Trash is.
- A window marks what it keeps as its own and renews the mark every minute.
  When a window opens a workspace folder, it sends to the Trash what a
  window kept whose mark is more than five minutes old: one that crashed or
  was stopped.
- An item that the Trash refuses stays kept, and the next window that opens
  the folder tries again. BaseHalf never deletes for good what the Trash
  should have held.
- What goes to the Trash leaves behind the card information that a delete
  to the Trash has always kept, so that a restore from the Trash brings the
  card back whole ([mirror file resilience](mirror-file-resilience.md)): the
  upstream list, the color, and the prompt and settings with the generation
  record. Prompt and settings stay only beside a generation record: without
  one they would make a draft. The rest of the card information goes, as a
  delete has always taken it. Nothing of it stays when the item is deleted
  for good.

### What the canvas made

- New Note, New Folder, a note made from a connection, a note made from a
  PDF, Duplicate, and the copies that Paste, Import Files..., and a drop of
  files from outside make are each one step
  ([canvas Create menu](canvas-create-menu.md#undo) for New Folder).
- Undo moves what the step made into the kept versions, with its card
  information and whatever was typed or put into it since. Redo moves it
  back to its place.
- A paste, an import, or a drop never replaces an item. A name that is taken
  gets the next free one, as Duplicate does, also when the setting
  `explorer.incrementalNaming` is `disabled`: undo could not give a replaced
  item back.
- A paste of files that were cut moves them. Its undo moves them back, and it
  is a step of the canvas now, not of Files. The mirror cascade carries the
  cards' information both ways, as for any move.

### Changing files in place

- A feature that changes the bytes of files does it as one step. The version
  of each file before the step goes into the kept versions, and the new
  bytes take its place. Undo swaps them back, and redo again. Several files
  change in one step, such as a video and its `made.yaml`.
- A file that is not there, has changes that are not saved, or is not an
  ordinary file of the workspace is refused, and nothing changes.

### Undo while Card Detail is open

- Cmd+Z and Shift+Cmd+Z undo and redo the steps of the canvas also while
  Card Detail is open, as long as the keyboard is not in an editor of text,
  which has its own undo. The player and the trim bar of a video are no
  editors of text.

## Failure

- A move into the kept versions that fails changes nothing that was not
  changed back, and BaseHalf says why.
- A layout that cannot be read stays where it is, as the mirror cascade
  leaves it ([mirror file resilience](mirror-file-resilience.md)). The item
  is kept all the same, with its card information byte for byte, and its
  card gets a new place when it comes back.

## Acceptance criteria

1. Delete in a card's menu, the selection toolbar's Delete, and the Delete
   key delete at once. In no frame does a dialog show.
2. The card's menu says Delete, without an ellipsis.
3. One undo after deleting a file of 6 MB, a folder that holds two notes,
   and a note with a description, a color, and a place of the user's brings
   back each of them byte for byte, its card at its place and size, and its
   description and color.
4. A set of a file, a folder, and a draft is deleted in one step, and one
   undo brings all three back.
5. Redo deletes them again, and undo brings them back again.
6. Undo of a New Note into which text was typed takes the note away. Redo
   brings it back with the text, its card at its place.
7. Undo of a New Folder into which a file was put takes both away. Redo
   brings both back, the card at its place.
8. Undo and redo of Duplicate and of the copies that Paste and Import
   Files... make take the copies away and bring them back.
9. Undo after a new item took the path of a deleted one replaces nothing and
   says why.
10. When the window closes, what it kept is in the Trash, and its part of the
    kept versions is gone.
11. What a window kept whose mark is older than five minutes goes to the
    Trash when another window opens the folder.
12. A change of a file in place is one step: undo puts the version before
    back, and redo the new one.
13. Cmd+Z with Card Detail open on a video undoes the last step of the
    canvas.
14. A delete in Files in the sidebar still asks, and its undo is VS Code's.

## Verification

- Unit tests of the kept versions: delete, undo, and redo of a file, a large
  file, a folder, and card information; the refusals; the marks and the
  sweep of old ones; a change of files in place.
- Unit test of VS Code's undo service: one undo of a source takes back a
  group of steps of that source and asks nothing.
- Smoke, canvas suite: a step that deletes with the menu, the toolbar, and
  the key, a set of a file, a folder, and a draft among them, watches every
  frame for a dialog, and undoes and redoes; the steps that deleted with the
  dialog delete without it.
- The window: criteria 3 to 7, 10, 11, and 13, and Duplicate of a file with
  a draft for criterion 8.
