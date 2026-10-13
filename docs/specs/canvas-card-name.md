# Canvas card name

Status: Active (2026-10-13)
Related: [canvas selection and arrangement](canvas-selection-and-arrangement.md)
(what a card of a set answers),
[canvas card interaction continuity](canvas-card-interaction-continuity.md),
[canvas card placement](canvas-card-placement.md) (a renamed card keeps its
place), [reference graph](reference-graph.md#rename-refactor) (what a rename
rewrites)

## Problem

A card's name could be changed in two ways: F2 while the card has the
keyboard focus, and Rename in the card's toolbar or menu. Neither is found
by pointing at the name. A new note is called `untitled-3.md`, and its name
is the first thing a user wants to change. The place they point at is the
name itself, and a double click there did nothing on a note and opened any
other card.

The rename editor that F2 and Rename opened had three faults of its own.
They were found in the real window on 2026-10-13, while the double click was
built on it:

1. **It did not have the keyboard.** It asked for it before its card was in
   the document. The user had to click into the input before typing.
2. **It was built again whenever the canvas was drawn.** The typed text was
   kept, and the caret went to the end, behind the extension. After an agent
   had written any file of the folder, the next letter made `plan.md` into
   `plan.mdx`.
3. **A note that was written while its name was edited could not be
   renamed.** The rename was refused because the file had changed, and it
   was refused again on every try.

## Goals

- A double click on a card's name changes the name in place.
- The pointer shows that the name is text that can be changed, and it shows
  it only over the text.
- There is one rename editor. The double click opens the editor that F2 and
  Rename open.
- The editor can be typed into at once, and it is not disturbed by what
  agents do in the folder meanwhile.

## Scope

In scope:

- The part of a card's caption that takes the double click, and the pointer
  over it.
- What a double click on it does.
- What the rename editor does. It existed before this specification and no
  document stated it.

Not in scope, and unchanged:

