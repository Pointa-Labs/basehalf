# Zoom and outline of a note in Card Detail

Status: Draft (2026-10-27, revised 2026-10-28 and 2026-10-31)
Decision: [D87](../decisions.md#d87--a-pinch-zooms-a-note-in-card-detail-and-its-left-margin-shows-its-outline-new-2026-10-27),
revised by [D105](../decisions.md#d105--a-pinch-zooms-a-note-as-a-picture-under-the-fingers-and-the-note-is-laid-out-once-they-rest-new-2026-10-31)
Related: [note rendering](note-rendering.md) (what a note shows),
[PDFs and books](documents-and-books.md#the-pdf-reader) (the zoom of a PDF
and the text size of a book), [opening and closing Card Detail](card-detail-opening.md)
(the keyboard and Escape), [canvas wheel gestures](canvas-wheel-gestures.md)
(a pinch on the canvas), [architecture invariants](../harness/architecture-invariants.md#product-shell)

This specification owns two reading aids of a Markdown note in Card Detail,
in its Rich and its Preview projection: zooming the note with a pinch of the
trackpad or with the wheel, and the outline of its headings in the empty
margin to the left of its text. It also owns where the editor's handles of
a block stand in Rich while the page is zoomed or moves under the pointer.

## Problem

Measured on 2026-10-27 in a development window of 1440 × 900 points:

- **A pinch did nothing.** The browser hands a two-finger pinch of the
  trackpad to the window, not to the page that draws the note: it arrives as
  wheel events with Ctrl held, aimed at the element that holds the note's
  page. A pinch made through the browser's own protocol gave 20 such events
  to the window and none to the note's page, and nothing took them: the note,
  the window, and the canvas under Card Detail stayed as they were. A wheel
  with Ctrl or Command held inside the note's page did nothing either. Over a
  PDF the same pinch did nothing; only a wheel with Ctrl held inside the PDF
  zoomed it (three notches went from 114% to 500%), and Command and minus
  made the whole window smaller.
- **A long note could not be overlooked.** Card Detail shows a note in a
  column at most 760 pixels wide. In a Card Detail of 1130 pixels, 209
  pixels stay empty to the left of the text; with the Agent Area open, Card
  Detail is 834 pixels wide and 61 of them are empty. A note of 42 headings
  showed none of them unless the user scrolled to each. The user asked for
  the zoom, and for a column of short ticks in that margin, one for each
  heading, the heading in view brighter, "平常是隐藏的，鼠标放上去有导航":
  hidden at rest, navigation under the pointer.
- **The handles of a block stayed behind** (measured on 2026-10-28 in the
  same window). With the pointer resting on the first line of a paragraph,
  the editor's handles of a block, add and drag, stood 8 pixels left of the
  text. A pinch to 180% moved the left edge of the text from 209 to 85
  pixels over 29 frames, and in every one of them the handles stayed at 153
  to 201 pixels, over the paragraph's first word; a move of the pointer
  inside the paragraph left them there. A two-finger scroll of 240 pixels
  left them where they were, beside another paragraph. The editor measured
  a block once, when the pointer reached it, and placed its handles by that
  measure until the pointer reached another block.
- **A pinch did not stay under the fingers** (measured on 2026-10-31 in the
  same window, at 120 frames a second). The page was laid out at the level
  of every frame and drawn larger from the top middle of its column. In a
  Card Detail of 848 pixels, where the column is as wide as the view at
  100%, a pinch from 100% to 180% broke the lines of the paragraph under the
  pointer anew in 17 of its 33 frames, moved the page by up to 51 pixels in
  one frame when a paragraph above gained a line, and left the character
  under the pointer 166 pixels to one side of it. The Preview projection,
  drawn in the window itself, did the same: 20 of 33 frames, 40 and 179
  pixels. At the start of a note, a pinch to 60% moved the line under the
  pointer up by 6 to 29 pixels a frame. Over a note of 151 KB, whose layout
  takes longer than a frame, the column grew past both sides of the view and
  cut its text, the handles of a block went off the view, frames took up to
  66 ms, and the lines broke anew in one jump when the fingers rested. Once,
  after a pinch whose events paused for 170 ms, the page went back from 180%
  to 178% for 175 ms and then to 180% again: the window had sent the page
  back levels the page had reported, and the older one arrived last.

## Scope

In scope: in the Rich and the Preview projection of a Markdown note in Card
Detail, what a pinch, a wheel with the zoom key, and a wheel with Ctrl held
do; the zoom level, its range, and where it is kept; the outline in the left
margin: which headings it lists, when it shows, how it looks, and what a
click on it does; in Rich, where the handles of a block stand at every
level, and when the page moves under a pointer that stays still.

Not in scope, and unchanged:

- The canvas and a note's card. A pinch over the canvas zooms the canvas
  ([canvas wheel gestures](canvas-wheel-gestures.md)).
- The Source projection, a code editor with the zoom of the base's editors.
- The pages of a PDF, a book, an image, a sound, and a video in Card Detail.
- Command and `=`, `-`, and `0`. They zoom the whole window, as everywhere in
  BaseHalf.
- What the note shows and how it is edited ([note rendering](note-rendering.md)).

## Terms

- **Page**: the element that holds the note's text column, its images,
  tables, and code blocks; the rest of the projection is the view it
  scrolls in.
- **Level**: how much larger the page is drawn than at 100%.
- **Left margin**: the part of the view to the left of the note's text, from
  the left edge of the view to the left edge of the text, over the whole
  height of the view.
- **Headings**: the headings that the page shows, in their order.
- **Current heading**: the heading whose part of the note is being read,
  as rule 16 decides.
- **Tick**: the short line that stands for one heading in the outline.
- **Outline panel**: the list of the headings' names that the ticks open.
- **Handles of a block**: the add and the drag buttons that the Rich
  projection's editor shows left of the block under the pointer.

## Required behavior

### Zoom

1. A pinch of the trackpad over the note zooms the page. So does the wheel
   with the zoom key held (Command on macOS, Ctrl elsewhere) and with Ctrl
   held, as on the canvas. Without them the wheel scrolls as before.
2. Once the fingers rest, the page is laid out at the level, not drawn
   larger as a picture: its text, images, tables, and code blocks, and the
   text column itself, are that much larger. The column grows until it is as
   wide as the view and then stays as wide as the view, its text wrapping in
   it. At rest the page never scrolls sideways, and the column stays in the
   middle of the view.
3. The level follows the fingers: fingers that spread to 1.5 times their
   distance make the page 1.5 times larger. Each event changes the level by
   the factor e^(−Δy / 100), the browser's own measure of a pinch, and a
   notch of a mouse wheel changes it by at most 10%.
4. While the fingers move, the page is drawn as a picture of itself, larger
   or smaller around the pointer, as a browser zooms its page: the point of
   the page under the pointer stays under it, across and up and down, also
   where the picture passes the start or the end of the note or a side of the
   view. Nothing of the page is laid out anew while the fingers move, so no
   line breaks anew.
5. The level is between 50% and 300%. A gesture that ends between 94% and
   106% ends at 100%.
6. 150 ms after the last event of a gesture the fingers have rested, and the
   page is laid out once, at the level the gesture ends at (rule 5). The
   line under the pointer then stays at the pointer's height as far as the
   note can scroll, and the column is in the middle of the view. When that
   layout breaks no line anew, the page glides there from where the picture
   was, in 200 ms, its level too when the gesture ends at 100%; when lines
   break anew, the page is there in the frame of the layout. With reduced
   motion it is there at once.
7. A zoom changes nothing else of the note: the caret, the selection, what
   agents can see of it, the editor's undo, and an open menu of the editor
   stay as they were. A click, a drag, and typing work in a zoomed page as at
   100%. The editor's toolbars and menus keep their size, and in every frame
   of a gesture and of its glide they stand at the text they belong to, as
   the handles of a block do (rule 23).
8. The level is one for every note, kept on this computer for the user's
   profile (`basehalf.noteZoom`), as the text size of the book reader is. A
   note opens at that level from its first frame, in Rich and in Preview,
   and a change in one projection or window reaches the others. A page is
   never sent back a level it reported itself: arriving late, such a level
   would take the page back from a newer gesture.

### The outline

9. The headings are the headings that the page shows: a heading of any level
   written with `#` or underlined, a heading that the Rich projection shows
   in its rendered form because it cannot edit it
   ([note rendering](note-rendering.md#a-block-the-rich-projection-cannot-edit)),
   and a heading written in HTML, which the page shows as a heading too. A
   line of the front matter or of a code block is no heading, since the page
   shows it as text. A heading without text is left out.
10. At rest the outline shows nothing.
11. While the pointer is in the left margin, the ticks fade in, in 200 ms,
    and they fade out in 200 ms when it leaves the margin. A note without
    headings, and a left margin narrower than 26 pixels, show nothing. The
    outline is drawn over the editor's handles of a block and its menus,
    which never cover its panel.
12. **The ticks.** One tick for each heading, top to bottom, in a column
    whose middle is the middle of the view. A tick is 2 pixels high with
    rounded ends; its right end is 22 pixels from the left edge of the view.
    It is 16 pixels long for the highest level that the note has, 12 pixels
    for the level below, and 8 pixels for any level further down. Ticks are
    14 pixels apart. When they do not fit in the height of the view less 32
    pixels, they are closer, down to 4 pixels apart; beyond that the column
    shows the ticks around the current heading.
13. The tick of the current heading is drawn in the foreground color at 83%,
    the others at 30%, and a tick changes between them in 200 ms.
14. **The outline panel.** Once the pointer has rested on the column of
    ticks for 150 ms, the outline panel shows the names of the headings: it
    fades in and moves 10 pixels to the right into its place, in 200 ms. A
    pointer that passes over the ticks to the text or to the handles of a
    block opens nothing. The panel goes the same way as soon as the pointer
    is neither over it nor over the ticks.
15. The panel is 240 pixels wide, 8 pixels from the left edge of the view,
    its top 10 pixels above the first tick and inside the view. A name is
    one line of 13 pixels, its row 25 pixels high, indented 12 pixels for each
    level below the highest; a name too long for the row ends in "…". The
    current heading's name is in the foreground color, the others in the
    muted color; the row under the pointer has the hover color of a list. The
    panel is at most 70% of the height of the view and scrolls inside, with
    the current heading's row in view when it opens. It has the look of
    BaseHalf's other menus: their background, border, 12-pixel corners, and
    shadow. The panel lies over the text, which does not move.
16. **The current heading** is the last heading whose top is less than 64
    pixels below the top of the view: where a click on its name puts it, and
    a line more. Before the first heading reaches that line, it is the first
    heading if it is in view. When the view is scrolled to the end of
    the note, it is the last heading in view, if any.
17. A click on a name scrolls the view, smoothly, until the heading stands
    24 pixels below the top of the view, or as far as the note scrolls. The
    click moves neither the caret nor the selection, takes no keyboard focus,
    and closes nothing. A wheel over the panel scrolls the panel while it has
    names out of view, and the note otherwise.
18. The outline follows the note: a heading that is typed, renamed, or
    deleted is in the outline in the frame after the page shows it, and the
    current heading follows scrolling, zooming, a change of the width of
    Card Detail, and pictures that finish loading.
19. The outline and its ticks are drawn by BaseHalf's projection, outside the
    page: they keep their size at every level, and the text under them never
    moves for them.
20. With reduced motion (the system's setting, or `workbench.reduceMotion`),
    the ticks and the panel come and go in one frame, and a click on a name
    scrolls at once.

### Room for the outline in Rich

21. In Card Detail the Rich projection keeps 85 pixels between each edge of
    the view and its text, at every level: 28 for the outline at the edge
    and 57 for the editor's handles of a block, add and drag, which stand
    next to the text. Neither ever lies on the other, and the text stays in
    the middle. A wide Card Detail has that room anyway; in one of 834
    pixels the text column is 664 pixels wide instead of 712, and in one
    narrower than 760 pixels the handles, which were partly cut off at the
    edge, show whole.

### The handles of a block in Rich

22. The handles of a block keep their size at every level. They stand left
    of the text column with 8 pixels between them and it, and their middle
    is the middle of the block's first line as the page draws it: they are
    as high as that line is at 100%, and at another level they stand lower
    by half of what the line has grown, or higher by half of what it has
    shrunk.
23. Every frame in which the page moves shows the handles where rule 22 puts
    them in that frame: each frame of a zoom, while the fingers move, in the
    frame of its layout, and while the page glides to its place (rules 4 and
    6), each frame of a scroll, and a frame in which the page is laid out
    anew, as when Card Detail changes its width or a picture above the block
    finishes loading.
24. The handles are those of the block under the pointer. When the page
    moves under a pointer that stays still, in a zoom, a scroll, or a change
    of the width of Card Detail, they pass in that frame to the block that is
    then under the pointer, as if it had moved, and go while no block is
    under it. While the fingers move, the point under the pointer stays under
    it (rule 4), so they stay with their block; when the page glides to its
    place or breaks its lines anew, they pass to the block then under the
    pointer. Handles that a key has
    hidden, as typing does, come back with the next move of the pointer, not
    with a move of the page. While a button is held, the menu of the drag
    handle is open, or a block is being dragged, they stay with their block.

## Limits

- L1. While the fingers move, the page is drawn from how it looked when the
  gesture began, as a browser draws a page under a pinch: zoomed in, its text
  is a little soft until the fingers rest, and sharp from the frame of the
  layout. That one layout takes longer than a frame in a long note. Measured
  on 2026-10-27, one layout of the whole page after a change of level: a note
  of 3 KB with 227 elements in 3 to 8 ms, 25 KB with 1,301 elements in 16 to
  25 ms, 151 KB with 5,685 elements in 75 to 87 ms, and 203 KB with 7,803
  elements in about 100 ms.
- L2. The outline shows at every width of Card Detail. In Rich the text
  column gives up the width that rule 21 takes: 48 pixels in a Card Detail
  of 834 pixels, 122 in one of 700 (530 are left for the text).
- L3. The outline is for the pointer. The keyboard does not reach it; a
  screen reader reads the headings in the page itself.
- L4. A heading inside a list item or a quote is shown as a heading by the
  Preview projection and as text by the Rich projection, and each outline
  lists what its projection shows.
- L5. A pinch over a PDF or a book in Card Detail zooms it with its own zoom,
  by the same way: the window takes the pinch and hands it to the page
  ([PDFs and books](documents-and-books.md#the-pdf-reader), rules 16 and
  22). A pinch over an image or the picture of a video zooms the place under
  the fingers, past the picture's box, and a two-finger swipe moves it, as on
  the canvas; while editing, one over the frame viewer of a video or the
  waveform of a sound spreads its time out, and one over an image zooms its
  picture under the crop frame
  ([editing media, "Zooming the picture and the time"](media-editing.md#zooming-the-picture-and-the-time),
  D93, D96, D97).
- L6. The handles of a table's rows and columns go as soon as the page moves
  under them, in a zoom as in a scroll, and come back with the next move of
  the pointer: the editor draws them so.
- L7. The events of a pinch do not say when the fingers leave the trackpad.
  Fingers that stop for 150 ms in the middle of a pinch rest as far as the
  page knows: it is laid out, and the rest of the pinch zooms from there.

## Failure and recovery

A level kept in storage that is not a number between 50% and 300% is read
as 100%. A page whose layout the browser cannot measure keeps its level and
its scroll position. Nothing of this is written into the workspace.

## Acceptance criteria

1. A pinch made through the browser's protocol over a note in Rich zooms the
   page by the pinch's scale: once the fingers rest, the text is drawn that
   much larger.
2. The same pinch over the note's text in Preview zooms it the same, and
   switching to Rich shows the note at that level from its first frame.
3. Sampled on every frame of a pinch over a short note and over a note of
   151 KB, in a Card Detail of 1130 and of 848 pixels: while the fingers
   move, the point of the page under the pointer stays within 1 pixel of
   it, across and up and down, also at the start of the note, and no frame
   lays the page out, breaks a line anew, or takes longer than 34 ms. The
   page is laid out once, 150 ms after the last event: the line under the
   pointer is then within 2 pixels of its height as far as the note can
   scroll, and the column is in the middle of the view.
4. After zooming to 150%, a click on a word puts the caret in that word,
   typing adds the letters there, and Command and Z takes them back.
5. A wheel with Command held over the note zooms it; without it the wheel
   scrolls.
6. The level is clamped to 50% and 300%, and a pinch that ends at 103%
   leaves 100%.
7. At rest no outline is drawn. With the pointer in the left margin of a
   note with headings, the ticks show, one for each heading, the current
   one brighter; in a note without headings nothing shows.
8. Over the ticks, the panel lists the headings by name, indented by level;
   a click on the third scrolls it to 24 pixels below the top, the caret and
   the selection stay where they were, and the keyboard is still in the
   editor.
9. Typing `## New part` at the end of a note adds a tick and a name.
10. The front matter and a code block of a note that hold lines that start
    with `#` add no tick, and a heading that the Rich projection shows in its
    rendered form adds one.
11. The ticks and the panel keep their size at 200%.
12. In a Card Detail of 834 pixels and of 700 pixels, in Rich and in
    Preview, the ticks show with the pointer in the margin. A pointer that
    passes from the ticks to a block's handles within 150 ms opens no panel,
    and the handles show and work; resting on the ticks again opens the
    panel after 150 ms.
13. With the pointer resting on the first line of a paragraph and its
    handles shown, a pinch from 100% to 180%, sampled on every frame, shows
    the handles 8 pixels left of the text and their middle within 1 pixel of
    the middle of the paragraph's first line, at their size, and so does a
    pinch back to 100%. Once the fingers rest, a small move of the pointer
    inside the paragraph leaves them there. Command, held for the wheel,
    hides them as any key does, and the next move of the pointer after the
    zoom shows them at that place.
14. A two-finger scroll over the note shows, in every frame, the handles
    beside the block under the pointer. A pinch over a short note, which
    cannot keep the line under the pointer, ends with the handles beside the
    block then under it. Typing that scrolls the note leaves the handles
    hidden.
15. With the drag handle's menu open, a pinch leaves the menu open, and the
    handles stand beside their block in every frame.
16. A pinch to 60% at the start of a short note, sampled on every frame,
    keeps the point under the pointer under it past the top of the note;
    once the fingers rest, the page glides back to its top and its column to
    the middle in 200 ms, with the handles beside their block in every frame,
    and it breaks no line anew.
17. The level a page reported when its fingers rested is not sent back to
    it: the window stores it, and only another projection or window gets it.

## Verification

- Unit tests: the factor of an event, the range and its end at 100%, and the
  level read from storage (`basehalfNoteZoom.test.ts`); the headings of a
  page, the lengths and the distance of the ticks, the current heading, and
  where the panel stands (`basehalfNoteOutline.test.ts`); the zoom of a page
  frame by frame: the point under the pointer while the fingers move, also
  past the start of the note, no layout until they rest, one layout then
  with the line under the pointer, the glide when no line breaks anew, and
  a level from elsewhere that waits for the gesture
  (`basehalfNoteZoomGesture.test.ts`); the messages of the Rich projection's
  page (`basehalfMarkdownRichWebviewProtocol.test.ts`); the level a page
  reported, which is not sent back to it
  (`basehalfNoteZoomLevel.test.ts`); the box the handles of a block
  stand by on a drawn page, how far they move down at a level, and the
  pointer they pass with when the page moves under it
  (`basehalfBlockHandles.test.ts`).
- The `cardDetail` suite of the smoke pinches a short note to 160% and
  back with the handles of a block shown. On every frame of the pinch it
  checks that the point under the pointer stays under it and that no line
  breaks anew until the fingers rest, and once they rest, where the handles
  stand: 8 pixels left of the text, at the middle of the block's first line.
- In the window, recorded on every frame by the page itself: a pinch made
  through the browser's protocol over Rich and over Preview, on a short note
  and on the 151 KB note, in a Card Detail of 1130 and of 848 pixels; the
  point under the pointer across and up and down, where the lines of the
  paragraph under it break, the level, the layout, and the time of each
  frame, and the glide once the fingers rest; a click, typing, and undo at 150%;
  the outline at rest, with the pointer in the margin, over the ticks, after
  a click on a name, after typing a heading, and at 200%; the box of the
  handles of a block against the edge of the text and the block's first
  line on every frame of a pinch, a wheel with Command, and a scroll.
