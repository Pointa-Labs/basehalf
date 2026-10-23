# Canvas card name

Status: Active (2026-10-13; the name of a note revised the same day for D55;
a generation card's name is its file's name, 2026-10-22 for D63)
Decisions: [D55](../decisions.md),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22)
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
- A note is named without its extension, and its name cannot lose the
  extension by a rename.
- There is one rename editor. The double click opens the editor that F2 and
  Rename open.
- The editor can be typed into at once, and it is not disturbed by what
  agents do in the folder meanwhile.

## Scope

In scope:

- The name that BaseHalf shows for an item.
- The part of a card's caption that takes the double click, and the pointer
  over it.
- What a double click on it does.
- What the rename editor does. It existed before this specification and no
  document stated it.

Not in scope, and unchanged:

- The file itself. A note is a file whose name ends with `.md` or
  `.markdown`, whatever BaseHalf shows.
- The default name of a new note: `untitled.md`, `untitled-1.md`, and so on.
- The Files view, Search, and Quick Open. They list files and show file
  names.
- F2, and Rename in the toolbar and the menu.
- The title of Card Detail and its Rename button.

## Terms

- **Caption**: the row above a card. From the left it holds the kind glyph,
  the name, and the badge button.
- **Note**: a file whose name ends with `.md` or `.markdown`, in any letter
  case.
