import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_FILES_IPC_CHANNELS } from '../src/platform/files/common/workspaceFiles.js';
import { WorkspaceFilesMainChannel } from '../src/platform/files/electron-main/workspaceFilesMainChannel.js';
import type { WorkspaceFilesMainService } from '../src/platform/files/electron-main/workspaceFilesMainService.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

type Handler = (...args: unknown[]) => unknown;

function fakeIpc(): { handle: ReturnType<typeof vi.fn>; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
}

describe('WorkspaceFilesMainChannel', () => {
  it('registers files IPC handlers around workspace-relative file operations', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const files = {
      listFiles: vi.fn(async () => ({ path: 'src', entries: [] })),
      listSupportedFiles: vi.fn(async () => ({ files: ['a.md'] })),
      readFile: vi.fn(async () => ({ path: 'a.md', content: 'hello' })),
      writeFile: vi.fn(async () => ({ path: 'a.md', bytes: 5 })),
      renameFile: vi.fn(async () => ({ from: 'a.md', to: 'b.md', renamed: true })),
      importFile: vi.fn(async () => ({
        path: 'assets/a.png',
        name: 'a.png',
        imported: true,
        supported: true,
      })),
      createFile: vi.fn(async () => ({ path: 'new.md' })),
      createFolder: vi.fn(async () => ({ path: 'notes' })),
      deleteEntry: vi.fn(async () => ({ deleted: true })),
      renameEntry: vi.fn(async () => ({ from: 'old', to: 'new', renamed: true })),
    } as unknown as WorkspaceFilesMainService;

    new WorkspaceFilesMainChannel(files, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(WORKSPACE_FILES_IPC_CHANNELS));

    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.listFiles)?.(event, { path: 'src' });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.listSupportedFiles)?.(event, {
      folder: null,
    });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.readFile)?.(event, {
      path: 'a.md',
      maxChars: 10,
    });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.writeFile)?.(event, {
      path: 'a.md',
      content: 'hello',
    });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.renameFile)?.(event, {
      from: 'a.md',
      to: 'b.md',
    });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.importFile)?.(event, {
      from: '/tmp/a.png',
      to: 'assets',
    });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.createFile)?.(event, {
      path: 'new.md',
      content: '',
    });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.createFolder)?.(event, { path: 'notes' });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.deleteEntry)?.(event, {
      path: 'new',
      kind: 'folder',
    });
    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.renameEntry)?.(event, {
      from: 'old',
      to: 'new',
      kind: 'folder',
    });

    expect(files.listFiles).toHaveBeenCalledWith('/repo', { path: 'src' });
    expect(files.listSupportedFiles).toHaveBeenCalledWith('/repo', { folder: null });
    expect(files.readFile).toHaveBeenCalledWith('/repo', { path: 'a.md', maxChars: 10 });
    expect(files.writeFile).toHaveBeenCalledWith('/repo', { path: 'a.md', content: 'hello' });
    expect(files.renameFile).toHaveBeenCalledWith('/repo', { from: 'a.md', to: 'b.md' });
    expect(files.importFile).toHaveBeenCalledWith('/repo', {
      from: '/tmp/a.png',
      to: 'assets',
    });
    expect(files.createFile).toHaveBeenCalledWith('/repo', { path: 'new.md', content: '' });
    expect(files.createFolder).toHaveBeenCalledWith('/repo', { path: 'notes' });
    expect(files.deleteEntry).toHaveBeenCalledWith('/repo', { path: 'new', kind: 'folder' });
    expect(files.renameEntry).toHaveBeenCalledWith('/repo', {
      from: 'old',
      to: 'new',
      kind: 'folder',
    });
  });

  it('rejects malformed files IPC payloads before calling filesystem services', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const files = {
      writeFile: vi.fn(async () => ({ path: 'a.md', bytes: 2 })),
      deleteEntry: vi.fn(async () => ({ deleted: true })),
      readFile: vi.fn(async () => ({ path: 'a.md', content: '' })),
    } as unknown as WorkspaceFilesMainService;

    new WorkspaceFilesMainChannel(files, () => '/repo', ipc).register();

    await expect(async () => {
      await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.writeFile)?.(event, {
        path: 'a.md',
        content: 42,
      });
    }).rejects.toThrow('files.writeFile: content must be a string');
    await expect(async () => {
      await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.deleteEntry)?.(event, {
        path: 'a.md',
        kind: 'directory',
      });
    }).rejects.toThrow('files.deleteEntry: kind must be "file" or "folder"');
    await expect(async () => {
      await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.readFile)?.(event, {
        path: 'a.md',
        maxChars: Number.NaN,
      });
    }).rejects.toThrow('files.readFile: maxChars must be a non-negative finite number');

    await ipc.handlers.get(WORKSPACE_FILES_IPC_CHANNELS.writeFile)?.(event, {
      path: 'a.md',
      content: 'ok',
      ignored: true,
    });

    expect(files.writeFile).toHaveBeenCalledTimes(1);
    expect(files.writeFile).toHaveBeenCalledWith('/repo', { path: 'a.md', content: 'ok' });
    expect(files.deleteEntry).not.toHaveBeenCalled();
    expect(files.readFile).not.toHaveBeenCalled();
  });
});
