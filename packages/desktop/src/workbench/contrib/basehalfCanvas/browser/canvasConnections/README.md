# Canvas Connections

This module owns the card-to-card connection interaction on the canvas.

## Interaction Contract

- A card does not show connection UI by default.
- Hovering near one card edge reveals exactly one source point at that side's
  midpoint.
- Dragging starts from a visible source point only.
- While dragging, every non-source card exposes transparent target hit zones on
  all four sides. These hit zones are interaction surfaces, not visual chrome.
- The live connection preview snaps to the target side midpoint as soon as the
  pointer enters that side's hit zone.
- The visible target point is only feedback for the side that will be chosen;
  connection completion must not depend on a React state update making that
  point interactive.
- Stored references keep explicit `fromSide` and `toSide` values.
- Rendered edges use card rectangles plus those stored sides as the geometry
  truth. React Flow handles are interaction surfaces only; their DOM boxes must
  not push saved edge endpoints away from the card border.

## File Roles

- `geometry.ts` contains pure side and hit-zone geometry.
- `edges.ts` maps Badge references to React Flow edges and guards handle ids.
- `CanvasConnectionLine.tsx` renders the live drag preview using the same
  target-side snap model as the handles.
- `CanvasConnectionHandles.tsx` mounts React Flow handles and keeps visual
  affordances separate from target hit areas.
- `ReferenceEdge.tsx` renders the edge path from card-side anchors and optional
  hover label.
