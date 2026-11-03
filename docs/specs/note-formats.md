# Formats of a note

Status: Draft (2026-11-02)
Decision: [D110](../decisions.md#d110--what-rich-shows-of-a-note-is-what-its-file-keeps-and-rich-offers-nothing-the-file-cannot-keep-new-2026-11-02)
Related: [note rendering](note-rendering.md) (what the card and Preview show,
and the blocks Rich cannot edit), [zoom and outline of a note](note-zoom-and-outline.md)
(headings in a closed toggle), [copy, paste, and drop](copy-paste-and-drop.md)
(a copy and a paste elsewhere in BaseHalf), [the selection agents can see](selection-for-agents.md)
(the lines of a selection in Rich), [exact undo](exact-undo.md#undo-in-an-editor-of-text)
(undo in an editor of text), [reference graph](reference-graph.md#rich-editor-coherence)
(front matter and the save of Rich), [generation cards](generation-cards.md#inputs)
(a note's text in a prompt), [agent skill](agent-skill.md) (the forms agents
are told), [architecture invariants](../harness/architecture-invariants.md#content-and-graph-truth)

## The rule

**What Rich shows of a note is what its file keeps. Every format Rich offers
is written into the Markdown file and shows the same after the note opens
again, in Rich, on its card, and in Preview. A format the file cannot keep is
not offered.**

## Problem

A note is a Markdown file, and the file is the only truth of its content
(D12). Rich, Card Detail's block editor of a note, offered formats that its
writer could not put into Markdown, and it read back some of what it wrote as
something else. Measured on 2026-11-02 in a development window of main
`af2881912`, 1280 × 860 points, one note per format, each applied through the
real menus and keys, then Card Detail closed and the note opened again:

- **Most formats were never written.** Underline, a text color, a background
  color, a block's color, the alignment of a paragraph, a picture, or a table
  cell, Tab on a paragraph, a picture resized from 480 to 338 pixels, and a
  column's width changed nothing in the file within 6 s or later. Rich showed
  them until the note was closed, and then they were gone. Typing " more"
  into the underlined paragraph wrote `Underline target words here. more`.
- **Toggles came back as other blocks.** A toggle heading with a child was
  written `## toggle heading` and a separate paragraph; a toggle list item
  became `* second toggle` with an indented paragraph, a bullet after the
  note opened again.
- **Media came back broken or as text.** A video uploaded without a caption
  was written `![clip.mp4](attachments/clip.mp4)` and opened again as a
  broken picture. A sound was written `<audio src="…" controls></audio>`;
  the card showed that line as text, and Preview dropped it. Hide Preview
  turned a picture into the link `[pic three](pic.png)`. A caption on a file
  block named as its address wrote `handout.pdf` and the caption as two
  lines of text: the link was gone.
- **Links did not survive or did not open.** A `[[` link to `my file.md` was
  saved as the plain text `see my file.md`. An edit of the paragraph holding
  `[my file angle](<my file.md>)` wrote `(my file.md)`, read back as a link
  to `my`. In Preview, `[my file encoded](my%20file.md)` raised a dialog
  "Unable to open 'my%20file.md'" with Create File; on the card the same
  link did nothing. A click on a link in Rich did nothing.
- **Tables lost their header and alignment.** A table made from the slash
  menu was written with an empty first row and read back without a header
  row. The `:-:` alignment of a column was dropped as soon as any cell of the
  table was edited.
- **Colors were the editor's light palette.** Red text was drawn in
  rgb(224, 62, 62), and a yellow background rgb(251, 243, 219) behind text of
  rgb(187, 190, 191): about 1.7:1.
- **Typed text was lost.** Command-→ at the end of a line followed by a block
  Rich cannot edit put the caret into that block's "Edit in source" label,
  and the letters typed next were dropped, twice.

Read in the editor's writer and run in its shipped code: underlining a word of
a bold sentence writes `**important** **word**** here**`, which reads back
with stray asterisks; an image block without a file is written as the text
`Add image`; typed `*x*`, `# x`, `1. x`, and `<u>x</u>` open again as
formats.

Counted on 2026-11-03 over the fidelity corpus and `docs/`, 75 notes of
7,282 blocks: Rich edited 7,081 of the blocks before this decision and edits
7,215 after it, 146 of them blocks it could not edit before. The 12 it no
longer edits are spellings that L2 keeps fixed: 10 quotes of several
paragraphs or blocks, which Rich joined into one paragraph when it wrote
them, a paragraph of references whose definitions have titles, and a picture
with a title inside text.

On 2026-11-02 the user asked whether the Markdown file should stay the only
source of truth ("所以你觉得我们要不要以 MD文件为唯一真相来源呢？": so should
the Markdown file be the only source of truth?) and what the note's Card
Detail, the note made large, should do ("我们现在主要是要解决笔记节点这个
card detail 的问题。（放大版的笔记）"), and approved the answer: the note stays
Markdown, a format Markdown has no syntax for is a small HTML tag in it, and a
format the file cannot keep leaves the editor ("可以，那我们开始吧": fine, let's
start).

## Goals

- Every format Rich offers is written into the file, in a form that Rich, the
  card, the card's editor, and Preview read back the same way.
- A note that is not edited keeps every byte, and an edit stays in the block
  it changes.
- Rich offers no control whose result the file cannot keep, on any path:
  toolbar, menus, keys, paste, drop, and drag.
- Links open their target from every place a note is read.

## Non-goals

- Files put into a note, where they are kept, and how their links follow
  them: a later decision (D111). Until then a file put into a note goes to
  the attachments folder as before.
- The cover of a PDF in a file block, callouts, and links that follow a
  renamed file.
- Rewriting notes written before this: nothing is changed until the user
  changes a block.
- Every spelling of a format that people and agents write. A spelling Rich
  cannot write back stays a fixed block and loses nothing.

## Terms

- **Rich**, **Preview**, **Source**: the three projections of a note in Card
  Detail. Rich is the block editor.
- **The card**: a note's card on the canvas at rest. **The card's editor**:
  the editor a double click opens on the card.
- **Format**: anything Rich shows of a block besides its characters: a mark
  on characters (bold, underline, a color, a link), the kind of a block and
  its level, its children, the width of a picture, a caption.
- **Stored form**: the text in the file that holds a format.
- **Canonical form**: the one stored form Rich writes when it writes a block
  ([How each format is stored](#how-each-format-is-stored)).
- **Fixed block**: a block that Rich shows rendered and does not edit, saved
  byte for byte ([note rendering](note-rendering.md#a-block-the-rich-projection-cannot-edit)).
- **Toggle**: a block whose children fold: a toggle list item or a toggle
  heading.
- **Palette color**: one of the nine colors of Rich's color menu.
- **Container**: the note, a toggle, or a list item: what holds blocks one
  after another. Two blocks are **neighbours** when one follows the other in
  the same container.
- **Kind**: the type of a block, whether a heading is a toggle, and for a
  list item its marker character or delimiter and whether it is a task.

## Required behavior

### What Rich offers

1. **Rich offers only what the file keeps.** Every control, menu item, and
   key of Rich gives a result that is written into the file and shows the
   same after the note opens again. A control whose result the file cannot
   keep is not shown, and no key reaches it.
2. The toolbar of selected text has the block type menu (paragraph, headings
   1 to 6, toggle headings 1 to 3, quote, toggle list, bullet list, numbered
   list, check list), Bold, Italic, Underline, Strikethrough, the color menu,
   and Create link. It has no alignment, Nest, Unnest, or comment button.
3. The toolbar of a picture, a video, and a sound has Edit caption, Replace,
   and Delete, and a picture also Rename, which edits its name. The toolbar
   of a file has Replace, Rename, and Delete. None has an alignment button,
   Toggle preview, Download, or a caption for a file.
4. The menu of a block's drag handle holds Delete only.
5. The slash menu and the add button offer the blocks of rule 2, the code
   block, the divider, the table, the emoji, the picture, the video, the
   sound, and the file. A toggle heading is offered at levels 1 to 3; one of
   level 4 to 6 in a file is read and written as it is.
6. The handles of a table's rows and columns offer Delete and Add above,
   below, left, and right, and no header, color, merge, or split item.
   Dragging the border of a column does nothing.
7. The color menu offers the nine palette colors and Default, for text and
   for the background, drawn in BaseHalf's palette whatever the system's
   appearance.
8. The resize handles of a picture and a video stay. The width is a whole
   number of pixels, and the edge follows the pointer at any magnification of
   the note.
9. Rich adds no button, setting, dialog, or question for a format, and no
   control of Rich shows a system tooltip.

### How each format is stored

10. **Unchanged formats.** Bold, italic, strikethrough, inline code, links,
    headings, quotes, bullet, numbered, and check lists, code blocks,
    dividers, tables, and emoji are stored in Markdown.
11. **Formats written as HTML.** Underline, text and background colors,
    toggles, the width of a picture or a video, a caption, a video, and a
    sound are stored as HTML inside the Markdown, in the forms of the table
    below. Rich writes no other HTML.
12. When Rich writes a block, it writes every format in it in its canonical
    form:

    | Rich shows | Stored as |
    | --- | --- |
    | `word` underlined | `<u>word</u>` |
    | `word` in red | `<span style="color:#e8706b;">word</span>` |
    | `word` on yellow | `<span style="background-color:#4a401d;">word</span>` |
    | both | `<span style="color:#e8706b;background-color:#4a401d;">word</span>` |
    | a bold sentence whose `word` is also underlined, red, and on yellow | `**important <span style="color:#e8706b;background-color:#4a401d;"><u>word</u></span> here**` |
    | bold `重点，` between Chinese text | `这是<strong>重点，</strong>然后` |
    | a link whose text is partly underlined | `[a <u>x</u>](https://example.com)` |
    | a closed toggle list item with children | `<details>`, `<summary>Title</summary>`, a blank line, the children, a blank line, `</details>` |
    | the same, stored open | the same with `<details open>` |
    | a toggle heading of level 2 | `<summary><h2>Title</h2></summary>` in the same form |
    | a toggle without children | `<details>`, `<summary>Title</summary>`, `</details>` on three lines |
    | a picture | `![name](pic.png)` |
    | a picture 320 pixels wide | `<img alt="name" src="pic.png" width="320">` |
    | a picture with a caption | `<figure><img alt="name" src="pic.png"><figcaption>caption</figcaption></figure>` |
    | a video | `<video src="clip.mp4" controls></video>` |
    | a video 480 pixels wide | `<video src="clip.mp4" width="480" controls></video>` |
    | a video or a sound with a caption | `<figure>`, the element, `<figcaption>caption</figcaption></figure>` |
    | a sound | `<audio src="sound.mp3" controls></audio>` |
    | a file | `[handout.pdf](handout.pdf)` on a line of its own |
    | a table with a centered and a right-aligned column | `\| L   \| C   \| R   \|`, `\| --- \| :-: \| --: \|`, then the rows |
    | a divider | `---` |

13. **Marks nest by their length.** Where marks overlap, the mark that goes on
    longer is outside; marks of equal length nest in the order link, color,
    underline, bold, italic, strikethrough, code. Code stands inside every
    other mark, so a mark that covers part of a run of code cuts it into
    code spans: `` `a`**`b`**`c` ``. Code may carry every other mark and stand in
    a link's text: `` **a `b`** ``, `` [the `x` key](u) ``. A link is never
    cut in two: a mark that covers part of it closes before it and opens
    again inside it. White space at the edges of bold, italic, and
    strikethrough stands outside them.
14. Bold, italic, and strikethrough are written `**`, `*`, and `~~` where the
    card's reader reads them back so, and `<strong>`, `<em>`, and `<del>`
    where it would not, as beside Chinese punctuation, and inside HTML. Rich
    reads the text of each block it writes with the card's reader, in the
    place it stands, before it keeps it.
15. **Typed text stays text.** A character that Markdown would read as markup
    is escaped where it would act as markup, and only there: `\*`, `\_`, `\~`,
    and a backtick where they could pair, counting those that the block's
    code and link addresses write; at the start of a line `\#`, `\>`, a list
    marker (`-`, `+`, `*`, or a number with `.` or `)`), and the first
    character of a rule, a setext underline, or a table's separator row; a
    `<` that would start a tag, a comment, or an address in angle brackets as
    `&lt;`; `&` before a character reference as `&amp;`; and the colon of a
    web address that is not a link as `&#58;` (`www&#46;`, `me&#64;` for the
    others the card would link). A backslash before punctuation or a symbol
    is doubled. In a link's text a bracket is `&#91;` or `&#93;`. A carriage
    return is the space it shows. A line or paragraph separator, and white
    space other than a space, a tab, or a form feed that ends the text where
    its line ends, such as a full-width space, are character references
    (`&#8232;`, `&#12288;`). Brackets that form no link stay as typed:
    `[[My Note]]`, `Text[^1]`, and `[!NOTE]`.
16. A line break is a backslash at the end of the line in a paragraph, a
    quote, and a list item, and `<br>` in a heading, a table cell, a link's
    text, and a toggle's title. A caption is one line: a line break in it is
    a space.
17. **Links.** A link is `[text](address)`. A web address is written bare
    only when it is the link's own text and the card reads the bare address
    as the same link; a relative address never is. In an address a space is
    `%20`, `<` and `>` are `%3C` and `%3E`, `\` is `%5C`, a `%` that starts
    no escape is `%25`, a parenthesis without its partner is `%28` or `%29`,
    a control character or other white space is escaped, and an `&` that a
    page would read as the start of a character reference is `%26`; letters
    of any script, `#`, `?`, and balanced parentheses stay as they are.
18. A link that `[[` inserts, and the address of a file put into a note, are
    written with the space, `#`, `?`, `%`, brackets, parentheses, and the
    other characters a path segment cannot hold in a link encoded:
    `[my file.md](my%20file.md)`, `docs/lecture%20%231.pdf`.
19. **Lists.** A list item keeps the marker the file gave it: `-`, `*`, or
    `+`, and the number and `.` or `)` of a numbered item. Its children keep
    the indentation and the line breaks the file had between them. An item
    that starts its list is written with the number Rich shows: the number
    the file starts the list at, or the number typed, else 1. Any other item
    keeps the number the file gave it. A new item takes the marker of the
    item before it in its list; a new numbered item takes the number after
    the one before it, or that same number when the two items before it, or
    the item before it and the item after it, have the same number. A new
    child is indented by the width of the marker: 2 for `- `, 3 for `1. `.
20. **Code.** A code block is fenced with three backticks, or with one more
    backtick than the longest run of backticks that starts a line of the code
    after up to three spaces. The language `text` is not written. The code is
    written as Rich holds it, tabs included.
21. **Tables.** A table is a pipe table whose first row is its header row.
    Each column is padded to its widest cell, at least three characters, a
    wide character counting two. The separator row holds each column's
    alignment: `:-:` center, `--:` right, `---` left. `|` in a cell is `\|`,
    also in code; a line break in a cell is `<br>`.
22. **Pictures, videos, sounds, and files** are stored as the table of rule
    12 shows. A picture without width and caption is a Markdown picture. It
    is `<img>` when its name holds a bracket, a backslash, a backtick, or a
    line break, or its address holds `|`, which the card reads in a Markdown
    picture as the start of a width or a height. The name of a video or a
    sound is not stored, and Rich offers no Rename for them.
23. **Nothing for nothing.** A picture, a video, a sound, or a file block
    without an address writes nothing, and so do an empty paragraph and a
    block whose text is white space alone. An empty check item is
    `- [ ] &#32;`: the space after its box is a reference, which neither the
    card's reader nor a tool that trims lines takes away. A list item without
    text that holds blocks is its marker alone when its first child starts a
    block of its own on the line under it (a list, a heading, a quote, code,
    a table, a toggle, a picture, a video, or a sound); otherwise its text is
    `&#32;`, and its children follow it as they follow an item's text
    (rule 67).
24. The line ending of a written block is the file's: CRLF when the file's
    first line break is CRLF.

### Reading a note

25. **Rich reads a note as the card reads it.** Rich reads a block with the
    card's Markdown reader, the note's rules for HTML ([note rendering](note-rendering.md),
    rules 1 and 4), the definitions of the note's reference links, and a
    single line break as a line break. What the card shows as a link, a
    picture, a video, a sound, a format, or text, Rich shows the same way.
    The card, Preview, and a fixed block read a Markdown link's address as
    Rich does: its character references decoded once and its backslash
    escapes taken off once.
26. A Markdown picture whose address ends in a sound or a video extension of
    the one list of media files ([architecture invariants](../harness/architecture-invariants.md#product-shell))
    is that sound or that video, in Rich, on the card, and in Preview.
    `.ogg` and `.oga` are sounds. The extension is read without `?` and `#`,
    once decoded, without regard to case.
27. A relative address is read from the note's folder wherever the block
    stands: at the top, in a list item, or in a toggle.
28. A `width` of a picture or a video that is a whole number from 1 to 99,999
    is its width. Any other width keeps its block fixed (rule 34).
29. A span whose style is a palette color in the stored spelling, its hex
    digits in either case, is that palette color. A span of any other
    spelling or color keeps its block fixed.
30. A pipe table's first row is its header row, also when its cells are
    empty, as Rich wrote tables before. A column's alignment is read from the
    separator row.
31. A bullet, a numbered, and a check item hold the paragraphs, lists, code
    blocks, quotes, tables, pictures, and toggles indented under them. An
    item without text holds all of them, the first too.
32. A tab in a code block stays a tab.
33. Reading never writes the file and is never a step of undo.

### Which blocks Rich edits

34. **Rich edits a block in place when, read by Rich and written back, the
    block shows the same on the card, and keeps every HTML element,
    attribute, and comment and every title of a link or a picture that the
    file has in it.** Showing the same means: the same characters, each with
    the same formats whichever way each is written; the same links to the
    same addresses; the same pictures, videos, and sounds with their widths
    and captions, each caption above or below as it stands; the same
    toggles, open or closed; the same headings, lists with the number of
    their first item and their spacing, quotes, code with its language and
    the rest of its info string, and tables with the alignment of their
    columns; and the same line breaks. A line break that ends a block's
    text, or the text before a block, after something on its line, shows
    nothing, and in a row that holds text a cell of a line break alone is an
    empty cell. An item's own text that shows nothing, as `&#32;`, is no
    text.
35. Otherwise the block is a fixed block: Rich shows it as the card shows it,
    and saves it byte for byte ([note rendering](note-rendering.md), rules 15
    to 18).
36. A block that the user does not change is saved byte for byte, whether
    Rich edits it or not. A block the user changes is written in its
    canonical form, and its neighbours keep their bytes.
37. So, among others, these are edited in place: `<b>`, `<strong>`, `<i>`,
    `<em>`, `<s>`, `<del>`, `<strike>`, `<u>`, `<code>`, `<br>`, and `<a>`
    with an `href` only; palette spans with hex digits in either case; `<img>`
    with a whole-number width, in any order of its attributes; every
    `<figure>` of a picture, a video, or a sound whose caption follows it;
    `![](clip.mp4)`; `*` and
    `+` bullets and `)` numbers; underlined headings; `_x_`; `~~~` fences and
    indented code; padded tables; bare addresses and addresses in `<…>`;
    character references; reference links without a title; hand-wrapped
    list items. And these stay fixed: `<mark>`, `<sub>`, `<sup>`, `<kbd>`,
    `<ins>`, and other HTML elements; a span of another spelling or color;
    `<a>` with another attribute; a picture with `height`, `style`, `class`,
    or a width in `%` or `px`; a picture inside text or inside a link; a link
    or a picture with a title; a comment; a table written as HTML; a quote of
    several paragraphs or with a list; a reference definition; a heading
    written in HTML outside a toggle's title; a picture, a video, or a sound
    with a format around it; a figure whose caption comes before its picture,
    video, or sound; a Markdown picture whose address holds `|`; a tag that
    crosses the edge of a format written in Markdown, as `<u>*a</u>*`; and a
    `<details>` that Rich cannot read as a toggle (rule 42).

### Toggles

38. A toggle list item is stored as `<details>` on its own line,
    `<summary>title</summary>` on the next, and its children; a toggle
    heading as `<summary><hN>title</hN></summary>`. The title is written as
    HTML: its formats as tags, and `&`, `<`, `>` as character references.
39. The children follow the summary after a blank line, at the toggle's own
    indentation, with the line breaks the file had between them, and
    `</details>` follows them after a blank line. A toggle without children
    is three lines: `<details>`, the summary, `</details>`.
40. **The file keeps how a toggle first shows, and nothing more.** A toggle
    stored `<details open>` shows open in Rich, on the card, and in Preview
    whenever the note is shown; a toggle stored `<details>` shows closed.
    Folding a toggle in any of them is that view's: it writes nothing, is no
    step of undo, and lasts while the note stays open in Rich. A new toggle,
    also a pasted or a copied one, is stored closed. A toggle keeps its
    `open` through edits, undo, and changes of its kind.
41. A `<details>` whose parts are separated by blank lines is one toggle in
    Rich when its first lines are `<details>` or `<details open>` and one
    `<summary>`, its last line is `</details>`, and Rich writes its first
    lines back showing the same. Each child is a block of its own: a child
    the user does not change keeps its bytes when a sibling is edited, and a
    child Rich cannot edit is a fixed block inside the toggle.
42. Otherwise the parts of a `<details>` are read as before this decision:
    its first lines and its last line are fixed blocks, and the blocks
    between them are edited at the note's level. So is a `<details>` that is
    never closed, one that is closed in the middle of a line that goes on,
    and one longer than 50,000 characters or 2,000 blocks.
43. Two toggles, one closed on the line before the other opens, are two
    toggles. A toggle indented under a list item is that item's child.
44. **A toggle opens when the user goes into it.** In Rich, a closed toggle
    opens, with the closed toggles around it, when the caret goes into its
    hidden children, when the user's typing, a paste, an undo, or a redo
    changes them, and when the window shows a place inside them: a reveal of
    a selection, a jump of the outline, a link to a heading. A change made
    outside Rich does not open it.
45. Enter at the end of a toggle's title adds an empty first child when the
    toggle is open or has no children, and adds a block after the toggle
    when it is closed and has children: a toggle list item after a toggle
    list item, a paragraph after a toggle heading. The children stay in the
    toggle. Enter inside the title cuts it in two and the children stay with
    the first part.

### Text colors

46. The palette, stored as these values:

    | Name | Text | Background |
    | --- | --- | --- |
    | gray | `#9b9a97` | `#3f3e3b` |
    | brown | `#ba8e78` | `#4f3a30` |
    | red | `#e8706b` | `#692b2b` |
    | orange | `#dc8434` | `#583b1f` |
    | yellow | `#d5ae38` | `#4a401d` |
    | green | `#5cad83` | `#24443a` |
    | blue | `#4ba3dc` | `#1f4157` |
    | purple | `#a882e4` | `#45306a` |
    | pink | `#e36aaf` | `#62294b` |

47. Rich, the card, Preview, and a fixed block draw the stored value. The
    values are chosen for BaseHalf's dark surfaces: computed by WCAG 2.1,
    each text color is 5.15:1 to 7.37:1 on the card's surface `#222426`, and
    6.15:1 to 8.81:1 on Rich's page `#121314`; the card's text `#b0b3b5` is
    4.83:1 to 5.29:1 on each background, and Rich's text `#bbbebf` 5.45:1 to
    5.96:1.
48. A span is written in the one spelling the card's renderer keeps:
    `color:` before `background-color:`, each followed by `;`, no spaces,
    lower-case hex digits.

### Pictures, videos, and sounds

49. Picture, Video, Sound, and File in the slash menu and the add button open
    the system's file chooser at once. The chosen file is copied where a file
    put into a note goes ([Non-goals](#non-goals)); once the copy is done, the
    block is added where the menu was, with its address, in one step of undo,
    and a caret still there goes on in the line below it. Until then a
    placeholder that is not part of the note says, by the file's name, that
    the file is being added. Cancel in the chooser adds nothing. A file that
    cannot be added shows "Could not add" and its name, as "Could not add
    clip.mp4.", in the placeholder for 3 s, and nothing is added. A note, or a
    file whose name has no extension, chosen for File is added as a paragraph
    of its link: that is how the note stores it and reads it back.
50. Replace keeps the editor's own panel: a file from the disk, and for a
    picture, a video, and a sound a web address too. A file block offers no
    web address: the note stores it as a link and reads it back as one.
51. A picture or a video is never wider than the column of the place that
    shows it ([note rendering](note-rendering.md), rules 8 and 17), whatever
    its stored width.
52. A video or a sound in a note plays in the element's own controls in Rich,
    on the card, and in Preview, not in BaseHalf's player, until files in
    notes (D111). On the canvas, one that starts pauses the others
    ([generation cards](generation-cards.md#the-player)).

### Links

53. **One target, every place.** A link to a note or a file of the workspace
    opens it in Card Detail, and a link to a folder opens its canvas. A link
    to `http:`, `https:`, or `mailto:` opens in the system's browser or mail
    application. A link to a heading opens its note at the heading (rule 56).
    Any other address, a file that is not there, and an address outside the
    workspace's folders do nothing, and nothing asks.
54. **The gestures.** On the card at rest, in Preview, and on a fixed block
    of Rich, a click opens a link, as a page does. In Rich and in the card's
    editor, a click puts the caret in it and Command-click or Ctrl-click, by the system,
    opens it, as editors of text do. In Rich, Open in the
    toolbar of a link and Mod-Enter with the caret in it open it too.
55. **The address is read once.** `?` and `#` end the path; the path is
    percent-decoded once, so `my%20file.md` opens `my file.md`. A path that
    starts with `/` is a path on the disk; any other path is read from the
    note's folder. `.` and `..` are resolved after decoding.
56. **Headings.** `#slug` names the heading of the same note whose slug it
    is: the heading's text in lower case, without the characters other than
    letters with their combining marks, digits, spaces, `-`, and `_`, each
    space as `-`, and `-1`, `-2` added to a slug that comes again (after two
    `Setup` headings, one titled `Setup-1` is `setup-1-1`). Rich and Preview
    scroll the heading to
    24 pixels below the top of the view, as a click in the outline does, and
    open the closed toggles around it. On the card and in the card's editor
    the link opens the note in Card Detail at the heading.
    `other.md#part` opens `other.md` at its heading `part`.
57. No link shows a system tooltip: the card, Preview, and a fixed block
    drop the `title` of a link and a picture when they draw it.

### Tables

58. A table has one header row, its first row. A row dragged to the top, or
    added above the first, is the header row.
59. A column keeps the alignment the file gave it. Rich offers no alignment,
    and keeps every cell of a column at the column's alignment. An edited
    table writes a left-aligned column as `---`.
60. Merged cells, a header column, cell colors, and widths of columns are not
    kept: a merged cell is split and its content stays in its first cell, a
    header column is an ordinary column, and colors and widths go.
61. Tab moves to the next cell, and in the last cell adds a row below and
    moves into it. Shift-Tab moves to the cell before. Neither leaves the
    table.

### Nesting

62. A bullet, a numbered, or a check item, and a toggle, hold blocks of any
    kind. No other block holds children.
63. **Tab** nests a block under the block before it when that block may hold
    it, and otherwise does nothing; the keyboard stays in Rich. **Shift-Tab**
    takes a block out of its parent when the blocks after it in the parent
    may become its children, and otherwise does nothing.
64. **Backspace** at the start of a nested block takes it out of its parent
    under the rule of 63; otherwise it deletes the block when it is empty, or
    joins its text to the line above, which for a first child is its
    parent's line. When the block above holds no text, as a picture or a
    table, Backspace selects it, and a second Backspace deletes it.
65. **Shift-Mod-↑ and ↓** move a block past a neighbour that cannot hold it,
    and into one that can, as before.
66. A drag, a paste, a drop, or a change of a block's kind that leaves
    children under a block that may not hold them moves them out after it, in
    their order, in the same step.

### Block boundaries

67. **The file's line breaks stay.** Two blocks that were neighbours when the
    note was read, and still are, keep the line breaks the file has between
    them while both keep their kind. Two blocks that become neighbours, and a
    pair of which one changed its kind, get at least the line breaks
    Markdown needs: one between two items of the same list (same marker
    character and delimiter), a blank line between any other two blocks.
    Rich never removes a line break that the file has between blocks. A pair
    that keeps its line breaks gets a blank line where one line break would
    join the second block to the first. Inside a list item, a list starts on
    the line under the item's text, after a blank line where its first line
    is a lone `-`.
68. A note whose last block changed ends with one line break.

### Keys

69. A key Rich uses does only what Rich does with it: Mod-B, Mod-I, Mod-U,
    Mod-Shift-S, Mod-E, Mod-Alt-0 to 6, Mod-Alt-Q, Mod-Shift-6 to 9, Tab,
    Shift-Tab, Enter, and Mod-Enter run no command of the window with the
    same key. Mod-Shift-S makes strikethrough and nothing else.
70. **Mod-Enter acts on what is at the caret:** it opens or closes a toggle
    whose title holds the caret, checks or unchecks a check item, opens a
    link, and opens Source at the lines of a selected fixed block. Folding by
    Mod-Enter is the view's, as in rule 40.
71. **Typed letters are never lost.** Letters typed after Command-→ (End) at
    the end of a line before a fixed block, after Command-← (Home) at the
    start of a line after one, and after a click just left of a line's text
    go into that line. A letter typed while a fixed block is selected, as
    after → at the end of the line before it, starts a paragraph after the
    block. A key acts at the caret the note shows, also when it arrives on a
    busy page before the page has reported the click that moved the caret.

### Paste and drop

72. A paste keeps of what it brings what the note can store:

    | Pasted | Kept as |
    | --- | --- |
    | underline | underline, except over the whole text of a link |
    | a palette color, in BaseHalf's values, the editor's other palettes, an opaque `rgb()` or `rgba()` of one of them, or its CSS name (`grey` for gray too) | that palette color |
    | any other color, a block's color, an alignment, a file's caption | nothing |
    | a width of a picture or a video | kept from Markdown and from Rich; dropped from other applications |
    | a picture, a video, or a sound within a line of text, from another application | a block of its own, between the line's text before it and after it |
    | `<details>`, open or not | a toggle, stored closed |
    | a relative picture, video, or sound in Markdown | read from the note's folder, its kind by the list of media files |
    | Markdown that Rich cannot edit | a fixed block holding the pasted text |
    | a paragraph that is one link to a file of the note's folder, without formats, at any depth | a file block |
    | a line break in a caption | a space |
    | text that reads as Markdown | Markdown; other text as typed |
    | a table with merged cells, a header column, or cell colors | a table as rule 60 says |
    | a table without a header row | its rows under an empty header row (rule 58) |
    | blocks under a block that may not hold them | as rule 66 says |

73. Command-V, Paste in Rich's menu, and a drop read a paste the same way.
    Paste in Rich's menu takes everything Command-V takes, a picture or a
    file too.
74. Text copied from Source or another code editor of Markdown is read as
    Markdown; code copied from another language stays a code block.

### Copy

75. Command-C, Command-X, and Copy and Cut in Rich's menu put on the
    clipboard, as text, the Markdown that the note would store for the
    selection, and for another application the selection's HTML with the
    palette's values. A copy within one block puts its text with its inline
    formats. A selection in a code block copies its code.
76. A block dragged out of Rich carries the same text.
77. A copied toggle is stored closed where it is pasted.

### Undo

78. A format, a resize, a change of a block's kind, a nest, a move, a paste,
    a drop, and a cut are one step each, together with what Rich adjusts
    after them. The letters typed into one caption, one after another, are
    one step.
79. Undo of the only change of a block puts the file back byte for byte.
80. Reading a note, an outside change, a toggle opened or closed, and what
    Rich adjusts while it reads are never steps.

### The card, Preview, and the card's editor

81. The card, Preview, and a fixed block render with the same rules
    ([note rendering](note-rendering.md), rules 1 to 6): the sound element,
    palette spans, `open` on a toggle, figures, videos from Markdown
    pictures, links resolved by rule 55, and the room around captions and
    toggles.
82. The card's editor edits paragraphs, headings of level 1 to 3, list
    items, and quotes that hold underline or palette colors, and writes them
    in their canonical form. A toggle is one fixed unit there, drawn as at
    rest; its children are edited in Card Detail.
83. A heading inside a closed toggle is not in the outline, and is again when
    the toggle opens ([zoom and outline of a note](note-zoom-and-outline.md),
    rule 9).

### What agents and prompts receive

84. A selection inside a toggle's child is narrowed within that child's
    lines ([the selection agents can see](selection-for-agents.md)).
85. A note in a prompt that is not spoken drops the tags of the HTML
    elements a note shows and keeps their text; Markdown stays
    ([generation cards](generation-cards.md#inputs)). A spoken or sung note
    says no `<audio>`.
86. The agent skill tells agents the canonical forms of rule 12 and to keep
    them as written ([agent skill](agent-skill.md)). A form an agent writes
    another way stays a fixed block and loses nothing.

### Notes written elsewhere

87. Opening a note writes nothing. A note written before this decision, by a
    person or an agent, shows each block by rule 34, and nothing in it is
    rewritten until the user changes a block.
88. An older build of BaseHalf that opens a note written by this one keeps
    every block it does not edit, byte for byte. An edit there drops the
    forms of this specification from that block, as those builds did.

## Limits

- L1. A column written `:--`, left-aligned on purpose, is written `---` once
  a cell of its table is edited: Rich holds no difference between them.
- L2. Spellings outside rule 37 stay fixed blocks, and are edited in Source.
- L3. Inside a list item, an edit writes the item and its nested blocks in
  their canonical form: `_x_` becomes `*x*`, a nested table is padded, a rule
  is `---`. The markers, numbers, indentation, and line breaks of the list
  stay.
- L4. A list of which one item gets a paragraph or a picture under it is a
  loose list in Markdown, and the card and Preview space all its items as
  paragraphs, as Markdown renderers do.
- L5. What Markdown cannot hold shows only until the note opens again: white
  space at the start of a line, white space or a line break at the end of a
  block, a block of white space alone, white space that ends a table cell,
  in code too, an empty paragraph, a run of spaces, and an inline code of
  spaces only. A carriage return and a form feed show as spaces.
- L6. A single line break in an edited block is written with a backslash. The
  card shows both as a line break; a strict Markdown reader of another tool
  shows a single line break as a space, so a hand-wrapped paragraph that is
  edited shows its breaks there, and a quote that another tool reads as a
  callout (`> [!NOTE]`) stops being one.
- L7. A video or a sound in a note plays in the system's controls, whose
  pause cannot fade, until files in notes bring BaseHalf's player there
  (D111). Their names are not stored.
- L8. A file put into a note by a paste or a drop keeps the editor's own
  upload until D111: while it uploads Rich shows an empty block that the
  file does not hold, an undo right after it can show that block again, and
  a failed upload leaves it until the note opens again.
- L9. A paste stores toggles closed, drops colors outside the palette and the
  widths of other applications, and turns the alignment of cells into the
  alignment of their column. Markdown that Rich cannot edit, pasted into the
  middle of a paragraph, lands as a fixed block between its two halves.
- L10. A picture from a web address comes by a paste, by its Markdown, or by
  Replace, not from the slash menu.
- L11. Search and grep do not find a phrase that crosses a `<u>` or a
  `<span>` tag.
- L12. Source shows the escapes of edited text: `\*`, `\_`, `&lt;`, `&#58;`.
- L13. Folding is lost when the note opens again, and for the toggles that an
  outside change replaces when the number of toggles there changes.
- L14. A toggle's title is one line of text with formats. A `<details>` of
  more than 50,000 characters or 2,000 blocks is read as parts.
- L15. A numbered item added in the middle of a list leaves the numbers of
  the items after it in the file as they were; every renderer numbers by
  place, so what shows is the same.
- L16. Definitions of reference links and footnotes show nothing in Rich, as
  on the card. A reference link is written as an inline link once its block
  is edited; its definition then stays in the file, perhaps unused.
- L17. Tools with a light theme show the stored backgrounds dark, and tools
  that drop `style` show palette colors as plain text.
- L18. Find in Rich does not find the text of a closed toggle; find in
  Preview opens it.
- L19. A tab in a code block that the indentation of its list item ends
  inside becomes spaces.
- L20. A paragraph that is one link to a file of the note's folder, and
  nothing else, opens again as a file block: the note stores both the same
  way.

## Failure and recovery

| What fails | What happens |
| --- | --- |
| Rich's writer cannot write a block | the block is written by the editor's own writer, which keeps its words and drops formats, else as its plain text; the rest of the note is saved as usual; a quiet banner says "Some formatting in this note could not be saved. Its text is saved.", the block is outlined, and the log has the block |
| reading a block throws at load, at an outside change, or in a paste | that block is a fixed block |
| the open flags of the toggles of a block do not match its toggles | no flag is used, and the block is fixed |
| a `<details>` that is never closed, closed inside a line, too long, or not readable as a toggle | its parts are read as before (rule 42) |
| what Rich adjusts after a change throws | the change stands as it was made, and the log has it |
| no form of a block's text reads back the same | the text is written with every Markdown character escaped and each code as `<code>`, and the log has it |
| a link leads nowhere | nothing happens |
| a file chosen from the slash menu cannot be added | "Could not add" and its name for 3 s, and nothing is added |

The banner goes with the next save that writes every block by the rules of
this specification. Outside changes are merged meanwhile, as always.

## Acceptance criteria

1. In the real window, for each row of the table of rule 12: applied through
   Rich's controls, the note's file holds exactly the stored form within 1 s;
   after Card Detail closes and the note opens again, with new block ids,
   Rich shows the same blocks and formats, and the file has not changed.
2. Every note of the fidelity corpus, opened in Rich and saved without an
   edit, keeps every byte. One letter typed at the marked place of each
   note changes the file by that letter and by the canonical form of that
   block alone.
3. Underline, red, and a yellow background on `word` of
   `**important word here**` store
   `**important <span style="color:#e8706b;background-color:#4a401d;"><u>word</u></span> here**`.
   One undo takes back the last format, and the file then holds the bytes it
   held before it.
4. With a text selection, a picture, a video, a sound, a file, and a table
   cell selected in turn, and with the menu of a drag handle open, Rich shows
   0 alignment, Nest, Unnest, Toggle preview, comment, merge, Colors, and
   header controls, and no caption control for a file.
5. Tab in a paragraph after a paragraph leaves the document and the file as
   they were and the keyboard in the editor; Tab in a bullet after a bullet
   nests it; Tab in a table's last cell adds a row, and the file has that
   row; Shift-Tab in a paragraph at the top keeps the keyboard in the editor.
6. A toggle list made from the slash menu, with a title and a child, stores
   the form of rule 39; it opens closed with its child after the note opens
   again. Folding it adds no step of undo and leaves the file's modification
   time unchanged for 2 s.
7. `<details open>` shows open in Rich, on the card, and in Preview.
8. Backspace at the start of the paragraph after a closed toggle opens the
   toggle, and the joined text shows. Enter at the end of an open toggle's
   title adds an empty first child; at the end of a closed toggle's title
   that has children it adds a block after the toggle, and the children stay.
9. Two toggles on adjacent lines show as two toggles. Editing one child of a
   toggle of three children changes only that child's lines in the file.
10. A picture resized to 300 pixels stores `width="300"`. At a magnification
    of 200%, the dragged edge stays within 1 pixel of the pointer in every
    frame of the drag.
11. A video, a sound, and an `.ogg` file chosen from the slash menu store
    `<video …>`, `<audio …>`, and `<audio …>`, and show a video, a sound, and
    a sound after the note opens again. Cancel in the chooser leaves the
    document and the file as they were. One undo after an upload removes the
    block, and the file holds no trace of it.
12. `![clip](clip.mp4)` written by hand shows a video, and
    `<audio src="sound.mp3" controls></audio>` a sound player, in Rich, on
    the card, and in Preview.
13. `[[` on `my file.md` stores `[my file.md](my%20file.md)`, which is a link
    after the note opens again. Command-click on it in Rich, a click on the
    card, and a click in Preview each open Card Detail of `my file.md` within
    1 s, and no dialog shows. `https://example.com` opens the browser from
    each. A link to a missing file does nothing.
14. A click on `[Setup](#setup)` in Rich and in Preview scrolls the heading
    "Setup" to 24 pixels below the top of the view within 1 s, and opens a
    closed toggle around it.
15. No link on the card, in Preview, or in a fixed block has a `title`.
16. A table with `:-:` keeps `:-:` after a cell is edited. A table made from
    the slash menu has its first row as its header after the note opens
    again.
17. A paste of HTML holding a centered red paragraph, a merged table with
    colored cells, a `#123456` span, a picture with `width`, and three
    underlined links stores what the table of rule 72 says.
18. Command-C of underlined, red, and toggled text puts on the clipboard, as
    text, the forms of rule 12.
19. A block moved from second last to last keeps a blank line before it, and
    the note opens again with the same blocks; every other byte stays.
20. Letters typed after Command-→ at the end of a line before a fixed block,
    after Command-← at the start of a line after one, after → before one,
    and after a click 3 pixels left of a line's first letter are saved, in
    each of 10 tries of each. → pressed while the page is busy, after the
    caret was put at the end of the line before a fixed block, selects that
    block, and a letter then starts a paragraph after it.
21. A red word is drawn rgb(232, 112, 107) in Rich, on the card, and in
    Preview, with the system in light and in dark appearance.
22. On a note of 2,000 blocks (about 200 KB: paragraphs with formats, lists,
    50 toggles, 20 tables, 50 pictures), with 50 letters typed into one
    paragraph: the work of a save takes at most 16 ms at the 95th
    percentile, the adjusting after a key at most 1 ms at the 95th
    percentile, the first full write at most 150 ms, and the load at most
    10% longer than before this decision on the same machine.
23. On the card's editor, a paragraph with `<u>` and a palette span can be
    typed into, and keeps its tags; a toggle is one unit drawn closed, and a
    double click on it opens Card Detail.
24. A heading inside a closed toggle has no tick in the outline; opening the
    toggle adds it within one frame.
25. A fixed block holding a palette span shows its color in Rich as on the
    card.
26. Mod-Shift-S makes strikethrough, Mod-B bold, and Mod-Alt-0 a paragraph,
    and for none of them does the window run a command: Save As does not
    run, and the sidebar stays as it was.
27. Paste in Rich's menu inserts a copied picture as Command-V does, and a
    copied fixed block as a fixed block.
28. Mod-Enter in a toggle's title opens and then closes it; on a check item
    it checks it; in a link it opens it.
29. On the notes of the fidelity corpus and of `docs/`, no kind of block that
    Rich edited before this decision is fixed after it in more than 1% of its
    blocks, except the kinds that L2 lists.

## Verification

- Unit tests in Node: the inline writer and its check, the block writer,
  escapes and addresses, the shown signature, the palette, the media kind,
  the nesting rules, the link resolver, and the projection with its toggles,
  boundaries, hints, and failures (`basehalfNoteInline.test.ts`,
  `basehalfNoteWriter.test.ts`, `basehalfNoteMarkdownText.test.ts`,
  `basehalfNoteMarkdownHtml.test.ts`,
  `basehalfNoteShown.test.ts`, `basehalfNotePalette.test.ts`,
  `basehalfNoteMediaKind.test.ts`, `basehalfNoteStructure.test.ts`,
  `basehalfNoteLinks.test.ts`, `basehalfMarkdownProjection.test.ts`,
  `basehalfMarkdownMerge.test.ts`, `basehalfMarkdownBlockLines.test.ts`)
  cover rules 10 to 24, 26 to 37, 41 to 43, 53, 55, 56, 58 to 60, 62, 67, and
  68, and criteria 2, 3, 9, and 29 in part.
- The bundle test of Rich (`npm run basehalf:test-markdown-rich-formats`)
  runs Rich's real reader, writer, schema, paste, copy, undo, and toggle
  state in a headless browser: rules 1 to 8, 25, 28, 40, 44, 45, 49, 61 to
  66, 69, 70, 72 to 80, and criteria 3, 5, 6, 8, 10, 17, 18, 22 (on a note of
  about 2,000 blocks, its numbers logged), 27, and 28.
- Unit tests in the window of the test runner: the repair of the HTML Rich
  reads (`basehalfNoteHtmlRepair.test.ts`), the card's and Preview's
  rendering of audio, spans, `open`, videos, links, and titles
  (`basehalfNoteRenderOptions.test.ts`,
  `basehalfCanvasMarkdownInlineEditor.test.ts`,
  `basehalfMarkdownPreviewCardDetail.test.ts`, `basehalfCanvasNoteParts.test.ts`),
  the outline (`basehalfNoteOutline.test.ts`): rules 16, 23, 25, 26, 31, 47,
  53 to 57, 81, 83, and criteria 7, 12, 15, 24, and 25.
- The card's editor's own test (`npm run basehalf:test-canvas-markdown-inline`)
  covers rule 82 and criterion 23.
- The `cardDetail` suite of the smoke runs criteria 1, 3 to 6, 8 to 11, 13,
  14, 16 to 20, 21 in Rich, and 26 to 28 in the real window, each on a note
  of its own, read from the disk after Card Detail opens it again; the
  `canvas` suite criteria 12 and 13 on the card.
- `npm run basehalf:fidelity` covers criterion 2 with the corpus files
  `note-formats.md` and `boundaries.md` and the pass that types one letter.
- In the real window, by hand, recorded with numbers: criterion 21 on the
  card and in Preview in both appearances, criterion 22, the clicks on a
  summary, a video, and a sound on a resting card, a web link of criterion
  13, which opens the system's browser that a smoke run leaves alone, a
  paste from a browser page, a copy pasted into Source, and the keys of rule
  69.
- The count of criterion 29 is a script run before each change of the
  reader or the guard.
