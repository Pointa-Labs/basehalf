import { describe, expect, it } from 'vitest';
import {
  isConflict,
  parseBranchHeader,
  parseLog,
  parseNameStatus,
  parseStatus,
} from '../src/modules/git/parse.js';

// Build a raw `git log --format=<LOG_FORMAT>` payload the way git emits it: fields
// joined by US (\x1f), each record ended by RS (\x1e) + the tformat trailing \n.
const US = '\x1f';
const RS = '\x1e';
function rec(fields: string[]): string {
  return `${fields.join(US)}${RS}\n`;
}

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

  it('consumes the source field for a Y-column rename/copy (no list mis-alignment)', () => {
    // A rename can land on the Y (work-tree) column too, e.g. " R" — the next NUL
    // field is still the SOURCE. If the parser only checks X it eats the source as
    // the next entry and cascades every following file out of alignment.
    const raw = '## main\0 R new.txt\0old.txt\0 M after.txt\0';
    const r = parseStatus(raw);
    expect(r.files).toEqual([
      { path: 'new.txt', x: ' ', y: 'R', orig: 'old.txt' },
      { path: 'after.txt', x: ' ', y: 'M' }, // stays aligned — not mis-read as the source
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

describe('parseLog (--format with US/RS delimiters)', () => {
  const FIELDS = (over: Partial<Record<string, string>> = {}) => [
    over.hash ?? 'a1b2c3d4e5f6',
    over.short ?? 'a1b2c3d',
    over.parents ?? 'p1p1p1p1',
    over.an ?? 'Ada',
    over.ae ?? 'ada@x.dev',
    over.ad ?? '2026-06-27T10:00:00+00:00',
    over.cn ?? 'Ada',
    over.ce ?? 'ada@x.dev',
    over.cd ?? '2026-06-27T10:00:00+00:00',
    over.dec ?? '',
    over.subject ?? 'Initial work',
    over.body ?? '',
  ];

  it('parses a single commit into structured fields', () => {
    const [c] = parseLog(rec(FIELDS()));
    expect(c).toEqual({
      hash: 'a1b2c3d4e5f6',
      shortHash: 'a1b2c3d',
      parents: ['p1p1p1p1'],
      author: { name: 'Ada', email: 'ada@x.dev', date: '2026-06-27T10:00:00+00:00' },
      committer: { name: 'Ada', email: 'ada@x.dev', date: '2026-06-27T10:00:00+00:00' },
      subject: 'Initial work',
      body: '',
      refs: [],
      tags: [],
      head: false,
    });
  });

  it('parses multiple records in order', () => {
    const raw = rec(FIELDS({ hash: 'c1', short: 'c1' })) + rec(FIELDS({ hash: 'c2', short: 'c2' }));
    expect(parseLog(raw).map((c) => c.hash)).toEqual(['c1', 'c2']);
  });

  it('splits multiple parents (a merge) and empties (a root commit)', () => {
    expect(parseLog(rec(FIELDS({ parents: 'aaa bbb' })))[0].parents).toEqual(['aaa', 'bbb']);
    expect(parseLog(rec(FIELDS({ parents: '' })))[0].parents).toEqual([]);
  });

  it('normalizes %D decorations: HEAD arrow, remote, and tag (tags split out)', () => {
    const c = parseLog(rec(FIELDS({ dec: 'HEAD -> main, origin/main, tag: v1.0' })))[0];
    expect(c.head).toBe(true);
    expect(c.refs).toEqual(['main', 'origin/main']);
    expect(c.tags).toEqual(['v1.0']);
  });

  it('handles a detached HEAD decoration (bare HEAD, no branch ref)', () => {
    const c = parseLog(rec(FIELDS({ dec: 'HEAD, origin/main' })))[0];
    expect(c.head).toBe(true);
    expect(c.refs).toEqual(['origin/main']);
  });

  it('keeps a subject containing spaces, "..." and a multi-line body intact', () => {
    const c = parseLog(rec(FIELDS({ subject: 'fix: a...b spacing', body: 'line1\nline2' })))[0];
    expect(c.subject).toBe('fix: a...b spacing');
    expect(c.body).toBe('line1\nline2');
  });

  it('empty output → no commits; a short/corrupt record is skipped', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog(`onlytwo${US}fields${RS}\n`)).toEqual([]);
  });
});

describe('parseNameStatus (diff-tree --name-status -r -z)', () => {
  it('parses adds/modifies/deletes', () => {
    expect(parseNameStatus('A\0new.ts\0M\0mod.ts\0D\0gone.ts\0')).toEqual([
      { path: 'new.ts', status: 'A' },
      { path: 'mod.ts', status: 'M' },
      { path: 'gone.ts', status: 'D' },
    ]);
  });

  it('consumes the source path for a rename/copy (status carries similarity)', () => {
    const r = parseNameStatus('R100\0old.ts\0new.ts\0C75\0src.ts\0copy.ts\0M\0after.ts\0');
    expect(r).toEqual([
      { path: 'new.ts', status: 'R', orig: 'old.ts' },
      { path: 'copy.ts', status: 'C', orig: 'src.ts' },
      { path: 'after.ts', status: 'M' }, // stays aligned after the two-path entries
    ]);
  });

  it('empty → no files', () => {
    expect(parseNameStatus('')).toEqual([]);
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
