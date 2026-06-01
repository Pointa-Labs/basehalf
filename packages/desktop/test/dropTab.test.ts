import { beforeEach, describe, expect, it } from 'vitest';
import {
  type LeafPane,
  type PaneNode,
  allLeaves,
  findLeaf,
  leafCount,
} from '../src/renderer/src/lib/paneTree.js';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// Pin the store's dropTab semantics (the drop overlay's drop handler): a CENTER
// drop moves a tab into the target pane; an EDGE drop splits the target and moves
// the tab into the new pane; an emptied source pane collapses.

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

beforeEach(() => store.setState({ error: '' }));

describe('store.dropTab', () => {
  it('EDGE drop splits the target and moves the tab into the new pane', async () => {
    // Single pane [a,b], active b (so the dragged `a` isn't active → sync path).
    setTree(leaf('p1', ['a.md', 'b.md'], 'b.md'), 'p1');
    store.getState().dropTab('a.md', 'p1', 'p1', 'right');
    await tick();
    const tree = store.getState().paneTree;
    expect(tree.type).toBe('split');
    expect(leafCount(tree)).toBe(2);
    // Source kept its OTHER tab; a new pane holds the moved one.
    expect(findLeaf(tree, 'p1')?.tabs).toEqual(['b.md']);
    const moved = allLeaves(tree).find((l) => l.id !== 'p1');
    expect(moved?.tabs).toEqual(['a.md']);
    // 'right' → row split, new pane AFTER (child b).
    expect(tree.type === 'split' && tree.direction).toBe('row');
    expect(tree.type === 'split' && (tree.b as LeafPane).tabs).toEqual(['a.md']);
    expect(store.getState().currentFile).toBe('a.md'); // new pane is active
  });

  it('CENTER drop moves a tab from one pane into another', async () => {
    const tree: PaneNode = {
      type: 'split',
      id: 's1',
      direction: 'row',
      a: leaf('A', ['a.md', 'b.md'], 'b.md'),
      b: leaf('B', ['c.md'], 'c.md'),
      fraction: 0.5,
    };
    setTree(tree, 'A');
    store.getState().dropTab('a.md', 'A', 'B', 'center');
    await tick();
    const out = store.getState().paneTree;
    expect(findLeaf(out, 'A')?.tabs).toEqual(['b.md']); // moved out of A
    expect(findLeaf(out, 'B')?.tabs).toEqual(['c.md', 'a.md']); // into B (pinned)
    expect(store.getState().activePaneId).toBe('B');
  });

  it('moving the last tab out collapses the emptied source pane', async () => {
    const tree: PaneNode = {
      type: 'split',
      id: 's1',
      direction: 'row',
      a: leaf('A', ['a.md'], 'a.md'),
      b: leaf('B', ['b.md'], 'b.md'),
      fraction: 0.5,
    };
    setTree(tree, 'A');
    store.getState().dropTab('a.md', 'A', 'B', 'center'); // A empties → collapse
    await tick();
    const out = store.getState().paneTree;
    expect(out.type).toBe('leaf'); // collapsed to just B
    expect(leafCount(out)).toBe(1);
    expect((out as LeafPane).id).toBe('B');
    expect((out as LeafPane).tabs).toEqual(['b.md', 'a.md']);
  });

  it('CENTER drop onto the same pane is a no-op (reorder is the strip’s job)', async () => {
    setTree(leaf('p1', ['a.md', 'b.md'], 'b.md'), 'p1');
    const before = store.getState().paneTree;
    store.getState().dropTab('a.md', 'p1', 'p1', 'center');
    await tick();
    expect(leafCount(store.getState().paneTree)).toBe(1);
    expect(findLeaf(store.getState().paneTree, 'p1')?.tabs).toEqual(
      before.type === 'leaf' ? before.tabs : [],
    );
  });
});
