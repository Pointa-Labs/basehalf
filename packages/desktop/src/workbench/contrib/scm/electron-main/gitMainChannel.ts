import { type WebContents, ipcMain } from 'electron';
import { GIT_IPC_CHANNELS, gitIpcFailure, gitIpcSuccess } from '../common/git.js';
import type {
  GitApplyArgs,
  GitBlameArgs,
  GitCheckoutArgs,
  GitCreateBranchArgs,
  GitDiffArgs,
  GitFetchArgs,
  GitLogArgs,
  GitRebaseInteractiveArgs,
  GitRebaseItem,
  GitRefsArgs,
  GitResetArgs,
  GitSearchHistoryArgs,
  GitStashArgs,
} from '../common/git.js';
import type { GitMainService } from './gitMainService.js';

type GitIpcHandler = (event: GitIpcEvent, payload?: unknown) => unknown;

export interface IpcMainGitLike {
  handle(channel: string, listener: GitIpcHandler): void;
}

export type GitWorkspaceRootResolver = (sender: WebContents) => string | null;

interface GitIpcEvent {
  readonly sender: WebContents;
}

export class GitMainChannel {
  constructor(
    private readonly git: GitMainService,
    private readonly getWorkspaceRoot: GitWorkspaceRootResolver,
    private readonly ipc: IpcMainGitLike = ipcMain,
  ) {}

