import { GitError } from '../common/git.js';
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
  GitMergeResult,
  GitRebaseInteractiveArgs,
  GitRebaseResult,
  GitRefsArgs,
  GitRefsResult,
  GitRemoteInfo,
  GitRemotesResult,
  GitResetArgs,
  GitRevertResult,
  GitSearchHistoryArgs,
  GitStashArgs,
  GitStashEntry,
  GitStashResult,
  GitStatusResult,
} from '../common/git.js';
import type { PushErrorHandlerRegistry, PushErrorRepository } from '../common/pushError.js';
import { type GitChannel, gitChannel } from './gitChannel.js';
import { pushErrorHandlerRegistry, runPushErrorHandlers } from './pushErrorRegistry.js';

export interface GitScmService {
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
  mergeBase(refs: readonly string[]): Promise<string | null>;
  searchHistory(args: GitSearchHistoryArgs): Promise<GitLogResult['commits']>;
  commitFiles(ref: string, parent?: string): Promise<GitCommitFilesResult['files']>;
  stash(message?: string, options?: Omit<GitStashArgs, 'message'>): Promise<GitStashResult>;
  stashList(): Promise<readonly GitStashEntry[]>;
  stashApply(ref: GitStashEntry['ref']): Promise<void>;
  stashPop(ref?: GitStashEntry['ref']): Promise<void>;
  stashDrop(ref: GitStashEntry['ref']): Promise<void>;
}

export interface GitScmPushErrorContext {
  readonly root: string | null;
  readonly status: GitStatusResult | null;
  readonly remotes: readonly GitRemoteInfo[];
}

export type GitScmPushErrorContextResolver = () =>
  | GitScmPushErrorContext
  | Promise<GitScmPushErrorContext>;

export interface GitScmServiceOptions {
  readonly pushErrorHandlers?: Pick<PushErrorHandlerRegistry, 'getPushErrorHandlers'>;
  readonly resolvePushErrorContext?: GitScmPushErrorContextResolver;
}

export function createGitScmService(
  channel: GitChannel,
  options: GitScmServiceOptions = {},
): GitScmService {
  const pushHandlers = options.pushErrorHandlers ?? pushErrorHandlerRegistry;
  const resolvePushErrorContext =
    options.resolvePushErrorContext ?? createDefaultPushErrorContextResolver(channel);

  return {
    init: async () => {
      await channel.init();
    },
    stage: async (paths) => {
      await channel.stage(paths);
    },
    stageAll: async () => {
      await channel.stageAll();
    },
    unstage: async (paths) => {
      await channel.unstage(paths);
    },
    unstageAll: async () => {
      await channel.unstageAll();
    },
    discard: async (paths) => {
      await channel.discard(paths);
    },
    deleteWorkspaceEntry: async (path, kind) => {
      await channel.deleteWorkspaceEntry(path, kind);
    },
    commit: async (message, options = {}) => {
      await channel.commit(message, { amend: options.amend === true });
    },
    push: async (options = {}) => {
      try {
        await channel.push(options.force === true ? { force: true } : {});
      } catch (err) {
        if (await handlePushError(pushHandlers, resolvePushErrorContext, err)) {
          return;
        }
        throw err;
      }
    },
    publish: async (options = {}) => {
      try {
        await channel.publish(options.remote !== undefined ? { remote: options.remote } : {});
      } catch (err) {
        if (await handlePublishError(pushHandlers, resolvePushErrorContext, options.remote, err)) {
          return;
        }
        throw err;
      }
    },
    pull: async (options = {}) => {
      await channel.pull(options.rebase === true ? { rebase: true } : {});
    },
    fetch: async (args = {}) => {
      await channel.fetch(args);
    },
    sync: async () => {
      await channel.sync();
    },
    remotes: () => channel.remotes(),
    reset: async (args) => {
      await channel.reset(args);
    },
    checkout: async (branch, options = {}) => {
      await channel.checkout(branch, options);
    },
    createBranch: async (name, options = {}) => {
      await channel.createBranch(name, options);
    },
    renameBranch: async (from, to) => {
      await channel.renameBranch(from, to);
    },
    renameCurrentBranch: async (to) => {
      await channel.renameCurrentBranch(to);
    },
    deleteBranch: async (name, options = {}) => {
      await channel.deleteBranch(name, options);
    },
    deleteRemoteRef: async (remote, name, options = {}) => {
      await channel.deleteRemoteRef(remote, name, options);
    },
    merge: (branch) => channel.merge(branch),
    cherryPick: (ref) => channel.cherryPick(ref),
    revert: (ref) => channel.revert(ref),
    rebase: (branch) => channel.rebase(branch),
    rebaseInteractive: (args) => channel.rebaseInteractive(args),
    tag: async (name, ref) => {
      await channel.tag(name, ref);
    },
    tagDelete: async (name) => {
      await channel.tagDelete(name);
    },
    status: () => channel.status(),
    show: async (ref, path) => {
      return channel.show(ref, path);
    },
    diff: async (path, options = {}) => {
      return channel.diff(path, options);
    },
    apply: async (args) => {
      await channel.apply(args);
    },
    blame: (path, options = {}) => channel.blame(path, options),
    conflictStages: (path) => channel.conflictStages(path),
    refs: (args = {}) => channel.refs(args),
    log: (args) => channel.log(args),
    mergeBase: (refs) => channel.mergeBase(refs),
    searchHistory: (args) => channel.searchHistory(args),
    commitFiles: (ref, parent) => channel.commitFiles(ref, parent),
    stash: (message, options = {}) => channel.stash(message, options),
    stashList: () => channel.stashList(),
    stashApply: async (ref) => {
      await channel.stashApply(ref);
    },
    stashPop: async (ref) => {
      await channel.stashPop(ref);
    },
    stashDrop: async (ref) => {
      await channel.stashDrop(ref);
    },
  };
}

