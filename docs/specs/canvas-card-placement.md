# Canvas card placement

Status: Active (2026-10-11)
Related: [following moved items](following-moved-items.md),
[mirror file resilience](mirror-file-resilience.md),
[architecture invariants](../harness/architecture-invariants.md)

## Problem

A card can end up on top of another card without the user putting it there.
Two things cause it.

1. **A card without a saved place.** A card has a saved place once the user
   has dragged or resized it. Every other card is drawn in a grid slot that
   depends only on its position in the folder's list of items. The saved
   places of the other cards are not looked at, so the slot can be one that a
   placed card already covers.
2. **A card that is carried into another folder.** When an item moves to
   another folder, through the workbench or outside it, its card row goes
   along with the coordinates it had. In the other folder those coordinates
   mean nothing, and another card can be there.

Both were seen in the trial of 2026-10-11 in the real window
([following moved items](following-moved-items.md#verification)). A note that
was moved into a folder lay across two cards of that folder. Two folders that
an agent tool had added lay behind two folder cards that had been placed by
hand, hidden except for an edge.

## What other canvases do

Two canvas products for media work were tried on 2026-10-11, by copying nodes
from one project into another and pasting more than once.

- Neither avoids existing nodes. One pastes at the centre of the view, the
  other at the pointer, and a second paste lands on the first with a small
  offset.
- Both leave tidying to a command the user runs. One arranges the selected
  nodes as a grid or a row, without regard to the nodes that are not
  selected. The other arranges the whole canvas and then asks whether to
  keep the result.

That fits them: there the user chooses where to paste. In BaseHalf a card
appears because a file appeared, and BaseHalf chooses where. So BaseHalf is
the one that must not choose a place that is taken.

## Goals

- BaseHalf never puts a card on another card by its own choice.
- A place the user gave a card is never changed by this.
- Opening a folder still writes nothing.

## Non-goals

- Keeping the user from placing a card on another one. Dragging a card onto
  another stays possible, as it is in the other canvases.
- A command that tidies the whole canvas.
- Which folders and files become cards. Folders whose names start with a dot,
  such as the ones agent tools add, are still cards.

## Terms

- **Saved place**: the row of a card in its folder's `canvas.yaml`, with
  coordinates and size.
- **Automatic place**: where BaseHalf draws a card that has no saved place.
  It is computed each time and never written.
- **Grid slot** of an item: the cell of the default grid that belongs to the
  item's index in the folder's list, which is folders first, then names.
- **Free**: a rectangle is free when, widened by the grid's gap, it meets no
  rectangle it is checked against.

## Required behavior

### Automatic places are free

- The cards with saved places are taken as they are.
- A card whose grid slot is free of every saved place stays in its slot. A
  card that nothing lies on does not move because another one has to.
- The remaining cards are placed in list order. Each takes the nearest place
  that is free of the saved places, of the slots in use, and of the places
  given before it. The search goes outward from its grid slot in steps of
  one card and gap: right, below, above, left, then the diagonals, ring by
  ring.
- A folder in which no card has a saved place is drawn exactly as before:
  the plain grid, in which no two slots meet.
- The size used for a card without a saved place is the default size of its
  kind.
- An automatic place can change when a card is placed onto it: the card that
  had it moves to the nearest free place at the next drawing. The same holds
  today when the list of items changes.

### A card carried into another folder

- The row keeps its size.
- It keeps its coordinates when that place is free of the saved places in
  the other folder's layout. Otherwise it takes the nearest free place,
  searched outward from those coordinates in the same order.
- This is the same for a move through the workbench and for a move outside
  BaseHalf that it followed. The place depends only on the row and on the
  saved places of the other folder, so that relocation of a followed item
  stays safe to repeat: a second run computes the same place.
- A move within a folder, which is a rename, keeps the row as it is.

### What stays as it is

- A card the user drags or resizes is saved where the user left it, also on
  top of another card.
- The place chosen for a card that the user creates at a point on the canvas
  already avoids the cards around that point. That rule is unchanged.

## Limits

- Undoing a workbench move into another folder moves the item back as a move
  in the other direction. When the place was changed on the way in, the card
  comes back at the changed coordinates if they are free in its old folder,
  and at the nearest free place otherwise. It is at its old place only when
  nothing was changed on the way in.
- A video node without a saved place is drawn wider than the default size.
  The search uses the default size, so such a card can still reach under a
  neighbour.

## Acceptance criteria

1. **Free automatic places.** In a folder where saved places cover several
   grid slots, no card without a saved place is drawn on a card with one, and
   no two cards without saved places are drawn on each other.
2. **The plain grid is unchanged.** In a folder with no saved place every
   card is at its grid slot.
3. **Saved places are kept.** Two cards that the user placed on each other
   stay where they are.
4. **Carried into a free place.** An item is moved through the workbench into
   a folder where its coordinates are free: the row has the same coordinates.
5. **Carried into a taken place.** The same with a card at those coordinates
   in the other folder: the row has the nearest free coordinates and the same
   size, and the card that was there is unchanged.
6. **Followed moves.** Criteria 4 and 5 hold for an item that was moved
   outside BaseHalf, and running the relocation a second time changes
   nothing.
7. **In the product.** With the notes folder of the trial: a note moved into
   a folder of placed cards, and folders added next to folder cards that were
   placed by hand, are drawn without lying on another card.

## Verification

- Unit tests of the canvas model for criteria 1 to 3.
- Unit tests of the canvas mirror for criteria 4 to 6.
- Criterion 7 in the real window, with the script and the folder of the
  trial.
