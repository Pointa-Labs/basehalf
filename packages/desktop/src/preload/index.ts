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
    // When core tags an error with a `code` (e.g. PATH_NOT_FOUND),
    // smuggle it into the message as a `[CODE] …` prefix. Electron's
    // contextBridge sanitizes thrown Errors aggressively — even
    // instance-assigned standard properties like err.name fall back to
    // the prototype default ("Error"), and custom props like .code are
    // dropped entirely. The message string is the only field that
    // reliably survives the bridge, so callers like isPathNotFound parse
    // the prefix to recover the discriminator.
    const taggedMessage = response.error.code
      ? `[${response.error.code}] ${response.error.message}`
      : response.error.message;
    const err = new Error(taggedMessage);
    err.name = response.error.code ?? response.error.name;
    throw err;
  },
  pickWorkspace: (): Promise<string | null> => ipcRenderer.invoke('workspace:pick'),
  /** Open a workspace-relative file in the OS default app (e.g. a .docx in Word)
   *  for types bh can't render inline. Main resolves it inside the current
   *  workspace + rejects path escapes. Resolves {ok} or {ok:false, error}. */
  openPath: (relPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:open-path', relPath),
  /** Frozen at preload time; safe to read synchronously. */
  platform: process.platform as NodeJS.Platform,
  /** OS home directory, frozen at preload. Used by the renderer to suggest
   *  default locations for things like the demo workspace
   *  (e.g. `~/BaseHalf-Demo`) without requiring an IPC round-trip.
   *  Reads process.env directly (not node:os) so this stays compatible with
   *  sandboxed preload contexts where Node built-ins aren't available. */
  homeDir: process.env.HOME ?? process.env.USERPROFILE ?? '',
  /** Subscribe to the menu/right-click "Open Folder…" action (relayed by main).
   * Returns an unsubscribe function. The renderer responds by running its
   * own pickAndAdd flow, so the folder-open UX is identical to the in-app
   * paths — main just triggers it. */
  onMenuOpenFolder: (handler: () => void): (() => void) => {
    const wrapped = (): void => handler();
    ipcRenderer.on('menu:open-folder', wrapped);
    return () => ipcRenderer.off('menu:open-folder', wrapped);
  },
  /** Subscribe to file events from the core watcher (relayed by main process).
   * Returns an unsubscribe function. Rename events are synthetic — the
   * watcher pairs an unlink with a follow-up add (same dir + ext) and
   * emits a single 'rename' so renderers can rebind currentFile without
   * the markOrphan flicker. */
  onFileEvent: (
    handler: (
      event:
        | { type: 'add' | 'change' | 'unlink'; relPath: string; isDir: boolean }
        | {
            type: 'rename';
            fromRelPath: string;
            toRelPath: string;
            toAbsPath: string;
            isDir: boolean;
          },
    ) => void,
  ): (() => void) => {
    const wrapped = (
      _e: unknown,
      event:
        | { type: 'add' | 'change' | 'unlink'; relPath: string; isDir: boolean }
        | {
            type: 'rename';
            fromRelPath: string;
            toRelPath: string;
            toAbsPath: string;
            isDir: boolean;
          },
    ): void => handler(event);
    ipcRenderer.on('bh:file-event', wrapped);
    return () => ipcRenderer.off('bh:file-event', wrapped);
  },
};

contextBridge.exposeInMainWorld('bh', bh);
