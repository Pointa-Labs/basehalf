import {
  type ClosingPane,
  type ClosingTab,
  type TermTab,
  type TerminalModelState,
  activeTab,
  clearActivity,
  findSplit,
  freshTab,
  mintTerminalId,
  paneIdsForClosingEntry,
  prunePaneRecord,
  reinsertPaneLeaf,
  replaceTab,
  updateActiveTab,
} from './terminalGroupState.js';
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
} from './terminalTree.js';

export {
  type ClosingEntry,
  type ClosingPane,
  type ClosingTab,
  type TerminalModelState,
  type TermTab,
  freshTab,
} from './terminalGroupState.js';

/**
 * Terminal group/tab domain model.
 *
 * VS Code separates TerminalGroup/TerminalGroupService from view code and
 * command registration. This file is our pure model equivalent: tab and pane
 * mutations live here, while the Zustand store stays a renderer adapter.
 */

const mint = mintTerminalId;

// Fraction of the WHOLE tab area a divider moves per ⌘⌃arrow press, scaled by the
// split's own size so nested and root splits move by the same visual amount.
const AREA_RESIZE_STEP = 0.04;

export function newTabState(s: TerminalModelState): Partial<TerminalModelState> {
  const tab = freshTab();
  const at = s.tabs.findIndex((t) => t.id === s.activeTabId);
  const tabs = [...s.tabs];
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
  return { tabs, activeTabId: tab.id };
}

export function selectTabState(s: TerminalModelState, tabId: string): Partial<TerminalModelState> {
  return s.tabs.some((t) => t.id === tabId)
    ? { activeTabId: tabId, activity: clearActivity(s.activity, tabId) }
    : s;
}

export function switchTabState(s: TerminalModelState, delta: 1 | -1): Partial<TerminalModelState> {
  if (s.tabs.length <= 1) return s;
  const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
  const next = s.tabs[(i + delta + s.tabs.length) % s.tabs.length];
  if (!next) return s;
  return { activeTabId: next.id, activity: clearActivity(s.activity, next.id) };
}

export function gotoTabState(s: TerminalModelState, index: number): Partial<TerminalModelState> {
  const i = Math.min(Math.max(1, Math.floor(index)), s.tabs.length) - 1;
  const next = s.tabs[i];
  if (!next) return s;
  return { activeTabId: next.id, activity: clearActivity(s.activity, next.id) };
}

export function lastTabState(s: TerminalModelState): Partial<TerminalModelState> {
  const next = s.tabs[s.tabs.length - 1];
  if (!next) return s;
  return { activeTabId: next.id, activity: clearActivity(s.activity, next.id) };
}

export function setTabTitleState(
  s: TerminalModelState,
  tabId: string,
  title: string,
): Partial<TerminalModelState> {
  const override = title.trim();
  return {
    tabs: s.tabs.map((t) => {
      if (t.id !== tabId) return t;
      if (override === '') {
        const { titleOverride: _titleOverride, ...rest } = t;
        return rest;
      }
      return { ...t, titleOverride: override };
    }),
  };
}

export function reorderTabState(
  s: TerminalModelState,
  tabId: string,
  toIndex: number,
): Partial<TerminalModelState> {
  const from = s.tabs.findIndex((t) => t.id === tabId);
  if (from < 0) return s;
  const tabs = [...s.tabs];
  const [moved] = tabs.splice(from, 1);
  if (!moved) return s;
  const adjusted = from < toIndex ? toIndex - 1 : toIndex;
  tabs.splice(Math.min(Math.max(0, adjusted), tabs.length), 0, moved);
  return { tabs, drag: null };
}

export function splitPaneState(s: TerminalModelState, dir: SplitDir): Partial<TerminalModelState> {
  return updateActiveTab(s, (tab) => {
    const paneId = mint('p');
    return {
      ...tab,
      tree: splitLeaf(tab.tree, tab.activePaneId, dir, paneId, mint('s')),
      activePaneId: paneId,
      zoomedPaneId: null,
    };
  });
}

export function focusPaneState(
  s: TerminalModelState,
  tabId: string,
  paneId: string,
): Partial<TerminalModelState> {
  const tab = s.tabs.find((t) => t.id === tabId);
  if (!tab || !findLeaf(tab.tree, paneId)) return s;
  return {
    activeTabId: tabId,
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)),
    activity: clearActivity(s.activity, tabId),
  };
}

export function gotoPaneDirState(
  s: TerminalModelState,
  dir: FocusDir,
): Partial<TerminalModelState> {
  return updateActiveTab(s, (tab) => {
    const next = directionalNeighbor(tab.tree, tab.activePaneId, dir);
    return next ? { ...tab, activePaneId: next, zoomedPaneId: null } : tab;
  });
}

export function gotoPaneRingState(
  s: TerminalModelState,
  delta: 1 | -1,
): Partial<TerminalModelState> {
  return updateActiveTab(s, (tab) => ({
    ...tab,
    activePaneId: ringNeighbor(tab.tree, tab.activePaneId, delta),
    zoomedPaneId: null,
  }));
}

