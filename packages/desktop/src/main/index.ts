import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type WatcherHostEvent,
  createCore,
  defaultConfigDir,
  defaultFs,
  watcherEvents,
} from '@basehalf/core';
import { BrowserWindow, Menu, app, ipcMain, screen, shell } from 'electron';
import {
  registerBhRunHandler,
  registerPathKindHandler,
  registerSettingsIpc,
  registerShellOpenHandler,
  registerWorkspacePickHandler,
} from './ipc.js';
import {
  type OpenRecentMode,
  type RecentWorkspace,
  buildAppMenu,
  buildDockMenu,
  claimNativeContextMenuSuppression,
  installContextMenu,
} from './menu.js';
import { PrefsStore } from './prefs.js';
import { disposeAllTerminals, disposeTerminalsForWindow, registerTerminalIpc } from './terminal.js';
import {
  Updater,
  cleanupUpdateLeftovers,
  registerUpdaterIpc,
  startBackgroundUpdateChecks,
} from './updater.js';
import {
  WELCOME_KEY,
  type WindowState,
  clampToDisplays,
  debounce,
  geometryFor,
  readWindowStates,
  saveWindowState,
  saveWindowStateSync,
} from './window-state.js';
import {
  clearWorkspaceRoot,
  decideOpen,
  getWorkspaceRoot,
  getWorkspaceRootById,
  resolveSessionRoots,
  samePath,
  setWorkspaceRoot,
  sortWorkspacesByRecency,
} from './windows.js';

// Source is ESM but emit is CJS (see electron.vite.config.ts). import.meta.url
// is polyfilled by rollup in the CJS output.
const here = dirname(fileURLToPath(import.meta.url));

const configDir = defaultConfigDir();
// Compose the default node-fs with Electron's `shell.trashItem` so
// `workspace.deleteEntry` sends user files to the OS trash (recoverable) rather
// than permanently removing them. Core stays Electron-free — the CLI (no trash)
// falls back to a permanent `fs.rm`. `trashItem` needs an absolute path, which
// the deleteEntry handler already resolves + contains.
const core = createCore({
  fs: { ...defaultFs(), trash: (path: string) => shell.trashItem(path) },
});
const prefs = new PrefsStore(configDir);

// AR-PR9-2 self-test signal: confirms core's first-party modules registered.
console.log('[bh-desktop] core.has("workspace.list") =', core.has('workspace.list'));

registerBhRunHandler(core);
registerWorkspacePickHandler();
registerShellOpenHandler();
registerPathKindHandler();
registerWorkspaceWindowHandlers();
// The renderer claims (synchronously) the next native context menu when it opens
// an in-app one, so the two never stack (chiefly over the terminal, which Electron
// can report as editable). sendSync so the flag lands before the context-menu event.
ipcMain.on('ctxmenu:suppress-next', (event) => {
  claimNativeContextMenuSuppression();
  event.returnValue = true;
});
// Embedded terminal: pty lives in main, streams to xterm.js in the renderer.
// cwd defaults to the SENDER window's bound workspace root (see terminal.ts).
registerTerminalIpc();
// Zoom hooks act on the FOCUSED window (per-window zoom). getZoomLevel /
// applyZoomLevel are hoisted function declarations, so safe to reference here.
registerSettingsIpc(prefs, {
  getZoomLevel: () => getZoomLevel(BrowserWindow.getFocusedWindow()),
  applyZoomLevel: (level) => applyZoomLevel(BrowserWindow.getFocusedWindow(), level),
});
const updater = new Updater();
registerUpdaterIpc(updater);

// Forward file events from the core watcher to the renderer(s) showing the
// workspace the event came from, so the FilePreview can prompt for reload on
// external edits and rebind currentFile on renames. Listener is attached once,
// lives for the whole process. Event is a WatcherHostEvent — a discriminated
// union (add/change/unlink one path, or rename from/to) TAGGED with its
// `workspaceRoot`. We deliver ONLY to windows bound to that root: a change in
// workspace A must never reach a window showing B (each window's editor speaks
// for its own folder). The bound root is the exact string main injected into
// core.run, so an `===` match is correct (no path-normalization needed). The
// renderer narrows on `type` and ignores the extra `workspaceRoot` field.
watcherEvents.on('event', (event: WatcherHostEvent) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (getWorkspaceRoot(win.webContents) === event.workspaceRoot) {
      win.webContents.send('bh:file-event', event);
    }
  }
});

