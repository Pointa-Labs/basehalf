import { type NativeHostChannel, nativeHostChannel } from './nativeHostChannel.js';

export interface NativeHostResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface AppPrefs {
  readonly autoUpdateCheck: boolean;
  readonly autoDownloadUpdate: boolean;
}

export type AppPrefsPatch = Partial<AppPrefs>;
export type ZoomAction = 'in' | 'out' | 'reset';
export type WorkspaceMenuAction = 'rename' | 'remove';
export type Disposable = () => void;

export interface NativeHostService {
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

export function createNativeHostService(channel: NativeHostChannel): NativeHostService {
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
