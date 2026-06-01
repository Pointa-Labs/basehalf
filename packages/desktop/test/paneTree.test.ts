import { beforeEach, describe, expect, it } from 'vitest';
import {
  type LeafPane,
  type PaneNode,
  __resetPaneIds,
  adoptPaneIds,
  allLeaves,
  closeInLeaf,
  emptyLeaf,
  findLeaf,
  firstLeaf,
  leafCount,
  moveInLeaf,
  nextPaneId,
  openInLeaf,
  pinInLeaf,
  removeLeaf,
  renameInLeaf,
  setFraction,
  splitLeaf,
  updateLeaf,
} from '../src/renderer/src/lib/paneTree.js';

const leaf = (
  id: string,
  tabs: string[],
  active: string | null,
  preview: string | null,
): LeafPane => ({
  type: 'leaf',
  id,
  tabs,
  activeFile: active,
  previewFile: preview,
});

beforeEach(() => __resetPaneIds());

describe('paneTree — per-leaf tab ops', () => {
  it('preview open replaces the preview slot in place (single slot)', () => {
    let l = emptyLeaf('p');
    l = openInLeaf(l, 'a.md'); // preview a
    expect(l.tabs).toEqual(['a.md']);
    expect(l.previewFile).toBe('a.md');
    l = openInLeaf(l, 'b.md'); // preview b REPLACES a in place
    expect(l.tabs).toEqual(['b.md']);
    expect(l.previewFile).toBe('b.md');
    expect(l.activeFile).toBe('b.md');
  });

  it('pinned open appends and leaves the preview slot untouched', () => {
    let l = openInLeaf(emptyLeaf('p'), 'a.md'); // preview a
    l = openInLeaf(l, 'b.md', { pinned: true }); // pinned b
    expect(l.tabs).toEqual(['a.md', 'b.md']);
    expect(l.previewFile).toBe('a.md'); // a still the preview
    // Opening a new preview replaces a (the preview), keeps b (pinned).
    l = openInLeaf(l, 'c.md');
    expect(l.tabs).toEqual(['c.md', 'b.md']);
    expect(l.previewFile).toBe('c.md');
  });

  it('re-opening an open file activates it; pinned re-open promotes it', () => {
    let l = openInLeaf(emptyLeaf('p'), 'a.md'); // preview a
    l = openInLeaf(l, 'b.md', { pinned: true });
    l = openInLeaf(l, 'a.md'); // re-open preview a → just activate, stays preview
    expect(l.activeFile).toBe('a.md');
    expect(l.previewFile).toBe('a.md');
    l = openInLeaf(l, 'a.md', { pinned: true }); // promote
    expect(l.previewFile).toBeNull();
    expect(l.tabs).toEqual(['a.md', 'b.md']); // no dupe
  });

  it('pinInLeaf promotes only the preview', () => {
    let l = openInLeaf(emptyLeaf('p'), 'a.md');
    l = pinInLeaf(l, 'a.md');
    expect(l.previewFile).toBeNull();
    // no-op on a non-preview
    expect(pinInLeaf(l, 'a.md')).toBe(l);
  });

  it('closeInLeaf removes, activates a neighbor, frees the preview slot', () => {
    let l = leaf('p', ['a.md', 'b.md', 'c.md'], 'b.md', 'c.md');
    l = closeInLeaf(l, 'b.md'); // active closed → neighbor (c slid into idx 1)
    expect(l.tabs).toEqual(['a.md', 'c.md']);
    expect(l.activeFile).toBe('c.md');
    l = closeInLeaf(l, 'c.md'); // closing the preview frees the slot
    expect(l.tabs).toEqual(['a.md']);
    expect(l.previewFile).toBeNull();
    expect(l.activeFile).toBe('a.md');
  });

  it('moveInLeaf reorders', () => {
    const l = leaf('p', ['a.md', 'b.md', 'c.md'], 'a.md', null);
    expect(moveInLeaf(l, 'a.md', 2).tabs).toEqual(['b.md', 'a.md', 'c.md']);
    expect(moveInLeaf(l, 'c.md', 0).tabs).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('renameInLeaf rebinds tabs/active/preview', () => {
    const l = leaf('p', ['a.md', 'b.md'], 'a.md', 'a.md');
    const r = renameInLeaf(l, 'a.md', 'z.md');
    expect(r.tabs).toEqual(['z.md', 'b.md']);
    expect(r.activeFile).toBe('z.md');
    expect(r.previewFile).toBe('z.md');
  });
});

describe('paneTree — tree structure', () => {
  it('splits a leaf and collapses on removal', () => {
    const root = leaf('p1', ['a.md'], 'a.md', null);
    const split = splitLeaf(root, 'p1', 'row', emptyLeaf('p2'), false, 's1') as PaneNode;
    expect(split.type).toBe('split');
    expect(leafCount(split)).toBe(2);
    expect(firstLeaf(split).id).toBe('p1');
    expect(findLeaf(split, 'p2')?.id).toBe('p2');
    expect(allLeaves(split).map((l) => l.id)).toEqual(['p1', 'p2']);

    // Removing p2 collapses the split back to p1.
    const collapsed = removeLeaf(split, 'p2');
    expect(collapsed?.type).toBe('leaf');
    expect((collapsed as LeafPane).id).toBe('p1');

    // Removing the last leaf yields null (empty tree).
    expect(removeLeaf(root, 'p1')).toBeNull();
  });

  it('`before` puts the new leaf first', () => {
    const root = leaf('p1', [], null, null);
    const split = splitLeaf(root, 'p1', 'row', emptyLeaf('p2'), true, 's1');
    expect(split.type === 'split' && split.a.type === 'leaf' && split.a.id).toBe('p2');
    expect(split.type === 'split' && split.b.type === 'leaf' && split.b.id).toBe('p1');
  });

  it('updateLeaf + setFraction target by id', () => {
    const root = splitLeaf(
      leaf('p1', [], null, null),
      'p1',
      'column',
      emptyLeaf('p2'),
      false,
      's1',
    );
    const opened = updateLeaf(root, 'p2', (l) => openInLeaf(l, 'x.md'));
    expect(findLeaf(opened, 'p2')?.tabs).toEqual(['x.md']);
    expect(findLeaf(opened, 'p1')?.tabs).toEqual([]); // p1 untouched
    const sized = setFraction(opened, 's1', 0.7);
    expect(sized.type === 'split' && sized.fraction).toBe(0.7);
    // clamps out-of-range
    expect((setFraction(opened, 's1', 0.99) as { fraction: number }).fraction).toBe(0.9);
  });
});

describe('paneTree — adoptPaneIds (restore-safe id counter)', () => {
  it('advances the counter past every id in a restored tree (no later collision)', () => {
    __resetPaneIds();
    // A persisted tree whose ids predate this session's counter (still at 0).
    const restored: PaneNode = {
      type: 'split',
      id: 'pane-3',
      direction: 'row',
      a: { type: 'leaf', id: 'pane-1', tabs: ['a.md'], activeFile: 'a.md', previewFile: null },
      b: { type: 'leaf', id: 'pane-5', tabs: ['b.md'], activeFile: 'b.md', previewFile: null },
      fraction: 0.5,
    };
    adoptPaneIds(restored);
    // The next id must be PAST the max restored id (pane-5), not pane-1 again.
    expect(nextPaneId()).toBe('pane-6');
  });

  it('is a no-op (keeps counting up) when the tree has no higher ids', () => {
    __resetPaneIds();
    nextPaneId(); // pane-1
    adoptPaneIds({ type: 'leaf', id: 'pane-1', tabs: [], activeFile: null, previewFile: null });
    expect(nextPaneId()).toBe('pane-2');
  });
});
