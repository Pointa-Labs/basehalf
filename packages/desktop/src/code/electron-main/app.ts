import { BrowserWindow, app } from 'electron';
import type { PrefsStore } from '../../platform/storage/electron-main/prefsStore.js';
import type { WindowSecurityMainService } from '../../platform/windows/electron-main/windowSecurityMainService.js';
import type { WindowSessionMainService } from '../../platform/windows/electron-main/windowSessionMainService.js';
import type { WorkspaceSurfacesMainService } from '../../platform/workspaces/electron-main/workspaceSurfacesMainService.js';

export interface BaseHalfApplicationOptions {
  readonly windowSecurity?: Pick<WindowSecurityMainService, 'registerWebContentsGuards'>;
  readonly workspaceSurfaces: Pick<WorkspaceSurfacesMainService, 'installInitialMenu'>;
  readonly prefs: Pick<PrefsStore, 'load'>;
  readonly windowSession: Pick<WindowSessionMainService, 'restoreSession'>;
  readonly cleanupUpdateLeftovers: () => void;
  readonly startBackgroundUpdateChecks: () => void;
  readonly spawnWindow: (root: string | null) => void;
  readonly electronApp?: Pick<Electron.App, 'on' | 'quit' | 'whenReady'>;
  readonly windows?: Pick<typeof BrowserWindow, 'getAllWindows'>;
  readonly platform?: NodeJS.Platform;
  readonly log?: Pick<Console, 'error'>;
}

/**
 * BaseHalf's main-process application lifecycle, shaped after VS Code's
 * `CodeApplication.startup()`: compose services elsewhere, then let the
 * application coordinate ready-time startup and app-level listeners.
 */
export class BaseHalfApplication {
  private readonly electronApp: Pick<Electron.App, 'on' | 'quit' | 'whenReady'>;
  private readonly windows: Pick<typeof BrowserWindow, 'getAllWindows'>;
  private readonly platform: NodeJS.Platform;
  private readonly log: Pick<Console, 'error'>;

  constructor(private readonly opts: BaseHalfApplicationOptions) {
    this.electronApp = opts.electronApp ?? app;
    this.windows = opts.windows ?? BrowserWindow;
    this.platform = opts.platform ?? process.platform;
    this.log = opts.log ?? console;
  }

  async startup(): Promise<void> {
    this.registerListeners();
    await this.electronApp.whenReady();
    await this.openFirstWindow();
    this.afterWindowOpen();
  }

  private registerListeners(): void {
    this.opts.windowSecurity?.registerWebContentsGuards();
    this.electronApp.on('window-all-closed', () => {
      if (this.platform !== 'darwin') this.electronApp.quit();
    });
  }

  private async openFirstWindow(): Promise<void> {
    this.opts.workspaceSurfaces.installInitialMenu();
    try {
      await this.opts.prefs.load();
    } catch (err) {
      this.log.error('[bh-desktop] prefs.load failed; using defaults', err);
    }
    await this.opts.windowSession.restoreSession();
  }

  private afterWindowOpen(): void {
    this.opts.cleanupUpdateLeftovers();
    this.opts.startBackgroundUpdateChecks();
    this.electronApp.on('activate', () => {
      if (this.windows.getAllWindows().length === 0) this.opts.spawnWindow(null);
    });
  }
}

export type DesktopMainApplicationOptions = BaseHalfApplicationOptions;
export const DesktopMainApplication = BaseHalfApplication;
