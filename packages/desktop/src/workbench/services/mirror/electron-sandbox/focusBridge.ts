import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import { FOCUS_IPC_CHANNELS, type FocusChannelBridge } from '../common/focus.js';

export interface FocusBridge {
  readonly focus: FocusChannelBridge;
}

export function createFocusBridge(ipcRenderer: IpcRendererLike): FocusBridge {
  return {
    focus: {
      set: (args) =>
        ipcRenderer.invoke(FOCUS_IPC_CHANNELS.set, args) as ReturnType<FocusChannelBridge['set']>,
      get: () =>
        ipcRenderer.invoke(FOCUS_IPC_CHANNELS.get) as ReturnType<FocusChannelBridge['get']>,
      clear: () =>
        ipcRenderer.invoke(FOCUS_IPC_CHANNELS.clear) as ReturnType<FocusChannelBridge['clear']>,
      pruneDangling: () =>
        ipcRenderer.invoke(FOCUS_IPC_CHANNELS.pruneDangling) as ReturnType<
          FocusChannelBridge['pruneDangling']
        >,
      relocate: (args) =>
        ipcRenderer.invoke(FOCUS_IPC_CHANNELS.relocate, args) as ReturnType<
          FocusChannelBridge['relocate']
        >,
      purgeNode: (args) =>
        ipcRenderer.invoke(FOCUS_IPC_CHANNELS.purgeNode, args) as ReturnType<
          FocusChannelBridge['purgeNode']
        >,
    },
  };
}
