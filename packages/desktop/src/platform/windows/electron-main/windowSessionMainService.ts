import { BrowserWindow, type Rectangle, type WebContents } from 'electron';
import type { WorkspaceRegistryMain } from '../../workspaces/electron-main/workspaceRegistryMainService.js';
import {
  WELCOME_KEY,
  type WindowState,
  readWindowStates,
  saveWindowStateSync,
} from './windowState.js';
import { resolveSessionRoots } from './windows.js';

export interface WindowSessionMainServiceOptions {
  readonly configDir: string;
  readonly registry: Pick<WorkspaceRegistryMain, 'registeredPaths'>;
  readonly createWindow: (root: string | null) => Promise<BrowserWindow>;
  readonly getWorkspaceRoot: (wc: WebContents) => string | null;
  readonly currentOpenKeys: () => string[];
  readonly getZoomLevel: (win: BrowserWindow) => number;
  readonly log?: Pick<Console, 'error'>;
}

/**
 * Session restore and quit-time state persistence. Mirrors VS Code's separation
 * between app startup and the window state service: the app asks this service to
 * restore/persist, while BrowserWindow construction remains injected.
 */
export class WindowSessionMainService {
  private readonly log: Pick<Console, 'error'>;

  constructor(private readonly opts: WindowSessionMainServiceOptions) {
    this.log = opts.log ?? console;
  }

  async restoreSession(): Promise<void> {
    let opened = 0;
    try {
      const file = await readWindowStates(this.opts.configDir);
      const roots = resolveSessionRoots(file.open, await this.registeredPaths());
      for (const root of roots) {
        try {
          await this.opts.createWindow(root);
          opened++;
        } catch (err) {
          this.log.error('[bh-desktop] restore window failed for', root, err);
        }
      }
    } catch (err) {
      this.log.error('[bh-desktop] restoreSession failed', err);
    }
    if (opened === 0) {
      try {
        await this.opts.createWindow(null);
      } catch (err) {
        this.log.error('[bh-desktop] welcome-window fallback failed', err);
      }
    }
  }

  persistAllWindowsSync(): void {
    const open = this.opts.currentOpenKeys();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const bounds = win.getBounds();
      const key = this.opts.getWorkspaceRoot(win.webContents) ?? WELCOME_KEY;
      try {
        saveWindowStateSync(this.opts.configDir, key, this.windowState(win, bounds), open);
      } catch {
        // Best-effort; never block quit on persistence failures.
      }
    }
  }

  private async registeredPaths(): Promise<string[]> {
    return this.opts.registry.registeredPaths();
  }

  private windowState(win: BrowserWindow, bounds: Rectangle): WindowState {
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
      zoomLevel: this.opts.getZoomLevel(win),
    };
  }
}
