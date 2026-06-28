import type { BrowserWindow } from 'electron';
import { BrowserWindow as ElectronBrowserWindow, app, ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_IPC_CHANNELS } from '../src/platform/windows/common/window.js';
import { WindowLifecycleMainService } from '../src/platform/windows/electron-main/windowLifecycleMainService.js';

type AnyHandler = (...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => {
  const appHandlers = new Map<string, AnyHandler[]>();
  const ipcHandlers = new Map<string, AnyHandler[]>();
  const appMock = {
    on: vi.fn((event: string, handler: AnyHandler) => {
      appHandlers.set(event, [...(appHandlers.get(event) ?? []), handler]);
    }),
    quit: vi.fn(),
  };
  const ipcMainMock = {
    on: vi.fn((event: string, handler: AnyHandler) => {
      ipcHandlers.set(event, [...(ipcHandlers.get(event) ?? []), handler]);
    }),
    removeListener: vi.fn((event: string, handler: AnyHandler) => {
      ipcHandlers.set(
        event,
        (ipcHandlers.get(event) ?? []).filter((fn) => fn !== handler),
      );
    }),
  };
  const browserWindowMock = {
    getAllWindows: vi.fn(),
  };
  return { appHandlers, ipcHandlers, appMock, browserWindowMock, ipcMainMock };
});

vi.mock('electron', () => ({
  app: electronMock.appMock,
  BrowserWindow: electronMock.browserWindowMock,
  ipcMain: electronMock.ipcMainMock,
}));

interface FakeWindow extends BrowserWindow {
  emitForTest(event: string, ...args: unknown[]): void;
}

function fakeWindow(id = 1): FakeWindow {
  const handlers = new Map<string, AnyHandler[]>();
  const win = {
    webContents: { id, send: vi.fn() },
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    getBounds: vi.fn(() => ({ x: 1, y: 2, width: 800, height: 600 })),
    isMaximized: vi.fn(() => false),
    on: vi.fn((event: string, handler: AnyHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return win;
    }),
    emitForTest: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
  return win as unknown as FakeWindow;
}

function service(
  opts: Partial<ConstructorParameters<typeof WindowLifecycleMainService>[0]> = {},
): WindowLifecycleMainService {
  return new WindowLifecycleMainService({
    captureWindowState: () => ({
      x: 1,
      y: 2,
      width: 800,
      height: 600,
      isMaximized: false,
      zoomLevel: 0,
    }),
    persistAllWindows: vi.fn(),
    disposeAllTerminals: vi.fn(),
    flushTimeoutMs: 50,
    ...opts,
  });
}

function emitFlushReply(win: FakeWindow, ok: boolean): void {
  const handler = electronMock.ipcHandlers.get(WINDOW_IPC_CHANNELS.flushReply)?.at(-1);
  if (!handler) throw new Error('flush reply handler was not registered');
  handler({ sender: win.webContents }, ok);
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('WindowLifecycleMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMock.appHandlers.clear();
    electronMock.ipcHandlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes one window through the correlated renderer reply', async () => {
    const win = fakeWindow();
    const lifecycle = service();

    const result = lifecycle.flushWindow(win);
    expect(win.webContents.send).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.flushRequest);
    emitFlushReply(win, true);

    await expect(result).resolves.toBe(true);
    expect(ipcMain.removeListener).toHaveBeenCalledWith(
      WINDOW_IPC_CHANNELS.flushReply,
      expect.any(Function),
    );
  });

  it('prevents a close until the renderer flush succeeds', async () => {
    const win = fakeWindow();
    const onClosed = vi.fn();
    const lifecycle = service();
    lifecycle.installWindowCloseHandlers(win, onClosed);

    const event = { preventDefault: vi.fn() };
    win.emitForTest('close', event);
    expect(event.preventDefault).toHaveBeenCalled();
    emitFlushReply(win, true);
    await flushMicrotasks();

    expect(win.close).toHaveBeenCalledTimes(1);
    win.emitForTest('closed');
    expect(onClosed).toHaveBeenCalledWith({
      lastGeometry: {
        x: 1,
        y: 2,
        width: 800,
        height: 600,
        isMaximized: false,
        zoomLevel: 0,
      },
      isQuitting: false,
    });
  });

  it('cancels a close when the renderer reports a blocked flush', async () => {
    const win = fakeWindow();
    const lifecycle = service();
    lifecycle.installWindowCloseHandlers(win, vi.fn());

    win.emitForTest('close', { preventDefault: vi.fn() });
    emitFlushReply(win, false);
    await flushMicrotasks();

    expect(win.close).not.toHaveBeenCalled();
  });

  it('treats a missing flush reply as a veto after the timeout', async () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    const lifecycle = service({ flushTimeoutMs: 10 });

    const result = lifecycle.flushWindow(win);
    vi.advanceTimersByTime(10);

    await expect(result).resolves.toBe(false);
    expect(ipcMain.removeListener).toHaveBeenCalledWith(
      WINDOW_IPC_CHANNELS.flushReply,
      expect.any(Function),
    );
  });

  it('pauses app quit, flushes all windows, then resumes quit and disposes terminals', async () => {
    const win = fakeWindow();
    vi.mocked(ElectronBrowserWindow.getAllWindows).mockReturnValue([win]);
    const persistAllWindows = vi.fn();
    const disposeAllTerminals = vi.fn();
    const lifecycle = service({ persistAllWindows, disposeAllTerminals });
    lifecycle.registerQuitHandlers();

    const beforeQuit = electronMock.appHandlers.get('before-quit')?.[0];
    if (!beforeQuit) throw new Error('before-quit handler was not registered');
    const event = { preventDefault: vi.fn() };
    beforeQuit(event);
    expect(persistAllWindows).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    emitFlushReply(win, true);
    await flushMicrotasks();
    expect(app.quit).toHaveBeenCalledTimes(1);

    const willQuit = electronMock.appHandlers.get('will-quit')?.[0];
    if (!willQuit) throw new Error('will-quit handler was not registered');
    willQuit();
    expect(disposeAllTerminals).toHaveBeenCalledTimes(1);
  });
});
