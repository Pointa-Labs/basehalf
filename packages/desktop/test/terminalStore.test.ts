import { beforeEach, describe, expect, it } from 'vitest';
import { leaf } from '../src/renderer/src/lib/terminalTree.js';
import { useTerminalStore } from '../src/renderer/src/store/terminal.js';

// Reset the singleton store to one group ("g0") with one tab ("t0") before each
// test. Actions mint fresh ids internally, so post-reset ids never collide.
const reset = (): void => {
  useTerminalStore.setState({
    layout: leaf('g0'),
    groups: { g0: { id: 'g0', tabs: [{ id: 't0' }], activeTabId: 't0' } },
    activeGroupId: 'g0',
    zoomedGroupId: null,
    titles: {},
    dims: {},
    resizeTick: 0,
    activity: {},
    closing: [],
    drag: null,
    focused: false,
  });
};

describe('terminal store — editor groups', () => {
  beforeEach(reset);

  it('splitGroupWithNewTab makes a second group with a fresh single tab', () => {
    useTerminalStore.getState().splitGroupWithNewTab('right');
    const s = useTerminalStore.getState();
    expect(Object.keys(s.groups)).toHaveLength(2);
    expect(s.layout.type).toBe('split');
    expect(s.activeGroupId).not.toBe('g0');
    expect(s.groups[s.activeGroupId]?.tabs).toHaveLength(1);
  });

  it('splitGroupWithTab moves a tab into a new group beside the target', () => {
    useTerminalStore.setState({
      groups: { g0: { id: 'g0', tabs: [{ id: 't0' }, { id: 't1' }], activeTabId: 't1' } },
    });
    useTerminalStore.getState().splitGroupWithTab('g0', 'right', 't1', 'g0');
    const s = useTerminalStore.getState();
    expect(Object.keys(s.groups)).toHaveLength(2);
    expect(s.groups.g0?.tabs.map((t) => t.id)).toEqual(['t0']);
    const moved = Object.values(s.groups).find((g) => g.id !== 'g0');
    expect(moved?.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(s.activeGroupId).toBe(moved?.id);
  });

  it('splitGroupWithTab on a single-tab group is a no-op (would split then collapse)', () => {
    useTerminalStore.getState().splitGroupWithTab('g0', 'right', 't0', 'g0');
    expect(Object.keys(useTerminalStore.getState().groups)).toEqual(['g0']);
  });

  it('moveTab across groups collapses an emptied source group', () => {
    useTerminalStore.setState({
      layout: { type: 'split', id: 's1', dir: 'row', a: leaf('g0'), b: leaf('gB'), fraction: 0.5 },
      groups: {
        g0: { id: 'g0', tabs: [{ id: 't0' }], activeTabId: 't0' },
        gB: { id: 'gB', tabs: [{ id: 't1' }], activeTabId: 't1' },
      },
      activeGroupId: 'gB',
    });
    useTerminalStore.getState().moveTab('t1', 'gB', 'g0', 1);
    const s = useTerminalStore.getState();
    expect(Object.keys(s.groups)).toEqual(['g0']); // gB collapsed
    expect(s.layout).toEqual(leaf('g0'));
    expect(s.groups.g0?.tabs.map((t) => t.id)).toEqual(['t0', 't1']);
    expect(s.activeGroupId).toBe('g0');
  });

  it('moveTab within a group reorders', () => {
    useTerminalStore.setState({
      groups: {
        g0: { id: 'g0', tabs: [{ id: 't0' }, { id: 't1' }, { id: 't2' }], activeTabId: 't0' },
      },
    });
    useTerminalStore.getState().moveTab('t2', 'g0', 'g0', 0);
    expect(useTerminalStore.getState().groups.g0?.tabs.map((t) => t.id)).toEqual([
      't2',
      't0',
      't1',
    ]);
  });

  it('closeTab collapses a group on its last tab; undo restores the group intact', () => {
    useTerminalStore.setState({
      layout: { type: 'split', id: 's1', dir: 'row', a: leaf('g0'), b: leaf('gB'), fraction: 0.5 },
      groups: {
        g0: { id: 'g0', tabs: [{ id: 't0' }], activeTabId: 't0' },
        gB: { id: 'gB', tabs: [{ id: 't1' }], activeTabId: 't1' },
      },
      activeGroupId: 'gB',
    });
    useTerminalStore.getState().closeTab('gB', 't1');
    let s = useTerminalStore.getState();
    expect(Object.keys(s.groups)).toEqual(['g0']); // collapsed
    expect(s.closing).toHaveLength(1); // soft-closed → pty kept alive
    const key = s.closing[0]?.key;
    expect(key).toBeDefined();
    if (!key) return;
    useTerminalStore.getState().undoClose(key);
    s = useTerminalStore.getState();
    expect(s.closing).toHaveLength(0);
    expect(s.groups.gB?.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(s.activeGroupId).toBe('gB');
  });

  it('closeTab on the lone group keeps the dock non-empty + keeps the old undoable', () => {
    useTerminalStore.getState().closeTab('g0', 't0');
    const s = useTerminalStore.getState();
    expect(Object.keys(s.groups)).toHaveLength(1);
    expect(s.activeGroupId).not.toBe('g0'); // a fresh group
    expect(s.closing).toHaveLength(1); // the old one is restorable
  });

  it('closeTab on a multi-tab group keeps the group, picks a new active tab', () => {
    useTerminalStore.setState({
      groups: { g0: { id: 'g0', tabs: [{ id: 't0' }, { id: 't1' }], activeTabId: 't1' } },
    });
    useTerminalStore.getState().closeTab('g0', 't1');
    const s = useTerminalStore.getState();
    expect(Object.keys(s.groups)).toEqual(['g0']);
    expect(s.groups.g0?.tabs.map((t) => t.id)).toEqual(['t0']);
    expect(s.groups.g0?.activeTabId).toBe('t0');
  });

  it('markActivity flags a non-active tab; ignores the active one; clears on focus', () => {
    useTerminalStore.setState({
      groups: { g0: { id: 'g0', tabs: [{ id: 't0' }, { id: 't1' }], activeTabId: 't0' } },
    });
    useTerminalStore.getState().markActivity('t1');
    expect(useTerminalStore.getState().activity.t1).toBe(true);
    useTerminalStore.getState().markActivity('t0'); // active tab of active group → ignored
    expect(useTerminalStore.getState().activity.t0).toBeUndefined();
    useTerminalStore.getState().focusTab('g0', 't1');
    expect(useTerminalStore.getState().activity.t1).toBeUndefined();
  });
});
