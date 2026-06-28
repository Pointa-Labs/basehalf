import { describe, expect, it } from 'vitest';
import { FULL_GRAPH_PAGE_SIZE } from '../src/workbench/contrib/scm/browser/gitGraphViewModel.js';
import {
  fullGraphAvailableLogArgs,
  fullGraphErrorMessage,
  fullGraphHistoryOptionsForSource,
  fullGraphLogArgs,
} from '../src/workbench/contrib/scm/browser/useFullGitGraphHistory.js';
import type { GitCommit, GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';

const commit = (hash: string): GitCommit => ({
  hash,
  shortHash: hash.slice(0, 7),
  parents: [],
  author: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T00:00:00Z' },
  committer: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T00:00:00Z' },
  subject: hash,
  body: '',
  refs: [],
  tags: [],
  head: false,
});

const ref = (id: string, name: string, type: GitRefInfo['type']): GitRefInfo => ({
  id,
  name,
  type,
  current: false,
});

describe('useFullGitGraphHistory provider helpers', () => {
  it('builds VS Code-style history provider log args for all, auto, and ref filters', () => {
    expect(fullGraphLogArgs({ kind: 'all' }, 0)).toEqual({
      ref: 'HEAD',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
    expect(fullGraphLogArgs({ kind: 'auto' }, 10)).toEqual({
      ref: 'HEAD',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 10,
    });
    expect(fullGraphLogArgs({ kind: 'ref', ref: 'refs/heads/feature/scm' }, 80)).toEqual({
      ref: 'refs/heads/feature/scm',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 80,
    });
    expect(
      fullGraphLogArgs(
        { kind: 'refs', refs: ['refs/heads/feature/scm', 'refs/remotes/origin/main'] },
        80,
      ),
    ).toEqual({
      refNames: ['refs/heads/feature/scm', 'refs/remotes/origin/main'],
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 80,
    });
  });

  it('preserves provider load errors for the full graph view', () => {
    expect(fullGraphErrorMessage(new Error('git log failed'))).toBe('git log failed');
    expect(fullGraphErrorMessage('fatal: bad revision')).toBe('fatal: bad revision');
  });

  it('builds HEAD args when the selected full graph ref was removed', () => {
    const refs = [{ id: 'refs/heads/main', name: 'main', type: 'head' as const, current: true }];

    expect(fullGraphAvailableLogArgs({ kind: 'ref', ref: 'refs/heads/deleted' }, refs, 0)).toEqual({
      ref: 'HEAD',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
    expect(
      fullGraphAvailableLogArgs(
        { kind: 'refs', refs: ['refs/heads/main', 'refs/heads/deleted'] },
        refs,
        20,
      ),
    ).toEqual({
      ref: 'refs/heads/main',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 20,
    });
  });

  it('resolves full graph All through provider refs instead of git log --all', () => {
    const refs = [
      { id: 'refs/heads/main', name: 'main', type: 'head' as const, current: true },
      {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        type: 'remoteHead' as const,
        current: false,
      },
    ];

    expect(fullGraphAvailableLogArgs({ kind: 'all' }, refs, 0)).toEqual({
      refNames: ['refs/heads/main', 'refs/remotes/origin/main'],
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
  });

  it('resolves bare numeric branch filters before building full graph log args', () => {
    const refs = [{ id: 'refs/heads/798', name: '798', type: 'head' as const, current: true }];

    expect(fullGraphAvailableLogArgs({ kind: 'ref', ref: '798' }, refs, 0)).toEqual({
      ref: 'refs/heads/798',
      maxCount: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
  });

  it('resolves full graph source filters through current local, remote, and base refs', async () => {
    const refs = [
      ref('refs/heads/feature/scm', 'feature/scm', 'head'),
      ref('refs/remotes/origin/feature/scm', 'origin/feature/scm', 'remoteHead'),
      ref('refs/remotes/origin/main', 'origin/main', 'remoteHead'),
    ];
    const source = {
      provideCurrentHistoryItemRefs: async () => ({
        historyItemRef: {
          id: 'refs/heads/feature/scm',
          name: 'feature/scm',
          revision: '1111111',
        },
        historyItemRemoteRef: {
          id: 'refs/remotes/origin/feature/scm',
          name: 'origin/feature/scm',
          revision: '2222222',
        },
        historyItemBaseRef: {
          id: 'refs/remotes/origin/main',
          name: 'origin/main',
          revision: '3333333',
        },
      }),
      provideGitRefs: async () => refs,
      provideGitCommits: async () => [commit('tip')],
    };

    await expect(
      fullGraphHistoryOptionsForSource({
        source,
        filter: { kind: 'ref', ref: 'refs/heads/deleted' },
        refs,
        skip: 20,
      }),
    ).resolves.toEqual({
      historyItemRefs: ['1111111', '2222222', '3333333'],
      limit: FULL_GRAPH_PAGE_SIZE,
      skip: 20,
    });
  });

  it('falls back to HEAD when the provider has no current history refs', async () => {
    const source = {
      provideCurrentHistoryItemRefs: async () => ({}),
      provideGitRefs: async () => [],
      provideGitCommits: async () => [commit('tip')],
    };

    await expect(
      fullGraphHistoryOptionsForSource({
        source,
        filter: { kind: 'auto' },
        refs: [],
        skip: 0,
      }),
    ).resolves.toEqual({
      historyItemRefs: ['HEAD'],
      limit: FULL_GRAPH_PAGE_SIZE,
      skip: 0,
    });
  });
});
