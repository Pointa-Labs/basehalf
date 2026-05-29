import { join } from 'node:path';
import type { Core } from '@basehalf/core';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';

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
 * Register the `shell:open-path` channel — open a workspace file in the OS
 * default app (e.g. a .docx in Word) for file types bh has no inline viewer
 * for. GUI-only (Electron `shell`), so it's separate from `bh:run`.
 *
 * Safety: the renderer passes a WORKSPACE-RELATIVE path; we resolve it against
 * the current workspace root (from core) and reject absolute paths / `..`, so a
 * renderer bug can't ask the OS to open arbitrary system files. Returns the
 * tagged result; shell.openPath resolves to '' on success or an error string.
 */
export function registerShellOpenHandler(core: Core): void {
  ipcMain.handle(
    'shell:open-path',
    async (_event, relPath): Promise<{ ok: boolean; error?: string }> => {
      if (typeof relPath !== 'string' || relPath.length === 0) {
        return { ok: false, error: 'A path is required.' };
      }
      if (relPath.startsWith('/') || relPath.split(/[\\/]/).includes('..')) {
        return { ok: false, error: 'Refusing to open a path outside the workspace.' };
      }
      try {
        const cur = (await core.run('workspace.current', {})) as {
          current: { path: string } | null;
        };
        if (!cur.current) return { ok: false, error: 'No current workspace.' };
        const errMsg = await shell.openPath(join(cur.current.path, relPath));
        return errMsg ? { ok: false, error: errMsg } : { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
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
