import { type WebContents, ipcMain } from 'electron';
import { GIT_IPC_CHANNELS } from '../common/git.js';
import type { GitResetArgs } from '../common/git.js';
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
    this.ipc.handle(GIT_IPC_CHANNELS.init, (event) => this.git.init(this.root(event)));
    this.ipc.handle(GIT_IPC_CHANNELS.stage, (event, paths) =>
      this.git.stage(this.root(event), asPaths(paths)),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.stageAll, (event) => this.git.stageAll(this.root(event)));
    this.ipc.handle(GIT_IPC_CHANNELS.unstage, (event, paths) =>
      this.git.unstage(this.root(event), asPaths(paths)),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.unstageAll, (event) => this.git.unstageAll(this.root(event)));
    this.ipc.handle(GIT_IPC_CHANNELS.discard, (event, paths) =>
      this.git.discard(this.root(event), asPaths(paths)),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.deleteWorkspaceEntry, (event, payload) => {
      const p = asDeleteWorkspaceEntryPayload(payload);
      return this.git.deleteWorkspaceEntry(this.root(event), p.path, p.kind);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.commit, (event, payload) => {
      const p = payload as { message: string; amend?: boolean };
      return this.git.commit(this.root(event), p.message, p.amend === true ? { amend: true } : {});
    });
    this.ipc.handle(GIT_IPC_CHANNELS.push, (event, payload) =>
      this.git.push(this.root(event), (payload ?? {}) as { force?: boolean }),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.pull, (event, payload) =>
      this.git.pull(this.root(event), (payload ?? {}) as { rebase?: boolean }),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.fetch, (event) => this.git.fetch(this.root(event)));
    this.ipc.handle(GIT_IPC_CHANNELS.sync, (event) => this.git.sync(this.root(event)));
    this.ipc.handle(GIT_IPC_CHANNELS.reset, (event, payload) =>
      this.git.reset(this.root(event), asResetPayload(payload)),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.checkout, (event, payload) => {
      const p = payload as { branch: string; force?: boolean; track?: boolean };
      const options: { force?: boolean; track?: boolean } = {};
      if (p.force !== undefined) {
        options.force = p.force;
      }
      if (p.track !== undefined) {
        options.track = p.track;
      }
      return this.git.checkout(this.root(event), p.branch, options);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.createBranch, (event, payload) => {
      const { name, ...options } = payload as { name: string };
      return this.git.createBranch(this.root(event), name, options);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.renameBranch, (event, payload) => {
      const p = payload as { from: string; to: string };
      return this.git.renameBranch(this.root(event), p.from, p.to);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.renameCurrentBranch, (event, payload) => {
      const p = payload as { to: string };
      return this.git.renameCurrentBranch(this.root(event), p.to);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.deleteBranch, (event, payload) => {
      const p = payload as { name: string; force?: boolean };
      return this.git.deleteBranch(
        this.root(event),
        p.name,
        p.force !== undefined ? { force: p.force } : {},
      );
    });
    this.ipc.handle(GIT_IPC_CHANNELS.merge, (event, branch) =>
      this.git.merge(this.root(event), branch as string),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.cherryPick, (event, ref) =>
      this.git.cherryPick(this.root(event), ref as string),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.revert, (event, ref) =>
      this.git.revert(this.root(event), ref as string),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.rebaseInteractive, (event, payload) =>
      this.git.rebaseInteractive(this.root(event), payload as never),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.tag, (event, payload) => {
      const p = payload as { name: string; ref?: string };
      return this.git.tag(this.root(event), p.name, p.ref);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.tagDelete, (event, name) =>
      this.git.tagDelete(this.root(event), name as string),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.status, (event) => this.git.status(this.root(event)));
    this.ipc.handle(GIT_IPC_CHANNELS.show, (event, payload) => {
      const p = payload as { ref: string; path: string };
      return this.git.show(this.root(event), p.ref, p.path);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.diff, (event, payload) => {
      const p = payload as { path: string };
      return this.git.diff(this.root(event), p.path, payload as never);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.apply, (event, payload) =>
      this.git.apply(this.root(event), payload as never),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.blame, (event, payload) => {
      const p = payload as { path: string };
      return this.git.blame(this.root(event), p.path, payload as never);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.conflictStages, (event, path) =>
      this.git.conflictStages(this.root(event), path as string),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.refs, (event, payload) =>
      this.git.refs(this.root(event), payload as never),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.log, (event, payload) =>
      this.git.log(this.root(event), payload as never),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.searchHistory, (event, payload) =>
      this.git.searchHistory(this.root(event), payload as never),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.commitFiles, (event, ref) =>
      this.git.commitFiles(this.root(event), ref as string),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.stash, (event, payload) => {
      const p = (payload ?? {}) as { message?: string };
      return this.git.stash(this.root(event), p.message, payload as never);
    });
    this.ipc.handle(GIT_IPC_CHANNELS.stashList, (event) => this.git.stashList(this.root(event)));
    this.ipc.handle(GIT_IPC_CHANNELS.stashApply, (event, ref) =>
      this.git.stashApply(this.root(event), ref as string),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.stashPop, (event, ref) =>
      this.git.stashPop(this.root(event), ref as string | undefined),
    );
    this.ipc.handle(GIT_IPC_CHANNELS.stashDrop, (event, ref) =>
      this.git.stashDrop(this.root(event), ref as string),
    );
  }

  private root(event: GitIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}

function asPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asDeleteWorkspaceEntryPayload(payload: unknown): {
  path: string;
  kind: 'file' | 'folder';
} {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid delete payload.');
  const p = payload as Record<string, unknown>;
  if (typeof p.path !== 'string') throw new Error('Invalid delete path.');
  const normalized = p.path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') {
    throw new Error('Delete path must name an entry inside the workspace.');
  }
  if (p.kind !== 'file' && p.kind !== 'folder') throw new Error('Invalid delete kind.');
  return { path: p.path, kind: p.kind };
}

function asResetPayload(payload: unknown): GitResetArgs {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid reset payload.');
  const p = payload as Record<string, unknown>;
  if (typeof p.ref !== 'string' || p.ref === '') throw new Error('Invalid reset ref.');
  if (p.mode !== undefined && p.mode !== 'soft' && p.mode !== 'mixed' && p.mode !== 'hard') {
    throw new Error('Invalid reset mode.');
  }
  return p.mode === undefined ? { ref: p.ref } : { ref: p.ref, mode: p.mode };
}