- Which name a card shows. A note, another file, and a folder show the file
  name with its extension. See [open questions](#open-questions).
- The default name of a new note.
- F2, and Rename in the toolbar and the menu.
- The title of a video card. It is kept inside the card's document and is
  changed in the card's own surface.
- The title of Card Detail and its Rename button.

## Terms

- **Caption**: the row above a card. From the left it holds the kind glyph,
  the name, and the badge button.
- **Name**: the text the caption shows for the card.
- **Name target**: the element that shows the name. It is as wide as the
  text it shows. A name that is longer than the room of the caption is cut
  with an ellipsis, and the name target then ends where the room ends. The
  glyph, the empty part of the caption right of the name, and the badge
  button are not part of it.
- **Rename editor**: the input that takes the place of the name in the
  caption while a card is renamed. The glyph stays where it is.

## What another canvas product does

A canvas product of the same kind was tried in the window on 2026-10-13, on
a test canvas, and nothing was changed there. It is built on the canvas
library that BaseHalf uses.

| Behavior | That product |
| --- | --- |
| The pointer over the text of a node's title | the text cursor |
| The pointer over the glyph and over the rest of the title row | not the text cursor |
| How wide the part with the text cursor is | as wide as the text: 62 pixels for a title of six characters in a row of 212 |
| A double click on the title | an input replaces the text in place, and the node is selected |
| What the input holds | the whole title, all of it selected |
| How wide the input is | the rest of the row |
| Escape | the input closes and the title is as it was |

A second product of the same kind shows the drag cursor over its titles and
does not change a title on a double click.

The node of that product is a row in its own store, and its title is a
label: two nodes of the test canvas had the same title. A BaseHalf card is a
file, and its name is the file's name. So the rules for a name that cannot
be used are BaseHalf's own.

## Required behavior

### Which names can be changed in place

The name of a card can be changed in place when the name is the card's file
name and the file is there: a note, another file, a folder.

It cannot be changed in place on:

- **A video card.** Its name is the title inside the card's document.
  Renaming the card changes only the path of that document, and the caption
  would show the same title afterwards.
- **A card whose file is missing.** There is nothing to rename.

On these two the name target behaves as the rest of the caption does.

### The pointer

Over a name target whose name can be changed in place, the pointer is the
text cursor. Over the rest of the caption it is as before.

Two states come first:

- While a card is dragged, the pointer is the drag cursor, also over a name.
- While a video card waits for the user to pick an input, the pointer over
  a card is the cursor of the pick, also over its name.

### Input on the name target

| Input | What happens |
| --- | --- |
| Double click, primary button, no modifier key | The card becomes the one selected card, and the rename editor opens in its caption. Nothing else opens: no note editor, no Card Detail, and a folder is not entered. |
| Click | The card is selected, as by a click on the rest of the card. |
| Press and drag | The card moves, as by a drag from the rest of the caption. No editor opens. |
| Double click with Shift, Command, Control, or Alt held | As on the rest of the caption. |
| Secondary click | The card's menu, as before. |

A double click on the glyph or on the empty part of the caption does what
it did before: nothing on a note, and it opens any other card.

A card of a set is under the set box, and the box takes every click and
double click
([canvas selection and arrangement](canvas-selection-and-arrangement.md#required-behavior)).
A double click on the name of a card of a set changes nothing.

### The rename editor

- It holds the file name. The part before the extension is selected. The
  whole name is selected for a folder and for a file without an extension.
- It has the keyboard when it opens, whichever way it was opened. What the
  user types next replaces the selected part, and the extension stays.
- **Enter** renames the file. Afterwards the card is the one selected card
  under its new name, and the canvas has the keyboard, as after Escape. A
  name that was not changed closes the editor and renames nothing. A name
  that cannot be used keeps the editor open and shows why: an empty name, a
  name with a path separator, a name the file system does not take, the
  name of another item of the folder.
- **Escape** closes the editor. Nothing is renamed.
- **A press outside the editor** renames when the name can be used. When it
  cannot, the editor closes and nothing is renamed. What the press lands on
  decides what is selected afterwards.
- A rename is one step of the canvas's undo.
- **What the file holds does not matter to its name.** A file that was
  written while its name was edited is renamed all the same. An item that
  was moved or removed meanwhile is not: see [failure](#failure).
- The card keeps its place and its size, and the entries that named the old
  path are rewritten
  ([canvas card placement](canvas-card-placement.md),
  [reference graph](reference-graph.md#rename-refactor)).

### While the editor is open

The editor lives as long as the rename, not as long as one drawing of its
card.

- When the canvas is drawn again for something else, such as a file that an
  agent added, changed, or removed, the card that shows the editor is kept
  as any other card is. The input is the same element: it keeps the
  keyboard, the typed text, the caret, the selection, and a composition of
  an input method that is open.
- When the card itself has to be drawn again, because its own file was
  written, the editor moves into the new drawing of the card in the same
  frame. It keeps the typed text, the caret, and the selection, and it has
  the keyboard again. A composition that is open at that moment ends: the
  letters typed for it stay in the input as letters.
- In no frame is the card shown without its editor while the rename is
  open.

### States

| State when the name is double-clicked | What happens |
| --- | --- |
| The card's note is being edited in the card | The note editor closes first, and the note's text is as the user left it. Then the rename editor opens. When the note cannot be closed, no rename editor opens. |
| Another card's note is being edited | That editor closes first, as by a click on another card. |
| A rename editor is open in another card | That editor is left first, as by a press outside it. Then this one opens. |
| A rename editor is open in this card | The double click is in the input and selects a word there. |
| Card Detail is open | The canvas takes no input. |
| The card is part of a set | Nothing changes. |

## Failure

- The file was removed or renamed between the double click and the editor:
  no editor opens, and the canvas shows its warning line. The card is drawn
  again from the folder as it is.
- The item was moved or removed while its name was edited, or another
  operation is changing it: Enter renames nothing, and the editor stays open
  and says that the item was moved or removed. A card whose item is gone
  leaves the canvas with its editor on the next drawing.
- The rename fails for another reason: the editor stays open with the
  message of the failure.
- In both cases the input can be typed into again. When the card was drawn
  without its editor while the name was being applied, the next drawing
  shows the editor again, with the typed name and the message.

## Acceptance criteria

1. Over the name of a note, of another file, and of a folder the computed
   cursor is `text`. Over the glyph of the same card, over a point of the
   caption 8 screen pixels right of the end of a short name, and over the
   badge button it is not `text`.
2. The name target of a short name is as wide as its text and not as wide
   as the caption.
3. A name that is longer than the caption ends with an ellipsis, and the
   name target ends left of the badge button.
4. A double click on the name of a note opens the rename editor in that
   card with the file name in it and the part before the extension
   selected. The card is the one selected card. No note editor and no Card
   Detail is open.
5. A double click on the name of a folder opens the rename editor, and the
   canvas still shows the same folder.
6. Enter with another name renames the file. The card shows the new name at
   the place and with the size it had.
7. Escape closes the editor, and the file has the name it had.
8. A double click on the glyph of a note opens nothing. A double click on
   the glyph of a folder enters the folder.
9. A press on a name that moves more than the drag distance moves the card
   and opens no editor.
10. On a video card and on a card whose file is missing, the cursor over
    the name is not `text`, and a double click on the name does what a
    double click on the glyph does.
11. In a set, a double click on a name changes nothing.
12. After F2, after Rename, and after a double click on the name, the input
    is the element that has the keyboard, with the part before the
    extension selected. Typing without a click replaces that part.
13. With the editor open and the caret inside the typed text, a file that
    is added to the folder, a file that is changed, and a file that is
    removed leave the same input element in the document, with the
    keyboard, its text, and its caret.
14. With the editor open, writing the file that is being renamed leaves the
    input in the document in every frame, with its text and its caret.
    Enter then renames the file.
15. After Enter the renamed card is the one selected card.

## Verification

- Unit: `basehalfCanvasReactScene.test.ts` covers what a double click on a
  card does from where it lands, the kind of the card, and the keys held
  (criteria 4, 5, 8, 10 as a rule).
- Smoke: `canvas-inline-rename` covers criteria 1, 2, 4 to 8, and 12 to 15
  in the real window. It is part of the whole run and of the `--canvas-only`
  slice. It types with the keyboard and never fills the input,
  so an editor without the keyboard fails it. For criterion 14 it writes
  other content into the note and checks that the card was drawn again. On
  the code before this change the step fails at its first editor: no
  keyboard and nothing selected.
- Criteria 3, 9, and 11 were measured in a development window on a
  disposable workspace: see below. The two cards of criterion 10 follow
  from the unit test and were not driven.

### Seen in the real window (2026-10-13)

A development window at 61% zoom, on a workspace of three notes, a folder,
and a data file. The pointer was moved and pressed as a user's is.

| What was done | What was seen |
| --- | --- |
| The pointer over `untitled-3.md` | text cursor. The name target was 53 screen pixels wide in a caption of 182. Over the glyph and 8 pixels right of the name: the drag cursor. Over the badge button: the pointer cursor. |
| A name of 43 characters | cut with an ellipsis. The name target ended 5 pixels left of the badge button. |
| A double click on the name of a note | the editor after 19 to 34 ms, with the keyboard, `untitled-3` selected. No note editor, no Card Detail. |
| Typing a name, Enter | `特征是什么.md`. The card's rectangle was the same to a tenth of a pixel, and the card was selected. |
| Typing, Escape | the file kept its name. |
| A press on a name and a drag of 48 by 32 pixels | the card moved, the pointer was the drag cursor over the name, no editor. |
| With the editor of one card open and a name typed: a double click on the name of another card, six times with 60 to 450 ms between the two clicks | each time the first file was renamed, and the second editor opened with the keyboard and its base name selected. No warning line. |
| A double click on the name while the note was edited in the card | the note was saved with the typed text, and the editor opened. |
| A double click on a name of a set of two | the element at the name was the set box. Nothing changed. |
| A double click on the glyph of a note, and of a folder | nothing, and the folder was entered. |
| With the editor open and the caret between two typed characters: a file added, another changed, the renamed note rewritten, a file removed | the same input element after each, with the keyboard and the caret where it was. The next letter went between the two characters. Enter renamed the rewritten note. |
| The renamed note rewritten twice, sampled on every frame for six seconds | no frame without the editor, without the keyboard, or with another caret. |
| A composition of an input method open (`tezheng`), while one file was added and another changed | the composition stayed open, without a blur. Its result went in as `特征.md`. |
| A composition open (`shi`), while the renamed note was rewritten | the input lost and got back the keyboard. `shi` stayed as letters, and the next result was added behind it. |
| The name of another item, Enter | the editor stayed open with the keyboard and said that the name exists. |
| A name of 303 characters, Enter | the editor stayed open and said that the name is not valid on the file system. Another name then renamed the file. |
| The note removed while its name was edited | the card and its editor left the canvas. |

Before the change the same steps gave: no keyboard after F2 or a double
click; another input element after every change in the folder, with the
caret at the end (`特征.mdX`); and a refused rename after the note was
rewritten.

## Open questions

- **Whether a note's name is shown without `.md`.** A note is the kind of
  file BaseHalf is made for, and its glyph already says what it is. Other
  files need their extension to be told apart. This specification shows and
  edits the file name as it is until that is decided.
- **Changing the title of a video card in place.** It needs a write to the
  card's document that does not collide with the card's own surface.