- **File name**: the name of the item on disk.
- **Name**: what BaseHalf shows for an item where it names the item. For a
  note it is the file name without its extension. For every other file and
  for every folder it is the file name, a generated image or video included.
  For a draft it is the name its file will have
  ([generation cards](generation-cards.md#the-card)).
- **Name target**: the element that shows the name. It is as wide as the
  text it shows. A name that is longer than the room of the caption is cut
  with an ellipsis, and the name target then ends where the room ends. The
  glyph, the empty part of the caption right of the name, and the badge
  button are not part of it.
- **Rename editor**: the name of a card while it is being changed. It is
  the name made editable where it stands, not a box that is put over it.
  The glyph stays where it is.

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

### The name that is shown

A note is the kind of file BaseHalf is made for, and the glyph beside its
name says that it is a note. Its extension says nothing more, and a user
who does not read code has no use for it. Other files are told apart by
their extension alone, as `index.ts` and `index.css` are, so they keep it.

| Item | File name | Name |
| --- | --- | --- |
| A note | `plan.md`, `Plan.MD`, `plan.markdown` | `plan`, `Plan`, `plan` |
| A note with dots in its name | `v1.2.md` | `v1.2` |
| Another file | `data.csv`, `index.ts`, `notes.mdx` | the file name |
| A folder, also one named like a note | `docs`, `drafts.md` | the file name |
| A file that is only the extension | `.md` | `.md` |

The name is shown, and not the file name:

- in the caption of a card, and in the label that assistive technology reads
  for the card;
- in the rows of a folder card, which name what the folder holds;
- in the title of Card Detail;
- in the last part of the title bar's breadcrumb while a note is open;
- in the rows of a card's Upstream and Downstream lists, and in the rows of
  the picker that adds one.

The file name or the path is shown as it is:

- wherever a path is shown: the second line of a picker row, a copied
  reference;
- in a sentence that BaseHalf says about a file: a question before a
  delete, the name of a step of undo, a notification;
- in the Files view, Search, and Quick Open.

Two items of one folder can have the same name: `plan.md` beside a folder
or a file `plan`. Their glyphs differ. Nothing is done to keep them apart.

One row does not know what kind of item it names: a row of a Downstream
list. It names its item as a file, so a folder that is named like a note is
shown there without the ending. Everywhere else such a folder keeps it.

### Which names can be changed in place

The name of a card can be changed in place when the name is the card's file
name and the file is there: a note, another file, a folder, and a generation
card with its file. The name of a draft can be changed in place too: it is
the name its file will have, and renaming the draft moves its card
information and its row to the new name
([generation cards](generation-cards.md#moving-renaming-copying-and-undo)).

It cannot be changed in place on a card whose file is missing and that is
not a draft: there is nothing to rename. On such a card the name target
behaves as the rest of the caption does.

### The pointer

Over a name target whose name can be changed in place, the pointer is the
text cursor. Over the rest of the caption it is as before.

Two states come first:

- While a card is dragged, the pointer is the drag cursor, also over a name.
- While a generation card waits for the user to pick an input (**Pick on
  Canvas**), the pointer over a card is the cursor of the pick, also over its
  name.

### Input on the name target

Changing a name is not selecting a card. A selected card shows a toolbar
above it, and a toolbar that comes up over the name that is being typed is
in the way of it.

| Input | What happens |
| --- | --- |
| Double click, primary button, no modifier key | The rename editor opens in the caption. No card is selected: neither this one nor one that was selected before, so no toolbar is shown. Nothing else opens: no note editor, no Card Detail, and a folder is not entered. |
| Click | Nothing. The name is text: a press on it selects no card and ends no selection. The card is selected from every other part of it. |
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

The editor is the name itself, made editable. Opening it must not look like
something was opened: a box that appears over the name draws the eye, and
its text does not stand where the name stood.

- **Nothing moves.** The text of the editor begins where the text of the
  name began and stands on the same line, in the same type: the same size,
  weight, and color. Only the selection and the caret show that the name can
  now be typed.
- **No frame.** The editor has no border, no background, no ring for the
  focus, and no rounded corners.
- **As wide as its text.** The editor grows and shrinks with what is typed,
  up to the room of the caption. A name that is longer than the room is
  shown from its beginning, as the name was. The rest of the caption is the
  caption: a press there is a press outside the editor.
- **A name that cannot be used** is underlined in the color of an error
  while it is typed, and nothing else appears: a message that comes and
  goes with every letter is not editing in place. When Enter is refused for
  such a name, the reason is shown below the caption until the name is
  changed.
- An empty editor shows a pale `Note name`, `Folder name`, or `filename.ext`
  in the place of the name.

- For a note it holds the name, without the extension, and all of it is
  selected. What is typed becomes the name, and the file keeps the
  extension it had, as it was written: `plan.MD` renamed to `Draft` is
  `Draft.MD`.
  - A typed name that ends with that extension is taken as the file name:
    `draft.md` gives `draft.md`, not `draft.md.md`.
  - Another extension is part of the name: `draft.txt` gives `draft.txt.md`,
    which is shown as `draft.txt`. A note stays a note. Its kind is changed
    in the Files view.
  - A name that cannot be used is judged by the file name it would give.
    An empty name is refused before an extension is added.
- For another file it holds the file name, and the part before the
  extension is selected. For a folder and for a file without an extension
  the whole name is selected.
- For a draft it holds the name its file will have, and the part before the
  extension is selected, as for another file. A draft keeps its kind, so a
  name that does not end with an extension of that kind cannot be used
  ([generation cards](generation-cards.md#terms)): for an image draft `.png`,
  `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`, or `.bmp`, and for a video draft
  `.mp4`, `.mov`, `.m4v`, or `.webm`.
- It has the keyboard when it opens, whichever way it was opened. What the
  user types next replaces the selected part.
- The title of Card Detail is renamed by the same rules, in its own input.
- **What is done inside the editor stays in the editor.** A click there
  puts the caret where it lands, a double click selects a word, and a drag
  selects text. None of them selects the card, moves it, or opens anything.
  A secondary click there does nothing: the card's menu would take the
  keyboard from the name.
- **No card is selected while a name is edited**, whichever way the editor
  was opened. F2 and Rename open it for a card that is selected: that
  selection ends when the editor opens.
- **Enter** renames the file, or, for a draft, moves its card information
  and its row to the new name. Afterwards no card is selected, and the canvas
  has the keyboard, as after Escape. A
  name that was not changed closes the editor and renames nothing. A name
  that cannot be used keeps the editor open and shows why: an empty name, a
  name with a path separator, a name the file system does not take, the
  name of another item of the folder, a draft included
  ([generation cards](generation-cards.md#creating-a-generation-card)).
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
   card with the name in it, without the extension, and all of it selected.
   No card is selected and no toolbar is shown, in every frame from the
   first press to the open editor. No note editor and no Card Detail is
   open.
5. A double click on the name of a folder opens the rename editor, and the
   canvas still shows the same folder.
6. Enter with another name renames the file. The card shows the new name at
   the place and with the size it had.
7. Escape closes the editor, and the file has the name it had.
8. A double click on the glyph of a note opens nothing. A double click on
   the glyph of a folder enters the folder.
9. A press on a name that moves more than the drag distance moves the card
   and opens no editor.
10. On a card whose file is missing and that is not a draft, the cursor over
    the name is not `text`, and a double click on the name does what a
    double click on the glyph does.
11. In a set, a double click on a name changes nothing.
12. After F2, after Rename, and after a double click on the name, the input
    is the element that has the keyboard, with the name of a note or the
    part before the extension of another file selected. Typing without a
    click replaces that part.
13. With the editor open and the caret inside the typed text, a file that
    is added to the folder, a file that is changed, and a file that is
    removed leave the same input element in the document, with the
    keyboard, its text, and its caret.
14. With the editor open, writing the file that is being renamed leaves the
    input in the document in every frame, with its text and its caret.
    Enter then renames the file.
15. After Enter, and after Escape, no card is selected.
24. A click on the name of a card selects nothing, and a card that was
    selected stays selected. A click on the glyph of the same card selects
    it.
25. F2 on a selected card opens the editor, and no card is selected while it
    is open.
26. With the editor open, a click in the middle of its text puts the caret
    there, a double click selects a word, and a secondary click changes
    nothing. After each of them the editor has the keyboard, no card is
    selected, and no toolbar or menu is shown.
27. A double click on the name of a draft, `video.mp4`, opens the editor
    with `video` selected. Enter with `shot` moves the draft to `shot.mp4`:
    its card keeps its place, its prompt, and its connections. A name that
    ends with `.png`, and the name of another draft of the folder, are not
    accepted for it. On a generation card with its file, Enter renames the
    file.

The name that is shown

16. The card of `README.md` shows `README`, and the card of a file that is
    not a note shows its file name. A folder named `drafts.md` shows
    `drafts.md`.
17. A name typed into the rename editor of `README.md` renames the file to
    that name with `.md`. A typed name that ends with `.md` gives that file
    name and no second extension.
18. With a note open, the title of Card Detail and the last part of the
    breadcrumb show the name without the extension, and the rename input of
    the title holds it.
19. A row of a folder card and a row of an Upstream or Downstream list name
    a note without its extension, and the pointer over the row shows
    nothing more.

The editor in place

20. When the editor opens, the left edge and the vertical place of its text
    are those of the name, to half a screen pixel, and its font size, font
    weight, line height, and color are the name's.
21. The editor draws no border, no background, and no outline, also while it
    has the keyboard.
22. The editor is as wide as its text: wider after a character is typed and
    narrower after one is removed, and never wider than the room of the
    caption. A press on the caption right of the text ends the edit as a
    press outside does.
23. While the name of another item of the folder stands in the editor, the
    text is underlined and no message is shown. Enter then keeps the editor
    open and shows the reason.

## Verification

- Unit: `basehalfCanvasReactScene.test.ts` covers what a double click on a
  card does from where it lands, the kind of the card, and the keys held
  (criteria 4, 5, 8, 10 as a rule). `basehalfCardDetail.test.ts` covers the
  name of an item and the file name of a typed name, with the rows of the
  table above (criteria 16 and 17 as a rule). `basehalfUpstreamActions.test.ts`
  covers the rows of the lists (criterion 19).
- Smoke: `canvas-inline-rename` covers criteria 1, 2, 4 to 8, 12 to 15, 20
  to 23, and the click on a name of criterion 24 in the real window. It
  makes its first double click at a person's speed and counts the frames
  that show a selected card. The press on the caption right of the text,
  of criterion 22, was measured by hand: see below. It is a step of the
  `canvas` suite. It types with the keyboard and never fills the input,
  so an editor without the keyboard fails it. For criterion 14 it writes
  other content into the note and checks that the card was drawn again. On
  the code before this change the step fails at its first editor: no
  keyboard and nothing selected.
- Criteria 3, 9, and 11 were measured in a development window on a
  disposable workspace: see below. The card of criterion 10 follows from the
  unit test and was not driven.
- Criterion 27 is part of criterion 5 of
  [generation cards](generation-cards.md#acceptance-criteria), whose smoke
  renames a draft on the canvas.

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

The name of a note (D55), in the same kind of window:

| What was done | What was seen |
| --- | --- |
| A folder of `plan.md`, `untitled-3.md`, `Upper.MD`, `v1.2.md`, `data.csv`, `index.ts`, the folders `docs` and `drafts.md` | the cards `plan`, `untitled-3`, `Upper`, `v1.2`, `data.csv`, `index.ts`, `docs`, `drafts.md`. The rows of the two folder cards: `guide` and `inside`. |
| A double click on `untitled-3` | the editor held `untitled-3`, all selected. |
| Typed `特征`, Enter | the file `特征.md` |
| Typed `feature.md`, Enter | the file `feature.md` |
| Typed `feature.txt`, Enter | the file `feature.txt.md`, shown as `feature.txt` |
| `Upper.MD`, typed `Renamed` | the file `Renamed.MD` |
| `v1.2` | the editor held `v1.2`, all selected. |
| An empty name, Enter | the editor stayed open: a name is required. |
| `plan`, typed `Renamed` while `Renamed.MD` was there | the editor stayed open: the name exists. |
| `plan`, typed `plan.md`, Enter | the editor closed and nothing was renamed. |
| `data.csv` and the folder `drafts.md` | the editors held the file names: `data` selected, and all of `drafts.md`. |
| `plan.md` opened in Card Detail | the title `plan`, the breadcrumb `workspace` and `plan`, and `workspace / plan.md` as the tooltip of its last part. The title's input held `plan`, and `plan-from-detail` typed there gave `plan-from-detail.md`. |

The editor in place, in the same kind of window at 61% zoom:

| What was done | What was seen |
| --- | --- |
| A double click on `untitled-3` | the text of the editor began at the same left edge as the name, on the same line, in the same size, weight, line height, and color: every offset was 0. The editor was 38.6 screen pixels wide, as the text of the name was. No border, background, or outline. |
| The caption at rest and with the editor open, the caret at the end and hidden in its blink, compared pixel by pixel | no pixel of the name differed. The only difference was the badge button of the selected card. |
| `-longer` typed, then twelve characters removed, then all | the editor was 66.9, then 17.9 screen pixels wide, and 40.1 when it was empty and showed `Note name`. |
| The name of another note typed | the text was underlined in the error color, and no message was shown. |
| A press on the caption between the text and the badge button | the element there was the caption. The file was renamed, as by a press outside. |
| A name of 43 characters | the editor began where the name began and showed the name from its beginning, 147.8 pixels wide in a room of 152.7. |
| The names of a folder and of a data file | the same: every offset 0, and as wide as the text. |

A name is changed without a card being selected, in the same kind of
window:

| What was done | What was seen |
| --- | --- |
| A double click on the name of a card that was not selected, 220 ms between the two clicks, sampled on every frame until the editor was open | 138 frames: none with a selected card, none with a toolbar. |
| Enter, and Escape | no card selected, no toolbar. |
| A click on the name of a card | nothing selected. A click on its glyph: the card selected, with its toolbar. |
| With one card selected, a click on the name of another card | the first card stayed selected. |
| A double click on the name of the selected card, and F2 on a selected card | the editor opened, and no card was selected. |
| A press on a name and a drag | the card moved, and the drag selected it, as a drag from anywhere does. |
| A note edited in one card, then a double click on the name of another | the note editor closed, the name's editor opened, and no card was selected. |
| With the editor open: a click in the middle of the text, a double click on a word, a drag over the text, a secondary click | the caret went to the middle and a typed letter went in there, a word was selected, text was selected and the card did not move, and nothing changed. In every frame of each: no selected card, no toolbar, no menu. |

Before the change the same steps gave: no keyboard after F2 or a double
click; another input element after every change in the folder, with the
caret at the end (`特征.mdX`); and a refused rename after the note was
rewritten.

## Open questions

- **The title of Card Detail.** Its rename input is still a box of a fixed
  width with a border, and its text stands three pixels right of the
  title's. It follows the rules of the name, and not yet the rule that the
  editor is the name in place.
- **The name in a sentence.** A question before a delete and the name of a
  step of undo say the file name, so a note is `plan.md` there and `plan`
  on its card. Whether they say the name is open.

The title of a video card, which was kept inside the card's document, is
gone: since D63 the name of a generation card is its file's name, and it is
changed in place like any other.
