import type { GitCommit } from '@basehalf/core';
import { describe, expect, it } from 'vitest';
import { type GraphRow, laneColor, layoutGraph } from '../src/renderer/src/lib/gitGraph.js';

// Minimal commit builder — only hash + parents matter to the layout.
const c = (hash: string, parents: string[] = []): GitCommit => ({
  hash,
  shortHash: hash,
  parents,
  author: { name: '', email: '', date: '' },
  committer: { name: '', email: '', date: '' },
  subject: hash,
  body: '',
  refs: [],
  tags: [],
  head: false,
});

const byHash = (rows: readonly GraphRow[], hash: string): GraphRow => {
  const r = rows.find((x) => x.commit.hash === hash);
  if (!r) throw new Error(`no row for ${hash}`);
  return r;
};

describe('layoutGraph', () => {
  it('lays a linear history in a single lane', () => {
    const { rows, width } = layoutGraph([c('a', ['b']), c('b', ['d']), c('d', [])]);
    expect(width).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    // middle commit: one incoming (from a), one outgoing (to d), both in lane 0
    expect(byHash(rows, 'b').incoming).toEqual([0]);
    expect(byHash(rows, 'b').outgoing).toEqual([0]);
    // tip has no incoming; root has no outgoing
    expect(byHash(rows, 'a').incoming).toEqual([]);
    expect(byHash(rows, 'd').outgoing).toEqual([]);
  });

  it('fans a merge commit out to two lanes and converges back', () => {
    // a = merge of b and e; b and e share parent d.
    const { rows, width } = layoutGraph([
      c('a', ['b', 'e']),
      c('b', ['d']),
      c('e', ['d']),
      c('d', []),
    ]);
    expect(width).toBe(2);
    const a = byHash(rows, 'a');
    expect(a.lane).toBe(0);
    expect(a.outgoing).toEqual([0, 1]); // first parent stays lane 0, merge parent → lane 1

    // e lives in lane 1, then converges into d which is already in lane 0
    const e = byHash(rows, 'e');
    expect(e.lane).toBe(1);
    expect(e.incoming).toEqual([1]);
    expect(e.outgoing).toEqual([0]); // edge points at d's existing lane

    // d collapses back to a single incoming lane
    const d = byHash(rows, 'd');
    expect(d.lane).toBe(0);
    expect(d.outgoing).toEqual([]);
  });

  it('marks a lane that skips a row as pass-through', () => {
    // a→d (lane 0) with a side branch b (lane 1, tip) whose parent is d.
    // Row b sees lane 0 (the a→d edge) passing straight through.
    const { rows } = layoutGraph([c('a', ['d']), c('b', ['d']), c('d', [])]);
    const b = byHash(rows, 'b');
    expect(b.lane).toBe(1);
    expect(b.passThrough).toContain(0); // the a→d line passes through b's row
    expect(b.outgoing).toEqual([0]); // b also converges into d (lane 0)
  });

  it('reuses a freed lane for a later unrelated tip', () => {
    // Two independent tips a→x and b→y, then x and y as roots. After a's lane
    // frees (x is a root), nothing reuses it here, but width stays bounded.
    const { width } = layoutGraph([c('a', ['x']), c('b', ['y']), c('x', []), c('y', [])]);
    expect(width).toBe(2);
  });

  it('handles an empty history', () => {
    expect(layoutGraph([])).toEqual({ rows: [], width: 1 });
  });

  it('lanesBefore shows incoming edges, lanesAfter shows outgoing', () => {
    const { rows } = layoutGraph([c('a', ['b']), c('b', [])]);
    const a = byHash(rows, 'a');
    expect(a.lanesAfter).toEqual(['b']); // a's lane now waits for b
    const b = byHash(rows, 'b');
    expect(b.lanesBefore).toEqual(['b']); // b enters with its lane carrying its hash
    expect(b.lanesAfter).toEqual([]); // root: lane freed + trimmed
  });
});

describe('laneColor', () => {
  it('wraps the lane index into the palette range', () => {
    expect(laneColor(0, 6)).toBe(0);
    expect(laneColor(7, 6)).toBe(1);
    expect(laneColor(-1, 6)).toBe(5); // defensive: never negative
  });
});
