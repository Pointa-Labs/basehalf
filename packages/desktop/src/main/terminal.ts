import { type IPty, spawn as ptySpawn } from '@lydell/node-pty';
import { BrowserWindow, ipcMain } from 'electron';
import { getWorkspaceRoot } from './windows.js';

// Embedded terminal — the REAL shell process. The sandboxed renderer can't
// spawn native processes, so the pty lives here in main; xterm.js in the
// renderer is a thin view. Bytes stream both ways over the existing IPC bridge
// (window.bh.terminal.*). One IPty per terminal session, tracked by id.
//
// The native pty binary is @lydell/node-pty — an N-API build, so its prebuilt
// `.node` is ABI-stable across Electron and loads without electron-rebuild
// (verified under Electron 41). It must be externalized from the main bundle
// and unpacked from the asar at package time (see electron.vite.config.ts +
// electron-builder.yml).

const sessions = new Map<string, IPty>();
let nextId = 1;

function broadcast(channel: string, payload: unknown): void {
  // Single-window app today; mirror the watcher's broadcast-to-all pattern so a
  // future second window Just Works rather than silently missing pty output.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe';
  return process.env.SHELL ?? '/bin/zsh';
}

// A GUI app launched from Finder inherits a bare PATH — `claude`, `codex`, nvm
// node, homebrew, … all live in the user's profile PATH, not the default one.
// Spawn a LOGIN shell so the profile is sourced and those tools are found.
// POSIX shells take -l; cmd/powershell get no args.
function shellArgs(): string[] {
  return process.platform === 'win32' ? [] : ['-l'];
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // A real terminal: 256-color + truecolor so TUI agents (Claude Code, Codex)
  // render their colors, and a UTF-8 locale so CJK / emoji aren't mangled.
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  if (!env.LANG && !env.LC_ALL) env.LANG = 'en_US.UTF-8';
  return env;
}

function resolveCwd(boundRoot: string | null, requested?: string): string {
  // Honor an explicit requested cwd; else spawn in the window's bound workspace
  // folder (so the shell — and any coding agent run in it — starts in the right
  // place, and FOLLOWS the workspace because a switch reloads + respawns); else
  // fall back to the home dir for the welcome window.
  if (requested) return requested;
  if (boundRoot) return boundRoot;
  return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
}

interface SpawnOpts {
  cols?: number;
  rows?: number;
  cwd?: string;
}

export function registerTerminalIpc(): void {
  ipcMain.handle(
    'terminal:spawn',
    // Returns the cwd too so the renderer can seed a meaningful tab label (the
    // working-directory name) before the shell sets any OSC title.
    async (evt, opts: SpawnOpts = {}): Promise<{ id: string; cwd: string }> => {
      const id = `t${nextId++}`;
      const cwd = resolveCwd(getWorkspaceRoot(evt.sender), opts.cwd);
      const pty = ptySpawn(defaultShell(), shellArgs(), {
        name: 'xterm-256color',
        cols: Math.max(1, Math.floor(opts.cols ?? 80)),
        rows: Math.max(1, Math.floor(opts.rows ?? 24)),
        cwd,
        env: cleanEnv(),
      });
      sessions.set(id, pty);
      pty.onData((data) => broadcast('terminal:data', { id, data }));
      pty.onExit(({ exitCode }) => {
        sessions.delete(id);
        broadcast('terminal:exit', { id, exitCode });
      });
      return { id, cwd };
    },
  );

  ipcMain.on('terminal:write', (_evt, payload: { id: string; data: string }) => {
    sessions.get(payload.id)?.write(payload.data);
  });

  ipcMain.on('terminal:resize', (_evt, payload: { id: string; cols: number; rows: number }) => {
    const pty = sessions.get(payload.id);
    if (!pty) return;
    try {
      // cols/rows must be ≥1; a resize after the pty exits throws EBADF — guard.
      pty.resize(Math.max(1, Math.floor(payload.cols)), Math.max(1, Math.floor(payload.rows)));
    } catch {
      // pty is tearing down — ignore.
    }
  });

  ipcMain.on('terminal:kill', (_evt, payload: { id: string }) => {
    const pty = sessions.get(payload.id);
    if (!pty) return;
    sessions.delete(payload.id);
    try {
      pty.kill();
    } catch {
      // already gone
    }
  });
}

/** Kill every live pty so no shell process is orphaned. Called on window close
 *  and before quit (the renderer's unmount cleanup also kills per-session, but a
 *  hard window destroy skips React teardown, so we sweep here too). */
export function disposeAllTerminals(): void {
  for (const [id, pty] of sessions) {
    try {
      pty.kill();
    } catch {
      // ignore
    }
    sessions.delete(id);
  }
}