export const gitScmService = createGitScmService(gitChannel);

function createDefaultPushErrorContextResolver(
  channel: GitChannel,
): GitScmPushErrorContextResolver {
  return async () => {
    const [status, remotes] = await Promise.all([channel.status(), channel.remotes()]);
    return { root: null, status, remotes: remotes.remotes };
  };
}

async function handlePushError(
  registry: Pick<PushErrorHandlerRegistry, 'getPushErrorHandlers'>,
  resolveContext: GitScmPushErrorContextResolver,
  err: unknown,
): Promise<boolean> {
  return handleGitPushError(registry, () => resolveTrackedPushErrorTarget(resolveContext), err);
}

async function handlePublishError(
  registry: Pick<PushErrorHandlerRegistry, 'getPushErrorHandlers'>,
  resolveContext: GitScmPushErrorContextResolver,
  remoteName: string | undefined,
  err: unknown,
): Promise<boolean> {
  return handleGitPushError(
    registry,
    () => resolvePublishPushErrorTarget(resolveContext, remoteName),
    err,
  );
}

async function handleGitPushError(
  registry: Pick<PushErrorHandlerRegistry, 'getPushErrorHandlers'>,
  resolveTarget: () => Promise<{
    readonly repository: PushErrorRepository;
    readonly remote: GitRemoteInfo;
    readonly refspec: string;
  } | null>,
  err: unknown,
): Promise<boolean> {
  if (!(err instanceof GitError)) return false;

  const handlers = registry.getPushErrorHandlers();
  if (handlers.length === 0) return false;

  const target = await resolveTarget();
  if (target === null) return false;

  return runPushErrorHandlers(
    { getPushErrorHandlers: () => handlers },
    target.repository,
    target.remote,
    target.refspec,
    err,
  );
}

async function resolveTrackedPushErrorTarget(
  resolveContext: GitScmPushErrorContextResolver,
): Promise<{
  readonly repository: PushErrorRepository;
  readonly remote: GitRemoteInfo;
  readonly refspec: string;
} | null> {
  let context: GitScmPushErrorContext;
  try {
    context = await resolveContext();
  } catch {
    return null;
  }

  const status = context.status;
  if (status === null) return null;
  if (status.branch === null || status.detached === true) return null;

  const upstream = parseUpstream(status.upstream);
  if (upstream === null) return null;

  const remote = context.remotes.find((item) => item.name === upstream.remote);
  if (remote === undefined) return null;

  return {
    repository: { root: context.root, status },
    remote,
    refspec: `${status.branch}:${upstream.branch}`,
  };
}

async function resolvePublishPushErrorTarget(
  resolveContext: GitScmPushErrorContextResolver,
  remoteName: string | undefined,
): Promise<{
  readonly repository: PushErrorRepository;
  readonly remote: GitRemoteInfo;
  readonly refspec: string;
} | null> {
  let context: GitScmPushErrorContext;
  try {
    context = await resolveContext();
  } catch {
    return null;
  }

  const status = context.status;
  if (status === null || status.branch === null || status.detached === true) return null;

  const remote =
    remoteName !== undefined
      ? context.remotes.find((item) => item.name === remoteName)
      : singleWritableRemote(context.remotes);
  if (remote === undefined) return null;

  return {
    repository: { root: context.root, status },
    remote,
    refspec: status.branch,
  };
}

function singleWritableRemote(remotes: readonly GitRemoteInfo[]): GitRemoteInfo | undefined {
  const writable = remotes.filter((remote) => !remote.isReadOnly);
  return writable.length === 1 ? writable[0] : undefined;
}

function parseUpstream(upstream: string | null): { remote: string; branch: string } | null {
  if (upstream === null) return null;
  const slash = upstream.indexOf('/');
  if (slash <= 0 || slash === upstream.length - 1) return null;
  return { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
}
