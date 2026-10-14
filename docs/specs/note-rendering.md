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
specification applies the rule to the card and to Card Detail.

Card Detail's rich projection showed every block it cannot edit as the text
of the file: a table with `<br>` in a cell appeared as lines of `|` and
`---`, and a paragraph with `<sub>` as its tags.

Card Detail also showed tables in two ways that hid them. Its Preview
projection drew a table without lines and without space between its cells,
so the numbers of two columns ran together. Its rich projection cut a wide
table at the right edge of the text column and showed no sign that the
table could be scrolled.

A long note was not shown at all. A card built every block of its note,
also the blocks below the part it shows, so the cost of a card grew with the
length of its note, and a note above a size limit showed a label instead.
The card now builds a note in parts, as far as it is shown and a little
further, the way a notebook builds only the cells in view.

## Scope

In scope:

- What a Markdown Note card shows at rest.
- What a Markdown Note card shows, while it is edited on the canvas, for the
  blocks that cannot be edited there.
- How a table and an image that are wider than the card are shown on it.
- How Card Detail's Preview projection draws a table, and how its rich
  projection shows that a table is wider than the text column.
- What Card Detail's rich projection shows for a block it cannot edit, and
  which blocks with a line break written as `<br>` it edits.
- How long a note can be and still be shown on its card, and edited there;
  how the card builds a long note in parts; and how much of a text file, a
  code file, or a text result a card reads for its excerpt.

Not in scope, and unchanged:

- Which blocks can be edited on the card. A table, an image, a task list, a
  heading of level 4 to 6, and a block with HTML still open in Card Detail
  for editing.
- Everything else in Card Detail's projections, and how a block that is not
  edited is saved: byte for byte, as before.
