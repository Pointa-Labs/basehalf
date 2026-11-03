# The menu of blocks in a note

Status: Active (2026-11-04)
Decision: [D117](../decisions.md#d117--the-menu-of-blocks-in-a-note-is-short-enough-to-read-and-a-line-its-add-button-made-is-there-only-once-it-holds-something-new-2026-11-04)
Related: [formats of a note](note-formats.md) (rule 5: the blocks it offers;
rule 49: what Image, Video, Audio, and File do), [zoom and outline of a
note](note-zoom-and-outline.md) (where the handles stand under a zoom),
[exact undo](exact-undo.md#undo-in-an-editor-of-text) (undo in an editor of
text), [files in notes](files-in-notes.md) (where a chosen file is kept)

## The rule

**The add button beside a line and `/` open one short list of what a note can
hold. The note does not change until the user chooses from it: a line the add
button made is there only once it holds something, and adding a block is one
step of undo.**

## Problem

The menu was the editor library's own, with BaseHalf's items swapped in behind
it. Measured on 2026-11-04 in an isolated window of the integration branch at
`3b4d39c03`, a note of 1130 × 795 points at 100%:

- **It was too tall to read.** 23 rows of 49 px, each with a second line, and 6
  group names made a list of 1,286 px. The window showed 9 to 14 rows of it,
  in 488 to 732 px of the note's 795.
- **Its order was the library's.** Paragraph was the ninth row. Headings 4 to 6
  came after Media, under "Subheadings" with the toggle headings. Table stood
  alone under "Advanced", Emoji alone under "Others". In Chinese, Quote stood
  under 基本块, the lists under 基础, and Divider under 基础区块.
- **Its second lines and its keys said little.** "Quote or excerpt" under Quote,
  and `⌘-ALT-1` in a capsule that lost its background on the current row. The
  toggle headings had the same icons as the headings.
- **It wore no theme.** The editor sets its theme on its own root, and the
  menus are drawn on another element. So they showed the library's dark colors,
  not BaseHalf's: the menu `#1f1f1f`, the current row darker than the menu, and
  a border darker than the note, so the menu's edge dissolved into the note.
  The `[[` list was drawn inside the root, and looked different.
- **The pointer made two highlights.** The row the keys stood on and the row
  under the pointer were lit together, and Enter chose the first.
- **It opened over what the user had just read.** It took the side with more
  room, so any line in the lower half of the note opened it upward, also for a
  list of one row. Its width went from 323 to 298 to 132 px as letters narrowed
  the list.
- **Escape did not close it.** The editor marks every Escape as used, and a key
  the editor used stops at the page's root (note formats, rule 69), so the list's
  own listener on the document never heard the key. The same held for the lists
  of `[[` and `:`. A step of the smoke pressed Escape and never looked.
- **The add button left things behind.** A click elsewhere left an empty line,
  which the file does not keep, so what Rich showed and what the file held
  differed. An add and a choice took two undos, the first leaving the empty line.
  Beside a list item with children or an open toggle, the new line went below
  all the children, away from the button. Emoji followed by Escape left a `:`.
  Beside an empty code block the button did nothing, and a 1 px ring around its
  icon took no click.
- **`/` opened where it could do nothing good.** In a table cell it opened the
  menu, whose rows add a block after the table. Enter with nothing found did
  nothing until three more letters closed the list.

## Goals

- All that a note can hold is found by eye or by one or two letters.
- The menu looks like BaseHalf's other menus.
- Opening the menu and leaving it costs nothing: not a line, not an undo step.
- The list stays on one side of the line and keeps its width while it is open.

## Non-goals

- A list of recent or suggested blocks: it would keep state that the note's
  file does not hold, for the two letters it saves.
- New kinds of block. The menu offers what [formats of a
  note](note-formats.md) lists, and it opens one existing list more.
- The menu's look on a card. The card's editor has no add button and no `/`.

## Terms

- **The menu**: the list that the add button and `/` open.
- **The add button**: the `+` of the handles beside a block.
- **The new line**: the empty paragraph that the add button makes.
- **The current row**: the one row lit in the menu, which Enter chooses.

## Required behavior

### What the menu holds

1. One list serves the add button and `/`, in this order:

   | Group | Rows | What typed at the start of a line makes it |
   | --- | --- | --- |
   | Basic | Paragraph | |
   | | Heading 1, 2, 3 | `#`, `##`, `###` |
   | | Bullet List | `-` |
   | | Numbered List | `1.` |
   | | Check List | `[ ]` |
   | | Toggle List | |
   | | Quote | `>` |
   | | Code Block | ` ``` ` |
   | | Table | |
   | | Divider | `---` |
   | Media and Files | Image, Video, Audio, File | |
   | | Link to File | `[[` |
   | More | Toggle Heading 1, 2, 3 | |
   | | Heading 4, 5, 6 | `####`, `#####`, `######` |
   | | Emoji | `:` |

2. The right column of that table is what the row shows at its right end. Each
   of those forms works as shown: a form followed by a space where the table
   shows Markdown, `---` as it is typed, and `[[` and `:` as the start of their
   own lists. No row names a key combination; the combinations still work.
3. Group names follow the language of the window. Each row's title is the
   editor's own in that language, and Link to File is BaseHalf's.

### How it looks

4. The menu is drawn as BaseHalf's other menus are: `menu.background`,
   `menu.foreground`, a 1 px `menu.border`, 12 px corners, 6 px inside its edge,
   and the shadow `0 8px 24px rgb(0 0 0 / 36%)`.
5. It is 280 px wide whatever it lists, and no taller than 428 px or the room in
   the view: all of the first group, the name of the next, and half of its first
   row, which shows that the list goes on. A longer list scrolls inside it.
6. A row is one line, 30 px tall: its icon at 16 px, its title at 13 px, and its
   form at the right end in the editor's monospaced font at 11 px. A row has no
   second line. Its icons are of one drawing style, and each toggle heading
   differs from its heading by a small triangle.
7. A group name is 11 px in `descriptionForeground`.
8. Every menu, list, toolbar, and panel of Rich takes BaseHalf's theme, the same
   colors the editor's root has, whichever element it is drawn on.
9. The menu shows at once when opened and goes at once when closed.

### The current row

10. One row is lit, in `menu.selectionBackground` and
    `menu.selectionForeground`. The menu opens with its first row lit.
11. Up and Down move the current row and wrap around, and it stays in view, with
    its group's name when it is the first of its group. PageUp and PageDown go to
    the first and the last row.
12. Moving the pointer over a row makes it current. A row that comes under a
    pointer at rest, as the list scrolls or opens, does not. Enter and a click
    choose the row; the pointer's row and Enter's row are never two rows.
13. Keys do not move the current row while an input method composes.

### Letters

14. Letters typed after the add button or `/` go into the line and narrow the
    list. The list matches each row's title and words for it, in English and in
    Chinese whatever the window's language.
15. While letters narrow it, the list has no group names, and its rows rank:
    first a title that starts with the letters, then a word for the row that is
    the letters exactly, then a word of the title that starts with them, then a
    word for the row that starts with them, then any title or word that holds
    them. Rows of one rank keep the list's order.
16. With nothing found the menu says so at the same width. Enter and the arrow
    keys then close it and do what they do in the note. Letters typed more than
    three past the last that found something close it too.

### Where it opens

17. It opens under the line, 4 px from it, when 240 px or more of room is there
    or when there is more room there than above; otherwise over the line, 4 px
    from it. It stays on that side until it closes.
18. Its left edge is that of the new line, or of the `/` that opened it, and it
    stays 8 px inside the view.
19. It follows the line as the note scrolls or zooms. A line scrolled out of the
    view leaves it at the view's edge, at least four rows tall. It is not magnified
    with the note ([zoom and outline of a note](note-zoom-and-outline.md)).

### The add button

20. The whole button takes the click.
21. The new line goes directly under the line the button stands beside: as the
    first child of a block whose children show (a list item with children, an
    open toggle), and otherwise after the block and any children it hides. The
    caret goes into it and the menu opens under it.
22. Beside an empty block that the menu can act in, the button makes no line: the
    caret goes into that block and the menu opens there. A code block is never
    such a block, as `/` does not work in code.
23. While the menu is open on an empty line, that line says "Type to filter" in
    place of its usual words.
24. While the menu is open the handles do not show. While the menu of the drag
    handle is open the add button does not show, as that menu opens over it.

### Leaving the menu

25. Escape closes the open list, of the menu, of `[[`, or of `:`, and does nothing
    else: Card Detail stays open, and the keyboard stays in the note. A press
    anywhere but on the list closes it too. **A line that stays empty was never
    there.** When the menu closes and the new line still holds nothing, by Escape,
    a click elsewhere, or the window losing the focus, the line goes. The note's
    blocks, its file, and undo and redo are as they were before the click on the
    button. After Escape the caret is back where it was.
26. A click elsewhere lands where the user aimed: the line goes only after the
    press has ended, so that nothing under the pointer moves during the press.
27. A click into the new line keeps it. It is an ordinary empty line from then on.
28. A new line that letters were typed into stays with them, also after Escape.
29. Backspace in the new line, and undo while the menu is open, end the same way:
    the note and its undo and redo are as they were before the click.

### Choosing

30. A row chosen from the add button's menu makes its block where the new line
    was, and that is one step of undo, however long the menu was open and
    whatever was typed in it. One undo gives back the note as it was before the
    click on the button, byte for byte.
31. Letters typed to narrow the list are not kept when a row is chosen.
32. Image, Video, Audio, and File open the system's file chooser at once ([note
    formats](note-formats.md), rule 49). The new line waits under the chooser.
    Cancel ends it as rule 25 does. Chosen files take its place, in one step of
    undo with the line. If none can be kept, the words that say so show there for
    3 s, and then the line goes as in rule 25.
33. Emoji and Link to File open their own lists on the same line, and put nothing
    into the note until something is chosen from them. Leaving such a list with
    nothing typed ends the line as rule 25 does.

### `/`

34. `/` opens the menu where the caret is, except in a table cell and in a code
    block.
35. A `/` the user typed stays, with what followed it, when the menu is left. It
    goes when a row is chosen, as the letters do.

### The lists of `[[` and `:`

36. The list of `[[` is drawn as the menu is, 360 px wide. A row is a file's name
    and, after it in `descriptionForeground`, the rest of its path, cut off at the
    end of the row. Rules 10 to 13 and 16 to 19 hold.
37. The list of `:` is drawn on the same surface, with eight columns, and rules 17
    to 19 hold.

## Failure and recovery

| Case | What happens |
| --- | --- |
| An outside write changes the note while the new line waits | The new line is treated as any block of the note. When it goes, undo and redo stay as they are, because the note is no longer what it was before the click |
| The block the new line was to follow is gone when a file comes | The block goes at the end of the note |
| The file chooser fails to open or never answers | The new line stays until the note is left; it is empty, so the file does not hold it |
| A letter is typed into the new line while a chosen file is copied | The line stays with the letter and the file's block follows it |

## Acceptance criteria

1. In a window of 1130 × 795 points, the add button's menu shows all of the group
   Basic at once, 12 rows, and the name of the next group, in no more than 428 px.
2. It is 280 px wide with every query, and a row is 30 px tall and one line.
3. Its background, border, and current row are the theme's.
4. Escape closes the menu with Card Detail still open. The note's blocks are then
   those of before, undo and redo answer as before, and a pending redo still
   works; the file's bytes and time have not changed.
5. Add + Heading 2, one undo: the note's blocks and file are as before, typed
   filter letters or not, and also after 3 s with the menu open.
6. Beside a list item with children, and beside an open toggle, the new line is
   their first child; beside a closed toggle it follows the toggle.
7. A click elsewhere on a line below the new line puts the caret on the line
   aimed at.
8. Moving the pointer over a row, then Enter, chooses that row, with exactly one
   lit row at every moment.
9. Filtering "he" gives Heading 1 as the first row, and no group name shows.
10. A `/` in a table cell opens no menu.
11. With a line in the lower half of the view and 240 px below it, the menu opens
    below; a line 100 px from the bottom opens it above; typing does not move it
    to the other side.
12. Each form of rule 1 typed into an empty line makes its block or opens its list.
13. At 200% and 50% the menu's top is 4 px from the drawn line, and its text stays
    13 px.
14. Image from the add button, Cancel: the note and undo are as before. A chosen
    file: its block is where the line was, and one undo takes it away, with no
    line left.
15. Emoji from the add button, Escape: no `:` and no line remain.

## Verification

The pure parts, which rows there are, how they rank, and which side the menu
opens on, have unit tests in
`src/vs/workbench/basehalf/markdown/test/common/basehalfNoteBlockMenu.test.ts`.
The rest runs with real keys and pointer events in part `s` of Rich's bundle test
(`extensions/basehalf/test/markdownRichFormats.entry.ts`), on Rich's own schema,
undo, and menu; criteria 2, 4 to 6, 8, 9, 10, 12, and 15. The real window's steps
`note-block-menu-*` of the Card Detail suite cover criteria 1, 3, 4, 5, 7, 11, 13,
and 14 and what the bundle test cannot see: the theme, the file on the disk, the
system's chooser, and that Escape reaches a list at all.
