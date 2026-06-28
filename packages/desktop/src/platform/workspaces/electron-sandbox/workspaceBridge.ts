import type { IpcRendererLike } from '../../ipc/electron-sandbox/ipcRenderer.js';
import {
  WORKSPACE_IPC_CHANNELS,
  type WorkspaceBridge,
  type WorkspaceChannelBridge,
} from '../common/workspaces.js';

export type { WorkspaceBridge } from '../common/workspaces.js';

export function createWorkspaceBridge(ipcRenderer: IpcRendererLike): WorkspaceBridge {
  return {
    workspace: {
      startWatcher: () =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.startWatcher) as ReturnType<
          WorkspaceChannelBridge['startWatcher']
        >,
      list: () =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.list) as ReturnType<
          WorkspaceChannelBridge['list']
        >,
      use: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.use, args) as ReturnType<
          WorkspaceChannelBridge['use']
        >,
      current: () =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.current) as ReturnType<
          WorkspaceChannelBridge['current']
        >,
      touch: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.touch, args) as ReturnType<
          WorkspaceChannelBridge['touch']
        >,
      ensureSetup: () =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.ensureSetup) as ReturnType<
          WorkspaceChannelBridge['ensureSetup']
        >,
      add: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.add, args) as ReturnType<
          WorkspaceChannelBridge['add']
        >,
      remove: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.remove, args) as ReturnType<
          WorkspaceChannelBridge['remove']
        >,
      rename: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.rename, args) as ReturnType<
          WorkspaceChannelBridge['rename']
        >,
      repath: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.repath, args) as ReturnType<
          WorkspaceChannelBridge['repath']
        >,
      createDemo: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.createDemo, args) as ReturnType<
          WorkspaceChannelBridge['createDemo']
        >,
      listFiles: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.listFiles, args) as ReturnType<
          WorkspaceChannelBridge['listFiles']
        >,
      listCanvas: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.listCanvas, args) as ReturnType<
          WorkspaceChannelBridge['listCanvas']
        >,
      listSupportedFiles: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.listSupportedFiles, args) as ReturnType<
          WorkspaceChannelBridge['listSupportedFiles']
        >,
      getViewport: () =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.getViewport) as ReturnType<
          WorkspaceChannelBridge['getViewport']
        >,
      setViewport: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.setViewport, args) as ReturnType<
          WorkspaceChannelBridge['setViewport']
        >,
      readFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.readFile, args) as ReturnType<
          WorkspaceChannelBridge['readFile']
        >,
      writeFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.writeFile, args) as ReturnType<
          WorkspaceChannelBridge['writeFile']
        >,
      renameFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.renameFile, args) as ReturnType<
          WorkspaceChannelBridge['renameFile']
        >,
      importFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.importFile, args) as ReturnType<
          WorkspaceChannelBridge['importFile']
        >,
      createFile: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.createFile, args) as ReturnType<
          WorkspaceChannelBridge['createFile']
        >,
      createFolder: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.createFolder, args) as ReturnType<
          WorkspaceChannelBridge['createFolder']
        >,
      deleteEntry: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.deleteEntry, args) as ReturnType<
          WorkspaceChannelBridge['deleteEntry']
        >,
      renameEntry: (args) =>
        ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.renameEntry, args) as ReturnType<
          WorkspaceChannelBridge['renameEntry']
        >,
    },
  };
}
