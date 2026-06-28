import type { IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import { SETTINGS_IPC_CHANNELS } from '../common/configuration.js';

export interface AppConfigurationBridge {
  appVersion(): Promise<string>;
  getPrefs(): Promise<{ autoUpdateCheck: boolean; autoDownloadUpdate: boolean }>;
  setPrefs(patch: {
    autoUpdateCheck?: boolean;
    autoDownloadUpdate?: boolean;
  }): Promise<{ autoUpdateCheck: boolean; autoDownloadUpdate: boolean }>;
  zoomWindow(action: 'in' | 'out' | 'reset'): Promise<void>;
}

export function createAppConfigurationBridge(ipcRenderer: IpcRendererLike): AppConfigurationBridge {
  return {
    appVersion: () => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.appVersion) as Promise<string>,
    getPrefs: () =>
      ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.prefsGet) as Promise<{
        autoUpdateCheck: boolean;
        autoDownloadUpdate: boolean;
      }>,
    setPrefs: (patch) =>
      ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.prefsSet, patch) as Promise<{
        autoUpdateCheck: boolean;
        autoDownloadUpdate: boolean;
      }>,
    zoomWindow: (action) =>
      ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.windowZoom, action) as Promise<void>,
  };
}
