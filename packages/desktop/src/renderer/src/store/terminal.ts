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
  orderedLeafIds,
  resizeTarget,
  ringNeighbor,
  setFraction as setFractionTree,
  splitBounds,
  splitLeaf,
} from '../lib/terminalTree.js';

// Terminal dock layout, modeled on a native tabbed terminal: the dock is a list
// of TABS shown in one strip at the top (always visible, for discoverability in
// an embedded panel). Each tab owns its OWN pane split-tree (terminalTree) whose leaves are PANES
// (one pty each) — splitting divides a pane within the current tab, never the
// tabs. Tabs are the top-level container; splits live inside a tab.
//
// NOT persisted across reload: the ptys live in main and don't survive a renderer
// reload, so restoring a stale layout would point at dead sessions. Each load
// starts fresh with one tab holding one pane. (The dock WIDTH is persisted
// separately in the layout store.)

/** One tab: a name override plus its own pane split-tree (one pty per leaf). */
export interface TermTab {
  id: string;
  /** Split tree of panes; every leaf id is a pane(=pty) id. */
  tree: TermNode;
  /** The focused pane within this tab. */
  activePaneId: string;
  /** When set, this pane fills the tab area (⌘⇧↵ zoom); the tree is preserved. */
  zoomedPaneId: string | null;
  /** A user-set tab name (double-click / context-menu rename). When set it
   *  overrides the live program title; empty/undefined → live title. */
  titleOverride?: string;
}

/** A soft-closed tab — the whole tab, kept MOUNTED (hidden) so its panes keep
 *  running and can be restored intact until a grace timer (or dismiss). */
interface ClosingTab {
  key: string;
  kind: 'tab';
  tab: TermTab;
  index: number;
}

/** A soft-closed pane inside a surviving tab — kept MOUNTED (hidden) so its pty
 *  keeps running. `treeSnapshot` is the tab's tree BEFORE the close, so undo can
 *  restore the pane on its original side. */
interface ClosingPane {
  key: string;
  kind: 'pane';
  tabId: string;
  paneId: string;
  treeSnapshot: TermNode;
}

type ClosingEntry = ClosingTab | ClosingPane;

interface TerminalState {
  /** Ordered tabs shown in the strip. */
  tabs: TermTab[];
  activeTabId: string;
  /** Whether keyboard focus is inside the terminal dock — gates the dock keymap
   *  and arbitrates ⌘W against the editor overlay. */
  focused: boolean;
  /** Live terminal title per PANE (pty OSC title). Keyed by pane(=pty) id. */
  titles: Record<string, string>;
  /** Live cols×rows per pane (from xterm onResize) — drives the resize HUD. */
  dims: Record<string, { cols: number; rows: number }>;
  /** Bumped on every pane resize (key or divider drag) so the dock can flash
   *  the dimensions HUD. */
  resizeTick: number;
  /** Tab ids with unseen output — drives the tab activity dot. Set when a pane in
   *  a non-active tab emits output; cleared when the tab becomes active. */
  activity: Record<string, boolean>;
  /** Soft-closed tabs/panes awaiting finalize (stay mounted + running). */
  closing: ClosingEntry[];
  /** The tab being dragged to reorder within the strip, or null. */
  drag: { tabId: string } | null;
  /** The pane being dragged (by its grab handle) to rearrange the split, or null. */
  paneDrag: { paneId: string } | null;

  // Tabs ──────────────────────────────────────────────────────────────────────
  /** ⌘T: new tab (one fresh pane), inserted after the active tab + focused. */
  newTab: () => void;
  selectTab: (tabId: string) => void;
  /** ⌘⇧[ / ⌘⇧]: previous / next tab, wrapping. */
  switchTab: (delta: 1 | -1) => void;
  /** ⌘1–8: select tab by 1-based index, clamped to the last. */
  gotoTab: (index: number) => void;
  /** ⌘9: select the last tab. */
  lastTab: () => void;
  setTabTitle: (tabId: string, title: string) => void;
  reorderTab: (tabId: string, toIndex: number) => void;

