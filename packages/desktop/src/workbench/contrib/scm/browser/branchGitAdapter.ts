import type {
  GitCreateBranchArgs,
  GitMergeResult,
  GitRebaseResult,
  GitRefsResult,
  GitStashResult,
} from '../common/git.js';
import { type GitScmService, gitScmService } from './gitScmService.js';

export interface BranchGitAdapter {
  readonly listRefs: () => Promise<GitRefsResult>;
  readonly checkout: (
    branch: string,
    options?: { readonly detached?: boolean; readonly force?: boolean; readonly track?: boolean },
  ) => Promise<unknown>;
  readonly createBranch: (
    name: string,
    options?: Omit<GitCreateBranchArgs, 'name'>,
  ) => Promise<unknown>;
  readonly deleteBranch: (name: string, options?: { readonly force?: boolean }) => Promise<unknown>;
  readonly renameCurrent: (to: string) => Promise<unknown>;
  readonly merge: (branch: string) => Promise<GitMergeResult>;
  readonly rebase: (branch: string) => Promise<GitRebaseResult>;
  readonly stash: (
    message: string,
    options?: { readonly includeUntracked?: boolean },
  ) => Promise<GitStashResult>;
  readonly stashPop: () => Promise<unknown>;
}

export const createBranchGitAdapter = (git: GitScmService): BranchGitAdapter => ({
  listRefs: () => git.refs({ includeRemote: true, includeTags: true }),
  checkout: (branch, options) => git.checkout(branch, options),
  createBranch: (name, options) => git.createBranch(name, options),
  deleteBranch: (name, options) => git.deleteBranch(name, options),
  renameCurrent: (to) => git.renameCurrentBranch(to),
  merge: (branch) => git.merge(branch),
  rebase: (branch) => git.rebase(branch),
  stash: (message, options) => git.stash(message, options),
  stashPop: () => git.stashPop(),
});

export const defaultBranchGitAdapter = createBranchGitAdapter(gitScmService);
