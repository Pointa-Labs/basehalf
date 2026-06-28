import type { Disposable, IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import { UPDATE_IPC_CHANNELS } from '../common/update.js';

export interface UpdateBridge {
  updateGetState(): Promise<unknown>;
  updateCheck(): Promise<void>;
  updateDownload(): Promise<void>;
  updateInstall(): Promise<void>;
  updateJustInstalled(): Promise<unknown>;
  onUpdateState(handler: (state: unknown) => void): Disposable;
}

export function createUpdateBridge(ipcRenderer: IpcRendererLike): UpdateBridge {
  return {
    updateGetState: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.getState),
    updateCheck: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.check) as Promise<void>,
    updateDownload: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.download) as Promise<void>,
    updateInstall: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.install) as Promise<void>,
    updateJustInstalled: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.justInstalled),
    onUpdateState: (handler) => {
      const wrapped = (_e: unknown, state: unknown): void => handler(state);
      ipcRenderer.on(UPDATE_IPC_CHANNELS.state, wrapped);
      return () => ipcRenderer.off(UPDATE_IPC_CHANNELS.state, wrapped);
    },
  };
}