  // Panes within the active tab ────────────────────────────────────────────────
  /** ⌘D / ⌘⇧D: split the active pane; the new pane takes focus. */
  splitPane: (dir: SplitDir) => void;
  focusPane: (tabId: string, paneId: string) => void;
  /** ⌘⌥arrow: move pane focus spatially within the active tab. */
  gotoPaneDir: (dir: FocusDir) => void;
  /** ⌘[ / ⌘]: cycle pane focus in tree order within the active tab. */
  gotoPaneRing: (delta: 1 | -1) => void;
  /** Drag-rearrange: move `paneId` to sit beside `destPaneId` on `side` (both in
   *  the active tab); the dragged pane keeps its pty (same id → no remount). */
  movePane: (paneId: string, side: FocusDir, destPaneId: string) => void;
  /** ⌘⌃arrow: resize the split around the active pane. */
  resizePane: (dir: FocusDir) => void;
  /** ⌘⌃=: even out all splits in the active tab. */
  equalizePanes: () => void;
  /** ⌘⇧↵: zoom/unzoom the active pane within its tab. */
  toggleZoom: () => void;
  setSplitFraction: (splitId: string, fraction: number) => void;

  // Closing (soft) ──────────────────────────────────────────────────────────
  /** Close one pane in the active tab; the last pane closing closes the tab. */
  closePane: (paneId?: string) => void;
  /** ⌘W: close the active pane (close the tab if it's the last pane). */
  closeActivePane: () => void;
  /** ⌘⌥W / the tab's × : close the whole tab (all its panes). */
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  undoClose: (key: string) => void;
  finalizeClose: (key: string) => void;

  // Plumbing ────────────────────────────────────────────────────────────────
  setFocused: (focused: boolean) => void;
  setTitle: (paneId: string, title: string) => void;
  setDims: (paneId: string, cols: number, rows: number) => void;
  markActivity: (paneId: string) => void;
  setDrag: (drag: { tabId: string } | null) => void;
  setPaneDrag: (drag: { paneId: string } | null) => void;
}

let seq = 0;
const mint = (prefix: string): string => `${prefix}${++seq}`;

const freshTab = (): TermTab => {
  const id = mint('tab');
  const paneId = mint('p');
  return { id, tree: leaf(paneId), activePaneId: paneId, zoomedPaneId: null };
};

// Fraction of the WHOLE tab area a divider moves per ⌘⌃arrow press, scaled by the
// split's own size so nested and root splits move by the same visual amount.
const AREA_RESIZE_STEP = 0.04;

const initialTab = freshTab();

