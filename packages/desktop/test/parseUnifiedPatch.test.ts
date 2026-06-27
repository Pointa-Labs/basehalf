import { describe, expect, it } from 'vitest';
import { parseUnifiedPatch } from '../src/renderer/src/lib/parseUnifiedPatch.js';

describe('parseUnifiedPatch', () => {
  it('parses a hunk into gap + context/del/add with correct line numbers', () => {
    const patch = ['@@ -1,3 +1,4 @@', ' a', '-b', '+B', '+B2', ' c'].join('\n');
    const rows = parseUnifiedPatch(patch);
    expect(rows[0]).toEqual({
      kind: 'gap',
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4,
      hidden: [],
    });
    expect(rows[1]).toEqual({ kind: 'context', oldLine: 1, newLine: 1, text: 'a' });
    expect(rows[2]).toEqual({ kind: 'del', oldLine: 2, segs: [{ text: 'b', hi: false }] });
    expect(rows[3]).toEqual({ kind: 'add', newLine: 2, segs: [{ text: 'B', hi: false }] });
    expect(rows[4]).toEqual({ kind: 'add', newLine: 3, segs: [{ text: 'B2', hi: false }] });
    expect(rows[5]).toEqual({ kind: 'context', oldLine: 3, newLine: 4, text: 'c' });
  });

  it('handles a single-line hunk header (no counts) and multiple hunks', () => {
    const patch = ['@@ -5 +5 @@', '-x', '+y', '@@ -20,2 +21,2 @@', ' k', '+m'].join('\n');
    const rows = parseUnifiedPatch(patch);
    expect(rows[0]).toMatchObject({
      kind: 'gap',
      oldStart: 5,
      oldCount: 1,
      newStart: 5,
      newCount: 1,
    });
    expect(rows[1]).toMatchObject({ kind: 'del', oldLine: 5 });
    expect(rows[2]).toMatchObject({ kind: 'add', newLine: 5 });
    const secondGap = rows.find((r, i) => i > 2 && r.kind === 'gap');
    expect(secondGap).toMatchObject({ kind: 'gap', oldStart: 20, newStart: 21 });
  });

  it('ignores the "no newline at end of file" marker', () => {
    const rows = parseUnifiedPatch(
      ['@@ -1 +1 @@', '-a', '+b', '\\ No newline at end of file'].join('\n'),
    );
    expect(rows.filter((r) => r.kind !== 'gap')).toHaveLength(2);
  });

  it('empty patch → no rows', () => {
    expect(parseUnifiedPatch('')).toEqual([]);
  });
});
