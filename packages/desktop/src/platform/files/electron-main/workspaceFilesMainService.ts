import type {
  WorkspaceCreateFileArgs,
  WorkspaceCreateFileResult,
  WorkspaceCreateFolderArgs,
  WorkspaceCreateFolderResult,
  WorkspaceDeleteEntryArgs,
  WorkspaceDeleteEntryResult,
  WorkspaceImportFileArgs,
  WorkspaceImportFileResult,
  WorkspaceListFilesArgs,
  WorkspaceListFilesResult,
  WorkspaceListSupportedFilesArgs,
  WorkspaceListSupportedFilesResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
  WorkspaceRenameEntryArgs,
  WorkspaceRenameEntryResult,
  WorkspaceRenameFileArgs,
  WorkspaceRenameFileResult,
  WorkspaceWriteFileArgs,
  WorkspaceWriteFileResult,
} from '../common/workspaceFiles.js';
import {
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceEntry,
  importWorkspaceFile,
  listWorkspaceFiles,
  listWorkspaceSupportedFiles,
  readWorkspaceFile,
  renameWorkspaceFile,
  writeWorkspaceFile,
} from './workspaceFileOperations.js';

export interface WorkspaceFilesMirrorParticipant {
  rename(
    workspaceRoot: string,
    args: {
      readonly from: string;
      readonly to: string;
      readonly kind: 'file' | 'folder';
      readonly ifExists: true;
    },
  ): Promise<unknown>;
  purgeDeletedNode(
    workspaceRoot: string,
    args: { readonly path: string; readonly kind: 'file' | 'folder' },
  ): Promise<void>;
}

export interface WorkspaceFilesMainServiceOptions {
  readonly mirror?: WorkspaceFilesMirrorParticipant;
  readonly trash?: (path: string) => Promise<void>;
}

/**
 * Main-process boundary for workspace-relative file operations. This keeps file
 * mutation behind platform/files while the old workspace IPC handlers remain as
 * compatibility shims during migration.
 */
export class WorkspaceFilesMainService {
  constructor(private readonly opts: WorkspaceFilesMainServiceOptions = {}) {}

  listFiles(
    workspaceRoot: string | null,
    args: WorkspaceListFilesArgs,
  ): Promise<WorkspaceListFilesResult> {
    return listWorkspaceFiles(workspaceRoot, args.path);
  }

  listSupportedFiles(
    workspaceRoot: string | null,
    args: WorkspaceListSupportedFilesArgs,
  ): Promise<WorkspaceListSupportedFilesResult> {
    return listWorkspaceSupportedFiles(workspaceRoot, args);
  }

  readFile(
    workspaceRoot: string | null,
    args: WorkspaceReadFileArgs,
  ): Promise<WorkspaceReadFileResult> {
    return readWorkspaceFile(workspaceRoot, args);
  }

  writeFile(
    workspaceRoot: string | null,
    args: WorkspaceWriteFileArgs,
  ): Promise<WorkspaceWriteFileResult> {
    return writeWorkspaceFile(workspaceRoot, args);
  }

  renameFile(
    workspaceRoot: string | null,
    args: WorkspaceRenameFileArgs,
  ): Promise<WorkspaceRenameFileResult> {
    return renameWorkspaceFile(workspaceRoot, args);
  }

  importFile(
    workspaceRoot: string | null,
    args: WorkspaceImportFileArgs,
  ): Promise<WorkspaceImportFileResult> {
    return importWorkspaceFile(workspaceRoot, args);
  }

  createFile(
    workspaceRoot: string | null,
    args: WorkspaceCreateFileArgs,
  ): Promise<WorkspaceCreateFileResult> {
    return createWorkspaceFile(workspaceRoot, args);
  }

  createFolder(
    workspaceRoot: string | null,
    args: WorkspaceCreateFolderArgs,
  ): Promise<WorkspaceCreateFolderResult> {
    return createWorkspaceFolder(workspaceRoot, args);
  }

  deleteEntry(
    workspaceRoot: string | null,
    args: WorkspaceDeleteEntryArgs,
  ): Promise<WorkspaceDeleteEntryResult> {
    const root = this.requireWorkspaceRoot(workspaceRoot);
    return this.deleteEntryInRoot(root, args);
  }

  async renameEntry(
    workspaceRoot: string | null,
    args: WorkspaceRenameEntryArgs,
  ): Promise<WorkspaceRenameEntryResult> {
    const root = this.requireWorkspaceRoot(workspaceRoot);
    const moved = await renameWorkspaceFile(root, { from: args.from, to: args.to }, args.kind);
    if (moved.renamed) {
      await this.opts.mirror?.rename(root, {
        from: args.from,
        to: moved.to,
        kind: args.kind,
        ifExists: true,
      });
    }
    return { from: moved.from, to: moved.to, renamed: moved.renamed };
  }

  private async deleteEntryInRoot(
    root: string,
    args: WorkspaceDeleteEntryArgs,
  ): Promise<WorkspaceDeleteEntryResult> {
    const res = await deleteWorkspaceEntry(root, args, this.opts.trash);
    await this.opts.mirror?.purgeDeletedNode(root, args);
    return res;
  }

  private requireWorkspaceRoot(workspaceRoot: string | null): string {
    if (workspaceRoot === null) {
      throw new Error('No workspace bound. Register/use a workspace first.');
    }
    return workspaceRoot;
  }
}
