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
      listCanvas: vi.fn(async () => ({ folder: null, children: [], edges: [] })),
      getViewport: vi.fn(async () => null),
      setViewport: vi.fn(async () => ({})),
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
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.listCanvas)?.(event, { folder: null });
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.getViewport)?.(event);
    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.setViewport)?.(event, {
      viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
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
    expect(workspace.listCanvas).toHaveBeenCalledWith('/repo', { folder: null });
    expect(workspace.getViewport).toHaveBeenCalledWith('/repo');
    expect(workspace.setViewport).toHaveBeenCalledWith('/repo', {
      viewport: { offsetX: 1, offsetY: 2, scale: 0.5 },
    });
  });

  it('rejects malformed workspace IPC payloads before calling workspace services', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const workspace = {
      setViewport: vi.fn(async () => ({})),
    } as unknown as WorkspaceMainService;

    new WorkspaceMainChannel(workspace, () => '/repo', ipc).register();

    await expect(async () => {
      await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.setViewport)?.(event, {
        viewport: { offsetX: 1, offsetY: Number.NaN, scale: 1 },
      });
    }).rejects.toThrow('workspace.setViewport: offsetY must be a finite number');

    await ipc.handlers.get(WORKSPACE_IPC_CHANNELS.setViewport)?.(event, {
      viewport: { offsetX: 1, offsetY: 2, scale: 1 },
      ignored: true,
    });

    expect(workspace.setViewport).toHaveBeenCalledTimes(1);
    expect(workspace.setViewport).toHaveBeenCalledWith('/repo', {
      viewport: { offsetX: 1, offsetY: 2, scale: 1 },
    });
  });
});