// Window UI zoom (like a mature editor's window zoom), PER WINDOW: each window
// owns its own level (keyed by webContents id) so menu/Settings steps act on the
// FOCUSED window only, clamped, applied on every load, and persisted per workspace.
const MIN_ZOOM_LEVEL = -8;
const MAX_ZOOM_LEVEL = 8;
const zoomLevels = new Map<number, number>();

// Quit coordination. A per-window 'close' handler that preventDefaults to flush
// async would VETO an app.quit() (on macOS the windows then close but the app
// stays alive — ⌘Q wouldn't quit on the first press). So the flush for a QUIT is
// driven from before-quit (which pauses the quit, flushes ALL windows, then
// re-quits); `isQuitting` tells the per-window handlers to step aside during that.
let isQuitting = false;
let flushedAllForQuit = false;

function getZoomLevel(win: BrowserWindow | null): number {
  if (!win || win.isDestroyed()) return 0;
  return zoomLevels.get(win.webContents.id) ?? 0;
}

/** The workspace keys (paths; `''` = welcome) of every LIVE window — the
 *  session-restore "open" set persisted with window-state. Computed from all
 *  windows so it's correct whether one (Phase 2) or many (Phase 3) are open. */
function currentOpenKeys(): string[] {
  const keys: string[] = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    keys.push(getWorkspaceRoot(win.webContents) ?? WELCOME_KEY);
  }
  return keys;
}

/** Is any live window still bound to this workspace root? */
function isRootStillBound(root: string): boolean {
  return BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && getWorkspaceRoot(w.webContents) === root,
  );
}

/**
 * Stop the watcher for a workspace no window shows anymore — the per-window
 * watcher lifecycle. A switch (A→B) or a window close leaves A's chokidar
 * instance running with no window to receive its events; without this it would
 * leak FS watches + memory for the rest of the session. Only stops when NO live
 * window is still bound to that root (so it survives a second window on the same
 * workspace in Phase 3). Call AFTER the binding change so the check is accurate.
 */
async function stopWatcherIfOrphaned(root: string | null): Promise<void> {
  if (root === null || isRootStillBound(root)) return;
  try {
    await core.run('watcher.stop', {}, { workspaceRoot: root });
  } catch {
    // Best-effort cleanup; a failed stop just leaves an idle watcher.
  }
}

/** Record that a window just opened this workspace — bumps its `lastOpenedAt` so
 *  the "recent workspaces" surfaces order it first. Fire-and-forget: a failed
 *  touch only costs recency ordering, never blocks the open.
 *
 *  Refreshes the surfaces AGAIN once the write COMMITS: `workspace.list` is
 *  lock-free, so the immediate refresh at the call site reads the file before this
 *  locked read-modify-write lands and would order the just-opened workspace stale.
 *  Rebuilding on commit corrects the order (a cheap double-rebuild; opens are
 *  user-paced). */
function touchWorkspace(root: string | null): void {
  if (root === null) return;
  void core.run('workspace.touch', { path: root }, { workspaceRoot: root }).then(
    () => refreshWorkspaceSurfaces(),
    () => {}, // best-effort; recency is a nicety, not a correctness invariant
  );
}

/** The workspace roots (paths) every LIVE window is bound to — the "which
 *  workspaces are open right now" set the welcome list + the recent surfaces mark
 *  as already-open. */
function boundRoots(): string[] {
  const roots: string[] = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const root = getWorkspaceRoot(win.webContents);
    if (root !== null) roots.push(root);
  }
  return roots;
}

/** The registered workspaces as the recent surfaces need them — most-recent-first,
 *  each flagged if a live window already shows it. */
async function listRecentWorkspaces(): Promise<RecentWorkspace[]> {
  const { workspaces } = (await core.run('workspace.list', {}, { workspaceRoot: null })) as {
    workspaces: { name: string; path: string; addedAt: string; lastOpenedAt?: string }[];
  };
  const open = new Set(boundRoots().map((r) => r.toLowerCase()));
  return sortWorkspacesByRecency(workspaces).map((w) => ({
    name: w.name,
    path: w.path,
    isOpen: open.has(w.path.toLowerCase()),
  }));
}

