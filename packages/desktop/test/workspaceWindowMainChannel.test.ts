import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { WINDOW_IPC_CHANNELS } from '../src/platform/windows/common/window.js';
import { WorkspaceWindowMainChannel } from '../src/platform/windows/electron-main/workspaceWindowMainChannel.js';
import type { WorkspaceWindowRouterMainService } from '../src/platform/windows/electron-main/workspaceWindowRouterMainService.js';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

type Handler = (...args: unknown[]) => unknown;

function fakeIpc(): {
  handle: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
  listeners: Map<string, Handler>;
  on: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Handler>();
  return {
    handlers,
    listeners,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: Handler) => {
      listeners.set(channel, handler);
    }),
  };
}

describe('WorkspaceWindowMainChannel', () => {
  it('registers workspace window IPC handlers around the router service', async () => {
    const ipc = fakeIpc();
    const win = { webContents: { id: 7 } } as BrowserWindow;
    const router = {
      openWorkspaceFromWindow: vi.fn(async () => ({ reused: true })),
      reopenWorkspaceInWindow: vi.fn(async () => undefined),
      createEmptyWindow: vi.fn(async () => undefined),
      getOpenWorkspaceRoots: vi.fn(() => ['/ws/a']),
      refreshWorkspaceSurfaces: vi.fn(),
    } as unknown as WorkspaceWindowRouterMainService;
    const windowLocator = { fromWebContents: vi.fn(() => win) };
    new WorkspaceWindowMainChannel(router, windowLocator, ipc).register();

    expect([...ipc.handlers.keys()]).toEqual([
      WINDOW_IPC_CHANNELS.workspaceOpen,
      WINDOW_IPC_CHANNELS.workspaceReopen,
      WINDOW_IPC_CHANNELS.newWindow,
      WINDOW_IPC_CHANNELS.openWorkspaces,
    ]);
    expect([...ipc.listeners.keys()]).toEqual([WINDOW_IPC_CHANNELS.workspacesChanged]);

    const event = { sender: { id: 7 } };
    await expect(
      ipc.handlers.get(WINDOW_IPC_CHANNELS.workspaceOpen)?.(event, 'demo'),
    ).resolves.toEqual({
      reused: true,
    });
    await ipc.handlers.get(WINDOW_IPC_CHANNELS.workspaceReopen)?.(event, null);
    await ipc.handlers.get(WINDOW_IPC_CHANNELS.newWindow)?.(event);
    expect(ipc.handlers.get(WINDOW_IPC_CHANNELS.openWorkspaces)?.(event)).toEqual(['/ws/a']);
    ipc.listeners.get(WINDOW_IPC_CHANNELS.workspacesChanged)?.(event);

    expect(windowLocator.fromWebContents).toHaveBeenCalledWith(event.sender);
    expect(router.openWorkspaceFromWindow).toHaveBeenCalledWith(win, 'demo');
    expect(router.reopenWorkspaceInWindow).toHaveBeenCalledWith(win, null);
    expect(router.createEmptyWindow).toHaveBeenCalledTimes(1);
    expect(router.refreshWorkspaceSurfaces).toHaveBeenCalledTimes(1);
  });
});
