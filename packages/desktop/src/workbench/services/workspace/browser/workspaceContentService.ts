import type {
  WorkspaceListFilesResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
} from '../../../../platform/files/common/workspaceFiles.js';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type { WorkspaceService as PlatformWorkspaceService } from '../../../../platform/workspaces/common/workspaces.js';

type WorkspaceContentBackend = Pick<
  PlatformWorkspaceService,
  'listFiles' | 'listSupportedFiles' | 'readFile'
>;

export interface WorkspaceContentService {
  listFiles(path: string): Promise<WorkspaceListFilesResult>;
  listSupportedFiles(folder: string | null): Promise<readonly string[]>;
  readFile(
    path: string,
    options?: Omit<WorkspaceReadFileArgs, 'path'>,
  ): Promise<WorkspaceReadFileResult>;
}

export function createWorkspaceContentService(
  backend: WorkspaceContentBackend,
): WorkspaceContentService {
  return {
    listFiles: (path) => backend.listFiles(path),
    listSupportedFiles: (folder) => backend.listSupportedFiles(folder),
    readFile: (path, options = {}) => backend.readFile(path, options),
  };
}

export const workspaceContentService = createWorkspaceContentService(workspaceService);
