import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import {
  CANVAS_IPC_CHANNELS,
  type CanvasBridge,
  type CanvasChannelBridge,
} from '../common/canvas.js';

export type { CanvasBridge } from '../common/canvas.js';

export function createCanvasBridge(ipcRenderer: IpcRendererLike): CanvasBridge {
  return {
    canvas: {
      get: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.get, args) as ReturnType<CanvasChannelBridge['get']>,
      setCard: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.setCard, args) as ReturnType<
          CanvasChannelBridge['setCard']
        >,
      removeCard: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.removeCard, args) as ReturnType<
          CanvasChannelBridge['removeCard']
        >,
      setSize: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.setSize, args) as ReturnType<
          CanvasChannelBridge['setSize']
        >,
      connect: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.connect, args) as ReturnType<
          CanvasChannelBridge['connect']
        >,
      disconnect: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.disconnect, args) as ReturnType<
          CanvasChannelBridge['disconnect']
        >,
      reconnect: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.reconnect, args) as ReturnType<
          CanvasChannelBridge['reconnect']
        >,
      revision: () =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.revision) as ReturnType<
          CanvasChannelBridge['revision']
        >,
      relocate: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.relocate, args) as ReturnType<
          CanvasChannelBridge['relocate']
        >,
      purgeNode: (args) =>
        ipcRenderer.invoke(CANVAS_IPC_CHANNELS.purgeNode, args) as ReturnType<
          CanvasChannelBridge['purgeNode']
        >,
    },
  };
}
