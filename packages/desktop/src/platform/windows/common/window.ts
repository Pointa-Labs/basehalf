export const WINDOW_IPC_CHANNELS = {
  workspaceOpen: 'workspace:open',
  workspaceReopen: 'workspace:reopen',
  newWindow: 'window:new',
  openWorkspaces: 'app:open-workspaces',
  workspacesChanged: 'app:workspaces-changed',
  workspaceWindowsChanged: 'workspace:windows-changed',
  fullscreen: 'window:fullscreen',
  zoomFactor: 'window:zoom-factor',
  suppressNextContextMenu: 'ctxmenu:suppress-next',
  flushRequest: 'app:flush-request',
  flushReply: 'app:flush-reply',
  menuOpenFolder: 'menu:open-folder',
  menuOpenSettings: 'menu:open-settings',
  menuWorkspaceAction: 'menu:workspace-action',
  menuCloseTab: 'menu:close-tab',
} as const;

export type WindowIpcChannel = (typeof WINDOW_IPC_CHANNELS)[keyof typeof WINDOW_IPC_CHANNELS];

export type WindowDisposable = () => void;
export type WindowWorkspaceMenuAction = 'rename' | 'remove';

export interface WindowOpenWorkspaceResult {
  readonly reused: boolean;
}

export interface WindowBridge {
  openWorkspace(name: string): Promise<WindowOpenWorkspaceResult>;
  reopenWindow(name: string | null): Promise<void>;
  newWindow(): Promise<void>;
  getOpenWorkspaces(): Promise<string[]>;
  notifyWorkspacesChanged(): void;
  onWorkspacesWindowsChanged(handler: () => void): WindowDisposable;
  onFullscreenChange(handler: (isFullscreen: boolean) => void): WindowDisposable;
  getZoomFactor(): number;
  onZoomFactor(handler: (factor: number) => void): WindowDisposable;
  suppressNextNativeContextMenu(): void;
  onMenuOpenSettings(handler: () => void): WindowDisposable;
  onMenuCloseTab(handler: () => void): WindowDisposable;
  onFlushRequest(handler: () => Promise<boolean>): WindowDisposable;
  onMenuOpenFolder(handler: () => void): WindowDisposable;
  onMenuWorkspaceAction(handler: (action: WindowWorkspaceMenuAction) => void): WindowDisposable;
}

export interface WindowService extends WindowBridge {}

export function parseWindowOpenWorkspaceName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error('window.openWorkspace: name must be a string');
  }
  return raw;
}

export function parseWindowReopenWorkspaceName(raw: unknown): string | null {
  if (raw === null || typeof raw === 'string') return raw;
  throw new Error('window.reopenWorkspace: name must be a string or null');
}

export function asWindowOpenWorkspaceResult(raw: unknown): WindowOpenWorkspaceResult {
  const value = recordOrNull(raw);
  if (value !== null && typeof value.reused === 'boolean') {
    return { reused: value.reused };
  }
  throw new Error('window.openWorkspace: invalid IPC result');
}

export function asWindowOpenWorkspaceRoots(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.every((value) => typeof value === 'string')) {
    throw new Error('window.getOpenWorkspaces: invalid IPC result');
  }
  return [...raw];
}

export function asWindowFullscreenState(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

export function asWindowZoomFactor(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function asWindowWorkspaceMenuAction(raw: unknown): WindowWorkspaceMenuAction | null {
  return raw === 'rename' || raw === 'remove' ? raw : null;
}

function recordOrNull(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}
