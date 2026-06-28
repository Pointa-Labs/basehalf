import { BrowserWindow, Menu, type WebContents, app } from 'electron';
import {
  type OpenRecentMode,
  type RecentWorkspace,
  type ZoomMenuHooks,
  buildAppMenu,
  buildDockMenu,
} from '../../menubar/electron-main/menubarMainService.js';
import { WINDOW_IPC_CHANNELS } from '../../windows/common/window.js';
import { WELCOME_KEY } from '../../windows/electron-main/windowState.js';
import { sortWorkspacesByRecency } from '../../windows/electron-main/windows.js';
import type {
  WorkspaceRegistryMain,
  WorkspaceRegistryRecord,
} from './workspaceRegistryMainService.js';

export interface WorkspaceSurfacesMainServiceOptions {
  readonly registry: Pick<
    WorkspaceRegistryMain,
    'listWorkspaces' | 'rootForName' | 'touchWorkspace'
  >;
  readonly getWorkspaceRoot: (wc: WebContents) => string | null;
  readonly zoomHooks: ZoomMenuHooks;
  readonly spawnWindow: (root: string | null) => void;
  readonly openRecentWorkspace: (name: string, mode: OpenRecentMode) => void | Promise<void>;
  readonly checkForUpdates: () => void;
  readonly log?: Pick<Console, 'error'>;
}

/**
 * Main-process workspace/window surfaces, mirroring VS Code's split between
 * window management and workspaces history:
 *   - compute which registered workspaces are currently open;
 *   - rebuild File > Open Recent and the macOS Dock menu;
 *   - broadcast window-set changes so renderer welcome surfaces can refresh.
 *
 * BrowserWindow creation/routing/lifecycle live in the window services; this
 * service owns the derived UI surfaces around those windows.
 */
export class WorkspaceSurfacesMainService {
  private readonly log: Pick<Console, 'error'>;

  constructor(private readonly opts: WorkspaceSurfacesMainServiceOptions) {
    this.log = opts.log ?? console;
  }

  /** Workspace keys (paths; `''` = welcome) for every live window. */
  currentOpenKeys(): string[] {
    const keys: string[] = [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      keys.push(this.opts.getWorkspaceRoot(win.webContents) ?? WELCOME_KEY);
    }
    return keys;
  }

  /** Workspace roots every live window is bound to. */
  boundRoots(): string[] {
    const roots: string[] = [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const root = this.opts.getWorkspaceRoot(win.webContents);
      if (root !== null) roots.push(root);
    }
    return roots;
  }

  isRootStillBound(root: string): boolean {
    return this.boundRoots().some((bound) => bound === root);
  }

  /** Resolve a workspace name to its registered root. */
  async rootForName(name: unknown): Promise<string | null> {
    return this.opts.registry.rootForName(name);
  }

  /** Bump recency after a workspace is opened/focused. */
  touchWorkspace(root: string | null): void {
    if (root === null) return;
    void this.opts.registry.touchWorkspace(root).then(
      () => this.refresh(),
      () => {},
    );
  }

  installInitialMenu(): void {
    Menu.setApplicationMenu(
      buildAppMenu(
        this.opts.zoomHooks,
        () => this.opts.spawnWindow(null),
        [],
        this.opts.openRecentWorkspace,
        this.opts.checkForUpdates,
      ),
    );
  }

  /** Rebuild Open Recent / Dock menu and notify renderers. */
  refresh(): void {
    void (async () => {
      let recent: RecentWorkspace[] = [];
      try {
        recent = await this.listRecentWorkspaces();
      } catch (err) {
        this.log.error('[bh-desktop] refreshWorkspaceSurfaces: list failed', err);
      }
      Menu.setApplicationMenu(
        buildAppMenu(
          this.opts.zoomHooks,
          () => this.opts.spawnWindow(null),
          recent,
          this.opts.openRecentWorkspace,
          this.opts.checkForUpdates,
        ),
      );
      app.dock?.setMenu(buildDockMenu(recent, this.opts.openRecentWorkspace));
      this.broadcastWindowsChanged();
    })();
  }

  private async listRecentWorkspaces(): Promise<RecentWorkspace[]> {
    const workspaces: WorkspaceRegistryRecord[] = await this.opts.registry.listWorkspaces();
    const open = new Set(this.boundRoots().map((r) => r.toLowerCase()));
    return sortWorkspacesByRecency(workspaces).map((w) => ({
      name: w.name,
      path: w.path,
      isOpen: open.has(w.path.toLowerCase()),
    }));
  }

  private broadcastWindowsChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(WINDOW_IPC_CHANNELS.workspaceWindowsChanged);
    }
  }
}
