import type {
  IpcRendererLike,
  PreloadProcessEnv,
  WebUtilsLike,
} from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  NATIVE_HOST_IPC_CHANNELS,
  type NativeHostPathKind,
  type NativeHostResult,
  type NativeShellBridge,
} from '../common/native.js';

export type { NativeShellBridge } from '../common/native.js';

export function createNativeShellBridge(
  ipcRenderer: IpcRendererLike,
  webUtils: WebUtilsLike,
  env: PreloadProcessEnv,
): NativeShellBridge {
  return {
    pickWorkspace: () =>
      ipcRenderer.invoke(NATIVE_HOST_IPC_CHANNELS.pickWorkspace) as Promise<string | null>,
    pathKindForFile: (file) => {
      let path = '';
      try {
        path = webUtils.getPathForFile(file);
      } catch {
        return Promise.resolve(null);
      }
      if (path === '') return Promise.resolve(null);
      return ipcRenderer.invoke(
        NATIVE_HOST_IPC_CHANNELS.pathKind,
        path,
      ) as Promise<NativeHostPathKind>;
    },
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
    openPath: (relPath) =>
      ipcRenderer.invoke(NATIVE_HOST_IPC_CHANNELS.openPath, relPath) as Promise<NativeHostResult>,
    openExternal: (url) =>
      ipcRenderer.invoke(NATIVE_HOST_IPC_CHANNELS.openExternal, url) as Promise<NativeHostResult>,
    platform: env.platform,
    homeDir: env.homeDir,
  };
}
