import { describe, expect, it } from 'vitest';
import {
  type TermNode,
  closeLeaf,
  directionalNeighbor,
  dropEdge,
  equalize,
  findLeaf,
  firstLeaf,
  insertBeside,
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

  it('focus-after-close = previous leaf in-order (Ghostty rule)', () => {
    // a | (b | c). Closing the MIDDLE leaf b focuses the PREVIOUS leaf (a) —
    // NOT firstLeaf(sibling)=c. This is where the Ghostty rule diverges from a
    // naive "focus the sibling".
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'right', 'c', 's2');
    const { root, focusId } = closeLeaf(t, 'b');
    expect(orderedLeafIds(root as TermNode)).toEqual(['a', 'c']);
    expect(focusId).toBe('a');
  });

  it('focus-after-close = next leaf when the closed pane was leftmost', () => {
    // (a | b) | c. Closing the LEFTMOST leaf a focuses the NEXT leaf (b).
    let t = splitLeaf(leaf('a'), 'a', 'right', 'c', 's1'); // a | c
    t = splitLeaf(t, 'a', 'right', 'b', 's2'); // (a | b) | c
    expect(orderedLeafIds(t)).toEqual(['a', 'b', 'c']);
    const { focusId } = closeLeaf(t, 'a');
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

  it('directionalNeighbor moves within a stacked column (Ghostty spatial)', () => {
    // Layout: a | (b / c) — a is full height on the left; b top-right, c bottom-right.
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'down', 'c', 's2');
    expect(directionalNeighbor(t, 'b', 'down')).toBe('c');
    expect(directionalNeighbor(t, 'c', 'up')).toBe('b');
    // Right from a (full height) → nearest top-left corner among {b@(.5,0), c@(.5,.5)}
    // is b. No overlap gate, so it never dead-ends.
    expect(directionalNeighbor(t, 'a', 'right')).toBe('b');
  });

  it('directionalNeighbor allows a diagonal candidate (no overlap gate)', () => {
    // a | (b / c): from c (bottom-right), nothing is entirely to the right, but
    // going UP reaches b; LEFT reaches a (a spans full height, its maxX == c minX).
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'down', 'c', 's2');
    expect(directionalNeighbor(t, 'c', 'left')).toBe('a');
    expect(directionalNeighbor(t, 'c', 'right')).toBeNull(); // edge → no wrap
  });

  it('equalize resets fractions by direction-aware leaf weight', () => {
    // a | (b | c): top split should give 1/3 to a (weight 1) vs 2/3 to (b|c)
    // (weight 2, same axis), and the inner split stays 0.5.
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1');
    t = splitLeaf(t, 'b', 'right', 'c', 's2'); // a | (b | c), both rows
    t = setFraction(t, 's1', 0.8); // skew it
    const eq = equalize(t) as Extract<TermNode, { type: 'split' }>;
    expect(eq.fraction).toBeCloseTo(1 / 3, 6);
    expect((eq.b as Extract<TermNode, { type: 'split' }>).fraction).toBeCloseTo(0.5, 6);
  });

  it('equalize: a perpendicular nested split counts as weight 1', () => {
    // a | (b / c): the inner split is a COLUMN (perpendicular to the outer row),
    // so it weighs 1 → the outer row equalizes to 0.5 (a vs the column).
    let t = splitLeaf(leaf('a'), 'a', 'right', 'b', 's1'); // row
    t = splitLeaf(t, 'b', 'down', 'c', 's2'); // a | (b / c)
    t = setFraction(t, 's1', 0.2);
    const eq = equalize(t) as Extract<TermNode, { type: 'split' }>;
    expect(eq.fraction).toBeCloseTo(0.5, 6);
  });

  it('insertBeside places the new pane on the near vs far side per edge', () => {
    // Drop onto the LEFT edge of a → new pane on side a (near).
    const left = insertBeside(leaf('a'), 'a', 'left', 'x', 's1') as Extract<
      TermNode,
      { type: 'split' }
    >;
    expect(left.dir).toBe('row');
    expect((left.a as { id: string }).id).toBe('x');
    expect((left.b as { id: string }).id).toBe('a');
    // Drop onto the DOWN edge → column, new pane on side b (far).
    const down = insertBeside(leaf('a'), 'a', 'down', 'x', 's1') as Extract<
      TermNode,
      { type: 'split' }
    >;
    expect(down.dir).toBe('column');
    expect((down.b as { id: string }).id).toBe('x');
  });

  it('dropEdge picks the nearest edge, ties → left→right→up→down', () => {
    expect(dropEdge(0.1, 0.5)).toBe('left');
    expect(dropEdge(0.9, 0.5)).toBe('right');
    expect(dropEdge(0.5, 0.1)).toBe('up');
    expect(dropEdge(0.5, 0.9)).toBe('down');
    expect(dropEdge(0.5, 0.5)).toBe('left'); // exact center → left
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
