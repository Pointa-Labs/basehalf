import { describe, expect, it } from 'vitest';
import type { GitFileStatus } from '../src/workbench/contrib/scm/common/git.js';
import {
  buildFolderStatus,
  classifyStatus,
  fileDecoration,
  statusTooltip,
  totalChangeCount,
} from '../src/workbench/contrib/scm/common/gitStatusModel.js';

const PAL = {
  added: 'green',
  modified: 'amber',
  deleted: 'red',
  conflict: 'purple',
  renamed: 'blue',
  untracked: 'teal',
};

const f = (path: string, x: string, y: string, orig?: string): GitFileStatus =>
  orig === undefined ? { path, x, y } : { path, x, y, orig };

describe('classifyStatus', () => {
  it('splits staged / unstaged / untracked into groups', () => {
    const g = classifyStatus([
      f('staged.ts', 'A', ' '), // staged add
      f('edited.ts', ' ', 'M'), // unstaged modify
      f('new.ts', '?', '?'), // untracked
    ]);
    expect(g.staged.map((r) => r.path)).toEqual(['staged.ts']);
    expect(g.changes.map((r) => r.path)).toEqual(['edited.ts', 'new.ts']);
    expect(g.merge).toEqual([]);
    expect(g.changes.find((r) => r.path === 'new.ts')?.untracked).toBe(true);
  });

  it('a file with BOTH staged and unstaged edits shows in both groups', () => {
    const g = classifyStatus([f('both.ts', 'M', 'M')]);
    expect(g.staged.map((r) => r.path)).toEqual(['both.ts']);
    expect(g.changes.map((r) => r.path)).toEqual(['both.ts']);
    expect(g.staged[0]?.status).toBe('M');
    expect(g.staged[0]?.staged).toBe(true);
    expect(g.changes[0]?.staged).toBe(false);
  });

  it('routes conflicts (unmerged) to the merge group', () => {
    const g = classifyStatus([f('both-edit.ts', 'U', 'U'), f('both-add.ts', 'A', 'A')]);
    expect(g.merge.map((r) => r.path)).toEqual(['both-edit.ts', 'both-add.ts']);
    expect(g.merge.every((r) => r.conflict)).toBe(true);
    expect(g.staged).toEqual([]);
    expect(g.changes).toEqual([]);
  });

  it('keeps a staged rename with its source path', () => {
    const g = classifyStatus([f('to.ts', 'R', ' ', 'from.ts')]);
    expect(g.staged[0]).toMatchObject({ path: 'to.ts', status: 'R', orig: 'from.ts' });
  });

  it('totalChangeCount sums all three groups', () => {
    const g = classifyStatus([f('a.ts', 'M', 'M'), f('b.ts', '?', '?'), f('c.ts', 'U', 'U')]);
    // a → staged + changes (2 rows), b → changes (1), c → merge (1) = 4
    expect(totalChangeCount(g)).toBe(4);
  });
});

describe('fileDecoration (single-file letter + color for tree / canvas)', () => {
  it('unstaged modify → M, modified color', () => {
    expect(fileDecoration(f('a', ' ', 'M'), PAL)).toEqual({
      letter: 'M',
      color: 'amber',
      strikeThrough: false,
    });
  });
  it('staged add → A, added color', () => {
    expect(fileDecoration(f('a', 'A', ' '), PAL)).toEqual({
      letter: 'A',
      color: 'green',
      strikeThrough: false,
    });
  });
  it('untracked → U, untracked color', () => {
    expect(fileDecoration(f('a', '?', '?'), PAL)).toEqual({
      letter: 'U',
      color: 'teal',
      strikeThrough: false,
    });
  });
  it('deleted → D, deleted color, struck through', () => {
    expect(fileDecoration(f('a', ' ', 'D'), PAL)).toEqual({
      letter: 'D',
      color: 'red',
      strikeThrough: true,
    });
  });
  it('staged rename → R, renamed color', () => {
    expect(fileDecoration(f('a', 'R', ' ', 'b'), PAL)).toEqual({
      letter: 'R',
      color: 'blue',
      strikeThrough: false,
    });
  });
  it('conflict → !, conflict color', () => {
    expect(fileDecoration(f('a', 'U', 'U'), PAL)).toEqual({
      letter: '!',
      color: 'purple',
      strikeThrough: false,
    });
  });
  it('prefers the work-tree status over the staged one (MM → M)', () => {
    expect(fileDecoration(f('a', 'M', 'M'), PAL).letter).toBe('M');
  });
});

describe('statusTooltip (human label)', () => {
  it('names each state in plain words', () => {
    expect(statusTooltip(f('a', ' ', 'M'))).toBe('Modified');
    expect(statusTooltip(f('a', '?', '?'))).toBe('Untracked');
    expect(statusTooltip(f('a', ' ', 'D'))).toBe('Deleted');
    expect(statusTooltip(f('a', 'U', 'U'))).toBe('Conflict');
  });
  it('distinguishes a staged-only change', () => {
    expect(statusTooltip(f('a', 'A', ' '))).toBe('Staged: Added');
    expect(statusTooltip(f('a', 'M', ' '))).toBe('Staged: Modified');
  });
});

describe('buildFolderStatus (propagate child status up the tree)', () => {
  it('marks every ancestor of a changed file', () => {
    const m = buildFolderStatus([f('src/app/main.ts', ' ', 'M')]);
    expect([...m.keys()].sort()).toEqual(['src', 'src/app']);
    expect(m.get('src')?.path).toBe('src/app/main.ts');
  });
  it('does NOT propagate a deletion', () => {
    const m = buildFolderStatus([f('src/gone.ts', ' ', 'D')]);
    expect(m.size).toBe(0);
  });
  it('a conflict outranks a plain edit for the folder mark', () => {
    const m = buildFolderStatus([f('src/a.ts', ' ', 'M'), f('src/b.ts', 'U', 'U')]);
    expect(statusTooltip(m.get('src') as GitFileStatus)).toBe('Conflict');
  });
  it('handles an untracked dir reported as "dir/"', () => {
    const m = buildFolderStatus([f('src/new/', '?', '?')]);
    expect([...m.keys()]).toEqual(['src']); // the leaf "new" is the node itself, not an ancestor
  });
});
