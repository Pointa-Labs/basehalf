import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowSessionMainService } from '../src/platform/windows/electron-main/windowSessionMainService.js';
import type { WorkspaceRegistryMain } from '../src/platform/workspaces/electron-main/workspaceRegistryMainService.js';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn() },
}));

interface FakeWindow extends BrowserWindow {
  readonly webContents: BrowserWindow['webContents'] & { readonly id: number };
}

function fakeWindow(id: number, destroyed = false): FakeWindow {
  return {
    webContents: { id },
    isDestroyed: vi.fn(() => destroyed),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 900, height: 700 })),
    isMaximized: vi.fn(() => true),
  } as unknown as FakeWindow;
}

async function tempConfigDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bh-window-session-'));
}

function registryWithWorkspaces(paths: string[]): Pick<WorkspaceRegistryMain, 'registeredPaths'> {
  return {
    registeredPaths: vi.fn(async () => paths),
  };
}

describe('WindowSessionMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([]);
  });

  it('restores only registered workspace roots from the previous session', async () => {
    const configDir = await tempConfigDir();
    await writeFile(
      join(configDir, 'window-state.json'),
      JSON.stringify({
        version: 1,
        windows: {
          '/ws/a': { width: 900, height: 700 },
          '/ws/removed': { width: 900, height: 700 },
        },
        open: ['/ws/a', '/ws/removed'],
      }),
      'utf8',
    );
    const createWindow = vi.fn(async () => fakeWindow(1));
    const service = new WindowSessionMainService({
      configDir,
      registry: registryWithWorkspaces(['/ws/a']),
      createWindow,
      getWorkspaceRoot: () => null,
      currentOpenKeys: () => [],
      getZoomLevel: () => 0,
    });

    await service.restoreSession();

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(createWindow).toHaveBeenCalledWith('/ws/a');
  });

  it('opens a welcome window when no previous session root survives', async () => {
    const createWindow = vi.fn(async () => fakeWindow(1));
    const service = new WindowSessionMainService({
      configDir: await tempConfigDir(),
      registry: registryWithWorkspaces([]),
      createWindow,
      getWorkspaceRoot: () => null,
      currentOpenKeys: () => [],
      getZoomLevel: () => 0,
    });

    await service.restoreSession();

    expect(createWindow).toHaveBeenCalledWith(null);
  });

  it('persists live window state and the full open set synchronously', async () => {
    const configDir = await tempConfigDir();
    const win = fakeWindow(7);
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([win]);
    const service = new WindowSessionMainService({
      configDir,
      registry: registryWithWorkspaces([]),
      createWindow: vi.fn(),
      getWorkspaceRoot: (wc) => (wc.id === 7 ? '/ws/a' : null),
      currentOpenKeys: () => ['/ws/a'],
      getZoomLevel: () => 2,
    });

    service.persistAllWindowsSync();

    const file = JSON.parse(await readFile(join(configDir, 'window-state.json'), 'utf8')) as {
      windows: Record<string, unknown>;
      open: string[];
    };
    expect(file.open).toEqual(['/ws/a']);
    expect(file.windows['/ws/a']).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 700,
      isMaximized: true,
      zoomLevel: 2,
    });
  });
});
