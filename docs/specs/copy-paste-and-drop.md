# Copy, paste, and drop

Status: Active (2026-10-29)
Decision: [D104](../decisions.md#d104--copy-paste-and-a-drop-hand-over-one-transfer-and-the-place-that-has-the-keyboard-takes-it-new-2026-10-29)
Related: [canvas Create menu](canvas-create-menu.md) (Paste in the menu),
[canvas card placement](canvas-card-placement.md#pointing) (where pasted
cards go), [exact undo](exact-undo.md#what-the-canvas-made) (the undo of a
paste), [dropping into a folder](canvas-drop-into-folder.md) (a drop on a
folder's card), [generation cards](generation-cards.md#the-panel) (the input
row and the prompt of a draft), [file mentions](generation-cards.md#mentions)

## Problem

On 2026-10-29 the user reported two failures and asked for one mechanism
instead of patches ("要解决就解决本质问题，不要打补丁"): something copied
elsewhere could not be pasted into the references of a generation card, and a
card that was copied could not be pasted with the keyboard.

Read in the code at `9e0d0d2e5` and measured in BaseHalf's Electron 42 that
day:

1. **The canvas took no key of the clipboard.** Copy and Cut were in a card's
   menu and Paste in the canvas's menu. Command-C, Command-X, and Command-V
   reached the canvas as the window's copy and paste, and nothing there took
   them.
2. **A copy held one private form.** Copy and Cut wrote VS Code's own
   clipboard type, `code/file-list`, and nothing else, because the window's
   clipboard call writes one type at a time. A file manager, a chat app, a browser
   page, a text field, the terminal of the Agent Area, and an agent got
   nothing from a copied card.
3. **Paste read that one form.** Files copied in a file manager, a screenshot taken
   to the clipboard, a picture copied in a browser, and text all gave "The
   clipboard does not contain files."
4. **The panel of a draft took nothing.** Its input row had no paste and no
   drop, and its prompt took plain text only and refused every drop. Import
   File… was the one way to add a file from outside.
5. **A drop on the canvas took files with a path only.** A picture dragged
   from a browser page was lost.
6. **Whether a paste moved was kept apart from what was copied**, in a
   variable of the window that stayed set after the clipboard changed. Once
   a paste reads the files another app copied, a cut in BaseHalf followed by
   a copy in a file manager would have moved its files.

Each place wrote and read the clipboard in a form of its own, so each new
place that should take something needed code of its own, and most had none.

## Goals

- One thing is handed over by a copy, a cut, and a drag: a **transfer**.
  BaseHalf writes it in one way and reads it in one way, and every place
  that takes things takes a transfer.
- A copy in BaseHalf can be pasted in any app that takes files or text, and
  what another app copies can be pasted in BaseHalf.
- The keys work as in every app: the place that has the keyboard takes
  Command-C, Command-X, and Command-V.
- A paste and a drop are the same act; a drop is a paste at the point it was
  let go.
- What has no file yet, a picture or text, becomes a file where it lands, so
  that every place takes items, as a card is a file.

## Non-goals

- Copying connections. A copy of cards carries none, as before; New Version
  starts a draft with the same inputs.
- Putting a picture's own data on the clipboard. A copy of an image card
  holds its file, as a file manager's copy of an image file does; an app that takes
  files takes it.
- Fetching what a dragged or copied web address points to. A link is text.
- Windows and Linux. There the clipboard holds BaseHalf's record of the
  items only, as VS Code's own type did; other apps get nothing from it.

## Terms

- **Transfer**: what one copy, one cut, or one drag holds, as BaseHalf reads
  it. It is one of:
  - **items**: files and folders on disk, and drafts, which have no file
    ([generation cards](generation-cards.md#drafts-and-missing-files)), and
    whether they were cut;
  - **a picture**: image data with no file, as a screenshot taken to the
    clipboard, Copy Image in a browser, or a picture copied in an image app
    puts there;
  - **text**.
- **BaseHalf's record**: the part of a copy that only BaseHalf reads. It
  names every item by its address, says which are drafts, and says whether
  they were cut.
- **The place that has the keyboard**: the element that has the keyboard
  focus, or the place it is inside: the canvas, the panel of a draft and its
  prompt, Files, a note's editor, a text field, the terminal.
- **This workspace folder**: the workspace folder of the place that takes
  the transfer.

## Required behavior

### Copy and Cut

- Command-C and Command-X, Copy and Cut of the Edit menu, and Copy and Cut
  of a card's menu copy what is selected in the place that has the keyboard:
  - on the canvas, the selected cards, drafts and folders too. Copy or Cut
    in the menu of a card that is one of the selected cards copies all of
    them, as a file manager does; on a card that is not selected, that card;
  - in Files, the selected items;
  - in Card Detail of a video, a sound, or an image BaseHalf can edit, its
    file; a PDF, a book, and a picture BaseHalf shows in a page of its own
    copy the text selected in them, as before;
  - in a text field, a note's editor, and the prompt, the selected text, as
    before.
- With nothing selected, a copy changes nothing on the clipboard.
- A copy of items writes the system clipboard once, in three forms at once:
  1. **the files and folders themselves**, as a file manager writes files it copies,
     so that a file manager, a mail app, a chat app, and a browser page take them as
     files;
  2. **their paths**, relative to their workspace folder, one per line, as
     text, so that a text field, the terminal, and an agent take the paths;
  3. **BaseHalf's record**.
  A draft has no file and is in the record and the paths only.
- A cut item stays where it is until a paste in BaseHalf moves it. Another
  app takes a cut item as a copy.
- The write takes about 0.1 s and does not hold up the window. A paste in
  BaseHalf that starts before it is done reads what it wrote.
- The window copies only where text is selected, unless the place says
  beforehand that it has something to copy: the canvas says so while cards
  are selected, and Card Detail while it shows a file that is not edited as
  text. Without selected text the window hands a copy to the page, not to
  the element that has the keyboard, so the place is found by the keyboard
  focus.

### Paste

- Command-V, Paste of the Edit menu, and Paste of the canvas's menu read the
  clipboard as one transfer: the first that is there of
  1. BaseHalf's record: its items, and whether they were cut;
  2. files that another app copied, as items, not cut;
  3. a picture: PNG and JPEG data as they are, any other picture as PNG;
  4. text.
  A clipboard that holds none of them pastes nothing and says nothing.
- The place that has the keyboard takes the transfer, as the table of
  [The places](#the-places) says. Command-V in a text field, a note's
  editor, or the terminal pastes as it did, apart from what that table
  says.

### Drop

- What is dragged onto a place that takes a transfer is read as one, the
  first that is there of: items dragged from Files; files dragged from
  another app; a picture dragged from another app or a browser page, which
  has no file; text.
- The place under the pointer takes it as it would take a paste, at the
  point where it is let go.
- Dragging a card on the canvas moves it, as before; it is no drop.

### What is not a file becomes one

- A picture becomes a file in the folder where it lands, named as New Note
  names a note: `untitled.png`, or the first free of `untitled-1.png`,
  `untitled-2.png`, and so on, with the extension of its format. A picture
  dragged from another app that has a name keeps it, or takes the first free
  name with a number after it: `cat.jpg`, then `cat 2.jpg`.
- Text on the canvas or in an input row becomes a note with that text,
  `untitled.md` or the first free `untitled-1.md`, as New Note names it.
- Items from outside this workspace folder are copied in. On the canvas they
  are named as a paste of files is named
  ([exact undo](exact-undo.md#what-the-canvas-made)); in the card's folder
  of a draft, as Import File… names its copy.
- A name a draft holds is taken, as for every name the canvas chooses.

### The places

| The place | Items of this workspace folder | Files from elsewhere | A picture | Text |
| --- | --- | --- | --- | --- |
| The canvas | copied into its folder, moved when cut | copied into its folder | saved in its folder | a new note |
| A folder's card under a drop | as [dropping into a folder](canvas-drop-into-folder.md) says | copied into that folder | saved in that folder | a new note in that folder |
| The input row of a draft | connected where they are | copied into the card's folder and connected | saved in the card's folder and connected | a new note in the card's folder, connected |
| The prompt of a draft | as the input row, and each mentioned at the caret | as the input row, and mentioned | as the input row, and mentioned | typed at the caret |
| Files | copied, moved when cut, as before | copied | nothing | nothing |
| The terminal of the Agent Area | their paths | their paths | nothing | typed |

### The canvas

- The canvas has the keyboard when the canvas itself, a card on it, or the
  toolbar of a selection has it, and not a field of a card, a note that is
  edited on its card, or the panel of a draft.
- Its cards are placed as cards that are pasted
  ([canvas card placement](canvas-card-placement.md#pointing)):
  - after Command-V and Paste of the Edit menu, as a card made with a
    keyboard command: the block of the cards is centered on the middle of
    the visible part of the canvas, and each card whose place is taken goes
    to the nearest open place;
  - after Paste of the canvas's menu, at the point where the menu was
    opened;
  - after a drop, at the point where it was let go.
- The cards it made are selected. A paste with a folder's card selected goes
  into the canvas's folder, as a paste in a file manager goes into the window's
  folder, not into the selected folder.
- The whole paste is one step of the canvas's undo, the files it copied,
  moved, or made and the drafts together
  ([exact undo](exact-undo.md#what-the-canvas-made)).
- After a paste that moved cut items, the clipboard holds them at their new
  places, not cut: a second paste makes copies, as in a canvas app.
- A paste while Card Detail is open takes nothing on the canvas.

### The input row of a draft

- The input row has the keyboard after a click on it, on a tile, or on an
  empty frame. A click on one of the two buttons that add an input, at the
  start of the panel's footer (D106,
  [generation cards](generation-cards.md#the-panel)), or a press anywhere on
  the panel where it has no control gives the panel the keyboard, with no
  ring, and a paste there is a paste in the input row. So a draft that shows
  no input row, as an image draft until it has an input, takes a paste too.
- Items of this workspace folder are connected where they are, as Pick on
  Canvas connects a card; nothing is copied or moved, also when they were
  cut, and the clipboard stays as it is. Drafts are connected as cards are.
- Files from elsewhere, a picture, and text first become files in the card's
  folder, as Import File… copies a file there, and are connected.
- Each is asked about as one connection on the canvas is: what the model
  cannot use is refused with the reason, and nothing is copied or saved for
  it ([generation cards](generation-cards.md#what-is-connected-is-sent)).
  An item that is already an input stays where it is in the row.
- The new inputs come after the card's inputs, in the transfer's order, one
  after the other, each asked about with the ones before it among the
  inputs. Each connection is a step of undo, as with Pick on Canvas. A file
  that was copied or made stays when its connection is undone, as Import
  File…'s copy does.
- A drop anywhere on the panel but its prompt is a paste in the input row.

### The prompt of a draft

- Text is typed at the caret, as before.
- Items, files, and a picture are taken as the input row takes them, and the
  mention of each that is an input then is put at the caret, one after the
  other, each followed by a space (D74).
- The prompt tells files from text by what the window hands its paste: a
  copy that holds files or a picture comes as files. A copy that holds only
  drafts has no file, and the prompt types their paths.
- A drop on the prompt puts the caret where it is let go first.

### Files

- Files writes and reads the clipboard the same way: its Copy and Cut write
  the three forms, and its Paste reads the items of a transfer, also files
  that a file manager copied. Whether a paste moves comes from the record, never
  from an earlier cut in the window.
- A draft is not in Files, and a paste in Files leaves out the drafts of a
  record.

### The terminal of the Agent Area

- Text is typed as before.
- When the clipboard holds files, copied in BaseHalf, in Files, or in
  another app, a paste types their full paths, one after the other with a
  space between, each quoted for the shell as a drop of a file on the
  terminal quotes it. Before, it typed what the clipboard held as text:
  nothing after a copy in Files, and the file's name after a copy in
  a file manager.

### Card Detail

- Command-C in Card Detail of a video, a sound, or an image BaseHalf can
  edit copies its file, as Copy of its card does. A PDF, a book, and a
  picture shown in a page of its own copy the text selected in them.
- Card Detail takes no paste and no cut.

## Acceptance criteria

1. A card selected on the canvas, Command-C, then Command-V on the canvas
   makes a copy of it, centered on the middle of the visible canvas or at
   the nearest open place there, and selects it. One undo takes it away.
2. Command-X on a selected card, then Command-V on the canvas of another
   folder moves it there; a second Command-V makes a copy of it.
3. Command-C on two selected cards writes the clipboard once with both
   files, their paths as text, and BaseHalf's record: a file manager pastes both
   files, and a text field pastes the two paths.
4. Files copied in a file manager, then Command-V on the canvas, copies them into the
   canvas's folder.
5. A picture on the clipboard, then Command-V on the canvas, makes
   `untitled.png` in the canvas's folder and its card; a second paste makes
   `untitled-1.png`.
6. Text on the clipboard, then Command-V on the canvas, makes `untitled.md`
   with that text and its card.
7. Paste of the canvas's menu takes the same transfers at the menu's point.
8. A card copied on the canvas, a click on the input row of a draft, and
   Command-V connects the card: its tile shows, its line is drawn, and no
   file is copied.
9. A picture on the clipboard, Command-V in the input row: the picture is
   saved in the card's folder and connected. On a model that cannot take it,
   the reason shows and nothing is saved.
10. Command-V in the prompt with a copied card connects it and puts its
    mention at the caret; with text, types the text.
11. A file dragged from a file manager onto the input row or the prompt is copied into
    the card's folder and connected; onto the prompt, also mentioned.
12. A picture dragged from a browser page onto the canvas becomes a file and
    a card at the point it was let go.
13. After Cut on the canvas and a copy of files in a file manager, Paste in Files
    copies those files and moves nothing.
14. Command-C in a text field of the canvas or in the prompt copies its text
    and no card.

## Verification

- Unit: the record's form and its reading, the names a picture and text
  take, the list of files that the system gives, and the place of a block pasted
  without a point (`clipboard/test/common/basehalfClipboard.test.ts`); what a
  drop holds (`clipboard/test/browser/basehalfTransfer.test.ts`); a paste in
  the input row and in the prompt (`basehalfVideoNodePanel.test.ts`, the test
  that names D104); the terminal's paste of files
  (`terminalClipboard.test.ts`).
- Smoke, canvas suite: `canvas-copy-paste-keys` covers criteria 1, 3 (the
  three forms of one card), 6, and 14. It writes the system clipboard, so it
  runs only while the clipboard holds text alone, which it puts back, or on
  CI, or with `BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE=1`.
- The real window: the rest, below.

### Tried in the real window, 2026-10-29

An isolated window of the branch, driven over CDP with the real keys, the
system clipboard written and read with AppKit:

- Command-C on a selected card: the clipboard held `public.file-url`, the
  text `photo.png`, and the record. Command-V on the canvas made
  `photo copy.png` (criteria 1, 3).
- Files written to the clipboard as a file manager writes them, then Command-V: the
  file was copied in (criterion 4). A picture made `untitled.png`, text made
  `untitled.md` with that text (criteria 5, 6).
- A note copied on the canvas, a press on the empty part of a video draft's
  input row, Command-V: its tile showed, and no file was made (criterion 8).
- A picture, then Command-V in the prompt after `Use `: `untitled-1.png` was
  made, connected as the start frame, and the prompt read `Use
  @[untitled-1.png] ` (criteria 9, 10).
- Command-X on `plan.md`, its folder's canvas left for `sub`, Command-V:
  `plan.md` moved into `sub`, and the clipboard then named `sub/plan.md`,
  not cut; a second Command-V made `plan copy.md` (criterion 2).
- Card Detail of `photo.png`, the keyboard on its picture, Command-C: the
  clipboard held its file and the text `photo.png`.
- Found there and fixed before this was written: the window sent the copy
  of a card to the page's body, not to the card, and only after the canvas
  said it had something to copy; a press on the empty part of the input row
  gave the keyboard to the canvas, which took the paste.
