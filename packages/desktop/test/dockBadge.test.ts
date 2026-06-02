import { beforeEach, describe, expect, it } from 'vitest';
import { regionFor } from '../src/renderer/src/lib/paneDrop.js';
import {
  type LeafPane,
  type PaneNode,
  allLeaves,
  findLeaf,
  leafCount,
} from '../src/renderer/src/lib/paneTree.js';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// regionFor (the drop-region geometry shared by tab drops and the canvas badge
// dock) + store.dockBadge (open a canvas badge in the panel at a region).

describe('regionFor', () => {
  it('the inner 50% box is the CENTER', () => {
    expect(regionFor(50, 50, 100, 100)).toBe('center');
    expect(regionFor(30, 70, 100, 100)).toBe('center'); // 0.3 / 0.3 both > 0.25
  });
  it('the outer frame resolves to the nearest EDGE', () => {
    expect(regionFor(5, 50, 100, 100)).toBe('left');
    expect(regionFor(95, 50, 100, 100)).toBe('right');
    expect(regionFor(50, 5, 100, 100)).toBe('up');
    expect(regionFor(50, 95, 100, 100)).toBe('down');
  });
  it('a corner picks the closest of the two edges', () => {
    // x=2% (left dist 0.02) vs y=10% (up dist 0.10) → left wins.
    expect(regionFor(2, 10, 100, 100)).toBe('left');
    // y=2% (up dist 0.02) vs x=10% (left dist 0.10) → up wins.
    expect(regionFor(10, 2, 100, 100)).toBe('up');
  });
});

describe('store.dockBadge', () => {
  const store = useWorkspaceStore;
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r));
  const leaf = (id: string, tabs: string[], active: string | null): LeafPane => ({
    type: 'leaf',
    id,
    tabs,
    activeFile: active,
    previewFile: null,
  });
  const setTree = (tree: PaneNode, activePaneId: string): void =>
    store.setState({ paneTree: tree, activePaneId, current: 'ws', error: '' });

  beforeEach(() => store.setState({ error: '', canvasDockDrag: null }));

  it("CENTER opens the badge as a tab in the target pane (it's a reference open)", async () => {
    setTree(leaf('p1', ['a.md'], 'a.md'), 'p1');
    store.getState().dockBadge('b.md', 'p1', 'center');
    await tick();
    expect(findLeaf(store.getState().paneTree, 'p1')?.tabs).toEqual(['a.md', 'b.md']);
    expect(store.getState().currentFile).toBe('b.md');
    expect(store.getState().canvasDockDrag).toBeNull();
  });

  it('an EDGE splits the target pane and opens the badge in the new pane', async () => {
    setTree(leaf('p1', ['a.md'], 'a.md'), 'p1');
    store.getState().dockBadge('b.md', 'p1', 'right');
    await tick();
    const tree = store.getState().paneTree;
    expect(tree.type).toBe('split');
    expect(leafCount(tree)).toBe(2);
    expect(findLeaf(tree, 'p1')?.tabs).toEqual(['a.md']); // source untouched
    const added = allLeaves(tree).find((l) => l.id !== 'p1');
    expect(added?.tabs).toEqual(['b.md']);
    expect(tree.type === 'split' && tree.direction).toBe('row'); // left/right → row
    expect(store.getState().currentFile).toBe('b.md'); // new pane is active
  });

  it("'up' / 'down' split into a COLUMN, 'before' places the new pane first", async () => {
    setTree(leaf('p1', ['a.md'], 'a.md'), 'p1');
    store.getState().dockBadge('b.md', 'p1', 'up');
    await tick();
    const tree = store.getState().paneTree;
    expect(tree.type === 'split' && tree.direction).toBe('column');
    // 'up' → before:true → the new pane is child `a`.
    expect(tree.type === 'split' && (tree.a as LeafPane).tabs).toEqual(['b.md']);
  });
});
