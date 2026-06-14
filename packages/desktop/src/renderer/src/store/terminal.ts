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

// Editor-groups terminal layout. The dock is a GRID of GROUPS: one recursive
// split tree (terminalTree) whose every LEAF id is a GROUP id. Each group owns a
// tab strip of single-terminal TABS (one pty per tab). Splitting happens at the
// GROUP level (like a code editor's editor groups), not inside a tab.
//
// NOT persisted across reload: the ptys live in main and don't survive a renderer
// reload, so restoring a stale layout would point at dead sessions. Each load
// starts fresh with one group + one tab. (The dock WIDTH is persisted separately
// in the layout store.)

/** One terminal = one pty. The tab id doubles as the pty session key. */
export interface TermTab {
  id: string;
  /** A user-set tab name (double-click / context-menu rename). When set it
   *  overrides the live program title; empty/undefined → live title. */
  titleOverride?: string;
}

/** A group is a leaf in the layout tree: its own tab strip of single-pty tabs. */
export interface TermGroup {
  id: string;
  tabs: TermTab[];
  activeTabId: string;
}

/** A soft-closed tab: kept MOUNTED (hidden) so its pty keeps running and can be
 *  restored intact, until a grace timer (or dismiss) finalizes it. */
interface ClosingTab {
  key: string;
  tab: TermTab;
  groupId: string;
  tabIndex: number;
  /** The layout captured BEFORE this close — used to recreate the group leaf on
   *  undo when closing the group's last tab collapsed it. */
  layoutSnapshot: TermNode;
}

interface TerminalState {
  /** Split tree of GROUPS; every leaf id is a group id. */
  layout: TermNode;
  groups: Record<string, TermGroup>;
  activeGroupId: string;
  /** When set, the active tab of this group fills the dock (⌘⇧↵ zoom). */
  zoomedGroupId: string | null;
  /** Whether keyboard focus is inside the terminal dock — gates the dock keymap
   *  and arbitrates ⌘W against the editor overlay. */
  focused: boolean;
  /** Live terminal title per tab (pty OSC title). A tab shows its own title;
   *  falls back to "Terminal". Keyed by tab(=pty) id. */
  titles: Record<string, string>;
  /** Live cols×rows per tab (from xterm onResize) — drives the resize HUD. */
  dims: Record<string, { cols: number; rows: number }>;
  /** Bumped on every group resize (key or divider drag) so the dock can flash
   *  the dimensions HUD. */
  resizeTick: number;
  /** Tab ids with unseen output — drives the activity dot. Set when a tab that
   *  isn't the active tab of the active group emits output; cleared when it
   *  becomes active. */
  activity: Record<string, boolean>;
  /** Soft-closed tabs awaiting finalize (panes stay mounted + running). */
  closing: ClosingTab[];
  /** The tab being dragged (to reorder, move to another group, or split a group
   *  by dropping on its edge), or null. */
  drag: { tabId: string; fromGroupId: string } | null;

  // Tabs within a group ────────────────────────────────────────────────────
  newTab: () => void;
  focusTab: (groupId: string, tabId: string) => void;
  setActiveGroup: (groupId: string) => void;
  switchTab: (delta: 1 | -1) => void;
  /** Select tab by 1-based index within the active group, clamped to the last. */
  gotoTab: (index: number) => void;
  /** Select the last tab in the active group (⌘9). */
  lastTab: () => void;
  setTabTitle: (groupId: string, tabId: string, title: string) => void;
  reorderTab: (groupId: string, tabId: string, toIndex: number) => void;

  // Group structure ─────────────────────────────────────────────────────────
  /** ⌘D / ⌘⇧D: split the active group, new group gets a fresh terminal. */
  splitGroupWithNewTab: (dir: SplitDir) => void;
  /** Drag-to-edge: split `targetGroupId` on `side`, MOVING the dragged tab into
   *  the new group (pty kept alive). Collapses the source group if it empties. */
  splitGroupWithTab: (
    targetGroupId: string,
    side: FocusDir,
    tabId: string,
    fromGroupId: string,
  ) => void;
  /** Move a tab to a group (reorder if same group; append/insert if different);
   *  collapse the source group if it empties. */
  moveTab: (tabId: string, fromGroupId: string, toGroupId: string, toIndex: number) => void;
  gotoGroupDir: (dir: FocusDir) => void;
  gotoGroupRing: (delta: 1 | -1) => void;
  resizeFocusedGroup: (dir: FocusDir) => void;
  equalizeGroups: () => void;
  toggleZoom: () => void;
  setSplitFraction: (splitId: string, fraction: number) => void;

