import type { GitFileStatus } from '@basehalf/core';
import { describe, expect, it } from 'vitest';
import { classifyStatus, totalChangeCount } from '../src/renderer/src/lib/gitStatus.js';

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
