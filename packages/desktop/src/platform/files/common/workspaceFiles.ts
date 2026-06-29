export interface WorkspaceListFilesArgs {
  readonly path: string;
}

export interface WorkspaceListFilesEntry {
  readonly name: string;
  readonly type: 'file' | 'dir';
}

export interface WorkspaceListFilesResult {
  readonly path: string;
  readonly entries: readonly WorkspaceListFilesEntry[];
}

export interface WorkspaceListSupportedFilesArgs {
  readonly folder: string | null;
}

export interface WorkspaceListSupportedFilesResult {
  readonly files: readonly string[];
}

export interface WorkspaceReadFileArgs {
  readonly path: string;
  readonly maxChars?: number;
}

export interface WorkspaceReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly truncated?: boolean;
  readonly binary?: boolean;
}

export interface WorkspaceWriteFileArgs {
  readonly path: string;
  readonly content: string;
}

export interface WorkspaceWriteFileResult {
  readonly path: string;
  readonly bytes: number;
}

export interface WorkspaceRenameFileArgs {
  readonly from: string;
  readonly to: string;
}

export interface WorkspaceRenameFileResult {
  readonly from: string;
  readonly to: string;
  readonly renamed: boolean;
}

export interface WorkspaceCreateFileArgs {
  readonly path: string;
  readonly content?: string;
}

export interface WorkspaceCreateFileResult {
  readonly path: string;
}

export interface WorkspaceCreateFolderArgs {
  readonly path: string;
}

export interface WorkspaceCreateFolderResult {
  readonly path: string;
}

export interface WorkspaceDeleteEntryArgs {
  readonly path: string;
  readonly kind: 'file' | 'folder';
}

export interface WorkspaceDeleteEntryResult {
  readonly deleted: boolean;
}

export interface WorkspaceRenameEntryArgs {
  readonly from: string;
  readonly to: string;
  readonly kind: 'file' | 'folder';
}

export interface WorkspaceRenameEntryResult {
  readonly from: string;
  readonly to: string;
  readonly renamed: boolean;
}

export interface WorkspaceImportFileArgs {
  readonly from: string;
  readonly to?: string | null;
}

export interface WorkspaceImportFileResult {
  readonly path: string;
  readonly name: string;
  readonly imported: boolean;
  readonly supported: boolean;
}
