# PDFs and books

Status: Active (2026-10-25; a pinch zooms a PDF and a book, 2026-10-27; the cover is the card, 2026-11-13; one reader of BaseHalf's own with comments, 2026-11-16; Find at the top right and the Comments panel at the right, 2026-11-17; Find matches what a person means and leaves an input method alone, 2026-11-17)
Decision: [D81](../decisions.md), [D135](../decisions.md#d135--comments-mark-passages-of-pdfs-books-and-notes-and-the-reader-of-a-pdf-is-basehalfs-own-new-2026-11-16), [D87](../decisions.md#d87--a-pinch-zooms-a-note-in-card-detail-and-its-left-margin-shows-its-outline-new-2026-10-27), [D133](../decisions.md#d133--the-cover-of-a-pdf-or-a-book-is-its-card-new-2026-11-13)
Related: [canvas card placement](canvas-card-placement.md) (the size of a
card), [canvas card resize](canvas-card-resize.md#which-cards-resize),
[opening and closing Card Detail](card-detail-opening.md),
[comments](comments.md) (what the readers mark and keep beside a document),
[layout controls](layout-controls.md#card-detail) (the header of Card Detail),
[the selection agents can see](selection-for-agents.md),
[agent skill](agent-skill.md), [reference graph](reference-graph.md) (the
upstream list of a grown note),
[workspace state](workspace-state-and-legacy-cleanup.md) (`appearance.yaml`),
[dependency policy](../dependency-policy.md),
[architecture invariants](../harness/architecture-invariants.md) (product
shell)

## The rule

**A PDF or a book is a card that shows its cover, at one size, and opens to
be read.** The cover is the first page of a PDF and the cover picture of a
book. A button at the card's top right corner hides it, and the card then
shows the grey face of a file card. A book opens in Card Detail as a PDF
does: to read it, to grow a note from a passage, and to let an agent see the
passage the user selected. Both open in one reader of BaseHalf's own, whose
only bar is the header of Card Detail, with its zoom at the bottom left as
the canvas has it, Find at the top right, and the
[highlights and comments](comments.md) at the right.

## Problem

Measured on 2026-10-25 in a development window of main `1d0c13e50`:

- The card of a PDF showed a small glyph and "PDF document" in the middle of
  an empty card. In the user's own workspace the card had been stretched by
  hand to the shape of a page.
- An EPUB, a MOBI, and an AZW3 file showed "Binary file", and BaseHalf had
  nothing to open them with.
- The PDF reader opened at the width of Card Detail: 186 % on a window 1440
  pixels wide with the Agent Area hidden, so that a page needed two screens.
- Text selected in a PDF was not what an agent could see: the record named
  the PDF's card. "Explain this" told the agent nothing about the passage.

Measured on 2026-11-16 on main `273d6bedf`, in the user's window: the PDF
reader showed the toolbar of the library it was built on under the header of
Card Detail, two bars where one holds what is needed. The toolbar held a menu
whose items BaseHalf had turned off, a hand and a pointer tool that select
nothing a scroll and a press do not, page settings, and the zoom between
them. The book reader had bars of its own at its top and its bottom, with
the same words in other places. Selecting text offered Copy and Grow branch
in a PDF, and Grow branch alone in a book.

Measured on 2026-11-17 on the branch of D135: the search field stood at the
top of the panel at the left, and its matches in a list in place of the
tabs, so that going from one match to the next took the panel and a click
on each; and the Comments list was a tab of that panel, beside the pictures
of the pages.

People learn from material that is mostly PDF, and a hard book is often an
e-book file. They import it into a folder and read it there, with the notes
they grow from it beside it and an agent in the Agent Area.

## Goals

- A canvas of sources shows what each source looks like.
- These cards have one size, which the user does not change. Each card can
  hide its cover, and is then grey. A document that comes in shows its cover.
- A book in a common e-book format opens in Card Detail and reads well:
  pages, its contents, search, the size of its text, and the place where the
  user stopped.
- What works for a PDF works for a book: Grow Branch, comments, and agents
  seeing the selected passage.
- One reader for both, with one bar, and controls where the rest of
  BaseHalf has them.
- Making a cover writes nothing into the workspace.

## Non-goals

- Making a PDF or a book. No menu of the canvas creates one. A document
  comes in as every file does: dropped on the canvas or into Files, copied
  into the folder, or written by an agent.
- Changing a document: no highlights, annotations, forms, or edits are
  written into it. Both readers show a document as it is; the user's
  highlights and comments are kept beside it ([comments](comments.md)), and
  what the user takes from it goes into notes grown from it.
- Printing, saving a copy, rotating pages, and showing two pages side by
  side.
- DjVu, CBR, and KFX files, and books with DRM. DjVu and RAR have no
  library under a license BaseHalf takes, and a book with DRM cannot be read
  without its key. Such files stay as the other files are; a book with DRM
  opens to a page that says why it does not read.
- Reading aloud, dictionaries, and translation.
- Searching inside documents from the sidebar's Search.
- The size of a card that the user chose for a PDF before this change: the
  card takes the size of a document card.

## Terms

- **PDF**: a file whose name ends in `.pdf`.
- **Book**: a file whose name ends in `.epub`, `.mobi`, `.azw3`, `.azw`,
  `.fb2`, `.fbz`, or `.cbz`.
- Both without regard to case.
- **Document**: a PDF or a book.
- **Cover**: the picture of a document. For a PDF it is its first page. For
  a book it is the picture its file names as its cover; for a comic book
  archive, its first picture in natural name order, in which `2.jpg` comes
  before `10.jpg`.
- **Grey face**: what the card of a file without a picture shows: the
  glyph of its kind above a short line, on the card's own surface.
- **Book reader**: the page of Card Detail that shows a book.

## The formats

| Format | Names | Cover |
| --- | --- | --- |
| PDF | `.pdf` | the first page |
| EPUB 2 and 3 | `.epub` | the manifest's item with the property `cover-image`; otherwise the item that `<meta name="cover">` names; otherwise the first picture of the page that the guide names as the cover; otherwise a picture of the manifest whose id or name holds "cover" |
| Kindle (Mobipocket and KF8) | `.mobi`, `.azw3`, `.azw` | the picture the book's header names as the cover, otherwise as the thumbnail |
| FictionBook | `.fb2`, `.fbz` | the picture of the book's `coverpage` |
| Comic book archive | `.cbz` | the first picture in natural name order, leaving out the hidden files of the system that packed it |

A book has DRM when its file says it is encrypted: a Kindle book whose
header names an encryption, and an EPUB whose `META-INF/encryption.xml`
encrypts more than its fonts (the obfuscation of fonts that EPUB defines
is no DRM). An `.azw` file of the older Topaz kind and a KFX file are no
format BaseHalf reads; their card shows the grey face, and Card Detail
says that the book could not be opened.

The kinds are one list with the images, sounds, and videos
(`platform/protocol/common/basehalfMediaFiles.ts`): the card and Card Detail
show the same files ([architecture invariants](../harness/architecture-invariants.md#product-shell)).

## Required behavior

### The card

1. The card of a document is 300 × 400. It is a card of a picture whose
   shape is always 3:4, so it follows the rules of the card of a picture
   ([canvas card placement](canvas-card-placement.md#the-card-of-an-image-or-a-video-has-its-pictures-shape)):
   it appears at 300 × 400, and where it is, it is that size when the room
   at its top left corner allows, and otherwise the largest 3:4 size that
   keeps the gaps of the grid, as for a card that was made before this
   rule. The user does not resize it: it has no resize corners or sides
   ([canvas card resize](canvas-card-resize.md#which-cards-resize)).
2. **The cover is the card** (D133). With its cover shown, the card is its
   cover: the cover fills the card to its edges and takes the card's rounded
   corners, with no surface, frame, or shadow around it. A cover whose shape
   is near 3:4 is cut to the card's shape, as long as no more than 12% of its
   width or its height is left out: the pages of most PDFs (A4 loses 6% of
   its height, Letter 3% of its width) and the covers of most books (2:3
   loses 11% of its width). A cover of another shape, such as a page of
   slides, is shown whole in the middle of the card, and the card's surface
   fills the rest. A document that comes in shows its cover.
3. Before its cover can be drawn, the card shows its surface and nothing
   else. A cover that was drawn once on this computer is drawn at once.
   **The cover stays.** In every frame in which the file does not change,
   the card keeps the cover it shows: when it is selected or deselected, when
   Card Detail opens over it and closes, and when the canvas is drawn again.
   Measured before (2026-11-13): selecting the card drew its cover again, and
   the card showed its bare surface for 5 ms in an idle window and for four
   frames of the launch film, just before Card Detail opened.
4. With its cover hidden, the card shows the grey face: the glyph of its
   kind and "PDF document", "EPUB book", "Kindle book", "FictionBook", or
   "Comic book".
5. A document without a cover that can be drawn shows the grey face too:
   a PDF that is locked with a password or damaged, a book with DRM, a book
   whose file names no picture, and a PDF over 512 MB. A book without a
   cover picture shows its title above the line, when its file names one.
6. The caption shows the glyph of a PDF or of a book, and the file's name
   ([canvas card name](canvas-card-name.md)).
7. A double click opens the document in Card Detail, as before.

### Hiding and showing the cover

8. The caption of a document's card has a button at its right end, before
   the badge toggle. It shows an eye while the cover is shown and a closed
   eye while it is hidden. Its hover says "Hide Cover" or "Show Cover". It
   has the look of the badge toggle beside it.
9. A click on it hides or shows the cover at once. The card keeps its place
   and its size, its selection does not change, and nothing else of the
   canvas is drawn again. A drawing of the canvas that read the cards'
   appearance while the choice was being written keeps what the card
   shows, as it does for the background of a note, so the cover never comes
   back for a moment; the drawing after the write reads the choice.
10. The choice is the card's. It is kept in
    `.bh/mirror/<path>/appearance.yaml` as `cover: hidden` or
    `cover: shown`, which travels with the folder and follows the item when
    it is moved ([following moved items](following-moved-items.md)). Without
    the file the cover is shown.

### How a cover is made

11. The window makes a cover the first time a card asks for it, and again
    when the file changes: another time or another size.
    - A PDF's first page is drawn 800 pixels wide on white, with its
      annotations, in a worker of the window, by the PDFium that the PDF
      reader uses. Text whose font the file does not hold is drawn with the
      reader's fallback fonts. The worker reads the PDF itself, through the
      window's file protocol, so that its bytes never pass through the
      thread that draws the window; a PDF that is not a file on this
      computer is read for it.
    - For a book, BaseHalf reads only the parts of the file that name the
      cover and hold its picture, and makes the picture at most 800 pixels
      wide. It reads the title and the authors from the same parts.
12. Covers are kept in the application's own data folder, in
    `CachedCovers`, one entry for each path, never in the workspace. Showing
    a document writes nothing that git shows and nothing under `.bh/`.
13. At most two covers are made at a time. A cover that cannot be made is
    not tried again until the file changes; the reason goes to the log and
    to no message.
14. The worker that draws PDFs starts with the first PDF cover the window
    needs and ends after it was not used for 30 s.

### The reader

The PDF reader and the book reader are one reader: the same bar, the same
panels, the same Find, the same controls at the bottom left, the same
selection menu, and the same [highlights and comments](comments.md). What
differs is what a PDF and a book are: a PDF has pages and a zoom, a book has
text that flows and a size of text.

15. **One bar.** The header of Card Detail is the reader's only bar
    ([layout controls](layout-controls.md#card-detail)). At its left end,
    before the name, **Sidebar** opens and closes the panel at the left; its
    hover says "Show Sidebar" or "Hide Sidebar". In its right group, before
    Close, **Find** shows the find bar, and **Comments** opens and closes the
    Comments panel at the right; its hover says "Show Comments" or "Hide
    Comments". For a book, the header shows the title of the chapter after
    the name, in the color of the header's other words. The reader draws no
    bar of its own.
16. **What is not there.** No hand and no pointer: a two-finger scroll or the
    wheel moves the pages, and a press in text selects. No menu of the
    library the reader is built on, no page settings, no two pages side by
    side, no turned pages, and no scrolling to the side page by page: a PDF
    is one column of pages, top to bottom.

#### The panels

17. The panel at the left takes the reader somewhere; the Comments panel at
    the right shows what the user marked in what the reader shows. Each
    stands beside the document when the reader is at least 900 px wide, and
    over it otherwise, where it closes once it took the reader somewhere.
    - **The panel** stands at the left, 260 px wide. It has the tabs
      **Pages** and **Contents** for a PDF, and **Contents** for a book; a
      PDF without an outline has Pages alone. A panel with one tab shows no
      tabs.
      - **Pages**: a picture of each page, the page shown marked. A click
        goes to the page.
      - **Contents**: the outline of a PDF or the table of contents of a
        book, the entry shown marked; a click goes there. A book without a
        table of contents shows its sections by their order. A comic book's
        pages are its pictures in natural name order, each listed by its file
        name without the extension, and the hidden files of the system that
        packed it are no pages.
    - **The Comments panel** stands at the right, 280 px wide, and lists the
      document's highlights and comments
      ([comments](comments.md#the-comments-panel)).
18. Whether each panel is open, and the tab of the panel at the left, are
    kept on this computer for PDFs and for books apart, and a document opens
    with the panels as they were when the last one of its kind closed.
19. **Find.** Find in the header, or Cmd+F, shows the find bar at the top
    right of the document, under the header and left of the Comments panel,
    with the cursor in its field and all of it selected. With text selected
    in the document, on one line and at most 200 characters, Find and Cmd+F
    put that text into the field and search for it at once, as the editor's
    Find does. The bar holds the field, the count, **Previous Match**, **Next
    Match**, and **Close**.
    - Typing searches the whole document 250 ms after the last key. While an
      input method composes, as for Chinese, nothing is searched: the search
      starts 250 ms after the composed text is committed.
    - Every match is marked in the pages in the color of a match of Find,
      and the reader goes to the first match at or after the top of what it
      shows, round to the first of the document, which is marked more
      strongly. It scrolls only when that match is out of sight or under the
      find bar, and then puts it a little above the middle.
    - The words match text whatever its case, its accents (`cafe` finds
      `café`), its full-width or half-width forms (`2026` finds `２０２６`),
      and its curly or straight quotation marks; runs of white space match
      one space. In a PDF, letters made into one glyph match their letters, a
      word that a hyphen broke over two lines matches whole (`compile` finds
      `com-` and `pile`), a phrase matches across a line break, and a line
      break inside Chinese or Japanese text is nothing.
    - The count says "3 of 27", or "No results". While a long document is
      still searched, a thin line at the foot of the bar grows with the part
      searched, and the count shows once the place of the match shown among
      all of them is known.
    - Enter, Next Match, and Cmd+G go to the next match, and Shift+Enter,
      Previous Match, and Shift+Cmd+G to the one before, round from the last
      to the first. Cmd+G and Shift+Cmd+G work with the keyboard in the
      document too, while the bar shows.
    - Emptying the field takes the marks away. Escape in the bar, or Close,
      takes them away and hides the bar; Find again shows the bar with the
      words it held.
    - A new search ends the one before. A PDF's text is read once, the first
      time it is searched, and later searches use it.
    - Measured before (2026-11-17), on a paper of 14 pages: `performance`
      found 23 of its 28 places and `alternative` 2 of 3, missing every
      word a hyphen broke at a line's end; `2026`, `don't`, `naive`, and
      `cafe` found nothing in a PDF that holds `２０２６`, `don’t`, `naïve`,
      and `café`; pinyin was searched while the input method still composed
      it, which showed "No results"; and the count read "? of 60" while
      pages were searched.

#### At the bottom left

20. Two controls stand over the document at its bottom left, 14 px from the
    left and 16 px from the bottom, as the zoom of the canvas does, on a
    small surface of the editor's widget color so that they read over a
    page:
    - for a PDF, the **page**, "3 / 9", and the **zoom**, "95%";
    - for a book, the **place**, "34%", and **Aa**, the size of the text.
21. **The page.** A click makes the page number editable where it stands,
    with all of it selected. Enter goes to the page typed; Escape, or a
    click outside, leaves it as it was. A number out of range goes to the
    first or the last page.
22. **The zoom.** A click opens the zoom menu above the control, as the
    canvas's: a field with the percentage, from 25 % to 500 %; **Zoom In**
    (Cmd+=), **Zoom Out** (Cmd+-), **Fit Width**, and **Fit Page**; then
    **Zoom to 50%**, **Zoom to 100%** (Cmd+0), and **Zoom to 200%**. The keys
    zoom the PDF with the menu closed too, wherever the keyboard is in the
    reader, and never the window. Measured before (2026-11-17): Cmd+= zoomed
    the PDF from 190 % to 205 % and the window to 120 %, since the page hands
    every key to the window too.
23. **The place.** A click opens a slider above the control, from the start
    of the book to its end, at the place shown; moving it shows the
    percentage, and letting go goes there.
24. **Aa.** A click opens a menu above the control: **Larger Text** (Cmd+=),
    **Smaller Text** (Cmd+-), **Pages**, and **One Scroll**, the one in use
    checked. The keys change the text and never zoom the window. A comic book
    and a book with a fixed layout have no Aa.

#### The selection menu

25. Selecting text in a PDF or a book shows a menu just above the
    selection's first line, or below its last line when there is no room
    above: **Highlight**, **Comment**, **Grow branch**, and **Copy**
    ([comments](comments.md#making-a-comment)). It shows once the selection
    has stopped changing for 30 ms and no button is pressed, moves with the
    selection when the document scrolls, and goes when the selection ends.
    Copy puts the selected text on the clipboard; Cmd+C does too.

#### The keyboard

26. The reader takes the keyboard when Card Detail is drawn. Escape closes,
    one at a time and in this order: a menu, a comment note or the tools of
    a highlight, the find bar, the selection, a panel while it stands over
    the document, and then Card Detail. Cmd+F shows the find bar.

### The PDF reader

27. A PDF opens at the width of Card Detail, but at most 125 %, as long as
    the user has not zoomed this PDF. The width follows Card Detail when it
    changes. Once the user zooms, the PDF opens at the zoom and the page
    where the user was, as before. The pages keep 30 px from the sides of
    the reader at its width, the room where the marks of comments stand
    outside the page ([comments](comments.md#on-the-page), rule 7), and
    the reader's scroll bar stands at its right edge. Measured before
    (2026-11-17): the scrolling area was 32 px wider than the reader, so
    that a page at the width of Card Detail ran 16 px past its right edge,
    under the edge with the scroll bar.
28. **The PDF shows itself drawn.** The reader shows itself, its controls and
    its pages at once, in the frame in which the page it opens at has its
    picture: until then Card Detail shows its background. No frame shows a
    page without its picture, which was a white page, or a page at another
    zoom. When a PDF takes longer than a second to show itself, the place of
    a page and "Opening PDF..." fade in until it does. Measured before
    (2026-11-13): after the fade of Card Detail, a grey page with "Opening
    PDF...", then the toolbar over an empty page, then a white page for
    about 80 ms, then the cover.
29. A pinch of the trackpad zooms the PDF around the fingers, as the wheel
    with Ctrl held does inside it, and the zoom is the user's. The browser
    gives a pinch to the window, never to the page of the PDF, so the window
    takes it and hands it to the page
    ([zoom and outline of a note](note-zoom-and-outline.md), D87). The
    pages are magnified while the fingers move and take the new zoom when
    they rest, as a pinch of a note does, so what is under the fingers stays
    under them in every frame. A notch of the wheel with Ctrl held is one
    step of Card Detail's zoom. Measured before (2026-11-17): a zoom asked
    once a frame started from a scroll that the step before had not reached,
    and a pinch over page 9 ended on page 7.
30. **Links.** A link to a place in the PDF goes there. A link to the web
    opens in the browser, after the question that every link to a website
    asks. Other links do nothing.
31. **Locked and damaged.** A PDF that a password locks asks for it in place
    of the PDF, with a field and **Open** and **Cancel**: a wrong password is
    said so under the field, and the field asks again; Cancel closes Card
    Detail. BaseHalf keeps no password: the PDF asks each time it opens. Any
    other PDF that does not open shows "BaseHalf could not open this PDF." in
    its place, and the reason goes to the log.
32. The reader is BaseHalf's own, on the engine and the parts of the library
    that draw the covers (EmbedPDF, on PDFium), without the library's own
    screens.

### The book reader

33. A book opens in Card Detail at the place where the user was, or at its
    start. While it opens, the page shows a quiet placeholder, as a PDF's
    does. Card Detail fades in first and the book draws itself after the
    transition ([opening and closing Card Detail](card-detail-opening.md)).
34. **Layout.** The book in the middle, in one column, or in two when the
    reader is wide enough, with the [panels](#the-panels) at its left and
    its right and the place and Aa at its bottom left.
35. **Turning pages.** The Left and Right arrow keys, Page Up and Page Down,
    Space and Shift+Space, and a click in the outer fifth of the page at
    either side, where a chevron shows while the pointer is there. A book
    that reads from right to left turns the other way. In one scroll, the
    wheel and the keys scroll.
36. **Text.** Larger Text and Smaller Text change the size of the text in
    steps, from 70 % to 200 %, and the choice of pages or one scroll is
    kept. A pinch of the trackpad changes the text by one step each time
    the fingers have spread or closed by as much as that step, as Larger
    Text and Smaller Text do. Both are the user's for every book on this
    computer. They do not apply to a comic book or to a book with a fixed
    layout, whose pages are pictures.
37. **Colors.** The pages take the colors of the workbench's editor, light
    or dark, and follow a change of the theme. Pictures keep theirs.
38. **The place.** Where the user is in a book is kept for that book in the
    workspace's storage on this computer, and the book opens there again.
39. **Links.** A link inside the book goes to its place in the book. A link
    to the web opens in the browser, after the question that every link to
    a website asks. Other links do nothing.
40. **What it cannot open.** A book with DRM shows "BaseHalf can't open
    this book: it is protected with DRM." Any other file that does not open
    shows "BaseHalf could not open this book." Both stay in place of the
    book; the reason goes to the log.
41. **What a book may not do.** Scripts in a book never run, and a book
    loads nothing from the network: no page, picture, font, or style. What
    a book holds is shown from the file itself.

### Grow branch from a book

42. Grow branch makes a note from the selected passage as it does for a PDF
    ([reference graph](reference-graph.md#creating-connected-nodes)): next
    to the book's card, named after the book with `-note`, its title the
    passage's first sentence, the passage quoted, and a line
    `Source: [<book>](./<book>), <chapter>`. Its first bytes list the book
    in `upstream`, so the note is connected from the book when it appears.
    Without a chapter the line ends after the link.

### What agents can see

43. Text selected in a PDF or a book is what agents can see
    ([the selection agents can see](selection-for-agents.md)), as text
    selected in a note is: `selected: "text"`, `path` the document, and
    `text`. For a PDF the record adds `first_page` and `last_page`, the
    pages the selection begins and ends on, counted from 1. For a book it
    adds `chapter`, the entry of the contents that the selection begins in,
    when the book has one. The status bar shows the start of the text.
44. The record follows 30 ms after the selection stops changing. When the
    selection ends, it is the document's card again. Text longer than 10,000
    characters is cut there, as for a note.
45. The skill describes the two new fields, and its version becomes 10
    (D78 made it 9 the same day).
46. While a comment note is open, the record names the comment
    ([comments](comments.md#agents)).

## Limits

- A cover is 800 pixels wide. On a card zoomed to more than 150 % on a
  retina screen it is less sharp than the page in Card Detail.
- Find in a long book takes seconds, and a new search ends the one before.
  A book's text is searched as the library it is read with searches it:
  its curly quotation marks are not its straight ones, and a word is not
  matched across two blocks of text.
- The first Find in a PDF reads the text of every page. Measured
  (2026-11-18) in the development window, on a PDF of 700 pages at a load
  of about 5: from page 300, `compile` marked its first match on that page
  0.2 s after the last key and counted 4,050 matches 2.5 s after it, with
  no frame over 50 ms; `trace` then counted its 20,800 within 0.2 s.
- A phrase is not found across the end of a PDF's page.
- Text that a book sets in absolute sizes does not follow Smaller Text and
  Larger Text.
- A PDF over 512 MB has no cover, so that a cover never needs half a
  gigabyte of memory. Card Detail still opens it.
- A FictionBook over 64 MB has no cover: its picture is inside its text,
  which has to be read whole. For an `.fbz` the limit is the size of the
  FictionBook inside it.
- A cover picture over 20 MB is not read, and the book shows its grey face,
  as one without a cover does.

## Acceptance criteria

1. In a folder with a PDF and one book of each format, every card is
   300 × 400 and shows its cover. A selected card shows no resize corner.
2. A PDF card that was 300 × 220 in the old grid, with a card 60 below it,
   is the largest 3:4 card that keeps the gaps, and covers nothing.
3. Hide Cover on a PDF's card shows "PDF document" on the grey face in the
   same frame size, writes `cover: hidden` into its `appearance.yaml`, and
   after a reload the card is still grey. Show Cover brings the page back.
4. A PDF renamed outside BaseHalf keeps a hidden cover hidden.
5. Showing a folder with documents changes nothing in the workspace: the
   files under `.bh/` and what git shows are the same before and after.
6. A PDF with a landscape first page shows the whole page in the middle of
   the card.
7. A password-locked PDF, a damaged PDF, an EPUB without a cover, and a
   MOBI with DRM show the grey face, and the EPUB its title.
8. Each book opens in Card Detail: pages turn with the keys and the side of
   the page; Contents in the panel goes to a chapter; Find goes to a match
   and Enter to the next; Larger Text in the Aa menu makes the text larger;
   Escape closes Card Detail.
9. Closing a book on page N and opening it again shows page N.
10. A book whose page holds a script and an image from the web runs no
    script and requests nothing from the network.
11. Grow branch on a passage of an EPUB makes `<book>-note.md` beside its
    card, with `upstream` naming the book in its first bytes and the
    chapter in its `Source:` line.
12. Selecting text in a PDF records `selected: "text"` with the PDF, its
    pages, and the text; selecting text in an EPUB records its chapter;
    clicking into empty page records the card again.
13. A PDF opens at most at 125 % on a wide Card Detail and fills a narrow
    one; after Zoom In it opens at that zoom again.
14. While twenty documents appear in view at once, among them PDFs of
    76 MB and EPUBs of 25 MB, no frame of the window takes longer than
    34 ms until every cover is drawn. A PDF of 76 MB and 1,307 pages opens
    in Card Detail the same way.
15. A PDF that a password locks asks for the password in Card Detail: a
    wrong one is said so, the right one opens the PDF, and Cancel closes
    Card Detail. A damaged PDF shows "BaseHalf could not open this PDF."
16. A cover of 3:4 fills its card to the card's edges, and a landscape first
    page is whole in the middle of the card (D133).
17. Selecting the card of a PDF keeps its element and its cover in every
    frame.
18. Opening a PDF, no frame of Card Detail shows a white page, a page
    without its picture, or "Opening PDF..." when the PDF shows itself
    within a second: the reader shows its controls and the page it opens at
    in the same frame.
19. With a PDF open, Card Detail shows one bar, its header, with Sidebar
    before the name and Find and Comments before Close, and no other bar;
    the reader has no hand, pointer, menu, or page settings.
20. The page and the zoom stand at the bottom left, 14 px from the left and
    16 px from the bottom of the reader. Zoom In from the zoom menu and
    Cmd+= zoom the PDF by the same step, and the window keeps its zoom;
    typing 7 into the page goes to page 7.
21. Sidebar opens the panel with Pages and Contents for a PDF with an
    outline, and with Contents and no tabs for a book; a click on a page's
    picture goes to it; after Card Detail closes and another PDF opens, the
    panel is open at the same tab. Comments opens the Comments panel at the
    right, and it is open again in the next PDF.
22. Find with a word of a PDF marks its matches, says "1 of N", and shows the
    first at or after the page shown; Enter goes to the next and Shift+Enter
    back; Escape takes the marks away and hides the bar.
23. Selecting text in a PDF and in a book shows Highlight, Comment, Grow
    branch, and Copy above it; Copy puts the text on the clipboard.
24. A link to a page in a PDF goes to that page; a link to a website asks
    before it opens.
25. The book reader has no bar of its own; the place and Aa stand at its
    bottom left, and a chevron shows in the outer fifth of a page while the
    pointer is there.
26. In the paper of the measure in rule 19, Find finds `performance` 28 times
    and `alternative` 3 times, the second of them across the line break of
    `al-ternative`, marked on both lines; in a PDF that holds `２０２６`,
    `don’t`, `naïve`, `café`, and `规律` broken over two lines, `2026`,
    `don't`, `naive`, `cafe`, and `规律` each find it.
27. Composing `xuexi` with an input method searches nothing and leaves the
    count and the pages as they were; committing `学习` searches it.
28. Text selected on one line and Cmd+F show the bar with that text and its
    first match marked strongly; Cmd+G with the keyboard in the document goes
    to the next match.
29. While the first Find of a PDF of 700 pages runs, the first match after
    the page shown is marked within a second, the thin line grows, no frame
    of the reader takes longer than 50 ms, and the count shows when it is
    done; the same Find again counts at once.

## Verification

- Unit tests: the formats and their glyphs; the reader's zoom steps, the
  page field, and the kept state of both panels; the cover readers of EPUB,
  Kindle, FictionBook, and comic book archives against small files made in
  the test (covers by property, by `meta`, by guide; a Kindle file with
  DRM; FictionBook in windows-1251); the cache key and its entries; the
  `appearance.yaml` grammar with `cover`; the size and resize rule of a
  document card; the record of PDF and book text; the branch note of a
  book; the skill text; the text Find matches in (case, accents, widths,
  quotation marks, glyphs of two letters, hyphens and line breaks of a PDF,
  line breaks in Chinese text, the places of characters of two units) and
  the words it looks for.
- `npm run basehalf:smoke`: the canvas suite checks the covers, the size,
  and Hide Cover and Show Cover (criteria 1 and 3), the book's 3:4 cover
  filling its card and the landscape page whole (criterion 16), and every
  frame while the PDF's card is selected (criterion 17); the cardDetail suite
  checks the header of a PDF (criterion 19), finds a word of a PDF in
  another case and takes the marks away with Escape (criterion 22), opens an
  EPUB, turns a page, and grows a branch (criteria 8 and 11). A unit test holds the rule of
  which covers fill the card.
- Criterion 18 was measured in a development window (2026-11-13), recording
  the screen at about 120 frames a second while the course PDF of the launch
  film opened four times: each time Card Detail showed its background until
  the reader appeared with its toolbar and the cover page in one frame, 659
  to 686 ms after the double click; before the change, the same opening
  showed a grey page with "Opening PDF...", the toolbar over an empty page,
  and a white page for about 80 ms.
- In the real window, with real files: a Chinese report, an English
  textbook PDF, EPUBs in English and Chinese with pictures, a Kindle book,
  a FictionBook, and a comic book archive; per-frame sampling while a
  folder of twenty documents appears; a capture of every card face and of
  the book reader in the light and the dark theme.
- Find (criteria 26 to 29) in the real window, typing at a person's speed and
  composing through the input method over CDP, with every frame of the bar,
  the marks, and the strong match sampled (`.build/rw-read/findprobe.mjs`):
  the paper of 14 pages, a Chinese PDF made for it, and a PDF of 700
  pages.
