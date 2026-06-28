import type { IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  type FileEventBridge as FileEventBridgeContract,
  WATCHER_IPC_CHANNELS,
  type WorkspaceFileEvent,
  asWorkspaceFileEvent,
} from '../common/files.js';

export type { FileEventBridge, WorkspaceFileEvent } from '../common/files.js';

export function createFileEventBridge(ipcRenderer: IpcRendererLike): FileEventBridgeContract {
  return {
    onFileEvent: (handler) => {
      const wrapped = (_e: unknown, event: unknown): void => {
        const sanitized = asWorkspaceFileEvent(event);
        if (sanitized) handler(sanitized);
      };
      ipcRenderer.on(WATCHER_IPC_CHANNELS.fileEvent, wrapped);
      return () => ipcRenderer.off(WATCHER_IPC_CHANNELS.fileEvent, wrapped);
    },
  };
}
