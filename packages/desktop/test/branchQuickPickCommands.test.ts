import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prompt } from '../src/platform/dialogs/browser/dialogService.js';
import { toast } from '../src/platform/notification/browser/notificationService.js';
import { pick, pickWithInputValue } from '../src/platform/quickinput/browser/quickInputService.js';
import type { BranchGitAdapter } from '../src/workbench/contrib/scm/browser/branchGitAdapter.js';
import { openBranchQuickPick } from '../src/workbench/contrib/scm/browser/branchQuickPickCommands.js';
import type { GitCreateBranchArgs, GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';

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

const ref = (id: string, name: string, type: GitRefInfo['type'], current = false): GitRefInfo => ({
  id,
  name,
  type,
  current,
  ...(id.endsWith('/topic') ? { remote: 'origin' } : {}),
  ...(id.startsWith('refs/tags/') ? { commit: 'abc1234567890' } : {}),
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
    deleteBranch: vi.fn(),
    renameCurrent: vi.fn(),
    merge: vi.fn(),
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
    vi.mocked(pick).mockReset();
    vi.mocked(pickWithInputValue).mockReset();
    vi.mocked(prompt).mockReset();
    vi.mocked(toast.info).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('shows the VS Code-style checkout command boundary before refs', async () => {
    const adapter = adapterFor(refs);
    vi.mocked(pickWithInputValue).mockResolvedValueOnce(null);

    await openBranchQuickPick({
      git: adapter,
      onAfter: vi.fn(),
    });

    const options = vi.mocked(pickWithInputValue).mock.calls[0]?.[0].options ?? [];
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

    await openBranchQuickPick({
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    expect(calls).toEqual(['checkout:origin/topic:{"track":true}', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Checked out origin/topic.');
  });

  it('creates a branch from the command, validates local duplicates, and refreshes', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({ value: 'cmd:create', inputValue: '' });
    vi.mocked(prompt).mockResolvedValueOnce(' feature/new ');

    await openBranchQuickPick({
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

    await openBranchQuickPick({
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

    await openBranchQuickPick({
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

  it('offers HEAD as a create-branch-from source', async () => {
    const calls: string[] = [];
    const adapter = adapterFor(refs, calls);

    vi.mocked(pickWithInputValue).mockResolvedValueOnce({
      value: 'cmd:createFrom',
      inputValue: 'from-head',
    });
    vi.mocked(pick).mockResolvedValueOnce('HEAD');

    await openBranchQuickPick({
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

    await openBranchQuickPick({
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

    await openBranchQuickPick({
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
