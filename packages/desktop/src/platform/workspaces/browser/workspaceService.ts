import { workspaceFilesService } from '../../files/browser/workspaceFilesService.js';
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
      await workspaceFilesService.listFiles(path);
    },
    ensureSetup: () => channel.ensureSetup(),
    addWorkspace: (path, options = {}) => channel.add({ path, ...options }),
    createDemo: (path, options = {}) => channel.createDemo({ path, ...options }),
    removeWorkspace: async (name) => {
      await channel.remove({ name });
    },
    relocateWorkspace: (name, path, options = {}) => channel.repath({ name, path, ...options }),
    renameWorkspace: (from, to) => channel.rename({ from, to }),
    listCanvas: (folder) => channel.listCanvas({ folder }),
    setViewport: async (viewport) => {
      await channel.setViewport({ viewport });
    },
  };
}

export const workspaceService = createWorkspaceService(workspaceChannel);
