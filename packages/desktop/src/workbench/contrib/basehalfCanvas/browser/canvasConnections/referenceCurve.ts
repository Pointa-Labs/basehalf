// The shape of a reference line — shared by the committed edge and the live drag
// preview. The curve LEAVES each card perpendicular to the side it docks on and
// ARRIVES perpendicular to the target side: control points are pushed straight
// out along each side's normal (reach scaled to the gap, gracefully bowed when
// the target sits "behind" the chosen side), so every line stays visibly
// anchored to its card edge instead of cutting across the diagonal.
//
// The bezier stops short of the tip at a "neck", then a STRAIGHT STEM runs into
// the arrowhead. The bezier already arrives at the neck travelling along the
// side's inward normal, so the join is kink-free — and because the final stretch
// is genuinely straight (and exactly the arrow's axis), the arrowhead seats dead
// square no matter how big the arc is. endDir is that exact axis.

import type { CanvasConnectionSide } from './geometry.js';

type Vec = { readonly x: number; readonly y: number };
type Curve = {
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  /** Unit tangent at the target end, pointing into the tip (the arrow's axis). */
  readonly endDir: Vec;
};

type CurveSides = {
  readonly sourceSide?: CanvasConnectionSide;
  readonly targetSide?: CanvasConnectionSide;
};

// Outward normal of each card side.
const SIDE_NORMAL: Record<CanvasConnectionSide, Vec> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const CURVATURE = 0.25; // how hard the line bows when the target sits behind the side
// Straight run-in to the arrowhead, in flow units. Longer than the arrowhead
// (12) so a sliver of plain line precedes the head — that visible straight lead
// is what reads as a "square" arrow. Bump this for a longer, stiffer stem.
const ARROW_STEM = 18;

// Which side of the box at (x1,y1) faces the point at (x2,y2) — used when a side
// isn't pinned (e.g. the free end of a drag preview) so the line still anchors.
function inferSide(x1: number, y1: number, x2: number, y2: number): CanvasConnectionSide {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

// How far the control point reaches out along the side normal. When the target
// is ahead (positive gap) reach is half the gap; when it's behind, a gentler
// sqrt bow keeps the line from snapping back through the card.
function controlReach(gap: number): number {
  if (gap >= 0) return 0.5 * gap;
  return CURVATURE * 25 * Math.sqrt(-gap);
}

// Control point for the end at (x1,y1) docking on `side`, with the other end at
// (x2,y2). The reach is measured along the side's own axis toward the far end.
function controlPoint(
  side: CanvasConnectionSide,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Vec {
  if (side === 'left') return { x: x1 - controlReach(x1 - x2), y: y1 };
  if (side === 'right') return { x: x1 + controlReach(x2 - x1), y: y1 };
  if (side === 'top') return { x: x1, y: y1 - controlReach(y1 - y2) };
  return { x: x1, y: y1 + controlReach(y2 - y1) };
}

export function curvedReferencePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sides: CurveSides = {},
): Curve {
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.hypot(dx, dy) < 1) {
    return {
      path: `M ${sx},${sy} L ${tx},${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2,
      endDir: { x: 0, y: -1 },
    };
  }

  const sourceSide = sides.sourceSide ?? inferSide(sx, sy, tx, ty);
  const targetSide = sides.targetSide ?? inferSide(tx, ty, sx, sy);
  const tn = SIDE_NORMAL[targetSide];

  // Arrow axis = straight INTO the target side. The arrowhead is rigidly square
  // to the side regardless of how the curve approaches.
  const endDir = { x: -tn.x, y: -tn.y };

  // Pull the spline's end back to a neck, then a straight stem carries the last
  // ARROW_STEM units into the tip — that stem is the arrow's axis, so the head
  // never tilts. Keep the stem short for near-touching cards.
  const stem = Math.min(ARROW_STEM, Math.hypot(dx, dy) * 0.45);
  const neckX = tx + tn.x * stem;
  const neckY = ty + tn.y * stem;

  const c1 = controlPoint(sourceSide, sx, sy, neckX, neckY);
  const c2 = controlPoint(targetSide, neckX, neckY, sx, sy);
  const path = `M ${sx},${sy} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${neckX},${neckY} L ${tx},${ty}`;

  // Label at the bezier's own midpoint (t=0.5 of source→neck), not the chord's —
  // the curve is no longer symmetric about the straight line between the ends.
  return {
    path,
    labelX: 0.125 * sx + 0.375 * c1.x + 0.375 * c2.x + 0.125 * neckX,
    labelY: 0.125 * sy + 0.375 * c1.y + 0.375 * c2.y + 0.125 * neckY,
    endDir,
  };
}
