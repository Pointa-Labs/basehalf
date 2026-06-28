import { describe, expect, it } from 'vitest';
import type { GitGroups } from '../src/workbench/contrib/scm/browser/gitStatusModel.js';
import { sourceControlViewModel } from '../src/workbench/contrib/scm/browser/sourceControlViewModel.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

const emptyGroups: GitGroups = { merge: [], staged: [], changes: [] };

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

describe('sourceControlViewModel', () => {
  it('enables the commit action with staged changes and leaves message validation to command handling', () => {
    const stagedGroups: GitGroups = {
      ...emptyGroups,
      staged: [{ path: 'a.md', status: 'M', staged: true }],
    };

    expect(sourceControlViewModel(status(), stagedGroups, 'Ship it', false)).toMatchObject({
      count: 1,
      hasStaged: true,
      hasCommitMessage: true,
      canCommit: true,
      canCommitAmend: true,
      commitBranch: 'main',
    });

    expect(sourceControlViewModel(status(), stagedGroups, '  ', false)).toMatchObject({
      canCommit: true,
      hasCommitMessage: false,
    });
    expect(sourceControlViewModel(status(), emptyGroups, 'Amend', false)).toMatchObject({
      canCommit: false,
      canCommitAmend: true,
    });
    expect(
      sourceControlViewModel(status({ detached: true, branch: null }), emptyGroups, 'Amend', false),
    ).toMatchObject({
      canCommit: false,
      canCommitAmend: false,
    });
    expect(sourceControlViewModel(status(), stagedGroups, 'Ship it', true)).toMatchObject({
      canCommit: false,
      canCommitAmend: false,
    });
  });

  it('publishes an attached branch without upstream and disables pull-only UI actions', () => {
    expect(
      sourceControlViewModel(status({ upstream: null }), emptyGroups, '', false),
    ).toMatchObject({
      canPublish: true,
      canPull: false,
      canSync: false,
    });
    expect(
      sourceControlViewModel(status({ upstream: 'origin/main' }), emptyGroups, '', false),
    ).toMatchObject({ canPublish: false, canPull: true, canSync: false });
    expect(
      sourceControlViewModel(status({ upstream: 'origin/main', ahead: 1 }), emptyGroups, '', false),
    ).toMatchObject({ canPublish: false, canPull: true, canSync: true });
    expect(
      sourceControlViewModel(status({ detached: true, branch: null }), emptyGroups, '', false),
    ).toMatchObject({ canPublish: false, canPull: false, commitBranch: 'detached' });
  });
});
