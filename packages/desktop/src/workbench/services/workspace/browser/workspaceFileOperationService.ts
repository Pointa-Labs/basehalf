import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import type {
  WorkspaceService as PlatformWorkspaceService,
  WorkspaceCreateFileArgs,
  WorkspaceCreateFileResult,
  WorkspaceCreateFolderResult,
  WorkspaceDeleteEntryResult,
  WorkspaceImportFileResult,
  WorkspaceRenameEntryResult,
  WorkspaceRenameFileResult,
} from '../../../../platform/workspaces/common/workspaces.js';

type WorkspaceFileOperationBackend = Pick<
  PlatformWorkspaceService,
  'createFile' | 'createFolder' | 'deleteEntry' | 'importFile' | 'renameEntry' | 'renameFile'
>;

export interface WorkspaceFileOperationService {
  createFile(
    path: string,
    options?: Omit<WorkspaceCreateFileArgs, 'path'>,
  ): Promise<WorkspaceCreateFileResult>;
  createFolder(path: string): Promise<WorkspaceCreateFolderResult>;
  deleteEntry(path: string, kind: 'file' | 'folder'): Promise<WorkspaceDeleteEntryResult>;
  importFile(from: string, to?: string | null): Promise<WorkspaceImportFileResult>;
  renameEntry(
    from: string,
    to: string,
    kind: 'file' | 'folder',
  ): Promise<WorkspaceRenameEntryResult>;
  renameFile(from: string, to: string): Promise<WorkspaceRenameFileResult>;
}

export function createWorkspaceFileOperationService(
  backend: WorkspaceFileOperationBackend,
): WorkspaceFileOperationService {
  return {
    createFile: (path, options = {}) => backend.createFile(path, options),
    createFolder: (path) => backend.createFolder(path),
    deleteEntry: (path, kind) => backend.deleteEntry(path, kind),
    importFile: (from, to = null) => backend.importFile(from, to),
    renameEntry: (from, to, kind) => backend.renameEntry(from, to, kind),
    renameFile: (from, to) => backend.renameFile(from, to),
  };
}

export const workspaceFileOperationService = createWorkspaceFileOperationService(workspaceService);