export const useTerminalStore = create<TerminalState>((set) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  focused: false,
  titles: {},
  dims: {},
  resizeTick: 0,
  activity: {},
  closing: [],
  drag: null,
  paneDrag: null,

  newTab: () =>
    set((s) => {
      const tab = freshTab();
      const at = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const tabs = [...s.tabs];
      tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
      return { tabs, activeTabId: tab.id };
    }),

  selectTab: (tabId) =>
    set((s) =>
      s.tabs.some((t) => t.id === tabId)
        ? { activeTabId: tabId, activity: clearActivity(s.activity, tabId) }
        : s,
    ),

  switchTab: (delta) =>
    set((s) => {
      if (s.tabs.length <= 1) return s;
      const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const next = s.tabs[(i + delta + s.tabs.length) % s.tabs.length];
      if (!next) return s;
      return { activeTabId: next.id, activity: clearActivity(s.activity, next.id) };
    }),

  gotoTab: (index) =>
    set((s) => {
      const i = Math.min(Math.max(1, Math.floor(index)), s.tabs.length) - 1;
      const next = s.tabs[i];
      if (!next) return s;
      return { activeTabId: next.id, activity: clearActivity(s.activity, next.id) };
    }),

  lastTab: () =>
    set((s) => {
      const next = s.tabs[s.tabs.length - 1];
      if (!next) return s;
      return { activeTabId: next.id, activity: clearActivity(s.activity, next.id) };
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
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      if (!moved) return s;
      const adjusted = from < toIndex ? toIndex - 1 : toIndex;
      tabs.splice(Math.min(Math.max(0, adjusted), tabs.length), 0, moved);
      return { tabs, drag: null };
    }),

  splitPane: (dir) =>
    set((s) =>
      updateActiveTab(s, (tab) => {
        const paneId = mint('p');
        return {
          ...tab,
          tree: splitLeaf(tab.tree, tab.activePaneId, dir, paneId, mint('s')),
          activePaneId: paneId,
          zoomedPaneId: null,
        };
      }),
    ),

  focusPane: (tabId, paneId) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab || !findLeaf(tab.tree, paneId)) return s;
      return {
        activeTabId: tabId,
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)),
        activity: clearActivity(s.activity, tabId),
      };
    }),

  gotoPaneDir: (dir) =>
    set((s) =>
      updateActiveTab(s, (tab) => {
        const next = directionalNeighbor(tab.tree, tab.activePaneId, dir);
        return next ? { ...tab, activePaneId: next, zoomedPaneId: null } : tab;
      }),
    ),

  gotoPaneRing: (delta) =>
    set((s) =>
      updateActiveTab(s, (tab) => ({
        ...tab,
        activePaneId: ringNeighbor(tab.tree, tab.activePaneId, delta),
        zoomedPaneId: null,
      })),
    ),

  movePane: (paneId, side, destPaneId) =>
    set((s) => {
      if (paneId === destPaneId) return { paneDrag: null };
      const tab = activeTab(s);
      if (!tab || !findLeaf(tab.tree, paneId) || !findLeaf(tab.tree, destPaneId))
        return { paneDrag: null };
      // Pull the pane out (its sibling collapses up), then re-insert it beside the
      // target on `side`. The leaf keeps its id, so the pty never remounts.
      const { root } = closeLeaf(tab.tree, paneId);
      if (!root) return { paneDrag: null }; // it was the only pane
      const tree = insertBeside(root, destPaneId, side, paneId, mint('s'));
      return {
        tabs: replaceTab(s.tabs, tab.id, {
          ...tab,
          tree,
          activePaneId: paneId,
          zoomedPaneId: null,
        }),
        paneDrag: null,
      };
    }),

  resizePane: (dir) =>
    set((s) => {
      const tab = activeTab(s);
      if (!tab) return s;
      const target = resizeTarget(tab.tree, tab.activePaneId, dir);
      if (!target) return s;
      const split = findSplit(tab.tree, target.splitId);
      if (!split) return s;
      const bounds = splitBounds(tab.tree, target.splitId);
      const axis = Math.max(0.05, split.dir === 'row' ? (bounds?.w ?? 1) : (bounds?.h ?? 1));
      const delta = ((dir === 'right' || dir === 'down' ? 1 : -1) * AREA_RESIZE_STEP) / axis;
      return {
        tabs: replaceTab(s.tabs, tab.id, {
          ...tab,
          tree: setFractionTree(tab.tree, target.splitId, split.fraction + delta),
          zoomedPaneId: null,
        }),
        resizeTick: s.resizeTick + 1,
      };
    }),

  equalizePanes: () =>
    set((s) => {
      const tab = activeTab(s);
      if (!tab || tab.tree.type === 'leaf') return s;
      return {
        // Rebalancing reveals the whole layout, so unzoom (matches resizePane).
        tabs: replaceTab(s.tabs, tab.id, { ...tab, tree: equalize(tab.tree), zoomedPaneId: null }),
        resizeTick: s.resizeTick + 1,
      };
    }),

  toggleZoom: () =>
    set((s) =>
      updateActiveTab(s, (tab) =>
        tab.tree.type === 'leaf'
          ? { ...tab, zoomedPaneId: null }
          : { ...tab, zoomedPaneId: tab.zoomedPaneId ? null : tab.activePaneId },
      ),
    ),

  setSplitFraction: (splitId, fraction) =>
    set((s) => {
      const tab = activeTab(s);
      if (!tab) return s;
      return {
        tabs: replaceTab(s.tabs, tab.id, {
          ...tab,
          tree: setFractionTree(tab.tree, splitId, fraction),
        }),
        resizeTick: s.resizeTick + 1,
      };
    }),

  closePane: (paneId) =>
    set((s) => {
      const tab = activeTab(s);
      if (!tab) return s;
      const pid = paneId ?? tab.activePaneId;
      if (!findLeaf(tab.tree, pid)) return s;
      // Last pane → closing it closes the whole tab (soft).
      if (orderedLeafIds(tab.tree).length <= 1) return closeTabState(s, tab.id);

      const entry: ClosingPane = {
        key: mint('close'),
        kind: 'pane',
        tabId: tab.id,
        paneId: pid,
        treeSnapshot: tab.tree,
      };
      const { root, focusId } = closeLeaf(tab.tree, pid);
      const tree = root ?? tab.tree;
      const activePaneId =
        tab.activePaneId === pid ? (focusId ?? firstLeaf(tree).id) : tab.activePaneId;
      return {
        tabs: replaceTab(s.tabs, tab.id, {
          ...tab,
          tree,
          activePaneId,
          zoomedPaneId: tab.zoomedPaneId === pid ? null : tab.zoomedPaneId,
        }),
        closing: [...s.closing, entry],
      };
    }),

  closeActivePane: () => useTerminalStore.getState().closePane(),

  closeTab: (tabId) => set((s) => closeTabState(s, tabId)),

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
        activity: removed.reduce((a, { tab }) => clearActivity(a, tab.id), s.activity),
        closing: [
          ...s.closing,
          ...removed.map(
            ({ tab, index }): ClosingTab => ({ key: mint('close'), kind: 'tab', tab, index }),
          ),
        ],
      };
    }),

  closeTabsToRight: (tabId) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0 || idx >= s.tabs.length - 1) return s;
      const kept = s.tabs.slice(0, idx + 1);
      const removed = s.tabs.slice(idx + 1).map((tab, k) => ({ tab, index: idx + 1 + k }));
      const activeTabId = kept.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabId;
      return {
        tabs: kept,
        activeTabId,
        activity: removed.reduce((a, { tab }) => clearActivity(a, tab.id), s.activity),
        closing: [
          ...s.closing,
          ...removed.map(
            ({ tab, index }): ClosingTab => ({ key: mint('close'), kind: 'tab', tab, index }),
          ),
        ],
      };
    }),

  undoClose: (key) =>
    set((s) => {
      const entry = s.closing.find((c) => c.key === key);
      if (!entry) return s;
      const closing = s.closing.filter((c) => c.key !== key);

      if (entry.kind === 'tab') {
        const tabs = [...s.tabs];
        tabs.splice(Math.min(Math.max(0, entry.index), tabs.length), 0, entry.tab);
        return { tabs, activeTabId: entry.tab.id, closing };
      }

      // Pane: restore into its tab if it still exists, else as a fresh tab.
      const tab = s.tabs.find((t) => t.id === entry.tabId);
      if (tab) {
        return {
          tabs: replaceTab(s.tabs, tab.id, {
            ...tab,
            tree: reinsertPaneLeaf(tab.tree, entry.treeSnapshot, entry.paneId),
            activePaneId: entry.paneId,
            zoomedPaneId: null,
          }),
          activeTabId: tab.id,
          closing,
        };
      }
      const restored: TermTab = {
        id: mint('tab'),
        tree: leaf(entry.paneId),
        activePaneId: entry.paneId,
        zoomedPaneId: null,
      };
      return { tabs: [...s.tabs, restored], activeTabId: restored.id, closing };
    }),

  finalizeClose: (key) =>
    set((s) =>
      s.closing.some((c) => c.key === key)
        ? { closing: s.closing.filter((c) => c.key !== key) }
        : s,
    ),

  setFocused: (focused) => set({ focused }),

  setTitle: (paneId, title) =>
    set((s) => {
      const next = title.trim();
      if (!next || s.titles[paneId] === next) return s;
      return { titles: { ...s.titles, [paneId]: next } };
    }),

  setDims: (paneId, cols, rows) =>
    set((s) => {
      const cur = s.dims[paneId];
      if (cur && cur.cols === cols && cur.rows === rows) return s;
      return { dims: { ...s.dims, [paneId]: { cols, rows } } };
    }),

  markActivity: (paneId) =>
    set((s) => {
      const owner = s.tabs.find((t) => findLeaf(t.tree, paneId));
      if (!owner) return s; // a closing pane, or unknown → ignore
      if (owner.id === s.activeTabId || s.activity[owner.id]) return s;
      return { activity: { ...s.activity, [owner.id]: true } };
    }),

  setDrag: (drag) => set({ drag }),

  setPaneDrag: (paneDrag) => set({ paneDrag }),
}));

