import type {
  WorkspaceAddArgs,
  WorkspaceAddResult,
  WorkspaceCreateDemoArgs,
  WorkspaceCreateDemoResult,
  WorkspaceCreateFileArgs,
  WorkspaceCreateFileResult,
  WorkspaceCreateFolderResult,
  WorkspaceDeleteEntryResult,
  WorkspaceEnsureSetupResult,
  WorkspaceImportFileResult,
  WorkspaceListCanvasResult,
  WorkspaceListFilesResult,
  WorkspaceListResult,
  WorkspaceListSupportedFilesResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
  WorkspaceRenameEntryResult,
  WorkspaceRenameFileResult,
  WorkspaceRenameResult,
  WorkspaceRepathResult,
  WorkspaceSetViewportArgs,
  WorkspaceWriteFileResult,
} from '../common/workspaces.js';
import { type WorkspaceChannel, workspaceChannel } from './workspaceChannel.js';

export interface WorkspaceService {
  startWatcher(): Promise<void>;
  listWorkspaces(): Promise<WorkspaceListResult>;
  probePath(path: string): Promise<void>;
  ensureSetup(): Promise<WorkspaceEnsureSetupResult>;
  addWorkspace(path: string, options?: Omit<WorkspaceAddArgs, 'path'>): Promise<WorkspaceAddResult>;
  createDemo(
    path: string,
    options?: Omit<WorkspaceCreateDemoArgs, 'path'>,
  ): Promise<WorkspaceCreateDemoResult>;
  removeWorkspace(name: string): Promise<void>;
  relocateWorkspace(
    name: string,
    path: string,
    options?: { setup?: boolean },
  ): Promise<WorkspaceRepathResult>;
  renameWorkspace(from: string, to: string): Promise<WorkspaceRenameResult>;
  listFiles(path: string): Promise<WorkspaceListFilesResult>;
  listCanvas(folder: string | null): Promise<WorkspaceListCanvasResult>;
  listSupportedFiles(folder: string | null): Promise<readonly string[]>;
  readFile(
    path: string,
    options?: Omit<WorkspaceReadFileArgs, 'path'>,
  ): Promise<WorkspaceReadFileResult>;
  writeFile(path: string, content: string): Promise<WorkspaceWriteFileResult>;
  renameFile(from: string, to: string): Promise<WorkspaceRenameFileResult>;
  importFile(from: string, to?: string | null): Promise<WorkspaceImportFileResult>;
  createFile(
    path: string,
    options?: Omit<WorkspaceCreateFileArgs, 'path'>,
  ): Promise<WorkspaceCreateFileResult>;
  createFolder(path: string): Promise<WorkspaceCreateFolderResult>;
  renameEntry(
    from: string,
    to: string,
    kind: 'file' | 'folder',
  ): Promise<WorkspaceRenameEntryResult>;
  deleteEntry(path: string, kind: 'file' | 'folder'): Promise<WorkspaceDeleteEntryResult>;
  setViewport(viewport: WorkspaceSetViewportArgs['viewport']): Promise<void>;
}

export function createWorkspaceService(channel: WorkspaceChannel): WorkspaceService {
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
      const result: WorkspaceListSupportedFilesResult = await channel.listSupportedFiles({
        folder,
      });
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
