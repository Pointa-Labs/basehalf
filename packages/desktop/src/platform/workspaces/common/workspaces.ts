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
