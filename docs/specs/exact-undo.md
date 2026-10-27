# Exact undo

Status: Active (2026-10-25; editing media, 2026-10-26; a drop into a folder
and Command+Z in an editor of text, 2026-10-27)
Decision: [D82](../decisions.md#d82--a-delete-on-the-canvas-asks-nothing-and-undo-brings-back-exactly-what-a-step-took-new-2026-10-25);
editing media, [D85](../decisions.md#d85--editing-media-is-direct-a-change-is-saved-as-it-is-made-with-no-edit-mode-new-2026-10-26);
a drop into a folder, [D88](../decisions.md#d88--cards-let-go-on-a-folder-go-into-it-new-2026-10-27);
the editors of text, [D89](../decisions.md#d89--a-note-resizes-while-it-is-edited-on-its-card-and-an-editor-of-text-leaves-the-steps-of-other-places-to-them-new-2026-10-27)
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
once and asks nothing, and so does undo: an editor of text undoes what was
done in editors, and leaves the steps of other places to them.**

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
- **Files in the sidebar came after the canvas** (reported by the user on
  2026-10-25, once the kept versions were in). A deleted card left the
  canvas at once, and its row stayed in Files for 560 ms more; after undo
  and after redo, the row followed its card by 566 and 568 ms. The steps
  carried out their delete, undo, and redo as moves into and out of
  `.bh/cache/kept/`, and VS Code's file service told the window about each
  as a move. Files keeps its tree from the moves it is told about, but only
  for a move whose both ends it shows, so its row waited for the file
  watcher and then for Files' own half second. The rest of the window took
  the same moves for what they said: an open editor of a deleted item went
  with it into the kept versions instead of showing it as deleted, and so
  did the history of Back and Forward and the local history of the file. A
  first fix, in Files alone, took every move to a place Files does not show
  as a delete; for a change in place it removed the file's row and put it
  back, while the file never left its place.
- **Command+Z in an editor of text asked about a step of another place**
  (measured on 2026-10-27). After a rename of a note on the canvas, typing in
  its editor on the card, and Command+Z twice, a dialog of the system asked
  "Would you like to undo 'Rename Groceries.md to Shopping.md'?", and the
  editor waited for the answer: it could not be closed, and the window could
  not reload. A resize while typing did the same (D89). VS Code asks when the
  undo of a file in an editor reaches a step that another place made, and the
  steps that name a file the user edits were in that file's own history:
  renames and moves on the canvas and in Card Detail, the resizes and moves
  of cards until D89, and the connections of a file that is no note, which
  keep the file's list in its card information. The undo of an edit across
  files that an editor's own command made, such as a rename of a symbol,
  asked "Would you like to undo 'Rename' across all files?", with the
  choice of this file only.

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
- Cmd+Z and Shift+Cmd+Z in an editor of text: the editor of a note on its
  card, and the editors of Card Detail.
- What the rest of the window is told of these steps: Files in the sidebar,
  open editors, and the history of Back and Forward.

Not in scope, and unchanged:

- The delete and the undo of Files in the sidebar. Its delete asks, as VS
  Code's does, and its undo is VS Code's. It can take the kept versions
  later.
- What the undo of text in a note's editor and in Card Detail's editors
  does with the text.
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
- The window is told what a step does, not how: a move into the kept
  versions is told as the delete of the item, a move back out of them as its
  creation, a version moved into the place of a file as a write of that
  file, and a move within the kept versions to no one. VS Code tells a
  delete to the system's Trash, which is a move into a hidden folder too, as
  a delete in the same way. So Files in the sidebar shows a step together
  with the canvas, an editor of a deleted item shows it as deleted, Back and
  Forward never lead into the kept versions, and a file that is changed in
  place keeps its row in Files
  ([architecture invariants](../harness/architecture-invariants.md#content-and-graph-truth)).
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
- An item goes to the Trash from where it was, so that Put Back in Finder
  returns it there: the Trash keeps the place an item had when it went in.
  BaseHalf moves it back to its path first, and sends it to the Trash from
  the kept versions only when another item took its path or its folder is
  gone. On 2026-10-25 the Trash kept the kept versions as the place of
  items that BaseHalf sent there, a folder that is gone by then, so Put
  Back could not return them.
- What goes to the Trash leaves behind the card information that a delete
  to the Trash has always kept, so that a restore from the Trash brings the
  card back whole ([mirror file resilience](mirror-file-resilience.md)): the
  upstream list, the color, the prompt and settings with the generation
  record, and the edit record with the original of an edited file
  ([editing media](media-editing.md#copies-deletes-and-the-trash)). Prompt
  and settings stay only beside a generation record: without one they would
  make a draft; an original stays only beside its edit record, until its file
  has been gone for 30 days
  ([editing media](media-editing.md#when-the-file-is-gone)). The rest of the
  card information goes, as a delete has always taken it. Nothing of it stays
  when the item is deleted for good.
- What a step that changed files in place kept is deleted for good when the
  window closes, also with the Trash on, when the step's feature keeps
  elsewhere what the user may want of it. In the Trash it would be files
  under BaseHalf's own names, whose Put Back place is a folder of the kept
  versions that is gone.

### What the canvas made

- New Note, New Folder, a note made from a connection, a note made from a
  PDF, Duplicate, and the copies that Paste, Import Files..., and a drop of
  files from outside make are each one step
  ([canvas Create menu](canvas-create-menu.md#undo) for New Folder).
- Undo moves what the step made into the kept versions, with its card
  information and whatever was typed or put into it since. Redo moves it
  back to its place.
- A paste, an import, or a drop never replaces an item: undo could not give
  a replaced item back. A name that is taken gets the next free one. A copy
  is named as Duplicate names it, also when the setting
  `explorer.incrementalNaming` is `disabled`. An item that moves, by a paste
  of cut items or by a drop into a folder, keeps both names: it takes a
  number after its name, before the extension, `plan 2.md`, as a desktop
  file manager names a moved item it keeps beside another
  ([dropping into a folder](canvas-drop-into-folder.md#letting-go-on-a-folder)).
- A paste of files that were cut moves them. Its undo moves them back, and it
  is a step of the canvas now, not of Files. The mirror cascade carries the
  cards' information both ways, as for any move.
- A drop of cards, or of items from Files, on a folder's card or on a folder
  of the path moves them into that folder as one step, drafts included
  ([dropping into a folder](canvas-drop-into-folder.md)).

### Changing files in place

- A feature that changes the bytes of files does it as one step. The version
  of each file before the step goes into the kept versions, and the new
  bytes take its place. Undo swaps them back, and redo again. Several files
  can change in one step. Editing media does not use them: its steps put back
  choices ([Editing media](#editing-media)).
- A step can also create a file where none is, and remove one: no file is
  then one of its two versions, and undo and redo swap it as they swap
  bytes. The window is told the file's creation or its delete, as for an
  item. A file that undo would put where none was, while another file is
  there again, is no file of the step any more: the step says so and changes
  nothing, as for an item.
- New bytes come from memory, or from a file the feature wrote into
  `.bh/cache/` first, which is moved into place. A file of the workspace is
  never moved from one path of the step to another: a version that moves is
  copied into `.bh/cache/` first, by a clone on a disk that can clone files,
  which takes no room.
- A file that has changes that are not saved, or is not an ordinary file of
  the workspace, is refused, and nothing changes. So is a file to change or
  to remove that is not there.
- The step says what becomes of the versions it keeps when the window
  closes: they go to the Trash, or they are deleted for good when its feature
  keeps elsewhere what the user may want of them
  ([When the kept versions go to the Trash](#when-the-kept-versions-go-to-the-trash)).
- A version that the step, its undo, or its redo moves into the place of a
  file takes the time of then as its modification time, as a save would.
  Its bytes are those it had. A move keeps the time a version had, and the
  file watcher of macOS tells a change by that time: a version that came
  back with a time the watcher had seen at that path before was no change
  to it. On 2026-10-25, after a trim, an undo, and a redo, the video was the
  trimmed one, and its card still showed the version before.

### Undo while Card Detail is open

- Cmd+Z and Shift+Cmd+Z undo and redo the steps of the canvas also while
  Card Detail is open, as long as the keyboard is not in an editor of text,
  which has its own undo. The player and the editors of media are no editors
  of text: their changes are steps of the canvas
  ([editing media](media-editing.md#the-keyboard)).

### One step after another

- Cmd+Z and Shift+Cmd+Z pressed while a step of the canvas is still being
  undone or redone, such as the files of a drop into a folder or of a rename
  being moved back, wait for it, and then run in the order they were
  pressed. A key that comes early never loses the history.
- Until 2026-10-27, VS Code's undo refused a key that came while a step ran
  on the same files, and then dropped the whole history of those files: a
  redo pressed at once after the undo of a rename or of a drop did nothing,
  and nothing could be redone afterwards (three of three, measured on main
  and on the drop).

### Editing media

- Each change of an edit in Card Detail, a trim, a cut, a crop, a turn, a
  flip, an angle, and Revert to Original, is one step of the canvas undo,
  named for what it did ([editing media](media-editing.md#changes-save-themselves)).
  Changes of the same name to one file within 0.6 s are one step.
- The step holds the choices before and after it. Undo and redo put those
  choices back: an editor of the file shows them at once, and the file
  follows, from what was written for them when that is still kept, byte for
  byte, or encoded again from the original. Choices that keep the whole
  original put the original's own bytes back.
- The step keeps nothing in the kept versions, and so nothing of it goes to
  the Trash.
- A step whose file changed outside BaseHalf since, or is gone, says why and
  changes nothing, as the other steps do: "'shot.mp4' changed meanwhile.
  Undo did not change it." and "'shot.mp4' is not there any more."

### Undo in an editor of text

- Cmd+Z and Shift+Cmd+Z in an editor of text undo and redo what was done in
  editors, and nothing else. That is the editor of a note on its card, and
  the editors of Card Detail: the source of a note and the editor of a text
  or code file.
- A step made outside the editors is left to the place that made it: a step
  of the canvas, of Files, of Card Detail's header, or of a service of
  BaseHalf. Such a place keeps an undo of its own, which VS Code knows as the
  source of the step. When it is the next step of the editor's file that
  way, the keys do nothing in the editor, and nothing asks; Cmd+Z on the
  canvas, and in Card Detail with the keyboard out of its editors, reaches
  it, as above.
- A step that an editor's own command made across several files, such as a
  rename of a symbol, a code action, or the rename of a heading or a link
  across notes, is the editor's: Cmd+Z and Shift+Cmd+Z in an editor of any
  of those files undo and redo it in every file it changed, and nothing
  asks. VS Code asked whether to undo it "across all files" or in this file
  only.
- The rich editor of Card Detail keeps its own history of the document,
  which never held the steps of other places.
- Until 2026-10-27, VS Code asked "Would you like to undo …?" when the undo
  of an editor reached a step made outside the editors, and the editor
  waited for the answer ([Problem](#problem)).

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
    kept versions is gone. The Trash keeps the folder where each item was
    as its place to put it back.
11. What a window kept whose mark is older than five minutes goes to the
    Trash when another window opens the folder.
12. A change of a file in place is one step: undo puts the version before
    back, and redo the new one. After each, the card and Card Detail show
    the version that is there, also after undo and redo again.
13. Cmd+Z with Card Detail open on a video undoes the last step of the
    canvas.
14. A delete in Files in the sidebar still asks, and its undo is VS Code's.
15. After a delete on the canvas, its undo, and its redo, the item's row in
    Files goes or comes back no more than 300 ms from its card.
16. A trim of a video, its undo, and its redo leave the video's row in Files
    where it is: in no frame is it gone.
17. The window is told a delete, a creation, or a write for each item of a
    step, and never a move into or out of the kept versions.
18. After a rename of a note on the canvas, typing in its editor on the
    card, and Cmd+Z past the typing, nothing asks: the note keeps its new
    name, the editor goes on, and Escape closes it at once. Shift+Cmd+Z there
    does not redo a step of the canvas either. The same holds in the source
    editor of Card Detail.
19. A rename made with an editor's own command across two files is undone
    by Cmd+Z in the editor of either file and redone by Shift+Cmd+Z, in both
    files, and nothing asks.
20. Shift+Cmd+Z pressed at once after Cmd+Z on the canvas undid a drop into
    a folder, before the card is drawn again, redoes the drop, and the next
    Cmd+Z undoes it again.

## Verification

- Unit tests of the kept versions: delete, undo, and redo of a file, a large
  file, a folder, and card information; the refusals; the marks and the
  sweep of old ones; a change of files in place, each version moved into
  place with the time of then; and what the window is told of each step
  (criterion 17).
- Unit test of VS Code's file service: a move told as a delete, a creation,
  or a write sends that operation and no move, a move told as nothing sends
  nothing, and a move told as nothing else is still a move.
- Unit test of the service that sets file times: a file takes the time of
  now and keeps its bytes.
- Unit test of VS Code's undo service: one undo of a source takes back a
  group of steps of that source and asks nothing.
- Unit tests of VS Code's undo service: an undo or a redo by resource leaves
  an element of a source and asks nothing; an undo by resource of an element
  that can be split takes it back in every file and asks nothing.
- Unit tests of the editors of text, through the Undo and Redo commands of a
  code editor: a rename of the canvas is left and nothing asks, and the
  editor's own text is still undone (criterion 18); a rename across files
  without a source is undone and redone and nothing asks (criterion 19).
- Unit tests of the canvas's queue of undo and redo: a key pressed while a
  step runs waits for it, also when nothing could be undone or redone at the
  moment it was pressed, and a step that fails does not stop the next
  (criterion 20).
- Smoke, canvas suite: `canvas-drop-into-folder` presses Shift+Cmd+Z at
  once after the undo of a drop (criterion 20).
- Smoke, canvas suite: `canvas-note-undo-asks-nothing` renames a note,
  types in its editor on the card, presses Cmd+Z past the typing, and
  closes the editor with Escape (criterion 18); with the editor's undo of
  before, the editor waited for the question and did not close. The source
  editor of Card Detail was checked in the window on 2026-10-27 after a
  rename of a code file: one Cmd+Z undid the typing, the next one left the
  rename, and nothing asked.
- Smoke, canvas suite: a step that deletes with the menu, the toolbar, and
  the key, a set of a file, a folder, and a draft among them, watches every
  frame for a dialog, and undoes and redoes; the steps that deleted with the
  dialog delete without it. `canvas-files-follow-deletes` samples every frame
  for the card of a note and its row in Files through a delete, its undo,
  and its redo (criterion 15).
- Smoke, cardDetail suite: the trim step samples every frame for the
  video's row in Files through the trim, its undo, and its redo
  (criterion 16).
- The window: criteria 3 to 7, 10, 11, and 13, Duplicate of a file with a
  draft for criterion 8, and criterion 12 with the trimming of a video
  (D79): trim, undo, redo, undo, redo, the card and Card Detail looked at
  after each.
