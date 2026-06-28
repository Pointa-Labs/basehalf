import { BrowserWindow, Menu, app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_IPC_CHANNELS } from '../src/platform/windows/common/window.js';
import type { WorkspaceRegistryMain } from '../src/platform/workspaces/electron-main/workspaceRegistryMainService.js';
import { WorkspaceSurfacesMainService } from '../src/platform/workspaces/electron-main/workspaceSurfacesMainService.js';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn() },
  Menu: {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  },
  app: { dock: { setMenu: vi.fn() } },
}));

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

function fakeRegistry(
  overrides: Partial<WorkspaceRegistryMain> = {},
): Pick<WorkspaceRegistryMain, 'listWorkspaces' | 'rootForName' | 'touchWorkspace'> {
  return {
    listWorkspaces: vi.fn(async () => []),
    rootForName: vi.fn(async () => null),
    touchWorkspace: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('WorkspaceSurfacesMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes live workspace sets and refreshes recent surfaces', async () => {
    const sendA = vi.fn();
    const sendB = vi.fn();
    const windows = [
      { isDestroyed: () => false, webContents: { id: 1, send: sendA } },
      { isDestroyed: () => false, webContents: { id: 2, send: sendB } },
      { isDestroyed: () => true, webContents: { id: 3, send: vi.fn() } },
    ];
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(windows as never);

    const roots = new Map<number, string | null>([
      [1, '/ws/a'],
      [2, null],
      [3, '/ws/closed'],
    ]);
    const registry = fakeRegistry({
      listWorkspaces: vi.fn(async () => [
        {
          name: 'old',
          path: '/ws/old',
          addedAt: '2020-01-01T00:00:00Z',
          lastOpenedAt: '2021-01-01T00:00:00Z',
        },
        {
          name: 'a',
          path: '/ws/a',
          addedAt: '2020-01-01T00:00:00Z',
          lastOpenedAt: '2024-01-01T00:00:00Z',
        },
      ]),
      rootForName: vi.fn(async (name) => (name === 'a' ? '/ws/a' : null)),
    });
    const service = new WorkspaceSurfacesMainService({
      registry,
      getWorkspaceRoot: (wc) => roots.get(wc.id) ?? null,
      zoomHooks: { getZoomLevel: () => 0, applyZoomLevel: vi.fn() },
      spawnWindow: vi.fn(),
      openRecentWorkspace: vi.fn(),
      checkForUpdates: vi.fn(),
    });

    expect(service.currentOpenKeys()).toEqual(['/ws/a', '']);
    expect(service.boundRoots()).toEqual(['/ws/a']);
    expect(service.isRootStillBound('/ws/a')).toBe(true);
    expect(service.isRootStillBound('/ws/old')).toBe(false);
    await expect(service.rootForName('a')).resolves.toBe('/ws/a');

    service.refresh();
    await flushMicrotasks();

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(app.dock?.setMenu).toHaveBeenCalledTimes(1);
    expect(sendA).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.workspaceWindowsChanged);
    expect(sendB).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.workspaceWindowsChanged);
  });

  it('touches workspace recency and refreshes after the write commits', async () => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    const touchWorkspace = vi.fn(async () => undefined);
    const service = new WorkspaceSurfacesMainService({
      registry: fakeRegistry({ touchWorkspace }),
      getWorkspaceRoot: () => null,
      zoomHooks: { getZoomLevel: () => 0, applyZoomLevel: vi.fn() },
      spawnWindow: vi.fn(),
      openRecentWorkspace: vi.fn(),
      checkForUpdates: vi.fn(),
    });

    service.touchWorkspace('/ws/a');
    await flushMicrotasks();

    expect(touchWorkspace).toHaveBeenCalledWith('/ws/a');
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });
});
