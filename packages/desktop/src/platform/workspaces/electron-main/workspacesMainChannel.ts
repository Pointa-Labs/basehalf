import { type WebContents, ipcMain } from 'electron';
import {
  WORKSPACE_IPC_CHANNELS,
  parseWorkspaceAddArgs,
  parseWorkspaceCreateDemoArgs,
  parseWorkspaceCreateFileArgs,
  parseWorkspaceCreateFolderArgs,
  parseWorkspaceDeleteEntryArgs,
  parseWorkspaceImportFileArgs,
  parseWorkspaceListCanvasArgs,
  parseWorkspaceListFilesArgs,
  parseWorkspaceListSupportedFilesArgs,
  parseWorkspaceReadFileArgs,
  parseWorkspaceRemoveArgs,
  parseWorkspaceRenameArgs,
  parseWorkspaceRenameEntryArgs,
  parseWorkspaceRenameFileArgs,
  parseWorkspaceRepathArgs,
  parseWorkspaceSetViewportArgs,
  parseWorkspaceTouchArgs,
  parseWorkspaceUseArgs,
  parseWorkspaceWriteFileArgs,
} from '../common/workspaces.js';
import type { WorkspaceMainService } from './workspacesMainService.js';

type WorkspaceIpcHandler = (event: WorkspaceIpcEvent, payload?: unknown) => unknown;

export interface IpcMainWorkspaceLike {
  handle(channel: string, listener: WorkspaceIpcHandler): void;
}

export type WorkspaceRootResolver = (sender: WebContents) => string | null;

interface WorkspaceIpcEvent {
  readonly sender: WebContents;
}

export class WorkspaceMainChannel {
  constructor(
    private readonly workspace: WorkspaceMainService,
    private readonly getWorkspaceRoot: WorkspaceRootResolver,
    private readonly ipc: IpcMainWorkspaceLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.startWatcher, (event) =>
      this.workspace.startWatcher(this.root(event)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.list, (event) => this.workspace.list(this.root(event)));
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.use, (event, payload) =>
      this.workspace.use(this.root(event), parseWorkspaceUseArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.current, (event) =>
      this.workspace.current(this.root(event)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.touch, (event, payload) =>
      this.workspace.touch(this.root(event), parseWorkspaceTouchArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.ensureSetup, (event) =>
      this.workspace.ensureSetup(this.root(event)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.add, (event, payload) =>
      this.workspace.add(this.root(event), parseWorkspaceAddArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.remove, (event, payload) =>
      this.workspace.remove(this.root(event), parseWorkspaceRemoveArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.rename, (event, payload) =>
      this.workspace.rename(this.root(event), parseWorkspaceRenameArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.repath, (event, payload) =>
      this.workspace.repath(this.root(event), parseWorkspaceRepathArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.createDemo, (event, payload) =>
      this.workspace.createDemo(this.root(event), parseWorkspaceCreateDemoArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.listFiles, (event, payload) =>
      this.workspace.listFiles(this.root(event), parseWorkspaceListFilesArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.listCanvas, (event, payload) =>
      this.workspace.listCanvas(this.root(event), parseWorkspaceListCanvasArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.listSupportedFiles, (event, payload) =>
      this.workspace.listSupportedFiles(
        this.root(event),
        parseWorkspaceListSupportedFilesArgs(payload),
      ),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.getViewport, (event) =>
      this.workspace.getViewport(this.root(event)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.setViewport, (event, payload) =>
      this.workspace.setViewport(this.root(event), parseWorkspaceSetViewportArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.readFile, (event, payload) =>
      this.workspace.readFile(this.root(event), parseWorkspaceReadFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.writeFile, (event, payload) =>
      this.workspace.writeFile(this.root(event), parseWorkspaceWriteFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.renameFile, (event, payload) =>
      this.workspace.renameFile(this.root(event), parseWorkspaceRenameFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.importFile, (event, payload) =>
      this.workspace.importFile(this.root(event), parseWorkspaceImportFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.createFile, (event, payload) =>
      this.workspace.createFile(this.root(event), parseWorkspaceCreateFileArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.createFolder, (event, payload) =>
      this.workspace.createFolder(this.root(event), parseWorkspaceCreateFolderArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.deleteEntry, (event, payload) =>
      this.workspace.deleteEntry(this.root(event), parseWorkspaceDeleteEntryArgs(payload)),
    );
    this.ipc.handle(WORKSPACE_IPC_CHANNELS.renameEntry, (event, payload) =>
      this.workspace.renameEntry(this.root(event), parseWorkspaceRenameEntryArgs(payload)),
    );
  }

  private root(event: WorkspaceIpcEvent): string | null {
    return this.getWorkspaceRoot(event.sender);
  }
}