  // Closing (soft) ──────────────────────────────────────────────────────────
  closeTab: (groupId: string, tabId: string) => void;
  /** ⌘W: soft-close the active group's active tab. */
  closeActiveTab: () => void;
  closeOtherTabs: (groupId: string, tabId: string) => void;
  closeTabsToRight: (groupId: string, tabId: string) => void;
  undoClose: (key: string) => void;
  finalizeClose: (key: string) => void;

  // Plumbing ────────────────────────────────────────────────────────────────
  setFocused: (focused: boolean) => void;
  setTitle: (tabId: string, title: string) => void;
  setDims: (tabId: string, cols: number, rows: number) => void;
  markActivity: (tabId: string) => void;
  setDrag: (drag: { tabId: string; fromGroupId: string } | null) => void;
}

let seq = 0;
const mint = (prefix: string): string => `${prefix}${++seq}`;

const freshGroup = (): TermGroup => {
  const id = mint('g');
  const tabId = mint('t');
  return { id, tabs: [{ id: tabId }], activeTabId: tabId };
};

// Fraction of the WHOLE dock area a divider moves per ⌘⌃arrow press, scaled by
// the split's own size so nested and root group splits move by the same amount.
const AREA_RESIZE_STEP = 0.04;

const initialGroup = freshGroup();

