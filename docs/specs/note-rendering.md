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
specification applies the rule to the card.

## Scope

In scope:

- What a Markdown Note card shows at rest.
- What a Markdown Note card shows, while it is edited on the canvas, for the
  blocks that cannot be edited there.
- How a table and an image that are wider than the card are shown on it.

Not in scope, and unchanged:

- Which blocks can be edited on the card. A table, an image, a task list, a
  heading of level 4 to 6, and a block with HTML still open in Card Detail
  for editing.
- Card Detail's projections. In the rich projection a table that is wider
  than the text column already scrolls sideways inside its own box.
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

7. A table is never wider than the card. Its columns share the width of the
   card, and the text of a cell wraps inside the cell. No column is cut off
   at the right edge.
8. An image is never wider than the card. It keeps its proportions.
9. A task list item shows its box in place of the list bullet.
10. Headings of level 4 to 6 are bold and not smaller than body text.
11. The resting projection keeps what it had before: a press anywhere on
    it drags the card, also on a task box, and a wheel gesture scrolls it as
    [canvas wheel gestures](canvas-wheel-gestures.md) requires.
12. A fixed block has the same size and the same line breaks while the card
    is edited as it has at rest.

## Limits

- A table with many columns on a narrow card has narrow columns, and words
  break inside them: eight columns on a card 300 px wide leave about three
  letters to a line. The user widens the card or opens Card Detail. The card
  does not scroll a table sideways, because the resting projection has one
  scroll direction and the canvas owns the other.
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
6. A table of eight columns on a card 300 px wide is not wider than the
   resting projection (`scrollWidth` equals `clientWidth`).
7. While a paragraph of the card is edited, a table in the same note is
   still a `table` element of the same width and height.

## Verification

- Unit: `basehalfCanvasMarkdownInlineEditor.test.ts` covers criteria 1 to 5.
- Smoke: `canvas-note-renders-markdown` covers criteria 1, 2 (heading and
  boxes), 3 (`<br>`), 6, and 7 in the real window.
