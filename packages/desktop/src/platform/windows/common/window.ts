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
