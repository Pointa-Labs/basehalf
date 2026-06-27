import type { GitMergeResult, GitRefsResult, GitStashResult } from '@basehalf/core';

export interface BranchGitAdapter {
  readonly listRefs: () => Promise<GitRefsResult>;
  readonly checkout: (
    branch: string,
    options?: { readonly force?: boolean; readonly track?: boolean },
  ) => Promise<unknown>;
  readonly createBranch: (name: string) => Promise<unknown>;
  readonly deleteBranch: (name: string, options?: { readonly force?: boolean }) => Promise<unknown>;
  readonly renameCurrent: (to: string) => Promise<unknown>;
  readonly merge: (branch: string) => Promise<GitMergeResult>;
  readonly stash: (
    message: string,
    options?: { readonly includeUntracked?: boolean },
  ) => Promise<GitStashResult>;
  readonly stashPop: () => Promise<unknown>;
}

export const defaultBranchGitAdapter: BranchGitAdapter = {
  listRefs: () =>
    window.bh.run('git.refs', { includeRemote: true, includeTags: true }) as Promise<GitRefsResult>,
  checkout: (branch, options) => window.bh.run('git.checkout', { branch, ...options }),
  createBranch: (name) => window.bh.run('git.createBranch', { name }),
  deleteBranch: (name, options) => window.bh.run('git.deleteBranch', { name, ...options }),
  renameCurrent: (to) => window.bh.run('git.renameBranch', { to }),
  merge: (branch) => window.bh.run('git.merge', { branch }) as Promise<GitMergeResult>,
  stash: (message, options) =>
    window.bh.run('git.stash', { message, ...options }) as Promise<GitStashResult>,
  stashPop: () => window.bh.run('git.stashPop', {}),
};
