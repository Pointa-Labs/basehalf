import { describe, expect, it } from 'vitest';
import {
  type TerminalModelState,
  closePaneState,
  finalizeCloseState,
  setDimsState,
  setTitleState,
  splitPaneState,
  undoCloseState,
} from '../src/workbench/contrib/terminal/common/terminalGroupModel.js';
import {
  findLeaf,
  leaf,
  orderedLeafIds,
} from '../src/workbench/contrib/terminal/common/terminalTree.js';

const initialState = (): TerminalModelState => ({
  tabs: [{ id: 'tab0', tree: leaf('p0'), activePaneId: 'p0', zoomedPaneId: null }],
  activeTabId: 'tab0',
  titles: {},
  dims: {},
  resizeTick: 0,
  activity: {},
  closing: [],
  drag: null,
  paneDrag: null,
});

const apply = (
  state: TerminalModelState,
  patch: Partial<TerminalModelState>,
): TerminalModelState => ({
  ...state,
  ...patch,
});

const activeTab = (state: TerminalModelState) =>
  state.tabs.find((tab) => tab.id === state.activeTabId);

describe('terminal group model', () => {
  it('splits, soft-closes, and restores a pane without clobbering concurrent splits', () => {
    let state = initialState();

    state = apply(state, splitPaneState(state, 'right'));
    const p1 = activeTab(state)?.activePaneId as string;
    state = apply(state, splitPaneState(state, 'down'));
    const p2 = activeTab(state)?.activePaneId as string;
    state = apply(state, closePaneState(state, 'p0'));
    const key = state.closing[0]?.key as string;
    state = apply(state, splitPaneState(state, 'right'));
    const p3 = activeTab(state)?.activePaneId as string;

    state = apply(state, undoCloseState(state, key));

    const tree = activeTab(state)?.tree ?? leaf('missing');
    expect(orderedLeafIds(tree)).toHaveLength(4);
    for (const id of ['p0', p1, p2, p3]) expect(findLeaf(tree, id)).not.toBeNull();
  });

  it('finalizes a closed tab by pruning pane title and dimension records', () => {
    let state = initialState();
    state = apply(state, setTitleState(state, 'p0', 'shell'));
    state = apply(state, setDimsState(state, 'p0', 80, 24));
    state = apply(state, closePaneState(state));
    const key = state.closing[0]?.key as string;

    state = apply(state, finalizeCloseState(state, key));

    expect(state.titles.p0).toBeUndefined();
    expect(state.dims.p0).toBeUndefined();
    expect(state.closing).toEqual([]);
  });
});
