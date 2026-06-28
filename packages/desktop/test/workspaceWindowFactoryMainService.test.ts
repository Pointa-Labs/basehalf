import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, Display } from 'electron';
import { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClosedWindowContext } from '../src/platform/windows/electron-main/windowLifecycleMainService.js';
import { WorkspaceWindowFactoryMainService } from '../src/platform/windows/electron-main/workspaceWindowFactoryMainService.js';

const electronMock = vi.hoisted(() => ({
  BrowserWindowMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindowMock,
}));

type AnyHandler = (...args: unknown[]) => unknown;

interface FakeWindow extends BrowserWindow {
  emitForTest(event: string): void;
  readonly webContents: BrowserWindow['webContents'] & { readonly id: number };
}

function fakeWindow(id = 11): FakeWindow {
  const handlers = new Map<string, AnyHandler[]>();
  const win = {
    webContents: { id },
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 900, height: 700 })),
    maximize: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn((event: string, handler: AnyHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return win;
    }),
    emitForTest: (event: string) => {
      for (const handler of handlers.get(event) ?? []) handler();
    },
  };
  return win as unknown as FakeWindow;
}

async function tempConfigDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bh-window-factory-'));
}

function display(): Display {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1600, height: 1000 },
    workArea: { x: 0, y: 0, width: 1600, height: 1000 },
  } as Display;
}

function harness(configDir: string, win = fakeWindow()) {
  let closeHandler: ((context: ClosedWindowContext) => void) | undefined;
  const opts = {
    configDir,
    preloadPath: '/preload/index.cjs',
    rendererHtmlPath: '/renderer/index.html',
    rendererUrl: 'http://localhost:5173',
    getDisplays: vi.fn(() => [display()]),
    getWorkspaceRoot: vi.fn(() => '/ws/a'),
    getWorkspaceRootById: vi.fn(() => '/ws/a'),
    setWorkspaceRoot: vi.fn(),
    clearWorkspaceRoot: vi.fn(),
    touchWorkspace: vi.fn(),
    currentOpenKeys: vi.fn(() => ['/ws/b']),
    refreshWorkspaceSurfaces: vi.fn(),
    installWindowCloseHandlers: vi.fn((_win: BrowserWindow, onClosed) => {
      closeHandler = onClosed;
    }),
    disposeTerminalsForWindow: vi.fn(),
    stopWatcherIfOrphaned: vi.fn(),
    rememberZoom: vi.fn(),
    forgetZoom: vi.fn(),
    getZoomLevel: vi.fn(() => 3),
    installChrome: vi.fn(),
  };
  const service = new WorkspaceWindowFactoryMainService(opts);
  return {
    service,
    opts,
    close: (context: ClosedWindowContext) => {
      if (!closeHandler) throw new Error('close handler was not installed');
      closeHandler(context);
    },
    win,
  };
}

describe('WorkspaceWindowFactoryMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a BrowserWindow from persisted workspace geometry and installs window services', async () => {
    const configDir = await tempConfigDir();
    await writeFile(
      join(configDir, 'window-state.json'),
      JSON.stringify({
        version: 1,
        windows: {
          '/ws/a': { x: 5, y: 6, width: 1000, height: 800, isMaximized: true, zoomLevel: 2 },
        },
        open: ['/ws/a'],
      }),
      'utf8',
    );
    const win = fakeWindow(21);
    electronMock.BrowserWindowMock.mockImplementation(() => win);
    const { service, opts } = harness(configDir, win);

    await expect(service.createWindow('/ws/a')).resolves.toBe(win);

    expect(ElectronBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 5,
        y: 6,
        width: 1000,
        height: 800,
        webPreferences: expect.objectContaining({
          preload: '/preload/index.cjs',
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        }),
      }),
    );
    expect(opts.rememberZoom).toHaveBeenCalledWith(win, 2);
    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(opts.setWorkspaceRoot).toHaveBeenCalledWith(win.webContents, '/ws/a');
    expect(opts.touchWorkspace).toHaveBeenCalledWith('/ws/a');
    expect(opts.installWindowCloseHandlers).toHaveBeenCalledWith(win, expect.any(Function));
    expect(opts.installChrome).toHaveBeenCalledWith(win);
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(win.on).toHaveBeenCalledWith('move', expect.any(Function));
    expect(win.on).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(opts.refreshWorkspaceSurfaces).toHaveBeenCalledTimes(1);
  });

  it('cleans up bindings and persists the reduced open set after a window closes', async () => {
    const configDir = await tempConfigDir();
    const win = fakeWindow(31);
    electronMock.BrowserWindowMock.mockImplementation(() => win);
    const { service, opts, close } = harness(configDir, win);
    await service.createWindow('/ws/a');
    opts.refreshWorkspaceSurfaces.mockClear();

    close({
      isQuitting: false,
      lastGeometry: { x: 1, y: 2, width: 700, height: 500, isMaximized: false, zoomLevel: 4 },
    });

    expect(opts.disposeTerminalsForWindow).toHaveBeenCalledWith(31);
    expect(opts.clearWorkspaceRoot).toHaveBeenCalledWith(31);
    expect(opts.forgetZoom).toHaveBeenCalledWith(31);
    expect(opts.stopWatcherIfOrphaned).toHaveBeenCalledWith('/ws/a');
    expect(opts.refreshWorkspaceSurfaces).toHaveBeenCalledTimes(1);

    const file = JSON.parse(await readFile(join(configDir, 'window-state.json'), 'utf8')) as {
      windows: Record<string, unknown>;
      open: string[];
    };
    expect(file.open).toEqual(['/ws/b']);
    expect(file.windows['/ws/a']).toEqual({
      x: 1,
      y: 2,
      width: 700,
      height: 500,
      isMaximized: false,
      zoomLevel: 4,
    });
  });
});
