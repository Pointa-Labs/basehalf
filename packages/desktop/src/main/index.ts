import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app } from 'electron';

// Source is ESM (matches monorepo type:module) but emit is CJS — see
// electron.vite.config.ts for why. import.meta.url is polyfilled by rollup
// in the CJS output, so this resolves correctly in both contexts.
const here = dirname(fileURLToPath(import.meta.url));

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(here, '../renderer/index.html'));
  }
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
