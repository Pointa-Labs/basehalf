import type { NativeHostService as NativeHostServiceContract } from '../common/native.js';
import { type NativeHostChannel, nativeHostChannel } from './nativeHostChannel.js';

export type {
  NativeHostAppPrefs as AppPrefs,
  NativeHostAppPrefsPatch as AppPrefsPatch,
  NativeHostDisposable as Disposable,
  NativeHostResult,
  NativeHostService,
  NativeHostWorkspaceMenuAction as WorkspaceMenuAction,
  NativeHostZoomAction as ZoomAction,
} from '../common/native.js';

export function createNativeHostService(channel: NativeHostChannel): NativeHostServiceContract {
  return {
    get platform() {
      return channel.platform;
    },
    get homeDir() {
      return channel.homeDir;
    },
    pickWorkspace: () => channel.pickWorkspace(),
    openWorkspace: (name) => channel.openWorkspace(name),
    reopenWindow: (name) => channel.reopenWindow(name),
    getOpenWorkspaces: () => channel.getOpenWorkspaces(),
    notifyWorkspacesChanged: () => channel.notifyWorkspacesChanged(),
    pathKindForFile: (file) => channel.pathKindForFile(file),
    pathForFile: (file) => channel.pathForFile(file),
    openPath: (relPath) => channel.openPath(relPath),
    openExternal: (url) => channel.openExternal(url),
    suppressNextNativeContextMenu: () => channel.suppressNextNativeContextMenu(),
    appVersion: () => channel.appVersion(),
    getPrefs: () => channel.getPrefs(),
    setPrefs: (patch) => channel.setPrefs(patch),
    getZoomFactor: () => channel.getZoomFactor(),
    zoomWindow: (action) => channel.zoomWindow(action),
    onZoomFactor: (handler) => channel.onZoomFactor(handler),
    onWorkspacesWindowsChanged: (handler) => channel.onWorkspacesWindowsChanged(handler),
    onMenuOpenFolder: (handler) => channel.onMenuOpenFolder(handler),
    onMenuWorkspaceAction: (handler) => channel.onMenuWorkspaceAction(handler),
    onMenuOpenSettings: (handler) => channel.onMenuOpenSettings(handler),
    onMenuCloseTab: (handler) => channel.onMenuCloseTab(handler),
    onFlushRequest: (handler) => channel.onFlushRequest(handler),
  };
}

export const nativeHostService = createNativeHostService(nativeHostChannel);
