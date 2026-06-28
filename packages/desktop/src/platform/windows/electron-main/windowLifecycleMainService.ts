import { BrowserWindow, type IpcMainEvent, app, ipcMain } from 'electron';
import { WINDOW_IPC_CHANNELS } from '../common/window.js';
import type { WindowState } from './windowState.js';

export interface ClosedWindowContext {
  readonly lastGeometry: WindowState | null;
  readonly isQuitting: boolean;
}

export interface WindowLifecycleMainServiceOptions {
  readonly captureWindowState: (win: BrowserWindow) => WindowState | null;
  readonly persistAllWindows: () => void;
  readonly disposeAllTerminals: () => void;
  readonly flushTimeoutMs?: number;
}

/**
 * Main-process shutdown coordinator, aligned with VS Code's lifecycle split:
 * window creation owns BrowserWindow construction, while this service owns the
 * close/quit handshake with renderers.
 *
 * The renderer still performs the actual editor flush; main coordinates timing:
 * a single window close waits for that window, while app quit pauses once,
 * persists the full open set, flushes all windows, then resumes the quit.
 */
export class WindowLifecycleMainService {
  private isQuitting = false;
  private flushedAllForQuit = false;
  private readonly flushTimeoutMs: number;

  constructor(private readonly opts: WindowLifecycleMainServiceOptions) {
    this.flushTimeoutMs = opts.flushTimeoutMs ?? 3000;
  }

  get quitting(): boolean {
    return this.isQuitting;
  }

  registerQuitHandlers(): void {
    app.on('before-quit', (event) => {
      if (this.flushedAllForQuit) return;
      if (this.isQuitting) {
        event.preventDefault();
        return;
      }
      this.opts.persistAllWindows();
      event.preventDefault();
      this.isQuitting = true;
      void Promise.all(
        BrowserWindow.getAllWindows()
          .filter((win) => !win.isDestroyed())
          .map((win) => this.flushWindow(win)),
      ).then((results) => {
        if (results.some((ok) => ok === false)) {
          this.isQuitting = false;
          return;
        }
        this.flushedAllForQuit = true;
        app.quit();
      });
    });

    app.on('will-quit', () => {
      this.opts.disposeAllTerminals();
    });
  }

  installWindowCloseHandlers(
    win: BrowserWindow,
    onClosed: (context: ClosedWindowContext) => void,
  ): void {
    let lastGeometry: WindowState | null = null;
    let flushedForClose = false;

    win.on('close', (event) => {
      if (!win.isDestroyed()) {
        lastGeometry = this.opts.captureWindowState(win);
      }
      if (this.isQuitting || flushedForClose || win.isDestroyed()) return;
      event.preventDefault();
      void this.flushWindow(win).then((ok) => {
        if (!ok) return;
        flushedForClose = true;
        if (!win.isDestroyed()) win.close();
      });
    });

    win.on('closed', () => {
      onClosed({ lastGeometry, isQuitting: this.isQuitting });
    });
  }

  flushWindow(win: BrowserWindow): Promise<boolean> {
    return new Promise((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        ipcMain.removeListener(WINDOW_IPC_CHANNELS.flushReply, onReply);
      };
      const finish = (ok: boolean): void => {
        cleanup();
        resolve(ok);
      };
      const onReply = (event: IpcMainEvent, ok: unknown): void => {
        if (win.isDestroyed()) {
          finish(true);
          return;
        }
        if (event.sender !== win.webContents) return;
        finish(ok !== false);
      };
      const timer = setTimeout(() => finish(false), this.flushTimeoutMs);
      ipcMain.on(WINDOW_IPC_CHANNELS.flushReply, onReply);
      try {
        win.webContents.send(WINDOW_IPC_CHANNELS.flushRequest);
      } catch {
        finish(true);
      }
    });
  }
}
