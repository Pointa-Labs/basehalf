import { create } from 'zustand';
import {
  type FocusDir,
  type SplitDir,
  type TermNode,
  closeLeaf,
  directionalNeighbor,
  firstLeaf,
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
}

interface TerminalState {
  tabs: TermTab[];
  activeTabId: string;
  /** When set, the active tab shows only this leaf full-bleed (⌘⇧↵ zoom). */
  zoomedLeafId: string | null;
  /** Whether keyboard focus is inside the terminal dock — gates the Ghostty
   *  keymap and arbitrates ⌘W against the editor overlay. */
  focused: boolean;

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
  resizeFocused: (dir: FocusDir) => void;
  toggleZoom: () => void;
  setSplitFraction: (splitId: string, fraction: number) => void;
  setFocused: (focused: boolean) => void;
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
      // Grow the side the focused pane is on when moving "outward".
      const grow = dir === 'right' || dir === 'down';
      const delta = (grow === target.onSideA ? 1 : -1) * RESIZE_STEP;
      const tree = setFractionTree(tab.tree, target.splitId, split.fraction + delta);
      return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, tree } : t)) };
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
      return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, tree } : t)) };
    }),

  setFocused: (focused) => set({ focused }),
}));

// Local helper (the tree module exposes leaf finders; splits we look up here).
function findSplit(root: TermNode, id: string): Extract<TermNode, { type: 'split' }> | null {
  if (root.type === 'leaf') return null;
  if (root.id === id) return root;
  return findSplit(root.a, id) ?? findSplit(root.b, id);
}
