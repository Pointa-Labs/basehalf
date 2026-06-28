import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../src/workbench/contrib/scm/browser/gitGraphLayout.js';
import {
  FULL_GRAPH_ROW_HEIGHT,
  fullGraphCommitMatches,
  fullGraphFormatDate,
  fullGraphFormatRelativeDate,
  fullGraphFormatWhen,
  fullGraphInjectStashes,
  fullGraphLaneColor,
  fullGraphLaneX,
  fullGraphPaths,
} from '../src/workbench/contrib/scm/browser/gitGraphViewModel.js';
import type { GitCommit, GitStashEntry } from '../src/workbench/contrib/scm/common/git.js';

const commit = (
  hash: string,
  parents: readonly string[] = [],
  props: Partial<GitCommit> = {},
): GitCommit => ({
  hash,
  shortHash: hash.slice(0, 7),
  parents,
  author: { name: 'Ada', email: 'ada@example.com', date: '2024-01-15T14:30:00Z' },
  committer: { name: 'Ada', email: 'ada@example.com', date: '2024-01-15T14:30:00Z' },
  subject: hash,
  body: '',
  refs: [],
  tags: [],
  head: false,
  ...props,
});

const stash = (props: Partial<GitStashEntry> = {}): GitStashEntry => ({
  ref: 'stash@{0}',
  message: 'WIP on main',
  hash: 'stashsha',
  parents: ['base'],
  date: '2024-01-16T10:00:00Z',
  authorName: 'Ada',
  authorEmail: 'ada@example.com',
  ...props,
});

describe('gitGraphViewModel', () => {
  it('matches commit search by subject or short hash', () => {
    const c = commit('abc123456789', [], { shortHash: 'abc1234', subject: 'Fix login' });

    expect(fullGraphCommitMatches(c, 'login')).toBe(true);
    expect(fullGraphCommitMatches(c, 'ABC123')).toBe(true);
    expect(fullGraphCommitMatches(c, '')).toBe(false);
  });

  it('injects stash commits before their base and preserves missing-base stashes', () => {
    const base = commit('base');
    const tip = commit('tip', ['base']);
    const missing = stash({ ref: 'stash@{1}', hash: 'orphanstash', parents: ['missing'] });

    const model = fullGraphInjectStashes([tip, base], [stash(), missing]);

    expect(model.graphCommits.map((c) => c.hash)).toEqual([
      'orphanstash',
      'tip',
      'stashsha',
      'base',
    ]);
    expect(model.stashByHash.get('stashsha')?.ref).toBe('stash@{0}');
    expect(model.stashByHash.get('orphanstash')?.ref).toBe('stash@{1}');
  });

  it('builds graph paths with the uncommitted connector attached to HEAD', () => {
    const { rows } = layoutGraph([commit('head', ['base'], { head: true }), commit('base')]);

    const paths = fullGraphPaths(rows, { rowOffset: 1, hasUncommitted: true });

    expect(paths).toContainEqual({
      d: `M ${fullGraphLaneX(0)} ${FULL_GRAPH_ROW_HEIGHT / 2} L ${fullGraphLaneX(0)} ${
        FULL_GRAPH_ROW_HEIGHT + FULL_GRAPH_ROW_HEIGHT / 2
      }`,
      c: '#808080',
    });
  });

  it('formats absolute and relative dates from the model layer', () => {
    expect(fullGraphFormatDate('2024-01-15T14:30:00Z')).toMatch(/15 Jan 2024/);
    expect(
      fullGraphFormatRelativeDate('2024-01-15T13:30:00Z', Date.parse('2024-01-15T14:30:00Z')),
    ).toBe('1 hour ago');
    expect(fullGraphFormatWhen('bad-date', 'absolute')).toBe('');
  });

  it('cycles lane colors defensively', () => {
    expect(fullGraphLaneColor(0)).toBe('#0085d9');
    expect(fullGraphLaneColor(-1)).toBe('#6f24d6');
  });
});
