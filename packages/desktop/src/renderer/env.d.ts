/// <reference types="vite/client" />

// Exposed by preload via contextBridge (see src/preload/index.ts).
// Args/result stay `unknown` at the IPC boundary — narrowing happens in
// callsites that know the specific command.
interface Window {
  bh: {
    run(name: string, args?: unknown): Promise<unknown>;
    /** Opens the OS folder picker; returns the selected path or null on cancel. */
    pickWorkspace(): Promise<string | null>;
    /** "darwin" | "linux" | "win32" | etc. — frozen at preload time. */
    platform: string;
    /** OS home directory (frozen at preload). Used to suggest defaults
     *  like `~/BaseHalf-Demo` for the demo workspace generator. */
    homeDir: string;
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
