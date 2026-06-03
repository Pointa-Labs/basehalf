// The right panel's pane tree — a binary split tree of editor groups, modeled on
// a mature code editor's editor-group grid (kept binary for simplicity; a
// 3-column layout is nested splits). A node is either a LEAF (a pane: its own
// tabs + active + preview slot) or a SPLIT (two children laid out in a row or
// column, with a draggable fraction between them).
//
// Everything here is PURE — the store wraps these with flush-gating + IDs. Kept
// pure so it's unit-testable without React or the store.

import { renamePanelTab } from './panelTab.js';

export interface LeafPane {
  type: 'leaf';
  id: string;
  /** Open files in this pane, in tab order. */
  tabs: string[];
  /** The active tab in this pane (the file whose editor is mounted). */
  activeFile: string | null;
  /** The single italic preview tab in this pane (replaced in place on a preview
   *  open; promoted by pin/double-click/edit). */
  previewFile: string | null;
}

export interface SplitPane {
  type: 'split';
  id: string;
  /** 'row' = children side by side (vertical divider); 'column' = stacked. */
  direction: 'row' | 'column';
  a: PaneNode;
  b: PaneNode;
  /** Fraction (0..1) of the space given to child `a`; `b` gets the rest. */
  fraction: number;
}

export type PaneNode = LeafPane | SplitPane;

// ── ID generation ────────────────────────────────────────────────────────────
// A monotonic counter (not Math.random) so ids are stable + deterministic for
// tests. Module-local; ids only need to be unique within a session.
let idCounter = 0;
export const nextPaneId = (): string => `pane-${++idCounter}`;
// Test-only: reset the counter so id assertions are deterministic across cases.
export const __resetPaneIds = (): void => {
  idCounter = 0;
};

/** Advance the id counter past every id in a tree — call after restoring a
 *  persisted layout (whose ids like `pane-2` predate this session's counter, which
 *  is still near 0). Without it the next split / new pane could reuse a restored
 *  id, and findLeaf / updateLeaf / `[data-pane-id]` would then hit the wrong pane
 *  (or several). */
export const adoptPaneIds = (tree: PaneNode): void => {
  const visit = (n: PaneNode): void => {
    const m = /^pane-(\d+)$/.exec(n.id);
    if (m) idCounter = Math.max(idCounter, Number(m[1]));
    if (n.type === 'split') {
      visit(n.a);
      visit(n.b);
    }
  };
  visit(tree);
};

export const emptyLeaf = (id = nextPaneId()): LeafPane => ({
  type: 'leaf',
  id,
  tabs: [],
  activeFile: null,
  previewFile: null,
});

// ── Normalization (self-heal degenerate trees) ───────────────────────────────

/** Prune every EMPTY leaf (no tabs), collapsing the splits they leave behind —
 *  returns null when the whole tree is empty. An empty pane carries no state, so a
 *  split that holds one is degenerate (e.g. two empty panes side by side, or an
 *  empty pane left beside a real one after splitting an empty source). This is the
 *  pure core; callers use `normalizeTree` to keep a single empty home. */
export const pruneEmptyLeaves = (node: PaneNode): PaneNode | null => {
  if (node.type === 'leaf') return node.tabs.length === 0 ? null : node;
  const a = pruneEmptyLeaves(node.a);
  const b = pruneEmptyLeaves(node.b);
  if (a && b) return { ...node, a, b };
  // One (or both) sides pruned away → collapse to the survivor (null if both gone).
  return a ?? b;
};

/** A tree with no empty NON-sole panes: prune empties, falling back to one fresh
 *  empty pane when everything was empty (the panel's quiet home). Used on restore
 *  so a degenerate persisted layout — e.g. `split(empty, empty)` saved by a prior
 *  build — self-heals on load instead of resurrecting forever. A sole leaf (empty or
 *  filled) is already valid and returned untouched, so the panel's empty home keeps
 *  its identity (only an all-empty SPLIT collapses to a fresh empty pane). */
export const normalizeTree = (node: PaneNode): PaneNode =>
  node.type === 'leaf' ? node : (pruneEmptyLeaves(node) ?? emptyLeaf());

// ── Tree traversal ───────────────────────────────────────────────────────────

/** The leftmost / topmost leaf — the default target when none is specified. */
export const firstLeaf = (node: PaneNode): LeafPane =>
  node.type === 'leaf' ? node : firstLeaf(node.a);

export const findLeaf = (node: PaneNode, id: string): LeafPane | undefined => {
  if (node.type === 'leaf') return node.id === id ? node : undefined;
  return findLeaf(node.a, id) ?? findLeaf(node.b, id);
};

export const allLeaves = (node: PaneNode): LeafPane[] =>
  node.type === 'leaf' ? [node] : [...allLeaves(node.a), ...allLeaves(node.b)];

export const leafCount = (node: PaneNode): number => allLeaves(node).length;

/** Replace the leaf with id `id` by running `fn` on it (returns a new tree). */
export const updateLeaf = (
  node: PaneNode,
  id: string,
  fn: (leaf: LeafPane) => LeafPane,
): PaneNode => {
  if (node.type === 'leaf') return node.id === id ? fn(node) : node;
  return { ...node, a: updateLeaf(node.a, id, fn), b: updateLeaf(node.b, id, fn) };
};

export const setFraction = (node: PaneNode, splitId: string, fraction: number): PaneNode => {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) {
    return { ...node, fraction: Math.max(0.1, Math.min(0.9, fraction)) };
  }
  return {
    ...node,
    a: setFraction(node.a, splitId, fraction),
    b: setFraction(node.b, splitId, fraction),
  };
};