- What the excerpt of a text file, a code file, or a folder shows: the first
  lines, as before.
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
- **Part**: a run of whole top-level blocks of a note that the resting
  projection builds at once, about 2,000 characters long.

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
     (`BASEHALF_NOTE_HTML_TAGS`, which a test keeps the same as the base
     renderer's `allowedMarkdownHtmlTags`), for example `<br>`, `<sub>`,
     `<kbd>`, `<details>`, and a table written as HTML.
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
7a. A code block is a box of its own, with a background that sets it apart
   from the text, in the fixed-width font. Its lines are never broken: a
   line of code ends where the author ended it, so that what is lined up in
   the file is lined up on the card.
7b. A table or a code block that does not fit is as wide as the card shows
   and is cut at the right. It scrolls sideways inside its own box: at rest
   by a sideways wheel gesture that begins on it
   ([canvas wheel gestures](canvas-wheel-gestures.md)), and while the card
   is edited as any scroll box does. The note itself is never wider than the
   card.
7c. The side of such a box where content is out of view fades out over 20
   flow pixels. A box that shows all it holds, and a side with nothing
   beyond it, do not fade.
7d. While such a box is scrolled sideways, a bar shows inside its lower
   edge and says how far the box is scrolled. The bar lies over the box: it
   takes no space, and nothing moves when it comes and goes. While the box
   is not scrolled the bar is hidden; it fades out 0.8 s after the last
   movement. It is the same bar at rest and while the card is edited.
7e. The bar has one look: the color and the round ends of the note's own
   scrollbar, 6 flow pixels high. The pointer does not change it. It takes
   no press: a press on it goes to what lies under it, so the card is still
   dragged from there. The system's own scrollbar, which grows and turns
   light under the pointer, is not shown on these boxes.
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
    scrolls sideways inside its own box.
14a. In both projections a table or a code block that is scrolled sideways
    shows the bar of rules 7d and 7e, and not the system's scrollbar.

### A block the rich projection cannot edit

15. Card Detail's rich projection shows a block it cannot edit in its
    rendered form, by the rules 1, 2, 4, and 5 of the card. The elements and
    the text are the same as on the card
    (`baseHalfNoteMarkdownToHtml`, `BASEHALF_NOTE_HTML_TAGS`).
16. The block is not edited in place. Edit in Source is offered on it as
    before and opens the Source projection at its lines.
17. A table in such a block keeps the widths its columns need and scrolls
    sideways in its own box when it is wider than the text column. An image
    is never wider than the text column, and its relative address is read
    from the folder of the note.
18. A comment that BaseHalf wrote itself (`<!-- bh:… -->`) stays hidden. Any
    other HTML comment is shown as text, as on the card.

### Which blocks the rich projection edits

The rich projection edits blocks in its own form and writes an edited block
back as Markdown. Its writer cannot write everything it can read. Measured
in the editor, by reading a block and writing it back:

| The note has | Written back as | What the reader loses |
| --- | --- | --- |
| a table with `a<br>b` in a cell | a row cut in two lines | the table |
| `H<sub>2</sub>O`, `<kbd>`, `<mark>` | `H2O` | the formatting |
| `<img width="40">` | `![](…)` | the size |
| `<details>` with a summary | a list item | the folding |
| a table written as HTML | a pipe table | nothing in a plain table; merged cells in others |
| `<!-- a comment -->` | nothing | the comment |

19. The rich projection edits a block in place unless writing it back would
    lose letters, digits, or line breaks of it. A block that would lose them
    is shown as rules 15 to 18 say, and is not edited there.
20. A line break is kept whichever way it is written. In a table cell the
    rich projection writes it as `<br>`, because a row of a table is one
    line. Everywhere else it writes it as a Markdown line break.
21. So these are edited in place: a table with `<br>` in its cells, and a
    paragraph, a list item, or a quote with `<br>`. A line break that the
    user types into a table cell is saved as `<br>`.
22. These are not edited in place, because the table above shows what they
    would lose: a block with `<sub>`, `<sup>`, `<kbd>`, `<mark>`, or another
    HTML element; an `<img>` element; `<details>`; a table written as HTML; a
    comment; and a heading with `<br>`, whose line break cannot be written
    back.
23. A block that the user does not edit is saved byte for byte, whether it
    is edited in place or not. A block that the user edits is written by the
    editor: `<br/>` becomes `<br>`, and `<br>` outside a table becomes a
    Markdown line break.

### Note size and parts

24. A note of up to 1 MiB (1,048,576 bytes of its file in UTF-8, front
    matter included) is shown on its card by the rules above. That is about
    350,000 Chinese characters (`BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES`).
25. A double click edits a note of up to 64 KiB (65,536 bytes) on its card
    (`BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES`). A double click on a larger
    note opens it in Card Detail.
26. A note above 1 MiB shows only the label "This Markdown file is too large
    for quick edit. Double-click to open the full editor.", and a double
    click opens it in Card Detail. A card shows the whole note or the label:
    every block of a shown note can be reached by scrolling the card.
27. A note that grows above 64 KiB while it is edited on the card stays in
    the card's editor until the editor closes. The card then shows it by
    rule 24, or shows the label when it has grown above 1 MiB.
28. The resting projection builds a note in parts. When the card draws the
    note, it builds the first part at once and, before that frame is shown,
    the next parts down to two heights of the card below the bottom of what
    the card shows. Before a scroll or a taller card would bring the end of
    the built parts within those two heights, it builds the next parts the
    same way. A built part stays until the card draws the note again.
29. A note built in parts shows the same elements in the same order as the
    note built whole. A part ends only between two top-level blocks, and
    never inside an HTML element that one block opens and a later block
    closes, such as `<details>` around paragraphs. Every part is built with
    the definitions of the note's reference links, so a link whose
    definition is in another part works.
30. A part holds fewer than 100,000 characters, because the Markdown
    renderer of the base cuts its text there. An HTML element that is still
    open after 50,000 characters is ended between two blocks anyway (see
    Limits). A note with a block of more than 90,000 characters, or with a
    block that does not fit in a part together with the definitions of the
    note's reference links, shows the label of rule 26.
31. While the card's editor is open, the resting projection under it holds
    every part, so that the note shows the same place and the same sideways
    positions when the editor opens and when it closes. A note that has grown
    above 64 KiB in the editor holds the parts down to the place the editor
    shows: it shows the same place when the editor closes, and its tables
    and code blocks are shown unscrolled.
32. The card of a text file or a code file shows its first lines whatever
    the size of the file. It reads only the first 8 KiB of the file, and
    shows "Binary file" when they hold a NUL byte. A result node reads the
    text of its result the same way. A text result is never reported as
    missing because it is long.

## Limits

- The bar of a table or a code block cannot be dragged. A mouse without a
  sideways wheel scrolls the box with Shift and the wheel.
- A table whose text has no place to wrap, such as a long address, is as
  wide as that text.
- An HTML block that spans a blank line, such as `<details>` around
  paragraphs, is one element at rest and several blocks while the card is
  edited and in Card Detail's rich projection. Its parts are then rendered
  one by one, and the folded text is shown unfolded.
- A block that the rich projection cannot edit has no sign of that until
  the pointer is on it, where Edit in Source appears.
- A code block has no syntax colors on the card.
- An image address that cannot be loaded shows the browser's broken image
  with its alternative text.
- The 64 KiB of rule 25 is set by the time it takes to open the card's
  editor, which builds every block of the note at once. A typed letter does
  not grow with the note: the editor writes back only the block that
  changed. Measured in the real window on 2026-10-14, with a Chinese note
  repeated to each size, on a 120 Hz display: the editor opened in 47 ms for
  1 KiB, 51 ms for 17 KiB, and 124 ms for 64 KiB, and a typed letter
  reached the screen within 9 to 10 ms (95th percentile) at every size.
- The 1 MiB of rule 24 is set by the work the card still does on the whole
  note when it draws it: it reads the file and finds the top-level blocks
  of the whole note before it builds the first part. A note of 1 MiB was
  shown within 77 to 93 ms of opening its folder, with 131 elements, and
  finding its blocks took 26 ms of that (0.9 ms for 17 KiB).
- Parts replaced building every block (2026-10-14). Measured in the real
  window, two rounds each, with a machine under load:
  - a folder of 30 notes opened in 0.25 to 0.32 s at 60 KiB each (1.07 to
    1.10 s before), 0.23 to 0.26 s at 17 KiB (0.40 to 0.63 s), and 0.24 to
    0.28 s at 8 KiB (0.37 to 0.64 s), with 5,554 elements in the window at
    every size (48,604, 14,254, and 9,934 before). The longest frame of a
    zoom was 24 ms (125 ms before), and panning had no frame above 20 ms;
  - scrolling a note of 1 MiB at 6,000 px a second built the parts ahead
    with no frame above 20 ms. Scrolling through all of it in 7 s, at
    70,000 px a second, kept 95 % of frames within 12.2 ms and left 7 to
    11 of 1,070 frames above 20 ms, the longest 30 ms.
  Before parts, 0.8 s of the 1.1 s for 60 KiB went to the style and layout
  of blocks that no card showed. Before that day the limit of a shown note
  was 8 KiB, left from a time when a card showed the first 8 KiB of a note
  as a summary; it sent an ordinary article of 3,000 Chinese characters to
  Card Detail.
- A card holds the parts it has built. After the whole note has been
  scrolled through, the card holds the whole note until it draws the note
  again.
- A screen reader reads the built parts of a note at rest.
- An HTML element that is still open after 50,000 characters (rule 30) is
  shown as the card's editor shows such an element: its blocks one by one.

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
7a. A code block with a line longer than the card shows that line unbroken:
   the block holds more than it shows from left to right, and it is as high
   as its number of lines. It has a background of its own. It has the same
   width and height at rest and while the card is edited.
7b. A table that is wider than the card and has not been scrolled shows no
   bar. During a sideways scroll on it, at rest and while the card is
   edited, the bar is shown inside the lower edge of the table, and its
   length is to the shown width of the table as that width is to the full
   width. A second after the scroll the bar is not shown. The table has the
   same height with the bar and without it.

8. In Card Detail's Preview projection, a cell of a table has a border and
   padding on every side.
9. In Card Detail's rich projection, a table of eight columns in a text
   column 712 px wide shows no bar until it is scrolled. A sideways scroll
   on it shows the bar inside the lower edge of the table, and a second
   later the bar is not shown. The box of the table has the same height
   before, during, and after.

10. In Card Detail's rich projection, a table with `a<br>b` in a cell is a
    `table` element with two lines in that cell, `H<sub>2</sub>O` shows a
    `sub` element, and the text of the editor contains none of `<br>`,
    `<sub>`, `|---|`.
11. Edit in Source on such a block opens the Source projection with the
    lines of the block selected.

12. In Card Detail's rich projection, a table with `a<br>b` in a cell is a
    table that can be edited. After a letter is typed into another cell and
    the note is saved, the file holds every row of the table on one line,
    with `a<br>b` in that cell.
13. A paragraph `one<br>two` can be edited there. `H<sub>2</sub>O` and
    `# a<br>b` cannot.
14. A note with such a table that is opened and not edited keeps every byte.

15. A note of 65,536 bytes opens in the card's editor on a double click. A
    note of 65,537 bytes is shown on its card and opens in Card Detail on a
    double click. A note of 1,048,576 bytes is shown on its card; a note of
    1,048,577 bytes shows the label of rule 26. A note of Chinese text is
    measured in the bytes of its UTF-8, not in characters.
16. In the real window, a note of about 64 KiB opens in the card's editor
    within 300 ms of the double click, and a letter typed into it is drawn
    within one frame of 60 Hz on the machine of the measurement.
17. A text file of 100 KiB shows its first lines on its card, not "Preview
    unavailable".
18. For every note of the test corpus, building it in parts of a few
    hundred characters gives the same elements as building it whole. The
    corpus holds a reference link whose definition is in another part,
    `<details>` around paragraphs, a list with blank lines between its
    items, a code block with blank lines, and a table.
19. In the real window, a note of 1 MiB on a card of 300 by 220 holds fewer
    than 400 elements after it is drawn. Scrolling it with the wheel from
    its top shows every block in order and ends with its last block, and the
    scroll never stops before that block.
20. In the real window, a folder of 30 notes of 60 KiB opens within 0.6 s,
    with fewer than 10,000 elements in the window.
21. A long note scrolled down past its first parts and then edited on its
    card shows the same blocks at the same place before the editor opens,
    while it is open, and after it closes.

## Verification

- Unit: `basehalfCanvasMarkdownInlineEditor.test.ts` covers criteria 1 to 5.
- Smoke: `canvas-note-renders-markdown` covers criteria 1, 2 (heading and
  boxes), 3 (`<br>`), 6, 7, 7a, and 7b in the real window. Unit:
  `basehalfSidewaysScrollbar.test.ts` covers where the bar stands and when
  it is shown.
- Criteria 8 and 9 are measured in the real window by hand. They are style
  rules, and no test covers them.
- Unit: `a note shows the same elements wherever it is rendered` covers the
  claim of rule 15 that the card and the rich projection agree.
- Unit: `basehalfMarkdownProjection.test.ts` covers criterion 13 and the
  writing of a line break in a table cell. Criterion 12 is measured in the
  real window. The fidelity corpus (`npm run basehalf:fidelity`) covers
  criterion 14.
- Smoke: `readme-rich-passthrough-edit-in-source` covers criterion 11 and,
  for the HTML block of its note, that the block is shown rendered.
  Criterion 10 is measured in the real window.
- Unit: `basehalfCanvasPreview.test.ts` covers the byte boundaries of
  criterion 15 and the parts of rules 29 and 30.
  `basehalfCanvasNoteParts.test.ts` covers criterion 18 and the building of
  rule 28 in a window of the unit test runner. Criteria 15 to 17 and 19 to
  21 are measured in the real window on a fixture workspace. Smoke:
  `canvas-note-wheel-scroll` draws a note of two parts, checks that only the
  first is built, and scrolls it to its last paragraph; it also keeps the
  place of the note when the note is redrawn and when its editor opens and
  closes.
