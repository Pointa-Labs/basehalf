import { create } from 'zustand';
import {
  type FocusDir,
  type SplitDir,
  type TermNode,
  closeLeaf,
  directionalNeighbor,
  equalize,
  findLeaf,
  firstLeaf,
  insertBeside,
  leaf,
  resizeTarget,
  ringNeighbor,
  setFraction as setFractionTree,
  splitLeaf,
} from '../lib/terminalTree.js';

// Ghostty-style terminal layout: a set of TABS, each holding a recursive SPLIT
// TREE of panes. Each leaf id doubles as the key of the terminal session (one
// pty) it hosts — creating a leaf mounts a pty, removing it kills it.
//
// NOT persisted across reload: the ptys live in main and don't survive a
// renderer reload, so restoring a stale tree would point at dead sessions. Each
// load starts fresh with one tab + one terminal. (The dock WIDTH is persisted
// separately in the layout store.)

interface TermTab {
  id: string;
  tree: TermNode;
  focusedLeafId: string;
  /** A user-set tab name (double-click to rename, Ghostty's `set_tab_title`).
   *  When set it overrides the live program title; empty/undefined → live title. */
  titleOverride?: string;
}

interface TerminalState {
  tabs: TermTab[];
  activeTabId: string;
  /** When set, the active tab shows only this leaf full-bleed (⌘⇧↵ zoom). */
  zoomedLeafId: string | null;
  /** Whether keyboard focus is inside the terminal dock — gates the Ghostty
   *  keymap and arbitrates ⌘W against the editor overlay. */
  focused: boolean;
  /** Live terminal title per pane (the running program's OSC title, e.g.
   *  "claude", "zsh", a cwd). A tab shows its focused pane's title — Ghostty's
   *  tabs name the running program, not "Terminal N". */
  titles: Record<string, string>;
  /** Live cols×rows per pane (from xterm onResize) — drives the resize HUD. */
  dims: Record<string, { cols: number; rows: number }>;
  /** Bumped on every split resize (key or divider drag) so the dock can flash
   *  the dimensions HUD (Ghostty's resize overlay). */
  resizeTick: number;
  /** The leaf being drag-moved (grab handle), or null. Gates the per-pane
   *  drop-zone overlays so they only show during a drag. */
  dragLeafId: string | null;

  newTab: () => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  /** Close the focused split; collapse its parent; close the tab if it was the
   *  last split; always keep at least one terminal alive in the dock. */
  closeFocusedLeaf: () => void;
  splitFocused: (dir: SplitDir) => void;
  focusLeaf: (tabId: string, leafId: string) => void;
  gotoDir: (dir: FocusDir) => void;
  gotoRing: (delta: 1 | -1) => void;
  switchTab: (delta: 1 | -1) => void;
  /** Activate tab by 1-based index, clamped to the last (Ghostty `goto_tab:N`). */
  gotoTab: (index: number) => void;
  /** Activate the last tab (Ghostty `last_tab`, ⌘9). */
  lastTab: () => void;
  resizeFocused: (dir: FocusDir) => void;
  equalizeSplits: () => void;
  toggleZoom: () => void;
  setSplitFraction: (splitId: string, fraction: number) => void;
  setFocused: (focused: boolean) => void;
  setTitle: (leafId: string, title: string) => void;
  setDims: (leafId: string, cols: number, rows: number) => void;
  /** Rename the active (or given) tab; empty string clears back to the live title. */
  setTabTitle: (tabId: string, title: string) => void;
  /** Reorder a tab to a new index (drag-to-reorder). */
  reorderTab: (tabId: string, toIndex: number) => void;
  setDragLeaf: (leafId: string | null) => void;
  /** Move a pane (keeping its pty) to sit beside another on the given edge —
   *  the drag-to-split drop. */
  moveLeafBeside: (sourceId: string, targetId: string, edge: FocusDir) => void;
}

