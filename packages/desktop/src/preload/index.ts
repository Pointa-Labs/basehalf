import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';

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
  /** OPEN-OR-FOCUS a workspace (by name) in the multi-window model: main focuses
   *  the window already showing it, else reuses THIS window if it's the welcome/
   *  empty one (rebind+reload), else opens a NEW window — the caller keeps its own
   *  workspace. Returns `{ reused }`: true = THIS window was rebound+reloaded (it's
   *  tearing down); false = a different window was focused/created (this window
   *  stays alive, so reset busy + re-list). */
  openWorkspace: (name: string): Promise<{ reused: boolean }> =>
    ipcRenderer.invoke('workspace:open', name),
  /** REOPEN THIS window bound to a workspace (by name) or the welcome state
   *  (`null`) — the in-place rebind+reload flows: remove-current (→ welcome) and
   *  repath (the bound path moved under this window). Always reloads THIS window,
   *  so the caller MUST flush its editors first (the reload discards renderer
   *  state). */
  reopenWindow: (name: string | null): Promise<void> =>
    ipcRenderer.invoke('workspace:reopen', name),
  /** Open a fresh welcome window (File ▸ New Window / ⇧⌘N also drives this). */
  newWindow: (): Promise<void> => ipcRenderer.invoke('window:new'),
  /** The workspace paths a live window currently shows — the welcome list marks
   *  these "Open" (clicking focuses that window rather than opening anew). */
  getOpenWorkspaces: (): Promise<string[]> => ipcRenderer.invoke('app:open-workspaces'),
  /** Tell main the workspace REGISTRY changed (add/remove/rename/repath) so it
   *  rebuilds File ▸ Open Recent + the Dock recent menu from the fresh list. */
  notifyWorkspacesChanged: (): void => {
    ipcRenderer.send('app:workspaces-changed');
  },
  /** Subscribe to "a window opened/closed/rebound, or the registry changed"
   *  (pushed by main). The welcome screen re-fetches the open set + re-lists.
   *  Returns an unsubscribe function. */
  onWorkspacesWindowsChanged: (handler: () => void): (() => void) => {
    const wrapped = (): void => handler();
    ipcRenderer.on('workspace:windows-changed', wrapped);
    return () => ipcRenderer.off('workspace:windows-changed', wrapped);
  },
  /** Classify an absolute path from an OS drag payload: 'file' | 'dir' | null
   *  (missing/unreadable). Lets the drop handler route folders → add-as-
   *  workspace and files → copy-into-workspace. */
  pathKind: (absPath: string): Promise<'file' | 'dir' | null> =>
    ipcRenderer.invoke('path:kind', absPath),
  /** The on-disk absolute path of a dropped File object ('' when it has
   *  none, e.g. a JS-constructed File). File.path was removed from modern
   *  runtimes; webUtils.getPathForFile is the sanctioned replacement and is
   *  only callable from the preload context, hence this bridge. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
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
  /** Subscribe to window fullscreen changes (relayed by main). macOS hides the
   *  traffic lights in fullscreen, so the title bar reclaims their reserved
   *  space. Returns an unsubscribe function; the main process pushes the
   *  current state once the page loads. */
  onFullscreenChange: (handler: (isFullscreen: boolean) => void): (() => void) => {
    const wrapped = (_e: unknown, isFullscreen: boolean): void => handler(isFullscreen);
    ipcRenderer.on('window:fullscreen', wrapped);
    return () => ipcRenderer.off('window:fullscreen', wrapped);
  },
  /** The current window zoom factor (Electron zoomFactor = 1.2^level), read
   *  synchronously from this frame. The title bar counter-zooms by 1/factor so it
   *  (and the native traffic lights, which DON'T scale with page zoom) stay
   *  aligned at any zoom — read once on mount to avoid a missed-broadcast race. */
  getZoomFactor: (): number => webFrame.getZoomFactor(),
  /** Subscribe to window zoom-factor changes (relayed by main when the View-menu
   *  zoom commands fire / on load). Returns an unsubscribe function. */
  onZoomFactor: (handler: (factor: number) => void): (() => void) => {
    const wrapped = (_e: unknown, factor: number): void => handler(factor);
    ipcRenderer.on('window:zoom-factor', wrapped);
    return () => ipcRenderer.off('window:zoom-factor', wrapped);
  },
  /** App version (package.json in dev, bundle metadata when packaged). */
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /** Read the app-level prefs (settings the main process owns; see main/prefs.ts). */
  getPrefs: (): Promise<{ autoUpdateCheck: boolean; autoDownloadUpdate: boolean }> =>
    ipcRenderer.invoke('prefs:get'),
  /** Patch the app-level prefs; resolves to the merged result. */
  setPrefs: (patch: {
    autoUpdateCheck?: boolean;
    autoDownloadUpdate?: boolean;
  }): Promise<{ autoUpdateCheck: boolean; autoDownloadUpdate: boolean }> =>
    ipcRenderer.invoke('prefs:set', patch),
  /** Step the window zoom (same authoritative level the View menu drives; the
   *  resulting factor arrives via onZoomFactor). */
  zoomWindow: (action: 'in' | 'out' | 'reset'): Promise<void> =>
    ipcRenderer.invoke('window:zoom', action),
  /** Open an external https link in the system browser. Main enforces an
   *  allowlist (project pages only) — the renderer can't launch arbitrary URLs. */
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:open-external', url),
  /** Read the system clipboard as text — backs the terminal's Paste action via
   *  the main-process clipboard (reliable under the sandbox, unlike
   *  navigator.clipboard.readText). */
  clipboardReadText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
  /** Claim the next native context menu so it doesn't ALSO pop when an in-app
   *  context menu opens (e.g. over the terminal, which Electron reports as
   *  editable). SYNCHRONOUS so the flag is set in main before its `context-menu`
   *  event fires for this same right-click. */
  suppressNextNativeContextMenu: (): void => {
    ipcRenderer.sendSync('ctxmenu:suppress-next');
  },
  /** Subscribe to the app-menu "Settings…" action (relayed by main). Returns an
   *  unsubscribe function; the renderer owns the Settings overlay. */
  onMenuOpenSettings: (handler: () => void): (() => void) => {
    const wrapped = (): void => handler();
    ipcRenderer.on('menu:open-settings', wrapped);
    return () => ipcRenderer.off('menu:open-settings', wrapped);
  },
  /** Subscribe to the File ▸ Close Tab (⌘W) action (relayed by main, which owns
   *  the accelerator so it doesn't close the window). Returns an unsubscribe
   *  function; the renderer closes its active editor tab. */
  onMenuCloseTab: (handler: () => void): (() => void) => {
    const wrapped = (): void => handler();
    ipcRenderer.on('menu:close-tab', wrapped);
    return () => ipcRenderer.off('menu:close-tab', wrapped);
  },
  /** Quit handshake: main asks the renderer to flush all editors before the
   *  window closes. The handler returns whether the flush succeeded (false =
   *  blocked by a conflict / failed write → main cancels the quit). Returns an
   *  unsubscribe function. */
  onFlushRequest: (handler: () => Promise<boolean>): (() => void) => {
    const wrapped = (): void => {
      void handler().then(
        (ok) => ipcRenderer.send('app:flush-reply', ok),
        () => ipcRenderer.send('app:flush-reply', true), // a flush error must not trap quit
      );
    };
    ipcRenderer.on('app:flush-request', wrapped);
    return () => ipcRenderer.off('app:flush-request', wrapped);
  },
  /** Self-update state machine lives in MAIN (background checks run before any
   *  window exists); these mirror it. See main/updater.ts for the states. */
  updateGetState: (): Promise<unknown> => ipcRenderer.invoke('update:get-state'),
  updateCheck: (): Promise<void> => ipcRenderer.invoke('update:check'),
  updateDownload: (): Promise<void> => ipcRenderer.invoke('update:download'),
  updateInstall: (): Promise<void> => ipcRenderer.invoke('update:install'),
  /** One-shot: did we just self-update? Resolves { version, notes } once (the
   *  record is cleared on read), else null. Backs the "what's new" panel. */
  updateJustInstalled: (): Promise<unknown> => ipcRenderer.invoke('update:just-installed'),
  /** Subscribe to update state transitions (pushed by main). Returns an
   *  unsubscribe function. */
  onUpdateState: (handler: (state: unknown) => void): (() => void) => {
    const wrapped = (_e: unknown, state: unknown): void => handler(state);
    ipcRenderer.on('update:state', wrapped);
    return () => ipcRenderer.off('update:state', wrapped);
  },
  /** Subscribe to the menu/right-click "Open Folder…" action (relayed by main).
   * Returns an unsubscribe function. The renderer responds by running its
   * own pickAndAdd flow, so the folder-open UX is identical to the in-app
   * paths — main just triggers it. */
  onMenuOpenFolder: (handler: () => void): (() => void) => {
    const wrapped = (): void => handler();
    ipcRenderer.on('menu:open-folder', wrapped);
    return () => ipcRenderer.off('menu:open-folder', wrapped);
  },
  /** Subscribe to the File-menu workspace-management actions (rename / remove
   * the active workspace, relayed by main). Returns an unsubscribe function.
   * The renderer responds with its own dialog flows (lib/actions), so the
   * menu path and any in-app path stay identical — main just triggers. */
  onMenuWorkspaceAction: (handler: (action: 'rename' | 'remove') => void): (() => void) => {
    const wrapped = (_e: unknown, action: unknown): void => {
      if (action === 'rename' || action === 'remove') handler(action);
    };
    ipcRenderer.on('menu:workspace-action', wrapped);
    return () => ipcRenderer.off('menu:workspace-action', wrapped);
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
  /** Embedded terminal bridge. The real shell pty lives in MAIN (the sandboxed
   *  renderer can't spawn processes); xterm.js in the renderer is the view.
   *  Bytes stream both ways: spawn/write/resize/kill out, data/exit in. */
  terminal: {
    /** Spawn a shell pty. cwd defaults to the active workspace root (resolved in
     *  main). Resolves the new session id and its resolved cwd. */
    spawn: (opts?: { cols?: number; rows?: number; cwd?: string }): Promise<{
      id: string;
      cwd: string;
    }> => ipcRenderer.invoke('terminal:spawn', opts ?? {}),
    /** Forward user keystrokes to a session's pty. */
    write: (id: string, data: string): void => {
      ipcRenderer.send('terminal:write', { id, data });
    },
    /** Tell a session's pty the new viewport size (cols × rows). */
    resize: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', { id, cols, rows });
    },
    /** Kill a session's pty (tab close / unmount). */
    kill: (id: string): void => {
      ipcRenderer.send('terminal:kill', { id });
    },
    /** Subscribe to pty output. Returns an unsubscribe function. */
    onData: (handler: (id: string, data: string) => void): (() => void) => {
      const wrapped = (_e: unknown, payload: { id: string; data: string }): void =>
        handler(payload.id, payload.data);
      ipcRenderer.on('terminal:data', wrapped);
      return () => ipcRenderer.off('terminal:data', wrapped);
    },
    /** Subscribe to pty exit. Returns an unsubscribe function. */
    onExit: (handler: (id: string, exitCode: number) => void): (() => void) => {
      const wrapped = (_e: unknown, payload: { id: string; exitCode: number }): void =>
        handler(payload.id, payload.exitCode);
      ipcRenderer.on('terminal:exit', wrapped);
      return () => ipcRenderer.off('terminal:exit', wrapped);
    },
  },
};

contextBridge.exposeInMainWorld('bh', bh);
