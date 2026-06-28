import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pick, prompt } from '../src/workbench/browser/parts/dialogs/Dialog.js';
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

function adapterFor(refs: readonly GitRefInfo[], calls: string[] = []): BranchGitAdapter {
  return {
    listRefs: async () => ({
      current: 'main',
      refs,
    }),
    checkout: async (branch, options) => {
      calls.push(`checkout:${branch}:${JSON.stringify(options ?? {})}`);
    },
    createBranch: async (name) => {
      calls.push(`create:${name}`);
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
    vi.mocked(prompt).mockReset();
    vi.mocked(toast.info).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('shows the VS Code-style checkout command boundary before refs', async () => {
    const adapter = adapterFor(refs);
    vi.mocked(pick).mockResolvedValueOnce(null);

    await openBranchQuickPick({
      status,
      git: adapter,
      onAfter: vi.fn(),
    });

    const options = vi.mocked(pick).mock.calls[0]?.[0].options ?? [];
    expect(options.map((option) => option.label)).toEqual([
      'Create Branch...',
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

    vi.mocked(pick).mockResolvedValueOnce('refs/remotes/origin/topic');

    await openBranchQuickPick({
      status,
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

    vi.mocked(pick).mockResolvedValueOnce('cmd:create');
    vi.mocked(prompt).mockResolvedValueOnce(' feature/new ');

    await openBranchQuickPick({
      status,
      git: adapter,
      onAfter: () => {
        calls.push('after');
      },
    });

    const promptOptions = vi.mocked(prompt).mock.calls[0]?.[0];
    expect(promptOptions?.validate?.('main')).toBe('Branch "main" already exists.');
    expect(promptOptions?.validate?.(' feature/new ')).toBeNull();
    expect(calls).toEqual(['create:feature/new', 'after']);
    expect(toast.info).toHaveBeenCalledWith('Created and checked out feature/new.');
  });
});
