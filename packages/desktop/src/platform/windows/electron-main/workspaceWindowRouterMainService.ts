import { BrowserWindow, type WebContents } from 'electron';
import type { OpenRecentMode } from '../../menubar/electron-main/menubarMainService.js';
import type { WorkspaceRegistryMain } from '../../workspaces/electron-main/workspaceRegistryMainService.js';
import { type WindowRef, decideOpen, samePath } from './windows.js';

export interface WorkspaceWindowRouterMainServiceOptions {
  readonly registry: Pick<WorkspaceRegistryMain, 'stopWatcher'>;
  readonly rootForName: (name: unknown) => Promise<string | null>;
  readonly getWorkspaceRoot: (wc: WebContents) => string | null;
  readonly setWorkspaceRoot: (wc: WebContents, root: string | null) => void;
  readonly isRootStillBound: (root: string) => boolean;
  readonly touchWorkspace: (root: string | null) => void;
  readonly refreshWorkspaceSurfaces: () => void;
  readonly createWindow: (root: string | null) => Promise<BrowserWindow>;
  readonly flushWindow: (win: BrowserWindow) => Promise<boolean>;
  readonly persistWindowState: (win: BrowserWindow) => void;
  readonly disposeTerminalsForWindow: (webContentsId: number) => void;
}

/**
 * Workspace/window routing, aligned with VS Code's WindowsMainService shape:
 * opening a workspace decides whether to focus, reuse, or create a window, while
 * the BrowserWindow factory remains a separate primitive injected by the app.
 */
export class WorkspaceWindowRouterMainService {
  private openChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: WorkspaceWindowRouterMainServiceOptions) {}

  async openWorkspaceFromWindow(
    sender: BrowserWindow | null,
    name: unknown,
  ): Promise<{ reused: boolean }> {
    if (!sender || sender.isDestroyed()) return { reused: false };
    const targetRoot = await this.opts.rootForName(name);
    if (targetRoot === null) return { reused: false };
    const result = this.openChain.then(() => this.openOrFocus(sender, targetRoot));
    this.openChain = result.catch(() => undefined);
    return result;
  }

  async reopenWorkspaceInWindow(win: BrowserWindow | null, name: unknown): Promise<void> {
    if (!win || win.isDestroyed()) return;
    const targetRoot = name === null ? null : await this.opts.rootForName(name);
    const ok = await this.opts.flushWindow(win);
    if (ok && !win.isDestroyed()) this.rebindAndReload(win, targetRoot);
  }

  async createEmptyWindow(): Promise<void> {
    await this.opts.createWindow(null);
  }

  getOpenWorkspaceRoots(): string[] {
    return BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => this.opts.getWorkspaceRoot(win.webContents))
      .filter((root): root is string => root !== null);
  }

  refreshWorkspaceSurfaces(): void {
    this.opts.refreshWorkspaceSurfaces();
  }

  async openRecentWorkspace(name: string, mode: OpenRecentMode): Promise<void> {
    const root = await this.opts.rootForName(name);
    if (root === null) return;
    const focused = BrowserWindow.getFocusedWindow();
    if (mode === 'new') {
      await this.opts.createWindow(root);
      return;
    }
    if (mode === 'same' && focused && !focused.isDestroyed()) {
      if (samePath(this.opts.getWorkspaceRoot(focused.webContents), root)) return;
      const ok = await this.opts.flushWindow(focused);
      if (ok && !focused.isDestroyed()) this.rebindAndReload(focused, root);
      return;
    }
    if (focused && !focused.isDestroyed()) {
      const result = this.openChain.then(() => this.openOrFocus(focused, root));
      this.openChain = result.catch(() => undefined);
      await result;
    } else {
      await this.opts.createWindow(root);
    }
  }

  rebindAndReload(win: BrowserWindow, root: string | null): void {
    const previousRoot = this.opts.getWorkspaceRoot(win.webContents);
    this.opts.setWorkspaceRoot(win.webContents, root);
    this.opts.touchWorkspace(root);
    this.opts.persistWindowState(win);
    void this.stopWatcherIfOrphaned(previousRoot);
    this.opts.disposeTerminalsForWindow(win.webContents.id);
    win.webContents.reload();
    this.opts.refreshWorkspaceSurfaces();
  }

  async stopWatcherIfOrphaned(root: string | null): Promise<void> {
    if (root === null || this.opts.isRootStillBound(root)) return;
    try {
      await this.opts.registry.stopWatcher(root);
    } catch {
      // Best-effort cleanup; a failed stop just leaves an idle watcher.
    }
  }

  private async openOrFocus(
    sender: BrowserWindow,
    targetRoot: string,
  ): Promise<{ reused: boolean }> {
    if (sender.isDestroyed()) return { reused: false };
    const refs = BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map<WindowRef>((win) => ({
        id: win.webContents.id,
        root: this.opts.getWorkspaceRoot(win.webContents),
      }));
    const decision = decideOpen(refs, sender.webContents.id, targetRoot);
    if (decision.action === 'focus') {
      const existing = BrowserWindow.getAllWindows().find(
        (win) => !win.isDestroyed() && win.webContents.id === decision.id,
      );
      if (existing) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      }
      this.opts.touchWorkspace(targetRoot);
      this.opts.refreshWorkspaceSurfaces();
      return { reused: false };
    }
    if (decision.action === 'new-window') {
      await this.opts.createWindow(targetRoot);
      return { reused: false };
    }
    if (sender.isDestroyed()) return { reused: false };
    this.rebindAndReload(sender, targetRoot);
    return { reused: true };
  }
}