let seq = 0;
const mint = (prefix: string): string => `${prefix}${++seq}`;

const freshTab = (): TermTab => {
  const id = mint('tab');
  const leafId = mint('p');
  return { id, tree: leaf(leafId), focusedLeafId: leafId };
};

const RESIZE_STEP = 0.04; // fraction per ⌘⌃arrow press

const initialTab = freshTab();

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  zoomedLeafId: null,
  focused: false,
  titles: {},
  dims: {},
  resizeTick: 0,
  dragLeafId: null,

  newTab: () => {
    const tab = freshTab();
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, zoomedLeafId: null }));
  },

  setActiveTab: (id) => set({ activeTabId: id, zoomedLeafId: null }),

  closeTab: (id) =>
    set((s) => {
      if (s.tabs.length <= 1) return s; // keep at least one tab
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const fallback = tabs[Math.max(0, idx - 1)] ?? tabs[0];
      const activeTabId = s.activeTabId === id ? (fallback?.id ?? s.activeTabId) : s.activeTabId;
      return { tabs, activeTabId, zoomedLeafId: null };
    }),

  closeFocusedLeaf: () =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const { root, focusId } = closeLeaf(tab.tree, tab.focusedLeafId);
      if (root === null) {
        // Closed the tab's last split. Drop the tab — unless it's the only one,
        // in which case start a fresh terminal so the dock is never empty.
        if (s.tabs.length <= 1) {
          const t = freshTab();
          return { tabs: [t], activeTabId: t.id, zoomedLeafId: null };
        }
        const idx = s.tabs.findIndex((t) => t.id === tab.id);
        const tabs = s.tabs.filter((t) => t.id !== tab.id);
        const next = tabs[Math.max(0, idx - 1)] ?? tabs[0];
        return { tabs, activeTabId: next?.id ?? s.activeTabId, zoomedLeafId: null };
      }
      const updated: TermTab = {
        ...tab,
        tree: root,
        focusedLeafId: focusId ?? firstLeaf(root).id,
      };
      return {
        tabs: s.tabs.map((t) => (t.id === tab.id ? updated : t)),
        zoomedLeafId: null,
      };
    }),

  splitFocused: (dir) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const newId = mint('p');
      const tree = splitLeaf(tab.tree, tab.focusedLeafId, dir, newId, mint('s'));
      const updated: TermTab = { ...tab, tree, focusedLeafId: newId };
      return {
        tabs: s.tabs.map((t) => (t.id === tab.id ? updated : t)),
        // A split implicitly unzooms (you want to see both panes).
        zoomedLeafId: null,
      };
    }),

  focusLeaf: (tabId, leafId) =>
    set((s) => ({
      activeTabId: tabId,
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, focusedLeafId: leafId } : t)),
    })),

  gotoDir: (dir) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const next = directionalNeighbor(tab.tree, tab.focusedLeafId, dir);
      if (!next) return s;
      return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, focusedLeafId: next } : t)) };
    }),

  gotoRing: (delta) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const next = ringNeighbor(tab.tree, tab.focusedLeafId, delta);
      return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, focusedLeafId: next } : t)) };
    }),

  switchTab: (delta) =>
    set((s) => {
      if (s.tabs.length <= 1) return s;
      const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const next = s.tabs[(i + delta + s.tabs.length) % s.tabs.length];
      return { activeTabId: next?.id ?? s.activeTabId, zoomedLeafId: null };
    }),

  resizeFocused: (dir) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const target = resizeTarget(tab.tree, tab.focusedLeafId, dir);
      if (!target) return s;
      const split = findSplit(tab.tree, target.splitId);
      if (!split) return s;
      // Ghostty maps direction → divider ABSOLUTELY, independent of which side
      // the focused pane sits on: right/down move the divider right/down (grow
      // side-a), left/up move it back (shrink side-a). Resize also resets zoom.
      const delta = (dir === 'right' || dir === 'down' ? 1 : -1) * RESIZE_STEP;
      const tree = setFractionTree(tab.tree, target.splitId, split.fraction + delta);
      return {
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, tree } : t)),
        zoomedLeafId: null,
        resizeTick: s.resizeTick + 1,
      };
    }),

  equalizeSplits: () =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab || tab.tree.type === 'leaf') return s;
      const tree = equalize(tab.tree);
      // Ghostty preserves zoom across equalize.
      return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, tree } : t)) };
    }),

  gotoTab: (index) =>
    set((s) => {
      if (s.tabs.length === 0) return s;
      // 1-based, clamp to last (Ghostty: goto_tab past the end → last tab).
      const i = Math.min(Math.max(1, Math.floor(index)), s.tabs.length) - 1;
      const next = s.tabs[i];
      return next ? { activeTabId: next.id, zoomedLeafId: null } : s;
    }),

  lastTab: () =>
    set((s) => {
      const next = s.tabs[s.tabs.length - 1];
      return next ? { activeTabId: next.id, zoomedLeafId: null } : s;
    }),

  toggleZoom: () =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      // Only zoomable when there's more than one pane.
      if (tab.tree.type === 'leaf') return { zoomedLeafId: null };
      return { zoomedLeafId: s.zoomedLeafId ? null : tab.focusedLeafId };
    }),

  setSplitFraction: (splitId, fraction) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const tree = setFractionTree(tab.tree, splitId, fraction);
      return {
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, tree } : t)),
        resizeTick: s.resizeTick + 1,
      };
    }),

  setFocused: (focused) => set({ focused }),

  setTitle: (leafId, title) =>
    set((s) => {
      const next = title.trim();
      if (!next || s.titles[leafId] === next) return s;
      return { titles: { ...s.titles, [leafId]: next } };
    }),

  setDims: (leafId, cols, rows) =>
    set((s) => {
      const cur = s.dims[leafId];
      if (cur && cur.cols === cols && cur.rows === rows) return s;
      return { dims: { ...s.dims, [leafId]: { cols, rows } } };
    }),

  setTabTitle: (tabId, title) =>
    set((s) => {
      const override = title.trim();
      return {
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, titleOverride: override || undefined } : t,
        ),
      };
    }),

  reorderTab: (tabId, toIndex) =>
    set((s) => {
      const from = s.tabs.findIndex((t) => t.id === tabId);
      if (from < 0) return s;
      const to = Math.min(Math.max(0, Math.floor(toIndex)), s.tabs.length - 1);
      if (from === to) return s;
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      if (!moved) return s;
      tabs.splice(to, 0, moved);
      return { tabs };
    }),

  setDragLeaf: (leafId) => set({ dragLeafId: leafId }),

  moveLeafBeside: (sourceId, targetId, edge) =>
    set((s) => {
      if (sourceId === targetId) return { dragLeafId: null };
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return { dragLeafId: null };
      if (!findLeaf(tab.tree, sourceId) || !findLeaf(tab.tree, targetId)) {
        return { dragLeafId: null };
      }
      // Remove the source (collapse its parent), then re-insert it beside the
      // target using the SAME leaf id, so React keeps the keyed mount and the
      // pane's pty/xterm survives the move (no remount = no killed shell).
      const { root: without } = closeLeaf(tab.tree, sourceId);
      if (!without || !findLeaf(without, targetId)) return { dragLeafId: null };
      const tree = insertBeside(without, targetId, edge, sourceId, mint('s'));
      return {
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, tree, focusedLeafId: sourceId } : t)),
        zoomedLeafId: null,
        dragLeafId: null,
      };
    }),
}));

// Local helper (the tree module exposes leaf finders; splits we look up here).
function findSplit(root: TermNode, id: string): Extract<TermNode, { type: 'split' }> | null {
  if (root.type === 'leaf') return null;
  if (root.id === id) return root;
  return findSplit(root.a, id) ?? findSplit(root.b, id);
}
