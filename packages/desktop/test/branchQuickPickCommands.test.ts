import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm, prompt } from '../src/platform/dialogs/browser/dialogService.js';
import { toast } from '../src/platform/notification/browser/notificationService.js';
import { pick, pickWithInputValue } from '../src/platform/quickinput/browser/quickInputService.js';
import type { BranchGitAdapter } from '../src/workbench/contrib/scm/browser/branchGitAdapter.js';
import {
  runCheckoutBranchCommand,
  runDeleteBranchCommand,
  runMergeBranchCommand,
  runRebaseBranchCommand,
  runRenameBranchCommand,
} from '../src/workbench/contrib/scm/browser/branchQuickPickCommands.js';
import {
  type GitCreateBranchArgs,
  GitError,
  GitErrorCodes,
  type GitRefInfo,
} from '../src/workbench/contrib/scm/common/git.js';

vi.mock('../src/platform/dialogs/browser/dialogService.js', () => ({
  confirm: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock('../src/platform/quickinput/browser/quickInputService.js', () => ({
  pick: vi.fn(),
  pickWithInputValue: vi.fn(),
}));

vi.mock('../src/platform/notification/browser/notificationService.js', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const ref = (
  id: string,
  name: string,
  type: GitRefInfo['type'],
  current = false,
  extra: Partial<GitRefInfo> = {},
): GitRefInfo => ({
  id,
  name,
  type,
  current,
  ...(type === 'remoteHead' && name.includes('/')
    ? { remote: name.slice(0, name.indexOf('/')) }
    : {}),
  ...(id.startsWith('refs/tags/') ? { commit: 'abc1234567890' } : {}),
  ...extra,
});

function adapterFor(refs: readonly GitRefInfo[], calls: string[] = []): BranchGitAdapter {
  return {
    listRefs: async () => ({
      current: 'main',
      refs,
    }),
    checkout: async (branch, options) => {
      calls.push(`checkout:${branch}:${JSON.stringify(options ?? {})}`);
    },
    createBranch: async (name, options?: Omit<GitCreateBranchArgs, 'name'>) => {
      calls.push(`create:${name}:${JSON.stringify(options ?? {})}`);
    },
    deleteBranch: async (name, options) => {
      calls.push(`delete:${name}:${JSON.stringify(options ?? {})}`);
    },
    renameCurrent: async (to) => {
      calls.push(`rename:${to}`);
    },
    merge: async (branch) => {
      calls.push(`merge:${branch}`);
      return { merged: true, conflicts: false, stdout: '', stderr: '' };
    },
    rebase: async (branch) => {
      calls.push(`rebase:${branch}`);
      return { ok: true };
    },
    stash: vi.fn(),
    stashPop: vi.fn(),
  };
}

const refs = [
  ref('refs/heads/main', 'main', 'head', true),
  ref('refs/heads/feature/scm', 'feature/scm', 'head'),
  ref('refs/remotes/origin/topic', 'origin/topic', 'remoteHead'),
  ref('refs/tags/v1.0', 'v1.0', 'tag'),
] satisfies readonly GitRefInfo[];

describe('branchQuickPickCommands', () => {
  beforeEach(() => {
    vi.mocked(confirm).mockReset();
    vi.mocked(pick).mockReset();
    vi.mocked(pickWithInputValue).mockReset();
    vi.mocked(prompt).mockReset();
    vi.mocked(toast.info).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('shows the VS Code-style checkout command boundary before refs', async () => {
    const adapter = adapterFor(refs);
    vi.mocked(pickWithInputValue).mockResolvedValueOnce(null);

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: vi.fn(),
    });

    const pickOptions = vi.mocked(pickWithInputValue).mock.calls[0]?.[0];
    const options = pickOptions?.options ?? [];
    expect(pickOptions?.title).toBe('Checkout Branch/Tag');
    expect(options.map((option) => option.label)).toEqual([
      'Create Branch...',
      'Create Branch From...',
      'Checkout Detached...',
      'main',
      'feature/scm',
      'origin/topic',
      'v1.0',
    ]);
    expect(options.map((option) => option.label)).not.toContain('Merge into Current Branch...');
    expect(options.map((option) => option.label)).not.toContain('Rename Current Branch...');
    expect(options.map((option) => option.label)).not.toContain('Delete Branch...');
  });

  it('checks out a remote ref with tracking and refreshes after checkout', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({
      value: 'refs/remotes/origin/topic',
      inputValue: '',
    });

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(calls).toEqual(['checkout:origin/topic:{"track":true}', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Checked out origin/topic.');
  });

  it('merges a selected branch or tag through the branch submenu command', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pick).mockResolvedValueOnce('refs/remotes/origin/topic');

    await runMergeBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    const pickOptions = vi.mocked(pick).mock.calls[0]?.[0];
    expect(pickOptions?.title).toBe('Merge');
    expect(pickOptions?.options.map((option) => option.value)).toEqual([
      'refs/heads/feature/scm',
      'refs/remotes/origin/topic',
      'refs/tags/v1.0',
    ]);
    expect(calls).toEqual(['merge:origin/topic', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Merged origin/topic.');
  });

  it('rebases onto the selected branch with the upstream item first', async () => {
    const calls: string[] = [];
    const rebaseRefs = [
      ref('refs/heads/main', 'main', 'head', true, { upstream: 'origin/main' }),
      ref('refs/heads/feature/scm', 'feature/scm', 'head'),
      ref('refs/remotes/origin/main', 'origin/main', 'remoteHead'),
      ref('refs/remotes/origin/topic', 'origin/topic', 'remoteHead'),
      ref('refs/tags/v1.0', 'v1.0', 'tag'),
    ] satisfies readonly GitRefInfo[];
    const adapter = adapterFor(rebaseRefs, calls);

    vi.mocked(pick).mockResolvedValueOnce('refs/remotes/origin/main');

    await runRebaseBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    const pickOptions = vi.mocked(pick).mock.calls[0]?.[0];
    expect(pickOptions?.title).toBe('Rebase Branch');
    expect(pickOptions?.placeholder).toBe('Select a branch to rebase onto');
    expect(pickOptions?.options.map((option) => option.value)).toEqual([
      'refs/remotes/origin/main',
      'refs/heads/feature/scm',
      'refs/remotes/origin/topic',
    ]);
    expect(pickOptions?.options[0]).toMatchObject({
      label: 'origin/main',
      hint: '(upstream)',
    });
    expect(pickOptions?.options[0]).not.toHaveProperty('separator');
    expect(calls).toEqual(['rebase:origin/main', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Rebased current branch onto origin/main.');
  });

  it('reports ordinary rebase conflicts without invoking the interactive planner', async () => {
    const calls: string[] = [];
    const adapter: BranchGitAdapter = {
      ...adapterFor(refs, calls),
      rebase: async (branch) => {
        calls.push(`rebase:${branch}`);
        return { ok: false, conflicts: true };
      },
    };

    vi.mocked(pick).mockResolvedValueOnce('refs/heads/feature/scm');

    await runRebaseBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(calls).toEqual(['rebase:feature/scm', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Rebase onto feature/scm stopped with conflicts.');
  });

  it('creates a branch from the command, validates local duplicates, and refreshes', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({ value: 'cmd:create', inputValue: '' });
    vi.mocked(prompt).mockResolvedValueOnce(' feature/new ');

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    const promptOptions = vi.mocked(prompt).mock.calls[0]?.[0];
    expect(promptOptions?.validate?.('main')).toBe('Branch "main" already exists.');
    expect(promptOptions?.validate?.(' feature/new ')).toBeNull();
    expect(calls).toEqual(['create:feature/new:{}', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Created and checked out feature/new.');
  });

  it('uses the typed quick-pick value when creating a branch command', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({
      value: 'cmd:create',
      inputValue: 'feature/from-input',
    });

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(calls).toEqual(['create:feature/from-input:{}', 'after']);
  });

  it('creates a branch from a selected ref using the ref as the start point', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({
      value: 'cmd:createFrom',
      inputValue: '',
    });
    vi.mocked(pick).mockResolvedValueOnce('refs/remotes/origin/topic');
    vi.mocked(prompt).mockResolvedValueOnce(' topic-copy ');

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    const promptOptions = vi.mocked(prompt).mock.calls[0]?.[0];
    expect(promptOptions).not.toHaveProperty('defaultValue');
    expect(calls).toEqual(['create:topic-copy:{"ref":"origin/topic"}', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Created and checked out topic-copy.');
  });

  it('renames the current branch from the branch submenu command', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(prompt).mockResolvedValueOnce(' feature/renamed ');

    await runRenameBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    const promptOptions = vi.mocked(prompt).mock.calls[0]?.[0];
    expect(promptOptions).toMatchObject({
      title: 'Rename Branch',
      defaultValue: 'main',
    });
    expect(promptOptions?.validate?.('main')).toBeNull();
    expect(promptOptions?.validate?.('feature/scm')).toBe('Branch "feature/scm" already exists.');
    expect(calls).toEqual(['rename:feature/renamed', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Renamed branch to feature/renamed.');
  });

  it('deletes a local non-current branch from the branch submenu command', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pick).mockResolvedValueOnce('refs/heads/feature/scm');
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await runDeleteBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    const pickOptions = vi.mocked(pick).mock.calls[0]?.[0];
    expect(pickOptions?.title).toBe('Delete Branch');
    expect(pickOptions?.options.map((option) => option.value)).toEqual(['refs/heads/feature/scm']);
    expect(confirm).toHaveBeenCalledWith({
      title: 'Delete branch feature/scm?',
      confirmText: 'Delete Branch',
      destructive: true,
    });
    expect(calls).toEqual(['delete:feature/scm:{}', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Deleted branch feature/scm.');
  });

  it('offers force delete when git reports the branch is not fully merged', async () => {
    const calls: string[] = [];
    const adapter: BranchGitAdapter = {
      ...adapterFor(refs, calls),
      deleteBranch: async (name, options) => {
        calls.push(`delete:${name}:${JSON.stringify(options ?? {})}`);
        if (options?.force !== true) {
          throw new GitError({
            message: 'branch is not fully merged',
            gitErrorCode: GitErrorCodes.BranchNotFullyMerged,
          });
        }
      },
    };

    vi.mocked(pick).mockResolvedValueOnce('refs/heads/feature/scm');
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    await runDeleteBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(confirm).toHaveBeenNthCalledWith(2, {
      title: 'Branch feature/scm is not fully merged. Force delete?',
      confirmText: 'Force Delete',
      destructive: true,
    });
    expect(calls).toEqual(['delete:feature/scm:{}', 'delete:feature/scm:{"force":true}', 'after']);
  });

  it('offers HEAD as a create-branch-from source', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({
      value: 'cmd:createFrom',
      inputValue: 'from-head',
    });
    vi.mocked(pick).mockResolvedValueOnce('HEAD');

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(vi.mocked(pick).mock.calls[0]?.[0].options.map((option) => option.value)).toEqual([
      'HEAD',
      'refs/heads/main',
      'refs/heads/feature/scm',
      'refs/remotes/origin/topic',
      'refs/tags/v1.0',
    ]);
    expect(prompt).not.toHaveBeenCalled();
    expect(calls).toEqual(['create:from-head:{"ref":"HEAD"}', 'after']);
  });

  it('checks out a selected ref in detached mode', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({
      value: 'cmd:checkoutDetached',
      inputValue: '',
    });
    vi.mocked(pick).mockResolvedValueOnce('refs/remotes/origin/topic');

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(vi.mocked(pick).mock.calls[0]?.[0].options.map((option) => option.value)).toEqual([
      'refs/heads/main',
      'refs/heads/feature/scm',
      'refs/remotes/origin/topic',
    ]);
    expect(calls).toEqual(['checkout:origin/topic:{"detached":true}', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Checked out origin/topic detached.');
  });

  it('uses checkout recovery for detached checkout blockers', async () => {
    const calls: string[] = [];
    const adapter: BranchGitAdapter = {
      ...adapterFor(refs, calls),
      checkout: async (branch, options) => {
        calls.push(`checkout:${branch}:${JSON.stringify(options ?? {})}`);
        if (options?.force !== true) {
          throw new Error('Your local changes would be overwritten by checkout');
        }
      },
    };

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({
      value: 'cmd:checkoutDetached',
      inputValue: '',
    });
    vi.mocked(pick)
      .mockResolvedValueOnce('refs/remotes/origin/topic')
      .mockResolvedValueOnce('force');

    await runCheckoutBranchCommand({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(calls).toEqual([
      'checkout:origin/topic:{"detached":true}',
      'checkout:origin/topic:{"detached":true,"force":true}',
      'after',
    ]);
  });
});
