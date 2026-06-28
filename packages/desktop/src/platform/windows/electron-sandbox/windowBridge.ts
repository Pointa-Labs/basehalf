import type {
  Disposable,
  IpcRendererLike,
  WebFrameLike,
} from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  WINDOW_IPC_CHANNELS,
  type WindowBridge,
  asWindowFullscreenState,
  asWindowOpenWorkspaceResult,
  asWindowOpenWorkspaceRoots,
  asWindowWorkspaceMenuAction,
  asWindowZoomFactor,
} from '../common/window.js';

export type { WindowBridge } from '../common/window.js';

export function createWindowBridge(
  ipcRenderer: IpcRendererLike,
  webFrame: WebFrameLike,
): WindowBridge {
  return {
    openWorkspace: async (name) =>
      asWindowOpenWorkspaceResult(
        await ipcRenderer.invoke(WINDOW_IPC_CHANNELS.workspaceOpen, name),
      ),
    reopenWindow: (name) =>
      ipcRenderer.invoke(WINDOW_IPC_CHANNELS.workspaceReopen, name) as Promise<void>,
    newWindow: () => ipcRenderer.invoke(WINDOW_IPC_CHANNELS.newWindow) as Promise<void>,
    getOpenWorkspaces: async () =>
      asWindowOpenWorkspaceRoots(await ipcRenderer.invoke(WINDOW_IPC_CHANNELS.openWorkspaces)),
    notifyWorkspacesChanged: () => {
      ipcRenderer.send(WINDOW_IPC_CHANNELS.workspacesChanged);
    },
    onWorkspacesWindowsChanged: (handler) =>
      onVoid(ipcRenderer, WINDOW_IPC_CHANNELS.workspaceWindowsChanged, handler),
    onFullscreenChange: (handler) =>
      onPayload(ipcRenderer, WINDOW_IPC_CHANNELS.fullscreen, asWindowFullscreenState, handler),
    getZoomFactor: () => webFrame.getZoomFactor(),
    onZoomFactor: (handler) =>
      onPayload(ipcRenderer, WINDOW_IPC_CHANNELS.zoomFactor, asWindowZoomFactor, handler),
    suppressNextNativeContextMenu: () => {
      ipcRenderer.sendSync(WINDOW_IPC_CHANNELS.suppressNextContextMenu);
    },
    onMenuOpenSettings: (handler) =>
      onVoid(ipcRenderer, WINDOW_IPC_CHANNELS.menuOpenSettings, handler),
    onMenuCloseTab: (handler) => onVoid(ipcRenderer, WINDOW_IPC_CHANNELS.menuCloseTab, handler),
    onFlushRequest: (handler) => {
      const wrapped = (): void => {
        void handler().then(
          (ok) => ipcRenderer.send(WINDOW_IPC_CHANNELS.flushReply, ok),
          () => ipcRenderer.send(WINDOW_IPC_CHANNELS.flushReply, false),
        );
      };
      ipcRenderer.on(WINDOW_IPC_CHANNELS.flushRequest, wrapped);
      return () => ipcRenderer.off(WINDOW_IPC_CHANNELS.flushRequest, wrapped);
    },
    onMenuOpenFolder: (handler) => onVoid(ipcRenderer, WINDOW_IPC_CHANNELS.menuOpenFolder, handler),
    onMenuWorkspaceAction: (handler) =>
      onPayload(
        ipcRenderer,
        WINDOW_IPC_CHANNELS.menuWorkspaceAction,
        asWindowWorkspaceMenuAction,
        handler,
      ),
  };
}

function onVoid(ipcRenderer: IpcRendererLike, channel: string, handler: () => void): Disposable {
  const wrapped = (): void => handler();
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

function onPayload<T>(
  ipcRenderer: IpcRendererLike,
  channel: string,
  parse: (payload: unknown) => T | null,
  handler: (payload: T) => void,
): Disposable {
  const wrapped = (_e: unknown, raw: unknown): void => {
    const payload = parse(raw);
    if (payload !== null) handler(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}
