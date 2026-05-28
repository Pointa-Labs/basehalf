import type { Core } from '@basehalf/core';
import { BrowserWindow, dialog, ipcMain } from 'electron';

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
}

export type BhRunResponse = { ok: true; result: unknown } | { ok: false; error: SerializedError };

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const out: SerializedError = { name: err.name, message: err.message };
    if ('code' in err && typeof (err as { code: unknown }).code === 'string') {
      out.code = (err as { code: string }).code;
    }
    return out;
  }
  return { name: 'Error', message: String(err) };
}

/**
 * Register the `workspace:pick` IPC channel — exposes Electron's native
 * directory picker to the renderer. Kept separate from `bh:run` because
 * GUI-only flows (file system dialog) aren't core commands; only core
 * commands route through `bh:run`.
 */
export function registerWorkspacePickHandler(): void {
  ipcMain.handle('workspace:pick', async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await (win
      ? dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Pick a folder to register as a BaseHalf workspace',
        })
      : dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: 'Pick a folder to register as a BaseHalf workspace',
        }));
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });
}

/**
 * Register the `bh:run` IPC channel — the single bridge from renderer
 * to core. Renderer-facing errors are serialized into a tagged union so
 * the structured clone IPC boundary doesn't lose the error type.
 * preload re-throws on the renderer side.
 */
export function registerBhRunHandler(core: Core): void {
  ipcMain.handle('bh:run', async (_event, name, args): Promise<BhRunResponse> => {
    if (typeof name !== 'string') {
      return {
        ok: false,
        error: { name: 'TypeError', message: 'bh:run: command name must be a string' },
      };
    }
    try {
      const result = await core.run(name, args);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: serializeError(err) };
    }
  });
}
