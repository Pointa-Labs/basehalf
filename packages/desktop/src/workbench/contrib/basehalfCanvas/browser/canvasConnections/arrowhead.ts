// A filled arrowhead at the line's tip, oriented along an explicit direction —
// the curve's EXACT end tangent (from referenceCurve), so the head's centre axis
// is the line's own end direction. The line then runs straight up the middle of
// the head, through its base midpoint, with no poke-through. Shared by the
// committed edge and the live drag preview.

type Vec = { readonly x: number; readonly y: number };

const HEAD_LENGTH = 12; // tip-to-base length, in flow units (scales with zoom)
const HEAD_HALF_WIDTH = 4.5; // half the base width

// SVG path for the filled triangle. `tip` sits on the curve's end point; `dir`
// is the unit tangent pointing into the tip.
export function arrowheadPath(tip: Vec, dir: Vec): string {
  const len = Math.hypot(dir.x, dir.y);
  if (len < 0.001) return '';
  const ux = dir.x / len;
  const uy = dir.y / len;
  const px = -uy;
  const py = ux;
  const baseX = tip.x - ux * HEAD_LENGTH;
  const baseY = tip.y - uy * HEAD_LENGTH;
  const b1x = baseX + px * HEAD_HALF_WIDTH;
  const b1y = baseY + py * HEAD_HALF_WIDTH;
  const b2x = baseX - px * HEAD_HALF_WIDTH;
  const b2y = baseY - py * HEAD_HALF_WIDTH;
  return `M ${tip.x},${tip.y} L ${b1x},${b1y} L ${b2x},${b2y} Z`;
}
