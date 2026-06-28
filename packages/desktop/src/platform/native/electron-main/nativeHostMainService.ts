import { stat as fsStat } from 'node:fs/promises';
import {
  BrowserWindow,
  type BrowserWindow as ElectronBrowserWindow,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type WebContents,
  dialog,
  shell,
} from 'electron';
import { resolveInsideWorkspace } from '../../workspace/node/workspacePath.js';
import type { NativeHostPathKind, NativeHostResult } from '../common/native.js';

export interface NativeHostStats {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface NativeHostDialog {
  showOpenDialog(
    window: ElectronBrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
}

export interface NativeHostShell {
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
}

export interface NativeHostWindowLocator {
  fromWebContents(sender: WebContents): ElectronBrowserWindow | null;
}

export interface NativeHostMainServiceOptions {
  readonly stat?: (path: string) => Promise<NativeHostStats>;
  readonly resolveInsideWorkspace?: typeof resolveInsideWorkspace;
  readonly dialog?: NativeHostDialog;
  readonly shell?: NativeHostShell;
  readonly windowLocator?: NativeHostWindowLocator;
}

const GITHUB_TOP_LEVEL_ROUTES = new Set([
  'codespaces',
  'collections',
  'events',
  'features',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'settings',
  'sponsors',
  'topics',
]);

/**
 * Main-process native host service. VS Code exposes native OS capabilities via
 * a native host service and a thin IPC channel; this class owns BaseHalf's small
 * native capability set while keeping Electron IPC registration elsewhere.
 */
export class NativeHostMainService {
  private readonly stat: (path: string) => Promise<NativeHostStats>;
  private readonly resolveWorkspacePath: typeof resolveInsideWorkspace;
  private readonly dialog: NativeHostDialog;
  private readonly shell: NativeHostShell;
  private readonly windowLocator: NativeHostWindowLocator;

  constructor(opts: NativeHostMainServiceOptions = {}) {
    this.stat = opts.stat ?? fsStat;
    this.resolveWorkspacePath = opts.resolveInsideWorkspace ?? resolveInsideWorkspace;
    this.dialog = opts.dialog ?? dialog;
    this.shell = opts.shell ?? shell;
    this.windowLocator = opts.windowLocator ?? BrowserWindow;
  }

  async pickWorkspace(sender: WebContents): Promise<string | null> {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Pick a folder to register as a BaseHalf workspace',
    };
    const win = this.windowLocator.fromWebContents(sender);
    const result = await (win
      ? this.dialog.showOpenDialog(win, options)
      : this.dialog.showOpenDialog(options));
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  }

  async openPath(workspaceRoot: string | null, relPath: unknown): Promise<NativeHostResult> {
    try {
      if (!workspaceRoot) return { ok: false, error: 'No workspace open in this window.' };
      const resolved = await this.resolveWorkspacePath(workspaceRoot, relPath);
      if (!resolved.ok) return resolved;
      const errMsg = await this.shell.openPath(resolved.abs);
      return errMsg ? { ok: false, error: errMsg } : { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async pathKind(path: unknown): Promise<NativeHostPathKind> {
    if (typeof path !== 'string' || path.length === 0) return null;
    try {
      const s = await this.stat(path);
      return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null;
    } catch {
      return null;
    }
  }

  async openExternal(url: unknown): Promise<NativeHostResult> {
    if (typeof url !== 'string' || !isAllowedExternalUrl(url)) {
      return { ok: false, error: 'URL not allowed.' };
    }
    try {
      await this.shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return false;
  }
  const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
  return isGithubOwner(owner) && isGithubRepositoryName(repo);
}

function isGithubOwner(value: string | undefined): boolean {
  const owner = value ?? '';
  return (
    !GITHUB_TOP_LEVEL_ROUTES.has(owner.toLowerCase()) &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
  );
}

function isGithubRepositoryName(value: string | undefined): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value ?? '');
}
