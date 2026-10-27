# Dropping into a folder

Status: Active (2026-10-27; the look of a folder that takes a drop, D92)
Decision: [D88](../decisions.md#d88--cards-let-go-on-a-folder-go-into-it-new-2026-10-27),
[D92](../decisions.md#d92--a-folder-that-would-take-a-drop-grows-and-glows-yellow-new-2026-10-27)
Related: [canvas card placement](canvas-card-placement.md) (where the cards
appear in the folder), [following moved items](following-moved-items.md)
(what follows an item that moves), [exact undo](exact-undo.md) (one step of
undo), [canvas selection and arrangement](canvas-selection-and-arrangement.md#moving-a-set)
(moving a set), [the location in the title bar](title-bar-location.md) (the
folders of the path),
[canvas card interaction continuity](canvas-card-interaction-continuity.md#a-change-elsewhere-in-the-workspace)
(the gesture right after a drop), [generation cards](generation-cards.md#moving-renaming-copying-and-undo)
(drafts)

## The rule

**Where the pointer is when the button is let go decides.** Over a folder's
card, the dragged cards go into that folder. Over a folder of the path in
the title bar, they go into that folder. Anywhere else on the canvas, they
stay where they were let go, as before. Outside the canvas anywhere else,
they go back to where they were, as with Escape.

The same holds for an item dragged from Files and a file dragged from outside
the window: let go on a folder's card, it goes into that folder.

## Problem

Measured on 2026-10-27 in a development window on main (`6588a2412`), on a
canvas with two notes, two folder cards, and a note that names one of the
notes upstream:

- A card dragged with the pointer over a folder's card landed on top of it,
  as on any card. Nothing showed that the folder could take it, nothing
  moved, and undo put the card back. A card went into a folder only by Cut,
  opening the folder, and Paste, and the user was then on the folder's
  canvas, not on the one they came from.
- An item dragged from Files onto a folder's card, or onto the canvas, did
  nothing: the canvas took only files from outside the window.
- A card dragged onto a folder in Files, or onto the workspace's name in the
  path, moved nothing. The canvas kept moving while the pointer was outside
  it: one drag towards the title bar moved the view 790 screen pixels, and
  the card was left where the pointer had gone, out of sight.
- Right after a rename in Files, the next drag of a card went back to its
  place when it was let go (3 of 3), a drag held while a file was renamed
  went back (2 of 2), and the first click on empty canvas was lost (3 of 3).
  A drop into a folder is such a move: the drag right after it would have
  failed the same way
  ([canvas card interaction continuity](canvas-card-interaction-continuity.md#a-change-elsewhere-in-the-workspace)).
- The look that came of it, measured later on 2026-10-27 on main
  (`e4523148c`) with a note held over a folder's card, at a zoom of 93
  percent: the note, 280 by 205 screen pixels, covered most of the folder's
  card, 232 by 176, and the folder showed that it would take the note only at
  the edges the note left free, with a ring and a tint of the canvas's intent
  blue, the blue of a connection that would be made. It kept its size. The
  user asked for a folder's card that grows and shows a yellow glow, the sign
  that it can take the file, without words.
- With that look built (`39126e613`), a note held over the middle of a
  folder's card still snapped to it: the snap guides of the folder's middle
  crossed the glow, and the note stayed on the folder's middle while the
  pointer moved up to 5 screen pixels, though it was going into the folder
  and its place no longer mattered.

## What three references do

- A desktop file manager marks a folder while the pointer is over it during
  a drag, and an item let go there moves into it. The pointer decides, not
  the dragged icons, which are drawn translucent so that the folder shows
  under them. The folders of its path bar and of its sidebar take a drop
  too. When the name is taken there, it asks; to keep both, it names the
  moved item with a number after its name.
- A canvas editor finds the shape that dragged shapes would go into by the
  point under the pointer, leaving the dragged shapes out.
- An open-source canvas for media work puts a dragged node into a group when
  the node's center is inside the group, and marks the group in its
  selection color while it would: its border, a ring, and a light tint of
  the color over it.

## Goals

- A card, or a set of cards, dragged onto a folder's card goes into that
  folder, in one step of undo.
- While dragging, the folder that would take the cards shows it: its card
  grows a little and glows yellow, with no words. The cards show that they
  would go, and nothing snaps them while it takes them.
- A card comes out of a folder the same way: onto a folder of the path in
  the title bar.
- An item from Files and a file from outside the window go into a folder's
  card the same way.
- The view does not move by itself while the pointer is outside the canvas.

## Scope

In scope: dragging cards on the canvas, a set by its box included; a folder's
card and the folders of the path in the title bar as places to drop them;
items from Files and files from outside dropped on a folder's card or on the
canvas; what a drop moves, how a taken name is kept, its undo; what shows
while dragging.

Not in this version:

- Opening a folder by holding the pointer over it while dragging, to drop at
  a point of its canvas.
- Dropping cards onto a folder in Files. Files takes drops of its own items
  as before.
- Copying instead of moving with a modifier key.
- Dropping items from Files, or files from outside, onto a folder of the
  path.

## Terms

- **Dragged cards**: the card being dragged, or every card of a set that is
  moved by its box.
- **Taking folder**: the folder that letting go now would put the dragged
  cards into.

## Required behavior

### Which folder takes them

- **A folder's card**: the card on top under the pointer, as the canvas draws
  it, leaving the dragged cards out. Where another card lies over the
  folder's card at the pointer, the folder does not take them there. The
  taking folder takes them over all of its card as it is drawn, grown
  included: the pointer keeps it while it is over what shows it.
- **A folder of the path**: the workspace folder, and every folder between
  it and the folder whose canvas is shown, that the path shows. The shown
  folder itself, the current place, takes nothing: the cards are in it
  already. "…" takes nothing.
- A folder's card that is one of the dragged cards takes nothing, so a
  folder never goes into itself.
- Every kind of card goes into a folder as a file does: notes, files,
  folders, pictures, videos, sounds, documents, and generation cards, drafts
  and cards that generate included
  ([generation cards](generation-cards.md#moving-renaming-copying-and-undo)).

### While dragging

- **The taking folder's card grows and glows yellow.** It grows to 108
  percent of its size around its middle, its caption with it, in 150 ms. Its
  border turns yellow, a ring and a soft glow of the yellow lie around it,
  and a light tint of the yellow lies over its face. No words are drawn.
  When the pointer leaves it, or the drag ends, it goes back in the same
  time. The yellow (`#f0c54c`) is the gold of a folder's glyph made bright;
  the canvas's intent blue stays the sign of a connection.
- Growing moves no other card and saves nothing: the card is drawn larger
  over its place. What is drawn over the folder's card stays over it, the
  dragged cards too.
- With reduced motion, the card does not grow, and the yellow shows at once.
  With forced colors, an outline in the system's highlight color is drawn
  around it.
- The dragged cards are drawn at half their opacity while a folder takes
  them, so that the folder shows under them. When the pointer leaves the
  folder, both are drawn as before.
- **No snapping while a folder takes them.** The canvas draws no snap guides
  and snaps the dragged cards neither to the folder's edges and middle nor to
  any other card: they go into the folder, so where they would line up does
  not matter. They follow the pointer exactly. When the folder no longer
  takes them, guides and snapping are back at the next move. The same holds
  while a folder of the path takes them.
- **Nothing jumps.** When a folder takes them, the cards keep the place that
  snapping gave them at the last move and from there move exactly as the
  pointer moves. When it lets go of them, snapping goes on from where they
  are: it pulls them to a line only as it does anywhere on the canvas, from
  within 5 screen pixels of it.
- A folder of the path that takes them shows the same yellow around its
  name, without growing: the path is a row of names, and a grown name would
  cover its neighbours.
- Near the edge of the canvas, inside it, the canvas moves as before. While
  the pointer is outside the canvas, it does not move.

### Letting go on a folder

- Every dragged card's item moves into the taking folder, as one step of the
  canvas undo, named "Move `<name>` to `<folder>`" for one item and "Move
  `<n>` items to `<folder>`" for more.
- The cards leave the canvas when they are let go, and the folder's card
  goes back to its size. No card is selected afterwards.
- Their card information and the entries that name them follow, as after
  any move in the workbench ([following moved items](following-moved-items.md),
  [reference graph](reference-graph.md#rename-refactor)). A connection
  between a moved card and a card that stays is kept, and its line leaves
  this canvas with the card.
- **A name the folder holds.** The item keeps both names: it takes the first
  free name with a number after its name, before the extension. `plan.md`
  becomes `plan 2.md`, then `plan 3.md`; the folder `notes` becomes
  `notes 2`; `plan 2.md` counts on to `plan 3.md`. Nothing asks: a desktop
  file manager names a moved item it keeps beside another this way, and
  undo gives the move back. A paste of cut items names a taken name the
  same way ([exact undo](exact-undo.md#what-the-canvas-made)). A draft takes
  the next free name of a draft
  ([generation cards](generation-cards.md#moving-renaming-copying-and-undo)).
- **In the folder's canvas** each card is after the last card, with the size
  it had ([canvas card placement](canvas-card-placement.md#a-row-follows-its-item)).
- The folder's card lists them as soon as it is drawn again.
- **Undo** brings every item back into the shown folder, each card at its
  place and with its size, a place BaseHalf chose as one it chose, and with
  its connections. Redo moves them again. One step holds files, folders,
  and drafts together.

### Letting go elsewhere

- Anywhere else on the canvas, the cards stay where they are let go, also on
  another card, as before
  ([canvas card placement](canvas-card-placement.md#what-the-user-changes)).
- Outside the canvas, not on a folder of the path, every card goes back to
  where it was, as with Escape, and nothing is saved. A user who drags out
  of the canvas is on the way to a folder; a card let go elsewhere is not
  left out of sight.

### From Files and from outside the window

- An item dragged from Files onto a folder's card moves into that folder, as
  a card does, with the same names and the same one step of undo. Let go
  elsewhere on the canvas, it moves into the shown folder, and its card is
  at the point, as a paste of a cut item is
  ([canvas card placement](canvas-card-placement.md#pointing)). An item that
  is in the shown folder already stays where it is.
- A file dragged from outside the window onto a folder's card is copied into
  that folder. Let go elsewhere on the canvas, it is copied into the shown
  folder at the point, as before. A copy is named and undone as before
  ([exact undo](exact-undo.md#what-the-canvas-made)).
- The taking folder's card grows and glows while the pointer is over it, as
  for cards.

### Failure

- When the taking folder is gone by the time the cards are let go, or a move
  fails, what could not be moved stays in the shown folder, its card back at
  its place, and the canvas says why. What was moved before the failure is
  in the folder, and undo brings it back.
- A folder dropped into one of its own folders, as an item from Files can
  be, is refused with the reason, and nothing moves.
- A move between workspace folders is refused, as in Files.

### After the drop

The drop is a move in the workbench. The next drag and the next click on the
canvas work at once
([canvas card interaction continuity](canvas-card-interaction-continuity.md#a-change-elsewhere-in-the-workspace)).

## Acceptance criteria

1. **One card.** A note dragged with the pointer over a folder's card: the
   folder's card grows and glows yellow and the note is half transparent
   before it is let go. Let go, the note is in the folder, its card is not
   on the canvas, and the folder's card lists it. One undo puts the note
   back, its card at its place and size; redo moves it again.
2. **A set.** A note, a folder, and a draft, selected and dragged by the set
   box onto a folder's card, go into that folder as one step; one undo
   brings all three back.
3. **The pointer decides.** A card dragged so that it covers a folder's card
   while the pointer is beside it is saved where it is let go, and nothing
   moves.
4. **Not into itself.** A folder's card that is dragged never grows or glows
   itself; another folder's card takes it.
5. **A taken name.** `plan.md`, which a note names upstream, dropped on a
   folder that holds `plan.md`, is `plan 2.md` in it, and the note's entry
   names the new path. Undo brings `plan.md` back under its name.
6. **Out of a folder.** On a folder's canvas, a card dropped on the
   workspace folder's name in the path moves to the workspace folder; the
   view of the folder's canvas does not move. Undo brings it back.
7. **Outside.** A card let go over Files is back at its place, and nothing
   moved; the view did not move while the pointer was outside the canvas.
8. **From Files.** A file dragged from Files onto a folder's card moves into
   it; onto the canvas, it moves into the shown folder at the point.
9. **From outside.** A file dragged from outside the window onto a folder's
   card is copied into it.
10. **The next gesture.** Right after a drop into a folder, a drag of another
    card stays where it is let go, and the first click on empty canvas ends
    the selection.
11. **The look.** Sampled on every frame while a note is held over a
    folder's card: the folder's card is at 108 percent of its size within
    150 ms of the first frame that marks it, its border and its glow are the
    yellow, and no other card moves. With the pointer on its grown edge,
    outside its place, the folder still takes the note; off it, the folder
    is at its size and look again within 150 ms. An item from Files and a
    file from outside the window get the same look. With reduced motion the
    folder keeps its size and the yellow is there in the first frame that
    marks it. A folder of the path that takes a card shows the yellow around
    its name.
12. **No snapping.** While a note held over the middle of a folder's card
    makes the folder glow, no snap guide is drawn, and a move of the pointer
    by 3 screen pixels moves the note by the same 3 pixels. Sampled on every
    frame while a note lined up with a neighbour is dragged into a folder's
    card and out again: in the frame the folder takes it, the note moves
    exactly as the pointer does; in the frame the folder lets go of it, it
    moves by no more than the pull of a snap line within 5 screen pixels, and
    the guides are back.

## Verification

- Unit tests: which card takes a drop at a point (the card on top, the
  dragged cards left out, only a folder, the taking folder over its grown
  card but not under a card drawn over it); the cards a folder takes are not
  snapped, keep the place snapping gave them, and are snapped again from
  there when it lets go of them; the canvas does not move for a pointer
  outside it; the names that keep both; the step that moves files and drafts
  and its undo and redo.
- `npm run basehalf:smoke`, canvas suite, step `canvas-drop-into-folder`:
  criteria 1, 3, 5, 6, 7, and 10, of 11 the size, the yellow, the grown edge,
  and the path, and of 12 the guides and the move of 3 pixels. The step
  `canvas-snap-guides` lets its card go off the folder it aligns the card
  with, since a card let go on a folder's card goes into it.
- Real window, per frame while dragging: criteria 1, 2, 4, 5, 8, 9, 11, and
  12, with reduced motion and forced colors.
