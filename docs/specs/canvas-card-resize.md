# Canvas card resize

Status: Active (2026-10-09)
Related: [roadmap](../roadmap.md) tracks 2 and 9,
[architecture invariants](../harness/architecture-invariants.md)

## Problem

Canvas cards have rounded corners: `--bh-card-radius` is 22 flow pixels. The
corner resize targets were invisible 16-pixel squares centered on the corners
of the card's bounding rectangle, which lie outside the painted card. A
pointer on the visible rounded corner, especially near where the curve meets
a straight side, missed the target. A pointer in the empty square corner beyond
the curve hit it. The canvas also showed nothing to say that a corner could be
dragged.

Two more defects made corners feel rectangular. Previews that paint in their
own layer took the pointer in the empty corners outside the card's outline,
because Chromium hit testing ignores a rounded overflow clip for such layers.
A press on a card that had keyboard focus also ended the resize session at once.

## Scope

In scope: the hit geometry, cursor, and visible affordance of the resize
controls that the canvas scene renders for a selected card, and the sizes and
placements those controls use at every canvas zoom.

Not in scope, and unchanged:

- When resize is available. Resize controls exist only when exactly one card
  is selected, it is not a Note being edited, and video input picking is not
  active (`baseHalfCanvasSceneShowsResizeControls`). Hovering a card that is
  not selected shows no resize affordance.
- The resize gesture itself: minimum size 140 × 48 flow pixels, the corner
  opposite the dragged one stays fixed, live geometry during the drag, and
  persistence to `canvas.yaml` only after pointer-up.
- Keyboard resizing, aspect-ratio locking, and resizing several cards at once.
  None of these exist.

## Terms

- **Flow pixels** are canvas coordinates. They scale with the canvas zoom,
  which ranges from 0.2 to 4.
- **Screen pixels** are CSS pixels in the window. A size given in screen pixels
  stays the same on screen at every zoom.
- **Corner arc**: the quarter circle of radius 22 flow pixels that forms one
  rounded corner of a card's outer edge. Its two ends are the **tangent
  points**, where it meets the straight sides.
- **Corner sector**: the 90° wedge between the two radii from the arc's center
  to its tangent points.

The card radius is defined once in CSS (`--bh-card-radius`) and mirrored by
`BASEHALF_CANVAS_CARD_CORNER_RADIUS` in TypeScript. The minimum card height (48)
is more than twice the radius (44), so the corners are always complete quarter
circles.

## Required behavior

### Corner targets

Each of the four corners has one resize target. Within the corner sector, the
target covers the points from 8 screen pixels inside the card's outer edge to
12 screen pixels outside it. The band therefore follows the corner arc along
its whole length, from one tangent point to the other, and is equally thick at
every zoom. When the corner radius on screen is smaller than 8 pixels (zoom
below about 0.36), the inner part stops at the arc's center and covers the
whole rounded corner.

- **Inside the outline**, the 8-pixel strip along the rounded edge stacks above
  the card and its content, so a pointer there resizes instead of moving the
  card or reaching the content. Deeper inside, the card keeps the pointer. The
  card's connection handles stay above the strip. Their capture circles lie
  below the card, so every resize target keeps the pointer over them
  ([connection handles](canvas-connection-handles.md)).
- **Outside the outline**, the band stacks below the card, so the card's
  caption keeps the pointer where the two overlap near the top corners. The
  inner strip reaches 1 screen pixel past the edge, so no seam opens between
  the two parts.
- The card's content takes no pointer events outside the outline. The content
  is clipped to the rounded outline for hit testing as well as for painting,
  so a preview cannot claim the empty corners of the bounding rectangle.
- The corner of the bounding rectangle beyond the band is not a resize target.
  At zoom 1.4 and above, that includes the rectangle's corner point itself.
- Over the band, the cursor is `nwse-resize` at the top-left and bottom-right
  corners, and `nesw-resize` at the top-right and bottom-left corners.
- The four bands never overlap, because each one stays inside its own corner
  sector.

### Side targets

The side resize targets cover only the straight part of each side. They
exclude the 22 flow pixels at each end that belong to the corners. Their
thickness is unchanged.

### Corner indicator