const activeTab = (s: TerminalState): TermTab | undefined =>
  s.tabs.find((t) => t.id === s.activeTabId);

const replaceTab = (tabs: TermTab[], tabId: string, next: TermTab): TermTab[] =>
  tabs.map((t) => (t.id === tabId ? next : t));

/** Apply a pure transform to the active tab; no-op if there is none. */
function updateActiveTab(s: TerminalState, fn: (tab: TermTab) => TermTab): Partial<TerminalState> {
  const tab = activeTab(s);
  if (!tab) return s;
  const next = fn(tab);
  return next === tab ? s : { tabs: replaceTab(s.tabs, tab.id, next) };
}

/** Soft-close a whole tab; the dock keeps ≥1 tab (a fresh one if it was last). */
function closeTabState(s: TerminalState, tabId: string): Partial<TerminalState> {
  const index = s.tabs.findIndex((t) => t.id === tabId);
  const tab = s.tabs[index];
  if (!tab) return s;
  const entry: ClosingTab = { key: mint('close'), kind: 'tab', tab, index };
  const closing = [...s.closing, entry];
  const activity = clearActivity(s.activity, tabId);
  const remaining = s.tabs.filter((t) => t.id !== tabId);

  if (remaining.length === 0) {
    const fresh = freshTab();
    return { tabs: [fresh], activeTabId: fresh.id, activity, closing };
  }
  const activeTabId =
    s.activeTabId === tabId
      ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? s.activeTabId)
      : s.activeTabId;
  return { tabs: remaining, activeTabId, activity, closing };
}