  register(): void {
    this.handle(GIT_IPC_CHANNELS.init, (event) => this.git.init(this.root(event)));
    this.handle(GIT_IPC_CHANNELS.stage, (event, paths) =>
      this.git.stage(this.root(event), asPaths(paths)),
    );
    this.handle(GIT_IPC_CHANNELS.stageAll, (event) => this.git.stageAll(this.root(event)));
    this.handle(GIT_IPC_CHANNELS.unstage, (event, paths) =>
      this.git.unstage(this.root(event), asPaths(paths)),
    );
    this.handle(GIT_IPC_CHANNELS.unstageAll, (event) => this.git.unstageAll(this.root(event)));
    this.handle(GIT_IPC_CHANNELS.discard, (event, paths) =>
      this.git.discard(this.root(event), asPaths(paths)),
    );
    this.handle(GIT_IPC_CHANNELS.deleteWorkspaceEntry, (event, payload) => {
      const p = asDeleteWorkspaceEntryPayload(payload);
      return this.git.deleteWorkspaceEntry(this.root(event), p.path, p.kind);
    });
    this.handle(GIT_IPC_CHANNELS.commit, (event, payload) => {
      const p = asCommitPayload(payload);
      return this.git.commit(this.root(event), p.message, p.amend === true ? { amend: true } : {});
    });
    this.handle(GIT_IPC_CHANNELS.push, (event, payload) =>
      this.git.push(this.root(event), asPushPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.publish, (event, payload) =>
      this.git.publish(this.root(event), asPublishPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.pull, (event, payload) =>
      this.git.pull(this.root(event), asPullPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.fetch, (event, payload) =>
      this.git.fetch(this.root(event), asFetchPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.sync, (event) => this.git.sync(this.root(event)));
    this.handle(GIT_IPC_CHANNELS.remotes, (event) => this.git.remotes(this.root(event)));
    this.handle(GIT_IPC_CHANNELS.reset, (event, payload) =>
      this.git.reset(this.root(event), asResetPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.checkout, (event, payload) => {
      const p = asCheckoutPayload(payload);
      const options: { detached?: boolean; force?: boolean; track?: boolean } = {};
      if (p.detached !== undefined) {
        options.detached = p.detached;
      }
      if (p.force !== undefined) {
        options.force = p.force;
      }
      if (p.track !== undefined) {
        options.track = p.track;
      }
      return this.git.checkout(this.root(event), p.branch, options);
    });
    this.handle(GIT_IPC_CHANNELS.createBranch, (event, payload) => {
      const { name, ...options } = asCreateBranchPayload(payload);
      return this.git.createBranch(this.root(event), name, options);
    });
    this.handle(GIT_IPC_CHANNELS.renameBranch, (event, payload) => {
      const p = asRenameBranchPayload(payload);
      return this.git.renameBranch(this.root(event), p.from, p.to);
    });
    this.handle(GIT_IPC_CHANNELS.renameCurrentBranch, (event, payload) => {
      const p = asRenameCurrentBranchPayload(payload);
      return this.git.renameCurrentBranch(this.root(event), p.to);
    });
    this.handle(GIT_IPC_CHANNELS.deleteBranch, (event, payload) => {
      const p = asDeleteBranchPayload(payload);
      return this.git.deleteBranch(
        this.root(event),
        p.name,
        p.force !== undefined ? { force: p.force } : {},
      );
    });
    this.handle(GIT_IPC_CHANNELS.deleteRemoteRef, (event, payload) => {
      const p = asDeleteRemoteRefPayload(payload);
      return this.git.deleteRemoteRef(
        this.root(event),
        p.remote,
        p.name,
        p.force !== undefined ? { force: p.force } : {},
      );
    });
    this.handle(GIT_IPC_CHANNELS.merge, (event, branch) =>
      this.git.merge(this.root(event), asNonEmptyString(branch, 'Invalid merge branch.')),
    );
    this.handle(GIT_IPC_CHANNELS.cherryPick, (event, ref) =>
      this.git.cherryPick(this.root(event), asNonEmptyString(ref, 'Invalid cherry-pick ref.')),
    );
    this.handle(GIT_IPC_CHANNELS.revert, (event, ref) =>
      this.git.revert(this.root(event), asNonEmptyString(ref, 'Invalid revert ref.')),
    );
    this.handle(GIT_IPC_CHANNELS.rebase, (event, branch) =>
      this.git.rebase(this.root(event), asNonEmptyString(branch, 'Invalid rebase branch.')),
    );
    this.handle(GIT_IPC_CHANNELS.rebaseInteractive, (event, payload) =>
      this.git.rebaseInteractive(this.root(event), asRebaseInteractivePayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.tag, (event, payload) => {
      const p = asTagPayload(payload);
      return this.git.tag(this.root(event), p.name, p.ref);
    });
    this.handle(GIT_IPC_CHANNELS.tagDelete, (event, name) =>
      this.git.tagDelete(this.root(event), asNonEmptyString(name, 'Invalid tag name.')),
    );
    this.handle(GIT_IPC_CHANNELS.status, (event) => this.git.status(this.root(event)));
    this.handle(GIT_IPC_CHANNELS.show, (event, payload) => {
      const p = asShowPayload(payload);
      return this.git.show(this.root(event), p.ref, p.path);
    });
    this.handle(GIT_IPC_CHANNELS.diff, (event, payload) => {
      const p = asDiffPayload(payload);
      return this.git.diff(this.root(event), p.path, p);
    });
    this.handle(GIT_IPC_CHANNELS.apply, (event, payload) =>
      this.git.apply(this.root(event), asApplyPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.blame, (event, payload) => {
      const p = asBlamePayload(payload);
      return this.git.blame(this.root(event), p.path, p);
    });
    this.handle(GIT_IPC_CHANNELS.conflictStages, (event, path) =>
      this.git.conflictStages(
        this.root(event),
        asNonEmptyString(path, 'Invalid conflict stages path.'),
      ),
    );
    this.handle(GIT_IPC_CHANNELS.refs, (event, payload) =>
      this.git.refs(this.root(event), asRefsPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.log, (event, payload) =>
      this.git.log(this.root(event), asLogPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.mergeBase, (event, payload) =>
      this.git.mergeBase(this.root(event), asMergeBasePayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.searchHistory, (event, payload) =>
      this.git.searchHistory(this.root(event), asSearchHistoryPayload(payload)),
    );
    this.handle(GIT_IPC_CHANNELS.commitFiles, (event, payload) => {
      const p = asCommitFilesPayload(payload);
      return this.git.commitFiles(this.root(event), p.ref, p.parent);
    });
    this.handle(GIT_IPC_CHANNELS.stash, (event, payload) => {
      const p = asStashPayload(payload);
      return this.git.stash(this.root(event), p.message, p);
    });
    this.handle(GIT_IPC_CHANNELS.stashList, (event) => this.git.stashList(this.root(event)));
    this.handle(GIT_IPC_CHANNELS.stashApply, (event, ref) =>
      this.git.stashApply(this.root(event), asNonEmptyString(ref, 'Invalid stash ref.')),
    );
    this.handle(GIT_IPC_CHANNELS.stashPop, (event, ref) =>
      this.git.stashPop(
        this.root(event),
        ref === undefined ? undefined : asNonEmptyString(ref, 'Invalid stash ref.'),
      ),
    );
    this.handle(GIT_IPC_CHANNELS.stashDrop, (event, ref) =>
      this.git.stashDrop(this.root(event), asNonEmptyString(ref, 'Invalid stash ref.')),
    );
  }

  private handle(channel: string, listener: GitIpcHandler): void {
    this.ipc.handle(channel, async (event, payload) => {
      try {
        return gitIpcSuccess(await listener(event, payload));
      } catch (err) {
        return gitIpcFailure(err);
      }
    });
  }

  private root(event: GitIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}

function asPaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid paths payload.');
  return value.map((item) => asNonEmptyString(item, 'Invalid path.'));
}

function asDeleteWorkspaceEntryPayload(payload: unknown): {
  path: string;
  kind: 'file' | 'folder';
} {
  const p = asRecord(payload, 'Invalid delete payload.');
  if (typeof p.path !== 'string') throw new Error('Invalid delete path.');
  const normalized = p.path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') {
    throw new Error('Delete path must name an entry inside the workspace.');
  }
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(p.path)) throw new Error('Invalid delete path.');
  if (p.path.split(/[\\/]/).some((seg) => seg === '..')) throw new Error('Invalid delete path.');
  if (p.kind !== 'file' && p.kind !== 'folder') throw new Error('Invalid delete kind.');
  return { path: p.path, kind: p.kind };
}

function asCommitPayload(payload: unknown): { message: string; amend?: boolean } {
  const p = asRecord(payload, 'Invalid commit payload.');
  const message = asString(p.message, 'Invalid commit message.');
  const amend = asOptionalBoolean(p.amend, 'Invalid commit amend option.');
  return amend === undefined ? { message } : { message, amend };
}

function asPushPayload(payload: unknown): { force?: boolean } {
  const p = asOptionalRecord(payload, 'Invalid push payload.');
  const force = asOptionalBoolean(p.force, 'Invalid push force option.');
  return force === undefined ? {} : { force };
}

function asPublishPayload(payload: unknown): { remote?: string } {
  const p = asOptionalRecord(payload, 'Invalid publish payload.');
  const remote = asOptionalNonEmptyString(p.remote, 'Invalid publish remote.');
  return remote === undefined ? {} : { remote };
}

function asPullPayload(payload: unknown): { rebase?: boolean } {
  const p = asOptionalRecord(payload, 'Invalid pull payload.');
  const rebase = asOptionalBoolean(p.rebase, 'Invalid pull rebase option.');
  return rebase === undefined ? {} : { rebase };
}

function asFetchPayload(payload: unknown): GitFetchArgs {
  const p = asOptionalRecord(payload, 'Invalid fetch payload.');
  const remote = asOptionalNonEmptyString(p.remote, 'Invalid fetch remote.');
  const all = asOptionalBoolean(p.all, 'Invalid fetch all option.');
  const out: { remote?: string; all?: boolean } = {};
  if (remote !== undefined) out.remote = remote;
  if (all !== undefined) out.all = all;
  return out;
}

function asResetPayload(payload: unknown): GitResetArgs {
  const p = asRecord(payload, 'Invalid reset payload.');
  const ref = asNonEmptyString(p.ref, 'Invalid reset ref.');
  if (p.mode !== undefined && p.mode !== 'soft' && p.mode !== 'mixed' && p.mode !== 'hard') {
    throw new Error('Invalid reset mode.');
  }
  return p.mode === undefined ? { ref } : { ref, mode: p.mode };
}

function asCheckoutPayload(payload: unknown): GitCheckoutArgs {
  const p = asRecord(payload, 'Invalid checkout payload.');
  const out: {
    branch: string;
    detached?: boolean;
    force?: boolean;
    track?: boolean;
  } = { branch: asNonEmptyString(p.branch, 'Invalid checkout branch.') };
  const detached = asOptionalBoolean(p.detached, 'Invalid checkout detached option.');
  const force = asOptionalBoolean(p.force, 'Invalid checkout force option.');
  const track = asOptionalBoolean(p.track, 'Invalid checkout track option.');
  if (p.create !== undefined) throw new Error('Invalid checkout create option.');
  if (detached !== undefined) out.detached = detached;
  if (force !== undefined) out.force = force;
  if (track !== undefined) out.track = track;
  return out;
}

function asCreateBranchPayload(payload: unknown): GitCreateBranchArgs {
  const p = asRecord(payload, 'Invalid create branch payload.');
  const out: {
    name: string;
    ref?: string;
    checkout?: boolean;
  } = { name: asNonEmptyString(p.name, 'Invalid branch name.') };
  const ref = asOptionalNonEmptyString(p.ref, 'Invalid branch start ref.');
  const checkout = asOptionalBoolean(p.checkout, 'Invalid branch checkout option.');
  if (ref !== undefined) out.ref = ref;
  if (checkout !== undefined) out.checkout = checkout;
  return out;
}

function asRenameBranchPayload(payload: unknown): { from: string; to: string } {
  const p = asRecord(payload, 'Invalid rename branch payload.');
  return {
    from: asNonEmptyString(p.from, 'Invalid source branch.'),
    to: asNonEmptyString(p.to, 'Invalid target branch.'),
  };
}

function asRenameCurrentBranchPayload(payload: unknown): { to: string } {
  const p = asRecord(payload, 'Invalid rename current branch payload.');
  return { to: asNonEmptyString(p.to, 'Invalid target branch.') };
}

function asDeleteBranchPayload(payload: unknown): { name: string; force?: boolean } {
  const p = asRecord(payload, 'Invalid delete branch payload.');
  const name = asNonEmptyString(p.name, 'Invalid branch name.');
  const force = asOptionalBoolean(p.force, 'Invalid delete branch force option.');
  return force === undefined ? { name } : { name, force };
}

function asDeleteRemoteRefPayload(payload: unknown): {
  remote: string;
  name: string;
  force?: boolean;
} {
  const p = asRecord(payload, 'Invalid delete remote ref payload.');
  const remote = asNonEmptyString(p.remote, 'Invalid remote name.');
  const name = asNonEmptyString(p.name, 'Invalid remote ref name.');
  const force = asOptionalBoolean(p.force, 'Invalid delete remote ref force option.');
  return force === undefined ? { remote, name } : { remote, name, force };
}

function asRebaseInteractivePayload(payload: unknown): GitRebaseInteractiveArgs {
  const p = asRecord(payload, 'Invalid rebase payload.');
  if (!Array.isArray(p.items)) throw new Error('Invalid rebase items.');
  return {
    base: asNonEmptyString(p.base, 'Invalid rebase base.'),
    items: p.items.map(asRebaseItem),
  };
}

function asRebaseItem(value: unknown): GitRebaseItem {
  const p = asRecord(value, 'Invalid rebase item.');
  const action = p.action;
  if (action !== 'pick' && action !== 'drop' && action !== 'fixup' && action !== 'reword') {
    throw new Error('Invalid rebase item action.');
  }
  const sha = asNonEmptyString(p.sha, 'Invalid rebase item sha.');
  const message = asOptionalString(p.message, 'Invalid rebase item message.');
  return message === undefined ? { sha, action } : { sha, action, message };
}

function asTagPayload(payload: unknown): { name: string; ref?: string } {
  const p = asRecord(payload, 'Invalid tag payload.');
  const name = asNonEmptyString(p.name, 'Invalid tag name.');
  const ref = asOptionalNonEmptyString(p.ref, 'Invalid tag ref.');
  return ref === undefined ? { name } : { name, ref };
}

function asShowPayload(payload: unknown): { ref: string; path: string } {
  const p = asRecord(payload, 'Invalid show payload.');
  return {
    ref: asString(p.ref, 'Invalid show ref.'),
    path: asNonEmptyString(p.path, 'Invalid show path.'),
  };
}

function asDiffPayload(payload: unknown): GitDiffArgs {
  const p = asRecord(payload, 'Invalid diff payload.');
  const out: { path: string; staged?: boolean } = {
    path: asNonEmptyString(p.path, 'Invalid diff path.'),
  };
  const staged = asOptionalBoolean(p.staged, 'Invalid diff staged option.');
  if (staged !== undefined) out.staged = staged;
  return out;
}

function asApplyPayload(payload: unknown): GitApplyArgs {
  const p = asRecord(payload, 'Invalid apply payload.');
  const out: { patch: string; cached?: boolean; reverse?: boolean } = {
    patch: asString(p.patch, 'Invalid apply patch.'),
  };
  const cached = asOptionalBoolean(p.cached, 'Invalid apply cached option.');
  const reverse = asOptionalBoolean(p.reverse, 'Invalid apply reverse option.');
  if (cached !== undefined) out.cached = cached;
  if (reverse !== undefined) out.reverse = reverse;
  return out;
}

function asBlamePayload(payload: unknown): GitBlameArgs {
  const p = asRecord(payload, 'Invalid blame payload.');
  const out: { path: string; ref?: string } = {
    path: asNonEmptyString(p.path, 'Invalid blame path.'),
  };
  const ref = asOptionalString(p.ref, 'Invalid blame ref.');
  if (ref !== undefined) out.ref = ref;
  return out;
}

function asRefsPayload(payload: unknown): GitRefsArgs {
  const p = asOptionalRecord(payload, 'Invalid refs payload.');
  const out: { includeRemote?: boolean; includeTags?: boolean } = {};
  const includeRemote = asOptionalBoolean(p.includeRemote, 'Invalid refs includeRemote option.');
  const includeTags = asOptionalBoolean(p.includeTags, 'Invalid refs includeTags option.');
  if (includeRemote !== undefined) out.includeRemote = includeRemote;
  if (includeTags !== undefined) out.includeTags = includeTags;
  return out;
}

function asLogPayload(payload: unknown): GitLogArgs {
  const p = asRecord(payload, 'Invalid log payload.');
  const out: {
    ref?: string;
    refNames?: readonly string[];
    maxCount?: number;
    maxParents?: number;
    skip?: number;
    path?: string;
    all?: boolean;
  } = {};
  const ref = asOptionalNonEmptyString(p.ref, 'Invalid log ref.');
  const refNames = asOptionalStringArray(p.refNames, 'Invalid log refs.');
  const maxCount = asOptionalCount(p.maxCount, 'Invalid log maxCount.');
  const maxParents = asOptionalCount(p.maxParents, 'Invalid log maxParents.');
  const skip = asOptionalCount(p.skip, 'Invalid log skip.');
  const path = asOptionalNonEmptyString(p.path, 'Invalid log path.');
  const all = asOptionalBoolean(p.all, 'Invalid log all option.');
  if (ref !== undefined) out.ref = ref;
  if (refNames !== undefined) out.refNames = refNames;
  if (maxCount !== undefined) out.maxCount = maxCount;
  if (maxParents !== undefined) out.maxParents = maxParents;
  if (skip !== undefined) out.skip = skip;
  if (path !== undefined) out.path = path;
  if (all !== undefined) out.all = all;
  return out;
}

function asSearchHistoryPayload(payload: unknown): GitSearchHistoryArgs {
  const p = asRecord(payload, 'Invalid search history payload.');
  const out: {
    query: string;
    maxCount?: number;
    path?: string;
    ignoreCase?: boolean;
  } = { query: asString(p.query, 'Invalid search history query.') };
  const maxCount = asOptionalCount(p.maxCount, 'Invalid search history maxCount.');
  const path = asOptionalNonEmptyString(p.path, 'Invalid search history path.');
  const ignoreCase = asOptionalBoolean(p.ignoreCase, 'Invalid search history ignoreCase option.');
  if (maxCount !== undefined) out.maxCount = maxCount;
  if (path !== undefined) out.path = path;
  if (ignoreCase !== undefined) out.ignoreCase = ignoreCase;
  return out;
}

function asCommitFilesPayload(payload: unknown): { ref: string; parent?: string } {
  if (typeof payload === 'string' && payload !== '') return { ref: payload };
  const p = asRecord(payload, 'Invalid commit files payload.');
  const ref = asNonEmptyString(p.ref, 'Invalid commit files ref.');
  const parent = asOptionalNonEmptyString(p.parent, 'Invalid commit files parent.');
  return parent === undefined ? { ref } : { ref, parent };
}

function asStashPayload(payload: unknown): GitStashArgs {
  const p = asOptionalRecord(payload, 'Invalid stash payload.');
  const out: { message?: string; includeUntracked?: boolean } = {};
  const message = asOptionalString(p.message, 'Invalid stash message.');
  const includeUntracked = asOptionalBoolean(
    p.includeUntracked,
    'Invalid stash includeUntracked option.',
  );
  if (message !== undefined) out.message = message;
  if (includeUntracked !== undefined) out.includeUntracked = includeUntracked;
  return out;
}

function asMergeBasePayload(payload: unknown): string[] {
  if (!Array.isArray(payload)) throw new Error('Invalid merge-base payload.');
  const refs = payload.filter((item): item is string => typeof item === 'string' && item !== '');
  if (refs.length !== payload.length) throw new Error('Invalid merge-base ref.');
  return refs;
}

function asRecord(value: unknown, error: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown, error: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return asRecord(value, error);
}

function asString(value: unknown, error: string): string {
  if (typeof value !== 'string') throw new Error(error);
  return value;
}

function asNonEmptyString(value: unknown, error: string): string {
  const str = asString(value, error);
  if (str === '') throw new Error(error);
  return str;
}

function asOptionalString(value: unknown, error: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, error);
}

function asOptionalNonEmptyString(value: unknown, error: string): string | undefined {
  if (value === undefined) return undefined;
  return asNonEmptyString(value, error);
}

function asOptionalBoolean(value: unknown, error: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(error);
  return value;
}

function asOptionalCount(value: unknown, error: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(error);
  return value;
}

function asOptionalStringArray(value: unknown, error: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(error);
  return value.map((item) => asNonEmptyString(item, error));
}
