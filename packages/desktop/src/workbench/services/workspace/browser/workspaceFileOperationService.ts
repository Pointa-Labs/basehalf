import { workspaceFilesService } from '../../../../platform/files/browser/workspaceFilesService.js';
import type {
  WorkspaceCreateFileArgs,
  WorkspaceCreateFileResult,
  WorkspaceCreateFolderResult,
  WorkspaceDeleteEntryResult,
  WorkspaceImportFileResult,
  WorkspaceRenameEntryResult,
  WorkspaceRenameFileResult,
} from '../../../../platform/files/common/workspaceFiles.js';
import type { WorkspaceFilesService as PlatformWorkspaceFilesService } from '../../../../platform/files/common/workspaceFiles.js';

type WorkspaceFileOperationBackend = Pick<
  PlatformWorkspaceFilesService,
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

export const workspaceFileOperationService =
  createWorkspaceFileOperationService(workspaceFilesService);
