import { workspaceFilesService } from '../../../../platform/files/browser/workspaceFilesService.js';
import type {
  WorkspaceListFilesResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
} from '../../../../platform/files/common/workspaceFiles.js';
import type { WorkspaceFilesService as PlatformWorkspaceFilesService } from '../../../../platform/files/common/workspaceFiles.js';

type WorkspaceContentBackend = Pick<
  PlatformWorkspaceFilesService,
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

export const workspaceContentService = createWorkspaceContentService(workspaceFilesService);
