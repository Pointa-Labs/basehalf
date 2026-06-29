import {
  type FocusDir,
  type TermNode,
  findLeaf,
  firstLeaf,
  insertBeside,
  leaf,
  orderedLeafIds,
} from './terminalTree.js';

/** One tab: a name override plus its own pane split-tree (one pty per leaf). */
export interface TermTab {
  id: string;
  /** Split tree of panes; every leaf id is a pane(=pty) id. */
  tree: TermNode;
  /** The focused pane within this tab. */
  activePaneId: string;
  /** When set, this pane fills the tab area; the tree is preserved. */
  zoomedPaneId: string | null;
  /** User-set tab name. Empty/undefined means the live process title wins. */
  titleOverride?: string;
}

/** A soft-closed tab kept mounted briefly so its panes can be restored intact. */
export interface ClosingTab {
  key: string;
  kind: 'tab';
  tab: TermTab;
  index: number;
}

/** A soft-closed pane inside a surviving tab. */
export interface ClosingPane {
  key: string;
  kind: 'pane';
  tabId: string;
  paneId: string;
  /** Tree before close, used to restore the old relative position on undo. */
  treeSnapshot: TermNode;
}

export type ClosingEntry = ClosingTab | ClosingPane;

export interface TerminalModelState {
  tabs: TermTab[];
  activeTabId: string;
  titles: Record<string, string>;
  dims: Record<string, { cols: number; rows: number }>;
  resizeTick: number;
  activity: Record<string, boolean>;
  closing: ClosingEntry[];
  drag: { tabId: string } | null;
  paneDrag: { paneId: string } | null;
}

let seq = 0;

export const mintTerminalId = (prefix: string): string => `${prefix}${++seq}`;

export const freshTab = (): TermTab => {
  const id = mintTerminalId('tab');
  const paneId = mintTerminalId('p');
  return { id, tree: leaf(paneId), activePaneId: paneId, zoomedPaneId: null };
};

export const activeTab = (state: TerminalModelState): TermTab | undefined =>
  state.tabs.find((tab) => tab.id === state.activeTabId);

export const replaceTab = (tabs: TermTab[], tabId: string, next: TermTab): TermTab[] =>
  tabs.map((tab) => (tab.id === tabId ? next : tab));

export function updateActiveTab(
  state: TerminalModelState,
  fn: (tab: TermTab) => TermTab,
): Partial<TerminalModelState> {
  const tab = activeTab(state);
  if (!tab) return state;
  const next = fn(tab);
  return next === tab ? state : { tabs: replaceTab(state.tabs, tab.id, next) };
}

/** Drop a tab's activity flag after the output has become visible. */
export function clearActivity(
  activity: Record<string, boolean>,
  tabId: string,
): Record<string, boolean> {
  if (!activity[tabId]) return activity;
  const { [tabId]: _drop, ...rest } = activity;
  return rest;
}

export function paneIdsForClosingEntry(entry: ClosingEntry): string[] {
  return entry.kind === 'tab' ? orderedLeafIds(entry.tab.tree) : [entry.paneId];
}

export function prunePaneRecord<T>(
  record: Record<string, T>,
  paneIds: readonly string[],
): Record<string, T> {
  let next = record;
  for (const paneId of paneIds) {
    if (!Object.prototype.hasOwnProperty.call(next, paneId)) continue;
    if (next === record) next = { ...record };
    delete next[paneId];
  }
  return next;
}

export function findSplit(root: TermNode, id: string): Extract<TermNode, { type: 'split' }> | null {
  if (root.type === 'leaf') return null;
  if (root.id === id) return root;
  return findSplit(root.a, id) ?? findSplit(root.b, id);
}

/** Reinsert a soft-closed pane into the current tree without clobbering new splits. */
export function reinsertPaneLeaf(current: TermNode, snapshot: TermNode, paneId: string): TermNode {
  const splitId = mintTerminalId('s');
  const loc = locateLeaf(snapshot, paneId);
  if (loc) {
    const wasA = loc.side === 'a';
    const side: FocusDir =
      loc.split.dir === 'row' ? (wasA ? 'left' : 'right') : wasA ? 'up' : 'down';
    const sibling = wasA ? loc.split.b : loc.split.a;
    const anchor = orderedLeafIds(sibling).find((id) => findLeaf(current, id));
    if (anchor) return insertBeside(current, anchor, side, paneId, splitId);
  }
  return insertBeside(current, firstLeaf(current).id, 'right', paneId, splitId);
}

function locateLeaf(
  root: TermNode,
  leafId: string,
): { split: Extract<TermNode, { type: 'split' }>; side: 'a' | 'b' } | null {
  if (root.type === 'leaf') return null;
  if (root.a.type === 'leaf' && root.a.id === leafId) return { split: root, side: 'a' };
  if (root.b.type === 'leaf' && root.b.id === leafId) return { split: root, side: 'b' };
  return locateLeaf(root.a, leafId) ?? locateLeaf(root.b, leafId);
}
