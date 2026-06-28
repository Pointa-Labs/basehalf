import { type WebContents, ipcMain } from 'electron';
import { BADGE_IPC_CHANNELS } from '../common/badge.js';
import type { BadgeMainService } from './badgeMainService.js';
import {
  asBadgeDeleteArgs,
  asBadgeGetArgs,
  asBadgeListArgs,
  asBadgeMarkOrphanArgs,
  asBadgeRefArgs,
  asBadgeRenameArgs,
  asBadgeSetArgs,
} from './ipcPayloadValidation.js';

type BadgeIpcHandler = (event: BadgeIpcEvent, payload?: unknown) => unknown;

export interface IpcMainBadgeLike {
  handle(channel: string, listener: BadgeIpcHandler): void;
}

export type BadgeWorkspaceRootResolver = (sender: WebContents) => string | null;

interface BadgeIpcEvent {
  readonly sender: WebContents;
}

export class BadgeMainChannel {
  constructor(
    private readonly badge: BadgeMainService,
    private readonly getWorkspaceRoot: BadgeWorkspaceRootResolver,
    private readonly ipc: IpcMainBadgeLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(BADGE_IPC_CHANNELS.get, async (event, args) =>
      this.badge.get(this.root(event), asBadgeGetArgs(args)),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.set, async (event, args) =>
      this.badge.set(this.root(event), asBadgeSetArgs(args)),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.list, async (event, args) =>
      this.badge.list(this.root(event), asBadgeListArgs(args)),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.delete, async (event, args) =>
      this.badge.delete(this.root(event), asBadgeDeleteArgs(args)),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.addRef, async (event, args) =>
      this.badge.addRef(this.root(event), asBadgeRefArgs(args, 'badge.addRef')),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.removeRef, async (event, args) =>
      this.badge.removeRef(this.root(event), asBadgeRefArgs(args, 'badge.removeRef')),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.markOrphan, async (event, args) =>
      this.badge.markOrphan(this.root(event), asBadgeMarkOrphanArgs(args)),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.pruneDangling, (event) =>
      this.badge.pruneDangling(this.root(event)),
    );
    this.ipc.handle(BADGE_IPC_CHANNELS.revision, (event) => this.badge.revision(this.root(event)));
    this.ipc.handle(BADGE_IPC_CHANNELS.rename, async (event, args) =>
      this.badge.rename(this.root(event), asBadgeRenameArgs(args)),
    );
  }

  private root(event: BadgeIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}
