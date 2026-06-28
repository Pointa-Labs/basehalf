import type {
  Disposable,
  IpcRendererLike,
  WebFrameLike,
} from '../../ipc/electron-sandbox/ipcRenderer.js';
import { WINDOW_IPC_CHANNELS } from '../common/window.js';

export interface WindowBridge {
  openWorkspace(name: string): Promise<{ reused: boolean }>;
  reopenWindow(name: string | null): Promise<void>;
  newWindow(): Promise<void>;
  getOpenWorkspaces(): Promise<string[]>;
  notifyWorkspacesChanged(): void;
  onWorkspacesWindowsChanged(handler: () => void): Disposable;
  onFullscreenChange(handler: (isFullscreen: boolean) => void): Disposable;
  getZoomFactor(): number;
  onZoomFactor(handler: (factor: number) => void): Disposable;
  suppressNextNativeContextMenu(): void;
  onMenuOpenSettings(handler: () => void): Disposable;
  onMenuCloseTab(handler: () => void): Disposable;
  onFlushRequest(handler: () => Promise<boolean>): Disposable;
  onMenuOpenFolder(handler: () => void): Disposable;
  onMenuWorkspaceAction(handler: (action: 'rename' | 'remove') => void): Disposable;
}

export function createWindowBridge(
  ipcRenderer: IpcRendererLike,
  webFrame: WebFrameLike,
): WindowBridge {
  return {
    openWorkspace: (name) =>
      ipcRenderer.invoke(WINDOW_IPC_CHANNELS.workspaceOpen, name) as Promise<{ reused: boolean }>,
    reopenWindow: (name) =>
      ipcRenderer.invoke(WINDOW_IPC_CHANNELS.workspaceReopen, name) as Promise<void>,
    newWindow: () => ipcRenderer.invoke(WINDOW_IPC_CHANNELS.newWindow) as Promise<void>,
    getOpenWorkspaces: () =>
      ipcRenderer.invoke(WINDOW_IPC_CHANNELS.openWorkspaces) as Promise<string[]>,
    notifyWorkspacesChanged: () => {
      ipcRenderer.send(WINDOW_IPC_CHANNELS.workspacesChanged);
    },
    onWorkspacesWindowsChanged: (handler) =>
      onVoid(ipcRenderer, WINDOW_IPC_CHANNELS.workspaceWindowsChanged, handler),
    onFullscreenChange: (handler) => {
      const wrapped = (_e: unknown, isFullscreen: unknown): void => {
        handler(Boolean(isFullscreen));
      };
      ipcRenderer.on(WINDOW_IPC_CHANNELS.fullscreen, wrapped);
      return () => ipcRenderer.off(WINDOW_IPC_CHANNELS.fullscreen, wrapped);
    },
    getZoomFactor: () => webFrame.getZoomFactor(),
    onZoomFactor: (handler) => {
      const wrapped = (_e: unknown, factor: unknown): void => {
        if (typeof factor === 'number') handler(factor);
      };
      ipcRenderer.on(WINDOW_IPC_CHANNELS.zoomFactor, wrapped);
      return () => ipcRenderer.off(WINDOW_IPC_CHANNELS.zoomFactor, wrapped);
    },
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
    onMenuWorkspaceAction: (handler) => {
      const wrapped = (_e: unknown, action: unknown): void => {
        if (action === 'rename' || action === 'remove') handler(action);
      };
      ipcRenderer.on(WINDOW_IPC_CHANNELS.menuWorkspaceAction, wrapped);
      return () => ipcRenderer.off(WINDOW_IPC_CHANNELS.menuWorkspaceAction, wrapped);
    },
  };
}

function onVoid(ipcRenderer: IpcRendererLike, channel: string, handler: () => void): Disposable {
  const wrapped = (): void => handler();
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}