export function movePaneState(
  s: TerminalModelState,
  paneId: string,
  side: FocusDir,
  destPaneId: string,
): Partial<TerminalModelState> {
  if (paneId === destPaneId) return { paneDrag: null };
  const tab = activeTab(s);
  if (!tab || !findLeaf(tab.tree, paneId) || !findLeaf(tab.tree, destPaneId)) {
    return { paneDrag: null };
  }
  const { root } = closeLeaf(tab.tree, paneId);
  if (!root) return { paneDrag: null };
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
}

export function resizePaneState(s: TerminalModelState, dir: FocusDir): Partial<TerminalModelState> {
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
}

export function equalizePanesState(s: TerminalModelState): Partial<TerminalModelState> {
  const tab = activeTab(s);
  if (!tab || tab.tree.type === 'leaf') return s;
  return {
    // Rebalancing reveals the whole layout, so unzoom (matches resizePane).
    tabs: replaceTab(s.tabs, tab.id, { ...tab, tree: equalize(tab.tree), zoomedPaneId: null }),
    resizeTick: s.resizeTick + 1,
  };
}

export function toggleZoomState(s: TerminalModelState): Partial<TerminalModelState> {
  return updateActiveTab(s, (tab) =>
    tab.tree.type === 'leaf'
      ? { ...tab, zoomedPaneId: null }
      : { ...tab, zoomedPaneId: tab.zoomedPaneId ? null : tab.activePaneId },
  );
}

export function setSplitFractionState(
  s: TerminalModelState,
  splitId: string,
  fraction: number,
): Partial<TerminalModelState> {
  const tab = activeTab(s);
  if (!tab) return s;
  return {
    tabs: replaceTab(s.tabs, tab.id, {
      ...tab,
      tree: setFractionTree(tab.tree, splitId, fraction),
    }),
    resizeTick: s.resizeTick + 1,
  };
}

export function closePaneState(
  s: TerminalModelState,
  paneId?: string,
): Partial<TerminalModelState> {
  const tab = activeTab(s);
  if (!tab) return s;
  const pid = paneId ?? tab.activePaneId;
  if (!findLeaf(tab.tree, pid)) return s;
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
}

export function closeTabState(s: TerminalModelState, tabId: string): Partial<TerminalModelState> {
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

export function closeOtherTabsState(
  s: TerminalModelState,
  tabId: string,
): Partial<TerminalModelState> {
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
}

export function closeTabsToRightState(
  s: TerminalModelState,
  tabId: string,
): Partial<TerminalModelState> {
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
}

export function undoCloseState(s: TerminalModelState, key: string): Partial<TerminalModelState> {
  const entry = s.closing.find((c) => c.key === key);
  if (!entry) return s;
  const closing = s.closing.filter((c) => c.key !== key);

  if (entry.kind === 'tab') {
    const tabs = [...s.tabs];
    tabs.splice(Math.min(Math.max(0, entry.index), tabs.length), 0, entry.tab);
    return { tabs, activeTabId: entry.tab.id, closing };
  }

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
}

export function finalizeCloseState(
  s: TerminalModelState,
  key: string,
): Partial<TerminalModelState> {
  const entry = s.closing.find((c) => c.key === key);
  if (!entry) return s;
  const paneIds = paneIdsForClosingEntry(entry);
  return {
    closing: s.closing.filter((c) => c.key !== key),
    titles: prunePaneRecord(s.titles, paneIds),
    dims: prunePaneRecord(s.dims, paneIds),
    activity: entry.kind === 'tab' ? clearActivity(s.activity, entry.tab.id) : s.activity,
    drag: entry.kind === 'tab' && s.drag?.tabId === entry.tab.id ? null : s.drag,
    paneDrag: s.paneDrag && paneIds.includes(s.paneDrag.paneId) ? null : s.paneDrag,
  };
}

export function setTitleState(
  s: TerminalModelState,
  paneId: string,
  title: string,
): Partial<TerminalModelState> {
  const next = title.trim();
  if (!next || s.titles[paneId] === next) return s;
  return { titles: { ...s.titles, [paneId]: next } };
}

export function setDimsState(
  s: TerminalModelState,
  paneId: string,
  cols: number,
  rows: number,
): Partial<TerminalModelState> {
  const cur = s.dims[paneId];
  if (cur && cur.cols === cols && cur.rows === rows) return s;
  return { dims: { ...s.dims, [paneId]: { cols, rows } } };
}

export function markActivityState(
  s: TerminalModelState,
  paneId: string,
): Partial<TerminalModelState> {
  const owner = s.tabs.find((t) => findLeaf(t.tree, paneId));
  if (!owner) return s;
  if (owner.id === s.activeTabId || s.activity[owner.id]) return s;
  return { activity: { ...s.activity, [owner.id]: true } };
}
