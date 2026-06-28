import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pick } from '../src/workbench/browser/parts/dialogs/Dialog.js';
import { toast } from '../src/workbench/browser/parts/notifications/toastStore.js';
import type { BranchGitAdapter } from '../src/workbench/contrib/scm/browser/branchGitAdapter.js';
import { openBranchQuickPick } from '../src/workbench/contrib/scm/browser/branchQuickPickCommands.js';
import type { GitRefInfo, GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

vi.mock('../src/workbench/browser/parts/dialogs/Dialog.js', () => ({
  confirm: vi.fn(),
  pick: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock('../src/workbench/browser/parts/notifications/toastStore.js', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const status: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
};

const ref = (id: string, name: string, type: GitRefInfo['type'], current = false): GitRefInfo => ({
  id,
  name,
  type,
  current,
});

describe('branchQuickPickCommands', () => {
  beforeEach(() => {
    vi.mocked(pick).mockReset();
    vi.mocked(toast.info).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('merges the selected ref name instead of the quick-pick id', async () => {
    const calls: string[] = [];
    const adapter: BranchGitAdapter = {
      listRefs: async () => ({
        current: 'main',
        refs: [
          ref('refs/heads/main', 'main', 'head', true),
          ref('refs/heads/feature/scm', 'feature/scm', 'head'),
          ref('refs/remotes/origin/main', 'origin/main', 'remoteHead'),
          ref('refs/tags/v1.0', 'v1.0', 'tag'),
        ],
      }),
      checkout: vi.fn(),
      createBranch: vi.fn(),
      deleteBranch: vi.fn(),
      renameCurrent: vi.fn(),
      merge: async (branch) => {
        calls.push(`merge:${branch}`);
        return { merged: true, conflicts: false, stdout: '', stderr: '' };
      },
      stash: vi.fn(),
      stashPop: vi.fn(),
    };

    vi.mocked(pick)
      .mockResolvedValueOnce('cmd:merge')
      .mockResolvedValueOnce('refs/heads/feature/scm');

    await openBranchQuickPick({
      status,
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(calls).toEqual(['merge:feature/scm', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Merged feature/scm.');
  });
});
