import type {
  GitApplyArgs,
  GitBlameArgs,
  GitBlameResult,
  GitCherryPickResult,
  GitCommitFilesResult,
  GitConflictStagesResult,
  GitCreateBranchArgs,
  GitDiffArgs,
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
  GitStashArgs,
  GitStashEntry,
  GitStashResult,
  GitStatusResult,
} from './gitTypes.js';

export const GIT_IPC_CHANNELS = {
  init: 'git:init',
  stage: 'git:stage',
  stageAll: 'git:stage-all',
  unstage: 'git:unstage',
  unstageAll: 'git:unstage-all',
  discard: 'git:discard',
  deleteWorkspaceEntry: 'git:delete-workspace-entry',
  commit: 'git:commit',
  push: 'git:push',
  publish: 'git:publish',
  pull: 'git:pull',
  fetch: 'git:fetch',
  sync: 'git:sync',
  remotes: 'git:remotes',
  reset: 'git:reset',
  checkout: 'git:checkout',
  createBranch: 'git:create-branch',
  renameBranch: 'git:rename-branch',
  renameCurrentBranch: 'git:rename-current-branch',
  deleteBranch: 'git:delete-branch',
  deleteRemoteRef: 'git:delete-remote-ref',
  merge: 'git:merge',
  cherryPick: 'git:cherry-pick',
  revert: 'git:revert',
  rebase: 'git:rebase',
  rebaseInteractive: 'git:rebase-interactive',
  tag: 'git:tag',
  tagDelete: 'git:tag-delete',
  status: 'git:status',
  show: 'git:show',
  diff: 'git:diff',
  apply: 'git:apply',
  blame: 'git:blame',
  conflictStages: 'git:conflict-stages',
  refs: 'git:refs',
  log: 'git:log',
  mergeBase: 'git:merge-base',
  searchHistory: 'git:search-history',
  commitFiles: 'git:commit-files',
  stash: 'git:stash',
  stashList: 'git:stash-list',
  stashApply: 'git:stash-apply',
  stashPop: 'git:stash-pop',
  stashDrop: 'git:stash-drop',
} as const;

export type GitIpcChannel = (typeof GIT_IPC_CHANNELS)[keyof typeof GIT_IPC_CHANNELS];

export interface GitChannelBridge {
  init(): Promise<void>;
  stage(paths: readonly string[]): Promise<void>;
  stageAll(): Promise<void>;
  unstage(paths: readonly string[]): Promise<void>;
  unstageAll(): Promise<void>;
  discard(paths: readonly string[]): Promise<void>;
  deleteWorkspaceEntry(path: string, kind: 'file' | 'folder'): Promise<void>;
  commit(message: string, options?: { amend?: boolean }): Promise<void>;
  push(options?: { force?: boolean }): Promise<void>;
  publish(options?: { remote?: string }): Promise<void>;
  pull(options?: { rebase?: boolean }): Promise<void>;
  fetch(args?: GitFetchArgs): Promise<void>;
  sync(): Promise<void>;
  remotes(): Promise<GitRemotesResult>;
  reset(args: GitResetArgs): Promise<void>;
  checkout(
    branch: string,
    options?: { detached?: boolean; force?: boolean; track?: boolean },
  ): Promise<void>;
  createBranch(name: string, options?: Omit<GitCreateBranchArgs, 'name'>): Promise<void>;
  renameBranch(from: string, to: string): Promise<void>;
  renameCurrentBranch(to: string): Promise<void>;
  deleteBranch(name: string, options?: { force?: boolean }): Promise<void>;
  deleteRemoteRef(remote: string, name: string, options?: { force?: boolean }): Promise<void>;
  merge(branch: string): Promise<GitMergeResult>;
  cherryPick(ref: string): Promise<GitCherryPickResult>;
  revert(ref: string): Promise<GitRevertResult>;
  rebase(branch: string): Promise<GitRebaseResult>;
  rebaseInteractive(args: GitRebaseInteractiveArgs): Promise<GitRebaseResult>;
  tag(name: string, ref?: string): Promise<void>;
  tagDelete(name: string): Promise<void>;
  status(): Promise<GitStatusResult>;
  show(ref: string, path: string): Promise<string | null>;
  diff(path: string, options?: Omit<GitDiffArgs, 'path'>): Promise<string>;
  apply(args: GitApplyArgs): Promise<void>;
  blame(path: string, options?: Omit<GitBlameArgs, 'path'>): Promise<GitBlameResult>;
  conflictStages(path: string): Promise<GitConflictStagesResult>;
  refs(args?: GitRefsArgs): Promise<GitRefsResult>;
  log(args: GitLogArgs): Promise<GitLogResult>;
  mergeBase(refs: readonly string[]): Promise<GitMergeBaseResult['ref']>;
  searchHistory(args: GitSearchHistoryArgs): Promise<GitLogResult['commits']>;
  commitFiles(ref: string, parent?: string): Promise<GitCommitFilesResult['files']>;
  stash(message?: string, options?: Omit<GitStashArgs, 'message'>): Promise<GitStashResult>;
  stashList(): Promise<readonly GitStashEntry[]>;
  stashApply(ref: GitStashEntry['ref']): Promise<void>;
  stashPop(ref?: GitStashEntry['ref']): Promise<void>;
  stashDrop(ref: GitStashEntry['ref']): Promise<void>;
}
