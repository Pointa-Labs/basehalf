import { stat } from 'node:fs/promises';
import type { Core } from '@basehalf/core';
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import packageJson from '../../package.json' with { type: 'json' };
import type { PrefsStore } from './prefs.js';
import { getWorkspaceRoot } from './windows.js';
import { resolveInsideWorkspace } from './workspacePath.js';

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
 * Safety: the renderer passes a WORKSPACE-RELATIVE path; resolveInsideWorkspace
 * canonicalizes it (fs.realpath) against the current workspace root and refuses
 * anything that escapes — including via a planted SYMLINK, which a string-only
 * `..`/absolute check can't catch. So a malicious workspace can't make us open
 * arbitrary system files or launch an executable the OS associates. We then open
 * the verified real path. shell.openPath resolves to '' on success / error str.
 */
export function registerShellOpenHandler(): void {
  ipcMain.handle(
    'shell:open-path',
    async (event, relPath): Promise<{ ok: boolean; error?: string }> => {
      try {
        // Resolve relative to the SENDER window's bound workspace (not a global
        // current) — each window opens files from its own folder.
        const root = getWorkspaceRoot(event.sender);
        if (!root) return { ok: false, error: 'No workspace open in this window.' };
        const resolved = await resolveInsideWorkspace(root, relPath);
        if (!resolved.ok) return resolved;
        const errMsg = await shell.openPath(resolved.abs);
        return errMsg ? { ok: false, error: errMsg } : { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}

/**
 * Register the `path:kind` channel — classify an absolute path the OS handed
 * the renderer in a drag-drop payload, so the drop handler can route folders
 * (add as workspace) and files (copy into the open workspace) differently.
 * Read-only stat of a user-chosen path: the same trust level as the paths the
 * OS folder picker returns, and it leaks nothing beyond file-vs-dir-vs-absent.
 */
export function registerPathKindHandler(): void {
  ipcMain.handle('path:kind', async (_event, path): Promise<'file' | 'dir' | null> => {
    if (typeof path !== 'string' || path.length === 0) return null;
    try {
      const s = await stat(path);
      return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null;
    } catch {
      return null;
    }
  });
}

/** Hooks the Settings UI's zoom buttons call — same contract as the View
 *  menu's ZoomMenuHooks; the caller (main/index.ts) owns the authoritative
 *  level, clamping, applying, and persisting. */
export interface WindowZoomHooks {
  getZoomLevel: () => number;
  applyZoomLevel: (level: number) => void;
}

/** External links the renderer may open in the system browser. The renderer is
 *  sandboxed and its input untrusted — an allowlist (not a scheme check) keeps
 *  a compromised renderer from launching arbitrary URLs/protocol handlers.
 *  Parsed-field comparison, not a string prefix: URL parsing normalizes
 *  `..`/percent-escape tricks before we look, so the path can't sneak out of
 *  the project namespace. */
function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.host === 'github.com' &&
    parsed.pathname.startsWith('/Pointa-Labs/')
  );
}

/**
 * Settings-surface channels: app version (About), prefs read/write, the
 * window-zoom commands (mirroring the View menu so the Settings rows behave
 * identically), and allowlisted external links. GUI-only, so separate from
 * `bh:run` — none of these are core commands.
 */
export function registerSettingsIpc(prefs: PrefsStore, zoom: WindowZoomHooks): void {
  // Bundled at build time from package.json — `app.getVersion()` would be
  // right when packaged but falls back to the runtime's own version in dev
  // (the main script is launched directly, with no app package.json beside it).
  ipcMain.handle('app:version', (): string => packageJson.version);
  ipcMain.handle('prefs:get', () => prefs.get());
  ipcMain.handle('prefs:set', (_event, patch: unknown) => prefs.set(patch));
  ipcMain.handle('window:zoom', (_event, action: unknown): void => {
    if (action === 'in') zoom.applyZoomLevel(zoom.getZoomLevel() + 1);
    else if (action === 'out') zoom.applyZoomLevel(zoom.getZoomLevel() - 1);
    else if (action === 'reset') zoom.applyZoomLevel(0);
  });
  ipcMain.handle(
    'shell:open-external',
    async (_event, url: unknown): Promise<{ ok: boolean; error?: string }> => {
      if (typeof url !== 'string' || !isAllowedExternalUrl(url)) {
        return { ok: false, error: 'URL not allowed.' };
      }
      try {
        await shell.openExternal(url);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  // Clipboard READ for the terminal's Paste action. Goes through the main-process
  // `clipboard` module rather than navigator.clipboard.readText(), which is
  // unreliable under the renderer sandbox without a clipboard-read permission
  // grant. (Copy still uses navigator.clipboard.writeText — that one works.)
  ipcMain.handle('clipboard:read-text', (): string => clipboard.readText());
}

/**
 * Register the `bh:run` IPC channel — the single bridge from renderer
 * to core. Renderer-facing errors are serialized into a tagged union so
 * the structured clone IPC boundary doesn't lose the error type.
 * preload re-throws on the renderer side.
 */
export function registerBhRunHandler(core: Core): void {
  ipcMain.handle('bh:run', async (event, name, args): Promise<BhRunResponse> => {
    if (typeof name !== 'string') {
      return {
        ok: false,
        error: { name: 'TypeError', message: 'bh:run: command name must be a string' },
      };
    }
    try {
      // Inject the SENDER window's bound workspace root, so every core command
      // operates on the workspace THIS window shows (the per-window replacement
      // for core's old global current-workspace pointer). Registry commands
      // (workspace.add/list/…) ignore it; workspace-scoped ones anchor on it.
      const workspaceRoot = getWorkspaceRoot(event.sender);
      const result = await core.run(name, args, { workspaceRoot });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: serializeError(err) };
    }
  });
}
