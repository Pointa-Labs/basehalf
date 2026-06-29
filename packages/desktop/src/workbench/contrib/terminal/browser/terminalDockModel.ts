import type { TermTab } from '../common/terminalGroupModel.js';
import {
  type Divider,
  type Rect,
  leafRects,
  orderedLeafIds,
  splitDividers,
} from '../common/terminalTree.js';

export type TerminalClosingEntryLike =
  | { readonly kind: 'tab'; readonly tab: TermTab }
  | { readonly kind: 'pane'; readonly paneId: string };

export interface TerminalPaneMount {
  readonly paneId: string;
  readonly tab: TermTab | null;
}

export interface TerminalActiveLayout {
  readonly activeRects: ReadonlyMap<string, Rect>;
  readonly zoomedPaneId: string | null;
  readonly dividers: readonly Divider[];
  readonly dimUnfocused: boolean;
}

export function terminalPaneMounts(
  tabs: readonly TermTab[],
  closing: readonly TerminalClosingEntryLike[],
): readonly TerminalPaneMount[] {
  const mounts: TerminalPaneMount[] = [];
  for (const tab of tabs) {
    for (const paneId of orderedLeafIds(tab.tree)) mounts.push({ paneId, tab });
  }
  for (const entry of closing) {
    if (entry.kind === 'tab') {
      for (const paneId of orderedLeafIds(entry.tab.tree)) mounts.push({ paneId, tab: entry.tab });
    } else {
      mounts.push({ paneId: entry.paneId, tab: null });
    }
  }
  return mounts;
}

export function terminalActiveLayout(activeTab: TermTab | null | undefined): TerminalActiveLayout {
  const activeRects = activeTab ? leafRects(activeTab.tree) : new Map<string, Rect>();
  const zoomedPaneId = activeTab?.zoomedPaneId ?? null;
  const dividers = activeTab && !zoomedPaneId ? splitDividers(activeTab.tree) : [];
  const dimUnfocused = activeTab?.tree.type === 'split' && zoomedPaneId === null;
  return { activeRects, zoomedPaneId, dividers, dimUnfocused };
}
