# A note's title names its file

Status: Active (2026-11-12)
Decision: [D129](../decisions.md#d129--a-notes-title-names-its-file-and-its-card-shows-no-name-above-it-new-2026-11-12)
Related: [canvas card name](canvas-card-name.md) (the name BaseHalf shows and
the rename editor), [formats of a note](note-formats.md) (the editor on the
card and what it writes), [canvas Create menu](canvas-create-menu.md) (New
Note), [reference graph](reference-graph.md#rename-refactor) (what a rename
rewrites), [exact undo](exact-undo.md) (the steps of the canvas),
[the changes of a file](changes-of-a-file.md) (the mark of a changed card)

## The rule

The heading at the top of a note is its title. A note that the user gives a
title, or whose title the user changes, takes the title as the name of its
file. The title is written once, and it is shown once: a note's card shows
no name above it.

## Problem

A new note was `untitled.md`. To make it a card of a mind map the user typed
its title twice: once into the note as a heading, and once into its name.

On 2026-11-12 the launch film showed the steps for one branch of a map: pull
a line out of a card, choose Note, press Heading 2, type `Anatomy`, click
outside, double-click the name `untitled`, type `anatomy`, press Enter. The
user's words: the flow is tedious, changing only a title is odd, the top
title inside a note should be the file's name so that nothing is written
twice, and the default `untitled` is superfluous in the product.

Once the file followed the title, the card said the same words twice, in its
caption and in the note, and a note named by hand said two different ones
(`by-hand` above `Hand`). The user: the row above should not be shown at
all, and the badge button should stand in the card's upper right corner.

## Goals

- The user writes a note's title once, in the note, and reads it once.
- A new note asks for its title first.
- A note that agents or other programs write keeps the name they gave it.
- No file is renamed while it is being edited, or while the user does
  something else with its card.

## Scope

In scope:

- What the title of a note is.
- How the editor on a card starts in a note without text.
- When a note's file takes the name of its title, and which name.
- What a note's card shows in place of its caption.

Not in scope, and unchanged:

- The name BaseHalf shows for an item everywhere else: the rows of a folder
  card, the title of Card Detail, the path in the title bar, the lists of
  upstream and downstream, Files ([canvas card name](canvas-card-name.md)).
- The rename editor. A rename there changes the name and leaves the note's
  text as it is.
- The default file name of a new note: `untitled.md`, `untitled-1.md`, and
  so on. A file has a name before it has a title.
- The rich editor of Card Detail in a note without text. It starts with an
  empty paragraph ([open questions](#open-questions)).
- The captions of all other cards: a file that is no note, a picture, a
  video, a sound, a PDF, a book, a folder, a draft.
- Notes that an agent or another program writes or changes.

## Terms

- **Body**: a note's text after its frontmatter.
- **Title**: the first block of the body when that block is a heading, of any
  level, read as the card shows it: its characters without the marks of
  formats, links by their text, a line break as a space, white space at its
  ends left out. A note whose body begins with anything else, or whose first
  heading shows no character, has no title.
- **Title line**: an empty heading of level 1 that the editor on a card shows
  as the first line of a note without text.
- **An edit of a note**: the time an editor of BaseHalf holds the note. For
  the editor on a card that is from its opening to its closing. For Card
  Detail it is from the moment Card Detail shows the note to the moment it
  closes or shows another item. An edit that goes on in the other editor, as
  from the card into Card Detail, is one edit.

## Required behavior

### A note without text starts at its title

- The editor on a card shows a note whose body holds no text as one title
  line, with the caret in it. That is so after New Note, for a note made from
  a connection, and for any empty note that is opened on its card later.
- The title line shows a pale `Title` until it holds a character.
- What is typed there is the title: the file gets `# ` and the typed text.
  Enter ends the title and starts a paragraph below it.
- **An empty heading writes nothing.** A heading without a character, the
  title line among them, adds nothing to the file. A note that was opened
  and left without typing is the file it was: an empty note stays empty, and
  a note with only frontmatter keeps only that.
- Backspace or Enter in an empty title line makes it a paragraph, for a note
  that is to begin without a title. The toolbar's text button does the same.

### The file takes the name of the title

When an edit of a note has ended, BaseHalf compares the note's title with
the title it had when the edit began.

- **The title changed and the note has one now:** the file is renamed to the
  [name of the title](#the-name-of-a-title), with the extension it had. When
  that is the name it has, nothing is renamed.
- **The title is as it was**, the note has no title, or the title was taken
  out: nothing is renamed. Changing the rest of a note never renames it.
- **When.** Not while an editor holds the note: the editor on a card keeps
  one file from its opening to its closing. The file is renamed once the
  note has been let go for 180 milliseconds, no editor has taken it up
  again, and no pointer button is down. So the rename never takes the file
  from under what the user does next with the card: opening it in Card
  Detail, deleting it, dragging it. Measured: 207 ms from the press outside
  to the new name.
- **A name typed by hand wins.** When the rename editor is open for the note
  at that moment, as after a double press of F2 right after the title, the
  file gets the name the user types, and the title is not followed for that
  edit.
- It is a rename as the user's own in the rename editor: the card keeps its
  place, its size, and its card information, the entries and mentions that
  named the old path are rewritten
  ([reference graph](reference-graph.md#rename-refactor)), the anchor row of
  a connection follows, and it is one step of the canvas's undo, named as a
  rename.
- **A name that is taken.** When another item of the folder, a draft
  included, has the name, the note takes the title with the next free number
  after it, before the extension: `Anatomy 2.md`, `Anatomy 3.md`, as a moved
  item that keeps both names is numbered
  ([exact undo](exact-undo.md#what-the-canvas-made)). The title stays as
  typed.
- **Agents and other programs.** A note keeps the name it was written with,
  whatever its heading says: `how-they-form.md` with `## How they form` is
  not renamed when it appears, when it is rewritten, or when the user changes
  its text below the title. Its file follows its title from the first time
  the user changes the title in BaseHalf.
- **A rename by name** (the rename editor, the title of Card Detail, Files)
  changes the name only. Title and name agree again the next time the title
  is changed.

### The name of a title

The title's characters, made into a name a file can have on any system:

1. Each of `/ \ : * ? " < > |` and each control character becomes a space.
2. Runs of white space become one space, and white space at the ends is
   left out.
3. Dots at the beginning are left out, so that a title cannot hide a file;
   dots and spaces at the end are left out.
4. The name is cut to 200 bytes of UTF-8 at a character boundary, and dots
   and spaces at its end are left out again.
5. When nothing is left, the note is not renamed.

The file name is that name and the extension the file had, as written:
`Notes.MD` with the title `Plan` becomes `Plan.MD`. A name that the file
system does not take is not given: the note keeps its name.

### A note's card shows no name above it

A note is named by its title, and the title stands in the note. A caption
above the card would say it a second time, or say the file's other name.

- The card of a note whose file is there shows no caption: no glyph and no
  name above it. What the card shows is the note.
- **The buttons of the caption** stand in the card's upper right corner,
  inside the card: the badge button, 24 pixels, 10 from the card's right
  edge and 11 from its top edge, level with a title's line. They look and
  answer as they did in the caption.
- **The first line of the note leaves them room**: it ends 26 pixels before
  the right edge of the note's text, and 44 while the card shows the letter
  of a changed file. The lines below use the whole width.
- **The description of the card** leaves them the same room: on the card's
  badge face, the description field is narrower by 26 pixels, and by 44
  while the card shows the letter of a changed file.
- **The mark of a changed file** ([the changes of a file](changes-of-a-file.md))
  is the letter left of the badge button, in the color of the change, and
  the bar on the card's left edge as on any card. A press on the letter
  opens the changes, as before.
- **The toolbar of a selected or edited note** stands 10 screen pixels above
  the card itself. It stood that far above the caption.
- **A note without a title** is a card of its text. Its file's name is shown
  where BaseHalf names items: in Files, in the title of Card Detail, in the
  path of the title bar, and in the rename editor.
- **Renaming by name.** F2 on a selected note, and Rename in its toolbar and
  menu, open the rename editor. While it is open, the caption stands above
  the card as on any card, with the glyph, the name in the editor, and the
  badge button at its end. When the editor closes, the caption is gone
  again. A note's card has no name to double-click: its title is changed in
  the note.
- **A note whose file is missing** keeps its caption: there is no note to
  show, and its name says what is missing.
- Every other card keeps its caption.

### Undo

- The rename is one step. After New Note and a typed title, the first undo
  on the canvas gives the file its name `untitled.md` back and leaves the
  title in the note, and the second takes the note away
  ([exact undo](exact-undo.md#what-the-canvas-made)).
- Redo renames again.
- Undo in the note's editor undoes the typing. It does not rename.

## Failure

- The file was moved, removed, or is being changed by another operation when
  the edit has ended: nothing is renamed, and nothing is shown.
- The rename fails: the note keeps its name, and the canvas shows its warning
  line with the failure.
- In neither case is the note's text changed.

## Acceptance criteria

1. After New Note, the editor on the new card has the keyboard, its first
   and only block is an empty heading of level 1 that shows `Title` in the
   pale color, and the file holds no text.
2. Typing `Anatomy` and pressing outside the card gives a file `Anatomy.md`
   that holds `# Anatomy`, and no `untitled.md`. The card is at the place
   and has the size it had.
3. A note made from a connection behaves as in 1 and 2. Its file keeps the
   upstream list it was made with, its connection is drawn before and after
   the rename, and the anchor row names the new file with the sides it had.
4. A new note that is left without typing is an empty `untitled.md`.
5. A title, Enter, a line of text, and a press outside give
   `# <title>`, an empty line, and the text.
6. Backspace in the empty title line makes it a paragraph. Text typed then
   and a press outside leave the file named `untitled.md`. The same note
   opened again while it was empty showed the title line again.
7. `how-they-form.md` with the body `## How they form` and a paragraph:
   changing the paragraph on the card and pressing outside renames nothing.
8. Changing that note's heading to `How they form now` and pressing outside
   renames the file to `How they form now.md`, and a note that listed
   `how-they-form.md` as upstream lists `How they form now.md`.
9. With `Anatomy.md` in the folder, a new note titled `Anatomy` becomes
   `Anatomy 2.md`.
10. The title `a/b: c?` gives the file name `a b c.md`. The title `...` or a
    title of spaces renames nothing.
11. After criterion 2, one undo on the canvas gives `untitled.md` with
    `# Anatomy` in it, a second undo takes the note away, and two redos
    give `Anatomy.md` again.
12. While the editor on the card is open, the file keeps its name, also
    after the title was typed and saved.
13. In Card Detail, changing the title of a note and closing Card Detail
    renames the file as in 8.
14. After a title was typed into a new note and while its editor is still
    open, F2 opens the rename editor; a name typed there and Enter give the
    file that name, and it keeps it.
15. The card of a note shows no glyph and no name above it, at rest, while
    selected, and while it is edited. Its badge button stands inside the
    card, 10 pixels from its right edge and 11 from its top edge.
16. F2 on a selected note shows the caption above the card with the name in
    the rename editor, all of it selected, and Escape or Enter takes the
    caption away again.
17. The toolbar of a selected note ends 10 screen pixels above the card's
    top edge.
18. The card of a picture, of a file that is no note, and of a folder shows
    its caption as before.

## Verification

- Unit: `basehalfNoteTitle.test.ts` covers the title of a note and the name
  of a title (criterion 10 and the Terms). The editor's commands test
  (`test.canvasMarkdownInlineCommands.mts`) covers the title line, the empty
  heading that writes nothing, and Backspace and Enter (criteria 1, 5, and 6
  as rules). `basehalfCanvasReactScene.test.ts` covers the place of a note's
  toolbar (criterion 17).
- Smoke, canvas suite: `canvas-note-title-names-file` covers criteria 1, 2,
  4, 7 to 9, 11, 12, 15, and 16 in the real window, and
  `canvas-create-from-connection` covers criterion 3: the note it makes from
  a line is given a title, and the step reads the file, the line, and the
  anchor row before and after the rename. `canvas-exact-undo` walks the two
  undos and the two redos of criterion 11 with the note's row in the
  layout, `canvas-card-badge-preview-connectors` measures the corner of
  criterion 15 on a note of the fixture, and `canvas-inline-rename` holds a
  note's rename editor open while the note is written from outside
  (criterion 16). The other steps of the suite take a note by its face,
  where they took it by its caption.
- Criteria 13, 14, 17, and 18 were measured in a development window on a
  disposable workspace: see below.

### Seen in the real window (2026-11-12)

A development window of 1440 × 900 at 100% zoom, on a fixture folder outside
the repository, driven with the keyboard and the pointer as a user's are.

| What was done | What was seen |
| --- | --- |
| New Note from the Create menu | the editor on the card with the keyboard; one block, an `h1` showing `Title` in `rgb(85, 85, 85)`; `untitled.md` empty |
| `Anatomy` typed, 1.5 s | `untitled.md` held `# Anatomy`, and kept its name |
| A press on empty canvas | `Anatomy.md` 207 ms later; no `untitled.md`; the card at its place; no notification |
| Undo, undo, redo, redo on the canvas | `untitled.md` with `# Anatomy`; the note gone; `untitled.md`; `Anatomy.md` |
| ` And gas.` typed after the paragraph of `how-they-form.md`, a press outside | no rename; the text saved |
| ` now` typed after its heading, a press outside | `How they form now.md` after 207 ms; `stellar-collapse.md` listed `How they form now.md`; both lines still drawn |
| A second new note titled `Anatomy` | `Anatomy 2.md`, holding `# Anatomy` |
| A new note, a press outside | `untitled.md`, empty |
| That note opened again, Backspace, `Plain text, no title.`, a press outside | the title line, then a paragraph; `untitled.md` with the text, not renamed |
| A new note, `Hand` typed, F2 while the editor was open, `by-hand`, Enter | the rename editor with `untitled-1` selected and the keyboard; `by-hand.md` holding `# Hand`, still so 1.5 s later |
| A line pulled out of the lower side of a card and let go on empty canvas, Note, `Neutron star`, a press outside | the title line; `untitled.md` with the upstream list; `Neutron star.md` after 207 ms with the list and `# Neutron star`; 2 lines before and after; the anchor row `south` to `north` named `Neutron star.md` |
| `Anatomy` opened from its editor's Expand button, ` of a black hole` typed at the end of its heading in Card Detail, 2.5 s, Escape | `Anatomy.md` held the new heading while Card Detail was open; `Anatomy of a black hole.md` once it had closed |
| The card of `by-hand.md` at rest, edited, and selected | no glyph and no name; the badge button 10 pixels from the card's right edge and 11 from its top edge, which is 9 and 10 inside the card's border of one pixel; the toolbar's lower edge 10 pixels above the card |
| The badge button of `black-holes.md` pressed, a description typed | the badge face in the card; the description field ended 5 pixels left of the button |
| F2 on the selected card, then Escape | the caption above the card, 300 wide and 24 high, with the editor; then no caption |

## Open questions

- **The rich editor of Card Detail** shows a note without text as an empty
  paragraph. Whether it starts at a title line too is open.
- **A title changed by a rename.** A rename by name leaves the title, so
  name and title can differ until the title is changed again. Whether a
  rename by name should rewrite the title is open.
- **The skill for agents** does not say that a note's first heading is what
  the canvas shows of its name. A note that an agent writes without a
  heading is a card of text.
