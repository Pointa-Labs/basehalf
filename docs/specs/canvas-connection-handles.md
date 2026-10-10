# Canvas connection handles and drop line

Status: Active (2026-10-10)
Related: [reference graph](reference-graph.md#creating-connected-nodes)
(Create from Connection), [canvas card resize](canvas-card-resize.md)

## Problem

Each card has four connection handles, one at the midpoint of each side. A
handle's only hit target was its visible circle: 11 flow pixels across,
centered on the card's outer edge. At 40% zoom that is about 4 screen pixels.
Nothing changed as the pointer came close, so starting a connection meant
hunting for a dot.

After a connection drag was released on empty canvas, the drag line vanished
while the Create from Connection menu was open. The menu then looked detached
from the card it would connect to.

## Scope

In scope: the hit geometry and appearance of the four connection handles, and
the line shown while the Create from Connection menu is open.

Not in scope, and unchanged:

- When handles exist and when they are hidden: while a Note is being edited,
  while the card is moved, and while it is resized.
- Snapping onto a target handle during a drag (a 48-pixel connection radius),
  click-to-connect, connecting into a card, and reconnecting an edge.
- The Create from Connection menu itself, which the reference graph specifies.

## Terms

- **Flow pixels** and **screen pixels** are as defined in
  [canvas card resize](canvas-card-resize.md#terms).
- **Anchor point**: the midpoint of one side of the card's outer edge. Edges
  start and end there.
- **Capture circle**: the hit target of one handle, centered on its anchor
  point. It takes the pointer only where nothing else on the canvas does.
- **Visible circle**: the drawn handle, centered on its anchor point.

## Required behavior

### Capture circle

- The radius is 24 screen pixels, reduced when the card is small on screen so
  that it stays on the straight part of its side: at most half the side's
  length minus the 22-flow-pixel corner radius. It is never smaller than the
  visible circle. With this limit, the four capture circles of a card never
  overlap.
- Pointer priority, from top: cards (their content, caption, and resize
  targets), then the outside half of each snapped-size visible circle (16
  screen pixels across) while the handles are shown, then edges, then capture
  circles, then empty canvas.
  - Inside a card's outline, its content always keeps the pointer. No part of
    a handle takes it there.
  - An edge that passes through a capture circle keeps the pointer where it
    runs, so it can still be selected and reconnected near its ends. Only the
    outside half of the visible circle at the edge's end is above it, so a side
    that already has an edge can still start another.
- A capture circle takes the pointer whenever its handle can be used, also
  while the card is not hovered. A pointer entering it shows the card's
  handles, as hovering the card does.
- Pointer-down inside it starts a connection drag from that handle, and a click
  starts or finishes click-to-connect, as on the visible circle. The cursor is
  `crosshair`. Capture circles are absent while the card's handles are hidden
  (a Note being edited, a card being moved or resized) and while video input
  picking is active.

### Visible circle

- At rest it is 11 screen pixels across with a 2-screen-pixel border, at every
  zoom.
- **Snap**: while the pointer is inside the capture circle, the visible circle
  grows to 16 screen pixels and uses the connection-intent colors. It stays
  centered on its anchor point. At most one handle is snapped at a time.
- Size and color change over at most 80 ms. With
  `prefers-reduced-motion: reduce`, they change without a transition.

### Line while the menu is open

- After a release on empty canvas, the line from the source handle to the
  release point stays drawn while the Create from Connection menu is open. It
  keeps the drag line's path and look, follows pan and zoom, and takes no
  pointer events.
- Closing the menu without choosing (Escape, a click outside the menu, or the
  window losing focus) removes the line in the same frame as the menu. This
  holds for the in-window menu, BaseHalf's default
  ([architecture invariants](../harness/architecture-invariants.md#product-shell)).
  With `window.menuStyle: native`, the OS closes the menu before the window is
  told, and the line goes as soon as the close is reported.
- After an item is chosen, the line stays until the new node's edge is drawn,
  and the edge replaces it. If no new edge from the source appears within
  2 seconds, because the create failed or was refused, the line is removed.

## Acceptance criteria

1. At 40% and 100% zoom, a pointer 16 screen pixels outside a card from one of
   its anchor points, with no other card or edge there, shows the card's
   handles and snaps that handle: its visible circle is 16 screen pixels across
   in the connection-intent color. Pressing and dragging there starts a
   connection.
2. On a card 48 flow pixels tall, the west and east capture circles stay on
   the straight part of their sides, and a selected card still resizes from its
   corners. Text near the middle of a card's left and right edges stays under
   the pointer.
3. An edge between two cards 20 screen pixels apart can still be grabbed and
   reconnected from the part of it between the cards.
4. After a release on empty canvas, the line stays drawn while the menu is
   open, from the source handle to the release point, at 40% and 100% zoom on
   a panned canvas. Escape, or a click on empty canvas, removes it in the same
   frame as the menu. Choosing an item keeps it until exactly one edge
   from the source to the new node is drawn in its place.
5. The smoke covers criteria 1, 3, and 4.
