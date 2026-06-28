import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_IPC_CHANNELS } from '../src/platform/workspaces/common/workspaces.js';
import { WorkspaceMainChannel } from '../src/platform/workspaces/electron-main/workspacesMainChannel.js';
import type { WorkspaceMainService } from '../src/platform/workspaces/electron-main/workspacesMainService.js';

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

describe('WorkspaceMainChannel', () => {
  it('registers workspace IPC handlers around the workspace service', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const workspace = {
      startWatcher: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ current: 'demo', workspaces: [] })),
      use: vi.fn(async () => ({ current: { name: 'demo', path: '/repo', addedAt: 'now' } })),
      current: vi.fn(async () => ({ current: null })),
      touch: vi.fn(async () => ({ touched: true })),
      ensureSetup: vi.fn(async () => ({})),
      add: vi.fn(async () => ({ workspace: { name: 'demo', path: '/repo' } })),
      remove: vi.fn(async () => ({ removed: 'demo' })),
      rename: vi.fn(async () => ({ workspace: { name: 'renamed', path: '/repo' } })),
      repath: vi.fn(async () => ({ workspace: { name: 'demo', path: '/new' } })),
      createDemo: vi.fn(async () => ({ workspace: { name: 'demo' }, filesCreated: [], setup: {} })),
      listFiles: vi.fn(async () => ({ path: 'src', entries: [] })),
      listCanvas: vi.fn(async () => ({ folder: null, children: [], edges: [] })),
      listSupportedFiles: vi.fn(async () => ({ files: ['a.md'] })),
      getViewport: vi.fn(async () => null),
      setViewport: vi.fn(async () => ({})),
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
    } as unknown as WorkspaceMainService;

    new WorkspaceMainChannel(workspace, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(WORKSPACE_IPC_CHANNELS));

    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.startWatcher)?.(event);
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.list)?.(event);
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.use)?.(event, { name: 'demo' });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.current)?.(event);
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.touch)?.(event, { path: '/repo' });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.ensureSetup)?.(event);
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.add)?.(event, { path: '/repo', setup: true });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.remove)?.(event, { name: 'demo' });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.rename)?.(event, {
      from: 'demo',
      to: 'renamed',
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.repath)?.(event, {
      name: 'demo',
      path: '/new',
      setup: true,
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.createDemo)?.(event, { path: '/demo' });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.listFiles)?.(event, { path: 'src' });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.listCanvas)?.(event, { folder: null });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.listSupportedFiles)?.(event, { folder: null });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.getViewport)?.(event);
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.setViewport)?.(event, {
      viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.readFile)?.(event, {
      path: 'a.md',
      maxChars: 10,
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.writeFile)?.(event, {
      path: 'a.md',
      content: 'hello',
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.renameFile)?.(event, {
      from: 'a.md',
      to: 'b.md',
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.importFile)?.(event, {
      from: '/tmp/a.png',
      to: 'assets',
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.createFile)?.(event, {
      path: 'new.md',
      content: '',
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.createFolder)?.(event, { path: 'notes' });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.deleteEntry)?.(event, {
      path: 'new',
      kind: 'folder',
    });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.renameEntry)?.(event, {
      from: 'old',
      to: 'new',
      kind: 'folder',
    });

    expect(workspace.startWatcher).toHaveBeenCalledWith('/repo');
    expect(workspace.list).toHaveBeenCalledWith('/repo');
    expect(workspace.use).toHaveBeenCalledWith('/repo', { name: 'demo' });
    expect(workspace.current).toHaveBeenCalledWith('/repo');
    expect(workspace.touch).toHaveBeenCalledWith('/repo', { path: '/repo' });
    expect(workspace.ensureSetup).toHaveBeenCalledWith('/repo');
    expect(workspace.add).toHaveBeenCalledWith('/repo', { path: '/repo', setup: true });
    expect(workspace.remove).toHaveBeenCalledWith('/repo', { name: 'demo' });
    expect(workspace.rename).toHaveBeenCalledWith('/repo', { from: 'demo', to: 'renamed' });
    expect(workspace.repath).toHaveBeenCalledWith('/repo', {
      name: 'demo',
      path: '/new',
      setup: true,
    });
    expect(workspace.createDemo).toHaveBeenCalledWith('/repo', { path: '/demo' });
    expect(workspace.listFiles).toHaveBeenCalledWith('/repo', { path: 'src' });
    expect(workspace.listCanvas).toHaveBeenCalledWith('/repo', { folder: null });
    expect(workspace.listSupportedFiles).toHaveBeenCalledWith('/repo', { folder: null });
    expect(workspace.getViewport).toHaveBeenCalledWith('/repo');
    expect(workspace.setViewport).toHaveBeenCalledWith('/repo', {
      viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
    });
    expect(workspace.readFile).toHaveBeenCalledWith('/repo', { path: 'a.md', maxChars: 10 });
    expect(workspace.writeFile).toHaveBeenCalledWith('/repo', { path: 'a.md', content: 'hello' });
    expect(workspace.renameFile).toHaveBeenCalledWith('/repo', { from: 'a.md', to: 'b.md' });
    expect(workspace.importFile).toHaveBeenCalledWith('/repo', {
      from: '/tmp/a.png',
      to: 'assets',
    });
    expect(workspace.createFile).toHaveBeenCalledWith('/repo', { path: 'new.md', content: '' });
    expect(workspace.createFolder).toHaveBeenCalledWith('/repo', { path: 'notes' });
    expect(workspace.deleteEntry).toHaveBeenCalledWith('/repo', { path: 'new', kind: 'folder' });
    expect(workspace.renameEntry).toHaveBeenCalledWith('/repo', {
      from: 'old',
      to: 'new',
      kind: 'folder',
    });
  });

  it('rejects malformed workspace IPC payloads before calling filesystem services', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const workspace = {
      writeFile: vi.fn(async () => ({ path: 'a.md', bytes: 2 })),
      deleteEntry: vi.fn(async () => ({ deleted: true })),
      setViewport: vi.fn(async () => ({})),
    } as unknown as WorkspaceMainService;

    new WorkspaceMainChannel(workspace, () => '/repo', ipc).register();

    await expect(async () => {
      await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.writeFile)?.(event, {
        path: 'a.md',
        content: 42,
      });
    }).rejects.toThrow('workspace.writeFile: content must be a string');
    await expect(async () => {
      await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.deleteEntry)?.(event, {
        path: 'a.md',
        kind: 'directory',
      });
    }).rejects.toThrow('workspace.deleteEntry: kind must be "file" or "folder"');
    await expect(async () => {
      await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.setViewport)?.(event, {
        viewport: { offsetX: 1, offsetY: Number.NaN, scale: 1 },
      });
    }).rejects.toThrow('workspace.setViewport: offsetY must be a finite number');

    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.writeFile)?.(event, {
      path: 'a.md',
      content: 'ok',
      ignored: true,
    });

    expect(workspace.writeFile).toHaveBeenCalledTimes(1);
    expect(workspace.writeFile).toHaveBeenCalledWith('/repo', { path: 'a.md', content: 'ok' });
    expect(workspace.deleteEntry).not.toHaveBeenCalled();
    expect(workspace.setViewport).not.toHaveBeenCalled();
  });
});
