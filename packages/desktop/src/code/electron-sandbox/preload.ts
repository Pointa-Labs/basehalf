import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import { createSettingsBridge } from '../../platform/configuration/electron-sandbox/configurationBridge.js';
import { createFileEventBridge } from '../../platform/files/electron-sandbox/fileEventBridge.js';
import { createWorkspaceFilesBridge } from '../../platform/files/electron-sandbox/workspaceFilesBridge.js';
import { createNativeHostBridge } from '../../platform/native/electron-sandbox/nativeHostBridge.js';
import { createTerminalBridge } from '../../platform/terminal/electron-sandbox/terminalBridge.js';
import { createUpdateBridge } from '../../platform/update/electron-sandbox/updateBridge.js';
import { createWorkspaceBridge } from '../../platform/workspaces/electron-sandbox/workspaceBridge.js';
import { createGithubBridge } from '../../workbench/contrib/githubPullRequests/electron-sandbox/githubBridge.js';
import { createGitBridge } from '../../workbench/contrib/scm/electron-sandbox/gitBridge.js';
import { createAuthenticationBridge } from '../../workbench/services/authentication/electron-sandbox/authenticationBridge.js';
import { createAdhdBridge } from '../../workbench/services/mirror/electron-sandbox/adhdBridge.js';
import { createBadgeBridge } from '../../workbench/services/mirror/electron-sandbox/badgeBridge.js';
import { createCanvasBridge } from '../../workbench/services/mirror/electron-sandbox/canvasBridge.js';
import { createFocusBridge } from '../../workbench/services/mirror/electron-sandbox/focusBridge.js';
import { createSearchBridge } from '../../workbench/services/search/electron-sandbox/searchBridge.js';
import type { BaseHalfSandboxApi } from './sandboxApi.js';

// Preload is the sandbox bridge, not a business layer. It composes small
// channel adapters and exposes the stable renderer API under `window.bh`.
const bh: BaseHalfSandboxApi = {
  ...createAdhdBridge(ipcRenderer),
  ...createBadgeBridge(ipcRenderer),
  ...createCanvasBridge(ipcRenderer),
  ...createFocusBridge(ipcRenderer),
  ...createNativeHostBridge(ipcRenderer, webFrame, webUtils, {
    platform: process.platform as NodeJS.Platform,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? '',
  }),
  ...createGitBridge(ipcRenderer),
  ...createGithubBridge(ipcRenderer),
  ...createAuthenticationBridge(ipcRenderer),
  ...createSearchBridge(ipcRenderer),
  ...createSettingsBridge(ipcRenderer),
  ...createWorkspaceBridge(ipcRenderer),
  ...createWorkspaceFilesBridge(ipcRenderer),
  ...createUpdateBridge(ipcRenderer),
  ...createFileEventBridge(ipcRenderer),
  terminal: createTerminalBridge(ipcRenderer),
};

contextBridge.exposeInMainWorld('bh', bh);
