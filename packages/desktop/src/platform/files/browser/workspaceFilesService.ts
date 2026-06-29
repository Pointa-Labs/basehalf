import type { WorkspaceFilesService as WorkspaceFilesServiceContract } from '../common/workspaceFiles.js';
import { type WorkspaceFilesChannel, workspaceFilesChannel } from './workspaceFilesChannel.js';

export type { WorkspaceFilesService } from '../common/workspaceFiles.js';

export function createWorkspaceFilesService(
  channel: WorkspaceFilesChannel,
): WorkspaceFilesServiceContract {
  return {
    listFiles: (path) => channel.listFiles({ path }),
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
  };
}

export const workspaceFilesService = createWorkspaceFilesService(workspaceFilesChannel);
