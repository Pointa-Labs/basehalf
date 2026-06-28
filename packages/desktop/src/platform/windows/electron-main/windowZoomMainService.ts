import { BrowserWindow } from 'electron';
import { WINDOW_IPC_CHANNELS } from '../common/window.js';

export interface WindowZoomHooks {
  getZoomLevel: () => number;
  applyZoomLevel: (level: number) => void;
}

export interface WindowZoomMainServiceOptions {
  readonly persistWindowState?: (win: BrowserWindow) => void;
}

const MIN_ZOOM_LEVEL = -8;
const MAX_ZOOM_LEVEL = 8;

/**
 * Per-window UI zoom, aligned with VS Code's window-owned zoom state:
 * each BrowserWindow has its own level, menu/settings commands target the
 * focused window, and webContents zoom is restored after every reload.
 */
export class WindowZoomMainService {
  private readonly levels = new Map<number, number>();
  private persistWindowState: ((win: BrowserWindow) => void) | undefined;

  constructor(opts: WindowZoomMainServiceOptions = {}) {
    this.persistWindowState = opts.persistWindowState;
  }

  setPersistWindowState(persistWindowState: (win: BrowserWindow) => void): void {
    this.persistWindowState = persistWindowState;
  }

  get focusedWindowHooks(): WindowZoomHooks {
    return {
      getZoomLevel: () => this.getZoomLevel(BrowserWindow.getFocusedWindow()),
      applyZoomLevel: (level: number) =>
        this.applyZoomLevel(BrowserWindow.getFocusedWindow(), level),
    };
  }

  rememberWindow(win: BrowserWindow, level: number | undefined): void {
    if (win.isDestroyed()) return;
    this.levels.set(win.webContents.id, this.clamp(level ?? 0));
  }

  forgetWindow(webContentsId: number): void {
    this.levels.delete(webContentsId);
  }

  getZoomLevel(win: BrowserWindow | null): number {
    if (!win || win.isDestroyed()) return 0;
    return this.levels.get(win.webContents.id) ?? 0;
  }

  /** Push the remembered level to webContents and notify the renderer so custom
   *  chrome can counter-scale against native, non-zooming window controls. */
  applyZoomToWindow(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const wc = win.webContents;
    wc.setZoomLevel(this.getZoomLevel(win));
    wc.send(WINDOW_IPC_CHANNELS.zoomFactor, wc.getZoomFactor());
  }

  applyZoomLevel(win: BrowserWindow | null, level: number): void {
    if (!win || win.isDestroyed()) return;
    this.levels.set(win.webContents.id, this.clamp(level));
    this.applyZoomToWindow(win);
    this.persistWindowState?.(win);
  }

  private clamp(level: number): number {
    return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level));
  }
}
