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
import { buildAppMenu, claimNativeContextMenuSuppression, installContextMenu } from './menu.js';
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
  clampToDisplays,
  debounce,
  geometryFor,
  readWindowStates,
  saveWindowState,
  saveWindowStateSync,
} from './window-state.js';
import {
  clearWorkspaceRoot,
  getWorkspaceRoot,
  getWorkspaceRootById,
  setWorkspaceRoot,
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
registerWorkspaceOpenHandler();
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
// Zoom hooks reference the function declarations below — hoisted, so safe here.
registerSettingsIpc(prefs, { getZoomLevel: () => currentZoomLevel, applyZoomLevel });
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

let mainWindow: BrowserWindow | null = null;

// Window UI zoom (like a mature editor's window zoom): the level is owned here so
// menu steps don't drift on Electron's factor↔level rounding, clamped to a sane
// range, applied to the window on every load, and persisted across restarts.
const MIN_ZOOM_LEVEL = -8;
const MAX_ZOOM_LEVEL = 8;
let currentZoomLevel = 0;

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

// Persist window bounds + zoom together (debounced; bounds-change and zoom-step
// events both flow through here). Stored under THIS window's workspace key, so
// each workspace remembers its own geometry. Module-scoped so the menu's zoom
// hooks can reach it (the menu is built at app-ready, before the window exists).
const persistWindowState = debounce(() => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const key = getWorkspaceRoot(mainWindow.webContents) ?? WELCOME_KEY;
  void saveWindowState(
    configDir,
    key,
    {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
      zoomLevel: currentZoomLevel,
    },
    currentOpenKeys(),
  );
}, 500);

/**
 * Resolve the workspace a freshly-created window should bind to: the one this
 * window had open at last quit (persisted in window-state), but ONLY if it's
 * still a registered workspace — else the welcome window (null). The active
 * workspace is desktop session state now, not a core pointer, so the validation
 * is a path match against the registry.
 */
async function resolveLaunchRoot(persisted: string | null): Promise<string | null> {
  if (persisted === null) return null;
  try {
    const { workspaces } = (await core.run('workspace.list', {})) as {
      workspaces: { path: string }[];
    };
    const lower = persisted.toLowerCase();
    return workspaces.some((w) => w.path.toLowerCase() === lower) ? persisted : null;
  } catch {
    return null;
  }
}

/**
 * `workspace:open` — switch THIS window to another workspace (or the welcome
 * state, `name: null`). A switch is a rebind + reload, never an in-place
 * re-point: the immutable per-load binding is what keeps every in-flight core
 * call race-free. The renderer flushes its editors BEFORE calling this (the
 * switch is gated there), so the reload can't drop unsaved edits.
 */
function registerWorkspaceOpenHandler(): void {
  ipcMain.handle('workspace:open', async (event, name: unknown): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const previousRoot = getWorkspaceRoot(win.webContents);
    let root: string | null = null;
    if (typeof name === 'string') {
      try {
        const { workspaces } = (await core.run('workspace.list', {})) as {
          workspaces: { name: string; path: string }[];
        };
        root = workspaces.find((w) => w.name === name)?.path ?? null;
      } catch {
        root = null;
      }
    }
    setWorkspaceRoot(win.webContents, root);
    persistWindowState();
    // Stop the old workspace's watcher if this was the last window showing it —
    // the reloaded page will start one for the new root. (Checked AFTER the
    // rebind so a second window still on the old workspace keeps it alive.)
    void stopWatcherIfOrphaned(previousRoot);
    // Dispose only THIS window's terminals before the reload, so the old page's
    // shells (rooted in the old workspace) don't leak; the reloaded page respawns
    // in the new workspace's cwd. Other windows' shells are untouched.
    disposeTerminalsForWindow(win.webContents.id);
    win.webContents.reload();
  });
}

/** Push the current zoom level onto the window AND tell the renderer the resulting
 *  factor, so the title bar can counter-zoom — staying aligned with the native
 *  macOS traffic lights, which do NOT scale with page zoom. */
function applyZoomToWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  wc.setZoomLevel(currentZoomLevel);
  wc.send('window:zoom-factor', wc.getZoomFactor());
}

/** Apply an absolute zoom level to the window (clamped) and persist it. Called by
 *  the View menu's Zoom In/Out/Actual-Size items. */
function applyZoomLevel(level: number): void {
  currentZoomLevel = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level));
  applyZoomToWindow();
  persistWindowState();
}

