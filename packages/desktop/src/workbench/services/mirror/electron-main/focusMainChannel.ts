import { type WebContents, ipcMain } from 'electron';
import { FOCUS_IPC_CHANNELS } from '../common/focus.js';
import type { FocusMainService } from './focusMainService.js';
import {
  asFocusPurgeNodeArgs,
  asFocusRelocateArgs,
  asFocusSetArgs,
} from './ipcPayloadValidation.js';

type FocusIpcHandler = (event: FocusIpcEvent, payload?: unknown) => unknown;

export interface IpcMainFocusLike {
  handle(channel: string, listener: FocusIpcHandler): void;
}

export type FocusWorkspaceRootResolver = (sender: WebContents) => string | null;

interface FocusIpcEvent {
  readonly sender: WebContents;
}

export class FocusMainChannel {
  constructor(
    private readonly focus: FocusMainService,
    private readonly getWorkspaceRoot: FocusWorkspaceRootResolver,
    private readonly ipc: IpcMainFocusLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(FOCUS_IPC_CHANNELS.set, async (event, args) =>
      this.focus.set(this.root(event), asFocusSetArgs(args)),
    );
    this.ipc.handle(FOCUS_IPC_CHANNELS.get, (event) => this.focus.get(this.root(event)));
    this.ipc.handle(FOCUS_IPC_CHANNELS.clear, (event) => this.focus.clear(this.root(event)));
    this.ipc.handle(FOCUS_IPC_CHANNELS.pruneDangling, (event) =>
      this.focus.pruneDangling(this.root(event)),
    );
    this.ipc.handle(FOCUS_IPC_CHANNELS.relocate, async (event, args) =>
      this.focus.relocate(this.root(event), asFocusRelocateArgs(args)),
    );
    this.ipc.handle(FOCUS_IPC_CHANNELS.purgeNode, async (event, args) =>
      this.focus.purgeNode(this.root(event), asFocusPurgeNodeArgs(args)),
    );
  }

  private root(event: FocusIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}
