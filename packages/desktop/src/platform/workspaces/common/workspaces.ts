export interface ViewportState {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
}

export interface WorkspaceEntry {
  readonly name: string;
  readonly path: string;
  readonly addedAt: string;
  readonly lastOpenedAt?: string;
  readonly viewport?: ViewportState;
}

export interface SetupReport {
  readonly gitignoreUpdated: boolean;
  readonly agentHarnessUpdated: boolean;
  readonly claudeMdUpdated: boolean;
  readonly agentsMdUpdated: boolean;
  readonly gitignoreSkipped: boolean;
  readonly agentHarnessSkipped: boolean;
  readonly claudeMdSkipped: boolean;
  readonly agentsMdSkipped: boolean;
  readonly gitignoreAbsent: boolean;
}

export interface WorkspaceAddArgs {
  readonly path: string;
  readonly name?: string;
  readonly setup?: boolean;
}

export interface WorkspaceAddResult {
  readonly workspace: WorkspaceEntry;
  readonly bhDirCreated: boolean;
  readonly alreadyRegistered: boolean;
  readonly setup?: SetupReport;
}

export type WorkspaceListArgs = Record<string, never>;
export interface WorkspaceListResult {
  readonly current: string | null;
  readonly workspaces: readonly WorkspaceEntry[];
}

export interface WorkspaceUseArgs {
  readonly name: string;
}

export interface WorkspaceUseResult {
  readonly current: WorkspaceEntry;
}

export interface WorkspaceTouchArgs {
  readonly path: string;
}

export interface WorkspaceTouchResult {
  readonly touched: boolean;
  readonly name?: string;
  readonly lastOpenedAt?: string;
}

export type WorkspaceCurrentResult =
  | { readonly current: WorkspaceEntry }
  | { readonly current: null };

export type WorkspaceEnsureSetupResult = SetupReport;

export interface WorkspaceRemoveArgs {
  readonly name: string;
}

export interface WorkspaceRemoveResult {
  readonly removed: string;
}

export interface WorkspaceRenameArgs {
  readonly from: string;
  readonly to: string;
}

export interface WorkspaceRenameResult {
  readonly workspace: WorkspaceEntry;
}

export interface WorkspaceRepathArgs {
  readonly name: string;
  readonly path: string;
  readonly setup?: boolean;
}

export interface WorkspaceRepathResult {
  readonly workspace: WorkspaceEntry;
  readonly bhDirCreated: boolean;
  readonly setup?: SetupReport;
}

export interface WorkspaceCreateDemoArgs {
  readonly path: string;
  readonly name?: string;
}

export interface WorkspaceCreateDemoResult {
  readonly workspace: WorkspaceEntry;
  readonly filesCreated: readonly string[];
  readonly setup: SetupReport;
}

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

export interface WorkspaceListCanvasArgs {
  readonly folder: string | null;
}

export interface CanvasFolderPreviewItem {
  readonly name: string;
  readonly kind: 'file' | 'folder';
}

export interface CanvasFolderPreview {
  readonly total: number;
  readonly items: readonly CanvasFolderPreviewItem[];
}

export interface CanvasChildBadge {
  readonly path: string;
  readonly kind: 'file' | 'folder';
  readonly description?: string;
  readonly references: readonly string[];
  readonly referenced_by: readonly string[];
  readonly orphan?: boolean;
  readonly card?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly preview?: CanvasFolderPreview;
}

export interface WorkspaceCanvasSize {
  readonly width: number;
  readonly height: number;
}

export type WorkspaceCanvasAnchor = 'north' | 'east' | 'south' | 'west';

export interface WorkspaceCanvasEdge {
  readonly from: string;
  readonly from_anchor: WorkspaceCanvasAnchor;
  readonly to: string;
  readonly to_anchor: WorkspaceCanvasAnchor;
  readonly label?: string;
}