async function createWindow(): Promise<void> {
  const file = await readWindowStates(configDir);
  // Phase 2 runs a single window: reopen the (first) workspace that was open at
  // last quit. Resolved BEFORE the window so the binding is set before the
  // renderer's first bh:run. (Phase 3 iterates `file.open` to reopen them all.)
  const launchKey = file.open[0] ?? WELCOME_KEY;
  const launchRoot = launchKey === WELCOME_KEY ? null : await resolveLaunchRoot(launchKey);
  // Restore the geometry remembered for the workspace we actually land on (a
  // since-removed workspace falls back to welcome → its own remembered slot).
  const saved = geometryFor(file, launchRoot ?? WELCOME_KEY);
  currentZoomLevel = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, saved.zoomLevel ?? 0));
  const state = clampToDisplays(saved, screen.getAllDisplays());

  mainWindow = new BrowserWindow({
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

  if (state.isMaximized) mainWindow.maximize();

  // Bind this window to its workspace BEFORE loading the renderer, so the very
  // first bh:run resolves the right root. Immutable for this load — a switch
  // reloads + rebinds. Capture the numeric webContents id for the `closed`
  // cleanup (the WebContents is destroyed by then).
  setWorkspaceRoot(mainWindow.webContents, launchRoot);
  const wcId = mainWindow.webContents.id;

  // Navigation lockdown. A workspace can hold Markdown authored by someone else
  // (cloned repo, shared notes) whose links render as live anchors on canvas
  // cards. Without these guards a click would navigate the renderer to a remote
  // origin — and the preload re-injects the `window.bh` bridge on every load, so
  // that page would inherit full core access (read/write the user's files). We
  // deny ALL top-level navigation and window opens; genuine external links are
  // routed (by the renderer) through the allowlisted `shell:open-external` IPC.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // The dev server / packaged index.html load is the only legitimate
    // navigation; everything else (a clicked link) is refused.
    const allowed = process.env.ELECTRON_RENDERER_URL ?? '';
    if (allowed !== '' && url.startsWith(allowed)) return;
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Quit handshake: the renderer auto-saves on a ~400ms debounce, so a bare
  // ⌘Q / window-close could drop the last keystrokes (and, with a write-failed
  // banner up, everything since the last successful save). On first close we
  // ask the renderer to flush every editor and WAIT for it before quitting.
  //  - reply ok  → all edits persisted → quit.
  //  - reply !ok → a conflict / failed write is blocking → CANCEL the quit so the
  //    user can resolve it (the renderer is already showing the banner), instead
  //    of silently losing those edits. They ⌘Q again once resolved.
  //  - no reply within the timeout → a hung/dead renderer must never trap the
  //    user in an un-quittable app → quit anyway.
  let flushedForQuit = false;
  mainWindow.on('close', (e) => {
    const win = mainWindow;
    if (flushedForQuit || !win || win.isDestroyed()) return;
    e.preventDefault();
    const finishQuit = (): void => {
      flushedForQuit = true;
      if (!win.isDestroyed()) win.close();
    };
    const timer = setTimeout(finishQuit, 3000);
    ipcMain.once('app:flush-reply', (_evt, ok: unknown) => {
      clearTimeout(timer);
      if (ok === false) return; // blocked by a conflict — cancel quit, let user resolve
      finishQuit();
    });
    try {
      win.webContents.send('app:flush-request');
    } catch {
      clearTimeout(timer);
      finishQuit();
    }
  });

  // Native right-click menu (Open Folder… everywhere; clipboard roles in the
  // block editor). Per-window because it binds to this webContents.
  installContextMenu(mainWindow);

  // Relay fullscreen state to the renderer so the title bar reclaims the
  // traffic-light reserve. We do NOT hide the window buttons: in fullscreen
  // macOS reveals them (traffic lights + window title) on top-hover so the user
  // can exit fullscreen — keep that. The earlier "leak" was just the ugly
  // package-name title, now fixed by setting a real window title (workspace).
  const onFullscreenChange = (isFs: boolean): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:fullscreen', isFs);
  };
  mainWindow.on('enter-full-screen', () => onFullscreenChange(true));
  mainWindow.on('leave-full-screen', () => onFullscreenChange(false));
  mainWindow.webContents.on('did-finish-load', () => {
    onFullscreenChange(mainWindow?.isFullScreen() ?? false);
    // webContents zoom resets on every (re)load — reapply the remembered level (and
    // broadcast the factor so the title bar counter-zooms) so window zoom survives
    // reloads + restarts, like a mature editor.
    applyZoomToWindow();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(here, '../renderer/index.html'));
  }

  mainWindow.on('move', persistWindowState);
  mainWindow.on('resize', persistWindowState);
  mainWindow.on('maximize', persistWindowState);
  mainWindow.on('unmaximize', persistWindowState);

  // Drop the reference when the window is destroyed. On macOS the app keeps
  // running with no window (window-all-closed doesn't quit), so without this
  // `mainWindow` would dangle at a destroyed window until the next
  // createWindow() reassigns it — a latent footgun for any future code that
  // touches mainWindow without an isDestroyed() guard.
  mainWindow.on('closed', () => {
    // A hard window destroy skips the renderer's React teardown (which kills
    // each session's pty on unmount), so sweep THIS window's survivors here — no
    // orphan shell processes left running headless. Other windows keep theirs.
    disposeTerminalsForWindow(wcId);
    // Read the closed window's root (its WebContents is already destroyed, so go
    // by the id captured at bind time) BEFORE dropping the binding, then stop its
    // watcher if no other window still shows that workspace.
    const closedRoot = getWorkspaceRootById(wcId);
    clearWorkspaceRoot(wcId);
    void stopWatcherIfOrphaned(closedRoot);
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Replaces Electron's default menu — adds File ▸ Open Folder… (⌘O) and a custom
  // View menu whose zoom matches a mature editor (±1 level/⌘0), while keeping the
  // standard Edit/Window roles the editor relies on.
  Menu.setApplicationMenu(buildAppMenu({ getZoomLevel: () => currentZoomLevel, applyZoomLevel }));
  // Before the window: the renderer may ask for prefs as soon as it loads.
  await prefs.load();
  void createWindow();
  // Update plumbing: sweep debris a previous swap left behind (self-delayed —
  // see updater.ts), then start the background "newer version?" cadence (each
  // tick re-reads the pref).
  cleanupUpdateLeftovers();
  startBackgroundUpdateChecks(updater, prefs);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

// Sync save on quit so the debounced async writes don't get cut off mid-flight.
app.on('before-quit', () => {
  // Reap any live pty before exit (idempotent with the 'closed' sweep).
  disposeAllTerminals();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const key = getWorkspaceRoot(mainWindow.webContents) ?? WELCOME_KEY;
  try {
    saveWindowStateSync(
      configDir,
      key,
      {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: mainWindow.isMaximized(),
        zoomLevel: currentZoomLevel,
      },
      currentOpenKeys(),
    );
  } catch {
    // Best-effort; never block quit on persistence failures.
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
