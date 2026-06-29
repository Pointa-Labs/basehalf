import { describe, expect, it } from 'vitest';
import type { GitCommit, GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';
import {
  fullGraphDisplayRef,
  fullGraphLocalBranches,
  fullGraphRefForDecoration,
  fullGraphRefIndex,
  fullGraphRefKind,
  fullGraphRefsForCommit,
  fullGraphTrackingLocalBranches,
} from '../src/workbench/contrib/scm/common/gitGraphRefIndex.js';

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

const branch = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/heads/${name}`,
  name,
  type: 'head',
  current: false,
  ...props,
});

const remote = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/remotes/${name}`,
  name,
  type: 'remoteHead',
  current: false,
  ...props,
});

describe('gitGraphRefIndex', () => {
  it('keeps local branch names with slashes distinct from remote refs', () => {
    const localBranches = fullGraphLocalBranches([branch('feature/auth'), branch('main')]);

    expect(fullGraphRefKind('feature/auth', localBranches)).toBe('branch');
    expect(fullGraphRefKind('refs/heads/feature/auth', localBranches)).toBe('branch');
    expect(fullGraphRefKind('refs/remotes/origin/main', localBranches)).toBe('remote');
    expect(fullGraphRefKind('origin/main', localBranches)).toBe('remote');
  });

  it('maps remote-tracking refs to their local tracking branches', () => {
    const tracking = fullGraphTrackingLocalBranches([
      branch('main', { upstream: 'origin/main' }),
      branch('feature/auth'),
      remote('origin/main'),
    ]);

    expect(tracking.get('origin/main')).toBe('main');
    expect(tracking.get('refs/remotes/origin/main')).toBe('main');
    expect(tracking.has('origin/feature/auth')).toBe(false);
  });

  it('builds VS Code-style ref models from provider refs', () => {
    const index = fullGraphRefIndex([
      branch('origin/main'),
      branch('main', { upstream: 'origin/main' }),
      remote('origin/main'),
    ]);

    expect(fullGraphRefForDecoration('refs/remotes/origin/main', index)).toEqual({
      name: 'origin/main',
      kind: 'remote',
      targetRef: 'refs/remotes/origin/main',
      trackingLocal: 'main',
    });
    expect(fullGraphRefForDecoration('refs/heads/origin/main', index)).toEqual({
      name: 'origin/main',
      kind: 'branch',
      targetRef: 'refs/heads/origin/main',
    });

    expect(
      fullGraphRefsForCommit(
        commit('tip', [], {
          refs: ['refs/heads/main', 'refs/remotes/origin/main'],
          tags: ['v1.0'],
        }),
        index,
      ).map((ref) => [ref.kind, ref.name, ref.targetRef, ref.trackingLocal]),
    ).toEqual([
      ['branch', 'main', 'refs/heads/main', undefined],
      ['remote', 'origin/main', 'refs/remotes/origin/main', 'main'],
      ['tag', 'v1.0', 'refs/tags/v1.0', undefined],
    ]);
  });

  it('marks active upstream refs and filters remote HEAD pseudo refs', () => {
    const index = fullGraphRefIndex([
      branch('main', { current: true, upstream: 'origin/main' }),
      remote('origin/main'),
      remote('origin/HEAD'),
    ]);

    expect(fullGraphRefForDecoration('refs/remotes/origin/main', index)).toMatchObject({
      name: 'origin/main',
      kind: 'remote',
      targetRef: 'refs/remotes/origin/main',
      trackingLocal: 'main',
      activeRemote: true,
    });
    expect(
      fullGraphRefsForCommit(
        commit('tip', [], {
          refs: ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
        }),
        index,
      ).map((ref) => ref.name),
    ).toEqual(['origin/main']);
  });

  it('formats branch labels and full refs without treating control words as refs', () => {
    expect(fullGraphDisplayRef('refs/heads/798')).toBe('798');
    expect(fullGraphDisplayRef('refs/remotes/origin/main')).toBe('origin/main');
    expect(fullGraphDisplayRef('refs/tags/v1.0')).toBe('v1.0');
  });
});
