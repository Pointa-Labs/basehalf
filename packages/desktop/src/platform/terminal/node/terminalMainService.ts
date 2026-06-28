import { spawn as ptySpawn } from '@lydell/node-pty';
import type { TerminalSpawnOpts, TerminalSpawnResult } from '../common/terminal.js';

export type { TerminalSpawnOpts, TerminalSpawnResult };

export interface TerminalDataDispatch {
  readonly ownerWcId: number;
  readonly id: string;
  readonly data: string;
}

export interface TerminalExitDispatch {
  readonly ownerWcId: number;
  readonly id: string;
  readonly exitCode: number;
}

export interface Disposable {
  dispose(): void;
}

type Listener<T> = (event: T) => void;
type TerminalPty = Pick<
  ReturnType<typeof ptySpawn>,
  'kill' | 'onData' | 'onExit' | 'resize' | 'write'
>;
export type TerminalPtySpawner = (
  file: string,
  args: Parameters<typeof ptySpawn>[1],
  options: Parameters<typeof ptySpawn>[2],
) => TerminalPty;

interface Session {
  readonly pty: TerminalPty;
  /** The webContents id that owns this pty; only that window can mutate it. */
  readonly ownerWcId: number;
}

export function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe';
  return process.env.SHELL ?? '/bin/zsh';
}

// A GUI app launched from Finder inherits a bare PATH: claude/codex/nvm/homebrew
// binaries live in profile PATH, not the default one. Spawn a login shell so the
// profile is sourced and those tools are found.
export function shellArgs(): string[] {
  return process.platform === 'win32' ? [] : ['-l'];
}

export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  if (!env.LANG && !env.LC_ALL) env.LANG = 'en_US.UTF-8';
  return env;
}

export function resolveCwd(boundRoot: string | null, requested?: string): string {
  if (requested) return requested;
  if (boundRoot) return boundRoot;
  return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
}

// Embedded terminal pty host. This mirrors VS Code's terminal platform split:
// the pty-owning service lives in the node layer, while Electron IPC is a
// separate channel in electron-main.
export class TerminalMainService {
  private readonly sessions = new Map<string, Session>();
  private readonly dataListeners = new Set<Listener<TerminalDataDispatch>>();
  private readonly exitListeners = new Set<Listener<TerminalExitDispatch>>();
  private nextId = 1;

  constructor(private readonly spawnPty: TerminalPtySpawner = ptySpawn) {}

  onDidWriteData(listener: Listener<TerminalDataDispatch>): Disposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onDidExit(listener: Listener<TerminalExitDispatch>): Disposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  spawnTerminal(
    ownerWcId: number,
    boundRoot: string | null,
    opts: TerminalSpawnOpts = {},
  ): TerminalSpawnResult {
    const id = `t${this.nextId++}`;
    const cwd = resolveCwd(boundRoot, opts.cwd);
    const pty = this.spawnPty(defaultShell(), shellArgs(), {
      name: 'xterm-256color',
      cols: Math.max(1, Math.floor(opts.cols ?? 80)),
      rows: Math.max(1, Math.floor(opts.rows ?? 24)),
      cwd,
      env: cleanEnv(),
    });
    this.sessions.set(id, { pty, ownerWcId });
    pty.onData((data) => this.emitData({ ownerWcId, id, data }));
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.emitExit({ ownerWcId, id, exitCode });
    });
    return { id, cwd };
  }

  writeTerminal(ownerWcId: number, id: string, data: string): void {
    this.sessionForSender(ownerWcId, id)?.pty.write(data);
  }

  resizeTerminal(ownerWcId: number, id: string, cols: number, rows: number): void {
    const session = this.sessionForSender(ownerWcId, id);
    if (!session) return;
    try {
      session.pty.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    } catch {
      // pty is tearing down.
    }
  }

  killTerminal(ownerWcId: number, id: string): void {
    const session = this.sessionForSender(ownerWcId, id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      session.pty.kill();
    } catch {
      // already gone
    }
  }

  disposeTerminalsForWindow(wcId: number): void {
    for (const [id, session] of this.sessions) {
      if (session.ownerWcId !== wcId) continue;
      this.killSession(id, session);
    }
  }

  disposeAllTerminals(): void {
    for (const [id, session] of this.sessions) {
      this.killSession(id, session);
    }
  }

  private sessionForSender(senderWcId: number, id: string): Session | undefined {
    const session = this.sessions.get(id);
    return session && session.ownerWcId === senderWcId ? session : undefined;
  }

  private killSession(id: string, session: Session): void {
    try {
      session.pty.kill();
    } catch {
      // ignore
    }
    this.sessions.delete(id);
  }

  private emitData(event: TerminalDataDispatch): void {
    for (const listener of this.dataListeners) listener(event);
  }

  private emitExit(event: TerminalExitDispatch): void {
    for (const listener of this.exitListeners) listener(event);
  }
}
