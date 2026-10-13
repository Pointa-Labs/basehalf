# Note rendering

Status: Active (2026-10-13)
Decision: [D54](../decisions.md#d54--a-note-is-shown-rendered-wherever-it-is-read-new-2026-10-13)
Related: [canvas wheel gestures](canvas-wheel-gestures.md) (scrolling a Note
at rest), [canvas card resize](canvas-card-resize.md),
[architecture invariants](../harness/architecture-invariants.md)

## Problem

A Markdown note is shown in several places: on its card at rest, on its card
while the user edits it there, and in Card Detail. The user reads the note in
all of them and expects the same note.

The card did not show the same note. It rendered sixteen HTML elements and
printed every other element as text. A table written as

```markdown
| time  | close    |
|-------|----------|
| 11:00 | 24,747.3 |
```

appeared on the card as `<table> <thead> <tr> <th>time</th> …`. The same
happened to headings of level 4 to 6, task list boxes, and images. The user
of BaseHalf does not read code, so a card full of tags is an unreadable card.

The rule is that a place where a note is read shows the note rendered, and
the characters of the file are for Card Detail's Source projection. This
specification applies the rule to the card, and to tables in Card Detail.

Card Detail showed tables in two ways that hid them. Its Preview projection
drew a table without lines and without space between its cells, so the
numbers of two columns ran together. Its rich projection cut a wide table
at the right edge of the text column and showed no sign that the table
could be scrolled.

## Scope

In scope:

- What a Markdown Note card shows at rest.
- What a Markdown Note card shows, while it is edited on the canvas, for the
  blocks that cannot be edited there.
- How a table and an image that are wider than the card are shown on it.
- How Card Detail's Preview projection draws a table, and how its rich
  projection shows that a table is wider than the text column.

Not in scope, and unchanged:

- Which blocks can be edited on the card. A table, an image, a task list, a
  heading of level 4 to 6, and a block with HTML still open in Card Detail
  for editing.
- Everything else in Card Detail's projections, and which blocks its rich
  projection can edit.
- The 8 KiB limit above which a card shows a label instead of the note.
- Previews of text files, code files, and folders.
- Front matter. It is not part of the shown note.

## Terms

- **Rendered form**: what a Markdown renderer makes of the note: a table as
  a grid, an image as a picture, a heading as a heading, a task as a box
  with its text.
- **Markup**: the characters that produce the rendered form and are not part
  of what the author says, for example `|---|`, `<td>`, `<br>`, `####`.
- **Resting projection**: the element that shows a Note card's note while
  the note is not being edited (`.bh-md-preview`).
- **Fixed block**: a top-level block of a note that the card's editor cannot
  edit. It stays in its rendered form while the blocks around it are edited.

## Required behavior

### What is rendered

1. The resting projection shows the rendered form of the whole body of the
   note. It shows, each in its rendered form:
   - headings of level 1 to 6;
   - paragraphs, line breaks, bold, italic, strikethrough, inline code;
   - links and images;
   - bullet lists, numbered lists, nested lists, and task lists;
   - quotes, code blocks, and rules;
   - tables, with the alignment of their columns and the formatting inside
     their cells;
   - the HTML elements that Card Detail's Preview projection renders
     (`allowedMarkdownHtmlTags`), for example `<br>`, `<sub>`, `<kbd>`,
     `<details>`, and a table written as HTML.
2. No markup of a construct in rule 1 is shown as text.
3. A fixed block of a card being edited shows the same rendered form as the
   resting projection. Both come from one function
   (`renderBaseHalfCanvasStoredMarkdown`).
4. The rendered form adds no character to the note and removes none. Text
   that is not a construct is shown as the author wrote it, letter for
   letter: an HTML element outside rule 1 (`<script>`, `<iframe>`, the
   `<String>` of `List<String>`), an HTML block that contains such an
   element, an HTML comment, and Markdown that is not closed (`**bold`).
   Such an element never becomes a live element.
5. Rendering does not run code and does not follow a command link. The note
   is untrusted content. An `<input>` is shown only as a check box, and the
   box is disabled.
6. An image address that is relative is read from the folder of the note.

### How the rendered form is laid out on the card

7. A table keeps its words and numbers whole. Its columns narrow, and the
   text of their cells wraps between words, until the table fits the card.
   A column is never narrower than two letters of its text size.
7a. A table that still does not fit is as wide as the card shows and is cut
   at the right. It scrolls sideways inside its own box: at rest by a
   sideways wheel gesture that begins on it
   ([canvas wheel gestures](canvas-wheel-gestures.md)), and while the card
   is edited as any scroll box does. The note itself is never wider than the
   card.
7b. The side of such a table where columns are out of view fades out over 20
   flow pixels. A table that fits, and a side with nothing beyond it, do not
   fade.
8. An image is never wider than the card. It keeps its proportions.
9. A task list item shows its box in place of the list bullet.
10. Headings of level 4 to 6 are bold and not smaller than body text.
11. The resting projection keeps what it had before: a press anywhere on
    it drags the card, also on a task box, and a wheel gesture scrolls it as
    [canvas wheel gestures](canvas-wheel-gestures.md) requires.
12. A fixed block has the same size and the same line breaks while the card
    is edited as it has at rest.

### Tables in Card Detail

13. In the Preview projection a table has a line around every cell and
    space inside it. The table keeps the widths its columns need. When it is
    wider than the text column, it scrolls sideways inside its own box, and
    the page does not scroll sideways.
14. In the rich projection a table that is wider than the text column
    scrolls sideways inside its own box. The box shows its scrollbar for as
    long as the table is wider than the box, also while it is not being
    scrolled.

## Limits

- A table at rest has no scrollbar: a bar would take the press that drags
  the card. A mouse without a sideways wheel scrolls it with Shift and the
  wheel.
- A table whose text has no place to wrap, such as a long address, is as
  wide as that text.
- An HTML block that spans a blank line, such as `<details>` around
  paragraphs, is one element at rest and several blocks while the card is
  edited. Its parts are then rendered one by one, and the folded text is
  shown unfolded.
- Card Detail's rich projection shows a block it cannot edit as the text of
  the file, with Edit in Source. A table with `<br>` in a cell and a
  paragraph with HTML are such blocks. On the card the same blocks are
  rendered. This difference remains.
- A code block has no syntax colors on the card.
- An image address that cannot be loaded shows the browser's broken image
  with its alternative text.

## Failure and recovery

Rendering has no state to recover. A note whose Markdown is wrong renders as
far as Markdown defines it, and the rest is shown as text (rule 4).

## Acceptance criteria

1. A note with a pipe table shows, on its card at rest, a `table` element
   with the header and rows of the source, and the text of the card contains
   no `<table>`, `<tr>`, `<th>`, or `<td>`.
2. On the same card: `####` to `######` show as `h4` to `h6`; `- [ ]` and
   `- [x]` show as disabled boxes, the second one checked; `![a](p.png)`
   shows as an `img` whose address is in the note's folder.
3. `a<br>b` inside a table cell shows as two lines in one cell, and
   `H<sub>2</sub>O` shows a `sub` element.
4. `<script>alert(1)</script>` and `<iframe src="x">` show as that text. The
   card contains no `script` and no `iframe` element.
5. `[x](command:workbench.action.quit)` runs nothing when clicked.
6. With a table of eight columns on a card 300 px wide, the resting
   projection is not wider than it shows (`scrollWidth` equals
   `clientWidth`), no cell breaks a word or a number, and the table holds
   more than it shows. Its right side fades and its left side does not.
   A table of two short columns on the same card does not fade.
7. While a paragraph of the card is edited, a table in the same note is
   still a `table` element of the same width and height.

8. In Card Detail's Preview projection, a cell of a table has a border and
   padding on every side.
9. In Card Detail's rich projection, the box of a table of eight columns in
   a text column 712 px wide is 10 px higher than its content: the height of
   its scrollbar. The box of a table that fits has no such height.

## Verification

- Unit: `basehalfCanvasMarkdownInlineEditor.test.ts` covers criteria 1 to 5.
- Smoke: `canvas-note-renders-markdown` covers criteria 1, 2 (heading and
  boxes), 3 (`<br>`), 6, and 7 in the real window.
- Criteria 8 and 9 are measured in the real window by hand. They are style
  rules, and no test covers them.
