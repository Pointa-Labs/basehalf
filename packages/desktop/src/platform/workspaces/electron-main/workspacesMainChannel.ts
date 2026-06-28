import { type WebContents, ipcMain } from 'electron';
import { WORKSPACE_IPC_CHANNELS } from '../common/workspaces.js';
import type {
  WorkspaceAddArgs,
  WorkspaceCreateDemoArgs,
  WorkspaceCreateFileArgs,
  WorkspaceCreateFolderArgs,
  WorkspaceDeleteEntryArgs,
  WorkspaceImportFileArgs,
  WorkspaceListCanvasArgs,
  WorkspaceListFilesArgs,
  WorkspaceListSupportedFilesArgs,
  WorkspaceReadFileArgs,
  WorkspaceRemoveArgs,
  WorkspaceRenameArgs,
  WorkspaceRenameEntryArgs,
  WorkspaceRenameFileArgs,
  WorkspaceRepathArgs,
  WorkspaceSetViewportArgs,
  WorkspaceTouchArgs,
  WorkspaceUseArgs,
  WorkspaceWriteFileArgs,
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

function parseWorkspaceUseArgs(payload: unknown): WorkspaceUseArgs {
  const raw = payloadRecord('use', payload);
  return { name: stringProp('use', raw, 'name') };
}

function parseWorkspaceTouchArgs(payload: unknown): WorkspaceTouchArgs {
  const raw = payloadRecord('touch', payload);
  return { path: stringProp('touch', raw, 'path') };
}

function parseWorkspaceAddArgs(payload: unknown): WorkspaceAddArgs {
  const raw = payloadRecord('add', payload);
  const name = optionalStringProp('add', raw, 'name');
  return withOptionalSetup('add', raw, {
    path: stringProp('add', raw, 'path'),
    ...(name !== undefined && { name }),
  });
}

function parseWorkspaceRemoveArgs(payload: unknown): WorkspaceRemoveArgs {
  const raw = payloadRecord('remove', payload);
  return { name: stringProp('remove', raw, 'name') };
}

function parseWorkspaceRenameArgs(payload: unknown): WorkspaceRenameArgs {
  const raw = payloadRecord('rename', payload);
  return { from: stringProp('rename', raw, 'from'), to: stringProp('rename', raw, 'to') };
}

function parseWorkspaceRepathArgs(payload: unknown): WorkspaceRepathArgs {
  const raw = payloadRecord('repath', payload);
  return withOptionalSetup('repath', raw, {
    name: stringProp('repath', raw, 'name'),
    path: stringProp('repath', raw, 'path'),
  });
}

function parseWorkspaceCreateDemoArgs(payload: unknown): WorkspaceCreateDemoArgs {
  const raw = payloadRecord('createDemo', payload);
  const name = optionalStringProp('createDemo', raw, 'name');
  return {
    path: stringProp('createDemo', raw, 'path'),
    ...(name !== undefined && { name }),
  };
}

function parseWorkspaceListFilesArgs(payload: unknown): WorkspaceListFilesArgs {
  const raw = payloadRecord('listFiles', payload);
  return { path: stringProp('listFiles', raw, 'path') };
}

function parseWorkspaceListCanvasArgs(payload: unknown): WorkspaceListCanvasArgs {
  const raw = payloadRecord('listCanvas', payload);
  return { folder: nullableStringProp('listCanvas', raw, 'folder') };
}

function parseWorkspaceListSupportedFilesArgs(payload: unknown): WorkspaceListSupportedFilesArgs {
  const raw = payloadRecord('listSupportedFiles', payload);
  return { folder: nullableStringProp('listSupportedFiles', raw, 'folder') };
}

function parseWorkspaceSetViewportArgs(payload: unknown): WorkspaceSetViewportArgs {
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

function parseWorkspaceReadFileArgs(payload: unknown): WorkspaceReadFileArgs {
  const raw = payloadRecord('readFile', payload);
  const args: WorkspaceReadFileArgs = { path: stringProp('readFile', raw, 'path') };
  const maxChars = optionalFiniteNumberProp('readFile', raw, 'maxChars');
  return maxChars === undefined ? args : { ...args, maxChars };
}

function parseWorkspaceWriteFileArgs(payload: unknown): WorkspaceWriteFileArgs {
  const raw = payloadRecord('writeFile', payload);
  return {
    path: stringProp('writeFile', raw, 'path'),
    content: stringProp('writeFile', raw, 'content'),
  };
}

function parseWorkspaceRenameFileArgs(payload: unknown): WorkspaceRenameFileArgs {
  const raw = payloadRecord('renameFile', payload);
  return { from: stringProp('renameFile', raw, 'from'), to: stringProp('renameFile', raw, 'to') };
}

function parseWorkspaceImportFileArgs(payload: unknown): WorkspaceImportFileArgs {
  const raw = payloadRecord('importFile', payload);
  const to = nullableOptionalStringProp('importFile', raw, 'to');
  if (to === undefined) return { from: stringProp('importFile', raw, 'from') };
  return { from: stringProp('importFile', raw, 'from'), to };
}

function parseWorkspaceCreateFileArgs(payload: unknown): WorkspaceCreateFileArgs {
  const raw = payloadRecord('createFile', payload);
  const content = optionalStringProp('createFile', raw, 'content');
  return {
    path: stringProp('createFile', raw, 'path'),
    ...(content !== undefined && { content }),
  };
}

function parseWorkspaceCreateFolderArgs(payload: unknown): WorkspaceCreateFolderArgs {
  const raw = payloadRecord('createFolder', payload);
  return { path: stringProp('createFolder', raw, 'path') };
}

function parseWorkspaceDeleteEntryArgs(payload: unknown): WorkspaceDeleteEntryArgs {
  const raw = payloadRecord('deleteEntry', payload);
  return {
    path: stringProp('deleteEntry', raw, 'path'),
    kind: entryKindProp('deleteEntry', raw, 'kind'),
  };
}

function parseWorkspaceRenameEntryArgs(payload: unknown): WorkspaceRenameEntryArgs {
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
