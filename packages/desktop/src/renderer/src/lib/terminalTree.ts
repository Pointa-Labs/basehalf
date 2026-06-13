// Ghostty-style split tree for the terminal — ported in spirit from
// reference/ghostty (a tab holds a recursive tree of split panes; each leaf is
// one terminal/pty). Kept PURE + deterministic (ids are passed in, never
// generated here) so it's unit-testable and the store owns id minting.
//
// dir 'row'    → side-by-side  (a = left,  b = right)  ← "split right" (⌘D)
// dir 'column' → stacked       (a = top,   b = bottom) ← "split down"  (⌘⇧D)

export interface TermLeaf {
  readonly type: 'leaf';
  /** The pane id — also the key of the terminal session (one pty) it hosts. */
  readonly id: string;
}
export interface TermSplit {
  readonly type: 'split';
  readonly id: string;
  readonly dir: 'row' | 'column';
  readonly a: TermNode;
  readonly b: TermNode;
  /** Fraction [0..1] of the primary axis given to `a`. */
  readonly fraction: number;
}
export type TermNode = TermLeaf | TermSplit;

export type SplitDir = 'right' | 'down';
export type FocusDir = 'left' | 'right' | 'up' | 'down';

export const leaf = (id: string): TermLeaf => ({ type: 'leaf', id });

const FRACTION_MIN = 0.1;
const FRACTION_MAX = 0.9;
const clampFraction = (f: number): number => Math.max(FRACTION_MIN, Math.min(FRACTION_MAX, f));

/** Split `leafId` in two: the existing pane keeps side `a`, the new pane
 *  (`newId`) takes side `b`. `right` → a row, `down` → a column. */
export function splitLeaf(
  root: TermNode,
  leafId: string,
  dir: SplitDir,
  newId: string,
  splitId: string,
): TermNode {
  const replace = (node: TermNode): TermNode => {
    if (node.type === 'leaf') {
      if (node.id !== leafId) return node;
      return {
        type: 'split',
        id: splitId,
        dir: dir === 'right' ? 'row' : 'column',
        a: node,
        b: leaf(newId),
        fraction: 0.5,
      };
    }
    return { ...node, a: replace(node.a), b: replace(node.b) };
  };
  return replace(root);
}

/** Remove `leafId`. The parent split collapses into the sibling subtree.
 *  Returns the new root (null if the closed leaf was the whole tree) and the
 *  id to focus next (the sibling's first leaf). */
export function closeLeaf(
  root: TermNode,
  leafId: string,
): { root: TermNode | null; focusId: string | null } {
  if (root.type === 'leaf') {
    return root.id === leafId ? { root: null, focusId: null } : { root, focusId: null };
  }
  // Direct child is the target → collapse to the other child.
  if (root.a.type === 'leaf' && root.a.id === leafId) {
    return { root: root.b, focusId: firstLeaf(root.b).id };
  }
  if (root.b.type === 'leaf' && root.b.id === leafId) {
    return { root: root.a, focusId: firstLeaf(root.a).id };
  }
  // Recurse both sides.
  const inA = containsLeaf(root.a, leafId);
  const side = inA ? root.a : root.b;
  const res = closeLeaf(side, leafId);
  if (res.root === null) return { root, focusId: null }; // not found / no-op
  return {
    root: inA ? { ...root, a: res.root } : { ...root, b: res.root },
    focusId: res.focusId,
  };
}

export function setFraction(root: TermNode, splitId: string, fraction: number): TermNode {
  const walk = (node: TermNode): TermNode => {
    if (node.type === 'leaf') return node;
    if (node.id === splitId) return { ...node, fraction: clampFraction(fraction) };
    return { ...node, a: walk(node.a), b: walk(node.b) };
  };
  return walk(root);
}

export function findLeaf(root: TermNode, id: string): TermLeaf | null {
  if (root.type === 'leaf') return root.id === id ? root : null;
  return findLeaf(root.a, id) ?? findLeaf(root.b, id);
}

const containsLeaf = (root: TermNode, id: string): boolean => findLeaf(root, id) !== null;

export function firstLeaf(root: TermNode): TermLeaf {
  let node = root;
  while (node.type === 'split') node = node.a;
  return node;
}

/** All leaf ids, left-to-right / top-to-bottom in-order — the ⌘[ / ⌘] ring. */
export function orderedLeafIds(root: TermNode): string[] {
  if (root.type === 'leaf') return [root.id];
  return [...orderedLeafIds(root.a), ...orderedLeafIds(root.b)];
}