/**
 * Split the leaf `leafId` in two: a new split node holding the existing leaf and
 * `newLeaf`, laid out per `direction`. `before` puts the new leaf first (left /
 * top). Returns the new tree unchanged if `leafId` isn't found.
 */
export const splitLeaf = (
  node: PaneNode,
  leafId: string,
  direction: 'row' | 'column',
  newLeaf: LeafPane,
  before: boolean,
  splitId = nextPaneId(),
): PaneNode => {
  if (node.type === 'leaf') {
    if (node.id !== leafId) return node;
    return {
      type: 'split',
      id: splitId,
      direction,
      a: before ? newLeaf : node,
      b: before ? node : newLeaf,
      fraction: 0.5,
    };
  }
  return {
    ...node,
    a: splitLeaf(node.a, leafId, direction, newLeaf, before, splitId),
    b: splitLeaf(node.b, leafId, direction, newLeaf, before, splitId),
  };
};

/**
 * Remove the leaf `id`, collapsing its parent split into the surviving sibling.
 * Returns null if `id` was the last leaf (the whole tree is gone).
 */
export const removeLeaf = (node: PaneNode, id: string): PaneNode | null => {
  if (node.type === 'leaf') return node.id === id ? null : node;
  const a = removeLeaf(node.a, id);
  const b = removeLeaf(node.b, id);
  // If a child collapsed to null, promote the other child (drop this split).
  if (a === null) return b;
  if (b === null) return a;
  return { ...node, a, b };
};

// ── Per-leaf tab operations (the preview/pinned single-slot model) ───────────

/**
 * Open `file` in a leaf. Default = a PREVIEW open: replaces the leaf's preview
 * tab in place (single-slot). `pinned` opens/keeps a permanent tab. Re-opening
 * an already-open file just activates it (promoting it if `pinned`).
 */
export const openInLeaf = (
  leaf: LeafPane,
  file: string,
  opts: { pinned?: boolean } = {},
): LeafPane => {
  const wantPinned = opts.pinned === true;
  if (leaf.tabs.includes(file)) {
    return {
      ...leaf,
      activeFile: file,
      previewFile: wantPinned && leaf.previewFile === file ? null : leaf.previewFile,
    };
  }
  if (wantPinned) {
    return { ...leaf, tabs: [...leaf.tabs, file], activeFile: file };
  }
  // Preview: replace the existing preview tab in place, else append + claim slot.
  if (leaf.previewFile && leaf.tabs.includes(leaf.previewFile)) {
    const i = leaf.tabs.indexOf(leaf.previewFile);
    return {
      ...leaf,
      tabs: leaf.tabs.map((t, idx) => (idx === i ? file : t)),
      activeFile: file,
      previewFile: file,
    };
  }
  return { ...leaf, tabs: [...leaf.tabs, file], activeFile: file, previewFile: file };
};

/** Close `file`'s tab; activate a neighbor if it was active; free the preview
 *  slot if it was the preview. Empty `tabs` ⇒ the store removes the pane. */
export const closeInLeaf = (leaf: LeafPane, file: string): LeafPane => {
  const idx = leaf.tabs.indexOf(file);
  if (idx === -1) return leaf;
  const tabs = leaf.tabs.filter((t) => t !== file);
  const previewFile = leaf.previewFile === file ? null : leaf.previewFile;
  const activeFile =
    leaf.activeFile === file ? (tabs[idx] ?? tabs[idx - 1] ?? null) : leaf.activeFile;
  return { ...leaf, tabs, previewFile, activeFile };
};

export const pinInLeaf = (leaf: LeafPane, file: string): LeafPane =>
  leaf.previewFile === file ? { ...leaf, previewFile: null } : leaf;

export const moveInLeaf = (leaf: LeafPane, file: string, toIndex: number): LeafPane => {
  const from = leaf.tabs.indexOf(file);
  if (from === -1) return leaf;
  const tabs = [...leaf.tabs];
  tabs.splice(from, 1);
  const dest = Math.max(0, Math.min(tabs.length, from < toIndex ? toIndex - 1 : toIndex));
  tabs.splice(dest, 0, file);
  return { ...leaf, tabs };
};

/** Rebind a path (the open file was renamed on disk) across tabs/active/preview.
 *  If `toPath` is ALREADY open in this pane (a rename ONTO an open destination),
 *  MERGE — map `fromPath` over and drop the duplicate, or the pane would carry two
 *  identical tabs (and duplicate React keys; closeInLeaf would later remove both). */
export const renameInLeaf = (leaf: LeafPane, fromPath: string, toPath: string): LeafPane => {
  if (!leaf.tabs.some((t) => renamePanelTab(t, fromPath, toPath) !== t)) return leaf;
  const mapped = leaf.tabs.map((t) => renamePanelTab(t, fromPath, toPath));
  const tabs = mapped.filter((t, i) => mapped.indexOf(t) === i);
  // On a MERGE (toPath pre-existed), the surviving toPath tab keeps its own state —
  // don't transfer fromPath's preview slot onto it (it may have been pinned), or the
  // next preview-open would replace that tab. Clear the slot instead.
  const previewMapped =
    leaf.previewFile === null ? null : renamePanelTab(leaf.previewFile, fromPath, toPath);
  const previewMerged =
    leaf.previewFile !== null &&
    previewMapped !== leaf.previewFile &&
    leaf.tabs.some((t) => t !== leaf.previewFile && t === previewMapped);
  return {
    ...leaf,
    tabs,
    activeFile: leaf.activeFile === null ? null : renamePanelTab(leaf.activeFile, fromPath, toPath),
    previewFile: previewMerged ? null : previewMapped,
  };
};
