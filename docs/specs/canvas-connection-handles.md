# Canvas connection handles, drop line, and the ends of a connection

Status: Active (2026-10-10). Revised 2026-10-25: a connection whose end is
let go on empty canvas is removed.
Decision: [D80](../decisions.md#d80--a-connection-pulled-off-a-card-and-let-go-on-empty-canvas-is-removed-and-a-marquee-over-connections-alone-selects-them-new-2026-10-25)
for [dragging an end of a connection](#dragging-an-end-of-a-connection)
Related: [reference graph](reference-graph.md#creating-connected-nodes)
(Create from Connection), [canvas card resize](canvas-card-resize.md),
[canvas selection and arrangement](canvas-selection-and-arrangement.md)
(selecting connections)

## Problem

Each card has four connection handles, one at the midpoint of each side. A
handle's only hit target was its visible circle: 11 flow pixels across,
centered on the card's outer edge. At 40% zoom that is about 4 screen pixels.
Nothing changed as the pointer came close, so starting a connection meant
hunting for a dot.

After a connection drag was released on empty canvas, the drag line vanished
while the Create from Connection menu was open. The menu then looked detached
from the card it would connect to.

An end of a connection that was pulled off its card and let go on empty
canvas came back to its card (reported on 2026-10-25). The pull showed the
line leaving the card, and the release undid it, so the only way to remove a
connection was to select it and press Delete.

## Scope

In scope: the hit geometry and appearance of the four connection handles,
the line shown while the Create from Connection menu is open, and what the
release of a dragged end of a connection does.

Not in scope, and unchanged:

- When handles exist and when they are hidden: while a Note is being edited,
  while the card is moved, and while it is resized. The cards of a set of
  selected cards show no handles either: the box of the set takes the
  pointer over them, and their capture circles are not there while they are
  part of the set
  ([canvas selection and arrangement](canvas-selection-and-arrangement.md#a-set)).
- Snapping onto a target handle during a drag (a 48-pixel connection radius),
  click-to-connect, and connecting into a card.
- How a drag takes an end of a connection, how that end follows the pointer
  and snaps to a side of a card, and what a reconnect writes
  ([reference graph](reference-graph.md#reference-edits)).
- The Create from Connection menu itself, which the reference graph specifies.

## Terms

- **Flow pixels** and **screen pixels** are as defined in
  [canvas card resize](canvas-card-resize.md#terms).
- **Anchor point**: the midpoint of one side of the card's outer edge. Edges
  start and end there.
- **Capture circle**: the hit target of one handle, centered on its anchor
  point. It takes the pointer only where nothing else on the canvas does.
- **Visible circle**: the drawn handle, centered on its anchor point.
- **Empty canvas**: as in
  [canvas selection and arrangement](canvas-selection-and-arrangement.md#terms),
  a point of the canvas scene where no card, connection, capture circle, set
  box, toolbar, menu, or view control takes the pointer. The line being
  dragged is not counted.

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
- After an item is chosen, the line stays until the edge of the new note or
  draft is drawn, and the edge replaces it. If no new edge from the source
  appears within 2 seconds, because the create failed or was refused, the
  line is removed.

### Dragging an end of a connection

**The rule.** A connection whose end is pulled off its card and let go on
empty canvas is removed. Let go on a card it can connect to, it is
connected there. Anywhere else, it goes back.

How the drag works is unchanged: a press on a connection's line and a move
of more than 4 screen pixels takes the end of the half that was pressed. That
end follows the pointer and snaps to the nearest side of a card that the
pointer is on or near, other than the card at the line's other end. The
pointer is a grabbing hand until the button is released.

| The button is released | What happens |
| --- | --- |
| While the end is snapped to a side of a card | The connection is reconnected there, as before: the source end replaces the entry in place, the target end moves it to the new card. Back on its own card it only changes side. |
| On empty canvas | The connection is removed, as Delete removes it: the downstream card no longer lists the upstream card. |
| On the card at the line's other end | Nothing changes, and the line goes back: a card cannot list itself. |
| Anywhere else: on another connection, a set box, a toolbar, a menu, a view control, or outside the canvas | Nothing changes, and the line goes back. |

- Escape, the window losing focus, and a cancelled pointer end the drag as
  before: nothing changes, and the line goes back.
- A press that moves less than 4 screen pixels is a click, which selects the
  connection, as before.
- The line keeps its look while it is dragged. It does not show beforehand
  whether a release will remove it.
- **Removed** means the same disconnect as Delete: one step of undo, which
  puts the entry back in its place in the list; the anchor row in
  `canvas.yaml` is kept
  ([reference graph](reference-graph.md#edges)). The line disappears when
  the button is released and does not come back while the write is under
  way.
- **Refused.** A connection that cannot change, such as an input of a
  generation card with its file or of a draft while it generates
  ([reference graph](reference-graph.md#connecting)), says why, as Delete
  does, and its line is drawn again. Nothing is written.
- Dragging one of [several selected connections](canvas-selection-and-arrangement.md#selected-connections)
  changes only that one. The others stay selected.

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
   from the source to the new note or draft is drawn in its place.
5. Dragging the target half of a connection to empty canvas and letting go
   removes the connection: the line is gone from the release on, and the
   downstream note no longer lists the upstream card. No menu opens. One undo
   brings the line back and the entry back to its place in the list.
6. The same holds for the source half.
7. Letting go on the card at the line's other end, or pressing Escape before
   letting go, changes no file, and the line is drawn where it was.
8. Letting go on empty canvas with an input of a generation card with its
   file shows the refusal, draws the line again, and changes no file.
9. The smoke covers criteria 1, 3 to 7: the step `canvas-edge-half-reconnect`
   criterion 7, and `canvas-edge-let-go-on-empty-canvas` criteria 5 and 6.
