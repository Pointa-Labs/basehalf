import type {
  GitApplyArgs,
  GitBlameArgs,
  GitBlameResult,
  GitCherryPickResult,
  GitCommitFilesResult,
  GitConflictStagesResult,
  GitCreateBranchArgs,
  GitDiffArgs,
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
  GitSearchHistoryArgs,
  GitStashArgs,
  GitStashEntry,
  GitStashResult,
  GitStatusResult,
} from '../common/git.js';
import type { GitBackendProvider } from './gitBackendProvider.js';

/**
 * Main-process Git service. It is the typed Electron-side repository façade
 * consumed by IPC channels; concrete Git execution lives behind a backend
 * provider, matching VS Code's Git adapter vs repository/model split.
 */
export class GitMainService {
  constructor(private readonly backend: GitBackendProvider) {}

  init(workspaceRoot: string | null): Promise<void> {
    return this.backend.init(workspaceRoot);
  }

  stage(workspaceRoot: string | null, paths: readonly string[]): Promise<void> {
    return this.backend.stage(workspaceRoot, paths);
  }

  stageAll(workspaceRoot: string | null): Promise<void> {
    return this.backend.stageAll(workspaceRoot);
  }

  unstage(workspaceRoot: string | null, paths: readonly string[]): Promise<void> {
    return this.backend.unstage(workspaceRoot, paths);
  }

  unstageAll(workspaceRoot: string | null): Promise<void> {
    return this.backend.unstageAll(workspaceRoot);
  }

  discard(workspaceRoot: string | null, paths: readonly string[]): Promise<void> {
    return this.backend.discard(workspaceRoot, paths);
  }

  deleteWorkspaceEntry(
    workspaceRoot: string | null,
    path: string,
    kind: 'file' | 'folder',
  ): Promise<void> {
    return this.backend.deleteWorkspaceEntry(workspaceRoot, path, kind);
  }

  commit(
    workspaceRoot: string | null,
    message: string,
    options: { amend?: boolean } = {},
  ): Promise<void> {
    return this.backend.commit(workspaceRoot, message, options);
  }

  push(workspaceRoot: string | null, options: { force?: boolean } = {}): Promise<void> {
    return this.backend.push(workspaceRoot, options);
  }

  pull(workspaceRoot: string | null, options: { rebase?: boolean } = {}): Promise<void> {
    return this.backend.pull(workspaceRoot, options);
  }

  fetch(workspaceRoot: string | null): Promise<void> {
    return this.backend.fetch(workspaceRoot);
  }

  sync(workspaceRoot: string | null): Promise<void> {
    return this.backend.sync(workspaceRoot);
  }

  remotes(workspaceRoot: string | null): Promise<GitRemotesResult> {
    return this.backend.remotes(workspaceRoot);
  }

  reset(workspaceRoot: string | null, args: GitResetArgs): Promise<void> {
    return this.backend.reset(workspaceRoot, args);
  }

  checkout(
    workspaceRoot: string | null,
    branch: string,
    options: { force?: boolean; track?: boolean } = {},
  ): Promise<void> {
    return this.backend.checkout(workspaceRoot, branch, options);
  }

  createBranch(
    workspaceRoot: string | null,
    name: string,
    options: Omit<GitCreateBranchArgs, 'name'> = {},
  ): Promise<void> {
    return this.backend.createBranch(workspaceRoot, name, options);
  }

  renameBranch(workspaceRoot: string | null, from: string, to: string): Promise<void> {
    return this.backend.renameBranch(workspaceRoot, from, to);
  }

  renameCurrentBranch(workspaceRoot: string | null, to: string): Promise<void> {
    return this.backend.renameCurrentBranch(workspaceRoot, to);
  }

  deleteBranch(
    workspaceRoot: string | null,
    name: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    return this.backend.deleteBranch(workspaceRoot, name, options);
  }

  merge(workspaceRoot: string | null, branch: string): Promise<GitMergeResult> {
    return this.backend.merge(workspaceRoot, branch);
  }

  cherryPick(workspaceRoot: string | null, ref: string): Promise<GitCherryPickResult> {
    return this.backend.cherryPick(workspaceRoot, ref);
  }

  revert(workspaceRoot: string | null, ref: string): Promise<GitRevertResult> {
    return this.backend.revert(workspaceRoot, ref);
  }

  rebaseInteractive(
    workspaceRoot: string | null,
    args: GitRebaseInteractiveArgs,
  ): Promise<GitRebaseResult> {
    return this.backend.rebaseInteractive(workspaceRoot, args);
  }

  tag(workspaceRoot: string | null, name: string, ref?: string): Promise<void> {
    return this.backend.tag(workspaceRoot, name, ref);
  }

  tagDelete(workspaceRoot: string | null, name: string): Promise<void> {
    return this.backend.tagDelete(workspaceRoot, name);
  }

  status(workspaceRoot: string | null): Promise<GitStatusResult> {
    return this.backend.status(workspaceRoot);
  }

  async show(workspaceRoot: string | null, ref: string, path: string): Promise<string | null> {
    const result = await this.backend.show(workspaceRoot, ref, path);
    return result.content;
  }

  async diff(
    workspaceRoot: string | null,
    path: string,
    options: Omit<GitDiffArgs, 'path'> = {},
  ): Promise<string> {
    const result = await this.backend.diff(workspaceRoot, path, options);
    return result.diff;
  }

  apply(workspaceRoot: string | null, args: GitApplyArgs): Promise<void> {
    return this.backend.apply(workspaceRoot, args);
  }

  blame(
    workspaceRoot: string | null,
    path: string,
    options: Omit<GitBlameArgs, 'path'> = {},
  ): Promise<GitBlameResult> {
    return this.backend.blame(workspaceRoot, path, options);
  }

  conflictStages(workspaceRoot: string | null, path: string): Promise<GitConflictStagesResult> {
    return this.backend.conflictStages(workspaceRoot, path);
  }

  refs(workspaceRoot: string | null, args: GitRefsArgs = {}): Promise<GitRefsResult> {
    return this.backend.refs(workspaceRoot, args);
  }

  log(workspaceRoot: string | null, args: GitLogArgs): Promise<GitLogResult> {
    return this.backend.log(workspaceRoot, args);
  }

  async searchHistory(
    workspaceRoot: string | null,
    args: GitSearchHistoryArgs,
  ): Promise<GitLogResult['commits']> {
    const result = await this.backend.searchHistory(workspaceRoot, args);
    return result.commits;
  }

  async commitFiles(
    workspaceRoot: string | null,
    ref: string,
  ): Promise<GitCommitFilesResult['files']> {
    const result = await this.backend.commitFiles(workspaceRoot, ref);
    return result.files;
  }

  stash(
    workspaceRoot: string | null,
    message?: string,
    options: Omit<GitStashArgs, 'message'> = {},
  ): Promise<GitStashResult> {
    return this.backend.stash(workspaceRoot, message, options);
  }

  async stashList(workspaceRoot: string | null): Promise<readonly GitStashEntry[]> {
    const result = await this.backend.stashList(workspaceRoot);
    return result.entries;
  }

  stashApply(workspaceRoot: string | null, ref: GitStashEntry['ref']): Promise<void> {
    return this.backend.stashApply(workspaceRoot, ref);
  }

  stashPop(workspaceRoot: string | null, ref?: GitStashEntry['ref']): Promise<void> {
    return this.backend.stashPop(workspaceRoot, ref);
  }

  stashDrop(workspaceRoot: string | null, ref: GitStashEntry['ref']): Promise<void> {
    return this.backend.stashDrop(workspaceRoot, ref);
  }
}
