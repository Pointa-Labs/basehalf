import { describe, expect, it } from 'vitest';
import type {
  ContextMenuAction,
  ContextMenuItem,
} from '../src/workbench/browser/parts/contextmenu/contextMenuStore.js';
import {
  type GitGraphActionDeps,
  fullGraphCommitMenu,
  fullGraphRefMenu,
  fullGraphStashMenu,
} from '../src/workbench/contrib/scm/browser/gitGraphActions.js';
import type { GitCommit } from '../src/workbench/contrib/scm/common/git.js';

const commit: GitCommit = {
  hash: 'abcdef1234567890',
  shortHash: 'abcdef1',
  parents: ['parent'],
  author: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T00:00:00Z' },
  committer: { name: 'Ada', email: 'ada@example.com', date: '2026-06-28T00:00:00Z' },
  subject: 'Ship graph actions',
  body: '',
  refs: [],
  tags: [],
  head: true,
};

function action(items: readonly ContextMenuItem[], id: string): ContextMenuAction {
  const item = items.find((entry) => !('separator' in entry) && entry.id === id);
  if (!item || 'separator' in item) throw new Error(`missing action ${id}`);
  return item;
}

function ids(items: readonly ContextMenuItem[]): string[] {
  return items.map((item) => ('separator' in item ? '---' : item.id));
}

function createDeps(): { deps: GitGraphActionDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: GitGraphActionDeps = {
    git: {
      checkout: async (ref, options) =>
        calls.push(`checkout:${ref}:${options?.track === true ? 'track' : 'plain'}`),
      createBranch: async (name, options) => calls.push(`branch:${name}:${options?.ref ?? ''}`),
      tag: async (name, ref) => calls.push(`tag:${name}:${ref ?? ''}`),
      cherryPick: async (ref) => {
        calls.push(`cherry:${ref}`);
        return { applied: true, conflicts: false };
      },
      revert: async (ref) => {
        calls.push(`revert:${ref}`);
        return { reverted: true, conflicts: false };
      },
      merge: async (ref) => {
        calls.push(`merge:${ref}`);
        return { merged: true, conflicts: false, stdout: '', stderr: '' };
      },
      reset: async (args) => calls.push(`reset:${args.ref}:${args.mode}`),
      tagDelete: async (name) => calls.push(`tag-delete:${name}`),
      renameBranch: async (from, to) => calls.push(`rename:${from}:${to}`),
      deleteBranch: async (name, options) =>
        calls.push(`branch-delete:${name}:${options?.force === true ? 'force' : 'safe'}`),
      stashApply: async (ref) => calls.push(`stash-apply:${ref}`),
      stashPop: async (ref) => calls.push(`stash-pop:${ref ?? ''}`),
      stashDrop: async (ref) => calls.push(`stash-drop:${ref}`),
    },
    runGit: (fn) => {
      calls.push('runGit');
      void fn();
    },
    confirm: async (options) => {
      calls.push(`confirm:${options.title}`);
      return true;
    },
    prompt: async (options) => {
      calls.push(`prompt:${options.title}`);
      return options.defaultValue === undefined ? 'topic' : `${options.defaultValue}-renamed`;
    },
    setRebaseBase: (sha) => calls.push(`rebase:${sha}`),
    writeClipboard: async (text) => calls.push(`copy:${text}`),
    toastError: (message) => calls.push(`error:${message}`),
    toastSuccess: (message) => calls.push(`success:${message}`),
  };
  return { deps, calls };
}

describe('gitGraphActions', () => {
  it('builds the full commit action menu and executes injected command handlers', async () => {
    const { deps, calls } = createDeps();
    const menu = fullGraphCommitMenu(commit, deps);

    expect(ids(menu)).toEqual([
      'checkout',
      'branch',
      'tag',
      '---',
      'cherrypick',
      'revert',
      'merge',
      '---',
      'reset-mixed',
      'reset-hard',
      '---',
      'rebase',
      '---',
      'copy-sha',
      'copy-subject',
    ]);
    expect(action(menu, 'reset-hard').danger).toBe(true);

    action(menu, 'branch').run();
    await Promise.resolve();
    action(menu, 'rebase').run();
    action(menu, 'copy-sha').run();
    await Promise.resolve();

    expect(calls).toEqual([
      'prompt:Create branch from abcdef1',
      'runGit',
      'branch:topic:abcdef1234567890',
      'rebase:abcdef1234567890',
      'copy:abcdef1234567890',
      'success:Copied abcdef1',
    ]);
  });

  it('builds ref menus with local branch, remote tracking, and tag variants', async () => {
    const local = createDeps();
    const branchMenu = fullGraphRefMenu(
      { name: 'feature/scm', kind: 'branch', targetRef: 'refs/heads/feature/scm' },
      local.deps,
    );
    expect(ids(branchMenu)).toEqual(['checkout', 'merge', 'rename', '---', 'delete']);

    action(branchMenu, 'rename').run();
    await Promise.resolve();
    expect(local.calls).toEqual([
      'prompt:Rename feature/scm',
      'runGit',
      'rename:feature/scm:feature/scm-renamed',
    ]);

    const remote = createDeps();
    action(
      fullGraphRefMenu(
        { name: 'origin/main', kind: 'remote', targetRef: 'refs/remotes/origin/main' },
        remote.deps,
      ),
      'checkout',
    ).run();
    expect(remote.calls).toEqual(['runGit', 'checkout:refs/remotes/origin/main:track']);

    const trackedRemote = createDeps();
    action(
      fullGraphRefMenu(
        {
          name: 'origin/main',
          kind: 'remote',
          targetRef: 'refs/remotes/origin/main',
          trackingLocal: 'main',
        },
        trackedRemote.deps,
      ),
      'checkout',
    ).run();
    expect(trackedRemote.calls).toEqual(['runGit', 'checkout:main:plain']);

    const tag = createDeps();
    action(
      fullGraphRefMenu({ name: 'v1.0', kind: 'tag', targetRef: 'refs/tags/v1.0' }, tag.deps),
      'delete',
    ).run();
    await Promise.resolve();
    expect(tag.calls).toEqual(['confirm:Delete tag v1.0?', 'runGit', 'tag-delete:v1.0']);
  });

  it('uses full ref targets for merge actions to avoid ambiguous refs', () => {
    const { deps, calls } = createDeps();
    action(
      fullGraphRefMenu(
        { name: 'feature/scm', kind: 'branch', targetRef: 'refs/heads/feature/scm' },
        deps,
      ),
      'merge',
    ).run();

    expect(calls).toEqual(['runGit', 'merge:refs/heads/feature/scm']);
  });

  it('builds stash menu actions with confirmation for destructive drops', async () => {
    const { deps, calls } = createDeps();
    const menu = fullGraphStashMenu('stash@{0}', deps);

    expect(ids(menu)).toEqual(['apply', 'pop', '---', 'drop']);
    expect(action(menu, 'drop').danger).toBe(true);

    action(menu, 'apply').run();
    action(menu, 'drop').run();
    await Promise.resolve();

    expect(calls).toEqual([
      'runGit',
      'stash-apply:stash@{0}',
      'confirm:Delete stash@{0}?',
      'runGit',
      'stash-drop:stash@{0}',
    ]);
  });
});