export const useTerminalStore = create<TerminalState>((set) => ({
  layout: leaf(initialGroup.id),
  groups: { [initialGroup.id]: initialGroup },
  activeGroupId: initialGroup.id,
  zoomedGroupId: null,
  focused: false,
  titles: {},
  dims: {},
  resizeTick: 0,
  activity: {},
  closing: [],
  drag: null,

  newTab: () =>
    set((s) => {
      const g = s.groups[s.activeGroupId];
      if (!g) return s;
      const id = mint('t');
      return {
        groups: { ...s.groups, [g.id]: { ...g, tabs: [...g.tabs, { id }], activeTabId: id } },
        zoomedGroupId: null,
      };
    }),

  focusTab: (groupId, tabId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return {
        activeGroupId: groupId,
        groups: { ...s.groups, [groupId]: { ...g, activeTabId: tabId } },
        activity: clearActivity(s.activity, tabId),
      };
    }),

  setActiveGroup: (groupId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      return { activeGroupId: groupId, activity: clearActivity(s.activity, g.activeTabId) };
    }),

  switchTab: (delta) =>
    set((s) => {
      const g = s.groups[s.activeGroupId];
      if (!g || g.tabs.length <= 1) return s;
      const i = g.tabs.findIndex((t) => t.id === g.activeTabId);
      const next = g.tabs[(i + delta + g.tabs.length) % g.tabs.length];
      if (!next) return s;
      return {
        groups: { ...s.groups, [g.id]: { ...g, activeTabId: next.id } },
        activity: clearActivity(s.activity, next.id),
      };
    }),

  gotoTab: (index) =>
    set((s) => {
      const g = s.groups[s.activeGroupId];
      if (!g) return s;
      const i = Math.min(Math.max(1, Math.floor(index)), g.tabs.length) - 1;
      const next = g.tabs[i];
      if (!next) return s;
      return {
        groups: { ...s.groups, [g.id]: { ...g, activeTabId: next.id } },
        activity: clearActivity(s.activity, next.id),
      };
    }),

  lastTab: () =>
    set((s) => {
      const g = s.groups[s.activeGroupId];
      if (!g) return s;
      const next = g.tabs[g.tabs.length - 1];
      if (!next) return s;
      return {
        groups: { ...s.groups, [g.id]: { ...g, activeTabId: next.id } },
        activity: clearActivity(s.activity, next.id),
      };
    }),

  setTabTitle: (groupId, tabId, title) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const override = title.trim();
      return {
        groups: {
          ...s.groups,
          [groupId]: {
            ...g,
            tabs: g.tabs.map((t) =>
              t.id === tabId ? { ...t, titleOverride: override || undefined } : t,
            ),
          },
        },
      };
    }),

  reorderTab: (groupId, tabId, toIndex) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const from = g.tabs.findIndex((t) => t.id === tabId);
      if (from < 0) return s;
      const tabs = [...g.tabs];
      const [moved] = tabs.splice(from, 1);
      if (!moved) return s;
      tabs.splice(Math.min(Math.max(0, toIndex), tabs.length), 0, moved);
      return { groups: { ...s.groups, [groupId]: { ...g, tabs } } };
    }),

  splitGroupWithNewTab: (dir) =>
    set((s) => {
      const newGroupId = mint('g');
      const newTabId = mint('t');
      const layout = splitLeaf(s.layout, s.activeGroupId, dir, newGroupId, mint('s'));
      return {
        layout,
        groups: {
          ...s.groups,
          [newGroupId]: { id: newGroupId, tabs: [{ id: newTabId }], activeTabId: newTabId },
        },
        activeGroupId: newGroupId,
        zoomedGroupId: null,
      };
    }),

  splitGroupWithTab: (targetGroupId, side, tabId, fromGroupId) =>
    set((s) => {
      const from = s.groups[fromGroupId];
      const tab = from?.tabs.find((t) => t.id === tabId);
      if (!from || !tab) return { drag: null };
      // Moving a group's ONLY tab beside itself would split then re-collapse → no-op.
      if (fromGroupId === targetGroupId && from.tabs.length <= 1) return { drag: null };
      const newGroupId = mint('g');
      let layout = insertBeside(s.layout, targetGroupId, side, newGroupId, mint('s'));
      const groups: Record<string, TermGroup> = {
        ...s.groups,
        [newGroupId]: { id: newGroupId, tabs: [tab], activeTabId: tab.id },
      };
      const fromRemaining = from.tabs.filter((t) => t.id !== tabId);
      if (fromRemaining.length === 0) {
        const { root } = closeLeaf(layout, fromGroupId);
        layout = root ?? layout;
        delete groups[fromGroupId];
      } else {
        groups[fromGroupId] = {
          ...from,
          tabs: fromRemaining,
          activeTabId:
            from.activeTabId === tabId
              ? (fromRemaining[0]?.id ?? from.activeTabId)
              : from.activeTabId,
        };
      }
      return { layout, groups, activeGroupId: newGroupId, zoomedGroupId: null, drag: null };
    }),

  moveTab: (tabId, fromGroupId, toGroupId, toIndex) =>
    set((s) => {
      const from = s.groups[fromGroupId];
      const tab = from?.tabs.find((t) => t.id === tabId);
      if (!from || !tab) return { drag: null };
      if (fromGroupId === toGroupId) {
        const others = from.tabs.filter((t) => t.id !== tabId);
        others.splice(Math.min(Math.max(0, toIndex), others.length), 0, tab);
        return {
          groups: { ...s.groups, [fromGroupId]: { ...from, tabs: others, activeTabId: tabId } },
          activeGroupId: fromGroupId,
          drag: null,
        };
      }
      const to = s.groups[toGroupId];
      if (!to) return { drag: null };
      const toTabs = [...to.tabs];
      toTabs.splice(Math.min(Math.max(0, toIndex), toTabs.length), 0, tab);
      const groups: Record<string, TermGroup> = {
        ...s.groups,
        [toGroupId]: { ...to, tabs: toTabs, activeTabId: tabId },
      };
      let layout = s.layout;
      const fromRemaining = from.tabs.filter((t) => t.id !== tabId);
      if (fromRemaining.length === 0) {
        const { root } = closeLeaf(s.layout, fromGroupId);
        layout = root ?? s.layout;
        delete groups[fromGroupId];
      } else {
        groups[fromGroupId] = {
          ...from,
          tabs: fromRemaining,
          activeTabId:
            from.activeTabId === tabId
              ? (fromRemaining[0]?.id ?? from.activeTabId)
              : from.activeTabId,
        };
      }
      return { layout, groups, activeGroupId: toGroupId, zoomedGroupId: null, drag: null };
    }),

  gotoGroupDir: (dir) =>
    set((s) => {
      const next = directionalNeighbor(s.layout, s.activeGroupId, dir);
      if (!next) return s;
      const g = s.groups[next];
      return {
        activeGroupId: next,
        zoomedGroupId: null,
        activity: g ? clearActivity(s.activity, g.activeTabId) : s.activity,
      };
    }),

  gotoGroupRing: (delta) =>
    set((s) => {
      const next = ringNeighbor(s.layout, s.activeGroupId, delta);
      const g = s.groups[next];
      return {
        activeGroupId: next,
        zoomedGroupId: null,
        activity: g ? clearActivity(s.activity, g.activeTabId) : s.activity,
      };
    }),

  resizeFocusedGroup: (dir) =>
    set((s) => {
      const target = resizeTarget(s.layout, s.activeGroupId, dir);
      if (!target) return s;
      const split = findSplit(s.layout, target.splitId);
      if (!split) return s;
      const bounds = splitBounds(s.layout, target.splitId);
      const axis = Math.max(0.05, split.dir === 'row' ? (bounds?.w ?? 1) : (bounds?.h ?? 1));
      const delta = ((dir === 'right' || dir === 'down' ? 1 : -1) * AREA_RESIZE_STEP) / axis;
      return {
        layout: setFractionTree(s.layout, target.splitId, split.fraction + delta),
        zoomedGroupId: null,
        resizeTick: s.resizeTick + 1,
      };
    }),

  equalizeGroups: () => set((s) => (s.layout.type === 'leaf' ? s : { layout: equalize(s.layout) })),

  toggleZoom: () =>
    set((s) => {
      if (s.layout.type === 'leaf') return { zoomedGroupId: null };
      return { zoomedGroupId: s.zoomedGroupId ? null : s.activeGroupId };
    }),

  setSplitFraction: (splitId, fraction) =>
    set((s) => ({
      layout: setFractionTree(s.layout, splitId, fraction),
      resizeTick: s.resizeTick + 1,
    })),

  closeTab: (groupId, tabId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const tabIndex = g.tabs.findIndex((t) => t.id === tabId);
      const tab = g.tabs[tabIndex];
      if (!tab) return s;
      const entry: ClosingTab = {
        key: mint('close'),
        tab,
        groupId,
        tabIndex,
        layoutSnapshot: s.layout,
      };
      const closing = [...s.closing, entry];
      const activity = clearActivity(s.activity, tabId);
      const remaining = g.tabs.filter((t) => t.id !== tabId);

      if (remaining.length > 0) {
        const activeTabId =
          g.activeTabId === tabId
            ? ((remaining[Math.max(0, tabIndex - 1)] ?? remaining[0])?.id ?? g.activeTabId)
            : g.activeTabId;
        return {
          groups: { ...s.groups, [groupId]: { ...g, tabs: remaining, activeTabId } },
          activity,
          closing,
        };
      }

      // Last tab → collapse the group.
      if (Object.keys(s.groups).length <= 1) {
        const fg = freshGroup();
        return {
          layout: leaf(fg.id),
          groups: { [fg.id]: fg },
          activeGroupId: fg.id,
          zoomedGroupId: null,
          activity,
          closing,
        };
      }
      const { root, focusId } = closeLeaf(s.layout, groupId);
      const nextLayout = root ?? s.layout;
      const { [groupId]: _gone, ...rest } = s.groups;
      const nextActive = focusId ?? firstLeaf(nextLayout).id;
      return {
        layout: nextLayout,
        groups: rest,
        activeGroupId: nextActive,
        zoomedGroupId: s.zoomedGroupId === groupId ? null : s.zoomedGroupId,
        activity,
        closing,
      };
    }),

  closeActiveTab: () => {
    const s = useTerminalStore.getState();
    const g = s.groups[s.activeGroupId];
    if (g) s.closeTab(g.id, g.activeTabId);
  },

  closeOtherTabs: (groupId, tabId) =>
    set((s) => {
      const g = s.groups[groupId];
      const keep = g?.tabs.find((t) => t.id === tabId);
      if (!g || !keep || g.tabs.length <= 1) return s;
      const removed = g.tabs.map((tab, i) => ({ tab, i })).filter(({ tab }) => tab.id !== tabId);
      return {
        groups: { ...s.groups, [groupId]: { ...g, tabs: [keep], activeTabId: tabId } },
        activeGroupId: groupId,
        zoomedGroupId: null,
        activity: removed.reduce((a, { tab }) => clearActivity(a, tab.id), s.activity),
        closing: [
          ...s.closing,
          ...removed.map(({ tab, i }) => ({
            key: mint('close'),
            tab,
            groupId,
            tabIndex: i,
            layoutSnapshot: s.layout,
          })),
        ],
      };
    }),

  closeTabsToRight: (groupId, tabId) =>
    set((s) => {
      const g = s.groups[groupId];
      if (!g) return s;
      const idx = g.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0 || idx >= g.tabs.length - 1) return s;
      const kept = g.tabs.slice(0, idx + 1);
      const removed = g.tabs.slice(idx + 1).map((tab, k) => ({ tab, i: idx + 1 + k }));
      const activeTabId = kept.some((t) => t.id === g.activeTabId) ? g.activeTabId : tabId;
      return {
        groups: { ...s.groups, [groupId]: { ...g, tabs: kept, activeTabId } },
        zoomedGroupId: null,
        activity: removed.reduce((a, { tab }) => clearActivity(a, tab.id), s.activity),
        closing: [
          ...s.closing,
          ...removed.map(({ tab, i }) => ({
            key: mint('close'),
            tab,
            groupId,
            tabIndex: i,
            layoutSnapshot: s.layout,
          })),
        ],
      };
    }),

  undoClose: (key) =>
    set((s) => {
      const entry = s.closing.find((c) => c.key === key);
      if (!entry) return s;
      const closing = s.closing.filter((c) => c.key !== key);
      const existing = s.groups[entry.groupId];
      if (existing && findLeaf(s.layout, entry.groupId)) {
        // Group still present → splice the tab back in.
        const tabs = [...existing.tabs];
        tabs.splice(Math.min(Math.max(0, entry.tabIndex), tabs.length), 0, entry.tab);
        return {
          groups: {
            ...s.groups,
            [entry.groupId]: { ...existing, tabs, activeTabId: entry.tab.id },
          },
          activeGroupId: entry.groupId,
          zoomedGroupId: null,
          closing,
        };
      }
      // Group collapsed → re-insert its leaf into the CURRENT layout (never
      // overwrite the whole layout with the stale snapshot — that would discard
      // any splits made during the grace window and orphan their groups). Place
      // it where it used to be when that sibling still exists, else beside the
      // first group.
      return {
        layout: reinsertGroupLeaf(s.layout, entry.layoutSnapshot, entry.groupId),
        groups: {
          ...s.groups,
          [entry.groupId]: { id: entry.groupId, tabs: [entry.tab], activeTabId: entry.tab.id },
        },
        activeGroupId: entry.groupId,
        zoomedGroupId: null,
        closing,
      };
    }),

  finalizeClose: (key) =>
    set((s) =>
      s.closing.some((c) => c.key === key)
        ? { closing: s.closing.filter((c) => c.key !== key) }
        : s,
    ),

  setFocused: (focused) => set({ focused }),

  setTitle: (tabId, title) =>
    set((s) => {
      const next = title.trim();
      if (!next || s.titles[tabId] === next) return s;
      return { titles: { ...s.titles, [tabId]: next } };
    }),

  setDims: (tabId, cols, rows) =>
    set((s) => {
      const cur = s.dims[tabId];
      if (cur && cur.cols === cols && cur.rows === rows) return s;
      return { dims: { ...s.dims, [tabId]: { cols, rows } } };
    }),

  markActivity: (tabId) =>
    set((s) => {
      let owner: TermGroup | undefined;
      for (const g of Object.values(s.groups)) {
        if (g.tabs.some((t) => t.id === tabId)) {
          owner = g;
          break;
        }
      }
      if (!owner) return s; // a closing tab, or unknown → ignore
      const visible = owner.id === s.activeGroupId && owner.activeTabId === tabId;
      if (visible || s.activity[tabId]) return s;
      return { activity: { ...s.activity, [tabId]: true } };
    }),

  setDrag: (drag) => set({ drag }),
}));

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

/** Re-insert a collapsed group's leaf into the CURRENT layout, restoring its old
 *  spot when a former sibling still exists (else beside the first group). Never
 *  replaces the whole layout, so concurrent splits during the undo grace survive. */
function reinsertGroupLeaf(current: TermNode, snapshot: TermNode, groupId: string): TermNode {
  const splitId = mint('s');
  const loc = locateLeaf(snapshot, groupId);
  if (loc) {
    const wasA = loc.side === 'a';
    const side: FocusDir =
      loc.split.dir === 'row' ? (wasA ? 'left' : 'right') : wasA ? 'up' : 'down';
    const sibling = wasA ? loc.split.b : loc.split.a;
    const anchor = orderedLeafIds(sibling).find((id) => findLeaf(current, id));
    if (anchor) return insertBeside(current, anchor, side, groupId, splitId);
  }
  // Snapshot had it as the whole tree, or no former sibling survives → append.
  return insertBeside(current, firstLeaf(current).id, 'right', groupId, splitId);
}
