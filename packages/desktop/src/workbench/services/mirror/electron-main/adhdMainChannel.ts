import { type WebContents, ipcMain } from 'electron';
import { ADHD_IPC_CHANNELS } from '../common/adhd.js';
import type { AdhdMainService } from './adhdMainService.js';
import {
  asAdhdFile,
  asAdhdKeywordArgs,
  asAdhdPurgeNodeArgs,
  asAdhdRangeArgs,
  asAdhdRelocateArgs,
  asAdhdSetArgs,
} from './ipcPayloadValidation.js';

type AdhdIpcHandler = (event: AdhdIpcEvent, payload?: unknown) => unknown;

export interface IpcMainAdhdLike {
  handle(channel: string, listener: AdhdIpcHandler): void;
}

export type AdhdWorkspaceRootResolver = (sender: WebContents) => string | null;

interface AdhdIpcEvent {
  readonly sender: WebContents;
}

export class AdhdMainChannel {
  constructor(
    private readonly adhd: AdhdMainService,
    private readonly getWorkspaceRoot: AdhdWorkspaceRootResolver,
    private readonly ipc: IpcMainAdhdLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(ADHD_IPC_CHANNELS.get, async (event, file) =>
      this.adhd.get(this.root(event), asAdhdFile(file)),
    );
    this.ipc.handle(ADHD_IPC_CHANNELS.set, async (event, args) =>
      this.adhd.set(this.root(event), asAdhdSetArgs(args)),
    );
    this.ipc.handle(ADHD_IPC_CHANNELS.addKeyword, async (event, args) =>
      this.adhd.addKeyword(this.root(event), asAdhdKeywordArgs(args, 'adhd.addKeyword')),
    );
    this.ipc.handle(ADHD_IPC_CHANNELS.removeKeyword, async (event, args) =>
      this.adhd.removeKeyword(this.root(event), asAdhdKeywordArgs(args, 'adhd.removeKeyword')),
    );
    this.ipc.handle(ADHD_IPC_CHANNELS.markRead, async (event, args) =>
      this.adhd.markRead(this.root(event), asAdhdRangeArgs(args, 'adhd.markRead')),
    );
    this.ipc.handle(ADHD_IPC_CHANNELS.markUnread, async (event, args) =>
      this.adhd.markUnread(this.root(event), asAdhdRangeArgs(args, 'adhd.markUnread')),
    );
    this.ipc.handle(ADHD_IPC_CHANNELS.revision, (event) => this.adhd.revision(this.root(event)));
    this.ipc.handle(ADHD_IPC_CHANNELS.relocate, async (event, args) =>
      this.adhd.relocate(this.root(event), asAdhdRelocateArgs(args)),
    );
    this.ipc.handle(ADHD_IPC_CHANNELS.purgeNode, async (event, args) =>
      this.adhd.purgeNode(this.root(event), asAdhdPurgeNodeArgs(args)),
    );
  }

  private root(event: AdhdIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}
