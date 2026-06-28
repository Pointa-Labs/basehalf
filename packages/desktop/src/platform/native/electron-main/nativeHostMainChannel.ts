import { type WebContents, ipcMain } from 'electron';
import { NATIVE_HOST_IPC_CHANNELS } from '../common/native.js';
import type { NativeHostMainService } from './nativeHostMainService.js';

type NativeHostIpcHandler = (event: NativeHostIpcEvent, payload?: unknown) => unknown;

export interface IpcMainNativeHostLike {
  handle(channel: string, listener: NativeHostIpcHandler): void;
}

export type NativeHostWorkspaceRootResolver = (sender: WebContents) => string | null;

interface NativeHostIpcEvent {
  readonly sender: WebContents;
}

/**
 * IPC channel for native host capabilities. It mirrors VS Code's
 * nativeHost channel boundary: renderer messages cross here, then delegate to
 * NativeHostMainService for the actual OS-facing behavior.
 */
export class NativeHostMainChannel {
  constructor(
    private readonly nativeHost: NativeHostMainService,
    private readonly getWorkspaceRoot: NativeHostWorkspaceRootResolver,
    private readonly ipc: IpcMainNativeHostLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(NATIVE_HOST_IPC_CHANNELS.pickWorkspace, (event) =>
      this.nativeHost.pickWorkspace(event.sender),
    );
    this.ipc.handle(NATIVE_HOST_IPC_CHANNELS.openPath, (event, relPath) =>
      this.nativeHost.openPath(this.getWorkspaceRoot(event.sender), relPath),
    );
    this.ipc.handle(NATIVE_HOST_IPC_CHANNELS.pathKind, (_event, path) =>
      this.nativeHost.pathKind(path),
    );
    this.ipc.handle(NATIVE_HOST_IPC_CHANNELS.openExternal, (_event, url) =>
      this.nativeHost.openExternal(url),
    );
  }
}
