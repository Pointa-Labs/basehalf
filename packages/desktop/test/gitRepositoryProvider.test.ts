import { describe, expect, it } from 'vitest';
import {
  gitRepositoryGroups,
  gitRepositoryProviderModel,
} from '../src/workbench/contrib/scm/browser/gitRepositoryProvider.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true,
    branch: 'main',
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    ...overrides,
  };
}

describe('gitRepositoryProvider', () => {
  it('returns empty resource groups while loading or outside a repository', () => {
    expect(gitRepositoryProviderModel(null, '', false)).toMatchObject({
      loading: true,
      isRepository: false,
      groups: { merge: [], staged: [], changes: [] },
      view: null,
    });

    expect(gitRepositoryProviderModel(status({ isRepo: false }), '', false)).toMatchObject({
      loading: false,
      isRepository: false,
      groups: { merge: [], staged: [], changes: [] },
      view: null,
    });
  });

  it('projects git status into SCM resource groups and input/action state', () => {
    const repo = status({
      files: [
        { path: 'staged.md', x: 'A', y: ' ' },
        { path: 'dirty.md', x: ' ', y: 'M' },
        { path: 'both.md', x: 'M', y: 'M' },
        { path: 'conflict.md', x: 'U', y: 'U' },
      ],
    });
    const groups = gitRepositoryGroups(repo);
    const provider = gitRepositoryProviderModel(repo, 'Ship', false, groups);

    expect(provider.loading).toBe(false);
    expect(provider.isRepository).toBe(true);
    expect(provider.groups.staged.map((row) => row.path)).toEqual(['staged.md', 'both.md']);
    expect(provider.groups.changes.map((row) => row.path)).toEqual(['dirty.md', 'both.md']);
    expect(provider.groups.merge.map((row) => row.path)).toEqual(['conflict.md']);
    expect(provider.view).toMatchObject({
      count: 5,
      hasStaged: true,
      hasCommitMessage: true,
      canCommit: true,
      canCommitAmend: true,
      canPublish: true,
      commitBranch: 'main',
    });
  });

  it('reflects busy and detached branch state in the provider view', () => {
    expect(
      gitRepositoryProviderModel(status({ branch: null, detached: true }), 'Amend', true).view,
    ).toMatchObject({
      canCommit: false,
      canCommitAmend: false,
      canPublish: false,
      commitBranch: 'detached',
    });
  });
});
