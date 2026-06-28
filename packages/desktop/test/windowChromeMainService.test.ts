import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_IPC_CHANNELS } from '../src/platform/windows/common/window.js';
import { WindowChromeMainService } from '../src/platform/windows/electron-main/windowChromeMainService.js';

type AnyHandler = (...args: unknown[]) => unknown;

interface FakeWindow extends BrowserWindow {
  emitForTest(event: string): void;
  emitWebContentsForTest(event: string): void;
}

function fakeWindow(): FakeWindow {
  const windowHandlers = new Map<string, AnyHandler[]>();
  const webContentsHandlers = new Map<string, AnyHandler[]>();
  const win = {
    webContents: {
      send: vi.fn(),
      on: vi.fn((event: string, handler: AnyHandler) => {
        webContentsHandlers.set(event, [...(webContentsHandlers.get(event) ?? []), handler]);
      }),
    },
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    on: vi.fn((event: string, handler: AnyHandler) => {
      windowHandlers.set(event, [...(windowHandlers.get(event) ?? []), handler]);
      return win;
    }),
    emitForTest: (event: string) => {
      for (const handler of windowHandlers.get(event) ?? []) handler();
    },
    emitWebContentsForTest: (event: string) => {
      for (const handler of webContentsHandlers.get(event) ?? []) handler();
    },
  };
  return win as unknown as FakeWindow;
}

describe('WindowChromeMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs per-window chrome hooks', () => {
    const win = fakeWindow();
    const installContextMenu = vi.fn();
    const applyZoomToWindow = vi.fn();
    const service = new WindowChromeMainService({ installContextMenu, applyZoomToWindow });

    service.install(win);

    expect(installContextMenu).toHaveBeenCalledWith(win);
    expect(win.on).toHaveBeenCalledWith('enter-full-screen', expect.any(Function));
    expect(win.on).toHaveBeenCalledWith('leave-full-screen', expect.any(Function));
    expect(win.webContents.on).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
  });

  it('relays fullscreen changes and reapplies zoom after load', () => {
    const win = fakeWindow();
    const applyZoomToWindow = vi.fn();
    const service = new WindowChromeMainService({
      installContextMenu: vi.fn(),
      applyZoomToWindow,
    });
    service.install(win);

    win.emitForTest('enter-full-screen');
    expect(win.webContents.send).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.fullscreen, true);

    vi.mocked(win.isFullScreen).mockReturnValue(true);
    win.emitWebContentsForTest('did-finish-load');
    expect(win.webContents.send).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.fullscreen, true);
    expect(applyZoomToWindow).toHaveBeenCalledWith(win);
  });
});
