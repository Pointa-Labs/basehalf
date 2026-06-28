import type { BrowserWindow } from 'electron';
import { WINDOW_IPC_CHANNELS } from '../common/window.js';

export interface WindowChromeMainServiceOptions {
  readonly installContextMenu: (win: BrowserWindow) => void;
  readonly applyZoomToWindow: (win: BrowserWindow) => void;
}

/**
 * Per-window chrome wiring: native context menu, fullscreen state bridge, and
 * zoom restoration after reload. Kept out of app startup so BrowserWindow
 * creation can stay a small factory plus service installation.
 */
export class WindowChromeMainService {
  constructor(private readonly opts: WindowChromeMainServiceOptions) {}

  install(win: BrowserWindow): void {
    this.opts.installContextMenu(win);

    const onFullscreenChange = (isFullscreen: boolean): void => {
      if (win.isDestroyed()) return;
      win.webContents.send(WINDOW_IPC_CHANNELS.fullscreen, isFullscreen);
    };
    win.on('enter-full-screen', () => onFullscreenChange(true));
    win.on('leave-full-screen', () => onFullscreenChange(false));
    win.webContents.on('did-finish-load', () => {
      onFullscreenChange(win.isFullScreen());
      this.opts.applyZoomToWindow(win);
    });
  }
}
