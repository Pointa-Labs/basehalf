import type {
  GitApplyArgs,
  GitBlameArgs,
  GitBlameResult,
  GitCherryPickResult,
  GitCommitFilesResult,
  GitConflictStagesResult,
  GitCreateBranchArgs,
  GitDiffArgs,
  GitDiffResult,
  GitFetchArgs,
  GitLogArgs,
  GitLogResult,
  GitMergeBaseResult,
  GitMergeResult,
  GitRebaseInteractiveArgs,
  GitRebaseResult,
  GitRefsArgs,
  GitRefsResult,
  GitRemotesResult,
  GitResetArgs,
  GitRevertResult,
  GitSearchHistoryArgs,
  GitShowResult,
  GitStashArgs,
  GitStashEntry,
  GitStashListResult,
  GitStashResult,
  GitStatusResult,
} from '../common/git.js';

export interface GitBackendProvider {
  init(workspaceRoot: string | null): Promise<void>;
  stage(workspaceRoot: string | null, paths: readonly string[]): Promise<void>;
  stageAll(workspaceRoot: string | null): Promise<void>;
  unstage(workspaceRoot: string | null, paths: readonly string[]): Promise<void>;
  unstageAll(workspaceRoot: string | null): Promise<void>;
  discard(workspaceRoot: string | null, paths: readonly string[]): Promise<void>;
  deleteWorkspaceEntry(
    workspaceRoot: string | null,
    path: string,
    kind: 'file' | 'folder',
  ): Promise<void>;
  commit(
    workspaceRoot: string | null,
    message: string,
    options?: { readonly amend?: boolean },
  ): Promise<void>;
  push(workspaceRoot: string | null, options?: { readonly force?: boolean }): Promise<void>;
  publish(workspaceRoot: string | null, options?: { readonly remote?: string }): Promise<void>;
  pull(workspaceRoot: string | null, options?: { readonly rebase?: boolean }): Promise<void>;
  fetch(workspaceRoot: string | null, args?: GitFetchArgs): Promise<void>;
  sync(workspaceRoot: string | null): Promise<void>;
  remotes(workspaceRoot: string | null): Promise<GitRemotesResult>;
  reset(workspaceRoot: string | null, args: GitResetArgs): Promise<void>;
  checkout(
    workspaceRoot: string | null,
    branch: string,
    options?: { readonly detached?: boolean; readonly force?: boolean; readonly track?: boolean },
  ): Promise<void>;
  createBranch(
    workspaceRoot: string | null,
    name: string,
    options?: Omit<GitCreateBranchArgs, 'name'>,
  ): Promise<void>;
  renameBranch(workspaceRoot: string | null, from: string, to: string): Promise<void>;
  renameCurrentBranch(workspaceRoot: string | null, to: string): Promise<void>;
  deleteBranch(
    workspaceRoot: string | null,
    name: string,
    options?: { readonly force?: boolean },
  ): Promise<void>;
  deleteRemoteRef(
    workspaceRoot: string | null,
    remote: string,
    name: string,
    options?: { readonly force?: boolean },
  ): Promise<void>;
  merge(workspaceRoot: string | null, branch: string): Promise<GitMergeResult>;
  cherryPick(workspaceRoot: string | null, ref: string): Promise<GitCherryPickResult>;
  revert(workspaceRoot: string | null, ref: string): Promise<GitRevertResult>;
  rebaseInteractive(
    workspaceRoot: string | null,
    args: GitRebaseInteractiveArgs,
  ): Promise<GitRebaseResult>;
  tag(workspaceRoot: string | null, name: string, ref?: string): Promise<void>;
  tagDelete(workspaceRoot: string | null, name: string): Promise<void>;
  status(workspaceRoot: string | null): Promise<GitStatusResult>;
  show(workspaceRoot: string | null, ref: string, path: string): Promise<GitShowResult>;
  diff(
    workspaceRoot: string | null,
    path: string,
    options?: Omit<GitDiffArgs, 'path'>,
  ): Promise<GitDiffResult>;
  apply(workspaceRoot: string | null, args: GitApplyArgs): Promise<void>;
  blame(
    workspaceRoot: string | null,
    path: string,
    options?: Omit<GitBlameArgs, 'path'>,
  ): Promise<GitBlameResult>;
  conflictStages(workspaceRoot: string | null, path: string): Promise<GitConflictStagesResult>;
  refs(workspaceRoot: string | null, args?: GitRefsArgs): Promise<GitRefsResult>;
  log(workspaceRoot: string | null, args: GitLogArgs): Promise<GitLogResult>;
  mergeBase(workspaceRoot: string | null, refs: readonly string[]): Promise<GitMergeBaseResult>;
  searchHistory(workspaceRoot: string | null, args: GitSearchHistoryArgs): Promise<GitLogResult>;
  commitFiles(
    workspaceRoot: string | null,
    ref: string,
    parent?: string,
  ): Promise<GitCommitFilesResult>;
  stash(
    workspaceRoot: string | null,
    message?: string,
    options?: Omit<GitStashArgs, 'message'>,
  ): Promise<GitStashResult>;
  stashList(workspaceRoot: string | null): Promise<GitStashListResult>;
  stashApply(workspaceRoot: string | null, ref: GitStashEntry['ref']): Promise<void>;
  stashPop(workspaceRoot: string | null, ref?: GitStashEntry['ref']): Promise<void>;
  stashDrop(workspaceRoot: string | null, ref: GitStashEntry['ref']): Promise<void>;
}
