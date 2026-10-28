# Canvas card placement

Status: Active (2026-10-11; rewritten the same day for D46, reviewed once,
and revised so that the layout stays out of git; revised on 2026-10-12 for
D50, so that a place the user points at is taken as it is; revised on
2026-10-27 for D88, so that a card let go on a folder goes into it).
Implementation in
progress: until it lands, the code does what the
first version of this document required, which is summarized under
[The first version](#the-first-version). The specifications listed under
[Specifications this changes](#specifications-this-changes) are updated in
the commit that implements the part they describe.
Decision: [D46](../decisions.md#d46--every-card-has-a-saved-place-and-places-stay-out-of-git-new-2026-10-11),
refined by [D50](../decisions.md#d50--a-place-the-user-points-at-is-taken-as-it-is-new-2026-10-12)
and [D88](../decisions.md#d88--cards-let-go-on-a-folder-go-into-it-new-2026-10-27)
Related: [following moved items](following-moved-items.md),
[mirror file resilience](mirror-file-resilience.md),
[workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
[architecture invariants](../harness/architecture-invariants.md)

## The rule

**Every card has a saved place. A card gets it when it first appears on a
canvas. After that only the user changes it.**

Places are kept in the folder and are not shared through git.

Everything below follows from these two sentences or says how one part of
them is carried out.

## Problem

A canvas had two kinds of place.

- **Saved**: the row of a card the user had dragged or resized.
- **Computed at every drawing**: every other card, from its position in the
  folder's list of items and from where the saved cards were.

A computed place depends on the other cards and on the list of files. So:

1. A card could be drawn on top of another one without the user putting it
   there.
2. Cards moved by themselves. A file that was added, removed, or renamed
   changed the list, and the cards after it shifted.
3. What the canvas showed was not what was stored. Most places were stored
   nowhere.
4. Keeping computed places off the saved ones needed a search for free
   places with rules of its own, which a user could not predict.

The trial of 2026-10-11 in the real window showed the first two
([following moved items](following-moved-items.md#verification)).

### The first version

The first version of this document, of the same day, kept both kinds of
place. A card without a row stayed in its grid slot when that was free of the
saved places and took the nearest free place otherwise. A card that was
carried into another folder kept its coordinates when they were free there.
It removed problem 1 and left 2 to 4.

A simpler rule was tried on top of it: cards without a row line up below the
cards that have one. It failed in the product. Dragging the first card of a
folder gave that card a row, and every other card moved below it. Without a
saved place for every card, BaseHalf cannot tell a card that is new from one
that has been there all along.

## What other implementations do

Read in source on 2026-10-11: five open-source desktop views that show a
folder as icons the user can place freely, and three canvas editors, one
canvas file format, and one node-graph library.

### Which positions are stored

- In nine of the ten, every item that can be placed freely has a stored
  position. In the five canvas ones a position is a required field of every
  item from the moment it exists.
- One desktop view stores only the icons the user moved. At every layout it
  lets the others flow in sort order around the stored ones and skips the
  cells that a stored icon covers. A new file shifts the icons after it. This
  is what BaseHalf did.

### An item that appears without the user choosing a place

- Three desktop views give it the first free cell, scanning from a corner,
  and store that position at once.
- One lays such items out below everything that is there. It also keeps a
  stored position that is old only when that place is still free, and takes a
  place near it otherwise.

### Files that the user drops at a point

- Two desktop views remember the point until the file exists: one for ten
  seconds by file name, one by writing the position before the transfer
  starts. When the cell is taken, the icon goes to the next free cell after
  it, or to the free cell nearest to the point.
- Dropped together, the files either each take the free cell nearest to the
  point, or keep the positions they had relative to each other.
- The canvas editors lay a group out by itself around the point: one row, a
  near-square grid, or rows of four. They do not look at what is already on
  the canvas, so the group can cover it.

### A sorted mode

- Three desktop views have a mode in which icons are kept in sort order and
  cannot be placed. It is a feature the user chooses. One of them leaves it
  by itself when the user drags an icon, and stores the position of every
  icon at that moment.
- One desktop view and all the canvas ones have no such mode. They handle
  every case with stored positions alone.

### Arranging everything

- Two desktop views have a command that sorts all icons and overwrites their
  stored positions. One asks before it does.
- The arrange commands of the canvas editors work on the selected items and
  ignore the rest.

### Where positions are stored

- None of the desktop views stores them in the folder it shows. Three keep
  them in the application's settings on the machine, two as file metadata
  that the system keeps.
- BaseHalf keeps its layout in the folder, so that it stays with the folder
  when the folder is renamed, moved, or copied. Application storage is kept
  by the folder's path and would lose it then. Like the desktop views, it
  does not make positions part of what the folder shares:
  [places stay out of git](#places-stay-out-of-git).

What BaseHalf takes from this: store every place; place a card once, when it
appears, and store the place at once; put what arrives without a point after
what is there; put what arrives at a point at the nearest place to it that is
not taken; keep no sorted mode; and leave sorting to a command the user runs.

Since 2026-10-12 one card that the user points at is the exception to the
fourth: it goes where the user pointed
([A pointed place is taken as it is](#a-pointed-place-is-taken-as-it-is)).

## Goals

- What a canvas shows is what its layout stores.
- No card moves unless the user moves it.
- A card that the user points at is where they pointed.
- BaseHalf never puts a card on another card by its own choice.
- The card of an image or a video has its picture's shape.
- One rule covers every way a card can come to be on a canvas.
- Opening a folder or moving a card changes nothing that git shows.

## Non-goals

- **A sorted mode.** Cards are in name order only as far as they appeared
  together. A file that is added later is not sorted in.
- **The commands that put cards in order.** Arranging selected cards and
  tidying a canvas are the ways BaseHalf changes places the user has, and
  only when the user runs them.
  [Canvas selection and arrangement](canvas-selection-and-arrangement.md)
  specifies them.
- **Keeping the user from placing a card on another one.**
- **Which folders and files become cards.** Folders whose names start with a
  dot, such as the ones agent tools add, are still cards.
- **Sharing an arrangement.** Each copy of a folder has its own places. Two
  people who work on one project through git each arrange their own canvas.
  A way to share an arrangement on purpose, or to keep it in step live, can
  be added later. Git is not that way: places change too often, and two
  people who moved cards in one folder would get a conflict in a file
  neither of them ever opens.
- **Keeping places in two stores.** BaseHalf's own choices are saved where
  the user's are.
- **Reading aids.** The marks for read paragraphs are also personal and
  change often, and they are still shared through git. That is a question of
  its own.

## Terms

- **Layout** of a folder: its `.bh/mirror/<folder>/canvas.yaml`.
- **Ignore file**: `.bh/.gitignore`, which BaseHalf writes
  ([places stay out of git](#places-stay-out-of-git)).
- **Row**: a card row of a layout, with a path, a kind, a place, and a size.
- **Place**: the `x` and `y` of a row.
- **Chosen row**: a row whose place BaseHalf chose and that the user has not
  changed since. In the layout it carries `auto: true`. Every other row is
  the user's.
- **List order**: the order in which a canvas lists the items of its folder:
  folders first, then by name.
- **Appear**: an item appears on the canvas of its folder when that canvas
  is drawn, the item is one the canvas shows, and the layout has no row for
  its path. A row belongs to an item when their paths are
  [the same path](following-moved-items.md#the-snapshot), so that on a
  volume that ignores letter case a rename that changes only the case is
  still that item.
- **Pointed place**: the place that the user named with the pointer for one
  new card: a point on the canvas, or the point at which a connection line
  was released. See [Pointing](#pointing).
- **Computed place**: the place that BaseHalf works out for a card that the
  user creates without pointing: the card centered on the middle of the
  visible part of the canvas, or beside the card that the new one is made
  from.
- **Taken**: the rectangles of all rows of the layout, and of the places
  that [wait for a write](#when-a-place-cannot-be-saved).
- **Open**: a rectangle is open when it is at least 40 away to the side, or
  at least 60 away above or below, from every taken rectangle. These are the
  gaps of the plain grid. This is about places on a canvas. "Free place" in
  [following moved items](following-moved-items.md#terms) is about paths.
- **Cell**: 340 wide and 280 high, the default card of a file with the two
  gaps.
- **Plain grid** for *n* cards: cells in rows, with as many columns as the
  larger of 5 and the square root of 1.34 × *n*, rounded up. It is centred
  in an area of 2400 × 1600 and starts no nearer than 96 to that area's left
  and top. This is the grid BaseHalf has always drawn for a folder without a
  layout.

## Required behavior

### A shown card has a row

- A card is drawn at the place and with the size of its row.
- No place is computed again at a later drawing. The one card that is drawn
  without a row is a card whose place
  [could not be saved](#when-a-place-cannot-be-saved). It is drawn at the
  place BaseHalf chose for it, and that place does not change while the
  window is open.

### When a card appears

1. **Size.** The size at which a card of its kind is drawn when it is new:
   300 × 220 for a file, 248 × 188 for a folder, 300 × 400 for a PDF or a
   book, and the shape of its picture for an image or a video, a generation
   card among them
   ([below](#the-card-of-an-image-or-a-video-has-its-pictures-shape)).
   BaseHalf chooses the place when it knows the size: it measures the
   picture first, and for a draft it reads its settings; the kind of a draft
   comes from its extension ([generation cards](generation-cards.md#terms)).
2. **Place.**
   - The user pointed at it: the pointed place,
     [as it is](#a-pointed-place-is-taken-as-it-is).
   - BaseHalf computed a place for it, or it is one of a group that was
     dropped at a point: the [nearest open place](#the-nearest-open-place)
     to that place.
   - Otherwise: [the end of the canvas](#the-end-of-a-canvas).
3. **Saved.** The row is written to the layout in the same drawing
   ([how a place is saved](#how-a-place-is-saved)). It is a chosen row,
   except when the user pointed.

Cards that appear in the same drawing are placed one after the other in list
order, and each place counts as taken for the next.

So the first drawing of a folder that has no layout puts every card in the
plain grid in list order, as before, and writes one row for each. The one
difference is a card that is larger than a cell: the cards after it stand
clear of it.

### The card of an image or a video has its picture's shape

The card of an image file or a video file, a generation card among them, is
shaped as its picture. Its full shape has a short side of 300 and a long side
that follows the picture's ratio, up to three times the short side: a 16:9
video is 533 × 300, a 9:16 one 300 × 533, a square image 300 × 300, and a 4:1
panorama 900 × 300 with the picture fitted inside. The user does not resize
such a card ([canvas card resize](canvas-card-resize.md#which-cards-resize)).
Its row holds its size, so that the layout stores what the canvas shows.

- **The picture's ratio** is the one the window draws: the width and the
  height of the image, or of the video's frame, as the window decodes it,
  turned as the file says, as for an upright photo or a video recorded on a
  phone held upright. BaseHalf measures it in the window, once for each
  version of a file (its time and its size), at most six files at a time,
  and gives one up after 3 s.
- **Each version is loaded by an address of its own**, the file's with its
  time and its size: the measure of its ratio, the picture the card shows,
  and the video or the sound the card plays. The window keeps what it loaded
  by its address. With one address for every version, after an edit, its
  undo or redo, or another program's write, a card was drawn anew with the
  picture and the shape of the version the window had loaded first (the
  user, 2026-10-27: the edited picture and the canvas's "became two
  different pictures").
- **A draft** has the ratio its settings choose: the value of its model's
  ratio setting, or that setting's default. A ratio that follows an input,
  such as Adaptive, and a draft without a model have the ratio of their
  kind: 16:9 for a video and 1:1 for an image.
- **A picture whose ratio is not known**, because the window cannot decode
  it or has not measured it yet, leaves its card at the size of its row. A
  card that appears with such a picture has the ratio of its kind.
- **When a card appears**, it has its full shape, and BaseHalf knows that
  shape before it chooses the place: it waits for the pictures that appear
  in one drawing, at most 1 s for all of them.
- **Where a card is**, it has its full shape when there is room for it. From
  its top left corner, which stays where it is, it is otherwise the largest
  shape of its picture's ratio that comes no closer to another card than the
  gaps of the plain grid, 40 to the side and 60 above or below, or than it
  already is. It is never larger than the full shape, and never smaller than
  its picture's shape fitted into the card as it is, as far as the full
  shape goes; that is also its size when it already lies over another card.
  Like every card it is at least 140 × 48, and a picture whose shape would
  be smaller is fitted inside. A card of the plain grid from before
  this rule, 300 × 220 in a cell of 340 × 280, is 300 × 169 for a 16:9
  video and, with a card below it, 165 × 220 for a 3:4 image and 140 × 220
  for a 9:16 one. A video card of 720 × 405 from before this rule is
  533 × 300.
- **The size follows** the picture and the room each time the canvas is
  drawn. The card takes a new shape where it is when the file of a draft
  arrives, when a file is replaced by one of another shape, when a draft's
  ratio changes, and when a picture is measured after its card was drawn.
  A drawing that brings a new version of the picture a card shows waits for
  its measure, as one that brings a new card does, at most 1 s, so that the
  card takes the new picture and its new shape in the same frame and never
  shows the new picture in the old shape.
  It grows when room comes free at its corner, as when the user moves a card
  away, and keeps its size when a card is moved next to it. Its place never
  changes, no other card moves, and a row whose size changes is saved. A
  size that would lie over a row written after the drawing chose it, as by
  a move in another window, is not saved.

The card of a sound keeps the size of a file card, and the user does not
resize it either.

The card of a PDF or a book is the card of a picture whose ratio is always
3:4: its full shape is 300 × 400, and the rules above hold for it with that
ratio, which needs no measuring. It shows its cover inside that shape
([PDFs and books](documents-and-books.md#the-card), D81). A PDF card of the
plain grid from before this rule, 300 × 220 with a card below it, is
165 × 220.

### The end of a canvas

Where a card goes when nobody pointed.

- **The row's start and end** are fixed for one drawing, from what is taken
  when it starts.
  - Something is taken: the start is the left edge of everything taken. The
    end is the right edge of everything taken, or 1660 to the right of the
    start when that is further. 1660 is five cells without the last gap.
  - Nothing is taken: the left and the right edge of the plain grid for the
    number of cards that appear in this drawing. The first card goes to that
    grid's first place.
- The **last card** is the taken rectangle whose top edge is furthest down.
  Among several at the same height it is the one furthest to the right.
- **Beside the last card.** The place at the height of the last card's top
  edge, 340 to the right of its left edge, or 40 to the right of its right
  edge when that is further. The card goes there when it is open there and
  does not reach beyond the row's end.
- **Otherwise a new row.** The place at the row's start, 280 below the last
  card's top edge, or 60 below the lowest bottom edge of everything taken
  when that is further down. A card is always open there.

Nothing is put between cards that are there, also where there is room. An
empty stretch between the user's cards is theirs. A card that BaseHalf put
there would look as if it belonged to the cards around it.

In a folder whose cards are still in the plain grid, a new card therefore
continues the last row, and starts the next row when the last one is full.
This still holds after the user has moved some of the cards.

### A pointed place is taken as it is

Where one card goes that the user pointed at.

- The card is put at the pointed place. BaseHalf does not move it: not for a
  card that is there, not for the edge of the visible part of the canvas,
  and not for a row whose item is gone.
- So the card can lie on another card. The user put it there, as with a drag
  ([What the user changes](#what-the-user-changes)).
- The place does not depend on the zoom, on what the window shows, or on
  what else is on the canvas.
- The view does not move either. A card that is pointed at near the edge of
  the window is partly outside it, and the user moves the canvas.

Until 2026-10-12 a pointed card went to the nearest open place, and only
places inside the visible part of the canvas counted. That day the user
reported that cards made from connection lines came out in another direction
or far away. The layout of their folder held seven such cards, and the same
was done in the real window:

- **The search goes in steps of a whole card**, right first, then below,
  above, and left, whatever the direction of the line. In the user's folder
  a card that reached 82 into another one was put 840 lower, and a card
  whose line went to the left was put 680 to the right and 560 lower, below
  the card it came from.
- **A card that would reach past the edge of the window counted as not
  open.** A card is 300 wide. At 100% that is every line released within
  324 pixels of the right edge of the canvas. In the real window, with a
  large card at 100%, the search then found nothing in the window, and the
  card went to the end of the canvas: 1,288 lower, out of sight, and the
  view stayed where it was.
- **What the window shows decided where a card is saved.** The same line
  gave another place at another zoom.

A place that the user cannot predict from where they pointed is not the
place they chose. The row of such a card was already the user's, not a
chosen row. Now the place is too.

**Why the view stays.** A first version of this change moved the view by the
least distance that showed the whole card. The user set that aside the same
day: someone who pulls a line to the left wants the card on the left, and
expects to move the canvas next themselves. So nothing moves that the user
did not move, neither the card nor the view.

### The nearest open place

Where a card goes whose place BaseHalf computed, and a card of a dropped
group whose slot is taken.

- The computed place itself, when the card is open there.
- Otherwise the search goes outward from it in steps of the card's size plus
  the gaps: right, below, above, left, then the four diagonals, ring by ring,
  up to 31 rings.
- For a card that the user creates on the canvas, only places inside the
  visible part of the canvas count, the computed place included, as before.
  A step that reaches past an edge of the visible part is moved back inside
  it, along that edge, so that the room in sight is found also for a card as
  large as a video card, whose whole steps leave a window at once. A card
  larger than the visible part has no place in it.
- When nothing is found, the card goes to
  [the end of the canvas](#the-end-of-a-canvas).

### Pointing

| User action | Place |
| --- | --- |
| Create a card at a point on the canvas: a double-click on the canvas, or the canvas menu opened at that point | pointed: the card's top left corner is at that point |
| Create a card from a connection line | pointed: the side of the new card that the line enters is centered on the point where the line was released |
| Create a card without a point: the Create button, or a keyboard command | computed: the card centered on the middle of the visible part of the canvas |
| Create a note from a selection in a PDF | computed: beside the PDF's card |
| Capture a frame of a video | computed: 40 to the right of the card it comes from, at the nearest open place ([generation cards](generation-cards.md#the-toolbar)) |
| Generate from a generation card that has its file, in the window or with `basehalf --generate` | computed: 40 to the right of the original card, for the new draft ([generation cards](generation-cards.md#generating-again)) |
| Generate several images at once | computed: the drafts of the further images in a row to the right of the card the generation runs on, each 40 to the right of the one before ([generation cards](generation-cards.md#several-images-from-one-generation)) |
| Drop, paste, or move files and folders onto the canvas at a point | for the item at position *i* of *n*: slot *i* of a block of cells that starts at the point and has as many columns as the square root of *n*, rounded up, and at most 4 |
| Paste with Command-V or the Edit menu, without a point: files, folders, a picture, or text ([copy, paste, and drop](copy-paste-and-drop.md#the-canvas)) | computed: the block of the cards, as for a drop, centered on the middle of the visible part of the canvas; a card whose slot is taken goes to the nearest open place, and the view goes to a card out of sight |
| Anything else: a file that a program or an agent adds, a card or an item that is dropped on a folder's card or on a folder of the path ([dropping into a folder](canvas-drop-into-folder.md)), a move in the file tree, a move outside BaseHalf | none |

A group that is dropped at a point keeps its block where the block is open.
The cards whose slots are open take them first. Then the others, in order,
take the nearest open place to their slot. The user named one point for
several cards, so BaseHalf arranges them.

The row of a card that got its place from any row of this table but the
last is the user's. It is not a chosen row.

### A card the user just created is shown

Some actions of the user's create a card without naming a point: a project
from a template is one. Its card goes to the end of the canvas like any
other, and the end can be out of sight.

- When BaseHalf selects cards because the user just created them, and one of
  them is not fully inside the visible part of the canvas, the view goes to
  them, as it does for a note the user creates beside another card.
- A card that is in sight leaves the view as it is.
- This is only for the user's own action in BaseHalf. A card that a program
  or an agent added does not move the view.
- **It is not for a card at a pointed place.** The user chose that place
  with the window as it was, and the view stays
  ([A pointed place is taken as it is](#a-pointed-place-is-taken-as-it-is)).
- A card made with the Create button or a keyboard command is inside the
  visible part of the canvas whenever a place there is open. When none is
  open, it is at the end of the canvas, and the view goes to it, as to any
  card the user just created: so the panel of a draft that New Image or New
  Video made shows, and its prompt has the keyboard
  ([generation cards](generation-cards.md#creating-a-generation-card)).

Found in the smoke on 2026-10-11: the card of a project made from a template
was at the end of the canvas, outside the window, and could not be clicked.
Found in the smoke on 2026-10-22: New Video put the corner of its 720 × 405
card at the middle of the view, where the card did not fit from about 64%
zoom on. With the middle taken, it went to the end of the first row, out of
sight, and the view stayed: the draft's panel was hidden, and its prompt
never had the keyboard. Since then the card is centered on the middle, and
the view goes to a card that is out of sight all the same.

### What the user changes

- A card the user drags or resizes is saved where they left it, also on top
  of another card. Its row becomes the user's. No other row changes.
- A card let go with the pointer on a folder's card or on a folder of the
  path goes into that folder, and one let go outside the canvas anywhere
  else goes back to its place
  ([dropping into a folder](canvas-drop-into-folder.md)).
- A gesture that ends where it began changes nothing: a place BaseHalf chose
  stays one BaseHalf chose.
- Undo of a drag or a resize puts the row back as it was, a chosen row
  included.
- Files and folders that the user drops or pastes at a point get the size of
  their kind ([When a card appears](#when-a-card-appears)). A card that is
  moved to that point from another folder keeps the size it had.

### A row follows its item

A row is card information, and
[following moved items](following-moved-items.md) moves it with its item,
also when the item was moved outside BaseHalf.

- **Renamed in its folder.** The row keeps its place and its size under the
  new path, and stays a chosen row when it was one.
- **To another folder.** The row leaves the layout of the folder it was in.
  The coordinates it had are not used in the other folder. They belong to
  the canvas it left.
  - When the other folder's layout has card rows, a chosen row for the item
    is written there, with the size of the old row, at
    [the end](#the-end-of-a-canvas) of that canvas.
  - When the other folder has no layout, or one without card rows, nothing
    is written there. The card appears with the others when that canvas is
    first drawn.
  - When the move named a point on the other canvas, the card is placed by
    [pointing](#pointing) instead.
- **A chosen row at the new path gives way.** It is there when the item was
  drawn as a new card before BaseHalf knew it was a moved one, or when an
  earlier run of the same move stopped halfway.
  - In the same folder, the row that follows replaces it. The card has the
    place and the size it had under its old path.
  - In another folder, the chosen row keeps its place and takes the size of
    the row that follows. When the card would reach a neighbour at that
    size, it goes to the end of that canvas instead.
  - Either way the row at the old path is then removed. A second run finds
    nothing at the old path and changes nothing, so the move stays safe to
    repeat.
- **A row of the user's at the new path stays.** The row that would follow
  stays at the old path, as following moved items requires. BaseHalf never
  replaces a place the user chose.
- **Undo of a move made in BaseHalf** puts the card back. While the window
  is open, BaseHalf remembers the rows that left a layout through a move
  made in BaseHalf, and where each item went, the last 200 for each
  workspace folder, and stores them nowhere.
  - When such an item is moved back from there to its old path, by undo or
    by the user, its row is restored as it was when that place is open.
  - Otherwise the card goes to the end, with the size it has, or had here
    when the other folder kept no row for it.
  - Another item that arrives at that path from somewhere else is not the
    card that left. It is placed like any card that comes from another
    folder.
  - A move outside BaseHalf uses no memory.

### A chosen row whose item is gone

- BaseHalf removes a chosen row when its item is no longer in the folder and
  following moved items has given the item up. Nothing of the user's is
  lost: BaseHalf chose that place and nobody changed it.
- **Given up** means that BaseHalf will not find the item at a new path any
  more: file events have said that it is gone, it is not waiting for its
  relocation, and the 60 seconds in which it can be paired with an item that
  appears have passed
  ([when BaseHalf compares](following-moved-items.md#when-basehalf-compares)).
  The row is removed at the first drawing of that canvas after that, in the
  write that adds rows. Until then it stays and takes its place, like a row
  of the user's whose item is gone.
- **Why not at once.** A file that is deleted and written again elsewhere a
  few seconds later is recognized as moved. Its card keeps its place only
  when its row is still there. And a drawing can see a file gone before the
  file events for its move have arrived. The first version removed the row
  when no comparison was running, and both cases lost the place: found on
  2026-10-11, 84 of 100 cards after 2,100 files were renamed at once.
- **One listing of the folder is not enough.** A listing can leave out a
  file that a tool is rewriting at that moment. BaseHalf looks at each such
  path again by itself, when it draws and once more before it writes.
- **A move that is held back keeps its row.** A file that is renamed while
  it has unsaved changes is followed later
  ([following moved items](following-moved-items.md#relocation)). Its row
  waits for it.
- **A draft is an item.** A path that holds a draft is present: a draft has
  a row like any card, and its row is never removed as the row of an item
  that is gone
  ([generation cards](generation-cards.md#drafts-and-missing-files)).
  Deleting the draft removes its row. A generation card whose generated file
  is gone is not a draft but a missing file, and its row follows the rules
  of this section like that of any item that is gone.
- **Its place is open in the drawing that removes it.** A card that appears
  in the same drawing can take it.
- A row of the user's whose item is gone stays, as before. An item that is
  there again at that path is drawn with it.

### How a place is saved

A place that BaseHalf chose is written by itself, without a user action.

- **In the drawing.** The rows of all cards that appeared in one drawing are
  added in one write of the layout, together with the removal of chosen rows
  whose items are gone.
- **The canvas waits first** for following moved items, as that
  specification says: after an item of the shown folder was removed outside
  BaseHalf, and at open, it draws only when the comparison has finished or
  its time is up. So a file that was renamed is normally never drawn as a
  new card. When it is, [its chosen row gives way](#a-row-follows-its-item).
- **Against what was read.** The write commits against the bytes it read,
  like a card move
  ([mirror file resilience](mirror-file-resilience.md#layout-files)). When
  the layout changed in between, it is read again. A row that is there for a
  path is never changed by this write.
- **Two drawings close together.** A drawing takes what waits for a write
  before it reads the layout. A save that lands while the drawing is being
  prepared then takes no card out of it: the card has its place from what
  waited, whether the layout was read before that save or after.
- **Checked again at the write.** A place was chosen against the layout as
  the drawing read it. When a row that another window or a move wrote since
  lies on it, the card is given the end of the canvas as it is at the write.
  The card then moves once, from where it was drawn to where its row is.
- **A file renamed in letter case only**, on a volume that ignores case, is
  still that item. Its row takes the new spelling in the same write, with
  the edge rows that name it.

### When a place cannot be saved

The card is still drawn at the place BaseHalf chose. BaseHalf keeps the
chosen places of a canvas for as long as the window is open, so that these
cards do not move either, and counts them as taken.

| Situation | What happens |
| --- | --- |
| The workspace folder is marked ([source-tree guard](spec-driven-development.md#basehalf-source-tree-boundary)), or BaseHalf cannot tell whether it is | BaseHalf writes nothing by itself. |
| The layout is `partial` or `unreadable` | BaseHalf does not write over content it could not read by itself. |
| The write fails for an environmental reason, which includes a `.bh/` behind a symbolic link | It is logged. There is no message, because nothing the user did is waiting. BaseHalf tries again at the next drawing of that canvas. |

In all three, a change the user makes on that canvas writes the layout, and
the places that wait are saved with it as chosen rows. A drag, a resize, a
card the user creates, and files the user drops there are such changes.

- They are saved before the user's own row, so that undo of the change puts
  the card back at the place BaseHalf chose.
- They are saved as they were drawn, also beside or under the card the user
  just moved. The user saw them there.
- Over a layout that could not be read, the user's write saves a recovery
  copy first
  ([mirror file resilience](mirror-file-resilience.md#writing-over-content-that-could-not-be-read)),
  and the places are saved after it.

### Places stay out of git

A layout holds the places and sizes of cards and the sides at which
connection lines meet them. It does not hold which cards are connected, or
their descriptions. Those are shared through git as before.

- **The ignore file.** `.bh/.gitignore` has this content:

  ```gitignore
  # Written by BaseHalf. Card positions and BaseHalf's working files are
  # not shared through git.
  /.gitignore
  canvas.yaml
  !canvas.yaml/
  /cache/
  *.basehalf-tmp
  ```

  - It hides itself, every layout, and `.bh/cache/`.
  - The last rule hides the file that a write under `.bh/` goes through
    before it takes its name. It is there for a moment, or longer after a
    crash, and adding everything to git at that moment would take it along.
  - The third rule keeps a directory of that name visible: the mirror
    directory of a user's own file that is named `canvas.yaml`, with the
    description in it. See [Limits](#limits) for when such a file can have
    one.
  - Tried in a git repository on 2026-10-11: the layouts, the ignore file,
    and the cache did not show; the descriptions did, also the one of a file
    named `canvas.yaml` and the one of the user's own `.gitignore`.
- **When it is written.** Before BaseHalf writes a layout or anything under
  `.bh/cache/` in a workspace folder, when the file is not there. When it
  cannot be written, the layout is not written either, as for any
  [write that fails](#when-a-place-cannot-be-saved).
- **One that is there is left as it is**, whatever it holds. BaseHalf never
  edits it.
- **The user's own `.gitignore` is never touched**, and BaseHalf runs no git
  command.
- **Every folder, without any setup.** Git reads an ignore file in whatever
  directory it finds one, so nothing depends on the repository.
  - A folder that is not in git gets the file too. When it becomes a
    repository later, the file is already there.
  - The workspace folder does not have to be the root of the repository.
  - A rule in the user's own ignore file cannot bring the layouts back: the
    file that is nearer to them decides.
  - Tried on 2026-10-11 for all three, with everything added to git at
    once, as an agent does: the descriptions and the notes were added, and
    no layout, no cache file, and not the ignore file.

### What showing a canvas writes

- Showing the canvas of a folder creates or extends that folder's layout.
  The first canvas shown in a workspace folder therefore creates `.bh/`
  there, with the ignore file.
- Git shows none of it.
- Only the folders whose canvas was shown get a layout.
- Nothing else is written by showing a canvas: no description, no list of
  connections, no file of the user's.
- The rule that opening a folder writes nothing becomes: opening a folder
  changes nothing that git shows
  ([D46](../decisions.md#d46--every-card-has-a-saved-place-and-places-stay-out-of-git-new-2026-10-11)).

### Every shown item is followed

[Following moved items](following-moved-items.md#terms) follows every item
that has card information, and a row is card information. So every item
whose card was shown is followed.

- A file that is renamed or moved outside BaseHalf keeps its place whenever
  it is recognized, also when the user never touched its card. This is what
  "only the user changes it" needs.
- An item that is not recognized is a new card at the end.
- BaseHalf keeps a fingerprint of every file whose card was shown, and of
  the first 200 files below every folder whose card was shown.
- The canvas now waits for the comparison after any item of the shown folder
  is removed outside BaseHalf, not only a described or placed one. A card of
  a file that was deleted outside BaseHalf stays for about half a second
  before it goes.
- The redraw that follows that wait is a redraw for what happened on disk,
  and obeys what every such redraw obeys: it does not replace a description
  the user is typing, and it waits again when another item is being
  recognized. Found on 2026-10-11: that redraw used to be drawn at once.
  With few followed items it was rare. With every card followed it replaced
  a description that was being typed in the smoke, in a different step at
  each run.

The cost of this is measured before the work is done
([Measurements](#measurements)).

### More items than a canvas shows

A canvas shows at most 300 cards.

- An item with a row, a description, or a connection always has its card,
  as before.
- Any other item appears only while fewer than 300 cards are shown, in list
  order. An item that does not fit has no card and no row.
- When a card goes, the first item in list order that had no card appears,
  at the end like any other.

## What the user sees

| Situation | Result |
| --- | --- |
| A folder is shown for the first time | Its cards are in the plain grid, in name order with folders first. |
| A file is added by anyone | Its card is after the last card. No other card moves. |
| Several files are added at once | Their cards follow each other after the last card, in name order. |
| A file is deleted | Its card goes. No other card moves, and the gap stays. |
| A file is renamed, in BaseHalf or outside | Its card stays where it is. |
| A card is dragged | It is where it was dropped, also on another card. No other card moves. |
| A card is dropped with the pointer on a folder's card | It is in that folder, after the last card of its canvas, with its size. Undo brings it back where it was ([dropping into a folder](canvas-drop-into-folder.md)). |
| A card is created at a point | It is at that point, also when another card is there, and also when part of it is outside the window. The view stays. |
| A card is created from a connection line | The line enters it where the line was released, whatever the direction of the line and whatever is beside that point. Near the edge of the window part of the card is outside it. The view stays, and the user moves the canvas. |
| A card is created with the Create button | It is in the middle of the window, or at the nearest open place when the middle is taken. |
| A project is created from a template | Its card is after the last card, and the view goes to it when it was out of sight. |
| Files are dropped at a point | They are in a block at that point. A card whose slot is taken is beside the block. |
| A card is moved into another folder | It is after the last card of that folder, with its size. |
| That move is undone | The card is back where it was. |
| The canvas has become untidy | Nothing changes by itself. The user can [tidy the canvas](canvas-selection-and-arrangement.md#tidying-a-canvas) or [arrange selected cards](canvas-selection-and-arrangement.md#arranging-a-set). |

## Limits

- **A clone has no places.** A folder that is cloned from git, on another
  computer or for another person, starts with every canvas in the plain
  grid. An arrangement comes along only when the folder itself is copied or
  moved.
- **Git history does not hold an arrangement.** Going back to an earlier
  commit leaves the places as they are.
- **A layout that was committed before** stays in git until it is removed
  from it there, and git keeps showing its changes. BaseHalf does not do
  that for the user.
- **A git command that deletes ignored files deletes every arrangement.**
  Cleaning a repository of ignored files, or stashing them, takes the
  layouts with it, also the places the user chose. Nothing brings them
  back, because git never had them.
- **A folder that two computers share through a file-sync service** shares
  its layouts as files. The later write stands.
- **A file of the user's that is named `canvas.yaml`.** What BaseHalf keeps
  for a file is under a directory with the file's path, and a folder's
  layout is the file `canvas.yaml` under the folder's path. For such a file
  the two are the same path. This is as old as the mirror, and the same
  holds for a file named like any other mirror file. It matters more now,
  because every shown folder has a layout: in a shown folder such a file can
  have no description. Where the directory was there first, the layout of
  that folder cannot be written, and its cards keep the places they are
  drawn at for the window only.
- **A copy whose original is deleted later.** The copy is drawn as a new
  card at the end. When the original is deleted and following moved items
  takes the copy for the moved item, the copy's card goes to the place the
  original had.
- **A row of the user's whose item is gone** keeps its place taken. A new
  card is not put there, and the place looks empty. A card that the user
  points at is put there all the same.
- **A card that the user points at can cover another card.** A line that is
  released just beside a card gives a new card that lies on it. BaseHalf
  does not move either of them.
- **A card that is pointed at near the edge of the window is partly outside
  it.** The view stays where the user had it. A note that is created there
  opens for typing all the same, also when its first line is outside the
  window.
- **A card made with the Create button can move the view.** When no place
  in the window is open, it goes to the end of the canvas, and the view goes
  to it and fits it, as for the card of a project made from a template.
- **A card with little room stays small.** The card of a picture grows only
  into room to its right and below it, and only as far as the grid's gaps,
  so a card among others, as in a grid from before this rule, is smaller
  than its full shape until the user moves the cards around it away. A card
  that appears with many other pictures is placed with the ratio of its kind
  when its picture was not measured within the 1 s that one drawing waits,
  and takes its shape where it is afterwards.

## Compatibility

None is needed (the product has not been released). A layout written by an
earlier build is read as it is, and its rows are the user's. A layout that
git already tracks stays tracked ([Limits](#limits)). Cards that have
no row in it appear when their canvas is next drawn, at the end of that
canvas. In that one drawing they leave the places the earlier build computed
for them.

## Specifications this changes

When the part is implemented, the same commit updates:

- [workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md):
  "Opening a folder no longer creates `.bh/` by itself"; the table of what
  BaseHalf persists, where `canvas.yaml` is no longer shared and the ignore
  file is new; the sentences that BaseHalf does not create a `.gitignore`,
  which now mean the user's, and that the layout travels with what is
  committed; and the release notes, which no longer need to recommend
  ignoring `.bh/cache/`;
- [agent skill](agent-skill.md): when `.bh/` appears, the sentence that
  opening a folder writes nothing, and the skill's content and version where
  they say so;
- [following moved items](following-moved-items.md): step 4 of "Relocation",
  where a chosen row at the new path gives way and where a row that changes
  folder gets its place; the sentences that opening a folder writes nothing
  in the workspace; "What the user sees" and "Changed after the trial",
  where they name an automatic or a nearest free place; the wait of the
  canvas, which now covers every shown item; and the measurements;
- [mirror file resilience](mirror-file-resilience.md): the term "layout
  file", the rows that are kept on reading, which gain the optional `auto`,
  and the table of what the user sees, where cards without a readable row
  are "placed as never positioned";
- [spec-driven development](spec-driven-development.md): the known gap of the
  source-tree guard. A place that BaseHalf chose is never written in a
  marked folder unless the user changes that canvas;
- [architecture invariants](../harness/architecture-invariants.md): the rule
  itself, the sentence on what BaseHalf writes without a user action, and
  "no `.gitignore` edits", which now means the user's file.

The [harness](../harness/README.md) route and
[D46](../decisions.md#d46--every-card-has-a-saved-place-and-places-stay-out-of-git-new-2026-10-11) were
written with this document.

## Acceptance criteria

1. **First drawing.** A folder with items and no layout is drawn as the plain
   grid in list order. Afterwards its layout has one chosen row for each
   shown card, with the place and size the card is drawn at.
2. **Shown is stored.** On any canvas whose layout can be written, the place
   and size of every drawn card are those of its row once the drawing's
   write has finished.
3. **A file is added.** A file that is added outside BaseHalf to a shown
   folder gets a chosen row at the end. Every row that was there is
   unchanged, and no card is drawn elsewhere in any frame.
4. **Not sorted in.** A file whose name sorts before all others is at the
   end too.
5. **A file is removed** outside BaseHalf. The other rows are unchanged.
   Once following moved items has given the item up, its chosen row is no
   longer in the layout. A row of the user's is still there.
6. **Several at once.** Twelve files that are added at once get twelve
   places that follow each other in list order. None of them meets another
   card.
7. **The end.**
   - The last row has room: the card is in that row, 340 after the last
     card.
   - The last row is full: the card is at the row's start, 280 below.
   - Twelve cards in the plain grid, and the first one dragged 100 to the
     left and 37 up: the thirteenth card is still beside the twelfth.
   - The user's cards are spread wider than five cells: the rows of new
     cards are that wide.
   - The user's cards leave an empty stretch between them: it stays empty.
   - The last card is a video generation card: the next card is 40 to the
     right of it, and a new row starts 60 below it.
8. **Computed.** A card created with the Create button is centered on the
   middle of the visible part of the canvas when it is open there, also a
   16:9 video draft of 533 × 300 at 100%. When the middle is taken, it is at the
   nearest open place. When the visible part of the canvas has no open
   place, it is at the end, and the view goes to it. Its row is the user's.
9. **Dropped together.** Five files are dropped at a point where the first
   slot of their block is taken. Four are in their slots. The fifth is at
   the nearest open place to its slot. None meets a card that was there.
10. **The user's drag.** A card dropped on another card is saved where it
    was dropped, as a row of the user's. A first drag in a folder changes
    that card's row and no other. Undo puts the chosen row back.
11. **To another folder.** An item moved through the workbench into a folder
    whose layout has rows has no row in the old layout and one chosen row in
    the new one, with the same size, at the end of that canvas. No other row
    of either layout changes. Into a folder without a layout, nothing is
    written there.
12. **Followed, and repeatable.** Criterion 11 holds for an item that was
    moved outside BaseHalf. When relocation is stopped after the row was
    written in the new layout and before it was removed from the old one, a
    second run removes the old row and changes nothing else, and a third run
    changes nothing.
13. **Renamed outside.** A file that is renamed outside BaseHalf in a shown
    folder keeps its place and size. The layout never holds two rows for it.
14. **Drawn before it was known.** A file is copied in a shown folder and
    drawn as a new card with a chosen row. Then the original is deleted and
    the copy is paired with it. The layout has one row for the copy, with
    the place and size the original had.
15. **The user's row stands.** As 14, with the copy's card dragged before
    the original is deleted: the copy's row is unchanged.
16. **Back.** A card is moved into another folder and the move is undone: it
    has the place and size it had, and is a chosen row when it was one. When
    another card was put on that place meanwhile, it is at the end.
17. **Gone.** A file that was drawn as a new card and then deleted leaves no
    row once it is given up. The cards that were placed after it do not
    move.
18. **Two writers.** Two windows show the same folder when a file is added.
    The layout has one row for it and both windows draw it there. A card
    that a move writes into the same layout at the same moment does not meet
    it.
19. **Marked folder.** Showing a canvas in a marked workspace folder writes
    nothing. The cards are drawn in the plain grid and do not move while the
    window is open. After the user drags one card, the layout has a row for
    every shown card and no other card has moved.
20. **A layout that cannot be read.** Showing a canvas whose layout is
    `partial` or `unreadable` writes nothing. After the user drags one card,
    the layout has a row for every shown card and a recovery copy exists.
21. **A write that fails.** The cards are drawn, nothing is shown to the
    user, and the rows are written at a later drawing once the cause is
    gone.
22. **More than 300.** A folder with 320 files gets 300 rows. A file added
    then gets no card. After one shown file is deleted, the first file
    without a card gets one, at the end.
23. **A generation card** that appears, a draft or one with its file, gets a
    row of its picture's shape: 533 × 300 for a 16:9 video draft and
    300 × 300 for a square image draft. A draft's row stays while the draft
    is there.
24. **Case only.** On a volume that ignores letter case, a file whose name
    changes only in case keeps its row, and no second row is written.
25. **Nothing else.** Showing canvases writes only `canvas.yaml` files under
    `.bh/mirror/` and the ignore file.
26. **In the product.** With the notes folder of the trial of 2026-10-11,
    starting without layouts: opening it creates the layouts of the folders
    that are shown; twelve files added at once, a note moved into a folder
    of placed cards, and folders added by an agent tool are drawn without
    meeting another card; and in every frame every card that was there is
    where it was.

27. **Git shows nothing.** In a git repository without `.bh/`: after the
    folder is opened, canvases are shown, and cards are dragged, git reports
    no change and no new file. After a card is described and connected, git
    reports those files and no layout. The same holds when the folder
    becomes a repository only after it was used, when the workspace folder
    is below the repository's root, when the user's own ignore file has a
    rule that would include the layouts, and when everything is added to git
    at once.
28. **A file named like a layout.** A file of the user's that is named
    `canvas.yaml`, in a folder that has no layout, has a description. Git
    reports the description.
29. **The ignore file.** It is written before the first layout. One that is
    there with other content is not changed. One that was deleted is written
    again before the next layout write. The user's own `.gitignore` is
    byte for byte what it was. A file that a write under `.bh/` goes through
    does not show in git either.
30. **Two drawings close together.** A file is added and drawn. A second file
    is added, and the drawing for it reads the layout before the place of
    the first is saved and gives the cards their places after. The first
    card is where it was drawn.
31. **Not gone.** A listing of the folder that leaves out a file that is
    there removes no row. A file that was renamed outside BaseHalf while its
    move is held back keeps its row.
32. **A larger card in another folder.** A card that was drawn as a new card
    in another folder, and whose followed size would reach a neighbour
    there, is at the end of that canvas. A second run changes nothing.
33. **Another item at a path that was left.** After a card was moved to
    another folder in BaseHalf, an item of the same name that is moved to
    the old path from a third folder is at the end, not at the place the
    first one had.
34. **Pointed.** A card created at a point of the canvas has its top left
    corner at that point. A card created from a connection line has the
    middle of the side that the line enters at the point where the line was
    released, for a line from each of the four sides. Both hold within one
    screen pixel, at 40% and at 100%, and also:
    - when the card reaches into another card or lies on it;
    - when the card reaches past an edge of the visible part of the canvas;
    - when a row whose item is gone is at that place.

    The row has the place the card is drawn at and is the user's. No other
    row changes.
35. **The view stays.** Creating a card at a pointed place does not move
    the view and does not change the zoom, also when the card reaches past
    an edge of the visible part of the canvas. A note that is created partly
    outside the window has the keyboard: what is typed goes into the note,
    and nothing moves.
36. **Not from the view.** The same line, released at the same place of the
    canvas at two zooms and with the canvas moved, gives the same place
    within one screen pixel.
37. **The shape of a picture.** In a folder that is shown for the first
    time, a 16:9 MP4, a 9:16 MOV, a square PNG, a 3:4 JPEG, and a 4:1
    panorama get rows of 533 × 300, 300 × 533, 300 × 300, 300 × 400, and
    900 × 300, and no card reaches into another.
38. **The shape follows.** A draft whose ratio goes from 16:9 to 9:16, with
    nothing below it, is 300 × 533 where it is. An image file replaced by
    one of another ratio takes that ratio. Each of these rows is saved,
    keeps its place, and no other row changes.
39. **The room.** In a canvas of the plain grid from before this rule,
    300 × 220 cards in cells of 340 × 280, a 16:9 video takes 300 × 169, a
    3:4 image with a card below it 165 × 220, a 9:16 one 140 × 220 with the
    image fitted inside, and no card reaches into another. Moving the card right of the video away makes the video
    391 × 220 where it is, as high as the card below it allows, and its row
    says so. A note moved to 20 beside a card leaves that card as it is. A
    video row of 720 × 405 becomes 533 × 300, and a card that already lies
    over another one does not grow over it.
40. **Each version shows.** A 2048 × 2048 PNG on the canvas is cropped to
    16:9 in Card Detail, which is closed before the write lands. Once the
    write lands, the card shows the picture of 2048 × 1152 and is 533 × 300,
    from the same frame on, recorded on every frame: no frame shows the card
    without a picture, or the new picture in the old shape. A video trimmed
    and a sound cut the same way play their new length on
    their cards. So does a version that an undo or a redo of the edit
    writes, or another program, whether it writes the file in place or
    moves a new version over it: the card changes in one frame there too.

## Verification

- Unit tests of the canvas model for the plain grid, the end of a canvas,
  the nearest open place, and the block: criteria 4, 6, 7, 8, 9, 22, 23.
- A unit test of the canvas scene for the place of a card made from a
  line: criterion 34.
- The smoke step `canvas-create-from-connection` for criteria 34 and 35 in
  the real window: a line released where the card reaches past the edge of
  the window, and a line released beside a card. On the code before D50 the
  step fails: the card was 680 to the left of the release point and 560
  above it.
- Criteria 34 to 36 in the real window on 2026-10-12, as recorded below.
- Unit tests of the canvas mirror for the mark, for saving the places of
  cards that appeared, for the ignore file, for a row that follows its
  item, and for a card that comes back: criteria 11, 12, 16, 29, 32, 33.
- Unit tests of the chosen places, on a file system with the real mirror
  service, for how and when a place is saved: criteria 1, 2, 3, 5, 17 to
  21, 24, 25, 30, 31.
- A test with the moved-items service and the cascade for a row that
  BaseHalf chose and whose file is moved outside BaseHalf: criteria 12 to
  15.
- Smoke steps in the real window, in a fixture that is a git repository:
  `first-canvas-render-saves-places-out-of-git` for criteria 1, 2, 25, and
  27, and `canvas-new-files-go-to-the-end` for 3, 4, 6, 10, and 27, with
  every frame sampled while files are added.
  `canvas-card-follows-outside-rename` and
  `canvas-cards-follow-many-outside-renames` cover criterion 13.
- Criterion 28 was checked in a git repository by hand on 2026-10-11, when
  the ignore rules were written.
- Criterion 26 in the real window, with frames sampled as in the trial of
  2026-10-11.
- Unit tests of the canvas model for the shape of a picture and the room at
  a card's corner, of the canvas mirror for saving a size, of the picture
  shapes for measuring once per version, and of the catalog for a draft's
  ratio: criteria 23, 37, 38, and 39.
- The smoke steps `canvas-create-menu-makes-drafts` and
  `video-new-video-makes-draft` for criteria 8 and 23, and
  `video-picture-cards-keep-their-shape` for two images laid out in the
  earlier grid (criterion 39).
- Unit tests of the addresses by which a card loads its picture, its video,
  or its sound and by which a picture is measured, and the smoke step
  `card-detail-edit-shows-on-its-card`, which crops an image and closes
  Card Detail before the write lands: criterion 40.
- Criteria 37 to 39 in the real window on 2026-10-23, as recorded below.

### Tried in the real window, 2026-10-11

The notes folder of the earlier trial (82 invented notes in eight folders,
some described), as a git repository, with every layout removed first.

| What was done | What was seen |
| --- | --- |
| The folder was opened | 10 cards in the plain grid, 10 rows saved, none on another. The ignore file was written. Git reported nothing new. |
| Twelve files were added to the root at once | All drawn and saved after 0.47 s. In 237 frames no card that was there was drawn elsewhere or missing. No row changed. The twelve followed the last card. |
| A note was moved outside the window into a folder whose canvas had been shown | Its row was at the end of that canvas after 0.5 s, as a place BaseHalf chose. No row of that folder changed. |
| An agent tool's two folders were added | Their cards followed the last card. In the trial before this change they lay behind two folder cards. |
| One of twenty notes was renamed outside, then the other nineteen at once | The new names showed after 1.0 s and 1.3 s. All twenty kept their place. Nobody had placed these cards by hand. |
| At the end | Git reported the notes, and the descriptions that had followed the renamed notes. No layout, no ignore file, no working file. |

The smoke found two things that the unit tests had not: the redraw after the
wait for a moved item replaced a description that was being typed, and the
card of a project made from a template was at the end of the canvas, out of
sight. Both are fixed and described above.

A review of the code found, among smaller things: a save that landed while
the next drawing was being prepared moved its card; one listing of a folder
was enough to remove a row; and a move that was held back lost a place that
BaseHalf had chosen. Criteria 30 to 33 are for these.

### Tried in the real window, 2026-10-12

A folder like the user's own before the reported cards were made: a note of
501 × 851, three other notes, and the row of a folder that is gone. The
canvas was 980 × 803 screen pixels. Every line came from a side of the large
note and ended in the menu's Note, or Image where it says so. Release points
were whole screen pixels.

| What was done | Before D50 | With D50 |
| --- | --- | --- |
| 100%: a line from the right side, released 150 to the right of the note | The card was at the end of the canvas, 351 to the right of and 1,288 below where it was pointed, out of sight. | The card is where it was pointed. 97% of it is in the window. |
| 100%: a line from the left side, released 120 from the left edge of the canvas | At the end of the canvas, 1,598 lower | Where it was pointed. 40% of it is in the window. |
| 150%: lines to the left, to the right, and up, released 46 to 60 from that edge of the canvas | Not tried here. The user's own two cards of that afternoon, from lines pulled to the left, were at (−24, 176) and (316, 176): the first two places of a new row at the end of the canvas, below the note. | Each where it was pointed, with 10% to 18% of the card in the window. The note had the keyboard, and what was typed went into it. |
| 40%: a line from the top, released where the card reaches past the top of the window | 279 lower, one step of the search | Where it was pointed. A quarter of it is in the window. |
| 40%: a line released so that the card reaches into the card made just before | Not tried. In the user's folder: 840 lower. | Where it was pointed, lying on that card |
| 40%: a line released beside the row of the folder that is gone | Not tried | Where it was pointed |
| 40%: lines from the right, left, top, and bottom side, and an Image node | Not tried | Each where it was pointed, with 0.0 screen pixels between the row and the point. No other row changed. |
| The same point of the canvas at 40%, at 100% with the canvas moved, and at 60% with the canvas moved | Not tried | The rows were at (855.0, −401.3), (855.0, −402.3), and (855.0, −402.2): less than one screen pixel apart at each zoom. |
| 100%: a double-click 100 from the right and 80 from the lower edge of the canvas, then New Note | Not tried | The card's top left corner is at the point. The rest of the card is outside the window. |
| 100%: a double-click on empty canvas with room around it, then New Note | Not tried | At the point |

With D50 the view was where it had been in every row, at the same zoom, and
no element around the canvas had scrolled.

One thing was built and taken back the same day. A first version moved the
view by the least distance that showed the whole card, 33 to 224 screen
pixels in these trials. The user did not want it
([why the view stays](#a-pointed-place-is-taken-as-it-is)).

### Tried in the real window, 2026-10-23

The shapes of picture cards (D66), in a test workspace: a canvas laid out in
the plain grid of 300 × 220 cards, with three copies of one video that is a
little wider than 16:9, a 16:10 image, a note, a sound, a PDF, a video the
window decodes from an MKV file, and a folder; and a folder that was never
shown, with a square, a 9:16, a 3:4, and a 4:1 image, a video, and a note.

| What was done | What the canvas showed and saved |
| --- | --- |
| The grid canvas opened | The videos with a card to their right were 300 × 169 and the image 300 × 188, in their cells. The video with nothing to its right or below it was 534 × 300. The note, the sound, the PDF, and the folder kept their sizes. No two cards crossed, none was closer than the gaps, and every row said what was drawn. |
| The note to the right of a video moved away | The video was 391 × 220 where it was, as high as the image below it allowed, and its row said so. |
| A note moved to 33 over the 534 × 300 video, then to 20 beside it | The video stayed 534 × 300 both times. |
| One card of each kind selected | A note, the PDF, and the folder had four resize corners, the videos, the image, and the sound none. |
| The folder that was never shown opened | 300 × 300, 300 × 533, 300 × 400, 900 × 300 with the 4:1 image fitted inside, and 534 × 300, placed at the end with nothing crossing. |
| The square image replaced by one of 600 × 300 | 300 × 150 where it was: the card 40 to its right allowed no more. |
| A draft written as an agent writes one, with its ratio set to 9:16, 16:9, 21:9, and 1:1 in turn | It appeared at 300 × 533, then was 533 × 300, 700 × 300, and 300 × 300 where it was. |

## Measurements

Every shown item is now followed, and every drawing of a canvas with new
cards writes a layout. Before this work is called done, these are measured
on the notes folder of the trial and on a folder of 300 files, next to the
same runs without this change, and the numbers are recorded here:

- the time from opening a folder to its first drawing, with and without a
  snapshot;
- the time a comparison takes after one file was renamed outside BaseHalf,
  and after twenty;
- what one automatic write costs following moved items, which lists the card
  information of the workspace folder again when a layout changes;
- the time to fingerprint the first 200 files below each folder card of a
  canvas with twenty folder cards;
- the size of the snapshot for a workspace in which 5,000 items were shown.

A first drawing that is later by more than 100 ms, a rename that is no
longer followed inside the time the canvas waits, or a snapshot above
50 MiB is not accepted. The limit that avoids it is then set from the
numbers and written into
[following moved items](following-moved-items.md#limits).

### Measured on 2026-10-11

On one machine, in the real window, with the build before this change and
with this one.

| What | Before | After |
| --- | --- | --- |
| The notes folder of the trial: from starting the window to the first card, median of five | 3,045 ms | 3,053 ms |
| A folder of 4,300 invented notes, 20 folders of 200 and one of 300: from starting the window to the first card | 2,543 ms | 2,560 ms |
| The same folder: the snapshot after its root was shown | 0.12 MiB | 3.4 MiB |
| The same folder: the snapshot after the folder of 300 was shown too | 0.12 MiB | 3.5 MiB |
| The same folder: the layout of the folder of 300 | none | 36 KiB |
| A note of the 300 renamed outside: until its card shows the new name | 0.3 s, as a new card whose neighbours shift | 0.7 s, at its place |
| The notes folder: one of twenty notes renamed outside, then nineteen at once | followed only where a card was described or placed | 1.0 s and 1.3 s, all twenty at their places |
| The notes folder: a note moved outside into another folder, until its row is there | not followed unless described or placed | 0.5 s |

- The first drawing is not later in a way that can be noticed.
- A rename is followed well inside the time the canvas waits. That time was
  two seconds then and is ten now
  ([following moved items](following-moved-items.md#what-the-user-sees)).
- The snapshot grows by about 0.8 KiB for each file under a shown folder
  card, up to 200 files for each. A workspace in which 5,000 items were
  shown stays near 4 MiB, far below the limit.
- A file that nobody had touched and that is renamed outside now takes
  about half a second longer to show its new name. Before, it showed at
  once, in a new place. The wait is what keeps the card where it was.

One number was changed by these measurements. With every card followed, the
wait of following moved items is in every rename outside BaseHalf, and it
was one second: the three rows above read 1.3 s, 1.6 s and 1.7 s, and
1.2 s. One second had never been measured. It is 300 ms now
([following moved items](following-moved-items.md#when-basehalf-compares)),
and the rows show what was measured with it. The machine was under load
during all of these runs.

## Open questions

None that block implementation. The tidy command is specified in
[canvas selection and arrangement](canvas-selection-and-arrangement.md#tidying-a-canvas):
the order it gives, that it leaves rows without a card as they are, and how
it is kept, reverted, and undone.
