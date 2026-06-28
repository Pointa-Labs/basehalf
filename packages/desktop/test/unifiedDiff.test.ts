import { describe, expect, it } from 'vitest';
import {
  type DiffRow,
  type DiffSeg,
  computeUnifiedDiff,
  diffStat,
  hunkOldRanges,
  segmentLine,
} from '../src/workbench/contrib/multiDiffEditor/browser/unifiedDiffModel.js';

const ALL = { context: Number.POSITIVE_INFINITY };
const join = (segs: readonly DiffSeg[]): string => segs.map((s) => s.text).join('');
const hi = (segs: readonly DiffSeg[]): string =>
  segs
    .filter((s) => s.hi)
    .map((s) => s.text)
    .join('');

describe('segmentLine', () => {
  it('no ranges → one plain segment', () => {
    expect(segmentLine('hello', [])).toEqual([{ text: 'hello', hi: false }]);
  });
  it('splits a middle highlight (1-based, end exclusive)', () => {
    expect(segmentLine('abcdef', [[3, 6]])).toEqual([
      { text: 'ab', hi: false },
      { text: 'cde', hi: true },
      { text: 'f', hi: false },
    ]);
  });
  it('highlight running to the end of the line', () => {
    expect(segmentLine('abc', [[2, 4]])).toEqual([
      { text: 'a', hi: false },
      { text: 'bc', hi: true },
    ]);
  });
});

describe('computeUnifiedDiff', () => {
  it('a modify → del then add, with word-level segments', () => {
    const rows = computeUnifiedDiff('const b = oldValue;', 'const b = newValue + extra;', ALL);
    const del = rows.find((r) => r.kind === 'del') as Extract<DiffRow, { kind: 'del' }>;
    const add = rows.find((r) => r.kind === 'add') as Extract<DiffRow, { kind: 'add' }>;
    expect(del.oldLine).toBe(1);
    expect(add.newLine).toBe(1);
    // segments reconstruct the full line
    expect(join(del.segs)).toBe('const b = oldValue;');
    expect(join(add.segs)).toBe('const b = newValue + extra;');
    // and the changed span is the word-level highlight
    expect(hi(del.segs)).toBe('oldValue');
    expect(hi(add.segs)).toContain('newValue');
  });

  it('a pure add → context + add rows, no del', () => {
    const rows = computeUnifiedDiff('a\nb', 'a\nNEW\nb', ALL);
    expect(rows.map((r) => r.kind)).toEqual(['context', 'add', 'context']);
    const add = rows[1] as Extract<DiffRow, { kind: 'add' }>;
    expect(add.newLine).toBe(2);
    expect(join(add.segs)).toBe('NEW');
    expect(hi(add.segs)).toBe(''); // a pure add has NO word-level highlight (whole line is new)
  });

  it('a pure delete → context + del rows', () => {
    const rows = computeUnifiedDiff('a\nGONE\nb', 'a\nb', ALL);
    expect(rows.map((r) => r.kind)).toEqual(['context', 'del', 'context']);
    const del = rows[1] as Extract<DiffRow, { kind: 'del' }>;
    expect(del.oldLine).toBe(2);
    expect(join(del.segs)).toBe('GONE');
  });

  it('context lines carry BOTH line numbers', () => {
    const rows = computeUnifiedDiff('a\nb\nc', 'a\nX\nc', ALL);
    expect(rows[0]).toEqual({ kind: 'context', oldLine: 1, newLine: 1, text: 'a' });
    expect(rows[rows.length - 1]).toEqual({ kind: 'context', oldLine: 3, newLine: 3, text: 'c' });
  });

  it('collapses a long unchanged run into a hunk-header gap', () => {
    const orig = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    const rows = computeUnifiedDiff(orig, `${orig}\nADDED`, { context: 1 });
    const gap = rows.find((r) => r.kind === 'gap') as Extract<DiffRow, { kind: 'gap' }>;
    expect(gap).toBeDefined();
    // The hunk AFTER the gap is 1 context (line10) + 1 add (ADDED) → @@ -10,1 +10,2 @@
    expect(gap).toMatchObject({ oldStart: 10, oldCount: 1, newStart: 10, newCount: 2 });
    expect(rows[rows.length - 1]?.kind).toBe('add');
    // The 9 collapsed context lines (line1..line9) are kept for click-to-expand.
    expect(gap.hidden).toHaveLength(9);
    expect(gap.hidden.every((r) => r.kind === 'context')).toBe(true);
  });

  it('identical text → all context', () => {
    const rows = computeUnifiedDiff('a\nb\nc', 'a\nb\nc', ALL);
    expect(rows.every((r) => r.kind === 'context')).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('drops the phantom trailing blank line from a file ending in \\n', () => {
    // 'a\nb\n' splits to ['a','b',''] — the final '' must not show as a blank row.
    const rows = computeUnifiedDiff('a\nb\n', 'a\nX\n', ALL);
    expect(rows.map((r) => r.kind)).toEqual(['context', 'del', 'add']); // no trailing context ''
    expect(rows.some((r) => r.kind === 'context' && r.text === '')).toBe(false);
  });
});

describe('diffStat', () => {
  it('counts add / del rows', () => {
    const rows = computeUnifiedDiff('a\nb\nc', 'a\nX\nY\nc', ALL);
    expect(diffStat(rows)).toEqual({ added: 2, removed: 1 });
  });
});

describe('hunkOldRanges', () => {
  it('anchors a pure-add first hunk at old line 0', () => {
    const rows: DiffRow[] = [
      { kind: 'add', newLine: 1, segs: [{ text: 'new1', hi: false }] },
      { kind: 'add', newLine: 2, segs: [{ text: 'new2', hi: false }] },
    ];
    expect(hunkOldRanges(rows)[0]).toEqual({ oldFrom: 0, oldTo: 0 });
  });

  it('uses hidden context before an add-only hunk as the old-side anchor', () => {
    const rows: DiffRow[] = [
      {
        kind: 'gap',
        oldStart: 5,
        oldCount: 0,
        newStart: 6,
        newCount: 1,
        hidden: [
          { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
          { kind: 'context', oldLine: 5, newLine: 5, text: 'e' },
        ],
      },
      { kind: 'add', newLine: 6, segs: [{ text: 'inserted', hi: false }] },
    ];
    expect(hunkOldRanges(rows)[1]).toEqual({ oldFrom: 5, oldTo: 5 });
  });
});
