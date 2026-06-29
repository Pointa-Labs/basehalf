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

export const WORKSPACE_FILES_IPC_CHANNELS = {
  listFiles: 'files:list-workspace-files',
  listSupportedFiles: 'files:list-supported-workspace-files',
  readFile: 'files:read-workspace-file',
  writeFile: 'files:write-workspace-file',
  renameFile: 'files:rename-workspace-file',
  importFile: 'files:import-workspace-file',
  createFile: 'files:create-workspace-file',
  createFolder: 'files:create-workspace-folder',
  deleteEntry: 'files:delete-workspace-entry',
  renameEntry: 'files:rename-workspace-entry',
} as const;

export type WorkspaceFilesIpcChannel =
  (typeof WORKSPACE_FILES_IPC_CHANNELS)[keyof typeof WORKSPACE_FILES_IPC_CHANNELS];

export interface WorkspaceFilesChannelBridge {
  listFiles(args: WorkspaceListFilesArgs): Promise<WorkspaceListFilesResult>;
  listSupportedFiles(
    args: WorkspaceListSupportedFilesArgs,
  ): Promise<WorkspaceListSupportedFilesResult>;
  readFile(args: WorkspaceReadFileArgs): Promise<WorkspaceReadFileResult>;
  writeFile(args: WorkspaceWriteFileArgs): Promise<WorkspaceWriteFileResult>;
  renameFile(args: WorkspaceRenameFileArgs): Promise<WorkspaceRenameFileResult>;
  importFile(args: WorkspaceImportFileArgs): Promise<WorkspaceImportFileResult>;
  createFile(args: WorkspaceCreateFileArgs): Promise<WorkspaceCreateFileResult>;
  createFolder(args: WorkspaceCreateFolderArgs): Promise<WorkspaceCreateFolderResult>;
  deleteEntry(args: WorkspaceDeleteEntryArgs): Promise<WorkspaceDeleteEntryResult>;
  renameEntry(args: WorkspaceRenameEntryArgs): Promise<WorkspaceRenameEntryResult>;
}

export interface WorkspaceFilesBridge {
  readonly files: WorkspaceFilesChannelBridge;
}

export interface WorkspaceFilesService {
  listFiles(path: string): Promise<WorkspaceListFilesResult>;
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
}

export function parseWorkspaceFilesListFilesArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceListFilesArgs {
  const raw = payloadRecord(namespace, 'listFiles', payload);
  return { path: stringProp(namespace, 'listFiles', raw, 'path') };
}

export function parseWorkspaceFilesListSupportedFilesArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceListSupportedFilesArgs {
  const raw = payloadRecord(namespace, 'listSupportedFiles', payload);
  return { folder: nullableStringProp(namespace, 'listSupportedFiles', raw, 'folder') };
}

export function parseWorkspaceFilesReadFileArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceReadFileArgs {
  const raw = payloadRecord(namespace, 'readFile', payload);
  const args: WorkspaceReadFileArgs = { path: stringProp(namespace, 'readFile', raw, 'path') };
  const maxChars = optionalFiniteNumberProp(namespace, 'readFile', raw, 'maxChars');
  return maxChars === undefined ? args : { ...args, maxChars };
}

export function parseWorkspaceFilesWriteFileArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceWriteFileArgs {
  const raw = payloadRecord(namespace, 'writeFile', payload);
  return {
    path: stringProp(namespace, 'writeFile', raw, 'path'),
    content: stringProp(namespace, 'writeFile', raw, 'content'),
  };
}

export function parseWorkspaceFilesRenameFileArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceRenameFileArgs {
  const raw = payloadRecord(namespace, 'renameFile', payload);
  return {
    from: stringProp(namespace, 'renameFile', raw, 'from'),
    to: stringProp(namespace, 'renameFile', raw, 'to'),
  };
}

export function parseWorkspaceFilesImportFileArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceImportFileArgs {
  const raw = payloadRecord(namespace, 'importFile', payload);
  const to = nullableOptionalStringProp(namespace, 'importFile', raw, 'to');
  if (to === undefined) return { from: stringProp(namespace, 'importFile', raw, 'from') };
  return { from: stringProp(namespace, 'importFile', raw, 'from'), to };
}

export function parseWorkspaceFilesCreateFileArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceCreateFileArgs {
  const raw = payloadRecord(namespace, 'createFile', payload);
  const content = optionalStringProp(namespace, 'createFile', raw, 'content');
  return {
    path: stringProp(namespace, 'createFile', raw, 'path'),
    ...(content !== undefined && { content }),
  };
}

export function parseWorkspaceFilesCreateFolderArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceCreateFolderArgs {
  const raw = payloadRecord(namespace, 'createFolder', payload);
  return { path: stringProp(namespace, 'createFolder', raw, 'path') };
}

export function parseWorkspaceFilesDeleteEntryArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceDeleteEntryArgs {
  const raw = payloadRecord(namespace, 'deleteEntry', payload);
  return {
    path: stringProp(namespace, 'deleteEntry', raw, 'path'),
    kind: entryKindProp(namespace, 'deleteEntry', raw, 'kind'),
  };
}

export function parseWorkspaceFilesRenameEntryArgs(
  payload: unknown,
  namespace = 'files',
): WorkspaceRenameEntryArgs {
  const raw = payloadRecord(namespace, 'renameEntry', payload);
  return {
    from: stringProp(namespace, 'renameEntry', raw, 'from'),
    to: stringProp(namespace, 'renameEntry', raw, 'to'),
    kind: entryKindProp(namespace, 'renameEntry', raw, 'kind'),
  };
}

function payloadRecord(
  namespace: string,
  method: string,
  payload: unknown,
): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`${namespace}.${method}: invalid IPC payload`);
  }
  return payload as Record<string, unknown>;
}

function stringProp(
  namespace: string,
  method: string,
  raw: Record<string, unknown>,
  key: string,
): string {
  const value = raw[key];
  if (typeof value !== 'string') {
    throw new Error(`${namespace}.${method}: ${key} must be a string`);
  }
  return value;
}

function nullableStringProp(
  namespace: string,
  method: string,
  raw: Record<string, unknown>,
  key: string,
): string | null {
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${namespace}.${method}: ${key} must be a string or null`);
  }
  return value;
}

function nullableOptionalStringProp(
  namespace: string,
  method: string,
  raw: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${namespace}.${method}: ${key} must be a string or null`);
  }
  return value;
}

function optionalStringProp(
  namespace: string,
  method: string,
  raw: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${namespace}.${method}: ${key} must be a string`);
  }
  return value;
}

function optionalFiniteNumberProp(
  namespace: string,
  method: string,
  raw: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${namespace}.${method}: ${key} must be a non-negative finite number`);
  }
  return value;
}

function entryKindProp(
  namespace: string,
  method: string,
  raw: Record<string, unknown>,
  key: string,
): 'file' | 'folder' {
  const value = raw[key];
  if (value !== 'file' && value !== 'folder') {
    throw new Error(`${namespace}.${method}: ${key} must be "file" or "folder"`);
  }
  return value;
}
