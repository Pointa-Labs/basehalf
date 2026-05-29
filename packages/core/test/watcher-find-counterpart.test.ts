import { describe, expect, it } from 'vitest';
import { findCounterpart } from '../src/modules/watcher/commands.js';
import type { WatcherFsEvent } from '../src/modules/watcher/types.js';

// Fast, deterministic unit tests for the rename-heuristic counterpart
// matcher (no chokidar). The integration tests in watcher.test.ts cover
// the happy 1:1 rename; these pin the AMBIGUITY rule that prevents a
// false-positive rename when several same-dir/same-ext files churn inside
// the window (e.g. a git branch switch) — which would otherwise move the
// wrong badge's prompt/refs onto a new file.

function ev(relPath: string, isDir = false): WatcherFsEvent {
  return { type: 'unlink', relPath, absPath: `/work/${relPath}`, isDir };
}

function buffer(...relPaths: string[]): Map<string, { event: WatcherFsEvent }> {
  const m = new Map<string, { event: WatcherFsEvent }>();
  for (const p of relPaths) m.set(p, { event: ev(p) });
  return m;
}

describe('findCounterpart (rename heuristic)', () => {
  it('pairs a unique same-dir same-ext counterpart', () => {
    const match = findCounterpart(buffer('old.md'), ev('new.md'));
    expect(match?.event.relPath).toBe('old.md');
  });

  it('returns null when TWO candidates match (ambiguous — do not invent a rename)', () => {
    // old.md AND backup.md both deleted in the window, then new.md created.
    // We cannot know which (if either) new.md is a rename of → fall through
    // to the safe orphan-then-materialize path.
    const match = findCounterpart(buffer('old.md', 'backup.md'), ev('new.md'));
    expect(match).toBeNull();
  });

  it('still pairs when the second candidate differs by extension', () => {
    // Only one true candidate (same .md ext); the .txt one is ineligible.
    const match = findCounterpart(buffer('old.md', 'note.txt'), ev('new.md'));
    expect(match?.event.relPath).toBe('old.md');
  });

  it('ignores candidates in a different parent dir', () => {
    const m = new Map<string, { event: WatcherFsEvent }>([
      ['sub/old.md', { event: ev('sub/old.md') }],
    ]);
    expect(findCounterpart(m, ev('new.md'))).toBeNull();
  });

  it('excludes an exact same-path entry (not a rename)', () => {
    expect(findCounterpart(buffer('same.md'), ev('same.md'))).toBeNull();
  });

  it('does not pair a file with a dir of the same name stem', () => {
    const m = new Map<string, { event: WatcherFsEvent }>([
      ['olddir', { event: ev('olddir', true) }],
    ]);
    // incoming is a file; the only candidate is a dir → no match.
    expect(findCounterpart(m, ev('newfile'))).toBeNull();
  });
});
