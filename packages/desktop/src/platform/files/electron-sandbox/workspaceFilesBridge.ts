import type { IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  WORKSPACE_FILES_IPC_CHANNELS,
  type WorkspaceFilesBridge,
  type WorkspaceFilesChannelBridge,
} from '../common/workspaceFiles.js';

export type { WorkspaceFilesBridge } from '../common/workspaceFiles.js';

export function createWorkspaceFilesBridge(ipcRenderer: IpcRendererLike): WorkspaceFilesBridge {
  return {
    files: {
      listFiles: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.listFiles, args) as ReturnType<
          WorkspaceFilesChannelBridge['listFiles']
        >,
      listSupportedFiles: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.listSupportedFiles, args) as ReturnType<
          WorkspaceFilesChannelBridge['listSupportedFiles']
        >,
      readFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.readFile, args) as ReturnType<
          WorkspaceFilesChannelBridge['readFile']
        >,
      writeFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.writeFile, args) as ReturnType<
          WorkspaceFilesChannelBridge['writeFile']
        >,
      renameFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.renameFile, args) as ReturnType<
          WorkspaceFilesChannelBridge['renameFile']
        >,
      importFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.importFile, args) as ReturnType<
          WorkspaceFilesChannelBridge['importFile']
        >,
      createFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.createFile, args) as ReturnType<
          WorkspaceFilesChannelBridge['createFile']
        >,
      createFolder: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.createFolder, args) as ReturnType<
          WorkspaceFilesChannelBridge['createFolder']
        >,
      deleteEntry: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.deleteEntry, args) as ReturnType<
          WorkspaceFilesChannelBridge['deleteEntry']
        >,
      renameEntry: (args) =>
        ipcRenderer.invoke(WORKSPACE_FILES_IPC_CHANNELS.renameEntry, args) as ReturnType<
          WorkspaceFilesChannelBridge['renameEntry']
        >,
    },
  };
}