export interface WorkspaceListCanvasResult {
  readonly folder: string | null;
  readonly size?: WorkspaceCanvasSize;
  readonly children: readonly CanvasChildBadge[];
  readonly edges: readonly WorkspaceCanvasEdge[];
  readonly truncated?: number;
}

export interface WorkspaceListSupportedFilesArgs {
  readonly folder: string | null;
}

export interface WorkspaceListSupportedFilesResult {
  readonly files: readonly string[];
}

export type WorkspaceGetViewportResult = ViewportState | null;

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

export interface WorkspaceSetViewportArgs {
  readonly viewport: ViewportState;
}

export type WorkspaceSetViewportResult = Record<string, never>;

export const WORKSPACE_IPC_CHANNELS = {
  startWatcher: 'workspace:start-watcher',
  list: 'workspace:list',
  use: 'workspace:use',
  current: 'workspace:current',
  touch: 'workspace:touch',
  ensureSetup: 'workspace:ensure-setup',
  add: 'workspace:add',
  remove: 'workspace:remove',
  rename: 'workspace:rename',
  repath: 'workspace:repath',
  createDemo: 'workspace:create-demo',
  listFiles: 'workspace:list-files',
  listCanvas: 'workspace:list-canvas',
  listSupportedFiles: 'workspace:list-supported-files',
  getViewport: 'workspace:get-viewport',
  setViewport: 'workspace:set-viewport',
  readFile: 'workspace:read-file',
  writeFile: 'workspace:write-file',
  renameFile: 'workspace:rename-file',
  importFile: 'workspace:import-file',
  createFile: 'workspace:create-file',
  createFolder: 'workspace:create-folder',
  deleteEntry: 'workspace:delete-entry',
  renameEntry: 'workspace:rename-entry',
} as const;

export type WorkspaceIpcChannel =
  (typeof WORKSPACE_IPC_CHANNELS)[keyof typeof WORKSPACE_IPC_CHANNELS];

export interface WorkspaceChannelBridge {
  startWatcher(): Promise<void>;
  list(): Promise<WorkspaceListResult>;
  use(args: WorkspaceUseArgs): Promise<WorkspaceUseResult>;
  current(): Promise<WorkspaceCurrentResult>;
  touch(args: WorkspaceTouchArgs): Promise<WorkspaceTouchResult>;
  ensureSetup(): Promise<WorkspaceEnsureSetupResult>;
  add(args: WorkspaceAddArgs): Promise<WorkspaceAddResult>;
  remove(args: WorkspaceRemoveArgs): Promise<WorkspaceRemoveResult>;
  rename(args: WorkspaceRenameArgs): Promise<WorkspaceRenameResult>;
  repath(args: WorkspaceRepathArgs): Promise<WorkspaceRepathResult>;
  createDemo(args: WorkspaceCreateDemoArgs): Promise<WorkspaceCreateDemoResult>;
  listFiles(args: WorkspaceListFilesArgs): Promise<WorkspaceListFilesResult>;
  listCanvas(args: WorkspaceListCanvasArgs): Promise<WorkspaceListCanvasResult>;
  listSupportedFiles(
    args: WorkspaceListSupportedFilesArgs,
  ): Promise<WorkspaceListSupportedFilesResult>;
  getViewport(): Promise<WorkspaceGetViewportResult>;
  setViewport(args: WorkspaceSetViewportArgs): Promise<WorkspaceSetViewportResult>;
  readFile(args: WorkspaceReadFileArgs): Promise<WorkspaceReadFileResult>;
  writeFile(args: WorkspaceWriteFileArgs): Promise<WorkspaceWriteFileResult>;
  renameFile(args: WorkspaceRenameFileArgs): Promise<WorkspaceRenameFileResult>;
  importFile(args: WorkspaceImportFileArgs): Promise<WorkspaceImportFileResult>;
  createFile(args: WorkspaceCreateFileArgs): Promise<WorkspaceCreateFileResult>;
  createFolder(args: WorkspaceCreateFolderArgs): Promise<WorkspaceCreateFolderResult>;
  deleteEntry(args: WorkspaceDeleteEntryArgs): Promise<WorkspaceDeleteEntryResult>;
  renameEntry(args: WorkspaceRenameEntryArgs): Promise<WorkspaceRenameEntryResult>;
}

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
    options?: { readonly setup?: boolean },
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

