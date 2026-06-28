import type { Disposable, IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  UPDATE_IPC_CHANNELS,
  type UpdateSandboxBridge,
  asJustInstalled,
  asUpdateState,
} from '../common/update.js';

export interface UpdateBridge extends UpdateSandboxBridge {}

export function createUpdateBridge(ipcRenderer: IpcRendererLike): UpdateBridge {
  return {
    updateGetState: async () =>
      asUpdateState(await ipcRenderer.invoke(UPDATE_IPC_CHANNELS.getState)),
    updateCheck: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.check) as Promise<void>,
    updateDownload: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.download) as Promise<void>,
    updateInstall: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.install) as Promise<void>,
    updateJustInstalled: async () =>
      asJustInstalled(await ipcRenderer.invoke(UPDATE_IPC_CHANNELS.justInstalled)),
    onUpdateState: (handler) => {
      const wrapped = (_e: unknown, state: unknown): void => handler(asUpdateState(state));
      ipcRenderer.on(UPDATE_IPC_CHANNELS.state, wrapped);
      return () => ipcRenderer.off(UPDATE_IPC_CHANNELS.state, wrapped);
    },
  };
}
