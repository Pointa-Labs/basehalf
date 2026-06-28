import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import { ADHD_IPC_CHANNELS, type AdhdChannelBridge } from '../common/adhd.js';

export interface AdhdBridge {
  readonly adhd: AdhdChannelBridge;
}

export function createAdhdBridge(ipcRenderer: IpcRendererLike): AdhdBridge {
  return {
    adhd: {
      get: (file) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.get, file) as ReturnType<AdhdChannelBridge['get']>,
      set: (args) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.set, args) as ReturnType<AdhdChannelBridge['set']>,
      addKeyword: (args) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.addKeyword, args) as ReturnType<
          AdhdChannelBridge['addKeyword']
        >,
      removeKeyword: (args) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.removeKeyword, args) as ReturnType<
          AdhdChannelBridge['removeKeyword']
        >,
      markRead: (args) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.markRead, args) as ReturnType<
          AdhdChannelBridge['markRead']
        >,
      markUnread: (args) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.markUnread, args) as ReturnType<
          AdhdChannelBridge['markUnread']
        >,
      revision: () =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.revision) as ReturnType<AdhdChannelBridge['revision']>,
      relocate: (args) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.relocate, args) as ReturnType<
          AdhdChannelBridge['relocate']
        >,
      purgeNode: (args) =>
        ipcRenderer.invoke(ADHD_IPC_CHANNELS.purgeNode, args) as ReturnType<
          AdhdChannelBridge['purgeNode']
        >,
    },
  };
}