/** Tell every renderer the open-windows set changed, so the welcome screen
 *  re-fetches it (the "Open" markers) and re-lists for the recency order. */
function broadcastWindowsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('workspace:windows-changed');
  }
}

/**
 * Rebuild the recent-workspace surfaces — File ▸ Open Recent, the macOS Dock menu —
 * and nudge every renderer to refresh its welcome list. Called whenever the
 * registry or the open windows change (a window open/close/rebind, or a renderer
 * registry mutation via `app:workspaces-changed`). Fire-and-forget: a failed list
 * just leaves the surfaces momentarily stale, never blocks anything.
 */
function refreshWorkspaceSurfaces(): void {
  void (async () => {
    let recent: RecentWorkspace[] = [];
    try {
      recent = await listRecentWorkspaces();
    } catch (err) {
      console.error('[bh-desktop] refreshWorkspaceSurfaces: list failed', err);
    }
    Menu.setApplicationMenu(
      buildAppMenu(
        focusedZoomHooks,
        () => spawnWindow(null),
        recent,
        openRecentWorkspace,
        () => void updater.check({ background: false }),
      ),
    );
    // app.dock is macOS-only; a no-op elsewhere (Windows jump list is a follow-up).
    app.dock?.setMenu(buildDockMenu(recent, openRecentWorkspace));
    broadcastWindowsChanged();
  })();
}

/**
 * Open a workspace from File ▸ Open Recent / the Dock menu. `default` = open-or-
 * focus from the focused window (the IPC path's behavior); `new` = always a new
 * window (⌘/⌃-click); `same` = reuse the focused window (⌥-click). Falls back to a
 * new window when there's no focused window to act from. Each branch routes through
 * a primitive that refreshes the surfaces, so the menu/dock self-update after.
 */
async function openRecentWorkspace(name: string, mode: OpenRecentMode): Promise<void> {
  const root = await rootForName(name);
  if (root === null) return; // workspace removed since the menu was built
  const focused = BrowserWindow.getFocusedWindow();
  if (mode === 'new') {
    await createWindow(root);
    return;
  }
  if (mode === 'same' && focused && !focused.isDestroyed()) {
    // Already showing it → a reload would only throw away renderer state (scroll /
    // selection / open file) for nothing.
    if (samePath(getWorkspaceRoot(focused.webContents), root)) return;
    // rebindAndReload reloads the renderer, discarding its editor state — so FLUSH
    // first (the in-app remove/repath flows gate on flushAll() before reopen; this
    // main-driven path must too, or ⌥-click would lose unsaved edits). A blocked
    // flush (disk conflict / failed write) CANCELS the reload so the user resolves
    // it, exactly like the close handshake.
    const ok = await flushWindow(focused);
    if (ok && !focused.isDestroyed()) rebindAndReload(focused, root);
    return;
  }
  if (focused && !focused.isDestroyed()) {
    const result = openChain.then(() => openOrFocus(focused, root));
    openChain = result.catch(() => undefined);
    await result;
  } else {
    await createWindow(root);
  }
}

// Persist ONE window's bounds + zoom under its own workspace key, so each
// workspace remembers its own geometry. Per-window now (move/resize listeners
// debounce a call to this with their specific window); zoom steps call it
// immediately.
function persistWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const key = getWorkspaceRoot(win.webContents) ?? WELCOME_KEY;
  // Geometry only — the `open` session set is owned by the sync close/quit writers
  // (a geometry debounce must not rewrite `open`, or it could resurrect a window
  // the user just closed; see saveWindowState).
  void saveWindowState(configDir, key, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
    zoomLevel: getZoomLevel(win),
  });
}

