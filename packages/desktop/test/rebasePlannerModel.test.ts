import { describe, expect, it } from 'vitest';
import {
  canUseRebaseAction,
  commitsToRebaseRows,
  keptRebaseRowCount,
  moveRebaseRow,
  normalizeRebaseRows,
  rebasePlanItems,
  rewordRebaseRow,
  setRebaseRowAction,
} from '../src/workbench/contrib/scm/browser/rebasePlannerModel.js';
import type { GitCommit } from '../src/workbench/contrib/scm/common/git.js';

const commit = (hash: string, subject = hash): GitCommit => ({
  hash,
  shortHash: hash.slice(0, 7),
  parents: [],
  author: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T01:02:03Z' },
  committer: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T01:02:03Z' },
  subject,
  body: '',
  refs: [],
  tags: [],
  head: false,
});

describe('rebasePlannerModel', () => {
  it('converts git log order into rebase replay order', () => {
    expect(
      commitsToRebaseRows([commit('new'), commit('old')]).map((row) => row.commit.hash),
    ).toEqual(['old', 'new']);
  });

  it('updates row actions, movement, kept count, and backend items', () => {
    let rows = commitsToRebaseRows([commit('three'), commit('two'), commit('one')]);

    rows = setRebaseRowAction(rows, 1, 'drop');
    rows = rewordRebaseRow(rows, 2, 'Renamed');
    rows = moveRebaseRow(rows, 2, -1);

    expect(rows.map((row) => `${row.commit.hash}:${row.action}`)).toEqual([
      'one:pick',
      'three:reword',
      'two:drop',
    ]);
    expect(keptRebaseRowCount(rows)).toBe(2);
    expect(rebasePlanItems(rows)).toEqual([
      { sha: 'one', action: 'pick' },
      { sha: 'three', action: 'reword', message: 'Renamed' },
      { sha: 'two', action: 'drop' },
    ]);
  });

  it('prevents fixup rows before any kept commit', () => {
    let rows = commitsToRebaseRows([commit('three'), commit('two'), commit('one')]);

    expect(canUseRebaseAction(rows, 0, 'fixup')).toBe(false);
    expect(canUseRebaseAction(rows, 1, 'fixup')).toBe(true);

    rows = setRebaseRowAction(rows, 0, 'fixup');
    expect(rows[0]?.action).toBe('pick');

    const unsafeRows = [
      { commit: commit('one'), action: 'drop' as const },
      { commit: commit('two'), action: 'fixup' as const },
      { commit: commit('three'), action: 'fixup' as const },
    ];
    expect(normalizeRebaseRows(unsafeRows).map((row) => row.action)).toEqual([
      'drop',
      'pick',
      'fixup',
    ]);
    expect(rebasePlanItems(unsafeRows)).toEqual([
      { sha: 'one', action: 'drop' },
      { sha: 'two', action: 'pick' },
      { sha: 'three', action: 'fixup' },
    ]);
  });
});
