/// <reference types="vite/client" />

// Exposed by preload via contextBridge (see src/preload/index.ts).
// Args/result stay `unknown` at the IPC boundary — narrowing happens in
// callsites that know the specific command.
interface Window {
  bh: {
    run(name: string, args?: unknown): Promise<unknown>;
    /** Opens the OS folder picker; returns the selected path or null on cancel. */
    pickWorkspace(): Promise<string | null>;
    /** Open a workspace-relative file in the OS default app (e.g. .docx → Word)
     *  for types bh can't render inline. Resolved inside the current workspace. */
    openPath(relPath: string): Promise<{ ok: boolean; error?: string }>;
    /** "darwin" | "linux" | "win32" | etc. — frozen at preload time. */
    platform: string;
    /** OS home directory (frozen at preload). Used to suggest defaults
     *  like `~/BaseHalf-Demo` for the demo workspace generator. */
    homeDir: string;
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
  };
}
