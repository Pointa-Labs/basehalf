import type { IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  SETTINGS_IPC_CHANNELS,
  type SettingsBridge,
  type SettingsChannelBridge,
} from '../common/configuration.js';

export type { SettingsBridge } from '../common/configuration.js';

export function createSettingsBridge(ipcRenderer: IpcRendererLike): SettingsBridge {
  return {
    settings: {
      describe: () =>
        ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.describe) as ReturnType<
          SettingsChannelBridge['describe']
        >,
      inspect: (key) =>
        ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.inspect, key) as ReturnType<
          SettingsChannelBridge['inspect']
        >,
      get: (key) =>
        ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.get, key) as ReturnType<
          SettingsChannelBridge['get']
        >,
      setGlobal: (key, value) =>
        ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.setGlobal, { key, value }) as ReturnType<
          SettingsChannelBridge['setGlobal']
        >,
      setWorkspace: (key, value) =>
        ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.setWorkspace, { key, value }) as ReturnType<
          SettingsChannelBridge['setWorkspace']
        >,
      clearWorkspace: (key) =>
        ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.clearWorkspace, key) as ReturnType<
          SettingsChannelBridge['clearWorkspace']
        >,
    },
  };
}
