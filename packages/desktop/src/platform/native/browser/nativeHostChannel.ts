import type { BaseHalfSandboxApi } from '../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../ipc/browser/sandboxApi.js';
import type {
  AppPrefs,
  AppPrefsPatch,
  Disposable,
  NativeHostResult,
  WorkspaceMenuAction,
  ZoomAction,
} from './nativeHostService.js';

export interface NativeHostChannel {
  readonly platform: string;
  readonly homeDir: string;
  pickWorkspace(): Promise<string | null>;
  openWorkspace(name: string): Promise<{ readonly reused: boolean }>;
  reopenWindow(name: string | null): Promise<void>;
  getOpenWorkspaces(): Promise<readonly string[]>;
  notifyWorkspacesChanged(): void;
  pathKindForFile(file: File): Promise<'file' | 'dir' | null>;
  pathForFile(file: File): string;
  openPath(relPath: string): Promise<NativeHostResult>;
  openExternal(url: string): Promise<NativeHostResult>;
  suppressNextNativeContextMenu(): void;
  appVersion(): Promise<string>;
  getPrefs(): Promise<AppPrefs>;
  setPrefs(patch: AppPrefsPatch): Promise<AppPrefs>;
  getZoomFactor(): number;
  zoomWindow(action: ZoomAction): Promise<void>;
  onZoomFactor(handler: (factor: number) => void): Disposable;
  onWorkspacesWindowsChanged(handler: () => void): Disposable;
  onMenuOpenFolder(handler: () => void): Disposable;
  onMenuWorkspaceAction(handler: (action: WorkspaceMenuAction) => void): Disposable;
  onMenuOpenSettings(handler: () => void): Disposable;
  onMenuCloseTab(handler: () => void): Disposable;
  onFlushRequest(handler: () => Promise<boolean>): Disposable;
}

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
