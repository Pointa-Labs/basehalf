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
  splitBounds,
  splitLeaf,
} from '../lib/terminalTree.js';

// Terminal dock layout: a set of TABS, each holding a recursive SPLIT TREE of
// panes. Each leaf id doubles as the key of the terminal session (one pty) it
// hosts — creating a leaf mounts a pty, removing it kills it.
//
// NOT persisted across reload: the ptys live in main and don't survive a
// renderer reload, so restoring a stale tree would point at dead sessions. Each
// load starts fresh with one tab + one terminal. (The dock WIDTH is persisted
// separately in the layout store.)

interface TermTab {
  id: string;
  tree: TermNode;
  focusedLeafId: string;
  /** A user-set tab name (double-click to rename). When set it overrides the
   *  live program title; empty/undefined → live title. */
  titleOverride?: string;
}

interface TerminalState {
  tabs: TermTab[];
  activeTabId: string;
  /** When set, the active tab shows only this leaf full-bleed (⌘⇧↵ zoom). */
  zoomedLeafId: string | null;
  /** Whether keyboard focus is inside the terminal dock — gates the dock keymap
   *  and arbitrates ⌘W against the editor overlay. */
  focused: boolean;
  /** Live terminal title per pane (the running program's OSC title, e.g.
   *  "claude", "zsh", a cwd). A tab shows its focused pane's title — tabs name
   *  the running program, not "Terminal N". */
  titles: Record<string, string>;
  /** Live cols×rows per pane (from xterm onResize) — drives the resize HUD. */
  dims: Record<string, { cols: number; rows: number }>;
  /** Bumped on every split resize (key or divider drag) so the dock can flash
   *  the dimensions HUD (the resize overlay). */
  resizeTick: number;
  /** The leaf being drag-moved (grab handle), or null. Gates the per-pane
   *  drop-zone overlays so they only show during a drag. */
  dragLeafId: string | null;
  /** Tab ids with unseen output since they were last active — drives the
   *  activity dot. Set when a pane in a NON-active tab emits output; cleared
   *  when that tab becomes active. */
  activity: Record<string, boolean>;
  /** Tabs that have been closed but not yet finalized — soft close. Their panes
   *  stay MOUNTED (hidden) so the ptys keep running and can be restored intact;
   *  a grace timer (or explicit dismiss) finalizes them, which unmounts the
   *  panes and kills the ptys. `index` is where to re-insert on undo. */
  closing: Array<{ key: string; tab: TermTab; index: number }>;

  newTab: () => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  /** Close every tab but `tabId` (right-click ▸ Close Others). */
  closeOtherTabs: (tabId: string) => void;
  /** Close every tab to the right of `tabId` (right-click ▸ Close to the Right). */
  closeTabsToRight: (tabId: string) => void;
  /** Flag the tab containing `leafId` as having unseen output (no-op if that
   *  tab is already active or already flagged). */
  markActivity: (leafId: string) => void;
  /** Restore a soft-closed tab (process intact) at its original index. */
  undoClose: (key: string) => void;
  /** Finalize a soft-closed tab — drop it for good so its panes unmount and
   *  their ptys are killed (grace-timer expiry or explicit dismiss). */
  finalizeClose: (key: string) => void;
  /** Close the focused split; collapse its parent; close the tab if it was the
   *  last split; always keep at least one terminal alive in the dock. */
  closeFocusedLeaf: () => void;
  splitFocused: (dir: SplitDir) => void;
  focusLeaf: (tabId: string, leafId: string) => void;
  gotoDir: (dir: FocusDir) => void;
  gotoRing: (delta: 1 | -1) => void;
  switchTab: (delta: 1 | -1) => void;
  /** Activate tab by 1-based index, clamped to the last. */
  gotoTab: (index: number) => void;
  /** Activate the last tab (⌘9). */
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

// Fraction of the WHOLE dock area the divider moves per ⌘⌃arrow press. We scale
// this by the target split's own normalized size so a small nested split and the
// root split move by the same on-screen amount (≈ constant pixels), instead of a
// flat per-split fraction that feels faster in small splits.
const AREA_RESIZE_STEP = 0.04;

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
  activity: {},
  closing: [],

