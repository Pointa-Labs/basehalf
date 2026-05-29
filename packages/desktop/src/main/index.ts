import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, defaultConfigDir, watcherEvents } from '@basehalf/core';
import { BrowserWindow, app, screen } from 'electron';
import {
  registerBhRunHandler,
  registerShellOpenHandler,
  registerWorkspacePickHandler,
} from './ipc.js';
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

async function createWindow(): Promise<void> {
  const saved = await readWindowState(configDir);
  const state = clampToDisplays(saved, screen.getAllDisplays());

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && { x: state.x }),
    ...(state.y !== undefined && { y: state.y }),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(here, '../renderer/index.html'));
  }

  const persist = debounce(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    void writeWindowState(configDir, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
    });
  }, 500);

  mainWindow.on('move', persist);
  mainWindow.on('resize', persist);
  mainWindow.on('maximize', persist);
  mainWindow.on('unmaximize', persist);

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
    });
  } catch {
    // Best-effort; never block quit on persistence failures.
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
