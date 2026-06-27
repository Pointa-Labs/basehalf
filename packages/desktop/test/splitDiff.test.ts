import { describe, expect, it } from 'vitest';
import { type SplitRow, computeSplitRows } from '../src/renderer/src/lib/splitDiff.js';
import { computeUnifiedDiff } from '../src/renderer/src/lib/unifiedDiff.js';

const pairs = (rows: SplitRow[]) => rows.filter((r) => r.kind === 'pair');

describe('computeSplitRows', () => {
  it('shows a context line on both sides with its own line numbers', () => {
    const rows = computeUnifiedDiff('a\nb\nc\n', 'a\nb\nc\n', {
      context: Number.POSITIVE_INFINITY,
    });
    const split = computeSplitRows(rows);
    expect(split).toHaveLength(3);
    for (const r of split) {
      if (r.kind !== 'pair') throw new Error('expected pair');
      expect(r.left?.changed).toBe(false);
      expect(r.right?.changed).toBe(false);
      expect(r.left?.lineNo).toBe(r.right?.lineNo);
      expect(r.left?.text).toBe(r.right?.text);
    }
  });

  it('aligns a modify: delete on the left, add on the right, same row', () => {
    const rows = computeUnifiedDiff('x\nB\ny\n', 'x\nb\ny\n', {
      context: Number.POSITIVE_INFINITY,
    });
    const ps = pairs(computeSplitRows(rows));
    const changed = ps.filter((r) => r.kind === 'pair' && (r.left?.changed || r.right?.changed));
    expect(changed).toHaveLength(1);
    const row = changed[0];
    if (row?.kind !== 'pair') throw new Error('expected pair');
    expect(row.left?.changed).toBe(true);
    expect(row.right?.changed).toBe(true);
    expect(row.left?.lineNo).toBe(2); // old 'B'
    expect(row.right?.lineNo).toBe(2); // new 'b'
    expect(row.left?.segs?.map((s) => s.text).join('')).toBe('B');
    expect(row.right?.segs?.map((s) => s.text).join('')).toBe('b');
  });

  it('a pure addition has a blank (null) left cell', () => {
    const rows = computeUnifiedDiff('a\nc\n', 'a\nb\nc\n', { context: Number.POSITIVE_INFINITY });
    const added = pairs(computeSplitRows(rows)).find(
      (r) => r.kind === 'pair' && r.left === null && r.right?.changed,
    );
    if (added?.kind !== 'pair') throw new Error('expected an add row');
    expect(added.left).toBeNull();
    expect(added.right?.lineNo).toBe(2);
  });

  it('a pure deletion has a blank (null) right cell', () => {
    const rows = computeUnifiedDiff('a\nb\nc\n', 'a\nc\n', { context: Number.POSITIVE_INFINITY });
    const deleted = pairs(computeSplitRows(rows)).find(
      (r) => r.kind === 'pair' && r.right === null && r.left?.changed,
    );
    if (deleted?.kind !== 'pair') throw new Error('expected a del row');
    expect(deleted.right).toBeNull();
    expect(deleted.left?.lineNo).toBe(2);
  });

  it('pads an uneven modify block (2 deletes vs 1 add) with a filler', () => {
    const rows = computeUnifiedDiff('A\nB\n', 'C\n', { context: Number.POSITIVE_INFINITY });
    const changed = pairs(computeSplitRows(rows)).filter(
      (r) => r.kind === 'pair' && (r.left?.changed || r.right?.changed),
    );
    expect(changed).toHaveLength(2); // max(2 deletes, 1 add)
    const second = changed[1];
    if (second?.kind !== 'pair') throw new Error('expected pair');
    expect(second.left?.changed).toBe(true); // second delete
    expect(second.right).toBeNull(); // no matching add → filler
  });

  it('carries a gap row through unchanged', () => {
    // A big unchanged middle collapses to a gap with default context.
    const orig = `${Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')}\n`;
    const mod = orig.replace('l0', 'CHANGED');
    const rows = computeUnifiedDiff(orig, mod);
    const split = computeSplitRows(rows);
    expect(rows.some((r) => r.kind === 'gap')).toBe(true);
    expect(split.some((r) => r.kind === 'gap')).toBe(true);
  });
});
