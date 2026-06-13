import { describe, expect, it } from 'vitest';
import {
  type TermNode,
  closeLeaf,
  directionalNeighbor,
  findLeaf,
  firstLeaf,
  leaf,
  leafRects,
  orderedLeafIds,
  resizeTarget,
  ringNeighbor,
  setFraction,
  splitLeaf,
} from '../src/renderer/src/lib/terminalTree.js';

describe('terminalTree', () => {
  it('splits a leaf right into a row with the new pane on side b', () => {
    const t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    expect(t).toEqual({
      type: 'split',
      id: 's1',
      dir: 'row',
      a: { type: 'leaf', id: 'a' },
      b: { type: 'leaf', id: 'b' },
      fraction: 0.5,
    });
  });

  it('splits down into a column', () => {
    const t = splitLeaf(leaf('a'), 'a', 'down', 'b', 's1') as Extract<TermNode, { type: 'split' }>;
    expect(t.dir).toBe('column');
  });

  it('splits a nested leaf without touching siblings', () => {
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'down', 'c', 's2');
    expect(orderedLeafIds(t)).toEqual(['a', 'b', 'c']);
    expect(findLeaf(t, 'c')).not.toBeNull();
  });

  it('closing a leaf collapses its parent split into the sibling', () => {
    const t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    const { root, focusId } = closeLeaf(t, 'b');
    expect(root).toEqual({ type: 'leaf', id: 'a' });
    expect(focusId).toBe('a');
  });

  it('closing the only leaf yields a null tree', () => {
    expect(closeLeaf(leaf('a'), 'a')).toEqual({ root: null, focusId: null });
  });

  it('closing a deep leaf keeps the rest and focuses the sibling', () => {
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'down', 'c', 's2'); // a | (b / c)
    const { root, focusId } = closeLeaf(t, 'c');
    expect(orderedLeafIds(root as TermNode)).toEqual(['a', 'b']);
    expect(focusId).toBe('b');
  });

  it('ringNeighbor wraps around the in-order leaf list', () => {
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'right', 'c', 's2'); // a | (b | c)
    expect(ringNeighbor(t, 'a', 1)).toBe('b');
    expect(ringNeighbor(t, 'c', 1)).toBe('a'); // wrap
    expect(ringNeighbor(t, 'a', -1)).toBe('c'); // wrap back
  });

  it('clamps split fractions to [0.1, 0.9]', () => {
    const t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    expect((setFraction(t, 's1', 0.99) as { fraction: number }).fraction).toBe(0.9);
    expect((setFraction(t, 's1', 0) as { fraction: number }).fraction).toBe(0.1);
  });

  it('computes normalized leaf rects from fractions', () => {
    // a | b at 0.5 → two half-width columns.
    const t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    const rects = leafRects(t);
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(rects.get('b')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it('directionalNeighbor finds the pane to the right / left', () => {
    const t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    expect(directionalNeighbor(t, 'a', 'right')).toBe('b');
    expect(directionalNeighbor(t, 'b', 'left')).toBe('a');
    expect(directionalNeighbor(t, 'a', 'up')).toBeNull();
  });

  it('directionalNeighbor respects perpendicular overlap (no diagonal jumps)', () => {
    // Layout: a | (b / c) — a is full height on the left; b top-right, c bottom-right.
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'down', 'c', 's2');
    // Going right from a (full height) overlaps both b and c; the nearest along
    // the travel axis with positive overlap is whichever shares the edge — both
    // share x, so it picks one; going down from b reaches c.
    expect(directionalNeighbor(t, 'b', 'down')).toBe('c');
    expect(directionalNeighbor(t, 'c', 'up')).toBe('b');
  });

  it('resizeTarget finds the nearest ancestor split on the right axis', () => {
    // a | b is a row; resizing a left/right targets s1, with a on side A.
    const t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    expect(resizeTarget(t, 'a', 'right')).toEqual({ splitId: 's1', onSideA: true });
    expect(resizeTarget(t, 'b', 'left')).toEqual({ splitId: 's1', onSideA: false });
    // No column ancestor → vertical resize has no target.
    expect(resizeTarget(t, 'a', 'down')).toBeNull();
  });

  it('firstLeaf walks to the left-most/top-most leaf', () => {
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'a', 'down', 'c', 's2'); // (a / c) | b
    expect(firstLeaf(t).id).toBe('a');
  });
});