export interface WorkspaceBridge {
  readonly workspace: WorkspaceChannelBridge;
}

export function parseWorkspaceUseArgs(payload: unknown): WorkspaceUseArgs {
  const raw = payloadRecord('use', payload);
  return { name: stringProp('use', raw, 'name') };
}

export function parseWorkspaceTouchArgs(payload: unknown): WorkspaceTouchArgs {
  const raw = payloadRecord('touch', payload);
  return { path: stringProp('touch', raw, 'path') };
}

export function parseWorkspaceAddArgs(payload: unknown): WorkspaceAddArgs {
  const raw = payloadRecord('add', payload);
  const name = optionalStringProp('add', raw, 'name');
  return withOptionalSetup('add', raw, {
    path: stringProp('add', raw, 'path'),
    ...(name !== undefined && { name }),
  });
}

export function parseWorkspaceRemoveArgs(payload: unknown): WorkspaceRemoveArgs {
  const raw = payloadRecord('remove', payload);
  return { name: stringProp('remove', raw, 'name') };
}

export function parseWorkspaceRenameArgs(payload: unknown): WorkspaceRenameArgs {
  const raw = payloadRecord('rename', payload);
  return { from: stringProp('rename', raw, 'from'), to: stringProp('rename', raw, 'to') };
}

export function parseWorkspaceRepathArgs(payload: unknown): WorkspaceRepathArgs {
  const raw = payloadRecord('repath', payload);
  return withOptionalSetup('repath', raw, {
    name: stringProp('repath', raw, 'name'),
    path: stringProp('repath', raw, 'path'),
  });
}

export function parseWorkspaceCreateDemoArgs(payload: unknown): WorkspaceCreateDemoArgs {
  const raw = payloadRecord('createDemo', payload);
  const name = optionalStringProp('createDemo', raw, 'name');
  return {
    path: stringProp('createDemo', raw, 'path'),
    ...(name !== undefined && { name }),
  };
}

export function parseWorkspaceListFilesArgs(payload: unknown): WorkspaceListFilesArgs {
  const raw = payloadRecord('listFiles', payload);
  return { path: stringProp('listFiles', raw, 'path') };
}

export function parseWorkspaceListCanvasArgs(payload: unknown): WorkspaceListCanvasArgs {
  const raw = payloadRecord('listCanvas', payload);
  return { folder: nullableStringProp('listCanvas', raw, 'folder') };
}

export function parseWorkspaceListSupportedFilesArgs(
  payload: unknown,
): WorkspaceListSupportedFilesArgs {
  const raw = payloadRecord('listSupportedFiles', payload);
  return { folder: nullableStringProp('listSupportedFiles', raw, 'folder') };
}

export function parseWorkspaceSetViewportArgs(payload: unknown): WorkspaceSetViewportArgs {
  const raw = payloadRecord('setViewport', payload);
  const viewport = recordProp('setViewport', raw, 'viewport');
  return {
    viewport: {
      offsetX: finiteNumberProp('setViewport', viewport, 'offsetX'),
      offsetY: finiteNumberProp('setViewport', viewport, 'offsetY'),
      scale: finiteNumberProp('setViewport', viewport, 'scale'),
    },
  };
}

export function parseWorkspaceReadFileArgs(payload: unknown): WorkspaceReadFileArgs {
  const raw = payloadRecord('readFile', payload);
  const args: WorkspaceReadFileArgs = { path: stringProp('readFile', raw, 'path') };
  const maxChars = optionalFiniteNumberProp('readFile', raw, 'maxChars');
  return maxChars === undefined ? args : { ...args, maxChars };
}

