import { contextBridge, ipcRenderer } from 'electron';

interface SerializedError {
  name: string;
  message: string;
  code?: string;
}
type BhRunResponse = { ok: true; result: unknown } | { ok: false; error: SerializedError };

// The renderer's only door. Mirrors core.run(name, args) over IPC and
// exposes GUI-only Electron helpers (pickWorkspace) that don't belong
// in core. Re-throws serialized errors as real Error instances so
// callsites can use plain try/catch — the IPC tagged-union response is
// an implementation detail of the channel, not something the renderer
// should see.
const bh = {
  run: async (name: string, args?: unknown): Promise<unknown> => {
    // Default to {} so core handlers can read `args.foo` without a
    // defensive `?.` — renderer callsites that pass nothing
    // (e.g. `bh.run('badge.list')`) used to send undefined and crash
    // any handler that did `args.kind` or similar.
    const response = (await ipcRenderer.invoke('bh:run', name, args ?? {})) as BhRunResponse;
    if (response.ok) return response.result;
    const err = new Error(response.error.message);
    err.name = response.error.name;
    if (response.error.code !== undefined) {
      (err as Error & { code?: string }).code = response.error.code;
    }
    throw err;
  },
  pickWorkspace: (): Promise<string | null> => ipcRenderer.invoke('workspace:pick'),
  /** Frozen at preload time; safe to read synchronously. */
  platform: process.platform as NodeJS.Platform,
  /** Subscribe to file events from the core watcher (relayed by main process).
   * Returns an unsubscribe function. */
  onFileEvent: (
    handler: (event: {
      type: 'add' | 'change' | 'unlink';
      relPath: string;
      isDir: boolean;
    }) => void,
  ): (() => void) => {
    const wrapped = (
      _e: unknown,
      event: { type: 'add' | 'change' | 'unlink'; relPath: string; isDir: boolean },
    ): void => handler(event);
    ipcRenderer.on('bh:file-event', wrapped);
    return () => ipcRenderer.off('bh:file-event', wrapped);
  },
};

contextBridge.exposeInMainWorld('bh', bh);
