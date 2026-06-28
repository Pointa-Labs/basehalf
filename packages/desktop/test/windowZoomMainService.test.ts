import type { BrowserWindow } from 'electron';
import { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_IPC_CHANNELS } from '../src/platform/windows/common/window.js';
import { WindowZoomMainService } from '../src/platform/windows/electron-main/windowZoomMainService.js';

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: vi.fn() },
}));

interface FakeWindow extends BrowserWindow {
  readonly webContents: BrowserWindow['webContents'] & {
    readonly setZoomLevel: ReturnType<typeof vi.fn>;
    readonly getZoomFactor: ReturnType<typeof vi.fn>;
    readonly send: ReturnType<typeof vi.fn>;
  };
}

function fakeWindow(id: number, zoomFactor = 1.2): FakeWindow {
  return {
    webContents: {
      id,
      setZoomLevel: vi.fn(),
      getZoomFactor: vi.fn(() => zoomFactor),
      send: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
  } as unknown as FakeWindow;
}

describe('WindowZoomMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ElectronBrowserWindow.getFocusedWindow).mockReturnValue(null);
  });

  it('remembers, clamps, and reapplies a window zoom level', () => {
    const win = fakeWindow(1, 1.85);
    const service = new WindowZoomMainService();

    service.rememberWindow(win, 99);
    expect(service.getZoomLevel(win)).toBe(8);

    service.applyZoomToWindow(win);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(8);
    expect(win.webContents.send).toHaveBeenCalledWith(WINDOW_IPC_CHANNELS.zoomFactor, 1.85);
  });

  it('applies absolute zoom to a window and persists the owning window state', () => {
    const win = fakeWindow(2);
    const persistWindowState = vi.fn();
    const service = new WindowZoomMainService({ persistWindowState });

    service.applyZoomLevel(win, -99);

    expect(service.getZoomLevel(win)).toBe(-8);
    expect(win.webContents.setZoomLevel).toHaveBeenCalledWith(-8);
    expect(persistWindowState).toHaveBeenCalledWith(win);
  });

  it('exposes focused-window hooks for menus and settings IPC', () => {
    const focused = fakeWindow(3);
    const service = new WindowZoomMainService();
    service.rememberWindow(focused, 2);
    vi.mocked(ElectronBrowserWindow.getFocusedWindow).mockReturnValue(focused);

    expect(service.focusedWindowHooks.getZoomLevel()).toBe(2);
    service.focusedWindowHooks.applyZoomLevel(3);

    expect(service.getZoomLevel(focused)).toBe(3);
    expect(focused.webContents.setZoomLevel).toHaveBeenCalledWith(3);
  });

  it('forgets closed windows and treats missing focus as neutral zoom', () => {
    const win = fakeWindow(4);
    const service = new WindowZoomMainService();

    service.rememberWindow(win, 4);
    service.forgetWindow(win.webContents.id);

    expect(service.getZoomLevel(win)).toBe(0);
    expect(service.focusedWindowHooks.getZoomLevel()).toBe(0);
    service.focusedWindowHooks.applyZoomLevel(2);
    expect(win.webContents.setZoomLevel).not.toHaveBeenCalled();
  });
});
