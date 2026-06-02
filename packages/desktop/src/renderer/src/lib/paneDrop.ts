import type { DropRegion } from '../store/workspace.js';

/**
 * Cursor (x, y) within a w×h rect → the drop region it falls in: the inner 50%
 * box is the CENTER (move/open in this pane), the outer frame is the nearest EDGE
 * (split that way). Shared by the panel's tab-drop overlay and the canvas
 * badge→panel dock so both read the exact same geometry.
 */
export const regionFor = (x: number, y: number, w: number, h: number): DropRegion => {
  const left = x / w;
  const right = 1 - left;
  const top = y / h;
  const bottom = 1 - top;
  const m = Math.min(left, right, top, bottom);
  if (m > 0.25) return 'center'; // inner 50% box
  if (m === left) return 'left';
  if (m === right) return 'right';
  if (m === top) return 'up';
  return 'down';
};
