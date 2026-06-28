import type {
  IpcRendererLike,
  PreloadProcessEnv,
  WebUtilsLike,
} from '../../ipc/electron-sandbox/ipcRenderer.js';
import { NATIVE_HOST_IPC_CHANNELS, type NativeHostPathKind } from '../common/native.js';

export interface NativeShellBridge {
  pickWorkspace(): Promise<string | null>;
  pathKindForFile(file: File): Promise<NativeHostPathKind>;
  pathForFile(file: File): string;
  openPath(relPath: string): Promise<{ ok: boolean; error?: string }>;
  openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
}

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
      ipcRenderer.invoke(NATIVE_HOST_IPC_CHANNELS.openPath, relPath) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    openExternal: (url) =>
      ipcRenderer.invoke(NATIVE_HOST_IPC_CHANNELS.openExternal, url) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    platform: env.platform,
    homeDir: env.homeDir,
  };
}
