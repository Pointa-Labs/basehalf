import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type {
  WorkspaceService as PlatformWorkspaceService,
  WorkspaceImportFileResult,
} from '../../../../platform/workspaces/common/workspaces.js';

type WorkspaceFileOperationBackend = Pick<PlatformWorkspaceService, 'importFile'>;

export interface WorkspaceFileOperationService {
  importFile(from: string, to?: string | null): Promise<WorkspaceImportFileResult>;
}

export function createWorkspaceFileOperationService(
  backend: WorkspaceFileOperationBackend,
): WorkspaceFileOperationService {
  return {
    importFile: (from, to = null) => backend.importFile(from, to),
  };
}

export const workspaceFileOperationService = createWorkspaceFileOperationService(workspaceService);