Each corner has an indicator: an arc that shares the corner arc's center.

- It is 3 screen pixels thick with round ends, and a 5-screen-pixel gap
  separates it from the card's outer edge.
- It covers the middle 50° of the corner sector, centered on the corner's
  diagonal, round ends included. It is a short mark at the corner, not a trace
  of the whole curve.
- It uses the canvas geometry-strong color (`--bh-canvas-geometry-strong`,
  `CanvasText` in forced colors), never the connection-intent color.
- It takes no pointer events. A pointer over the indicator is over the band.

An indicator is visible in two cases:

- **Hover**: the pointer is over that corner's band, and no resize gesture is
  moving the card.
- **Resize**: a gesture started on that corner has moved the card. The
  indicator stays visible even when the pointer leaves the band, until the
  gesture settles.

In every other state, every indicator is hidden: at rest, during a resize from
a side or from another corner, while the card is being moved, and while the
controls are absent. At most one indicator is visible at a time.

Indicators fade in and out over at most 120 ms. With
`prefers-reduced-motion: reduce`, they change without a transition.

## Gesture, failure, and recovery

A press on a corner band starts the same resize session as before. A press and
release without movement changes no geometry and leaves no resizing state on
the card. Movement marks the card as resizing and records the active corner.
The session settles on pointer-up, pointer cancel, lost pointer capture, window
blur, or unmount. Settling clears the resizing state and the active corner
together, so an interrupted gesture cannot leave an indicator visible.

Only the window losing focus counts as a window blur. A selected card usually
has keyboard focus, and the press itself moves focus off the card. That
element blur must not settle the session. Before this specification, it did,
so a resize that started on a focused card ran without its session state.

When a Note enters editing, its resize controls disappear and stop taking
pointer events from the same synchronous state change, before the scene's next
render.

## Compatibility

No persisted data changes. `canvas.yaml` geometry, minimum sizes, and the
resize session's events are unchanged. Every card kind has the same corner
radius, so plugin-contributed cards get the same targets.

## Acceptance criteria

1. With one card selected, each corner target receives the pointer at points on
   the corner arc at 10°, 45°, and 80° of its sector, both 3 screen pixels
   outside the card edge and 4 screen pixels inside it. The cursor there
   matches the corner's diagonal. Before this change, every inside point and the
   outside 10° and 80° points missed. On a Markdown card, the outside 45° point
   missed too.
2. A point 12 screen pixels inside the card edge, on the 45° radius of any
   corner, belongs to the card, not to a resize target.
3. A point 16 screen pixels outside the card edge, on the 45° radius of any
   corner, is not a resize target.
4. At rest, no indicator is visible. Hovering one corner band shows only that
   corner's indicator, in the geometry-strong color. Moving away hides it.
5. While a gesture from the bottom-right corner is resizing the card, only the
   bottom-right indicator is visible. That includes the time after the card
   reaches its minimum size and the pointer moves off the band, and gestures
   that start while the card has keyboard focus. After the gesture settles and
   the pointer has left the band, none is visible.
6. A press and release on a corner band without movement changes no geometry
   on disk and leaves no resizing state.
7. Dragging a corner band resizes the card live. The new size persists only
   after pointer-up, and dragging back restores the original size.
8. A Note in editing, a multi-card selection, and active video input picking
   show no resize targets or indicators.
9. The target band and the indicator keep their screen-pixel sizes at zoom
   0.2, 0.5, 1, 2, and 4, and stay concentric with the corner arc. The
   indicator covers 20° to 70° of the sector at every zoom.
10. Each side target starts and ends 22 flow pixels from the card's corners.

## Verification

- Unit tests: `basehalfCanvasReactScene.test.ts` covers the corner geometry for
  each corner and zoom (criterion 9), and the availability policy
  (criterion 8).
- `npm run basehalf:smoke`: the selected Note and docs-card flows probe each
  corner's hit points, cursor, and indicator states, and the extent of each
  side target (criteria 1–5 and 10). The docs-card restore starts with the card
  focused and shrinks it to its minimum size mid-gesture (criterion 5). The
  docs-card and Video flows resize by pressing on the bottom-right band
  (criteria 6–7). The existing Note editing frames check criterion 8.
