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

/** Remove `leafId`; the parent split collapses into the sibling subtree.
 *  null when the closed leaf was the whole tree. */
function removeLeaf(root: TermNode, leafId: string): TermNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;
  if (root.a.type === 'leaf' && root.a.id === leafId) return root.b;
  if (root.b.type === 'leaf' && root.b.id === leafId) return root.a;
  const inA = containsLeaf(root.a, leafId);
  if (!inA && !containsLeaf(root.b, leafId)) return root; // not found
  const collapsed = removeLeaf(inA ? root.a : root.b, leafId);
  // `side` has >1 leaf here, so collapse never nulls it.
  if (collapsed === null) return root;
  return inA ? { ...root, a: collapsed } : { ...root, b: collapsed };
}

/** The id to focus after `leafId` closes — Ghostty's rule
 *  (BaseTerminalController: "previous leaf, unless we were the leftmost, then
 *  next"), computed over the PRE-close in-order leaf list. The result survives
 *  the removal (it's never the closed leaf). null if `leafId` is the whole tree. */
function focusAfterClose(root: TermNode, leafId: string): string | null {
  const ids = orderedLeafIds(root);
  if (ids.length <= 1) return null;
  const i = ids.indexOf(leafId);
  if (i < 0) return null;
  return i === 0 ? (ids[1] ?? null) : (ids[i - 1] ?? null);
}

/** Remove `leafId`. The parent split collapses into the sibling subtree.
 *  Returns the new root (null if the closed leaf was the whole tree) and the id
 *  to focus next — Ghostty's previous-unless-leftmost-then-next rule. */
export function closeLeaf(
  root: TermNode,
  leafId: string,
): { root: TermNode | null; focusId: string | null } {
  if (!containsLeaf(root, leafId)) return { root, focusId: null };
  const focusId = focusAfterClose(root, leafId);
  const next = removeLeaf(root, leafId);
  return { root: next, focusId: next ? focusId : null };
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

/** The nearest leaf in a spatial direction — Ghostty's `goto_split:dir`
 *  algorithm (SplitTree.swift): keep only candidates lying ENTIRELY beyond our
 *  edge in `dir` (a half-plane filter — NO perpendicular-overlap gate, so a
 *  diagonal pane still qualifies), then pick the one whose TOP-LEFT corner is
 *  Euclidean-nearest to ours. No wrap — null at the edge. */
export function directionalNeighbor(root: TermNode, leafId: string, dir: FocusDir): string | null {
  const rects = leafRects(root);
  const me = rects.get(leafId);
  if (!me) return null;
  const E = 1e-9;
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [id, r] of rects) {
    if (id === leafId) continue;
    // Half-plane: candidate entirely beyond our edge (maxX ≤ refMinX for left,
    // minX ≥ refMaxX for right, etc. — at-or-beyond, shared edges count).
    const beyond =
      dir === 'left'
        ? r.x + r.w <= me.x + E
        : dir === 'right'
          ? r.x + E >= me.x + me.w
          : dir === 'up'
            ? r.y + r.h <= me.y + E
            : r.y + E >= me.y + me.h;
    if (!beyond) continue;
    // Nearest by Euclidean distance between TOP-LEFT corners (Ghostty's metric).
    const dx = r.x - me.x;
    const dy = r.y - me.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist - E) {
      bestDist = dist;
      best = id;
    }
  }
  return best;
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

/** Direction-aware leaf weight (Ghostty's `equalized()` helper): a leaf weighs
 *  1; a split nested along the SAME axis contributes the sum of its children's
 *  weights; a split along the PERPENDICULAR axis counts as 1. */
function weightForDir(node: TermNode, dir: 'row' | 'column'): number {
  if (node.type === 'leaf') return 1;
  if (node.dir === dir) return weightForDir(node.a, dir) + weightForDir(node.b, dir);
  return 1;
}

/** Reset every split's fraction so panes are evenly sized by leaf weight —
 *  Ghostty's `equalize_splits` (⌘⌃= / double-click a divider). Children are
 *  equalized first, then each split's fraction = left weight / total weight. */
export function equalize(root: TermNode): TermNode {
  if (root.type === 'leaf') return root;
  const a = equalize(root.a);
  const b = equalize(root.b);
  const wa = weightForDir(a, root.dir);
  const wb = weightForDir(b, root.dir);
  return { ...root, a, b, fraction: clampFraction(wa / (wa + wb)) };
}

/** Split `targetId` in two, placing leaf `newId` beside it on `side`. `left`/`up`
 *  put the new pane on the NEAR side (a); `right`/`down` on the FAR side (b).
 *  Drives drag-to-split (the dragged pane keeps its id, so its pty survives the
 *  move). `left`/`right` → a row; `up`/`down` → a column. */
export function insertBeside(
  root: TermNode,
  targetId: string,
  side: FocusDir,
  newId: string,
  splitId: string,
): TermNode {
  const dir: 'row' | 'column' = side === 'left' || side === 'right' ? 'row' : 'column';
  const near = side === 'left' || side === 'up';
  const replace = (node: TermNode): TermNode => {
    if (node.type === 'leaf') {
      if (node.id !== targetId) return node;
      const created = leaf(newId);
      return {
        type: 'split',
        id: splitId,
        dir,
        a: near ? created : node,
        b: near ? node : created,
        fraction: 0.5,
      };
    }
    return { ...node, a: replace(node.a), b: replace(node.b) };
  };
  return replace(root);
}

/** Which drop-zone edge a point in a pane's [0..1] space lands in — the nearest
 *  edge (Ghostty's 4-triangle partition), ties broken left→right→up→down, exact
 *  center → left. Drives drag-to-split previews + drops. */
export function dropEdge(px: number, py: number): FocusDir {
  const candidates: ReadonlyArray<readonly [FocusDir, number]> = [
    ['left', px],
    ['right', 1 - px],
    ['up', py],
    ['down', 1 - py],
  ];
  let best: FocusDir = 'left';
  let bestD = Number.POSITIVE_INFINITY;
  for (const [edge, d] of candidates) {
    if (d < bestD - 1e-9) {
      bestD = d;
      best = edge;
    }
  }
  return best;
}
