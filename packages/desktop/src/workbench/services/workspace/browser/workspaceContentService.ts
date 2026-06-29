import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type {
  WorkspaceService as PlatformWorkspaceService,
  WorkspaceListFilesResult,
} from '../../../../platform/workspaces/common/workspaces.js';

type WorkspaceContentBackend = Pick<PlatformWorkspaceService, 'listFiles' | 'listSupportedFiles'>;

export interface WorkspaceContentService {
  listFiles(path: string): Promise<WorkspaceListFilesResult>;
  listSupportedFiles(folder: string | null): Promise<readonly string[]>;
}

export function createWorkspaceContentService(
  backend: WorkspaceContentBackend,
): WorkspaceContentService {
  return {
    listFiles: (path) => backend.listFiles(path),
    listSupportedFiles: (folder) => backend.listSupportedFiles(folder),
  };
}

export const workspaceContentService = createWorkspaceContentService(workspaceService);
