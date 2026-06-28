export type NativeHostResult = { readonly ok: boolean; readonly error?: string };
export type NativeHostPathKind = 'file' | 'dir' | null;
export type NativeHostDisposable = () => void;

export interface NativeHostOpenWorkspaceResult {
  readonly reused: boolean;
}

export interface NativeHostAppPrefs {
  readonly autoUpdateCheck: boolean;
  readonly autoDownloadUpdate: boolean;
}

export type NativeHostAppPrefsPatch = Partial<NativeHostAppPrefs>;
export type NativeHostZoomAction = 'in' | 'out' | 'reset';
export type NativeHostWorkspaceMenuAction = 'rename' | 'remove';

export interface NativeShellBridge {
  readonly platform: string;
  readonly homeDir: string;
  pickWorkspace(): Promise<string | null>;
  pathKindForFile(file: File): Promise<NativeHostPathKind>;
  pathForFile(file: File): string;
  openPath(relPath: string): Promise<NativeHostResult>;
  openExternal(url: string): Promise<NativeHostResult>;
}

export interface NativeHostChannelBridge extends NativeShellBridge {
  openWorkspace(name: string): Promise<NativeHostOpenWorkspaceResult>;
  reopenWindow(name: string | null): Promise<void>;
  getOpenWorkspaces(): Promise<string[]>;
  notifyWorkspacesChanged(): void;
  suppressNextNativeContextMenu(): void;
  appVersion(): Promise<string>;
  getPrefs(): Promise<{ autoUpdateCheck: boolean; autoDownloadUpdate: boolean }>;
  setPrefs(patch: {
    autoUpdateCheck?: boolean;
    autoDownloadUpdate?: boolean;
  }): Promise<{ autoUpdateCheck: boolean; autoDownloadUpdate: boolean }>;
  getZoomFactor(): number;
  zoomWindow(action: NativeHostZoomAction): Promise<void>;
  onZoomFactor(handler: (factor: number) => void): NativeHostDisposable;
  onWorkspacesWindowsChanged(handler: () => void): NativeHostDisposable;
  onMenuOpenFolder(handler: () => void): NativeHostDisposable;
  onMenuWorkspaceAction(
    handler: (action: NativeHostWorkspaceMenuAction) => void,
  ): NativeHostDisposable;
  onMenuOpenSettings(handler: () => void): NativeHostDisposable;
  onMenuCloseTab(handler: () => void): NativeHostDisposable;
  onFlushRequest(handler: () => Promise<boolean>): NativeHostDisposable;
}

export interface NativeHostService extends NativeHostChannelBridge {}

export const NATIVE_HOST_IPC_CHANNELS = {
  pickWorkspace: 'workspace:pick',
  openPath: 'shell:open-path',
  pathKind: 'path:kind',
  openExternal: 'shell:open-external',
} as const;

export type NativeHostIpcChannel =
  (typeof NATIVE_HOST_IPC_CHANNELS)[keyof typeof NATIVE_HOST_IPC_CHANNELS];
