import { describe, expect, it } from 'vitest';
import { findConflicts, resolveConflict } from '../src/renderer/src/lib/mergeConflict.js';

const TEXT = [
  'line 1',
  '<<<<<<< HEAD',
  'ours A',
  'ours B',
  '=======',
  'theirs X',
  '>>>>>>> branch',
  'line 8',
].join('\n');

describe('findConflicts', () => {
  it('finds a conflict block by its three marker lines', () => {
    expect(findConflicts(TEXT)).toEqual([{ startLine: 2, sepLine: 5, endLine: 7 }]);
  });

  it('no markers → empty', () => {
    expect(findConflicts('a\nb\nc')).toEqual([]);
  });

  it('ignores a stray ======= outside a conflict (a Markdown rule)', () => {
    expect(findConflicts('Title\n=======\nbody')).toEqual([]);
  });

  it('finds two conflicts', () => {
    const t = '<<<<<<< a\n1\n=======\n2\n>>>>>>> a\nx\n<<<<<<< b\n3\n=======\n4\n>>>>>>> b';
    const r = findConflicts(t);
    expect(r).toEqual([
      { startLine: 1, sepLine: 3, endLine: 5 },
      { startLine: 7, sepLine: 9, endLine: 11 },
    ]);
  });
});

describe('resolveConflict', () => {
  const block = { startLine: 2, sepLine: 5, endLine: 7 };

  it('current → ours, markers stripped', () => {
    expect(resolveConflict(TEXT, block, 'current')).toBe('ours A\nours B');
  });

  it('incoming → theirs', () => {
    expect(resolveConflict(TEXT, block, 'incoming')).toBe('theirs X');
  });

  it('both → ours then theirs', () => {
    expect(resolveConflict(TEXT, block, 'both')).toBe('ours A\nours B\ntheirs X');
  });
});
