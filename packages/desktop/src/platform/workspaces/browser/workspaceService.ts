import type { WorkspaceService as WorkspaceServiceContract } from '../common/workspaces.js';
import { type WorkspaceChannel, workspaceChannel } from './workspaceChannel.js';

export type { WorkspaceService } from '../common/workspaces.js';

export function createWorkspaceService(channel: WorkspaceChannel): WorkspaceServiceContract {
  return {
    startWatcher: async () => {
      await channel.startWatcher();
    },
    listWorkspaces: () => channel.list(),
    probePath: async (path) => {
      await channel.listFiles({ path });
    },
    ensureSetup: () => channel.ensureSetup(),
    addWorkspace: (path, options = {}) => channel.add({ path, ...options }),
    createDemo: (path, options = {}) => channel.createDemo({ path, ...options }),
    removeWorkspace: async (name) => {
      await channel.remove({ name });
    },
    relocateWorkspace: (name, path, options = {}) => channel.repath({ name, path, ...options }),
    renameWorkspace: (from, to) => channel.rename({ from, to }),
    listFiles: (path) => channel.listFiles({ path }),
    listCanvas: (folder) => channel.listCanvas({ folder }),
    listSupportedFiles: async (folder) => {
      const result = await channel.listSupportedFiles({ folder });
      return result.files;
    },
    readFile: (path, options = {}) => channel.readFile({ path, ...options }),
    writeFile: (path, content) => channel.writeFile({ path, content }),
    renameFile: (from, to) => channel.renameFile({ from, to }),
    importFile: (from, to = null) => channel.importFile({ from, to }),
    createFile: (path, options = {}) => channel.createFile({ path, ...options }),
    createFolder: (path) => channel.createFolder({ path }),
    renameEntry: (from, to, kind) => channel.renameEntry({ from, to, kind }),
    deleteEntry: (path, kind) => channel.deleteEntry({ path, kind }),
    setViewport: async (viewport) => {
      await channel.setViewport({ viewport });
    },
  };
}

export const workspaceService = createWorkspaceService(workspaceChannel);
