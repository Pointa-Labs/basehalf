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
  };
}
