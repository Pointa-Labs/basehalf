import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, defaultConfigDir, watcherEvents } from '@basehalf/core';
import { BrowserWindow, Menu, app, screen } from 'electron';
import {
  registerBhRunHandler,
  registerShellOpenHandler,
  registerWorkspacePickHandler,
} from './ipc.js';
import { buildAppMenu, installContextMenu } from './menu.js';
import {
  clampToDisplays,
  debounce,
  readWindowState,
  writeWindowState,
  writeWindowStateSync,
} from './window-state.js';

// Source is ESM but emit is CJS (see electron.vite.config.ts). import.meta.url
// is polyfilled by rollup in the CJS output.
const here = dirname(fileURLToPath(import.meta.url));

const configDir = defaultConfigDir();
const core = createCore();

// AR-PR9-2 self-test signal: confirms core's first-party modules registered.
console.log('[bh-desktop] core.has("workspace.list") =', core.has('workspace.list'));

registerBhRunHandler(core);
registerWorkspacePickHandler();
registerShellOpenHandler(core);

// Forward file events from the core watcher to all open renderers so the
// FilePreview can prompt for reload on external edits and rebind currentFile
// on renames. Listener is attached once, lives for the whole process.
// Event is a discriminated union — add/change/unlink (one path) or rename
// (from/to). Send the whole shape; the renderer narrows on `type`.
watcherEvents.on('event', (event: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
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

// Persist window bounds + zoom together (debounced; bounds-change and zoom-step
// events both flow through here). Module-scoped so the menu's zoom hooks can reach
// it (the menu is built at app-ready, before the window exists).
const persistWindowState = debounce(() => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  void writeWindowState(configDir, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: mainWindow.isMaximized(),
    zoomLevel: currentZoomLevel,
  });
}, 500);

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
  const saved = await readWindowState(configDir);
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
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Replaces Electron's default menu — adds File ▸ Open Folder… (⌘O) and a custom
  // View menu whose zoom matches a mature editor (±1 level/⌘0), while keeping the
  // standard Edit/Window roles the editor relies on.
  Menu.setApplicationMenu(buildAppMenu({ getZoomLevel: () => currentZoomLevel, applyZoomLevel }));
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

// Sync save on quit so the debounced async writes don't get cut off mid-flight.
app.on('before-quit', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  try {
    writeWindowStateSync(configDir, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
      zoomLevel: currentZoomLevel,
    });
  } catch {
    // Best-effort; never block quit on persistence failures.
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
