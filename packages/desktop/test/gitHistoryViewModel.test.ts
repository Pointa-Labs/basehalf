import { describe, expect, it } from 'vitest';
import {
  gitHistoryLogArgsForAvailableFilter,
  gitHistoryLogArgsForFilter,
  gitHistoryOptionsForAvailableFilter,
  gitHistoryOptionsForFilter,
  loadGitHistoryLocalBranches,
  loadGitHistoryPage,
} from '../src/workbench/contrib/scm/browser/gitHistoryViewModel.js';
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

describe('gitHistoryViewModel', () => {
  it('maps UI filters to Git provider options and git log args', () => {
    expect(gitHistoryOptionsForFilter({ kind: 'all' }, 50, 10)).toEqual({
      historyItemRefs: ['HEAD'],
      limit: 50,
      skip: 10,
    });
    expect(gitHistoryOptionsForFilter({ kind: 'auto' }, 50, 10)).toEqual({
      historyItemRefs: ['HEAD'],
      limit: 50,
      skip: 10,
    });
    expect(gitHistoryOptionsForFilter({ kind: 'ref', ref: 'refs/heads/main' }, 50, 10)).toEqual({
      historyItemRefs: ['refs/heads/main'],
      limit: 50,
      skip: 10,
    });
    expect(
      gitHistoryOptionsForFilter(
        { kind: 'refs', refs: ['refs/heads/main', 'refs/remotes/origin/main'] },
        50,
        10,
      ),
    ).toEqual({
      historyItemRefs: ['refs/heads/main', 'refs/remotes/origin/main'],
      limit: 50,
      skip: 10,
    });

    expect(gitHistoryLogArgsForFilter({ kind: 'all' }, 50, 10)).toEqual({
      ref: 'HEAD',
      maxCount: 50,
      skip: 10,
    });
    expect(
      gitHistoryLogArgsForAvailableFilter({
        filter: { kind: 'all' },
        refs: [
          ref('refs/heads/main', 'main', 'head'),
          ref('refs/remotes/origin/main', 'origin/main', 'remoteHead'),
        ],
        pageSize: 50,
        skip: 0,
      }),
    ).toEqual({
      refNames: ['refs/heads/main', 'refs/remotes/origin/main'],
      maxCount: 50,
      skip: 0,
    });
    expect(
      gitHistoryLogArgsForFilter(
        { kind: 'refs', refs: ['refs/heads/main', 'refs/remotes/origin/main'] },
        50,
        10,
      ),
    ).toEqual({
      refNames: ['refs/heads/main', 'refs/remotes/origin/main'],
      maxCount: 50,
      skip: 10,
    });
  });

  it('falls back to HEAD provider options when a selected ref disappeared', () => {
    const refs = [ref('refs/heads/main', 'main', 'head')];

    expect(
      gitHistoryOptionsForAvailableFilter({
        filter: { kind: 'ref', ref: 'refs/heads/deleted' },
        refs,
        pageSize: 20,
        skip: 0,
      }),
    ).toEqual({ historyItemRefs: ['HEAD'], limit: 20, skip: 0 });
    expect(
      gitHistoryLogArgsForAvailableFilter({
        filter: { kind: 'refs', refs: ['refs/heads/main', 'refs/heads/deleted'] },
        refs,
        pageSize: 20,
        skip: 5,
      }),
    ).toEqual({ ref: 'refs/heads/main', maxCount: 20, skip: 5 });
  });

  it('normalizes old bare branch-name filters against available refs', () => {
    const refs = [
      ref('refs/heads/798', '798', 'head'),
      ref('refs/heads/deadbee', 'deadbee', 'head'),
    ];

    expect(
      gitHistoryOptionsForAvailableFilter({
        filter: { kind: 'ref', ref: '798' },
        refs,
        pageSize: 20,
        skip: 0,
      }),
    ).toEqual({ historyItemRefs: ['refs/heads/798'], limit: 20, skip: 0 });
    expect(
      gitHistoryLogArgsForAvailableFilter({
        filter: { kind: 'ref', ref: 'deadbee' },
        refs,
        pageSize: 20,
        skip: 5,
      }),
    ).toEqual({ ref: 'refs/heads/deadbee', maxCount: 20, skip: 5 });
  });

  it('uses explicit provider refs for selected local, remote, and tag filters', () => {
    const refs: GitRefInfo[] = [
      {
        id: 'refs/heads/798',
        name: '798',
        type: 'head',
        current: true,
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      {
        id: 'refs/remotes/origin/798',
        name: 'origin/798',
        type: 'remoteHead',
        current: false,
        commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        id: 'refs/tags/v798',
        name: 'v798',
        type: 'tag',
        current: false,
        commit: 'cccccccccccccccccccccccccccccccccccccccc',
      },
    ];

    expect(
      gitHistoryLogArgsForAvailableFilter({
        filter: {
          kind: 'refs',
          refs: ['798', 'refs/remotes/origin/798', 'refs/tags/v798'],
        },
        refs,
        pageSize: 20,
        skip: 0,
      }),
    ).toEqual({
      refNames: [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'cccccccccccccccccccccccccccccccccccccccc',
      ],
      maxCount: 20,
      skip: 0,
    });
  });

  it('loads Git graph pages and local branch names through the raw Git source', async () => {
    const refs = [
      ref('refs/heads/main', 'main', 'head'),
      ref('refs/heads/feature/x', 'feature/x', 'head'),
      ref('refs/remotes/origin/main', 'origin/main', 'remoteHead'),
    ];
    const commitOptions: unknown[] = [];
    const refArgs: unknown[] = [];
    const source = {
      provideCurrentHistoryItemRefs: async () => ({
        historyItemRef: ref('refs/heads/main', 'main', 'head'),
        historyItemRemoteRef: ref('refs/remotes/origin/main', 'origin/main', 'remoteHead'),
        historyItemBaseRef: {
          id: 'refs/remotes/origin/release',
          name: 'origin/release',
          revision: '1234567',
        },
      }),
      provideGitRefs: async (args?: unknown) => {
        refArgs.push(args);
        return refs;
      },
      provideGitCommits: async (options: unknown) => {
        commitOptions.push(options);
        return [commit('a'), commit('b')];
      },
    };

    await expect(
      loadGitHistoryPage({
        source,
        filter: { kind: 'refs', refs: ['refs/heads/main', 'refs/remotes/origin/main'] },
        pageSize: 3,
        skip: 6,
      }),
    ).resolves.toEqual({ commits: [commit('a'), commit('b')], refs, done: true });
    await expect(loadGitHistoryLocalBranches(source)).resolves.toEqual(
      new Set(['main', 'feature/x']),
    );
    expect(refArgs).toEqual([{ includeRemote: true, includeTags: true }, { includeRemote: true }]);
    expect(commitOptions).toEqual([
      {
        historyItemRefs: ['refs/heads/main', 'refs/remotes/origin/main'],
        limit: 3,
        skip: 6,
      },
    ]);

    await loadGitHistoryPage({
      source,
      filter: { kind: 'auto' },
      pageSize: 2,
      skip: 0,
    });
    expect(commitOptions.at(-1)).toEqual({
      historyItemRefs: ['refs/heads/main', 'refs/remotes/origin/main', '1234567'],
      limit: 2,
      skip: 0,
    });

    source.provideCurrentHistoryItemRefs = async () => ({
      historyItemRef: {
        id: 'refs/heads/topic',
        name: 'topic',
        revision: 'topic^2',
      },
    });
    await loadGitHistoryPage({
      source,
      filter: { kind: 'auto' },
      pageSize: 2,
      skip: 0,
    });
    expect(commitOptions.at(-1)).toEqual({
      historyItemRefs: ['topic^2'],
      limit: 2,
      skip: 0,
    });

    await loadGitHistoryPage({
      source,
      filter: { kind: 'all' },
      pageSize: 2,
      skip: 0,
    });
    expect(commitOptions.at(-1)).toEqual({
      historyItemRefs: ['refs/heads/main', 'refs/heads/feature/x', 'refs/remotes/origin/main'],
      limit: 2,
      skip: 0,
    });
  });
});
