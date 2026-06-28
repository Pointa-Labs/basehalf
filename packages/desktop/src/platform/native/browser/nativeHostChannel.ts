import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type { NativeHostChannelBridge } from '../common/native.js';

export interface NativeHostChannel extends NativeHostChannelBridge {}

export function createNativeHostChannel(bridge: BaseHalfSandboxApi): NativeHostChannel {
  return {
    get platform() {
      return bridge.platform;
    },
    get homeDir() {
      return bridge.homeDir;
    },
    pickWorkspace: () => bridge.pickWorkspace(),
    openWorkspace: (name) => bridge.openWorkspace(name),
    reopenWindow: (name) => bridge.reopenWindow(name),
    getOpenWorkspaces: () => bridge.getOpenWorkspaces(),
    notifyWorkspacesChanged: () => bridge.notifyWorkspacesChanged(),
    pathKindForFile: (file) => bridge.pathKindForFile(file),
    pathForFile: (file) => bridge.pathForFile(file),
    openPath: (relPath) => bridge.openPath(relPath),
    openExternal: (url) => bridge.openExternal(url),
    suppressNextNativeContextMenu: () => bridge.suppressNextNativeContextMenu(),
    appVersion: () => bridge.appVersion(),
    getPrefs: () => bridge.getPrefs(),
    setPrefs: (patch) => bridge.setPrefs(patch),
    getZoomFactor: () => bridge.getZoomFactor(),
    zoomWindow: (action) => bridge.zoomWindow(action),
    onZoomFactor: (handler) => bridge.onZoomFactor(handler),
    onWorkspacesWindowsChanged: (handler) => bridge.onWorkspacesWindowsChanged(handler),
    onMenuOpenFolder: (handler) => bridge.onMenuOpenFolder(handler),
    onMenuWorkspaceAction: (handler) => bridge.onMenuWorkspaceAction(handler),
    onMenuOpenSettings: (handler) => bridge.onMenuOpenSettings(handler),
    onMenuCloseTab: (handler) => bridge.onMenuCloseTab(handler),
    onFlushRequest: (handler) => bridge.onFlushRequest(handler),
  };
}

export const nativeHostChannel: NativeHostChannel =
  createLazySandboxChannel(createNativeHostChannel);
