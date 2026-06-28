import {
  type AppConfigurationBridge,
  createAppConfigurationBridge,
} from '../../configuration/electron-sandbox/appConfigurationBridge.js';
import type {
  IpcRendererLike,
  PreloadProcessEnv,
  WebFrameLike,
  WebUtilsLike,
} from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  type WindowBridge,
  createWindowBridge,
} from '../../windows/electron-sandbox/windowBridge.js';
import { type NativeShellBridge, createNativeShellBridge } from './nativeShellBridge.js';

export interface NativeHostBridge extends NativeShellBridge, WindowBridge, AppConfigurationBridge {}

export function createNativeHostBridge(
  ipcRenderer: IpcRendererLike,
  webFrame: WebFrameLike,
  webUtils: WebUtilsLike,
  env: PreloadProcessEnv,
): NativeHostBridge {
  return {
    ...createNativeShellBridge(ipcRenderer, webUtils, env),
    ...createWindowBridge(ipcRenderer, webFrame),
    ...createAppConfigurationBridge(ipcRenderer),
  };
}