/** Resolve a workspace NAME to its registered path (null if unknown / not a name). */
async function rootForName(name: unknown): Promise<string | null> {
  if (typeof name !== 'string') return null;
  try {
    const { workspaces } = (await core.run('workspace.list', {})) as {
      workspaces: { name: string; path: string }[];
    };
    return workspaces.find((w) => w.name === name)?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Rebind ONE window to a workspace (or welcome, `null`) and reload it — the
 * in-place transition: the welcome window becoming a folder (Open Folder reuse),
 * removing the open workspace (→ welcome), or a repath / ⌥-click-open-recent
 * moving the bound path. Reload-rebind, never an in-place re-point, so in-flight
 * core calls stay race free.
 *
 * The reload DISCARDS renderer editor state, so EVERY caller must flush first: the
 * renderer-driven flows (remove/repath via workspace:reopen) gate on flushAll();
 * the welcome reuse has no editor; the menu ⌥-"same" path flushes via flushWindow
 * before calling this. Don't add a caller that skips that gate.
 */
function rebindAndReload(win: BrowserWindow, root: string | null): void {
  const previousRoot = getWorkspaceRoot(win.webContents);
  setWorkspaceRoot(win.webContents, root);
  touchWorkspace(root);
  persistWindowState(win);
  // Stop the old workspace's watcher if no window shows it anymore (checked AFTER
  // the rebind); dispose only THIS window's terminals so the reloaded page
  // respawns in the new cwd. Other windows are untouched.
  void stopWatcherIfOrphaned(previousRoot);
  disposeTerminalsForWindow(win.webContents.id);
  win.webContents.reload();
  // This window's bound workspace changed → refresh the recent surfaces (their
  // "open" markers + the welcome list).
  refreshWorkspaceSurfaces();
}

/**
 * The multi-window workspace IPC:
 *  - `workspace:open` (name) — OPEN-OR-FOCUS: focus the window already showing it;
 *    else reuse the welcome/empty sender (rebind+reload); else open a NEW window.
 *    Returns `{ reused }` so the caller knows whether ITS window was reloaded
 *    (true) or a different window was focused/created (false → caller stays alive).
 *  - `workspace:reopen` (name|null) — REOPEN-HERE: rebind THIS window to the
 *    workspace (or welcome) and reload. The two in-place flows: remove-current
 *    (→ welcome) and repath (the bound path moved under this exact window).
 *  - `window:new` — open a fresh welcome window (File ▸ New Window).
 */
// Serialize open-or-focus so two near-simultaneous opens for the SAME not-yet-open
// workspace can't both decide "new-window" (or both "reuse-sender") and spawn a
// duplicate — the second runs only after the first's window exists, so it dedups
// to a focus. Opens are user-paced + rare, so sequential is fine. Kept non-rejecting
// (.catch) so one failed open can't wedge the chain.
let openChain: Promise<unknown> = Promise.resolve();

async function openOrFocus(
  sender: Electron.BrowserWindow,
  targetRoot: string,
): Promise<{ reused: boolean }> {
  // We run QUEUED behind openChain, so the sender may have been closed in the gap
  // since the IPC invocation — guard before dereferencing its webContents.
  if (sender.isDestroyed()) return { reused: false };
  const refs = BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed())
    .map((w) => ({ id: w.webContents.id, root: getWorkspaceRoot(w.webContents) }));
  const decision = decideOpen(refs, sender.webContents.id, targetRoot);
  if (decision.action === 'focus') {
    const existing = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.webContents.id === decision.id,
    );
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    }
    // Focusing an open workspace IS opening it — bump recency + refresh the recent
    // surfaces (the other branches refresh via createWindow / rebindAndReload).
    touchWorkspace(targetRoot);
    refreshWorkspaceSurfaces();
    return { reused: false };
  }
  if (decision.action === 'new-window') {
    await createWindow(targetRoot);
    return { reused: false };
  }
  // reuse-sender: the welcome window becomes this workspace.
  if (sender.isDestroyed()) return { reused: false };
  rebindAndReload(sender, targetRoot);
  return { reused: true };
}

function registerWorkspaceWindowHandlers(): void {
  ipcMain.handle('workspace:open', async (event, name: unknown): Promise<{ reused: boolean }> => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (!sender || sender.isDestroyed()) return { reused: false };
    const targetRoot = await rootForName(name);
    if (targetRoot === null) return { reused: false }; // unknown workspace → no-op
    const result = openChain.then(() => openOrFocus(sender, targetRoot));
    openChain = result.catch(() => undefined);
    return result;
  });

  ipcMain.handle('workspace:reopen', async (event, name: unknown): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const targetRoot = name === null ? null : await rootForName(name);
    rebindAndReload(win, targetRoot);
  });

  ipcMain.handle('window:new', async (): Promise<void> => {
    await createWindow(null);
  });

  // The welcome list's "Open" markers: which workspaces a live window shows.
  ipcMain.handle('app:open-workspaces', (): string[] => boundRoots());

  // The renderer registered/removed/renamed/repathed a workspace (a registry change
  // with no window event) — rebuild the recent surfaces from the fresh registry.
  ipcMain.on('app:workspaces-changed', () => refreshWorkspaceSurfaces());
}