/** Drop a tab's activity flag (it became active → its output is now seen).
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

/** The parent split of a leaf and which side it's on (for restoring position). */
function locateLeaf(
  root: TermNode,
  leafId: string,
): { split: Extract<TermNode, { type: 'split' }>; side: 'a' | 'b' } | null {
  if (root.type === 'leaf') return null;
  if (root.a.type === 'leaf' && root.a.id === leafId) return { split: root, side: 'a' };
  if (root.b.type === 'leaf' && root.b.id === leafId) return { split: root, side: 'b' };
  return locateLeaf(root.a, leafId) ?? locateLeaf(root.b, leafId);
}

/** Re-insert a soft-closed pane's leaf into the tab's CURRENT tree, restoring its
 *  old spot when a former sibling still exists (else beside the first pane). Never
 *  replaces the whole tree, so panes split during the undo grace survive. */
function reinsertPaneLeaf(current: TermNode, snapshot: TermNode, paneId: string): TermNode {
  const splitId = mint('s');
  const loc = locateLeaf(snapshot, paneId);
  if (loc) {
    const wasA = loc.side === 'a';
    const side: FocusDir =
      loc.split.dir === 'row' ? (wasA ? 'left' : 'right') : wasA ? 'up' : 'down';
    const sibling = wasA ? loc.split.b : loc.split.a;
    const anchor = orderedLeafIds(sibling).find((id) => findLeaf(current, id));
    if (anchor) return insertBeside(current, anchor, side, paneId, splitId);
  }
  // Snapshot had it as the whole tree, or no former sibling survives → append.
  return insertBeside(current, firstLeaf(current).id, 'right', paneId, splitId);
}
