import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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
  GitLogArgs,
  GitLogResult,
  GitMergeResult,
  GitRebaseInteractiveArgs,
  GitRebaseResult,
  GitRefsArgs,
  GitRefsResult,
  GitRemotesResult,
  GitResetArgs,
  GitRevertResult,
  GitRunner,
  GitSearchHistoryArgs,
  GitShowResult,
  GitStashArgs,
  GitStashEntry,
  GitStashListResult,
  GitStashResult,
  GitStatusResult,
} from '../common/git.js';
import * as gitCommands from './gitCliCommands.js';
import { type GitCommandContext, requireWorkspaceRoot } from './gitCommandRunner.js';
import { assertWorkspaceRelative } from './gitPathGuards.js';
import { systemGit } from './systemGit.js';

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
    options?: { amend?: boolean },
  ): Promise<void>;
  push(workspaceRoot: string | null, options?: { force?: boolean }): Promise<void>;
  pull(workspaceRoot: string | null, options?: { rebase?: boolean }): Promise<void>;
  fetch(workspaceRoot: string | null): Promise<void>;
  sync(workspaceRoot: string | null): Promise<void>;
  remotes(workspaceRoot: string | null): Promise<GitRemotesResult>;
  reset(workspaceRoot: string | null, args: GitResetArgs): Promise<void>;
  checkout(
    workspaceRoot: string | null,
    branch: string,
    options?: { force?: boolean; track?: boolean },
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
    options?: { force?: boolean },
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
  searchHistory(workspaceRoot: string | null, args: GitSearchHistoryArgs): Promise<GitLogResult>;
  commitFiles(workspaceRoot: string | null, ref: string): Promise<GitCommitFilesResult>;
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

export interface GitCliBackendProviderOptions {
  readonly git?: GitRunner;
  readonly deleteWorkspaceEntry?: (
    workspaceRoot: string | null,
    args: { readonly path: string; readonly kind: 'file' | 'folder' },
  ) => Promise<unknown>;
}

/**
 * Desktop-native Git backend. This mirrors VS Code's split between the Git CLI
 * adapter and the SCM repository/service layer: workbench code talks to
 * GitMainService, and the provider owns the actual system-git invocations.
 */
export class GitCliBackendProvider implements GitBackendProvider {
  private readonly git: GitRunner;

  constructor(private readonly opts: GitCliBackendProviderOptions = {}) {
    this.git = opts.git ?? systemGit();
  }

  async init(workspaceRoot: string | null): Promise<void> {
    await gitCommands.init({}, this.context(workspaceRoot));
  }

  async stage(workspaceRoot: string | null, paths: readonly string[]): Promise<void> {
    await gitCommands.stage({ paths: [...paths] }, this.context(workspaceRoot));
  }

  async stageAll(workspaceRoot: string | null): Promise<void> {
    await gitCommands.stageAll({}, this.context(workspaceRoot));
  }

  async unstage(workspaceRoot: string | null, paths: readonly string[]): Promise<void> {
    await gitCommands.unstage({ paths: [...paths] }, this.context(workspaceRoot));
  }

  async unstageAll(workspaceRoot: string | null): Promise<void> {
    await gitCommands.unstageAll({}, this.context(workspaceRoot));
  }

  async discard(workspaceRoot: string | null, paths: readonly string[]): Promise<void> {
    await gitCommands.discard({ paths: [...paths] }, this.context(workspaceRoot));
  }

  async deleteWorkspaceEntry(
    workspaceRoot: string | null,
    path: string,
    kind: 'file' | 'folder',
  ): Promise<void> {
    if (this.opts.deleteWorkspaceEntry !== undefined) {
      await this.opts.deleteWorkspaceEntry(workspaceRoot, { path, kind });
      return;
    }
    const root = requireWorkspaceRoot({ workspaceRoot, git: this.git });
    assertWorkspaceRelative(path);
    await rm(join(root, path), { force: true, recursive: kind === 'folder' });
  }

  async commit(
    workspaceRoot: string | null,
    message: string,
    options: { amend?: boolean } = {},
  ): Promise<void> {
    await gitCommands.commit(
      { message, ...(options.amend === true && { amend: true }) },
      this.context(workspaceRoot),
    );
  }

  async push(workspaceRoot: string | null, options: { force?: boolean } = {}): Promise<void> {
    await gitCommands.push(
      options.force === true ? { force: true } : {},
      this.context(workspaceRoot),
    );
  }

  async pull(workspaceRoot: string | null, options: { rebase?: boolean } = {}): Promise<void> {
    await gitCommands.pull(
      options.rebase === true ? { rebase: true } : {},
      this.context(workspaceRoot),
    );
  }

  async fetch(workspaceRoot: string | null): Promise<void> {
    await gitCommands.fetch({}, this.context(workspaceRoot));
  }

  async sync(workspaceRoot: string | null): Promise<void> {
    await gitCommands.sync({}, this.context(workspaceRoot));
  }

  remotes(workspaceRoot: string | null): Promise<GitRemotesResult> {
    return gitCommands.remotes({}, this.context(workspaceRoot));
  }

  async reset(workspaceRoot: string | null, args: GitResetArgs): Promise<void> {
    await gitCommands.reset(args, this.context(workspaceRoot));
  }

  async checkout(
    workspaceRoot: string | null,
    branch: string,
    options: { force?: boolean; track?: boolean } = {},
  ): Promise<void> {
    await gitCommands.checkout({ branch, ...options }, this.context(workspaceRoot));
  }

  async createBranch(
    workspaceRoot: string | null,
    name: string,
    options: Omit<GitCreateBranchArgs, 'name'> = {},
  ): Promise<void> {
    await gitCommands.createBranch({ name, ...options }, this.context(workspaceRoot));
  }

  async renameBranch(workspaceRoot: string | null, from: string, to: string): Promise<void> {
    await gitCommands.renameBranch({ from, to }, this.context(workspaceRoot));
  }

  async renameCurrentBranch(workspaceRoot: string | null, to: string): Promise<void> {
    await gitCommands.renameBranch({ to }, this.context(workspaceRoot));
  }

  async deleteBranch(
    workspaceRoot: string | null,
    name: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    await gitCommands.deleteBranch({ name, ...options }, this.context(workspaceRoot));
  }

  merge(workspaceRoot: string | null, branch: string): Promise<GitMergeResult> {
    return gitCommands.merge({ branch }, this.context(workspaceRoot));
  }

  cherryPick(workspaceRoot: string | null, ref: string): Promise<GitCherryPickResult> {
    return gitCommands.cherryPick({ ref }, this.context(workspaceRoot));
  }

  revert(workspaceRoot: string | null, ref: string): Promise<GitRevertResult> {
    return gitCommands.revert({ ref }, this.context(workspaceRoot));
  }

  rebaseInteractive(
    workspaceRoot: string | null,
    args: GitRebaseInteractiveArgs,
  ): Promise<GitRebaseResult> {
    return gitCommands.rebaseInteractive(args, this.context(workspaceRoot));
  }

  async tag(workspaceRoot: string | null, name: string, ref?: string): Promise<void> {
    await gitCommands.tag(
      ref !== undefined ? { name, ref } : { name },
      this.context(workspaceRoot),
    );
  }

  async tagDelete(workspaceRoot: string | null, name: string): Promise<void> {
    await gitCommands.tagDelete({ name }, this.context(workspaceRoot));
  }

  status(workspaceRoot: string | null): Promise<GitStatusResult> {
    return gitCommands.status({}, this.context(workspaceRoot));
  }

  show(workspaceRoot: string | null, ref: string, path: string): Promise<GitShowResult> {
    return gitCommands.show({ ref, path }, this.context(workspaceRoot));
  }

  diff(
    workspaceRoot: string | null,
    path: string,
    options: Omit<GitDiffArgs, 'path'> = {},
  ): Promise<GitDiffResult> {
    return gitCommands.diff({ path, ...options }, this.context(workspaceRoot));
  }

  async apply(workspaceRoot: string | null, args: GitApplyArgs): Promise<void> {
    await gitCommands.apply(args, this.context(workspaceRoot));
  }

  blame(
    workspaceRoot: string | null,
    path: string,
    options: Omit<GitBlameArgs, 'path'> = {},
  ): Promise<GitBlameResult> {
    return gitCommands.blame({ path, ...options }, this.context(workspaceRoot));
  }

  conflictStages(workspaceRoot: string | null, path: string): Promise<GitConflictStagesResult> {
    return gitCommands.conflictStages({ path }, this.context(workspaceRoot));
  }

  refs(workspaceRoot: string | null, args: GitRefsArgs = {}): Promise<GitRefsResult> {
    return gitCommands.refs(args, this.context(workspaceRoot));
  }

  log(workspaceRoot: string | null, args: GitLogArgs): Promise<GitLogResult> {
    return gitCommands.log(args, this.context(workspaceRoot));
  }

  searchHistory(workspaceRoot: string | null, args: GitSearchHistoryArgs): Promise<GitLogResult> {
    return gitCommands.searchHistory(args, this.context(workspaceRoot));
  }

  commitFiles(workspaceRoot: string | null, ref: string): Promise<GitCommitFilesResult> {
    return gitCommands.commitFiles({ ref }, this.context(workspaceRoot));
  }

  stash(
    workspaceRoot: string | null,
    message?: string,
    options: Omit<GitStashArgs, 'message'> = {},
  ): Promise<GitStashResult> {
    return gitCommands.stash(
      message === undefined ? { ...options } : { message, ...options },
      this.context(workspaceRoot),
    );
  }

  stashList(workspaceRoot: string | null): Promise<GitStashListResult> {
    return gitCommands.stashList({}, this.context(workspaceRoot));
  }

  async stashApply(workspaceRoot: string | null, ref: GitStashEntry['ref']): Promise<void> {
    await gitCommands.stashApply({ ref }, this.context(workspaceRoot));
  }

  async stashPop(workspaceRoot: string | null, ref?: GitStashEntry['ref']): Promise<void> {
    await gitCommands.stashPop(ref !== undefined ? { ref } : {}, this.context(workspaceRoot));
  }

  async stashDrop(workspaceRoot: string | null, ref: GitStashEntry['ref']): Promise<void> {
    await gitCommands.stashDrop({ ref }, this.context(workspaceRoot));
  }

  private context(workspaceRoot: string | null): GitCommandContext {
    return { workspaceRoot, git: this.git };
  }
}
