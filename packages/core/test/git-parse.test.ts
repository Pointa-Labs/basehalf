import { describe, expect, it } from 'vitest';
import { isConflict, parseBranchHeader, parseStatus } from '../src/modules/git/parse.js';

describe('parseBranchHeader', () => {
  it('plain branch, no upstream', () => {
    expect(parseBranchHeader('main')).toEqual({
      branch: 'main',
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
    });
  });

  it('upstream, in sync', () => {
    expect(parseBranchHeader('main...origin/main')).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
    });
  });

  it('ahead + behind', () => {
    expect(parseBranchHeader('main...origin/main [ahead 2, behind 3]')).toMatchObject({
      ahead: 2,
      behind: 3,
      upstream: 'origin/main',
    });
  });

  it('ahead only / behind only', () => {
    expect(parseBranchHeader('feat...origin/feat [ahead 1]')).toMatchObject({
      ahead: 1,
      behind: 0,
    });
    expect(parseBranchHeader('feat...origin/feat [behind 5]')).toMatchObject({
      ahead: 0,
      behind: 5,
    });
  });

  it('upstream gone → no counts', () => {
    expect(parseBranchHeader('main...origin/main [gone]')).toMatchObject({
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
    });
  });

  it('detached HEAD', () => {
    expect(parseBranchHeader('HEAD (no branch)')).toMatchObject({ branch: null, detached: true });
  });

  it('unborn — no commits yet', () => {
    expect(parseBranchHeader('No commits yet on main')).toMatchObject({
      branch: 'main',
      detached: false,
      upstream: null,
    });
  });
});

describe('parseStatus (porcelain v1 -z --branch)', () => {
  it('parses the full XY matrix incl. rename + untracked (real git bytes)', () => {
    // Captured verbatim from `git status --porcelain=v1 -z --branch`.
    const raw =
      '## main\0 D del.txt\0R  renamed-to.txt\0renamed-from.txt\0A  staged.txt\0 M tracked.txt\0?? untracked.txt\0';
    const r = parseStatus(raw);
    expect(r.branch).toBe('main');
    expect(r.files).toEqual([
      { path: 'del.txt', x: ' ', y: 'D' }, // unstaged delete
      { path: 'renamed-to.txt', x: 'R', y: ' ', orig: 'renamed-from.txt' }, // staged rename
      { path: 'staged.txt', x: 'A', y: ' ' }, // staged add
      { path: 'tracked.txt', x: ' ', y: 'M' }, // unstaged modify
      { path: 'untracked.txt', x: '?', y: '?' }, // untracked
    ]);
  });

  it('reads ahead/behind from the branch header', () => {
    const r = parseStatus('## main...origin/main [ahead 1, behind 2]\0 M a.txt\0');
    expect(r).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2 });
    expect(r.files).toEqual([{ path: 'a.txt', x: ' ', y: 'M' }]);
  });

  it('keeps a file with BOTH staged and unstaged changes (XY both set)', () => {
    expect(parseStatus('## main\0MM both.txt\0').files).toEqual([
      { path: 'both.txt', x: 'M', y: 'M' },
    ]);
  });

  it('unborn repo with only untracked files', () => {
    const r = parseStatus('## No commits yet on main\0?? a.txt\0');
    expect(r.branch).toBe('main');
    expect(r.files).toEqual([{ path: 'a.txt', x: '?', y: '?' }]);
  });

  it('clean tree → header only, no files', () => {
    const r = parseStatus('## main...origin/main\0');
    expect(r.files).toEqual([]);
    expect(r.upstream).toBe('origin/main');
  });
});

describe('isConflict', () => {
  it('flags unmerged XY pairs', () => {
    for (const [x, y] of [
      ['U', 'U'],
      ['A', 'A'],
      ['D', 'D'],
      ['A', 'U'],
      ['U', 'D'],
    ]) {
      expect(isConflict(x, y)).toBe(true);
    }
  });

  it('does not flag ordinary staged/unstaged/untracked', () => {
    for (const [x, y] of [
      [' ', 'M'],
      ['M', ' '],
      ['A', ' '],
      ['?', '?'],
      ['R', ' '],
    ]) {
      expect(isConflict(x, y)).toBe(false);
    }
  });
});
