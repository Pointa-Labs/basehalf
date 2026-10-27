# PDFs and books

Status: Active (2026-10-25; a pinch zooms a PDF and a book, 2026-10-27)
Decision: [D81](../decisions.md), [D87](../decisions.md#d87--a-pinch-zooms-a-note-in-card-detail-and-its-left-margin-shows-its-outline-new-2026-10-27)
Related: [canvas card placement](canvas-card-placement.md) (the size of a
card), [canvas card resize](canvas-card-resize.md#which-cards-resize),
[opening and closing Card Detail](card-detail-opening.md),
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
passage the user selected.

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
- What works for a PDF works for a book: Grow Branch, and agents seeing the
  selected passage.
- Making a cover writes nothing into the workspace.

## Non-goals

- Making a PDF or a book. No menu of the canvas creates one. A document
  comes in as every file does: dropped on the canvas or into Files, copied
  into the folder, or written by an agent.
- Changing a document: no highlights, annotations, forms, or edits are
  written into it. Both readers show a document as it is, and what the user
  takes from it goes into notes grown from it.
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
2. With its cover shown, the card shows the whole cover inside its surface,
   14 from each edge of the card, in the middle, with the small corners and
   the shadow of a sheet of paper. A cover of another shape, such as a page
   of slides, keeps its shape and leaves more of the surface around it. A
   document that comes in shows its cover.
3. Before its cover can be drawn, the card shows its surface and nothing
   else. A cover that was drawn once on this computer is drawn at once.
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

### The PDF reader

15. A PDF opens at the width of Card Detail, but at most 125 %, as long as
    the user has not zoomed this PDF. The width follows Card Detail when it
    changes. Once the user zooms, the PDF opens at the zoom and the page
    where the user was, as before.
16. Everything else is as before: thumbnails, the outline, search, zoom,
    text selection, and Grow branch from a selection. A pinch of the
    trackpad zooms the PDF with its zoom, around the fingers, as the wheel
    with Ctrl held does inside it, and the zoom is the user's. The browser
    gives a pinch to the window, never to the page of the PDF, so the window
    takes it and hands it to the page
    ([zoom and outline of a note](note-zoom-and-outline.md), D87). A PDF that a password
    locks asks for it in place of the PDF, says so when it is not right,
    and asks again; Cancel closes Card Detail. BaseHalf keeps no password:
    the PDF asks each time it opens. Any other PDF that does not open shows
    "BaseHalf could not open this PDF." in its place, and the reason goes to
    the log.

### The book reader

17. A book opens in Card Detail at the place where the user was, or at its
    start. While it opens, the page shows a quiet placeholder, as a PDF's
    does. Card Detail fades in first and the book draws itself after the
    transition ([opening and closing Card Detail](card-detail-opening.md)).
18. **Layout.** A bar at the top: Contents, the title of the chapter shown,
    and on the right Search, Smaller Text, Larger Text, and the choice of
    pages or one scroll. The book in the middle, in one column, or in two
    when Card Detail is wide enough. A bar at the bottom: Previous Page, how
    far into the book the place is, as a bar the user can drag and as a
    percentage, and Next Page.
19. **Turning pages.** The arrows of the bottom bar, the Left and Right
    arrow keys, Page Up and Page Down, Space and Shift+Space, and a click in
    the outer fifth of the page at either side. A book that reads from right
    to left turns the other way. In one scroll, the wheel and the keys
    scroll.
20. **Contents.** Contents opens the book's table of contents beside the
    book, with the chapter shown marked. A click on an entry goes there.
    Contents closes with its button or with Escape. A book without a table
    of contents shows its sections by their order. A comic book's pages are
    its pictures in natural name order, each listed by its file name without
    the extension, and the hidden files of the system that packed it are no
    pages.
21. **Search.** Search opens a field over the contents. Enter searches the
    whole book and lists each match with the words around it, in the order
    of the book, as they are found. A click on a match goes there and marks
    it. Escape in the field closes the search.
22. **Text.** Smaller Text and Larger Text change the size of the text in
    steps, from 70 % to 200 %, and the choice of pages or one scroll is
    kept. A pinch of the trackpad changes the text by one step each time
    the fingers have spread or closed by as much as that step, as Larger
    Text and Smaller Text do. Both are the user's for every book on this
    computer. They do not
    apply to a comic book or to a book with a fixed layout, whose pages are
    pictures.
23. **Colors.** The pages take the colors of the workbench's editor, light
    or dark, and follow a change of the theme. Pictures keep theirs.
24. **The place.** Where the user is in a book is kept for that book in the
    workspace's storage on this computer, and the book opens there again.
25. **Links.** A link inside the book goes to its place in the book. A link
    to the web opens in the browser, after the question that every link to
    a website asks. Other links do nothing.
26. **Selecting.** Text selected in a book shows the button Grow branch
    just above the selection. Copy works as everywhere.
27. **The keyboard.** The reader takes the keyboard when Card Detail is
    drawn. Escape closes Card Detail, except in the search field and while
    Contents or the search is open, which Escape closes first.
28. **What it cannot open.** A book with DRM shows "BaseHalf can't open
    this book: it is protected with DRM." Any other file that does not open
    shows "BaseHalf could not open this book." Both stay in place of the
    book; the reason goes to the log.
29. **What a book may not do.** Scripts in a book never run, and a book
    loads nothing from the network: no page, picture, font, or style. What
    a book holds is shown from the file itself.

### Grow branch from a book

30. Grow branch makes a note from the selected passage as it does for a PDF
    ([reference graph](reference-graph.md#creating-connected-nodes)): next
    to the book's card, named after the book with `-note`, its title the
    passage's first sentence, the passage quoted, and a line
    `Source: [<book>](./<book>), <chapter>`. Its first bytes list the book
    in `upstream`, so the note is connected from the book when it appears.
    Without a chapter the line ends after the link.

### What agents can see

31. Text selected in a PDF or a book is what agents can see
    ([the selection agents can see](selection-for-agents.md)), as text
    selected in a note is: `selected: "text"`, `path` the document, and
    `text`. For a PDF the record adds `first_page` and `last_page`, the
    pages the selection begins and ends on, counted from 1. For a book it
    adds `chapter`, the entry of the contents that the selection begins in,
    when the book has one. The status bar shows the start of the text.
32. The record follows 30 ms after the selection stops changing. When the
    selection ends, it is the document's card again. Text longer than 10,000
    characters is cut there, as for a note.
33. The skill describes the two new fields, and its version becomes 10
    (D78 made it 9 the same day).

## Limits

- A cover is 800 pixels wide. On a card zoomed to more than 150 % on a
  retina screen it is less sharp than the page in Card Detail.
- The search of a long book takes seconds; matches appear as they are
  found, and a new search ends the one before.
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
8. Each book opens in Card Detail: pages turn with the arrows, the keys, and
   the side of the page; Contents goes to a chapter; Search lists matches
   and goes to one; Larger Text makes the text larger; Escape closes
   Card Detail.
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

## Verification

- Unit tests: the formats and their glyphs; the cover readers of EPUB,
  Kindle, FictionBook, and comic book archives against small files made in
  the test (covers by property, by `meta`, by guide; a Kindle file with
  DRM; FictionBook in windows-1251); the cache key and its entries; the
  `appearance.yaml` grammar with `cover`; the size and resize rule of a
  document card; the record of PDF and book text; the branch note of a
  book; the skill text.
- `npm run basehalf:smoke`: the canvas suite checks the covers, the size,
  and Hide Cover and Show Cover (criteria 1 and 3); the cardDetail suite
  opens an EPUB, turns a page, and grows a branch (criteria 8 and 11).
- In the real window, with real files: a Chinese report, an English
  textbook PDF, EPUBs in English and Chinese with pictures, a Kindle book,
  a FictionBook, and a comic book archive; per-frame sampling while a
  folder of twenty documents appears; a capture of every card face and of
  the book reader in the light and the dark theme.
