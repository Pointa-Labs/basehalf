# Canvas card placement

Status: Active (2026-10-11; rewritten the same day for D46, reviewed once,
and revised so that the layout stays out of git). Implementation in
progress: until it lands, the code does what the
first version of this document required, which is summarized under
[The first version](#the-first-version). The specifications listed under
[Specifications this changes](#specifications-this-changes) are updated in
the commit that implements the part they describe.
Decision: [D46](../decisions.md#d46--every-card-has-a-saved-place-and-places-stay-out-of-git-new-2026-10-11)
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

## Goals

- What a canvas shows is what its layout stores.
- No card moves unless the user moves it.
- BaseHalf never puts a card on another card by its own choice.
- One rule covers every way a card can come to be on a canvas.
- Opening a folder or moving a card changes nothing that git shows.

## Non-goals

- **A sorted mode.** Cards are in name order only as far as they appeared
  together. A file that is added later is not sorted in.
- **The command that tidies a canvas.** It is planned and is the one way
  BaseHalf will change places the user has, when the user runs it. It gets
  its own section here before it is built.
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
- **Pointed place**: the place a user action named for a new card. See
  [Pointing](#pointing).
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
   300 × 220 for a file, 248 × 188 for a folder, and 720 × 405 for a video
   node. BaseHalf chooses the place when it knows the size. For a node file
   it reads the kind of the node first.
2. **Place.**
   - It was pointed at: the [nearest open place](#the-nearest-open-place) to
     the pointed place.
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

### The nearest open place

Where a card goes that was pointed at.

- The pointed place itself, when the card is open there.
- Otherwise the search goes outward from it in steps of the card's size plus
  the gaps: right, below, above, left, then the four diagonals, ring by ring,
  up to 31 rings.
- For a card that the user creates on the canvas, only places inside the
  visible part of the canvas count, the pointed place included, as before.
- When nothing is found, the card goes to
  [the end of the canvas](#the-end-of-a-canvas).

### Pointing

| User action | Pointed place |
| --- | --- |
| Create a note or a folder at a point on the canvas | that point |
| Create a card from a connection or from a selection in a PDF | the place next to the source card that the action computes today |
| Drop, paste, or move files and folders onto the canvas at a point | for the item at position *i* of *n*: slot *i* of a block of cells that starts at the point and has as many columns as the square root of *n*, rounded up, and at most 4 |
| Anything else: a file that a program or an agent adds, a card that is dragged onto a folder card, a move in the file tree, a move outside BaseHalf | none |

A group that is dropped at a point keeps its block where the block is open.
The cards whose slots are open take them first. Then the others, in order,
take the nearest open place to their slot.

A pointed place is the user's. Its row is not a chosen row.

### What the user changes

- A card the user drags or resizes is saved where they left it, also on top
  of another card. Its row becomes the user's. No other row changes.
- Undo of a drag or a resize puts the row back as it was, a chosen row
  included.

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
    the row that follows.
  - Either way the row at the old path is then removed. A second run finds
    nothing at the old path and changes nothing, so the move stays safe to
    repeat.
- **A row of the user's at the new path stays.** The row that would follow
  stays at the old path, as following moved items requires. BaseHalf never
  replaces a place the user chose.
- **Undo of a move made in BaseHalf** puts the card back. While the window
  is open, BaseHalf remembers the rows that left a layout through a move
  made in BaseHalf, the last 200 for each workspace folder, and stores them
  nowhere. When such an item is moved back to its old path, by undo or by
  the user, its row is restored as it was when that place is open, and the
  card goes to the end otherwise. A move outside BaseHalf uses no memory.

### A chosen row whose item is gone

- BaseHalf removes a chosen row when its item is no longer in the folder and
  following moved items is not waiting to pair it. This happens at the next
  drawing of that canvas, in the write that adds rows. Nothing of the user's
  is lost: BaseHalf chose that place and nobody changed it.
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
the places that wait are saved with it as chosen rows.

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
  ```

  - It hides itself, every layout, and `.bh/cache/`.
  - The third rule keeps the mirror directory of a user's own file that is
    named `canvas.yaml` visible, with the description in it.
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
  a file that was deleted outside BaseHalf stays for about a second before
  it goes.
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
| A card is created at a point | It is at that point, or beside it when the point is taken. |
| Files are dropped at a point | They are in a block at that point. A card whose slot is taken is beside the block. |
| A card is moved into another folder | It is after the last card of that folder, with its size. |
| That move is undone | The card is back where it was. |
| The canvas has become untidy | Nothing changes by itself. The tidy command, when it exists, sorts the cards. |

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
- **A folder that two computers share through a file-sync service** shares
  its layouts as files. The later write stands.
- **A copy whose original is deleted later.** The copy is drawn as a new
  card at the end. When the original is deleted and following moved items
  takes the copy for the moved item, the copy's card goes to the place the
  original had.
- **A row of the user's whose item is gone** keeps its place taken. A new
  card is not put there, and the place looks empty.
- **A size is not carried** into a folder whose canvas was never shown.
- **A card that comes back** after the window was closed, or through a move
  outside BaseHalf, goes to the end.
- **Places that could not be saved** are kept for the window only. After a
  reload they are chosen again, and come out differently when the list of
  items changed meanwhile.
- **A workspace folder without a snapshot**, because it holds more than
  200,000 items, gets saved places like any other. Items renamed outside
  BaseHalf are not recognized there, so they appear as new cards.
- **The new card can be outside the visible part of the canvas.** BaseHalf
  does not move the view to it.

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
   - The last card is a video node: the next card is 40 to the right of it,
     and a new row starts 60 below it.
8. **Pointed.** A card created at a point that is open is at that point. At
   a point that is taken, it is at the nearest open place. When the visible
   part of the canvas has no open place, it is at the end. Its row is the
   user's.
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
    row. The cards that were placed after it do not move.
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
23. **A video node** that appears gets a row of 720 × 405.
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
    `canvas.yaml` is described. Git reports its description.
29. **The ignore file.** It is written before the first layout. One that is
    there with other content is not changed. One that was deleted is written
    again before the next layout write. The user's own `.gitignore` is
    byte for byte what it was.

## Verification

- Unit tests of the canvas model for the plain grid, the end of a canvas,
  the nearest open place, and the block: criteria 4, 6, 7, 8, 9, 22, 23.
- Unit tests of the canvas mirror for a row that follows its item, a chosen
  row that gives way, and a card that comes back: criteria 11 to 16, 24.
- Tests of the canvas with the moved-items service for how and when a place
  is saved: criteria 1, 2, 3, 5, 10, 17 to 21, 25, 29.
- Smoke steps for criteria 1, 3, 10, 13, and 16, and, in a fixture that is a
  git repository, for 27 and 28 by what git itself reports.
- Criterion 26 in the real window, with frames sampled as in the trial of
  2026-10-11.

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

## Open questions

None that block implementation. The tidy command is specified when it is
built: what order it gives, what it does with rows of the user's whose items
are gone, and how it is undone.
