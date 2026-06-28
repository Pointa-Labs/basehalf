import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseHalfApplication } from '../src/code/electron-main/app.js';

type Handler = (...args: unknown[]) => unknown;
type BaseHalfApplicationOptions = ConstructorParameters<typeof BaseHalfApplication>[0];
type AppLike = NonNullable<BaseHalfApplicationOptions['electronApp']>;
type WindowsLike = NonNullable<BaseHalfApplicationOptions['windows']>;

const electronMock = vi.hoisted(() => ({
  app: {
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(async () => undefined),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.BrowserWindow,
}));

function appMock(): {
  handlers: Map<string, Handler>;
  app: AppLike;
} {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    app: {
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
      }),
      quit: vi.fn(),
      whenReady: vi.fn(async () => undefined),
    } as unknown as AppLike,
  };
}

function application(
  opts: {
    readonly app?: AppLike;
    readonly windows?: WindowsLike;
    readonly platform?: NodeJS.Platform;
    readonly calls?: string[];
  } = {},
): BaseHalfApplication {
  const calls = opts.calls ?? [];
  return new BaseHalfApplication({
    workspaceSurfaces: {
      installInitialMenu: vi.fn(() => calls.push('menu')),
    },
    windowSecurity: {
      registerWebContentsGuards: vi.fn(() => calls.push('security')),
    },
    prefs: {
      load: vi.fn(async () => calls.push('prefs')),
    },
    windowSession: {
      restoreSession: vi.fn(async () => calls.push('restore')),
    },
    cleanupUpdateLeftovers: vi.fn(() => calls.push('cleanup-updates')),
    startBackgroundUpdateChecks: vi.fn(() => calls.push('start-updates')),
    spawnWindow: vi.fn(() => calls.push('spawn')),
    electronApp: opts.app,
    windows: opts.windows,
    platform: opts.platform,
    log: { error: vi.fn() },
  });
}

describe('BaseHalfApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs ready-time startup in the same phases as the VS Code application shell', async () => {
    const calls: string[] = [];
    const { handlers, app } = appMock();
    const desktopApp = application({ app, calls });

    await desktopApp.startup();

    expect(app.whenReady).toHaveBeenCalledTimes(1);
    expect([...handlers.keys()]).toEqual(['window-all-closed', 'activate']);
    expect(calls).toEqual([
      'security',
      'menu',
      'prefs',
      'restore',
      'cleanup-updates',
      'start-updates',
    ]);
  });

  it('falls back to prefs defaults and still restores a window', async () => {
    const calls: string[] = [];
    const { app } = appMock();
    const log = { error: vi.fn() };
    const desktopApp = new BaseHalfApplication({
      workspaceSurfaces: { installInitialMenu: vi.fn(() => calls.push('menu')) },
      prefs: {
        load: vi.fn(async () => {
          calls.push('prefs');
          throw new Error('bad prefs');
        }),
      },
      windowSession: { restoreSession: vi.fn(async () => calls.push('restore')) },
      cleanupUpdateLeftovers: vi.fn(() => calls.push('cleanup-updates')),
      startBackgroundUpdateChecks: vi.fn(() => calls.push('start-updates')),
      spawnWindow: vi.fn(),
      electronApp: app,
      log,
    });

    await desktopApp.startup();

    expect(log.error).toHaveBeenCalledWith(
      '[bh-desktop] prefs.load failed; using defaults',
      expect.any(Error),
    );
    expect(calls).toEqual(['menu', 'prefs', 'restore', 'cleanup-updates', 'start-updates']);
  });

  it('handles app-level window lifecycle events', async () => {
    const calls: string[] = [];
    const { handlers, app } = appMock();
    const windows = { getAllWindows: vi.fn(() => []) };
    const desktopApp = application({ app, windows, platform: 'linux', calls });

    await desktopApp.startup();
    handlers.get('activate')?.();
    handlers.get('window-all-closed')?.();

    expect(calls).toContain('spawn');
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('keeps the app alive on macOS when all windows close', async () => {
    const { handlers, app } = appMock();
    const desktopApp = application({ app, platform: 'darwin' });

    await desktopApp.startup();
    handlers.get('window-all-closed')?.();

    expect(app.quit).not.toHaveBeenCalled();
  });
});
