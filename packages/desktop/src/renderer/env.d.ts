/// <reference types="vite/client" />

// Exposed by preload via contextBridge (see src/preload/index.ts).
// Args/result stay `unknown` at the IPC boundary — narrowing happens in
// callsites that know the specific command.
interface Window {
  bh: {
    run(name: string, args?: unknown): Promise<unknown>;
    /** Opens the OS folder picker; returns the selected path or null on cancel. */
    pickWorkspace(): Promise<string | null>;
    /** OPEN-OR-FOCUS a workspace (by name): focus the window already showing it,
     *  else reuse THIS window if it's the welcome/empty one (rebind+reload), else
     *  open a NEW window. `{ reused }`: true = THIS window was reloaded (tearing
     *  down); false = a different window was focused/created (this one stays). */
    openWorkspace(name: string): Promise<{ reused: boolean }>;
    /** REOPEN THIS window bound to a workspace (by name) or welcome (`null`) — the
     *  in-place rebind+reload flows (remove-current → welcome; repath). Always
     *  reloads THIS window; flush editors first. */
    reopenWindow(name: string | null): Promise<void>;
    /** Open a fresh welcome window. */
    newWindow(): Promise<void>;
    /** The workspace paths a live window currently shows (welcome "Open" markers). */
    getOpenWorkspaces(): Promise<string[]>;
    /** Tell main the workspace registry changed → rebuild Open Recent + Dock menu. */
    notifyWorkspacesChanged(): void;
    /** Subscribe to window-set / registry changes (the welcome list re-fetches). */
    onWorkspacesWindowsChanged(handler: () => void): () => void;
    /** Classify an absolute path from an OS drag payload: 'file' | 'dir' |
     *  null (missing/unreadable). Drop handlers use it to route folders →
     *  add-as-workspace, files → copy-into-workspace. */
    pathKind(absPath: string): Promise<'file' | 'dir' | null>;
    /** The on-disk absolute path of a dropped File ('' when it has none).
     *  Bridges webUtils.getPathForFile, which only exists in preload. */
    pathForFile(file: File): string;
    /** Open a workspace-relative file in the OS default app (e.g. a .docx in a
     *  word processor) for types bh can't render inline. Resolved inside the
     *  current workspace. */
    openPath(relPath: string): Promise<{ ok: boolean; error?: string }>;
    /** "darwin" | "linux" | "win32" | etc. — frozen at preload time. */
    platform: string;
    /** OS home directory (frozen at preload). Used to suggest defaults
     *  like `~/BaseHalf-Demo` for the demo workspace generator. */
    homeDir: string;
    /** App version (package.json in dev, bundle metadata when packaged). */
    appVersion(): Promise<string>;
    /** Read the app-level prefs (owned by the main process). */
    getPrefs(): Promise<{ autoUpdateCheck: boolean }>;
    /** Patch the app-level prefs; resolves to the merged result. */
    setPrefs(patch: { autoUpdateCheck?: boolean }): Promise<{ autoUpdateCheck: boolean }>;
    /** Step the window zoom (the View menu's authoritative level); the new
     *  factor arrives via onZoomFactor. */
    zoomWindow(action: 'in' | 'out' | 'reset'): Promise<void>;
    /** Open an external https link in the system browser (main enforces an
     *  allowlist of project pages). */
    openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
    /** Read the system clipboard as text (main-process clipboard) — backs the
     *  terminal Paste action. */
    clipboardReadText(): Promise<string>;
    /** Claim the next native context menu (so it doesn't stack with an in-app
     *  menu). Synchronous — set before main's context-menu event for this click. */
    suppressNextNativeContextMenu(): void;
    /** Subscribe to the app-menu "Settings…" action (relayed by main).
     *  Returns an unsubscribe function. */
    onMenuOpenSettings(handler: () => void): () => void;
    /** Subscribe to the File ▸ Close Tab (⌘W) action (relayed by main).
     *  Returns an unsubscribe function. */
    onMenuCloseTab(handler: () => void): () => void;
    /** Quit handshake: flush all editors before the window closes; resolve false
     *  to cancel the quit (a conflict is blocking). Returns an unsubscribe fn. */
    onFlushRequest(handler: () => Promise<boolean>): () => void;
    /** Self-update bridge — main owns the state machine (main/updater.ts);
     *  the renderer narrows the `unknown` states where it consumes them. */
    updateGetState(): Promise<unknown>;
    updateCheck(): Promise<void>;
    updateDownload(): Promise<void>;
    updateInstall(): Promise<void>;
    /** Subscribe to update state transitions. Returns an unsubscribe function. */
    onUpdateState(handler: (state: unknown) => void): () => void;
    /** Background check found a new version (once per session per version).
     *  Returns an unsubscribe function. */
    onUpdateFoundBackground(handler: (info: { version: string }) => void): () => void;
    /** Subscribe to the menu/right-click "Open Folder…" action (relayed by
     *  main). Returns an unsubscribe function. */
    onMenuOpenFolder(handler: () => void): () => void;
    /** Subscribe to the File-menu workspace-management actions (rename /
     *  remove the active workspace, relayed by main). Returns an
     *  unsubscribe function. */
    onMenuWorkspaceAction(handler: (action: 'rename' | 'remove') => void): () => void;
    /** Subscribe to window fullscreen changes (relayed by main). Returns an
     *  unsubscribe function. */
    onFullscreenChange(handler: (isFullscreen: boolean) => void): () => void;
    /** Current window zoom factor (1.2^level); read synchronously from this frame.
     *  The title bar counter-zooms by 1/factor to stay aligned with the native
     *  traffic lights (which don't scale with page zoom). */
    getZoomFactor(): number;
    /** Subscribe to window zoom-factor changes (relayed by main). Returns an
     *  unsubscribe function. */
    onZoomFactor(handler: (factor: number) => void): () => void;
    /** Subscribe to file events from the core watcher (relayed by main).
     * Returns an unsubscribe function. */
    onFileEvent(
      handler: (
        event:
          | {
              type: 'add' | 'change' | 'unlink';
              relPath: string;
              isDir: boolean;
            }
          | {
              type: 'rename';
              fromRelPath: string;
              toRelPath: string;
              toAbsPath: string;
              isDir: boolean;
            },
      ) => void,
    ): () => void;
    /** Embedded terminal bridge — a real pty lives in main (the sandboxed
     *  renderer can't spawn processes); xterm.js in the renderer is the view. */
    terminal: {
      /** Spawn a shell pty (cwd defaults to the active workspace root, resolved
       *  in main). Resolves the new session id and its resolved cwd. */
      spawn(opts?: { cols?: number; rows?: number; cwd?: string }): Promise<{
        id: string;
        cwd: string;
      }>;
      /** Forward user keystrokes to a session's pty. */
      write(id: string, data: string): void;
      /** Tell a session's pty the new viewport size (cols × rows). */
      resize(id: string, cols: number, rows: number): void;
      /** Kill a session's pty (tab close / unmount). */
      kill(id: string): void;
      /** Subscribe to pty output. Returns an unsubscribe function. */
      onData(handler: (id: string, data: string) => void): () => void;
      /** Subscribe to pty exit. Returns an unsubscribe function. */
      onExit(handler: (id: string, exitCode: number) => void): () => void;
    };
  };
}