  newTab: () => {
    const tab = freshTab();
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, zoomedLeafId: null }));
  },

  setActiveTab: (id) =>
    set((s) => ({ activeTabId: id, zoomedLeafId: null, activity: clearActivity(s.activity, id) })),

  // Soft close: move the tab to `closing` (its panes stay mounted + running) and
  // offer an undo. The lone tab is replaced by a fresh terminal so the dock is
  // never empty, but the old one is still restorable.
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tab = s.tabs[idx];
      if (!tab) return s;
      const closing = [...s.closing, { key: mint('close'), tab, index: idx }];
      const activity = clearActivity(s.activity, id);
      if (s.tabs.length <= 1) {
        const fresh = freshTab();
        return { tabs: [fresh], activeTabId: fresh.id, zoomedLeafId: null, activity, closing };
      }
      const tabs = s.tabs.filter((t) => t.id !== id);
      const fallback = tabs[Math.max(0, idx - 1)] ?? tabs[0];
      const activeTabId = s.activeTabId === id ? (fallback?.id ?? s.activeTabId) : s.activeTabId;
      return { tabs, activeTabId, zoomedLeafId: null, activity, closing };
    }),

  // Bulk closes are SOFT too (each removed tab → a `closing` entry with an undo
  // toast) — "Close Others" could otherwise kill many running agents at once
  // with no recourse, which is exactly what soft-close exists to prevent.
  closeOtherTabs: (tabId) =>
    set((s) => {
      const keep = s.tabs.find((t) => t.id === tabId);
      if (!keep || s.tabs.length <= 1) return s;
      const removed = s.tabs
        .map((tab, index) => ({ tab, index }))
        .filter(({ tab }) => tab.id !== tabId);
      return {
        tabs: [keep],
        activeTabId: tabId,
        zoomedLeafId: null,
        activity: {},
        closing: [
          ...s.closing,
          ...removed.map(({ tab, index }) => ({ key: mint('close'), tab, index })),
        ],
      };
    }),

  closeTabsToRight: (tabId) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0 || idx >= s.tabs.length - 1) return s;
      const tabs = s.tabs.slice(0, idx + 1);
      const removed = s.tabs.slice(idx + 1).map((tab, k) => ({ tab, index: idx + 1 + k }));
      const activeStillThere = tabs.some((t) => t.id === s.activeTabId);
      return {
        tabs,
        activeTabId: activeStillThere ? s.activeTabId : tabId,
        zoomedLeafId: null,
        closing: [
          ...s.closing,
          ...removed.map(({ tab, index }) => ({ key: mint('close'), tab, index })),
        ],
      };
    }),

  markActivity: (leafId) =>
    set((s) => {
      const tab = s.tabs.find((t) => findLeaf(t.tree, leafId));
      // Output in the active tab is visible → not "unseen". Already-flagged → no-op.
      if (!tab || tab.id === s.activeTabId || s.activity[tab.id]) return s;
      return { activity: { ...s.activity, [tab.id]: true } };
    }),

  undoClose: (key) =>
    set((s) => {
      const entry = s.closing.find((c) => c.key === key);
      if (!entry) return s;
      const tabs = [...s.tabs];
      tabs.splice(Math.min(Math.max(0, entry.index), tabs.length), 0, entry.tab);
      return {
        tabs,
        activeTabId: entry.tab.id,
        zoomedLeafId: null,
        closing: s.closing.filter((c) => c.key !== key),
      };
    }),

  finalizeClose: (key) =>
    set((s) =>
      s.closing.some((c) => c.key === key)
        ? { closing: s.closing.filter((c) => c.key !== key) }
        : s,
    ),

  closeFocusedLeaf: () =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const { root, focusId } = closeLeaf(tab.tree, tab.focusedLeafId);
      if (root === null) {
        // Closed the tab's last pane → SOFT-close the whole tab (undoable). The
        // lone tab is replaced by a fresh terminal, but the old one is kept
        // restorable so an accidental ⌘W never silently kills a running agent.
        const idx = s.tabs.findIndex((t) => t.id === tab.id);
        const closing = [...s.closing, { key: mint('close'), tab, index: idx }];
        if (s.tabs.length <= 1) {
          const fresh = freshTab();
          return { tabs: [fresh], activeTabId: fresh.id, zoomedLeafId: null, closing };
        }
        const tabs = s.tabs.filter((t) => t.id !== tab.id);
        const next = tabs[Math.max(0, idx - 1)] ?? tabs[0];
        return { tabs, activeTabId: next?.id ?? s.activeTabId, zoomedLeafId: null, closing };
      }
      // Multi-pane: trim just the focused pane (its pty is killed when the pane
      // unmounts). The tab and its other panes survive — a deliberate split edit.
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
      activity: clearActivity(s.activity, tabId),
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
      const id = next?.id ?? s.activeTabId;
      return { activeTabId: id, zoomedLeafId: null, activity: clearActivity(s.activity, id) };
    }),

  resizeFocused: (dir) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return s;
      const target = resizeTarget(tab.tree, tab.focusedLeafId, dir);
      if (!target) return s;
      const split = findSplit(tab.tree, target.splitId);
      if (!split) return s;
      // Direction maps to the divider ABSOLUTELY, independent of which side the
      // focused pane sits on: right/down move the divider right/down (grow
      // side-a), left/up move it back (shrink side-a). Resize also resets zoom.
      // Scale the step by the split's own axis size so nested and root splits
      // move by the same on-screen amount.
      const bounds = splitBounds(tab.tree, target.splitId);
      const axis = Math.max(0.05, split.dir === 'row' ? (bounds?.w ?? 1) : (bounds?.h ?? 1));
      const delta = ((dir === 'right' || dir === 'down' ? 1 : -1) * AREA_RESIZE_STEP) / axis;
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
      // Equalize preserves zoom.
      return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, tree } : t)) };
    }),

  gotoTab: (index) =>
    set((s) => {
      if (s.tabs.length === 0) return s;
      // 1-based, clamp to last (goto past the end → the last tab).
      const i = Math.min(Math.max(1, Math.floor(index)), s.tabs.length) - 1;
      const next = s.tabs[i];
      return next
        ? { activeTabId: next.id, zoomedLeafId: null, activity: clearActivity(s.activity, next.id) }
        : s;
    }),

  lastTab: () =>
    set((s) => {
      const next = s.tabs[s.tabs.length - 1];
      return next
        ? { activeTabId: next.id, zoomedLeafId: null, activity: clearActivity(s.activity, next.id) }
        : s;
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

/** Drop a tab's activity flag (it just became active → its output is now seen).
 *  Returns the SAME object when nothing changes, so it never forces a render. */
function clearActivity(act: Record<string, boolean>, tabId: string): Record<string, boolean> {
  if (!act[tabId]) return act;
  const { [tabId]: _drop, ...rest } = act;
  return rest;
}

// Local helper (the tree module exposes leaf finders; splits we look up here).
function findSplit(root: TermNode, id: string): Extract<TermNode, { type: 'split' }> | null {
  if (root.type === 'leaf') return null;
  if (root.id === id) return root;
  return findSplit(root.a, id) ?? findSplit(root.b, id);
}
