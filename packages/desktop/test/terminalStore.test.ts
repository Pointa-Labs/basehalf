import { beforeEach, describe, expect, it } from 'vitest';
import { findLeaf, leaf, orderedLeafIds } from '../src/renderer/src/lib/terminalTree.js';
import { useTerminalStore } from '../src/renderer/src/store/terminal.js';

// Reset the singleton store to one tab ("tab0") holding one pane ("p0") before
// each test. Actions mint fresh ids internally, so post-reset ids never collide.
const reset = (): void => {
  useTerminalStore.setState({
    tabs: [{ id: 'tab0', tree: leaf('p0'), activePaneId: 'p0', zoomedPaneId: null }],
    activeTabId: 'tab0',
    focused: false,
    titles: {},
    dims: {},
    resizeTick: 0,
    activity: {},
    closing: [],
    drag: null,
  });
};

const g = () => useTerminalStore.getState();
const activeTab = () => g().tabs.find((t) => t.id === g().activeTabId);
const activeTree = () => activeTab()?.tree ?? leaf('x');

describe('terminal store — Ghostty tabs + panes', () => {
  beforeEach(reset);

  it('newTab inserts a single-pane tab after the active one and focuses it', () => {
    g().newTab();
    const s = g();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[0]?.id).toBe('tab0'); // inserted AFTER tab0
    expect(s.activeTabId).not.toBe('tab0');
    expect(activeTab()?.tree.type).toBe('leaf');
    expect(orderedLeafIds(activeTree())).toHaveLength(1);
  });

  it('switchTab wraps both ways', () => {
    g().newTab(); // [tab0, new] active=new
    const newId = g().activeTabId;
    g().selectTab('tab0');
    g().switchTab(-1); // wrap left → last
    expect(g().activeTabId).toBe(newId);
    g().switchTab(1); // wrap right → first
    expect(g().activeTabId).toBe('tab0');
  });

  it('gotoTab clamps; lastTab selects the last', () => {
    g().newTab();
    g().newTab(); // 3 tabs
    g().gotoTab(99);
    expect(g().activeTabId).toBe(g().tabs[2]?.id);
    g().gotoTab(2);
    expect(g().activeTabId).toBe(g().tabs[1]?.id);
    g().gotoTab(1);
    expect(g().activeTabId).toBe('tab0');
    g().lastTab();
    expect(g().activeTabId).toBe(g().tabs[2]?.id);
  });

  it('reorderTab moves a tab within the strip', () => {
    g().newTab();
    g().newTab(); // [tab0, A, B]
    const ids = g().tabs.map((t) => t.id);
    g().reorderTab('tab0', 3); // drop tab0 at the end
    expect(g().tabs.map((t) => t.id)).toEqual([ids[1], ids[2], 'tab0']);
  });

  it('splitPane splits the active pane and focuses the new one', () => {
    g().splitPane('right');
    const t = activeTab();
    expect(t?.tree.type).toBe('split');
    expect(orderedLeafIds(activeTree())).toHaveLength(2);
    expect(t?.activePaneId).not.toBe('p0'); // the new pane took focus
  });

  it('gotoPaneRing + gotoPaneDir move focus among panes', () => {
    g().splitPane('right'); // row [p0, pNew], active pNew
    g().gotoPaneRing(-1);
    expect(activeTab()?.activePaneId).toBe('p0');
    g().gotoPaneDir('right');
    expect(activeTab()?.activePaneId).not.toBe('p0');
  });

  it('closePane collapses to the sibling; undo restores the pane', () => {
    g().splitPane('right'); // [p0, pNew] active pNew
    const pNew = activeTab()?.activePaneId as string;
    g().closePane(pNew);
    expect(orderedLeafIds(activeTree())).toEqual(['p0']);
    expect(g().closing).toHaveLength(1);
    expect(g().closing[0]?.kind).toBe('pane');
    const key = g().closing[0]?.key as string;
    g().undoClose(key);
    expect(g().closing).toHaveLength(0);
    const ids = orderedLeafIds(activeTree());
    expect(ids).toContain('p0');
    expect(ids).toContain(pNew);
    expect(activeTab()?.activePaneId).toBe(pNew);
  });

  it('closing the last pane closes the tab (soft, undoable)', () => {
    g().closePane(); // p0 is the only pane → closes tab0
    const s = g();
    expect(s.tabs).toHaveLength(1); // a fresh tab
    expect(s.activeTabId).not.toBe('tab0');
    expect(s.closing).toHaveLength(1);
    expect(s.closing[0]?.kind).toBe('tab');
  });

  it('closeTab removes the tab, picks the next to the right, and undo restores its slot', () => {
    g().newTab();
    g().newTab(); // [tab0, A, B]
    const [, a, b] = g().tabs;
    g().selectTab(a?.id as string); // active = middle
    g().closeTab(a?.id as string);
    expect(g().tabs.map((t) => t.id)).toEqual(['tab0', b?.id]);
    expect(g().activeTabId).toBe(b?.id); // next to the right
    const key = g().closing[0]?.key as string;
    g().undoClose(key);
    expect(g().tabs.map((t) => t.id)).toEqual(['tab0', a?.id, b?.id]); // back in its slot
    expect(g().activeTabId).toBe(a?.id);
  });

  it('closeTab on the lone tab keeps a fresh tab + leaves the old undoable', () => {
    g().closeTab('tab0');
    expect(g().tabs).toHaveLength(1);
    expect(g().activeTabId).not.toBe('tab0');
    expect(g().closing).toHaveLength(1);
  });

  it('closeOtherTabs / closeTabsToRight soft-close the rest', () => {
    g().newTab();
    g().newTab(); // [tab0, A, B]
    const a = g().tabs[1];
    g().closeOtherTabs(a?.id as string);
    expect(g().tabs.map((t) => t.id)).toEqual([a?.id]);
    expect(g().closing).toHaveLength(2);

    reset();
    g().newTab();
    g().newTab(); // [tab0, A, B]
    g().closeTabsToRight('tab0');
    expect(g().tabs.map((t) => t.id)).toEqual(['tab0']);
    expect(g().closing).toHaveLength(2);
  });

  it('undoClose re-inserts a pane into the CURRENT tree (no clobber of concurrent splits)', () => {
    // Pane ids are minted with a module-global counter (not reset per test), so
    // capture them rather than assuming names.
    g().splitPane('right'); // p0 | p1, active p1
    const p1 = activeTab()?.activePaneId as string;
    g().splitPane('down'); // p1 → (p1 / p2), active p2; tree = p0 | (p1/p2)
    const p2 = activeTab()?.activePaneId as string;
    g().closePane('p0'); // close p0 → tree = (p1/p2)
    const key = g().closing[0]?.key as string;
    g().splitPane('right'); // during grace: active p2 → p2 | p3
    const p3 = activeTab()?.activePaneId as string;
    g().undoClose(key); // p0 returns; p1,p2,p3 kept
    const tree = activeTree();
    expect(orderedLeafIds(tree)).toHaveLength(4);
    for (const id of ['p0', p1, p2, p3]) expect(findLeaf(tree, id)).not.toBeNull();
  });

  it('movePane re-splits the dragged pane beside the target on the given edge', () => {
    g().splitPane('right'); // p0 | p1, active p1
    const p1 = activeTab()?.activePaneId as string;
    g().movePane('p0', 'right', p1); // move p0 to the right of p1 → order swaps
    expect(orderedLeafIds(activeTree())).toEqual([p1, 'p0']);
    expect(activeTab()?.activePaneId).toBe('p0');
    expect(g().paneDrag).toBeNull();
  });

  it('movePane onto itself or with a single pane is a no-op', () => {
    g().movePane('p0', 'right', 'p0');
    expect(orderedLeafIds(activeTree())).toEqual(['p0']);
  });

  it('toggleZoom is a no-op on a lone pane, zooms with a split, and a split clears it', () => {
    g().toggleZoom();
    expect(activeTab()?.zoomedPaneId).toBeNull();
    g().splitPane('right');
    const active = activeTab()?.activePaneId;
    g().toggleZoom();
    expect(activeTab()?.zoomedPaneId).toBe(active);
    g().splitPane('down'); // splitting clears zoom
    expect(activeTab()?.zoomedPaneId).toBeNull();
  });

  it('closing the zoomed pane clears the zoom', () => {
    g().splitPane('right'); // [p0, p1] active p1
    g().toggleZoom();
    expect(activeTab()?.zoomedPaneId).toBe(activeTab()?.activePaneId);
    g().closePane(activeTab()?.activePaneId); // close the zoomed pane
    expect(activeTab()?.zoomedPaneId).toBeNull();
  });

  it('markActivity flags a non-active tab; ignores the active one; clears on select', () => {
    g().newTab(); // new tab active
    const other = g().activeTabId;
    const otherPane = activeTab()?.activePaneId as string;
    g().selectTab('tab0'); // tab0 active again
    g().markActivity(otherPane);
    expect(g().activity[other]).toBe(true);
    g().markActivity('p0'); // active tab's pane → ignored
    expect(g().activity.tab0).toBeUndefined();
    g().selectTab(other);
    expect(g().activity[other]).toBeUndefined();
  });

  it('equalizePanes evens nested same-axis splits by leaf weight', () => {
    g().splitPane('right'); // p0 | p1, active p1
    g().splitPane('right'); // p0 | (p1 | p2)
    g().equalizePanes();
    const tree = activeTab()?.tree;
    // Outer split: left weight 1 (p0), right weight 2 (p1,p2) → 1/3.
    expect(tree?.type).toBe('split');
    if (tree?.type === 'split') expect(tree.fraction).toBeCloseTo(1 / 3, 5);
  });

  it('resizePane shifts the surrounding split fraction', () => {
    g().splitPane('right'); // row [p0, p1] frac 0.5, active p1
    g().resizePane('left'); // p1 is side b → grow p1 / shrink p0
    const tree = activeTab()?.tree;
    expect(g().resizeTick).toBe(1);
    if (tree?.type === 'split') expect(tree.fraction).not.toBe(0.5);
  });
});
