# Note rendering

Status: Active (2026-10-13; the sound element, colors, toggles, links, and
which blocks Rich edits, 2026-11-02; a code file's card, 2026-11-04 for D118;
the encoding a card reads its file in, 2026-11-21 for D138; the typography of
a note and the form it opens in, 2026-11-21 for D145)
Decision: [D54](../decisions.md#d54--a-note-is-shown-rendered-wherever-it-is-read-new-2026-10-13);
what Rich writes and reads back, [D110](../decisions.md#d110--what-rich-shows-of-a-note-is-what-its-file-keeps-and-rich-offers-nothing-the-file-cannot-keep-new-2026-11-02);
the typography of a note, its three settings, and the form it opens in,
[D145](../decisions.md#d145--a-note-has-one-typography-which-follows-its-font-and-its-text-size-and-opens-in-the-form-the-user-chose-new-2026-11-21)
Related: [formats of a note](note-formats.md) (what Rich writes and reads
back, and which blocks it edits), [canvas wheel gestures](canvas-wheel-gestures.md)
(scrolling a Note at rest), [canvas card resize](canvas-card-resize.md),
[zoom and outline of a note](note-zoom-and-outline.md) (the magnifying of a
page, which lies on top of the text size), [BaseHalf's Settings](settings-pages.md#notes)
(the rows of the three settings),
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

The same note did not look the same either. Measured in the real window on
2026-11-21, with a note of headings, lists, a table, code, and Chinese text:

| | Rich | Preview | The card |
| --- | --- | --- | --- |
| Font | the window's | the window's | a list of its own |
| Text | 16 px | 14 px | 13 px |
| Line height | 1.5 | 1.65 | 1.45 |
| Width of the text, at most | 712 px | 760 px | the card's |
| Room beside the text, at least | 85 px | 28 px | |
| Heading 1, 2, 3 | 48, 32, 20.8 px | 28, 21, 16.4 px | 18, 16, 14 px |
| Heading 4, 5, 6 | 16, 14.4, 12.8 px | 14, 11.6, 9.4 px | 13 px |
| Between two paragraphs | 6 px | 14 px | 6 px |
| Code | the browser's fixed font | the window's fixed font | the window's fixed font |

A paragraph that was four lines in Rich was three in Preview, and a heading
of level 6 was smaller than the text under it in both. None of it could be
chosen, and a note opened in Rich whatever its reader meant to do with it.

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
- How a click on a link opens its target from the card and from Preview.
- How long a note can be and still be shown on its card, and edited there;
  how the card builds a long note in parts; and how much of a text file, a
  code file, or a text result a card reads for its excerpt.
- The typography of a note: its font, the size of its text, its line height,
  the width of its text, and the sizes of its headings, in Rich, in Preview,
  and on its card; and how the settings `basehalf.notes.fontFamily` and
  `basehalf.notes.fontSize` are followed.
- The form of Card Detail a note opens in, and the setting
  `basehalf.notes.openIn`.

Not in scope, and unchanged:

- Which blocks can be edited on the card. A table, an image, a task list, a
  heading of level 4 to 6, a toggle, and a block with HTML other than
  underline and palette colors still open in Card Detail for editing
  ([formats of a note](note-formats.md#the-card-preview-and-the-cards-editor)).
- Everything else in Card Detail's projections, and how a block that is not
  edited is saved: byte for byte, as before.
- What the excerpt of a text file or a folder shows: the first lines, as
  before. What a code file shows is rule 33 (D118).
- Front matter. It is not part of the shown note.
- The Source projection, the editor of code, which follows `editor.*`
  ([a code file on its card and in Card Detail](code-cards.md)).
- The magnifying of a note's page with a pinch and the outline of its
  headings ([zoom and outline of a note](note-zoom-and-outline.md)). A pinch
  draws the page larger, whatever the size of its text.
- The menus and toolbars of Rich, which are in the font and the size of the
  window ([the menu of blocks in a note](note-block-menu.md)).

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
- **Text size**: the size of the text of a paragraph of a note, in pixels at
  a zoom of 100%. Every other size of a note is a multiple of it.
- **Form**: Rich, Preview, or Source, the projections of Card Detail that a
  note has.

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
     (`BASEHALF_NOTE_HTML_TAGS`, which a test keeps the base renderer's
     `allowedMarkdownHtmlTags` and `audio`), for example `<br>`, `<sub>`,
     `<kbd>`, `<u>`, `<details>`, `<figure>`, `<video>`, `<audio>`, and a
     table written as HTML.
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
4a. An element of rule 1 keeps what the formats of a note need and nothing
   that runs. A `<span>` keeps a text and a background color written as
   `color:#rrggbb;background-color:#rrggbb;`, and any other `style` is not
   drawn. A `<details>` with `open` shows open. A `<video>` and an `<audio>`
   keep `src`, `width`, and `controls`, and play in BaseHalf's own player
   ([formats of a note](note-formats.md#pictures-videos-and-sounds), rule 52).
   A paragraph that is one link to a file shows as a file block, the file's
   icon and its name ([formats of a note](note-formats.md), rule 81). A link
   and a picture show no system tooltip: their `title` is dropped when they
   are drawn.
4b. **A note drawn again keeps its players.** Preview draws a note again at
   every change of it, the card's editor after a change made elsewhere, and
   the card at rest when its file changes. A video or a sound whose block is
   still in the note keeps its player through that: one that plays goes on
   playing, at the same place and with its sound as it was, and one that
   stands shows the same frame, so that no frame shows it without its
   picture. The player of a block that has left the note goes. When a note
   holds the same video more than once, the players keep their order.
5. Rendering does not run code and does not follow a command link. The note
   is untrusted content. An `<input>` is shown only as a check box, and the
   box is disabled.
6. An address that is relative, of an image, a video, a sound, or a link, is
   decoded once and read from the folder of the note; a link into the store
   of a note's files reads the file there ([files in notes](files-in-notes.md),
   rule 20).
6a. A Markdown image whose address ends in a sound or a video extension of
   the one list of media files is that sound or that video:
   `![clip](clip.mp4)` is a video and `![s](s.ogg)` a sound
   ([formats of a note](note-formats.md#reading-a-note)).
6b. A click on a link opens its target, its address read once: a note or a
   file of the workspace in Card Detail, a web address in the browser, a
   heading in its note ([formats of a note](note-formats.md#links)). A link
   that leads nowhere does nothing, and nothing asks.
6c. Rich's page reads a relative address from the note's folder wherever it
   meets one: also in the elements its editor makes for itself, as when it
   reads a note, draws a picture before it has read the picture's address,
   or copies blocks. It never asks for a file at the page's own address, and
   nothing it asks for is refused.

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
    it drags the card, also on a task box, a file block, and the picture of
    a video, and only the bar of a player takes presses; a wheel gesture
    scrolls it as [canvas wheel gestures](canvas-wheel-gestures.md) requires.
12. A fixed block has the same size and the same line breaks while the card
    is edited as it has at rest.

### Tables in Card Detail

13. In the Preview projection a table has a line around every cell and
    space inside it. The table keeps the widths its columns need. When it is
    wider than the text column, it scrolls sideways inside its own box, and
    the page does not scroll sideways.
14. In the rich projection a table keeps its words and numbers whole, as
    on the card (rule 7): a column grows to its longest word, at every text
    size, and a table that is wider than the text column scrolls sideways
    inside its own box.
14a. In both projections a table or a code block that is scrolled sideways
    shows the bar of rules 7d and 7e, and not the system's scrollbar.
14b. In both projections a code block is a box of its own with a background
    that sets it apart from the text, as on the card (rule 7a). Its lines
    keep their indentation and are never broken: a block with a line longer
    than the text column scrolls sideways inside its own box.

### A block the rich projection cannot edit

15. Card Detail's rich projection shows a block it cannot edit in its
    rendered form, by the rules 1, 2, 4, 4a, 5, 6, and 6a of the card. The
    elements, their attributes, and the text are the same as on the card
    (`baseHalfNoteMarkdownToHtml`, `BASEHALF_NOTE_HTML_TAGS`).
15a. A click on a link in such a block opens it by rule 6b.
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
back as Markdown, in the forms that
[formats of a note](note-formats.md#how-each-format-is-stored) owns. Some
HTML has no form in it. Read and written back, it would lose:

| The note has | Written back as | What the reader loses |
| --- | --- | --- |
| `H<sub>2</sub>O`, `<kbd>`, `<mark>` | `H2O` | the formatting |
| a table written as HTML | a pipe table | nothing in a plain table; merged cells in others |
| `<!-- a comment -->` | nothing | the comment |

19. The rich projection edits a block in place when the block, read and
    written back by it, shows the same on the card and keeps every HTML
    element, attribute, and comment and every title of a link or a picture
    that it has ([formats of a note](note-formats.md#which-blocks-rich-edits),
    rule 34). Any other block is shown as rules 15 to 18 say, and is not
    edited there.
20. A line break is kept whichever way it is written. The rich projection
    writes it as `<br>` where a block is one line: in a table cell, a
    heading, a toggle's title, and a caption. Elsewhere it writes it as a
    Markdown line break.
21. So these are edited in place: a table with `<br>` in its cells; a
    paragraph, a list item, or a quote with `<br>`; and a heading with
    `<br>`. A line break that the user types into a table cell or a heading
    is saved as `<br>`.
22. Which HTML the rich projection writes, and so which blocks with HTML it
    edits, is owned by [formats of a note](note-formats.md#which-blocks-rich-edits),
    rule 37. A block with `<sub>`, `<sup>`, `<kbd>`, `<mark>`, a comment, or a
    table written as HTML is still not edited in place.
23. A block that the user does not edit is saved byte for byte, whether it
    is edited in place or not. A block that the user edits is written in its
    canonical form ([formats of a note](note-formats.md#how-each-format-is-stored)):
    `<br/>` becomes `<br>`, and `<br>` in a paragraph becomes a Markdown line
    break.

### Note size and parts

24. A note of up to 1 MiB (1,048,576 bytes of its file in UTF-8, front
    matter included) is shown on its card by the rules above. That is about
    350,000 Chinese characters (`BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES`).
25. A double click anywhere on a note of up to 128 KiB (131,072 bytes,
    about 43,000 Chinese characters) edits it on its card
    (`BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES`), also on a block that the
    card's editor cannot edit ([formats of a note](note-formats.md), rule
    82a). A double click on a larger note opens it in Card Detail.
26. A note above 1 MiB shows only the label "This Markdown file is too large
    for quick edit. Double-click to open the full editor.", and a double
    click opens it in Card Detail. A card shows the whole note or the label:
    every block of a shown note can be reached by scrolling the card.
27. A note that grows above 128 KiB while it is edited on the card stays in
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
    above 128 KiB in the editor holds the parts down to the place the editor
    shows: it shows the same place when the editor closes, and its tables
    and code blocks are shown unscrolled.
32. The card of a text file or a code file shows its first lines whatever
    the size of the file. It reads only the first 8 KiB of the file, and
    shows "Binary file" when they hold a NUL byte. A result node reads the
    text of its result the same way. A text result is never reported as
    missing because it is long.
32a. A card reads its file as text the way Card Detail reads it (D138): in
    the encoding the settings `files.encoding` and `files.autoGuessEncoding`
    give for the file and its language, by the byte order mark of a file that
    has one, and in the encoding chosen for the file in the status bar for as
    long as the window holds the file's text. So a text file, a code file,
    and a note show the same characters on their cards as in Card Detail. The
    8 KiB of rule 32 and the 1 MiB of rule 24 are counted in the bytes of the
    file, whatever its encoding. "Binary file" shows for what the editor
    refuses to open as text, and for a NUL character in what was read.
33. The card of a code file shows the file as the editor does (D118, D121): from
    its first line, in the editor's colors, with its indentation and blank lines,
    at the editor's tab width, and without wrapping, so that a long line ends
    at the edge of the card. Nothing is skipped: imports and a license header
    stay. Its lines have numbers, and it can be scrolled and edited where it
    stands ([a code file on its card and in Card Detail](code-cards.md)).
    A code file is one whose language the window knows, other than plain text
    and Markdown, or whose icon says it is code; a language the window has no
    grammar for shows the same way in one color. Any other text file shows as
    before: its lines trimmed, without blank lines, wrapped, in one color. A
    note is not a code file, and neither its card nor its Source has colors.

### The typography of a note

34. **A note has one typography.** In Card Detail a note is set the same in
    Rich and in Preview: one font, one text size, one line height, one width
    of its text, and one size of each level of heading. A paragraph breaks
    at the same words in both, at every width of Card Detail, and a switch
    between the two changes no size. The values:

    | What | Value |
    | --- | --- |
    | Font | `basehalf.notes.fontFamily`, and after it the font of the window |
    | Text size | `basehalf.notes.fontSize`: 12 to 28 px, 16 px without a value |
    | Line height | 1.5 times the size of the line's text, in a heading too |
    | Width of the text | at most 712 px, in the middle of the page, with at least 85 px of the page at each side |
    | Heading 1, 2, 3 | 3, 2, and 1.3 times the text size, bold |
    | Heading 4, 5, 6 | the text size, bold |
    | Above and below the text of a block | 0.1875 of the text size (3 px at 16 px) |
    | Above a heading | 1.125 times the text size (18 px at 16 px) |
    | Above the first block and below the last | 56 px and 80 px |

    Rich's values are the measure, because a note is written there; they are
    what Rich showed at 16 px before, but for the headings of level 5 and 6,
    which were smaller than the text.
34a. **What stands beside the text follows the text size.** The bullet or
    the number of a list item, the room it stands in (1.125 of the text size
    for a bullet, 1.375 for a number), the step of a nested block (1.125),
    and the box of a task are multiples of the text size, in Rich and in
    Preview. In Rich the handles of a block stand at the middle of the
    block's first line at every text size and beside a heading of every
    level ([zoom and outline of a note](note-zoom-and-outline.md), rule 22),
    and the box of the reading aids stands beside the first line of its
    paragraph.
35. **The font.** `basehalf.notes.fontFamily` is a list of fonts, of which
    the first that the computer has is used. Without a value a note is in
    the font of the window, the font of the names in Files. The font of the
    window follows every list, so a list none of whose fonts the computer
    has shows the font of the window.
36. **The text size.** `basehalf.notes.fontSize` is the size of a note's
    text in Card Detail. A value below 12 is 12, one above 28 is 28, and one
    that is no number is 16. The size is in the pixels of the window at a
    zoom of 100%: the zoom of the window and the magnifying of a page
    ([zoom and outline of a note](note-zoom-and-outline.md)) draw a note
    larger on top of it, as before.
37. **Code keeps the font of code.** Inline code and a code block of a note
    are in `editor.fontFamily`, the font of Source and of code cards, on
    every surface, whatever the font of the note. In Card Detail code has
    the size of the text around it.
38. **The card shows the same note from afar.** A note's card and the card's
    editor are in the font of the note. Their text is 13 px at a zoom of the
    canvas of 100%, with a line height of 1.45 and headings of 18, 16, 14,
    and 13 px, whatever the text size: on the canvas the text of a card
    follows the zoom of the canvas. Code on the card is 0.92 of the size of
    the text around it.
39. **A card at rest and its editor are one face.** They take the font from
    one place, so the frame in which the editor opens or closes shows every
    line where it was, in every font.
40. **The settings are followed at once.** A change of the font or of the
    text size shows in an open Card Detail, in Rich and in Preview, and a
    change of the font on every note card of an open canvas, also on one
    that is being edited: without a reload, in the next frame that is drawn.
    No frame shows a note partly in the old value.
    - A note that opens shows the values from its first frame. Rich's page
      gets them with the note.
    - The caret, the selection, the editor's undo, an open menu, and the
      level of a magnified page stay as they were.
    - The view keeps its place: the block at the top of the view stays
      there, and only what the new size needs moves.
    - The menus, the toolbars, and the outline keep the font and the size
      of the window.
41. **What a card builds follows the font.** A font changes how many lines a
    note takes. After a change, the parts of a note that its card has built
    reach as far as rule 28 asks in the new font, before that frame is shown.

### The form a note opens in

42. A note (`.md`, `.markdown`) opens in Card Detail in the form of
    `basehalf.notes.openIn`: Rich, Preview, or Source. Without a value, or
    with a value that is none of the three, it is Rich. This holds wherever
    the opening names no form: a card's Expand and its double click when
    the note is too long for the card's editor, Files, the search of the
    title bar, a link, a file opened from outside.
43. An opening that names a form opens in that form: Edit in Source of a
    block, a result of Search at its line, and a format chosen on a card
    whose note the card's editor cannot change, which opens Rich and is
    applied there.
44. The switch between the forms in the header of Card Detail changes the
    form of the note it shows, and nothing keeps it: the next opening
    follows the setting again. Back and Forward show a note in the form it
    had at that step, as before.
45. The setting is read at each opening. A change of it leaves an open Card
    Detail as it is. Every other kind of file opens as before.

## Limits

- A font is a list of names of fonts on the computer. BaseHalf brings no
  font of its own for notes, and a name the computer does not have is passed
  over without a sign.
- At a text size of 28 px a heading of level 1 is 84 px, and a title of
  more than about 14 letters takes two lines in a text 712 px wide.
- The card's text does not follow the text size (rule 38). A reader who
  needs larger text on the canvas zooms the canvas or the window.
- In Preview a list, a quote, and a table are drawn by the Markdown
  renderer of the base and in Rich by the editor: their text has the same
  font, size, and line height, and their marks, their indents, and the lines
  of a table differ by a few pixels.
- Pictures, videos, and the boxes of files keep their sizes at every text
  size.
- With `files.autoGuessEncoding` on, the excerpt of a text or a code file is
  guessed from its first 8 KiB, and Card Detail guesses from more of the
  file. For a file whose first 8 KiB are plain ASCII the two can differ.
- The bar of a table or a code block cannot be dragged. A mouse without a
  sideways wheel scrolls the box with Shift and the wheel.
- A table whose text has no place to wrap, such as a long address, is as
  wide as that text.
- An HTML block other than a toggle that spans a blank line, such as
  `<div>` around paragraphs, is one element at rest and several blocks while
  the card is edited and in Card Detail's rich projection. Its parts are
  then rendered one by one. A `<details>` around paragraphs that reads as a
  toggle is one toggle in the rich projection and one fixed block, drawn as
  at rest, in the card's editor; one that does not is shown in parts as
  other HTML blocks are ([formats of a note](note-formats.md#toggles), rules
  41 and 42).
- A block that the rich projection cannot edit has no sign of that until
  the pointer is on it, where Edit in Source appears.
- A code block has no syntax colors on the card.
- An image address that cannot be loaded shows the browser's broken image
  with its alternative text.
- The 128 KiB of rule 25 is set by the card's editor. It builds every block
  of the note when it opens, and with every typed letter it joins the text
  of the whole note and compares it with the file, though it writes back
  only the block that changed. So both opening and typing take longer for a
  longer note. Measured in the real window on 2026-10-14 with the limit
  lifted, on a Chinese note repeated to each size, with a machine under
  load:

  | Note | Opens in | Elements of the editor | A letter is drawn within (95 %) |
  | --- | --- | --- | --- |
  | 64 KiB | 0.18 s | 1,900 | 9 ms |
  | 128 KiB | 0.26 s | 3,600 | 10 ms |
  | 256 KiB | 0.53 s | 7,200 | 13 ms |
  | 512 KiB | 0.95 s | 14,300 | 20.5 ms |
  | 1 MiB | 2.0 s | 28,900 | 27.5 ms, every letter above 20 ms |

  128 KiB is the largest size that keeps criterion 16. Of the 2.0 s at
  1 MiB, about 0.9 s went to building the editable document, 0.25 s to
  rendering every block for the editor's fixed view, and 0.12 s to building
  every part of the resting projection under it. A card's editor without a
  limit, as in a text editor that draws only the lines in view, would build
  only the blocks in view and write back a changed block without joining the
  whole note. Before 2026-10-14 the limit was 64 KiB, set before these
  measurements.
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

## Implementation boundaries

- `markdown/common/basehalfNoteTypography.ts`: what a note is set in (the
  font, the text size, the font of code) from the values of the settings
  and the font of the window, and the CSS properties that carry it. It
  imports nothing, so Rich's page uses it too.
- `markdown/browser/basehalfNoteTypographyService.ts`: the one reader of the
  three settings (`basehalf.notes.fontFamily`, `basehalf.notes.fontSize`,
  `editor.fontFamily`). It keeps the properties on the element of the
  window, where the stylesheets of Preview and of the card read them, and
  says when they changed. No stylesheet names a font or a size of a note
  itself.
- Rich's page is another document. It gets the typography with `init` and
  in the message `typography` when it changes
  (`markdown/common/basehalfMarkdownRichWebviewProtocol.ts`), and keeps the
  same properties on its own document.
- The canvas asks the notes it has built in parts to build on after the
  typography changed (`canvas/browser/basehalfCanvasNoteParts.ts`).
- `cardDetail/common/basehalfCardDetail.ts`: the form a file opens in when
  an opening names none, with the setting for a note
  (`baseHalfCardProjectionOpenedIn`). The registry of projections reads the
  setting at each opening.

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
13. A paragraph `one<br>two` and a heading `# a<br>b` can be edited there.
    `H<sub>2</sub>O` cannot.
13a. On the card at rest and in Preview, `<audio src="sound.mp3" controls></audio>`
    is an `audio` element whose address is in the note's folder, and
    `![clip](clip.mp4)` is a `video` element.
13b. `<span style="color:#e8706b;">red</span>` is drawn rgb(232, 112, 107) on
    the card, in Preview, and in a block the rich projection cannot edit;
    `<span style="color: red">red</span>` is plain text in all three.
13c. A click on `[x](my%20file.md)` on the card and in Preview opens Card
    Detail of `my file.md`, and no link there has a `title`.
13d. `<details open>` shows open on the card and in Preview.
13e. In the real window, a video of a note that plays on its card at rest, in
    the card's editor, and in Preview goes on playing while the note is
    written from outside four times, half a second apart, as an agent writes
    it: sampled on every frame, its player stays, unpaused, with a frame to
    show, its time never goes back, and over the writes it advances as much
    as the time that passed. A sound does the same, and a video that stands
    keeps its frame and its time.
13f. Opening a note in Rich that holds a picture, a video, and a sound at
    relative addresses, one of them in the store of the note's files, and
    copying the picture, asks the window for no address that is refused.
14. A note with such a table that is opened and not edited keeps every byte.

15. A note of 131,072 bytes opens in the card's editor on a double click. A
    note of 131,073 bytes is shown on its card and opens in Card Detail on a
    double click. A note of 1,048,576 bytes is shown on its card; a note of
    1,048,577 bytes shows the label of rule 26. A note of Chinese text is
    measured in the bytes of its UTF-8, not in characters.
16. In the real window, a note of about 128 KiB opens in the card's editor
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
22. A text file, a code file, and a note written in GBK show their
    characters on their cards with `"files.encoding": "gbk"` in the user's
    settings, and with `"files.autoGuessEncoding": true` instead. A file in
    UTF-16 with a byte order mark shows its text without any setting. Each
    card shows what Card Detail shows of the file, and a file in UTF-8 shows
    as before.
23. With the settings without values, a paragraph of a note in Card Detail
    is drawn in the font of the window at 16 px with lines of 24 px, in a
    text 712 px wide in a Card Detail of 1,130 px, in Rich and in Preview;
    its lines break at the same words in both; the headings of level 1 to 6
    are 48, 32, 20.8, 16, 16, and 16 px in both. In a Card Detail of 834 px
    the text is 664 px wide in both.
24. With `"basehalf.notes.fontSize": 28` the paragraph is 28 px with lines
    of 42 px and the heading of level 1 is 84 px, in Rich and in Preview;
    with 12, 12 px, 18 px, and 36 px. A value of 40 shows as 28 and a value
    of 4 as 12. The text of the note's card is 13 px at each.
25. With `"basehalf.notes.fontFamily"` set to the Serif list, the text of
    the note is drawn in its first font that the computer has, in Rich, in
    Preview, on the card at rest, and in the card's editor; inline code and
    a code block are in `editor.fontFamily` in all four; the menu of
    blocks, the toolbar of a selection, and the outline are in the font of
    the window. With a list of one font that the computer does not have,
    the text is in the font of the window.
26. In the real window, with a note open in Rich, scrolled to its middle,
    with a selection in a paragraph in view: the text size written to the
    settings file as 20 shows in the page within a second, and sampled on
    every frame from the write on, each frame shows every block of the note
    in one size, the old or the new; the block at the top of the view is
    the same before and after, within 2 px of its place; the selection
    holds the same text, and typing a letter replaces it. The same for the
    font, and the same in Preview for the block at the top of the view.
27. In the real window, a change of the font shows on every note card of
    the open canvas in one frame, at rest and in the card's editor, whose
    caret stays where it was; the text of a card is 13 px before and after.
28. A note opened with a text size of 22 and the Serif list shows them in
    the first frame that shows the note, in Rich and in Preview: sampled on
    every frame from the opening on, no frame shows text of the note at
    another size or in another font.
29. A note magnified to 200% keeps its level through a change of the text
    size, and criterion 3 of [zoom and outline of a note](note-zoom-and-outline.md)
    holds at a text size of 28.
30. On a card whose note is built in parts, switched to the Monospace list
    and back: after each change the built parts reach two heights of the
    card below what the card shows, or the note's end, and a card at rest
    and its editor show every line at the same place in the frame the
    editor opens.
30a. At a text size of 12, 16, and 28, in the font of the window, the Serif
    list, and the Monospace list: the number of a list item stands clear of
    its text; the box of a task is in the middle of its first line; in Rich
    the handles of a block are within 1 px of the middle of the block's
    first line, beside a paragraph and beside a heading of each level; the
    menu of blocks opens 4 px under its line, 280 px wide, with rows of 13 px
    in the font of the window; the pale word of an empty title line has the
    size and the font of the title.
30b. At a text size of 28, a table of four columns in Rich breaks no number
    and no word but at its hyphen, and a code block with a line longer than
    the text column shows that line unbroken in Rich and in Preview, each
    block as high as its number of lines, with a background of its own; in
    Preview its lines keep their indentation.
31. With `"basehalf.notes.openIn": "preview"` a note opens in Preview from
    a card's Expand, from Files, and from the search of the title bar, and
    with `"source"` in Source; a picture, a text file, and a code file open
    as before. Edit in Source of a block opens Source, and a format chosen
    on a card that must open Card Detail opens Rich, whatever the setting.
    A note switched to Rich and closed opens in Preview again. A change of
    the setting leaves the open Card Detail in its form.

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
- Unit: `basehalfCanvasMarkdownInlineEditor.test.ts` and
  `basehalfMarkdownPreviewCardDetail.test.ts` cover criteria 13a to 13d;
  `basehalfNoteShown.test.ts` covers rules 19 and 22. Smoke:
  `canvas-note-formats` and `preview-note-formats` cover criteria 13a to 13d
  in the real window.
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
- Unit: `basehalfNoteMedia.test.ts` covers rule 4b: a drawing of a
  note takes over the players of the drawing it replaces, in their order, one
  that plays goes on playing, and the player of a block that has left the
  note goes. Smoke: `canvas-note-media-plays-on-when-drawn-again` covers
  criterion 13e on the card at rest and in the card's editor, and
  `preview-note-media-plays-on-when-drawn-again` in Preview, each sampled on
  every frame; `note-formats-media-asks-for-no-refused-address` covers
  criterion 13f.
- Unit, the typography: `basehalfNoteTypography.test.ts` covers rules 35 to
  37, the values a surface gets for each value of the three settings, and
  the properties that carry them; `basehalfNoteTypographyService.test.ts`
  that each setting is followed at once, that the element of the window
  holds the new values when the change is told, the font of a window that
  is starting, and that the limits are the registered ones;
  `basehalfNotePlace.test.ts` the place a view keeps (rule 40);
  `basehalfMarkdownRichWebviewProtocol.test.ts` and
  `basehalfMarkdownRichWebviewBridge.test.ts` the typography with `init` and
  in its own message; `basehalfCanvasNoteParts.test.ts` rule 41.
- Unit, the form a note opens in: `basehalfCardDetail.test.ts` covers rules
  42 to 45 as far as the registry decides them: each value of the setting
  for a note and for other files, a form the note does not have, the setting
  read at each opening, an opening that names a form, and the name and the
  values the setting is registered with.
- Smoke, in `cardDetail`: `note-has-one-typography` covers criteria 23 to 25,
  `note-typography-is-followed-at-once` criteria 26 and 27 on every frame,
  and `note-opens-in-the-form-of-its-setting` criterion 31 for the search, a
  card's Expand, the switch, and a change of the setting.
- In the real window, on 2026-11-21, with a note of headings of every level,
  lists, tasks, a table, a quote, code, a picture, and Chinese text in a copy
  of a folder of real notes: criteria 23 to 31, each change sampled on every
  frame by the page itself (about 325 frames a change): the text size and
  the font in Rich and in Preview, the font on 16 note cards at rest and in
  a card's editor with the caret in it, a note opening in Rich and in
  Preview at 22 px in the Serif list, a pinch to 201% at 28 px, a card built
  in parts through a change from a wide font to a narrow one, the rows of
  Settings > Notes with Card Detail open behind them, and each way of
  opening a note with each value of the setting; and screenshots at 12, 16,
  and 28 px in the three fonts for criteria 30a and 30b.
- Unit: `basehalfCanvasCardText.test.ts` covers what rule 32a asks of the
  read: the head of the file or the limit of a note, text only, and the
  encoding the window holds for the file. Smoke:
  `card-reads-its-file-in-its-encoding` in `workbench` covers criterion 22
  for a text file with `files.encoding`; the other cases were run once in
  the real window.
