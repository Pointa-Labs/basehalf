import { type WebContents, ipcMain } from 'electron';
import {
  WORKSPACE_FILES_IPC_CHANNELS,
  parseWorkspaceFilesCreateFileArgs,
  parseWorkspaceFilesCreateFolderArgs,
  parseWorkspaceFilesDeleteEntryArgs,
  parseWorkspaceFilesImportFileArgs,
  parseWorkspaceFilesListFilesArgs,
  parseWorkspaceFilesListSupportedFilesArgs,
  parseWorkspaceFilesReadFileArgs,
  parseWorkspaceFilesRenameEntryArgs,
  parseWorkspaceFilesRenameFileArgs,
  parseWorkspaceFilesWriteFileArgs,
} from '../common/workspaceFiles.js';
import type { WorkspaceFilesMainService } from './workspaceFilesMainService.js';

type WorkspaceFilesIpcHandler = (event: WorkspaceFilesIpcEvent, payload?: unknown) => unknown;

export interface IpcMainWorkspaceFilesLike {
  handle(channel: string, listener: WorkspaceFilesIpcHandler): void;
}

export type WorkspaceFilesRootResolver = (sender: WebContents) => string | null;

interface WorkspaceFilesIpcEvent {
  readonly sender: WebContents;
}

export class WorkspaceFilesMainChannel {
  constructor(
    private readonly files: WorkspaceFilesMainService,
    private readonly getWorkspaceRoot: WorkspaceFilesRootResolver,
    private readonly ipc: IpcMainWorkspaceFilesLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.listFiles, (event, payload) =>
      this.files.listFiles(this.root(event), parseWorkspaceFilesListFilesArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.listSupportedFiles, (event, payload) =>
      this.files.listSupportedFiles(
        this.root(event),
        parseWorkspaceFilesListSupportedFilesArgs(payload),
      ),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.readFile, (event, payload) =>
      this.files.readFile(this.root(event), parseWorkspaceFilesReadFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.writeFile, (event, payload) =>
      this.files.writeFile(this.root(event), parseWorkspaceFilesWriteFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.renameFile, (event, payload) =>
      this.files.renameFile(this.root(event), parseWorkspaceFilesRenameFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.importFile, (event, payload) =>
      this.files.importFile(this.root(event), parseWorkspaceFilesImportFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.createFile, (event, payload) =>
      this.files.createFile(this.root(event), parseWorkspaceFilesCreateFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.createFolder, (event, payload) =>
      this.files.createFolder(this.root(event), parseWorkspaceFilesCreateFolderArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.deleteEntry, (event, payload) =>
      this.files.deleteEntry(this.root(event), parseWorkspaceFilesDeleteEntryArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_FILES_IPC_CHANNELS.renameEntry, (event, payload) =>
      this.files.renameEntry(this.root(event), parseWorkspaceFilesRenameEntryArgs(payload)),
    );
  }

  private root(event: WorkspaceFilesIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}
