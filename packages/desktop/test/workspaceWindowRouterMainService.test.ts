import type { BrowserWindow } from 'electron';
import { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceWindowRouterMainService } from '../src/platform/windows/electron-main/workspaceWindowRouterMainService.js';
import type { WorkspaceRegistryMain } from '../src/platform/workspaces/electron-main/workspaceRegistryMainService.js';

const electronMock = vi.hoisted(() => {
  const browserWindowMock = {
    getAllWindows: vi.fn(),
    getFocusedWindow: vi.fn(),
  };
  return { browserWindowMock };
});

vi.mock('electron', () => ({
  BrowserWindow: electronMock.browserWindowMock,
}));

interface FakeWindow extends BrowserWindow {
  readonly webContents: BrowserWindow['webContents'] & {
    readonly id: number;
    readonly reload: ReturnType<typeof vi.fn>;
  };
}

function fakeWindow(
  id: number,
  opts: { minimized?: boolean; destroyed?: boolean } = {},
): FakeWindow {
  return {
    webContents: { id, reload: vi.fn() },
    isDestroyed: vi.fn(() => opts.destroyed ?? false),
    isMinimized: vi.fn(() => opts.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  } as unknown as FakeWindow;
}

function routerHarness(overrides: Partial<Parameters<typeof makeRouter>[0]> = {}) {
  const roots = new Map<number, string | null>();
  const stopWatcher = vi.fn(async () => undefined);
  const opts = {
    roots,
    stopWatcher,
    rootForName: vi.fn(async (name: unknown) => (name === 'a' ? '/ws/a' : null)),
    setWorkspaceRoot: vi.fn((wc: { id: number }, root: string | null) => {
      roots.set(wc.id, root);
    }),
    isRootStillBound: vi.fn(() => false),
    touchWorkspace: vi.fn(),
    refreshWorkspaceSurfaces: vi.fn(),
    createWindow: vi.fn(async (root: string | null) => fakeWindow(root === null ? 0 : 99)),
    flushWindow: vi.fn(async () => true),
    persistWindowState: vi.fn(),
    disposeTerminalsForWindow: vi.fn(),
    ...overrides,
  };
  return { ...opts, service: makeRouter(opts) };
}

function makeRouter(opts: {
  roots: Map<number, string | null>;
  stopWatcher: WorkspaceRegistryMain['stopWatcher'];
  rootForName: (name: unknown) => Promise<string | null>;
  setWorkspaceRoot: (wc: { id: number }, root: string | null) => void;
  isRootStillBound: (root: string) => boolean;
  touchWorkspace: (root: string | null) => void;
  refreshWorkspaceSurfaces: () => void;
  createWindow: (root: string | null) => Promise<BrowserWindow>;
  flushWindow: (win: BrowserWindow) => Promise<boolean>;
  persistWindowState: (win: BrowserWindow) => void;
  disposeTerminalsForWindow: (webContentsId: number) => void;
}): WorkspaceWindowRouterMainService {
  return new WorkspaceWindowRouterMainService({
    registry: { stopWatcher: opts.stopWatcher },
    rootForName: opts.rootForName,
    getWorkspaceRoot: (wc) => opts.roots.get(wc.id) ?? null,
    setWorkspaceRoot: (wc, root) => opts.setWorkspaceRoot(wc, root),
    isRootStillBound: opts.isRootStillBound,
    touchWorkspace: opts.touchWorkspace,
    refreshWorkspaceSurfaces: opts.refreshWorkspaceSurfaces,
    createWindow: opts.createWindow,
    flushWindow: opts.flushWindow,
    persistWindowState: opts.persistWindowState,
    disposeTerminalsForWindow: opts.disposeTerminalsForWindow,
  });
}

describe('WorkspaceWindowRouterMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([]);
    vi.mocked(ElectronBrowserWindow.getFocusedWindow).mockReturnValue(null);
  });

  it('opens an Open Recent entry in a new window when requested', async () => {
    const { service, createWindow } = routerHarness();

    await service.openRecentWorkspace('a', 'new');

    expect(createWindow).toHaveBeenCalledWith('/ws/a');
  });

  it('flushes before reusing the focused window for an Open Recent entry', async () => {
    const focused = fakeWindow(1);
    vi.mocked(ElectronBrowserWindow.getFocusedWindow).mockReturnValue(focused);
    const {
      service,
      roots,
      flushWindow,
      setWorkspaceRoot,
      stopWatcher,
      disposeTerminalsForWindow,
    } = routerHarness();
    roots.set(1, '/ws/old');

    await service.openRecentWorkspace('a', 'same');

    expect(flushWindow).toHaveBeenCalledWith(focused);
    expect(setWorkspaceRoot).toHaveBeenCalledWith(focused.webContents, '/ws/a');
    expect(disposeTerminalsForWindow).toHaveBeenCalledWith(1);
    expect(focused.webContents.reload).toHaveBeenCalledTimes(1);
    expect(stopWatcher).toHaveBeenCalledWith('/ws/old');
  });

  it('reuses a welcome sender for workspace:open', async () => {
    const sender = fakeWindow(2);
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([sender]);
    const { service, roots, setWorkspaceRoot } = routerHarness();
    roots.set(2, null);

    const result = await service.openWorkspaceFromWindow(sender, 'a');

    expect(result).toEqual({ reused: true });
    expect(setWorkspaceRoot).toHaveBeenCalledWith(sender.webContents, '/ws/a');
    expect(sender.webContents.reload).toHaveBeenCalledTimes(1);
  });

  it('focuses an existing workspace window instead of opening a duplicate', async () => {
    const sender = fakeWindow(3);
    const existing = fakeWindow(4, { minimized: true });
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([sender, existing]);
    const { service, roots, createWindow } = routerHarness();
    roots.set(3, '/ws/b');
    roots.set(4, '/ws/a');

    const result = await service.openWorkspaceFromWindow(sender, 'a');

    expect(result).toEqual({ reused: false });
    expect(existing.restore).toHaveBeenCalledTimes(1);
    expect(existing.show).toHaveBeenCalledTimes(1);
    expect(existing.focus).toHaveBeenCalledTimes(1);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('reopens a window in-place and lists open workspace roots', async () => {
    const win = fakeWindow(5);
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([win, fakeWindow(6)]);
    const { service, roots, setWorkspaceRoot, flushWindow } = routerHarness();
    roots.set(5, '/ws/old');
    roots.set(6, null);

    await service.reopenWorkspaceInWindow(win, 'a');

    expect(flushWindow).toHaveBeenCalledWith(win);
    expect(setWorkspaceRoot).toHaveBeenCalledWith(win.webContents, '/ws/a');
    expect(service.getOpenWorkspaceRoots()).toEqual(['/ws/a']);
  });

  it('does not reopen a window in-place when renderer flush is vetoed', async () => {
    const win = fakeWindow(7);
    const { service, roots, setWorkspaceRoot } = routerHarness({
      flushWindow: vi.fn(async () => false),
    });
    roots.set(7, '/ws/old');

    await service.reopenWorkspaceInWindow(win, 'a');

    expect(setWorkspaceRoot).not.toHaveBeenCalled();
    expect(win.webContents.reload).not.toHaveBeenCalled();
  });

  it('creates an empty window and refreshes workspace surfaces on request', async () => {
    const { service, createWindow, refreshWorkspaceSurfaces } = routerHarness();

    await service.createEmptyWindow();
    service.refreshWorkspaceSurfaces();

    expect(createWindow).toHaveBeenCalledWith(null);
    expect(refreshWorkspaceSurfaces).toHaveBeenCalledTimes(1);
  });
});