/** Push a window's remembered zoom level onto it AND tell its renderer the
 *  resulting factor, so the title bar can counter-zoom — staying aligned with the
 *  native macOS traffic lights, which do NOT scale with page zoom. */
function applyZoomToWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const wc = win.webContents;
  wc.setZoomLevel(getZoomLevel(win));
  wc.send('window:zoom-factor', wc.getZoomFactor());
}

/** Apply an absolute zoom level to a window (clamped), remember it per window, and
 *  persist it. Called by the View menu / Settings zoom items on the FOCUSED window. */
function applyZoomLevel(win: BrowserWindow | null, level: number): void {
  if (!win || win.isDestroyed()) return;
  zoomLevels.set(win.webContents.id, Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level)));
  applyZoomToWindow(win);
  persistWindowState(win);
}

/** Zoom hooks for the app menu + Settings IPC: they act on the FOCUSED window
 *  (the app menu is global; its zoom commands target whichever window is active). */
const focusedZoomHooks = {
  getZoomLevel: (): number => getZoomLevel(BrowserWindow.getFocusedWindow()),
  applyZoomLevel: (level: number): void => applyZoomLevel(BrowserWindow.getFocusedWindow(), level),
};

/**
 * Create ONE window bound to `workspaceRoot` (or the welcome state, `null`),
 * callable N times — the multi-window primitive. Restores the geometry + zoom
 * remembered for that workspace, wires every lifecycle handler to THIS specific
 * window (no module singleton), and returns it.
 */
