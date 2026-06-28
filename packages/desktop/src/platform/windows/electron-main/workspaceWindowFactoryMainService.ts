import { BrowserWindow, type Display, type Rectangle, type WebContents } from 'electron';
import type { ClosedWindowContext } from './windowLifecycleMainService.js';
import {
  WELCOME_KEY,
  type WindowState,
  clampToDisplays,
  debounce,
  geometryFor,
  readWindowStates,
  saveWindowState,
  saveWindowStateSync,
} from './windowState.js';

export interface WorkspaceWindowFactoryMainServiceOptions {
  readonly configDir: string;
  readonly preloadPath: string;
  readonly rendererHtmlPath: string;
  readonly rendererUrl?: string | undefined;
  readonly getDisplays: () => Display[];
  readonly getWorkspaceRoot: (wc: WebContents) => string | null;
  readonly getWorkspaceRootById: (webContentsId: number) => string | null;
  readonly setWorkspaceRoot: (wc: WebContents, root: string | null) => void;
  readonly clearWorkspaceRoot: (webContentsId: number) => void;
  readonly touchWorkspace: (root: string | null) => void;
  readonly currentOpenKeys: () => string[];
  readonly refreshWorkspaceSurfaces: () => void;
  readonly installWindowCloseHandlers: (
    win: BrowserWindow,
    onClosed: (context: ClosedWindowContext) => void,
  ) => void;
  readonly disposeTerminalsForWindow: (webContentsId: number) => void;
  readonly stopWatcherIfOrphaned: (root: string | null) => void | Promise<void>;
  readonly rememberZoom: (win: BrowserWindow, level: number | undefined) => void;
  readonly forgetZoom: (webContentsId: number) => void;
  readonly getZoomLevel: (win: BrowserWindow) => number;
  readonly installChrome: (win: BrowserWindow) => void;
  readonly log?: Pick<Console, 'error'>;
}

/**
 * BrowserWindow factory and per-window installation, mirroring VS Code's split
 * between application startup and `CodeWindow`/window implementation details.
 */
export class WorkspaceWindowFactoryMainService {
  private readonly log: Pick<Console, 'error'>;

  constructor(private readonly opts: WorkspaceWindowFactoryMainServiceOptions) {
    this.log = opts.log ?? console;
  }

  async createWindow(workspaceRoot: string | null): Promise<BrowserWindow> {
    const file = await readWindowStates(this.opts.configDir);
    const key = workspaceRoot ?? WELCOME_KEY;
    const saved = geometryFor(file, key);
    const state = clampToDisplays(saved, this.opts.getDisplays());

    const win = new BrowserWindow({
      width: state.width,
      height: state.height,
      ...(state.x !== undefined && { x: state.x }),
      ...(state.y !== undefined && { y: state.y }),
      ...(process.platform === 'darwin' && {
        titleBarStyle: 'hidden' as const,
        trafficLightPosition: { x: 19, y: 11 },
      }),
      webPreferences: {
        preload: this.opts.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    this.opts.rememberZoom(win, saved.zoomLevel);
    if (state.isMaximized) win.maximize();

    this.opts.setWorkspaceRoot(win.webContents, workspaceRoot);
    this.opts.touchWorkspace(workspaceRoot);
    const webContentsId = win.webContents.id;

    this.opts.installWindowCloseHandlers(win, (context) =>
      this.onWindowClosed(webContentsId, context),
    );
    this.opts.installChrome(win);
    this.loadWindow(win);
    this.installGeometryPersistence(win);
    this.opts.refreshWorkspaceSurfaces();

    return win;
  }

  spawnWindow(root: string | null): void {
    void this.createWindow(root).catch((err) => {
      this.log.error('[bh-desktop] createWindow failed', err);
    });
  }

  persistWindowState(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    const key = this.opts.getWorkspaceRoot(win.webContents) ?? WELCOME_KEY;
    void saveWindowState(this.opts.configDir, key, this.windowState(win, bounds));
  }

  private onWindowClosed(webContentsId: number, context: ClosedWindowContext): void {
    this.opts.disposeTerminalsForWindow(webContentsId);
    const closedRoot = this.opts.getWorkspaceRootById(webContentsId);
    this.opts.clearWorkspaceRoot(webContentsId);
    this.opts.forgetZoom(webContentsId);
    void this.opts.stopWatcherIfOrphaned(closedRoot);

    if (context.lastGeometry && !context.isQuitting) {
      try {
        saveWindowStateSync(
          this.opts.configDir,
          closedRoot ?? WELCOME_KEY,
          context.lastGeometry,
          this.opts.currentOpenKeys(),
        );
      } catch {
        // Best-effort; never let a persistence failure escape the 'closed' handler.
      }
    }
    if (!context.isQuitting) this.opts.refreshWorkspaceSurfaces();
  }

  private loadWindow(win: BrowserWindow): void {
    if (this.opts.rendererUrl) {
      void win.loadURL(this.opts.rendererUrl);
    } else {
      void win.loadFile(this.opts.rendererHtmlPath);
    }
  }

  private installGeometryPersistence(win: BrowserWindow): void {
    const debouncedPersist = debounce(() => this.persistWindowState(win), 500);
    win.on('move', debouncedPersist);
    win.on('resize', debouncedPersist);
    win.on('maximize', debouncedPersist);
    win.on('unmaximize', debouncedPersist);
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