/** The next (or previous) leaf in the in-order ring, wrapping around. */
export function ringNeighbor(root: TermNode, leafId: string, delta: 1 | -1): string {
  const ids = orderedLeafIds(root);
  const i = ids.indexOf(leafId);
  if (i < 0) return leafId;
  return ids[(i + delta + ids.length) % ids.length] as string;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Normalized [0..1] rectangle for every leaf, derived from split fractions —
 *  the basis for geometric directional navigation + resize. */
export function leafRects(root: TermNode): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (node: TermNode, r: Rect): void => {
    if (node.type === 'leaf') {
      out.set(node.id, r);
      return;
    }
    if (node.dir === 'row') {
      const wa = r.w * node.fraction;
      walk(node.a, { x: r.x, y: r.y, w: wa, h: r.h });
      walk(node.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h });
    } else {
      const ha = r.h * node.fraction;
      walk(node.a, { x: r.x, y: r.y, w: r.w, h: ha });
      walk(node.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha });
    }
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 });
  return out;
}

export interface Divider {
  readonly splitId: string;
  readonly dir: 'row' | 'column';
  /** A zero-width (row) / zero-height (column) line in [0..1] space; the UI
   *  draws a fixed-thickness grab strip centered on it. */
  readonly rect: Rect;
}

/** The draggable boundary line for every split, in normalized [0..1] space —
 *  drives the resize handles. */
export function splitDividers(root: TermNode): Divider[] {
  const out: Divider[] = [];
  const walk = (node: TermNode, r: Rect): void => {
    if (node.type === 'leaf') return;
    if (node.dir === 'row') {
      const wa = r.w * node.fraction;
      out.push({ splitId: node.id, dir: 'row', rect: { x: r.x + wa, y: r.y, w: 0, h: r.h } });
      walk(node.a, { x: r.x, y: r.y, w: wa, h: r.h });
      walk(node.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h });
    } else {
      const ha = r.h * node.fraction;
      out.push({ splitId: node.id, dir: 'column', rect: { x: r.x, y: r.y + ha, w: r.w, h: 0 } });
      walk(node.a, { x: r.x, y: r.y, w: r.w, h: ha });
      walk(node.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha });
    }
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 });
  return out;
}

/** The nearest leaf in a spatial direction (Ghostty's goto_split:dir). Picks
 *  the candidate whose edge is just beyond ours and that overlaps most on the
 *  perpendicular axis; null if there's nothing that way. */
export function directionalNeighbor(root: TermNode, leafId: string, dir: FocusDir): string | null {
  const rects = leafRects(root);
  const me = rects.get(leafId);
  if (!me) return null;
  const horizontal = dir === 'left' || dir === 'right';
  const meCenterPerp = horizontal ? me.y + me.h / 2 : me.x + me.w / 2;
  let best: { id: string; gap: number; overlap: number } | null = null;
  for (const [id, r] of rects) {
    if (id === leafId) continue;
    // Must lie on the requested side (with a small epsilon for shared edges).
    const onSide =
      dir === 'right'
        ? r.x >= me.x + me.w - 1e-6
        : dir === 'left'
          ? r.x + r.w <= me.x + 1e-6
          : dir === 'down'
            ? r.y >= me.y + me.h - 1e-6
            : r.y + r.h <= me.y + 1e-6;
    if (!onSide) continue;
    // Overlap on the perpendicular axis (so we don't jump to a diagonal pane).
    const overlap = horizontal
      ? Math.min(me.y + me.h, r.y + r.h) - Math.max(me.y, r.y)
      : Math.min(me.x + me.w, r.x + r.w) - Math.max(me.x, r.x);
    if (overlap <= 0) continue;
    const gap = horizontal ? Math.abs(r.x - me.x) : Math.abs(r.y - me.y);
    const perpDist = Math.abs((horizontal ? r.y + r.h / 2 : r.x + r.w / 2) - meCenterPerp);
    // Prefer the closest along the travel axis, then the best perpendicular
    // alignment (encoded by subtracting a tiny perpDist tiebreak from overlap).
    const score = overlap - perpDist * 0.001;
    if (
      !best ||
      gap < best.gap - 1e-9 ||
      (Math.abs(gap - best.gap) < 1e-9 && score > best.overlap)
    ) {
      best = { id, gap, overlap: score };
    }
  }
  return best?.id ?? null;
}

/** The id of the split parent whose axis matches `dir`, for resizing — the
 *  nearest ancestor split that controls movement in that direction, plus
 *  whether `leafId` sits on its `a` side (grow vs shrink). */
export function resizeTarget(
  root: TermNode,
  leafId: string,
  dir: FocusDir,
): { splitId: string; onSideA: boolean } | null {
  const wantRow = dir === 'left' || dir === 'right';
  let found: { splitId: string; onSideA: boolean } | null = null;
  const walk = (node: TermNode): boolean => {
    if (node.type === 'leaf') return node.id === leafId;
    const inA = walk(node.a);
    const inB = inA ? false : walk(node.b);
    if (!inA && !inB) return false;
    if (
      found === null &&
      ((wantRow && node.dir === 'row') || (!wantRow && node.dir === 'column'))
    ) {
      found = { splitId: node.id, onSideA: inA };
    }
    return true;
  };
  walk(root);
  return found;
}