async function createWindow(workspaceRoot: string | null): Promise<BrowserWindow> {
  const file = await readWindowStates(configDir);
  // Restore the geometry + zoom remembered for THIS window's workspace (welcome
  // uses its own '' slot). Resolved BEFORE the window so the binding is set
  // before the renderer's first bh:run.
  const key = workspaceRoot ?? WELCOME_KEY;
  const saved = geometryFor(file, key);
  const state = clampToDisplays(saved, screen.getAllDisplays());

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && { x: state.x }),
    ...(state.y !== undefined && { y: state.y }),
    // Frameless custom title bar: hide the native bar but keep the macOS
    // traffic lights, centered in our 36px title strip (BAR_HEIGHT in
    // TitleBar.tsx): ~14px lights → top ≈ (36-14)/2 = 11. We NEVER hide them, so
    // in fullscreen macOS reveals them on top-hover (you can still exit).
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hidden' as const,
      trafficLightPosition: { x: 19, y: 11 },
    }),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Remember this window's restored zoom level (per-window now); applied on load.
  zoomLevels.set(
    win.webContents.id,
    Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, saved.zoomLevel ?? 0)),
  );
  if (state.isMaximized) win.maximize();

  // Bind this window to its workspace BEFORE loading the renderer, so the very
  // first bh:run resolves the right root. Immutable for this load — a switch
  // reloads + rebinds. Capture the numeric webContents id for the `closed`
  // cleanup (the WebContents is destroyed by then).
  setWorkspaceRoot(win.webContents, workspaceRoot);
  touchWorkspace(workspaceRoot);
  const wcId = win.webContents.id;

  // Navigation lockdown. A workspace can hold Markdown authored by someone else
  // (cloned repo, shared notes) whose links render as live anchors on canvas
  // cards. Without these guards a click would navigate the renderer to a remote
  // origin — and the preload re-injects the `window.bh` bridge on every load, so
  // that page would inherit full core access (read/write the user's files). We
  // deny ALL top-level navigation and window opens; genuine external links are
  // routed (by the renderer) through the allowlisted `shell:open-external` IPC.
  win.webContents.on('will-navigate', (event, url) => {
    // The dev server / packaged index.html load is the only legitimate
    // navigation; everything else (a clicked link) is refused.
    const allowed = process.env.ELECTRON_RENDERER_URL ?? '';
    if (allowed !== '' && url.startsWith(allowed)) return;
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Close handshake: the renderer auto-saves on a ~400ms debounce, so a bare
  // ⌘Q / window-close could drop the last keystrokes (and, with a write-failed
  // banner up, everything since the last successful save). On first close we ask
  // THIS window's renderer to flush every editor and WAIT for it before closing.
  //  - reply ok  → all edits persisted → close.
  //  - reply !ok → a conflict / failed write is blocking → CANCEL the close so the
  //    user can resolve it (the renderer is already showing the banner).
  //  - no reply within the timeout → a hung/dead renderer must never trap the
  //    user in an un-closable window → close anyway.
  // The reply is correlated to THIS window (filter by event.sender) — with N
  // windows closing at once on ⌘Q, a global once() could consume window B's
  // reply for window A's gate.
  // The closing window's final geometry, captured on 'close' (still alive) and
  // persisted in 'closed' (when getBounds is no longer callable) together with the
  // reduced `open` set. Captured on every close attempt; the window doesn't move
  // between the handshake's preventDefault and its later win.close().
  let lastGeometry: WindowState | null = null;
  let flushedForClose = false;
  win.on('close', (e) => {
    if (!win.isDestroyed()) {
      const b = win.getBounds();
      lastGeometry = {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        isMaximized: win.isMaximized(),
        zoomLevel: getZoomLevel(win),
      };
    }
    // During a quit, before-quit drives the flush for ALL windows; the per-window
    // handshake must NOT preventDefault here (it would veto the quit). A plain
    // single-window close (⇧⌘W / red button, not quitting) still flushes below.
    if (isQuitting || flushedForClose || win.isDestroyed()) return;
    e.preventDefault();
    const cleanup = (): void => {
      clearTimeout(timer);
      ipcMain.removeListener('app:flush-reply', onReply);
    };
    const finishClose = (): void => {
      cleanup();
      flushedForClose = true;
      if (!win.isDestroyed()) win.close();
    };
    function onReply(evt: Electron.IpcMainEvent, ok: unknown): void {
      // If this window was destroyed by another path while its handshake was
      // pending, reading win.webContents below would throw inside the listener.
      if (win.isDestroyed()) {
        cleanup();
        return;
      }
      if (evt.sender !== win.webContents) return; // another window's reply
      if (ok === false) {
        cleanup(); // blocked by a conflict — cancel close, let the user resolve
        return;
      }
      finishClose();
    }
    const timer = setTimeout(finishClose, 3000);
    ipcMain.on('app:flush-reply', onReply);
    try {
      win.webContents.send('app:flush-request');
    } catch {
      finishClose();
    }
  });

  // Native right-click menu (clipboard roles in the block editor). Per-window
  // because it binds to this webContents.
  installContextMenu(win);

  // Relay fullscreen state to THIS window's renderer so the title bar reclaims
  // the traffic-light reserve. We do NOT hide the window buttons: in fullscreen
  // macOS reveals them on top-hover so the user can exit fullscreen — keep that.
  const onFullscreenChange = (isFs: boolean): void => {
    if (win.isDestroyed()) return;
    win.webContents.send('window:fullscreen', isFs);
  };
  win.on('enter-full-screen', () => onFullscreenChange(true));
  win.on('leave-full-screen', () => onFullscreenChange(false));
  win.webContents.on('did-finish-load', () => {
    onFullscreenChange(win.isFullScreen());
    // webContents zoom resets on every (re)load — reapply THIS window's remembered
    // level (and broadcast the factor so the title bar counter-zooms) so window
    // zoom survives reloads + restarts, like a mature editor.
    applyZoomToWindow(win);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(here, '../renderer/index.html'));
  }

  // Per-window geometry persistence — debounced, closed over THIS window so a
  // move/resize on window A saves A's slot, not whichever window is "active".
  const debouncedPersist = debounce(() => persistWindowState(win), 500);
  win.on('move', debouncedPersist);
  win.on('resize', debouncedPersist);
  win.on('maximize', debouncedPersist);
  win.on('unmaximize', debouncedPersist);

  win.on('closed', () => {
    // A hard window destroy skips the renderer's React teardown (which kills each
    // session's pty on unmount), so sweep THIS window's survivors here — no orphan
    // shell processes. Other windows keep theirs.
    disposeTerminalsForWindow(wcId);
    // Read the closed window's root (its WebContents is already destroyed, so go
    // by the id captured at bind time) BEFORE dropping the binding, then stop its
    // watcher if no other window still shows that workspace.
    const closedRoot = getWorkspaceRootById(wcId);
    clearWorkspaceRoot(wcId);
    zoomLevels.delete(wcId);
    void stopWatcherIfOrphaned(closedRoot);
    // Persist THIS window's final geometry under its own key + the now-reduced
    // `open` set. currentOpenKeys() excludes this just-destroyed window, so a
    // deliberately-closed workspace drops out of `open` and won't spuriously reopen
    // next launch (incl. the macOS last-window-close case). Also saves a last-second
    // resize the 500ms debounce missed. Sync so it lands promptly.
    //
    // EXCEPT during a quit: there, before-quit already wrote the FULL session
    // `open` (all windows still alive then) — so reducing it here as each window
    // closes would shrink the session to [] and lose the restore. Skip when quitting.
    if (lastGeometry && !isQuitting) {
      try {
        saveWindowStateSync(configDir, closedRoot ?? WELCOME_KEY, lastGeometry, currentOpenKeys());
      } catch {
        // Best-effort; never let a persistence failure escape the 'closed' handler.
      }
    }
    // A window disappeared → its workspace may no longer be "open"; refresh the
    // recent surfaces' markers. Skip during a quit (everything's tearing down).
    if (!isQuitting) refreshWorkspaceSurfaces();
  });

  // A new window now shows its workspace → refresh the recent surfaces (the new
  // window's own renderer also gets the broadcast, harmlessly).
  refreshWorkspaceSurfaces();

  return win;
}

/** Fire-and-forget createWindow for the menu / activate paths (nothing to await):
 *  logs instead of raising an unhandled rejection, matching restoreSession's
 *  resilience (a BrowserWindow construction failure shouldn't crash the loop). */
function spawnWindow(root: string | null): void {
  void createWindow(root).catch((err) => {
    console.error('[bh-desktop] createWindow failed', err);
  });
}

/** The registered workspace paths (for session-restore validation). */
async function registeredPaths(): Promise<string[]> {
  try {
    const { workspaces } = (await core.run('workspace.list', {})) as {
      workspaces: { path: string }[];
    };
    return workspaces.map((w) => w.path);
  } catch {
    return [];
  }
}

/** Reopen every workspace that had a window open at last quit (de-duped, removed
 *  ones dropped; a single welcome window if nothing survives). Resilient: a single
 *  failing createWindow must not abort the rest of startup, and the app must ALWAYS
 *  end with at least one window (else it's stuck with no UI and no way to open one). */
async function restoreSession(): Promise<void> {
  let opened = 0;
  try {
    const file = await readWindowStates(configDir);
    const roots = resolveSessionRoots(file.open, await registeredPaths());
    for (const root of roots) {
      try {
        await createWindow(root);
        opened++;
      } catch (err) {
        console.error('[bh-desktop] restore window failed for', root, err);
      }
    }
  } catch (err) {
    console.error('[bh-desktop] restoreSession failed', err);
  }
  if (opened === 0) {
    // Nothing restored (every root threw, or the read failed) → a welcome window.
    try {
      await createWindow(null);
    } catch (err) {
      console.error('[bh-desktop] welcome-window fallback failed', err);
    }
  }
}

app.whenReady().then(async () => {
  // Replaces Electron's default menu — adds File ▸ Open Folder… (⌘O) + New Window +
  // Open Recent, and a custom View menu whose zoom matches a mature editor (±1
  // level/⌘0), while keeping the standard Edit/Window roles the editor relies on.
  // Zoom acts on the focused window; New Window opens a welcome window. Built with
  // an empty recent list initially; refreshWorkspaceSurfaces (driven by the first
  // window) repopulates Open Recent + the Dock menu once the registry is read.
  Menu.setApplicationMenu(
    buildAppMenu(
      focusedZoomHooks,
      () => spawnWindow(null),
      [],
      openRecentWorkspace,
      () => void updater.check({ background: false }),
    ),
  );
  // Before the window: the renderer may ask for prefs as soon as it loads. A
  // prefs read failure must NOT abort startup (else no window opens) — fall back to
  // defaults. restoreSession (below) is itself resilient + guarantees ≥1 window.
  try {
    await prefs.load();
  } catch (err) {
    console.error('[bh-desktop] prefs.load failed; using defaults', err);
  }
  await restoreSession();
  // Update plumbing: sweep debris a previous swap left behind (self-delayed —
  // see updater.ts), then start the background "newer version?" cadence (each
  // tick re-reads the pref).
  cleanupUpdateLeftovers();
  startBackgroundUpdateChecks(updater, prefs);

  app.on('activate', () => {
    // macOS dock-activate with no windows → a fresh welcome window (full session
    // restore is a launch-time behavior, not a re-activate one).
    if (BrowserWindow.getAllWindows().length === 0) spawnWindow(null);
  });
});

/** Persist EVERY live window's geometry under its own workspace key + the full
 *  session `open` set — the authoritative snapshot written at quit (all windows
 *  still alive). Sync so it lands before the process exits. */
function persistAllWindowsSync(): void {
  const open = currentOpenKeys();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const bounds = win.getBounds();
    const key = getWorkspaceRoot(win.webContents) ?? WELCOME_KEY;
    try {
      saveWindowStateSync(
        configDir,
        key,
        {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized: win.isMaximized(),
          zoomLevel: getZoomLevel(win),
        },
        open,
      );
    } catch {
      // Best-effort; never block quit on persistence failures.
    }
  }
}

