import { create } from 'zustand';
import {
  type TerminalModelState,
  closeOtherTabsState,
  closePaneState,
  closeTabState,
  closeTabsToRightState,
  equalizePanesState,
  finalizeCloseState,
  focusPaneState,
  freshTab,
  gotoPaneDirState,
  gotoPaneRingState,
  gotoTabState,
  lastTabState,
  markActivityState,
  movePaneState,
  newTabState,
  reorderTabState,
  resizePaneState,
  selectTabState,
  setDimsState,
  setSplitFractionState,
  setTabTitleState,
  setTitleState,
  splitPaneState,
  switchTabState,
  toggleZoomState,
  undoCloseState,
} from './terminalGroupModel.js';
import type { FocusDir, SplitDir } from './terminalTree.js';

export type { ClosingEntry, TermTab } from './terminalGroupModel.js';

// Terminal dock state, modeled on VS Code's terminal group split: the store is a
// renderer adapter around terminalGroupModel. It owns focus/plumbing flags and
// exposes actions for React, while tab/pane mutations stay in the model layer.
//
// NOT persisted across reload: the ptys live in main and don't survive a renderer
// reload, so restoring a stale layout would point at dead sessions. Each load
// starts fresh with one tab holding one pane. (The dock WIDTH is persisted
// separately in the layout store.)

interface TerminalState extends TerminalModelState {
  /** Whether keyboard focus is inside the terminal dock — gates the dock keymap
   * and arbitrates ⌘W against the editor overlay. */
  focused: boolean;

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
   * the active tab); the dragged pane keeps its pty (same id → no remount). */
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

  newTab: () => set((s) => newTabState(s)),
  selectTab: (tabId) => set((s) => selectTabState(s, tabId)),
  switchTab: (delta) => set((s) => switchTabState(s, delta)),
  gotoTab: (index) => set((s) => gotoTabState(s, index)),
  lastTab: () => set((s) => lastTabState(s)),
  setTabTitle: (tabId, title) => set((s) => setTabTitleState(s, tabId, title)),
  reorderTab: (tabId, toIndex) => set((s) => reorderTabState(s, tabId, toIndex)),

  splitPane: (dir) => set((s) => splitPaneState(s, dir)),
  focusPane: (tabId, paneId) => set((s) => focusPaneState(s, tabId, paneId)),
  gotoPaneDir: (dir) => set((s) => gotoPaneDirState(s, dir)),
  gotoPaneRing: (delta) => set((s) => gotoPaneRingState(s, delta)),
  movePane: (paneId, side, destPaneId) => set((s) => movePaneState(s, paneId, side, destPaneId)),
  resizePane: (dir) => set((s) => resizePaneState(s, dir)),
  equalizePanes: () => set((s) => equalizePanesState(s)),
  toggleZoom: () => set((s) => toggleZoomState(s)),
  setSplitFraction: (splitId, fraction) => set((s) => setSplitFractionState(s, splitId, fraction)),

  closePane: (paneId) => set((s) => closePaneState(s, paneId)),
  closeActivePane: () => set((s) => closePaneState(s)),
  closeTab: (tabId) => set((s) => closeTabState(s, tabId)),
  closeOtherTabs: (tabId) => set((s) => closeOtherTabsState(s, tabId)),
  closeTabsToRight: (tabId) => set((s) => closeTabsToRightState(s, tabId)),
  undoClose: (key) => set((s) => undoCloseState(s, key)),
  finalizeClose: (key) => set((s) => finalizeCloseState(s, key)),

  setFocused: (focused) => set({ focused }),
  setTitle: (paneId, title) => set((s) => setTitleState(s, paneId, title)),
  setDims: (paneId, cols, rows) => set((s) => setDimsState(s, paneId, cols, rows)),
  markActivity: (paneId) => set((s) => markActivityState(s, paneId)),
  setDrag: (drag) => set({ drag }),
  setPaneDrag: (paneDrag) => set({ paneDrag }),
}));