export function parseWorkspaceWriteFileArgs(payload: unknown): WorkspaceWriteFileArgs {
  const raw = payloadRecord('writeFile', payload);
  return {
    path: stringProp('writeFile', raw, 'path'),
    content: stringProp('writeFile', raw, 'content'),
  };
}

export function parseWorkspaceRenameFileArgs(payload: unknown): WorkspaceRenameFileArgs {
  const raw = payloadRecord('renameFile', payload);
  return { from: stringProp('renameFile', raw, 'from'), to: stringProp('renameFile', raw, 'to') };
}

export function parseWorkspaceImportFileArgs(payload: unknown): WorkspaceImportFileArgs {
  const raw = payloadRecord('importFile', payload);
  const to = nullableOptionalStringProp('importFile', raw, 'to');
  if (to === undefined) return { from: stringProp('importFile', raw, 'from') };
  return { from: stringProp('importFile', raw, 'from'), to };
}

export function parseWorkspaceCreateFileArgs(payload: unknown): WorkspaceCreateFileArgs {
  const raw = payloadRecord('createFile', payload);
  const content = optionalStringProp('createFile', raw, 'content');
  return {
    path: stringProp('createFile', raw, 'path'),
    ...(content !== undefined && { content }),
  };
}

export function parseWorkspaceCreateFolderArgs(payload: unknown): WorkspaceCreateFolderArgs {
  const raw = payloadRecord('createFolder', payload);
  return { path: stringProp('createFolder', raw, 'path') };
}

export function parseWorkspaceDeleteEntryArgs(payload: unknown): WorkspaceDeleteEntryArgs {
  const raw = payloadRecord('deleteEntry', payload);
  return {
    path: stringProp('deleteEntry', raw, 'path'),
    kind: entryKindProp('deleteEntry', raw, 'kind'),
  };
}

export function parseWorkspaceRenameEntryArgs(payload: unknown): WorkspaceRenameEntryArgs {
  const raw = payloadRecord('renameEntry', payload);
  return {
    from: stringProp('renameEntry', raw, 'from'),
    to: stringProp('renameEntry', raw, 'to'),
    kind: entryKindProp('renameEntry', raw, 'kind'),
  };
}

function payloadRecord(method: string, payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`workspace.${method}: invalid IPC payload`);
  }
  return payload as Record<string, unknown>;
}

function recordProp(
  method: string,
  raw: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = raw[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`workspace.${method}: ${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringProp(method: string, raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string') {
    throw new Error(`workspace.${method}: ${key} must be a string`);
  }
  return value;
}

function nullableStringProp(
  method: string,
  raw: Record<string, unknown>,
  key: string,
): string | null {
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`workspace.${method}: ${key} must be a string or null`);
  }
  return value;
}

function nullableOptionalStringProp(
  method: string,
  raw: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`workspace.${method}: ${key} must be a string or null`);
  }
  return value;
}

function optionalStringProp(
  method: string,
  raw: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`workspace.${method}: ${key} must be a string`);
  }
  return value;
}

function finiteNumberProp(method: string, raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`workspace.${method}: ${key} must be a finite number`);
  }
  return value;
}

function optionalFiniteNumberProp(
  method: string,
  raw: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`workspace.${method}: ${key} must be a non-negative finite number`);
  }
  return value;
}

function entryKindProp(
  method: string,
  raw: Record<string, unknown>,
  key: string,
): 'file' | 'folder' {
  const value = raw[key];
  if (value !== 'file' && value !== 'folder') {
    throw new Error(`workspace.${method}: ${key} must be "file" or "folder"`);
  }
  return value;
}

function withOptionalSetup<T extends object>(
  method: string,
  raw: Record<string, unknown>,
  target: T,
): T & { readonly setup?: boolean } {
  const setup = raw.setup;
  if (setup === undefined) return target;
  if (typeof setup !== 'boolean') {
    throw new Error(`workspace.${method}: setup must be a boolean`);
  }
  return { ...target, setup };
}
