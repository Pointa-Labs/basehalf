import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import { BADGE_IPC_CHANNELS, type BadgeChannelBridge } from '../common/badge.js';

export interface BadgeBridge {
  readonly badge: BadgeChannelBridge;
}

export function createBadgeBridge(ipcRenderer: IpcRendererLike): BadgeBridge {
  return {
    badge: {
      get: (args) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.get, args) as ReturnType<BadgeChannelBridge['get']>,
      set: (args) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.set, args) as ReturnType<BadgeChannelBridge['set']>,
      list: (args = {}) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.list, args) as ReturnType<BadgeChannelBridge['list']>,
      delete: (args) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.delete, args) as ReturnType<
          BadgeChannelBridge['delete']
        >,
      addRef: (args) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.addRef, args) as ReturnType<
          BadgeChannelBridge['addRef']
        >,
      removeRef: (args) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.removeRef, args) as ReturnType<
          BadgeChannelBridge['removeRef']
        >,
      markOrphan: (args) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.markOrphan, args) as ReturnType<
          BadgeChannelBridge['markOrphan']
        >,
      pruneDangling: () =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.pruneDangling) as ReturnType<
          BadgeChannelBridge['pruneDangling']
        >,
      revision: () =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.revision) as ReturnType<
          BadgeChannelBridge['revision']
        >,
      rename: (args) =>
        ipcRenderer.invoke(BADGE_IPC_CHANNELS.rename, args) as ReturnType<
          BadgeChannelBridge['rename']
        >,
    },
  };
}