/** Ask ONE window's renderer to flush its editors; resolve whether it's OK to
 *  proceed (false = a disk conflict / failed write is blocking). A hung/dead
 *  renderer resolves true after a timeout — a quit (or a reload) must never be
 *  un-cancellably trapped. Reply correlated by event.sender so windows don't cross
 *  wires. Used by the quit flush AND the ⌥-click "open recent here" reload gate. */
function flushWindow(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      ipcMain.removeListener('app:flush-reply', onReply);
    };
    function onReply(evt: Electron.IpcMainEvent, ok: unknown): void {
      if (win.isDestroyed()) {
        cleanup();
        resolve(true);
        return;
      }
      if (evt.sender !== win.webContents) return;
      cleanup();
      resolve(ok !== false);
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, 3000);
    ipcMain.on('app:flush-reply', onReply);
    try {
      win.webContents.send('app:flush-request');
    } catch {
      cleanup();
      resolve(true);
    }
  });
}

// Quit coordination. A QUIT flushes here (NOT per-window) so the flush doesn't
// veto the quit (on macOS that left the windows closed but the app alive — ⌘Q
// didn't quit on the first press). First pass: persist the session, pause the
// quit, flush ALL windows, then re-quit. A blocked flush (open disk conflict)
// CANCELS the quit so the user can resolve it. Terminal disposal is in will-quit
// (only once the quit is committed). The per-window 'closed' handlers see
// isQuitting and skip their `open`-set reduction so the session isn't shrunk to [].
app.on('before-quit', (e) => {
  if (flushedAllForQuit) return; // resumed quit → let it proceed
  if (isQuitting) {
    // A flush from a prior ⌘Q is still in flight (e.g. an impatient double ⌘Q).
    // Keep the quit paused and let that first pass decide — re-quit or re-arm —
    // instead of launching a second competing flush.
    e.preventDefault();
    return;
  }
  persistAllWindowsSync(); // full session snapshot (all windows still alive)
  e.preventDefault(); // pause the quit while we flush
  isQuitting = true;
  void Promise.all(
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map(flushWindow),
  ).then((results) => {
    if (results.some((ok) => ok === false)) {
      // A window's flush is blocked by a conflict — cancel the quit (its banner is
      // up); re-arm so a later ⌘Q retries.
      isQuitting = false;
      return;
    }
    flushedAllForQuit = true;
    app.quit(); // resume; this pass short-circuits and the per-window closes step aside
  });
});

// Reap any surviving pty only once the quit is COMMITTED (will-quit fires after
// before-quit isn't cancelled and every window agreed to close). The per-window
// 'closed' handlers already dispose each window's terminals as it closes; this is
// the all-windows backstop for a hard quit that skipped graceful close.
app.on('will-quit', () => {
  disposeAllTerminals();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
